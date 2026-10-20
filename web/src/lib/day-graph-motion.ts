/**
 * The day drawing's geometry and its one move, as pure functions, so the server frame, the interactive frame
 * and every frame of the move come from the same numbers.
 *
 * The move is a displacement p from the mover's published slot (0) to its moved slot (1). Everything that
 * touches the mover is an exact function of p: the mover's place, each overlap window it has with another
 * set, each such line's x (the window's middle) and whether it is drawn at all (an empty overlap is not).
 * Between two breakpoints (the p values where a mover edge meets another set's edge) every one of those
 * edges moves linearly, so keyframes at the breakpoints with linear steps between them are exact.
 *
 * The plan of a layout says where every bar, window, line, name and tag goes in each view. Times become
 * percentages of the drawing's time track, so the plan holds at every width; the few pixel decisions (where
 * a name fits, how far two close lines spread apart) are taken at the layout's narrowest track, where they
 * are hardest, and hold at any wider one, because names keep their size while time stretches.
 *
 * Also here, because they are pure: how the arrow keys step through the lines and which colour a line takes.
 */

import {
  LAYOUT,
  MOVE_MS,
  threadWidth,
  type DayGraphModel,
  type DayGraphMove,
  type DayGraphSet,
  type DayGraphThread,
  type DrawingLayout,
  type GraphView,
  type OverlapChange,
  type Span,
} from "./day-graph";

// ------------------------------------------------------------------------------------ the move

type MovePlaces = Pick<DayGraphMove, "from" | "to">;

/** Below this many minutes an overlap is empty (float noise at a contact point). */
const EMPTY = 1e-6;

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** The mover's span at displacement `p` (0 its published slot, 1 its moved slot). */
export function moverAt(move: MovePlaces, p: number): Span {
  return { start: lerp(move.from.start, move.to.start, p), end: lerp(move.from.end, move.to.end, p) };
}

/** The window the mover at `p` shares with another set, or null when they do not overlap at p. */
export function windowAt(move: MovePlaces, other: Span, p: number): Span | null {
  const mover = moverAt(move, p);
  const start = Math.max(mover.start, other.start);
  const end = Math.min(mover.end, other.end);
  return end - start > EMPTY ? { start, end } : null;
}

/** The two edges of that window at `p` even when they have crossed (start >= end means empty), so a mark that follows them never jumps. */
function edgesAt(move: MovePlaces, other: Span, p: number): Span {
  const mover = moverAt(move, p);
  return { start: Math.max(mover.start, other.start), end: Math.min(mover.end, other.end) };
}

/**
 * Every p in (0, 1) where an edge of the mover meets an edge of one of `sets`, plus 0 and 1, sorted. Between
 * two of them no overlap with those sets starts, ends or changes which edge bounds it.
 */
export function moveBreakpoints(move: MovePlaces, sets: readonly Span[]): number[] {
  const points = [0, 1];
  const edges: [number, number][] = [
    [move.from.start, move.to.start],
    [move.from.end, move.to.end],
  ];
  for (const set of sets) {
    for (const x of [set.start, set.end]) {
      for (const [a, b] of edges) {
        if (b === a) continue;
        const p = (x - a) / (b - a);
        if (p > 0 && p < 1) points.push(p);
      }
    }
  }
  points.sort((p, q) => p - q);
  return points.filter((p, i) => i === 0 || p - points[i - 1] > 1e-9);
}

/** A flight from `fromP` to `toP` starts where the drawing is and takes its share of the full move's time. */
export function retarget(fromP: number, toP: number): { start: number; duration: number } {
  return { start: fromP, duration: MOVE_MS * Math.abs(toP - fromP) };
}

/** The stops of a flight: `fromP`, every breakpoint strictly between, `toP`, in travel order, each with its offset in [0, 1]. */
export function flightStops(breakpoints: readonly number[], fromP: number, toP: number): { p: number; offset: number }[] {
  const span = toP - fromP;
  if (span === 0) return [{ p: fromP, offset: 0 }];
  const lo = Math.min(fromP, toP);
  const hi = Math.max(fromP, toP);
  const inner = breakpoints.filter((p) => p > lo + 1e-9 && p < hi - 1e-9);
  if (span < 0) inner.reverse();
  return [fromP, ...inner, toP].map((p) => ({ p, offset: Math.abs((p - fromP) / span) }));
}

// ------------------------------------------------------------------------------------ lines that sit too close

/**
 * A drawn line at a layout's reference scale: its x, its vertical run, half its stroke and the edges it must keep
 * its stroke between (its window's, or the clear run of it the line stands in), all in px.
 */
export type LineSlot = { key: string; x: number; top: number; bottom: number; half: number; left: number; right: number };

/** Two lines closer than this (px) are spread apart... */
export const LINE_GAP = 6;
/** ...by at most this much each (px). */
export const LINE_SHIFT = 4;

/**
 * How far to move each line sideways so no two that share some height sit closer than `gap` px: each of a
 * close pair moves half the shortfall, at most `most` px in all, and never so far that its stroke leaves its
 * own shared window (a line never stands outside the time it stands for). Lines that do not share any height
 * are left alone. Returns px offsets by key; most are 0.
 */
