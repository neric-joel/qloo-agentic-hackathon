import { describe, expect, it } from "vitest";

import {
  CHECK_COPY,
  CHECK_LIMITS,
  TEMPLATE_CSV,
  announcement,
  checkTimeLine,
  clip,
  formatClock,
  gridDelimiter,
  isCloseName,
  noBreaksLine,
  pairNotChecked,
  parseGrid,
  pastedLine,
  removePairLine,
  replacePairName,
  runCheck,
  separatorHint,
  skippedMessages,
  skippedSentence,
  suggestName,
  titleNote,
  type CheckInput,
  type CheckReport,
} from "@/lib/check";
import { SAMPLE_GRID, SAMPLE_SETTINGS } from "@/lib/check-sample";
import vectors from "@/lib/fixtures/check-vectors.json";

// Every name and time below is invented for the test.

type Vector = {
  name: string;
  rows: string[][];
  resolved: number[][];
  settings: { changeover: string; curfew: string; pairs: string[][] };
  expected: {
    engine: "accepts" | "rejects";
    double_booked: number;
    same_stage: number;
    changeover: number;
    curfew: number;
    keep_apart: number;
    shared_pairs?: number;
  };
};

const VECTORS = vectors as Vector[];

function input(grid: string, extra: Partial<CheckInput> = {}): CheckInput {
  return { grid, changeover: "", curfew: "", pairs: "", ...extra };
}

function report(grid: string, extra: Partial<CheckInput> = {}): CheckReport {
  const outcome = runCheck(input(grid, extra));
  if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
  return outcome.report;
}

function errors(grid: string, extra: Partial<CheckInput> = {}): string[] {
  const outcome = runCheck(input(grid, extra));
  if (outcome.ok) throw new Error("expected the check to refuse");
  return outcome.errors;
}

/** The messages of the lines a partial check skipped (it read the rest). */
function skippedOf(r: CheckReport): string[] {
  return (r.skipped ?? []).map((item) => item.message);
}

function count(r: CheckReport, rule: number): number {
  return r.breaks.filter((b) => b.rule === rule).length;
}

function vectorInput(v: Vector): CheckInput {
  return {
    grid: v.rows.map((row) => row.join(",")).join("\n"),
    changeover: v.settings.changeover,
    curfew: v.settings.curfew,
    pairs: v.settings.pairs.map(([a, b]) => `${a} | ${b}`).join("\n"),
  };
}

describe("parity vectors", () => {
  it("has at least eight vectors, each with a reading of its own times", () => {
    expect(VECTORS.length).toBeGreaterThanOrEqual(8);
    for (const v of VECTORS) expect(v.resolved).toHaveLength(v.rows.length);
  });

  for (const v of VECTORS) {
    it(`${v.name}: counts per rule match the expected counts`, () => {
      const outcome = runCheck(vectorInput(v));
      if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
      const r = outcome.report;
      expect(count(r, 1)).toBe(v.expected.double_booked);
      expect(count(r, 2)).toBe(v.expected.same_stage);
      expect(count(r, 3)).toBe(v.expected.changeover);
      expect(count(r, 4)).toBe(v.expected.curfew);
      expect(count(r, 5)).toBe(v.expected.keep_apart);
      if (v.expected.shared_pairs !== undefined) expect(r.shared).toHaveLength(v.expected.shared_pairs);
      // The page's reading of each time is the one the Python side feeds the engine.
      expect(r.sets.map((s) => [s.start, s.end])).toEqual(v.resolved);
    });
  }
});

describe("the five rules and their sentences", () => {
  it("words each break with the sets and times", () => {
    const r = report(
      [
        "Ann,Main,18:00,19:00",
        "Ann,Side,18:30,19:30",
        "Bea,Main,19:05,20:00",
        "Cy,Main,19:30,20:30",
        "Dot,Side,22:00,00:30",
      ].join("\n"),
      { changeover: "15", curfew: "00:00", pairs: "Bea | Cy" },
    );
    const texts = r.breaks.map((b) => b.text);
    expect(texts).toContain("Ann is booked on two stages at the same time.");
    expect(texts).toContain("Bea and Cy overlap on Main.");
    expect(texts).toContain("Ann and Bea are 5 minutes apart on Main, under the 15-minute changeover.");
    expect(texts).toContain("Dot ends at 00:30, after the 00:00 curfew.");
    expect(texts).toContain("Bea and Cy share 30 minutes, and you asked that they never overlap.");
    expect(r.breaks.map((b) => b.rule)).toEqual([...r.breaks.map((b) => b.rule)].sort());
  });

  it("does not call touching sets or a changeover of 0 a break", () => {
    const r = report("A,Main,18:00,19:00\nB,Main,19:00,20:00", { changeover: "0" });
    expect(r.breaks).toEqual([]);
    expect(r.shared).toEqual([]);
  });

  it("does not flag a changeover where sets overlap (that is the same-stage rule)", () => {
    const r = report("A,Main,18:00,19:00\nB,Main,18:30,19:30");
    expect(count(r, 2)).toBe(1);
    expect(count(r, 3)).toBe(0);
  });

  it("lists shared-time pairs longest first, never the same act against itself", () => {
    const r = report("A,Main,18:00,19:00\nB,Side,18:30,19:30\nC,Tent,18:50,19:10\nA,Tent,19:30,20:00");
    expect(r.shared.map((p) => p.minutes)).toEqual([30, 20, 10]);
    expect(r.shared.every((p) => p.a.actKey !== p.b.actKey)).toBe(true);
    expect(new Set(r.shared.map((p) => p.id)).size).toBe(r.shared.length);
  });

  it("reads a locked column and shows it, with no effect on the rules", () => {
    const r = report("act,stage,start,end,locked\nA,Main,18:00,19:00,yes\nB,Main,19:30,20:00,no\nC,Side,18:00,19:00,");
    expect(r.lockedCount).toBe(1);
    expect(r.breaks).toEqual([]);
  });
});

describe("parser", () => {
  it("reads a quoted field that contains commas as one field", () => {
    const r = report('"Smith, John and the Band",Main,18:00,19:00\n"He said ""hi""",Side,18:00,19:00');
    expect(r.sets.map((s) => s.act)).toEqual(["Smith, John and the Band", 'He said "hi"']);
    expect(r.sets[0].stage).toBe("Main");
  });

  it("reads tab-separated text, with commas inside names", () => {
    const r = report("Smith, John\tMain\t18:00\t19:00\nB\tSide\t18:30\t19:30");
    expect(r.sets[0].act).toBe("Smith, John");
    expect(r.shared).toHaveLength(1);
  });

  it("refuses a quote that is not closed", () => {
    expect(errors('"Smith,Main,18:00,19:00')[0]).toMatch(/^Line 1 \(Smith\): a quote is not closed/);
  });

  it("skips a duplicate row, checks the rest and says which line it repeats", () => {
    const r = report("A,Main,18:00,19:00\nB,Side,18:00,19:00\n a ,main,18:00,19:00");
    expect(skippedOf(r)).toEqual(["Line 3 (a): the same set as line 1 (same act, stage and times)."]);
    expect(r.sets.map((s) => s.row)).toEqual([1, 2]);
  });

  it("accepts the same act twice at different times and flags nothing", () => {
    const r = report("A,Main,18:00,19:00\nA,Main,21:00,22:00");
    expect(r.breaks).toEqual([]);
  });

  describe("after-midnight times", () => {
    it("reads 24:30, and an end before 06:00 that is before its start, as the next day", () => {
      const r = report("A,Main,23:00,00:30\nB,Main,24:45,25:30\nC,Side,24:00,24:30");
      expect(r.sets.map((s) => [s.start, s.end])).toEqual([
        [1380, 1470],
        [1485, 1530],
        [1440, 1470],
      ]);
    });

    it("refuses an end before its start that is 06:00 or later", () => {
      expect(errors("A,Main,20:00,19:00")[0]).toMatch(/^Line 1 \(A\): the set ends before it starts/);
      expect(errors("A,Main,20:00,06:00")[0]).toMatch(/ends before it starts/);
    });

    it("skips a start before 06:00 when other sets start in the afternoon, rather than guess", () => {
      const e = skippedOf(report("A,Main,18:00,19:00\nB,Main,00:30,01:15"));
      expect(e[0]).toMatch(/^Line 2 \(B\): starts before 06:00/);
      expect(e[0]).toMatch(/24:30/);
    });

    it("accepts a grid that is early morning throughout", () => {
      expect(report("A,Main,01:00,02:00\nB,Side,03:00,04:00").sets).toHaveLength(2);
    });

    it("refuses hours of 48 or more and zero-length sets", () => {
      expect(errors("A,Main,18:00,48:00")[0]).toMatch(/end time/);
      expect(errors("A,Main,18:00,18:00")[0]).toMatch(/must end after it starts/);
      expect(errors("A,Main,18:60,19:00")[0]).toMatch(/start time/);
    });
  });

  it("reads a header row and refuses one that is not the expected header", () => {
    expect(report("ACT, Stage ,Start,END,Locked\nA,Main,18:00,19:00").sets).toHaveLength(1);
    expect(errors("name,place,start,end\nA,Main,18:00,19:00")).toEqual([
      'Line 1: no column reads as act or stage. Not read: "name", "place". For act this check reads: act, act name, artist, artist name, band, performer. For stage this check reads: stage, stage name, venue, tent, area.',
    ]);
  });

  it("refuses a locked value that is not yes, no or blank", () => {
    expect(errors("A,Main,18:00,19:00,maybe")[0]).toMatch(/locked column/);
  });

  it("refuses a row with too few or too many fields", () => {
    expect(errors("A,Main,18:00")[0]).toMatch(/found 3 fields/);
    expect(errors("A,Main,18:00,19:00,no,extra")[0]).toMatch(/found 6 fields/);
  });

  it("lists up to five problems and counts the rest", () => {
    const grid = Array.from({ length: 9 }, (_, i) => `A${i},Main,xx,19:00`).join("\n");
    const e = errors(grid);
    expect(e).toHaveLength(6);
    expect(e[5]).toBe("And 4 more problems.");
  });
});

