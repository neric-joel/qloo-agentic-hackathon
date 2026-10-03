import type { ReactNode } from "react";
import { History } from "lucide-react";
import { formatCaptured } from "@/lib/format";
import { cn } from "@/lib/utils";

type RecordedBadgeProps = {
  /** A recorded run: when its saved responses were captured. */
  capturedAt?: string | Date;
  /** A preset: when it was built from saved responses. Takes the place of `capturedAt`. */
  builtAt?: string | Date;
  /** Replaces the default explanation. */
  children?: ReactNode;
  className?: string;
};

/**
 * Marks a run or screen that replays saved responses instead of calling Qloo live. A preset says
 * when it was built; a recorded run says when it was captured.
 */
export function RecordedBadge({ capturedAt, builtAt, children, className }: RecordedBadgeProps) {
  const isPreset = builtAt !== undefined;
  const built = formatCaptured(builtAt);
  const captured = formatCaptured(capturedAt);
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-start gap-2.5 rounded-md border border-dashed border-prov-recorded-border bg-prov-recorded-bg px-3 py-2 text-prov-recorded",
        className,
      )}
    >
      <History aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {isPreset ? (
        <p className="text-sm leading-snug">
          <strong className="font-semibold">Recorded, not live.</strong>{" "}
          {children ?? `Preset built ${built ? `${built} ` : ""}from saved Qloo responses.`}
        </p>
      ) : (
        <p className="text-sm leading-snug">
          <strong className="font-semibold">Recorded run.</strong>{" "}
          {children ?? "Replayed from saved Qloo responses, not fetched live."}
          {captured ? ` Captured ${captured}.` : null}
        </p>
      )}
    </div>
  );
}
