import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { qlooCredits } from "@/lib/credit";
import { parseAgentEvent, type AgentEvent } from "@/lib/events";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset, type Preset } from "@/lib/preset";
import { parseRecordings, replayFinalState, type RecordedRun } from "@/lib/recorded-run";
import { reduceEvents } from "@/lib/run-state";
import type { StackMove } from "@/lib/stack";

import {
  AgentPanel,
  RECORDED_HEADING,
  agentLimits,
  keepPress,
  keepableMove,
  planHolds,
  recordingsQlooLine,
  type AgentPlace,
} from "./agent-panel";
import { runQlooLine } from "./recorded-runs";

/** The recorded runs the mocked hook serves, set per test. */
const served: { runs: RecordedRun[] } = { runs: [] };

vi.mock("./use-recordings", () => ({
  useRecordings: () => ({ status: "ready", runs: served.runs }),
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

describe("Keep this place takes the move only from the run's own tool result", () => {
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
    expect(keep).toHaveBeenCalledWith(BEST);
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
  });

  function panel(preset: Preset = tiny, agentStatus: "off" | "on" = "off") {
    return renderToStaticMarkup(createElement(AgentPanel, { preset, day: 0, agentStatus }));
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
      "It can test a move, but it never changes your timetable unless you press Keep this place.",
      "It never contacts anyone or publishes anything.",
      "At most 12 Qloo requests and 6 model turns per run.",
    ]);
    // An open list, not a disclosure.
    const list = html.slice(html.indexOf("What the agent can and cannot do"));
    expect(list.slice(0, list.indexOf("</ul>"))).not.toContain("<details");
  });

  it("says none of the recorded runs asked Qloo when every recording says 0, read from the recordings", () => {
    expect(text(panel())).toContain("None of these three recorded runs asked Qloo: they test moves with the timetable engine.");
    expect(recordingsQlooLine(served.runs)).toBe(
      "None of these three recorded runs asked Qloo: they test moves with the timetable engine.",
    );
  });

  it("gives each run its own Qloo count when one of them asked Qloo, and no summary line", () => {
    served.runs = [recorded("a", FIND_MOVES, "Here.", 1)];
    expect(recordingsQlooLine(served.runs)).toBeNull();
    expect(runQlooLine(served.runs[0])).toBe("This run made 1 Qloo request.");
    const words = text(panel());
    expect(words).toContain("This run made 1 Qloo request.");
    expect(words).not.toContain("asked Qloo");
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
});
