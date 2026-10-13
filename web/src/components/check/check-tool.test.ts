import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseGrid, runCheck } from "@/lib/check";
import { breakDecisionId } from "@/lib/check-decisions";
import { SAMPLE_GRID, SAMPLE_SETTINGS } from "@/lib/check-sample";

import { RULE_LABELS } from "@/lib/check";

import { CheckResults, breakMarks, nextStep } from "./check-results";
import { BreakStrip } from "./check-break-strip";
import {
  BreakItem,
  CheckTool,
  GridTable,
  PREVIEW_PAIRS,
  SharedPreview,
  escapeClears,
  foldedLines,
  remedyAnchor,
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

  it("reads like a price list: each act (stage) on its own line, the window in 12px mono, the minutes set right once", () => {
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
    // Each break: its numbered disc and the rule in 15px, as the same selection button as the results, then its rows with the row number and time in mono.
    expect(preview).toMatch(
      /<button type="button" aria-pressed="false" class="[^"]*"><svg aria-hidden="true"[^>]*data-break-disc="1"[\s\S]*?<span class="sr-only">Rule break 1\. <\/span><span class="text-\[0\.9375rem\] leading-snug">Act on two stages at once<\/span>/,
    );
    expect(preview).toMatch(/<span class="font-mono text-muted-foreground tabular-nums">row \d+<\/span>/);
    // No floating numeral, no vermilion square beside "Checked".
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

  it("frames the sheet as the editor surface, clipped, with an unfilled header, inset horizontal rules only and Clear alone on a quiet row under it", () => {
    // A field in the ruled style: the card fill between a 1px border-strong rule above and below, no side
    // edges and no radius class at all (a bare rounded-none is banned), its focus outline kept.
    expect(html).toMatch(
      /<div class="overflow-hidden border-y border-border-strong bg-card has-\[textarea:focus-visible\]:outline-2 has-\[textarea:focus-visible\]:outline-offset-2 has-\[textarea:focus-visible\]:outline-ring">/,
    );
    const frame = html.match(/<div class="(overflow-hidden border-y border-border-strong bg-card[^"]*)"/)?.[1] ?? "";
    expect(frame).not.toMatch(/(^|\s)(rounded(-[a-z0-9]+)?|border|border-surface-edge|border-x|border-l|border-r)(\s|$)/);
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
  const surface = html.slice(html.indexOf('<div class="overflow-hidden border-y border-border-strong bg-card'));
  const header = surface.slice(0, surface.indexOf("<table"));
  // The sheet's name row: from the name's label to the sheet's frame.
  const nameRow = html.slice(html.indexOf("<label"), html.indexOf('<div class="overflow-hidden border-y border-border-strong bg-card'));

  it("sits inside the sheet at the top: one wrapping row over an inset hairline, Table / CSV first in source and on screen", () => {
    expect(header).toMatch(
      /^<div class="overflow-hidden[^"]*"><div class="relative flex flex-wrap items-center justify-between gap-3 [^"]*after:inset-x-4 after:bottom-0 after:h-px after:bg-border/,
    );
    // The switch is the bar's first child (no order trick) and keeps its own props: the same radio group and values.
    expect(header).toMatch(/after:content-\[&#x27;&#x27;\]"><div role="radiogroup" aria-label="Show the draft grid as"/);
    expect(html).not.toContain("order-first");
    // The sheet's name stays above the sheet.
    expect(html.indexOf("Invented sample, to show the format")).toBeLessThan(html.indexOf("overflow-hidden border-y border-border-strong"));
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
    // (The frame's own rule above and below is border-strong; inside it, no control is outlined.)
    expect(header.slice(header.indexOf(">") + 1)).not.toContain("border-border-strong");
    expect(header).not.toContain("border-[1.5px]");
    expect(header).not.toContain("&middot;");
    // No control was added: the bar holds the check and the two tabs, the name row the two utilities, nothing else.
    expect(header.match(/<button/g)).toHaveLength(1);
    expect(header.match(/<input type="radio"/g)).toHaveLength(2);
    expect(nameRow.match(/<button/g)).toHaveLength(2);
    expect(nameRow).not.toMatch(/<(input|select|textarea|a)\b/);
    expect(header).not.toContain(">Clear<");
  });

  it("sets the two utilities as one group at the right of the name from sm, on the name's line or wrapped whole under it, and on a phone on their own lines at the left", () => {
    const row = nameRow.match(/^<label[^>]*>Draft grid<\/label>(?:<span[^>]*>[^<]*<\/span>)?<\/div><div class="([^"]*)"><button/)?.[1] ?? "";
    // The 44px hit areas pulled 10px into the row above and below (its 12px foot keeps them clear of the frame),
    // the last word's edge on the column's edge.
    expect(row.split(" ")).toEqual(expect.arrayContaining(["ml-auto", "flex", "flex-wrap", "items-center", "max-sm:ml-0", "sm:-my-2.5", "sm:-mr-2"]));
    const outer = html.match(/<div class="([^"]*)"><div class="flex min-w-0 flex-wrap items-baseline gap-x-2\.5 gap-y-0\.5"><label/)?.[1] ?? "";
    // The pair wraps whole under the name where the row is too narrow, 10px under it so no hit area reaches its text.
    expect(outer.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-wrap", "items-start", "gap-x-6", "sm:gap-y-2.5"]));
    expect(html).toMatch(/<div class="min-w-0 pb-2 sm:pb-3 lg:col-start-1 lg:row-start-1"><div class="flex min-w-0 flex-wrap/);
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

  it("marks exactly the rows the break names with the wash inside a 1px ink edge, never vermilion, and no left stripe", () => {
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
    // The pressed heading takes the wash and an ink outline, never vermilion.
    const pressed = render(breakDecisionId(report.breaks[0], report.sets));
    const on = pressed.match(/<h3[^>]*><button[^>]*aria-pressed="true"[^>]*>/)?.[0] ?? "";
    expect(on).toContain("aria-pressed:bg-accent");
    expect(on).toContain("aria-pressed:not-focus-visible:outline-foreground");
    expect(on).not.toContain("primary");
    // Row references: visible 12px mono buttons on an 8px corner with a control edge, 44px to the pointer.
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
    // Discs are inline SVG circles, never a rounded-full box.
    expect(html).toMatch(/<circle[^>]*fill="var\(--primary\)"/);
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

  it("prints each shown row's grid number, the number the results cite, as plain 12px muted mono text set right", () => {
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
    const gutter = page.match(/<div aria-hidden="true" class="w-10 shrink-0[^"]*">([\s\S]*?)<\/div><textarea/)?.[1] ?? "";
    const numbers = [...gutter.matchAll(/<div>(\d+)<\/div>/g)].map((m) => Number(m[1]));
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

  it("(case c) draws it directly after the first cited row, with the other cited rows as plain 12px mono muted labels", () => {
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
      // Never vermilion text: only the disc is.
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
    const start = page.indexOf('<div class="min-w-0 pb-2 sm:pb-3 lg:col-start-1 lg:row-start-1">');
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
    expect(buttons[0].classes.endsWith(" px-2 decoration-1 underline-offset-4 hover:bg-transparent hover:underline max-sm:-ml-2")).toBe(true);
    expect(buttons[1].classes.endsWith(" px-2 decoration-1 underline-offset-4 hover:bg-transparent hover:underline ml-1 max-sm:-ml-2")).toBe(true);
    expect(buttons[2].classes.endsWith(" h-11 px-5 text-[0.9375rem] max-sm:w-full lg:px-4")).toBe(true);
    // The two utilities come before the sheet's frame, the switch before the check.
    expect(top.indexOf("Check an invented sample")).toBeLessThan(top.indexOf("overflow-hidden border-y border-border-strong"));
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
