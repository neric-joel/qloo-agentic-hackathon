import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";

import { CoverageMeter } from "./coverage-meter";

// Every name and figure below is invented for the test; none of it is Qloo data.

function render(synthetic: boolean): string {
  const preset = parsePreset({ ...rawTinyPreset(), synthetic });
  return renderToStaticMarkup(
    createElement(CoverageMeter, { coverage: preset.report.coverage, metrics: preset.report.metrics, synthetic }),
  );
}

function fillClass(html: string): string {
  return /<span data-coverage-fill="" class="([^"]*)"/.exec(html)?.[1] ?? "";
}

describe("the coverage meter's fill", () => {
  it("is Qloo teal on a published day, on a muted track", () => {
    const html = render(false);
    expect(fillClass(html).split(" ")).toContain("bg-prov-qloo");
    expect(html).toMatch(/rounded-bar bg-muted"><span data-coverage-fill=""/);
    // A 64 x 6px meter, so it reads as a meter rather than a stray dash.
    expect(html).toMatch(/class="relative block h-1\.5 w-16 shrink-0 overflow-hidden rounded-bar bg-muted"/);
    // 2 of 3 sets scored.
    expect(html).toContain("width:66.7%");
  });

  it("is ink on the invented day, with no teal class anywhere", () => {
    const html = render(true);
    expect(fillClass(html).split(" ")).toContain("bg-foreground");
    expect(html).not.toMatch(/prov-qloo/);
  });

  it("keeps the wording: the heading, the count and the left-out line", () => {
    const published = render(false);
    expect(published).toContain("Qloo coverage");
    expect(published).toMatch(/left out, not scored as zero/);
    expect(published.replace(/<[^>]+>/g, "").replace(/&nbsp;| /g, " ")).toMatch(/2 of 3 sets scored · 1 left out, not scored as zero/);
    expect(published).not.toContain("priced");
    expect(render(true)).toContain("Signal coverage");
  });
});
