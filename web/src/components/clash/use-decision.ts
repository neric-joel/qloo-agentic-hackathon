"use client";

import { useEffect, useState } from "react";

import { lacksComparison, requestDecision, type Decision } from "@/lib/decision";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

export type DecisionState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; decision: Decision };

type Entry = { key: string; decision: Decision | null } | null;

/**
 * The state for one preset and day, from what the page holds: the server's answer (`initial`) and what the
 * browser has fetched (`entry`, for `key`). A server answer that already carries every figure of the
 * comparison is final. One that lacks some (it was cached before the route sent them) is shown at once and
 * replaced by the browser's own fetch when that arrives, so the card never depends on the server's cache
 * for the table. With no server answer the state is loading until the fetch ends; `none` when it gives
 * nothing. Pure, so it is unit tested.
 */
export function decisionState(initial: Decision | null, day: number, key: string, entry: Entry, mock: boolean): DecisionState {
  const seeded = initial !== null && initial.day === day;
  const fetched = entry?.key === key ? entry.decision : null;
  if (seeded) {
    // A stale server answer yields to the browser's fetch once it has a complete one for this day.
    return { status: "ready", decision: lacksComparison(initial) && fetched ? fetched : initial };
  }
  if (mock) return { status: "none" };
  if (entry?.key !== key) return { status: "loading" };
  return fetched ? { status: "ready", decision: fetched } : { status: "none" };
}

/**
 * The day's worked decision: the server's answer when the page already holds it for this day, else
 * `GET /decision`. When the server's answer lacks the comparison's figures the browser asks once more
 * (a cached GET that takes no what-if slot) and prints the full table. `none` whenever the route does not
 * answer (an older backend answers 404, mock mode has no route), so the card and its buttons are left out
 * rather than shown empty.
 */
export function useDecision(presetId: string, day: number, initial: Decision | null): DecisionState {
  const [entry, setEntry] = useState<Entry>(null);
  const key = `${presetId}|${day}`;
  const seeded = initial !== null && initial.day === day;
  // Once per page: a server answer that already has every figure is never asked about again.
  const refetch = !seeded || lacksComparison(initial);

  useEffect(() => {
    if (!refetch || MOCK_STREAM_ENABLED) return;
    const controller = new AbortController();
    requestDecision(presetId, day, controller.signal).then(
      (decision) => {
        if (!controller.signal.aborted) setEntry({ key, decision: decision && decision.day === day ? decision : null });
      },
      () => {
        if (!controller.signal.aborted) setEntry({ key, decision: null });
      },
    );
    return () => controller.abort();
  }, [presetId, day, key, refetch]);

  return decisionState(initial, day, key, entry, MOCK_STREAM_ENABLED);
}
