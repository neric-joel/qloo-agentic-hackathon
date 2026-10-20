import { describe, expect, it } from "vitest";

import {
  ALREADY_KEPT,
  BOTH_LOCKED,
  PANEL_ROWS,
  collapseSimilar,
  isSimilar,
  rowsCover,
  similarLine,
  NO_RESULT,
  fixGhosts,
  fixIndexLine,
  fixStep,
  fixSummary,
  changeSummaryLine,
  keepAnnouncement,
  keepChangeLabel,
  keptChangeAnnouncement,
  lockedNote,
  plannedNote,
  replacedChangeAnnouncement,
  STAGE_FIT_GLOSS,
  moveLine,
  parsePlace,
  parseRuleFixes,
  previewAnnouncement,
  roomNote,
  searchedSentence,
  SEARCH_COVERS,
  ruleFixesPath,
  ruleSentence,
  shiftBrief,
  shiftWords,
  stageFitNote,
} from "./rule-fix";

// Every name and figure below is invented for the test.

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function rawMove(overrides: Raw = {}): Raw {
  return {
    act_id: "ann",
    act: "Ann Arbor",
    from: "Main 20:00-21:30",
    stage_id: "side",
    stage: "Side",
    day: 0,
    start: "21:30",
    end: "23:00",
    minutes_moved: 90,
    ...overrides,
  };
}

function rawFix(overrides: Raw = {}): Raw {
  return {
    sets_moved: 2,
    minutes_moved: 120,
    stage_changes: 2,
    budget_after: 98.44,
    stage_fit_flags_now: 3,
    stage_fit_flags_after: 2,
    moves: [
      rawMove(),
      rawMove({
        act_id: "bo",
        act: "Bo Diddly Squat",
        from: "Side 20:30-22:00",
        stage_id: "main",
        stage: "Main",
        start: "20:00",
        end: "21:30",
        minutes_moved: 30,
      }),
    ],
    ...overrides,
  };
}

function rawRule(overrides: Raw = {}): Raw {
  return {
    kind: "rule_fixes",
    a: { act_id: "ann", act: "Ann Arbor", locked: false, place: "Main 20:00-21:30" },
    b: { act_id: "bo", act: "Bo Diddly Squat", locked: false, place: "Side 20:30-22:00" },
    rule: "Ann Arbor and Bo Diddly Squat must not overlap",
    shared_minutes: 60,
    holds: false,
    single_set_places: 0,
    fixes_found: 2,
    searched: "x",
    fixes: [rawFix()],
    ...overrides,
  };
}

describe("parseRuleFixes", () => {
  it("reads a well-formed answer", () => {
    const rule = parseRuleFixes(rawRule());
    expect(rule?.a.actId).toBe("ann");
    expect(rule?.fixes[0].moves).toHaveLength(2);
    expect(rule?.fixes[0].budgetAfter).toBe(98.44);
    expect(rule?.singleSetPlaces).toBe(0);
    expect(rule?.searched).toBe("x");
    expect(parseRuleFixes(rawRule({ searched: undefined }))?.searched).toBeNull();
  });

  it("never throws and returns null for anything else", () => {
    const bad = [null, undefined, 3, "x", [], {}, { kind: "other" }, rawRule({ holds: "no" }), rawRule({ fixes: [{}] }), rawRule({ a: null })];
    for (const value of bad) expect(parseRuleFixes(value)).toBeNull();
    expect(parseRuleFixes(rawRule({ fixes: [rawFix({ moves: [rawMove({ start: "later" })] })] }))).toBeNull();
    expect(parseRuleFixes(rawRule({ fixes: [rawFix({ moves: [] })] }))).toBeNull();
  });

  it("accepts a missing index after a change", () => {
    const rule = parseRuleFixes(rawRule({ fixes: [rawFix({ budget_after: null })] }));
    expect(rule?.fixes[0].budgetAfter).toBeNull();
    expect(fixIndexLine(rule!.fixes[0], 104.2)).toBeNull();
  });
});

describe("ruleFixesPath", () => {
  it("builds the query and refuses unsafe or equal ids", () => {
    expect(ruleFixesPath("tiny-fest-sat", "ann", "bo", 3)).toBe("/api/presets/tiny-fest-sat/rule-fixes?a=ann&b=bo&limit=3");
    expect(ruleFixesPath("tiny-fest-sat", "ann", "bo", 99)).toContain("limit=5");
    expect(ruleFixesPath("tiny-fest-sat", "ann", "ann")).toBeNull();
    expect(ruleFixesPath("../x", "ann", "bo")).toBeNull();
    expect(ruleFixesPath("tiny-fest-sat", "a b", "bo")).toBeNull();
  });
});

