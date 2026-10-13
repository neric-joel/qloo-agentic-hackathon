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
 * Marks a run or screen that replays saved responses instead of calling Qloo live, as one quiet line
 * of plain 12.5px/500 muted text after its 14px clock: no border, no box and no pill. A preset says
 * when it was built; a recorded run says when it was captured.
 */
export function RecordedBadge({ capturedAt, builtAt, children, className }: RecordedBadgeProps) {
  const isPreset = builtAt !== undefined;
  const built = formatCaptured(builtAt);
  const captured = formatCaptured(capturedAt);
  return (
    <div className={cn("flex max-w-prose items-start gap-1.5 text-muted-foreground", className)}>
      <History aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <p className="text-[0.78125rem] leading-snug font-medium">
        {isPreset ? (
          <>
            <strong className="font-semibold text-foreground">Recorded, not live.</strong>{" "}
            {children ?? `Preset built ${built ? `${built} ` : ""}from saved Qloo responses.`}
          </>
        ) : (
          <>
            <strong className="font-semibold text-foreground">Recorded run.</strong>{" "}
            {children ?? "Replayed from saved Qloo responses, not fetched live."}
            {captured ? ` Captured ${captured}.` : null}
          </>
        )}
      </p>
    </div>
  );
}
