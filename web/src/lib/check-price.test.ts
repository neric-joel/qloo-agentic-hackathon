import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCheck, type CheckReport } from "@/lib/check";
import {
  PRICE_COPY,
  PRICE_LIMITS,
  firstPublishedDay,
  loadPublishedDay,
  loadPublishedTimetable,
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

describe("what a press sends", () => {
  it("prices the sample's 5 longest overlaps, one per pair of acts, and sends its 24 act names", () => {
    const report = sample();
    const request = priceRequest(report);
    expect(request).not.toBeNull();
    if (!request) return;
    expect(request.overlaps).toHaveLength(PRICE_LIMITS.pairs);
    expect(request.overlaps.map((o) => o.minutes)).toEqual(report.shared.slice(0, 5).map((p) => p.minutes));
    expect(request.acts).toHaveLength(24);
    expect(new Set(request.acts).size).toBe(24);
    for (const o of request.overlaps) {
      expect(request.acts).toContain(o.a);
      expect(request.acts).toContain(o.b);
    }
    const inPairs = new Set(request.overlaps.flatMap((o) => [o.a, o.b]));
    expect(request.need).toBe(24 + inPairs.size);
    // The acts of the priced pairs come first.
    expect(new Set(request.acts.slice(0, inPairs.size))).toEqual(inPairs);
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
    // A saved answer sends no Qloo request, so every name of a 40-act grid goes; a live one takes 25.
    expect(request.acts).toHaveLength(40);
    expect(request.liveActs).toHaveLength(PRICE_LIMITS.maxActs);
    expect(request).toMatchObject({ omitted: 0, liveOmitted: 15 });
    expect(request.liveActs).toEqual(request.acts.slice(0, PRICE_LIMITS.maxActs));
    for (const o of request.overlaps) {
      expect(request.acts).toEqual(expect.arrayContaining([o.a, o.b]));
      expect(request.liveActs).toEqual(expect.arrayContaining([o.a, o.b]));
    }
    // The check reads at most 60 sets, so a saved request never leaves a name out; the cap is the route's.
    const sixty = Array.from({ length: 60 }, (_, i) => `Act ${i},Stage ${i % 10},${10 + Math.floor(i / 10) * 2}:00,${11 + Math.floor(i / 10) * 2}:30`).join("\n");
    const full = priceRequest(reportOf(sixty)) as PriceRequest;
    expect(full.acts).toHaveLength(PRICE_LIMITS.savedActs);
    expect(full).toMatchObject({ total: 60, omitted: 0, liveOmitted: 35 });
  });

  it("sends every act name up to 60 in saved mode and 25 in live mode, with the same pairs (K2)", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Act ${i},Stage ${i % 8},${10 + Math.floor(i / 8) * 2}:00,${11 + Math.floor(i / 8) * 2}:30`).join("\n");
    const request = priceRequest(reportOf(many)) as PriceRequest;
    const saved = JSON.parse(priceBody(request, "saved")) as { acts: string[]; pairs: string[][] };
    const live = JSON.parse(priceBody(request, "live")) as { acts: string[]; pairs: string[][] };
    expect(saved.acts).toHaveLength(40);
    expect(live.acts).toHaveLength(25);
    expect(saved.pairs).toEqual(live.pairs);
    expect(saved.pairs).toHaveLength(PRICE_LIMITS.pairs);
    // The live consent counts the live names; the intro the saved ones, with no "not sent" clause when none is left out.
    expect(PRICE_COPY.intro(request.overlaps.length, request.acts.length, request.omitted)).toContain("we send the 40 act names and the pairs");
    expect(scopeNote(null, request)).not.toMatch(/not sent/);
    expect(request.need).toBe(25 + new Set(request.overlaps.flatMap((o) => [o.a, o.b])).size);
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
    // Recorded from POST /api/price-grid in-process with only the invented day loaded.
    const recorded = {
      mode: "saved",
      source: "invented_day",
      preset_id: "synthetic-lanternfield-friday",
      fetched_at: null,
      coverage: { acts: 24, priced: 23, unpriced: ["Cedar Roads"] },
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
    expect(coverageLine(answer)).toBe("23 of 24 acts with a usable signal");
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
    const limit = "Live pricing has reached today's limit. Your rule results are unchanged, and a saved day prices without a limit.";
    vi.stubGlobal("fetch", respond(429, { detail: { code: "limit", message: limit } }));
    expect(await requestPrice(request, "live")).toEqual({ status: "refused", code: "limit", message: limit });
    vi.stubGlobal("fetch", respond(503, { detail: { code: "no_answer", message: "Qloo did not answer in time; nothing was priced." } }));
    expect(await requestPrice(request, "live")).toMatchObject({ status: "refused", code: "no_answer" });
    // not_a_saved_day on a live request is not a reason to offer live again.
    vi.stubGlobal("fetch", respond(422, { detail: { code: "not_a_saved_day", message: "x" } }));
    expect(await requestPrice(request, "live")).toMatchObject({ status: "refused" });
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
    expect(pairLine(first, answer)).toBe(`${first.a} × ${first.b}: ${first.minutes} min shared. Taste overlap 40 / 100, ranked 2 of 4.`);
    const last = answer.pairs[4];
    // The invented day is not Qloo data, so its reason never names Qloo.
    expect(pairLine(last, answer)).toBe(
      `${last.a} × ${last.b}: ${last.minutes} min shared. Not compared: ${last.b} has no usable signal. Shown by minutes only.`,
    );
    expect(pairLine(last, { ...answer, source: "saved_day" })).toContain(`Not compared: ${last.b} has no usable Qloo signal.`);
    expect(coverageLine(answer)).toBe("23 of 24 acts with a usable signal");
    const notRanked = { ...last, reason: "not_ranked_on_saved_day" as const };
    expect(pairLine(notRanked, answer)).toContain(
      "Not compared: both acts are on the saved day, but this demo serves readings only for the pairs its timetable page shows, and this pair is not one of them. Shown by minutes only.",
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
      "These acts are not on a saved day. We can ask Qloo now. This sends 21 act names to Qloo, a third party; Qloo's terms govern what it keeps. Do not send acts you have not announced. A live answer uses about 31 Qloo requests; live pricing is capped per day on this server.",
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
    expect(request.acts).toHaveLength(30);
    expect(request.liveActs).toHaveLength(25);
    expect(request).toMatchObject({ total: 30, omitted: 0, liveOmitted: 5 });
    expect(PRICE_COPY.intro(request.overlaps.length, request.acts.length, request.omitted)).toContain("we send the 30 act names and the pairs");
    expect(scopeNote(null, request)).not.toContain("not sent");
    const live = parsePriceAnswer(answerFor(request, "qloo_live", [0.5, 0.4, 0.3, 0.2, 0.1].slice(0, request.overlaps.length)), request, "live") as PriceAnswer;
    expect(live.omitted).toBe(5);
    expect(rankScope(live)).toBe(
      "A rank among the 25 acts sent to Qloo just now, not attendance, and not comparable with a published day’s figures. This grid has 30 different acts and at most 25 are sent, so 5 acts are not sent and not compared.",
    );
    const saved = parsePriceAnswer(answerFor(request, "saved_day", [0.5, 0.4, 0.3, 0.2, 0.1].slice(0, request.overlaps.length)), request, "saved") as PriceAnswer;
    expect(saved).toMatchObject({ sent: 30, omitted: 0 });
    expect(rankScope(saved)).not.toContain("not sent");
    // Were a grid ever past the saved cap, the same sentences would say so with the cap that applies.
    expect(PRICE_COPY.intro(5, 60, 4)).toContain("we send 60 of the grid’s 64 act names (the acts of these overlaps first) and the pairs");
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
    expect(PRICE_COPY.notSaved(21, 31)).toContain("live pricing is capped per day on this server");
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
    expect(coverageLine(old)).toBe("23 of 24 acts with a usable signal");
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
    expect(lines[0]).toBe(`${request.overlaps[0].a} × ${request.overlaps[0].b}: ${request.overlaps[0].minutes} min shared. Taste overlap 91 / 100, ranked 1 of 5.`);
    expect(lines[4]).toContain("Taste overlap 5 / 100, ranked 5 of 5.");
    for (const line of [...lines, orderLine(answer) ?? ""]) {
      expect(line).not.toMatch(/Audience overlap \d|0\.\d\d|%/);
    }
  });

  it("says \"the only pair compared\" when one pair has a value, never \"ranked 1 of 1\"", () => {
    const answer = parsePriceAnswer(answerFor(request, "invented_day", [0.73, null, null, null, null]), request, "saved") as PriceAnswer;
    const line = pairLine(answer.pairs[0], answer);
    expect(line).toBe(`${request.overlaps[0].a} × ${request.overlaps[0].b}: ${request.overlaps[0].minutes} min shared. Taste overlap 73 / 100, the only pair compared.`);
    expect(line).not.toContain("ranked 1 of 1");
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
      "These acts are not on a saved day, and live Qloo pricing is off on this server, so they are not compared. Acts on a saved day still compare.",
    );
    expect(PRICE_COPY.liveOff).not.toMatch(/We can ask Qloo now|Ask Qloo for/);
    expect(PRICE_COPY.intro(5, 24)).toMatch(/If no saved day matches, nothing is compared: live Qloo pricing is off on this server\.$/);
    expect(PRICE_COPY.intro(5, 24, 0, false)).not.toContain("you can choose to ask Qloo");
    expect(PRICE_COPY.intro(5, 24, 0, true)).toMatch(/If no saved day matches, you can choose to ask Qloo instead\.$/);
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
      "Pine Lantern × Quill Harbor: 110 min shared. Not compared: both sets are locked, so neither can move; the next-longest overlap is compared instead.",
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
    // K4: true to the server, which answers only the pairs the timetable page prints (pair.py taste_pairs).
    expect(unpricedReason({ a: "Pine Lantern", b: "Quill Harbor", reason: "not_ranked_on_saved_day" }, saved)).toBe(
      "both acts are on the saved day, but this demo serves readings only for the pairs its timetable page shows, and this pair is not one of them",
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
    // Every act name of the grid is sent in saved mode.
    expect(request.acts).toHaveLength(7);
    expect(new Set(request.acts.slice(0, 4))).toEqual(new Set(["Birch Lane", "Amber Coast", "Elm Signal", "Fox Harbour"]));
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
    expect(PRICE_COPY.intro(3, 7, 0, false, "saved_ranking")).toContain(
      "To compare audience overlap for the saved day’s 3 costliest clashes that can move (its own ranking, pairs with both sets locked passed over), we send the 7 act names and the pairs",
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
    expect(words[0]).toMatch(/Not compared: both sets are locked/);
    expect(words[1]).toMatch(/Not compared: the saved day marks an act of this pair as having no usable Qloo signal/);
    expect(words[2]).toMatch(/Not compared: .+ has no usable Qloo signal\. Shown by minutes only\./);
    // Before an answer, only the passed-over pairs are counted.
    expect(notComparedLine(notCompared(request.skipped, null), null)).toBe(
      "2 overlaps not compared: both sets locked (1), no usable Qloo signal (1).",
    );
    expect(notComparedLine([], answer)).toBeNull();
  });
});
