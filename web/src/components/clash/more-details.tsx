import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Shared disclosure classes (defined in globals.css) so other ruled rows can match this one. */
export const DISCLOSURE_ROW_CLASS = "cc-disclosure";
export const DISCLOSURE_SUMMARY_CLASS = "cc-disclosure-summary";
export const DISCLOSURE_HINT_CLASS = "cc-disclosure-hint";
export const DISCLOSURE_MARK_CLASS = "cc-disclosure-mark";

/** The caret that points right, then down when its `<details>` opens (CSS only). */
export function DisclosureMark({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn(DISCLOSURE_MARK_CLASS, className)} />;
}

/**
 * A closed disclosure for content a first read can skip: a ruled row like a line in a running order,
 * a caret, the label, then an optional muted hint (the caret is drawn first by CSS). The caret turns down on open and the open row gets
 * a 2px ink rule on the left. Native `<details>`, so it works without JavaScript.
 */
export function MoreDetails({
  summary,
  hint,
  className,
  summaryClassName,
  children,
}: {
  summary: ReactNode;
  /** Optional muted note after the label. */
  hint?: ReactNode;
  className?: string;
  summaryClassName?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn("group", DISCLOSURE_ROW_CLASS, className)}>
      <summary className={cn(DISCLOSURE_SUMMARY_CLASS, summaryClassName)}>
        {summary}
        {hint ? <span className={DISCLOSURE_HINT_CLASS}>{hint}</span> : null}
        {/* Last in the markup so the summary text leads; CSS (order: -1) draws it first, on the left. */}
        <DisclosureMark />
      </summary>
      {children}
    </details>
  );
}
