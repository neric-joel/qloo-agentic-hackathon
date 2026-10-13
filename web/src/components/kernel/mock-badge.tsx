import { cn } from "@/lib/utils";

/** Flags output that comes from the simulated stream, so it can never pass for live data. */
export function MockBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "tag text-warning",
        className,
      )}
      title="Events are replayed from a built-in script. No requests are sent to Qloo."
    >
      Simulated data
    </span>
  );
}
