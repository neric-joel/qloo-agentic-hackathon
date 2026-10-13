import type { Ref } from "react";

import { Button } from "@/components/ui/button";

import {
  TRIAL_COPY,
  TRIAL_LIMITS,
  raisesSharedTotal,
  sharedEffect,
  sharedRiseLine,
  sizeLine,
  targetId,
  wasPlace,
  type TrialChange,
  type TrialProgress,
  type TrialResult,
  type TrialTarget,
} from "@/lib/check-trial";

/**
 * The check page's ghost text action (toolbar, "Show all rows", the review's take-away actions, "Hide
 * this result"): 14px semibold ink with no fill and no border, 8px sides and a 44px hit area. Hover
 * underlines the text (1px, 4px below); the focus ring stays. A 14px icon may follow the text.
 */
export const TEXT_ACTION =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-semibold whitespace-nowrap text-foreground decoration-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0";

/**
 * Under the size line of a change that moves a set to another stage: a new stage is production's call, not
 * only the programmer's. Plain ink text at medium weight (not small grey text, not a badge). The list puts
 * changes that keep every set on its stage first.
 */
export const STAGE_SIGN_OFF = "Changes stage: needs production sign-off";

/** The sign-off line's classes: ink on card, 14px medium, no fill, border or stripe. */
export const SIGN_OFF_CLASS = "mt-0.5 text-sm font-medium text-foreground";

/**
 * The listed changes (the first five, and any more that keep every set on its stage), split for the panel:
 * those that keep every overlap marked "Kept on purpose", with changes that keep every set on its stage
 * first and then those that change a stage (each group in the engine's order), and apart from them every
 * change that would end a kept overlap. Nothing is dropped.
 */
export function splitChanges(
  result: Pick<TrialResult, "changes" | "sameStageMore">,
  kept: ReadonlySet<string> = new Set(),
): { sameStage: TrialChange[]; stageChange: TrialChange[]; endsKept: TrialChange[] } {
  const all = [...result.changes, ...(result.sameStageMore ?? [])];
  const ending = all.filter((change) => (change.ends ?? []).some((id) => kept.has(id)));
  const endsKept = [...ending.filter((change) => change.stageChanges === 0), ...ending.filter((change) => change.stageChanges > 0)];
  const listed = all.filter((change) => !ending.includes(change));
  return {
    sameStage: listed.filter((change) => change.stageChanges === 0),
    stageChange: listed.filter((change) => change.stageChanges > 0),
    endsKept,
  };
}

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
  /** The grid, curfew, changeover or pair rules were edited after the last check: no search until the next check. */
  stale?: boolean;
  onFind: (target: TrialTarget, label: string) => void;
  onApply: (change: TrialChange) => void;
  onClose: () => void;
  /**
   * The decision ids marked "Kept on purpose". A change that would end one of those overlaps is left out of
   * the list by default and offered only inside a closed fold: opening it is the explicit override.
   */
  kept?: ReadonlySet<string>;
};

