import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PairStrip, stripDomain, stripX, type StripLane } from "./pair-strip";

// The hero's pair, invented here for the test: the staying set 14:00-14:45, the moving set now 14:00-15:00,
// tested 14:15-15:15.
const staying: StripLane = { key: "staying", kind: "staying", name: "Katy J Pearson", meta: "The Park", start: 840, end: 885 };
const now: StripLane = { key: "now", kind: "now", name: "Sprints", meta: "Now · Woodsies", start: 840, end: 900 };
const tested: StripLane = { key: "tested", kind: "tested", name: "Sprints", meta: "Tested · 14:15–15:15", start: 855, end: 915 };

function render(lanes: readonly StripLane[], props: Partial<Parameters<typeof PairStrip>[0]> = {}): string {
  return renderToStaticMarkup(createElement(PairStrip, { lanes, description: "Read this instead.", ...props }));
}

const bars = (html: string) =>
  [...html.matchAll(/<svg data-strip-bar="(staying|now|tested)"[\s\S]*?<\/svg>/g)].map((m) => ({ kind: m[1], svg: m[0] }));

describe("stripDomain", () => {
  it("floors the earliest start and ceils the latest end of all lanes to 15 minutes, ticks every 30 on the step (3 lanes)", () => {
    const domain = stripDomain([staying, now, tested]);
    expect([domain.start, domain.end, domain.step]).toEqual([840, 915, 30]);
    // One even rhythm: 14:00, 14:30, 15:00. The 15:15 end is not on the step, so it gets no tick (and no
    // label), and no tick stands bare.
    expect(domain.ticks).toEqual([840, 870, 900]);
    expect(domain.ticks).not.toContain(915);
  });

  it("ticks every multiple of the step inside the domain, its ends included, and nothing else", () => {
    // Keep two sets apart's pair, 14:00-15:00: both ends are on the step.
    expect(stripDomain([{ start: 840, end: 900 }, { start: 845, end: 885 }]).ticks).toEqual([840, 870, 900]);
    // An end off the step gets no tick; every tick is a whole step from the next.
    expect(stripDomain([{ start: 855, end: 960 }]).ticks).toEqual([870, 900, 930, 960]);
    expect(stripDomain([{ start: 840, end: 945 }]).ticks).toEqual([840, 870, 900, 930]);
    for (const lanes of [[staying, now, tested], [{ start: 845, end: 900 }, { start: 1000, end: 1095 }], [{ start: 855, end: 960 }], []]) {
      const domain = stripDomain(lanes);
      expect(domain.ticks.length).toBeGreaterThan(0);
      for (const minute of domain.ticks) {
        expect(minute % domain.step).toBe(0);
        expect(minute).toBeGreaterThanOrEqual(domain.start);
        expect(minute).toBeLessThanOrEqual(domain.end);
      }
      domain.ticks.slice(1).forEach((minute, i) => expect(minute - domain.ticks[i]).toBe(domain.step));
      // Nothing on the step is left out: no room for another tick before the first or after the last.
      expect(domain.ticks[0] - domain.step).toBeLessThan(domain.start);
      expect(domain.ticks[domain.ticks.length - 1] + domain.step).toBeGreaterThan(domain.end);
    }
  });

  it("keeps the domain's start and end exactly as they were, so no bar moves", () => {
    for (const [lanes, ends] of [
      [[staying, now, tested], [840, 915]],
      [[{ start: 840, end: 900 }, { start: 845, end: 885 }], [840, 900]],
      [[{ start: 855, end: 960 }], [855, 960]],
      [[{ start: 845, end: 900 }, { start: 1000, end: 1095 }], [840, 1095]],
      [[{ start: 7, end: 8 }], [0, 15]],
    ] as const) {
      const domain = stripDomain(lanes);
      expect([domain.start, domain.end]).toEqual(ends);
    }
  });

  it("does the same for a pair (2 lanes), whatever the order", () => {
    const domain = stripDomain([
      { start: 845, end: 900 },
      { start: 880, end: 950 },
    ]);
    expect([domain.start, domain.end, domain.step]).toEqual([840, 960, 30]);
    expect(domain.ticks).toEqual([840, 870, 900, 930, 960]);
    expect(stripDomain([{ start: 880, end: 950 }, { start: 845, end: 900 }])).toEqual(domain);
  });

  it("ticks every 60 past three hours, on the hour only, with no tick at an end off the hour", () => {
    const domain = stripDomain([
      { start: 845, end: 900 },
      { start: 1000, end: 1095 },
    ]);
    // 14:00 to 18:15: 4h15 -> hourly; 18:15 is off the hour, so the last tick is 18:00.
    expect([domain.start, domain.end, domain.step]).toEqual([840, 1095, 60]);
    expect(domain.ticks).toEqual([840, 900, 960, 1020, 1080]);
    // Exactly three hours stays at 30.
    expect(stripDomain([{ start: 840, end: 1020 }]).step).toBe(30);
    // An empty strip still has a span, and its one tick on the step.
    expect(stripDomain([])).toEqual({ start: 0, end: 15, step: 30, ticks: [0] });
  });
});

