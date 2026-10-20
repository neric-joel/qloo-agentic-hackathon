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
 * - Symmetry of Qloo's affinity: the printout of a read-only script in the entry's private backtest folder
 *   (not in this repository), run over the saved backtest responses (no request sent).
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
    /**
     * Complained-about pairs with a set on a minor stage the test leaves out (Outside Lands, Friday:
     * Romy's DJ set on Dolores). 68 + 16 + 2 = the 86 verified pairs.
     */
    outOfScopePairs: 2,
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
  /**
   * The complained-about clashes the backtest draws on, re-derived from the saved complaint set: clusters (one
   * per press or forum item; a clash of three acts counts once) with a verified overlap in time, the pairs of
   * acts inside them, and how long those pairs overlapped. 48 clusters were collected; one was a false clash and
   * two had no overlap in time as published. The sources are listed in `public-sources.ts`.
   */
  complaints: {
    festivals: 5,
    clustersVerified: 45,
    pairsVerified: 86,
    medianMinutes: 50,
    rangeMinutes: [10, 90],
  },
  /**
   * The exploratory follow-up to the failed pre-set test, from a permutation script in the entry's private
   * backtest folder (not in this repository; saved data only, no request sent). Run after the gate failed.
   *
   * Label shuffle: within each festival day the complaint labels are dealt out again at random among that
   * day's scored pairs (each day keeps its number of complained-about pairs) and taste overlap's pooled AUC is
   * recomputed, `shuffles` times. `shufflesAtLeast` of them scored at least the observed AUC; the one-sided p is
   * (that count + 1) / (shuffles + 1). The shuffle treats pairs as independent although the 68 scored pairs
   * come from 42 complaints, so it understates the uncertainty; the page says so.
   *
   * Gap: popularity's AUC minus taste overlap's (0.722 - 0.634, from the unrounded 0.722163 and 0.633974), with
   * a 95% interval from resampling whole festival days, the same resample for both measures.
   */
  exploratory: {
    shuffles: 10000,
    shufflesAtLeast: 1,
    p: 0.0002,
    /** A p above this means shuffled labels often score as high: the page then says so. */
    pBar: 0.05,
    gap: 0.088,
    gapInterval: [-0.098, 0.254],
  },
  /**
   * Taste inside the full price: a second exploratory follow-up on the same 68 scored pairs, from scripts in the
   * entry's private backtest folder (not in this repository; saved data only, no request sent), run after the gate
   * failed. Every AUC is pooled over the festival days with the same within-day ranks as the table above; every
   * interval is 95%.
   *
   * - fullPrice: the price this app uses (taste overlap x share of the shorter set shared x combined draw x rarity
   *   factor, which is 1 here), interval by resampling whole festival days.
   * - pairedVsPopularity: full price minus popularity, same resample for both.
   * - shuffled: the full price with taste overlap dealt out at random among each day's pairs, `shuffles` times: the
   *   mean and the middle 95% of the shuffles (a range of shuffles, not an interval).
   * - tasteRemoved: the same price with taste overlap held the same for every pair, so only shared time and draw
   *   are left.
   * - pairedVsTasteRemoved: full price minus the taste-removed price, resampled by festival day.
   * - festivals: AUCs by festival, Glastonbury against the four US festivals pooled; Riot Fest (one of the four)
   *   has too few complaints to read alone, so the page prints its counts only.
   * - glastonburyTasteAdds / usTasteAdds: full price minus taste-removed price at Glastonbury (resampled by
   *   complaint, since it has three days) and over the four US festivals (resampled by festival day).
   * - locationRequests: what re-asking the US festival days' audience rankings with each festival's city would
   *   cost (one request per usable act per day; nothing was sent).
   */
  tasteInPrice: {
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
    /**
     * Where the two rankings disagree, in aggregate only (the pair-level table stays in the private folder):
     * complained-about pairs that taste overlap puts in their day's top quarter (within-day percentile 0.75 or more)
     * while popularity puts them in the bottom half (under 0.5), out of the scored pairs, the complaint clusters
     * they come from, and how many of them are also in the top quarter on time and draw (the taste-removed price).
     */
    tasteOverPopularity: { pairs: 4, ofPairs: 68, clusters: 2, alsoTopOnTimeAndDraw: 4 },
  },
  /**
   * A replication test that has not been run: held-out bills that do not exist yet (`billsYear`, the same
   * festivals), scored before any complaint is collected, with the paired difference (full price minus the
   * taste-removed price) counted a success only if its interval lies above `successAbove`.
   */
  replication: { billsYear: 2027, successAbove: 0 },
  coverage: {
    /** Acts across the five festivals tested with a usable Qloo signal (strong or weak). */
    usableActs: 449,
    totalActs: 624,
    usablePct: 72,
    days: COVERAGE_DAYS,
  },
  price: {
    /** The rarity factor of a pair is rarityFloor plus the mean of the two acts' rarity. */
    rarityFloor: 0.5,
    /** Rarity every act carries on the two saved days (the neutral value). */
    neutralRarity: 0.5,
    /** rarityFloor + neutralRarity: the factor of every pair on the saved days. */
    neutralFactor: 1,
    /** The price's factors are multiplied on this scale; the page shows taste overlap and draw out of 100. */
    scaleFactor: [0, 1],
    /**
     * The stand-in draw an act with no popularity takes, by billing tier (`DRAW_PRIOR` in
     * `backend/app/schedule/metrics.py`): tier 1 is the headliner.
     */
    drawPrior: { 1: 0.9, 2: 0.7, 3: 0.5, 4: 0.3 },
  },
  index: {
    /** Random valid timetables the Clash Budget Index is measured against. */
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
  /**
   * Qloo's artist-to-artist affinity read in both directions, over every saved backtest answer whose
   * reverse is also saved: affinity(A for B's audience) against affinity(B for A's audience).
   */
  symmetry: {
    /** Directed readings whose reverse reading is also saved. */
    readings: 18762,
    /** Unordered pairs behind those readings. */
    pairs: 9381,
    /** Largest difference between a reading and its reverse, as the script printed it. */
    maxDifference: 6.06e-8,
    /** Readings whose difference from the reverse exceeds 1e-5. */
    readingsAbove: 0,
  },
  /** Definitions rather than measurements, kept here so the page prints no stray number. */
  scale: {
    /** Taste overlap is scaled from 0 to 100. */
    overlap: [0, 100],
    /** The Clash Budget Index is 100 times the day's price over the baseline average. */
    indexMultiplier: 100,
    /** One index point is this percent of the average random timetable's cost. */
    indexPointPct: 1,
    /** Width of the AUC intervals. */
    intervalPct: 95,
    /** "Top quarter": the 25% highest-ranked clashes among a day's pairs. */
    topQuarterPct: 25,
    /** AUC reference points: 0.5 is no better than chance; 1 ranks every listed clash above every unlisted pair. */
    auc: { chance: 0.5, perfect: 1 },
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

/** "0.0002": a one-sided p-value with four decimals, as the script printed it. */
export function formatP(value: number): string {
  return value.toFixed(4);
}

/** What the exploratory figures say, read from the figures so the page can never contradict them. */
export function exploratoryReading(
  figures: {
    readonly p: number;
    readonly pBar: number;
    readonly gapInterval: readonly [number, number];
  } = METHOD_FIGURES.exploratory,
) {
  const [low, high] = figures.gapInterval;
  return {
    /** A shuffle of the complaint labels scores this high often enough that p is above the stated bar. */
    pAboveBar: figures.p > figures.pBar,
    /** The interval of popularity's AUC minus taste overlap's holds zero. */
    gapIncludesZero: low <= 0 && 0 <= high,
  };
}

/** "+0.024", "-0.009": a paired difference in AUC, always signed. */
export function formatDiff(value: number): string {
  return `${value < 0 ? "-" : "+"}${formatAuc(Math.abs(value))}`;
}

/** "-0.074 to +0.136": the interval of a paired difference, each end signed. */
export function formatDiffInterval([low, high]: readonly [number, number]): string {
  return `${formatDiff(low)} to ${formatDiff(high)}`;
}

/**
 * What the taste-inside-the-price figures say, read from the figures so the page can never contradict them: whether
 * the interval of the full price minus the taste-removed price holds zero (then the check did not establish that
 * taste adds to time and draw), and the same for the full price minus popularity.
 */
export function tasteInPriceReading(
  figures: {
    readonly pairedVsTasteRemoved: { readonly interval: readonly [number, number] };
    readonly pairedVsPopularity: { readonly interval: readonly [number, number] };
  } = METHOD_FIGURES.tasteInPrice,
) {
  const holdsZero = ([low, high]: readonly [number, number]) => low <= 0 && 0 <= high;
  return {
    tasteAddsIncludesZero: holdsZero(figures.pairedVsTasteRemoved.interval),
    tasteAddsAboveZero: figures.pairedVsTasteRemoved.interval[0] > 0,
    popularityIncludesZero: holdsZero(figures.pairedVsPopularity.interval),
  };
}

/**
 * Where taste overlap and popularity disagree on the complained-about clashes, aggregate only, with the clause
 * that all of them are also high on time and draw in the same sentence: "Complained-about clashes that taste
 * overlap put in their day's top quarter while popularity put them in the bottom half: 4 of 68, from 2 complaint
 * clusters; all 4 were also in the top quarter on time and draw."
 */
export function disagreementSentence(
  figures: {
    readonly pairs: number;
    readonly ofPairs: number;
    readonly clusters: number;
    readonly alsoTopOnTimeAndDraw: number;
  } = METHOD_FIGURES.tasteInPrice.tasteOverPopularity,
): string {
  const { pairs, ofPairs, clusters, alsoTopOnTimeAndDraw } = figures;
  const also =
    alsoTopOnTimeAndDraw === pairs
      ? `all ${pairs} were also in the top quarter on time and draw`
      : `${alsoTopOnTimeAndDraw} of the ${pairs} were also in the top quarter on time and draw`;
  return `Complained-about clashes that taste overlap put in their day’s top quarter while popularity put them in the bottom half: ${pairs} of ${ofPairs}, from ${clusters} complaint ${clusters === 1 ? "cluster" : "clusters"}; ${also}.`;
}

/** "18,762": a count with thousands separators. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * A tiny positive difference as a plain decimal bound, rounded up at its first significant digit, so
 * "within" it stays true: 6.06e-8 -> "0.00000007". Zero prints "0".
 */
export function formatWithin(value: number): string {
  if (!(value > 0)) return "0";
  let exponent = Math.floor(Math.log10(value));
  // toPrecision guards against float error in the division (6e-8 / 1e-8 is 5.999...).
  let digit = Math.ceil(Number((value / 10 ** exponent).toPrecision(12)));
  if (digit >= 10) {
    digit = 1;
    exponent += 1;
  }
  const places = Math.max(0, -exponent);
  return exponent < 0 ? (digit / 10 ** places).toFixed(places) : String(digit * 10 ** exponent);
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

/**
 * The cluster clause that goes next to the shuffle p: the shuffle treats pairs as independent, but
 * the scored pairs come from fewer complaints, so p understates the uncertainty.
 * "the 68 pairs come from 42 complaints, so this p understates the uncertainty".
 */
export function clusterClause(
  figures: { readonly scoredPairs: number; readonly clusters: number } = METHOD_FIGURES.backtest,
): string {
  return `the ${figures.scoredPairs} pairs come from ${figures.clusters} complaints, so this p understates the uncertainty`;
}

/**
 * Why two sets of counts appear on the site: the public set's verified overlaps against the scored
 * pairs the AUC uses. "The 45 complaints and 86 pairs ... are the verified overlaps in the public
 * set; the AUC scores 68 pairs from 42 complaints, the ones with a Qloo signal for both acts; 16 more
 * have no Qloo signal for one act, and 2 involve a set on a minor stage the test leaves out."
 */
export function countsNote(
  figures: {
    readonly verified: { readonly clustersVerified: number; readonly pairsVerified: number };
    readonly scored: {
      readonly scoredPairs: number;
      readonly clusters: number;
      readonly unscoredPairs: number;
      readonly outOfScopePairs: number;
    };
  } = { verified: METHOD_FIGURES.complaints, scored: METHOD_FIGURES.backtest },
): string {
  const { clustersVerified, pairsVerified } = figures.verified;
  const { scoredPairs, clusters, unscoredPairs, outOfScopePairs } = figures.scored;
  return `The ${clustersVerified} complaints and ${pairsVerified} pairs counted elsewhere on this site are the verified overlaps in the public set; the AUC scores ${scoredPairs} pairs from ${clusters} complaints, the ones with a Qloo signal for both acts; ${unscoredPairs} more have no Qloo signal for one act, and ${outOfScopePairs} involve a set on a minor stage the test leaves out.`;
}
