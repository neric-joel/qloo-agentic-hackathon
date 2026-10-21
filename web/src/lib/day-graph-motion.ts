/**
 * The day drawing's geometry and its one move, as pure functions, so the server frame, the interactive frame
 * and every frame of the move come from the same numbers.
 *
 * The move is a displacement p from the mover's published slot (0) to its moved slot (1). Everything that
 * touches the mover is an exact function of p: the mover's place, each overlap window it has with another
 * set, each such line's x (a fixed share of the way across that window) and whether it is drawn at all (an
 * empty overlap is not). Between two breakpoints (the p values where a mover edge meets another set's edge)
 * every one of those edges moves linearly, so keyframes at the breakpoints with linear steps between them are
 * exact.
 *
 * The plan of a layout says where every bar, window, line, name and tag goes in each view. Times become
 * percentages of the drawing's time track; the pixel decisions (where each name goes, where each line stands)
 * are taken at the narrowest track a band of screen widths draws, and hold at any wider one in that band,
 * because names keep their size while time stretches. Names come first, then lines: the featured names and
 * their tags, then every other name (whole inside its bar, beside it, on a plate in the gap above or below
 * it, or as a prefix of at least 8 characters), and only then the lines, each standing where it clears every
 * name, or passing beneath the bars whose names it cannot clear.
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
/** Clear paper kept between a line's casing and a name inside a bar it passes over (px). */
const NAME_CLEAR = 1;
/** Clear paper kept between a line's stroke and any name, tag or plate on the paper (px). */
export const LINE_CLEAR = 2;
/**
 * How far a line running beside the chosen clash's window keeps off its edges when its own window allows; else as
 * far as its window allows, then in 2px steps (px).
 */
export const HATCH_CLEAR = 8;
/**
 * A line crossing another set's bar stands at least this far inside it (px), past its 6px corner, so the bar's
 * rounded corner and edge read whole...
 */
export const EDGE_IN = 9;
/** ...or its stroke stands at least this far clear of the bar (px). */
export const EDGE_OUT = 3;
/**
 * A line drawn over another set's bar leaves at least this much of the bar (px) each side of its paper casing, so the
 * bar never reads as cut into a sliver; nearer its end, the line passes beneath the bar.
 */
export const BAR_STUB = 8;
/** Two lines over the same rows keep their middles at least this far apart (px), so they never read as one doubled rule. */
export const LINE_APART = 7;
/** The room (px of places for its middle) a name tries to leave a line clear of bar edges, so a neighbour still fits beside it. */
export const LINE_ROOM = 8;
/** The most steps the names' search takes before it keeps the best it has found. */
export const SEARCH_STEPS = 3000;

/**
 * Where a line may stand in its shared window: of the points that cross the fewest names (`inks`, the minutes the
 * names inside the bars it passes cover; none when the window has room) and none of the `walls` (minutes it may
 * never stand in: the names, tags and plates on the paper it passes, already widened by the line's reach), the
 * one nearest the window's middle, with `room`, the run of such points around it, which a spread may use, and
 * how many names it still `crosses`. The middle itself whenever no point crosses fewer. Null for a window
 * narrower than the stroke, or one the walls close. Taken at the narrowest track, it holds at any wider one:
 * names keep their size while minutes stretch.
 */
