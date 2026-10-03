"use client";

import { useEffect, useState } from "react";

import { parseMoves, type MovesResult } from "@/lib/moves";
import { encodeMoves, requestPlan, type Plan, type PlanAnswer, type StackStep } from "@/lib/stack";

/** How many priced places the section asks for. */
export const MOVES_LIMIT = 8;

export type MovesState =
  | { status: "idle"; result: null }
  | { status: "loading"; result: null }
  | { status: "error"; result: null }
  | { status: "ready"; result: MovesResult };

export type PlanState = {
  /** `invalid`: the server refused the plan itself (a step that is no longer a legal place). */
  status: "idle" | "loading" | "error" | "ready" | "invalid";
  /**
   * The priced plan, null with no kept moves. While places for another set load on top of the same
   * moves, the plan already priced for those moves is kept here, so the plan card does not blink.
   */
  plan: Plan | null;
  /** The picked set's legal places (on top of the plan when there is one), or null. */
  options: MovesResult | null;
  retry: () => void;
};

/** One request per question, shared while it is in flight. A failure is not kept. */
const requests = new Map<string, Promise<MovesResult | null>>();
/** Answers already in, so going back to a set shows its places at once. */
const answers = new Map<string, MovesResult>();

const planRequests = new Map<string, Promise<PlanAnswer>>();
/** Priced plans by moves and set, for the page's life. */
const planAnswers = new Map<string, Plan>();
/** The latest plan priced for each list of moves, whichever set it was asked with. */
const plansByMoves = new Map<string, Plan>();

/** No kept moves: the published timetable. Shared so its identity never changes. */
const NO_MOVES: readonly StackStep[] = [];

function cacheKey(presetId: string, actId: string): string {
  return `${presetId}:${actId}`;
}

function movesKey(presetId: string, moves: readonly StackStep[]): string {
  return `${presetId}:${encodeMoves(moves)}`;
}

function planKey(presetId: string, moves: readonly StackStep[], actId: string | null): string {
  return `${movesKey(presetId, moves)}:${actId ?? ""}`;
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

function loadPlan(presetId: string, moves: readonly StackStep[], actId: string | null): Promise<PlanAnswer> {
  const key = planKey(presetId, moves, actId);
  const pending = planRequests.get(key);
  if (pending) return pending;
  const request = requestPlan(presetId, moves, actId).then((answer) => {
    if (answer.status === "ready") {
      planAnswers.set(key, answer.plan);
      plansByMoves.set(movesKey(presetId, moves), answer.plan);
    } else {
      planRequests.delete(key);
    }
    return answer;
  });
  planRequests.set(key, request);
  return request;
}

/**
 * The picked set's legal places and the kept moves' plan, priced by the timetable engine.
 *
 * With no kept moves and a picked set it asks `GET /api/presets/{id}/moves` (cacheable, as before);
 * with kept moves it sends them, in order, to `POST /api/presets/{id}/whatif`, with the picked set
 * when there is one. Nothing is fetched with no moves and no set. Answers are kept for the page's
 * life, so going back to a set, or undoing a move, is instant; a failure is not kept. `moves` should
 * keep its identity while it is unchanged (state, not a fresh array each render). No request
 * starts an agent run or calls a language model, and nothing changes the published timetable.
 */
export function usePlan(presetId: string, moves: readonly StackStep[], actId: string | null): PlanState {
  const [settled, setSettled] = useState<{
    key: string;
    attempt: number;
    outcome: "ready" | "error" | "invalid";
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const planned = moves.length > 0;
  const key = planned ? `plan:${planKey(presetId, moves, actId)}` : actId ? `moves:${cacheKey(presetId, actId)}` : null;

  useEffect(() => {
    if (moves.length > 0) {
      if (planAnswers.has(planKey(presetId, moves, actId))) return;
      let active = true;
      const thisKey = `plan:${planKey(presetId, moves, actId)}`;
      loadPlan(presetId, moves, actId).then((answer) => {
        if (active) setSettled({ key: thisKey, attempt, outcome: answer.status });
      });
      return () => {
        active = false;
      };
    }
    if (!actId || answers.has(cacheKey(presetId, actId))) return;
    let active = true;
    const thisKey = `moves:${cacheKey(presetId, actId)}`;
    loadMoves(presetId, actId).then((result) => {
      if (active) setSettled({ key: thisKey, attempt, outcome: result ? "ready" : "error" });
    });
    return () => {
      active = false;
    };
  }, [presetId, moves, actId, attempt]);

  const retry = () => setAttempt((current) => current + 1);

  if (!key) return { status: "idle", plan: null, options: null, retry };

  if (!planned) {
    const answer = actId ? answers.get(cacheKey(presetId, actId)) : undefined;
    if (answer) return { status: "ready", plan: null, options: answer, retry };
  } else {
    const answer = planAnswers.get(planKey(presetId, moves, actId));
    if (answer) return { status: "ready", plan: answer, options: answer.options, retry };
  }

  const known = planned ? (plansByMoves.get(movesKey(presetId, moves)) ?? null) : null;
  if (settled?.key === key && settled.attempt === attempt && settled.outcome !== "ready") {
    return { status: settled.outcome, plan: settled.outcome === "invalid" ? null : known, options: null, retry };
  }
  return { status: "loading", plan: known, options: null, retry };
}

/**
 * Every legal place one set could go on the published timetable, priced by the timetable engine
 * (`GET /api/presets/{id}/moves`). Idle until a set is chosen; nothing is fetched for `null`.
 */
export function useMoves(presetId: string, actId: string | null): MovesState & { retry: () => void } {
  const state = usePlan(presetId, NO_MOVES, actId);
  if (state.status === "ready" && state.options) return { status: "ready", result: state.options, retry: state.retry };
  if (state.status === "idle") return { status: "idle", result: null, retry: state.retry };
  if (state.status === "loading") return { status: "loading", result: null, retry: state.retry };
  return { status: "error", result: null, retry: state.retry };
}
