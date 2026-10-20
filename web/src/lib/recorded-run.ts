/**
 * Recorded agent runs: real runs saved as the exact events the backend streamed, each with its
 * time since the run started (`GET /api/presets/{id}/recordings`). Replaying one goes through the
 * same reducer as a live run, so the panel renders it the same way, but it is labelled recorded
 * throughout: the run's mode, every Qloo request and every Qloo-sourced step. Request ids, latencies
 * and parameters are kept exactly as recorded. Pure functions; parsing never throws.
 */

import { isRecord, parseAgentEvent, type AgentEvent, type Provenance } from "./events";
import type { ReplayBeat } from "./replay";
import { reduceEvents, type RunState } from "./run-state";

/** One saved event and when it arrived, in milliseconds since the run started. */
export type RecordedEvent = { t: number; event: AgentEvent };

export type RecordedRun = {
  id: string;
  title: string;
  question: string;
  /** When the run was captured (ISO 8601). Empty when the file does not say. */
  capturedAt: string;
  /** The model that wrote the answer. Empty when the file does not say. */
  model: string;
  events: RecordedEvent[];
};

/*
 * Pacing. The saved text arrives in one burst after one model pause, so pacing from the saved
 * times alone would play a whole run in a second or two. A replay is paced by event kind instead.
 */

/** Wait before each piece of streamed text that continues a burst. */
export const TEXT_STEP_MS = 55;
/**
 * Shortest wait before a step a reader should see arrive: a tool call, a tool result, the first
 * piece of text after anything else, and the result.
 */
export const MIN_STEP_MS = 650;
/** Longest wait taken from the saved times: a step's saved gap is used, up to this, when it is longer. */
export const MAX_GAP_MS = 1_200;
/** Shortest a whole replay may take; a shorter run has its step waits stretched proportionally. */
export const MIN_REPLAY_MS = 6_000;
/** Longest a single step wait may be stretched to. */
export const MAX_STEP_MS = 2_500;
/** Longest a whole replay may take; longer runs are played proportionally faster. */
export const MAX_REPLAY_MS = 14_000;

/** The backend serves at most six runs per festival day; anything past that is ignored. */
const MAX_RUNS = 6;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** One run, or null when any part of it is unusable. */
function parseRun(raw: unknown): RecordedRun | null {
  if (!isRecord(raw) || !Array.isArray(raw.events)) return null;
  const id = text(raw.id);
  const title = text(raw.title);
  const question = text(raw.question);
  if (!id || !title || !question) return null;

  const events: RecordedEvent[] = [];
  for (const item of raw.events) {
    if (!isRecord(item)) return null;
    const { t } = item;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return null;
    const parsed = parseAgentEvent(item.event);
    // An event type this client does not know is skipped, as the live stream skips it.
    if (parsed.kind === "unknown") continue;
    if (parsed.kind === "invalid") return null;
    events.push({ t, event: parsed.event });
  }

  // A complete, clean run only: it starts and finishes, answers with a clash result, and never
  // failed. A replay must not show a broken run as if it were the agent's answer.
  if (events[0]?.event.type !== "run_started") return null;
  if (events.at(-1)?.event.type !== "run_finished") return null;
  if (!events.some(({ event }) => event.type === "result" && event.kind === "clash")) return null;
  if (events.some(({ event }) => event.type === "error")) return null;

  return {
    id,
    title,
    question,
    capturedAt: typeof raw.captured_at === "string" ? raw.captured_at : "",
    model: typeof raw.model === "string" ? raw.model : "",
    events,
  };
}

/**
 * The recorded runs in a recordings response (`{ runs: [...] }`, a bare list, or the saved file
 * shape). Runs that fail validation are dropped, as are repeated ids. Never throws.
 */
export function parseRecordings(json: unknown): RecordedRun[] {
  const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.runs) ? json.runs : [];
  const runs: RecordedRun[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    let run: RecordedRun | null = null;
    try {
      run = parseRun(raw);
    } catch {
      run = null;
    }
    if (!run || seen.has(run.id)) continue;
    seen.add(run.id);
    runs.push(run);
    if (runs.length === MAX_RUNS) break;
  }
  return runs;
}

/** A value Qloo returned live when the run was recorded is, in the replay, a recorded value. */
function replayed(provenance: Provenance): Provenance {
  return provenance === "qloo" ? "recorded" : provenance;
}

/** The event as the replay shows it: labelled recorded, everything else exactly as saved. */
function asRecorded(event: AgentEvent): AgentEvent {
  switch (event.type) {
    case "run_started":
      return { ...event, mode: "recorded" };
    case "tool_call":
      return { ...event, provenance: replayed(event.provenance) };
    case "tool_result":
      return {
        ...event,
        provenance: replayed(event.provenance),
        ...(event.requests
          ? { requests: event.requests.map((request) => ({ ...request, recorded: true })) }
          : {}),
      };
    default:
      return event;
  }
}

type Paced = { after: number; step: boolean };

