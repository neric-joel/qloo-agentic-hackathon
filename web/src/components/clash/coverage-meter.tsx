import { cn } from "@/lib/utils";

import { formatPercent } from "@/lib/clashes";
import { coverageAll, coverageHeading, coverageNone, coverageUnscored } from "@/lib/credit";
import { pluralize } from "@/lib/format";
import type { CoverageSummary, ScheduleMetrics } from "@/lib/preset";

type CoverageMeterProps = {
  coverage: CoverageSummary;
  metrics: ScheduleMetrics;
  /** The invented day: nothing here credits Qloo. */
  synthetic?: boolean;
  className?: string;
};

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * How much of the lineup Qloo could speak for, as one compact strip. Acts without a signal are
 * named and left out of every price; they are never counted as zero taste overlap.
 */
export function CoverageMeter({ coverage, metrics, synthetic = false, className }: CoverageMeterProps) {
  const total = coverage.strong + coverage.weak + coverage.none;
  const segments = [
    { key: "strong", count: coverage.strong, label: "strong signal", className: "bg-foreground" },
    {
      key: "weak",
      count: coverage.weak,
      label: "weak signal",
      className: "bg-[repeating-linear-gradient(90deg,var(--foreground)_0_2px,transparent_2px_4px)]",
    },
    { key: "none", count: coverage.none, label: coverageNone(synthetic), className: "bg-hatch bg-card" },
  ].filter((segment) => segment.count > 0);
  const breakdown = segments.map((segment) => `${segment.count} ${segment.label}`).join(", ");
  const unscored = coverage.unscored.map((item) => item.name);

  return (
    <section aria-labelledby="coverage-heading" className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 id="coverage-heading" className="type-kicker text-muted-foreground">
          {coverageHeading(synthetic)}
        </h3>
        <p className="flex items-baseline gap-1.5">
          <span className="type-numeral text-2xl leading-none">{formatPercent(coverage.scored_share)}</span>
          <span className="text-sm text-muted-foreground">
            of acts priced ({coverage.scored_acts} of {total})
          </span>
        </p>
        <div
          role="img"
          aria-label={breakdown}
          title={breakdown}
          className="flex h-2.5 w-40 overflow-hidden rounded-full border border-border-strong"
        >
          {segments.map((segment) => (
            <span
              key={segment.key}
              className={cn("h-full border-r border-border-strong last:border-r-0", segment.className)}
              style={{ width: `${(segment.count / Math.max(total, 1)) * 100}%` }}
            />
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {unscored.length > 0 ? (
          <>
            <strong className="font-semibold text-foreground">Left out, not scored as zero:</strong>{" "}
            {joinNames(unscored)} ({coverageUnscored(synthetic)})
            {metrics.unscored_concurrent_pairs > 0
              ? `. ${pluralize(metrics.unscored_concurrent_pairs, "overlapping pair")} could not be priced`
              : ""}
            {coverage.weak > 0 ? `. ${pluralize(coverage.weak, "act")} with a weak signal` : ""}.
          </>
        ) : (
          <>{coverageAll(synthetic)}{coverage.weak > 0 ? `; ${coverage.weak} weak` : ""}.</>
        )}
      </p>
    </section>
  );
}
