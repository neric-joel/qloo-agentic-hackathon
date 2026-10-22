import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lenses } from "@/lib/lenses";

import { LENS_RETRY_MS, useLenses } from "./use-lenses";

/**
 * A one-component stand-in for React's renderer, enough for `useLenses`: its state persists from one render to the
 * next, and its effect runs when its dependencies change, after the previous effect's cleanup, as React runs them.
 * Unmounting runs the last cleanup.
 */
const shim = vi.hoisted(() => ({
  hasState: false,
  state: undefined as unknown,
  deps: undefined as readonly unknown[] | undefined,
  cleanup: undefined as void | (() => void),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => {
    if (!shim.hasState) {
      shim.state = initial;
      shim.hasState = true;
    }
    return [shim.state, (next: unknown) => (shim.state = next)];
  },
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    if (shim.deps && deps.length === shim.deps.length && deps.every((dep, i) => Object.is(dep, shim.deps?.[i]))) return;
    if (typeof shim.cleanup === "function") shim.cleanup();
    shim.deps = deps;
    shim.cleanup = effect();
  },
}));

// Every name, id and count below is invented for the test. No request leaves the test: fetch is a mock.

/** A lens answer for one day: one pair ranked with taste, so the section can print its specific heading. */
function lensBody(day: number) {
  return {
    kind: "lenses",
    day,
    ranked: 1,
    with_taste: [{ a: "Act A", b: "Act B", a_id: "a", b_id: "b", rank: 1, rank_without_taste: 4 }],
    without_taste: [{ a: "Act C", b: "Act D", a_id: "c", b_id: "d", rank: 1, rank_with_taste: 6 }],
    only_with_taste: 1,
    only_without_taste: 1,
    apart: [],
  };
}

/** What the mock server answers, in order: "ok" is the day's lens data, "fail" a 503. */
type Answer = "ok" | "fail";

/** Stubs fetch with the given answers, in order, and returns the mock so its calls can be counted. */
function serve(...answers: Answer[]) {
  const queue = [...answers];
  const fetch = vi.fn(async (url: string) => {
    const day = Number(new URL(url, "http://test.invalid").searchParams.get("day"));
    const answer = queue.shift() ?? "fail";
    // Only what fetchLenses reads: ok, status and the body.
    return {
      ok: answer === "ok",
      status: answer === "ok" ? 200 : 503,
      json: async () => (answer === "ok" ? lensBody(day) : {}),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/**
 * The section that reads the hook, rendered for a preset and day as the home page renders it. What it gets decides
 * its heading: null keeps the generic heading, lens data gives the specific one.
 */
const Section = (day: number, presetId = "test-fest-sun"): Lenses | null => useLenses(presetId, day);

/** Lets the mock's promises settle and moves the clock on by `ms`. */
const wait = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  shim.hasState = false;
  shim.state = undefined;
  shim.deps = undefined;
  shim.cleanup = undefined;
});

afterEach(() => {
  if (typeof shim.cleanup === "function") shim.cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useLenses: the lens request, tried up to three times", () => {
  it("waits 1.5 s after the first failure and 4 s after the second, three tries in all", () => {
    expect(LENS_RETRY_MS).toEqual([1500, 4000]);
  });

  it("returns the day's lens data from the first try, with one request and nothing pending", async () => {
    const fetch = serve("ok");
    expect(Section(0)).toBeNull();
    await wait();
    expect(Section(0)).toEqual(expect.objectContaining({ day: 0, ranked: 1 }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/presets/test-fest-sun/lenses?day=0");
    await wait(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the generic heading (null) while a failed request waits, then shows the specific one when the retry succeeds", async () => {
    const fetch = serve("fail", "ok");
    Section(0);
    await wait();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Section(0)).toBeNull();
    // Not before 1.5 s.
    await wait(1499);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Section(0)).toBeNull();
    await wait(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Section(0)).toEqual(expect.objectContaining({ day: 0, with_taste: [expect.objectContaining({ a: "Act A", b: "Act B" })] }));
    await wait(10_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the generic heading (null) after three failures, and sends no fourth request", async () => {
    const fetch = serve("fail", "fail", "fail", "ok");
    Section(0);
    await wait();
    expect(fetch).toHaveBeenCalledTimes(1);
    await wait(1500);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Section(0)).toBeNull();
    // The third try waits 4 s after the second failure.
    await wait(3999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await wait(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(Section(0)).toBeNull();
    await wait(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(Section(0)).toBeNull();
  });

  it("cancels a pending retry when the day changes, and answers for the new day only", async () => {
    const fetch = serve("fail", "ok");
    Section(0);
    await wait();
    expect(fetch).toHaveBeenCalledTimes(1);
    // The visitor switches day while day 0's retry waits.
    expect(Section(1)).toBeNull();
    await wait();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("/api/presets/test-fest-sun/lenses?day=1");
    expect(Section(1)).toEqual(expect.objectContaining({ day: 1 }));
    // Day 0's retry never runs.
    await wait(10_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("day=0"))).toHaveLength(1);
    expect(Section(1)).toEqual(expect.objectContaining({ day: 1 }));
  });

  it("cancels a pending retry when the page goes away", async () => {
    const fetch = serve("fail", "ok");
    Section(0);
    await wait();
    expect(fetch).toHaveBeenCalledTimes(1);
    if (typeof shim.cleanup === "function") shim.cleanup();
    shim.cleanup = undefined;
    await wait(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
