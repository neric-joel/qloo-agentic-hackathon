import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import { budgetDelta, changeLabel } from "@/lib/agent-session";
import type { BaselineStats } from "@/lib/preset";
import type { ScaleRange } from "@/lib/stack";
import { cn } from "@/lib/utils";

/** The range random valid timetables of this lineup score in (10th to 90th percentile), for scale. */
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
 * far it moved ("2.4 lower"), a Now and an After bar, and the day's scale line when it has one.
 */
export function BudgetMove({
  before,
  after,
  range,
  verdict = null,
}: {
  before: number | null;
  after: number | null;
  range: ScaleRange;
  /** A sentence that follows the scale line, such as where a plan sits against that range. */
  verdict?: string | null;
}) {
  const delta = budgetDelta(before, after);
  if (before === null || after === null || delta === null) return null;
  const better = delta < 0;
  const Icon = delta === 0 ? ArrowRight : better ? ArrowDown : ArrowUp;
  const scale = Math.max(before, after, 100) * 1.1;
  const rows = [
    { label: "Now", value: before, tone: "bg-foreground/35" },
    { label: "After", value: after, tone: better ? "bg-success" : delta > 0 ? "bg-primary" : "bg-foreground/35" },
  ];
  return (
    <div className="mt-3">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="type-numeral text-3xl leading-none">
          {before.toFixed(1)}
          <ArrowRight aria-label="to" className="mx-1.5 inline size-5 align-middle text-muted-foreground" />
          {after.toFixed(1)}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
            better ? "border-success text-success" : delta > 0 ? "border-primary text-primary" : "border-border-strong",
          )}
        >
          <Icon aria-hidden="true" className="size-3" />
          {changeLabel(delta)}
        </span>
        <span className="text-xs text-muted-foreground">Clash Budget Index · lower is better</span>
      </p>
      <div className="mt-2.5 space-y-1.5" aria-hidden="true">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2 text-xs">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="relative block h-2 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700", row.tone)}
                style={{ width: `${Math.min(100, (row.value / scale) * 100)}%` }}
              />
            </span>
          </div>
        ))}
      </div>
      {range ? (
        <p className="mt-2 text-xs text-muted-foreground">
          For scale, random valid timetables of this lineup score {Math.round(range.low)} to{" "}
          {Math.round(range.high)}.{verdict ? ` ${verdict}` : ""}
        </p>
      ) : null}
    </div>
  );
}
