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
import { COUNTS_ONLY } from "./credit";
import { pluralize } from "./format";
import { numberWord } from "./method-figures";
import {
  TRADEOFF_HEADING_ALONE,
  TRADEOFF_NOTE_BRIEF,
  buildDecisionCopy,
  type Decision,
  type Tradeoff,
} from "./decision";
import { currentPlacement } from "./moves";
import { planVerdict, publishedVerdict, raisesIndex } from "./plan-copy";
import type { BaselineStats, Preset } from "./preset";
import {
  isPlanRuleStep,
  isRuleStackStep,
  ruleReceipt,
  ruleStepLine,
  sameStep,
  shiftText,
  type Plan,
  type ScaleRange,
  type StackMove,
  type StackStep,
} from "./stack";
import { formatRange, overlapWindow } from "./timetable";

/** How many of the day's costliest clashes the brief's table lists. */
export const BRIEF_CLASHES = 5;

/** Under the table: what the Hidden mark means, in the words of the drawer and the legend. */
export const HIDDEN_NOTE =
  "Hidden clashes: the two acts’ main genre tags differ, but their taste overlap is among this lineup’s highest.";

/** Under the table, after the Hidden note. */
export const READING_NOTE = "A reading, not a verdict on the festival.";

/** Shown when the link carries no kept moves (or moves this page cannot read). */
export const NO_MOVES =
  "No moves kept. Use “Try a move” on the timetable page, keep a move, and open the brief from there.";

/** The line under the plan: what the page can and cannot help the reader decide. */
export const TO_DECIDE =
  "To decide: keep the published times, or make the moves above. This page shows what each does to the day’s clashes by this app’s measure; it does not weigh contracts, riders or stage fit.";

/** The "How to read this" block, in order. */
export const HOW_TO_READ: readonly string[] = [
  "Taste overlap is calculated by this app from Qloo data: how highly Qloo ranks each act for the other’s audience, as a rank among the acts compared for this bill, 0 to 100. It measures taste, not attendance.",
  "Combined draw is the two acts’ Qloo popularity, 0 to 100.",
  `The Clash Budget Index is 100 for the average random valid timetable of this lineup; lower is better. ${COUNTS_ONLY} It is a reading, not a verdict on the festival: real programming weighs much more than taste overlap.`,
];

/** The same block on an invented day: nothing here credits Qloo, because no Qloo request was made. */
export const HOW_TO_READ_SYNTHETIC: readonly string[] = [
  "Taste overlap here is an invented figure for an invented day: a rank among the acts compared for this bill, 0 to 100. It stands for no real audience.",
  "Combined draw is the two acts’ invented popularity, 0 to 100.",
  HOW_TO_READ[2],
];

/** The block for this day: the invented day's wording when the server serves one. */
export function howToRead(synthetic: boolean): readonly string[] {
  return synthetic ? HOW_TO_READ_SYNTHETIC : HOW_TO_READ;
}

/** Under the title: where the figures come from, for a published day and for the invented one. */
export function briefIntro(festival: string, synthetic: boolean): string {
  return synthetic
    ? "Scored by this app on an invented festival day, not a published timetable. No real festival is described."
    : `Scored by this app from the published timetable. ${festival} does not use Clash Control.`;
}

/** In place of the table when a day has no priced clash. */
export function noPricedClashes(synthetic: boolean): string {
  return synthetic
    ? "No priced clashes on this day: no two priced acts play at the same time."
    : "No priced clashes on this day: no two acts with a Qloo signal play at the same time.";
}

/**
 * The footer's attribution. A real day: figures calculated from the Qloo audience data saved on a date.
 * The invented day: said to be invented, with no Qloo request behind it. Then the independence line,
 * which names the festival only when it is a real one.
 */
