import { pairKey } from "@/lib/clashes";
import type { Lenses } from "@/lib/lenses";
import type { Act, PairClash, Preset, Twin } from "@/lib/preset";
import { cn } from "@/lib/utils";

import { MoreDetails } from "./more-details";
import { TasteLens } from "./taste-lens";
import { TwinCards } from "./twin-cards";
import { FailedTestNote } from "./why-this-matters";

/** What a reading prints when the page has no figure for it. */
export const NOT_AVAILABLE = "not available";

export const READINGS_CAPTION =
  "Same timetable, ranked three ways. This shows what taste changes; it does not prove the taste ranking is better.";

export const READINGS_CAPTION_SYNTHETIC = "On this invented day the draw and taste figures are made up.";

/**
 * A rank in one reading. A number is the pair's place (`of` is how many pairs that reading ranks, when
 * known); null means the reading ranks the pair nowhere (it costs nothing there); undefined means the
 * page has no figure for it (the lens data did not load, or does not list the pair).
 */
export type ReadingRank = { rank: number; of?: number; tied?: number } | null | undefined;

/** Two sets of the day that share time, with how many minutes. */
export type SharedPair = { aId: string; bId: string; minutes: number };

/**
 * Every pair of the day's sets that share time, leaving out acts the report could not price: the
 * same pairs the lens rankings rank (their count is the lens's "of N"). Read from the timetable, not
 * from the report's clash list, which holds only the costliest pairs.
 */
export function concurrentPairs(preset: Pick<Preset, "festival" | "report">, day: number): SharedPair[] {
  const unpriced = new Set(preset.report.coverage.unscored.map((act) => act.act_id));
  const slots = preset.festival.timetable.filter((slot) => slot.day === day && !unpriced.has(slot.act_id));
  const pairs: SharedPair[] = [];
  for (let i = 0; i < slots.length; i += 1) {
    for (let k = i + 1; k < slots.length; k += 1) {
      const minutes = Math.min(slots[i].end, slots[k].end) - Math.max(slots[i].start, slots[k].start);
      if (minutes > 0) pairs.push({ aId: slots[i].act_id, bId: slots[k].act_id, minutes });
    }
  }
  return pairs;
}

export type ThreeReadings = {
  /** Minutes shared alone, among the day's concurrent priced pairs; ties share a place. */
  time: ReadingRank;
  /** Draw and time shared: the lens block's ranking without taste overlap. */
  draw: ReadingRank;
  /** Draw, time and taste overlap: the price this page uses, as the lens block ranks it. */
  taste: ReadingRank;
};

function samePair(aId: string, bId: string, x: string, y: string): boolean {
  return pairKey(aId, bId) === pairKey(x, y) || pairKey(aId, bId) === pairKey(y, x);
}

function lensRank(rank: number | null, of: number | undefined): ReadingRank {
  return rank === null ? null : { rank, of };
}

/**
 * The pair's place in three rankings of the same timetable. The two with draw come from the lens data
 * the "What taste overlap changes" block prints, read from the same entry, so the two never disagree;
 * the one on minutes alone is counted from the day's concurrent priced pairs. Nothing is estimated:
 * a reading the data does not hold is undefined.
 */
export function threeReadings(
  lenses: Lenses | null,
  pairs: readonly SharedPair[],
  aId: string,
  bId: string,
): ThreeReadings {
  const pair = pairs.find((item) => samePair(aId, bId, item.aId, item.bId));
  const time: ReadingRank = pair
    ? {
        rank: 1 + pairs.filter((item) => item.minutes > pair.minutes).length,
        of: pairs.length,
        tied: pairs.filter((item) => item !== pair && item.minutes === pair.minutes).length,
      }
    : undefined;
  if (!lenses) return { time, draw: undefined, taste: undefined };
  const withOf = lenses.priced_with_taste;
  const withoutOf = lenses.priced_without_taste;
  const inWith = lenses.with_taste.find((entry) => samePair(aId, bId, entry.a_id, entry.b_id));
  if (inWith) {
    return { time, taste: { rank: inWith.rank, of: withOf }, draw: lensRank(inWith.rank_without_taste, withoutOf) };
  }
  const inWithout = lenses.without_taste.find((entry) => samePair(aId, bId, entry.a_id, entry.b_id));
  if (inWithout) {
    return { time, draw: { rank: inWithout.rank, of: withoutOf }, taste: lensRank(inWithout.rank_with_taste, withOf) };
  }
  return { time, draw: undefined, taste: undefined };
}

