import { describe, expect, it } from "vitest";

import {
  CHECK_LIMITS,
  findBreaks,
  findShared,
  runCheck,
  type CheckInput,
  type CheckReport,
  type CheckSet,
} from "@/lib/check";
import { SAMPLE_GRID, SAMPLE_SETTINGS } from "@/lib/check-sample";
import {
  TRIAL_COPY,
  TRIAL_LIMITS,
  applyChange,
  confirmChange,
  daySpan,
  findChange,
  gridText,
  raisesSharedTotal,
  sharedEffect,
  sharedRiseLine,
  sizeLine,
  targetId,
  targetOfBreak,
  targetOfPair,
  tradeOffOf,
  trialSteps,
  type TrialChange,
  type TrialTarget,
} from "@/lib/check-trial";
import vectors from "@/lib/fixtures/check-vectors.json";

// Every name and time below is invented for the test.

type VectorTrial = {
  target: { kind: "break"; rule: 1 | 2 | 3 | 4 | 5; rows: number[] } | { kind: "shared"; rows: [number, number] };
  change: { moves: { row: number; stage: string; start: number; end: number }[]; shared_pairs_after: number } | null;
};
type Vector = {
  name: string;
  rows: string[][];
  settings: { changeover: string; curfew: string; pairs: string[][] };
  trials?: VectorTrial[];
};
const VECTORS = vectors as Vector[];

function reportOf(input: CheckInput): CheckReport {
  const outcome = runCheck(input);
  if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
  return outcome.report;
}

function sample(): CheckReport {
  return reportOf({ grid: SAMPLE_GRID, ...SAMPLE_SETTINGS });
}

function plain(grid: string, extra: Partial<CheckInput> = {}): CheckReport {
  return reportOf({ grid, changeover: "", curfew: "", pairs: "", ...extra });
}

/** The change judged by the page's own rules (`findBreaks`, `findShared`): nothing here uses the search's shortcut. */
function judge(report: CheckReport, target: TrialTarget, change: Pick<TrialChange, "moves">): "valid" | "invalid" {
  return confirmChange(report, target, change) ? "valid" : "invalid";
}

function breakTarget(report: CheckReport, rule: number): TrialTarget {
  const found = report.breaks.find((item) => item.rule === rule);
  if (!found) throw new Error(`no rule ${rule} break`);
  return targetOfBreak(found);
}

