"use client";

import { useId } from "react";

import { normalizeName, type CheckReport, type CheckSet, type SharedPair } from "@/lib/check";
import type { PriceAnswer } from "@/lib/check-price";
import { cn } from "@/lib/utils";

/** The strip's caption, beside it: what its numbers are. */
export const STRIP_CAPTION = "Numbers: taste rank in this comparison";

/**
 * The rank qualifier the compare step's scope note ends its saved-day sentence with (`rankScope` in
 * `lib/check-price.ts`). While the strip is on show it sits beside the strip's numbers instead of under the
 * step, so the qualifier stays with the numbers.
 */
export const RANK_NOTE = "“Taste rank 1 of n” orders only the pairs compared here.";

/**
 * The strip's sizes in px: a 14px bar per stage, 18px between lanes (a number's line), the shared window inset
 * 2px from each bar, 12px numbers, at most 160px tall. Every mark's corner is `corner` of the bar's height
 * (4px on a 14px bar), the brief figure's proportion, so a short set never closes into a capsule. Number places
 * are worked out at the narrowest strip the page draws (`narrowest`), so they stay clear of each other at any
 * wider one.
 */
export const STRIP = { bar: 14, gap: 18, inset: 2, corner: 0.3, number: 12, maxHeight: 160, narrowest: 300, pad: 1 } as const;

type Span = { start: number; end: number };

/** One compared pair's shared window, between its two sets' lanes, and where its taste rank is printed. */
export type StripWindow = {
  rank: number;
  start: number;
  end: number;
  /** Lane indexes of the earlier-listed and the later-listed stage, top to bottom. */
  upper: number;
  lower: number;
  /** The number's place: the gap under lane `gap`, at `x` (a share of the strip's width, 0 to 100). */
  label: { gap: number; x: number };
};

/**
 * The strip's frame for a grid: its stages in the grid's order, the bar and the gap that fit them in 160px, the
 * height they make and the corner of every mark.
 */
export type StripSize = { order: string[]; bar: number; gap: number; height: number; rx: number };

export type StripLayout = Omit<StripSize, "order"> & {
  domain: Span;
  lanes: { key: string; sets: Span[] }[];
  windows: StripWindow[];
};

/**
 * The strip's frame, from the grid's rows alone: lanes and gaps shrink together only when the stages would pass
 * 160px, a gap never under a number's line (14px) and a bar never under 6px. Null for one stage, or for more
 * than eight (they would not fit).
 */
export function stripSize(day: Pick<CheckReport, "sets">): StripSize | null {
  const order = [...new Set(day.sets.map((set) => set.stageKey))];
  if (order.length < 2) return null;
  const n = order.length;
  const natural = 2 * STRIP.pad + n * STRIP.bar + (n - 1) * STRIP.gap;
  const fit = Math.min(1, STRIP.maxHeight / natural);
  const gap = Math.max(STRIP.number + 2, Math.floor(STRIP.gap * fit));
  const bar = Math.min(STRIP.bar, Math.floor((STRIP.maxHeight - 2 * STRIP.pad - (n - 1) * gap) / n));
  if (bar < 6) return null;
  const height = 2 * STRIP.pad + n * bar + (n - 1) * gap;
  // On the half pixel, never above the share: 4px on a 14px bar, 2px on a 7px one.
  const rx = Math.floor(bar * STRIP.corner * 2) / 2;
  return { order, bar, gap, height, rx };
}

/** The strip's time domain: the day's first start to its last end, on quarter hours. */
function domainOf(sets: readonly Span[]): Span {
  const start = Math.floor(Math.min(...sets.map((set) => set.start)) / 15) * 15;
  const end = Math.ceil(Math.max(...sets.map((set) => set.end)) / 15) * 15;
  return { start, end: Math.max(end, start + 15) };
}

/** Where a minute sits, as a share of the strip's width (0 to 100). */
function share(domain: Span, minute: number): number {
  return ((minute - domain.start) / (domain.end - domain.start)) * 100;
}

/** A number's width in px at 12px: tabular digits are about 0.6em each, plus its 1.5px halo on both sides. */
function numberWidth(rank: number): number {
  return String(rank).length * 7.2 + 3;
}

/** The two names of a pair as one unordered key, compared as the check compares names. */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("\u0000");
}

