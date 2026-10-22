import { describe, expect, it } from "vitest";

import { runCheck } from "./check";
import { SAMPLE_GRID, SAMPLE_RULES, SAMPLE_SETTINGS, dropSampleRules, onSampleDay, replacesSample } from "./check-sample";

// Every name below is invented for the test. A fresh grid that replaces the invented sample: none of its acts
// is one of the sample's.
const FRESH = [
  "Amber Kite,Main,18:00,19:00",
  "Basalt Choir,Side,18:30,19:30",
  "Copper Field,Main,19:15,20:00",
  "Dune Signal,Side,19:45,20:30",
  "Ember Coast,Tent,18:00,19:00",
  "Flint Arcade,Tent,19:30,20:30",
].join("\n");

const settings = { changeover: "", curfew: "" };

describe("round 37: a sample pair rule whose act is on a skipped line is kept, not dropped", () => {
  it("keeps the rule when one act is on a skipped line and the other is read, and the check lists it as not checked", () => {
    // Saffron Season's line cannot be read (its start is 25:70); Ivory Lights' line is read.
    const grid = `${FRESH}\nSaffron Season,Barn,25:70,22:00\nIvory Lights,Hill,21:00,22:00`;
    const drop = dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, grid);
    expect(drop).toEqual({ pairs: SAMPLE_SETTINGS.pairs, sampleRules: [...SAMPLE_RULES], removed: [] });
    const outcome = runCheck({ grid, ...settings, pairs: drop.pairs });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(replacesSample(outcome.report.sets)).toBe(true);
    expect(outcome.report.skipped?.map((item) => item.line)).toEqual([7]);
    // Round 35 R6's wording, never "neither act is in this grid".
    expect(outcome.report.uncheckedPairs).toEqual(["Pair line 1 not checked: Saffron Season is on a skipped line."]);
    expect(outcome.report.settings.pairs).toEqual([]);
  });

  it("keeps the rule when both acts are on skipped lines (the case that read \"neither act is in this grid\")", () => {
    const grid = `${FRESH}\nSaffron Season,Barn,25:70,22:00\nIvory Lights,Hill,soon,22:00`;
    const drop = dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, grid);
    expect(drop.removed).toEqual([]);
    expect(drop.pairs).toBe(SAMPLE_SETTINGS.pairs);
    const outcome = runCheck({ grid, ...settings, pairs: drop.pairs });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.skipped?.map((item) => item.line)).toEqual([7, 8]);
    expect(outcome.report.uncheckedPairs).toEqual(["Pair line 1 not checked: Saffron Season is on a skipped line."]);
  });

  it("matches a skipped line's act as the check matches names (case and spacing)", () => {
    const grid = `${FRESH}\nsaffron   SEASON,Barn,25:70,22:00\nIvory Lights,Hill,21:00,22:00`;
    expect(dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, grid).removed).toEqual([]);
  });

  it("still drops the rule when neither act is anywhere in the grid", () => {
    const drop = dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, FRESH);
    expect(drop).toEqual({
      pairs: "",
      sampleRules: [],
      removed: ['Removed the sample\'s rule "Saffron Season | Ivory Lights": neither act is in this grid.'],
    });
    const outcome = runCheck({ grid: FRESH, ...settings, pairs: drop.pairs });
    expect(outcome.ok).toBe(true);
  });

  it("still drops the rule when one act is absent, even with the other on a skipped line", () => {
    // An act on no line at all would refuse the check; the rule is the sample's, so it goes, with the reason.
    const absent = dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, `${FRESH}\nSaffron Season,Barn,21:00,22:00`);
    expect(absent.removed).toEqual(['Removed the sample\'s rule "Saffron Season | Ivory Lights": one of these acts is not in this grid.']);
    const skippedAndAbsent = dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, `${FRESH}\nSaffron Season,Barn,25:70,22:00`);
    expect(skippedAndAbsent.removed).toEqual([
      'Removed the sample\'s rule "Saffron Season | Ivory Lights": one of these acts is not in this grid.',
    ]);
    expect(skippedAndAbsent.pairs).toBe("");
  });

  it("never touches a rule the person typed, whatever its acts", () => {
    const typed = "Saffron Season | Nobody Here";
    const grid = `${FRESH}\nSaffron Season,Barn,25:70,22:00`;
    expect(dropSampleRules(typed, [], grid)).toEqual({ pairs: typed, sampleRules: [], removed: [] });
  });
});

describe("round 37 (fix pass 1): which saved compare the invented sample gets", () => {
  // The sample's own act names, read from its grid (the invented example day's lineup).
  const sampleActs = [
    ...new Set(
      SAMPLE_GRID.split("\n")
        .slice(1)
        .filter((line) => line.trim() !== "")
        .map((line) => line.split(",")[0]),
    ),
  ];

  it("says the sample's names are on the invented day, at the server's share of names", () => {
    expect(sampleActs).toHaveLength(24);
    expect(onSampleDay(sampleActs, 0.8)).toBe(true);
    // Compared as the check compares names: case and spacing do not matter.
    expect(onSampleDay(sampleActs.map((name) => `  ${name.toUpperCase().replace(" ", "   ")} `), 0.8)).toBe(true);
  });

  it("counts the share of names, so an edited sample is still on it and a replaced one is not", () => {
    const fresh = ["Amber Kite", "Basalt Choir", "Copper Field", "Dune Signal", "Ember Coast"];
    // 8 of 10 names on the sample: exactly the share.
    expect(onSampleDay([...sampleActs.slice(0, 8), ...fresh.slice(0, 2)], 0.8)).toBe(true);
    // 7 of 10: under it.
    expect(onSampleDay([...sampleActs.slice(0, 7), ...fresh.slice(0, 3)], 0.8)).toBe(false);
    expect(onSampleDay(fresh, 0.8)).toBe(false);
    expect(onSampleDay([], 0.8)).toBe(false);
  });
});
