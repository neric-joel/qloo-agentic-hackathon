import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TraceDrawer } from "@/components/kernel";
import { NO_QLOO_NOTE, SAVED_READING_NOTE, noRequestsNote, runStatusText } from "@/components/kernel/trace-drawer";
import { RequestItem } from "@/components/kernel/trace-parts";
import { readClashReply } from "@/lib/agent-session";
import { CONTROL_ACTS } from "@/lib/control-acts";
import { qlooCredits } from "@/lib/credit";
import { parseAgentEvent, type AgentEvent, type QlooRequestRecord } from "@/lib/events";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { RECORDED_RUN_NOTE, isFromRecordedRun } from "@/lib/moves";
import { parsePreset, type Preset } from "@/lib/preset";
import { parseRecordings, replayFinalState, toReplayBeats, type RecordedRun } from "@/lib/recorded-run";
import { reduceEvents, type RunResult, type RunState } from "@/lib/run-state";
import {
  encodeMoves,
  planBody,
  readStoredMoves,
  storeMoves,
  type Plan,
  type PlanAnswer,
  type StackMove,
  type StackStep,
} from "@/lib/stack";

import {
  ASK_IT,
  AgentPanel,
  agentRoomFloor,
  ExchangeView,
  KeepThisPlace,
  RECORDED_HEADING,
  SAVED_READING_LINE,
  ZERO_REQUESTS_LABEL,
  agentLayout,
  agentLimits,
  checkAdd,
  headerTraceLabel,
  keepNote,
  keepPress,
  keepableMove,
  mayPointElsewhere,
  offLede,
  placeToKeep,
  planHolds,
  pointerDay,
  pointerLine,
  pricedEveryPlace,
  recordedQloo,
  recordingsQlooLine,
  replayScrollMargin,
  requestsLabel,
  runVersusCard,
  SEE_THAT_RUN,
  agentSectionHref,
  askedElsewhereSentence,
  type AgentPlace,
  type PublishedDay,
} from "./agent-panel";
import { KEEP_MOVE } from "./decision-card";
import { runQlooLine } from "./recorded-runs";
import { ScratchPlan } from "./scratch-plan";
import { seededPlan } from "./try-a-move";

/**
 * The recorded runs the mocked hook serves, the other days' runs it answers with when the panel asks for them, and
 * each time the panel decided whether to ask for other days at all, set per test.
 */
const served: { runs: RecordedRun[]; otherDays: Map<string, RecordedRun[]>; asks: boolean[]; loading?: boolean } = {
  runs: [],
  otherDays: new Map(),
  asks: [],
};

vi.mock("./use-recordings", () => ({
  useRecordings: () => (served.loading ? { status: "loading", runs: [] } : { status: "ready", runs: served.runs }),
  useOtherDaysRecordings: (_shown: string, _ids: readonly string[], enabled: boolean) => {
    served.asks.push(enabled);
    return enabled ? served.otherDays : new Map();
  },
}));

/** The visible words. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// Every name and figure below is invented (the tiny fixture festival): no Qloo data.
const tiny: Preset = parsePreset(rawTinyPreset())!;

/** The tool data a finished run carries in its `result` event, keyed by tool call id in call order. */
type ToolData = Record<string, Record<string, unknown>>;

const FIND_MOVES: ToolData = {
  call_find: {
    kind: "move_options",
    act: "Bo Diddly Squat",
    from: "Side 20:30-22:00",
    movable: true,
    clash_budget_before: 104.2,
    legal_places: 2,
    options: [
      { move: "Bo Diddly Squat: Side 20:30-22:00 -> Side 22:05-23:35", stage: "Side", start: "22:05", clash_budget_after: 100.1 },
      { move: "Bo Diddly Squat: Side 20:30-22:00 -> Side 22:10-23:40", stage: "Side", start: "22:10", clash_budget_after: 101.4 },
    ],
  },
};

/** The events of one run, as the backend streams them: tools, the model's words, then the result. */
function streamOf(toolData: ToolData, words: string, qlooCalls = 0): Record<string, unknown>[] {
  const calls = Object.entries(toolData).flatMap(([id, data]) => {
    const tool = data.kind === "move_options" ? "find_moves" : data.kind === "what_if" ? "try_move" : "explain_clash";
    return [
      { type: "tool_call", id, tool, input: {}, provenance: "derived" },
      { type: "tool_result", id, tool, ok: true, summary: "done", latency_ms: 3, provenance: "derived", requests: [] },
    ];
  });
  return [
    { type: "run_started", run_id: "run_invented", mode: "live" },
    ...calls,
    { type: "text_delta", text: words },
    { type: "result", kind: "clash", data: { text: words, tool_data: toolData } },
    { type: "run_finished", run_id: "run_invented", qloo_calls: qlooCalls, elapsed_ms: 1200 },
  ];
}

/** A recorded run, as `GET /api/presets/{id}/recordings` serves it, through the replay's own parser. */
function recorded(id: string, toolData: ToolData, words = "Here is what I found.", qlooCalls = 0): RecordedRun {
  const events = streamOf(toolData, words, qlooCalls).map((event, i) => ({ t: i * 100, event }));
  const [run] = parseRecordings({ runs: [{ id, title: `Run ${id}`, question: "Where could Bo go?", captured_at: "2026-10-01T10:00:00Z", model: "m", events }] });
  return run;
}

/**
 * A recorded run that made one Qloo request, saved with the event's own flags (`flags`: by default neither cached
 * nor from a saved fixture, so live when it was recorded), through the replay's own parser.
 */
function asking(id: string, flags: Record<string, unknown> = { cached: false, recorded: false }): RecordedRun {
  const events = [
    { type: "run_started", run_id: "run_invented", mode: "live" },
    { type: "tool_call", id: "call_explain", tool: "explain_clash", input: {}, provenance: "qloo" },
    {
      type: "tool_result",
      id: "call_explain",
      tool: "explain_clash",
      ok: true,
      summary: "done",
      latency_ms: 310,
      provenance: "qloo",
      requests: [{ path: "/v2/analysis/compare", params: {}, status: 200, latency_ms: 300, ...flags }],
    },
    { type: "text_delta", text: "Here." },
    { type: "result", kind: "clash", data: { text: "Here.", tool_data: {} } },
    { type: "run_finished", run_id: "run_invented", qloo_calls: 1, elapsed_ms: 1200 },
  ].map((event, i) => ({ t: i * 100, event }));
  const [run] = parseRecordings({ runs: [{ id, title: `Run ${id}`, question: "Why do they clash?", captured_at: "2026-10-01T10:00:00Z", model: "m", events }] });
  return run;
}

/** A live run's stream: each event read by the live stream's own parser, then reduced as the panel does. */
function liveResults(toolData: ToolData, words = "Here is what I found.") {
  const events = streamOf(toolData, words).map((raw) => {
    const parsed = parseAgentEvent(raw);
    if (parsed.kind !== "event") throw new Error(`fixture event not read: ${JSON.stringify(raw)}`);
    return parsed.event;
  });
  return reduceEvents(events as AgentEvent[]).results;
}

const BEST: StackMove = { actId: "bo", stageId: "side", day: 0, start: "22:05" };

