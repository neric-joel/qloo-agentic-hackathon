import { describe, expect, it } from "vitest";

import { readClashReply } from "./agent-session";
import {
  MAX_GAP_MS,
  MAX_REPLAY_MS,
  MAX_TEXT_GAP_MS,
  parseRecordings,
  replayFinalState,
  toReplayBeats,
  type RecordedRun,
} from "./recorded-run";
import { selectRequests } from "./run-state";

// Every name, id and figure below is invented for the test.
const REQUEST_ID = "00000000-test-4000-8000-000000000001";

type RawEvent = { t: number; event: Record<string, unknown> };

function rawRun(overrides: Record<string, unknown> = {}, events?: readonly unknown[]) {
  return {
    id: "test-run",
    title: "Explain a clash",
    question: "Why do Act One and Act Two clash?",
    captured_at: "2026-10-04T14:02:11Z",
    model: "test-model",
    events: events ?? rawEvents(),
    ...overrides,
  };
}

function rawEvents(): RawEvent[] {
  return [
    { t: 0, event: { type: "run_started", run_id: "run_test01", mode: "live" } },
    {
      t: 1200,
      event: { type: "tool_call", id: "call-1", tool: "explain_clash", input: { act_a: "Act One", act_b: "Act Two" }, provenance: "qloo" },
    },
    {
      t: 1650,
      event: {
        type: "tool_result",
        id: "call-1",
        tool: "explain_clash",
        ok: true,
        summary: "Act One / Act Two: taste overlap 62/100",
        latency_ms: 431,
        provenance: "qloo",
        requests: [
          {
            path: "/v2/analysis/compare",
            params: { "a.signal.interests.entities": "ENTITY-A", "b.signal.interests.entities": "ENTITY-B", take: "50" },
            status: 200,
            latency_ms: 428,
            cached: false,
            recorded: false,
            request_id: REQUEST_ID,
          },
        ],
      },
    },
    {
      t: 1700,
      event: { type: "tool_call", id: "call-2", tool: "try_move", input: { act: "Act Two" }, provenance: "derived" },
    },
    {
      t: 1712,
      event: { type: "tool_result", id: "call-2", tool: "try_move", ok: true, summary: "What if Act Two moves", latency_ms: 9, provenance: "derived", requests: [] },
    },
    { t: 4000, event: { type: "text_delta", text: "They clash " } },
    { t: 4500, event: { type: "text_delta", text: "for 45 minutes." } },
    {
      t: 4520,
      event: {
        type: "result",
        kind: "clash",
        data: {
          text: "They clash for 45 minutes.",
          tool_data: {
            "call-1": { kind: "clash", a: { name: "Act One" }, b: { name: "Act Two" }, minutes_overlapping: 45, taste_overlap: 0.62, qloo_tags_for_pair: ["Indie rock"] },
          },
          session: { timetable: [{ act_id: "a1", day: 0, stage_id: "s1", start: 600, end: 660 }], constraints: null, rules: ["Keep Act One where it is"] },
        },
      },
    },
    { t: 4530, event: { type: "run_finished", run_id: "run_test01", usage: { input_tokens: 10, output_tokens: 5 }, qloo_calls: 1, elapsed_ms: 4530 } },
  ];
}

function only(json: unknown): RecordedRun {
  const runs = parseRecordings(json);
  expect(runs).toHaveLength(1);
  return runs[0];
}

describe("parseRecordings", () => {
  it("reads the API response, a bare list and the saved file shape", () => {
    const run = only({ runs: [rawRun()] });
    expect(run).toMatchObject({
      id: "test-run",
      title: "Explain a clash",
      question: "Why do Act One and Act Two clash?",
      capturedAt: "2026-10-04T14:02:11Z",
      model: "test-model",
    });
    expect(run.events).toHaveLength(9);
    expect(run.events[2].t).toBe(1650);
    expect(parseRecordings([rawRun()])).toHaveLength(1);
    expect(parseRecordings({ preset_id: "test-day", runs: [rawRun()] })).toHaveLength(1);
  });

  it("is empty for an empty or unusable response", () => {
    expect(parseRecordings({ runs: [] })).toEqual([]);
    expect(parseRecordings([])).toEqual([]);
    for (const garbage of [null, undefined, "runs", 42, { runs: "x" }, { detail: "No preset 'x'." }, [null, 3, "x"]]) {
      expect(parseRecordings(garbage)).toEqual([]);
    }
  });

  it("drops a run that lacks run_started, run_finished or a clash result", () => {
    const events = rawEvents();
    expect(parseRecordings([rawRun({}, events.slice(1))])).toEqual([]);
    expect(parseRecordings([rawRun({}, events.slice(0, -1))])).toEqual([]);
    expect(parseRecordings([rawRun({}, events.filter(({ event }) => event.type !== "result"))])).toEqual([]);
    const otherKind = events.map((item) =>
      item.event.type === "result" ? { ...item, event: { ...item.event, kind: "explore" } } : item,
    );
    expect(parseRecordings([rawRun({}, otherKind)])).toEqual([]);
  });

  it("drops a run with an error, an invalid event or a bad time, and keeps the others", () => {
    const events = rawEvents();
    const withError = [...events.slice(0, -1), { t: 4525, event: { type: "error", message: "x", retryable: true } }, events.at(-1)!];
    const invalid = events.map((item, i) => (i === 2 ? { ...item, event: { ...item.event, ok: "yes" } } : item));
    const badTime = events.map((item, i) => (i === 3 ? { ...item, t: "soon" } : item));
    const negative = events.map((item, i) => (i === 3 ? { ...item, t: -5 } : item));
    const runs = parseRecordings({
      runs: [
        rawRun({ id: "with-error" }, withError),
        rawRun({ id: "invalid" }, invalid),
        rawRun({ id: "bad-time" }, badTime),
        rawRun({ id: "negative" }, negative),
        rawRun({ id: "good" }),
      ],
    });
    expect(runs.map((run) => run.id)).toEqual(["good"]);
  });

  it("drops a run with no id, title or question, and a repeated id", () => {
    const runs = parseRecordings([
      rawRun({ id: "" }),
      rawRun({ title: 3 }),
      rawRun({ question: undefined }),
      rawRun({ id: "first" }),
      rawRun({ id: "first", title: "Again" }),
    ]);
    expect(runs.map((run) => [run.id, run.title])).toEqual([["first", "Explain a clash"]]);
  });

  it("skips event types this client does not know and keeps the run", () => {
    const events = [...rawEvents()];
    events.splice(1, 0, { t: 10, event: { type: "thinking", text: "hmm" } });
    const run = only([rawRun({}, events)]);
    expect(run.events.map(({ event }) => event.type)).not.toContain("thinking");
    expect(run.events).toHaveLength(9);
  });

  it("tolerates a missing capture date and model", () => {
    const run = only([rawRun({ captured_at: undefined, model: null })]);
    expect(run.capturedAt).toBe("");
    expect(run.model).toBe("");
  });
});

