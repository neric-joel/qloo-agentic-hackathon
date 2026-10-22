/**
 * "Compare audience overlap (optional)" on the check page, and the check route's one network module.
 * Nothing of the visitor's grid leaves the browser until they press Compare audience overlap: that press
 * sends `POST /api/price-grid` with act names and the pairs to compare, and nothing else: no times,
 * stages, rules or settings, and never the share link's hash. A saved request sends only the names in the
 * pairs it compares (a saved value does not depend on the other names), plus the fewest other names of the
 * matched day the server needs to recognise it; a live request keeps its bounded comparison set (at most 25
 * names), because a live value is a rank among the names sent. The request and the answer are built and
 * read here as plain functions, so they are unit tested; `requestPrice` is the only call that sends any
 * of the grid, and it never throws.
 *
 * The other calls here only read this app's own API and carry nothing of the visitor's: `GET /api/health`
 * (whether this server prices live, so the page never offers what it would refuse), `GET /api/presets`
 * with `GET /api/presets/{id}` and its lens (the public timetables: "Check a published day", and the pairs
 * a saved day can serve), and `POST /api/presets/{id}/whatif` with a change Find a change listed on a
 * published day (rule steps of that public timetable, scored on its index). None of them reaches Qloo.
 *
 * The contract is the price-grid contract (kept outside this repository): `saved` matches the names to
 * a saved festival day or the invented example day and sends no Qloo request; `live` asks Qloo, is
 * capped per visitor and for everyone, and is offered only after `saved` answers `not_a_saved_day`, and
 * only when the server says live pricing is on (with it off, no saved day is a 200 `no_saved_day`). A
 * saved body takes up to 60 act names and 10 pairs; a live body 25 and 5.
 */

import { isPriceGridLive } from "@/lib/agent-status";
import { normalizeName, type CheckReport, type SharedPair } from "@/lib/check";
import { parseLenses } from "@/lib/lenses";

export const PRICE_LIMITS = {
  /** Overlaps compared at most for a pasted grid no saved day is known to hold (it may go live), longest first. */
  pairs: 5,
  /**
   * Pairs compared at most in saved mode: a published day loaded here (its saved ranking), or a pasted grid
   * whose names match a published day (the pairs that day serves first, then the longest).
   */
  savedPairs: 10,
  /** Of a pasted grid's compared pairs, how many show open; the rest wait in a closed fold. */
  shownOpen: 5,
  /** The share of the grid's names a saved day must hold, as the server rules (`SAVED_SHARE`). */
  savedShare: 0.8,
  /** Distinct acts the route needs. */
  minActs: 4,
  /** The most act names a live answer takes. */
  maxActs: 25,
  /** The most act names a saved answer takes (it sends no Qloo request). */
  savedActs: 60,
} as const;

export type PriceMode = "saved" | "live";

/** One overlap the page asks about: two act names as the page shows them, and its minutes on this grid. */
export type PriceOverlap = { a: string; b: string; minutes: number };

/** Why an overlap the rule passed over was never sent: both sets locked, or an act with no usable signal. */
export type PassedReason = "locked" | "no_signal";

/** An overlap passed over before the request, with its reason. */
export type PassedOverlap = PriceOverlap & { reason: PassedReason };

/**
 * How the pairs were chosen: a pasted grid's longest overlaps; (a published day loaded here) the saved day's
 * own ranked clashes, costliest first by this app's index; or (a pasted grid whose names match a published
 * day) the overlaps that day's timetable page prints first, then the longest.
 */
export type PriceBasis = "longest" | "saved_ranking" | "served";

/**
 * A published day as the saved server can answer for it, read from its public timetable and its "Two
 * rankings of this day" lens (no value of either is kept): its act names, the acts it marks as having no
 * usable signal, and the pairs its timetable page prints a taste overlap or rank for (the ranked clashes,
 * the clash receipts and the lens pairs). Each of those pairs is one the server serves (`pair.taste_pairs`
 * holds them all), so none can be a false positive; the server may serve a few more (twins, the sourced
 * hidden clash), which this page does not count on. Names are keyed by `matchKey`.
 */
export type ServableDay = {
  id: string;
  title: string;
  /** The day's scheduled acts by match key, names two acts share left out (the server never matches them). */
  names: ReadonlyMap<string, string>;
  /** Match keys of the acts the day marks as having no usable signal. */
  noSignal: ReadonlySet<string>;
  /** `pairKey` of two match keys, for every pair the page prints. */
  pairs: ReadonlySet<string>;
};

/**
 * A published day's own ranking, as the presets route already serves it: its ranked clashes, costliest
 * first, as act names, and the acts it marks as having no usable signal. Held in memory for the request;
 * no value of it is printed.
 */
export type SavedRanking = { pairs: { a: string; b: string }[]; noSignal: string[] };

/** What one press of Compare audience overlap sends, and what the page needs to word it. */
export type PriceRequest = {
  /**
   * The act names a saved answer is asked with: only the names in `overlaps`, plus (when that leaves fewer
   * than 4, or too few of the matched day's names for the server to recognise it) the fewest other names of
   * the grid that are on that day. A saved value does not depend on the names sent, so no figure changes.
   */
  acts: string[];
  /** The act names a live answer would send: the acts of `liveOverlaps` first, then the grid's, at most 25. */
  liveActs: string[];
  /** The pairs a saved answer is asked about, in the rule's order. */
  overlaps: PriceOverlap[];
  /** The pairs a live answer would ask about: the grid's 5 longest overlaps, both-locked passed over. */
  liveOverlaps: PriceOverlap[];
  /** Qloo requests a live answer may use: one per live act, plus one per distinct act named in a pair. */
  need: number;
  /** Different acts in the grid. */
  total: number;
  /** Acts of the grid left out of a saved request because of its cap: 0, since it sends only the pairs' names. */
  omitted: number;
  /** Acts of the grid left out of a live request (past 25). */
  liveOmitted: number;
  /**
   * Overlaps passed over, with the reason: both sets locked (neither can move) or an act the saved day marks
   * as having no usable signal. Never sent, so never compared; the next one in the rule's order is sent instead.
   */
  skipped: PassedOverlap[];
  basis: PriceBasis;
  /** The published day a pasted grid's names match (basis "served"): its title, and how many pairs it serves. */
  served?: { title: string; pairs: number } | null;
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
  /** How the pairs were chosen (the request's rule); an older caller without it reads as "longest". */
  basis?: PriceBasis;
};

