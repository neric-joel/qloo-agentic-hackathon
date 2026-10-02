"use client";

import { useId } from "react";
import { Check, CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

import type { NeedsInputOption } from "@/lib/events";

type NeedsInputProps = {
  question: string;
  options: readonly NeedsInputOption[];
  onSelect: (option: NeedsInputOption) => void;
  /** The option already chosen, if any. All options are then disabled. */
  selectedId?: string;
  disabled?: boolean;
  className?: string;
};

/** The agent needs a decision before it can continue. Options are large, tappable chips. */
export function NeedsInput({
  question,
  options,
  onSelect,
  selectedId,
  disabled = false,
  className,
}: NeedsInputProps) {
  const questionId = useId();
  const answered = selectedId !== undefined;
  return (
    <section className={cn("rounded-lg border border-border-strong bg-card p-5", className)}>
      <p className="type-kicker flex items-center gap-1.5 text-muted-foreground">
        <CircleHelp aria-hidden="true" className="size-4" />
        Needs your input
      </p>
      <h3 id={questionId} className="type-title mt-2">
        {question}
      </h3>
      <div role="group" aria-labelledby={questionId} className="mt-4 flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.id === selectedId;
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled || answered}
              onClick={() => onSelect(option)}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-[color,background-color,border-color]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border-strong bg-background text-foreground hover:bg-accent disabled:opacity-50 disabled:hover:bg-background",
              )}
            >
              {selected ? <Check aria-hidden="true" className="size-4" /> : null}
              {option.label}
              {selected ? <span className="sr-only"> (selected)</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
