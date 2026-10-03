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

/** Longest wait between two events during a replay, so a slow tool call does not stall it. */
export const MAX_GAP_MS = 700;
/** Longest wait between two pieces of streamed text. */
export const MAX_TEXT_GAP_MS = 60;
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

/**
 * The run as replay beats: labelled recorded (see `asRecorded`) and paced from the saved times.
 * Each wait is the gap since the previous event, capped at `MAX_GAP_MS` (`MAX_TEXT_GAP_MS` before
 * streamed text), and a run that would still take longer than `MAX_REPLAY_MS` is played faster.
 */
export function toReplayBeats(run: RecordedRun): ReplayBeat[] {
  let previous = run.events[0]?.t ?? 0;
  const beats = run.events.map(({ t, event }) => {
    const gap = Math.max(0, t - previous);
    previous = Math.max(previous, t);
    const cap = event.type === "text_delta" ? MAX_TEXT_GAP_MS : MAX_GAP_MS;
    return { after: Math.min(gap, cap), event: asRecorded(event) };
  });
  const total = beats.reduce((sum, beat) => sum + beat.after, 0);
  if (total <= MAX_REPLAY_MS) return beats;
  const scale = MAX_REPLAY_MS / total;
  return beats.map((beat) => ({ ...beat, after: beat.after * scale }));
}

/** The state a replay ends in, as the panel would show it once the run has played. */
export function replayFinalState(run: RecordedRun): RunState {
  return reduceEvents(toReplayBeats(run).map((beat) => beat.event));
}
