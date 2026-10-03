"use client";

import { useEffect, useState } from "react";

import { parseMoves, type MovesResult } from "@/lib/moves";

/** How many priced places the section asks for. */
export const MOVES_LIMIT = 8;

export type MovesState =
  | { status: "idle"; result: null }
  | { status: "loading"; result: null }
  | { status: "error"; result: null }
  | { status: "ready"; result: MovesResult };

/** One request per set and festival day, shared while it is in flight. A failure is not kept. */
const requests = new Map<string, Promise<MovesResult | null>>();
/** Answers already in, so going back to a set shows its places at once. */
const answers = new Map<string, MovesResult>();

function cacheKey(presetId: string, actId: string): string {
  return `${presetId}:${actId}`;
}

function loadMoves(presetId: string, actId: string): Promise<MovesResult | null> {
  const key = cacheKey(presetId, actId);
  const pending = requests.get(key);
  if (pending) return pending;
  const query = new URLSearchParams({ act: actId, limit: String(MOVES_LIMIT) });
  const request = fetch(`/api/presets/${encodeURIComponent(presetId)}/moves?${query.toString()}`, {
    headers: { Accept: "application/json" },
  })
    .then((response) => (response.ok ? response.json().catch(() => null) : null))
    .then((json: unknown) => {
      const result = parseMoves(json);
      // An answer about another set is not an answer to this question.
      return result && result.actId === actId ? result : null;
    })
    .catch(() => null)
    .then((result) => {
      if (result) answers.set(key, result);
      else requests.delete(key);
      return result;
    });
  requests.set(key, request);
  return request;
}

/**
 * Every legal place one set could go, priced by the timetable engine
 * (`GET /api/presets/{id}/moves`). Idle until a set is chosen; nothing is fetched for `null`.
 * Answers are kept for the page's life, so switching back to a set is instant. The request uses the
 * published timetable only: it starts no agent run and calls no language model.
 */
export function useMoves(presetId: string, actId: string | null): MovesState & { retry: () => void } {
  const [settled, setSettled] = useState<{ key: string; attempt: number; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = actId ? cacheKey(presetId, actId) : null;

  useEffect(() => {
    if (!actId || answers.has(cacheKey(presetId, actId))) return;
    let active = true;
    const thisKey = cacheKey(presetId, actId);
    loadMoves(presetId, actId).then((result) => {
      if (active) setSettled({ key: thisKey, attempt, failed: result === null });
    });
    return () => {
      active = false;
    };
  }, [presetId, actId, attempt]);

  const retry = () => setAttempt((current) => current + 1);

  if (!key) return { status: "idle", result: null, retry };
  const answer = answers.get(key);
  if (answer) return { status: "ready", result: answer, retry };
  if (settled?.key === key && settled.attempt === attempt && settled.failed) {
    return { status: "error", result: null, retry };
  }
  return { status: "loading", result: null, retry };
}
