/**
 * The human what-if, "Try a move": every legal place one set could go, scored by the timetable
 * engine with no language model (`GET /api/presets/{id}/moves?act=<act_id>&limit=8`). The server
 * computes every figure; this module only validates its answer and works out, from the published
 * timetable, which sets the page offers, which listed clashes a place ends or adds, and which
 * overlaps outside those lists it starts or lengthens. Pure functions, so they are unit tested.
 */

import type { MoveOption, MoveOptions } from "./agent-session";
import { isFixedByLocks } from "./clashes";
import { isRecord } from "./events";
import { growthClauses, lowerFirst, type GrowingOverlap } from "./overlap-words";
import type { Act, PairClash, Preset, SetSlot } from "./preset";
import { formatClock, overlapWindow, type TimeRange } from "./timetable";

/** One of a set's clashes, in Clash Budget Index points (one decimal, as the server sends them). */
export type PartnerPoints = { name: string; points: number };

/** A legal place, with where and when it is and the set's clashes there. */
export type PlacedOption = MoveOption & {
  stageId: string;
  end: string;
  day: number;
  /** At most three, largest first. */
  clashesAfter: PartnerPoints[];
};

/** The endpoint's answer: the agent's `find_moves` data plus the set's clashes now and after. */
export type MovesResult = Omit<MoveOptions, "options"> & {
  actId: string;
  /**
   * False when Qloo has no usable signal for the set: its clashes are not priced, so every place
   * leaves the Clash Budget Index where it is. Answers from before the field existed count as priced.
   */
  priced: boolean;
  /** At most three, largest first. Empty when the set cannot move. */
  clashesNow: PartnerPoints[];
  options: PlacedOption[];
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A partner list, or null when it is not one. */
function readPartners(value: unknown): PartnerPoints[] | null {
  if (!Array.isArray(value)) return null;
  const partners: PartnerPoints[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.with !== "string" || !item.with || !finite(item.points)) return null;
    partners.push({ name: item.with, points: item.points });
  }
  return partners;
}

function readOption(value: unknown): PlacedOption | null {
  if (!isRecord(value)) return null;
  const { move, stage, stage_id, start, end, day, clash_budget_after } = value;
  if (
    typeof move !== "string" ||
    typeof stage !== "string" ||
    typeof stage_id !== "string" ||
    typeof start !== "string" ||
    typeof end !== "string" ||
    !finite(day) ||
    !finite(clash_budget_after)
  ) {
    return null;
  }
  const clashesAfter = readPartners(value.clashes_after);
  if (!clashesAfter) return null;
  return { move, stage, start, after: clash_budget_after, stageId: stage_id, end, day, clashesAfter };
}

/**
 * Validates the moves endpoint's answer. Null when anything the page prints is missing or of the
 * wrong type, so a contract change shows the error state instead of a half-drawn card. Never throws.
 */
export function parseMoves(json: unknown): MovesResult | null {
  try {
    if (!isRecord(json) || json.kind !== "move_options") return null;
    const { act, act_id, from, movable } = json;
    if (typeof act !== "string" || typeof act_id !== "string" || typeof from !== "string") return null;
    if (typeof movable !== "boolean") return null;
    const why = typeof json.why === "string" && json.why ? json.why : null;
    const priced = typeof json.priced === "boolean" ? json.priced : true;

    if (!movable) {
      return { act, actId: act_id, from, movable, why, before: null, legalPlaces: 0, priced, clashesNow: [], options: [] };
    }

    if (!finite(json.clash_budget_before) || !finite(json.legal_places) || !Array.isArray(json.options)) return null;
    const clashesNow = readPartners(json.clashes_now);
    if (!clashesNow) return null;
    const options: PlacedOption[] = [];
    for (const item of json.options) {
      const option = readOption(item);
      if (!option) return null;
      options.push(option);
    }
    return {
      act,
      actId: act_id,
      from,
      movable,
      why,
      before: json.clash_budget_before,
      legalPlaces: json.legal_places,
      priced,
      clashesNow,
      options,
    };
  } catch {
    return null;
  }
}

/** A set the visitor can pick, in the order the select lists them. */
export type PickableSet = {
  actId: string;
  name: string;
  stageId: string;
  stageName: string;
  /** "15:45". */
  start: string;
  locked: boolean;
};

/** Every set on one festival day, by stage (in festival order) and then by start time. */
export function movableSets(preset: Pick<Preset, "festival">, day: number): PickableSet[] {
  const { festival } = preset;
  const acts = new Map(festival.acts.map((act) => [act.id, act]));
  const stageIndex = new Map(festival.stages.map((stage, index) => [stage.id, index]));
  return festival.timetable
    .filter((slot) => slot.day === day && acts.has(slot.act_id) && stageIndex.has(slot.stage_id))
    .sort(
      (p, q) =>
        (stageIndex.get(p.stage_id) ?? 0) - (stageIndex.get(q.stage_id) ?? 0) ||
        p.start - q.start ||
        p.act_id.localeCompare(q.act_id),
    )
    .map((slot) => ({
      actId: slot.act_id,
      name: acts.get(slot.act_id)?.name ?? slot.act_id,
      stageId: slot.stage_id,
      stageName: festival.stages[stageIndex.get(slot.stage_id) ?? 0].name,
      start: formatClock(slot.start),
      locked: slot.locked,
    }));
}

