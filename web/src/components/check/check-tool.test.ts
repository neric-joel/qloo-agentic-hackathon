import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseGrid, removePairLine, runCheck, type PairSuggestion } from "@/lib/check";
import { breakDecisionId } from "@/lib/check-decisions";
import { PRICE_COPY, defaultOrder, parsePriceAnswer, priceBody, priceRequest, thirdParty } from "@/lib/check-price";
import {
  SAMPLE_GRID,
  SAMPLE_RULES,
  SAMPLE_SETTINGS,
  dropSampleRules,
  isPublishedInput,
  keepSampleRules,
  publishedDayInput,
  publishedPairsLine,
} from "@/lib/check-sample";

import { RULE_LABELS } from "@/lib/check";

import { BOTH_LOCKED, CheckResults, RESULT_IDS, breakMarks, lockNote, lockedClause, nextStep } from "./check-results";
import { CheckPrice } from "./check-price";
import { CheckBrief } from "./check-brief";
import { CheckReview, comparedLine, openLine, ruleBreaksValue } from "./check-review";
import { BreakStrip } from "./check-break-strip";
import {
  BreakItem,
  CheckTool,
  GridTable,
  PREVIEW_PAIRS,
  PUBLISHED_KEPT,
  SharedPreview,
  awaitPublishedDay,
  escapeClears,
  foldedLines,
  offeredDay,
  pairFixes,
  pairLineOf,
  publishedArrival,
  rejectedRange,
  remedyAnchor,
  takesPaste,
  typedName,
  stageStartRows,
  type Remedy,
} from "./check-tool";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const sample = runCheck({
  grid: SAMPLE_GRID,
  changeover: SAMPLE_SETTINGS.changeover,
  curfew: SAMPLE_SETTINGS.curfew,
  pairs: SAMPLE_SETTINGS.pairs,
});
if (!sample.ok) throw new Error("the sample should read");
const shared = sample.report.shared;
const SAMPLE_INPUT_FOR_TEST = { grid: SAMPLE_GRID, ...SAMPLE_SETTINGS };
const more = shared.length - PREVIEW_PAIRS;

describe("Show all N pairs", () => {
  it("lists five pairs as a ruled list and an outline button that says how many in all, collapsed", () => {
    expect(more).toBeGreaterThan(0);
    const html = renderToStaticMarkup(createElement(SharedPreview, { shared, open: false, onToggle: () => {} }));
    expect(html.match(/<li /g)).toHaveLength(PREVIEW_PAIRS);
    const button = html.match(/<button[^>]*>[^<]*<\/button>/)?.[0] ?? "";
    expect(button).toContain('aria-expanded="false"');
    expect(PREVIEW_PAIRS).toBe(5);
    expect(button).toContain('data-variant="outline"');
    expect(button).not.toContain("w-full");
    expect(text(button)).toBe(`Show all ${shared.length}`);
    // A ruled list: hairlines between the rows and above and below it.
    expect(html).toMatch(/<ul class="[^"]*divide-y divide-border border-y border-border/);
    // No "+N more" link any more.
    expect(html).not.toMatch(/\+\d+ more/);
  });

  it("expands every pair in place and folds them again with Show fewer", () => {
    const html = renderToStaticMarkup(createElement(SharedPreview, { shared, open: true, onToggle: () => {} }));
    expect(html.match(/<li /g)).toHaveLength(shared.length);
    const button = html.match(/<button[^>]*>[^<]*<\/button>/)?.[0] ?? "";
    expect(button).toContain('aria-expanded="true"');
    expect(text(button)).toBe("Show fewer");
    // The button stays after the list, in the same place, so focus stays on it.
    expect(html.lastIndexOf("</ul>")).toBeLessThan(html.indexOf("<button"));
  });

  it("reads like a price list: each act (stage) on its own line, the window in 12px tabular figures, the minutes set right once", () => {
    const html = renderToStaticMarkup(createElement(SharedPreview, { shared, open: false, onToggle: () => {} }));
    const first = html.slice(html.indexOf("<li "), html.indexOf("</li>"));
    const pair = shared[0];
    // Never cut off with an ellipsis.
    expect(html).not.toContain("truncate");
    expect(first).toMatch(/^<li class="grid grid-cols-\[minmax\(0,1fr\)_auto\]/);
    expect(first.indexOf(pair.a.act)).toBeLessThan(first.indexOf(pair.b.act));
    expect(first).toMatch(/<span class="mt-0\.5 block font-mono text-xs[^"]*">/);
    // The minutes last, right-aligned, in the condensed display face at 1.25rem.
    expect(first).toMatch(/<span class="text-right whitespace-nowrap"><span class="type-numeral text-\[1\.25rem\] leading-none">\d+<\/span>/);
    expect(text(first)).toMatch(/\d+ min$/);
    expect(text(first).match(/min/g)).toHaveLength(1);
    expect(text(first)).not.toContain("shared,");
  });

  it("shows no button when five or fewer pairs share time", () => {
    const html = renderToStaticMarkup(
      createElement(SharedPreview, { shared: shared.slice(0, PREVIEW_PAIRS), open: false, onToggle: () => {} }),
    );
    expect(html).not.toContain("<button");
  });
});

describe("the check tool's sheet", () => {
  const html = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));

  it("switches Table / CSV with the shared SegmentedControl: one radio group, the same two values", () => {
    const group = html.match(/<div role="radiogroup" aria-label="Show the draft grid as"[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(group).not.toBe("");
    const radios = group.match(/<input type="radio"[^>]*>/g) ?? [];
    expect(radios.map((radio) => radio.match(/value="([^"]+)"/)?.[1])).toEqual(["table", "csv"]);
    // The sample opens as a table.
    expect(radios[0]).toContain('checked=""');
    expect(radios[1]).not.toContain('checked=""');
    expect(text(group)).toBe("Table CSV");
  });

  it("opens with the verdict as one sentence and the rule breaks right under it, before the pairs", () => {
    const preview = html.slice(html.indexOf('aria-label="Checked"'));
    expect(preview).toMatch(/<p class="type-title"><span class="tabular-nums">4<\/span> rule breaks found<\/p>/);
    const breaks = preview.indexOf('aria-label="Rule breaks"');
    expect(breaks).toBeGreaterThan(preview.indexOf("rule breaks found"));
    expect(breaks).toBeLessThan(preview.indexOf("Sets that share time"));
    // One 14px line ties the list to the table's numbers.
    expect(preview).toContain(
      '<p class="mt-1 text-sm leading-5 text-muted-foreground">Flagged rows are marked 1 to 4 in the grid. Select a break to highlight its rows.</p>',
    );
    // Each break: its numbered disc and the rule in 15px, as the same selection button as the results, then its rows with the row number and time in tabular figures.
    expect(preview).toMatch(
      /<button type="button" aria-pressed="false" class="[^"]*"><svg aria-hidden="true"[^>]*data-break-disc="1"[\s\S]*?<span class="sr-only">Rule break 1\. <\/span><span class="text-\[0\.9375rem\] leading-snug">Act on two stages at once<\/span>/,
    );
    expect(preview).toMatch(/<span class="font-mono text-muted-foreground tabular-nums">row \d+<\/span>/);
    // No floating numeral, no raspberry square beside "Checked".
    expect(preview.slice(0, 600)).not.toContain("bg-primary");
    expect(preview).not.toContain("text-[3.5rem]");
  });

  it("labels the invented rows with plain muted text beside the sheet's name, not a badge, and draws no fade", () => {
    expect(html).toMatch(/Draft grid<\/label><span class="text-\[0\.8125rem\] leading-5 text-muted-foreground">Invented sample, to show the format<\/span>/);
    expect(html).not.toContain('class="tag"');
    const sheet = html.slice(0, html.indexOf("<textarea"));
    expect(sheet).not.toContain("border-dashed");
    expect(html).not.toContain("bg-linear-to-t");
    // With the sample's result on show, the folded table keeps every flagged row (see "flagged rows on arrival").
    expect(text(html)).toMatch(/Showing 18 of 25 rows: the first 12 and every flagged row Show all rows/);
  });

  it("frames the sheet as a 14px editor panel, clipped, with an unfilled header, inset horizontal rules only and Clear alone on a quiet row under it", () => {
    // A panel (round 34, one radius system): the card fill inside a 1px border-strong edge on all four sides and the
    // 14px panel corner (rounded-lg), overflow clipped so the gutter and the field end inside that corner; its focus
    // outline kept, which follows the corner, for the text and (round 35) for the table that takes a paste.
    expect(html).toMatch(
      /<div class="overflow-hidden rounded-lg border border-border-strong bg-card has-\[textarea:focus-visible\]:outline-2 has-\[textarea:focus-visible\]:outline-offset-2 has-\[textarea:focus-visible\]:outline-ring has-\[\[data-paste-target\]:focus-visible\]:outline-2 has-\[\[data-paste-target\]:focus-visible\]:outline-offset-2 has-\[\[data-paste-target\]:focus-visible\]:outline-ring">/,
    );
    const frame = html.match(/<div class="(overflow-hidden rounded-lg border border-border-strong bg-card[^"]*)"/)?.[1] ?? "";
    const classes = frame.split(/\s+/);
    // One radius, the panel's: no other corner class, no capsule, no rounded-none and no arbitrary radius.
    expect(classes.filter((name) => /^rounded/.test(name))).toEqual(["rounded-lg"]);
    // An edge on all four sides in the control-edge ink: the plain border, never one side or a pair of rules.
    expect(classes.filter((name) => /^border/.test(name))).toEqual(["border", "border-border-strong"]);
    expect(classes).toContain("overflow-hidden");
    expect(classes).toContain("bg-card");
    expect(html).toMatch(/<table[^>]*class="w-full border-separate border-spacing-0/);
    // The header row has no fill; its rule is an inset hairline.
    expect(html).toContain("<thead><tr><th");
    expect(html).not.toContain("bg-foreground/[0.03]");
    const header = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
    expect(header).not.toContain("bg-muted");
    expect(header).toContain("after:bg-border");
    // The separators stop 16px short of the sheet's edges: the table sits 8px in (4px on a phone, so the six
    // columns fit at 390px), the end cells' rules 8px more.
    expect(html).toMatch(/<div class="px-2 max-sm:px-1"><table/);
    expect(html).toContain("after:left-2");
    expect(html).toContain("after:right-2");
    expect(html).not.toContain("shadow-[inset_0_-2px");
    expect(html).not.toContain("border-r border-border py-2");
    // The footer row holds what shows and "Show all rows" only; under the sheet, outside it, a quiet row holds "Clear" alone.
    const footer = html.slice(html.indexOf("Showing <span"));
    expect(footer).toMatch(/Show all rows<\/button>[\s\S]*?<\/textarea><\/div><\/div><\/div><div class="mt-3 flex"><button[^>]*type="button"[^>]*>Clear<\/button><\/div>/);
    expect(html.match(/>Check the grid<\/button>/g)).toHaveLength(1);
    expect(html.match(/>Clear<\/button>/g)).toHaveLength(1);
    const submit = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
    expect(submit).toContain('data-variant="default"');
    expect(submit).toContain("max-sm:w-full");
    // It is the page's only solid ink button: every other button is an outline or a text action.
    expect(html.match(/data-variant="(default|ink)"/g)).toHaveLength(1);
    const form = html.slice(0, html.indexOf("</form>"));
    expect(form.match(/data-variant="default"/g)).toHaveLength(1);
    // Locked is an inline glyph and word on the row's 20px line, no box.
    const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    expect(table).toMatch(/<span class="inline-flex h-5 items-center gap-1 align-top"><svg[^>]*>[\s\S]*?<\/svg>Locked<\/span>/);
  });
});