function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("the sample: each planted break gets a result", () => {
  const report = sample();

  it("lists changes for all four breaks, each re-tested with the page's own rules", () => {
    expect(report.breaks).toHaveLength(4);
    for (const item of report.breaks) {
      const target = targetOfBreak(item);
      const result = findChange(report, target);
      expect(result.tested).toBeGreaterThan(0);
      expect(result.tested).toBeLessThanOrEqual(TRIAL_LIMITS.candidates);
      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.changes.length).toBeLessThanOrEqual(TRIAL_LIMITS.shown);
      for (const change of result.changes) {
        expect(judge(report, target, change)).toBe("valid");
        const after = applyChange(report, change);
        expect(after.breaks.length).toBeLessThan(report.breaks.length);
        for (const line of change.lines) expect(line).toMatch(/^.+ → .+ \d\d:\d\d–\d\d:\d\d$/);
      }
      expect(result.summary).toMatch(
        /^\d+ (within 3 hours )?found, \d+ shown: each ends it, adds no rule break and makes none larger, ranked by total start-time minutes moved, with any that create a longer overlap than they end last\. [\d,]+ candidates? tested\./,
      );
      expect(result.changes).toHaveLength(Math.min(TRIAL_LIMITS.shown, result.found));
      expect(result.summary).toContain(
        `${result.found} ${result.largeOmitted > 0 ? "within 3 hours " : ""}found, ${result.changes.length} shown`,
      );
    }
  });

  it("never moves a locked set", () => {
    const target = breakTarget(report, 5);
    const result = findChange(report, target, { shown: Infinity, everyChange: true });
    expect(result.changes.length).toBeGreaterThan(0);
    const locked = report.sets.filter((set) => set.locked).map((set) => set.row);
    expect(locked).toHaveLength(3);
    for (const change of result.changes) {
      for (const move of change.moves) expect(locked).not.toContain(move.row);
    }
  });

  it("lists a shared-time pair's changes with the pair at 0 minutes", () => {
    const pair = report.shared[0];
    const result = findChange(report, targetOfPair(pair));
    expect(result.changes.length).toBeGreaterThan(0);
    for (const change of result.changes) {
      const after = applyChange(report, change);
      expect(after.shared.some((p) => p.a.row === pair.a.row && p.b.row === pair.b.row)).toBe(false);
      expect(change.pairBefore).toBe(pair.minutes);
      expect(sharedEffect(change)).toContain(`${pair.minutes} minutes shared by the pair → 0.`);
    }
  });

  it("lists changes that leave no longer overlap first, then the least total start-time minutes moved, then less added shared time, then sets, then stage changes", () => {
    for (const item of report.breaks) {
      const result = findChange(report, targetOfBreak(item));
      const keys = result.changes.map((c) => [Number(c.longerThanEnded), c.minutesMoved, c.sharedRise, c.setsMoved, c.stageChanges]);
      expect(keys).toEqual(
        [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4]),
      );
    }
  });

  it("puts a five-minute nudge for the short changeover first, not a set count", () => {
    const [top] = findChange(report, breakTarget(report, 3)).changes;
    expect(top.minutesMoved).toBe(5);
    expect(top.setsMoved).toBe(1);
    expect(top.stageChanges).toBe(0);
    // The top change on every break is the smallest total shift listed for it among those in its tier.
    for (const item of report.breaks) {
      const result = findChange(report, targetOfBreak(item));
      const tier = result.changes.filter((c) => c.longerThanEnded === result.changes[0].longerThanEnded);
      expect(result.changes[0].minutesMoved).toBe(Math.min(...tier.map((c) => c.minutesMoved)));
    }
  });

  it("lists at most one change per moved set and stage, and moves no set more than three hours", () => {
    for (const item of [...report.breaks.map(targetOfBreak), ...report.shared.slice(0, 4).map(targetOfPair)]) {
      const result = findChange(report, item);
      const keys = result.changes.map((c) => c.moves.map((m) => `${m.row}:${m.stageKey}`).sort().join(","));
      expect(new Set(keys).size).toBe(keys.length);
      if (!result.onlyLarge) {
        for (const change of result.changes) expect(change.largestShift).toBeLessThanOrEqual(TRIAL_LIMITS.largeShift);
      }
      for (const change of result.changes) {
        expect(change.largestShift).toBe(Math.max(...change.moves.map((m) => Math.abs(m.start - m.fromStart))));
      }
    }
  });

  it("searches two-set changes when one-set changes exist, in the same ranking", () => {
    // The double booking has both kinds; a one-stage curfew break has no one-set move.
    const double = findChange(report, breakTarget(report, 1), { everyChange: true, shown: Infinity });
    expect(double.swapsSearched).toBe(true);
    expect(double.oneSetPassed).toBeGreaterThan(0);
    expect(double.changes.some((c) => c.setsMoved === 1)).toBe(true);
    expect(double.changes.some((c) => c.setsMoved === 2)).toBe(true);
    expect(findChange(report, breakTarget(report, 1)).summary).toContain("Two-set changes were tried as well.");
    const late = plain("A,Main,18:00,19:00\nB,Main,19:15,20:15", { changeover: "15", curfew: "20:00" });
    const curfew = findChange(late, breakTarget(late, 4));
    expect(curfew.oneSetPassed).toBe(0);
    expect(curfew.summary).toContain("No one-set move ends it, so two-set changes were tried.");
  });

  it("states the shared-time rise of a change exactly, from the page's own pair list", () => {
    const key = (p: { a: { row: number }; b: { row: number } }) => `${Math.min(p.a.row, p.b.row)}-${Math.max(p.a.row, p.b.row)}`;
    for (const item of report.breaks) {
      for (const change of findChange(report, targetOfBreak(item)).changes) {
        const after = applyChange(report, change);
        const was = new Map(report.shared.map((p) => [key(p), p.minutes]));
        let rise = 0;
        for (const p of after.shared) rise += Math.max(0, p.minutes - (was.get(key(p)) ?? 0));
        expect(change.sharedRise).toBe(rise);
        const net = after.shared.reduce((n, p) => n + p.minutes, 0) - report.shared.reduce((n, p) => n + p.minutes, 0);
        expect(change.sharedAfter.minutes - change.sharedBefore.minutes).toBe(net);
        expect(raisesSharedTotal(change)).toBe(net > 0);
        const line = sharedRiseLine(change);
        if (net > 0) {
          // The warning is the gross rise on the pairs that get longer; the grid line keeps the net change.
          expect(rise).toBeGreaterThanOrEqual(net);
          expect(line).toContain(`Shared time elsewhere rises by ${rise} ${rise === 1 ? "minute" : "minutes"}.`);
          if (rise > net) expect(line).toContain(`the grid total rises by ${net} ${net === 1 ? "minute" : "minutes"}.`);
        } else if (rise > 0) {
          expect(line).toMatch(/^Some overlaps elsewhere get \d+ minutes? longer in all; others get shorter, so the grid total (falls|stays the same)\.$/);
        } else expect(line).toBeNull();
      }
    }
  });

  it("warns with the gross rise elsewhere, not the net change: 30 minutes down on one pair, 45 up on another", () => {
    const change = {
      sharedRise: 45,
      pairBefore: null,
      sharedBefore: { pairs: 4, minutes: 100 },
      sharedAfter: { pairs: 4, minutes: 115 },
    } as TrialChange;
    const line = sharedRiseLine(change);
    expect(line).toBe("Shared time elsewhere rises by 45 minutes. Other overlaps get shorter, so the grid total rises by 15 minutes.");
    expect(sharedEffect(change)).toContain("sharing 100 minutes → 4 pairs sharing 115 minutes");
    // No pair shrinks: gross and net are the same number, and the line is the plain one.
    expect(sharedRiseLine({ ...change, sharedRise: 15 } as TrialChange)).toBe("Shared time elsewhere rises by 15 minutes.");
  });

  it("keeps every new place inside the day's span, and one-set moves on the 5-minute grid", () => {
    const [from, to] = daySpan(report);
    for (const item of report.breaks) {
      for (const change of findChange(report, targetOfBreak(item), { shown: Infinity, everyChange: true }).changes) {
        for (const move of change.moves) {
          expect(move.start).toBeGreaterThanOrEqual(from);
          expect(move.end).toBeLessThanOrEqual(to);
          const original = report.sets.find((set) => set.row === move.row) as CheckSet;
          expect(move.end - move.start).toBe(original.end - original.start);
        }
        // A set may also take another set's exact start, which can be off the 5-minute grid.
        if (change.setsMoved === 1 && change.moves[0].start % TRIAL_LIMITS.grid !== 0) {
          expect(
            report.sets.some((set) => set.start === change.moves[0].start && set.stageKey === change.moves[0].stageKey),
          ).toBe(true);
        }
      }
    }
  });

  it("does not change the report it was given", () => {
    const before = JSON.stringify(report);
    for (const item of report.breaks) findChange(report, targetOfBreak(item));
    findChange(report, targetOfPair(report.shared[0]));
    expect(JSON.stringify(report)).toBe(before);
  });

  it("words the effect on shared time and the size of a change", () => {
    const [change] = findChange(report, breakTarget(report, 3)).changes;
    expect(sharedEffect(change)).toMatch(
      /^Across the grid: \d+ pairs? sharing \d+ minutes? → \d+ pairs? sharing \d+ minutes?\.$/,
    );
    expect(sizeLine(change)).toMatch(/^(One set|Two sets) moved; \d+ minutes? of start time; \d+ stage changes?\.$/);
  });
});

