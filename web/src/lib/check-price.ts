/**
 * "Compare audience overlap (optional)" on the check page: the one module of the check route that makes a
 * request, and only when the visitor presses Compare audience overlap. It sends `POST /api/price-grid` with the
 * act names and the pairs to price, and nothing else: no times, stages, rules or settings, and never
 * the share link's hash. The request and the answer are built and read here as plain functions, so
 * they are unit tested; `requestPrice` is the only call that touches the network, and it never throws.
 *
 * The contract is `_private/critique/round-9/CONTRACT-price-grid.md` (frozen): `saved` matches the
 * names to a saved festival day or the invented example day and sends no Qloo request; `live` asks
 * Qloo, is capped per visitor and for everyone, and is offered only after `saved` answers
 * `not_a_saved_day`.
 */

import type { CheckReport, SharedPair } from "@/lib/check";

export const PRICE_LIMITS = {
  /** Overlaps priced at most, longest first. */
  pairs: 5,
  /** Distinct acts the route needs, and the most it takes. */
  minActs: 4,
  maxActs: 25,
} as const;

export type PriceMode = "saved" | "live";

/** One overlap the page asks about: two act names as the page shows them, and its minutes on this grid. */
export type PriceOverlap = { a: string; b: string; minutes: number };

/** What one press of Compare audience overlap sends, and what the page needs to word it. */
export type PriceRequest = {
  acts: string[];
  overlaps: PriceOverlap[];
  /** Qloo requests a live answer may use: one per act, plus one per distinct act named in a pair. */
  need: number;
  /** Different acts in the grid; past 25 the rest are not sent. */
  total: number;
  /** Acts of the grid left out of the request (past 25): never sent, so never compared. */
  omitted: number;
};

export type PriceSource = "saved_day" | "invented_day" | "qloo_live";

export type PricedPair = {
  a: string;
  b: string;
  minutes: number;
  status: "priced" | "unpriced";
  /** 0 to 1, the build's rank-normalised value; null when unpriced. */
  overlap: number | null;
  /** 1 is the highest among the priced pairs of this answer; null when unpriced. */
  rank: number | null;
  reason: "ambiguous" | "no_signal" | "not_ranked_on_saved_day" | null;
};

export type PriceAnswer = {
  mode: PriceMode;
  source: PriceSource;
  fetchedAt: string | null;
  coverage: {
    acts: number;
    priced: number;
    unpriced: string[];
    /** Round 9b, null from a route that does not send them: acts found as exactly one act. */
    matched: number | null;
    /** Matched acts with no usable signal, and names that matched more than one act (never guessed). */
    noSignal: string[] | null;
    ambiguous: string[] | null;
  };
  /** The population each value is a rank within (9b); null from a route that does not send it. */
  comparator: { kind: "saved_day" | "live_subset"; acts: number } | null;
  pairs: PricedPair[];
  requestsUsed: number;
  /** The saved day that answered (saved modes); null for live. */
  presetId: string | null;
  /** Act names the request sent, and the grid's acts it left out: the comparator population. */
  sent: number;
  omitted: number;
};

export type PriceResult =
  | { status: "ready"; answer: PriceAnswer }
  /** `saved` found no saved day for these names: the page may offer the live button now. */
  | { status: "not_saved" }
  /** A refusal with the route's own sentence (a cap, live switched off, too few acts matched). */
  | { status: "refused"; code: string; message: string }
  | { status: "error" };

/** The step's name: it compares bill-relative audience overlap ranks, not the home page's full price. */
const COMPARE = "Compare audience overlap";

