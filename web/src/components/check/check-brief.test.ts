import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SIGN_OFF } from "@/components/brief/brief-sheet";
import { runCheck } from "@/lib/check";
import { decisionLine, pairDecisionId, pairLabel, type Decision } from "@/lib/check-decisions";
import { parsePriceAnswer, priceRequest, type PriceRequest } from "@/lib/check-price";
import { SAMPLE_GRID, SAMPLE_SETTINGS, publishedLabel } from "@/lib/check-sample";
import { findChange, targetOfBreak } from "@/lib/check-trial";

import {
  BRIEF_FOOTER,
  BRIEF_FOOTER_PUBLISHED,
  BRIEF_OVERLAPS,
  BRIEF_ROWS,
  CheckBrief,
  DRAFT_HEADING,
  DRAFT_SIGN_OFF,
  briefFooter,
  draftHeading,
  overlapLine,
  printedDate,
  printedOverlaps,
  printedSkipped,
  skippedName,
  snapshotLine,
} from "./check-brief";

// Every name below is invented for the test.

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

describe("the one-page brief", () => {
  const outcome = runCheck({ grid: SAMPLE_GRID, ...SAMPLE_SETTINGS });
  if (!outcome.ok) throw new Error("refused");
  const report = outcome.report;

  it("prints only in print, with the changes applied, the decisions and the priced overlaps", () => {
    const [change] = findChange(report, targetOfBreak(report.breaks[2])).changes;
    const request = priceRequest(report) as PriceRequest;
    const answer = parsePriceAnswer(
      {
        mode: "saved",
        source: "invented_day",
        preset_id: "synthetic-lanternfield-friday",
        fetched_at: null,
        coverage: { acts: request.acts.length, priced: request.acts.length, unpriced: [] },
        pairs: request.overlaps.map((o, i) => ({ a: o.a, b: o.b, status: "priced", taste_overlap: 0.9 - i / 10, pair_rank: i + 1, reason: null })),
        requests_used: 0,
        scope_note: "x",
      },
      request,
      "saved",
    );
    const html = renderToStaticMarkup(
      createElement(CheckBrief, {
        report,
        applied: [change],
        decisions: [{ id: "x", label: "Saffron Season and Ivory Lights share 20 minutes", status: "kept", reason: "Contract", note: "", change: null }],
        price: answer,
      }),
    );
    expect(html).toMatch(/^<div class="hidden[^"]*print:block/);
    const page = text(html);
    expect(page).toContain("Draft check, not a verdict");
    expect(page).toContain(`Changes applied to a working copy (1) ${change.lines[0]} (was`);
    expect(page).toContain("Rule breaks (4)");
    expect(page).toContain("Your decisions (1) Saffron Season and Ivory Lights share 20 minutes: Kept on purpose. Contract.");
    // A saved press sends only the names of the pairs it compares: here the 7 acts of the 5 longest overlaps.
    expect(request.acts).toHaveLength(7);
    expect(page).toContain(
      `Compared using the invented example day: its acts and affinities are invented, not Qloo data. No Qloo request was sent. ${request.acts.length} of ${request.acts.length} acts with a usable signal.`,
    );
    expect(page).toContain("Taste overlap 90 / 100, taste rank 1 of 5.");
    expect(page).toContain("Taste overlap compared (5 longest overlaps)");
    expect(page).toContain(
      `${BRIEF_FOOTER} Taste overlap: Values come from the invented example day: ranks among its invented lineup, not Qloo data and not attendance.`,
    );
    expect(page).not.toMatch(/Audience overlap \d|Audience overlap:|0\.\d\d,/);
    expect(page).not.toMatch(/rank among the pasted acts/);
  });

  it(`prints at most ${BRIEF_ROWS} rows a list, then says how many more are on screen`, () => {
    const grid = Array.from({ length: 30 }, (_, i) => `Act ${i},Main,${String(10 + Math.floor(i / 3)).padStart(2, "0")}:${String((i % 3) * 20).padStart(2, "0")},${String(10 + Math.floor(i / 3)).padStart(2, "0")}:${String((i % 3) * 20 + 15).padStart(2, "0")}`).join("\n");
    const tight = runCheck({ grid, changeover: "15", curfew: "", pairs: "" });
    if (!tight.ok) throw new Error(tight.errors.join(" | "));
    expect(tight.report.breaks.length).toBeGreaterThan(BRIEF_ROWS);
    const page = text(renderToStaticMarkup(createElement(CheckBrief, { report: tight.report, applied: [], decisions: [], price: null })));
    expect(page).toContain(`+${tight.report.breaks.length - BRIEF_ROWS} more on screen`);
    expect(page).toContain("Your decisions (0) None marked.");
    expect(page).not.toContain("Audience overlap of the longest overlaps");
  });

  it("names the real comparator population in the footer, with the acts a large draft did not send", () => {
    const grid = Array.from({ length: 30 }, (_, i) => `Act ${i},Stage ${i % 6},${10 + Math.floor(i / 6) * 2}:00,${11 + Math.floor(i / 6) * 2}:30`).join("\n");
    const big = runCheck({ grid, changeover: "", curfew: "", pairs: "" });
    if (!big.ok) throw new Error(big.errors.join(" | "));
    const request = priceRequest(big.report) as PriceRequest;
    const live = parsePriceAnswer(
      {
        mode: "live",
        source: "qloo_live",
        preset_id: null,
        fetched_at: "2026-10-04T10:00:00Z",
        coverage: { acts: 25, priced: 25, unpriced: [] },
        pairs: request.overlaps.map((o, i) => ({ a: o.a, b: o.b, status: "priced", taste_overlap: 0.9 - i / 10, pair_rank: i + 1, reason: null })),
        requests_used: 31,
      },
      request,
      "live",
    );
    expect(live).not.toBeNull();
    const page = text(renderToStaticMarkup(createElement(CheckBrief, { report: big.report, applied: [], decisions: [], price: live })));
    expect(page).toContain(
      "Computed in your browser from the pasted grid. Taste overlap: A rank among the 25 acts sent to Qloo just now, not attendance, and not comparable with a published day’s figures. This grid has 30 different acts and at most 25 are sent, so 5 acts are not sent and not compared.",
    );
    expect(briefFooter(null)).toBe(BRIEF_FOOTER);
  });

  it("prints a pair the person kept on purpose under Your decisions: the only place a clash is called on purpose", () => {
    const pair = report.shared.find((item) => item.a.locked || item.b.locked) ?? report.shared[0];
    const decision: Decision = {
      id: pairDecisionId(pair),
      label: pairLabel(pair),
      status: "kept",
      reason: null,
      note: "",
      change: null,
    };
    const page = text(renderToStaticMarkup(createElement(CheckBrief, { report, applied: [], decisions: [decision], price: null })));
    expect(page).toContain(`Your decisions (1) ${decisionLine(decision)}`);
    expect(decisionLine(decision)).toContain("Kept on purpose");
    // A lock alone is never worded as on purpose.
    const undecided = text(renderToStaticMarkup(createElement(CheckBrief, { report, applied: [], decisions: [], price: null })));
    expect(undecided).not.toMatch(/on purpose|deliberate|intended/i);
  });

  it("labels a published day's snapshot as the published timetable, under the title", () => {
    const label = publishedLabel("Brookfield 2030, Saturday");
    const page = text(
      renderToStaticMarkup(createElement(CheckBrief, { report, applied: [], decisions: [], price: null, published: label })),
    );
    expect(page).toContain(`Draft check, not a verdict ${label} Snapshot: the published timetable as checked.`);
    expect(snapshotLine({ sample: false, checkedAt: null, applied: 0, published: true })).toBe("Snapshot: the published timetable as checked.");
    expect(snapshotLine({ sample: false, checkedAt: null, applied: 0 })).toBe("Snapshot: the pasted grid as checked.");
    // A published day was not pasted: its footer says where the figures came from.
    expect(page).toContain(BRIEF_FOOTER_PUBLISHED);
    expect(page).not.toContain("from the pasted grid");
    expect(briefFooter(null, true)).toBe("Computed in your browser from the published timetable.");
  });
});

