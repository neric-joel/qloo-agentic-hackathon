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
  /**
   * Drawn before the page can act on it (the server HTML, until the interactive view mounts): the inputs are
   * disabled but nothing is dimmed, so the swap to the live control changes nothing on screen.
   */
  pending?: boolean;
  /** Stretches the track to the row; each option stays an equal column. */
  fill?: boolean;
  /** Below the `sm` breakpoint, show only the icons (labels stay available to screen readers). */
  compactOnMobile?: boolean;
  /** Kept for the callers that name it. Both variants render the same soft track with its thumb. */
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

/** Where the thumb sits, in the track's own pixels: its column, less the 4px inset on each side. */
type ThumbBox = { x: number; width: number };

/** The thumb's inset from the track and from its column's sides; 10px track corner less 4px gives its 6px. */
const INSET = 4;

/**
 * A single-choice control built on native radio inputs, drawn as a soft track: a 44px muted fill with a
 * 10px corner, split into equal columns (each as wide as the longest label), and one thumb, a card-white
 * plate with a hairline edge and a 6px corner, inset 4px so its corner is concentric with the track's.
 * The columns are equal, so the thumb moves by translateX alone and never scales (180ms ease-out; at
 * once under reduced motion); the label colour changes at once. Before the thumb is measured (server
 * HTML, before hydration) the chosen option draws the same plate itself, so the first paint already
 * shows it in place. Arrow keys move the selection, the group is announced as a radio group, and the
 * selected state is never colour alone (the plate, and an underline in forced-colors modes).
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onValueChange,
  options,
  size = "md",
  disabled = false,
  pending = false,
  fill = false,
  compactOnMobile = false,
  className,
}: SegmentedControlProps<T>) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.findIndex((option) => option.value === value);
  const [thumb, setThumb] = useState<ThumbBox | null>(null);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const option = root?.querySelectorAll<HTMLElement>("[data-segment]")[selected];
    if (!root || !option) return setThumb(null);
    setThumb({ x: option.offsetLeft + INSET, width: option.offsetWidth - 2 * INSET });
  }, [selected]);

  useLayoutEffect(() => {
    measure();
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    // Fonts loading, a wrap or a width change all move the columns.
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure, options, compactOnMobile]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, from: number) => {
    const next = stepIndex(options, from, event.key, disabled || pending);
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
      data-measured={thumb ? "" : undefined}
      className={cn(
        "group/seg relative isolate min-h-11 max-w-full auto-cols-fr grid-flow-col rounded-md bg-muted",
        fill ? "grid w-full" : "inline-grid",
        className,
      )}
    >
      {options.map((option, index) => {
        const isDisabled = disabled || pending || option.disabled;
        return (
          <label
            key={option.value}
            data-segment=""
            title={option.description}
            className={cn("relative z-10 flex min-w-0", pending ? "cursor-default" : isDisabled ? "cursor-not-allowed" : "cursor-pointer")}
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
                "relative flex h-11 w-full min-w-11 items-center justify-center rounded-md text-center text-sm leading-[1.15] font-semibold text-muted-foreground select-none",
                // Until the thumb is measured (server HTML, before hydration), the chosen option draws the
                // same plate itself, in the same place.
                "before:pointer-events-none before:absolute before:inset-1 before:hidden before:rounded-xs before:border before:border-border-strong before:bg-card before:content-['']",
                "peer-checked:before:block group-data-measured/seg:peer-checked:before:hidden forced-colors:before:hidden",
                "hover:text-foreground peer-checked:text-foreground",
                // Forced-colors modes drop the plate's fill, so underline the selected option instead.
                "peer-checked:forced-colors:underline peer-checked:forced-colors:decoration-2 peer-checked:forced-colors:underline-offset-4",
                // The ring traces the thumb: 4px inside the option's 10px corner is the plate's 6px.
                "peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-4 peer-focus-visible:outline-ring",
                pending ? null : "peer-disabled:opacity-50 peer-disabled:hover:text-muted-foreground",
                size === "md" ? "px-4" : "px-3",
              )}
            >
              <span data-segment-content="" className="relative inline-flex items-center gap-1.5 [&_svg]:size-4 [&_svg]:shrink-0">
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
          "pointer-events-none absolute top-1 bottom-1 left-0 z-0 rounded-xs border border-border-strong bg-card forced-colors:hidden",
          "motion-safe:transition-[transform] motion-safe:duration-(--dur-state) motion-safe:ease-(--ease-out)",
          (selected < 0 || !thumb) && "hidden",
        )}
        style={thumb ? { width: thumb.width, transform: `translateX(${thumb.x}px)` } : undefined}
      />
    </div>
  );
}
