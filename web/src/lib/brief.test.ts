import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BriefContent } from "@/components/brief/brief-sheet";
import BriefPage, { metadata } from "@/app/brief/page";

import {
  BRIEF_CLASHES,
  HOW_TO_READ,
  HIDDEN_NOTE,
  NO_MOVES,
  READING_NOTE,
  TO_DECIDE,
  bandSentence,
  baselineNote,
  comparisonPairNote,
  briefRows,
  briefSteps,
  briefTitle,
  briefTradeoff,
  clashesCaption,
  clashesTitle,
  coverageSentence,
  dayFigures,
  formatIndex,
  hiddenNames,
  hiddenSentence,
  indexSentence,
  isBriefRuleStep,
  planClashLines,
  planClashesTitle,
  planSummary,
  planVerdictSentence,
  savedDate,
  sourceHosts,
  stageChangeText,
  heavyPlan,
  tableClashes,
  tableOnPaper,
  type BriefStep,
} from "./brief";
import { buildDecisionCopy, parseDecision } from "./decision";
import { PLAN_CAVEAT } from "./plan-copy";
import type { PairClash, Preset, SetSlot } from "./preset";
import type { Plan, PlanRuleStep, PlanStep, StackStep } from "./stack";

// Every name, id, tag and figure below is invented for the test; none of it is Qloo data.

const STAGES = [
  { id: "north", name: "North Field", tier: 1, hours: [] },
  { id: "south", name: "South Tent", tier: 2, hours: [] },
  { id: "barn", name: "The Barn", tier: 3, hours: [] },
];

type ActRow = [id: string, name: string, popularity: number | null];

const ACTS: ActRow[] = [
  ["act-one", "Act One", 0.8874],
  ["act-two", "Act Two", 0.9123],
  ["act-three", "Act Three", 0.7712],
  ["act-four", "Act Four", 0.9969],
  ["act-five", "Act Five", 0.6611],
  ["act-six", "Act Six", 0.9931],
  ["act-seven", "Act Seven", 0.5544],
  ["act-eight", "Act Eight", null],
];

function slot(act_id: string, stage_id: string, start: number, end: number, locked = false, day = 0): SetSlot {
  return { act_id, day, stage_id, start, end, locked };
}

const TIMETABLE: SetSlot[] = [
  slot("act-one", "north", 840, 900),
  slot("act-two", "south", 855, 915),
  slot("act-three", "barn", 870, 930),
  slot("act-four", "north", 1110, 1170),
  slot("act-five", "south", 1110, 1140),
  slot("act-six", "north", 1305, 1365, true),
  slot("act-seven", "south", 1305, 1365, true),
  slot("act-eight", "barn", 600, 660, false, 1),
];

const NAMES = new Map(ACTS.map(([id, name]) => [id, name]));
const STAGE_OF = new Map(TIMETABLE.map((item) => [item.act_id, item.stage_id]));

function clash(
  rank: number,
  a: string,
  b: string,
  figures: { overlap: number; draw: number; share: number; minutes: number; label?: "hidden" | "false"; day?: number },
): PairClash {
  const side = (id: string) => ({ act_id: id, name: NAMES.get(id) ?? id, stage_id: STAGE_OF.get(id) ?? "north", genre: "Rock" });
  return {
    rank,
    a: side(a),
    b: side(b),
    day: figures.day ?? 0,
    overlap_minutes: figures.minutes,
    concurrency: 1,
    audience_overlap: figures.overlap,
    draw: figures.draw,
    regret: figures.share,
    regret_share: figures.share,
    label: figures.label ?? null,
    confidence: "strong",
  };
}

/** Ranks are stored out of order on purpose: the brief must sort them. */
const CLASHES: PairClash[] = [
  clash(3, "act-two", "act-three", { overlap: 0.7712, draw: 0.8511, share: 0.0811, minutes: 45 }),
  clash(1, "act-one", "act-two", { overlap: 0.9865, draw: 0.8874, share: 0.29, minutes: 45, label: "hidden" }),
  clash(2, "act-four", "act-five", { overlap: 0.9189, draw: 0.9969, share: 0.1534, minutes: 30, label: "hidden" }),
  clash(4, "act-six", "act-seven", { overlap: 0.6892, draw: 0.9892, share: 0.0353, minutes: 60, label: "false" }),
  clash(5, "act-one", "act-three", { overlap: 0.4114, draw: 0.6611, share: 0.0302, minutes: 30, label: "hidden" }),
  clash(6, "act-four", "act-six", { overlap: 0.3, draw: 0.5, share: 0.01, minutes: 15 }),
  clash(7, "act-eight", "act-one", { overlap: 0.95, draw: 0.9, share: 0.2, minutes: 60, label: "hidden", day: 1 }),
];

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: "test-fest-sun",
    title: "Test Fest 2026, Sunday",
    built_at: "2026-09-30T12:00:00+00:00",
    festival: {
      id: "test-fest",
      name: "Test Fest 2026, Sun",
      city: null,
      days: ["Sun", "Mon"],
      stages: STAGES,
      acts: ACTS.map(([id, name, popularity]) => ({
        id,
        name,
        qloo_id: popularity === null ? null : `urn:entity:test-${id}`,
        popularity,
        genre: "Rock",
        billing_tier: 2,
      })),
      timetable: TIMETABLE,
    },
    report: {
      metrics: { regret: 1, clash_budget_index: 116.71, scored_concurrent_pairs: 7, unscored_concurrent_pairs: 1 },
      baseline: { samples: 300, mean_regret: 1, p10_index: 92.1568, p90_index: 108.5582, degenerate: false },
      clashes: CLASHES,
      hidden_clash_count: 4,
      thresholds: { hidden_overlap: 0.9, false_overlap: 0.2 },
      coverage: {
        strong: 6,
        weak: 1,
        none: 1,
        scored_acts: 7,
        scored_share: 0.875,
        unscored: [{ act_id: "act-eight", name: "Act Eight", reason: "no_signal" }],
        weak_act_ids: ["act-seven"],
      },
      movability: null,
    },
    requests: [],
    sources: [
      { url: "https://www.example.com/lineup/sunday", accessed: "2026-09-29" },
      { url: "https://www.example.com/lineup/monday", accessed: null },
      { url: "https://times.example.org/set-times", accessed: null },
    ],
    overlap_notes: [],
    evidence: {
      hidden_wall: [],
      hidden_wall_total: 0,
      receipts: { "act-one|act-two": { shared_tags: [{ name: "Zydeco Revival", kind: "genre", score: 0.8123 }], press: null } },
      twins: [],
    },
    ...overrides,
  };
}

