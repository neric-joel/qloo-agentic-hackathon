import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INTRO_FALLBACK_MS, INTRO_LINE, INTRO_MARKS, INTRO_TIMELINE, INTRO_WORDS, IntroReveal } from "./intro-reveal";

vi.mock("next/font/google", () => ({
  Archivo: () => ({ variable: "font-archivo" }),
  JetBrains_Mono: () => ({ variable: "font-mono" }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The root layout's server HTML, with the day list unreadable (it does not matter here). */
async function layoutHtml(): Promise<string> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
  const { default: RootLayout } = await import("@/app/layout");
  const tree = await RootLayout({ children: createElement("p", null, "Page") } as never);
  return renderToStaticMarkup(tree);
}

/** The head script that arms the intro, as the layout prints it. */
async function introScript(): Promise<string> {
  const scripts = [...(await layoutHtml()).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const script = scripts.find((body) => body.includes("cc.intro.v2"));
  expect(script).toBeDefined();
  return script ?? "";
}

type Visit = { path?: string; hash?: string; seen?: boolean; reduce?: boolean; storageFails?: boolean };

type StandInEvent = {
  type: string;
  target?: unknown;
  key?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  prevented: boolean;
  stopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

/** A stand-in event: records whether the script held it back. */
function event(type: string, init: { target?: unknown; key?: string; ctrlKey?: boolean } = {}): StandInEvent {
  const e: StandInEvent = {
    type,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    prevented: false,
    stopped: false,
    ...init,
    preventDefault: () => {
      e.prevented = true;
    },
    stopPropagation: () => {
      e.stopped = true;
    },
  };
  return e;
}

/** A stand-in DOM node: only `contains`, which is all the script asks of one. */
class StandInNode {
  constructor(readonly parent: StandInNode | null = null) {}
  contains(other: StandInNode): boolean {
    for (let at: StandInNode | null = other; at; at = at.parent) if (at === this) return true;
    return false;
  }
}

/** Runs the head script in a stand-in browser and reports what it left behind. */
async function run({ path = "/", hash = "", seen = false, reduce = false, storageFails = false }: Visit) {
  const store = new Map<string, string>(seen ? [["cc.intro.v2", "1"]] : []);
  const attributes = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => {
      if (storageFails) throw new Error("blocked");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (storageFails) throw new Error("blocked");
      store.set(key, value);
    },
  };
  const matchMedia = () => ({ matches: reduce });
  const listeners = new Map<string, { handler: (e: StandInEvent) => void; capture: boolean }>();
  const dispatched: string[] = [];
  const window = {
    sessionStorage,
    matchMedia,
    addEventListener: (type: string, handler: (e: StandInEvent) => void, options: boolean | { capture?: boolean }) => {
      const capture = options === true || (typeof options === "object" && options.capture === true);
      listeners.set(type, { handler, capture });
    },
    removeEventListener: (type: string, handler: unknown) => {
      if (listeners.get(type)?.handler === handler) listeners.delete(type);
    },
    dispatchEvent: (e: { type: string }) => dispatched.push(e.type),
  };
  const location = { pathname: path, hash };
  // The curtain (with a part inside it) and one control under it; `hidden` stands for the curtain's
  // own CSS end.
  const body = new StandInNode();
  const overlay = new StandInNode(body);
  const targets = { overlay, overlayPart: new StandInNode(overlay), control: new StandInNode(body) };
  const curtain = { hidden: false };
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      getAttribute: (name: string) => attributes.get(name) ?? null,
    },
    querySelector: (selector: string) => (selector === ".cc-intro" ? overlay : null),
  };
  const getComputedStyle = () => ({ visibility: curtain.hidden ? "hidden" : "visible" });
  class Event {
    constructor(readonly type: string) {}
  }
  const args = { window, location, document, matchMedia, getComputedStyle, Node: StandInNode, Event };
  new Function(...Object.keys(args), await introScript())(...Object.values(args));
  /** Fires one event at the window's listener for it, as the browser does first, in the capture phase. */
  const fire = (e: StandInEvent) => {
    listeners.get(e.type)?.handler(e);
    return e;
  };
  return {
    intro: attributes.get("data-intro") ?? null,
    key: store.get("cc.intro.v2") ?? null,
    state: () => attributes.get("data-intro") ?? null,
    listeners,
    dispatched,
    fire,
    curtain,
    targets,
  };
}

describe("the head script", () => {
  it("arms the intro on a first visit to the home page, and writes the key so it never replays", async () => {
    const { intro, key } = await run({});
    expect({ intro, key }).toEqual({ intro: "play", key: "1" });
  });

  it("leaves it off on any other first page, a deep link, a second page, or under reduced motion", async () => {
    for (const visit of [{ path: "/method" }, { hash: "#agent" }, { seen: true }, { reduce: true }]) {
      const { intro, key, listeners } = await run(visit);
      expect({ intro, key }).toEqual({ intro: null, key: "1" });
      // Nothing listens on a page without the curtain.
      expect(listeners.size).toBe(0);
    }
  });

  it("skips it when session storage cannot be used", async () => {
    const { intro, key } = await run({ storageFails: true });
    expect({ intro, key }).toEqual({ intro: null, key: null });
  });
});

describe("a tap on the curtain, from before the page hydrates", () => {
  it("listens in the capture phase from the head, so nothing under the curtain hears the press first", async () => {
    const { listeners } = await run({});
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "pointercancel", "keydown", "wheel"]) {
      expect(listeners.get(type)?.capture, type).toBe(true);
    }
  });

  it("holds back the press and lifts the curtain on its click, without the click reaching the page", async () => {
    const { fire, state, dispatched, targets, listeners } = await run({});
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      const press = fire(event(type, { target: targets.overlayPart }));
      expect(press.prevented && press.stopped, type).toBe(true);
      expect(state()).toBe("play");
    }
    const click = fire(event("click", { target: targets.overlay }));
    expect(click.prevented && click.stopped).toBe(true);
    expect(state()).toBe("done");
    expect(dispatched).toEqual(["cc:intro-done"]);
    // Done once: it stops listening.
    expect(listeners.size).toBe(0);
  });

  it("lifts on a cancelled press (a swipe), a wheel or any key", async () => {
    for (const type of ["pointercancel", "wheel", "keydown"]) {
      const visit = await run({});
      visit.fire(event(type, { target: visit.targets.overlay, key: "Shift" }));
      expect(visit.state(), type).toBe("done");
      expect(visit.dispatched).toEqual(["cc:intro-done"]);
    }
  });

  it("holds back keys that would activate, move focus or scroll, and lets shortcuts through", async () => {
    for (const key of ["Enter", " ", "Tab", "ArrowDown", "PageDown", "End"]) {
      const visit = await run({});
      expect(visit.fire(event("keydown", { key })).prevented, key).toBe(true);
      expect(visit.state()).toBe("done");
    }
    for (const init of [{ key: "r", ctrlKey: true }, { key: "Shift" }]) {
      const visit = await run({});
      expect(visit.fire(event("keydown", init)).prevented, init.key).toBe(false);
      expect(visit.state()).toBe("done");
    }
  });

  it("leaves the page alone outside the curtain, and once the curtain has gone", async () => {
    const visit = await run({});
    const outside = visit.fire(event("click", { target: visit.targets.control }));
    expect(outside.prevented || outside.stopped).toBe(false);
    expect(visit.state()).toBe("play");
    // Its own CSS end hides it: from then on nothing is held back, even if no script runs after the head.
    visit.curtain.hidden = true;
    for (const e of [event("click", { target: visit.targets.overlay }), event("keydown", { key: "Enter" })]) {
      const fired = visit.fire(e);
      expect(fired.prevented || fired.stopped, e.type).toBe(false);
    }
    expect(visit.state()).toBe("play");
  });
});

