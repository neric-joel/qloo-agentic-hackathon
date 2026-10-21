/**
 * The first screen's worked decision: `GET /api/presets/{id}/decision?day=` names the day's costliest
 * clash that has a set able to move, the single move with the lowest Clash Budget Index after it
 * and, for the same pair, what the rule search found (see `rule-fix.ts`). This module validates the
 * answer and builds every string and every drawing coordinate the decision card prints, from that
 * answer and the preset report the page already holds, so the server HTML and the client page print
 * exactly the same card. Taste overlap and draw are read from the report, never from the route.
 * Nothing here computes a figure: minutes, indexes and counts are the route's or the report's;
 * the timeline only scales published times to drawing units. Pure functions, so they are unit
 * tested; none throws.
 */

import { dayName, daysWithSets, festivalName, formatOverlap, topClashes } from "./clashes";
import { isRecord } from "./events";
import { pluralize } from "./format";
import { clockMinutes } from "./moves";
import { planVerdict, rangeLead } from "./plan-copy";
import type { Preset } from "./preset";
import {
  changeSummaryLine,
  fixStep,
  keepChangeLabel,
  keptChangeAnnouncement,
  lowerFirst,
  parseRuleFixes,
  ruleSentence,
  STAGE_FIT_GLOSS,
  shiftBrief,
  shiftWords,
  type RuleFixes,
} from "./rule-fix";
import { isSafeId, pairSharedReceipt, type RuleStackStep, type ScaleRange, type StackMove } from "./stack";
import { formatClock, formatRange, overlapWindow } from "./timetable";

// ------------------------------------------------------------------------------------ the answer

export type DecisionPlace = {
  actId: string;
  act: string;
  /** Where it plays now, "Woodsies 14:00-15:00". */
  from: string;
  stageId: string;
  stage: string;
  day: number;
  start: string;
  end: string;
  minutesMoved: number;
};

/** The day's costliest clash on the timetable after a change, as the plan's own clash list prints one. */
export type CostliestAfter = { a: string; b: string; minutes: number; points: number };

export type DecisionMove = DecisionPlace & {
  legalPlaces: number;
  stageChanged: boolean;
  /** The Clash Budget Index with this one move, as `POST /whatif` scores it. */
  budgetAfter: number;
  minutesSharedAfter: number;
  /** The other set's first place, when it gives the same index. */
  alternative: DecisionPlace | null;
  /** Stage-fit flags on the published day and with this move; null when the route sent none. */
  flagsNow: number | null;
  flagsAfter: number | null;
  /** The day's costliest clash with this move: null when no clash on the day has a price, undefined when not sent. */
  costliestAfter: CostliestAfter | null | undefined;
};

/** What the rule answer's first change leaves behind (the route's extra fields on that one change). */
export type RuleChangeAfter = {
  /** Minutes the pair shares after the change; null when not sent. */
  minutesSharedAfter: number | null;
  costliestAfter: CostliestAfter | null | undefined;
};

export type Decision = {
  day: number;
  /** Costlier clashes passed over because both sets are locked. */
  skippedLocked: number;
  /** Costlier clashes passed over because no set of theirs has a legal place that lowers the index. */
  skippedNoPlace: number;
  publishedBudget: number | null;
  clash: { aId: string; bId: string; rank: number; minutes: number } | null;
  move: DecisionMove | null;
  rule: RuleFixes | null;
  /** What the rule answer's first change leaves behind; null without a rule answer or that change. */
  ruleChange: RuleChangeAfter | null;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readPlace(value: unknown): DecisionPlace | null {
  if (!isRecord(value)) return null;
  const { act_id, act, from, stage_id, stage, day, start, end, minutes_moved } = value;
  if (!text(act_id) || !text(act) || !text(from) || !text(stage_id) || !text(stage) || !finite(day)) return null;
  if (!text(start) || !text(end) || !finite(minutes_moved)) return null;
  if (clockMinutes(start) === null || clockMinutes(end) === null) return null;
  return { actId: act_id, act, from, stageId: stage_id, stage, day, start, end, minutesMoved: minutes_moved };
}

/** A costliest clash: the object, null when the day has none, undefined when absent or mistyped. */
function readCostliest(value: unknown): CostliestAfter | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { a, b, minutes, points } = value;
  if (!text(a) || !text(b) || !finite(minutes) || !finite(points)) return undefined;
  return { a, b, minutes, points };
}

