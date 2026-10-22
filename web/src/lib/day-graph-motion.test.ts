import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildDayGraph, LAYOUT, MOVE_MS, planLeaders, threadWidth, type DayGraphModel } from "./day-graph";
import {
  BANDS,
  BAR_STUB,
  BENEATH_IN,
  barBottomOf,
  barTopOf,
  boxGap,
  CASING,
  CLEAR,
  clearPlace,
  detailAt,
  ELLIPSIS,
  flightKeyframes,
  flightStops,
  LABEL_GAP,
  labelRoom,
  LINE_CLEAR,
  LINE_GAP,
  LINE_SHIFT,
  lineTransform,
  LOCK_INSET,
  moveBreakpoints,
  moverAt,
  moverTransform,
  NAME_INSET,
  NAME_LINE,
  namePrefix,
  NARROW_TRACK,
  NOTE_GAP,
  NOTE_REACH,
  noteSide,
  OWN_RATIO,
  overlapX,
  placeNote,
  planDrawing,
  PLATE_OVER,
  PREFIX_MIN,
  retarget,
  sharedTag,
  spotBox,
  spreadLines,
  TAG_BAR_CLEAR,
  TAG_LINE,
  textWidth,
  trackOf,
  twoLines,
  viewP,
  WIDE_GAP,
  WIDE_GAP_TWO,
  WINDOW_INSET,
  windowAt,
  type Box,
  type LayoutPlan,
  type LineSlot,
  type PlanLine,
} from "./day-graph-motion";
import { parseDecision, type Decision } from "./decision";
import { rawTinyPreset } from "./fixtures/tiny-preset";
import { parsePreset, type Preset } from "./preset";

// Every name, time and figure below is invented for the test: the tiny preset fixture reshaped into a
// hand-made five-stage day. None of it is Qloo data or a saved festival day.

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type SetSpec = { name: string; stage: string; start: string; end: string; locked?: boolean; unscored?: boolean };

const STAGES: [string, string][] = [
  ["main", "Main"],
  ["hill", "Hill"],
  ["barn", "Barn"],
  ["wood", "Wood"],
  ["lake", "Lake"],
];
const idOf = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

/**
 * Alder (Wood 14:00-15:00) and Birch (Lake 14:00-14:45) share 45 minutes. Moving Alder 15 minutes later starts
 * an overlap with Cedar (0 -> 15), lengthens Oak's (10 -> 25), shortens Fir's and Gum's, and ends Elm's.
 */
const SETS: SetSpec[] = [
  { name: "Larch", stage: "main", start: "12:00", end: "13:00", locked: true },
  { name: "Fir", stage: "main", start: "14:00", end: "15:00" },
  { name: "Juniper", stage: "main", start: "15:15", end: "16:15" },
  { name: "Gum", stage: "hill", start: "13:30", end: "14:30" },
  { name: "Oak", stage: "hill", start: "14:50", end: "15:30" },
  { name: "Ivy", stage: "hill", start: "15:45", end: "16:30" },
  { name: "Elm", stage: "barn", start: "13:20", end: "14:10" },
  { name: "Cedar", stage: "barn", start: "15:00", end: "16:00" },
  { name: "Alder", stage: "wood", start: "14:00", end: "15:00" },
  { name: "Kauri", stage: "wood", start: "15:30", end: "16:00", unscored: true },
  { name: "Birch", stage: "lake", start: "14:00", end: "14:45" },
  { name: "Hazel", stage: "lake", start: "16:00", end: "17:00" },
];

function side(name: string, sets: readonly SetSpec[] = SETS): Raw {
  const spec = sets.find((item) => item.name === name);
  if (!spec) throw new Error(`no set ${name} in the fixture`);
  return { act_id: idOf(name), name, stage_id: spec.stage, genre: null };
}

function pair(rank: number, a: string, b: string, minutes: number, overlap: number, sets: readonly SetSpec[] = SETS): Raw {
  return {
    rank,
    a: side(a, sets),
    b: side(b, sets),
    day: 0,
    overlap_minutes: minutes,
    concurrency: 1,
    audience_overlap: overlap,
    draw: 0.5,
    regret: 0.1,
    regret_share: 0.1,
    label: null,
    confidence: "strong",
  };
}

const CLASHES: Raw[] = [
  pair(1, "Alder", "Birch", 45, 0.912),
  pair(2, "Fir", "Alder", 60, 0.62),
  pair(3, "Gum", "Birch", 30, 0.55),
  pair(4, "Elm", "Gum", 40, 0.4),
  pair(5, "Oak", "Alder", 10, 0.804),
  pair(6, "Fir", "Birch", 45, 0.3),
  pair(7, "Cedar", "Juniper", 45, 0.2),
  pair(8, "Elm", "Alder", 10, 0.25),
];

/** The day: the fixture's sets plus `extra`, or another invented day's `stages`, `sets` and `clashes`. */
function makeDay(synthetic = false, extra: SetSpec[] = [], base: { stages?: [string, string][]; sets?: SetSpec[]; clashes?: Raw[] } = {}): Preset {
  const sets = [...(base.sets ?? SETS), ...extra];
  const raw = rawTinyPreset() as Raw;
  raw.id = "mini-fest-sun";
  raw.title = "Mini Fest 2026, Sunday";
  raw.synthetic = synthetic;
  raw.festival.days = ["Sun"];
  raw.festival.stages = (base.stages ?? STAGES).map(([id, name], index) => ({ id, name, tier: index + 1, hours: [] }));
  raw.festival.acts = sets.map((spec) => ({ id: idOf(spec.name), name: spec.name, qloo_id: null, popularity: spec.unscored ? null : 0.5, genre: null, billing_tier: 2 }));
  raw.festival.timetable = sets.map((spec) => ({ act_id: idOf(spec.name), day: 0, stage_id: spec.stage, start: spec.start, end: spec.end, locked: spec.locked === true }));
  raw.report.clashes = base.clashes ?? CLASHES;
  raw.report.metrics = { ...raw.report.metrics, scored_concurrent_pairs: 9, unscored_concurrent_pairs: 2 };
  raw.report.coverage = {
    ...raw.report.coverage,
    unscored: sets.filter((spec) => spec.unscored).map((spec) => ({ act_id: idOf(spec.name), name: spec.name, reason: "no_signal" })),
    weak_act_ids: [],
  };
  return parsePreset(raw);
}

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

function decide(move: Raw | null, clash: Raw = { a_id: "alder", b_id: "birch", rank: 1, minutes: 45 }): Decision {
  const decision = parseDecision({
    kind: "decision",
    day: 0,
    skipped_locked: 0,
    skipped_no_place: 0,
    clash,
    published_budget: 108.4,
    move,
    rule: null,
  });
  if (!decision) throw new Error("the fixture decision did not parse");
  return decision;
}

function model(move: Raw | null = LATER, synthetic = false, extra: SetSpec[] = []): DayGraphModel {
  const built = buildDayGraph(makeDay(synthetic, extra), decide(move), 0);
  if (!built) throw new Error("no model for the fixture day");
  return built;
}

/** A move between two hand-made slots, for the pure geometry. */
const slide = (from: [number, number], to: [number, number]) => ({
  from: { start: from[0], end: from[1], stageIndex: 0 },
  to: { start: to[0], end: to[1], stageIndex: 0 },
});

describe("the move as a function of p", () => {
  const move = slide([840, 900], [900, 960]); // an hour later

  it("puts the mover at its published slot at 0, its moved slot at 1 and in between linearly", () => {
    expect(moverAt(move, 0)).toEqual({ start: 840, end: 900 });
    expect(moverAt(move, 1)).toEqual({ start: 900, end: 960 });
    expect(moverAt(move, 0.25)).toEqual({ start: 855, end: 915 });
  });

  it("finds the breakpoints where a mover edge crosses another set's edge, plus 0 and 1", () => {
    // Crossing: the mover's start passes the other's start at p 0.5.
    expect(moveBreakpoints(move, [{ start: 870, end: 990 }])).toEqual([0, 0.5, 1]);
    // Containing: the mover starts over a short set and leaves it, its start crossing 880 at p 2/3.
    expect(moveBreakpoints(slide([840, 900], [870, 930]), [{ start: 860, end: 880 }])).toEqual([0, expect.closeTo(2 / 3, 9), 1]);
    // Touching at the end of the move: the contact is at p 1, which is already a stop.
    expect(moveBreakpoints(slide([840, 900], [855, 915]), [{ start: 915, end: 960 }])).toEqual([0, 1]);
    // No contact at all.
    expect(moveBreakpoints(move, [{ start: 1200, end: 1260 }])).toEqual([0, 1]);
    // Several sets, deduplicated and sorted.
    expect(moveBreakpoints(move, [{ start: 930, end: 1000 }, { start: 870, end: 930 }])).toEqual([0, 0.5, 1]);
  });

  it("gives the exact shared window at each breakpoint and between them", () => {
    const other = { start: 870, end: 990 };
    expect(windowAt(move, other, 0)).toEqual({ start: 870, end: 900 });
    expect(windowAt(move, other, 0.25)).toEqual({ start: 870, end: 915 });
    expect(windowAt(move, other, 0.5)).toEqual({ start: 870, end: 930 });
    expect(windowAt(move, other, 0.75)).toEqual({ start: 885, end: 945 });
    expect(windowAt(move, other, 1)).toEqual({ start: 900, end: 960 });
    // Between two breakpoints each edge is linear in p, so keyframes at the breakpoints are exact.
    const at = (p: number) => windowAt(move, other, p) as { start: number; end: number };
    for (const p of [0.1, 0.3, 0.6, 0.9]) {
      const [lo, hi] = p < 0.5 ? [0, 0.5] : [0.5, 1];
      const t = (p - lo) / (hi - lo);
      expect(at(p).start).toBeCloseTo(at(lo).start + (at(hi).start - at(lo).start) * t, 9);
      expect(at(p).end).toBeCloseTo(at(lo).end + (at(hi).end - at(lo).end) * t, 9);
    }
  });

  it("is null when the overlap is empty, including at a contact point", () => {
    expect(windowAt(move, { start: 1200, end: 1260 }, 0.5)).toBeNull();
    expect(windowAt(slide([840, 900], [855, 915]), { start: 915, end: 960 }, 1)).toBeNull();
    // An overlap the move ends: 10 minutes at 0, gone from p 2/3 (the mover's start passes 850).
    const ending = slide([840, 900], [855, 915]);
    expect(windowAt(ending, { start: 800, end: 850 }, 0)).toEqual({ start: 840, end: 850 });
    expect(windowAt(ending, { start: 800, end: 850 }, 2 / 3)).toBeNull();
    expect(windowAt(ending, { start: 800, end: 850 }, 1)).toBeNull();
  });

  it("retargets from where the drawing is, with its share of the full duration", () => {
    expect(retarget(0, 1)).toEqual({ start: 0, duration: MOVE_MS });
    expect(retarget(0.4, 0)).toEqual({ start: 0.4, duration: expect.closeTo(0.4 * MOVE_MS, 9) });
    expect(retarget(0.4, 1).duration).toBeCloseTo(0.6 * MOVE_MS, 9);
  });

  it("orders a flight's stops in travel order, each with its offset", () => {
    expect(flightStops([0, 0.25, 0.5, 1], 0, 1)).toEqual([
      { p: 0, offset: 0 },
      { p: 0.25, offset: 0.25 },
      { p: 0.5, offset: 0.5 },
      { p: 1, offset: 1 },
    ]);
    expect(flightStops([0, 0.25, 0.5, 1], 0.4, 0)).toEqual([
      { p: 0.4, offset: 0 },
      { p: 0.25, offset: expect.closeTo(0.375, 9) },
      { p: 0, offset: 1 },
    ]);
  });
});

