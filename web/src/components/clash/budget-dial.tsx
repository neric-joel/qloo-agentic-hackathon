import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

import { ProvenanceChip } from "@/components/kernel";
import { describeVsRandom, dialArc, dialDomain, dialFraction, dialPoint } from "@/lib/clash-budget";
import type { BaselineStats } from "@/lib/preset";

const W = 240;
const CX = 120;
const CY = 124;
const R = 100;
const TRACK = 14;

type BudgetDialProps = {
  index: number | null;
  baseline: BaselineStats | null;
  className?: string;
};

/**
 * The Clash Budget Index on a half dial: the band of random valid timetables, the random average
 * at 100, and a needle at this timetable. The gap to 100 is filled in, and every reading is also
 * printed, so nothing depends on the colours.
 */
export function BudgetDial({ index, baseline, className }: BudgetDialProps) {
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
          <title id={titleId}>{`Clash Budget Index ${rounded}, by Qloo's measure`}</title>
          <desc id={descId}>
            {`Dial from ${domain.min} to ${domain.max}. 100 is the average of random valid timetables for this lineup` +
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
            stroke={index > 100 ? "var(--primary)" : "var(--success)"}
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
          <p className="type-numeral text-6xl leading-none sm:text-7xl">
            {rounded}
            <span className="sr-only">, by Qloo&rsquo;s measure</span>
          </p>
          <p className="mt-2 text-sm leading-snug font-semibold">{describeVsRandom(index)}</p>
          <p className="text-sm leading-snug text-muted-foreground">Lower is better.</p>
        </div>
      </div>

      <figcaption className="mt-4 text-sm leading-relaxed">
        <p className="font-medium">
          100 = average of random valid timetables for this lineup · counts shared-audience cost
          only · by Qloo&rsquo;s measure
        </p>
        <p className="mt-1.5 text-muted-foreground">
          {p10 !== null && p90 !== null
            ? `Shaded: the middle 80% of those random timetables (${Math.round(p10)} to ${Math.round(p90)}). `
            : ""}
          Not a verdict on the festival: real programming weighs much more than shared audiences.
        </p>
      </figcaption>
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
