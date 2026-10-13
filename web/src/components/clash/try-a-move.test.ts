import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { topClashes } from "@/lib/clashes";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { mockPreset } from "@/lib/mock-preset";
import { startingSets, type MovesResult, type PlacedOption } from "@/lib/moves";
import { parsePreset, type Preset } from "@/lib/preset";
import { applyMoves, encodeMoves, planStorageKey, type StackMove } from "@/lib/stack";
import { formatClock } from "@/lib/timetable";

import {
  TestedPlace,
  TryAMove,
  placeChanges,
  starterPairsOf,
  stripDomain,
  type CardMove,
  type MoveStripData,
  type PlaceChanges,
} from "./try-a-move";
import { clashParts, clashWords, listedPlace, moveCheck, sharedMinutesByName, splitKept, type MoveCheck } from "./use-moves";

/** The visible words. */
const text = (html: string) =>
  html
    .replace(/<\/dt>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The card's move: Sprints from 14:00 to 14:15 on Woodsies. */
const move: StackMove = { actId: "sprints", stageId: "woodsies", day: 0, start: "14:15" };

const option: PlacedOption = {
  move: "Sprints: Woodsies 14:00-15:00 -> Woodsies 14:15-15:15",
  stage: "Woodsies",
  start: "14:15",
  after: 38.8,
  stageId: "woodsies",
  end: "15:15",
  day: 0,
  clashesAfter: [{ name: "Katy J Pearson", points: 2.1 }],
};

const result: MovesResult = {
  act: "Sprints",
  actId: "sprints",
  from: "Woodsies 14:00-15:00",
  movable: true,
  why: null,
  before: 41.2,
  legalPlaces: 14,
  priced: true,
  clashesNow: [
    { name: "Katy J Pearson", points: 3.4 },
    { name: "Wet Leg", points: 1.2 },
  ],
  options: [option],
};

const card: CardMove = { move, receipt: "Sprints and Katy J Pearson share 30 minutes after this plan." };

function render(check: MoveCheck | null, changes: PlaceChanges = { ends: [{ name: "Wet Leg", points: 1.2 }], adds: [], keeps: [{ name: "Katy J Pearson", now: 3.4, after: 2.1 }] }) {
  return renderToStaticMarkup(
    createElement(TestedPlace, {
      card,
      mover: result.act,
      stage: "Woodsies",
      end: "15:15",
      minutes: { partner: "Katy J Pearson", before: 45, after: 30 },
      strip: null,
      check,
      changes: check?.status === "ready" ? changes : null,
      keepFull: false,
      onKeep: () => {},
      onShowAll: () => {},
    }),
  );
}

describe("the tested place's verdict before Keep this move", () => {
  it("states the index change, the rule status and the clashes it changes, from a listed place", () => {
    const check = moveCheck({ status: "ready", options: result }, move);
    expect(check.status).toBe("ready");
    const html = render(check);
    const words = text(html);
    // (a) the Clash Budget Index before and after, in mono, with the signed change.
    expect(words).toContain("Index 41.2 → 38.8 (−2.4, lower is better)");
    // Both readings are ink: the from-value is not muted, so it never reads as disabled.
    expect(html).toMatch(/<span class="font-mono tabular-nums"><span>41\.2<\/span> →/);
    // (b) and (c) in one 14px line: the rule status, then, after a muted "Listed clashes of {mover}:" (the
    // endpoint's lists stop at three), the clashes it keeps (their minutes unread here), adds and removes,
    // added and removed always. A kept part still prints.
    expect(words).toContain(`Adds no rule break. Listed clashes of ${result.act}: 1 kept, 0 added, 1 removed.`);
    // The prefix is muted; the counts after it are not.
    const prefix = /<span class="text-muted-foreground">(Listed clashes of [^]*?)<\/span>/.exec(html)?.[1] ?? "";
    expect(text(prefix)).toBe(`Listed clashes of ${result.act}:`);
    // The minutes shared lead, in one line of the condensed face, at one weight: no lighter "45".
    expect(words).toContain("45 → 30 min shared with Katy J Pearson");
    expect(html).toMatch(/<p class="type-numeral text-2xl[^"]*">45 → 30 min shared/);
    const heading = /<p class="type-numeral text-2xl[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
    expect(heading).not.toContain("text-muted-foreground");
    expect(heading).not.toContain("font-normal");
    // A result, open on paper as the hero receipt is: one 1px decorative top rule, no corner, no surface edge,
    // no fill and no side padding; no 2px ink rule and no internal rule but the one hairline above the actions.
    expect(html).toMatch(/^<div data-tested-card="true" class="border-t border-border pt-5 sm:pt-6">/);
    const shell = /^<div[^>]*>/.exec(html)?.[0] ?? "";
    expect(shell).not.toMatch(/rounded|surface-edge|bg-card|p-6|px-/);
    expect(html).not.toContain("border-t-2");
    expect(html.match(/border-t(?![\w-])/g)).toHaveLength(2);
    expect(html).toContain('<div aria-hidden="true" data-actions-rule="true" class="mt-6 border-t border-border"></div>');
    // The dateline names the set it tested before its stage and times.
    expect(words).toContain(`${result.act} at Woodsies · 14:15–15:15`);
    // No key and value list any more, and the minutes are said once.
    expect(html).not.toContain("<dl");
    expect(words.match(/30/g)).toHaveLength(1);
    expect(words).not.toContain(card.receipt);
    expect(words).toContain("Keep this move");
  });

  it("says Checking rules… until the answer is in, and never claims the rules before it", () => {
    const html = render(moveCheck({ status: "loading", options: null }, move));
    expect(text(html)).toContain("Checking rules…");
    expect(text(html)).not.toContain("Adds no rule break");
    expect(text(html)).not.toContain("removed");
    // Keep this move stays as it was: enabled while the check runs.
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<svg[^>]*>[\s\S]*?Keep this move/);
  });

  it("does not confirm the rules for a place the list does not hold, or when the list fails", () => {
    const elsewhere = { ...move, start: "16:40" };
    expect(listedPlace(result, elsewhere)).toBeNull();
    const unlisted = moveCheck({ status: "ready", options: result }, elsewhere);
    expect(unlisted.status).toBe("unlisted");
    expect(text(render(unlisted))).toContain("Rules and clashes not checked for this place.");
    const failed = moveCheck({ status: "error", options: null }, move);
    expect(failed.status).toBe("error");
    expect(text(render(failed))).not.toContain("Adds no rule break");
  });

  it("prints the card's own index when the card passed one", () => {
    const html = render(
      { status: "ready", result, option },
      { ends: [], adds: [], keeps: [] },
    );
    expect(text(html)).toContain(`Adds no rule break. Listed clashes of ${result.act}: 0 added, 0 removed.`);
    const withCard = renderToStaticMarkup(
      createElement(TestedPlace, {
        card: { ...card, indexBefore: "41.2", indexAfter: "38.8" },
        mover: result.act,
        stage: "Woodsies",
        end: "15:15",
        minutes: null,
        strip: null,
        check: null,
        changes: null,
        keepFull: false,
        onKeep: () => {},
        onShowAll: () => {},
      }),
    );
    expect(text(withCard)).toContain("Index 41.2 → 38.8");
    expect(text(withCard)).toContain("Checking rules…");
    // With no minutes row the receipt says the minutes instead.
    expect(text(withCard)).toContain(card.receipt);
  });

  it("names the tested set in the dateline, and keeps the stage-first dateline when no mover name is known", () => {
    const named = /<p data-dateline="true"[^>]*>([\s\S]*?)<\/p>/.exec(render(null))?.[1] ?? "";
    expect(text(named)).toBe(`${result.act} at Woodsies · 14:15–15:15`);
    expect(named).toContain(`<span class="font-semibold">${result.act}</span> at Woodsies`);
    expect(named).toContain('<span class="font-mono tabular-nums">14:15–15:15</span>');
    const unnamed = renderToStaticMarkup(
      createElement(TestedPlace, {
        card,
        mover: null,
        stage: "Woodsies",
        end: "15:15",
        minutes: null,
        strip: null,
        check: null,
        changes: null,
        keepFull: false,
        onKeep: () => {},
        onShowAll: () => {},
      }),
    );
    const plain = /<p data-dateline="true"[^>]*>([\s\S]*?)<\/p>/.exec(unnamed)?.[1] ?? "";
    expect(text(plain)).toBe("Woodsies · 14:15–15:15");
    expect(plain).toMatch(/^<span class="font-semibold">Woodsies<\/span> · <span class="font-mono tabular-nums">/);
  });
});

