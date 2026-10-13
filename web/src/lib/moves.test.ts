import { describe, expect, it } from "vitest";

import {
  clashChanges,
  clockMinutes,
  concurrentActs,
  currentPlacement,
  movableSets,
  nextRankedPair,
  parseMoves,
  placementOf,
  startingSets,
} from "./moves";
import type { Festival, PairClash } from "./preset";

/** A synthetic day: three stages, five acts, one of them locked. */
const festival: Festival = {
  id: "example",
  name: "Example Fest, Sun",
  city: null,
  days: ["Sun"],
  stages: [
    { id: "main", name: "Main", tier: 1, hours: [] },
    { id: "tent", name: "Tent", tier: 2, hours: [] },
    { id: "field", name: "Field", tier: 3, hours: [] },
  ],
  acts: [
    { id: "act-one", name: "Act One", qloo_id: "q1", popularity: 0.9, genre: null, billing_tier: 1 },
    { id: "act-two", name: "Act Two", qloo_id: "q2", popularity: 0.8, genre: null, billing_tier: 2 },
    { id: "act-three", name: "Act Three", qloo_id: "q3", popularity: 0.7, genre: null, billing_tier: 2 },
    { id: "act-four", name: "Act Four", qloo_id: "q4", popularity: 0.6, genre: null, billing_tier: 3 },
    { id: "act-five", name: "Act Five", qloo_id: null, popularity: null, genre: null, billing_tier: 4 },
  ],
  timetable: [
    { act_id: "act-four", day: 0, stage_id: "tent", start: 900, end: 945, locked: false },
    { act_id: "act-one", day: 0, stage_id: "main", start: 1200, end: 1290, locked: true },
    { act_id: "act-two", day: 0, stage_id: "tent", start: 1215, end: 1260, locked: false },
    { act_id: "act-three", day: 0, stage_id: "main", start: 960, end: 1020, locked: false },
    { act_id: "act-five", day: 0, stage_id: "field", start: 1230, end: 1275, locked: false },
  ],
};
const preset = { festival };

function body(extra: Record<string, unknown> = {}) {
  return {
    kind: "move_options",
    act: "Act Two",
    act_id: "act-two",
    from: "Tent 20:15-21:00",
    movable: true,
    why: null,
    clash_budget_before: 116.71,
    legal_places: 14,
    searched: "every start on a 5-minute grid in the free time it may use",
    clashes_now: [
      { with: "Act One", points: 2.9 },
      { with: "Act Five", points: 0.4 },
    ],
    options: [
      {
        move: "Act Two: Tent 20:15-21:00 -> Field 15:45-16:30",
        stage: "Field",
        stage_id: "field",
        start: "15:45",
        end: "16:30",
        day: 0,
        clash_budget_after: 113.2,
        clashes_after: [{ with: "Act Three", points: 0.6 }],
      },
      {
        move: "Act Two: Tent 20:15-21:00 -> Field 20:30-21:15",
        stage: "Field",
        stage_id: "field",
        start: "20:30",
        end: "21:15",
        day: 0,
        clash_budget_after: 117.4,
        clashes_after: [],
      },
    ],
    ...extra,
  };
}

function clash(rank: number, a: string, b: string): PairClash {
  const act = (id: string) => ({ act_id: id, name: festival.acts.find((x) => x.id === id)?.name ?? id, stage_id: "main", genre: null });
  return {
    rank,
    a: act(a),
    b: act(b),
    day: 0,
    overlap_minutes: 30,
    concurrency: 1,
    audience_overlap: 0.9,
    draw: 0.8,
    regret: 1,
    regret_share: 0.1,
    label: null,
    confidence: "strong",
  };
}