describe("one day boundary for the sets and the curfew", () => {
  it("flags a set past the curfew when the whole grid is written after midnight", () => {
    const r = report("a,m,00:30,01:30\nb,m,01:40,02:30", { changeover: "0", curfew: "02:00" });
    expect(r.settings.curfew).toBe(120);
    expect(r.breaks.map((b) => b.text)).toEqual(["b ends at 02:30, after the 02:00 curfew."]);
  });

  it("flags the same grid written as 24:30 to 26:30, the same way", () => {
    const r = report("a,m,24:30,25:30\nb,m,25:40,26:30", { changeover: "0", curfew: "02:00" });
    expect(r.breaks.map((b) => b.text)).toEqual(["b ends at 02:30, after the 02:00 curfew."]);
  });

  it("still reads a curfew before 06:00 as after midnight when any set starts later in the day", () => {
    const r = report("a,m,22:00,23:00\nb,m,23:30,00:30", { curfew: "00:00" });
    expect(r.settings.curfew).toBe(1440);
    expect(r.breaks.map((b) => b.rule)).toEqual([4]);
  });

  it("refuses an early-only grid whose curfew is at or before its first start, rather than guess", () => {
    for (const curfew of ["00:00", "00:30"]) {
      expect(errors("a,m,00:30,01:30", { curfew })[0]).toMatch(/cannot tell which day it means/);
    }
    expect(report("a,m,00:30,01:30", { curfew: "00:31" }).breaks).toHaveLength(1);
  });

  it("refuses a curfew before 06:00 when night sets sit beside morning sets and none in the afternoon", () => {
    const grid = "a,m,00:30,01:30\nb,m,01:40,02:30\nc,m,06:00,07:00";
    expect(errors(grid, { curfew: "02:00" })[0]).toMatch(/cannot tell which side of the curfew/);
    expect(report(grid, { changeover: "0", curfew: "23:00" }).breaks).toHaveLength(0);
  });

  it("refuses an end before its start when the set starts after midnight", () => {
    expect(errors("a,m,02:00,01:00")[0]).toMatch(/ends before it starts/);
    expect(errors("a,m,01:30,00:30")[0]).toMatch(/ends before it starts/);
  });
});

describe("pair ids", () => {
  it("are unique when one act is booked on two stages at the same start and overlaps a third act", () => {
    const r = report("X,Main,18:00,19:00\nX,Side,18:00,19:00\nY,Third,18:30,19:30");
    expect(r.shared).toHaveLength(2);
    expect(new Set(r.shared.map((p) => p.id)).size).toBe(2);
  });

  it("do not collide when a name holds the old delimiters (x@y on z, and x on y@z)", () => {
    const r = report(["x@y,z,18:00,19:00", "x,y@z,18:00,19:00", "T,Third,18:00,19:00"].join("\n"));
    expect(r.shared).toHaveLength(3);
    expect(new Set(r.shared.map((p) => p.id)).size).toBe(3);
    const bar = report(["a|b,m,18:00,19:00", "a,b|m,18:00,19:00", "T,Third,18:00,19:00"].join("\n"));
    expect(new Set(bar.shared.map((p) => p.id)).size).toBe(3);
  });

  it("stay the same for the same pair across a re-check, whatever its row", () => {
    const first = report(["A,Main,18:00,19:00", "B,Side,18:30,19:30"].join("\n"));
    const again = report(["Z,Other,10:00,11:00", "A,Main,18:00,19:00", "B,Side,18:30,19:30"].join("\n"));
    expect(again.shared[0].id).toBe(first.shared[0].id);
  });
});

describe("spreadsheet and copy-paste tolerance", () => {
  it("drops seconds from times, in the grid and the curfew", () => {
    const r = report("A,Main,18:00:00,19:00:30", { curfew: "23:00:00" });
    expect(r.sets[0]).toMatchObject({ start: 1080, end: 1140 });
    expect(r.settings.curfew).toBe(1380);
    expect(errors("A,Main,18:00:60,19:00")[0]).toMatch(/start time/);
  });

  it("reads header rows with other case or the Start time and End time wording", () => {
    for (const header of [
      "Act,Stage,Start time,End time",
      "ACT NAME,STAGE NAME,START TIME,END TIME,LOCKED",
      "Artist,stage,start_time,end_time",
    ]) {
      expect(report(`${header}\nA,Main,18:00,19:00`).sets).toHaveLength(1);
    }
    expect(errors("act,stage,kickoff,end\nA,Main,18:00,19:00")[0]).toMatch(/^Line 1: no column reads as start\. Not read: "kickoff"\./);
    // "Begin" is one of the start words now.
    expect(report("act,stage,begin,end\nA,Main,18:00,19:00").sets).toHaveLength(1);
  });

  it("keeps zero-width joiners and non-joiners in names and strips soft hyphens", () => {
    const r = report("Mo‍na,Main,18:00,19:00\nKa‌vi,Side,18:00,19:00\nSoft­ware,Tent,18:00,19:00");
    expect(r.sets.map((s) => s.act)).toEqual(["Mo‍na", "Ka‌vi", "Software"]);
    const withPair = report("Soft­ware,Main,18:00,19:00\nB,Side,18:00,19:00", { pairs: "Soft­ware | B" });
    expect(withPair.breaks).toHaveLength(1);
  });

  it("names the line of any other invisible character it refuses", () => {
    const e = errors("A,Main,18:00,19:00\nB​,Side,18:00,19:00");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^Line 2 contains a control or invisible character/);
    expect(errors("A,Main,18:00,19:00\nB‮,Side,18:00,19:00")[0]).toMatch(/^Line 2 /);
    expect(errors("A,Main,18:00,19:00", { pairs: "A | B\nC​ | D" })[0]).toMatch(/^Pair line 2 /);
    expect(errors("A,Main,18:00,19:00\n\u0000")[0]).toMatch(/^Line 2 contains a character this page cannot read/);
  });
});

describe("pair rules", () => {
  const grid = "A,Main,18:00,19:00\nB,Side,18:30,19:30\nA2,Main,20:00,21:00\nB,Tent,22:00,23:00";

  it("refuses a name that matches no row", () => {
    const e = errors(grid, { pairs: "A | Nobody" });
    expect(e).toEqual(["Pair line 1: “Nobody” matches no set in the grid. Nearest: “B”, “A”, “A2”."]);
  });

  it("refuses a name that matches several rows, naming the count", () => {
    const e = errors(grid, { pairs: "A | B" });
    expect(e[0]).toMatch(/Pair line 1: “B” matches 2 rows/);
  });

  it("refuses a line without exactly two names, or one that pairs a set with itself", () => {
    expect(errors(grid, { pairs: "A" })[0]).toMatch(/two names with a bar/);
    expect(errors(grid, { pairs: "A | B | A2" })[0]).toMatch(/two names with a bar/);
    expect(errors(grid, { pairs: "A |  " })[0]).toMatch(/two names with a bar/);
    expect(errors(grid, { pairs: " a | A " })[0]).toMatch(/the two names are the same set/);
  });

  it("matches names ignoring case and extra spaces, and lists a pair written twice once", () => {
    const r = report("Ann Lee,Main,18:00,19:00\nBo,Side,18:30,19:30", { pairs: "ann   lee | BO\nbo | Ann Lee" });
    expect(r.settings.pairs).toHaveLength(1);
    expect(count(r, 5)).toBe(1);
  });

  it("never echoes more than 80 characters of a pair name", () => {
    const long = "Z".repeat(300);
    const e = errors(grid, { pairs: `A | ${long}` }).join(" ");
    expect(e).not.toContain("Z".repeat(81));
    expect(e).toMatch(/matches no set/);
  });

  it("refuses more than 30 pair lines", () => {
    const pairs = Array.from({ length: 40 }, (_, i) => `A | C${i}`).join("\n");
    expect(errors(grid, { pairs }).join(" ")).toMatch(/More than 30 pair rules/);
  });
});

describe("settings", () => {
  const grid = "A,Main,18:00,19:00";

  it("uses 15 minutes and no curfew when left blank", () => {
    const r = report(grid);
    expect(r.settings.changeover).toBe(15);
    expect(r.settings.curfew).toBeNull();
  });

  it("refuses a changeover that is not a whole number from 0 to 240", () => {
    for (const changeover of ["-5", "1.5", "241", "abc", "1e2"]) {
      expect(errors(grid, { changeover })[0]).toMatch(/Changeover should be a whole number/);
    }
  });

  it("reads a curfew before 06:00 as after midnight and refuses one that is not a time", () => {
    expect(report(grid, { curfew: "00:00" }).settings.curfew).toBe(1440);
    expect(report(grid, { curfew: "01:30" }).settings.curfew).toBe(1530);
    expect(report(grid, { curfew: "23:00" }).settings.curfew).toBe(1380);
    expect(errors(grid, { curfew: "late" })[0]).toMatch(/Curfew should be a time/);
  });
});

describe("the sample", () => {
  const outcome = runCheck({ grid: SAMPLE_GRID, ...SAMPLE_SETTINGS });
  if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
  const r = outcome.report;

  it("is the invented example day's 24 acts as 25 sets on four stages", () => {
    expect(r.sets).toHaveLength(25);
    expect(new Set(r.sets.map((s) => s.actKey)).size).toBe(24);
    expect(r.stages).toEqual(["Main Stage", "Riverside Stage", "Grove Stage", "Night Tent"]);
  });

  it("has exactly four planted findings, one of each kind", () => {
    expect(r.breaks).toHaveLength(4);
    expect(r.breaks.map((b) => b.rule)).toEqual([1, 3, 4, 5]);
    expect(r.breaks.map((b) => b.text)).toEqual([
      "Orchid Bloom is booked on two stages at the same time.",
      "Willow Circuit and Neon Garden are 10 minutes apart on Grove Stage, under the 15-minute changeover.",
      "Rustic Harbour ends at 00:20, after the 00:00 curfew.",
      "Saffron Season and Ivory Lights share 20 minutes, and you asked that they never overlap.",
    ]);
  });

  it("lists more than 15 pairs that share time, so Show all has something to show", () => {
    expect(r.shared.length).toBeGreaterThan(15);
  });

  it("announces the counts as the live region says them", () => {
    expect(announcement(outcome)).toBe(`Rule breaks: 4. Sets that share time: ${r.shared.length} pairs.`);
  });
});

