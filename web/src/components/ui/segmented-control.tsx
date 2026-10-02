"use client";

import { useId, type ReactNode } from "react";
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
  className?: string;
};

/**
 * A single-choice control built on native radio inputs: arrow keys move the selection, the group
 * is announced as a radio group, and nothing depends on colour alone (the selected option is
 * inverted, not just tinted).
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

  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((option) => {
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
              className="peer sr-only"
            />
            <span
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-md border border-border-strong bg-card font-semibold text-foreground transition-[color,background-color,border-color] select-none",
                "hover:bg-accent peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-checked:hover:bg-foreground",
                // Forced-colors modes drop backgrounds, so underline the selected option instead.
                "peer-checked:forced-colors:underline peer-checked:forced-colors:decoration-2 peer-checked:forced-colors:underline-offset-4",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50 peer-disabled:hover:bg-card",
                "[&_svg]:size-4 [&_svg]:shrink-0",
                size === "md" ? "min-h-11 min-w-11 px-3.5 text-sm" : "min-h-9 min-w-9 px-2.5 text-[0.8125rem]",
              )}
            >
              {option.icon}
              <span className={compactOnMobile ? "max-sm:sr-only" : undefined}>{option.label}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