describe("the sheet's header row", () => {
  const html = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
  const surface = html.slice(html.indexOf('<div class="overflow-hidden rounded-lg border border-border-strong bg-card'));
  const header = surface.slice(0, surface.indexOf("<table"));
  // The sheet's name row: from the name's label to the sheet's frame.
  const nameRow = html.slice(html.indexOf("<label"), html.indexOf('<div class="overflow-hidden rounded-lg border border-border-strong bg-card'));

  it("sits inside the sheet at the top: one wrapping row over an inset hairline, Table / CSV first in source and on screen", () => {
    expect(header).toMatch(
      /^<div class="overflow-hidden[^"]*"><div class="relative flex flex-wrap items-center justify-between gap-3 [^"]*after:inset-x-4 after:bottom-0 after:h-px after:bg-border/,
    );
    // The switch is the bar's first child (no order trick) and keeps its own props: the same radio group and values.
    expect(header).toMatch(/after:content-\[&#x27;&#x27;\]"><div role="radiogroup" aria-label="Show the draft grid as"/);
    expect(html).not.toContain("order-first");
    // The sheet's name stays above the sheet.
    expect(html.indexOf("Invented sample, to show the format")).toBeLessThan(html.indexOf("overflow-hidden rounded-lg border border-border-strong"));
  });

  /** The opening tag's attributes and classes of the button that reads `label`. */
  function buttonOf(markup: string, label: string): { attrs: string; classes: string[] } {
    const attrs = markup.match(new RegExp(`<button([^>]*)>${label}(<svg|</button>)`))?.[1] ?? "";
    return { attrs, classes: (attrs.match(/class="([^"]*)"/)?.[1] ?? "").split(" ") };
  }

  it("holds the template and the sample as ghost text actions in the name row, and the bar's one filled control, the submit, after the switch, with nothing outlined", () => {
    // "Download a template": a ghost text action, 15px semibold ink, no border, 44px, underlined on hover, with the download glyph.
    const template = buttonOf(nameRow, "Download a template");
    expect(template.attrs).toContain('data-variant="ghost"');
    expect(template.attrs).toContain('data-size="default"');
    expect(template.attrs).toContain('type="button"');
    expect(template.classes).toEqual(
      expect.arrayContaining(["h-11", "min-h-11", "text-[0.9375rem]", "font-semibold", "text-foreground", "hover:underline", "border-transparent"]),
    );
    expect(template.classes).not.toContain("border-border-strong");
    expect(template.classes.join(" ")).not.toMatch(/primary|after:-inset-y-1|\bh-9\b/);
    expect(nameRow).toMatch(/>Download a template<svg[^>]*class="lucide lucide-download/);
    // "Check an invented sample": the same ghost text action as the template (no border, outline or fill at
    // rest, 15px semibold ink, 44px, underlined on hover), 20px from it word to word (8px padding, 4px apart).
    const sample = buttonOf(nameRow, "Check an invented sample");
    expect(sample.attrs).toContain('data-variant="ghost"');
    expect(sample.attrs).toContain('data-size="default"');
    expect(sample.attrs).toContain('type="button"');
    expect(sample.classes).toEqual(
      expect.arrayContaining(["h-11", "min-h-11", "text-[0.9375rem]", "font-semibold", "text-foreground", "hover:underline", "hover:bg-transparent", "border-transparent"]),
    );
    for (const name of ["px-2", "decoration-1", "underline-offset-4", "hover:bg-transparent", "hover:underline"]) {
      expect(template.classes).toContain(name);
      expect(sample.classes).toContain(name);
    }
    expect(sample.classes).toContain("ml-1");
    expect(sample.classes).not.toContain("border-border-strong");
    expect(sample.classes).not.toContain("border-[1.5px]");
    expect(sample.classes).not.toContain("border-foreground");
    expect(sample.classes.join(" ")).not.toMatch(/primary|(^|\s)bg-(?!transparent)/);
    // Neither utility is in the sheet's bar any more, and neither is boxed or filled in the name row.
    expect(header).not.toContain("Download a template");
    expect(header).not.toContain("Check an invented sample");
    expect(nameRow).not.toMatch(/data-variant="(default|ink|outline)"/);
    expect(nameRow).not.toMatch(/border-border-strong|[\s"]bg-(?!transparent)/);
    // Source order in the name row: the label, then the template, then the sample.
    const inRow = (needle: string) => nameRow.indexOf(needle);
    expect(inRow(">Draft grid<")).toBeGreaterThanOrEqual(0);
    expect(inRow(">Draft grid<")).toBeLessThan(inRow(">Download a template"));
    expect(inRow(">Download a template")).toBeLessThan(inRow(">Check an invented sample"));
    // "Check the grid": the submit of the same form, the one solid ink button, 44px, full width on a phone.
    const submit = buttonOf(header, "Check the grid");
    expect(submit.attrs).toContain('type="submit"');
    expect(submit.attrs).toContain('data-variant="default"');
    expect(submit.attrs).toContain('data-size="default"');
    expect(submit.classes).toContain("h-11");
    expect(submit.classes).toContain("max-sm:w-full");
    expect(submit.classes.join(" ")).not.toMatch(/primary|destructive|(^|\s)order-/);
    // Source order in the bar: the switch, then the check.
    const at = (needle: string) => header.indexOf(needle);
    expect(at('aria-label="Show the draft grid as"')).toBeGreaterThan(0);
    expect(at('aria-label="Show the draft grid as"')).toBeLessThan(at(">Check the grid"));
    // The only solid ink button in the header is the submit, and nothing is outlined.
    expect(header.match(/data-variant="(default|ink)"/g)).toHaveLength(1);
    expect(header).not.toContain('data-variant="outline"');
    // (The frame's own edge is border-strong; inside it, no control is outlined. Round 34: the shared switch's thumb
    // carries its own 1px border-strong edge, pinned in segmented-control.test.ts, so the switch is left out here.)
    const bar = header.slice(header.indexOf(">") + 1);
    const outsideSwitch = bar.slice(0, bar.indexOf('<div role="radiogroup"')) + bar.slice(bar.indexOf("<button"));
    expect(bar.indexOf('<div role="radiogroup"')).toBeGreaterThan(-1);
    expect(bar.indexOf('<div role="radiogroup"')).toBeLessThan(bar.indexOf("<button"));
    expect(outsideSwitch).toContain(">Check the grid<");
    expect(outsideSwitch).not.toContain("border-border-strong");
    expect(header).not.toContain("border-[1.5px]");
    expect(header).not.toContain("&middot;");
    // No control was added: the bar holds the check and the two tabs, the name row the two utilities, nothing else.
    expect(header.match(/<button/g)).toHaveLength(1);
    expect(header.match(/<input type="radio"/g)).toHaveLength(2);
    expect(nameRow.match(/<button/g)).toHaveLength(2);
    expect(nameRow).not.toMatch(/<(input|select|textarea|a)\b/);
    expect(header).not.toContain(">Clear<");
  });

  it("sets the two utilities as one group at the right of the name from sm, on the name's line from xl or on a line of its own under it, and on a phone on their own lines at the left", () => {
    const row =
      nameRow.match(/^<label[^>]*>Draft grid<\/label>(?:<span[^>]*>[^<]*<\/span>)?<\/div><div class="([^"]*)">(?:<span aria-hidden="true"[^>]*>[^<]*<\/span>)?<button/)?.[1] ?? "";
    // The 44px hit areas pulled 10px into the row above and below (its 12px foot keeps them clear of the frame),
    // the last word's edge on the column's edge. Round 35: the group grows to fill its line and sets the actions
    // right, so its own box never moves when the published day's action arrives (verify P9); below xl it has a
    // line of its own, wide enough for all three.
    expect(row.split(" ")).toEqual(
      expect.arrayContaining(["flex", "min-w-0", "flex-[1_0_auto]", "flex-wrap", "items-center", "justify-end", "max-xl:basis-full", "max-sm:justify-start", "sm:-my-2.5", "sm:-mr-2"]),
    );
    expect(row.split(" ")).not.toContain("ml-auto");
    const outer = html.match(/<div class="([^"]*)"><div class="flex min-w-0 flex-wrap items-baseline gap-x-2\.5 gap-y-0\.5"><label/)?.[1] ?? "";
    // The pair wraps whole under the name where the row is too narrow, 10px under it so no hit area reaches its text.
    expect(outer.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-wrap", "items-start", "gap-x-6", "sm:gap-y-2.5"]));
    expect(html).toMatch(/<div class="min-w-0 pb-2 sm:pb-3 lg:col-span-2 lg:col-start-1 lg:row-start-1"><div class="flex min-w-0 flex-wrap/);
    // On a phone each utility's words start on the name's left edge.
    for (const label of ["Download a template", "Check an invented sample"]) expect(buttonOf(nameRow, label).classes).toContain("max-sm:-ml-2");
  });

  it("puts Clear alone on a quiet muted text row under the sheet, 44px, outside its surface", () => {
    const foot = html.match(/<div class="mt-3 flex">(<button[\s\S]*?<\/button>)<\/div>/)?.[1] ?? "";
    expect(foot.match(/<button/g)).toHaveLength(1);
    const clear = buttonOf(foot, "Clear");
    expect(clear.attrs).toContain('data-variant="ghost"');
    expect(clear.attrs).toContain('type="button"');
    expect(clear.classes).toEqual(expect.arrayContaining(["min-h-11", "text-[0.9375rem]", "text-muted-foreground", "hover:underline"]));
    expect(clear.classes).not.toContain("text-foreground");
    expect(clear.classes.join(" ")).not.toMatch(/border-border-strong|primary/);
    // It follows the sheet's surface (the textarea is the surface's last field), and comes before the grid's help.
    expect(html.indexOf('<div class="mt-3 flex">')).toBeGreaterThan(html.indexOf("</textarea>"));
    expect(html.indexOf('<div class="mt-3 flex">')).toBeLessThan(html.indexOf("One set per line"));
  });
});

describe("selecting a rule break", () => {
  if (!sample.ok) throw new Error("the sample should read");
  const report = sample.report;
  const rows = (html: string) => html.match(/<tr [^>]*data-row="\d+"[^>]*>/g) ?? [];
  const selected = (html: string) => rows(html).filter((row) => row.includes("data-selected"));

  it("marks exactly the rows the break names with the wash inside a 1px ink edge, never raspberry, and no left stripe", () => {
    const html = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID, selection: { rows: [3, 4], nonce: 1 } }));
    const marked = selected(html);
    expect(marked.map((row) => row.match(/data-row="(\d+)"/)?.[1])).toEqual(["3", "4"]);
    for (const row of marked) {
      expect(row).toContain("bg-accent");
      expect(row).toContain("[&amp;&gt;td]:border-foreground");
      expect(row).not.toContain("primary");
      expect(row).not.toContain("border-l-4");
    }
    // Every other row has no edge and no wash.
    for (const row of rows(html).filter((tag) => !tag.includes("data-selected"))) {
      expect(row).not.toContain("bg-accent");
      expect(row).not.toContain("border-foreground");
    }
    expect(html).not.toMatch(/bg-primary\/10|border-primary/);
    // Twelve rows still show when every named row is among them.
    expect(rows(html)).toHaveLength(12);
  });

  it("expands the table to every row when a named row is past the first 12", () => {
    const curfew = report.breaks.find((item) => item.rule === 4);
    expect(curfew).toBeDefined();
    const at = report.sets.findIndex((set) => set.row === curfew!.rows[0]);
    expect(at).toBeGreaterThanOrEqual(12);
    const html = renderToStaticMarkup(
      createElement(GridTable, { grid: SAMPLE_GRID, selection: { rows: curfew!.rows, nonce: 1 } }),
    );
    expect(rows(html)).toHaveLength(report.sets.length);
    expect(selected(html)).toHaveLength(curfew!.rows.length);
    expect(text(html)).toContain("Show fewer rows");
    // With no selection the table folds at 12.
    const folded = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID }));
    expect(rows(folded)).toHaveLength(12);
    expect(selected(folded)).toHaveLength(0);
  });

  it("makes each break's heading a button that says whether it is selected", () => {
    const render = (selectedBreak: string | null) =>
      renderToStaticMarkup(
        createElement(CheckResults, {
          report,
          decisions: new Map(),
          onDecide: () => {},
          showAll: false,
          onShowAll: () => {},
          nonce: 1,
          onRow: () => {},
          selectedBreak,
          onSelectBreak: () => {},
        }),
      );
    const none = render(null);
    const headings = none.match(/<h3[^>]*><button[^>]*aria-pressed="(true|false)"[^>]*>/g) ?? [];
    expect(headings).toHaveLength(report.breaks.length);
    expect(headings.every((heading) => heading.includes('aria-pressed="false"'))).toBe(true);
    const id = (none.match(/<h3[^>]*><button[^>]*>/) ?? [""])[0];
    expect(id).not.toBe("");
    // The pressed heading takes the wash and an ink outline, never raspberry.
    const pressed = render(breakDecisionId(report.breaks[0], report.sets));
    const on = pressed.match(/<h3[^>]*><button[^>]*aria-pressed="true"[^>]*>/)?.[0] ?? "";
    expect(on).toContain("aria-pressed:bg-accent");
    expect(on).toContain("aria-pressed:not-focus-visible:outline-foreground");
    expect(on).not.toContain("primary");
    // Row references: visible 12px tabular-figure buttons on an 8px corner with a control edge, 44px to the pointer.
    const ref = none.match(/<button[^>]*>row \d+<\/button>/)?.[0] ?? "";
    expect(ref).toContain("font-mono text-xs");
    expect(ref).toContain("border border-border-strong");
    expect(ref).toContain("hover:bg-accent");
    expect(ref).not.toContain("bg-foreground/");
    expect(ref).toContain("rounded-sm");
    expect(ref).toContain("after:-inset-y-2");
    expect(ref).not.toContain("underline");
  });

  it("gives every break in the invented sample a next step, built from the acts on its rows", () => {
    expect(report.breaks.map((item) => item.rule).sort()).toEqual([1, 3, 4, 5]);
    for (const item of report.breaks) {
      const line = nextStep(item, report);
      expect(line).not.toBe("");
      const acts = item.rows.map((row) => report.sets.find((set) => set.row === row)!.act);
      expect(acts.some((act) => line.includes(act))).toBe(true);
    }
    const curfew = report.breaks.find((item) => item.rule === 4)!;
    expect(nextStep(curfew, report)).toBe("End Rustic Harbour by the 00:00 curfew");
  });
});

describe("numbered rule breaks, tied to their rows", () => {
  if (!sample.ok) throw new Error("the sample should read");
  const report = sample.report;
  const html = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
  const rowTags = (markup: string) => [...markup.matchAll(/<tr [^>]*data-row="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)];
  const discs = (markup: string) => [...markup.matchAll(/data-break-disc="(\d+)"/g)].map((m) => Number(m[1]));
  /** The numbers a row's first cell carries, as discs and as its screen-reader words. */
  function firstCell(cells: string): { discs: number[]; words: string } {
    const cell = cells.slice(0, cells.indexOf("</td>"));
    return { discs: discs(cell), words: text(cell) };
  }
  function expected(row: number): number[] {
    return report.breaks.flatMap((item, index) => (item.rows.includes(row) ? [index + 1] : []));
  }

  it("gives each break heading its numbered disc, in the results and the right column alike", () => {
    expect(report.breaks.length).toBe(4);
    // The results: each h3 heading button starts with the disc of its number.
    const headings = html.match(/<h3[^>]*><button[^>]*>[\s\S]*?<\/button><\/h3>/g) ?? [];
    expect(headings).toHaveLength(report.breaks.length);
    headings.forEach((heading, index) => {
      expect(discs(heading)).toEqual([index + 1]);
      expect(heading).toContain(`<span class="sr-only">Rule break ${index + 1}. </span>`);
      expect(heading).toMatch(/<svg aria-hidden="true"[^>]*width="20" height="20"/);
    });
    // The right column's list carries the same numbers, in the same order.
    const list = html.slice(html.indexOf('aria-label="Rule breaks"'), html.indexOf("Sets that share time"));
    expect(discs(list)).toEqual([1, 2, 3, 4]);
    // Discs are inline SVG circles, never a rounded-full box: ink with the number in paper (round 34: a rule break is
    // ink, never the raspberry of shared time).
    expect(html).toMatch(/<circle[^>]*fill="var\(--foreground\)"/);
    const discMarks = html.match(/<svg aria-hidden="true"[^>]*data-break-disc="\d+"[^>]*>[\s\S]*?<\/svg>/g) ?? [];
    expect(discMarks.length).toBeGreaterThan(0);
    for (const disc of discMarks) {
      expect(disc).toMatch(/<circle [^>]*fill="var\(--foreground\)"/);
      expect(disc).toMatch(/<text [^>]*fill="var\(--background\)"/);
      expect(disc).not.toContain("--primary");
    }
  });

  it("marks every row a break names with the same number in its gutter, never in the act cell, past row 12 after Show all rows", () => {
    const folded = rowTags(html);
    // The page's table, with the sample's result on show: the first 12 and every flagged row.
    const flaggedRows = new Set(report.breaks.flatMap((item) => item.rows));
    expect(folded).toHaveLength(12 + report.sets.slice(12).filter((set) => flaggedRows.has(set.row)).length);
    const all = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID, selection: { rows: report.sets.map((set) => set.row), nonce: 1 }, marks: breakMarks(report.breaks) }));
    const rows = rowTags(all);
    expect(rows).toHaveLength(report.sets.length);
    let named = 0;
    for (const [, row, cells] of rows) {
      const want = expected(Number(row));
      const got = firstCell(cells);
      expect(got.discs).toEqual(want);
      for (const n of want) expect(got.words).toContain(`Rule break ${n}.`);
      // The act cell (the second) carries no disc any more.
      const act = cells.slice(cells.indexOf("</td>") + 5);
      expect(discs(act.slice(0, act.indexOf("</td>")))).toEqual([]);
      if (want.length > 0) named += 1;
    }
    expect(named).toBe(new Set(report.breaks.flatMap((item) => item.rows)).size);
    // The page's own table, folded at 12, numbers the rows it shows the same way.
    for (const [, row, cells] of folded) expect(firstCell(cells).discs).toEqual(expected(Number(row)));
    // A row named past the first 12 is in the full table with its number.
    const late = report.breaks.flatMap((item) => item.rows).filter((row) => report.sets.findIndex((set) => set.row === row) >= 12);
    expect(late.length).toBeGreaterThan(0);
    // No filter row and no switch above the table: the only radio group on the sheet is Table / CSV.
    expect(html.match(/role="radiogroup"/g)).toHaveLength(1);
    expect(html).not.toContain("Rows with rule breaks");
  });

  it("lets Esc clear the selected break, unless something on top already took the key", () => {
    expect(escapeClears({ key: "Escape", defaultPrevented: false })).toBe(true);
    expect(escapeClears({ key: "Escape", defaultPrevented: true })).toBe(false);
    expect(escapeClears({ key: "Enter", defaultPrevented: false })).toBe(false);
    // With no selection the table marks nothing.
    const none = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID, selection: null }));
    expect(none).not.toContain("data-selected");
    expect(none).not.toContain("bg-accent");
  });

  it("shows both numbers on a row two breaks name", () => {
    const marks = breakMarks([{ rows: [3, 4] }, { rows: [4, 9] }]);
    expect(marks.get(4)).toEqual([1, 2]);
    const markup = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID, marks }));
    const row = rowTags(markup).find(([, n]) => n === "4");
    expect(row).toBeDefined();
    const cell = firstCell(row![2]);
    expect(cell.discs).toEqual([1, 2]);
    expect(cell.words).toContain("Rule break 1. Rule break 2.");
    // Rows named once carry one number; a row named by none carries none.
    expect(firstCell(rowTags(markup).find(([, n]) => n === "3")![2]).discs).toEqual([1]);
    expect(firstCell(rowTags(markup).find(([, n]) => n === "2")![2]).discs).toEqual([]);
  });

  it("draws the editor as a surface and the findings beside it open on paper, with no fill on the toolbar and no alpha colour anywhere", () => {
    // The findings open under one 1px hairline, as the home receipt: no box, no card fill, no side padding.
    expect(html).toMatch(/<section aria-label="Checked" class="border-t border-border pt-5 sm:pt-6">/);
    const checked = html.match(/<section aria-label="Checked" class="([^"]*)"/)?.[1] ?? "";
    expect(checked).not.toMatch(/rounded-lg|border-surface-edge|bg-card|(^|\s)p-\d/);
    const bar = html.slice(html.indexOf("Check an invented sample") - 400, html.indexOf('role="radiogroup"'));
    expect(bar).not.toMatch(/class="[^"]*(^|\s)bg-[^"]*">(Check an invented sample|Clear|Download a template)/);
    expect(html).not.toMatch(/(bg|border|text)-(foreground|primary|warning|success)\/(\[|\d)/);
  });
});

