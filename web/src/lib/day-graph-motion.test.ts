import { describe, expect, it } from "vitest";

import { buildDayGraph, MOVE_MS, threadWidth, type DayGraphModel } from "./day-graph";
import {
  barBottomOf,
  barTopOf,
  CASING,
  clearPlace,
  flightKeyframes,
  flightStops,
  LINE_GAP,
  LINE_SHIFT,
  lineTransform,
  moveBreakpoints,
  moverAt,
  moverTransform,
  NAME_INSET,
  nameInk,
  NARROW_TRACK,
  NOTE_GAP,
  noteSide,
  planDrawing,
  retarget,
  spotBox,
  spreadLines,
  textWidth,
  trackOf,
  viewP,
  WINDOW_INSET,
  windowAt,
  type LayoutPlan,
  type LineSlot,
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
const idOf = (name: string) => name.toLowerCase();

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

function side(name: string): Raw {
  const spec = SETS.find((item) => item.name === name);
  if (!spec) throw new Error(`no set ${name} in the fixture`);
  return { act_id: idOf(name), name, stage_id: spec.stage, genre: null };
}

function pair(rank: number, a: string, b: string, minutes: number, overlap: number): Raw {
  return {
    rank,
    a: side(a),
    b: side(b),
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

function makeDay(synthetic = false, extra: SetSpec[] = []): Preset {
  const sets = [...SETS, ...extra];
  const raw = rawTinyPreset() as Raw;
  raw.id = "mini-fest-sun";
  raw.title = "Mini Fest 2026, Sunday";
  raw.synthetic = synthetic;
  raw.festival.days = ["Sun"];
  raw.festival.stages = STAGES.map(([id, name], index) => ({ id, name, tier: index + 1, hours: [] }));
  raw.festival.acts = sets.map((spec) => ({ id: idOf(spec.name), name: spec.name, qloo_id: null, popularity: spec.unscored ? null : 0.5, genre: null, billing_tier: 2 }));
  raw.festival.timetable = sets.map((spec) => ({ act_id: idOf(spec.name), day: 0, stage_id: spec.stage, start: spec.start, end: spec.end, locked: spec.locked === true }));
  raw.report.clashes = CLASHES;
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

function decide(move: Raw | null): Decision {
  const decision = parseDecision({
    kind: "decision",
    day: 0,
    skipped_locked: 0,
    skipped_no_place: 0,
    clash: { a_id: "alder", b_id: "birch", rank: 1, minutes: 45 },
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

describe("textWidth", () => {
  it("measures Archivo at 12.5px a little over its advance", () => {
    expect(textWidth("Sprints")).toBeGreaterThan(41.4);
    expect(textWidth("Sprints")).toBeLessThan(44);
    expect(textWidth("30 min shared")).toBeGreaterThan(80.5);
    expect(textWidth("Katy J Pearson")).toBeGreaterThan(textWidth("Katy J"));
  });
});

/** Every label box in a view, with its text, at the plan's reference scale or `stretch` times wider. */
function boxes(plan: LayoutPlan, m: DayGraphModel, view: "published" | "moved", stretch = 1) {
  const names = new Map(m.sets.map((set) => [set.actId, set.name]));
  const stretched = { track: plan.track, scale: plan.scale * stretch };
  return [
    ...Object.entries(plan.views[view].labels).map(([id, spot]) => ({ id, box: spotBox(stretched, spot, names.get(id) ?? "") })),
    ...plan.views[view].tags.map((tag) => ({ id: `tag:${tag.key}`, box: spotBox(stretched, tag.spot, tag.text) })),
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

  it("tags only the published or the moved minutes, and the grown windows by what the move adds", () => {
    const plan = planDrawing(m, "desktop");
    expect(plan.views.published.tags.map((tag) => tag.text)).toEqual(["45 min shared"]);
    expect(plan.views.moved.tags.map((tag) => tag.text)).toEqual(["30 min shared", "new 15 min", "+15 min"]);
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
          const labels = boxes(plan, m, view, stretch);
          const bar = { desktop: 26, phone: 24, short: 24 }[layout];
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

describe("planDrawing: a name with no whole place", () => {
  it("runs from its bar's start to just before the next bar in its band, and no further", () => {
    // On ever narrower tracks some featured name finds no whole place above, inside or beside its bar.
    const m = model();
    let cuts = 0;
    for (const reference of [60, 90, 120, 150]) {
      const plan = planDrawing(m, "phone", reference);
      for (const view of ["published", "moved"] as const) {
        const bars = plan.views[view].bars;
        for (const [id, spot] of Object.entries(plan.views[view].labels)) {
          if (spot.kind !== "inside" || !spot.cut) continue;
          cuts += 1;
          const own = bars.find((item) => item.set.actId === id);
          expect(spot.cut.start).toBe(own?.span.start);
          const next = bars
            .filter((item) => item.set.actId !== id && item.top === own?.top && item.span.start >= (own?.span.end ?? 0))
            .reduce((nearest, item) => Math.min(nearest, item.span.start), Number.POSITIVE_INFINITY);
          expect(spot.cut.end).toBeGreaterThanOrEqual(own?.span.end ?? 0);
          expect(spot.cut.end).toBeLessThan(next);
        }
      }
    }
    expect(cuts).toBeGreaterThan(0);
  });
});

describe("planDrawing: lines clear of the names they cross", () => {
  // Yew (Barn 14:20-14:50) sits under the middle of Fir x Birch's window (14:00-14:45, Main to Lake), so that
  // line moves left of Yew's name; nothing else about the day changes.
  const m = model(LATER, false, [{ name: "Yew", stage: "barn", start: "14:20", end: "14:50" }]);

  it("stands a quiet line that stays put clear of the names in the rows it crosses (or of all it can), at the narrowest track and wider", () => {
    let moved = 0;
    for (const layout of ["desktop", "phone", "short"] as const) {
      for (const reference of layout === "desktop" ? [undefined] : [undefined, NARROW_TRACK]) {
        const plan = planDrawing(m, layout, reference);
        for (const view of ["published", "moved"] as const) {
          const vp = plan.views[view];
          for (const line of vp.lines) {
            if (line.moving || line.thread.lit) continue;
            const crossed = vp.bars.filter((item) => item.row > line.upper && item.row < line.lower);
            const middle = (line.window.start + line.window.end) / 2;
            if (line.mid !== middle) moved += 1;
            const fewest = clearPlace(line.window, line.width / 2, crossed.flatMap((bar) => nameInk(bar.set, bar.span, plan.scale) ?? []), plan.scale)?.crosses ?? 0;
            for (const stretch of [1, 1.4, 2]) {
              const scale = plan.scale * stretch;
              const x = (line.mid - plan.track.start) * scale + line.off;
              const reach = line.width / 2 + CASING;
              const through = crossed.filter((item) => {
                const ink = nameInk(item.set, item.span, plan.scale);
                if (!ink) return false;
                // The text starts NAME_INSET (and a lock) in from the bar and keeps its px width at any scale.
                const from = (item.span.start - plan.track.start) * scale;
                const to = Math.min((item.span.end - plan.track.start) * scale, from + (ink.end - ink.start) * plan.scale);
                return !(x + reach <= from + NAME_INSET || x - reach >= to);
              });
              expect(through.length, `${layout} ${view} x${stretch}: ${line.key} through ${through.map((item) => item.set.name)}`).toBeLessThanOrEqual(fewest);
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

  it("keeps the mover's lines and the chosen clash at the middle of their windows", () => {
    const plan = planDrawing(m, "desktop");
    for (const view of ["published", "moved"] as const) {
      for (const line of plan.views[view].lines.filter((item) => item.moving || item.thread.lit)) {
        expect(line.mid).toBe((line.window.start + line.window.end) / 2);
      }
    }
  });

  it("counts a featured set's lock but not its name, which sits outside the bar", () => {
    const larch = m.sets.find((set) => set.actId === "larch");
    const birch = m.sets.find((set) => set.actId === "birch");
    if (!larch || !birch) throw new Error("the fixture has Larch and Birch");
    const ink = nameInk(larch, { start: larch.start, end: larch.end }, 2);
    expect(ink?.start).toBe(larch.start);
    expect(ink?.end).toBeLessThanOrEqual(larch.end);
    expect(birch.featured).toBe(true);
    expect(nameInk(birch, { start: birch.start, end: birch.end }, 2)).toBeNull();
    expect(nameInk({ ...birch, locked: true }, { start: birch.start, end: birch.end }, 2)).toEqual({ start: birch.start, end: birch.start + (NAME_INSET + 16) / 2 });
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
