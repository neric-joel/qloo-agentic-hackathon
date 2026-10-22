/**
 * The saved requests and values behind one clash, for the clash drawer's "Saved requests and values" block (round
 * 37, L85). Pure: it reads the preset the page already holds and fetches nothing.
 *
 * Per act: its name, the /search request saved for it (matched on its query, as `requestsForActs` matches one), the
 * Qloo entity id this app used (`qloo_id`), its saved popularity and genre, and how many /v2/insights requests name
 * that entity as their signal. Only `signal.interests.entities` is read: every saved /v2/insights request lists the
 * whole bill in `filter.results.entities`, so matching any parameter would count every request of the day (36 on the
 * Glastonbury Sunday) instead of the act's own ranked row (1).
 *
 * For the pair: the taste overlap the report holds for it, the preset's build date as the saved date, how many saved
 * /v2/analysis/compare requests name exactly the pair's two entities, and the shared tags its saved receipt holds.
 * Per act, the name Qloo's /search returned for the entity this app used, where the preset holds it
 * (`matched_names`, added from the saved /search responses by backend/scripts/enrich_matched_names.py); a preset
 * built before that holds none, and the block then says the names were not retained.
 */

import { receiptFor } from "./clashes";
import type { QlooRequestRecord } from "./events";
import { pluralize } from "./format";
import type { Act, PairClash, Preset, SharedTag } from "./preset";

/** The /search request saved for one act, as the preset's ledger holds it. */
export type SavedSearch = {
  path: string;
  query: string;
  types: string | null;
  /** How many candidates the request asked Qloo for. Null when the saved request has no usable `take`. */
  take: number | null;
  status: number;
  cached: boolean;
  request_id: string | null;
};

/** One act of the pair, from the saved preset only. */
export type ChainAct = {
  id: string;
  name: string;
  /** The first saved /search whose query is the act's name; null when the ledger holds none. */
  search: SavedSearch | null;
  /** The Qloo entity id this app used for the act; null when no entity was matched. */
  entityId: string | null;
  /** Saved Qloo popularity, 0 to 1; null when Qloo has no signal for the act. */
  popularity: number | null;
  genre: string | null;
  /** Saved /v2/insights requests whose `signal.interests.entities` names this act's entity. */
  insights: number;
  /** The name Qloo's saved /search returned for that entity; null when the preset holds none. */
  matchedName: string | null;
};

export type RequestChain = {
  acts: readonly [ChainAct, ChainAct];
  /** The pair's taste overlap (0 to 1) as the report holds it; null when the report does not list the pair. */
  overlap: number | null;
  /** The preset's build date as "3 Oct 2026" (UTC); null when the preset does not say. */
  savedOn: string | null;
  /** Saved /v2/analysis/compare requests whose two signal entities are exactly the pair's two entities. */
  compares: number;
  /** The shared tags the pair's saved receipt holds; empty when it holds none or there is no receipt. */
  sharedTags: readonly SharedTag[];
  /** Why the saved comparison stored no tags, where this app has read it from the saved answer; else null. */
  untaggedReason: string | null;
};

