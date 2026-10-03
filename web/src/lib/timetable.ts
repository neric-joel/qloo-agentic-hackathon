/**
 * Layout math for the timetable: time to pixels, column frames, clash links between concurrent
 * sets, and arrow-key movement between sets. Pure functions, so they are unit tested.
 *
 * Times are minutes from the start of the festival day; values past 1440 are after midnight.
 */

export const MINUTES_PER_DAY = 1440;

export type TimeRange = { start: number; end: number };

/** "17:15". After-midnight times wrap ("25:30" is shown as "01:30"). */
export function formatClock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** "17:15–18:00" with an en dash. */
export function formatRange(range: TimeRange): string {
  return `${formatClock(range.start)}–${formatClock(range.end)}`;
}

/** The span to draw: from the earliest start to the latest end, widened to whole `step`s. */
export function timeDomain(ranges: readonly TimeRange[], step = 60): TimeRange {
  if (ranges.length === 0) return { start: 0, end: step };
  const first = Math.min(...ranges.map((r) => r.start));
  const last = Math.max(...ranges.map((r) => r.end));
  const start = Math.floor(first / step) * step;
  const end = Math.max(Math.ceil(last / step) * step, start + step);
  return { start, end };
}

export type TimeScale = {
  domain: TimeRange;
  pxPerMinute: number;
  /** Pixels from the top of the grid. */
  y: (minute: number) => number;
  height: number;
};

export function timeScale(domain: TimeRange, pxPerMinute: number): TimeScale {
  return {
    domain,
    pxPerMinute,
    y: (minute) => (minute - domain.start) * pxPerMinute,
    height: (domain.end - domain.start) * pxPerMinute,
  };
}

/** Minutes at every `step` inside the domain, both ends included. */
export function timeTicks(domain: TimeRange, step = 60): number[] {
  const ticks: number[] = [];
  const first = Math.ceil(domain.start / step) * step;
  for (let minute = first; minute <= domain.end; minute += step) ticks.push(minute);
  return ticks;
}

/** The minutes two sets share, or null when they do not overlap. */
export function overlapWindow(a: TimeRange, b: TimeRange): TimeRange | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

export type BlockDensity = "full" | "compact" | "tiny";

/** How much a set block of this height can show: name and details, name and one line, or name only. */
export function blockDensity(heightPx: number): BlockDensity {
  if (heightPx >= 70) return "full";
  if (heightPx >= 44) return "compact";
  return "tiny";
}

export type ColumnFrame = { left: number; width: number };

/** Equal-width columns across `width` pixels with `gap` pixels between them. */
export function columnFrames(width: number, count: number, gap: number): ColumnFrame[] {
  if (count <= 0) return [];
  const columnWidth = Math.max(0, (width - gap * (count - 1)) / count);
  return Array.from({ length: count }, (_, index) => ({
    left: index * (columnWidth + gap),
    width: columnWidth,
  }));
}

// ---------------------------------------------------------------------------
// Clash links
// ---------------------------------------------------------------------------

export type LinkInput = {
  id: string;
  /** Column index of each set. */
  colA: number;
  colB: number;
  /** The minutes the two sets share. */
  window: TimeRange;
  /** 0 to 1, relative to the costliest link shown. Drives thickness and strength. */
  weight: number;
};

export type LinkLayout = {
  id: string;
  /** SVG path data. */
  path: string;
  x1: number;
  x2: number;
  /** The height the link leaves both sets at. */
  y: number;
  /**
   * Where the rank badge sits: in the gutter beside the left-hand set, so it never covers the text
   * of a set the link passes behind.
   */
  badge: { x: number; y: number };
  strokeWidth: number;
  opacity: number;
};