describe("a brief of a partial check says what it left out", () => {
  // Line 4's start is 25:70; Glass Harbour, on that line, is named by a pair rule.
  const grid = [
    "Tidal Fields,Main Stage,14:00,15:00",
    "Cobalt Rows,Side Stage,14:15,15:15",
    "Paper Lanterns,Tent,14:30,15:15",
    "Glass Harbour,Tent,25:70,19:30",
    "Saltmarsh,Main Stage,15:30,16:30",
  ].join("\n");
  const outcome = runCheck({ grid, changeover: "", curfew: "", pairs: "Tidal Fields | Glass Harbour" });
  if (!outcome.ok) throw new Error("refused");
  const page = text(renderToStaticMarkup(createElement(CheckBrief, { report: outcome.report, applied: [], decisions: [], price: null })));

  it("prints the skipped sentence under its heading, and the pair rule it could not check", () => {
    // The skipped line is named by its act and the value the screen quotes, under the sentence.
    expect(page).toContain(
      "Draft check, not a verdict Snapshot: the pasted grid as checked. 1 line skipped and not checked: line 4. The other 4 sets were checked. Line 4 (Glass Harbour, start “25:70”) skipped and not checked. Pair line 1 not checked: Glass Harbour is on a skipped line. Read 4 sets on 3 stages.",
    );
  });

  it("never prints the bare no-breaks sentence while a line is skipped", () => {
    expect(page).toContain("Rule breaks (0) No rule breaks found among the 4 sets checked, against the settings above.");
    expect(page).not.toContain("No rule breaks found against the settings above.");
    // The settings line lists only the rules that were checked: none here.
    expect(page).toContain("Never overlap: none listed.");
  });

  it("prints nothing of the sort for a check that skipped no line", () => {
    const whole = runCheck({ grid: SAMPLE_GRID, ...SAMPLE_SETTINGS });
    if (!whole.ok) throw new Error("refused");
    const sample = text(renderToStaticMarkup(createElement(CheckBrief, { report: whole.report, applied: [], decisions: [], price: null })));
    expect(sample).not.toMatch(/skipped|not checked/);
  });
});

