"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

import { ProvenanceChip } from "@/components/kernel";
import { COUNTS_ONLY } from "@/lib/credit";
import {
  describeReach,
  describeVsRandom,
  dialDomain,
  dialFraction,
  rangePosition,
} from "@/lib/clash-budget";
import type { BaselineStats } from "@/lib/preset";

/**
 * The figure's rows, in px; x runs in percent of the column's width. It speaks the home page's axis
 * language ("What Qloo changes"): a 1px border-strong axis with end ticks, the middle 80% of random
 * timetables as a muted band whose two border-strong ticks carry its extent, the span from 100 to the
 * reading, the ink 100 tick and an ink dot at the reading. The day's figure prints above the dot, and the
 * ends and "100 = average" print under the axis in 13px mono, so no two labels share a row at the rail's
 * 272px. The figure sits on the page's paper at every width, so its halos are drawn in the paper.
 */
const AXIS_Y = 26;
const RULER_H = 56;
/** The axis's end ticks, 6px tall, centred on it. */
const END_TICK = 6;
/**
 * The band: 8px of muted fill (information only), its corners a mark's, clamped to half its height so
 * its ends are round, and 12px border-strong ticks at its two ends.
 */
const BAND_H = 8;
const BAND_TICK = 12;
/** The span from 100 to the reading: a 3px line on the axis. */
const SPAN_W = 3;
/** The ink 100 tick is 2px wide and 18px tall, on a 6px paper underlay of its own height. */
const REF_W = 2;
const REF_H = 18;
/** The reading: a 10px ink dot on a 2px paper halo (a 14px paper circle under it). */
const DOT_R = 5;
const HALO = 2;
/** The underlay is this wide, so a 2px paper gap rings the 100 tick wherever it crosses the span or the band. */
const UNDERLAY_W = REF_W + 2 * HALO;
/** The reading's label: its baseline 4px over the 100 tick's top (and 6px over the dot's halo). */
const LABEL_Y = AXIS_Y - REF_H / 2 - 4;
/** The baseline of the ends and "100 = average", 4px above the ruler's foot. */
const FOOT_Y = RULER_H - 4;
/** The ruler's narrowest width: the 18rem rail, 4px wider either side, less its 12px inset either side (272px). */
const RULER_MIN_W = 272;
/** Centre to centre, the dot and the 100 tick keep a 2px paper gap between them: 5 + 2 + 1 px. */
const MARK_CLEAR = DOT_R + HALO + REF_W / 2;
/** The halo and the underlay are the paper on screen; in print the paper is the sheet's white. */
const PAPER = "var(--background)";

/**
 * How far, in px, the dot (and its label) is nudged off its reading so it never touches the 100 tick:
 * none when the reading is already 8px or more from 100 at the ruler's narrowest width, else just
 * enough to clear it there (at most 8px, away from 100). Wider rulers only spread them further.
 */
export function readingNudge(fromHundred: number): number {
  const apart = Math.abs(fromHundred) * RULER_MIN_W;
  if (apart >= MARK_CLEAR) return 0;
  return (fromHundred < 0 ? -1 : 1) * (MARK_CLEAR - apart);
}

type BudgetDialProps = {
  index: number | null;
  baseline: BaselineStats | null;
  /** The rules every random valid timetable keeps, as a clause (see `describeReach`). */
  reach?: string;
  /**
   * The home page's reading in the timetable's narrow header cell: the dial and figure side by side,
   * the sentence under them, and a caption cut to what the index is measured against; the rules the
   * random timetables keep and the shaded range stay in the dial's text alternative.
   */
  compact?: boolean;
  /** The invented day: the text says its figures are invented instead of crediting Qloo. */
  synthetic?: boolean;
  className?: string;
};

const ANY_REACH = describeReach({ windowMinutes: null, neighbourStages: false, locked: 0 });

/** The index as the hero's decision card prints it: one decimal. Display precision only. */
function oneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

/**
 * The Clash Budget Index on a horizontal reference scale, like the rule along the foot of a printed
 * running order, drawn in the home page's axis language: the middle 80% of random valid timetables of
 * this lineup as a band on the axis between two end ticks, their average at the tall ink 100 tick, and an
 * ink dot at this timetable. Above 100 the span from 100 to the reading is raspberry, because it is the
 * excess cost; below 100 it is a grey graphic. Every reading is also printed, so nothing depends on the
 * colours.
 *
 * Everything is drawn at its reading from the first paint: nothing moves or counts when the scale
 * scrolls into view, and the title never changes.
 */
