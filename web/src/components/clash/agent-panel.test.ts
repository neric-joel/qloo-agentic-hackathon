import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TraceDrawer } from "@/components/kernel";
import { RequestItem } from "@/components/kernel/trace-parts";
import { readClashReply } from "@/lib/agent-session";
import { qlooCredits } from "@/lib/credit";
import { parseAgentEvent, type AgentEvent, type QlooRequestRecord } from "@/lib/events";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset, type Preset } from "@/lib/preset";
import { parseRecordings, replayFinalState, type RecordedRun } from "@/lib/recorded-run";
import { reduceEvents, type RunResult } from "@/lib/run-state";
import { encodeMoves, type Plan, type PlanAnswer, type StackMove, type StackStep } from "@/lib/stack";

import {
  AgentPanel,
  KeepThisPlace,
  RECORDED_HEADING,
  SAVED_READING_LINE,
  ZERO_REQUESTS_LABEL,
  agentLayout,
  agentLimits,
  checkAdd,
  keepNote,
  keepPress,
  keepableMove,
  planHolds,
  pricedEveryPlace,
  recordedQloo,
  recordingsQlooLine,
  runVersusCard,
  type AgentPlace,
} from "./agent-panel";
import { runQlooLine } from "./recorded-runs";
import { seededPlan } from "./try-a-move";

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

  it("says none of the recorded runs sent a new Qloo request when every recording says 0, read from the recordings", () => {
    const line =
      "None of these three recorded runs sent a new Qloo request: they test moves with the timetable engine, which scores with this day’s saved Qloo reading.";
    expect(text(panel())).toContain(line);
    expect(recordingsQlooLine(served.runs)).toBe(line);
    expect(recordingsQlooLine(served.runs.slice(0, 1))).toBe(
      "This recorded run sent no new Qloo request: it tests moves with the timetable engine, which scores with this day’s saved Qloo reading.",
    );
  });

  it("gives each run its own Qloo count when one of them asked Qloo, and no summary line", () => {
    served.runs = [recorded("a", FIND_MOVES, "Here.", 1)];
    expect(recordingsQlooLine(served.runs)).toBeNull();
    expect(runQlooLine(served.runs[0])).toBe("This run made 1 Qloo request.");
    const words = text(panel());
    expect(words).toContain("This run made 1 Qloo request.");
    expect(words).not.toContain("sent a new Qloo request");
    expect(words).not.toContain(SAVED_READING_LINE);
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

  it("keeps the columns level before a run, and fills the left column beside a replay from 1024 px", () => {
    const before = agentLayout(false);
    // Before: the side column spans both rows; the picker sits under the transcript on the right.
    expect(before.side).toContain("lg:row-span-2");
    expect(before.picker).toContain("lg:col-start-6");
    expect(before.pickerInner).toBe("");
    const playing = agentLayout(true);
    // While and after a replay: the run spans both rows on the right; the picker sits under the list on the left,
    // stretched to the run's height and sticky under the header and section nav, so the left column is never empty.
    expect(playing.run).toContain("lg:row-span-2");
    expect(playing.side).not.toContain("lg:row-span-2");
    expect(playing.picker).toContain("lg:col-start-1");
    expect(playing.picker).toContain("lg:self-stretch");
    expect(playing.pickerInner).toBe("lg:sticky lg:top-32");
    // The left side is 5 of 12 columns in both states; the run keeps its 7.
    for (const layout of [before, playing]) {
      expect(layout.side).toContain("lg:col-span-5");
      expect(layout.run).toContain("lg:col-span-7 lg:col-start-6");
    }
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

  it("leaves a run with a Qloo request its own drawer label and count, with no saved-reading line", () => {
    const one = recorded("one", FIND_MOVES, "Here.", 1);
    expect(recordedQloo(one, finished(one).reply)).toEqual({ label: null, savedReading: false });
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

describe("the run against the decision card (A3)", () => {
  it("says why their index changes differ when the run moved another set", () => {
    const place = keepableMove(liveResults(FIND_MOVES), tiny.festival, 0);
    expect(runVersusCard(place, "ann")).toBe(
      "This run looked for a lower-index place for Bo Diddly Squat; the decision card works on the day’s costliest clash that a move can lower, so their index changes differ.",
    );
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

describe("Keep this place with a plan that already holds a move (A4)", () => {
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

  it("offers Add (first) and Replace when the plan holds a move, and one Keep this place when it is empty", () => {
    const place = keepableMove(liveResults(FIND_MOVES), tiny.festival, 0) as AgentPlace;
    const render = (kept: readonly StackStep[]) =>
      renderToStaticMarkup(createElement(KeepThisPlace, { place, kept, onKeep: () => null, check: async () => READY }));
    const choosing = render([HELD]);
    const words = text(choosing);
    expect(words).toContain("Keep this place : your plan already holds 1 kept move.");
    expect(words.indexOf("Add to your plan")).toBeLessThan(words.indexOf("Replace your plan"));
    expect(choosing).toContain('role="group"');
    // Existing Button variants, no pill, badge or chip.
    expect(choosing).toMatch(/data-variant="outline"[^>]*>Add to your plan/);
    expect(choosing).toMatch(/data-variant="ghost"[^>]*>Replace your plan/);
    const empty = text(render([]));
    expect(empty).toContain("Keep this place");
    expect(empty).not.toContain("Add to your plan");
    expect(empty).not.toContain("Replace your plan");
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

  it("keeps a saved id, and gives the reason nowhere else (never on the invented day)", () => {
    expect(row({ recorded: true, cached: false, request_id: "req-invented-1" })).toContain("Request ID req-invented-1");
    expect(row({ recorded: true, cached: true }, true)).not.toContain("saved before request ids were kept");
    expect(row({ recorded: true, cached: false })).toContain("Request ID not saved with this response");
    expect(row({ cached: true })).toContain("Request ID none (served from cache)");
  });
});
