import type { CSSProperties } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import { budgetDelta, changeLabel } from "@/lib/agent-session";
import { rangeLead } from "@/lib/plan-copy";
import type { BaselineStats } from "@/lib/preset";
import type { ScaleRange } from "@/lib/stack";
import { cn } from "@/lib/utils";

/** The middle 80% of random valid timetables of this lineup (10th to 90th percentile), for scale. */
export type { ScaleRange };

/** The day's scale range from its baseline, or null when the baseline has none. */
export function scaleRange(baseline: BaselineStats | null): ScaleRange {
  return baseline && baseline.p10_index !== null && baseline.p90_index !== null
    ? { low: baseline.p10_index, high: baseline.p90_index }
    : null;
}

/** A Clash Budget change, as the option rows print it: "−2.4", "+0.6". */
export function signedDelta(delta: number): string {
  return `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta).toFixed(1)}`;
}

/**
 * A tested move's Clash Budget Index, before and after: the two readings, a chip that says how
 * far it moved ("2.4 lower"), a Now and an After bar, and the day's scale line when it has one:
 * the middle 80% of random valid timetables (`rangeLead`), then the caller's verdict, if any.
 * With `stamp`, each new result lands: the chip settles from 1.12x and the After figure is
 * underlined in the chip's colour. The underline stays, so the final frame is the one that shows.
 */
export function BudgetMove({
  before,
  after,
  range,
  verdict = null,
  stamp = null,
}: {
  before: number | null;
  after: number | null;
  range: ScaleRange;
  /** A sentence that follows the scale line, such as where a plan sits against that range. */
  verdict?: string | null;
  /** Marks each new result as it arrives: a key for the result shown, so a new one plays again. */
  stamp?: string | null;
}) {
  const delta = budgetDelta(before, after);
  const lead = rangeLead(range);
  if (before === null || after === null || delta === null) return null;
  const better = delta < 0;
  const Icon = delta === 0 ? ArrowRight : better ? ArrowDown : ArrowUp;
  const scale = Math.max(before, after, 100) * 1.1;
  const rows = [
    { label: "Now", value: before, tone: "bg-ink-3" },
    { label: "After", value: after, tone: better ? "bg-success" : delta > 0 ? "bg-primary" : "bg-ink-3" },
  ];
  const tone = better ? "var(--success)" : delta > 0 ? "var(--primary)" : "var(--muted-foreground)";
  return (
    <div className="mt-3">
      {/* A new result is a new paragraph, so its stamp plays once for it. */}
      <p
        key={stamp ?? undefined}
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
        style={stamp !== null ? ({ "--stamp": tone } as CSSProperties) : undefined}
      >
        <span className="type-numeral text-3xl leading-none">
          {before.toFixed(1)}
          <ArrowRight aria-label="to" className="mx-1.5 inline size-5 align-middle text-muted-foreground" />
          <span className={stamp !== null ? "cc-stamp-line" : undefined}>{after.toFixed(1)}</span>
        </span>
        <span
          className={cn(
            "tag",
            stamp !== null && "cc-stamp",
            better ? "text-success" : delta > 0 ? "text-primary" : "text-foreground",
          )}
        >
          <Icon aria-hidden="true" />
          {changeLabel(delta)}
        </span>
        <span className="text-[0.8125rem] text-muted-foreground">Clash Budget Index · lower is better</span>
      </p>
      <div className="mt-2.5 space-y-1.5" aria-hidden="true">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2 text-xs">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="relative block h-2 overflow-hidden rounded-bar bg-muted">
              <span
                className={cn("absolute inset-y-0 left-0 rounded-bar transition-[width] duration-200 ease-out motion-reduce:transition-none", row.tone)}
                style={{ width: `${Math.min(100, (row.value / scale) * 100)}%` }}
              />
            </span>
          </div>
        ))}
      </div>
      {lead ? (
        <p className="mt-2 text-xs text-muted-foreground lg:text-[0.8125rem]">
          {lead}
          {verdict ? ` ${verdict}` : ""}
        </p>
      ) : null}
    </div>
  );
}