/** How many of the day's costliest clashes the "Start with" buttons are drawn from. */
export const STARTING_CLASHES = 6;

/**
 * Sets worth trying first: the acts in the day's costliest clashes (`ranked`, costliest first), in
 * that order, each once, leaving out locked sets.
 */
export function startingSets(
  ranked: readonly PairClash[],
  isLocked: (actId: string) => boolean,
  limit = 4,
): { actId: string; name: string }[] {
  const picked: { actId: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const clash of ranked.slice(0, STARTING_CLASHES)) {
    if (isFixedByLocks(clash, isLocked)) continue;
    for (const side of [clash.a, clash.b]) {
      if (picked.length >= limit) return picked;
      if (seen.has(side.act_id) || isLocked(side.act_id)) continue;
      seen.add(side.act_id);
      picked.push({ actId: side.act_id, name: side.name });
    }
  }
  return picked;
}

/** A clash of the published day's ranking to open next, by name, and the set in it that may move. */
export type NextPair = { a: string; b: string; actId: string };

/**
 * The first clash in the published day's ranking (`ranked`, costliest first, as the page already holds it)
 * that no kept step addresses (neither of its sets is in `moved`) and that has a set free to move (the first
 * of its two sets that `cannotMove` does not hold). The ranking is the published day's, not the plan's: it is
 * never recomputed after the plan, so this is "the next clash in the published day's ranking", not the next
 * costliest clash with the plan. Null when none is left.
 */
export function nextRankedPair(
  ranked: readonly PairClash[],
  moved: ReadonlySet<string>,
  cannotMove: (actId: string) => boolean,
): NextPair | null {
  for (const clash of ranked) {
    if (moved.has(clash.a.act_id) || moved.has(clash.b.act_id)) continue;
    const mover = [clash.a, clash.b].find((side) => !cannotMove(side.act_id));
    if (mover) return { a: clash.a.name, b: clash.b.name, actId: mover.act_id };
  }
  return null;
}

