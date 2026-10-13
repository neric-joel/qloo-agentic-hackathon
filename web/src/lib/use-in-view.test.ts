import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RevealPhase } from "./use-in-view";

type Entry = {
  target: Element;
  isIntersecting: boolean;
  intersectionRect: { height: number };
  boundingClientRect: { height: number };
  rootBounds: { height: number } | null;
};

/** A stand-in IntersectionObserver: the test says what each observer sees. */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(
    readonly callback: (entries: Entry[]) => void,
    readonly options: { rootMargin?: string; threshold?: number | number[] } = {},
  ) {
    FakeObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  get isNear() {
    return Boolean(this.options.rootMargin);
  }
}

function entry(target: Element, visible: number, own = 100, viewport = 800): Entry {
  return {
    target,
    isIntersecting: visible > 0,
    intersectionRect: { height: visible },
    boundingClientRect: { height: own },
    rootBounds: { height: viewport },
  };
}

/** Delivers one observation to whichever observer (the near one or the in-view one) watches the target. */
function see(kind: "near" | "seen", target: Element, visible: number, own = 100) {
  for (const observer of FakeObserver.all) {
    if (observer.isNear === (kind === "near") && observer.targets.has(target)) {
      observer.callback([entry(target, visible, own)]);
    }
  }
}

function element(): Element {
  return {} as Element;
}

async function load(reduce = false) {
  vi.resetModules();
  FakeObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("window", {
    innerHeight: 800,
    matchMedia: () => ({ matches: reduce }),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  });
  return import("./use-in-view");
}

describe("isShown", () => {
  it("measures the element's height, or the viewport's for a tall element", async () => {
    const { isShown } = await load();
    const target = element();
    expect(isShown(entry(target, 0), 0.35)).toBe(false);
    expect(isShown(entry(target, 34), 0.35)).toBe(false);
    expect(isShown(entry(target, 35), 0.35)).toBe(true);
    // A board three viewports tall can never show 35% of itself, but filling 35% of the screen counts.
    expect(isShown(entry(target, 280, 2400), 0.35)).toBe(true);
    expect(isShown(entry(target, 200, 2400), 0.35)).toBe(false);
  });
});

describe("motionAllowed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is false under reduced motion and without IntersectionObserver", async () => {
    expect((await load(true)).motionAllowed()).toBe(false);
    expect((await load(false)).motionAllowed()).toBe(true);
    const loaded = await load(false);
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(loaded.motionAllowed()).toBe(false);
  });
});

describe("watchReveal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("holds the start frame while near, then plays once when shown", async () => {
    const { watchReveal } = await load();
    const target = element();
    const phases: RevealPhase[] = [];
    watchReveal(target, { threshold: 0.5, onPhase: (phase) => phases.push(phase) });
    see("seen", target, 0);
    see("near", target, 100);
    expect(phases).toEqual(["wait"]);
    see("seen", target, 30);
    expect(phases).toEqual(["wait"]);
    see("seen", target, 60);
    see("seen", target, 100);
    expect(phases).toEqual(["wait", "play"]);
  });

  it("stays still when the element is already on screen at load", async () => {
    const { watchReveal } = await load();
    const target = element();
    const phases: RevealPhase[] = [];
    watchReveal(target, { onPhase: (phase) => phases.push(phase) });
    see("near", target, 100);
    see("seen", target, 10);
    see("seen", target, 100);
    expect(phases).toEqual(["still"]);
  });

  it("gives up on the start frame after the fallback, so nothing stays hidden", async () => {
    const { watchReveal } = await load();
    const target = element();
    const phases: RevealPhase[] = [];
    watchReveal(target, { fallbackMs: 1500, onPhase: (phase) => phases.push(phase) });
    see("seen", target, 0);
    see("near", target, 100);
    vi.advanceTimersByTime(1499);
    expect(phases).toEqual(["wait"]);
    vi.advanceTimersByTime(1);
    expect(phases).toEqual(["wait", "still"]);
    see("seen", target, 100);
    expect(phases).toEqual(["wait", "still"]);
  });

  it("numbers the pieces that start in the same frame, for the stagger", async () => {
    const { watchReveal } = await load();
    const targets = [element(), element(), element()];
    const orders: number[] = [];
    for (const target of targets) {
      watchReveal(target, { onPhase: (phase, order) => phase === "play" && orders.push(order) });
      see("seen", target, 0);
    }
    const seen = FakeObserver.all.find((observer) => !observer.isNear && observer.targets.size === 3);
    seen?.callback(targets.map((target) => entry(target, 100)));
    expect(orders).toEqual([0, 1, 2]);
  });

  it("shares one pair of observers across every piece with the same threshold", async () => {
    const { watchReveal } = await load();
    for (let i = 0; i < 5; i++) watchReveal(element(), { threshold: 0.5, onPhase: () => {} });
    expect(FakeObserver.all).toHaveLength(2);
  });

  it("does nothing under reduced motion", async () => {
    const { watchReveal } = await load(true);
    const phases: RevealPhase[] = [];
    watchReveal(element(), { onPhase: (phase) => phases.push(phase) });
    expect(FakeObserver.all).toHaveLength(0);
    expect(phases).toEqual([]);
  });

  it("stops reporting after cleanup", async () => {
    const { watchReveal } = await load();
    const target = element();
    const phases: RevealPhase[] = [];
    const stop = watchReveal(target, { onPhase: (phase) => phases.push(phase) });
    see("seen", target, 0);
    stop();
    see("near", target, 100);
    see("seen", target, 100);
    expect(phases).toEqual([]);
  });
});

describe("the motion classes in globals.css", () => {
  const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
  const block = (start: string) => {
    const from = css.indexOf(start);
    let depth = 0;
    for (let i = css.indexOf("{", from); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) return css.slice(from, i);
    }
    return "";
  };
  const pieces = [
    "cc-hero-slot",
    "cc-hero-band",
    "cc-hero-mark",
    "cc-dial-needle",
    "cc-dial-gap",
    "cc-link-draw",
    "cc-link-wipe",
    "cc-link-badge",
    "cc-meter-fill",
    "cc-lens-row",
    "cc-wall-gem",
    "cc-wall-note",
    "cc-stamp",
    "cc-stamp-line::after",
    "cc-rail[data-done]",
  ];

  it("shows every piece's final frame under reduced motion and in print", () => {
    const reduced = block("@media (prefers-reduced-motion: reduce)");
    const print = block("@media print");
    for (const piece of pieces) {
      expect(reduced, piece).toContain(`.${piece}`);
      expect(print, piece).toContain(`.${piece}`);
    }
  });

  it("animates transform, opacity, dash offset and the highlight sweep only", () => {
    const frames = [
      ...css.matchAll(/@keyframes (cc-(?:hero|draw|wipe|dial|badge|meter|rise|edge|perf|gem|note|stamp|underline|node)[\w-]*)/g),
    ].map((m) => m[1]);
    // 11 since cc-perf-wipe (the hidden-clash ticket perforation) was deleted in round 22.
    expect(frames.length).toBeGreaterThanOrEqual(11);
    const allowed = /^(opacity|transform|stroke-dasharray|stroke-dashoffset|clip-path|background-size|animation-timing-function)$/;
    for (const name of frames) {
      const body = block(`@keyframes ${name}`);
      const properties = [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
      for (const property of properties) expect(property, `${name}: ${property}`).toMatch(allowed);
    }
  });
});

describe("useIntroDone", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is true in the server HTML, so nothing there waits on the intro", async () => {
    const { useIntroDone } = await load();
    function Probe() {
      return createElement("p", null, String(useIntroDone()));
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>true</p>");
  });
});