/**
 * The wait before each event, by kind. A step (a tool call, a tool result, the first piece of text
 * after anything else, the result) waits its saved gap clamped to `MIN_STEP_MS`..`MAX_GAP_MS`; text
 * that continues a burst waits `TEXT_STEP_MS`; anything else waits its saved gap, capped at
 * `MAX_GAP_MS`. Saved times that go backwards count as no gap.
 */
function paceByKind(events: readonly RecordedEvent[]): Paced[] {
  let previousT = events[0]?.t ?? 0;
  return events.map(({ t, event }, i) => {
    const gap = Math.max(0, t - previousT);
    previousT = Math.max(previousT, t);
    const capped = Math.min(gap, MAX_GAP_MS);
    if (event.type === "text_delta" && events[i - 1]?.event.type === "text_delta") {
      return { after: TEXT_STEP_MS, step: false };
    }
    const step =
      event.type === "tool_call" ||
      event.type === "tool_result" ||
      event.type === "text_delta" ||
      event.type === "result";
    return step ? { after: Math.max(MIN_STEP_MS, capped), step } : { after: capped, step };
  });
}

/**
 * Stretches the step waits so the whole run takes `MIN_REPLAY_MS`, proportionally, with no step
 * longer than `MAX_STEP_MS`. A step that reaches the cap stays there and the others take up the
 * rest; a run with too few steps to reach the minimum ends as long as the caps allow.
 */
function stretchSteps(paced: Paced[]): Paced[] {
  const total = paced.reduce((sum, beat) => sum + beat.after, 0);
  if (total >= MIN_REPLAY_MS) return paced;
  const fixed = paced.reduce((sum, beat) => sum + (beat.step ? 0 : beat.after), 0);
  const capped = new Set<number>();
  let factor = 1;
  // Each pass fixes at least one more step at the cap, so this ends within one pass per step.
  for (let pass = 0; pass <= paced.length; pass += 1) {
    let free = 0;
    let atCap = 0;
    paced.forEach((beat, i) => {
      if (!beat.step) return;
      if (capped.has(i)) atCap += MAX_STEP_MS;
      else free += beat.after;
    });
    if (free <= 0) break;
    factor = Math.max(1, (MIN_REPLAY_MS - fixed - atCap) / free);
    const over = paced.flatMap((beat, i) =>
      beat.step && !capped.has(i) && beat.after * factor > MAX_STEP_MS ? [i] : [],
    );
    if (over.length === 0) break;
    over.forEach((i) => capped.add(i));
  }
  return paced.map((beat, i) => {
    if (!beat.step) return beat;
    return { ...beat, after: capped.has(i) ? MAX_STEP_MS : Math.min(MAX_STEP_MS, beat.after * factor) };
  });
}

/**
 * The run as replay beats: labelled recorded (see `asRecorded`) and paced by event kind (see
 * `paceByKind`). A run shorter than `MIN_REPLAY_MS` has its step waits stretched (`stretchSteps`),
 * so it is long enough to watch and to skip; one longer than `MAX_REPLAY_MS` is played faster.
 * Event order and every saved value are kept; only the waits are set here.
 */
export function toReplayBeats(run: RecordedRun): ReplayBeat[] {
  const paced = stretchSteps(paceByKind(run.events));
  const beats = run.events.map(({ event }, i) => ({ after: paced[i].after, event: asRecorded(event) }));
  const total = beats.reduce((sum, beat) => sum + beat.after, 0);
  if (total <= MAX_REPLAY_MS) return beats;
  const scale = MAX_REPLAY_MS / total;
  return beats.map((beat) => ({ ...beat, after: beat.after * scale }));
}

/** The state a replay ends in, as the panel would show it once the run has played. */
export function replayFinalState(run: RecordedRun): RunState {
  return reduceEvents(toReplayBeats(run).map((beat) => beat.event));
}

/**
 * Where a run's own tool results leave it, read from its saved `result` event (never the model's words):
 * `keep` when the engine found a legal place (an allowed try_move, or a find_moves list with places), so the run
 * ends with a place to keep; `refused` when every move it tested was refused by the rules; `other` otherwise.
 */
export function runEnding(run: RecordedRun): "keep" | "refused" | "other" {
  const result = run.events.find(({ event }) => event.type === "result" && event.kind === "clash")?.event;
  const data = result && result.type === "result" && isRecord(result.data) ? result.data : null;
  const tools = data && isRecord(data.tool_data) ? Object.values(data.tool_data).filter(isRecord) : [];
  const keeps = tools.some(
    (item) =>
      (item.kind === "what_if" && item.allowed === true) ||
      (item.kind === "move_options" && item.movable !== false && Array.isArray(item.options) && item.options.length > 0),
  );
  if (keeps) return "keep";
  return tools.some((item) => item.kind === "what_if" && item.allowed === false) ? "refused" : "other";
}

/**
 * The runs in the order the panel lists them, and the first one its default: a run that ends with a place to
 * keep first, a run the rules refuse last, the rest between, each group in the server's order.
 */
export function orderRecordings(runs: readonly RecordedRun[]): RecordedRun[] {
  const rank = { keep: 0, other: 1, refused: 2 } as const;
  return runs
    .map((run, i) => ({ run, i, rank: rank[runEnding(run)] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((item) => item.run);
}
