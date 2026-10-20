import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as marks from "@/components/clash/marks";
import { bracketWords, stripDomain, stripX } from "@/components/clash/pair-strip";
import { formatClock, runCheck, type CheckReport, type RuleBreak, type RuleId } from "@/lib/check";

import * as local from "./check-break-strip";
import { BreakStrip, breakGeometry, rowsInOrder, type BreakGeometry } from "./check-break-strip";
import { BreakDisc } from "./check-results";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** The check's own report for a grid and its settings. */
function check(grid: string, settings: { changeover?: string; curfew?: string; pairs?: string } = {}): CheckReport {
  const outcome = runCheck({ grid, changeover: settings.changeover ?? "15", curfew: settings.curfew ?? "", pairs: settings.pairs ?? "" });
  if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
  return outcome.report;
}

/** The one break of a rule in a report, and its geometry. */
function only(report: CheckReport, rule: RuleId): { item: RuleBreak; geometry: BreakGeometry } {
  const found = report.breaks.filter((item) => item.rule === rule);
  expect(found).toHaveLength(1);
  const geometry = breakGeometry(found[0], report.sets, report.settings);
  expect(geometry).not.toBeNull();
  return { item: found[0], geometry: geometry! };
}

const draw = (item: RuleBreak, report: CheckReport) =>
  renderToStaticMarkup(createElement(BreakStrip, { item, sets: report.sets, settings: report.settings }));

/** Every number a label prints ("20", "00:15") appears as the same whole number in the finding's own words. */
function expectPrinted(item: RuleBreak, labels: readonly string[]) {
  const said = `${item.text} ${item.detail}`;
  for (const label of labels) {
    expect(label).toMatch(/^(\d+ min shared|\d+ min|\d+ min changeover|\d+ min apart|\d{2}:\d{2})$/);
    for (const token of label.match(/\d{2}:\d{2}|\d+/g) ?? []) {
      expect(said).toMatch(new RegExp(`(^|[^\\d:])${token}(?![\\d:])`));
    }
  }
}

const RULE_1 = check("Orchid Bloom,Grove Stage,16:40,17:20\nOrchid Bloom,Night Tent,16:30,17:00");
const RULE_2 = check("Tidal Fields,Main Stage,18:00,19:00\nJuniper Bloom,Main Stage,18:45,19:30");
const RULE_3 = check("Willow Circuit,Grove Stage,17:55,18:55\nNeon Garden,Grove Stage,19:05,20:05");
const RULE_3_MEET = check("Willow Circuit,Grove Stage,17:55,18:55\nNeon Garden,Grove Stage,18:55,20:05");
const RULE_4 = check("Rustic Harbour,Night Tent,22:20,23:20\nEcho Mirror,Main Stage,20:00,21:00", { curfew: "23:00" });
const RULE_5 = check("Ivory Lights,Night Tent,17:20,18:05\nSaffron Season,Riverside Stage,16:40,17:40", {
  pairs: "Ivory Lights | Saffron Season",
});

