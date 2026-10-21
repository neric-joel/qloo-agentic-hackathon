import { describe, expect, it } from "vitest";

import { liveWhenRecorded, parseAgentEvent, readAbstainData, type QlooRequestRecord } from "./events";

function expectEvent(raw: unknown) {
  const parsed = parseAgentEvent(raw);
  if (parsed.kind !== "event") throw new Error(`expected an event, got ${JSON.stringify(parsed)}`);
  return parsed.event;
}

function expectInvalid(raw: unknown): string {
  const parsed = parseAgentEvent(raw);
  if (parsed.kind !== "invalid") throw new Error(`expected invalid, got ${JSON.stringify(parsed)}`);
  return parsed.reason;
}

describe("parseAgentEvent", () => {
  it("accepts every event type in the contract", () => {
    const samples = [
      { type: "run_started", run_id: "r1", mode: "recorded" },
      { type: "step", id: "s1", label: "Read", status: "skipped", detail: "cached" },
      { type: "tool_call", id: "c1", tool: "search", input: { q: "x" }, provenance: "qloo" },
      {
        type: "tool_result",
        id: "c1",
        tool: "search",
        ok: true,
        summary: "1 match",
        latency_ms: 120,
        provenance: "derived",
        requests: [
          {
            path: "/search",
            params: { query: "x" },
            status: 200,
            latency_ms: 118,
            cached: false,
            request_id: "abc",
          },
        ],
      },
      { type: "text_delta", text: "Hello" },
      { type: "needs_input", question: "Which?", options: [{ id: "a", label: "A" }] },
      { type: "result", kind: "anything", data: { any: ["thing"] } },
      { type: "error", message: "Nope", retryable: true },
      {
        type: "run_finished",
        run_id: "r1",
        usage: { input_tokens: 10, output_tokens: 5 },
        qloo_calls: 1,
        elapsed_ms: 900,
      },
    ];
    for (const sample of samples) expect(expectEvent(sample)).toEqual(sample);
  });

  it("treats null optional fields (serialized None) as absent", () => {
    const event = expectEvent({
      type: "tool_result",
      id: "c1",
      tool: "search",
      ok: true,
      summary: "ok",
      latency_ms: 5,
      provenance: "qloo",
      requests: [
        { path: "/search", params: { a: "1" }, status: 200, latency_ms: 4, cached: true, request_id: null },
      ],
    });
    expect(event).toMatchObject({ requests: [{ path: "/search" }] });
    if (event.type === "tool_result") expect(event.requests?.[0]).not.toHaveProperty("request_id");

    expect(
      expectEvent({ type: "step", id: "s", label: "L", status: "done", detail: null }),
    ).toEqual({ type: "step", id: "s", label: "L", status: "done" });
  });

  it("coerces request params to strings and defaults cached to false", () => {
    const event = expectEvent({
      type: "tool_result",
      id: "c1",
      tool: "insights",
      ok: true,
      summary: "ok",
      latency_ms: 5,
      provenance: "qloo",
      requests: [
        {
          path: "/v2/insights",
          params: { take: 20, flag: true, ids: ["a", "b"], skip: null },
          status: 200,
          latency_ms: 4,
        },
      ],
    });
    if (event.type !== "tool_result") throw new Error("unreachable");
    expect(event.requests?.[0]).toEqual({
      path: "/v2/insights",
      params: { take: "20", flag: "true", ids: "a,b" },
      status: 200,
      latency_ms: 4,
      cached: false,
    });
  });

  it("keeps the recorded flag on request records", () => {
    const event = expectEvent({
      type: "tool_result",
      id: "c1",
      tool: "t",
      ok: true,
      summary: "ok",
      latency_ms: 1,
      provenance: "recorded",
      requests: [{ path: "/search", params: {}, status: 200, latency_ms: 1, cached: false, recorded: true }],
    });
    if (event.type !== "tool_result") throw new Error("unreachable");
    expect(event.requests?.[0]?.recorded).toBe(true);
  });

  it("keeps a stated recorded false, and leaves an unstated one out", () => {
    const requestOf = (request: Record<string, unknown>) => {
      const event = expectEvent({
        type: "tool_result",
        id: "c1",
        tool: "t",
        ok: true,
        summary: "ok",
        latency_ms: 1,
        provenance: "qloo",
        requests: [{ path: "/search", params: {}, status: 200, latency_ms: 1, cached: false, ...request }],
      });
      if (event.type !== "tool_result") throw new Error("unreachable");
      return event.requests?.[0];
    };
    expect(requestOf({ recorded: false })?.recorded).toBe(false);
    expect(requestOf({})).not.toHaveProperty("recorded");
    expect(requestOf({ recorded: null })).not.toHaveProperty("recorded");
    expect(requestOf({ recorded: "yes" })).not.toHaveProperty("recorded");
  });

  it("keeps a well-formed capture provenance on a request and drops a malformed one", () => {
    const requestOf = (captured: unknown) => {
      const event = expectEvent({
        type: "tool_result",
        id: "c1",
        tool: "t",
        ok: true,
        summary: "ok",
        latency_ms: 1,
        provenance: "recorded",
        requests: [{ path: "/v2/analysis/compare", params: {}, status: 200, latency_ms: 1, cached: false, recorded: true, captured }],
      });
      if (event.type !== "tool_result") throw new Error("unreachable");
      return event.requests?.[0];
    };
    const at = "2026-10-03T05:58:05Z";
    expect(requestOf({ cached: false, recorded: false, at })?.captured).toEqual({ cached: false, recorded: false, at });
    // A field the saved event did not state reads as null.
    expect(requestOf({ cached: true, recorded: null })?.captured).toEqual({ cached: true, recorded: null, at: null });
    // Malformed: dropped, the rest of the request kept, nothing thrown.
    for (const bad of ["live", 1, [], { cached: "false", recorded: false, at }, { cached: false, recorded: 0, at }, { cached: false, recorded: false, at: 20261003 }]) {
      const request = requestOf(bad);
      expect(request, JSON.stringify(bad)).not.toHaveProperty("captured");
      expect(request?.path).toBe("/v2/analysis/compare");
    }
    expect(requestOf(undefined)).not.toHaveProperty("captured");
    expect(requestOf(null)).not.toHaveProperty("captured");
  });

  it("ignores unknown event types", () => {
    expect(parseAgentEvent({ type: "telemetry", n: 1 })).toEqual({ kind: "unknown", type: "telemetry" });
  });

  it("names the field that breaks the contract", () => {
    expect(expectInvalid({ type: "step", label: "No id", status: "running" })).toBe(
      "step.id must be a string",
    );
    expect(expectInvalid({ type: "step", id: "s", label: "L", status: "paused" })).toContain(
      "step.status must be one of",
    );
    expect(
      expectInvalid({
        type: "tool_result",
        id: "c",
        tool: "t",
        ok: true,
        summary: "s",
        latency_ms: 1,
        provenance: "qloo",
        requests: [{ path: "/x", params: {}, status: "200", latency_ms: 1 }],
      }),
    ).toBe("tool_result.requests[0].status must be a number");
    expect(expectInvalid({ type: "run_started", run_id: "r", mode: "sandbox" })).toContain(
      "run_started.mode",
    );
  });

  it("rejects every required field that is missing or of the wrong type", () => {
    const base = {
      tool_call: { type: "tool_call", id: "c", tool: "t", input: {}, provenance: "qloo" },
      tool_result: {
        type: "tool_result",
        id: "c",
        tool: "t",
        ok: true,
        summary: "s",
        latency_ms: 1,
        provenance: "qloo",
      },
      text_delta: { type: "text_delta", text: "x" },
      needs_input: { type: "needs_input", question: "Q?", options: [{ id: "a", label: "A" }] },
      result: { type: "result", kind: "k", data: 1 },
      run_started: { type: "run_started", run_id: "r", mode: "live" },
      run_finished: { type: "run_finished", run_id: "r", qloo_calls: 0, elapsed_ms: 0 },
      step: { type: "step", id: "s", label: "L", status: "done" },
    } as const;

    // Each of these fields is needed to render the event, so losing any of them is an error.
    const required: [keyof typeof base, string, unknown][] = [
      ["tool_call", "id", undefined],
      ["tool_call", "tool", 5],
      ["tool_call", "provenance", "guess"],
      ["tool_result", "tool", undefined],
      ["tool_result", "ok", "yes"],
      ["tool_result", "summary", undefined],
      ["tool_result", "latency_ms", "fast"],
      ["tool_result", "provenance", undefined],
      ["text_delta", "text", undefined],
      ["needs_input", "question", undefined],
      ["needs_input", "options", "a,b"],
      ["result", "kind", undefined],
      ["run_started", "run_id", undefined],
      ["run_finished", "run_id", undefined],
      ["run_finished", "qloo_calls", undefined],
      ["run_finished", "elapsed_ms", "soon"],
      ["step", "label", undefined],
    ];
    for (const [type, field, bad] of required) {
      const broken = { ...base[type], [field]: bad };
      expect(parseAgentEvent(broken).kind, `${type}.${field}`).toBe("invalid");
    }
  });

  it("needs at least one option per question, and unique option ids", () => {
    const ask = (options: unknown) => parseAgentEvent({ type: "needs_input", question: "Q?", options });
    expect(ask([])).toEqual({ kind: "invalid", reason: "needs_input.options must not be empty" });
    expect(
      ask([
        { id: "a", label: "A" },
        { id: "a", label: "Again" },
      ]),
    ).toEqual({ kind: "invalid", reason: "needs_input.options[1].id must be unique" });
    expect(ask([{ id: "a" }])).toEqual({
      kind: "invalid",
      reason: "needs_input.options[0].label must be a string",
    });
  });

  it("reports a payload it cannot walk as invalid instead of throwing", () => {
    let nested: unknown[] = [];
    for (let depth = 0; depth < 200_000; depth++) nested = [nested];
    const parsed = parseAgentEvent({
      type: "tool_result",
      id: "c",
      tool: "t",
      ok: true,
      summary: "s",
      latency_ms: 1,
      provenance: "qloo",
      requests: [{ path: "/x", params: { deep: nested }, status: 200, latency_ms: 1 }],
    });
    expect(parsed).toEqual({ kind: "invalid", reason: "tool_result payload could not be read" });
  });

  it("rejects values that are not event objects", () => {
    expect(expectInvalid(null)).toBe("event must be a JSON object");
    expect(expectInvalid([])).toBe("event must be a JSON object");
    expect(expectInvalid("data")).toBe("event must be a JSON object");
    expect(expectInvalid({ id: 1 })).toBe("event.type must be a string");
  });

  it("is forgiving about a sparse error event", () => {
    expect(expectEvent({ type: "error" })).toEqual({
      type: "error",
      message: "Something went wrong.",
      retryable: false,
    });
  });

  it("drops malformed usage instead of rejecting the run", () => {
    const event = expectEvent({
      type: "run_finished",
      run_id: "r",
      qloo_calls: 2,
      elapsed_ms: 10,
      usage: { input_tokens: "many" },
    });
    expect(event).toEqual({ type: "run_finished", run_id: "r", qloo_calls: 2, elapsed_ms: 10 });
  });
});