describe("wording", () => {
  it("reads a place", () => {
    expect(parsePlace("The Park 14:00-14:45")).toEqual({ stage: "The Park", start: "14:00", end: "14:45" });
    expect(parsePlace("nonsense")).toBeNull();
  });

  it("words a shift as the plan card does", () => {
    expect(shiftWords({ from: "Woodsies 14:00-15:00", stage: "Woodsies", start: "14:15" })).toBe("15 minutes later, same stage");
    expect(shiftWords({ from: "Woodsies 14:00-15:00", stage: "Woodsies", start: "13:59" })).toBe("1 minute earlier, same stage");
    expect(shiftWords({ from: "Woodsies 14:00-15:00", stage: "Radical", start: "19:45" })).toBe("Moves to Radical, 345 minutes later");
    expect(shiftWords({ from: "Woodsies 14:00-15:00", stage: "Radical", start: "14:00" })).toBe("Moves to Radical, 14:00");
    expect(shiftWords({ from: "odd", stage: "Radical", start: "14:00" })).toBe("Moves to Radical, 14:00");
  });

  it("gives a short form for a headline", () => {
    expect(shiftBrief({ from: "Woodsies 14:00-15:00", stage: "Woodsies", start: "14:15" })).toBe("15 minutes later");
    expect(shiftBrief({ from: "Woodsies 14:00-15:00", stage: "Radical", start: "19:45" })).toBe("to Radical 19:45");
  });

  it("prints a change's lines", () => {
    const rule = parseRuleFixes(rawRule())!;
    const [first] = rule.fixes;
    expect(moveLine(first.moves[0])).toBe("Ann Arbor → Side 21:30–23:00 (moves to Side, 90 minutes later)");
    expect(moveLine(first.moves[1], "Sunday")).toContain(", Sunday (");
    expect(fixSummary(first)).toBe("2 sets · 120 minutes start-time shift");
    expect(fixIndexLine(first, 104.2)).toBe("Index 104.2 → 98.4");
    expect(stageFitNote(first)).toBeNull();
    expect(stageFitNote({ ...first, flagsAfter: 5 })).toBe("Adds 2 stage-fit flags");
    expect(stageFitNote({ ...first, flagsAfter: 4 })).toBe("Adds 1 stage-fit flag");
  });
});

describe("ruleSentence", () => {
  it("says what the search found, with the first change's index beside the published one", () => {
    const sentence = ruleSentence(parseRuleFixes(rawRule())!, 104.2);
    expect(sentence).toBe(
      "If a rule says Ann Arbor and Bo Diddly Squat must never overlap: This search found no single-set place that ends it. " +
        "The smallest change this search found that ends it moves 2 sets, 120 start-time minutes in all; index 104.2 → 98.4. " +
        "It is a 2-set change: Ann Arbor to Side 21:30–23:00 and Bo Diddly Squat to Main 20:00–21:30. It adds no rule break.",
    );
  });

  it("prints an index that goes up as it is, and none without a published index", () => {
    const up = rawRule({ fixes: [rawFix({ budget_after: 108.04 })] });
    expect(ruleSentence(parseRuleFixes(up)!, 104.2)).toContain("in all; index 104.2 → 108.0.");
    expect(ruleSentence(parseRuleFixes(rawRule())!, null)).toContain("120 start-time minutes in all. It is");
  });

  it("starts the sentence after the locked note with a capital", () => {
    const locked = rawRule({ a: { act_id: "ann", act: "Ann Arbor", locked: true, place: "Main 20:00-21:30" } });
    expect(ruleSentence(parseRuleFixes(locked)!)).toContain("can move. This search found no single-set place");
  });

  it("says what the route searched, in its own words or ours", () => {
    expect(searchedSentence({ searched: "single places on a grid; longer chains were not searched" })).toBe(
      "Single places on a grid; longer chains were not searched.",
    );
    expect(searchedSentence({ searched: "Done." })).toBe("Done.");
    expect(searchedSentence({ searched: null })).toBe(`${SEARCH_COVERS.charAt(0).toUpperCase()}${SEARCH_COVERS.slice(1)}.`);
    expect(SEARCH_COVERS).not.toMatch(/every/i);
  });

  it("counts single-set places and words a single move", () => {
    const one = rawRule({
      single_set_places: 1,
      fixes: [rawFix({ sets_moved: 1, minutes_moved: 30, moves: [rawMove({ minutes_moved: 30 })] })],
    });
    const sentence = ruleSentence(parseRuleFixes(one)!)!;
    expect(sentence).toContain("1 single-set place ends it.");
    expect(sentence).toContain("is a single move: Ann Arbor to Side");
    expect(sentence).toContain("moves 1 set, 30 start-time minutes in all");
    expect(sentence).toContain("It adds no rule break.");
  });

  it("handles no result, locked sets and a pair that already holds", () => {
    expect(ruleSentence(parseRuleFixes(rawRule({ fixes: [], fixes_found: 0 }))!)).toContain(NO_RESULT);
    const locked = rawRule({ a: { act_id: "ann", act: "Ann Arbor", locked: true, place: "Main 20:00-21:30" } });
    expect(ruleSentence(parseRuleFixes(locked)!)).toContain("Ann Arbor is locked, so only Bo Diddly Squat can move.");
    const both = rawRule({
      a: { act_id: "ann", act: "Ann Arbor", locked: true, place: "x" },
      b: { act_id: "bo", act: "Bo Diddly Squat", locked: true, place: "y" },
      fixes: [],
    });
    expect(ruleSentence(parseRuleFixes(both)!)).toBe(
      `If a rule says Ann Arbor and Bo Diddly Squat must never overlap: ${BOTH_LOCKED}`,
    );
    expect(lockedNote(parseRuleFixes(both)!)).toBeNull();
    expect(ruleSentence(parseRuleFixes(rawRule({ holds: true, fixes: [], shared_minutes: 0 }))!)).toBeNull();
  });

  it("uses none of the words the round forbids", () => {
    const rule = parseRuleFixes(rawRule())!;
    const all = [ruleSentence(rule, 104.2), previewAnnouncement(rule.fixes[0]), SEARCH_COVERS].join(" ");
    for (const pattern of [/optimi[sz]/i, /improve/i, /recommend/i, /validated/i, /\bfix/i, /riders/i, /\bevery (place|swap)\b/i, /keeps all rules/i]) {
      expect(all).not.toMatch(pattern);
    }
  });
});