export function spreadLines(lines: readonly LineSlot[], gap = LINE_GAP, most = LINE_SHIFT): Map<string, number> {
  const offset = new Map(lines.map((line) => [line.key, 0]));
  const range = (line: LineSlot): [number, number] => {
    const lo = Math.max(-most, line.left + line.half - line.x);
    const hi = Math.min(most, line.right - line.half - line.x);
    return lo <= hi ? [lo, hi] : [0, 0];
  };
  const clamp = (line: LineSlot, value: number) => {
    const [lo, hi] = range(line);
    return Math.min(hi, Math.max(lo, value));
  };
  const sorted = [...lines].sort((a, b) => a.x - b.x || a.key.localeCompare(b.key));
  for (let round = 0; round < 12; round += 1) {
    let changed = false;
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i];
        const b = sorted[j];
        if (!(a.top < b.bottom && b.top < a.bottom)) continue;
        const oa = offset.get(a.key) ?? 0;
        const ob = offset.get(b.key) ?? 0;
        const apart = b.x + ob - (a.x + oa);
        if (Math.abs(apart) >= gap - 1e-9) continue;
        const need = (gap - Math.abs(apart)) / 2;
        const sign = apart >= 0 ? 1 : -1;
        const na = clamp(a, oa - sign * need);
        const nb = clamp(b, ob + sign * need);
        if (Math.abs(na - oa) > 1e-9 || Math.abs(nb - ob) > 1e-9) {
          offset.set(a.key, na);
          offset.set(b.key, nb);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return offset;
}

/** The paper casing each side of a quiet line (px). */
export const CASING = 2;
/** Clear paper kept between a line's casing and a name it passes (px). */
const NAME_CLEAR = 1;

/**
 * Where a line may stand in its shared window so that its stroke and casing pass clear of the names it crosses
 * (`inks`, the minutes those names cover): of the points that cross the fewest names (none, when the window has
 * room), the one nearest the window's middle, with `room`, the run of such points around it, which a spread may
 * use, and how many names it still `crosses`. The middle itself whenever no point crosses fewer; a name the line
 * still crosses is drawn over it, so the line passes behind. Null only for a window narrower than the stroke.
 * Taken at the narrowest track, it holds at any wider one: names keep their size while minutes stretch.
 */
export function clearPlace(window: Span, half: number, inks: readonly Span[], scale: number): { at: number; room: Span; crosses: number } | null {
  const middle = (window.start + window.end) / 2;
  const lo = window.start + half / scale;
  const hi = window.end - half / scale;
  if (lo > hi) return null;
  const reach = (half + CASING + NAME_CLEAR) / scale;
  const blocked = inks.map((ink) => ({ start: ink.start - reach, end: ink.end + reach })).filter((span) => span.end > lo && span.start < hi);
  // Between two consecutive edges the count of names crossed holds; merge neighbours with the same count.
  const edges = [...new Set([lo, hi, ...blocked.flatMap((span) => [span.start, span.end]).filter((x) => x > lo && x < hi)])].sort((a, b) => a - b);
  if (edges.length === 1) edges.push(lo);
  const runs: { start: number; end: number; crosses: number }[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    const inside = (start + end) / 2;
    const crosses = blocked.filter((span) => span.start < inside && inside < span.end).length;
    const last = runs.at(-1);
    if (last && last.crosses === crosses && last.end === start) last.end = end;
    else runs.push({ start, end, crosses });
  }
  const fewest = Math.min(...runs.map((run) => run.crosses));
  let best: { at: number; room: Span; crosses: number } | null = null;
  for (const run of runs.filter((item) => item.crosses === fewest)) {
    const at = Math.min(run.end, Math.max(run.start, middle));
    if (!best || Math.abs(at - middle) < Math.abs(best.at - middle)) best = { at, room: { start: run.start, end: run.end }, crosses: fewest };
  }
  return best;
}

/** A note's gap from the mark it describes (px). */
export const NOTE_GAP = 6;

/**
 * Which side of a mark (`top` to `bottom`, px down a drawing `height` px tall) its note goes, the side with more
 * room, and `offset`: for a note above the mark, the distance from the drawing's bottom to the note's bottom; for
 * one below, from the drawing's top to the note's top. Laid out in a column that lets that distance give way, a note taller than its
 * room is pushed back inside the drawing (it may then cover part of the mark), so it never covers what is above
 * or below the drawing.
 */
export function noteSide(top: number, bottom: number, height: number): { above: boolean; offset: number } {
  const above = top - NOTE_GAP >= height - bottom - NOTE_GAP;
  return above ? { above, offset: Math.max(0, height - top + NOTE_GAP) } : { above, offset: Math.max(0, bottom + NOTE_GAP) };
}

// ------------------------------------------------------------------------------------ the lines' keys and colours

/**
 * The next line for an arrow key, Home or End, in rank order, or null for any other key. The ends hold
 * (no wrapping): Arrow past the last rank stays on it.
 */
export function stepLine(order: readonly string[], current: string | null, key: string): string | null {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return order[Math.min(order.length - 1, at + 1)];
    case "ArrowLeft":
    case "ArrowUp":
      return order[Math.max(0, at - 1)];
    case "Home":
      return order[0];
    case "End":
      return order[order.length - 1];
    default:
      return null;
  }
}

/**
 * What a key does on a focused line: move focus to another line (a pinned note follows it), or, for
 * Escape, close the note and keep focus where it is. Enter and Space press the line's button, which pins
 * or unpins its note.
 */
export function lineKeyAction(order: readonly string[], current: string, key: string): { focus: string | null; unpin: boolean } {
  if (key === "Escape") return { focus: null, unpin: true };
  return { focus: stepLine(order, current, key), unpin: false };
}

/**
 * A line's stroke: teal for the chosen clash and quiet teal for the other ranked clashes; ink and grey on the
 * invented day, which has no Qloo reading, and grey for an overlap the report does not rank (no taste rank to show).
 */
