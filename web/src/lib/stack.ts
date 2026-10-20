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

import { budgetDelta, changeLabel, oneDecimal } from "./agent-session";
import { pluralize } from "./format";
import { isRecord } from "./events";
import { clockMinutes, isFromRecordedRun, parseMoves, type MoveSource, type MovesResult, type Placement } from "./moves";
import type { SetSlot } from "./preset";

/** The most moves one plan holds, counted over every step (a two-set change counts 2); the server refuses a ninth. */
export const MAX_STACK = 8;

/** How many priced places a plan request asks for, as `GET /moves` does. */
export const PLAN_LIMIT = 8;

/**
 * One kept move: where and when the set plays in the plan. `start` is "20:30". `source` says where it came
 * from when the plan list should say so (a recorded agent run); it never changes how the move is compared,
 * encoded or sent, and a move saved before it existed simply has none.
 */
export type StackMove = { actId: string; stageId: string; day: number; start: string; source?: MoveSource };

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
    a.moves.every((move, i) => sameMove(move, b.moves[i]))
  );
}

/** True when two moves put the same set in the same place at the same time. */
function sameMove(a: StackMove, b: StackMove): boolean {
  // Times compare as minutes, so "9:15" and "09:15" are one time.
  return (
    a.actId === b.actId &&
    a.stageId === b.stageId &&
    a.day === b.day &&
    (a.start === b.start || (clockMinutes(a.start) !== null && clockMinutes(a.start) === clockMinutes(b.start)))
  );
}

/** True when two steps are the same: the same move, or the same change for the same pair. */
export function sameStep(a: StackStep, b: StackStep): boolean {
  if (isRuleStackStep(a) || isRuleStackStep(b)) {
    return isRuleStackStep(a) && isRuleStackStep(b) && sameRuleStep(a, b);
  }
  return sameMove(a, b);
}

/** True when two rule steps serve the same pair of sets, in either order. */
export function sameRulePair(a: RuleStackStep, b: RuleStackStep): boolean {
  return (
    (a.rule.aId === b.rule.aId && a.rule.bId === b.rule.bId) ||
    (a.rule.aId === b.rule.bId && a.rule.bId === b.rule.aId)
  );
}

/**
 * What keeping a listed change does to a plan: nothing when the plan already holds it (`same`); it takes
 * the place of the plan's earlier change for the same pair (`replaced`, in the same position, so a
 * second change for a pair is never refused as impossible); it is added at the end (`added`); or the
 * plan has no room for it (`full`, the plan unchanged). A two-set change counts 2 of the 8 moves, and
 * the moves of a change it replaces are freed first.
 */
export function keepChangeInPlan(
  plan: readonly StackStep[],
  step: RuleStackStep,
): { kind: "same" | "replaced" | "added" | "full"; steps: StackStep[]; replaced: RuleStackStep | null } {
  if (plan.some((item) => sameStep(item, step))) return { kind: "same", steps: [...plan], replaced: null };
  const at = plan.findIndex((item) => isRuleStackStep(item) && sameRulePair(item, step));
  const rest = at >= 0 ? plan.filter((_, i) => i !== at) : plan;
  if (moveCount(rest) + step.moves.length > MAX_STACK) return { kind: "full", steps: [...plan], replaced: null };
  const earlier = at >= 0 ? plan[at] : null;
  if (earlier && isRuleStackStep(earlier)) {
    return { kind: "replaced", steps: plan.map((item, i) => (i === at ? step : item)), replaced: earlier };
  }
  return { kind: "added", steps: [...plan, step], replaced: null };
}

/**
 * What keeping `seed` does to a plan that is not empty: nothing when the plan already holds it
 * (`same`), else it takes the plan's place (`replace`, `dropped` steps lost) as the decision card's
 * buttons do, or simply starts the plan (`fresh`).
 */
export function seedOutcome(
  plan: readonly StackStep[],
  seed: StackStep,
): { kind: "same" | "replace" | "fresh"; dropped: number } {
  if (plan.some((step) => sameStep(step, seed))) return { kind: "same", dropped: 0 };
  return plan.length > 0 ? { kind: "replace", dropped: plan.length } : { kind: "fresh", dropped: 0 };
}

/** One step of a scored plan, as the server words and scores it. */
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

