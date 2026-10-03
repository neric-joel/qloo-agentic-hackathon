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
import { lowerFirst, parseRuleFixes, ruleSentence, shiftBrief, shiftWords, type RuleFixes } from "./rule-fix";
import { isSafeId, type ScaleRange, type StackMove } from "./stack";
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

export type DecisionMove = DecisionPlace & {
  legalPlaces: number;
  stageChanged: boolean;
  /** The Clash Budget Index with this one move, as `POST /whatif` prices it. */
  budgetAfter: number;
  minutesSharedAfter: number;
  /** The other set's first place, when it gives the same index. */
  alternative: DecisionPlace | null;
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

    return { day: json.day, skippedLocked, skippedNoPlace, publishedBudget, clash, move, rule };
  } catch {
    return null;
  }
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
export const LIMITS_WITH_RULE =
  "Lines 1 and 2 are selected and scored by this app’s index. Line 3 is checked against the timetable’s rules; the index in it is shown for information, not as a verdict. A reading, not a verdict.";
export const LIMITS_NO_RULE = "Lines 1 and 2 are selected and scored by this app’s index. A reading, not a verdict.";

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
  ticks: { x: number; label: string }[];
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
  limitsLine: string;
  /** Minutes the pair shares before and after, for the counter and the live region. */
  minutesBefore: number | null;
  minutesAfter: number | null;
  /** What "Open this move" keeps; null without a move. */
  seedMove: StackMove | null;
  /** What "Try this rule yourself" searches; null when there is no rule line to try. */
  seedRule: { aId: string; bId: string } | null;
  /** The status line a seeded move announces first, "Testing Sprints at 14:15." */
  testing: string | null;
};

function rangeOf(preset: Pick<Preset, "report">): ScaleRange {
  const { baseline } = preset.report;
  return baseline && baseline.p10_index !== null && baseline.p90_index !== null
    ? { low: baseline.p10_index, high: baseline.p90_index }
    : null;
}

const CANVAS = { left: 24, width: 240 } as const;

/** Published times scaled to the drawing: the span of the three intervals fills 240 units. */
export function sharedTimeline(
  fixed: { name: string; start: number; end: number },
  moving: { name: string; start: number; end: number },
  after: { start: number; end: number },
): SharedTimeline | null {
  const all = [fixed, moving, after];
  const first = Math.min(...all.map((item) => item.start));
  const last = Math.max(...all.map((item) => item.end));
  if (!(last > first) || all.some((item) => !(item.end > item.start))) return null;
  const unit = CANVAS.width / (last - first);
  const x = (minute: number) => CANVAS.left + (minute - first) * unit;
  const bar = (item: { start: number; end: number }): TimelineBar => ({ x: x(item.start), w: (item.end - item.start) * unit });
  const band = (item: { start: number; end: number }): TimelineBar | null => {
    const window = overlapWindow(fixed, item);
    return window ? bar(window) : null;
  };
  // A label is dropped when it would sit within 44 units of the one before it (about one "14:00" in 12-unit type).
  const minutes = [...new Set(all.flatMap((item) => [item.start, item.end]))].sort((p, q) => p - q);
  const ticks: { x: number; label: string }[] = [];
  for (const minute of minutes) {
    const at = x(minute);
    if (ticks.length > 0 && at - ticks[ticks.length - 1].x < 44) continue;
    ticks.push({ x: at, label: formatClock(minute) });
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
    const title = `One decision on ${festivalName(festival)} ${dayName(dayLabel)}, published timetable`;

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
      parts.push(`The ${n} costlier ${n === 1 ? "clash is" : "clashes are"} between locked sets.`);
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
    let testing: string | null = null;
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
      testing = `Testing ${move.act} at ${move.start}.`;
    }

    // Line 3: the rule. Absent when the route gave none, or the pair already shares nothing.
    const ruleLine = decision.rule ? ruleSentence(decision.rule, published) : null;
    const tryable = ruleLine !== null && decision.rule !== null && !(decision.rule.a.locked && decision.rule.b.locked);

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
      seedRule: tryable ? { aId: clash.aId, bId: clash.bId } : null,
      testing,
    };
  } catch {
    return null;
  }
}
