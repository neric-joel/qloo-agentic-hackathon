"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { THEME_STORAGE_KEY, type Theme } from "./theme-config";

type ThemeContextValue = {
  /** The stored preference: light, dark, or follow the system. */
  theme: Theme;
  /** What is actually applied right now. */
  resolvedTheme: "light" | "dark";
  /** False until the browser has read the stored preference (server render and hydration). */
  ready: boolean;
  /**
   * Changes the theme. Pass the point the change came from (the toggle's centre) and the new
   * theme is revealed as a circle growing from it, where the browser supports that.
   */
  setTheme: (theme: Theme, origin?: RevealOrigin) => void;
};

/** A point in viewport pixels that the theme reveal grows from. */
export type RevealOrigin = { x: number; y: number };

/** How long the circular reveal takes, in milliseconds. */
export const REVEAL_DURATION_MS = 520;
export const REVEAL_EASING = "cubic-bezier(0.76, 0, 0.24, 1)";

/** Distance from the origin to the farthest corner: the radius at which the circle covers the page. */
export function revealRadius(origin: RevealOrigin, width: number, height: number): number {
  return Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y));
}

/** The reveal runs only when the browser can do it and nothing asks for less motion or for print. */
export function shouldAnimateReveal(input: {
  supportsViewTransitions: boolean;
  reducedMotion: boolean;
  printing: boolean;
  /** Whether the light/dark appearance actually changes (system -> the theme already shown does not). */
  appearanceChanges: boolean;
  hasOrigin: boolean;
}): boolean {
  return (
    input.supportsViewTransitions &&
    !input.reducedMotion &&
    !input.printing &&
    input.appearanceChanges &&
    input.hasOrigin
  );
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_CHANGE_EVENT = "theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Holds the choice when storage is blocked, so the toggle still works until the page reloads. */
let memoryTheme: Theme = "system";

function readStoredTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return memoryTheme;
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * Puts the theme on the document. It runs only in response to a choice or a system change; the
 * first paint is handled by the inline script in the document head, so nothing is rewritten
 * while the page hydrates.
 */
function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

function subscribeToStoredTheme(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const noSubscription = () => () => undefined;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore<Theme>(subscribeToStoredTheme, readStoredTheme, () => "system");
  const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false);
  const ready = useSyncExternalStore(noSubscription, () => true, () => false);
  const resolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;

  // Follow changes made elsewhere: the operating system setting, or another tab.
  useEffect(() => {
    const sync = () => applyTheme(readStoredTheme());
    const query = window.matchMedia(DARK_QUERY);
    query.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => {
      query.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setTheme = useCallback((next: Theme, origin?: RevealOrigin) => {
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      memoryTheme = next;
      try {
        if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
        else window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage unavailable: the choice lasts until the page is reloaded.
      }
      applyTheme(next);
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    };

    const doc = document as Document & {
      startViewTransition?: (update: () => void) => { ready: Promise<void> };
    };
    const willBeDark = next === "dark" || (next === "system" && systemPrefersDark());
    const animate = shouldAnimateReveal({
      supportsViewTransitions: typeof doc.startViewTransition === "function",
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      printing: window.matchMedia("print").matches,
      appearanceChanges: willBeDark !== document.documentElement.classList.contains("dark"),
      hasOrigin: origin !== undefined,
    });
    if (!animate || !origin || !doc.startViewTransition) {
      commit();
      return;
    }

    try {
      const transition = doc.startViewTransition(commit);
      const radius = revealRadius(origin, window.innerWidth, window.innerHeight);
      transition.ready
        .then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${origin.x}px ${origin.y}px)`,
                `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
              ],
            },
            { duration: REVEAL_DURATION_MS, easing: REVEAL_EASING, pseudoElement: "::view-transition-new(root)" },
          );
        })
        .catch(() => undefined);
    } catch {
      // The browser refused the transition: switch without it.
      commit();
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, ready, setTheme }),
    [theme, resolvedTheme, ready, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>");
  return context;
}
