/**
 * The clash agent's conversation, kept in the browser. The server holds no session: every message
 * carries the earlier turns and the working timetable, constraints and rules the previous answer
 * returned. Pure functions, so the panel stays thin and this logic is unit tested.
 */

import { isRecord } from "./events";
import { topClashes } from "./clashes";
import type { PairClash, SetSlot } from "./preset";
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

/** One question and the run that answered it. */
export type Exchange = { id: string; message: string; state: RunState };

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

/** Earlier turns for the next request: answered exchanges only, newest kept within the limit. */
export function historyFrom(exchanges: readonly Exchange[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const exchange of exchanges) {
    const reply = readClashReply(exchange.state.results);
    if (!reply?.text) continue;
    turns.push({ role: "user", text: clip(exchange.message) }, { role: "assistant", text: clip(reply.text) });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

/** The working timetable, constraints and rules from the newest answered exchange. */
export function latestSession(exchanges: readonly Exchange[]): ClashSession | null {
  for (let i = exchanges.length - 1; i >= 0; i--) {
    const session = readClashReply(exchanges[i].state.results)?.session;
    if (session) return session;
  }
  return null;
}

/** The `POST /api/runs` body for the next message. */
export function buildClashBody(presetId: string, message: string, exchanges: readonly Exchange[]) {
  const session = latestSession(exchanges);
  return {
    scenario: "clash" as const,
    input: {
      preset_id: presetId,
      message: message.trim().slice(0, MAX_MESSAGE_CHARS),
      history: historyFrom(exchanges),
      ...(session
        ? { timetable: session.timetable, constraints: session.constraints, rules: session.rules }
        : {}),
    },
  };
}

/**
 * Starter questions built from the day's costliest clash that has a set free to move, so each one
 * works on this lineup. `isLocked` says whether a set is fixed in place.
 */
export function suggestedPrompts(
  clashes: readonly PairClash[],
  day: number,
  isLocked: (actId: string) => boolean = () => false,
): string[] {
  const ranked = topClashes(clashes, day, Number.POSITIVE_INFINITY);
  const top = ranked.find((clash) => !isLocked(clash.a.act_id) || !isLocked(clash.b.act_id));
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

/** Budget change from a what-if or a suggestion: negative is better. */
export function budgetDelta(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return Math.round(after) - Math.round(before);
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