describe("the printed draft has a heading, the day, the print date and a sign-off block", () => {
  const sample = runCheck({ grid: SAMPLE_GRID, ...SAMPLE_SETTINGS });
  if (!sample.ok) throw new Error("refused");
  const html = renderToStaticMarkup(createElement(CheckBrief, { report: sample.report, applied: [], decisions: [], price: null }));

  it("signs off with the published-day brief's three labels, so the two cannot drift", () => {
    expect([...DRAFT_SIGN_OFF]).toEqual([...SIGN_OFF]);
    const block = html.match(/<dl data-sign-off="" class="([^"]*)">([\s\S]*?)<\/dl>/);
    // On paper only: hidden on screen, a flex row in print, after the footer.
    expect(block?.[1].split(" ")).toEqual(expect.arrayContaining(["hidden", "print:flex"]));
    expect(html.indexOf("data-sign-off")).toBeGreaterThan(html.indexOf(BRIEF_FOOTER));
    expect([...(block?.[2] ?? "").matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1])).toEqual([...DRAFT_SIGN_OFF]);
    // Each label has a line to write on: an empty 1px rule in the control-edge ink.
    const lines = [...(block?.[2] ?? "").matchAll(/<dd aria-label="blank, to fill in" class="([^"]*)"><\/dd>/g)].map((m) => m[1]);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toContain("border-b border-border-strong");
  });

  it("starts the page with the heading, the grid's day when it has exactly one, then the print date", () => {
    const heading = html.match(/<p data-draft-heading="" class="([^"]*)">([\s\S]*?)<\/p>/);
    expect(heading?.[1].split(" ")).toEqual(expect.arrayContaining(["hidden", "print:block"]));
    // First on the page, before the title; the server's render has no date (the browser writes it in its own span).
    expect(text(html).startsWith(`${DRAFT_HEADING} Draft check, not a verdict`)).toBe(true);
    expect(heading?.[2]).toBe(`${DRAFT_HEADING}<span data-printed-date=""></span>`);
    expect(draftHeading(null)).toBe("Draft grid check");
    expect(draftHeading("Sat 14 June")).toBe("Draft grid check · Sat 14 June");
    expect(printedDate(new Date(2026, 9, 20, 23, 59))).toBe("20 Oct 2026");
    expect(printedDate(new Date(2027, 0, 3))).toBe("3 Jan 2027");
    const withDay = runCheck({ grid: "Day,Act,Stage,Start,End\nSat 14 June,A,Main,18:00,19:00", changeover: "", curfew: "", pairs: "" });
    if (!withDay.ok) throw new Error("refused");
    const dated = renderToStaticMarkup(createElement(CheckBrief, { report: withDay.report, applied: [], decisions: [], price: null }));
    expect(text(dated)).toMatch(/^Draft grid check · Sat 14 June Draft check, not a verdict/);
  });

  it("adds nothing on screen: the preview thumbnail draws neither the heading nor the sign-off", () => {
    const preview = renderToStaticMarkup(createElement(CheckBrief, { report: sample.report, applied: [], decisions: [], price: null, preview: true }));
    for (const hook of ["data-draft-heading", "data-sign-off"]) {
      const opening = preview.match(new RegExp(`<[a-z]+ ${hook}="" class="([^"]*)"`))?.[1] ?? "";
      expect(opening.split(" ")).toContain("hidden");
      expect(opening).toMatch(/print:(block|flex)/);
    }
  });
});

