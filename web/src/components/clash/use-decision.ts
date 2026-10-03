"use client";

import { useEffect, useState } from "react";

import { requestDecision, type Decision } from "@/lib/decision";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

export type DecisionState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; decision: Decision };

/**
 * The day's worked decision: the server's answer when the page already holds it for this day, else
 * `GET /decision`. `none` whenever the route does not answer (an older backend answers 404, mock
 * mode has no route), so the card and its buttons are left out rather than shown empty.
 */
export function useDecision(presetId: string, day: number, initial: Decision | null): DecisionState {
  const [entry, setEntry] = useState<{ key: string; decision: Decision | null } | null>(null);
  const key = `${presetId}|${day}`;
  const seeded = initial !== null && initial.day === day;

  useEffect(() => {
    if (seeded || MOCK_STREAM_ENABLED) return;
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
  }, [presetId, day, key, seeded]);

  if (seeded) return { status: "ready", decision: initial };
  if (MOCK_STREAM_ENABLED) return { status: "none" };
  if (entry?.key !== key) return { status: "loading" };
  return entry.decision ? { status: "ready", decision: entry.decision } : { status: "none" };
}
