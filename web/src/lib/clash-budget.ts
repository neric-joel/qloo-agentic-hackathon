/**
 * The Clash Budget Index: 100 x a timetable's total clash regret / the mean regret of random valid
 * timetables of the same lineup. 100 means "as costly as a random valid arrangement"; lower is
 * better. It counts shared-audience cost only. Helpers here place it on the dial and put it into
 * words.
 */

import type { BaselineStats } from "./preset";

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

/** "16% above the random average", "18% below the random average", "level with the random average". */
export function describeVsRandom(index: number): string {
  const delta = Math.round(index - 100);
  if (delta === 0) return "level with the random average";
  return `${Math.abs(delta)}% ${delta > 0 ? "above" : "below"} the random average`;
}