/** The page's wording for the audience step, in one place. */
export const PRICE_COPY = {
  heading: `${COMPARE} (optional)`,
  intro: (k: number, n: number, omitted = 0) =>
    `The checks above ran in your browser and used no Qloo data. To compare audience overlap for the ${count(k, "longest overlap")}, we send ${
      omitted > 0 ? `${n} of the grid’s ${n + omitted} act names (the acts of these overlaps first)` : `the ${count(n, "act name")}`
    } and the pairs to this site’s server to look for saved audience data. No times, stages or rules are sent; names are not stored or logged. If no saved day matches, you can choose to ask Qloo instead.`,
  button: COMPARE,
  savedBanner: "Compared using a saved festival day. No Qloo request was sent.",
  inventedBanner:
    "Compared using the invented example day: its acts and affinities are invented, not Qloo data. No Qloo request was sent.",
  liveBanner: (used: number) => `Asked Qloo just now. This used ${count(used, "Qloo request")}.`,
  notSaved: (n: number, need: number) =>
    `These acts are not on a saved day. We can ask Qloo now. This sends ${count(n, "name")} to Qloo and uses about ${need} of its requests; live pricing is capped per day on this server.`,
  askButton: (n: number) => `Ask Qloo for these ${count(n, "act")}`,
  loading: "Comparing.",
  error: "The server did not answer, so nothing was compared. Your rule results are unchanged.",
  retry: "Try again",
  tooFew: `Comparing audience overlap needs at least ${PRICE_LIMITS.minActs} different acts in the grid.`,
  noOverlap: "No two sets share time, so there is nothing to compare.",
  /** Before an answer: what each kind of answer ranks among. */
  scopeBefore:
    "Each value is a rank within a lineup, not attendance: from a saved day, a rank among that day’s lineup; from Qloo live, a rank among the acts sent.",
  cbi: "The Clash Budget Index needs a full priced day and is not computed here.",
  longestFirst: "Longest first",
  overlapFirst: "Highest audience overlap first",
  sortLabel: "Order",
  briefHeading: (k: number) => `Audience overlap compared (${count(k, "longest overlap")})`,
} as const;

/** "This grid has 30 different acts and at most 25 are sent, so 5 acts are not sent and not compared." */
export function omittedLine(omitted: number, total: number): string {
  return `This grid has ${total} different acts and at most ${PRICE_LIMITS.maxActs} are sent, so ${count(omitted, "act")} ${
    omitted === 1 ? "is" : "are"
  } not sent and not compared.`;
}

/**
 * What the values of an answer are ranks among: the saved day's own lineup for a saved answer (it
 * keeps that day's normalisation, whatever was pasted), the invented day's lineup for the sample, and
 * the acts sent for a live answer; with the grid's acts that were not sent counted.
 */
export function rankScope(answer: ScopeOf): string {
  const left = answer.omitted > 0 ? ` ${omittedLine(answer.omitted, answer.sent + answer.omitted)}` : "";
  const lineup = answer.comparator?.kind === "saved_day" ? ` of ${count(answer.comparator.acts, "act")}` : "";
  if (answer.source === "saved_day") {
    return `Values come from the saved day: each is a rank among the acts on that day’s lineup${lineup}, not among the acts you pasted, and not attendance. “Ranked 1 of n” orders only the pairs compared here.${left}`;
  }
  if (answer.source === "invented_day") {
    return `Values come from the invented example day: ranks among its invented lineup${lineup}, not Qloo data and not attendance. “Ranked 1 of n” orders only the pairs compared here.${left}`;
  }
  const among =
    answer.comparator?.kind === "live_subset"
      ? `the ${count(answer.comparator.acts, "act")} Qloo matched of the ${answer.sent} sent`
      : `the ${count(answer.sent, "act")} sent to Qloo`;
  return `A rank among ${among} just now, not attendance, and not comparable with a published day’s figures.${left}`;
}

/** What `rankScope` reads of an answer; `comparator` is optional so an older answer still words. */
export type ScopeOf = Pick<PriceAnswer, "source" | "sent" | "omitted"> & { comparator?: PriceAnswer["comparator"] };

/** The note under the step: the rank scope of the answer on show, or of either kind before one. */
export function scopeNote(
  answer: ScopeOf | null,
  request: Pick<PriceRequest, "total" | "omitted"> | null,
): string {
  if (answer) return `${rankScope(answer)} ${PRICE_COPY.cbi}`;
  const left = request && request.omitted > 0 ? ` ${omittedLine(request.omitted, request.total)}` : "";
  return `${PRICE_COPY.scopeBefore}${left} ${PRICE_COPY.cbi}`;
}

/** What the page offers after a refusal or a failed answer: a retry where one can help, and why not otherwise. */
export type Recovery = { retry: PriceMode | null; text: string };

const UNCHANGED =
  "Everything above stays as it is: the checks, your decisions, Find a change, the brief and the exports do not need this step.";
const AGAIN_LIVE = "You can try again; it sends the names to Qloo again and counts toward this server’s daily cap.";

