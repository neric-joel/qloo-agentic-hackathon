/**
 * The one-page clash brief (`/brief`): a print view of one festival day on this site, for visitors
 * and judges of the demo. It is never a file, an email or something a festival is offered.
 *
 * Everything here is read from the preset the timetable page already loads (and, when moves were
 * kept, the plan answer of `POST /api/presets/{id}/whatif`) and printed through the page's own
 * formatters, so the brief shows the same figures the timetable page does. Nothing is recomputed,
 * and no Qloo tag, entity id, raw popularity value or matrix value is ever returned: taste overlap
 * and draw leave this module as numbers out of 100. Pure functions, so they are unit tested.
 */

import { budgetDelta, changeLabel } from "./agent-session";
import {
  dayName,
  festivalName,
  formatDraw,
  formatOverlap,
  formatShare,
  hostOf,
  isFixedByLocks,
  topClashes,
} from "./clashes";
import { pluralize } from "./format";
import { currentPlacement } from "./moves";
import type { BaselineStats, Preset } from "./preset";
import { rangeVerdict, shiftText, type Plan, type ScaleRange } from "./stack";
import { formatRange, overlapWindow } from "./timetable";

/** How many of the day's costliest clashes the brief's table lists. */
export const BRIEF_CLASHES = 5;

/** The plan card's caveat, word for word: a kept plan is graded by the measure that found it. */
export const PLAN_CAVEAT =
  "Scored by the same measure the places are found with, so a lower number shows what that measure rewards, not that audiences would be better served. It knows only the rules in the timetable, not an act’s own wishes.";

/** Under the table: what the Hidden mark means. */
export const HIDDEN_NOTE = "Hidden clashes: the two acts’ genres differ but their audiences overlap in taste.";

/** Shown when the link carries no kept moves (or moves this page cannot read). */
export const NO_MOVES =
  "No moves kept. Use “Try a move” on the timetable page, keep a move, and open the brief from there.";

/** The "How to read this" block, in order. */
export const HOW_TO_READ: readonly string[] = [
  "Taste overlap is calculated by this app from Qloo data: how highly Qloo ranks each act for the other’s audience, as a rank among this day’s acts, 0 to 100. It measures taste, not attendance.",
  "Combined draw is the two acts’ Qloo popularity, 0 to 100.",
  "The Clash Budget Index is 100 for the average random valid timetable of this lineup; lower is better; it counts taste-overlap cost only. It is a reading, not a verdict on the festival: real programming weighs much more than taste overlap.",
];

/** The Clash Budget Index as the brief prints it: one decimal, as the cards show it. */
export function formatIndex(value: number): string {
  return value.toFixed(1);
}

// ------------------------------------------------------------------------------------ the day

/** The brief's heading parts: the festival without its day, and the day in words. */
export function briefTitle(preset: Pick<Preset, "festival">, day: number): { festival: string; day: string } {
  const label = preset.festival.days[day] ?? `Day ${day + 1}`;
  return { festival: festivalName(preset.festival), day: dayName(label) };
}

export type DayFigures = {
  /** The day's Clash Budget Index as the report gives it; null when the day has none. */
  index: number | null;
  /** The range random valid timetables of this lineup score in, or null when unknown. */
  range: ScaleRange;
  /** Sets whose act has a usable Qloo signal, so its clashes are priced. */
  scored: number;
  /** Every set the coverage counts. */
  total: number;
  /** Sets with no usable Qloo signal, so not priced. */
  unpriced: number;
};

/** The baseline's 10th to 90th percentile, as the plan card and the dial use it. */
function baselineRange(baseline: BaselineStats | null): ScaleRange {
  return baseline && baseline.p10_index !== null && baseline.p90_index !== null
    ? { low: baseline.p10_index, high: baseline.p90_index }
    : null;
}

/** The day's index, its random range and Qloo coverage, straight from the preset's report. */
export function dayFigures(preset: Pick<Preset, "report">): DayFigures {
  const { metrics, baseline, coverage } = preset.report;
  return {
    index: metrics.clash_budget_index,
    range: baselineRange(baseline),
    scored: coverage.scored_acts,
    total: coverage.strong + coverage.weak + coverage.none,
    unpriced: coverage.none,
  };
}

/**
 * "Random valid timetables of this lineup score 92 to 109; the published timetable reads above that
 * range." The range in whole numbers and the verdict compared as printed (`rangeVerdict`). Null
 * when the day has no range.
 */
export function bandSentence(index: number, range: ScaleRange): string | null {
  const verdict = rangeVerdict(index, range);
  if (!range || !verdict) return null;
  return `Random valid timetables of this lineup score ${Math.round(range.low)} to ${Math.round(range.high)}; the published timetable reads ${verdict} that range.`;
}

/** "Clash Budget Index 116.7.", or a plain statement that the day has none. */
export function indexSentence(index: number | null): string {
  return index === null
    ? "This day has no Clash Budget Index: the random timetables it is measured against could not be sampled."
    : `Clash Budget Index ${formatIndex(index)}.`;
}

/** "Taste overlap is priced for 36 of 39 sets; 3 have no usable Qloo signal and are not priced." */
export function coverageSentence(figures: Pick<DayFigures, "scored" | "total" | "unpriced">): string {
  const { scored, total, unpriced } = figures;
  if (unpriced === 0) return `Taste overlap is priced for all ${pluralize(total, "set")}.`;
  const rest = unpriced === 1 ? "1 has no usable Qloo signal and is not priced" : `${unpriced} have no usable Qloo signal and are not priced`;
  return `Taste overlap is priced for ${scored} of ${pluralize(total, "set")}; ${rest}.`;
}

