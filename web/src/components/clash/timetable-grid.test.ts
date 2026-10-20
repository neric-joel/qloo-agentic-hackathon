import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildSetViews, topClashes } from "@/lib/clashes";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";
import type { PlanPreview } from "@/lib/stack";

import * as grid from "./timetable-grid";
import { cardRows, isLongName, shortCueCount, TimetableGrid, WEAK_CUE_WORD } from "./timetable-grid";
import { legendSymbolCount, TimetableLegend } from "./timetable-legend";

// Every name and figure below is invented for the test, apart from one act name borrowed for its
// length; none of it is Qloo data.

const LONG = "Abel Selaocoe & the Bantu Ensemble";

/** The tiny preset with Ann renamed to a long name and her set cut to `minutes`, and Cy's to `cyMinutes`. */
function boardPreset(minutes: number, cyMinutes = 60, synthetic = false, weak: string[] = []) {
  const raw = rawTinyPreset() as {
    festival: { acts: { id: string; name: string }[]; timetable: { act_id: string; start: unknown; end: unknown }[] };
    report: { coverage: { weak: number; weak_act_ids: string[] } };
  } & Record<string, unknown>;
  raw.report.coverage.weak_act_ids = weak;
  raw.report.coverage.weak = weak.length;
  raw.festival.acts = raw.festival.acts.map((act) => (act.id === "ann" ? { ...act, name: LONG } : act));
  raw.festival.timetable = raw.festival.timetable.map((slot) =>
    slot.act_id === "ann"
      ? { ...slot, start: 1200, end: 1200 + minutes }
      : slot.act_id === "cy"
        ? { ...slot, start: 1000, end: 1000 + cyMinutes }
        : slot,
  );
  const preset = parsePreset({ ...raw, synthetic });
  return { preset, views: buildSetViews(preset, 0) };
}

function board(minutes: number, cyMinutes = 60, synthetic = false, weak: string[] = [], plan: PlanPreview | null = null): string {
  const { preset, views } = boardPreset(minutes, cyMinutes, synthetic, weak);
  const noop = () => {};
  return renderToStaticMarkup(
    createElement(TimetableGrid, {
      views,
      stages: preset.festival.stages,
      links: topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY),
      dayLabel: "Sat",
      activeSetIds: new Set<string>(),
      activeClashKeys: new Set<string>(),
      dimmed: false,
      focusSetId: null,
      onHighlightSet: noop,
      onHighlightClash: noop,
      onOpen: noop,
      plan,
      synthetic,
    }),
  );
}

/** Column widths for a board whose every stage column is `width` px wide. */
const columns = (width: number) => Array.from({ length: 8 }, () => width);

