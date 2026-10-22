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
import { lockRuleHolds, lockRuleLine, type LockSlot } from "./locks";
import { clockMinutes, currentPlacement } from "./moves";
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
import { formatClock, formatRange, overlapWindow, timeDomain } from "./timetable";

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

/** In place of the table when a day has no scored clash ("scored", as the index is, round 33). */
export function noPricedClashes(synthetic: boolean): string {
  return synthetic
    ? "No scored clashes on this day: no two scored acts play at the same time."
    : "No scored clashes on this day: no two acts with a Qloo signal play at the same time.";
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

/** "Taste overlap is scored for 36 of 39 sets; 3 have no usable Qloo signal and are not scored." */
export function coverageSentence(
  figures: Pick<DayFigures, "scored" | "total" | "unpriced">,
  synthetic = false,
): string {
  const { scored, total, unpriced } = figures;
  if (synthetic) {
    return unpriced === 0
      ? `Taste overlap is invented for all ${pluralize(total, "set")}.`
      : `Taste overlap is invented for ${scored} of ${pluralize(total, "set")}; ${unpriced === 1 ? "1 is" : `${unpriced} are`} not scored.`;
  }
  if (unpriced === 0) return `Taste overlap is scored for all ${pluralize(total, "set")}.`;
  const rest = unpriced === 1 ? "1 has no usable Qloo signal and is not scored" : `${unpriced} have no usable Qloo signal and are not scored`;
  return `Taste overlap is scored for ${scored} of ${pluralize(total, "set")}; ${rest}.`;
}

/** The brief's heading after the festival and the day: "Glastonbury Festival 2025 Sunday: where the clashes fall". */
export const BRIEF_HEADING_TAIL = "where the clashes fall";

/**
 * Under the published day's table: the pair that taste overlap lowers furthest among the day's costliest on time and
 * draw (`otherHalfPair` in the taste lens, from the same saved lens lists the home page reads), as a candidate to
 * keep. Ranks only: it says nothing about how many people the pair shares. On the invented day it says so, and it
 * credits no source on either day.
 */
export function candidateLine(
  pair: { readonly a: string; readonly b: string; readonly from: number; readonly to: number },
  synthetic = false,
): string {
  const lead = synthetic ? "On this invented day, taste also lowers" : "Taste also lowers";
  return `${lead}: ${pair.a} × ${pair.b} ranks #${pair.from} on time and draw, #${pair.to} with taste: a candidate to keep.`;
}

/**
 * Beside each kept move, on paper only: what the head of programming decided about it, to circle, and a line for
 * their initials. Never a verdict of the page's own.
 */
export const DECISION_CHOICES = "Decision: move / keep as published / kept on purpose";
export const DECISION_INITIALS = "Initials:";

// ------------------------------------------------------------------------------------ shared minutes

/** One set's place as the minutes count it: the day, the stage and the time in minutes from the day's start. */
type MinutePlace = { day: number; stage: string; start: number; end: number };

/** Minutes two sets play at once: only on the same day and on different stages, as the index counts them. */
function minutesShared(a: MinutePlace | undefined, b: MinutePlace | undefined): number {
  if (!a || !b || a.day !== b.day || a.stage === b.stage) return 0;
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export type SharedMinutes = {
  /** How many clashes the fixed set holds: the published day's ranked clashes, as the home page counts them. */
  ranked: number;
  /** Minutes those pairs share on the published timetable, and with the plan. */
  before: number;
  after: number;
  /**
   * Every other pair of sets: the minutes of new or longer overlap the plan adds (each pair's increase, summed), and
   * the pair with the largest increase; null when no overlap outside the set gets longer.
   */
  outside: { added: number; longest: { a: string; b: string; minutes: number } | null };
};

/**
 * Timetable minutes before and after a plan, over ONE fixed set of pairs: the published day's ranked clashes (the
 * same list, and so the same count, as the home page's "5 of the 15 ranked clashes"). Because a plan can also move a
 * set into a new overlap, the pairs outside that set are counted too, as the minutes of new or longer overlap the
 * plan adds. Minutes of the timetable only: no attendance, people or money. Null when the day has no ranked clash or
 * a step's times cannot be read.
 */
export function sharedMinutes(
  preset: Pick<Preset, "festival" | "report">,
  day: number,
  plan: Pick<Plan, "steps">,
): SharedMinutes | null {
  const ranked = topClashes(preset.report.clashes, day, Number.POSITIVE_INFINITY);
  if (ranked.length === 0) return null;
  const published = new Map<string, MinutePlace>(
    preset.festival.timetable.map((slot) => [
      slot.act_id,
      { day: slot.day, stage: slot.stage_id, start: slot.start, end: slot.end },
    ]),
  );
  const moved = new Map(published);
  for (const step of plan.steps) {
    for (const place of isPlanRuleStep(step) ? step.moves : [step]) {
      const start = clockMinutes(place.start);
      const end = clockMinutes(place.end);
      if (start === null || end === null || end <= start) return null;
      moved.set(place.actId, { day: place.day, stage: place.stageId, start, end });
    }
  }
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const inSet = new Set(ranked.map((clash) => key(clash.a.act_id, clash.b.act_id)));
  let before = 0;
  let after = 0;
  for (const clash of ranked) {
    before += minutesShared(published.get(clash.a.act_id), published.get(clash.b.act_id));
    after += minutesShared(moved.get(clash.a.act_id), moved.get(clash.b.act_id));
  }
  // Only a pair with a moved set can change: each moved set against every other set, each pair once.
  const names = new Map(preset.festival.acts.map((act) => [act.id, act.name]));
  const movedIds = [...moved.keys()].filter((id) => moved.get(id) !== published.get(id));
  const seen = new Set<string>();
  let added = 0;
  let longest: SharedMinutes["outside"]["longest"] = null;
  for (const id of movedIds) {
    for (const other of published.keys()) {
      const pair = key(id, other);
      if (other === id || inSet.has(pair) || seen.has(pair)) continue;
      seen.add(pair);
      const gain = minutesShared(moved.get(id), moved.get(other)) - minutesShared(published.get(id), published.get(other));
      if (gain <= 0) continue;
      added += gain;
      if (!longest || gain > longest.minutes) {
        longest = { a: names.get(id) ?? id, b: names.get(other) ?? other, minutes: gain };
      }
    }
  }
  return { ranked: ranked.length, before, after, outside: { added, longest } };
}

/**
 * "Shared minutes in the published day’s 15 ranked clashes: 640 → 610 with your plan. Outside them, the plan adds
 * 15 min of new or longer overlap (longest: A × B, 15 min)." The outside clause is always said, so the subtotal is
 * never read as the plan's whole effect on the timetable.
 */
export function sharedMinutesSentence(minutes: SharedMinutes): string {
  const one = minutes.ranked === 1;
  const set = one ? "the published day’s one ranked clash" : `the published day’s ${minutes.ranked} ranked clashes`;
  const lead = `Shared minutes in ${set}: ${minutes.before} → ${minutes.after} with your plan.`;
  const where = one ? "Outside it" : "Outside them";
  const { added, longest } = minutes.outside;
  const outside = longest
    ? `${where}, the plan adds ${added} min of new or longer overlap (longest: ${longest.a} × ${longest.b}, ${longest.minutes} min).`
    : `${where}, no overlap gets longer.`;
  return `${lead} ${outside}`;
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

/**
 * The table's caption for screen readers: its title, "on this day" without a plan, and "costliest first" only
 * when there are two rows or more to order.
 */
export function clashesCaption(count: number, withMoves = false): string {
  const title = clashesTitle(count, withMoves);
  const where = withMoves ? title : `${title} on this day`;
  return count >= 2 ? `${where}, costliest first` : where;
}

/** Said in a change's cell when it moves a set to another stage: the brief does not weigh stage fit. */
export const STAGE_SIGN_OFF = "needs production sign-off";

/**
 * "changes stage: needs production sign-off" for one set, "both change stage: …" or "two change stage: …" for more,
 * from how many of the change's `sets` move to another stage; null when none does.
 */
export function stageChangeText(stageChanges: number, sets: number): string | null {
  if (!(stageChanges > 0)) return null;
  const who =
    sets === 1 && stageChanges === 1
      ? "changes stage"
      : stageChanges === sets
        ? `${sets === 2 ? "both" : "all"} change stage`
        : `${numberWord(stageChanges)} ${stageChanges === 1 ? "changes" : "change"} stage`;
  return `${who}: ${STAGE_SIGN_OFF}`;
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

/** What the printed sheet gives of the published day: the table's rows and whether the hidden list is on paper. */
export type PrintedBaseline = { rows: number; hiddenListed: boolean };

/**
 * The published day's baseline on paper when the sheet leaves part of it off. With no table on paper it is the
 * day's costliest clash (index points as the plan's clash list prints them) and how many more the full list on
 * the timetable page holds; with a shortened table it says how many clashes are not listed. Hidden clashes that are
 * in neither a printed row nor the printed list are counted too. Null when the whole ranked list is on paper.
 */
export function baselineNote(
  preset: Pick<Preset, "report">,
  day: number,
  printed: PrintedBaseline,
): string | null {
  const ranked = topClashes(preset.report.clashes, day, Number.POSITIVE_INFINITY);
  const first = ranked[0];
  if (!first) return null;
  // With no table on paper the costliest clash is named in the line itself, so "more" counts the others.
  const listed = Math.max(printed.rows, 1);
  const rest = ranked.length - listed;
  if (rest <= 0) return null;
  const hiddenOff = printed.hiddenListed
    ? 0
    : ranked.slice(listed).filter((clash) => clash.label === "hidden").length;
  const hiddenText = hiddenOff === 0 ? "" : ` (${hiddenOff} hidden)`;
  if (printed.rows === 0) {
    const index = preset.report.metrics.clash_budget_index;
    const points = index === null ? "" : `, ${(first.regret_share * index).toFixed(1)} index points`;
    const kind = first.label === "hidden" ? ", a hidden clash" : "";
    return `Published day before these moves: costliest ${first.a.name} and ${first.b.name}${kind}${points}; ${rest} more on the timetable page${hiddenText}.`;
  }
  return `${rest === 1 ? "1 more clash of the published day is" : `${rest} more clashes of the published day are`} not listed here${hiddenText}; the full list is on the timetable page.`;
}

/**
 * One line when the comparison's pair is not the published day's costliest pair (a costlier clash is between
 * locked sets, or no set of theirs has a legal place that lowers the index), so the two are not confused.
 */
export function comparisonPairNote(
  preset: Pick<Preset, "festival" | "report">,
  decision: Pick<Decision, "clash" | "day">,
): string | null {
  if (!decision.clash) return null;
  const first = topClashes(preset.report.clashes, decision.day, 1)[0];
  if (!first) return null;
  const { aId, bId } = decision.clash;
  const same =
    (first.a.act_id === aId && first.b.act_id === bId) || (first.a.act_id === bId && first.b.act_id === aId);
  if (same) return null;
  const names = new Map(preset.festival.acts.map((act) => [act.id, act.name]));
  const a = names.get(aId);
  const b = names.get(bId);
  if (!a || !b) return null;
  return `The comparison is about ${a} and ${b}, the costliest clash with a set that can move. The published day’s costliest clash is ${first.a.name} and ${first.b.name}.`;
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
 * When the drawing of the day prints beside the comparison, it takes the table's room: the drawing shows that
 * clash, the comparison says what each change leaves of it, and the baseline line names it.
 */
export function tableOnPaper(
  steps: readonly BriefStep[],
  columns: 1 | 2,
  withTradeoff = false,
  withFigure = false,
): boolean {
  if (!withTradeoff) return true;
  if (withFigure && steps.length > 0) return false;
  const lines = steps.reduce((sum, step) => sum + stepLines(step, columns), 0);
  return lines / columns < TALL_PLAN_LINES;
}

/**
 * Which of the plan's extras the printed sheet keeps: the shared-minutes line, always (since round 37 it leads the
 * plan, above the index line, so it never leaves paper), and the per-step decision lines.
 */
export type PaperExtras = { minutes: true; decisions: boolean };

/**
 * The most printed lines of steps, in one column, with which the drawing of the day prints: one single move. A
 * longer plan keeps the drawing on the screen only, so the sheet stays one page.
 */
const FIGURE_PAPER_LINES = 2;

/**
 * Whether the drawing of the day prints. Always on a sheet with no kept step, which has room for it. With kept steps
 * only for one single move beside the comparison, where it takes the room of the published day's one-row table (see
 * `tableOnPaper`): the drawing shows that clash. Every other plan keeps it on the screen, and a single move with no
 * comparison keeps its five rows and its hidden list on paper. Measured with headless Chrome on Letter and A4 (print
 * media, 10 mm margins) on both published days.
 */
export function figureOnPaper(steps: readonly BriefStep[], columns: 1 | 2, withTradeoff = false): boolean {
  if (steps.length === 0) return true;
  const lines = steps.reduce((sum, step) => sum + stepLines(step, columns), 0) / columns;
  return withTradeoff && columns === 1 && lines <= FIGURE_PAPER_LINES;
}

/** The most printed lines of steps (a kept change counting one more) that leave room for the decision lines in one column. */
const DECISIONS_PAPER_LINES = 8;

/**
 * What a full sheet leaves off paper, so it stays one Letter and one A4 page without smaller type or a dropped
 * caveat. Never the shared-minutes line: it leads the plan (round 37). Only the decision lines, which the screen never
 * shows. In one column a decision line sits beside its step's first line, so it costs no line for a single move and
 * one for a kept change, whose long first line wraps around it; that line is counted with the steps. In two columns
 * each takes two lines under its step. The decision lines print in one column for at most eight printed lines of
 * steps, and in two columns for at most four lines down each column (four single moves).
 *
 * Measured with headless Chrome on Letter and A4 (print media, 10 mm margins) at the round-37 type (running text
 * 10 pt, the rest at least 9.5 pt), with the minutes line on every plan: 24 sheets on both published days, from no
 * kept step to eight kept moves, kept changes with moves, and the card's move with and without other steps. The
 * fullest, the card's single move with its comparison and the drawing, fills 97.0% of a Letter page.
 */
export function onPaper(steps: readonly BriefStep[], columns: 1 | 2): PaperExtras {
  const lines = steps.reduce((sum, step) => sum + stepLines(step, columns), 0) / columns;
  if (columns === 2) return { minutes: true, decisions: lines <= HEAVY_PLAN_LINES };
  const counted = lines + steps.filter(isBriefRuleStep).length;
  return { minutes: true, decisions: counted <= DECISIONS_PAPER_LINES };
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
 * range. By this index, the published timetable sits 7.7 points above that range." When the plan's index is higher than the
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
  /** Said under the table when its pair is not the published day's costliest pair; else null. */
  pairNote: string | null;
  /** The card's clash, by act id: the pair its move and its change are made for. */
  pair: { aId: string; bId: string } | null;
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
  // A change that moves a set to another stage says so in its "Sets moved" cell: the brief does not weigh stage fit,
  // so the stage change is named for production to sign off.
  const first = decision.rule?.fixes[0];
  const ruleStage = first ? stageChangeText(first.stageChanges, first.setsMoved) : null;
  const moveStage = decision.move?.stageChanged ? stageChangeText(1, 1) : null;
  const withStage = (cell: string, note: string | null) => (note ? `${cell}; ${note}` : cell);
  return {
    tradeoff: {
      ...copy.tradeoff,
      // The brief does not weigh stage fit (TO_DECIDE says so), so it prints no stage-fit row; the card keeps it.
      rows: copy.tradeoff.rows
        .filter((row) => row.id !== "flags")
        .map((row) =>
          row.id === "sets" ? { ...row, move: withStage(row.move, moveStage), rule: withStage(row.rule, ruleStage) } : row,
        ),
      heading: alone ? TRADEOFF_HEADING_ALONE : copy.tradeoff.heading,
      footnote: TRADEOFF_NOTE_BRIEF,
    },
    held,
    alone,
    moveReceipt: seedMove !== null && copy.moveReceipt !== null ? { move: seedMove, receipt: copy.moveReceipt } : null,
    pairNote: comparisonPairNote(preset, decision),
    pair: decision.clash ? { aId: decision.clash.aId, bId: decision.clash.bId } : null,
  };
}

// ------------------------------------------------------------------------------------ the locks

/**
 * The one lock line under the published day's table, printed once and only when a row it shows is marked "both
 * locked": the rule (`lockRuleLine`) where `lockRuleHolds` proves it on the day's slots, else the generic words.
 * Null on the invented day and when no shown row is locked at both ends.
 */
export function briefLockLine(
  preset: Pick<Preset, "festival" | "synthetic">,
  day: number,
  rows: readonly Pick<BriefRow, "bothLocked">[],
): string | null {
  if (!rows.some((row) => row.bothLocked)) return null;
  const slots: LockSlot[] = preset.festival.timetable
    .filter((slot) => slot.day === day)
    .map((slot) => ({ stage: slot.stage_id, day: slot.day, start: slot.start, end: slot.end, locked: slot.locked === true }));
  return lockRuleLine({ synthetic: preset.synthetic === true, holds: lockRuleHolds(slots) });
}

// ------------------------------------------------------------------------------------ the day, drawn

/** One set in the brief's drawing, where the sheet leaves it: minutes from the day's midnight, on its stage's lane. */
export type FigureSet = {
  actId: string;
  name: string;
  lane: number;
  start: number;
  end: number;
  /** A kept step moved it. */
  moved: boolean;
  /** Named in the drawing: a set the sheet already names in its first lines. */
  named: boolean;
};

/** A kept step's set at its published place, drawn as a dashed outline. */
export type FigureGhost = { actId: string; lane: number; start: number; end: number };

/** The minutes two sets share, hatched on each of their two bars. */
export type FigureHatch = { aId: string; bId: string; start: number; end: number };

export type BriefFigure = {
  /** "plan": the day as the kept steps leave it; "published": the day as published. */
  kind: "plan" | "published";
  /** One lane per stage with a set on the day, in festival order. */
  stages: { id: string; name: string }[];
  /** The whole hours drawn: from the hour of the first start to the hour after the last end. */
  domain: { start: number; end: number };
  sets: FigureSet[];
  ghosts: FigureGhost[];
  hatches: FigureHatch[];
  /** The line under the drawing. Its first sentence is the drawing's title and the rest its description. */
  caption: string;
  title: string;
  desc: string;
};

type FigurePlace = { day: number; stage: string; start: number; end: number };

/** Minutes two places share: the same day, different stages, as the index counts them. */
function sharedWindow(a: FigurePlace | undefined, b: FigurePlace | undefined): { start: number; end: number } | null {
  if (!a || !b || a.day !== b.day || a.stage === b.stage) return null;
  return overlapWindow(a, b);
}

/** "A", "A and B", "A, B and C". */
function andNames(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The brief's day as one static picture: every set on its stage's lane at the time the kept steps leave it, each
 * kept step's published slot (dashed) and the minutes its set still shares with the partner the sheet names
 * (hatched); with no kept step, the day as published with the costliest clash's shared minutes hatched.
 *
 * Only the sets the sheet already names in its first lines are named: each kept single move's set; its partner when
 * the move is the card's (its receipt or the comparison names the pair); both sets of a kept change's pair and every
 * set the change moves; and the longest new overlap the minutes line names. A single move that is not the card's
 * names no partner, so it hatches nothing. With no kept step: the costliest clash's two sets, the table's first row.
 * Minutes from the published timetable and the plan's places only: no score, no attendance. Null when the day has no
 * set or a step's times cannot be read.
 */
export function briefFigure(
  preset: Pick<Preset, "festival" | "report">,
  day: number,
  dayLabel: string,
  plan: Pick<Plan, "steps"> | null,
  options: {
    /** The card's clash (`BriefTradeoff.pair`), when the sheet holds the comparison. */
    pair?: { aId: string; bId: string } | null;
    /** The plan's shared minutes (`sharedMinutes`), for the longest new overlap it names. */
    minutes?: SharedMinutes | null;
  } = {},
): BriefFigure | null {
  const { festival, report } = preset;
  const names = new Map(festival.acts.map((act) => [act.id, act.name]));
  const published = new Map<string, FigurePlace>(
    festival.timetable.map((slot) => [slot.act_id, { day: slot.day, stage: slot.stage_id, start: slot.start, end: slot.end }]),
  );
  const placed = new Map(published);
  const named = new Set<string>();
  const pairs: { a: string; b: string; kind: "move" | "rule" }[] = [];
  const steps = plan?.steps ?? [];

  for (const step of steps) {
    const places = isPlanRuleStep(step) ? step.moves : [step];
    for (const place of places) {
      const start = clockMinutes(place.start);
      const end = clockMinutes(place.end);
      if (start === null || end === null || end <= start) return null;
      placed.set(place.actId, { day: place.day, stage: place.stageId, start, end });
      named.add(place.actId);
    }
    if (isPlanRuleStep(step)) {
      named.add(step.rule.a.actId).add(step.rule.b.actId);
      pairs.push({ a: step.rule.a.actId, b: step.rule.b.actId, kind: "rule" });
    } else if (options.pair && (options.pair.aId === step.actId || options.pair.bId === step.actId)) {
      const partner = options.pair.aId === step.actId ? options.pair.bId : options.pair.aId;
      named.add(partner);
      pairs.push({ a: step.actId, b: partner, kind: "move" });
    }
  }

  const onDay = [...placed].filter(([, place]) => place.day === day);
  if (onDay.length === 0) return null;
  const moved = new Set(
    [...placed.keys()].filter((id) => {
      const before = published.get(id);
      const after = placed.get(id);
      return !before || !after || before.day !== after.day || before.stage !== after.stage || before.start !== after.start;
    }),
  );

  const kind = steps.length > 0 ? "plan" : "published";
  if (kind === "plan") {
    // The minutes line names its longest new overlap, "A × B": both sets by name.
    const longest = options.minutes?.outside.longest;
    if (longest) {
      for (const name of [longest.a, longest.b]) {
        const id = onDay.find(([actId]) => names.get(actId) === name)?.[0];
        if (id) named.add(id);
      }
    }
  } else {
    const first = topClashes(report.clashes, day, 1)[0];
    if (first) {
      named.add(first.a.act_id).add(first.b.act_id);
      pairs.push({ a: first.a.act_id, b: first.b.act_id, kind: "rule" });
    }
  }

  const ghosts: FigurePlace[] = [];
  const ghostIds: string[] = [];
  for (const id of moved) {
    const before = published.get(id);
    if (before && before.day === day) {
      ghosts.push(before);
      ghostIds.push(id);
    }
  }

  const used = new Set([...onDay.map(([, place]) => place.stage), ...ghosts.map((place) => place.stage)]);
  const stages = festival.stages.filter((stage) => used.has(stage.id)).map((stage) => ({ id: stage.id, name: stage.name }));
  const laneOf = new Map(stages.map((stage, index) => [stage.id, index]));
  const domain = timeDomain([...onDay.map(([, place]) => place), ...ghosts], 60);

  const hatches: FigureHatch[] = [];
  const hatched: { a: string; b: string; kind: "move" | "rule" }[] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = pair.a < pair.b ? `${pair.a}|${pair.b}` : `${pair.b}|${pair.a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const window = sharedWindow(placed.get(pair.a), placed.get(pair.b));
    if (!window || placed.get(pair.a)?.day !== day) continue;
    hatches.push({ aId: pair.a, bId: pair.b, start: window.start, end: window.end });
    hatched.push(pair);
  }

  const sets: FigureSet[] = onDay
    .filter(([, place]) => laneOf.has(place.stage))
    .map(([actId, place]) => ({
      actId,
      name: names.get(actId) ?? actId,
      lane: laneOf.get(place.stage) ?? 0,
      start: place.start,
      end: place.end,
      moved: moved.has(actId),
      named: named.has(actId),
    }))
    .sort((p, q) => p.lane - q.lane || p.start - q.start);

  const nameOf = (id: string) => names.get(id) ?? id;
  const sentences: string[] = [];
  if (kind === "published") {
    sentences.push(`${dayLabel}, as published.`);
    if (hatches.length > 0) sentences.push("Hatched: minutes shared by the costliest clash.");
  } else {
    sentences.push(`${dayLabel}, as your plan leaves it.`);
    const [only] = hatched;
    if (hatched.length === 1 && only.kind === "move") sentences.push(`Hatched: minutes shared with ${nameOf(only.b)}.`);
    else if (hatched.length === 1) sentences.push(`Hatched: minutes ${andNames([nameOf(only.a), nameOf(only.b)])} share.`);
    else if (hatched.length > 1) sentences.push("Hatched: minutes each kept step’s pair still shares.");
    if (ghosts.length === 1) sentences.push("Dashed: the published slot.");
    else if (ghosts.length > 1) sentences.push("Dashed: the published slots.");
  }
  const caption = sentences.join(" ");
  const [title, ...rest] = sentences;

  return {
    kind,
    stages,
    domain,
    sets,
    ghosts: ghosts.map((place, i) => ({ actId: ghostIds[i], lane: laneOf.get(place.stage) ?? 0, start: place.start, end: place.end })),
    hatches,
    caption,
    title,
    desc: rest.length > 0 ? rest.join(" ") : title,
  };
}

/**
 * The drawing's frame, in the SVG's own units. `wide` is the printed text column of an A4 page (190 mm), so on A4
 * a unit is a CSS pixel; on a wide screen it scales up to the sheet's text column. Its labels are 10 units on the
 * screen, and on paper the sheet sets them at `printFont`, 12.7 units, which prints at 9.5 pt on A4 (on Letter, 3%
 * larger), the sheet's smallest printed size. `narrow` is a phone's text column, never printed (so its `printFont`
 * is its `font`), with taller bars. The layout leaves room for the larger of the two sizes. `minTick` is the least
 * room between two labelled hours.
 *
 * Every lane is the same height, `gap` over `bar`, so the stages stand at one even pitch whether or not a lane names
 * a set: the gap is the air above each bar and the row its lane's names sit in, their baseline `nameRise` above the
 * bar's top (nearer their own bar than the one above). `axis` is the hour row and `hourBaseline` its labels' baseline.
 * `radius` is the corner of every bar, dashed slot and clip: about a third of the bar's height, the proportion of
 * the day drawing's 6px corner on its 19px bars, so a set here is the same rounded rectangle, smaller, never a capsule.
 */
export const FIGURE_FRAMES = {
  wide: { width: 718, font: 10, printFont: 12.7, minTick: 43, axis: 9, hourBaseline: 9.4, gap: 15.6, bar: 8, radius: 2.5, nameRise: 3.9 },
  narrow: { width: 340, font: 10, printFont: 10, minTick: 40, axis: 8.5, hourBaseline: 7.5, gap: 13, bar: 10, radius: 3, nameRise: 3.4 },
} as const;

export type FigureFrame = (typeof FIGURE_FRAMES)[keyof typeof FIGURE_FRAMES];

/** Room between two names in one lane, and between the stage names and the first hour. */
const NAME_GAP = 6;

/**
 * About how wide a line of text sets in the site's sans at `size` units: narrow letters, capitals and wide letters
 * apart. An estimate for placing names (it errs wide, so a name never runs into another or past the edge).
 */
export function textWidth(text: string, size: number, bold = false): number {
  let em = 0;
  for (const char of text) {
    if (/[ijl.,:;'’|!]/.test(char)) em += 0.27;
    else if (/[ftrI ()\-–]/.test(char)) em += 0.34;
    else if (/[mwMW]/.test(char)) em += 0.86;
    else if (/[A-Z&]/.test(char)) em += 0.68;
    else if (/\d/.test(char)) em += 0.58;
    else em += 0.56;
  }
  return em * size * (bold ? 1.06 : 1);
}

export type FigureLayout = {
  width: number;
  height: number;
  /** Where the hours start: right of the stage names. */
  plotX: number;
  /** One gridline per hour; a label on every hour that has room, on a whole step of hours. */
  ticks: { x: number; label: string | null }[];
  /** Every lane at one pitch: its bars' top, and its names' baseline when it names a set. */
  lanes: { name: string; barY: number; nameY: number | null }[];
  bars: { actId: string; x: number; y: number; w: number; h: number; named: boolean; moved: boolean }[];
  ghosts: { actId: string; x: number; y: number; w: number; h: number }[];
  /** A hatch over part of one bar (`bar` indexes `bars`), clipped by that bar's own rounded shape. */
  hatches: { bar: number; x: number; w: number }[];
  /** The named sets' names, each whole, in its lane's name row above the bars, from `x` (text-anchor start). */
  names: { actId: string; text: string; x: number; y: number; w: number }[];
};

/**
 * Positions for one frame. Every lane is `gap` + `bar` high, its bars at the foot; a lane that names a set writes the
 * name in the gap over its bar. Names start at their bar and move right of an earlier name in the same lane, never
 * past either edge. Widths are measured at the frame's larger size, so a label fits on paper as on the screen.
 */
export function layoutFigure(figure: BriefFigure, frame: FigureFrame): FigureLayout {
  const m = frame;
  const { width } = frame;
  const font = Math.max(frame.font, frame.printFont);
  const longestStage = Math.max(0, ...figure.stages.map((stage) => textWidth(stage.name, font)));
  const plotX = Math.min(Math.max(longestStage + NAME_GAP + 2, 28), Math.round(width * 0.3));
  const plotW = width - plotX;
  const minutes = Math.max(60, figure.domain.end - figure.domain.start);
  const scale = plotW / minutes;
  const xOf = (t: number) => plotX + (t - figure.domain.start) * scale;

  // Lanes, top to bottom, at one pitch.
  const namedLanes = new Set(figure.sets.filter((set) => set.named).map((set) => set.lane));
  const pitch = m.gap + m.bar;
  const lanes = figure.stages.map((stage, index) => {
    const barY = m.axis + index * pitch + m.gap;
    return { name: stage.name, barY, nameY: namedLanes.has(index) ? barY - m.nameRise : null };
  });
  const y = m.axis + lanes.length * pitch;

  // Hours: a gridline on each, a label on each whole step that has room.
  const hourPx = 60 * scale;
  const step = [1, 2, 3, 4, 6].find((hours) => hours * hourPx >= frame.minTick) ?? 6;
  const ticks: FigureLayout["ticks"] = [];
  for (let t = figure.domain.start, i = 0; t <= figure.domain.end; t += 60, i += 1) {
    const x = xOf(t);
    const label = formatClock(t);
    const half = textWidth(label, font) / 2;
    const fits = i % step === 0 && t < figure.domain.end && x - half >= 0 && x + half <= width;
    ticks.push({ x, label: fits ? label : null });
  }

  const bars = figure.sets.map((set) => ({
    actId: set.actId,
    x: xOf(set.start),
    y: lanes[set.lane]?.barY ?? m.axis,
    w: Math.max(1, (set.end - set.start) * scale),
    h: m.bar,
    named: set.named,
    moved: set.moved,
  }));
  const barOf = new Map(bars.map((bar, index) => [bar.actId, index]));
  const ghosts = figure.ghosts.map((ghost) => ({
    actId: ghost.actId,
    x: xOf(ghost.start),
    y: lanes[ghost.lane]?.barY ?? m.axis,
    w: Math.max(1, (ghost.end - ghost.start) * scale),
    h: m.bar,
  }));
  const hatches: FigureLayout["hatches"] = [];
  for (const hatch of figure.hatches) {
    for (const id of [hatch.aId, hatch.bId]) {
      const bar = barOf.get(id);
      if (bar === undefined) continue;
      hatches.push({ bar, x: xOf(hatch.start), w: Math.max(1, (hatch.end - hatch.start) * scale) });
    }
  }

  const names: FigureLayout["names"] = [];
  for (let lane = 0; lane < lanes.length; lane += 1) {
    const nameY = lanes[lane].nameY;
    if (nameY === null) continue;
    let after = plotX;
    for (const set of figure.sets.filter((item) => item.lane === lane && item.named)) {
      const w = textWidth(set.name, font, true);
      const x = Math.max(Math.min(Math.max(xOf(set.start), after), width - w), plotX);
      names.push({ actId: set.actId, text: set.name, x, y: nameY, w });
      after = x + w + NAME_GAP;
    }
  }

  return { width, height: y, plotX, ticks, lanes, bars, ghosts, hatches, names };
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
