import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAgentEvent, type AgentEvent } from "./events";
import {
  MOCK_SCENARIOS,
  mockStreamRun,
  readMockSummary,
  type MockScenario,
} from "./mock-stream";
import { reduceEvents, selectAbstain, selectRequests } from "./run-state";

const SCENARIOS: MockScenario[] = [...MOCK_SCENARIOS.map((s) => s.value), "baseline"];

async function play(scenario: MockScenario, body?: unknown): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await mockStreamRun(body, (event) => events.push(event), undefined, { scenario, speed: Infinity });
  return events;
}

describe("mockStreamRun", () => {
  it.each(SCENARIOS)("%s: every event satisfies the stream contract", async (scenario) => {
    const events = await play(scenario);
    expect(events.length).toBeGreaterThan(3);
    for (const event of events) {
      // Round-trip through JSON, the way the real stream delivers it.
      const parsed = parseAgentEvent(JSON.parse(JSON.stringify(event)));
      expect(parsed.kind, JSON.stringify(event)).toBe("event");
    }
    expect(events[0]?.type).toBe("run_started");
  });

  it.each(SCENARIOS)("%s: ends with run_finished, as the real stream does", async (scenario) => {
    expect((await play(scenario)).at(-1)?.type).toBe("run_finished");
  });

  it("reports a Qloo call count that matches the listed requests", async () => {
    for (const scenario of SCENARIOS) {
      const state = reduceEvents(await play(scenario));
      expect(state.summary, scenario).toBeDefined();
      expect(state.summary?.qlooCalls, scenario).toBe(selectRequests(state.toolCalls).length);
    }
  });

  it("closes every step by the end of a finished run", async () => {
    for (const scenario of ["live", "recorded", "abstain", "baseline"] as const) {
      const state = reduceEvents(await play(scenario));
      expect(state.status, scenario).toBe("done");
      expect(state.steps.every((step) => step.status !== "running"), scenario).toBe(true);
    }
  });

  it("live: streams text, a summary result and Qloo requests", async () => {
    const state = reduceEvents(await play("live"));
    expect(state.mode).toBe("live");
    expect(state.text.length).toBeGreaterThan(100);
    expect(readMockSummary(state.results[0]?.data)?.headline.provenance).toBe("derived");
    const requests = selectRequests(state.toolCalls);
    expect(requests.map((item) => item.record.path)).toEqual([
      "/search",
      "/search",
      "/search",
      "/search",
      "/v2/insights",
      "/v2/insights",
      "/v2/insights",
    ]);
    expect(requests.some((item) => item.record.cached)).toBe(true);
    expect(state.toolCalls.map((call) => call.provenance)).toEqual(["qloo", "qloo", "derived"]);
  });

  it("recorded: flags the run and every request as recorded", async () => {
    const state = reduceEvents(await play("recorded"));
    expect(state.mode).toBe("recorded");
    const requests = selectRequests(state.toolCalls);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((item) => item.record.recorded === true)).toBe(true);
    expect(state.toolCalls.filter((c) => c.requests.length).every((c) => c.provenance === "recorded")).toBe(true);
  });

  it("needs_input: stops to ask, and an answer continues to the full run", async () => {
    const asked = reduceEvents(await play("needs_input"));
    expect(asked.status).toBe("awaiting_input");
    expect(asked.needsInput?.options.length).toBeGreaterThanOrEqual(2);

    const answered = reduceEvents(
      await play("needs_input", { answer: { option_id: "aurora-vale" } }),
    );
    expect(answered.status).toBe("done");
    expect(answered.results).toHaveLength(1);
  });

  it("abstain: ends with an abstain result and no content", async () => {
    const state = reduceEvents(await play("abstain"));
    expect(selectAbstain(state.results)?.reason).toMatch(/too little/i);
    expect(state.results.every((result) => result.kind === "abstain")).toBe(true);
  });

  it("error: fails with a retryable error, a failed request and the closing summary", async () => {
    const state = reduceEvents(await play("error"));
    expect(state.status).toBe("error");
    expect(state.error?.retryable).toBe(true);
    expect(selectRequests(state.toolCalls)[0]?.record.status).toBe(429);
    expect(state.summary?.qlooCalls).toBe(1);
  });

  it("baseline: answers without Qloo, then grades with cached Qloo requests", async () => {
    const state = reduceEvents(await play("baseline"));
    expect(state.toolCalls.map((call) => call.tool)).toEqual(["grade_with_qloo"]);
    expect(selectRequests(state.toolCalls).every((item) => item.record.cached)).toBe(true);
    expect(readMockSummary(state.results[0]?.data)?.rows.every((row) => row.provenance === "llm")).toBe(true);
  });

  it("gives each run its own id", async () => {
    const first = reduceEvents(await play("live"));
    const second = reduceEvents(await play("live"));
    expect(first.runId).toBeDefined();
    expect(first.runId).not.toBe(second.runId);
    expect(first.summary).toBeDefined();
  });

  it("stops quietly when aborted", async () => {
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    await mockStreamRun(
      undefined,
      (event) => {
        events.push(event);
        if (events.length === 2) controller.abort();
      },
      controller.signal,
      { scenario: "live", speed: Infinity },
    );
    expect(events).toHaveLength(2);
  });

  it("does not start when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const events: AgentEvent[] = [];
    await mockStreamRun(undefined, (event) => events.push(event), controller.signal, {
      scenario: "live",
    });
    expect(events).toEqual([]);
  });
});