function ChangeItem({
  change,
  onApply,
  gloss,
  stale,
  endsKept = false,
}: {
  change: TrialChange;
  onApply: (change: TrialChange) => void;
  /** The grid or settings changed since the last check: nothing is tried until the next one. */
  stale: boolean;
  /** The plain line under "Adds no rule break and makes none larger.", on the first change of a list. */
  gloss: boolean;
  /** This change ends an overlap marked "Kept on purpose" (drawn only inside the closed fold). */
  endsKept?: boolean;
}) {
  const rise = sharedRiseLine(change);
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      {endsKept ? <p className="mb-1 text-sm font-semibold text-foreground">{TRIAL_COPY.endsKept}</p> : null}
      <p className={change.longerThanEnded ? "font-semibold break-words text-warning" : "font-semibold break-words"}>
        {change.tradeOff}
      </p>
      <ul className="mt-2 space-y-1">
        {change.moves.map((move, index) => (
          <li key={move.row} className="break-words">
            <span className="font-semibold">{change.lines[index]}</span>{" "}
            <span className="text-sm text-muted-foreground">(was {wasPlace(move)})</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm font-semibold">{TRIAL_COPY.adds}</p>
      {gloss ? <p className="mt-0.5 text-sm text-muted-foreground">{TRIAL_COPY.addsGloss}</p> : null}
      <p
        className={
          raisesSharedTotal(change)
            ? "mt-0.5 text-sm font-semibold break-words text-warning"
            : "mt-0.5 text-sm break-words text-muted-foreground"
        }
      >
        {sharedEffect(change)}
      </p>
      {rise ? <p className="mt-0.5 text-sm break-words text-warning">{rise}</p> : null}
      <p className="mt-0.5 text-sm text-muted-foreground">{sizeLine(change)}</p>
      {change.stageChanges > 0 ? <p className={SIGN_OFF_CLASS}>{STAGE_SIGN_OFF}</p> : null}
      <Button type="button" variant="outline" size="sm" className="mt-3" disabled={stale} onClick={() => onApply(change)}>
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
  const { sameStage, stageChange, endsKept } = splitChanges(result ?? { changes: [] }, ui.kept);
  const listed = [...sameStage, ...stageChange];
  if (state.running || !result) {
    const progress = state.progress;
    return (
      <p aria-busy="true" className="mt-3 text-sm text-muted-foreground">
        {progress
          ? `Searching ${progress.phase === "one-set" ? "one-set moves" : "two-set changes"}: ${progress.tested.toLocaleString("en-US")} of up to ${TRIAL_LIMITS.candidates.toLocaleString("en-US")} candidates tested.`
          : "Searching."}
      </p>
    );
  }
  return (
    <section className="mt-3 border-t border-border pt-3">
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="scroll-mt-24 text-[0.8125rem] leading-5 font-semibold outline-offset-4"
      >
        {TRIAL_COPY.heading}
      </h3>
      <p className="mt-1.5 break-words">{result.summary}</p>
      {sameStage.length === 0 && stageChange.length > 0 ? (
        <p className="mt-3 text-sm font-medium text-foreground">{TRIAL_COPY.noSameStage}</p>
      ) : null}
      {listed.length > 0 ? (
        <ol className="mt-3 divide-y divide-border border-y border-border py-3">
          {sameStage.map((change, index) => (
            <ChangeItem key={`same-${index}`} change={change} onApply={ui.onApply} gloss={index === 0} stale={ui.stale === true} />
          ))}
          {stageChange.map((change, index) => (
            <ChangeItem
              key={`stage-${index}`}
              change={change}
              onApply={ui.onApply}
              gloss={sameStage.length === 0 && index === 0}
              stale={ui.stale === true}
            />
          ))}
        </ol>
      ) : null}
      {endsKept.length > 0 ? (
        <>
          <p className="mt-3 text-sm leading-relaxed">{TRIAL_COPY.keptLine(endsKept.length, listed.length)}</p>
          <details className="group cc-disclosure mt-2">
            <summary className="cc-disclosure-summary text-sm">
              {TRIAL_COPY.keptSummary(endsKept.length)}
              <span aria-hidden="true" className="cc-disclosure-mark" />
            </summary>
            <ol className="divide-y divide-border pb-3">
              {endsKept.map((change, index) => (
                <ChangeItem
                  key={`kept-${index}`}
                  change={change}
                  onApply={ui.onApply}
                  gloss={false}
                  stale={ui.stale === true}
                  endsKept
                />
              ))}
            </ol>
          </details>
        </>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{TRIAL_COPY.scope}</p>
      <details className="mt-1 text-sm leading-relaxed text-muted-foreground">
        <summary className="min-h-11 cursor-pointer py-2.5 font-semibold text-foreground">{TRIAL_COPY.scopeSummary}</summary>
        <p>{TRIAL_COPY.scopeDetail}</p>
      </details>
      <button
        type="button"
        onClick={ui.onClose}
        className={`${TEXT_ACTION} mt-2 -ml-2`}
      >
        Hide this result
      </button>
    </section>
  );
}

function searchOf(target: TrialTarget, ui: TrialUi): TrialState | null {
  return ui.state && ui.state.targetId === targetId(target) ? ui.state : null;
}

/**
 * "Find a change" for one break or one pair that shares time. It sits on the row's one line of
 * controls, beside the decision buttons, whether or not the finding is decided; its result is drawn
 * under the row by `TrialResult`.
 */
export function TrialButton({ target, label, ui, className }: { target: TrialTarget; label: string; ui: TrialUi; className?: string }) {
  const mine = searchOf(target, ui);
  return (
    <button
      type="button"
      data-find-change=""
      onClick={() => ui.onFind(target, label)}
      disabled={mine?.running === true || ui.stale === true}
      className={className}
    >
      {TRIAL_COPY.button}
      <span className="sr-only">: {label}</span>
    </button>
  );
}

/** The search for this target, under its row, once one has started. Not printed. */
export function TrialResult({
  target,
  ui,
  headingRef,
}: {
  target: TrialTarget;
  ui: TrialUi;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const mine = searchOf(target, ui);
  if (!mine) return null;
  return (
    <div className="print:hidden">
      <TrialPanel state={mine} ui={ui} headingRef={headingRef} />
    </div>
  );
}