describe("hostile pastes", () => {
  const big = (n: number) => "a,Main,18:00,19:00\n".repeat(n);

  it("refuses a 200 KB paste before reading it, without echoing it", () => {
    const text = "X".repeat(200_000);
    const e = errors(text);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/200,000 bytes/);
    expect(e[0].length).toBeLessThan(200);
  });

  it("refuses 10,000 lines", () => {
    expect(errors("a\n".repeat(10_000))[0]).toMatch(/up to 8 KB/);
  });

  it("refuses more than 60 sets that fit in 8 KB", () => {
    const grid = Array.from({ length: 70 }, (_, i) => `S${i},Stage ${i % 3},${String(10 + (i % 12)).padStart(2, "0")}:00,${String(10 + (i % 12)).padStart(2, "0")}:30`).join("\n");
    expect(new TextEncoder().encode(grid).length).toBeLessThan(CHECK_LIMITS.bytes);
    expect(errors(grid).join(" ")).toMatch(/70 sets/);
    expect(big(61).length).toBeLessThan(CHECK_LIMITS.bytes);
  });

  it("refuses 11 stages", () => {
    const grid = Array.from({ length: 11 }, (_, i) => `Act ${i},Stage ${i},18:00,19:00`).join("\n");
    expect(errors(grid)[0]).toMatch(/11 stages/);
    expect(report(Array.from({ length: 10 }, (_, i) => `Act ${i},Stage ${i},18:00,19:00`).join("\n")).stages).toHaveLength(10);
  });

  it("refuses NUL and a UTF-16 reading of the text", () => {
    expect(errors("A,Main,18:00,19:00\u0000")[0]).toMatch(/cannot read/);
    const utf16 = "￾a\u0000,\u0000M\u0000a\u0000i\u0000n\u0000";
    expect(errors(utf16)[0]).toMatch(/cannot read|control or invisible/);
  });

  it("refuses control and invisible characters, such as a right-to-left override", () => {
    expect(errors("A‮B,Main,18:00,19:00")[0]).toMatch(/control or invisible/);
    expect(errors("A​B,Main,18:00,19:00")[0]).toMatch(/control or invisible/);
  });

  it("drops a leading byte-order mark and reads the rest", () => {
    expect(report("﻿act,stage,start,end\nA,Main,18:00,19:00").sets).toHaveLength(1);
  });

  it("reads a name that starts with = as plain text and never evaluates it", () => {
    const r = report("=HYPERLINK(\"x\"),Main,18:00,19:00\n+SUM(1),Side,18:00,19:00\n@cmd,Tent,18:00,19:00");
    expect(r.sets.map((s) => s.act)).toEqual(['=HYPERLINK("x")', "+SUM(1)", "@cmd"]);
  });

  it("refuses a 300-character name and never echoes it", () => {
    const name = "N".repeat(300);
    const outcome = runCheck(input(`${name},Main,18:00,19:00`));
    expect(outcome.ok).toBe(false);
    const text = JSON.stringify(outcome);
    expect(text).not.toContain("N".repeat(81));
    expect(text).toMatch(/longer than 80 characters/);
  });

  it("allows an 80-character name and echoes it whole, never more", () => {
    const name = "M".repeat(80);
    const r = report(`${name},Main,18:00,19:00
Other,Main,18:30,19:30`);
    const echoed = JSON.stringify(r.breaks);
    expect(echoed).toContain(name);
    expect(echoed).not.toContain("M".repeat(81));
  });

  it("clips whatever it echoes to 80 characters", () => {
    expect(clip("Q".repeat(300))).toHaveLength(81);
    expect(clip("short")).toBe("short");
  });

  it("never throws, whatever the paste", () => {
    const samples = ["", "\n\n\n", ",,,,", "\t\t\t", '"""', '",",",",",",","', "a,b,c,d,e,f,g", "😀,😀,18:00,19:00", " , ,18:00,19:00"];
    for (const grid of samples) {
      expect(() => runCheck(input(grid, { pairs: "|||\n|", changeover: "\u0000", curfew: "😀" }))).not.toThrow();
    }
  });
});

describe("copy", () => {
  it("states the fixed words of the page", () => {
    expect(CHECK_COPY.title).toBe("Check a draft grid against your rules");
    expect(CHECK_COPY.lede).toBe("Paste one day of a draft timetable to find rule breaks and sets that share time. Audience overlap is optional.");
    expect(CHECK_COPY.privacy).toMatch(/^Rule checks run in your browser; nothing is sent unless you press Compare audience overlap\./);
    expect(CHECK_COPY.privacy).toContain("A copied link contains your grid and settings; anyone with it can read them");
    expect(CHECK_COPY.printTitle).toBe("Draft check, not a verdict");
    expect(CHECK_COPY.noBreaks).toBe("No rule breaks found against the settings above.");
    expect(CHECK_COPY.elsewhere).toMatch(/^Rule checks like these also exist in scheduling software\./);
    for (const text of Object.values(CHECK_COPY)) {
      expect(text).not.toMatch(/nothing you paste is sent anywhere|makes no request/);
    }
  });

  it("gives a template that the page itself can read", () => {
    const r = report(TEMPLATE_CSV);
    expect(r.sets).toHaveLength(2);
  });

  it("formats the clock past midnight", () => {
    expect(formatClock(1470)).toBe("00:30");
    expect(formatClock(1440)).toBe("00:00");
    expect(formatClock(75)).toBe("01:15");
  });
});

// The paste a head of programming made first, which the page refused. Tabs, a header with a
// day column and a notes column, 12-hour times from a spreadsheet, a short name in a pair rule.
const PROGRAMMER_GRID = [
  ["Day", "Artist", "Stage", "Start time", "End time", "Notes"],
  ["Fri", "Marlowe & The Tides", "Main", "6:00 PM", "7:15 PM", "confirmed"],
  ["Fri", "Sable Arcade", "Club", "6:30 PM", "7:30 PM", ""],
  ["Fri", "Orbital Kitchen", "Woods", "7:00pm", "8:00pm", "hold"],
  ["Fri", "Wren Division", "Club", "7:45pm", "9:00pm", ""],
  ["Fri", "Midnight Cartographers", "Woods", "8:15 PM", "9:45 PM", ""],
  ["Fri", "Glass Harbour", "Main", "7:30 PM", "8:45 PM", ""],
  ["Fri", "Paper Lanterns", "Tent", "6:00 PM", "6:50 PM", ""],
  ["Fri", "Iron Orchard", "Tent", "7:00 PM", "8:00 PM", ""],
  ["Fri", "Velvet Static", "Main", "9:00 PM", "10:30 PM", ""],
  ["Fri", "Northern Kites", "Club", "9:15 PM", "10:30 PM", ""],
  ["Fri", "Lowland Choir", "Woods", "10:00 PM", "11:00 PM", ""],
  ["Fri", "Ember Coast", "Tent", "8:20 PM", "9:20 PM", ""],
  ["Fri", "Silver Engines", "Tent", "9:40 PM", "10:40 PM", ""],
  ["Fri", "Quiet Furnace", "Main", "10:50 PM", "12:20 AM", ""],
  ["Fri", "Hollow Bells", "Club", "10:45 PM", "11:55 PM", ""],
  ["Fri", "Rook & Raven", "Woods", "11:15 PM", "12:30 AM", ""],
  ["Fri", "Dune Signal", "Tent", "11:00 PM", "12:15 AM", ""],
  ["Fri", "Cinder Avenue", "Club", "12:10 AM", "1:30 AM", "late"],
  ["Fri", "Moth Parade", "Woods", "12:45 AM", "1:20 AM", ""],
  ["Fri", "Pale Meridian", "Main", "12:30 AM", "1:15 AM", ""],
  ["Fri", "Tin Lighthouse", "Tent", "12:30 AM", "1:00 AM", ""],
]
  .map((row) => row.join("\t"))
  .join("\n");