describe("what the search says when it cannot help", () => {
  it("says so plainly when nothing ends the break within the grid it searched", () => {
    // One stage, no room: two sets fill the whole day and the gap between them is short.
    const report = plain("A,Main,18:00,19:00\nB,Main,19:05,20:00", { changeover: "15" });
    const target = breakTarget(report, 3);
    const result = findChange(report, target);
    expect(result.changes).toEqual([]);
    expect(result.found).toBe(0);
    expect(result.capped).toBe(false);
    expect(result.summary).toBe(
      `No one-set move ends it, so two-set changes were tried. This search found no change that ends it within ${result.tested.toLocaleString("en-US")} candidates, on the 5-minute grid or into another set’s start time; it did not look for longer chains.`,
    );
  });

  it("stops at the bound and says it did", () => {
    const report = plain("A,Main,18:00,19:00\nB,Main,19:05,20:00", { changeover: "15" });
    const result = findChange(report, breakTarget(report, 3), { bound: 7 });
    expect(result.capped).toBe(true);
    expect(result.tested).toBe(7);
    expect(result.summary).toContain("within 7 candidates (the limit)");
    expect(result.summary).toContain("it did not look for longer chains");
    const day = sample();
    const found = findChange(day, breakTarget(day, 4), { bound: 60 });
    expect(found.capped).toBe(true);
    expect(found.summary).toContain("limit");
  });

  it("names a break whose sets are all locked", () => {
    const report = plain(
      "act,stage,start,end,locked\nA,Main,18:00,19:00,yes\nB,Main,19:05,20:00,yes\nC,Side,18:00,19:00",
      { changeover: "15" },
    );
    const result = findChange(report, breakTarget(report, 3));
    expect(result.allLocked).toBe(true);
    expect(result.tested).toBe(0);
    expect(result.summary).toBe("Both sets in this break are marked locked, and this search does not move locked sets.");
  });

  it("says both sets of a locked pair are marked locked, and names a single locked set", () => {
    const report = plain(
      "act,stage,start,end,locked\nA,Main,18:00,19:00,yes\nB,Side,18:30,19:30,yes\nC,Tent,20:00,21:30,yes",
      { curfew: "21:00" },
    );
    const pair = findChange(report, targetOfPair(report.shared[0]));
    expect(pair.allLocked).toBe(true);
    expect(pair.summary).toBe("Both sets of this pair are marked locked, and this search does not move locked sets.");
    const curfew = findChange(report, breakTarget(report, 4));
    expect(curfew.summary).toBe("The set in this break is marked locked, and this search does not move locked sets.");
  });

  it("lists a move of more than three hours only when nothing smaller exists, and says so", () => {
    // Side is full all day and Tent is free only before 10:00, so A or B can also go to Tent at the far
    // end of the day shift, but near moves exist on Main (A before B, or a stage change at the same time).
    const near = plain(
      [
        "Early,Tent,08:00,08:30",
        "Fill,Side,12:00,23:00",
        "A,Main,18:00,19:00",
        "B,Main,18:30,19:30",
        "Hold,Main,19:30,23:00",
        "Gone,Main,17:00,17:30",
      ].join("\n"),
      { pairs: "A | B", changeover: "0" },
    );
    const everything = findChange(near, breakTarget(near, 5), { everyChange: true, shown: Infinity });
    expect(everything.changes.some((c) => c.largestShift > TRIAL_LIMITS.largeShift)).toBe(true);
    const listed = findChange(near, breakTarget(near, 5), { shown: Infinity });
    expect(listed.onlyLarge).toBe(false);
    expect(listed.largeOmitted).toBeGreaterThan(0);
    for (const c of listed.changes) expect(c.largestShift).toBeLessThanOrEqual(TRIAL_LIMITS.largeShift);
    expect(listed.summary).toMatch(/\d+ more changes? moves? a set by more than 3 hours and (is|are) not listed/);
    // The two counts add up in the words: "N within 3 hours found, ... M more ... (N+M found in all)".
    expect(listed.summary).toContain(`${listed.found} within 3 hours found, ${listed.changes.length} shown`);
    expect(listed.summary).toContain(`(${listed.found + listed.largeOmitted} found in all)`);

    // Only far moves end it: they are listed, with the reason.
    const far = plain(
      [
        "Early,Side,08:00,08:30",
        "FillS,Side,08:30,23:00",
        "FillA,Main,09:00,18:00",
        "A,Main,18:00,19:00",
        "B,Main,18:30,19:30",
        "FillB,Main,19:30,23:00",
      ].join("\n"),
      { pairs: "A | B", changeover: "0" },
    );
    const farResult = findChange(far, breakTarget(far, 5));
    expect(farResult.changes.length).toBeGreaterThan(0);
    expect(farResult.onlyLarge).toBe(true);
    expect(farResult.largeOmitted).toBe(0);
    for (const c of farResult.changes) expect(c.largestShift).toBeGreaterThan(TRIAL_LIMITS.largeShift);
    expect(farResult.summary).toContain(
      "Every change found moves a set by more than 3 hours; they are listed because nothing smaller ends it.",
    );
  });

  it("ranks a change that adds shared time elsewhere after one that does not, at equal size", () => {
    // Moving A 10 minutes earlier ends the short changeover but runs into C by 5 minutes; moving B
    // 10 minutes later ends it too and runs into nothing. Both are 10 minutes of start time.
    const day = plain(
      [
        "C,Side,17:00,17:55",
        "A,Main,18:00,19:00",
        "B,Main,19:05,20:00",
        "D,Side,19:10,19:55",
        "Tent set,Tent,17:00,20:30",
      ].join("\n"),
      { changeover: "15" },
    );
    const result = findChange(day, breakTarget(day, 3), { shown: Infinity });
    const tens = result.changes.filter((c) => c.minutesMoved === 10 && c.setsMoved === 1);
    expect(tens.map((c) => [c.moves[0].act, c.sharedRise])).toEqual([
      ["B", 0],
      ["A", 5],
    ]);
    expect(result.changes.indexOf(tens[0])).toBeLessThan(result.changes.indexOf(tens[1]));
  });

  it("includes a set taking another set's exact start, off the 5-minute grid", () => {
    // Y plays inside X on Main (a rule-2 break that is already there, 33 minutes). X moving to start with Y
    // ends the short gap after Z and keeps that overlap at 33, so it is a valid one-set move at 18:17.
    const day = plain(["Z,Main,17:00,17:55", "X,Main,18:00,19:30", "Y,Main,18:17,18:50", "Last,Side,20:00,21:00"].join("\n"), { changeover: "15" });
    const target = breakTarget(day, 3);
    const every = findChange(day, target, { everyChange: true, shown: Infinity });
    const take = every.changes.find((c) => c.setsMoved === 1 && c.moves[0].row === 2 && c.moves[0].start === 18 * 60 + 17);
    expect(take).toBeDefined();
    expect(judge(day, target, take as TrialChange)).toBe("valid");
    expect(every.oneSetPassed).toBeGreaterThan(0);
  });

  it("does not count a change that adds a rule break", () => {
    const report = plain("A,Main,18:00,19:00\nB,Main,18:30,19:30\nC,Side,19:30,20:30", { pairs: "A | B" });
    const target = breakTarget(report, 5);
    const result = findChange(report, target, { shown: Infinity });
    expect(result.changes.length).toBeGreaterThan(0);
    for (const change of result.changes) {
      const after = applyChange(report, change);
      expect(after.breaks).toEqual([]);
    }
  });

  it("never lets a break that is already there get larger", () => {
    // B already overlaps D on Side by 30 minutes (rule 2). Ending the A | B break must not make that worse.
    const report = plain("A,Main,18:00,19:00\nB,Side,18:30,19:30\nD,Side,19:00,20:00\nE,Tent,20:00,21:00", {
      pairs: "A | B",
    });
    const target = breakTarget(report, 5);
    const sharedMinutes = (r: CheckReport) =>
      Number(/(\d+) minutes? shared/.exec(r.breaks.find((b) => b.rule === 2)?.detail ?? "")?.[1] ?? 0);
    expect(sharedMinutes(report)).toBe(30);
    const result = findChange(report, target, { shown: Infinity });
    expect(result.changes.length).toBeGreaterThan(0);
    for (const change of result.changes) {
      expect(sharedMinutes(applyChange(report, change))).toBeLessThanOrEqual(30);
    }
    // Moving B to start between 19:00 and 19:30 on Side would end the A | B break but grow its overlap with D past 30: not listed.
    expect(
      result.changes.some((c) => c.setsMoved === 1 && c.moves[0].row === 2 && c.moves[0].stage === "Side" && c.moves[0].start >= 1140 && c.moves[0].start < 1170),
    ).toBe(false);
  });
});

