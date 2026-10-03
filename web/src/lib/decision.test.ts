import { describe, expect, it } from "vitest";

import { rawTinyPreset } from "./fixtures/tiny-preset";
import {
  ATTRIBUTION,
  LIMITS_NO_RULE,
  LIMITS_WITH_RULE,
  NO_MOVE,
  buildDecisionCopy,
  decisionDay,
  decisionPath,
  parseDecision,
  sharedTimeline,
} from "./decision";
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
    expect(copy.title).toBe("One decision on Tiny Fest Saturday, published timetable");
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
    expect(line.ticks.map((tick) => tick.label)).toEqual(["14:00", "14:15", "14:45", "15:00", "15:15"]);
  });

  it("has no band after a swap that ends the overlap, and refuses an empty span", () => {
    const line = sharedTimeline({ name: "A", start: 0, end: 60 }, { name: "B", start: 0, end: 60 }, { start: 60, end: 120 })!;
    expect(line.bandAfter).toBeNull();
    const empty = { name: "A", start: 10, end: 10 };
    expect(sharedTimeline(empty, { ...empty, name: "B" }, { start: 10, end: 10 })).toBeNull();
  });
});
