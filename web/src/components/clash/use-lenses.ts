"use client";

import { useEffect, useState } from "react";

import { fetchLenses, type Lenses } from "@/lib/lenses";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

/**
 * How long to wait after a failed lenses request before the next try: 1.5 s after the first failure, 4 s after the
 * second. Three tries in all; after the third failure the section keeps its generic heading.
 */
export const LENS_RETRY_MS: readonly number[] = [1500, 4000];

/**
 * Asks for one day's lens data, trying again after a failure (`LENS_RETRY_MS`), and hands the answer to `done`
 * once: the lens data, or null when the answer is for another day or the third try fails. Returns the cancel
 * function, which aborts a request in flight and clears a pending retry, so nothing is asked or handed over after it.
 */
export function watchLenses(presetId: string, day: number, done: (lenses: Lenses | null) => void): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = (tries: number) => {
    fetchLenses(presetId, day, controller.signal).then(
      (lenses) => {
        if (!controller.signal.aborted) done(lenses.day === day ? lenses : null);
      },
      () => {
        if (controller.signal.aborted) return;
        const wait = LENS_RETRY_MS[tries - 1];
        if (wait === undefined) done(null);
        else timer = setTimeout(() => attempt(tries + 1), wait);
      },
    );
  };
  attempt(1);
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}

/**
 * One day's lens data, or null while it loads, while a failed request waits to be tried again, in mock mode, and
 * when three tries fail (an older backend answers 404). The section it feeds is an addition, so a failure leaves
 * its generic heading rather than showing an error. A change of day or preset, or leaving the page, cancels a
 * pending retry.
 */
export function useLenses(presetId: string, day: number): Lenses | null {
  const [entry, setEntry] = useState<{ key: string; lenses: Lenses | null } | null>(null);
  const key = `${presetId}|${day}`;

  useEffect(() => {
    if (MOCK_STREAM_ENABLED) return;
    return watchLenses(presetId, day, (lenses) => setEntry({ key, lenses }));
  }, [presetId, day, key]);

  return entry?.key === key ? entry.lenses : null;
}
