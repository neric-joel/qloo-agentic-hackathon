import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MethodPage, { metadata } from "@/app/method/page";
import { FIGURE_TICKS } from "@/components/clash/why-this-matters";
import { SyntheticContext } from "@/components/site/synthetic-context";

import {
  METHOD_FIGURES,
  clusterClause,
  countsNote,
  formatAuc,
  formatCount,
  exploratoryReading,
  formatDiff,
  formatDiffInterval,
  formatInterval,
  formatP,
  formatPct,
  formatWholePct,
  formatWithin,
  methodRow,
  numberWord,
  tasteInPriceReading,
} from "./method-figures";
import { PUBLIC_SOURCES } from "./public-sources";

const { backtest, complaints, coverage, exploratory, index, liveCheck, moves, price, scale, symmetry } =
  METHOD_FIGURES;

/** The page as a reader (or a crawler) gets it: the static HTML with its tags removed. */
function pageText(): string {
  const html = renderToStaticMarkup(createElement(MethodPage));
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&rsquo;|’/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&times;/g, "×")
    .replace(/\s+/g, " ")
    .trim();
}

// The complaint set lives in the entry's private backtest folder (not in this repository). The test that reads it
// skips when the file is absent, as it is on a clean clone.
const COMPLAINTS = fileURLToPath(new URL("../../../_private/backtest/complaints.json", import.meta.url));

