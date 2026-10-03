import { describe, expect, it } from "vitest";

import {
  MAX_HISTORY_TURNS,
  MAX_MESSAGE_CHARS,
  MAX_TURN_CHARS,
  budgetDelta,
  buildClashBody,
  changeLabel,
  historyFrom,
  humanizeProblem,
  inlineSegments,
  latestSession,
  readClashReply,
  suggestedPrompts,
  textBlocks,
  type Exchange,
} from "./agent-session";
import type { AgentEvent } from "./events";
import type { Evidence, PairClash } from "./preset";
import { reduceEvents } from "./run-state";

const session = {
  timetable: [{ act_id: "a1", day: 0, stage_id: "s1", start: 600, end: 660, locked: true }],
  constraints: { keep_apart: [] },
  rules: ["Keep Act One on the Main Stage"],
};

function answered(id: string, message: string, text: string, extra: Record<string, unknown> = {}): Exchange {
  const events: AgentEvent[] = [
    { type: "run_started", run_id: `run_${id}`, mode: "live" },
    { type: "text_delta", text },
    { type: "result", kind: "clash", data: { text, tool_data: {}, session, ...extra } },
    { type: "run_finished", run_id: `run_${id}`, qloo_calls: 0, elapsed_ms: 10 },
  ];
  return { id, message, state: reduceEvents(events) };
}

function failed(id: string, message: string): Exchange {
  return {
    id,
    message,
    state: reduceEvents([
      { type: "run_started", run_id: `run_${id}`, mode: "live" },
      { type: "error", message: "Too many requests.", retryable: true },
      { type: "run_finished", run_id: `run_${id}`, qloo_calls: 0, elapsed_ms: 10 },
    ]),
  };
}

describe("readClashReply", () => {
  it("returns null until a clash result arrives", () => {
    expect(readClashReply([])).toBeNull();
    expect(readClashReply([{ kind: "explore", data: { text: "x" } }])).toBeNull();
  });

  it("reads the text, the session and each tool's data in call order", () => {
    const reply = readClashReply([
      {
        kind: "clash",
        data: {
          text: "  Moving it saves 19 points. ",
          session,
          tool_data: {
            t1: {
              kind: "clash",
              a: { name: "Act One" },
              b: { name: "Act Two" },
              minutes_overlapping: 45,
              taste_overlap: 0.62,
              qloo_tags_for_pair: ["Indie rock", "Shoegaze"],
            },
            t2: {
              kind: "what_if",
              move: "Act Two: Other Stage 21:00 -> Other Stage 22:15",
              allowed: true,
              problems: [],
              clash_budget_before: 117.4,
              clash_budget_after: 98.2,
            },
            t3: { kind: "score", report: {} },
            t4: {
              kind: "reslot",
              summary: {
                clash_budget_before: 117,
                clash_budget_after: 90,
                moves: [{ act: "Act Two", from: "Other 21:00", to: "Other 22:15", why: "Splits a shared crowd" }],
              },
            },
          },
        },
      },
    ]);
    expect(reply?.text).toBe("Moving it saves 19 points.");
    expect(reply?.session?.rules).toEqual(["Keep Act One on the Main Stage"]);
    expect(reply?.explains).toEqual([
      {
        a: "Act One",
        b: "Act Two",
        minutesOverlapping: 45,
        sharedAudience: 0.62,
        sharedTaste: ["Indie rock", "Shoegaze"],
        note: null,
      },
    ]);
    expect(reply?.whatIfs).toEqual([
      {
        move: "Act Two: Other Stage 21:00 -> Other Stage 22:15",
        allowed: true,
        problems: [],
        before: 117.4,
        after: 98.2,
      },
    ]);
    expect(reply?.reslots[0]).toMatchObject({ before: 117, after: 90, moves: [{ act: "Act Two" }] });
  });

  it("reads the legal places find_moves lists, and an unmovable set", () => {
    const reply = readClashReply([
      {
        kind: "clash",
        data: {
          text: "Two places work.",
          tool_data: {
            t1: {
              kind: "move_options",
              act: "Act Two",
              from: "Other 21:00-22:00",
              movable: true,
              clash_budget_before: 117,
              legal_places: 4,
              options: [
                { move: "Act Two: Other 21:00-22:00 -> Park 22:15-23:15", stage: "Park", start: "22:15", clash_budget_after: 101 },
              ],
            },
            t2: { kind: "move_options", act: "Headliner", from: "Main 21:00", movable: false, why: "locked in place", options: [] },
          },
        },
      },
    ]);
    expect(reply?.moveOptions[0]).toMatchObject({
      act: "Act Two",
      movable: true,
      before: 117,
      legalPlaces: 4,
      options: [{ stage: "Park", start: "22:15", after: 101 }],
    });
    expect(reply?.moveOptions[1]).toMatchObject({ movable: false, why: "locked in place", legalPlaces: 0 });
  });

  it("keeps a refused move's problems and tolerates missing fields", () => {
    const reply = readClashReply([
      {
        kind: "clash",
        data: {
          text: "No.",
          tool_data: {
            t1: { kind: "what_if", move: "X -> Y", allowed: false, problems: ["Slot taken"] },
            t2: { kind: "clash", a: {}, b: null, taste_overlap: null, note: "No Qloo signal." },
            t4: { kind: "clash", a: { name: "Old" }, b: { name: "Run" }, shared_audience: 0.5, fans_of_both_lean_toward: ["Soul"] },
            t3: "not a record",
          },
        },
      },
    ]);
    expect(reply?.session).toBeNull();
    expect(reply?.whatIfs).toEqual([{ move: "X -> Y", allowed: false, problems: ["Slot taken"], before: null, after: null }]);
    expect(reply?.explains[0]).toMatchObject({ a: "", b: "", sharedAudience: null, note: "No Qloo signal." });
    expect(reply?.explains[1]).toMatchObject({ a: "Old", sharedAudience: 0.5, sharedTaste: ["Soul"] });
  });
});

