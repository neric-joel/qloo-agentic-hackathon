import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { topClashes } from "@/lib/clashes";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import type { Decision } from "@/lib/decision";
import { parsePreset, type Evidence, type Preset, type PresetSummary } from "@/lib/preset";

import {
  HIDDEN_WALL_ID,
  HOME_ORDER,
  HomeSections,
  SOURCES_ID,
  borrowsWall,
  currentJump,
  dayToDraw,
  jumpLinks,
  wallLenders,
} from "./clash-control";
import { KEEP_APART_ID, KEEP_APART_SUMMARY } from "./keep-apart";
import { TRY_A_MOVE_ID, TryAMove } from "./try-a-move";
import { WHAT_QLOO_ID } from "./why-qloo";
import { WHY_THIS_MATTERS_ID } from "./why-this-matters";

/** Each home section's anchor, as the section nav links to it. */
const ANCHORS: Record<(typeof HOME_ORDER)[number], string> = {
  qloo: WHAT_QLOO_ID,
  wall: HIDDEN_WALL_ID,
  why: WHY_THIS_MATTERS_ID,
  board: "board-heading",
  move: TRY_A_MOVE_ID,
  agent: "agent",
  sources: SOURCES_ID,
};

const agent = { href: "#agent", label: "Recorded runs" };
const qloo = { href: `#${WHAT_QLOO_ID}`, label: "What Qloo changes" };

describe("the home page's order", () => {
  it("puts Hidden clashes second, after What Qloo changes and before Why this matters and the timetable", () => {
    expect(HOME_ORDER).toEqual(["qloo", "wall", "why", "board", "move", "agent", "sources"]);
  });

  it("renders the sections in that order in the DOM, whatever order they are passed in", () => {
    const section = (key: string) => createElement("section", { id: ANCHORS[key as keyof typeof ANCHORS] });
    const html = renderToStaticMarkup(
      createElement(HomeSections, {
        sources: section("sources"),
        agent: section("agent"),
        move: section("move"),
        board: section("board"),
        why: section("why"),
        wall: section("wall"),
        qloo: section("qloo"),
      }),
    );
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(HOME_ORDER.map((key) => ANCHORS[key]));
  });

  it("lists the section nav in the same order, labels only", () => {
    const links = jumpLinks({ agent, wall: true, qloo });
    expect(links.map((link) => link.label)).toEqual([
      "What Qloo changes",
      "Hidden clashes",
      "Why this matters",
      "Timetable",
      "Try a move",
      "Recorded runs",
      "Sources",
    ]);
    expect(links.map((link) => link.href)).toEqual(HOME_ORDER.map((key) => `#${ANCHORS[key]}`));
    // A day without examples, or a card without its readings, drops only that entry; the rest keep their order.
    expect(jumpLinks({ agent, wall: false, qloo: null }).map((link) => link.label)).toEqual([
      "Why this matters",
      "Timetable",
      "Try a move",
      "Recorded runs",
      "Sources",
    ]);
  });

  it("draws the section nav with no numerals: each link is its label, with the one ink marker under the current one", () => {
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    const nav = source.slice(source.indexOf("function JumpNav("), source.indexOf("function LoadingView("));
    expect(nav).not.toBe("");
    // The label is the link's only content; no step number before it, in any face.
    expect(nav).toContain('<span data-nav-label="">{link.label}</span>');
    expect(nav).not.toMatch(/index \+ 1|type-numeral/);
    // The same links and the same marker (its round ends: a 3 px bar, clamped by the mark corner).
    expect(nav).toContain("rounded-bar bg-foreground");
    expect(nav).toContain('aria-current={on ? "location" : undefined}');
  });

  it("passes every section through HomeSections in the page itself", () => {
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    const view = source.slice(source.indexOf("<HomeSections"), source.indexOf("<ClashDrawer"));
    for (const key of HOME_ORDER) expect(view, key).toMatch(new RegExp(`\\n        ${key}=\\{`));
    for (const element of ["<TasteSection", "<HiddenWall", "<WhyThisMatters", "<BoardFrame", "<TryAMove", "<AgentPanel", "<PresetSources"]) {
      expect(view, element).toContain(element);
    }
    // Round 33 (H1): Keep two sets apart is no home section of its own; it lives inside Try a move.
    expect(view).not.toContain("<KeepApart");
    expect(HOME_ORDER).not.toContain("apart" as never);
  });

  it("keeps two sets apart inside Try a move, in one closed disclosure after the move's result, named for what it holds", () => {
    const preset = parsePreset(rawTinyPreset());
    const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
    const html = renderToStaticMarkup(createElement(TryAMove, { preset, day: 0, ranked, isLocked: () => false }));
    // Inside the Try a move section.
    expect(html.startsWith(`<section id="${TRY_A_MOVE_ID}"`)).toBe(true);
    const fold = /<details data-keep-apart-fold=""([^>]*)>([\s\S]*)<\/details>/.exec(html);
    expect(fold).not.toBeNull();
    // Closed on arrival: no open attribute.
    expect(fold?.[1]).not.toMatch(/\bopen\b/);
    // The summary says what is inside; the shared disclosure row (44px, the caret, the cobalt focus ring).
    expect(KEEP_APART_SUMMARY).toBe("Keep two sets apart: moves that end one overlap");
    expect(fold?.[2]).toMatch(new RegExp(`^<summary class="cc-disclosure-summary">${KEEP_APART_SUMMARY}<span aria-hidden="true" class="cc-disclosure-mark"></span></summary>`));
    // The section itself, its region name and its controls, unchanged inside the fold.
    expect(fold?.[2]).toContain(`<section id="${KEEP_APART_ID}"`);
    expect(fold?.[2]).toContain('aria-labelledby="keep-apart-heading"');
    expect(fold?.[2]).toContain('<h3 id="keep-apart-heading" class="sr-only">Keep two sets apart</h3>');
    expect(fold?.[2]).toContain("Find changes that end this overlap");
    expect(fold?.[2]).toMatch(/<p role="status" aria-live="polite" class="sr-only">/);
    // After the move's result (the picker and the tested place), and before the section's own status line.
    expect(html.indexOf("<details data-keep-apart-fold")).toBeGreaterThan(html.indexOf("data-move-picker"));
    expect(html.indexOf("<details data-keep-apart-fold")).toBeLessThan(html.lastIndexOf('<p role="status"'));
    expect(html.match(/<details data-keep-apart-fold/g)).toHaveLength(1);
    expect(html.match(new RegExp(`id="${KEEP_APART_ID}"`, "g"))).toHaveLength(1);
  });
});