/** Every one-set move for the target's movable sets, judged with the full rules (no shortcuts). */
function bruteSingles(report: CheckReport, target: TrialTarget): Set<string> {
  const [from, to] = daySpan(report);
  const stages = [...new Map(report.sets.map((s) => [s.stageKey, s.stage])).entries()];
  const found = new Set<string>();
  for (const row of target.rows) {
    const set = report.sets.find((s) => s.row === row) as CheckSet;
    if (set.locked) continue;
    const length = set.end - set.start;
    for (const [stageKey, stage] of stages) {
      for (let start = Math.ceil(from / 5) * 5; start + length <= to; start += 5) {
        if (stageKey === set.stageKey && start === set.start) continue;
        const move = {
          row,
          act: set.act,
          stage,
          stageKey,
          fromStage: set.stage,
          fromStart: set.start,
          fromEnd: set.end,
          start,
          end: start + length,
        };
        if (confirmChange(report, target, { moves: [move] })) found.add(`${row}:${stageKey}:${start}`);
      }
    }
    // Also the set taking another set's exact stage and start, off the 5-minute grid.
    for (const other of report.sets) {
      if (other.row === row || other.start % 5 === 0) continue;
      if (other.start < from || other.start + length > to) continue;
      if (other.stageKey === set.stageKey && other.start === set.start) continue;
      const move = {
        row,
        act: set.act,
        stage: other.stage,
        stageKey: other.stageKey,
        fromStage: set.stage,
        fromStart: set.start,
        fromEnd: set.end,
        start: other.start,
        end: other.start + length,
      };
      if (confirmChange(report, target, { moves: [move] })) found.add(`${row}:${other.stageKey}:${other.start}`);
    }
  }
  return found;
}

