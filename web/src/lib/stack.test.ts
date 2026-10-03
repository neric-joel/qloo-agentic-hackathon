import { afterEach, describe, expect, it, vi } from "vitest";

import type { SetSlot } from "./preset";
import {
  MAX_STACK,
  applyMoves,
  briefHref,
  decodeMoves,
  encodeMoves,
  fetchPlan,
  ghostSlot,
  isPlanRuleStep,
  isRuleStackStep,
  isSafeId,
  moveCount,
  movedActs,
  parsePlan,
  placedLine,
  planAnnouncement,
  planBody,
  planPreview,
  planStarters,
  planStorageKey,
  rangeVerdict,
  readStoredMoves,
  requestPlan,
  ruleReceipt,
  ruleStepLine,
  sameRuleStep,
  shiftText,
  stepMoves,
  storeMoves,
  type PlanRuleStep,
  type PlanStep,
  type RuleStackStep,
  type StackMove,
} from "./stack";

/** Synthetic moves on an invented day. */
const one: StackMove = { actId: "act-one", stageId: "west-stage", day: 0, start: "20:30" };
const two: StackMove = { actId: "act-two", stageId: "east-stage", day: 0, start: "9:05" };
const late: StackMove = { actId: "act.three", stageId: "tent_2", day: 1, start: "25:15" };

function step(extra: Partial<Record<string, unknown>> = {}) {
  return {
    act: "Act One",
    act_id: "act-one",
    move: "Act One: West Stage 20:00-21:00 -> West Stage 20:30-21:30",
    stage: "West Stage",
    stage_id: "west-stage",
    day: 0,
    start: "20:30",
    end: "21:30",
    budget_after: 110.2,
    ...extra,
  };
}

function options(actId = "act-two") {
  return {
    kind: "move_options",
    act: "Act Two",
    act_id: actId,
    from: "East Stage 15:00-15:45",
    movable: true,
    why: null,
    clash_budget_before: 110.2,
    legal_places: 3,
    priced: true,
    clashes_now: [{ with: "Act Three", points: 1.4 }],
    options: [
      {
        move: "Act Two: East Stage 15:00-15:45 -> East Stage 15:30-16:15",
        stage: "East Stage",
        stage_id: "east-stage",
        start: "15:30",
        end: "16:15",
        day: 0,
        clash_budget_after: 108.9,
        clashes_after: [],
      },
    ],
  };
}

function body(extra: Record<string, unknown> = {}, plan: Record<string, unknown> = {}) {
  return {
    kind: "whatif",
    published_budget: 116.71,
    plan: {
      budget: 110.2,
      steps: [step()],
      clashes: [{ a: "Act Three", b: "Act Four", points: 7.4 }],
      ...plan,
    },
    options: null,
    ...extra,
  };
}

describe("encodeMoves and decodeMoves", () => {
  it("round trips, keeping the order and the times as written", () => {
    const moves = [one, two, late];
    const encoded = encodeMoves(moves);
    expect(encoded).toBe("act-one~west-stage~0~2030,act-two~east-stage~0~905,act.three~tent_2~1~2515");
    expect(decodeMoves(encoded)).toEqual(moves);
    expect(decodeMoves(encodeMoves([]))).toEqual([]);
    expect(decodeMoves(encodeMoves([{ ...one, start: "09:05" }]))).toEqual([{ ...one, start: "09:05" }]);
  });

  it("holds eight moves and refuses a ninth", () => {
    const eight = Array.from({ length: MAX_STACK }, (_, i) => ({ ...one, actId: `act-${i}` }));
    expect(decodeMoves(encodeMoves(eight))).toEqual(eight);
    expect(decodeMoves(encodeMoves([...eight, { ...one, actId: "act-9" }]))).toEqual([]);
  });

  it("gives an empty plan for anything malformed, and never throws", () => {
    const broken: unknown[] = [
      null,
      undefined,
      "",
      ",",
      "act-one",
      "act-one~west-stage~0",
      "act-one~west-stage~0~2030~extra",
      "act-one~west-stage~0~2090",
      "act-one~west-stage~0~20:30",
      "act-one~west-stage~x~2030",
      "act-one~west-stage~14~2030",
      "act-one~west-stage~-1~2030",
      "act-one~west-stage~0~12345",
      "act one~west-stage~0~2030",
      "act-one~west-stage~0~2030,",
      `${encodeMoves([one])},garbage`,
      // A set listed twice.
      encodeMoves([one, { ...one, start: "21:00" }]),
      // Traversal and other path tricks.
      "..~west-stage~0~2030",
      "act-one~.~0~2030",
      "../../etc/passwd~west-stage~0~2030",
      "act-one~..%2F..%2Fapi~0~2030",
      "act-one~west/stage~0~2030",
      // A 200-character field.
      `${"a".repeat(200)}~west-stage~0~2030`,
      "act-\u0000one~west-stage~0~2030",
      "act-é~west-stage~0~2030",
      "x".repeat(5000),
      42,
      {},
    ];
    for (const item of broken) {
      expect(() => decodeMoves(item as string)).not.toThrow();
      expect(decodeMoves(item as string)).toEqual([]);
    }
    // An 80-character field is the longest allowed.
    const long = { ...one, actId: "a".repeat(80) };
    expect(decodeMoves(encodeMoves([long]))).toEqual([long]);
    expect(decodeMoves(encodeMoves([{ ...one, actId: "a".repeat(81) }]))).toEqual([]);
  });

  it("knows a safe id", () => {
    expect(isSafeId("glastonbury-2025-sun")).toBe(true);
    expect(isSafeId("riot_fest.2025")).toBe(true);
    expect(isSafeId("..")).toBe(false);
    expect(isSafeId("a/b")).toBe(false);
    expect(isSafeId("")).toBe(false);
    expect(isSafeId(null)).toBe(false);
  });
});

