import type { ReactNode } from "react";
import { History, Play } from "lucide-react";

import { RecordedBadge } from "@/components/kernel";
import type { RecordedRun } from "@/lib/recorded-run";

/** Where the recorded runs sit on the page, for links that point at them. */
export const RECORDED_RUNS_ID = "agent-recordings";

/**
 * "Watch a recorded run": real agent runs on this festival day, saved as they streamed, with the request ids
 * of any Qloo calls they made.
 * Each button replays one in the panel; nothing is sent anywhere.
 */
export function RecordedRuns({
  runs,
  onPlay,
  heading = "Watch a recorded run",
  disabled = false,
  className,
}: {
  runs: readonly RecordedRun[];
  onPlay: (run: RecordedRun) => void;
  heading?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  if (runs.length === 0) return null;
  return (
    <div id={RECORDED_RUNS_ID} className={className}>
      <p className="type-kicker flex items-center gap-2 text-muted-foreground">
        <History aria-hidden="true" className="size-3.5" />
        {heading}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Real agent runs on this festival day, saved as they streamed, with the request ids of any Qloo
        calls they made. Replaying one makes no live call.
      </p>
      <ul className="mt-3 grid gap-2">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPlay(run)}
              className="group grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border border-dashed border-prov-recorded-border bg-card px-3.5 py-3 text-left transition-colors hover:bg-prov-recorded-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 grid size-7 place-items-center rounded-full border border-prov-recorded-border text-prov-recorded group-hover:bg-card"
              >
                <Play className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{run.title}</span>
                <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{run.question}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Says, above a replayed answer, that it is a saved run and that nothing was fetched just now. */
export function RecordedNotice({ capturedAt, className }: { capturedAt: string; className?: string }) {
  return (
    <RecordedBadge capturedAt={capturedAt || undefined} className={className}>
      A real agent run, replayed from a saved stream. The steps, figures and any Qloo request ids
      are the ones recorded; nothing here was fetched just now.
    </RecordedBadge>
  );
}
