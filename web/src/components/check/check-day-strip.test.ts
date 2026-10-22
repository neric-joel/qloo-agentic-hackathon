import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { runCheck, type CheckReport } from "@/lib/check";
import {
  PRICE_COPY,
  parsePriceAnswer,
  priceRequest,
  rankScope,
  sentActs,
  type PricedPair,
  type PriceAnswer,
  type PriceRequest,
} from "@/lib/check-price";
import { SAMPLE_GRID } from "@/lib/check-sample";

import { CheckDayStrip, RANK_NOTE, STRIP, STRIP_CAPTION, stripLayout, stripSize } from "./check-day-strip";
import { CheckPrice, pendingShape, withoutRankNote, type PriceState } from "./check-price";

// Every name below is invented for the test: a published-looking day of five stages.
const GRID = [
  "Lark,North,14:00,15:00",
  "Heron,North,15:30,16:30",
  "Kestrel,North,17:00,18:00",
  "Wren,South,14:30,15:30",
  "Robin,South,16:00,17:00",
  "Finch,East,14:15,15:00",
  "Swift,East,16:15,17:15",
  "Plover,West,15:00,16:00",
  "Tern,West,17:30,18:30",
  "Crane,Barn,14:45,15:45",
  "Egret,Barn,16:45,17:45",
].join("\n");

const outcome = runCheck({ grid: GRID, changeover: "", curfew: "", pairs: "" });
if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
const report: CheckReport = outcome.report;

const priced = (a: string, b: string, rank: number, minutes = 30): PricedPair => ({
  a,
  b,
  minutes,
  status: "priced",
  overlap: 1 - rank / 20,
  rank,
  reason: null,
});