describe("planBody", () => {
  it("sends only the moves, the set and the limit, with the server's field names", () => {
    const parsed = JSON.parse(planBody([one, two], "act-five", 8));
    expect(Object.keys(parsed)).toEqual(["moves", "act", "limit"]);
    expect(parsed.moves).toEqual([
      { act: "act-one", stage_id: "west-stage", day: 0, start: "20:30" },
      { act: "act-two", stage_id: "east-stage", day: 0, start: "9:05" },
    ]);
    expect(Object.keys(parsed.moves[0])).toEqual(["act", "stage_id", "day", "start"]);
    expect(parsed.act).toBe("act-five");
    expect(parsed.limit).toBe(8);
  });

  it("sends a null set when none is picked, and the default limit", () => {
    expect(JSON.parse(planBody([one], null))).toEqual({
      moves: [{ act: "act-one", stage_id: "west-stage", day: 0, start: "20:30" }],
      act: null,
      limit: 8,
    });
  });
});

describe("parsePlan", () => {
  it("reads a valid answer", () => {
    expect(parsePlan(body())).toEqual({
      publishedBudget: 116.71,
      budget: 110.2,
      steps: [
        {
          act: "Act One",
          actId: "act-one",
          move: "Act One: West Stage 20:00-21:00 -> West Stage 20:30-21:30",
          stage: "West Stage",
          stageId: "west-stage",
          day: 0,
          start: "20:30",
          end: "21:30",
          budgetAfter: 110.2,
        },
      ],
      clashes: [{ a: "Act Three", b: "Act Four", points: 7.4 }],
      options: null,
    });
  });

  it("reads an empty plan and the picked set's places on top of a plan", () => {
    const empty = parsePlan(body({}, { budget: 116.71, steps: [], clashes: [] }));
    expect(empty?.steps).toEqual([]);
    expect(empty?.budget).toBe(116.71);
    const withPlaces = parsePlan(body({ options: options() }));
    expect(withPlaces?.options?.actId).toBe("act-two");
    expect(withPlaces?.options?.before).toBe(110.2);
    expect(withPlaces?.options?.priced).toBe(true);
    expect(withPlaces?.options?.options).toHaveLength(1);
  });

  it("refuses anything the page would print wrongly, and never throws", () => {
    const broken: unknown[] = [
      null,
      undefined,
      "whatif",
      42,
      [],
      {},
      body({ kind: "move_options" }),
      body({ published_budget: undefined }),
      body({ published_budget: "116.7" }),
      body({ published_budget: Number.POSITIVE_INFINITY }),
      body({ plan: null }),
      body({}, { budget: Number.NaN }),
      body({}, { budget: null }),
      body({}, { steps: undefined }),
      body({}, { steps: "none" }),
      body({}, { clashes: undefined }),
      body({}, { steps: [step({ budget_after: Number.NaN })] }),
      body({}, { steps: [step({ act_id: undefined })] }),
      body({}, { steps: [step({ stage: "" })] }),
      body({}, { steps: [step({ day: "0" })] }),
      body({}, { steps: [null] }),
      body({}, { steps: Array.from({ length: MAX_STACK + 1 }, () => step()) }),
      body({}, { clashes: [{ a: "Act Three", b: "Act Four" }] }),
      body({}, { clashes: [{ a: "", b: "Act Four", points: 1 }] }),
      body({}, { clashes: [{ a: "Act Three", b: "Act Four", points: Number.NaN }] }),
      body({ options: { kind: "move_options" } }),
      body({ options: "places" }),
    ];
    for (const item of broken) {
      expect(() => parsePlan(item)).not.toThrow();
      expect(parsePlan(item)).toBeNull();
    }
    const hostile = Object.defineProperty({}, "kind", {
      get() {
        throw new Error("boom");
      },
    });
    expect(parsePlan(hostile)).toBeNull();
  });
});

