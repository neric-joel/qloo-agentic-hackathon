import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildDayGraph } from "./day-graph";
import { parseDecision } from "./decision";
import { rawTinyPreset } from "./fixtures/tiny-preset";
import {
  OUTSIDE_LEAD,
  RECORDED_RUN_NOTE,
  clashChanges,
  clockMinutes,
  concurrentActs,
  currentPlacement,
  fromRecordedRun,
  isFromRecordedRun,
  movableSets,
  nextRankedPair,
  outsideClauses,
  outsideCount,
  outsideGrowth,
  outsideLine,
  parseMoves,
  placementOf,
  startingSets,
} from "./moves";
import { growthClauses, lowerFirst } from "./overlap-words";
import { parsePreset, type Festival, type PairClash, type Preset, type SetSlot } from "./preset";

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

describe("where a kept move came from", () => {
  const move = { actId: "act-two", stageId: "tent", day: 0, start: "21:05" };

  it("marks a move kept from a recorded agent run, and nothing else about it", () => {
    const marked = fromRecordedRun(move);
    expect(marked).toEqual({ ...move, source: "recorded-run" });
    expect(isFromRecordedRun(marked)).toBe(true);
    // The move it was made from is left as it was.
    expect(move).not.toHaveProperty("source");
    expect(RECORDED_RUN_NOTE).toBe("(from a recorded agent run)");
  });

  it("reads a move saved before the source existed, or kept any other way, as not from a run", () => {
    expect(isFromRecordedRun(move)).toBe(false);
    expect(isFromRecordedRun({ ...move, source: "card" })).toBe(false);
    expect(isFromRecordedRun({ ...move, source: undefined })).toBe(false);
    expect(isFromRecordedRun(null)).toBe(false);
    expect(isFromRecordedRun(undefined)).toBe(false);
  });
});

describe("overlaps outside the listed clashes", () => {
  // An invented day: the mover plays 14:00-15:00 and is tested at 14:15-15:15.
  const acts = ["Mover", "Listed", "Starts", "Grows", "Shrinks", "Third", "Fourth", "Apart"].map((name) => ({
    id: name.toLowerCase(),
    name,
  }));
  const slot = (act_id: string, start: number, end: number, day = 0): SetSlot => ({
    act_id,
    day,
    stage_id: act_id,
    start,
    end,
    locked: false,
  });
  const home = { day: 0, start: 840, end: 900 };
  const later = { day: 0, start: 855, end: 915 };

  it("names an overlap the place starts with a set on none of its lists", () => {
    const timetable = [slot("mover", 840, 900), slot("listed", 840, 885), slot("starts", 900, 945)];
    const grows = outsideGrowth(acts, timetable, "mover", home, later, new Set(["Listed"]));
    expect(grows).toEqual([{ name: "Starts", before: 0, after: 15 }]);
    expect(outsideClauses(grows)).toEqual(["new 15 min overlap with Starts."]);
    expect(outsideLine(grows)).toBe("Outside the listed clashes: new 15 min overlap with Starts.");
    expect(OUTSIDE_LEAD).toBe("Outside the listed clashes:");
    expect(outsideCount(grows.length)).toBe("Outside the list, 1 overlap starts or grows.");
  });

  it("names an overlap the place lengthens, with its minutes before and after", () => {
    const timetable = [slot("mover", 840, 900), slot("grows", 890, 940)];
    const grows = outsideGrowth(acts, timetable, "mover", home, later, new Set());
    expect(grows).toEqual([{ name: "Grows", before: 10, after: 25 }]);
    expect(outsideLine(grows)).toBe("Outside the listed clashes: lengthens the overlap with Grows from 10 to 25 min.");
  });

  it("names two and counts the rest when three or more grow, largest change first, then by name", () => {
    const timetable = [
      slot("mover", 840, 900),
      slot("starts", 900, 945), // 0 -> 15
      slot("grows", 890, 940), // 10 -> 25
      slot("third", 895, 960), // 5 -> 20
      slot("fourth", 905, 1000), // 0 -> 10
    ];
    const grows = outsideGrowth(acts, timetable, "mover", home, later, new Set());
    expect(grows.map((item) => item.name)).toEqual(["Grows", "Starts", "Third", "Fourth"]);
    expect(outsideClauses(grows)).toEqual([
      "lengthens the overlap with Grows from 10 to 25 min.",
      "new 15 min overlap with Starts.",
      "2 more overlaps get longer.",
    ]);
    expect(outsideCount(grows.length)).toBe("Outside the list, 4 overlaps start or grow.");
    const three = grows.slice(0, 3);
    expect(outsideClauses(three).at(-1)).toBe("1 more overlap gets longer.");
    expect(outsideCount(three.length)).toBe("Outside the list, 3 overlaps start or grow.");
    // The clauses are the hero's own words, each continued in lower case.
    expect(outsideClauses(grows)).toEqual(growthClauses(grows).map(lowerFirst));
  });

  it("says nothing when nothing outside the lists starts or grows", () => {
    const timetable = [
      slot("mover", 840, 900),
      slot("listed", 900, 945), // grows, but a list shows it
      slot("shrinks", 825, 870), // 30 -> 15
      slot("apart", 1000, 1060), // never meets it
      slot("starts", 900, 945, 1), // another day
    ];
    const grows = outsideGrowth(acts, timetable, "mover", home, later, new Set(["Listed"]));
    expect(grows).toEqual([]);
    expect(outsideClauses(grows)).toEqual([]);
    expect(outsideLine(grows)).toBeNull();
    expect(outsideCount(0)).toBeNull();
    // No place, no line.
    expect(outsideGrowth(acts, timetable, "mover", null, later, new Set())).toEqual([]);
    expect(outsideGrowth(acts, timetable, "mover", home, null, new Set())).toEqual([]);
  });

  it("reads a place on another day against that day's sets only", () => {
    const timetable = [slot("mover", 840, 900), slot("shrinks", 825, 870), slot("starts", 900, 945, 1)];
    const grows = outsideGrowth(acts, timetable, "mover", home, { day: 1, start: 900, end: 960 }, new Set());
    expect(grows).toEqual([{ name: "Starts", before: 0, after: 45 }]);
  });
});

