import type { ReactNode } from "react";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";

function formatCaptured(value: string | Date | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

type RecordedBadgeProps = {
  /** When the saved responses were captured. */
  capturedAt?: string | Date;
  /** Replaces the default explanation. */
  children?: ReactNode;
  className?: string;
};

/** Marks a run or screen that replays saved responses instead of calling Qloo live. */
export function RecordedBadge({ capturedAt, children, className }: RecordedBadgeProps) {
  const captured = formatCaptured(capturedAt);
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-start gap-2.5 rounded-md border border-dashed border-prov-recorded-border bg-prov-recorded-bg px-3 py-2 text-prov-recorded",
        className,
      )}
    >
      <History aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="text-sm leading-snug">
        <strong className="font-semibold">Recorded run.</strong>{" "}
        {children ?? "Replayed from saved Qloo responses, not fetched live."}
        {captured ? ` Captured ${captured}.` : null}
      </p>
    </div>
  );
}