/** One tile's button, with its opening tag and its inner markup. */
function tile(html: string, id: string): { open: string; inner: string } {
  const match = new RegExp(`(<button(?=[^>]*data-set="${id}")[^>]*>)([\\s\\S]*?)</button>`).exec(html);
  expect(match, `tile ${id}`).not.toBeNull();
  return { open: match?.[1] ?? "", inner: match?.[2] ?? "" };
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** What a sighted reader sees of a tile: its text without the screen-reader-only parts. */
function visible(markup: string): string {
  return text(markup.replace(/<span class="sr-only">(?:[^<]|<!-- -->)*<\/span>/g, ""));
}

const decode = (value: string) => value.replace(/&amp;/g, "&");

describe("a long name on a tile is never cut silently", () => {
  it("sets a name over 22 characters at 13px", () => {
    expect(isLongName(LONG)).toBe(true);
    expect(isLongName("Celeste")).toBe(false);
    const { inner } = tile(board(90), "ann");
    expect(inner).toMatch(/data-set-name="ann" class="[^"]*text-\[0\.8125rem\] leading-tight/);
    // A shorter name is 14px semibold, leading-tight.
    expect(tile(board(90), "bo").inner).toMatch(/data-set-name="bo" class="[^"]*font-semibold[^"]*text-sm leading-tight/);
  });

  it("keeps the full name in the tile's accessible name, title and tooltip in a short slot, never clamped", () => {
    const html = board(15);
    const { open, inner } = tile(html, "ann");
    // The accessible name is the button's text, sr-only parts included: the whole name is there.
    expect(text(inner)).toContain(LONG);
    // The title names it in full too.
    expect(decode(/title="([^"]*)"/.exec(open)?.[1] ?? "")).toContain(LONG);
    // The visible name is never clamped, ellipsised or height-cut.
    const name = /<span data-set-name="ann" class="([^"]*)"([^>]*)>/.exec(inner);
    expect(name?.[1]).not.toMatch(/line-clamp|truncate|text-ellipsis|overflow-hidden/);
    expect(name?.[2] ?? "").not.toContain("max-height");
    // ...and a hover and focus tooltip prints it whole.
    expect(html).toMatch(new RegExp(`data-name-tooltip=""[^>]*>${LONG.replace("&", "&amp;")}</span>`));
  });

  it("renders the name whole when the slot is tall enough, with no tooltip and no clamp anywhere on the board", () => {
    const html = board(90);
    expect(html).not.toContain("data-name-tooltip");
    expect(html).not.toMatch(/line-clamp|\btruncate\b|text-ellipsis/);
  });

  it("sets a name the measured board wraps on a 1.2 line, and keeps leading-tight before the board is measured", () => {
    const { views } = boardPreset(90);
    const ann = views.find((view) => view.id === "ann");
    const bo = views.find((view) => view.id === "bo");
    expect(ann && bo).toBeTruthy();
    if (!ann || !bo) return;
    const y = (minute: number) => minute * 2.1;
    // Measured, in a 140px column: the long name wraps, so it takes the 1.2 line; a one-line name does not.
    expect(grid.tileLayout(ann, y, 140).wraps).toBe(true);
    expect(grid.tileLayout(bo, y, 400).wraps).toBe(false);
    // Unmeasured (the server HTML): no name is known to wrap, so every name keeps leading-tight.
    expect(grid.tileLayout(ann, y, 0).wraps).toBe(false);
    // The 1.2 line counts 15.6px a line for a long name (16.8px for a short one), so a slot that fits
    // three wrapped lines no longer clips the third; the genre and the time still go first.
    expect(cardRows(57, 3, false, { long: true, wraps: true })).toMatchObject({ nameLines: 3, clamped: false, time: false });
    expect(cardRows(57, 3, false, { long: true })).toMatchObject({ nameLines: 2, clamped: true });
    expect(cardRows(85, 2, true, { wraps: true })).toMatchObject({ nameLines: 2, time: true, genre: true, clamped: false });
    expect(cardRows(54, 2, true, { wraps: true })).toMatchObject({ nameLines: 2, time: false, genre: false, clamped: false });
  });

  it("hides the genre first, then the time, before it takes lines from the name", () => {
    // Roomy: everything shows.
    expect(cardRows(160, 2, true)).toMatchObject({ nameLines: 2, time: true, genre: true, clamped: false });
    // The room the draw line took now goes to the genre.
    expect(cardRows(85, 2, true)).toMatchObject({ nameLines: 2, time: true, genre: true, clamped: false });
    // A little shorter: the genre goes first.
    expect(cardRows(70, 2, true)).toMatchObject({ nameLines: 2, time: true, genre: false, clamped: false });
    // Shorter still: the time goes too, and the name keeps both its lines.
    expect(cardRows(54, 2, true)).toMatchObject({ nameLines: 2, time: false, genre: false, clamped: false });
    // Only when nothing else is left does the name lose a line, and then it says so (clamped).
    expect(cardRows(28, 2, true)).toMatchObject({ nameLines: 1, clamped: true });
    // A tile has no draw row at all.
    expect("draw" in cardRows(160, 2, true)).toBe(false);
  });
});

