import { afterEach, describe, expect, it, vi } from "vitest";

import { drawerRank, drawerRankOf, fetchLenses, LensUnavailable, parseLenses, rankWithoutTaste } from "./lenses";

// Every name and figure below is invented for the test.
function raw(): Record<string, unknown> {
  return {
    kind: "lenses",
    day: 0,
    ranked: 3,
    with_taste: [
      { a: "Act One", b: "Act Two", a_id: "one", b_id: "two", rank: 1, rank_without_taste: 7 },
      { a: "Act Three", b: "Act Four", a_id: "three", b_id: "four", rank: 2, rank_without_taste: 1 },
      { a: "Act Five", b: "Act Six", a_id: "five", b_id: "six", rank: 3, rank_without_taste: null },
    ],
    without_taste: [
      { a: "Act Three", b: "Act Four", a_id: "three", b_id: "four", rank: 1, rank_with_taste: 2 },
      { a: "Act Seven", b: "Act Eight", a_id: "seven", b_id: "eight", rank: 2, rank_with_taste: 9 },
      { a: "Act Nine", b: "Act Ten", a_id: "nine", b_id: "ten", rank: 3, rank_with_taste: null },
    ],
    only_with_taste: 2,
    only_without_taste: 2,
    apart: [{ a: "Act Eleven", b: "Act Twelve", a_id: "eleven", b_id: "twelve" }],
  };
}

describe("parseLenses", () => {
  it("reads a well-formed response", () => {
    const lenses = parseLenses(raw());
    expect(lenses).not.toBeNull();
    expect(lenses?.ranked).toBe(3);
    expect(lenses?.with_taste[2].rank_without_taste).toBeNull();
    expect(lenses?.without_taste[1]).toEqual({
      a: "Act Seven",
      b: "Act Eight",
      a_id: "seven",
      b_id: "eight",
      rank: 2,
      rank_with_taste: 9,
    });
    expect(lenses?.apart).toHaveLength(1);
  });

  it("accepts empty lists and zero counts", () => {
    expect(
      parseLenses({ ...raw(), with_taste: [], without_taste: [], apart: [], only_with_taste: 0, only_without_taste: 0 }),
    ).not.toBeNull();
  });

  it("reads an older response with none of the additive fields", () => {
    const lenses = parseLenses(raw());
    expect(lenses?.priced_with_taste).toBeUndefined();
    expect(lenses?.priced_without_taste).toBeUndefined();
    expect(lenses?.shuffled).toBeUndefined();
  });

  it("reads the rank denominators and the shuffled comparison when present", () => {
    const lenses = parseLenses({
      ...raw(),
      priced_with_taste: 68,
      priced_without_taste: 66,
      shuffled: { runs: 200, median: 10, low: 8, high: 12 },
    });
    expect(lenses?.priced_with_taste).toBe(68);
    expect(lenses?.priced_without_taste).toBe(66);
    expect(lenses?.shuffled).toEqual({ runs: 200, median: 10, low: 8, high: 12 });
  });

  it("drops an unreadable additive field instead of rejecting the response", () => {
    for (const shuffled of [
      { runs: 200, median: 10, low: 8 },
      { runs: 200, median: 10.5, low: 8, high: 12 },
      { runs: 0, median: 10, low: 8, high: 12 },
      { runs: 200, median: 7, low: 8, high: 12 },
      "many",
      null,
    ]) {
      const lenses = parseLenses({ ...raw(), shuffled, priced_with_taste: 1.5, priced_without_taste: "68" });
      expect(lenses).not.toBeNull();
      expect(lenses?.shuffled).toBeUndefined();
      expect(lenses?.priced_with_taste).toBeUndefined();
      expect(lenses?.priced_without_taste).toBeUndefined();
    }
  });

  it("rejects float, zero and string ranks", () => {
    const withFloat = raw();
    (withFloat.with_taste as Record<string, unknown>[])[0].rank = 1.5;
    expect(parseLenses(withFloat)).toBeNull();

    const withFloatOther = raw();
    (withFloatOther.without_taste as Record<string, unknown>[])[0].rank_with_taste = 2.25;
    expect(parseLenses(withFloatOther)).toBeNull();

    const withZero = raw();
    (withZero.with_taste as Record<string, unknown>[])[0].rank = 0;
    expect(parseLenses(withZero)).toBeNull();

    const withString = raw();
    (withString.with_taste as Record<string, unknown>[])[0].rank_without_taste = "7";
    expect(parseLenses(withString)).toBeNull();

    expect(parseLenses({ ...raw(), ranked: 15.5 })).toBeNull();
    expect(parseLenses({ ...raw(), only_with_taste: -1 })).toBeNull();
  });

  it("rejects missing fields", () => {
    for (const key of ["kind", "day", "ranked", "with_taste", "without_taste", "only_with_taste", "only_without_taste", "apart"]) {
      const body = raw();
      delete body[key];
      expect(parseLenses(body), key).toBeNull();
    }
    const missingOther = raw();
    delete (missingOther.with_taste as Record<string, unknown>[])[0].rank_without_taste;
    expect(parseLenses(missingOther)).toBeNull();
    const missingName = raw();
    delete (missingName.apart as Record<string, unknown>[])[0].b;
    expect(parseLenses(missingName)).toBeNull();
  });

  it("never throws", () => {
    for (const value of [null, undefined, 1, "lenses", [], { kind: "lenses" }, { kind: "moves" }]) {
      expect(() => parseLenses(value)).not.toThrow();
      expect(parseLenses(value)).toBeNull();
    }
    const hostile = {};
    Object.defineProperty(hostile, "kind", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
    });
    expect(parseLenses(hostile)).toBeNull();
  });
});

describe("rankWithoutTaste", () => {
  const lookup = rankWithoutTaste(parseLenses(raw())!);

  it("gives the draw-and-time rank in either act order", () => {
    expect(lookup("three", "four")).toBe(1);
    expect(lookup("four", "three")).toBe(1);
    expect(lookup("one", "two")).toBe(7);
    expect(lookup("seven", "eight")).toBe(2);
  });

  it("keeps the server's null and says nothing for a pair in neither list", () => {
    expect(lookup("five", "six")).toBeNull();
    expect(lookup("one", "nine")).toBeUndefined();
  });
});

describe("drawerRank", () => {
  it("is absent without lens data", () => {
    expect(drawerRank(null)).toBeUndefined();
  });

  it("passes only numbers to the drawer", () => {
    const rank = drawerRank(parseLenses(raw()))!;
    expect(rank("two", "one")).toBe(7);
    expect(rank("five", "six")).toBeUndefined();
    expect(rank("one", "nine")).toBeUndefined();
  });
});

describe("drawerRankOf", () => {
  it("is the draw-and-time denominator, absent without it", () => {
    expect(drawerRankOf(null)).toBeUndefined();
    expect(drawerRankOf(parseLenses(raw()))).toBeUndefined();
    expect(drawerRankOf(parseLenses({ ...raw(), priced_without_taste: 66 }))).toBe(66);
  });
});

describe("fetchLenses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the day and returns the parsed body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(raw()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const lenses = await fetchLenses("tiny fest", 0);
    expect(lenses.ranked).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith("/api/presets/tiny%20fest/lenses?day=0", expect.anything());
  });

  it("rejects on a 404 from a backend without the endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 })));
    await expect(fetchLenses("tiny", 0)).rejects.toBeInstanceOf(LensUnavailable);
  });

  it("rejects an unreadable body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ kind: "lenses" }), { status: 200 })));
    await expect(fetchLenses("tiny", 0)).rejects.toBeInstanceOf(LensUnavailable);
  });
});