/** A printed numeral: "18,762", "0.634", "3". */
const NUMERAL = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** Every number the figures module holds, in each form the page may print it. */
function allowedNumerals(): Set<string> {
  const allowed = new Set<string>();
  const add = (value: number) => {
    // A printed numeral carries no sign: "-0.098" is matched as "0.098"
    value = Math.abs(value);
    allowed.add(String(value));
    allowed.add(formatP(value));
    allowed.add(value.toFixed(1));
    allowed.add(formatAuc(value));
    allowed.add(formatCount(value));
    allowed.add(formatWithin(value));
  };
  const walk = (value: unknown): void => {
    if (typeof value === "number") add(value);
    else if (typeof value === "string") (value.match(NUMERAL) ?? []).forEach((n) => allowed.add(n));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(METHOD_FIGURES);
  // The backtest figure's axis labels are scale ticks, not findings (round 24: one 0 to 75 axis).
  FIGURE_TICKS.forEach(add);
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

  it("pins the complaint set the figures come from", () => {
    expect(complaints).toEqual({
      festivals: 5,
      clustersVerified: 45,
      pairsVerified: 86,
      medianMinutes: 50,
      rangeMinutes: [10, 90],
    });
    // 45 clusters here, 42 of them with a scored pair in the backtest
    expect(complaints.clustersVerified).toBeGreaterThan(backtest.clusters);
    expect(complaints.pairsVerified).toBeGreaterThan(backtest.scoredPairs);
    expect(complaints.festivals).toBe(backtest.festivals);
    expect(complaints.rangeMinutes[0]).toBeLessThanOrEqual(complaints.medianMinutes);
    expect(complaints.medianMinutes).toBeLessThanOrEqual(complaints.rangeMinutes[1]);
  });

  it("pins the public sources: ten unique https pages", () => {
    expect(PUBLIC_SOURCES).toHaveLength(10);
    expect(new Set(PUBLIC_SOURCES).size).toBe(PUBLIC_SOURCES.length);
    for (const url of PUBLIC_SOURCES) {
      expect(url).toMatch(/^https:\/\/[a-z0-9.-]+\/\S+$/);
      expect(url).not.toMatch(/[?#]/);
    }
    expect(PUBLIC_SOURCES.filter((url) => url.includes("reddit.com"))).toHaveLength(4);
  });

  it.skipIf(!existsSync(COMPLAINTS))(
    "matches the complaint set it was counted from, when that private file is present",
    () => {
      type Pair = { status: string; cluster: string; source: string; overlap_min: number; festival: string };
      const pairs = JSON.parse(readFileSync(COMPLAINTS, "utf8")) as Pair[];
      const verified = pairs.filter((pair) => pair.status === "verified");
      const minutes = verified.map((pair) => pair.overlap_min).sort((a, b) => a - b);
      const middle = minutes.length / 2;
      const median =
        minutes.length % 2 ? minutes[Math.floor(middle)] : (minutes[middle - 1] + minutes[middle]) / 2;
      expect({
        festivals: new Set(verified.map((pair) => pair.festival)).size,
        clustersVerified: new Set(verified.map((pair) => pair.cluster)).size,
        pairsVerified: verified.length,
        medianMinutes: median,
        rangeMinutes: [minutes[0], minutes[minutes.length - 1]],
      }).toEqual(complaints);
      expect([...new Set(verified.map((pair) => pair.source))]).toEqual([...PUBLIC_SOURCES]);
    },
  );

  it("pins the exploratory figures, and the p and the gap agree with their own definitions", () => {
    expect(exploratory).toEqual({
      shuffles: 10000,
      shufflesAtLeast: 1,
      p: 0.0002,
      pBar: 0.05,
      gap: 0.088,
      gapInterval: [-0.098, 0.254],
    });
    // p = (shuffles at or above the observed + 1) / (shuffles + 1), as the script prints it to 4 decimals
    expect(((exploratory.shufflesAtLeast + 1) / (exploratory.shuffles + 1)).toFixed(4)).toBe(
      formatP(exploratory.p),
    );
    // The gap is popularity's AUC minus taste overlap's, to three decimals
    const gap = methodRow("popularity").auc - methodRow("taste").auc;
    expect(Math.round(gap * 1000) / 1000).toBe(exploratory.gap);
    const [low, high] = exploratory.gapInterval;
    expect(low).toBeLessThan(exploratory.gap);
    expect(exploratory.gap).toBeLessThan(high);
  });

  it("reads the exploratory figures: p under its bar, a gap interval that holds zero", () => {
    expect(exploratoryReading()).toEqual({ pAboveBar: false, gapIncludesZero: true });
    const figures = { ...exploratory, p: 0.2, gapInterval: [0.02, 0.2] as const };
    expect(exploratoryReading(figures)).toEqual({ pAboveBar: true, gapIncludesZero: false });
    expect(formatP(0.0002)).toBe("0.0002");
    expect(formatP(0.1872)).toBe("0.1872");
  });

  it("words the cluster clause and the two sets of counts from the pinned figures", () => {
    expect(clusterClause()).toBe("the 68 pairs come from 42 complaints, so this p understates the uncertainty");
    expect(countsNote()).toBe(
      "The 45 complaints and 86 pairs counted elsewhere on this site are the verified overlaps in the public set; the AUC scores 68 pairs from 42 complaints, the ones with a Qloo signal for both acts; 16 more have no Qloo signal for one act, and 2 involve a set on a minor stage the test leaves out.",
    );
    const html = renderToStaticMarkup(createElement(MethodPage)).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    expect(html).toContain("the 68 pairs come from 42 complaints, so the real uncertainty is wider than that p suggests.");
    expect(html).toContain(countsNote());
  });

  it("pins the taste-inside-the-price figures as literals (round 32, exploratory)", () => {
    expect(METHOD_FIGURES.tasteInPrice).toEqual({
      fullPrice: { auc: 0.746, auc95: [0.675, 0.812] },
      popularity: 0.722,
      pairedVsPopularity: { diff: 0.024, interval: [-0.074, 0.136] },
      shuffled: { mean: 0.652, range95: [0.593, 0.706], shuffles: 1000 },
      tasteRemoved: { auc: 0.754, auc95: [0.69, 0.828] },
      pairedVsTasteRemoved: { diff: -0.009, interval: [-0.102, 0.079] },
      festivals: [
        {
          label: "Glastonbury 2025",
          complaintPairs: 14,
          complaints: 8,
          read: { popularity: 0.563, tasteRemoved: 0.671, fullPrice: 0.871 },
        },
        {
          label: "Four US festivals",
          complaintPairs: 54,
          complaints: 34,
          read: { popularity: 0.768, tasteRemoved: 0.779, fullPrice: 0.715 },
        },
        { label: "Riot Fest 2026, one of the four", complaintPairs: 5, complaints: 3, read: null },
      ],
      glastonburyTasteAdds: { diff: 0.201, interval: [0.111, 0.277] },
      usTasteAdds: { diff: -0.065, interval: [-0.163, 0.025] },
      locationRequests: 347,
    });
  });

  it("agrees with itself: the festival rows add up, each difference matches its AUCs, and the readings follow the intervals", () => {
    const t = METHOD_FIGURES.tasteInPrice;
    // The same popularity AUC as the backtest table; the Glastonbury row's pairs and complaints are the table's.
    expect(t.popularity).toBe(methodRow("popularity").auc);
    const [glasto, us, riot] = t.festivals;
    expect(glasto.complaintPairs + us.complaintPairs).toBe(backtest.scoredPairs);
    expect(glasto.complaints + us.complaints).toBe(backtest.clusters);
    expect(glasto.complaints).toBe(backtest.glastonbury.namedClashes);
    expect(riot.complaintPairs).toBeLessThan(us.complaintPairs);
    // Each paired difference is its two pooled AUCs' difference, to rounding (the figures are rounded separately).
    expect(Math.abs(t.fullPrice.auc - t.popularity - t.pairedVsPopularity.diff)).toBeLessThanOrEqual(0.0011);
    expect(Math.abs(t.fullPrice.auc - t.tasteRemoved.auc - t.pairedVsTasteRemoved.diff)).toBeLessThanOrEqual(0.0011);
    expect(Math.abs(glasto.read!.fullPrice - glasto.read!.tasteRemoved - t.glastonburyTasteAdds.diff)).toBeLessThanOrEqual(0.0011);
    expect(Math.abs(us.read!.fullPrice - us.read!.tasteRemoved - t.usTasteAdds.diff)).toBeLessThanOrEqual(0.0011);
    // Every estimate sits inside its own interval.
    for (const [value, [low, high]] of [
      [t.fullPrice.auc, t.fullPrice.auc95],
      [t.tasteRemoved.auc, t.tasteRemoved.auc95],
      [t.shuffled.mean, t.shuffled.range95],
      [t.pairedVsPopularity.diff, t.pairedVsPopularity.interval],
      [t.pairedVsTasteRemoved.diff, t.pairedVsTasteRemoved.interval],
      [t.glastonburyTasteAdds.diff, t.glastonburyTasteAdds.interval],
      [t.usTasteAdds.diff, t.usTasteAdds.interval],
    ] as const) {
      expect(low).toBeLessThanOrEqual(value);
      expect(value).toBeLessThanOrEqual(high);
    }
    // What the page says follows the intervals: neither advantage was established.
    expect(tasteInPriceReading()).toEqual({ tasteAddsIncludesZero: true, tasteAddsAboveZero: false, popularityIncludesZero: true });
    expect(
      tasteInPriceReading({ pairedVsTasteRemoved: { interval: [0.01, 0.2] }, pairedVsPopularity: { interval: [0.01, 0.2] } }),
    ).toEqual({ tasteAddsIncludesZero: false, tasteAddsAboveZero: true, popularityIncludesZero: false });
  });

  it("prints paired differences signed", () => {
    expect(formatDiff(0.024)).toBe("+0.024");
    expect(formatDiff(-0.009)).toBe("-0.009");
    expect(formatDiffInterval([-0.102, 0.079])).toBe("-0.102 to +0.079");
  });

  it("pins the denominators", () => {
    expect(backtest.scoredPairs).toBe(68);
    expect(backtest.clusters).toBe(42);
    expect(backtest.unscoredPairs).toBe(16);
    expect(backtest.outOfScopePairs).toBe(2);
    // Every verified pair is accounted for (summary-all.json: 86 = 68 scored + 16 abstain + 2 other).
    expect(backtest.scoredPairs + backtest.unscoredPairs + backtest.outOfScopePairs).toBe(METHOD_FIGURES.complaints.pairsVerified);
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

  it("pins the rarity factor of the price and states the whole formula", () => {
    expect(price).toEqual({
      rarityFloor: 0.5,
      neutralRarity: 0.5,
      neutralFactor: 1,
      scaleFactor: [0, 1],
      drawPrior: { 1: 0.9, 2: 0.7, 3: 0.5, 4: 0.3 },
    });
    // The pair factor is the floor plus the mean of the two acts' rarity.
    expect(price.rarityFloor + (price.neutralRarity + price.neutralRarity) / 2).toBe(price.neutralFactor);
    const text = pageText();
    expect(text).toContain(
      "A clash's price is its taste overlap, times the share of the shorter set that the two sets play at once",
    );
    expect(text).toContain("times the two acts' draw (their geometric mean), times a rarity factor of 0.5 plus the average of the two acts' rarity");
    expect(text).toContain("the mean total price of 300 sampled random valid timetables");
  });

  it("pins the stand-in draw to the engine's own table when the backend source is in the tree", () => {
    const source = fileURLToPath(new URL("../../../backend/app/schedule/metrics.py", import.meta.url));
    if (!existsSync(source)) return;
    const line = /^DRAW_PRIOR\s*=\s*{([^}]*)}/m.exec(readFileSync(source, "utf8"))?.[1] ?? "";
    const table = Object.fromEntries(
      [...line.matchAll(/(\d+)\s*:\s*([\d.]+)/g)].map((entry) => [Number(entry[1]), Number(entry[2])]),
    );
    expect(table).toEqual({ ...price.drawPrior });
    const floor = /^RARITY_FLOOR\s*=\s*([\d.]+)/m.exec(readFileSync(source, "utf8"))?.[1];
    expect(Number(floor)).toBe(price.rarityFloor);
  });

  it("says the factors are on a 0 to 1 scale, printed rounded, with a stand-in draw by billing tier", () => {
    const text = pageText();
    expect(text).toContain("The factors are on a 0 to 1 scale (taste overlap and draw are shown out of 100 elsewhere on the page)");
    expect(text).toContain("and are rounded when printed, so they may not multiply to exactly the printed price.");
    expect(text).toContain(
      "An act with no Qloo popularity takes a stand-in draw set by its billing tier (0.9, 0.7, 0.5 and 0.3 for tiers 1 to 4).",
    );
    // The index line names the rarity factor and says why it moves nothing on the saved days.
    expect(text).toContain(
      "It counts only what clashes cost: taste overlap, time shared, draw and a rarity factor (rarity is neutral on the two published days).",
    );
    expect(text).not.toContain("taste overlap, time shared and draw.");
    // The invented day is the exception to a neutral rarity.
    expect(text).toContain("The invented example day, which a server shows when it has no built day, is the exception");
  });

  it("keeps the saved-responses line on a published day and swaps it on the invented one", () => {
    const real = pageText();
    expect(real).toContain(
      "The festival days shown were built from saved Qloo responses; the festivals themselves do not use Clash Control.",
    );
    const invented = renderToStaticMarkup(
      createElement(SyntheticContext.Provider, { value: true }, createElement(MethodPage)),
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(invented).toContain("This server is showing an invented example day: its figures are invented and no Qloo request was made.");
    expect(invented).not.toContain("built from saved Qloo responses");
  });

  it("pins the index baseline and the move check", () => {
    expect(index.baselineSamples).toBe(300);
    expect(moves).toEqual({ barPoints: 10, measuredPoints: 7.1, movesDiffer: 7, movesCompared: 8 });
    expect(moves.measuredPoints).toBeLessThan(moves.barPoints);
    expect(scale).toEqual({
      overlap: [0, 100],
      indexMultiplier: 100,
      indexPointPct: 1,
      intervalPct: 95,
      topQuarterPct: 25,
      auc: { chance: 0.5, perfect: 1 },
    });
    // AUC's chance level is the random row's AUC.
    expect(scale.auc.chance).toBe(methodRow("random").auc);
  });

  it("pins the requests one live re-check sends", () => {
    expect(liveCheck).toEqual({ requests: 3 });
  });

  it("pins the symmetry check's printout: whole counts, one tiny difference, none above 1e-5", () => {
    expect(Object.keys(symmetry).sort()).toEqual(["maxDifference", "pairs", "readings", "readingsAbove"]);
    expect(symmetry).toEqual({ readings: 18762, pairs: 9381, maxDifference: 6.06e-8, readingsAbove: 0 });
    expect(Number.isInteger(symmetry.readings) && Number.isInteger(symmetry.pairs)).toBe(true);
    // Each pair is read in both directions.
    expect(symmetry.readings).toBe(2 * symmetry.pairs);
    expect(symmetry.maxDifference).toBeGreaterThan(0);
    expect(symmetry.maxDifference).toBeLessThan(1e-5);
    expect(symmetry.readingsAbove).toBe(0);
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
    expect(formatCount(18762)).toBe("18,762");
    expect(formatCount(300)).toBe("300");
  });

  it("prints a tiny difference as a decimal bound rounded up, so 'within' stays true", () => {
    expect(formatWithin(6.06e-8)).toBe("0.00000007");
    expect(formatWithin(6e-8)).toBe("0.00000006");
    expect(formatWithin(9.5e-8)).toBe("0.0000001");
    expect(formatWithin(0.034)).toBe("0.04");
    expect(formatWithin(3.2)).toBe("4");
    expect(formatWithin(0)).toBe("0");
    expect(Number(formatWithin(symmetry.maxDifference))).toBeGreaterThanOrEqual(symmetry.maxDifference);
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
    expect(text).toContain("Two more involve a set on a minor stage that the test leaves out, which makes the 86 verified pairs.");
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
    const printed = pageText().match(NUMERAL) ?? [];
    expect(printed.length).toBeGreaterThan(30);
    expect(printed.filter((numeral) => !allowed.has(numeral))).toEqual([]);
  });

  it("states the genre comparison with its overlapping intervals, not as a flat finding", () => {
    const text = pageText();
    expect(text).toContain(
      "What it does show: in this test taste overlap ranked the complained-about clashes above genre tags did (AUC 0.634 against 0.512), though the two intervals overlap widely.",
    );
    expect(text).toContain("It is nearly unrelated to popularity (correlation 0.08)");
    expect(text).not.toContain("carries information a genre label does not");
  });

  it("tells the Hidden label's line apart from the hidden-clash count", () => {
    const text = pageText();
    const label = text.indexOf("The Hidden label on the timetable uses a stricter line than this count");
    expect(label).toBeGreaterThan(text.indexOf("Hidden clashes are examples, not detections."));
    // Round 32 (V6): the label's genre test is the engine's (backend/app/schedule/metrics.py, clash_label): the two
    // acts' main genre tags differ. The count above it still uses no shared genre tag.
    expect(text).toContain(
      "uses a stricter line than this count for taste overlap, the day's top tenth where the count above uses the top quarter, and a looser one for genre: the two acts' main genre tags differ.",
    );
    expect(text).toContain("Of 185 pairs with top-quarter taste overlap and no shared genre tag");
  });

  it("describes the live re-check after the provenance labels, with no figure but its request count", () => {
    const text = pageText();
    const section = text.slice(text.indexOf("The live re-check"));
    expect(text.indexOf("The live re-check")).toBeGreaterThan(text.indexOf("Where each number comes from"));
    expect(section).toContain("can be re-checked with Qloo: 3 requests in all.");
    expect(section).toContain("Fresh results appear beside the saved values and never replace them.");
    expect(section).toContain("Checks are limited per visitor and per day, and pause when the monthly Qloo allowance runs low.");
    expect(section.slice(0, section.indexOf("Back to the timetable")).match(/\d+/g)).toEqual(["3"]);
  });

  it("says the check is offered only while it is switched on, for the day's costliest clashes", () => {
    const text = pageText();
    expect(text).toContain(
      "While enabled, the day's costliest clashes can be re-checked with Qloo: 3 requests in all. Fresh results appear beside the saved values and never replace them. Request IDs appear when Qloo supplies them. Checks are limited per visitor and per day, and pause when the monthly Qloo allowance runs low. When disabled, only saved results appear.",
    );
    expect(text).not.toContain("Every priced clash can be re-checked");
  });

  it("lists the kept-moves limit after the hidden-clash items", () => {
    const text = pageText();
    const limit = text.indexOf(
      "A plan of kept moves is scored by the same measure the places are found with, so it shows what the measure rewards; whether it suits the real festival is the programmer's call.",
    );
    expect(limit).toBeGreaterThan(text.indexOf("The Hidden label on the timetable uses a stricter line"));
    expect(limit).toBeLessThan(text.indexOf("Moving sets"));
  });

  it("describes the one-page brief after the live re-check, with no figure and no festival offer", () => {
    const text = pageText();
    const start = text.indexOf("The one-page brief");
    expect(start).toBeGreaterThan(text.indexOf("The live re-check"));
    const section = text.slice(start, text.indexOf("Back to the timetable"));
    expect(section).toContain(
      "The brief page prints this day's costliest clashes, the day's Clash Budget Index and any moves you kept, using only figures the timetable page already shows.",
    );
    // It agrees with the home page's pilot offer (round 32): a walk through a published day's brief, with the same limits.
    expect(section).toContain(
      "It is for evaluating this entry. The pilot on the home page walks a programmer through a published day's brief, with the same limits: no Qloo tags or identifiers, and not for redistribution.",
    );
    expect(section).not.toContain("it is not offered to festivals");
    expect(section.match(/\d/g)).toBeNull();
  });

  it("opens with five short-version rows (popularity's result and the moves check one each), the last saying what the measure is", () => {
    const html = renderToStaticMarkup(createElement(MethodPage));
    const box = html.match(/<section aria-labelledby="short-heading"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(box.match(/<li/g)).toHaveLength(5);
    const text = pageText();
    expect(text).toContain(
      "It ranks a day's clashes and tests moves against timetable rules. Taste overlap is a rank, not attendance.",
    );
    // Round 32 (D7): the popularity result is said once in the short version, not repeated here.
    expect(text).not.toContain("our check did not find complained-about clashes better than popularity");
    // The failed gate still comes first.
    expect(text.indexOf("The test we set before building failed.")).toBeLessThan(text.indexOf("It ranks a day's clashes"));
  });

  it("puts the terms in plain words at their first use", () => {
    const text = pageText();
    expect(text).toContain(
      "Taste overlap put 46.8% of complained-about clashes in the 25% highest-ranked clashes among that day's pairs, 7.8 points ahead of genre tags. The bar we wrote down before building was 60% and 10 points ahead.",
    );
    expect(text).toContain("7.1 index points (one point is 1% of the average random timetable's cost)");
    expect(text).toContain(
      "AUC (0.5 means no better than chance; 1 means every listed clash ranks above every unlisted pair)",
    );
    // AUC can fall below 0.5, so the page never calls 0.5 its floor.
    expect(text).not.toMatch(/from 0\.5/);
    // Each term's plain words come before (or with) its first bare use. The one exception is the short version's line
    // on what the same test showed (round 31), which states the AUC figures right under the failed test; outside it,
    // AUC's first use carries its plain words.
    const held = text.indexOf("In the same test, taste overlap ranked");
    expect(held).toBeGreaterThan(-1);
    const afterHeld = text.slice(text.indexOf("Taste overlap is nearly unrelated to popularity (correlation", held));
    expect(afterHeld.indexOf("AUC")).toBe(afterHeld.indexOf("AUC (0.5 means"));
    expect(text.slice(0, held)).not.toContain("AUC");
    expect(text.indexOf("25% highest-ranked")).toBeLessThan(text.indexOf("top quarter"));
    expect(text).not.toMatch(/pre-set bar|re-ordering|top quartile/i);
  });

  it("states that the saved pairs checked read the same both ways, with the symmetry figures", () => {
    const text = pageText();
    expect(text).toContain(
      "In the 9,381 saved pairs we checked, Qloo's affinity came back the same whichever act was the signal (the 18,762 readings agree in both directions to within 0.00000007), so for those pairs the two directions make one reading. The app turns that reading into a rank within each act's row of the bill, averages the two ranks, so an act that is close to everyone does not look close to everyone, and scales the result 0 to 100.",
    );
    // A finding about the pairs checked, not a claim about every Qloo pair.
    expect(text).not.toMatch(/affinity for a pair is the same/);
    expect(text).toContain(
      "Taste overlap is an app-derived rank of how alike Qloo ranks two audiences in taste, relative to that bill. It is not a share of fans and not attendance.",
    );
    expect(text).not.toContain("both directions are turned into ranks");
    expect(text).toContain("the mean total price of 300 sampled random valid timetables of the same lineup");
  });

  it("does not promise a request id Qloo may not send", () => {
    const text = pageText();
    expect(text).toContain("Request IDs appear when Qloo supplies them.");
    expect(text).not.toContain("with Qloo's request ids");
  });

  it("uses the word that denies prediction exactly once", () => {
    expect(pageText().match(/predict/gi)).toHaveLength(1);
  });
});

describe("/method exploratory result", () => {
  /** The exploratory block as the page renders it. */
  function block(): string {
    const html = renderToStaticMarkup(createElement(MethodPage));
    return html.match(/<aside aria-labelledby="exploratory-heading"[\s\S]*?<\/aside>/)?.[0] ?? "";
  }
  const textOf = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&#39;|&rsquo;|’/g, "'")
      .replace(/\s+/g, " ")
      .trim();

  it("says what held and what did not, with the shuffle and the gap, labelled exploratory", () => {
    const text = textOf(block());
    expect(text).toContain("Exploratory follow-up, run after the test failed");
    expect(text).toContain(
      "What held, on this press-skewed complaint set: taste overlap separated the complained-about clashes from the day's other pairs (AUC 0.634, interval 0.517 to 0.755).",
    );
    expect(text).toContain(
      "we dealt the complaint labels out again at random among each festival day's pairs, keeping each day's number of complaints, 10,000 times. One of the 10,000 shuffles scored that high or higher (p = 0.0002).",
    );
    expect(text).toContain(
      "The shuffle treats pairs as independent, but the 68 pairs come from 42 complaints, so the real uncertainty is wider than that p suggests.",
    );
    expect(text).toContain(
      "What did not: popularity, also a Qloo field, scores higher (0.722). The gap between the two is 0.088 in AUC (interval -0.098 to 0.254); the interval includes zero, so these data do not say which of the two ranks complained-about clashes higher.",
    );
    // p is under its bar, so the page does not add the sentence about shuffles often doing as well
    expect(text).not.toContain("does not separate the measure from chance");
  });

  it("puts the failed pre-set test in the same block as the exploratory result", () => {
    const text = textOf(block());
    expect(text).toContain(
      "The test we set before building failed: taste overlap reached 46.8% against a bar of 60%.",
    );
    expect(text.indexOf("failed")).toBeLessThan(text.indexOf("What held"));
    expect(text).toContain("so it is exploratory");
  });

  it("puts the exploratory answer in the short version's popularity row, with the failed test above it and a link to the full comparison", () => {
    const html = renderToStaticMarkup(createElement(MethodPage));
    const box = html.match(/<section aria-labelledby="short-heading"[\s\S]*?<\/section>/)?.[0] ?? "";
    const text = textOf(box);
    expect(text).toContain(
      "and exploratory follow-ups on the same data did not establish an advantage over popularity for the app's full price. See the full comparison below .",
    );
    expect(box).toMatch(/<a href="#tested"[^>]*>See the full comparison below<\/a>/);
    expect(text.indexOf("The test we set before building failed.")).toBeLessThan(
      text.indexOf("exploratory follow-ups on the same data"),
    );
    // The test section below holds the full table; here AUC appears only in the line on what the same test showed,
    // directly after the failed test (round 31).
    const held = text.indexOf("In the same test, taste overlap ranked");
    expect(held).toBeGreaterThan(text.indexOf("The test we set before building failed."));
    expect(text.slice(0, held)).not.toContain("AUC");
    expect(text.slice(text.indexOf("(correlation", held))).not.toContain("AUC");
  });

  it("uses none of the words the page must not use about this result", () => {
    const text = pageText();
    expect(text).not.toMatch(/significan|validat|bprovenb|outperform|beats popularity|optimi[sz]|improve|recommend/i);
    expect(text.match(/predict/gi)).toHaveLength(1);
    expect(textOf(block())).not.toMatch(/confirm|demonstrat|proves|works/i);
  });

  it("lists the sources collapsed, under the 45 clashes, with one safe link per page", () => {
    const html = renderToStaticMarkup(createElement(MethodPage));
    const details = [...html.matchAll(/<details[\s\S]*?<\/details>/g)].map((m) => m[0]).find((d) => d.includes("Sources for the")) ?? "";
    expect(details).not.toMatch(/<details[^>]*\sopen/);
    expect(textOf(details)).toContain("Sources for the 45 clashes");
    expect(textOf(details)).toContain(
      "45 clashes that fans or the press complained about at five festivals had a verified overlap in time: 86 pairs of acts, overlapping for a median of 50 minutes (from 10 to 90). They come from ten public pages; one page can name several clashes.",
    );
    const links = [...details.matchAll(/<a [^>]*href="([^"]+)"[^>]*>/g)];
    expect(links.map((match) => match[1])).toEqual([...PUBLIC_SOURCES]);
    for (const [tag] of links) expect(tag).toContain('rel="noopener noreferrer"');
    // The four forum threads read apart by festival, in the list's order.
    const labels = [...details.matchAll(/<a [^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(labels.filter((label) => label.includes("Reddit"))).toEqual([
      "Coachella 2026 - Reddit discussion",
      "Lollapalooza 2026 - Reddit discussion 1",
      "Lollapalooza 2026 - Reddit discussion 2",
      "Lollapalooza 2026 - Reddit discussion 3",
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps the score mechanics in a closed disclosure, with the equation and the plain definition visible", () => {
    const html = renderToStaticMarkup(createElement(MethodPage));
    const section = html.match(/<section id="price"[\s\S]*?<\/section>/)?.[0] ?? "";
    const details = section.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(details).not.toMatch(/<details[^>]*\sopen/);
    expect(textOf(details)).toContain("How the score is calculated");
    expect(textOf(details)).toContain("the square root of their product");
    expect(textOf(details)).toContain("Lower is better.");
    const visible = textOf(section.replace(details, ""));
    expect(visible).toContain("Price = taste overlap × share of the shorter set played at once × combined draw × rarity factor.");
    expect(visible).toContain("It is not a share of fans and not attendance.");
  });
});