/** "19:45" -> 1185. Hours may pass 23 for a set after midnight. Null when it is not a time. */
export function clockMinutes(text: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Where a set plays: a day and a time range in minutes from the start of that day. */
export type Placement = TimeRange & { day: number };

/** Where a legal place puts the set, or null when its times cannot be read. */
export function placementOf(option: Pick<PlacedOption, "day" | "start" | "end">): Placement | null {
  const start = clockMinutes(option.start);
  const end = clockMinutes(option.end);
  if (start === null || end === null || end <= start) return null;
  return { day: option.day, start, end };
}

/**
 * Which acts would play at the same time as `actId` if it sat at `placement`, by name: every other
 * set on that day whose time overlaps it. Every other set stays where the published timetable puts
 * it, as the endpoint assumes.
 */
export function concurrentActs(
  preset: Pick<Preset, "festival">,
  actId: string,
  placement: Placement,
): Set<string> {
  const names = new Map(preset.festival.acts.map((act) => [act.id, act.name]));
  const concurrent = new Set<string>();
  for (const slot of preset.festival.timetable) {
    if (slot.act_id === actId || slot.day !== placement.day) continue;
    if (overlapWindow(slot, placement)) concurrent.add(names.get(slot.act_id) ?? slot.act_id);
  }
  return concurrent;
}

/** The set's own place on the published timetable. */
export function currentPlacement(preset: Pick<Preset, "festival">, actId: string): Placement | null {
  const slot: SetSlot | undefined = preset.festival.timetable.find((item) => item.act_id === actId);
  return slot ? { day: slot.day, start: slot.start, end: slot.end } : null;
}

/** A clash the move keeps, with its index points before and after. */
export type KeptClash = { name: string; now: number; after: number };

export type ClashChanges = {
  /** Clashes the set has now that the move ends, with their index points now. */
  ends: PartnerPoints[];
  /** Clashes the move adds, with their index points after. */
  adds: PartnerPoints[];
  /**
   * Clashes it has before and after, with both readings: a set moved a few minutes often keeps
   * its clash and only shortens it. Only partners on both lists, so both readings are the server's.
   */
  keeps: KeptClash[];
};

/**
 * Which of a set's clashes a move ends, which it adds and which it keeps, from the endpoint's two
 * lists. A partner listed now and not after is ended; listed after and not now is added; on both
 * lists, kept. Each list stops at three, so a partner can drop out of one only because others are
 * larger: when the times are known (`concurrentNow`, `concurrentAfter`: the acts playing at the
 * same time before and after the move), a clash only counts as ended when the two sets no longer
 * overlap, and only as added when they did not overlap before. The points are the endpoint's,
 * never recomputed.
 */
export function clashChanges(
  now: readonly PartnerPoints[],
  after: readonly PartnerPoints[],
  concurrentNow: ReadonlySet<string> | null = null,
  concurrentAfter: ReadonlySet<string> | null = null,
): ClashChanges {
  const listedNow = new Set(now.map((partner) => partner.name));
  const pointsAfter = new Map(after.map((partner) => [partner.name, partner.points]));
  const stillClashes = (name: string) => (concurrentAfter ? concurrentAfter.has(name) : pointsAfter.has(name));
  return {
    ends: now.filter((partner) => !stillClashes(partner.name)),
    adds: after.filter((partner) =>
      concurrentNow ? !concurrentNow.has(partner.name) : !listedNow.has(partner.name),
    ),
    keeps: now.flatMap((partner) => {
      const later = pointsAfter.get(partner.name);
      return stillClashes(partner.name) && later !== undefined
        ? [{ name: partner.name, now: partner.points, after: later }]
        : [];
    }),
  };
}

/**
 * The overlaps a place starts or lengthens with sets its lists do not show (`listed`, by name: the clashes it
 * ends, adds and keeps). Every other set on `timetable` is read with the minutes it shares with the moved set
 * at `home` (where it plays now) and at `after` (the place): the two sets' shared window on the same day, as
 * the hero's side-effect line reads it. A set is kept when it shares more after. The order is the hero's too,
 * the largest change first and then by name, so `growthClauses` words them as the hero does. Empty when a
 * placement is unknown. No request is made.
 */
export function outsideGrowth(
  acts: readonly Pick<Act, "id" | "name">[],
  timetable: readonly SetSlot[],
  actId: string,
  home: Placement | null,
  after: Placement | null,
  listed: ReadonlySet<string>,
): GrowingOverlap[] {
  if (!home || !after) return [];
  const names = new Map(acts.map((act) => [act.id, act.name]));
  const shared = (place: Placement, slot: SetSlot) => {
    if (slot.day !== place.day) return 0;
    const window = overlapWindow(place, slot);
    return window ? window.end - window.start : 0;
  };
  const grows: GrowingOverlap[] = [];
  for (const slot of timetable) {
    if (slot.act_id === actId) continue;
    const name = names.get(slot.act_id) ?? slot.act_id;
    if (listed.has(name)) continue;
    const before = shared(home, slot);
    const later = shared(after, slot);
    if (later > before) grows.push({ name, before, after: later });
  }
  return grows.sort((p, q) => q.after - q.before - (p.after - p.before) || p.name.localeCompare(q.name));
}

/** What the outside line starts with, before its clauses. */
export const OUTSIDE_LEAD = "Outside the listed clashes:";

/**
 * The outside line's clauses: the hero's own `growthClauses`, each continued in lower case ("new 15 min
 * overlap with Joy Crookes.", "lengthens the overlap with X from 10 to 25 min.", "2 more overlaps get
 * longer."). None for none.
 */
export function outsideClauses(grows: readonly GrowingOverlap[]): string[] {
  return growthClauses(grows).map(lowerFirst);
}

/** "Outside the listed clashes: new 15 min overlap with Joy Crookes.", or null when nothing outside grows. */
export function outsideLine(grows: readonly GrowingOverlap[]): string | null {
  const clauses = outsideClauses(grows);
  return clauses.length > 0 ? `${OUTSIDE_LEAD} ${clauses.join(" ")}` : null;
}

/**
 * The summary's last sentence when the outside line shows: "Outside the list, 1 overlap starts or grows." or
 * "Outside the list, 3 overlaps start or grow.", counting every one (the line names two). Null for none.
 */
export function outsideCount(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Outside the list, 1 overlap starts or grows." : `Outside the list, ${count} overlaps start or grow.`;
}

/**
 * Where a kept move came from, when the plan should say so: a place a recorded agent run tested and the
 * visitor kept with Keep this move. A move kept any other way carries no source.
 */
export type MoveSource = "recorded-run";

/** What the plan list prints after a move kept from a recorded agent run. */
export const RECORDED_RUN_NOTE = "(from a recorded agent run)";

/** The same move, marked as kept from a recorded agent run. Its place, and how it compares, do not change. */
export function fromRecordedRun<T extends object>(move: T): T & { source: MoveSource } {
  return { ...move, source: "recorded-run" };
}

/** True when a kept move came from a recorded agent run. An older kept move, with no source, never did. */
export function isFromRecordedRun(move: object | null | undefined): boolean {
  return Boolean(move && "source" in move && (move as { source?: unknown }).source === "recorded-run");
}