describe("pastes from spreadsheets and other tools", () => {
  it("reads 12-hour times: 2:00 PM, 2pm, 3:10pm and 12:30 AM as 00:30", () => {
    const r = report("A,Main,2:00 PM,3:10pm\nB,Side,2pm,3pm\nC,Tent,11:30 AM,12:15 PM\nD,Main,12:00 AM,1:00 a.m.");
    expect(r.sets.map((s) => [s.start, s.end])).toEqual([
      [840, 910],
      [840, 900],
      [690, 735],
      [1440, 1500],
    ]);
    expect(errors("A,Main,13:00 PM,14:00")[0]).toBe(
      'Line 1 (A): the start time "13:00 PM" is not a time such as 18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm.',
    );
    expect(errors("A,Main,0:30 AM,1:00 AM")[0]).toMatch(/start time/);
  });

  it("reads a 12-hour start after midnight as the next day in an evening grid, and the curfew the same way", () => {
    const r = report("A,Main,10:00 PM,11:30 PM\nB,Main,12:30 AM,1:30 AM", { curfew: "1:00 AM", changeover: "15" });
    expect(r.sets[1]).toMatchObject({ start: 1470, end: 1530 });
    expect(r.settings.curfew).toBe(1500);
    expect(r.breaks.map((b) => b.text)).toEqual(["B ends at 01:30, after the 01:00 curfew."]);
    // A 24-hour 00:30 in an evening grid is still not read (its line is skipped): it has 24:30 to write instead.
    expect(skippedOf(report("A,Main,22:00,23:30\nB,Main,00:30,01:30"))[0]).toMatch(/Write after-midnight times as 24:30/);
  });

  it("moves each endpoint past midnight once: a 12:30 AM start with a 24:45 end reads 24:30 to 24:45", () => {
    // Regression: the early-morning shift added a day to an end already written as 24:45.
    const r = report("Evening,Main,22:00,23:30\nNight,Other,12:30 AM,24:45");
    expect(r.sets[1]).toMatchObject({ start: 1470, end: 1485 });
    expect(r.shared).toHaveLength(0);
    // Both written in 12-hour time still move together.
    expect(report("Evening,Main,22:00,23:30\nNight,Other,12:30 AM,1:15 AM").sets[1]).toMatchObject({ start: 1470, end: 1515 });
    // An end at or before the moved start is not read (its line is skipped), never stretched into a second day.
    expect(skippedOf(report("Evening,Main,22:00,23:30\nNight,Other,12:30 AM,24:15"))[0]).toMatch(/^Line 2 \(Night\): the set ends before it starts/);
  });

  it("reads columns by their header in any order, ignores the ones it does not know and says so", () => {
    const r = report("Notes,End,Stage,Act,Start,Genre\nok,19:00,Main,A,18:00,rock\n,20:00,Side,B,19:30,");
    expect(r.sets.map((s) => [s.act, s.stage, s.start, s.end])).toEqual([
      ["A", "Main", 1080, 1140],
      ["B", "Side", 1170, 1200],
    ]);
    expect(r.notes).toEqual(["Ignored 2 columns this page does not read: Notes, Genre."]);
    expect(report("act,stage,start,end\nA,Main,18:00,19:00").notes).toEqual([]);
  });

  it("accepts a day column with one day and refuses several, naming them", () => {
    expect(report("day,act,stage,start,end\nFri,A,Main,18:00,19:00\nfri,B,Side,18:30,19:30").sets).toHaveLength(2);
    expect(errors("day,act,stage,start,end\nFri,A,Main,18:00,19:00\nSat,B,Side,18:30,19:30")).toContain(
      "This grid has more than one day (Fri, Sat). Paste one day at a time.",
    );
  });

  it("refuses a header that misses a column or names one twice", () => {
    expect(errors("act,stage,start\nA,Main,18:00")).toEqual([
      "Line 1: no column reads as end. For end this check reads: end, end time, ends, finish, finish time, finishes, until, to, set end.",
    ]);
    expect(errors("act,act,stage,start,end\nA,A,Main,18:00,19:00")[0]).toMatch(/header should read/);
    expect(errors("act,stage,start,end,notes\nA,Main,18:00,19:00,x,extra")[0]).toMatch(
      /the header has 5 columns, but this line has 6 fields/,
    );
  });

  it("reads the failing paste: tabs, a day and a notes column, 12-hour times and a short pair name offered with one click", () => {
    const pairs = "Marlowe | Sable Arcade\nOrbital Kitchen | Wren Division\nGlass Harbour | Velvet Static";
    const first = runCheck(input(PROGRAMMER_GRID, { changeover: "20", curfew: "1:00 AM", pairs }));
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.errors).toEqual(["Pair line 1: “Marlowe” matches “Marlowe & The Tides”. Use it?"]);
    expect(first.suggestions).toEqual([
      { message: first.errors[0], line: 1, side: 0, match: "Marlowe & The Tides", nearest: [] },
    ]);
    const fixed = replacePairName(pairs, 1, 0, "Marlowe & The Tides");
    expect(fixed.split("\n")[0]).toBe("Marlowe & The Tides | Sable Arcade");
    expect(fixed.split("\n").slice(1)).toEqual(pairs.split("\n").slice(1));
    const r = report(PROGRAMMER_GRID, { changeover: "20", curfew: "1:00 AM", pairs: fixed });
    expect(r.sets).toHaveLength(21);
    expect(r.stages).toHaveLength(4);
    expect(r.notes).toEqual(["Ignored a column this page does not read: Notes."]);
    expect(r.settings.curfew).toBe(1500);
    expect(r.sets.find((s) => s.act === "Cinder Avenue")).toMatchObject({ start: 1450, end: 1530 });
    expect(r.breaks.some((b) => b.text === "Cinder Avenue ends at 01:30, after the 01:00 curfew.")).toBe(true);
    expect(r.breaks.filter((b) => b.rule === 5)).toHaveLength(2);
  });

  it("lists the three nearest names when nothing starts with or holds the typed name", () => {
    const grid = "Marlowe & The Tides,Main,18:00,19:00\nSable Arcade,Club,18:30,19:30\nMarble Hall,Tent,18:00,19:00";
    const e = runCheck(input(grid, { pairs: "Marlwe | Sable Arcade" }));
    if (e.ok) throw new Error("expected a refusal");
    expect(e.errors[0]).toBe(
      "Pair line 1: “Marlwe” matches no set in the grid. Nearest: “Marlowe & The Tides”, “Marble Hall”, “Sable Arcade”.",
    );
    expect(e.suggestions[0]).toMatchObject({ match: null, nearest: ["Marlowe & The Tides", "Marble Hall", "Sable Arcade"] });
    // A word in the name is enough, and two acts that both hold it are not guessed between.
    expect(suggestName("tides", new Map([["marlowe & the tides", "Marlowe & The Tides"]])).match).toBe("Marlowe & The Tides");
    expect(
      suggestName(
        "marble",
        new Map([
          ["marble hall", "Marble Hall"],
          ["marble syndicate", "Marble Syndicate"],
        ]),
      ).match,
    ).toBeNull();
  });
});

describe("a pair rule's fixes never swap in an unrelated act", () => {
  it("calls a name close only when it is a typo of the whole name, its start or one of its words", () => {
    expect(isCloseName("Marlwe", "Marlowe & The Tides")).toBe(true);
    expect(isCloseName("Amber Kyte", "Amber Kite")).toBe(true);
    expect(isCloseName("amber kite", "Amber Kite")).toBe(true);
    expect(isCloseName("Marlwe", "Marble Hall")).toBe(false);
    expect(isCloseName("Marlwe", "Sable Arcade")).toBe(false);
    expect(isCloseName("Saffron Season", "Amber Kite")).toBe(false);
    expect(isCloseName("Saffron Season", "Basalt Choir")).toBe(false);
    expect(isCloseName("", "Amber Kite")).toBe(false);
  });

  it("removes exactly one pair line and leaves the others as typed", () => {
    const pairs = "A | B\nC  |  D\nE | F";
    expect(removePairLine(pairs, 2)).toBe("A | B\nE | F");
    expect(removePairLine(pairs, 1)).toBe("C  |  D\nE | F");
    expect(removePairLine("A | B", 1)).toBe("");
    expect(removePairLine(pairs, 0)).toBe(pairs);
    expect(removePairLine(pairs, 9)).toBe(pairs);
  });
});

// One bad line does not stop the check. Faults of one line skip that line (listed by its line in
// the paste, counting the header and blank lines); faults of the whole input still stop it.

/** A 12-line paste like a programmer's: line 4's start is 25:70, one stage is written "Main   Stage". */
const MESSY_LINES = [
  "Tidal Fields,Main Stage,14:00,15:00",
  "Cobalt Rows,Side Stage,14:15,15:15",
  "Paper Lanterns,Tent,14:30,15:15",
  "Glass Harbour,Tent,25:70,19:30",
  "Saltmarsh,Main Stage,15:30,16:30",
  "Quiet Engine,Side Stage,15:45,16:45",
  "Nobody Has Heard Of Us,Tent,16:00,16:45",
  "Velvet Static,Main   Stage,17:00,18:00",
  "Orbit Choir,Side Stage,17:15,18:15",
  "Lowland Kites,Tent,17:30,18:15",
  "Amber Kite,Main Stage,18:30,19:30",
  "Ember Coast,Side Stage,18:45,19:45",
];