export function lineColor(lit: boolean, synthetic: boolean, ranked = true): string {
  if (synthetic || !ranked) return lit ? "var(--foreground)" : "var(--border-strong)";
  return lit ? "var(--prov-qloo)" : "var(--taste-quiet)";
}

// ------------------------------------------------------------------------------------ text

/** Advance widths of Archivo at weight 600 for U+0020 to U+007E, in thousandths of an em (measured, rounded up). */
const GLYPHS = [
  205, 292, 444, 583, 541, 966, 730, 247, 358, 358, 407, 636, 300, 333, 300, 298, 579, 579, 579, 579, 579, 579, 579, 579, 579,
  579, 336, 336, 636, 636, 636, 613, 1002, 710, 706, 725, 731, 674, 611, 795, 735, 282, 585, 695, 570, 846, 735, 785, 670, 785,
  722, 670, 619, 728, 671, 955, 686, 677, 635, 339, 298, 339, 636, 507, 214, 556, 593, 547, 593, 561, 295, 591, 584, 252, 250,
  543, 252, 861, 584, 598, 593, 593, 363, 541, 314, 583, 529, 758, 546, 529, 509, 394, 245, 394, 636,
];

/** The drawing's label size (px): names, tags, the axis and the stage names. */
export const LABEL_SIZE = 12.5;
/** A label's line box (px). */
export const LABEL_LINE = 15;

/** A label's width in px at `size`, a little over the measured advance so a name never fits by a hair. */
export function textWidth(text: string, size = LABEL_SIZE): number {
  let em = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    em += code >= 32 && code < 127 ? GLYPHS[code - 32] : 640;
  }
  return (em / 1000) * size * 1.02 + 1;
}

// ------------------------------------------------------------------------------------ the layouts

/** The stage names' column (px) to the left of the time track. */
export const GUTTER: Record<DrawingLayout, number> = { desktop: 96, phone: 64, short: 64 };
/**
 * The narrowest time track each layout is laid out for (px): a 1024px window less the page's gutters and
 * the stage names (desktop), and a 360px phone less the same (phone and short, whose track spans the detail
 * window). A phone narrower than 360px gets its names and tags placed again at `NARROW_TRACK`.
 */
export const REFERENCE_TRACK: Record<DrawingLayout, number> = { desktop: 832, phone: 264, short: 264 };
/** The detail track of a 320px phone (px): names and tags for phones below 360px are placed at this width. */
export const NARROW_TRACK = 224;
/** Where a bar starts in its row (px): room above it for a featured name. */
export const BAR_TOP: Record<DrawingLayout, number> = { desktop: 19, phone: 17, short: 17 };
/** Where the phone's detail starts under the overview strip and its gap (px). */
export const DETAIL_TOP = LAYOUT.phone.overview + LAYOUT.phone.gap;

const LABEL_GAP: Record<DrawingLayout, number> = { desktop: 3, phone: 2, short: 2 };
/** A name's inset inside its bar (px). */
export const NAME_INSET = 6;
/** The room a lock glyph takes at the start of a bar, before its name (px): the 12px glyph and a 4px gap. */
export const LOCK_INSET = 16;
/** A window's inset from each of its two bars (px). */
export const WINDOW_INSET = 2;
/** The corner of every mark in the drawing (px): bars, windows, the ghost and the bracket. */
export const MARK_RADIUS = 6;
const TAG_GAP = 4;
/** The paper plate behind a name or tag that sits over lines (px each side). */
export const PLATE = 2;
/** Clear space kept between a label and anything beside it (px). */
const CLEAR = 2;

/** The drawing's time track: the day, widened to hold the phone's detail window. */
export function trackOf(model: Pick<DayGraphModel, "domain" | "focus">): Span {
  return { start: Math.min(model.domain.start, model.focus.start), end: Math.max(model.domain.end, model.focus.end) };
}

/** The stages a layout draws, top to bottom: every stage on a desktop, `phoneRows` on a phone. */
export function rowsOf(model: Pick<DayGraphModel, "stages" | "phoneRows">, layout: DrawingLayout): number[] {
  return layout === "desktop" ? model.stages.map((_, index) => index) : [...model.phoneRows];
}

/** The top of row `row` in px from the top of the track (the axis is above row 0). */
export function rowTop(layout: DrawingLayout, row: number): number {
  return LAYOUT[layout].axis + row * LAYOUT[layout].row;
}

export function barTopOf(layout: DrawingLayout, row: number): number {
  return rowTop(layout, row) + BAR_TOP[layout];
}

export function barBottomOf(layout: DrawingLayout, row: number): number {
  return barTopOf(layout, row) + LAYOUT[layout].bar;
}

/** Whether a bar `span` long holds a name inside it at `scale` px per minute (a name that does not fit whole is cut). */
export function holdsName(set: Pick<DayGraphSet, "locked">, span: Span, scale: number): boolean {
  return (span.end - span.start) * scale >= 2 * NAME_INSET + (set.locked ? 24 : 12);
}

/**
 * The minutes of its bar that a set's own name and lock may cover, at `scale` or at any wider track (the text
 * keeps its size while minutes stretch, so it covers fewer of them there), or null when the bar shows neither.
 * A featured set's name sits outside its bar, so only its lock counts.
 */
export function nameInk(set: DayGraphSet, span: Span, scale: number): Span | null {
  const named = !set.featured && holdsName(set, span, scale);
  if (!named && !set.locked) return null;
  const ink = NAME_INSET + (set.locked ? LOCK_INSET : 0) + (named ? textWidth(set.name) : 0);
  return { start: span.start, end: Math.min(span.end, span.start + ink / scale) };
}