describe("the printed draft lists its overlaps and names its skipped lines", () => {
  // A messy 12-line paste (invented acts; line 4 starts at 25:70; one stage written "Main   Stage").
  const MESSY = [
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
  ].join("\n");
  const messy = runCheck({ grid: MESSY, changeover: "", curfew: "", pairs: "" });
  if (!messy.ok) throw new Error("refused");
  const messyPage = text(renderToStaticMarkup(createElement(CheckBrief, { report: messy.report, applied: [], decisions: [], price: null })));

  it("lists every pair that shares time under the counts, longest first, as act × act: minutes (window)", () => {
    expect(messy.report.shared).toHaveLength(10);
    expect(messyPage).toContain(
      [
        "Read 11 sets on 3 stages. Rule breaks: 0. Sets that share time: 10 pairs.",
        "Tidal Fields × Cobalt Rows: 45 min (14:15–15:00)",
        "Cobalt Rows × Paper Lanterns: 45 min (14:30–15:15)",
        "Saltmarsh × Quiet Engine: 45 min (15:45–16:30)",
        "Quiet Engine × Nobody Has Heard Of Us: 45 min (16:00–16:45)",
        "Velvet Static × Orbit Choir: 45 min (17:15–18:00)",
        "Orbit Choir × Lowland Kites: 45 min (17:30–18:15)",
        "Amber Kite × Ember Coast: 45 min (18:45–19:30)",
        "Tidal Fields × Paper Lanterns: 30 min (14:30–15:00)",
        "Saltmarsh × Nobody Has Heard Of Us: 30 min (16:00–16:30)",
        "Velvet Static × Lowland Kites: 30 min (17:30–18:00)",
        "Settings.",
      ].join(" "),
    );
    // Ten fit: no overflow line.
    expect(messyPage).not.toContain("not printed");
    // The skipped line is named by its act and its rejected value, in the short form.
    expect(messyPage).toContain(
      "1 line skipped and not checked: line 4. The other 11 sets were checked. Line 4 (Glass Harbour, start “25:70”) skipped and not checked.",
    );
  });

  it(`prints ${BRIEF_OVERLAPS} overlaps at most, then "and {k} more overlaps not printed." with their range and total`, () => {
    const sample = runCheck({ grid: SAMPLE_GRID, ...SAMPLE_SETTINGS });
    if (!sample.ok) throw new Error("refused");
    const { shared } = sample.report;
    expect(shared).toHaveLength(35);
    const printed = printedOverlaps(shared);
    expect(printed.lines).toHaveLength(BRIEF_OVERLAPS);
    expect(printed.more).toMatch(/^and 23 more overlaps not printed\. They share \d+ to \d+ min each, \d+ min in all\.$/);
    // Longest first: no printed line is longer than the one before it, and none left off is longer than the last printed.
    const minutes = printed.lines.map((line) => Number(line.match(/: (\d+) min \(/)?.[1]));
    expect(minutes.every((m, i) => i === 0 || m <= minutes[i - 1])).toBe(true);
    expect(minutes[0]).toBe(Math.max(...shared.map((pair) => pair.minutes)));
    const leftOff = [...shared].sort((x, y) => y.minutes - x.minutes).slice(BRIEF_OVERLAPS);
    expect(Math.max(...leftOff.map((pair) => pair.minutes))).toBeLessThanOrEqual(minutes[BRIEF_OVERLAPS - 1]);
    // The pairs left off are accounted for by length: their shortest, longest and summed minutes.
    const leftMinutes = leftOff.map((pair) => pair.minutes);
    const rest = `They share ${Math.min(...leftMinutes)} to ${Math.max(...leftMinutes)} min each, ${leftMinutes.reduce((a, b) => a + b, 0)} min in all.`;
    expect(printed.more).toBe(`and 23 more overlaps not printed. ${rest}`);
    const page = text(renderToStaticMarkup(createElement(CheckBrief, { report: sample.report, applied: [], decisions: [], price: null })));
    expect(page).toContain(`Sets that share time: 35 pairs. ${printed.lines.join(" ")} and 23 more overlaps not printed. ${rest} Settings.`);
    // Exactly twelve print with no overflow line; one more pair is one more left off.
    expect(printedOverlaps(shared.slice(0, BRIEF_OVERLAPS)).more).toBeNull();
    const thirteen = shared.slice(0, BRIEF_OVERLAPS + 1);
    const lastOff = [...thirteen].sort((x, y) => y.minutes - x.minutes)[BRIEF_OVERLAPS];
    expect(printedOverlaps(thirteen).more).toBe(`and 1 more overlap not printed. It shares ${lastOff.minutes} min.`);
    // Left-off pairs of one length say it once.
    const same = Array.from({ length: BRIEF_OVERLAPS + 3 }, () => ({ ...shared[0], minutes: 15 }));
    expect(printedOverlaps(same).more).toBe("and 3 more overlaps not printed. They share 15 min each, 45 min in all.");
    expect(printedOverlaps([])).toEqual({ lines: [], more: null });
  });

  it("gives a window past midnight on the clock, as the screen does", () => {
    const late = runCheck({ grid: "Night Owls,Tent,23:30,24:45\nLate Bloom,Barn,24:00,25:00", changeover: "", curfew: "", pairs: "" });
    if (!late.ok) throw new Error(late.errors.join(" | "));
    expect(late.report.shared.map(overlapLine)).toEqual(["Night Owls × Late Bloom: 45 min (00:00–00:45)"]);
  });

  it("names each skipped line by its act and the value the screen quotes, and only what the message names", () => {
    const skippedOf = (grid: string) => {
      const outcome = runCheck({ grid, changeover: "", curfew: "", pairs: "" });
      if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
      return outcome.report.skipped ?? [];
    };
    const good = "Tidal Fields,Main Stage,14:00,15:00";
    const names = skippedOf(
      [
        good,
        "Glass Harbour,Tent,25:70,19:30",
        "Amber Kite,Main Stage,18:00,soon",
        "Orbit Choir,Side Stage,17:15,18:15,maybe",
        "Ember Coast,Side Stage,19:00,18:00",
        "just some words",
        " ,Tent,14:00,15:00",
      ].join("\n"),
    ).map(skippedName);
    expect(names).toEqual([
      "Line 2 (Glass Harbour, start “25:70”) skipped and not checked.",
      "Line 3 (Amber Kite, end “soon”) skipped and not checked.",
      "Line 4 (Orbit Choir, locked “maybe”) skipped and not checked.",
      "Line 5 (Ember Coast) skipped and not checked.",
      // The screen names no act for a line that did not split: neither does the brief.
      "Line 6 skipped and not checked.",
      "Line 7 skipped and not checked.",
    ]);
    const ranged = skippedOf(["Act,Stage,Set time", "Tidal Fields,Main Stage,18:00-19:00", "Cobalt Rows,Side Stage,whenever"].join("\n"));
    expect(ranged.map(skippedName)).toEqual(["Line 3 (Cobalt Rows, time “whenever”) skipped and not checked."]);
    const repeated = skippedOf([good, good].join("\n"));
    expect(repeated.map(skippedName)).toEqual(["Line 2 (Tidal Fields) skipped and not checked."]);
  });

  it("names five skipped lines at most, then the screen's own count of the rest", () => {
    const lines = Array.from({ length: 7 }, (_, i) => `Act ${i},Tent,2${i}:70,23:00`);
    const outcome = runCheck({ grid: ["Tidal Fields,Main Stage,14:00,15:00", ...lines].join("\n"), changeover: "", curfew: "", pairs: "" });
    if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
    const skipped = outcome.report.skipped ?? [];
    expect(skipped).toHaveLength(7);
    expect(printedSkipped(skipped)).toEqual([
      "Line 2 (Act 0, start “20:70”) skipped and not checked.",
      "Line 3 (Act 1, start “21:70”) skipped and not checked.",
      "Line 4 (Act 2, start “22:70”) skipped and not checked.",
      "Line 5 (Act 3, start “23:70”) skipped and not checked.",
      "Line 6 (Act 4, start “24:70”) skipped and not checked.",
      "And 2 more problems.",
    ]);
    expect(printedSkipped(skipped.slice(0, 6)).at(-1)).toBe("And 1 more problem.");
    expect(printedSkipped([])).toEqual([]);
  });

  it("adds nothing on screen: the preview draws neither the named skipped lines nor the overlap list", () => {
    const preview = renderToStaticMarkup(createElement(CheckBrief, { report: messy.report, applied: [], decisions: [], price: null, preview: true }));
    for (const hook of ["data-brief-overlaps", "data-brief-skipped-lines"]) {
      const opening = preview.match(new RegExp(`<[a-z]+ ${hook}="" class="([^"]*)"`))?.[1] ?? "";
      expect(opening.split(" ")).toContain("hidden");
      expect(opening.split(" ")).toContain("print:block");
    }
    // And neither at all when the grid has no shared time and no skipped line.
    const lone = runCheck({ grid: "Tidal Fields,Main Stage,14:00,15:00", changeover: "", curfew: "", pairs: "" });
    if (!lone.ok) throw new Error("refused");
    const html = renderToStaticMarkup(createElement(CheckBrief, { report: lone.report, applied: [], decisions: [], price: null }));
    expect(html).not.toContain("data-brief-overlaps");
    expect(html).not.toContain("data-brief-skipped-lines");
  });
});

// A title line the check left out is said on paper too, word for word as the screen's note,
// beside the counted no-breaks sentence; a grid with no title prints no such line.
describe("the printed draft says a title line was left out", () => {
  const NOTE = 'Skipped line 1 ("Glastonbury Sunday"): no times found, so it was read as a title.';
  const titled = runCheck({
    grid: "Glastonbury Sunday\nSprints\tWoodsies\t14:00\t14:45\nKaty J Pearson\tThe Park\t14:00\t15:00\nJoy Crookes\tWoodsies\t15:00\t16:00",
    changeover: "",
    curfew: "",
    pairs: "",
  });
  if (!titled.ok) throw new Error("refused");

  it("prints the title note, on paper only, with the counted no-breaks sentence", () => {
    const html = renderToStaticMarkup(createElement(CheckBrief, { report: titled.report, applied: [], decisions: [], price: null }));
    const page = text(html).replace(/&quot;/g, '"');
    expect(page.split(NOTE)).toHaveLength(2);
    expect(page).toContain("Read 3 sets on 2 stages.");
    expect(page).toContain("No rule breaks found among the 3 sets checked, against the settings above.");
    expect(page.indexOf(NOTE)).toBeLessThan(page.indexOf("Read 3 sets on 2 stages."));
    const opening = html.match(/<p data-brief-title-note="" class="([^"]*)"/)?.[1] ?? "";
    expect(opening.split(" ")).toEqual(expect.arrayContaining(["hidden", "print:block"]));
  });

  it("prints no title note when the grid has no title", () => {
    const plain = runCheck({ grid: "A,Main,18:00,19:00\nB,Side,19:30,20:30", changeover: "", curfew: "", pairs: "" });
    if (!plain.ok) throw new Error("refused");
    const html = renderToStaticMarkup(createElement(CheckBrief, { report: plain.report, applied: [], decisions: [], price: null }));
    expect(html).not.toContain("data-brief-title-note");
    expect(text(html)).not.toContain("read as a title");
  });
});
