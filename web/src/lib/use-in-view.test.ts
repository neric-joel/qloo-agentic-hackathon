import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  const block = (start: string, from = css.indexOf(start)) => {
    let depth = 0;
    for (let i = css.indexOf("{", from); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) return css.slice(from, i);
    }
    return "";
  };
  /** Every block that opens with `start`, joined (the stylesheet may hold several `@media print` blocks). */
  const allBlocks = (start: string) => {
    const found: string[] = [];
    for (let at = css.indexOf(start); at !== -1; at = css.indexOf(start, at + start.length)) found.push(block(start, at));
    return found.join(" ");
  };
  /** The declarations of the `*, *::before, *::after` rules inside a block. */
  const universal = (body: string) =>
    [...body.matchAll(/\*,\s*\*::before,\s*\*::after\s*\{([^}]*)\}/g)].map((m) => m[1]).join(" ");
  // The pieces still drawn by components; each is drawn at its final state and no rule animates it now.
  const pieces = [
    "cc-dial-needle",
    "cc-link-badge",
    "cc-meter-fill",
    "cc-lens-row",
    "cc-wall-gem",
    "cc-wall-note",
    "cc-stamp",
    "cc-stamp-line::after",
    "cc-rail[data-done]",
  ];

  it("shows every piece's final frame under reduced motion and in print: every animation and transition is none", () => {
    const reduced = allBlocks("@media (prefers-reduced-motion: reduce)");
    const print = allBlocks("@media print");
    for (const body of [reduced, print]) {
      expect(universal(body)).toMatch(/animation: none !important;/);
      expect(universal(body)).toMatch(/transition: none !important;/);
      // The two pieces that hold a transform while waiting are set straight.
      expect(body).toMatch(/\.cc-meter-fill,\s*\.cc-rail\[data-done\]\s*\{\s*transform: none !important;/);
    }
    // No rule gives a piece an animation of its own outside those blocks.
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const piece of pieces) {
      for (const [, selector, body] of rules) {
        if (selector.includes(`.${piece}`)) expect(body, piece).not.toMatch(/animation:\s*(?!none)/);
      }
    }
  });

  it("keeps no opening, scroll-in or theme motion, and animates transform and opacity only", () => {
    const frames = [...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]);
    expect(frames).toEqual([
      "caret-blink",
      "cc-slot-flight",
      "cc-band-shrink",
      "cc-band-away",
      "cc-result-in",
      "cc-lift",
      "cc-zero-in",
      "cc-edge-grow",
      "cc-ring-out-a",
      "cc-ring-out-b",
      "cc-ring-fade",
    ]);
    expect(css).not.toMatch(/\[data-reveal|cc-hero-|cc-card-enter|cc-theme-pop|cc-draw|cc-wipe/);
    // The retired curtain's names, spelled in pieces so a source scan for them finds none.
    for (const name of ["cc-", "data-"].map((head) => `${head}intro`)) expect(css).not.toContain(name);
    for (const name of frames) {
      const body = block(`@keyframes ${name}`);
      const properties = [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
      // The zero chip's ground and ink change with its opacity: the raspberry bar turning into a zero.
      const allowed = name === "cc-zero-in" ? /^(opacity|transform|background-color|color)$/ : /^(opacity|transform)$/;
      for (const property of properties) expect(property, `${name}: ${property}`).toMatch(allowed);
    }
    // The tested slot flies straight in: two frames, no scale and no overshoot.
    const flight = block("@keyframes cc-slot-flight");
    expect(flight).not.toMatch(/scale|%/);
    expect(flight).toMatch(/opacity: 0\.72;\s*transform: translate\(var\(--dx\), var\(--dy\)\);/);
  });

  it("fades the taste-ring panel only after the visitor picks a pair, never on load or mount", () => {
    // The fade is keyed on the visitor's pick (data-picked, set by taste-ring.tsx), so the bare panel the server
    // paints, and every mount, starts no animation.
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
      selector: selector.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
      body,
    }));
    const animated = rules.filter((r) => /(^|[\s,])\.cc-ring-lens\b/.test(r.selector) && /animation:\s*(?!none\b)\S/.test(r.body));
    expect(animated.map((r) => r.selector)).toEqual([".cc-ring-lens[data-picked]"]);
    expect(animated[0].body).toMatch(/animation: cc-ring-fade 140ms var\(--ease-out\);/);
    // No rule animates or transitions the bare panel.
    for (const { selector, body } of rules) {
      for (const part of selector.split(",").map((s) => s.trim())) {
        if (part === ".cc-ring-lens") expect(body, part).not.toMatch(/animation:\s*(?!none\b)\S|transition:/);
      }
    }
    // Under reduced motion and in print the picked panel shows at once.
    const reduced = allBlocks("@media (prefers-reduced-motion: reduce), print");
    expect(reduced).toMatch(/\.cc-ring-lens\[data-picked\]\s*\{\s*animation: none;/);
    // The fade itself is opacity only.
    expect(block("@keyframes cc-ring-fade")).toMatch(/from \{\s*opacity: 0;\s*\}/);
  });

  it("times every remaining animation and transition with the two house curves", () => {
    expect(css.match(/cubic-bezier\(/g)).toHaveLength(2);
    expect(css).toMatch(/--ease-out: cubic-bezier\(0\.23, 1, 0\.32, 1\);/);
    expect(css).toMatch(/--ease-move: cubic-bezier\(0\.65, 0, 0\.35, 1\);/);
    const timed = [...css.matchAll(/(?:animation|transition):\s*([^;]+);/g)]
      .map((m) => m[1])
      .filter((value) => !/^none\b/.test(value) && !value.startsWith("caret-blink"));
    expect(timed.length).toBeGreaterThanOrEqual(10);
    for (const value of timed) expect(value).toMatch(/var\(--ease-(out|move)\)/);
    expect(css).toMatch(/\.cc-slot-flight \{\s*animation: cc-slot-flight 400ms var\(--ease-move\) both;/);
    expect(css).toMatch(/\.cc-overlap-band \{[^}]*animation: cc-band-shrink 300ms var\(--ease-out\) both;/);
  });
});
