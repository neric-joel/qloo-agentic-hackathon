/**
 * What taste overlap changes in a day's ranking: the server ranks the day's priced concurrent pairs
 * twice, once with the page's own price and once with the taste-overlap term held the same for
 * every pair (draw and time alone; draw is also a Qloo field). `GET /api/presets/{id}/lenses`.
 *
 * The page prints only ranks and counts the server sends; it computes nothing from them.
 */

import { isRecord } from "./events";
import { pairKey } from "./clashes";

/** A pair in the with-taste list, with its rank on draw and time alone (null: unranked there, unpriced or at no cost). */
export type LensWithTaste = {
  a: string;
  b: string;
  a_id: string;
  b_id: string;
  rank: number;
  rank_without_taste: number | null;
};

/** A pair in the draw-and-time list, with its rank with taste overlap (null: unranked there, unpriced or at no cost). */
export type LensWithoutTaste = {
  a: string;
  b: string;
  a_id: string;
  b_id: string;
  rank: number;
  rank_with_taste: number | null;
};

/** A pair with high taste overlap that never shares a minute. */
export type LensApart = { a: string; b: string; a_id: string; b_id: string };

/**
 * The `only_with_taste` count recomputed with the taste-overlap matrix shuffled over act labels:
 * how many of the day's costliest pairs drop out when the same overlap numbers sit on the wrong
 * pairs. `low` and `high` are the 10th and 90th percentiles over `runs` shuffles.
 */
export type LensShuffled = { runs: number; median: number; low: number; high: number };

export type Lenses = {
  day: number;
  /** How many of the day's costliest pairs each list holds. */
  ranked: number;
  with_taste: LensWithTaste[];
  without_taste: LensWithoutTaste[];
  /** With-taste pairs that are not among the `ranked` costliest on draw and time alone. */
  only_with_taste: number;
  /** Draw-and-time pairs that are not among the `ranked` costliest with taste overlap. */
  only_without_taste: number;
  apart: LensApart[];
  /** How many pairs are ranked with taste overlap (the denominator of `rank`); absent on an older backend. */
  priced_with_taste?: number;
  /** How many pairs are ranked on draw and time alone; absent on an older backend. */
  priced_without_taste?: number;
  /** The shuffled-overlap comparison for `only_with_taste`; absent on an older backend. */
  shuffled?: LensShuffled;
};

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** The shuffled comparison, or undefined when it is missing or not four coherent integers. */
function parseShuffled(raw: unknown): LensShuffled | undefined {
  if (!isRecord(raw)) return undefined;
  const { runs, median, low, high } = raw;
  if (!isPositiveCount(runs) || !isCount(median) || !isCount(low) || !isCount(high)) return undefined;
  if (low > median || median > high) return undefined;
  return { runs, median, low, high };
}

