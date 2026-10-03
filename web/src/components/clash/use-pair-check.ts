"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  matchesPair,
  pairCheckError,
  parsePairCheck,
  unreadablePairCheck,
  type PairCheck,
  type PairCheckError,
} from "@/lib/pair-check";

export type PairCheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; check: PairCheck }
  | { status: "error"; error: PairCheckError };

const IDLE: PairCheckState = { status: "idle" };

/**
 * One live pair check at a time (`GET /api/pair`). It never starts by itself: only `run` sends a
 * request, with the festival day's id and the two act ids and nothing else. A second `run` while
 * one is in flight is ignored, so a double click never sends two. `reset` and unmounting abort a
 * request in flight. `run` settles with the check, or null when it failed or was aborted.
 */
export function usePairCheck(): {
  state: PairCheckState;
  run: (presetId: string, a: string, b: string) => Promise<PairCheck | null>;
  reset: () => void;
} {
  const [state, setState] = useState<PairCheckState>(IDLE);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState(IDLE);
  }, []);

  const run = useCallback(async (presetId: string, a: string, b: string): Promise<PairCheck | null> => {
    if (controller.current) return null;
    const current = new AbortController();
    controller.current = current;
    const { signal } = current;
    setState({ status: "loading" });

    let next: PairCheckState;
    try {
      const query = new URLSearchParams({ preset: presetId, a, b });
      const response = await fetch(`/api/pair?${query.toString()}`, {
        cache: "no-store",
        signal,
        headers: { Accept: "application/json" },
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        next = { status: "error", error: pairCheckError(response.status, body) };
      } else {
        const check = parsePairCheck(body);
        next =
          check && matchesPair(check, presetId, a, b)
            ? { status: "ready", check }
            : { status: "error", error: unreadablePairCheck() };
      }
    } catch {
      next = { status: "error", error: pairCheckError(0, null) };
    }

    // Aborted by `reset` or by unmounting: nothing to show, and a newer check may own the state.
    if (signal.aborted) return null;
    controller.current = null;
    setState(next);
    return next.status === "ready" ? next.check : null;
  }, []);

  return { state, run, reset };
}
