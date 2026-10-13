import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import { RecordedBadge } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import type { RecordedRun } from "@/lib/recorded-run";
import { cn } from "@/lib/utils";

/** Where the recorded runs sit on the page, for links that point at them. */
export const RECORDED_RUNS_ID = "agent-recordings";

const DESCRIPTION =
  "Real agent runs on this festival day, saved as they streamed, with the request ids of any Qloo calls they made. Replaying one makes no live call.";

/**
 * "Watch a recorded run": real agent runs on this festival day, saved as they streamed, with the request ids
 * of any Qloo calls they made.
 * A transcript list (an ordered list, with no printed numbers): each row prints the full prompt, and its Replay plays the run in the panel;
 * nothing is sent anywhere.
 */
export function RecordedRuns({
  runs,
  onPlay,
  heading = "Watch a recorded run",
  description = DESCRIPTION,
  disabled = false,
  className,
}: {
  runs: readonly RecordedRun[];
  onPlay: (run: RecordedRun) => void;
  /** The label above the runs; null leaves it out where the line before already says it. */
  heading?: ReactNode;
  /** The line under the heading; null leaves it out where the page already says it (the agent-off heading). */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  if (runs.length === 0) return null;
  return (
    <div id={RECORDED_RUNS_ID} className={className}>
      {heading ? <p className="max-w-prose text-[0.8125rem] leading-5 font-semibold text-muted-foreground">{heading}</p> : null}
      {description ? <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{description}</p> : null}
      <ol
        aria-label="Recorded runs"
        className={cn("border-b border-border", (heading || description) && "mt-3")}
      >
        {runs.map((run) => (
          <li
            key={run.id}
            className="grid grid-cols-[minmax(0,1fr)] gap-x-6 border-t border-border py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline"
          >
            <div className="min-w-0">
              <p className="text-[0.9375rem] leading-relaxed break-words">{run.question}</p>
              <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{run.title}</p>
            </div>
            <Button
              type="button"
              variant="ruled"
              disabled={disabled}
              onClick={() => onPlay(run)}
              className="mt-1 justify-self-start sm:mt-0"
            >
              Replay
              <span className="sr-only"> the recorded run: {run.title}</span>
              <ArrowRight aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
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