/** The view's displacement: 1 for the moved view of a day with a move, else 0. */
export function viewP(model: Pick<DayGraphModel, "move">, view: GraphView): number {
  return view === "moved" && model.move ? 1 : 0;
}

/** Where a set plays in a view: the mover's moved slot and stage in the moved view, else its published one. */
export function placeOf(model: Pick<DayGraphModel, "move">, set: DayGraphSet, view: GraphView): { span: Span; stage: number } {
  const move = model.move;
  if (move && view === "moved" && set.actId === move.actId) return { span: { start: move.to.start, end: move.to.end }, stage: move.to.stageIndex };
  return { span: { start: set.start, end: set.end }, stage: set.stageIndex };
}

/** A line's key, from its two sets. */
export function threadKey(thread: Pick<DayGraphThread, "aId" | "bId">): string {
  return `${thread.aId}~${thread.bId}`;
}

// ------------------------------------------------------------------------------------ the plan

/**
 * Where a name or tag sits: `anchor` minutes along the track plus `dx` px, its start or its end there, `top`
 * px down the track. `cut` is the span a name that fits nowhere whole is cut to: from its bar's start to just
 * before the next thing beside it (at a wider track it often shows whole), else null.
 */
export type Spot = {
  kind: SpotKind;
  anchor: number;
  dx: number;
  align: "start" | "end";
  top: number;
  cut: Span | null;
  /** Whether it sits on a paper plate (it is over the gaps, where lines run). */
  plate: boolean;
};

export type SpotKind =
  | "above-start"
  | "above-end"
  | "inline-start"
  | "inline-end"
  | "below-start"
  | "below-end"
  | "inside"
  | "beside-end"
  | "beside-start"
  | "under"
  | "over";

export type PlanBar = { set: DayGraphSet; span: Span; row: number; top: number; mover: boolean };
export type PlanLine = {
  key: string;
  thread: DayGraphThread;
  window: Span;
  /**
   * The minute the line stands at: its window's middle, or for a quiet line that stays put, the point of its
   * window nearest the middle that passes clear of the names in the rows it crosses, or of most of them (see
   * `clearPlace`).
   */
  mid: number;
  upper: number;
  lower: number;
  top: number;
  bottom: number;
  width: number;
  /** Sideways spread in px (at every width; see `spreadLines`). */
  off: number;
  /** Whether the mover is one of its ends (it follows the move). */
  moving: boolean;
};
export type PlanWindow = { key: string; window: Span; upper: number; lower: number; top: number; bottom: number };
export type PlanCreated = PlanWindow & { change: OverlapChange };
export type PlanTag = { key: string; text: string; spot: Spot };
export type ViewPlan = {
  bars: PlanBar[];
  lines: PlanLine[];
  /** The chosen clash's shared minutes between its two bars. */
  hatch: PlanWindow | null;
  /** The overlaps the move starts or lengthens (moved view only). */
  created: PlanCreated[];
  /** The mover's published slot, drawn dashed in the moved view. */
  ghost: PlanBar | null;
  /** Featured names by act id. */
  labels: Record<string, Spot>;
  tags: PlanTag[];
};
export type LayoutPlan = {
  layout: DrawingLayout;
  track: Span;
  /** px per minute at the reference track. */
  scale: number;
  /** Stage indices drawn, top to bottom. */
  rows: number[];
  views: Record<GraphView, ViewPlan>;
};

type Box = { x0: number; x1: number; y0: number; y1: number };

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 + CLEAR && b.x0 < a.x1 + CLEAR && a.y0 < b.y1 && b.y0 < a.y1;

/** The tag on a grown window: "new 15 min" when the move starts it, "+10 min" when it lengthens it. */
export function createdTag(change: Pick<OverlapChange, "before" | "after">): string {
  return change.before === 0 ? `new ${change.after} min` : `+${change.after - change.before} min`;
}

/** The tag on the chosen clash's window: its minutes in that view. */
export function sharedTag(minutes: number): string {
  return `${minutes} min shared`;
}

/**
 * The plan of one layout in both views: bars, lines (with their spread), the chosen clash's window, the
 * grown windows, the ghost, then every featured name and tag placed so it covers no bar, window or other
 * label. A name keeps the same placement in both views whenever one fits both, so it only travels with its
 * bar; otherwise each view takes its own and the drawing swaps them when it settles.
 */