export function figuresAttribution(preset: Pick<Preset, "built_at" | "synthetic">, festival: string): string {
  if (preset.synthetic === true) {
    return "Figures are calculated by this app from an invented day: its acts, times and figures are made up, and no Qloo request was made. This is an independent hackathon entry, not endorsed by Qloo. Prepared for visitors and judges of this demo; not for redistribution.";
  }
  const saved = savedDate(preset);
  return `${saved ? `Figures are calculated by this app from Qloo audience data saved ${saved}.` : "Figures are calculated by this app from saved Qloo audience data."} This is an independent hackathon entry, not endorsed by Qloo or ${festival}. Prepared for visitors and judges of this demo; not for redistribution.`;
}

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
  /** The middle 80% of random valid timetables of this lineup (10th to 90th percentile), or null. */
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
 * "The middle 80% of random valid timetables of this lineup score 92 to 109; the published
 * timetable reads above that range." The band in whole numbers and the verdict compared as printed
 * (`publishedVerdict` in `plan-copy.ts`, shared with the plan card). Null when the day has no band.
 */
export function bandSentence(index: number, range: ScaleRange): string | null {
  return publishedVerdict(index, range);
}

/** "Clash Budget Index 116.7.", or a plain statement that the day has none. */
export function indexSentence(index: number | null): string {
  return index === null
    ? "This day has no Clash Budget Index: the random timetables it is measured against could not be sampled."
    : `Clash Budget Index ${formatIndex(index)}.`;
}