function readMove(value: unknown): DecisionMove | null {
  const place = readPlace(value);
  if (!place || !isRecord(value)) return null;
  const { legal_places, stage_changed, budget_after, minutes_shared_after, same_index_alternative } = value;
  if (!finite(legal_places) || typeof stage_changed !== "boolean") return null;
  if (!finite(budget_after) || !finite(minutes_shared_after)) return null;
  const alternative =
    same_index_alternative === null || same_index_alternative === undefined ? null : readPlace(same_index_alternative);
  if (same_index_alternative !== null && same_index_alternative !== undefined && !alternative) return null;
  return {
    ...place,
    legalPlaces: legal_places,
    stageChanged: stage_changed,
    budgetAfter: budget_after,
    minutesSharedAfter: minutes_shared_after,
    alternative,
    flagsNow: finite(value.stage_fit_flags_now) ? value.stage_fit_flags_now : null,
    flagsAfter: finite(value.stage_fit_flags_after) ? value.stage_fit_flags_after : null,
    costliestAfter: readCostliest(value.costliest_after),
  };
}

/** The extra fields of the rule answer's first listed change, or null when there is none. */
function readRuleChange(rule: unknown): RuleChangeAfter | null {
  if (!isRecord(rule) || !Array.isArray(rule.fixes) || !isRecord(rule.fixes[0])) return null;
  const first = rule.fixes[0];
  return {
    minutesSharedAfter: finite(first.minutes_shared_after) ? first.minutes_shared_after : null,
    costliestAfter: readCostliest(first.costliest_after),
  };
}

/** Validates the route's answer. Null when anything the page prints is missing or mistyped. Never throws. */
export function parseDecision(json: unknown): Decision | null {
  try {
    if (!isRecord(json) || json.kind !== "decision" || !finite(json.day)) return null;
    const skippedLocked = finite(json.skipped_locked) ? json.skipped_locked : 0;
    const skippedNoPlace = finite(json.skipped_no_place) ? json.skipped_no_place : 0;
    const publishedBudget = finite(json.published_budget) ? json.published_budget : null;

    let clash: Decision["clash"] = null;
    if (json.clash !== null && json.clash !== undefined) {
      const c = json.clash;
      if (!isRecord(c) || !text(c.a_id) || !text(c.b_id) || !finite(c.rank) || !finite(c.minutes)) return null;
      clash = { aId: c.a_id, bId: c.b_id, rank: c.rank, minutes: c.minutes };
    }

    let move: DecisionMove | null = null;
    if (json.move !== null && json.move !== undefined) {
      move = readMove(json.move);
      if (!move) return null;
    }

    // A rule answer that does not parse is dropped, not an error: the card then has no rule line.
    const rule = json.rule === null || json.rule === undefined ? null : parseRuleFixes(json.rule);

    const ruleChange = rule ? readRuleChange(json.rule) : null;

    return { day: json.day, skippedLocked, skippedNoPlace, publishedBudget, clash, move, rule, ruleChange };
  } catch {
    return null;
  }
}

/**
 * True when the decision has the card's move and a keep-apart change but lacks a figure the side-by-side
 * comparison prints (stage-fit flags, the costliest clash after, the time the pair shares after the
 * change). The server renders the card from a fetch it keeps for an hour, so an answer cached before the
 * route sent those fields lacks them; the browser then asks again once and prints the full table.
 */