export function planDrawing(model: DayGraphModel, layout: DrawingLayout, reference = REFERENCE_TRACK[layout]): LayoutPlan {
  const track = trackOf(model);
  const rows = rowsOf(model, layout);
  const rowOfStage = new Map(rows.map((stage, row) => [stage, row]));
  const focusLength = Math.max(1, model.focus.end - model.focus.start);
  const scale = reference / (layout === "desktop" ? Math.max(1, track.end - track.start) : focusLength);
  const x = (minute: number) => (minute - track.start) * scale;
  // Names and tags stay on the track, and on a phone inside the detail window it opens on.
  const left = layout === "desktop" ? 0 : Math.max(0, x(model.focus.start));
  const right = layout === "desktop" ? x(track.end) : Math.min(x(track.end), x(model.focus.end));
  const setById = new Map(model.sets.map((set) => [set.actId, set]));
  const { move } = model;
  const bar = LAYOUT[layout].bar;

  const viewOf = (view: GraphView): ViewPlan => {
    const rowOf = (set: DayGraphSet) => rowOfStage.get(placeOf(model, set, view).stage);
    const bars: PlanBar[] = model.sets.flatMap((set) => {
      const row = rowOf(set);
      if (row === undefined) return [];
      return [{ set, span: placeOf(model, set, view).span, row, top: barTopOf(layout, row), mover: set.actId === move?.actId }];
    });
    const mover = move ? setById.get(move.actId) : undefined;
    const ghostRow = move ? rowOfStage.get(move.from.stageIndex) : undefined;
    const ghost: PlanBar | null =
      view === "moved" && move && mover && ghostRow !== undefined
        ? { set: mover, span: { start: move.from.start, end: move.from.end }, row: ghostRow, top: barTopOf(layout, ghostRow), mover: true }
        : null;

    const between = (key: string, window: Span, rowA: number, rowB: number): PlanWindow | null => {
      if (rowA === rowB) return null;
      const upper = Math.min(rowA, rowB);
      const lower = Math.max(rowA, rowB);
      return { key, window, upper, lower, top: barBottomOf(layout, upper) + WINDOW_INSET, bottom: barTopOf(layout, lower) - WINDOW_INSET };
    };

    const lines: PlanLine[] = model.threads.flatMap((thread) => {
      const a = setById.get(thread.aId);
      const b = setById.get(thread.bId);
      if (!a || !b) return [];
      const window = view === "moved" && move && thread.moved ? thread.moved.window : thread.window;
      const rowA = rowOf(a);
      const rowB = rowOf(b);
      if (!window || rowA === undefined || rowB === undefined || rowA === rowB) return [];
      const upper = Math.min(rowA, rowB);
      const lower = Math.max(rowA, rowB);
      return [
        {
          key: threadKey(thread),
          thread,
          window,
          mid: (window.start + window.end) / 2,
          upper,
          lower,
          top: barBottomOf(layout, upper),
          bottom: barTopOf(layout, lower),
          width: threadWidth(thread.taste),
          off: 0,
          moving: Boolean(move && thread.moved),
        },
      ];
    });
    // A quiet line that stays put stands clear of the names it crosses when its window has room, else crosses as
    // few as it can. The mover's lines keep the middle of their window at every p, so the move stays exact. A
    // line that still crosses a name passes behind it, since names are drawn over the lines.
    const inks = bars.flatMap((item) => {
      const ink = nameInk(item.set, item.span, scale);
      return ink ? [{ row: item.row, ink }] : [];
    });
    const rooms = new Map<string, Span>();
    for (const line of lines) {
      if (line.moving || line.thread.lit) continue;
      const crossed = inks.filter((item) => item.row > line.upper && item.row < line.lower).map((item) => item.ink);
      const place = crossed.length > 0 ? clearPlace(line.window, line.width / 2, crossed, scale) : null;
      if (!place) continue;
      line.mid = place.at;
      rooms.set(line.key, place.room);
    }
    const spread = spreadLines(
      lines.map((line) => {
        const room = rooms.get(line.key);
        return {
          key: line.key,
          x: x(line.mid),
          top: line.top,
          bottom: line.bottom,
          half: line.width / 2,
          left: room ? x(room.start) - line.width / 2 : x(line.window.start),
          right: room ? x(room.end) + line.width / 2 : x(line.window.end),
        };
      }),
    );
    for (const line of lines) line.off = Math.round((spread.get(line.key) ?? 0) * 100) / 100;

    let hatch: PlanWindow | null = null;
    if (move) {
      const partner = setById.get(move.partnerId);
      const shared = view === "moved" ? move.sharedAfter : move.sharedBefore;
      const moverRow = mover ? rowOf(mover) : undefined;
      const partnerRow = partner ? rowOf(partner) : undefined;
      if (shared && moverRow !== undefined && partnerRow !== undefined) hatch = between("hatch", shared, moverRow, partnerRow);
    } else {
      const lit = model.threads.find((thread) => thread.lit);
      const a = lit ? setById.get(lit.aId) : undefined;
      const b = lit ? setById.get(lit.bId) : undefined;
      const rowA = a ? rowOf(a) : undefined;
      const rowB = b ? rowOf(b) : undefined;
      if (lit && rowA !== undefined && rowB !== undefined) hatch = between("hatch", lit.window, rowA, rowB);
    }

    const created: PlanCreated[] =
      view === "moved" && move && mover
        ? move.grows.flatMap((change) => {
            const other = setById.get(change.actId);
            const moverRow = rowOf(mover);
            const otherRow = other ? rowOf(other) : undefined;
            if (!change.afterWindow || moverRow === undefined || otherRow === undefined) return [];
            const window = between(`created:${change.actId}`, change.afterWindow, moverRow, otherRow);
            return window ? [{ ...window, change }] : [];
          })
        : [];

    return { bars, lines, hatch, created, ghost, labels: {}, tags: [] };
  };

  const views: Record<GraphView, ViewPlan> = { published: viewOf("published"), moved: viewOf("moved") };
  const kinds: SpotKind[] =
    layout === "desktop"
      ? ["above-start", "above-end", "inline-start", "inline-end", "below-start", "below-end"]
      : ["above-start", "above-end", "inline-start", "inline-end"];
  const drawnViews: GraphView[] = move ? ["published", "moved"] : ["published"];

  // What a label may not cover, per view: every bar (but its own), the ghost and every window.
  const windowBox = (window: PlanWindow): Box => ({ x0: x(window.window.start), x1: x(window.window.end), y0: window.top, y1: window.bottom });
  const blocked: Record<GraphView, { id: string | null; box: Box }[]> = { published: [], moved: [] };
  for (const view of drawnViews) {
    const plan = views[view];
    for (const item of plan.bars) blocked[view].push({ id: item.set.actId, box: { x0: x(item.span.start), x1: x(item.span.end), y0: item.top, y1: item.top + bar } });
    if (plan.ghost) blocked[view].push({ id: null, box: { x0: x(plan.ghost.span.start), x1: x(plan.ghost.span.end), y0: plan.ghost.top, y1: plan.ghost.top + bar } });
    if (plan.hatch) blocked[view].push({ id: null, box: windowBox(plan.hatch) });
    for (const window of plan.created) blocked[view].push({ id: null, box: windowBox(window) });
  }

  const boxOf = (spot: Spot, width: number): Box => {
    const at = x(spot.anchor) + spot.dx;
    const w = spot.cut ? Math.max(0, x(spot.cut.end) - x(spot.cut.start) - spot.dx) : width;
    return spot.align === "start" ? { x0: at, x1: at + w, y0: spot.top, y1: spot.top + LABEL_LINE } : { x0: at - w, x1: at, y0: spot.top, y1: spot.top + LABEL_LINE };
  };
  const fits = (view: GraphView, box: Box, own: string | null) =>
    box.x0 >= left && box.x1 <= right && blocked[view].every((item) => (own !== null && item.id === own) || !overlaps(box, item.box));

  /** A name that fits nowhere whole runs from its bar's start to just before the next thing in its bar's band. */
  const cutSpot = (view: GraphView, place: PlanBar): Spot => {
    const inline = place.top + (bar - LABEL_LINE) / 2;
    const lead = NAME_INSET + (place.set.locked ? LOCK_INSET : 0);
    const from = x(place.span.start);
    const band: Box = { x0: from, x1: right, y0: inline, y1: inline + LABEL_LINE };
    const stop = blocked[view]
      .filter((item) => item.id !== place.set.actId && item.box.x0 > from + lead && item.box.y0 < band.y1 && band.y0 < item.box.y1)
      .reduce((nearest, item) => Math.min(nearest, item.box.x0 - CLEAR), right);
    const end = Math.max(place.span.end, track.start + stop / scale);
    return { kind: "inside", anchor: place.span.start, dx: lead, align: "start", top: inline, cut: { start: place.span.start, end }, plate: false };
  };

  // Featured names: the mover, its partner, then every set whose overlap grows.
  const order = [...model.sets]
    .filter((set) => set.featured)
    .sort((a, b) => rank(a) - rank(b) || a.stageIndex - b.stageIndex || a.start - b.start);
  function rank(set: DayGraphSet): number {
    if (!move) return 0;
    if (set.actId === move.actId) return 0;
    if (set.actId === move.partnerId) return 1;
    const grown = move.grows.findIndex((change) => change.actId === set.actId);
    return grown >= 0 ? 2 + grown : 99;
  }

  const nameSpot = (kind: SpotKind, place: PlanBar): Spot => {
    const above = barTopOf(layout, place.row) - LABEL_GAP[layout] - LABEL_LINE;
    const inline = place.top + (bar - LABEL_LINE) / 2;
    const below = place.top + bar + LABEL_GAP[layout];
    const { start, end } = place.span;
    const lead = NAME_INSET + (place.set.locked ? LOCK_INSET : 0);
    switch (kind) {
      case "above-start":
        return { kind, anchor: start, dx: 0, align: "start", top: above, cut: null, plate: true };
      case "above-end":
        return { kind, anchor: end, dx: 0, align: "end", top: above, cut: null, plate: true };
      case "inline-start":
        return { kind, anchor: start, dx: lead, align: "start", top: inline, cut: null, plate: false };
      case "inline-end":
        return { kind, anchor: end, dx: -NAME_INSET, align: "end", top: inline, cut: null, plate: false };
      case "below-start":
        return { kind, anchor: start, dx: 0, align: "start", top: below, cut: null, plate: true };
      case "below-end":
        return { kind, anchor: end, dx: 0, align: "end", top: below, cut: null, plate: true };
      default:
        return { kind: "inside", anchor: start, dx: lead, align: "start", top: inline, cut: { start, end }, plate: false };
    }
  };

  for (const set of order) {
    const places = drawnViews.flatMap((view) => {
      const place = views[view].bars.find((item) => item.set.actId === set.actId);
      return place ? [{ view, place }] : [];
    });
    if (places.length === 0) continue;
    const width = (spot: Spot) => textWidth(set.name) + (spot.plate ? 2 * PLATE : 0);
    const valid = (kind: SpotKind, view: GraphView, place: PlanBar) => {
      const spot = nameSpot(kind, place);
      return fits(view, boxOf(spot, width(spot)), set.actId) ? spot : null;
    };
    const shared = kinds.find((kind) => places.every(({ view, place }) => valid(kind, view, place)));
    for (const { view, place } of places) {
      const spot = (shared ? valid(shared, view, place) : null) ?? kinds.map((kind) => valid(kind, view, place)).find(Boolean) ?? cutSpot(view, place);
      views[view].labels[set.actId] = spot;
      blocked[view].push({ id: null, box: boxOf(spot, width(spot)) });
    }
  }

  // Tags: beside their window in the gap nearest its lower bar first, so the figure sits by the hatch it names.
  const tagSpots = (window: PlanWindow): Spot[] => {
    const spots: Spot[] = [];
    for (let gap = window.lower - 1; gap >= window.upper; gap -= 1) {
      const middle = (barBottomOf(layout, gap) + barTopOf(layout, gap + 1)) / 2;
      const top = middle - LABEL_LINE / 2;
      spots.push({ kind: "beside-end", anchor: window.window.end, dx: TAG_GAP, align: "start", top, cut: null, plate: true });
      spots.push({ kind: "beside-start", anchor: window.window.start, dx: -TAG_GAP, align: "end", top, cut: null, plate: true });
    }
    if (layout === "desktop") {
      spots.push({ kind: "under", anchor: window.window.start, dx: 0, align: "start", top: barBottomOf(layout, window.lower) + LABEL_GAP[layout], cut: null, plate: true });
      spots.push({ kind: "over", anchor: window.window.start, dx: 0, align: "start", top: barTopOf(layout, window.upper) - LABEL_GAP[layout] - LABEL_LINE, cut: null, plate: true });
    }
    return spots;
  };
  for (const view of drawnViews) {
    const plan = views[view];
    const wanted: { key: string; text: string; window: PlanWindow }[] = [];
    if (plan.hatch) {
      const minutes = move ? (view === "moved" ? move.minutesAfter : move.minutesBefore) : (model.threads.find((thread) => thread.lit)?.minutes ?? 0);
      wanted.push({ key: "hatch", text: sharedTag(minutes), window: plan.hatch });
    }
    for (const window of plan.created) wanted.push({ key: window.key, text: createdTag(window.change), window });
    for (const item of wanted) {
      const width = textWidth(item.text) + 2 * PLATE;
      const spots = tagSpots(item.window);
      const spot = spots.find((candidate) => fits(view, boxOf(candidate, width), null)) ?? spots[0];
      plan.tags.push({ key: item.key, text: item.text, spot });
      blocked[view].push({ id: null, box: boxOf(spot, width) });
    }
  }
  if (!move) views.moved = views.published;

  return { layout, track, scale, rows, views };
}

