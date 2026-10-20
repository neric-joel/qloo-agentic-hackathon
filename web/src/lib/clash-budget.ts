/**
 * The Clash Budget Index: 100 x a timetable's total clash regret / the mean regret of random valid
 * timetables of the same lineup. 100 means "as much taste-overlap cost as a random valid arrangement";
 * lower is better. It counts only what clashes cost: taste overlap, time shared and draw. Helpers here place
 * it on the dial and put it into words.
 */

import type { BaselineStats, SetSlot } from "./preset";

export type DialDomain = { min: number; max: number };

/**
 * The dial's range: wide enough to show the index, 100 and the band of random timetables with
 * some room on each side, in steps of 10, and never narrower than 60 to 140.
 */
export function dialDomain(index: number, baseline: Pick<BaselineStats, "p10_index" | "p90_index"> | null): DialDomain {
  const values = [index, 100, baseline?.p10_index, baseline?.p90_index].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  const low = Math.min(...values) - 15;
  const high = Math.max(...values) + 15;
  return {
    min: Math.max(0, Math.min(60, Math.floor(low / 10) * 10)),
    max: Math.max(140, Math.ceil(high / 10) * 10),
  };
}

/** Position on the dial from 0 (left end) to 1 (right end), clamped. */
export function dialFraction(value: number, domain: DialDomain): number {
  const span = domain.max - domain.min;
  if (span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (value - domain.min) / span));
}

/** A point on a semicircle that runs from the left (fraction 0) over the top to the right (1). */
export function dialPoint(fraction: number, cx: number, cy: number, r: number): { x: number; y: number } {
  const angle = Math.PI * (1 - fraction);
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
}

/** SVG path for the part of the semicircle between two fractions. */
export function dialArc(from: number, to: number, cx: number, cy: number, r: number): string {
  const start = dialPoint(Math.min(from, to), cx, cy, r);
  const end = dialPoint(Math.max(from, to), cx, cy, r);
  const round = (value: number) => Math.round(value * 100) / 100;
  // The arc never spans more than half the circle, so the large-arc flag is always 0.
  return `M ${round(start.x)} ${round(start.y)} A ${r} ${r} 0 0 1 ${round(end.x)} ${round(end.y)}`;
}

/**
 * Where the index sits against the middle 80% of random valid timetables of this lineup (10th to 90th percentile),
 * compared as the dial prints them (whole numbers), so the words never contradict the figures.
 * Null when the band is unknown.
 */
export function rangePosition(
  index: number,
  p10: number | null,
  p90: number | null,
): "above" | "within" | "below" | null {
  if (p10 === null || p90 === null || !Number.isFinite(index) || !Number.isFinite(p10) || !Number.isFinite(p90)) {
    return null;
  }
  const value = Math.round(index);
  if (value > Math.round(p90)) return "above";
  if (value < Math.round(p10)) return "below";
  return "within";
}

/**
 * Where the day sits against random valid timetables, as a reading of the index rather than a verdict
 * on the festival, with its direction stated in the sentence itself: "By this index, the published
 * timetable scores 116.7, where 100 is the average random valid timetable and higher means more clash
 * cost." (one decimal, as the dial prints it). Every caller also sets "Lower is better" beside it. On
 * the invented day the timetable is called invented, not published, and nothing credits Qloo.
 */
export function describeVsRandom(index: number, synthetic = false): string {
  const lead = `By this index, the ${synthetic ? "invented" : "published"} timetable scores`;
  return `${lead} ${index.toFixed(1)}, where 100 is the average random valid timetable and higher means more clash cost`;
}

/** How far the random valid timetables behind the index may move each set. */
export type SamplingReach = {
  /** How far a set may start from its published start, either way, when every set shares one window. */
  windowMinutes: number | null;
  /** Some set may change stage. */
  neighbourStages: boolean;
  /** Sets that never move. */
  locked: number;
};

/** The shared start window, the stage freedom and the locked sets behind a timetable's index. */
export function samplingReach(
  timetable: readonly Pick<SetSlot, "start" | "locked" | "not_before" | "not_after" | "stages">[],
): SamplingReach {
  // Each set's window as a distance either side of its published start; null when it has no
  // window or an uneven one.
  const windows = timetable.map((slot) => {
    if (slot.not_before == null || slot.not_after == null) return null;
    const before = slot.start - slot.not_before;
    return before === slot.not_after - slot.start ? before : null;
  });
  const first = windows[0] ?? null;
  return {
    windowMinutes: first !== null && windows.every((value) => value === first) ? first : null,
    neighbourStages: timetable.some((slot) => (slot.stages?.length ?? 0) > 1),
    locked: timetable.filter((slot) => slot.locked).length,
  };
}

/** "2 hours", "1 hour", "90 minutes". */
function spanText(minutes: number): string {
  if (minutes > 0 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * The rules every random valid timetable keeps, as a clause: "each set stays within 2 hours of its
 * published start, on its own stage or a neighbouring one, with the 5 locked sets fixed".
 */
export function describeReach(reach: SamplingReach): string {
  if (reach.windowMinutes === null) return "each set stays inside its allowed window and stages";
  let text = `each set stays within ${spanText(reach.windowMinutes)} of its published start`;
  if (reach.neighbourStages) text += ", on its own stage or a neighbouring one";
  if (reach.locked > 0) {
    text += reach.locked === 1 ? ", with the 1 locked set fixed" : `, with the ${reach.locked} locked sets fixed`;
  }
  return text;
}
