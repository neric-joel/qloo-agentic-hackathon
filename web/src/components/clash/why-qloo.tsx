import { cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from "react";

import { formatOverlap, pairKey } from "@/lib/clashes";
import type { Lenses } from "@/lib/lenses";
import type { Act, PairClash, Preset, Twin } from "@/lib/preset";
import { cn } from "@/lib/utils";

import { DecisionDetails, type DecisionDetailsProps } from "./decision-card";
import { MoreDetails } from "./more-details";
import { otherHalfLine, otherHalfPair, TasteLens } from "./taste-lens";
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
 * Every pair of the day's sets that share time, leaving out acts the report could not score: the
 * same pairs the lens rankings rank (their count is the lens's "of N"). Read from the timetable, not
 * from the report's clash list, which holds only the costliest pairs.
 */
export function concurrentPairs(preset: Pick<Preset, "festival" | "report">, day: number): SharedPair[] {
  const unscored = new Set(preset.report.coverage.unscored.map((act) => act.act_id));
  const slots = preset.festival.timetable.filter((slot) => slot.day === day && !unscored.has(slot.act_id));
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
  /** Minutes shared alone, among the day's concurrent scored pairs; ties share a place. */
  time: ReadingRank;
  /** Draw and time shared: the lens block's ranking without taste overlap. */
  draw: ReadingRank;
  /** Draw, time and taste overlap: the index this page uses, as the lens block ranks it. */
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
 * the one on minutes alone is counted from the day's concurrent scored pairs. Nothing is estimated:
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
 * hold it), time and draw, then with taste. When taste leaves the place as it is, that is the finding,
 * said of taste alone, since minutes alone may rank the pair elsewhere: "Adding taste leaves this pair
 * at #N." With `gloss`, "draw" is glossed where it first appears: "draw (Qloo popularity)".
 */
export function tasteVerdict(
  readings: Pick<ThreeReadings, "draw" | "taste"> & Partial<Pick<ThreeReadings, "time">>,
  gloss: string | null = null,
): string {
  const { draw, taste, time } = readings;
  if (!draw || !taste) return `What taste changes for this pair: ${NOT_AVAILABLE}.`;
  const drawWord = gloss ? `draw (${gloss})` : "draw";
  if (draw.rank === taste.rank) return `Adding taste leaves this pair at #${taste.rank}.`;
  if (time) return `Time alone ranks this pair #${time.rank}, time and ${drawWord} #${draw.rank}, with taste #${taste.rank}.`;
  return `Time and ${drawWord} rank this pair #${draw.rank}, with taste #${taste.rank}.`;
}

/** The anchor of the "What Qloo changes" block, for the card's pointer and the jump links. */
export const WHAT_QLOO_ID = "what-qloo-changes";

/** The limit printed under the figure when taste moves the pair: what the move up does not show. */
export const QLOO_CHANGES_LINE = "This does not prove #1 is the right clash to move.";
/** The same on the invented day, where no Qloo figure was used. */
export const TASTE_CHANGES_LINE_SYNTHETIC = "This does not prove #1 is the right clash to move.";

/** "What Qloo changes", or the invented day's honest name for it. */
export function whatChangesTitle(synthetic: boolean): string {
  return synthetic ? "What taste changes" : "What Qloo changes";
}

/**
 * The block's heading: what adding taste did to this pair's place, from the draw rung to the taste rung,
 * never from minutes alone (draw made that step). Without both rungs it is the block's name.
 */
export function tasteHeading(readings: Pick<ThreeReadings, "draw" | "taste">, synthetic = false): string {
  const { draw, taste } = readings;
  if (!draw || !taste) return whatChangesTitle(synthetic);
  if (draw.rank === taste.rank) return tasteVerdict(readings).replace(/\.$/, "");
  return `Adding taste moves this pair from #${draw.rank} to #${taste.rank}`;
}

/** The block's line under the figure: the limit when taste moves the pair, else what the ranks say. */
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

/**
 * How many clashes the three readings rank, when every reading the figure places ranks the same number:
 * the figure's own axis count. Null when any placed reading counts differently, or none can be placed.
 */
export function sharedCount(readings: readonly ReadingRank[]): number | null {
  const scale = figureScale(readings);
  if (scale === null) return null;
  return readings.filter(placed).every((reading) => reading.of === scale) ? scale : null;
}

/**
 * The line under the heading: "A × B, 45 min shared, ranked three ways among the day’s 68 scored clashes."
 * The count is printed only when every placed reading ranks that many (`sharedCount`); otherwise the
 * sentence ends at "ranked three ways.", and without the pair's minutes it names the pair alone.
 */
export function pairLine(aName: string, bName: string, minutes: number | null, readings: readonly ReadingRank[]): string {
  const count = sharedCount(readings);
  const shared = minutes === null ? "" : `, ${minutes} min shared`;
  return `${aName} × ${bName}${shared}, ranked three ways${count === null ? "" : ` among the day’s ${count} scored clashes`}.`;
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
 * One reading on the shared axis, as two cells of its row: its place set in the 1.75rem numeral with
 * "of N" (its own count) and any tie under it, then the 2px border-strong axis line 8px under it. The
 * ink dot sits on a 2px card halo; the index used here has the larger dot. The axis has 8px ticks at #1
 * and at #maxOf, and one more at the reading's own last place when it ranks fewer pairs than the longest
 * reading. From 640px the place sits beside its marker: right of it, or left of it once the marker is past
 * 70% of the track (or of the reading's own shorter track), so it never runs over the track's ends. On a
 * phone it closes the label's line, right-aligned, and the axis runs full width under both.
 */
function RankPlace({ reading, maxOf, used }: { reading: PlacedReading; maxOf: number; used: boolean }) {
  const at = rankX(reading.rank, maxOf);
  const end = rankX(reading.of, maxOf);
  const flip = end - at < LABEL_ROOM && at > end - at;
  const room = (flip ? at : 1 - at) * 100;
  const tie = tieText(reading.tied);
  const pos = `${at * 100}%`;
  const offset = used ? "14px" : "12px";
  // The 640px placement as custom properties, so the phone's right-aligned place needs no script.
  const place = {
    "--place": `calc(${flip ? `${100 - at * 100}%` : pos} + ${offset})`,
    "--room": `calc(${room}% - ${offset})`,
  } as CSSProperties;
  return (
    <>
      <div className="min-w-0 sm:px-2" data-at={at} data-flip={flip ? "" : undefined}>
        <div
          className={cn(
            "flex w-max flex-col items-end text-right sm:max-w-(--room)",
            flip ? "sm:mr-(--place) sm:ml-auto" : "sm:ml-(--place) sm:items-start sm:text-left",
          )}
          style={place}
        >
          <p className="flex items-baseline gap-x-1.5 whitespace-nowrap">
            <span className="type-numeral text-[1.75rem] leading-none">#{reading.rank}</span>{" "}
            <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">of {reading.of}</span>
          </p>
          {tie ? <p className="mt-0.5 font-mono text-[0.8125rem] leading-5 text-muted-foreground">{tie}</p> : null}
        </div>
      </div>
      <div aria-hidden="true" data-axis="" className="relative col-span-2 mx-2 h-2 sm:col-span-1 sm:col-start-2">
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
            used ? "size-4" : "size-3",
          )}
          style={{ left: pos }}
        />
      </div>
    </>
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
 * the index used here (the last row) differs only by its semibold label and its larger dot, never a
 * border, a fill or raspberry, because it is not a cost. Rows are divided by 1px hairlines. Under the
 * rows, one axis caption built from the readings. A reading with no figure keeps its text and no marker;
 * with no placeable reading there is no axis and the rows print as text.
 */
function ReadingsFigure({ steps }: { steps: readonly TriptychStep[] }) {
  const maxOf = figureScale(steps.map((step) => step.reading));
  return (
    <div data-rank-figure="">
      <ol className="divide-y divide-border">
        {steps.map((step, i) => {
          const used = i === steps.length - 1;
          const { reading } = step;
          const onAxis = maxOf !== null && placed(reading);
          return (
            <li
              key={step.key}
              data-reading={step.key}
              className={cn(
                "grid py-3 first:pt-0 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-end sm:gap-x-6 sm:py-4 sm:first:pt-0",
                // A placed reading is two lines on a phone, the label and its place on one, the axis under both;
                // from 640px the label spans both rows beside the place and its axis.
                onAxis
                  ? "grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 sm:grid-rows-[1fr_auto]"
                  : "gap-y-3",
              )}
            >
              <div className={cn("min-w-0", onAxis && "sm:row-span-2")}>
                <p className={cn("text-sm leading-5", used ? "font-semibold" : "font-normal")}>{step.label}</p>
                <p className="text-[0.8125rem] leading-snug text-muted-foreground">{step.gloss}</p>
              </div>
              {onAxis ? (
                <RankPlace reading={reading} maxOf={maxOf} used={used} />
              ) : (
                <div className={cn("min-w-0", maxOf !== null && "px-2")}>
                  <ReadingValue reading={reading} />
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

/**
 * The three rungs' names, cumulative, each adding one reading to the one above it: here in full, and `compact` for the
 * hero's short ladder (the same three readings, each named by what it adds). The third rung is the index used here,
 * which this app calculates from Qloo data; on the invented day no rung names Qloo.
 */
export function rungLabels(synthetic: boolean, compact = false): Record<keyof ThreeReadings, string> {
  if (compact) {
    return synthetic
      ? { time: "Time alone", draw: "+ invented popularity", taste: "+ invented taste" }
      : { time: "Time alone", draw: "+ Qloo popularity", taste: "+ taste overlap" };
  }
  return synthetic
    ? { time: "Time alone", draw: "Time + draw", taste: "+ invented taste overlap" }
    : { time: "Time alone", draw: "Time + Qloo popularity", taste: "+ taste overlap from Qloo data" };
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
  const heading = tasteHeading(readings, synthetic);
  // When taste leaves the pair where it was, the heading already says so, so no line repeats it under the
  // figure; when taste moves the pair, the line is the limit; without both rungs it says what is missing.
  const unmoved = !!readings.draw && !!readings.taste && readings.draw.rank === readings.taste.rank;
  const line = unmoved ? null : changesLine(readings, synthetic);
  // The limit line carries the caveat when taste moves the pair; otherwise the caption does.
  const moved = line === QLOO_CHANGES_LINE || line === TASTE_CHANGES_LINE_SYNTHETIC;
  const caption = [moved ? null : READINGS_CAPTION, synthetic ? READINGS_CAPTION_SYNTHETIC : null]
    .filter(Boolean)
    .join(" ");
  // Cumulative rungs: each adds one reading to the one above it. The third is the index used here, which
  // this app calculates from Qloo data, so it never reads as Qloo's own rank.
  const labels = rungLabels(synthetic);
  const steps: TriptychStep[] = [
    { key: "time", label: labels.time, gloss: "Minutes shared", reading: readings.time },
    {
      key: "draw",
      label: labels.draw,
      gloss: synthetic ? "Draw is invented popularity" : "Draw is Qloo popularity, 0 to 100",
      reading: readings.draw,
    },
    {
      key: "taste",
      label: labels.taste,
      gloss: "Taste overlap added: the index used here",
      reading: readings.taste,
    },
  ];
  const lead = (aName: string, bName: string) =>
    pairLine(aName, bName, pair?.minutes ?? null, [readings.time, readings.draw, readings.taste]);
  return { line, caption, steps, heading, lead, readings, unmoved };
}

/**
 * "What Qloo changes", its own block right after the hero: the decision's clash ranked on minutes
 * shared alone, on time and draw, and on time, draw and Qloo taste overlap (the index used here), on
 * the same timetable. Every rank is read by `threeReadings` from the lens data and the day's
 * concurrent pairs, never typed. The heading says what adding taste did to the pair's place and the
 * line directly under the figure says what that does not prove. On the invented day every figure is
 * labelled as made up. The home page composes the same readings in `TasteSection`.
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
  /** The day's concurrent scored pairs (`concurrentPairs`). */
  pairs: readonly SharedPair[];
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  synthetic?: boolean;
  className?: string;
}) {
  const { line, caption, steps, heading, lead } = triptychParts(lenses, pairs, aId, bId, synthetic);
  return (
    <section
      id={WHAT_QLOO_ID}
      aria-labelledby="what-qloo-heading"
      className={cn("container-page pt-10 pb-2 sm:pt-14", className)}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-10">
        <div className="min-w-0">
          <h2 id="what-qloo-heading" className="type-headline">
            {heading}
          </h2>
          <p className="mt-3 text-[0.9375rem] leading-relaxed">{lead(aName, bName)}</p>
        </div>
        <div className="min-w-0">
          <ReadingsFigure steps={steps} />
          {line ? <p className="mt-4 font-semibold">{line}</p> : null}
          {caption ? <p className="mt-1.5 text-[0.8125rem] leading-snug text-muted-foreground">{caption}</p> : null}
        </div>
      </div>
    </section>
  );
}

/** The decision's clash, by id and printed name, for the taste section. */
export type TasteSectionClash = { aId: string; bId: string; aName: string; bName: string };

/**
 * The aside in the places the section gives it. When it is the index card (`DecisionDetails`), its two parts: the
 * card, and the lines that sit beside it from 1024px (the hidden-clash line and the change line, with their
 * actions), each drawn by the card itself so both read the same copy. Any other aside is the card alone.
 */
export function asideParts(aside: ReactNode, besideClassName?: string): { card: ReactNode; beside: ReactNode } {
  if (isValidElement(aside) && aside.type === DecisionDetails) {
    const element = aside as ReactElement<DecisionDetailsProps>;
    return {
      card: cloneElement(element, { part: "card" }),
      beside: cloneElement(element, { part: "beside", className: besideClassName }),
    };
  }
  return { card: aside ?? null, beside: null };
}

/**
 * The taste section, right after the hero: what adding Qloo taste overlap changes, with its limit and the
 * failed test in the same place. With the decision's clash and the lens data the heading says what taste
 * did to that clash's place ("Adding taste moves this pair from #18 to #1", or "Adding taste leaves this
 * pair at #1"), and the figure ranks it three ways (minutes alone, adding popularity, adding taste overlap:
 * the index used here) with the limit directly under it. The failed test is never inside a disclosure.
 * Reading order, which is also the phone's: heading, pair line, figure, limit, failed test, the aside (the
 * hero's index card), the clash taste lowers, then the folds. From 1024px two columns run on their own: on the
 * left (five of twelve) the heading, the pair line, the failed test and the index card; on the right (seven) the
 * figure, its limit, the clash taste lowers, the card's hidden-clash and change lines (`asideParts`; below 1024px
 * they stay in the card) and the folds. It renders with no clash, no lens data, no twins and on the invented day.
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
  aside,
}: {
  /** The decision card's clash; null while the card is loading or is for another day. */
  clash: TasteSectionClash | null;
  lenses: Lenses | null;
  /** The day's concurrent scored pairs (`concurrentPairs`). */
  pairs: readonly SharedPair[];
  twins: readonly Twin[];
  acts: readonly Act[];
  /** The day's scored concurrent clashes, costliest first: a lens row opens its drawer from here. */
  ranked: readonly PairClash[];
  onOpen: (clash: PairClash, trigger: HTMLElement | null) => void;
  synthetic?: boolean;
  /** Rendered after the failed test, with or without the readings (the hero passes the index card). */
  aside?: ReactNode;
}) {
  const parts = clash && lenses ? triptychParts(lenses, pairs, clash.aId, clash.bId, synthetic) : null;
  // The other half of what taste does, from the same lens lists: the pair among the day's costliest on
  // time and draw that falls furthest once taste counts, with its own taste overlap when the page holds it.
  const fallen = parts && lenses ? otherHalfPair(lenses) : null;
  const fallenClash = fallen
    ? ranked.find((item) => samePair(fallen.aId, fallen.bId, item.a.act_id, item.b.act_id))
    : undefined;
  const otherHalf = fallen
    ? otherHalfLine(fallen, fallenClash ? formatOverlap(fallenClash.audience_overlap) : null, synthetic)
    : null;
  // The card's two lines, 16px under whatever precedes them in the right column (they draw nothing when the card
  // has neither line).
  const { card, beside } = asideParts(aside, "lg:not-first:mt-4");
  const folds =
    twins.length > 0 || lenses ? (
      <div className="space-y-3">
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
            <TasteLens lenses={lenses} ranked={ranked} onOpen={onOpen} synthetic={synthetic} embedded className="mt-4 mb-3" />
          </MoreDetails>
        ) : null}
      </div>
    ) : null;
  return (
    <section id={WHAT_QLOO_ID} aria-labelledby="what-qloo-heading">
      {/* The section ends on its own last block, as the hidden-clash exhibit does: the next heading's top padding
          sets the gap. */}
      <div className="container-page pt-16 pb-8 lg:pt-20 lg:pb-12">
        {clash && parts ? (
          // One DOM order, the phone's: heading and pair line, figure and limit, failed test, aside, the clash
          // taste lowers and the folds. From 1024px, two columns on twelve that each run on their own: on the left
          // (five) the heading (row 1), the failed test (rows 2 and 3) and the index card (row 4); on the right
          // (seven) the figure and its limit (rows 1 and 2), then the clash taste lowers, the card's two lines and
          // the folds (rows 3 and 4). Row 3 is 0px tall: the right column's second block starts 24px under the
          // figure or level with the failed test's end, whichever is lower, and the card 24px under that, so
          // neither column waits for the other's row. 24px between blocks at every width.
          <div className="grid gap-y-6 lg:grid-cols-12 lg:grid-rows-[auto_auto_0px_auto] lg:gap-x-12">
            <div className="min-w-0 lg:col-span-5 lg:col-start-1 lg:row-start-1">
              <h2 id="what-qloo-heading" className="type-headline">
                {parts.heading}
              </h2>
              <p data-pair-line="" className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed">
                {parts.lead(clash.aName, clash.bName)}
              </p>
            </div>
            <div className="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1">
              {/* One figure: the three readings on one shared rank axis; on a phone each place ends its label's line. */}
              <ReadingsFigure steps={parts.steps} />
              {/* The limit, 16px under the figure it reads and as wide, so it holds one line from 1280px. */}
              {parts.line ? (
                <p data-limit-line="" className="mt-4 font-semibold">
                  {parts.line}
                </p>
              ) : null}
              {parts.caption ? (
                <p className={cn("max-w-prose text-[0.8125rem] leading-snug", parts.line ? "mt-1.5" : "mt-4")}>
                  {parts.caption}
                </p>
              ) : null}
            </div>
            <FailedTestNote
              className="min-w-0 lg:col-span-5 lg:col-start-1 lg:row-span-2 lg:row-start-2"
              synthetic={synthetic}
            />
            {card ? <div className="min-w-0 lg:col-span-5 lg:col-start-1 lg:row-start-4">{card}</div> : null}
            {otherHalf || folds || beside ? (
              <div data-taste-side="" className="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-3">
                {otherHalf ? (
                  <p data-other-half="" className="max-w-prose text-[0.9375rem] leading-relaxed lg:max-w-none">
                    {otherHalf}
                  </p>
                ) : null}
                {/* The card's hidden-clash and change lines, from 1024px only (below it they stay in the card), 16px
                    under the clash taste lowers: the change line's top stays above the card's foot, so the index
                    figure it names is read beside the card's scale. */}
                {beside}
                {folds ? <div className={cn(otherHalf && "mt-4", "lg:mt-0 lg:not-first:mt-6")}>{folds}</div> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <h2 id="what-qloo-heading" className="type-headline">
              {whatChangesTitle(synthetic)}
            </h2>
            {folds ? <div className="mt-8">{folds}</div> : null}
            <FailedTestNote className="mt-12" synthetic={synthetic} />
            {aside ? <div className="mt-10">{aside}</div> : null}
          </>
        )}
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