/** "#1 of 45", "#3 of 45, tied with 2 others", "not ranked", "not available". */
export function readingText(reading: ReadingRank): string {
  if (reading === undefined) return NOT_AVAILABLE;
  if (reading === null) return "not ranked";
  const place = reading.of !== undefined && reading.of >= reading.rank ? `#${reading.rank} of ${reading.of}` : `#${reading.rank}`;
  if (!reading.tied) return place;
  return `${place}, tied with ${reading.tied === 1 ? "1 other" : `${reading.tied} others`}`;
}

/** What "draw" is, the first time the card says it: Qloo popularity, or invented popularity on the invented day. */
export function drawGloss(synthetic: boolean): string {
  return synthetic ? "invented popularity" : "Qloo popularity";
}

/**
 * What taste overlap does to this pair's place, on the rank axis: minutes alone (when the readings
 * hold it), time and draw, then with taste. When taste leaves the place as it is, that is the finding:
 * "Taste agrees with time and draw: #N either way." With `gloss`, "draw" is glossed where it first
 * appears: "draw (Qloo popularity)".
 */
export function tasteVerdict(
  readings: Pick<ThreeReadings, "draw" | "taste"> & Partial<Pick<ThreeReadings, "time">>,
  gloss: string | null = null,
): string {
  const { draw, taste, time } = readings;
  if (!draw || !taste) return `What taste changes for this pair: ${NOT_AVAILABLE}.`;
  const drawWord = gloss ? `draw (${gloss})` : "draw";
  if (draw.rank === taste.rank) return `Taste agrees with time and ${drawWord}: #${taste.rank} either way.`;
  if (time) return `Time alone ranks this pair #${time.rank}, time and ${drawWord} #${draw.rank}, with taste #${taste.rank}.`;
  return `Time and ${drawWord} rank this pair #${draw.rank}, with taste #${taste.rank}.`;
}

/** The pair whose place taste changes most in the day's two lens rankings, with its two places. */
export type TasteMover = { a: string; b: string; from: number; to: number };

/**
 * The pair taste overlap moves furthest among the pairs the two lens lists hold: its place on time
 * and draw (`from`) and with taste (`to`), both read from the lens data, never computed. A pair one
 * list leaves unranked is skipped. Ties go to the pair placed higher with taste. Null when no listed
 * pair changes place.
 */
export function biggestTasteMover(lenses: Pick<Lenses, "with_taste" | "without_taste">): TasteMover | null {
  const seen = new Map<string, TasteMover>();
  const key = (aId: string, bId: string) => [aId, bId].sort().join("|");
  for (const entry of lenses.with_taste) {
    if (entry.rank_without_taste === null) continue;
    seen.set(key(entry.a_id, entry.b_id), { a: entry.a, b: entry.b, from: entry.rank_without_taste, to: entry.rank });
  }
  for (const entry of lenses.without_taste) {
    if (entry.rank_with_taste === null) continue;
    const at = key(entry.a_id, entry.b_id);
    if (!seen.has(at)) seen.set(at, { a: entry.a, b: entry.b, from: entry.rank, to: entry.rank_with_taste });
  }
  let best: TasteMover | null = null;
  for (const mover of seen.values()) {
    const size = Math.abs(mover.from - mover.to);
    if (size === 0) continue;
    const bestSize = best ? Math.abs(best.from - best.to) : 0;
    if (!best || size > bestSize || (size === bestSize && mover.to < best.to)) best = mover;
  }
  return best;
}

/** "In this day’s two rankings, taste moves A × B the most: from #9 to #2." */
export function moverLine(mover: TasteMover): string {
  return `In this day’s two rankings, taste moves ${mover.a} × ${mover.b} the most: from #${mover.from} to #${mover.to}.`;
}