describe("the tested-move card's actions and strip", () => {
  const strip: MoveStripData = {
    now: { start: 840, end: 900 },
    tested: { start: 855, end: 915 },
    partner: { start: 840, end: 885 },
    moverName: "Sprints",
    partnerName: "Katy J Pearson",
    nowStage: "Woodsies",
    testedStage: "Woodsies",
    partnerStage: "Park",
  };
  function withStrip(): string {
    return renderToStaticMarkup(
      createElement(TestedPlace, {
        card,
        mover: strip.moverName,
        stage: "Woodsies",
        end: "15:15",
        minutes: { partner: "Katy J Pearson", before: 45, after: 30 },
        strip,
        check: null,
        changes: null,
        keepFull: false,
        onKeep: () => {},
        onShowAll: () => {},
      }),
    );
  }

  it("keeps 'Keep this move' word for word as the one ink action, with no check icon, and 'Show every legal place' ruled", () => {
    const html = withStrip();
    const keep = html.match(/<button[^>]*>[^]*?<\/button>/g)!.find((button) => button.includes("Keep this move"))!;
    expect(keep).toMatch(/data-variant="default"/);
    expect(keep).not.toContain("<svg");
    expect(keep).not.toContain("lucide-check");
    expect(text(keep)).toBe("Keep this move");
    const all = html.match(/<button[^>]*>[^]*?<\/button>/g)!.find((button) => button.includes("Show every legal place"))!;
    expect(all).toMatch(/data-variant="ruled"/);
  });

  it("draws the hero's pair strip: the staying set solid, and hatches only the open bars, where they share time with it", () => {
    const html = withStrip();
    const strip = /<div data-move-strip="true" class="mt-5 min-w-0">([\s\S]*)$/.exec(html)?.[1] ?? "";
    expect(strip).toMatch(/^<div data-pair-strip="" class="min-w-0"><div aria-hidden="true"/);
    const bars = [...html.matchAll(/<svg data-strip-bar="(staying|now|tested)"[^]*?<\/svg>/g)];
    expect(bars.map((bar) => bar[1])).toEqual(["staying", "now", "tested"]);
    const [solid, open, tested] = bars.map((bar) => bar[0]);
    // The solid ink bar: one fill, never hatched, cut or clipped.
    expect(solid).toContain('fill="var(--foreground)"');
    expect(solid).not.toContain("url(#");
    expect(solid).not.toContain("clip-path");
    expect(solid).not.toContain("var(--primary)");
    // One hatch for the whole strip, the 16 px one from marks.tsx.
    expect(html.match(/<pattern/g)).toHaveLength(1);
    expect(html).toMatch(/<pattern id="cc-overlap-[^"]*" patternUnits="userSpaceOnUse" width="16" height="16"/);
    // Each open bar: its card fill, the window (clipped hatch and cuts), then the 1.5px ink outline last.
    for (const bar of [open, tested]) {
      expect(bar).toMatch(/<g clip-path="url\(#cc-overlap-[^"]*\)">/);
      const fill = bar.indexOf('fill="var(--card)"');
      const window = bar.indexOf("clip-path=");
      const outline = bar.lastIndexOf('stroke="var(--foreground)" stroke-width="1.5"');
      expect(fill).toBeGreaterThan(-1);
      expect(window).toBeGreaterThan(fill);
      expect(outline).toBeGreaterThan(window);
    }
    // Only the tested place is dashed: dashed always means tested.
    expect(open).not.toContain("stroke-dasharray");
    expect(tested).toContain('stroke-dasharray="4 3"');
    // Each open bar's bracket and its minutes, in vermilion mono.
    const minutes = [...html.matchAll(/<p data-strip-minutes=""[^>]*class="([^"]*)"[^>]*>([^<]*)<\/p>/g)];
    expect(minutes.map((m) => m[2])).toEqual(["45 min shared", "30 min shared"]);
    for (const m of minutes) expect(m[1]).toMatch(/font-mono text-\[0\.8125rem\][^"]*text-primary/);
    // No wash, no opacity, no HTML hatch layer.
    expect(html).not.toMatch(/fill-opacity|stroke-opacity|opacity="/);
    // Labels: the act, then its meta muted. The place line above prints the stage and tested time once, so
    // the lanes say only "Now" and "Tested" (and the partner's stage).
    const labels = [...html.matchAll(/<p class="min-w-0 text-\[0\.8125rem\][^"]*"><span>([^<]*)<\/span><span class="text-xs leading-4 font-normal text-muted-foreground"><span class="sm:hidden"> · <\/span>([^<]*)<\/span><\/p>/g)].map((m) => `${m[1]} · ${m[2]}`);
    expect(labels).toEqual(["Katy J Pearson · Park", "Sprints · Now", "Sprints · Tested"]);
    expect(text(html).match(/14:15–15:15/g)).toHaveLength(1);
    expect(text(html).match(/Woodsies/g)).toHaveLength(1);
  });
});

describe("Try a move's picker", () => {
  it("puts the 'Or choose any set' select in the left column under 'Start with', and the tested-move card alone on the right", () => {
    const preset = parsePreset(rawTinyPreset());
    const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
    const html = renderToStaticMarkup(createElement(TryAMove, { preset, day: 0, ranked, isLocked: () => false }));
    const picker = html.match(/<div data-move-picker="true" class="([^"]*)">([^]*?)<\/select>/)!;
    expect(picker[1]).toContain("lg:col-span-5 lg:col-start-1 lg:row-start-2");
    const inside = picker[2];
    if (inside.includes("Start with")) {
      expect(inside.indexOf("Start with")).toBeLessThan(inside.indexOf("Or choose any set"));
      expect(inside.indexOf("Or choose any set")).toBeLessThan(inside.indexOf("<select"));
      // "Start with" is a list of choices open on paper, as the tested result beside it is: one 1px decorative
      // top rule with the result label's top padding, the label under it, then the rows. No box: no corner, no
      // surface edge, no fill, no clipping.
      expect(inside).toMatch(
        /^[^]*?<div data-start-block="true" class="border-t border-border pt-5 sm:pt-6"><p id="[^"]+" class="text-\[0\.8125rem\] leading-5 font-semibold text-muted-foreground">Start with<\/p><ul aria-labelledby="[^"]+" data-start-ledger="true" class="mt-1">/,
      );
      const ledger = /<ul aria-labelledby="[^"]+" data-start-ledger="true"[^>]*>[\s\S]*?<\/ul>/.exec(inside)?.[0] ?? "";
      expect(ledger).not.toMatch(/rounded-lg|surface-edge|bg-card|overflow-hidden|border-border-strong/);
      // Its rows: full-width 56px buttons. The shown row is marked inside itself: an inset, pointer-free 1.5px
      // ink outline (an overlay, so no row changes size), the check glyph in its reserved 16px slot and its start
      // in ink, with no wash. The others keep the slot empty and the start muted, and take the wash on hover only.
      const rows = inside.match(/<button type="button" data-start-row="true"[^>]*>[\s\S]*?<\/button>/g) ?? [];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((row) => row.includes("data-start-minutes"))).toBe(true);
      expect(rows.filter((row) => row.includes("lucide-check"))).toHaveLength(1);
      expect(rows.filter((row) => row.includes("data-start-cue"))).toHaveLength(1);
      for (const row of rows) {
        const open = /^<button[^>]*>/.exec(row)?.[0] ?? "";
        const classes = (/class="([^"]*)"/.exec(open)?.[1] ?? "").split(" ");
        expect(classes).toEqual(expect.arrayContaining(["relative", "min-h-14", "w-full", "rounded-md", "px-4", "py-3"]));
        // The button itself has no edge and no ring: only the overlay marks the shown row.
        expect(classes.filter((name) => /^(border|ring)(-|$)/.test(name))).toEqual([]);
        expect(classes).not.toContain("bg-accent");
        // Keyboard focus is the cobalt outline drawn 2px OUTSIDE the row, so on the shown row it sits apart from
        // the ink outline inside it: told apart by place, not only by colour.
        expect(classes).toEqual(
          expect.arrayContaining(["focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-ring"]),
        );
        expect(classes.some((name) => name.includes("-outline-offset"))).toBe(false);
        const slot = /<span data-start-check="true" class="flex h-5 items-center pt-px">([\s\S]*?)<\/span>/.exec(row);
        expect(slot).not.toBeNull();
        const time = /<span data-start-time="true" class="([^"]*)"/.exec(row)?.[1] ?? "";
        if (row.includes("lucide-check")) {
          expect(row).toContain(
            '<span aria-hidden="true" data-start-cue="true" class="pointer-events-none absolute inset-0 rounded-md border-[1.5px] border-foreground"></span>',
          );
          expect(classes).not.toContain("hover:bg-accent");
          expect(slot![1]).toMatch(/lucide-check size-4 text-foreground/);
          expect(time).toContain("text-foreground");
          expect(open).toContain('aria-pressed="');
        } else {
          expect(row).not.toContain("data-start-cue");
          expect(classes).toContain("hover:bg-accent");
          expect(slot![1]).toBe("");
          expect(time).toContain("text-muted-foreground");
        }
        // No left stripe and no wash as the cue.
        expect(row).not.toMatch(/border-l|before:/);
        // One rhythm: the act, then its stage and end, then (with a pair) the minutes and partner on a third
        // block-level line of their own, never an inline piece after a middot.
        expect(row).toMatch(/<span data-start-name="true" class="block text-\[0\.9375rem\] leading-snug font-semibold break-words">/);
        const meta = /<span data-start-meta="true" class="[^"]*">((?:[^<]|<span[^>]*>[^<]*<\/span>)*)<\/span>/.exec(row);
        if (meta) expect(text(meta[1])).not.toMatch(/ min|with/);
        // No inline swatch: the minutes carry shared time, in 13px mono vermilion, then the set they are
        // shared with, by name; the list never says "min shared".
        expect(row).not.toContain('viewBox="0 0 40 12"');
        expect(row).not.toContain("<pattern");
        expect(row).not.toContain("min shared");
        if (row.includes("data-start-minutes")) {
          expect(row).toMatch(
            /<span data-start-pair="true" class="mt-0\.5 block text-\[0\.8125rem\] leading-5 break-words text-muted-foreground"><span data-start-minutes="true" class="font-mono whitespace-nowrap text-primary tabular-nums">\d+ min<\/span> with <span data-start-partner="true" class="text-foreground">[^<]+<\/span><\/span>/,
          );
          expect(row).not.toContain("inline-block");
          expect(row.indexOf("data-start-pair")).toBeGreaterThan(row.indexOf("data-start-meta"));
        }
      }
      // Each row is closed by a 1px hairline, the last too, with 4px above and below its button; the hairlines
      // either side of the shown row go transparent (keeping their pixel), so its ink outline stands alone.
      const rules = [...ledger.matchAll(/<li data-start-rule="true" class="border-b py-1 (border-[a-z]+)">/g)].map((m) => m[1]);
      expect(rules).toHaveLength(rows.length);
      const shownAt = rows.findIndex((row) => row.includes("lucide-check"));
      // Rule i sits under row i.
      rules.forEach((rule, i) => {
        expect(rule).toBe(i === shownAt || i + 1 === shownAt ? "border-transparent" : "border-border");
      });
    } else {
      expect(inside).toContain("Set to move");
    }
    // The select: 48px, 12px corner, card, a 1px border-strong edge, 16px padding, one 12px chevron; the one boxed
    // field here, the column's full width at every size, so its right edge is the Start-with list's.
    expect(inside).toMatch(/class="relative mt-1\.5 flex h-12 min-w-0 items-center rounded-md border border-border-strong bg-card pr-10 pl-4/);
    expect(inside).toMatch(/<div data-move-select="true"><div class="relative mt-1\.5 flex h-12/);
    expect(inside).not.toMatch(/data-move-select="true" class="[^"]*max-w-/);
    expect(html.slice(html.indexOf("data-move-picker"))).toMatch(/lucide-chevron-down[^"]*size-3/);
    // No section hairline, no alpha colour, no wash.
    expect(html).toMatch(/^<section id="try-a-move" aria-labelledby="try-a-move-heading"><div class="container-page grid gap-x-12 py-16/);
    expect(html).not.toMatch(/(bg|border|text)-(foreground|background|muted|destructive|muted-foreground|border-strong)\/\d/);
    expect(html).not.toContain("bg-danger-bg");
    expect(html).not.toContain("border-dashed");
    expect(html).not.toContain("fill-opacity");
  });

  it("from lg, starts the tested result in the picker's row, so the selection and its result share one band", () => {
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    const card = /<div data-move-card className="([^"]*)">/.exec(source)?.[1] ?? "";
    // Grid placement only: the second row, the right seven columns, no row span, the picker's own 32px top.
    expect(card.split(" ")).toEqual(expect.arrayContaining(["mt-8", "lg:col-span-7", "lg:col-start-6", "lg:row-start-2"]));
    expect(card).not.toMatch(/row-span|row-start-1|lg:mt-/);
    const picker = /<div data-move-picker className="([^"]*)">/.exec(source)?.[1] ?? "";
    expect(picker.split(" ")).toEqual(expect.arrayContaining(["mt-8", "lg:row-start-2"]));
    expect(picker).not.toMatch(/lg:mt-/);
    // The source (and Tab) order is unchanged: heading, ledger, select, then the result.
    expect(source.indexOf('id="try-a-move-heading"')).toBeLessThan(source.indexOf("data-move-picker className"));
    expect(source.indexOf("data-move-picker className")).toBeLessThan(source.indexOf("data-move-card className"));
  });

  it("opens 'Where X could go' onto paper: one top rule, no card, the page's 5/7 split", () => {
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    // A list of choices and its result: one 1px decorative top rule, no corner, surface edge, fill or padding.
    expect(source).toContain('<div data-moves-card className="border-t border-border pt-5">');
    const body = source.slice(source.indexOf("data-moves-card"), source.indexOf("/** The decision card's move"));
    expect(body).not.toMatch(/rounded-lg|border-surface-edge/);
    // The places and the priced detail sit on the page's own columns and gutter.
    expect(body).toContain('<div className="mt-5 grid gap-6 lg:grid-cols-12 lg:gap-x-12">');
    expect(body).toContain('<div className="min-w-0 lg:col-span-5">');
    expect(body).toContain('className="min-w-0 lg:col-span-7"');
  });
});