function isRank(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parsePair(raw: unknown): LensApart | null {
  if (!isRecord(raw)) return null;
  const { a, b, a_id, b_id } = raw;
  if (!isText(a) || !isText(b) || !isText(a_id) || !isText(b_id)) return null;
  return { a, b, a_id, b_id };
}

/** A rank that may be null; undefined when the value is neither. */
function optionalRank(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isRank(value) ? value : undefined;
}

function parseList<T>(raw: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null;
  const out: T[] = [];
  for (const item of raw) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/** Validates the lens response. Never throws: anything it does not understand is null. */
export function parseLenses(raw: unknown): Lenses | null {
  try {
    if (!isRecord(raw) || raw.kind !== "lenses") return null;
    if (!isCount(raw.day) || !isCount(raw.ranked)) return null;
    if (!isCount(raw.only_with_taste) || !isCount(raw.only_without_taste)) return null;

    const withTaste = parseList<LensWithTaste>(raw.with_taste, (item) => {
      const pair = parsePair(item);
      if (!pair || !isRecord(item) || !isRank(item.rank)) return null;
      const other = optionalRank(item.rank_without_taste);
      return other === undefined ? null : { ...pair, rank: item.rank, rank_without_taste: other };
    });
    const withoutTaste = parseList<LensWithoutTaste>(raw.without_taste, (item) => {
      const pair = parsePair(item);
      if (!pair || !isRecord(item) || !isRank(item.rank)) return null;
      const other = optionalRank(item.rank_with_taste);
      return other === undefined ? null : { ...pair, rank: item.rank, rank_with_taste: other };
    });
    const apart = parseList(raw.apart, parsePair);
    if (!withTaste || !withoutTaste || !apart) return null;

    // The additive fields are optional: a missing or unreadable one is left out, never an error.
    const optional: Pick<Lenses, "priced_with_taste" | "priced_without_taste" | "shuffled"> = {};
    if (isPositiveCount(raw.priced_with_taste)) optional.priced_with_taste = raw.priced_with_taste;
    if (isPositiveCount(raw.priced_without_taste)) optional.priced_without_taste = raw.priced_without_taste;
    const shuffled = parseShuffled(raw.shuffled);
    if (shuffled) optional.shuffled = shuffled;

    return {
      day: raw.day,
      ranked: raw.ranked,
      with_taste: withTaste,
      without_taste: withoutTaste,
      only_with_taste: raw.only_with_taste,
      only_without_taste: raw.only_without_taste,
      apart,
      ...optional,
    };
  } catch {
    return null;
  }
}

/** Why the lens data is missing; the section is simply left out either way. */
export class LensUnavailable extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? "lens data unreadable" : `HTTP ${status}`);
    this.name = "LensUnavailable";
  }
}

/** Fetches and validates one day's lenses. Rejects on a non-200 answer or an unreadable body. */
export async function fetchLenses(presetId: string, day: number, signal?: AbortSignal): Promise<Lenses> {
  const response = await fetch(
    `/api/presets/${encodeURIComponent(presetId)}/lenses?day=${encodeURIComponent(String(day))}`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new LensUnavailable(response.status);
  const lenses = parseLenses(await response.json());
  if (!lenses) throw new LensUnavailable(null);
  return lenses;
}

/**
 * A pair's rank on draw and time alone, in either act order. A number is its rank; null means the
 * server gives it no rank there (unpriced or at no cost: the timetable is the same in both views,
 * so it never means the sets stop sharing time); undefined means the response does not say (the
 * pair is in neither list). The drawer gets a rank only for a number (`drawerRank`).
 */
export function rankWithoutTaste(lenses: Lenses): (aId: string, bId: string) => number | null | undefined {
  const ranks = new Map<string, number | null>();
  for (const pair of lenses.without_taste) {
    ranks.set(pairKey(pair.a_id, pair.b_id), pair.rank);
  }
  for (const pair of lenses.with_taste) {
    const key = pairKey(pair.a_id, pair.b_id);
    if (!ranks.has(key) && !ranks.has(pairKey(pair.b_id, pair.a_id))) ranks.set(key, pair.rank_without_taste);
  }
  return (aId, bId) => {
    const forward = pairKey(aId, bId);
    if (ranks.has(forward)) return ranks.get(forward);
    const backward = pairKey(bId, aId);
    return ranks.has(backward) ? ranks.get(backward) : undefined;
  };
}

/**
 * How many pairs are ranked on draw and time alone: the "of N" after a drawer rank. Undefined while
 * the lens data is missing or an older backend does not send it (the drawer then prints the bare
 * ordinal).
 */
export function drawerRankOf(lenses: Lenses | null): number | undefined {
  return lenses?.priced_without_taste;
}

/**
 * The clash drawer's `rankWithoutTaste` prop: a pair's rank on draw and time alone when the lens
 * data has a number for it, and undefined otherwise (the drawer then prints no line), so the drawer
 * never prints a "not among the day's concurrent clashes" line for a pair the server merely left
 * unranked. Undefined while the lens data is missing.
 */
export function drawerRank(lenses: Lenses | null): ((aId: string, bId: string) => number | undefined) | undefined {
  if (!lenses) return undefined;
  const lookup = rankWithoutTaste(lenses);
  return (aId, bId) => {
    const value = lookup(aId, bId);
    return typeof value === "number" ? value : undefined;
  };
}