/** A label's box at the plan's reference scale (px), for the geometry checks. */
export function spotBox(plan: Pick<LayoutPlan, "track" | "scale">, spot: Spot, text: string): Box {
  const x = (minute: number) => (minute - plan.track.start) * plan.scale;
  const at = x(spot.anchor) + spot.dx;
  const width = spot.cut ? Math.max(0, x(spot.cut.end) - x(spot.cut.start) - spot.dx) : textWidth(text) + (spot.plate ? 2 * PLATE : 0);
  return spot.align === "start" ? { x0: at, x1: at + width, y0: spot.top, y1: spot.top + LABEL_LINE } : { x0: at - width, x1: at, y0: spot.top, y1: spot.top + LABEL_LINE };
}

// ------------------------------------------------------------------------------------ keyframes

/** One keyframe of the move: an offset in [0, 1] and the transform and opacity there. */
export type MoveKeyframe = { offset: number; transform?: string; opacity?: number };

/** A percentage of the track, as CSS. */
export function pct(value: number): string {
  return `${Math.round(value * 10000) / 10000}%`;
}

/** Where a minute sits on the track, in percent. */
export function trackPct(track: Span, minute: number): number {
  return ((minute - track.start) / Math.max(1, track.end - track.start)) * 100;
}

/** The transform that puts a line (drawn at the track's left edge) at minute `mid` plus `off` px. */
export function lineTransform(track: Span, mid: number, off: number): string {
  return `translateX(calc(${pct(trackPct(track, mid))} + ${Math.round(off * 100) / 100}px))`;
}