describe("liveWhenRecorded", () => {
  const flags = (record: Partial<QlooRequestRecord>) => ({ cached: false, ...record });

  it("is true only when the request was neither cached nor recorded, both stated", () => {
    expect(liveWhenRecorded({ cached: false, recorded: false })).toBe(true);
  });

  it("is false when the request was cached or recorded", () => {
    expect(liveWhenRecorded({ cached: true, recorded: false })).toBe(false);
    expect(liveWhenRecorded({ cached: false, recorded: true })).toBe(false);
    expect(liveWhenRecorded({ cached: true, recorded: true })).toBe(false);
    expect(liveWhenRecorded({ cached: true })).toBe(false);
  });

  it("is unknown, never live, when recorded is missing", () => {
    expect(liveWhenRecorded(flags({}))).toBeNull();
    expect(liveWhenRecorded({ cached: false, recorded: undefined })).toBeNull();
  });

  it("reads a replayed request's capture provenance before its own flags", () => {
    // Replayed now (its own recorded is true), reached Qloo live when it was recorded.
    const replayed = { cached: false, recorded: true, captured: { cached: false, recorded: false, at: "2026-10-03T05:58:05Z" } };
    expect(liveWhenRecorded(replayed)).toBe(true);
    expect(liveWhenRecorded({ ...replayed, captured: { cached: true, recorded: false, at: null } })).toBe(false);
    expect(liveWhenRecorded({ ...replayed, captured: { cached: false, recorded: true, at: null } })).toBe(false);
    // The saved event did not say: unknown, even though the record's own flags would read live.
    expect(liveWhenRecorded({ cached: false, recorded: false, captured: { cached: false, recorded: null, at: null } })).toBeNull();
    expect(liveWhenRecorded({ cached: false, recorded: false, captured: { cached: null, recorded: false, at: null } })).toBeNull();
  });

  it("reads a parsed event's request the same way", () => {
    const parsed = parseAgentEvent({
      type: "tool_result",
      id: "c1",
      tool: "explain_clash",
      ok: true,
      summary: "ok",
      latency_ms: 1,
      provenance: "qloo",
      requests: [
        { path: "/v2/analysis/compare", params: {}, status: 200, latency_ms: 1, cached: false, recorded: false },
        { path: "/v2/analysis/compare", params: {}, status: 200, latency_ms: 1, cached: false },
        { path: "/v2/insights", params: {}, status: 200, latency_ms: 1, cached: true, recorded: false },
      ],
    });
    if (parsed.kind !== "event" || parsed.event.type !== "tool_result") throw new Error("unreachable");
    expect(parsed.event.requests?.map(liveWhenRecorded)).toEqual([true, null, false]);
  });
});

describe("readAbstainData", () => {
  it("reads a reason and details", () => {
    expect(readAbstainData({ reason: "Too thin", details: ["a", "", 3, "b"] })).toEqual({
      reason: "Too thin",
      details: ["a", "b"],
    });
  });

  it("falls back to a default reason", () => {
    expect(readAbstainData(undefined).reason).toMatch(/not have enough data/);
    expect(readAbstainData({ reason: "  " }).reason).toMatch(/not have enough data/);
  });
});
