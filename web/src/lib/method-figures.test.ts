import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MethodPage, { metadata } from "@/app/method/page";

import {
  METHOD_FIGURES,
  formatAuc,
  formatInterval,
  formatPct,
  formatWholePct,
  methodRow,
  numberWord,
} from "./method-figures";

const { backtest, coverage, index, moves, scale } = METHOD_FIGURES;

/** The page as a reader (or a crawler) gets it: the static HTML with its tags removed. */
function pageText(): string {
  const html = renderToStaticMarkup(createElement(MethodPage));
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&times;/g, "×")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every number the figures module holds, in each form the page may print it. */
function allowedNumerals(): Set<string> {
  const allowed = new Set<string>();
  const add = (value: number) => {
    allowed.add(String(value));
    allowed.add(value.toFixed(1));
    allowed.add(formatAuc(value));
  };
  const walk = (value: unknown): void => {
    if (typeof value === "number") add(value);
    else if (typeof value === "string") (value.match(/\d+(?:\.\d+)?/g) ?? []).forEach((n) => allowed.add(n));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(METHOD_FIGURES);
  return allowed;
}

describe("method figures", () => {
  it("pins the backtest table", () => {
    expect(backtest.rows.map((row) => row.id)).toEqual(["taste", "genre", "popularity", "random"]);
    expect(methodRow("taste")).toMatchObject({ topQuarterPct: 46.8, auc: 0.634, auc95: [0.517, 0.755] });
    expect(methodRow("genre")).toMatchObject({ topQuarterPct: 39.0, auc: 0.512, auc95: [0.414, 0.622] });
    expect(methodRow("popularity")).toMatchObject({
      topQuarterPct: 57.8,
      auc: 0.722,
      auc95: [0.631, 0.801],
    });
    expect(methodRow("random")).toMatchObject({ topQuarterPct: 26.3, auc: 0.5, auc95: null });
  });

  it("pins the denominators", () => {
    expect(backtest.scoredPairs).toBe(68);
    expect(backtest.clusters).toBe(42);
    expect(backtest.unscoredPairs).toBe(16);
    expect(backtest.festivals).toBe(5);
    expect(backtest.usFestivals).toBe(4);
    expect(backtest.festivalDays).toBe(15);
  });

  it("pins the bar and the result against it", () => {
    expect(backtest.bar).toEqual({ topQuarterPct: 60, leadOverGenrePoints: 10 });
    expect(backtest.leadOverGenrePoints).toBe(7.8);
    const lead = methodRow("taste").topQuarterPct - methodRow("genre").topQuarterPct;
    expect(Math.round(lead * 10) / 10).toBe(backtest.leadOverGenrePoints);
    // Both halves of the bar were missed.
    expect(methodRow("taste").topQuarterPct).toBeLessThan(backtest.bar.topQuarterPct);
    expect(backtest.leadOverGenrePoints).toBeLessThan(backtest.bar.leadOverGenrePoints);
    // Popularity did better on the same test; the page says so.
    expect(methodRow("popularity").topQuarterPct).toBeGreaterThan(methodRow("taste").topQuarterPct);
    expect(methodRow("popularity").auc).toBeGreaterThan(methodRow("taste").auc);
  });

  it("pins the audit figures", () => {
    expect(backtest.popularityCorrelation).toBe(0.08);
    expect(backtest.glastonbury).toMatchObject({ namedClashes: 8, inTopQuarter: 7, auc: 0.94 });
    expect(backtest.usFestivalsAuc).toBe(0.55);
    expect(backtest.hidden).toEqual({ pairs: 185, complained: 15, complainedPct: 8.1, basePct: 5.0 });
    const rate = (100 * backtest.hidden.complained) / backtest.hidden.pairs;
    expect(Math.round(rate * 10) / 10).toBe(backtest.hidden.complainedPct);
  });

  it("pins coverage, and each percentage matches its counts", () => {
    expect(coverage.usableActs).toBe(449);
    expect(coverage.totalActs).toBe(624);
    expect(coverage.usablePct).toBe(72);
    expect(Math.round((100 * coverage.usableActs) / coverage.totalActs)).toBe(coverage.usablePct);
    expect(coverage.days.map((day) => `${day.scored}/${day.total}`)).toEqual(["36/39", "31/34"]);
    for (const day of coverage.days) {
      expect(Math.round((100 * day.scored) / day.total)).toBe(day.pct);
    }
  });

  it("pins the index baseline and the move check", () => {
    expect(index.baselineSamples).toBe(300);
    expect(moves).toEqual({ barPoints: 10, measuredPoints: 7.1, movesDiffer: 7, movesCompared: 8 });
    expect(moves.measuredPoints).toBeLessThan(moves.barPoints);
    expect(scale).toEqual({ overlap: [0, 100], indexMultiplier: 100, intervalPct: 95 });
  });
});

describe("method formatters", () => {
  it("prints percentages, AUCs and intervals as the sources report them", () => {
    expect(formatPct(46.8)).toBe("46.8%");
    expect(formatPct(39)).toBe("39.0%");
    expect(formatPct(5)).toBe("5.0%");
    expect(formatWholePct(91.18)).toBe("91%");
    expect(formatAuc(0.5)).toBe("0.500");
    expect(formatAuc(0.634)).toBe("0.634");
    expect(formatInterval([0.517, 0.755])).toBe("0.517 to 0.755");
  });

  it("spells out small whole numbers and leaves the rest as digits", () => {
    expect(numberWord(5)).toBe("five");
    expect(numberWord(16, { capitalize: true })).toBe("Sixteen");
    expect(numberWord(42)).toBe("42");
    expect(numberWord(7.1)).toBe("7.1");
  });

  it("finds every row and refuses an unknown one", () => {
    expect(methodRow("genre").method).toBe("Genre-tag overlap");
    // @ts-expect-error: not a method id.
    expect(() => methodRow("vibes")).toThrow();
  });
});

describe("/method page", () => {
  it("exports its title and description", () => {
    expect(metadata.title).toBe("How we know");
    expect(metadata.description).toMatch(/where it fell short/);
  });

  it("renders to static HTML with the failed checks stated plainly", () => {
    const text = pageText();
    expect(text).toContain("How we know");
    expect(text).toContain("The test we set before building failed.");
    expect(text).toContain("It reached 46.8%, 7.8 points ahead. It missed the bar.");
    expect(text).toContain("the check failed as written.");
    expect(text).toContain("68 scored pairs from 42 complaints");
    expect(text).toContain("Sixteen more could not be scored");
    expect(text).toContain("36 of 39 sets (92%) and 31 of 34 sets (91%)");
    expect(text).toContain("Back to the timetable");
    // The failed gate comes before the method details.
    expect(text.indexOf("failed")).toBeLessThan(text.indexOf("What the price is"));
  });

  it("renders the backtest table with one row per method", () => {
    const html = renderToStaticMarkup(createElement(MethodPage));
    const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
    expect(body.match(/<tr/g)).toHaveLength(4);
    expect(body).toContain("0.634");
    expect(body).toContain("0.517 to 0.755");
    expect(body).toContain("57.8%");
    expect(body).toContain("0.500");
  });

  it("prints no number that is not in the figures module", () => {
    const allowed = allowedNumerals();
    const printed = pageText().match(/\d+(?:\.\d+)?/g) ?? [];
    expect(printed.length).toBeGreaterThan(30);
    expect(printed.filter((numeral) => !allowed.has(numeral))).toEqual([]);
  });

  it("uses the word that denies prediction exactly once", () => {
    expect(pageText().match(/predict/gi)).toHaveLength(1);
  });
});