describe("breakGeometry: each rule from the check's own sets and settings", () => {
  it("rule 1: both lanes hatched over the shared time, bracketed with the minutes the detail prints", () => {
    const { item, geometry } = only(RULE_1, 1);
    expect(item.detail).toContain("20 minutes shared");
    expect(geometry.lanes.map((lane) => lane.row)).toEqual(rowsInOrder(item.rows));
    expect(geometry.shared).toEqual({ start: 16 * 60 + 40, end: 17 * 60 });
    expect(geometry.cost).toEqual({ start: 16 * 60 + 40, end: 17 * 60, label: "20 min shared" });
    expect(geometry.minimum).toBeNull();
    expect(geometry.curfew).toBeNull();
    expect(geometry.labels).toEqual(["20 min shared"]);
    expectPrinted(item, geometry.labels);
  });

  it("rule 2: the same-stage overlap, with its minutes", () => {
    const { item, geometry } = only(RULE_2, 2);
    expect(geometry.shared).toEqual({ start: 18 * 60 + 45, end: 19 * 60 });
    expect(geometry.labels).toEqual(["15 min shared"]);
    expectPrinted(item, geometry.labels);
  });

  it("rule 3, a gap over 0: the gap bracketed and the changeover from the first set's end, no hatch", () => {
    const { item, geometry } = only(RULE_3, 3);
    expect(item.text).toContain("10 minutes apart");
    expect(item.text).toContain("under the 15-minute changeover");
    expect(geometry.shared).toBeNull();
    expect(geometry.cost).toEqual({ start: 18 * 60 + 55, end: 19 * 60 + 5, label: "10 min apart" });
    expect(geometry.minimum).toEqual({ start: 18 * 60 + 55, end: 19 * 60 + 10, label: "15 min changeover" });
    expect(geometry.labels).toEqual(["15 min changeover", "10 min apart"]);
    expectPrinted(item, geometry.labels);
  });

  it("rule 3, a gap of 0: one tick at the boundary, labelled 0 min apart", () => {
    const { item, geometry } = only(RULE_3_MEET, 3);
    expect(item.text).toContain("0 minutes apart");
    expect(geometry.cost).toEqual({ start: 18 * 60 + 55, end: 18 * 60 + 55, label: "0 min apart" });
    expectPrinted(item, geometry.labels);
    const html = draw(item, RULE_3_MEET);
    const cost = html.match(/<g data-strip-cost="">([\s\S]*?)<\/g>/)?.[1] ?? "";
    expect(cost.match(/<line /g)).toHaveLength(1);
  });

  it("rule 4: one lane, the curfew's clock and an unlabelled bracket past it, with no overrun minutes", () => {
    const { item, geometry } = only(RULE_4, 4);
    expect(geometry.lanes).toHaveLength(1);
    expect(geometry.curfew).toEqual({ minute: 23 * 60, label: "23:00" });
    expect(geometry.cost).toEqual({ start: 23 * 60, end: 23 * 60 + 20, label: null });
    expect(geometry.labels).toEqual(["23:00"]);
    expectPrinted(item, geometry.labels);
    // The finding prints no overrun in minutes, so the strip prints none.
    expect(text(draw(item, RULE_4))).toBe("row 1 23:00");
  });

  it("rule 5: the pair kept apart, its lanes in table order whatever order the rule names them", () => {
    const { item, geometry } = only(RULE_5, 5);
    expect(item.rows).toEqual([1, 2]);
    const reversed = check("Saffron Season,Riverside Stage,16:40,17:40\nIvory Lights,Night Tent,17:20,18:05", {
      pairs: "Ivory Lights | Saffron Season",
    });
    const flipped = only(reversed, 5);
    expect(flipped.item.rows).toEqual([2, 1]);
    expect(flipped.geometry.lanes.map((lane) => lane.row)).toEqual([1, 2]);
    expect(geometry.labels).toEqual(["20 min shared"]);
    expectPrinted(item, geometry.labels);
    expectPrinted(flipped.item, flipped.geometry.labels);
  });

  it("lays a set that ends 00:30 the next day on one axis with no wrap, for a curfew at 23:00 and at 00:15", () => {
    for (const [curfew, minute] of [
      ["23:00", 23 * 60],
      ["00:15", 24 * 60 + 15],
    ] as const) {
      const report = check("Late Act,Night Tent,23:30,00:30\nEarly Act,Main Stage,19:00,20:00", { curfew });
      const { item, geometry } = only(report, 4);
      expect(geometry.lanes[0]).toEqual({ row: 1, start: 23 * 60 + 30, end: 24 * 60 + 30 });
      expect(geometry.curfew).toEqual({ minute, label: curfew });
      expect(geometry.cost.end).toBe(24 * 60 + 30);
      expect(geometry.domain.start).toBeLessThanOrEqual(Math.min(minute, 23 * 60 + 30));
      expect(geometry.domain.end).toBeGreaterThanOrEqual(24 * 60 + 30);
      // On one axis: the bar runs left to right inside the domain, the curfew on it, nothing wrapped to 00:30.
      const at = (m: number) => stripX(geometry.domain, m);
      expect(at(geometry.lanes[0].start)).toBeLessThan(at(geometry.lanes[0].end));
      expect(at(geometry.lanes[0].end)).toBeLessThanOrEqual(100);
      expect(at(minute)).toBeGreaterThanOrEqual(0);
      expect(at(minute)).toBeLessThan(at(geometry.lanes[0].end));
      expectPrinted(item, geometry.labels);
      expect(text(draw(item, report))).toBe(`row 1 ${curfew}`);
    }
  });

  it("uses the pair strip's x domain", () => {
    const { geometry } = only(RULE_1, 1);
    const { start, end } = stripDomain(geometry.lanes);
    expect(geometry.domain).toEqual({ start, end });
  });

  it("returns null, and draws nothing, when a row cannot be found or a printed number would differ", () => {
    const { item } = only(RULE_1, 1);
    expect(breakGeometry({ ...item, rows: [99, 2] }, RULE_1.sets, RULE_1.settings)).toBeNull();
    expect(breakGeometry({ ...item, rows: [] }, RULE_1.sets, RULE_1.settings)).toBeNull();
    expect(breakGeometry({ ...item, detail: item.detail.replace("20 minutes", "25 minutes") }, RULE_1.sets, RULE_1.settings)).toBeNull();
    const gap = only(RULE_3, 3).item;
    expect(breakGeometry(gap, RULE_3.sets, { ...RULE_3.settings, changeover: 20 })).toBeNull();
    const late = only(RULE_4, 4).item;
    expect(breakGeometry(late, RULE_4.sets, { ...RULE_4.settings, curfew: null })).toBeNull();
    expect(breakGeometry(late, RULE_4.sets, { ...RULE_4.settings, curfew: 23 * 60 + 30 })).toBeNull();
    expect(draw({ ...item, rows: [99, 2] }, RULE_1)).toBe("");
  });
});

