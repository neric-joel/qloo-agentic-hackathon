import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { topClashes } from "@/lib/clashes";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset, type Evidence, type Preset, type PresetSummary } from "@/lib/preset";

import {
  HIDDEN_WALL_ID,
  HOME_ORDER,
  HomeSections,
  SOURCES_ID,
  borrowsWall,
  currentJump,
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

  it("lists the section nav in the same order, with the same numbering logic", () => {
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
