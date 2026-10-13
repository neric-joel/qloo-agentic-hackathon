import { describe, expect, it } from "vitest";

import { decisionState } from "@/components/clash/use-decision";

import { rawTinyPreset } from "./fixtures/tiny-preset";
import {
  ATTRIBUTION,
  LIMITS_NO_RULE,
  LIMITS_WITH_RULE,
  NO_MOVE,
  TRADEOFF_NOTE_BRIEF,
  TRADEOFF_NOTE_CARD,
  TRADEOFF_SUBTITLE,
  buildDecisionCopy,
  decisionDateline,
  lacksComparison,
  decisionDay,
  decisionPath,
  parseDecision,
  buildTradeoff,
  sharedTimeline,
} from "./decision";
import { STAGE_FIT_GLOSS } from "./rule-fix";
import { parsePreset } from "./preset";

// Every name and figure below is invented for the test (the tiny preset and a made-up answer).

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function rawRule(overrides: Raw = {}): Raw {
  return {
    kind: "rule_fixes",
    a: { act_id: "ann", act: "Ann Arbor", locked: true, place: "Main 20:00-21:30" },
    b: { act_id: "bo", act: "Bo Diddly Squat", locked: false, place: "Side 20:30-22:00" },
    rule: "Ann Arbor and Bo Diddly Squat must not overlap",
    shared_minutes: 60,
    holds: false,
    single_set_places: 1,
    fixes_found: 1,
    searched: "x",
    fixes: [
      {
        sets_moved: 1,
        minutes_moved: 60,
        stage_changes: 0,
        budget_after: 98.4,
        stage_fit_flags_now: 1,
        stage_fit_flags_after: 1,
        moves: [
          {
            act_id: "bo",
            act: "Bo Diddly Squat",
            from: "Side 20:30-22:00",
            stage_id: "side",
            stage: "Side",
            day: 0,
            start: "21:30",
            end: "23:00",
            minutes_moved: 60,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function rawDecision(overrides: Raw = {}): Raw {
  return {
    kind: "decision",
    day: 0,
    skipped_locked: 0,
    skipped_no_place: 0,
    clash: { a_id: "ann", b_id: "bo", rank: 1, minutes: 60 },
    published_budget: 104.2,
    move: {
      act_id: "bo",
      act: "Bo Diddly Squat",
      from: "Side 20:30-22:00",
      stage_id: "side",
      stage: "Side",
      day: 0,
      start: "21:30",
      end: "23:00",
      minutes_moved: 60,
      legal_places: 4,
      stage_changed: false,
      budget_after: 98.4,
      minutes_shared_after: 0,
      same_index_alternative: null,
    },
    rule: rawRule(),
    ...overrides,
  };
}

const preset = () => parsePreset(rawTinyPreset());

describe("parseDecision", () => {
  it("reads a well-formed answer", () => {
    const decision = parseDecision(rawDecision());
    expect(decision?.clash).toEqual({ aId: "ann", bId: "bo", rank: 1, minutes: 60 });
    expect(decision?.move?.budgetAfter).toBe(98.4);
    expect(decision?.rule?.a.locked).toBe(true);
  });

  it("never throws, and drops only a bad rule answer", () => {
    const bad = [
      null,
      undefined,
      1,
      "x",
      [],
      {},
      { kind: "decision" },
      rawDecision({ clash: { a_id: "x" } }),
      rawDecision({ move: { act_id: "x" } }),
    ];
    for (const value of bad) expect(parseDecision(value)).toBeNull();
    const withBadRule = parseDecision(rawDecision({ rule: { kind: "rule_fixes" } }));
    expect(withBadRule?.move).not.toBeNull();
    expect(withBadRule?.rule).toBeNull();
  });
});

describe("decisionPath", () => {
  it("asks for a day and refuses unsafe ids", () => {
    expect(decisionPath("tiny-fest-sat")).toBe("/api/presets/tiny-fest-sat/decision");
    expect(decisionPath("tiny-fest-sat", 1)).toBe("/api/presets/tiny-fest-sat/decision?day=1");
    expect(decisionPath("a/b")).toBeNull();
  });

  it("opens on the first day with sets", () => {
    expect(decisionDay(preset())).toBe(0);
  });
});

describe("buildDecisionCopy", () => {
  it("leads with the receipt and prints the lines from the answer and the report", () => {
    const copy = buildDecisionCopy(preset(), parseDecision(rawDecision()))!;
    expect(copy.receipt).toBe("Bo Diddly Squat 60 minutes later: 60 → 0 minutes shared");
    expect(copy.title).toBe("Tiny Fest · Saturday · published timetable");
    expect(decisionDateline({ name: "Glastonbury Festival 2025, Sun", days: ["Sun"] }, "Sun")).toBe(
      "Glastonbury 2025 · Sunday · published timetable",
    );
    expect(decisionDateline({ name: "Riot Fest 2026, Sun", days: ["Sun"] }, "Sun")).toBe(
      "Riot Fest 2026 · Sunday · published timetable",
    );
    // An invented day names no festival and claims no published timetable.
    expect(decisionDateline({ name: "Tiny Fest", days: ["Sat"] }, "Sat", true)).toBe(
      "Invented day · Saturday · invented timetable",
    );
    expect(copy.clashLine).toBe(
      "The costliest clash with a set that has a legal place that lowers the index: Ann Arbor (Main) and Bo Diddly Squat (Side) share 60 minutes, 20:30–21:30. " +
        "Their main genre tags differ; their taste overlap is 70 of 100 on this bill, among its highest. It is a rank, not attendance.",
    );
    expect(copy.moveLine).toBe(
      "Move one set: of the 4 legal places on the 5-minute grid for Bo Diddly Squat, the one with the lowest index is Side 21:30–23:00 (60 minutes later, same stage). " +
        "Time shared with Ann Arbor goes from 60 to 0 minutes and the index from 104.2 to 98.4.",
    );
    expect([copy.indexBefore, copy.indexAfter]).toEqual(["104.2", "98.4"]);
    expect(copy.rangeLine).toBe(
      "The middle 80% of random valid timetables of this lineup score 90 to 110. This plan scores inside that range.",
    );
    expect(copy.ruleLine).toContain("Ann Arbor is locked, so only Bo Diddly Squat can move.");
    expect(copy.limitsLine).toBe(LIMITS_WITH_RULE);
    expect(LIMITS_WITH_RULE).toBe("Checked against the timetable’s rules; its index is shown for information.");
    expect(LIMITS_WITH_RULE).not.toMatch(/Line \d|Lines 1/);
    expect(ATTRIBUTION).toBe("Selected and scored by this app’s index");
    expect(copy.seedMove).toEqual({ actId: "bo", stageId: "side", day: 0, start: "21:30" });
    expect(copy.seedRule).toEqual({ aId: "ann", bId: "bo" });
    expect(copy.testing).toBe("Testing Bo Diddly Squat at 21:30.");
  });

  it("seeds line 3's first change as one step a plan can keep, only when that change exists", () => {
    const copy = buildDecisionCopy(preset(), parseDecision(rawDecision()))!;
    expect(copy.seedChange).toEqual({
      rule: { aId: "ann", bId: "bo" },
      moves: [{ actId: "bo", stageId: "side", day: 0, start: "21:30" }],
    });
    expect(copy.testingChange).toBe("Kept a change meant to keep Ann Arbor and Bo Diddly Squat apart. Pricing your plan.");
    // A two-set change keeps both moves, in the order the list gives them.
    const two = rawRule();
    two.fixes[0].sets_moved = 2;
    two.fixes[0].moves.push({
      act_id: "ann",
      act: "Ann Arbor",
      from: "Main 20:00-21:30",
      stage_id: "main",
      stage: "Main",
      day: 0,
      start: "19:00",
      end: "20:30",
      minutes_moved: 60,
    });
    expect(buildDecisionCopy(preset(), parseDecision(rawDecision({ rule: two })))!.seedChange?.moves).toEqual([
      { actId: "bo", stageId: "side", day: 0, start: "21:30" },
      { actId: "ann", stageId: "main", day: 0, start: "19:00" },
    ]);
    for (const rule of [null, rawRule({ fixes: [], fixes_found: 0 }), rawRule({ holds: true, fixes: [], shared_minutes: 0 })]) {
      const none = buildDecisionCopy(preset(), parseDecision(rawDecision({ rule })))!;
      expect(none.seedChange).toBeNull();
      expect(none.testingChange).toBeNull();
    }
    const both = rawRule({ b: { act_id: "bo", act: "Bo Diddly Squat", locked: true, place: "y" } });
    expect(buildDecisionCopy(preset(), parseDecision(rawDecision({ rule: both })))!.seedChange).toBeNull();
  });

  it("prints the first rule change's index beside the published one on line 3, and words the alternative", () => {
    const copy = buildDecisionCopy(preset(), parseDecision(rawDecision()))!;
    expect(copy.ruleLine).toContain(
      "The smallest change this search found that ends it moves 1 set, 60 start-time minutes in all; index 104.2 → 98.4.",
    );
    expect(copy.ruleLine).toContain("Ann Arbor is locked, so only Bo Diddly Squat can move. 1 single-set place ends it.");
    const alt = rawDecision();
    alt.move.same_index_alternative = {
      act_id: "ann",
      act: "Ann Arbor",
      from: "Main 20:00-21:30",
      stage_id: "main",
      stage: "Main",
      day: 0,
      start: "19:00",
      end: "20:30",
      minutes_moved: 60,
    };
    expect(buildDecisionCopy(preset(), parseDecision(alt))!.moveLine).toContain("gives the same index to one decimal.");
  });

  it("is a rank, not attendance, for an ordinary clash too", () => {
    const raw = rawTinyPreset() as Raw;
    raw.report.clashes[0].label = null;
    const copy = buildDecisionCopy(parsePreset(raw), parseDecision(rawDecision()))!;
    expect(copy.clashLine).toContain("Their taste overlap is 70 of 100 on this bill, a rank, not attendance.");
  });

  it("names the costlier clashes it passed over", () => {
    const copy = buildDecisionCopy(preset(), parseDecision(rawDecision({ skipped_locked: 2, skipped_no_place: 1 })))!;
    expect(copy.clashLine).toContain("The 2 costlier clashes are between locked sets.");
    expect(copy.clashLine).toContain("One costlier clash has no legal place that lowers the index.");
  });

  it("says so when no place lowers the index, with no receipt, figure or move to open", () => {
    const copy = buildDecisionCopy(preset(), parseDecision(rawDecision({ move: null })))!;
    expect(copy.receipt).toBeNull();
    expect(copy.moveLine).toBe(NO_MOVE);
    expect(copy.indexBefore).toBeNull();
    expect(copy.timeline).toBeNull();
    expect(copy.seedMove).toBeNull();
    expect(copy.rangeLine).toBeNull();
  });

  it("omits the rule line, and says nothing of it, when there is none", () => {
    const copy = buildDecisionCopy(preset(), parseDecision(rawDecision({ rule: null })))!;
    expect(copy.ruleLine).toBeNull();
    expect(copy.seedRule).toBeNull();
    expect(copy.limitsLine).toBe(LIMITS_NO_RULE);
    expect(LIMITS_NO_RULE).toBeNull();
    const holds = buildDecisionCopy(
      preset(),
      parseDecision(rawDecision({ rule: rawRule({ holds: true, fixes: [], shared_minutes: 0 }) })),
    )!;
    expect(holds.ruleLine).toBeNull();
  });

  it("offers no rule to try when both sets are locked", () => {
    const both = rawRule({ b: { act_id: "bo", act: "Bo Diddly Squat", locked: true, place: "y" }, fixes: [] });
    const copy = buildDecisionCopy(preset(), parseDecision(rawDecision({ rule: both })))!;
    expect(copy.ruleLine).toContain("Both sets are locked.");
    expect(copy.seedRule).toBeNull();
  });

  it("renders nothing without a decision, a clash, or a clash the timetable does not hold", () => {
    expect(buildDecisionCopy(preset(), null)).toBeNull();
    expect(buildDecisionCopy(preset(), parseDecision(rawDecision({ clash: null, move: null, rule: null })))).toBeNull();
    const unknown = rawDecision({ clash: { a_id: "zz", b_id: "bo", rank: 1, minutes: 5 } });
    expect(buildDecisionCopy(preset(), parseDecision(unknown))).toBeNull();
  });

  it("is serializable and carries no id, tag or raw popularity", () => {
    const copy = buildDecisionCopy(preset(), parseDecision(rawDecision()))!;
    const all = JSON.stringify(copy);
    expect(all).not.toContain("Q-ANN");
    const forbidden = [/optimi[sz]/i, /improve/i, /recommend/i, /validated/i, /predicts/i, /\bfix/i, /same (crowd|fans|people)/i, /riders/i];
    for (const pattern of forbidden) expect(all).not.toMatch(pattern);
  });
});

describe("sharedTimeline", () => {
  it("scales a 75-minute span to 240 units, as the design example does", () => {
    const line = sharedTimeline(
      { name: "Katy", start: 840, end: 885 },
      { name: "Sprints", start: 840, end: 900 },
      { start: 855, end: 915 },
    )!;
    expect(line.staying).toEqual({ x: 24, w: 144 });
    expect(line.movingNow).toEqual({ x: 24, w: 192 });
    expect(line.bandNow).toEqual({ x: 24, w: 144 });
    expect(line.movingAfter).toEqual({ x: 72, w: 192 });
    expect(line.bandAfter).toEqual({ x: 72, w: 96 });
    // A hairline every quarter hour; labels only at :00 and :30, so 14:30 is never dropped for a bar's end.
    expect(line.ticks.map((tick) => tick.x)).toEqual([24, 72, 120, 168, 216, 264]);
    expect(line.ticks.map((tick) => tick.major)).toEqual([true, false, true, false, true, false]);
    expect(line.ticks.map((tick) => tick.label)).toEqual(["14:00", "", "14:30", "", "15:00", ""]);
  });

  it("runs the axis from the quarter hour before the first start to the one after the last end", () => {
    const line = sharedTimeline(
      { name: "A", start: 845, end: 905 },
      { name: "B", start: 850, end: 900 },
      { start: 870, end: 920 },
    )!;
    // 14:00 to 15:30: 90 minutes across 240 units.
    expect(line.ticks[0]).toEqual({ x: 24, label: "14:00", major: true });
    expect(line.ticks[line.ticks.length - 1]).toEqual({ x: 264, label: "15:30", major: true });
    expect(line.ticks).toHaveLength(7);
    expect(line.staying.x).toBeCloseTo(24 + (5 * 240) / 90);
    for (const tick of line.ticks) expect(tick.label === "" || tick.major).toBe(true);
  });

  it("labels every hour, not every half hour, when half-hour labels would collide", () => {
    const line = sharedTimeline({ name: "A", start: 720, end: 960 }, { name: "B", start: 780, end: 900 }, { start: 900, end: 1020 })!;
    // 12:00 to 17:00 is 300 minutes: half an hour is 24 units, under the 44-unit gap.
    expect(line.ticks.filter((tick) => tick.label).map((tick) => tick.label)).toEqual([
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
    ]);
    expect(line.ticks).toHaveLength(21);
  });

  it("has no band after a swap that ends the overlap, and refuses an empty span", () => {
    const line = sharedTimeline({ name: "A", start: 0, end: 60 }, { name: "B", start: 0, end: 60 }, { start: 60, end: 120 })!;
    expect(line.bandAfter).toBeNull();
    const empty = { name: "A", start: 10, end: 10 };
    expect(sharedTimeline(empty, { ...empty, name: "B" }, { start: 10, end: 10 })).toBeNull();
  });
});


/** The route's extra fields for the trade-off: the move's, and the rule's first change's. */
function withAfter(): Raw {
  const decision = rawDecision();
  Object.assign(decision.move, {
    stage_fit_flags_now: 2,
    stage_fit_flags_after: 3,
    costliest_after: { a: "Cy Twombly", b: "Di Vine", minutes: 30, points: 9.5 },
  });
  Object.assign(decision.rule.fixes[0], {
    minutes_shared_after: 0,
    costliest_after: { a: "Ed Sheeran-ish", b: "Fay Wray", minutes: 45, points: 1.2 },
  });
  return decision;
}

describe("the side-by-side comparison", () => {
  it("reads the route's extra fields and keeps every number as the route gave it", () => {
    const decision = parseDecision(withAfter())!;
    expect(decision.move).toMatchObject({
      flagsNow: 2,
      flagsAfter: 3,
      costliestAfter: { a: "Cy Twombly", b: "Di Vine", minutes: 30, points: 9.5 },
    });
    expect(decision.ruleChange).toEqual({
      minutesSharedAfter: 0,
      costliestAfter: { a: "Ed Sheeran-ish", b: "Fay Wray", minutes: 45, points: 1.2 },
    });
  });

  it("builds one row per figure, move first and rule second, with the attribution and the gloss kept", () => {
    const tradeoff = buildTradeoff(parseDecision(withAfter()))!;
    expect([tradeoff.moveHead, tradeoff.ruleHead]).toEqual(["Move one set", "Keep the two apart"]);
    expect(tradeoff.rows.map((row) => row.id)).toEqual([
      "sets",
      "minutes",
      "shared",
      "ends",
      "index",
      "flags",
      "costliest",
    ]);
    const row = (id: string) => tradeoff.rows.find((item) => item.id === id)!;
    expect(row("sets")).toMatchObject({ move: "1 (Bo Diddly Squat)", rule: "1 (Bo Diddly Squat)" });
    expect(row("minutes")).toMatchObject({ move: "60", rule: "60" });
    // The pair's own minutes before (the clash's) and after each change, and whether each ends the overlap.
    expect(row("shared")).toMatchObject({
      label: "Time the pair shares, before → after",
      move: "60 → 0 minutes",
      rule: "60 → 0 minutes",
    });
    expect(row("ends")).toMatchObject({ label: "Ends the overlap", move: "Yes", rule: "Yes" });
    expect(row("index")).toMatchObject({ move: "104.2 → 98.4", rule: "104.2 → 98.4", note: ATTRIBUTION });
    expect(row("flags")).toMatchObject({ move: "2 → 3", rule: "1 → 1", note: STAGE_FIT_GLOSS });
    expect(row("costliest")).toMatchObject({
      move: "Cy Twombly and Di Vine, 30 minutes, 9.5 index points",
      rule: "Ed Sheeran-ish and Fay Wray, 45 minutes, 1.2 index points",
    });
  });

  it("says what each column is and that the figures are for the published day, with a non-verdict line", () => {
    const tradeoff = buildTradeoff(parseDecision(withAfter()))!;
    expect(tradeoff.subtitle).toBe(TRADEOFF_SUBTITLE);
    expect(TRADEOFF_SUBTITLE).toBe(
      "Each change tested alone on the published day: the first column is the single move with the lowest index; the second is the smallest change this search found that ends the overlap.",
    );
    expect(tradeoff.footnote).toBe(TRADEOFF_NOTE_CARD);
    expect(TRADEOFF_NOTE_CARD).toMatch(/^Weigh this reading;/);
    expect(TRADEOFF_NOTE_BRIEF).toBe("Weigh this reading; the plan receipt above is what your plan does.");
  });

  it("marks a change that leaves the pair sharing time, from the after minutes", () => {
    const raw = withAfter();
    raw.move.minutes_shared_after = 15;
    raw.rule.fixes[0].minutes_shared_after = 0;
    const tradeoff = buildTradeoff(parseDecision(raw))!;
    const row = (id: string) => tradeoff.rows.find((item) => item.id === id)!;
    expect(row("shared")).toMatchObject({ move: "60 → 15 minutes", rule: "60 → 0 minutes" });
    expect(row("ends")).toMatchObject({ move: "No", rule: "Yes" });
    raw.move.minutes_shared_after = 1;
    expect(buildTradeoff(parseDecision(raw))!.rows.find((item) => item.id === "shared")!.move).toBe("60 → 1 minute");
  });

  it("knows when an answer lacks the comparison's figures, so the browser asks again", () => {
    // An answer cached before the route sent the extra fields.
    expect(lacksComparison(parseDecision(rawDecision()))).toBe(true);
    expect(lacksComparison(parseDecision(withAfter()))).toBe(false);
    // Missing any one of the figures the table prints.
    const noFlags = withAfter();
    delete noFlags.move.stage_fit_flags_now;
    expect(lacksComparison(parseDecision(noFlags))).toBe(true);
    const noCostliest = withAfter();
    delete noCostliest.rule.fixes[0].costliest_after;
    expect(lacksComparison(parseDecision(noCostliest))).toBe(true);
    const noShared = withAfter();
    delete noShared.rule.fixes[0].minutes_shared_after;
    expect(lacksComparison(parseDecision(noShared))).toBe(true);
    // Nothing to compare (no move, no rule, no published index, a rule that holds): nothing to ask for.
    const raw = rawDecision();
    expect(lacksComparison(null)).toBe(false);
    expect(lacksComparison(parseDecision({ ...raw, move: null }))).toBe(false);
    expect(lacksComparison(parseDecision({ ...raw, rule: null }))).toBe(false);
    expect(lacksComparison(parseDecision({ ...raw, published_budget: null }))).toBe(false);
    expect(lacksComparison(parseDecision({ ...raw, rule: rawRule({ holds: true, fixes: [], shared_minutes: 0 }) }))).toBe(false);
  });

  it("gives the card's move a receipt for a plan that is just that move", () => {
    const copy = buildDecisionCopy(preset(), parseDecision(withAfter()))!;
    expect(copy.moveReceipt).toBe("Ann Arbor and Bo Diddly Squat share no time after this plan.");
    const raw = withAfter();
    raw.move.minutes_shared_after = 30;
    expect(buildDecisionCopy(preset(), parseDecision(raw))!.moveReceipt).toBe(
      "Ann Arbor and Bo Diddly Squat share 30 minutes after this plan.",
    );
    expect(buildDecisionCopy(preset(), parseDecision({ ...raw, move: null }))!.moveReceipt).toBeNull();
  });

  it("names both sets of a two-set change and says so when no priced clash is left", () => {
    const raw = withAfter();
    raw.rule.fixes[0].sets_moved = 2;
    raw.rule.fixes[0].moves.push({ ...raw.rule.fixes[0].moves[0], act_id: "ann", act: "Ann Arbor" });
    raw.move.costliest_after = null;
    const tradeoff = buildTradeoff(parseDecision(raw))!;
    const row = (id: string) => tradeoff.rows.find((item) => item.id === id)!;
    expect(row("sets").rule).toBe("2 (Bo Diddly Squat and Ann Arbor)");
    expect(row("costliest").move).toBe("No priced clash left on this day");
  });

  it("leaves out a row the route did not send for both changes, and prints nothing it cannot read", () => {
    // An older route: no flags, no costliest clash and no minutes after for the rule change.
    const old = buildTradeoff(parseDecision(rawDecision()))!;
    expect(old.rows.map((row) => row.id)).toEqual(["sets", "minutes", "index"]);
    // Costliest only on one side: the row is left out, never half-filled.
    const half = withAfter();
    delete half.rule.fixes[0].costliest_after;
    expect(buildTradeoff(parseDecision(half))!.rows.map((row) => row.id)).not.toContain("costliest");
    // A mistyped figure is treated as not sent.
    const bad = withAfter();
    bad.move.costliest_after = { a: "x", b: "y", minutes: "30", points: 1 };
    bad.move.stage_fit_flags_now = "2";
    const ids = buildTradeoff(parseDecision(bad))!.rows.map((row) => row.id);
    expect(ids).not.toContain("costliest");
    expect(ids).not.toContain("flags");
  });

  it("is absent without a move, a listed change, a published index, or when the card has no rule to try", () => {
    const raw = withAfter();
    expect(buildTradeoff(null)).toBeNull();
    expect(buildTradeoff(parseDecision({ ...raw, move: null }))).toBeNull();
    expect(buildTradeoff(parseDecision({ ...raw, rule: null }))).toBeNull();
    expect(buildTradeoff(parseDecision({ ...raw, published_budget: null }))).toBeNull();
    expect(buildTradeoff(parseDecision({ ...raw, rule: rawRule({ fixes: [], fixes_found: 0 }) }))).toBeNull();
    expect(buildTradeoff(parseDecision({ ...raw, rule: rawRule({ holds: true, fixes: [], shared_minutes: 0 }) }))).toBeNull();
    const both = rawRule({ b: { act_id: "bo", act: "Bo Diddly Squat", locked: true, place: "y" } });
    both.a.locked = true;
    expect(buildTradeoff(parseDecision({ ...raw, rule: both }))).toBeNull();
  });

  it("is part of the card's copy, free of verdict words, and reads no taste value", () => {
    const copy = buildDecisionCopy(preset(), parseDecision(withAfter()))!;
    expect(copy.tradeoff).not.toBeNull();
    const text = JSON.stringify(copy.tradeoff);
    for (const banned of ["better", "worse", "winner", "best", "optimal", "recommend", "taste overlap", "popularity"]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
    // No tradeoff on a card that has no single move to compare.
    expect(buildDecisionCopy(preset(), parseDecision({ ...withAfter(), move: null }))!.tradeoff).toBeNull();
  });
});

describe("the card without the server's cache", () => {
  const stale = () => parseDecision(rawDecision())!;
  const fresh = () => parseDecision(withAfter())!;
  const key = "tiny-fest-sat|0";

  it("keeps a complete server answer and asks for nothing", () => {
    expect(decisionState(fresh(), 0, key, null, false)).toEqual({ status: "ready", decision: fresh() });
    // Even when a fetch happens to be in hand, a complete answer is the page's.
    expect(decisionState(fresh(), 0, key, { key, decision: stale() }, false).status).toBe("ready");
    expect(decisionState(fresh(), 0, key, { key, decision: stale() }, false)).toMatchObject({ decision: fresh() });
  });

  it("shows a stale server answer at once, then the browser's own fetch once it has a full one", () => {
    expect(decisionState(stale(), 0, key, null, false)).toEqual({ status: "ready", decision: stale() });
    const after = decisionState(stale(), 0, key, { key, decision: fresh() }, false);
    expect(after).toEqual({ status: "ready", decision: fresh() });
    if (after.status !== "ready") throw new Error("not ready");
    // The full table: every row the comparison has, from the browser's answer.
    expect(buildTradeoff(after.decision)!.rows.map((row) => row.id)).toEqual([
      "sets",
      "minutes",
      "shared",
      "ends",
      "index",
      "flags",
      "costliest",
    ]);
    // A failed fetch leaves the server's answer in place; so does a fetch for another preset or day.
    expect(decisionState(stale(), 0, key, { key, decision: null }, false)).toEqual({ status: "ready", decision: stale() });
    expect(decisionState(stale(), 0, key, { key: "other|0", decision: fresh() }, false)).toEqual({
      status: "ready",
      decision: stale(),
    });
  });

  it("falls back to the fetch alone when the server holds no answer for this day", () => {
    expect(decisionState(null, 0, key, null, false)).toEqual({ status: "loading" });
    expect(decisionState(stale(), 1, key, null, false)).toEqual({ status: "loading" });
    expect(decisionState(null, 0, key, { key, decision: fresh() }, false)).toEqual({ status: "ready", decision: fresh() });
    expect(decisionState(null, 0, key, { key, decision: null }, false)).toEqual({ status: "none" });
    expect(decisionState(null, 0, key, null, true)).toEqual({ status: "none" });
  });
});
