/**
 * A plan of kept moves: "Try a move" lets a visitor keep a move and test the next one on top of it.
 * The kept moves are priced together by `POST /api/presets/{id}/whatif`, which applies them in
 * order to the published timetable and answers with the Clash Budget Index after each step, the
 * costliest clashes of the moved timetable and, when a set is picked, its legal places on top of
 * the plan. Everything is tested only: the published timetable never changes, and the server
 * computes every figure. This module encodes the plan for a link, builds the request, validates
 * the answer and words it. Pure functions apart from `fetchPlan`, so they are unit tested.
 *
 * T4's brief page and T5's grid import from here (round-4 contract D), so the exports below keep
 * their names and shapes.
 */

import { pluralize } from "./format";
import { isRecord } from "./events";
import { clockMinutes, parseMoves, type MovesResult, type Placement } from "./moves";
import type { SetSlot } from "./preset";

/** The most moves one plan holds; the server refuses a ninth. */
export const MAX_STACK = 8;

/** How many priced places a plan request asks for, as `GET /moves` does. */
export const PLAN_LIMIT = 8;

/** One kept move: where and when the set plays in the plan. `start` is "20:30". */
export type StackMove = { actId: string; stageId: string; day: number; start: string };

/** One step of a priced plan, as the server words and prices it. */
export type PlanStep = {
  act: string;
  actId: string;
  /** "Act One: West Stage 20:00-21:00 -> West Stage 20:30-21:30". */
  move: string;
  stage: string;
  stageId: string;
  day: number;
  /** "20:30"; hours may pass 23 for a set after midnight. */
  start: string;
  end: string;
  /** The Clash Budget Index with this step and every step before it. */
  budgetAfter: number;
};

/** One of the moved timetable's costliest clashes, in index points (one decimal, from the server). */
export type PlanClash = { a: string; b: string; points: number };

export type Plan = {
  /** The published timetable's Clash Budget Index. */
  publishedBudget: number;
  /** The Clash Budget Index with every kept move; equal to `publishedBudget` with none. */
  budget: number;
  steps: PlanStep[];
  /** At most five, costliest first. */
  clashes: PlanClash[];
  /** The picked set's legal places on top of the plan, or null when no set was asked about. */
  options: MovesResult | null;
};

/** The range random valid timetables of this lineup score in (10th to 90th percentile). */
export type ScaleRange = { low: number; high: number } | null;

/** A set drawn at its tested place on the grid. Times are minutes from the start of the day. */
export type GhostSlot = { actId: string; stageId: string; day: number; start: number; end: number };

/** What the grid may draw: the kept moves, and the place being tried on top of them. */
export type PlanPreview = { kept: GhostSlot[]; trying: GhostSlot | null };

// ------------------------------------------------------------------------------------ encoding

/** An id or a field of an encoded move: word characters, dots and dashes, never only dots. */
const FIELD = /^[\w.-]{1,80}$/;
const ONLY_DOTS = /^\.+$/;
/** "2030" or "930": the start with its colon dropped. */
const COMPACT_TIME = /^(\d{1,2})([0-5]\d)$/;
/** The days the server accepts. */
const MAX_DAY = 13;
/** Longer than eight moves of the longest fields could be, so it is not a plan. */
const MAX_ENCODED = MAX_STACK * (80 * 2 + 2 + 4 + 3) + MAX_STACK;

/** True for an id this module will put in a link or a request path. */
export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && FIELD.test(value) && !ONLY_DOTS.test(value);
}

/** "act-one~west-stage~0~2030,act-two~...": each move as `actId~stageId~day~HHMM`. */
export function encodeMoves(moves: readonly StackMove[]): string {
  return moves.map((move) => [move.actId, move.stageId, String(move.day), move.start.replace(":", "")].join("~")).join(",");
}

function decodeOne(text: string): StackMove | null {
  const fields = text.split("~");
  if (fields.length !== 4 || !fields.every((field) => FIELD.test(field))) return null;
  const [actId, stageId, dayText, time] = fields;
  if (ONLY_DOTS.test(actId) || ONLY_DOTS.test(stageId)) return null;
  if (!/^\d{1,2}$/.test(dayText) || Number(dayText) > MAX_DAY) return null;
  const clock = COMPACT_TIME.exec(time);
  if (!clock) return null;
  return { actId, stageId, day: Number(dayText), start: `${clock[1]}:${clock[2]}` };
}

/**
 * The moves in a link or in session storage. Never throws: anything malformed, a set listed twice
 * or more than eight moves gives an empty plan.
 */
