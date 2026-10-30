import { describe, expect, it } from "vitest";

import {
  buildDayGraph,
  drawingHeight,
  drawingTitle,
  EASE_MOVE,
  EASE_OUT,
  keyLine,
  LAYOUT,
  LEADER_MARKS,
  LEADER_MAX,
  leaderCandidates,
  lockWords,
  MOVE_MS,
  PAN_MS,
  planLeaders,
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
import {
  BANDS,
  CASING,
  HATCH_CLEAR,
  lineKeyAction,
  MARK_RADIUS,
  NOTE_GAP,
  notePlace,
  planDrawing,
  spotBox,
  strokeWidth,
  type LayoutPlan,
} from "./day-graph-motion";
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
    expect(drawingHeight(graph, "desktop")).toBe(22 + 70 * 5);
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
      "Lines: the 15 costliest of 20 scored clashes (22 in all), plus the chosen clash; thicker means a higher taste overlap rank. Lock: fixed by this app. Dotted: no Qloo signal.",
    );
  });

  it("leaves out a ranked clash whose sets are not both on the day", () => {
    const clashes = [...CLASHES, { ...pair(9, "Gum", "Alder", 30, 0.5), b: { act_id: "nobody", name: "Nobody", stage_id: "wood", genre: null } }];
    expect(model(makeDay({ clashes }), null).threads.map((thread) => thread.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("widens linearly with the taste rank, from 1px to 3px (the lines stay quieter than the answer)", () => {
    expect(threadWidth(0)).toBe(1);
    expect(threadWidth(100)).toBe(3);
    expect(threadWidth(50)).toBe(2);
    expect(threadWidth(91)).toBeCloseTo(2.82, 6);
  });

  it("draws every line, the chosen clash's included, on that one scale, so a thicker line always has the higher taste rank", () => {
    const threads = moved().threads.filter((thread) => thread.ranked);
    expect(threads.some((thread) => thread.lit)).toBe(true);
    for (const a of threads) {
      for (const b of threads) if (a.taste > b.taste) expect(strokeWidth(a), `${a.aName} × ${a.bName} against ${b.aName} × ${b.bName}`).toBeGreaterThan(strokeWidth(b));
    }
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
    // Larch is locked but plays before Fir and Juniper on Main, so the last-set rule is not stated.
    expect(setNote(graph, set(graph, "Larch"), "moved")).toBe("Larch, Main, 12:00–13:00. Locked by this app: kept in place.");
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

  it("says whose lock it is: this app's, with the last-set rule where the day keeps it; on the invented day, an invented fixed slot", () => {
    // As on both published days: the locked sets are exactly the last set on each of the five stages.
    const last = ["Juniper", "Ivy", "Cedar", "Kauri", "Hazel"];
    const published = model(makeDay({ sets: SETS.map((spec) => ({ ...spec, locked: last.includes(spec.name) })) }), decide(LATER));
    expect(setNote(published, set(published, "Juniper"), "published")).toBe(
      "Juniper, Main, 15:15–16:15. Locked by this app: the last set on its stage stays in place.",
    );
    expect(setNote(published, set(published, "Kauri"), "moved")).toBe(
      "Kauri, Wood, 15:30–16:00. Locked by this app: the last set on its stage stays in place. No Qloo signal: left out, not scored as zero.",
    );
    expect(lockWords(published)).toBe("Locked by this app: the last set on its stage stays in place.");
    // One more lock, before the last set on its stage, and the rule is no longer the day's.
    expect(lockWords({ ...published, sets: published.sets.map((item) => (item.name === "Fir" ? { ...item, locked: true } : item)) })).toBe(
      "Locked by this app: kept in place.",
    );
    // An unlocked last set breaks it too.
    expect(lockWords({ ...published, sets: published.sets.map((item) => (item.name === "Hazel" ? { ...item, locked: false } : item)) })).toBe(
      "Locked by this app: kept in place.",
    );
    const invented = model(makeDay({ synthetic: true }), decide(LATER));
    expect(setNote(invented, set(invented, "Larch"), "published")).toBe("Larch, Main, 12:00–13:00. Locked: an invented fixed slot.");
    const inventedLast = model(makeDay({ synthetic: true, sets: SETS.map((spec) => ({ ...spec, locked: last.includes(spec.name) })) }), decide(LATER));
    expect(lockWords(inventedLast)).toBe("Locked: an invented fixed slot.");
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
  it("says what the lines are, what dashed means, and what the lock and the dotted bars mean", () => {
    expect(keyLine(moved())).toBe(
      "Lines: the 8 costliest of 9 scored clashes (11 in all); thicker means a higher taste overlap rank. Dashed: published slot or new overlap. Lock: fixed by this app. Dotted: no Qloo signal.",
    );
  });

  it("has no dashed sentence without a move", () => {
    expect(keyLine(model(makeDay(), decide(null)))).toBe(
      "Lines: the 8 costliest of 9 scored clashes (11 in all); thicker means a higher taste overlap rank. Lock: fixed by this app. Dotted: no Qloo signal.",
    );
  });

  it("calls the rank invented on the invented day and never says published", () => {
    expect(keyLine(model(makeDay({ synthetic: true }), decide(LATER)))).toBe(
      "Lines: the 8 costliest of 9 scored clashes (11 in all); thicker means a higher invented taste overlap rank. Dashed: slot before the move or new overlap. Lock: invented fixed slot. Dotted: no taste signal.",
    );
  });

  it("says what the lock and the dotted bars mean in 9 words on a published day and 8 on the invented day, each only when the day draws that mark", () => {
    const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
    const published = keyLine(moved());
    const invented = keyLine(model(makeDay({ synthetic: true }), decide(LATER)));
    expect(published.endsWith(" Lock: fixed by this app. Dotted: no Qloo signal.")).toBe(true);
    expect(words("Lock: fixed by this app. Dotted: no Qloo signal.")).toBe(9);
    expect(invented.endsWith(" Lock: invented fixed slot. Dotted: no taste signal.")).toBe(true);
    expect(words("Lock: invented fixed slot. Dotted: no taste signal.")).toBe(8);
    expect(invented).not.toMatch(/Qloo|published/i);
    // A day with no lock says nothing of locks; a day where every set has a signal says nothing of dotted bars.
    const plain = SETS.map((spec) => ({ ...spec, locked: false, unscored: false }));
    expect(keyLine(model(makeDay({ sets: plain }), decide(LATER)))).toBe(
      "Lines: the 8 costliest of 9 scored clashes (11 in all); thicker means a higher taste overlap rank. Dashed: published slot or new overlap.",
    );
    expect(keyLine(model(makeDay({ sets: SETS.map((spec) => ({ ...spec, unscored: false })) }), decide(LATER)))).toMatch(/ Lock: fixed by this app\.$/);
    expect(keyLine(model(makeDay({ sets: SETS.map((spec) => ({ ...spec, locked: false })) }), decide(LATER)))).toMatch(/ Dotted: no Qloo signal\.$/);
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
  it("adds the axis to one row per stage on a desktop and one row per phone row below, with a phone's label lane under its last row", () => {
    const graph = moved();
    expect(drawingHeight(graph, "desktop")).toBe(LAYOUT.desktop.axis + LAYOUT.desktop.row * 5);
    expect(drawingHeight(graph, "desktop")).toBe(372);
    expect(drawingHeight(graph, "phone")).toBe(172);
    expect(drawingHeight(graph, "short")).toBe(140);
    const tiny = buildDayGraph(parsePreset(rawTinyPreset()), null, 0)!;
    expect(tiny.phoneRows).toEqual([0, 1]);
    expect(drawingHeight(tiny, "desktop")).toBe(22 + 70 * 2);
    expect(drawingHeight(tiny, "phone")).toBe(14 + 3 + 14 + 42 * 2 + 15);
    expect(drawingHeight(tiny, "short")).toBe(14 + 37 * 2 + 15);
  });

  it("keeps the layout and the motion system's values", () => {
    expect(LAYOUT).toEqual({
      desktop: { axis: 22, row: 70, bar: 32 },
      phone: { overview: 14, gap: 3, axis: 14, row: 42, bar: 18, foot: 15 },
      short: { axis: 14, row: 37, bar: 15, foot: 15 },
    });
    expect([MOVE_MS, PAN_MS, TAG_MS]).toEqual([450, 300, 120]);
    expect(EASE_MOVE).toBe("cubic-bezier(0.65, 0, 0.35, 1)");
    expect(EASE_OUT).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
  });
});

describe("the overlap a move ends", () => {
  // Riot Fest's shape, invented: Bowls for Supper (Radical) moves 20 minutes later, out of its 5 minutes with Twin
  // Pines (Rebel), which the side-effect line names and the report does not rank; its line runs beside the chosen
  // clash's window (Amaryllis Morrow on Roots to Bowls for Supper), whose left edge is its window's left edge.
  const sets: SetSpec[] = [
    { name: "The Formats", stage: "roots", start: "17:10", end: "18:10" },
    { name: "Amaryllis Morrow", stage: "roots", start: "19:20", end: "20:20", locked: true },
    { name: "Twin Pines", stage: "rebel", start: "18:30", end: "19:30" },
    { name: "Good Riddle", stage: "radical", start: "18:15", end: "18:55" },
    { name: "Bowls for Supper", stage: "radical", start: "19:25", end: "20:05" },
    { name: "Inkcap Clown Posse", stage: "radical", start: "20:55", end: "21:55" },
  ];
  const stages: [string, string][] = [
    ["roots", "Roots"],
    ["rebel", "Rebel"],
    ["radical", "Radical"],
  ];
  const clash = { a_id: "amaryllis morrow", b_id: "bowls for supper", rank: 1, minutes: 40 };
  const later: Raw = {
    ...LATER,
    act_id: "bowls for supper",
    act: "Bowls for Supper",
    from: "Radical 19:25-20:05",
    stage_id: "radical",
    stage: "Radical",
    start: "19:45",
    end: "20:25",
    minutes_moved: 20,
    minutes_shared_after: 35,
  };
  const graph = model(
    makeDay({ sets, stages, clashes: [pair(1, "Amaryllis Morrow", "Bowls for Supper", 40, 0.88, {}, sets), pair(2, "Twin Pines", "Good Riddle", 25, 0.5, {}, sets)] }),
    decide(later, clash),
  );
  const key = "bowls for supper~twin pines";

  it("draws it unranked, at least 2px wide, and only as published", () => {
    const thread = graph.threads.find((item) => `${item.aId}~${item.bId}` === key || `${item.bId}~${item.aId}` === key);
    expect(thread?.ranked).toBe(false);
    expect(thread?.moved?.window).toBeNull();
    expect(strokeWidth(thread!)).toBeGreaterThanOrEqual(2);
    expect(strokeWidth({ taste: 0, ranked: false })).toBe(2);
    expect(strokeWidth({ taste: 0, ranked: true })).toBe(threadWidth(0));
  });

  it("stands it 8px off the chosen clash's window where its own window allows, else as far as it allows, never outside its window", () => {
    const plans = [
      ...BANDS.desktop.map((band) => planDrawing(graph, "desktop", band.track)),
      ...BANDS.phone.map((band) => planDrawing(graph, "phone", band.track)),
      ...BANDS.short.map((band) => planDrawing(graph, "short", band.track)),
    ];
    for (const plan of plans) {
      const view = plan.views.published;
      const line = view.lines.find((item) => item.key === key || item.key === key.split("~").reverse().join("~"));
      const hatch = view.hatch;
      if (!line || !hatch) throw new Error(`${plan.layout} at ${plan.reference}px draws the line and the window`);
      expect(line.width).toBeGreaterThanOrEqual(2);
      expect(hatch.top < line.bottom && line.top < hatch.bottom).toBe(true);
      const x = (minute: number) => (minute - plan.track.start) * plan.scale;
      const at = x(line.mid) + line.off;
      expect(at - line.width / 2).toBeGreaterThanOrEqual(x(line.window.start) - 1e-6);
      expect(at + line.width / 2).toBeLessThanOrEqual(x(line.window.end) + 1e-6);
      const off = Math.min(Math.abs(at - x(hatch.window.start)), Math.abs(at - x(hatch.window.end)));
      const room = x(line.window.end) - x(hatch.window.start) - line.width / 2;
      expect(off, `${plan.layout} at ${plan.reference}px`).toBeGreaterThanOrEqual(Math.min(HATCH_CLEAR, Math.floor(room / 2) * 2) - 1e-6);
      // As far as its window allows: the far end of its own window, to within 0.02px.
      expect(off, `${plan.layout} at ${plan.reference}px`).toBeGreaterThanOrEqual(Math.min(HATCH_CLEAR, room - 0.02) - 1e-6);
      if (room >= HATCH_CLEAR) expect(off).toBeGreaterThanOrEqual(HATCH_CLEAR - 1e-6);
    }
    // At 1280px and up (a 1104px track) its 5 minutes leave room for the full 8px.
    const wide = planDrawing(graph, "desktop", BANDS.desktop[BANDS.desktop.length - 1].track);
    const line = wide.views.published.lines.find((item) => item.key === key || item.key === key.split("~").reverse().join("~"));
    expect(((line?.mid ?? 0) - (wide.views.published.hatch?.window.start ?? 0)) * wide.scale + (line?.off ?? 0)).toBeGreaterThanOrEqual(HATCH_CLEAR - 1e-6);
  });
});

describe("the keyboard note", () => {
  it("follows focus from line to line with the arrows, with no Enter, and Escape closes it and keeps focus", () => {
    const order = ["alder~birch", "fir~alder", "gum~birch"];
    expect(lineKeyAction(order, "alder~birch", "ArrowRight")).toEqual({ focus: "fir~alder", unpin: false });
    expect(lineKeyAction(order, "fir~alder", "ArrowLeft")).toEqual({ focus: "alder~birch", unpin: false });
    expect(lineKeyAction(order, "fir~alder", "End")).toEqual({ focus: "gum~birch", unpin: false });
    expect(lineKeyAction(order, "fir~alder", "Escape")).toEqual({ focus: null, unpin: true });
    // Enter and Space press the line's button, which pins its note: no focus move.
    expect(lineKeyAction(order, "fir~alder", "Enter")).toEqual({ focus: null, unpin: false });
  });

  it("never covers the two names of the line it describes", () => {
    const graph = moved();
    for (const band of BANDS.desktop) {
      const plan = planDrawing(graph, "desktop", band.track);
      for (const view of ["published", "moved"] as const) {
        const vp = plan.views[view];
        for (const line of vp.lines) {
          const x = (minute: number) => (minute - plan.track.start) * plan.scale;
          const names = [line.thread.aId, line.thread.bId].flatMap((id) => (vp.labels[id] ? [spotBox(plan, vp.labels[id])] : []));
          const bars = [line.thread.aId, line.thread.bId].flatMap((id) => {
            const item = vp.bars.find((entry) => entry.set.actId === id);
            return item ? [{ x0: x(item.span.start), x1: x(item.span.end), y0: item.top, y1: item.top + LAYOUT.desktop.bar }] : [];
          });
          const at = x(line.mid) + line.off;
          const parts = [{ x0: at - 4, x1: at + 4, y0: line.top, y1: line.bottom }, ...bars, ...names];
          const marks = {
            x0: Math.min(...parts.map((part) => part.x0)),
            x1: Math.max(...parts.map((part) => part.x1)),
            y0: Math.min(...parts.map((part) => part.y0)),
            y1: Math.max(...parts.map((part) => part.y1)),
          };
          const height = drawingHeight(graph, "desktop");
          const note = { width: 320, height: 72 };
          const place = notePlace(marks, { width: plan.reference, height }, note);
          const box =
            place.side === "left" || place.side === "right"
              ? { x0: place.x, x1: place.x + note.width, y0: place.y, y1: place.y + note.height }
              : place.side === "above"
                ? { x0: at - note.width / 2, x1: at + note.width / 2, y0: marks.y0 - NOTE_GAP - note.height, y1: marks.y0 - NOTE_GAP }
                : { x0: at - note.width / 2, x1: at + note.width / 2, y0: marks.y1 + NOTE_GAP, y1: marks.y1 + NOTE_GAP + note.height };
          for (const name of names) {
            const covers = box.x0 < name.x1 && name.x0 < box.x1 && box.y0 < name.y1 && name.y0 < box.y1;
            expect(covers, `${band.track} ${view}: the note of ${line.key} covers a name`).toBe(false);
          }
        }
      }
    }
  });
});

// The leader test plans every band of both days (about 3.8 s alone); under a loaded runner it passed the 5-second
// default (vitest flake), so this block allows 30 s. No assertion changes.
describe("the leaders", { timeout: 30_000 }, () => {
  type Box = { x0: number; x1: number; y0: number; y1: number };
  type Point = { x: number; y: number };
  const OUTSIDE = ["beside", "above", "below"];
  const clamp = (value: number, from: number, to: number) => Math.min(to, Math.max(from, value));
  const strictlyIn = (p: Point, box: Box) => p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1;
  const inset = (box: Box, by: number): Box => ({ x0: box.x0 + by, x1: box.x1 - by, y0: box.y0 + by, y1: box.y1 - by });
  /** A point's distance from a box's edge (0 on it). */
  const toBoxEdge = (p: Point, box: Box) => {
    const dx = Math.max(box.x0 - p.x, 0, p.x - box.x1);
    const dy = Math.max(box.y0 - p.y, 0, p.y - box.y1);
    if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
    return Math.min(p.x - box.x0, box.x1 - p.x, p.y - box.y0, box.y1 - p.y);
  };
  /** A point's distance from a bar's edge, its corners rounded as the drawing rounds them. */
  const toBarEdge = (p: Point, box: Box) => {
    const r = Math.min(MARK_RADIUS, (box.x1 - box.x0) / 2, (box.y1 - box.y0) / 2);
    const cx = clamp(p.x, box.x0 + r, box.x1 - r);
    const cy = clamp(p.y, box.y0 + r, box.y1 - r);
    return Math.abs(Math.hypot(p.x - cx, p.y - cy) - r);
  };
  /** The gap between a name's box and a bar with rounded corners: the length the shortest leader has. */
  const gapToBar = (name: Box, box: Box) => {
    const r = Math.min(MARK_RADIUS, (box.x1 - box.x0) / 2, (box.y1 - box.y0) / 2);
    const core = inset(box, r);
    const dx = Math.max(0, core.x0 - name.x1, name.x0 - core.x1);
    const dy = Math.max(0, core.y0 - name.y1, name.y0 - core.y1);
    return Math.max(0, Math.hypot(dx, dy) - r);
  };

  // Long invented names for most sets, so names sit outside their bars on a desktop too, as on the published days;
  // Alder and Birch keep theirs, so the decision still names them.
  const LONG: Record<string, string> = {
    Larch: "Larch Hollow Ensemble",
    Fir: "Fir Street Brass Collective",
    Juniper: "Juniper and the Night Ferries",
    Gum: "Gum Tree Choir",
    Oak: "Oakhaven",
    Ivy: "Ivy League of Strangers",
    Cedar: "Cedar Lane Orchestra",
    Kauri: "Kauri Sound System",
    Hazel: "Hazel and the Lantern Parade",
  };
  const long = (name: string) => LONG[name] ?? name;
  const longSets = SETS.map((spec) => ({ ...spec, name: long(spec.name) }));
  const longDay = makeDay({
    sets: longSets,
    clashes: [
      pair(3, long("Gum"), "Birch", 30, 0.55, {}, longSets),
      pair(1, "Alder", "Birch", 45, 0.912, { label: "hidden" }, longSets),
      pair(2, long("Fir"), "Alder", 60, 0.62, {}, longSets),
      pair(4, "Elm", long("Gum"), 40, 0.4, {}, longSets),
      pair(5, long("Oak"), "Alder", 10, 0.804, {}, longSets),
      pair(6, long("Fir"), "Birch", 45, 0.3, {}, longSets),
      pair(7, long("Cedar"), long("Juniper"), 45, 0.2, {}, longSets),
      pair(8, "Elm", "Alder", 10, 0.25, {}, longSets),
    ],
  });
  // The Riot Fest shape of "the overlap a move ends", invented.
  const riotSets: SetSpec[] = [
    { name: "The Formats", stage: "roots", start: "17:10", end: "18:10" },
    { name: "Amaryllis Morrow", stage: "roots", start: "19:20", end: "20:20", locked: true },
    { name: "Twin Pines", stage: "rebel", start: "18:30", end: "19:30" },
    { name: "Good Riddle", stage: "radical", start: "18:15", end: "18:55" },
    { name: "Bowls for Supper", stage: "radical", start: "19:25", end: "20:05" },
    { name: "Inkcap Clown Posse", stage: "radical", start: "20:55", end: "21:55" },
  ];
  const riotDay = makeDay({
    sets: riotSets,
    stages: [
      ["roots", "Roots"],
      ["rebel", "Rebel"],
      ["radical", "Radical"],
    ],
    clashes: [pair(1, "Amaryllis Morrow", "Bowls for Supper", 40, 0.88, {}, riotSets), pair(2, "Twin Pines", "Good Riddle", 25, 0.5, {}, riotSets)],
  });
  const riotMove: Raw = {
    ...LATER,
    act_id: "bowls for supper",
    act: "Bowls for Supper",
    from: "Radical 19:25-20:05",
    stage_id: "radical",
    stage: "Radical",
    start: "19:45",
    end: "20:25",
    minutes_moved: 20,
    minutes_shared_after: 35,
  };

  const fixtures: [string, DayGraphModel][] = [
    ["the day, moved later", moved()],
    ["the day, moved to Hill", model(makeDay(), decide(TO_HILL))],
    ["the day, no move", model(makeDay(), decide(null))],
    ["the day, no decision", model(makeDay(), null)],
    ["the invented day", model(makeDay({ synthetic: true }), decide(LATER))],
    ["long names, moved later", model(longDay, decide(LATER))],
    ["long names, moved to Hill", model(longDay, decide(TO_HILL))],
    ["long names, no move", model(longDay, decide(null))],
    ["the Riot Fest shape", model(riotDay, decide(riotMove, { a_id: "amaryllis morrow", b_id: "bowls for supper", rank: 1, minutes: 40 }))],
  ];
  const plansOf = (graph: DayGraphModel): LayoutPlan[] =>
    (["desktop", "phone", "short"] as const).flatMap((layout) => BANDS[layout].map((band) => planDrawing(graph, layout, band.track)));

  it("joins every name drawn outside its bar to that bar with one leader of at most 24px, from the nearest point of its box to the nearest point of the bar's edge, crossing no other bar, name, tag, window or line", () => {
    let drawn = 0;
    let dropped = 0;
    for (const [label, graph] of fixtures) {
      for (const plan of plansOf(graph)) {
        const leaders = planLeaders(graph, plan);
        const x = (minute: number) => (minute - plan.track.start) * plan.scale;
        const barBox = (place: { span: { start: number; end: number }; top: number }): Box => ({
          x0: x(place.span.start),
          x1: x(place.span.end),
          y0: place.top,
          y1: place.top + LAYOUT[plan.layout].bar,
        });
        for (const view of ["published", "moved"] as const) {
          const where = `${label}, ${plan.layout} at ${plan.reference}px, ${view}`;
          const vp = plan.views[view];
          const outside = Object.entries(vp.labels)
            .filter(([, spot]) => OUTSIDE.includes(spot.kind))
            .map(([id]) => id);
          const { leaders: lines, dropped: none } = leaders[view];
          expect([...lines.map((leader) => leader.id), ...none].sort(), `${where}: one leader or one drop per name outside its bar`).toEqual([...outside].sort());
          expect(none.length, `${where}: dropped ${none.join(", ")}`).toBeLessThanOrEqual(2);
          drawn += lines.length;
          dropped += none.length;
          for (const leader of lines) {
            const spot = vp.labels[leader.id];
            const own = vp.bars.find((item) => item.set.actId === leader.id);
            if (!own) throw new Error(`${where}: ${leader.id} has a leader and no bar`);
            const name = spotBox(plan, spot);
            const bar = barBox(own);
            const base = x(spot.anchor);
            expect(leader.anchor).toBe(spot.anchor);
            const a = { x: base + leader.x0, y: leader.y0 };
            const b = { x: base + leader.x1, y: leader.y1 };
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            expect(length, `${where}: ${leader.id}`).toBeLessThanOrEqual(LEADER_MAX);
            expect(length).toBeGreaterThan(0);
            expect(leader.length).toBeCloseTo(length, 6);
            expect(toBoxEdge(a, name), `${where}: ${leader.id} starts on its name's box`).toBeLessThanOrEqual(1);
            expect(toBarEdge(b, bar), `${where}: ${leader.id} ends on its bar's edge`).toBeLessThanOrEqual(1);
            expect(length, `${where}: ${leader.id} takes the shortest way`).toBeCloseTo(gapToBar(name, bar), 2);
            // What it may not cross: every other set's bar (and the published slot, except for the mover's own
            // leader, which may meet it only along the edge it shares with the moved bar), every other name, tag
            // and plate box inset 1px, every window, and every line's stroke.
            const walls: [string, Box][] = [
              ...vp.bars.filter((item) => item.set.actId !== leader.id).map((item): [string, Box] => [`the bar of ${item.set.name}`, barBox(item)]),
              ...(vp.ghost ? [["the published slot", vp.ghost.set.actId === leader.id ? inset(barBox(vp.ghost), 0.5) : barBox(vp.ghost)] as [string, Box]] : []),
              ...Object.entries(vp.labels)
                .filter(([id]) => id !== leader.id)
                .map(([id, other]): [string, Box] => [`the name of ${id}`, inset(spotBox(plan, other), 1)]),
              ...vp.tags.map((tag): [string, Box] => [`the tag ${tag.text}`, inset(spotBox(plan, tag.spot), 1)]),
              ...[...(vp.hatch ? [vp.hatch] : []), ...vp.created].map((window): [string, Box] => [
                `the window ${window.key}`,
                { x0: x(window.window.start), x1: x(window.window.end), y0: window.top, y1: window.bottom },
              ]),
              ...vp.lines.map((line): [string, Box] => {
                const at = x(line.mid) + line.off;
                return [`the line ${line.key}`, { x0: at - line.width / 2, x1: at + line.width / 2, y0: line.top, y1: line.bottom }];
              }),
            ];
            const steps = Math.ceil(length / 0.25);
            for (let i = 0; i <= steps; i += 1) {
              const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
              for (const [what, box] of walls) expect(strictlyIn(p, box), `${where}: the leader of ${leader.id} crosses ${what}`).toBe(false);
            }
          }
          // A name inside its bar has none.
          for (const [id, spot] of Object.entries(vp.labels)) {
            if (!OUTSIDE.includes(spot.kind)) expect(lines.some((leader) => leader.id === id), `${where}: ${id} sits inside its bar`).toBe(false);
          }
        }
      }
    }
    // The fixtures put names outside their bars at every width (fewer since a desktop's bars hold two lines: 222 now,
    // 300 and more before), and every one of them gets its leader.
    expect(drawn).toBeGreaterThan(200);
    expect(dropped).toBe(0);
  });

  it("gives a name that keeps its place in both views the same leader in both, so a leader only travels with its name", () => {
    let kept = 0;
    for (const [label, graph] of fixtures) {
      if (!graph.move) continue;
      for (const plan of plansOf(graph)) {
        const leaders = planLeaders(graph, plan);
        for (const leader of leaders.published.leaders) {
          if (leader.id === graph.move.actId) continue;
          const a = plan.views.published.labels[leader.id];
          const b = plan.views.moved.labels[leader.id];
          if (!b || JSON.stringify(a) !== JSON.stringify(b)) continue;
          expect(leaders.moved.leaders.find((other) => other.id === leader.id), `${label}, ${plan.layout} at ${plan.reference}px: ${leader.id}`).toEqual(leader);
          kept += 1;
        }
      }
    }
    expect(kept).toBeGreaterThan(50);
  });

  it("places a leader straight down from under a name's middle, straight across at a bar's middle, or from a corner to the rounded corner", () => {
    const bar = { x0: 0, x1: 100, y0: 18, y1: 44 };
    // On a plate above the bar's straight edge: from under the name's middle, 3px down.
    expect(leaderCandidates({ x0: 10, x1: 50, y0: 0, y1: 15 }, bar)[0]).toEqual({ x0: 30, y0: 15, x1: 30, y1: 18 });
    // Below it, the same way up.
    expect(leaderCandidates({ x0: 10, x1: 50, y0: 47, y1: 62 }, bar)[0]).toEqual({ x0: 30, y0: 47, x1: 30, y1: 44 });
    // A plate hanging past the bar's end: where the bar's straight edge stops, short of its rounded corner.
    expect(leaderCandidates({ x0: 90, x1: 130, y0: 0, y1: 15 }, bar)[0]).toEqual({ x0: 94, y0: 15, x1: 94, y1: 18 });
    // Beside the bar: straight across at the bar's middle, 4px.
    expect(leaderCandidates({ x0: 104, x1: 150, y0: 23.5, y1: 38.5 }, bar)[0]).toEqual({ x0: 104, y0: 31, x1: 100, y1: 31 });
    // Past the bar's corner: from the name's corner to the nearest point of the rounded corner.
    const corner = leaderCandidates({ x0: 101, x1: 140, y0: 0, y1: 15 }, bar);
    expect(corner).toHaveLength(1);
    expect(Math.hypot(corner[0].x1 - 94, corner[0].y1 - 24)).toBeCloseTo(MARK_RADIUS, 6);
    expect(Math.hypot(corner[0].x1 - corner[0].x0, corner[0].y1 - corner[0].y0)).toBeCloseTo(Math.hypot(7, 9) - MARK_RADIUS, 6);
    // Every place offered for one name is as short as the first.
    for (const ends of leaderCandidates({ x0: 10, x1: 50, y0: 0, y1: 15 }, bar)) expect(ends.y1 - ends.y0).toBe(3);
    // A name on its bar needs none; only places the reader sees are offered.
    expect(leaderCandidates({ x0: 10, x1: 50, y0: 20, y1: 35 }, bar)).toEqual([]);
    expect(leaderCandidates({ x0: 10, x1: 50, y0: 0, y1: 15 }, bar, 40, 200).every((ends) => ends.x0 >= 40.5)).toBe(true);
    expect(leaderCandidates({ x0: 104, x1: 150, y0: 23.5, y1: 38.5 }, bar, 0, 99)).toEqual([]);
  });

  it("keeps clear of the marks as the drawing draws them", () => {
    expect(LEADER_MARKS.corner).toBe(MARK_RADIUS);
    expect(LEADER_MARKS.casing).toBe(CASING);
    expect(LEADER_MAX).toBe(24);
  });
});