export type PriceResult =
  | { status: "ready"; answer: PriceAnswer }
  /**
   * `saved` found no saved day for these names. `liveOff`: the server said so in a 200 answer because live
   * pricing is off there (nothing to offer); otherwise a 422, after which the page may offer the live button.
   */
  | { status: "not_saved"; liveOff?: boolean }
  /** A refusal with the route's own sentence (a cap, live switched off, too few acts matched). */
  | { status: "refused"; code: string; message: string }
  | { status: "error" };

/** The step's name: it compares bill-relative audience overlap ranks, not the home page's pair score. */
const COMPARE = "Compare audience overlap";

/**
 * What a saved press sends, said in one sentence: the pairs (`what`) and the act names, and nothing else.
 * "their N act names" only when every name sent is one of the pairs' own (`extra` 0); with the few names
 * added so the server can find the day (`savedNames`), the count alone, which stays true.
 */
function sends(what: string, k: number, n: number, extra: number): string {
  const names = extra > 0 ? count(n, "act name") : `${k === 1 ? "its" : "their"} ${count(n, "act name")}`;
  return `Compare sends this site’s server ${what} and ${names}, never times, stages or rules; names are not stored or logged`;
}

/** "the 5 longest movable overlaps", or "the longest movable overlap" for one. */
function longestMovable(k: number): string {
  return k === 1 ? "the longest movable overlap" : `the ${k} longest movable overlaps`;
}

/** The page's wording for the audience step, in one place. */
export const PRICE_COPY = {
  heading: `${COMPARE} (optional)`,
  /**
   * Before the press, at most 45 words (`intro.test`): that the rule checks used no Qloo data, what a saved
   * request sends (only the compared pairs and their act names; never times, stages or rules; no name stored
   * or logged) and what happens with no saved day. `live` is whether this server prices live (from its health
   * answer; unknown counts as off), so the last sentence never offers what the server would refuse. A live
   * request is a separate step with its own consent text, which states its own count of names (`thirdParty`).
   * `extra`: names sent beyond the pairs' own (`PriceRequest.acts` less the pairs' names).
   */
  intro: (
    k: number,
    n: number,
    live = false,
    basis: PriceBasis = "longest",
    served: PriceRequest["served"] = null,
    extra = 0,
  ) => {
    const lead = "Rule checks used no Qloo data.";
    if (basis === "saved_ranking") {
      const what = `the saved day’s ${count(k, "costliest movable clash", "costliest movable clashes")}, by its own ranking,`;
      return `${lead} ${sends(what, k, n, extra)}, and nothing goes to Qloo.`;
    }
    if (basis === "served" && served) {
      const what =
        served.pairs === 0
          ? longestMovable(k)
          : served.pairs >= k
            ? `${longestMovable(k)} its timetable page prints`
            : `${count(k, "movable overlap")}, those its timetable page prints first,`;
      return `${lead} These acts are on ${served.title}. ${sends(what, k, n, extra)}.`;
    }
    return `${lead} ${sends(longestMovable(k), k, n, extra)}. ${
      live ? "With no saved day, you can choose to ask Qloo instead." : "With no saved day, nothing is compared: live Qloo comparison is off here."
    }`;
  },
  button: COMPARE,
  savedBanner: "Compared using a saved festival day. No Qloo request was sent.",
  inventedBanner:
    "Compared using the invented example day: its acts and affinities are invented, not Qloo data. No Qloo request was sent.",
  liveBanner: (used: number) => `Asked Qloo just now. This used ${count(used, "Qloo request")}.`,
  /** No saved day matched and this server prices live: the consent text above the live button. */
  notSaved: (n: number, need: number) =>
    `These acts are not on a saved day. We can ask Qloo now. ${thirdParty(n)} A live answer uses about ${need} Qloo requests; live comparison is capped per day on this server.`,
  /** No saved day matched and this server does not price live (or did not say): no live button. */
  liveOff:
    "These acts are not on a saved day, and live comparison with Qloo is off on this server, so nothing was compared and no Qloo request was sent. A published day still compares.",
  /** The one action after `liveOff`: "Check a published day", by that day's title. */
  tryPublished: (title: string) => `Try it on ${title}`,
  /** After an answer in which no pair sent got a value because none is one the saved day's page prints. */
  noneServed: (title: string | null) =>
    `None of these overlaps got a value: this site serves saved Qloo values only for the pairs the timetable page of ${title ?? "that saved day"} prints.`,
  /** Why a pair sent in saved mode has no value: the licence guardrail, in words. */
  notServed: "not served: this site serves saved Qloo values only for the pairs its timetable page prints",
  /** No saved day matched a published timetable loaded here: it compares from its saved day only. */
  publishedNotSaved:
    "These acts are not on a saved day, so they are not compared. A published timetable loaded here compares from its saved day only; nothing is sent to Qloo.",
  askButton: (n: number) => `Ask Qloo for these ${count(n, "act")}`,
  loading: "Comparing.",
  error: "The server did not answer, so nothing was compared. Your rule results are unchanged.",
  retry: "Try again",
  tooFew: `Comparing audience overlap needs at least ${PRICE_LIMITS.minActs} different acts in the grid.`,
  noOverlap: "No two sets share time, so there is nothing to compare.",
  /** Before an answer: what each kind of answer ranks among. */
  scopeBefore:
    "Each value is a rank within a lineup, not attendance: from a saved day, a rank among that day’s lineup; from Qloo live, a rank among the acts sent.",
  cbi: "The Clash Budget Index needs a full scored day and is not computed here.",
  /** A published day's default order: the order its pairs were chosen in, the saved day's costliest first. */
  rankingFirst: "This app’s ranking",
  longestFirst: "Longest first",
  overlapFirst: "Highest taste overlap first",
  sortLabel: "Order",
  /** The closed fold that holds a pasted grid's compared pairs past the first five. */
  moreCompared: (n: number) => `${n === 1 ? "1 more compared overlap" : `${n} more compared overlaps`}`,
  briefHeading: (k: number, basis: PriceBasis = "longest") =>
    basis === "saved_ranking"
      ? `Taste overlap compared (the saved day’s ${count(k, "costliest clash", "costliest clashes")} that can move)`
      : basis === "served"
        ? `Taste overlap compared (${count(k, "overlap")}, those the saved day’s page prints first)`
        : `Taste overlap compared (${count(k, "longest overlap")})`,
  /**
   * Beside the values of a published day's compare: its pairs were chosen by the saved day's index, which
   * already counts taste overlap, so the order sentence above it is an illustration and not evidence.
   */
  workedExample:
    "These pairs are the saved day's costliest by this app's index, which already includes taste overlap: a worked example, not a test.",
  /** The closed fold that lists, with its reason, each overlap the step did not compare. */
  notComparedSummary: (n: number) => `Why ${n === 1 ? "this was" : "these were"} not compared (${n})`,
} as const;

