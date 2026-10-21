/**
 * The build's negative controls: acts unrelated to a festival bill, whose audiences must rank near the
 * bottom (a mean percentile at or under `CONTROL_RANK_LIMIT`) for the taste signal to count as separating
 * audiences on that bill. Mirrors `CONTROL_ARTISTS` and the check in backend/app/qloo/overlap.py.
 */
export const CONTROL_ACTS = ["Vienna Philharmonic", "Raffi", "Frankie Yankovic", "Mormon Tabernacle Choir"] as const;

export const CONTROL_RANK_LIMIT = 0.35;

const CONTROL_NAMES = new Set<string>(CONTROL_ACTS.map((name) => name.toLowerCase()));

/** Whether a search query is one of the control acts: the whole name, ignoring case and outer spaces. */
export function isControlQuery(query: string): boolean {
  return CONTROL_NAMES.has(query.trim().toLowerCase());
}