describe("flagged rows on arrival", () => {
  if (!sample.ok) throw new Error("the sample should read");
  const report = sample.report;
  const html = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
  const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
  const shownRows = (markup: string) => [...markup.matchAll(/<tr [^>]*data-row="(\d+)"/g)].map((m) => Number(m[1]));
  const cited = [...new Set(report.breaks.flatMap((item) => item.rows))].sort((a, b) => a - b);

  it("(a) shows the first 12 rows and every row a break cites, in source order, with their discs", () => {
    expect(cited).toEqual([11, 17, 18, 19, 21, 22, 26]);
    const rows = shownRows(table);
    const first12 = report.sets.slice(0, 12).map((set) => set.row);
    expect(rows).toEqual([...first12, 17, 18, 19, 21, 22, 26]);
    for (const row of cited) {
      const cells = table.match(new RegExp(`<tr [^>]*data-row="${row}"[^>]*>([\\s\\S]*?)</tr>`))?.[1] ?? "";
      expect(cells).toContain("data-break-disc");
    }
  });

  it("(b) puts one plain muted line in the table for each run of rows left out, with its range", () => {
    const gaps = [...table.matchAll(/<tr data-gap="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)];
    expect(gaps.map((gap) => gap[1])).toEqual(["14-16", "20-20", "23-25"]);
    // The words, once, as assistive technology reads them (the gutter's ellipsis is aria-hidden).
    const spoken = (cells: string) => text(cells.replace(/<span aria-hidden="true">[^<]*<\/span>/g, ""));
    expect(gaps.map((gap) => spoken(gap[2]))).toEqual(["Rows 14 to 16 not shown", "Row 20 not shown", "Rows 23 to 25 not shown"]);
    for (const [, , cells] of gaps) {
      // An elided row of the ledger: the gutter holds a vertical ellipsis (decorative, centred, muted), then one
      // cell across the other five columns holds the words, set left at the Act column's edge in 13px muted.
      // No side hairlines, no card patch; not a control and not focusable.
      const tds = [...cells.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];
      expect(tds).toHaveLength(2);
      const [gutter, words] = tds;
      expect(gutter[1]).not.toMatch(/colSpan/i);
      expect(gutter[1]).toMatch(/class="[^"]*\btext-center\b[^"]*\btext-muted-foreground\b/);
      expect(gutter[2]).toBe('<span aria-hidden="true">⋮</span>');
      expect(words[1]).toMatch(/colSpan="5"/i);
      expect(words[1]).toMatch(/class="[^"]*text-\[0\.8125rem\] leading-5 text-muted-foreground"/);
      expect(words[1]).not.toMatch(/text-center|text-right|(^|\s)pl-/);
      expect(words[2]).toMatch(/^Rows? \d+( to \d+)? not shown$/);
      expect(cells).not.toMatch(/bg-card|top-1\/2|absolute inset-x/);
      expect(cells).not.toMatch(/<(button|a|input)\b|tabindex|hover:|role=/i);
    }
    // Every gap row is plain text: no tabindex and no role on the row itself.
    for (const row of table.match(/<tr data-gap="[^"]+"[^>]*>/g) ?? []) expect(row).not.toMatch(/tabindex|role=/i);
    // The row just above an elided row keeps its own hairline: the elided row is a row of the ledger.
    expect(table).not.toMatch(/<tr [^>]*data-row="13"[^>]*class="[^"]*\[&amp;&gt;td\]:after:hidden/);
    // An elided row gives its hairline way to the stage rule under it (rows 17 and 21 open new stages); the
    // last one, over row 26 on the same stage, keeps it.
    expect(table).toMatch(/<tr data-gap="14-16" class="[^"]*\[&amp;&gt;td\]:after:hidden/);
    expect(table).toMatch(/<tr data-gap="20-20" class="[^"]*\[&amp;&gt;td\]:after:hidden/);
    expect(table).not.toMatch(/<tr data-gap="23-25" class="[^"]*\[&amp;&gt;td\]:after:hidden/);
    // In source order: each gap sits between the rows around it.
    expect(table.indexOf('data-row="13"')).toBeLessThan(table.indexOf('data-gap="14-16"'));
    expect(table.indexOf('data-gap="14-16"')).toBeLessThan(table.indexOf('data-row="17"'));
    expect(table.indexOf('data-gap="23-25"')).toBeLessThan(table.indexOf('data-row="26"'));
  });

  it("(c) says in the footer which rows the table shows, about the table view only", () => {
    const footer = text(html.slice(html.indexOf("Showing <span"), html.indexOf("Show all rows</button>") + "Show all rows".length));
    expect(footer).toBe("Showing 18 of 25 rows: the first 12 and every flagged row Show all rows");
    // Drawn like the fold lines: centred on an inset hairline, the words on the card.
    expect(html).toMatch(
      /<div class="relative flex min-w-0 justify-center px-4 py-3\.5"><span aria-hidden="true" class="absolute inset-x-4 top-1\/2 h-px bg-border"><\/span><div class="relative [^"]*bg-card px-3[^"]*"><p class="text-\[0\.8125rem\] text-muted-foreground">Showing <span/,
    );
    expect(footer).not.toMatch(/filtered|only|subset|partial/i);
    // "Show all rows" is the same text action, unchanged.
    expect(html).toMatch(/<button type="button" class="[^"]*" aria-expanded="false">Show all rows<\/button>/);
  });

  it("(d) with no result, or a result with no breaks, shows the first 12 only, as before", () => {
    const marks = breakMarks(report.breaks);
    const html = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID, marks }));
    expect(shownRows(html)).toEqual(report.sets.slice(0, 12).map((set) => set.row));
    expect(html).not.toContain("data-gap");
    expect(text(html)).toMatch(/Showing 12 of \d+ rows Show all rows/);
    const none = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID, marks: new Map(), flagged: true }));
    expect(shownRows(none)).toHaveLength(12);
    expect(text(none)).toMatch(/Showing 12 of 25 rows Show all rows/);
    expect(text(none)).not.toContain("flagged row");
    // The page with the sample pasted and not yet checked has no result to show.
    const unchecked = renderToStaticMarkup(
      createElement(CheckTool, {
        initial: { grid: SAMPLE_GRID, changeover: SAMPLE_SETTINGS.changeover, curfew: SAMPLE_SETTINGS.curfew, pairs: SAMPLE_SETTINGS.pairs },
      }),
    );
    expect(unchecked).not.toContain("flagged row");
  });

  it("keeps the table folded when a selected break's rows are already in view, and still opens it for one that is not", () => {
    const marks = breakMarks(report.breaks);
    const curfew = report.breaks.find((item) => item.rule === 4)!;
    const kept = renderToStaticMarkup(
      createElement(GridTable, { grid: SAMPLE_GRID, marks, flagged: true, selection: { rows: curfew.rows, nonce: 1 } }),
    );
    expect(shownRows(kept)).toHaveLength(18);
    expect(kept).toMatch(/<tr [^>]*data-row="26"[^>]*data-selected=""/);
    const opened = renderToStaticMarkup(
      createElement(GridTable, { grid: SAMPLE_GRID, marks, flagged: true, selection: { rows: [24], nonce: 1 } }),
    );
    expect(shownRows(opened)).toHaveLength(report.sets.length);
  });
});

describe("each rule break, tied to its rows and its repair", () => {
  if (!sample.ok) throw new Error("the sample should read");
  const report = sample.report;
  const before = JSON.stringify(report.breaks);
  const page = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
  const list = page.slice(page.indexOf('aria-label="Rule breaks"'), page.indexOf("Sets that share time"));
  const items = list.split('<li class="py-2.5">').slice(1);
  const results = renderToStaticMarkup(
    createElement(CheckResults, {
      report,
      decisions: new Map(),
      onDecide: () => {},
      showAll: false,
      onShowAll: () => {},
      nonce: 1,
      onRow: () => {},
      onSelectBreak: () => {},
    }),
  );
  const ascending = (rows: readonly number[]) => [...rows].sort((a, b) => a - b);

  it("has a break in the sample whose rows the check lists out of order, so the sort is tested", () => {
    expect(report.breaks.some((item) => item.rows.some((row, at) => at > 0 && row < item.rows[at - 1]))).toBe(true);
  });

  it("lists each break's rows in ascending row order in the compact list beside the grid", () => {
    expect(items).toHaveLength(report.breaks.length);
    items.forEach((item, index) => {
      // The row lines only: the strip under them labels its lanes "row N" too.
      const lines = item.includes("data-break-strip") ? item.slice(0, item.indexOf("data-break-strip")) : item;
      const shown = [...lines.matchAll(/>row (\d+)<\/span>/g)].map((m) => Number(m[1]));
      expect(shown).toEqual(ascending(report.breaks[index].rows));
    });
  });

  it("lists each break's row buttons in ascending row order in the results", () => {
    const blocks = results.split("<h3").slice(1);
    expect(blocks).toHaveLength(report.breaks.length);
    blocks.forEach((block, index) => {
      const shown = [...block.matchAll(/<button[^>]*>row (\d+)<\/button>/g)].map((m) => Number(m[1]));
      expect(shown).toEqual(ascending(report.breaks[index].rows));
    });
  });

  it("sorts a copy: the result data is unchanged after rendering", () => {
    expect(JSON.stringify(report.breaks)).toBe(before);
  });

  it("shows under each break's heading the same Next line the results print, 14px with Next: muted", () => {
    items.forEach((item, index) => {
      const line = nextStep(report.breaks[index], report);
      expect(line).not.toBe("");
      const next = item.match(/<p class="([^"]*)"><span class="text-muted-foreground">Next: <\/span>([^<]*)<\/p>/);
      expect(next?.[2]).toBe(line);
      expect(next?.[1]).toContain("text-sm");
      // Under the heading button, above the rows.
      expect(item.indexOf("Next: ")).toBeGreaterThan(item.indexOf("</button>"));
      expect(item.indexOf("Next: ")).toBeLessThan(item.indexOf(">row "));
      // The results print the same words.
      expect(text(results)).toContain(`Next: ${line}`);
    });
  });
});