describe("Keep this move takes the move only from the run's own tool result", () => {
  it("reads the first listed place of a replayed find_moves run", () => {
    const place = keepableMove(replayFinalState(recorded("find", FIND_MOVES)).results, tiny.festival, 0);
    expect(place?.move).toEqual(BEST);
    expect(place).toMatchObject({ act: "Bo Diddly Squat", stage: "Side", start: "22:05", end: "23:35", before: 104.2, after: 100.1 });
  });

  it("reads the same place from a live run's stream, which has the same events", () => {
    expect(keepableMove(liveResults(FIND_MOVES), tiny.festival, 0)?.move).toEqual(BEST);
  });

  it("reads a try_move the engine allowed, and the last legal one when a run tested several", () => {
    const tried: ToolData = {
      ...FIND_MOVES,
      call_try: {
        kind: "what_if",
        move: "Bo Diddly Squat: Side 20:30-22:00 -> Main 22:30-24:00",
        allowed: true,
        problems: [],
        clash_budget_before: 104.2,
        clash_budget_after: 99.0,
      },
    };
    expect(keepableMove(liveResults(tried), tiny.festival, 0)?.move).toEqual({ actId: "bo", stageId: "main", day: 0, start: "22:30" });
  });

  it("offers nothing for a move the engine refused, whatever the model's words say", () => {
    const refused: ToolData = {
      call_try: {
        kind: "what_if",
        move: "Bo Diddly Squat -> Main 20:00",
        allowed: false,
        problems: ["That change is not possible: the slot is taken."],
      },
    };
    const words = "Move Bo Diddly Squat to Side at 22:05; that place is legal.";
    expect(keepableMove(liveResults(refused, words), tiny.festival, 0)).toBeNull();
    // Words alone, with no tool result, are never read as a move.
    expect(keepableMove(liveResults({}, words), tiny.festival, 0)).toBeNull();
  });

  it("offers nothing for a locked set, another day, or a place where the set already plays", () => {
    const locked: ToolData = {
      call_try: { kind: "what_if", move: "Ann Arbor: Main 20:00-21:30 -> Main 18:00-19:30", allowed: true, problems: [] },
    };
    expect(keepableMove(liveResults(locked), tiny.festival, 0)).toBeNull();
    expect(keepableMove(liveResults(FIND_MOVES), tiny.festival, 1)).toBeNull();
    const nowhere: ToolData = {
      call_try: { kind: "what_if", move: "Bo Diddly Squat: Side 20:30-22:00 -> Side 20:30-22:00", allowed: true, problems: [] },
    };
    expect(keepableMove(liveResults(nowhere), tiny.festival, 0)).toBeNull();
  });

  it("hands the run's move, unchanged, to the page's keep path when pressed, and says Kept only once the plan holds it", () => {
    const place = keepableMove(liveResults(FIND_MOVES), tiny.festival, 0) as AgentPlace;
    const keep = vi.fn((move: StackMove) => (move.actId ? "It replaced your earlier 1 kept step." : null));
    expect(keepPress(place, keep)()).toBe("It replaced your earlier 1 kept step.");
    expect(keep).toHaveBeenCalledTimes(1);
    // Unchanged, and as a replace unless the plan asked for an add.
    expect(keep).toHaveBeenCalledWith(BEST, { mode: "replace" });
    // Nothing is kept automatically: building the press does not call it.
    const idle = vi.fn(() => null);
    keepPress(place, idle);
    expect(idle).not.toHaveBeenCalled();
    expect(planHolds([], BEST)).toBe(false);
    expect(planHolds([{ ...BEST }], BEST)).toBe(true);
    expect(planHolds([{ ...BEST, start: "22:10" }], BEST)).toBe(false);
  });
});

