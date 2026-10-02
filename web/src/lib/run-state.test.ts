import { describe, expect, it } from "vitest";

import type { AgentEvent, QlooRequestRecord } from "./events";
import {
  initialRunState,
  reduceEvents,
  runReducer,
  selectAbstain,
  selectContentResults,
  selectRequests,
  selectSteps,
} from "./run-state";

const request = (path: string, overrides: Partial<QlooRequestRecord> = {}): QlooRequestRecord => ({
  path,
  params: { q: "x" },
  status: 200,
  latency_ms: 100,
  cached: false,
  ...overrides,
});

const started: AgentEvent = { type: "run_started", run_id: "r1", mode: "live" };
const finished: AgentEvent = {
  type: "run_finished",
  run_id: "r1",
  qloo_calls: 3,
  elapsed_ms: 4200,
  usage: { input_tokens: 100, output_tokens: 40 },
};

describe("runReducer", () => {
  it("folds a full run into renderable state", () => {
    const state = reduceEvents([
      started,
      { type: "step", id: "a", label: "Resolve", status: "running" },
      { type: "tool_call", id: "c1", tool: "search", input: { q: "x" }, provenance: "qloo" },
      {
        type: "tool_result",
        id: "c1",
        tool: "search",
        ok: true,
        summary: "2 matches",
        latency_ms: 180,
        provenance: "qloo",
        requests: [request("/search"), request("/search", { cached: true })],
      },
      { type: "step", id: "a", label: "Resolve", status: "done", detail: "2 matched" },
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
      { type: "result", kind: "summary", data: { n: 1 } },
      finished,
    ]);

    expect(state.status).toBe("done");
    expect(state.runId).toBe("r1");
    expect(state.mode).toBe("live");
    // The step counter is shared with tool calls: step, call, result, step.
    expect(state.steps).toEqual([
      { id: "a", label: "Resolve", status: "done", detail: "2 matched", seq: 4 },
    ]);
    expect(state.text).toBe("Hello world");
    expect(state.results).toEqual([{ kind: "summary", data: { n: 1 } }]);
    expect(state.summary).toEqual({
      qlooCalls: 3,
      elapsedMs: 4200,
      usage: { input_tokens: 100, output_tokens: 40 },
    });
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]).toMatchObject({
      id: "c1",
      tool: "search",
      status: "done",
      summary: "2 matches",
      latencyMs: 180,
      input: { q: "x" },
    });
  });

  it("updates a step in place and clears stale detail", () => {
    const state = reduceEvents([
      started,
      { type: "step", id: "a", label: "First", status: "running", detail: "working" },
      { type: "step", id: "b", label: "Second", status: "running" },
      { type: "step", id: "a", label: "First", status: "done" },
    ]);
    expect(state.steps.map((step) => [step.id, step.status, step.detail])).toEqual([
      ["a", "done", undefined],
      ["b", "running", undefined],
    ]);
    // The step that changed last carries the highest seq.
    const latest = [...state.steps].sort((a, b) => b.seq - a.seq)[0];
    expect(latest?.id).toBe("a");
  });

  it("creates a tool call from a result that arrives without a call", () => {
    const state = reduceEvents([
      started,
      {
        type: "tool_result",
        id: "x",
        tool: "grade",
        ok: false,
        summary: "failed",
        latency_ms: 5,
        provenance: "derived",
      },
    ]);
    expect(state.toolCalls).toEqual([
      {
        id: "x",
        tool: "grade",
        provenance: "derived",
        status: "error",
        summary: "failed",
        latencyMs: 5,
        requests: [],
        seq: 1,
      },
    ]);
  });

  it("starts a new paragraph for prose that follows a tool call", () => {
    const state = reduceEvents([
      started,
      { type: "text_delta", text: "I'll look those " },
      { type: "text_delta", text: "up." },
      { type: "tool_call", id: "c", tool: "search", input: {}, provenance: "qloo" },
      {
        type: "tool_result",
        id: "c",
        tool: "search",
        ok: true,
        summary: "",
        latency_ms: 1,
        provenance: "qloo",
      },
      { type: "text_delta", text: "Here is " },
      { type: "text_delta", text: "what I found." },
    ]);
    expect(state.text).toBe("I'll look those up.\n\nHere is what I found.");
  });

  it("does not open the prose with a paragraph break", () => {
    const state = reduceEvents([
      started,
      { type: "tool_call", id: "c", tool: "search", input: {}, provenance: "qloo" },
      { type: "text_delta", text: "Findings." },
    ]);
    expect(state.text).toBe("Findings.");
  });

  it("keeps a finished run finished when a late error arrives", () => {
    const state = reduceEvents([
      started,
      finished,
      { type: "error", message: "late", retryable: true },
    ]);
    expect(state.status).toBe("done");
    expect(state.error).toBeUndefined();
  });

  it("numbers requests across tool calls", () => {
    const state = reduceEvents([
      started,
      {
        type: "tool_result",
        id: "a",
        tool: "search",
        ok: true,
        summary: "",
        latency_ms: 1,
        provenance: "qloo",
        requests: [request("/search"), request("/search")],
      },
      {
        type: "tool_result",
        id: "b",
        tool: "insights",
        ok: true,
        summary: "",
        latency_ms: 1,
        provenance: "qloo",
        requests: [request("/v2/insights")],
      },
    ]);
    const traced = selectRequests(state.toolCalls);
    expect(traced.map((item) => [item.ordinal, item.tool, item.record.path])).toEqual([
      [1, "search", "/search"],
      [2, "search", "/search"],
      [3, "insights", "/v2/insights"],
    ]);
  });

  it("waits for an answer after needs_input, even when the stream then finishes", () => {
    const state = reduceEvents([
      started,
      { type: "step", id: "a", label: "Resolve", status: "running" },
      { type: "needs_input", question: "Which?", options: [{ id: "1", label: "One" }] },
      finished,
    ]);
    expect(state.status).toBe("awaiting_input");
    expect(state.needsInput).toEqual({ question: "Which?", options: [{ id: "1", label: "One" }] });
    expect(state.summary?.qlooCalls).toBe(3);
    // The step is not finished; the UI shows it as waiting rather than spinning.
    expect(state.steps[0]?.status).toBe("running");
  });

  it("stops every spinner on error and keeps only the closing summary afterwards", () => {
    const state = reduceEvents([
      started,
      { type: "step", id: "a", label: "Resolve", status: "running" },
      { type: "tool_call", id: "c", tool: "search", input: {}, provenance: "qloo" },
      { type: "error", message: "Rate limited", retryable: true },
      { type: "text_delta", text: "ignored" },
      { type: "step", id: "z", label: "Late", status: "running" },
      finished,
    ]);
    expect(state.status).toBe("error");
    expect(state.error).toEqual({ message: "Rate limited", retryable: true });
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]?.status).toBe("error");
    expect(state.toolCalls[0]?.status).toBe("error");
    expect(state.text).toBe("");
    expect(state.summary?.qlooCalls).toBe(3);
  });

  it("settles running steps when the run finishes", () => {
    const state = reduceEvents([
      started,
      { type: "step", id: "a", label: "Resolve", status: "running" },
      finished,
    ]);
    expect(state.steps[0]?.status).toBe("done");
    expect(state.status).toBe("done");
  });

  it("start clears the previous run", () => {
    const done = reduceEvents([started, finished]);
    expect(runReducer(done, { type: "start" })).toEqual({ ...initialRunState, status: "running" });
  });

  it("cancel skips running steps and ignores later events", () => {
    let state = reduceEvents([started, { type: "step", id: "a", label: "Resolve", status: "running" }]);
    state = runReducer(state, { type: "cancel" });
    expect(state.status).toBe("cancelled");
    expect(state.steps[0]?.status).toBe("skipped");
    state = runReducer(state, { type: "event", event: { type: "text_delta", text: "late" } });
    expect(state.text).toBe("");
  });

  it("cancel does nothing once a run has finished", () => {
    const done = reduceEvents([started, finished]);
    expect(runReducer(done, { type: "cancel" })).toBe(done);
  });

  it("reset returns to the idle state", () => {
    expect(runReducer(reduceEvents([started, finished]), { type: "reset" })).toBe(initialRunState);
  });
});