describe("a tile with no Qloo signal", () => {
  it("keeps the words 'No Qloo signal' visible, even in a short slot", () => {
    for (const minutes of [60, 25]) {
      const { inner } = tile(board(90, minutes), "cy");
      const label = /<span data-no-signal="" class="([^"]*)">([\s\S]*?)<\/span>/.exec(inner);
      expect(label, `${minutes} minutes`).not.toBeNull();
      expect(label?.[1]).not.toContain("sr-only");
      expect(label?.[2]).toContain("No Qloo signal");
    }
    expect(cardRows(40, 1, false, { label: true })).toMatchObject({ label: true, nameLines: 1 });
  });

  it("is the board's paper in a dotted control-grey edge with an ink name and time and a muted label, and has no ring glyph", () => {
    const { open, inner } = tile(board(90), "cy");
    // Unpriced weighs less than priced: the opaque page paper, never the card and never a transparent fill.
    expect(open).toMatch(/border-dotted border-border-strong bg-background text-foreground/);
    expect(open).not.toContain("bg-card");
    expect(open).not.toContain("bg-transparent");
    // The "No Qloo signal" label stays muted (12px, medium); the name and the time take the tile's ink.
    expect(inner).toMatch(/<span data-no-signal="" class="mt-auto block text-xs leading-4 font-medium whitespace-nowrap text-muted-foreground/);
    expect(inner).toMatch(/<span class="block font-mono text-xs leading-4 whitespace-nowrap tabular-nums text-foreground">/);
    expect(/<span data-set-name="cy" class="([^"]*)"/.exec(inner)?.[1] ?? "").not.toContain("text-muted-foreground");
    expect(inner).not.toContain("<svg");
    expect(inner).not.toContain("<circle");
  });

  it("says 'No priced signal' on the invented day", () => {
    const { inner } = tile(board(90, 60, true), "cy");
    expect(inner).toContain("No priced signal");
    expect(inner).not.toContain("No Qloo signal");
  });
});

