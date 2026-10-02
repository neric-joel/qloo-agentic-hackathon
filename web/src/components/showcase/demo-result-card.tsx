import { cn } from "@/lib/utils";

import { ProvenanceChip } from "@/components/kernel/provenance-chip";
import type { MockSummaryData } from "@/lib/mock-stream";

/**
 * Showcase-only result card for the `summary` result kind. Every figure carries its provenance
 * chip, and the ticket perforation is the visual motif later screens can reuse.
 */
export function DemoResultCard({
  data,
  className,
}: {
  data: MockSummaryData;
  className?: string;
}) {
  const { title, headline, rows, footnote } = data;
  return (
    <article
      className={cn("rounded-xl border border-border bg-card shadow-sm", className)}
      aria-label={title}
    >
      <div className="p-5 sm:p-6">
        <p className="type-kicker text-muted-foreground">{title}</p>
        <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3">
          <p className="type-numeral text-7xl leading-[0.85] sm:text-8xl">{headline.value}</p>
          <div className="min-w-0 pb-1">
            <p className="text-lg leading-tight font-bold">{headline.label}</p>
            <ProvenanceChip provenance={headline.provenance} size="sm" className="mt-2" />
          </div>
        </div>
        {headline.note ? (
          <p className="mt-4 max-w-prose text-sm text-muted-foreground">{headline.note}</p>
        ) : null}
      </div>

      <div className="ticket-perforation" aria-hidden="true" />

      {rows.length > 0 ? (
        <ul className="divide-y divide-border">
          {rows.map((row, index) => (
            <li
              key={`${row.label}-${index}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6"
            >
              <span className="min-w-0 font-semibold break-words">{row.label}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className="text-sm tabular-nums">{row.value}</span>
                <ProvenanceChip provenance={row.provenance} size="sm" />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {footnote ? (
        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-6">
          {footnote}
        </p>
      ) : null}
    </article>
  );
}
