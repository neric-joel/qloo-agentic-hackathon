/**
 * Simulated event streams for building screens without the backend.
 *
 * Enable with `NEXT_PUBLIC_MOCK_STREAM=1`. The events follow the same contract as the real
 * endpoints and pass through the same reducer, but every name, id and number is invented, and
 * nothing here ever reaches Qloo. Screens should label mock output as simulated (see
 * `MockBadge`).
 */

import {
  isRecord,
  type AgentEvent,
  type Provenance,
  type QlooRequestRecord,
  type RunUsage,
} from "./events";

/** Build-time flag. Written as a literal so the bundler can inline it. */
export const MOCK_STREAM_ENABLED = process.env.NEXT_PUBLIC_MOCK_STREAM === "1";

export type MockScenario =
  /** A full run with live-style provenance. */
  | "live"
  /** The same run replayed from saved responses. */
  | "recorded"
  /** The agent needs the user to pick between candidates. */
  | "needs_input"
  /** Qloo has too little data, so the agent declines to answer. */
  | "abstain"
  /** A retryable failure part-way through. */
  | "error"
  /** The same task answered by a model alone, then graded against Qloo. */
  | "baseline";

export type MockStreamOptions = {
  scenario?: MockScenario;
  /** Playback speed multiplier. 1 is realistic; use `Infinity` to skip all delays. */
  speed?: number;
};

/** Scenarios offered by the showcase picker (`baseline` is driven by the answer-source toggle). */
export const MOCK_SCENARIOS: readonly { value: MockScenario; label: string; hint: string }[] = [
  { value: "live", label: "Live run", hint: "Qloo requests, derived scores and a written summary." },
  { value: "recorded", label: "Recorded run", hint: "The same run, shown as a saved recording." },
  { value: "needs_input", label: "Needs input", hint: "The agent asks which candidate you mean." },
  { value: "abstain", label: "Not enough data", hint: "Qloo data is too thin, so the agent declines." },
  { value: "error", label: "Error", hint: "A retryable failure part-way through." },
];

// ---------------------------------------------------------------------------
// Result payload used by the kernel showcase
// ---------------------------------------------------------------------------

/** `result.kind === "summary"`: a headline figure plus labelled rows, each with its provenance. */
export type MockSummaryData = {
  title: string;
  headline: { label: string; value: string; note?: string; provenance: Provenance };
  rows: { label: string; value: string; provenance: Provenance }[];
  footnote?: string;
};

function isProvenance(value: unknown): value is Provenance {
  return value === "qloo" || value === "derived" || value === "llm" || value === "recorded";
}

