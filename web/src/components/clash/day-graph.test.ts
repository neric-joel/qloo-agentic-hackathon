import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { qlooCredits } from "@/lib/credit";
import {
  buildDayGraph,
  drawingHeight,
  drawingTitle,
  EASE_MOVE,
  keyLine,
  MOVE_MS,
  sideEffectText,
  threadWidth,
  type DayGraphModel,
  type GraphView,
} from "@/lib/day-graph";
import { lineColor, lineKeyAction, lineTransform, planDrawing, stepLine, trackPct } from "@/lib/day-graph-motion";
import { parseDecision, type Decision } from "@/lib/decision";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset, type Preset } from "@/lib/preset";

import { DayGraph, DayGraphKey } from "./day-graph";

// Every name, time and figure below is invented for the test: the tiny preset fixture reshaped into a
// hand-made five-stage day. None of it is Qloo data or a saved festival day.

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type SetSpec = { name: string; stage: string; start: string; end: string; locked?: boolean; unscored?: boolean };

const STAGES: [string, string][] = [
  ["main", "Main"],
  ["hill", "Hill"],
  ["barn", "Barn"],
  ["wood", "Wood"],
  ["lake", "Lake"],
];
const idOf = (name: string) => name.toLowerCase();

/**
 * Alder (Wood 14:00-15:00) and Birch (Lake 14:00-14:45) share 45 minutes. Moving Alder 15 minutes later starts
 * an overlap with Cedar (0 -> 15), lengthens Oak's (10 -> 25), shortens Fir's and Gum's, and ends Elm's.
 * Fir (Main) and Birch (Lake) clash across Hill, Barn and Wood, so their line crosses Alder's bar.
 */
const SETS: SetSpec[] = [
  { name: "Larch", stage: "main", start: "12:00", end: "13:00", locked: true },
  { name: "Fir", stage: "main", start: "14:00", end: "15:00" },
  { name: "Juniper", stage: "main", start: "15:15", end: "16:15" },
  { name: "Gum", stage: "hill", start: "13:30", end: "14:30" },
  { name: "Oak", stage: "hill", start: "14:50", end: "15:30" },
  { name: "Ivy", stage: "hill", start: "15:45", end: "16:30" },
  { name: "Elm", stage: "barn", start: "13:20", end: "14:10" },
  { name: "Cedar", stage: "barn", start: "15:00", end: "16:00" },
  { name: "Alder", stage: "wood", start: "14:00", end: "15:00" },
  { name: "Kauri", stage: "wood", start: "15:30", end: "16:00", unscored: true },
  { name: "Birch", stage: "lake", start: "14:00", end: "14:45" },
  { name: "Hazel", stage: "lake", start: "16:00", end: "17:00" },
];

function side(name: string): Raw {
  const spec = SETS.find((item) => item.name === name);
  if (!spec) throw new Error(`no set ${name} in the fixture`);
  return { act_id: idOf(name), name, stage_id: spec.stage, genre: null };
}

function pair(rank: number, a: string, b: string, minutes: number, overlap: number): Raw {
  return {
    rank,
    a: side(a),
    b: side(b),
    day: 0,
    overlap_minutes: minutes,
    concurrency: 1,
    audience_overlap: overlap,
    draw: 0.5,
    regret: 0.1,
    regret_share: 0.1,
    label: null,
    confidence: "strong",
  };
}

const CLASHES: Raw[] = [
  pair(1, "Alder", "Birch", 45, 0.912),
  pair(2, "Fir", "Alder", 60, 0.62),
  pair(3, "Gum", "Birch", 30, 0.55),
  pair(4, "Elm", "Gum", 40, 0.4),
  pair(5, "Oak", "Alder", 10, 0.804),
  pair(6, "Fir", "Birch", 45, 0.3),
  pair(7, "Cedar", "Juniper", 45, 0.2),
  pair(8, "Elm", "Alder", 10, 0.25),
];

