import { History, type LucideIcon } from "lucide-react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

import type { Provenance } from "@/lib/events";

export const PROVENANCE_META: Record<
  Provenance,
  // Only Recorded carries a glyph (the clock that marks a replay); every other stamp is its word.
  { label: string; description: string; Icon?: LucideIcon }
> = {
  qloo: {
    label: "Qloo",
    description: "A value Qloo returned in a live request.",
  },
  derived: {
    label: "Derived",
    description: "Calculated by this app from Qloo data.",
  },
  llm: {
    label: "LLM",
    description: "Written by a language model. Not Qloo data.",
  },
  recorded: {
    label: "Recorded",
    description: "Replayed from a saved Qloo response, not fetched live.",
    Icon: History,
  },
};

/** What a chip's tooltip says on the invented day, where nothing comes from Qloo; the other two chips keep their words. */
const SYNTHETIC_DESCRIPTION: Partial<Record<Provenance, string>> = {
  derived: "Calculated by this app from invented figures.",
  recorded: "Part of the invented example day, not a saved Qloo response.",
};

export const PROVENANCE_ORDER: readonly Provenance[] = ["qloo", "derived", "llm", "recorded"];

// No stamp and no box: the source prints as a plain 13px/500 word in sentence case, in the sans, like
// a credit line on a running order. Each word takes its provenance ink: Qloo teal on a published day
// (ink on the invented day, which credits nothing to Qloo), Derived ink, LLM and Recorded muted ink,
// told apart by their words and Recorded's 14px clock. Both sizes print the same; the prop stays so
// callers keep their API.
const chipVariants = cva(
  "inline-flex shrink-0 items-center gap-1 align-baseline font-sans text-[13px] leading-none font-medium [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:self-center",
  {
    variants: {
      provenance: {
        qloo: "text-prov-qloo",
        derived: "text-prov-derived",
        llm: "text-prov-llm",
        recorded: "text-prov-recorded",
      },
      size: {
        sm: "",
        md: "",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type ProvenanceChipProps = {
  provenance: Provenance;
  size?: "sm" | "md";
  className?: string;
  /** The invented day: the tooltip says the figure is invented instead of crediting Qloo. */
  synthetic?: boolean;
  /**
   * "tag" (default) prints the word (and Recorded's clock) as plain muted text. "kicker" prints the
   * word alone, to ride on a label line after a middle dot ("Clash Budget Index · Derived"); its
   * tooltip and screen-reader text stay.
   */
  look?: "tag" | "kicker";
};

const KICKER_CLASS = "inline font-sans text-[13px] font-medium tracking-normal text-muted-foreground normal-case";

/** Says where a value came from. Always a text label, never colour alone. */
export function ProvenanceChip({ provenance, size = "md", className, synthetic = false, look = "tag" }: ProvenanceChipProps) {
  const { label, description: saved, Icon } = PROVENANCE_META[provenance];
  const description = (synthetic ? SYNTHETIC_DESCRIPTION[provenance] : undefined) ?? saved;
  if (look === "kicker") {
    return (
      <span className={cn(KICKER_CLASS, className)} title={description} data-provenance={provenance} data-look="kicker">
        <span className="sr-only">Source: </span>
        {label}
      </span>
    );
  }
  return (
    <span
      className={cn(chipVariants({ provenance, size }), synthetic && provenance === "qloo" && "text-foreground", className)}
      title={description}
      data-provenance={provenance}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span className="sr-only">Source: </span>
      {label}
    </span>
  );
}
