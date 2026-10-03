/**
 * Every figure printed on the "How we know" page (/method), in one typed constant.
 *
 * The page prints no number that is not here, and method-figures.test.ts pins each one, so changing
 * a figure is a deliberate, reviewed edit. The values are copied from the project's backtest output
 * and its review notes; they are not recomputed at build time:
 *
 * - Complaint backtest (5 festivals, 15 festival days): the per-method summary of complained-about
 *   clashes, the pre-set bar, the methodologist's audit (Glastonbury against the US festivals, the
 *   correlation with popularity, the hidden-clash rates) and Qloo coverage of the 624 acts tested.
 * - The two festival days the app shows: coverage from each preset's report.
 * - The move-suggestion check: the second run, with realistic movement limits, which governs.
 * - The live re-check: how many requests one check sends (a definition, set by the API contract).
 */

export type MethodId = "taste" | "genre" | "popularity" | "random";

export type MethodRow = {
  readonly id: MethodId;
  /** Row label, as printed. */
  readonly method: string;
  /** Share of complained-about clusters that rank in the top quarter of their day, in percent. */
  readonly topQuarterPct: number;
  /** Area under the ROC curve. */
  readonly auc: number;
  /** 95% interval of the AUC, resampled by festival day. Random has none. */
  readonly auc95: readonly [low: number, high: number] | null;
};

export type CoverageDay = {
  readonly day: string;
  readonly scored: number;
  readonly total: number;
  /** `scored / total` as a whole percent. */
  readonly pct: number;
};

/** The backtest table, in the order printed. The first row is the measure this app uses. */
const BACKTEST_ROWS: readonly MethodRow[] = [
  {
    id: "taste",
    method: "Taste overlap (rank on the bill)",
    topQuarterPct: 46.8,
    auc: 0.634,
    auc95: [0.517, 0.755],
  },
  {
    id: "genre",
    method: "Genre-tag overlap",
    topQuarterPct: 39.0,
    auc: 0.512,
    auc95: [0.414, 0.622],
  },
  {
    id: "popularity",
    method: "Popularity (the lower of the two acts)",
    topQuarterPct: 57.8,
    auc: 0.722,
    auc95: [0.631, 0.801],
  },
  { id: "random", method: "Random", topQuarterPct: 26.3, auc: 0.5, auc95: null },
];

const COVERAGE_DAYS: readonly CoverageDay[] = [
  { day: "Glastonbury 2025, Sunday", scored: 36, total: 39, pct: 92 },
  { day: "Riot Fest 2026, Sunday", scored: 31, total: 34, pct: 91 },
];

export const METHOD_FIGURES = {
  backtest: {
    festivals: 5,
    usFestivals: 4,
    festivalDays: 15,
    /** Complained-about pairs with a Qloo signal for both acts. */
    scoredPairs: 68,
    /**
     * Complaints (clusters) the scored pairs come from: one source each, and one complaint can name
     * a group of acts. 45 complaints in all; 42 have at least one scored pair.
     */
    clusters: 42,
    /** Complained-about pairs left unscored because Qloo has no signal for one of the acts. */
    unscoredPairs: 16,
    rows: BACKTEST_ROWS,
    /** The bar, set before the test ran. */
    bar: { topQuarterPct: 60, leadOverGenrePoints: 10 },
    /** Taste overlap's lead over genre tags: 46.8 - 39.0. */
    leadOverGenrePoints: 7.8,
    /** Correlation of taste overlap with popularity across all concurrent pairs. */
    popularityCorrelation: 0.08,
    glastonbury: {
      label: "Glastonbury 2025",
      source: "NME",
      namedClashes: 8,
      inTopQuarter: 7,
      auc: 0.94,
    },
    /** AUC over the four US festivals together. */
    usFestivalsAuc: 0.55,
    hidden: {
      /** Pairs with top-quarter taste overlap and no shared genre tag. */
      pairs: 185,
      complained: 15,
      /** `complained / pairs`, in percent. */
      complainedPct: 8.1,
      /** Complained-about share of all concurrent pairs, in percent. */
      basePct: 5.0,
    },
  },
  coverage: {
    /** Acts across the five festivals tested with a usable Qloo signal (strong or weak). */
    usableActs: 449,
    totalActs: 624,
    usablePct: 72,
    days: COVERAGE_DAYS,
  },
  index: {
    /** Random valid re-orderings the Clash Budget Index is measured against. */
    baselineSamples: 300,
  },
  moves: {
    /** Index points the taste-overlap suggestions had to differ from popularity-only ones by. */
    barPoints: 10,
    measuredPoints: 7.1,
    movesDiffer: 7,
    movesCompared: 8,
  },
  liveCheck: {
    /** Requests one live re-check sends to Qloo: an audience ranking for each act and one comparison. */
    requests: 3,
  },
  /** Definitions rather than measurements, kept here so the page prints no stray number. */
  scale: {
    /** Taste overlap is scaled from 0 to 100. */
    overlap: [0, 100],
    /** The Clash Budget Index is 100 times the day's price over the baseline average. */
    indexMultiplier: 100,
    /** Width of the AUC intervals. */
    intervalPct: 95,
  },
} as const;

/** One row of the backtest table. */
export function methodRow(id: MethodId): MethodRow {
  const row = METHOD_FIGURES.backtest.rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`No backtest row "${id}".`);
  return row;
}

/** "46.8%", "5.0%": a percentage with one decimal, as measured. */
export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** "72%": a whole percentage, for coverage. */
export function formatWholePct(value: number): string {
  return `${Math.round(value)}%`;
}

/** "0.634", "0.500": an AUC with three decimals, as reported. */
export function formatAuc(value: number): string {
  return value.toFixed(3);
}

/** "0.517 to 0.755". */
export function formatInterval([low, high]: readonly [number, number]): string {
  return `${formatAuc(low)} to ${formatAuc(high)}`;
}

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
] as const;

/** "five", "Sixteen": small whole numbers spelled out, as prose does at the start of a sentence. */
export function numberWord(value: number, { capitalize = false } = {}): string {
  const word = Number.isInteger(value) ? WORDS[value] : undefined;
  if (word === undefined) return String(value);
  return capitalize ? word[0].toUpperCase() + word.slice(1) : word;
}
