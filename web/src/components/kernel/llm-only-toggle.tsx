"use client";

import { Sparkles, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";

import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";

/** Which answer a screen is showing: the Qloo-backed run or the model-only baseline. */
export type AnswerSource = "qloo" | "llm-only";

const OPTIONS: readonly SegmentedOption<AnswerSource>[] = [
  {
    value: "qloo",
    label: "With Qloo",
    icon: <Waypoints aria-hidden="true" />,
    description: "The answer built from Qloo audience data.",
  },
  {
    value: "llm-only",
    label: "LLM only",
    icon: <Sparkles aria-hidden="true" />,
    description: "The same task answered without Qloo.",
  },
];

const EXPLANATION: Record<AnswerSource, string> = {
  qloo: "Built from Qloo audience data.",
  "llm-only": "The same task answered by a language model alone, then graded against Qloo data.",
};

type LlmOnlyToggleProps = {
  value: AnswerSource;
  onValueChange: (value: AnswerSource) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Scaffold for the with/without-Qloo comparison. It only holds the choice and explains it; the
 * screen decides what to render for each side (the baseline comes from `/api/baseline/llm-only`).
 */
export function LlmOnlyToggle({ value, onValueChange, disabled, className }: LlmOnlyToggleProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <SegmentedControl
        label="Answer source"
        value={value}
        onValueChange={onValueChange}
        options={OPTIONS}
        disabled={disabled}
      />
      <p className="max-w-prose text-sm text-muted-foreground">{EXPLANATION[value]}</p>
    </div>
  );
}