describe("the outside line and the hero's side effect come from one computation", () => {
  type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  /** The hero's drawing of a move as the decision route would send it: the mover to `start`-`end` on `stageId`. */
  function heroDrawing(preset: Preset, moverId: string, partnerId: string, stageId: string, start: string, end: string) {
    const stage = preset.festival.stages.find((item) => item.id === stageId)!.name;
    const mover = preset.festival.acts.find((act) => act.id === moverId)!.name;
    const decision = parseDecision({
      kind: "decision",
      day: 0,
      skipped_locked: 0,
      skipped_no_place: 0,
      published_budget: 116.7,
      clash: { a_id: moverId, b_id: partnerId, rank: 1, minutes: 45 },
      move: {
        act_id: moverId,
        act: mover,
        from: `${stage} 14:00-15:00`,
        stage_id: stageId,
        stage,
        day: 0,
        start,
        end,
        minutes_moved: 15,
        legal_places: 6,
        stage_changed: false,
        budget_after: 114.3,
        minutes_shared_after: 30,
        same_index_alternative: null,
      },
      rule: null,
    });
    const drawing = buildDayGraph(preset, decision, 0);
    expect(drawing?.move).toBeTruthy();
    return drawing!;
  }

  /** The outside overlaps Try a move reads for the same place, given the place's lists (`listed`). */
  function tryAMoveOutside(preset: Preset, moverId: string, start: string, end: string, listed: readonly string[]) {
    const home = currentPlacement(preset, moverId);
    const after = placementOf({ day: 0, start, end });
    return outsideGrowth(preset.festival.acts, preset.festival.timetable, moverId, home, after, new Set(listed));
  }

  it("on an invented day with the published day's overlaps, the outside clauses are the hero's growth clauses", () => {
    // Invented names and times shaped like the published Glastonbury Sunday's move: the mover goes 15 minutes
    // later; its three listed clashes (the partner and two more) each lose 15 minutes, an unlisted overlap
    // shrinks, and one unlisted overlap starts (0 -> 15).
    const raw = rawTinyPreset() as Raw;
    const sets: [string, string, string, string][] = [
      ["Alder", "wood", "14:00", "15:00"],
      ["Birch", "lake", "14:00", "14:45"],
      ["Cedar", "main", "14:00", "15:00"],
      ["Dune", "hill", "14:00", "15:00"],
      ["Elm", "barn", "13:45", "14:30"],
      ["Fern", "barn", "15:00", "15:45"],
    ];
    raw.festival.stages = ["main", "hill", "barn", "wood", "lake"].map((id, index) => ({
      id,
      name: id[0].toUpperCase() + id.slice(1),
      tier: index + 1,
      hours: [],
    }));
    raw.festival.acts = sets.map(([name]) => ({
      id: name.toLowerCase(),
      name,
      qloo_id: null,
      popularity: 0.5,
      genre: null,
      billing_tier: 2,
    }));
    raw.festival.timetable = sets.map(([name, stage, start, end]) => ({
      act_id: name.toLowerCase(),
      day: 0,
      stage_id: stage,
      start,
      end,
      locked: false,
    }));
    const side = (name: string) => ({ act_id: name.toLowerCase(), name, stage_id: sets.find((item) => item[0] === name)![1], genre: null });
    raw.report.clashes = [
      {
        rank: 1,
        a: side("Alder"),
        b: side("Birch"),
        day: 0,
        overlap_minutes: 45,
        concurrency: 1,
        audience_overlap: 0.9,
        draw: 0.5,
        regret: 0.4,
        regret_share: 0.4,
        label: null,
        confidence: "strong",
      },
    ];
    raw.report.coverage = { ...raw.report.coverage, unscored: [], weak_act_ids: [] };
    const preset = parsePreset(raw);
    const drawing = heroDrawing(preset, "alder", "birch", "wood", "14:15", "15:15");
    const outside = tryAMoveOutside(preset, "alder", "14:15", "15:15", ["Birch", "Cedar", "Dune"]);
    expect(drawing.move!.grows.map((item) => item.name)).toEqual(["Fern"]);
    expect(outsideClauses(outside)).toEqual(growthClauses(drawing.move!.grows).map(lowerFirst));
    expect(outsideLine(outside)).toBe("Outside the listed clashes: new 15 min overlap with Fern.");
  });

  /** The published Glastonbury Sunday from the backend's built presets, when this checkout has it (not committed). */
  const path = join(process.cwd(), "..", "backend", "presets", "glastonbury-2025-sun.json");
  const glastonbury = existsSync(path) ? parsePreset(JSON.parse(readFileSync(path, "utf8"))) : null;

  it.skipIf(glastonbury === null)(
    "on Glastonbury, Sprints to Woodsies 14:15-15:15 reads 'new 15 min overlap with Joy Crookes.' in both panels",
    () => {
      const preset = glastonbury!;
      const idOf = (name: string) => preset.festival.acts.find((act) => act.name === name)!.id;
      const drawing = heroDrawing(preset, idOf("Sprints"), idOf("Katy J Pearson"), "woodsies", "14:15", "15:15");
      // The moves route's lists for this place on the saved day: Sprints' three costliest clashes, before and
      // after (GET /api/presets/glastonbury-2025-sun/moves?act=sprints).
      const listed = ["Katy J Pearson", "Cymande", "The Libertines"];
      const outside = tryAMoveOutside(preset, idOf("Sprints"), "14:15", "15:15", listed);
      const heroClauses = growthClauses(drawing.move!.grows);
      expect(heroClauses).toEqual(["New 15 min overlap with Joy Crookes."]);
      expect(outsideClauses(outside)).toEqual(heroClauses.map(lowerFirst));
      expect(outsideLine(outside)).toBe("Outside the listed clashes: new 15 min overlap with Joy Crookes.");
      expect(outsideCount(outside.length)).toBe("Outside the list, 1 overlap starts or grows.");
    },
  );
});