export function lacksComparison(decision: Decision | null): boolean {
  if (!decision || !decision.move || !decision.rule || decision.publishedBudget === null) return false;
  const first = decision.rule.fixes[0];
  if (decision.rule.holds || !first || (decision.rule.a.locked && decision.rule.b.locked)) return false;
  const { move, ruleChange } = decision;
  return (
    move.flagsNow === null ||
    move.flagsAfter === null ||
    move.costliestAfter === undefined ||
    ruleChange === null ||
    ruleChange.minutesSharedAfter === null ||
    ruleChange.costliestAfter === undefined
  );
}

/** The route's path, or null for an id the page will not put in a request. */
export function decisionPath(presetId: string, day: number | null = null): string | null {
  if (!isSafeId(presetId)) return null;
  const base = `/api/presets/${encodeURIComponent(presetId)}/decision`;
  return day === null ? base : `${base}?day=${encodeURIComponent(String(Math.trunc(day)))}`;
}

/** Asks the route. Null on any failure; never throws. */
export async function requestDecision(
  presetId: string,
  day: number | null,
  signal?: AbortSignal,
): Promise<Decision | null> {
  const path = decisionPath(presetId, day);
  if (!path) return null;
  try {
    const response = await fetch(path, { headers: { Accept: "application/json" }, signal });
    if (!response.ok) return null;
    return parseDecision(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

/** The day the page opens on and the card is for: the first with sets. */
export function decisionDay(preset: Pick<Preset, "festival" | "report">): number {
  return daysWithSets(preset)[0] ?? 0;
}

// ------------------------------------------------------------------------------------ the copy

export const ATTRIBUTION = "Selected and scored by this app’s index";
export const NO_MOVE = "No legal place for either set lowers the index.";
/**
 * The rule-check sentence, set inside "Show the working" beside the rule row it describes. No sentence when
 * the card has no rule row: the caption under the index ("Selected and scored by this app’s index. A
 * reading, not a verdict.") already limits the clash and the move.
 */
export const LIMITS_WITH_RULE = "Checked against the timetable’s rules; its index is shown for information.";
export const LIMITS_NO_RULE = null;

export const TRADEOFF_HEADING = "The two changes side by side";
/** The heading when the plan holds more than the one change the table is about (the brief). */
export const TRADEOFF_HEADING_ALONE = "The two changes, tested alone, not your whole plan";
/** Under the heading: what each column is, and that the figures are for the published day. */
export const TRADEOFF_SUBTITLE =
  "Each change tested alone on the published day: the first column is the single move with the lowest index; the second is the smallest change this search found that ends the overlap.";
/** Under the table on the card, where the plan is priced further down the page. */
export const TRADEOFF_NOTE_CARD =
  "Weigh this reading; once you keep a change, the plan receipt below is what your plan does.";
/** Under the table in the brief, where the plan receipt comes first. */
export const TRADEOFF_NOTE_BRIEF = "Weigh this reading; the plan receipt above is what your plan does.";
export const TRADEOFF_MOVE_HEAD = "Move one set";
export const TRADEOFF_RULE_HEAD = "Keep the two apart";
export const NO_PRICED_CLASH = "No scored clash left on this day";

/** "Sprints and Katy J Pearson". */
function andList(names: readonly string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "45 → 30 minutes": the minutes the pair shares before and after one change. */
function sharedText(before: number, after: number): string {
  return `${before} → ${after} ${after === 1 ? "minute" : "minutes"}`;
}

/** "A and B, 30 minutes, 9.5 index points": the costliest clash as the plan's clash list prints it. */
function costliestText(clash: CostliestAfter | null): string {
  return clash
    ? `${clash.a} and ${clash.b}, ${pluralize(clash.minutes, "minute")}, ${clash.points.toFixed(1)} index points`
    : NO_PRICED_CLASH;
}

/**
 * The comparison of the card's two changes, one row per figure the route gave for both. A row whose
 * figure one side did not send is left out, never filled. Null unless the card has the single move,
 * the rule's first change and the published index. Every number is the route's.
 */
export function buildTradeoff(decision: Decision | null): Tradeoff | null {
  try {
    if (!decision || !decision.move || !decision.rule || decision.publishedBudget === null) return null;
    const { move, rule, publishedBudget: published } = decision;
    const first = rule.fixes[0];
    if (rule.holds || !first || (rule.a.locked && rule.b.locked)) return null;
    const after = decision.ruleChange;
    const rows: TradeoffRow[] = [
      {
        id: "sets",
        label: "Sets moved",
        move: `1 (${move.act})`,
        rule: `${first.setsMoved} (${andList(first.moves.map((item) => item.act))})`,
        note: null,
      },
      {
        id: "minutes",
        label: "Start-time minutes moved",
        move: String(move.minutesMoved),
        rule: String(first.minutesMoved),
        note: null,
      },
    ];
    if (after && after.minutesSharedAfter !== null && decision.clash) {
      const before = decision.clash.minutes;
      rows.push({
        id: "shared",
        label: "Time the pair shares, before → after",
        move: sharedText(before, move.minutesSharedAfter),
        rule: sharedText(before, after.minutesSharedAfter),
        note: null,
      });
      rows.push({
        id: "ends",
        label: "Ends the overlap",
        move: move.minutesSharedAfter === 0 ? "Yes" : "No",
        rule: after.minutesSharedAfter === 0 ? "Yes" : "No",
        note: null,
      });
    }
    if (first.budgetAfter !== null) {
      rows.push({
        id: "index",
        label: "Clash Budget Index, before → after",
        move: `${published.toFixed(1)} → ${move.budgetAfter.toFixed(1)}`,
        rule: `${published.toFixed(1)} → ${first.budgetAfter.toFixed(1)}`,
        note: ATTRIBUTION,
      });
    }
    if (move.flagsNow !== null && move.flagsAfter !== null) {
      rows.push({
        id: "flags",
        label: "Stage-fit flags, now → after",
        move: `${move.flagsNow} → ${move.flagsAfter}`,
        rule: `${first.flagsNow} → ${first.flagsAfter}`,
        note: STAGE_FIT_GLOSS,
      });
    }
    if (move.costliestAfter !== undefined && after && after.costliestAfter !== undefined) {
      rows.push({
        id: "costliest",
        label: "Costliest clash after",
        move: costliestText(move.costliestAfter),
        rule: costliestText(after.costliestAfter),
        note: null,
      });
    }
    return {
      heading: TRADEOFF_HEADING,
      subtitle: TRADEOFF_SUBTITLE,
      footnote: TRADEOFF_NOTE_CARD,
      moveHead: TRADEOFF_MOVE_HEAD,
      ruleHead: TRADEOFF_RULE_HEAD,
      rows,
    };
  } catch {
    return null;
  }
}

/** Rectangles are in drawing units on a 288-wide canvas, as the design spec draws them. */
export type TimelineBar = { x: number; w: number };

export type SharedTimeline = {
  /** The set that stays put and the set that moves, for the figure's text alternative. */
  stayingName: string;
  movingName: string;
  staying: TimelineBar;
  movingNow: TimelineBar;
  bandNow: TimelineBar | null;
  movingAfter: TimelineBar;
  bandAfter: TimelineBar | null;
  /**
   * A tick every 15 minutes across the axis. `major` is true at :00 and :30; only a major tick carries
   * a label, and `label` is empty when the tick has none (a minor tick, or a major one too close to the
   * label before it).
   */
  ticks: TimelineTick[];
};

export type TimelineTick = { x: number; label: string; major: boolean };

/** One row of the side-by-side comparison; both cells are printed text, built from the route's figures. */
export type TradeoffRow = {
  id: "sets" | "minutes" | "shared" | "ends" | "index" | "flags" | "costliest";
  label: string;
  /** The cell under "Move one set". */
  move: string;
  /** The cell under "Keep the two apart". */
  rule: string;
  /** A line under the row (the index's attribution, the stage-fit gloss); null for none. */
  note: string | null;
};

/** The two changes of the card in one place: the lowest-index single move and the smallest keep-apart change. */
export type Tradeoff = {
  heading: string;
  /** Says what each column is and that the figures are for the published day. */
  subtitle: string;
  /** One short non-verdict line under the table. */
  footnote: string;
  moveHead: string;
  ruleHead: string;
  rows: TradeoffRow[];
};

export type DecisionCopy = {
  /** The preset the card is for, so a client never shows another day's card. */
  presetId: string;
  day: number;
  /** "Sprints 15 minutes later: 45 → 30 minutes shared". Null when no move lowers the index. */
  receipt: string | null;
  /** The receipt before its figures: "Sprints 15 minutes later". */
  receiptLead: string | null;
  title: string;
  clashLine: string;
  moveLine: string;
  /** The index before and after the one move, one decimal; null without a move. */
  indexBefore: string | null;
  indexAfter: string | null;
  /** The same two readings as numbers, for the counter. */
  indexFrom: number | null;
  indexTo: number | null;
  /** The random-range sentence and where the plan sits against it. */
  rangeLine: string | null;
  timeline: SharedTimeline | null;
  ruleLine: string | null;
  /** The rule-check sentence beside the rule row; null when the card has no rule row. */
  limitsLine: string | null;
  /** Minutes the pair shares before and after, for the counter and the live region. */
  minutesBefore: number | null;
  minutesAfter: number | null;
  /** What "Open this move" keeps; null without a move. */
  seedMove: StackMove | null;
  /** "Sprints and Katy J Pearson share 30 minutes after this plan.": the receipt of a plan that is just that move. */
  moveReceipt: string | null;
  /** What "Try this rule yourself" searches; null when there is no rule line to try. */
  seedRule: { aId: string; bId: string } | null;
  /** What "Keep this change" keeps: line 3's change as one step of a plan; null without that change. */
  seedChange: RuleStackStep | null;
  /** The status line a kept change announces first, "Kept a change meant to keep A and B apart. Scoring your plan." */
  testingChange: string | null;
  /** What the Keep button's label says it keeps, "Keep the two-set change"; null without that change. */
  changeLabel: string | null;
  /** One line under the button saying what that change is and its index, visible on a phone; null without it. */
  changeSummary: string | null;
  /** The status line a seeded move announces first, "Testing Sprints at 14:15." */
  testing: string | null;
  /** The set the move moves, by name, for the words an Add or Replace says; null without a move. */
  moveAct: string | null;
  /**
   * What else the move changes, under the drawing: the other overlaps it starts or lengthens, from the published
   * timetable's own times ("Also: Sprints × Joy Crookes, new 15 min overlap."), or "No other overlap gets longer.".
   * Null without a move.
   */
  sideEffects: string | null;
  /** The move and the keep-apart change side by side; null unless the card has both. */
  tradeoff: Tradeoff | null;
};

function rangeOf(preset: Pick<Preset, "report">): ScaleRange {
  const { baseline } = preset.report;
  return baseline && baseline.p10_index !== null && baseline.p90_index !== null
    ? { low: baseline.p10_index, high: baseline.p90_index }
    : null;
}

const CANVAS = { left: 24, width: 240 } as const;

const QUARTER = 15;

/**
 * Published times scaled to the drawing: the axis runs from the quarter hour at or before the earliest
 * start to the quarter hour at or after the latest end, and that span fills 240 units.
 */
export function sharedTimeline(
  fixed: { name: string; start: number; end: number },
  moving: { name: string; start: number; end: number },
  after: { start: number; end: number },
): SharedTimeline | null {
  const all = [fixed, moving, after];
  const earliest = Math.min(...all.map((item) => item.start));
  const latest = Math.max(...all.map((item) => item.end));
  if (!(latest > earliest) || all.some((item) => !(item.end > item.start))) return null;
  const first = Math.floor(earliest / QUARTER) * QUARTER;
  const last = Math.ceil(latest / QUARTER) * QUARTER;
  const unit = CANVAS.width / (last - first);
  const x = (minute: number) => CANVAS.left + (minute - first) * unit;
  const bar = (item: { start: number; end: number }): TimelineBar => ({ x: x(item.start), w: (item.end - item.start) * unit });
  const band = (item: { start: number; end: number }): TimelineBar | null => {
    const window = overlapWindow(fixed, item);
    return window ? bar(window) : null;
  };
  // A hairline every quarter hour; a label only at :00 and :30, and dropped when it would sit within 44
  // units of the label before it (about one "14:00" in 12 px type), so long spans label every hour.
  const ticks: TimelineTick[] = [];
  let labelled: number | null = null;
  for (let minute = first; minute <= last; minute += QUARTER) {
    const at = x(minute);
    const major = (((minute % 30) + 30) % 30) === 0;
    const fits = major && (labelled === null || at - labelled >= 44);
    if (fits) labelled = at;
    ticks.push({ x: at, label: fits ? formatClock(minute) : "", major });
  }
  return {
    stayingName: fixed.name,
    movingName: moving.name,
    staying: bar(fixed),
    movingNow: bar(moving),
    bandNow: band(moving),
    movingAfter: bar(after),
    bandAfter: band(after),
    ticks,
  };
}

/**
 * The card's dateline: "Glastonbury 2025 · Sunday · published timetable", read from the festival's own
 * name and day (a " Festival" before the year is dropped, as a running order's masthead would). On an
 * invented day it names no festival: "Invented day · Sunday · invented timetable".
 */
export function decisionDateline(
  festival: { name: string; days: readonly string[] },
  dayLabel: string,
  synthetic = false,
): string {
  const day = dayName(dayLabel);
  if (synthetic) return `Invented day · ${day} · invented timetable`;
  const name = festivalName(festival).replace(/ Festival(?= \d{4}\b)/, "");
  return `${name} · ${day} · published timetable`;
}

/** Said under the drawing when the move starts or lengthens no other overlap. */
export const NO_OTHER_LONGER = "No other overlap gets longer.";

/**
 * What else one move changes, besides the pair it is for: every other set on the move's day whose overlap with
 * the moved set starts or gets longer, from the published times alone (timetable minutes, no index, no Qloo
 * figure), the largest change first. "Also: Sprints × Joy Crookes, new 15 min overlap." or "Also: Sprints ×
 * Joy Crookes, 10 → 25 min overlap; 1 more overlap gets longer." `NO_OTHER_LONGER` when none does.
 */
export function sideEffectsLine(
  timetable: readonly { act_id: string; day: number; start: number; end: number }[],
  names: ReadonlyMap<string, string>,
  mover: { actId: string; name: string; day: number; start: number; end: number },
  after: { day: number; start: number; end: number },
  partnerId: string,
): string {
  const minutes = (a: { day: number; start: number; end: number }, b: { day: number; start: number; end: number }) => {
    if (a.day !== b.day) return 0;
    const window = overlapWindow(a, b);
    return window ? window.end - window.start : 0;
  };
  const longer = timetable
    .filter((slot) => slot.act_id !== mover.actId && slot.act_id !== partnerId)
    .map((slot) => ({ name: names.get(slot.act_id) ?? slot.act_id, before: minutes(mover, slot), after: minutes(after, slot) }))
    .filter((item) => item.after > item.before)
    .sort((a, b) => b.after - b.before - (a.after - a.before) || a.name.localeCompare(b.name));
  if (longer.length === 0) return NO_OTHER_LONGER;
  const [first, ...rest] = longer;
  const change = first.before === 0 ? `new ${first.after} min overlap` : `${first.before} → ${first.after} min overlap`;
  const more = rest.length === 0 ? "" : `; ${rest.length} more ${rest.length === 1 ? "overlap gets" : "overlaps get"} longer`;
  return `Also: ${mover.name} × ${first.name}, ${change}${more}.`;
}

/**
 * The card for a decision on a preset, or null when there is nothing to show: no decision, no clash
 * in it, or a clash the preset's timetable does not hold. Every figure is the route's or the
 * report's.
 */
export function buildDecisionCopy(preset: Preset, decision: Decision | null): DecisionCopy | null {
  try {
    if (!decision || !decision.clash) return null;
    const { festival, report } = preset;
    const clash = decision.clash;
    const slots = new Map(festival.timetable.map((slot) => [slot.act_id, slot]));
    const acts = new Map(festival.acts.map((act) => [act.id, act]));
    const stages = new Map(festival.stages.map((stage) => [stage.id, stage.name]));
    const slotA = slots.get(clash.aId);
    const slotB = slots.get(clash.bId);
    const actA = acts.get(clash.aId);
    const actB = acts.get(clash.bId);
    if (!slotA || !slotB || !actA || !actB) return null;
    const stageOf = (slot: { stage_id: string }) => stages.get(slot.stage_id) ?? slot.stage_id;

    const dayLabel = festival.days[decision.day] ?? `Day ${decision.day + 1}`;
    const title = decisionDateline(festival, dayLabel, preset.synthetic === true);

    // Line 1: the clash. Taste overlap is a rank out of 100 on this bill, read from the report.
    const window = overlapWindow(slotA, slotB);
    const pair = topClashes(report.clashes, decision.day, Number.POSITIVE_INFINITY).find(
      (item) =>
        (item.a.act_id === clash.aId && item.b.act_id === clash.bId) ||
        (item.a.act_id === clash.bId && item.b.act_id === clash.aId),
    );
    const parts = [
      `The costliest clash with a set that has a legal place that lowers the index: ${actA.name} (${stageOf(slotA)}) and ${actB.name} (${stageOf(slotB)}) share ${pluralize(clash.minutes, "minute")}${window ? `, ${formatRange(window)}` : ""}.`,
    ];
    if (pair) {
      const taste = formatOverlap(pair.audience_overlap);
      parts.push(
        pair.label === "hidden"
          ? `Their main genre tags differ; their taste overlap is ${taste} of 100 on this bill, among its highest. It is a rank, not attendance.`
          : `Their taste overlap is ${taste} of 100 on this bill, a rank, not attendance.`,
      );
    }
    if (decision.skippedLocked > 0) {
      const n = decision.skippedLocked;
      parts.push(`The ${n} costlier ${n === 1 ? "clash is" : "clashes are"} between sets this app locks.`);
    }
    if (decision.skippedNoPlace > 0) {
      const n = decision.skippedNoPlace;
      parts.push(`${n === 1 ? "One costlier clash has" : `${pluralize(n, "costlier clash", "costlier clashes")} have`} no legal place that lowers the index.`);
    }
    const clashLine = parts.join(" ");

    // Line 2: the one move with the lowest index.
    const move = decision.move;
    const published = decision.publishedBudget;
    const range = rangeOf(preset);
    let moveLine = NO_MOVE;
    let receipt: string | null = null;
    let receiptLead: string | null = null;
    let indexBefore: string | null = null;
    let indexAfter: string | null = null;
    let rangeLine: string | null = null;
    let timeline: SharedTimeline | null = null;
    let seedMove: StackMove | null = null;
    let moveReceipt: string | null = null;
    let testing: string | null = null;
    let moveAct: string | null = null;
    let sideEffects: string | null = null;
    if (move && published !== null) {
      const other = move.actId === clash.aId ? actB : actA;
      const otherSlot = move.actId === clash.aId ? slotB : slotA;
      const moverSlot = slots.get(move.actId);
      receiptLead = `${move.act} ${shiftBrief(move)}`;
      receipt = `${receiptLead}: ${clash.minutes} → ${pluralize(move.minutesSharedAfter, "minute")} shared`;
      indexBefore = published.toFixed(1);
      indexAfter = move.budgetAfter.toFixed(1);
      const sentences = [
        `Move one set: of the ${pluralize(move.legalPlaces, "legal place")} on the 5-minute grid for ${move.act}, the one with the lowest index is ${move.stage} ${move.start}–${move.end} (${lowerFirst(shiftWords(move))}).`,
        `Time shared with ${other.name} goes from ${clash.minutes} to ${move.minutesSharedAfter} minutes and the index from ${indexBefore} to ${indexAfter}.`,
      ];
      if (move.alternative) {
        sentences.push(`Moving ${move.alternative.act} ${shiftBrief(move.alternative)} gives the same index to one decimal.`);
      }
      moveLine = sentences.join(" ");
      rangeLine = [rangeLead(range), planVerdict(move.budgetAfter, published, range)].filter(Boolean).join(" ") || null;
      const after = { start: clockMinutes(move.start), end: clockMinutes(move.end) };
      if (moverSlot && after.start !== null && after.end !== null && move.day === moverSlot.day && moverSlot.day === otherSlot.day) {
        timeline = sharedTimeline(
          { name: other.name, start: otherSlot.start, end: otherSlot.end },
          { name: move.act, start: moverSlot.start, end: moverSlot.end },
          { start: after.start, end: after.end > after.start ? after.end : after.end + 1440 },
        );
      }
      seedMove = { actId: move.actId, stageId: move.stageId, day: move.day, start: move.start };
      moveAct = move.act;
      if (moverSlot && after.start !== null && after.end !== null) {
        sideEffects = sideEffectsLine(
          festival.timetable,
          new Map(festival.acts.map((act) => [act.id, act.name])),
          { actId: move.actId, name: move.act, day: moverSlot.day, start: moverSlot.start, end: moverSlot.end },
          { day: move.day, start: after.start, end: after.end > after.start ? after.end : after.end + 1440 },
          otherSlot.act_id,
        );
      }
      moveReceipt = pairSharedReceipt(actA.name, actB.name, move.minutesSharedAfter);
      testing = `Testing ${move.act} at ${move.start}.`;
    }

    // Line 3: the rule. Absent when the route gave none, or the pair already shares nothing.
    const ruleLine = decision.rule ? ruleSentence(decision.rule, published) : null;
    const tryable = ruleLine !== null && decision.rule !== null && !(decision.rule.a.locked && decision.rule.b.locked);
    // The change line 3 describes (the first listed one), as one step a plan can keep.
    const change = tryable && decision.rule && decision.rule.fixes[0] ? fixStep(decision.rule, decision.rule.fixes[0]) : null;

    return {
      presetId: preset.id,
      day: decision.day,
      receipt,
      receiptLead,
      title,
      clashLine,
      moveLine,
      indexBefore,
      indexAfter,
      indexFrom: move && published !== null ? published : null,
      indexTo: move && published !== null ? move.budgetAfter : null,
      rangeLine,
      timeline,
      ruleLine,
      limitsLine: ruleLine ? LIMITS_WITH_RULE : LIMITS_NO_RULE,
      minutesBefore: move ? clash.minutes : null,
      minutesAfter: move ? move.minutesSharedAfter : null,
      seedMove,
      moveReceipt,
      seedRule: tryable ? { aId: clash.aId, bId: clash.bId } : null,
      seedChange: change,
      testingChange:
        change && decision.rule ? keptChangeAnnouncement(decision.rule.a.act, decision.rule.b.act) : null,
      changeLabel: change ? keepChangeLabel(change.moves.length) : null,
      changeSummary:
        change && decision.rule && decision.rule.fixes[0]
          ? changeSummaryLine(decision.rule, decision.rule.fixes[0], published)
          : null,
      testing,
      moveAct,
      sideEffects,
      tradeoff: buildTradeoff(decision),
    };
  } catch {
    return null;
  }
}