describe("spreadLines: lines that sit too close", () => {
  const slot = (key: string, x: number, extra: Partial<LineSlot> = {}): LineSlot => ({ key, x, top: 0, bottom: 40, half: 1, left: x - 30, right: x + 30, ...extra });

  it("moves each of a close pair half the shortfall, apart", () => {
    const out = spreadLines([slot("a", 100), slot("b", 102)]);
    expect(out.get("a")).toBeCloseTo(-2, 9);
    expect(out.get("b")).toBeCloseTo(2, 9);
    expect(102 + (out.get("b") ?? 0) - (100 + (out.get("a") ?? 0))).toBeCloseTo(LINE_GAP, 9);
  });

  it("leaves lines alone that are far enough apart or share no height", () => {
    const apart = spreadLines([slot("a", 100), slot("b", 110)]);
    expect([apart.get("a"), apart.get("b")]).toEqual([0, 0]);
    const stacked = spreadLines([slot("a", 100), slot("b", 100, { top: 50, bottom: 90 })]);
    expect([stacked.get("a"), stacked.get("b")]).toEqual([0, 0]);
  });

  it("never moves a line more than the cap, nor out of its own window", () => {
    const crowd = spreadLines([slot("a", 100), slot("b", 100), slot("c", 100), slot("d", 100)]);
    for (const value of crowd.values()) expect(Math.abs(value)).toBeLessThanOrEqual(LINE_SHIFT + 1e-9);
    // A 5px window with a 2px stroke leaves 1.5px each way.
    const narrow = spreadLines([slot("a", 100, { left: 97.5, right: 102.5 }), slot("b", 101)]);
    expect(narrow.get("a")).toBeGreaterThanOrEqual(-1.5 - 1e-9);
    expect(narrow.get("a")).toBeLessThanOrEqual(1.5 + 1e-9);
    // A window narrower than its stroke pins the line to its middle.
    const pinned = spreadLines([slot("a", 100, { left: 99.5, right: 100.5, half: 2 }), slot("b", 101)]);
    expect(pinned.get("a")).toBe(0);
  });
});