describe("parseMoves", () => {
  it("reads a valid answer, partner lists included", () => {
    const result = parseMoves(body());
    expect(result).not.toBeNull();
    expect(result?.actId).toBe("act-two");
    expect(result?.act).toBe("Act Two");
    expect(result?.movable).toBe(true);
    expect(result?.before).toBe(116.71);
    expect(result?.legalPlaces).toBe(14);
    expect(result?.clashesNow).toEqual([
      { name: "Act One", points: 2.9 },
      { name: "Act Five", points: 0.4 },
    ]);
    expect(result?.options).toHaveLength(2);
    expect(result?.options[0]).toEqual({
      move: "Act Two: Tent 20:15-21:00 -> Field 15:45-16:30",
      stage: "Field",
      start: "15:45",
      after: 113.2,
      stageId: "field",
      end: "16:30",
      day: 0,
      clashesAfter: [{ name: "Act Three", points: 0.6 }],
    });
    expect(result?.options[1].clashesAfter).toEqual([]);
  });

  it("reads a set that cannot move, with no clashes and no places", () => {
    const result = parseMoves({
      kind: "move_options",
      act: "Act One",
      act_id: "act-one",
      from: "Main 20:00-21:30",
      movable: false,
      why: "locked in place",
      options: [],
    });
    expect(result).toEqual({
      act: "Act One",
      actId: "act-one",
      from: "Main 20:00-21:30",
      movable: false,
      why: "locked in place",
      before: null,
      legalPlaces: 0,
      priced: true,
      clashesNow: [],
      options: [],
    });
  });

  it("reads whether the set is priced, and counts an answer without the field as priced", () => {
    expect(parseMoves(body())?.priced).toBe(true);
    expect(parseMoves(body({ priced: true }))?.priced).toBe(true);
    expect(parseMoves(body({ priced: false }))?.priced).toBe(false);
    expect(parseMoves(body({ priced: "no" }))?.priced).toBe(true);
    const locked = {
      kind: "move_options",
      act: "Act Five",
      act_id: "act-five",
      from: "Field 20:30-21:15",
      movable: false,
      why: "locked in place",
      priced: false,
      options: [],
    };
    expect(parseMoves(locked)?.priced).toBe(false);
    expect(parseMoves({ ...locked, priced: undefined })?.priced).toBe(true);
  });

  it("reads a movable set with no legal place", () => {
    const result = parseMoves(body({ legal_places: 0, options: [] }));
    expect(result?.options).toEqual([]);
    expect(result?.legalPlaces).toBe(0);
  });

  it("refuses anything the page would print wrongly, and never throws", () => {
    const broken: unknown[] = [
      null,
      undefined,
      "move_options",
      42,
      [],
      {},
      body({ kind: "what_if" }),
      body({ act_id: undefined }),
      body({ act: 3 }),
      body({ movable: "yes" }),
      body({ clash_budget_before: null }),
      body({ clash_budget_before: Number.NaN }),
      body({ legal_places: "14" }),
      body({ clashes_now: undefined }),
      body({ clashes_now: [{ with: "Act One" }] }),
      body({ clashes_now: [{ with: "", points: 1 }] }),
      body({ options: "none" }),
      body({ options: [{ ...body().options[0], clash_budget_after: "113.2" }] }),
      body({ options: [{ ...body().options[0], stage_id: undefined }] }),
      body({ options: [{ ...body().options[0], day: null }] }),
      body({ options: [{ ...body().options[0], clashes_after: undefined }] }),
      body({ options: [{ ...body().options[0], clashes_after: [{ with: "Act Three", points: Infinity }] }] }),
      body({ options: [null] }),
    ];
    for (const item of broken) {
      expect(() => parseMoves(item)).not.toThrow();
      expect(parseMoves(item)).toBeNull();
    }
    const hostile = Object.defineProperty({}, "kind", {
      get() {
        throw new Error("boom");
      },
    });
    expect(parseMoves(hostile)).toBeNull();
  });

  it("keeps the server's order and does not trim the lists", () => {
    const result = parseMoves(
      body({
        clashes_now: [
          { with: "Act One", points: 2.9 },
          { with: "Act Five", points: 0.4 },
          { with: "Act Three", points: 0.1 },
        ],
      }),
    );
    expect(result?.clashesNow.map((partner) => partner.name)).toEqual(["Act One", "Act Five", "Act Three"]);
    expect(result?.options.map((option) => option.start)).toEqual(["15:45", "20:30"]);
  });
});

describe("movableSets", () => {
  it("lists the day's sets by stage in festival order, then by start, with the locked flag", () => {
    expect(movableSets(preset, 0)).toEqual([
      { actId: "act-three", name: "Act Three", stageId: "main", stageName: "Main", start: "16:00", locked: false },
      { actId: "act-one", name: "Act One", stageId: "main", stageName: "Main", start: "20:00", locked: true },
      { actId: "act-four", name: "Act Four", stageId: "tent", stageName: "Tent", start: "15:00", locked: false },
      { actId: "act-two", name: "Act Two", stageId: "tent", stageName: "Tent", start: "20:15", locked: false },
      { actId: "act-five", name: "Act Five", stageId: "field", stageName: "Field", start: "20:30", locked: false },
    ]);
  });

  it("is empty for a day with no sets", () => {
    expect(movableSets(preset, 1)).toEqual([]);
  });
});

describe("startingSets", () => {
  const locked = new Set(["act-one"]);
  const isLocked = (id: string) => locked.has(id);

  it("takes the acts of the costliest clashes in order, each once, skipping locked sets", () => {
    const ranked = [
      clash(1, "act-one", "act-two"),
      clash(2, "act-two", "act-five"),
      clash(3, "act-three", "act-four"),
    ];
    expect(startingSets(ranked, isLocked)).toEqual([
      { actId: "act-two", name: "Act Two" },
      { actId: "act-five", name: "Act Five" },
      { actId: "act-three", name: "Act Three" },
      { actId: "act-four", name: "Act Four" },
    ]);
    expect(startingSets(ranked, isLocked, 2)).toEqual([
      { actId: "act-two", name: "Act Two" },
      { actId: "act-five", name: "Act Five" },
    ]);
  });

  it("only looks at the first six clashes", () => {
    const ranked = [
      ...Array.from({ length: 6 }, (_, i) => clash(i + 1, "act-one", "act-two")),
      clash(7, "act-three", "act-four"),
    ];
    expect(startingSets(ranked, isLocked)).toEqual([{ actId: "act-two", name: "Act Two" }]);
  });

  it("is empty when every set in those clashes is locked", () => {
    expect(startingSets([clash(1, "act-one", "act-one")], isLocked)).toEqual([]);
    expect(startingSets([], isLocked)).toEqual([]);
  });
});