/**
 * The strip of a published day after Compare audience overlap, from the grid's parsed rows and the answer on
 * show: one lane per stage (in the grid's order), each set a bar, and each compared pair's shared window
 * between its two lanes with its taste rank in this comparison (1 is the highest). A pair is matched to its
 * longest overlap on the grid, as the compare step chose it. Each number takes the first gap of its window,
 * at the window's middle, that is clear of the numbers placed before it (rank order); then the window's
 * ends; else the middle. Null when no compared pair is on the grid, the grid has one stage, or its stages
 * would not fit 160px (more than eight).
 */
export function stripLayout(
  day: Pick<CheckReport, "sets" | "shared">,
  answer: Pick<PriceAnswer, "pairs">,
  narrowest: number = STRIP.narrowest,
): StripLayout | null {
  const size = stripSize(day);
  if (!size) return null;
  const { order, bar, gap, height, rx } = size;
  const laneOf = new Map(order.map((key, index) => [key, index]));
  const longest = new Map<string, SharedPair>();
  for (const pair of day.shared) {
    const key = pairKey(pair.a.actKey, pair.b.actKey);
    if (!longest.has(key)) longest.set(key, pair);
  }
  const compared = answer.pairs
    .filter((pair) => pair.status === "priced" && pair.rank !== null)
    .flatMap((pair) => {
      const found = longest.get(pairKey(normalizeName(pair.a), normalizeName(pair.b)));
      if (!found) return [];
      const lanes = [laneOf.get(found.a.stageKey) ?? 0, laneOf.get(found.b.stageKey) ?? 0];
      if (lanes[0] === lanes[1]) return [];
      return [{ rank: pair.rank as number, start: found.windowStart, end: found.windowEnd, upper: Math.min(...lanes), lower: Math.max(...lanes) }];
    })
    .sort((x, y) => x.rank - y.rank);
  if (compared.length === 0) return null;

  const domain = domainOf(day.sets);
  const placed: { gap: number; left: number; right: number }[] = [];
  const clear = (gapIndex: number, centre: number, width: number) =>
    placed.every((other) => other.gap !== gapIndex || centre + width / 2 + 2 <= other.left || centre - width / 2 - 2 >= other.right);
  const windows = compared.map((item) => {
    const width = numberWidth(item.rank);
    const half = (width / 2 / narrowest) * 100;
    const from = share(domain, item.start);
    const to = share(domain, item.end);
    const keep = (x: number) => Math.min(100 - half, Math.max(half, x));
    // In px at the narrowest strip, for the clearance test.
    const px = (x: number) => (x / 100) * narrowest;
    const xs = [keep((from + to) / 2), keep(from + half), keep(to - half)];
    let label: StripWindow["label"] | null = null;
    for (const x of xs) {
      for (let g = item.upper; g < item.lower && label === null; g += 1) {
        if (clear(g, px(x), width)) label = { gap: g, x };
      }
      if (label) break;
    }
    label ??= { gap: item.upper, x: xs[0] };
    const centre = px(label.x);
    placed.push({ gap: label.gap, left: centre - width / 2, right: centre + width / 2 });
    return { ...item, label };
  });

  const lanes = order.map((key) => ({
    key,
    sets: day.sets.filter((set: CheckSet) => set.stageKey === key).map((set) => ({ start: set.start, end: set.end })),
  }));
  return { domain, lanes, windows, bar, gap, height, rx };
}