describe("clearPlace: a line clear of the names it crosses", () => {
  // 2px per minute; a 2px stroke (half 1) with its 2px casing and 1px of clear paper reaches 4px, 2 minutes.
  const window = { start: 100, end: 160 };

  it("keeps the window's middle when no name is in the way", () => {
    expect(clearPlace(window, 1, [], 2)).toEqual({ at: 130, room: { start: 100.5, end: 159.5 }, crosses: 0 });
    expect(clearPlace(window, 1, [{ start: 200, end: 240 }], 2)?.at).toBe(130);
  });

  it("moves to the clear point nearest the middle, and says how far it may still spread", () => {
    // A name covers 120-138: the middle is blocked from 118 to 140; 140 is nearer the middle than 118.
    expect(clearPlace(window, 1, [{ start: 120, end: 138 }], 2)).toEqual({ at: 140, room: { start: 140, end: 159.5 }, crosses: 0 });
    // A name covers 126-150: 124 is nearer than 152.
    expect(clearPlace(window, 1, [{ start: 126, end: 150 }], 2)).toEqual({ at: 124, room: { start: 100.5, end: 124 }, crosses: 0 });
    // Two names leave a gap between them.
    expect(clearPlace(window, 1, [{ start: 90, end: 122 }, { start: 134, end: 170 }], 2)).toEqual({ at: 130, room: { start: 124, end: 132 }, crosses: 0 });
  });

  it("crosses as few names as it can when none can be cleared, and keeps the middle when no point does better", () => {
    // One name over the whole window: every point crosses it, so the middle stays.
    expect(clearPlace(window, 1, [{ start: 100, end: 160 }], 2)).toEqual({ at: 130, room: { start: 100.5, end: 159.5 }, crosses: 1 });
    // Two names meeting at the middle: the middle crosses both, either side of it only one.
    expect(clearPlace(window, 1, [{ start: 95, end: 129 }, { start: 131, end: 165 }], 2)).toEqual({ at: 129, room: { start: 100.5, end: 129 }, crosses: 1 });
    // A window narrower than the stroke has no place to choose.
    expect(clearPlace({ start: 100, end: 100.5 }, 1, [], 2)).toBeNull();
  });

  it("holds the clearance at any wider track, where the name covers fewer minutes", () => {
    const place = clearPlace(window, 1, [{ start: 120, end: 138 }], 2);
    expect(place).not.toBeNull();
    for (const stretch of [1, 1.4, 2, 3]) {
      const scale = 2 * stretch;
      // The name's text ends `(138 - 120) * 2` px after its start at every width.
      const inkEnd = 120 * scale + (138 - 120) * 2;
      expect((place?.at ?? 0) * scale - 1 - CASING - inkEnd).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });
});

describe("noteSide: a note kept inside the drawing", () => {
  it("goes on the side of the mark with more room, its near edge 6px from the mark", () => {
    expect(noteSide(40, 60, 172)).toEqual({ above: false, offset: 60 + NOTE_GAP });
    expect(noteSide(120, 140, 172)).toEqual({ above: true, offset: 172 - 120 + NOTE_GAP });
    // Equal room: above, so the note never runs under the drawing first.
    expect(noteSide(76, 96, 172).above).toBe(true);
  });
});

describe("placeNote: a line's note off its neighbours", () => {
  const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const boxAt = (spot: { x: number; y: number }, note: { width: number; height: number }) => ({ x0: spot.x, x1: spot.x + note.width, y0: spot.y, y1: spot.y + note.height });

  it("takes the place beside, above or below the line's marks that covers the fewest other names, then bars, never its own marks", () => {
    const column = { width: 600, height: 300 };
    const note = { width: 200, height: 54 };
    // The line at x 300, its two sets' bars above and below it, their names on plates.
    const marks: Box[] = [
      { x0: 296, x1: 304, y0: 60, y1: 200 },
      { x0: 260, x1: 340, y0: 34, y1: 60 },
      { x0: 270, x1: 330, y0: 200, y1: 226 },
      { x0: 262, x1: 330, y0: 16, y1: 31 },
    ];
    // Names fill the left half; one name sits on the right at the marks' height.
    const names: Box[] = [
      { x0: 20, x1: 90, y0: 70, y1: 85 },
      { x0: 110, x1: 180, y0: 70, y1: 85 },
      { x0: 20, x1: 90, y0: 134, y1: 149 },
      { x0: 110, x1: 180, y0: 134, y1: 149 },
      { x0: 420, x1: 500, y0: 100, y1: 115 },
    ];
    const bars: Box[] = [
      { x0: 10, x1: 200, y0: 90, y1: 116 },
      { x0: 380, x1: 580, y0: 154, y1: 180 },
    ];
    const spot = placeNote(marks, names, bars, column, note, 300);
    const box = boxAt(spot, note);
    // Nothing of its own covered, and kept NOTE_GAP px off it.
    const kept = { x0: box.x0 - NOTE_GAP, x1: box.x1 + NOTE_GAP, y0: box.y0 - NOTE_GAP, y1: box.y1 + NOTE_GAP };
    for (const mark of marks) expect(overlaps(kept, mark)).toBe(false);
    // The counts it reports are what it covers, and no place in the drawing covers fewer.
    expect(spot.names).toBe(names.filter((name) => overlaps(box, name)).length);
    expect(spot.bars).toBe(bars.filter((bar) => overlaps(box, bar)).length);
    expect(spot.names).toBe(0);
    expect(spot.bars).toBe(0);
    expect(box.y0).toBeGreaterThanOrEqual(0);
    expect(box.y1).toBeLessThanOrEqual(column.height);
  });

  it("reaches just past the drawing's top or foot when every place inside covers more other names", () => {
    const column = { width: 400, height: 200 };
    const note = { width: 380, height: 54 };
    const marks: Box[] = [{ x0: 196, x1: 204, y0: 40, y1: 160 }];
    // A name every 20px down both sides: any place inside covers at least two.
    const names: Box[] = [];
    for (let y = 0; y < 200; y += 20) names.push({ x0: 10, x1: 150, y0: y, y1: y + 15 }, { x0: 250, x1: 390, y0: y, y1: y + 15 });
    const spot = placeNote(marks, names, [], column, note, 200);
    const box = boxAt(spot, note);
    expect(box.y0 < 0 || box.y1 > column.height).toBe(true);
    expect(box.y0).toBeGreaterThanOrEqual(-NOTE_REACH.top);
    expect(box.y1).toBeLessThanOrEqual(column.height + NOTE_REACH.bottom);
    for (const mark of marks) expect(overlaps(box, mark)).toBe(false);
    expect(spot.names).toBeLessThanOrEqual(1);
    // With room inside that covers nothing, it stays inside.
    const clear = placeNote(marks, names.filter((name) => name.y0 > 40), [], column, { width: 380, height: 30 }, 200);
    expect(clear.names).toBe(0);
    expect(clear.y).toBeGreaterThanOrEqual(0);
    expect(clear.y + 30).toBeLessThanOrEqual(column.height);
  });

  it("puts every desktop line's note of the test day over at most one other name and two other bars", () => {
    const m = model();
    const plan = planDrawing(m, "desktop", BANDS.desktop[2].track);
    const bar = LAYOUT.desktop.bar;
    const x = (minute: number) => (minute - plan.track.start) * plan.scale;
    const height = LAYOUT.desktop.axis + plan.rows.length * LAYOUT.desktop.row;
    for (const view of ["published", "moved"] as const) {
      const vp = plan.views[view];
      for (const line of vp.lines) {
        const own = [line.thread.aId, line.thread.bId];
        const lineX = x(line.mid) + line.off;
        const marks: Box[] = [
          { x0: lineX - 4, x1: lineX + 4, y0: line.top, y1: line.bottom },
          ...vp.bars.filter((item) => own.includes(item.set.actId)).map((item) => ({ x0: x(item.span.start), x1: x(item.span.end), y0: item.top, y1: item.top + bar })),
          ...own.flatMap((id) => (vp.labels[id] ? [spotBox(plan, vp.labels[id])] : [])),
        ];
        const names = [...Object.entries(vp.labels).filter(([id]) => !own.includes(id)).map(([, spot]) => spotBox(plan, spot)), ...vp.tags.map((tag) => spotBox(plan, tag.spot))];
        const bars = vp.bars.filter((item) => !own.includes(item.set.actId)).map((item) => ({ x0: x(item.span.start), x1: x(item.span.end), y0: item.top, y1: item.top + bar }));
        const spot = placeNote(marks, names, bars, { width: plan.reference, height }, { width: 320, height: 54 }, lineX);
        expect(spot.names, `${view} ${line.key}`).toBeLessThanOrEqual(1);
        expect(spot.bars, `${view} ${line.key}`).toBeLessThanOrEqual(2);
        for (const mark of marks) expect(overlaps(boxAt(spot, { width: 320, height: 54 }), mark)).toBe(false);
      }
    }
  });
});

describe("textWidth", () => {
  it("measures Archivo at 12.5px a little over its advance", () => {
    expect(textWidth("Sprints")).toBeGreaterThan(41.4);
    expect(textWidth("Sprints")).toBeLessThan(44);
    expect(textWidth("30 min shared")).toBeGreaterThan(80.5);
    expect(textWidth("Katy J Pearson")).toBeGreaterThan(textWidth("Katy J"));
  });
});

/** Every label box in a view, with its text, at the plan's reference scale or `stretch` times wider. */
function boxes(plan: LayoutPlan, view: "published" | "moved", stretch = 1) {
  const stretched = { track: plan.track, scale: plan.scale * stretch };
  return [
    ...Object.entries(plan.views[view].labels).map(([id, spot]) => ({ id, box: spotBox(stretched, spot) })),
    ...plan.views[view].tags.map((tag) => ({ id: `tag:${tag.key}`, box: spotBox(stretched, tag.spot) })),
  ];
}

const hit = (a: { x0: number; x1: number; y0: number; y1: number }, b: typeof a) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("planDrawing", () => {
  const m = model();

  it("draws every stage on a desktop and the phone rows on a phone, each bar at its row", () => {
    const desktop = planDrawing(m, "desktop");
    expect(desktop.rows).toEqual([0, 1, 2, 3, 4]);
    expect(planDrawing(m, "phone").rows).toEqual(m.phoneRows);
    for (const bar of desktop.views.published.bars) expect(bar.top).toBe(barTopOf("desktop", bar.row));
    expect(desktop.track).toEqual(trackOf(m));
  });

  it("draws lines touching the mover at their moved windows and drops the one the move ends", () => {
    const plan = planDrawing(m, "desktop");
    const byKey = (view: "published" | "moved") => new Map(plan.views[view].lines.map((line) => [line.key, line]));
    expect(byKey("published").get("alder~birch")?.window).toEqual({ start: 840, end: 885 });
    expect(byKey("moved").get("alder~birch")?.window).toEqual({ start: 855, end: 885 });
    expect(byKey("published").has("elm~alder")).toBe(true);
    expect(byKey("moved").has("elm~alder")).toBe(false);
    for (const line of plan.views.moved.lines) {
      expect(line.top).toBe(barBottomOf("desktop", line.upper));
      expect(line.bottom).toBe(barTopOf("desktop", line.lower));
      expect(line.width).toBe(threadWidth(line.thread.taste));
    }
  });

  it("keeps a window 2px clear of both its bars, and draws the grown windows only with the move", () => {
    const plan = planDrawing(m, "desktop");
    const hatch = plan.views.moved.hatch;
    expect(hatch?.window).toEqual({ start: 855, end: 885 });
    expect(hatch?.top).toBe(barBottomOf("desktop", hatch?.upper ?? 0) + WINDOW_INSET);
    expect(hatch?.bottom).toBe(barTopOf("desktop", hatch?.lower ?? 0) - WINDOW_INSET);
    expect(plan.views.published.created).toEqual([]);
    expect(plan.views.moved.created.map((item) => item.change.name)).toEqual(["Cedar", "Oak"]);
    expect(plan.views.moved.ghost?.span).toEqual({ start: 840, end: 900 });
    expect(plan.views.published.ghost).toBeNull();
  });

  it("tags only the published or the moved minutes (a desktop's moved view the published ones first), and the grown windows by what the move adds", () => {
    const plan = planDrawing(m, "desktop");
    expect(plan.views.published.tags.map((tag) => tag.text)).toEqual(["45 min shared"]);
    expect(plan.views.moved.tags.map((tag) => tag.text)).toEqual(["45 → 30 min shared", "new 15 min", "+15 min"]);
    // A phone, short or tall, keeps the moved minutes alone.
    for (const layout of ["phone", "short"] as const) {
      const small = planDrawing(m, layout);
      expect(small.views.published.tags.map((tag) => tag.text)).toContain("45 min shared");
      expect(small.views.moved.tags.map((tag) => tag.text)).toContain("30 min shared");
      expect([...small.views.published.tags, ...small.views.moved.tags].every((tag) => !tag.text.includes("→"))).toBe(true);
    }
    expect(sharedTag(30)).toBe("30 min shared");
    expect(sharedTag(30, 45)).toBe("45 → 30 min shared");
  });

  it("spreads lines apart inside their windows", () => {
    for (const layout of ["desktop", "phone", "short"] as const) {
      const plan = planDrawing(m, layout);
      for (const view of ["published", "moved"] as const) {
        for (const line of plan.views[view].lines) {
          expect(Math.abs(line.off)).toBeLessThanOrEqual(LINE_SHIFT);
          const x = (line.mid - plan.track.start) * plan.scale + line.off;
          expect(x - line.width / 2).toBeGreaterThanOrEqual((line.window.start - plan.track.start) * plan.scale - 1e-6);
          expect(x + line.width / 2).toBeLessThanOrEqual((line.window.end - plan.track.start) * plan.scale + 1e-6);
        }
      }
    }
  });

  it("places every featured name and tag clear of every other bar, window and label, at the narrowest track and wider", () => {
    const plans = [
      planDrawing(m, "desktop"),
      planDrawing(m, "phone"),
      planDrawing(m, "phone", NARROW_TRACK),
      planDrawing(m, "short"),
      planDrawing(m, "short", NARROW_TRACK),
    ];
    for (const plan of plans) {
      const { layout } = plan;
      for (const view of ["published", "moved"] as const) {
        for (const stretch of [1, 1.4, 2]) {
          const scale = plan.scale * stretch;
          const x = (minute: number) => (minute - plan.track.start) * scale;
          const vp = plan.views[view];
          const labels = boxes(plan, view, stretch);
          const bar = LAYOUT[layout].bar;
          const obstacles = [
            ...vp.bars.map((item) => ({ id: item.set.actId, box: { x0: x(item.span.start), x1: x(item.span.end), y0: item.top, y1: item.top + bar } })),
            ...[vp.hatch, ...vp.created].flatMap((w) => (w ? [{ id: "window", box: { x0: x(w.window.start), x1: x(w.window.end), y0: w.top, y1: w.bottom } }] : [])),
          ];
          for (const label of labels) {
            for (const other of obstacles) if (other.id !== label.id) expect(hit(label.box, other.box), `${layout} ${view} x${stretch}: ${label.id} on ${other.id}`).toBe(false);
            for (const other of labels) if (other !== label) expect(hit(label.box, other.box), `${layout} ${view}: ${label.id} on ${other.id}`).toBe(false);
            // On a phone every name and tag sits inside the detail window the drawing opens on.
            if (layout !== "desktop") {
              expect(label.box.x0, `${layout} ${view}: ${label.id} left of the window`).toBeGreaterThanOrEqual(x(m.focus.start) - 1e-6);
              expect(label.box.x1, `${layout} ${view}: ${label.id} right of the window`).toBeLessThanOrEqual(x(m.focus.end) + 1e-6);
            }
          }
        }
      }
    }
  });
});

/** Three half-hour sets with long names packed end to end on Barn after Cedar: too short for their names on a narrow track. */
const CROWDED: SetSpec[] = [
  { name: "Cottonwood Collective", stage: "barn", start: "16:00", end: "16:30" },
  { name: "Dogwood Brass Quartet", stage: "barn", start: "16:30", end: "17:00" },
  { name: "Eucalyptus Revival", stage: "barn", start: "17:00", end: "17:30" },
];
/** A ten-minute set on Main with an empty stretch of the row after it, before Fir. */
const YARROW: SetSpec = { name: "Yarrow Ensemble", stage: "main", start: "13:00", end: "13:10" };
/** A set on Barn between Elm and Cedar whose name is more than twice as wide as its bar on a narrow track. */
const LONG: SetSpec = { name: "Sassafras Night Choir Orchestra", stage: "barn", start: "14:10", end: "15:00" };

describe("planDrawing: a name with no whole place", () => {
  const m = model(LATER, false, [...CROWDED, LONG]);

  it("is cut to a prefix of at least 8 characters from its bar's start, ending in an ellipsis inside its bar, never running on to the next bar", () => {
    // On ever narrower tracks some name finds no whole place inside, beside, above or below its bar.
    let cuts = 0;
    for (const layout of ["desktop", "phone"] as const) {
      for (const reference of layout === "desktop" ? [400, 500, 600, 700] : [60, 90, 120, 150]) {
        const plan = planDrawing(m, layout, reference);
        const x = (minute: number) => (minute - plan.track.start) * plan.scale;
        for (const view of ["published", "moved"] as const) {
          const bars = plan.views[view].bars;
          for (const [id, spot] of Object.entries(plan.views[view].labels)) {
            if (spot.kind !== "prefix") continue;
            cuts += 1;
            const own = bars.find((item) => item.set.actId === id);
            if (!own) throw new Error(`no bar for ${id}`);
            const text = spot.lines[0];
            expect(spot.slot).toBe("d");
            expect(text.endsWith(ELLIPSIS)).toBe(true);
            expect([...text.slice(0, -1)].length).toBeGreaterThanOrEqual(PREFIX_MIN);
            expect(own.set.name.startsWith(text.slice(0, -1))).toBe(true);
            expect(own.set.featured).toBe(false);
            // From its bar's start (or the start of what a phone shows of it), ending inside its bar.
            const box = spotBox(plan, spot);
            const from = layout === "desktop" ? own.span.start : Math.max(own.span.start, m.focus.start);
            expect(box.x0).toBeGreaterThanOrEqual(x(from) - 1e-6);
            expect(box.x1).toBeLessThanOrEqual(x(own.span.end) + 1e-6);
            const next = bars
              .filter((item) => item.set.actId !== id && item.top === own.top && item.span.start >= own.span.end)
              .reduce((nearest, item) => Math.min(nearest, item.span.start), Number.POSITIVE_INFINITY);
            expect(box.x1).toBeLessThan(x(next));
          }
        }
      }
    }
    expect(cuts).toBeGreaterThan(0);
  });

  it("keeps at least 8 characters before the ellipsis, drops a trailing space or ampersand, and cuts nothing that fits", () => {
    const name = "Abel Selaocoe & the Bantu Ensemble";
    expect(namePrefix(name, textWidth(name, 12.5, 500), 500)).toBeNull();
    const cut = namePrefix(name, 80, 500);
    expect(cut).toMatch(new RegExp(`^Abel Sel[a-z]*${ELLIPSIS}$`));
    expect(textWidth(cut ?? "", 12.5, 500)).toBeLessThanOrEqual(80);
    // At the room of "Abel Selaocoe &" plus an ellipsis, the ampersand and the space before it go.
    expect(namePrefix(name, textWidth(`Abel Selaocoe &${ELLIPSIS}`, 12.5, 500), 500)).toBe(`Abel Selaocoe${ELLIPSIS}`);
    // Too little room for 8 characters: no prefix at all.
    expect(namePrefix(name, textWidth(`Abel Se${ELLIPSIS}`, 12.5, 500), 500)).toBeNull();
    expect(namePrefix("Cottonwood Collective", textWidth(`Cottonwoo${ELLIPSIS}`, 12.5, 500), 500)).toBe(`Cottonwoo${ELLIPSIS}`);
  });

  it("is left out only when nothing else fits, and only on a phone or at the narrowest desktop band, its bar still in the drawing", () => {
    const m = model(LATER, false, CROWDED);
    for (const layout of ["desktop", "phone"] as const) {
      for (const reference of layout === "desktop" ? [400, 600, ...BANDS.desktop.map((band) => band.track)] : [60, 120, ...BANDS.phone.map((band) => band.track)]) {
        const plan = planDrawing(m, layout, reference);
        for (const view of ["published", "moved"] as const) {
          const vp = plan.views[view];
          for (const [id, slot] of Object.entries(vp.slots)) {
            if (slot !== "e") continue;
            expect(vp.labels[id]).toBeUndefined();
            expect(vp.bars.some((item) => item.set.actId === id)).toBe(true);
            if (layout === "desktop") expect(reference).toBeLessThanOrEqual(BANDS.desktop[0].track);
          }
        }
      }
    }
    // At every desktop band above the narrowest every set of the fixture is named.
    for (const band of BANDS.desktop.slice(1)) {
      for (const view of ["published", "moved"] as const) expect(Object.values(planDrawing(m, "desktop", band.track).views[view].slots)).not.toContain("e");
    }
  });
});

describe("planDrawing: lines clear of the names they cross", () => {
  // Yew (Barn 14:20-14:50) sits under the middle of Fir x Birch's window (14:00-14:45, Main to Lake), so that
  // line moves left of Yew's name; nothing else about the day changes.
  const m = model(LATER, false, [{ name: "Yew", stage: "barn", start: "14:20", end: "14:50" }]);

  /**
   * The bars a line crosses whose name (or lock) its stroke and casing come within reach of at `scale`: a name
   * inside a bar keeps its px width at any scale; a lock takes the bar's first NAME_INSET + LOCK_INSET px.
   */
  function crossedNames(plan: LayoutPlan, day: DayGraphModel, view: "published" | "moved", key: string, scale: number) {
    const vp = plan.views[view];
    const line = vp.lines.find((item) => item.key === key);
    if (!line) return [];
    const x = (line.mid - plan.track.start) * scale + line.off;
    const reach = line.width / 2 + CASING;
    return vp.bars
      .filter((item) => item.row > line.upper && item.row < line.lower)
      .filter((item) => {
        const spot = vp.labels[item.set.actId];
        const name = spot && (spot.kind === "inside" || spot.kind === "prefix") ? spotBox({ track: plan.track, scale }, spot) : null;
        const start = plan.layout === "desktop" ? item.span.start : Math.max(item.span.start, day.focus.start);
        const from = (start - plan.track.start) * scale;
        const lock = item.set.locked ? { x0: from, x1: from + NAME_INSET + LOCK_INSET } : null;
        return [name, lock].some((box) => box !== null && !(x + reach <= box.x0 || x - reach >= box.x1));
      })
      .map((item) => item.set.name);
  }

  it("stands every line clear of the names inside the bars it crosses, or beneath those bars, at the narrowest track and wider", () => {
    let moved = 0;
    for (const layout of ["desktop", "phone", "short"] as const) {
      for (const reference of layout === "desktop" ? [undefined] : [undefined, NARROW_TRACK]) {
        const plan = planDrawing(m, layout, reference);
        for (const view of ["published", "moved"] as const) {
          for (const line of plan.views[view].lines) {
            const middle = (line.window.start + line.window.end) / 2;
            if (line.mid !== middle) moved += 1;
            for (const stretch of [1, 1.4, 2]) {
              const through = crossedNames(plan, m, view, line.key, plan.scale * stretch);
              // A line that cannot clear a name passes beneath that bar, which hides it there.
              if (!line.under) expect(through, `${layout} ${view} x${stretch}: ${line.key} through ${through.join(", ")}`).toEqual([]);
            }
            // It never leaves its window.
            const x = (line.mid - plan.track.start) * plan.scale + line.off;
            expect(x - line.width / 2).toBeGreaterThanOrEqual((line.window.start - plan.track.start) * plan.scale - 1e-6);
            expect(x + line.width / 2).toBeLessThanOrEqual((line.window.end - plan.track.start) * plan.scale + 1e-6);
          }
        }
      }
    }
    // Fir x Birch did move off its middle, left of Yew.
    const fir = planDrawing(m, "desktop").views.published.lines.find((line) => line.key === "fir~birch");
    expect(fir?.mid).toBeLessThan((840 + 885) / 2);
    expect(fir?.mid).toBeGreaterThan(840);
    expect(moved).toBeGreaterThan(0);
  });

  it("routes the mover's lines and the chosen clash like every other line, each a fixed share of the way across its window", () => {
    const plan = planDrawing(m, "desktop");
    for (const view of ["published", "moved"] as const) {
      for (const line of plan.views[view].lines.filter((item) => item.moving || item.thread.lit)) {
        expect(line.frac).toBeGreaterThanOrEqual(0);
        expect(line.frac).toBeLessThanOrEqual(1);
        expect(line.mid).toBeCloseTo(line.window.start + line.frac * (line.window.end - line.window.start), 9);
      }
    }
    // The chosen clash has nothing in its way here and stands at the middle of its window in both views.
    for (const view of ["published", "moved"] as const) {
      const lit = plan.views[view].lines.find((line) => line.thread.lit);
      expect(lit?.mid).toBe(((lit?.window.start ?? 0) + (lit?.window.end ?? 0)) / 2);
    }
  });

  it("clears a lock at the start of a bar it crosses, and never meets a featured name inside a bar: those sit outside it", () => {
    const locked = model(LATER, false, [{ name: "Yew", stage: "barn", start: "14:20", end: "14:50", locked: true }]);
    let checked = 0;
    for (const layout of ["desktop", "phone", "short"] as const) {
      const plan = planDrawing(locked, layout);
      for (const view of ["published", "moved"] as const) {
        for (const line of plan.views[view].lines) {
          checked += 1;
          if (!line.under) expect(crossedNames(plan, locked, view, line.key, plan.scale), `${layout} ${view}: ${line.key}`).toEqual([]);
        }
        for (const set of locked.sets.filter((item) => item.featured)) {
          const bar = plan.views[view].bars.find((item) => item.set.actId === set.actId);
          if (!bar || (layout !== "desktop" && (bar.span.end <= locked.focus.start || bar.span.start >= locked.focus.end))) continue;
          expect(["above", "below", "beside"], `${layout} ${view}: ${set.name}`).toContain(plan.views[view].labels[set.actId]?.kind);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    // Fir x Birch crosses Barn over Yew's lock at its middle, so it stands left of the lock (or beneath Yew's bar).
    const plan = planDrawing(locked, "desktop");
    const fir = plan.views.published.lines.find((line) => line.key === "fir~birch");
    const yew = plan.views.published.bars.find((item) => item.set.actId === "yew");
    if (!fir || !yew) throw new Error("the fixture draws Fir x Birch and Yew");
    const x = (fir.mid - plan.track.start) * plan.scale + fir.off;
    const lockFrom = (yew.span.start - plan.track.start) * plan.scale;
    expect(fir.under || x + fir.width / 2 + CASING <= lockFrom || x - fir.width / 2 - CASING >= lockFrom + NAME_INSET + LOCK_INSET).toBe(true);
  });
});

describe("flightKeyframes", () => {
  const m = model();
  const plan = planDrawing(m, "desktop");
  const move = m.move;
  if (!move) throw new Error("the fixture has a move");

  it("moves the mover's layer from its published to its moved place, exact at both ends", () => {
    const frames = flightKeyframes(m, plan, 0, 1);
    const mover = frames.mover;
    expect(mover[0]).toMatchObject({ offset: 0, transform: moverTransform(plan.track, move, 0) });
    expect(mover.at(-1)).toMatchObject({ offset: 1, transform: moverTransform(plan.track, move, 1) });
    for (let i = 1; i < mover.length; i += 1) expect(mover[i].offset).toBeGreaterThanOrEqual(mover[i - 1].offset);
  });

  it("ends each moving line exactly where the settled view draws it", () => {
    const forward = flightKeyframes(m, plan, 0, 1)["line:alder~birch"];
    const there = plan.views.moved.lines.find((line) => line.key === "alder~birch");
    const here = plan.views.published.lines.find((line) => line.key === "alder~birch");
    expect(forward[0].transform).toBe(lineTransform(plan.track, here?.mid ?? 0, here?.off ?? 0));
    expect(forward.at(-1)?.transform).toBe(lineTransform(plan.track, there?.mid ?? 0, there?.off ?? 0));
  });

  it("drops a line at the exact p its overlap ends: two keyframes at one offset, never a fade", () => {
    const frames = flightKeyframes(m, plan, 0, 1)["line:elm~alder"];
    // Elm ends at 14:10; Alder's start passes it at p 10/15.
    const at = frames.filter((frame) => Math.abs(frame.offset - 2 / 3) < 1e-9);
    expect(at.map((frame) => frame.opacity)).toEqual([1, 0]);
    expect(frames[0].opacity).toBe(1);
    expect(frames.at(-1)?.opacity).toBe(0);
    expect(frames.every((frame) => frame.opacity === 0 || frame.opacity === 1)).toBe(true);
  });

  it("brings the published slot's ghost in with the move and back out with the return", () => {
    expect(flightKeyframes(m, plan, 0, 1).ghost.map((frame) => frame.opacity)[0]).toBe(0);
    expect(flightKeyframes(m, plan, 0, 1).ghost.at(-1)?.opacity).toBe(1);
    expect(flightKeyframes(m, plan, 1, 0).ghost.at(-1)?.opacity).toBe(0);
  });

  it("starts a retarget at the interrupted p and keyframes only what lies ahead", () => {
    const frames = flightKeyframes(m, plan, 0.4, 0).mover;
    expect(frames[0]).toMatchObject({ offset: 0, transform: moverTransform(plan.track, move, 0.4) });
    expect(frames.at(-1)).toMatchObject({ offset: 1, transform: moverTransform(plan.track, move, 0) });
  });

  it("crossfades the mover and its lines between the two rows when the move changes stage", () => {
    // Alder from Wood to Hill at 16:30: it leaves every overlap it had, so its lines go and nothing is created.
    const toHill: Raw = { ...LATER, stage_id: "hill", stage: "Hill", start: "16:30", end: "17:30", minutes_moved: 150, stage_changed: true, minutes_shared_after: 0 };
    const hill = model(toHill);
    const frames = flightKeyframes(hill, planDrawing(hill, "desktop"), 0, 1);
    expect(frames.mover).toBeUndefined();
    expect(frames["mover@0"][0].opacity).toBe(1);
    expect(frames["mover@0"].at(-1)?.opacity).toBe(0);
    expect(frames["mover@1"][0].opacity).toBe(0);
    expect(frames["mover@1"].at(-1)?.opacity).toBe(1);
    expect(frames["hatch@0"].at(-1)?.opacity).toBe(0);
    expect(frames["line:alder~birch@1"].at(-1)?.opacity).toBe(0);
    expect(planDrawing(hill, "desktop").views.moved.lines.some((line) => line.moving)).toBe(false);
  });

  it("creates nothing without a move, or for a flight that goes nowhere", () => {
    const still = model(null);
    expect(flightKeyframes(still, planDrawing(still, "desktop"), 0, 1)).toEqual({});
    expect(flightKeyframes(m, plan, 1, 1)).toEqual({});
    expect(viewP(still, "moved")).toBe(0);
    expect(viewP(m, "moved")).toBe(1);
  });
});

// ------------------------------------------------------------------------------------ the drawing's rules on any plan

type View = "published" | "moved";

/** The two bars a tag belongs to: those of the window it names. */
function tagOwners(m: DayGraphModel, key: string): string[] {
  if (!m.move) {
    const lit = m.threads.find((thread) => thread.lit);
    return lit ? [lit.aId, lit.bId] : [];
  }
  return key === "hatch" ? [m.move.actId, m.move.partnerId] : [m.move.actId, key.replace(/^created:/, "")];
}

/**
 * Every way a plan breaks the drawing's rules at `stretch` times its track, as readable lines; none when it keeps
 * them all. Featured names whole and outside their bars (slot b or c); every name and tag on the paper 2px clear of
 * every other set's bar, window and label (a tag 1px from another set's bar on a phone) and 1px or more from its own
 * bars without touching them; every name nearer its own bar than any other; a plate at least half over its own bar;
 * a name beside its bar starting within 8px of its end and stopping 6px short of the next bar; a prefix of at least
 * 8 characters; every label on the drawing (a phone's inside its detail window); no line's painted stroke inside a
 * label's box inset 1px (sampled every 1px down the line, less what a bar drawn over a line beneath it hides); and
 * every line inside its own window.
 */
function problemsOf(m: DayGraphModel, plan: LayoutPlan, stretch = 1): string[] {
  const out: string[] = [];
  const { layout } = plan;
  const desktop = layout === "desktop";
  const bar = LAYOUT[layout].bar;
  const scale = plan.scale * stretch;
  const at = { track: plan.track, scale };
  const x = (minute: number) => (minute - plan.track.start) * scale;
  const lo = x(desktop ? plan.track.start : Math.max(plan.track.start, m.focus.start));
  const hi = x(desktop ? plan.track.end : Math.min(plan.track.end, m.focus.end));
  // The band's label area: the track under the axis (the widest desktop band reaching 2px past the axis's foot and
  // the drawing's foot; a phone's label lane under its last row included).
  const { ceiling, floor } = labelRoom(layout, plan.reference, plan.rows.length);
  const name = (id: string) => m.sets.find((set) => set.actId === id)?.name ?? id;
  const seen = (box: Box): Box => ({ ...box, x0: Math.max(box.x0, lo), x1: Math.min(box.x1, hi) });
  for (const view of m.move ? (["published", "moved"] as View[]) : (["published"] as View[])) {
    const vp = plan.views[view];
    const marks = [
      ...vp.bars.map((item) => ({ id: item.set.actId, row: item.row, box: { x0: x(item.span.start), x1: x(item.span.end), y0: item.top, y1: item.top + bar } })),
      ...(vp.ghost
        ? [{ id: vp.ghost.set.actId, row: vp.ghost.row, box: { x0: x(vp.ghost.span.start), x1: x(vp.ghost.span.end), y0: vp.ghost.top, y1: vp.ghost.top + bar } }]
        : []),
    ];
    const windows = [vp.hatch, ...vp.created].flatMap((w) => (w ? [{ x0: x(w.window.start), x1: x(w.window.end), y0: w.top, y1: w.bottom }] : []));
    const labels = [
      ...Object.entries(vp.labels).map(([id, spot]) => ({ id, who: name(id), tag: false, spot, box: spotBox(at, spot), owners: [id] })),
      ...vp.tags.map((tag) => ({ id: tag.key, who: `tag "${tag.text}"`, tag: true, spot: tag.spot, box: spotBox(at, tag.spot), owners: tagOwners(m, tag.key) })),
    ];
    for (const set of m.sets.filter((item) => item.featured)) {
      const own = vp.bars.find((item) => item.set.actId === set.actId);
      if (!own || Math.min(x(own.span.end), hi) - Math.max(x(own.span.start), lo) <= 0) continue;
      const slot = vp.slots[set.actId];
      if (slot !== "b" && slot !== "c") out.push(`${view}: featured ${set.name} in slot ${slot ?? "none"}`);
      const text = vp.labels[set.actId]?.lines.join(" ");
      if (text !== set.name) out.push(`${view}: featured ${set.name} reads "${text ?? ""}"`);
    }
    for (const [id, slot] of Object.entries(vp.slots)) {
      if (slot === "e" && desktop && plan.reference > BANDS.desktop[0].track) out.push(`${view}: ${name(id)} left out above the narrowest desktop band`);
    }
    for (const label of labels) {
      const { box, spot, who } = label;
      if (box.x0 < lo - 0.01 || box.x1 > hi + 0.01 || box.y0 < ceiling - 0.01 || box.y1 > floor + 0.01) out.push(`${view}: ${who} off the drawing`);
      const inBar = spot.kind === "inside" || spot.kind === "prefix";
      if (!inBar) {
        for (const mark of marks) {
          const own = label.owners.includes(mark.id);
          const need = own ? LABEL_GAP[layout] : label.tag ? TAG_BAR_CLEAR[layout] : CLEAR[layout];
          const gap = boxGap(box, mark.box);
          if (hit(box, mark.box) || gap < need - 1e-6) out.push(`${view}: ${who} ${gap.toFixed(2)}px from ${own ? "its own bar" : name(mark.id)}`);
        }
        for (const window of windows) if (hit(box, window) || boxGap(box, window) < CLEAR[layout] - 1e-6) out.push(`${view}: ${who} within ${CLEAR[layout]}px of a window`);
      }
      for (const other of labels) {
        if (other !== label && (hit(box, other.box) || boxGap(box, other.box) < CLEAR[layout] - 1e-6)) out.push(`${view}: ${who} within ${CLEAR[layout]}px of ${other.who}`);
      }
      if (label.tag) continue;
      const own = marks.find((mark) => mark.id === label.id && vp.bars.some((item) => item.set.actId === mark.id && item.top === mark.box.y0 && x(item.span.start) === mark.box.x0));
      if (!own) {
        out.push(`${view}: ${who} has no bar`);
        continue;
      }
      const ownBox = seen(own.box);
      const mine = boxGap(box, ownBox);
      for (const mark of marks) {
        if (mark.id === label.id) continue;
        const other = seen(mark.box);
        if (other.x1 > other.x0 && boxGap(box, other) <= mine + 1e-6) out.push(`${view}: ${who} (${spot.slot}) as near ${name(mark.id)} as its own bar`);
      }
      if (spot.slot === "c" && overlapX(box, ownBox) < (box.x1 - box.x0) / 2 - 1e-6) out.push(`${view}: ${who} on a plate less than half over its bar`);
      if (spot.slot === "b") {
        if (box.x0 < own.box.x1 || box.x0 - own.box.x1 > 8 + 1e-6) out.push(`${view}: ${who} beside its bar but not within 8px of its end`);
        const next = marks.filter((mark) => mark.row === own.row && mark.box.x0 >= own.box.x1 && mark.box !== own.box).reduce((nearest, mark) => Math.min(nearest, mark.box.x0), hi + 6);
        if (next - box.x1 < 6 - 1e-6) out.push(`${view}: ${who} beside its bar runs within 6px of the next`);
      }
      if (spot.slot === "d") {
        const text = spot.lines[0];
        if (!text.endsWith(ELLIPSIS) || [...text.slice(0, -1)].length < PREFIX_MIN || !who.startsWith(text.slice(0, -1))) out.push(`${view}: ${who} cut to "${text}"`);
      }
      if (spot.slot !== "d" && spot.lines.join(" ") !== who) out.push(`${view}: ${who} reads "${spot.lines.join(" / ")}"`);
      if (inBar && (box.x0 < ownBox.x0 - 1e-6 || box.x1 > ownBox.x1 + 1e-6)) out.push(`${view}: ${who} runs out of its bar`);
    }
    for (const line of vp.lines) {
      const cx = x(line.mid) + line.off;
      const half = line.width / 2;
      if (cx - half < x(line.window.start) - 1e-6 || cx + half > x(line.window.end) + 1e-6) out.push(`${view}: line ${line.key} leaves its window`);
      if (cx < lo || cx > hi) continue;
      let samples = 0;
      for (let y = line.top; y <= line.bottom; y += 1) {
        const hidden =
          line.under &&
          vp.bars.some(
            (item) =>
              item.set.actId !== line.thread.aId &&
              item.set.actId !== line.thread.bId &&
              cx >= x(item.span.start) &&
              cx <= x(item.span.end) &&
              y >= item.top &&
              y <= item.top + bar,
          );
        if (hidden) continue;
        for (const label of labels) {
          const b = label.box;
          if (y > b.y0 + 1 && y < b.y1 - 1 && cx + half > b.x0 + 1 && cx - half < b.x1 - 1) samples += 1;
        }
      }
      if (samples > 0) out.push(`${view}: line ${line.key} paints ${samples} samples through a name or tag`);
    }
  }
  return out;
}

/**
 * How the lines of one view stand against the bars they cross and against each other, at the plan's track. A line
 * "hugs" a bar when its middle is less than 8px inside another set's bar it crosses, or its stroke less than 2px
 * clear of it; two lines "stack" when their middles are under 6px apart over more than 4px of the same rows. For
 * each line, `free` lists the places (sampled every 0.25px) its middle could take inside its window that hug no bar
 * and keep its stroke 2px, and its end dots 1px, clear of every name, tag and plate on the paper.
 */
function lineCrowding(m: DayGraphModel, plan: LayoutPlan, view: View) {
  const vp = plan.views[view];
  const bar = LAYOUT[plan.layout].bar;
  const x = (minute: number) => (minute - plan.track.start) * plan.scale;
  const marks = [...vp.bars, ...(vp.ghost ? [vp.ghost] : [])];
  const paper = [
    ...Object.values(vp.labels).filter((spot) => spot.kind !== "inside" && spot.kind !== "prefix"),
    ...vp.tags.map((tag) => tag.spot),
  ].map((spot) => spotBox(plan, spot));
  const crossed = (line: PlanLine) =>
    marks.filter(
      (item) =>
        item.set.actId !== line.thread.aId &&
        item.set.actId !== line.thread.bId &&
        Math.min(line.bottom, item.top + bar) - Math.max(line.top, item.top) >= 4,
    );
  // A line runs by a bar's edge when it stands less than 8px inside it or less than 2px clear of it; one drawn beneath
  // the bars, whose casing hides it from 2px above each bar it crosses to 2px below, only when its stroke stands less
  // than BENEATH_IN px inside the edge or less than 2px clear of it (the bar and the casing hide the rest).
  const hugsAt = (line: PlanLine, cx: number) =>
    crossed(line).filter((item) => {
      const dl = cx - x(item.span.start);
      const dr = x(item.span.end) - cx;
      const inside = line.under ? line.width / 2 + BENEATH_IN - 1e-6 : 8;
      return (dl > -line.width / 2 - 2 && dl < inside) || (dr > -line.width / 2 - 2 && dr < inside);
    });
  const freeOf = (line: PlanLine): number[] => {
    const half = line.width / 2;
    const dot = (line.thread.lit ? 4 : 3) + 1;
    const out: number[] = [];
    for (let p = x(line.window.start) + half; p <= x(line.window.end) - half + 1e-9; p += 0.25) {
      if (hugsAt(line, p).length > 0) continue;
      const blocked = paper.some((box) => {
        if (box.y0 < line.bottom && line.top < box.y1 && p + half + LINE_CLEAR > box.x0 && p - half - LINE_CLEAR < box.x1) return true;
        return [line.top, line.bottom].some((y) => Math.hypot(Math.max(0, box.x0 - p, p - box.x1), Math.max(0, box.y0 - y, y - box.y1)) < dot);
      });
      if (!blocked) out.push(p);
    }
    return out;
  };
  const lines = vp.lines.map((line) => ({ line, cx: x(line.mid) + line.off }));
  const hugs = lines.flatMap(({ line, cx }) => hugsAt(line, cx).map((item) => ({ line, bar: item.set.name, free: freeOf(line) })));
  const stacked = lines.flatMap((a, i) =>
    lines
      .slice(i + 1)
      .filter((b) => Math.abs(a.cx - b.cx) < 6 && Math.min(a.line.bottom, b.line.bottom) - Math.max(a.line.top, b.line.top) > 4)
      .map((b) => {
        const fa = freeOf(a.line);
        const fb = freeOf(b.line);
        const apart = fa.length > 0 && fb.length > 0 && (Math.max(...fa) - Math.min(...fb) >= 6 || Math.max(...fb) - Math.min(...fa) >= 6);
        return { keys: `${a.line.key} | ${b.line.key}`, apart };
      }),
  );
  return { hugs, stacked };
}

/** Each slot's count in one view of a plan. */
function slotCounts(plan: LayoutPlan, view: View): Record<string, number> {
  const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0, e: 0 };
  for (const slot of Object.values(plan.views[view].slots)) counts[slot] += 1;
  return counts;
}

// ------------------------------------------------------------------------------------ days shaped like the saved ones

/** Glastonbury's shape, invented: the partner on the bottom row, wider than its bar, under the chosen clash's window, a set 30 minutes after it. */
const UNDER_THE_HATCH: SetSpec[] = [
  { name: "Nadirwood", stage: "upper", start: "12:30", end: "13:15" },
  { name: "Shagbark Hollow", stage: "upper", start: "13:45", end: "14:30" },
  { name: "Joyweed Crookes", stage: "upper", start: "15:00", end: "15:45" },
  { name: "Gurneyfield", stage: "middle", start: "12:30", end: "13:30" },
  { name: "Quillwort", stage: "middle", start: "14:00", end: "15:00" },
  { name: "Djembe", stage: "middle", start: "15:30", end: "16:30" },
  { name: "Geode Greep", stage: "lower", start: "12:45", end: "13:30" },
  { name: "Wren T Hollowell", stage: "lower", start: "14:00", end: "14:45" },
  { name: "Rowanberry Otis", stage: "lower", start: "15:15", end: "16:00" },
];

function underTheHatch(): DayGraphModel {
  const sets = UNDER_THE_HATCH;
  const stages: [string, string][] = [
    ["upper", "Upper"],
    ["middle", "Middle"],
    ["lower", "Lower"],
  ];
  const clashes = [
    pair(1, "Quillwort", "Wren T Hollowell", 45, 0.91, sets),
    pair(2, "Shagbark Hollow", "Wren T Hollowell", 30, 0.6, sets),
    pair(3, "Rowanberry Otis", "Djembe", 30, 0.5, sets),
    pair(4, "Nadirwood", "Gurneyfield", 45, 0.4, sets),
    pair(5, "Gurneyfield", "Geode Greep", 45, 0.3, sets),
  ];
  const move = { ...LATER, act_id: "quillwort", act: "Quillwort", from: "Middle 14:00-15:00", stage_id: "middle", stage: "Middle" };
  const built = buildDayGraph(makeDay(false, [], { stages, sets, clashes }), decide(move, { a_id: "quillwort", b_id: "wren-t-hollowell", rank: 1, minutes: 45 }), 0);
  if (!built) throw new Error("no model for the invented day");
  return built;
}

/** Riot Fest's shape, invented: the mover on the bottom row, its published slot on its left in the moved view and a set 30 minutes after it. */
const BESIDE_THE_GHOST: SetSpec[] = [
  { name: "The Formats", stage: "roots", start: "17:10", end: "18:10" },
  { name: "Amaryllis Morrow", stage: "roots", start: "19:20", end: "20:20", locked: true },
  { name: "William Shadbush", stage: "rebel", start: "17:25", end: "18:00" },
  { name: "Twin Pines", stage: "rebel", start: "18:30", end: "19:30" },
  { name: "Good Riddle", stage: "radical", start: "18:15", end: "18:55" },
  { name: "Bowls for Supper", stage: "radical", start: "19:25", end: "20:05" },
  { name: "Inkcap Clown Posse", stage: "radical", start: "20:55", end: "21:55" },
];

function besideTheGhost(): DayGraphModel {
  const sets = BESIDE_THE_GHOST;
  const stages: [string, string][] = [
    ["roots", "Roots"],
    ["rebel", "Rebel"],
    ["radical", "Radical"],
  ];
  const clashes = [
    pair(1, "Amaryllis Morrow", "Bowls for Supper", 40, 0.88, sets),
    pair(2, "Twin Pines", "Good Riddle", 25, 0.5, sets),
    pair(3, "The Formats", "William Shadbush", 35, 0.4, sets),
  ];
  const move = {
    ...LATER,
    act_id: "bowls-for-supper",
    act: "Bowls for Supper",
    from: "Radical 19:25-20:05",
    stage_id: "radical",
    stage: "Radical",
    start: "19:45",
    end: "20:25",
    minutes_moved: 20,
    minutes_shared_after: 35,
  };
  const built = buildDayGraph(
    makeDay(false, [], { stages, sets, clashes }),
    decide(move, { a_id: "amaryllis-morrow", b_id: "bowls-for-supper", rank: 1, minutes: 40 }),
    0,
  );
  if (!built) throw new Error("no model for the invented day");
  return built;
}

/**
 * A published day from the backend's built presets, when this checkout has it (they are not committed), drawn with
 * the move the decision route sends for it (GET /api/presets/{id}/decision).
 */
function savedDay(file: string, clash: Raw, move: Raw): DayGraphModel | null {
  const path = join(process.cwd(), "..", "backend", "presets", file);
  if (!existsSync(path)) return null;
  const decision = parseDecision({ kind: "decision", day: 0, skipped_locked: 0, skipped_no_place: 0, clash, published_budget: 100, move, rule: null });
  return buildDayGraph(parsePreset(JSON.parse(readFileSync(path, "utf8"))), decision, 0);
}

const SAVED: [string, DayGraphModel | null][] = [
  [
    "Glastonbury 2025, Sunday",
    savedDay(
      "glastonbury-2025-sun.json",
      { a_id: "sprints", b_id: "katy-j-pearson", rank: 1, minutes: 45 },
      { ...LATER, act_id: "sprints", act: "Sprints", from: "Woodsies 14:00-15:00", stage_id: "woodsies", stage: "Woodsies", legal_places: 6, budget_after: 114.26 },
    ),
  ],
  [
    "Riot Fest 2026, Sunday",
    savedDay(
      "riot-fest-2026-sun.json",
      { a_id: "alanis-morissette", b_id: "bowling-for-soup", rank: 1, minutes: 40 },
      {
        ...LATER,
        act_id: "bowling-for-soup",
        act: "Bowling for Soup",
        from: "Radical 19:25-20:05",
        stage_id: "radical",
        stage: "Radical",
        start: "19:45",
        end: "20:25",
        minutes_moved: 20,
        legal_places: 13,
        budget_after: 85.48,
        minutes_shared_after: 35,
      },
    ),
  ],
];

const DAYS: [string, DayGraphModel | null][] = [
  ...SAVED,
  ["an invented day with the partner under the chosen clash's window", underTheHatch()],
  ["an invented day with the mover between its published slot and the next set", besideTheGhost()],
];

describe("planDrawing: featured names are always whole", () => {
  for (const [day, m] of DAYS) {
    it.skipIf(m === null)(`on ${day}, at 320, 360 and 390px wide, in both views, on a tall and a short phone, never cuts or leaves out a featured name`, () => {
      const model = m as DayGraphModel;
      expect(model.sets.filter((set) => set.featured).length).toBeGreaterThanOrEqual(2);
      for (const layout of ["phone", "short"] as const) {
        BANDS[layout].forEach((band, i) => {
          expect(band.track).toBe(band.from - 32 - 64);
          const plan = planDrawing(model, layout, band.track);
          for (const view of ["published", "moved"] as const) {
            for (const set of model.sets.filter((item) => item.featured)) {
              const spot = plan.views[view].labels[set.actId];
              expect(plan.views[view].slots[set.actId], `${layout} at ${band.from}px, ${view}: ${set.name}`).toMatch(/^[bc]$/);
              expect(spot?.lines.join(" ")).toBe(set.name);
              expect(["above", "below", "beside"]).toContain(spot?.kind);
            }
          }
          // Clear of every other bar, window and label by 2px, 1px from its own bar, at the band's track and up to the next band's.
          const wider = (BANDS[layout][i + 1]?.track ?? band.track + 80) / band.track;
          expect(problemsOf(model, plan)).toEqual([]);
          expect(problemsOf(model, plan, wider)).toEqual([]);
        });
      }
    });
  }

  it("keeps a tall phone's drawing and a short phone's as tall as before, with a label lane under the last row", () => {
    const m = underTheHatch();
    expect(m.phoneRows.length).toBe(3);
    expect(LAYOUT.phone.overview + LAYOUT.phone.gap + LAYOUT.phone.axis + 3 * LAYOUT.phone.row + LAYOUT.phone.foot).toBe(172);
    expect(LAYOUT.short.axis + 3 * LAYOUT.short.row + LAYOUT.short.foot).toBe(140);
    // A name under the bottom bar sits its gap under it (3px on a phone and on a short phone), in its line box (15px, and
    // 13px on a short phone), and ends at the drawing's foot.
    for (const layout of ["phone", "short"] as const) {
      const plan = planDrawing(m, layout, BANDS[layout][0].track);
      const spot = plan.views.moved.labels["wren-t-hollowell"];
      expect(spot?.kind).toBe("below");
      expect(spot?.top).toBe(barBottomOf(layout, 2) + LABEL_GAP[layout]);
      expect(spot?.height).toBe(NAME_LINE[layout]);
      expect((spot?.top ?? 0) + (spot?.height ?? 0)).toBe(LAYOUT[layout].axis + 3 * LAYOUT[layout].row + LAYOUT[layout].foot);
    }
    // Round 37 fix pass 2 (L4): a phone's row gap holds a one-line plate 3px off its own bar and twice that from the bar
    // across the gap, and so does a short phone's, with its thinner 15px bars and its names' 13px line box (it held 1px
    // and 2px before).
    expect(LABEL_GAP).toMatchObject({ phone: 3, short: 3 });
    expect(NAME_LINE).toEqual({ desktop: 15, phone: 15, short: 13 });
    expect(LAYOUT.phone.row - LAYOUT.phone.bar).toBe(LABEL_GAP.phone + NAME_LINE.phone + OWN_RATIO * LABEL_GAP.phone);
    expect(LAYOUT.short.row - LAYOUT.short.bar).toBe(LABEL_GAP.short + NAME_LINE.short + OWN_RATIO * LABEL_GAP.short);
  });
});

describe("planDrawing: each name in the first slot that fits", () => {
  const m = model(LATER, false, [...CROWDED, YARROW, LONG]);

  it("puts a name inside its bar when it fits, beside it on an empty stretch of its row, on a plate when it is crowded, and cuts it or leaves it out only when nothing else fits", () => {
    const narrow = planDrawing(m, "desktop", BANDS.desktop[0].track);
    const wide = planDrawing(m, "desktop", BANDS.desktop[BANDS.desktop.length - 1].track);
    const pub = narrow.views.published;
    // (a) Fir fits inside its hour.
    expect(pub.slots.fir).toBe("a");
    expect(pub.labels.fir?.kind).toBe("inside");
    // (b) Yarrow Ensemble's ten minutes cannot hold it, but the row is empty until Fir.
    expect(pub.slots["yarrow-ensemble"]).toBe("b");
    expect(pub.labels["yarrow-ensemble"]?.kind).toBe("beside");
    // (c) The three packed sets have no room inside or beside their bars: plates above and below them, at 1280px.
    for (const spec of CROWDED) expect(wide.views.published.slots[idOf(spec.name)], spec.name).toBe("c");
    // (e) At 1024px the middle one of them finds no place clear of its neighbours' plates, and is left out.
    expect(pub.slots["dogwood-brass-quartet"]).toBe("e");
    // (d) On a 390px phone the long name has no plate at least half over its bar and no room beside it: a prefix,
    // its ellipsis 3px short of the bar's end.
    const phone = planDrawing(m, "phone", BANDS.phone[2].track);
    expect(phone.views.published.slots["sassafras-night-choir-orchestra"]).toBe("d");
    expect(phone.views.published.labels["sassafras-night-choir-orchestra"]?.lines).toEqual([`Sassafras${ELLIPSIS}`]);
    for (const plan of [narrow, wide, phone]) expect(problemsOf(m, plan)).toEqual([]);
  });

  it("keeps a name beside its bar within 8px of the bar's end and 6px short of the next bar, and a plate at least half over its own bar and nearer it than any other", () => {
    const counts = { b: 0, c: 0 };
    const plans = [
      ...[600, ...BANDS.desktop.map((band) => band.track)].map((reference) => planDrawing(m, "desktop", reference)),
      ...BANDS.phone.map((band) => planDrawing(m, "phone", band.track)),
      ...BANDS.short.map((band) => planDrawing(m, "short", band.track)),
    ];
    for (const plan of plans) {
      for (const view of ["published", "moved"] as const) {
        const slots = slotCounts(plan, view);
        counts.b += slots.b;
        counts.c += slots.c;
      }
      expect(problemsOf(m, plan), `${plan.layout} at ${plan.reference}px`).toEqual([]);
    }
    expect(counts.b).toBeGreaterThan(0);
    expect(counts.c).toBeGreaterThan(0);
  });

  it("sets a name on two lines at the word break that makes the wider line narrowest", () => {
    expect(twoLines("Cottonwood Collective", 500)).toEqual(["Cottonwood", "Collective"]);
    expect(twoLines("Dogwood Brass Quartet", 500)).toEqual(["Dogwood", "Brass Quartet"]);
    expect(twoLines("Quillwort", 500)).toBeNull();
  });
});

describe("planDrawing: at each band's own track", () => {
  const days: [string, DayGraphModel | null][] = [["the fixture day", model(LATER, false, [...CROWDED, YARROW, LONG])], ...DAYS];

  for (const [day, m] of days) {
    it.skipIf(m === null)(`on ${day}, places names and lines at each desktop band's track, where they hold up to the next band`, () => {
      const model = m as DayGraphModel;
      BANDS.desktop.forEach((band, i) => {
        // The track a band draws: the page's column (40px gutters, at most 1200px) less the 96px stage names.
        expect(band.track).toBe(Math.min(band.from, 1280) - 80 - 96);
        const plan = planDrawing(model, "desktop", band.track);
        expect(plan.reference).toBe(band.track);
        expect(plan.scale).toBeCloseTo(band.track / (plan.track.end - plan.track.start), 9);
        const next = BANDS.desktop[i + 1];
        const widest = next ? Math.min(next.from - 1, 1280) - 80 - 96 : band.track;
        expect(problemsOf(model, plan)).toEqual([]);
        expect(problemsOf(model, plan, widest / band.track)).toEqual([]);
        // From 1120px every name is drawn.
        if (i > 0) for (const view of ["published", "moved"] as const) expect(slotCounts(plan, view).e).toBe(0);
      });
    });
  }
});

describe("planDrawing: lines clear of other bars' edges and of each other", () => {
  for (const [day, m] of DAYS) {
    it.skipIf(m === null)(`on ${day}, at every desktop band, stands each line 8px inside or 2px clear of every other set's bar it crosses (8px of bar beside its casing when drawn over it; its stroke 1px inside when drawn beneath it, where its casing hides the rest), and 6px from every line over the same rows, wherever the names leave it such a place`, () => {
      const model = m as DayGraphModel;
      for (const band of BANDS.desktop) {
        const plan = planDrawing(model, "desktop", band.track);
        for (const view of ["published", "moved"] as const) {
          const { hugs, stacked } = lineCrowding(model, plan, view);
          // A line runs by a bar's edge only when no place in its window is clear of every edge and every name.
          for (const hug of hugs) expect(hug.free, `${band.from}px, ${view}: ${hug.line.key} by ${hug.bar}`).toEqual([]);
          // Two lines stand closer than 6px only when no two such places 6px apart are left to them.
          for (const pair of stacked) expect(pair.apart, `${band.from}px, ${view}: ${pair.keys}`).toBe(false);
          // From 1280px no line runs by another set's bar edge.
          if (band === BANDS.desktop[BANDS.desktop.length - 1]) expect(hugs.map((hug) => `${hug.line.key} by ${hug.bar}`)).toEqual([]);
          // A line drawn over another set's bar leaves 8px of the bar each side of its casing; nearer an end it passes beneath.
          const vp = plan.views[view];
          const x = (minute: number) => (minute - plan.track.start) * plan.scale;
          for (const line of vp.lines.filter((item) => !item.under)) {
            const cx = x(line.mid) + line.off;
            for (const item of [...vp.bars, ...(vp.ghost ? [vp.ghost] : [])]) {
              if (item.row <= line.upper || item.row >= line.lower || item.set.actId === line.thread.aId || item.set.actId === line.thread.bId) continue;
              if (cx <= x(item.span.start) || cx >= x(item.span.end)) continue;
              const stub = Math.min(cx - x(item.span.start), x(item.span.end) - cx) - line.width / 2 - CASING;
              expect(stub, `${band.from}px, ${view}: ${line.key} over ${item.set.name}`).toBeGreaterThanOrEqual(BAR_STUB - 1e-6);
            }
          }
        }
      }
    });
  }

  it("draws every name of both saved days from 1120px, and at 1024px leaves out no more than the drawing can hold", () => {
    for (const [day, m] of SAVED) {
      if (!m) continue;
      for (const band of BANDS.desktop) {
        const plan = planDrawing(m, "desktop", band.track);
        for (const view of ["published", "moved"] as const) {
          const left = slotCounts(plan, view).e;
          // At 1024px Riot Fest's 30-minute sets leave two names no place clear of their own lines (an exhaustive search
          // of every place finds none), and the moved view's tag takes a third; from 1120px every name is drawn.
          expect(left, `${day} at ${band.from}px, ${view}`).toBeLessThanOrEqual(band === BANDS.desktop[0] ? (view === "moved" ? 3 : 2) : 0);
        }
      }
    }
  });
});

describe("planDrawing: names first, featured first, then the lines", () => {
  it("places the featured names and their tags before every other name, which take the places left, and routes the lines last, round every name", () => {
    const m = underTheHatch();
    // The same day with every other set's name far longer: the featured names and the tags must not move.
    const longer: DayGraphModel = { ...m, sets: m.sets.map((set) => (set.featured ? set : { ...set, name: `${set.name} and the Longest Name on the Bill` })) };
    const featured = m.sets.filter((set) => set.featured).map((set) => set.actId);
    expect(featured).toEqual(expect.arrayContaining(["quillwort", "wren-t-hollowell", "joyweed-crookes"]));
    for (const layout of ["desktop", "phone", "short"] as const) {
      for (const band of BANDS[layout]) {
        const plan = planDrawing(m, layout, band.track);
        const crowded = planDrawing(longer, layout, band.track);
        for (const view of ["published", "moved"] as const) {
          for (const id of featured) expect(crowded.views[view].labels[id], `${layout} at ${band.from}px, ${view}: ${id}`).toEqual(plan.views[view].labels[id]);
          expect(crowded.views[view].tags).toEqual(plan.views[view].tags);
          // Shagbark Hollow's name never takes the mover's place, nor comes within 2px of it.
          const mover = plan.views[view].labels.quillwort;
          const shagbark = plan.views[view].labels["shagbark-hollow"];
          if (mover && shagbark) expect(boxGap(spotBox(plan, shagbark), spotBox(plan, mover))).toBeGreaterThanOrEqual(CLEAR[layout] - 1e-6);
        }
        // Every other name finds what room is left, and every line stands clear of every name.
        expect(problemsOf(m, plan)).toEqual([]);
        expect(problemsOf(longer, crowded)).toEqual([]);
      }
    }
  });

  it("nudges a line inside its own window and never out of it", () => {
    for (const [, m] of DAYS) {
      if (!m) continue;
      for (const plan of [...BANDS.desktop.map((band) => planDrawing(m, "desktop", band.track)), ...BANDS.phone.map((band) => planDrawing(m, "phone", band.track))]) {
        for (const view of ["published", "moved"] as const) {
          for (const line of plan.views[view].lines) {
            const x = (line.mid - plan.track.start) * plan.scale + line.off;
            expect(x - line.width / 2).toBeGreaterThanOrEqual((line.window.start - plan.track.start) * plan.scale - 1e-6);
            expect(x + line.width / 2).toBeLessThanOrEqual((line.window.end - plan.track.start) * plan.scale + 1e-6);
          }
        }
      }
    }
  });
});

describe("round 37 fix pass 1: every desktop band, short phones' tags and the notes above the drawing", () => {
  const fixtures: [string, DayGraphModel][] = [
    ["the fixture day", model(LATER, false, [...CROWDED, YARROW, LONG])],
    ["the hatch day", underTheHatch()],
  ];

  it("sets names 6px off their bars on one line and 4px on two, twice as near their own bar where there is room, at every desktop band (L4)", () => {
    for (const band of BANDS.desktop) {
      expect(labelRoom("desktop", band.track, 5), `${band.from}px`).toMatchObject({ gap: WIDE_GAP, gapTwo: WIDE_GAP_TWO, beside: WIDE_GAP, ratio: OWN_RATIO });
    }
    expect([WIDE_GAP, WIDE_GAP_TWO, OWN_RATIO]).toEqual([6, 4, 2]);
    // A two-line plate's 26px in a 38px row gap: 4px to its own bar, 8px to the bar across the gap.
    expect(LAYOUT.desktop.row - LAYOUT.desktop.bar).toBe(WIDE_GAP_TWO + 2 * 13 + OWN_RATIO * WIDE_GAP_TWO);
    for (const [label, m] of fixtures) {
      for (const band of BANDS.desktop) {
        const plan = planDrawing(m, "desktop", band.track);
        const x = (minute: number) => (minute - plan.track.start) * plan.scale;
        for (const view of ["published", "moved"] as const) {
          const vp = plan.views[view];
          for (const [id, spot] of Object.entries(vp.labels)) {
            if (spot.kind === "inside" || spot.kind === "prefix") continue;
            const own = vp.bars.find((item) => item.set.actId === id);
            if (!own) continue;
            const box = spotBox(plan, spot);
            const gap = boxGap(box, { x0: x(own.span.start), x1: x(own.span.end), y0: own.top, y1: own.top + LAYOUT.desktop.bar });
            expect(gap, `${label} at ${band.from}px, ${view}: ${id}`).toBeCloseTo(spot.lines.length > 1 ? WIDE_GAP_TWO : WIDE_GAP, 6);
          }
        }
      }
    }
  });

  it("keeps every name on a plate over its own bar for half its width and half a pixel more, so the page's rounding never leaves it under half (D7)", () => {
    expect(PLATE_OVER).toBe(0.5);
    for (const [label, m] of fixtures) {
      for (const layout of ["desktop", "phone", "short"] as const) {
        for (const band of BANDS[layout]) {
          const plan = planDrawing(m, layout, band.track);
          const x = (minute: number) => (minute - plan.track.start) * plan.scale;
          for (const view of ["published", "moved"] as const) {
            const vp = plan.views[view];
            for (const [id, spot] of Object.entries(vp.labels)) {
              if (spot.slot !== "c") continue;
              const own = vp.bars.find((item) => item.set.actId === id);
              if (!own) continue;
              const box = spotBox(plan, spot);
              const over = overlapX(box, { x0: x(own.span.start), x1: x(own.span.end), y0: 0, y1: 0 });
              expect(over, `${label}, ${layout} at ${band.from}px, ${view}: ${id}`).toBeGreaterThanOrEqual((box.x1 - box.x0) / 2 + PLATE_OVER - 1e-6);
            }
          }
        }
      }
    }
  });

  it("sets a short phone's tags in a 13px line box, in its 22px row gap at least 2.5px clear of every bar (L17)", () => {
    expect(TAG_LINE).toEqual({ desktop: 15, phone: 15, short: 13 });
    expect(TAG_BAR_CLEAR.short).toBe(2.5);
    expect(LAYOUT.short.row - LAYOUT.short.bar).toBe(22);
    expect(LAYOUT.short.row - LAYOUT.short.bar).toBeGreaterThanOrEqual(TAG_LINE.short + 2 * TAG_BAR_CLEAR.short);
    const m = underTheHatch();
    for (const band of BANDS.short) {
      const plan = planDrawing(m, "short", band.track);
      const x = (minute: number) => (minute - plan.track.start) * plan.scale;
      for (const view of ["published", "moved"] as const) {
        const vp = plan.views[view];
        // The invented day's 224px moved view has no room for its tags (nor had it before); the wider bands draw both.
        if (band.track > BANDS.short[0].track) expect(vp.tags.length, `${band.from}px, ${view}: tags drawn`).toBe(view === "moved" ? 2 : 1);
        for (const tag of vp.tags) {
          expect(tag.spot.height).toBe(TAG_LINE.short * tag.spot.lines.length);
          expect(tag.spot.leading).toBe(TAG_LINE.short);
          const box = spotBox(plan, tag.spot);
          for (const item of vp.bars) {
            const gap = boxGap(box, { x0: x(item.span.start), x1: x(item.span.end), y0: item.top, y1: item.top + LAYOUT.short.bar });
            expect(gap, `${band.from}px, ${view}: "${tag.text}" from ${item.set.name}`).toBeGreaterThanOrEqual(TAG_BAR_CLEAR.short - 1e-6);
          }
        }
      }
    }
  });

  it("reaches above the drawing for a note, beside what the page shows there and never over it, when every place inside covers names (L13)", () => {
    const column = { width: 800, height: 200 };
    const marks: Box[] = [{ x0: 396, x1: 404, y0: 40, y1: 160 }];
    // Names every 20px down the drawing, and no room under it: any place inside covers at least two.
    const names: Box[] = [];
    for (let y = 0; y < 200; y += 20) names.push({ x0: 10, x1: 380, y0: y, y1: y + 15 }, { x0: 420, x1: 790, y0: y, y1: y + 15 });
    // The view toggle above the drawing's left end, and a button above its right end.
    const keep: Box[] = [
      { x0: -40, x1: 260, y0: -48, y1: -6 },
      { x0: 640, x1: 800, y0: -96, y1: -60 },
    ];
    const note = { width: 360, height: 54 };
    const spot = placeNote(marks, names, [], column, note, 400, { top: 96, bottom: 0 }, keep);
    const box = { x0: spot.x, x1: spot.x + spot.width, y0: spot.y, y1: spot.y + spot.height };
    expect(spot.names).toBe(0);
    expect(box.y1).toBeLessThanOrEqual(0);
    for (const item of keep) expect(hit({ x0: box.x0 - NOTE_GAP, x1: box.x1 + NOTE_GAP, y0: box.y0 - NOTE_GAP, y1: box.y1 + NOTE_GAP }, item), JSON.stringify(item)).toBe(false);
    // Too tall for the room left beside the toggle, the usual shape gives way to a wider, shorter one.
    const tall = { width: 360, height: 90 };
    const wide = { width: 500, height: 54 };
    const shaped = placeNote(marks, names, [], column, [tall, wide], 400, { top: 70, bottom: 0 }, [{ x0: -40, x1: 260, y0: -70, y1: -6 }]);
    expect([shaped.width, shaped.height, shaped.names]).toEqual([500, 54, 0]);
    // With room for the usual shape, it keeps it.
    const roomy = placeNote(marks, names, [], column, [{ width: 360, height: 54 }, wide], 400, { top: 96, bottom: 0 }, keep);
    expect(roomy.width).toBe(360);
    // Where no place keeps clear of both, it keeps clear of the line's own marks and covers what it must.
    const shut = placeNote(marks, names, [], column, note, 400, { top: 96, bottom: 0 }, [{ x0: -100, x1: 900, y0: -200, y1: 0 }]);
    expect(hit({ x0: shut.x, x1: shut.x + shut.width, y0: shut.y, y1: shut.y + shut.height }, marks[0])).toBe(false);
  });
});

describe("round 37 fix pass 2: a phone names the window it slides to, and a short phone's leaders", () => {
  const fixtures: [string, DayGraphModel][] = [
    ["the fixture day", model(LATER, false, [...CROWDED, YARROW, LONG])],
    ["the hatch day", underTheHatch()],
  ];
  const phones = ["phone", "short"] as const;
  /** The windows a phone slides to: one centred on each line it draws (a tap on the strip or a line reached by key). */
  const windowsOf = (m: DayGraphModel, plan: LayoutPlan) => {
    const length = m.focus.end - m.focus.start;
    const starts = new Set<number>();
    for (const view of ["published", "moved"] as const) for (const line of plan.views[view].lines) starts.add(detailAt(m, line.mid - length / 2).start);
    return [...starts].map((start) => ({ start, end: start + length }));
  };

  it("keeps the detail window the opening window's length and on the track, and places the opening window as before", () => {
    for (const [label, m] of fixtures) {
      const track = trackOf(m);
      const length = m.focus.end - m.focus.start;
      expect(detailAt(m, m.focus.start), label).toEqual(m.focus);
      expect(detailAt(m, track.start - 500), label).toEqual({ start: track.start, end: track.start + length });
      expect(detailAt(m, track.end + 500), label).toEqual({ start: track.end - length, end: track.end });
      for (const layout of phones) {
        for (const band of BANDS[layout]) {
          const opening = planDrawing(m, layout, band.track);
          expect(opening.detail, `${label}, ${layout} at ${band.from}px`).toEqual(m.focus);
          // The server frame and the first paint draw the opening window: the same plan with or without it named.
          expect(planDrawing(m, layout, band.track, m.focus), `${label}, ${layout} at ${band.from}px`).toEqual(opening);
        }
      }
      // A desktop shows the whole track whatever it is given.
      expect(planDrawing(m, "desktop", BANDS.desktop[0].track, m.focus).detail, label).toEqual(track);
    }
  });

  it("names every set the window it slides to shows whole, draws every name, tag and leader inside that window, and none of the opening window's names past it (N1)", () => {
    for (const [label, m] of fixtures) {
      for (const layout of phones) {
        for (const band of BANDS[layout]) {
          const opening = planDrawing(m, layout, band.track);
          const windows = windowsOf(m, opening);
          expect(windows.length, `${label}, ${layout} at ${band.from}px: windows`).toBeGreaterThan(1);
          for (const detail of windows) {
            const plan = planDrawing(m, layout, band.track, detail);
            const where = `${label}, ${layout} at ${band.from}px, window from ${detail.start}`;
            expect(plan.detail, where).toEqual(detail);
            const x = (minute: number) => (minute - plan.track.start) * plan.scale;
            const [lo, hi] = [x(detail.start), x(detail.end)];
            const leaders = planLeaders(m, plan);
            for (const view of ["published", "moved"] as const) {
              const vp = plan.views[view];
              const whole = vp.bars.filter((item) => item.span.start >= detail.start - 1e-6 && item.span.end <= detail.end + 1e-6);
              // The fixture day's long name has, on a 320px phone, no prefix of 8 characters inside its bar and no plate
              // at least half over it, wherever the window is, the opening one included (from 360px it is a prefix).
              const placeless = label === "the fixture day" && band.track === NARROW_TRACK ? [LONG.name] : [];
              expect(
                whole.filter((item) => !vp.labels[item.set.actId] && !placeless.includes(item.set.name)).map((item) => item.set.name),
                `${where}, ${view}: sets shown whole with no name`,
              ).toEqual([]);
              for (const spot of [...Object.values(vp.labels), ...vp.tags.map((tag) => tag.spot)]) {
                const box = spotBox(plan, spot);
                expect(box.x0, `${where}, ${view}: "${spot.lines.join(" ")}" starts in the window`).toBeGreaterThanOrEqual(lo - 1e-6);
                expect(box.x1, `${where}, ${view}: "${spot.lines.join(" ")}" ends in the window`).toBeLessThanOrEqual(hi + 1e-6);
              }
              for (const leader of leaders[view].leaders) {
                const at = x(leader.anchor);
                for (const end of [leader.x0, leader.x1]) {
                  expect(at + end, `${where}, ${view}: ${leader.id}'s leader in the window`).toBeGreaterThanOrEqual(lo - 1e-6);
                  expect(at + end, `${where}, ${view}: ${leader.id}'s leader in the window`).toBeLessThanOrEqual(hi + 1e-6);
                }
              }
            }
          }
        }
      }
    }
  });

  it("sets a short phone's names 3px off their bars, each twice as near its own bar as any other, as a phone's (L4)", () => {
    expect(labelRoom("short", BANDS.short[0].track, 3)).toMatchObject({ gap: 3, gapTwo: 3, ratio: OWN_RATIO });
    expect(labelRoom("phone", BANDS.phone[0].track, 3)).toMatchObject({ gap: 3, gapTwo: 3, ratio: OWN_RATIO });
    for (const [label, m] of fixtures) {
      for (const band of BANDS.short) {
        const plan = planDrawing(m, "short", band.track);
        const x = (minute: number) => (minute - plan.track.start) * plan.scale;
        const [lo, hi] = [x(plan.detail.start), x(plan.detail.end)];
        const barBox = (item: { span: { start: number; end: number }; top: number }): Box => ({
          x0: Math.max(lo, x(item.span.start)),
          x1: Math.min(hi, x(item.span.end)),
          y0: item.top,
          y1: item.top + LAYOUT.short.bar,
        });
        const leaders = planLeaders(m, plan);
        for (const view of ["published", "moved"] as const) {
          const vp = plan.views[view];
          for (const leader of leaders[view].leaders) expect(leader.length, `${label}, ${band.from}px, ${view}: ${leader.id}'s leader`).toBeGreaterThanOrEqual(3 - 1e-6);
          for (const [id, spot] of Object.entries(vp.labels)) {
            if (spot.kind !== "above" && spot.kind !== "below") continue;
            const box = spotBox(plan, spot);
            const own = vp.bars.find((item) => item.set.actId === id);
            if (!own) continue;
            const mine = boxGap(box, barBox(own));
            expect(mine, `${label}, ${band.from}px, ${view}: ${id} off its bar`).toBeCloseTo(3, 6);
            expect(spot.height, `${label}, ${band.from}px, ${view}: ${id}'s line box`).toBe(NAME_LINE.short);
            for (const other of [...vp.bars, ...(vp.ghost ? [vp.ghost] : [])]) {
              if (other.set.actId === id) continue;
              const seen = barBox(other);
              if (seen.x1 <= seen.x0) continue;
              expect(boxGap(box, seen), `${label}, ${band.from}px, ${view}: ${id} from ${other.set.name}`).toBeGreaterThanOrEqual(OWN_RATIO * mine - 0.01);
            }
          }
        }
      }
    }
  });
});
