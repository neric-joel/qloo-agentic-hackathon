import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BudgetDial, readingNudge, Scorecard } from "./budget-dial";

// Every figure below is invented for the test.
const BASELINE = { samples: 300, mean_regret: 1, p10_index: 92.1568, p90_index: 108.5582, degenerate: false };

describe("the dial's settle", () => {
  it("is drawn at its reading in the server HTML: dot, span, figure and title", () => {
    const html = renderToStaticMarkup(createElement(BudgetDial, { index: 116.71, baseline: BASELINE }));
    expect(html).not.toContain("data-reveal");
    expect(html).toContain("<title");
    expect(html).toContain("Clash Budget Index 116.7</title>");
    expect(html).toMatch(/<p class="type-numeral[^"]*">116.7<\/p>/);
    // One decimal, as the hero's decision card prints it; the day's figure also labels its marker.
    expect(html).toMatch(/class="fill-primary[^"]*">116.7<\/text>/);
    // Exactly one numeral, at h2 scale (2.25rem/1) rather than display size.
    expect(html).toContain('<p class="type-numeral shrink-0 text-[2.25rem] leading-none">');
    expect(html.match(/type-numeral/g)).toHaveLength(1);
    // The scale runs 60 to 140 here: 116.71 sits at 70.9%, 100 at 50%, the middle 80% from 40.2% to 60.7%.
    expect(html).toMatch(/<circle data-dot="" cx="70.9%" cy="26"/);
    expect(html).toContain('<rect data-band="" x="40.2%"');
    expect(html).toContain('width="20.5%"');
    expect(html).toContain('class="cc-dial-gap" style="--draw-from:1"');
    expect(html).toMatch(/<line data-span="" x1="50%" x2="70.9%"[^>]*pathLength="1"/);
    // The 100 tick keeps its meaning, the ends are labelled, and nothing on the scale is set under 13px.
    expect(html).toContain(">100 = average</text>");
    expect(html).toMatch(/>60<\/text>/);
    expect(html).toMatch(/>140<\/text>/);
    expect(/<svg[\s\S]*<\/svg>/.exec(html)?.[0]).not.toMatch(/text-\[(?:[0-9]|1[0-2])px\]/);
    expect(html).toContain("Scale from 60 to 140. 100 is the average of random valid timetables of this lineup");
  });

  it("says in the board's compact caption what the index reads and what it is measured against", () => {
    const plain = (synthetic: boolean) =>
      renderToStaticMarkup(createElement(BudgetDial, { index: 116.71, baseline: BASELINE, compact: true, synthetic }))
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");
    const caption = (synthetic: boolean) => /<figcaption[\s\S]*?<\/figcaption>/.exec(
      renderToStaticMarkup(createElement(BudgetDial, { index: 116.71, baseline: BASELINE, compact: true, synthetic })),
    )?.[0] ?? "";
    const published = caption(false).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(published).toContain(
      "The published timetable, against random valid timetables of this lineup: 100 is their average, and lower is better.",
    );
    expect(published).toContain("It counts only what clashes cost");
    expect(published.split(" ").length).toBeLessThanOrEqual(45);
    expect(caption(true)).toContain("The invented timetable, against random valid timetables");
    // The Derived chip stays with the figure, worded for the day it reads.
    expect(plain(false)).toContain("Derived");
    expect(plain(true)).toContain("Derived");
    // ...printed as a plain 12px/500 muted word in the sans after a middle dot: no mono caps, no box, tooltip kept.
    const markup = renderToStaticMarkup(createElement(BudgetDial, { index: 116.71, baseline: BASELINE, compact: true }));
    const chip = /<span class="([^"]*)"[^>]*data-provenance="derived"/.exec(markup)?.[1] ?? "";
    expect(chip.split(" ")).toEqual(expect.arrayContaining(["font-sans", "text-[12px]", "font-medium", "text-muted-foreground"]));
    expect(chip.split(" ")).not.toEqual(expect.arrayContaining(["font-mono"]));
    expect(chip.split(" ")).not.toContain("uppercase");
    expect(markup).toMatch(/Clash Budget Index <span aria-hidden="true"[^>]*>·<\/span> <span[^>]*data-provenance="derived"/);
    expect(chip.split(" ")).not.toContain("tag");
    expect(chip).not.toMatch(/rounded|border/);
    expect(markup).toContain('title="Calculated by this app from Qloo data."');
    expect(markup).toContain('<span class="sr-only">Source: </span>Derived');
  });

  it("draws the gap from 100 whichever side the reading falls", () => {
    const below = renderToStaticMarkup(createElement(BudgetDial, { index: 94, baseline: BASELINE }));
    expect(below).toContain('style="--draw-from:-1"');
    expect(below).toMatch(/<circle data-dot="" cx="42.5%"/);
    expect(below).toMatch(/<line data-span="" x1="42.5%" x2="50%"/);
  });
});