export type LinkOptions = {
  /** Badges closer than this (centre to centre, on both axes) are moved apart. */
  badgeSize?: number;
  minStroke?: number;
  maxStroke?: number;
  /** How far a link rises per stage it jumps over. */
  bulgePerColumn?: number;
  maxBulge?: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Height of the curve's rise: flat between neighbours, rising more for each stage it jumps over. */
export function linkBulge(columnsApart: number, perColumn = 18, max = 64): number {
  if (columnsApart <= 1) return 0;
  return Math.min(max, perColumn * (columnsApart - 1) + 10);
}

function linkPath(x1: number, x2: number, y: number, bulge: number): string {
  const r = (value: number) => Math.round(value * 10) / 10;
  if (bulge === 0) return `M ${r(x1)} ${r(y)} L ${r(x2)} ${r(y)}`;
  // A quadratic curve peaks at half its control point's height.
  const xm = (x1 + x2) / 2;
  return `M ${r(x1)} ${r(y)} Q ${r(xm)} ${r(y - 2 * bulge)} ${r(x2)} ${r(y)}`;
}

/**
 * Places a link for each clash: from the facing edges of the two sets, at the middle of the minutes
 * they share, rising over any stage in between. Links are placed costliest first; when a badge would
 * land on one already placed, the link slides up or down inside its shared window (or just past
 * it, if the window is too short).
 */
export function layoutLinks(
  links: readonly LinkInput[],
  columns: readonly ColumnFrame[],
  scale: Pick<TimeScale, "y">,
  options: LinkOptions = {},
): LinkLayout[] {
  const {
    badgeSize = 26,
    minStroke = 2,
    maxStroke = 7,
    bulgePerColumn = 18,
    maxBulge = 64,
  } = options;
  const placed: { x: number; y: number }[] = [];
  const order = [...links].sort((p, q) => q.weight - p.weight || p.id.localeCompare(q.id));
  const result = new Map<string, LinkLayout>();

  for (const link of order) {
    const left = Math.min(link.colA, link.colB);
    const right = Math.max(link.colA, link.colB);
    const leftFrame = columns[left];
    const rightFrame = columns[right];
    if (!leftFrame || !rightFrame || left === right) continue;

    const x1 = leftFrame.left + leftFrame.width;
    const x2 = rightFrame.left;
    const gutter = (columns[left + 1]?.left ?? x2) - x1;
    const bulge = linkBulge(right - left, bulgePerColumn, maxBulge);
    const top = scale.y(link.window.start);
    const bottom = scale.y(link.window.end);
    const centre = (top + bottom) / 2;
    const bx = x1 + gutter / 2;

    const collides = (y: number) =>
      placed.some((other) => Math.abs(other.x - bx) < badgeSize && Math.abs(other.y - y) < badgeSize);

    // Try the centre first, then alternate below and above, preferring spots inside the window.
    const candidates = [centre];
    for (let step = 1; step <= 6; step += 1) {
      candidates.push(centre + step * badgeSize, centre - step * badgeSize);
    }
    const pad = Math.min(badgeSize / 2, (bottom - top) / 2);
    const inside = candidates.filter((y) => y >= top + pad && y <= bottom - pad);
    const outside = candidates.filter((y) => !inside.includes(y));
    const y = [...inside, ...outside].find((candidate) => !collides(candidate)) ?? centre;

    placed.push({ x: bx, y });
    const weight = clamp01(link.weight);
    result.set(link.id, {
      id: link.id,
      path: linkPath(x1, x2, y, bulge),
      x1,
      x2,
      y,
      badge: { x: bx, y },
      strokeWidth: minStroke + (maxStroke - minStroke) * weight,
      opacity: 0.45 + 0.55 * weight,
    });
  }

  // Keep the caller's order.
  return links.flatMap((link) => result.get(link.id) ?? []);
}

// ---------------------------------------------------------------------------
// Keyboard movement
// ---------------------------------------------------------------------------

export type NavItem = { id: string; col: number; start: number; end: number };
export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

export const NAV_KEYS: readonly NavKey[] = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
];

export function isNavKey(key: string): key is NavKey {
  return (NAV_KEYS as readonly string[]).includes(key);
}

/** How far a set is in time from a moment: zero if it is playing then. */
function timeDistance(item: NavItem, minute: number): number {
  if (minute < item.start) return item.start - minute;
  if (minute >= item.end) return minute - item.end + 1;
  return 0;
}

/**
 * The set to move to from `currentId`. Up and down step through the same stage, Home and End jump
 * to its first and last set, and left and right go to the nearest stage that has sets, picking the
 * set playing closest to the middle of the current one. Returns null at an edge.
 */
export function nextNavItem(items: readonly NavItem[], currentId: string, key: NavKey): string | null {
  const current = items.find((item) => item.id === currentId);
  if (!current) return items[0]?.id ?? null;
  const byStart = (p: NavItem, q: NavItem) => p.start - q.start || p.id.localeCompare(q.id);
  const column = items.filter((item) => item.col === current.col).sort(byStart);
  const index = column.findIndex((item) => item.id === current.id);

  switch (key) {
    case "ArrowUp":
      return column[index - 1]?.id ?? null;
    case "ArrowDown":
      return column[index + 1]?.id ?? null;
    case "Home":
      return column[0].id === current.id ? null : column[0].id;
    case "End":
      return column[column.length - 1].id === current.id ? null : column[column.length - 1].id;
    case "ArrowLeft":
    case "ArrowRight": {
      const direction = key === "ArrowRight" ? 1 : -1;
      const columns = [...new Set(items.map((item) => item.col))]
        .filter((col) => (col - current.col) * direction > 0)
        .sort((p, q) => (p - q) * direction);
      const target = columns[0];
      if (target === undefined) return null;
      const middle = (current.start + current.end) / 2;
      const candidates = items.filter((item) => item.col === target).sort(byStart);
      let best = candidates[0];
      for (const item of candidates) {
        if (timeDistance(item, middle) < timeDistance(best, middle)) best = item;
      }
      return best?.id ?? null;
    }
  }
}