describe("toReplayBeats", () => {
  const run = only([rawRun()]);

  it("labels the run, its Qloo steps and its requests as recorded and keeps the request ids", () => {
    const events = toReplayBeats(run).map((beat) => beat.event);
    expect(events[0]).toEqual({ type: "run_started", run_id: "run_test01", mode: "recorded" });
    const call = events.find((event) => event.type === "tool_call" && event.tool === "explain_clash");
    expect(call).toMatchObject({ provenance: "recorded" });
    const result = events.find((event) => event.type === "tool_result" && event.tool === "explain_clash");
    expect(result).toMatchObject({
      provenance: "recorded",
      latency_ms: 431,
      requests: [
        {
          path: "/v2/analysis/compare",
          params: { "a.signal.interests.entities": "ENTITY-A", "b.signal.interests.entities": "ENTITY-B", take: "50" },
          status: 200,
          latency_ms: 428,
          cached: false,
          recorded: true,
          request_id: REQUEST_ID,
        },
      ],
    });
    // Steps that never reached Qloo keep their own label.
    const derived = events.find((event) => event.type === "tool_result" && event.tool === "try_move");
    expect(derived).toMatchObject({ provenance: "derived", requests: [] });
    // Nothing else changes, the answer and the closing summary included.
    expect(events.at(-2)).toEqual(run.events.at(-2)?.event);
    expect(events.at(-1)).toEqual(run.events.at(-1)?.event);
  });

  it("does not change the parsed run", () => {
    toReplayBeats(run);
    expect(run.events[0].event).toMatchObject({ mode: "live" });
  });

  it("paces from the saved times, with each gap capped", () => {
    const beats = toReplayBeats(run);
    expect(beats.map((beat) => beat.after)).toEqual([0, MAX_GAP_MS, 450, 50, 12, MAX_TEXT_GAP_MS, MAX_TEXT_GAP_MS, 20, 10]);
  });

  it("plays a long run faster so the whole replay stays within the limit", () => {
    const start = { t: 0, event: { type: "run_started", run_id: "run_long", mode: "live" } };
    const words = Array.from({ length: 600 }, (_, i) => ({ t: 100 + i * 50, event: { type: "text_delta", text: `w${i} ` } }));
    const end = rawEvents().slice(-2).map((item, i) => ({ ...item, t: 40_000 + i }));
    const beats = toReplayBeats(only([rawRun({}, [start, ...words, ...end])]));
    const total = beats.reduce((sum, beat) => sum + beat.after, 0);
    expect(total).toBeLessThanOrEqual(MAX_REPLAY_MS + 1e-6);
    expect(total).toBeGreaterThan(MAX_REPLAY_MS - 1);
    expect(beats.every((beat) => beat.after >= 0 && beat.after <= MAX_GAP_MS)).toBe(true);
  });

  it("never waits a negative time when saved times go backwards", () => {
    const events = rawEvents().map((item, i) => (i === 4 ? { ...item, t: 100 } : item));
    const beats = toReplayBeats(only([rawRun({}, events)]));
    expect(beats.every((beat) => beat.after >= 0)).toBe(true);
  });
});

describe("replayFinalState", () => {
  it("ends as a finished recorded run with the answer, the cards and the request ids", () => {
    const state = replayFinalState(only([rawRun()]));
    expect(state.status).toBe("done");
    expect(state.mode).toBe("recorded");
    expect(state.runId).toBe("run_test01");
    expect(state.text).toBe("They clash for 45 minutes.");
    expect(state.toolCalls.map((call) => [call.tool, call.status, call.provenance])).toEqual([
      ["explain_clash", "done", "recorded"],
      ["try_move", "done", "derived"],
    ]);
    const requests = selectRequests(state.toolCalls);
    expect(requests.map((item) => [item.record.request_id, item.record.recorded])).toEqual([[REQUEST_ID, true]]);
    expect(state.summary).toMatchObject({ qlooCalls: 1, elapsedMs: 4530 });
    expect(readClashReply(state.results)?.explains[0]).toMatchObject({ a: "Act One", sharedTaste: ["Indie rock"] });
  });
});
