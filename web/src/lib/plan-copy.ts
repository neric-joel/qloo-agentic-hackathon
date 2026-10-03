/**
 * The words a plan of kept moves and the brief share, in one place so the plan card, the scale line
 * under every tested move and the printed brief can never drift apart (round-5 contract E).
 *
 * The scale is the baseline's 10th to 90th percentile: the middle 80% of random valid timetables of
 * this lineup, never "the range" of them. Every sentence compares the figures as the page prints
 * them (the index to one decimal, the band in whole numbers, as `rangeVerdict` does), so the words
 * never contradict the numbers beside them. Nothing here computes a figure the server did not send;
 * a gap is the difference of two printed figures. Pure functions, so they are unit tested.
 */

import { budgetDelta } from "./agent-session";
import { rangeVerdict, type ScaleRange } from "./stack";

/** Shown under every plan and printed under the brief's kept moves: a plan is graded by the measure that found it. */
export const PLAN_CAVEAT =
  "Scored by the same measure the places are found with, so a lower number shows what that measure rewards, not that audiences would be better served. It knows only the rules in the timetable, not an act’s own wishes.";

/** After a kept step's before and after figures when that step raised the index. */
export const RAISES_MARK = " · raises the index";

/** The band in whole numbers, as every sentence prints it. */
function printedBand(range: NonNullable<ScaleRange>): { low: number; high: number } {
  return { low: Math.round(range.low), high: Math.round(range.high) };
}

/** True when the band can be printed: both ends are finite numbers. */
function usable(range: ScaleRange): range is NonNullable<ScaleRange> {
  return range !== null && Number.isFinite(range.low) && Number.isFinite(range.high);
}

/**
 * How far a reading sits outside the printed band, one decimal: the reading to one decimal minus
 * the band's nearer end in whole numbers. Counted in tenths so 109.3 against 109 is "0.3", never
 * "0.30000000000001".
 */
function gapText(value: number, edge: number): string {
  const tenths = Math.abs(Math.round(value * 10) - edge * 10);
  return (tenths / 10).toFixed(1);
}

/**
 * "The middle 80% of random valid timetables of this lineup score 92 to 109." Null when the day has
 * no band.
 */
export function rangeLead(range: ScaleRange): string | null {
  if (!usable(range)) return null;
  const { low, high } = printedBand(range);
  return `The middle 80% of random valid timetables of this lineup score ${low} to ${high}.`;
}

/**
 * Where a plan's index sits against that band: "This plan scores inside that range.", "...below
 * that range." or "This plan scores 0.3 index points above that range." When the plan is above it
 * and the published timetable is too, the published gap follows, so a plan 0.3 above the band after
 * a 7-point drop never reads as a plan that failed: "The published timetable is 7.7 above it." Null
 * when the band is unknown.
 */
export function planVerdict(plan: number, published: number | null, range: ScaleRange): string | null {
  const verdict = rangeVerdict(plan, range);
  if (!verdict || !usable(range)) return null;
  if (verdict === "below") return "This plan scores below that range.";
  if (verdict === "inside") return "This plan scores inside that range.";
  const { high } = printedBand(range);
  const sentence = `This plan scores ${gapText(plan, high)} index points above that range.`;
  if (published === null || rangeVerdict(published, range) !== "above") return sentence;
  return `${sentence} The published timetable is ${gapText(published, high)} above it.`;
}

/**
 * The brief's band sentence: "The middle 80% of random valid timetables of this lineup score 92 to
 * 109; the published timetable reads above that range." Null when the band is unknown.
 */
export function publishedVerdict(index: number, range: ScaleRange): string | null {
  const verdict = rangeVerdict(index, range);
  if (!verdict || !usable(range)) return null;
  const { low, high } = printedBand(range);
  return `The middle 80% of random valid timetables of this lineup score ${low} to ${high}; the published timetable reads ${verdict} that range.`;
}

/**
 * True when a kept step raised the Clash Budget Index, compared as the plan card prints the two
 * readings (one decimal), so the mark never sits beside two equal figures.
 */
export function raisesIndex(before: number, after: number): boolean {
  const delta = budgetDelta(before, after);
  return delta !== null && delta > 0;
}
