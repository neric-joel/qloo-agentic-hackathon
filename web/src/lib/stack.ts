/**
 * A plan of kept steps: "Try a move" lets a visitor keep a move and test the next one on top of it,
 * and "Keep two sets apart" lets them keep one listed change as one step. A step is a single move
 * or a rule step (the one or two changes of a listed change, with the pair it serves). The kept
 * steps are priced together by `POST /api/presets/{id}/whatif`, which applies them in order to the
 * published timetable and answers with the Clash Budget Index after each step, the costliest
 * clashes of the moved timetable and, when a set is picked, its legal places on top of the plan. A
 * rule step is answered with the pair, its places and a receipt (whether the pair shares time after
 * the whole plan, and how many rule breaks the plan adds). Everything is tested only: the published
 * timetable never changes, and the server computes every figure. This module encodes the plan for a
 * link, builds the request, validates the answer and words it. Pure functions apart from
 * `fetchPlan`, so they are unit tested.
 *
 * T4's brief page and T5's grid import from here (round-4 contract D), so the exports below keep
 * their names and shapes.
 */

import { budgetDelta, changeLabel } from "./agent-session";
import { pluralize } from "./format";
import { isRecord } from "./events";
import { clockMinutes, parseMoves, type MovesResult, type Placement } from "./moves";
import type { SetSlot } from "./preset";

/** The most moves one plan holds, counted over every step (a two-set change counts 2); the server refuses a ninth. */
export const MAX_STACK = 8;

/** How many priced places a plan request asks for, as `GET /moves` does. */
export const PLAN_LIMIT = 8;

/** One kept move: where and when the set plays in the plan. `start` is "20:30". */
export type StackMove = { actId: string; stageId: string; day: number; start: string };

/**
 * One kept change from "Keep two sets apart": the pair it serves and the one or two moves of the
 * listed change, in the order the list gives them. Judged and priced as one step.
 */
export type RuleStackStep = { rule: { aId: string; bId: string }; moves: StackMove[] };

/** What a plan holds: a single move or a rule step. */
export type StackStep = StackMove | RuleStackStep;

/** True for a rule step. */
export function isRuleStackStep(step: StackStep): step is RuleStackStep {
  return "rule" in step;
}

/** The moves a step makes, in order. */
export function stepMoves(step: StackStep): readonly StackMove[] {
  return isRuleStackStep(step) ? step.moves : [step];
}

/** How many of the plan's eight moves these steps use (a two-set change counts 2). */
export function moveCount(steps: readonly StackStep[]): number {
  return steps.reduce((sum, step) => sum + stepMoves(step).length, 0);
}

/** Every set the steps move, each once. */
export function movedActs(steps: readonly StackStep[]): Set<string> {
  return new Set(steps.flatMap((step) => stepMoves(step).map((move) => move.actId)));
}

/** True when two rule steps are the same change: the same pair and the same places, in order. */
export function sameRuleStep(a: RuleStackStep, b: RuleStackStep): boolean {
  return (
    a.rule.aId === b.rule.aId &&
    a.rule.bId === b.rule.bId &&
    a.moves.length === b.moves.length &&
    a.moves.every(
      (move, i) =>
        move.actId === b.moves[i].actId &&
        move.stageId === b.moves[i].stageId &&
        move.day === b.moves[i].day &&
        move.start === b.moves[i].start,
    )
  );
}

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

/** One set of a rule step, as the server words it. */
export type PlanPlaced = {
  act: string;
  actId: string;
  /** "Act One: West Stage 20:00-21:00 -> West Stage 20:30-21:30". */
  move: string;
  stage: string;
  stageId: string;
  day: number;
  start: string;
  end: string;
};

/** A rule step of a priced plan: the pair, its places, the index after it and the receipt. */
export type PlanRuleStep = {
  rule: { a: { actId: string; act: string }; b: { actId: string; act: string } };
  moves: PlanPlaced[];
  /** The Clash Budget Index with this step and every step before it. */
  budgetAfter: number;
  /** After the whole plan (later steps included) the pair shares no minute. */
  ruleHoldsAfter: boolean;
  /** Rule breaks the plan's timetable has that the published day did not. */
  newBreaks: number;
};

