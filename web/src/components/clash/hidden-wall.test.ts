import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Evidence, HiddenWallItem } from "@/lib/preset";

import { HiddenWall, wallCount } from "./hidden-wall";

// Every name and figure below is invented for the test.
function item(n: number): HiddenWallItem {
  return {
    festival: "test-fest-2025",
    day: "Sun",
    acts: [`Act ${n}A`, `Act ${n}B`],
    genres: [["urn:tag:genre:indie"], ["urn:tag:genre:punk"]],
    overlap_pct: 0.9,
    draw_pct: 0.8,
    overlap_min: 30,
    source: null,
    shared_tags: [],
  };
}

function evidence(shown: number, total: number): Evidence {
  return {
    hidden_wall: Array.from({ length: shown }, (_, i) => item(i + 1)),
    hidden_wall_total: total,
    receipts: {},
    twins: [],
  };
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("wallCount", () => {
  it("says the rest are not saved when the wall shows fewer than the source counted", () => {
    expect(wallCount(8, 13)).toBe("Showing 8 of 13 sourced examples. The other 5 are not saved with this day.");
    expect(wallCount(3, 4)).toBe("Showing 3 of 4 sourced examples. The other one is not saved with this day.");
  });

  it("gives the plain count when the wall shows them all", () => {
    expect(wallCount(4, 4)).toBe("4 sourced examples");
    expect(wallCount(1, 1)).toBe("1 sourced example");
  });
});

describe("HiddenWall", () => {
  it("prints the count line above the cards", () => {
    const partial = text(renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(2, 5) })));
    expect(partial).toContain("Showing 2 of 5 sourced examples. The other 3 are not saved with this day.");
    const whole = text(renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(2, 2) })));
    expect(whole).toContain("2 sourced examples");
    expect(whole).not.toContain("Showing");
  });

  it("renders no section at all when the day has no examples", () => {
    expect(renderToStaticMarkup(createElement(HiddenWall, { evidence: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(0, 0) }))).toBe("");
  });

  it("prints the count line in sentence case, not as an all-caps label", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(2, 5) }));
    const line = html.match(/<p class="([^"]*)">Showing/);
    expect(line).not.toBeNull();
    expect(line?.[1]).not.toContain("type-kicker");
  });
});
