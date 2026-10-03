/**
 * The live pair check: `GET /api/pair?preset=&a=&b=` re-sends the two saved audience-ranking
 * requests for a clash's acts and one fresh comparison, and answers with the taste overlap worked
 * out again from Qloo's answers, beside the saved value. The page never replaces a saved number
 * with a live one; this module only reads the answer and words its outcome.
 */

import { ordinal, pairKey, tagLabel } from "./clashes";
import { isRecord, type QlooRequestRecord } from "./events";
import { pluralize } from "./format";
import type { SharedTag } from "./preset";

export type PairCheckAct = { actId: string; name: string };

export type PairRanking = {
  /** The act whose audience Qloo ranked the other acts for. */
  forActId: string;
  partnerActId: string;
  /** 1 plus the number of acts Qloo scored strictly higher for that audience. */
  position: number;
  /** How many acts were scored, a few unrelated control acts included. */
  of: number;
};

export type PairCheck = {
  presetId: string;
  /** When the server received Qloo's answers, as the server sent it (ISO 8601, UTC). */
  fetchedAt: string;
  a: PairCheckAct;
  b: PairCheckAct;
  /** Both 0 to 1. `saved` is the value the page shows; `live` was worked out from this check. */
  overlap: { live: number; saved: number };
  rankings: PairRanking[];
  tags: SharedTag[];
  /** The three requests sent to Qloo, in the order row for `a`, row for `b`, comparison. */
  requests: QlooRequestRecord[];
};

/** How many requests one check sends to Qloo. The copy says "3 requests", so an answer must list 3. */
export const PAIR_CHECK_REQUESTS = 3;

class PairCheckFormatError extends Error {}

function fail(message: string): never {
  throw new PairCheckFormatError(message);
}

function str(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || !value.trim()) fail(`${key} must be a non-empty string`);
  return value;
}

function num(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${key} must be a number`);
  return value;
}

function unitInterval(source: Record<string, unknown>, key: string): number {
  const value = num(source, key);
  if (value < 0 || value > 1) fail(`${key} must be between 0 and 1`);
  return value;
}

function positiveInteger(source: Record<string, unknown>, key: string): number {
  const value = num(source, key);
  if (!Number.isInteger(value) || value < 1) fail(`${key} must be a whole number of at least 1`);
  return value;
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${at} must be an object`);
  return value;
}

function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) fail(`${at} must be a list`);
  return value;
}

/** Qloo parameters are flat strings; lists are joined with commas, as the trace shows them. */
function paramString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => String(item)).join(",");
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

function parseAct(raw: unknown, at: string): PairCheckAct {
  const o = record(raw, at);
  return { actId: str(o, "act_id"), name: str(o, "name") };
}

function parseRanking(raw: unknown, at: string): PairRanking {
  const o = record(raw, at);
  const position = positiveInteger(o, "position");
  const of = positiveInteger(o, "of");
  if (position > of) fail(`${at}.position must not exceed ${at}.of`);
  return { forActId: str(o, "for_act_id"), partnerActId: str(o, "partner_act_id"), position, of };
}

function parseTag(raw: unknown): SharedTag[] {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim()) return [];
  return [
    {
      name: raw.name,
      kind: typeof raw.kind === "string" ? raw.kind : null,
      score: typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : null,
    },
  ];
}

/** One request record, with its `cached` and `recorded` flags exactly as the server sent them. */
function parseRequest(raw: unknown, at: string): QlooRequestRecord {
  const o = record(raw, at);
  const params: Record<string, string> = {};
  if (o.params !== undefined && o.params !== null) {
    for (const [key, value] of Object.entries(record(o.params, `${at}.params`))) {
      if (value !== undefined && value !== null) params[key] = paramString(value);
    }
  }
  const { cached, recorded, request_id: requestId } = o;
  if (typeof cached !== "boolean") fail(`${at}.cached must be true or false`);
  if (recorded !== undefined && recorded !== null && typeof recorded !== "boolean") {
    fail(`${at}.recorded must be true or false`);
  }
  const parsed: QlooRequestRecord = {
    path: str(o, "path"),
    params,
    status: num(o, "status"),
    latency_ms: num(o, "latency_ms"),
    cached,
    recorded: recorded === true,
  };
  if (requestId !== undefined && requestId !== null) {
    if (typeof requestId !== "string") fail(`${at}.request_id must be a string`);
    if (requestId) parsed.request_id = requestId;
  }
  return parsed;
}