function step(actId: string, act: string, stage: string, stageId: string, start: string, end: string, budgetAfter: number): PlanStep {
  return { act, actId, move: `${act}: moved`, stage, stageId, day: 0, start, end, budgetAfter };
}

const PLAN: Plan = {
  publishedBudget: 116.71,
  budget: 106.62,
  steps: [
    step("act-one", "Act One", "North Field", "north", "14:30", "15:30", 110.24),
    step("act-four", "Act Four", "North Field", "north", "18:15", "19:15", 108.03),
    step("act-five", "Act Five", "The Barn", "barn", "18:30", "19:00", 106.62),
  ],
  clashes: [{ a: "Act Two", b: "Act Three", points: 9.5 }],
  options: null,
};

/** A plan whose second step raises the index (110.2 to 111.0). */
const RAISING_PLAN: Plan = {
  ...PLAN,
  budget: 108.4,
  steps: [
    PLAN.steps[0],
    { ...PLAN.steps[1], budgetAfter: 110.96 },
    { ...PLAN.steps[2], budgetAfter: 108.4 },
  ],
};

/** The sheet as a reader gets it: the static HTML with its tags removed. */
function sheetText(preset: Preset, plan: Plan | null, day = 0): string {
  return renderToStaticMarkup(createElement(BriefContent, { preset, day, plan }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

describe("brief rows", () => {
  it("lists the day's costliest clashes in rank order, at most five", () => {
    const rows = briefRows(makePreset(), 0);
    expect(BRIEF_CLASHES).toBe(5);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(briefRows(makePreset(), 0, 3).map((row) => row.rank)).toEqual([1, 2, 3]);
    // The other day's clash never appears.
    expect(briefRows(makePreset(), 0, 10).some((row) => row.a === "Act Eight" || row.b === "Act Eight")).toBe(false);
    expect(briefRows(makePreset(), 1).map((row) => row.rank)).toEqual([7]);
  });

  it("prints every figure through the timetable page's formatters, out of 100", () => {
    const [first, second, third] = briefRows(makePreset(), 0);
    expect(first).toEqual({
      rank: 1,
      a: "Act One",
      b: "Act Two",
      stageA: "North Field",
      stageB: "South Tent",
      window: "14:15–15:00",
      minutes: 45,
      overlap: "99",
      draw: "89",
      share: "29%",
      hidden: true,
      bothLocked: false,
    });
    expect(second).toMatchObject({ overlap: "92", draw: "100", share: "15%", window: "18:30–19:00" });
    expect(third).toMatchObject({ overlap: "77", draw: "85", share: "8.1%", hidden: false });
  });

  it("marks a clash between two locked sets, and only that one", () => {
    const rows = briefRows(makePreset(), 0);
    expect(rows.find((row) => row.rank === 4)).toMatchObject({ bothLocked: true, hidden: false, share: "3.5%" });
    expect(rows.filter((row) => row.bothLocked).map((row) => row.rank)).toEqual([4]);
  });

  it("names the day's hidden clashes in rank order", () => {
    expect(hiddenNames(makePreset(), 0)).toEqual(["Act One and Act Two", "Act Four and Act Five", "Act One and Act Three"]);
    expect(hiddenSentence(hiddenNames(makePreset(), 0))).toBe(
      "3 of this day’s ranked clashes are hidden clashes: Act One and Act Two; Act Four and Act Five; Act One and Act Three.",
    );
    expect(hiddenSentence(["Act One and Act Two"])).toBe(
      "1 of this day’s ranked clashes is a hidden clash: Act One and Act Two.",
    );
    expect(hiddenSentence([])).toBeNull();
  });
});

describe("the day's figures", () => {
  it("reads the index, the random range and coverage from the report", () => {
    expect(dayFigures(makePreset())).toEqual({
      index: 116.71,
      range: { low: 92.1568, high: 108.5582 },
      scored: 7,
      total: 8,
      unpriced: 1,
    });
  });

  it("has no range without a baseline, and no index when the report has none", () => {
    const preset = makePreset();
    const bare = makePreset({
      report: { ...preset.report, baseline: null, metrics: { ...preset.report.metrics, clash_budget_index: null } },
    });
    expect(dayFigures(bare)).toMatchObject({ index: null, range: null });
    expect(indexSentence(null)).toMatch(/^This day has no Clash Budget Index/);
    expect(indexSentence(116.71)).toBe("Clash Budget Index 116.7.");
    expect(formatIndex(91)).toBe("91.0");
  });

  it("says how many sets are priced, with and without unscored acts", () => {
    expect(coverageSentence(dayFigures(makePreset()))).toBe(
      "Taste overlap is priced for 7 of 8 sets; 1 has no usable Qloo signal and is not priced.",
    );
    expect(coverageSentence({ scored: 36, total: 39, unpriced: 3 })).toBe(
      "Taste overlap is priced for 36 of 39 sets; 3 have no usable Qloo signal and are not priced.",
    );
    expect(coverageSentence({ scored: 12, total: 12, unpriced: 0 })).toBe("Taste overlap is priced for all 12 sets.");
  });

  it("places the index below, inside or above the middle 80%, as the page prints them", () => {
    const range = { low: 92.1568, high: 108.5582 };
    expect(bandSentence(116.71, range)).toBe(
      "The middle 80% of random valid timetables of this lineup score 92 to 109; the published timetable reads above that range.",
    );
    expect(bandSentence(100, range)).toMatch(/reads inside that range\.$/);
    // 108.6 prints inside "92 to 109", so it reads inside.
    expect(bandSentence(108.6, range)).toMatch(/reads inside that range\.$/);
    expect(bandSentence(86.48, range)).toMatch(/reads below that range\.$/);
    expect(bandSentence(100, null)).toBeNull();
  });

  it("titles the brief with the festival and the day in words", () => {
    expect(briefTitle(makePreset(), 0)).toEqual({ festival: "Test Fest 2026", day: "Sunday" });
    expect(briefTitle(makePreset(), 1)).toEqual({ festival: "Test Fest 2026", day: "Monday" });
  });
});

describe("how many published-day clashes the table lists", () => {
  const move = (n: number): BriefStep => ({
    n,
    act: "A",
    place: "P",
    shift: "s",
    before: "1.0",
    after: "0.9",
    raises: false,
    receipt: null,
  });
  const change = (n: number): BriefStep => ({ n, line: "L", before: "1.0", after: "0.9", raises: false, receipt: "r" });

  it("lists five, as the brief always did, for no steps, one move or one kept change", () => {
    expect(tableClashes([], 1)).toBe(5);
    expect(tableClashes([move(1)], 1)).toBe(5);
    expect(tableClashes([change(1)], 1)).toBe(5);
    expect(heavyPlan([move(1)], 1)).toBe(false);
  });

  it("lists three when the kept steps would take the sheet to the foot of a Letter page", () => {
    // Measured with headless Chrome: seven single moves with five rows ran to 99% of a Letter page.
    expect(tableClashes([move(1), move(2)], 1)).toBe(3);
    expect(tableClashes([change(1), move(2)], 1)).toBe(3);
    expect(tableClashes([change(1), change(2), change(3)], 1)).toBe(3);
    expect(tableClashes([move(1), move(2), move(3), move(4)], 2)).toBe(3);
    expect(tableClashes([0, 1, 2, 3, 4, 5].map((i) => move(i + 1)), 2)).toBe(3);
    expect(tableClashes([move(1), move(2), move(3), move(4), change(5), change(6)], 2)).toBe(3);
    expect(tableClashes([0, 1, 2, 3, 4, 5, 6, 7].map((i) => move(i + 1)), 2)).toBe(3);
    // The same plans give up the list of hidden clashes on paper too.
    expect(heavyPlan([move(1), move(2)], 1)).toBe(true);
    expect(heavyPlan([0, 1, 2, 3, 4, 5, 6, 7].map((i) => move(i + 1)), 2)).toBe(true);
  });

  it("gives up rows to the side-by-side comparison: it lists one, and none are printed for a plan of three lines or more", () => {
    // With the comparison the published day's table lists one clash, whatever the plan.
    expect(tableClashes([move(1)], 1, true)).toBe(1);
    expect(tableClashes([change(1), move(2)], 1, true)).toBe(1);
    expect(tableClashes([change(1), move(2), move(3), move(4), move(5)], 2, true)).toBe(1);
    expect(tableClashes([0, 1, 2, 3, 4, 5, 6, 7].map((i) => move(i + 1)), 2, true)).toBe(1);
    // On paper: a move alone keeps its one row; a kept change (three lines), or a move and another step, leaves it to the screen.
    expect(tableOnPaper([move(1)], 1, true)).toBe(true);
    expect(tableOnPaper([change(1)], 1, true)).toBe(false);
    expect(tableOnPaper([move(1), move(2)], 1, true)).toBe(false);
    expect(tableOnPaper([change(1), move(2), move(3), move(4), move(5)], 2, true)).toBe(false);
    // Without the comparison the table is always printed.
    expect(tableOnPaper([change(1), change(2), change(3)], 1, false)).toBe(true);
    expect(tableOnPaper([], 1, false)).toBe(true);
    // Without the comparison the plan's length decides.
    expect(tableClashes([change(1), move(2), move(3), move(4), move(5)], 2)).toBe(3);
    expect(clashesTitle(1, true)).toBe("The costliest clash on the published day, before these moves");
    expect(clashesTitle(2, true)).toBe("The two costliest clashes on the published day, before these moves");
  });

  it("says how many it lists in the heading", () => {
    expect(clashesTitle(3, true)).toBe("The three costliest clashes on the published day, before these moves");
  });
});

describe("the plan's verdict in the brief", () => {
  const band = { low: 92.1568, high: 108.5582 };

  it("states the band in the same sentence, since the plan is read before the day's own band", () => {
    expect(planVerdictSentence({ publishedBudget: 116.71, budget: 109.3 }, band)).toBe(
      "The middle 80% of random valid timetables of this lineup score 92 to 109; this plan scores 0.3 index points above that range. By this index, the published timetable sits 7.7 points above that range.",
    );
    expect(planVerdictSentence({ publishedBudget: 116.71, budget: 100 }, band)).toBe(
      "The middle 80% of random valid timetables of this lineup score 92 to 109; this plan scores inside that range.",
    );
    expect(planVerdictSentence({ publishedBudget: 116.71, budget: 100 }, null)).toBeNull();
  });

  it("states a raised index as a fact, never as a plan that scores well", () => {
    const sentence = planVerdictSentence({ publishedBudget: 86.5, budget: 88.8 }, band) ?? "";
    expect(sentence).toBe(
      "This plan’s index is 88.8, 2.3 higher than the published timetable’s 86.5. The middle 80% of random valid timetables of this lineup score 92 to 109.",
    );
    expect(sentence).not.toMatch(/good|better|improve|scores below that range/i);
  });
});

describe("kept moves", () => {
  it("sums up the plan from the server's two readings", () => {
    expect(planSummary(PLAN)).toBe("3 kept moves: Clash Budget Index 116.7 → 106.6, 10.1 lower.");
    expect(planSummary({ ...PLAN, steps: PLAN.steps.slice(0, 1), budget: 110.24 })).toBe(
      "1 kept move: Clash Budget Index 116.7 → 110.2, 6.5 lower.",
    );
    expect(planSummary({ ...PLAN, budget: 117.33 })).toMatch(/116\.7 → 117\.3, 0\.6 higher\.$/);
    expect(planSummary({ ...PLAN, budget: 116.74 })).toMatch(/116\.7 → 116\.7, no change\.$/);
  });

  it("words each step as the plan card does, with the index before and after it", () => {
    expect(briefSteps(makePreset(), PLAN)).toEqual([
      {
        n: 1,
        act: "Act One",
        place: "North Field 14:30–15:30",
        shift: "30 minutes later, same stage",
        before: "116.7",
        after: "110.2",
        raises: false,
        receipt: null,
      },
      {
        n: 2,
        act: "Act Four",
        place: "North Field 18:15–19:15",
        shift: "15 minutes earlier, same stage",
        before: "110.2",
        after: "108.0",
        raises: false,
        receipt: null,
      },
      {
        n: 3,
        act: "Act Five",
        place: "The Barn 18:30–19:00",
        shift: "Moves to The Barn, 18:30",
        before: "108.0",
        after: "106.6",
        raises: false,
        receipt: null,
      },
    ]);
  });

  it("marks a step that raises the index, compared as printed", () => {
    const steps = briefSteps(makePreset(), RAISING_PLAN);
    expect(steps.map((item) => item.raises)).toEqual([false, true, false]);
  });

  it("titles the tables before and with the moves", () => {
    expect(clashesTitle(5)).toBe("The five costliest clashes");
    expect(clashesTitle(1)).toBe("The costliest clash");
    expect(clashesTitle(5, true)).toBe("The five costliest clashes on the published day, before these moves");
    expect(planClashesTitle(5)).toBe("The five costliest clashes with these moves");
    expect(planClashesTitle(3)).toBe("The three costliest clashes with these moves");
    expect(planClashesTitle(1)).toBe("The costliest clash with these moves");
  });

  it("lists the moved timetable's clashes with the server's index points", () => {
    expect(planClashLines(PLAN)).toEqual(["1. Act Two and Act Three · 9.5 index points"]);
    expect(planClashLines({ clashes: [] })).toEqual([]);
  });
});

describe("the footer", () => {
  it("dates the saved data and lists each source host once", () => {
    expect(savedDate(makePreset())).toBe("2026-09-30");
    expect(savedDate(makePreset({ built_at: null }))).toBeNull();
    expect(savedDate(makePreset({ built_at: "not a date" }))).toBeNull();
    expect(sourceHosts(makePreset())).toEqual(["example.com", "times.example.org"]);
  });
});

describe("the brief sheet", () => {
  it("prints the exact copy, with no moves kept", () => {
    const text = sheetText(makePreset(), null);
    expect(text).toContain("Clash brief · Test Fest 2026, Sunday");
    expect(text).toContain("Test Fest 2026 Sunday: where the clash budget goes");
    expect(text).toContain("Scored by this app from the published timetable. Test Fest 2026 does not use Clash Control.");
    expect(text).toContain(
      "Clash Budget Index 116.7. The middle 80% of random valid timetables of this lineup score 92 to 109; the published timetable reads above that range.",
    );
    expect(text).toContain("The five costliest clashes");
    expect(text).not.toContain("before these moves");
    expect(text).not.toContain("with these moves");
    expect(text).toContain("Time shared");
    expect(text).not.toMatch(/Overlap in time/);
    expect(HIDDEN_NOTE).toBe(
      "Hidden clashes: the two acts’ main genre tags differ, but their taste overlap is among this lineup’s highest.",
    );
    expect(text).toContain(`${HIDDEN_NOTE} ${READING_NOTE}`);
    expect(READING_NOTE).toBe("A reading, not a verdict on the festival.");
    expect(text).toContain("both locked");
    expect(text).toContain(NO_MOVES);
    expect(text).not.toContain(PLAN_CAVEAT);
    for (const line of HOW_TO_READ) expect(text).toContain(line);
    expect(text).toContain(
      "Figures are calculated by this app from Qloo audience data saved 2026-09-30. This is an independent hackathon entry, not endorsed by Qloo or Test Fest 2026. Prepared for visitors and judges of this demo; not for redistribution.",
    );
    expect(text).toContain("Timetable sources: example.com, times.example.org.");
  });

  it("prints the kept moves and the caveat word for word", () => {
    const text = sheetText(makePreset(), PLAN);
    expect(text).toContain("3 kept moves: Clash Budget Index 116.7 → 106.6, 10.1 lower.");
    expect(text).toContain("1. Act One · North Field 14:30–15:30 30 minutes later, same stage · 116.7 → 110.2");
    expect(text).toContain(
      "Scored by the same measure the places are found with, so a lower number shows what that measure rewards, not that audiences would be better served. It knows only the rules in the timetable, not an act’s own wishes.",
    );
    expect(text).not.toContain(NO_MOVES);
  });

  it("leads with the plan, then the plan's own clashes and the line to decide, then the unmoved day", () => {
    const text = sheetText(makePreset(), PLAN);
    const plan = text.indexOf("Your plan");
    const verdict = text.indexOf("this plan scores");
    const steps = text.indexOf("1. Act One");
    const own = text.indexOf("The costliest clash with these moves");
    const decide = text.indexOf(TO_DECIDE);
    const day = text.indexOf("The day Clash Budget Index 116.7");
    const before = text.indexOf("The three costliest clashes on the published day, before these moves");
    expect(plan).toBeGreaterThan(-1);
    for (const [earlier, later] of [
      [plan, verdict],
      [verdict, steps],
      [steps, own],
      [own, decide],
      [decide, day],
      [day, before],
    ]) {
      expect(earlier).toBeGreaterThan(-1);
      expect(later).toBeGreaterThan(earlier);
    }
    expect(text).toContain("1. Act Two and Act Three · 9.5 index points");
    expect(text).not.toContain("Tested moves");
    // Not a bare "The five costliest clashes" heading over the unmoved table.
    expect(text).not.toMatch(/The five costliest clashes (?!on the published day)/);
  });

  it("says what the page cannot weigh, and only with moves", () => {
    expect(TO_DECIDE).toBe(
      "To decide: keep the published times, or make the moves above. This page shows what each does to the day’s clashes by this app’s measure; it does not weigh contracts, riders or stage fit.",
    );
    expect(sheetText(makePreset(), PLAN)).toContain(TO_DECIDE);
    expect(sheetText(makePreset(), null)).not.toContain("To decide");
  });

  it("prints no type under 9 pt and one column of steps up to three moves", () => {
    const html = renderToStaticMarkup(createElement(BriefContent, { preset: makePreset(), day: 0, plan: PLAN }));
    const sizes = [...html.matchAll(/print:text-\[([\d.]+)pt\]/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(9);
    expect(html).not.toMatch(/print:size-\[[1-8]pt\]/);
  });

  it("marks a kept step that raises the index", () => {
    const text = sheetText(makePreset(), RAISING_PLAN);
    expect(text).toContain("110.2 → 111.0 · raises the index");
    expect(text.match(/raises the index/g)).toHaveLength(1);
    expect(sheetText(makePreset(), PLAN)).not.toContain("raises the index");
  });

  it("leaves out tags, entity ids, raw popularity and every way to take the page away", () => {
    for (const plan of [null, PLAN]) {
      const html = renderToStaticMarkup(createElement(BriefContent, { preset: makePreset(), day: 0, plan }));
      const text = sheetText(makePreset(), plan);
      expect(text).not.toContain("Zydeco");
      expect(text).not.toMatch(/urn:|entity|test-act/i);
      // No decimal between 0 and 1: taste overlap, draw and popularity print out of 100.
      expect(text).not.toMatch(/(^|[^\d.])0\.\d/);
      for (const act of ACTS) if (act[2] !== null) expect(text).not.toContain(String(act[2]));
      expect(html).not.toMatch(/download|mailto:|clipboard|share (this|the|a) |copy (the |a )?link|e-?mail/i);
      expect(text).not.toMatch(/matrix|request id/i);
      expect(text).not.toMatch(/for your festival|deliverable|certificate|report for the festival/i);
    }
  });

  it("omits the hidden-clash block on a day without hidden clashes", () => {
    const preset = makePreset();
    const plain = makePreset({
      report: { ...preset.report, clashes: preset.report.clashes.map((item) => ({ ...item, label: null })) },
    });
    const text = sheetText(plain, null);
    expect(text).not.toContain("ranked clashes are hidden clashes");
    expect(text).not.toMatch(/Hidden clashes Hidden/);
  });
});

describe("/brief page", () => {
  it("is titled and kept out of search engines", () => {
    expect(metadata.title).toBe("Clash brief");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("hides the site header and footer only when printing", () => {
    const html = renderToStaticMarkup(createElement(BriefPage));
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(style).toMatch(/@media print/);
    expect(style).toMatch(/body > header, body > footer/);
    expect(style.indexOf("display: none")).toBeGreaterThan(style.indexOf("@media print"));
  });
});

// ----------------------------------------------------------------------------- kept changes

function ruleStep(budgetAfter: number, extra: Partial<PlanRuleStep> = {}): PlanRuleStep {
  return {
    rule: { a: { actId: "act-one", act: "Act One" }, b: { actId: "act-two", act: "Act Two" } },
    moves: [
      {
        act: "Act Two",
        actId: "act-two",
        move: "Act Two: South Tent 14:15-15:15 -> The Barn 15:30-16:30",
        stage: "The Barn",
        stageId: "barn",
        day: 0,
        start: "15:30",
        end: "16:30",
      },
      {
        act: "Act Three",
        actId: "act-three",
        move: "Act Three: The Barn 14:30-15:30 -> South Tent 14:15-15:15",
        stage: "South Tent",
        stageId: "south",
        day: 0,
        start: "14:15",
        end: "15:15",
      },
    ],
    budgetAfter,
    ruleHoldsAfter: true,
    newBreaks: 0,
    ...extra,
  };
}

/** Four single moves and two kept changes, the fullest plan one page must hold. */
const MIXED_PLAN: Plan = {
  publishedBudget: 116.71,
  budget: 100.12,
  steps: [
    PLAN.steps[0],
    ruleStep(111.85),
    PLAN.steps[1],
    PLAN.steps[2],
    ruleStep(103.3, { rule: { a: { actId: "act-four", act: "Act Four" }, b: { actId: "act-five", act: "Act Five" } } }),
    step("act-six", "Act Six", "North Field", "north", "21:00", "22:00", 100.12),
  ],
  clashes: PLAN.clashes,
  options: null,
};

describe("kept changes in the brief", () => {
  it("sums up a plan with a kept change as steps, and a plan of moves as before", () => {
    expect(planSummary(MIXED_PLAN)).toBe("6 kept steps: Clash Budget Index 116.7 → 100.1, 16.6 lower.");
    expect(planSummary({ ...MIXED_PLAN, steps: [ruleStep(111.85)], budget: 111.85 })).toBe(
      "1 kept step: Clash Budget Index 116.7 → 111.8, 4.9 lower.",
    );
    expect(planSummary(PLAN)).toBe("3 kept moves: Clash Budget Index 116.7 → 106.6, 10.1 lower.");
  });

  it("words a kept change as one numbered step with its index and the server receipt", () => {
    const steps = briefSteps(makePreset(), MIXED_PLAN);
    expect(steps).toHaveLength(6);
    const second = steps[1];
    expect(isBriefRuleStep(second)).toBe(true);
    expect(second).toEqual({
      n: 2,
      line: "Change to keep Act One and Act Two apart: Act Two → The Barn 15:30–16:30; Act Three → South Tent 14:15–15:15",
      before: "110.2",
      after: "111.8",
      raises: true,
      receipt: "Confirmed: after this plan they share no time, and the plan adds no rule break.",
    });
    // A single move keeps its own shape.
    expect(isBriefRuleStep(steps[0])).toBe(false);
    expect(steps[0]).toMatchObject({ n: 1, act: "Act One", before: "116.7", after: "110.2" });
  });

  it("prints a kept change, its index and its receipt in Your plan", () => {
    const text = sheetText(makePreset(), MIXED_PLAN);
    expect(text).toContain(
      "2. Change to keep Act One and Act Two apart: Act Two → The Barn 15:30–16:30; Act Three → South Tent 14:15–15:15 110.2 → 111.8 · raises the index · Confirmed: after this plan they share no time, and the plan adds no rule break.",
    );
    expect(text).toContain("1. Act One · North Field 14:30–15:30 30 minutes later, same stage · 116.7 → 110.2");
    expect(text).toContain("6 kept steps: Clash Budget Index 116.7 → 100.1, 16.6 lower.");
    expect(text).not.toContain(NO_MOVES);
  });

  it("prints the receipt as the server gave it when the pair still shares time or a break was added", () => {
    const still: Plan = { ...PLAN, steps: [ruleStep(108, { ruleHoldsAfter: false })], budget: 108 };
    expect(sheetText(makePreset(), still)).toContain("Not confirmed: after this plan they still share time.");
    const broken: Plan = { ...PLAN, steps: [ruleStep(108, { newBreaks: 2 })], budget: 108 };
    expect(sheetText(makePreset(), broken)).toContain("After this plan they share no time, but the plan adds 2 rule breaks.");
  });

  it("keeps print type at 9 pt or more with four moves and two kept changes", () => {
    const html = renderToStaticMarkup(createElement(BriefContent, { preset: makePreset(), day: 0, plan: MIXED_PLAN }));
    const sizes = [...html.matchAll(/print:text-\[([\d.]+)pt\]/g)].map((match) => Number(match[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(9);
    expect(html).toContain("print:columns-2");
  });

  it("uses none of the words the round forbids in a kept change", () => {
    const text = sheetText(makePreset(), MIXED_PLAN);
    for (const pattern of [/optimi[sz]/i, /improve/i, /recommend/i, /validated/i, /\bfix/i, /\bbest\b/i]) {
      expect(text).not.toMatch(pattern);
    }
  });
});


// ------------------------------------------------------------------------------------ the trade-off

/** A decision on the test festival: the card's move is Act Two to The Barn at 14:30, its change moves Act Three. */
function decisionRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const where = (act_id: string, act: string, stage_id: string, stage: string, start: string, end: string) => ({
    act_id,
    act,
    from: "North Field 14:15-15:15",
    stage_id,
    stage,
    day: 0,
    start,
    end,
    minutes_moved: 15,
  });
  return {
    kind: "decision",
    day: 0,
    skipped_locked: 0,
    skipped_no_place: 0,
    clash: { a_id: "act-one", b_id: "act-two", rank: 1, minutes: 45 },
    published_budget: 116.71,
    move: {
      ...where("act-two", "Act Two", "barn", "The Barn", "14:30", "15:30"),
      legal_places: 5,
      stage_changed: true,
      budget_after: 110.2,
      minutes_shared_after: 30,
      same_index_alternative: null,
      stage_fit_flags_now: 1,
      stage_fit_flags_after: 2,
      costliest_after: { a: "Act Four", b: "Act Five", minutes: 30, points: 9.5 },
    },
    rule: {
      kind: "rule_fixes",
      a: { act_id: "act-one", act: "Act One", locked: false, place: "North Field 14:00-15:00" },
      b: { act_id: "act-two", act: "Act Two", locked: false, place: "South Tent 14:15-15:15" },
      rule: "Act One and Act Two must not overlap",
      shared_minutes: 45,
      holds: false,
      single_set_places: 0,
      fixes_found: 1,
      searched: "x",
      fixes: [
        {
          sets_moved: 2,
          minutes_moved: 75,
          stage_changes: 0,
          budget_after: 112.4,
          stage_fit_flags_now: 1,
          stage_fit_flags_after: 1,
          minutes_shared_after: 0,
          costliest_after: { a: "Act Two", b: "Act Three", minutes: 45, points: 8.1 },
          moves: [
            where("act-one", "Act One", "north", "North Field", "15:15", "16:15"),
            where("act-three", "Act Three", "barn", "The Barn", "13:45", "14:45"),
          ],
        },
      ],
    },
    ...overrides,
  };
}

const CARD_MOVE: StackStep = { actId: "act-two", stageId: "barn", day: 0, start: "14:30" };
const CARD_CHANGE: StackStep = {
  rule: { aId: "act-one", bId: "act-two" },
  moves: [
    { actId: "act-one", stageId: "north", day: 0, start: "15:15" },
    { actId: "act-three", stageId: "barn", day: 0, start: "13:45" },
  ],
};
const OTHER_MOVE: StackStep = { actId: "act-four", stageId: "north", day: 0, start: "18:15" };

describe("the brief's trade-off", () => {
  it("is carried only when the plan holds the card's move or the card's change", () => {
    const preset = makePreset();
    const decision = parseDecision(decisionRaw());
    const both = briefTradeoff(preset, decision, [OTHER_MOVE, CARD_MOVE, CARD_CHANGE], 0);
    expect(both?.held).toEqual({ move: true, change: true });
    expect(briefTradeoff(preset, decision, [CARD_MOVE], 0)?.held).toEqual({ move: true, change: false });
    expect(briefTradeoff(preset, decision, [CARD_CHANGE, OTHER_MOVE], 0)?.held).toEqual({ move: false, change: true });
    expect(briefTradeoff(preset, decision, [OTHER_MOVE], 0)).toBeNull();
    expect(briefTradeoff(preset, decision, [], 0)).toBeNull();
    // A near miss is not the card's move: same set and stage, another start.
    expect(briefTradeoff(preset, decision, [{ ...CARD_MOVE, start: "14:45" }], 0)).toBeNull();
  });

  it("says the figures are each change tested alone when the plan holds more than one step", () => {
    const preset = makePreset();
    const decision = parseDecision(decisionRaw());
    const one = briefTradeoff(preset, decision, [CARD_MOVE], 0)!;
    expect(one.alone).toBe(false);
    expect(one.tradeoff.heading).toBe("The two changes side by side");
    const more = briefTradeoff(preset, decision, [CARD_MOVE, OTHER_MOVE], 0)!;
    expect(more.alone).toBe(true);
    expect(more.tradeoff.heading).toBe("The two changes, tested alone, not your whole plan");
    // The sentence under the heading and the line under the table are the brief's.
    expect(more.tradeoff.subtitle).toMatch(/^Each change tested alone on the published day/);
    expect(more.tradeoff.footnote).toBe("Weigh this reading; the plan receipt above is what your plan does.");
  });

  it("gives the card's move a receipt only for a plan that is just that move", () => {
    const preset = makePreset();
    const decision = parseDecision(decisionRaw());
    const one = briefTradeoff(preset, decision, [CARD_MOVE], 0)!;
    expect(one.moveReceipt?.receipt).toBe("Act One and Act Two share 30 minutes after this plan.");
    const plan = { ...PLAN, steps: PLAN.steps.slice(0, 1) };
    // Act One is the plan's first step in the fixture; the card's move is Act Two, so no step matches.
    expect(briefSteps(preset, plan, one.moveReceipt)[0]).toMatchObject({ receipt: null });
    const cardPlan = {
      ...PLAN,
      steps: [{ ...PLAN.steps[0], act: "Act Two", actId: "act-two", stage: "The Barn", stageId: "barn", start: "14:30", end: "15:30" }],
    };
    expect(briefSteps(preset, cardPlan, one.moveReceipt)[0]).toMatchObject({
      receipt: "Act One and Act Two share 30 minutes after this plan.",
    });
    // Two steps: the figure belongs to the move alone, so there is no receipt line.
    const two = { ...cardPlan, steps: [...cardPlan.steps, PLAN.steps[1]] };
    expect(briefSteps(preset, two, one.moveReceipt)[0]).toMatchObject({ receipt: null });
  });

  it("prints no stage-fit row, since the brief does not weigh stage fit; the card's own table keeps it (round 31)", () => {
    const preset = makePreset();
    const decision = parseDecision(decisionRaw());
    const card = buildDecisionCopy(preset, decision)?.tradeoff;
    expect(card?.rows.map((row) => row.id)).toContain("flags");
    const brief = briefTradeoff(preset, decision, [CARD_MOVE], 0)!;
    expect(brief.tradeoff.rows.map((row) => row.id)).toEqual(card!.rows.map((row) => row.id).filter((id) => id !== "flags"));
    const html = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan: PLAN, tradeoff: brief }));
    expect(html).not.toMatch(/stage-fit flags/i);
    // What the page says it does not weigh stays word for word.
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain(TO_DECIDE);
  });

  it("is absent without a decision, for another day's decision, and when the card has nothing to compare", () => {
    const preset = makePreset();
    expect(briefTradeoff(preset, null, [CARD_MOVE], 0)).toBeNull();
    expect(briefTradeoff(preset, parseDecision(decisionRaw()), [CARD_MOVE], 1)).toBeNull();
    expect(briefTradeoff(preset, parseDecision(decisionRaw({ rule: null })), [CARD_MOVE], 0)).toBeNull();
  });

  it("labels the table as tested alone when the plan holds more steps, and keeps the plan's own receipts first and larger", () => {
    const preset = makePreset();
    const tradeoff = briefTradeoff(preset, parseDecision(decisionRaw()), [CARD_MOVE, OTHER_MOVE], 0);
    const html = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan: PLAN, tradeoff }));
    const plain = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/\s+/g, " ");
    // The plan's heading, its summary and its steps come before the table, which says it is not the plan.
    const order = ["Your plan", "3 kept moves", "1. Act One", "The two changes, tested alone, not your whole plan", "Each change tested alone on the published day"];
    const at = order.map((part) => plain.indexOf(part));
    at.forEach((position, i) => {
      expect(position, order[i]).toBeGreaterThan(-1);
      if (i > 0) expect(position).toBeGreaterThan(at[i - 1]);
    });
    expect(plain).toContain("Weigh this reading; the plan receipt above is what your plan does.");
    expect(plain.indexOf("Weigh this reading")).toBeGreaterThan(plain.indexOf("Costliest clash after"));
    // The heading is kept on paper when the table is tested alone; the plan summary is the larger type.
    expect(html).toMatch(/<h3[^>]*print:text-\[9pt\][^>]*>The two changes, tested alone/);
    expect(html).toMatch(/<p class="[^"]*text-lg[^"]*font-bold[^"]*">3 kept moves/);
    // Three single steps with the comparison: the published day's table stays on the screen only.
    const tableSection = html.match(/<section[^>]*aria-labelledby="brief-[^"]*on-the-published-day[^"]*"[^>]*>/)?.[0] ?? "";
    expect(tableSection).toContain("print:hidden");
    const bare = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan: PLAN }));
    expect(bare.match(/<section[^>]*aria-labelledby="brief-[^"]*on-the-published-day[^"]*"[^>]*>/)?.[0] ?? "").not.toContain("print:hidden");
    // A table about the plan's one step keeps the plain heading, which stays off paper.
    const one = briefTradeoff(preset, parseDecision(decisionRaw()), [CARD_MOVE], 0);
    const single = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan: PLAN, tradeoff: one }));
    expect(single).not.toContain("tested alone, not your whole plan");
    expect(single).toMatch(/<h3[^>]*print:sr-only[^>]*>The two changes side by side/);
  });

  it("prints the card's receipt under the one step of a plan that is just the card's move", () => {
    const preset = makePreset();
    const tradeoff = briefTradeoff(preset, parseDecision(decisionRaw()), [CARD_MOVE], 0);
    const plan: Plan = {
      ...PLAN,
      steps: [{ ...PLAN.steps[0], act: "Act Two", actId: "act-two", stage: "The Barn", stageId: "barn", start: "14:30", end: "15:30" }],
    };
    const html = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan, tradeoff }));
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("Act One and Act Two share 30 minutes after this plan.");
    const none = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan }));
    expect(none).not.toContain("after this plan.");
  });

  it("prints the same comparison as the card, under the plan and before its caveat, and none without it", () => {
    const preset = makePreset();
    const tradeoff = briefTradeoff(preset, parseDecision(decisionRaw()), [CARD_MOVE], 0);
    const html = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan: PLAN, tradeoff }));
    const plain = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/\s+/g, " ");
    const order = ["Your plan", "The two changes side by side", "Move one set · In your plan", "Keep the two apart", PLAN_CAVEAT];
    const at = order.map((part) => plain.indexOf(part));
    at.forEach((position, i) => {
      expect(position, order[i]).toBeGreaterThan(-1);
      if (i > 0) expect(position).toBeGreaterThan(at[i - 1]);
    });
    expect(plain).toContain("116.7 → 110.2");
    expect(plain).toContain("116.7 → 112.4");
    expect(plain).toContain("Act Four and Act Five, 30 minutes, 9.5 index points");
    expect(plain).toContain("Selected and scored by this app’s index");
    // Prints compact on paper, with no fixed-width cell.
    expect(html).toContain("print:table");
    expect(html).not.toMatch(/w-\[\d+px\]|min-w-\[/);
    // One step is light enough to keep the list of hidden clashes on paper when there is no comparison.
    const oneStep: Plan = { ...PLAN, steps: PLAN.steps.slice(0, 1) };
    const without = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan: oneStep }));
    expect(without).not.toContain("The two changes side by side");
    // The list of hidden clashes gives its place on paper to the comparison, and stays on the screen.
    expect(html).toMatch(/<section[^>]*class="[^"]*print:hidden[^"]*"[^>]*aria-labelledby="brief-hidden-clashes"|<section[^>]*aria-labelledby="brief-hidden-clashes"[^>]*class="[^"]*print:hidden/);
    expect(without).not.toMatch(/aria-labelledby="brief-hidden-clashes"[^>]*class="[^"]*print:hidden/);
  });
});