describe("a bad line is skipped and listed, and the rest is checked", () => {
  const LINE_4 = 'Line 4 (Glass Harbour): the start time "25:70" is not a time such as 18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm.';

  it("checks the 11 readable sets of the messy paste and lists line 4 with its message", () => {
    // A semicolon grid (the CSV a spreadsheet writes where the comma is the decimal mark) reads the same.
    for (const delimiter of [",", "\t", ";"]) {
      const grid = MESSY_LINES.map((line) => line.split(",").join(delimiter)).join("\n");
      const r = report(grid);
      expect(r.sets).toHaveLength(11);
      expect(r.sets.map((s) => s.row)).not.toContain(4);
      expect(r.skipped?.map((item) => item.line)).toEqual([4]);
      expect(skippedOf(r)).toEqual([LINE_4]);
      expect(skippedSentence(r.skipped ?? [], r.sets.length)).toBe(
        "1 line skipped and not checked: line 4. The other 11 sets were checked.",
      );
      // "Main   Stage" folds into Main Stage; nothing on the 11 lines breaks a rule.
      expect(r.stages).toEqual(["Main Stage", "Side Stage", "Tent"]);
      expect(r.breaks).toEqual([]);
      expect(noBreaksLine(r)).toBe("No rule breaks found among the 11 sets checked, against the settings above.");
      // No pair and no rule touches the skipped act.
      expect(r.shared.some((pair) => pair.a.act === "Glass Harbour" || pair.b.act === "Glass Harbour")).toBe(false);
      expect(announcement({ ok: true, report: r })).toBe(
        `1 line skipped and not checked: line 4. The other 11 sets were checked. Rule breaks: 0. Sets that share time: ${r.shared.length} pairs.`,
      );
    }
  });

  it("keeps the physical line number, counting the header and blank lines", () => {
    const r = report("act,stage,start,end\n\nA,Main,18:00,19:00\n\nB,Side,25:70,20:00\nC,Tent,18:00,19:00\nA,Main,18:00,19:00");
    expect(r.sets.map((s) => s.row)).toEqual([3, 6]);
    expect(r.skipped?.map((item) => item.line)).toEqual([5, 7]);
    expect(skippedOf(r)).toEqual([
      'Line 5 (B): the start time "25:70" is not a time such as 18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm.',
      "Line 7 (A): the same set as line 3 (same act, stage and times).",
    ]);
    expect(skippedSentence(r.skipped ?? [], r.sets.length)).toBe(
      "2 lines skipped and not checked: line 5, line 7. The other 2 sets were checked.",
    );
  });

  it("skips each kind of line fault on its own line, its message naming the line, the act and any rejected value", () => {
    const good = "Good,Main,12:00,13:00";
    const cases: [string, RegExp][] = [
      ['"Open,Side,18:00,19:00', /^Line 2 \(Open\): a quote is not closed/],
      ["Short,Side,18:00", /^Line 2 \(Short\): expected act, stage, start, end \(and locked\), but found 3 fields\.$/],
      [",Side,18:00,19:00", /^Line 2: the act and the stage cannot be blank\.$/],
      [`${"x".repeat(300)},Side,18:00,19:00`, /^Line 2: a name is longer than 80 characters\.$/],
      ["Late,Side,18:00,48:00", /^Line 2 \(Late\): the end time "48:00" is not a time/],
      ["Back,Side,20:00,19:00", /^Line 2 \(Back\): the set ends before it starts/],
      ["Zero,Side,18:00,18:00", /^Line 2 \(Zero\): the set must end after it starts\.$/],
      ["Lock,Side,18:00,19:00,maybe", /^Line 2 \(Lock\): the locked column should be yes, no or blank, not "maybe"\.$/],
    ];
    for (const [line, message] of cases) {
      const r = report(`${good}\n${line}`);
      expect(r.sets.map((s) => s.act)).toEqual(["Good"]);
      expect(skippedOf(r)).toHaveLength(1);
      expect(skippedOf(r)[0]).toMatch(message);
      // A 300-character name is still never echoed.
      expect(skippedOf(r)[0].length).toBeLessThan(140);
    }
  });

  it("lists five messages and counts the rest, while the sentence names every skipped line", () => {
    const grid = ["Good,Main,12:00,13:00", ...Array.from({ length: 7 }, (_, i) => `Bad${i},Main,xx,19:00`)].join("\n");
    const r = report(grid);
    expect(skippedMessages(r.skipped ?? [])).toHaveLength(6);
    expect(skippedMessages(r.skipped ?? [])[5]).toBe("And 2 more problems.");
    expect(skippedSentence(r.skipped ?? [], 1)).toBe(
      "7 lines skipped and not checked: line 2, line 3, line 4, line 5, line 6, line 7, line 8. The other 1 set was checked.",
    );
  });

  it("does not check a grid with no readable line: every line's message is listed and nothing reads", () => {
    const outcome = runCheck(input("A,Main,25:70,19:00\nOnly,two"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors).toEqual([
      'Line 1 (A): the start time "25:70" is not a time such as 18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm.',
      "Line 2 (Only): expected act, stage, start, end (and locked), but found 2 fields.",
    ]);
    expect(outcome.errors.join(" ")).not.toMatch(/No sets found/);
    expect(announcement(outcome)).toBe("The grid was not checked. 2 problems listed.");
  });

  it("still refuses the whole grid for a fault of the whole input, whatever lines read", () => {
    const readable = "A,Main,18:00,19:00\nB,Side,18:30,19:30\nC,Tent,xx,20:00";
    // A header that does not read: its one message, and none for any line after it.
    expect(errors(`name,place,start,end\n${readable}`)).toEqual([expect.stringMatching(/^Line 1: no column reads as act or stage\./)]);
    // Over 8 KB.
    expect(errors(`${readable}\n${"a,Main,18:00,19:00\n".repeat(500)}`)[0]).toMatch(/up to 8 KB/);
    // An unreadable character anywhere.
    expect(errors(`${readable}\nD,Tent​,18:00,19:00`)[0]).toMatch(/^Line 4 contains a control or invisible character/);
    // More than one day among the lines that read.
    expect(errors("day,act,stage,start,end\nFri,A,Main,18:00,19:00\nSat,B,Side,18:30,19:30\nSat,C,Tent,xx,20:00")).toContain(
      "This grid has more than one day (Fri, Sat). Paste one day at a time.",
    );
    // Over the set limit, counted over readable lines: 61 readable sets stop it, 60 and a repeat do not.
    const hour = (i: number) => String(10 + (i % 12)).padStart(2, "0");
    const sixty = Array.from({ length: 60 }, (_, i) => `S${i},St ${i % 5},${hour(i)}:00,${hour(i)}:30`);
    expect(errors([...sixty, "S60,St 0,22:00,22:30", "Bad,St 1,xx,20:00"].join("\n")).join(" ")).toMatch(/That is 61 sets/);
    const repeat = report([...sixty, sixty[0]].join("\n"));
    expect(repeat.sets).toHaveLength(60);
    expect(repeat.skipped?.map((item) => item.line)).toEqual([61]);
    // Over the stage limit among the lines that read.
    const eleven = Array.from({ length: 11 }, (_, i) => `Act ${i},Stage ${i},18:00,19:00`);
    expect(errors([...eleven, "Bad,Stage 0,xx,20:00"].join("\n")).join(" ")).toMatch(/11 stages/);
    // A settings problem: a bad changeover, a curfew that is not a time, a pair rule that does not parse.
    const changeover = errors(readable, { changeover: "abc" });
    expect(changeover).toContain("Changeover should be a whole number of minutes from 0 to 240.");
    // The line that would be skipped is named with it.
    expect(changeover[0]).toMatch(/^Line 3 \(C\): the start time "xx"/);
    expect(errors(readable, { curfew: "late" })).toContain("Curfew should be a time as H:MM or HH:MM, or blank for none.");
    expect(errors(readable, { pairs: "A and B" })).toContain("Pair line 1: write two names with a bar between them, as Act A | Act B.");
  });

  it("lists a pair rule that names an act found only on a skipped line as not checked, never passing it", () => {
    const grid = "A,Main,18:00,19:00\nB,Side,18:30,19:30\nC,Tent,xx,20:00";
    const r = report(grid, { pairs: "A | C\nA | B" });
    expect(r.uncheckedPairs).toEqual(["Pair line 1 not checked: C is on a skipped line."]);
    expect(pairNotChecked(1, "C")).toBe("Pair line 1 not checked: C is on a skipped line.");
    // The other rule is checked as before.
    expect(r.settings.pairs.map((pair) => pair.line)).toEqual([2]);
    expect(r.breaks.filter((item) => item.rule === 5)).toHaveLength(1);
    // A quote left open still gives its act to the rule, read loosely, and never checks it.
    const quoted = report('A,Main,18:00,19:00\n"Smith,Side,18:30,19:30', { pairs: "smith | a" });
    expect(quoted.uncheckedPairs).toEqual(["Pair line 1 not checked: Smith is on a skipped line."]);
    expect(quoted.settings.pairs).toEqual([]);
    // With no skipped line, the list is empty.
    expect(report("A,Main,18:00,19:00\nB,Side,18:30,19:30", { pairs: "A | B" }).uncheckedPairs).toEqual([]);
  });

  it("still refuses a pair rule that names an act on no line at all", () => {
    const grid = "A,Main,18:00,19:00\nB,Side,18:30,19:30\nC,Tent,xx,20:00";
    const outcome = runCheck(input(grid, { pairs: "A | Zed" }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.some((error) => error.startsWith("Pair line 1: “Zed” matches no set in the grid."))).toBe(true);
    expect(outcome.errors.join(" ")).not.toMatch(/not checked/);
  });

  it("words no rule breaks with the count checked only while a line is skipped", () => {
    const clean = report("A,Main,18:00,19:00\nB,Side,19:30,20:30");
    expect(noBreaksLine(clean)).toBe("No rule breaks found against the settings above.");
    expect(noBreaksLine(clean)).toBe(CHECK_COPY.noBreaks);
    const partial = report("A,Main,18:00,19:00\nB,Side,19:30,20:30\nC,Tent,xx,20:00");
    expect(noBreaksLine(partial)).toBe("No rule breaks found among the 2 sets checked, against the settings above.");
    expect(noBreaksLine({ sets: partial.sets.slice(0, 1), skipped: partial.skipped })).toBe(
      "No rule breaks found among the 1 set checked, against the settings above.",
    );
  });

  it("hints at semicolons only when two or more unreadable lines read as one field holding one", () => {
    // The first line sets the separator, so the lines under a comma header that use semicolons cannot be read.
    const semi = (line: string) => line.split(",").join(";");
    const semicolon = ["act,stage,start,end", ...MESSY_LINES.map(semi)].join("\n");
    const outcome = runCheck(input(semicolon));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(separatorHint(outcome.skipped)).toBe(
      "These lines look separated by semicolons. Use commas or tabs between act, stage, start and end.",
    );
    expect(outcome.errors).toHaveLength(6);
    expect(outcome.errors[0]).toBe("Line 2: the header has 4 columns, but this line has 1 field.");
    // Without a header, a comma first line over eleven lines that use semicolons: the lines that split into four
    // fields decide, so the eleven are read by semicolons and line 1, which holds times, is skipped as a
    // line. The hint stays for a grid read by commas (below), where the semicolon lines cannot be read.
    const mixed = report([MESSY_LINES[0], ...MESSY_LINES.slice(1).map(semi)].join("\n"));
    expect(mixed.sets.map((s) => s.act)).not.toContain("Tidal Fields");
    expect(mixed.sets).toHaveLength(10);
    expect(mixed.skipped?.map((item) => item.line)).toEqual([1, 4]);
    expect(skippedOf(mixed)[0]).toBe("Line 1: expected act, stage, start, end (and locked), but found 1 field.");
    expect(separatorHint(mixed.skipped)).toBeNull();
    // A tie between the two readings falls back to the first line's: two comma lines over two semicolon lines are
    // read by commas, and the semicolon lines cannot be read, with the hint.
    const tied = report("A,Main,18:00,19:00\nB,Side,18:30,19:30\nC;Tent;19:00;20:00\nD;Tent;20:00;21:00");
    expect(tied.sets.map((s) => s.act)).toEqual(["A", "B"]);
    expect(separatorHint(tied.skipped)).toBe(CHECK_COPY.separatorHint);
    // A grid read by semicolons from its first line never gets the hint.
    expect(separatorHint(report(MESSY_LINES.map(semi).join("\n")).skipped)).toBeNull();
    // One such line among readable ones is not enough; a semicolon inside a readable name is not one.
    const one = report(`${MESSY_LINES.slice(0, 3).join("\n")}\nGlass;Tent;19:00;19:30`);
    expect(separatorHint(one.skipped)).toBeNull();
    const two = report(`${MESSY_LINES.slice(0, 3).join("\n")}\nGlass;Tent;19:00;19:30\nWren;Tent;20:00;20:30`);
    expect(separatorHint(two.skipped)).toBe(CHECK_COPY.separatorHint);
    expect(separatorHint(report("Rock; Roll,Main,18:00,19:00").skipped)).toBeNull();
    // A line of one field with no semicolon is not counted.
    expect(separatorHint(parseGrid("A\nB\nC,Main,18:00,19:00").skipped)).toBeNull();
  });

  it("words the measured time of one run and the paste announcement exactly", () => {
    const line = checkTimeLine(25, 4, 1.6);
    expect(line).toBe("Checked 25 sets on 4 stages in 2 ms, in this browser.");
    expect(line).toMatch(/^Checked \d+ sets on \d+ stages in \d+ ms, in this browser\.$/);
    // Rounded to a whole number, and at least 1.
    expect(checkTimeLine(39, 5, 0.2)).toBe("Checked 39 sets on 5 stages in 1 ms, in this browser.");
    expect(checkTimeLine(1, 1, 3.4)).toBe("Checked 1 set on 1 stage in 3 ms, in this browser.");
    expect(line).not.toMatch(/saved|faster|instead of/i);
    expect(pastedLine(`${MESSY_LINES.join("\n")}\n`)).toBe("Pasted 12 lines into the CSV editor. Press Check the grid.");
    expect(pastedLine("one line")).toBe("Pasted 1 line into the CSV editor. Press Check the grid.");
  });
});

// A real spreadsheet survives the first paste. Header words, one time-range column, dotted and
// compact times; a header it cannot read is named in one message; a skip names the act and quotes the value.
describe("real headers and times, and what was not read", () => {
  const FORMS = "18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm";

  it("reads every header word for each column, in any case and with underscores for spaces", () => {
    const words: Record<string, string[]> = {
      act: ["act", "act name", "artist", "artist name", "band", "performer"],
      stage: ["stage", "stage name", "venue", "tent", "area"],
      start: ["start", "start time", "starts", "begin", "begins", "from", "set start"],
      end: ["end", "end time", "ends", "finish", "finish time", "finishes", "until", "to", "set end"],
      locked: ["locked", "lock", "fixed"],
      day: ["day", "date"],
    };
    const base: Record<string, string> = { act: "Act", stage: "Stage", start: "Start", end: "End", locked: "Locked", day: "Day" };
    const order = ["day", "act", "stage", "start", "end", "locked"];
    for (const [column, list] of Object.entries(words)) {
      for (const word of list) {
        for (const written of [word, word.toUpperCase().replace(/ /g, "_")]) {
          const header = order.map((key) => (key === column ? written : base[key])).join(",");
          const r = report(`${header}\nSat,A,Main,18:00,19:00,yes`);
          expect(r.sets).toEqual([expect.objectContaining({ act: "A", stage: "Main", start: 1080, end: 1140, locked: true })]);
          expect(r.notes).toEqual([]);
          expect(r.skipped).toEqual([]);
        }
      }
    }
  });

  it("checks an Artist, Stage, Start, Finish header with 6 rows and reads every line", () => {
    const grid = [
      "Artist,Stage,Start,Finish",
      "Tidal Fields,Main Stage,14:00,15:00",
      "Cobalt Rows,Side Stage,14:15,15:15",
      "Paper Lanterns,Tent,14:30,15:15",
      "Saltmarsh,Main Stage,15:30,16:30",
      "Quiet Engine,Side Stage,15:45,16:45",
      "Lowland Kites,Tent,16:00,16:45",
    ].join("\n");
    const r = report(grid);
    expect(r.sets).toHaveLength(6);
    expect(r.skipped).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("reads one column of ranges into start and end: a hyphen, an en dash or 'to', each side by the same time rules", () => {
    const r = report(
      ["Act,Stage,Set time", "A,Main,18:00-19:00", "B,Side,6pm to 7:15pm", "C,Tent,18:30–19:30", "D,Main,19.15 - 20h00", "E,Side,2330-0030"].join("\n"),
    );
    expect(r.sets.map((s) => [s.act, s.start, s.end])).toEqual([
      ["A", 1080, 1140],
      ["B", 1080, 1155],
      ["C", 1110, 1170],
      ["D", 1155, 1200],
      ["E", 1410, 1470],
    ]);
    expect(r.skipped).toEqual([]);
    for (const name of ["time", "Times", "SET_TIME", "set times", "Slot"]) {
      expect(report(`act,stage,${name}\nA,Main,18:00-19:00`).sets).toEqual([expect.objectContaining({ start: 1080, end: 1140 })]);
    }
  });

  it("skips a range cell that is not a range, or whose side is not a time, naming the act and quoting the value", () => {
    const r = report("Act,Stage,Slot\nA,Main,18:00-19:00\nB,Side,18:00\nC,Tent,25:99-26:00");
    expect(r.sets.map((s) => s.act)).toEqual(["A"]);
    expect(skippedOf(r)).toEqual([
      'Line 3 (B): the set time "18:00" is not a range such as 18:00-19:00 or 6pm to 7:15pm.',
      `Line 4 (C): the start time "25:99" is not a time such as ${FORMS}.`,
    ]);
  });

  it("reads a range column only when the header names no start and no end, and only one such column", () => {
    expect(errors("Act,Stage,Start,Time\nA,Main,18:00,18:00-19:00")).toEqual([
      'Line 1: no column reads as end. Not read: "Time". For end this check reads: end, end time, ends, finish, finish time, finishes, until, to, set end.',
    ]);
    expect(errors("Act,Stage,Time,Slot\nA,Main,18:00-19:00,18:00-19:00")).toEqual([
      'Line 1: no column reads as start or end. Not read: "Time", "Slot". For start this check reads: start, start time, starts, begin, begins, from, set start. For end this check reads: end, end time, ends, finish, finish time, finishes, until, to, set end. Or one column of ranges such as 18:00-19:00, headed time, times, set time, set times or slot.',
    ]);
  });

  it("refuses an Act, Stage, Start, Endzeit header in one message that names end and quotes Endzeit, and nothing else", () => {
    const outcome = runCheck(input("Act,Stage,Start,Endzeit\nA,Main,18:00,19:00\nB,Side,xx,20:00\nOnly,two"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors).toEqual([
      'Line 1: no column reads as end. Not read: "Endzeit". For end this check reads: end, end time, ends, finish, finish time, finishes, until, to, set end.',
    ]);
    expect(outcome.skipped ?? []).toEqual([]);
    expect(announcement(outcome)).toBe("The grid was not checked. 1 problem listed.");
  });

  it("treats a first line as a header only when two or more of its cells name a column", () => {
    // One column word in a title line: the line is no header. It holds no time, so it is read as a title
    // (not skipped, and said so in one note), and the grid under it is read.
    const r = report("Running order,Stage\nA,Main,18:00,19:00\nB,Side,18:30,19:30");
    expect(r.sets).toHaveLength(2);
    expect(skippedOf(r)).toEqual([]);
    expect(r.title).toEqual({ line: 1, text: "Running order,Stage" });
    expect(r.notes).toEqual(['Skipped line 1 ("Running order,Stage"): no times found, so it was read as a title.']);
  });

  it("reads dotted, compact and h times, and a single a or p after a 12-hour time", () => {
    const r = report(
      [
        "A,Main,6.30pm,7.30 pm",
        "B,Side,18.30,1930",
        "C,Tent,18h30,19H45",
        "D,Main,6:30p,8.00p",
        "E,Side,23:30,0030",
        "F,Tent,20:00,2430",
        "G,Side,6.30 PM,7:45P",
      ].join("\n"),
    );
    expect(r.sets.map((s) => [s.act, s.start, s.end])).toEqual([
      ["A", 1110, 1170],
      ["B", 1110, 1170],
      ["C", 1110, 1185],
      ["D", 1110, 1200],
      ["E", 1410, 1470],
      ["F", 1200, 1470],
      ["G", 1110, 1185],
    ]);
    expect(report("A,Main,11.30a,12:15p").sets[0]).toMatchObject({ start: 690, end: 735 });
    // A bare number of one to three digits is still not a time, and hours stop at 47.
    for (const value of ["6", "18", "630"]) {
      expect(errors(`A,Main,${value},19:00`)).toEqual([`Line 1 (A): the start time "${value}" is not a time such as ${FORMS}.`]);
    }
    expect(errors("A,Main,18:00,4800")).toEqual([`Line 1 (A): the end time "4800" is not a time such as ${FORMS}.`]);
    expect(errors("A,Main,18.75,19:00")[0]).toMatch(/start time "18\.75"/);
  });

  it("names the act and quotes the rejected value in a skip, and keeps the act for the line's mark and pair rules", () => {
    const r = report("Tidal Fields,Main,18:00,19:00\nCobalt Rows,Side,18:30,19:30\nPaper Lanterns,Tent,19:00,20:00\nMystery Booking TBC,Tent,25:99,26:30");
    expect(skippedOf(r)).toEqual([`Line 4 (Mystery Booking TBC): the start time "25:99" is not a time such as ${FORMS}.`]);
    expect(r.skipped?.map((item) => [item.line, item.act])).toEqual([[4, "Mystery Booking TBC"]]);
    // The guard's grid (the messy paste): line 4's message, word for word.
    expect(skippedOf(report(MESSY_LINES.join("\n")))[0]).toBe(
      'Line 4 (Glass Harbour): the start time "25:70" is not a time such as 18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm.',
    );
  });

  it("carries the day column's one value, and none without a day column", () => {
    expect(report("Day,Act,Stage,Start,End\nSat 14 June,A,Main,18:00,19:00\nsat 14 june,B,Side,18:30,19:30").day).toBe("Sat 14 June");
    expect(report("A,Main,18:00,19:00").day).toBeNull();
    expect(report("Day,Act,Stage,Start,End\n,A,Main,18:00,19:00").day).toBeNull();
  });

  // Fix pass: a semicolon grid, the CSV a spreadsheet writes where the comma is the decimal mark, reads on the
  // first paste; the first non-blank line decides, as it does for a tab.
  it("reads a grid separated by semicolons when its first line is, and keeps a comma grid whose name holds one", () => {
    // A header in a spreadsheet's own words, an unquoted comma in a name, a quoted semicolon, trailing separators.
    const r = report(
      [
        "Artist;Stage;Start;Finish;",
        "Earth, Wind & Fire;Pyramid;18:00;19:15;",
        '"Rock; Roll";Other Stage;18.30;19.30;',
        "Mystery Booking;Park;25:99;26:30;",
        "Zola;Park;1900;2000;",
      ].join("\r\n"),
    );
    expect(r.sets.map((s) => [s.act, s.stage, s.start, s.end])).toEqual([
      ["Earth, Wind & Fire", "Pyramid", 1080, 1155],
      ["Rock; Roll", "Other Stage", 1110, 1170],
      ["Zola", "Park", 1140, 1200],
    ]);
    expect(skippedOf(r)).toEqual([`Line 4 (Mystery Booking): the start time "25:99" is not a time such as ${FORMS}.`]);
    expect(separatorHint(r.skipped)).toBeNull();
    // Positional, a locked column and a day column read the same way.
    expect(report("A;Main;18:00;19:00;yes\nB;Side;18:30;19:30;").sets.map((s) => [s.act, s.locked])).toEqual([
      ["A", true],
      ["B", false],
    ]);
    expect(report("Day;Act;Stage;Start;End\nSat;A;Main;18:00;19:00").day).toBe("Sat");
    // A header it cannot read by semicolons is named in the same one message.
    expect(errors("Act;Stage;Start;Endzeit\nA;Main;18:00;19:00")).toEqual([
      'Line 1: no column reads as end. Not read: "Endzeit". For end this check reads: end, end time, ends, finish, finish time, finishes, until, to, set end.',
    ]);
    // Commas outnumber semicolons on the first line: a comma grid, its semicolon kept in the name.
    expect(report("Rock; Roll,Main,18:00,19:00\nB,Side,18:30,19:30").sets.map((s) => s.act)).toEqual(["Rock; Roll", "B"]);
    // A semicolon inside a quoted field does not count towards the choice.
    expect(report('"A;B;C",Main,18:00,19:00').sets.map((s) => s.act)).toEqual(["A;B;C"]);
    // A tab on the first line still means tab.
    expect(report("A;x\tMain\t18:00\t19:00").sets.map((s) => s.act)).toEqual(["A;x"]);
  });
});

describe("punctuation at the end of a header cell", () => {
  it("reads a “Fixed?” header as the lock column, so a Y locks its set and no column is said to be ignored", () => {
    const r = report(
      "﻿Performer\tVenue\tFrom\tTo\tFixed?\r\nVelvet Static\tMain Stage\t17:00\t18:00\tY\r\nAmber Kite\tSide Stage\t17:30\t18:30\t",
    );
    expect(r.sets.map((s) => [s.act, s.locked])).toEqual([
      ["Velvet Static", true],
      ["Amber Kite", false],
    ]);
    expect(r.notes).toEqual([]);
  });

  it("reads a value the lock column cannot read under “Fixed?” as a skipped line, as it does under “locked”", () => {
    const grid = (lock: string) => `Act,Stage,Start,End,${lock}\nLowland Kites,Tent,17:30,18:15,maybe\nAmber Kite,Main,18:30,19:30,`;
    const plain = report(grid("locked"));
    const asked = report(grid("Fixed?"));
    expect(asked.sets.map((s) => s.act)).toEqual(plain.sets.map((s) => s.act));
    expect((asked.skipped ?? []).map((s) => s.message)).toEqual((plain.skipped ?? []).map((s) => s.message));
    expect((asked.skipped ?? []).length).toBe(1);
  });

  it("reads other header words with punctuation at either end, and still reads underscores and spaces", () => {
    const r = report("Act:,Stage:,*Start time*,End.,(Locked)\nA,Main,18:00,19:00,yes\nB,Side,18:30,19:30,");
    expect(r.sets.map((s) => [s.act, s.stage, s.start, s.end, s.locked])).toEqual([
      ["A", "Main", 1080, 1140, true],
      ["B", "Side", 1110, 1170, false],
    ]);
    expect(r.notes).toEqual([]);
    expect(report("ACT_NAME, stage ,set_start,Set  End\nA,Main,18:00,19:00").sets).toHaveLength(1);
    expect(report("Time?,Act,Stage\n18:00-19:00,A,Main").sets[0]).toMatchObject({ start: 1080, end: 1140 });
  });

  it("ends the ignored-column note with one mark when the last name already ends in one", () => {
    expect(report("act,stage,start,end,Notes?\nA,Main,18:00,19:00,x").notes).toEqual([
      "Ignored a column this page does not read: Notes?",
    ]);
    expect(report("act,stage,start,end,Notes.\nA,Main,18:00,19:00,x").notes).toEqual([
      "Ignored a column this page does not read: Notes.",
    ]);
    expect(report("Genre!,act,stage,start,end,Notes\nrock,A,Main,18:00,19:00,x").notes).toEqual([
      "Ignored 2 columns this page does not read: Genre!, Notes.",
    ]);
    expect(report("act,stage,start,end,Notes\nA,Main,18:00,19:00,x").notes).toEqual([
      "Ignored a column this page does not read: Notes.",
    ]);
  });

  it("names no column with a cell of punctuation alone, and still refuses a header that misses one", () => {
    expect(errors("act,stage,start,?\nA,Main,18:00,19:00")).toEqual([
      'Line 1: no column reads as end. Not read: "?". For end this check reads: end, end time, ends, finish, finish time, finishes, until, to, set end.',
    ]);
  });
});

// A title above the grid ("Glastonbury Sunday") does not refuse the whole paste. The separator is
// decided by the lines that split into four fields (a header or title line first), and a first line with no time
// in it that cannot be a row is read as a title: not checked, not a skipped line, said so in one note.
describe("a title line above the grid", () => {
  const note = (line: number, text: string) => `Skipped line ${line} ("${text}"): no times found, so it was read as a title.`;
  const TAB_ROWS = "Sprints\tWoodsies\t14:00\t14:45\nKaty J Pearson\tThe Park\t14:00\t15:00\nJoy Crookes\tWoodsies\t15:00\t16:00";

  it("reads a tab grid under a title: its sets, no skipped line, the title and one note", () => {
    const titles: [string, string][] = [
      ["Glastonbury Sunday", "Glastonbury Sunday"],
      ["Saturday 4 July", "Saturday 4 July"],
      ["DRAFT v3 - do not share", "DRAFT v3 - do not share"],
      ["Saturday\t\t\t", "Saturday"],
    ];
    for (const [first, text] of titles) {
      const r = report(`${first}\n${TAB_ROWS}`);
      expect(r.sets.map((s) => [s.row, s.act, s.stage, s.start, s.end])).toEqual([
        [2, "Sprints", "Woodsies", 840, 885],
        [3, "Katy J Pearson", "The Park", 840, 900],
        [4, "Joy Crookes", "Woodsies", 900, 960],
      ]);
      expect(r.stages).toEqual(["Woodsies", "The Park"]);
      expect(r.skipped ?? []).toEqual([]);
      expect(r.title).toEqual({ line: 1, text });
      expect(r.notes).toEqual([note(1, text)]);
      // The partial notice does not show for a title.
      expect(skippedSentence(r.skipped ?? [], r.sets.length)).toBeNull();
      expect(r.shared).toHaveLength(1);
      expect(announcement({ ok: true, report: r })).toBe("Rule breaks: 0. Sets that share time: 1 pair.");
    }
  });

  it("reads a comma grid under a two-field title such as “Saturday, 4 July”", () => {
    const r = report("Saturday, 4 July\nA,Main,18:00,19:00\nB,Side,18:30,19:30");
    expect(r.sets.map((s) => [s.row, s.act])).toEqual([
      [2, "A"],
      [3, "B"],
    ]);
    expect(r.skipped ?? []).toEqual([]);
    expect(r.title).toEqual({ line: 1, text: "Saturday, 4 July" });
    expect(r.notes).toEqual([note(1, "Saturday, 4 July")]);
  });

  it("counts blank lines before a title, and quotes at most 30 characters of it", () => {
    const r = report("\n\nGlastonbury Sunday\nA,Main,18:00,19:00\nB,Side,18:30,19:30");
    expect(r.title).toEqual({ line: 3, text: "Glastonbury Sunday" });
    expect(r.notes).toEqual([note(3, "Glastonbury Sunday")]);
    expect(r.sets.map((s) => s.row)).toEqual([4, 5]);
    const long = "The Very Long Title Of A Festival Day Programme";
    expect(long.length).toBeGreaterThan(30);
    const cut = report(`${long}\nA,Main,18:00,19:00\nB,Side,18:30,19:30`);
    expect(cut.notes).toEqual([`Skipped line 1 ("${long.slice(0, 30)}…"): no times found, so it was read as a title.`]);
    expect(cut.title?.text).toBe(long);
    // Whatever is pasted, the title kept is clipped like every echo, and a CRLF paste reads the same.
    const huge = report(`${"x".repeat(300)}\r\nA,Main,18:00,19:00\r\nB,Side,18:30,19:30`);
    expect(Array.from(huge.title?.text ?? "").length).toBeLessThanOrEqual(81);
    expect(huge.notes[0]).toMatch(/^Skipped line 1 \("x{30}…"\): no times found/);
  });

  it("leaves a grid with no title as it was: no title, no note, the same sets and skips", () => {
    const grids = [
      "A,Main,18:00,19:00\nB,Side,18:30,19:30",
      "A\tMain\t18:00\t19:00\nB\tSide\t18:30\t19:30",
      "A;Main;18:00;19:00\nB;Side;18:30;19:30",
      "act,stage,start,end\nA,Main,18:00,19:00",
      "act\tstage\ttime\nA\tMain\t18:00-19:00",
      MESSY_LINES.join("\n"),
      MESSY_LINES.map((line) => line.split(",").join("\t")).join("\n"),
      MESSY_LINES.map((line) => line.split(",").join(";")).join("\n"),
      SAMPLE_GRID,
    ];
    for (const grid of grids) {
      const r = report(grid);
      expect(r.title).toBeUndefined();
      expect(r.notes.filter((n) => n.startsWith("Skipped line"))).toEqual([]);
    }
    expect(report(MESSY_LINES.join("\n")).sets).toHaveLength(11);
    expect(skippedOf(report(MESSY_LINES.join("\n")))).toEqual([
      'Line 4 (Glass Harbour): the start time "25:70" is not a time such as 18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm.',
    ]);
  });

  it("reads the majority separator: one comma data line among tab lines is a line fault, never a title", () => {
    const r = report("A,Main,18:00,19:00\nB\tSide\t18:30\t19:30\nC\tTent\t19:00\t20:00");
    expect(r.sets.map((s) => s.act)).toEqual(["B", "C"]);
    expect(skippedOf(r)).toEqual(["Line 1: expected act, stage, start, end (and locked), but found 1 field."]);
    expect(r.title).toBeUndefined();
    expect(r.notes).toEqual([]);
  });

  it("prints the counted no-breaks line after a title, never the bare sentence", () => {
    // Two fields and no time, over two clean comma rows: a title, and a clean result on part of a paste.
    const r = report("Sprints,Woodsies\nA,Main,18:00,19:00\nB,Side,18:30,19:30");
    expect(r.title).toEqual({ line: 1, text: "Sprints,Woodsies" });
    expect(r.notes).toEqual([note(1, "Sprints,Woodsies")]);
    expect(r.sets).toHaveLength(2);
    expect(r.breaks).toEqual([]);
    expect(noBreaksLine(r)).toBe("No rule breaks found among the 2 sets checked, against the settings above.");
    // The report with no title and nothing skipped keeps the bare sentence; a title or a skip alone counts.
    const plain = report("A,Main,18:00,19:00\nB,Side,19:30,20:30");
    expect(noBreaksLine(plain)).toBe(CHECK_COPY.noBreaks);
    expect(noBreaksLine({ sets: r.sets, skipped: [] })).toBe(CHECK_COPY.noBreaks);
    expect(noBreaksLine({ sets: r.sets, skipped: [], title: { line: 1, text: "Sprints,Woodsies" } })).toBe(
      "No rule breaks found among the 2 sets checked, against the settings above.",
    );
    expect(noBreaksLine({ sets: r.sets.slice(0, 1), title: { line: 1, text: "x" } })).toBe(
      "No rule breaks found among the 1 set checked, against the settings above.",
    );
  });

  it("keeps a line of four or more fields with two or more filled as a line fault, not a title", () => {
    const r = report("A,Main,,bad\nB,Side,18:30,19:30\nC,Tent,19:00,20:00");
    expect(r.title).toBeUndefined();
    expect(r.sets.map((s) => s.act)).toEqual(["B", "C"]);
    expect(r.skipped?.map((item) => item.line)).toEqual([1]);
    expect(skippedOf(r)[0]).toMatch(/^Line 1 \(A\): the start time "" is not a time/);
    expect(noBreaksLine(r)).toBe("No rule breaks found among the 2 sets checked, against the settings above.");
    // Times in it keep it a row, however it is spelled.
    for (const first of ["A,Main,xx,yy", "A,Main,18:00,", "Sunday,18:00", "Doors,6pm to 7pm", "Sunday\t1830"]) {
      const row = runCheck(input(`${first}\nB,Side,18:30,19:30\nC,Tent,19:00,20:00`));
      if (!row.ok) throw new Error(row.errors.join(" | "));
      expect(row.report.title).toBeUndefined();
      expect(row.report.skipped?.map((item) => item.line)).toEqual([1]);
    }
    expect(skippedOf(report("A,Main,xx,yy\nB,Side,18:30,19:30"))[0]).toMatch(/^Line 1 \(A\): the start time "xx" is not a time/);
  });

  // Fix pass: "no times found" must be true of every line the note names. A clock time among a line's words keeps it
  // a line fault (listed, partial notice), so a row pasted without its separators is never dropped as a title.
  it("keeps a line with a clock time among its words as a line fault, so the note's “no times found” is true", () => {
    const firsts = [
      "Doors 18:00",
      "Katy J Pearson 14:00-15:00",
      "Katy J Pearson The Park 14:00 - 15:00",
      "Gates open 6 pm",
      "Gates 6.30p.m.",
      "Doors (18h30)",
      "Sunday, doors 18:00",
      "Late set 6pm-7pm",
    ];
    for (const first of firsts) {
      const comma = runCheck(input(`${first}\nA,Main,18:00,19:00\nB,Side,18:30,19:30`));
      if (!comma.ok) throw new Error(`${first}: ${comma.errors.join(" | ")}`);
      expect(comma.report.title, first).toBeUndefined();
      expect(comma.report.notes.filter((n) => n.includes("read as a title")), first).toEqual([]);
      expect(comma.report.skipped?.map((item) => item.line), first).toEqual([1]);
      expect(comma.report.sets.map((s) => s.act), first).toEqual(["A", "B"]);
      expect(skippedSentence(comma.report.skipped ?? [], comma.report.sets.length), first).toBe(
        "1 line skipped and not checked: line 1. The other 2 sets were checked.",
      );
      expect(noBreaksLine(comma.report), first).toBe("No rule breaks found among the 2 sets checked, against the settings above.");
      // Over tab rows the same: line 1 is listed, the three rows are read.
      const tab = runCheck(input(`${first}\n${TAB_ROWS}`));
      if (!tab.ok) throw new Error(`${first}: ${tab.errors.join(" | ")}`);
      expect(tab.report.title, first).toBeUndefined();
      expect(tab.report.skipped?.map((item) => item.line), first).toEqual([1]);
      expect(tab.report.sets, first).toHaveLength(3);
    }
    expect(skippedOf(report("Doors 18:00\nA,Main,18:00,19:00\nB,Side,18:30,19:30"))).toEqual([
      "Line 1: expected act, stage, start, end (and locked), but found 1 field.",
    ]);
    // A header under such a line is still read as the header, as it is under a title: its own separator and order.
    const headed = report("Doors 18:00\nstage\tact\tend\tstart\nMain\tA\t19:00\t18:00\nSide\tB\t19:30\t18:30");
    expect(headed.title).toBeUndefined();
    expect(headed.sets.map((s) => [s.row, s.act, s.stage, s.start, s.end])).toEqual([
      [3, "A", "Main", 1080, 1140],
      [4, "B", "Side", 1110, 1170],
    ]);
    expect(skippedOf(headed)).toEqual(["Line 1: expected act, stage, start, end (and locked), but found 1 field."]);
    const range = report("Gates 6 pm\nact;stage;time\nA;Main;18:00-19:00\nB;Side;18:30-19:30");
    expect(range.sets.map((s) => [s.row, s.act, s.start, s.end])).toEqual([
      [3, "A", 1080, 1140],
      [4, "B", 1110, 1170],
    ]);
    expect(range.skipped?.map((item) => item.line)).toEqual([1]);
  });

  it("still reads a title with a year, a date or a bare number in it, which are not clock times", () => {
    for (const first of ["Glastonbury 2026", "Riot Fest 2026 Sunday", "Saturday 4 July", "Stage 2a running order", "Season 2025-2026"]) {
      const r = report(`${first}\n${TAB_ROWS}`);
      expect(r.title, first).toEqual({ line: 1, text: first });
      expect(r.notes, first).toEqual([note(1, first)]);
      expect(r.skipped ?? [], first).toEqual([]);
      expect(r.sets, first).toHaveLength(3);
    }
    // A title over a header of ranges still reads by the header's separator when the title has a year.
    const range = report("Glastonbury 2026\nact;stage;time\nA;Main;18:00-19:00\nB;Side;18:30-19:30");
    expect(range.title).toEqual({ line: 1, text: "Glastonbury 2026" });
    expect(range.sets).toHaveLength(2);
  });

  it("builds the title note from the title, as the screen and the printed draft show it", () => {
    expect(titleNote({ line: 1, text: "Glastonbury Sunday" })).toBe(note(1, "Glastonbury Sunday"));
    expect(titleNote({ line: 3, text: "The Very Long Title Of A Festival Day Programme" })).toBe(
      'Skipped line 3 ("The Very Long Title Of A Festi…"): no times found, so it was read as a title.',
    );
    const r = report(`Glastonbury Sunday\n${TAB_ROWS}`);
    expect(r.notes).toEqual([titleNote(r.title!)]);
  });

  it("runs the header test on the line after a title, and reads the rows with that header's layout", () => {
    const tab = report("Glastonbury Sunday\nstage\tact\tend\tstart\nMain\tA\t19:00\t18:00\nSide\tB\t19:30\t18:30");
    expect(tab.sets.map((s) => [s.row, s.act, s.stage, s.start, s.end])).toEqual([
      [3, "A", "Main", 1080, 1140],
      [4, "B", "Side", 1110, 1170],
    ]);
    expect(tab.title).toEqual({ line: 1, text: "Glastonbury Sunday" });
    expect(tab.skipped ?? []).toEqual([]);
    expect(tab.notes).toEqual([note(1, "Glastonbury Sunday")]);
    // A title over a header of three columns: the header's own separator, and its one column of ranges.
    const range = report("Glastonbury Sunday\nact;stage;time\nA;Main;18:00-19:00\nB;Side;18:30-19:30");
    expect(range.sets.map((s) => [s.row, s.act, s.start, s.end])).toEqual([
      [3, "A", 1080, 1140],
      [4, "B", 1110, 1170],
    ]);
    expect(range.skipped ?? []).toEqual([]);
    expect(range.notes).toEqual([note(1, "Glastonbury Sunday")]);
    // A comma title over a tab header reads by the header's tab.
    expect(report("Saturday, 4 July\nact\tstage\tstart\tend\nA\tMain\t18:00\t19:00").sets).toHaveLength(1);
    // The header's own refusal still holds under a title.
    expect(errors("Glastonbury Sunday\nact,stage,start\nA,Main,18:00,19:00")).toEqual([
      expect.stringMatching(/^Line 2: no column reads as end\./),
    ]);
  });

  it("is conservative: an unclosed quote, a second title line, the header's comma over semicolon rows, a title alone", () => {
    // An unclosed quote on line 1 stays a line fault, never a title.
    const open = report('"Glastonbury Sunday\nA,Main,18:00,19:00\nB,Side,18:30,19:30');
    expect(open.title).toBeUndefined();
    expect(skippedOf(open)).toEqual(["Line 1 (Glastonbury Sunday): a quote is not closed or has text after it."]);
    expect(open.sets).toHaveLength(2);
    // Only the first non-blank line can be a title.
    const two = report("Glastonbury\nSunday\nA,Main,18:00,19:00\nB,Side,18:30,19:30");
    expect(two.title).toEqual({ line: 1, text: "Glastonbury" });
    expect(skippedOf(two)).toEqual(["Line 2: expected act, stage, start, end (and locked), but found 1 field."]);
    // A title over a comma header and semicolon rows reads by the header's comma: the rows are line faults, with the hint.
    const outcome = runCheck(input("Sunday\nact,stage,start,end\nA;Main;18:00;19:00\nB;Side;18:30;19:30"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors).toEqual([
      "Line 3: the header has 4 columns, but this line has 1 field.",
      "Line 4: the header has 4 columns, but this line has 1 field.",
    ]);
    expect(separatorHint(outcome.skipped)).toBe(CHECK_COPY.separatorHint);
    // A title alone, or a title and a header, finds no set.
    expect(errors("Glastonbury Sunday")).toEqual(["No sets found. Put one set on each line: act, stage, start, end."]);
    expect(errors("Glastonbury Sunday\nact,stage,start,end")).toEqual(["No sets found. Put one set on each line: act, stage, start, end."]);
  });

  describe("gridDelimiter", () => {
    it("takes a header's own separator first, then a title's header's, then the lines with four fields", () => {
      expect(gridDelimiter(["act,stage,start,end", "A\tMain\t18:00\t19:00", "B\tSide\t18:30\t19:30"])).toBe(",");
      expect(gridDelimiter(["Glastonbury Sunday", "act;stage;time", "A;Main;18:00-19:00"])).toBe(";");
      expect(gridDelimiter(["Saturday, 4 July", "act\tstage\tstart\tend", "A\tMain\t18:00\t19:00"])).toBe("\t");
      expect(gridDelimiter(["Glastonbury Sunday", "A\tMain\t18:00\t19:00", "B\tSide\t18:30\t19:30"])).toBe("\t");
      expect(gridDelimiter(["", "", "Saturday, 4 July", "A,Main,18:00,19:00", "B,Side,18:30,19:30"])).toBe(",");
      expect(gridDelimiter(["A,Main,18:00,19:00", "B\tSide\t18:30\t19:30", "C\tTent\t19:00\t20:00"])).toBe("\t");
    });

    it("counts a line only when its quotes close, and falls back to the first line on a tie or no four-field line", () => {
      expect(gridDelimiter(['"A;B;C",Main,18:00,19:00'])).toBe(",");
      expect(gridDelimiter(["A,Main,18:00,19:00", "B;Side;18:30;19:30"])).toBe(",");
      expect(gridDelimiter(["A;Main;18:00;19:00", "B,Side,18:30,19:30"])).toBe(";");
      expect(gridDelimiter(["A;x\tMain\t18:00\t19:00"])).toBe("\t");
      expect(gridDelimiter(["A", "B", "C"])).toBe(",");
      expect(gridDelimiter(["a;b;c", "d;e"])).toBe(";");
      expect(gridDelimiter([])).toBe(",");
      expect(gridDelimiter(["", "  "])).toBe(",");
    });
  });
});
