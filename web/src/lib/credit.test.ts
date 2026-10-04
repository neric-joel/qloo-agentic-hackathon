import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MethodPage from "@/app/method/page";
import { AgentPanel } from "@/components/clash/agent-panel";
import { BudgetDial } from "@/components/clash/budget-dial";
import { ClashDetails } from "@/components/clash/clash-drawer";
import { ClashList } from "@/components/clash/clash-list";
import { CoverageMeter } from "@/components/clash/coverage-meter";
import { HiddenWall } from "@/components/clash/hidden-wall";
import { PresetSources } from "@/components/clash/preset-sources";
import { TasteLens } from "@/components/clash/taste-lens";
import { TimetableGrid } from "@/components/clash/timetable-grid";
import { TimetableLegend } from "@/components/clash/timetable-legend";
import { TimetableList } from "@/components/clash/timetable-list";
import { TryAMove } from "@/components/clash/try-a-move";
import { TwinCards } from "@/components/clash/twin-cards";
import { SummaryBoard, SummaryScore } from "@/components/clash/server-summary";
import { WhyThisMatters } from "@/components/clash/why-this-matters";
import { TraceDrawer } from "@/components/kernel";
import { SiteFooter } from "@/components/site/site-footer";
import { SyntheticBanner } from "@/components/site/synthetic-banner";
import { SyntheticContext } from "@/components/site/synthetic-context";
import { buildSetViews, topClashes } from "@/lib/clashes";
import {
  BUILT_FROM_REAL,
  BUILT_FROM_SYNTHETIC,
  COUNTS_ONLY,
  COUNTS_ONLY_NEUTRAL,
  drawPriorList,
  formulaNote,
  formulaNoteShort,
  boardTraceDescription,
  noSignalMove,
  qlooCredits,
  usedTitle,
} from "@/lib/credit";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import type { Lenses } from "@/lib/lenses";
import { parsePreset, type Preset } from "@/lib/preset";
import { summarize } from "@/lib/server-summary";

// Every name and figure below is invented for the test. The invented day is the tiny preset with the
// server's flag set, which is how the API marks its day with no Qloo data behind it.