const SIGNAL = "signal.interests.entities";
const COMPARE_SIDES = ["a.signal.interests.entities", "b.signal.interests.entities"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The entity ids one saved parameter lists (the preset flattens lists to comma-separated strings). */
function idsIn(record: QlooRequestRecord, key: string): string[] {
  return (record.params[key] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The first saved /search for an act's name, or null. */
function searchFor(requests: readonly QlooRequestRecord[], name: string): SavedSearch | null {
  const record = requests.find((r) => r.path.endsWith("/search") && sameName(r.params.query ?? "", name));
  if (!record) return null;
  const take = Number.parseInt(record.params.take ?? "", 10);
  return {
    path: record.path,
    query: record.params.query ?? "",
    types: record.params.types ?? null,
    take: Number.isFinite(take) && take > 0 ? take : null,
    status: record.status,
    cached: record.cached,
    request_id: record.request_id ?? null,
  };
}

/** Saved /v2/insights requests whose signal is this entity, read from `signal.interests.entities` only. */
export function insightsFor(requests: readonly QlooRequestRecord[], entityId: string | null): number {
  if (!entityId) return 0;
  return requests.filter((r) => r.path.endsWith("/insights") && idsIn(r, SIGNAL).includes(entityId)).length;
}

/** Saved /v2/analysis/compare requests whose two sides are exactly these two entities, in either order. */
export function comparesFor(requests: readonly QlooRequestRecord[], a: string | null, b: string | null): number {
  if (!a || !b || a === b) return 0;
  return requests.filter((r) => {
    if (!r.path.endsWith("/analysis/compare")) return false;
    const sides = COMPARE_SIDES.map((key) => idsIn(r, key));
    if (sides.some((ids) => ids.length !== 1)) return false;
    const pair = new Set(sides.flat());
    return pair.size === 2 && pair.has(a) && pair.has(b);
  }).length;
}

/** "3 Oct 2026": an ISO timestamp's calendar date in UTC, so the server and every browser print the same day. */
export function savedOnDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function chainAct(preset: Pick<Preset, "requests" | "matched_names">, act: Act): ChainAct {
  const matched = act.qloo_id ? preset.matched_names?.[act.id] : undefined;
  return {
    id: act.id,
    name: act.name,
    search: searchFor(preset.requests, act.name),
    entityId: act.qloo_id,
    popularity: act.popularity,
    genre: act.genre,
    insights: insightsFor(preset.requests, act.qloo_id),
    matchedName: typeof matched === "string" && matched.trim() ? matched : null,
  };
}

/**
 * Pairs whose saved /v2/analysis/compare answer was read and held no tag this app counts, keyed by the two entity
 * ids in sorted order. This app keeps only genre, subgenre and theme tags (backend/app/qloo/overlap.py). Glastonbury
 * 2025 Sunday's headline pair, Sprints and Katy J Pearson: the saved answer holds 2 tags, one audience and one
 * instrument (read from the saved response on 22 Oct 2026).
 */
const UNTAGGED: Record<string, string> = {
  "2D309B5E-4AAB-4B4C-9F70-BCDDB12DB708|3F1B7EC6-EB80-4DD1-A342-EF02D61D0918":
    "No shared genre tags: the saved compare returned only audience and instrument tags, which this app does not count.",
};

function untaggedReason(a: string | null, b: string | null, compares: number, sharedTags: number): string | null {
  if (!a || !b || compares === 0 || sharedTags > 0) return null;
  return UNTAGGED[[a, b].sort().join("|")] ?? null;
}

const samePair = (clash: Pick<PairClash, "a" | "b">, aId: string, bId: string) =>
  (clash.a.act_id === aId && clash.b.act_id === bId) || (clash.a.act_id === bId && clash.b.act_id === aId);

/**
 * The saved chain behind a pair of acts on a preset, or null when either act is not on the preset. Nothing is
 * fetched: every value is read from the preset as saved.
 */
export function requestChain(
  preset: Pick<Preset, "requests" | "built_at" | "festival" | "report" | "evidence" | "matched_names">,
  aId: string,
  bId: string,
): RequestChain | null {
  const a = preset.festival.acts.find((act) => act.id === aId);
  const b = preset.festival.acts.find((act) => act.id === bId);
  if (!a || !b) return null;
  const clash = preset.report.clashes.find((item) => samePair(item, aId, bId));
  const compares = comparesFor(preset.requests, a.qloo_id, b.qloo_id);
  const sharedTags = receiptFor(preset.evidence, aId, bId)?.shared_tags ?? [];
  return {
    acts: [chainAct(preset, a), chainAct(preset, b)],
    overlap: clash ? clash.audience_overlap : null,
    savedOn: savedOnDate(preset.built_at),
    compares,
    sharedTags,
    untaggedReason: untaggedReason(a.qloo_id, b.qloo_id, compares, sharedTags.length),
  };
}

// ------------------------------------------------------------------------------------ the block's words

/** The block's title in the clash drawer. */
export const CHAIN_TITLE = "Saved requests and values";

/** The block's one line on the invented day, where no request was made. */
export const CHAIN_INVENTED = "Invented day: no Qloo request was made; the acts and figures are invented.";

/** "2D309B5E…": the first 8 characters of an entity id; the full id goes in a title attribute beside it. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** "(3 candidates asked)". */
export function candidatesAsked(take: number): string {
  return `(${pluralize(take, "candidate")} asked)`;
}

/** "request" or "requests", after a count, so a page can set the endpoint between the two in its own type. */
export function requestNoun(count: number): string {
  return count === 1 ? "request" : "requests";
}

/** "1 /v2/insights request", "2 /v2/insights requests". */
export function insightsCount(count: number): string {
  return pluralize(count, "/v2/insights request");
}

/** "Taste overlap 99 of 100 on this bill (a rank, not attendance) → pair score → Clash Budget Index." */
export function overlapLine(overlapOutOf100: string): string {
  return `Taste overlap ${overlapOutOf100} of 100 on this bill (a rank, not attendance) → pair score → Clash Budget Index.`;
}

/** What the ledger holds for the pair's comparison: "1 saved /v2/analysis/compare request." or that none was saved. */
export function compareLine(count: number): string {
  return count > 0 ? `${pluralize(count, "saved /v2/analysis/compare request")}.` : "No comparison was saved for this pair.";
}

/**
 * On a preset built before the matched names were added: the names were not saved; the shared tags are, where the
 * receipt holds any.
 */
export function retainedLine(sharedTags: readonly SharedTag[]): string {
  return sharedTags.length === 0
    ? "Matched names were not retained; no shared tags are stored here."
    : "Matched names were not retained.";
}

/** The label before the matched names. */
export const MATCHED_LABEL = "Qloo’s search match, from the saved reading:";

/**
 * "Patti Smith and Her Band as “Patti Smith”; Pennywise as “Pennywise”.": each act's billed name and the name
 * Qloo's saved /search returned for it ("no match" where none was kept). Null when the preset holds no matched name
 * for either act, so the page says they were not retained instead.
 */
export function matchedNames(acts: readonly ChainAct[]): string | null {
  if (!acts.some((act) => act.matchedName)) return null;
  return `${acts.map((act) => (act.matchedName ? `${act.name} as “${act.matchedName}”` : `${act.name}: no match`)).join("; ")}.`;
}

/** The tags line beside the matched names: why none are stored, or that none are; null when the receipt holds some. */
export function tagsLine(chain: Pick<RequestChain, "sharedTags" | "untaggedReason">): string | null {
  if (chain.sharedTags.length > 0) return null;
  return chain.untaggedReason ?? "No shared tags are stored here.";
}

/** "Saved 3 Oct 2026." */
export function savedLine(savedOn: string): string {
  return `Saved ${savedOn}.`;
}
