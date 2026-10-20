import { describe, expect, it } from "vitest";

import {
  buildDayGraph,
  drawingHeight,
  drawingTitle,
  EASE_MOVE,
  EASE_OUT,
  keyLine,
  LAYOUT,
  MOVE_MS,
  PAN_MS,
  setNote,
  settledAnnouncement,
  sideEffectText,
  TAG_MS,
  threadNote,
  threadWidth,
  type DayGraphModel,
  type DayGraphMove,
  type OverlapChange,
} from "./day-graph";
import { NO_OTHER_LONGER, parseDecision, sideEffectsLine, type Decision } from "./decision";
import { rawTinyPreset } from "./fixtures/tiny-preset";
import { parsePreset, type Preset } from "./preset";

// Every name, time and figure below is invented for the test: the tiny preset fixture reshaped into a
// hand-made five-stage day. None of it is Qloo data or a saved festival day.

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type SetSpec = { name: string; stage: string; start: string; end: string; locked?: boolean; unscored?: boolean; genre?: string };

const STAGES: [string, string][] = [
  ["main", "Main"],
  ["hill", "Hill"],
  ["barn", "Barn"],
  ["wood", "Wood"],
  ["lake", "Lake"],
];

const idOf = (name: string) => name.toLowerCase();

/**
 * The day. Alder (Wood 14:00-15:00) and Birch (Lake 14:00-14:45) share 45 minutes. Moving Alder 15 minutes
 * later starts an overlap with Cedar (0 -> 15), lengthens Oak's (10 -> 25), shortens Fir's (60 -> 45) and
 * Gum's (30 -> 15), ends Elm's (10 -> 0) and leaves the rest alone.
 */
const SETS: SetSpec[] = [
  { name: "Larch", stage: "main", start: "12:00", end: "13:00", locked: true },
  { name: "Fir", stage: "main", start: "14:00", end: "15:00", genre: "Rock" },
  { name: "Juniper", stage: "main", start: "15:15", end: "16:15" },
  { name: "Gum", stage: "hill", start: "13:30", end: "14:30" },
  { name: "Oak", stage: "hill", start: "14:50", end: "15:30", genre: "Shoegaze" },
  { name: "Ivy", stage: "hill", start: "15:45", end: "16:30" },
  { name: "Elm", stage: "barn", start: "13:20", end: "14:10" },
  { name: "Cedar", stage: "barn", start: "15:00", end: "16:00" },
  { name: "Alder", stage: "wood", start: "14:00", end: "15:00", genre: "Post Rock" },
  { name: "Kauri", stage: "wood", start: "15:30", end: "16:00", unscored: true },
  { name: "Birch", stage: "lake", start: "14:00", end: "14:45", genre: "Folk Pop" },
  { name: "Hazel", stage: "lake", start: "16:00", end: "17:00" },
];

function side(sets: readonly SetSpec[], name: string): Raw {
  const spec = sets.find((item) => item.name === name);
  if (!spec) throw new Error(`no set ${name} in the fixture`);
  return { act_id: idOf(name), name, stage_id: spec.stage, genre: spec.genre ?? null };
}

function pair(rank: number, a: string, b: string, minutes: number, overlap: number, extra: Raw = {}, sets = SETS): Raw {
  return {
    rank,
    a: side(sets, a),
    b: side(sets, b),
    day: 0,
    overlap_minutes: minutes,
    concurrency: 1,
    audience_overlap: overlap,
    draw: 0.5,
    regret: 0.1,
    regret_share: 0.1,
    label: null,
    confidence: "strong",
    ...extra,
  };
}

const CLASHES: Raw[] = [
  pair(3, "Gum", "Birch", 30, 0.55),
  pair(1, "Alder", "Birch", 45, 0.912, { label: "hidden" }),
  pair(2, "Fir", "Alder", 60, 0.62),
  pair(4, "Elm", "Gum", 40, 0.4),
  pair(5, "Oak", "Alder", 10, 0.804),
  pair(6, "Fir", "Birch", 45, 0.3),
  pair(7, "Cedar", "Juniper", 45, 0.2),
  pair(8, "Elm", "Alder", 10, 0.25),
];

function makeDay({
  sets = SETS,
  clashes = CLASHES,
  stages = STAGES,
  scored = 9,
  unscored = 2,
  synthetic = false,
  title = "Mini Fest 2026, Sunday",
}: {
  sets?: SetSpec[];
  clashes?: Raw[];
  stages?: [string, string][];
  scored?: number;
  unscored?: number;
  synthetic?: boolean;
  title?: string;
} = {}): Preset {
  const raw = rawTinyPreset() as Raw;
  raw.id = "mini-fest-sun";
  raw.title = title;
  raw.synthetic = synthetic;
  raw.festival.name = "Mini Fest 2026, Sun";
  raw.festival.days = ["Sun"];
  raw.festival.stages = stages.map(([id, name], index) => ({ id, name, tier: index + 1, hours: [] }));
  raw.festival.acts = sets.map((spec) => ({
    id: idOf(spec.name),
    name: spec.name,
    qloo_id: null,
    popularity: spec.unscored ? null : 0.5,
    genre: spec.genre ?? null,
    billing_tier: 2,
  }));
  raw.festival.timetable = sets.map((spec) => ({
    act_id: idOf(spec.name),
    day: 0,
    stage_id: spec.stage,
    start: spec.start,
    end: spec.end,
    locked: spec.locked === true,
  }));
  raw.report.clashes = clashes;
  raw.report.metrics = { ...raw.report.metrics, scored_concurrent_pairs: scored, unscored_concurrent_pairs: unscored };
  raw.report.coverage = {
    ...raw.report.coverage,
    unscored: sets.filter((spec) => spec.unscored).map((spec) => ({ act_id: idOf(spec.name), name: spec.name, reason: "no_signal" })),
    weak_act_ids: [],
  };
  return parsePreset(raw);
}