/** Five compared pairs (one tie at 2), one pair with no value and one pair that is not on this grid. */
const PAIRS: PricedPair[] = [
  priced("Lark", "Finch", 3, 45),
  priced("Wren", "Crane", 1, 45),
  priced("Plover", "Crane", 2, 45),
  priced("Robin", "Swift", 2, 45),
  priced("Kestrel", "Egret", 5, 45),
  { a: "Heron", b: "Robin", minutes: 30, status: "unpriced", overlap: null, rank: null, reason: "no_signal" },
  priced("Nobody", "Lark", 4),
];

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("round 37: the published day's strip (L68)", () => {
  const layout = stripLayout(report, { pairs: PAIRS });
  if (!layout) throw new Error("no layout");
  const html = renderToStaticMarkup(createElement(CheckDayStrip, { layout }));

  it("draws one lane per stage and every set as a bar, in the grid's stage order", () => {
    expect(layout.lanes.map((lane) => lane.key)).toEqual(["north", "south", "east", "west", "barn"]);
    expect(layout.lanes.map((lane) => lane.sets.length)).toEqual([3, 2, 2, 2, 2]);
    expect(html.match(/data-strip-lane=/g)).toHaveLength(5);
    expect(html.match(/data-strip-set=/g)).toHaveLength(11);
  });

  it("numbers each compared pair by its taste rank in this comparison (1 is the highest), and nothing else", () => {
    // The unpriced pair and the pair not on this grid get no window and no number; a tie keeps its rank.
    expect(layout.windows.map((window) => window.rank)).toEqual([1, 2, 2, 3, 5]);
    const ranks = [...html.matchAll(/<text data-strip-rank="(\d+)"[^>]*>(\d+)<\/text>/g)].map((m) => [m[1], m[2]]);
    expect(ranks).toEqual([["1", "1"], ["2", "2"], ["2", "2"], ["3", "3"], ["5", "5"]]);
    // Each window spans the two lanes of its pair, at the pair's shared window on this grid.
    const wren = layout.windows[0];
    expect(wren).toMatchObject({ start: 14 * 60 + 45, end: 15 * 60 + 30, upper: 1, lower: 4 });
    // No names, no clock and no other words in the drawing.
    expect(text(html.slice(0, html.indexOf("</svg>")))).toBe("1 2 2 3 5");
  });

  it("prints the numbers in ink, never raspberry or teal, each on its own window", () => {
    const texts = [...html.matchAll(/<text [^>]*>/g)].map((m) => m[0]);
    expect(texts).toHaveLength(5);
    for (const tag of texts) {
      expect(tag).toContain('fill="var(--foreground)"');
      expect(tag).not.toMatch(/--primary|--prov-qloo|--taste/);
      // A knockout halo in the panel's own colour, so a number reads over the hatch.
      expect(tag).toContain('stroke="var(--card)"');
    }
    for (const window of layout.windows) {
      expect(window.label.gap).toBeGreaterThanOrEqual(window.upper);
      expect(window.label.gap).toBeLessThan(window.lower);
      expect(window.label.x).toBeGreaterThan(0);
      expect(window.label.x).toBeLessThan(100);
    }
  });

  it("hatches each compared pair's shared window in raspberry over the shared wash, with the strip's mark corner", () => {
    const pattern = html.match(/<pattern id="([^"]+)"[^>]*>([\s\S]*?)<\/pattern>/);
    expect(pattern?.[2]).toMatch(/<line [^>]*stroke="var\(--primary\)"/);
    const windows = [...html.matchAll(/<g data-strip-window="\d+">([\s\S]*?)<\/g>/g)].map((m) => m[1]);
    expect(windows).toHaveLength(5);
    for (const window of windows) {
      expect(window).toContain('fill="var(--shared-wash)"');
      expect(window).toContain(`fill="url(#${pattern?.[1]})"`);
      expect(window.match(/rx="4"/g)).toHaveLength(2);
      // Never a capsule: the corner is at most 0.3 of the window's own height (14px between adjacent lanes).
      for (const m of window.matchAll(/<rect [^>]*height="([\d.]+)" rx="([\d.]+)"/g)) {
        expect(Number(m[2])).toBeLessThanOrEqual(0.3 * Number(m[1]));
      }
    }
    // Raspberry only in the hatch: never on a set, a number or the caption.
    expect(html.match(/var\(--primary\)/g)).toHaveLength(1);
  });

  it("outlines every set in ink on the panel's own fill, with the brief figure's corner (about 0.3 of its height)", () => {
    const sets = [...html.matchAll(/<rect data-strip-set=""[^>]*>/g)].map((m) => m[0]);
    expect(sets).toHaveLength(11);
    for (const set of sets) {
      // 4px on a 14px bar: rx / h 0.29, never the capsule a 6px corner made (0.43).
      expect(set).toContain('height="14" rx="4"');
      expect(set).toContain('stroke="var(--foreground)"');
      expect(set).toContain('fill="var(--card)"');
    }
    expect(layout.rx).toBe(4);
    expect(layout.rx / layout.bar).toBeLessThanOrEqual(STRIP.corner);
    // A day of six, seven or eight stages shrinks its bars, and the corner shrinks with them: never over 0.3 of a
    // bar, and never over a third of the shortest window (two adjacent lanes).
    for (const stages of [2, 5, 6, 7, 8]) {
      const grid = Array.from({ length: stages }, (_, i) => `Act ${i},Stage ${i},14:00,15:00`).join("\n");
      const many = runCheck({ grid, changeover: "", curfew: "", pairs: "" });
      if (!many.ok) throw new Error("refused");
      const size = stripSize(many.report);
      if (!size) throw new Error("no size");
      expect(size.rx).toBeGreaterThan(0);
      expect(size.rx / size.bar).toBeLessThanOrEqual(STRIP.corner);
      expect(size.rx / (size.gap - 2 * STRIP.inset)).toBeLessThanOrEqual(1 / 3);
    }
  });

  it("is a picture only: hidden from assistive technology, with no motion, and the caption and qualifier beside it", () => {
    expect(html).toMatch(/<div aria-hidden="true" class="min-w-0"><svg/);
    expect(html).toContain('focusable="false"');
    expect(html).not.toMatch(/animate|transition|cc-reveal|data-anim/);
    expect(text(html)).toContain(`${STRIP_CAPTION} ${RANK_NOTE}`);
    // The caption is for the picture, so screen readers skip it; the qualifier stays readable.
    expect(html).toContain(`<span aria-hidden="true" class="block font-semibold text-foreground">${STRIP_CAPTION}</span>`);
    const source = readFileSync(join(__dirname, "check-day-strip.tsx"), "utf8");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|oklch\(/i);
    expect(source).not.toMatch(/@keyframes|animation|transition/);
  });

  it("stays at most 160px tall (144px for five stages) and scales across the column by percentages", () => {
    expect(layout.height).toBe(2 * STRIP.pad + 5 * STRIP.bar + 4 * STRIP.gap);
    expect(layout.height).toBe(144);
    expect(html).toContain(`<svg width="100%" height="144"`);
    for (const m of html.matchAll(/ (?:x|width)="([^"]+)"/g)) expect(m[1]).toMatch(/%$|^0$|^[36]$/);
    for (const stages of [6, 7, 8]) {
      const grid = Array.from({ length: stages }, (_, i) => `Act ${i},Stage ${i},14:00,15:00`).join("\n");
      const many = runCheck({ grid, changeover: "", curfew: "", pairs: "" });
      if (!many.ok) throw new Error("refused");
      const wide = stripLayout(many.report, { pairs: [priced("Act 0", `Act ${stages - 1}`, 1, 60)] });
      expect(wide?.height).toBeLessThanOrEqual(STRIP.maxHeight);
      expect(wide?.gap).toBeGreaterThanOrEqual(STRIP.number + 2);
    }
    const nine = runCheck({ grid: Array.from({ length: 9 }, (_, i) => `Act ${i},Stage ${i},14:00,15:00`).join("\n"), changeover: "", curfew: "", pairs: "" });
    if (!nine.ok) throw new Error("refused");
    expect(stripLayout(nine.report, { pairs: [priced("Act 0", "Act 8", 1, 60)] })).toBeNull();
  });

  it("keeps every number clear of the others at the narrowest strip, so at any wider one", () => {
    const boxes = layout.windows.map((window) => {
      const centre = (window.label.x / 100) * STRIP.narrowest;
      const half = (String(window.rank).length * 7.2 + 3) / 2;
      return { gap: window.label.gap, left: centre - half, right: centre + half };
    });
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        expect(a.gap !== b.gap || a.right <= b.left || b.right <= a.left).toBe(true);
      }
    }
  });

  it("draws nothing without a compared pair on the grid", () => {
    expect(stripLayout(report, { pairs: [PAIRS[5], PAIRS[6]] })).toBeNull();
    expect(stripLayout(report, { pairs: [] })).toBeNull();
  });
});