describe("the agent section while the live agent is off", () => {
  beforeEach(() => {
    served.runs = [recorded("a", FIND_MOVES), recorded("b", {}), recorded("c", FIND_MOVES)];
    served.otherDays = new Map();
    served.asks = [];
  });

  function panel(preset: Preset = tiny, agentStatus: "off" | "on" = "off", publishedDays?: PublishedDay[]) {
    return renderToStaticMarkup(createElement(AgentPanel, { preset, day: 0, agentStatus, publishedDays }));
  }

  it("says it holds recorded runs, with no invitation to type", () => {
    const html = panel();
    expect(html).toMatch(new RegExp(`<h2 id="agent-heading"[^>]*>${RECORDED_HEADING}</h2>`));
    expect(RECORDED_HEADING).toBe("Recorded agent runs");
    const words = text(html);
    expect(words).not.toContain("Or describe the change in plain words");
    expect(words).not.toContain("Ask the agent");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<form");
    // Why the live agent is off stays.
    expect(words).toContain("The live agent is off here to keep this demo free to run; its answers come from a language model.");
  });

  it("lists what the agent can and cannot do, open, each line read from the backend", () => {
    const html = panel();
    const words = text(html);
    expect(words).toContain("What the agent can and cannot do");
    for (const line of agentLimits()) expect(words).toContain(line);
    expect(agentLimits()).toEqual([
      "It calls the same timetable engine as this page, and every figure in its result cards comes from that engine.",
      "Its answer in words is written by a language model and labelled as such.",
      "It can test a move, but it never changes your timetable unless you press Keep this move.",
      "It never contacts anyone or publishes anything.",
      "At most 12 Qloo requests and 6 agent turns per run.",
    ]);
    // The invented day's cap names no Qloo, in the same words for the turns.
    expect(agentLimits(true).at(-1)).toBe("At most 6 agent turns per run.");
    // One name for the keep act: the hero's own label, never "Keep this place"; the turns are the agent's.
    expect(KEEP_MOVE).toBe("Keep this move");
    for (const words of [text(html), text(panel({ ...tiny, synthetic: true })), text(panel(tiny, "on"))]) {
      expect(words).not.toContain("Keep this place");
      expect(words).not.toContain("model turns");
    }
    // An open list, not a disclosure.
    const list = html.slice(html.indexOf("What the agent can and cannot do"));
    expect(list.slice(0, list.indexOf("</ul>"))).not.toContain("<details");
  });

  it("says what to ask it right after what it does, on every day and whether the live agent is on or off", () => {
    expect(ASK_IT).toBe("Ask it to set rules, find and test a move, then explain the result.");
    const does = "The agent tests a move against every rule and scores it before it answers.";
    // Off, with recorded runs: what it does, what to ask it, then that the runs replay with no live call.
    expect(text(panel())).toContain(`${does} ${ASK_IT} Saved runs on this day replay with no live Qloo or model call.`);
    expect(offLede(true, false)).toBe(`${does} ${ASK_IT} Saved runs on this day replay with no live Qloo or model call.`);
    // The invented day says the same sentence (it names no Qloo).
    expect(ASK_IT).not.toMatch(/Qloo/);
    expect(text(panel({ ...tiny, synthetic: true }))).toContain(`${does} ${ASK_IT} Saved runs on this day replay with no live call.`);
    // Off with no recorded runs: the sentence still follows what it does.
    served.runs = [];
    expect(text(panel())).toContain(`${does} ${ASK_IT}`);
    expect(offLede(false, true)).toBe(`${does} ${ASK_IT}`);
    // On: after the sentence that says what it does with a question.
    expect(text(panel(tiny, "on"))).toContain(`it tests the move against every rule and scores it before saying anything. ${ASK_IT}`);
  });

  it("says the recorded runs send no new Qloo request when every recording says 0, read from the recordings", () => {
    const line = "These runs send no new Qloo request; they test moves with this day’s saved reading.";
    expect(text(panel())).toContain(line);
    expect(recordingsQlooLine(served.runs)).toBe(line);
    expect(recordingsQlooLine(served.runs.slice(0, 1))).toBe(
      "This run sends no new Qloo request; it tests moves with this day’s saved reading.",
    );
    // One line under the list, followed by the section's own closing sentence: no second paragraph.
    expect(text(panel())).toContain(`${line} It never changes the real festival, which does not use Clash Control.`);
    // With no other published day passed to the panel, there is no pointer to one, and nothing is asked for.
    expect(text(panel())).not.toContain("asked Qloo while it was recorded");
    expect(served.asks.every((asked) => !asked)).toBe(true);
  });

  /** This day (the tiny fixture's) and another published day, as the page's day list names them. */
  const DAYS: PublishedDay[] = [
    { id: tiny.id, title: tiny.title },
    { id: "other-sun", title: "Other Fest 2026, Sunday" },
  ];

  it("points at another published day's recorded run that asked Qloo while it was recorded, in place of the runs line alone", () => {
    const line = "These runs send no new Qloo request; they test moves with this day’s saved reading.";
    const pointed = `${line} A run on Other Fest 2026, Sunday asked Qloo while it was recorded.`;
    const other = DAYS[1];
    expect(askedElsewhereSentence(other.title)).toBe("A run on Other Fest 2026, Sunday asked Qloo while it was recorded.");
    expect(pointerLine(line, other)).toBe(pointed);
    expect(pointerLine(line, null)).toBe(line);
    // The day it names holds a run with a request that reached Qloo live when it was recorded.
    expect(pointerDay(DAYS, tiny.id, new Map([["other-sun", [asking("asks")]]]))).toEqual(other);
    // Two such requests, or several runs that asked, still name the day once, in the same words.
    expect(pointerDay(DAYS, tiny.id, new Map([["other-sun", [asking("x"), asking("y")]]]))).toEqual(other);
    // Nothing loaded, runs that sent no request, a request served from the cache or a saved fixture when it was
    // recorded, or one whose saved event does not say: no pointer at all. The shown day never points at itself.
    expect(pointerDay(DAYS, tiny.id, new Map())).toBeNull();
    expect(pointerDay(DAYS, tiny.id, new Map([["other-sun", [recorded("none", FIND_MOVES)]]]))).toBeNull();
    expect(pointerDay(DAYS, tiny.id, new Map([["other-sun", [asking("cache", { cached: true, recorded: false })]]]))).toBeNull();
    expect(pointerDay(DAYS, tiny.id, new Map([["other-sun", [asking("fixture", { cached: false, recorded: true })]]]))).toBeNull();
    expect(pointerDay(DAYS, tiny.id, new Map([["other-sun", [asking("unsaid", { cached: false })]]]))).toBeNull();
    expect(pointerDay(DAYS, tiny.id, new Map([[tiny.id, [asking("self")]]]))).toBeNull();
    // On the page: the runs line, then the pointer, then its one link to that day's agent section; the section's
    // closing sentence starts its own line after the link.
    served.otherDays = new Map([["other-sun", [asking("asks")]]]);
    const html = panel(tiny, "off", DAYS);
    expect(text(html)).toContain(`${pointed} ${SEE_THAT_RUN} It never changes the real festival`);
    expect(SEE_THAT_RUN).toBe("See that run");
    expect(agentSectionHref("other-sun")).toBe("/?preset=other-sun#agent");
    expect(html).toMatch(/<a href="\/\?preset=other-sun#agent"[^>]*>See that run<\/a><span class="block">It never changes/);
    // The only new control: one link, no button.
    expect(html.match(/data-agent-pointer/g)).toHaveLength(1);
    // The live panel says the same line, with the same link.
    expect(text(panel(tiny, "on", DAYS))).toContain(`${pointed} ${SEE_THAT_RUN}`);
  });

  it("asks for other days' runs only on a published day whose own runs hold no Qloo request, and never on the invented day", () => {
    served.otherDays = new Map([["other-sun", [asking("asks")]]]);
    // A published day whose runs hold no request: it asks, and points.
    expect(mayPointElsewhere(tiny.id, false, DAYS, served.runs)).toBe(true);
    expect(text(panel(tiny, "off", DAYS))).toContain("asked Qloo while it was recorded");
    expect(served.asks.at(-1)).toBe(true);
    // The day's own runs hold a request: the pointer goes away by itself, and nothing is asked for.
    served.runs = [recorded("a", FIND_MOVES), asking("own")];
    expect(mayPointElsewhere(tiny.id, false, DAYS, served.runs)).toBe(false);
    served.asks = [];
    const own = text(panel(tiny, "off", DAYS));
    expect(own).not.toContain("asked Qloo while it was recorded");
    expect(own).not.toContain(SEE_THAT_RUN);
    expect(served.asks.every((asked) => !asked)).toBe(true);
    // The invented day, or a day the day list does not name: no pointer and nothing asked for.
    served.runs = [recorded("a", FIND_MOVES), recorded("b", {})];
    expect(mayPointElsewhere(tiny.id, true, DAYS, served.runs)).toBe(false);
    expect(mayPointElsewhere("invented-day", false, DAYS, served.runs)).toBe(false);
    expect(mayPointElsewhere(tiny.id, false, DAYS, [])).toBe(false);
    served.asks = [];
    expect(text(panel({ ...tiny, synthetic: true }, "off", DAYS))).not.toContain("asked Qloo while it was recorded");
    expect(text(panel({ ...tiny, id: "invented-day" }, "off", DAYS))).not.toContain("asked Qloo while it was recorded");
    expect(served.asks.every((asked) => !asked)).toBe(true);
  });

  it("gives each run its own Qloo count when one of them asked Qloo, and no summary line", () => {
    served.runs = [recorded("a", FIND_MOVES, "Here.", 1)];
    expect(recordingsQlooLine(served.runs)).toBeNull();
    expect(runQlooLine(served.runs[0])).toBe("This run made 1 Qloo request.");
    const words = text(panel());
    expect(words).toContain("This run made 1 Qloo request.");
    expect(words).not.toContain("no new Qloo request");
    expect(words).not.toContain(SAVED_READING_LINE);
    // With one run that asked Qloo and one that did not, each row says its own count and no line says "no request".
    served.runs = [recorded("a", FIND_MOVES, "Here.", 1), recorded("b", FIND_MOVES)];
    expect(recordingsQlooLine(served.runs)).toBeNull();
    const mixed = text(panel());
    expect(mixed).toContain("This run made 1 Qloo request.");
    expect(mixed).toContain("This run made no Qloo request.");
    expect(mixed).not.toContain("These runs send no new Qloo request");
  });

  it("credits no Qloo on the invented day", () => {
    const invented = { ...tiny, synthetic: true };
    expect(agentLimits(true).join(" ")).not.toMatch(/Qloo/);
    expect(recordingsQlooLine(served.runs, true)).toBeNull();
    // The lines this section adds credit no Qloo there. (The replay notice's own sentence about recorded
    // request ids predates them; the invented day serves no recordings, so it does not show there.)
    const credits = qlooCredits(text(panel(invented)));
    expect(credits.filter((sentence) => !sentence.includes("request ids are the ones recorded"))).toEqual([]);
  });

  it("keeps the invitation and its heading while the live agent is on", () => {
    const words = text(panel(tiny, "on"));
    expect(words).toContain("Or describe the change in plain words");
    expect(words).toContain("What the agent can and cannot do");
  });

  it("says under the question box that questions are limited per visitor and in total per day, and that the recorded runs still play when the day's questions are used up (W7)", () => {
    const html = panel(tiny, "on");
    // The note, in full and in its own paragraph: the disclosure of who writes the answers, then both limits,
    // then what the recorded runs in this section do. It names no number: the caps can change.
    const note =
      "Answers are written live by a language model from the tools’ results. Questions are limited per visitor and in total per day. The recorded runs in this section make no live call, so they still play when the day’s questions are used up.";
    const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((match) => text(match[1] ?? ""));
    expect(paragraphs).toContain(note);
    // The disclosure of who writes the answers stays, first.
    expect(note.startsWith("Answers are written live by a language model")).toBe(true);
    expect(note).not.toMatch(/\d/);
    // "In this section", never "below": the run picker sits under the form on a phone and beside it from 1024 px.
    expect(note).not.toMatch(/\bbelow\b/i);
    // The old half-sentence is gone, not kept beside the new one.
    expect(html).not.toContain("to keep the demo free");
    // It is the live agent's note: with the agent off there is no form, so no such note.
    expect(text(panel())).not.toContain("Questions are limited per visitor");
  });
});

