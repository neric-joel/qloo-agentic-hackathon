import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
    expect(html).toContain("86 on the Clash Budget Index:");
    expect(html).not.toContain("Tiny Fest, Saturday");
  });

  it("falls back to skeletons without a summary", () => {
    const html = renderToStaticMarkup(createElement(ClashControlFallback, { intro: null, summary: null }));
    expect(html).toContain("animate-pulse");
    expect(text(html)).not.toContain("Clash Budget Index");
  });
});