describe("rangeVerdict", () => {
  const range = { low: 92.2, high: 108.6 };

  it("says below, inside or above, comparing the figures as the page prints them", () => {
    expect(rangeVerdict(116.7, range)).toBe("above");
    expect(rangeVerdict(103.3, range)).toBe("inside");
    expect(rangeVerdict(91.0, range)).toBe("below");
    // The range prints as 92 to 109: 108.8 reads inside it, 109.1 above it, 91.96 (92.0) inside.
    expect(rangeVerdict(108.8, range)).toBe("inside");
    expect(rangeVerdict(109.1, range)).toBe("above");
    expect(rangeVerdict(91.96, range)).toBe("inside");
    expect(rangeVerdict(91.9, range)).toBe("below");
  });

  it("is null without a range or a number", () => {
    expect(rangeVerdict(100, null)).toBeNull();
    expect(rangeVerdict(Number.NaN, range)).toBeNull();
    expect(rangeVerdict(100, { low: Number.NaN, high: 108 })).toBeNull();
  });
});

describe("planAnnouncement", () => {
  it("says what a priced plan does, from the server's two readings", () => {
    expect(planAnnouncement({ publishedBudget: 116.71, budget: 106.62 }, 2)).toBe(
      "Plan: 2 kept moves. Clash Budget Index 116.7 to 106.6, 10.1 lower.",
    );
    expect(planAnnouncement({ publishedBudget: 116.71, budget: 117.33 }, 1)).toBe(
      "Plan: 1 kept move. Clash Budget Index 116.7 to 117.3, 0.6 higher.",
    );
    expect(planAnnouncement({ publishedBudget: 116.71, budget: 116.74 }, 1)).toBe(
      "Plan: 1 kept move. Clash Budget Index 116.7 to 116.7, no change.",
    );
  });

  it("says the plan is cleared with no moves, and nothing while it is being priced", () => {
    expect(planAnnouncement(null, 0)).toBe("Plan cleared.");
    expect(planAnnouncement({ publishedBudget: 116.71, budget: 106.62 }, 0)).toBe("Plan cleared.");
    expect(planAnnouncement(null, 3)).toBe("");
  });
});

describe("shiftText", () => {
  const from = { day: 0, start: 1200, end: 1260 };
  const at = (start: string, stage = "West Stage", day = 0): PlanStep => ({
    act: "Act One",
    actId: "act-one",
    move: "",
    stage,
    stageId: "west-stage",
    day,
    start,
    end: "21:30",
    budgetAfter: 110.2,
  });

  it("says how far a set shifts on its own stage", () => {
    expect(shiftText(from, at("20:30"), "West Stage")).toBe("30 minutes later, same stage");
    expect(shiftText(from, at("19:15"), "West Stage")).toBe("45 minutes earlier, same stage");
    expect(shiftText(from, at("20:01"), "West Stage")).toBe("1 minute later, same stage");
    expect(shiftText(from, at("19:59"), "West Stage")).toBe("1 minute earlier, same stage");
    expect(shiftText({ day: 0, start: 1530, end: 1590 }, at("25:00"), "West Stage")).toBe(
      "30 minutes earlier, same stage",
    );
  });

  it("names the stage and time for a move to another stage or day, or from an unknown place", () => {
    expect(shiftText(from, at("20:30", "The Park"), "West Stage")).toBe("Moves to The Park, 20:30");
    expect(shiftText(from, at("20:30", "West Stage", 1), "West Stage")).toBe("Moves to West Stage, 20:30");
    expect(shiftText(null, at("20:30"), "West Stage")).toBe("Moves to West Stage, 20:30");
  });
});

