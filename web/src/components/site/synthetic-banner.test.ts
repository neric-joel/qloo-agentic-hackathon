import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PresetSources } from "@/components/clash/preset-sources";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset, parsePresetList } from "@/lib/preset";
import { showsSyntheticNotice, SYNTHETIC_NOTICE } from "@/lib/synthetic-notice";

import { SyntheticNotice } from "./synthetic-banner";

// Every name and figure below is invented for the test.

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the synthetic flag", () => {
  it("is read from the preset and its list entry, and is false when absent", () => {
    expect(parsePreset(rawTinyPreset()).synthetic).toBe(false);
    expect(parsePreset({ ...rawTinyPreset(), synthetic: true }).synthetic).toBe(true);
    expect(parsePreset({ ...rawTinyPreset(), synthetic: "yes" }).synthetic).toBe(false);
    const entry = { id: "a", title: "A", city: null, sets: 3, stages: 2, scored_share: 0.9 };
    expect(parsePresetList([entry, { ...entry, id: "b", synthetic: true }]).map((e) => e.synthetic)).toEqual([
      false,
      true,
    ]);
  });
});

describe("SyntheticNotice", () => {
  it("says what the day is in the agreed words", () => {
    expect(SYNTHETIC_NOTICE).toBe("Synthetic example day: invented acts, no Qloo data");
    const html = text(renderToStaticMarkup(createElement(SyntheticNotice)));
    expect(html).toBe(SYNTHETIC_NOTICE);
  });

  it("stays off the pages that do not show the day", () => {
    expect(showsSyntheticNotice("/")).toBe(true);
    expect(showsSyntheticNotice("/brief")).toBe(true);
    expect(showsSyntheticNotice("/method")).toBe(false);
    expect(showsSyntheticNotice("/check")).toBe(false);
    expect(showsSyntheticNotice("/checkout")).toBe(true);
  });
});

describe("PresetSources on a synthetic day", () => {
  it("states that the day is invented and does not claim a festival's published timetable", () => {
    const preset = parsePreset({ ...rawTinyPreset(), synthetic: true });
    const html = text(renderToStaticMarkup(createElement(PresetSources, { preset })));
    expect(html).toContain(SYNTHETIC_NOTICE);
    expect(html).toContain("no request was sent to Qloo");
    expect(html).toContain("Draw (invented popularity)");
    expect(html).not.toContain("does not use Clash Control");
    expect(html).not.toContain("popularity on Qloo");
  });

  it("keeps the real wording for a real day", () => {
    const html = text(renderToStaticMarkup(createElement(PresetSources, { preset: parsePreset(rawTinyPreset()) })));
    expect(html).toContain("does not use Clash Control");
    expect(html).toContain("Draw (Qloo popularity)");
    expect(html).not.toContain(SYNTHETIC_NOTICE);
  });
});