const ALDER_BIRCH = { a_id: "alder", b_id: "birch", rank: 1, minutes: 45 };

const LATER: Raw = {
  act_id: "alder",
  act: "Alder",
  from: "Wood 14:00-15:00",
  stage_id: "wood",
  stage: "Wood",
  day: 0,
  start: "14:15",
  end: "15:15",
  minutes_moved: 15,
  legal_places: 5,
  stage_changed: false,
  budget_after: 104.1,
  minutes_shared_after: 30,
  same_index_alternative: null,
};

const TO_HILL: Raw = { ...LATER, stage_id: "hill", stage: "Hill", start: "16:30", end: "17:30", minutes_moved: 150, stage_changed: true, minutes_shared_after: 0 };

function decide(move: Raw | null, clash: Raw = ALDER_BIRCH, day = 0): Decision {
  const decision = parseDecision({ kind: "decision", day, skipped_locked: 0, skipped_no_place: 0, clash, published_budget: 108.4, move, rule: null });
  if (!decision) throw new Error("the fixture decision did not parse");
  return decision;
}

function model(preset: Preset, decision: Decision | null): DayGraphModel {
  const built = buildDayGraph(preset, decision, 0);
  if (!built) throw new Error("no model for the fixture day");
  return built;
}

const moved = () => model(makeDay(), decide(LATER));

const brief = (changes: readonly OverlapChange[]) => changes.map((item) => `${item.name} ${item.before}->${item.after}`);

describe("buildDayGraph: the day", () => {
  it("draws every set of the day from the timetable, with its stage row, lock and signal", () => {
    const graph = moved();
    expect(graph.presetId).toBe("mini-fest-sun");
    expect(graph.day).toBe(0);
    expect(graph.title).toBe("Mini Fest 2026, Sunday");
    expect(graph.builtAt).toBe("2026-10-01T10:00:00+00:00");
    expect(graph.stages).toEqual(STAGES.map(([id, name]) => ({ id, name })));
    expect(graph.sets).toHaveLength(12);
    expect(graph.domain).toEqual({ start: 720, end: 1020 });
    const larch = graph.sets.find((set) => set.name === "Larch");
    expect(larch).toEqual({ actId: "larch", name: "Larch", stageIndex: 0, start: 720, end: 780, locked: true, unscored: false, featured: false });
    expect(graph.sets.find((set) => set.name === "Kauri")).toMatchObject({ stageIndex: 3, unscored: true, locked: false });
    // The mover is drawn at its published place; the move carries where it goes.
    expect(graph.sets.find((set) => set.name === "Alder")).toMatchObject({ start: 840, end: 900, stageIndex: 3 });
  });

  it("features the mover, its partner and every set whose overlap grows, and nothing else", () => {
    const featured = moved().sets.filter((set) => set.featured).map((set) => set.name).sort();
    expect(featured).toEqual(["Alder", "Birch", "Cedar", "Oak"]);
    const still = model(makeDay(), decide(null)).sets.filter((set) => set.featured).map((set) => set.name).sort();
    expect(still).toEqual(["Alder", "Birch"]);
    expect(model(makeDay(), null).sets.some((set) => set.featured)).toBe(false);
  });

  it("counts the overlaps from the report: scored plus unscored", () => {
    expect(moved().overlaps).toEqual({ total: 11, scored: 9, unscored: 2 });
    expect(model(makeDay({ scored: 68, unscored: 11 }), null).overlaps).toEqual({ total: 79, scored: 68, unscored: 11 });
  });

  it("splits the title into the festival and the day at its first comma", () => {
    const graph = moved();
    expect(graph.festivalName).toBe("Mini Fest 2026");
    expect(graph.dayName).toBe("Sunday");
    const bare = model(makeDay({ title: "Mini Fest 2026" }), null);
    expect(bare.festivalName).toBe("Mini Fest 2026");
    expect(bare.dayName).toBeNull();
  });

  it("drops a stage with no set on the day", () => {
    const stages: [string, string][] = [...STAGES.slice(0, 2), ["dock", "Dock"], ...STAGES.slice(2)];
    const graph = model(makeDay({ stages }), decide(LATER));
    expect(graph.stages.map((stage) => stage.name)).toEqual(["Main", "Hill", "Barn", "Wood", "Lake"]);
    expect(graph.sets.find((set) => set.name === "Hazel")?.stageIndex).toBe(4);
    expect(graph.move?.from.stageIndex).toBe(3);
    expect(drawingHeight(graph, "desktop")).toBe(22 + 64 * 5);
  });

  it("carries the synthetic flag", () => {
    expect(moved().synthetic).toBe(false);
    expect(model(makeDay({ synthetic: true }), decide(LATER)).synthetic).toBe(true);
  });

  it("is null for a day with no sets, and ignores a decision for another day", () => {
    expect(buildDayGraph(makeDay(), decide(LATER), 3)).toBeNull();
    const graph = model(makeDay(), decide(LATER, ALDER_BIRCH, 1));
    expect(graph.move).toBeNull();
    expect(graph.litRank).toBeNull();
    expect(graph.threads.some((thread) => thread.lit)).toBe(false);
  });
});

