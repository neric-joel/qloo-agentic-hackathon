"use client";

import { useEffect, useState } from "react";

import { fetchLenses, type Lenses } from "@/lib/lenses";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

/**
 * One day's lens data, or null while it loads, in mock mode, and whenever the server does not
 * answer with it (an older backend answers 404). The section it feeds is an addition, so a failure
 * leaves it out rather than showing an error.
 */
export function useLenses(presetId: string, day: number): Lenses | null {
  const [entry, setEntry] = useState<{ key: string; lenses: Lenses | null } | null>(null);
  const key = `${presetId}|${day}`;

  useEffect(() => {
    if (MOCK_STREAM_ENABLED) return;
    const controller = new AbortController();
    fetchLenses(presetId, day, controller.signal).then(
      (lenses) => {
        if (!controller.signal.aborted) setEntry({ key, lenses: lenses.day === day ? lenses : null });
      },
      () => {
        if (!controller.signal.aborted) setEntry({ key, lenses: null });
      },
    );
    return () => controller.abort();
  }, [presetId, day, key]);

  return entry?.key === key ? entry.lenses : null;
}