describe("the printed baseline", () => {
  const preset = makePreset();

  it("names the published day's costliest clash and counts the rest when no table is on paper", () => {
    // Day 0 ranks six clashes; the costliest is Act One and Act Two, 29% of the 116.71 index (33.8 points).
    expect(baselineNote(preset, 0, { rows: 0, hiddenListed: false })).toBe(
      "Published day before these moves: costliest Act One and Act Two, a hidden clash, 33.8 index points; 5 more on the timetable page (2 hidden).",
    );
    expect(baselineNote(preset, 0, { rows: 0, hiddenListed: true })).toBe(
      "Published day before these moves: costliest Act One and Act Two, a hidden clash, 33.8 index points; 5 more on the timetable page.",
    );
  });

  it("says how many clashes a shortened table leaves off, and counts the hidden ones it leaves off", () => {
    expect(baselineNote(preset, 0, { rows: 1, hiddenListed: false })).toBe(
      "5 more clashes of the published day are not listed here (2 hidden); the full list is on the timetable page.",
    );
    expect(baselineNote(preset, 0, { rows: 3, hiddenListed: true })).toBe(
      "3 more clashes of the published day are not listed here; the full list is on the timetable page.",
    );
    expect(baselineNote(preset, 0, { rows: 6, hiddenListed: false })).toBeNull();
    expect(baselineNote(preset, 5, { rows: 0, hiddenListed: false })).toBeNull();
  });

  it("is printed on paper only, for a plan that leaves the table or the hidden list off the page", () => {
    const html = (plan: Plan, tradeoff = briefTradeoff(preset, parseDecision(decisionRaw()), [CARD_MOVE, OTHER_MOVE], 0)) =>
      renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan, tradeoff }));
    const heavy = html(PLAN);
    expect(heavy).toMatch(/<p class="[^"]*hidden[^"]*print:block[^"]*">Published day before these moves: costliest Act One and Act Two/);
    // A light plan (one step, no comparison) keeps the five rows and the hidden list: nothing to say.
    const light = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan: { ...PLAN, steps: PLAN.steps.slice(0, 1) } }));
    expect(light).not.toContain("Published day before these moves");
    expect(light).not.toContain("are not listed here");
    // No moves at all: the brief is the published day, no baseline note.
    expect(renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan: null }))).not.toContain("Published day before");
  });

  it("says when the comparison's pair is not the day's costliest pair, and only then", () => {
    // The card's pair is the costliest one here: no note.
    expect(briefTradeoff(preset, parseDecision(decisionRaw()), [CARD_MOVE], 0)?.pairNote).toBeNull();
    // A decision for the rank-2 pair (the costliest is between sets that cannot move): the note names both.
    const other = decisionRaw({ clash: { a_id: "act-four", b_id: "act-five", rank: 2, minutes: 30 }, skipped_locked: 1 });
    const decision = parseDecision(other);
    expect(comparisonPairNote(preset, decision!)).toBe(
      "The comparison is about Act Four and Act Five, the costliest clash with a set that can move. The published day’s costliest clash is Act One and Act Two.",
    );
    const tradeoff = briefTradeoff(preset, decision, [CARD_MOVE], 0);
    const text = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan: PLAN, tradeoff }))
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/\s+/g, " ");
    if (tradeoff) expect(text).toContain("The comparison is about Act Four and Act Five");
  });
});

