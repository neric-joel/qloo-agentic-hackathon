import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { tagLabel } from "@/lib/clashes";
import type { HiddenWallItem } from "@/lib/preset";

import {
  BRIDGE_TAGS_NARROW,
  BRIDGE_TAGS_WIDE,
  DayRank,
  genreText,
  groupTags,
  pairKeyTarget,
  RankAxis,
  rankAxisLeft,
  rankPercentile,
  SharedTags,
  TasteRing,
} from "./taste-ring";

// Every name and tag below is invented for the test.
function item(n: number, tags: HiddenWallItem["shared_tags"] = []): HiddenWallItem {
  return {
    festival: "test-fest-2025",
    day: "Sun",
    acts: [`Act ${n}A`, `Act ${n}B`],
    genres: [["urn:tag:genre:indie"], ["urn:tag:genre:punk"]],
    overlap_pct: 0.9,
    draw_pct: 0.8,
    overlap_min: 30,
    source: null,
    shared_tags: tags,
  };
}

const tags = [
  { name: "urn:tag:genre:jazz", kind: "genre", score: null },
  { name: "urn:tag:theme:late_night", kind: "theme", score: null },
  { name: "urn:tag:genre:soul", kind: "genre", score: null },
];

function render(items: HiddenWallItem[], synthetic = false): string {
  return renderToStaticMarkup(createElement(TasteRing, { items, synthetic }));
}

describe("TasteRing", () => {
  it("renders nothing when there are no examples", () => {
    expect(render([])).toBe("");
  });

  it("shows one pair at a time under one announced label, and names both acts and the verdict", () => {
    const html = render([item(1, tags), item(2)]);
    // No tab strip: one navigator with a live label naming the pair.
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
    expect(html).toMatch(/<p id="ring-label-[^"]*" aria-live="polite" aria-atomic="true"[^>]*>/);
    expect(html).toMatch(/<div id="ring-panel" role="group" aria-labelledby="ring-label-/);
    for (const name of ["Act 1A", "Act 1B"]) expect(html).toContain(name);
    expect(html).toContain("No genre tag in common.");
    expect(html).not.toContain("Shared taste");
  });

  it("names the two sources apart: the acts' own genre tags have none in common, and the audience tags from Qloo are counted", () => {
    const html = render([item(1, tags)]);
    const plain = html.replace(/<[^>]+>/g, "");
    expect(plain).toContain("No genre tag in common. Compared on each act’s own genre tags; the audience tags come from Qloo.");
    expect(plain).toContain("Audience tags in common, from Qloo: 3");
    // The label leads its own list (the full inventory also sits in the source details, which come later).
    expect(html.indexOf("data-shared-label")).toBeLessThan(html.indexOf("data-shared-tags"));
    const listText = html.slice(html.indexOf("data-shared-label")).replace(/<[^>]+>/g, "");
    expect(listText.indexOf("Audience tags in common, from Qloo: 3")).toBeLessThan(listText.indexOf(tagLabel(tags[0].name)));
    // The invented day counts its tags without crediting Qloo, and its qualifier names no source.
    const invented = render([item(1, tags)], true).replace(/<[^>]+>/g, "");
    expect(invented).toContain("Shared tags for this pair: 3");
    expect(invented).toContain("No genre tag in common. Compared on each act’s own genre tags.");
    expect(invented).not.toContain("come from Qloo");
  });

  it("sets the festival and day as a sentence-case line, not a kicker", () => {
    const html = render([item(1, tags)]);
    expect(html).not.toContain("type-kicker");
    expect(html).toContain(
      '<p data-ring-dateline="true" class="min-w-0 text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Test Fest 2025, Sunday</p>',
    );
  });

  it("shows only the tags the pair carries, grouped by type, with the attribution line", () => {
    const html = render([item(1, tags)]);
    for (const t of tags) expect(html).toContain(tagLabel(t.name));
    expect(html).toContain("Tags Qloo returned for this pair");
    expect(html).toContain("Tags Qloo returned when it compared the two acts’ audiences.");
    expect(html).toContain("Genre");
    expect(html).toContain("Theme");
  });

  it("labels the shared list once, prints each act's genre tags once, and folds the tag inventory under 'Qloo source details'", () => {
    const html = render([item(1, tags)]);
    expect(html).toContain("Audience tags in common, from Qloo");
    // Each act's genres, once each, under its name and a visible 12.5 px muted "Genre tags" label (never 11 px).
    expect(html.match(/<p class="mt-1 text-\[0\.78125rem\] leading-4 font-semibold text-muted-foreground lg:mt-2">Genre tags<\/p>/g)).toHaveLength(2);
    expect(html.match(/>Indie</g)).toHaveLength(1);
    const fold = html.match(/<details data-ring-source[^>]*>[\s\S]*?<\/details>/)![0];
    // The site's caret row, not a bare native triangle, 12 px under the press line with no rule of its own, so the
    // ranks, the press link, Recorded and the details read as one group.
    expect(fold).toMatch(/^<details data-ring-source="true" class="group mt-3">/);
    expect(fold).not.toMatch(/^<details[^>]*class="[^"]*(cc-disclosure|border)/);
    expect(fold).toMatch(/<summary class="[^"]*cc-disclosure-summary[^"]*">\s*Qloo source details\s*<span aria-hidden="true" class="cc-disclosure-mark"/);
    expect(fold).toContain("Tags Qloo returned for this pair");
    expect(fold).toContain("Tags Qloo returned when it compared the two acts’ audiences.");
    expect(fold).not.toMatch(/<details[^>]*open/);
    const outside = html.replace(fold, "");
    expect(outside).toContain("Audience tags in common, from Qloo");
    // The connector lines and their caption are gone with the spoke drawing.
    expect(outside).not.toContain("Schematic");
    expect(outside).not.toContain("area does not represent");
    expect(outside).not.toContain("Tags Qloo returned");
    expect(html).not.toContain("type-kicker text-primary");
  });

  it("credits nothing to Qloo on the invented day, and prints no tag block for a pair with none", () => {
    const html = render([item(1, tags)], true);
    expect(html).not.toContain("Tags Qloo returned");
    expect(html).toContain("Tags are invented for this day");
    expect(html).toContain("Shared tags for this pair");
    expect(html).not.toContain("from Qloo");
    expect(html).not.toMatch(/Qloo source details/);
    expect(render([item(1)])).not.toContain("Tags Qloo");
  });

  it("groups by type in stored order", () => {
    expect(groupTags(tags).map((g) => [g.kind, g.tags.length])).toEqual([["genre", 2], ["theme", 1]]);
    expect(groupTags([{ name: "x", kind: null, score: null }])[0].kind).toBe("tag");
  });
});

