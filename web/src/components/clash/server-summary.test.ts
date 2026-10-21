import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseDecision } from "@/lib/decision";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";
import { summarize } from "@/lib/server-summary";

import { ClashControlFallback } from "./clash-control";
import { SummaryBoard, SummaryScore } from "./server-summary";

// Every name and figure below is invented for the test.

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function otherSummary() {
  const raw = rawTinyPreset() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  raw.id = "other-fest-sun";
  raw.title = "Other Fest, Sunday";
  raw.report.metrics.clash_budget_index = 86.4;
  return summarize(parsePreset(raw));
}

describe("SummaryScore and SummaryBoard", () => {
  const summary = summarize(parsePreset(rawTinyPreset()));

  it("print the index, its sentence and the evidence", () => {
    const html = text(renderToStaticMarkup(createElement(SummaryScore, { summary })));
    expect(html).toContain("Clash Budget Index");
    expect(html).toContain("104");
    expect(html).toContain(`${summary.vsRandom}.`);
    expect(html).toContain("Lower is better.");
    expect(html).toContain("Priced from 2 saved Qloo request records: 2 of 3 acts matched to Qloo artists; 1 not priced.");
  });

  it("set the index open on the paper under one hairline rule, as the loaded Index block is", () => {
    const html = renderToStaticMarkup(createElement(SummaryScore, { summary }));
    const open = /^<div class="([^"]*)">/.exec(html)?.[1] ?? "";
    // The loaded block's rule and top space below 1280px, and the loaded rail's measure from there.
    expect(open).toBe("border-t border-border pt-5 sm:pt-6 xl:-mx-1 xl:px-3");
    // No box: no corner, surface edge, card fill or shadow, on the outer block or inside it.
    expect(html).not.toMatch(/rounded-lg|surface-edge|bg-card|shadow/);
    // One rule only.
    expect(html.match(/border-t\b/g)).toHaveLength(1);
  });

  it("print the costliest clashes with taste overlap, draw and share", () => {
    const html = text(renderToStaticMarkup(createElement(SummaryBoard, { summary })));
    expect(html).toContain("Tiny Fest, Saturday: the costliest clash");
    expect(html).toContain("Ann Arbor × and Bo Diddly Squat");
    expect(html).toContain("Taste overlap 70");
    expect(html).toContain("Draw 85");
    expect(html).toContain("100% of the day’s clash cost");
    expect(html).not.toContain("Q-ANN");
    expect(html).not.toContain("Garage");
  });
});

describe("ClashControlFallback", () => {
  it("renders the server summary of the selected preset instead of skeletons", () => {
    const html = text(renderToStaticMarkup(createElement(ClashControlFallback, { intro: null, summary: otherSummary() })));
    expect(html).toContain("Other Fest, Sunday: the costliest clash");
    expect(html).toContain(
      "86 By this index, the published timetable scores 86.4, where 100 is the average random valid timetable and higher means more clash cost.",
    );
    expect(html).not.toContain("Tiny Fest, Saturday");
  });

  it("draws the hero's final frame in the server HTML: the move, its readout and side effect, the taste line and Keep in place", () => {
    const decision = parseDecision({
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
      rule: null,
    });
    const summary = summarize(parsePreset(rawTinyPreset()), decision);
    const html = renderToStaticMarkup(createElement(ClashControlFallback, { intro: null, summary }));
    const plain = text(html);
    expect(plain).toContain("Bo Diddly Squat 60 minutes later 60 → to 0 min shared with Ann Arbor");
    expect(plain.indexOf("Bo Diddly Squat 60 minutes later")).toBeLessThan(plain.indexOf("Clash Budget Index"));
    expect(html).toMatch(/<p data-side-effects=""[^>]*>No other overlap gets longer\.<\/p>/);
    expect(plain).toContain("Taste overlap: 70 of 100 on this bill (a rank, not attendance) Source: Derived");
    expect(plain).toContain("Selected and scored by this app’s index");
    expect(html).toContain('id="decision-heading"');
    // Keep is drawn in place, at its size, but the server cannot act yet: it is not pressable.
    expect(html).toMatch(/<button[^>]*data-variant="default"[^>]*disabled=""|<button[^>]*disabled=""[^>]*data-variant="default"/);
    expect(plain).not.toContain("Open this move");
    // The drawing's frame and its key are in the server HTML too.
    expect(html).toContain("data-day-graph");
    expect(html).toContain("data-day-graph-key");
  });

  it("has no move, no Keep and no taste line without a decision", () => {
    const html = renderToStaticMarkup(createElement(ClashControlFallback, { intro: null, summary: otherSummary() }));
    expect(html).not.toContain("data-readout");
    expect(html).not.toContain("data-taste-line");
    expect(text(html)).not.toContain("Keep this move");
    expect(text(html)).not.toContain("See one decision");
    // The heading names the day's costliest clash instead.
    expect(/<h2 id="decision-heading"[^>]*>([^<]*)<\/h2>/.exec(html)?.[1]).toBe("Ann Arbor × Bo Diddly Squat: 60 min shared");
  });

  it("falls back to skeletons without a summary", () => {
    const html = renderToStaticMarkup(createElement(ClashControlFallback, { intro: null, summary: null }));
    // The placeholders hold still: the static bone, with no pulse.
    expect(html).toContain('class="block bg-muted');
    expect(html).not.toContain("animate-pulse");
    expect(text(html)).not.toContain("Clash Budget Index");
  });
});