function makeDay(synthetic = false): Preset {
  const raw = rawTinyPreset() as Raw;
  raw.id = "mini-fest-sun";
  raw.title = "Mini Fest 2026, Sunday";
  raw.synthetic = synthetic;
  raw.festival.days = ["Sun"];
  raw.festival.stages = STAGES.map(([id, name], index) => ({ id, name, tier: index + 1, hours: [] }));
  raw.festival.acts = SETS.map((spec) => ({ id: idOf(spec.name), name: spec.name, qloo_id: null, popularity: spec.unscored ? null : 0.5, genre: null, billing_tier: 2 }));
  raw.festival.timetable = SETS.map((spec) => ({ act_id: idOf(spec.name), day: 0, stage_id: spec.stage, start: spec.start, end: spec.end, locked: spec.locked === true }));
  raw.report.clashes = CLASHES;
  raw.report.metrics = { ...raw.report.metrics, scored_concurrent_pairs: 9, unscored_concurrent_pairs: 2 };
  raw.report.coverage = {
    ...raw.report.coverage,
    unscored: SETS.filter((spec) => spec.unscored).map((spec) => ({ act_id: idOf(spec.name), name: spec.name, reason: "no_signal" })),
    weak_act_ids: [],
  };
  return parsePreset(raw);
}

const LATER: Raw = {
  act_id: "alder",
  act: "Alder",
  from: "Wood 14:00-15:00",
  stage_id: "wood",
  stage: "Wood",
  day: 0,
  start: "14:15",
  end: "15:15",
  minutes_moved: 15,
  legal_places: 5,
  stage_changed: false,
  budget_after: 104.1,
  minutes_shared_after: 30,
  same_index_alternative: null,
};

function decide(move: Raw | null): Decision {
  const decision = parseDecision({
    kind: "decision",
    day: 0,
    skipped_locked: 0,
    skipped_no_place: 0,
    clash: { a_id: "alder", b_id: "birch", rank: 1, minutes: 45 },
    published_budget: 108.4,
    move,
    rule: null,
  });
  if (!decision) throw new Error("the fixture decision did not parse");
  return decision;
}

function model({ move = LATER, synthetic = false }: { move?: Raw | null; synthetic?: boolean } = {}): DayGraphModel {
  const built = buildDayGraph(makeDay(synthetic), decide(move), 0);
  if (!built) throw new Error("no model for the fixture day");
  return built;
}

const render = (m: DayGraphModel, view: GraphView) => renderToStaticMarkup(createElement(DayGraph, { model: m, view, onSettled: () => {} }));