/** True when a priced place is the one that was asked: the set, stage, day and start time alike. */
function placeAnswers(
  priced: Pick<PlanPlaced, "actId" | "stageId" | "day" | "start">,
  asked: StackMove,
): boolean {
  if (priced.actId !== asked.actId || priced.stageId !== asked.stageId || priced.day !== asked.day) return false;
  // Compared as minutes, so "9:15" and "09:15" are the same time.
  const pricedStart = clockMinutes(priced.start);
  return pricedStart !== null && pricedStart === clockMinutes(asked.start);
}

/** True when a priced step is about the step that was asked, kind, sets, days and times alike. */
function stepAnswers(priced: PlanEntry, asked: StackStep): boolean {
  if (isPlanRuleStep(priced) || isRuleStackStep(asked)) {
    if (!isPlanRuleStep(priced) || !isRuleStackStep(asked)) return false;
    return (
      priced.rule.a.actId === asked.rule.aId &&
      priced.rule.b.actId === asked.rule.bId &&
      priced.moves.length === asked.moves.length &&
      priced.moves.every((move, i) => placeAnswers(move, asked.moves[i]))
    );
  }
  return placeAnswers(priced, asked);
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
  const shown = oneDecimal(value);
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

/**
 * "Change to keep Sprints and Katy J Pearson apart: Sprints → The Park 15:00–16:00; Royel Otis →
 * Woodsies 14:30–15:15". The heading names what the change is meant to do; the receipt under it
 * says whether the finished plan does it.
 */
export function ruleStepLine(step: Pick<PlanRuleStep, "rule" | "moves">): string {
  return `Change to keep ${step.rule.a.act} and ${step.rule.b.act} apart: ${step.moves.map(placedLine).join("; ")}`;
}

/**
 * What the server says about a rule step, as a fact that confirms or denies the outcome: "Confirmed:
 * after this plan they share no time, and the plan adds no rule break." (the pair shares no minute
 * after the whole plan and the plan adds no rule break), "Not confirmed: after this plan they still
 * share time." (a later step can undo the change), or, with rule breaks (the count is the server's),
 * "After this plan they share no time, but the plan adds 1 rule break."
 */
export function ruleReceipt(step: Pick<PlanRuleStep, "ruleHoldsAfter" | "newBreaks">): string {
  if (step.newBreaks > 0) {
    const breaks = pluralize(step.newBreaks, "rule break");
    return step.ruleHoldsAfter
      ? `After this plan they share no time, but the plan adds ${breaks}.`
      : `Not confirmed: after this plan they still share time, and the plan adds ${breaks}.`;
  }
  return step.ruleHoldsAfter
    ? "Confirmed: after this plan they share no time, and the plan adds no rule break."
    : "Not confirmed: after this plan they still share time.";
}

/**
 * "Sprints and Katy J Pearson share 30 minutes after this plan." (or "share no time"): what the pair a move
 * was made for still shares, as the decision route priced it for that one move. Only for a plan that is that
 * one move (see `moveStepReceipt`), so "after this plan" is exact.
 */
export function pairSharedReceipt(a: string, b: string, minutes: number): string {
  return minutes === 0
    ? `${a} and ${b} share no time after this plan.`
    : `${a} and ${b} share ${pluralize(minutes, "minute")} after this plan.`;
}

/**
 * The receipt line of a single-move step: the card's receipt when the plan is exactly the card's move (one
 * step, the same set at the same place), else null. A plan of more steps has no figure for the pair after
 * the whole plan from the route, so it prints none rather than a number that belongs to the move alone.
 */
export function moveStepReceipt(
  steps: readonly StackStep[],
  card: { move: StackMove; receipt: string } | null | undefined,
): string | null {
  if (!card || steps.length !== 1) return null;
  const [only] = steps;
  return !isRuleStackStep(only) && sameStep(only, card.move) ? card.receipt : null;
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

/**
 * Where the plan's notes on its moves are kept beside it: the single moves kept from a recorded agent run,
 * encoded as the plan is. A plan saved before this key existed has none, and loads as it always did.
 */
export function planSourcesKey(presetId: string): string {
  return `${planStorageKey(presetId)}:recorded-run`;
}

/** The plan kept for this preset in this tab, or an empty one, with each move's source when one was kept. Never throws. */
export function readStoredMoves(presetId: string, storage: PlanStorage | null = sessionStore()): StackStep[] {
  try {
    if (!storage) return [];
    const steps = decodeMoves(storage.getItem(planStorageKey(presetId)));
    let marked: StackStep[] = [];
    try {
      marked = decodeMoves(storage.getItem(planSourcesKey(presetId)));
    } catch {
      marked = [];
    }
    if (marked.length === 0) return steps;
    return steps.map((step) =>
      !isRuleStackStep(step) && marked.some((other) => sameStep(other, step)) ? { ...step, source: "recorded-run" as const } : step,
    );
  } catch {
    return [];
  }
}

/** Keeps the plan for this preset in this tab (with which moves came from a recorded run); an empty plan removes it. Never throws. */
export function storeMoves(
  presetId: string,
  moves: readonly StackStep[],
  storage: PlanStorage | null = sessionStore(),
): void {
  try {
    if (!storage) return;
    if (moves.length === 0) {
      storage.removeItem(planStorageKey(presetId));
      storage.removeItem(planSourcesKey(presetId));
      return;
    }
    storage.setItem(planStorageKey(presetId), encodeMoves(moves));
    const marked = moves.filter((step) => !isRuleStackStep(step) && isFromRecordedRun(step));
    if (marked.length === 0) storage.removeItem(planSourcesKey(presetId));
    else storage.setItem(planSourcesKey(presetId), encodeMoves(marked));
  } catch {
    // Storage can be full or blocked; the plan still works for this page's life.
  }
}

// ------------------------------------------------------------------------------------ add or replace

/**
 * How a step offered from outside "Try a move" meets a plan that already holds steps: `replace` makes it the
 * whole plan; `add` puts it after the kept steps, and only while the plan still holds exactly `base` (the
 * steps, encoded, that the timetable engine scored together with it before the press).
 */
export type PlanChoice = { mode: "add"; base: string } | { mode: "replace" };

/** What an Add found before anything changed: the choice to hand to the plan, or why it is not added. */
export type AddCheck =
  | { kind: "ready"; choice: PlanChoice; count: number }
  | { kind: "rejected"; reason: string; retry: boolean };

/** "kept move" when every step is a single move, else "kept step" (a kept change moves two sets). */
export function keptWord(steps: readonly StackStep[]): string {
  return steps.every((step) => !isRuleStackStep(step)) ? "kept move" : "kept step";
}

/**
 * Whether a move can be added to the plan, checked before anything changes: the plan must not move its set
 * already and must have room, and then the timetable engine scores the COMBINED plan (the kept steps, then
 * this move: `check`, the page's own /whatif) and must accept it. Ready: the choice to hand to the plan, with
 * the steps it was scored on. Otherwise the reason in words, and whether trying again could help; nothing is
 * kept. `noun` names what is being added in the one reason that needs it ("place", "move").
 */
export async function checkAdd(
  kept: readonly StackStep[],
  place: { act: string; move: StackMove },
  check: (steps: readonly StackStep[]) => Promise<PlanAnswer>,
  noun = "place",
): Promise<AddCheck> {
  if (movedActs(kept).has(place.move.actId)) {
    return {
      kind: "rejected",
      reason: `Not added: your plan already moves ${place.act}, and a plan moves each set once. Your plan is unchanged.`,
      retry: false,
    };
  }
  if (moveCount(kept) + 1 > MAX_STACK) {
    return {
      kind: "rejected",
      reason: `Not added: your plan already holds ${MAX_STACK} moves, the most it can. Your plan is unchanged.`,
      retry: false,
    };
  }
  const steps = [...kept, place.move];
  const answer = await check(steps);
  if (answer.status === "ready") {
    return { kind: "ready", choice: { mode: "add", base: encodeMoves(kept) }, count: steps.length };
  }
  if (answer.status === "invalid") {
    return {
      kind: "rejected",
      reason: `Not added: with your kept moves in place, the timetable engine finds this is no longer a legal place for ${place.act}. Your plan is unchanged.`,
      retry: false,
    };
  }
  return {
    kind: "rejected",
    reason: `Not added: your plan could not be scored with this ${noun} just now. Your plan is unchanged.`,
    retry: true,
  };
}

/**
 * What the status says once the plan holds the step, read from what the plan really holds (`kept`) against
 * what it held before the press (`before`): "Added: 2 kept moves." when every earlier step is still there,
 * "Replaced your 1 kept move." when they went. Null for a plan that was empty.
 */
export function keepNote(before: readonly StackStep[], kept: readonly StackStep[]): string | null {
  if (before.length === 0) return null;
  const stayed = before.every((step) => kept.some((held) => sameStep(held, step)));
  return stayed
    ? `Added: ${pluralize(kept.length, keptWord(kept))}.`
    : `Replaced your ${pluralize(before.length, keptWord(before))}.`;
}
