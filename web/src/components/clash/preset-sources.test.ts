import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";

import { PresetSources } from "./preset-sources";

// Every name and figure below is invented for the test.

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function render(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(PresetSources, { preset: parsePreset({ ...rawTinyPreset(), ...overrides }) }));
}

describe("PresetSources", () => {
  it("points to /method for the definitions and keeps the day's draw spread, which /method does not state", () => {
    const html = render();
    const plain = text(html);
    expect(plain).toContain("Draw, taste overlap and the index are defined on How we know .");
    expect(html).toMatch(/<a[^>]*href="\/method"[^>]*>How we know<\/a>/);
    expect(plain).toMatch(/Draw \(Qloo popularity\): \d+ of \d+ acts on this day score 90 or more out of 100\./);
    // The long definitions are gone from the home page.
    expect(plain).not.toContain("Clash price");
    expect(plain).not.toContain("Lower is better");
    expect(plain).not.toContain("whichever act was the signal");
  });

  it("keeps the festival disclaimer, the Recorded badge and the source list", () => {
    const plain = text(render({ built_at: "2026-10-01T00:00:00+00:00" }));
    expect(plain).toContain("does not use Clash Control");
    expect(plain).toContain("Timetable sources");
    expect(plain).toContain("example.com");
    expect(plain).toMatch(/Recorded/);
  });

  it("drops the data notes the coverage meter repeats, and the block when none is left", () => {
    const repeated = "No usable Qloo signal for: Cy Twombly. They are left out, not scored as zero.";
    const other = "Overlap row for Ann Arbor failed (network).";
    const both = text(render({ overlap_notes: [repeated, other] }));
    expect(both).toContain("Notes on the data");
    expect(both).toContain(other);
    expect(both).not.toContain(repeated);
    expect(text(render({ overlap_notes: [repeated] }))).not.toContain("Notes on the data");
  });
});