describe("round 37: the compare step shows the strip only for a published day's answer, with the qualifier moved beside it", () => {
  const ranking = {
    pairs: [
      { a: "Wren", b: "Crane" },
      { a: "Plover", b: "Crane" },
      { a: "Robin", b: "Swift" },
      { a: "Kestrel", b: "Egret" },
    ],
    noSignal: [],
  };
  const request = priceRequest(report, ranking) as PriceRequest;
  const answer = parsePriceAnswer(
    {
      mode: "saved",
      source: "saved_day",
      preset_id: "invented-day",
      fetched_at: null,
      coverage: { acts: request.acts.length, priced: request.acts.length, unpriced: [] },
      comparator: { kind: "saved_day", acts: 11 },
      pairs: request.overlaps.map((o, i) => ({ a: o.a, b: o.b, status: "priced", taste_overlap: 0.9 - i / 10, pair_rank: i + 1, reason: null })),
      requests_used: 0,
    },
    request,
    "saved",
  ) as PriceAnswer;
  const render = (props: { published: boolean; day: CheckReport | null }) =>
    renderToStaticMarkup(
      createElement(CheckPrice, {
        request,
        noOverlap: false,
        state: { phase: "ready", answer },
        order: "selection",
        onOrder: () => {},
        onPrice: () => {},
        stale: false,
        ...props,
      }),
    );

  it("words the qualifier exactly as the scope note does, so the move cannot drift", () => {
    expect(request.basis).toBe("saved_ranking");
    expect(rankScope(answer)).toContain(` ${RANK_NOTE}`);
    expect(rankScope({ ...answer, source: "invented_day" })).toContain(` ${RANK_NOTE}`);
    expect(withoutRankNote(rankScope(answer))).not.toContain("Taste rank 1 of n");
    expect(withoutRankNote("A note without it.")).toBe("A note without it.");
  });

  it("draws the strip above the values on a published day, with the qualifier said once, beside it", () => {
    const html = render({ published: true, day: report });
    const page = text(html);
    expect(html).toContain("data-day-strip");
    expect(html.indexOf("data-day-strip")).toBeLessThan(html.indexOf('aria-label="Compared overlaps"'));
    expect(page.split(RANK_NOTE)).toHaveLength(2);
    expect(page).toContain(`${STRIP_CAPTION} ${RANK_NOTE}`);
    // The scope note keeps the rest of its sentence.
    expect(page).toContain("Values come from the saved day: each is a rank among the acts on that day’s lineup of 11 acts and not attendance.");
    expect(html.match(/<text data-strip-rank=/g)).toHaveLength(4);
  });

  it("changes nothing for a pasted grid, or while the page passes no rows", () => {
    for (const html of [render({ published: false, day: report }), render({ published: true, day: null })]) {
      expect(html).not.toContain("data-day-strip");
      expect(text(html).split(RANK_NOTE)).toHaveLength(2);
      expect(text(html)).not.toContain(STRIP_CAPTION);
    }
  });
});

