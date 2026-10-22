"use client";

import { useId } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUp, FileText, Undo2 } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { RECORDED_RUN_NOTE, currentPlacement, isFromRecordedRun } from "@/lib/moves";
import type { Preset } from "@/lib/preset";
import { PLAN_CAVEAT, RAISES_MARK, planVerdict, raisesIndex } from "@/lib/plan-copy";
import {
  briefHref,
  isPlanRuleStep,
  isRuleStackStep,
  moveStepReceipt,
  ruleReceipt,
  ruleStepLine,
  shiftText,
  type Plan,
  type ScaleRange,
  type StackMove,
  type StackStep,
} from "@/lib/stack";

import { DECISION_HEADING_ID, IndexChange } from "./decision-card";

/** The plan's actions: undo the last kept step, start over, and open the plan as a brief. */
function PlanActions({
  preset,
  day,
  moves,
  onUndo,
  onStartOver,
  backToDecision = false,
}: {
  preset: Preset;
  day: number;
  moves: readonly StackStep[];
  onUndo: () => void;
  onStartOver: () => void;
  /** The plan came from the decision card: offer the way back to it. */
  backToDecision?: boolean;
}) {
  const last = moves.at(-1);
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-4">
      <Button type="button" variant="outline" onClick={onUndo}>
        <Undo2 aria-hidden="true" />
        {last && isRuleStackStep(last) ? "Undo last change" : "Undo last move"}
      </Button>
      <Button type="button" variant="outline" onClick={onStartOver}>
        Start over
      </Button>
      <Link
        href={briefHref(preset.id, day, moves)}
        className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold underline decoration-border-strong underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <FileText aria-hidden="true" className="size-4 shrink-0" />
        Open as a one-page brief
      </Link>
      {backToDecision ? (
        <a
          href={`#${DECISION_HEADING_ID}`}
          onClick={(event) => {
            // The card is far above this plan on a phone: scroll back to it and put focus on its heading.
            const heading = document.getElementById(DECISION_HEADING_ID);
            if (!heading) return;
            event.preventDefault();
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            heading.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
            heading.focus({ preventScroll: true });
          }}
          className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold underline decoration-border-strong underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowUp aria-hidden="true" className="size-4 shrink-0" />
          Back to the decision
        </a>
      ) : null}
    </div>
  );
}

/**
 * "Your tested moves": the kept steps scored together by the timetable engine. The published
 * reading comes first and the plan's after it, on one index line; a single move shows how it shifts its set, a kept change
 * from "Keep two sets apart" reads as one step (the pair, where each set plays, then the server's
 * receipt for the whole plan); each step shows the Clash Budget Index before and after it; then the
 * moved timetable's costliest clashes and the caveat. Every number comes from the server's answer;
 * nothing is computed here, and nothing is applied.
 */
export function ScratchPlan({
  preset,
  day,
  plan,
  moves,
  range,
  onUndo,
  onStartOver,
  backToDecision = false,
  cardMove = null,
  next = null,
}: {
  preset: Preset;
  day: number;
  plan: Plan;
  moves: readonly StackStep[];
  range: ScaleRange;
  onUndo: () => void;
  onStartOver: () => void;
  backToDecision?: boolean;
  /** The decision card's move and its receipt, for a plan that is just that move. */
  cardMove?: { move: StackMove; receipt: string } | null;
  /** The next clash in the published day's ranking and the press that opens it in Try a move; null for none. */
  next?: { label: string; onPress: () => void } | null;
}) {
  const headingId = useId();
  const clashesId = useId();
  const { festival } = preset;
  const verdict = planVerdict(plan.budget, plan.publishedBudget, range);
  const singleReceipt = moveStepReceipt(moves, cardMove);
  const stageName = (stageId: string) => festival.stages.find((stage) => stage.id === stageId)?.name ?? stageId;

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-surface-edge bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 id={headingId} className="type-title">
          Your tested moves
        </h3>
        <ProvenanceChip provenance="derived" size="sm" className="mt-1" synthetic={preset.synthetic === true} />
      </div>

      <IndexChange before={plan.publishedBudget} after={plan.budget} range={range} verdict={verdict} />

      <div className="mt-5 grid gap-6 border-t border-border pt-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-8">
        <ol aria-label="Kept moves" className="min-w-0 space-y-3">
          {plan.steps.map((step, i) => {
            const before = i === 0 ? plan.publishedBudget : plan.steps[i - 1].budgetAfter;
            if (isPlanRuleStep(step)) {
              return (
                <li key={`rule-${i}-${step.moves.map((move) => move.actId).join("+")}`} className="min-w-0">
                  <p className="font-semibold break-words">
                    <span className="tabular-nums">{i + 1}.</span> {ruleStepLine(step)}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    <span className="tabular-nums">
                      {before.toFixed(1)} → {step.budgetAfter.toFixed(1)}
                    </span>
                    {raisesIndex(before, step.budgetAfter) ? RAISES_MARK : null}
                  </p>
                  <p className="mt-0.5 text-sm">{ruleReceipt(step)}</p>
                </li>
              );
            }
            const home = festival.timetable.find((slot) => slot.act_id === step.actId);
            // A move kept through a recorded agent run's Keep this move says so after it.
            const fromRun = moves.some((kept) => !isRuleStackStep(kept) && kept.actId === step.actId && isFromRecordedRun(kept));
            const shift = shiftText(currentPlacement(preset, step.actId), step, home ? stageName(home.stage_id) : "");
            return (
              <li key={step.actId} className="min-w-0">
                <p className="font-semibold break-words">
                  <span className="tabular-nums">{i + 1}.</span> {step.act} · {step.stage}{" "}
                  <span className="tabular-nums">
                    {step.start}–{step.end}
                  </span>
                  {fromRun ? <span className="font-normal text-muted-foreground"> {RECORDED_RUN_NOTE}</span> : null}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {shift} ·{" "}
                  <span className="tabular-nums">
                    {before.toFixed(1)} → {step.budgetAfter.toFixed(1)}
                  </span>
                  {raisesIndex(before, step.budgetAfter) ? RAISES_MARK : null}
                </p>
                {singleReceipt && i === 0 ? <p className="mt-0.5 text-sm">{singleReceipt}</p> : null}
              </li>
            );
          })}
        </ol>

        <div className="min-w-0 lg:border-l lg:border-border lg:pl-8">
          <h4 id={clashesId} className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
            Costliest clashes with these moves
          </h4>
          {plan.clashes.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">None scored.</p>
          ) : (
            <ul aria-labelledby={clashesId} className="mt-1.5 space-y-1 text-sm">
              {plan.clashes.map((clash) => (
                <li key={`${clash.a}|${clash.b}`} className="break-words">
                  {clash.a} and {clash.b} · <span className="tabular-nums">{clash.points.toFixed(1)}</span> index
                  points
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground lg:text-[0.8125rem]">{PLAN_CAVEAT}</p>

      {next ? (
        // One way on from the plan: the next clash in the published day's ranking, opened in Try a move.
        <div className="mt-4">
          <Button type="button" variant="ruled" className="text-left whitespace-normal" onClick={next.onPress}>
            {next.label}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      <PlanActions
        preset={preset}
        day={day}
        moves={moves}
        onUndo={onUndo}
        onStartOver={onStartOver}
        backToDecision={backToDecision}
      />
    </section>
  );
}