/** The third-party sentence of the live consent: what leaves for Qloo, and whose terms govern it. */
export function thirdParty(n: number): string {
  return `This sends ${count(n, "act name")} to Qloo, a third party; Qloo's terms govern what it keeps. Do not send acts you have not announced.`;
}

/**
 * An overlap left out because both of its sets are locked, with its reason in words. A lock says a set
 * cannot move; it says nothing about whether the overlap is wanted.
 */
export function lockedLine(overlap: PriceOverlap, basis: PriceBasis = "longest"): string {
  const next = basis === "saved_ranking" ? "the next clash in the saved day’s ranking" : "the next-longest overlap";
  return `${pairName(overlap)}: ${overlap.minutes} min shared. Not compared: both sets are marked locked in this grid, so neither can move; ${next} is compared instead.`;
}

/** An overlap passed over before the request, with its reason in words. */
export function passedLine(overlap: PassedOverlap, basis: PriceBasis = "longest"): string {
  if (overlap.reason === "locked") return lockedLine(overlap, basis);
  return `${pairName(overlap)}: ${overlap.minutes} min shared. Not compared: the saved day marks an act of this pair as having no usable Qloo signal, so it was not sent.`;
}

/** "This grid has 70 different acts and at most 60 are sent, so 10 acts are not sent and not compared." */
export function omittedLine(omitted: number, total: number, cap: number = PRICE_LIMITS.savedActs): string {
  return `This grid has ${total} different acts and at most ${cap} are sent, so ${count(omitted, "act")} ${
    omitted === 1 ? "is" : "are"
  } not sent and not compared.`;
}

/**
 * What the values of an answer are ranks among: the saved day's own lineup for a saved answer (it
 * keeps that day's normalisation, whatever was pasted), the invented day's lineup for the sample, and
 * the acts sent for a live answer; with the grid's acts that were not sent counted.
 */
export function rankScope(answer: ScopeOf): string {
  const cap = answer.source === "qloo_live" ? PRICE_LIMITS.maxActs : PRICE_LIMITS.savedActs;
  const left = answer.omitted > 0 ? ` ${omittedLine(answer.omitted, answer.sent + answer.omitted, cap)}` : "";
  const lineup = answer.comparator?.kind === "saved_day" ? ` of ${count(answer.comparator.acts, "act")}` : "";
  if (answer.source === "saved_day") {
    // A published day loaded here was not pasted, so the scope never says "the acts you pasted" there.
    const pasted = answer.basis === "saved_ranking" ? "" : ", not among the acts you pasted,";
    return `Values come from the saved day: each is a rank among the acts on that day’s lineup${lineup}${pasted} and not attendance. “Taste rank 1 of n” orders only the pairs compared here.${left}`;
  }
  if (answer.source === "invented_day") {
    return `Values come from the invented example day: ranks among its invented lineup${lineup}, not Qloo data and not attendance. “Taste rank 1 of n” orders only the pairs compared here.${left}`;
  }
  const among =
    answer.comparator?.kind === "live_subset"
      ? `the ${count(answer.comparator.acts, "act")} Qloo matched of the ${answer.sent} sent`
      : `the ${count(answer.sent, "act")} sent to Qloo`;
  return `A rank among ${among} just now, not attendance, and not comparable with a published day’s figures.${left}`;
}

/** What `rankScope` reads of an answer; `comparator` is optional so an older answer still words. */
export type ScopeOf = Pick<PriceAnswer, "source" | "sent" | "omitted"> & {
  comparator?: PriceAnswer["comparator"];
  basis?: PriceBasis;
};

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

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("\u0000");
}

/** A pasted grid's rule: its longest overlaps, one per pair of acts, a pair with both sets locked passed over. */
function longestPairs(report: Pick<CheckReport, "shared">): { chosen: SharedPair[]; passed: PassedOverlap[] } {
  const seen = new Set<string>();
  const chosen: SharedPair[] = [];
  const passed: PassedOverlap[] = [];
  for (const pair of report.shared) {
    const key = pairKey(pair.a.actKey, pair.b.actKey);
    if (seen.has(key)) continue;
    seen.add(key);
    if (pair.a.locked && pair.b.locked) {
      passed.push({ a: pair.a.act, b: pair.b.act, minutes: pair.minutes, reason: "locked" });
      continue;
    }
    chosen.push(pair);
    if (chosen.length === PRICE_LIMITS.pairs) break;
  }
  return { chosen, passed };
}

/**
 * A published day's rule: the saved day's ranked clashes in its own order (costliest first by this app's
 * index), each matched to the overlap it is on the grid checked; a pair whose two sets are both locked, or
 * with an act the saved day marks as having no usable signal, is passed over with its reason; at most 10.
 * A ranked pair that no longer shares time on this grid (a change was tried) is not an overlap here.
 */
function rankedPairs(
  report: Pick<CheckReport, "shared">,
  ranking: SavedRanking,
): { chosen: SharedPair[]; passed: PassedOverlap[] } {
  const longest = new Map<string, SharedPair>();
  for (const pair of report.shared) {
    const key = pairKey(pair.a.actKey, pair.b.actKey);
    if (!longest.has(key)) longest.set(key, pair);
  }
  const quiet = new Set(ranking.noSignal.map(normalizeName));
  const seen = new Set<string>();
  const chosen: SharedPair[] = [];
  const passed: PassedOverlap[] = [];
  for (const ranked of ranking.pairs) {
    const key = pairKey(normalizeName(ranked.a), normalizeName(ranked.b));
    const found = longest.get(key);
    if (!found || seen.has(key)) continue;
    seen.add(key);
    // Named in the saved ranking's own order, as the timetable page names the pair.
    const pair = found.a.actKey === normalizeName(ranked.a) ? found : { ...found, a: found.b, b: found.a };
    const shown = { a: pair.a.act, b: pair.b.act, minutes: pair.minutes };
    if (pair.a.locked && pair.b.locked) {
      passed.push({ ...shown, reason: "locked" });
      continue;
    }
    if (quiet.has(pair.a.actKey) || quiet.has(pair.b.actKey)) {
      passed.push({ ...shown, reason: "no_signal" });
      continue;
    }
    chosen.push(pair);
    if (chosen.length === PRICE_LIMITS.savedPairs) break;
  }
  return { chosen, passed };
}

/**
 * A pasted grid on a published day: up to 10 overlaps, first those the day's timetable page prints (each one
 * the saved server serves), longest first, then the other overlaps, longest first; one per pair of acts, a
 * pair with both sets locked or with an act the day marks as having no usable signal passed over with its
 * reason. `served` is how many of the chosen came from the page's pairs.
 */