describe("buildDayGraph: the lines", () => {
  it("draws the day's ranked clashes in rank order, with the taste rank the rest of the site prints", () => {
    const graph = moved();
    expect(graph.threads.map((thread) => thread.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(graph.threads.map((thread) => thread.taste)).toEqual([91, 62, 55, 40, 80, 30, 20, 25]);
    expect(graph.threads[0]).toMatchObject({
      aId: "alder",
      bId: "birch",
      aName: "Alder",
      bName: "Birch",
      aGenre: "Post Rock",
      bGenre: "Folk Pop",
      minutes: 45,
      window: { start: 840, end: 885 },
      hidden: true,
      lit: true,
    });
    expect(graph.threads[2]).toMatchObject({ aGenre: null, hidden: false, lit: false });
    expect(graph.litRank).toBe(1);
    expect(graph.tasteOfLit).toBe(91);
  });

  it("draws at most 15 ranked clashes", () => {
    const clashes = Array.from({ length: 18 }, (_, index) => pair(index + 1, "Fir", "Alder", 60, 0.5));
    const graph = model(makeDay({ clashes }), null);
    expect(graph.threads).toHaveLength(15);
    expect(graph.threads.at(-1)?.rank).toBe(15);
  });

  it("adds the chosen clash, lit, after the 15 when it is not among them", () => {
    const clashes = [
      ...CLASHES,
      pair(9, "Gum", "Alder", 30, 0.5),
      pair(10, "Gum", "Fir", 30, 0.5),
      pair(11, "Elm", "Fir", 10, 0.5),
      pair(12, "Oak", "Fir", 10, 0.5),
      pair(13, "Oak", "Cedar", 30, 0.5),
      pair(14, "Ivy", "Juniper", 30, 0.5),
      pair(15, "Juniper", "Hazel", 15, 0.5),
      pair(16, "Ivy", "Hazel", 30, 0.47),
    ];
    const graph = model(makeDay({ clashes, scored: 20, unscored: 2 }), decide(null, { a_id: "ivy", b_id: "hazel", rank: 16, minutes: 30 }));
    expect(graph.threads).toHaveLength(16);
    expect(graph.threads.slice(0, 15).some((thread) => thread.lit)).toBe(false);
    expect(graph.threads[15]).toMatchObject({ rank: 16, aName: "Ivy", bName: "Hazel", taste: 47, lit: true, window: { start: 960, end: 990 } });
    expect(graph.litRank).toBe(16);
    expect(keyLine(graph)).toBe(
      "Lines: the 15 costliest of 20 scored clashes (22 in all), plus the chosen clash; thicker means a higher taste overlap rank.",
    );
  });

  it("leaves out a ranked clash whose sets are not both on the day", () => {
    const clashes = [...CLASHES, { ...pair(9, "Gum", "Alder", 30, 0.5), b: { act_id: "nobody", name: "Nobody", stage_id: "wood", genre: null } }];
    expect(model(makeDay({ clashes }), null).threads.map((thread) => thread.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("widens linearly with the taste rank", () => {
    expect(threadWidth(0)).toBe(1.25);
    expect(threadWidth(100)).toBe(4.75);
    expect(threadWidth(50)).toBe(3);
    expect(threadWidth(91)).toBeCloseTo(4.435, 6);
  });

  it("gives every line that touches the mover its overlap with the move: shortened, lengthened or ended", () => {
    const byRank = new Map(moved().threads.map((thread) => [thread.rank, thread]));
    expect(byRank.get(1)?.moved).toEqual({ minutes: 30, window: { start: 855, end: 885 } });
    expect(byRank.get(2)?.moved).toEqual({ minutes: 45, window: { start: 855, end: 900 } });
    expect(byRank.get(5)?.moved).toEqual({ minutes: 25, window: { start: 890, end: 915 } });
    expect(byRank.get(8)?.moved).toEqual({ minutes: 0, window: null });
    for (const rank of [3, 4, 6, 7]) expect(byRank.get(rank)?.moved).toBeNull();
    expect(model(makeDay(), decide(null)).threads.every((thread) => thread.moved === null)).toBe(true);
  });

  it("marks every line the report ranks as ranked, and adds none for overlaps the side-effect line only counts", () => {
    // Alder's move shortens Gum's overlap, which the report does not rank, but with two others: counted, not named.
    const graph = moved();
    expect(graph.threads).toHaveLength(8);
    expect(graph.threads.every((thread) => thread.ranked)).toBe(true);
    expect(graph.threads.some((thread) => [thread.aId, thread.bId].includes("gum") && [thread.aId, thread.bId].includes("alder"))).toBe(false);
  });
});

describe("buildDayGraph: the overlaps the side-effect line names", () => {
  /**
   * Alder (Wood 14:00-15:00) and Birch (Lake 14:00-14:45) share 45 minutes. Moving Alder 15 minutes later
   * lengthens Oak's overlap (10 -> 25) and ends Twin's (5 -> 0), and both are named: "Lengthens the overlap
   * with Oak from 10 to 25 min. Ends the 5 min overlap with Twin."
   */
  const END_SETS: SetSpec[] = [
    { name: "Fir", stage: "main", start: "15:30", end: "16:30" },
    { name: "Gum", stage: "hill", start: "13:00", end: "14:00" },
    { name: "Oak", stage: "hill", start: "14:50", end: "15:30", genre: "Shoegaze" },
    { name: "Twin", stage: "barn", start: "13:30", end: "14:05", genre: "Indie Rock" },
    { name: "Alder", stage: "wood", start: "14:00", end: "15:00", genre: "Post Rock" },
    { name: "Birch", stage: "lake", start: "14:00", end: "14:45", genre: "Folk Pop" },
  ];
  const ranked = (...more: Raw[]) => [
    pair(1, "Alder", "Birch", 45, 0.912, {}, END_SETS),
    pair(2, "Gum", "Twin", 30, 0.5, {}, END_SETS),
    pair(3, "Twin", "Birch", 5, 0.4, {}, END_SETS),
    ...more,
  ];
  const endDay = (clashes = ranked(), extra: { sets?: SetSpec[]; synthetic?: boolean } = {}) =>
    model(makeDay({ sets: extra.sets ?? END_SETS, clashes, synthetic: extra.synthetic }), decide(LATER));
  const between = (graph: DayGraphModel, a: string, b: string) =>
    graph.threads.find((thread) => [thread.aId, thread.bId].includes(idOf(a)) && [thread.aId, thread.bId].includes(idOf(b)));

  it("draws a named overlap the report does not rank, unranked and after the ranked lines, with its moved window", () => {
    const graph = endDay();
    expect(sideEffectText(graph.move!)).toBe("Lengthens the overlap with Oak from 10 to 25 min. Ends the 5 min overlap with Twin.");
    expect(graph.threads.map((thread) => [thread.rank, thread.ranked])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, false],
      [5, false],
    ]);
    expect(between(graph, "Alder", "Oak")).toEqual({
      rank: 4,
      ranked: false,
      aId: "alder",
      bId: "oak",
      aName: "Alder",
      bName: "Oak",
      aGenre: "Post Rock",
      bGenre: "Shoegaze",
      minutes: 10,
      window: { start: 890, end: 900 },
      taste: 0,
      hidden: false,
      lit: false,
      moved: { minutes: 25, window: { start: 890, end: 915 } },
    });
    // The overlap the move ends: drawn as published, gone with the move.
    expect(between(graph, "Alder", "Twin")).toMatchObject({ rank: 5, ranked: false, minutes: 5, window: { start: 840, end: 845 }, moved: { minutes: 0, window: null } });
    // Neither is lit, featured for growing only, and the chosen clash's figures are untouched.
    expect(graph.litRank).toBe(1);
    expect(graph.tasteOfLit).toBe(91);
    expect(graph.sets.filter((set) => set.featured).map((set) => set.name).sort()).toEqual(["Alder", "Birch", "Oak"]);
  });

  it("draws a named overlap from the report, with its rank and taste, when the report ranks it after the 15", () => {
    const fillers = Array.from({ length: 14 }, (_, index) => pair(index + 2, "Gum", "Twin", 30, 0.5, {}, END_SETS));
    const graph = endDay([pair(1, "Alder", "Birch", 45, 0.912, {}, END_SETS), ...fillers, pair(16, "Twin", "Alder", 5, 0.33, {}, END_SETS)]);
    expect(graph.threads).toHaveLength(17);
    expect(between(graph, "Alder", "Twin")).toMatchObject({ rank: 16, ranked: true, taste: 33, aName: "Twin", bName: "Alder", moved: { minutes: 0, window: null } });
    expect(between(graph, "Alder", "Oak")).toMatchObject({ rank: 17, ranked: false, taste: 0 });
    expect(keyLine(graph)).toBe(
      "Lines: the 15 costliest of 9 scored clashes (11 in all), plus 2 overlaps the move changes (1 not ranked); thicker means a higher taste overlap rank. Dashed: published slot or new overlap.",
    );
  });

  it("adds nothing when a ranked line already draws the named overlap, and numbers on after the last rank", () => {
    const graph = endDay(ranked(pair(4, "Oak", "Alder", 10, 0.6, {}, END_SETS)));
    expect(graph.threads.map((thread) => [thread.rank, thread.ranked, thread.bName])).toEqual([
      [1, true, "Birch"],
      [2, true, "Twin"],
      [3, true, "Birch"],
      [4, true, "Alder"],
      [5, false, "Twin"],
    ]);
  });

  it("says in the key what the extra lines are, and that they carry no rank", () => {
    expect(keyLine(endDay())).toBe(
      "Lines: the 3 costliest of 9 scored clashes (11 in all), plus 2 overlaps the move changes (not ranked); thicker means a higher taste overlap rank. Dashed: published slot or new overlap.",
    );
    const ends = endDay(ranked(pair(4, "Oak", "Alder", 10, 0.6, {}, END_SETS)));
    expect(keyLine(ends)).toBe(
      "Lines: the 4 costliest of 9 scored clashes (11 in all), plus the overlap the move ends (not ranked); thicker means a higher taste overlap rank. Dashed: published slot or new overlap.",
    );
    const noOak = END_SETS.filter((spec) => spec.name !== "Oak");
    const shortens = endDay(ranked(), { sets: noOak.map((spec) => (spec.name === "Twin" ? { ...spec, end: "14:25" } : spec)) });
    expect(sideEffectText(shortens.move!)).toBe("Shortens the overlap with Twin from 25 to 10 min. No other overlap gets longer.");
    expect(keyLine(shortens)).toContain("(11 in all), plus the overlap the move shortens (not ranked); thicker");
    const lengthens = endDay(ranked(pair(4, "Twin", "Alder", 5, 0.2, {}, END_SETS)));
    expect(keyLine(lengthens)).toContain("(11 in all), plus the overlap the move lengthens (not ranked); thicker");
  });

  it("gives an unranked line a note with its minutes in both views and no taste rank", () => {
    const graph = endDay();
    const twin = between(graph, "Alder", "Twin")!;
    expect(threadNote(graph, twin, "published")).toBe(
      "Outside the 3 costliest of 9 clashes as published: Alder × Twin, 5 min shared (14:00–14:05). The move ends this overlap, which has no taste overlap rank here. Main genres: Post Rock, Indie Rock.",
    );
    expect(threadNote(graph, twin, "moved")).toBe(
      "Outside the 3 costliest of 9 clashes as published: Alder × Twin, 5 min shared as published, none with the move. The move ends this overlap, which has no taste overlap rank here. Main genres: Post Rock, Indie Rock.",
    );
    expect(threadNote(graph, between(graph, "Alder", "Oak")!, "moved")).toBe(
      "Outside the 3 costliest of 9 clashes as published: Alder × Oak, 10 min shared as published, 25 with the move (14:50–15:15). The move lengthens this overlap, which has no taste overlap rank here. Main genres: Post Rock, Shoegaze.",
    );
    for (const view of ["published", "moved"] as const) {
      expect(threadNote(graph, twin, view)).not.toMatch(/#\d|of 100|rank \d/);
    }
  });

  it("calls the missing rank invented on the invented day, and never says published", () => {
    const graph = endDay(ranked(), { synthetic: true });
    expect(threadNote(graph, between(graph, "Alder", "Twin")!, "published")).toBe(
      "Outside the 3 costliest of 9 clashes before the move: Alder × Twin, 5 min shared (14:00–14:05). The move ends this overlap, which has no invented taste overlap rank here. Main genres: Post Rock, Indie Rock.",
    );
    expect(keyLine(graph)).toBe(
      "Lines: the 3 costliest of 9 scored clashes (11 in all), plus 2 overlaps the move changes (not ranked); thicker means a higher invented taste overlap rank. Dashed: slot before the move or new overlap.",
    );
    for (const view of ["published", "moved"] as const) {
      for (const text of [keyLine(graph), drawingTitle(graph, view), ...graph.threads.map((item) => threadNote(graph, item, view))]) {
        expect(text).not.toMatch(/published/i);
        expect(text).not.toMatch(/Qloo/);
      }
    }
  });

  it("puts the stage of a named shrinking overlap on the phone after the stages of what grows", () => {
    // With Oak growing, Wood, Lake and Hill fill the three rows; without it, Twin's Barn takes the third.
    expect(endDay().phoneRows).toEqual([1, 3, 4]);
    const noOak = endDay(ranked(), { sets: END_SETS.filter((spec) => spec.name !== "Oak") });
    expect(noOak.move?.grows).toEqual([]);
    expect(noOak.phoneRows).toEqual([2, 3, 4]);
    // The ended overlap's window lies inside the mover's published slot, so inside the window.
    expect(noOak.focus.start).toBeLessThanOrEqual(840);
    expect(noOak.focus.end).toBeGreaterThanOrEqual(845);
    // Barn stays even when Hill holds more lines inside the window (four against Barn's three).
    const early: SetSpec[] = [
      { name: "Ash", stage: "main", start: "13:00", end: "13:50" },
      { name: "Cob", stage: "lake", start: "13:00", end: "13:55" },
      { name: "Dew", stage: "wood", start: "13:00", end: "13:55" },
    ];
    const sets = [...END_SETS.filter((spec) => spec.name !== "Oak"), ...early];
    const busyHill = ranked(...early.map((spec, index) => pair(4 + index, spec.name, "Gum", 50, 0.3, {}, sets)));
    const busy = endDay(busyHill, { sets });
    expect(busy.move?.shrinks.map((item) => item.name)).toEqual(["Twin"]);
    expect(busy.phoneRows).toEqual([2, 3, 4]);
  });
});

describe("buildDayGraph: the move", () => {
  it("reads the move from the decision and its minutes from the timetable", () => {
    const move = moved().move;
    expect(move).toMatchObject({
      actId: "alder",
      name: "Alder",
      partnerId: "birch",
      partnerName: "Birch",
      from: { start: 840, end: 900, stageIndex: 3 },
      to: { start: 855, end: 915, stageIndex: 3 },
      stageChanged: false,
      minutesBefore: 45,
      minutesAfter: 30,
      sharedBefore: { start: 840, end: 885 },
      sharedAfter: { start: 855, end: 885 },
      label: "Alder 15 min later",
    });
  });

  it("lists every other set whose overlap grows or shrinks, by size of change, then name, with both windows", () => {
    const move = moved().move!;
    expect(brief(move.grows)).toEqual(["Cedar 0->15", "Oak 10->25"]);
    expect(brief(move.shrinks)).toEqual(["Fir 60->45", "Gum 30->15", "Elm 10->0"]);
    expect(move.grows[0]).toEqual({ actId: "cedar", name: "Cedar", stageIndex: 2, before: 0, after: 15, beforeWindow: null, afterWindow: { start: 900, end: 915 } });
    expect(move.grows[1]).toMatchObject({ stageIndex: 1, beforeWindow: { start: 890, end: 900 }, afterWindow: { start: 890, end: 915 } });
    expect(move.shrinks[0]).toMatchObject({ stageIndex: 0, beforeWindow: { start: 840, end: 900 }, afterWindow: { start: 855, end: 900 } });
    expect(move.shrinks[2]).toMatchObject({ name: "Elm", beforeWindow: { start: 840, end: 850 }, afterWindow: null });
    // The partner is the move's own pair, never a side effect.
    expect([...move.grows, ...move.shrinks].some((item) => item.actId === "birch")).toBe(false);
  });

  it("names an earlier move and a stage change", () => {
    const earlier = model(makeDay(), decide({ ...LATER, start: "13:45", end: "14:45" })).move;
    expect(earlier?.label).toBe("Alder 15 min earlier");
    const hill = model(makeDay(), decide(TO_HILL)).move!;
    expect(hill.label).toBe("Alder to Hill at 16:30");
    expect(hill.stageChanged).toBe(true);
    expect(hill.to).toEqual({ start: 990, end: 1050, stageIndex: 1 });
    expect(hill.minutesAfter).toBe(0);
    expect(hill.sharedAfter).toBeNull();
    expect(brief(hill.grows)).toEqual(["Hazel 0->30"]);
    expect(brief(hill.shrinks)).toEqual(["Fir 60->0", "Gum 30->0", "Elm 10->0", "Oak 10->0"]);
  });

  it("works out the partner whichever end of the clash moves", () => {
    const birchMoves = model(makeDay(), decide({ ...LATER, act_id: "birch", act: "Birch", from: "Lake 14:00-14:45", stage_id: "lake", stage: "Lake", start: "14:30", end: "15:15", minutes_moved: 30 })).move;
    expect(birchMoves).toMatchObject({ actId: "birch", partnerId: "alder", partnerName: "Alder", minutesBefore: 45, minutesAfter: 30, label: "Birch 30 min later" });
  });

  it("has no move without one in the decision, nor without a decision", () => {
    const still = model(makeDay(), decide(null));
    expect(still.move).toBeNull();
    expect(still.litRank).toBe(1);
    const none = model(makeDay(), null);
    expect(none.move).toBeNull();
    expect(none.litRank).toBeNull();
    expect(none.tasteOfLit).toBeNull();
  });
});

describe("sideEffectText", () => {
  const change = (name: string, before: number, after: number): OverlapChange => ({
    actId: idOf(name),
    name,
    stageIndex: 0,
    before,
    after,
    beforeWindow: before > 0 ? { start: 600, end: 600 + before } : null,
    afterWindow: after > 0 ? { start: 600, end: 600 + after } : null,
  });
  const base = moved().move!;
  const withChanges = (grows: OverlapChange[], shrinks: OverlapChange[]): DayGraphMove => ({ ...base, grows, shrinks });

  it("names a new overlap", () => {
    expect(sideEffectText(withChanges([change("Joy", 0, 15)], []))).toBe("New 15 min overlap with Joy.");
  });

  it("names a longer overlap", () => {
    expect(sideEffectText(withChanges([change("Joy", 10, 25)], []))).toBe("Lengthens the overlap with Joy from 10 to 25 min.");
  });

  it("names two growing overlaps and counts the rest", () => {
    const grows = [change("Ash", 0, 20), change("Bay", 5, 15), change("Cob", 0, 10), change("Dew", 0, 5)];
    expect(sideEffectText(withChanges(grows, []))).toBe(
      "New 20 min overlap with Ash. Lengthens the overlap with Bay from 5 to 15 min. 2 more overlaps get longer.",
    );
    expect(sideEffectText(withChanges(grows.slice(0, 3), []))).toBe(
      "New 20 min overlap with Ash. Lengthens the overlap with Bay from 5 to 15 min. 1 more overlap gets longer.",
    );
  });

  it("names one overlap that ends", () => {
    expect(sideEffectText(withChanges([], [change("Twin", 5, 0)]))).toBe(`Ends the 5 min overlap with Twin. ${NO_OTHER_LONGER}`);
  });

  it("names one overlap that gets shorter", () => {
    expect(sideEffectText(withChanges([], [change("Twin", 30, 20)]))).toBe(
      "Shortens the overlap with Twin from 30 to 20 min. No other overlap gets longer.",
    );
  });

  it("counts several overlaps shortened by one step", () => {
    const shrinks = [change("Lib", 60, 45), change("Cym", 60, 45), change("Sha", 30, 15)];
    expect(sideEffectText(withChanges([change("Joy", 0, 15)], shrinks))).toBe(
      "New 15 min overlap with Joy. Shortens 3 other overlaps by 15 min.",
    );
  });

  it("counts several overlaps shortened by different steps, or ending", () => {
    expect(sideEffectText(withChanges([], [change("Lib", 60, 45), change("Sha", 30, 20)]))).toBe(
      "Shortens or ends 2 other overlaps. No other overlap gets longer.",
    );
    expect(sideEffectText(withChanges([], [change("Lib", 15, 0), change("Sha", 30, 15)]))).toBe(
      "Shortens or ends 2 other overlaps. No other overlap gets longer.",
    );
  });

  it("says so when nothing else changes", () => {
    expect(sideEffectText(withChanges([], []))).toBe(NO_OTHER_LONGER);
  });

  it("builds the line for the fixture day's move", () => {
    expect(sideEffectText(moved().move!)).toBe(
      "New 15 min overlap with Cedar. Lengthens the overlap with Oak from 10 to 25 min. Shortens or ends 3 other overlaps.",
    );
  });

  it("names the same growing overlaps as the decision card's side-effects line", () => {
    const preset = makeDay();
    for (const raw of [LATER, TO_HILL]) {
      const move = model(preset, decide(raw)).move!;
      const slot = preset.festival.timetable.find((item) => item.act_id === "alder")!;
      const line = sideEffectsLine(
        preset.festival.timetable,
        new Map(preset.festival.acts.map((act) => [act.id, act.name])),
        { actId: "alder", name: "Alder", day: 0, start: slot.start, end: slot.end },
        { day: 0, start: move.to.start, end: move.to.end },
        "birch",
      );
      const [first, ...rest] = move.grows;
      const what = first.before === 0 ? `new ${first.after} min overlap` : `${first.before} → ${first.after} min overlap`;
      const more = rest.length === 0 ? "" : `; ${rest.length} more ${rest.length === 1 ? "overlap gets" : "overlaps get"} longer`;
      expect(line).toBe(`Also: Alder × ${first.name}, ${what}${more}.`);
    }
  });
});

describe("the notes", () => {
  const thread = (graph: DayGraphModel, rank: number) => graph.threads.find((item) => item.rank === rank)!;
  const set = (graph: DayGraphModel, name: string) => graph.sets.find((item) => item.name === name)!;

  it("describes a line as published, with its taste rank and both genres", () => {
    const graph = moved();
    expect(threadNote(graph, thread(graph, 1), "published")).toBe(
      "#1 of 9 clashes as published: Alder × Birch, 45 min shared (14:00–14:45). Taste overlap rank 91 of 100 on this bill (a rank, not attendance). Main genres: Post Rock, Folk Pop.",
    );
    // Without both genres, no genre sentence.
    expect(threadNote(graph, thread(graph, 3), "published")).toBe(
      "#3 of 9 clashes as published: Gum × Birch, 30 min shared (14:00–14:30). Taste overlap rank 55 of 100 on this bill (a rank, not attendance).",
    );
  });

  it("recomputes the minutes of a line that touches the mover in the moved view", () => {
    const graph = moved();
    expect(threadNote(graph, thread(graph, 1), "moved")).toBe(
      "#1 of 9 clashes as published: Alder × Birch, 45 min shared as published, 30 with the move (14:15–14:45). Taste overlap rank 91 of 100 on this bill (a rank, not attendance). Main genres: Post Rock, Folk Pop.",
    );
    expect(threadNote(graph, thread(graph, 5), "moved")).toBe(
      "#5 of 9 clashes as published: Oak × Alder, 10 min shared as published, 25 with the move (14:50–15:15). Taste overlap rank 80 of 100 on this bill (a rank, not attendance). Main genres: Shoegaze, Post Rock.",
    );
    expect(threadNote(graph, thread(graph, 8), "moved")).toBe(
      "#8 of 9 clashes as published: Elm × Alder, 10 min shared as published, none with the move. Taste overlap rank 25 of 100 on this bill (a rank, not attendance).",
    );
    // A line away from the mover reads the same in both views.
    expect(threadNote(graph, thread(graph, 3), "moved")).toBe(threadNote(graph, thread(graph, 3), "published"));
  });

  it("never calls an invented timetable published in a line note", () => {
    const graph = model(makeDay({ synthetic: true }), decide(LATER));
    expect(threadNote(graph, thread(graph, 1), "moved")).toBe(
      "#1 of 9 clashes before the move: Alder × Birch, 45 min shared before the move, 30 with the move (14:15–14:45). Invented taste overlap rank 91 of 100 on this invented bill (an invented rank, not attendance). Main genres: Post Rock, Folk Pop.",
    );
    expect(threadNote(graph, thread(graph, 8), "moved")).toBe(
      "#8 of 9 clashes before the move: Elm × Alder, 10 min shared before the move, none with the move. Invented taste overlap rank 25 of 100 on this invented bill (an invented rank, not attendance).",
    );
    expect(threadNote(graph, thread(graph, 3), "published")).toBe(
      "#3 of 9 clashes before the move: Gum × Birch, 30 min shared (14:00–14:30). Invented taste overlap rank 55 of 100 on this invented bill (an invented rank, not attendance).",
    );
  });

  it("describes a set, its lock, a missing signal and the mover's two places", () => {
    const graph = moved();
    expect(setNote(graph, set(graph, "Fir"), "published")).toBe("Fir, Main, 14:00–15:00.");
    expect(setNote(graph, set(graph, "Larch"), "moved")).toBe("Larch, Main, 12:00–13:00. Locked: this set stays put.");
    expect(setNote(graph, set(graph, "Kauri"), "published")).toBe("Kauri, Wood, 15:30–16:00. No Qloo signal: left out, not scored as zero.");
    expect(setNote(graph, set(graph, "Alder"), "published")).toBe("Alder, Wood, 14:00–15:00.");
    expect(setNote(graph, set(graph, "Alder"), "moved")).toBe("Alder, Wood, 14:15–15:15. Published 14:00–15:00; tested 14:15–15:15.");
    const hill = model(makeDay(), decide(TO_HILL));
    expect(setNote(hill, set(hill, "Alder"), "moved")).toBe("Alder, Hill, 16:30–17:30. Published 14:00–15:00; tested 16:30–17:30.");
  });

  it("describes an invented day's sets without the words published or Qloo", () => {
    const graph = model(makeDay({ synthetic: true }), decide(LATER));
    expect(setNote(graph, set(graph, "Kauri"), "published")).toBe("Kauri, Wood, 15:30–16:00. No taste signal: left out, not scored as zero.");
    expect(setNote(graph, set(graph, "Alder"), "moved")).toBe("Alder, Wood, 14:15–15:15. Before the move 14:00–15:00; tested 14:15–15:15.");
  });
});

describe("settledAnnouncement", () => {
  it("says what the moved drawing shows: the pair's minutes and the side effects", () => {
    expect(settledAnnouncement(moved(), "moved")).toBe(
      "Drawn with Alder 15 min later: 45 to 30 min shared with Birch. New 15 min overlap with Cedar. Lengthens the overlap with Oak from 10 to 25 min. Shortens or ends 3 other overlaps.",
    );
  });

  it("says what the published drawing shows", () => {
    expect(settledAnnouncement(moved(), "published")).toBe("Drawn as published: Alder and Birch share 45 min.");
  });

  it("says 'without the move' on the invented day", () => {
    const graph = model(makeDay({ synthetic: true }), decide(LATER));
    expect(settledAnnouncement(graph, "published")).toBe("Drawn without the move: Alder and Birch share 45 min.");
    expect(settledAnnouncement(graph, "moved")).toBe(settledAnnouncement(moved(), "moved"));
  });
});

describe("keyLine", () => {
  it("says what the lines are and what dashed means", () => {
    expect(keyLine(moved())).toBe(
      "Lines: the 8 costliest of 9 scored clashes (11 in all); thicker means a higher taste overlap rank. Dashed: published slot or new overlap.",
    );
  });

  it("has no dashed sentence without a move", () => {
    expect(keyLine(model(makeDay(), decide(null)))).toBe(
      "Lines: the 8 costliest of 9 scored clashes (11 in all); thicker means a higher taste overlap rank.",
    );
  });

  it("calls the rank invented on the invented day and never says published", () => {
    expect(keyLine(model(makeDay({ synthetic: true }), decide(LATER)))).toBe(
      "Lines: the 8 costliest of 9 scored clashes (11 in all); thicker means a higher invented taste overlap rank. Dashed: slot before the move or new overlap.",
    );
  });
});

describe("drawingTitle", () => {
  it("names the view on a published day", () => {
    const graph = moved();
    expect(drawingTitle(graph, "moved")).toBe("Mini Fest 2026, Sunday, drawn with Alder 15 min later: 12 sets on 5 stages");
    expect(drawingTitle(graph, "published")).toBe("Mini Fest 2026, Sunday, as published: 12 sets on 5 stages");
    expect(drawingTitle(model(makeDay(), decide(null)), "moved")).toBe("Mini Fest 2026, Sunday, as published: 12 sets on 5 stages");
  });

  it("names the view on the invented day, never as published", () => {
    const graph = model(makeDay({ synthetic: true }), decide(LATER));
    expect(drawingTitle(graph, "moved")).toBe("Mini Fest 2026, Sunday, invented timetable, drawn with Alder 15 min later: 12 sets on 5 stages");
    expect(drawingTitle(graph, "published")).toBe("Mini Fest 2026, Sunday, invented timetable, without the move: 12 sets on 5 stages");
    expect(drawingTitle(model(makeDay({ synthetic: true }), decide(null)), "published")).toBe(
      "Mini Fest 2026, Sunday, invented timetable: 12 sets on 5 stages",
    );
  });

  it("leaves 'published' out of every text the invented day's drawing prints", () => {
    for (const decision of [decide(LATER), decide(TO_HILL), decide(null), null]) {
      const graph = model(makeDay({ synthetic: true }), decision);
      const texts = [keyLine(graph)];
      for (const view of ["published", "moved"] as const) {
        texts.push(drawingTitle(graph, view), settledAnnouncement(graph, view));
        for (const item of graph.threads) texts.push(threadNote(graph, item, view));
        for (const item of graph.sets) texts.push(setNote(graph, item, view));
      }
      for (const text of texts) {
        expect(text).not.toMatch(/published/i);
        expect(text).not.toMatch(/Qloo/);
      }
    }
  });
});

describe("the phone window and rows", () => {
  /** The day without Cedar and Oak, so the move grows nothing, plus two clashes after the window. */
  function quietDay(): Preset {
    const sets = SETS.filter((spec) => spec.name !== "Cedar" && spec.name !== "Oak");
    const clashes = [
      pair(1, "Alder", "Birch", 45, 0.912, {}, sets),
      pair(2, "Fir", "Alder", 60, 0.62, {}, sets),
      pair(3, "Gum", "Birch", 30, 0.55, {}, sets),
      pair(4, "Elm", "Gum", 40, 0.4, {}, sets),
      pair(8, "Elm", "Alder", 10, 0.25, {}, sets),
      pair(9, "Juniper", "Ivy", 30, 0.3, {}, sets),
      pair(10, "Juniper", "Hazel", 15, 0.3, {}, sets),
    ];
    return makeDay({ sets, clashes });
  }

  it("frames the move, its partner and what grows, 15 minutes either side, on the half hour", () => {
    expect(moved().focus).toEqual({ start: 810, end: 990 });
  });

  it("widens a short window by half hours, first at the start, then at the end, to 150 minutes", () => {
    const quiet = model(quietDay(), decide(LATER));
    expect(quiet.move?.grows).toEqual([]);
    expect(quiet.focus).toEqual({ start: 780, end: 930 });
    const sets: SetSpec[] = [
      { name: "Xan", stage: "main", start: "14:00", end: "14:30" },
      { name: "Yew", stage: "hill", start: "14:00", end: "14:30" },
    ];
    const tiny = makeDay({ sets, clashes: [pair(1, "Xan", "Yew", 30, 0.5, {}, sets)], scored: 1, unscored: 0 });
    const move = { ...LATER, act_id: "yew", act: "Yew", from: "Hill 14:00-14:30", stage_id: "hill", stage: "Hill", start: "14:10", end: "14:40", minutes_moved: 10 };
    expect(model(tiny, decide(move, { a_id: "xan", b_id: "yew", rank: 1, minutes: 30 })).focus).toEqual({ start: 780, end: 930 });
  });

  it("is the whole day without a move", () => {
    expect(model(makeDay(), decide(null)).focus).toEqual({ start: 720, end: 1020 });
    expect(model(makeDay(), null).focus).toEqual({ start: 720, end: 1020 });
  });

  it("shows the mover's stages, the partner's and the stages of what grows, in stage order", () => {
    expect(moved().phoneRows).toEqual([2, 3, 4]);
    expect(model(makeDay(), decide(TO_HILL)).phoneRows).toEqual([1, 3, 4]);
  });

  it("pads from the stages holding the most ranked lines inside the window", () => {
    // Inside 13:00-15:30, Hill and Barn hold two lines each and Main one; across the whole day Main holds three.
    expect(model(quietDay(), decide(LATER)).phoneRows).toEqual([1, 3, 4]);
  });

  it("without a move, shows the chosen pair's stages padded the same way; without a decision, the busiest three", () => {
    expect(model(makeDay(), decide(null)).phoneRows).toEqual([0, 3, 4]);
    expect(model(makeDay(), null).phoneRows).toEqual([0, 1, 3]);
  });
});

describe("drawingHeight and the motion constants", () => {
  it("adds the axis to one row per stage on a desktop and one row per phone row below", () => {
    const graph = moved();
    expect(drawingHeight(graph, "desktop")).toBe(LAYOUT.desktop.axis + LAYOUT.desktop.row * 5);
    expect(drawingHeight(graph, "desktop")).toBe(342);
    expect(drawingHeight(graph, "phone")).toBe(172);
    expect(drawingHeight(graph, "short")).toBe(140);
    const tiny = buildDayGraph(parsePreset(rawTinyPreset()), null, 0)!;
    expect(tiny.phoneRows).toEqual([0, 1]);
    expect(drawingHeight(tiny, "desktop")).toBe(22 + 64 * 2);
    expect(drawingHeight(tiny, "phone")).toBe(24 + 8 + 14 + 42 * 2);
    expect(drawingHeight(tiny, "short")).toBe(14 + 42 * 2);
  });

  it("keeps the layout and the motion system's values", () => {
    expect(LAYOUT).toEqual({
      desktop: { axis: 22, row: 64, bar: 26 },
      phone: { overview: 24, gap: 8, axis: 14, row: 42, bar: 24 },
      short: { axis: 14, row: 42, bar: 24 },
    });
    expect([MOVE_MS, PAN_MS, TAG_MS]).toEqual([450, 300, 120]);
    expect(EASE_MOVE).toBe("cubic-bezier(0.65, 0, 0.35, 1)");
    expect(EASE_OUT).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
  });
});
