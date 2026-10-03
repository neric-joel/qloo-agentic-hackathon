import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PLAN_CAVEAT } from "@/lib/plan-copy";
import type { Preset } from "@/lib/preset";
import type { Plan, StackMove } from "@/lib/stack";

import { BudgetDial } from "./budget-dial";
import { BudgetMove } from "./budget-move";
import { ScratchPlan } from "./scratch-plan";

// Every name, id and figure below is invented for the test; none of it is Qloo data.

const RANGE = { low: 92.1568, high: 108.5582 };
const BASELINE = { samples: 300, mean_regret: 1, p10_index: 92.1568, p90_index: 108.5582, degenerate: false };

/** The static HTML as a reader gets it: tags removed, entities decoded, spaces collapsed. */
function textOf(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const PRESET = {
  id: "test-fest-sun",
  festival: {
    stages: [{ id: "north", name: "North Field", tier: 1, hours: [] }],
    timetable: [
      { act_id: "act-one", day: 0, stage_id: "north", start: 840, end: 900, locked: false },
      { act_id: "act-two", day: 0, stage_id: "north", start: 960, end: 1020, locked: false },
    ],
  },
} as unknown as Preset;

const MOVES: StackMove[] = [{ actId: "act-one", stageId: "north", day: 0, start: "14:30" }];

function planOf(budget: number, published = 116.71, afterFirst = budget): Plan {
  return {
    publishedBudget: published,
    budget,
    steps: [
      {
        act: "Act One",
        actId: "act-one",
        move: "Act One: moved",
        stage: "North Field",
        stageId: "north",
        day: 0,
        start: "14:30",
        end: "15:30",
        budgetAfter: afterFirst,
      },
    ],
    clashes: [{ a: "Act Two", b: "Act Three", points: 9.5 }],
    options: null,
  };
}

function card(plan: Plan) {
  return createElement(ScratchPlan, {
    preset: PRESET,
    day: 0,
    plan,
    moves: MOVES,
    range: RANGE,
    onUndo: () => {},
    onStartOver: () => {},
  });
}

describe("the plan card", () => {
  it("names the middle 80% and gives the gap when the plan sits just above it", () => {
    const text = textOf(card(planOf(109.3)));
    expect(text).toContain("The middle 80% of random valid timetables of this lineup score 92 to 109.");
    expect(text).toContain("This plan scores 0.3 index points above that range. The published timetable is 7.7 above it.");
    expect(text).not.toContain("For scale");
    expect(text).not.toMatch(/re-order/i);
  });

  it("says inside and below in the same place", () => {
    expect(textOf(card(planOf(100)))).toContain("This plan scores inside that range.");
    expect(textOf(card(planOf(80)))).toContain("This plan scores below that range.");
  });

  it("carries the caveat once", () => {
    const text = textOf(card(planOf(100)));
    expect(text.split(PLAN_CAVEAT)).toHaveLength(2);
  });

  it("marks a kept step that raises the index, and only that one", () => {
    expect(textOf(card(planOf(118, 116.71, 118)))).toContain("116.7 → 118.0 · raises the index");
    expect(textOf(card(planOf(100)))).not.toContain("raises the index");
  });
});

describe("the tested-move scale line", () => {
  it("leads with the middle 80% and no verdict when none is given", () => {
    const text = textOf(createElement(BudgetMove, { before: 116.7, after: 110.2, range: RANGE }));
    expect(text).toContain("The middle 80% of random valid timetables of this lineup score 92 to 109.");
    expect(text).not.toContain("This plan scores");
  });

  it("prints no scale line without a band", () => {
    const text = textOf(createElement(BudgetMove, { before: 116.7, after: 110.2, range: null }));
    expect(text).not.toContain("middle 80%");
  });
});

describe("the dial", () => {
  it("says random valid timetables in its caption and its description", () => {
    const html = renderToStaticMarkup(createElement(BudgetDial, { index: 116.71, baseline: BASELINE }));
    const text = textOf(createElement(BudgetDial, { index: 116.71, baseline: BASELINE }));
    expect(text).toContain("Shaded: the middle 80% of those random valid timetables (92 to 109).");
    expect(text).toContain("This day’s published timetable scores 117, above that range.");
    expect(html).toContain("the middle 80% of them score 92 to 109.");
    expect(html).toContain("average of random valid timetables of this lineup");
    expect(text).not.toMatch(/re-order/i);
  });
});
