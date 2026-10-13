"use client";

import { useEffect, useState } from "react";

import { parseMoves, type ClashChanges, type MovesResult, type Placement, type PlacedOption } from "@/lib/moves";
import type { Act, SetSlot } from "@/lib/preset";
import { overlapWindow } from "@/lib/timetable";
import { encodeMoves, requestPlan, type Plan, type PlanAnswer, type StackMove, type StackStep } from "@/lib/stack";

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
 * Prices a whole plan with the timetable engine (`POST /api/presets/{id}/whatif`, with no picked set) before
 * anything keeps it: the answer is shared with `usePlan`, so a plan this checked is shown at once once kept.
 * "invalid" when the engine refuses it. No language model, no Qloo call, and nothing is kept here.
 */
export function checkPlan(presetId: string, moves: readonly StackStep[]): Promise<PlanAnswer> {
  if (moves.length === 0) return Promise.resolve({ status: "error" });
  return loadPlan(presetId, moves, null);
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

/**
 * What the server's own list says about one move before it is kept: still being asked (`checking`), the
 * list did not load (`error`), the place is not among the places the answer lists (`unlisted`, so its
 * rules are not confirmed here), or the listed place itself (`ready`): a legal place, so it adds no rule
 * break, with the Clash Budget Index before and after and the set's clashes there. Never `ready` before
 * the answer is in.
 */
export type MoveCheck =
  | { status: "checking" }
  | { status: "error" }
  | { status: "unlisted"; result: MovesResult }
  | { status: "ready"; result: MovesResult; option: PlacedOption };

/** The listed place a move lands on (same set, stage, day and start), or null when the list does not hold it. */
export function listedPlace(result: MovesResult, move: StackMove): PlacedOption | null {
  if (result.actId !== move.actId || !result.movable) return null;
  return (
    result.options.find(
      (option) => option.stageId === move.stageId && option.day === move.day && option.start === move.start,
    ) ?? null
  );
}

/** A plan state read for one move: see `MoveCheck`. */
export function moveCheck(state: Pick<PlanState, "status" | "options">, move: StackMove): MoveCheck {
  if (state.status === "error" || state.status === "invalid") return { status: "error" };
  if (state.status !== "ready" || !state.options) return { status: "checking" };
  const option = listedPlace(state.options, move);
  return option ? { status: "ready", result: state.options, option } : { status: "unlisted", result: state.options };
}

/**
 * The decision card's move checked against the timetable engine's list of legal places for its set,
 * on top of the kept moves: the same request "Show every legal place" makes (shared and cached, so
 * pressing it afterwards asks nothing new). Null with no move. No language model and no Qloo call.
 */
export function useMoveCheck(presetId: string, moves: readonly StackStep[], move: StackMove | null): MoveCheck | null {
  const state = usePlan(presetId, moves, move?.actId ?? null);
  return move ? moveCheck(state, move) : null;
}

/** A clash a move keeps, with the minutes the two sets share before and after it. */
export type SharedChange = { name: string; before: number; after: number };

/** Minutes the moved set shares with each named partner, before and after the move, by partner name. */
export type SharedByName = ReadonlyMap<string, { before: number; after: number }>;

/**
 * The minutes the moved set shares with each of `names`, at `home` (where it plays now) and at `after`
 * (the tested place), read from the timetable already in memory. A partner the timetable does not hold
 * is left out. No request is made.
 */
export function sharedMinutesByName(
  acts: readonly Pick<Act, "id" | "name">[],
  timetable: readonly SetSlot[],
  actId: string,
  home: Placement | null,
  after: Placement | null,
  names: readonly string[],
): Map<string, { before: number; after: number }> {
  const out = new Map<string, { before: number; after: number }>();
  if (!home || !after) return out;
  const idsByName = new Map<string, string[]>();
  for (const act of acts) idsByName.set(act.name, [...(idsByName.get(act.name) ?? []), act.id]);
  const minutes = (place: Placement, slot: SetSlot) => {
    if (slot.day !== place.day) return 0;
    const window = overlapWindow(place, slot);
    return window ? window.end - window.start : 0;
  };
  for (const name of names) {
    const ids = idsByName.get(name) ?? [name];
    const slot = timetable.find((item) => item.act_id !== actId && ids.includes(item.act_id));
    if (slot) out.set(name, { before: minutes(home, slot), after: minutes(after, slot) });
  }
  return out;
}

/** The kept clashes split by what the move does to their shared minutes; `unknown` when a time does not read. */
export type KeptSplit = {
  shorter: SharedChange[];
  longer: SharedChange[];
  unchanged: SharedChange[];
  unknown: string[];
};

/** Splits the kept clashes into shorter, longer and unchanged by their shared minutes before and after. */
export function splitKept(keeps: ClashChanges["keeps"], shared: SharedByName | null | undefined): KeptSplit {
  const split: KeptSplit = { shorter: [], longer: [], unchanged: [], unknown: [] };
  for (const keep of keeps) {
    const minutes = shared?.get(keep.name);
    if (!minutes) split.unknown.push(keep.name);
    else {
      const change = { name: keep.name, ...minutes };
      if (minutes.after < minutes.before) split.shorter.push(change);
      else if (minutes.after > minutes.before) split.longer.push(change);
      else split.unchanged.push(change);
    }
  }
  return split;
}

/** One part of the Clashes row: a count, its word, and the minutes when exactly one clash got shorter or longer. */
export type ClashPart = { count: number; word: string; minutes: { before: number; after: number } | null };

/**
 * The Clashes row in order: shortened, lengthened and unchanged (each only above 0), kept (only for clashes
 * whose minutes do not read), then added and removed, always. "1 shortened (45 → 30 min), 2 unchanged,
 * 0 added, 0 removed".
 */
export function clashParts(changes: ClashChanges, shared: SharedByName | null | undefined): ClashPart[] {
  const split = splitKept(changes.keeps, shared);
  const parts: ClashPart[] = [];
  const sized = (list: SharedChange[], word: string, withMinutes = true) => {
    if (list.length === 0) return;
    const only = withMinutes && list.length === 1 ? list[0] : null;
    parts.push({ count: list.length, word, minutes: only ? { before: only.before, after: only.after } : null });
  };
  sized(split.shorter, "shortened");
  sized(split.longer, "lengthened");
  sized(split.unchanged, "unchanged", false);
  if (split.unknown.length > 0) parts.push({ count: split.unknown.length, word: "kept", minutes: null });
  parts.push({ count: changes.adds.length, word: "added", minutes: null });
  parts.push({ count: changes.ends.length, word: "removed", minutes: null });
  return parts;
}

/** The Clashes row as plain words, for tests and the screen reader's reading: "1 shortened (45 → 30 min), 2 unchanged, 0 added, 0 removed". */
export function clashWords(parts: readonly ClashPart[]): string {
  return parts
    .map((part) => `${part.count} ${part.word}${part.minutes ? ` (${part.minutes.before} → ${part.minutes.after} min)` : ""}`)
    .join(", ");
}
