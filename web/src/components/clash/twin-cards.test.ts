import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Act, Twin } from "@/lib/preset";

import { TwinCards } from "./twin-cards";

// Every name and figure below is invented for the test.
const ACTS = [
  { id: "one", name: "Act One", popularity: 0.95 },
  { id: "two", name: "Act Two", popularity: 0.94 },
  { id: "three", name: "Act Three", popularity: 0.93 },
] as unknown as Act[];

const TWIN: Twin = {
  act: "Act One",
  act_id: "one",
  shared: { act: "Act Two", act_id: "two", overlap: 0.9, draw_pct: 0.8 },
  separate: { act: "Act Three", act_id: "three", overlap: 0.2, draw_pct: 0.8 },
  gap: 0.7,
};

describe("TwinCards motion", () => {
  it("holds the taste meters back so the draw meters fill first, and draws both final in the server HTML", () => {
    const html = renderToStaticMarkup(createElement(TwinCards, { twins: [TWIN], acts: ACTS }));
    expect(html).not.toContain("data-reveal");
    const tracks = [...html.matchAll(/aria-label="([^"]*)" class="([^"]*)"/g)].map((m) => [m[1].split(" ")[0], m[2].includes("cc-twin-taste")]);
    expect(tracks).toEqual([
      ["Draw", false],
      ["Taste", true],
      ["Draw", false],
      ["Taste", true],
    ]);
  });

  it("does not delay the taste meters on a card without draw", () => {
    const html = renderToStaticMarkup(createElement(TwinCards, { twins: [TWIN], acts: [] }));
    expect(html).toContain("cc-meter-fill");
    expect(html).not.toContain("cc-twin-taste");
  });
});

describe("TwinCards colour", () => {
  it("draws the taste meters teal on a published day and ink on the invented day, which credits nothing to Qloo", () => {
    const published = renderToStaticMarkup(createElement(TwinCards, { twins: [TWIN], acts: ACTS }));
    expect(published).toContain("bg-prov-qloo");
    const invented = renderToStaticMarkup(createElement(TwinCards, { twins: [TWIN], acts: ACTS, synthetic: true }));
    expect(invented).not.toContain("prov-qloo");
  });
});

describe("TwinCards length", () => {
  it("keeps the heading, the lede and the chips outside a closed disclosure that holds the cards", () => {
    const html = renderToStaticMarkup(createElement(TwinCards, { twins: [TWIN], acts: ACTS }));
    const details = html.indexOf("<details");
    expect(details).toBeGreaterThan(html.indexOf("Same popularity, different taste overlap"));
    expect(details).toBeGreaterThan(html.indexOf("score 90 or more"));
    expect(html).toMatch(/<details(?![^>]*\bopen\b)[^>]*><summary[^>]*>See the equal-popularity pairs/);
    expect(html.indexOf("Two rivals for")).toBeGreaterThan(details);
    // The sentence that restated the chips is gone.
    expect(html).not.toContain("Draw is a saved Qloo value");
  });
});