describe("selectSteps", () => {
  const call = (id: string, tool: string): AgentEvent => ({
    type: "tool_call",
    id,
    tool,
    input: {},
    provenance: "qloo",
  });
  const result = (id: string, tool: string, ok: boolean, summary: string): AgentEvent => ({
    type: "tool_result",
    id,
    tool,
    ok,
    summary,
    latency_ms: 1,
    provenance: "qloo",
  });

  it("uses the steps the server sent", () => {
    const state = reduceEvents([
      started,
      { type: "step", id: "a", label: "Read the request", status: "running" },
      call("c1", "resolve_entities"),
    ]);
    expect(selectSteps(state).map((step) => step.label)).toEqual(["Read the request"]);
  });

  it("falls back to one step per tool call when the server sends none", () => {
    const state = reduceEvents([
      started,
      call("c1", "resolve_entities"),
      result("c1", "resolve_entities", true, "Matched 4 of 4"),
      call("c2", "recommend"),
      result("c2", "recommend", false, "Qloo error (429)"),
      call("c3", "describeEntity"),
    ]);
    expect(selectSteps(state).map(({ label, status, detail }) => ({ label, status, detail }))).toEqual([
      { label: "Resolve entities", status: "done", detail: "Matched 4 of 4" },
      { label: "Recommend", status: "error", detail: "Qloo error (429)" },
      { label: "Describe entity", status: "running", detail: undefined },
    ]);
  });

  it("orders announcements by the call that changed last", () => {
    const state = reduceEvents([
      started,
      call("c1", "one"),
      call("c2", "two"),
      result("c1", "one", true, "done"),
    ]);
    const latest = [...selectSteps(state)].sort((a, b) => b.seq - a.seq)[0];
    expect(latest?.id).toBe("c1");
  });
});

describe("result selectors", () => {
  const results = [
    { kind: "summary", data: { a: 1 } },
    { kind: "abstain", data: { reason: "Too thin", details: ["no overlap"] } },
  ];

  it("separates abstain from content", () => {
    expect(selectAbstain(results)).toEqual({ reason: "Too thin", details: ["no overlap"] });
    expect(selectContentResults(results)).toEqual([{ kind: "summary", data: { a: 1 } }]);
    expect(selectAbstain([results[0]!])).toBeUndefined();
  });
});
