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
  bandSentence,
  briefRows,
  briefSteps,
  briefTitle,
  clashesTitle,
  coverageSentence,
  dayFigures,
  formatIndex,
  hiddenNames,
  hiddenSentence,
  indexSentence,
  planClashLines,
  planClashesTitle,
  planSummary,
  savedDate,
  sourceHosts,
} from "./brief";
import { PLAN_CAVEAT } from "./plan-copy";
import type { PairClash, Preset, SetSlot } from "./preset";
import type { Plan, PlanStep } from "./stack";

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
      },
      {
        n: 2,
        act: "Act Four",
        place: "North Field 18:15–19:15",
        shift: "15 minutes earlier, same stage",
        before: "110.2",
        after: "108.0",
        raises: false,
      },
      {
        n: 3,
        act: "Act Five",
        place: "The Barn 18:30–19:00",
        shift: "Moves to The Barn, 18:30",
        before: "108.0",
        after: "106.6",
        raises: false,
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

  it("labels the unmoved table and prints the plan's own costliest clashes after the moves", () => {
    const text = sheetText(makePreset(), PLAN);
    const before = text.indexOf("The five costliest clashes on the published day, before these moves");
    const moves = text.indexOf("Tested moves");
    const after = text.indexOf("The costliest clash with these moves");
    expect(before).toBeGreaterThan(-1);
    expect(moves).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(moves);
    expect(text).toContain("1. Act Two and Act Three · 9.5 index points");
    // Not a bare "The five costliest clashes" heading over the unmoved table.
    expect(text).not.toMatch(/The five costliest clashes (?!on the published day)/);
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