describe("history and session", () => {
  it("sends only answered exchanges, as user and assistant turns", () => {
    const exchanges = [answered("1", "Why?", "Because."), failed("2", "And?"), answered("3", "What if?", "Lower.")];
    expect(historyFrom(exchanges)).toEqual([
      { role: "user", text: "Why?" },
      { role: "assistant", text: "Because." },
      { role: "user", text: "What if?" },
      { role: "assistant", text: "Lower." },
    ]);
  });

  it("keeps the newest turns within the server limit and clips long turns", () => {
    const many = Array.from({ length: 6 }, (_, i) => answered(String(i), `q${i}`, "x".repeat(MAX_TURN_CHARS + 50)));
    const history = historyFrom(many);
    expect(history).toHaveLength(MAX_HISTORY_TURNS);
    expect(history[0]).toMatchObject({ role: "user", text: "q2" });
    expect(history[1].text).toHaveLength(MAX_TURN_CHARS);
  });

  it("carries the newest session forward", () => {
    expect(latestSession([])).toBeNull();
    expect(latestSession([answered("1", "a", "b"), failed("2", "c")])).toEqual(session);
  });

  it("never sends anything from a recorded exchange", () => {
    const replayed: Exchange = {
      ...answered("r", "Why do the replayed acts clash?", "Recorded answer.", {
        session: { timetable: [{ act_id: "zz", day: 0, stage_id: "s9", start: 1, end: 2 }], constraints: { x: 1 }, rules: ["Recorded rule"] },
      }),
      recorded: true,
    };
    expect(historyFrom([replayed])).toEqual([]);
    expect(latestSession([replayed])).toBeNull();
    expect(buildClashBody("glasto-sun", "Why?", [replayed])).toEqual({
      scenario: "clash",
      input: { preset_id: "glasto-sun", message: "Why?", history: [] },
    });

    // Around live exchanges, a replay is skipped: the live session and turns are sent as they are.
    const exchanges = [answered("1", "a", "b"), replayed, answered("2", "c", "d")];
    expect(historyFrom(exchanges).map((turn) => turn.text)).toEqual(["a", "b", "c", "d"]);
    expect(latestSession([answered("1", "a", "b"), replayed])).toEqual(session);
    const body = buildClashBody("glasto-sun", "Next?", [answered("1", "a", "b"), replayed]);
    expect(body.input).toMatchObject({ timetable: session.timetable, constraints: session.constraints, rules: session.rules });
    expect(JSON.stringify(body)).not.toMatch(/Recorded|replayed|zz/);
  });

  it("builds the first and the follow-up request bodies", () => {
    expect(buildClashBody("glasto-sun", "  Why?  ", [])).toEqual({
      scenario: "clash",
      input: { preset_id: "glasto-sun", message: "Why?", history: [] },
    });
    const body = buildClashBody("glasto-sun", "y".repeat(MAX_MESSAGE_CHARS + 10), [answered("1", "a", "b")]);
    expect(body.input.message).toHaveLength(MAX_MESSAGE_CHARS);
    expect(body.input).toMatchObject({ timetable: session.timetable, rules: session.rules });
    expect(body.input.history).toHaveLength(2);
  });
});