describe("the clashes line tells a shorter clash from an unchanged one", () => {
  const changes = {
    ends: [] as { name: string; points: number }[],
    adds: [] as { name: string; points: number }[],
    keeps: [
      { name: "Katy J Pearson", now: 3.4, after: 2.1 },
      { name: "Wet Leg", now: 1.2, after: 1.2 },
      { name: "Fontaines D.C.", now: 0.8, after: 0.8 },
    ],
  };
  const shared = new Map([
    ["Katy J Pearson", { before: 45, after: 30 }],
    ["Wet Leg", { before: 20, after: 20 }],
    ["Fontaines D.C.", { before: 15, after: 15 }],
  ]);

  it("counts shorter, longer and unchanged from the shared minutes before and after", () => {
    const split = splitKept(changes.keeps, shared);
    expect(split.shorter.map((item) => item.name)).toEqual(["Katy J Pearson"]);
    expect(split.unchanged).toHaveLength(2);
    expect(split.longer).toHaveLength(0);
    expect(split.unknown).toHaveLength(0);
    expect(clashWords(clashParts(changes, shared))).toBe("1 shortened (45 → 30 min), 2 unchanged, 0 added, 0 removed");
  });

  it("always shows added and removed, and shorter, longer and unchanged only above 0", () => {
    const longer = new Map([...shared, ["Wet Leg", { before: 20, after: 35 }]]);
    const parts = clashParts(
      { ...changes, ends: [{ name: "Wet Leg 2", points: 1 }], adds: [{ name: "New", points: 1 }] },
      longer,
    );
    expect(clashWords(parts)).toBe("1 shortened (45 → 30 min), 1 lengthened (20 → 35 min), 1 unchanged, 1 added, 1 removed");
    expect(clashWords(clashParts({ ends: [], adds: [], keeps: [] }, null))).toBe("0 added, 0 removed");
    // Two shortened clashes are counted without a single pair of minutes.
    const two = new Map([...shared, ["Wet Leg", { before: 20, after: 10 }]]);
    expect(clashWords(clashParts(changes, two))).toBe("2 shortened, 1 unchanged, 0 added, 0 removed");
  });

  it("reads the minutes from the timetable in memory, by the partner's name", () => {
    const acts = [
      { id: "sprints", name: "Sprints" },
      { id: "katy", name: "Katy J Pearson" },
    ];
    const timetable = [
      { act_id: "sprints", day: 0, stage_id: "woodsies", start: 840, end: 900, locked: false },
      { act_id: "katy", day: 0, stage_id: "park", start: 855, end: 945, locked: false },
    ];
    const minutes = sharedMinutesByName(
      acts,
      timetable,
      "sprints",
      { day: 0, start: 840, end: 900 },
      { day: 0, start: 825, end: 885 },
      ["Katy J Pearson", "Not on the day"],
    );
    expect(minutes.get("Katy J Pearson")).toEqual({ before: 45, after: 30 });
    expect(minutes.has("Not on the day")).toBe(false);
  });

  it("prints the row on the tested place in that order", () => {
    const html = render({ status: "ready", result, option }, { ...changes, shared });
    expect(text(html)).toContain(
      `Adds no rule break. Listed clashes of ${result.act}: ${clashWords(clashParts(changes, shared))}.`,
    );
    expect(text(html)).toContain("Listed clashes of Sprints: 1 shortened (45 → 30 min), 2 unchanged, 0 added, 0 removed.");
  });

  it("still prints a lengthened part after the listed prefix, in clashParts' order", () => {
    const longer = new Map([...shared, ["Wet Leg", { before: 20, after: 35 }]]);
    const html = render({ status: "ready", result, option }, { ...changes, shared: longer });
    const counts = clashWords(clashParts(changes, longer));
    expect(counts).toContain("1 lengthened (20 → 35 min)");
    expect(text(html)).toContain(`Adds no rule break. Listed clashes of ${result.act}: ${counts}.`);
  });
});