/** Validates a `summary` result payload (stream data is untrusted). */
export function readMockSummary(data: unknown): MockSummaryData | null {
  if (!isRecord(data) || typeof data.title !== "string") return null;
  const { headline, rows } = data;
  if (
    !isRecord(headline) ||
    typeof headline.label !== "string" ||
    typeof headline.value !== "string" ||
    !isProvenance(headline.provenance) ||
    !Array.isArray(rows)
  ) {
    return null;
  }
  const validRows = rows.flatMap((row) =>
    isRecord(row) &&
    typeof row.label === "string" &&
    typeof row.value === "string" &&
    isProvenance(row.provenance)
      ? [{ label: row.label, value: row.value, provenance: row.provenance }]
      : [],
  );
  return {
    title: data.title,
    headline: {
      label: headline.label,
      value: headline.value,
      provenance: headline.provenance,
      ...(typeof headline.note === "string" ? { note: headline.note } : {}),
    },
    rows: validRows,
    ...(typeof data.footnote === "string" ? { footnote: data.footnote } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fixtures (all invented)
// ---------------------------------------------------------------------------

const ACTS = [
  { name: "Neon Meridian", id: "3F8A21C4-9B7D-4E55-A1C2-6D0E7B94F3A1" },
  { name: "The Salt Lines", id: "B1D4E9A7-52C3-4F18-8E6B-0A97C3D2145F" },
  { name: "Aurora Vale", id: "7C0E5B2D-A6F4-4D39-9B18-E52F8A4C7D60" },
  { name: "Kite & Compass", id: "E94A7D13-0C8B-4A62-B5F7-31D6A92E8C04" },
] as const;

/** Pairs that play at the same time: indexes into ACTS and an overlap score. */
const CLASHES = [
  { a: 0, b: 1, overlap: 0.62 },
  { a: 2, b: 3, overlap: 0.48 },
  { a: 1, b: 3, overlap: 0.12 },
] as const;

const REQUEST_IDS = [
  "5d1f0c0e-7a54-4f36-9d2c-3b7e1c9a42f0",
  "a93b6e1c-2d48-4b07-8f15-c0e7d3a96b21",
  "0e7c4a52-b8d1-49f3-a6e0-71c2d95f3b84",
  "c4f2a8d6-13e9-4c5b-97a0-2d6b8e41f7c3",
  "8b06d3e9-5a27-4f1c-b3d8-e49a1c70526f",
  "f1a9c7b3-60d4-4e82-a5b7-3c8e2d19a406",
  "27e5b1a8-c9f0-4d63-8a14-b6d3f07e9c52",
] as const;

const SEARCH_LATENCIES = [188, 142, 167, 3] as const;
const INSIGHT_LATENCIES = [612, 548, 701] as const;

function searchRequests(recorded: boolean): QlooRequestRecord[] {
  return ACTS.map((act, index) => ({
    path: "/search",
    params: { query: act.name, types: "urn:entity:artist", take: "1" },
    status: 200,
    latency_ms: recorded ? 1 : SEARCH_LATENCIES[index],
    cached: !recorded && index === 3,
    ...(recorded ? { recorded: true } : index === 3 ? {} : { request_id: REQUEST_IDS[index] }),
  }));
}

/** `fromCache`: every request is answered from the server-side cache (no request id). */
function overlapRequests(recorded: boolean, fromCache = false): QlooRequestRecord[] {
  return CLASHES.map((clash, index) => ({
    path: "/v2/insights",
    params: {
      "filter.type": "urn:entity:artist",
      "signal.interests.entities": ACTS[clash.a].id,
      "filter.results.entities": ACTS[clash.b].id,
      "feature.explainability": "true",
      take: "20",
    },
    status: 200,
    latency_ms: recorded ? 2 : fromCache ? 1 : INSIGHT_LATENCIES[index],
    cached: !recorded && fromCache,
    ...(recorded ? { recorded: true } : fromCache ? {} : { request_id: REQUEST_IDS[4 + index] }),
  }));
}

const SUMMARY_TEXT =
  "Neon Meridian and The Salt Lines have the highest taste overlap, so that clash has the " +
  "highest price. Aurora Vale and Kite & Compass overlap less in taste but still carry a " +
  "sizeable price. Moving Aurora Vale 45 minutes earlier would clear the second clash without " +
  "creating a new one.";

const BASELINE_TEXT =
  "Without audience data, the safest guess is that the two headline acts' audiences overlap " +
  "most in taste and the smaller acts' audiences do not. This answer uses no Qloo data, so " +
  "treat it as a guess.";

// ---------------------------------------------------------------------------
// Scenario scripts
// ---------------------------------------------------------------------------

/** One scripted event and how long to wait before delivering it, at speed 1. */
type Beat = { after: number; event: AgentEvent };

const beat = (after: number, event: AgentEvent): Beat => ({ after, event });

/** Streams prose a word at a time. */
function words(text: string, interval: number): Beat[] {
  return (text.match(/\S+\s*/g) ?? []).map((piece) =>
    beat(interval, { type: "text_delta", text: piece }),
  );
}

/** Appends `run_finished` with counts taken from the script itself, so they cannot drift. */
function finish(beats: Beat[], usage?: RunUsage): Beat[] {
  const qlooCalls = beats.reduce(
    (total, { event }) => total + (event.type === "tool_result" ? (event.requests?.length ?? 0) : 0),
    0,
  );
  const closingDelay = 150;
  const elapsed = beats.reduce((total, { after }) => total + after, closingDelay);
  return [
    ...beats,
    beat(closingDelay, {
      type: "run_finished",
      run_id: "pending",
      qloo_calls: qlooCalls,
      elapsed_ms: Math.round(elapsed),
      ...(usage ? { usage } : {}),
    }),
  ];
}

function readLineupBeats(detail = "4 acts on 2 stages"): Beat[] {
  return [
    beat(150, { type: "step", id: "read", label: "Reading the lineup", status: "running" }),
    beat(400, {
      type: "step",
      id: "read",
      label: "Reading the lineup",
      status: "done",
      detail,
    }),
  ];
}

function resolveBeats(recorded: boolean): Beat[] {
  const source: Provenance = recorded ? "recorded" : "qloo";
  return [
    beat(120, { type: "step", id: "resolve", label: "Matching acts to Qloo entities", status: "running" }),
    beat(80, {
      type: "tool_call",
      id: "call-resolve",
      tool: "resolve_entities",
      input: { names: ACTS.map((act) => act.name), type: "urn:entity:artist" },
      provenance: source,
    }),
    beat(620, {
      type: "tool_result",
      id: "call-resolve",
      tool: "resolve_entities",
      ok: true,
      summary: "Matched 4 of 4 acts",
      latency_ms: recorded ? 6 : 612,
      provenance: source,
      requests: searchRequests(recorded),
    }),
    beat(60, {
      type: "step",
      id: "resolve",
      label: "Matching acts to Qloo entities",
      status: "done",
      detail: "4 of 4 matched",
    }),
  ];
}

function overlapStartBeats(source: Provenance): Beat[] {
  return [
    beat(120, { type: "step", id: "overlap", label: "Measuring audience overlap", status: "running" }),
    beat(80, {
      type: "tool_call",
      id: "call-overlap",
      tool: "audience_overlap",
      input: { pairs: CLASHES.map((clash) => [ACTS[clash.a].name, ACTS[clash.b].name]) },
      provenance: source,
    }),
  ];
}

function summaryResult(recorded: boolean): AgentEvent {
  const source: Provenance = recorded ? "recorded" : "qloo";
  const data: MockSummaryData = {
    title: "Clash exposure",
    headline: {
      label: "of the clash cost is in the costliest pair",
      value: "31%",
      note: "The costliest pair's price over the sum of every priced clash.",
      provenance: "derived",
    },
    rows: [
      ...CLASHES.map((clash) => ({
        label: `${ACTS[clash.a].name} / ${ACTS[clash.b].name}`,
        value: `${clash.overlap.toFixed(2)} overlap`,
        provenance: source,
      })),
      { label: "Suggested fix", value: "Move Aurora Vale 45 min earlier", provenance: "llm" },
    ],
    footnote: "Simulated figures for the component showcase.",
  };
  return { type: "result", kind: "summary", data };
}

function liveScript(recorded: boolean, answered: boolean): Beat[] {
  const source: Provenance = recorded ? "recorded" : "qloo";
  const beats: Beat[] = [
    beat(0, { type: "run_started", run_id: "pending", mode: recorded ? "recorded" : "live" }),
    ...readLineupBeats(answered ? "4 acts on 2 stages. Using your choice for Aurora." : undefined),
    ...resolveBeats(recorded),
    ...overlapStartBeats(source),
    beat(1340, {
      type: "tool_result",
      id: "call-overlap",
      tool: "audience_overlap",
      ok: true,
      summary: "Scored 3 overlapping pairs; strongest overlap 0.62",
      latency_ms: recorded ? 7 : 1340,
      provenance: source,
      requests: overlapRequests(recorded),
    }),
    beat(60, {
      type: "step",
      id: "overlap",
      label: "Measuring audience overlap",
      status: "done",
      detail: "3 pairs scored",
    }),
    beat(100, { type: "step", id: "score", label: "Scoring clash exposure", status: "running" }),
    beat(60, {
      type: "tool_call",
      id: "call-score",
      tool: "exposure_score",
      input: { method: "weighted_overlap", pairs: 3 },
      provenance: "derived",
    }),
    beat(140, {
      type: "tool_result",
      id: "call-score",
      tool: "exposure_score",
      ok: true,
      summary: "The costliest pair carries 31% of the clash cost",
      latency_ms: 12,
      provenance: "derived",
    }),
    beat(60, { type: "step", id: "score", label: "Scoring clash exposure", status: "done" }),
    beat(150, { type: "step", id: "explain", label: "Writing the summary", status: "running" }),
    ...words(SUMMARY_TEXT, 32),
    beat(80, { type: "step", id: "explain", label: "Writing the summary", status: "done" }),
    beat(120, summaryResult(recorded)),
  ];
  // A replay needs no waiting on the network, so it runs faster than a live call.
  const paced = recorded ? beats.map((b) => ({ ...b, after: b.after * 0.4 })) : beats;
  return finish(paced, recorded ? undefined : { input_tokens: 1840, output_tokens: 412 });
}

function needsInputScript(): Beat[] {
  const requests = searchRequests(false)
    .slice(0, 3)
    .map((request, index) =>
      index === 2 ? { ...request, params: { ...request.params, query: "Aurora" } } : request,
    );
  return finish([
    beat(0, { type: "run_started", run_id: "pending", mode: "live" }),
    ...readLineupBeats(),
    beat(120, { type: "step", id: "resolve", label: "Matching acts to Qloo entities", status: "running" }),
    beat(80, {
      type: "tool_call",
      id: "call-resolve",
      tool: "resolve_entities",
      input: { names: ["Neon Meridian", "The Salt Lines", "Aurora"], type: "urn:entity:artist" },
      provenance: "qloo",
    }),
    beat(560, {
      type: "tool_result",
      id: "call-resolve",
      tool: "resolve_entities",
      ok: true,
      summary: "Matched 2 acts; 'Aurora' has several close candidates",
      latency_ms: 497,
      provenance: "qloo",
      requests,
    }),
    beat(60, {
      type: "step",
      id: "resolve",
      label: "Matching acts to Qloo entities",
      status: "done",
      detail: "2 matched, 1 needs a choice",
    }),
    beat(200, {
      type: "needs_input",
      question: "Which act is billed as Aurora?",
      options: [
        { id: "aurora-vale", label: "Aurora Vale (indie folk)" },
        { id: "aurora-nine", label: "Aurora Nine (electronic)" },
        { id: "neither", label: "Neither of these" },
      ],
    }),
  ]);
}

function abstainScript(): Beat[] {
  return finish([
    beat(0, { type: "run_started", run_id: "pending", mode: "live" }),
    ...readLineupBeats(),
    ...resolveBeats(false),
    ...overlapStartBeats("qloo"),
    beat(1100, {
      type: "tool_result",
      id: "call-overlap",
      tool: "audience_overlap",
      ok: true,
      summary: "Qloo returned too few shared signals for 2 of 3 pairs",
      latency_ms: 1010,
      provenance: "qloo",
      requests: overlapRequests(false),
    }),
    beat(60, {
      type: "step",
      id: "overlap",
      label: "Measuring audience overlap",
      status: "done",
      detail: "1 of 3 pairs had enough data",
    }),
    beat(160, {
      type: "result",
      kind: "abstain",
      data: {
        reason: "Qloo has too little audience data on these acts to compare them reliably.",
        details: [
          "No taste-overlap signal for Aurora Vale and Kite & Compass.",
          "Fewer than three matched entities on the second stage.",
        ],
      },
    }),
  ]);
}

/** An `error` event, then the closing `run_finished` the real stream always sends after it. */
function errorScript(): Beat[] {
  const failed: QlooRequestRecord = {
    path: "/search",
    params: { query: "Neon Meridian", types: "urn:entity:artist", take: "1" },
    status: 429,
    latency_ms: 241,
    cached: false,
    request_id: REQUEST_IDS[0],
  };
  return finish([
    beat(0, { type: "run_started", run_id: "pending", mode: "live" }),
    ...readLineupBeats(),
    beat(120, { type: "step", id: "resolve", label: "Matching acts to Qloo entities", status: "running" }),
    beat(80, {
      type: "tool_call",
      id: "call-resolve",
      tool: "resolve_entities",
      input: { names: ACTS.map((act) => act.name), type: "urn:entity:artist" },
      provenance: "qloo",
    }),
    beat(420, {
      type: "tool_result",
      id: "call-resolve",
      tool: "resolve_entities",
      ok: false,
      summary: "Qloo returned HTTP 429 after 2 retries",
      latency_ms: 403,
      provenance: "qloo",
      requests: [failed],
    }),
    beat(60, {
      type: "step",
      id: "resolve",
      label: "Matching acts to Qloo entities",
      status: "error",
      detail: "Rate limited by Qloo",
    }),
    beat(160, {
      type: "error",
      message: "Qloo is rate limiting requests right now. Wait a few seconds, then try again.",
      retryable: true,
    }),
  ]);
}

function baselineScript(): Beat[] {
  const data: MockSummaryData = {
    title: "LLM-only answer",
    headline: {
      label: "of its guesses matched Qloo",
      value: "1 of 3",
      note: "Graded against the audience-overlap scores from the Qloo run.",
      provenance: "qloo",
    },
    rows: [
      { label: `${ACTS[0].name} / ${ACTS[1].name}`, value: "Flagged. Matches Qloo.", provenance: "llm" },
      { label: `${ACTS[2].name} / ${ACTS[3].name}`, value: "Not flagged. Qloo says 0.48.", provenance: "llm" },
      { label: `${ACTS[1].name} / ${ACTS[3].name}`, value: "Flagged. Qloo says 0.12.", provenance: "llm" },
    ],
    footnote: "Simulated figures for the component showcase.",
  };
  return finish(
    [
      beat(0, { type: "run_started", run_id: "pending", mode: "live" }),
      beat(150, { type: "step", id: "guess", label: "Answering without Qloo", status: "running" }),
      ...words(BASELINE_TEXT, 30),
      beat(80, { type: "step", id: "guess", label: "Answering without Qloo", status: "done" }),
      beat(120, { type: "step", id: "grade", label: "Grading the answer with Qloo", status: "running" }),
      beat(80, {
        type: "tool_call",
        id: "call-grade",
        tool: "grade_with_qloo",
        input: { pairs: 3 },
        provenance: "qloo",
      }),
      beat(520, {
        type: "tool_result",
        id: "call-grade",
        tool: "grade_with_qloo",
        ok: true,
        summary: "Compared 3 guesses with Qloo overlap scores (served from cache)",
        latency_ms: 11,
        provenance: "qloo",
        requests: overlapRequests(false, true),
      }),
      beat(60, {
        type: "step",
        id: "grade",
        label: "Grading the answer with Qloo",
        status: "done",
        detail: "1 of 3 guesses matched",
      }),
      beat(120, { type: "result", kind: "summary", data }),
    ],
    { input_tokens: 620, output_tokens: 180 },
  );
}

function hasAnswer(body: unknown): boolean {
  return isRecord(body) && body.answer !== undefined && body.answer !== null;
}

function scriptFor(scenario: MockScenario, body: unknown): Beat[] {
  // Answering the question moves the run on to the full flow.
  if (scenario === "needs_input" && hasAnswer(body)) return liveScript(false, true);
  switch (scenario) {
    case "live":
      return liveScript(false, false);
    case "recorded":
      return liveScript(true, false);
    case "needs_input":
      return needsInputScript();
    case "abstain":
      return abstainScript();
    case "error":
      return errorScript();
    case "baseline":
      return baselineScript();
  }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

let runCounter = 0;

/** Resolves true after `ms`, or false right away if `signal` aborts first. */
function wait(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (!(ms > 0)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Plays a scripted run through `onEvent`, same shape as `streamRun` minus the URL.
 * Aborting stops playback quietly.
 */
export async function mockStreamRun(
  body: unknown,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
  options: MockStreamOptions = {},
): Promise<void> {
  const { scenario = "live", speed = 1 } = options;
  const pace = speed > 0 ? speed : 1;
  const runId = `mock-${scenario}-${String(++runCounter).padStart(3, "0")}`;

  for (const { after, event } of scriptFor(scenario, body)) {
    if (!(await wait(after / pace, signal))) return;
    onEvent(
      event.type === "run_started" || event.type === "run_finished"
        ? { ...event, run_id: runId }
        : event,
    );
  }
}
