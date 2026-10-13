import { Check, LoaderCircle, Minus, Pause, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

import type { StepStatus } from "@/lib/events";
import type { RunStatus, StepState } from "@/lib/run-state";

/** What a step looks like: its own status, or "waiting" when the run has paused around it. */
type StepView = StepStatus | "waiting";

function viewOf(step: StepState, status: RunStatus): StepView {
  return step.status === "running" && status !== "running" ? "waiting" : step.status;
}

const STEP_META: Record<
  StepView,
  { label: string; Icon: LucideIcon; indicator: string; text: string }
> = {
  waiting: {
    label: "Waiting",
    Icon: Pause,
    indicator: "border-border-strong text-muted-foreground",
    text: "text-muted-foreground",
  },
  running: {
    label: "Running",
    Icon: LoaderCircle,
    indicator: "border-foreground text-foreground",
    text: "text-foreground",
  },
  done: {
    label: "Done",
    Icon: Check,
    indicator: "border-success bg-success text-background",
    text: "text-success",
  },
  error: {
    label: "Failed",
    Icon: X,
    indicator: "border-destructive bg-destructive text-primary-foreground",
    text: "text-destructive",
  },
  skipped: {
    label: "Skipped",
    Icon: Minus,
    indicator: "border-dashed border-border-strong text-muted-foreground",
    text: "text-muted-foreground",
  },
};

/**
 * The text a screen reader hears. Derived, so it only changes with the data. While the run is
 * going it speaks when a step settles, not when one starts, to keep the chatter down.
 */
function announcement(
  steps: readonly StepState[],
  status: RunStatus,
  outcome: string | undefined,
): string {
  if (status === "done") return outcome ?? "Run complete.";
  if (status === "error") return "Run failed.";
  if (status === "cancelled") return "Run cancelled.";
  if (status === "awaiting_input") return outcome ?? "Waiting for your answer.";
  const latest = steps.reduce<StepState | undefined>(
    (current, step) =>
      viewOf(step, status) !== "running" && (!current || step.seq > current.seq) ? step : current,
    undefined,
  );
  if (!latest) return status === "running" ? "Run started." : "";
  const detail = latest.detail ? ` ${latest.detail}.` : "";
  return `${latest.label}: ${STEP_META[viewOf(latest, status)].label.toLowerCase()}.${detail}`;
}

type RunStepsProps = {
  steps: readonly StepState[];
  status: RunStatus;
  title?: string;
  /** Shown before the first step arrives. */
  emptyMessage?: string;
  /**
   * Announced instead of the generic "Run complete." or "Waiting for your answer.", for outcomes
   * a screen reader user would otherwise miss: the question being asked, or that the run
   * finished without an answer.
   */
  outcome?: string;
  className?: string;
};

/**
 * Live list of what the run is doing. Each step shows an icon and a text label, and a polite live
 * region announces settled steps and the outcome rather than the whole list.
 */
export function RunSteps({
  steps,
  status,
  title = "Progress",
  emptyMessage = "Steps appear here as the run progresses.",
  outcome,
  className,
}: RunStepsProps) {
  const settled = steps.filter((step) => step.status !== "running").length;
  const starting = steps.length === 0 && status === "running";

  return (
    <section aria-label={title} className={className}>
      <header className="flex items-baseline justify-between gap-3 pb-2">
        <h3 className="text-[0.8125rem] leading-5 font-semibold text-foreground">{title}</h3>
        {steps.length > 0 ? (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {settled} of {steps.length}
          </span>
        ) : null}
      </header>

      {steps.length > 0 ? (
        <ol className="mt-5">
          {steps.map((step, index) => {
            const view = viewOf(step, status);
            const { Icon, label, indicator, text } = STEP_META[view];
            const isLast = index === steps.length - 1;
            return (
              <li
                key={step.id}
                data-status={view}
                className="relative grid animate-in grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-5 duration-300 fade-in slide-in-from-bottom-2 last:pb-0 motion-reduce:animate-none"
              >
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-8 bottom-1 left-[0.8125rem] w-0.5 bg-border"
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-7 place-items-center rounded-full border-2 bg-background",
                    indicator,
                  )}
                >
                  <Icon className={cn("size-4", view === "running" && "motion-safe:animate-spin")} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className="font-semibold break-words">{step.label}</span>
                    <span className={cn("text-[0.8125rem] font-semibold", text)}>{label}</span>
                  </p>
                  {step.detail ? (
                    <p className="mt-0.5 text-sm break-words text-muted-foreground">{step.detail}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-5 flex items-center gap-2.5 text-sm text-muted-foreground">
          {starting ? (
            <>
              <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              Starting the run
            </>
          ) : (
            emptyMessage
          )}
        </p>
      )}

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement(steps, status, outcome)}
      </p>
    </section>
  );
}