/** One layout's markup: from its opening tag to the next layout's (or the live region after the last). */
function layoutOf(html: string, layout: "desktop" | "phone" | "short"): string {
  const start = html.indexOf(`data-layout="${layout}"`);
  const rest = html.slice(start + 1);
  const next = rest.search(/data-layout="|aria-live="polite"/);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The text a reader sees and every title, with the tags stripped. */
function words(html: string): string {
  const titles = [...html.matchAll(/title="([^"]*)"/g)].map((match) => match[1]);
  return `${html.replace(/<[^>]+>/g, " ")} ${titles.join(". ")}`.replace(/\s+/g, " ");
}

const decode = (text: string) => text.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

describe("DayGraph: the server frame", () => {
  const moved = model();

  it("renders all three layouts, each exactly as tall as drawingHeight, and picks one by CSS alone", () => {
    const html = render(moved, "moved");
    for (const layout of ["desktop", "phone", "short"] as const) {
      expect(html).toMatch(new RegExp(`data-layout="${layout}" class="[^"]*" style="height:${drawingHeight(moved, layout)}px"`));
    }
    expect(html).toContain('data-layout="desktop" class="relative hidden lg:block"');
    expect(html).toContain('data-layout="phone" class="relative lg:hidden [@media(max-height:699px)]:hidden"');
    expect(html).toContain('data-layout="short" class="relative hidden max-lg:[@media(max-height:699px)]:block"');
    // The phone draws the overview strip; short does not.
    expect(layoutOf(html, "phone")).toContain("data-strip");
    expect(layoutOf(html, "short")).not.toContain("data-strip");
  });

  it("is a group titled by the view it shows and described by the key, the move and its side effects", () => {
    for (const view of ["moved", "published"] as const) {
      const html = render(moved, view);
      expect(html).toMatch(/^<div data-day-graph="" data-view="[a-z]+" role="group" aria-labelledby="([^"]+)-title" aria-describedby="\1-desc"/);
      expect(html).toContain(`data-view="${view}"`);
      expect(decode(html)).toContain(`-title" class="sr-only">${drawingTitle(moved, view)}</p>`);
      const move = moved.move;
      if (!move) throw new Error("the fixture has a move");
      expect(decode(html)).toContain(`-desc" class="sr-only">${keyLine(moved)} ${move.label}. ${sideEffectText(move)}</p>`);
    }
    expect(drawingTitle(moved, "moved")).toContain("drawn with Alder 15 min later");
    expect(drawingTitle(moved, "published")).toContain("as published");
    // The live region is empty on first paint: a settle is announced, a page load is not.
    expect(render(moved, "moved")).toContain('<p class="sr-only" aria-live="polite"></p>');
  });

  it("draws every line that touches the mover at its moved window, and drops the one the move ends", () => {
    const desktop = (view: GraphView) => layoutOf(render(moved, view), "desktop");
    const plan = planDrawing(moved, "desktop");
    // Alder x Birch: 14:00-14:45 as published, 14:15-14:45 with the move.
    expect(desktop("published")).toContain(`transform:${lineTransform(plan.track, (840 + 885) / 2, plan.views.published.lines.find((l) => l.key === "alder~birch")?.off ?? 0)}`);
    expect(desktop("moved")).toContain(`transform:${lineTransform(plan.track, (855 + 885) / 2, plan.views.moved.lines.find((l) => l.key === "alder~birch")?.off ?? 0)}`);
    // Elm x Alder (rank 8) ends with the move: drawn as published, gone with the move.
    expect(desktop("published")).toContain('data-thread="8"');
    expect(desktop("moved")).not.toContain('data-thread="8"');
    // Oak x Alder (rank 5) lengthens: drawn in both views.
    expect(desktop("moved")).toContain('data-thread="5"');
  });

  it("lays a paper casing under every quiet line, so it reads where it crosses a wash or another set", () => {
    const html = layoutOf(render(moved, "moved"), "desktop");
    const threads = [...html.matchAll(/<div data-thread="(\d+)"( data-lit="")?[^>]*style="top:(\d+)px;height:(\d+)px[^"]*">(.*?)<\/div>/g)];
    expect(threads.length).toBeGreaterThan(3);
    for (const [, rank, lit, , height, inner] of threads) {
      const taste = moved.threads.find((thread) => thread.rank === Number(rank))?.taste ?? 0;
      if (lit) {
        expect(inner).not.toContain("data-casing");
        expect(inner).toContain('stroke="var(--prov-qloo)"');
        continue;
      }
      // Full length, 2px wider than the line on each side, in the paper colour.
      expect(inner).toContain(`<line data-casing="" x1="12" x2="12" y1="0" y2="${height}" stroke="var(--background)" stroke-width="${threadWidth(taste) + 4}"></line>`);
      expect(inner).toContain('stroke="var(--taste-quiet)"');
    }
    // Fir x Birch runs Main to Lake, across Alder's row: its casing covers the crossing.
    expect(html).toMatch(/data-thread="6"[^>]*>.*?data-casing/);
  });

  it("shows only the published or the moved minutes in its tags", () => {
    const tagsOf = (view: GraphView) => [...render(moved, view).matchAll(/data-shared-tag="[^"]*"[^>]*>([^<]*)</g)].map((match) => match[1]);
    const published = tagsOf("published");
    const withMove = tagsOf("moved");
    expect(new Set(published)).toEqual(new Set(["45 min shared"]));
    expect(new Set(withMove)).toEqual(new Set(["30 min shared", "new 15 min", "+15 min"]));
    for (const text of [...published, ...withMove]) {
      const shared = /^(\d+) min shared$/.exec(text);
      if (shared) expect([45, 30]).toContain(Number(shared[1]));
    }
    // What a reader sees (a line's accessible name may say "45 min shared as published, 30 with the move").
    const visible = (view: GraphView) => render(moved, view).replace(/<[^>]+>/g, " ");
    expect(visible("published")).not.toContain("new 15 min");
    expect(visible("moved")).not.toContain("45 min shared");
    expect(visible("moved")).toContain("30 min shared");
    expect(visible("published")).toContain("45 min shared");
  });

  it("gives every mark its corner: 6px bars, ghost, windows and bracket; 10px hit areas; round dots", () => {
    const html = render(moved, "moved");
    const sets = [...html.matchAll(/<div data-set="[^"]+" class="([^"]*)"/g)].map((match) => match[1]);
    expect(sets.length).toBeGreaterThan(20);
    for (const classes of sets) expect(classes).toMatch(/\brounded-xs\b/);
    expect(html).toMatch(/data-ghost="" class="[^"]*\brounded-xs\b[^"]*border-dashed/);
    const windows = [...html.matchAll(/<rect (data-shared-window=""|data-created="[^"]+")[^>]*>/g)].map((match) => match[0]);
    // The hatch and both grown windows on a desktop; a phone draws only the windows between its three rows.
    const expected = (["desktop", "phone", "short"] as const).reduce((sum, layout) => {
      const plan = planDrawing(moved, layout).views.moved;
      return sum + (plan.hatch ? 1 : 0) + plan.created.length;
    }, 0);
    expect(expected).toBe(3 + 2 + 2);
    expect(windows.length).toBe(expected);
    for (const rect of windows) expect(rect).toContain('rx="6"');
    for (const rect of windows.filter((item) => item.includes("data-created"))) expect(rect).toContain('stroke-dasharray="4 3"');
    expect(html).toMatch(/data-bracket="" class="[^"]*\brounded-xs\b[^"]*border-2 border-foreground/);
    const hits = [...html.matchAll(/<button type="button" data-hit="[^"]+"[^>]*class="([^"]*)"/g)].map((match) => match[1]);
    expect(hits.length).toBeGreaterThan(0);
    for (const classes of hits) expect(classes).toMatch(/\bsize-11\.5\b.*\brounded-md\b/);
    for (const dot of html.match(/<span data-end-dot=""[^>]*>/g) ?? []) expect(dot).toContain("border-radius:50%");
    // No square mark: every SVG rect is rounded and nothing is drawn with a zero radius.
    // (The lock glyph is an icon with its own small corners, not a mark of the drawing.)
    const rects = html.replace(/<svg[^>]*class="lucide[^"]*"[^>]*>.*?<\/svg>/g, "").match(/<rect\b[^>]*>/g) ?? [];
    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) expect(rect).toContain('rx="6"');
    expect(html).not.toMatch(/rounded-none|rx="0"|rounded-\[/);
  });

  it("uses no opacity attributes and no colour literal", () => {
    for (const view of ["moved", "published"] as const) {
      const html = render(moved, view);
      expect(html).not.toMatch(/fill-opacity|stroke-opacity|fillOpacity|strokeOpacity|color-mix/);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|oklch\(/);
      // A static frame never hides a mark with opacity: what is not drawn is not in the markup.
      expect(html).not.toMatch(/opacity:0/);
    }
  });

  it("keeps the drawing's text at the 12.5px label size or larger", () => {
    const html = render(moved, "moved");
    expect(html).toMatch(/^<div[^>]*class="relative text-\[12\.5px\] leading-\[15px\]/);
    const sizes = [...html.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12.5);
    expect(html).not.toMatch(/\btext-(xs|2xs)\b/);
  });

  it("names each featured set in full outside its bar and every other inside its bar", () => {
    const html = layoutOf(render(moved, "moved"), "desktop");
    for (const set of moved.sets.filter((item) => item.featured)) expect(html).toContain(`data-label="${set.actId}"`);
    // A featured set carries no name inside its bar; an unfeatured one does, cut with an ellipsis.
    expect(html).toMatch(/data-set="fir"[^>]*>.*?<span class="min-w-0 truncate font-medium">Fir<\/span>/);
    expect(html).not.toMatch(/data-set="birch"[^>]*>[^]*?truncate font-medium">Birch</);
  });

  it("draws the names inside bars over the lines, each glyph ringed in its bar's fill, under the lines' hit areas", () => {
    const html = layoutOf(render(moved, "moved"), "desktop");
    // Lines come first in paint order; a name's box is lifted over them and rings its text in the bar's fill.
    expect(html.indexOf("data-thread=")).toBeGreaterThan(0);
    const names = [...html.matchAll(/<span class="([^"]*)"><span class="min-w-0 truncate font-medium">/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(5);
    for (const classes of names) {
      expect(classes).toMatch(/\bz-\[1\]/);
      expect(classes).toContain("[paint-order:stroke_fill]");
      expect(classes).toContain("[-webkit-text-stroke:4px_var(--halo)]");
    }
    // The ring is the bar's own fill: card on a scored set, muted on an unscored one.
    expect(html).toMatch(/data-set="fir" class="[^"]*\bbg-card \[--halo:var\(--card\)\]/);
    expect(html).toMatch(/data-set="kauri" class="[^"]*\bbg-muted\b[^"]*\[--halo:var\(--muted\)\]/);
    // A lock is ringed the same way: a filled copy in the bar's fill under the glyph.
    expect(html).toMatch(/data-set="larch"[^>]*>.*?<svg[^>]*class="lucide[^"]*absolute inset-0 size-3 fill-\(--halo\) text-\(--halo\)"/);
    // The hit areas sit over the names, so a focus ring is never hidden behind one.
    expect(html).toMatch(/<div class="pointer-events-none absolute inset-0 z-\[2\]"><div data-anim="line:/);
  });

  it("marks a locked set with its lock and an unscored one with a muted fill and no edge", () => {
    const html = layoutOf(render(moved, "published"), "desktop");
    expect(html).toMatch(/data-set="larch"[^>]*>.*?title="Locked: this set stays put"/);
    expect(html).toMatch(/data-set="kauri" class="[^"]*\bbg-muted\b/);
    expect(html).not.toMatch(/data-set="kauri" class="[^"]*\bborder-border-strong\b/);
  });

  it("draws a mover that changes stage on its own row in each view", () => {
    const toHill: Raw = { ...LATER, stage_id: "hill", stage: "Hill", start: "16:30", end: "17:30", minutes_moved: 150, stage_changed: true, minutes_shared_after: 0 };
    const hill = model({ move: toHill });
    const moved = layoutOf(render(hill, "moved"), "desktop");
    const published = layoutOf(render(hill, "published"), "desktop");
    expect(moved).toContain('data-anim="mover@1"');
    expect(moved).not.toContain('data-anim="mover@0"');
    expect(published).toContain('data-anim="mover@0"');
    expect(published).not.toContain('data-anim="mover@1"');
    // The move leaves the chosen clash: no hatch and no line between the pair in the moved view.
    expect(moved).not.toContain("data-shared-window");
    expect(moved).not.toContain('data-thread="1"');
  });

  it("draws the published slot dashed only in the moved view", () => {
    expect(render(moved, "moved")).toContain("data-ghost");
    expect(render(moved, "published")).not.toContain("data-ghost");
  });

  it("draws an overlap the report does not rank in grey with its casing, never in Qloo teal, and marks it", () => {
    // Elm x Alder (rank 8) stands in for an overlap the side-effect line names but the report does not rank.
    const unranked: DayGraphModel = { ...moved, threads: moved.threads.map((thread) => (thread.rank === 8 ? { ...thread, ranked: false } : thread)) };
    const html = layoutOf(render(unranked, "published"), "desktop");
    const mark = html.match(/<div data-thread="8" data-unranked=""[^>]*>(.*?)<\/div>/)?.[1] ?? "";
    expect(mark).toContain("data-casing");
    expect(mark).toContain('stroke="var(--border-strong)"');
    expect(mark).not.toMatch(/prov-qloo|taste-quiet/);
    expect(html).toContain('data-hit="elm~alder" data-unranked=""');
    expect(lineColor(false, false, false)).toBe("var(--border-strong)");
    // Every ranked line keeps its teal.
    expect(layoutOf(render(moved, "published"), "desktop")).not.toContain("data-unranked");
  });
});

describe("DayGraph: the invented day", () => {
  const invented = model({ synthetic: true });

  it("has no Qloo colour and no Qloo credit, in either view", () => {
    for (const view of ["moved", "published"] as const) {
      const html = render(invented, view);
      expect(html).not.toMatch(/prov-qloo|taste-quiet/);
      expect(qlooCredits(decode(words(html)))).toEqual([]);
      expect(html).toContain('stroke="var(--foreground)"');
      expect(html).toContain('stroke="var(--border-strong)"');
    }
    expect(lineColor(true, true)).toBe("var(--foreground)");
    expect(lineColor(false, true)).toBe("var(--border-strong)");
    expect(lineColor(true, false)).toBe("var(--prov-qloo)");
    expect(lineColor(false, false)).toBe("var(--taste-quiet)");
  });

  it("names its view as invented and never calls its timetable published", () => {
    const html = decode(render(invented, "published"));
    expect(html).toContain(drawingTitle(invented, "published"));
    expect(drawingTitle(invented, "published")).toContain("invented timetable, without the move");
    expect(words(html)).not.toMatch(/published/i);
    expect(decode(render(invented, "moved"))).toContain("invented timetable, drawn with");
  });

  it("puts its key under the drawing in its own words", () => {
    const html = decode(renderToStaticMarkup(createElement(DayGraphKey, { model: invented })));
    expect(html).toBe(`<p data-day-graph-key="">${keyLine(invented)}</p>`);
    expect(html).toContain("invented taste overlap rank");
  });
});

describe("DayGraph: keyboard", () => {
  const moved = model();

  it("makes the drawn lines one tab stop per layout, starting on the chosen clash", () => {
    const html = render(moved, "moved");
    for (const layout of ["desktop", "phone", "short"] as const) {
      const stops = [...layoutOf(html, layout).matchAll(/data-hit="([^"]+)" tabindex="0"/g)].map((match) => match[1]);
      expect(stops).toEqual(["alder~birch"]);
    }
    const hits = [...layoutOf(html, "desktop").matchAll(/data-hit="([^"]+)" tabindex="(-?\d)" aria-label="([^"]*)"/g)];
    // Every drawn line, in rank order, named by its note.
    expect(hits.map((match) => match[1]).length).toBe(planDrawing(moved, "desktop").views.moved.lines.length);
    expect(decode(hits[0][3])).toMatch(/^#1 of 9 clashes as published: Alder × Birch, 45 min shared as published, 30 with the move/);
  });

  it("steps through the lines by rank with the arrows, jumps with Home and End, and holds at the ends", () => {
    const order = ["a", "b", "c"];
    expect(stepLine(order, "a", "ArrowRight")).toBe("b");
    expect(stepLine(order, "a", "ArrowDown")).toBe("b");
    expect(stepLine(order, "c", "ArrowRight")).toBe("c");
    expect(stepLine(order, "b", "ArrowLeft")).toBe("a");
    expect(stepLine(order, "b", "ArrowUp")).toBe("a");
    expect(stepLine(order, "a", "ArrowLeft")).toBe("a");
    expect(stepLine(order, "b", "Home")).toBe("a");
    expect(stepLine(order, "a", "End")).toBe("c");
    expect(stepLine(order, "a", "Tab")).toBeNull();
    expect(stepLine([], "a", "ArrowRight")).toBeNull();
  });

  it("closes the note with Escape and keeps focus on the line", () => {
    expect(lineKeyAction(["a", "b"], "a", "Escape")).toEqual({ focus: null, unpin: true });
    expect(lineKeyAction(["a", "b"], "a", "ArrowRight")).toEqual({ focus: "b", unpin: false });
    expect(lineKeyAction(["a", "b"], "a", "x")).toEqual({ focus: null, unpin: false });
  });

  it("gives every line a hit area of at least 44px, centred on it", () => {
    const html = layoutOf(render(moved, "moved"), "desktop");
    for (const button of html.match(/<button type="button" data-hit[^>]*>/g) ?? []) {
      expect(button).toContain("size-11.5");
      expect(button).toContain("top-1/2 left-0");
      expect(button).toContain("-translate-x-1/2 -translate-y-1/2");
    }
  });
});

describe("DayGraph: geometry and motion constants", () => {
  it("places the phone's detail window on the model's focus", () => {
    const moved = model();
    const html = layoutOf(render(moved, "moved"), "phone");
    const plan = planDrawing(moved, "phone");
    const length = plan.track.end - plan.track.start;
    const focus = moved.focus.end - moved.focus.start;
    expect(html).toContain(`width:${Math.round((length / focus) * 100 * 10000) / 10000}%`);
    expect(html).toContain(`translateX(-${Math.round(trackPct(plan.track, moved.focus.start) * 10000) / 10000}%)`);
  });

  it("moves with the house curve and duration from globals.css", () => {
    const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
    const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim();
    expect(token("--ease-move")).toBe(EASE_MOVE);
    expect(token("--dur-move")).toBe(`${MOVE_MS}ms`);
  });
});