describe("the agent section's two columns (A1)", () => {
  beforeEach(() => {
    served.runs = [recorded("a", FIND_MOVES), recorded("b", {}), recorded("c", FIND_MOVES)];
  });

  it("puts the can/cannot list first on a phone, then the run, then the picker", () => {
    const html = renderToStaticMarkup(createElement(AgentPanel, { preset: tiny, day: 0, agentStatus: "off" }));
    const limits = html.indexOf("What the agent can and cannot do");
    const run = html.indexOf("data-agent-run");
    const picker = html.indexOf("data-agent-picker");
    expect(limits).toBeGreaterThan(-1);
    expect(limits).toBeLessThan(run);
    expect(run).toBeLessThan(picker);
    // The list and the picker are each rendered once, open, with no disclosure.
    expect(html.split("What the agent can and cannot do")).toHaveLength(2);
    expect(html.split('aria-label="Recorded runs"')).toHaveLength(2);
    expect(html.slice(limits, html.indexOf("</ul>", limits))).not.toContain("<details");
  });

  it("keeps the run picker in the left column before, during and after a replay from 1024 px", () => {
    const before = agentLayout(false);
    const playing = agentLayout(true);
    for (const layout of [before, playing]) {
      // The heading and the can/cannot list top left, the picker under them in the same column, and the run (the
      // still transcript, or the replay) across both rows on the right: the picker never changes column.
      expect(layout.side).toContain("lg:col-start-1 lg:row-start-1");
      expect(layout.side).not.toContain("lg:row-span-2");
      expect(layout.picker).toContain("lg:col-span-6 lg:col-start-1 lg:row-start-2");
      expect(layout.run).toContain("lg:col-span-6 lg:col-start-7 lg:row-span-2 lg:row-start-1");
    }
    // The picker's place is the same class in every state; only while a run is on show does it stay in view as
    // the answer scrolls, sticky under the site header and the section nav.
    expect(playing.picker).toBe(before.picker);
    expect(playing.side).toBe(before.side);
    expect(before.pickerInner).toBe("");
    expect(playing.pickerInner).toBe("lg:sticky lg:top-32");
    // While a run is on show the sticky picker's track reaches 3rem past the run's foot, so where the page ends just
    // below a run its label stays clear of the sticky bars; before any run plays nothing is added (no box moves).
    expect(before.pickerTrack).toBe("");
    expect(playing.pickerTrack).toBe("lg:h-[calc(100%_+_3rem)]");
  });

  it("keeps the picker's longer track inside the section: the track wraps the picker, and the section's bottom padding is the same 3rem", () => {
    const html = renderToStaticMarkup(createElement(AgentPanel, { preset: tiny, day: 0, agentStatus: "off" }));
    // The track sits inside the picker's grid cell and holds the list; before a run plays it adds no class.
    const cell = html.indexOf("data-agent-picker");
    const track = html.indexOf("data-agent-picker-track", cell);
    expect(track).toBeGreaterThan(cell);
    expect(html.slice(track, html.indexOf(">", track))).toContain('class=""');
    expect(html.indexOf('aria-label="Recorded runs"', track)).toBeGreaterThan(track);
    // From 640 px the section's own bottom padding is 3rem (sm:py-12), so the 3rem the track adds never leaves it.
    expect(html).toMatch(/<section id="agent"[^>]*><div class="[^"]*\bsm:py-12\b/);
  });

  it("lists the run that ends with a place to keep first, as the still transcript, and the run the rules refuse last", () => {
    // Served in the saved file's order: the refusal first.
    served.runs = [recorded("refused", REFUSED), recorded("words", {}), recorded("keeps", FIND_MOVES)];
    const html = renderToStaticMarkup(createElement(AgentPanel, { preset: tiny, day: 0, agentStatus: "off" }));
    const list = html.slice(html.indexOf('aria-label="Recorded runs"'));
    const rows = ["Run keeps", "Run words", "Run refused"].map((title) => list.indexOf(`>${title}`));
    rows.forEach((at) => expect(at).toBeGreaterThan(-1));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    // The still transcript shown before any replay is the first run: it found legal places; the refusal tested a move.
    const transcript = html.slice(html.indexOf("data-agent-run"), html.indexOf("data-agent-picker"));
    expect(transcript).toContain("Found legal places");
    expect(transcript).not.toContain("Tested a move");
  });

  it("lists first, as the still transcript, the keep run whose own events hold a Qloo request, and its row says so", () => {
    // Served with the run that asked Qloo after one that did not, both ending with a place to keep.
    served.runs = [recorded("refused", REFUSED), recorded("quiet", FIND_MOVES), keepAsking("asked")];
    const html = renderToStaticMarkup(createElement(AgentPanel, { preset: tiny, day: 0, agentStatus: "off" }));
    const list = html.slice(html.indexOf('aria-label="Recorded runs"'));
    const rows = ["Run asked", "Run quiet", "Run refused"].map((title) => list.indexOf(`>${title}`));
    rows.forEach((at) => expect(at).toBeGreaterThan(-1));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(text(list)).toContain("Run asked · This run made 1 Qloo request.");
    expect(text(list)).toContain("Run quiet · This run made no Qloo request.");
    // The transcript before any replay is that run: it explained a clash as well as finding legal places.
    const transcript = html.slice(html.indexOf("data-agent-run"), html.indexOf("data-agent-picker"));
    expect(transcript).toContain("Explained a clash");
    expect(transcript).toContain("Found legal places");
  });
});