export function clearPlace(
  window: Span,
  half: number,
  inks: readonly Span[],
  scale: number,
  walls: readonly Span[] = [],
): { at: number; room: Span; crosses: number } | null {
  const middle = (window.start + window.end) / 2;
  const lo = window.start + half / scale;
  const hi = window.end - half / scale;
  if (lo > hi) return null;
  const reach = (half + CASING + NAME_CLEAR) / scale;
  const blocked = [
    ...inks.map((ink) => ({ start: ink.start - reach, end: ink.end + reach, weight: 1 })),
    ...walls.map((wall) => ({ start: wall.start, end: wall.end, weight: Number.POSITIVE_INFINITY })),
  ].filter((span) => span.end > lo && span.start < hi);
  // Between two consecutive edges the count of names crossed holds; merge neighbours with the same count.
  const edges = [...new Set([lo, hi, ...blocked.flatMap((span) => [span.start, span.end]).filter((x) => x > lo && x < hi)])].sort((a, b) => a - b);
  if (edges.length === 1) edges.push(lo);
  const runs: { start: number; end: number; crosses: number }[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    const inside = (start + end) / 2;
    const crosses = blocked.filter((span) => span.start <= inside && inside <= span.end && (span.start < inside || inside < span.end)).reduce((sum, span) => sum + span.weight, 0);
    const last = runs.at(-1);
    if (last && last.crosses === crosses && last.end === start) last.end = end;
    else runs.push({ start, end, crosses });
  }
  const fewest = Math.min(...runs.map((run) => run.crosses));
  if (!Number.isFinite(fewest)) return null;
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

/**
 * Where a line's note goes so it covers neither of the line's two names (`marks`: the line and both its sets'
 * bars and names, px across and down the note's column): beside the marks, on the side with more room, when the
 * column leaves `width` px there; else above or below them, on the side with more room. Beside, `x` is the note's
 * left edge and `y` its top, centred on the marks and kept inside the drawing; above or below, `y` is that
 * side's offset as `noteSide` gives it and `x` is null (the note centres on the line).
 */
export function notePlace(
  marks: { x0: number; x1: number; y0: number; y1: number },
  column: { width: number; height: number },
  note: { width: number; height: number },
): { side: "left" | "right"; x: number; y: number } | { side: "above" | "below"; x: null; y: number } {
  const roomLeft = marks.x0 - NOTE_GAP;
  const roomRight = column.width - marks.x1 - NOTE_GAP;
  if (Math.max(roomLeft, roomRight) >= note.width) {
    const y = Math.min(Math.max(0, (marks.y0 + marks.y1) / 2 - note.height / 2), Math.max(0, column.height - note.height));
    return roomRight >= note.width ? { side: "right", x: marks.x1 + NOTE_GAP, y } : { side: "left", x: marks.x0 - NOTE_GAP - note.width, y };
  }
  const { above, offset } = noteSide(marks.y0, marks.y1, column.height);
  return { side: above ? "above" : "below", x: null, y: offset };
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
 * What a key does on a focused line: move focus to another line (its note shows with it, as on hover, and a
 * pinned note follows it), or, for Escape, close the note and keep focus where it is. Enter and Space press
 * the line's button, which pins or unpins its note.
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

/**
 * A line's stroke width in the drawing (px): its taste width, and at least 2px for an overlap the report does
 * not rank, so the overlap a move ends reads as a line of its own and not as the edge of the window beside it.
 */
export function strokeWidth(thread: Pick<DayGraphThread, "taste" | "ranked">): number {
  return thread.ranked ? threadWidth(thread.taste) : Math.max(2, threadWidth(thread.taste));
}

// ------------------------------------------------------------------------------------ text

/** Advance widths of Archivo at weight 600 for U+0020 to U+007E, in thousandths of an em (measured, rounded up). */
const GLYPHS = [
  205, 292, 444, 583, 541, 966, 730, 247, 358, 358, 407, 636, 300, 333, 300, 298, 579, 579, 579, 579, 579, 579, 579, 579, 579,
  579, 336, 336, 636, 636, 636, 613, 1002, 710, 706, 725, 731, 674, 611, 795, 735, 282, 585, 695, 570, 846, 735, 785, 670, 785,
  722, 670, 619, 728, 671, 955, 686, 677, 635, 339, 298, 339, 636, 507, 214, 556, 593, 547, 593, 561, 295, 591, 584, 252, 250,
  543, 252, 861, 584, 598, 593, 593, 363, 541, 314, 583, 529, 758, 546, 529, 509, 394, 245, 394, 636,
];

/** The same at weight 500, the weight of a name that is not featured (measured, rounded up). */
const GLYPHS_500 = [
  205, 282, 407, 582, 524, 959, 710, 227, 356, 356, 407, 630, 288, 333, 288, 296, 574, 547, 571, 575, 566, 573, 575, 564, 575,
  574, 315, 315, 630, 630, 630, 595, 1002, 695, 702, 725, 731, 674, 611, 795, 734, 274, 571, 677, 552, 846, 734, 785, 667, 785,
  722, 670, 612, 729, 659, 939, 684, 666, 635, 316, 296, 316, 630, 495, 197, 550, 579, 532, 579, 554, 293, 573, 573, 238, 236,
  528, 238, 860, 573, 583, 579, 579, 346, 524, 305, 572, 516, 740, 529, 516, 503, 372, 245, 372, 630,
];

/** The ellipsis that ends a name's prefix, at each weight (measured). */
const ELLIPSIS_WIDTH: Record<LabelWeight, number> = { 500: 901, 600: 965 };

export type LabelWeight = 500 | 600;

/** The ellipsis that ends a name drawn as a prefix. */
export const ELLIPSIS = "…";

/** The drawing's label size (px): names, tags, the axis and the stage names. */
export const LABEL_SIZE = 12.5;
/** A label's line box (px). */
export const LABEL_LINE = 15;

/** A label's width in px at `size` and `weight`, a little over the measured advance so a name never fits by a hair. */
export function textWidth(text: string, size = LABEL_SIZE, weight: LabelWeight = 600): number {
  const table = weight === 500 ? GLYPHS_500 : GLYPHS;
  let em = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    em += code >= 32 && code < 127 ? table[code - 32] : char === ELLIPSIS ? ELLIPSIS_WIDTH[weight] : 760;
  }
  return (em / 1000) * size * 1.02 + 1;
}

/** The fewest characters a name drawn as a prefix keeps before its ellipsis. */
export const PREFIX_MIN = 8;

/**
 * The longest start of `name` that, with an ellipsis, fits `room` px: at least `PREFIX_MIN` characters (trailing
 * spaces and commas dropped), or null when not even that fits, or when the whole name fits and needs no cut.
 */
export function namePrefix(name: string, room: number, weight: LabelWeight): string | null {
  if (textWidth(name, LABEL_SIZE, weight) <= room) return null;
  const chars = [...name];
  for (let count = chars.length - 1; count >= PREFIX_MIN; count -= 1) {
    const head = chars.slice(0, count).join("").replace(/[\s,;:&-]+$/u, "");
    if ([...head].length < PREFIX_MIN) continue;
    const text = `${head}${ELLIPSIS}`;
    if (textWidth(text, LABEL_SIZE, weight) <= room) return text;
  }
  return null;
}

/** A name set on two lines at a word break, the break that makes the wider line narrowest; null for one word. */
export function twoLines(name: string, weight: LabelWeight): [string, string] | null {
  let best: [string, string] | null = null;
  let widest = Number.POSITIVE_INFINITY;
  for (let at = name.indexOf(" "); at > 0; at = name.indexOf(" ", at + 1)) {
    const lines: [string, string] = [name.slice(0, at), name.slice(at + 1)];
    const width = Math.max(...lines.map((line) => textWidth(line, LABEL_SIZE, weight)));
    if (width < widest) {
      widest = width;
      best = lines;
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------ the layouts

/** The stage names' column (px) to the left of the time track. */
export const GUTTER: Record<DrawingLayout, number> = { desktop: 96, phone: 64, short: 64 };

/**
 * The bands of screen widths each layout is placed for, each from its `from` width up to the next band's, with
 * the narrowest time track drawn in it (px): a desktop from 1024px (the page's 40px gutters and the stage names
 * off a 1024px window), from 1120px (the narrowest track that holds every name of both published days) and from
 * 1280px, where the page's 1200px column stops growing; a phone from 320px, 360px and 390px (its 16px gutters and
 * the stage names off the window, the track spanning the detail window). Names and lines are placed at the band's
 * track and hold at any wider one inside it.
 */
export const BANDS: Record<DrawingLayout, readonly { from: number; track: number }[]> = {
  desktop: [
    { from: 1024, track: 848 },
    { from: 1120, track: 944 },
    { from: 1280, track: 1104 },
  ],
  phone: [
    { from: 320, track: 224 },
    { from: 360, track: 264 },
    { from: 390, track: 294 },
  ],
  short: [
    { from: 320, track: 224 },
    { from: 360, track: 264 },
    { from: 390, track: 294 },
  ],
};

/** The time track each layout is laid out for when no band is named (px): a 1024px desktop, a 360px phone. */
export const REFERENCE_TRACK: Record<DrawingLayout, number> = { desktop: 848, phone: 264, short: 264 };
/** The detail track of a 320px phone (px). */
export const NARROW_TRACK = 224;
/** Where a bar starts in its row (px): room above it for a name. */
export const BAR_TOP: Record<DrawingLayout, number> = { desktop: 19, phone: 17, short: 17 };
/** Where the phone's detail starts under the overview strip and its gap (px). */
export const DETAIL_TOP = LAYOUT.phone.overview + LAYOUT.phone.gap;

/**
 * The gap between a name on a plate and its own bar (px): 1px on a phone, whose 18px row gap holds a 15px line
 * with 1px to its own bar and 2px to the bar across the gap. A tag keeps the same gap to the two bars of the
 * window it names.
 */
export const LABEL_GAP: Record<DrawingLayout, number> = { desktop: 3, phone: 1, short: 1 };
/** Clear space kept between a name, tag or plate and every other set's bar, every window and every other label (px). */
export const CLEAR: Record<DrawingLayout, number> = { desktop: 2, phone: 2, short: 2 };
/**
 * A tag's clear space from a bar that is not one of its window's two (px): on a phone it sits centred in an 18px
 * row gap, 1.5px from the bars either side, the clearance a phone's row gap allows.
 */
export const TAG_BAR_CLEAR: Record<DrawingLayout, number> = { desktop: 2, phone: 1, short: 1 };
/** A name's inset inside its bar (px). */
export const NAME_INSET = 6;
/** The room a prefix keeps after its ellipsis, before its bar's end (px): the ellipsis sits clear of the rounded end. */
export const PREFIX_END = 3;
/** The room a lock glyph takes at the start of a bar, before its name (px): the 12px glyph and a 4px gap. */
export const LOCK_INSET = 16;
/** A window's inset from each of its two bars (px). */
export const WINDOW_INSET = 2;
/** The corner of every mark in the drawing (px): bars, windows, the ghost and the bracket. */
export const MARK_RADIUS = 6;
const TAG_GAP = 4;
/** The paper plate behind a name or tag in a row gap, where lines run (px each side). */
export const PLATE = 2;
/** A name beside its bar starts this far past the bar's end (px)... */
export const BESIDE_GAP = 4;
/** ...and stops at least this far before the next bar on its row (px): three times its gap to its own bar, so it reads as that bar's. */
export const BESIDE_STOP = 12;
/** A name on the paper prefers to keep this far from every other name and tag (px), so two never read as one. */
export const ROOMY = 6;

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
 * Where a set's name is drawn, in the order a name tries them: (a) whole inside its bar; (b) whole on the row's
 * paper just past its bar's end; (c) whole on a paper plate in the row gap directly above or below its bar (on
 * two lines on a desktop when one is too wide); (d) a prefix of at least 8 characters inside its bar, ending in
 * an ellipsis; (e) not drawn (only from the narrowest desktop band down, and only as a last resort), the bar
 * then carrying the name in its title and note.
 */
export type NameSlot = "a" | "b" | "c" | "d" | "e";

/** What a label is: a name inside its bar, a prefix, a name beside its bar, a name on a plate above or below it, or a tag. */
export type SpotKind = "inside" | "prefix" | "beside" | "above" | "below" | "tag";

/**
 * Where a name or tag sits: `anchor` minutes along the track plus `dx` px, its start, end or centre there,
 * `top` px down the track, `width` and `height` px (with its plate), and the `lines` of text it shows.
 */
export type Spot = {
  kind: SpotKind;
  /** The name's slot; null for a tag. */
  slot: NameSlot | null;
  anchor: number;
  dx: number;
  align: "start" | "end" | "center";
  top: number;
  width: number;
  height: number;
  lines: string[];
  /** Whether it sits on a paper plate (it is in a row gap, where lines run). */
  plate: boolean;
};

export type PlanBar = { set: DayGraphSet; span: Span; row: number; top: number; mover: boolean };
export type PlanLine = {
  key: string;
  thread: DayGraphThread;
  window: Span;
  /**
   * The minute the line stands at: the point of its window nearest the middle that passes clear of every name
   * on the paper it crosses, and of the names inside the bars it crosses when it can (see `clearPlace`).
   */
  mid: number;
  /** Where `mid` sits across the window, 0 its start and 1 its end; a line that follows the mover keeps it. */
  frac: number;
  upper: number;
  lower: number;
  top: number;
  bottom: number;
  width: number;
  /** Sideways spread in px (at every width; see `spreadLines`). */
  off: number;
  /** Whether the mover is one of its ends (it follows the move). */
  moving: boolean;
  /** Whether it passes beneath the bars it crosses (whose names it could not clear), so they hide it there. */
  under: boolean;
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
  /** Every drawn name, by act id (a set in slot e has none). */
  labels: Record<string, Spot>;
  /** Every drawn set's slot, by act id. */
  slots: Record<string, NameSlot>;
  tags: PlanTag[];
};
export type LayoutPlan = {
  layout: DrawingLayout;
  track: Span;
  /** px per minute at the reference track. */
  scale: number;
  /** The track width placed for (px). */
  reference: number;
  /** Stage indices drawn, top to bottom. */
  rows: number[];
  views: Record<GraphView, ViewPlan>;
};

export type Box = { x0: number; x1: number; y0: number; y1: number };

/** Whether two boxes come closer than `gap` px on both axes. */
const near = (a: Box, b: Box, gap: number) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/** The shortest distance between two boxes (px; 0 when they touch or overlap). */
export function boxGap(a: Box, b: Box): number {
  return Math.hypot(Math.max(0, b.x0 - a.x1, a.x0 - b.x1), Math.max(0, b.y0 - a.y1, a.y0 - b.y1));
}

/** How far two boxes overlap across (px). */
export function overlapX(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
}

/** The tag on a grown window: "new 15 min" when the move starts it, "+10 min" when it lengthens it. */
export function createdTag(change: Pick<OverlapChange, "before" | "after">): string {
  return change.before === 0 ? `new ${change.after} min` : `+${change.after - change.before} min`;
}

/** The tag on the chosen clash's window: its minutes in that view. */
export function sharedTag(minutes: number): string {
  return `${minutes} min shared`;
}

/** A candidate place for a name: its spot (null for slot e) and what makes it the same place in another view. */
type Candidate = { slot: NameSlot; spot: Spot | null; sig: string };

/**
 * The plan of one layout at one band's track, in both views: bars, lines, the chosen clash's window, the grown
 * windows and the ghost; then the names and tags (featured names and their tags first, then every other name,
 * each in the first slot that fits, the most hemmed-in first), each clear of every bar, window and other label,
 * nearer its own bar than any other, and never closing the way of a line; then the lines, each standing clear of
 * every name (or passing beneath the bars whose names it cannot clear) and spread from its neighbours. A name keeps
 * the same place in both views whenever one fits both, so it only travels with its bar; otherwise each view takes
 * its own and the drawing swaps them when it settles.
 */
export function planDrawing(model: DayGraphModel, layout: DrawingLayout, reference = REFERENCE_TRACK[layout]): LayoutPlan {
  const track = trackOf(model);
  const rows = rowsOf(model, layout);
  const rowOfStage = new Map(rows.map((stage, row) => [stage, row]));
  const desktop = layout === "desktop";
  const focusLength = Math.max(1, model.focus.end - model.focus.start);
  const scale = reference / (desktop ? Math.max(1, track.end - track.start) : focusLength);
  const x = (minute: number) => (minute - track.start) * scale;
  const minuteAt = (px: number) => track.start + px / scale;
  // What the reader sees of the track: all of it on a desktop, the detail window a phone opens on.
  const seenFrom = desktop ? track.start : Math.max(track.start, model.focus.start);
  const seenTo = desktop ? track.end : Math.min(track.end, model.focus.end);
  const left = x(seenFrom);
  const right = x(seenTo);
  const ceiling = LAYOUT[layout].axis;
  // A phone's label lane under its last row holds names too.
  const floor = LAYOUT[layout].axis + rows.length * LAYOUT[layout].row + (layout === "desktop" ? 0 : LAYOUT[layout].foot);
  const setById = new Map(model.sets.map((set) => [set.actId, set]));
  const { move } = model;
  const bar = LAYOUT[layout].bar;
  const clear = CLEAR[layout];
  const gapV = LABEL_GAP[layout];
  const seen = (span: Span): Span | null => {
    const start = Math.max(span.start, seenFrom);
    const end = Math.min(span.end, seenTo);
    return end - start > EMPTY ? { start, end } : null;
  };

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
          frac: 0.5,
          upper,
          lower,
          top: barBottomOf(layout, upper),
          bottom: barTopOf(layout, lower),
          width: strokeWidth(thread),
          off: 0,
          moving: Boolean(move && thread.moved),
          under: false,
        },
      ];
    });

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

    return { bars, lines, hatch, created, ghost, labels: {}, slots: {}, tags: [] };
  };

  const views: Record<GraphView, ViewPlan> = { published: viewOf("published"), moved: viewOf("moved") };
  const drawnViews: GraphView[] = move ? ["published", "moved"] : ["published"];

  // ---- what a label may not come near, per view: every bar, the ghost, every window and every label placed
  type Thing = { id: string | null; box: Box; kind: "bar" | "ghost" | "window" | "label" };
  const things: Record<GraphView, Thing[]> = { published: [], moved: [] };
  /** The names, tags and plates on the paper: lines may never cross them. */
  const paper: Record<GraphView, Box[]> = { published: [], moved: [] };
  /** The names (and locks) inside bars, by row: a line clears them or passes beneath their bars. */
  const inks: Record<GraphView, { row: number; box: Box }[]> = { published: [], moved: [] };
  const barBox = (place: Pick<PlanBar, "span" | "top">): Box => ({ x0: x(place.span.start), x1: x(place.span.end), y0: place.top, y1: place.top + bar });
  const windowBox = (window: PlanWindow): Box => ({ x0: x(window.window.start), x1: x(window.window.end), y0: window.top, y1: window.bottom });
  for (const view of drawnViews) {
    const plan = views[view];
    for (const item of plan.bars) things[view].push({ id: item.set.actId, box: barBox(item), kind: "bar" });
    if (plan.ghost) things[view].push({ id: plan.ghost.set.actId, box: barBox(plan.ghost), kind: "ghost" });
    if (plan.hatch) things[view].push({ id: null, box: windowBox(plan.hatch), kind: "window" });
    for (const window of plan.created) things[view].push({ id: null, box: windowBox(window), kind: "window" });
    // A lock sits at the start of its bar whatever the name does.
    for (const item of plan.bars) {
      const shown = seen(item.span);
      if (!item.set.locked || !shown) continue;
      inks[view].push({ row: item.row, box: { x0: x(shown.start), x1: x(shown.start) + NAME_INSET + LOCK_INSET, y0: item.top, y1: item.top + bar } });
    }
  }

  const boxOf = (spot: Spot): Box => {
    const at = x(spot.anchor) + spot.dx;
    const x0 = spot.align === "start" ? at : spot.align === "end" ? at - spot.width : at - spot.width / 2;
    return { x0, x1: x0 + spot.width, y0: spot.top, y1: spot.top + spot.height };
  };

  // ---- the lines' way through the paper
  /** A line's end dot's radius plus the 1px it keeps clear of a name (px). */
  const dotReach = (line: PlanLine) => (line.thread.lit ? 4 : 3) + 1;
  /** The part of a line's window the reader sees (a phone sees only its detail window); null when none of it shows. */
  const shownWindow = (line: PlanLine): Span | null => {
    const span = seen(line.window);
    return span && (span.end - span.start) * scale >= line.width ? span : null;
  };
  /**
   * The minutes a line's middle may not stand in for each name, tag or plate on the paper: within its stroke plus
   * 2px of the box along its run, and within its end dot plus 1px of the box at either end (measured round the dot).
   */
  const wallsOf = (line: PlanLine, boxes: readonly Box[]): Span[] => {
    const stroke = line.width / 2 + LINE_CLEAR;
    const dot = dotReach(line);
    const gapTo = (y: number, box: Box) => Math.max(0, box.y0 - y, y - box.y1);
    return boxes.flatMap((box) => {
      let reach = box.y0 < line.bottom && line.top < box.y1 ? stroke : Number.NEGATIVE_INFINITY;
      for (const end of [line.top, line.bottom]) {
        const dy = gapTo(end, box);
        if (dy < dot) reach = Math.max(reach, Math.sqrt(dot * dot - dy * dy));
      }
      return Number.isFinite(reach) ? [{ start: minuteAt(box.x0 - reach), end: minuteAt(box.x1 + reach) }] : [];
    });
  };
  /** The lines whose way a box on the paper can narrow. */
  const touchingLines = (view: GraphView, box: Box): PlanLine[] =>
    views[view].lines.filter((line) => {
      const window = shownWindow(line);
      if (!window) return false;
      const reach = Math.max(line.width / 2 + LINE_CLEAR, dotReach(line)) + 1;
      return box.y0 < line.bottom + reach && line.top - reach < box.y1 && box.x0 - reach < x(window.end) && box.x1 + reach > x(window.start);
    });
  /** Whether each of `lines` still has a way clear of the paper's names once `box` is added. */
  const wayOn = (view: GraphView, box: Box, lines: readonly PlanLine[]): boolean =>
    lines.every((line) => {
      const window = shownWindow(line);
      return !window || clearPlace(window, line.width / 2, [], scale, wallsOf(line, [...paper[view], box])) !== null;
    });
  /** Whether every line of the view still has a way clear of the paper's names once `box` is added. */
  const leavesWay = (view: GraphView, box: Box): boolean => wayOn(view, box, touchingLines(view, box));

  /**
   * The edges of the bars a line crosses that are not its own two sets' (and of the ghost): minutes its middle keeps
   * off, `inside` px into the bar and its stroke `EDGE_OUT` px outside it.
   */
  const barEdgesOf = (line: PlanLine, marks: readonly PlanBar[], inside = EDGE_IN): Span[] => {
    const outside = line.width / 2 + EDGE_OUT;
    return marks
      .filter((item) => item.row > line.upper && item.row < line.lower && item.set.actId !== line.thread.aId && item.set.actId !== line.thread.bId)
      .flatMap((item) => {
        const x0 = x(item.span.start);
        const x1 = x(item.span.end);
        if (x1 - x0 < 2 * inside) return [{ start: minuteAt(x0 - outside), end: minuteAt(x1 + outside) }];
        return [
          { start: minuteAt(x0 - outside), end: minuteAt(x0 + inside) },
          { start: minuteAt(x1 - inside), end: minuteAt(x1 + outside) },
        ];
      });
  };
  const edgeCache = new Map<GraphView, Map<string, Span[]>>();
  const edgesOf = (view: GraphView, line: PlanLine): Span[] => {
    const byLine = edgeCache.get(view) ?? new Map<string, Span[]>();
    edgeCache.set(view, byLine);
    const known = byLine.get(line.key);
    if (known) return known;
    const plan = views[view];
    const zones = barEdgesOf(line, [...plan.bars, ...(plan.ghost ? [plan.ghost] : [])]);
    byLine.set(line.key, zones);
    return zones;
  };
  /** How many px of places a line's middle has in its window clear of the paper's names (and `extra`) and of the edges of the bars it crosses. */
  const roomOf = (view: GraphView, line: PlanLine, extra: readonly Box[]): number => {
    const window = shownWindow(line);
    if (!window) return Number.POSITIVE_INFINITY;
    const lo = x(window.start) + line.width / 2;
    const hi = x(window.end) - line.width / 2;
    if (lo > hi) return 0;
    const spans = [...wallsOf(line, [...paper[view], ...extra]), ...edgesOf(view, line)]
      .map((span) => [Math.max(lo, x(span.start)), Math.min(hi, x(span.end))] as const)
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let upTo = lo;
    for (const [a, b] of spans) {
      if (b <= upTo) continue;
      covered += b - Math.max(a, upTo);
      upTo = b;
    }
    return Math.max(0, hi - lo - covered);
  };
  /**
   * What a box on the paper costs the lines it can narrow: 2 when one of them loses every place clear of the edges
   * of the bars it crosses, 1 when one is left too little room for a neighbour beside it, else 0. Names prefer the
   * places that cost least, so the lines can stand well inside the bars they cross, or clear of them, and apart.
   */
  const roomCost = (view: GraphView, box: Box): number => {
    let worst = 0;
    for (const line of touchingLines(view, box)) {
      const before = roomOf(view, line, []);
      if (before <= 0) continue;
      const after = roomOf(view, line, [box]);
      if (after <= 0) return 2;
      if (after < LINE_ROOM && before >= LINE_ROOM) worst = 1;
    }
    return worst;
  };

  /** A name beside its bar stops `BESIDE_STOP` px before the next bar or slot on its row. */
  const besideStops = (view: GraphView, box: Box) =>
    things[view].every((thing) => !(thing.kind === "bar" || thing.kind === "ghost") || thing.box.y1 <= box.y0 || thing.box.y0 >= box.y1 || thing.box.x1 <= box.x0 || thing.box.x0 >= box.x1 + BESIDE_STOP);
  /** Whether a name on the paper keeps `ROOMY` px from every other name and tag. */
  const roomy = (view: GraphView, box: Box) => things[view].every((thing) => thing.kind !== "label" || !near(box, thing.box, ROOMY));
  const within = (box: Box) => box.x0 >= left - 1e-6 && box.x1 <= right + 1e-6 && box.y0 >= ceiling - 1e-6 && box.y1 <= floor + 1e-6;
  /**
   * Whether a label's box keeps `CLEAR` px from every mark and label (`barClear` from another set's bar), except the
   * bars it belongs to (its own set's bar and published slot; for a tag, the two bars of its window), which it keeps
   * `LABEL_GAP` px from and never touches.
   */
  const clearOf = (view: GraphView, box: Box, owners: readonly string[] = [], barClear = clear) =>
    things[view].every((thing) => {
      const bars = thing.kind === "bar" || thing.kind === "ghost";
      const own = bars && thing.id !== null && owners.includes(thing.id);
      return !near(box, thing.box, own ? gapV : bars ? barClear : clear);
    });

  /**
   * Whether a name's box is plainly its own bar's: nearer that bar than any other set's bar (or the mover's
   * published slot), and for a plate, over its own bar for at least half its width.
   */
  const ownedBy = (view: GraphView, box: Box, own: string, plate: boolean): boolean => {
    const ownThing = things[view].find((thing) => thing.kind === "bar" && thing.id === own);
    if (!ownThing) return false;
    const ownBox = { ...ownThing.box, x0: Math.max(ownThing.box.x0, left), x1: Math.min(ownThing.box.x1, right) };
    if (ownBox.x1 <= ownBox.x0) return false;
    const mine = boxGap(box, ownBox);
    for (const thing of things[view]) {
      // Another set's bar, or the mover's published slot for any name but the mover's own.
      if (!(thing.kind === "bar" || thing.kind === "ghost") || thing.id === own) continue;
      const other = { ...thing.box, x0: Math.max(thing.box.x0, left), x1: Math.min(thing.box.x1, right) };
      if (other.x1 <= other.x0) continue;
      if (boxGap(box, other) <= mine + 1e-6) return false;
    }
    return !plate || overlapX(box, ownBox) >= (box.x1 - box.x0) / 2 - 1e-6;
  };

  const paperOk = (view: GraphView, spot: Spot, own: string, plate: boolean, strict: boolean) => {
    const box = boxOf(spot);
    return (
      within(box) &&
      clearOf(view, box, [own]) &&
      (spot.kind !== "beside" || besideStops(view, box)) &&
      (!strict || ownedBy(view, box, own, plate)) &&
      leavesWay(view, box)
    );
  };

  // ---- candidates
  const inline = (place: PlanBar) => place.top + (bar - LABEL_LINE) / 2;
  const lead = (set: DayGraphSet) => NAME_INSET + (set.locked ? LOCK_INSET : 0);

  /** Slot a or d: the whole name inside the bar's seen part, or its longest prefix of 8 characters or more. */
  const insideOf = (place: PlanBar, weight: LabelWeight): Candidate | null => {
    const shown = seen(place.span);
    if (!shown) return null;
    const room = (shown.end - shown.start) * scale - lead(place.set) - NAME_INSET;
    const name = place.set.name;
    const make = (slot: NameSlot, text: string): Candidate => ({
      slot,
      sig: `${slot}|${text}`,
      spot: {
        kind: slot === "a" ? "inside" : "prefix",
        slot,
        anchor: shown.start,
        dx: lead(place.set),
        align: "start",
        top: inline(place),
        width: textWidth(text, LABEL_SIZE, weight),
        height: LABEL_LINE,
        lines: [text],
        plate: false,
      },
    });
    if (textWidth(name, LABEL_SIZE, weight) <= room) return make("a", name);
    const prefix = namePrefix(name, room + NAME_INSET - PREFIX_END, weight);
    return prefix ? make("d", prefix) : null;
  };

  /** Slot b: the name on the row's paper, starting just past the bar's end. */
  const besideOf = (place: PlanBar, weight: LabelWeight): Candidate | null => {
    const shown = seen(place.span);
    if (!shown || shown.end < place.span.end) return null;
    const width = textWidth(place.set.name, LABEL_SIZE, weight);
    return {
      slot: "b",
      sig: "b",
      spot: { kind: "beside", slot: "b", anchor: place.span.end, dx: BESIDE_GAP, align: "start", top: inline(place), width, height: LABEL_LINE, lines: [place.set.name], plate: false },
    };
  };

  /**
   * Slot c: the name on a plate in the gap directly above or below its bar, aligned with the bar's start, its
   * end or its middle, then slid along in 8px steps while it still covers its bar for half its width, and last
   * slid as far each way as that and its neighbours on the row allow (so a line by the bar keeps a way past it).
   */
  const platesOf = (view: GraphView, place: PlanBar, side: "above" | "below", lines: string[], weight: LabelWeight): Candidate[] => {
    const shown = seen(place.span);
    if (!shown) return [];
    const width = Math.max(...lines.map((line) => textWidth(line, LABEL_SIZE, weight))) + 2 * PLATE;
    const height = LABEL_LINE * lines.length;
    const top = side === "above" ? place.top - gapV - height : place.top + bar + gapV;
    const out: Candidate[] = [];
    const add = (role: "start" | "end" | "center", dx: number) => {
      const anchor = role === "start" ? shown.start : role === "end" ? shown.end : (shown.start + shown.end) / 2;
      const sig = `c|${side}|${role}|${Math.round(dx * 100)}|${lines.join("/")}`;
      if (out.some((item) => item.sig === sig)) return;
      out.push({ slot: "c", sig, spot: { kind: side, slot: "c", anchor, dx, align: role, top, width, height, lines, plate: true } });
    };
    add("start", 0);
    add("end", 0);
    add("center", 0);
    // Slid off the bar's start to the left, or off its end to the right, while at least half the plate stays
    // over the bar (`ownedBy` checks it).
    for (let step = 8; step <= width / 2; step += 8) {
      add("start", -step);
      add("end", step);
    }
    // As far each way as half the plate over the bar allows, short of the next bar on the row.
    const x0 = x(shown.start);
    const x1 = x(shown.end);
    const row = things[view].filter((thing) => (thing.kind === "bar" || thing.kind === "ghost") && thing.id !== place.set.actId && thing.box.y0 === place.top);
    const before = Math.max(Number.NEGATIVE_INFINITY, ...row.filter((thing) => thing.box.x1 <= x0 + 1e-6).map((thing) => thing.box.x1));
    const after = Math.min(Number.POSITIVE_INFINITY, ...row.filter((thing) => thing.box.x0 >= x1 - 1e-6).map((thing) => thing.box.x0));
    add("start", -width / 2);
    add("end", width / 2);
    const lo = Math.max(x0 - width / 2, before + 0.5);
    const hi = Math.min(x1 + width / 2, after - 0.5);
    if (lo < x0) add("start", lo - x0);
    if (hi > x1) add("end", hi - x1);
    return out;
  };

  // ---- placing
  const take = (view: GraphView, setId: string, candidate: Candidate) => {
    const plan = views[view];
    plan.slots[setId] = candidate.slot;
    const spot = candidate.spot;
    if (!spot) return;
    plan.labels[setId] = spot;
    const box = boxOf(spot);
    if (spot.kind === "inside" || spot.kind === "prefix") {
      const place = plan.bars.find((item) => item.set.actId === setId);
      inks[view].push({ row: place?.row ?? -1, box: { ...box, x0: box.x0 - spot.dx, y0: place?.top ?? box.y0, y1: (place?.top ?? box.y0) + bar } });
    } else {
      things[view].push({ id: null, box, kind: "label" });
      paper[view].push(box);
    }
  };

  /**
   * One set's name in every view it is drawn in: in each view the first candidate that fits; when the views'
   * first fits are of one slot and one tier (a featured name's places that keep every rule, then the looser ones)
   * and some candidate of that slot and tier fits both, that one in both.
   */
  const settle = (set: DayGraphSet, ladder: (view: GraphView, place: PlanBar) => { candidate: Candidate; ok: boolean }[]): void => {
    const places = drawnViews.flatMap((view) => {
      const place = views[view].bars.find((item) => item.set.actId === set.actId);
      return place && seen(place.span) ? [{ view, place }] : [];
    });
    if (places.length === 0) return;
    const fits = places.map(({ view, place }) => ladder(view, place).filter((item) => item.ok).map((item) => item.candidate));
    const firsts = fits.map((list) => list[0]);
    if (firsts.some((first) => !first)) return;
    const tier = (candidate: Candidate) => `${candidate.slot}|${/^(loose|forced)\|/.exec(candidate.sig)?.[1] ?? ""}`;
    const slot = tier(firsts[0]);
    if (firsts.every((first) => tier(first) === slot)) {
      const shared = fits[0].find((candidate) => tier(candidate) === slot && fits.every((list) => list.some((other) => other.sig === candidate.sig)));
      if (shared) {
        places.forEach(({ view }, i) => take(view, set.actId, fits[i].find((candidate) => candidate.sig === shared.sig) as Candidate));
        return;
      }
    }
    places.forEach(({ view }, i) => take(view, set.actId, firsts[i]));
  };

  const none: Candidate = { slot: "e", sig: "e", spot: null };

  // Featured names first: the mover, its partner, then every set whose overlap grows; always whole and outside the
  // bar, at every width: above it, below it (a phone's bottom row has its label lane) or beside it, plainly its
  // own; then anywhere outside it that is clear and nearer its own bar than any other; then, so a featured name is
  // never cut or left out, the first place above or below that is on the drawing and plainly its own.
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
  for (const set of order) {
    settle(set, (view, place) => {
      const outside = [...platesOf(view, place, "above", [set.name], 600), ...platesOf(view, place, "below", [set.name], 600)];
      const beside = besideOf(place, 600);
      // Of the places that keep every rule, the ones that leave the lines nearby their room come first.
      const strict = [...outside, ...(beside ? [beside] : [])]
        .map((candidate, i) => {
          const ok = candidate.spot !== null && paperOk(view, candidate.spot, set.actId, candidate.spot.plate, true);
          return { candidate, ok, i, cost: ok ? roomCost(view, boxOf(candidate.spot as Spot)) : 3 };
        })
        .sort((a, b) => a.cost - b.cost || a.i - b.i)
        .map(({ candidate, ok }) => ({ candidate, ok }));
      const loose = outside.map((candidate) => ({
        candidate: { ...candidate, sig: `loose|${candidate.sig}` },
        ok: candidate.spot !== null && paperOk(view, candidate.spot, set.actId, false, false) && ownedBy(view, boxOf(candidate.spot), set.actId, false),
      }));
      const forced = outside.map((candidate) => ({
        candidate: { ...candidate, sig: `forced|${candidate.sig}` },
        ok: candidate.spot !== null && within(boxOf(candidate.spot)) && ownedBy(view, boxOf(candidate.spot), set.actId, true),
      }));
      return [...strict, ...loose, ...forced, { candidate: none, ok: true }];
    });
  }

  // Tags: beside their window in the gap nearest its lower bar first, so the figure sits by the hatch it names;
  // on a desktop, set on two lines when one line would close a line's way; on a phone, left out rather than cut
  // when no place on the screen holds it (the readout under the drawing gives the same minutes).
  const tagSpots = (window: PlanWindow, lines: string[]): Spot[] => {
    const width = Math.max(...lines.map((line) => textWidth(line))) + 2 * PLATE;
    const height = LABEL_LINE * lines.length;
    const spot = (anchor: number, dx: number, align: Spot["align"], top: number): Spot => ({ kind: "tag", slot: null, anchor, dx, align, top, width, height, lines, plate: true });
    const spots: Spot[] = [];
    for (let gap = window.lower - 1; gap >= window.upper; gap -= 1) {
      // Centred in the gap; else against the bar below or above it, `LABEL_GAP` off it (one of the window's own
      // bars, as `clearOf` checks) and `CLEAR` off the bar across the gap.
      const middle = (barBottomOf(layout, gap) + barTopOf(layout, gap + 1)) / 2 - height / 2;
      const tops = [middle, barTopOf(layout, gap + 1) - gapV - height, barBottomOf(layout, gap) + gapV];
      for (const top of tops) spots.push(spot(window.window.end, TAG_GAP, "start", top), spot(window.window.start, -TAG_GAP, "end", top));
    }
    if (desktop && lines.length === 1) {
      spots.push(spot(window.window.start, 0, "start", barBottomOf(layout, window.lower) + LABEL_GAP[layout]));
      spots.push(spot(window.window.start, 0, "start", barTopOf(layout, window.upper) - LABEL_GAP[layout] - LABEL_LINE));
    }
    return spots;
  };
  for (const view of drawnViews) {
    const plan = views[view];
    const wanted: { key: string; text: string; window: PlanWindow; owners: string[] }[] = [];
    if (plan.hatch) {
      const lit = model.threads.find((thread) => thread.lit);
      const minutes = move ? (view === "moved" ? move.minutesAfter : move.minutesBefore) : (lit?.minutes ?? 0);
      const owners = move ? [move.actId, move.partnerId] : lit ? [lit.aId, lit.bId] : [];
      wanted.push({ key: "hatch", text: sharedTag(minutes), window: plan.hatch, owners });
    }
    for (const window of plan.created) wanted.push({ key: window.key, text: createdTag(window.change), window, owners: move ? [move.actId, window.change.actId] : [] });
    for (const item of wanted) {
      const ok = (candidate: Spot) => {
        const box = boxOf(candidate);
        return within(box) && clearOf(view, box, item.owners, TAG_BAR_CLEAR[layout]) && leavesWay(view, box);
      };
      const one = tagSpots(item.window, [item.text]);
      const split = desktop ? twoLines(item.text, 600) : null;
      const spot =
        one.find(ok) ??
        (split ? tagSpots(item.window, split).find(ok) : undefined) ??
        (desktop ? (one.find((candidate) => within(boxOf(candidate)) && clearOf(view, boxOf(candidate), item.owners, TAG_BAR_CLEAR[layout])) ?? one[0]) : undefined);
      if (!spot) continue;
      plan.tags.push({ key: item.key, text: item.text, spot });
      things[view].push({ id: null, box: boxOf(spot), kind: "label" });
      paper[view].push(boxOf(spot));
    }
  }

  // Every other name: whole inside its bar where it fits; then beside its bar or on a plate in a gap by it (on two
  // lines on a desktop when one is too wide); then a prefix of 8 characters or more; then none. The names that do
  // not fit inside their bars are placed together by a search that draws as many of them whole as the drawing can
  // hold (see `placeRest`). A phone names only the sets its detail window shows.
  type Prepared = { view: GraphView; place: PlanBar; paper: Candidate[]; tail: Candidate[] };
  const prepared = new Map<string, Prepared[]>();
  const waiting: DayGraphSet[] = [];
  for (const set of model.sets) {
    if (set.featured) continue;
    const places = drawnViews.flatMap((view) => {
      const place = views[view].bars.find((item) => item.set.actId === set.actId);
      return place && seen(place.span) ? [{ view, place }] : [];
    });
    if (places.length === 0) continue;
    const inside = places.map(({ place }) => insideOf(place, 500));
    if (inside.every((candidate) => candidate?.slot === "a")) {
      places.forEach(({ view }, i) => take(view, set.actId, inside[i] as Candidate));
      continue;
    }
    // The places that hold whatever else is placed: on the drawing, and plainly this set's own.
    const split = desktop ? twoLines(set.name, 500) : null;
    prepared.set(
      set.actId,
      places.map(({ view, place }, i) => {
        const beside = besideOf(place, 500);
        const all = [
          ...(beside ? [beside] : []),
          ...platesOf(view, place, "above", [set.name], 500),
          ...platesOf(view, place, "below", [set.name], 500),
          ...(split ? [...platesOf(view, place, "above", split, 500), ...platesOf(view, place, "below", split, 500)] : []),
        ];
        const paper = all.filter((candidate) => candidate.spot && within(boxOf(candidate.spot)) && ownedBy(view, boxOf(candidate.spot), set.actId, candidate.spot.plate));
        const own = inside[i];
        return { view, place, paper, tail: [...(own ? [own] : []), none] };
      }),
    );
    waiting.push(set);
  }
  /**
   * The names that fit neither inside their bars nor nowhere, placed together. Each set's places (the same place in
   * every view it is drawn in, or when none serves both, each view its own) are tried most preferred first: beside
   * the bar, then a plate on one line, then on two; a place clear of the other names by `ROOMY` px before a tighter
   * one; a place that leaves the lines nearby their room before one that does not. The set with the fewest places
   * still open goes next; a set with none takes its prefix or nothing. Then the search backs out of earlier choices
   * while that can still draw a name the first pass left out (or cut), for at most `SEARCH_STEPS` steps, and keeps
   * the best: fewest names left out, then fewest cut.
   */
  function placeRest(sets: readonly DayGraphSet[]): void {
    type Place = { view: GraphView; candidate: Candidate; box: Box; near: PlanLine[] };
    type Option = { places: Place[]; tails: GraphView[]; cost: number; slot: NameSlot; lines: number };
    type Entry = { set: DayGraphSet; views: GraphView[]; joint: Option[]; own: Map<GraphView, Place[]>; tails: Map<GraphView, Candidate[]> };
    const entries: Entry[] = sets.map((set) => {
      const ready = prepared.get(set.actId) ?? [];
      const bySig = new Map<string, Place[]>();
      const own = new Map<GraphView, Place[]>();
      for (const item of ready) {
        const mine = item.paper.map((candidate) => {
          const box = boxOf(candidate.spot as Spot);
          return { view: item.view, candidate, box, near: touchingLines(item.view, box) };
        });
        own.set(item.view, mine);
        for (const place of mine) bySig.set(place.candidate.sig, [...(bySig.get(place.candidate.sig) ?? []), place]);
      }
      const joint = [...bySig.values()]
        .filter((places) => places.length === ready.length)
        .map((places) => ({ places, tails: [], cost: 0, slot: places[0].candidate.slot, lines: places[0].candidate.spot?.lines.length ?? 1 }));
      return { set, views: ready.map((item) => item.view), joint, own, tails: new Map(ready.map((item) => [item.view, item.tail])) };
    });
    const fits = (entry: Entry, place: Place) =>
      clearOf(place.view, place.box, [entry.set.actId]) && (place.candidate.spot?.kind !== "beside" || besideStops(place.view, place.box)) && wayOn(place.view, place.box, place.near);
    const valid = (entry: Entry, option: Option) => option.places.every((place) => fits(entry, place));
    /** A view's prefix costs 1, nothing at all 1000: a name cut is better than a name left out. */
    const tailCost = (entry: Entry, view: GraphView) => (entry.tails.get(view)?.[0]?.slot === "d" ? 1 : 1000);
    /** When no place serves every view at once: each view its own place (its first four open) or its prefix or nothing. */
    const splits = (entry: Entry): Option[] => {
      if (entry.views.length < 2) return [];
      const [first, second] = entry.views.map((view) => [...(entry.own.get(view) ?? []).filter((place) => fits(entry, place)).slice(0, 4), null]);
      const out: Option[] = [];
      for (const a of first) {
        for (const b of second) {
          if (!a && !b) continue;
          if (a && b && a.candidate.sig === b.candidate.sig) continue;
          const places = [a, b].filter((place): place is Place => place !== null);
          const tails = entry.views.filter((_, i) => [a, b][i] === null);
          const lead = places[0].candidate;
          out.push({ places, tails, cost: tails.reduce((sum, view) => sum + tailCost(entry, view), 0), slot: lead.slot, lines: lead.spot?.lines.length ?? 1 });
        }
      }
      return out;
    };
    const push = (option: Option) => {
      for (const { view, box } of option.places) {
        things[view].push({ id: null, box, kind: "label" });
        paper[view].push(box);
      }
    };
    const pop = (option: Option) => {
      for (const { view } of option.places) {
        things[view].pop();
        paper[view].pop();
      }
    };
    const rankOf = (option: Option) => {
      const room = option.places.every(({ view, box }) => roomy(view, box));
      const base = option.slot === "b" ? (room ? 0 : 1) : room ? (option.lines === 1 ? 2 : 3) : option.lines === 1 ? 4 : 5;
      return base + 6 * Math.max(...option.places.map(({ view, box }) => roomCost(view, box)));
    };
    /** Whether placing `option` can change whether `place` still fits: it comes near it, or narrows a line they share. */
    const touches = (option: Option, place: Place) =>
      option.places.some((other) => other.view === place.view && (near(other.box, place.box, Math.max(clear, gapV) + 1) || other.near.some((line) => place.near.includes(line))));

    let best = Number.POSITIVE_INFINITY;
    let bestPick = new Map<string, Option | null>();
    const pick = new Map<string, Option | null>();
    let steps = 0;
    let open = new Map(entries.map((entry) => [entry.set.actId, entry.joint.filter((option) => valid(entry, option))]));
    const search = (left: readonly Entry[], cost: number): void => {
      steps += 1;
      if (cost >= best) return;
      if (left.length === 0) {
        best = cost;
        bestPick = new Map(pick);
        return;
      }
      let at = 0;
      for (let i = 1; i < left.length && (open.get(left[at].set.actId)?.length ?? 0) > 0; i += 1) {
        if ((open.get(left[i].set.actId)?.length ?? 0) < (open.get(left[at].set.actId)?.length ?? 0)) at = i;
      }
      const entry = left[at];
      const rest = left.filter((_, i) => i !== at);
      const joint = open.get(entry.set.actId) ?? [];
      const choices = (joint.length > 0 ? joint : splits(entry))
        .map((option, i) => ({ option, rank: rankOf(option), i }))
        .sort((a, b) => a.option.cost - b.option.cost || a.rank - b.rank || a.i - b.i);
      for (const { option } of choices) {
        if (steps > SEARCH_STEPS && best < Number.POSITIVE_INFINITY) return;
        if (cost + option.cost >= best) continue;
        push(option);
        const saved = open;
        open = new Map(saved);
        for (const other of rest) {
          const list = saved.get(other.set.actId) ?? [];
          open.set(other.set.actId, list.filter((candidate) => !candidate.places.some((place) => touches(option, place)) || valid(other, candidate)));
        }
        pick.set(entry.set.actId, option);
        search(rest, cost + option.cost);
        pick.delete(entry.set.actId);
        open = saved;
        pop(option);
      }
      if (steps > SEARCH_STEPS && best < Number.POSITIVE_INFINITY) return;
      pick.set(entry.set.actId, null);
      search(rest, cost + entry.views.reduce((sum, view) => sum + tailCost(entry, view), 0));
      pick.delete(entry.set.actId);
    };
    search(entries, 0);

    for (const entry of entries) {
      const option = bestPick.get(entry.set.actId);
      for (const place of option?.places ?? []) take(place.view, entry.set.actId, place.candidate);
      for (const view of option ? option.tails : entry.views) take(view, entry.set.actId, entry.tails.get(view)?.[0] ?? none);
    }
  }
  placeRest(waiting);

  // ---- the lines, last, the chosen clash first and then by rank: each at the point of its window nearest the
  // middle that clears every name on the paper and every name inside the bars it crosses; else clear of the paper's
  // names, beneath those bars. Where its window allows, a line also stands at least `EDGE_IN` px inside every other
  // set's bar it crosses or clear of it (so the bar's rounded corner and edge read whole) and `LINE_APART` px from
  // every line already standing over the same rows (so two never read as one doubled rule), giving up the spacing
  // first and the edges next. A line that runs beside the chosen clash's window also keeps 8px off its edges where
  // its own window allows, so it never reads as the window's outline.
  for (const view of drawnViews) {
    const plan = views[view];
    const rooms = new Map<string, Span>();
    const { hatch } = plan;
    const stood: { x: number; top: number; bottom: number; half: number }[] = [];
    const ordered = [...plan.lines].sort((a, b) => Number(b.thread.lit) - Number(a.thread.lit) || a.thread.rank - b.thread.rank);
    for (const line of ordered) {
      const window = shownWindow(line) ?? line.window;
      const half = line.width / 2;
      const walls = wallsOf(line, paper[view]);
      const crossed = inks[view].filter((item) => item.row > line.upper && item.row < line.lower).map((item) => ({ start: minuteAt(item.box.x0), end: minuteAt(item.box.x1) }));
      const besideHatch = hatch !== null && !line.thread.lit && hatch.top < line.bottom && line.top < hatch.bottom;
      const edges = (reach: number): Span[] =>
        besideHatch && hatch ? [hatch.window.start, hatch.window.end].map((minute) => ({ start: minute - reach / scale, end: minute + reach / scale })) : [];
      // The farthest its middle can stand from both edges of the chosen clash's window inside its own.
      const farthest = (() => {
        if (!besideHatch || !hatch) return 0;
        const lo = x(window.start) + half;
        const hi = x(window.end) - half;
        const a = x(hatch.window.start);
        const b = x(hatch.window.end);
        const off = (p: number) => Math.min(Math.abs(p - a), Math.abs(p - b));
        return Math.floor(Math.max(off(lo), off(hi), (a + b) / 2 >= lo && (a + b) / 2 <= hi ? off((a + b) / 2) : 0) * 100) / 100 - 0.01;
      })();
      const reaches = besideHatch ? [half + HATCH_CLEAR, HATCH_CLEAR, ...(farthest > 0 && farthest < HATCH_CLEAR ? [farthest] : []), 6, 4, 2, 0] : [0];
      const barEdges = edgesOf(view, line);
      const overMarks = [...plan.bars, ...(plan.ghost ? [plan.ghost] : [])];
      const overEdges = barEdgesOf(line, overMarks, half + CASING + BAR_STUB);
      /** Whether a middle at `at` passes over another set's bar in a row the line crosses. */
      const overABar = (at: number) =>
        overMarks.some((item) => item.row > line.upper && item.row < line.lower && item.set.actId !== line.thread.aId && item.set.actId !== line.thread.bId && at > item.span.start && at < item.span.end);
      const neighbours = stood
        .filter((other) => other.top < line.bottom && line.top < other.bottom)
        .map((other) => {
          const apart = Math.max(LINE_APART, other.half + half + 3);
          return { start: minuteAt(other.x - apart), end: minuteAt(other.x + apart) };
        });
      let place: { at: number; room: Span; crosses: number } | null = null;
      let under = false;
      // Drawn over the bars it crosses, it always keeps `BAR_STUB` px of each bar beside its casing; passing beneath
      // them, the bar hides it and only its corner needs keeping, where the names allow.
      ladder: for (const [edgeSoft, apartSoft] of [
        [true, true],
        [true, false],
        [false, true],
        [false, false],
      ]) {
        for (const reach of reaches) {
          const fence = [...walls, ...(apartSoft ? neighbours : []), ...(reach > 0 ? edges(reach) : [])];
          const over = clearPlace(window, half, crossed, scale, [...fence, ...overEdges]);
          if (over && over.crosses === 0) {
            place = over;
            break ladder;
          }
          const beneath = clearPlace(window, half, [], scale, [...fence, ...(edgeSoft ? barEdges : [])]);
          if (beneath) {
            place = beneath;
            under = overABar(beneath.at);
            break ladder;
          }
        }
      }
      if (!place) {
        place = clearPlace(line.window, half, [], scale, []);
        under = place !== null && overABar(place.at);
      }
      if (!place) continue;
      const length = Math.max(EMPTY, line.window.end - line.window.start);
      line.frac = (place.at - line.window.start) / length;
      line.mid = line.window.start + line.frac * length;
      line.under = under;
      rooms.set(line.key, place.room);
      stood.push({ x: x(line.mid), top: line.top, bottom: line.bottom, half });
    }
    const spread = spreadLines(
      plan.lines.map((line) => {
        const room = rooms.get(line.key) ?? { start: line.window.start + line.width / 2 / scale, end: line.window.end - line.width / 2 / scale };
        return { key: line.key, x: x(line.mid), top: line.top, bottom: line.bottom, half: line.width / 2, left: x(room.start) - line.width / 2, right: x(room.end) + line.width / 2 };
      }),
    );
    for (const line of plan.lines) line.off = Math.round((spread.get(line.key) ?? 0) * 100) / 100;
  }

  if (!move) views.moved = views.published;
  return { layout, track, scale, reference, rows, views };
}

