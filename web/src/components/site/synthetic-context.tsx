"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";
import { parsePresetList } from "@/lib/preset";

/**
 * Whether the server is serving its invented day, as one answer for the whole page. The layout reads
 * the flag on the server (`initial`, from the preset list) and the browser asks again after the page
 * loads; the banner, the footer and the notes on /method all read this one value, so they cannot
 * disagree: if the browser learns the day is invented (or not), every one of them switches together.
 * `null` is "no provider", which a component reads as its own fallback.
 */
const SyntheticContext = createContext<boolean | null>(null);

/** The flag the preset list carries on its first day, or null when the list is not one this page understands. */
export function syntheticFromList(raw: unknown): boolean | null {
  try {
    const first = parsePresetList(raw)[0];
    return first ? first.synthetic === true : false;
  } catch {
    return null;
  }
}

/** Provides the flag: `initial` in the server HTML, then whatever the preset list says in the browser. */
export function SyntheticProvider({ initial = false, children }: { initial?: boolean; children: ReactNode }) {
  const [synthetic, setSynthetic] = useState(initial);

  useEffect(() => {
    if (MOCK_STREAM_ENABLED) return; // the simulated-data banner already covers this build
    const controller = new AbortController();
    fetch("/api/presets", { signal: controller.signal, headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("no list"))))
      .then((raw: unknown) => {
        const flag = syntheticFromList(raw);
        if (flag !== null) setSynthetic(flag);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return <SyntheticContext.Provider value={synthetic}>{children}</SyntheticContext.Provider>;
}

/** The page's flag; `fallback` when there is no provider above (a component mounted on its own). */
export function useSynthetic(fallback = false): boolean {
  const value = useContext(SyntheticContext);
  return value === null ? fallback : value;
}

/** One of two texts, by whether the server is serving its invented day. For a server page that cannot read the flag itself. */
export function BySyntheticDay({ real, invented }: { real: ReactNode; invented: ReactNode }) {
  return <>{useSynthetic() ? invented : real}</>;
}

export { SyntheticContext };