/**
 * Reads a `GET /api/pair` 200 body. Null when the body does not match the contract, and also when
 * any request is flagged cached or recorded, so an answer that did not come from Qloo just now is
 * never shown as live. Never throws.
 */
export function parsePairCheck(json: unknown): PairCheck | null {
  try {
    const o = record(json, "pair check");
    const fetchedAt = str(o, "fetched_at");
    if (Number.isNaN(Date.parse(fetchedAt))) fail("fetched_at must be a date");
    const a = parseAct(o.a, "a");
    const b = parseAct(o.b, "b");
    if (a.actId === b.actId) fail("a and b must be different acts");
    const overlap = record(o.taste_overlap, "taste_overlap");
    const rankings = list(o.rankings, "rankings").map((item, i) => parseRanking(item, `rankings[${i}]`));
    const ranks = (forAct: string, partner: string) =>
      rankings.some((r) => r.forActId === forAct && r.partnerActId === partner);
    if (!ranks(a.actId, b.actId) || !ranks(b.actId, a.actId)) fail("rankings must cover both acts");
    const requests = list(o.requests, "requests").map((item, i) => parseRequest(item, `requests[${i}]`));
    if (requests.length !== PAIR_CHECK_REQUESTS) fail(`requests must list ${PAIR_CHECK_REQUESTS}`);
    if (requests.some((r) => r.cached || r.recorded)) return null;
    return {
      presetId: str(o, "preset_id"),
      fetchedAt,
      a,
      b,
      overlap: { live: unitInterval(overlap, "live"), saved: unitInterval(overlap, "saved") },
      rankings,
      tags: list(o.tags, "tags").flatMap(parseTag),
      requests,
    };
  } catch {
    // A contract mismatch, or a value too deeply nested to read: either way, nothing to show.
    return null;
  }
}

/** Where the drawer keeps a finished check: one per festival day and pair. */
export function pairCheckKey(presetId: string, a: string, b: string): string {
  return `${presetId}:${pairKey(a, b)}`;
}

/** True when a check answers for this festival day and this pair (in either order). */
export function matchesPair(check: PairCheck, presetId: string, a: string, b: string): boolean {
  if (check.presetId !== presetId) return false;
  return (
    (check.a.actId === a && check.b.actId === b) || (check.a.actId === b && check.b.actId === a)
  );
}