describe("the overlay", () => {
  it("is the first child of the body", async () => {
    const html = await layoutHtml();
    expect(html).toMatch(/<body[^>]*><div class="cc-intro" aria-hidden="true">/);
  });

  it("keeps its words out of the page's text, hidden from assistive technology", () => {
    const html = renderToStaticMarkup(createElement(IntroReveal));
    expect(html).toContain('aria-hidden="true"');
    // The words are generated content (`content: attr(...)`), so the DOM has no text nodes to read.
    expect(html.replace(/<[^>]+>/g, "").trim()).toBe("");
    expect(html).not.toMatch(/<text|<title|<img/);
    for (const { word } of INTRO_WORDS) expect(html).toContain(`data-w="${word}"`);
    expect(html).toContain(`data-a="${INTRO_LINE[0]}"`);
    expect(html).toContain(`data-b="${INTRO_LINE[1]}"`);
    expect(html).toContain(`data-t="${INTRO_MARKS.name}"`);
    expect(html).toContain(`data-t="${INTRO_MARKS.skip}"`);
    expect(html).toContain(`data-touch="${INTRO_MARKS.skipTouch}"`);
    for (const part of ["cc-intro-dot", "cc-if-text", "cc-if-l", "cc-if-r", "cc-if-rule", "cc-intro-progress", "cc-ie-line"]) {
      expect(html).toContain(part);
    }
  });

  it("says nothing that could be read as data: no figures", () => {
    for (const text of [...INTRO_WORDS.map(({ word }) => word), ...INTRO_LINE, ...Object.values(INTRO_MARKS)]) {
      expect(text).not.toMatch(/\d/);
    }
  });

  it("rolls the words back to back, each held long enough to read, before the line draws", () => {
    INTRO_WORDS.forEach(({ from, to }, i) => {
      expect(to - from).toBeGreaterThanOrEqual(450);
      if (i > 0) expect(from).toBe(INTRO_WORDS[i - 1].to);
    });
    const html = renderToStaticMarkup(createElement(IntroReveal));
    for (const { from, to } of INTRO_WORDS) expect(html).toContain(`--d:${from}ms;--t:${to - from}ms`);
    expect(INTRO_WORDS[INTRO_WORDS.length - 1].to).toBeLessThanOrEqual(INTRO_TIMELINE.line + 40);
  });
});