/** The transform of the mover's layer at `p`: the share of the track it has travelled. */
export function moverTransform(track: Span, move: MovePlaces, p: number): string {
  return `translateX(${pct(((moverAt(move, p).start - move.from.start) / Math.max(1, track.end - track.start)) * 100)})`;
}

/**
 * The transform of a wash inside a bar spanning `bar` (as a share of the bar's own box): the shared minutes
 * `window`, or nothing. The wash is flat, and the bar's own rounded shape clips it.
 */
export function washTransform(bar: Span, window: Span | null): string {
  const length = Math.max(1e-9, bar.end - bar.start);
  if (!window) return "translateX(0%) scaleX(0)";
  const from = (window.start - bar.start) / length;
  const share = (window.end - window.start) / length;
  return `translateX(${pct(from * 100)}) scaleX(${Math.round(share * 100000) / 100000})`;
}

/** The transform of a window's left or right edge piece: the edge's place on the track. */
export function edgeTransform(track: Span, minute: number): string {
  return `translateX(${pct(trackPct(track, minute))})`;
}

/**
 * Every keyframe list of a flight from `fromP` to `toP` in one layout, by the `data-anim` key the drawing
 * gives the element:
 * - `mover` (or `mover@0` and `mover@1`, one per row, crossfading, when the stage changes): the mover's layer;
 * - `wash:mover`, `wash:partner`: the chosen clash's wash inside each bar;
 * - `line:{key}` (or `line:{key}@0` / `@1`): each line that touches the mover, its x and whether it is drawn;
 * - `sline:{key}` (or `@0` / `@1`): the same line in the phone's overview strip, which is never spread;
 * - `hatch:L`, `hatch:R`, and `hatch@0` / `hatch@1` when the stage changes: the chosen clash's window edges;
 * - `created:{id}:L`, `created:{id}:R`, `created:{id}`: each grown window's edges and its presence;
 * - `ghost`: the published slot's dashed outline.
 * Keyframes sit at the flight's stops; at a stop where a line starts or stops being drawn there are two
 * keyframes at the same offset, so it appears or goes at the exact contact, never faded across.
 */