/** The recovery after a failed answer (`code` null) or a refusal, by the route's code. Nothing is re-checked. */
export function recovery(mode: PriceMode, code: string | null): Recovery {
  if (code === null) {
    return { retry: mode, text: mode === "live" ? AGAIN_LIVE : "You can try again; it sends the same names and pairs." };
  }
  if (code === "no_answer") return { retry: "live", text: AGAIN_LIVE };
  if (code === "limit") return { retry: null, text: `Try again later. ${UNCHANGED}` };
  if (code === "paused" || code === "live_off") return { retry: null, text: UNCHANGED };
  if (code === "too_few_found") {
    return { retry: null, text: `Asking again would match the same acts, so it is not offered. ${UNCHANGED}` };
  }
  return { retry: null, text: `Change the grid and check it again to compare. ${UNCHANGED}` };
}

function count(value: number, one: string, many: string = `${one}s`): string {
  return `${value} ${value === 1 ? one : many}`;
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const last = value % 10;
  return `${value}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

// ---------------------------------------------------------------------------------------------------
// The request

/**
 * The longest overlaps of the grid, one per pair of acts, and the act names to send: the acts of
 * those overlaps first, then the grid's other acts in grid order, at most 25. Null when the grid has
 * fewer than four different acts or no two sets share time.
 */
export function priceRequest(report: Pick<CheckReport, "sets" | "shared">): PriceRequest | null {
  const names = new Map<string, string>();
  for (const set of report.sets) if (!names.has(set.actKey)) names.set(set.actKey, set.act);
  if (names.size < PRICE_LIMITS.minActs) return null;

  const seen = new Set<string>();
  const chosen: SharedPair[] = [];
  for (const pair of report.shared) {
    const key = [pair.a.actKey, pair.b.actKey].sort().join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push(pair);
    if (chosen.length === PRICE_LIMITS.pairs) break;
  }
  if (chosen.length === 0) return null;

  const order: string[] = [];
  const add = (key: string) => {
    if (!order.includes(key) && order.length < PRICE_LIMITS.maxActs) order.push(key);
  };
  for (const pair of chosen) {
    add(pair.a.actKey);
    add(pair.b.actKey);
  }
  for (const key of names.keys()) add(key);

  const inPairs = new Set(chosen.flatMap((pair) => [pair.a.actKey, pair.b.actKey]));
  return {
    total: names.size,
    omitted: names.size - order.length,
    acts: order.map((key) => names.get(key) as string),
    overlaps: chosen.map((pair) => ({
      a: names.get(pair.a.actKey) as string,
      b: names.get(pair.b.actKey) as string,
      minutes: pair.minutes,
    })),
    need: order.length + inPairs.size,
  };
}

/** The body as sent: exactly `acts`, `pairs` and `mode`. */
export function priceBody(request: PriceRequest, mode: PriceMode): string {
  return JSON.stringify({ acts: request.acts, pairs: request.overlaps.map((o) => [o.a, o.b]), mode });
}

// ---------------------------------------------------------------------------------------------------
// The answer

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

const SOURCES: ReadonlySet<string> = new Set(["saved_day", "invented_day", "qloo_live"]);

/** A list of names from the route, clipped; null when the key is absent or not a list of strings. */
function names(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) return null;
  return value.slice(0, 25).map((name: string) => name.slice(0, 80));
}

function comparatorOf(value: unknown): PriceAnswer["comparator"] {
  if (!isRecord(value) || !isCount(value.acts)) return null;
  if (value.kind !== "saved_day" && value.kind !== "live_subset") return null;
  return { kind: value.kind, acts: value.acts };
}

/**
 * The route's answer, checked against what was asked: one pair per pair sent, in order, with the same
 * names. Null when anything the page prints is missing, mistyped or for another question.
 */
export function parsePriceAnswer(json: unknown, request: PriceRequest, mode: PriceMode): PriceAnswer | null {
  if (!isRecord(json) || json.mode !== mode || typeof json.source !== "string" || !SOURCES.has(json.source)) return null;
  const source = json.source as PriceSource;
  if ((mode === "live") !== (source === "qloo_live")) return null;
  const coverage = json.coverage;
  if (!isRecord(coverage) || !isCount(coverage.acts) || !isCount(coverage.priced) || !Array.isArray(coverage.unpriced)) {
    return null;
  }
  if (!coverage.unpriced.every((name) => typeof name === "string")) return null;
  if (!isCount(json.requests_used) || !Array.isArray(json.pairs) || json.pairs.length !== request.overlaps.length) {
    return null;
  }
  const fetchedAt = typeof json.fetched_at === "string" ? json.fetched_at.slice(0, 40) : null;

  const pairs: PricedPair[] = [];
  for (const [index, item] of json.pairs.entries()) {
    const asked = request.overlaps[index];
    if (!isRecord(item) || item.a !== asked.a || item.b !== asked.b) return null;
    if (item.status === "priced") {
      const value = item.taste_overlap;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
      if (!isCount(item.pair_rank) || item.pair_rank < 1) return null;
      pairs.push({ ...asked, status: "priced", overlap: value, rank: item.pair_rank, reason: null });
    } else if (item.status === "unpriced") {
      const reason =
        item.reason === "not_ranked_on_saved_day" || item.reason === "ambiguous" ? item.reason : "no_signal";
      pairs.push({ ...asked, status: "unpriced", overlap: null, rank: null, reason });
    } else return null;
  }
  return {
    mode,
    source,
    fetchedAt,
    coverage: {
      acts: coverage.acts,
      priced: coverage.priced,
      unpriced: (coverage.unpriced as string[]).map((name) => name.slice(0, 80)),
      matched: isCount(coverage.matched) ? coverage.matched : null,
      noSignal: names(coverage.no_signal),
      ambiguous: names(coverage.ambiguous),
    },
    pairs,
    requestsUsed: json.requests_used,
    comparator: comparatorOf(json.comparator),
    presetId: typeof json.preset_id === "string" ? json.preset_id.slice(0, 80) : null,
    sent: request.acts.length,
    omitted: request.omitted,
  };
}

/** A refusal's `{"detail": {"code", "message"}}`, with the message clipped; null for any other shape. */
export function refusalOf(json: unknown): { code: string; message: string } | null {
  if (!isRecord(json) || !isRecord(json.detail)) return null;
  const { code, message } = json.detail;
  if (typeof code !== "string" || typeof message !== "string" || message === "") return null;
  return { code: code.slice(0, 40), message: message.slice(0, 200) };
}

/**
 * The one request of the check page: `POST /api/price-grid`, never cached, with the body above and
 * no credentials beyond the site's own. Never throws.
 */
export async function requestPrice(request: PriceRequest, mode: PriceMode, signal?: AbortSignal): Promise<PriceResult> {
  try {
    const response = await fetch("/api/price-grid", {
      method: "POST",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: priceBody(request, mode),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const answer = parsePriceAnswer(body, request, mode);
      return answer ? { status: "ready", answer } : { status: "error" };
    }
    const refusal = refusalOf(body);
    if (!refusal) return { status: "error" };
    if (mode === "saved" && refusal.code === "not_a_saved_day") return { status: "not_saved" };
    return { status: "refused", ...refusal };
  } catch {
    return { status: "error" };
  }
}

// ---------------------------------------------------------------------------------------------------
// The words of an answer

/** "Marble Machine × Glass Mirror". */
export function pairName(pair: Pick<PricedPair, "a" | "b">): string {
  return `${pair.a} × ${pair.b}`;
}

/** The banner over the list: where the price came from. */
export function sourceBanner(answer: Pick<PriceAnswer, "source" | "requestsUsed">): string {
  if (answer.source === "saved_day") return PRICE_COPY.savedBanner;
  if (answer.source === "invented_day") return PRICE_COPY.inventedBanner;
  return PRICE_COPY.liveBanner(answer.requestsUsed);
}

/** "19 of 21 acts priced". */
export function coverageLine(answer: Pick<PriceAnswer, "coverage">): string {
  const parts = coverageParts(answer);
  if (!parts) return `${answer.coverage.priced} of ${count(answer.coverage.acts, "act")} with a usable signal`;
  const tail = [
    parts.noSignal > 0 ? `${parts.noSignal} matched with no signal` : null,
    parts.ambiguous > 0 ? `${count(parts.ambiguous, "ambiguous name")}, not guessed` : null,
    parts.notFound > 0 ? `${parts.notFound} not found` : null,
  ].filter((part): part is string => part !== null);
  return `${count(parts.sent, "act")} sent: ${parts.matched} matched, ${parts.priced} with a usable signal${tail.length > 0 ? `; ${tail.join(", ")}` : ""}`;
}

/** The states of the acts sent (9b): matched with a signal, matched with none, ambiguous, not found. */
export type CoverageParts = { sent: number; matched: number; priced: number; noSignal: number; ambiguous: number; notFound: number };

/** The states of the acts sent, or null from a route that does not send `matched`, `no_signal` and `ambiguous`. */
export function coverageParts(answer: Pick<PriceAnswer, "coverage">): CoverageParts | null {
  const { acts, priced, unpriced, matched, noSignal, ambiguous } = answer.coverage;
  if (matched === null || noSignal === null || ambiguous === null) return null;
  return {
    sent: acts,
    matched,
    priced,
    noSignal: noSignal.length,
    ambiguous: ambiguous.length,
    notFound: Math.max(0, unpriced.length - noSignal.length - ambiguous.length),
  };
}

/** The priced pairs of an answer. */
function pricedCount(answer: Pick<PriceAnswer, "pairs">): number {
  return answer.pairs.filter((pair) => pair.status === "priced").length;
}

/**
 * One row: "A × B: 80 min shared. Audience overlap 0.91, ranked 1 of 5." The rank is among the priced
 * pairs of this answer. An unpriced row says why and that it is shown by minutes only.
 */
export function pairLine(pair: PricedPair, answer: Pick<PriceAnswer, "pairs" | "coverage">): string {
  const head = `${pairName(pair)}: ${pair.minutes} min shared.`;
  if (pair.status === "priced" && pair.overlap !== null && pair.rank !== null) {
    return `${head} Audience overlap ${pair.overlap.toFixed(2)}, ranked ${pair.rank} of ${pricedCount(answer)}.`;
  }
  if (pair.reason === "not_ranked_on_saved_day") {
    return `${head} Not compared: not ranked on the saved day. Shown by minutes only.`;
  }
  if (pair.reason === "ambiguous") {
    const unsure = [pair.a, pair.b].filter((name) => answer.coverage.ambiguous?.includes(name));
    const which = unsure.length > 0 ? unsure.join(" and ") : `${pair.a} or ${pair.b}`;
    return `${head} Not compared: ${which} matched more than one act of that name, so none was picked. Shown by minutes only.`;
  }
  const missing = [pair.a, pair.b].filter((name) => answer.coverage.unpriced.includes(name));
  const names = missing.length > 0 ? missing.join(" and ") : `${pair.a} and ${pair.b}`;
  return `${head} Not compared: no usable Qloo signal for ${names}. Shown by minutes only.`;
}

/** The pairs as listed: longest first (the grid's order), or highest audience overlap first with unpriced pairs last. */
export function sortedPairs(answer: Pick<PriceAnswer, "pairs">, order: "minutes" | "overlap"): PricedPair[] {
  const pairs = [...answer.pairs];
  if (order === "minutes") return pairs;
  const position = new Map(pairs.map((pair, index) => [pair, index]));
  return pairs.sort((x, y) => {
    if (x.overlap === null || y.overlap === null) {
      if (x.overlap !== y.overlap) return x.overlap === null ? 1 : -1;
    } else if (x.overlap !== y.overlap) return y.overlap - x.overlap;
    return (position.get(x) as number) - (position.get(y) as number);
  });
}

/**
 * Whether audience overlap reorders the compared overlaps, judged among the priced pairs only: their
 * order by minutes against their order by audience overlap. "Audience overlap changes the order of the
 * 4 compared overlaps: A × B moves from 4th to 1st." (the pair that rises most), or "does not change
 * the order". An unpriced pair is never part of that comparison: a separate sentence says it is listed
 * last. Null when fewer than two pairs were priced, so there is no order to compare.
 */
export function orderLine(answer: Pick<PriceAnswer, "pairs">): string | null {
  const priced = answer.pairs.filter((pair) => pair.status === "priced" && pair.overlap !== null);
  if (priced.length < 2) return null;
  const byOverlap = sortedPairs({ pairs: priced }, "overlap");
  let best: { pair: PricedPair; from: number; to: number } | null = null;
  priced.forEach((pair, from) => {
    const to = byOverlap.indexOf(pair);
    if (to >= from) return;
    if (!best || from - to > best.from - best.to || (from - to === best.from - best.to && to < best.to)) {
      best = { pair, from, to };
    }
  });
  const unpriced = answer.pairs.length - priced.length;
  const tail =
    unpriced === 0
      ? ""
      : unpriced === 1
        ? " The overlap without a reading is listed last, by minutes only."
        : ` The ${unpriced} overlaps without a reading are listed last, by minutes only.`;
  const compared = `the ${priced.length} compared overlaps`;
  const moved = best as { pair: PricedPair; from: number; to: number } | null;
  if (!moved) return `Audience overlap does not change the order of ${compared}.${tail}`;
  return `Audience overlap changes the order of ${compared}: ${pairName(moved.pair)} moves from ${ordinal(moved.from + 1)} to ${ordinal(moved.to + 1)}.${tail}`;
}
