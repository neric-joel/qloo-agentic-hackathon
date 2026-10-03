/**
 * "Keep two sets apart": the answer of `GET /api/presets/{id}/rule-fixes?a=&b=&limit=` and the words
 * the page prints about it. The route searches single places for either set and swaps of one of
 * them with one other set, and keeps only changes after which the two sets share no minute and the
 * moved timetable has no rule break the published day did not already have. This module validates
 * the answer, words it and turns a change into ghost slots for the timetable. It computes no figure
 * the route did not send (the one difference it prints, stage-fit flags added, is of two of them).
 * Pure functions apart from `requestRuleFixes`, so they are unit tested; nothing here throws.
 */

import { isRecord } from "./events";
import { pluralize } from "./format";
import { clockMinutes } from "./moves";
import { isSafeId, type GhostSlot } from "./stack";

/** How many changes the card and the panel ask for. */
export const RULE_LIMIT = 3;

export type RuleSide = { actId: string; act: string; locked: boolean; place: string };

export type RuleMove = {
  actId: string;
  act: string;
  /** Where the set plays now, "Woodsies 14:00-15:00". */
  from: string;
  stageId: string;
  stage: string;
  day: number;
  /** "15:00". */
  start: string;
  end: string;
  minutesMoved: number;
};

export type RuleFix = {
  setsMoved: number;
  /** The sum of the sets' start-time shifts in minutes. */
  minutesMoved: number;
  stageChanges: number;
  budgetAfter: number | null;
  flagsNow: number;
  flagsAfter: number;
  moves: RuleMove[];
};