describe("round 37 (fix pass 1): while a compare is pending, the step holds the room of what the press will bring", () => {
  const ranking = {
    pairs: [
      { a: "Wren", b: "Crane" },
      { a: "Plover", b: "Crane" },
      { a: "Robin", b: "Swift" },
      { a: "Kestrel", b: "Egret" },
    ],
    noSignal: [],
  };
  const request = priceRequest(report, ranking) as PriceRequest;
  const answer = parsePriceAnswer(
    {
      mode: "saved",
      source: "saved_day",
      preset_id: "invented-day",
      fetched_at: null,
      coverage: { acts: request.acts.length, priced: request.acts.length, unpriced: [], matched: request.acts.length, no_signal: [], ambiguous: [] },
      comparator: { kind: "saved_day", acts: 11 },
      pairs: request.overlaps.map((o, i) => ({ a: o.a, b: o.b, status: "priced", taste_overlap: 0.9 - i / 10, pair_rank: i + 1, reason: null })),
      requests_used: 0,
    },
    request,
    "saved",
  ) as PriceAnswer;
  const render = (state: PriceState, props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(CheckPrice, {
        request,
        noOverlap: false,
        state,
        order: "selection",
        onOrder: () => {},
        onPrice: () => {},
        stale: false,
        published: true,
        day: report,
        ...props,
      }),
    );
  const pending = render({ phase: "loading", mode: "saved" });
  const ready = render({ phase: "ready", answer });
  const holds = (html: string) => [...html.matchAll(/data-hold="([a-z]+)"/g)].map((m) => m[1]);
  // The words each room holds, as the attribute carries them (the markup escapes quotes and ampersands).
  const unescape = (value: string) =>
    value.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const ghosts = (html: string) => [...html.matchAll(/data-ghost="([^"]*)"/g)].map((m) => unescape(m[1]));
  // From the room's own tag to the first block the answer keeps (the not-compared line or the scope note).
  const tagAt = (html: string, marker: string) => html.lastIndexOf("<", html.indexOf(marker));
  const roomOf = (html: string) => html.slice(tagAt(html, "data-price-room"), tagAt(html, "data-tail"));

  it("knows what each press will most likely bring", () => {
    expect(request.basis).toBe("saved_ranking");
    expect(pendingShape(request, "saved")).toBe("answer");
    expect(pendingShape({ basis: "served", acts: ["Lark"] }, "saved")).toBe("answer");
    // A paste on no saved day finds none in saved mode; a live press is answered (or refused).
    const pasted = priceRequest(report) as PriceRequest;
    expect(pasted.basis).toBe("longest");
    expect(pendingShape(pasted, "saved")).toBe("not_saved");
    expect(pendingShape(pasted, "live")).toBe("answer");
    // The invented sample is answered from the invented example day.
    const sample = runCheck({ grid: SAMPLE_GRID, changeover: "", curfew: "", pairs: "" });
    if (!sample.ok) throw new Error("refused");
    expect(pendingShape(priceRequest(sample.report) as PriceRequest, "saved")).toBe("answer");
  });

  it("draws the answer's blocks in the answer's order, the rows and the sort control one for one", () => {
    expect(pending).toContain('data-price-room="answer"');
    expect(holds(pending)).toEqual(["order", "rows", "coverage"]);
    expect(holds(ready)).toEqual(["order", "rows", "coverage"]);
    // One row per pair sent, in the answer row's own classes, so each wraps as the row will.
    const rowClass = "py-2.5 text-sm font-semibold break-words first:pt-0 last:pb-0";
    const pendingRows = [...pending.matchAll(/<p data-ghost="[^"]*" class="([^"]*)"/g)].filter((m) => m[1].endsWith(rowClass));
    const readyRows = [...ready.matchAll(/<li class="([^"]*)"/g)].filter((m) => m[1] === rowClass);
    expect(readyRows).toHaveLength(4);
    expect(pendingRows).toHaveLength(readyRows.length);
    // Three sorts on a published day, each the toggle's 44px room around its own label.
    const toggle = '<span class="inline-flex min-h-11 items-center rounded-md border border-transparent bg-muted px-3 text-sm font-semibold">';
    expect(pending.split(toggle)).toHaveLength(4);
    expect(ready.match(/<button type="button" aria-pressed=/g)).toHaveLength(3);
    // The source line's box holds "Comparing." in the room of the line the answer will bring.
    expect(pending).toContain('<p class="grid rounded-md bg-background p-3 text-sm font-semibold leading-relaxed">');
    expect(ready).toContain('<p class="rounded-md bg-background p-3 text-sm font-semibold leading-relaxed">');
    expect(ghosts(pending)).toContain(PRICE_COPY.savedBanner);
  });

  it("holds the strip's room in the strip's own frame and height, with no set, window or number", () => {
    expect(pending).toContain("data-day-strip-room");
    expect(pending).not.toContain("<svg");
    expect(pending).toContain("height:144px");
    expect(ready).toContain('<svg width="100%" height="144"');
    const frame = (html: string, marker: string) => html.match(new RegExp(`${marker}="" class="([^"]*)"`))?.[1];
    expect(frame(pending, "data-day-strip-room")).toBe(frame(ready, "data-day-strip"));
    // One quiet bar per stage, at the strip's corner (never a capsule).
    expect(pending.match(/class="shrink-0 bg-muted" style="height:14px;border-radius:4px"/g)).toHaveLength(5);
  });

  it("shows and reads nothing but Comparing.: no value, rank, count, source or caption until the answer says it", () => {
    expect(text(roomOf(pending))).toBe("Comparing.");
    for (const said of ["Taste overlap", "/ 100", "taste rank", "Compared using", STRIP_CAPTION, RANK_NOTE, "Sent", "Matched"]) {
      expect(text(pending)).not.toContain(said);
    }
    // Each row's room is its pair and minutes (already on the page) with figure spaces where the value will be.
    const rows = ghosts(pending).filter((words) => / min shared\. /.test(words));
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toMatch(/^\S.* × .*: \d+ min shared\. Taste overlap  {3} \/ 100, taste rank   of  \.$/);
    // Everything but "Comparing." is hidden from assistive technology, and nothing can be pressed, focused or moves.
    const room = roomOf(pending);
    expect(room.match(/aria-busy="true"[^>]*>Comparing\.</g)).toHaveLength(1);
    const hidden = room.slice(room.indexOf('<div aria-hidden="true">'));
    expect(ghosts(room).length - ghosts(hidden).length).toBe(1);
    expect(room).toMatch(/<span aria-hidden="true" data-ghost="[^"]*" class="invisible /);
    expect(room).not.toMatch(/<button|tabindex|href=/);
    expect(pending).not.toMatch(/animate-|transition|pulse/);
  });

  it("holds the scope note's room at the note the answer brings, its lineup at two digits", () => {
    const note = "Values come from the saved day: each is a rank among the acts on that day’s lineup of 11 acts and not attendance.";
    expect(text(ready)).toContain(note);
    const room = ghosts(pending).find((words) => words.startsWith("Values come from the saved day"));
    expect(room).toBe(`${note.replace("of 11 acts", "of 99 acts")} ${PRICE_COPY.cbi}`);
    // While pending the note is only its room, hidden from assistive technology; it comes back with the answer
    // (or, after a refusal or a failed answer, as it read before the press).
    expect(pending).toMatch(/<p aria-hidden="true" data-tail="" data-ghost="Values come from the saved day/);
    expect(text(pending)).not.toContain(PRICE_COPY.scopeBefore);
    expect(text(render({ phase: "error", mode: "saved" }))).toContain(PRICE_COPY.scopeBefore);
    expect(text(render({ phase: "idle" }))).toContain(PRICE_COPY.scopeBefore);
    // The blocks the answer keeps from the pending room, so the browser can tell what would move.
    expect(ready.match(/data-tail=""/g)?.length).toBeGreaterThanOrEqual(1);
    expect(ready).toContain('<div class="flow-root">');
  });

  it("holds the no-saved-day box's room for a paste on no saved day, as the box will read", () => {
    const pasted = priceRequest(report) as PriceRequest;
    const props = { request: pasted, published: false, day: null, publishedTitle: "Brookfield 2030, Saturday", onTryPublished: () => {} };
    const off = render({ phase: "loading", mode: "saved" }, { ...props, live: false });
    const offAfter = render({ phase: "not_saved" }, { ...props, live: false });
    expect(off).toContain('data-price-room="not_saved"');
    expect(off).not.toContain('data-price-room="answer"');
    expect(ghosts(off)).toEqual(expect.arrayContaining([PRICE_COPY.liveOff, PRICE_COPY.tryPublished("Brookfield 2030, Saturday")]));
    // The box and its text action in the classes the settled box uses.
    const box = "mt-4 rounded-md bg-background p-3 sm:p-4";
    expect(off).toContain(`data-price-room="not_saved" class="${box}"`);
    expect(offAfter).toContain(`<div class="${box}">`);
    const action = (html: string, tag: string) =>
      html.match(new RegExp(`<${tag} (?:type="button" |aria-hidden="true" )class="([^"]*whitespace-normal[^"]*)"`))?.[1];
    expect(action(off, "span")).toBeDefined();
    expect(action(off, "span")).toBe(action(offAfter, "button"));
    // Where the server compares live, the room is the live offer and its 44px button.
    const on = render({ phase: "loading", mode: "saved" }, { ...props, live: true });
    expect(ghosts(on)).toContain(PRICE_COPY.notSaved(sentActs(pasted, "live").length, pasted.need));
    expect(on).toMatch(/<span aria-hidden="true" class="mt-3 inline-flex h-11 /);
    expect(text(roomOf(on))).toBe("Comparing.");
  });
});
