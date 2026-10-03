"use client";

import { useId } from "react";
import Link from "next/link";
import { FileText, Undo2 } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { currentPlacement } from "@/lib/moves";
import type { Preset } from "@/lib/preset";
import { briefHref, rangeVerdict, shiftText, type Plan, type ScaleRange, type StackMove } from "@/lib/stack";

import { BudgetMove } from "./budget-move";

/** Shown under every plan: what a lower number does and does not mean. */
export const PLAN_CAVEAT =
  "Scored by the same measure the places are found with, so a lower number shows what that measure rewards, not that audiences would be better served. It knows only the rules in the timetable, not an act’s own wishes.";

const VERDICT: Record<"below" | "inside" | "above", string> = {
  below: "This plan scores below that range.",
  inside: "This plan scores inside that range.",
  above: "This plan scores above that range.",
};

/** The plan's actions: undo the last kept move, start over, and open the plan as a brief. */
function PlanActions({
  preset,
  day,
  moves,
  onUndo,
  onStartOver,
}: {
  preset: Preset;
  day: number;
  moves: readonly StackMove[];
  onUndo: () => void;
  onStartOver: () => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-4">
      <Button type="button" variant="outline" onClick={onUndo}>
        <Undo2 aria-hidden="true" />
        Undo last move
      </Button>
      <Button type="button" variant="outline" onClick={onStartOver}>
        Start over
      </Button>
      <Link
        href={briefHref(preset.id, day, moves)}
        className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <FileText aria-hidden="true" className="size-4 shrink-0" />
        Open as a one-page brief
      </Link>
    </div>
  );
}

/**
 * "Your tested moves": the kept moves priced together by the timetable engine. The published
 * reading is Now and the plan's is After; each step shows how it shifts its set and the Clash Budget
 * Index before and after it; then the moved timetable's costliest clashes and the caveat. Every
 * number comes from the server's answer; nothing is computed here, and nothing is applied.
 */
export function ScratchPlan({
  preset,
  day,
  plan,
  moves,
  range,
  onUndo,
  onStartOver,
}: {
  preset: Preset;
  day: number;
  plan: Plan;
  moves: readonly StackMove[];
  range: ScaleRange;
  onUndo: () => void;
  onStartOver: () => void;
}) {
  const headingId = useId();
  const clashesId = useId();
  const { festival } = preset;
  const verdict = rangeVerdict(plan.budget, range);
  const stageName = (stageId: string) => festival.stages.find((stage) => stage.id === stageId)?.name ?? stageId;

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border-strong bg-card p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 id={headingId} className="type-title">
          Your tested moves
        </h3>
        <ProvenanceChip provenance="derived" size="sm" className="mt-1" />
      </div>

      <BudgetMove
        before={plan.publishedBudget}
        after={plan.budget}
        range={range}
        verdict={verdict ? VERDICT[verdict] : null}
      />

      <div className="mt-5 grid gap-6 border-t border-border pt-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-8">
        <ol aria-label="Kept moves" className="min-w-0 space-y-3">
          {plan.steps.map((step, i) => {
            const before = i === 0 ? plan.publishedBudget : plan.steps[i - 1].budgetAfter;
            const home = festival.timetable.find((slot) => slot.act_id === step.actId);
            const shift = shiftText(currentPlacement(preset, step.actId), step, home ? stageName(home.stage_id) : "");
            return (
              <li key={step.actId} className="min-w-0">
                <p className="font-semibold break-words">
                  <span className="tabular-nums">{i + 1}.</span> {step.act} · {step.stage}{" "}
                  <span className="tabular-nums">
                    {step.start}–{step.end}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {shift} ·{" "}
                  <span className="tabular-nums">
                    {before.toFixed(1)} → {step.budgetAfter.toFixed(1)}
                  </span>
                </p>
              </li>
            );
          })}
        </ol>

        <div className="min-w-0 lg:border-l lg:border-border lg:pl-8">
          <h4 id={clashesId} className="type-kicker text-muted-foreground">
            Costliest clashes with these moves
          </h4>
          {plan.clashes.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">None priced.</p>
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

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">{PLAN_CAVEAT}</p>

      <PlanActions preset={preset} day={day} moves={moves} onUndo={onUndo} onStartOver={onStartOver} />
    </section>
  );
}