describe("the time domain every pair strip shares", () => {
  it("floors the earliest start and ceils the latest end to 15 minutes, with a tick every 30 and both ends", () => {
    // 14:05-15:00 and 14:40-15:50 -> 14:00 to 16:00.
    const domain = stripDomain([
      { start: 845, end: 900 },
      { start: 880, end: 950 },
    ]);
    expect([domain.start, domain.end, domain.step]).toEqual([840, 960, 30]);
    expect(domain.ticks).toEqual([840, 870, 900, 930, 960]);
  });

  it("gives the same lanes the same domain, in any order", () => {
    const a = { start: 845, end: 900 };
    const b = { start: 880, end: 950 };
    expect(stripDomain([a, b])).toEqual(stripDomain([b, a]));
  });
});

describe("Start with names the partner of every row, from the one map the card reads too", () => {
  /** A published day from the backend's built presets, when this checkout has them (they are not committed). */
  function published(file: string): Preset | null {
    const path = join(process.cwd(), "..", "backend", "presets", file);
    return existsSync(path) ? parsePreset(JSON.parse(readFileSync(path, "utf8"))) : null;
  }
  const glastonbury = published("glastonbury-2025-sun.json");
  const riot = published("riot-fest-2026-sun.json");
  const fixtures: [string, Preset | null][] = [
    ["Glastonbury 2025, Sunday", glastonbury],
    ["Riot Fest 2026, Sunday", riot],
    ["the invented day", { ...mockPreset(), synthetic: true }],
    ["the tiny fixture", parsePreset(rawTinyPreset())],
  ];

  type Row = { actId: string; minutes: number | null; partner: string | null };

  const unescape = (value: string) => value.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

  /** The rows "Start with" draws, in order: the figure and the name beside it, when there is one. */
  function rowsOf(html: string, starters: readonly { actId: string; name: string }[]): Row[] {
    const rows = html.match(/<button type="button" data-start-row="true"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(rows).toHaveLength(starters.length);
    return rows.map((row, i) => {
      const minutes = /<span data-start-minutes="true"[^>]*>(\d+) min<\/span>/.exec(row);
      const partner = /<span data-start-partner="true"[^>]*>([^<]+)<\/span>/.exec(row);
      // Never a figure without a name, nor a name without its figure.
      expect(Boolean(minutes), `row ${i}`).toBe(Boolean(partner));
      return {
        actId: starters[i].actId,
        minutes: minutes ? Number(minutes[1]) : null,
        partner: partner ? unescape(partner[1]) : null,
      };
    });
  }

  /** The card's minutes line: "45 → 30 min shared with Katy J Pearson", or null when it prints none. */
  function cardLine(html: string): { before: number; partner: string | null } | null {
    const heading = /<p class="type-numeral text-2xl[^"]*">([\s\S]*?)<\/p>/.exec(html)?.[1];
    if (!heading) return null;
    const words = unescape(text(heading));
    const match = /^(\d+) → \d+ min shared(?: with (.+))?$/.exec(words);
    expect(match, words).not.toBeNull();
    return { before: Number(match![1]), partner: match![2] ?? null };
  }

  /** The card's move for a set: 15 minutes later on its own stage, with a receipt naming its costliest partner. */
  function cardFor(preset: Preset, ranked: ReturnType<typeof topClashes>, actId: string): CardMove | null {
    const slot = preset.festival.timetable.find((item) => item.act_id === actId);
    const clash = ranked.find((item) => item.a.act_id === actId || item.b.act_id === actId);
    if (!slot || !clash) return null;
    const self = clash.a.act_id === actId ? clash.a : clash.b;
    const other = clash.a.act_id === actId ? clash.b : clash.a;
    return {
      move: { actId, stageId: slot.stage_id, day: slot.day, start: formatClock(slot.start + 15) },
      receipt: `${self.name} and ${other.name} share less time after this plan.`,
    };
  }

  function check(preset: Preset, kept: readonly StackMove[]) {
    const day = preset.festival.timetable[0]?.day ?? 0;
    const ranked = topClashes(preset.report.clashes, day, Number.POSITIVE_INFINITY);
    const moved = new Set(kept.map((move) => move.actId));
    const starters = startingSets(ranked, () => false).filter((set) => !moved.has(set.actId));
    expect(starters.length).toBeGreaterThan(0);
    const timetable = applyMoves(preset.festival.timetable, kept);
    let named = 0;
    for (const shown of starters) {
      const cardMove = cardFor(preset, ranked, shown.actId);
      const html = renderToStaticMarkup(createElement(TryAMove, { preset, day, ranked, isLocked: () => false, cardMove }));
      const pairs = starterPairsOf({
        actIds: [...starters.map((set) => set.actId), ...(cardMove ? [cardMove.move.actId] : [])],
        timetable,
        acts: preset.festival.acts,
        clashes: ranked.map((clash) => ({ aId: clash.a.act_id, bId: clash.b.act_id })),
        seed: null,
      });
      for (const row of rowsOf(html, starters)) {
        const pair = pairs.get(row.actId);
        if (pair && pair.minutes > 0) {
          expect(row.partner).toBe(pair.partnerName);
          expect(row.minutes).toBe(pair.minutes);
        } else {
          expect(row.minutes).toBeNull();
        }
      }
      // Wherever the card names a partner for the set it shows, it is the row's partner.
      const line = cardLine(html);
      if (line?.partner) {
        named += 1;
        expect(line.partner).toBe(pairs.get(shown.actId)?.partnerName);
        if (kept.length === 0) expect(line.before).toBe(pairs.get(shown.actId)?.minutes);
      }
    }
    return named;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.skipIf(glastonbury === null)(
    "on the Glastonbury Sunday default, the Sprints row and the card both say 45 minutes with Katy J Pearson",
    () => {
      const preset = glastonbury!;
      const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
      const sprints = preset.festival.acts.find((act) => act.name === "Sprints")!;
      const cardMove = cardFor(preset, ranked, sprints.id)!;
      expect(cardMove.receipt).toContain("Katy J Pearson");
      const html = renderToStaticMarkup(createElement(TryAMove, { preset, day: 0, ranked, isLocked: () => false, cardMove }));
      const starters = startingSets(ranked, () => false);
      const row = rowsOf(html, starters).find((item) => item.actId === sprints.id);
      expect(row).toEqual({ actId: sprints.id, minutes: 45, partner: "Katy J Pearson" });
      // The same facts in two lines: "Woodsies · to 15:00", then "45 min with Katy J Pearson" on its own line.
      const slot = preset.festival.timetable.find((item) => item.act_id === sprints.id)!;
      const stage = preset.festival.stages.find((item) => item.id === slot.stage_id)!.name;
      const rowHtml = (html.match(/<button type="button" data-start-row="true"[^>]*>[\s\S]*?<\/button>/g) ?? []).find((item) =>
        item.includes(`>${sprints.name}</span>`),
      )!;
      const meta = /<span data-start-meta="true" class="[^"]*">((?:[^<]|<span[^>]*>[^<]*<\/span>)*)<\/span>/.exec(rowHtml)?.[1] ?? "";
      expect(text(meta)).toBe(`${stage} · to ${formatClock(slot.end)}`);
      const pair = /<span data-start-pair="true" class="[^"]*">([\s\S]*?<\/span>[^<]*<span[^>]*>[^<]*<\/span>)<\/span>/.exec(rowHtml)?.[1] ?? "";
      expect(text(pair)).toBe(`${row!.minutes} min with ${row!.partner}`);
      expect(text(html)).toContain(`${stage} · to ${formatClock(slot.end)} ${row!.minutes} min with ${row!.partner}`);
      expect(cardLine(html)).toEqual({ before: 45, partner: "Katy J Pearson" });
    },
  );

  it.skipIf(glastonbury === null)(
    "on the Glastonbury Sunday default, the counts line reads 'Listed clashes of Sprints:' then clashWords' counts",
    () => {
      const preset = glastonbury!;
      const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
      const sprints = preset.festival.acts.find((act) => act.name === "Sprints")!;
      const cardMove = cardFor(preset, ranked, sprints.id)!;
      // The endpoint's answer for the card's place, from the fixture: the set's clashes, at most three,
      // largest first, before and at the tested place (the same partners, still on the list).
      const listed = ranked
        .filter((clash) => clash.a.act_id === sprints.id || clash.b.act_id === sprints.id)
        .slice(0, 3)
        .map((clash) => ({ name: clash.a.act_id === sprints.id ? clash.b.name : clash.a.name, points: Math.round(clash.regret * 10) / 10 }));
      expect(listed.length).toBeGreaterThan(0);
      const stage = preset.festival.stages.find((item) => item.id === cardMove.move.stageId)!.name;
      const slot = preset.festival.timetable.find((item) => item.act_id === sprints.id)!;
      const start = Number(cardMove.move.start.slice(0, 2)) * 60 + Number(cardMove.move.start.slice(3));
      const end = formatClock(start + (slot.end - slot.start));
      const place: PlacedOption = {
        move: `${sprints.name}: moved`,
        stage,
        start: cardMove.move.start,
        after: 0,
        stageId: cardMove.move.stageId,
        end,
        day: 0,
        clashesAfter: listed,
      };
      const answer: MovesResult = { ...result, act: sprints.name, actId: sprints.id, clashesNow: listed, options: [place] };
      const changes = placeChanges(preset.festival, preset.festival.timetable, answer, place);
      const counts = clashWords(clashParts(changes, changes.shared));
      const html = renderToStaticMarkup(
        createElement(TestedPlace, {
          card: cardMove,
          mover: sprints.name,
          stage,
          end,
          minutes: null,
          strip: null,
          check: { status: "ready", result: answer, option: place },
          changes,
          keepFull: false,
          onKeep: () => {},
          onShowAll: () => {},
        }),
      );
      expect(text(html)).toContain(`Adds no rule break. Listed clashes of Sprints: ${counts}.`);
    },
  );

  for (const [name, preset] of fixtures) {
    it.skipIf(preset === null)(`on ${name}, every starting row's partner and minutes come from starterPairsOf, and the card agrees`, () => {
      expect(check(preset!, [])).toBeGreaterThan(0);
    });

    it.skipIf(preset === null)(`on ${name}, after one kept move, the rows read the plan's timetable and still agree with the card`, () => {
      const day = preset!.festival.timetable[0]?.day ?? 0;
      const ranked = topClashes(preset!.report.clashes, day, Number.POSITIVE_INFINITY);
      // Keep a move of the costliest clash's second set: an hour later on its own stage.
      const set = ranked[0].b.act_id;
      const slot = preset!.festival.timetable.find((item) => item.act_id === set)!;
      const kept: StackMove[] = [{ actId: set, stageId: slot.stage_id, day: slot.day, start: formatClock(slot.start + 60) }];
      const store = new Map([[planStorageKey(preset!.id), encodeMoves(kept)]]);
      vi.stubGlobal("window", {
        sessionStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: () => {},
          removeItem: () => {},
        },
      });
      check(preset!, kept);
    });
  }

  it("prefers the card's own pair, then the costliest clash that still shares time, then the longest overlap", () => {
    const acts = ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase() }));
    const slot = (act_id: string, start: number, end: number) => ({ act_id, day: 0, stage_id: act_id, start, end, locked: false });
    const timetable = [slot("a", 600, 660), slot("b", 630, 690), slot("c", 600, 700), slot("d", 800, 860)];
    const clashes = [
      { aId: "a", bId: "b" },
      { aId: "a", bId: "c" },
    ];
    const pairs = starterPairsOf({ actIds: ["a", "b", "c", "d"], timetable, acts, clashes, seed: { actId: "c", partnerId: "b" } });
    // A's costliest clash is with B (30 minutes), though it shares more with C.
    expect(pairs.get("a")).toEqual({ partnerId: "b", partnerName: "B", minutes: 30 });
    // C carries the card's pair, B.
    expect(pairs.get("c")).toEqual({ partnerId: "b", partnerName: "B", minutes: 60 });
    // B is in A's clash first.
    expect(pairs.get("b")).toEqual({ partnerId: "a", partnerName: "A", minutes: 30 });
    // D shares no time with any set: no entry, so its row prints no figure.
    expect(pairs.has("d")).toBe(false);
    // A clash that no longer shares time on the list's timetable gives way to the longest overlap.
    const moved = timetable.map((item) => (item.act_id === "b" ? { ...item, start: 900, end: 960 } : item));
    expect(starterPairsOf({ actIds: ["a"], timetable: moved, acts, clashes: [{ aId: "a", bId: "b" }], seed: null }).get("a")).toEqual({
      partnerId: "c",
      partnerName: "C",
      minutes: 60,
    });
  });
});