/** A step of a priced plan: a single move or a rule step. */
export type PlanEntry = PlanStep | PlanRuleStep;

/** True for a rule step of a priced plan. */
export function isPlanRuleStep(step: PlanEntry): step is PlanRuleStep {
  return "rule" in step;
}

/** One of the moved timetable's costliest clashes, in index points (one decimal, from the server). */
export type PlanClash = { a: string; b: string; points: number };

export type Plan = {
  /** The published timetable's Clash Budget Index. */
  publishedBudget: number;
  /** The Clash Budget Index with every kept move; equal to `publishedBudget` with none. */
  budget: number;
  steps: PlanEntry[];
  /** At most five, costliest first. */
  clashes: PlanClash[];
  /** The picked set's legal places on top of the plan, or null when no set was asked about. */
  options: MovesResult | null;
};

/** The middle 80% of random valid timetables of this lineup (10th to 90th percentile). */
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
/** Longer than eight steps of the longest fields could be, so it is not a plan. */
const MAX_ENCODED = MAX_STACK * (2 * (80 * 2 + 2 + 4 + 3) + 80 * 2 + 8);
/** A rule step's token starts with this, then the pair, then its moves; no single move has seven fields. */
const RULE_TAG = "r";

/** True for an id this module will put in a link or a request path. */
export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && FIELD.test(value) && !ONLY_DOTS.test(value);
}

function encodeOne(move: StackMove): string {
  return [move.actId, move.stageId, String(move.day), move.start.replace(":", "")].join("~");
}

/**
 * "act-one~west-stage~0~2030,r~a~b~act-two~east~0~915|act-three~west~0~1000": a single move as
 * `actId~stageId~day~HHMM`, a rule step as `r~aId~bId~` and its one or two moves joined by `|`;
 * steps are joined by commas. A link made before rule steps existed reads as it always did.
 */