describe("briefHref", () => {
  it("links the brief with and without moves", () => {
    expect(briefHref("example-sun", 0, [])).toBe("/brief?preset=example-sun&day=0");
    const href = briefHref("example-sun", 1, [one, two]);
    expect(href).toBe(
      "/brief?preset=example-sun&day=1&moves=act-one~west-stage~0~2030%2Cact-two~east-stage~0~905",
    );
    const params = new URL(href, "http://localhost").searchParams;
    expect(decodeMoves(params.get("moves"))).toEqual([one, two]);
  });

  it("escapes an id that needs it", () => {
    const href = briefHref("fest & day/1?x=2", 0, []);
    expect(href).toBe("/brief?preset=fest%20%26%20day%2F1%3Fx%3D2&day=0");
    expect(new URL(href, "http://localhost").searchParams.get("preset")).toBe("fest & day/1?x=2");
  });
});

describe("planStarters", () => {
  const sets = [
    { actId: "act-one", name: "Act One", locked: false },
    { actId: "act-two", name: "Act Two", locked: true },
    { actId: "act-three", name: "Act Three", locked: false },
    { actId: "act-four", name: "Act Four", locked: false },
    { actId: "act-five", name: "Act Five", locked: false },
    { actId: "act-six", name: "Act Six", locked: false },
  ];

  it("takes the acts of the costliest clashes in order, each once, skipping locked and moved sets", () => {
    const clashes = [
      { a: "Act One", b: "Act Two", points: 9 },
      { a: "Act Three", b: "Act One", points: 7 },
      { a: "Elsewhere", b: "Act Four", points: 5 },
      { a: "Act Five", b: "Act Six", points: 4 },
    ];
    expect(planStarters(clashes, sets, new Set(["act-one"]))).toEqual([
      { actId: "act-three", name: "Act Three" },
      { actId: "act-four", name: "Act Four" },
      { actId: "act-five", name: "Act Five" },
      { actId: "act-six", name: "Act Six" },
    ]);
    expect(planStarters(clashes, sets, new Set(), 2)).toEqual([
      { actId: "act-one", name: "Act One" },
      { actId: "act-three", name: "Act Three" },
    ]);
    expect(planStarters([], sets, new Set())).toEqual([]);
  });
});

describe("ghost slots", () => {
  const timetable: SetSlot[] = [
    { act_id: "act-one", day: 0, stage_id: "west-stage", start: 1200, end: 1260, locked: false },
    { act_id: "act-two", day: 0, stage_id: "east-stage", start: 900, end: 945, locked: false },
  ];

  it("draws a kept move at its new place with its published length", () => {
    expect(ghostSlot(timetable, one)).toEqual({ actId: "act-one", stageId: "west-stage", day: 0, start: 1230, end: 1290 });
    expect(ghostSlot(timetable, { ...one, actId: "nobody" })).toBeNull();
  });

  it("moves the kept sets in a copy of the timetable and leaves the published one alone", () => {
    const moved = applyMoves(timetable, [{ ...two, stageId: "west-stage", start: "20:00" }]);
    expect(moved).toEqual([
      timetable[0],
      { act_id: "act-two", day: 0, stage_id: "west-stage", start: 1200, end: 1245, locked: false },
    ]);
    expect(timetable[1].start).toBe(900);
    expect(applyMoves(timetable, [])).toEqual(timetable);
    expect(applyMoves(timetable, [{ ...one, actId: "nobody" }])).toEqual(timetable);
  });

  it("is null with nothing kept and nothing tried", () => {
    expect(planPreview(timetable, [], null)).toBeNull();
    const trying = { actId: "act-two", stageId: "east-stage", day: 0, start: 930, end: 975 };
    expect(planPreview(timetable, [], trying)).toEqual({ kept: [], trying });
    expect(planPreview(timetable, [one], null)?.kept).toHaveLength(1);
  });
});

