import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

import { ProvenanceChip } from "@/components/kernel";
import {
  describeReach,
  describeVsRandom,
  dialArc,
  dialDomain,
  dialFraction,
  dialPoint,
  rangePosition,
} from "@/lib/clash-budget";
import type { BaselineStats } from "@/lib/preset";

const W = 240;
const CX = 120;
const CY = 124;
const R = 100;
const TRACK = 14;

type BudgetDialProps = {
  index: number | null;
  baseline: BaselineStats | null;
  /** The rules every random valid timetable keeps, as a clause (see `describeReach`). */
  reach?: string;
  /**
   * The home page's reading under the decision card: the caption is cut to its two sentences, and the
   * rules the random timetables keep and the shaded range stay in the dial's text alternative.
   */
  compact?: boolean;
  /** The invented day: the text says its figures are invented instead of crediting Qloo. */
  synthetic?: boolean;
  className?: string;
};

const ANY_REACH = describeReach({ windowMinutes: null, neighbourStages: false, locked: 0 });

/**
 * The Clash Budget Index on a half dial: the middle 80% of random valid timetables of this lineup,
 * their average at 100, and a needle at this timetable. The gap to 100 is filled in one neutral
 * tone whichever side it falls on, because the dial is a reading, not a grade of a real festival. Every reading is also printed,
 * so nothing depends on the colours.
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
        <p className="type-kicker text-muted-foreground">Clash Budget Index</p>
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
  const p10 = baseline?.p10_index ?? null;
  const p90 = baseline?.p90_index ?? null;
  const needle = dialPoint(at(index), CX, CY, R - TRACK / 2 - 6);
  const avgInner = dialPoint(at(100), CX, CY, R - TRACK / 2 - 3);
  const avgOuter = dialPoint(at(100), CX, CY, R + TRACK / 2 + 3);
  const avgLabel = dialPoint(at(100), CX, CY, R + TRACK / 2 + 13);
  const rounded = Math.round(index);
  const position = rangePosition(index, p10, p90);

  return (
    <figure className={className}>
      <div className="flex items-start justify-between gap-3">
        <p className="type-kicker text-muted-foreground">Clash Budget Index</p>
        <ProvenanceChip provenance="derived" size="sm" />
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,13rem)_minmax(6.5rem,1fr)] items-end gap-x-4 sm:gap-x-5">
        <svg
          viewBox={`0 0 ${W} ${CY + 18}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="block w-full overflow-visible"
        >
          <title id={titleId}>{`Clash Budget Index ${rounded}`}</title>
          <desc id={descId}>
            {`Taste-overlap cost, ${synthetic ? "from invented figures" : "calculated from Qloo data"}. Dial from ${domain.min} to ${domain.max}. 100 is the average of random valid timetables of this lineup` +
              (compact ? ` in which ${reach}` : "") +
              (p10 !== null && p90 !== null
                ? `; the middle 80% of them score ${Math.round(p10)} to ${Math.round(p90)}.`
                : ".") +
              " Lower is better."}
          </desc>

          <path d={dialArc(0, 1, CX, CY, R)} fill="none" stroke="var(--muted)" strokeWidth={TRACK} />
          {p10 !== null && p90 !== null ? (
            <path
              d={dialArc(at(p10), at(p90), CX, CY, R)}
              fill="none"
              stroke="color-mix(in oklab, var(--foreground) 22%, transparent)"
              strokeWidth={TRACK}
            />
          ) : null}
          <path
            d={dialArc(at(Math.min(index, 100)), at(Math.max(index, 100)), CX, CY, R)}
            fill="none"
            stroke="color-mix(in oklab, var(--foreground) 35%, transparent)"
            strokeWidth={TRACK}
          />
          <line
            x1={avgInner.x}
            y1={avgInner.y}
            x2={avgOuter.x}
            y2={avgOuter.y}
            stroke="var(--foreground)"
            strokeWidth={2.5}
          />
          <text
            x={avgLabel.x}
            y={avgLabel.y}
            textAnchor="middle"
            className="fill-foreground font-mono text-[11px] font-semibold"
          >
            100
          </text>
          <line
            x1={CX}
            y1={CY}
            x2={needle.x}
            y2={needle.y}
            stroke="var(--foreground)"
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          <circle cx={CX} cy={CY} r={6.5} fill="var(--foreground)" />
          <circle cx={CX} cy={CY} r={2.25} fill="var(--card)" />
          <text x={CX - R} y={CY + 16} textAnchor="middle" className="fill-muted-foreground font-mono text-[11px]">
            {domain.min}
          </text>
          <text x={CX + R} y={CY + 16} textAnchor="middle" className="fill-muted-foreground font-mono text-[11px]">
            {domain.max}
          </text>
        </svg>

        <div className="min-w-0 pb-1">
          <p className="type-numeral text-6xl leading-none sm:text-7xl">{rounded}</p>
          <p className="mt-2 text-sm leading-snug font-semibold">{describeVsRandom(index)}.</p>
          <p className="text-sm leading-snug text-muted-foreground">Lower is better.</p>
        </div>
      </div>

      {compact ? (
        <figcaption className="mt-4 text-sm leading-relaxed">
          <p className="font-medium">
            100 = the average random valid timetable of this lineup. It counts only what clashes cost: taste
            overlap, time shared and draw.
          </p>
        </figcaption>
      ) : (
        <figcaption className="mt-4 text-sm leading-relaxed">
          <p className="font-medium">
            100 = the average of random valid timetables of this lineup in which {reach}. It counts
            only what clashes cost: taste overlap, time shared and draw, {synthetic ? "all invented for this day" : "calculated from Qloo data"}.
          </p>
          <p className="mt-1.5 text-muted-foreground">
            {p10 !== null && p90 !== null
              ? `Shaded: the middle 80% of those random valid timetables (${Math.round(p10)} to ${Math.round(p90)}). `
              : ""}
            {position === "above" || position === "below" ? (
              <>
                This day&rsquo;s published timetable scores {rounded}, {position} that range.{" "}
              </>
            ) : null}
            A reading, not a grade. Not a verdict on the festival: real programming weighs much more
            than taste overlap.
          </p>
        </figcaption>
      )}
    </figure>
  );
}

/** One card for the day's score: the dial on top, Qloo coverage underneath. */
export function Scorecard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("divide-y divide-border rounded-xl border border-border bg-card [&>*]:p-5 sm:[&>*]:p-6", className)}>
      {children}
    </div>
  );
}