/** The anchor of the "What Qloo changes" block, for the card's pointer and the jump links. */
export const WHAT_QLOO_ID = "what-qloo-changes";

/** The block's claim when taste moves the pair, and its limit in the same breath. */
export const QLOO_CHANGES_LINE =
  "Qloo changes which clash rises to the top. It does not prove #1 is the right clash to move.";
/** The same on the invented day, where no Qloo figure was used. */
export const TASTE_CHANGES_LINE_SYNTHETIC =
  "Taste changes which clash rises to the top. It does not prove #1 is the right clash to move.";

/** "What Qloo changes", or the invented day's honest name for it. */
export function whatChangesTitle(synthetic: boolean): string {
  return synthetic ? "What taste changes" : "What Qloo changes";
}

/** The block's bold line: what taste does to this pair's place, never more than the ranks show. */
export function changesLine(readings: Pick<ThreeReadings, "draw" | "taste">, synthetic = false): string {
  const { draw, taste } = readings;
  if (!draw || !taste) return tasteVerdict(readings);
  if (draw.rank === taste.rank) return tasteVerdict(readings);
  return synthetic ? TASTE_CHANGES_LINE_SYNTHETIC : QLOO_CHANGES_LINE;
}

/** A reading the figure can place: a rank with its own count, on a scale of two places or more. */
type PlacedReading = { rank: number; of: number; tied?: number };

function placed(reading: ReadingRank): reading is PlacedReading {
  return !!reading && reading.of !== undefined && reading.of >= reading.rank && reading.of >= 2;
}

/**
 * The figure's one shared axis: the largest "of" among the readings it can place, or null when none
 * can be placed (or the largest ranks fewer than two), and then no axis is drawn.
 */
export function figureScale(readings: readonly ReadingRank[]): number | null {
  const counts = readings.filter(placed).map((reading) => reading.of);
  if (counts.length === 0) return null;
  const maxOf = Math.max(...counts);
  return maxOf >= 2 ? maxOf : null;
}

/** Where place `rank` sits on the shared axis, from 0 (#1, the left end) to 1 (#maxOf, the right end). */
export function rankX(rank: number, maxOf: number): number {
  return (rank - 1) / (maxOf - 1);
}

/** "tied with 1 other", "tied with 3 others", or "" with no tie. */
function tieText(tied: number | undefined): string {
  return tied ? `tied with ${tied === 1 ? "1 other" : `${tied} others`}` : "";
}

/** The share of the track a place's label needs beside its marker before it flips to the other side. */
const LABEL_ROOM = 0.3;

/**
 * One reading on the shared axis: its place set in the 1.75rem numeral with "of N" (its own count) and
 * any tie under it, beside the marker and above the 2px border-strong axis line. The ink dot sits on a
 * 2px card halo; the price used here has the larger dot. The axis has 8px ticks at #1 and at #maxOf,
 * and one more at the reading's own last place when it ranks fewer pairs than the longest reading.
 * The label sits right of the marker, or left of it once the marker is past 70% of the track (or of the
 * reading's own shorter track), so it never runs over the track's ends.
 */