describe("the intro's CSS", () => {
  const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
  const block = (start: string) => {
    const from = css.indexOf(start);
    let depth = 0;
    for (let i = css.indexOf("{", from); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) return css.slice(from, i);
    }
    return "";
  };

  it("shows nothing unless the head script armed it, and nothing in print or under reduced motion", () => {
    expect(block(".cc-intro {")).toMatch(/display:\s*none/);
    for (const media of ["@media print", "@media (prefers-reduced-motion: reduce)"]) {
      expect(block(media)).toMatch(/\.cc-intro\s*\{\s*display:\s*none !important;/);
    }
    const playing = block('html[data-intro="play"] .cc-intro {');
    expect(playing).toMatch(/position:\s*fixed/);
  });

  it("takes every pointer event while it shows and none once it has lifted", () => {
    expect(block('html[data-intro="play"] .cc-intro {')).toMatch(/pointer-events:\s*auto/);
    const lift = block("@keyframes cc-intro-lift");
    const end = lift.slice(lift.indexOf("to {"));
    expect(end).toMatch(/visibility:\s*hidden/);
    expect(end).toMatch(/pointer-events:\s*none/);
    // Held to the very end of the lift, not dropped halfway through it (it is a discrete property).
    expect(lift).toMatch(/99%\s*\{\s*pointer-events:\s*auto;/);
  });

  it("draws the line, opens the question, holds it, lifts at 3.25 s and ends hidden by 3.85 s, with no script", () => {
    const playing = block('html[data-intro="play"] .cc-intro {');
    const [, duration, delay] = playing.match(/cc-intro-lift (\d+)ms [^;]*? (\d+)ms both/) ?? [];
    expect(Number(delay)).toBe(INTRO_TIMELINE.lift);
    expect(Number(delay) + Number(duration)).toBe(INTRO_TIMELINE.end);
    expect(INTRO_TIMELINE.end).toBeLessThanOrEqual(4000);
    expect(INTRO_FALLBACK_MS).toBeGreaterThan(INTRO_TIMELINE.end);
    expect(INTRO_FALLBACK_MS).toBeLessThanOrEqual(4500);
    expect(block("@keyframes cc-intro-lift")).toMatch(/visibility:\s*hidden/);
    expect(block(".cc-if-edges {")).toMatch(new RegExp(`cc-i-draw \\d+ms [^;]*? ${INTRO_TIMELINE.line}ms both`));
    const open = block(".cc-if-text {").match(new RegExp(`cc-i-open (\\d+)ms [^;]*? ${INTRO_TIMELINE.open}ms both`));
    expect(open).not.toBeNull();
    // The question is fully open and readable for at least a quarter second before the sheet lifts.
    expect(INTRO_TIMELINE.lift - (INTRO_TIMELINE.open + Number(open?.[1]))).toBeGreaterThanOrEqual(250);
    expect(block(".cc-if-rule {")).toMatch(new RegExp(`cc-i-swipe \\d+ms [^;]*? ${INTRO_TIMELINE.rule}ms both`));
    // The progress rule runs until the lift, then hands over to the curved edge.
    expect(block(".cc-intro-progress {")).toMatch(new RegExp(`cc-i-grow ${INTRO_TIMELINE.lift}ms`));
    // The curved edge flattens while the sheet lifts and is flat by the time it has gone.
    const [, bendFor, bendAt] = block(".cc-ie-bend {").match(/cc-intro-flatten (\d+)ms [^;]*? (\d+)ms both/) ?? [];
    expect(Number(bendAt)).toBeGreaterThanOrEqual(INTRO_TIMELINE.lift);
    expect(Number(bendAt) + Number(bendFor)).toBe(INTRO_TIMELINE.end);
  });

  it("is the same cool ink-blue sheet in both themes, with a vermilion line on its curved edge", () => {
    const playing = block('html[data-intro="play"] .cc-intro {');
    expect(playing).toMatch(/background:\s*var\(--ci-bg\)/);
    expect(playing).toMatch(/--ci-bg:\s*oklch\(/);
    expect(playing).not.toMatch(/var\(--background\)/);
    expect(block(".cc-ie-line {")).toMatch(/stroke:\s*var\(--ci-accent\)/);
    expect(block(".cc-ie-line {")).toMatch(/stroke-width:\s*2px/);
    expect(block(".cc-ie-line {")).toMatch(/vector-effect:\s*non-scaling-stroke/);
  });

  it("raises the page under it into place as the curtain lifts, by transform only, ending with it", () => {
    const rise = block('html[data-intro="play"] #main {');
    const [, duration, delay] = rise.match(/cc-intro-rise (\d+)ms [^;]*? (\d+)ms backwards/) ?? [];
    expect(Number(delay)).toBe(INTRO_TIMELINE.lift);
    expect(Number(delay) + Number(duration)).toBeLessThanOrEqual(INTRO_TIMELINE.end);
    expect(block("@keyframes cc-intro-rise")).not.toMatch(/opacity/);
  });

  it("moves only transform, opacity and clip-path (and the sheet's final visibility and pointer events)", () => {
    const frames = [...css.matchAll(/@keyframes (cc-(?:intro|i)-[\w-]*)/g)].map((m) => m[1]);
    expect(frames.length).toBeGreaterThanOrEqual(10);
    for (const name of frames) {
      const properties = [...block(`@keyframes ${name}`).matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
      const allowed = name === "cc-intro-lift" ? /^(transform|visibility|pointer-events)$/ : /^(opacity|transform|clip-path)$/;
      for (const property of properties) expect(property, `${name}: ${property}`).toMatch(allowed);
    }
  });
});