describe("fixGhosts", () => {
  it("draws one ghost per moved set", () => {
    const ghosts = fixGhosts(parseRuleFixes(rawRule())!.fixes[0]);
    expect(ghosts).toEqual([
      { actId: "ann", stageId: "side", day: 0, start: 1290, end: 1380 },
      { actId: "bo", stageId: "main", day: 0, start: 1200, end: 1290 },
    ]);
  });

  it("carries a set that ends past midnight", () => {
    const rule = parseRuleFixes(rawRule({ fixes: [rawFix({ moves: [rawMove({ start: "23:30", end: "00:30" })] })] }))!;
    expect(fixGhosts(rule.fixes[0])[0]).toMatchObject({ start: 1410, end: 1470 });
  });
});

describe("fixStep", () => {
  it("turns a listed change into one step with its pair and its moves in the listed order", () => {
    const rule = parseRuleFixes(rawRule())!;
    expect(fixStep(rule, rule.fixes[0])).toEqual({
      rule: { aId: "ann", bId: "bo" },
      moves: [
        { actId: "ann", stageId: "side", day: 0, start: "21:30" },
        { actId: "bo", stageId: "main", day: 0, start: "20:00" },
      ],
    });
    const one = parseRuleFixes(rawRule({ fixes: [rawFix({ sets_moved: 1, moves: [rawMove()] })] }))!;
    expect(fixStep(one, one.fixes[0])?.moves).toHaveLength(1);
  });

  it("refuses a change that cannot be sent as a step, and never throws", () => {
    const rule = parseRuleFixes(rawRule())!;
    const fix = rule.fixes[0];
    const three = { ...fix, moves: [...fix.moves, { ...fix.moves[0], actId: "cy" }] };
    expect(fixStep(rule, three)).toBeNull();
    expect(fixStep(rule, { ...fix, moves: [] })).toBeNull();
    expect(fixStep(rule, { ...fix, moves: [fix.moves[0], fix.moves[0]] })).toBeNull();
    expect(fixStep(rule, { ...fix, moves: [{ ...fix.moves[0], day: 14 }] })).toBeNull();
    expect(fixStep(rule, { ...fix, moves: [{ ...fix.moves[0], day: 0.5 }] })).toBeNull();
    expect(fixStep(rule, { ...fix, moves: [{ ...fix.moves[0], start: "21:30:00" }] })).toBeNull();
    expect(fixStep(rule, { ...fix, moves: [{ ...fix.moves[0], stageId: "../x" }] })).toBeNull();
    expect(fixStep({ a: rule.a, b: rule.a }, fix)).toBeNull();
    expect(fixStep({ a: { ...rule.a, actId: "a/b" }, b: rule.b }, fix)).toBeNull();
  });
});

