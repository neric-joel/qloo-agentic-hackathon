import { cn } from "@/lib/utils";

/** Two set slots locked together: a set and its moved place. Ink only; the mark carries no data colour. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn("size-8 shrink-0", className)}
    >
      <path
        fill="currentColor"
        d="M9 3h9.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-7a1.5 1.5 0 0 0-1.5 1.5v16.5a1 1 0 0 1-1 1a6 6 0 0 1-6-6v-14a6 6 0 0 1 6-6z"
      />
      {/* The second slot as an outline: its centre line runs 1 unit inside, so the 2-unit stroke ends on the slot's edge. */}
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        d="M23 28h-9.5a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5h7a2.5 2.5 0 0 0 2.5-2.5v-16.5a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5z"
      />
    </svg>
  );
}
