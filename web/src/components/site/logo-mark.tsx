import { useId } from "react";

import { cn } from "@/lib/utils";

/** Two overlapping audiences; the overlap is the accent. */
export function LogoMark({ className }: { className?: string }) {
  // Unique per instance, so a second logo on the page cannot borrow this clip path.
  const clipId = `${useId()}-left-audience`;
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn("size-8 shrink-0", className)}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="12" cy="16" r="9" />
        </clipPath>
      </defs>
      <circle cx="20" cy="16" r="9" fill="var(--primary)" clipPath={`url(#${clipId})`} />
      <circle cx="12" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="20" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}