function servedPairs(
  report: Pick<CheckReport, "shared">,
  day: ServableDay,
): { chosen: SharedPair[]; passed: PassedOverlap[]; served: number } {
  const seen = new Set<string>();
  const first: SharedPair[] = [];
  const rest: SharedPair[] = [];
  const passed: PassedOverlap[] = [];
  for (const pair of report.shared) {
    const key = pairKey(pair.a.actKey, pair.b.actKey);
    if (seen.has(key)) continue;
    seen.add(key);
    const shown = { a: pair.a.act, b: pair.b.act, minutes: pair.minutes };
    if (pair.a.locked && pair.b.locked) {
      passed.push({ ...shown, reason: "locked" });
      continue;
    }
    if (day.noSignal.has(matchKey(pair.a.act)) || day.noSignal.has(matchKey(pair.b.act))) {
      passed.push({ ...shown, reason: "no_signal" });
      continue;
    }
    (day.pairs.has(pairKey(matchKey(pair.a.act), matchKey(pair.b.act))) ? first : rest).push(pair);
  }
  const served = first.slice(0, PRICE_LIMITS.savedPairs);
  const chosen = [...served, ...rest].slice(0, PRICE_LIMITS.savedPairs);
  // Once the slots are full, a passed-over overlap shorter than every chosen one was never in contention.
  const shortest = chosen.length === PRICE_LIMITS.savedPairs ? Math.min(...chosen.map((pair) => pair.minutes)) : -1;
  return { chosen, passed: passed.filter((item) => item.minutes >= shortest), served: served.length };
}

/**
 * The names a saved request sends: those in the pairs, each once, in pair order; then, only when the server
 * would not recognise the day from them, the fewest other names of the grid that are on the matched day (in
 * grid order): enough for 4 names and for the matched day to hold `savedShare` of those sent. With no day
 * matched here, only the 4-name floor applies.
 */
function savedNames(chosen: readonly SharedPair[], grid: ReadonlyMap<string, string>, day: ServableDay | null): string[] {
  const keys: string[] = [];
  const add = (key: string) => {
    if (!keys.includes(key)) keys.push(key);
  };
  for (const pair of chosen) {
    add(pair.a.actKey);
    add(pair.b.actKey);
  }
  const onDay = (key: string) => day !== null && day.names.has(matchKey(grid.get(key) as string));
  const short = () =>
    keys.length < PRICE_LIMITS.minActs ||
    (day !== null && keys.filter(onDay).length < PRICE_LIMITS.savedShare * keys.length);
  for (const key of grid.keys()) {
    if (!short() || keys.length >= PRICE_LIMITS.savedActs) break;
    if (day === null || onDay(key)) add(key);
  }
  // A grid with too few names on the day still needs 4 names in all.
  for (const key of grid.keys()) {
    if (keys.length >= PRICE_LIMITS.minActs) break;
    add(key);
  }
  return keys.map((key) => grid.get(key) as string);
}

/**
 * The pairs to compare and the act names to send. A published day loaded here (`ranking` given): up to 10
 * of the saved day's own ranked clashes, costliest first, both-locked and no-signal pairs passed over. A
 * pasted grid whose names match a published day (`day` given): up to 10 overlaps, the pairs that day's
 * timetable page prints first (`servedPairs`). Otherwise, or when neither leaves a pair: the 5 longest
 * overlaps, both-locked pairs passed over. A saved request sends only the names of its pairs (`savedNames`).
 * A live request is the pasted rule as it always was: the 5 longest overlaps, their acts first and then the
 * grid's other acts in grid order, at most 25. Null when the grid has fewer than four different acts or no
 * pair to compare.
 */
export function priceRequest(
  report: Pick<CheckReport, "sets" | "shared">,
  ranking: SavedRanking | null = null,
  day: ServableDay | null = null,
): PriceRequest | null {
  const names = new Map<string, string>();
  for (const set of report.sets) if (!names.has(set.actKey)) names.set(set.actKey, set.act);
  if (names.size < PRICE_LIMITS.minActs) return null;

  const longest = longestPairs(report);
  let basis: PriceBasis = "longest";
  let { chosen, passed } = longest;
  let served: PriceRequest["served"] = null;
  if (ranking) {
    const ranked = rankedPairs(report, ranking);
    if (ranked.chosen.length > 0) ({ chosen, passed, basis } = { ...ranked, basis: "saved_ranking" });
  } else if (day) {
    const fill = servedPairs(report, day);
    if (fill.chosen.length > 0) {
      ({ chosen, passed } = fill);
      basis = "served";
      served = { title: day.title, pairs: fill.served };
    }
  }
  if (chosen.length === 0) return null;

  const live: string[] = [];
  const addLive = (key: string) => {
    if (!live.includes(key) && live.length < PRICE_LIMITS.maxActs) live.push(key);
  };
  for (const pair of longest.chosen) {
    addLive(pair.a.actKey);
    addLive(pair.b.actKey);
  }
  for (const key of names.keys()) addLive(key);
  const inLivePairs = new Set(longest.chosen.flatMap((pair) => [pair.a.actKey, pair.b.actKey]));
  const overlap = (pair: SharedPair): PriceOverlap => ({
    a: names.get(pair.a.actKey) as string,
    b: names.get(pair.b.actKey) as string,
    minutes: pair.minutes,
  });
  return {
    total: names.size,
    omitted: 0,
    liveOmitted: names.size - live.length,
    acts: savedNames(chosen, names, ranking ? null : day),
    liveActs: live.map((key) => names.get(key) as string),
    overlaps: chosen.map(overlap),
    liveOverlaps: longest.chosen.map(overlap),
    need: live.length + inLivePairs.size,
    skipped: passed,
    basis,
    served,
  };
}

/** The act names a request sends in this mode: the compared pairs' names for a saved answer, up to 25 for a live one. */
export function sentActs(request: Pick<PriceRequest, "acts" | "liveActs">, mode: PriceMode): string[] {
  return mode === "live" ? request.liveActs : request.acts;
}

/** Names a saved request sends beyond its pairs' own: the fewest the server needs to find the day (often 0). */
export function extraNames(request: Pick<PriceRequest, "acts" | "overlaps">): number {
  const own = new Set(request.overlaps.flatMap((o) => [o.a, o.b]));
  return request.acts.filter((name) => !own.has(name)).length;
}

/** The pairs a request asks about in this mode. */
export function sentOverlaps(request: Pick<PriceRequest, "overlaps" | "liveOverlaps">, mode: PriceMode): PriceOverlap[] {
  return mode === "live" ? request.liveOverlaps : request.overlaps;
}