describe("hidden-clash examples borrowed from another published day (round 32 scope, kept)", () => {
  const evidence = (n: number): Evidence => ({
    hidden_wall: Array.from({ length: n }, (_, i) => ({
      festival: "test-fest-2025",
      day: "Sun",
      acts: [`Act ${i}A`, `Act ${i}B`],
      genres: [["urn:tag:genre:indie"], ["urn:tag:genre:punk"]],
      overlap_pct: 0.9,
      draw_pct: 0.8,
      overlap_min: 30,
      source: null,
      shared_tags: [],
    })),
    hidden_wall_total: n,
    receipts: {},
    twins: [],
  });
  const day = (evidenceOf: Evidence | null, synthetic?: boolean): Pick<Preset, "evidence" | "synthetic"> =>
    ({ evidence: evidenceOf, synthetic }) as Pick<Preset, "evidence" | "synthetic">;

  it("borrows only for a published day with no examples of its own, never on the invented day or in mock mode", () => {
    expect(borrowsWall(day(null), false)).toBe(true);
    expect(borrowsWall(day(evidence(0)), false)).toBe(true);
    expect(borrowsWall(day(evidence(3)), false)).toBe(false);
    // The invented day credits nothing to Qloo, so it never shows a published day's examples.
    expect(borrowsWall(day(null, true), false)).toBe(false);
    // Mock mode never fetches another day.
    expect(borrowsWall(day(null), true)).toBe(false);
  });

  it("reads only other published days, never the day itself or the invented day", () => {
    const presets = [
      { id: "riot", title: "Riot", city: null, sets: 1, stages: 1, scored_share: 1, synthetic: false },
      { id: "glasto", title: "Glasto", city: null, sets: 1, stages: 1, scored_share: 1, synthetic: false },
      { id: "invented", title: "Invented", city: null, sets: 1, stages: 1, scored_share: 1, synthetic: true },
    ] as unknown as PresetSummary[];
    expect(wallLenders(presets, "riot")).toEqual(["glasto"]);
    expect(wallLenders(presets, "invented")).toEqual(["riot", "glasto"]);
  });
});

