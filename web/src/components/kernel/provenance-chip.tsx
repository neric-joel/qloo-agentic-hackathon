import { History, Sigma, Sparkles, Waypoints, type LucideIcon } from "lucide-react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

import type { Provenance } from "@/lib/events";

export const PROVENANCE_META: Record<
  Provenance,
  { label: string; description: string; Icon: LucideIcon }
> = {
  qloo: {
    label: "Qloo",
    description: "A value Qloo returned in a live request.",
    Icon: Waypoints,
  },
  derived: {
    label: "Derived",
    description: "Calculated by this app from Qloo data.",
    Icon: Sigma,
  },
  llm: {
    label: "LLM",
    description: "Written by a language model. Not Qloo data.",
    Icon: Sparkles,
  },
  recorded: {
    label: "Recorded",
    description: "Replayed from a saved Qloo response, not fetched live.",
    Icon: History,
  },
};

export const PROVENANCE_ORDER: readonly Provenance[] = ["qloo", "derived", "llm", "recorded"];

const chipVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-full border align-middle font-semibold leading-none whitespace-nowrap",
  {
    variants: {
      provenance: {
        qloo: "border-prov-qloo-border bg-prov-qloo-bg text-prov-qloo",
        derived: "border-prov-derived-border bg-prov-derived-bg text-prov-derived",
        llm: "border-prov-llm-border bg-prov-llm-bg text-prov-llm",
        // Dashed outline: recorded values read differently from live ones even in greyscale.
        recorded: "border-dashed border-prov-recorded-border bg-prov-recorded-bg text-prov-recorded",
      },
      size: {
        sm: "h-5 px-2 text-xs [&_svg]:size-3",
        md: "h-6 px-2.5 text-[0.8125rem] [&_svg]:size-3.5",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type ProvenanceChipProps = {
  provenance: Provenance;
  size?: "sm" | "md";
  className?: string;
};

/** Says where a value came from. Always an icon plus a text label, never colour alone. */
export function ProvenanceChip({ provenance, size = "md", className }: ProvenanceChipProps) {
  const { label, description, Icon } = PROVENANCE_META[provenance];
  return (
    <span
      className={cn(chipVariants({ provenance, size }), className)}
      title={description}
      data-provenance={provenance}
    >
      <Icon aria-hidden="true" />
      <span className="sr-only">Source: </span>
      {label}
    </span>
  );
}