export function encodeMoves(steps: readonly StackStep[]): string {
  return steps
    .map((step) =>
      isRuleStackStep(step)
        ? `${RULE_TAG}~${step.rule.aId}~${step.rule.bId}~${step.moves.map(encodeOne).join("|")}`
        : encodeOne(step),
    )
    .join(",");
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

function decodeRule(text: string): RuleStackStep | null {
  const segments = text.split("|");
  if (segments.length > 2) return null;
  const head = segments[0].split("~");
  // r, a, b and the first move's four fields.
  if (head.length !== 7 || head[0] !== RULE_TAG) return null;
  const [, aId, bId] = head;
  if (!isSafeId(aId) || !isSafeId(bId) || aId === bId) return null;
  const moves: StackMove[] = [];
  for (const piece of [head.slice(3).join("~"), ...segments.slice(1)]) {
    const move = decodeOne(piece);
    if (!move || moves.some((other) => other.actId === move.actId)) return null;
    moves.push(move);
  }
  return { rule: { aId, bId }, moves };
}

/**
 * The steps in a link or in session storage. Never throws: anything malformed, a set kept twice as
 * a single move or twice inside one rule step, more than eight steps or more than eight moves in
 * all gives an empty plan. A rule step may move a set an earlier step moved.
 */
export function decodeMoves(text: string | null | undefined): StackStep[] {
  try {
    if (typeof text !== "string" || !text || text.length > MAX_ENCODED) return [];
    const parts = text.split(",");
    if (parts.length > MAX_STACK) return [];
    const steps: StackStep[] = [];
    const singles = new Set<string>();
    for (const part of parts) {
      if (part.split("~").length === 4) {
        const move = decodeOne(part);
        if (!move || singles.has(move.actId)) return [];
        singles.add(move.actId);
        steps.push(move);
      } else {
        const rule = decodeRule(part);
        if (!rule) return [];
        steps.push(rule);
      }
    }
    return moveCount(steps) > MAX_STACK ? [] : steps;
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------------------------ request

function moveBody(move: StackMove) {
  return { act: move.actId, stage_id: move.stageId, day: move.day, start: move.start };
}

/**
 * The request body: the steps in order, the set to price places for (or null) and the limit. A
 * single move is `{act, stage_id, day, start}`; a rule step is `{rule: {a, b}, moves: [...]}` with
 * the one or two moves of the change.
 */
export function planBody(steps: readonly StackStep[], actId: string | null, limit: number = PLAN_LIMIT): string {
  return JSON.stringify({
    moves: steps.map((step) =>
      isRuleStackStep(step)
        ? { rule: { a: step.rule.aId, b: step.rule.bId }, moves: step.moves.map(moveBody) }
        : moveBody(step),
    ),
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

function readPlaced(value: unknown): PlanPlaced | null {
  if (!isRecord(value)) return null;
  const { act, act_id, move, stage, stage_id, day, start, end } = value;
  if (
    !text(act) ||
    !text(act_id) ||
    !text(move) ||
    !text(stage) ||
    !text(stage_id) ||
    !finite(day) ||
    !text(start) ||
    !text(end)
  ) {
    return null;
  }
  return { act, actId: act_id, move, stage, stageId: stage_id, day, start, end };
}

function readSide(value: unknown): { actId: string; act: string } | null {
  if (!isRecord(value) || !text(value.act_id) || !text(value.act)) return null;
  return { actId: value.act_id, act: value.act };
}

function readStep(value: unknown): PlanEntry | null {
  if (!isRecord(value)) return null;
  if ("rule" in value) {
    const { rule, moves, budget_after, rule_holds_after, new_breaks } = value;
    if (!isRecord(rule) || !Array.isArray(moves) || moves.length < 1 || moves.length > 2) return null;
    if (!finite(budget_after) || typeof rule_holds_after !== "boolean") return null;
    if (!finite(new_breaks) || !Number.isInteger(new_breaks) || new_breaks < 0) return null;
    const a = readSide(rule.a);
    const b = readSide(rule.b);
    if (!a || !b) return null;
    const placed: PlanPlaced[] = [];
    for (const item of moves) {
      const move = readPlaced(item);
      if (!move) return null;
      placed.push(move);
    }
    return {
      rule: { a, b },
      moves: placed,
      budgetAfter: budget_after,
      ruleHoldsAfter: rule_holds_after,
      newBreaks: new_breaks,
    };
  }
  const placed = readPlaced(value);
  if (!placed || !finite(value.budget_after)) return null;
  return { ...placed, budgetAfter: value.budget_after };
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
    const steps: PlanEntry[] = [];
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

/** True when a priced step is about the step that was asked, kind and sets alike. */
function stepAnswers(priced: PlanEntry, asked: StackStep): boolean {
  if (isPlanRuleStep(priced) || isRuleStackStep(asked)) {
    if (!isPlanRuleStep(priced) || !isRuleStackStep(asked)) return false;
    return (
      priced.rule.a.actId === asked.rule.aId &&
      priced.rule.b.actId === asked.rule.bId &&
      priced.moves.length === asked.moves.length &&
      priced.moves.every((move, i) => move.actId === asked.moves[i].actId && move.stageId === asked.moves[i].stageId)
    );
  }
  return priced.actId === asked.actId && priced.stageId === asked.stageId;
}

/** True when the answer is about these steps, in this order, and about this set. */
function answers(plan: Plan, steps: readonly StackStep[], actId: string | null): boolean {
  if (plan.steps.length !== steps.length) return false;
  if (plan.steps.some((step, i) => !stepAnswers(step, steps[i]))) return false;
  return actId === null ? plan.options === null : plan.options?.actId === actId;
}

/**
 * Prices a plan: `POST /api/presets/{id}/whatif` with the steps, the set to price places for and
 * the limit. A 422 (a step that is no longer legal, a set listed twice) is `invalid`; any other
 * failure, or an answer about another plan, is `error`. Never throws.
 */
export async function requestPlan(
  presetId: string,
  moves: readonly StackStep[],
  actId: string | null,
  signal?: AbortSignal,
): Promise<PlanAnswer> {
  if (
    !isSafeId(presetId) ||
    moves.length > MAX_STACK ||
    moveCount(moves) > MAX_STACK ||
    (actId !== null && !isSafeId(actId))
  ) {
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
  moves: readonly StackStep[],
  actId: string | null,
  signal?: AbortSignal,
): Promise<Plan | null> {
  const answer = await requestPlan(presetId, moves, actId, signal);
  return answer.status === "ready" ? answer.plan : null;
}

// ------------------------------------------------------------------------------------ wording

/**
 * Where a Clash Budget Index sits against the middle 80% of random valid timetables of this lineup,
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

/** "Sprints → The Park 15:00–16:00": one set of a rule step, where it plays in the plan. */
export function placedLine(move: Pick<PlanPlaced, "act" | "stage" | "start" | "end">): string {
  return `${move.act} → ${move.stage} ${move.start}–${move.end}`;
}

/** "Keep Sprints and Katy J Pearson apart: Sprints → The Park 15:00–16:00; Royel Otis → Woodsies 14:30–15:15". */
export function ruleStepLine(step: Pick<PlanRuleStep, "rule" | "moves">): string {
  return `Keep ${step.rule.a.act} and ${step.rule.b.act} apart: ${step.moves.map(placedLine).join("; ")}`;
}

/**
 * What the server says about a rule step, as a fact: "After this plan they share no time, and the
 * plan adds no rule break." (the pair shares no minute after the whole plan and the plan adds no
 * rule break), "After this plan they still share time." (a later step can undo the change), or
 * "The plan adds 1 rule break." (the count is the server's; it follows with the shared-time fact
 * when the pair still shares time).
 */
export function ruleReceipt(step: Pick<PlanRuleStep, "ruleHoldsAfter" | "newBreaks">): string {
  if (step.newBreaks > 0) {
    const breaks = `The plan adds ${pluralize(step.newBreaks, "rule break")}.`;
    return step.ruleHoldsAfter ? breaks : `${breaks} After this plan they still share time.`;
  }
  return step.ruleHoldsAfter
    ? "After this plan they share no time, and the plan adds no rule break."
    : "After this plan they still share time.";
}

/**
 * What the page's status region says once a plan is priced after Keep, Undo or Start over: "Plan:
 * 2 kept moves. Clash Budget Index 116.7 to 106.6, 10.1 lower." (or "0.6 higher", "no change"),
 * read from the server's plan answer to one decimal; "kept steps" when the plan holds a rule step,
 * then the last rule step's receipt; "Plan cleared." with no steps; nothing while the plan is still
 * being priced.
 */
export function planAnnouncement(
  plan: (Pick<Plan, "publishedBudget" | "budget"> & { steps?: readonly PlanEntry[] }) | null,
  count: number,
): string {
  if (count === 0) return "Plan cleared.";
  if (!plan) return "";
  const delta = budgetDelta(plan.publishedBudget, plan.budget) ?? 0;
  const change = delta === 0 ? "no change" : changeLabel(delta);
  const rules = (plan.steps ?? []).filter(isPlanRuleStep);
  const last = rules.at(-1);
  const receipt = last ? ` ${last.rule.a.act} and ${last.rule.b.act}: ${ruleReceipt(last)}` : "";
  const noun = rules.length > 0 ? "kept step" : "kept move";
  return `Plan: ${pluralize(count, noun)}. Clash Budget Index ${plan.publishedBudget.toFixed(1)} to ${plan.budget.toFixed(1)}, ${change}.${receipt}`;
}

/** The one-page brief for this day, with the kept steps when there are any. */
export function briefHref(presetId: string, day: number, moves: readonly StackStep[]): string {
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
export function applyMoves(timetable: readonly SetSlot[], steps: readonly StackStep[]): SetSlot[] {
  if (steps.length === 0) return [...timetable];
  const ghosts = new Map(steps.flatMap(stepMoves).flatMap((move) => {
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
  steps: readonly StackStep[],
  trying: GhostSlot | null,
): PlanPreview | null {
  // One ghost per set, at the place the last step that moves it leaves it (a rule step may move a
  // set an earlier step moved).
  const ghosts = new Map<string, GhostSlot>();
  for (const move of steps.flatMap(stepMoves)) {
    const ghost = ghostSlot(timetable, move);
    if (ghost) ghosts.set(move.actId, ghost);
  }
  const kept = [...ghosts.values()];
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
export function readStoredMoves(presetId: string, storage: PlanStorage | null = sessionStore()): StackStep[] {
  try {
    return storage ? decodeMoves(storage.getItem(planStorageKey(presetId))) : [];
  } catch {
    return [];
  }
}

/** Keeps the plan for this preset in this tab; an empty plan removes it. Never throws. */
export function storeMoves(
  presetId: string,
  moves: readonly StackStep[],
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