describe("the brief's table caption and stage changes (round 32, V7)", () => {
  it("says costliest first only when there are two rows or more to order", () => {
    expect(clashesCaption(5)).toBe("The five costliest clashes on this day, costliest first");
    expect(clashesCaption(2, true)).toBe("The two costliest clashes on the published day, before these moves, costliest first");
    expect(clashesCaption(1)).toBe("The costliest clash on this day");
    expect(clashesCaption(1, true)).toBe("The costliest clash on the published day, before these moves");
  });

  it("names a change that moves a set to another stage, for production to sign off", () => {
    expect(stageChangeText(0, 2)).toBeNull();
    expect(stageChangeText(1, 1)).toBe("changes stage: needs production sign-off");
    expect(stageChangeText(2, 2)).toBe("both change stage: needs production sign-off");
    expect(stageChangeText(3, 3)).toBe("all change stage: needs production sign-off");
    expect(stageChangeText(1, 2)).toBe("one changes stage: needs production sign-off");
    expect(stageChangeText(2, 3)).toBe("two change stage: needs production sign-off");
  });

  it("says so in the comparison's Sets moved row, in the column whose change moves a stage, and nowhere else", () => {
    const preset = makePreset();
    // The fixture's card move changes stage; its keep-apart change does not.
    const moved = briefTradeoff(preset, parseDecision(decisionRaw()), [CARD_MOVE], 0)!;
    const sets = moved.tradeoff.rows.find((row) => row.id === "sets")!;
    expect(sets.move).toBe("1 (Act Two); changes stage: needs production sign-off");
    expect(sets.rule).toBe("2 (Act One and Act Three)");
    for (const row of moved.tradeoff.rows.filter((r) => r.id !== "sets")) {
      expect(`${row.move} ${row.rule}`).not.toContain("sign-off");
    }
    // A keep-apart change that moves both sets to other stages says so in its own column.
    const raw = decisionRaw();
    const rule = raw.rule as { fixes: Record<string, unknown>[] };
    const both = decisionRaw({
      move: { ...(raw.move as Record<string, unknown>), stage_changed: false },
      rule: { ...rule, fixes: [{ ...rule.fixes[0], stage_changes: 2 }] },
    });
    const keep = briefTradeoff(preset, parseDecision(both), [CARD_MOVE], 0)!;
    const keepSets = keep.tradeoff.rows.find((row) => row.id === "sets")!;
    expect(keepSets.move).toBe("1 (Act Two)");
    expect(keepSets.rule).toBe("2 (Act One and Act Three); both change stage: needs production sign-off");
    // The card's own table is untouched: the note is the brief's.
    const card = buildDecisionCopy(preset, parseDecision(both))?.tradeoff;
    expect(card?.rows.find((row) => row.id === "sets")?.rule).toBe("2 (Act One and Act Three)");
  });
});