describe("BreakStrip markup", () => {
  const cases: [RuleId, CheckReport][] = [
    [1, RULE_1],
    [2, RULE_2],
    [3, RULE_3],
    [4, RULE_4],
    [5, RULE_5],
  ];

  it("is hidden from screen readers and print, one SVG, with no control, focus stop or handler", () => {
    for (const [rule, report] of cases) {
      const { item } = only(report, rule);
      const html = draw(item, report);
      expect(html).toMatch(new RegExp(`^<div aria-hidden="true" data-break-strip="${rule}" class="[^"]*print:hidden`));
      expect(html.match(/<svg/g)).toHaveLength(1);
      expect(html).not.toMatch(/<(button|a|input|select|textarea)\b/);
      expect(html).not.toMatch(/tabindex|onclick|role=|href=/i);
      expect(html).not.toContain("rounded-full");
    }
  });

  it("prints the row labels and the finding's own numbers only: no clock ticks, no lane times", () => {
    for (const [rule, report] of cases) {
      const { item, geometry } = only(report, rule);
      const html = draw(item, report);
      const rows = rowsInOrder(item.rows).map((row) => `row ${row}`);
      expect(text(html)).toBe([...rows, ...geometry.labels].join(" "));
      for (const set of report.sets.filter((s) => item.rows.includes(s.row))) {
        for (const minute of [set.start, set.end]) {
          const clock = formatClock(minute);
          if (!geometry.labels.includes(clock)) expect(text(html)).not.toContain(clock);
        }
      }
      expect(html).not.toContain("data-strip-axis");
    }
  });

  it("draws the bars as the hero's now lane: 12px, the 6px mark corner, card fill, 1.5px ink outline", () => {
    const { item } = only(RULE_1, 1);
    const html = draw(item, RULE_1);
    expect(html.match(/<rect [^>]*height="12" rx="6" fill="var\(--card\)"/g)).toHaveLength(2);
    expect(html.match(/<rect [^>]*rx="6" fill="none" stroke="var\(--foreground\)" stroke-width="1.5"/g)).toHaveLength(2);
    // The shared window on both lanes, through the marks' own pattern and clip.
    expect(html.match(/<clipPath /g)).toHaveLength(2);
    expect(html).toContain("<pattern ");
  });

  it("draws no square rect: every rect has its 6px corner or sits inside a bar's rounded clip (round 34)", () => {
    for (const [rule, report] of cases) {
      const html = draw(only(report, rule).item, report);
      // The rects a rounded clip contains: the shared span's fill and hatch, inside each bar's clip group.
      const clipped = [...html.matchAll(/<g clip-path="url\(#[^)]*\)"[^>]*>([\s\S]*?)<\/g>/g)].flatMap((m) => m[1].match(/<rect [^>]*>/g) ?? []);
      // Every clip path is itself a rounded bar.
      for (const clip of html.match(/<clipPath [^>]*>[\s\S]*?<\/clipPath>/g) ?? []) expect(clip).toMatch(/<rect [^>]*rx="6"/);
      for (const rect of html.match(/<rect [^>]*>/g) ?? []) {
        const rx = Number(rect.match(/\brx="([\d.]+)"/)?.[1] ?? 0);
        expect(rx > 0 || clipped.includes(rect), `${rule}: ${rect}`).toBe(true);
      }
    }
  });

  it("brackets shared minutes in raspberry and a gap or a curfew in ink, the changeover in muted and the curfew rule in border-strong (round 34)", () => {
    const cost = (html: string) => html.match(/<g data-strip-cost="">[\s\S]*?<\/g>/)?.[0] ?? "";
    // Rules 1, 2 and 5 are shared minutes: the bracket and its minutes in raspberry, nothing in ink.
    for (const [rule, report] of [
      [1, RULE_1],
      [2, RULE_2],
      [5, RULE_5],
    ] as const) {
      const html = draw(only(report, rule).item, report);
      expect(cost(html), String(rule)).toMatch(/^<g data-strip-cost="">(<line [^>]*stroke="var\(--primary\)"[^>]*><\/line>){3}<\/g>$/);
      expect(html).toMatch(/data-strip-label="cost" class="[^"]*\btext-primary\b[^"]*"/);
      expect(html).not.toMatch(/data-strip-label="cost" class="[^"]*\btext-foreground\b/);
    }
    const three = draw(only(RULE_3, 3).item, RULE_3);
    // The changeover reads as the rule, not scaffolding: its bracket and its label in muted-foreground, no border-strong.
    expect(three).toMatch(/<g data-strip-minimum="">(<line [^>]*stroke="var\(--muted-foreground\)"[^>]*><\/line>){3}<\/g>/);
    expect(`${three.match(/<g data-strip-minimum="">[\s\S]*?<\/g>/)?.[0]} ${three.match(/<span data-strip-label="minimum"[^>]*>/)?.[0]}`).not.toMatch(/border-strong|undefined/);
    // A gap too short is a rule break, not shared time: its bracket and its minutes in ink.
    expect(cost(three)).toMatch(/^<g data-strip-cost="">(<line [^>]*stroke="var\(--foreground\)"[^>]*><\/line>){3}<\/g>$/);
    expect(three).toMatch(/data-strip-label="minimum" class="[^"]*text-muted-foreground[^"]*"/);
    expect(three).toMatch(/data-strip-label="cost" class="[^"]*\btext-foreground\b[^"]*"/);
    // Nothing drawn in raspberry (the hatch pattern is defined in every strip, and used only where time is shared).
    const drawn = (html: string) => html.replace(/<defs>[\s\S]*?<\/defs>/, "");
    expect(drawn(three)).not.toMatch(/var\(--primary\)|text-primary|url\(#/);
    // Sets that meet: the one tick is ink too.
    expect(cost(draw(only(RULE_3_MEET, 3).item, RULE_3_MEET))).toMatch(/^<g data-strip-cost=""><line [^>]*stroke="var\(--foreground\)"[^>]*><\/line><\/g>$/);
    const four = draw(only(RULE_4, 4).item, RULE_4);
    expect(four).toMatch(/<line data-strip-curfew=""[^>]*stroke="var\(--border-strong\)"/);
    expect(four).toMatch(/data-strip-label="curfew" class="[^"]*text-muted-foreground[^"]*"/);
    // Past the curfew: an unlabelled ink bracket, no raspberry anywhere.
    expect(cost(four)).toMatch(/^<g data-strip-cost="">(<line [^>]*stroke="var\(--foreground\)"[^>]*><\/line>){3}<\/g>$/);
    expect(four).not.toContain('data-strip-label="cost"');
    expect(drawn(four)).not.toMatch(/var\(--primary\)|text-primary|url\(#/);
  });
});

describe("a rule break's numbered disc (round 34)", () => {
  it("is ink with its number in paper, never the raspberry of shared time, at both sizes", () => {
    for (const size of [20, 16] as const) {
      const html = renderToStaticMarkup(createElement(BreakDisc, { n: 3, size }));
      expect(html).toMatch(new RegExp(`<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="var\\(--foreground\\)"></circle>`));
      expect(html).toMatch(/<text [^>]*fill="var\(--background\)"[^>]*>3<\/text>/);
      expect(html).not.toMatch(/--primary/);
    }
  });
});

describe("the strip's primitives are the hero's own", () => {
  // The /check route may not import components/clash (check-privacy.test.ts), so the strip holds copies
  // of the PairStrip and marks primitives. Each copy must match its original exactly.
  const spans = [
    [{ start: 600, end: 660 }],
    [{ start: 1000, end: 1040 }, { start: 1020, end: 1080 }],
    [{ start: 1370, end: 1470 }, { start: 1395, end: 1415 }],
    [{ start: 7, end: 8 }],
    [],
  ];

  it("places every minute on the same domain and x as pair-strip", () => {
    for (const lanes of spans) {
      const theirs = stripDomain(lanes);
      const ours = local.stripDomain(lanes);
      expect(ours).toEqual({ start: theirs.start, end: theirs.end });
      for (const minute of [theirs.start, theirs.start + 7, theirs.end - 3, theirs.end]) {
        expect(local.stripX(ours, minute)).toBe(stripX(theirs, minute));
      }
    }
    for (const minutes of [0, 1, 20, 45]) expect(local.bracketWords(minutes)).toBe(bracketWords(minutes, "shared"));
  });

  it("draws the same hatch, window and cuts as marks", () => {
    const render = (lib: typeof marks | typeof local) =>
      renderToStaticMarkup(
        createElement(
          "svg",
          null,
          createElement(lib.OverlapPattern, { id: "p" }),
          createElement(
            lib.OverlapWindow,
            {
              patternId: "p",
              clipId: "p-a",
              bar: { x: "10%", y: 4, width: "60%", height: 12 },
              span: { x: "30%", width: "20%" },
              className: "k",
              style: { opacity: 1 },
            },
            createElement(lib.OverlapEdges, { xs: ["30%", "50%"], bar: { y: 4, height: 12 } }),
          ),
        ),
      );
    expect(render(local)).toBe(render(marks));
    const id = (lib: typeof marks | typeof local) => {
      function Probe() {
        return createElement("i", { id: lib.useOverlapPatternId() });
      }
      return renderToStaticMarkup(createElement(Probe));
    };
    expect(id(local)).toBe(id(marks));
  });
});