describe("plan storage", () => {
  function memory() {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
  }

  it("keeps a plan per preset and drops an empty one", () => {
    const storage = memory();
    storeMoves("example-sun", [one, two], storage);
    expect(storage.items.get(planStorageKey("example-sun"))).toBe(encodeMoves([one, two]));
    expect(readStoredMoves("example-sun", storage)).toEqual([one, two]);
    expect(readStoredMoves("other-day", storage)).toEqual([]);
    storeMoves("example-sun", [], storage);
    expect(storage.items.has(planStorageKey("example-sun"))).toBe(false);
  });

  it("ignores what it cannot read and never throws", () => {
    const storage = memory();
    storage.items.set(planStorageKey("example-sun"), "../../x~y~0~2030");
    expect(readStoredMoves("example-sun", storage)).toEqual([]);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredMoves("example-sun", blocked)).toEqual([]);
    expect(() => storeMoves("example-sun", [one], blocked)).not.toThrow();
    expect(readStoredMoves("example-sun", null)).toEqual([]);
  });
});

describe("requestPlan and fetchPlan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answer(status: number, json: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(json), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts the plan as JSON and reads the answer", async () => {
    const fetchMock = answer(200, body({ options: options() }));
    const result = await requestPlan("example-sun", [one], "act-two");
    expect(result.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/presets/example-sun/whatif");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      moves: [{ act: "act-one", stage_id: "west-stage", day: 0, start: "20:30" }],
      act: "act-two",
      limit: 8,
    });
  });

  it("calls a refused plan invalid and anything else an error", async () => {
    answer(422, { detail: "Step 1 is not a legal place for that set after the steps before it." });
    expect(await requestPlan("example-sun", [one], null)).toEqual({ status: "invalid" });
    answer(429, { detail: "Too many what-if requests this hour. Please try again later." });
    expect(await requestPlan("example-sun", [one], null)).toEqual({ status: "error" });
    answer(500, {});
    expect(await fetchPlan("example-sun", [one], null)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await requestPlan("example-sun", [one], null)).toEqual({ status: "error" });
  });

  it("refuses an answer about another plan or another set", async () => {
    answer(200, body({ options: options("act-six") }));
    expect(await requestPlan("example-sun", [one], "act-two")).toEqual({ status: "error" });
    answer(200, body());
    expect(await requestPlan("example-sun", [two], null)).toEqual({ status: "error" });
    answer(200, body());
    expect(await requestPlan("example-sun", [one, two], null)).toEqual({ status: "error" });
    answer(200, body());
    expect((await fetchPlan("example-sun", [one], null))?.budget).toBe(110.2);
  });

  it("sends nothing for an unsafe preset id", async () => {
    const fetchMock = answer(200, body());
    expect(await requestPlan("../runs", [one], null)).toEqual({ status: "error" });
    expect(await requestPlan("example-sun", [one], "../x")).toEqual({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------------- rule steps

/** Synthetic: a kept change that moves Act Two and Act Three to keep Act Four and Act Five apart. */
const change: RuleStackStep = {
  rule: { aId: "act-four", bId: "act-five" },
  moves: [
    { actId: "act-two", stageId: "east-stage", day: 0, start: "15:00" },
    { actId: "act-three", stageId: "west-stage", day: 0, start: "9:45" },
  ],
};
const single: RuleStackStep = {
  rule: { aId: "act.four", bId: "act_five" },
  moves: [{ actId: "act-two", stageId: "east-stage", day: 1, start: "15:00" }],
};

function ruleStep(extra: Partial<Record<string, unknown>> = {}) {
  return {
    rule: { a: { act_id: "act-four", act: "Act Four" }, b: { act_id: "act-five", act: "Act Five" } },
    moves: [
      {
        act: "Act Two",
        act_id: "act-two",
        move: "Act Two: East Stage 14:00-15:00 -> East Stage 15:00-16:00",
        stage: "East Stage",
        stage_id: "east-stage",
        day: 0,
        start: "15:00",
        end: "16:00",
      },
      {
        act: "Act Three",
        act_id: "act-three",
        move: "Act Three: West Stage 15:15-16:00 -> West Stage 9:45-10:30",
        stage: "West Stage",
        stage_id: "west-stage",
        day: 0,
        start: "9:45",
        end: "10:30",
      },
    ],
    budget_after: 108.4,
    rule_holds_after: true,
    new_breaks: 0,
    ...extra,
  };
}

describe("rule steps in a link", () => {
  it("round trips a two-set and a one-set change between single moves", () => {
    const steps = [one, change, single, two];
    const encoded = encodeMoves(steps);
    expect(encoded).toBe(
      "act-one~west-stage~0~2030,r~act-four~act-five~act-two~east-stage~0~1500|act-three~west-stage~0~945," +
        "r~act.four~act_five~act-two~east-stage~1~1500,act-two~east-stage~0~905",
    );
    expect(decodeMoves(encoded)).toEqual(steps);
  });

  it("reads a link made before rule steps existed exactly as it did", () => {
    const old = "act-one~west-stage~0~2030,act-two~east-stage~0~905,act.three~tent_2~1~2515";
    expect(decodeMoves(old)).toEqual([one, two, late]);
    // A set whose id is r is still a single move.
    expect(decodeMoves("r~west-stage~0~2030")).toEqual([{ actId: "r", stageId: "west-stage", day: 0, start: "20:30" }]);
  });

  it("counts a two-set change as two of the eight moves", () => {
    expect(moveCount([one, change, single])).toBe(4);
    const six = Array.from({ length: 6 }, (_, i) => ({ ...one, actId: `act-${i}` }));
    expect(decodeMoves(encodeMoves([...six, change]))).toEqual([...six, change]);
    expect(decodeMoves(encodeMoves([...six, change, { ...one, actId: "act-9" }]))).toEqual([]);
    expect(decodeMoves(encodeMoves([...six, single, { ...one, actId: "act-8" }]))).toHaveLength(8);
    expect(decodeMoves(encodeMoves([...six, { ...one, actId: "act-7" }, change]))).toEqual([]);
  });

  it("lets a change move a set an earlier single move moved, but not a set twice in one step", () => {
    const hero = { actId: "act-two", stageId: "east-stage", day: 0, start: "14:15" };
    expect(decodeMoves(encodeMoves([hero, change]))).toEqual([hero, change]);
    const twice = { ...change, moves: [change.moves[0], { ...change.moves[0], start: "16:00" }] };
    expect(decodeMoves(encodeMoves([twice]))).toEqual([]);
    // Two single moves of one set are still refused.
    expect(decodeMoves(encodeMoves([hero, { ...hero, start: "16:00" }]))).toEqual([]);
  });

  it("gives an empty plan for a malformed rule step, and never throws", () => {
    const m1 = "act-two~east-stage~0~1500";
    const m2 = "act-three~west-stage~0~945";
    const broken = [
      "r~act-four~act-five",
      "r~act-four~act-five~",
      `r~act-four~act-five~${m1}|`,
      `r~act-four~act-five~${m1}|${m2}|${m2}`,
      `r~act-four~act-four~${m1}`,
      `r~..~act-five~${m1}`,
      `r~act-four~a/b~${m1}`,
      `r~act-four~act-five~${m1}|act-two~west-stage~0~1600`,
      "r~act-four~act-five~act-two~east-stage~14~1500",
      "r~act-four~act-five~act-two~east-stage~0~15:00",
      `x~act-four~act-five~${m1}`,
      `r~act-four~act-five~${m1}|${m2}~extra`,
      `r~${"a".repeat(81)}~act-five~${m1}`,
      `${m1}|${m2}`,
      `r~act-four~act-five~${m1},`,
    ];
    for (const item of broken) {
      expect(() => decodeMoves(item)).not.toThrow();
      expect(decodeMoves(item)).toEqual([]);
    }
  });

  it("knows a rule step from a single move and lists every moved set once", () => {
    expect(isRuleStackStep(change)).toBe(true);
    expect(isRuleStackStep(one)).toBe(false);
    expect(stepMoves(one)).toEqual([one]);
    expect(stepMoves(change)).toEqual(change.moves);
    expect([...movedActs([{ ...one, actId: "act-two" }, change])].sort()).toEqual(["act-three", "act-two"]);
    expect(sameRuleStep(change, { ...change, moves: [...change.moves] })).toBe(true);
    expect(sameRuleStep(change, single)).toBe(false);
    expect(sameRuleStep(change, { ...change, moves: [change.moves[1], change.moves[0]] })).toBe(false);
  });

  it("links the brief with the encoded rule step", () => {
    const href = briefHref("example-sun", 0, [one, change]);
    const params = new URL(href, "http://localhost").searchParams;
    expect(decodeMoves(params.get("moves"))).toEqual([one, change]);
  });
});

describe("planBody with rule steps", () => {
  it("sends a rule step as the contract words it and a single move as before", () => {
    const parsed = JSON.parse(planBody([one, change, single], null, 8));
    expect(parsed.moves[0]).toEqual({ act: "act-one", stage_id: "west-stage", day: 0, start: "20:30" });
    expect(parsed.moves[1]).toEqual({
      rule: { a: "act-four", b: "act-five" },
      moves: [
        { act: "act-two", stage_id: "east-stage", day: 0, start: "15:00" },
        { act: "act-three", stage_id: "west-stage", day: 0, start: "9:45" },
      ],
    });
    expect(Object.keys(parsed.moves[1])).toEqual(["rule", "moves"]);
    expect(parsed.moves[2].moves).toHaveLength(1);
    expect(Object.keys(parsed)).toEqual(["moves", "act", "limit"]);
  });
});

describe("parsePlan with rule steps", () => {
  it("reads a rule step with its receipt, between single moves", () => {
    const plan = parsePlan(body({}, { steps: [step(), ruleStep()] }));
    expect(plan?.steps).toHaveLength(2);
    const second = plan?.steps[1];
    expect(second && isPlanRuleStep(second)).toBe(true);
    expect(plan?.steps[0] && isPlanRuleStep(plan.steps[0])).toBe(false);
    expect(second).toEqual({
      rule: { a: { actId: "act-four", act: "Act Four" }, b: { actId: "act-five", act: "Act Five" } },
      moves: [
        {
          act: "Act Two",
          actId: "act-two",
          move: "Act Two: East Stage 14:00-15:00 -> East Stage 15:00-16:00",
          stage: "East Stage",
          stageId: "east-stage",
          day: 0,
          start: "15:00",
          end: "16:00",
        },
        {
          act: "Act Three",
          actId: "act-three",
          move: "Act Three: West Stage 15:15-16:00 -> West Stage 9:45-10:30",
          stage: "West Stage",
          stageId: "west-stage",
          day: 0,
          start: "9:45",
          end: "10:30",
        },
      ],
      budgetAfter: 108.4,
      ruleHoldsAfter: true,
      newBreaks: 0,
    });
  });

  it("refuses a rule step the page would print wrongly, and never throws", () => {
    const broken = [
      ruleStep({ rule: null }),
      ruleStep({ rule: { a: { act_id: "act-four", act: "Act Four" } } }),
      ruleStep({ rule: { a: { act_id: "", act: "Act Four" }, b: { act_id: "act-five", act: "Act Five" } } }),
      ruleStep({ moves: [] }),
      ruleStep({ moves: "none" }),
      ruleStep({ moves: [...ruleStep().moves, ...ruleStep().moves] }),
      ruleStep({ moves: [{ ...ruleStep().moves[0], stage: "" }] }),
      ruleStep({ moves: [null] }),
      ruleStep({ budget_after: Number.NaN }),
      ruleStep({ budget_after: undefined }),
      ruleStep({ rule_holds_after: "true" }),
      ruleStep({ rule_holds_after: undefined }),
      ruleStep({ new_breaks: -1 }),
      ruleStep({ new_breaks: 1.5 }),
      ruleStep({ new_breaks: "0" }),
      ruleStep({ new_breaks: undefined }),
    ];
    for (const item of broken) {
      expect(() => parsePlan(body({}, { steps: [item] }))).not.toThrow();
      expect(parsePlan(body({}, { steps: [item] }))).toBeNull();
    }
  });
});

describe("words for a rule step", () => {
  const priced = parsePlan(body({}, { steps: [ruleStep()] }))?.steps[0] as PlanRuleStep;

  it("reads a placed set and the whole step on one line", () => {
    expect(placedLine(priced.moves[0])).toBe("Act Two → East Stage 15:00–16:00");
    expect(ruleStepLine(priced)).toBe(
      "Keep Act Four and Act Five apart: Act Two → East Stage 15:00–16:00; Act Three → West Stage 9:45–10:30",
    );
  });

  it("words the receipt from the two facts the server sends", () => {
    expect(ruleReceipt({ ruleHoldsAfter: true, newBreaks: 0 })).toBe(
      "After this plan they share no time, and the plan adds no rule break.",
    );
    expect(ruleReceipt({ ruleHoldsAfter: false, newBreaks: 0 })).toBe("After this plan they still share time.");
    expect(ruleReceipt({ ruleHoldsAfter: true, newBreaks: 1 })).toBe("The plan adds 1 rule break.");
    expect(ruleReceipt({ ruleHoldsAfter: true, newBreaks: 3 })).toBe("The plan adds 3 rule breaks.");
    expect(ruleReceipt({ ruleHoldsAfter: false, newBreaks: 2 })).toBe(
      "The plan adds 2 rule breaks. After this plan they still share time.",
    );
  });

  it("announces a plan with a kept change as steps, with the receipt", () => {
    const text = planAnnouncement({ publishedBudget: 116.71, budget: 111.85, steps: [priced] }, 1);
    expect(text).toBe(
      "Plan: 1 kept step. Clash Budget Index 116.7 to 111.8, 4.8 lower. Act Four and Act Five: After this plan they share no time, and the plan adds no rule break.",
    );
    expect(planAnnouncement({ publishedBudget: 116.71, budget: 106.62, steps: [] }, 2)).toBe(
      "Plan: 2 kept moves. Clash Budget Index 116.7 to 106.6, 10.1 lower.",
    );
  });
});

describe("rule steps on the timetable", () => {
  const timetable: SetSlot[] = [
    { act_id: "act-one", day: 0, stage_id: "west-stage", start: 1200, end: 1260, locked: false },
    { act_id: "act-two", day: 0, stage_id: "east-stage", start: 840, end: 900, locked: false },
    { act_id: "act-three", day: 0, stage_id: "west-stage", start: 915, end: 960, locked: false },
  ];

  it("draws a ghost for every moved set of a change", () => {
    const preview = planPreview(timetable, [change], null);
    expect(preview?.kept).toEqual([
      { actId: "act-two", stageId: "east-stage", day: 0, start: 900, end: 960 },
      { actId: "act-three", stageId: "west-stage", day: 0, start: 585, end: 630 },
    ]);
    expect(applyMoves(timetable, [change])[1]).toMatchObject({ start: 900, end: 960 });
    expect(applyMoves(timetable, [change])[2]).toMatchObject({ start: 585, end: 630 });
  });

  it("draws one ghost per set at the place the last step leaves it", () => {
    const hero: StackMove = { actId: "act-two", stageId: "east-stage", day: 0, start: "14:15" };
    const preview = planPreview(timetable, [hero, change], null);
    expect(preview?.kept.map((ghost) => ghost.actId)).toEqual(["act-two", "act-three"]);
    expect(preview?.kept[0]).toMatchObject({ start: 900 });
    expect(applyMoves(timetable, [hero, change])[1]).toMatchObject({ start: 900 });
  });
});

describe("plan storage and requests with rule steps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps both kinds of step through session storage", () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
    storeMoves("example-sun", [one, change, single], storage);
    expect(readStoredMoves("example-sun", storage)).toEqual([one, change, single]);
  });

  it("posts a rule step and accepts the answer about it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body({}, { steps: [ruleStep()] })), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await requestPlan("example-sun", [change], null);
    expect(result.status).toBe("ready");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).moves[0].rule).toEqual({ a: "act-four", b: "act-five" });
  });

  it("refuses an answer that is about another kind of step or other sets", async () => {
    const reply = (steps: unknown[]) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body({}, { steps })), { status: 200 })));
    };
    reply([step()]);
    expect(await requestPlan("example-sun", [change], null)).toEqual({ status: "error" });
    reply([ruleStep()]);
    expect(await requestPlan("example-sun", [one], null)).toEqual({ status: "error" });
    reply([ruleStep({ rule: { a: { act_id: "act-nine", act: "Act Nine" }, b: { act_id: "act-five", act: "Act Five" } } })]);
    expect(await requestPlan("example-sun", [change], null)).toEqual({ status: "error" });
    reply([ruleStep({ moves: [ruleStep().moves[0]] })]);
    expect(await requestPlan("example-sun", [change], null)).toEqual({ status: "error" });
  });

  it("sends nothing for more than eight moves counted over every step", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...one, actId: `act-${i}` }));
    expect(await requestPlan("example-sun", [...seven, change], null)).toEqual({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
