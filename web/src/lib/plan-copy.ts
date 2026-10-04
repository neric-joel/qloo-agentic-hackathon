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

import { budgetDelta, oneDecimal } from "./agent-session";
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
  const tenths = Math.abs(Math.round(oneDecimal(value) * 10) - edge * 10);
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
 * a 7-point drop never reads as a plan that failed: "The published timetable is 7.7 above it." When
 * the plan's index is higher than the published timetable's, the range sentence gives way to a plain one,
 * so a plan that raises the index never reads as good news: "This plan’s index is 88.8, 2.3 higher than
 * the published timetable’s 86.5." (the standalone form adds the band: "The middle 80% of random valid
 * timetables of this lineup score 92 to 109."). Null when the band is unknown.
 *
 * `standalone` states the band in the same sentence ("The middle 80% of random valid timetables of
 * this lineup score 92 to 109; this plan scores below that range."), for the brief, where the band
 * has not been printed yet when the plan is read.
 */
export function planVerdict(
  plan: number,
  published: number | null,
  range: ScaleRange,
  options: { standalone?: boolean } = {},
): string | null {
  const verdict = rangeVerdict(plan, range);
  if (!verdict || !usable(range)) return null;
  const { low, high } = printedBand(range);
  // A plan that raises the index is stated plainly: its index, the published one and the band, with no
  // "scores below that range", which reads as good news beside a higher figure.
  const raised = budgetDelta(published, plan);
  if (raised !== null && raised > 0 && published !== null) {
    const fact = `This plan’s index is ${oneDecimal(plan).toFixed(1)}, ${raised.toFixed(1)} higher than the published timetable’s ${oneDecimal(published).toFixed(1)}.`;
    // Where the band has been stated just before (the plan card, the decision card) it is not said twice.
    return options.standalone
      ? `${fact} The middle 80% of random valid timetables of this lineup score ${low} to ${high}.`
      : fact;
  }
  const clause =
    verdict === "below"
      ? "scores below that range"
      : verdict === "inside"
        ? "scores inside that range"
        : `scores ${gapText(plan, high)} index points above that range`;
  const parts = [
    options.standalone
      ? `The middle 80% of random valid timetables of this lineup score ${low} to ${high}; this plan ${clause}.`
      : `This plan ${clause}.`,
  ];
  if (verdict === "above" && published !== null && rangeVerdict(published, range) === "above") {
    parts.push(`The published timetable is ${gapText(published, high)} above it.`);
  }
  return parts.join(" ");
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