describe("the section nav's current entry", () => {
  const tops = (values: (number | null)[]) => values.map((top, i) => ({ href: `#s${i}`, top }));
  const view = { innerHeight: 900, scrollY: 2000, scrollHeight: 10000 };

  it("marks the last section whose top has passed 40% of the viewport, and none at the very top", () => {
    expect(currentJump(tops([-500, 200, 800]), view)).toBe("#s1");
    expect(currentJump(tops([500, 800, 1200]), { ...view, scrollY: 0 })).toBeNull();
  });

  it("marks the last section once the page is scrolled to its end, though its top never reaches the line", () => {
    const end = { innerHeight: 900, scrollY: 9100, scrollHeight: 10000 };
    expect(currentJump(tops([-3000, -800, 500]), end)).toBe("#s2");
    // Within 2 px of the end counts; 3 px short does not.
    expect(currentJump(tops([-3000, -800, 500]), { ...end, scrollY: 9098 })).toBe("#s2");
    expect(currentJump(tops([-3000, -800, 500]), { ...end, scrollY: 9097 })).toBe("#s1");
    // A missing last section does not take the mark.
    expect(currentJump(tops([-3000, -800, null]), end)).toBe("#s1");
  });
});

describe("switching festival day", () => {
  const glasto = { ...parsePreset(rawTinyPreset()), id: "glasto" } as Preset;
  const riot = { ...parsePreset(rawTinyPreset()), id: "riot" } as Preset;
  // Only the decision's identity matters here: the page passes it on to the day's view untouched.
  const glastoDecision = { day: 0 } as unknown as Decision;
  const riotDecision = { day: 0 } as unknown as Decision;

  it("draws the first day as soon as its preset is in, with the decision the page holds or none", () => {
    expect(dayToDraw(null, undefined, null)).toBeNull();
    expect(dayToDraw(glasto, glastoDecision, null)).toEqual({ preset: glasto, decision: glastoDecision });
    // No decision in the server HTML: the day's own view asks for it, as it always has.
    expect(dayToDraw(glasto, undefined, null)).toEqual({ preset: glasto, decision: null });
  });

  it("holds the day drawn, the same object, while the chosen day's preset or decision is on its way", () => {
    const drawn = { preset: glasto, decision: glastoDecision };
    // The chosen day's preset has not come.
    expect(dayToDraw(null, undefined, drawn)).toBe(drawn);
    // Its preset is in, its decision is not.
    expect(dayToDraw(riot, undefined, drawn)).toBe(drawn);
    // The day drawn chosen again (another copy of its preset) changes nothing.
    expect(dayToDraw({ ...glasto } as Preset, glastoDecision, drawn)).toBe(drawn);
  });

  it("replaces the day drawn in one step once the chosen day's preset and decision are both in", () => {
    const drawn = { preset: glasto, decision: glastoDecision };
    expect(dayToDraw(riot, riotDecision, drawn)).toEqual({ preset: riot, decision: riotDecision });
    // A day whose route gave no decision is drawn with none, not held.
    expect(dayToDraw(riot, null, drawn)).toEqual({ preset: riot, decision: null });
    // Back to the first day: its decision is still known, so it is drawn at once.
    const back = { preset: riot, decision: riotDecision };
    expect(dayToDraw(glasto, glastoDecision, back)).toEqual(drawn);
  });

  it("never draws a loading view on a switch, and its picker names the day drawn", () => {
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    const control = source.slice(source.indexOf("export function ClashControl("), source.indexOf("/** The festival-day tabs' group name"));
    expect(control).not.toBe("");
    // The loading view only before any day is drawn; after that the day drawn is held whole.
    expect(control).toContain("const shown = dayToDraw(chosen, chosenDecision, drawn);");
    expect(control).toContain("if (shown === null || list.status !== \"ready\") {");
    expect(control).toContain("key={shown.preset.id}");
    expect(control).toContain("selectedId={shown.preset.id}");
    // The other days are read ahead once a day is drawn, with GETs of saved files only.
    const ahead = source.slice(source.indexOf("async function readDayAhead("), source.indexOf("export function ClashControl("));
    expect(ahead).toContain("fetch(`/api/presets/${encodeURIComponent(id)}`");
    expect(ahead).toContain("requestDecision(preset.id, day, signal)");
    expect(ahead).not.toMatch(/method:|whatif|price-grid|\/pair|\/runs/);
  });
});