export function flightKeyframes(model: DayGraphModel, plan: LayoutPlan, fromP: number, toP: number): Record<string, MoveKeyframe[]> {
  const out: Record<string, MoveKeyframe[]> = {};
  const move = model.move;
  if (!move || fromP === toP) return out;
  const { track } = plan;
  const setById = new Map(model.sets.map((set) => [set.actId, set]));
  const others = model.sets.filter((set) => set.actId !== move.actId);
  const stops = flightStops(moveBreakpoints(move, others), fromP, toP);
  const crossfade = move.from.stageIndex !== move.to.stageIndex;
  const pub = plan.views.published;
  const moved = plan.views.moved;

  // A value that holds on each segment between stops: two keyframes at a stop where it changes.
  const build = (at: (p: number) => Omit<MoveKeyframe, "offset">, present?: (p: number) => boolean) => {
    const frames: MoveKeyframe[] = [];
    stops.forEach((stop, i) => {
      const value = at(stop.p);
      if (!present) {
        frames.push({ offset: stop.offset, ...value });
        return;
      }
      const before = i === 0 ? null : present((stops[i - 1].p + stop.p) / 2);
      const after = i === stops.length - 1 ? null : present((stop.p + stops[i + 1].p) / 2);
      const here = (shown: boolean | null) => ({ offset: stop.offset, ...value, opacity: (value.opacity ?? 1) * (shown ? 1 : 0) });
      const atEnd = i === 0 || i === stops.length - 1;
      if (atEnd) {
        // An end of the flight is a view or the point it was interrupted at: drawn as that view draws it.
        const endP = stop.p;
        const shown = endP === 0 || endP === 1 ? present(endP) : (before ?? after ?? false);
        frames.push(here(shown));
      } else if (before === after) {
        frames.push(here(before));
      } else {
        frames.push(here(before), here(after));
      }
    });
    return frames;
  };

  const rowsFade = (key: string, at: (p: number) => Omit<MoveKeyframe, "offset">, present?: (p: number) => boolean) => {
    if (!crossfade) {
      out[key] = build(at, present);
      return;
    }
    out[`${key}@0`] = build((p) => ({ ...at(p), opacity: (at(p).opacity ?? 1) * (1 - p) }), present);
    out[`${key}@1`] = build((p) => ({ ...at(p), opacity: (at(p).opacity ?? 1) * p }), present);
  };

  rowsFade("mover", (p) => ({ transform: moverTransform(track, move, p) }));

  const partner = setById.get(move.partnerId);
  if (partner) {
    const partnerSpan = { start: partner.start, end: partner.end };
    out["wash:partner"] = build((p) => ({ transform: washTransform(partnerSpan, windowAt(move, partnerSpan, p)) }));
    out["wash:mover"] = build((p) => ({ transform: washTransform(moverAt(move, p), windowAt(move, partnerSpan, p)) }));
    out["hatch:L"] = build((p) => ({ transform: edgeTransform(track, edgesAt(move, partnerSpan, p).start) }));
    out["hatch:R"] = build((p) => ({ transform: edgeTransform(track, edgesAt(move, partnerSpan, p).end) }));
    if (crossfade) {
      out["hatch@0"] = build((p) => ({ opacity: 1 - p }));
      out["hatch@1"] = build((p) => ({ opacity: p }));
    }
  }

  for (const thread of model.threads) {
    if (!thread.moved) continue;
    const otherId = thread.aId === move.actId ? thread.bId : thread.aId;
    const other = setById.get(otherId);
    if (!other) continue;
    const otherSpan = { start: other.start, end: other.end };
    const key = threadKey(thread);
    const offPub = pub.lines.find((line) => line.key === key)?.off;
    const offMoved = moved.lines.find((line) => line.key === key)?.off;
    const offAt = (p: number) => lerp(offPub ?? offMoved ?? 0, offMoved ?? offPub ?? 0, p);
    const midAt = (p: number) => {
      const edges = edgesAt(move, otherSpan, p);
      return (edges.start + edges.end) / 2;
    };
    const present = (p: number) => windowAt(move, otherSpan, p) !== null;
    rowsFade(`line:${key}`, (p) => ({ transform: lineTransform(track, midAt(p), offAt(p)) }), present);
    rowsFade(`sline:${key}`, (p) => ({ transform: lineTransform(track, midAt(p), 0) }), present);
  }

  // A line the mover does not touch stays put, but its spread can differ between the views when a moving
  // line comes near it; it slides between the two spreads with the move.
  for (const line of pub.lines) {
    if (line.moving) continue;
    const there = moved.lines.find((item) => item.key === line.key);
    if (!there || there.off === line.off) continue;
    out[`line:${line.key}`] = build((p) => ({ transform: lineTransform(track, line.mid, lerp(line.off, there.off, p)) }));
  }

  for (const change of move.grows) {
    const other = setById.get(change.actId);
    if (!other) continue;
    const otherSpan = { start: other.start, end: other.end };
    const id = `created:${change.actId}`;
    out[`${id}:L`] = build((p) => ({ transform: edgeTransform(track, edgesAt(move, otherSpan, p).start) }));
    out[`${id}:R`] = build((p) => ({ transform: edgeTransform(track, edgesAt(move, otherSpan, p).end) }));
    // A new overlap is there exactly when it is not empty (its edges say so); one that only lengthens was
    // there all along, unmarked in the published view, so its mark fades in with the move.
    out[id] = build((p) => ({ opacity: (change.before === 0 ? 1 : p) * (crossfade ? p : 1) }));
  }

  out.ghost = build((p) => ({ opacity: p }));
  return out;
}