describe("mockStreamRun timing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers events as their delays pass and stops when aborted while waiting", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const run = mockStreamRun(undefined, (event) => events.push(event), controller.signal, {
      scenario: "live",
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(events.map((event) => event.type)).toEqual(["run_started"]);
    await vi.advanceTimersByTimeAsync(149);
    expect(events).toHaveLength(1); // the next beat is due 150 ms after the first
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toHaveLength(2);

    controller.abort();
    await run; // resolves right away instead of sleeping on
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("scales delays with the playback speed", async () => {
    vi.useFakeTimers();
    const events: AgentEvent[] = [];
    const run = mockStreamRun(undefined, (event) => events.push(event), undefined, {
      scenario: "live",
      speed: 10,
    });
    await vi.advanceTimersByTimeAsync(15); // 150 ms at speed 10
    expect(events).toHaveLength(2);
    await vi.runAllTimersAsync();
    await run;
    expect(events.at(-1)?.type).toBe("run_finished");
  });

  it("treats a speed that is not positive as normal speed", async () => {
    vi.useFakeTimers();
    const events: AgentEvent[] = [];
    const run = mockStreamRun(undefined, (event) => events.push(event), undefined, {
      scenario: "live",
      speed: 0,
    });
    await vi.advanceTimersByTimeAsync(149);
    expect(events).toHaveLength(1);
    await vi.runAllTimersAsync();
    await run;
  });
});

describe("MOCK_STREAM_ENABLED", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    ["1", true],
    ["0", false],
    ["", false],
    ["true", false],
    [undefined, false],
  ])("NEXT_PUBLIC_MOCK_STREAM=%j gives %s", async (value, expected) => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_STREAM", value);
    vi.resetModules();
    const fresh = await import("./mock-stream");
    expect(fresh.MOCK_STREAM_ENABLED).toBe(expected);
  });
});

describe("readMockSummary", () => {
  it("rejects payloads that are not summaries", () => {
    expect(readMockSummary(null)).toBeNull();
    expect(readMockSummary({ title: "x" })).toBeNull();
    expect(
      readMockSummary({
        title: "x",
        headline: { label: "l", value: "v", provenance: "guess" },
        rows: [],
      }),
    ).toBeNull();
  });

  it("drops rows it cannot read", () => {
    const summary = readMockSummary({
      title: "x",
      headline: { label: "l", value: "v", provenance: "qloo" },
      rows: [{ label: "ok", value: "1", provenance: "derived" }, { label: "bad" }],
    });
    expect(summary?.rows).toEqual([{ label: "ok", value: "1", provenance: "derived" }]);
  });
});