describe("PairStrip", () => {
  it("draws the three lane styles: staying solid ink, now an open ink capsule, tested the same dashed", () => {
    const html = render([staying, now, tested]);
    const [a, b, c] = bars(html);
    expect([a.kind, b.kind, c.kind]).toEqual(["staying", "now", "tested"]);
    expect(a.svg).toMatch(/^<svg[^>]*height="12"[^>]*><rect x="0%" y="0" width="[\d.]+%" height="12" rx="6" fill="var\(--foreground\)"><\/rect><\/svg>$/);
    for (const open of [b.svg, c.svg]) {
      expect(open).toMatch(/^<svg[^>]*><rect[^>]*height="12" rx="6" fill="var\(--card\)">/);
      expect(open).toMatch(/<rect[^>]*rx="6" fill="none" stroke="var\(--foreground\)" stroke-width="1.5"/);
    }
    expect(b.svg).not.toContain("stroke-dasharray");
    expect(c.svg).toContain('stroke-dasharray="4 3"');
    // Capsule corners come from SVG rx, never a rounded-full class.
    expect(html).not.toMatch(/rounded-full/);
  });

  it("hatches only the open lanes, over the minutes they share with the staying set, and never the staying bar", () => {
    const html = render([staying, now, tested]);
    const [a, b, c] = bars(html);
    expect(a.svg).not.toMatch(/url\(#|clip-path|var\(--primary\)/);
    const domain = stripDomain([staying, now, tested]);
    const pct = (minute: number) => `${Math.round(stripX(domain, minute) * 1000) / 1000}%`;
    // Now shares 14:00-14:45, tested 14:15-14:45.
    for (const [svg, from] of [
      [b.svg, 840],
      [c.svg, 855],
    ] as const) {
      expect(svg).toMatch(/<g clip-path="url\(#cc-overlap-[^"]+\)">/);
      expect(svg).toContain(`<rect x="${pct(from)}" y="0" width="${pct(885 - from + 840)}" height="12" fill="url(#`);
      // The cuts where shared time starts and ends.
      expect(svg).toContain(`x1="${pct(from)}" x2="${pct(from)}" y1="0" y2="12" stroke="var(--primary)"`);
      expect(svg).toContain(`x1="${pct(885)}" x2="${pct(885)}" y1="0" y2="12" stroke="var(--primary)"`);
    }
    // One hatch definition for the strip: the 16px one from marks.tsx (one 1.5px line every 16px).
    expect(html.match(/<pattern /g)).toHaveLength(1);
    expect(html).toMatch(/<pattern id="cc-overlap-[^"]+" patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate\(45\)"><line [^>]*stroke-width="1.5">/);
    // A lane that shares nothing is not hatched.
    const apart = render([staying, { ...tested, start: 900, end: 960 }]);
    expect(bars(apart)[1].svg).not.toContain("clip-path");
    expect(apart).toContain(">no time shared</p>");
  });

  it("puts a bracket 4px under each open lane that shares time, and the minutes under it in 13px raspberry tabular figures", () => {
    const html = render([staying, now, tested]);
    const brackets = html.match(/<div data-strip-bracket=""><svg width="100%" height="6" aria-hidden="true" focusable="false" class="mt-1 block overflow-visible">[\s\S]*?<\/svg>/g) ?? [];
    expect(brackets).toHaveLength(2);
    for (const bracket of brackets) {
      expect(bracket.match(/<line [^>]*stroke="var\(--primary\)" stroke-width="1" stroke-linecap="round"><\/line>/g)).toHaveLength(3);
    }
    const minutes = [...html.matchAll(/<p data-strip-minutes="" class="([^"]*)"[^>]*>([^<]*)<\/p>/g)];
    expect(minutes.map((m) => m[2])).toEqual(["45 min shared", "30 min shared"]);
    for (const m of minutes) expect(m[1].split(" ")).toEqual(expect.arrayContaining(["font-mono", "text-[0.8125rem]", "text-primary"]));
    // The caller's own minutes win; and a strip can leave the minutes to its own line.
    expect(render([staying, { ...now, minutes: 44 }])).toContain(">44 min shared</p>");
    const quiet = render([staying, now], { minutes: false });
    expect(quiet).toContain("data-strip-bracket");
    expect(quiet).not.toContain("data-strip-minutes");
    // Keep two sets apart words its bracket "N min at the same time", in the same treatment, its box widened
    // to hold the longer line and held inside the bar area.
    const apart = render([staying, now], { wording: "same-time" });
    const line = /<p data-strip-minutes="" class="([^"]*)" style="([^"]*)">([^<]*)<\/p>/.exec(apart);
    expect(line?.[3]).toBe("45 min at the same time");
    expect(line?.[1].split(" ")).toEqual(expect.arrayContaining(["font-mono", "text-[0.8125rem]", "text-primary"]));
    expect(line?.[2]).toContain("width:13rem");
    expect(line?.[2]).toContain("calc(100% - 13rem)");
    expect(render([staying, { ...tested, start: 900, end: 960 }], { wording: "same-time" })).toContain(">0 min at the same time</p>");
    // The hero's line keeps its 8rem box.
    expect(html).toContain("width:8rem");
  });

  it("never puts vermilion on the staying bar, nor any alpha, opacity or provenance colour anywhere", () => {
    const html = render([staying, now, tested]);
    const staysAt = html.indexOf('data-strip-lane="staying"');
    const lane = html.slice(staysAt, html.indexOf('data-strip-lane="now"'));
    expect(lane).not.toMatch(/primary/);
    expect(html).not.toMatch(/opacity|fill-opacity|stroke-opacity|color-mix|\/\[|\b(bg|text|border|fill|stroke)-[a-z-]+\/\d/);
    expect(html).not.toMatch(/prov-qloo/);
  });

  it("draws every lane on one scale, so the same minute sits at the same x in every lane", () => {
    const lanes = [staying, now, tested];
    const html = render(lanes);
    const domain = stripDomain(lanes);
    const xs = bars(html).map((bar) => /<rect x="([\d.]+)%"/.exec(bar.svg)?.[1]);
    expect(xs.map(Number)).toEqual(lanes.map((lane) => Math.round(stripX(domain, lane.start) * 1000) / 1000));
    // The staying set and the moving set both start at 14:00: the same x.
    expect(xs[0]).toBe(xs[1]);
    // One axis for the whole strip: the domain's ticks, in 12px mono over 1px border-strong ticks (a scale's
    // marks), every tick drawn with its label, each a whole step from the next. The 15:15 end is off the step:
    // no tick, no label.
    const labels = [...html.matchAll(/class="absolute top-0 font-mono text-xs leading-4[^"]*"[^>]*>(\d{2}:\d{2})</g)].map((m) => m[1]);
    expect(labels).toEqual(["14:00", "14:30", "15:00"]);
    expect(labels).not.toContain("15:15");
    expect(html).not.toContain("invisible");
    expect(html.match(/stroke="var\(--border-strong\)" stroke-width="1"/g)).toHaveLength(labels.length);
    expect(html).not.toContain('stroke="var(--border)"');
  });

  it("starts a label at the domain's start, ends one at its end, and centres every other on its tick", () => {
    const placed = (html: string) =>
      [...html.matchAll(/<span class="absolute top-0 font-mono text-xs leading-4 whitespace-nowrap text-muted-foreground tabular-nums ?([^"]*)" style="left:([\d.]+)%">(\d{2}:\d{2})</g)].map((m) => [m[3], m[1], m[2]]);
    // 14:00 to 15:15: the start on the step, the end off it, so 15:00 is centred like 14:30.
    expect(placed(render([staying, now, tested]))).toEqual([
      ["14:00", "", "0"],
      ["14:30", "-translate-x-1/2", "40"],
      ["15:00", "-translate-x-1/2", "80"],
    ]);
    // 14:00 to 15:00: both ends on the step.
    expect(placed(render([staying, now]))).toEqual([
      ["14:00", "", "0"],
      ["14:30", "-translate-x-1/2", "50"],
      ["15:00", "-translate-x-full", "100"],
    ]);
    // 14:15 to 16:00: the start off the step, so the first label is centred on 14:30.
    expect(placed(render([{ ...staying, start: 855, end: 960 }]))[0]).toEqual(["14:30", "-translate-x-1/2", "14.286"]);
  });

  it("shares the 9.5rem label column from 640px, wraps names instead of cutting them, and reads the caller's sentence", () => {
    const html = render([staying, now, tested]);
    expect(html.match(/sm:grid sm:grid-cols-\[9\.5rem_minmax\(0,1fr\)\]/g)).toHaveLength(4);
    expect(html).toContain("break-words");
    expect(html).not.toMatch(/truncate|line-clamp|text-ellipsis/);
    // The name in 14px semibold ink from 640px, its meta in 12px muted on a second line.
    expect(html).toMatch(/<p class="[^"]*font-semibold[^"]*text-foreground[^"]*sm:text-sm"><span>Katy J Pearson<\/span><span class="text-xs leading-4 font-normal text-muted-foreground"><span class="sm:hidden"> · <\/span>The Park<\/span><\/p>/);
    // The drawing is hidden; the caller's description is read in its place, and only when given.
    expect(html).toMatch(/^<div data-pair-strip="" class="min-w-0"><p class="sr-only">Read this instead\.<\/p><div aria-hidden="true" class="min-w-0">/);
    expect(render([staying, now], { description: null })).not.toContain("sr-only");
  });

  it("puts every lane on one pitch when asked: three lines from 640px and one line under it, equal rows, the same room under every bar from 640px", () => {
    const ranged = [
      { ...staying, range: "14:00–14:45" },
      { ...now, range: "14:00–15:00" },
      { ...tested, meta: "Tested · Woodsies", range: "14:15–15:15" },
    ];
    const html = render(ranged, { evenPitch: true });
    // From 640px the lanes sit in a grid of equal rows, 8px apart, so a label that wraps grows every block
    // with it. Under 640px (6px apart) the rows follow the lanes: the staying set, which draws no bracket,
    // takes an auto row (its label and its bar), and the bracketed lanes share one height (1fr each).
    expect(html).toContain(
      '<div class="mt-2 grid gap-1.5 max-sm:grid-rows-(--strip-rows) sm:auto-rows-fr sm:gap-2" style="--strip-rows:auto 1fr 1fr">',
    );
    const lanes = [...html.matchAll(/<div data-strip-lane="([a-z]+)" class="([^"]*)">([\s\S]*?)<\/p>/g)];
    expect(lanes.map((m) => m[1])).toEqual(["staying", "now", "tested"]);
    for (const [, kind, cls, label] of lanes) {
      const classes = cls.split(" ");
      // The same room under every bar from 640px, the staying lane's too; under 640px only the lanes with a
      // bracket keep the room for it and its minutes.
      expect(classes).toEqual(expect.arrayContaining(["sm:pb-1.5", "max-sm:flex", "max-sm:flex-col", "max-sm:justify-end", "sm:items-center"]));
      expect(classes.filter((c) => /pb-/.test(c))).toEqual(kind === "staying" ? ["sm:pb-1.5"] : ["pb-6.5", "sm:pb-1.5"]);
      // From 640px three lines (the name in 14px semibold ink, the meta in 12px muted, the range in 12px muted
      // mono); under 640px one line: the name, then " · " and the meta, then " · " and the range, the meta and
      // the range in 13px muted, each kept whole, and each middot held to the item before it.
      const sep = '<span class="text-\\[0\\.8125rem\\] font-normal text-muted-foreground sm:hidden">\u00a0· </span>';
      expect(label).toMatch(
        new RegExp(
          '^<p class="min-w-0 text-sm leading-5 font-semibold break-words text-foreground sm:flex sm:min-h-9 sm:flex-col sm:justify-center sm:pr-3"><span>[^<]+</span>' +
            sep +
            '<span class="text-\\[0\\.8125rem\\] font-normal text-muted-foreground max-sm:whitespace-nowrap sm:text-xs sm:leading-4">[^<]+</span>' +
            sep +
            '<span class="font-mono text-\\[0\\.8125rem\\] font-normal text-muted-foreground tabular-nums max-sm:whitespace-nowrap sm:text-xs sm:leading-4">\\d{2}:\\d{2}–\\d{2}:\\d{2}</span>$',
        ),
      );
      // Nothing gets smaller under 640px: the name 14px, the meta and range 13px.
      expect(label).not.toMatch(/max-sm:text-xs|max-sm:text-\[0\.75rem\]/);
    }
    expect(lanes.map((m) => m[3].replace(/<[^>]+>/g, "|").split("|").filter((part) => part && part !== "\u00a0· "))).toEqual([
      ["Katy J Pearson", "The Park", "14:00–14:45"],
      ["Sprints", "Now · Woodsies", "14:00–15:00"],
      ["Sprints", "Tested · Woodsies", "14:15–15:15"],
    ]);
    // Read as one line, nothing is dropped: name · meta · range.
    expect(lanes.map((m) => m[3].replace(/<[^>]+>/g, "").replace(/\u00a0/g, " "))).toEqual([
      "Katy J Pearson · The Park · 14:00–14:45",
      "Sprints · Now · Woodsies · 14:00–15:00",
      "Sprints · Tested · Woodsies · 14:15–15:15",
    ]);
    // Without it, the strip is as it was: a stack with room only under the open lanes.
    const plain = render([staying, now, tested]);
    expect(plain).toContain('<div class="mt-2 space-y-2">');
    expect(plain).not.toMatch(/auto-rows-fr|max-sm:justify-end/);
    expect(/<div data-strip-lane="staying" class="([^"]*)"/.exec(plain)?.[1]).not.toMatch(/pb-/);
  });

  it("plays only when asked: the hero grows the Now window, flies the tested slot and shrinks its bracket", () => {
    expect(render([staying, now, tested])).not.toMatch(/cc-hero-|cc-overlap-band|cc-edge-grow/);
    const hero = render([staying, now, tested], { motion: { mode: "hero", key: 1 } });
    expect(hero).toMatch(/<g clip-path="url\(#[^"]+-now\)" class="cc-hero-clash" style="animation-name:cc-edge-grow">/);
    expect(hero).toMatch(/class="cc-hero-slot" style="--dx:-20%"/);
    expect(hero).toMatch(/<g class="cc-hero-band" style="--band-from:1.5">/);
    const replay = render([staying, now, tested], { motion: { mode: "replay", key: 2 } });
    expect(replay).not.toMatch(/cc-hero-/);
    expect(replay).toMatch(/<g class="cc-overlap-band" style="--band-from:1.5">/);
  });
});
