/**
 * The clash agent's conversation, kept in the browser. The server holds no session: every message
 * carries the earlier turns and the working timetable, constraints and rules the previous answer
 * returned. Pure functions, so the panel stays thin and this logic is unit tested.
 */

import { isRecord } from "./events";
import { dayName, heroClash, isFixedByLocks, topClashes } from "./clashes";
import type { Evidence, PairClash, SetSlot } from "./preset";
import type { RunResult, RunState } from "./run-state";

/** Server limits (backend `ClashInput`): earlier turns kept, characters per turn and per message. */
export const MAX_HISTORY_TURNS = 8;
export const MAX_TURN_CHARS = 4000;
export const MAX_MESSAGE_CHARS = 600;

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type ClashSession = {
  timetable: SetSlot[];
  constraints: unknown;
  rules: string[];
};

/** One `try_move`: a move tested against the rules and priced, never applied. */
export type WhatIf = {
  move: string;
  allowed: boolean;
  problems: string[];
  before: number | null;
  after: number | null;
};

/** One `explain_clash`: the pair, its overlap, and the taste Qloo finds both audiences share. */
export type ClashExplain = {
  a: string;
  b: string;
  minutesOverlapping: number;
  sharedAudience: number | null;
  sharedTaste: string[];
  note: string | null;
};

export type ReslotMove = { act: string; from: string; to: string; why: string };

/** One `reslot`: suggested moves graded by the same measure. */
export type ReslotSuggestion = {
  before: number | null;
  after: number | null;
  moves: ReslotMove[];
  message: string | null;
};

export type MoveOption = { move: string; stage: string; start: string; after: number | null };

/** One `find_moves`: every legal place one set could go, priced, best first. */
export type MoveOptions = {
  act: string;
  from: string;
  movable: boolean;
  why: string | null;
  before: number | null;
  legalPlaces: number;
  options: MoveOption[];
};

export type ClashReply = {
  text: string;
  session: ClashSession | null;
  whatIfs: WhatIf[];
  explains: ClashExplain[];
  reslots: ReslotSuggestion[];
  moveOptions: MoveOptions[];
};

/**
 * One question and the run that answered it. A recorded exchange replays a saved run: it is shown
 * like any other answer but never feeds a live request (no history, no session, no rules).
 */
export type Exchange = { id: string; message: string; state: RunState; recorded?: boolean };