describe("tag type names", () => {
  it("names the type from Qloo's tag id, not its domain", async () => {
    const { kindLabel } = await import("./taste-ring");
    expect(kindLabel("urn:tag:genre:music")).toBe("Genre");
    expect(kindLabel("urn:tag:subgenre:music")).toBe("Subgenre");
    expect(kindLabel("urn:tag:keyword:qloo")).toBe("Keyword");
  });
});

describe("the taste figure's drawing", () => {
  it("draws no circle, no lens, no area fill and no swatch: two rows joined by one ink connector each side, the shared minutes in words", () => {
    const html = render([item(1, tags), item(2)]);
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("<ellipse");
    expect(html).not.toMatch(/<path [^>]*fill="var\(--primary\)"/);
    expect(html).not.toContain("fill-opacity");
    // No drawn svg at all: the minutes carry no swatch (the pager's chevrons are icons).
    expect(html.replace(/<svg[^>]*lucide[\s\S]*?<\/svg>/g, "").match(/<svg/g)).toBeNull();
    expect(html).not.toContain("<pattern");
    expect(html).not.toContain("shared-hatch-");
    // From 1024 px each side of the label is ONE connector: a 1.5 px ink line with round caps in the act name's row,
    // from 12 px (gap-3) after the name to 12 px (the label's mx-3) before the label, with a 6 px ink dot inside each
    // end (at the name end and at the label end), so it reads as a connector, not a rule. No second segment, no joint.
    const desk = [...html.matchAll(/<span aria-hidden="true" data-connector="true" class="([^"]*)"><\/span>/g)].map((m) => m[1]);
    expect(desk).toHaveLength(2);
    for (const cls of desk) {
      expect(cls).toMatch(/^relative hidden h-\[1\.5px\] min-w-6 flex-1 rounded-bar bg-foreground lg:block /);
      for (const end of ["before", "after"]) {
        expect(cls).toContain(`${end}:absolute ${end}:size-1.5 ${end}:rounded-full ${end}:bg-foreground`);
        expect(cls).toContain(`${end}:top-1/2`);
      }
      expect(cls).toContain("before:left-0");
      expect(cls).toContain("after:right-0");
    }
    expect(html).not.toContain("data-connector-mid");
    // The two names are printed once each, at every width: from 1024 px at the two ends of the first row with their
    // horizontal connectors; below 1024 px as the bridge turned vertical, act A's name with its connector under it and
    // act B's name with its connector over it.
    expect(html).toMatch(
      /<div data-act-name="start" class="flex min-w-0 flex-col items-start lg:min-h-8 lg:flex-1 lg:flex-row lg:items-center lg:gap-3 lg:order-1"><p class="type-title[^"]*">Act 1A<\/p><span aria-hidden="true" data-connector="true"[^>]*><\/span><span aria-hidden="true" data-connector-phone="true"[^>]*><\/span><\/div>/,
    );
    expect(html).toMatch(
      /<div data-act-name="end" class="flex min-w-0 flex-col items-start lg:min-h-8 lg:flex-1 lg:flex-row lg:items-center lg:gap-3 lg:order-3 lg:justify-end lg:text-right"><span aria-hidden="true" data-connector-phone="true"[^>]*><\/span><span aria-hidden="true" data-connector="true"[^>]*><\/span><p class="type-title[^"]*">Act 1B<\/p><\/div>/,
    );
    expect(html).toMatch(/<p id="shared-tags-[^"]*" data-shared-label="true" class="[^"]*lg:order-2 lg:mx-3 lg:flex lg:min-h-8[^"]*lg:justify-center[^"]*">/);
    // Below 1024 px each connector is the desktop's turned vertical: a 24 px 1.5 px ink line, 8 px clear of the text
    // above and below, its centre 3 px in from the text edge (so its 6 px dots sit on that edge), a 6 px ink dot inside
    // its top and its bottom end. Hidden from 1024 px, aria-hidden, never a focus stop.
    const phone = [...html.matchAll(/<span aria-hidden="true" data-connector-phone="true" class="([^"]*)"><\/span>/g)].map((m) => m[1]);
    expect(phone).toHaveLength(2);
    for (const cls of phone) {
      expect(cls).toMatch(/^relative my-2 ml-\[2\.25px\] h-6 w-\[1\.5px\] shrink-0 rounded-bar bg-foreground lg:hidden /);
      for (const end of ["before", "after"]) {
        expect(cls).toContain(`${end}:absolute ${end}:size-1.5 ${end}:rounded-full ${end}:bg-foreground`);
        expect(cls).toContain(`${end}:left-1/2 ${end}:-translate-x-1/2`);
      }
      expect(cls).toContain("before:top-0");
      expect(cls).toContain("after:bottom-0");
    }
    // The "A × B" line is gone: the names are in the bridge; the sr-only h3 still names the pair.
    expect(html).not.toContain("data-pair-line");
    expect(html).not.toContain("×");
    expect(html).toMatch(/<h3 class="sr-only">Act 1A(<!-- -->)? and (<!-- -->)?Act 1B<\/h3>/);
    expect(html.match(/>Act 1A<\/p>/g)).toHaveLength(2);
    expect(html).not.toContain("data-connector-stack");
    const source = readFileSync(join(process.cwd(), "src", "components", "clash", "taste-ring.tsx"), "utf-8");
    expect(source).not.toContain("STACK_CONNECTOR");
    expect(source).not.toContain("function PairLine");
    // Connector lines and dots are ink only: no vermilion, teal, muted or border colour on any of them.
    for (const cls of [...desk, ...phone]) expect(cls).not.toMatch(/(bg|border)-(primary|prov-[a-z]+|muted|border)/);
    // The only border-strong fills are the pager's hover underline, in the pager row, and the ranks' aria-hidden
    // axes (each one 2px line and two 1px end ticks), one axis per rank.
    const pagerRow = html.slice(html.indexOf("data-pair-nav"), html.indexOf('id="ring-panel"'));
    const rankAxes =
      /<div aria-hidden="true" data-rank-axis=""[^>]*><div class="relative h-3">(?:<span [^>]*><\/span>){4}<\/div><div data-axis-scale=""[^>]*><span>0<\/span><span>100<\/span><\/div><\/div>/g;
    expect(html.match(rankAxes)).toHaveLength(2);
    expect(html.replace(pagerRow, "").replace(rankAxes, "")).not.toContain("bg-border-strong");
    expect(html).not.toContain("border-t border-border-strong");
    // The minutes in raspberry tabular figures, the words in the text face.
    expect(html).toMatch(/<span class="font-mono text-primary[^"]*">30 min<\/span> at the same time/);
    expect(render([{ ...item(1, tags), overlap_min: null }])).not.toContain("<pattern");
  });

  it("sets the audience-tags label in Qloo teal on a published day and in ink on the invented day", () => {
    const label = (html: string) => html.match(/<p id="shared-tags-[^"]*" data-shared-label="true" class="([^"]*)"/)![1];
    const published = render([item(1, tags)]);
    expect(label(published)).toContain("text-prov-qloo");
    expect(label(published)).toContain("text-[0.8125rem] leading-5 font-semibold");
    // The invented day credits nothing to Qloo: no teal class anywhere in its render.
    const invented = render([item(1, tags)], true);
    expect(label(invented)).toContain("text-foreground");
    expect(invented).not.toContain("prov-qloo");
    // The act names stay ink in the title face.
    expect(published).toMatch(/<p class="type-title max-w-full min-w-0 break-words \[hyphens:auto\]">Act 1A<\/p>/);
  });

  it("prints no schematic caption, and names the figure by its pair", () => {
    const html = render([item(1, tags), item(2)]);
    expect(html).not.toContain("Schematic; lines show shared tags");
    expect(html).not.toContain("<figcaption");
    expect(html).toMatch(/<figure [^>]*aria-label="Act 1A and Act 1B: each act&#x27;s own genre tags, and the tags their audiences share"/);
  });

  it("renders every shared tag once, in 15 px medium ink, not chips and with no commas, labelled by its credit: two columns below 1024 px, four content-wide columns in a ruled tray from 1024 px", () => {
    const html = render([item(1, tags)]);
    expect(html.match(/<ul id="shared-tags-[^"]*" aria-labelledby="shared-tags-[^"]*" data-shared-tags/g)).toHaveLength(1);
    const list = html.match(/<ul id="[^"]*" aria-labelledby="(shared-tags-[^"]*)"[\s\S]*?<\/ul>/)!;
    expect(html).toMatch(new RegExp(`<p id="${list[1]}" data-shared-label="true" class="text-\\[0\\.8125rem\\] leading-5 font-semibold[^"]*"><span>Audience tags in common, from Qloo: <span`));
    // 15 px medium ink on a 24 px rhythm. Below 1024 px two equal columns on the text column's left edge, inside the
    // bridge. From 1024 px one compact block of four columns, each as wide as its widest tag, 32 px apart, centred under
    // the label (four columns, no longer stretched to a set width).
    expect(list[0]).toMatch(
      /data-shared-tags="true" class="grid grid-cols-2 gap-x-6 gap-y-1 text-\[0\.9375rem\] leading-6 font-medium text-foreground lg:grid-cols-\[repeat\(4,max-content\)\] lg:justify-center lg:gap-x-8"/,
    );
    expect(list[0]).not.toMatch(/lg:w-\[|lg:flex-wrap|max-lg:inline/);
    // The list and its button sit in one block; from 1024 px as wide as its columns, centred between the two genre
    // columns (which share the rest equally), so its centre is the label's, in a ruled tray: a 1px decorative rule above
    // and below at its own width, 12 px clear of the tags, with no fill, no side edge and no corner. Below 1024 px no
    // tray: the bridge's connectors hold the tags.
    expect(html).toMatch(
      /<div data-shared-list="true" class="mt-2 min-w-0 lg:order-6 lg:shrink-0 lg:self-start lg:mt-0 lg:border-y lg:border-border lg:py-3"><ul id="shared-tags-/,
    );
    const tray = html.match(/<div data-shared-list="true" class="([^"]*)">/)![1].split(" ");
    for (const cls of tray) expect(cls, cls).not.toMatch(/^(border|py|pt|pb|bg-|rounded|shadow)|border-(x|l|r|t|b|strong)\b|lg:bg-|lg:rounded/);
    expect(tray).toContain("lg:border-y");
    expect(tray).toContain("lg:border-border");
    expect(tray).toContain("lg:py-3");
    expect(list[0]).not.toContain('class="tag');
    // One tag per item: each li holds exactly its tag, as tagLabel gives it, in stored order, with no comma at either
    // width. From 1024 px each item is nowrap; below 1024 px it may wrap between words inside its column. No middots,
    // no pills. Three tags make an incomplete row of three from 1024 px: the first column, the middle two, the last.
    const labels = groupTags(tags).flatMap((g) => g.tags).map((t) => tagLabel(t.name));
    const lis = [...list[0].matchAll(/<li class="([^"]*)">([^<]*)<\/li>/g)];
    expect(lis.map((m) => m[2])).toEqual(labels);
    expect(lis.map(([, cls]) => cls)).toEqual([
      "min-w-0 break-words lg:text-center lg:whitespace-nowrap",
      "min-w-0 break-words lg:text-center lg:whitespace-nowrap lg:col-span-2",
      "min-w-0 break-words lg:text-center lg:whitespace-nowrap lg:col-start-4",
    ]);
    for (const [, cls] of lis) expect(cls).not.toMatch(/lg:w-|break-all/);
    expect(list[0].replace(/<[^>]+>/g, "")).toBe(labels.join(""));
    expect(list[0].replace(/<[^>]+>/g, "")).not.toContain(",");
    expect(list[0]).not.toContain("·");
    // Plain text: no chip edge, fill, corner or padding on any item.
    expect(list[0]).not.toMatch(/rounded-(full|sm|md|lg)|\bborder\b|\bbg-|\bp[xy]?-\d|truncate|line-clamp|break-all|text-ellipsis/);
    expect(list[0]).not.toMatch(/border-b|sm:grid/);
    // Three tags: no button at any width.
    expect(html).not.toContain("aria-expanded");
    expect(list[0]).not.toMatch(/>\s*0\d\s*</);
    expect(html).not.toMatch(/>0[1-9]</);
  });

  it("prints both ranks as one sentence each at body size, in one notation, with no bar", () => {
    const html = render([item(1, tags)]);
    // The ranks are this app's figures: ink, never teal (only the audience-tags label is).
    const facts = html.match(/<div data-pair-facts="true">[\s\S]*?<\/dl>/)![0];
    expect(facts).not.toContain("prov-qloo");
    expect(html).not.toContain("data-rank-bar");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("type-numeral");
    // 0.9 is the 90th percentile; 0.8 the 80th: 15px semibold, then the caption in the same sentence.
    expect(html).toMatch(
      /<span class="block text-\[0\.9375rem\] leading-snug"><span class="font-semibold tabular-nums">90th percentile<\/span> <span data-rank-caption="true" class="text-muted-foreground">of that day’s clashes<\/span><\/span>/,
    );
    expect(html).toContain(">80th percentile</span>");
    // The top pair is printed as a percentile too, so the two ranks can be compared.
    const top = render([{ ...item(1, tags), overlap_pct: 1 }]);
    expect(top).toContain(">100th percentile</span>");
    expect(top).not.toContain("Highest");
    // No draw rank: n/a at the same size.
    expect(render([{ ...item(1, tags), draw_pct: null }])).toContain('<span class="block text-[0.9375rem] leading-snug font-semibold">n/a</span>');
    expect(html).toContain('<dt class="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Taste overlap rank</dt>');
    expect(html).toContain('<dt class="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Draw rank</dt>');
  });

  it("draws each rank as a position on the site's rank axis: inset ends, its 0 and 100 scale, one rounding shared with the sentence, nothing focusable", () => {
    // One rounding: the value clamped to 0 to 1, then the nearest whole percentile.
    expect(rankPercentile(0)).toBe(0);
    expect(rankPercentile(0.5)).toBe(50);
    expect(rankPercentile(0.756)).toBe(76);
    expect(rankPercentile(1)).toBe(100);
    expect(rankPercentile(-0.2)).toBe(0);
    expect(rankPercentile(1.4)).toBe(100);
    // The dot's centre: both scale ends inset by the dot's 6px outer radius, so 0 sits on the first tick, 100 on the last.
    expect(rankAxisLeft(0)).toBe("calc(6px + (100% - 12px) * 0 / 100)");
    expect(rankAxisLeft(50)).toBe("calc(6px + (100% - 12px) * 50 / 100)");
    expect(rankAxisLeft(76)).toBe("calc(6px + (100% - 12px) * 76 / 100)");
    expect(rankAxisLeft(100)).toBe("calc(6px + (100% - 12px) * 100 / 100)");
    for (const [value, p] of [
      [0, 0],
      [0.5, 50],
      [0.756, 76],
      [1, 100],
    ] as const) {
      const axis = renderToStaticMarkup(createElement(RankAxis, { value }));
      const sentence = renderToStaticMarkup(createElement(DayRank, { value }));
      // The sentence and the axis read the same helper: the printed ordinal's number is the dot's percentile.
      const printed = Number(sentence.match(/>(\d+)(?:st|nd|rd|th) percentile</)![1]);
      expect(printed).toBe(p);
      expect(axis).toContain(`data-p="${printed}"`);
      const left = axis.match(/data-marker="" class="[^"]*" style="left:([^"]*)"/)![1];
      expect(left).toBe(rankAxisLeft(printed));
      // A picture of the sentence only: aria-hidden as a whole, its only text the scale's two ends, nothing
      // focusable, no tooltip.
      expect(axis).toMatch(/^<div aria-hidden="true" data-rank-axis=""/);
      expect(axis.replace(/<[^>]+>/g, "")).toBe("0100");
      expect(axis).not.toMatch(/<(a|button|input|select)\b|tabindex|title=|aria-hidden="false"/);
      // The scale: "0" under the first tick, flush with its left edge, and "100" under the last, flush with its right
      // edge (both ticks sit 6 px in from the axis box, so does the row's padding), in 12 px mono muted figures, 4 px
      // under the dot's 12 px box, so a dot at 0 or 100 never meets its label.
      expect(axis).toMatch(
        /<\/div><div data-axis-scale="" class="mt-1 flex justify-between px-1\.5 font-mono text-xs leading-3 text-muted-foreground tabular-nums"><span>0<\/span><span>100<\/span><\/div><\/div>$/,
      );
      expect(axis).not.toMatch(/data-axis-scale[^>]*(primary|prov-qloo|text-foreground|border-strong)/);
      // The site's rank axis, inset by the dot's radius: a 2px border-strong line, 1px by 8px end ticks, a 12px ink dot.
      expect(axis).toContain('<div aria-hidden="true" data-rank-axis="" data-p="' + p + '" class="mt-2 w-full max-w-48"><div class="relative h-3">');
      expect(axis).toContain('<span class="absolute inset-x-1.5 top-1/2 h-0.5 -translate-y-1/2 bg-border-strong"></span>');
      expect(axis).toContain('<span data-axis-end="first" class="absolute top-0.5 left-1.5 h-2 w-px bg-border-strong"></span>');
      expect(axis).toContain('<span data-axis-end="last" class="absolute top-0.5 right-1.5 h-2 w-px bg-border-strong"></span>');
      expect(axis).toMatch(/data-marker="" class="absolute top-0 size-3 -translate-x-1\/2 rounded-full border-2 bg-foreground border-background"/);
      // Ink and border-strong only: no fill, no bar, no vermilion, no teal.
      expect(axis).not.toMatch(/primary|prov-qloo|data-rank-bar|bg-muted/);
    }
    // On a card the halo is drawn in the card's fill.
    expect(renderToStaticMarkup(createElement(RankAxis, { value: 0.5, halo: "card" }))).toContain("border-2 bg-foreground border-card");
    // In the exhibit both ranks get an axis on paper; a missing draw rank gets none, never a zero.
    const html = render([item(1, tags)]);
    const facts = html.match(/<div data-pair-facts="true">[\s\S]*?<\/dl>/)![0];
    expect(facts.match(/data-rank-axis/g)).toHaveLength(2);
    expect(facts).toContain('data-p="90"');
    expect(facts).toContain('data-p="80"');
    expect(facts).not.toContain("border-card");
    const noDraw = render([{ ...item(1, tags), draw_pct: null }]).match(/<div data-pair-facts="true">[\s\S]*?<\/dl>/)![0];
    expect(noDraw.match(/data-rank-axis/g)).toHaveLength(1);
    expect(noDraw).not.toContain('data-p="0"');
    expect(noDraw.slice(noDraw.indexOf("Draw rank"))).not.toContain("data-rank-axis");
  });

  it("shows the first four tags below 1024 px (two columns) and the first eight from 1024 px, hiding the rest by class, with one 'and N more' button that carries one count per width", () => {
    const tagsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `urn:tag:genre:style_${i}`, kind: "genre", score: null }));
    const shared = (n: number, expanded: boolean) =>
      renderToStaticMarkup(createElement(SharedTags, { tags: tagsOf(n), synthetic: false, initiallyExpanded: expanded }));
    expect(BRIDGE_TAGS_NARROW).toBe(4);
    expect(BRIDGE_TAGS_WIDE).toBe(8);
    for (const n of [1, 4, 5, 7, 8, 9, 12]) {
      for (const expanded of [false, true]) {
        const html = shared(n, expanded);
        const at = `${n} tags, ${expanded ? "expanded" : "collapsed"}`;
        const label = html.replace(/<[^>]+>/g, "").match(/Audience tags in common, from Qloo: (\d+)/)![1];
        const lis = [...html.matchAll(/<li class="([^"]*)">([^<]*)<\/li>/g)];
        // Every tag is rendered, in order, whatever the state: the label's N is the list's length.
        expect(lis.length, at).toBe(Number(label));
        expect(lis.map((m) => m[2]), at).toEqual(tagsOf(n).map((t) => tagLabel(t.name)));
        expect(html, at).not.toMatch(/<\/li>[^<]*,|,<\/span><\/li>/);
        lis.forEach(([, cls], i) => {
          const narrowHidden = /(^| )max-lg:hidden( |$)/.test(cls);
          const wideHidden = /(^| )lg:hidden( |$)/.test(cls);
          expect(narrowHidden, `${at}, item ${i + 1} below 1024 px`).toBe(!expanded && i >= 4);
          expect(wideHidden, `${at}, item ${i + 1} from 1024 px`).toBe(!expanded && i >= 8);
          // A grid item in its column at every width, never an inline run; nowrap from 1024 px.
          expect(cls, at).not.toMatch(/(^| )max-lg:inline( |$)/);
          expect(cls.split(" "), at).toContain("lg:whitespace-nowrap");
          // Hidden by class only: never the bare hidden utility, never removed.
          expect(cls, at).not.toMatch(/(^| )hidden( |$)/);
        });
        // From 1024 px an incomplete last row of four sits centred: one tag spans the four columns, two span two each,
        // three take the first column, the middle two and the last. Full rows and hidden tags carry no placement.
        const shownWide = expanded ? n : Math.min(n, 8);
        const tail = shownWide % 4;
        const want: (string | null)[] = { 1: ["lg:col-span-4"], 2: ["lg:col-span-2", "lg:col-span-2"], 3: [null, "lg:col-span-2", "lg:col-start-4"] }[tail] ?? [];
        lis.forEach(([, cls], i) => {
          const k = i - (shownWide - tail);
          const expected = k >= 0 && i < shownWide ? want[k] : null;
          expect(cls.match(/lg:col-(span|start)-\d/)?.[0] ?? null, `${at}, item ${i + 1} last-row placement`).toBe(expected);
        });
        // Below 1024 px the shown tags: the first four, or every one once expanded.
        const shownNarrow = lis.filter(([, cls]) => !/(^| )max-lg:hidden( |$)/.test(cls)).map((m) => m[2]);
        expect(shownNarrow.length, at).toBe(expanded ? n : Math.min(n, 4));
        const button = html.match(/<button type="button" aria-expanded="(true|false)" aria-controls="(shared-tags-[^"]*-list)" class="([^"]*)">([\s\S]*?)<\/button>/);
        if (n <= 4) {
          // Nothing to fold at either width: no button.
          expect(button, at).toBeNull();
          expect(html, at).not.toContain("aria-expanded");
          continue;
        }
        expect(button, at).not.toBeNull();
        const [, ariaExpanded, controls, cls, inner] = button!;
        expect(ariaExpanded, at).toBe(String(expanded));
        expect(html, at).toContain(`<ul id="${controls}"`);
        // Below 1024 px a 44 px text action on its own line under the two columns, with no negative margin and no
        // hit-area extension; from 1024 px its own centred 44 px row under the tags, inside the tray's bottom rule.
        // Ruled ink: a border-strong underline.
        expect(cls, at).toMatch(/^inline-flex min-h-11 w-fit items-center /);
        expect(cls, at).toContain("text-foreground underline decoration-border-strong");
        expect(cls, at).not.toMatch(/(^| )-m|after:|before:|inset/);
        // From 1024 px it shows only when there are more than eight tags (as a centred block); below, when there are
        // more than four.
        expect(/(^| )lg:hidden( |$)/.test(cls), at).toBe(n <= 8);
        expect(/(^| )lg:mx-auto lg:flex( |$)/.test(cls), at).toBe(n > 8);
        expect(/(^| )max-lg:hidden( |$)/.test(cls), at).toBe(false);
        // It follows the list inside the same block (so inside the tray from 1024 px), not as a list item.
        expect(html, at).toMatch(/<\/ul><button /);
        expect(html, at).toMatch(/<div data-shared-list="true" class="[^"]*lg:border-y[^"]*"><ul [\s\S]*<\/ul><button [\s\S]*<\/button><\/div>/);
        const plain = inner.replace(/<[^>]+>/g, "");
        if (expanded) {
          expect(plain, at).toBe("Show fewer");
          continue;
        }
        // One span per width, each built from the count, so the accessible name at each width is the visible one.
        expect(inner, at).toContain(`<span data-more="narrow" class="lg:hidden">and <span class="font-mono tabular-nums">${n - 4}</span> more</span>`);
        if (n > 8) {
          expect(inner, at).toContain(`<span data-more="wide" class="max-lg:hidden">and <span class="font-mono tabular-nums">${n - 8}</span> more</span>`);
        } else {
          expect(inner, at).not.toContain('data-more="wide"');
        }
      }
    }
    // Through the card: the label counts every tag, and the full list also stays in the source details.
    const many = tagsOf(13);
    const card = render([item(1, many)]);
    expect(card.replace(/<[^>]+>/g, "")).toContain("Audience tags in common, from Qloo: 13");
    expect(card.match(/<ul id="shared-tags-[\s\S]*?<\/ul>/)![0].match(/<li /g)).toHaveLength(13);
    expect(card).not.toContain("decoration-foreground/");
    const fold = card.match(/<details data-ring-source[^>]*>[\s\S]*?<\/details>/)![0];
    for (const t of many) expect(fold).toContain(tagLabel(t.name));
    expect(render([item(1, tags)]).replace(/<[^>]+>/g, "")).not.toMatch(/and \d+ more/);
  });

  it("draws the comparison before its conclusion: the bridge (names, label, tags), the genre tags, the finding with its caveat, the ranks and details, then the closing line", () => {
    const html = render([item(1, tags)], false);
    const withProps = renderToStaticMarkup(
      createElement(TasteRing, {
        items: [item(1, tags)],
        aside: createElement("p", null, "These are examples, an aside for the test."),
        badge: createElement("span", null, "Recorded"),
        notes: createElement("p", null, "Notes for the test."),
        closing: createElement("p", null, "Showing 1 of 2, a closing line for the test."),
      }),
    );
    for (const h of [html, withProps]) {
      const at = (needle: string) => h.indexOf(needle);
      // Markup order, which is the phone's order and the focus order: act A's name, the label and the tags in common,
      // act B's name (the bridge), each act's genre tags, then the finding (the verdict, its qualifier, the minutes),
      // the ranks, the press line and the source details.
      const order = [
        "data-ring-inventory",
        'data-act-name="start"',
        "Audience tags in common",
        "data-shared-tags",
        'data-act-name="end"',
        'data-act-genres="start"',
        'data-act-genres="end"',
        "data-ring-findings",
        "No genre tag in common.",
        "Compared on each act’s own genre tags; the audience tags come from Qloo.",
        "at the same time",
        "Taste overlap rank",
        "Draw rank",
        "No press link saved.",
        "<details data-ring-source",
      ];
      for (let i = 1; i < order.length; i++) expect(at(order[i - 1]), `${order[i - 1]} before ${order[i]}`).toBeLessThan(at(order[i]));
      // The bridge and the genre tags are one figure; the finding block is one DOM unit after it.
      const figure = h.slice(at("data-ring-inventory"), at("</figure>"));
      for (const needle of ['data-act-name="start"', "data-shared-tags", 'data-act-name="end"', 'data-act-genres="end"']) expect(figure, needle).toContain(needle);
      const findings = h.slice(at("data-ring-findings"));
      for (const needle of ["No genre tag in common.", "at the same time", "Taste overlap rank", "Draw rank", "No press link saved.", "<details data-ring-source"]) {
        expect(findings, needle).toContain(needle);
      }
      expect(findings).not.toContain("Audience tags in common");
      expect(findings).not.toContain("Genre tags");
    }
    // The aside (the caveat that qualifies the finding) sits directly after the minutes, before the ranks.
    expect(withProps.indexOf("These are examples, an aside")).toBeGreaterThan(withProps.indexOf("at the same time"));
    expect(withProps.indexOf("These are examples, an aside")).toBeLessThan(withProps.indexOf("Taste overlap rank"));
    expect(withProps.indexOf("Recorded")).toBeLessThan(withProps.indexOf("<details data-ring-source"));
    // The closing line comes after the source details and outside them, in its own full-width slot (order 9 from
    // 1024 px), never in a disclosure; without it, no slot.
    const details = withProps.match(/<details data-ring-source[^>]*>[\s\S]*?<\/details>/)![0];
    expect(details).not.toContain("a closing line for the test");
    expect(withProps.indexOf("a closing line for the test")).toBeGreaterThan(withProps.indexOf("</details>"));
    expect(withProps).toContain(
      '</details></div></div><div data-ring-closing="true" class="mt-3 min-w-0 lg:order-9 lg:mt-2.5 lg:basis-full"><p>Showing 1 of 2, a closing line for the test.</p></div></div>',
    );
    expect(html).not.toContain("data-ring-closing");
    // Below 1024 px each act's genre block is introduced by its own name, in 15 px semibold ink, the two blocks side by
    // side in two columns; from 1024 px the names above say whose tags are whose.
    expect(html).toMatch(
      /<div data-act-genres-row="true" class="mt-6 grid grid-cols-2 gap-x-6 lg:contents"><div data-act-genres="start" class="[^"]*"><p data-act-intro="true" class="text-\[0\.9375rem\] leading-6 font-semibold text-foreground lg:hidden">Act 1A<\/p><p class="[^"]*">Genre tags<\/p>/,
    );
    expect(html).toMatch(
      /<div data-act-genres="end" class="[^"]*"><p data-act-intro="true" class="text-\[0\.9375rem\] leading-6 font-semibold text-foreground lg:hidden">Act 1B<\/p><p class="[^"]*">Genre tags<\/p>/,
    );
  });

  it("places the inventory from 1024 px where the comparison draws it, in one wrapping flex row, with the finding below", () => {
    const html = render([item(1, tags)]);
    // From 1024 px one wrapping flex row: the names and the label (order 1 to 3), a full-width break (4), then the
    // genre tags either side of the list (5 to 7), then the finding and the ranks across the full width (8), then the
    // closing line (9). The figure, the shared block and the genre row step aside (display: contents) so their parts
    // join the row.
    expect(html).toMatch(
      /<div data-ring-body="true" class="cc-ring-lens mt-2 min-w-0 sm:mt-0 lg:mt-1 lg:flex lg:flex-row lg:flex-wrap lg:items-center"><figure data-ring-inventory/,
    );
    expect(html).toMatch(/<figure data-ring-inventory="true" aria-label="[^"]*" class="min-w-0 lg:contents"><div data-act-name="start"/);
    expect(html).toContain('</figure><span aria-hidden="true" data-row-break="true" class="hidden lg:order-4 lg:block lg:h-0 lg:basis-full"></span><div data-ring-findings');
    expect(html).toMatch(/<div data-act-genres="start" class="min-w-0 lg:flex-1 lg:self-start lg:order-5 lg:pr-6">/);
    expect(html).toMatch(/<div data-act-genres="end" class="min-w-0 lg:flex-1 lg:self-start lg:order-7 lg:pl-6 lg:text-right">/);
    // Below 1024 px every text of the pair sits on one left edge, with act B flush left too. Act B goes flush right,
    // and the list centres, only from 1024 px.
    expect(html).not.toContain("max-lg:order-last");
    expect(html).not.toContain("data-connector-v");
    expect(html).not.toMatch(/class="[^"]*(?<!lg:)\btext-(right|center)\b/);
    expect(html).not.toMatch(/data-shared-tags="true" class="[^"]*(?<!lg:)\b(mx-auto|justify-center)\b/);
    // The inventory holds no focus stop from 1024 px unless a pair has more than eight tags (the wide "and N more").
    const inventory = html.slice(html.indexOf("data-ring-inventory"), html.indexOf("data-row-break"));
    expect(inventory).not.toMatch(/<(a|button|summary|input|select)\b/);
    const middle = html.match(/<div data-shared-block="true" class="([^"]*)">[\s\S]*?<\/ul><\/div>/);
    expect(middle).not.toBeNull();
    expect(middle![1]).toBe("min-w-0 lg:contents");
    expect(middle![1]).not.toMatch(/\bborder\b|\bbg-|rounded|\bp-\d/);
    expect(middle![0]).toContain("Audience tags in common");
    expect(middle![0]).toContain("data-shared-tags");
    // The pager and the comparison are one exhibit, open on paper as the hero receipt is: one 1px decorative top
    // rule (border-t border-border) and nothing else: no corner, no surface edge, no card fill, no side padding.
    const card = html.match(/<div data-ring-card="true" class="([^"]*)">/)![1];
    expect(card).toBe("border-t border-border pt-5 sm:pt-6 print:hidden");
    for (const cls of ["rounded-lg", "border-surface-edge", "bg-card", "p-6"]) expect(card.split(" "), cls).not.toContain(cls);
    expect(card.split(" ").filter((c) => /^(rounded|shadow|bg-|p-|px-|pl-|pr-|pb-|border-[blrxy]$|border-surface)/.test(c))).toEqual([]);
    expect(html.indexOf("data-ring-card")).toBeLessThan(html.indexOf("data-pair-nav"));
    expect(html).toMatch(/<div id="ring-panel" role="group" aria-labelledby="ring-label-[^"]*" class="print:hidden">/);
    // No hairline under the pager, and no dashed perforation: the top rule is the exhibit's one line.
    expect(html).not.toContain("data-ring-rule");
    expect(html.match(/border-t border-border\b/g)).toHaveLength(1);
    expect(html).not.toContain("ticket-perforation");
    // The finding and the ranks are two halves on one top line from 1024 px; the ranks carry no rule above them.
    // Below 1024 px the findings sit 24 px under the genre tags; from 1024 px 32 px under the comparison, full width.
    expect(html).toContain(
      '<div data-ring-findings="true" class="mt-6 grid min-w-0 gap-x-12 gap-y-6 lg:order-8 lg:mt-8 lg:basis-full lg:grid-cols-2 lg:items-start">',
    );
    expect(html).toContain("<div data-pair-facts=\"true\"><dl");
    // The source line ends with the badge passed in, on the same line.
    const badged = renderToStaticMarkup(
      createElement(TasteRing, { items: [item(1, tags)], badge: createElement("span", { className: "tag" }, "Recorded") }),
    );
    expect(badged).toMatch(/No press link saved\.<\/span><span class="flex items-center"><span class="tag">Recorded<\/span>/);
  });

  it("leads the exhibit with one row: the dateline, then a typographic pager (Previous, a mono 'N of M', Next) that stops at the ends and keeps focus", () => {
    const html = render([item(1, tags), item(2), item(3), item(4), item(5), item(6)]);
    const plain = html.replace(/<[^>]+>/g, "");
    // The live label still announces "Pair 1 of 6: A and B", word for word, but is for screen readers only: the
    // visible pair name in the pager row is gone, because the two names are printed large directly below.
    expect(plain).toContain("Pair 1 of 6: Act 1A and Act 1B");
    expect(html).toMatch(/<p id="ring-label-[^"]*" aria-live="polite" aria-atomic="true" class="sr-only">Pair 1 of 6: Act 1A and Act 1B<\/p>/);
    const head = html.slice(html.indexOf("data-ring-head"), html.indexOf('id="ring-panel"'));
    expect(head.replace(/<p id="ring-label-[^>]*>[\s\S]*?<\/p>/, "")).not.toContain("Act 1A");
    // The panel keeps its sr-only h3 naming the pair, and is labelled by the live label.
    expect(html).toMatch(/<div id="ring-panel" role="group" aria-labelledby="ring-label-[^"]*" class="print:hidden"><h3 class="sr-only">Act 1A(<!-- -->)? and (<!-- -->)?Act 1B<\/h3>/);
    // One row: the dateline first, then the pager. Below 640 px two rows (a column), the pager left-aligned on the
    // dateline's x (its hit area reaching the 13 px glyph inset to the left); from 640 px one centred row, the pager at
    // the exhibit's right edge (its hit area reaching 13 px past it, inside the page's padding).
    expect(html).toMatch(
      /<div data-ring-head="true" class="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between sm:gap-x-6"><p data-ring-dateline="true"[^>]*>Test Fest 2025, Sunday<\/p><div data-pair-nav="true"/,
    );
    expect(html).toMatch(/<div data-pair-nav="true"[^>]*class="flex shrink-0 items-center gap-x-2 print:hidden max-sm:-ml-\[0\.8125rem\] sm:-mr-\[0\.8125rem\]"/);
    expect(html).not.toMatch(/data-pair-nav="true"[^>]*class="[^"]*justify-center/);
    // No capsule ticks, no vermilion, no middot and no rule under the row.
    expect(html).not.toContain("data-tick");
    expect(html).not.toContain("bg-primary");
    expect(html).not.toContain("bg-foreground/");
    expect(html).not.toContain("data-ring-rule");
    const pager = html.slice(html.indexOf("data-pair-nav"), html.indexOf('id="ring-panel"'));
    expect(pager).not.toContain("·");
    expect(pager).not.toMatch(/border-b|text-primary/);
    // No round pager marks: the only full rounds in the exhibit are the connectors' 6 px ink end dots and the ranks'
    // 12 px ink dots on their aria-hidden axes (two for the pair shown).
    expect(pager).not.toContain("rounded-full");
    const rankDots = /<span data-marker="" class="absolute top-0 size-3 -translate-x-1\/2 rounded-full border-2 bg-foreground border-background"/g;
    expect(html.match(rankDots)).toHaveLength(2);
    expect(html.replace(/\b(before|after):rounded-full\b/g, "").replace(rankDots, "")).not.toContain("rounded-full");
    // Previous, a mono 13 px ink "1 of 6" (hidden from screen readers, which hear "Pair 1 of 6"), then Next.
    expect(pager).toMatch(
      /aria-label="Previous pair"[\s\S]*?<\/button><span aria-hidden="true" data-pair-count="true" class="font-mono text-\[0\.8125rem\] whitespace-nowrap text-foreground tabular-nums">1(<!-- -->)? of (<!-- -->)?6<\/span><button type="button" aria-label="Next pair"/,
    );
    // Each button is a text-glyph button: a 44 px hit area with no edge, no fill and no visible box, an 18 px ink
    // arrow, the page's focus outline. No border, no 12 px corner, no wash.
    const buttons = [...pager.matchAll(/<button type="button" aria-label="(Previous|Next) pair"[^>]*class="([^"]*)">([\s\S]*?)<\/button>/g)];
    expect(buttons.map((m) => m[1])).toEqual(["Previous", "Next"]);
    for (const [, , cls, inner] of buttons) {
      expect(cls).toBe("group/nav inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-foreground aria-disabled:cursor-default aria-disabled:text-muted-foreground");
      expect(cls).not.toMatch(/\bborder\b|border-|rounded-md|rounded-lg|\bbg-|hover:bg-|shadow|opacity/);
      expect(inner).toMatch(/<svg[^>]*class="lucide lucide-arrow-(left|right)[^"]*size-4\.5"/);
    }
    // Hover: a 1 px border-strong underline 4 px under the glyph, on a live button only.
    const [prev, next] = buttons.map((m) => m[3]);
    expect(prev).toMatch(/^<span class="relative inline-flex">/);
    expect(next).toMatch(
      /^<span class="relative inline-flex after:absolute after:inset-x-0 after:top-\[calc\(100%\+0\.25rem\)\] after:hidden after:h-px after:bg-border-strong after:content-\[&#x27;&#x27;\] group-hover\/nav:after:block">/,
    );
    // At an end the arrow turns muted by colour, never by an opacity utility, and no alpha colour utility.
    expect(html).not.toMatch(/opacity-\d/);
    expect(html).not.toContain("muted-foreground/");
    expect(html.match(/aria-label="Previous pair"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Next pair"/g)).toHaveLength(1);
    // At the first pair Previous says it cannot go on, but stays focusable; Next is live.
    expect(html).toMatch(/<button type="button" aria-label="Previous pair" aria-controls="ring-panel" aria-disabled="true"/);
    expect(html).toMatch(/<button type="button" aria-label="Next pair" aria-controls="ring-panel" class=/);
    expect(html).not.toMatch(/disabled=""/);
    // The row comes before the panel; no fade.
    const nav = html.indexOf("data-pair-nav");
    expect(nav).toBeLessThan(html.indexOf('id="ring-panel"'));
    expect(html).not.toContain("mask-image");
    // The panel fades in only after the visitor picks another pair: the first paint carries no data-picked, so
    // `.cc-ring-lens[data-picked]` (globals.css) starts nothing on load or on mount.
    expect(html).toMatch(/<div data-ring-body="true" class="cc-ring-lens /);
    expect(html).not.toContain("data-picked");
    const source = readFileSync(join(process.cwd(), "src", "components", "clash", "taste-ring.tsx"), "utf-8");
    expect(source).toContain('data-picked={picked ? "" : undefined}');
    // Set only by a pick that changes the pair (Previous, Next, the arrow keys, Home, End), never by a render.
    expect(source.match(/setPicked\(/g)).toHaveLength(1);
    expect(source).toMatch(/function pick\(to: number\) \{\s*if \(to === index\) return;\s*setPicked\(true\);\s*setSelected\(to\);/);
    expect(source).not.toMatch(/useEffect[\s\S]{0,200}setPicked/);
    // No second, text pager anywhere.
    expect(html).not.toContain("Previous pair</button>");
    // One pair: the dateline and the live label, no counter and no Previous or Next.
    const one = render([item(1, tags)]);
    expect(one).not.toContain("Next pair");
    expect(one).not.toContain("data-pair-count");
    expect(one.replace(/<[^>]+>/g, "")).toContain("Pair 1 of 1: Act 1A and Act 1B");
  });

  it("marks an end by colour: an aria-disabled arrow turns muted, a live one stays ink", () => {
    // The server render opens on pair 1, so Previous is the end; Next carries the same class, which turns its arrow
    // muted when the component sets aria-disabled at the last pair (index === last).
    const html = render([item(1, tags), item(2), item(3)]);
    expect(html).toMatch(/aria-label="Previous pair" aria-controls="ring-panel" aria-disabled="true" class="[^"]*text-foreground aria-disabled:cursor-default aria-disabled:text-muted-foreground"/);
    expect(html).toMatch(/aria-label="Next pair" aria-controls="ring-panel" class="[^"]*text-foreground aria-disabled:cursor-default aria-disabled:text-muted-foreground"/);
  });

  it("sets each act's genre tags as a balanced run that breaks only between tags, with nothing clamped", () => {
    const genres = ["urn:tag:genre:dream_pop", "urn:tag:genre:ambient", "urn:tag:genre:dark_ambient", "urn:tag:genre:slowcore", "urn:tag:genre:drone"];
    const html = render([{ ...item(1, tags), genres: [genres, ["urn:tag:genre:indie_rock"]] }]);
    const runs = [...html.matchAll(/<p data-genre-run="true" class="([^"]*)">([\s\S]*?)<\/p>/g)];
    expect(runs).toHaveLength(2);
    for (const [, cls] of runs) {
      expect(cls).toBe("mt-0.5 text-[0.8125rem] leading-snug text-balance text-foreground");
      expect(cls).not.toMatch(/line-clamp|truncate|break-all/);
    }
    // One nowrap span per tag, each carrying its trailing comma, joined by plain spaces; plain text, never chips.
    const spans = [...runs[0][2].matchAll(/<span class="([^"]*)">([^<]*)(?:<!-- -->)?(,)?<\/span>/g)];
    expect(spans.map((m) => m[1])).toEqual(["whitespace-nowrap", "whitespace-nowrap", "whitespace-nowrap", "whitespace-nowrap"]);
    expect(spans.map((m) => m[2] + (m[3] ?? ""))).toEqual(["Dream Pop,", "Ambient,", "Dark Ambient,", "Slowcore"]);
    expect(runs[0][2].match(/<\/span> <span /g)).toHaveLength(3);
    // The run reads as the same words genreText gives (the first four tags), and an act with none says so.
    const words = (run: string) => run.replace(/<[^>]+>/g, "");
    expect(words(runs[0][2])).toBe(genreText(genres));
    expect(genreText(genres)).toBe("Dream Pop, Ambient, Dark Ambient, Slowcore");
    expect(words(runs[1][2])).toBe("Indie Rock");
    const none = render([{ ...item(1, tags), genres: [[], ["urn:tag:genre:punk"]] }]);
    expect(none).toContain('<p data-genre-run="true" class="mt-0.5 text-[0.8125rem] leading-snug text-balance text-foreground">no genre tags</p>');
    expect(genreText(undefined)).toBe("no genre tags");
  });

  it("moves between pairs with ArrowLeft, ArrowRight, Home and End on the pager row, wrapping at the ends", () => {
    expect(pairKeyTarget("ArrowRight", 0, 7)).toBe(1);
    expect(pairKeyTarget("ArrowRight", 7, 7)).toBe(0);
    expect(pairKeyTarget("ArrowLeft", 0, 7)).toBe(7);
    expect(pairKeyTarget("ArrowLeft", 3, 7)).toBe(2);
    expect(pairKeyTarget("Home", 5, 7)).toBe(0);
    expect(pairKeyTarget("End", 2, 7)).toBe(7);
    expect(pairKeyTarget("Enter", 2, 7)).toBe(-1);
    expect(pairKeyTarget("Tab", 2, 7)).toBe(-1);
    // The handler sits on the pager row (a labelled group), so it works from either button.
    expect(render([item(1, tags), item(2)])).toContain(
      '<div data-pair-nav="true" role="group" aria-label="Example pairs. Use the arrow keys or Previous and Next to see another pair."',
    );
  });

  it("prints no tag list for a pair with no tags", () => {
    const html = render([item(1)]);
    expect(html).not.toContain("data-shared-tags");
    expect(html).toContain("No tags saved for this pair.");
  });
});