/** An SVG percentage, to a thousandth. */
function pct(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

/**
 * The published day after Compare audience overlap, as a static strip above the compared values: one lane per
 * stage, each set a bar with the strip's mark corner outlined in ink, each compared pair's shared window hatched in
 * raspberry between its two lanes (shared time, and only that), numbered by its taste rank in this comparison
 * in ink (not raspberry, which is shared time, and not teal, which is Qloo). Nothing else: no names, no axis, no
 * motion and no control. It repeats the rows under it, which stay the reading, so it is hidden from assistive
 * technology; the caption beside it says what the numbers are and keeps the rank qualifier with them. Its x
 * runs in percentages, so it scales to the column (358px at 390) with no sideways scroll, and its height is
 * fixed (144px for five stages, at most 160px).
 */
export function CheckDayStrip({ layout }: { layout: StripLayout }) {
  const hatchId = `cc-day-strip-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const { domain, lanes, windows, bar, gap, height, rx } = layout;
  const x = (minute: number) => share(domain, minute);
  const top = (lane: number) => STRIP.pad + lane * (bar + gap);
  return (
    <div data-day-strip="" className={FRAME}>
      <div aria-hidden="true" className="min-w-0">
        <svg width="100%" height={height} focusable="false" className="block overflow-visible">
          <defs>
            {/* The hero's hatch: one 1.5px raspberry line every 6px at 45 degrees, over the shared wash. */}
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
              <line x1={3} y1={0} x2={3} y2={6} stroke="var(--primary)" strokeWidth={1.5} />
            </pattern>
          </defs>
          {windows.map((window) => {
            const rect = {
              x: pct(x(window.start)),
              y: top(window.upper) + bar + STRIP.inset,
              width: pct(x(window.end) - x(window.start)),
              height: top(window.lower) - top(window.upper) - bar - 2 * STRIP.inset,
            };
            return (
              <g key={`${window.upper}-${window.lower}-${window.start}`} data-strip-window={window.rank}>
                <rect {...rect} rx={rx} fill="var(--shared-wash)" />
                <rect {...rect} rx={rx} fill={`url(#${hatchId})`} />
              </g>
            );
          })}
          {lanes.map((lane, index) => (
            <g key={lane.key} data-strip-lane={index}>
              {lane.sets.map((set) => (
                <rect
                  key={`${set.start}-${set.end}`}
                  data-strip-set=""
                  x={pct(x(set.start))}
                  y={top(index)}
                  width={pct(x(set.end) - x(set.start))}
                  height={bar}
                  rx={rx}
                  fill="var(--card)"
                  stroke="var(--foreground)"
                  strokeWidth={1}
                />
              ))}
            </g>
          ))}
          {windows.map((window) => (
            <text
              key={`${window.upper}-${window.lower}-${window.start}`}
              data-strip-rank={window.rank}
              x={pct(window.label.x)}
              y={top(window.label.gap) + bar + gap / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--foreground)"
              stroke="var(--card)"
              strokeWidth={3}
              strokeLinejoin="round"
              paintOrder="stroke"
              fontSize={STRIP.number}
              fontWeight={600}
              className="tabular-nums"
            >
              {window.rank}
            </text>
          ))}
        </svg>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        <span aria-hidden="true" className="block font-semibold text-foreground">
          {STRIP_CAPTION}
        </span>
        <span className="block">{RANK_NOTE}</span>
      </p>
    </div>
  );
}

/** The strip and its caption: beside each other from 1024px, the caption under the strip below. */
const FRAME = "mt-4 grid gap-x-6 gap-y-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,13rem)] lg:items-center";

/**
 * The strip's room while a published day's compare is pending, in the strip's own frame and size: one quiet bar
 * per stage at the strip's lane pitch and corner, and quiet bars where the caption's words will be (the words set
 * the bars' wrap; none is shown or read). It draws no set, no window and no number, so it says nothing the
 * answer has not said, and the strip takes exactly its place when the answer comes.
 */
export function CheckDayStripRoom({ size }: { size: StripSize }) {
  return (
    <div aria-hidden="true" data-day-strip-room="" className={FRAME}>
      <div className="flex min-w-0 flex-col" style={{ height: size.height, paddingBlock: STRIP.pad, rowGap: size.gap }}>
        {size.order.map((key) => (
          <div key={key} className="shrink-0 bg-muted" style={{ height: size.bar, borderRadius: size.rx }} />
        ))}
      </div>
      <p className="text-sm leading-relaxed">
        <span data-ghost={STRIP_CAPTION} className={cn("block font-semibold", GHOST_LINE)} />
        <span data-ghost={RANK_NOTE} className={cn("block", GHOST_LINE)} />
      </p>
    </div>
  );
}

/**
 * Room held for words an answer will bring, drawn as quiet bars: the element's `data-ghost` words are laid out
 * through its ::before box (so they wrap exactly as the words will, at any width) in a transparent ink over the
 * muted fill, one bar per line. The words are never in the page's text: not shown, not read, not selectable.
 */
export const GHOST_LINE =
  "before:rounded-xs before:bg-muted before:text-transparent before:content-[attr(data-ghost)] before:[-webkit-box-decoration-break:clone] before:[box-decoration-break:clone]";

/** The same room with nothing drawn: an unseen stand-in that only sets a height. */
export const GHOST_ROOM = "invisible before:content-[attr(data-ghost)]";
