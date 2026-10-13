"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { Theme } from "./theme-config";
import { useTheme, type RevealOrigin } from "./theme-provider";

/** Shared drawing for the three glyphs: an 18 px grid at 1:1, a 1.5 px line with round ends, the text colour. */
const GLYPH = {
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/**
 * The sun: a 7 px ring with eight 2 px rays. Inside the menu the rays retract when the option is not
 * selected and turn out when it is (the motion lives in the "Theme switch reveal" block of globals.css).
 * On the menu button the rays are drawn fully out and still.
 */
function SunGlyph({ still = false }: { still?: boolean }) {
  return (
    <svg {...GLYPH} className={still ? undefined : "cc-theme-glyph"}>
      <circle cx="9" cy="9" r="3.5" />
      <g className={still ? undefined : "cc-theme-rays"}>
        <path d="M14.5 9L16.5 9M12.89 12.89L14.3 14.3M9 14.5L9 16.5M5.11 12.89L3.7 14.3M3.5 9L1.5 9M5.11 5.11L3.7 3.7M9 3.5L9 1.5M12.89 5.11L14.3 3.7" />
      </g>
    </svg>
  );
}

/**
 * The moon: one closed crescent outline (an outer arc and an inner arc), stroked and never filled, so
 * it reads as a crescent in every theme and never as a disc, with no mask involved.
 */
function MoonGlyph({ still = false }: { still?: boolean }) {
  return (
    <svg {...GLYPH} className={still ? undefined : "cc-theme-glyph"}>
      <path d="M15.4 10.6A6.5 6.5 0 1 1 7.4 2.6a6 6 0 0 0 8 8Z" />
    </svg>
  );
}

/** The device setting: a square screen on a short stand, in the same line as the sun and moon. */
function MonitorGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M2.25 3.25h13.5v9H2.25Z" />
      <path d="M9 12.25v3M6 15.25h6" />
    </svg>
  );
}

type ThemeOption = {
  value: Theme;
  label: string;
  icon: (still: boolean) => ReactNode;
  description: string;
};

const OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "Light", icon: (still) => <SunGlyph still={still} />, description: "Light theme" },
  { value: "dark", label: "Dark", icon: (still) => <MoonGlyph still={still} />, description: "Dark theme" },
  {
    value: "system",
    label: "System",
    icon: () => <MonitorGlyph />,
    description: "Match your device setting",
  },
];

/** The centre of an element, in viewport pixels. */
function centreOf(element: Element | null): RevealOrigin | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * One 44 px borderless button with the control corner, showing the current choice, which opens a small ruled panel holding the native
 * radio group (Light, Dark, System). The arrow keys move the choice inside the group; choosing one
 * applies it and closes the panel. Escape or a click outside closes it and returns focus to the
 * button, and the new theme grows out of the button.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, ready, setTheme } = useTheme();
  const name = useId();
  const panelId = `${name}-panel`;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // A native radio fires a click for both pointer and arrow keys. Arrow keys move the choice
  // inside the open panel without closing it; a pointer click (or Enter/Space) closes it.
  const viaArrow = useRef(false);

  // Nothing is shown as selected until the stored choice has been read, rather than showing
  // "System" for a moment to someone who picked something else.
  const selected = ready ? theme : null;
  const current = OPTIONS.find((option) => option.value === selected) ?? null;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);

  const change = useCallback(
    (next: Theme) => {
      setTheme(next, centreOf(button.current) ?? undefined);
      if (!viaArrow.current) close(true);
      viaArrow.current = false;
    },
    [setTheme, close],
  );

  // Escape and a click or tap outside close the panel.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) {
        close(true);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // On opening, focus moves to the chosen radio (or the first), as a native group expects.
  useEffect(() => {
    if (!open || !root.current) return;
    const target =
      root.current.querySelector<HTMLInputElement>('input[type="radio"]:checked') ??
      root.current.querySelector<HTMLInputElement>('input[type="radio"]');
    target?.focus();
  }, [open]);

  return (
    <div
      ref={root}
      className={cn("relative inline-flex shrink-0", className)}
      onBlur={(event) => {
        // Tabbing out of the panel closes it, leaving focus where the visitor sent it.
        const next = event.relatedTarget;
        if (open && next instanceof Node && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={current ? `Color theme: ${current.label}` : "Color theme"}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          // The same 44 x 44 frame as the phone Menu button: the 12 px control corner and no border. Hover
          // and the open menu lay the wash (bg-accent) under it; the glyph is its only identity.
          "inline-flex size-11 items-center justify-center rounded-md bg-transparent text-foreground transition-colors",
          "hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "aria-expanded:bg-accent [&_svg]:size-[18px] [&_svg]:shrink-0",
          "motion-reduce:transition-none",
        )}
      >
        {current ? current.icon(true) : <span className="block size-[18px]" aria-hidden="true" />}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute top-[calc(100%+0.375rem)] right-0 z-50 w-40 rounded-md border border-surface-edge bg-popover p-1"
      >
        <fieldset
          className="m-0 flex min-w-0 flex-col border-0 p-0"
          onKeyDownCapture={(event) => {
            viaArrow.current = event.key.startsWith("Arrow");
          }}
          onPointerDownCapture={() => {
            viaArrow.current = false;
          }}
        >
          <legend className="sr-only">Color theme</legend>
          {OPTIONS.map((option) => (
            <label key={option.value} title={option.description} className="relative flex cursor-pointer">
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected === option.value}
                onChange={() => change(option.value)}
                onClick={() => {
                  // Clicking the option already chosen still closes the panel.
                  if (selected === option.value && !viaArrow.current) close(true);
                }}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex h-10 w-full items-center gap-2.5 rounded-sm px-2.5 text-sm text-muted-foreground transition-[color,background-color] select-none",
                  "hover:bg-accent hover:text-foreground peer-checked:bg-accent peer-checked:font-semibold peer-checked:text-foreground",
                  // Forced-colours modes drop fills, so the chosen row gets an outline instead.
                  "peer-checked:forced-colors:outline peer-checked:forced-colors:outline-1 peer-checked:forced-colors:outline-[CanvasText]",
                  "peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-ring",
                  "[&_svg]:size-[18px] [&_svg]:shrink-0",
                )}
              >
                {option.icon(false)}
                <span>{option.label}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
