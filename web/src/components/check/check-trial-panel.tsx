import type { Ref } from "react";

import { Button } from "@/components/ui/button";
import {
  TRIAL_COPY,
  TRIAL_LIMITS,
  sharedEffect,
  sizeLine,
  targetId,
  wasPlace,
  type TrialChange,
  type TrialProgress,
  type TrialResult,
  type TrialTarget,
} from "@/lib/check-trial";

/** What the page keeps of one search: the target it was for, how far it has got and, once done, the result. */
export type TrialState = {
  targetId: string;
  /** What the polite live region names the search by (the break's sentence or the pair). */
  label: string;
  running: boolean;
  progress: TrialProgress | null;
  result: TrialResult | null;
};

export type TrialUi = {
  state: TrialState | null;
  onFind: (target: TrialTarget, label: string) => void;
  onApply: (change: TrialChange) => void;
  onClose: () => void;
};

function ChangeItem({ change, onApply }: { change: TrialChange; onApply: (change: TrialChange) => void }) {
  return (
    <li className="rounded-md border border-border bg-card p-3">
      <ul className="space-y-1">
        {change.moves.map((move, index) => (
          <li key={move.row} className="break-words">
            <span className="font-semibold">{change.lines[index]}</span>{" "}
            <span className="text-sm text-muted-foreground">(was {wasPlace(move)})</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm font-semibold">{TRIAL_COPY.adds}</p>
      <p className="mt-0.5 text-sm break-words text-muted-foreground">{sharedEffect(change)}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{sizeLine(change)}</p>
      <Button type="button" variant="outline" className="mt-3" onClick={() => onApply(change)}>
        {TRIAL_COPY.tryIt}
        <span className="sr-only">: {change.lines.join(" and ")}</span>
      </Button>
    </li>
  );
}

/** The result of one search, under the break or the pair it was for. Not printed. */
function TrialPanel({
  state,
  ui,
  headingRef,
}: {
  state: TrialState;
  ui: TrialUi;
  /** The result heading, which takes focus when a search ends. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { result } = state;
  if (state.running || !result) {
    const progress = state.progress;
    return (
      <p aria-busy="true" className="mt-3 text-sm text-muted-foreground">
        {progress
          ? `Searching ${progress.phase === "one-set" ? "one-set moves" : "two-set swaps"}: ${progress.tested.toLocaleString("en-US")} of up to ${TRIAL_LIMITS.candidates.toLocaleString("en-US")} candidates tested.`
          : "Searching."}
      </p>
    );
  }
  return (
    <section className="mt-3 rounded-md border border-border bg-muted p-3 sm:p-4">
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="type-kicker scroll-mt-24 outline-offset-4"
      >
        {TRIAL_COPY.heading}
      </h3>
      <p className="mt-1.5 break-words">{result.summary}</p>
      {result.changes.length > 0 ? (
        <ol className="mt-3 space-y-3">
          {result.changes.map((change, index) => (
            <ChangeItem key={index} change={change} onApply={ui.onApply} />
          ))}
        </ol>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{TRIAL_COPY.scope}</p>
      <button
        type="button"
        onClick={ui.onClose}
        className="mt-2 min-h-11 rounded-md border border-border-strong px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Hide this result
      </button>
    </section>
  );
}

/** "Find a change" for one break or one pair that shares time, with its result below once there is one. */
export function TrialControl({
  target,
  label,
  ui,
  headingRef,
}: {
  target: TrialTarget;
  label: string;
  ui: TrialUi;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const mine = ui.state && ui.state.targetId === targetId(target) ? ui.state : null;
  return (
    <div className="mt-2 print:hidden">
      <button
        type="button"
        onClick={() => ui.onFind(target, label)}
        disabled={mine?.running === true}
        className="min-h-11 rounded-md border border-border-strong px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
      >
        {TRIAL_COPY.button}
        <span className="sr-only">: {label}</span>
      </button>
      {mine ? <TrialPanel state={mine} ui={ui} headingRef={headingRef} /> : null}
    </div>
  );
}
