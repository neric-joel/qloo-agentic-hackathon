"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

import { coverageAll, coverageHeading, coverageNone } from "@/lib/credit";
import { pluralize } from "@/lib/format";
import type { CoverageSummary, ScheduleMetrics } from "@/lib/preset";

type CoverageMeterProps = {
  coverage: CoverageSummary;
  metrics: ScheduleMetrics;
  /** The invented day: nothing here credits Qloo. */
  synthetic?: boolean;
  /**
   * The board's key (`<TimetableLegend inline />`), in two deliberate rows: coverage at the left and
   * "How to read the board" at the right end of the first, the key alone 8px under it.
   */
  legend?: ReactNode;
  className?: string;
};

/**
 * Why the named acts are left out, and where they are on the board. The no-signal tiles are the sheet in a
 * 1px dotted edge, labelled with the words, and carry no hatch (the hatch marks shared time only).
 */
function unscoredNote(synthetic: boolean): string {
  return synthetic ? "no usable signal; dotted edge on the board" : "no usable Qloo signal; dotted edge on the board";
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The board's quiet text toggle: underlined words, no plus row. */
export const TEXT_TOGGLE_CLASS =
  "inline-flex items-center rounded-sm text-sm text-foreground underline decoration-border-strong decoration-1 underline-offset-[3px] hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:min-h-11";

/**
 * How much of the lineup Qloo could speak for, as one sentence over the board: the label, then
 * "36 of 39 acts scored · 3 left out, not scored as zero", where the second part is the one link, an
 * underlined toggle. They are left out of every price
 * and never counted as zero taste overlap; the toggle's panel names them and gives the strong, weak
 * and no-signal breakdown. The panel is in the HTML either way (and prints), so it never depends on
 * script.
 */
export function CoverageMeter({ coverage, metrics, synthetic = false, legend, className }: CoverageMeterProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const total = coverage.strong + coverage.weak + coverage.none;
  const breakdown = [
    { count: coverage.strong, label: "strong signal" },
    { count: coverage.weak, label: "weak signal" },
    { count: coverage.none, label: coverageNone(synthetic) },
  ]
    .filter((segment) => segment.count > 0)
    .map((segment) => `${segment.count} ${segment.label}`)
    .join(", ");
  const unscored = coverage.unscored.map((item) => item.name);

  return (
    <section aria-labelledby="coverage-heading" className={cn("min-w-0", className)}>
      <div className="flex min-h-9 flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 id="coverage-heading" className="text-[0.8125rem] leading-5 font-semibold">
            {coverageHeading(synthetic)}
          </h3>
          {/* The share scored, as a 64 x 6px meter: teal on a published day (the coverage is Qloo's), ink
              on the invented day, on a muted track. The sentence beside it carries the figures. */}
          <span aria-hidden="true" className="relative block h-1.5 w-16 shrink-0 overflow-hidden rounded-bar bg-muted">
            <span
              data-coverage-fill=""
              className={cn("absolute inset-y-0 left-0 rounded-bar", synthetic ? "bg-foreground" : "bg-prov-qloo")}
              style={{ width: `${Math.round((coverage.scored_acts / Math.max(total, 1)) * 1000) / 10}%` }}
            />
          </span>
          <p className="text-sm">
            <span className="font-mono tabular-nums">{coverage.scored_acts}</span> of{" "}
            <span className="font-mono tabular-nums">{total}</span> acts scored
            {unscored.length > 0 ? (
              <>
                {" "}
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>{" "}
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpen((value) => !value)}
                  className={TEXT_TOGGLE_CLASS}
                >
                  <span className="font-mono tabular-nums">{unscored.length}</span>&nbsp;left out, not scored as zero
                </button>
              </>
            ) : (
              <span className="text-[0.8125rem] text-muted-foreground">
                {" "}
                · {coverageAll(synthetic)}
                {coverage.weak > 0 ? `; ${coverage.weak} weak` : ""}.
              </span>
            )}
          </p>
        </div>
        {legend}
      </div>
      {unscored.length > 0 ? (
        <p
          id={panelId}
          className={cn("mt-2 max-w-prose text-[0.8125rem] leading-relaxed print:block", open ? "block" : "hidden")}
        >
          {joinNames(unscored)} ({unscoredNote(synthetic)})
          {metrics.unscored_concurrent_pairs > 0
            ? `. ${pluralize(metrics.unscored_concurrent_pairs, "overlapping pair")} could not be scored`
            : ""}
          {coverage.weak > 0 ? `. ${pluralize(coverage.weak, "act")} with a weak signal` : ""}. Of the{" "}
          {total} acts: {breakdown}.
        </p>
      ) : null}
    </section>
  );
}
