import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INTRO_FALLBACK_MS,
  INTRO_LINE,
  INTRO_MARKS,
  INTRO_ONCE_SCRIPT,
  INTRO_SEEN_KEY,
  INTRO_TIMELINE,
  INTRO_TIMING_CSS,
  INTRO_WORDS,
  IntroReveal,
} from "./intro-reveal";

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

type Visit = {
  path?: string;
  hash?: string;
  seen?: boolean;
  reduce?: boolean;
  storageFails?: boolean;
  /** This visitor saw the curtain on an earlier visit (localStorage). */
  seenBefore?: boolean;
  localFails?: boolean;
};

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
async function run({
  path = "/",
  hash = "",
  seen = false,
  reduce = false,
  storageFails = false,
  seenBefore = false,
  localFails = false,
}: Visit) {
  const store = new Map<string, string>(seen ? [["cc.intro.v2", "1"]] : []);
  const local = new Map<string, string>(seenBefore ? [[INTRO_SEEN_KEY, "1"]] : []);
  const localStorage = {
    getItem: (key: string) => {
      if (localFails) throw new Error("blocked");
      return local.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (localFails) throw new Error("blocked");
      local.set(key, value);
    },
  };
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
    localStorage,
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
      removeAttribute: (name: string) => attributes.delete(name),
    },
    querySelector: (selector: string) => (selector === ".cc-intro" ? overlay : null),
  };
  const getComputedStyle = () => ({ visibility: curtain.hidden ? "hidden" : "visible" });
  class Event {
    constructor(readonly type: string) {}
  }
  const args = { window, location, document, matchMedia, getComputedStyle, Node: StandInNode, Event };
  new Function(...Object.keys(args), await introScript())(...Object.values(args));
  // Then the overlay's own script, as the parser reaches it at the top of the body.
  new Function(...Object.keys(args), INTRO_ONCE_SCRIPT)(...Object.values(args));
  /** Fires one event at the window's listener for it, as the browser does first, in the capture phase. */
  const fire = (e: StandInEvent) => {
    listeners.get(e.type)?.handler(e);
    return e;
  };
  return {
    intro: attributes.get("data-intro") ?? null,
    key: store.get("cc.intro.v2") ?? null,
    seenKey: local.get(INTRO_SEEN_KEY) ?? null,
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

describe("once per visitor", () => {
  it("remembers a first showing in localStorage", async () => {
    const { intro, key, seenKey } = await run({});
    expect({ intro, key, seenKey }).toEqual({ intro: "play", key: "1", seenKey: "1" });
  });

  it("does not play again for a visitor who has seen it, in a new tab or on a later visit", async () => {
    const { intro, key, seenKey } = await run({ seenBefore: true });
    expect({ intro, key, seenKey }).toEqual({ intro: null, key: "1", seenKey: "1" });
  });

  it("still honours the tab's own key first, and remembers nothing when the curtain did not play", async () => {
    for (const visit of [{ seen: true }, { path: "/method" }, { reduce: true }, { hash: "#agent" }]) {
      const { intro, seenKey } = await run(visit);
      expect({ intro, seenKey }).toEqual({ intro: null, seenKey: null });
    }
  });

  it("leaves the tab's decision alone when localStorage cannot be used", async () => {
    const { intro, key } = await run({ localFails: true });
    expect({ intro, key }).toEqual({ intro: "play", key: "1" });
  });

  it("runs as the overlay is parsed, after the head script and before anything else in the body", async () => {
    const html = await layoutHtml();
    expect(html.indexOf("cc.intro.v2")).toBeLessThan(html.indexOf(INTRO_SEEN_KEY));
    expect(html).toMatch(/<body[^>]*><div class="cc-intro" aria-hidden="true"><script>/);
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
    // The words are generated content (`content: attr(...)`), so the DOM has no text nodes to read (the
    // overlay's own script and style are not text).
    const visible = html.replace(/<script>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, "");
    expect(visible.replace(/<[^>]+>/g, "").trim()).toBe("");
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

  it("asks the home page's own question", () => {
    expect(INTRO_LINE.join(" ")).toBe("Which clash is worth moving?");
  });

  it("rolls the words back to back, each held long enough to read, before the line draws", () => {
    INTRO_WORDS.forEach(({ from, to }, i) => {
      expect(to - from).toBeGreaterThanOrEqual(200);
      if (i > 0) expect(from).toBe(INTRO_WORDS[i - 1].to);
    });
    const html = renderToStaticMarkup(createElement(IntroReveal));
    for (const { word, from, to } of INTRO_WORDS) {
      // Each word's motion (`--t`) runs past its window by the time it takes to leave as the next arrives.
      const [, duration] = html.match(new RegExp(`--d:${from}ms;--t:(\\d+)ms`)) ?? [];
      expect(Number(duration), word).toBeGreaterThanOrEqual(to - from);
    }
    expect(INTRO_WORDS[INTRO_WORDS.length - 1].to).toBeLessThanOrEqual(INTRO_TIMELINE.line + 40);
  });
});

describe("the intro's CSS", () => {
  const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
  const block = (start: string, from = css.indexOf(start)) => {
    let depth = 0;
    for (let i = css.indexOf("{", from); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) return css.slice(from, i);
    }
    return "";
  };
  /** Every block that opens with `start` (a stylesheet may hold several `@media print` blocks). */
  const blocks = (start: string) => {
    const found: string[] = [];
    for (let at = css.indexOf(start); at !== -1; at = css.indexOf(start, at + start.length)) found.push(block(start, at));
    return found;
  };

  it("shows nothing unless the head script armed it, and nothing in print or under reduced motion", () => {
    expect(block(".cc-intro {")).toMatch(/display:\s*none/);
    for (const media of ["@media print", "@media (prefers-reduced-motion: reduce)"]) {
      expect(blocks(media).some((body) => /\.cc-intro\s*\{\s*display:\s*none !important;/.test(body)), media).toBe(true);
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

  it("draws every piece the overlay's clock sets, and ends hidden with no script", () => {
    expect(block("@keyframes cc-intro-lift")).toMatch(/visibility:\s*hidden/);
    for (const part of [
      'html[data-intro="play"] .cc-intro {',
      ".cc-intro-stage {",
      ".cc-intro-dot {",
      ".cc-iw {",
      ".cc-iw-last::before {",
      ".cc-if-text {",
      ".cc-if-edges {",
      ".cc-if-rule {",
      ".cc-intro-progress {",
      ".cc-ie-bend {",
      'html[data-intro="play"] #main {',
    ]) {
      expect(block(part), part).toMatch(/animation/);
    }
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

  it("raises the page under it into place as the curtain lifts, by transform only (the clock below times it)", () => {
    expect(block('html[data-intro="play"] #main {')).toMatch(/cc-intro-rise \d+ms [^;]*? \d+ms backwards/);
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

describe("the curtain's clock (INTRO_TIMING_CSS)", () => {
  const P = 'html[data-intro="play"]';
  /** The delay and duration the clock sets for one selector, in ms. */
  const timing = (selector: string) => {
    const rule = INTRO_TIMING_CSS.split("}").find((item) =>
      item
        .split("{")[0]
        .split(",")
        .some((part) => part.trim() === selector),
    );
    const [, duration] = rule?.match(/animation-duration:(\d+)ms/) ?? [];
    const [, delay] = rule?.match(/animation-delay:(\d+)ms/) ?? [];
    return { duration: Number(duration), delay: Number(delay) };
  };

  it("lifts the sheet and has it gone in under 1.5 s, the page rising under it and ending with it", () => {
    expect(INTRO_TIMELINE.end).toBeLessThanOrEqual(1500);
    for (const selector of [`${P} .cc-intro`, `${P} .cc-intro-stage`, `${P} #main`]) {
      const { duration, delay } = timing(selector);
      expect(delay, selector).toBe(INTRO_TIMELINE.lift);
      expect(delay + duration, selector).toBe(INTRO_TIMELINE.end);
    }
    expect(INTRO_FALLBACK_MS).toBeGreaterThan(INTRO_TIMELINE.end);
    expect(INTRO_FALLBACK_MS).toBeLessThanOrEqual(2000);
  });

  it("draws the line, opens the question and holds it open before the sheet lifts", () => {
    expect(timing(`${P} .cc-if-edges`).delay).toBe(INTRO_TIMELINE.line);
    const open = timing(`${P} .cc-if-text`);
    expect(open.delay).toBe(INTRO_TIMELINE.open);
    expect(timing(`${P} .cc-if-l`)).toEqual(open);
    expect(timing(`${P} .cc-if-r`)).toEqual(open);
    // Fully open for at least an eighth of a second before the sheet starts to lift, and readable as it lifts.
    expect(INTRO_TIMELINE.lift - (open.delay + open.duration)).toBeGreaterThanOrEqual(120);
    expect(timing(`${P} .cc-if-rule`).delay).toBe(INTRO_TIMELINE.rule);
    expect(INTRO_TIMELINE.line).toBeLessThan(INTRO_TIMELINE.open);
    expect(INTRO_TIMELINE.open).toBeLessThan(INTRO_TIMELINE.rule);
    expect(INTRO_TIMELINE.rule).toBeLessThan(INTRO_TIMELINE.lift);
  });

  it("shows how to skip from the first frame", () => {
    expect(INTRO_TIMING_CSS).toContain(`${P} .cc-intro-mark,${P} .cc-intro-skip{animation:none}`);
  });

  it("runs the progress rule until the lift and has the curved edge flat by the time the sheet has gone", () => {
    expect(INTRO_TIMING_CSS).toContain(`.cc-intro-progress{animation-duration:${INTRO_TIMELINE.lift}ms,`);
    const bend = timing(`${P} .cc-ie-bend`);
    expect(bend.delay).toBeGreaterThanOrEqual(INTRO_TIMELINE.lift);
    expect(bend.delay + bend.duration).toBe(INTRO_TIMELINE.end);
  });

  it("beats the dot on each new word and lets it go as the line draws", () => {
    const dot = INTRO_TIMING_CSS.split("}").find((rule) => rule.includes(".cc-intro-dot{")) ?? "";
    for (const { from } of INTRO_WORDS.slice(1)) expect(dot).toContain(`cc-i-beat 160ms cubic-bezier(0.22,1,0.36,1) ${from}ms`);
    expect(dot).toContain(`cc-i-out 160ms cubic-bezier(0.65,0,0.35,1) ${INTRO_TIMELINE.line}ms forwards`);
  });

  it("sits in the overlay itself, so it applies from first paint with no script", () => {
    const html = renderToStaticMarkup(createElement(IntroReveal));
    expect(html).toMatch(/<style>[^<]*\.cc-intro-progress\{animation-duration:/);
  });

});
