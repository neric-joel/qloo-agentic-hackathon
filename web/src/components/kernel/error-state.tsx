import type { ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

type ErrorStateProps = {
  title?: string;
  /** Heading level of the title: `h1` when the error is the whole page. */
  titleAs?: "h1" | "h2" | "h3";
  message: string;
  /** Whether trying again can succeed. Without it (or `onRetry`) no retry button is shown. */
  retryable?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra actions, e.g. a link back to a safe screen. */
  children?: ReactNode;
  className?: string;
};

/** A failed run or screen, announced to assistive tech, with a retry when one can help. */
export function ErrorState({
  title = "Something went wrong",
  titleAs: Title = "h3",
  message,
  retryable = true,
  onRetry,
  retryLabel = "Try again",
  children,
  className,
}: ErrorStateProps) {
  const canRetry = retryable && onRetry !== undefined;
  return (
    <div
      role="alert"
      className={cn("rounded-lg border border-destructive bg-danger-bg p-5", className)}
    >
      <div className="flex items-start gap-3">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <Title className="text-base font-bold text-destructive">{title}</Title>
          <p className="mt-1 text-[0.9375rem] leading-relaxed text-foreground">{message}</p>
          {!retryable ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Trying again will not fix this. Change the input or come back later.
            </p>
          ) : null}
          {canRetry || children ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {canRetry ? (
                <Button variant="outline" onClick={onRetry}>
                  <RotateCcw aria-hidden="true" />
                  {retryLabel}
                </Button>
              ) : null}
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
