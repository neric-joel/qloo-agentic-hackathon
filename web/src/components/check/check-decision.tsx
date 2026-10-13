"use client";

import { useState } from "react";

import {
  DECISION_COPY,
  DECISION_REASONS,
  NOTE_CHARS,
  STATUS_LABEL,
  cleanNote,
  decisionBadge,
  decisionLine,
  type Decision,
  type DecisionReason,
  type DecisionStatus,
} from "@/lib/check-decisions";
import { cn } from "@/lib/utils";

/** A change to one decision; null clears it. */
export type DecisionPatch = { status?: DecisionStatus; reason?: DecisionReason | null; note?: string } | null;

export type DecideFn = (id: string, label: string, patch: DecisionPatch) => void;

/** The row's buttons: the two decisions, Edit and Find a change share these sizes so they sit on one line. */
export const ROW_BUTTON =
  "inline-flex min-h-10 items-center rounded-md border border-border-strong px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
const TOGGLE = `${ROW_BUTTON} aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background`;
const CHIP =
  "min-h-9 rounded-md border border-border-strong px-3 text-xs font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background";

const CHOICES: readonly Exclude<DecisionStatus, "changed">[] = ["kept", "not-changing"];

/**
 * "Kept on purpose" and "Not changing" for one break or pair (pressed again to clear). "Changed" is
 * set by a change tried on the working copy, not here, so a changed finding shows a line instead.
 */
export function DecisionToggles({
  id,
  label,
  name,
  decision,
  onDecide,
}: {
  id: string;
  /** What the decision is about, kept with it for the list. */
  label: string;
  /** The short name assistive tech hears after each button. */
  name: string;
  decision: Decision | undefined;
  onDecide: DecideFn;
}) {
  const status = decision?.status ?? null;
  if (status === "changed") return <p className="self-center text-sm font-semibold">{DECISION_COPY.changedHere}</p>;
  return (
    <div
      role="group"
      aria-label={`Your decision: ${name}`}
      className="grid basis-full grid-cols-2 gap-2 sm:flex sm:basis-auto sm:flex-nowrap"
    >
      {CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          aria-pressed={status === choice}
          onClick={() => onDecide(id, label, status === choice ? null : { status: choice })}
          className={cn(TOGGLE, "max-sm:justify-center max-sm:py-1.5 max-sm:text-center")}
        >
          {STATUS_LABEL[choice]}
          <span className="sr-only">: {name}</span>
        </button>
      ))}
    </div>
  );
}

/** The optional reason and note of a decision: under its row while open, and in "Your decisions". */
export function DecisionEditor({
  decision,
  name,
  onDecide,
}: {
  decision: Decision;
  name: string;
  onDecide: DecideFn;
}) {
  const { id, label } = decision;
  return (
    <div className="space-y-2">
      <div role="group" aria-label={`${DECISION_COPY.reason}: ${name}`} className="flex flex-wrap gap-1.5">
        {DECISION_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            aria-pressed={decision.reason === reason}
            onClick={() => onDecide(id, label, { reason: decision.reason === reason ? null : reason })}
            className={CHIP}
          >
            {reason}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={decision.note}
        maxLength={NOTE_CHARS}
        onChange={(event) => onDecide(id, label, { note: cleanNote(event.target.value) })}
        placeholder={DECISION_COPY.note}
        aria-label={`${DECISION_COPY.note}: ${name}`}
        autoComplete="off"
        className="h-10 w-full max-w-md min-w-0 rounded-md border border-border-strong bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
    </div>
  );
}

/** "KEPT ON PURPOSE · CONTRACT" as the house stamp, its ink coloured by status (no fill). */
export function DecisionBadge({ decision, className }: { decision: Decision; className?: string }) {
  return (
    <span
      className={cn(
        "tag",
        // The words carry the status: green is for a lower index or a finished step, vermilion for a cost.
        decision.status === "kept" && "text-foreground",
        decision.status === "not-changing" && "text-muted-foreground",
        decision.status === "changed" && "text-foreground",
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {decisionBadge(decision)}
    </span>
  );
}

/**
 * "Your decisions": every decision in the order made, each with its reason and note editable here. A
 * "Changed" decision lives on after the change ends its finding, so this is where its reason is given;
 * every edit reaches the printed brief.
 */
export function DecisionList({
  decisions,
  onDecide,
  defaultOpen = null,
}: {
  decisions: readonly Decision[];
  onDecide: DecideFn;
  /** The entry whose editor starts open (the server-rendered tests open one). */
  defaultOpen?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(defaultOpen);
  return (
    <ul className="mt-3 divide-y divide-border">
      {decisions.map((decision) => {
        const shown = open === decision.id;
        const name = decision.label.replace(/\.$/, "");
        return (
          <li key={decision.id} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <DecisionBadge decision={decision} className="mt-0.5" />
              <p className="min-w-0 flex-[1_1_14rem] text-sm break-words">{decisionLine(decision)}</p>
              <button
                type="button"
                aria-expanded={shown}
                onClick={() => setOpen(shown ? null : decision.id)}
                className={ROW_BUTTON}
              >
                {shown ? "Done" : decision.reason || decision.note ? "Edit reason" : "Add a reason"}
                <span className="sr-only">: {name}</span>
              </button>
            </div>
            {shown ? (
              <div className="mt-2.5 rounded-md bg-background p-3">
                <DecisionEditor decision={decision} name={name} onDecide={onDecide} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
