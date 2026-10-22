import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCheck, type CheckReport } from "@/lib/check";
import {
  MAX_SCORE_MOVES,
  PRICE_COPY,
  PRICE_LIMITS,
  SCORE_COPY,
  clockOf,
  comparedPairs,
  defaultOrder,
  extraNames,
  loadServableDays,
  matchKey,
  matchServableDay,
  noSavedDay,
  readScore,
  scoreBody,
  scoreStepOf,
  scoreSteps,
  servableDay,
  firstPublishedDay,
  loadPublishedDay,
  loadPublishedDays,
  loadPublishedTimetable,
  publishedDays,
  lockedLine,
  omittedLine,
  notCompared,
  notComparedLine,
  notComparedText,
  passedLine,
  priceGridLive,
  tasteScore,
  thirdParty,
  unpricedReason,
  coverageLine,
  orderLine,
  pairLine,
  parsePriceAnswer,
  priceBody,
  priceRequest,
  coverageParts,
  rankScope,
  recovery,
  scopeNote,
  requestPrice,
  sortedPairs,
  sourceBanner,
  type PriceAnswer,
  type PriceRequest,
} from "@/lib/check-price";
import { SAMPLE_GRID, SAMPLE_SETTINGS } from "@/lib/check-sample";

// Every name below is invented for the test.

function reportOf(grid: string): CheckReport {
  const outcome = runCheck({ grid, changeover: "", curfew: "", pairs: "" });
  if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
  return outcome.report;
}

function sample(): CheckReport {
  const outcome = runCheck({ grid: SAMPLE_GRID, ...SAMPLE_SETTINGS });
  if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
  return outcome.report;
}

/** A 200 answer for a request, as the route words it, every pair priced in the order given. */
function answerFor(request: PriceRequest, source: string, values: (number | null)[]): Record<string, unknown> {
  const priced = values.filter((v): v is number => v !== null);
  return {
    mode: source === "qloo_live" ? "live" : "saved",
    source,
    preset_id: source === "qloo_live" ? null : "synthetic-lanternfield-friday",
    fetched_at: null,
    coverage: { acts: request.acts.length, priced: request.acts.length - 1, unpriced: [request.overlaps.at(-1)?.b] },
    pairs: request.overlaps.map((o, i) => {
      const value = values[i];
      return value === null
        ? { a: o.a, b: o.b, status: "unpriced", taste_overlap: null, pair_rank: null, reason: "no_signal" }
        : { a: o.a, b: o.b, status: "priced", taste_overlap: value, pair_rank: 1 + priced.filter((p) => p > value).length, reason: null };
    }),
    requests_used: source === "qloo_live" ? 31 : 0,
    scope_note: "fixed server sentence",
  };
}

function respond(status: number, body: unknown) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

afterEach(() => vi.unstubAllGlobals());

/** The names of a request's pairs, each once, in pair order: what a minimal saved body sends. */
function pairNames(overlaps: readonly { a: string; b: string }[]): string[] {
  return [...new Set(overlaps.flatMap((o) => [o.a, o.b]))];
}