describe("placements", () => {
  it("reads clock times, past midnight included", () => {
    expect(clockMinutes("19:45")).toBe(1185);
    expect(clockMinutes("25:30")).toBe(1530);
    expect(clockMinutes("7:05")).toBe(425);
    expect(clockMinutes("19.45")).toBeNull();
    expect(clockMinutes("")).toBeNull();
  });

  it("places an option and refuses one whose times cannot be read", () => {
    expect(placementOf({ day: 0, start: "15:45", end: "16:30" })).toEqual({ day: 0, start: 945, end: 990 });
    expect(placementOf({ day: 0, start: "16:30", end: "15:45" })).toBeNull();
    expect(placementOf({ day: 0, start: "late", end: "16:30" })).toBeNull();
  });

  it("finds the acts that would play at the same time, by name", () => {
    expect(currentPlacement(preset, "act-two")).toEqual({ day: 0, start: 1215, end: 1260 });
    expect(currentPlacement(preset, "nobody")).toBeNull();
    expect([...concurrentActs(preset, "act-two", { day: 0, start: 1215, end: 1260 })].sort()).toEqual([
      "Act Five",
      "Act One",
    ]);
    // Touching ends do not overlap.
    expect([...concurrentActs(preset, "act-two", { day: 0, start: 945, end: 960 })]).toEqual([]);
    expect([...concurrentActs(preset, "act-two", { day: 1, start: 1215, end: 1260 })]).toEqual([]);
  });
});

describe("clashChanges", () => {
  const now = [
    { name: "Act One", points: 2.9 },
    { name: "Act Five", points: 0.4 },
  ];

  it("ends a clash listed now and not after, and adds one listed after and not now", () => {
    expect(clashChanges(now, [{ name: "Act Three", points: 0.6 }])).toEqual({
      ends: now,
      adds: [{ name: "Act Three", points: 0.6 }],
      keeps: [],
    });
    expect(clashChanges(now, [{ name: "Act One", points: 3.1 }])).toEqual({
      ends: [{ name: "Act Five", points: 0.4 }],
      adds: [],
      keeps: [{ name: "Act One", now: 2.9, after: 3.1 }],
    });
    expect(clashChanges([], [])).toEqual({ ends: [], adds: [], keeps: [] });
  });

  it("keeps a clash a short shift only shortens, with both readings from the server", () => {
    const shifted = clashChanges(
      [{ name: "Act One", points: 4.1 }],
      [{ name: "Act One", points: 2.7 }],
      new Set(["Act One"]),
      new Set(["Act One"]),
    );
    expect(shifted).toEqual({ ends: [], adds: [], keeps: [{ name: "Act One", now: 4.1, after: 2.7 }] });
  });

  it("uses the times, when known, so a partner cut from a full list is not called ended or added", () => {
    // After the move Act Five still plays at the same time but fell out of the top three.
    const after = [
      { name: "Act Three", points: 1.2 },
      { name: "Act Four", points: 0.9 },
      { name: "Act One", points: 0.8 },
    ];
    const concurrentNow = new Set(["Act One", "Act Five", "Act Four"]);
    const concurrentAfter = new Set(["Act One", "Act Five", "Act Three", "Act Four"]);
    // Act Five still clashes but its reading after the move is not on the list, so it is not shown.
    expect(clashChanges(now, after, concurrentNow, concurrentAfter)).toEqual({
      ends: [],
      adds: [{ name: "Act Three", points: 1.2 }],
      keeps: [{ name: "Act One", now: 2.9, after: 0.8 }],
    });
  });
});

describe("nextRankedPair", () => {
  const locked = new Set(["act-one"]);
  const cannotMove = (id: string) => locked.has(id);
  const ranked = [
    clash(1, "act-two", "act-five"),
    clash(2, "act-one", "act-three"),
    clash(3, "act-three", "act-four"),
  ];

  it("takes the first clash in the published ranking that no kept step addresses, with its set free to move", () => {
    // Act Two is kept, so clash 1 is addressed; clash 2's free set is Act Three (Act One is locked).
    expect(nextRankedPair(ranked, new Set(["act-two"]), cannotMove)).toEqual({ a: "Act One", b: "Act Three", actId: "act-three" });
    // Nothing kept: the first clash, its first free set.
    expect(nextRankedPair(ranked, new Set(), cannotMove)).toEqual({ a: "Act Two", b: "Act Five", actId: "act-two" });
  });

  it("skips a clash whose sets cannot move, and says nothing when none is left", () => {
    expect(nextRankedPair([clash(1, "act-one", "act-one"), clash(2, "act-three", "act-four")], new Set(), cannotMove)).toEqual({
      a: "Act Three",
      b: "Act Four",
      actId: "act-three",
    });
    expect(nextRankedPair(ranked, new Set(["act-two", "act-three"]), cannotMove)).toBeNull();
    expect(nextRankedPair([], new Set(), cannotMove)).toBeNull();
  });
});