describe("suggestedPrompts", () => {
  const clash = (rank: number, day: number, a: string, b: string): PairClash =>
    ({
      rank,
      day,
      a: { act_id: a, name: a, stage_id: "s1", genre: null },
      b: { act_id: b, name: b, stage_id: "s2", genre: null },
      regret: 1 / rank,
    }) as PairClash;

  it("names the day's costliest clash", () => {
    const prompts = suggestedPrompts([clash(2, 0, "C", "D"), clash(1, 0, "A", "B"), clash(1, 1, "E", "F")], 0);
    expect(prompts[0]).toBe("Why do A and B clash?");
    expect(prompts[1]).toBe("Where could B go instead?");
  });

  it("skips clashes where both sets are locked and never asks to move a locked set", () => {
    const locked = new Set(["A", "B", "D"]);
    const prompts = suggestedPrompts([clash(1, 0, "A", "B"), clash(2, 0, "C", "D")], 0, (id) => locked.has(id));
    expect(prompts[0]).toBe("Why do C and D clash?");
    expect(prompts[1]).toBe("Where could C go instead?");
    expect(prompts[2]).toContain("Keep D where it is");
  });

  it("falls back to general questions when the day has no clash", () => {
    expect(suggestedPrompts([], 0)).toHaveLength(2);
  });

  it("asks about the clash the hero button opens: a hidden clash with tags", () => {
    const tag = { name: "Indie rock", kind: "genre", score: 0.9 };
    const evidence: Evidence = {
      hidden_wall: [],
      hidden_wall_total: 0,
      twins: [],
      receipts: { "A|B": { shared_tags: [], press: null }, "C|D": { shared_tags: [tag], press: null }, "E|F": { shared_tags: [tag], press: null } },
    };
    const clashes = [clash(1, 0, "A", "B"), clash(2, 0, "C", "D"), { ...clash(3, 0, "E", "F"), label: "hidden" as const }];
    const prompts = suggestedPrompts(clashes, 0, () => false, evidence);
    expect(prompts[0]).toBe("Why do E and F clash?");
    expect(prompts[1]).toBe("Where could F go instead?");
    expect(prompts[2]).toBe("Keep E where it is. Which clash should I fix first?");
    // Without evidence it is the costliest clash, as before.
    expect(suggestedPrompts(clashes, 0)[0]).toBe("Why do A and B clash?");
  });
});

describe("budgetDelta", () => {
  it("compares the one-decimal readings the cards print", () => {
    expect(budgetDelta(116.71, 114.26)).toBe(-2.4);
    expect(budgetDelta(116.71, 116.06)).toBe(-0.6);
    expect(budgetDelta(117.4, 98.2)).toBe(-19.2);
    expect(budgetDelta(100, 104.6)).toBe(4.6);
    expect(budgetDelta(114.26, 114.3)).toBe(0);
    expect(budgetDelta(null, 3)).toBeNull();
    expect(budgetDelta(3, null)).toBeNull();
  });

  it("is the difference of the two figures as toFixed(1) prints them, never of a second rounding", () => {
    // 111.85 prints as 111.8, so 116.7 to 111.8 is 4.9 lower, not 4.8.
    expect((111.85).toFixed(1)).toBe("111.8");
    expect(budgetDelta(116.71, 111.85)).toBe(-4.9);
    for (const [before, after] of [
      [116.71, 111.85],
      [104.25, 99.35],
      [88.05, 90.45],
      [100.15, 100.25],
    ]) {
      const printed = Number(after.toFixed(1)) - Number(before.toFixed(1));
      expect(budgetDelta(before, after)).toBe(Math.round(printed * 10) / 10);
    }
  });
});