export function decodeMoves(text: string | null | undefined): StackMove[] {
  try {
    if (typeof text !== "string" || !text || text.length > MAX_ENCODED) return [];
    const parts = text.split(",");
    if (parts.length > MAX_STACK) return [];
    const moves: StackMove[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
      const move = decodeOne(part);
      if (!move || seen.has(move.actId)) return [];
      seen.add(move.actId);
      moves.push(move);
    }
    return moves;
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------------------------ request

/** The request body: the moves in order, the set to price places for (or null) and the limit. */
export function planBody(moves: readonly StackMove[], actId: string | null, limit: number = PLAN_LIMIT): string {
  return JSON.stringify({
    moves: moves.map((move) => ({ act: move.actId, stage_id: move.stageId, day: move.day, start: move.start })),
    act: actId,
    limit,
  });
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readStep(value: unknown): PlanStep | null {
  if (!isRecord(value)) return null;
  const { act, act_id, move, stage, stage_id, day, start, end, budget_after } = value;
  if (
    !text(act) ||
    !text(act_id) ||
    !text(move) ||
    !text(stage) ||
    !text(stage_id) ||
    !finite(day) ||
    !text(start) ||
    !text(end) ||
    !finite(budget_after)
  ) {
    return null;
  }
  return { act, actId: act_id, move, stage, stageId: stage_id, day, start, end, budgetAfter: budget_after };
}

function readClash(value: unknown): PlanClash | null {
  if (!isRecord(value) || !text(value.a) || !text(value.b) || !finite(value.points)) return null;
  return { a: value.a, b: value.b, points: value.points };
}

/**
 * Validates the plan endpoint's answer. Null when anything the page prints is missing or of the
 * wrong type, so a contract change shows the error state instead of a half-drawn card. Never throws.
 */
export function parsePlan(json: unknown): Plan | null {
  try {
    if (!isRecord(json) || json.kind !== "whatif" || !finite(json.published_budget)) return null;
    const plan = json.plan;
    if (!isRecord(plan) || !finite(plan.budget) || !Array.isArray(plan.steps) || !Array.isArray(plan.clashes)) {
      return null;
    }
    if (plan.steps.length > MAX_STACK) return null;
    const steps: PlanStep[] = [];
    for (const item of plan.steps) {
      const step = readStep(item);
      if (!step) return null;
      steps.push(step);
    }
    const clashes: PlanClash[] = [];
    for (const item of plan.clashes) {
      const clash = readClash(item);
      if (!clash) return null;
      clashes.push(clash);
    }
    let options: MovesResult | null = null;
    if (json.options !== null && json.options !== undefined) {
      options = parseMoves(json.options);
      if (!options) return null;
    }
    return { publishedBudget: json.published_budget, budget: plan.budget, steps, clashes, options };
  } catch {
    return null;
  }
}

/** The answer to a plan request: priced, refused as impossible (422), or not priced. */
export type PlanAnswer = { status: "ready"; plan: Plan } | { status: "invalid" } | { status: "error" };

/** True when the answer is about these moves, in this order, and about this set. */
function answers(plan: Plan, moves: readonly StackMove[], actId: string | null): boolean {
  if (plan.steps.length !== moves.length) return false;
  if (plan.steps.some((step, i) => step.actId !== moves[i].actId || step.stageId !== moves[i].stageId)) return false;
  return actId === null ? plan.options === null : plan.options?.actId === actId;
}

/**
 * Prices a plan: `POST /api/presets/{id}/whatif` with the moves, the set to price places for and
 * the limit. A 422 (a step that is no longer legal, a set listed twice) is `invalid`; any other
 * failure, or an answer about another plan, is `error`. Never throws.
 */
export async function requestPlan(
  presetId: string,
  moves: readonly StackMove[],
  actId: string | null,
  signal?: AbortSignal,
): Promise<PlanAnswer> {
  if (!isSafeId(presetId) || moves.length > MAX_STACK || (actId !== null && !isSafeId(actId))) {
    return { status: "error" };
  }
  try {
    const response = await fetch(`/api/presets/${encodeURIComponent(presetId)}/whatif`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: planBody(moves, actId, PLAN_LIMIT),
      cache: "no-store",
      signal,
    });
    if (response.status === 422) return { status: "invalid" };
    if (!response.ok) return { status: "error" };
    const plan = parsePlan(await response.json().catch(() => null));
    return plan && answers(plan, moves, actId) ? { status: "ready", plan } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** The priced plan, or null when it could not be priced for any reason. Never throws. */
export async function fetchPlan(
  presetId: string,
  moves: readonly StackMove[],
  actId: string | null,
  signal?: AbortSignal,
): Promise<Plan | null> {
  const answer = await requestPlan(presetId, moves, actId, signal);
  return answer.status === "ready" ? answer.plan : null;
}

// ------------------------------------------------------------------------------------ wording

/**
 * Where a Clash Budget Index sits against the range random valid timetables of this lineup score,
 * compared as the page prints them (the index to one decimal, the range in whole numbers), so the
 * words never contradict the figures. Null when the range is unknown.
 */
export function rangeVerdict(value: number, range: ScaleRange): "below" | "inside" | "above" | null {
  if (!range || !Number.isFinite(value) || !Number.isFinite(range.low) || !Number.isFinite(range.high)) return null;
  const shown = Math.round(value * 10) / 10;
  if (shown < Math.round(range.low)) return "below";
  if (shown > Math.round(range.high)) return "above";
  return "inside";
}

/**
 * How a step moves its set from where it was (`from`, on the stage called `stageName`): "30
 * minutes earlier, same stage", "1 minute later, same stage", or "Moves to West Stage, 20:30".
 */
export function shiftText(from: Placement | null, step: PlanStep, stageName: string): string {
  const elsewhere = `Moves to ${step.stage}, ${step.start}`;
  if (!from || from.day !== step.day || step.stage !== stageName) return elsewhere;
  const start = clockMinutes(step.start);
  if (start === null || start === from.start) return elsewhere;
  const minutes = pluralize(Math.abs(start - from.start), "minute");
  return `${minutes} ${start < from.start ? "earlier" : "later"}, same stage`;
}

/** The one-page brief for this day, with the kept moves when there are any. */
export function briefHref(presetId: string, day: number, moves: readonly StackMove[]): string {
  const base = `/brief?preset=${encodeURIComponent(presetId)}&day=${encodeURIComponent(String(day))}`;
  return moves.length > 0 ? `${base}&moves=${encodeURIComponent(encodeMoves(moves))}` : base;
}

// ------------------------------------------------------------------------------------ the page

/**
 * Sets worth trying next on top of a plan: the acts of the moved timetable's costliest clashes, in
 * that order, each once, leaving out locked sets, sets already moved and names not on this day.
 */
export function planStarters(
  clashes: readonly PlanClash[],
  sets: readonly { actId: string; name: string; locked: boolean }[],
  moved: ReadonlySet<string>,
  limit = 4,
): { actId: string; name: string }[] {
  const byName = new Map<string, { actId: string; name: string; locked: boolean }>();
  for (const set of sets) if (!byName.has(set.name)) byName.set(set.name, set);
  const picked: { actId: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const clash of clashes) {
    for (const name of [clash.a, clash.b]) {
      if (picked.length >= limit) return picked;
      const set = byName.get(name);
      if (!set || set.locked || moved.has(set.actId) || seen.has(set.actId)) continue;
      seen.add(set.actId);
      picked.push({ actId: set.actId, name: set.name });
    }
  }
  return picked;
}

/** A kept move as the grid draws it; the set keeps its published length. Null for an unknown set. */
export function ghostSlot(timetable: readonly SetSlot[], move: StackMove): GhostSlot | null {
  const slot = timetable.find((item) => item.act_id === move.actId);
  const start = clockMinutes(move.start);
  if (!slot || start === null) return null;
  return { actId: move.actId, stageId: move.stageId, day: move.day, start, end: start + (slot.end - slot.start) };
}

/**
 * The published timetable with the kept moves' sets at their tested places, each keeping its
 * length: where every set plays in the plan, so the page can tell which sets would play at the same
 * time. Positions only; every price still comes from the server.
 */
export function applyMoves(timetable: readonly SetSlot[], moves: readonly StackMove[]): SetSlot[] {
  if (moves.length === 0) return [...timetable];
  const ghosts = new Map(moves.flatMap((move) => {
    const ghost = ghostSlot(timetable, move);
    return ghost ? [[move.actId, ghost] as const] : [];
  }));
  return timetable.map((slot) => {
    const ghost = ghosts.get(slot.act_id);
    return ghost ? { ...slot, day: ghost.day, stage_id: ghost.stageId, start: ghost.start, end: ghost.end } : slot;
  });
}

/** What the grid may draw for these kept moves and the place being tried; null when neither. */
export function planPreview(
  timetable: readonly SetSlot[],
  moves: readonly StackMove[],
  trying: GhostSlot | null,
): PlanPreview | null {
  const kept = moves.flatMap((move) => ghostSlot(timetable, move) ?? []);
  return kept.length === 0 && trying === null ? null : { kept, trying };
}

/** Where a plan is kept for the page's tab, so it survives a reload and a visit to the brief. */
export function planStorageKey(presetId: string): string {
  return `clash-plan:${presetId}`;
}

type PlanStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): PlanStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The plan kept for this preset in this tab, or an empty one. Never throws. */
export function readStoredMoves(presetId: string, storage: PlanStorage | null = sessionStore()): StackMove[] {
  try {
    return storage ? decodeMoves(storage.getItem(planStorageKey(presetId))) : [];
  } catch {
    return [];
  }
}

/** Keeps the plan for this preset in this tab; an empty plan removes it. Never throws. */
export function storeMoves(
  presetId: string,
  moves: readonly StackMove[],
  storage: PlanStorage | null = sessionStore(),
): void {
  try {
    if (!storage) return;
    if (moves.length === 0) storage.removeItem(planStorageKey(presetId));
    else storage.setItem(planStorageKey(presetId), encodeMoves(moves));
  } catch {
    // Storage can be full or blocked; the plan still works for this page's life.
  }
}
