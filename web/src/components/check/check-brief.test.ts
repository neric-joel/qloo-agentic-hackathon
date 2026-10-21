import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { runCheck } from "@/lib/check";
import { decisionLine, pairDecisionId, pairLabel, type Decision } from "@/lib/check-decisions";
import { parsePriceAnswer, priceRequest, type PriceRequest } from "@/lib/check-price";
import { SAMPLE_GRID, SAMPLE_SETTINGS, publishedLabel } from "@/lib/check-sample";
import { findChange, targetOfBreak } from "@/lib/check-trial";

import { BRIEF_FOOTER, BRIEF_FOOTER_PUBLISHED, BRIEF_ROWS, CheckBrief, briefFooter, snapshotLine } from "./check-brief";

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
    // A saved press sends only the names of the pairs it compares (C2): here the 7 acts of the 5 longest overlaps.
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
    // A published day was not pasted: its footer says where the figures came from (C7).
    expect(page).toContain(BRIEF_FOOTER_PUBLISHED);
    expect(page).not.toContain("from the pasted grid");
    expect(briefFooter(null, true)).toBe("Computed in your browser from the published timetable.");
  });
});

describe("round 35: a brief of a partial check says what it left out", () => {
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
    expect(page).toContain(
      "Draft check, not a verdict Snapshot: the pasted grid as checked. 1 line skipped and not checked: line 4. The other 4 sets were checked. Pair line 1 not checked: Glass Harbour is on a skipped line. Read 4 sets on 3 stages.",
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