describe("changeLabel", () => {
  it("says the direction in a word, never with a sign", () => {
    expect(changeLabel(-2.4)).toBe("2.4 lower");
    expect(changeLabel(0.6)).toBe("0.6 higher");
    expect(changeLabel(-19.2)).toBe("19.2 lower");
    expect(changeLabel(0)).toBe("No change");
    expect(changeLabel(-0)).toBe("No change");
    expect(changeLabel(budgetDelta(116.71, 114.26) ?? 0)).toBe("2.4 lower");
  });
});

describe("humanizeProblem", () => {
  const festival = {
    stages: [
      { id: "main", name: "Main" },
      { id: "big-top", name: "Big Top Stage" },
      { id: "park", name: "The Park" },
    ],
    days: ["Sun"],
  };

  it("names the stage and day the way the page does", () => {
    expect(
      humanizeProblem(
        "That change is not possible: 'Act One' and 'Act Two' overlap on stage 'main', day 0 (15:00-15:45 vs 15:30-16:15)",
        festival,
      ),
    ).toBe("Act One and Act Two would overlap on the Main stage (Sunday, 15:00–15:45 vs 15:30–16:15)");
    expect(
      humanizeProblem("'Act One' and 'Act Two' overlap on stage 'big-top', day 0 (15:00-15:45 vs 15:30-16:15)", festival),
    ).toBe("Act One and Act Two would overlap on the Big Top Stage (Sunday, 15:00–15:45 vs 15:30–16:15)");
    expect(
      humanizeProblem("'Act One' and 'Act Two' overlap on stage 'park', day 0 (15:00-15:45 vs 15:30-16:15)", festival),
    ).toBe("Act One and Act Two would overlap on The Park stage (Sunday, 15:00–15:45 vs 15:30–16:15)");
  });

  it("reads names the engine quoted with double quotes or escapes", () => {
    expect(
      humanizeProblem(
        String.raw`That change is not possible: "Act's One" and 'Act \'Two\'' overlap on stage 'main', day 0 (15:00-15:45 vs 15:30-16:15)`,
        festival,
      ),
    ).toBe("Act's One and Act 'Two' would overlap on the Main stage (Sunday, 15:00–15:45 vs 15:30–16:15)");
  });

  it("falls back when the stage or the day is not listed", () => {
    expect(
      humanizeProblem(
        "That change is not possible: 'Act One' and 'Act Two' overlap on stage 'nowhere', day 2 (15:00-15:45 vs 15:30-16:15)",
        festival,
      ),
    ).toBe("Act One and Act Two would overlap on the same stage (Day 3, 15:00–15:45 vs 15:30–16:15)");
  });

  it("only drops the lead-in from any other text", () => {
    expect(humanizeProblem("That change is not possible: Act One cannot end after 26:00.", festival)).toBe(
      "Act One cannot end after 26:00.",
    );
    expect(humanizeProblem("Keep Act One and Act Two apart.", festival)).toBe("Keep Act One and Act Two apart.");
    expect(humanizeProblem("", festival)).toBe("");
  });
});

describe("textBlocks", () => {
  it("splits paragraphs and bullet or numbered lists", () => {
    expect(textBlocks("First line\nsame paragraph.\n\n- one\n- **two**\n1. a\n2. b\nAfter.")).toEqual([
      { kind: "paragraph", segments: [{ text: "First line same paragraph.", strong: false }] },
      {
        kind: "list",
        ordered: false,
        items: [[{ text: "one", strong: false }], [{ text: "two", strong: true }]],
      },
      { kind: "list", ordered: true, items: [[{ text: "a", strong: false }], [{ text: "b", strong: false }]] },
      { kind: "paragraph", segments: [{ text: "After.", strong: false }] },
    ]);
  });

  it("drops heading marks and empty input", () => {
    expect(textBlocks("## Verdict\n")).toEqual([{ kind: "paragraph", segments: [{ text: "Verdict", strong: false }] }]);
    expect(textBlocks("")).toEqual([]);
  });

  it("keeps bold runs inside a line", () => {
    expect(inlineSegments("Move **Act Two** to 22:15.")).toEqual([
      { text: "Move ", strong: false },
      { text: "Act Two", strong: true },
      { text: " to 22:15.", strong: false },
    ]);
  });
});