/** The body as sent: exactly `acts`, `pairs` and `mode`. */
export function priceBody(request: PriceRequest, mode: PriceMode): string {
  return JSON.stringify({
    acts: sentActs(request, mode),
    pairs: sentOverlaps(request, mode).map((o) => [o.a, o.b]),
    mode,
  });
}

// ---------------------------------------------------------------------------------------------------
// The published days a pasted grid may be on

/**
 * A name as the saved server matches it (`qloo.overlap._normalize`): case folded, accents and punctuation
 * dropped, "&" read as "and", and a leading "the" dropped.
 */
export function matchKey(name: string): string {
  const kept = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\p{P}\p{S}\p{Z}]/gu, " ");
  const words = kept.split(/\s+/).filter((word) => word !== "");
  if (words.length > 1 && words[0] === "the") words.shift();
  return words.join(" ");
}

/**
 * A published day as the saved server can serve it, from its public JSON (`GET /api/presets/{id}`) and the
 * lens answers of its days (`GET /api/presets/{id}/lenses`): see `ServableDay`. Null for an invented day or a
 * JSON that is not a festival day. Reads names and ids only; no value.
 */
export function servableDay(json: unknown, lenses: readonly unknown[] = []): ServableDay | null {
  if (!isRecord(json) || json.synthetic === true || typeof json.id !== "string" || typeof json.title !== "string") return null;
  const festival = isRecord(json.festival) ? json.festival : null;
  if (!festival || !Array.isArray(festival.acts) || !Array.isArray(festival.timetable)) return null;
  const scheduled = new Set(
    (festival.timetable as unknown[]).flatMap((slot) => (isRecord(slot) && typeof slot.act_id === "string" ? [slot.act_id] : [])),
  );
  const byId = new Map<string, string>();
  const keys = new Map<string, string | null>();
  for (const act of festival.acts as unknown[]) {
    if (!isRecord(act) || typeof act.id !== "string" || typeof act.name !== "string") continue;
    byId.set(act.id, act.name);
    if (!scheduled.has(act.id)) continue;
    const key = matchKey(act.name);
    keys.set(key, keys.has(key) ? null : act.name);
  }
  const names = new Map([...keys].filter((entry): entry is [string, string] => entry[1] !== null));
  const pairs = new Set<string>();
  const addIds = (a: unknown, b: unknown) => {
    if (typeof a !== "string" || typeof b !== "string" || a === b || !scheduled.has(a) || !scheduled.has(b)) return;
    const [x, y] = [byId.get(a), byId.get(b)];
    if (x === undefined || y === undefined) return;
    const [kx, ky] = [matchKey(x), matchKey(y)];
    if (names.has(kx) && names.has(ky)) pairs.add(pairKey(kx, ky));
  };
  const report = isRecord(json.report) ? json.report : null;
  for (const clash of Array.isArray(report?.clashes) ? (report.clashes as unknown[]) : []) {
    if (isRecord(clash) && isRecord(clash.a) && isRecord(clash.b)) addIds(clash.a.act_id, clash.b.act_id);
  }
  const evidence = isRecord(json.evidence) ? json.evidence : null;
  const receipts = isRecord(evidence?.receipts) ? (evidence.receipts as Record<string, unknown>) : {};
  for (const key of Object.keys(receipts)) {
    const ids = key.split("|");
    if (ids.length === 2) addIds(ids[0], ids[1]);
  }
  for (const raw of lenses) {
    const lens = parseLenses(raw);
    if (!lens) continue;
    for (const pair of [...lens.with_taste, ...lens.without_taste, ...lens.apart]) addIds(pair.a_id, pair.b_id);
  }
  const coverage = isRecord(report?.coverage) ? report.coverage : null;
  const noSignal = new Set(
    (Array.isArray(coverage?.unscored) ? (coverage.unscored as unknown[]) : []).flatMap((item) => {
      const name = isRecord(item) && typeof item.act_id === "string" ? byId.get(item.act_id) : undefined;
      return name === undefined ? [] : [matchKey(name)];
    }),
  );
  return { id: json.id, title: json.title.trim().slice(0, 80), names, noSignal, pairs };
}

/**
 * The published day the grid's names are on, by the server's own rule: the day that holds the most of them,
 * the first on a tie, and only when it holds at least `savedShare` of them. Null otherwise.
 */
export function matchServableDay(names: readonly string[], days: readonly ServableDay[]): ServableDay | null {
  const keys = [...new Set(names.map(matchKey))];
  let best: { day: ServableDay; found: number } | null = null;
  for (const day of days) {
    const found = keys.filter((key) => day.names.has(key)).length;
    if (!best || found > best.found) best = { day, found };
  }
  return best && keys.length > 0 && best.found >= PRICE_LIMITS.savedShare * keys.length ? best.day : null;
}

/** The days of their timetable, from a published day's JSON: the lens is asked once per day. */
function timetableDays(json: unknown): number[] {
  const festival = isRecord(json) && isRecord(json.festival) ? json.festival : null;
  const slots = Array.isArray(festival?.timetable) ? (festival.timetable as unknown[]) : [];
  const days = slots.flatMap((slot) =>
    isRecord(slot) && typeof slot.day === "number" && Number.isInteger(slot.day) && slot.day >= 0 && slot.day <= 13 ? [slot.day] : [],
  );
  return [...new Set(days)].sort((x, y) => x - y);
}

/**
 * Every published day this app's API serves, as `ServableDay`s: the list, each day's public JSON and its
 * lens per day, read once (GETs of this app's own API, never cached by the browser, carrying nothing of the
 * visitor's). An empty list when any read fails; the page then compares by the pasted rule.
 */
export async function loadServableDays(signal?: AbortSignal): Promise<ServableDay[]> {
  const list = await getJson("/api/presets", signal);
  if (!Array.isArray(list)) return [];
  const ids = list.flatMap((item) =>
    isRecord(item) && item.synthetic !== true && typeof item.id === "string" && /^[\w.-]{1,80}$/.test(item.id) ? [item.id] : [],
  );
  const days = await Promise.all(
    ids.slice(0, 8).map(async (id) => {
      const json = await getJson(`/api/presets/${encodeURIComponent(id)}`, signal);
      const lenses = await Promise.all(
        timetableDays(json).map((day) => getJson(`/api/presets/${encodeURIComponent(id)}/lenses?day=${day}`, signal)),
      );
      return servableDay(json, lenses);
    }),
  );
  return days.filter((day): day is ServableDay => day !== null);
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
  return value.slice(0, PRICE_LIMITS.savedActs).map((name: string) => name.slice(0, 80));
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
  const overlaps = sentOverlaps(request, mode);
  if (!isCount(json.requests_used) || !Array.isArray(json.pairs) || json.pairs.length !== overlaps.length) {
    return null;
  }
  const fetchedAt = typeof json.fetched_at === "string" ? json.fetched_at.slice(0, 40) : null;

  const pairs: PricedPair[] = [];
  for (const [index, item] of json.pairs.entries()) {
    const asked = overlaps[index];
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
    sent: sentActs(request, mode).length,
    omitted: mode === "live" ? request.liveOmitted : request.omitted,
    basis: request.basis,
  };
}