/** "Taste overlap is priced for 36 of 39 sets; 3 have no usable Qloo signal and are not priced." */
export function coverageSentence(
  figures: Pick<DayFigures, "scored" | "total" | "unpriced">,
  synthetic = false,
): string {
  const { scored, total, unpriced } = figures;
  if (synthetic) {
    return unpriced === 0
      ? `Taste overlap is invented for all ${pluralize(total, "set")}.`
      : `Taste overlap is invented for ${scored} of ${pluralize(total, "set")}; ${unpriced === 1 ? "1 is" : `${unpriced} are`} not priced.`;
  }
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

/**
 * The table's heading: "The five costliest clashes", or "The costliest clash" when the day has one.
 * When the link carries kept moves the table still shows the unmoved day, so it says so: "The five
 * costliest clashes on the published day, before these moves".
 */
export function clashesTitle(count: number, withMoves = false): string {
  const base = count === 1 ? "The costliest clash" : `The ${numberWord(count)} costliest clashes`;
  return withMoves ? `${base} on the published day, before these moves` : base;
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
 * "2 kept moves: Clash Budget Index 116.7 → 106.6, 10.1 lower." ("kept steps" when the plan holds
 * a kept change from "Keep two sets apart"). Both readings and the change come from the plan
 * answer, compared to one decimal as the plan card does.
 */
export function planSummary(plan: Pick<Plan, "publishedBudget" | "budget" | "steps">): string {
  const count = plan.steps.length;
  const noun = plan.steps.some(isPlanRuleStep) ? "step" : "move";
  const delta = budgetDelta(plan.publishedBudget, plan.budget) ?? 0;
  const change = delta === 0 ? "no change" : changeLabel(delta);
  return `${count} kept ${count === 1 ? noun : `${noun}s`}: Clash Budget Index ${formatIndex(plan.publishedBudget)} → ${formatIndex(plan.budget)}, ${change}.`;
}

/** One kept change from "Keep two sets apart" as the plan card prints it: one numbered step. */
export type BriefRuleStep = {
  n: number;
  /** "Keep Sprints and Katy J Pearson apart: Sprints → The Park 15:00–16:00; Royel Otis → Woodsies 14:30–15:15". */
  line: string;
  /** The index before and after this step, one decimal. */
  before: string;
  after: string;
  raises: boolean;
  /** What the server says about the pair after the whole plan, as the plan card prints it. */
  receipt: string;
};

/** One kept move as the plan card prints it. */
export type BriefMoveStep = {
  n: number;
  act: string;
  /** "West Holts 20:30–21:30". */
  place: string;
  /** "30 minutes later, same stage" or "Moves to Other, 12:15". */
  shift: string;
  /** The index before and after this step, one decimal. */
  before: string;
  after: string;
  /** This step raised the index, compared as printed; the brief marks it " · raises the index". */
  raises: boolean;
  /** What the pair this move was made for shares after the plan, when the plan is just this move and the route priced it; else null. */
  receipt: string | null;
};

/** A step of the brief's plan: a single move or a kept change. */
export type BriefStep = BriefMoveStep | BriefRuleStep;

/** True for a kept change of the brief's plan. */
export function isBriefRuleStep(step: BriefStep): step is BriefRuleStep {
  return "line" in step;
}

/** "20:30-21:30" as the page prints a range: "20:30–21:30". */
function dashRange(start: string, end: string): string {
  return `${start}–${end}`;
}

/**
 * Printed lines a step takes at most. A single move is its heading and its shift line. A kept change is
 * its heading (two sets are named), the index line and the receipt: three lines in one column, and
 * about four and a half in half a column, where the same sentences wrap more.
 */
function stepLines(step: BriefStep, columns: 1 | 2): number {
  return isBriefRuleStep(step) ? (columns === 2 ? 4.5 : 3) : 2;
}

/**
 * A plan that takes this many printed lines or more down its tallest column shortens the published-day table to
 * three clashes. Measured with headless Chrome on Letter and A4: seven single moves with five rows ran to 99% of a
 * Letter page, and six to 97%, so the limit sits where the sheet keeps a margin.
 */
const HEAVY_PLAN_LINES = 4;

/** With the comparison on the sheet, a plan this tall leaves the published-day table off the printed page. */
const TALL_PLAN_LINES = 3;

/**
 * How many of the published day's costliest clashes the table lists. Five, unless the kept steps are so
 * long (two single moves in one column take four printed lines; four in two columns take four, and three long
 * two-set changes in one column take nine) that the sheet would run to the bottom of a page: then three, and
 * the heading says "three". `columns` is how many columns
 * the steps print in (two from four steps). With the side-by-side comparison on the sheet the table lists one
 * (the comparison names the day's costliest clash with a move and says what each change leaves of it); see `tableOnPaper`.
 */
export function tableClashes(steps: readonly BriefStep[], columns: 1 | 2, withTradeoff = false): number {
  const lines = steps.reduce((sum, step) => sum + stepLines(step, columns), 0);
  // The side-by-side comparison takes about sixteen printed lines of its own (its sentence under the heading,
  // seven rows, their notes and the non-verdict line), so the published day's table gives up all but one row.
  if (withTradeoff) return 1;
  return lines / columns >= HEAVY_PLAN_LINES ? 3 : BRIEF_CLASHES;
}

/**
 * Whether the plan's steps are so long on paper (four printed lines or more down the tallest column: two
 * single moves, or four in two columns) that the sheet gives up the list of hidden clashes too, which
 * the table's own marks repeat. It stays on the screen.
 */
export function heavyPlan(steps: readonly BriefStep[], columns: 1 | 2): boolean {
  const lines = steps.reduce((sum, step) => sum + stepLines(step, columns), 0);
  return lines / columns >= HEAVY_PLAN_LINES;
}

/**
 * Whether the published day's table is printed at all. With the comparison on the sheet, a plan that takes
 * three printed lines or more down its tallest column (one kept change, or a move and another step) leaves no
 * margin for it on a Letter or A4 page, and the comparison already names that clash. It stays on the screen.
 */
export function tableOnPaper(steps: readonly BriefStep[], columns: 1 | 2, withTradeoff = false): boolean {
  if (!withTradeoff) return true;
  const lines = steps.reduce((sum, step) => sum + stepLines(step, columns), 0);
  return lines / columns < TALL_PLAN_LINES;
}

/**
 * The plan's steps in order, each with where the set now plays, how far it moved from its
 * published place, and the index before and after it (the server's figures, never recomputed).
 */
export function briefSteps(
  preset: Pick<Preset, "festival">,
  plan: Pick<Plan, "publishedBudget" | "steps">,
  /** The card's move and its receipt, when the brief holds the decision (see `BriefTradeoff`). */
  card: { move: StackMove; receipt: string } | null = null,
): BriefStep[] {
  const stages = new Map(preset.festival.stages.map((stage) => [stage.id, stage.name]));
  const slots = new Map(preset.festival.timetable.map((slot) => [slot.act_id, slot]));
  return plan.steps.map((step, index): BriefStep => {
    const before = index === 0 ? plan.publishedBudget : plan.steps[index - 1].budgetAfter;
    if (isPlanRuleStep(step)) {
      return {
        n: index + 1,
        line: ruleStepLine(step),
        before: formatIndex(before),
        after: formatIndex(step.budgetAfter),
        raises: raisesIndex(before, step.budgetAfter),
        receipt: ruleReceipt(step),
      };
    }
    const from = currentPlacement(preset, step.actId);
    const fromStage = slots.get(step.actId)?.stage_id;
    return {
      n: index + 1,
      act: step.act,
      place: `${step.stage} ${dashRange(step.start, step.end)}`,
      shift: shiftText(from, step, fromStage ? (stages.get(fromStage) ?? fromStage) : ""),
      before: formatIndex(before),
      after: formatIndex(step.budgetAfter),
      raises: raisesIndex(before, step.budgetAfter),
      receipt:
        plan.steps.length === 1 && card && sameStep({ actId: step.actId, stageId: step.stageId, day: step.day, start: step.start }, card.move)
          ? card.receipt
          : null,
    };
  });
}

/**
 * Where the plan's index sits against the middle 80% of random valid timetables, with the band stated
 * in the same sentence because the plan is read before the day's own band: "The middle 80% of random
 * valid timetables of this lineup score 92 to 109; this plan scores 5.3 index points above that
 * range. The published timetable is 7.7 above it." When the plan's index is higher than the
 * published one, a plain sentence says so. Null without a band.
 */
export function planVerdictSentence(
  plan: Pick<Plan, "publishedBudget" | "budget">,
  range: ScaleRange,
): string | null {
  return planVerdict(plan.budget, plan.publishedBudget, range, { standalone: true });
}

/**
 * The heading over the moved timetable's own costliest clashes: "The five costliest clashes with
 * these moves", fewer when the plan answer lists fewer.
 */
export function planClashesTitle(count: number): string {
  if (count === 1) return "The costliest clash with these moves";
  if (count === 0) return "The costliest clashes with these moves";
  return `The ${numberWord(count)} costliest clashes with these moves`;
}

/**
 * The moved timetable's costliest clashes as the plan card lists them, numbered: "1. Act Two and
 * Act Three · 9.5 index points". Index points are the server's, one decimal.
 */
export function planClashLines(plan: Pick<Plan, "clashes">): string[] {
  return plan.clashes.map((clash, i) => `${i + 1}. ${clash.a} and ${clash.b} · ${clash.points.toFixed(1)} index points`);
}

// ------------------------------------------------------------------------------------ the trade-off

/**
 * The card's two changes side by side, and which of them the plan holds. `alone` is true when the plan holds
 * more than one step: the table's figures are each change tested alone on the published day, not what the
 * whole plan does, and the table says so. `moveReceipt` is the card's receipt for a plan that is just its move.
 */
export type BriefTradeoff = {
  tradeoff: Tradeoff;
  held: { move: boolean; change: boolean };
  alone: boolean;
  moveReceipt: { move: StackMove; receipt: string } | null;
};

/**
 * The decision card's comparison for the brief, only when the plan holds the card's move or the card's
 * change (the same two checks the card's buttons make); null otherwise, and for a card of another day.
 * The figures are the route's, through the card's own copy.
 */
export function briefTradeoff(
  preset: Preset,
  decision: Decision | null,
  steps: readonly StackStep[],
  day: number,
): BriefTradeoff | null {
  if (!decision || decision.day !== day) return null;
  const copy = buildDecisionCopy(preset, decision);
  if (!copy || !copy.tradeoff) return null;
  const { seedMove, seedChange } = copy;
  const held = {
    move: seedMove !== null && steps.some((step) => !isRuleStackStep(step) && sameStep(step, seedMove)),
    change: seedChange !== null && steps.some((step) => sameStep(step, seedChange)),
  };
  if (!held.move && !held.change) return null;
  const alone = steps.length > 1;
  return {
    tradeoff: {
      ...copy.tradeoff,
      heading: alone ? TRADEOFF_HEADING_ALONE : copy.tradeoff.heading,
      footnote: TRADEOFF_NOTE_BRIEF,
    },
    held,
    alone,
    moveReceipt: seedMove !== null && copy.moveReceipt !== null ? { move: seedMove, receipt: copy.moveReceipt } : null,
  };
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