/** A run that found legal places and explained a clash with one Qloo request, live when recorded, as the API serves it. */
function keepAsking(id: string): RecordedRun {
  const stream = streamOf(FIND_MOVES, "Here.", 1);
  const explain = [
    { type: "tool_call", id: "call_explain", tool: "explain_clash", input: {}, provenance: "qloo" },
    {
      type: "tool_result",
      id: "call_explain",
      tool: "explain_clash",
      ok: true,
      summary: "done",
      latency_ms: 310,
      provenance: "qloo",
      requests: [{ path: "/v2/analysis/compare", params: {}, status: 200, latency_ms: 300, cached: false, recorded: false }],
    },
  ];
  const events = [...stream.slice(0, 3), ...explain, ...stream.slice(3)].map((event, i) => ({ t: i * 100, event }));
  const [run] = parseRecordings({ runs: [{ id, title: `Run ${id}`, question: "Why do they clash, and where could Bo go?", captured_at: "2026-10-01T10:00:00Z", model: "m", events }] });
  return run;
}

describe("where a replayed run's question lands (the heading clear of the sticky bars)", () => {
  // At 1440 x 900 the page's scroll padding is 82 px and the section's own scroll margin 34 px, so a jump lands the
  // section's top at 116 px, 8 px under the sticky bars (the 64 px header and the 44 px nav); the first run's question
  // sits 148 px below the section's top while the agent is off (the section's padding, the off notice and its gap).
  const wide = { wide: true, sectionMargin: 34, padding: 82, viewport: 900 };

  it("lands the section where the jump lands it from 1024 px, so its heading stays in view beside the question", () => {
    const margin = replayScrollMargin({ ...wide, offset: 148 });
    expect(margin).toBe(182);
    // The question lands at the scroll padding plus its margin; the section's top lands where the jump puts it.
    expect(wide.padding + (margin ?? 0)).toBe(264);
    expect(wide.padding + (margin ?? 0) - 148).toBe(wide.padding + wide.sectionMargin);
    // With the live agent on, the conversation opens the run column, level with the heading.
    expect(replayScrollMargin({ ...wide, offset: 48 })).toBe(82);
  });

  it("keeps the item's own margin on one column, and for a run far down the conversation", () => {
    // Below 1024 px the heading and the can/cannot list sit above the run: the question comes to the top.
    expect(replayScrollMargin({ ...wide, wide: false, offset: 148 })).toBeNull();
    // That margin is the run card's own: 12 px (scroll-mt-3) under the phone's 63 px scroll padding puts its title
    // row at 75 px, at least 8 px clear of the 56 px header, with the question under it.
    const run = asking("asks");
    const card = renderToStaticMarkup(
      createElement(ExchangeView, {
        exchange: { id: "q1", message: run.question, recording: run, recorded: true, state: replayFinalState(run) },
        latest: true,
        range: { low: 90, high: 110 },
        festival: tiny.festival,
        day: 0,
        onRetry: () => {},
        onSkip: () => {},
      }),
    );
    expect(card).toMatch(/^<li id="agent-q1" class="scroll-mt-3 [^"]*\bmd:scroll-mt-10\b/);
    expect(63 + 12).toBeGreaterThanOrEqual(56 + 8);
    // A later run, below an earlier one: bringing the section's top into view would leave its question low.
    expect(replayScrollMargin({ ...wide, offset: 1400 })).toBeNull();
  });

  it("brings the section's top into view only while the question still lands in the upper half of the screen", () => {
    // 82 + (334 + 34) = 450, the middle of a 900 px screen: still in; one more pixel and the item's margin stands.
    expect(replayScrollMargin({ ...wide, offset: 334 })).toBe(368);
    expect(replayScrollMargin({ ...wide, offset: 335 })).toBeNull();
  });
});

/** A finished run's results and reply, read the way the panel reads them. */
function finished(run: RecordedRun): { results: RunResult[]; reply: ReturnType<typeof readClashReply> } {
  const { results } = replayFinalState(run);
  return { results, reply: readClashReply(results) };
}

const REFUSED: ToolData = {
  call_try: { kind: "what_if", move: "Bo Diddly Squat -> Main 20:00", allowed: false, problems: ["That slot is taken."] },
};

describe("the agent run's Qloo label (A2)", () => {
  it("labels a recorded run that sent no Qloo request with its count, and says where its prices' taste came from", () => {
    const run = recorded("zero", FIND_MOVES);
    const { reply } = finished(run);
    expect(pricedEveryPlace(reply)).toBe(true);
    expect(recordedQloo(run, reply)).toEqual({ label: ZERO_REQUESTS_LABEL, savedReading: true });
    expect(ZERO_REQUESTS_LABEL).toBe("Qloo requests in this run: 0");
    expect(SAVED_READING_LINE).toBe(
      "Every place it tested was scored with this day’s saved Qloo reading (taste overlap and popularity); it sent no new request.",
    );
  });

  it("keeps the count label but no saved-reading line for a run that priced no place, or tested one the rules refused", () => {
    const refused = recorded("refused", REFUSED);
    expect(recordedQloo(refused, finished(refused).reply)).toEqual({ label: ZERO_REQUESTS_LABEL, savedReading: false });
    const words = recorded("words", {});
    expect(recordedQloo(words, finished(words).reply)).toEqual({ label: ZERO_REQUESTS_LABEL, savedReading: false });
  });

  it("labels a run with a Qloo request the same way, with its own count, and no saved-reading line", () => {
    const one = recorded("one", FIND_MOVES, "Here.", 1);
    expect(recordedQloo(one, finished(one).reply)).toEqual({ label: "Qloo requests in this run: 1", savedReading: false });
    // One format on every published day, the count always the recording's own.
    expect(requestsLabel(0)).toBe(ZERO_REQUESTS_LABEL);
    for (const count of [0, 1, 3]) {
      const run = recorded(`n${count}`, FIND_MOVES, "Here.", count);
      expect(recordedQloo(run, finished(run).reply).label).toBe(`Qloo requests in this run: ${count}`);
    }
  });

  it("says in the drawer that a 0-request run scored its places with the saved reading, never on the invented day", () => {
    expect(SAVED_READING_NOTE).toBe(
      "This run sent no new Qloo request; every place it tested was scored with this day’s saved Qloo reading.",
    );
    expect(noRequestsNote(true, false)).toBe(SAVED_READING_NOTE);
    // A run that scored no place, a ledger, and the invented day keep the plain note.
    expect(noRequestsNote(false, false)).toBe(NO_QLOO_NOTE);
    expect(noRequestsNote(true, true)).toBe(NO_QLOO_NOTE);
    expect(NO_QLOO_NOTE).toBe(
      "Whatever this run produced did not use Qloo data. Check the label on each value to see where it came from.",
    );
    // The panel passes the saved-reading flag only when the recording itself says 0 requests and every place
    // it tested was scored.
    const zero = recorded("zero", FIND_MOVES);
    expect(recordedQloo(zero, finished(zero).reply).savedReading).toBe(true);
    const refused = recorded("refused", REFUSED);
    expect(recordedQloo(refused, finished(refused).reply).savedReading).toBe(false);
    expect(recordedQloo(zero, finished(zero).reply, true).savedReading).toBe(false);
  });

  it("says a run has finished only for a run, never for a ledger that is not one", () => {
    expect(runStatusText(true, "run_invented")).toBe("The run is still going. New requests are added here as they happen.");
    expect(runStatusText(false, "run_invented")).toBe("The run has finished.");
    // The day's saved build and one pair's requests have no run id: nothing to finish.
    expect(runStatusText(false)).toBeNull();
    expect(runStatusText(false, undefined)).toBeNull();
    // A replayed recording keeps its own run id, so its drawer still says it finished.
    expect(replayFinalState(recorded("zero", FIND_MOVES)).runId).toBe("run_invented");
  });

  it("says nothing about Qloo on the invented day, or for a live run", () => {
    const run = recorded("zero", FIND_MOVES);
    expect(recordedQloo(run, finished(run).reply, true)).toEqual({ label: null, savedReading: false });
    expect(recordedQloo(undefined, finished(run).reply)).toEqual({ label: null, savedReading: false });
  });

  it("prints the label as the trigger's whole name, with no second count beside it", () => {
    const html = renderToStaticMarkup(
      createElement(TraceDrawer, {
        toolCalls: [],
        mode: "recorded",
        triggerVariant: "ghost",
        triggerLabel: ZERO_REQUESTS_LABEL,
        countInLabel: true,
      }),
    );
    expect(text(html)).toBe(ZERO_REQUESTS_LABEL);
    expect(html).not.toContain("aria-label");
    // The default trigger is unchanged: its label and the count.
    const plain = renderToStaticMarkup(createElement(TraceDrawer, { toolCalls: [], mode: "recorded", triggerVariant: "ghost" }));
    expect(plain).toContain('aria-label="How Qloo was used, 0 requests"');
  });
});

