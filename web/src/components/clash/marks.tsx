import { cn } from "@/lib/utils";

import { LABEL_META } from "@/lib/clashes";
import type { ClashLabel } from "@/lib/preset";

/** The hidden-clash mark: a diamond, so it differs from a plain clash by shape as well as colour. */
export function DiamondGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" className={cn("size-3", className)}>
      <path d="M6 0.8 11.2 6 6 11.2 0.8 6Z" fill="var(--highlight)" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

const pill =
  "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs leading-none font-semibold whitespace-nowrap";

export function LabelBadge({ label, className }: { label: ClashLabel; className?: string }) {
  const meta = LABEL_META[label];
  return (
    <span
      className={cn(
        pill,
        label === "hidden"
          ? "border-foreground bg-highlight text-highlight-foreground"
          : "border-dashed border-border-strong bg-muted text-foreground",
        className,
      )}
      title={meta.explain}
    >
      {label === "hidden" ? <DiamondGlyph className="size-2.5" /> : null}
      {meta.name}
    </span>
  );
}

/** A labelled 0..1 bar. The figure is always printed next to it, so the bar is never the only cue. */
export function Meter({
  value,
  label,
  tone = "ink",
  className,
}: {
  value: number;
  /** Accessible name, e.g. "Draw 97 of 100". */
  label: string;
  tone?: "ink" | "primary" | "qloo";
  className?: string;
}) {
  const width = `${Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10}%`;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("relative block h-2 overflow-hidden rounded-full bg-muted", className)}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-full",
          tone === "primary" ? "bg-primary" : tone === "qloo" ? "bg-prov-qloo" : "bg-foreground",
        )}
        style={{ width }}
      />
    </span>
  );
}