export function BudgetDial({
  index,
  baseline,
  reach = ANY_REACH,
  compact = false,
  synthetic = false,
  className,
}: BudgetDialProps) {
  const titleId = useId();
  const descId = useId();

  if (index === null) {
    return (
      <div className={className}>
        <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Clash Budget Index</p>
        <p className="type-title mt-3">No index for this day</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The random timetables it is measured against could not be sampled, so there is nothing
          to compare with. Individual clash prices below still stand.
        </p>
      </div>
    );
  }

  const domain = dialDomain(index, baseline);
  const at = (value: number) => dialFraction(value, domain);
  /** A value's x on the ruler, in percent of its width, to 0.1%. */
  const pct = (value: number) => Math.round(at(value) * 1000) / 10;
  const x = (value: number) => `${pct(value)}%`;
  const p10 = baseline?.p10_index ?? null;
  const p90 = baseline?.p90_index ?? null;
  const band = p10 !== null && p90 !== null ? { low: Math.min(p10, p90), high: Math.max(p10, p90) } : null;
  const reading = oneDecimal(index);
  const printed = reading.toFixed(1);
  const position = rangePosition(index, p10, p90);
  // Read from the printed positions, so the gap holds for the x the SVG is given.
  const nudge = readingNudge((pct(index) - pct(100)) / 100);
  // Rounded away from 100, never toward it, so the 2px gap is never shaved.
  const readingShift = nudge === 0 ? undefined : `translate(${(Math.sign(nudge) * Math.ceil(Math.abs(nudge) * 100)) / 100} 0)`;
  // A label near either end of the scale hangs inward, so it stays inside the column.
  const anchorAt = (fraction: number, edge: number) => (fraction < edge ? "start" : fraction > 1 - edge ? "end" : "middle");
  const refAnchor = anchorAt(at(100), 0.3);
  const dayAnchor = anchorAt(at(index), 0.08);

  const ruler = (
    <svg
      width="100%"
      height={RULER_H}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      className="block overflow-visible"
    >
      <title id={titleId}>{`Clash Budget Index ${printed}`}</title>
      <desc id={descId}>
        {`Taste-overlap cost, ${synthetic ? "from invented figures" : "calculated from Qloo data"}. Scale from ${domain.min} to ${domain.max}. 100 is the average of random valid timetables of this lineup` +
          (compact ? ` in which ${reach}` : "") +
          (p10 !== null && p90 !== null
            ? `; the middle 80% of them score ${Math.round(p10)} to ${Math.round(p90)}.`
            : ".") +
          " Lower is better."}
      </desc>

      {/* The band first, so the axis runs through it: the middle 80% of random timetables as an 8px muted
          fill (information only, 1.11 / 1.32 on paper) with round ends, its extent carried by the two 12px
          border-strong ticks drawn with the axis. */}
      {band ? (
        <rect
          data-band=""
          x={x(band.low)}
          y={AXIS_Y - BAND_H / 2}
          width={`${Math.round(Math.abs(at(band.high) - at(band.low)) * 1000) / 10}%`}
          height={BAND_H}
          rx={BAND_H / 2}
          fill="var(--muted)"
        />
      ) : null}
      {/* The axis: a 1px border-strong line across the ruler with 6px end ticks at the domain's ends. */}
      <line data-axis="" x1="0" x2="100%" y1={AXIS_Y} y2={AXIS_Y} stroke="var(--border-strong)" strokeWidth={1} shapeRendering="crispEdges" />
      <line
        data-tick="min"
        x1="0"
        x2="0"
        y1={AXIS_Y - END_TICK / 2}
        y2={AXIS_Y + END_TICK / 2}
        stroke="var(--border-strong)"
        strokeWidth={1}
        shapeRendering="crispEdges"
        transform="translate(0.5 0)"
      />
      <line
        data-tick="max"
        x1="100%"
        x2="100%"
        y1={AXIS_Y - END_TICK / 2}
        y2={AXIS_Y + END_TICK / 2}
        stroke="var(--border-strong)"
        strokeWidth={1}
        shapeRendering="crispEdges"
        transform="translate(-0.5 0)"
      />
      {band
        ? (["low", "high"] as const).map((end) => (
            <line
              key={end}
              data-tick={end === "low" ? "p10" : "p90"}
              x1={x(band[end])}
              x2={x(band[end])}
              y1={AXIS_Y - BAND_TICK / 2}
              y2={AXIS_Y + BAND_TICK / 2}
              stroke="var(--border-strong)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ))
        : null}
      {/* The span from 100 to the reading: raspberry only above 100 (the excess), ink-3 at or under it. */}
      <line
        data-span=""
        x1={x(Math.min(index, 100))}
        x2={x(Math.max(index, 100))}
        y1={AXIS_Y}
        y2={AXIS_Y}
        stroke={index > 100 ? "var(--primary)" : "var(--ink-3)"}
        strokeWidth={SPAN_W}
      />
      {/* The 100 tick, 2px of ink, on a 6px paper underlay of its own height drawn after the band and the
          span, so a 2px paper gap always separates the ink from the raspberry span and from the band. */}
      <line
        data-underlay="ref"
        x1={x(100)}
        x2={x(100)}
        y1={AXIS_Y - REF_H / 2}
        y2={AXIS_Y + REF_H / 2}
        stroke={PAPER}
        strokeWidth={UNDERLAY_W}
        className="print:stroke-card"
      />
      <line
        data-ref=""
        x1={x(100)}
        x2={x(100)}
        y1={AXIS_Y - REF_H / 2}
        y2={AXIS_Y + REF_H / 2}
        stroke="var(--foreground)"
        strokeWidth={REF_W}
      />
      {/* The reading: a 10px ink dot on a 2px paper halo, which parts it from the span's end. */}
      <circle
        data-halo=""
        cx={x(index)}
        cy={AXIS_Y}
        r={DOT_R + HALO}
        fill={PAPER}
        transform={readingShift}
        className="print:fill-card"
      />
      <circle data-dot="" cx={x(index)} cy={AXIS_Y} r={DOT_R} fill="var(--foreground)" transform={readingShift} />
      <text
        x={x(index)}
        y={LABEL_Y}
        textAnchor={dayAnchor}
        transform={readingShift}
        className="fill-primary font-mono text-[13px] font-semibold"
      >
        {printed}
      </text>
      <text x="0" y={FOOT_Y} textAnchor="start" className="fill-muted-foreground font-mono text-[13px]">
        {domain.min}
      </text>
      <text x={x(100)} y={FOOT_Y} textAnchor={refAnchor} className="fill-foreground font-mono text-[13px] font-semibold">
        100 = average
      </text>
      <text x="100%" y={FOOT_Y} textAnchor="end" className="fill-muted-foreground font-mono text-[13px]">
        {domain.max}
      </text>
    </svg>
  );

  return (
    <figure className={className}>
      {/* The source rides on the label line after a middle dot as a plain muted word, not a boxed stamp. */}
      <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
        Clash Budget Index{" "}
        <span aria-hidden="true" className="font-normal">
          ·
        </span>{" "}
        <ProvenanceChip provenance="derived" look="kicker" synthetic={synthetic} />
      </p>

      <div className="mt-3 flex items-end gap-x-4 sm:gap-x-5">
        {/* The figure at h2 scale in the condensed title face (2.25rem/1, tabular), not a display numeral. */}
        <p className="type-numeral shrink-0 text-[2.25rem] leading-none">{printed}</p>
        {compact ? null : (
          <div className="min-w-0 pb-1">
            <p className="text-sm leading-snug font-semibold">{describeVsRandom(index, synthetic)}.</p>
            <p className="text-sm leading-snug text-muted-foreground">Lower is better.</p>
          </div>
        )}
      </div>

      <div className="mt-4">{ruler}</div>

      {compact ? (
        // In the open Index block: a hairline across the block's own width over the sentence (15px
        // semibold), then its explanation at 13px on a 1.625 line, muted, wrapping at the block's
        // measure. Never clamped. The sentence already names the timetable, the average it is read against
        // and which way is more clash cost, and the hero's scale line says the random timetables are of this
        // lineup, so the explanation gives only "Lower is better" and the cost's parts.
        <figcaption className="mt-4 border-t border-border pt-4">
          <p className="text-[0.9375rem] leading-snug font-semibold">{describeVsRandom(index, synthetic)}.</p>
          <p data-index-explain="" className="mt-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
            Lower is better. {COUNTS_ONLY}
          </p>
        </figcaption>
      ) : (
        <figcaption className="mt-4 text-sm leading-relaxed">
          <p className="font-medium">
            100 = the average of random valid timetables of this lineup in which {reach}.{" "}
            {COUNTS_ONLY.slice(0, -1)}, {synthetic ? "all invented for this day" : "calculated from Qloo data"}.
          </p>
          <p className="mt-1.5 text-muted-foreground">
            {p10 !== null && p90 !== null
              ? `Shaded: the middle 80% of those random valid timetables (${Math.round(p10)} to ${Math.round(p90)}). `
              : ""}
            {position === "above" || position === "below" ? (
              <>
                This day&rsquo;s published timetable scores {printed}, {position} that range.{" "}
              </>
            ) : null}
            A reading of one cost. Real programming weighs much more than taste overlap.
          </p>
        </figcaption>
      )}
    </figure>
  );
}

/**
 * The board's Index block: a result, so it sits open on the page's paper with no box, under one 1px
 * hairline rule. It holds the label, the figure, its axis and the sentence under it. Below 1280px the
 * block carries that rule itself; from 1280px the rail's wrapper carries it (see clash-control's rail),
 * so the block drops its own and there is exactly one rule above the Index at every width.
 */
export function Scorecard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("border-t border-border pt-5 sm:pt-6 xl:border-0 xl:pt-0", className)}>
      {children}
    </div>
  );
}