describe("a replayed run's Qloo request line sits in its header, under its question", () => {
  const range = { low: 90, high: 110 };
  const view = (run: RecordedRun | undefined, state: RunState, synthetic = false) =>
    renderToStaticMarkup(
      createElement(ExchangeView, {
        exchange: { id: "q1", message: run?.question ?? "Where could Bo go?", recording: run, recorded: run !== undefined, state },
        latest: true,
        range,
        festival: tiny.festival,
        day: 0,
        synthetic,
        onRetry: () => {},
        onSkip: () => {},
      }),
    );
  /** Every button in the markup that holds these words. */
  const buttonsWith = (html: string, words: string) =>
    [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]).filter((button) => text(button).includes(words));

  it("reads its count from the recording, for a replay only, never on the invented day", () => {
    expect(headerTraceLabel(asking("asks"))).toBe("Qloo requests in this run: 1");
    expect(headerTraceLabel(recorded("zero", FIND_MOVES))).toBe(ZERO_REQUESTS_LABEL);
    expect(headerTraceLabel(undefined)).toBeNull();
    expect(headerTraceLabel(asking("asks"), true)).toBeNull();
  });

  it("puts the same trace button under the question once the replay has played: 14 px, weight 600, ink, once", () => {
    const run = asking("asks");
    const html = view(run, replayFinalState(run));
    const buttons = buttonsWith(html, "Qloo requests in this run: 1");
    expect(buttons).toHaveLength(1);
    // The trace trigger itself (it opens the trace dialog), its words the whole name, with no second count.
    expect(buttons[0]).toContain('aria-haspopup="dialog"');
    expect(text(buttons[0])).toBe("Qloo requests in this run: 1");
    expect(buttons[0]).not.toContain("aria-label");
    // 14 px (text-sm), weight 600 (font-semibold), ink (text-foreground); not the 12 px foot line it was.
    expect(buttons[0]).toMatch(/class="[^"]*\btext-sm\b/);
    expect(buttons[0]).toMatch(/class="[^"]*\bfont-semibold\b/);
    expect(buttons[0]).toMatch(/class="[^"]*\btext-foreground\b/);
    expect(buttons[0]).not.toMatch(/\btext-xs\b/);
    // In the header: after the question, before the replay's notice and its steps; shown, not held hidden.
    const question = html.indexOf("Why do they clash?");
    const line = html.indexOf(buttons[0]);
    expect(question).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(question);
    expect(line).toBeLessThan(html.indexOf("A real agent run, replayed from a saved stream."));
    expect(line).toBeLessThan(html.indexOf('aria-label="What the agent did"'));
    expect(html).toContain('<div data-run-trace="" class="mt-1">');
    // Nowhere else, the run's foot included.
    expect(html.match(/Qloo requests in this run/g)).toHaveLength(1);
    expect(text(html)).not.toContain("How Qloo was used");
  });

  it("keeps the line's room, with the same words, from the replay's first beat, hidden until the replay has played", () => {
    const run = asking("asks");
    const playing = reduceEvents(toReplayBeats(run).slice(0, 2).map((beat) => beat.event));
    expect(playing.status).toBe("running");
    const html = view(run, playing);
    expect(html).toContain('<div data-run-trace="" class="mt-1 invisible">');
    expect(buttonsWith(html, "Qloo requests in this run: 1")).toHaveLength(1);
  });

  it("leaves a live run's trace at its foot, and the invented day's too", () => {
    const events = streamOf(FIND_MOVES, "Here.").map((raw) => {
      const parsed = parseAgentEvent(raw);
      if (parsed.kind !== "event") throw new Error(`fixture event not read: ${JSON.stringify(raw)}`);
      return parsed.event;
    });
    const live = view(undefined, reduceEvents(events as AgentEvent[]));
    expect(live).not.toContain("data-run-trace");
    expect(buttonsWith(live, "How Qloo was used")).toHaveLength(1);
    const run = asking("asks");
    const invented = view(run, replayFinalState(run), true);
    expect(invented).not.toContain("data-run-trace");
    expect(invented).not.toContain("Qloo requests in this run");
    // On screen once, at the foot (the hidden copy that holds a replay's height draws it too, until it is measured).
    const shown = invented.slice(0, invented.indexOf('aria-hidden="true" inert=""'));
    expect(buttonsWith(shown, "Where the figures came from")).toHaveLength(1);
  });
});

describe("the run against the move at the top of the page (A3)", () => {
  it("says why their index changes differ when the run moved another set", () => {
    const place = keepableMove(liveResults(FIND_MOVES), tiny.festival, 0);
    expect(runVersusCard(place, "ann")).toBe(
      "This run looked for a place for Bo Diddly Squat that lowers the index; the move at the top of the page works on the day’s costliest clash that a move can lower, so their index changes differ.",
    );
    // It names no UI the page no longer has.
    expect(runVersusCard(place, "ann")).not.toMatch(/decision card/i);
    expect(runVersusCard(place, "bo")).toBeNull();
    expect(runVersusCard(place, null)).toBeNull();
    expect(runVersusCard(null, "ann")).toBeNull();
    expect(runVersusCard(place, "ann")).not.toMatch(/the best/i);
  });
});

/** A plan the engine priced: only its status matters to the add check. */
const READY: PlanAnswer = {
  status: "ready",
  plan: { publishedBudget: 104.2, budget: 99, steps: [], clashes: [], options: null } as Plan,
};

/** A move the plan already holds: another set (Cy Twombly), on this day. */
const HELD: StackMove = { actId: "cy", stageId: "side", day: 0, start: "16:00" };