describe("the board's shading", () => {
  it("sets every tile on the 10px tile corner with 10px by 8px padding in a roomy slot", () => {
    const html = board(90);
    for (const id of ["ann", "bo", "cy"]) {
      const { open } = tile(html, id);
      expect(open).toMatch(/\brounded-md\b/);
      expect(open).not.toMatch(/\brounded-sm\b/);
      expect(open).toMatch(/\bpx-2\.5 py-2\b/);
    }
    // The name tooltip is a label on the 6px corner.
    const short = board(15);
    expect(short).toMatch(/data-name-tooltip=""[^>]*class="[^"]*\brounded-sm\b/);
    expect(short).not.toMatch(/data-name-tooltip=""[^>]*class="[^"]*\brounded-md\b/);
  });

  it("draws a tested place as a dashed ink ghost on the tile's 10px corner, its name never narrowed", () => {
    const plan: PlanPreview = { kept: [{ actId: "cy", stageId: "main", day: 0, start: 1080, end: 1140 }], trying: null };
    const html = board(90, 60, false, [], plan);
    const ghost = /<div data-ghost="kept" class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(ghost.split(" ")).toEqual(expect.arrayContaining(["rounded-md", "border-2", "border-dashed", "border-foreground"]));
    expect(ghost).not.toMatch(/\brounded-sm\b/);
    expect(html).toContain("· tested");
    expect(html).not.toMatch(/wdth|font-variation-settings/);
  });

  it("sets the stage names in the wordmark utility, with no width narrowing of its own", () => {
    const html = board(90);
    expect(html).toMatch(/<p class="type-wordmark text-lg break-words">Main<\/p>/);
    expect(html).not.toMatch(/wdth|font-variation-settings/);
  });

  it("draws its links at their final state: no scroll reveal, no draw-in and no stagger", () => {
    const html = board(90);
    expect(html).not.toMatch(/data-reveal|cc-link-draw|cc-link-wipe|--reveal-delay|pathLength/i);
    // The links and badges are laid out only once the board is measured, so the source says it for them.
    const source = readFileSync(join(__dirname, "timetable-grid.tsx"), "utf8");
    expect(source).not.toMatch(/useReveal|data-reveal|cc-link-draw|cc-link-wipe|--reveal-delay|pathLength/);
    // The rank badges keep their hover and focus lift, and stay discs.
    expect(source).toMatch(/"cc-link-badge [^"]*rounded-full[^"]*hover:scale-110 focus-visible:scale-110/);
  });

  it("draws priced tiles as the sheet in a hairline, with the stronger edge for a costed clash", () => {
    const html = board(90);
    // Bo is in the one costed clash; the hairline is for priced tiles outside the drawn clashes.
    expect(tile(html, "bo").open).toMatch(/bg-card text-foreground border-border-strong/);
    expect(tile(html, "ann").open).toMatch(/bg-card text-foreground border-border-strong/);
    for (const id of ["ann", "bo"]) expect(tile(html, id).open).not.toContain("bg-background");
  });

  it("sets only the act and its time in ink: the genre (12px) stays muted, and the draw is read out only", () => {
    const { inner } = tile(board(90), "ann");
    expect(inner).toMatch(/<span class="block font-mono text-xs leading-4 whitespace-nowrap tabular-nums text-foreground">/);
    expect(inner).not.toMatch(/font-mono text-xs leading-4 whitespace-nowrap[^"]*text-muted-foreground tabular-nums/);
    expect(/<span data-set-name="ann" class="([^"]*)"/.exec(inner)?.[1] ?? "").toMatch(/font-semibold/);
    expect(inner).toMatch(/<span data-genre="" class="block text-xs leading-\[15px\] break-words text-muted-foreground">/);
    expect(inner).toContain('<span class="sr-only">Draw 90. </span>');
    expect(inner).not.toMatch(/justify-end/);
  });

  it("prints no draw figure on a tile, roomy or short, and keeps it in the tile's screen-reader text and title", () => {
    for (const minutes of [90, 50]) {
      const { open, inner } = tile(board(minutes), "ann");
      // A sighted reader sees the name, the time and the genre, never the near-constant figure.
      expect(visible(inner), `${minutes} minutes`).not.toMatch(/Draw \d+/);
      expect(inner).not.toMatch(/tabular-nums">Draw/);
      // A screen reader still hears it, after the time, and the tile's title still names it.
      expect(text(inner), `${minutes} minutes`).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}[^]*Draw 90\./);
      expect(decode(/title="([^"]*)"/.exec(open)?.[1] ?? "")).toContain("Draw 90");
    }
    expect(cardRows(185, 3, false, { long: true }).roomy).toBe(true);
    // A short tile (a 50-minute set, without the roomy padding) keeps its time.
    expect(cardRows(101, 3, false, { long: true })).toMatchObject({ roomy: false, time: true });
    // Never smaller than 12px anywhere on a tile.
    expect(board(90) + board(50)).not.toMatch(/text-\[(?:[0-9]|1[01])px\]|text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]/);
  });

  it("has no draw-stepped fill, no colour mixing, no opacity attributes and no half-hour rules", () => {
    const html = board(90);
    expect("drawFillPercent" in grid).toBe(false);
    expect(html).not.toContain("--set-fill");
    expect(html).not.toContain("color-mix");
    expect(html).not.toMatch(/stroke-opacity|fill-opacity/);
    expect(html).not.toContain("border-dashed border-border");
    expect(html).not.toContain("bg-hatch");
  });

  it("sets the hour labels at 12px and the stage header with no heavy rule", () => {
    const html = board(90);
    expect(html).toMatch(/-translate-y-1\/2 font-mono text-xs text-muted-foreground tabular-nums/);
    expect(html).not.toContain("border-b-2");
  });
});