describe("the table's row-number gutter, column gap and stage breaks", () => {
  if (!sample.ok) throw new Error("the sample should read");
  const report = sample.report;
  const page = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
  const table = (markup: string) => markup.slice(markup.indexOf("<table"), markup.indexOf("</table>"));
  const rowTags = (markup: string) => [...markup.matchAll(/<tr [^>]*data-row="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)];
  const cellsOf = (cells: string) => cells.match(/<td[\s\S]*?<\/td>/g) ?? [];
  const cellAt = (cells: string, at: number) => cellsOf(cells)[at] ?? "";
  const opening = (cell: string) => cell.slice(0, cell.indexOf(">"));
  const discs = (markup: string) => [...markup.matchAll(/data-break-disc="(\d+)"/g)].map((m) => Number(m[1]));
  /** The gutter's visible text: its markup less the discs and the screen-reader words. */
  const gutterText = (gutter: string) =>
    text(gutter.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<span class="sr-only">[^<]*<\/span>/g, ""));

  it("prints each shown row's grid number, the number the results cite, as plain 12px muted tabular figures set right", () => {
    const rows = rowTags(table(page));
    expect(rows).toHaveLength(18);
    for (const [, row, cells] of rows) {
      const gutter = cellAt(cells, 0);
      expect(gutterText(gutter)).toBe(row);
      const open = opening(gutter);
      expect(open).toMatch(/font-mono text-xs/);
      for (const name of ["tabular-nums", "text-right", "whitespace-nowrap", "text-muted-foreground"]) expect(open).toContain(name);
      // Text, not a control: no button, link, tab stop or role.
      expect(gutter).not.toMatch(/<(button|a|input)\b|tabindex|role=/i);
    }
    // The results cite the same numbers ("row 17", "row 21").
    for (const row of report.breaks[0].rows) expect(rows.map(([, n]) => Number(n))).toContain(row);
    // The header cell over the gutter is empty to the eye and says "Row" to assistive technology.
    const head = table(page).slice(0, table(page).indexOf("</thead>"));
    const ths = head.match(/<th[ >][\s\S]*?<\/th>/g) ?? [];
    expect(ths).toHaveLength(6);
    expect(ths[0]).toMatch(/^<th scope="col" class="[^"]*"><span class="sr-only">Row<\/span><\/th>$/);
    expect(ths.slice(1).map((th) => text(th))).toEqual(["Act", "Stage", "Start", "End", "Locked"]);
  });

  it("turns the number ink with the rest of a selected break's row, inside the same ink edge", () => {
    const html = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID, selection: { rows: [3], nonce: 1 } }));
    for (const [, row, cells] of rowTags(html)) {
      const open = opening(cellAt(cells, 0));
      if (row === "3") {
        expect(open).toContain("text-foreground");
        expect(open).not.toContain("text-muted-foreground");
        // The gutter is the edged row's first cell: its left edge is the row's.
        expect(open).toContain("border-l");
      } else {
        expect(open).toContain("text-muted-foreground");
      }
    }
  });

  it("prints a row number of 100 or more in full, on one line", () => {
    // A grid holds at most 60 sets, so a row past 99 sits below blank lines; its number is still its line's.
    const blank = Array.from({ length: 109 }, () => "");
    const grid = ["act,stage,start,end,locked", ...blank, "Late Act,Main,18:00,19:00,", "Later Act,Main,19:30,20:00,"].join("\n");
    const parsed = parseGrid(grid);
    if (!parsed.ok) throw new Error("the grid should read");
    expect(parsed.sets.map((set) => set.row)).toEqual([111, 112]);
    const html = renderToStaticMarkup(createElement(GridTable, { grid }));
    const row = rowTags(html).find(([, n]) => n === "111");
    expect(row).toBeDefined();
    const gutter = cellAt(row![2], 0);
    expect(gutterText(gutter)).toBe("111");
    expect(opening(gutter)).toContain("whitespace-nowrap");
    // The track is at least three digits wide at every width: 3ch on a phone, two discs and 3ch from sm.
    expect(gutter).toContain("min-w-[max(1rem,3ch)]");
    expect(gutter).toContain("sm:min-w-[calc(2.5rem+3ch)]");
  });

  it("draws every disc of a row in three breaks, wrapping inside the gutter, and says all three", () => {
    const marks = breakMarks([{ rows: [3] }, { rows: [3, 5] }, { rows: [3] }]);
    const html = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID, marks }));
    const row = rowTags(html).find(([, n]) => n === "3")!;
    const gutter = cellAt(row[2], 0);
    const act = cellAt(row[2], 1);
    expect(discs(gutter)).toEqual([1, 2, 3]);
    expect(discs(act)).toEqual([]);
    expect(text(gutter)).toContain("Rule break 1. Rule break 2. Rule break 3.");
    // Two side by side from sm (a 36px box), the third on a further line; stacked above the number on a phone.
    const box = gutter.match(/<span class="([^"]*)"><svg/)?.[1] ?? "";
    expect(box.split(" ")).toEqual(expect.arrayContaining(["flex-col", "sm:w-9", "sm:flex-row", "sm:flex-wrap", "sm:justify-end"]));
    // Nothing clips or hides one, and the discs stay inline SVG, never a rounded-full box.
    expect(gutter).not.toMatch(/overflow-hidden|truncate|line-clamp|rounded-full/);
    expect(gutter.match(/<svg aria-hidden="true"[^>]*width="16" height="16"/g)).toHaveLength(3);
  });

  it("draws a stage break as a control-edge separator exactly where the shown rows change stage", () => {
    const body = table(page);
    const rows = rowTags(body);
    const stageOf = new Map(report.sets.map((set) => [set.row, set.stage]));
    const shown = rows.map(([, n]) => Number(n));
    const expected = shown.filter((row, at) => at > 0 && stageOf.get(row) !== stageOf.get(shown[at - 1]));
    // The invented sample, folded: Riverside at 9, Grove at 17 (across the fold line), Night Tent at 21.
    expect(expected).toEqual([9, 17, 21]);
    rows.forEach(([whole, row, cells], index) => {
      const starts = expected.includes(Number(row));
      expect(whole.includes("data-stage-start")).toBe(starts);
      for (const cell of cellsOf(cells)) expect(opening(cell).includes("before:bg-border-strong")).toBe(starts);
      // The row right above a stage break (no fold line between) drops its own hairline, so the two never double up.
      const next = rows[index + 1];
      if (next && expected.includes(Number(next[1]))) {
        const between = body.slice(body.indexOf(whole), body.indexOf(next[0]));
        if (!between.includes("data-gap")) expect(whole).toContain("[&amp;&gt;td]:after:hidden");
      }
    });
    // Only the separator changes: no fill or tint on those rows.
    for (const [whole] of rows.filter(([, n]) => expected.includes(Number(n)))) expect(whole).not.toMatch(/(^|[\s"])bg-/);
    // Every row shown: the stage starts the whole sample has.
    const parsed = parseGrid(SAMPLE_GRID);
    if (!parsed.ok) throw new Error("the sample should read");
    expect([...stageStartRows(foldedLines(parsed.sets, null, false))]).toEqual([9, 15, 21]);
  });

  it("spans every column, the gutter's too, with each elided row", () => {
    const body = table(page);
    const columns = (body.slice(0, body.indexOf("</thead>")).match(/<th\b/g) ?? []).length;
    expect(columns).toBe(6);
    const gaps = [...body.matchAll(/<tr data-gap="[^"]+"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    expect(gaps).toHaveLength(3);
    for (const cells of gaps) {
      // The gutter's own cell, then one cell across the rest.
      const spans = [...cells.matchAll(/<td([^>]*)>/g)].map((m) => Number(m[1].match(/colSpan="(\d+)"/i)?.[1] ?? 1));
      expect(spans).toEqual([1, columns - 1]);
    }
  });

  it("keeps End and Locked apart: 16px between them on a phone and 24px from sm", () => {
    const [, , cells] = rowTags(table(page)).find(([, n]) => n === "6")!;
    const list = cellsOf(cells);
    const classes = (cell: string) => (cell.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
    // End's right padding (8 / 12) plus Locked's left padding (8 / 12).
    expect(classes(list[4])).toEqual(expect.arrayContaining(["pr-2", "sm:pr-3"]));
    expect(classes(list[5])).toEqual(expect.arrayContaining(["pl-2", "sm:pl-3", "pr-2", "sm:pr-2"]));
    const head = table(page).slice(0, table(page).indexOf("</thead>"));
    const locked = head.match(/<th scope="col" class="([^"]*)">Locked<\/th>/)?.[1] ?? "";
    expect(locked.split(" ")).toEqual(expect.arrayContaining(["pl-2", "sm:pl-3"]));
  });

  it("numbers the CSV view's lines exactly as the table numbers its rows", () => {
    const parsed = parseGrid(SAMPLE_GRID);
    if (!parsed.ok) throw new Error("the sample should read");
    const lines = SAMPLE_GRID.split("\n");
    for (const set of parsed.sets) expect(lines[set.row - 1].startsWith(`${set.act},${set.stage},`)).toBe(true);
    // The CSV gutter prints 1..N, one number per line of the text, so each set's line number is its table row.
    // (Round 37: the numbers are hidden one by one, so a skipped line's mark can be a button the gutter does not hide.)
    const gutter = page.match(/<div data-gutter="" class="shrink-0 [^"]*w-10[^"]*">([\s\S]*?)<\/div><textarea/)?.[1] ?? "";
    const numbers = [...gutter.matchAll(/<div aria-hidden="true">(\d+)<\/div>/g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(lines.map((_, at) => at + 1));
    for (const set of parsed.sets) expect(numbers[set.row - 1]).toBe(set.row);
  });

  it("sets the sheet and the results at 3fr / 2fr from lg, so the switch and the three actions share one header row", () => {
    expect(page).toContain("lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]");
  });
});

describe("the selected break's remedy row in the table", () => {
  if (!sample.ok) throw new Error("the sample should read");
  const report = sample.report;
  const marks = breakMarks(report.breaks);
  const remedyOf = (index: number): Remedy => ({
    n: index + 1,
    title: RULE_LABELS[report.breaks[index].rule],
    next: nextStep(report.breaks[index], report),
  });
  const render = (index: number, remedyFits?: boolean) =>
    renderToStaticMarkup(
      createElement(GridTable, {
        grid: SAMPLE_GRID,
        marks,
        flagged: true,
        selection: { rows: report.breaks[index].rows, nonce: 1, remedy: remedyOf(index) },
        remedyFits,
      }),
    );
  /** The body's rows in order: each grid row's number, "remedy" or "gap". */
  const order = (markup: string) =>
    [...markup.matchAll(/<tr ([^>]*)>/g)]
      .map((m) => m[1])
      .filter((attrs) => !attrs.startsWith("class=") || attrs.includes("data-"))
      .map((attrs) => attrs.match(/data-row="(\d+)"/)?.[1] ?? (attrs.includes("data-remedy-row") ? "remedy" : attrs.includes("data-gap") ? "gap" : "?"));
  const remedyRow = (markup: string) => markup.match(/<tr data-remedy-row=""[^>]*>[\s\S]*?<\/tr>/)?.[0] ?? "";

  it("puts the remedy under the last cited row when the span fits, else under the first (a pure helper)", () => {
    expect(remedyAnchor([17, 21], true)).toBe(21);
    expect(remedyAnchor([17, 21], false)).toBe(17);
    // Table order, whatever order the break lists its rows in.
    expect(remedyAnchor([22, 11], true)).toBe(22);
    expect(remedyAnchor([22, 11], false)).toBe(11);
    expect(remedyAnchor([26], true)).toBe(26);
    expect(remedyAnchor([26], false)).toBe(26);
    expect(remedyAnchor([], true)).toBeNull();
  });

  it("(case b) draws one remedy row directly after the last cited row, with the break's own rule and Next line", () => {
    report.breaks.forEach((item, index) => {
      const html = render(index);
      const rows = order(html);
      const cited = [...item.rows].sort((a, b) => a - b).map(String);
      expect(rows.filter((row) => row === "remedy")).toHaveLength(1);
      expect(rows[rows.indexOf(cited[cited.length - 1]) + 1]).toBe("remedy");
      const remedy = remedyRow(html);
      // The disc as in the gutter, the rule in 14px semibold ink, then the Next line as the results print it.
      expect(remedy).toMatch(new RegExp(`<svg aria-hidden="true"[^>]*data-break-disc="${index + 1}"[^>]*width="16" height="16"`));
      expect(remedy).toContain(`<span class="block text-sm leading-5 font-semibold break-words text-foreground">${RULE_LABELS[item.rule]}</span>`);
      expect(remedy).toMatch(/<span class="mt-0\.5 block text-sm leading-5 break-words text-foreground"><span class="text-muted-foreground">Next: <\/span>/);
      expect(text(remedy)).toBe(`${index + 1} ${RULE_LABELS[item.rule]} Next: ${nextStep(item, report)}`);
      // No other rows listed: they are all on screen with it.
      expect(remedy).not.toContain("data-remedy-others");
    });
  });

  it("(case c) draws it directly after the first cited row, with the other cited rows as plain 12px muted tabular-figure labels", () => {
    const index = report.breaks.findIndex((item) => item.rows.length > 1 && item.rule === 5);
    expect(index).toBeGreaterThanOrEqual(0);
    const item = report.breaks[index];
    const cited = [...item.rows].sort((a, b) => a - b);
    const html = render(index, false);
    const rows = order(html);
    expect(rows.filter((row) => row === "remedy")).toHaveLength(1);
    expect(rows[rows.indexOf(String(cited[0])) + 1]).toBe("remedy");
    const remedy = remedyRow(html);
    expect(remedy).toContain(
      `<span data-remedy-others="" class="mt-0.5 block font-mono text-xs leading-5 text-muted-foreground tabular-nums">${cited
        .slice(1)
        .map((row) => `row ${row}`)
        .join(" ")}</span>`,
    );
    expect(text(remedy)).toBe(`${index + 1} ${RULE_LABELS[item.rule]} Next: ${nextStep(item, report)} ${cited.slice(1).map((row) => `row ${row}`).join(" ")}`);
    // Break 1's rows too: under row 17, with "row 21" after its Next line.
    const first = render(0, false);
    expect(order(first)[order(first).indexOf("17") + 1]).toBe("remedy");
    expect(text(remedyRow(first))).toMatch(/ row 21$/);
  });

  it("spans every column, on the wash, hidden from assistive technology, unprinted, with nothing focusable", () => {
    for (const fits of [true, false]) {
      const remedy = remedyRow(render(0, fits));
      expect(remedy).toMatch(/^<tr data-remedy-row="" aria-hidden="true" class="print:hidden"><td colSpan="6" class="bg-accent /i);
      expect(remedy).not.toMatch(/<(button|a|input|select|textarea)\b|tabindex|role=|href=/i);
      // No raspberry text, fill or edge here: the break's disc is the mark, in ink.
      expect(remedy).not.toMatch(/text-primary|bg-primary|border-primary/);
    }
  });

  it("goes when the selection clears (Esc) and moves with another break", () => {
    expect(escapeClears({ key: "Escape", defaultPrevented: false })).toBe(true);
    const none = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID, marks, flagged: true, selection: null }));
    expect(none).not.toContain("data-remedy-row");
    // A selection with no remedy (the table's own tests) draws none either.
    const bare = renderToStaticMarkup(createElement(GridTable, { grid: SAMPLE_GRID, selection: { rows: [17, 21], nonce: 1 } }));
    expect(bare).not.toContain("data-remedy-row");
    const one = order(render(0));
    const three = order(render(2));
    expect(one[one.indexOf("21") + 1]).toBe("remedy");
    expect(three[three.indexOf("21") + 1]).not.toBe("remedy");
    expect(three[three.indexOf("26") + 1]).toBe("remedy");
    // The footer and the fold lines' words are unchanged.
    expect(text(render(0))).toContain("Showing 18 of 25 rows: the first 12 and every flagged row");
    expect(text(render(0))).toContain("Rows 14 to 16 not shown");
  });
});

describe("the findings open on paper", () => {
  if (!sample.ok) throw new Error("the sample should read");
  const results = renderToStaticMarkup(
    createElement(CheckResults, {
      report: sample.report,
      decisions: new Map(),
      onDecide: () => {},
      showAll: false,
      onShowAll: () => {},
      nonce: 1,
      onRow: () => {},
      onSelectBreak: () => {},
    }),
  );

  it("draws the rule breaks and the pairs that share time under one 1px hairline, with no box or card fill on screen", () => {
    const sections = [...results.matchAll(/<section [^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(sections).toHaveLength(2);
    for (const classes of sections) {
      const list = classes.split(" ");
      expect(list).toEqual(expect.arrayContaining(["border-t", "border-border", "pt-5", "sm:pt-6"]));
      for (const name of ["rounded-lg", "border-surface-edge", "bg-card", "p-5", "sm:p-6"]) expect(list).not.toContain(name);
      // Print is unchanged.
      expect(list).toEqual(expect.arrayContaining(["print:rounded-none", "print:border-0", "print:p-0"]));
    }
    expect(sections[0]).toContain("cc-check-rules");
    expect(sections[1]).toContain("cc-check-shared");
    // The pressed heading keeps its wash and 2px ink outline; the row references keep their control edge.
    expect(results).toContain("aria-pressed:not-focus-visible:outline-foreground");
    expect(results).toMatch(/<button[^>]*class="[^"]*border border-border-strong[^"]*"[^>]*>row \d+<\/button>/);
  });
});

describe("a figure under each rule break of the invented sample", () => {
  if (!sample.ok) throw new Error("the sample should read");
  const report = sample.report;
  const results = renderToStaticMarkup(
    createElement(CheckResults, {
      report,
      decisions: new Map(),
      onDecide: () => {},
      showAll: false,
      onShowAll: () => {},
      nonce: 1,
      onRow: () => {},
      onSelectBreak: () => {},
    }),
  );
  const blocks = results.split("<h3").slice(1);

  it("draws one strip per break, directly under its row references, hidden from screen readers and print", () => {
    expect(report.breaks).toHaveLength(4);
    expect(results.match(/data-break-strip="/g)).toHaveLength(4);
    blocks.forEach((block, index) => {
      const strips = [...block.matchAll(/<div aria-hidden="true" data-break-strip="(\d)" class="([^"]*)"/g)];
      expect(strips).toHaveLength(1);
      expect(Number(strips[0][1])).toBe(report.breaks[index].rule);
      expect(strips[0][2]).toContain("print:hidden");
      // Directly after the references' paragraph, before the decision line.
      const refs = block.lastIndexOf("</button></p>", block.indexOf("data-break-strip"));
      expect(block.slice(refs + "</button></p>".length).startsWith("<div aria-hidden=\"true\" data-break-strip=")).toBe(true);
      expect(block.indexOf("data-break-strip")).toBeLessThan(block.indexOf(">Kept on purpose<"));
    });
  });

  it("draws no strip without row references, and none on a folded finding", () => {
    const bare = renderToStaticMarkup(
      createElement(CheckResults, { report, decisions: new Map(), onDecide: () => {}, showAll: false, onShowAll: () => {}, nonce: 1 }),
    );
    expect(bare).not.toContain("data-break-strip");
    const item = report.breaks[0];
    const id = breakDecisionId(item, report.sets);
    const folded = renderToStaticMarkup(
      createElement(CheckResults, {
        report,
        decisions: new Map([[id, { id, label: item.text, status: "kept" as const, reason: null, note: "", change: null }]]),
        onDecide: () => {},
        showAll: false,
        onShowAll: () => {},
        nonce: 1,
        onRow: () => {},
      }),
    );
    expect(folded.match(/data-break-strip="/g)).toHaveLength(3);
  });

  it("leaves the selected break's strip as it is: selection restyles the heading only", () => {
    const pressed = renderToStaticMarkup(
      createElement(CheckResults, {
        report,
        decisions: new Map(),
        onDecide: () => {},
        showAll: false,
        onShowAll: () => {},
        nonce: 1,
        onRow: () => {},
        selectedBreak: breakDecisionId(report.breaks[0], report.sets),
        onSelectBreak: () => {},
      }),
    );
    const strips = (html: string) => (html.match(/<div aria-hidden="true" data-break-strip=[\s\S]*?<\/svg>/g) ?? []).map((s) => s.replace(/cc-overlap-[A-Za-z0-9_-]+/g, "id"));
    expect(strips(pressed)).toEqual(strips(results));
  });

  it("keeps each action's words, type and call-site classes: the utilities in the name row, then the switch and Check the grid in the bar", () => {
    const page = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
    const start = page.indexOf('<div class="min-w-0 pb-2 sm:pb-3 lg:col-span-2 lg:col-start-1 lg:row-start-1">');
    expect(start).toBeGreaterThan(0);
    const barStart = page.indexOf(
      '<div class="relative flex flex-wrap items-center justify-between gap-3 py-2 pr-4 pl-1 lg:gap-2 after:pointer-events-none after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border after:content-[&#x27;&#x27;]"><div role="radiogroup" aria-label="Show the draft grid as"',
    );
    expect(barStart).toBeGreaterThan(start);
    const top = page.slice(start, page.indexOf("<table", barStart));
    // Each action keeps its words, its type and the classes its call site adds, in the same source order.
    const buttons = [...top.matchAll(/<button [^>]*class="([^"]*)" type="(button|submit)">([^<]*)/g)].map((m) => ({
      label: m[3],
      type: m[2],
      classes: m[1],
    }));
    expect(buttons.map(({ label, type }) => [label, type])).toEqual([
      ["Download a template", "button"],
      ["Check an invented sample", "button"],
      ["Check the grid", "submit"],
    ]);
    // Round 35: the template takes the 4px step too, since the published day's action now comes before it.
    expect(buttons[0].classes.endsWith(" px-2 decoration-1 underline-offset-4 hover:bg-transparent hover:underline ml-1 max-sm:-ml-2")).toBe(true);
    expect(buttons[1].classes.endsWith(" px-2 decoration-1 underline-offset-4 hover:bg-transparent hover:underline ml-1 max-sm:-ml-2")).toBe(true);
    expect(buttons[2].classes.endsWith(" h-11 px-5 text-[0.9375rem] max-sm:w-full lg:px-4")).toBe(true);
    // The two utilities come before the sheet's frame, the switch before the check.
    expect(top.indexOf("Check an invented sample")).toBeLessThan(top.indexOf("overflow-hidden rounded-lg border border-border-strong"));
    expect(top.indexOf('aria-label="Show the draft grid as"')).toBeLessThan(top.indexOf("Check the grid"));
    expect(top).not.toContain("data-break-strip");
  });
});

describe("the first screen draws each finding under its rows", () => {
  if (!sample.ok) throw new Error("the sample should read");
  const report = sample.report;
  const page = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
  // The preview's list of breaks, beside the sheet: from its list to the pairs' line under it.
  const start = page.indexOf('<ul aria-label="Rule breaks"');
  const preview = page.slice(start, page.indexOf("Sets that share time (", start));
  const items = preview.split('<li class="py-2.5">').slice(1);
  const STRIP = /<div aria-hidden="true" data-break-strip="(\d)" class="([^"]*)">([\s\S]*?<\/svg>[\s\S]*?)<\/div><\/div>/g;
  const results = renderToStaticMarkup(
    createElement(CheckResults, {
      report,
      decisions: new Map(),
      onDecide: () => {},
      showAll: false,
      onShowAll: () => {},
      nonce: 1,
      onRow: () => {},
      onSelectBreak: () => {},
    }),
  );
  /** A strip's printed words, in order: its row labels and the minutes or clock it prints. */
  const words = (markup: string) => [...markup.matchAll(/<span[^>]*data-strip-(?:row|label)[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

  it("renders one strip for each of the invented sample's 4 breaks, under its row lines, aria-hidden and print:hidden", () => {
    expect(start).toBeGreaterThan(page.indexOf('aria-label="Checked"'));
    expect(report.breaks).toHaveLength(4);
    expect(items).toHaveLength(4);
    items.forEach((item, index) => {
      const strips = [...item.matchAll(STRIP)];
      expect(strips).toHaveLength(1);
      const [whole, rule, classes] = strips[0];
      expect(Number(rule)).toBe(report.breaks[index].rule);
      // The R27 strip as built, set at the row lines' left edge: aria-hidden, print:hidden, 8px under the rows.
      expect(classes.split(" ")).toEqual(expect.arrayContaining(["mt-2", "print:hidden", "pl-7"]));
      expect(item.indexOf("data-break-strip")).toBeGreaterThan(item.lastIndexOf("</ul>", item.indexOf("data-break-strip")));
      expect(item.indexOf("</ul>")).toBeLessThan(item.indexOf("data-break-strip"));
      // No control inside it.
      expect(whole).not.toMatch(/<(button|a|input|select|textarea)\b|tabindex|onclick|role=/i);
    });
  });

  it("prints the finding's own numbers: each preview strip says what the results' strip for that break says", () => {
    const full = [...results.matchAll(STRIP)].map((m) => words(m[3]));
    const shown = items.map((item) => words([...item.matchAll(STRIP)][0][3]));
    expect(full).toHaveLength(4);
    expect(shown).toEqual(full);
    expect(shown[0]).toEqual(["row 17", "row 21", "20 min shared"]);
  });

  it("does not change with selection, and draws nothing for a break whose rows do not resolve", () => {
    const item = report.breaks[0];
    const rows = item.rows.flatMap((row) => report.sets.filter((set) => set.row === row));
    const figure = createElement(BreakStrip, { item, sets: report.sets, settings: report.settings, className: "pl-7" });
    const base = { n: 1, rule: RULE_LABELS[item.rule], next: nextStep(item, report), figure, onSelect: () => {} };
    const strip = (markup: string) => (markup.match(/<div aria-hidden="true" data-break-strip=[\s\S]*$/)?.[0] ?? "").replace(/cc-overlap-[A-Za-z0-9_-]+/g, "id");
    const off = renderToStaticMarkup(createElement(BreakItem, { ...base, rows, pressed: false }));
    const on = renderToStaticMarkup(createElement(BreakItem, { ...base, rows, pressed: true }));
    expect(on).toContain('aria-pressed="true"');
    expect(strip(off)).not.toBe("");
    expect(strip(on)).toBe(strip(off));
    // No row resolves: no row lines' content and no strip.
    const none = renderToStaticMarkup(createElement(BreakItem, { ...base, rows: [], pressed: false }));
    expect(none).not.toContain("data-break-strip");
    // A row the sets do not hold: BreakStrip returns null, and the item ends at its row lines with no empty space.
    const lost = createElement(BreakStrip, { item: { ...item, rows: [item.rows[0], 999] }, sets: report.sets, settings: report.settings, className: "pl-7" });
    const missing = renderToStaticMarkup(createElement(BreakItem, { ...base, figure: lost, rows, pressed: false }));
    expect(missing).not.toContain("data-break-strip");
    expect(missing.endsWith("</ul></li>")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// Round 31: the judge's own-data path (every name and number below is invented for the test)

/** A fresh six-act grid that shares no name with the sample. */
const FRESH = [
  "act,stage,start,end",
  "Amber Kite,Hill,18:00,19:00",
  "Basalt Choir,Valley,18:30,19:30",
  "Copper Field,Hill,19:20,20:20",
  "Dune Signal,Valley,19:45,20:45",
  "Ember Coast,Barn,18:15,19:15",
  "Flint Arcade,Barn,19:40,20:30",
].join("\n");

describe("round 31: the first paste works (C1)", () => {
  it("drops the sample's rule when a fresh grid replaces the sample, and the grid is checked with no refusal", () => {
    // Before: the sample's rule against the fresh grid refuses, as the judges saw.
    expect(runCheck({ ...SAMPLE_INPUT_FOR_TEST, grid: FRESH }).ok).toBe(false);
    const drop = dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, FRESH);
    expect(drop.removed).toEqual(['Removed the sample\'s rule "Saffron Season | Ivory Lights": neither act is in this grid.']);
    expect(drop.pairs).toBe("");
    expect(drop.sampleRules).toEqual([]);
    const outcome = runCheck({ ...SAMPLE_INPUT_FOR_TEST, grid: FRESH, pairs: drop.pairs });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.sets).toHaveLength(6);
    expect(outcome.report.settings.pairs).toEqual([]);
  });

  it("says \"one of these acts is not\" when only one act of the sample's rule is gone", () => {
    const grid = `${FRESH}\nSaffron Season,Barn,21:00,22:00`;
    const drop = dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, grid);
    expect(drop.removed).toEqual([
      'Removed the sample\'s rule "Saffron Season | Ivory Lights": one of these acts is not in this grid.',
    ]);
  });

  it("keeps the sample's rule when its acts are still in the new grid, and while the sample is only edited", () => {
    const both = `${FRESH}\nSaffron Season,Barn,21:00,22:00\nIvory Lights,Hill,21:00,22:00`;
    expect(dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, both).removed).toEqual([]);
    // Renaming one act of the sample is an edit: the rule stays and refuses as before, with its fixes.
    const renamed = SAMPLE_GRID.replace("Saffron Season,", "Saffron Seasons,");
    expect(dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, renamed)).toMatchObject({ pairs: SAMPLE_SETTINGS.pairs, removed: [] });
    // A grid with a problem drops nothing.
    expect(dropSampleRules(SAMPLE_SETTINGS.pairs, SAMPLE_RULES, "Amber Kite,Hill,18:00").removed).toEqual([]);
  });

  it("never removes a rule the person typed, even when its acts are absent", () => {
    const typed = "Amber Kite | Basalt Choir\nNobody Here | Amber Kite";
    // Nothing of it came from the sample.
    expect(keepSampleRules(typed, SAMPLE_RULES)).toEqual([]);
    expect(dropSampleRules(typed, [], SAMPLE_GRID)).toMatchObject({ pairs: typed, removed: [] });
    expect(dropSampleRules(typed, keepSampleRules(typed, SAMPLE_RULES), FRESH)).toMatchObject({ pairs: typed, removed: [] });
    // A sample line the person edited is theirs: it is not removed either.
    const edited = "Saffron Season | Ivory Light";
    expect(dropSampleRules(edited, keepSampleRules(edited, SAMPLE_RULES), FRESH)).toMatchObject({ pairs: edited, removed: [] });
    // An untouched sample line beside the person's own: only the sample's goes.
    const mixed = `Amber Kite | Basalt Choir\n${SAMPLE_SETTINGS.pairs}`;
    const drop = dropSampleRules(mixed, keepSampleRules(mixed, SAMPLE_RULES), FRESH);
    expect(drop.pairs).toBe("Amber Kite | Basalt Choir");
    expect(drop.removed).toHaveLength(1);
  });

  it("keeps a typed rule whose acts are present, and checks it", () => {
    const outcome = runCheck({ grid: FRESH, changeover: "", curfew: "", pairs: "Amber Kite | Basalt Choir" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.settings.pairs.map((pair) => `${pair.a.act} | ${pair.b.act}`)).toEqual(["Amber Kite | Basalt Choir"]);
    expect(outcome.report.breaks.some((item) => item.rule === 5)).toBe(true);
  });

  it("refuses a typed rule whose acts are absent and offers Remove this rule first, never an unrelated act", () => {
    const pairs = "Amber Kite | Basalt Choir\nSaffron Season | Ivory Lights";
    const html = renderToStaticMarkup(
      createElement(CheckTool, { initial: { grid: FRESH, changeover: "", curfew: "", pairs }, checkOnLoad: true }),
    );
    const alert = html.slice(html.indexOf('role="alert"'), html.indexOf("</ul>", html.indexOf('role="alert"')));
    expect(text(alert)).toContain("The grid was not checked.");
    expect(text(alert)).toContain("Pair line 2:");
    const buttons = [...alert.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) => text(match[1]));
    expect(buttons[0]).toBe("Remove this rule : pair line 2");
    // One Remove per line, and no offer to swap the rule onto one of the fresh grid's acts.
    expect(buttons.filter((label) => label.startsWith("Remove this rule"))).toHaveLength(1);
    for (const act of ["Amber Kite", "Basalt Choir", "Copper Field", "Dune Signal", "Ember Coast", "Flint Arcade"]) {
      expect(buttons.some((label) => label.includes(act))).toBe(false);
    }
  });

  it("pressing Remove this rule takes out only that line, and the grid then checks", () => {
    const pairs = "Amber Kite | Basalt Choir\nSaffron Season | Ivory Lights";
    const refused = runCheck({ grid: FRESH, changeover: "", curfew: "", pairs });
    if (refused.ok) throw new Error("should refuse");
    const line = pairLineOf(refused.errors[0]);
    expect(line).toBe(2);
    const next = removePairLine(pairs, line as number);
    expect(next).toBe("Amber Kite | Basalt Choir");
    expect(runCheck({ grid: FRESH, changeover: "", curfew: "", pairs: next }).ok).toBe(true);
  });

  it("puts Remove this rule before Use it, and offers a nearest name only when it is a typo of what was typed", () => {
    const suggestion: PairSuggestion = { message: "Pair line 1: x", line: 1, side: 0, match: null, nearest: ["Amber Kite", "Basalt Choir", "Ember Coast"] };
    expect(pairFixes(suggestion.message, suggestion, "Amber Kyte", true)).toEqual({ remove: 1, names: ["Amber Kite"] });
    expect(pairFixes(suggestion.message, suggestion, "Saffron Season", true)).toEqual({ remove: 1, names: [] });
    expect(pairFixes(suggestion.message, { ...suggestion, match: "Amber Kite" }, "Amber", true)).toEqual({ remove: 1, names: ["Amber Kite"] });
    // The second error of the same line carries no second Remove.
    expect(pairFixes(suggestion.message, suggestion, "Amber Kyte", false).remove).toBeNull();
    expect(pairFixes("Changeover should be a whole number of minutes from 0 to 240.", undefined, null, true)).toEqual({ remove: null, names: [] });
    expect(typedName("A | B\nC | D", 2, 1)).toBe(" D");
  });
});

describe("round 31: pairs whose two sets are both locked (C5)", () => {
  const grid = [
    "act,stage,start,end,locked",
    "Pine Lantern,North,18:00,20:00,yes",
    "Quill Harbor,South,18:00,19:50,yes",
    "Rook Meadow,East,18:00,19:00,",
    "Sable Comet,West,18:30,19:20,",
  ].join("\n");
  const outcome = runCheck({ grid, changeover: "", curfew: "", pairs: "" });
  if (!outcome.ok) throw new Error("refused");
  const html = renderToStaticMarkup(
    createElement(CheckResults, {
      report: outcome.report,
      decisions: new Map(),
      onDecide: () => {},
      showAll: false,
      onShowAll: () => {},
      nonce: 1,
      trial: { state: null, onFind: () => {}, onApply: () => {}, onClose: () => {} },
    }),
  );
  const rows = html.slice(html.indexOf(`id="${RESULT_IDS.shared}"`)).split("<li ").slice(1);

  it("says both are locked, offers no Find a change and says why, and keeps one locked as before", () => {
    const both = rows.find((row) => row.includes("Pine Lantern") && row.includes("Quill Harbor")) ?? "";
    expect(text(both)).toContain("(both are locked).");
    expect(text(both)).toContain(BOTH_LOCKED);
    expect(both).not.toContain("data-find-change");
    const one = rows.find((row) => row.includes("Pine Lantern") && row.includes("Rook Meadow")) ?? "";
    expect(text(one)).toContain("(one is locked).");
    expect(one).toContain("data-find-change");
    expect(text(one)).not.toContain(BOTH_LOCKED);
  });

  it("never words a lock as wanted", () => {
    expect(lockNote({ a: { locked: true }, b: { locked: true } } as never)).toBe(" (both are locked).");
    expect(text(html)).not.toMatch(/clashed on purpose|deliberate|intended/i);
    expect(BOTH_LOCKED).not.toMatch(/on purpose/i);
  });
});

describe("round 31: a review with nothing to review (C7)", () => {
  const counts = { sets: 6, stages: 3, breaks: 0, breaksReviewed: 0, pairs: 4, pairsDecided: 0, kept: 0, notChanging: 0, changed: 0, openBreaks: 0, openPairs: 4 };
  const props = {
    counts,
    sample: false,
    price: { phase: "idle" } as const,
    searched: 0,
    applied: 0,
    stale: false,
    onPrint: () => {},
    onCopy: () => {},
    onDownload: () => {},
    canShare: true,
    share: null,
  };

  it("says No rule breaks to review. and draws no bar, never a full green one", () => {
    const html = renderToStaticMarkup(createElement(CheckReview, props));
    expect(text(html)).toContain("No rule breaks to review.");
    expect(html).not.toContain("data-review-bar");
    expect(html).not.toContain("bg-success");
    expect(text(html)).not.toContain("0 / 0");
  });

  it("keeps the count and the bar when there are breaks", () => {
    const html = renderToStaticMarkup(createElement(CheckReview, { ...props, counts: { ...counts, breaks: 3, breaksReviewed: 1, openBreaks: 2 } }));
    expect(text(html)).toContain("1 / 3 rule breaks reviewed");
    expect(html.match(/data-review-bar=""[\s\S]*?<\/div>/)?.[0].match(/rounded-bar/g)).toHaveLength(3);
    expect(text(html)).not.toContain("No rule breaks to review.");
  });
});

describe("round 31: the live offer only when the server prices live (C2, C3)", () => {
  const report = runCheck(SAMPLE_INPUT_FOR_TEST);
  if (!report.ok) throw new Error("refused");
  const request = priceRequest(report.report);
  const base = { request, noOverlap: false, order: "minutes" as const, onOrder: () => {}, onPrice: () => {}, stale: false };
  const notSaved = { phase: "not_saved" } as const;

  it("off or unknown: no Ask Qloo button and no We can ask Qloo now, the off sentence instead", () => {
    for (const live of [false, undefined]) {
      const page = text(renderToStaticMarkup(createElement(CheckPrice, { ...base, state: notSaved, live })));
      expect(page).not.toContain("Ask Qloo for these");
      expect(page).not.toContain("We can ask Qloo now");
      expect(page).toContain(PRICE_COPY.liveOff);
    }
  });

  it("on: the consent names Qloo as a third party, then the button", () => {
    const html = renderToStaticMarkup(createElement(CheckPrice, { ...base, state: notSaved, live: true }));
    const page = text(html).replace(/&#x27;/g, "'");
    // The live step counts the names a live answer sends (its bounded comparison set), not the saved body's.
    expect(page).toContain(thirdParty(request?.liveActs.length ?? 0));
    expect(page).toContain(`Ask Qloo for these ${request?.liveActs.length} acts`);
    expect(page.indexOf("a third party")).toBeLessThan(page.indexOf("Ask Qloo for these"));
  });

  it("off, after the server's 200 answer: says why, offers the published day once, and the rail stops offering Compare (C4)", () => {
    const tries: string[] = [];
    const props = { ...base, state: notSaved, live: false, publishedTitle: "Harbor 2031, Friday", onTryPublished: () => tries.push("published") };
    const buttons = buttonsOf(CheckPrice(props));
    expect(buttons.map((button) => button.words)).toEqual(["Try it on Harbor 2031, Friday"]);
    buttons[0].press();
    expect(tries).toEqual(["published"]);
    const html = renderToStaticMarkup(createElement(CheckPrice, props));
    expect(text(html)).toContain(PRICE_COPY.liveOff);
    // A text action with a 44px target and the cobalt focus ring; no pill, chip or fill.
    expect(html).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*focus-visible:outline-ring[^"]*">Try it on Harbor 2031, Friday<\/button>/);
    // Never on a published day, and not without a day to offer.
    expect(buttonsOf(CheckPrice({ ...props, published: true }))).toEqual([]);
    expect(buttonsOf(CheckPrice({ ...props, publishedTitle: null }))).toEqual([]);
    // The rail says the grid as checked had its answer, and offers Compare again only once the grid changes.
    expect(comparedLine({ phase: "not_saved" })).toEqual({ value: "Not compared · no saved day matched", done: false });
    const rail = (price: { phase: "not_saved" } | { phase: "idle" }) =>
      text(
        renderToStaticMarkup(
          createElement(CheckReview, {
            counts: { sets: 5, stages: 3, breaks: 0, breaksReviewed: 0, pairs: 4, pairsDecided: 0, kept: 0, notChanging: 0, changed: 0, openBreaks: 0, openPairs: 4 },
            sample: false,
            price,
            searched: 0,
            applied: 0,
            stale: false,
            onPrint: () => {},
            onCopy: () => {},
            onDownload: () => {},
            canShare: true,
            share: null,
          }),
        ),
      );
    expect(rail({ phase: "not_saved" })).toContain("Compared with Qloo data Not compared · no saved day matched Changes");
    expect(rail({ phase: "not_saved" })).not.toContain(PRICE_COPY.button);
    expect(rail({ phase: "idle" })).toContain(`Compared with Qloo data Not yet ${PRICE_COPY.button}`);
  });
});

/** The buttons of a server-free element tree, with their words and their press. */
function buttonsOf(node: unknown): { words: string; press: () => void }[] {
  if (Array.isArray(node)) return node.flatMap(buttonsOf);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: unknown; onClick?: () => void };
  const own = typeof props.onClick === "function" ? [{ words: text(renderToStaticMarkup(node)), press: props.onClick }] : [];
  return [...own, ...buttonsOf(props.children)];
}

describe("round 31: Check a published day (C8)", () => {
  // An invented published day in the route's shape: two stages, one locked set, its own rules.
  const day = {
    id: "brookfield-2030-sat",
    title: "Brookfield 2030, Saturday",
    synthetic: false,
    festival: {
      stages: [
        { id: "big", name: "Big Top" },
        { id: "barn", name: "Barn" },
      ],
      acts: [
        { id: "a", name: "Amber Kite" },
        { id: "b", name: "Basalt Choir" },
        { id: "c", name: "Copper Field, Jr." },
        { id: "d", name: "Dune Signal" },
        { id: "e", name: "Ember Coast" },
      ],
      timetable: [
        { act_id: "b", day: 0, stage_id: "big", start: 1260, end: 1350, locked: true },
        { act_id: "a", day: 0, stage_id: "big", start: 1110, end: 1200, locked: false },
        { act_id: "c", day: 0, stage_id: "barn", start: 1140, end: 1230, locked: false },
        { act_id: "d", day: 0, stage_id: "barn", start: 1290, end: 1460, locked: false },
        { act_id: "e", day: 1, stage_id: "barn", start: 1200, end: 1260, locked: false },
      ],
      constraints: { changeover_minutes: 20, curfew: { "0": 1425 }, no_clash_with: [["a", "d"], ["a", "e"]], billing_rules: [] },
    },
  };

  it("builds the sheet from the timetable with that day's own changeover, curfew and pair rules, never the sample's", () => {
    const built = publishedDayInput(day);
    expect(built).not.toBeNull();
    if (!built) return;
    expect(built.title).toBe("Brookfield 2030, Saturday");
    expect(built.label).toBe(
      "Published timetable: Brookfield 2030, Saturday. Curfew and changeover from that day; its billing rules and stage hours are not checked here. Its taste overlap compares from the saved day; nothing is sent to Qloo.",
    );
    expect(built.input.changeover).toBe("20");
    expect(built.input.curfew).toBe("23:45");
    // The pair whose second act plays another day is left out.
    expect(built.input.pairs).toBe("Amber Kite | Dune Signal");
    expect(built.input.grid.split("\n")).toEqual([
      "act,stage,start,end,locked",
      "Amber Kite,Big Top,18:30,20:00,",
      "Basalt Choir,Big Top,21:00,22:30,yes",
      '"Copper Field, Jr.",Barn,19:00,20:30,',
      "Dune Signal,Barn,21:30,24:20,",
      "",
    ]);
    expect(built.input).not.toMatchObject({ changeover: SAMPLE_SETTINGS.changeover });
    expect(built.input.pairs).not.toContain(SAMPLE_SETTINGS.pairs);
    const outcome = runCheck(built.input);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.sets).toHaveLength(4);
    expect(outcome.report.lockedCount).toBe(1);
    // Dune Signal ends after the day's own 23:45 curfew.
    expect(outcome.report.breaks.map((item) => item.rule)).toContain(4);
    expect(isPublishedInput(built.input, built)).toBe(true);
    expect(isPublishedInput({ ...built.input, curfew: "" }, built)).toBe(false);
  });

  it("reads nothing from an invented day or a shape it does not know", () => {
    expect(publishedDayInput({ ...day, synthetic: true })).toBeNull();
    expect(publishedDayInput({ title: "x" })).toBeNull();
    expect(publishedDayInput(null)).toBeNull();
    expect(publishedDayInput({ ...day, festival: { ...day.festival, timetable: [] } })).toBeNull();
    // No constraints: blank changeover and curfew (the page's own defaults), no pair rules.
    const bare = publishedDayInput({ ...day, festival: { ...day.festival, constraints: undefined } });
    expect(bare?.input).toMatchObject({ changeover: "", curfew: "", pairs: "" });
  });

  it("with live pricing on, the published day's Compare press asks in saved mode, and no live offer follows", () => {
    const built = publishedDayInput(day);
    if (!built) throw new Error("not built");
    const outcome = runCheck(built.input);
    if (!outcome.ok) throw new Error("refused");
    const request = priceRequest(outcome.report);
    const presses: string[] = [];
    const props = {
      request,
      noOverlap: false,
      order: "minutes" as const,
      onOrder: () => {},
      onPrice: (mode: string) => presses.push(mode),
      stale: false,
      live: true,
      published: true,
    };
    const idle = buttonsOf(CheckPrice({ ...props, state: { phase: "idle" } }));
    expect(idle.map((button) => button.words)).toEqual([PRICE_COPY.button]);
    idle[0].press();
    expect(presses).toEqual(["saved"]);
    expect(JSON.parse(priceBody(request as NonNullable<typeof request>, "saved")).mode).toBe("saved");
    // Even if no saved day matched, a published day is never offered to Qloo.
    const after = buttonsOf(CheckPrice({ ...props, state: { phase: "not_saved" } }));
    expect(after).toEqual([]);
    expect(text(renderToStaticMarkup(createElement(CheckPrice, { ...props, state: { phase: "not_saved" } })))).toContain(
      PRICE_COPY.publishedNotSaved,
    );
  });

  it("offers the action only once this app's API names a published day: none in the server render", () => {
    const html = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
    expect(html).not.toContain("Check a published day");
    const source = readFileSync(fileURLToPath(new URL("./check-tool.tsx", import.meta.url)), "utf8");
    expect(source).toMatch(/\{publishedDay \? \(/);
    expect(source).toContain("Check a published day: {publishedDay.title}");
    // The published label is shown above the results and printed on the brief.
    expect(source).toMatch(/published: run\.published \?\? null/);
  });

  it("keeps a line for the action until the API answers below lg (round 34: a phone's), with nothing to read or press, so the sheet never moves", () => {
    const html = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
    const nameRow = html.slice(html.indexOf("<label"), html.indexOf('<div class="overflow-hidden rounded-lg border border-border-strong bg-card'));
    // In the action's own place, before the two utilities (round 35): one empty line, hidden from assistive
    // technology, the action's height (44px and the button's own padding, border and type) wherever the three
    // actions do not fit one line (below lg; a phone, 640 and 768 measured), and nothing from lg, where the action
    // takes room to the left of the pair and the pair stays put.
    const holder = nameRow.match(/<div class="[^"]*justify-end[^"]*"><span aria-hidden="true" class="([^"]*)">([^<]*)<\/span><button/);
    expect(holder?.[1]).toBe("block min-h-11 w-full border border-transparent py-2.5 text-[0.9375rem] lg:hidden");
    expect(holder?.[2].trim()).toBe("");
    expect(nameRow.match(/<button/g)).toHaveLength(2);
    // Once the action is there, a break with no height keeps it on its own line below lg, as the holder was.
    const source0 = readFileSync(fileURLToPath(new URL("./check-tool.tsx", import.meta.url)), "utf8");
    expect(source0).toContain('{publishedDay ? <span aria-hidden="true" className="basis-full lg:hidden" /> : null}');
    // Undefined until the API answers; null (no published day) leaves no line, and a day replaces it with the action.
    const source = readFileSync(fileURLToPath(new URL("./check-tool.tsx", import.meta.url)), "utf8");
    // (Fix pass: the days are a list, and the offered one passes undefined and null through: `offeredDay`.)
    expect(source).toContain("useState<readonly PublishedDay[] | null | undefined>(undefined)");
    expect(source).toMatch(/\) : publishedDay === undefined \? \(/);
  });
});

describe("the sample the page opens with is drawn in place (round 34: motion answers an action, never the first paint)", () => {
  const sectionsOf = (html: string) => [...html.matchAll(/<section [^>]*aria-labelledby="(check-rules-heading|check-shared-heading)"[^>]*class="([^"]*)"/g)];

  it("opens with the sample's results and no reveal on either section", () => {
    const html = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
    const sections = sectionsOf(html);
    expect(sections).toHaveLength(2);
    for (const [, , classes] of sections) expect(classes).not.toMatch(/cc-check-(rules|shared)/);
  });

  it("reveals the results of a check a visitor runs, and not those drawn still", () => {
    if (!sample.ok) throw new Error("the sample should read");
    const props = { report: sample.report, decisions: new Map(), onDecide: () => {}, showAll: false, onShowAll: () => {}, nonce: 2 };
    const pressed = sectionsOf(renderToStaticMarkup(createElement(CheckResults, props))).map((m) => m[2]);
    expect(pressed[0]).toContain("cc-check-rules");
    expect(pressed[1]).toContain("cc-check-shared");
    for (const [, , classes] of sectionsOf(renderToStaticMarkup(createElement(CheckResults, { ...props, still: true })))) {
      expect(classes).not.toMatch(/cc-check-(rules|shared)/);
    }
    // Still only for the arrival's own run: a check, the sample loaded again or a change tried each reveal.
    const source = readFileSync(fileURLToPath(new URL("./check-tool.tsx", import.meta.url)), "utf8");
    expect(source).toContain("still={run.arrival === true && !working}");
    expect(source.match(/arrival: true/g)).toHaveLength(1);
  });
});

describe("round 32: a published day compares its own costliest clashes, values first (K1, K3, K5, K8)", () => {
  // An invented published day in the route's shape, with an invented saved ranking: every name, count and
  // value here is invented for the test.
  const day = {
    id: "harbor-2031-fri",
    title: "Harbor 2031, Friday",
    synthetic: false,
    festival: {
      stages: [
        { id: "n", name: "North" },
        { id: "s", name: "South" },
        { id: "e", name: "East" },
      ],
      acts: [
        { id: "a", name: "Ash Meadow" },
        { id: "b", name: "Brass Lantern" },
        { id: "c", name: "Cedar Bloom" },
        { id: "d", name: "Delta Choir" },
        { id: "e", name: "Echo Field" },
        { id: "f", name: "Flint Harbor" },
      ],
      timetable: [
        { act_id: "a", day: 0, stage_id: "n", start: 1080, end: 1140, locked: false },
        { act_id: "b", day: 0, stage_id: "s", start: 1095, end: 1140, locked: false },
        { act_id: "c", day: 0, stage_id: "e", start: 1110, end: 1170, locked: true },
        { act_id: "d", day: 0, stage_id: "n", start: 1160, end: 1230, locked: true },
        { act_id: "e", day: 0, stage_id: "s", start: 1155, end: 1200, locked: false },
        { act_id: "f", day: 0, stage_id: "e", start: 1185, end: 1230, locked: false },
      ],
      constraints: { changeover_minutes: 10, curfew: {}, no_clash_with: [], billing_rules: [] },
    },
    report: {
      metrics: { scored_concurrent_pairs: 5, unscored_concurrent_pairs: 3 },
      coverage: { unscored: [{ act_id: "e", name: "Echo Field", reason: "no_signal" }] },
      clashes: [
        { rank: 1, day: 0, a: { act_id: "d" }, b: { act_id: "c" } },
        { rank: 2, day: 0, a: { act_id: "e" }, b: { act_id: "f" } },
        { rank: 3, day: 0, a: { act_id: "b" }, b: { act_id: "a" } },
        { rank: 4, day: 0, a: { act_id: "f" }, b: { act_id: "d" } },
        { rank: 5, day: 0, a: { act_id: "a" }, b: { act_id: "c" } },
      ],
    },
  };
  const built = publishedDayInput(day);
  if (!built) throw new Error("not built");
  const outcome = runCheck(built.input);
  if (!outcome.ok) throw new Error("refused");

  it("keeps the saved day's ranking, its no-signal acts and its pair counts beside the fields", () => {
    expect(built.ranking?.pairs).toEqual([
      { a: "Delta Choir", b: "Cedar Bloom" },
      { a: "Echo Field", b: "Flint Harbor" },
      { a: "Brass Lantern", b: "Ash Meadow" },
      { a: "Flint Harbor", b: "Delta Choir" },
      { a: "Ash Meadow", b: "Cedar Bloom" },
    ]);
    expect(built.ranking?.noSignal).toEqual(["Echo Field"]);
    expect(built.pairCounts).toEqual({ scored: 5, unscored: 3 });
    // The fields themselves carry the timetable only.
    expect(JSON.stringify(built.input)).not.toMatch(/rank|clash|scored/i);
    expect(publishedDayInput({ ...day, report: undefined })?.ranking ?? null).toBeNull();
  });

  it("says once how the overlaps found become the ranked ones, only when the counts add up (K5)", () => {
    expect(outcome.report.shared).toHaveLength(8);
    expect(publishedPairsLine(outcome.report.shared.length, built.pairCounts)).toBe(
      "8 pairs share time; the timetable page ranks the 5 where both acts have a usable Qloo signal.",
    );
    expect(publishedPairsLine(7, built.pairCounts)).toBeNull();
    expect(publishedPairsLine(5, { scored: 5, unscored: 0 })).toBeNull();
    expect(publishedPairsLine(8, null)).toBeNull();
    // C5: one reason only. Here the 3 pairs the page leaves unranked are exactly the 3 overlaps with Echo Field,
    // the act with no usable signal; were any other pair unranked, the line would need a second reason, so none.
    const quiet = outcome.report.shared.filter((pair) => [pair.a.act, pair.b.act].includes("Echo Field")).length;
    expect(quiet).toBe(3);
    expect(publishedPairsLine(8, built.pairCounts, quiet)).toBe(publishedPairsLine(8, built.pairCounts));
    expect(publishedPairsLine(8, built.pairCounts, 2)).toBeNull();
  });

  it("compares the saved day's costliest clashes in its order, passing over both-locked and no-signal pairs (K1)", () => {
    const request = priceRequest(outcome.report, built.ranking) as NonNullable<ReturnType<typeof priceRequest>>;
    expect(request.basis).toBe("saved_ranking");
    expect(request.overlaps.map((o) => `${o.a} × ${o.b}`)).toEqual([
      "Brass Lantern × Ash Meadow",
      "Flint Harbor × Delta Choir",
      "Ash Meadow × Cedar Bloom",
    ]);
    expect(request.skipped.map((o) => o.reason)).toEqual(["locked", "no_signal"]);
    const body = JSON.parse(priceBody(request, "saved")) as { acts: string[]; mode: string };
    expect(body.mode).toBe("saved");
    // C2: only the names in the 3 pairs compared, never the day's sixth act.
    expect(body.acts).toEqual(["Brass Lantern", "Ash Meadow", "Flint Harbor", "Delta Choir", "Cedar Bloom"]);
    // The same grid pasted (no ranking) keeps its longest-first rule.
    expect(priceRequest(outcome.report)?.basis).toBe("longest");
  });

  const request = priceRequest(outcome.report, built.ranking) as NonNullable<ReturnType<typeof priceRequest>>;
  const route = {
    mode: "saved",
    source: "saved_day",
    preset_id: "harbor-2031-fri",
    fetched_at: "2031-01-01T00:00:00Z",
    coverage: { acts: 6, priced: 5, unpriced: ["Echo Field"], matched: 6, no_signal: ["Echo Field"], ambiguous: [] },
    comparator: { kind: "saved_day", acts: 5 },
    pairs: [
      { a: "Brass Lantern", b: "Ash Meadow", status: "priced", taste_overlap: 0.31, pair_rank: 2, reason: null },
      { a: "Flint Harbor", b: "Delta Choir", status: "priced", taste_overlap: 0.77, pair_rank: 1, reason: null },
      { a: "Ash Meadow", b: "Cedar Bloom", status: "unpriced", taste_overlap: null, pair_rank: null, reason: "not_ranked_on_saved_day" },
    ],
    requests_used: 0,
    scope_note: "x",
  };
  const answer = parsePriceAnswer(route, request, "saved");
  if (!answer) throw new Error("unread");
  const props = {
    request,
    noOverlap: false,
    order: "minutes" as const,
    onOrder: () => {},
    onPrice: () => {},
    stale: false,
    published: true,
  };

  it("opens in this app's ranking, with how the pairs were chosen and the order sentence above the values (K3, C1)", () => {
    // The page opens a published day's answer in its default order: the order its pairs were chosen in.
    expect(defaultOrder(answer.basis)).toBe("selection");
    const html = renderToStaticMarkup(createElement(CheckPrice, { ...props, order: defaultOrder(answer.basis), state: { phase: "ready", answer } }));
    const page = text(html);
    const at = (words: string) => {
      const index = page.indexOf(words);
      expect(index, words).toBeGreaterThanOrEqual(0);
      return index;
    };
    const order = [
      at("Compared using a saved festival day. No Qloo request was sent."),
      at("which already includes taste overlap: a worked example, not a test."),
      at("Taste overlap changes the order of the 2 compared overlaps: Flint Harbor × Delta Choir moves from 2nd to 1st."),
      at("This app’s ranking Longest first Highest taste overlap first"),
      // Row 1 is the saved day's first movable clash, with its taste rank (never "ranked", the hero's word).
      at("Brass Lantern × Ash Meadow: 45 min shared. Taste overlap 31 / 100, taste rank 2 of 2."),
      at("Flint Harbor × Delta Choir: 45 min shared. Taste overlap 77 / 100, taste rank 1 of 2."),
      at("3 overlaps not compared: both sets locked (1), no usable Qloo signal (1), not served (1)."),
      at("Why these were not compared (3)"),
    ];
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(page).not.toMatch(/\branked \d+ of/);
    // The default sort is pressed; the other two stay, as 44px buttons with the focus ring.
    expect(html).toMatch(/<button type="button" aria-pressed="true" class="min-h-11 [^"]*focus-visible:outline-ring[^"]*">This app’s ranking<\/button>/);
    expect(html).toMatch(/aria-pressed="false" class="min-h-11[^"]*">Longest first<\/button>/);
    // A pasted grid's answer keeps its round-32 choices, Longest first by default.
    expect(defaultOrder("longest")).toBe("minutes");
    // No grey line before the first value.
    const head = html.slice(0, html.indexOf("Brass Lantern × Ash Meadow: 45 min"));
    expect(head).not.toContain("text-muted-foreground");
    // The fold is closed and lists each overlap with its reason in words.
    const fold = html.slice(html.indexOf('<details class="group cc-disclosure'), html.indexOf("</details>"));
    expect(fold).not.toMatch(/<details[^>]* open/);
    expect(text(fold)).toContain("Delta Choir × Cedar Bloom: 10 min shared. Not compared: both sets are marked locked in this grid, so neither can move; the next clash in the saved day’s ranking is compared instead.");
    expect(text(fold)).toContain("Echo Field × Flint Harbor: 15 min shared. Not compared: the saved day marks an act of this pair as having no usable Qloo signal, so it was not sent.");
    expect(text(fold)).toContain(
      "Ash Meadow × Cedar Bloom: 30 min shared. Not served: this site serves saved Qloo values only for the pairs its timetable page prints. Shown by minutes only.",
    );
    // The intro says how the pairs were chosen and that only their names are sent; nothing was left out.
    expect(page).toContain("the saved day’s 3 costliest movable clashes, by its own ranking, and their 5 act names");
    expect(page).not.toMatch(/are not sent and not compared/);
  });

  it("lists every value of a paste's answer past the first five in a closed fold, the first five open", () => {
    const wide = runCheck({
      grid: Array.from({ length: 16 }, (_, i) => `Act ${String.fromCharCode(65 + i)},Stage ${i % 8},${i < 8 ? "18:00,19:00" : "18:30,19:30"}`).join("\n"),
      changeover: "",
      curfew: "",
      pairs: "",
    });
    if (!wide.ok) throw new Error("refused");
    const day = { id: "x", title: "Wide 2031, Friday", names: new Map(wide.report.sets.map((set) => [set.act.toLowerCase(), set.act])), noSignal: new Set<string>(), pairs: new Set<string>() };
    const pasted = priceRequest(wide.report, null, day) as NonNullable<ReturnType<typeof priceRequest>>;
    expect(pasted.basis).toBe("served");
    expect(pasted.overlaps).toHaveLength(10);
    const pastedAnswer = parsePriceAnswer(
      {
        ...route,
        pairs: pasted.overlaps.map((o, i) => ({ a: o.a, b: o.b, status: "priced", taste_overlap: 0.05 * (i + 1), pair_rank: pasted.overlaps.length - i, reason: null })),
      },
      pasted,
      "saved",
    );
    if (!pastedAnswer) throw new Error("unread");
    const html = renderToStaticMarkup(
      createElement(CheckPrice, { ...props, request: pasted, published: false, order: defaultOrder(pastedAnswer.basis), state: { phase: "ready", answer: pastedAnswer } }),
    );
    const open = html.replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/g, " ");
    expect(text(open).match(/taste rank \d+ of 10/g)).toHaveLength(5);
    expect(text(html).match(/taste rank \d+ of 10/g)).toHaveLength(10);
    expect(text(html)).toContain("5 more compared overlaps");
    // A pasted grid's sort has no "This app's ranking": it opens Longest first.
    expect(text(html)).not.toContain(PRICE_COPY.rankingFirst);
    expect(html).toMatch(/aria-pressed="true" class="min-h-11[^"]*">Longest first<\/button>/);
  });

  it("says in one line when no pair sent got a value because none is one the day's page prints (C3)", () => {
    const unserved = parsePriceAnswer(
      { ...route, pairs: route.pairs.map((pair) => ({ ...pair, status: "unpriced", taste_overlap: null, pair_rank: null, reason: "not_ranked_on_saved_day" })) },
      request,
      "saved",
    );
    if (!unserved) throw new Error("unread");
    const page = text(renderToStaticMarkup(createElement(CheckPrice, { ...props, state: { phase: "ready", answer: unserved } })));
    expect(page).toContain(PRICE_COPY.noneServed(null));
    expect(page).toContain("5 overlaps not compared: both sets locked (1), no usable Qloo signal (1), not served (3).");
  });

  it("before the press, counts the passed-over pairs under the button, with the same fold", () => {
    const page = text(renderToStaticMarkup(createElement(CheckPrice, { ...props, state: { phase: "idle" } })));
    expect(page.indexOf(PRICE_COPY.button)).toBeLessThan(page.indexOf("2 overlaps not compared: both sets locked (1), no usable Qloo signal (1)."));
    expect(page).toContain("Why these were not compared (2)");
  });

  it("prints no worked-example line for a pasted grid", () => {
    const pasted = priceRequest(outcome.report) as NonNullable<ReturnType<typeof priceRequest>>;
    const pastedAnswer = parsePriceAnswer(
      {
        ...route,
        pairs: pasted.overlaps.map((o, i) => ({ a: o.a, b: o.b, status: "priced", taste_overlap: 0.1 * (i + 1), pair_rank: pasted.overlaps.length - i, reason: null })),
      },
      pasted,
      "saved",
    );
    if (!pastedAnswer) throw new Error("unread");
    const page = text(renderToStaticMarkup(createElement(CheckPrice, { ...props, request: pasted, published: false, state: { phase: "ready", answer: pastedAnswer } })));
    expect(page).not.toContain("a worked example, not a test");
  });

  it("prints the screen's order on the brief: worked example, order sentence, values in this app's ranking, then what was not compared", () => {
    const page = text(
      renderToStaticMarkup(
        createElement(CheckBrief, { report: outcome.report, applied: [], decisions: [], price: answer, priceSkipped: request.skipped, preview: true }),
      ),
    );
    expect(page).toContain("Taste overlap compared (the saved day’s 3 costliest clashes that can move)");
    const worked = page.indexOf("a worked example, not a test");
    const sentence = page.indexOf("Taste overlap changes the order of the 2 compared overlaps");
    const first = page.indexOf("Brass Lantern × Ash Meadow: 45 min shared.");
    const second = page.indexOf("Flint Harbor × Delta Choir: 45 min shared.");
    expect([worked, sentence, first, second, page.indexOf("3 overlaps not compared")]).toEqual([worked, sentence, first, second, page.indexOf("3 overlaps not compared")].sort((x, y) => x - y));
    expect(worked).toBeGreaterThanOrEqual(0);
    expect(page).toContain("Delta Choir × Cedar Bloom: 10 min shared. Not compared: both sets are marked locked in this grid");
    // The order on screen, when another is chosen, is the one printed.
    const longest = text(
      renderToStaticMarkup(
        createElement(CheckBrief, { report: outcome.report, applied: [], decisions: [], price: answer, priceSkipped: request.skipped, priceOrder: "overlap", preview: true }),
      ),
    );
    expect(longest.indexOf("Flint Harbor × Delta Choir: 45 min shared.")).toBeLessThan(longest.indexOf("Brass Lantern × Ash Meadow: 45 min shared."));
  });

  it("puts the line on 79 against 68 under the count of sets that share time, once, and only while it adds up (C5)", () => {
    const line = publishedPairsLine(outcome.report.shared.length, built.pairCounts) as string;
    const html = renderToStaticMarkup(
      createElement(CheckResults, {
        report: outcome.report,
        decisions: new Map(),
        onDecide: () => {},
        showAll: false,
        onShowAll: () => {},
        nonce: 1,
        countNote: line,
      }),
    );
    const page = text(html);
    const heading = page.indexOf("Sets that share time (8 pairs)");
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(page.indexOf(line)).toBeGreaterThan(heading);
    expect(page.split(line)).toHaveLength(2);
    // Ink on paper, no muted grey, box or chip.
    expect(html).toContain(`<p class="mt-2 max-w-prose text-sm leading-relaxed text-foreground">${line}</p>`);
    const without = text(
      renderToStaticMarkup(
        createElement(CheckResults, { report: outcome.report, decisions: new Map(), onDecide: () => {}, showAll: false, onShowAll: () => {}, nonce: 1 }),
      ),
    );
    expect(without).not.toContain("the timetable page ranks");
    // The page keeps the label and this line apart on screen, and passes the line only for the day as loaded.
    const source = readFileSync(fileURLToPath(new URL("./check-tool.tsx", import.meta.url)), "utf8");
    expect(source).toContain("countNote={working ? null : (run.pairsLine ?? null)}");
    expect(source).toContain("{run.publishedLabel ?? run.published}");
  });

  it("reads 0 for rule breaks with nothing to review, never 0 of 0 reviewed (K8)", () => {
    const counts = { sets: 6, stages: 3, breaks: 0, breaksReviewed: 0, pairs: 8, pairsDecided: 0, kept: 0, notChanging: 0, changed: 0, openBreaks: 0, openPairs: 8 };
    expect(ruleBreaksValue(counts)).toBe("0");
    expect(ruleBreaksValue({ breaks: 3, breaksReviewed: 1 })).toBe("3 · 1 of 3 reviewed");
    const html = renderToStaticMarkup(
      createElement(CheckReview, {
        counts,
        sample: false,
        price: { phase: "idle" },
        searched: 0,
        applied: 0,
        stale: false,
        onPrint: () => {},
        onCopy: () => {},
        onDownload: () => {},
        canShare: true,
        share: null,
      }),
    );
    expect(text(html)).toContain("Rule breaks 0 Overlaps");
    expect(text(html)).not.toContain("0 of 0 reviewed");
    // The printed brief says the same: "Rule breaks: 0." and "Rule breaks (0)", never "0 of 0".
    const brief = text(renderToStaticMarkup(createElement(CheckBrief, { report: outcome.report, applied: [], decisions: [], price: null, preview: true })));
    expect(brief).toContain("Rule breaks: 0.");
    expect(brief).not.toContain("0 of 0");
  });
});

describe("round 35: a real paste survives first contact", () => {
  // Every name is invented. Line 4's start is 25:70; one stage is written "Main   Stage".
  const MESSY = [
    "Tidal Fields,Main Stage,14:00,15:00",
    "Cobalt Rows,Side Stage,14:15,15:15",
    "Paper Lanterns,Tent,14:30,15:15",
    "Glass Harbour,Tent,25:70,19:30",
    "Saltmarsh,Main Stage,15:30,16:30",
    "Quiet Engine,Side Stage,15:45,16:45",
    "Nobody Has Heard Of Us,Tent,16:00,16:45",
    "Velvet Static,Main   Stage,17:00,18:00",
    "Orbit Choir,Side Stage,17:15,18:15",
    "Lowland Kites,Tent,17:30,18:15",
    "Amber Kite,Main Stage,18:30,19:30",
    "Ember Coast,Side Stage,18:45,19:45",
  ].join("\n");
  const source = readFileSync(fileURLToPath(new URL("./check-tool.tsx", import.meta.url)), "utf8");
  const tool = (grid: string, checkOnLoad = true) =>
    renderToStaticMarkup(createElement(CheckTool, { initial: { grid, changeover: "", curfew: "", pairs: "" }, checkOnLoad }));

  it("takes a paste on the Table view: a focusable region whose paste lands in the CSV editor, checks nothing and says so once", () => {
    const html = renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }));
    const region = html.match(/<div [^>]*data-paste-target=""[^>]*>(?=<div><div class="px-2 max-sm:px-1"><table)/)?.[0] ?? "";
    expect(region).toContain('role="region"');
    expect(region).toContain('aria-label="Draft grid as a table. Paste a grid here to edit it as CSV."');
    expect(region).toContain('tabindex="0"');
    // Its focus ring is the panel's (round 34's 14px corner), never a square ring of its own.
    expect(region).toContain('class="outline-none focus-visible:outline-none"');
    expect(source).toContain("onPaste={pasteOnTable}");
    const paste = source.slice(source.indexOf("function pasteOnTable("), source.indexOf("/** A rule break's row button"));
    expect(paste).toContain('event.clipboardData.getData("text/plain")');
    expect(paste).toContain('update("grid", text);');
    expect(paste).toContain('setView("csv");');
    expect(paste).toContain("setNote(pastedLine(text));");
    expect(paste).toContain("setFocusGrid((count) => count + 1);");
    // Nothing is checked on a paste, and nothing leaves: no check, no request.
    expect(paste).not.toMatch(/\bcheck\(|runCheck|requestPrice|fetch/);
    // The polite region is always in the page, so the paste line is said even with no check on show.
    expect(source).toMatch(/<p role="status" aria-live="polite" className="sr-only">\s*\{note \|\| \(run && outcome\?\.ok/);
    // Said once: the paste's note already says to check again, so while it is the note on show the stale
    // line ("You changed the grid or settings…") is drawn in the same place outside any live region.
    expect(paste).toContain("setPasteNote(pastedLine(text));");
    expect(source).toContain('const saidByPaste = note !== "" && note === pasteNote;');
    expect(source).toMatch(
      /<div role="status" className="empty:hidden print:hidden">\s*\{stale && !saidByPaste \? <p className="text-sm font-semibold text-warning">\{TRIAL_COPY\.stale\}<\/p> : null\}\s*<\/div>/,
    );
    const quiet = source.match(/\{stale && saidByPaste \? \(\s*(<div data-stale-quiet="" className="print:hidden">[\s\S]*?<\/div>)\s*\) : null\}/)?.[1] ?? "";
    expect(quiet).toContain('<p className="text-sm font-semibold text-warning">{TRIAL_COPY.stale}</p>');
    expect(quiet).not.toMatch(/role=|aria-live/);
    // Any other note (a check clears it to blank) puts the stale line back in its live region.
    expect(source).toMatch(/const check = useCallback\([\s\S]*?setNote\(""\);/);
  });

  it("checks the readable lines of a messy paste and opens its results with what it skipped", () => {
    const html = tool(MESSY);
    const page = text(html);
    expect(html).not.toContain("The grid was not checked.");
    const notice = html.match(/<div data-skipped="" class="([^"]*)">([\s\S]*?)<\/div>/);
    expect(notice?.[1]).toBe("rounded-md border border-border-strong bg-card p-4 text-sm leading-relaxed print:hidden");
    // The quoted value is HTML-escaped in markup; read it as the page shows it.
    expect(text(notice?.[2] ?? "").replace(/&quot;/g, '"')).toBe(
      '1 line skipped and not checked: line 4. The other 11 sets were checked. Line 4 (Glass Harbour): the start time "25:70" is not a time such as 18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm.',
    );
    // First in the results, right under their header line.
    expect(html.indexOf("data-skipped=")).toBeLessThan(html.indexOf("Read 11 sets on 3 stages."));
    expect(html).toMatch(/<div class="scroll-mt-24 print:hidden"><p class="[^"]*">Checked<\/p><\/div><div data-skipped=""/);
    expect(page).toContain("No rule breaks found among the 11 sets checked, against the settings above.");
    expect(page).not.toContain("No rule breaks found against the settings above.");
    // The preview beside the sheet says it too, under its verdict, and draws no outline.
    expect(html).toMatch(/<p data-preview-skipped="" class="[^"]*text-muted-foreground">1 line skipped and not checked: line 4\. The other 11 sets were checked\.<\/p>/);
    expect(html).not.toContain("data-preview-box");
    // The live region says the sentence before the counts.
    expect(html).toMatch(/<p role="status" aria-live="polite" class="sr-only">1 line skipped and not checked: line 4\. The other 11 sets were checked\. Rule breaks: 0\./);
  });

  it("marks each skipped line beside the editor, its number in ink with the word, and leaves the field's own classes alone", () => {
    const html = tool(MESSY);
    const gutter = html.match(/<div data-gutter="" class="([^"]*)">([\s\S]*?)<\/div><textarea/);
    expect(gutter?.[1].split(" ")).toContain("w-24");
    // Round 37 (L64): the mark is a button that selects the rejected value; its number in ink with the word stays.
    expect(gutter?.[2]).toContain(
      '<div><button type="button" data-skipped-line="4" aria-label="Select the rejected value on line 4" class="rounded-sm font-semibold whitespace-nowrap text-foreground decoration-1 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">skipped 4</button></div>',
    );
    expect((gutter?.[2].match(/data-skipped-line/g) ?? []).length).toBe(1);
    // The column header's gutter keeps the same width, so the names stay over their columns.
    expect(html).toContain('<span class="shrink-0 border-r border-border w-24"></span>');
    // The field is the same field: no class added for a skipped line.
    const field = html.match(/<textarea[^>]*rows="8"[^>]*class="([^"]*)"/)?.[1];
    const plain = tool(SAMPLE_GRID).match(/<textarea[^>]*rows="8"[^>]*class="([^"]*)"/)?.[1];
    expect(field).toBe(plain);
    // With nothing skipped, the gutter stays 40px and marks nothing.
    expect(tool(SAMPLE_GRID)).not.toContain("data-skipped-line");
    expect(tool(SAMPLE_GRID)).toMatch(/data-gutter="" class="[^"]* w-10 /);
    // Marks follow the text that was checked: an edit hides them until the next check.
    expect(source).toContain("const marked = !stale && skippedLines.length > 0 ? new Set(skippedLines.map((item) => item.line)) : null;");
    // A check that skipped lines shows the text, and the editor's own scroll brings the first into view.
    expect(source).toContain('if (outcome.ok && (outcome.report.skipped ?? []).length > 0) setView("csv");');
    expect(source).toMatch(/const first = run\.outcome\.report\.skipped\?\.\[0\];[\s\S]*?area\.scrollTop = Math\.max\(0, top - line\);/);
  });

  it("says the preview is unavailable in the outline's own box, at its height, when the text does not read", () => {
    const unreadable = tool("A,Main,25:70,19:00\nOnly,two", false);
    const box = unreadable.match(/<div data-preview-box="" class="relative mt-3"><div aria-hidden="true" class="([^"]*)">([\s\S]*?)<\/div><p data-preview-unavailable="" class="([^"]*)">([^<]*)<\/p><\/div>/);
    expect(box?.[1]).toBe("space-y-3 invisible");
    expect((box?.[2].match(/<span /g) ?? []).length).toBe(6);
    expect(box?.[3]).toBe("absolute inset-x-0 top-0 text-sm leading-5 text-muted-foreground");
    expect(box?.[4]).toBe("Preview unavailable: fix the lines listed and check again.");
    // An empty field keeps the outline drawn, with no notice.
    const empty = renderToStaticMarkup(createElement(CheckTool, {}));
    expect(empty).toMatch(/<div data-preview-box="" class="relative mt-3"><div aria-hidden="true" class="space-y-3">/);
    expect(empty).not.toContain("data-preview-unavailable");
  });

  it("adds the separator hint once after the line messages when the lines look separated by semicolons", () => {
    // Under a comma header (the first line sets the separator); a grid read by semicolons from line 1 reads.
    const html = tool(`act,stage,start,end\n${MESSY.split(",").join(";")}`);
    const alert = html.slice(html.indexOf('role="alert"'), html.indexOf("</ul>", html.indexOf('role="alert"')) + 200);
    expect(alert).toContain("The grid was not checked.");
    expect(alert).toMatch(/<\/ul><p data-separator-hint="" class="mt-2 break-words">These lines look separated by semicolons\. Use commas or tabs between act, stage, start and end\.<\/p>/);
    expect(html.split("These lines look separated by semicolons.").length - 1).toBe(1);
    expect(tool(MESSY)).not.toContain("separated by semicolons");
    // Fix pass: the whole messy paste in semicolons is checked like the comma one: 11 sets, line 4 skipped, no hint.
    const semicolons = tool(MESSY.split(",").join(";"));
    expect(semicolons).not.toContain("The grid was not checked.");
    expect(text(semicolons)).toContain("1 line skipped and not checked: line 4. The other 11 sets were checked.");
    expect(semicolons).not.toContain("separated by semicolons");
  });

  it("measures the rule check of every check a visitor runs, says it in the results header, and never keeps or sends it", () => {
    const check = source.slice(source.indexOf("const check = useCallback("), source.indexOf("// Any edit to the paste or the settings"));
    expect(check).toMatch(/const started = performance\.now\(\);\s*const outcome = runCheck\(next\);\s*const ms = Math\.max\(1, Math\.round\(performance\.now\(\) - started\)\);/);
    expect(check).toContain("...(outcome.ok ? { ms } : {}),");
    expect(source).toContain("{checkTimeLine(pasted.sets.length, pasted.stages.length, run.ms)}");
    // The sample the page opens with ran on no press: no time, the plain Checked label, nothing to differ on hydration.
    expect(source.replace(/\/\*\*[\s\S]*?\*\//g, "").match(/performance\.now\(\)/g)).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(CheckTool, { startWithSample: true }))).not.toContain("data-check-time");
    // Never stored, never sent, never time saved.
    for (const word of [/ms[^\n]*localStorage/, /ms[^\n]*priceBody/, /time saved/i]) expect(source).not.toMatch(word);
  });

  it("loses no skipped line from the downloaded file: a check that skipped lines downloads the text as pasted", () => {
    expect(source).toContain("!working && skippedLines.length > 0 ? run.input.grid : gridText(shown.sets)");
  });

  it("scrolls to the results' top only once the preview reads the checked text, so nothing above moves after the scroll", () => {
    expect(source).toMatch(/if \(!scrollPending\.current \|\| previewInput !== input\) return;/);
    expect(source).toContain("(workingRef.current ?? resultsTopRef.current ?? headingRef.current)?.scrollIntoView({ block: \"start\" });");
  });
});

describe("round 36: the rail splits rule breaks from overlaps, a published day's locks are this app's, a header is named", () => {
  const source = readFileSync(fileURLToPath(new URL("./check-tool.tsx", import.meta.url)), "utf8");
  const tool = (grid: string) =>
    renderToStaticMarkup(createElement(CheckTool, { initial: { grid, changeover: "", curfew: "", pairs: "" }, checkOnLoad: true }));
  const counts = { sets: 25, stages: 4, breaks: 4, breaksReviewed: 0, pairs: 35, pairsDecided: 0, kept: 0, notChanging: 0, changed: 0, openBreaks: 4, openPairs: 35 };
  const review = (over: Partial<typeof counts>) =>
    text(
      renderToStaticMarkup(
        createElement(CheckReview, {
          counts: { ...counts, ...over },
          sample: false,
          price: { phase: "idle" },
          searched: 0,
          applied: 0,
          stale: false,
          onPrint: () => {},
          onCopy: () => {},
          onDownload: () => {},
          canShare: true,
          share: null,
        }),
      ),
    );

  it("says what is open as rule breaks to review and overlaps to decide, singular at 1, a part left out at 0", () => {
    expect(openLine({ openBreaks: 4, openPairs: 35 })).toBe("4 rule breaks to review · 35 overlaps to decide");
    expect(openLine({ openBreaks: 1, openPairs: 1 })).toBe("1 rule break to review · 1 overlap to decide");
    expect(openLine({ openBreaks: 0, openPairs: 2 })).toBe("2 overlaps to decide");
    expect(openLine({ openBreaks: 3, openPairs: 0 })).toBe("3 rule breaks to review");
    expect(openLine({ openBreaks: 0, openPairs: 0 })).toBeNull();
    // The heading's line and the Open row say the same; with nothing open, the all-decided text and None.
    expect(review({})).toMatch(/^Draft review 4 rule breaks to review · 35 overlaps to decide /);
    expect(review({})).toContain("Open 4 rule breaks to review · 35 overlaps to decide");
    expect(review({ openBreaks: 0, openPairs: 0 })).toMatch(/^Draft review Every finding decided /);
    expect(review({ openBreaks: 0, openPairs: 0 })).toContain("Open None");
    expect(review({})).not.toMatch(/\d+ open\b/);
  });

  it("says a published day's locks are this app's: the last set on each stage where that holds, else the plain form", () => {
    const grid = (lastLocked: boolean) =>
      [
        "act,stage,start,end,locked",
        "Amber Kite,Big Top,18:30,20:00,",
        `Basalt Choir,Big Top,21:00,22:30,${lastLocked ? "yes" : ""}`,
        `Copper Field,Barn,19:00,20:30,${lastLocked ? "" : "yes"}`,
        "Dune Signal,Barn,21:30,23:20,yes",
      ].join("\n");
    const holds = runCheck({ grid: grid(true), changeover: "", curfew: "", pairs: "" });
    const not = runCheck({ grid: grid(false), changeover: "", curfew: "", pairs: "" });
    if (!holds.ok || !not.ok) throw new Error("refused");
    expect(lockedClause(holds.report, true)).toBe("; 2 locked by this app (the last set on each stage); the festival did not mark them.");
    // The locks are not exactly the stages' last sets (one is earlier on its stage, one stage's last is free).
    expect(lockedClause(not.report, true)).toBe("; 2 locked by this app; the festival did not mark them.");
    // A pasted grid or the sample keeps its own words, and no locks say nothing.
    expect(lockedClause(holds.report, false)).toBe("; 2 marked locked.");
    expect(lockedClause({ sets: [], lockedCount: 0 }, true)).toBe(".");
    const render = (published: boolean) =>
      text(
        renderToStaticMarkup(
          createElement(CheckResults, { report: holds.report, decisions: new Map(), onDecide: () => {}, showAll: false, onShowAll: () => {}, nonce: 1, published }),
        ),
      );
    expect(render(true)).toContain(
      "Read 4 sets on 2 stages; 2 locked by this app (the last set on each stage); the festival did not mark them. Locked sets are still checked against your rules; they are only kept in place when you search for a change.",
    );
    expect(render(false)).toContain("Read 4 sets on 2 stages; 2 marked locked. Locked sets are still checked against your rules;");
    for (const page of [render(true), render(false)]) expect(page).not.toMatch(/not by the festival/i);
    // The page passes the flag only for a published day as loaded.
    expect(source).toContain("published={Boolean(run.published)}");
  });

  it("shows a header it cannot read as one message, and reads a time-range column and dotted times with no refusal", () => {
    const refused = tool("Act,Stage,Start,Endzeit\nTidal Fields,Main,18:00,19:00\nCobalt Rows,Side,xx,20:00");
    const alert = refused.slice(refused.indexOf('role="alert"'), refused.indexOf("</ul>", refused.indexOf('role="alert"')));
    expect(alert.match(/<li>/g)).toHaveLength(1);
    expect(text(alert).replace(/&quot;/g, '"')).toContain(
      'Line 1: no column reads as end. Not read: "Endzeit". For end this check reads: end, end time, ends, finish, finish time, finishes, until, to, set end.',
    );
    for (const grid of [
      "Act,Stage,Set time\nTidal Fields,Main,18:00-19:00\nCobalt Rows,Side,6pm to 7:15pm",
      [
        "Tidal Fields,Main,6.30pm,7.30 pm",
        "Cobalt Rows,Side,6.30 pm,19:30",
        "Paper Lanterns,Tent,18.30,1930",
        "Saltmarsh,Field,1830,19:45",
        "Quiet Engine,Barn,18h30,20h00",
        "Lowland Kites,Dome,6:30p,7:30p",
      ].join("\n"),
    ]) {
      const html = tool(grid);
      expect(html).not.toContain("The grid was not checked.");
      expect(html).not.toContain("data-skipped=");
    }
  });

  // Fix pass: every published day the API names is one press from the one on show, through the one button.
  it("offers the first published day, then the next one while a published day is on show as loaded", () => {
    const glastonbury = { id: "glastonbury-2025-sun", title: "Glastonbury 2025, Sunday" };
    const riot = { id: "riot-fest-2026-sun", title: "Riot Fest 2026, Sunday" };
    const days = [glastonbury, riot];
    expect(offeredDay(days, null)).toBe(glastonbury);
    expect(offeredDay(days, glastonbury.id)).toBe(riot);
    expect(offeredDay(days, riot.id)).toBe(glastonbury);
    // A day no longer named, one day only, none and not yet answered.
    expect(offeredDay(days, "gone")).toBe(glastonbury);
    expect(offeredDay([glastonbury], glastonbury.id)).toBe(glastonbury);
    expect(offeredDay([], null)).toBeNull();
    expect(offeredDay(null, null)).toBeNull();
    expect(offeredDay(undefined, null)).toBeUndefined();
    // The page passes the loaded day's id only while its fields are as loaded; the one button keeps its words.
    expect(source).toContain("const publishedDay = offeredDay(publishedDays, editingPublished ? publishedFrom : null);");
    expect(source.match(/Check a published day: \{publishedDay\.title\}/g)).toHaveLength(1);
  });
});

describe("round 37: the rejected value in the editor, a paste with nothing focused, a late published day", () => {
  const source = readFileSync(fileURLToPath(new URL("./check-tool.tsx", import.meta.url)), "utf8");
  // Every name is invented. Line 4's start is 25:70 (the guard's CHECK-SKIP grid).
  const MESSY = [
    "Tidal Fields,Main Stage,14:00,15:00",
    "Cobalt Rows,Side Stage,14:15,15:15",
    "Paper Lanterns,Tent,14:30,15:15",
    "Glass Harbour,Tent,25:70,19:30",
    "Saltmarsh,Main Stage,15:30,16:30",
    "Quiet Engine,Side Stage,15:45,16:45",
    "Nobody Has Heard Of Us,Tent,16:00,16:45",
    "Velvet Static,Main   Stage,17:00,18:00",
    "Orbit Choir,Side Stage,17:15,18:15",
    "Lowland Kites,Tent,17:30,18:15",
    "Amber Kite,Main Stage,18:30,19:30",
    "Ember Coast,Side Stage,18:45,19:45",
  ].join("\n");
  const tool = (grid: string) =>
    renderToStaticMarkup(createElement(CheckTool, { initial: { grid, changeover: "", curfew: "", pairs: "" }, checkOnLoad: true }));
  /** The value each skipped line of `grid` would select, by line. */
  const selected = (grid: string) => {
    const parsed = parseGrid(grid);
    const skipped = parsed.skipped ?? [];
    return skipped.map((item) => {
      const range = rejectedRange(grid, item);
      return [item.line, range ? grid.replace(/\r\n?/g, "\n").slice(range.start, range.end) : null] as const;
    });
  };

  afterEach(() => vi.unstubAllGlobals());

  it("L64: finds exactly the characters of the value a skipped line's message quotes, on that line", () => {
    const parsed = parseGrid(MESSY);
    if (!parsed.ok) throw new Error("the messy grid should read");
    const range = rejectedRange(MESSY, parsed.skipped[0]);
    expect(range).toEqual({ start: MESSY.indexOf("25:70"), end: MESSY.indexOf("25:70") + 5 });
    expect(selected(MESSY)).toEqual([[4, "25:70"]]);
    // An end time, a locked flag and a set-time range, each the field's own characters (not the "ax" in an act's name).
    const grid = [
      "act,stage,start,end,locked",
      "Maxx,Main,18:00,19:00,",
      "Paper Lanterns,Tent,18:00,9pmx,",
      "Saltmarsh,Main,20:00,21:00,maybe",
      "Max Axe,Barn,20:00,21:00,ax",
    ].join("\n");
    expect(selected(grid)).toEqual([
      [3, "9pmx"],
      [4, "maybe"],
      [5, "ax"],
    ]);
    // The flag's own two characters at the end of line 5, not the "ax" inside the act's name.
    const flag = rejectedRange(grid, (parseGrid(grid).skipped ?? [])[2]);
    expect(flag?.start).toBe(grid.length - 2);
    const ranges = ["act,stage,time", "Quiet Engine,Tent, 6pm until 7pm "].join("\n");
    expect(selected(ranges)).toEqual([[2, "6pm until 7pm"]]);
  });

  it("L64: reads quotes, tabs, semicolons, line breaks and a value the message cut, and claims nothing it cannot find", () => {
    // A quoted field: the characters inside its quotes.
    expect(selected('Amber Kite,Main,18:00,19:00\n"Basalt Choir","Main","25:99","20:00"')).toEqual([[2, "25:99"]]);
    // Tabs, and semicolons from the first line.
    expect(selected("Amber Kite\tMain\t18:00\t19:00\nBasalt Choir\tMain\t7 pm-ish\t20:00")).toEqual([[2, "7 pm-ish"]]);
    expect(selected("Amber Kite;Main;18:00;19:00\nBasalt Choir;Main;18,30;20:00")).toEqual([[2, "18,30"]]);
    // Windows line breaks: the offsets are those of the field's text, which holds "\n" only.
    const crlf = "Amber Kite,Main,18:00,19:00\r\nBasalt Choir,Main,18:00,19:7O";
    expect(selected(crlf)).toEqual([[2, "19:7O"]]);
    // A value longer than 30 characters is quoted cut: the whole field is selected.
    const long = "Amber Kite,Main,18:00,19:00\nBasalt Choir,Main,half past six in the evening maybe,20:00";
    expect(parseGrid(long).skipped?.[0]?.message).toContain("…");
    expect(selected(long)).toEqual([[2, "half past six in the evening maybe"]]);
    // A message that quotes no value selects nothing.
    expect(selected("Amber Kite,Main,18:00,19:00\nBasalt Choir,Main,20:00,19:00")).toEqual([[2, null]]);
    // A line that no longer holds the value selects nothing.
    const [item] = parseGrid(MESSY).skipped ?? [];
    expect(rejectedRange(MESSY.replace("25:70", "15:00"), item)).toBeNull();
    expect(rejectedRange("one line", item)).toBeNull();
  });

  it("L64: the skipped line's mark is a button named for its line, and the results offer 'Show it in the grid' under the message", () => {
    const html = tool(MESSY);
    const mark = html.match(/<button type="button" data-skipped-line="4"[^>]*>([^<]*)<\/button>/);
    expect(mark?.[0]).toContain('aria-label="Select the rejected value on line 4"');
    // The visible mark stays.
    expect(mark?.[1]).toBe("skipped 4");
    // Directly under the skip message, one text action with its words, a 44px target and the focus ring.
    const action = html.match(/<\/div><div data-show-rejected="" class="-mt-3 print:hidden">(<button[^>]*>[^<]*<\/button>)<\/div>/);
    expect(action?.[1]).toMatch(/^<button[^>]*type="button"[^>]*>Show it in the grid<\/button>$/);
    expect(action?.[1]).toContain("min-h-11");
    expect(action?.[1]).toContain("focus-visible:outline-ring");
    expect(html.indexOf('data-skipped=""')).toBeLessThan(html.indexOf("data-show-rejected"));
    expect(html.split("Show it in the grid").length - 1).toBe(1);
    // Nothing skipped, or a first skipped line whose message quotes no value: no action, and a plain mark.
    expect(tool(SAMPLE_GRID)).not.toContain("Show it in the grid");
    const unquoted = tool("Amber Kite,Main,18:00,19:00\nBasalt Choir,Main,20:00,19:00\nCopper Field,Barn,18:00,19:00");
    expect(unquoted).not.toContain("Show it in the grid");
    expect(unquoted).toMatch(/<div aria-hidden="true" data-skipped-line="2" class="font-semibold whitespace-nowrap text-foreground">skipped 2<\/div>/);
    expect(unquoted).not.toContain("Select the rejected value");
  });

  it("L64: either control shows the text view, focuses the field with the value selected and brings its line into view", () => {
    expect(source).toMatch(/onClick=\{\(\) => showRejected\(line \+ 1\)\}/);
    expect(source).toMatch(/onClick=\{\(\) => showRejected\(firstRejected\)\}/);
    const show = source.slice(source.indexOf("function showRejected("), source.indexOf("/** A rule break's row button"));
    expect(show).toContain('setView("csv");');
    const effect = source.slice(source.indexOf("// A skipped line's rejected value, asked for"), source.indexOf("// After a paste the page took"));
    expect(effect).toContain("const range = area && item ? rejectedRange(area.value, item) : null;");
    expect(effect).toContain("area.focus({ preventScroll: true });");
    expect(effect).toContain("area.setSelectionRange(range.start, range.end);");
    // The nearest edge, in the field and on the page; no smooth scroll under reduced motion.
    expect(effect).toContain("if (top < area.scrollTop) area.scrollTop = top;");
    expect(effect).toContain("else if (top + line > area.scrollTop + shown) area.scrollTop = top + line - shown;");
    expect(effect).toContain('window.scrollBy({ top: by, behavior: reduce ? "auto" : "smooth" });');
    // Each request is handled once, so a later check never selects the value again.
    expect(effect).toContain("rejectedDone.current = rejectedPick.nonce;");
  });

  it("L65: a paste with nothing that takes typing focused goes into the editor; a paste into a field is left alone", () => {
    expect(takesPaste(null)).toBe(false);
    for (const tagName of ["BODY", "BUTTON", "A", "DIV"]) expect(takesPaste({ tagName, isContentEditable: false })).toBe(false);
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "textarea"]) expect(takesPaste({ tagName, isContentEditable: false })).toBe(true);
    expect(takesPaste({ tagName: "DIV", isContentEditable: true })).toBe(true);
    // One listener for the page's life, which leaves a paste a field or the table's own region took alone.
    expect(source).toMatch(/window\.addEventListener\("paste", onPaste\);\s*return \(\) => window\.removeEventListener\("paste", onPaste\);/);
    expect(source).toContain("if (event.defaultPrevented || takesPaste(document.activeElement as HTMLElement | null)) return;");
    // As a paste into the editor: with the table on show, as the table's own paste; in the text view, at the caret.
    const page = source.slice(source.indexOf("function pasteFromPage("), source.indexOf("/** A skipped line's mark"));
    expect(page).toContain('if (view === "table") {\n      pasteOverGrid(text);');
    expect(page).toContain("update(\"grid\", `${current.slice(0, start)}${pasted}${current.slice(end)}`);");
    // Said once, in the polite live region, as the table's paste says it.
    expect(page).toContain("setNote(pastedLine(text));");
    expect(page).toContain("setPasteNote(pastedLine(text));");
    // Nothing is checked, sent or stored, and the address is left alone.
    expect(page).not.toMatch(/\bcheck\(|runCheck|requestPrice|fetch|localStorage|sessionStorage|history\.|location\./);
  });

  // An invented published day in the route's shape, as round 31's test builds one.
  const day = {
    id: "brookfield-2030-sat",
    title: "Brookfield 2030, Saturday",
    synthetic: false,
    festival: {
      stages: [
        { id: "big", name: "Big Top" },
        { id: "barn", name: "Barn" },
      ],
      acts: [
        { id: "a", name: "Amber Kite" },
        { id: "b", name: "Basalt Choir" },
      ],
      timetable: [
        { act_id: "a", day: 0, stage_id: "big", start: 1110, end: 1200, locked: false },
        { act_id: "b", day: 0, stage_id: "barn", start: 1140, end: 1230, locked: false },
      ],
      constraints: { changeover_minutes: 20, curfew: { "0": 1425 }, no_clash_with: [], billing_rules: [] },
    },
  };

  /** A fetch whose answer waits until `release` is called; every request it gets is listed. */
  function delayedFetch(body: unknown) {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      await gate;
      return { ok: true, json: async () => body } as unknown as Response;
    });
    return { release: () => open(), calls };
  }

  it("L70: a paste made while a published day loads stays, the late day is dropped, and the page says so once", async () => {
    const { release, calls } = delayedFetch(day);
    // The page's count of presses and the editor's text, as the tool keeps them.
    const page = { latest: 1, grid: "" };
    const pending = awaitPublishedDay(day.id, { n: 1, grid: page.grid }, () => ({ latest: page.latest, grid: page.grid }));
    // The visitor pastes a grid before the answer arrives.
    page.grid = "Pasted Act,Main,18:00,19:00";
    release();
    expect(await pending).toEqual({ kind: "kept" });
    expect(page.grid).toBe("Pasted Act,Main,18:00,19:00");
    expect(calls).toEqual([`GET /api/presets/${day.id}`]);
    expect(PUBLISHED_KEPT).toBe("Kept your pasted grid; ignored the published day that arrived later.");
    // Said once, in the status line under the actions that said "Loading the published timetable." at the press.
    expect(source.match(/PUBLISHED_KEPT/g)).toHaveLength(2);
    expect(source).toMatch(/if \(answer\.kind === "kept"\) \{\s*setPublishedNote\(PUBLISHED_KEPT\);\s*return;\s*\}/);
    expect(source).toMatch(/\{publishedNote \? \(\s*<p role="status" className="mt-1 text-sm font-semibold">\s*\{publishedNote\}/);
    // The press is counted and the editor's text kept with it; the text as last drawn is what the answer meets.
    expect(source).toContain("const press: PublishedPress = { n: publishedPresses.current, grid: input.grid };");
    expect(source).toMatch(/useLayoutEffect\(\(\) => \{\s*gridNow\.current = input\.grid;\s*\}, \[input\.grid\]\);/);
  });

  it("L70: with no paste the published day loads and is checked as before", async () => {
    const { release } = delayedFetch(day);
    const pending = awaitPublishedDay(day.id, { n: 1, grid: "" }, () => ({ latest: 1, grid: "" }));
    release();
    const answer = await pending;
    expect(answer.kind).toBe("load");
    if (answer.kind !== "load") return;
    expect(answer.day).toEqual(publishedDayInput(day));
    const load = source.slice(source.indexOf("async function loadPublished("), source.indexOf('/** "Clear"'));
    expect(load).toMatch(/const day = answer\.day;\s*setPublishedNote\(""\);[\s\S]*setInput\(day\.input\);[\s\S]*check\(day\.input, "Published timetable loaded\. "\);/);
  });

  it("L70: a later press wins without a word, and a day that did not load leaves the fields alone", async () => {
    expect(publishedArrival({ n: 1, grid: "a" }, 2, "a")).toBe("later");
    expect(publishedArrival({ n: 1, grid: "a" }, 2, "b")).toBe("later");
    expect(publishedArrival({ n: 2, grid: "a" }, 2, "a")).toBe("load");
    expect(publishedArrival({ n: 2, grid: "a" }, 2, "b")).toBe("kept");
    const later = delayedFetch(day);
    const first = awaitPublishedDay(day.id, { n: 1, grid: "" }, () => ({ latest: 2, grid: "" }));
    later.release();
    expect(await first).toEqual({ kind: "later" });
    vi.unstubAllGlobals();
    const failed = delayedFetch(null);
    const none = awaitPublishedDay(day.id, { n: 1, grid: "" }, () => ({ latest: 1, grid: "changed" }));
    failed.release();
    expect(await none).toEqual({ kind: "failed" });
    expect(source).toMatch(/if \(answer\.kind === "later"\) return;/);
  });
});
