import { formatInteger, formatLatency } from "@/lib/format";
import type { RunSummary as RunSummaryData } from "@/lib/run-state";

/** One-line account of what the run cost: time, Qloo calls and model tokens. */
export function RunSummary({ summary }: { summary: RunSummaryData }) {
  const { elapsedMs, qlooCalls, usage } = summary;
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-4 font-mono text-xs">
      <div>
        <dt className="text-muted-foreground">Elapsed</dt>
        <dd className="mt-1 text-sm font-semibold tabular-nums">{formatLatency(elapsedMs)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Qloo calls</dt>
        <dd className="mt-1 text-sm font-semibold tabular-nums">{formatInteger(qlooCalls)}</dd>
      </div>
      {usage ? (
        <div>
          <dt className="text-muted-foreground">Model tokens</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums">
            {formatInteger(usage.input_tokens)} in / {formatInteger(usage.output_tokens)} out
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