describe("Keep this move with a plan that already holds a move (A4)", () => {
  const shapes: [string, () => AgentPlace][] = [
    ["a replayed run", () => keepableMove(replayFinalState(recorded("find", FIND_MOVES)).results, tiny.festival, 0) as AgentPlace],
    ["a live run", () => keepableMove(liveResults(FIND_MOVES), tiny.festival, 0) as AgentPlace],
  ];

  for (const [shape, placeOf] of shapes) {
    it(`adds ${shape}'s place after the kept move only once the engine priced the combined plan`, async () => {
      const place = placeOf();
      const kept: StackStep[] = [HELD];
      const check = vi.fn((steps: readonly StackStep[]) => Promise.resolve<PlanAnswer>(steps.length > 1 ? READY : { status: "error" }));
      const outcome = await checkAdd(kept, place, check);
      // The engine was asked about the whole plan: the kept move, then this place.
      expect(check).toHaveBeenCalledWith([HELD, BEST]);
      expect(outcome).toEqual({ kind: "ready", choice: { mode: "add", base: encodeMoves(kept) }, count: 2 });
      if (outcome.kind !== "ready") throw new Error("not ready");
      // The page hands the choice to "Try a move", which adds it after the kept move.
      const keep = vi.fn(() => null);
      keepPress(place, keep, outcome.choice)();
      expect(keep).toHaveBeenCalledWith(BEST, { mode: "add", base: encodeMoves(kept) });
      const next = seededPlan(kept, { step: place.move, ...outcome.choice });
      expect(next).toEqual([HELD, BEST]);
      expect(keepNote(kept, next ?? [])).toBe("Added: 2 kept moves.");
    });

    it(`replaces the plan with ${shape}'s place when asked, and says so`, () => {
      const place = placeOf();
      const kept: StackStep[] = [HELD];
      const next = seededPlan(kept, { step: place.move, mode: "replace" });
      expect(next).toEqual([BEST]);
      expect(keepNote(kept, next ?? [])).toBe("Replaced your 1 kept move.");
    });

    it(`leaves the plan exactly as it was when the engine refuses ${shape}'s place with the kept move`, async () => {
      const place = placeOf();
      const kept: StackStep[] = [HELD];
      const snapshot = JSON.stringify(kept);
      const keep = vi.fn(() => null);
      const refused = await checkAdd(kept, place, async () => ({ status: "invalid" }));
      expect(refused).toEqual({
        kind: "rejected",
        reason:
          "Not added: with your kept moves in place, the timetable engine finds this is no longer a legal place for Bo Diddly Squat. Your plan is unchanged.",
        retry: false,
      });
      const failed = await checkAdd(kept, place, async () => ({ status: "error" }));
      expect(failed).toMatchObject({ kind: "rejected", retry: true });
      // Nothing was handed to the plan, and the plan is untouched.
      expect(keep).not.toHaveBeenCalled();
      expect(JSON.stringify(kept)).toBe(snapshot);
    });
  }

  it("never asks the engine for a set the plan already moves, or past the plan's eight moves", async () => {
    const place = keepableMove(liveResults(FIND_MOVES), tiny.festival, 0) as AgentPlace;
    const check = vi.fn(async () => READY);
    const moved = await checkAdd([{ ...BEST, start: "22:10" }], place, check);
    expect(moved).toMatchObject({ kind: "rejected", retry: false });
    expect(moved.kind === "rejected" && moved.reason).toBe(
      "Not added: your plan already moves Bo Diddly Squat, and a plan moves each set once. Your plan is unchanged.",
    );
    const full = Array.from({ length: 8 }, (_, i) => ({ actId: `set-${i}`, stageId: "side", day: 0, start: "12:00" }));
    expect(await checkAdd(full, place, check)).toMatchObject({ kind: "rejected", retry: false });
    expect(check).not.toHaveBeenCalled();
  });

  it("never adds onto a plan that changed since it was priced, and never turns an add into a replace", () => {
    const priced = encodeMoves([HELD]);
    const other: StackMove = { actId: "ann", stageId: "main", day: 0, start: "18:00" };
    expect(seededPlan([HELD, other], { step: BEST, mode: "add", base: priced })).toBeNull();
    expect(seededPlan([], { step: BEST, mode: "add", base: priced })).toBeNull();
    // A step the plan already holds changes nothing either way.
    expect(seededPlan([HELD, BEST], { step: BEST, mode: "add", base: encodeMoves([HELD, BEST]) })).toBeNull();
    expect(seededPlan([BEST], { step: BEST })).toBeNull();
  });

  it("offers Add (first) and Replace when the plan holds a move, and one Keep this move when it is empty", () => {
    const place = keepableMove(liveResults(FIND_MOVES), tiny.festival, 0) as AgentPlace;
    const render = (kept: readonly StackStep[]) =>
      renderToStaticMarkup(createElement(KeepThisPlace, { place, kept, onKeep: () => null, check: async () => READY }));
    const choosing = render([HELD]);
    const words = text(choosing);
    expect(words).toContain("Keep this move : your plan already holds 1 kept move.");
    expect(words.indexOf("Add to your plan")).toBeLessThan(words.indexOf("Replace your plan"));
    expect(choosing).toContain('role="group"');
    // Existing Button variants, no pill, badge or chip.
    expect(choosing).toMatch(/data-variant="outline"[^>]*>Add to your plan/);
    expect(choosing).toMatch(/data-variant="ghost"[^>]*>Replace your plan/);
    const emptyHtml = render([]);
    const empty = text(emptyHtml);
    expect(empty).toContain("Keep this move");
    // The one button reads the hero's label, the decision card's KEEP_MOVE.
    expect(emptyHtml).toMatch(new RegExp(`data-variant="outline"[^>]*>${KEEP_MOVE}</button>`));
    expect(empty).not.toContain("Add to your plan");
    expect(empty).not.toContain("Replace your plan");
    expect(`${words} ${empty}`).not.toContain("Keep this place");
  });
});