export type RuleFixes = {
  a: RuleSide;
  b: RuleSide;
  /** The route's own sentence, "A and B must not overlap". */
  rule: string;
  sharedMinutes: number;
  holds: boolean;
  singleSetPlaces: number;
  fixesFound: number;
  /** What the route says it searched, in its own words; null when it sent none. */
  searched: string | null;
  fixes: RuleFix[];
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readSide(value: unknown): RuleSide | null {
  if (!isRecord(value)) return null;
  const { act_id, act, locked, place } = value;
  if (!text(act_id) || !text(act) || typeof locked !== "boolean" || !text(place)) return null;
  return { actId: act_id, act, locked, place };
}

function readMove(value: unknown): RuleMove | null {
  if (!isRecord(value)) return null;
  const { act_id, act, from, stage_id, stage, day, start, end, minutes_moved } = value;
  if (
    !text(act_id) ||
    !text(act) ||
    !text(from) ||
    !text(stage_id) ||
    !text(stage) ||
    !finite(day) ||
    !text(start) ||
    !text(end) ||
    !finite(minutes_moved)
  ) {
    return null;
  }
  if (clockMinutes(start) === null || clockMinutes(end) === null) return null;
  return { actId: act_id, act, from, stageId: stage_id, stage, day, start, end, minutesMoved: minutes_moved };
}

function readFix(value: unknown): RuleFix | null {
  if (!isRecord(value) || !Array.isArray(value.moves) || value.moves.length === 0) return null;
  const { sets_moved, minutes_moved, stage_changes, budget_after, stage_fit_flags_now, stage_fit_flags_after } = value;
  if (!finite(sets_moved) || !finite(minutes_moved) || !finite(stage_changes)) return null;
  if (budget_after !== null && budget_after !== undefined && !finite(budget_after)) return null;
  const moves: RuleMove[] = [];
  for (const item of value.moves) {
    const move = readMove(item);
    if (!move) return null;
    moves.push(move);
  }
  return {
    setsMoved: sets_moved,
    minutesMoved: minutes_moved,
    stageChanges: stage_changes,
    budgetAfter: finite(budget_after) ? budget_after : null,
    flagsNow: finite(stage_fit_flags_now) ? stage_fit_flags_now : 0,
    flagsAfter: finite(stage_fit_flags_after) ? stage_fit_flags_after : 0,
    moves,
  };
}

/** Validates the route's answer. Null when anything the page prints is missing or mistyped. */
export function parseRuleFixes(json: unknown): RuleFixes | null {
  try {
    if (!isRecord(json) || json.kind !== "rule_fixes") return null;
    const a = readSide(json.a);
    const b = readSide(json.b);
    if (!a || !b || !text(json.rule) || !finite(json.shared_minutes) || typeof json.holds !== "boolean") return null;
    if (!finite(json.single_set_places) || !finite(json.fixes_found) || !Array.isArray(json.fixes)) return null;
    const fixes: RuleFix[] = [];
    for (const item of json.fixes) {
      const fix = readFix(item);
      if (!fix) return null;
      fixes.push(fix);
    }
    return {
      a,
      b,
      rule: json.rule,
      sharedMinutes: json.shared_minutes,
      holds: json.holds,
      singleSetPlaces: json.single_set_places,
      fixesFound: json.fixes_found,
      searched: text(json.searched) ? json.searched.slice(0, 400) : null,
      fixes,
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------ request

/** The route's path for a pair, or null for an id the page will not put in a request. */
export function ruleFixesPath(presetId: string, aId: string, bId: string, limit: number = RULE_LIMIT): string | null {
  if (!isSafeId(presetId) || !isSafeId(aId) || !isSafeId(bId) || aId === bId) return null;
  const query = new URLSearchParams({ a: aId, b: bId, limit: String(Math.min(5, Math.max(1, Math.trunc(limit)))) });
  return `/api/presets/${encodeURIComponent(presetId)}/rule-fixes?${query.toString()}`;
}

/** The answer to a search: found, refused (a 404 or 422 with its sentence) or not answered. */
export type RuleAnswer =
  | { status: "ready"; fixes: RuleFixes }
  | { status: "refused"; message: string }
  | { status: "error" };

/** Asks the route about a pair. Never throws. */
export async function requestRuleFixes(
  presetId: string,
  aId: string,
  bId: string,
  limit: number = RULE_LIMIT,
  signal?: AbortSignal,
): Promise<RuleAnswer> {
  const path = ruleFixesPath(presetId, aId, bId, limit);
  if (!path) return { status: "error" };
  try {
    const response = await fetch(path, { headers: { Accept: "application/json" }, signal });
    if (response.status === 404 || response.status === 422) {
      const body: unknown = await response.json().catch(() => null);
      const detail = isRecord(body) && typeof body.detail === "string" ? body.detail : "";
      return detail ? { status: "refused", message: detail.slice(0, 120) } : { status: "error" };
    }
    if (!response.ok) return { status: "error" };
    const fixes = parseRuleFixes(await response.json().catch(() => null));
    const asked =
      fixes !== null &&
      ((fixes.a.actId === aId && fixes.b.actId === bId) || (fixes.a.actId === bId && fixes.b.actId === aId));
    return fixes && asked ? { status: "ready", fixes } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

// ------------------------------------------------------------------------------------ wording

/** "Woodsies 14:00-15:00" -> the stage and the times; null when the text is not of that shape. */
export function parsePlace(value: string): { stage: string; start: string; end: string } | null {
  const match = /^(.*\S)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(value.trim());
  return match ? { stage: match[1], start: match[2], end: match[3] } : null;
}

type Shifted = { from: string; stage: string; start: string };

/**
 * How a set moves, as the plan card words it: "30 minutes earlier, same stage", "Moves to West
 * Stage, 20:30" (or "Moves to West Stage, 30 minutes later" when the start also changes).
 */
export function shiftWords(move: Shifted): string {
  const from = parsePlace(move.from);
  const start = clockMinutes(move.start);
  const was = from ? clockMinutes(from.start) : null;
  if (!from || start === null || was === null) return `Moves to ${move.stage}, ${move.start}`;
  const delta = start - was;
  const when = `${pluralize(Math.abs(delta), "minute")} ${delta < 0 ? "earlier" : "later"}`;
  if (from.stage === move.stage) return delta === 0 ? "Stays in place" : `${when}, same stage`;
  return `Moves to ${move.stage}, ${delta === 0 ? move.start : when}`;
}

/** The short form for a headline: "15 minutes later" on the same stage, else "to Radical 19:45". */
export function shiftBrief(move: Shifted): string {
  const from = parsePlace(move.from);
  const start = clockMinutes(move.start);
  const was = from ? clockMinutes(from.start) : null;
  if (from && start !== null && was !== null && from.stage === move.stage && start !== was) {
    return `${pluralize(Math.abs(start - was), "minute")} ${start < was ? "earlier" : "later"}`;
  }
  return `to ${move.stage} ${move.start}`;
}

/** "Moves to X" inside a parenthesis reads "moves to X": only the first letter changes. */
export function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/** "Sprints → The Park 15:00–16:00 (60 minutes later, same stage)". */
export function moveLine(move: RuleMove, dayLabel: string | null = null): string {
  return `${move.act} → ${move.stage} ${move.start}–${move.end}${dayLabel ? `, ${dayLabel}` : ""} (${lowerFirst(shiftWords(move))})`;
}

/** "2 sets · 120 minutes start-time shift". */
export function fixSummary(fix: RuleFix): string {
  return `${pluralize(fix.setsMoved, "set")} · ${pluralize(fix.minutesMoved, "minute")} start-time shift`;
}

/** "Index 116.7 → 113.5", or null when the route gave none. */
export function fixIndexLine(fix: RuleFix, before: number | null): string | null {
  if (fix.budgetAfter === null || before === null) return null;
  return `Index ${before.toFixed(1)} → ${fix.budgetAfter.toFixed(1)}`;
}

/** "Adds 2 stage-fit flags" only when the change raises the route's own count. */
export function stageFitNote(fix: RuleFix): string | null {
  const added = fix.flagsAfter - fix.flagsNow;
  return added > 0 ? `Adds ${pluralize(added, "stage-fit flag")}` : null;
}

export const SMALLEST_FIRST = "Smallest changes first: fewest sets, then fewest minutes moved.";
export const SMALLEST_NOTE = "smallest change this search found that ends it";
export const NO_BREAK = "adds no rule break";
export const ENDS_NOTE = `${NO_BREAK} and ends this overlap`;
export const NO_RESULT = "This search found no change that ends it. It did not look for longer chains.";
export const BOTH_LOCKED = "Both sets are locked.";
/**
 * What the search covers, in the words the panel helper and the loading line use. The route sends
 * its own `searched` string; the panel prints that once an answer is in, and this before.
 */
export const SEARCH_COVERS =
  "single places on the 5-minute grid for either set, and the two-set changes this search generates";
export const SEARCH_RULE = "Listed changes end this overlap and add no rule break.";

/** The route's own sentence about what it searched, capitalised and ended with a full stop. */
export function searchedSentence(rule: Pick<RuleFixes, "searched">): string {
  const raw = (rule.searched ?? SEARCH_COVERS).trim();
  const body = raw.charAt(0).toUpperCase() + raw.slice(1);
  return /[.!?]$/.test(body) ? body : `${body}.`;
}
export const INDEX_NOTE =
  "The index is shown for information: it is this app’s own measure, not a verdict, and it does not rank this list.";

/** "If a rule says A and B must never overlap:". */
export function ruleLead(rule: Pick<RuleFixes, "a" | "b">): string {
  return `If a rule says ${rule.a.act} and ${rule.b.act} must never overlap:`;
}

/** "Sprints is locked, so only Katy J Pearson can move." Null when neither or both are locked. */
export function lockedNote(rule: Pick<RuleFixes, "a" | "b">): string | null {
  if (rule.a.locked === rule.b.locked) return null;
  const [still, free] = rule.a.locked ? [rule.a, rule.b] : [rule.b, rule.a];
  return `${still.act} is locked, so only ${free.act} can move.`;
}

/** "{Act} to {Stage} {start}–{end} and {Act} to ...". */
function placesText(fix: RuleFix): string {
  return fix.moves.map((move) => `${move.act} to ${move.stage} ${move.start}–${move.end}`).join(" and ");
}

/**
 * The decision card's rule line: the lead, then what this search found. The single-place count is
 * said first, then the first change as "the smallest change this search found that ends it", with
 * the sets and start-time minutes it moves and its index beside the published one (the index may go
 * up; it is printed as the route gave it). Null when the two sets already share no minute (nothing
 * was searched, so nothing is claimed). `before` is the published day's index.
 */
export function ruleSentence(rule: RuleFixes, before: number | null = null): string | null {
  if (rule.holds) return null;
  const lead = ruleLead(rule);
  if (rule.a.locked && rule.b.locked) return `${lead} ${BOTH_LOCKED}`;
  const parts = [lead];
  const note = lockedNote(rule);
  if (note) parts.push(note);
  const first = rule.fixes[0];
  if (!first) {
    parts.push(NO_RESULT);
    return parts.join(" ");
  }
  parts.push(
    rule.singleSetPlaces === 0
      ? "This search found no single-set place that ends it."
      : `${pluralize(rule.singleSetPlaces, "single-set place")} end${rule.singleSetPlaces === 1 ? "s" : ""} it.`,
  );
  const index =
    first.budgetAfter !== null && before !== null ? `; index ${before.toFixed(1)} → ${first.budgetAfter.toFixed(1)}` : "";
  parts.push(
    `The ${SMALLEST_NOTE} moves ${pluralize(first.setsMoved, "set")}, ${pluralize(first.minutesMoved, "start-time minute")} in all${index}.`,
  );
  const kind = first.setsMoved === 1 ? "a single move" : `a ${first.setsMoved}-set change`;
  parts.push(`It is ${kind}: ${placesText(first)}. It ${NO_BREAK}.`);
  return parts.join(" ");
}

// ------------------------------------------------------------------------------------ the grid

/** A change as the grid draws it: one ghost per moved set. Empty when a time cannot be read. */
export function fixGhosts(fix: RuleFix): GhostSlot[] {
  const ghosts: GhostSlot[] = [];
  for (const move of fix.moves) {
    const start = clockMinutes(move.start);
    let end = clockMinutes(move.end);
    if (start === null || end === null) return [];
    if (end <= start) end += 1440;
    ghosts.push({ actId: move.actId, stageId: move.stageId, day: move.day, start, end });
  }
  return ghosts;
}

/** What the status region says when a change is previewed. */
export function previewAnnouncement(fix: RuleFix): string {
  const where = fix.moves.map((move) => `${move.act} at ${move.stage} ${move.start}`).join(" and ");
  return `Previewing ${where}. 0 minutes shared; the change ${ENDS_NOTE}. The timetable has scrolled to the first tested slot.`;
}

/** A change being previewed on the grid, and the pair of sets it keeps apart. */
export type RulePreview = { ghosts: GhostSlot[]; pair: { aId: string; bId: string } };