function clock(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A small invented day; with `jitter`, set lengths carry odd minutes so some starts fall off the 5-minute grid. */
function randomDay(seed: number, jitter = false): CheckReport | null {
  const next = rng(seed);
  const rows: string[] = [];
  const stages = ["Main", "Side", "Tent"].slice(0, 2 + Math.floor(next() * 2));
  let id = 0;
  for (const stage of stages) {
    let t = 18 * 60;
    const count = 2 + Math.floor(next() * 3);
    for (let k = 0; k < count; k += 1) {
      const length = [30, 45, 60][Math.floor(next() * 3)] + (jitter ? Math.floor(next() * 5) : 0);
      const end = t + length;
      rows.push(`Act${String.fromCharCode(65 + id)},${stage},${clock(t)},${clock(end)}${next() < 0.15 ? ",yes" : ""}`);
      id += 1;
      // With jitter, a shorter set sometimes plays inside this one on the same stage at an odd minute,
      // so the day already has an overlap and another set's start is off the 5-minute grid.
      if (jitter && next() < 0.4) {
        const inner = t + 3 + Math.floor(next() * 12);
        rows.push(`Act${String.fromCharCode(65 + id)},${stage},${clock(inner)},${clock(Math.min(end, inner + 20 + Math.floor(next() * 9)))}`);
        id += 1;
      }
      t = end + [0, 5, 10, 15, 20, 30][Math.floor(next() * 6)];
    }
  }
  const outcome = runCheck({
    grid: rows.join("\n"),
    changeover: String([10, 15, 20][Math.floor(next() * 3)]),
    curfew: next() < 0.5 ? "" : `${19 + Math.floor(next() * 3)}:${next() < 0.5 ? "00" : "30"}`,
    pairs: next() < 0.5 ? "ActA | ActD" : "",
  });
  return outcome.ok ? outcome.report : null;
}

describe("the search against a brute-force check with the page's own rules", { timeout: 60_000 }, () => {
  it("finds exactly the one-set moves the full rule check accepts, on random small days", () => {
    let compared = 0;
    let withMoves = 0;
    for (let seed = 1; seed <= 220; seed += 1) {
      const report = randomDay(seed);
      if (!report || report.breaks.length === 0) continue;
      const targets: TrialTarget[] = [
        ...report.breaks.map(targetOfBreak),
        ...report.shared.slice(0, 2).map(targetOfPair),
      ];
      for (const target of targets) {
        const result = findChange(report, target, { shown: Infinity, everyChange: true });
        const searched = new Set(
          result.changes
            .filter((c) => c.setsMoved === 1)
            .map((c) => `${c.moves[0].row}:${c.moves[0].stageKey}:${c.moves[0].start}`),
        );
        const brute = bruteSingles(report, target);
        expect([...searched].sort()).toEqual([...brute].sort());
        compared += 1;
        if (brute.size > 0) withMoves += 1;
        // Every change it lists, one-set or two-set, passes the full rules.
        for (const change of result.changes) expect(judge(report, target, change)).toBe("valid");
      }
    }
    expect(compared).toBeGreaterThan(80);
    expect(withMoves).toBeGreaterThan(40);
  });

  it("finds the one-set moves into another set's start too, on days whose starts are off the 5-minute grid", () => {
    let compared = 0;
    let offGrid = 0;
    for (let seed = 1; seed <= 140; seed += 1) {
      const report = randomDay(seed, true);
      if (!report || report.breaks.length === 0) continue;
      const targets: TrialTarget[] = [
        ...report.breaks.map(targetOfBreak),
        ...report.shared.slice(0, 2).map(targetOfPair),
      ];
      for (const target of targets) {
        const result = findChange(report, target, { shown: Infinity, everyChange: true });
        const singles = result.changes.filter((c) => c.setsMoved === 1);
        const searched = new Set(singles.map((c) => `${c.moves[0].row}:${c.moves[0].stageKey}:${c.moves[0].start}`));
        const brute = bruteSingles(report, target);
        expect([...searched].sort()).toEqual([...brute].sort());
        compared += 1;
        offGrid += singles.filter((c) => c.moves[0].start % TRIAL_LIMITS.grid !== 0).length;
        for (const change of result.changes) expect(judge(report, target, change)).toBe("valid");
      }
    }
    expect(compared).toBeGreaterThan(80);
    expect(offGrid).toBeGreaterThan(0);
  });

  it("ranks by total minutes: the top listed change moves no more minutes than any one-set move within three hours", () => {
    let compared = 0;
    for (let seed = 1; seed <= 220; seed += 1) {
      const report = randomDay(seed, seed % 2 === 0);
      if (!report) continue;
      for (const item of report.breaks) {
        const target = targetOfBreak(item);
        const result = findChange(report, target, {});
        if (result.changes.length === 0) continue;
        const keys = result.changes.map((c) => [Number(c.longerThanEnded), c.minutesMoved, c.sharedRise, c.setsMoved, c.stageChanges]);
        expect(keys).toEqual(
          [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4]),
        );
        // One-set moves in the top change's tier: none that leaves a longer overlap may beat one that does not.
        const minutes = [...bruteSingles(report, target)]
          .flatMap((id) => {
            const [row, stageKey, start] = id.split(":");
            const set = report.sets.find((s) => s.row === Number(row)) as CheckSet;
            const after = applyChange(report, {
              moves: [
                {
                  row: set.row,
                  act: set.act,
                  stage: set.stage,
                  stageKey,
                  fromStage: set.stage,
                  fromStart: set.start,
                  fromEnd: set.end,
                  start: Number(start),
                  end: Number(start) + set.end - set.start,
                },
              ],
            });
            const { longer } = tradeOffOf(report, after, target, [{ row: set.row }]);
            return longer === result.changes[0].longerThanEnded ? [Math.abs(Number(start) - set.start)] : [];
          })
          .filter((m) => m <= TRIAL_LIMITS.largeShift);
        if (minutes.length > 0) {
          expect(result.changes[0].minutesMoved).toBeLessThanOrEqual(Math.min(...minutes));
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(40);
  });

  it("lists two-set changes that pass the full rules and that no single move could replace", () => {
    let swaps = 0;
    for (let seed = 1; seed <= 220; seed += 1) {
      const report = randomDay(seed);
      if (!report) continue;
      for (const item of report.breaks) {
        const target = targetOfBreak(item);
        const result = findChange(report, target, { shown: Infinity, everyChange: true });
        for (const change of result.changes.filter((c) => c.setsMoved === 2)) {
          swaps += 1;
          expect(judge(report, target, change)).toBe("valid");
          for (const move of change.moves) {
            expect(judge(report, target, { moves: [move] })).toBe("invalid");
          }
        }
      }
    }
    expect(swaps).toBeGreaterThan(20);
  });
});

describe("the recorded changes (shared with the engine parity test)", () => {
  const withTrials = VECTORS.filter((v) => v.trials !== undefined);

  it("has trials on enough vectors, including one with no change and one that needs a swap", () => {
    expect(withTrials.length).toBeGreaterThanOrEqual(6);
    const all = withTrials.flatMap((v) => v.trials as VectorTrial[]);
    expect(all.some((t) => t.change === null)).toBe(true);
    expect(all.some((t) => t.change !== null && t.change.moves.length === 2)).toBe(true);
    expect(all.some((t) => t.change !== null && t.change.moves.length === 1)).toBe(true);
    expect(all.some((t) => t.target.kind === "shared")).toBe(true);
    for (const rule of [3, 4, 5]) {
      expect(all.some((t) => t.target.kind === "break" && t.target.rule === rule && t.change !== null)).toBe(true);
    }
  });

  for (const vector of withTrials) {
    it(`${vector.name}: the first change the search lists is the recorded one`, () => {
      const report = reportOf({
        grid: vector.rows.map((row) => row.join(",")).join("\n"),
        changeover: vector.settings.changeover,
        curfew: vector.settings.curfew,
        pairs: vector.settings.pairs.map(([a, b]) => `${a} | ${b}`).join("\n"),
      });
      for (const trial of vector.trials as VectorTrial[]) {
        const target: TrialTarget =
          trial.target.kind === "break"
            ? { kind: "break", rule: trial.target.rule, rows: trial.target.rows }
            : { kind: "shared", rows: trial.target.rows };
        const result = findChange(report, target);
        if (trial.change === null) {
          expect(result.changes).toEqual([]);
          continue;
        }
        const [first] = result.changes;
        expect(first.moves.map(({ row, stage, start, end }) => ({ row, stage, start, end }))).toEqual(
          trial.change.moves,
        );
        expect(first.sharedAfter.pairs).toBe(trial.change.shared_pairs_after);
      }
    });
  }
});

describe("applying a change to a working copy", () => {
  it("moves the sets, keeps the settings and runs the rules again", () => {
    const report = sample();
    const [change] = findChange(report, breakTarget(report, 3)).changes;
    const working = applyChange(report, change);
    expect(working.sets).toHaveLength(report.sets.length);
    expect(working.settings.changeover).toBe(report.settings.changeover);
    expect(working.settings.curfew).toBe(report.settings.curfew);
    expect(working.breaks.map((b) => b.rule)).toEqual([1, 4, 5]);
    expect(working.breaks).toEqual(findBreaks(working.sets, working.settings));
    expect(working.shared).toEqual(findShared(working.sets));
    // The pasted report is untouched.
    expect(report.breaks).toHaveLength(4);
    // The pair rule follows the moved sets.
    const pair = working.settings.pairs[0];
    expect(working.sets).toContain(pair.a);
    expect(working.sets).toContain(pair.b);
  });

  it("writes the working grid as text that reads back to the same breaks", () => {
    const report = sample();
    const [change] = findChange(report, breakTarget(report, 4)).changes;
    const working = applyChange(report, change);
    const again = runCheck({ grid: gridText(working.sets), ...SAMPLE_SETTINGS });
    if (!again.ok) throw new Error(again.errors.join(" | "));
    expect(again.report.breaks.map((b) => b.text)).toEqual(working.breaks.map((b) => b.text));
    expect(again.report.sets.map((s) => [s.act, s.stage, s.start, s.end, s.locked])).toEqual(
      working.sets.map((s) => [s.act, s.stage, s.start, s.end, s.locked]),
    );
  });

  it("quotes a name with a comma or a quote", () => {
    const report = plain('"Smith, Jo",Main,18:00,19:00\n"He said ""hi""",Side,18:30,19:30,yes');
    const again = reportOf({ grid: gridText(report.sets), changeover: "", curfew: "", pairs: "" });
    expect(again.sets.map((s) => s.act)).toEqual(["Smith, Jo", 'He said "hi"']);
    expect(again.lockedCount).toBe(1);
  });

  it("can be searched again: a second change on the working copy", () => {
    const report = sample();
    const first = findChange(report, breakTarget(report, 3)).changes[0];
    const working = applyChange(report, first);
    const second = findChange(working, breakTarget(working, 5), { span: daySpan(report) });
    expect(second.changes.length).toBeGreaterThan(0);
    const again = applyChange(working, second.changes[0]);
    expect(again.breaks.map((b) => b.rule)).toEqual([1, 4]);
  });
});

describe("running in chunks", () => {
  it("yields progress between chunks and gives the same answer as the whole search", () => {
    const report = sample();
    const target = breakTarget(report, 4);
    const steps = trialSteps(report, target, { chunk: 100 });
    const seen: number[] = [];
    for (;;) {
      const next = steps.next();
      if (next.done) {
        expect(next.value.tested).toBeGreaterThan(0);
        expect(next.value.summary).toBe(findChange(report, target).summary);
        break;
      }
      expect(next.value.bound).toBe(TRIAL_LIMITS.candidates);
      seen.push(next.value.tested);
    }
    expect(seen.length).toBeGreaterThan(3);
    expect([...seen]).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe("a 60-set grid", () => {
  /** Ten stages, six sets each, packed with changeovers on the edge: the largest grid the page accepts. */
  function crowded(): CheckReport {
    const rows: string[] = [];
    for (let s = 0; s < CHECK_LIMITS.stages; s += 1) {
      let t = 12 * 60 + s * 5;
      for (let k = 0; k < 6; k += 1) {
        const length = 50 + ((s + k) % 3) * 5;
        const end = t + length;
        rows.push(`Act ${s}-${k},Stage ${s},${clock(t)},${clock(end)}`);
        t = end + (k % 2 === 0 ? 10 : 15);
      }
    }
    return reportOf({
      grid: rows.join("\n"),
      changeover: "15",
      curfew: "",
      pairs: "Act 0-1 | Act 1-2\nAct 3-3 | Act 4-3",
    });
  }

  it("finishes every search under 300 ms and stays inside the bound", () => {
    const report = crowded();
    expect(report.sets).toHaveLength(60);
    expect(report.breaks.length).toBeGreaterThan(3);
    const targets: TrialTarget[] = [
      ...report.breaks.slice(0, 8).map(targetOfBreak),
      ...report.shared.slice(0, 3).map(targetOfPair),
    ];
    for (const target of targets) {
      const started = performance.now();
      const result = findChange(report, target);
      const ms = performance.now() - started;
      expect(result.tested).toBeLessThanOrEqual(TRIAL_LIMITS.candidates);
      expect(ms).toBeLessThan(300);
      for (const change of result.changes) expect(judge(report, target, change)).toBe("valid");
    }
  });

  it("says it hit the limit when it does", () => {
    const report = crowded();
    const result = findChange(report, targetOfBreak(report.breaks[0]), { bound: 50 });
    expect(result.tested).toBeLessThanOrEqual(50);
    expect(result.capped).toBe(true);
    expect(result.summary).toMatch(/limit/);
  });

  it("reaches the real 20,000-candidate limit on a grid with a 120-minute changeover, in well under 300 ms", () => {
    const next = rng(4);
    const rows: string[] = [];
    for (let s = 0; s < CHECK_LIMITS.stages; s += 1) {
      let t = 12 * 60;
      for (let k = 0; k < 6; k += 1) {
        const length = 30 + Math.floor(next() * 4) * 15;
        rows.push(`Act ${s}-${k},Stage ${s},${clock(t)},${clock(t + length)}`);
        t += length + [0, 5, 10, 15, 20, 30][Math.floor(next() * 6)];
      }
    }
    const report = reportOf({ grid: rows.join("\n"), changeover: "120", curfew: "", pairs: "" });
    let hit = 0;
    for (const item of report.breaks.slice(0, 30)) {
      const started = performance.now();
      const result = findChange(report, targetOfBreak(item));
      expect(performance.now() - started).toBeLessThan(300);
      expect(result.tested).toBeLessThanOrEqual(TRIAL_LIMITS.candidates);
      if (result.capped) {
        hit += 1;
        expect(result.tested).toBe(TRIAL_LIMITS.candidates);
        expect(result.summary).toContain("20,000");
        expect(result.summary).toContain("limit");
        for (const change of result.changes) expect(judge(report, targetOfBreak(item), change)).toBe("valid");
      }
    }
    expect(hit).toBeGreaterThan(0);
  });
});

describe("the words", () => {
  const FORBIDDEN =
    /\b(optimal|optimi[sz]e\w*|improv\w*|best plan|recommend\w*|validated|proven|predicts|outperforms|significant|crowds?|headcount|revenue|resale|fix(ed|es)?)\b|same (crowd|fans|people)/i;

  it("uses none of the words the page avoids, in the fixed copy or in any sentence it writes", () => {
    const report = sample();
    const sentences: string[] = [...Object.values(TRIAL_COPY)];
    for (const item of report.breaks) {
      const result = findChange(report, targetOfBreak(item));
      sentences.push(result.summary);
      for (const change of result.changes) sentences.push(sharedEffect(change), sizeLine(change), ...change.lines);
    }
    sentences.push(findChange(report, breakTarget(report, 4), { bound: 10 }).summary);
    const tiny = plain("A,Main,18:00,19:00\nB,Main,19:05,20:00", { changeover: "15" });
    sentences.push(findChange(tiny, breakTarget(tiny, 3)).summary);
    for (const sentence of sentences) expect(sentence).not.toMatch(FORBIDDEN);
  });

  it("gives each target its own id", () => {
    const report = sample();
    const ids = [
      ...report.breaks.map((b) => targetId(targetOfBreak(b))),
      ...report.shared.map((p) => targetId(targetOfPair(p))),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
