import { ProvenanceChip } from "@/components/kernel/provenance-chip";
import { COUNTS_ONLY } from "@/lib/credit";
import type { ServerSummary } from "@/lib/server-summary";

/*
 * The first page's figures in the server HTML, shown until the interactive page has loaded the same
 * day: the index with its sentence, the five costliest clashes and where the prices come from. Same
 * visual language as the dial and the clash list; no tags, ids or raw popularity.
 */

/**
 * In place of the dial while the day loads, open on the paper as the loaded Index is: no box, one 1px
 * hairline rule at its top, 20px over the label (24px from 640px). From 1280px it takes the loaded
 * rail's measure too (its rule 4px wider than the column either side, its text 12px in), so the rule
 * and the label sit where the loaded ones do.
 */
export function SummaryScore({ summary }: { summary: ServerSummary }) {
  return (
    <div className="border-t border-border pt-5 sm:pt-6 xl:-mx-1 xl:px-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Clash Budget Index</p>
        <ProvenanceChip provenance="derived" size="sm" synthetic={summary.synthetic} />
      </div>
      {summary.index !== null ? (
        <div className="mt-3">
          <p className="type-numeral text-6xl leading-none sm:text-7xl">{summary.index}</p>
          <p className="mt-2 text-sm leading-snug font-semibold">{summary.vsRandom}.</p>
          <p className="text-sm leading-snug text-muted-foreground">Lower is better.</p>
        </div>
      ) : (
        <p className="type-title mt-3">No index for this day</p>
      )}
      <p className="mt-4 text-sm leading-relaxed font-medium">
        {summary.title}. 100 = the average random valid timetable of this lineup. {COUNTS_ONLY}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{summary.evidence}</p>
    </div>
  );
}

/** In place of the clash list and timetable while the day loads. */
export function SummaryBoard({ summary }: { summary: ServerSummary }) {
  return (
    <section aria-labelledby="summary-clashes-heading" className="max-w-2xl">
      <div className="pb-3">
        <h2 id="summary-clashes-heading" className="text-[0.9375rem] leading-snug font-semibold">
          {summary.title}:{" "}
          {summary.clashes.length === 1 ? "the costliest clash" : `the ${summary.clashes.length} costliest clashes`}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {summary.synthetic
            ? "Draw and taste overlap are invented figures for an invented day, each out of 100 on this bill. No Qloo data is behind them."
            : "Draw is Qloo popularity; taste overlap is a rank out of 100 on this bill, derived from Qloo data. It is not attendance."}
        </p>
      </div>
      {summary.clashes.length === 0 ? (
        <p className="mt-4 rounded-md border border-dotted border-border-strong p-4 text-sm text-muted-foreground">
          {summary.synthetic
            ? "No priced clashes on this day: no two priced acts play at the same time."
            : "No priced clashes on this day: no two acts with a Qloo signal play at the same time."}
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {summary.clashes.map((clash) => (
            <li key={`${clash.rank}-${clash.a}-${clash.b}`} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 py-3 pl-1">
              <span className="type-numeral pt-0.5 text-right text-3xl leading-none tabular-nums">
                <span className="sr-only">Clash </span>
                {clash.rank}
              </span>
              <span className="min-w-0">
                <span className="block font-bold leading-snug">
                  {clash.a}
                  <span aria-hidden="true" className="px-1 font-normal text-muted-foreground">
                    &times;
                  </span>
                  <span className="sr-only"> and </span>
                  {clash.b}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-xs tabular-nums">
                  <span>
                    <span className="text-muted-foreground">Taste overlap </span>
                    {clash.taste}
                  </span>
                  <span>
                    <span className="text-muted-foreground">Draw </span>
                    {clash.draw}
                  </span>
                  <span>
                    {clash.share}
                    <span className="text-muted-foreground"> of the day&rsquo;s clash cost</span>
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