describe("what a press sends", () => {
  it("compares the sample's 5 longest overlaps, one per pair of acts, and sends only their act names (C2)", () => {
    const report = sample();
    const request = priceRequest(report);
    expect(request).not.toBeNull();
    if (!request) return;
    expect(request.overlaps).toHaveLength(PRICE_LIMITS.pairs);
    expect(request.overlaps.map((o) => o.minutes)).toEqual(report.shared.slice(0, 5).map((p) => p.minutes));
    // Saved mode: exactly the names in the pairs compared, never the grid's other 17 acts.
    const inPairs = pairNames(request.overlaps);
    expect(request.acts).toEqual(inPairs);
    expect(request.acts).toHaveLength(7);
    expect(request.total).toBe(24);
    // The live body is the bounded comparison set it always was: the pairs' acts first, then the grid's, 24 here.
    expect(request.liveActs).toHaveLength(24);
    expect(new Set(request.liveActs.slice(0, inPairs.length))).toEqual(new Set(inPairs));
    expect(request.liveOverlaps).toEqual(request.overlaps);
    expect(request.need).toBe(24 + inPairs.length);
  });

  it("sends exactly acts, pairs and mode: no times, stages, rules or settings", () => {
    const request = priceRequest(sample()) as PriceRequest;
    for (const mode of ["saved", "live"] as const) {
      const body = JSON.parse(priceBody(request, mode)) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(["acts", "pairs", "mode"]);
      expect(body.mode).toBe(mode);
      expect(body.pairs).toEqual(request.overlaps.map((o) => [o.a, o.b]));
      const text = priceBody(request, mode);
      expect(text).not.toMatch(/\d\d:\d\d|Stage|Tent|curfew|changeover|#g=/i);
    }
  });

  it("asks nothing of a grid with fewer than four acts or no overlap, and never more than 60 acts saved or 25 live", () => {
    expect(priceRequest(reportOf("A,Main,18:00,19:00\nB,Side,18:30,19:30\nC,Tent,18:00,19:00"))).toBeNull();
    expect(priceRequest(reportOf("A,Main,18:00,19:00\nB,Main,19:30,20:30\nC,Main,21:00,22:00\nD,Main,22:30,23:00"))).toBeNull();
    const many = Array.from({ length: 40 }, (_, i) => `Act ${i},Stage ${i % 8},${10 + Math.floor(i / 8) * 2}:00,${11 + Math.floor(i / 8) * 2}:30`).join("\n");
    const request = priceRequest(reportOf(many)) as PriceRequest;
    // A saved answer sends only the names in its pairs (a saved value does not depend on the others); a live one
    // keeps its comparison set of 25, the pairs' acts first.
    expect(request.acts).toEqual(pairNames(request.overlaps));
    expect(request.liveActs).toHaveLength(PRICE_LIMITS.maxActs);
    expect(request).toMatchObject({ total: 40, omitted: 0, liveOmitted: 15 });
    for (const o of request.overlaps) {
      expect(request.acts).toEqual(expect.arrayContaining([o.a, o.b]));
      expect(request.liveActs).toEqual(expect.arrayContaining([o.a, o.b]));
    }
    // The check reads at most 60 sets: a saved request is far under its cap; a live one leaves 35 out.
    const sixty = Array.from({ length: 60 }, (_, i) => `Act ${i},Stage ${i % 10},${10 + Math.floor(i / 10) * 2}:00,${11 + Math.floor(i / 10) * 2}:30`).join("\n");
    const full = priceRequest(reportOf(sixty)) as PriceRequest;
    expect(full.acts.length).toBeLessThanOrEqual(2 * PRICE_LIMITS.pairs);
    expect(full).toMatchObject({ total: 60, omitted: 0, liveOmitted: 35 });
  });

  it("sends only the compared pairs' names in saved mode and up to 25 in live mode, with the same pairs (C2)", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Act ${i},Stage ${i % 8},${10 + Math.floor(i / 8) * 2}:00,${11 + Math.floor(i / 8) * 2}:30`).join("\n");
    const request = priceRequest(reportOf(many)) as PriceRequest;
    const saved = JSON.parse(priceBody(request, "saved")) as { acts: string[]; pairs: string[][] };
    const live = JSON.parse(priceBody(request, "live")) as { acts: string[]; pairs: string[][] };
    expect(saved.acts).toEqual(pairNames(saved.pairs.map(([a, b]) => ({ a, b }))));
    expect(live.acts).toHaveLength(25);
    expect(saved.pairs).toEqual(live.pairs);
    expect(saved.pairs).toHaveLength(PRICE_LIMITS.pairs);
    // The intro counts the saved names, as "their N act names"; the live consent counts its own.
    expect(PRICE_COPY.intro(request.overlaps.length, request.acts.length)).toContain(
      `the 5 longest movable overlaps and their ${saved.acts.length} act names, never times, stages or rules`,
    );
    expect(scopeNote(null, request)).not.toMatch(/not sent/);
    expect(request.need).toBe(25 + new Set(request.overlaps.flatMap((o) => [o.a, o.b])).size);
  });

  it("adds names past the pairs' own only to meet the route's 4-act floor, and then says the count alone", () => {
    // One overlap among four acts: the route needs 4 different names, so 2 more of the grid's are sent.
    const request = priceRequest(reportOf("Ivy Bell,Main,18:00,19:00\nJet Canyon,Side,18:30,19:30\nKelp Ward,Main,20:00,21:00\nLark Mesa,Side,21:30,22:30")) as PriceRequest;
    expect(request.overlaps).toEqual([{ a: "Ivy Bell", b: "Jet Canyon", minutes: 30 }]);
    expect(request.acts).toEqual(["Ivy Bell", "Jet Canyon", "Kelp Ward", "Lark Mesa"]);
    expect(extraNames(request)).toBe(2);
    const intro = PRICE_COPY.intro(1, 4, false, "longest", null, extraNames(request));
    expect(intro).toContain("the longest movable overlap and 4 act names, never times");
    expect(intro).not.toContain("their 4 act names");
    expect(PRICE_COPY.intro(1, 2)).toContain("the longest movable overlap and its 2 act names");
  });

  it("does not ask about the same two acts twice when one act plays two sets", () => {
    const report = reportOf("X,Main,18:00,19:00\nX,Side,18:00,19:00\nY,Tent,18:00,19:00\nZ,Club,20:00,21:00\nW,Club,22:00,23:00");
    const request = priceRequest(report) as PriceRequest;
    expect(request.overlaps).toEqual([{ a: "X", b: "Y", minutes: 60 }]);
  });
});

describe("the one request", () => {
  it("posts to /api/price-grid, never cached, with no referrer, and reads a saved answer", async () => {
    const request = priceRequest(sample()) as PriceRequest;
    const fetch = respond(200, answerFor(request, "invented_day", [0.91, 0.4, 0.62, 0.2, null]));
    vi.stubGlobal("fetch", fetch);
    const result = await requestPrice(request, "saved");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/price-grid");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(Object.keys(JSON.parse(init.body as string))).toEqual(["acts", "pairs", "mode"]);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(sourceBanner(result.answer)).toBe(PRICE_COPY.inventedBanner);
    expect(result.answer.pairs.map((p) => p.rank)).toEqual([1, 3, 2, 4, null]);
  });

  it("reads the route's own answer for the sample on a clean clone (the invented day, no Qloo request)", () => {
    const request = priceRequest(sample()) as PriceRequest;
    // Recorded from POST /api/price-grid (saved mode) for the minimal body: the 7 names of the 5 pairs. The
    // invented day's values are the same as for the whole lineup: a saved value does not depend on the names sent.
    expect(JSON.parse(priceBody(request, "saved")).acts).toEqual([
      "Glass Mirror",
      "Marble Machine",
      "Rustic Season",
      "Fable Pilots",
      "Hollow Meadow",
      "Fable Meadow",
      "Neon Harbour",
    ]);
    const recorded = {
      mode: "saved",
      source: "invented_day",
      preset_id: "synthetic-lanternfield-friday",
      fetched_at: null,
      coverage: { acts: 7, priced: 7, unpriced: [] },
      pairs: [
        { a: "Glass Mirror", b: "Marble Machine", status: "priced", taste_overlap: 0.3405, pair_rank: 2, reason: null },
        { a: "Rustic Season", b: "Fable Pilots", status: "priced", taste_overlap: 0.3229, pair_rank: 3, reason: null },
        { a: "Glass Mirror", b: "Hollow Meadow", status: "priced", taste_overlap: 0.4268, pair_rank: 1, reason: null },
        { a: "Marble Machine", b: "Hollow Meadow", status: "priced", taste_overlap: 0.0176, pair_rank: 5, reason: null },
        { a: "Fable Meadow", b: "Neon Harbour", status: "priced", taste_overlap: 0.0622, pair_rank: 4, reason: null },
      ],
      requests_used: 0,
      scope_note:
        "Compared using the invented example day: its acts and affinities are invented, not Qloo data. No Qloo request was sent.",
    };
    expect(request.overlaps.map((o) => [o.a, o.b])).toEqual(recorded.pairs.map((p) => [p.a, p.b]));
    const answer = parsePriceAnswer(recorded, request, "saved") as PriceAnswer;
    expect(sourceBanner(answer)).toBe(PRICE_COPY.inventedBanner);
    expect(coverageLine(answer)).toBe("7 of 7 acts with a usable signal");
    expect(orderLine(answer)).toBe(
      "Taste overlap changes the order of the 5 compared overlaps: Glass Mirror × Hollow Meadow moves from 3rd to 1st.",
    );
  });

  it("says a saved festival day sent no Qloo request", async () => {
    const request = priceRequest(sample()) as PriceRequest;
    vi.stubGlobal("fetch", respond(200, answerFor(request, "saved_day", [0.5, 0.4, 0.3, 0.2, 0.1])));
    const result = await requestPrice(request, "saved");
    if (result.status !== "ready") throw new Error(result.status);
    expect(sourceBanner(result.answer)).toBe("Compared using a saved festival day. No Qloo request was sent.");
  });

  it("offers the live step only on not_a_saved_day, and words each refusal with the route's sentence", async () => {
    const request = priceRequest(sample()) as PriceRequest;
    vi.stubGlobal("fetch", respond(422, { detail: { code: "not_a_saved_day", message: "These acts are not on a saved festival day." } }));
    expect(await requestPrice(request, "saved")).toEqual({ status: "not_saved" });
    const limit = "The live comparison has reached today's limit. Your rule results are unchanged, and a saved day compares without a limit.";
    vi.stubGlobal("fetch", respond(429, { detail: { code: "limit", message: limit } }));
    expect(await requestPrice(request, "live")).toEqual({ status: "refused", code: "limit", message: limit });
    vi.stubGlobal("fetch", respond(503, { detail: { code: "no_answer", message: "Qloo did not answer in time; nothing was compared." } }));
    expect(await requestPrice(request, "live")).toMatchObject({ status: "refused", code: "no_answer" });
    // not_a_saved_day on a live request is not a reason to offer live again.
    vi.stubGlobal("fetch", respond(422, { detail: { code: "not_a_saved_day", message: "x" } }));
    expect(await requestPrice(request, "live")).toMatchObject({ status: "refused" });
  });

  it("reads the 200 no-saved-day answer (live off on the server) as not saved, with nothing to offer (C4)", async () => {
    const request = priceRequest(sample()) as PriceRequest;
    const answer = {
      mode: "saved",
      status: "no_saved_day",
      requests_used: 0,
      message: "These acts are not on a saved festival day, and the live comparison is off on this server, so nothing was compared. No Qloo request was sent.",
    };
    expect(noSavedDay(answer)).toBe(true);
    vi.stubGlobal("fetch", respond(200, answer));
    expect(await requestPrice(request, "saved")).toEqual({ status: "not_saved", liveOff: true });
    // Only that exact shape: a request used, another status or a live answer is not it.
    expect(noSavedDay({ ...answer, requests_used: 1 })).toBe(false);
    expect(noSavedDay({ ...answer, status: "other" })).toBe(false);
    expect(noSavedDay({ ...answer, mode: "live" })).toBe(false);
    vi.stubGlobal("fetch", respond(200, answer));
    expect(await requestPrice(request, "live")).toEqual({ status: "error" });
    // With live on, the server still refuses with the 422, and the page may offer the live step after it.
    vi.stubGlobal("fetch", respond(422, { detail: { code: "not_a_saved_day", message: "These acts are not on a saved festival day." } }));
    expect(await requestPrice(request, "saved")).toEqual({ status: "not_saved" });
  });

  it("never throws: a dropped connection, a framework error or an answer for other pairs is an error", async () => {
    const request = priceRequest(sample()) as PriceRequest;
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await requestPrice(request, "saved")).toEqual({ status: "error" });
    vi.stubGlobal("fetch", respond(422, { detail: [{ loc: ["body"], msg: "x", type: "y" }] }));
    expect(await requestPrice(request, "saved")).toEqual({ status: "error" });
    const wrong = answerFor(request, "invented_day", [0.5, 0.4, 0.3, 0.2, 0.1]);
    (wrong.pairs as { a: string }[])[0].a = "Someone else";
    vi.stubGlobal("fetch", respond(200, wrong));
    expect(await requestPrice(request, "saved")).toEqual({ status: "error" });
    // A live answer to a saved request (or the reverse) is not read.
    vi.stubGlobal("fetch", respond(200, answerFor(request, "qloo_live", [0.5, 0.4, 0.3, 0.2, 0.1])));
    expect(await requestPrice(request, "saved")).toEqual({ status: "error" });
  });

  it("refuses a value out of 0 to 1 or a rank below 1", () => {
    const request = priceRequest(sample()) as PriceRequest;
    const bad = answerFor(request, "invented_day", [0.5, 0.4, 0.3, 0.2, 0.1]);
    (bad.pairs as { taste_overlap: number }[])[1].taste_overlap = 1.5;
    expect(parsePriceAnswer(bad, request, "saved")).toBeNull();
    const rank = answerFor(request, "invented_day", [0.5, 0.4, 0.3, 0.2, 0.1]);
    (rank.pairs as { pair_rank: number }[])[1].pair_rank = 0;
    expect(parsePriceAnswer(rank, request, "saved")).toBeNull();
  });
});

describe("the words of an answer", () => {
  const request = priceRequest(sample()) as PriceRequest;
  const answer = parsePriceAnswer(answerFor(request, "invented_day", [0.4, 0.3, 0.2, 0.91, null]), request, "saved") as PriceAnswer;

  it("words a priced row, an unpriced row and the coverage", () => {
    const [first] = answer.pairs;
    // "taste rank", never "ranked": the rank orders the compared pairs by taste overlap, not the hero's index.
    expect(pairLine(first, answer)).toBe(`${first.a} × ${first.b}: ${first.minutes} min shared. Taste overlap 40 / 100, taste rank 2 of 4.`);
    expect(pairLine(first, answer)).not.toMatch(/\branked\b/);
    const last = answer.pairs[4];
    // The invented day is not Qloo data, so its reason never names Qloo.
    expect(pairLine(last, answer)).toBe(
      `${last.a} × ${last.b}: ${last.minutes} min shared. Not compared: ${last.b} has no usable signal. Shown by minutes only.`,
    );
    expect(pairLine(last, { ...answer, source: "saved_day" })).toContain(`Not compared: ${last.b} has no usable Qloo signal.`);
    expect(coverageLine(answer)).toBe(`${request.acts.length - 1} of ${request.acts.length} acts with a usable signal`);
    // C3: the licence guardrail, true and specific.
    const notRanked = { ...last, reason: "not_ranked_on_saved_day" as const };
    expect(pairLine(notRanked, answer)).toBe(
      `${last.a} × ${last.b}: ${last.minutes} min shared. Not served: this site serves saved Qloo values only for the pairs its timetable page prints. Shown by minutes only.`,
    );
  });

  it("sorts by audience overlap with unpriced pairs last, and says how the order changes", () => {
    const sorted = sortedPairs(answer, "overlap");
    expect(sorted.map((p) => p.overlap)).toEqual([0.91, 0.4, 0.3, 0.2, null]);
    expect(sortedPairs(answer, "minutes")).toEqual(answer.pairs);
    const fourth = answer.pairs[3];
    expect(orderLine(answer)).toBe(
      `Taste overlap changes the order of the 4 compared overlaps: ${fourth.a} × ${fourth.b} moves from 4th to 1st.`,
    );
    const same = parsePriceAnswer(answerFor(request, "invented_day", [0.9, 0.8, 0.7, 0.6, 0.5]), request, "saved") as PriceAnswer;
    expect(orderLine(same)).toBe("Taste overlap does not change the order of the 5 compared overlaps.");
    const one = parsePriceAnswer(answerFor(request, "invented_day", [0.9, null, null, null, null]), request, "saved") as PriceAnswer;
    expect(orderLine(one)).toBeNull();
  });

  it("says what live costs before it is pressed, and claims nothing the reading cannot show", () => {
    expect(PRICE_COPY.notSaved(21, 31)).toBe(
      "These acts are not on a saved day. We can ask Qloo now. This sends 21 act names to Qloo, a third party; Qloo's terms govern what it keeps. Do not send acts you have not announced. A live answer uses about 31 Qloo requests; live comparison is capped per day on this server.",
    );
    expect(PRICE_COPY.askButton(21)).toBe("Ask Qloo for these 21 acts");
    expect(PRICE_COPY.button).toBe("Compare audience overlap");
    const words = [
      ...(Object.values(PRICE_COPY) as unknown[]).filter((v): v is string => typeof v === "string"),
      PRICE_COPY.intro(5, 24),
      PRICE_COPY.liveBanner(31),
      pairLine(answer.pairs[0], answer),
      orderLine(answer) ?? "",
    ];
    for (const text of words) {
      expect(text).not.toMatch(/\b(prevent\w*|crowd flow|revenue|safety|customers?|predicts?|proven|optimal|guarantee\w*|attendance will)\b/i);
    }
  });
});

describe("round-9 regressions: order, rank scope and recovery", () => {
  it("never claims a reorder when the priced pairs keep their order: an unpriced longest pair is described apart", () => {
    const request = priceRequest(sample()) as PriceRequest;
    // The longest pair has no reading; the next two are already in descending audience overlap.
    const answer = parsePriceAnswer(answerFor(request, "invented_day", [null, 0.6, 0.3, null, null]), request, "saved") as PriceAnswer;
    expect(sortedPairs(answer, "overlap").map((p) => p.overlap)).toEqual([0.6, 0.3, null, null, null]);
    const line = orderLine(answer) as string;
    expect(line).toBe("Taste overlap does not change the order of the 2 compared overlaps.");
    expect(line).not.toMatch(/moves from/);
    // The overlaps without a reading are counted once, under the values, by kind.
    expect(notComparedLine(notCompared([], answer), answer)).toBe("3 overlaps not compared: no usable signal (3).");
    // A real swap among the priced pairs is still named, by its place among the priced pairs only.
    const swapped = parsePriceAnswer(answerFor(request, "invented_day", [null, 0.3, 0.6, null, null]), request, "saved") as PriceAnswer;
    expect(orderLine(swapped)).toBe(
      `Taste overlap changes the order of the 2 compared overlaps: ${request.overlaps[2].a} × ${request.overlaps[2].b} moves from 2nd to 1st.`,
    );
    // Equal values keep the minutes order: no move is claimed.
    const tied = parsePriceAnswer(answerFor(request, "invented_day", [0.5, 0.5, 0.5, 0.5, 0.5]), request, "saved") as PriceAnswer;
    expect(orderLine(tied)).toBe("Taste overlap does not change the order of the 5 compared overlaps.");
  });

  it("states the comparator population: the saved day's lineup, the invented lineup, or the acts sent live", () => {
    const request = priceRequest(sample()) as PriceRequest;
    expect(request.total).toBe(24);
    expect(request.omitted).toBe(0);
    const saved = parsePriceAnswer(answerFor(request, "saved_day", [0.5, 0.4, 0.3, 0.2, 0.1]), request, "saved") as PriceAnswer;
    expect(saved.presetId).toBe("synthetic-lanternfield-friday");
    expect(rankScope(saved)).toMatch(/^Values come from the saved day: each is a rank among the acts on that day’s lineup, not among the acts you pasted/);
    const invented = parsePriceAnswer(answerFor(request, "invented_day", [0.5, 0.4, 0.3, 0.2, 0.1]), request, "saved") as PriceAnswer;
    expect(rankScope(invented)).toMatch(/invented lineup, not Qloo data/);
    const live = parsePriceAnswer(answerFor(request, "qloo_live", [0.5, 0.4, 0.3, 0.2, 0.1]), request, "live") as PriceAnswer;
    expect(rankScope(live)).toBe("A rank among the 24 acts sent to Qloo just now, not attendance, and not comparable with a published day’s figures.");
    // No answer yet: both kinds are described, and neither claims "the acts you pasted".
    expect(scopeNote(null, request)).toBe(`${PRICE_COPY.scopeBefore} ${PRICE_COPY.cbi}`);
    for (const note of [scopeNote(null, request), scopeNote(saved, request), scopeNote(invented, request)]) {
      expect(note).not.toMatch(/a rank among the acts you pasted/i);
    }
  });

  it("says how many acts were not sent: past 60 for a saved answer, past 25 for a live one", () => {
    const grid = Array.from({ length: 30 }, (_, i) => `Act ${i},Stage ${i % 6},${10 + Math.floor(i / 6) * 2}:00,${11 + Math.floor(i / 6) * 2}:30`).join("\n");
    const request = priceRequest(reportOf(grid)) as PriceRequest;
    expect(request.acts).toEqual(pairNames(request.overlaps));
    expect(request.liveActs).toHaveLength(25);
    expect(request).toMatchObject({ total: 30, omitted: 0, liveOmitted: 5 });
    expect(PRICE_COPY.intro(request.overlaps.length, request.acts.length)).toContain(`and their ${request.acts.length} act names`);
    expect(scopeNote(null, request)).not.toContain("not sent");
    const live = parsePriceAnswer(answerFor(request, "qloo_live", [0.5, 0.4, 0.3, 0.2, 0.1].slice(0, request.overlaps.length)), request, "live") as PriceAnswer;
    expect(live.omitted).toBe(5);
    expect(rankScope(live)).toBe(
      "A rank among the 25 acts sent to Qloo just now, not attendance, and not comparable with a published day’s figures. This grid has 30 different acts and at most 25 are sent, so 5 acts are not sent and not compared.",
    );
    const saved = parsePriceAnswer(answerFor(request, "saved_day", [0.5, 0.4, 0.3, 0.2, 0.1].slice(0, request.overlaps.length)), request, "saved") as PriceAnswer;
    expect(saved).toMatchObject({ sent: request.acts.length, omitted: 0 });
    expect(rankScope(saved)).not.toContain("not sent");
    // The line that says so, with the cap that applies.
    expect(omittedLine(4, 64)).toBe("This grid has 64 different acts and at most 60 are sent, so 4 acts are not sent and not compared.");
    expect(omittedLine(5, 30, PRICE_LIMITS.maxActs)).toBe(
      "This grid has 30 different acts and at most 25 are sent, so 5 acts are not sent and not compared.",
    );
  });

  it("offers a retry after a failed answer or a timeout, and explains instead after a cap or a switch-off", () => {
    expect(recovery("saved", null).retry).toBe("saved");
    expect(recovery("live", null)).toMatchObject({ retry: "live" });
    expect(recovery("live", null).text).toContain("counts toward this server’s daily cap");
    expect(recovery("live", "no_answer").retry).toBe("live");
    for (const code of ["limit", "paused", "live_off", "too_few_found", "duplicate_act"]) {
      const r = recovery("live", code);
      expect(r.retry).toBeNull();
      expect(r.text).toMatch(/Everything above stays as it is/);
    }
    expect(recovery("live", "limit").text).toMatch(/^Try again later\./);
  });

  it("calls the cap per server, never across all visitors, and names the step Compare audience overlap", () => {
    expect(PRICE_COPY.notSaved(21, 31)).toContain("live comparison is capped per day on this server");
    const words = (Object.values(PRICE_COPY) as unknown[]).filter((v): v is string => typeof v === "string").join(" ");
    expect(words).not.toMatch(/across all visitors|for everyone/i);
    expect(PRICE_COPY.heading).toBe("Compare audience overlap (optional)");
    expect(PRICE_COPY.button).toBe("Compare audience overlap");
  });
});

describe("round-9b coverage: matched, priced, no signal, ambiguous, and the comparator", () => {
  const request = priceRequest(sample()) as PriceRequest;
  const [p0, p1, p2, p3, p4] = request.overlaps;
  // A live answer as the 9b route words it: one ambiguous name, one matched act without a signal, one not found.
  const live = {
    mode: "live",
    source: "qloo_live",
    preset_id: null,
    fetched_at: "2026-10-04T10:00:00Z",
    coverage: {
      acts: 24,
      matched: 22,
      priced: 21,
      unpriced: [p3.b, p4.b, "Tidal Fields"],
      no_signal: [p4.b],
      ambiguous: [p3.b],
    },
    comparator: { kind: "live_subset", acts: 22 },
    pairs: [
      { a: p0.a, b: p0.b, status: "priced", taste_overlap: 0.61, pair_rank: 1, reason: null },
      { a: p1.a, b: p1.b, status: "priced", taste_overlap: 0.42, pair_rank: 2, reason: null },
      { a: p2.a, b: p2.b, status: "priced", taste_overlap: 0.3, pair_rank: 3, reason: null },
      { a: p3.a, b: p3.b, status: "unpriced", taste_overlap: null, pair_rank: null, reason: "ambiguous" },
      { a: p4.a, b: p4.b, status: "unpriced", taste_overlap: null, pair_rank: null, reason: "no_signal" },
    ],
    requests_used: 27,
    scope_note: "x",
  };

  it("reads the four states and words them, never counting a match alone as a reading", () => {
    const answer = parsePriceAnswer(live, request, "live") as PriceAnswer;
    expect(answer.coverage).toMatchObject({ matched: 22, noSignal: [p4.b], ambiguous: [p3.b] });
    expect(answer.comparator).toEqual({ kind: "live_subset", acts: 22 });
    expect(coverageParts(answer)).toEqual({ sent: 24, matched: 22, priced: 21, noSignal: 1, ambiguous: 1, notFound: 1 });
    expect(coverageLine(answer)).toBe(
      "24 acts sent: 22 matched, 21 with a usable signal; 1 matched with no signal, 1 ambiguous name, not guessed, 1 not found",
    );
    expect(pairLine(answer.pairs[3], answer)).toBe(
      `${p3.a} × ${p3.b}: ${p3.minutes} min shared. Not compared: ${p3.b} matched more than one act of that name, so none was picked. Shown by minutes only.`,
    );
    expect(pairLine(answer.pairs[4], answer)).toContain(`Not compared: ${p4.b} has no usable Qloo signal.`);
    // The rank scope names the population the route ranked within.
    expect(rankScope(answer)).toBe(
      "A rank among the 22 acts Qloo matched of the 24 sent just now, not attendance, and not comparable with a published day’s figures.",
    );
  });

  it("names a saved day's lineup size from the comparator", () => {
    const saved = parsePriceAnswer(
      { ...answerFor(request, "saved_day", [0.5, 0.4, 0.3, 0.2, 0.1]), comparator: { kind: "saved_day", acts: 23 } },
      request,
      "saved",
    ) as PriceAnswer;
    expect(rankScope(saved)).toMatch(/^Values come from the saved day: each is a rank among the acts on that day’s lineup of 23 acts, not among the acts you pasted/);
  });

  it("degrades to one honest line when the route sends none of the 9b fields", () => {
    const old = parsePriceAnswer(answerFor(request, "invented_day", [0.5, 0.4, 0.3, 0.2, null]), request, "saved") as PriceAnswer;
    expect(old.coverage).toMatchObject({ matched: null, noSignal: null, ambiguous: null });
    expect(old.comparator).toBeNull();
    expect(coverageParts(old)).toBeNull();
    expect(coverageLine(old)).toBe(`${request.acts.length - 1} of ${request.acts.length} acts with a usable signal`);
    expect(rankScope(old)).toMatch(/invented lineup, not Qloo data/);
    // A malformed comparator or list is ignored, not trusted.
    const odd = parsePriceAnswer(
      { ...answerFor(request, "invented_day", [0.5, 0.4, 0.3, 0.2, 0.1]), comparator: { kind: "everyone", acts: 9 }, coverage: { acts: 24, priced: 24, unpriced: [], matched: 24, no_signal: [1], ambiguous: [] } },
      request,
      "saved",
    ) as PriceAnswer;
    expect(odd.comparator).toBeNull();
    expect(odd.coverage.noSignal).toBeNull();
    expect(coverageParts(odd)).toBeNull();
  });
});

describe("round 31: one name and one scale (C4)", () => {
  const request = priceRequest(sample()) as PriceRequest;

  it("prints every value as taste overlap NN / 100, never as a 0 to 1 decimal", () => {
    expect(tasteScore(0.91)).toBe(91);
    expect(tasteScore(0.004)).toBe(0);
    expect(tasteScore(0.995)).toBe(100);
    const answer = parsePriceAnswer(answerFor(request, "invented_day", [0.91, 0.4, 0.62, 0.2, 0.05]), request, "saved") as PriceAnswer;
    const lines = answer.pairs.map((pair) => pairLine(pair, answer));
    expect(lines[0]).toBe(`${request.overlaps[0].a} × ${request.overlaps[0].b}: ${request.overlaps[0].minutes} min shared. Taste overlap 91 / 100, taste rank 1 of 5.`);
    expect(lines[4]).toContain("Taste overlap 5 / 100, taste rank 5 of 5.");
    for (const line of [...lines, orderLine(answer) ?? ""]) {
      expect(line).not.toMatch(/Audience overlap \d|0\.\d\d|%/);
    }
  });

  it("says \"the only pair compared\" when one pair has a value, never \"taste rank 1 of 1\"", () => {
    const answer = parsePriceAnswer(answerFor(request, "invented_day", [0.73, null, null, null, null]), request, "saved") as PriceAnswer;
    const line = pairLine(answer.pairs[0], answer);
    expect(line).toBe(`${request.overlaps[0].a} × ${request.overlaps[0].b}: ${request.overlaps[0].minutes} min shared. Taste overlap 73 / 100, the only pair compared.`);
    expect(line).not.toMatch(/rank(ed)? 1 of 1/);
  });

  it("keeps the action's name and the rank-scope sentences word for word", () => {
    expect(PRICE_COPY.button).toBe("Compare audience overlap");
    expect(PRICE_COPY.heading).toBe("Compare audience overlap (optional)");
    expect(PRICE_COPY.overlapFirst).toBe("Highest taste overlap first");
    expect(PRICE_COPY.briefHeading(5)).toBe("Taste overlap compared (5 longest overlaps)");
    const live = parsePriceAnswer(answerFor(request, "qloo_live", [0.5, 0.4, 0.3, 0.2, 0.1]), request, "live") as PriceAnswer;
    expect(rankScope(live)).toContain("not attendance, and not comparable with a published day’s figures");
    expect(PRICE_COPY.scopeBefore).toContain("a rank within a lineup, not attendance");
  });

  it("holds no toFixed in the module: no value prints as a decimal", () => {
    const source = readFileSync(fileURLToPath(new URL("./check-price.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("toFixed(2)");
  });
});

describe("round 31: the live offer reads the server first (C2, C3)", () => {
  it("reads price_grid_live from the health answer: on, off and unknown (unknown is off)", async () => {
    vi.stubGlobal("fetch", respond(200, { status: "ok", price_grid_live: true }));
    expect(await priceGridLive()).toBe(true);
    vi.stubGlobal("fetch", respond(200, { status: "ok", price_grid_live: false }));
    expect(await priceGridLive()).toBe(false);
    vi.stubGlobal("fetch", respond(200, { status: "ok" }));
    expect(await priceGridLive()).toBe(false);
    vi.stubGlobal("fetch", respond(503, { detail: "down" }));
    expect(await priceGridLive()).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await priceGridLive()).toBe(false);
  });

  it("reads the health check with a bodiless GET of this app's own API", async () => {
    const fetch = respond(200, { price_grid_live: false });
    vi.stubGlobal("fetch", fetch);
    await priceGridLive();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/health");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(init.body).toBeUndefined();
  });

  it("words the off state with no offer to ask Qloo, and the intro to match", () => {
    expect(PRICE_COPY.liveOff).toBe(
      "These acts are not on a saved day, and live comparison with Qloo is off on this server, so nothing was compared and no Qloo request was sent. A published day still compares.",
    );
    expect(PRICE_COPY.liveOff).not.toMatch(/We can ask Qloo now|Ask Qloo for/);
    expect(PRICE_COPY.tryPublished("Glastonbury 2025, Sunday")).toBe("Try it on Glastonbury 2025, Sunday");
    expect(PRICE_COPY.intro(5, 10)).toMatch(/With no saved day, nothing is compared: live Qloo comparison is off here\.$/);
    expect(PRICE_COPY.intro(5, 10, false)).not.toContain("you can choose to ask Qloo");
    expect(PRICE_COPY.intro(5, 10, true)).toMatch(/With no saved day, you can choose to ask Qloo instead\.$/);
  });

  it("adds the third-party sentence to the live consent, with the count already computed", () => {
    expect(thirdParty(21)).toBe(
      "This sends 21 act names to Qloo, a third party; Qloo's terms govern what it keeps. Do not send acts you have not announced.",
    );
    expect(thirdParty(1)).toContain("This sends 1 act name to Qloo");
    expect(PRICE_COPY.notSaved(21, 31)).toContain(thirdParty(21));
  });
});

describe("round 31: pairs a programmer could move (C5) and reasons in words (C9)", () => {
  const grid = [
    "act,stage,start,end,locked",
    "Pine Lantern,North,18:00,20:00,yes",
    "Quill Harbor,South,18:00,19:50,yes",
    "Rook Meadow,East,18:00,19:00,",
    "Sable Comet,West,18:30,19:20,",
    "Tin Orchard,Club,19:00,19:30,",
  ].join("\n");

  it("passes over a pair whose two sets are both locked and fills from the next-longest", () => {
    const report = reportOf(grid);
    const both = report.shared.find((pair) => pair.a.locked && pair.b.locked);
    expect(both).toBeDefined();
    expect(report.shared[0]).toBe(both);
    const request = priceRequest(report) as PriceRequest;
    expect(request.overlaps).toHaveLength(PRICE_LIMITS.pairs);
    expect(request.overlaps.some((o) => [o.a, o.b].sort().join("|") === "Pine Lantern|Quill Harbor")).toBe(false);
    expect(request.skipped).toEqual([{ a: both?.a.act, b: both?.b.act, minutes: both?.minutes, reason: "locked" }]);
    expect(request.basis).toBe("longest");
    // A pair with one locked set is still sent.
    expect(request.overlaps.some((o) => o.a === "Pine Lantern" || o.b === "Pine Lantern")).toBe(true);
  });

  it("words a passed-over pair with its reason, and never as wanted", () => {
    const line = lockedLine({ a: "Pine Lantern", b: "Quill Harbor", minutes: 110 });
    expect(line).toBe(
      "Pine Lantern × Quill Harbor: 110 min shared. Not compared: both sets are marked locked in this grid, so neither can move; the next-longest overlap is compared instead.",
    );
    expect(line).not.toMatch(/on purpose|deliberate|intended/i);
  });

  it("sends nothing new for the invented sample: none of its overlaps has two locked sets", () => {
    expect((priceRequest(sample()) as PriceRequest).skipped).toEqual([]);
  });

  it("gives every unpriced pair its reason in words, from the reasons and lists the route returns", () => {
    const coverage = { acts: 6, priced: 3, unpriced: ["Rook Meadow", "Sable Comet", "Tin Orchard"], matched: 5, noSignal: ["Rook Meadow"], ambiguous: ["Tin Orchard"] };
    const pairs = [] as PriceAnswer["pairs"];
    const saved = { pairs, coverage, source: "saved_day" as const };
    expect(unpricedReason({ a: "Pine Lantern", b: "Rook Meadow", reason: "no_signal" }, saved)).toBe("Rook Meadow has no usable Qloo signal");
    expect(unpricedReason({ a: "Pine Lantern", b: "Sable Comet", reason: "no_signal" }, saved)).toBe(
      "these two acts are not both on one saved day (Sable Comet is not on it)",
    );
    expect(unpricedReason({ a: "Rook Meadow", b: "Sable Comet", reason: "no_signal" }, saved)).toBe(
      "Rook Meadow has no usable Qloo signal; these two acts are not both on one saved day (Sable Comet is not on it)",
    );
    expect(unpricedReason({ a: "Pine Lantern", b: "Sable Comet", reason: "no_signal" }, { ...saved, source: "qloo_live" })).toBe(
      "Qloo found no act named Sable Comet",
    );
    expect(unpricedReason({ a: "Pine Lantern", b: "Tin Orchard", reason: "ambiguous" }, saved)).toBe(
      "Tin Orchard matched more than one act of that name, so none was picked",
    );
    // K4, C3: true to the server, which answers only the pairs the timetable page prints (pair.py taste_pairs).
    expect(unpricedReason({ a: "Pine Lantern", b: "Quill Harbor", reason: "not_ranked_on_saved_day" }, saved)).toBe(
      "not served: this site serves saved Qloo values only for the pairs its timetable page prints",
    );
    expect(unpricedReason({ a: "Pine Lantern", b: "Quill Harbor", reason: "not_ranked_on_saved_day" }, saved)).not.toMatch(/holds no reading/);
    for (const reason of ["no_signal", "ambiguous", "not_ranked_on_saved_day"] as const) {
      expect(unpricedReason({ a: "Pine Lantern", b: "Sable Comet", reason }, saved)).not.toMatch(/not ranked on the saved day/);
    }
  });
});

describe("round 31: a published day to check (C8)", () => {
  // An invented list in the route's shape.
  const list = [
    { id: "synthetic-day", title: "Invented day", sets: 25, stages: 4, synthetic: true },
    { id: "brookfield-2030-sat", title: "Brookfield 2030, Saturday", sets: 12, stages: 3, synthetic: false },
    { id: "other-2030-sun", title: "Other 2030, Sunday", sets: 9, stages: 2 },
  ];

  it("offers the first day that is not the invented one, and none when there is none", () => {
    expect(firstPublishedDay(list)).toEqual({ id: "brookfield-2030-sat", title: "Brookfield 2030, Saturday" });
    expect(firstPublishedDay([list[0]])).toBeNull();
    expect(firstPublishedDay([])).toBeNull();
    expect(firstPublishedDay(null)).toBeNull();
    expect(firstPublishedDay({ presets: list })).toBeNull();
    expect(firstPublishedDay([{ id: "../x", title: "Odd" }])).toBeNull();
  });

  it("reads the list and the day with bodiless GETs of this app's own API, never Qloo", async () => {
    const fetch = respond(200, list);
    vi.stubGlobal("fetch", fetch);
    expect(await loadPublishedDay()).toEqual({ id: "brookfield-2030-sat", title: "Brookfield 2030, Saturday" });
    await loadPublishedTimetable("brookfield-2030-sat");
    const calls = fetch.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual(["/api/presets", "/api/presets/brookfield-2030-sat"]);
    for (const [url, init] of calls) {
      expect(url).not.toMatch(/qloo/i);
      expect(init).toMatchObject({ method: "GET" });
      expect(init.body).toBeUndefined();
    }
    vi.stubGlobal("fetch", respond(500, {}));
    expect(await loadPublishedDay()).toBeNull();
  });

  it("round 36: lists every published day in the API's order for the offer, with one bodiless GET, and none when there is none", async () => {
    const days = [
      { id: "brookfield-2030-sat", title: "Brookfield 2030, Saturday" },
      { id: "other-2030-sun", title: "Other 2030, Sunday" },
    ];
    expect(publishedDays(list)).toEqual(days);
    expect(publishedDays([list[0]])).toEqual([]);
    expect(publishedDays([{ id: "../x", title: "Odd" }, ...list])).toEqual(days);
    expect(publishedDays(null)).toEqual([]);
    expect(publishedDays({ presets: list })).toEqual([]);
    const fetch = respond(200, list);
    vi.stubGlobal("fetch", fetch);
    expect(await loadPublishedDays()).toEqual(days);
    const calls = fetch.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual(["/api/presets"]);
    expect(calls[0][1]).toMatchObject({ method: "GET" });
    expect(calls[0][1].body).toBeUndefined();
    vi.stubGlobal("fetch", respond(200, [list[0]]));
    expect(await loadPublishedDays()).toBeNull();
    vi.stubGlobal("fetch", respond(500, {}));
    expect(await loadPublishedDays()).toBeNull();
  });
});

describe("round 32: a published day compares its saved day's own costliest clashes (K1, K3)", () => {
  // An invented published day: every name and every value below is invented for the test.
  const grid = [
    "act,stage,start,end,locked",
    "Amber Coast,North,18:00,19:00,",
    "Birch Lane,South,18:15,19:00,",
    "Cobalt Fern,East,18:00,19:30,yes",
    "Dune Parade,West,18:00,19:30,yes",
    "Elm Signal,Club,18:30,19:00,",
    "Fox Harbour,Tent,17:30,19:30,",
    "Gale Rooms,Field,18:00,18:45,",
  ].join("\n");
  const report = reportOf(grid);
  // The saved ranking, costliest first: a both-locked pair, a pair with a no-signal act, then movable pairs.
  const ranking = {
    pairs: [
      { a: "Cobalt Fern", b: "Dune Parade" },
      { a: "Gale Rooms", b: "Amber Coast" },
      { a: "Birch Lane", b: "Amber Coast" },
      { a: "Elm Signal", b: "Fox Harbour" },
      { a: "Nobody Here", b: "Amber Coast" },
      { a: "Amber Coast", b: "Fox Harbour" },
    ],
    noSignal: ["Gale Rooms"],
  };

  it("takes the saved day's ranked clashes in its order, passing over both-locked and no-signal pairs", () => {
    const request = priceRequest(report, ranking) as PriceRequest;
    expect(request.basis).toBe("saved_ranking");
    // The first pair compared is the saved day's first movable one, named in the ranking's own order.
    expect(request.overlaps.map((o) => `${o.a} × ${o.b}`)).toEqual([
      "Birch Lane × Amber Coast",
      "Elm Signal × Fox Harbour",
      "Amber Coast × Fox Harbour",
    ]);
    expect(request.skipped.map((o) => [o.a, o.b, o.reason])).toEqual([
      ["Cobalt Fern", "Dune Parade", "locked"],
      ["Gale Rooms", "Amber Coast", "no_signal"],
    ]);
    // C2: only the names in the pairs compared are sent in saved mode, never the grid's other acts.
    expect(request.acts).toEqual(["Birch Lane", "Amber Coast", "Elm Signal", "Fox Harbour"]);
    expect(JSON.parse(priceBody(request, "saved")).acts).toEqual(request.acts);
  });

  it("takes at most 10 pairs", () => {
    const wide = Array.from({ length: 20 }, (_, i) => `Act ${i},Stage ${i % 10},${i < 10 ? "18:00,19:00" : "18:30,19:30"}`).join("\n");
    const many = reportOf(wide);
    const pairs = many.shared.map((pair) => ({ a: pair.a.act, b: pair.b.act }));
    expect(pairs.length).toBeGreaterThan(10);
    const request = priceRequest(many, { pairs, noSignal: [] }) as PriceRequest;
    expect(request.overlaps).toHaveLength(PRICE_LIMITS.savedPairs);
    expect(request.overlaps.map((o) => `${o.a}|${o.b}`)).toEqual(pairs.slice(0, 10).map((p) => `${p.a}|${p.b}`));
  });

  it("keeps a pasted grid on its longest-first rule, and falls back to it when the ranking matches nothing", () => {
    const pasted = priceRequest(report) as PriceRequest;
    expect(pasted.basis).toBe("longest");
    expect(pasted.overlaps).toEqual((priceRequest(report, null) as PriceRequest).overlaps);
    expect(pasted.overlaps.map((o) => o.minutes)).toEqual([...pasted.overlaps.map((o) => o.minutes)].sort((x, y) => y - x));
    const elsewhere = priceRequest(report, { pairs: [{ a: "Nobody", b: "Else" }], noSignal: [] }) as PriceRequest;
    expect(elsewhere.basis).toBe("longest");
    expect(elsewhere.overlaps).toEqual(pasted.overlaps);
  });

  it("words the request and the result: intro, worked-example line, brief heading", () => {
    const request = priceRequest(report, ranking) as PriceRequest;
    expect(PRICE_COPY.intro(3, 4, false, "saved_ranking")).toBe(
      "Rule checks used no Qloo data. Compare sends this site’s server the saved day’s 3 costliest movable clashes, by its own ranking, and their 4 act names, never times, stages or rules; names are not stored or logged, and nothing goes to Qloo.",
    );
    expect(PRICE_COPY.workedExample).toBe(
      "These pairs are the saved day's costliest by this app's index, which already includes taste overlap: a worked example, not a test.",
    );
    expect(PRICE_COPY.briefHeading(3, "saved_ranking")).toBe("Taste overlap compared (the saved day’s 3 costliest clashes that can move)");
    const answer = parsePriceAnswer(answerFor(request, "saved_day", [0.2, 0.9, null]), request, "saved") as PriceAnswer;
    expect(answer.basis).toBe("saved_ranking");
    expect(lockedLine(request.skipped[0], "saved_ranking")).toContain("the next clash in the saved day’s ranking is compared instead");
    expect(passedLine(request.skipped[1], "saved_ranking")).toBe(
      "Gale Rooms × Amber Coast: 45 min shared. Not compared: the saved day marks an act of this pair as having no usable Qloo signal, so it was not sent.",
    );
  });

  it("orders by minutes, not by the order sent, so the order sentence stays computed for a ranked request", () => {
    const request = priceRequest(report, ranking) as PriceRequest;
    // Sent in ranking order (45, 30, 60 minutes); longest first puts the 60-minute pair first.
    expect(request.overlaps.map((o) => o.minutes)).toEqual([45, 30, 60]);
    const answer = parsePriceAnswer(answerFor(request, "saved_day", [0.2, 0.9, 0.5]), request, "saved") as PriceAnswer;
    expect(sortedPairs(answer, "minutes").map((p) => p.minutes)).toEqual([60, 45, 30]);
    expect(orderLine(answer)).toBe("Taste overlap changes the order of the 3 compared overlaps: Elm Signal × Fox Harbour moves from 3rd to 1st.");
    const flat = parsePriceAnswer(answerFor(request, "saved_day", [0.5, 0.2, 0.9]), request, "saved") as PriceAnswer;
    expect(orderLine(flat)).toBe("Taste overlap does not change the order of the 3 compared overlaps.");
  });

  it("puts the values first, then one count line and every reason in words (K3)", () => {
    const request = priceRequest(report, ranking) as PriceRequest;
    const answer = parsePriceAnswer(answerFor(request, "saved_day", [0.2, 0.9, null]), request, "saved") as PriceAnswer;
    const items = notCompared(request.skipped, answer);
    expect(items).toHaveLength(3);
    expect(notComparedLine(items, answer)).toBe("3 overlaps not compared: both sets locked (1), no usable Qloo signal (2).");
    expect(PRICE_COPY.notComparedSummary(3)).toBe("Why these were not compared (3)");
    const words = items.map((item) => notComparedText(item, answer, request.basis));
    expect(words[0]).toMatch(/Not compared: both sets are marked locked in this grid, so neither can move/);
    expect(words[1]).toMatch(/Not compared: the saved day marks an act of this pair as having no usable Qloo signal/);
    expect(words[2]).toMatch(/Not compared: .+ has no usable Qloo signal\. Shown by minutes only\./);
    // Before an answer, only the passed-over pairs are counted.
    expect(notComparedLine(notCompared(request.skipped, null), null)).toBe(
      "2 overlaps not compared: both sets locked (1), no usable Qloo signal (1).",
    );
    expect(notComparedLine([], answer)).toBeNull();
  });
});

describe("round 33: a published day opens in this app's ranking (C1)", () => {
  // The round-32 invented day above, again: its ranking chooses the pairs, costliest first.
  const grid = [
    "act,stage,start,end,locked",
    "Amber Coast,North,18:00,19:00,",
    "Birch Lane,South,18:15,19:00,",
    "Cobalt Fern,East,18:00,19:30,yes",
    "Dune Parade,West,18:00,19:30,yes",
    "Elm Signal,Club,18:30,19:00,",
    "Fox Harbour,Tent,17:30,19:30,",
    "Gale Rooms,Field,18:00,18:45,",
  ].join("\n");
  const report = reportOf(grid);
  const ranking = {
    pairs: [
      { a: "Cobalt Fern", b: "Dune Parade" },
      { a: "Gale Rooms", b: "Amber Coast" },
      { a: "Birch Lane", b: "Amber Coast" },
      { a: "Elm Signal", b: "Fox Harbour" },
      { a: "Amber Coast", b: "Fox Harbour" },
    ],
    noSignal: ["Gale Rooms"],
  };

  it("lists a published day's values in the order its pairs were chosen, its first movable clash first", () => {
    expect(defaultOrder("saved_ranking")).toBe("selection");
    expect(defaultOrder("longest")).toBe("minutes");
    expect(defaultOrder("served")).toBe("minutes");
    expect(defaultOrder(undefined)).toBe("minutes");
    expect(PRICE_COPY.rankingFirst).toBe("This app’s ranking");
    const request = priceRequest(report, ranking) as PriceRequest;
    const answer = parsePriceAnswer(answerFor(request, "saved_day", [0.2, 0.9, 0.5]), request, "saved") as PriceAnswer;
    const order = defaultOrder(answer.basis);
    // Row 1 is the saved day's first movable ranked pair, never the longest one.
    expect(comparedPairs(answer, order).map((p) => `${p.a} × ${p.b}`)).toEqual([
      "Birch Lane × Amber Coast",
      "Elm Signal × Fox Harbour",
      "Amber Coast × Fox Harbour",
    ]);
    expect(comparedPairs(answer, "minutes").map((p) => p.minutes)).toEqual([60, 45, 30]);
    expect(comparedPairs(answer, "overlap").map((p) => p.overlap)).toEqual([0.9, 0.5, 0.2]);
    // An unpriced pair goes last in this order too.
    const gap = parsePriceAnswer(answerFor(request, "saved_day", [null, 0.9, 0.5]), request, "saved") as PriceAnswer;
    expect(sortedPairs(gap, "selection").map((p) => p.overlap)).toEqual([0.9, 0.5, null]);
    // The rank on each row is a taste rank, apart from the hero's index rank.
    expect(pairLine(comparedPairs(answer, order)[0], answer)).toBe(
      "Birch Lane × Amber Coast: 45 min shared. Taste overlap 20 / 100, taste rank 3 of 3.",
    );
  });
});

describe("round 33: a pasted grid on a published day compares pairs the saved server serves (C3)", () => {
  // An invented published day in the route's shape: every name, id and count is invented for the test.
  const scheduled = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"];
  const names = new Map([
    ["a", "Aster Vale"],
    ["b", "Basil Rowe"],
    ["c", "Cobble Lane"],
    ["d", "Dove Harbor"],
    ["e", "Elder Moss"],
    ["f", "Fern Gully"],
    ["g", "Glint"],
    ["h", "Glint"],
    ["i", "Iris Coast"],
    ["j", "Juniper Tide"],
    ["k", "Kestrel Bay"],
    ["z", "Zinc Unbilled"],
  ]);
  const day = {
    id: "orchard-2031-sat",
    title: "Orchard 2031, Saturday",
    synthetic: false,
    festival: {
      stages: [{ id: "n", name: "North" }],
      acts: [...names].map(([id, name]) => ({ id, name })),
      timetable: scheduled.map((id, at) => ({ act_id: id, day: 0, stage_id: "n", start: 600 + 60 * at, end: 650 + 60 * at, locked: false })),
    },
    report: {
      clashes: [
        { rank: 1, day: 0, a: { act_id: "a" }, b: { act_id: "b" } },
        { rank: 2, day: 0, a: { act_id: "c" }, b: { act_id: "d" } },
      ],
      coverage: { unscored: [{ act_id: "f", name: "Fern Gully", reason: "no_signal" }] },
    },
    // A receipt for a pair the page prints, and one with an act not on the timetable (never counted).
    evidence: { receipts: { "a|c": {}, "a|z": {} } },
  };
  const lens = {
    kind: "lenses",
    day: 0,
    ranked: 2,
    with_taste: [{ a: "Basil Rowe", b: "Dove Harbor", a_id: "b", b_id: "d", rank: 1, rank_without_taste: 2 }],
    without_taste: [{ a: "Elder Moss", b: "Aster Vale", a_id: "e", b_id: "a", rank: 1, rank_with_taste: null }],
    only_with_taste: 0,
    only_without_taste: 0,
    apart: [{ a: "Cobble Lane", b: "Elder Moss", a_id: "c", b_id: "e" }],
  };
  const served = servableDay(day, [lens]);
  if (!served) throw new Error("not read");
  const key = (a: string, b: string) => [matchKey(a), matchKey(b)].sort().join("\u0000");

  it("reads the day's names, its no-signal acts and exactly the pairs its page prints: ranked clashes, receipts, lens pairs", () => {
    expect(served.title).toBe("Orchard 2031, Saturday");
    // A name two acts share is never matched, as the server rules; an act off the timetable is not the day's.
    expect([...served.names.keys()].sort()).toEqual([
      "aster vale",
      "basil rowe",
      "cobble lane",
      "dove harbor",
      "elder moss",
      "fern gully",
      "iris coast",
      "juniper tide",
      "kestrel bay",
    ]);
    expect([...served.noSignal]).toEqual(["fern gully"]);
    // Every pair of the subset is one the page renders (so the server serves it): none is a guess.
    const rendered = [
      ...day.report.clashes.map((c) => [c.a.act_id, c.b.act_id]),
      ...Object.keys(day.evidence.receipts).map((k) => k.split("|")),
      ...[...lens.with_taste, ...lens.without_taste, ...lens.apart].map((p) => [p.a_id, p.b_id]),
    ]
      .filter(([x, y]) => scheduled.includes(x) && scheduled.includes(y))
      .map(([x, y]) => key(names.get(x) as string, names.get(y) as string));
    expect([...served.pairs].sort()).toEqual([...new Set(rendered)].sort());
    expect(served.pairs.size).toBe(6);
    // Not a festival day, or the invented day: nothing is read.
    expect(servableDay({ ...day, synthetic: true })).toBeNull();
    expect(servableDay({ title: "x" })).toBeNull();
    // A lens in another shape adds nothing.
    expect(servableDay(day, [{ kind: "other" }])?.pairs.size).toBe(3);
  });

  it("matches a grid to the day by the server's rule: at least 80% of its names, case, accents and a leading The ignored", () => {
    const grid = ["The Aster Vale", "BASIL ROWE", "Cóbble Lane", "Dove Harbor", "Somebody Else"];
    expect(matchServableDay(grid, [served])).toBe(served);
    expect(matchServableDay([...grid, "Nobody Here"], [served])).toBeNull();
    expect(matchServableDay(["Glint", "Aster Vale", "Basil Rowe", "Cobble Lane"], [served])).toBeNull();
    expect(matchServableDay([], [served])).toBeNull();
  });

  // A pasted draft of that day (other times than the published ones), with one act not on the day.
  const pasted = reportOf(
    [
      "act,stage,start,end,locked",
      "Aster Vale,North,18:00,19:00,",
      "Basil Rowe,South,18:30,19:30,",
      "Cobble Lane,East,17:00,19:00,yes",
      "Dove Harbor,West,17:00,18:30,yes",
      "Elder Moss,Club,18:15,19:15,",
      "Fern Gully,Tent,18:00,20:00,",
      "Hollow Pine,Field,18:00,19:30,",
    ].join("\n"),
  );

  it("fills the slots with the pairs the day's page prints first, longest first, then the longest others (up to 10)", () => {
    const grid = [...new Set(pasted.sets.map((set) => set.act))];
    expect(matchServableDay(grid, [served])).toBe(served);
    const request = priceRequest(pasted, null, served) as PriceRequest;
    expect(request.basis).toBe("served");
    expect(request.served).toEqual({ title: "Orchard 2031, Saturday", pairs: 4 });
    expect(request.overlaps).toHaveLength(PRICE_LIMITS.savedPairs);
    const printed = request.overlaps.slice(0, 4);
    const others = request.overlaps.slice(4);
    for (const o of printed) expect(served.pairs.has(key(o.a, o.b)), `${o.a} × ${o.b}`).toBe(true);
    for (const o of others) expect(served.pairs.has(key(o.a, o.b)), `${o.a} × ${o.b}`).toBe(false);
    for (const group of [printed, others]) {
      expect(group.map((o) => o.minutes)).toEqual([...group.map((o) => o.minutes)].sort((x, y) => y - x));
    }
    expect(printed.map((o) => o.minutes)).toEqual([60, 45, 45, 30]);
    // Both-locked and no-signal pairs are passed over with their reason, never sent.
    expect(request.overlaps.some((o) => [o.a, o.b].includes("Fern Gully"))).toBe(false);
    expect(request.overlaps.some((o) => [o.a, o.b].sort().join("|") === "Cobble Lane|Dove Harbor")).toBe(false);
    expect(request.skipped.filter((o) => o.reason === "locked").map((o) => [o.a, o.b].sort().join(" × "))).toEqual(["Cobble Lane × Dove Harbor"]);
    expect(request.skipped.filter((o) => o.reason === "no_signal")).toHaveLength(6);
    // C2: only the names of the pairs sent, and the day still holds 80% of them.
    expect(request.acts).toEqual(pairNames(request.overlaps));
    expect(matchServableDay(request.acts, [served])).toBe(served);
    // The live request is the pasted rule as it always was.
    expect(request.liveOverlaps).toEqual((priceRequest(pasted) as PriceRequest).overlaps);
    expect(request.liveOverlaps).toHaveLength(PRICE_LIMITS.pairs);
  });

  it("adds the fewest other names of the day so the server still finds it, and then says the count alone", () => {
    // Eight acts of the day and two that are not: 80%, so the grid is on the day. Only two pairs share time,
    // one the page prints and one of the two strangers: their 4 names alone would be half on the day.
    const strangers = reportOf(
      [
        "act,stage,start,end,locked",
        "Aster Vale,North,10:00,11:00,",
        "Basil Rowe,South,10:30,11:30,",
        "Quartz Owl,East,10:00,11:00,",
        "Rune Fox,West,10:00,11:00,",
        "Cobble Lane,North,12:00,12:30,",
        "Dove Harbor,North,13:00,13:30,",
        "Elder Moss,North,14:00,14:30,",
        "Iris Coast,North,15:00,15:30,",
        "Juniper Tide,North,16:00,16:30,",
        "Kestrel Bay,North,17:00,17:30,",
      ].join("\n"),
    );
    const grid = [...new Set(strangers.sets.map((set) => set.act))];
    expect(matchServableDay(grid, [served])).toBe(served);
    const request = priceRequest(strangers, null, served) as PriceRequest;
    expect(request.overlaps.map((o) => `${o.a} × ${o.b}`)[0]).toBe("Aster Vale × Basil Rowe");
    const own = pairNames(request.overlaps);
    expect(request.acts.slice(0, own.length)).toEqual(own);
    expect(extraNames(request)).toBe(request.acts.length - own.length);
    expect(extraNames(request)).toBeGreaterThan(0);
    // The fewest: the day holds 80% of the names sent, and one name fewer would not do.
    const onDay = (list: string[]) => list.filter((name) => served.names.has(matchKey(name))).length;
    expect(onDay(request.acts)).toBeGreaterThanOrEqual(PRICE_LIMITS.savedShare * request.acts.length);
    const fewer = request.acts.slice(0, -1);
    expect(onDay(fewer)).toBeLessThan(PRICE_LIMITS.savedShare * fewer.length);
    expect(PRICE_COPY.intro(request.overlaps.length, request.acts.length, false, request.basis, request.served, extraNames(request))).toContain(
      `and ${request.acts.length} act names, never times`,
    );
  });

  it("keeps the pasted rule when no published day holds the grid's names", () => {
    const stranger = reportOf("Mica Dune,North,18:00,19:00\nNectar Bow,South,18:30,19:30\nOpal Field,East,18:00,19:00\nPeat Moss,West,18:45,19:30");
    expect(matchServableDay([...new Set(stranger.sets.map((set) => set.act))], [served])).toBeNull();
    const request = priceRequest(stranger, null, null) as PriceRequest;
    expect(request.basis).toBe("longest");
    expect(request.served).toBeNull();
    expect(request.overlaps.length).toBeLessThanOrEqual(PRICE_LIMITS.pairs);
  });

  it("words the request, the no-value line and the brief heading for a day it matched", () => {
    expect(PRICE_COPY.intro(10, 17, false, "served", { title: "Orchard 2031, Saturday", pairs: 4 })).toBe(
      "Rule checks used no Qloo data. These acts are on Orchard 2031, Saturday. Compare sends this site’s server 10 movable overlaps, those its timetable page prints first, and their 17 act names, never times, stages or rules; names are not stored or logged.",
    );
    expect(PRICE_COPY.intro(10, 17, false, "served", { title: "Orchard 2031, Saturday", pairs: 10 })).toContain(
      "the 10 longest movable overlaps its timetable page prints and their 17 act names",
    );
    expect(PRICE_COPY.noneServed("Orchard 2031, Saturday")).toBe(
      "None of these overlaps got a value: this site serves saved Qloo values only for the pairs the timetable page of Orchard 2031, Saturday prints.",
    );
    expect(PRICE_COPY.briefHeading(10, "served")).toBe("Taste overlap compared (10 overlaps, those the saved day’s page prints first)");
    expect(PRICE_COPY.moreCompared(5)).toBe("5 more compared overlaps");
    expect(PRICE_COPY.moreCompared(1)).toBe("1 more compared overlap");
  });

  it("reads the published days with bodiless GETs of this app's own API: the list, each real day and its lens", async () => {
    const answers = new Map<string, unknown>([
      [
        "/api/presets",
        [
          { id: "synthetic-day", title: "Invented", synthetic: true },
          { id: "orchard-2031-sat", title: "Orchard 2031, Saturday", synthetic: false },
        ],
      ],
      ["/api/presets/orchard-2031-sat", day],
      ["/api/presets/orchard-2031-sat/lenses?day=0", lens],
    ]);
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url: string) => {
      const body = answers.get(url) ?? null;
      return new Response(JSON.stringify(body), { status: body === null ? 404 : 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);
    const days = await loadServableDays();
    expect(days.map((d) => d.id)).toEqual(["orchard-2031-sat"]);
    expect(days[0].pairs.size).toBe(6);
    const calls = fetch.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual(["/api/presets", "/api/presets/orchard-2031-sat", "/api/presets/orchard-2031-sat/lenses?day=0"]);
    for (const [, init] of calls) {
      expect(init).toMatchObject({ method: "GET", cache: "no-store", referrerPolicy: "no-referrer" });
      expect(init.body).toBeUndefined();
    }
    vi.stubGlobal("fetch", respond(500, {}));
    expect(await loadServableDays()).toEqual([]);
  });
});

describe("round 33: the rank scope never says \"acts you pasted\" for a published day (C7)", () => {
  it("leaves the pasted clause out for a published day loaded here, and keeps it for a paste", () => {
    const base = { source: "saved_day" as const, sent: 16, omitted: 0, comparator: { kind: "saved_day" as const, acts: 36 } };
    expect(rankScope({ ...base, basis: "saved_ranking" })).toBe(
      "Values come from the saved day: each is a rank among the acts on that day’s lineup of 36 acts and not attendance. “Taste rank 1 of n” orders only the pairs compared here.",
    );
    expect(rankScope({ ...base, basis: "saved_ranking" })).not.toMatch(/acts you pasted/);
    for (const basis of ["longest", "served"] as const) {
      expect(rankScope({ ...base, basis })).toContain("not among the acts you pasted");
    }
  });
});

describe("round 33: the intro is short and keeps every true clause (C2)", () => {
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
  const variants = [
    PRICE_COPY.intro(5, 10),
    PRICE_COPY.intro(5, 10, true),
    PRICE_COPY.intro(1, 4, false, "longest", null, 2),
    PRICE_COPY.intro(10, 16, false, "saved_ranking"),
    PRICE_COPY.intro(10, 17, false, "served", { title: "Glastonbury 2025, Sunday", pairs: 0 }),
    PRICE_COPY.intro(10, 17, false, "served", { title: "Glastonbury 2025, Sunday", pairs: 6 }),
    PRICE_COPY.intro(10, 17, false, "served", { title: "Glastonbury 2025, Sunday", pairs: 10 }),
    PRICE_COPY.intro(10, 18, false, "served", { title: "Riot Fest 2026, Sunday", pairs: 6 }, 1),
  ];

  it("is at most 45 words in every form", () => {
    for (const text of variants) expect(words(text), text).toBeLessThanOrEqual(45);
  });

  it("says in every form that the checks used no Qloo data, what is sent and what is not, and that no name is kept", () => {
    for (const text of variants) {
      expect(text).toMatch(/^Rule checks used no Qloo data\./);
      expect(text).toContain("Compare sends this site’s server");
      expect(text).toMatch(/\d+ act names?, never times, stages or rules; names are not stored or logged/);
    }
    // Live off: nothing is compared without a saved day. Live on: the choice to ask Qloo, never a promise.
    expect(variants[0]).toContain("With no saved day, nothing is compared: live Qloo comparison is off here.");
    expect(variants[1]).toContain("With no saved day, you can choose to ask Qloo instead.");
    expect(variants[3]).toContain("and nothing goes to Qloo.");
  });
});

describe("round 33: Find a change scored on a published day's index (C6)", () => {
  // Ids of an invented published day: the grid's acts and stages by normalised name.
  const report = reportOf("Aster Vale,North,18:00,19:00\nBasil Rowe,South,18:30,19:30\nCobble Lane,North,20:00,21:00\nDove Harbor,South,20:15,21:00");
  const ids = {
    day: 0,
    acts: new Map([
      ["aster vale", "aster-vale"],
      ["basil rowe", "basil-rowe"],
      ["cobble lane", "cobble-lane"],
      ["dove harbor", "dove-harbor"],
    ]),
    stages: new Map([
      ["north", "north"],
      ["south", "south"],
    ]),
  };
  const first = report.shared.find((pair) => pair.a.act === "Aster Vale" && pair.b.act === "Basil Rowe");
  if (!first) throw new Error("no overlap");
  const rows = [first.a.row, first.b.row];
  const move = { act: "Basil Rowe", stageKey: "south", start: 19 * 60 };

  it("turns a listed change into a rule step of the published day: the pair and each move, by id", () => {
    expect(scoreStepOf(report, rows, [move], ids)).toEqual({
      a: "aster-vale",
      b: "basil-rowe",
      moves: [{ act: "basil-rowe", stageId: "south", day: 0, start: "19:00" }],
    });
    // Not a pair of two acts, or a name or stage the day does not have: no step.
    expect(scoreStepOf(report, [rows[0]], [move], ids)).toBeNull();
    expect(scoreStepOf(report, [rows[0], rows[0]], [move], ids)).toBeNull();
    expect(scoreStepOf(report, rows, [{ ...move, stageKey: "tent" }], ids)).toBeNull();
    expect(scoreStepOf(report, rows, [], ids)).toBeNull();
    expect(clockOf(1260)).toBe("21:00");
    expect(clockOf(1460)).toBe("24:20");
    expect(clockOf(545)).toBe("9:05");
  });

  it("sends the route's rule-step body: ids and start times of the public timetable, nothing else", () => {
    const step = scoreStepOf(report, rows, [move], ids);
    if (!step) throw new Error("no step");
    expect(JSON.parse(scoreBody([step]))).toEqual({
      moves: [{ rule: { a: "aster-vale", b: "basil-rowe" }, moves: [{ act: "basil-rowe", stage_id: "south", day: 0, start: "19:00" }] }],
      act: null,
      limit: 8,
    });
    expect(scoreBody([step])).not.toMatch(/Aster Vale|Basil Rowe|North|South/);
  });

  it("reads the index before and after: the published day's, or the one the changes already applied leave", () => {
    const one = { kind: "whatif", published_budget: 116.71, plan: { budget: 115.1, steps: [{ budget_after: 115.12 }] } };
    expect(readScore(one, 1)).toEqual({ before: 116.71, after: 115.12 });
    const two = { kind: "whatif", published_budget: 116.71, plan: { budget: 113, steps: [{ budget_after: 114.26 }, { budget_after: 113.04 }] } };
    expect(readScore(two, 2)).toEqual({ before: 114.26, after: 113.04 });
    expect(readScore(two, 1)).toBeNull();
    expect(readScore({ ...one, published_budget: null }, 1)).toBeNull();
    expect(readScore({ kind: "move_options" }, 1)).toBeNull();
    expect(SCORE_COPY.scored(116.71, 115.12)).toBe("Index 116.7 → 115.1.");
    expect(SCORE_COPY.notScored(SCORE_COPY.limit)).toBe("Index not scored: this server’s limit on what-if requests was reached.");
  });

  it("makes one POST of the what-if route per change, never retried, and says any refusal in words", async () => {
    const step = scoreStepOf(report, rows, [move], ids);
    if (!step) throw new Error("no step");
    const ok = respond(200, { kind: "whatif", published_budget: 116.71, plan: { budget: 115.1, steps: [{ budget_after: 115.12 }] } });
    vi.stubGlobal("fetch", ok);
    expect(await scoreSteps("orchard-2031-sat", [step])).toEqual({ status: "scored", before: 116.71, after: 115.12 });
    expect(ok).toHaveBeenCalledTimes(1);
    const [url, init] = ok.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/presets/orchard-2031-sat/whatif");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", referrerPolicy: "no-referrer" });
    for (const [status, reason] of [
      [422, SCORE_COPY.illegal],
      [429, SCORE_COPY.limit],
      [500, SCORE_COPY.error],
    ] as const) {
      const refused = respond(status, { detail: "x" });
      vi.stubGlobal("fetch", refused);
      expect(await scoreSteps("orchard-2031-sat", [step])).toEqual({ status: "not_scored", reason });
      expect(refused).toHaveBeenCalledTimes(1);
    }
    vi.stubGlobal("fetch", respond(422, { detail: "x" }));
    expect(await scoreSteps("orchard-2031-sat", [step, step])).toEqual({ status: "not_scored", reason: SCORE_COPY.illegalAfter });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await scoreSteps("orchard-2031-sat", [step])).toEqual({ status: "not_scored", reason: SCORE_COPY.error });
    // Over the route's 8 moved sets, or an id it would refuse: nothing is sent.
    const none = respond(200, {});
    vi.stubGlobal("fetch", none);
    const nine = Array.from({ length: MAX_SCORE_MOVES + 1 }, () => step);
    expect(await scoreSteps("orchard-2031-sat", nine)).toEqual({ status: "not_scored", reason: SCORE_COPY.tooMany });
    expect(await scoreSteps("../x", [step])).toEqual({ status: "not_scored", reason: SCORE_COPY.error });
    expect(none).not.toHaveBeenCalled();
  });

  it("words what is scored and what leaves the browser for it, and where scoring is not available", () => {
    expect(SCORE_COPY.scope(3)).toBe(
      "The first 3 changes listed are scored on the published day’s Clash Budget Index (lower is better). This site’s server gets only those changes to its public timetable; no Qloo request is sent.",
    );
    expect(SCORE_COPY.scope(1, true)).toContain(
      "The first change listed is scored on the published day’s Clash Budget Index (lower is better), with your applied changes in place.",
    );
    expect(SCORE_COPY.unavailable).toBe("Index scoring is available on the published days only.");
  });
});
