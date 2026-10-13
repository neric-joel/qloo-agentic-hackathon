import { cn } from "@/lib/utils";

/** Two set slots locked together with a gap between them; the second is the accent. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn("size-8 shrink-0", className)}
    >
      <path fill="currentColor" d="M9 3h11v7h-10v19h-1a6 6 0 0 1-6-6v-14a6 6 0 0 1 6-6z" />
      <path fill="var(--primary)" d="M23 29h-11v-7h10v-19h1a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6z" />
    </svg>
  );
}