describe("a place kept from a recorded run says so in the plan (P9)", () => {
  /** The engine's plan holding the run's place, as the plan card prints it (invented figures). */
  const plan: Plan = {
    publishedBudget: 104.2,
    budget: 100.1,
    steps: [
      {
        act: "Bo Diddly Squat",
        actId: "bo",
        move: "Bo Diddly Squat: Side 20:30-22:00 -> Side 22:05-23:35",
        stage: "Side",
        stageId: "side",
        day: 0,
        start: "22:05",
        end: "23:35",
        budgetAfter: 100.1,
      },
    ],
    clashes: [],
    options: null,
  };
  const card = (moves: readonly StackStep[]) =>
    renderToStaticMarkup(
      createElement(ScratchPlan, { preset: tiny, day: 0, plan, moves, range: { low: 90, high: 110 }, onUndo: () => {}, onStartOver: () => {} }),
    );

  it("marks a replayed run's place, never a live run's, and the mark changes nothing about the move", () => {
    const tested = keepableMove(replayFinalState(recorded("find", FIND_MOVES)).results, tiny.festival, 0);
    const replayed = placeToKeep(tested, true);
    expect(replayed?.move).toEqual({ ...BEST, source: "recorded-run" });
    expect(placeToKeep(tested, false)?.move).toEqual(BEST);
    expect(placeToKeep(null, true)).toBeNull();
    // Kept through the page's own seed path, the plan holds the marked move; it compares, encodes and is sent
    // exactly as the plain one.
    const next = seededPlan([], { step: replayed!.move, mode: "replace" });
    expect(next).toEqual([{ ...BEST, source: "recorded-run" }]);
    expect(planHolds(next ?? [], BEST)).toBe(true);
    expect(encodeMoves(next ?? [])).toBe(encodeMoves([BEST]));
    expect(planBody(next ?? [], null)).toBe(planBody([BEST], null));
  });

  it("prints \"(from a recorded agent run)\" after that move in the plan, and keeps it after a reload of the tab", () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
    storeMoves(tiny.id, [placeToKeep(keepableMove(liveResults(FIND_MOVES), tiny.festival, 0), true)!.move], storage);
    const reloaded = readStoredMoves(tiny.id, storage);
    expect(reloaded.map(isFromRecordedRun)).toEqual([true]);
    const marked = text(card(reloaded));
    expect(marked).toContain(`1. Bo Diddly Squat · Side 22:05–23:35 ${RECORDED_RUN_NOTE}`);
    // A move kept any other way, or saved before the mark existed, prints no note.
    expect(text(card([BEST]))).not.toContain(RECORDED_RUN_NOTE);
  });

  it("prints the plan's index as the hero does: one line, in words, with no bars and no chip", () => {
    const html = card([BEST]);
    expect(text(html)).toContain("104.2 → 100.1");
    expect(text(html)).toContain("−4.1 index points · Clash Budget Index · lower is better");
    expect(html.match(/data-index-change=""/g)).toHaveLength(1);
    expect(html).not.toMatch(/bg-success|text-success|rounded-bar|\btag\b/);
  });
});

describe("the trace ledger's missing request ids (A8)", () => {
  const row = (record: Partial<QlooRequestRecord>, synthetic = false) =>
    text(
      renderToStaticMarkup(
        createElement(RequestItem, {
          item: {
            record: { path: "/v2/insights", params: {}, status: 200, latency_ms: Number.NaN, cached: false, ...record },
            toolId: "t",
            tool: "build",
            ordinal: 1,
          },
          synthetic,
        }),
      ),
    );

  it("says why a saved, cached response has no request id", () => {
    expect(row({ recorded: true, cached: true })).toContain("No request id: this response was saved before request ids were kept.");
    expect(row({ recorded: true, cached: true })).not.toContain("Request ID not saved");
  });

  it("marks a control act's search with a plain 'control act' label that links to the controls on /method", () => {
    const html = (record: Partial<QlooRequestRecord>, synthetic = false) =>
      renderToStaticMarkup(
        createElement(RequestItem, {
          item: {
            record: { path: "/search", params: {}, status: 200, latency_ms: Number.NaN, cached: true, ...record },
            toolId: "t",
            tool: "build",
            ordinal: 1,
          },
          synthetic,
        }),
      );
    const label = /<a [^>]*href="\/method#controls"[^>]*>control act<\/a>/;
    for (const query of CONTROL_ACTS) {
      const row = html({ params: { query, types: "urn:entity:artist", take: "3" } });
      expect(row).toMatch(label);
      expect(row).toContain('href="/method#controls"');
      expect(row).toContain('title="Looked up to check that unrelated audiences rank near the bottom."');
      // After the query, in its own cell.
      expect(text(row)).toContain(`query ${query} control act`);
      expect(row.match(/control act/g)).toHaveLength(1);
    }
    // Any other act's search, another endpoint with the same query, or the invented day: no label.
    expect(html({ params: { query: "Act One" } })).not.toContain("control act");
    expect(html({ path: "/v2/insights", params: { query: "Raffi" } })).not.toContain("control act");
    expect(html({ params: { query: "Raffi" } }, true)).not.toContain("control act");
  });

  it("keeps a saved id, and gives the reason nowhere else (never on the invented day)", () => {
    expect(row({ recorded: true, cached: false, request_id: "req-invented-1" })).toContain("Request ID req-invented-1");
    expect(row({ recorded: true, cached: true }, true)).not.toContain("saved before request ids were kept");
    expect(row({ recorded: true, cached: false })).toContain("Request ID not saved with this response");
    expect(row({ cached: true })).toContain("Request ID none (served from cache)");
  });
});

describe("the agent section while its recorded runs are still out (round 37 closeout, F3)", () => {
  beforeEach(() => {
    served.runs = [recorded("a", FIND_MOVES), recorded("b", {}), recorded("c", FIND_MOVES)];
    served.otherDays = new Map();
    served.asks = [];
  });

  /** The panel rendered pending (`loading`) or settled, and the part above its run: the heading and the can/cannot list. */
  function render(loading: boolean, agentStatus: "off" | "checking" | "on" | "unknown" = "off") {
    served.loading = loading;
    try {
      const html = renderToStaticMarkup(createElement(AgentPanel, { preset: tiny, day: 0, agentStatus }));
      return { html, side: html.slice(html.indexOf("<div data-agent-side"), html.indexOf("<div data-agent-run")) };
    } finally {
      served.loading = false;
    }
  }

  it("draws the heading and the can/cannot list exactly as the settled panel does, so nothing above the run moves when they land", () => {
    const pending = render(true);
    const settled = render(false);
    expect(pending.html).toContain("Checking whether the live agent is on.");
    expect(settled.html).not.toContain("Checking whether the live agent is on.");
    expect(pending.side).toContain("data-agent-limits");
    expect(pending.side.length).toBeGreaterThan(200);
    expect(pending.side).toBe(settled.side);
    // The run starts at the same place in both: the same column classes.
    const runClass = (html: string) => html.match(/<div data-agent-run="" class="([^"]+)"/)?.[1];
    expect(runClass(pending.html)).toBe(runClass(settled.html));
  });

  it.each(["on", "unknown"] as const)(
    "keeps everything above the run unchanged when /api/health settles from checking to %s (F3 residual)",
    (status) => {
      const checking = render(true, "checking");
      expect(checking.html).toContain("Checking whether the live agent is on.");
      for (const loading of [true, false]) {
        const settled = render(loading, status);
        expect(settled.html).not.toContain("Checking whether the live agent is on.");
        // The live agent's capabilities are drawn, but after the question form, never in the side column.
        expect(settled.html).toContain("What it can do");
        expect(settled.side).not.toContain("What it can do");
        expect(settled.side).toBe(checking.side);
        const runClass = (html: string) => html.match(/<div data-agent-run="" class="([^"]+)"/)?.[1];
        expect(runClass(settled.html)).toBe(runClass(checking.html));
      }
    },
  );

  it("holds at least the tallest settled section measured on the published days at each width", () => {
    // Settled #agent heights (px) measured on 21 to 22 Oct 2026 with the live agent off, Glastonbury's the taller.
    const settled: [number, number][] = [
      [320, 1819], [360, 1659], [375, 1587], [390, 1588], [430, 1571], [520, 1386], [640, 1215], [767, 1216],
      [768, 1216], [900, 1217], [1023, 1193], [1024, 1004], [1100, 965], [1280, 879], [1440, 879], [1920, 879],
    ];
    for (const [width, height] of settled) expect(agentRoomFloor(width), `at ${width} px`).toBeGreaterThanOrEqual(height);
  });
});
