/**
 * Pure state machine that folds an `AgentEvent` stream into what the UI renders.
 *
 * Kept free of React so it can be unit tested and reused to replay stored runs
 * (see `reduceEvents`).
 */

import {
  ABSTAIN_RESULT_KIND,
  readAbstainData,
  type AbstainData,
  type AgentEvent,
  type NeedsInputOption,
  type Provenance,
  type QlooRequestRecord,
  type RunMode,
  type RunUsage,
  type StepStatus,
} from "./events";
import { humanizeIdentifier } from "./format";

export type RunStatus =
  | "idle"
  | "running"
  /** The agent asked a question; the stream may have ended, but the run is not finished. */
  | "awaiting_input"
  | "done"
  | "error"
  | "cancelled";

export type StepState = {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  /** Value of `RunState.seq` when this step last changed. */
  seq: number;
};

export type ToolCallState = {
  id: string;
  tool: string;
  input?: unknown;
  provenance: Provenance;
  status: "running" | "done" | "error";
  summary?: string;
  latencyMs?: number;
  /** Qloo requests made by this call, in order. */
  requests: QlooRequestRecord[];
  /** Value of `RunState.seq` when this call last changed. */
  seq: number;
};

export type RunResult = { kind: string; data: unknown };

export type RunSummary = { qlooCalls: number; elapsedMs: number; usage?: RunUsage };

export type RunState = {
  status: RunStatus;
  runId?: string;
  mode?: RunMode;
  steps: StepState[];
  toolCalls: ToolCallState[];
  /**
   * Written prose, concatenated from `text_delta` events. Text that arrives after a tool call is a
   * new turn of the writer, so it starts a new paragraph (`\n\n`).
   */
  text: string;
  /** The next `text_delta` starts a new paragraph. */
  textBreak: boolean;
  needsInput?: { question: string; options: NeedsInputOption[] };
  results: RunResult[];
  error?: { message: string; retryable: boolean };
  summary?: RunSummary;
  /** Increments with every step event so the UI can tell which step changed last. */
  seq: number;
};

export type RunAction =
  /** A request was sent: clear the previous run. */
  | { type: "start" }
  | { type: "event"; event: AgentEvent }
  | { type: "cancel" }
  | { type: "reset" };

export const initialRunState: RunState = {
  status: "idle",
  steps: [],
  toolCalls: [],
  text: "",
  textBreak: false,
  results: [],
  seq: 0,
};

/** Marks everything still in flight as finished or stopped, so no spinner outlives the run. */
function settle(state: RunState, stepStatus: "done" | "error" | "skipped"): RunState {
  let seq = state.seq;
  const steps = state.steps.map((step) =>
    step.status === "running" ? { ...step, status: stepStatus, seq: ++seq } : step,
  );
  const callStatus = stepStatus === "done" ? "done" : "error";
  const toolCalls = state.toolCalls.map(
    (call): ToolCallState =>
      call.status === "running" ? { ...call, status: callStatus, seq: ++seq } : call,
  );
  return { ...state, steps, toolCalls, seq };
}

function upsertStep(state: RunState, event: Extract<AgentEvent, { type: "step" }>): RunState {
  const seq = state.seq + 1;
  // Each step event is a full snapshot of that step, so it replaces the previous one.
  const next: StepState = {
    id: event.id,
    label: event.label,
    status: event.status,
    seq,
    ...(event.detail ? { detail: event.detail } : {}),
  };
  const index = state.steps.findIndex((step) => step.id === event.id);
  const steps =
    index === -1 ? [...state.steps, next] : state.steps.map((step, i) => (i === index ? next : step));
  return { ...state, steps, seq };
}

function upsertToolCall(
  state: RunState,
  id: string,
  update: (current: ToolCallState | undefined) => Omit<ToolCallState, "seq">,
): RunState {
  const seq = state.seq + 1;
  const index = state.toolCalls.findIndex((call) => call.id === id);
  const toolCalls =
    index === -1
      ? [...state.toolCalls, { ...update(undefined), seq }]
      : state.toolCalls.map((call, i) => (i === index ? { ...update(call), seq } : call));
  // Whatever the writer says next comes after this tool call, so it starts a new paragraph.
  return { ...state, toolCalls, seq, textBreak: state.text !== "" };
}

