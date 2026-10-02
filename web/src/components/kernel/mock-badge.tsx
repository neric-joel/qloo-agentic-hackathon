import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/** Flags output that comes from the simulated stream, so it can never pass for live data. */
export function MockBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border border-warning/60 bg-warning-bg px-2.5 text-[0.8125rem] leading-none font-semibold whitespace-nowrap text-warning",
        className,
      )}
      title="Events are replayed from a built-in script. No requests are sent to Qloo."
    >
      <FlaskConical aria-hidden="true" className="size-3.5" />
      Simulated data
    </span>
  );
}