describe("a weak-signal tile", () => {
  /** The weak foot of a tile, if it shows one: in words, or as the cue word. */
  function weakParts(inner: string) {
    const line = /<span aria-hidden="true" data-weak="line" class="([^"]*)">([^<]*)<\/span>/.exec(inner);
    const cue = /<span aria-hidden="true" data-weak="cue" class="([^"]*)">([^<]*)<\/span>/.exec(inner);
    return { line, cue };
  }

  const y = (minute: number) => minute * 2.1;
  const weakAnn = (minutes = 90, synthetic = false) => {
    const view = boardPreset(minutes, 60, synthetic, ["ann"]).views.find((item) => item.id === "ann");
    expect(view).toBeTruthy();
    return view as NonNullable<typeof view>;
  };

  it("says 'Weak Qloo signal' at its foot where the tile has room, in the no-signal label's style", () => {
    const { inner } = tile(board(90, 60, false, ["ann"]), "ann");
    const { line, cue } = weakParts(inner);
    expect(line?.[2]).toBe("Weak Qloo signal");
    expect(line?.[1]).toBe("mt-auto block text-xs leading-4 font-medium whitespace-nowrap text-muted-foreground pt-1");
    expect(cue).toBeNull();
    // No figure beside it (the draw is read out just before it), and no lowercase token is left on the tile.
    expect(inner).toMatch(/<span class="sr-only">Draw 90\. <\/span><span aria-hidden="true" data-weak="line"/);
    expect(inner).not.toMatch(/>weak</);
    expect(inner).not.toContain("· weak");
  });

  it("says 'Weak signal', naming no vendor, on a roomy tile of the invented day", () => {
    const { inner } = tile(board(90, 60, true, ["ann"]), "ann");
    const { line } = weakParts(inner);
    expect(line?.[2]).toBe("Weak signal");
    expect(line?.[0]).not.toContain("Qloo");
  });

  it("prints the cue word 'weak' at the foot of a tile too narrow for the words, and the key explains it", () => {
    // Every weak tile with room for its foot line prints the words or the cue word, never neither and never both.
    const ann = weakAnn();
    const seen = { line: 0, cue: 0 };
    for (let width = 60; width <= 200; width += 4) {
      const { rows, foot } = grid.tileLayout(ann, y, width);
      if (!rows.weakLine) continue;
      expect(foot, `${width}px`).toBeTruthy();
      if (foot?.cue) seen.cue += 1;
      else if (foot) seen.line += 1;
    }
    expect(seen.line).toBeGreaterThan(0);
    expect(seen.cue).toBeGreaterThan(0);
    // "weak" on a phone board's 107px column; the words on a desktop board's 128px one.
    expect(grid.tileLayout(ann, y, 107).foot).toEqual({ text: WEAK_CUE_WORD, cue: true });
    expect(grid.tileLayout(ann, y, 128).foot).toEqual({ text: "Weak Qloo signal", cue: false });
    // The invented day's shorter words still fit the phone column.
    expect(grid.tileLayout(weakAnn(90, true), y, 107, true).foot).toEqual({ text: "Weak signal", cue: false });
    expect(cardRows(110, 3, false, { long: true, weak: true })).toMatchObject({ time: true, weakLine: true });
    expect(cardRows(75, 3, false, { long: true, weak: true })).toMatchObject({ time: true, weakLine: false });
    expect(cardRows(160, 3, false, { long: true, weak: true })).toMatchObject({ time: true, weakLine: true });
    // The weak line outranks the genre: the genre is the row a tile hides first, and a weak tile with no
    // room for its qualifier shows no genre either.
    expect(cardRows(80, 1, true, { weak: true })).toMatchObject({ weakLine: true, genre: false });
    expect(cardRows(80, 1, true)).toMatchObject({ weakLine: false, genre: true });
    expect(cardRows(59, 1, true, { weak: true })).toMatchObject({ time: true, weakLine: false, genre: false });
    expect(cardRows(59, 1, true)).toMatchObject({ time: true, genre: true });
  });

  it("draws the cue in the key only while some tile prints it, as a mini tile holding the tiles' own word", () => {
    const key = (props: { weak?: boolean; synthetic?: boolean }) => renderToStaticMarkup(createElement(TimetableLegend, props));
    // The board publishes how many tiles print the cue word, not how many sets are weak: a weak tile wide
    // enough says "Weak Qloo signal" in words, and then the key has no cue item.
    const cueTiles = (html: string) => (html.match(/data-weak="cue"/g) ?? []).length;
    // Unmeasured (the server HTML), every weak tile with room prints its words: the count and the markup agree.
    for (let minutes = 40; minutes <= 90; minutes += 2) {
      const { views } = boardPreset(minutes, 60, false, ["ann"]);
      expect(shortCueCount(views), `${minutes} minutes`).toBe(cueTiles(board(minutes, 60, false, ["ann"])));
    }
    let printed = 0;
    let roomy = 0;
    for (let width = 60; width <= 200; width += 4) {
      const { views } = boardPreset(90, 60, false, ["ann"]);
      const count = shortCueCount(views, columns(width));
      const html = key({ weak: count > 0 });
      if (count > 0) {
        printed += 1;
        expect(html).toContain('data-legend-item="weak"');
      } else {
        roomy += 1;
        expect(html).not.toContain('data-legend-item="weak"');
      }
    }
    // A board whose weak tile is wide enough prints no cue, and one whose tile is narrow prints one.
    expect(printed).toBeGreaterThan(0);
    expect(roomy).toBeGreaterThan(0);
    expect(shortCueCount(boardPreset(90, 60, false, ["ann"]).views)).toBe(0);
    expect(shortCueCount(boardPreset(90).views)).toBe(0);
    expect(shortCueCount(boardPreset(90).views, columns(84))).toBe(0);
    expect(shortCueCount(boardPreset(90, 60, false, ["ann"]).views, columns(107))).toBe(1);
    expect(shortCueCount(boardPreset(90, 60, true, ["ann"]).views, columns(107), true)).toBe(0);
    // The item: an SVG mini tile in tokens holding the word the tiles print, then its name with no prefix.
    const shown = key({ weak: true });
    const item = /<li class="flex items-center gap-x-2 whitespace-nowrap">([\s\S]*?)<\/li>/g;
    const weakItem = [...shown.matchAll(item)].map((match) => match[1] ?? "").find((inner) => inner.includes('data-legend-item="weak"')) ?? "";
    expect(weakItem).toMatch(/<svg aria-hidden="true" data-mark="weak" width="36" height="18" viewBox="0 0 36 18" class="block">/);
    expect(weakItem).toContain('<rect x="0.5" y="0.5" width="35" height="17" rx="6" fill="var(--card)" stroke="var(--border-strong)" stroke-width="1"></rect>');
    expect(weakItem).toContain(`font-size="12" fill="var(--muted-foreground)" class="font-medium">${WEAK_CUE_WORD}</text>`);
    expect(weakItem).toContain('<span data-legend-item="weak">Weak Qloo signal</span>');
    expect(shown).not.toMatch(/weak: /);
    expect(key({ weak: true, synthetic: true })).toContain('<span data-legend-item="weak">Weak signal</span>');
    expect(key({ weak: true, synthetic: true })).not.toContain("Weak Qloo");
    // The tiles print the same word the key draws.
    expect(grid.weakCue("Weak Qloo signal", 40)?.text).toBe(WEAK_CUE_WORD);
    expect(key({ weak: false })).not.toContain('data-legend-item="weak"');
    expect(key({})).not.toContain('data-legend-item="weak"');
    // "No Qloo signal" is never the item hidden.
    for (const weak of [true, false]) expect(key({ weak })).toContain('data-legend-item="no-signal"');
    // The cue key is not one of the counted symbols: the count is unchanged for every option.
    for (const planShown of [true, false])
      for (const showLinks of [true, false])
        for (const synthetic of [true, false])
          expect(legendSymbolCount({ planShown, showLinks, synthetic, weak: true })).toBe(
            legendSymbolCount({ planShown, showLinks, synthetic }),
          );
    expect(legendSymbolCount({})).toBe(4);
    expect(legendSymbolCount({ planShown: true })).toBe(5);
    expect(legendSymbolCount({ showLinks: false })).toBe(2);
  });

  it("draws the no-signal swatch as a 20 x 12 dotted mini tile at 1.5px on a mark's 6px corner, on the board's paper as the tile is", () => {
    const html = renderToStaticMarkup(createElement(TimetableLegend, {}));
    expect(html).toContain('<svg aria-hidden="true" data-mark="no-signal" width="20" height="12" viewBox="0 0 20 12" class="block">');
    expect(html).toContain('rx="6" fill="var(--background)" stroke="var(--border-strong)" stroke-width="1.5" stroke-dasharray="1.5 2"');
  });

  it("rounds every key swatch: each rect carries an rx, the tested slot keeps the label corner, the discs stay round", () => {
    const html = renderToStaticMarkup(createElement(TimetableLegend, { weak: true, planShown: true }));
    // The swatches drawn as SVG (the lock is the icon set's own glyph, not a swatch).
    const swatches = (html.match(/<svg aria-hidden="true" data-mark="[^"]*"[\s\S]*?<\/svg>/g) ?? []).join("");
    const rects = swatches.match(/<rect\b[^>]*>/g) ?? [];
    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) expect(rect).toMatch(/\brx="6"/);
    expect(html).toMatch(/data-mark="tested" class="[^"]*\brounded-sm\b/);
    expect(html).toMatch(/data-mark="seen" class="[^"]*\brounded-full\b/);
    expect(html).toMatch(/data-mark="hidden" class="[^"]*\brounded-full\b/);
  });

  it("fits the qualifier across a tile: the words where they fit, the cue word where they do not, never a cut word", () => {
    // Unmeasured (server HTML) or wide: the words.
    expect(grid.weakCue("Weak Qloo signal", 0)).toEqual({ text: "Weak Qloo signal", cue: false });
    expect(grid.weakCue("Weak Qloo signal", 106)).toEqual({ text: "Weak Qloo signal", cue: false });
    // Narrower (a phone board's 85px across): the cue word, which the key explains; the invented day's
    // shorter words still fit there.
    expect(grid.weakCue("Weak Qloo signal", 85)).toEqual({ text: "weak", cue: true });
    expect(grid.weakCue("Weak signal", 85)).toEqual({ text: "Weak signal", cue: false });
    // Where even the cue word does not fit, nothing: the tile never prints a cut word.
    expect(grid.weakCue("Weak Qloo signal", 20)).toBeNull();
    expect(grid.weakCue("Weak signal", 20)).toBeNull();
    // With no foot line shown, the qualifier is still read out and kept in the title.
    expect(cardRows(75, 3, false, { long: true, weak: true }).weakLine).toBe(false);
  });

  it("keeps the full wording in its accessible name and title, whichever cue it shows", () => {
    for (const minutes of [90, 50]) {
      const { open, inner } = tile(board(minutes, 60, false, ["ann"]), "ann");
      expect(text(inner), `${minutes} minutes`).toContain("Weak Qloo signal.");
      expect(decode(/title="([^"]*)"/.exec(open)?.[1] ?? "")).toContain("Weak Qloo signal.");
    }
    // A tile with a strong signal says nothing about it.
    const { open, inner } = tile(board(90, 60, false, ["ann"]), "bo");
    expect(text(inner)).not.toMatch(/weak/i);
    expect(open).not.toMatch(/weak/i);
  });

  it("never hides 'No Qloo signal' on a short no-signal tile, on a day with weak tiles", () => {
    const { inner } = tile(board(90, 25, false, ["ann"]), "cy");
    const label = /<span data-no-signal="" class="([^"]*)">([\s\S]*?)<\/span>/.exec(inner);
    expect(label?.[1]).not.toContain("sr-only");
    expect(label?.[2]).toContain("No Qloo signal");
    expect(inner).not.toContain("data-weak");
  });
});