function applyEvent(state: RunState, event: AgentEvent): RunState {
  // Nothing is accepted after a cancel; after an error only the closing summary is kept; a run
  // that finished stays finished.
  if (state.status === "cancelled") return state;
  if (state.status === "error" && event.type !== "run_finished") return state;
  if (state.status === "done" && event.type === "error") return state;

  switch (event.type) {
    case "run_started":
      return {
        ...state,
        status: state.status === "idle" ? "running" : state.status,
        runId: event.run_id,
        mode: event.mode,
      };

    case "step":
      return upsertStep(state, event);

    case "tool_call":
      return upsertToolCall(state, event.id, (current) => ({
        id: event.id,
        tool: event.tool,
        input: event.input,
        provenance: event.provenance,
        status: "running",
        requests: current?.requests ?? [],
      }));

    case "tool_result":
      return upsertToolCall(state, event.id, (current) => ({
        id: event.id,
        tool: event.tool,
        provenance: event.provenance,
        status: event.ok ? "done" : "error",
        summary: event.summary,
        latencyMs: event.latency_ms,
        requests: event.requests ?? current?.requests ?? [],
        ...(current && "input" in current ? { input: current.input } : {}),
      }));

    case "text_delta":
      return {
        ...state,
        text: state.text + (state.textBreak ? "\n\n" : "") + event.text,
        textBreak: false,
      };

    case "needs_input":
      return {
        ...state,
        status: "awaiting_input",
        needsInput: { question: event.question, options: event.options },
      };

    case "result":
      return { ...state, results: [...state.results, { kind: event.kind, data: event.data }] };

    case "error":
      return {
        ...settle(state, "error"),
        status: "error",
        error: { message: event.message, retryable: event.retryable },
      };

    case "run_finished": {
      const summary: RunSummary = {
        qlooCalls: event.qloo_calls,
        elapsedMs: event.elapsed_ms,
        ...(event.usage ? { usage: event.usage } : {}),
      };
      if (state.status === "error") return { ...state, summary };
      // A paused run keeps its steps as they are; the UI shows them as waiting for the answer.
      if (state.status === "awaiting_input") return { ...state, summary };
      return { ...settle(state, "done"), summary, status: "done" };
    }
  }
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "reset":
      return initialRunState;
    case "start":
      return { ...initialRunState, status: "running" };
    case "cancel":
      return state.status === "running" || state.status === "awaiting_input"
        ? { ...settle(state, "skipped"), status: "cancelled" }
        : state;
    case "event":
      return applyEvent(state, action.event);
  }
}

/** Folds a recorded list of events into a finished state (presets, tests, replays). */
export function reduceEvents(events: readonly AgentEvent[]): RunState {
  return events.reduce<RunState>(
    (state, event) => runReducer(state, { type: "event", event }),
    initialRunState,
  );
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * The steps to show. A backend that sends `step` events controls the list. One that only reports
 * tool calls still gets a usable progress list, with one step per call.
 */
export function selectSteps(state: Pick<RunState, "steps" | "toolCalls">): StepState[] {
  if (state.steps.length > 0) return state.steps;
  return state.toolCalls.map((call) => ({
    id: call.id,
    label: humanizeIdentifier(call.tool),
    status: call.status,
    ...(call.summary ? { detail: call.summary } : {}),
    seq: call.seq,
  }));
}

export type TracedRequest = {
  record: QlooRequestRecord;
  /** The tool call that made the request. */
  toolId: string;
  tool: string;
  /** 1-based position among all requests in the run. */
  ordinal: number;
};

/** Every Qloo request in the run, in order, with the tool call that made it. */
export function selectRequests(toolCalls: readonly ToolCallState[]): TracedRequest[] {
  const traced: TracedRequest[] = [];
  for (const call of toolCalls) {
    for (const record of call.requests) {
      traced.push({ record, toolId: call.id, tool: call.tool, ordinal: traced.length + 1 });
    }
  }
  return traced;
}

/** The abstain payload, if the run ended by declining to answer. */
export function selectAbstain(results: readonly RunResult[]): AbstainData | undefined {
  const abstain = results.find((result) => result.kind === ABSTAIN_RESULT_KIND);
  return abstain ? readAbstainData(abstain.data) : undefined;
}

/** Results other than abstain, i.e. the ones a screen renders as content. */
export function selectContentResults(results: readonly RunResult[]): RunResult[] {
  return results.filter((result) => result.kind !== ABSTAIN_RESULT_KIND);
}
