import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BriefContent } from "@/components/brief/brief-sheet";
import BriefPage, { metadata } from "@/app/brief/page";

import {
  BRIEF_CLASHES,
  BRIEF_HEADING_TAIL,
  DECISION_CHOICES,
  DECISION_INITIALS,
  HOW_TO_READ,
  HIDDEN_NOTE,
  INDEX_MEANING,
  NO_MOVES,
  READING_NOTE,
  TO_DECIDE,
  bandSentence,
  baselineNote,
  candidateLine,
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
  noPricedClashes,
  onPaper,
  planClashLines,
  planClashesTitle,
  planSummary,
  planVerdictSentence,
  savedDate,
  sharedMinutes,
  sharedMinutesSentence,
  sourceHosts,
  stageChangeText,
  heavyPlan,
  tableClashes,
  tableOnPaper,
  FIGURE_FRAMES,
  briefFigure,
  briefLockLine,
  figureOnPaper,
  layoutFigure,
  textWidth,
  type BriefFigure,
  type BriefStep,
} from "./brief";
import { LOCK_RULE, LOCK_RULE_GENERIC } from "./locks";
import { qlooCredits } from "./credit";
import { buildDecisionCopy, parseDecision } from "./decision";
import type { Lenses } from "./lenses";
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

  it("says how many sets are scored, with and without unscored acts (round 33: 'scored', as the index is; round 36: 'not scored')", () => {
    expect(coverageSentence(dayFigures(makePreset()))).toBe(
      "Taste overlap is scored for 7 of 8 sets; 1 has no usable Qloo signal and is not scored.",
    );
    expect(coverageSentence({ scored: 36, total: 39, unpriced: 3 })).toBe(
      "Taste overlap is scored for 36 of 39 sets; 3 have no usable Qloo signal and are not scored.",
    );
    expect(coverageSentence({ scored: 12, total: 12, unpriced: 0 })).toBe("Taste overlap is scored for all 12 sets.");
    // The invented day's variant, in the same words (round 36).
    expect(coverageSentence({ scored: 2, total: 3, unpriced: 1 }, true)).toBe("Taste overlap is invented for 2 of 3 sets; 1 is not scored.");
    expect(coverageSentence({ scored: 1, total: 3, unpriced: 2 }, true)).toBe("Taste overlap is invented for 1 of 3 sets; 2 are not scored.");
    for (const synthetic of [false, true]) {
      for (const unpriced of [0, 1, 3]) {
        expect(coverageSentence({ scored: 12 - unpriced, total: 12, unpriced }, synthetic)).not.toMatch(/\bpric(e|ed|es|ing)\b/i);
      }
    }
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

  it("says what a reading above 100 means in one constant, from /method's reading of the index, and never as a verdict (round 39, W5)", () => {
    expect(INDEX_MEANING).toBe(
      "Above 100, the day’s shared minutes cost more, by this reading, than in the average random valid timetable of this lineup: one kind of cost, not a verdict on how the festival was programmed.",
    );
    // One kind of cost, in minutes of the timetable: no audience, money or attendance word, and no source credited.
    expect(INDEX_MEANING).not.toMatch(/attend|people|fans|crowd|audience|revenue|money|\$|£|qloo/i);
    // The words the sheet already prints stay byte for byte: the reading note and the "How to read this" block.
    expect(READING_NOTE).toBe("A reading, not a verdict on the festival.");
    expect(HOW_TO_READ).toEqual([
      "Taste overlap is calculated by this app from Qloo data: how highly Qloo ranks each act for the other’s audience, as a rank among the acts compared for this bill, 0 to 100. It measures taste, not attendance.",
      "Combined draw is the two acts’ Qloo popularity, 0 to 100.",
      "The Clash Budget Index is 100 for the average random valid timetable of this lineup; lower is better. It counts only what clashes cost: taste overlap, time shared, draw and a rarity factor. It is a reading, not a verdict on the festival: real programming weighs much more than taste overlap.",
    ]);
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
    expect(text).toContain("Test Fest 2026 Sunday: where the clashes fall");
    expect(text).not.toContain("clash budget goes");
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

  it("prints what a reading above 100 means in the day's own paragraph, right after the band sentence, and before the coverage sentence (round 39, W5)", () => {
    const band =
      "The middle 80% of random valid timetables of this lineup score 92 to 109; the published timetable reads above that range.";
    for (const plan of [null, PLAN]) {
      const text = sheetText(makePreset(), plan);
      expect(text).toContain(
        `The day Clash Budget Index 116.7. ${band} ${INDEX_MEANING} Taste overlap is scored for 7 of 8 sets`,
      );
      // Said once, never apart from the day's figures.
      expect(text.split(INDEX_MEANING)).toHaveLength(2);
    }
    // The same words on the invented day, which credits no Qloo.
    const invented = sheetText(makePreset({ synthetic: true }), null);
    expect(invented).toContain(`${band} ${INDEX_MEANING}`);
    expect(qlooCredits(invented)).toEqual([]);
  });

  it("prints it only when the day has an index, and straight after the index sentence when the day has no range (round 39, W5)", () => {
    const preset = makePreset();
    const noIndex = makePreset({
      report: { ...preset.report, baseline: null, metrics: { ...preset.report.metrics, clash_budget_index: null } },
    });
    expect(sheetText(noIndex, null)).not.toContain(INDEX_MEANING);
    expect(sheetText(noIndex, null)).not.toContain("Above 100");
    const noRange = makePreset({ report: { ...preset.report, baseline: null } });
    expect(sheetText(noRange, null)).toContain(`The day Clash Budget Index 116.7. ${INDEX_MEANING} Taste overlap is scored`);
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

  it("prints no type under 9.5 pt, its running text at 10 pt, and one column of steps up to three moves (round 37)", () => {
    const html = renderToStaticMarkup(createElement(BriefContent, { preset: makePreset(), day: 0, plan: PLAN }));
    const sizes = printSizes(html);
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(9.5);
    expect(html).not.toMatch(/print:size-\[(?:[1-8](?:\.\d+)?|9)pt\]/);
    // The sheet's own text is 10 pt on paper; the drawing's caption, a shared component, is set from the sheet.
    expect(html).toMatch(/<article [^>]*class="[^"]*print:text-\[10pt\] print:leading-\[1\.15\]/);
    expect(html).toMatch(/<figure data-brief-figure="" class="[^"]*print:\[&amp;_figcaption\]:text-\[9\.5pt\]/);
    // The drawing's labels print at the wide frame's printFont, set from the sheet: at least 9.5 pt on the A4 column
    // (190 mm) the frame is drawn for, and 3% more on Letter. The stage names move down to stay centred on their bars,
    // 0.35 of each unit they grow, as the drawing centres them (round 37, L75).
    const figureClass = html.match(/<figure data-brief-figure="" class="([^"]*)"/)?.[1].replace(/&amp;/g, "&").split(" ") ?? [];
    const { font, printFont, width } = FIGURE_FRAMES.wide;
    expect(figureClass).toContain(`print:[&_svg[data-frame=wide]]:text-[${printFont}px]`);
    expect(figureClass).toContain(`print:[&_svg[data-frame=wide]_[data-stage]]:translate-y-[${+((printFont - font) * 0.35).toFixed(3)}px]`);
    expect(printFont * ((190 * 96) / 25.4 / width) * 0.75).toBeGreaterThanOrEqual(9.5);
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

  it("keeps print type at 9.5 pt or more with four moves and two kept changes (round 37)", () => {
    const html = renderToStaticMarkup(createElement(BriefContent, { preset: makePreset(), day: 0, plan: MIXED_PLAN }));
    expect(Math.min(...printSizes(html))).toBeGreaterThanOrEqual(9.5);
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
    // On this sheet the comparison prints at the sheet's sizes (round 37): its sentences and heading at 10 pt, its
    // table at 9.5 pt, set on the comparison from the sheet.
    const compare = html.match(/<section aria-labelledby="[^"]*" class="([^"]*)"><h3/)?.[1].replace(/&amp;/g, "&").split(" ") ?? [];
    for (const name of ["print:[&_p]:text-[10pt]", "print:[&_h3]:text-[10pt]", "print:[&_table]:text-[9.5pt]", "print:[&_th]:text-[9.5pt]", "print:[&_td]:text-[9.5pt]"]) {
      expect(compare).toContain(name);
    }
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

// ------------------------------------------------------------------------------------ round 33 (E6)

/** The day's two rankings, invented: Act Four and Act Six fall furthest once taste counts (#2 to #6). */
function lensesFor(day = 0, overrides: Partial<Lenses> = {}): Lenses {
  return {
    day,
    ranked: 5,
    with_taste: [],
    without_taste: [
      { a: "Act Two", b: "Act Three", a_id: "act-two", b_id: "act-three", rank: 1, rank_with_taste: 2 },
      { a: "Act Four", b: "Act Six", a_id: "act-four", b_id: "act-six", rank: 2, rank_with_taste: 6 },
      { a: "Act One", b: "Act Three", a_id: "act-one", b_id: "act-three", rank: 3, rank_with_taste: 4 },
    ],
    only_with_taste: 1,
    only_without_taste: 1,
    apart: [],
    ...overrides,
  };
}

/** The sheet's HTML, with lenses and an optional comparison. */
/**
 * The sheet's own printed sizes: every `print:text-[…pt]` class outside the drawing, a shared component whose caption
 * the sheet sets from outside (`print:[&_figcaption]:text-[9.5pt]` on the figure).
 */
function printSizes(html: string): number[] {
  const own = html.replace(/<figure data-brief-figure=""[\s\S]*?<\/figure>/g, "");
  return [...own.matchAll(/print:text-\[([\d.]+)pt\]/g)].map((match) => Number(match[1]));
}

function sheetHtml(preset: Preset, plan: Plan | null, extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan, ...extra }));
}

function plainOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the brief's title and the index's words (round 33)", () => {
  it("says where the clashes fall, with no money word", () => {
    expect(BRIEF_HEADING_TAIL).toBe("where the clashes fall");
    for (const plan of [null, PLAN]) {
      const html = sheetHtml(makePreset(), plan);
      expect(html).toMatch(/<h1 id="brief-heading"[^>]*>Test Fest 2026 Sunday: where the clashes fall<\/h1>/);
      expect(plainOf(html)).not.toMatch(/clash budget goes|is priced for|None priced|priced clashes/);
    }
  });

  it("says a day with no clash has no scored clash, on both kinds of day", () => {
    expect(noPricedClashes(false)).toBe("No scored clashes on this day: no two acts with a Qloo signal play at the same time.");
    expect(noPricedClashes(true)).toBe("No scored clashes on this day: no two scored acts play at the same time.");
    const empty = makePreset({ report: { ...makePreset().report, clashes: [] } });
    expect(plainOf(sheetHtml(empty, null))).toContain(noPricedClashes(false));
  });
});

describe("the candidate to keep (round 33)", () => {
  const LINE = "Taste also lowers: Act Four × Act Six ranks #2 on time and draw, #6 with taste: a candidate to keep.";

  it("words the pair taste overlap lowers furthest by its two ranks, and only ranks", () => {
    const pair = { a: "Act Four", b: "Act Six", from: 2, to: 6 };
    expect(candidateLine(pair)).toBe(LINE);
    expect(candidateLine(pair, true)).toBe(
      "On this invented day, taste also lowers: Act Four × Act Six ranks #2 on time and draw, #6 with taste: a candidate to keep.",
    );
    for (const line of [candidateLine(pair), candidateLine(pair, true)]) {
      expect(line).not.toMatch(/Qloo|attend|people|fans|crowd/i);
    }
  });

  it("is printed under the published day's table, after its notes, from the day's own rankings", () => {
    const html = sheetHtml(makePreset(), null, { lenses: lensesFor() });
    const text = plainOf(html);
    expect(text).toContain(LINE);
    expect(text.indexOf(LINE)).toBeGreaterThan(text.indexOf(READING_NOTE));
    expect(text.indexOf(LINE)).toBeLessThan(text.indexOf("How to read this"));
    // Inside the table's block, on paper as on the screen, in the sheet's own ink: no colour of its own.
    const block = html.match(/<section aria-labelledby="brief-the-five-costliest-clashes"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(block).toContain(`<p data-candidate="true" class="mt-1 text-sm print:mt-[1pt] print:text-[10pt] print:leading-[1.15]">${LINE}</p>`);
    // With a plan it stays under the published day's table, before the plan's moves.
    const withPlan = plainOf(sheetHtml(makePreset(), PLAN, { lenses: lensesFor() }));
    expect(withPlan.indexOf(LINE)).toBeGreaterThan(withPlan.indexOf("before these moves"));
  });

  it("is left out without the rankings, for another day's rankings, and when no pair falls", () => {
    const none = (lenses: Lenses | null) => plainOf(sheetHtml(makePreset(), null, { lenses }));
    expect(none(null)).not.toContain("a candidate to keep");
    expect(none(lensesFor(1))).not.toContain("a candidate to keep");
    expect(
      none(lensesFor(0, { without_taste: [{ a: "Act Two", b: "Act Three", a_id: "act-two", b_id: "act-three", rank: 1, rank_with_taste: 1 }] })),
    ).not.toContain("a candidate to keep");
    expect(plainOf(sheetHtml(makePreset(), null))).not.toContain("a candidate to keep");
  });

  it("credits no Qloo on the invented day, with a plan and its minutes and decision lines on the sheet", () => {
    const invented = makePreset({ synthetic: true });
    const text = plainOf(sheetHtml(invented, PLAN, { lenses: lensesFor() }));
    expect(text).toContain("On this invented day, taste also lowers: Act Four × Act Six ranks #2 on time and draw");
    expect(text).toContain("Shared minutes in the published day’s 6 ranked clashes");
    expect(text).toContain(DECISION_CHOICES);
    expect(qlooCredits(text)).toEqual([]);
  });
});

describe("the decision line beside each kept step (round 33)", () => {
  it("is the head of programming's choice to circle and a line for initials, on paper only", () => {
    expect(DECISION_CHOICES).toBe("Decision: move / keep as published / kept on purpose");
    expect(DECISION_INITIALS).toBe("Initials:");
    const html = sheetHtml(makePreset(), PLAN);
    const marks = html.match(/<span data-decision="true"[^>]*>[\s\S]*?<\/span><\/span>/g) ?? [];
    expect(marks).toHaveLength(PLAN.steps.length);
    for (const mark of marks) {
      // Never on the screen; on paper it sits to the right of its step's first line, in the step's muted ink.
      expect(mark).toMatch(/class="hidden text-muted-foreground print:text-\[10pt\] print:float-right print:ml-\[10pt\] print:block"/);
      expect(plainOf(mark)).toBe(`${DECISION_CHOICES} ${DECISION_INITIALS}`);
      // The line to write on is a 1px rule in the control-edge ink, as the sign-off's are: a mark, never a box.
      expect(mark).toContain('<span class="inline-block w-[40pt] border-b border-border-strong"></span>');
    }
    // Inside each step, before its first line, so it floats beside it.
    const steps = html.match(/<li class="min-w-0 break-inside-avoid">[\s\S]*?<\/li>/g) ?? [];
    expect(steps).toHaveLength(PLAN.steps.length);
    for (const step of steps) expect(step.indexOf("data-decision")).toBeLessThan(step.indexOf("font-semibold"));
    expect(sheetHtml(makePreset(), null)).not.toContain("data-decision");
  });

  it("takes its own line under each step in two columns, and leaves paper when the steps run long", () => {
    const four: Plan = {
      ...PLAN,
      steps: [...PLAN.steps, step("act-six", "Act Six", "North Field", "north", "21:00", "22:00", 105)],
    };
    const html = sheetHtml(makePreset(), four);
    const marks = html.match(/<span data-decision="true"[^>]*>/g) ?? [];
    expect(marks).toHaveLength(4);
    for (const mark of marks) expect(mark).toBe('<span data-decision="true" class="hidden text-muted-foreground print:text-[10pt] print:block">');
    const steps = html.match(/<li class="min-w-0 break-inside-avoid print:mb-\[2pt\]">[\s\S]*?<\/li>/g) ?? [];
    for (const item of steps) expect(item.indexOf("data-decision")).toBeGreaterThan(item.indexOf("font-semibold"));
    // Five single moves in two columns: the decision lines are the second thing left off paper.
    const five: Plan = { ...four, steps: [...four.steps, step("act-seven", "Act Seven", "South Tent", "south", "21:00", "22:00", 104)] };
    expect(sheetHtml(makePreset(), five)).not.toContain("data-decision");
  });
});

describe("the shared minutes of a plan (round 33)", () => {
  const preset = makePreset();

  it("counts one fixed set, the published day's ranked clashes, before and with the plan", () => {
    // Day 0 ranks six clashes; on the published timetable they share 45 + 30 + 45 + 60 + 30 + 0 minutes (the
    // last pair is on one stage, so it shares none). PLAN moves Act One onto Act Three's times and shortens nothing.
    expect(sharedMinutes(preset, 0, PLAN)).toEqual({ ranked: 6, before: 210, after: 240, outside: { added: 0, longest: null } });
    expect(sharedMinutesSentence(sharedMinutes(preset, 0, PLAN)!)).toBe(
      "Shared minutes in the published day’s 6 ranked clashes: 210 → 240 with your plan. Outside them, no overlap gets longer.",
    );
  });

  it("always says what the plan adds outside that set, with the longest new or longer overlap", () => {
    // Act Seven to The Barn at 14:00: it leaves Act Six (60 minutes fewer in the set) and lands on Act One and Act Two,
    // two pairs that are not ranked clashes today (60 and 45 new minutes).
    const plan: Plan = { ...PLAN, steps: [step("act-seven", "Act Seven", "The Barn", "barn", "14:00", "15:00", 110)] };
    const minutes = sharedMinutes(preset, 0, plan)!;
    expect(minutes).toEqual({
      ranked: 6,
      before: 210,
      after: 150,
      outside: { added: 105, longest: { a: "Act Seven", b: "Act One", minutes: 60 } },
    });
    expect(sharedMinutesSentence(minutes)).toBe(
      "Shared minutes in the published day’s 6 ranked clashes: 210 → 150 with your plan. Outside them, the plan adds 105 min of new or longer overlap (longest: Act Seven × Act One, 60 min).",
    );
  });

  it("moves every set of a kept change", () => {
    // Act Two to The Barn 15:30, Act Three to South Tent 14:15: three ranked pairs change, and nothing outside grows.
    const plan: Plan = { ...PLAN, steps: [ruleStep(108)] };
    expect(sharedMinutes(preset, 0, plan)).toEqual({ ranked: 6, before: 210, after: 135, outside: { added: 0, longest: null } });
  });

  it("gives nothing when the day has no ranked clash or a step's times cannot be read", () => {
    expect(sharedMinutes(preset, 5, PLAN)).toBeNull();
    const unreadable: Plan = { ...PLAN, steps: [{ ...PLAN.steps[0], start: "9pm" }] };
    expect(sharedMinutes(preset, 0, unreadable)).toBeNull();
  });

  it("names one ranked clash in the singular, and speaks of timetable minutes only", () => {
    const one = sharedMinutesSentence({ ranked: 1, before: 45, after: 30, outside: { added: 0, longest: null } });
    expect(one).toBe("Shared minutes in the published day’s one ranked clash: 45 → 30 with your plan. Outside it, no overlap gets longer.");
    const sentences = [
      one,
      sharedMinutesSentence({ ranked: 15, before: 815, after: 800, outside: { added: 15, longest: { a: "A", b: "B", minutes: 15 } } }),
    ];
    for (const sentence of sentences) expect(sentence).not.toMatch(/attend|people|fans|crowd|audience|revenue|money|\$|£/i);
  });

  it("is printed with a plan, directly above its summary (round 37, R5), and never without one", () => {
    const text = sheetText(makePreset(), PLAN);
    const line = "Shared minutes in the published day’s 6 ranked clashes: 210 → 240 with your plan. Outside them, no overlap gets longer.";
    expect(text).toContain(line);
    expect(text.indexOf(line)).toBeLessThan(text.indexOf("3 kept moves"));
    expect(text.indexOf(line)).toBeLessThan(text.indexOf("1. Act One"));
    // Nothing between the minutes line and the index line.
    expect(text).toContain(`${line} 3 kept moves: Clash Budget Index`);
    expect(sheetText(makePreset(), null)).not.toContain("Shared minutes");
    expect(sheetText(makePreset(), { ...PLAN, steps: [{ ...PLAN.steps[0], end: "later" }] })).not.toContain("Shared minutes");
  });

  it("leaves what a reading above 100 means off paper only on the fullest sheet, the card's single move with the comparison, and keeps it on the screen (round 39, W5)", () => {
    // Measured with headless Chrome on Letter (print media, round 39): that sheet has 12 to 13 px of room without the
    // sentence, less than its one 10 pt line (15.3 px), so it printed two pages. Every other sheet measured (no plan,
    // two to eight kept moves, the hero's move with the two-set change, the invented day) has 79 px or more.
    const meaning = (html: string) => new RegExp(`<span( class="([^"]*)")?> ${INDEX_MEANING}</span>`).exec(html);
    for (const html of [sheetHtml(makePreset(), null), sheetHtml(makePreset(), PLAN), sheetHtml(makePreset({ synthetic: true }), null)]) {
      const found = meaning(html);
      expect(found, "the sentence is in the day's paragraph").not.toBeNull();
      expect(found?.[2] ?? "").toBe("");
    }
    const tradeoff = briefTradeoff(makePreset(), parseDecision(decisionRaw()), [CARD_MOVE], 0);
    const single: Plan = {
      ...PLAN,
      steps: [{ ...PLAN.steps[0], act: "Act Two", actId: "act-two", stage: "The Barn", stageId: "barn", start: "14:30", end: "15:30" }],
    };
    const fullest = sheetHtml(makePreset(), single, { tradeoff });
    expect(meaning(fullest)?.[2]).toBe("print:hidden");
    // Still in the page for the screen, so the reading is never a print-only line.
    expect(plainOf(fullest)).toContain(INDEX_MEANING);
  });

  it("stays on paper and on the screen even when the sheet is full, since it leads the plan (round 37, R5)", () => {
    // Three moves in one column: on paper.
    expect(sheetHtml(makePreset(), PLAN)).toMatch(/<p data-shared-minutes="true" class="mb-1 print:mb-\[1pt\]">/);
    // The card's single move with the comparison and the drawing, the fullest sheet: on paper too.
    const tradeoff = briefTradeoff(makePreset(), parseDecision(decisionRaw()), [CARD_MOVE], 0);
    const single: Plan = {
      ...PLAN,
      steps: [{ ...PLAN.steps[0], act: "Act Two", actId: "act-two", stage: "The Barn", stageId: "barn", start: "14:30", end: "15:30" }],
    };
    expect(sheetHtml(makePreset(), single, { tradeoff })).toMatch(/<p data-shared-minutes="true" class="mb-1 print:mb-\[1pt\]">/);
    expect(sheetHtml(makePreset(), single, { tradeoff })).not.toMatch(/data-shared-minutes="true" class="[^"]*print:hidden/);
  });
});

describe("what a full sheet leaves off paper (round 33; round 37, R5: never the minutes line)", () => {
  const move = (n: number): BriefStep => ({ n, act: "A", place: "P", shift: "s", before: "1.0", after: "0.9", raises: false, receipt: null });
  const change = (n: number): BriefStep => ({ n, line: "L", before: "1.0", after: "0.9", raises: false, receipt: "r" });
  const moves = (count: number) => Array.from({ length: count }, (_, i) => move(i + 1));

  it("keeps both on paper for up to three single moves in one column", () => {
    for (const count of [1, 2, 3]) expect(onPaper(moves(count), 1)).toEqual({ minutes: true, decisions: true });
    // Beside the comparison too: two or three moves leave the published day's table to the screen, so both fit.
    expect(onPaper(moves(2), 1)).toEqual({ minutes: true, decisions: true });
    expect(onPaper(moves(3), 1)).toEqual({ minutes: true, decisions: true });
    expect(onPaper([change(1), move(2)], 1)).toEqual({ minutes: true, decisions: true });
  });

  it("keeps the minutes line on paper: beside the comparison and the drawing, and past six lines of steps (round 37, R5)", () => {
    // The Devpost's single kept move with the comparison.
    expect(onPaper(moves(1), 1)).toEqual({ minutes: true, decisions: true });
    // A kept change and two moves: seven lines, and one more for the change's decision line.
    expect(onPaper([change(1), move(2), move(3)], 1)).toEqual({ minutes: true, decisions: true });
    // Four single moves are two columns: the minutes line is on paper too.
    expect(onPaper(moves(4), 2)).toEqual({ minutes: true, decisions: true });
  });

  it("leaves the decision lines off for longer plans", () => {
    expect(onPaper([change(1), change(2), change(3)], 1)).toEqual({ minutes: true, decisions: false });
    for (const count of [5, 6, 7, 8]) expect(onPaper(moves(count), 2)).toEqual({ minutes: true, decisions: false });
    expect(onPaper([change(1), ...moves(4).map((step, i) => ({ ...step, n: i + 2 }))], 2)).toEqual({ minutes: true, decisions: false });
  });
});

// ------------------------------------------------------------------------------------ the locks (round 36)

describe("the lock line under the table (round 36)", () => {
  /** Day 0 with Act Three, the only set on The Barn, locked too: every stage's last set is then locked. */
  function allLastLocked(): Preset {
    const preset = makePreset();
    return makePreset({
      festival: {
        ...preset.festival,
        timetable: preset.festival.timetable.map((item) => (item.act_id === "act-three" ? { ...item, locked: true } : item)),
      },
    });
  }

  it("states the rule only where the day's locked sets are exactly the last on each stage, else the generic words", () => {
    // The Barn's last set (Act Three) is not locked on the fixture, so the rule cannot be stated.
    expect(briefLockLine(makePreset(), 0, briefRows(makePreset(), 0))).toBe(LOCK_RULE_GENERIC);
    expect(briefLockLine(allLastLocked(), 0, briefRows(allLastLocked(), 0))).toBe(LOCK_RULE);
  });

  it("prints nothing when no shown row is locked at both ends, and nothing on the invented day", () => {
    // The three costliest rows hold no clash between two locked sets.
    const three = briefRows(makePreset(), 0, 3);
    expect(three.some((row) => row.bothLocked)).toBe(false);
    expect(briefLockLine(makePreset(), 0, three)).toBeNull();
    const invented = makePreset({ synthetic: true });
    expect(briefLockLine(invented, 0, briefRows(invented, 0))).toBeNull();
  });

  it("prints once, under the table and before its notes, on a sheet that shows a both-locked row", () => {
    for (const [preset, line] of [
      [makePreset(), LOCK_RULE_GENERIC],
      [allLastLocked(), LOCK_RULE],
    ] as const) {
      const html = sheetHtml(preset, null);
      const text = plainOf(html);
      expect(text.split(line)).toHaveLength(2);
      expect(text.indexOf(line)).toBeGreaterThan(text.indexOf("both locked"));
      expect(text.indexOf(line)).toBeLessThan(text.indexOf(HIDDEN_NOTE));
      expect(html).toContain(
        `<p data-lock-rule="true" class="mt-2 text-sm text-muted-foreground print:mt-[2pt] print:text-[10pt] print:leading-[1.15]">${line}</p>`,
      );
      expect(html.indexOf("data-lock-rule")).toBeGreaterThan(html.indexOf("</table>"));
      expect(text).not.toMatch(/not by the festival/i);
    }
    // A plan that shortens the table to three rows shows no both-locked row, so no line; nor does the invented day.
    expect(sheetHtml(makePreset(), PLAN)).not.toContain("data-lock-rule");
    expect(sheetHtml(makePreset({ synthetic: true }), null)).not.toContain("data-lock-rule");
  });
});

// ------------------------------------------------------------------------------------ the day, drawn (round 36)

describe("the day, drawn (round 36)", () => {
  const preset = makePreset();
  const pair = { aId: "act-one", bId: "act-two" };
  /** The card's move: Act Two from South Tent 14:15-15:15 to The Barn at 14:30. */
  const cardPlan: Plan = {
    ...PLAN,
    steps: [{ ...PLAN.steps[0], act: "Act Two", actId: "act-two", stage: "The Barn", stageId: "barn", start: "14:30", end: "15:30" }],
  };
  const figureOf = (plan: Plan | null, options: Parameters<typeof briefFigure>[4] = {}, p: Preset = preset) =>
    briefFigure(p, 0, "Sunday", plan, options)!;
  const named = (figure: BriefFigure) => figure.sets.filter((set) => set.named).map((set) => set.name).sort();

  it("draws a kept move where the plan leaves it, its published slot dashed and the minutes it still shares with its named partner hatched", () => {
    const figure = figureOf(cardPlan, { pair, minutes: sharedMinutes(preset, 0, cardPlan) });
    expect(figure.kind).toBe("plan");
    expect(figure.stages.map((stage) => stage.name)).toEqual(["North Field", "South Tent", "The Barn"]);
    expect(figure.domain).toEqual({ start: 840, end: 1380 });
    expect(figure.sets.find((set) => set.actId === "act-two")).toMatchObject({ lane: 2, start: 870, end: 930, moved: true, named: true });
    // The published slot, South Tent 14:15-15:15, dashed.
    expect(figure.ghosts).toEqual([{ actId: "act-two", lane: 1, start: 855, end: 915 }]);
    // Act One plays North Field 14:00-15:00: the two still share 14:30-15:00.
    expect(figure.hatches).toEqual([{ aId: "act-two", bId: "act-one", start: 870, end: 900 }]);
    expect(figure.caption).toBe("Sunday, as your plan leaves it. Hatched: minutes shared with Act One. Dashed: the published slot.");
    expect(`${figure.title} ${figure.desc}`).toBe(figure.caption);
    // Every set of the day is drawn once; the other day's set is not.
    expect(figure.sets.map((set) => set.actId).sort()).toEqual([
      "act-five",
      "act-four",
      "act-one",
      "act-seven",
      "act-six",
      "act-three",
      "act-two",
    ]);
  });

  it("names only the sets the sheet names in its first lines: the mover, its partner and the longest new overlap", () => {
    expect(named(figureOf(cardPlan, { pair, minutes: sharedMinutes(preset, 0, cardPlan) }))).toEqual(["Act One", "Act Two"]);
    // Act Seven to The Barn at 14:00: the minutes line names its longest new overlap, Act Seven × Act One.
    const seven: Plan = { ...PLAN, steps: [step("act-seven", "Act Seven", "The Barn", "barn", "14:00", "15:00", 110)] };
    expect(named(figureOf(seven, { minutes: sharedMinutes(preset, 0, seven) }))).toEqual(["Act One", "Act Seven"]);
    // A move that is not the card's names no partner, so nothing is hatched and the caption says only what is drawn.
    const other: Plan = { ...PLAN, steps: [PLAN.steps[1]] };
    const lone = figureOf(other, { pair, minutes: sharedMinutes(preset, 0, other) });
    expect(named(lone)).toEqual(["Act Four"]);
    expect(lone.hatches).toEqual([]);
    expect(lone.caption).toBe("Sunday, as your plan leaves it. Dashed: the published slot.");
    // No partner without the card's pair, even for the card's own move.
    expect(figureOf(cardPlan).hatches).toEqual([]);
  });

  it("draws a kept change's moved sets and its pair, hatching what the pair still shares", () => {
    const apart = figureOf({ ...PLAN, steps: [ruleStep(108)] });
    expect(named(apart)).toEqual(["Act One", "Act Three", "Act Two"]);
    expect(apart.ghosts.map((ghost) => ghost.actId).sort()).toEqual(["act-three", "act-two"]);
    expect(apart.hatches).toEqual([]);
    expect(apart.caption).toBe("Sunday, as your plan leaves it. Dashed: the published slots.");
    // The same change with Act Two at 14:45 leaves the pair 15 minutes.
    const near = ruleStep(108);
    near.moves[0] = { ...near.moves[0], start: "14:45", end: "15:45" };
    const sharing = figureOf({ ...PLAN, steps: [near] });
    expect(sharing.hatches).toEqual([{ aId: "act-one", bId: "act-two", start: 885, end: 900 }]);
    expect(sharing.caption).toBe("Sunday, as your plan leaves it. Hatched: minutes Act One and Act Two share. Dashed: the published slots.");
  });

  it("with no kept move, draws the day as published with the costliest clash's shared minutes hatched", () => {
    const figure = figureOf(null);
    expect(figure.kind).toBe("published");
    expect(figure.ghosts).toEqual([]);
    expect(figure.sets.every((set) => !set.moved)).toBe(true);
    expect(named(figure)).toEqual(["Act One", "Act Two"]);
    expect(figure.hatches).toEqual([{ aId: "act-one", bId: "act-two", start: 855, end: 900 }]);
    expect(figure.caption).toBe("Sunday, as published. Hatched: minutes shared by the costliest clash.");
    expect(figure.title).toBe("Sunday, as published.");
    expect(figure.desc).toBe("Hatched: minutes shared by the costliest clash.");
    // A day with no ranked clash: nothing hatched, and the caption claims no hatch.
    const calm = figureOf(null, {}, makePreset({ report: { ...preset.report, clashes: [] } }));
    expect(calm.hatches).toEqual([]);
    expect(calm.caption).toBe("Sunday, as published.");
    expect(calm.desc).toBe(calm.title);
  });

  it("is null for a day with no set or a step whose times cannot be read, and its caption holds no figure, score, attendance or Qloo word", () => {
    expect(briefFigure(preset, 5, "Friday", null)).toBeNull();
    expect(briefFigure(preset, 0, "Sunday", { steps: [{ ...PLAN.steps[0], start: "9pm" }] })).toBeNull();
    for (const figure of [figureOf(null), figureOf(cardPlan, { pair }), figureOf(null, {}, makePreset({ synthetic: true }))]) {
      expect(figure.caption).not.toMatch(/\d|Qloo|attend|people|fans|crowd|audience|revenue|money|score|pric/i);
    }
  });

  it("lays out each frame inside its width: names whole, never overlapping in a lane, and low enough to print", () => {
    const figure = figureOf(cardPlan, { pair, minutes: sharedMinutes(preset, 0, cardPlan) });
    for (const frame of [FIGURE_FRAMES.wide, FIGURE_FRAMES.narrow]) {
      const layout = layoutFigure(figure, frame);
      expect(layout.width).toBe(frame.width);
      // Every lane at one pitch, named or not (North Field and The Barn name a set; South Tent does not).
      const pitch = frame.gap + frame.bar;
      expect(layout.height).toBe(frame.axis + 3 * pitch);
      expect(layout.lanes.map((lane) => lane.barY)).toEqual([0, 1, 2].map((i) => frame.axis + i * pitch + frame.gap));
      expect(layout.lanes.map((lane) => lane.nameY !== null)).toEqual([true, false, true]);
      expect(layout.names.map((name) => name.text)).toEqual(["Act One", "Act Two"]);
      for (const name of layout.names) {
        expect(name.x).toBeGreaterThanOrEqual(layout.plotX);
        expect(name.x + name.w).toBeLessThanOrEqual(frame.width);
      }
      // One bar per set; each hatch inside its bar.
      expect(layout.bars).toHaveLength(figure.sets.length);
      for (const hatch of layout.hatches) {
        const bar = layout.bars[hatch.bar];
        expect(hatch.x).toBeGreaterThanOrEqual(bar.x - 0.001);
        expect(hatch.x + hatch.w).toBeLessThanOrEqual(bar.x + bar.w + 0.001);
      }
      expect(layout.hatches.map((hatch) => layout.bars[hatch.bar].actId).sort()).toEqual(["act-one", "act-two"]);
      expect(layout.ghosts).toHaveLength(1);
      // A gridline on every hour from 14:00 to 23:00; labels only on whole steps, never on the last line.
      expect(layout.ticks).toHaveLength(10);
      expect(layout.ticks.at(-1)?.label).toBeNull();
      expect(layout.ticks[0].label).toBe("14:00");
    }
    // Five stages (both published days have five) stay under 135 printed px on Letter (the wide frame prints 3% larger),
    // and eight under 205, with the labels at their printed 9.5 pt (round 37, L75; the sheet's one page is measured in
    // the browser).
    const widePitch = FIGURE_FRAMES.wide.gap + FIGURE_FRAMES.wide.bar;
    expect((FIGURE_FRAMES.wide.axis + 5 * widePitch) * (740 / 718)).toBeLessThan(135);
    expect((FIGURE_FRAMES.wide.axis + 8 * widePitch) * (740 / 718)).toBeLessThan(205);
  });

  it("labels every hour clear of the next and inside the top edge, at the screen size and the printed one (round 37, L75)", () => {
    const figure = figureOf(cardPlan, { pair, minutes: sharedMinutes(preset, 0, cardPlan) });
    for (const frame of [FIGURE_FRAMES.wide, FIGURE_FRAMES.narrow]) {
      const labelled = layoutFigure(figure, frame).ticks.filter((tick) => tick.label !== null);
      expect(labelled.length).toBeGreaterThan(3);
      for (const size of [frame.font, frame.printFont]) {
        // Digit ink rises 0.73 em over the baseline (the site's sans, measured).
        expect(frame.hourBaseline - 0.73 * size).toBeGreaterThanOrEqual(0);
        for (let i = 1; i < labelled.length; i += 1) {
          expect(labelled[i].x - labelled[i - 1].x).toBeGreaterThanOrEqual(textWidth(labelled[i - 1].label ?? "", size) + 8);
        }
      }
      // The stage names end left of the first hour, at either size.
      const longest = Math.max(...figure.stages.map((stage) => textWidth(stage.name, Math.max(frame.font, frame.printFont))));
      expect(layoutFigure(figure, frame).plotX).toBeGreaterThanOrEqual(longest + 6);
    }
  });

  it("keeps each name in the gap over its own bar, clear of that bar's edge and of the bar above, and nearer its own (round 36 fix)", () => {
    const figure = figureOf(cardPlan, { pair, minutes: sharedMinutes(preset, 0, cardPlan) });
    // The site's sans, measured: ink rises 0.73 em over the baseline and falls 0.19 em under it. A named bar's edge
    // is 1.5 units wide, so it reaches 0.75 out of the bar; a plain bar's reaches 0.375. Checked at the screen size
    // and at the printed one (the wide frame prints its labels at printFont; round 37, L75).
    const [ascent, descent] = [0.73, 0.19];
    for (const frame of [FIGURE_FRAMES.wide, FIGURE_FRAMES.narrow]) {
      const layout = layoutFigure(figure, frame);
      for (const size of [frame.font, frame.printFont]) {
        layout.lanes.forEach((lane, index) => {
          if (lane.nameY === null) return;
          expect(lane.nameY).toBeCloseTo(lane.barY - frame.nameRise, 6);
          const inkBottom = lane.nameY + descent * size;
          const inkTop = lane.nameY - ascent * size;
          const above = index === 0 ? frame.hourBaseline : layout.lanes[index - 1].barY + frame.bar + 0.75;
          const toOwn = lane.barY - 0.75 - inkBottom;
          const toAbove = inkTop - above;
          expect(toOwn).toBeGreaterThan(0.5);
          expect(toAbove).toBeGreaterThan(1.5);
          expect(toOwn).toBeLessThan(toAbove);
        });
      }
    }
  });

  it("draws every set as a rounded rectangle, never a capsule: a corner about a third of the bar's height (round 36 fix)", () => {
    for (const frame of [FIGURE_FRAMES.wide, FIGURE_FRAMES.narrow]) {
      expect(frame.radius).toBeGreaterThan(0);
      expect(frame.radius).toBeLessThan(frame.bar / 2);
      // The day drawing's 6px corner on its 19px and 24px bars is 0.25 to 0.32 of the height.
      expect(frame.radius / frame.bar).toBeGreaterThanOrEqual(0.25);
      expect(frame.radius / frame.bar).toBeLessThanOrEqual(1 / 3);
      // The air over a bar is more than its height, as in the day drawing.
      expect(frame.gap).toBeGreaterThan(frame.bar);
    }
  });

  it("moves a name right of an earlier name in its lane, and keeps a late name inside the right edge", () => {
    const base = figureOf(null);
    const crowded: BriefFigure = {
      ...base,
      sets: base.sets.map((set) =>
        set.lane === 0 ? { ...set, named: true, name: `${set.name} with a very long stage billing` } : { ...set, named: false },
      ),
    };
    const layout = layoutFigure(crowded, FIGURE_FRAMES.narrow);
    expect(layout.names.length).toBeGreaterThan(1);
    const sorted = [...layout.names].sort((p, q) => p.x - q.x);
    for (const name of sorted) expect(name.x + name.w).toBeLessThanOrEqual(FIGURE_FRAMES.narrow.width + 0.001);
    expect(sorted[1].x).toBeGreaterThan(sorted[0].x);
    expect(textWidth("Act One", 10)).toBeGreaterThan(30);
    expect(textWidth("Act One", 10, true)).toBeGreaterThan(textWidth("Act One", 10));
  });
});

describe("where the drawing prints (round 36)", () => {
  const move = (n: number): BriefStep => ({ n, act: "A", place: "P", shift: "s", before: "1.0", after: "0.9", raises: false, receipt: null });
  const change = (n: number): BriefStep => ({ n, line: "L", before: "1.0", after: "0.9", raises: false, receipt: "r" });

  it("prints on a sheet with no kept step, and beside the comparison for one single move only", () => {
    expect(figureOnPaper([], 1)).toBe(true);
    expect(figureOnPaper([move(1)], 1, true)).toBe(true);
    // A single move without the comparison keeps its five rows and hidden list on paper instead.
    expect(figureOnPaper([move(1)], 1, false)).toBe(false);
    expect(figureOnPaper([change(1)], 1, true)).toBe(false);
    expect(figureOnPaper([move(1), move(2)], 1, true)).toBe(false);
    expect(figureOnPaper([move(1), move(2), move(3), move(4)], 2, true)).toBe(false);
  });

  it("takes the one-row table's room beside the comparison, and keeps the minutes line on paper there (round 37, R5)", () => {
    expect(tableOnPaper([move(1)], 1, true, true)).toBe(false);
    expect(tableOnPaper([move(1)], 1, true, false)).toBe(true);
    expect(tableOnPaper([move(1)], 1, false, true)).toBe(true);
    expect(onPaper([move(1)], 1)).toEqual({ minutes: true, decisions: true });
    // On the sheet: the card's one move, its comparison and the drawing all print, and the minutes line prints with them.
    const card: Plan = {
      ...PLAN,
      steps: [{ ...PLAN.steps[0], act: "Act Two", actId: "act-two", stage: "The Barn", stageId: "barn", start: "14:30", end: "15:30" }],
    };
    const kept = sheetHtml(makePreset(), card, { tradeoff: briefTradeoff(makePreset(), parseDecision(decisionRaw()), [CARD_MOVE], 0) });
    expect(kept).toMatch(/<p data-shared-minutes="true" class="mb-1 print:mb-\[1pt\]">/);
  });

  it("on the sheet: printed for the card's one move with its comparison and on a bare sheet, screen only for a longer plan", () => {
    const decision = parseDecision(decisionRaw());
    const card: Plan = {
      ...PLAN,
      steps: [{ ...PLAN.steps[0], act: "Act Two", actId: "act-two", stage: "The Barn", stageId: "barn", start: "14:30", end: "15:30" }],
    };
    const figureClass = (html: string) => html.match(/<figure data-brief-figure="" class="([^"]*)"/)?.[1].split(" ") ?? [];
    const kept = sheetHtml(makePreset(), card, { tradeoff: briefTradeoff(makePreset(), decision, [CARD_MOVE], 0) });
    expect(figureClass(kept)).toContain("break-inside-avoid");
    expect(figureClass(kept)).not.toContain("print:hidden");
    // The published day's one-row table leaves paper; the baseline line names that clash in its place.
    expect(kept.match(/<section[^>]*aria-labelledby="brief-[^"]*on-the-published-day[^"]*"[^>]*>/)?.[0]).toContain("print:hidden");
    expect(kept).toMatch(/<p class="[^"]*hidden[^"]*print:block[^"]*">Published day before these moves: costliest Act One and Act Two/);
    expect(plainOf(kept)).toContain("Sunday, as your plan leaves it. Hatched: minutes shared with Act One. Dashed: the published slot.");
    expect(figureClass(sheetHtml(makePreset(), null))).not.toContain("print:hidden");
    const long = sheetHtml(makePreset(), PLAN, { tradeoff: briefTradeoff(makePreset(), decision, [CARD_MOVE, OTHER_MOVE], 0) });
    expect(figureClass(long)).toContain("print:hidden");
    expect(figureClass(sheetHtml(makePreset(), PLAN))).toContain("print:hidden");
  });
});