// ------------------------------------------------------------------------------------ clashes

/** One row of the brief's table, every value already formatted as the timetable page prints it. */
export type BriefRow = {
  /** The clash's rank among the day's priced clashes. */
  rank: number;
  a: string;
  b: string;
  stageA: string;
  stageB: string;
  /** The minutes the two sets share, "20:15–21:00", or null when a set's times are missing. */
  window: string | null;
  minutes: number;
  /** Taste overlap out of 100, "99". */
  overlap: string;
  /** Combined draw out of 100, "89". */
  draw: string;
  /** Share of the day's clash cost, "3.5%". */
  share: string;
  hidden: boolean;
  /** Both sets are locked, so no move can touch this clash. */
  bothLocked: boolean;
};

/** The day's costliest clashes, costliest first, with names, stages, times and figures. */
export function briefRows(preset: Pick<Preset, "festival" | "report">, day: number, limit = BRIEF_CLASHES): BriefRow[] {
  const { festival, report } = preset;
  const slots = new Map(festival.timetable.map((slot) => [slot.act_id, slot]));
  const stages = new Map(festival.stages.map((stage) => [stage.id, stage.name]));
  const isLocked = (actId: string) => slots.get(actId)?.locked === true;
  return topClashes(report.clashes, day, limit).map((clash) => {
    const a = slots.get(clash.a.act_id);
    const b = slots.get(clash.b.act_id);
    const window = a && b ? overlapWindow(a, b) : null;
    return {
      rank: clash.rank,
      a: clash.a.name,
      b: clash.b.name,
      stageA: stages.get(clash.a.stage_id) ?? clash.a.stage_id,
      stageB: stages.get(clash.b.stage_id) ?? clash.b.stage_id,
      window: window ? formatRange(window) : null,
      minutes: clash.overlap_minutes,
      overlap: formatOverlap(clash.audience_overlap),
      draw: formatDraw(clash.draw),
      share: formatShare(clash.regret_share),
      hidden: clash.label === "hidden",
      bothLocked: isFixedByLocks(clash, isLocked),
    };
  });
}

/** The day's ranked clashes labelled hidden, costliest first, as "A and B". */
export function hiddenNames(preset: Pick<Preset, "report">, day: number): string[] {
  return topClashes(preset.report.clashes, day, Number.POSITIVE_INFINITY)
    .filter((clash) => clash.label === "hidden")
    .map((clash) => `${clash.a.name} and ${clash.b.name}`);
}

/** "5 of this day's ranked clashes are hidden clashes: A and B; C and D." Null when none. */
export function hiddenSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const list = names.join("; ");
  return names.length === 1
    ? `1 of this day’s ranked clashes is a hidden clash: ${list}.`
    : `${names.length} of this day’s ranked clashes are hidden clashes: ${list}.`;
}

// ------------------------------------------------------------------------------------ the plan

/**
 * "2 kept moves: Clash Budget Index 116.7 → 106.6, 10.1 lower." Both readings and the change come
 * from the plan answer, compared to one decimal as the plan card does.
 */
export function planSummary(plan: Pick<Plan, "publishedBudget" | "budget" | "steps">): string {
  const count = plan.steps.length;
  const delta = budgetDelta(plan.publishedBudget, plan.budget) ?? 0;
  const change = delta === 0 ? "no change" : changeLabel(delta);
  return `${count} kept ${count === 1 ? "move" : "moves"}: Clash Budget Index ${formatIndex(plan.publishedBudget)} → ${formatIndex(plan.budget)}, ${change}.`;
}

/** One kept move as the plan card prints it. */
export type BriefStep = {
  n: number;
  act: string;
  /** "West Holts 20:30–21:30". */
  place: string;
  /** "30 minutes later, same stage" or "Moves to Other, 12:15". */
  shift: string;
  /** The index before and after this step, one decimal. */
  before: string;
  after: string;
};

/** "20:30-21:30" as the page prints a range: "20:30–21:30". */
function dashRange(start: string, end: string): string {
  return `${start}–${end}`;
}

/**
 * The plan's steps in order, each with where the set now plays, how far it moved from its
 * published place, and the index before and after it (the server's figures, never recomputed).
 */
export function briefSteps(preset: Pick<Preset, "festival">, plan: Pick<Plan, "publishedBudget" | "steps">): BriefStep[] {
  const stages = new Map(preset.festival.stages.map((stage) => [stage.id, stage.name]));
  const slots = new Map(preset.festival.timetable.map((slot) => [slot.act_id, slot]));
  return plan.steps.map((step, index) => {
    const from = currentPlacement(preset, step.actId);
    const fromStage = slots.get(step.actId)?.stage_id;
    const before = index === 0 ? plan.publishedBudget : plan.steps[index - 1].budgetAfter;
    return {
      n: index + 1,
      act: step.act,
      place: `${step.stage} ${dashRange(step.start, step.end)}`,
      shift: shiftText(from, step, fromStage ? (stages.get(fromStage) ?? fromStage) : ""),
      before: formatIndex(before),
      after: formatIndex(step.budgetAfter),
    };
  });
}

// ------------------------------------------------------------------------------------ the footer

/** The day the preset's Qloo data was saved, "2026-10-03", or null when it is not known. */
export function savedDate(preset: Pick<Preset, "built_at">): string | null {
  const date = preset.built_at?.slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** The timetable sources' hosts, each once, in the order the preset lists them. */
export function sourceHosts(preset: Pick<Preset, "sources">): string[] {
  return [...new Set(preset.sources.map((source) => hostOf(source.url)))];
}