/** The ranking Qloo gave `partnerActId` for `forActId`'s audience, if the check has it. */
export function rankingFor(check: PairCheck, forActId: string, partnerActId: string): PairRanking | null {
  return check.rankings.find((r) => r.forActId === forActId && r.partnerActId === partnerActId) ?? null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PairCheckErrorKind = "capped" | "paused" | "unavailable" | "network";
export type PairCheckError = { kind: PairCheckErrorKind; message: string };

export const NETWORK_MESSAGE = "Could not reach the server, so nothing was re-checked.";

/** For a 200 whose body cannot be shown as a live check (a contract mismatch, or a non-live request). */
export const UNREADABLE_MESSAGE = "The answer could not be shown as a live check, so nothing was re-checked.";

const FALLBACK_MESSAGES: Record<Exclude<PairCheckErrorKind, "network">, string> = {
  capped: "Too many live checks right now. Please try again later.",
  paused: "Live checks are paused right now. The saved result is unchanged.",
  unavailable: "This pair cannot be re-checked.",
};

/** The server's own refusal texts are short sentences; anything longer is not shown. */
const MAX_DETAIL_LENGTH = 300;

/**
 * The server's refusal text, when it is one: a short sentence ending in a full stop. A framework
 * default such as "Not Found" (a server without the route) is not shown, and neither is anything long.
 */
function serverDetail(body: unknown): string | null {
  if (!isRecord(body) || typeof body.detail !== "string") return null;
  const detail = body.detail.trim();
  return detail.length > 1 && detail.length <= MAX_DETAIL_LENGTH && detail.endsWith(".") ? detail : null;
}

/**
 * What a refused or failed check says. 429 is "capped", 503 "paused", 404 and 422 "unavailable",
 * each with the server's `detail` text when it sent one; any other status (and a network failure,
 * passed as status 0) is "network". Never throws.
 */
export function pairCheckError(status: number, body: unknown): PairCheckError {
  const kind: PairCheckErrorKind =
    status === 429
      ? "capped"
      : status === 503
        ? "paused"
        : status === 404 || status === 422
          ? "unavailable"
          : "network";
  if (kind === "network") return { kind, message: NETWORK_MESSAGE };
  return { kind, message: serverDetail(body) ?? FALLBACK_MESSAGES[kind] };
}

/** A 200 that could not be read as a live check. The button stays usable. */
export function unreadablePairCheck(): PairCheckError {
  return { kind: "network", message: UNREADABLE_MESSAGE };
}

// ---------------------------------------------------------------------------
// Comparing the live value with the saved one
// ---------------------------------------------------------------------------

/** The whole number out of 100 the page prints for a 0..1 taste overlap (as `formatOverlap`). */
function printed(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export type Agreement = { kind: "same" | "differs"; points: number; direction: "above" | "below" | null };

/**
 * How the live taste overlap compares with the saved one, on the numbers the page prints: two
 * values that round to the same whole number are the same; otherwise the gap in whole points.
 */
export function agreement(live: number, saved: number): Agreement {
  const gap = printed(live) - printed(saved);
  if (gap === 0) return { kind: "same", points: 0, direction: null };
  return { kind: "differs", points: Math.abs(gap), direction: gap > 0 ? "above" : "below" };
}

/** Tags are matched on the label the page prints for them, so "post_punk" and "Post Punk" are one tag. */
function tagKey(name: string): string {
  return tagLabel(name.trim()).toLowerCase();
}

/** How many of the tags Qloo returned just now are also in the saved tags (by name, once each). */
export function tagsAlsoSaved(live: readonly SharedTag[], saved: readonly SharedTag[]): number {
  const savedNames = new Set(saved.map((tag) => tagKey(tag.name)));
  return new Set(live.map((tag) => tagKey(tag.name)).filter((name) => savedNames.has(name))).size;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** The verdict under the two figures. A difference is always stated, never hidden. */
export function verdictText(result: Agreement): string {
  if (result.kind === "same") return "Same number as the saved result. Nothing on the page changed.";
  return (
    `${pluralize(result.points, "point")} ${result.direction ?? "away from"} the saved result. ` +
    "Qloo’s answers can change over time; the page keeps the saved number so every figure on it " +
    "stays comparable. Nothing on the page changed."
  );
}

/**
 * Where each act came in the other's audience ranking, as Qloo scored them just now. Null when the
 * check lacks either direction. The count of scored acts is repeated only when the two differ.
 */
export function rankingsText(check: PairCheck): string | null {
  const forA = rankingFor(check, check.a.actId, check.b.actId);
  const forB = rankingFor(check, check.b.actId, check.a.actId);
  if (!forA || !forB) return null;
  const ofB = forB.of === forA.of ? "" : ` of ${forB.of}`;
  return (
    `Qloo scored ${forA.of} acts for ${check.a.name}’s audience, including a few unrelated control ` +
    `acts: ${check.b.name} came ${ordinal(forA.position)}. ` +
    `For ${check.b.name}’s audience, ${check.a.name} came ${ordinal(forB.position)}${ofB}.`
  );
}

/** How many of the tags returned just now are also in the saved tags, for a day that saved them. */
export function savedTagsText(alsoSaved: number, returned: number): string {
  if (returned === 1) {
    return alsoSaved === 1
      ? "This tag also appears in the saved tags."
      : "This tag does not appear in the saved tags.";
  }
  return `${alsoSaved} of these ${returned} also ${alsoSaved === 1 ? "appears" : "appear"} in the saved tags.`;
}