function RankPlace({ reading, maxOf, price }: { reading: PlacedReading; maxOf: number; price: boolean }) {
  const at = rankX(reading.rank, maxOf);
  const end = rankX(reading.of, maxOf);
  const flip = end - at < LABEL_ROOM && at > end - at;
  const room = (flip ? at : 1 - at) * 100;
  const tie = tieText(reading.tied);
  const pos = `${at * 100}%`;
  const offset = price ? "14px" : "12px";
  return (
    <div className="min-w-0 px-2" data-at={at} data-flip={flip ? "" : undefined}>
      <div
        className={cn("flex w-max flex-col", flip ? "ml-auto items-end text-right" : "items-start")}
        style={{
          [flip ? "marginRight" : "marginLeft"]: `calc(${flip ? `${100 - at * 100}%` : pos} + ${offset})`,
          maxWidth: `calc(${room}% - ${offset})`,
        }}
      >
        <p className="flex items-baseline gap-x-1.5 whitespace-nowrap">
          <span className="type-numeral text-[1.75rem] leading-none">#{reading.rank}</span>{" "}
          <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">of {reading.of}</span>
        </p>
        {tie ? <p className="mt-0.5 font-mono text-[0.8125rem] leading-5 text-muted-foreground">{tie}</p> : null}
      </div>
      <div aria-hidden="true" data-axis="" className="relative mt-2 h-2">
        <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-border-strong" />
        <span data-tick="first" className="absolute top-0 left-0 h-2 w-px bg-border-strong" />
        <span data-tick="last" className="absolute top-0 right-0 h-2 w-px bg-border-strong" />
        {reading.of < maxOf ? (
          <span
            data-tick="own"
            className="absolute top-0 h-2 w-px -translate-x-1/2 bg-border-strong"
            style={{ left: `${end * 100}%` }}
          />
        ) : null}
        <span
          data-marker=""
          className={cn(
            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground",
            price ? "size-4" : "size-3",
          )}
          style={{ left: pos }}
        />
      </div>
    </div>
  );
}

/** A reading printed as text, where the figure draws no axis: its place large, "of N" and any tie. */
function ReadingValue({ reading }: { reading: ReadingRank }) {
  if (reading === undefined || reading === null) {
    return <p className="font-mono text-sm font-semibold">{readingText(reading)}</p>;
  }
  const of = reading.of !== undefined && reading.of >= reading.rank ? reading.of : null;
  const tie = tieText(reading.tied);
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="type-numeral text-[1.75rem] leading-none">#{reading.rank}</span>{" "}
        {of !== null ? <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">of {of}</span> : null}
      </p>
      {tie ? <p className="mt-0.5 font-mono text-[0.8125rem] leading-5 text-muted-foreground">{tie}</p> : null}
    </div>
  );
}

/**
 * The three readings as one comparative figure: three rows on one shared rank axis, #1 at the left,
 * every row placed by the same `rankX`. Each row keeps its own "of N"; there is no card per row, and
 * the price used here (the last row) differs only by its semibold label and its larger dot, never a
 * border, a fill or vermilion, because it is not a cost. Rows are divided by 1px hairlines. Under the
 * rows, one axis caption built from the readings. A reading with no figure keeps its text and no marker;
 * with no placeable reading there is no axis and the rows print as text.
 */