/**
 * The saved answer for names no saved day holds while live pricing is off on the server: a 200 with
 * `status: "no_saved_day"` and no request used (no error for the browser to log).
 */
export function noSavedDay(json: unknown): boolean {
  return isRecord(json) && json.mode === "saved" && json.status === "no_saved_day" && json.requests_used === 0;
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
    if (response.ok && mode === "saved" && noSavedDay(body)) return { status: "not_saved", liveOff: true };
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

/**
 * A GET of this app's own API: no body, no credentials beyond the site's own, nothing of the visitor's
 * grid. The decoded body, or null for an error status, a failed network or a body that is not JSON.
 */
async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

/** Whether this server prices live now (`price_grid_live` in `GET /api/health`). No answer counts as off. */
export async function priceGridLive(signal?: AbortSignal): Promise<boolean> {
  return isPriceGridLive(await getJson("/api/health", signal));
}

/** A published (not invented) festival day this app's API serves: its id and its title. */
export type PublishedDay = { id: string; title: string };

/** The first day of `GET /api/presets` that is not the invented one, or null when there is none. */
export function firstPublishedDay(json: unknown): PublishedDay | null {
  if (!Array.isArray(json)) return null;
  for (const item of json) {
    if (!isRecord(item) || item.synthetic === true) continue;
    if (typeof item.id !== "string" || typeof item.title !== "string") continue;
    const id = item.id.trim();
    const title = item.title.trim().slice(0, 80);
    if (title !== "" && /^[\w.-]{1,80}$/.test(id)) return { id, title };
  }
  return null;
}

/** Every day of `GET /api/presets` that is not the invented one, in the API's order; empty when none answers. */
export function publishedDays(json: unknown): PublishedDay[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((item) => {
    const day = firstPublishedDay([item]);
    return day ? [day] : [];
  });
}

/** "Check a published day": every day to offer, from `GET /api/presets`, in its order; null when none answers. */
export async function loadPublishedDays(signal?: AbortSignal): Promise<PublishedDay[] | null> {
  const days = publishedDays(await getJson("/api/presets", signal));
  return days.length > 0 ? days : null;
}

/** "Check a published day": which day to offer, from `GET /api/presets`; null when none answers. */
export async function loadPublishedDay(signal?: AbortSignal): Promise<PublishedDay | null> {
  return firstPublishedDay(await getJson("/api/presets", signal));
}

/** The published day's own JSON from `GET /api/presets/{id}`, or null. Read with `publishedDayInput`. */
export async function loadPublishedTimetable(id: string, signal?: AbortSignal): Promise<unknown> {
  return getJson(`/api/presets/${encodeURIComponent(id)}`, signal);
}

// ---------------------------------------------------------------------------------------------------
// A change Find a change listed, scored on a published day's index

/** One set of a change, in the published day's own ids: where it goes. `start` is "H:MM" from the day's start. */
export type ScoreMove = { act: string; stageId: string; day: number; start: string };

/**
 * One change as the what-if route takes a rule step (as `stack.ts` builds them): the pair it serves, by the
 * published day's act ids, and its one or two moves.
 */
export type ScoreStep = { a: string; b: string; moves: ScoreMove[] };

/** A change's index, or why it was not scored, in words. */
export type IndexScore = { status: "scored"; before: number; after: number } | { status: "not_scored"; reason: string };

/** At most this many listed changes are scored per press of Find a change. */
export const SCORE_LIMIT = 3;

export const SCORE_COPY = {
  /** Where scoring cannot run (a pasted grid, the invented sample, a grid not on a saved day). */
  unavailable: "Index scoring is available on the published days only.",
  /**
   * Over the list on a published day: what is scored, and what leaves the browser for it (the changes, as
   * changes to that public timetable; nothing of a paste, and no Qloo request).
   */
  scope: (n: number, applied = false) =>
    `${n === 1 ? "The first change listed is" : `The first ${n} changes listed are`} scored on the published day’s Clash Budget Index (lower is better)${
      applied ? ", with your applied changes in place" : ""
    }. This site’s server gets only those changes to its public timetable; no Qloo request is sent.`,
  /** Before and after, from the answer: the working copy's index, then with this change. */
  scored: (before: number, after: number) => `Index ${before.toFixed(1)} → ${after.toFixed(1)}.`,
  notScored: (reason: string) => `Index not scored: ${reason}.`,
  scoring: "Scoring on the index.",
  illegal:
    "the server did not accept this change on the published day, which has limits this page does not check, such as each set’s allowed stages and times",
  illegalAfter:
    "the server did not accept this change, or one applied before it, on the published day, which has limits this page does not check, such as each set’s allowed stages and times",
  limit: "this server’s limit on what-if requests was reached",
  error: "the server did not answer",
  noPair: "this finding is not a pair of two acts on the published day",
  earlier: "a change applied before it moves a set the index cannot score as part of a pair",
  tooMany: "the plan would move more than 8 sets, the most the index scores at once",
} as const;

/**
 * One listed change as a rule step of the published day: the finding's two acts as the pair, and each moved
 * set by its id, its new stage's id and its new start. Null when the finding is not two different acts, or a
 * name or stage is not the published day's (the grid on show was loaded from it, so this is rare).
 */
export function scoreStepOf(
  report: Pick<CheckReport, "sets">,
  rows: readonly number[],
  moves: readonly { act: string; stageKey: string; start: number }[],
  ids: { day: number; acts: ReadonlyMap<string, string>; stages: ReadonlyMap<string, string> },
): ScoreStep | null {
  const keys = rows.map((row) => report.sets.find((set) => set.row === row)?.actKey);
  if (keys.length !== 2 || !keys[0] || !keys[1] || keys[0] === keys[1]) return null;
  const a = ids.acts.get(keys[0]);
  const b = ids.acts.get(keys[1]);
  if (!a || !b || moves.length === 0) return null;
  const out: ScoreMove[] = [];
  for (const move of moves) {
    const act = ids.acts.get(normalizeName(move.act));
    const stageId = ids.stages.get(move.stageKey);
    if (!act || !stageId) return null;
    out.push({ act, stageId, day: ids.day, start: clockOf(move.start) });
  }
  return { a, b, moves: out };
}

/** Minutes from the day's start as the what-if route reads them: "H:MM", hours past 23 after midnight. */
export function clockOf(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The what-if body for these steps: rule steps in order, no set to list places for. */
export function scoreBody(steps: readonly ScoreStep[]): string {
  return JSON.stringify({
    moves: steps.map((step) => ({
      rule: { a: step.a, b: step.b },
      moves: step.moves.map((move) => ({ act: move.act, stage_id: move.stageId, day: move.day, start: move.start })),
    })),
    act: null,
    limit: 8,
  });
}

/**
 * The index before and after the last step of a what-if answer: before is the published day's index, or
 * the index after the step before the last (the working copy's changes already applied); after is the index
 * after the last step. Null for any other shape.
 */
export function readScore(json: unknown, steps: number): { before: number; after: number } | null {
  if (!isRecord(json) || json.kind !== "whatif" || !isRecord(json.plan) || !Array.isArray(json.plan.steps)) return null;
  if (steps < 1 || json.plan.steps.length !== steps) return null;
  const previous = steps > 1 ? json.plan.steps[steps - 2] : null;
  const before = steps > 1 ? (isRecord(previous) ? previous.budget_after : null) : json.published_budget;
  const last = json.plan.steps[steps - 1];
  const after = isRecord(last) ? last.budget_after : null;
  if (typeof before !== "number" || !Number.isFinite(before) || typeof after !== "number" || !Number.isFinite(after)) return null;
  return { before, after };
}

/** The moved sets of a plan of steps, as the what-if route counts them (at most `MAX_SCORE_MOVES`). */
export function movesIn(steps: readonly ScoreStep[]): number {
  return steps.reduce((n, step) => n + step.moves.length, 0);
}

/** The most moved sets the what-if route scores in one plan. */
export const MAX_SCORE_MOVES = 8;

/**
 * Scores one change (after the changes already applied to the working copy) on the published day:
 * `POST /api/presets/{id}/whatif` with rule steps of that public timetable (its act and stage ids and the
 * new start times; nothing of a paste). One call, never retried, no Qloo request; a refusal or failure is
 * said in words. Never throws.
 */
export async function scoreSteps(presetId: string, steps: readonly ScoreStep[], signal?: AbortSignal): Promise<IndexScore> {
  if (!/^[\w.-]{1,80}$/.test(presetId) || steps.length === 0) return { status: "not_scored", reason: SCORE_COPY.error };
  if (movesIn(steps) > MAX_SCORE_MOVES) return { status: "not_scored", reason: SCORE_COPY.tooMany };
  try {
    const response = await fetch(`/api/presets/${encodeURIComponent(presetId)}/whatif`, {
      method: "POST",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: scoreBody(steps),
    });
    if (response.status === 422) {
      return { status: "not_scored", reason: steps.length > 1 ? SCORE_COPY.illegalAfter : SCORE_COPY.illegal };
    }
    if (response.status === 429) return { status: "not_scored", reason: SCORE_COPY.limit };
    if (!response.ok) return { status: "not_scored", reason: SCORE_COPY.error };
    const score = readScore(await response.json().catch(() => null), steps.length);
    return score ? { status: "scored", ...score } : { status: "not_scored", reason: SCORE_COPY.error };
  } catch {
    return { status: "not_scored", reason: SCORE_COPY.error };
  }
}

// ---------------------------------------------------------------------------------------------------
// The words of an answer

/** "Marble Machine × Glass Mirror". */
export function pairName(pair: Pick<PriceOverlap, "a" | "b">): string {
  return `${pair.a} × ${pair.b}`;
}

/** The banner over the list: where the price came from. */
export function sourceBanner(answer: Pick<PriceAnswer, "source" | "requestsUsed">): string {
  if (answer.source === "saved_day") return PRICE_COPY.savedBanner;
  if (answer.source === "invented_day") return PRICE_COPY.inventedBanner;
  return PRICE_COPY.liveBanner(answer.requestsUsed);
}

/** "19 of 21 acts with a usable signal". */
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
 * A priced value on the page's one scale, "NN / 100": the same scale as the home page's "Taste NN" and
 * the brief's "NN / 100". The route answers 0 to 1, and that value is the build's rank-normalised value
 * (a rank within the lineup `rankScope` names), which is the only reason ×100 is a fair way to print it:
 * it is a place on a 0 to 100 rank scale, not a percentage of anyone and not attendance.
 */
export function tasteScore(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/** What `pairLine` reads of an answer; `source` is optional so an older caller still words. */
export type LineOf = Pick<PriceAnswer, "pairs" | "coverage"> & { source?: PriceSource };

/**
 * Why a pair has no value, in words, from the reasons and the coverage lists the route returns: an act
 * matched with no usable signal, an act that is not on the saved day (so the two are not both on one
 * saved day), a name that matched more than one act, or a pair the saved day does not serve (the saved
 * server answers only the pairs the timetable page prints, `pair.taste_pairs`, a licence guardrail; the
 * rest of the saved values stay on the server).
 */
export function unpricedReason(pair: Pick<PricedPair, "a" | "b" | "reason">, answer: LineOf): string {
  const sides = [pair.a, pair.b];
  if (pair.reason === "not_ranked_on_saved_day") return PRICE_COPY.notServed;
  if (pair.reason === "ambiguous") {
    const unsure = sides.filter((name) => answer.coverage.ambiguous?.includes(name));
    const which = unsure.length > 0 ? unsure.join(" and ") : `${pair.a} or ${pair.b}`;
    return `${which} matched more than one act of that name, so none was picked`;
  }
  const signal = answer.source === "invented_day" ? "no usable signal" : "no usable Qloo signal";
  const { noSignal, ambiguous, unpriced } = answer.coverage;
  if (noSignal !== null) {
    const quiet = sides.filter((name) => noSignal.includes(name));
    const absent = sides.filter(
      (name) => unpriced.includes(name) && !noSignal.includes(name) && !(ambiguous ?? []).includes(name),
    );
    const parts: string[] = [];
    if (quiet.length > 0) parts.push(`${quiet.join(" and ")} ${quiet.length === 1 ? "has" : "have"} ${signal}`);
    if (absent.length > 0) {
      const be = absent.length === 1 ? "is" : "are";
      parts.push(
        answer.source === "qloo_live"
          ? `Qloo found no act named ${absent.join(" or ")}`
          : answer.source === "invented_day"
            ? `these two acts are not both on the invented example day (${absent.join(" and ")} ${be} not on it)`
            : `these two acts are not both on one saved day (${absent.join(" and ")} ${be} not on it)`,
      );
    }
    if (parts.length > 0) return parts.join("; ");
  }
  const missing = sides.filter((name) => unpriced.includes(name));
  const names = missing.length > 0 ? missing : sides;
  return `${names.join(" and ")} ${names.length === 1 ? "has" : "have"} ${signal}`;
}

/** An overlap the step did not compare: passed over before the request, or sent and answered with no value. */
export type NotCompared = { kind: "passed"; overlap: PassedOverlap } | { kind: "unpriced"; pair: PricedPair };

/** Every overlap the step did not compare, passed over first, then those sent without a value. */
export function notCompared(skipped: readonly PassedOverlap[], answer: Pick<PriceAnswer, "pairs"> | null): NotCompared[] {
  return [
    ...skipped.map((overlap): NotCompared => ({ kind: "passed", overlap })),
    ...(answer ? answer.pairs : [])
      .filter((pair) => pair.status !== "priced")
      .map((pair): NotCompared => ({ kind: "unpriced", pair })),
  ];
}

/**
 * The short kind of a reason, for the one count line: "both sets locked", "no usable Qloo signal", "not on
 * the saved day", "ambiguous name" or "not served" (a pair the saved day's page does not print).
 */
export function notComparedKind(item: NotCompared, answer: LineOf | null): string {
  const signal = answer?.source === "invented_day" ? "no usable signal" : "no usable Qloo signal";
  if (item.kind === "passed") return item.overlap.reason === "locked" ? "both sets locked" : signal;
  const { pair } = item;
  if (pair.reason === "not_ranked_on_saved_day") return "not served";
  if (pair.reason === "ambiguous") return "ambiguous name";
  if (!answer) return signal;
  const { noSignal, ambiguous, unpriced } = answer.coverage;
  const sides = [pair.a, pair.b];
  if (noSignal === null || sides.some((name) => noSignal.includes(name))) return signal;
  const absent = sides.some(
    (name) => unpriced.includes(name) && !noSignal.includes(name) && !(ambiguous ?? []).includes(name),
  );
  if (!absent) return signal;
  return answer.source === "qloo_live"
    ? "not found by Qloo"
    : answer.source === "invented_day"
      ? "not on the invented example day"
      : "not on the saved day";
}

/** One overlap not compared, in words: its passed-over line, or its unpriced row. */
export function notComparedText(item: NotCompared, answer: LineOf | null, basis: PriceBasis = "longest"): string {
  if (item.kind === "passed") return passedLine(item.overlap, basis);
  return answer ? pairLine(item.pair, answer) : pairName(item.pair);
}

/**
 * The one count line for the overlaps not compared, by kind in order of first appearance: "3 overlaps not
 * compared: both sets locked (3)." Null when every overlap considered was compared.
 */
export function notComparedLine(items: readonly NotCompared[], answer: LineOf | null): string | null {
  if (items.length === 0) return null;
  const kinds = new Map<string, number>();
  for (const item of items) {
    const kind = notComparedKind(item, answer);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const parts = [...kinds].map(([kind, n]) => `${kind} (${n})`);
  return `${count(items.length, "overlap")} not compared: ${parts.join(", ")}.`;
}

/**
 * One row: "A × B: 80 min shared. Taste overlap 91 / 100, taste rank 1 of 5." The rank orders the priced
 * pairs of this answer by taste overlap alone ("the only pair compared" when it is the only one), so it
 * reads apart from the home page's rank by the index (never "ranked 1 of 5", which a reader took for the
 * hero's index rank). An unpriced row says why, in words, and that it is shown by minutes only.
 */
export function pairLine(pair: PricedPair, answer: LineOf): string {
  const head = `${pairName(pair)}: ${pair.minutes} min shared.`;
  if (pair.status === "priced" && pair.overlap !== null && pair.rank !== null) {
    const compared = pricedCount(answer);
    const place = compared === 1 ? "the only pair compared" : `taste rank ${pair.rank} of ${compared}`;
    return `${head} Taste overlap ${tasteScore(pair.overlap)} / 100, ${place}.`;
  }
  if (pair.reason === "not_ranked_on_saved_day") {
    // "Not served: this site serves saved Qloo values only for the pairs its timetable page prints."
    return `${head} N${PRICE_COPY.notServed.slice(1)}. Shown by minutes only.`;
  }
  return `${head} Not compared: ${unpricedReason(pair, answer)}. Shown by minutes only.`;
}

/**
 * How the compared pairs are listed: in the order they were chosen ("selection": a published day's own
 * ranking, its costliest first), longest first (a stable sort by minutes, so a pasted grid keeps its own
 * order), or highest taste overlap first; unpriced pairs last in every order.
 */
export type PairOrder = "selection" | "minutes" | "overlap";

/** The order a list opens in: a published day's own ranking, else longest first. */
export function defaultOrder(basis: PriceBasis | undefined): PairOrder {
  return basis === "saved_ranking" ? "selection" : "minutes";
}

/** The pairs as listed, in `order` (see `PairOrder`). */
export function sortedPairs(answer: Pick<PriceAnswer, "pairs">, order: PairOrder): PricedPair[] {
  const pairs = [...answer.pairs];
  const position = new Map(pairs.map((pair, index) => [pair, index]));
  return pairs.sort((x, y) => {
    if (x.overlap === null || y.overlap === null) {
      if (x.overlap !== y.overlap) return x.overlap === null ? 1 : -1;
    } else if (order === "overlap" && x.overlap !== y.overlap) return y.overlap - x.overlap;
    if (order === "minutes" && x.minutes !== y.minutes) return y.minutes - x.minutes;
    return (position.get(x) as number) - (position.get(y) as number);
  });
}

/** The priced pairs of an answer, in the order chosen: the values the step shows first. */
export function comparedPairs(answer: Pick<PriceAnswer, "pairs">, order: PairOrder): PricedPair[] {
  return sortedPairs(answer, order).filter((pair) => pair.status === "priced");
}

/**
 * Whether taste overlap reorders the compared overlaps, judged among the priced pairs only: their order by
 * minutes (longest first) against their order by taste overlap. "Taste overlap changes the order of the 4
 * compared overlaps: A × B moves from 4th to 1st." (the pair that rises most), or "does not change the
 * order". An unpriced pair is never part of that comparison: the count line under the values says how
 * many were not compared, and why. Null when fewer than two pairs were priced.
 */
export function orderLine(answer: Pick<PriceAnswer, "pairs">): string | null {
  const priced = comparedPairs(answer, "minutes");
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
  const compared = `the ${priced.length} compared overlaps`;
  const moved = best as { pair: PricedPair; from: number; to: number } | null;
  if (!moved) return `Taste overlap does not change the order of ${compared}.`;
  return `Taste overlap changes the order of ${compared}: ${pairName(moved.pair)} moves from ${ordinal(moved.from + 1)} to ${ordinal(moved.to + 1)}.`;
}