/** A label's box at `plan`'s scale (px), for the geometry checks. */
export function spotBox(plan: Pick<LayoutPlan, "track" | "scale">, spot: Spot): Box {
  const at = (spot.anchor - plan.track.start) * plan.scale + spot.dx;
  const x0 = spot.align === "start" ? at : spot.align === "end" ? at - spot.width : at - spot.width / 2;
  return { x0, x1: x0 + spot.width, y0: spot.top, y1: spot.top + spot.height };
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
 * Where a line that follows the mover stands at `p`: the same share of the way across its window at p as it
 * stands at in the views either side (blended in between), so it never leaves the time it stands for.
 */
export function movingLineAt(move: MovePlaces, other: Span, p: number, fracFrom: number, fracTo: number): number {
  const edges = edgesAt(move, other, p);
  return edges.start + (edges.end - edges.start) * lerp(fracFrom, fracTo, p);
}

/**
 * Every keyframe list of a flight from `fromP` to `toP` in one layout, by the `data-anim` key the drawing
 * gives the element:
 * - `mover` (or `mover@0` and `mover@1`, one per row, crossfading, when the stage changes): the mover's layer;
 * - `wash:mover`, `wash:partner`: the chosen clash's wash inside each bar;
 * - `line:{key}` (or `line:{key}@0` / `@1`): each line that touches the mover, its x and whether it is drawn,
 *   and each other line whose place differs between the views;
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
    const atPub = pub.lines.find((line) => line.key === key);
    const atMoved = moved.lines.find((line) => line.key === key);
    const offAt = (p: number) => lerp(atPub?.off ?? atMoved?.off ?? 0, atMoved?.off ?? atPub?.off ?? 0, p);
    const fracPub = atPub?.frac ?? atMoved?.frac ?? 0.5;
    const fracMoved = atMoved?.frac ?? atPub?.frac ?? 0.5;
    const present = (p: number) => windowAt(move, otherSpan, p) !== null;
    rowsFade(`line:${key}`, (p) => ({ transform: lineTransform(track, movingLineAt(move, otherSpan, p, fracPub, fracMoved), offAt(p)) }), present);
    rowsFade(`sline:${key}`, (p) => ({ transform: lineTransform(track, movingLineAt(move, otherSpan, p, 0.5, 0.5), 0) }), present);
  }

  // A line the mover does not touch stays in its window, but where it stands can differ between the views when
  // the names or lines near it do; it slides between the two places with the move.
  for (const line of pub.lines) {
    if (line.moving) continue;
    const there = moved.lines.find((item) => item.key === line.key);
    if (!there || (there.off === line.off && there.mid === line.mid)) continue;
    out[`line:${line.key}`] = build((p) => ({ transform: lineTransform(track, lerp(line.mid, there.mid, p), lerp(line.off, there.off, p)) }));
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