function ReadingsFigure({ steps }: { steps: readonly TriptychStep[] }) {
  const maxOf = figureScale(steps.map((step) => step.reading));
  return (
    <div data-rank-figure="">
      <ol className="divide-y divide-border">
        {steps.map((step, i) => {
          const price = i === steps.length - 1;
          return (
            <li
              key={step.key}
              data-reading={step.key}
              className="grid gap-y-3 py-4 first:pt-0 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-end sm:gap-x-6"
            >
              <div className="min-w-0">
                <p className={cn("text-sm leading-5", price ? "font-semibold" : "font-normal")}>{step.label}</p>
                <p className="text-[0.8125rem] leading-snug text-muted-foreground">{step.gloss}</p>
              </div>
              {maxOf !== null && placed(step.reading) ? (
                <RankPlace reading={step.reading} maxOf={maxOf} price={price} />
              ) : (
                <div className={cn("min-w-0", maxOf !== null && "px-2")}>
                  <ReadingValue reading={step.reading} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {maxOf !== null ? (
        <div className="sm:pl-[calc(13rem+1.5rem)]">
          <p data-axis-caption="" className="flex items-baseline gap-x-3 px-2 pt-1 text-xs text-muted-foreground">
            <span aria-hidden="true" className="shrink-0 font-mono tabular-nums">
              #1
            </span>
            <span className="min-w-0 flex-1 text-center">Place among the day’s {maxOf} clashes, #1 at the left</span>
            <span aria-hidden="true" className="shrink-0 font-mono tabular-nums">
              #{maxOf}
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

type TriptychStep = { key: keyof ThreeReadings; label: string; gloss: string; reading: ReadingRank };

/** Everything the three readings print for one clash, read once so every layout says the same. */
function triptychParts(
  lenses: Lenses | null,
  pairs: readonly SharedPair[],
  aId: string,
  bId: string,
  synthetic: boolean,
) {
  const readings = threeReadings(lenses, pairs, aId, bId);
  const pair = pairs.find((item) => samePair(aId, bId, item.aId, item.bId));
  const title = whatChangesTitle(synthetic);
  const line = changesLine(readings, synthetic);
  // The bold line already states its limit when taste moves the pair; otherwise the caption does.
  const moved = line === QLOO_CHANGES_LINE || line === TASTE_CHANGES_LINE_SYNTHETIC;
  const caption = [moved ? null : READINGS_CAPTION, synthetic ? READINGS_CAPTION_SYNTHETIC : null]
    .filter(Boolean)
    .join(" ");
  const steps: TriptychStep[] = [
    { key: "time", label: "Time only", gloss: "Minutes shared", reading: readings.time },
    {
      key: "draw",
      label: "Time + draw",
      gloss: synthetic ? "Draw is invented popularity" : "Draw is Qloo popularity, 0 to 100",
      reading: readings.draw,
    },
    {
      key: "taste",
      label: synthetic ? "Time + draw + invented taste" : "Time + draw + Qloo taste",
      gloss: "Taste overlap added: the price used here",
      reading: readings.taste,
    },
  ];
  const heading = `${pair ? `Same ${pair.minutes}-minute clash.` : "Same clash."} Same timetable.`;
  return { title, line, caption, steps, heading, readings };
}

/**
 * "What Qloo changes", its own block right after the hero: the decision's clash ranked on minutes
 * shared alone, on time and draw, and on time, draw and Qloo taste overlap (the price used here), on
 * the same timetable. Every rank is read by `threeReadings` from the lens data and the day's
 * concurrent pairs, never typed. It shows what taste changes and says in the same line that this does
 * not make the taste order right. On the invented day every figure is labelled as made up. The home
 * page composes the same readings in `TasteSection`.
 */
export function WhatQlooChanges({
  lenses,
  pairs,
  aId,
  bId,
  aName,
  bName,
  synthetic = false,
  className,
}: {
  lenses: Lenses | null;
  /** The day's concurrent priced pairs (`concurrentPairs`). */
  pairs: readonly SharedPair[];
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  synthetic?: boolean;
  className?: string;
}) {
  const { title, line, caption, steps, heading } = triptychParts(lenses, pairs, aId, bId, synthetic);
  return (
    <section
      id={WHAT_QLOO_ID}
      aria-labelledby="what-qloo-heading"
      className={cn("container-page pt-10 pb-2 sm:pt-14", className)}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-10">
        <div className="min-w-0">
          <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
            {title}
            {synthetic ? " · Invented day" : ""}
          </p>
          <h2 id="what-qloo-heading" className="type-title mt-1.5">
            {heading}
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-relaxed">
            {aName} and {bName}, the clash in the decision above, ranked against the day’s other clashes three ways.
          </p>
        </div>
        <div className="min-w-0">
          <ReadingsFigure steps={steps} />
          <p className="mt-4 font-semibold">{line}</p>
          {caption ? <p className="mt-1.5 text-[0.8125rem] leading-snug text-muted-foreground">{caption}</p> : null}
        </div>
      </div>
    </section>
  );
}

/** The decision's clash, by id and printed name, for the taste section. */
export type TasteSectionClash = { aId: string; bId: string; aName: string; bName: string };

/**
 * The taste section, right after the hero: one telling of what Qloo taste overlap changes. With the
 * decision's clash and the lens data it ranks that clash three ways (minutes alone, time and draw, the
 * price used here) with its claim and limit visible; the equal-popularity pairs and the day's two
 * rankings each sit in one closed disclosure whose summary says what is inside. The failed test closes
 * the section, always: it renders with no clash, no lens data, no twins and on the invented day, and
 * never inside a disclosure.
 */
export function TasteSection({
  clash,
  lenses,
  pairs,
  twins,
  acts,
  ranked,
  onOpen,
  synthetic = false,
}: {
  /** The decision card's clash; null while the card is loading or is for another day. */
  clash: TasteSectionClash | null;
  lenses: Lenses | null;
  /** The day's concurrent priced pairs (`concurrentPairs`). */
  pairs: readonly SharedPair[];
  twins: readonly Twin[];
  acts: readonly Act[];
  /** The day's priced concurrent clashes, costliest first: a lens row opens its drawer from here. */
  ranked: readonly PairClash[];
  onOpen: (clash: PairClash, trigger: HTMLElement | null) => void;
  synthetic?: boolean;
}) {
  const parts = clash && lenses ? triptychParts(lenses, pairs, clash.aId, clash.bId, synthetic) : null;
  // When taste leaves the card's pair where it was, the day's biggest taste mover from the same lens
  // lists shows what taste does change.
  const unchanged =
    parts !== null && !!parts.readings.draw && !!parts.readings.taste && parts.readings.draw.rank === parts.readings.taste.rank;
  const mover = unchanged && lenses ? biggestTasteMover(lenses) : null;
  return (
    <section id={WHAT_QLOO_ID} aria-labelledby="what-qloo-heading">
      <div className="container-page py-16 lg:py-20">
        {clash && parts ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-10">
            <div className="min-w-0">
              <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
                {parts.title}
                {synthetic ? " · Invented day" : ""}
              </p>
              <h2 id="what-qloo-heading" className="type-title mt-1.5">
                {parts.heading}
              </h2>
              <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed">
                {clash.aName} and {clash.bName}, the clash in the decision above, ranked three ways.
              </p>
            </div>
            <div className="min-w-0">
              {/* One figure: the three readings on one shared rank axis; on a phone each row stacks. */}
              <ReadingsFigure steps={parts.steps} />
              <p className="mt-4 max-w-prose font-semibold">{parts.line}</p>
              {parts.caption ? (
                <p className="mt-1.5 max-w-prose text-[0.8125rem] leading-snug">{parts.caption}</p>
              ) : null}
              {mover ? (
                <p data-taste-mover="" className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed">
                  {moverLine(mover)}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <h2 id="what-qloo-heading" className="type-title">
            {whatChangesTitle(synthetic)}
          </h2>
        )}

        {twins.length > 0 || lenses ? (
          <div className="mt-8 space-y-3">
            {twins.length > 0 ? (
              <MoreDetails summary={`Equal-popularity pairs (${twins.length})`}>
                <TwinCards twins={twins} acts={acts} synthetic={synthetic} embedded className="mt-4 mb-3" />
              </MoreDetails>
            ) : null}
            {lenses ? (
              <MoreDetails
                summary={
                  <span>
                    Two rankings of this day{" "}
                    <span className="font-normal text-muted-foreground">({lenses.ranked} costliest clashes)</span>
                  </span>
                }
              >
                <TasteLens
                  lenses={lenses}
                  ranked={ranked}
                  onOpen={onOpen}
                  synthetic={synthetic}
                  embedded
                  className="mt-4 mb-3"
                />
              </MoreDetails>
            ) : null}
          </div>
        ) : null}

        <FailedTestNote className="mt-12" synthetic={synthetic} />
      </div>
    </section>
  );
}

/** The card's one line about taste, pointing at the block that shows the three readings. */
export function WhatQlooPointer({
  lenses,
  pairs,
  aId,
  bId,
  synthetic = false,
}: {
  lenses: Lenses | null;
  pairs: readonly SharedPair[];
  aId: string;
  bId: string;
  synthetic?: boolean;
}) {
  const readings = threeReadings(lenses, pairs, aId, bId);
  return (
    <p className="text-sm leading-snug">
      <span className="font-semibold">{tasteVerdict(readings, drawGloss(synthetic))}</span>{" "}
      <a
        href={`#${WHAT_QLOO_ID}`}
        className="font-semibold text-foreground underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground"
      >
        See {whatChangesTitle(synthetic).replace(/^What/, "what")}
      </a>
    </p>
  );
}
