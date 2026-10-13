"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Shown as a tooltip. */
  description?: string;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string> = {
  /** Accessible name for the group. */
  label: string;
  /** The selected option, or `null` to show none selected. */
  value: T | null;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  size?: "sm" | "md";
  disabled?: boolean;
  /** Below the `sm` breakpoint, show only the icons (labels stay available to screen readers). */
  compactOnMobile?: boolean;
  /**
   * Kept for the callers that name it. Both variants now render the same row of tabs: text only,
   * the selected option in full ink with a 3px ink marker under it, like the tabs of a printed index.
   */
  variant?: "default" | "tabs";
  className?: string;
};

/**
 * The option an arrow key moves to from `from`, skipping disabled options and wrapping at the ends,
 * as native radio groups do: ArrowRight and ArrowDown go forward, ArrowLeft and ArrowUp go back.
 * Returns -1 for any other key, or when nothing else can be chosen.
 */
export function stepIndex(
  options: readonly { disabled?: boolean }[],
  from: number,
  key: string,
  groupDisabled = false,
): number {
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
  if (!step || groupDisabled || options.length === 0) return -1;
  const n = options.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + step * k) % n) + n) % n;
    if (i === from) return -1;
    if (!options[i].disabled) return i;
  }
  return -1;
}

/** Where the marker sits, in the row's own pixels: under the selected tab's content, at its foot. */
type MarkerBox = { x: number; y: number; width: number };

/**
 * A single-choice control built on native radio inputs, drawn as a row of 44px tabs: 14px semibold
 * text, muted until chosen, then full ink. One 3px ink capsule at the foot of the selected tab's
 * label slides between options (transform and width, 180ms ease-out; it jumps under reduced
 * motion). No track, thumb, border, fill or hairline. Arrow keys move the selection, the group is
 * announced as a radio group, and the selected state is never colour alone (ink text plus the
 * marker, and an underline in forced-colors modes).
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onValueChange,
  options,
  size = "md",
  disabled = false,
  compactOnMobile = false,
  className,
}: SegmentedControlProps<T>) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.findIndex((option) => option.value === value);
  const [marker, setMarker] = useState<MarkerBox | null>(null);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const content = root?.querySelectorAll<HTMLElement>("[data-segment-content]")[selected];
    const tab = content?.parentElement;
    if (!root || !content || !tab) return setMarker(null);
    setMarker({
      x: tab.offsetLeft + content.offsetLeft,
      y: tab.offsetTop + tab.offsetHeight - 3,
      width: content.offsetWidth,
    });
  }, [selected]);

  useLayoutEffect(() => {
    measure();
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    // Fonts loading, a wrap or the compact breakpoint all change a tab's width.
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    root.querySelectorAll("[data-segment-content]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [measure, options, compactOnMobile]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, from: number) => {
    const next = stepIndex(options, from, event.key, disabled);
    if (next < 0) return;
    event.preventDefault();
    rootRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]')[next]?.focus();
    onValueChange(options[next].value);
  };

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={label}
      data-measured={marker ? "" : undefined}
      className={cn("group/seg relative flex max-w-full flex-wrap", className)}
    >
      {options.map((option, index) => {
        const isDisabled = disabled || option.disabled;
        return (
          <label
            key={option.value}
            title={option.description}
            className={cn("relative inline-flex", isDisabled ? "cursor-not-allowed" : "cursor-pointer")}
          >
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={value === option.value}
              disabled={isDisabled}
              onChange={() => onValueChange(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm font-semibold text-muted-foreground select-none",
                // Until the sliding marker is measured (server HTML, before hydration), the selected
                // tab draws its own marker in the same place.
                "after:pointer-events-none after:absolute after:bottom-0 after:hidden after:h-[3px] after:rounded-bar after:bg-foreground after:content-['']",
                "peer-checked:after:block group-data-measured/seg:peer-checked:after:hidden forced-colors:after:hidden",
                "transition-colors duration-150 ease-out motion-reduce:transition-none",
                "hover:text-foreground peer-checked:text-foreground",
                // Forced-colors modes drop the marker's fill, so underline the selected option instead.
                "peer-checked:forced-colors:underline peer-checked:forced-colors:decoration-2 peer-checked:forced-colors:underline-offset-4",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50 peer-disabled:hover:text-muted-foreground",
                size === "md" ? "px-4 after:inset-x-4" : "px-3 after:inset-x-3",
              )}
            >
              <span data-segment-content="" className="inline-flex items-center gap-1.5 [&_svg]:size-4 [&_svg]:shrink-0">
                {option.icon}
                <span className={compactOnMobile ? "max-sm:sr-only" : undefined}>{option.label}</span>
              </span>
            </span>
          </label>
        );
      })}
      <span
        aria-hidden="true"
        data-slot="segmented-marker"
        className={cn(
          "pointer-events-none absolute top-0 left-0 h-[3px] rounded-bar bg-foreground forced-colors:hidden",
          "motion-safe:transition-[transform,width] motion-safe:duration-[180ms] motion-safe:ease-out",
          (selected < 0 || !marker) && "hidden",
        )}
        style={marker ? { width: marker.width, transform: `translate(${marker.x}px, ${marker.y}px)` } : undefined}
      />
    </div>
  );
}
