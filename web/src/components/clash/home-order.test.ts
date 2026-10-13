import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HIDDEN_WALL_ID, HOME_ORDER, HomeSections, SOURCES_ID, currentJump, jumpLinks } from "./clash-control";
import { TRY_A_MOVE_ID } from "./try-a-move";
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
