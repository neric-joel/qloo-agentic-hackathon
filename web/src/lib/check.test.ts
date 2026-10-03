import { describe, expect, it } from "vitest";

import {
  CHECK_COPY,
  CHECK_LIMITS,
  TEMPLATE_CSV,
  announcement,
  clip,
  formatClock,
  runCheck,
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
    expect(errors('"Smith,Main,18:00,19:00')[0]).toMatch(/Line 1: a quote is not closed/);
  });

  it("refuses duplicate rows and says which line it repeats", () => {
    const e = errors("A,Main,18:00,19:00\nB,Side,18:00,19:00\n a ,main,18:00,19:00");
    expect(e).toEqual(["Line 3: the same set as line 1 (same act, stage and times)."]);
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
      expect(errors("A,Main,20:00,19:00")[0]).toMatch(/Line 1: the set ends before it starts/);
      expect(errors("A,Main,20:00,06:00")[0]).toMatch(/ends before it starts/);
    });

    it("refuses a start before 06:00 when other sets start in the afternoon, rather than guess", () => {
      const e = errors("A,Main,18:00,19:00\nB,Main,00:30,01:15");
      expect(e[0]).toMatch(/Line 2: starts before 06:00/);
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
    expect(errors("name,place,start,end\nA,Main,18:00,19:00")[0]).toMatch(/header should read/);
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

describe("pair rules", () => {
  const grid = "A,Main,18:00,19:00\nB,Side,18:30,19:30\nA2,Main,20:00,21:00\nB,Tent,22:00,23:00";

  it("refuses a name that matches no row", () => {
    const e = errors(grid, { pairs: "A | Nobody" });
    expect(e).toEqual(["Pair line 1: “Nobody” matches no set in the grid."]);
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

  it("is an invented day of 18 to 22 sets on three stages", () => {
    expect(r.sets.length).toBeGreaterThanOrEqual(18);
    expect(r.sets.length).toBeLessThanOrEqual(22);
    expect(r.stages).toHaveLength(3);
    expect(SAMPLE_GRID).toMatch(/Lantern Stage/);
  });

  it("has exactly four planted findings, one of each kind", () => {
    expect(r.breaks).toHaveLength(4);
    expect(r.breaks.map((b) => b.rule)).toEqual([1, 3, 4, 5]);
    expect(r.breaks.map((b) => b.text)).toEqual([
      "Quiet Voltage is booked on two stages at the same time.",
      "Willow Lights and Cedar Orchard are 10 minutes apart on Night Tent, under the 15-minute changeover.",
      "Mosaic Syndicate ends at 00:20, after the 00:00 curfew.",
      "Lunar Roads and Copper Circuit share 25 minutes, and you asked that they never overlap.",
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
    expect(CHECK_COPY.lede).toBe(
      "Paste one day of a draft timetable. This page lists the rule breaks and the sets that share time. It runs in your browser: nothing you paste is sent anywhere, including to Qloo.",
    );
    expect(CHECK_COPY.printTitle).toBe("Draft check, not a verdict");
    expect(CHECK_COPY.noBreaks).toBe("No rule breaks found against the settings above.");
    expect(CHECK_COPY.notComputed).toBe(
      "Not computed: taste overlap. It needs a Qloo reading per act, and this page makes no request to Qloo or to anything else. The two published days on the home page show what it adds.",
    );
    expect(CHECK_COPY.elsewhere).toBe(
      "Rule checks like these also exist in scheduling software. What this app adds is the audience reading on the published days; this page does not have it.",
    );
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
