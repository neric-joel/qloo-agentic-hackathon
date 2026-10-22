import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { traceJson, traceStats } from "@/components/kernel/trace-drawer";
import { RequestItem, replayedRequestText } from "@/components/kernel/trace-parts";

import { readClashReply } from "./agent-session";
import type { QlooRequestRecord } from "./events";
import {
  MAX_GAP_MS,
  MAX_REPLAY_MS,
  MAX_STEP_MS,
  MIN_REPLAY_MS,
  MIN_STEP_MS,
  TEXT_STEP_MS,
  askedQlooWhenRecorded,
  orderRecordings,
  parseRecordings,
  replayFinalState,
  runEnding,
  savedRequests,
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
          // How it was served when the run was recorded, from the saved event's own flags and the run's date.
          captured: { cached: false, recorded: false, at: "2026-10-04T14:02:11Z" },
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

  it("pins the pacing constants", () => {
    expect({ TEXT_STEP_MS, MIN_STEP_MS, MAX_GAP_MS, MIN_REPLAY_MS, MAX_STEP_MS, MAX_REPLAY_MS }).toEqual({
      TEXT_STEP_MS: 55,
      MIN_STEP_MS: 650,
      MAX_GAP_MS: 1_200,
      MIN_REPLAY_MS: 6_000,
      MAX_STEP_MS: 2_500,
      MAX_REPLAY_MS: 14_000,
    });
  });

  it("paces by event kind, with a step's saved gap clamped and text at a steady step", () => {
    // Long enough (with 20 more pieces of text) that nothing is stretched.
    const events = rawEvents();
    const more = Array.from({ length: 20 }, (_, i) => ({ t: 4501 + i, event: { type: "text_delta", text: `w${i} ` } }));
    const beats = toReplayBeats(only([rawRun({}, [...events.slice(0, 7), ...more, ...events.slice(7)])]));
    expect(beats.map((beat) => beat.after)).toEqual([
      0, // run_started
      MAX_GAP_MS, // tool_call: saved 1,200
      MIN_STEP_MS, // tool_result: saved 450
      MIN_STEP_MS, // tool_call: saved 50
      MIN_STEP_MS, // tool_result: saved 12
      MAX_GAP_MS, // first text: saved 2,288
      ...Array.from({ length: 21 }, () => TEXT_STEP_MS), // the rest of the burst
      MIN_STEP_MS, // result
      10, // run_finished: its saved gap
    ]);
    expect(beats.reduce((sum, beat) => sum + beat.after, 0)).toBeGreaterThanOrEqual(MIN_REPLAY_MS);
  });

  it("stretches a short run's steps to the minimum and keeps its events and ids as saved", () => {
    // Shaped like the saved runs: one model pause, one tool call, then the answer as a burst of 23
    // pieces of text arriving together. 28 events over 3.6 seconds as saved.
    const start = { t: 0, event: { type: "run_started", run_id: "run_burst", mode: "live" } };
    const [, call, result] = rawEvents();
    const words = Array.from({ length: 23 }, (_, i) => ({ t: 3639 + i / 10, event: { type: "text_delta", text: `w${i} ` } }));
    const end = rawEvents().slice(-2).map((item, i) => ({ ...item, t: 3642 + i / 10 }));
    const burst = only([rawRun({}, [start, { ...call, t: 1612 }, { ...result, t: 1615 }, ...words, ...end])]);
    expect(burst.events).toHaveLength(28);

    const beats = toReplayBeats(burst);
    const total = beats.reduce((sum, beat) => sum + beat.after, 0);
    expect(total).toBeGreaterThanOrEqual(MIN_REPLAY_MS - 1e-6);
    expect(total).toBeLessThanOrEqual(MAX_REPLAY_MS);
    expect(total).toBeCloseTo(MIN_REPLAY_MS, 6);

    // Same events in the same order, with the request id kept.
    expect(beats.map((beat) => beat.event.type)).toEqual(burst.events.map(({ event }) => event.type));
    const textOf = (event: { type: string; text?: string }) => (event.type === "text_delta" ? event.text : null);
    expect(beats.map((beat) => textOf(beat.event))).toEqual(burst.events.map(({ event }) => textOf(event)));
    const ids = selectRequests(replayFinalState(burst).toolCalls).map((item) => item.record.request_id);
    expect(ids).toEqual([REQUEST_ID]);

    // Every piece of text waits at least the text step; every step at least the minimum, at most the cap.
    beats.forEach((beat) => {
      if (beat.event.type === "text_delta") expect(beat.after).toBeGreaterThanOrEqual(TEXT_STEP_MS);
      if (["tool_call", "tool_result", "result"].includes(beat.event.type)) {
        expect(beat.after).toBeGreaterThanOrEqual(MIN_STEP_MS);
        expect(beat.after).toBeLessThanOrEqual(MAX_STEP_MS);
      }
    });
    // Only the steps are stretched: the text inside the burst keeps its steady step.
    expect(beats.filter((beat) => beat.event.type === "text_delta").slice(1).every((beat) => beat.after === TEXT_STEP_MS)).toBe(true);
  });

  it("never stretches one step past the cap, even when the run cannot reach the minimum", () => {
    const start = { t: 0, event: { type: "run_started", run_id: "run_tiny", mode: "live" } };
    const end = rawEvents().slice(-2).map((item, i) => ({ ...item, t: 10 + i }));
    const beats = toReplayBeats(only([rawRun({}, [start, { t: 5, event: { type: "text_delta", text: "Hi." } }, ...end])]));
    expect(beats.map((beat) => beat.after)).toEqual([0, MAX_STEP_MS, MAX_STEP_MS, 1]);
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

  it("ends within the limit when the saved gaps are long", () => {
    const start = { t: 0, event: { type: "run_started", run_id: "run_slow", mode: "live" } };
    const [, call, result] = rawEvents();
    const steps = Array.from({ length: 12 }, (_, i) => [
      { ...call, t: 20_000 * i + 10_000, event: { ...call.event, id: `call-${i}` } },
      { ...result, t: 20_000 * i + 19_000, event: { ...result.event, id: `call-${i}` } },
    ]).flat();
    const end = rawEvents().slice(-4).map((item, i) => ({ ...item, t: 300_000 + 10_000 * i }));
    const beats = toReplayBeats(only([rawRun({}, [start, ...steps, ...end])]));
    expect(beats.reduce((sum, beat) => sum + beat.after, 0)).toBeLessThanOrEqual(MAX_REPLAY_MS + 1e-6);
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

/**
 * A run whose saved `result` carries these tool results (in call order), with the other events as saved: its explain
 * step's one Qloo request kept (`asked`, the default) or saved with no request at all, as a run that never reached
 * Qloo is. `title` replaces the default "Run {id}".
 */
function endingWith(
  id: string,
  toolData: Record<string, Record<string, unknown>>,
  { asked = true, title = `Run ${id}` }: { asked?: boolean; title?: string } = {},
): RecordedRun {
  const events = rawEvents().map((item) => {
    if (item.event.type === "result") {
      return { ...item, event: { ...item.event, data: { ...(item.event.data as object), tool_data: toolData } } };
    }
    if (!asked && item.event.type === "tool_result") return { ...item, event: { ...item.event, requests: [] } };
    if (!asked && item.event.type === "run_finished") return { ...item, event: { ...item.event, qloo_calls: 0 } };
    return item;
  });
  return only([rawRun({ id, title }, events)]);
}

const FOUND = { kind: "move_options", act: "Act Two", movable: true, options: [{ stage: "Side", start: "21:05", clash_budget_after: 99.1 }] };
const ALLOWED = { kind: "what_if", move: "Act Two: Side 20:00-21:00 -> Side 21:05-22:05", allowed: true, problems: [] };
const REFUSED = { kind: "what_if", move: "Act Two -> Main 15:30", allowed: false, problems: ["That slot is taken."] };
const EXPLAINED = { kind: "clash", a: { name: "Act One" }, b: { name: "Act Two" }, minutes_overlapping: 45 };

describe("how a recorded run ends, and the order the panel lists the runs in", () => {
  it("reads each run's ending from its own tool results, never from its words", () => {
    // A legal place found, or a tested move the rules allowed: the run ends with a place to keep.
    expect(runEnding(endingWith("found", { c1: FOUND }))).toBe("keep");
    expect(runEnding(endingWith("allowed", { c1: ALLOWED }))).toBe("keep");
    // Refused first, then a legal place found later in the same run: still a place to keep.
    expect(runEnding(endingWith("refused-then-found", { c1: REFUSED, c2: FOUND }))).toBe("keep");
    // Every move it tested was refused by the rules.
    expect(runEnding(endingWith("refused", { c1: REFUSED }))).toBe("refused");
    // An explanation, a find that listed no place, or a set that cannot move: neither.
    expect(runEnding(endingWith("explained", { c1: EXPLAINED }))).toBe("other");
    expect(runEnding(endingWith("nowhere", { c1: { ...FOUND, options: [] } }))).toBe("other");
    expect(runEnding(endingWith("fixed", { c1: { ...FOUND, movable: false } }))).toBe("other");
    expect(runEnding(endingWith("empty", {}))).toBe("other");
  });

  it("lists a run that ends with a place to keep first, the one with a Qloo request ahead, and a run the rules refuse last", () => {
    // The server's order, shaped as Glastonbury's saved file has it: the refusal first, and only the last run (a keep
    // run) holds a Qloo request.
    const served = [
      endingWith("refusal", { c1: REFUSED }, { asked: false }),
      endingWith("explain", { c1: EXPLAINED }, { asked: false }),
      endingWith("rules-then-move", { c1: FOUND }, { asked: false }),
      endingWith("hidden-clash-and-move", { c1: FOUND, c2: EXPLAINED, c3: ALLOWED }),
    ];
    expect(orderRecordings(served).map((run) => run.id)).toEqual(["hidden-clash-and-move", "rules-then-move", "explain", "refusal"]);
    // When every run holds a request (or none does), each group keeps the server's order.
    const allAsked = [
      endingWith("refusal", { c1: REFUSED }),
      endingWith("explain", { c1: EXPLAINED }),
      endingWith("rules-then-move", { c1: FOUND }),
      endingWith("second-keep", { c1: ALLOWED }),
    ];
    expect(orderRecordings(allAsked).map((run) => run.id)).toEqual(["rules-then-move", "second-keep", "explain", "refusal"]);
    const noneAsked = allAsked.map((run) => endingWith(run.id, toolDataOf(run), { asked: false }));
    expect(orderRecordings(noneAsked).map((run) => run.id)).toEqual(["rules-then-move", "second-keep", "explain", "refusal"]);
    // The served list itself is left as it was, and an ordered list orders to itself.
    expect(served.map((run) => run.id)).toEqual(["refusal", "explain", "rules-then-move", "hidden-clash-and-move"]);
    const ordered = orderRecordings(served);
    expect(orderRecordings(ordered)).toEqual(ordered);
    expect(orderRecordings([])).toEqual([]);
  });

  it("puts a keep run whose own events hold a Qloo request ahead of a keep run whose events hold none", () => {
    const quiet = endingWith("quiet", { c1: FOUND }, { asked: false });
    const asked = endingWith("asked", { c1: FOUND, c2: EXPLAINED });
    expect(savedRequests(quiet)).toEqual([]);
    expect(savedRequests(asked)).toHaveLength(1);
    // Either way round in the file, the run with the request leads.
    expect(orderRecordings([quiet, asked]).map((run) => run.id)).toEqual(["asked", "quiet"]);
    expect(orderRecordings([asked, quiet]).map((run) => run.id)).toEqual(["asked", "quiet"]);
    // Two keep runs with a request, or two without, keep the server's order between them.
    const alsoAsked = endingWith("also-asked", { c1: ALLOWED });
    expect(orderRecordings([quiet, alsoAsked, asked]).map((run) => run.id)).toEqual(["also-asked", "asked", "quiet"]);
    const alsoQuiet = endingWith("also-quiet", { c1: ALLOWED }, { asked: false });
    expect(orderRecordings([alsoQuiet, asked, quiet]).map((run) => run.id)).toEqual(["asked", "also-quiet", "quiet"]);
    // A request never lifts a run out of its group: the other runs and the refusals keep their rule and the server's order.
    const explainAsked = endingWith("explain-asked", { c1: EXPLAINED });
    const explainQuiet = endingWith("explain-quiet", { c1: EXPLAINED }, { asked: false });
    const refusedAsked = endingWith("refused-asked", { c1: REFUSED });
    const refusedQuiet = endingWith("refused-quiet", { c1: REFUSED }, { asked: false });
    expect(orderRecordings([refusedQuiet, refusedAsked, explainQuiet, explainAsked, quiet]).map((run) => run.id)).toEqual([
      "quiet",
      "explain-quiet",
      "explain-asked",
      "refused-quiet",
      "refused-asked",
    ]);
  });

  it("decides from each run's own events, never from its id, its title or its place in the file", () => {
    // The quiet run carries the id and title of the run that asked Qloo on the published day, and the other way round.
    const quiet = endingWith("hidden-clash-and-move", { c1: FOUND }, { asked: false, title: "Explain a hidden clash and find a move" });
    const asked = endingWith("rules-then-move", { c1: FOUND, c2: EXPLAINED }, { title: "Set two rules, then move one set" });
    expect(orderRecordings([quiet, asked]).map((run) => run.title)).toEqual([
      "Set two rules, then move one set",
      "Explain a hidden clash and find a move",
    ]);
    expect(orderRecordings([asked, quiet]).map((run) => run.id)).toEqual(["rules-then-move", "hidden-clash-and-move"]);
    // The same events under any id and title order the same way.
    const renamed = [endingWith("z", { c1: FOUND }, { asked: false, title: "A" }), endingWith("a", { c1: FOUND, c2: EXPLAINED }, { title: "Z" })];
    expect(orderRecordings(renamed).map((run) => run.id)).toEqual(["a", "z"]);
  });
});

/** The tool results a run's saved `result` carries, read back from the run. */
function toolDataOf(run: RecordedRun): Record<string, Record<string, unknown>> {
  const result = run.events.find(({ event }) => event.type === "result")?.event;
  const data = result && result.type === "result" ? (result.data as { tool_data?: Record<string, Record<string, unknown>> }) : null;
  return data?.tool_data ?? {};
}

/** The visible words of some markup. */
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** One request's row in the trace, as the drawer draws it. */
function rowText(record: QlooRequestRecord): string {
  return words(renderToStaticMarkup(createElement(RequestItem, { item: { record, toolId: "t", tool: "explain_clash", ordinal: 1 } })));
}

/**
 * Shaped like the saved Riot Fest run: captured 2026-10-03T05:58:05Z (still 2 Oct in Arizona), one compare request
 * that reached Qloo live when it was recorded. Ids and figures are invented; the flags and the time are the saved run's.
 */
function riotShaped(requestFlags: Record<string, unknown> = { cached: false, recorded: false }): RecordedRun {
  const events = rawEvents().map((item) =>
    item.event.type === "tool_result" && item.event.tool === "explain_clash"
      ? {
          ...item,
          event: {
            ...item.event,
            requests: [
              {
                path: "/v2/analysis/compare",
                params: { "a.signal.interests.entities": "ENTITY-A", "b.signal.interests.entities": "ENTITY-B" },
                status: 200,
                latency_ms: 335,
                request_id: REQUEST_ID,
                ...requestFlags,
              },
            ],
          },
        }
      : item,
  );
  return only([rawRun({ id: "riot-fest-move", title: "Find a move on a second festival day", captured_at: "2026-10-03T05:58:05Z" }, events)]);
}

/** The run's one replayed request, as the trace holds it once the replay has played. */
function replayedRequest(run: RecordedRun): QlooRequestRecord {
  const [item] = selectRequests(replayFinalState(run).toolCalls);
  return item.record;
}

describe("a replayed request keeps whether it was live when recorded (run with TZ=UTC and TZ=America/Phoenix)", () => {
  it("keeps the saved flags as its capture, labels it Recorded, and says it was live when recorded on the UTC day", () => {
    const request = replayedRequest(riotShaped());
    expect(request.path).toBe("/v2/analysis/compare");
    expect(request.recorded).toBe(true);
    expect(request.captured).toEqual({ cached: false, recorded: false, at: "2026-10-03T05:58:05Z" });
    // 3 Oct in every time zone: the run's date in UTC, never the browser's local day.
    expect(replayedRequestText(request)).toBe("Live when recorded, 3 Oct 2026; replayed now, nothing fetched.");
    const row = rowText(request);
    expect(row).toContain("Live when recorded, 3 Oct 2026; replayed now, nothing fetched.");
    expect(row).not.toContain("2 Oct 2026");
    // Still labelled Recorded: nothing was fetched just now.
    expect(row).toContain("Recorded");
    expect(row).not.toMatch(/\bLive\b(?! when recorded)/);
    // The saved run reads as one that asked Qloo while it was recorded.
    expect(askedQlooWhenRecorded(riotShaped())).toBe(true);
  });

  it("copies the capture with the request in Copy JSON, and counts it in the summary", () => {
    const request = replayedRequest(riotShaped());
    const json = JSON.parse(traceJson([request], { runId: "run_test01", mode: "recorded", qlooCalls: 1 }));
    expect(json.requests[0].captured).toEqual({ cached: false, recorded: false, at: "2026-10-03T05:58:05Z" });
    expect(json.requests[0].recorded).toBe(true);
    const summary = traceStats([request]).map((stat) => `${stat.label} ${stat.value}`).join(" · ");
    expect(summary).toBe("Request 1 · Cached 0 · Recorded 1 · Live when recorded 1");
    expect(summary.endsWith(" · Live when recorded 1")).toBe(true);
  });

  it("says a request served from the cache when recorded came from the cache, and counts it as no live request", () => {
    const request = replayedRequest(riotShaped({ cached: true, recorded: false }));
    expect(request.captured).toEqual({ cached: true, recorded: false, at: "2026-10-03T05:58:05Z" });
    expect(replayedRequestText(request)).toBe("From the cache when recorded, 3 Oct 2026; replayed now.");
    expect(rowText(request)).toContain("From the cache when recorded, 3 Oct 2026; replayed now.");
    expect(rowText(request)).not.toContain("Live when recorded");
    expect(traceStats([request]).map((stat) => stat.label)).toEqual(["Request", "Cached", "Recorded"]);
    expect(askedQlooWhenRecorded(riotShaped({ cached: true, recorded: false }))).toBe(false);
  });

  it("shows no provenance phrase for a request whose saved event omits recorded, or was served from a saved fixture", () => {
    for (const flags of [{ cached: false }, { cached: false, recorded: true }, {}]) {
      const run = riotShaped(flags);
      const request = replayedRequest(run);
      expect(replayedRequestText(request)).toBeNull();
      const row = rowText(request);
      expect(row).not.toContain("when recorded");
      // It keeps the Recorded label it has today.
      expect(row).toContain("Recorded");
      expect(traceStats([request]).map((stat) => stat.label)).toEqual(["Request", "Cached", "Recorded"]);
      expect(askedQlooWhenRecorded(run)).toBe(false);
    }
    // Unstated flags read as unknown, never as live: a missing cached flag stays null in the capture.
    expect(replayedRequest(riotShaped({ recorded: false })).captured).toEqual({ cached: null, recorded: false, at: "2026-10-03T05:58:05Z" });
    expect(replayedRequestText(replayedRequest(riotShaped({ recorded: false })))).toBeNull();
  });

  it("says nothing of the kind for a live run's request, which carries no capture", () => {
    const live: QlooRequestRecord = { path: "/v2/analysis/compare", params: {}, status: 200, latency_ms: 300, cached: false, recorded: false };
    expect(replayedRequestText(live)).toBeNull();
    expect(rowText(live)).not.toContain("when recorded");
    expect(traceStats([live]).map((stat) => stat.label)).toEqual(["Request", "Cached", "Median"]);
  });

  it("reads the saved requests as saved, with their capture, and leaves a run with none empty", () => {
    expect(savedRequests(riotShaped()).map((request) => [request.request_id, request.recorded, request.captured?.at])).toEqual([
      [REQUEST_ID, false, "2026-10-03T05:58:05Z"],
    ]);
    const quiet = only([rawRun({}, rawEvents().map((item) => (item.event.type === "tool_result" ? { ...item, event: { ...item.event, requests: [] } } : item)))]);
    expect(savedRequests(quiet)).toEqual([]);
    expect(askedQlooWhenRecorded(quiet)).toBe(false);
  });
});