describe("keeping a change", () => {
  it("announces a change as meant to keep the pair apart, before the plan's receipt says whether it does", () => {
    const rule = parseRuleFixes(rawRule())!;
    const text = "Kept a change meant to keep Ann Arbor and Bo Diddly Squat apart. Scoring your plan.";
    expect(keepAnnouncement(rule)).toBe(text);
    expect(keptChangeAnnouncement("Ann Arbor", "Bo Diddly Squat")).toBe(text);
    expect(replacedChangeAnnouncement("Ann Arbor", "Bo Diddly Squat")).toBe(
      "Replaced the earlier change for Ann Arbor and Bo Diddly Squat. Scoring your plan.",
    );
    expect(ALREADY_KEPT).toBe("Already in your plan.");
  });

  it("labels the decision card's button by what it keeps, and says it in one line with the index", () => {
    expect(keepChangeLabel(2)).toBe("Keep the two-set change");
    expect(keepChangeLabel(1)).toBe("Keep the single-set change");
    const rule = parseRuleFixes(rawRule())!;
    expect(changeSummaryLine(rule, rule.fixes[0], 104.2)).toBe(
      "To keep Ann Arbor and Bo Diddly Squat apart: Ann Arbor to Side 21:30–23:00 and Bo Diddly Squat to Main 20:00–21:30; index 104.2 → 98.4.",
    );
    // An index that goes up is said to, as a plain word.
    const higher = parseRuleFixes(rawRule({ fixes: [rawFix({ budget_after: 106.04 })] }))!;
    expect(changeSummaryLine(higher, higher.fixes[0], 104.2)).toMatch(/; index 104.2 → 106.0, higher.$/);
    const none = parseRuleFixes(rawRule({ fixes: [rawFix({ budget_after: null })] }))!;
    expect(changeSummaryLine(none, none.fixes[0], 104.2)).toMatch(/Main 20:00–21:30.$/);
  });

  it("warns on a row when the plan already moves one of its sets or the pair", () => {
    const rule = parseRuleFixes(rawRule())!;
    const fix = rule.fixes[0];
    expect(plannedNote(rule, fix, new Set())).toBeNull();
    expect(plannedNote(rule, fix, new Set(["zed"]))).toBeNull();
    expect(plannedNote(rule, fix, new Set(["ann"]))).toBe(
      "Found on the published day; your plan already moves Ann Arbor, so the index with your plan applied is what counts.",
    );
    expect(plannedNote(rule, fix, new Set(["bo", "ann"]))).toBe(
      "Found on the published day; your plan already moves Ann Arbor and Bo Diddly Squat, so the index with your plan applied is what counts.",
    );
  });

  it("glosses a stage-fit flag as the engine reads it", () => {
    expect(STAGE_FIT_GLOSS).toMatch(/draw rank/);
    expect(STAGE_FIT_GLOSS).toMatch(/size tier of its stage/);
    expect(STAGE_FIT_GLOSS).toMatch(/as this app reads it/);
  });

  it("says why a change has no room in the plan", () => {
    expect(roomNote(2, 1)).toBe("This change uses 2 moves and your plan has 1 left.");
    expect(roomNote(1, 0)).toBe("Your plan holds 8 moves, the most it can. Undo one or start over.");
    expect(roomNote(2, -1)).toBe("Your plan holds 8 moves, the most it can. Undo one or start over.");
  });
});

describe("collapseSimilar", () => {
  const fixOf = (annStart: string, overrides: Raw = {}) => {
    const rule = parseRuleFixes({
      ...rawRule(),
      fixes: [rawFix({ moves: [rawMove({ start: annStart }), rawMove({ act_id: "bo", act: "Bo Diddly Squat", stage_id: "main", stage: "Main", start: "20:00", end: "21:30", from: "Side 20:30-22:00", minutes_moved: 30 })], ...overrides })],
    });
    return rule!.fixes[0];
  };

  it("joins changes that move the same sets to the same stages with starts within five minutes", () => {
    const lead = fixOf("21:30");
    expect(isSimilar(lead, fixOf("21:35"))).toBe(true);
    expect(isSimilar(lead, fixOf("21:25"))).toBe(true);
    expect(isSimilar(lead, fixOf("21:40"))).toBe(false);
    const other = rawFix({ moves: [rawMove({ stage_id: "main", stage: "Main", start: "21:30" })] });
    expect(isSimilar(lead, parseRuleFixes({ ...rawRule(), fixes: [other] })!.fixes[0])).toBe(false);
  });

  it("lists the lead of each group once, with how many it stands for, and caps the rows", () => {
    const fixes = [fixOf("21:30"), fixOf("21:35"), fixOf("22:30"), fixOf("21:25"), fixOf("22:35"), fixOf("23:30"), fixOf("23:45")];
    const rows = collapseSimilar(fixes);
    expect(rows.map((row) => [row.fix.moves[0].start, row.similar])).toEqual([
      ["21:30", 2],
      ["22:30", 1],
      ["23:30", 0],
    ]);
    expect(rows.length).toBeLessThanOrEqual(PANEL_ROWS);
    // The last change did not fit a fourth row, so the rows stand for six of the seven; the route's count is separate.
    expect(rowsCover(rows)).toBe(6);
    expect(similarLine(2)).toBe("and 2 similar places, within 5 minutes of these start times");
    expect(similarLine(1)).toBe("and 1 similar place, within 5 minutes of these start times");
  });
});