describe("the dial's shading", () => {
  const html = renderToStaticMarkup(createElement(BudgetDial, { index: 116.71, baseline: BASELINE, compact: true }));
  const svg = /<svg[\s\S]*<\/svg>/.exec(html)?.[0] ?? "";

  it("uses named tokens only: a border-strong axis, a muted band, an ink 100 tick and dot, vermilion for the excess", () => {
    expect(html).not.toContain("color-mix");
    expect(svg).not.toMatch(/opacity/);
    // The span from 100 to the reading: 3px of vermilion above 100, the excess cost.
    expect(svg).toMatch(/<line data-span="" x1="50%" x2="70.9%" y1="26" y2="26" stroke="var\(--primary\)" stroke-width="3"/);
    // The 100 tick: 2px of ink, 18px tall, centred on the axis (y 17 to 35).
    expect(svg).toMatch(/<line data-ref="" x1="50%" x2="50%" y1="17" y2="35" stroke="var\(--foreground\)" stroke-width="2"/);
    // At or under 100 the span is a grey graphic, not a cost; vermilion marks only the reading's label there.
    for (const index of [94, 100]) {
      const below = renderToStaticMarkup(createElement(BudgetDial, { index, baseline: BASELINE, compact: true }));
      const belowSvg = /<svg[\s\S]*<\/svg>/.exec(below)?.[0] ?? "";
      expect(belowSvg, `${index}`).toMatch(/<line data-span=""[^>]*stroke="var\(--ink-3\)" stroke-width="3"/);
      expect(belowSvg, `${index}`).not.toContain('stroke="var(--primary)"');
    }
  });

  it("draws the home page's axis: a 1px border-strong line across the ruler with 6px end ticks at the domain's ends", () => {
    expect(svg).toMatch(/<line data-axis="" x1="0" x2="100%" y1="26" y2="26" stroke="var\(--border-strong\)" stroke-width="1"/);
    expect(svg).toMatch(/<line data-tick="min" x1="0" x2="0" y1="23" y2="29" stroke="var\(--border-strong\)" stroke-width="1"/);
    expect(svg).toMatch(/<line data-tick="max" x1="100%" x2="100%" y1="23" y2="29" stroke="var\(--border-strong\)" stroke-width="1"/);
    // No capsule track, no clip and no needle: the figure is an axis, not a gauge.
    expect(svg).not.toMatch(/<clipPath|rx="4"|data-needle|data-underlay="needle"/);
    expect(svg).not.toMatch(/<rect(?![^>]*data-band)/);
  });

  it("shows the middle 80% as an 8px muted band whose extent two 12px, 1px border-strong ticks carry", () => {
    // 92.2 to 108.6 on a scale of 60 to 140: 40.2% to 60.7%.
    expect(svg).toMatch(/<rect data-band="" x="40.2%" y="22" width="20.5%" height="8" fill="var\(--muted\)"/);
    expect(svg).toMatch(/<line data-tick="p10" x1="40.2%" x2="40.2%" y1="20" y2="32" stroke="var\(--border-strong\)" stroke-width="1"/);
    expect(svg).toMatch(/<line data-tick="p90" x1="60.7%" x2="60.7%" y1="20" y2="32" stroke="var\(--border-strong\)" stroke-width="1"/);
    // With no baseline there is no band and no band ticks; the axis and its ends stay.
    const bare = renderToStaticMarkup(createElement(BudgetDial, { index: 116.71, baseline: null, compact: true }));
    expect(bare).not.toMatch(/data-band|data-tick="p10"|data-tick="p90"/);
    expect(bare).toContain('data-axis=""');
  });

  it("parts every ink mark from the vermilion span with 2px of paper: the 100 tick's underlay and the dot's halo", () => {
    // The figure sits open on the page's paper at every width, so its halos are the paper (the sheet's
    // white in print), never the card.
    expect(svg).not.toContain("var(--card)");
    // The underlay is the tick's own height and 6px wide (2px of paper either side of the 2px tick).
    expect(svg).toMatch(
      /<line data-underlay="ref" x1="50%" x2="50%" y1="17" y2="35" stroke="var\(--background\)" stroke-width="6" class="print:stroke-card"/,
    );
    // The reading: a 10px ink dot on a 14px paper circle.
    expect(svg).toMatch(/<circle data-halo="" cx="70.9%" cy="26" r="7" fill="var\(--background\)" class="print:fill-card"/);
    expect(svg).toMatch(/<circle data-dot="" cx="70.9%" cy="26" r="5" fill="var\(--foreground\)"/);
    // Drawing order: the band under the axis, then the band's ticks, the span, the underlay (so it cuts a
    // gap into the span and the band), the 100 tick, the halo and the dot.
    const order = [
      'data-band=""',
      'data-axis=""',
      'data-tick="min"',
      'data-tick="max"',
      'data-tick="p10"',
      'data-tick="p90"',
      'data-span=""',
      'data-underlay="ref"',
      'data-ref=""',
      'data-halo=""',
      'data-dot=""',
    ].map((part) => svg.indexOf(part));
    order.forEach((at, i) => {
      expect(at, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    // Far from 100 the dot stands at its reading, unnudged.
    expect(svg).not.toMatch(/<(?:circle|text)[^>]*transform/);
  });

  it("never lets the dot touch the 100 tick, even a fraction of a point from 100", () => {
    // At the ruler's narrowest (272px, what the xl rail gives it) the two centres stay 8px apart: 5px of
    // dot, 2px of paper halo, 1px of tick.
    const narrowest = 272;
    for (const index of [100.4, 101]) {
      const markup = renderToStaticMarkup(createElement(BudgetDial, { index, baseline: BASELINE, compact: true }));
      const dot = /<circle data-dot=""[^>]*>/.exec(markup)?.[0] ?? "";
      const halo = /<circle data-halo=""[^>]*>/.exec(markup)?.[0] ?? "";
      const ref = /<line data-ref=""[^>]*>/.exec(markup)?.[0] ?? "";
      const cx = (tag: string) => Number(/(?:cx|x1)="([\d.]+)%"/.exec(tag)?.[1]);
      const shift = (tag: string) => Number(/transform="translate\(([-\d.]+) 0\)"/.exec(tag)?.[1] ?? 0);
      expect(shift(dot), `nudged at ${index}`).toBeGreaterThan(0);
      const apart = ((cx(dot) - cx(ref)) / 100) * narrowest + shift(dot);
      expect(apart, `centres at ${index}`).toBeGreaterThanOrEqual(8);
      // The halo and the label move with the dot; the reading is still printed exactly.
      expect(shift(halo)).toBe(shift(dot));
      expect(cx(halo)).toBe(cx(dot));
      expect(markup).toMatch(new RegExp(`<text[^>]*transform="translate\\(${shift(dot)} 0\\)"[^>]*>${index.toFixed(1)}</text>`));
      // Wider rulers only spread the two further apart.
      expect(((cx(dot) - cx(ref)) / 100) * 400 + shift(dot)).toBeGreaterThan(apart);
    }
    // Below 100 the nudge points left; at 100 exactly it still clears the tick.
    expect(readingNudge(-0.001)).toBeLessThan(0);
    expect(Math.abs(readingNudge(0))).toBe(8);
    expect(readingNudge(0.05)).toBe(0);
  });

  it("sets the reading in 13px semibold mono vermilion, 4px clear above the 100 tick and the dot, off the axis", () => {
    // The label's baseline is at y 13; the 100 tick starts at y 17 and the dot's halo at y 19.
    expect(html).toMatch(/<text x="70.9%" y="13"[^>]*class="fill-primary font-mono text-\[13px\] font-semibold"/);
  });

  it("prints its ends in muted 13px mono and '100 = average' under the mark in ink semibold", () => {
    expect(html).toMatch(/<text x="0" y="52" text-anchor="start" class="fill-muted-foreground font-mono text-\[13px\]">60<\/text>/);
    expect(html).toMatch(/<text x="100%" y="52" text-anchor="end" class="fill-muted-foreground font-mono text-\[13px\]">140<\/text>/);
    expect(html).toMatch(/<text x="50%" y="52" text-anchor="middle" class="fill-foreground font-mono text-\[13px\] font-semibold">100 = average<\/text>/);
  });

  it("is drawn at full size: a ruler 56px tall that spans its column", () => {
    expect(svg).toMatch(/^<svg width="100%" height="56" role="img"/);
  });

  it("keeps 'lower is better' in the board's caption, under a hairline across the block's own width", () => {
    expect(html).toMatch(/<figcaption class="mt-4 border-t border-border pt-4"/);
    expect(html).toContain("and lower is better.");
  });

  it("sets the sentence at 15px semibold over a 13px muted explanation on a 1.625 line, never clamped", () => {
    const caption = /<figcaption[\s\S]*?<\/figcaption>/.exec(html)?.[0] ?? "";
    expect(caption).toContain(
      '<p class="text-[0.9375rem] leading-snug font-semibold">17% more taste-overlap cost than the average random valid timetable.</p>',
    );
    expect(caption).toContain('<p data-index-explain="" class="mt-2 text-[0.8125rem] leading-relaxed text-muted-foreground">');
    expect(caption).not.toMatch(/line-clamp|truncate|overflow-hidden/);
  });
});

describe("the Index block", () => {
  it("sits open on the paper under one hairline rule below 1280px, and drops it there for the rail's own", () => {
    const card = renderToStaticMarkup(createElement(Scorecard, null, "x"));
    expect(card).toBe('<div class="border-t border-border pt-5 sm:pt-6 xl:border-0 xl:pt-0">x</div>');
    // No box at any width: no corner, surface edge, card fill, padding all round or shadow.
    expect(card).not.toMatch(/rounded|surface-edge|bg-card|\bp-6\b|shadow/);
  });
});

describe("the score rail", () => {
  // The rail wrapper in clash-control.tsx: the one element that is sticky from 1280px.
  const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
  const railMatch = /className="([^"]*xl:sticky[^"]*)"/.exec(source);
  const rail = railMatch?.[1] ?? "";
  // The one wrapper directly inside it that carries the top rule, so the rule and the content both
  // start at the section container's left edge while each focus ring keeps 12px of room at the sides.
  const ruled =
    railMatch === null
      ? ""
      : (/^\s*<div className="([^"]*)"/.exec(source.slice(railMatch.index + railMatch[0].length).replace(/^[^>]*>/, ""))?.[1] ?? "");

  it("opens onto the paper from 1280px under one hairline top rule, with no box", () => {
    expect(rail).not.toBe("");
    expect(ruled).not.toBe("");
    expect(rail.split(" ")).toEqual(expect.arrayContaining(["xl:-mx-3", "xl:px-3"]));
    expect(ruled.split(" ")).toEqual(expect.arrayContaining(["xl:border-t", "xl:border-border", "xl:pt-6", "max-xl:contents"]));
    expect(rail).not.toMatch(/rounded|surface-edge|bg-card|xl:p-6|shadow/);
    expect(ruled).not.toMatch(/rounded|surface-edge|bg-card|xl:p-6|shadow|xl:-?m[xl]-|xl:p[xl]-/);
    // The one edge is the top rule: no side or bottom edge, and none on the sticky container.
    expect(rail.split(" ").filter((name) => name.startsWith("xl:border"))).toEqual([]);
    expect(ruled.split(" ").filter((name) => name.startsWith("xl:border"))).toEqual(["xl:border-t", "xl:border-border"]);
    // Sticky, and still scrolling on its own when taller than the screen; a row scrolled into view by
    // the keyboard keeps 4px for its 2px focus outline at its 2px offset, at the sides, top and foot.
    expect(rail.split(" ")).toEqual(
      expect.arrayContaining(["xl:sticky", "xl:overflow-y-auto", "xl:overscroll-contain", "xl:scroll-py-1", "xl:pb-1"]),
    );
  });

  it("puts no surface class on the Index block's call: the block carries its own rule below 1280px", () => {
    const call = /<Scorecard className="([^"]*)"/.exec(source)?.[1] ?? "";
    expect(call).not.toBe("");
    expect(call).not.toMatch(/rounded|border|bg-|shadow|\bp[xytb]?-\d/);
  });
});