function live(exchanges: readonly Exchange[]): Exchange[] {
  return exchanges.filter((exchange) => !exchange.recorded);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readSession(value: unknown): ClashSession | null {
  if (!isRecord(value) || !Array.isArray(value.timetable)) return null;
  return {
    timetable: value.timetable as SetSlot[],
    constraints: value.constraints ?? null,
    rules: strings(value.rules),
  };
}

function readWhatIf(data: Record<string, unknown>): WhatIf {
  return {
    move: str(data.move),
    allowed: data.allowed === true,
    problems: strings(data.problems),
    before: num(data.clash_budget_before),
    after: num(data.clash_budget_after),
  };
}

function readExplain(data: Record<string, unknown>): ClashExplain {
  const side = (value: unknown) => (isRecord(value) ? str(value.name) : "");
  return {
    a: side(data.a),
    b: side(data.b),
    minutesOverlapping: num(data.minutes_overlapping) ?? 0,
    // Older recorded runs used the names shared_audience and fans_of_both_lean_toward.
    sharedAudience: num(data.taste_overlap ?? data.shared_audience),
    sharedTaste: strings(data.qloo_tags_for_pair ?? data.fans_of_both_lean_toward),
    note: str(data.note) || null,
  };
}

function readReslot(data: Record<string, unknown>): ReslotSuggestion {
  const summary = isRecord(data.summary) ? data.summary : {};
  const moves = Array.isArray(summary.moves) ? summary.moves.filter(isRecord) : [];
  return {
    before: num(summary.clash_budget_before),
    after: num(summary.clash_budget_after),
    moves: moves.map((move) => ({
      act: str(move.act),
      from: str(move.from),
      to: str(move.to),
      why: str(move.why),
    })),
    message: str(summary.message) || null,
  };
}

function readMoveOptions(data: Record<string, unknown>): MoveOptions {
  const options = Array.isArray(data.options) ? data.options.filter(isRecord) : [];
  return {
    act: str(data.act),
    from: str(data.from),
    movable: data.movable !== false,
    why: str(data.why) || null,
    before: num(data.clash_budget_before),
    legalPlaces: num(data.legal_places) ?? options.length,
    options: options.map((option) => ({
      move: str(option.move),
      stage: str(option.stage),
      start: str(option.start),
      after: num(option.clash_budget_after),
    })),
  };
}

/** The agent's answer, from the run's `result` event. Null until the run has finished cleanly. */
export function readClashReply(results: readonly RunResult[]): ClashReply | null {
  const result = results.find((item) => item.kind === "clash");
  if (!result || !isRecord(result.data)) return null;
  const { data } = result;
  const reply: ClashReply = {
    text: str(data.text).trim(),
    session: readSession(data.session),
    whatIfs: [],
    explains: [],
    reslots: [],
    moveOptions: [],
  };
  // Keyed by tool call id, in call order.
  const toolData = isRecord(data.tool_data) ? Object.values(data.tool_data) : [];
  for (const item of toolData) {
    if (!isRecord(item)) continue;
    if (item.kind === "what_if") reply.whatIfs.push(readWhatIf(item));
    else if (item.kind === "clash") reply.explains.push(readExplain(item));
    else if (item.kind === "reslot") reply.reslots.push(readReslot(item));
    else if (item.kind === "move_options") reply.moveOptions.push(readMoveOptions(item));
  }
  return reply;
}

function clip(text: string): string {
  return text.length > MAX_TURN_CHARS ? `${text.slice(0, MAX_TURN_CHARS - 1)}…` : text;
}

/**
 * Earlier turns for the next request: answered live exchanges only (never a replay), newest kept
 * within the limit.
 */
export function historyFrom(exchanges: readonly Exchange[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const exchange of live(exchanges)) {
    const reply = readClashReply(exchange.state.results);
    if (!reply?.text) continue;
    turns.push({ role: "user", text: clip(exchange.message) }, { role: "assistant", text: clip(reply.text) });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

/** The working timetable, constraints and rules from the newest answered live exchange. */
export function latestSession(exchanges: readonly Exchange[]): ClashSession | null {
  const answered = live(exchanges);
  for (let i = answered.length - 1; i >= 0; i--) {
    const session = readClashReply(answered[i].state.results)?.session;
    if (session) return session;
  }
  return null;
}

/** The `POST /api/runs` body for the next message. Recorded exchanges contribute nothing. */
export function buildClashBody(presetId: string, message: string, exchanges: readonly Exchange[]) {
  const answered = live(exchanges);
  const session = latestSession(answered);
  return {
    scenario: "clash" as const,
    input: {
      preset_id: presetId,
      message: message.trim().slice(0, MAX_MESSAGE_CHARS),
      history: historyFrom(answered),
      ...(session
        ? { timetable: session.timetable, constraints: session.constraints, rules: session.rules }
        : {}),
    },
  };
}

/**
 * Starter questions about the clash the hero button opens (`heroClash`: a costly clash with a
 * story, a set free to move and tags Qloo returned), so the first click and the first prompt land on
 * the same pair and each question works on this lineup. `isLocked` says whether a set is fixed in
 * place; `evidence` holds the tags.
 */
export function suggestedPrompts(
  clashes: readonly PairClash[],
  day: number,
  isLocked: (actId: string) => boolean = () => false,
  evidence: Evidence | null = null,
): string[] {
  const ranked = topClashes(clashes, day, Number.POSITIVE_INFINITY);
  const hero = heroClash(ranked, evidence, isLocked);
  const top =
    hero && !isFixedByLocks(hero.clash, isLocked)
      ? hero.clash
      : ranked.find((clash) => !isFixedByLocks(clash, isLocked));
  if (!top) {
    return ["Which clash costs the most today?", "How is the Clash Budget worked out?"];
  }
  const mover = isLocked(top.b.act_id) ? top.a : top.b;
  const other = mover === top.a ? top.b : top.a;
  return [
    `Why do ${top.a.name} and ${top.b.name} clash?`,
    `Where could ${mover.name} go instead?`,
    `Keep ${other.name} where it is. Which clash should I fix first?`,
  ];
}

/** A Clash Budget Index as the cards print it: one decimal. */
function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Budget change from a what-if or a suggestion, between the one-decimal readings the cards print
 * (so 116.7 to 114.3 is -2.4, never a rounded -3): negative is lower.
 */
export function budgetDelta(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return Math.round((oneDecimal(after) - oneDecimal(before)) * 10) / 10;
}

/**
 * A Clash Budget change in words, as the change chip prints it: "2.4 lower", "0.6 higher", "No
 * change". The direction is a word, never a sign, so a drop never reads as a double negative.
 */
export function changeLabel(delta: number): string {
  if (delta < 0) return `${Math.abs(delta).toFixed(1)} lower`;
  if (delta > 0) return `${delta.toFixed(1)} higher`;
  return "No change";
}

// ------------------------------------------------------------------------------------ problems

const NOT_POSSIBLE = "That change is not possible: ";

/** A Python-quoted name as the timetable engine writes it: 'Act One', or "Guns N' Roses". */
const QUOTED = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")`;

/** The engine's same-stage message: 'A' and 'B' overlap on stage 'id', day 0 (15:00-15:45 vs ...). */
const SAME_STAGE = new RegExp(
  String.raw`^${QUOTED} and ${QUOTED} overlap on stage ${QUOTED}, day (\d+) \((.*)\)$`,
);

function unquote(single: string | undefined, double: string | undefined): string {
  return (single ?? double ?? "").replace(/\\(.)/g, "$1");
}

/** "Other" -> "the Other stage"; "Other Stage" -> "the Other Stage"; "The Park" -> "The Park stage". */
function stagePhrase(name: string): string {
  if (/\bstage$/i.test(name)) return /^the\s/i.test(name) ? name : `the ${name}`;
  return /^the\s/i.test(name) ? `${name} stage` : `the ${name} stage`;
}

/**
 * A rule the timetable engine says a move breaks, in plain words. The engine's same-stage message,
 * "That change is not possible: 'A' and 'B' overlap on stage 'other', day 0 (15:00-15:45 vs
 * 15:30-16:15)", becomes "A and B would overlap on the Other stage (Sunday, 15:00–15:45 vs
 * 15:30–16:15)", with the stage and day named as the page names them. A stage id the festival does
 * not list reads "the same stage". Any other text only loses the "That change is not possible: "
 * lead-in.
 */
export function humanizeProblem(
  text: string,
  festival: { stages: readonly { id: string; name: string }[]; days: readonly string[] },
): string {
  const body = text.startsWith(NOT_POSSIBLE) ? text.slice(NOT_POSSIBLE.length) : text;
  const match = SAME_STAGE.exec(body.trim());
  if (!match) return body;
  const a = unquote(match[1], match[2]);
  const b = unquote(match[3], match[4]);
  const stageId = unquote(match[5], match[6]);
  const day = Number(match[7]);
  const stage = festival.stages.find((item) => item.id === stageId);
  const label = festival.days[day];
  const when = label ? dayName(label) : `Day ${day + 1}`;
  const times = match[8].replace(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/g, "$1–$2");
  return `${a} and ${b} would overlap on ${stage ? stagePhrase(stage.name) : "the same stage"} (${when}, ${times})`;
}

// ---------------------------------------------------------------------------------------- text

export type InlineSegment = { text: string; strong: boolean };

export type TextBlock =
  | { kind: "paragraph"; segments: InlineSegment[] }
  | { kind: "list"; ordered: boolean; items: InlineSegment[][] };

/** Splits `**bold**` runs out of a line; other markdown marks are left as plain text. */
export function inlineSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: text.slice(last, index), strong: false });
    segments.push({ text: match[1], strong: true });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), strong: false });
  return segments.filter((segment) => segment.text !== "");
}

const BULLET = /^\s*(?:[-*•]\s+)(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/**
 * The agent's prose as paragraphs and lists. It is asked for plain language, but a stray list or
 * bold run should still read as one rather than as raw symbols.
 */
export function textBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", segments: inlineSegments(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(inlineSegments) });
      list = null;
    }
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^#{1,6}\s+/, "");
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet?.[1] ?? numbered?.[1];
    if (item !== undefined) {
      flushParagraph();
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(item);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
