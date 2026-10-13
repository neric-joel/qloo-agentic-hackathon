import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildSetViews, topClashes } from "@/lib/clashes";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";

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

function board(minutes: number, cyMinutes = 60, synthetic = false, weak: string[] = []): string {
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
      synthetic,
    }),
  );
}

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
    // three wrapped lines no longer clips the third; the genre and the draw still go first.
    expect(cardRows(57, 3, false, { long: true, wraps: true })).toMatchObject({ nameLines: 3, clamped: false, draw: false });
    expect(cardRows(57, 3, false, { long: true })).toMatchObject({ nameLines: 2, clamped: true });
    expect(cardRows(85, 2, true, { wraps: true })).toMatchObject({ nameLines: 2, time: true, draw: true, genre: false, clamped: false });
    expect(cardRows(54, 2, true, { wraps: true })).toMatchObject({ nameLines: 2, draw: false, genre: false, clamped: false });
  });

  it("hides the genre first, then the draw, before it takes lines from the name", () => {
    // Roomy: everything shows.
    expect(cardRows(160, 2, true)).toMatchObject({ nameLines: 2, time: true, draw: true, genre: true, clamped: false });
    // A little shorter: the genre goes first.
    expect(cardRows(85, 2, true)).toMatchObject({ nameLines: 2, time: true, draw: true, genre: false, clamped: false });
    // Shorter still: the draw goes too, and the name keeps both its lines.
    expect(cardRows(54, 2, true)).toMatchObject({ nameLines: 2, draw: false, genre: false, clamped: false });
    // Only when nothing else is left does the name lose a line, and then it says so (clamped).
    expect(cardRows(28, 2, true)).toMatchObject({ nameLines: 1, clamped: true });
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
  it("sets every tile on the 8px corner with 10px by 8px padding in a roomy slot", () => {
    const html = board(90);
    for (const id of ["ann", "bo", "cy"]) {
      const { open } = tile(html, id);
      expect(open).toMatch(/\brounded-sm\b/);
      expect(open).not.toMatch(/\brounded-md\b/);
      expect(open).toMatch(/\bpx-2\.5 py-2\b/);
    }
  });

  it("draws priced tiles as the sheet in a hairline, with the stronger edge for a costed clash", () => {
    const html = board(90);
    // Bo is in the one costed clash; the hairline is for priced tiles outside the drawn clashes.
    expect(tile(html, "bo").open).toMatch(/bg-card text-foreground border-border-strong/);
    expect(tile(html, "ann").open).toMatch(/bg-card text-foreground border-border-strong/);
    for (const id of ["ann", "bo"]) expect(tile(html, id).open).not.toContain("bg-background");
  });

  it("sets only the act and its time in ink: the genre (12px) and the draw stay muted", () => {
    const { inner } = tile(board(90), "ann");
    expect(inner).toMatch(/<span class="block font-mono text-xs leading-4 whitespace-nowrap tabular-nums text-foreground">/);
    expect(inner).not.toMatch(/font-mono text-xs leading-4 whitespace-nowrap[^"]*text-muted-foreground tabular-nums/);
    expect(/<span data-set-name="ann" class="([^"]*)"/.exec(inner)?.[1] ?? "").toMatch(/font-semibold/);
    expect(inner).toMatch(/<span data-genre="" class="block text-xs leading-\[15px\] break-words text-muted-foreground">/);
    expect(inner).toMatch(/justify-end gap-x-1\.5 text-\[0\.8125rem\] leading-4 whitespace-nowrap text-muted-foreground/);
  });

  it("prints the draw as a mono figure at the bottom right: 13px in a roomy tile, 12px in a short one, on the same 16px line", () => {
    const drawLine = (inner: string) =>
      /<span class="(flex min-w-0 items-baseline justify-end[^"]*)">(?:<[^>]+>[^<]*<\/span>)?<span class="shrink-0 font-mono tabular-nums">Draw 90<\/span>/.exec(
        inner,
      )?.[1] ?? "";
    // Roomy (a 90-minute set): 13px.
    const roomy = drawLine(tile(board(90), "ann").inner);
    expect(roomy.split(" ")).toEqual(expect.arrayContaining(["text-[0.8125rem]", "leading-4", "text-muted-foreground"]));
    expect(roomy.split(" ")).not.toContain("text-xs");
    expect(cardRows(185, 3, false, { long: true }).roomy).toBe(true);
    // Short (a 50-minute set still shows its draw, without the roomy padding): 12px, as before.
    expect(cardRows(101, 3, false, { long: true })).toMatchObject({ roomy: false, draw: true });
    const short = drawLine(tile(board(50), "ann").inner);
    expect(short.split(" ")).toEqual(expect.arrayContaining(["text-xs", "leading-4", "text-muted-foreground"]));
    expect(short.split(" ")).not.toContain("text-[0.8125rem]");
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
  /** The weak line and the draw line of a tile, if it shows them. */
  function weakParts(inner: string) {
    const line = /<span aria-hidden="true" data-weak="line" class="([^"]*)">([^<]*)<\/span>/.exec(inner);
    const cue = /<span data-weak="cue" class="[^"]*">([\s\S]*?)<\/span><span class="sr-only">/.exec(inner);
    return { line, cue };
  }

  it("says 'Weak Qloo signal' on its own line over the draw where the tile has room, in the no-signal label's style", () => {
    const { inner } = tile(board(90, 60, false, ["ann"]), "ann");
    const { line, cue } = weakParts(inner);
    expect(line?.[2]).toBe("Weak Qloo signal");
    expect(line?.[1]).toBe("mt-auto block text-xs leading-4 font-medium whitespace-nowrap text-muted-foreground pt-1");
    expect(cue).toBeNull();
    // The figure follows the line, and no lowercase token is left beside it.
    expect(inner).toMatch(/Weak Qloo signal<\/span><span class="flex min-w-0 items-baseline justify-end[^"]*"><span class="shrink-0 font-mono tabular-nums">Draw 90<\/span>/);
    expect(inner).not.toMatch(/>weak</);
    expect(inner).not.toContain("· weak");
  });

  it("says 'Weak signal', naming no vendor, on a roomy tile of the invented day", () => {
    const { inner } = tile(board(90, 60, true, ["ann"]), "ann");
    const { line } = weakParts(inner);
    expect(line?.[2]).toBe("Weak signal");
    expect(line?.[0]).not.toContain("Qloo");
  });

  it("keeps a '· weak' cue on the draw line of a tile too short for the line, and the key explains it", () => {
    // Every weak tile that shows its draw has the line or the cue, never neither and never both.
    const seen = { line: 0, cue: 0 };
    let short = "";
    for (let minutes = 40; minutes <= 90; minutes += 2) {
      const { inner } = tile(board(minutes, 60, false, ["ann"]), "ann");
      // Only tiles that show their draw: a tile too short for it shows no figure to qualify.
      if (!inner.includes(`tabular-nums">Draw 90`)) continue;
      const { line, cue } = weakParts(inner);
      expect(Boolean(line) !== Boolean(cue), `${minutes} minutes`).toBe(true);
      if (line) seen.line += 1;
      if (cue) {
        seen.cue += 1;
        short ||= inner;
      }
    }
    expect(seen.line).toBeGreaterThan(0);
    expect(seen.cue).toBeGreaterThan(0);
    // "Draw 90 · weak", the cue in the draw line's own 12px mono muted style.
    expect(weakParts(short).cue?.[1]).toBe('<span class="shrink-0 font-mono tabular-nums">Draw 90<span aria-hidden="true"> · weak</span>');
    expect(text(weakParts(short).cue?.[1] ?? "")).toBe("Draw 90 · weak");
    expect(short).toMatch(/<span data-weak="cue" class="flex min-w-0 items-baseline justify-end gap-x-1\.5 text-xs leading-4 whitespace-nowrap text-muted-foreground mt-auto/);
    expect(cardRows(110, 3, false, { long: true, weak: true })).toMatchObject({ draw: true, weakLine: false });
    expect(cardRows(160, 3, false, { long: true, weak: true })).toMatchObject({ draw: true, weakLine: true });
    // The weak line outranks the genre: the genre is the row a tile hides first.
    expect(cardRows(90, 1, true, { weak: true })).toMatchObject({ draw: true, weakLine: true, genre: false });
    expect(cardRows(90, 1, true)).toMatchObject({ draw: true, weakLine: false, genre: true });
  });

  it("draws the cue in the key only while some tile prints it, as a mini tile holding the tiles' own word", () => {
    const key = (props: { weak?: boolean; synthetic?: boolean }) => renderToStaticMarkup(createElement(TimetableLegend, props));
    // The board publishes how many tiles print the short cue, not how many sets are weak: a roomy weak
    // tile says "Weak Qloo signal" in words, and then the key has no cue item.
    const cueTiles = (html: string) => (html.match(/data-weak="cue"/g) ?? []).length;
    let printed = 0;
    let roomy = 0;
    for (let minutes = 40; minutes <= 90; minutes += 2) {
      const { views } = boardPreset(minutes, 60, false, ["ann"]);
      const count = shortCueCount(views);
      expect(count, `${minutes} minutes`).toBe(cueTiles(board(minutes, 60, false, ["ann"])));
      const html = key({ weak: count > 0 });
      if (count > 0) {
        printed += 1;
        expect(html).toContain('data-legend-item="weak"');
      } else {
        roomy += 1;
        expect(html).not.toContain('data-legend-item="weak"');
      }
    }
    // A board where the weak tile is roomy prints no cue, and one where it is short prints one.
    expect(printed).toBeGreaterThan(0);
    expect(roomy).toBeGreaterThan(0);
    expect(shortCueCount(boardPreset(90, 60, false, ["ann"]).views)).toBe(0);
    expect(shortCueCount(boardPreset(90).views)).toBe(0);
    // The item: an SVG mini tile in tokens holding the word the tiles print, then its name with no prefix.
    const shown = key({ weak: true });
    const item = /<li class="flex items-center gap-x-2 whitespace-nowrap">([\s\S]*?)<\/li>/g;
    const weakItem = [...shown.matchAll(item)].map((match) => match[1] ?? "").find((inner) => inner.includes('data-legend-item="weak"')) ?? "";
    expect(weakItem).toMatch(/<svg aria-hidden="true" data-mark="weak" width="36" height="18" viewBox="0 0 36 18" class="block">/);
    expect(weakItem).toContain('<rect x="0.5" y="0.5" width="35" height="17" rx="3" fill="var(--card)" stroke="var(--border-strong)" stroke-width="1"></rect>');
    expect(weakItem).toContain(`font-size="12" fill="var(--muted-foreground)" class="font-mono">${WEAK_CUE_WORD}</text>`);
    expect(weakItem).toContain('<span data-legend-item="weak">Weak Qloo signal</span>');
    expect(shown).not.toMatch(/weak: /);
    expect(key({ weak: true, synthetic: true })).toContain('<span data-legend-item="weak">Weak signal</span>');
    expect(key({ weak: true, synthetic: true })).not.toContain("Weak Qloo");
    // The tiles print the same word the key draws.
    expect(grid.weakCue("Draw 21", 0)?.cue).toBe(` · ${WEAK_CUE_WORD}`);
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

  it("draws the no-signal swatch as a 20 x 12 dotted mini tile at 1.5px, on the board's paper as the tile is", () => {
    const html = renderToStaticMarkup(createElement(TimetableLegend, {}));
    expect(html).toContain('<svg aria-hidden="true" data-mark="no-signal" width="20" height="12" viewBox="0 0 20 12" class="block">');
    expect(html).toContain('rx="3" fill="var(--background)" stroke="var(--border-strong)" stroke-width="1.5" stroke-dasharray="1.5 2"');
  });

  it("fits the cue across a narrow tile, and hides the draw rather than cut it where even that does not fit", () => {
    // Unmeasured (server HTML) or roomy: the full cue.
    expect(grid.weakCue("Draw 21", 0)).toEqual({ cue: " · weak", tight: false });
    expect(grid.weakCue("Draw 21", 120)).toEqual({ cue: " · weak", tight: false });
    // Narrower: the mono dot keeps its own side space, then the line is set 0.05em tighter (a phone board's 84px).
    expect(grid.weakCue("Draw 21", 94)).toEqual({ cue: "·weak", tight: false });
    expect(grid.weakCue("Draw 21", 84)).toEqual({ cue: "·weak", tight: true });
    expect(grid.weakCue("Draw 100", 70)).toBeNull();
    expect(grid.weakCue("", 40)).toEqual({ cue: "weak", tight: false });
    // With no figure shown, the draw (and so the cue) is still read out and kept in the title.
    expect(cardRows(110, 3, false, { long: true, weak: true }).draw).toBe(true);
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