function text(markup: string): string {
  return markup
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&rsquo;|’/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** The `title` attributes carry tooltips (a chip's description): they are read as text too. */
function titles(markup: string): string {
  return [...markup.matchAll(/(?:title|aria-label)="([^"]*)"/g)].map((match) => match[1]).join(". ");
}

function everything(element: ReactElement): string {
  const markup = renderToStaticMarkup(element);
  return `${text(markup)}. ${titles(markup)}`;
}

const invented = () => parsePreset({ ...rawTinyPreset(), synthetic: true });
const published = () => parsePreset(rawTinyPreset());

/** One weak act so the signal labels appear too. */
function withWeak(preset: Preset): Preset {
  return {
    ...preset,
    report: {
      ...preset.report,
      coverage: { ...preset.report.coverage, weak: 1, strong: 1, weak_act_ids: ["bo"] },
    },
  };
}

const LENSES: Lenses = {
  day: 0,
  ranked: 15,
  with_taste: [{ a: "Ann Arbor", b: "Bo Diddly Squat", a_id: "ann", b_id: "bo", rank: 1, rank_without_taste: 21 }],
  without_taste: [{ a: "Ann Arbor", b: "Cy Twombly", a_id: "ann", b_id: "cy", rank: 1, rank_with_taste: 17 }],
  only_with_taste: 10,
  only_without_taste: 9,
  apart: [{ a: "Ann Arbor", b: "Cy Twombly", a_id: "ann", b_id: "cy" }],
  shuffled: { runs: 200, median: 10, low: 8, high: 12 },
};

const noop = () => {};

/** Every component that can credit Qloo, mounted on the day it is given. */
function mount(preset: Preset): Record<string, string> {
  const synthetic = preset.synthetic === true;
  const views = buildSetViews(preset, 0);
  const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
  const slots = new Map(preset.festival.timetable.map((slot) => [slot.act_id, slot]));
  const stages = new Map(preset.festival.stages.map((stage) => [stage.id, stage]));
  const grid = (element: ReactElement) => element;
  return {
    "clash drawer (hidden clash)": everything(
      createElement(ClashDetails, {
        preset,
        shown: ranked[0],
        rankWithoutTaste: () => 3,
        rankWithoutTasteOf: 40,
      }),
    ),
    "clash drawer (weak signal)": everything(
      createElement(ClashDetails, {
        preset: withWeak(preset),
        shown: { ...ranked[0], label: null, confidence: "weak" },
      }),
    ),
    "coverage strip": everything(
      createElement(CoverageMeter, { coverage: withWeak(preset).report.coverage, metrics: preset.report.metrics, synthetic }),
    ),
    "timetable legend": everything(createElement(TimetableLegend, { planShown: true, synthetic })),
    "timetable grid": everything(
      grid(
        createElement(TimetableGrid, {
          views,
          stages: preset.festival.stages,
          links: ranked,
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
      ),
    ),
    "timetable list": everything(createElement(TimetableList, { views, dayLabel: "Sat", onOpen: noop, synthetic })),
    "clash list": everything(
      createElement(ClashList, {
        clashes: ranked,
        slots,
        stages,
        totalRanked: ranked.length,
        activeKeys: new Set<string>(),
        dimmed: false,
        onOpen: noop,
        onHighlight: noop,
        synthetic,
      }),
    ),
    "try a move": everything(
      createElement(TryAMove, { preset, day: 0, ranked, isLocked: (actId: string) => actId === "ann" }),
    ),
    "taste lens": everything(createElement(TasteLens, { lenses: LENSES, ranked, onOpen: noop, synthetic })),
    "taste lens (no shuffle)": everything(
      createElement(TasteLens, {
        lenses: { ...LENSES, shuffled: undefined },
        ranked,
        onOpen: noop,
        synthetic,
      }),
    ),
    "twin cards": everything(
      createElement(TwinCards, { twins: preset.evidence?.twins ?? [], acts: preset.festival.acts, synthetic }),
    ),
    "hidden wall": everything(createElement(HiddenWall, { evidence: preset.evidence, synthetic })),
    "budget dial": everything(
      createElement(BudgetDial, { index: 104.2, baseline: preset.report.baseline, reach: "each set stays in its window", synthetic }),
    ),
    "budget dial (compact)": everything(
      createElement(BudgetDial, { index: 104.2, baseline: preset.report.baseline, reach: "x", compact: true, synthetic }),
    ),
    "sources": everything(createElement(PresetSources, { preset })),
    // The first page's server HTML, before the interactive page loads: the Derived chip's tooltip and the board's notes.
    "summary score": everything(createElement(SummaryScore, { summary: summarize(preset) })),
    "summary board": everything(createElement(SummaryBoard, { summary: summarize(preset) })),
    // The board's trace button, with the props the board gives it.
    "board trace button": everything(
      createElement(TraceDrawer, {
        toolCalls: [],
        mode: "recorded",
        triggerVariant: "ink",
        triggerLabel: usedTitle(synthetic),
        title: usedTitle(synthetic),
        synthetic,
        description: boardTraceDescription(synthetic, preset.title),
      }),
    ),
    "agent panel": everything(createElement(AgentPanel, { preset, day: 0, agentStatus: "off" })),
  };
}

describe("the invented day credits no Qloo anywhere on the page", () => {
  const sweep = mount(invented());

  it("mounts every component and finds no Qloo credit, only denials", () => {
    expect(Object.keys(sweep).length).toBeGreaterThan(15);
    for (const [name, rendered] of Object.entries(sweep)) {
      expect(rendered.length, name).toBeGreaterThan(20);
      expect(qlooCredits(rendered), name).toEqual([]);
    }
  });

  it("still credits Qloo on a published day, so the sweep tests something", () => {
    const real = mount(published());
    // Each of the components the invented day had to change credits Qloo on a published day.
    for (const name of [
      "clash drawer (hidden clash)",
      "clash drawer (weak signal)",
      "coverage strip",
      "timetable legend",
      "timetable grid",
      "timetable list",
      "taste lens",
      "taste lens (no shuffle)",
      "sources",
      "summary score",
      "board trace button",
    ]) {
      expect(qlooCredits(real[name]).length, name).toBeGreaterThan(0);
    }
  });

  it("says the figures are invented where a published day says Qloo", () => {
    expect(sweep["clash drawer (hidden clash)"]).toContain("an invented figure for an invented day");
    expect(sweep["clash drawer (hidden clash)"]).toContain("Draw (invented popularity)");
    expect(sweep["clash drawer (hidden clash)"]).toContain("Where the figures came from");
    expect(sweep["clash drawer (hidden clash)"]).toContain("No Qloo request was made for this day: its figures are invented.");
    expect(sweep["clash drawer (hidden clash)"]).toContain("Shared tags for this pair");
    expect(sweep["clash drawer (hidden clash)"]).toContain("(draw is also an invented figure here)");
    expect(sweep["clash drawer (hidden clash)"]).not.toContain("Check it with Qloo now");
    expect(sweep["clash drawer (weak signal)"]).toContain("Weak signal: the figures for at least one act are thin");
    expect(sweep["coverage strip"]).toContain("Signal coverage");
    expect(sweep["timetable legend"]).toContain("No priced signal: left out, not scored as zero");
    expect(sweep["timetable list"]).toContain("No priced signal, not priced");
    expect(sweep["timetable grid"]).toContain("No priced signal");
    expect(sweep["taste lens"]).toContain("not that these numbers pick the right clashes");
    expect(sweep["taste lens (no shuffle)"]).toContain("popularity is also an invented figure here");
    expect(noSignalMove(true, "Cy Twombly")).toBe(
      "Cy Twombly has no usable signal on this day, so its clashes are not priced and no place changes the Clash Budget Index.",
    );
    expect(noSignalMove(false, "Cy Twombly")).toMatch(/^Qloo has no usable signal for Cy Twombly/);
  });

  it("keeps the real words on a published day", () => {
    const real = mount(published());
    expect(real["clash drawer (hidden clash)"]).toContain("calculated from Qloo data");
    expect(real["clash drawer (hidden clash)"]).toContain("Draw (Qloo popularity)");
    expect(real["clash drawer (hidden clash)"]).toContain("Tags Qloo returned for this pair");
    expect(real["clash drawer (hidden clash)"]).toContain("How Qloo was used");
    expect(real["coverage strip"]).toContain("Qloo coverage");
    expect(real["timetable legend"]).toContain("No Qloo signal: left out, not scored as zero");
    expect(real["taste lens"]).toContain("not that Qloo's numbers pick the right clashes");
  });
});

describe("the invented day: the pieces that used to credit Qloo", () => {
  const wrap = (value: boolean, child: ReactElement) => createElement(SyntheticContext.Provider, { value }, child);

  it("labels the board's trace button as where the figures came from, with no stray space before its comma", () => {
    const sweep = mount(invented());
    const markup = renderToStaticMarkup(
      createElement(TraceDrawer, { toolCalls: [], mode: "recorded", triggerLabel: usedTitle(true), synthetic: true }),
    );
    expect(markup).toContain('aria-label="Where the figures came from, 0 requests"');
    expect(markup).not.toMatch(/ ,\s*\d+ requests?/);
    expect(sweep["board trace button"]).not.toContain("How Qloo was used");
    const real = renderToStaticMarkup(createElement(TraceDrawer, { toolCalls: [], mode: "recorded" }));
    expect(real).toContain('aria-label="How Qloo was used, 0 requests"');
    expect(real).not.toMatch(/ ,\s*\d+ requests?/);
  });

  it("calls the server summary's Derived chip invented, not Qloo data", () => {
    const markup = renderToStaticMarkup(createElement(SummaryScore, { summary: summarize(invented()) }));
    expect(markup).toContain("Calculated by this app from invented figures.");
    expect(markup).not.toContain("from Qloo data");
    expect(renderToStaticMarkup(createElement(SummaryScore, { summary: summarize(published()) }))).toContain(
      "Calculated by this app from Qloo data.",
    );
  });

  it("opens /method without crediting Qloo, and prints the invented day's formula note", () => {
    const method = text(renderToStaticMarkup(wrap(true, createElement(MethodPage))));
    expect(method).toContain("a number it calculates from taste-overlap and draw figures");
    expect(method).not.toContain("a number it derives from Qloo data");
    const opening = method.slice(method.indexOf("Clash Control prices set-time clashes"), method.indexOf("This page says what that number is"));
    expect(qlooCredits(opening)).toEqual([]);
    expect(method).toContain(formulaNote(true));
    expect(method).not.toContain(formulaNote(false));
    const real = text(renderToStaticMarkup(wrap(false, createElement(MethodPage))));
    expect(real).toContain("a number it derives from Qloo data");
    expect(real).toContain(formulaNote(false));
  });

  it("says the home evidence block's popularity figure is about the published festivals", () => {
    const block = text(renderToStaticMarkup(createElement(WhyThisMatters)));
    expect(block).toContain("An exploratory follow-up on those published festivals");
    expect(block).toMatch(/on the same set, popularity, also a Qloo field, scores 0\.\d{3}\./);
  });
});

describe("the whole-page pieces read one shared flag", () => {
  const wrap = (value: boolean, child: ReactElement) => createElement(SyntheticContext.Provider, { value }, child);

  it("agrees between the banner, the footer and the method page when the flag is true", () => {
    const banner = text(renderToStaticMarkup(wrap(true, createElement(SyntheticBanner))));
    const footer = text(renderToStaticMarkup(wrap(true, createElement(SiteFooter))));
    const method = text(renderToStaticMarkup(wrap(true, createElement(MethodPage))));
    expect(banner).toContain("Synthetic example day");
    expect(qlooCredits(footer)).toEqual([]);
    expect(footer).toContain("invented example day");
    expect(method).toContain(BUILT_FROM_SYNTHETIC);
  });

  it("follows the client when it learns the day is invented, whatever the server rendered", () => {
    // The server rendered the footer from a failed read (false); the provider then holds true.
    const footer = text(renderToStaticMarkup(wrap(true, createElement(SiteFooter, { synthetic: false }))));
    expect(footer).toContain("invented example day");
    expect(footer).not.toContain("saved Qloo responses");
    // And back: the server said invented, the client list says it is not.
    const back = text(renderToStaticMarkup(wrap(false, createElement(SiteFooter, { synthetic: true }))));
    expect(back).toContain("saved Qloo responses");
  });

  it("falls back to the server's reading when no provider is above", () => {
    expect(text(renderToStaticMarkup(createElement(SiteFooter, { synthetic: true })))).toContain("invented example day");
    expect(text(renderToStaticMarkup(createElement(SiteFooter)))).toContain("saved Qloo responses");
    expect(renderToStaticMarkup(createElement(SyntheticBanner, { initial: true }))).toContain("Synthetic example day");
  });

  it("prints the real built-from line on a published day", () => {
    const method = text(renderToStaticMarkup(createElement(MethodPage)));
    expect(method).toContain(BUILT_FROM_REAL);
    expect(method).not.toContain(BUILT_FROM_SYNTHETIC);
  });
});

describe("the price words", () => {
  it("says the factors are on a 0 to 1 scale, rounded, with a stand-in draw by billing tier", () => {
    expect(drawPriorList()).toBe("0.9, 0.7, 0.5 and 0.3");
    for (const synthetic of [false, true]) {
      const note = formulaNote(synthetic);
      expect(note).toContain("0 to 1 scale");
      expect(note).toContain("shown out of 100");
      expect(note).toContain("rounded when printed, so they may not multiply to exactly the printed price");
      expect(note).toContain("stand-in draw set by its billing tier (0.9, 0.7, 0.5 and 0.3 for tiers 1 to 4)");
      expect(formulaNoteShort(synthetic)).toContain("0 to 1 scale and rounded when printed");
    }
    expect(formulaNote(false)).toContain("no Qloo popularity");
    expect(formulaNote(true)).toContain("no popularity figure");
    expect(qlooCredits(formulaNote(true))).toEqual([]);
  });

  it("names the rarity factor wherever it says what the index counts", () => {
    expect(COUNTS_ONLY).toBe("It counts only what clashes cost: taste overlap, time shared, draw and a rarity factor.");
    expect(COUNTS_ONLY_NEUTRAL).toBe(
      "It counts only what clashes cost: taste overlap, time shared, draw and a rarity factor (rarity is neutral on the two published days).",
    );
  });

  it("puts the factors' scale and rounding in the drawer and the lens", () => {
    const drawer = everything(
      createElement(ClashDetails, { preset: published(), shown: published().report.clashes[0] }),
    );
    expect(drawer).toContain("Factors are on a 0 to 1 scale and rounded when printed");
    const lens = everything(createElement(TasteLens, { lenses: LENSES, ranked: [], onOpen: noop }));
    expect(lens).toContain("The factors are on a 0 to 1 scale");
  });
});

describe("qlooCredits", () => {
  it("lets denials through and flags credits", () => {
    expect(qlooCredits("No Qloo request was made. The figures are invented.")).toEqual([]);
    expect(qlooCredits("This is an independent entry, not endorsed by Qloo.")).toEqual([]);
    expect(qlooCredits("Calculated from Qloo data. No Qloo data is behind the rest.")).toEqual([
      "Calculated from Qloo data.",
    ]);
    expect(qlooCredits("Draw (Qloo popularity) is shown.")).toHaveLength(1);
  });
});
