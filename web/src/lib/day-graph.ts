/**
 * The day drawn as one picture: every set of a festival day on its stage row, the day's ranked clashes as
 * lines between the two sets of each, and the decision's one move with everything it changes. This module
 * builds everything the drawing draws and every sentence it prints (its title, key, notes, side-effect line
 * and settled announcement), so the server HTML and the interactive page draw the same frame and a note
 * never disagrees with the line it describes. Minutes and windows come from the published timetable; the
 * taste rank is the report's, printed as the rest of the site prints it. Pure functions, so they are unit
 * tested; none throws.
 */

import { buildSetViews, formatOverlap, topClashes } from "./clashes";
import { NO_OTHER_LONGER, type Decision } from "./decision";
import { pluralize } from "./format";
import { clockMinutes } from "./moves";
import type { PairClash, Preset } from "./preset";
import { formatClock, formatRange, overlapWindow, timeDomain } from "./timetable";

export type GraphView = "published" | "moved";

/** Minutes from 00:00 of the festival day. */
export type Span = { start: number; end: number };

export type DayGraphSet = {
  actId: string;
  name: string;
  stageIndex: number;
  start: number;
  end: number;
  locked: boolean;
  unscored: boolean;
  /** The mover, its partner and every set whose overlap grows: their names sit whole above the bar. */
  featured: boolean;
};

/** A line's overlap with the move; `window` is null when the move ends it. */
export type MovedOverlap = { minutes: number; window: Span | null };

export type DayGraphThread = {
  /** The report's rank; a line the report does not rank is numbered on after the last ranked one. */
  rank: number;
  /**
   * False for an overlap of the mover that the side-effect line names but the report does not rank: it is drawn
   * so the picture shows what the words say, with no taste rank (`taste` is 0 and means nothing).
   */
  ranked: boolean;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aGenre: string | null;
  bGenre: string | null;
  minutes: number;
  window: Span;
  /** Taste overlap, a rank out of 100 on this bill, as `formatOverlap` prints it. */
  taste: number;
  hidden: boolean;
  /** The decision's clash. */
  lit: boolean;
  /** Null unless the mover is one end of the line. */
  moved: MovedOverlap | null;
};

export type OverlapChange = {
  actId: string;
  name: string;
  stageIndex: number;
  before: number;
  after: number;
  beforeWindow: Span | null;
  afterWindow: Span | null;
};

export type DayGraphMove = {
  actId: string;
  name: string;
  partnerId: string;
  partnerName: string;
  from: Span & { stageIndex: number };
  to: Span & { stageIndex: number };
  stageChanged: boolean;
  minutesBefore: number;
  minutesAfter: number;
  sharedBefore: Span;
  sharedAfter: Span | null;
  /** Every other set whose overlap with the mover gets longer, the largest change first, then by name. */
  grows: OverlapChange[];
  /** Every other set whose overlap with the mover gets shorter or ends, ordered the same way. */
  shrinks: OverlapChange[];
  /** "Sprints 15 min later", or "Sprints to The Park at 15:00" when the stage changes. */
  label: string;
};

export type DayGraphModel = {
  presetId: string;
  day: number;
  title: string;
  festivalName: string;
  dayName: string | null;
  synthetic: boolean;
  builtAt: string | null;
  stages: { id: string; name: string }[];
  domain: Span;
  sets: DayGraphSet[];
  threads: DayGraphThread[];
  overlaps: { total: number; scored: number; unscored: number };
  litRank: number | null;
  tasteOfLit: number | null;
  move: DayGraphMove | null;
  /** The phone's detail window: the move and what it touches, at least 150 minutes, on the half hour. */
  focus: Span;
  /**
   * The (at most three) stage rows a phone draws, in stage order: the mover's two stages, the partner's, those
   * of the overlaps that grow, then that of a shrinking overlap the side-effect line names, padded.
   */
  phoneRows: number[];
};

export type DrawingLayout = "desktop" | "phone" | "short";

export const LAYOUT = {
  desktop: { axis: 22, row: 64, bar: 26 },
  phone: { overview: 24, gap: 8, axis: 14, row: 42, bar: 24 },
  short: { axis: 14, row: 42, bar: 24 },
} as const;

export const MOVE_MS = 450;
export const PAN_MS = 300;
export const TAG_MS = 120;
export const EASE_MOVE = "cubic-bezier(0.65, 0, 0.35, 1)";
export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

/** How many of the day's ranked clashes are drawn: the list the board draws. */
const RANKED_LINES = 15;
/** How many growing overlaps the side-effect line names before it counts the rest. */
const NAMED_GROWS = 2;
const PHONE_ROWS = 3;
const FOCUS_PAD = 15;
const FOCUS_STEP = 30;
const FOCUS_MIN = 150;

/** The drawing's height in px for one layout, so the page reserves it before anything draws. */
export function drawingHeight(model: DayGraphModel, layout: DrawingLayout): number {
  if (layout === "desktop") return LAYOUT.desktop.axis + LAYOUT.desktop.row * model.stages.length;
  const rows = model.phoneRows.length;
  if (layout === "phone") return LAYOUT.phone.overview + LAYOUT.phone.gap + LAYOUT.phone.axis + LAYOUT.phone.row * rows;
  return LAYOUT.short.axis + LAYOUT.short.row * rows;
}

/** A line's stroke in px: 1.25 at taste rank 0 to 4.75 at 100, linear. */
export function threadWidth(taste: number): number {
  const rank = Math.min(100, Math.max(0, Number.isFinite(taste) ? taste : 0));
  return 1.25 + (3.5 * rank) / 100;
}

function minutesOf(window: Span | null): number {
  return window ? window.end - window.start : 0;
}

function samePair(clash: Pick<PairClash, "a" | "b">, ids: readonly [string, string]): boolean {
  const [a, b] = ids;
  return (clash.a.act_id === a && clash.b.act_id === b) || (clash.a.act_id === b && clash.b.act_id === a);
}

/** "Sprints 15 min later", "Sprints 15 min earlier", or "Sprints to The Park at 15:00". */
function moveLabel(name: string, from: DayGraphMove["from"], to: DayGraphMove["to"], stageChanged: boolean, stage: string): string {
  const shift = to.start - from.start;
  if (stageChanged || from.stageIndex !== to.stageIndex || shift === 0) return `${name} to ${stage} at ${formatClock(to.start)}`;
  return `${name} ${Math.abs(shift)} min ${shift > 0 ? "later" : "earlier"}`;
}

/** Largest change first, then by name, as the decision card's side-effects line orders them. */
function bySize(p: OverlapChange, q: OverlapChange): number {
  return Math.abs(q.after - q.before) - Math.abs(p.after - p.before) || p.name.localeCompare(q.name);
}

/**
 * The mover's published overlaps that `sideEffectText` names by set: the growing ones it names that already
 * existed (a new one has no published line; it is drawn as a new window), and the shrinking one when it is
 * the only one. Several shrinking overlaps are counted there, not named.
 */
function namedChanges(move: DayGraphMove): OverlapChange[] {
  const grows = move.grows.slice(0, NAMED_GROWS).filter((item) => item.before > 0);
  return [...grows, ...(move.shrinks.length === 1 ? move.shrinks : [])];
}

/** What the move does to a line that touches the mover: "ends", "shortens" or "lengthens". */
function changeVerb(thread: DayGraphThread): string {
  const after = thread.moved?.minutes ?? thread.minutes;
  if (after === 0) return "ends";
  return after < thread.minutes ? "shortens" : "lengthens";
}

/**
 * From 15 minutes before the first start to 15 minutes after the last end of the move (both places), its
 * partner and every set whose overlap grows, out to the half hour; then widened by half hours, at the start
 * and the end in turn, until it is 150 minutes long.
 */
function focusOf(spans: readonly Span[]): Span {
  let start = Math.floor((Math.min(...spans.map((span) => span.start)) - FOCUS_PAD) / FOCUS_STEP) * FOCUS_STEP;
  let end = Math.ceil((Math.max(...spans.map((span) => span.end)) + FOCUS_PAD) / FOCUS_STEP) * FOCUS_STEP;
  let atStart = true;
  while (end - start < FOCUS_MIN) {
    if (atStart) start -= FOCUS_STEP;
    else end += FOCUS_STEP;
    atStart = !atStart;
  }
  return { start, end };
}

/**
 * The phone's rows: the `priority` stages first (deduplicated, at most three), padded from the stages that
 * hold the most drawn lines inside `focus` (earlier stage on a tie), returned in stage order.
 */
function phoneRowsOf(
  stageCount: number,
  threads: readonly DayGraphThread[],
  rowOf: ReadonlyMap<string, number>,
  focus: Span,
  priority: readonly number[],
): number[] {
  const rows: number[] = [];
  for (const row of priority) if (!rows.includes(row) && rows.length < PHONE_ROWS) rows.push(row);
  const counts = Array.from({ length: stageCount }, () => 0);
  for (const thread of threads) {
    if (!(thread.window.start < focus.end && thread.window.end > focus.start)) continue;
    const ends = new Set([rowOf.get(thread.aId), rowOf.get(thread.bId)]);
    for (const row of ends) if (row !== undefined) counts[row] += 1;
  }
  const rest = counts
    .map((count, row) => ({ count, row }))
    .filter(({ row }) => !rows.includes(row))
    .sort((p, q) => q.count - p.count || p.row - q.row);
  for (const { row } of rest) {
    if (rows.length >= Math.min(PHONE_ROWS, stageCount)) break;
    rows.push(row);
  }
  return rows.sort((p, q) => p - q);
}

/**
 * The drawing of one festival day: its sets (`buildSetViews`), the day's ranked clashes in rank order (at
 * most 15, the list the board draws) plus the decision's clash and the mover's overlaps the side-effect line
 * names when they are not among them, the overlaps the report counts, and the decision's move with every
 * overlap it starts, lengthens, shortens or ends, from the published times. A decision for another day is
 * ignored. Null when the day has no sets.
 */
export function buildDayGraph(preset: Preset, decision: Decision | null, day: number): DayGraphModel | null {
  try {
    const views = buildSetViews(preset, day);
    if (views.length === 0) return null;
    const { festival, report } = preset;
    const viewOf = new Map(views.map((view) => [view.id, view]));
    const chosen = decision && decision.day === day ? decision : null;
    const pair: readonly [string, string] | null =
      chosen?.clash && viewOf.has(chosen.clash.aId) && viewOf.has(chosen.clash.bId) ? [chosen.clash.aId, chosen.clash.bId] : null;
    const decided = pair && chosen?.move && pair.includes(chosen.move.actId) && chosen.move.day === day ? chosen.move : null;
    const targetCol = decided ? festival.stages.findIndex((stage) => stage.id === decided.stageId) : -1;

    // The stages with a set on the day (and the move's stage), in festival order.
    const used = new Set(views.map((view) => view.col));
    if (targetCol >= 0) used.add(targetCol);
    const cols = festival.stages.map((_, col) => col).filter((col) => used.has(col));
    const indexOfCol = new Map(cols.map((col, index) => [col, index]));
    const stages = cols.map((col) => ({ id: festival.stages[col].id, name: festival.stages[col].name }));
    const rowOf = new Map(views.map((view) => [view.id, indexOfCol.get(view.col) ?? 0]));

    let move: DayGraphMove | null = null;
    const start = decided ? clockMinutes(decided.start) : null;
    const end = decided ? clockMinutes(decided.end) : null;
    if (decided && pair && targetCol >= 0 && start !== null && end !== null) {
      const mover = viewOf.get(decided.actId);
      const partnerId = pair[0] === decided.actId ? pair[1] : pair[0];
      const partner = viewOf.get(partnerId);
      if (mover && partner) {
        const from = { start: mover.slot.start, end: mover.slot.end, stageIndex: rowOf.get(mover.id) ?? 0 };
        const to = { start, end: end > start ? end : end + 1440, stageIndex: indexOfCol.get(targetCol) ?? 0 };
        const sharedBefore = overlapWindow(from, partner.slot);
        if (sharedBefore) {
          const sharedAfter = overlapWindow(to, partner.slot);
          const changes = views
            .filter((view) => view.id !== mover.id && view.id !== partnerId)
            .map((view): OverlapChange => {
              const beforeWindow = overlapWindow(from, view.slot);
              const afterWindow = overlapWindow(to, view.slot);
              return {
                actId: view.id,
                name: view.act.name,
                stageIndex: rowOf.get(view.id) ?? 0,
                before: minutesOf(beforeWindow),
                after: minutesOf(afterWindow),
                beforeWindow,
                afterWindow,
              };
            });
          move = {
            actId: mover.id,
            name: mover.act.name,
            partnerId,
            partnerName: partner.act.name,
            from,
            to,
            stageChanged: decided.stageChanged,
            minutesBefore: minutesOf(sharedBefore),
            minutesAfter: minutesOf(sharedAfter),
            sharedBefore,
            sharedAfter,
            grows: changes.filter((item) => item.after > item.before).sort(bySize),
            shrinks: changes.filter((item) => item.after < item.before).sort(bySize),
            label: moveLabel(mover.act.name, from, to, decided.stageChanged, stages[to.stageIndex]?.name ?? decided.stage),
          };
        }
      }
    }

    // The ranked lines; then, when the board's list does not hold them, the decision's clash and each overlap
    // of the mover that the side-effect line names, from the report when it ranks the pair. A named overlap
    // the report does not rank is drawn unranked, after them, so the words never name an overlap the picture
    // leaves out.
    const ranked = topClashes(report.clashes, day, RANKED_LINES);
    const everyRanked = topClashes(report.clashes, day, Number.POSITIVE_INFINITY);
    const extras: PairClash[] = [];
    const unranked: OverlapChange[] = [];
    const drawn = (ids: readonly [string, string]) => [...ranked, ...extras].some((clash) => samePair(clash, ids));
    if (pair && !drawn(pair)) {
      const extra = everyRanked.find((clash) => samePair(clash, pair));
      if (extra) extras.push(extra);
    }
    if (move) {
      for (const change of namedChanges(move)) {
        const ids = [move.actId, change.actId] as const;
        if (drawn(ids)) continue;
        const known = everyRanked.find((clash) => samePair(clash, ids));
        if (known) extras.push(known);
        else unranked.push(change);
      }
    }
    const lines = [...ranked, ...extras.sort((p, q) => p.rank - q.rank)];
    const threads = lines.flatMap((clash): DayGraphThread[] => {
      const a = viewOf.get(clash.a.act_id);
      const b = viewOf.get(clash.b.act_id);
      const window = a && b ? overlapWindow(a.slot, b.slot) : null;
      if (!a || !b || !window) return [];
      let moved: MovedOverlap | null = null;
      if (move && (a.id === move.actId || b.id === move.actId)) {
        const after = overlapWindow(move.to, (a.id === move.actId ? b : a).slot);
        moved = { minutes: minutesOf(after), window: after };
      }
      return [
        {
          rank: clash.rank,
          ranked: true,
          aId: a.id,
          bId: b.id,
          aName: clash.a.name,
          bName: clash.b.name,
          aGenre: clash.a.genre?.trim() || null,
          bGenre: clash.b.genre?.trim() || null,
          minutes: minutesOf(window),
          window,
          taste: Number(formatOverlap(clash.audience_overlap)),
          hidden: clash.label === "hidden",
          lit: pair !== null && samePair(clash, pair),
          moved,
        },
      ];
    });
    let next = threads.reduce((last, thread) => Math.max(last, thread.rank), 0);
    for (const change of unranked) {
      const mover = move ? viewOf.get(move.actId) : undefined;
      const other = viewOf.get(change.actId);
      if (!move || !mover || !other || !change.beforeWindow) continue;
      next += 1;
      threads.push({
        rank: next,
        ranked: false,
        aId: mover.id,
        bId: other.id,
        aName: mover.act.name,
        bName: other.act.name,
        aGenre: mover.act.genre?.trim() || null,
        bGenre: other.act.genre?.trim() || null,
        minutes: change.before,
        window: change.beforeWindow,
        taste: 0,
        hidden: false,
        lit: false,
        moved: { minutes: change.after, window: change.afterWindow },
      });
    }
    const lit = threads.find((thread) => thread.lit) ?? null;

    const featured = new Set<string>(move ? [move.actId, move.partnerId, ...move.grows.map((item) => item.actId)] : (pair ?? []));
    const sets = views.map((view): DayGraphSet => ({
      actId: view.id,
      name: view.act.name,
      stageIndex: rowOf.get(view.id) ?? 0,
      start: view.slot.start,
      end: view.slot.end,
      locked: view.slot.locked,
      unscored: view.coverage === "none",
      featured: featured.has(view.id),
    }));

    const domain = timeDomain([...views.map((view) => view.slot), ...(move ? [move.to] : [])], 15);
    let focus: Span = { ...domain };
    let priority: number[] = [];
    if (move) {
      const slotOf = (id: string) => viewOf.get(id)?.slot;
      const touched = [move.partnerId, ...move.grows.map((item) => item.actId)].flatMap((id) => slotOf(id) ?? []);
      focus = focusOf([move.from, move.to, ...touched]);
      // Then the stage of a shrinking overlap the side-effect line names, so a phone draws its line too (its
      // window lies inside the mover's published slot, so inside the focus already).
      const named = namedChanges(move).filter((item) => item.after < item.before);
      priority = [
        move.from.stageIndex,
        move.to.stageIndex,
        rowOf.get(move.partnerId) ?? 0,
        ...move.grows.map((item) => item.stageIndex),
        ...named.map((item) => item.stageIndex),
      ];
    } else if (pair) {
      priority = pair.map((id) => rowOf.get(id) ?? 0);
    }

    const comma = preset.title.indexOf(", ");
    const { scored_concurrent_pairs: scored, unscored_concurrent_pairs: unscored } = report.metrics;
    return {
      presetId: preset.id,
      day,
      title: preset.title,
      festivalName: comma >= 0 ? preset.title.slice(0, comma) : preset.title,
      dayName: comma >= 0 ? preset.title.slice(comma + 2) || null : null,
      synthetic: preset.synthetic === true,
      builtAt: preset.built_at,
      stages,
      domain,
      sets,
      threads,
      overlaps: { total: scored + unscored, scored, unscored },
      litRank: lit?.rank ?? null,
      tasteOfLit: lit?.taste ?? null,
      move,
      focus,
      phoneRows: phoneRowsOf(stages.length, threads, rowOf, focus, priority),
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------ the words

/**
 * What else the move changes, every clause naming the overlap: up to two growing overlaps ("New 15 min
 * overlap with Joy Crookes." or "Lengthens the overlap with X from 10 to 25 min.") and a count of the rest,
 * then the shrinking ones (one named; several counted, with their step when they share one and none ends),
 * then `NO_OTHER_LONGER` when nothing grows.
 */
export function sideEffectText(move: DayGraphMove): string {
  const parts = move.grows
    .slice(0, 2)
    .map((item) =>
      item.before === 0
        ? `New ${item.after} min overlap with ${item.name}.`
        : `Lengthens the overlap with ${item.name} from ${item.before} to ${item.after} min.`,
    );
  const more = move.grows.length - 2;
  if (more > 0) parts.push(more === 1 ? "1 more overlap gets longer." : `${more} more overlaps get longer.`);
  const { shrinks } = move;
  if (shrinks.length === 1) {
    const [only] = shrinks;
    parts.push(
      only.after === 0
        ? `Ends the ${only.before} min overlap with ${only.name}.`
        : `Shortens the overlap with ${only.name} from ${only.before} to ${only.after} min.`,
    );
  } else if (shrinks.length > 1) {
    const step = shrinks[0].before - shrinks[0].after;
    const oneStep = shrinks.every((item) => item.after > 0 && item.before - item.after === step);
    parts.push(oneStep ? `Shortens ${shrinks.length} other overlaps by ${step} min.` : `Shortens or ends ${shrinks.length} other overlaps.`);
  }
  if (move.grows.length === 0) parts.push(NO_OTHER_LONGER);
  return parts.join(" ");
}

/** "as published", or "before the move" on the invented day, whose timetable was never published. */
function asPublished(model: DayGraphModel): string {
  return model.synthetic ? "before the move" : "as published";
}

/** How many of the drawn lines are the board's ranked list (the rest are the chosen clash and the move's). */
function rankedLines(model: DayGraphModel): number {
  return model.threads.filter((thread) => thread.ranked && thread.rank <= RANKED_LINES).length;
}

/**
 * A line's note. Its rank is the published one; in the moved view a line that touches the mover gives its
 * minutes as published and with the move ("none with the move" when the move ends the overlap). A line the
 * report does not rank says so and what the move does to it, and prints no taste rank.
 */
export function threadNote(model: DayGraphModel, thread: DayGraphThread, view: GraphView): string {
  const shown = view === "moved" && model.move ? thread.moved : null;
  const minutes =
    shown === null
      ? `${thread.minutes} min shared (${formatRange(thread.window)})`
      : shown.window
        ? `${thread.minutes} min shared ${asPublished(model)}, ${shown.minutes} with the move (${formatRange(shown.window)})`
        : `${thread.minutes} min shared ${asPublished(model)}, none with the move`;
  const genres = thread.aGenre && thread.bGenre ? ` Main genres: ${thread.aGenre}, ${thread.bGenre}.` : "";
  const clashes = `${pluralize(model.overlaps.scored, "clash", "clashes")} ${asPublished(model)}`;
  if (!thread.ranked) {
    return (
      `Outside the ${rankedLines(model)} costliest of ${clashes}: ${thread.aName} × ${thread.bName}, ${minutes}. ` +
      `The move ${changeVerb(thread)} this overlap, which has no ${model.synthetic ? "invented " : ""}taste overlap rank here.${genres}`
    );
  }
  const taste = model.synthetic
    ? `Invented taste overlap rank ${thread.taste} of 100 on this invented bill (an invented rank, not attendance).`
    : `Taste overlap rank ${thread.taste} of 100 on this bill (a rank, not attendance).`;
  return `#${thread.rank} of ${clashes}: ${thread.aName} × ${thread.bName}, ${minutes}. ${taste}${genres}`;
}

/** A set's note: where it plays in this view, its lock, a missing signal, and the mover's two places. */
export function setNote(model: DayGraphModel, set: DayGraphSet, view: GraphView): string {
  const move = view === "moved" && model.move?.actId === set.actId ? model.move : null;
  const place = move ? move.to : set;
  const parts = [`${set.name}, ${model.stages[place.stageIndex]?.name ?? ""}, ${formatRange(place)}.`];
  if (set.locked) parts.push("Locked: this set stays put.");
  if (set.unscored) {
    parts.push(model.synthetic ? "No taste signal: left out, not scored as zero." : "No Qloo signal: left out, not scored as zero.");
  }
  if (move) parts.push(`${model.synthetic ? "Before the move" : "Published"} ${formatRange(move.from)}; tested ${formatRange(move.to)}.`);
  return parts.join(" ");
}

/** Said once, politely, when the drawing settles on a view. */
export function settledAnnouncement(model: DayGraphModel, view: GraphView): string {
  const { move } = model;
  if (view === "moved" && move) {
    return `Drawn with ${move.label}: ${move.minutesBefore} to ${move.minutesAfter} min shared with ${move.partnerName}. ${sideEffectText(move)}`;
  }
  const lead = model.synthetic ? "Drawn without the move" : "Drawn as published";
  if (move) return `${lead}: ${move.name} and ${move.partnerName} share ${move.minutesBefore} min.`;
  const lit = model.threads.find((thread) => thread.lit);
  return lit ? `${lead}: ${lit.aName} and ${lit.bName} share ${lit.minutes} min.` : `${lead}.`;
}

/**
 * The key under the drawing: what the lines are (the ranked list, plus the chosen clash and the move's named
 * overlaps when the list does not hold them), what their width means and, with a move, what dashed means.
 */
export function keyLine(model: DayGraphModel): string {
  const chosen = model.threads.some((thread) => thread.lit && thread.rank > RANKED_LINES) ? ", plus the chosen clash" : "";
  const moves = model.threads.filter((thread) => !thread.lit && (!thread.ranked || thread.rank > RANKED_LINES));
  const unranked = moves.filter((thread) => !thread.ranked).length;
  let plus = chosen;
  if (moves.length > 0) {
    plus += moves.length === 1 ? `, plus the overlap the move ${changeVerb(moves[0])}` : `, plus ${moves.length} overlaps the move changes`;
    if (unranked > 0) plus += unranked === moves.length ? " (not ranked)" : ` (${unranked} not ranked)`;
  }
  const { scored, total } = model.overlaps;
  const lines =
    `Lines: the ${rankedLines(model)} costliest of ${pluralize(scored, "scored clash", "scored clashes")} (${total} in all)${plus}; ` +
    `thicker means a higher ${model.synthetic ? "invented taste overlap rank" : "taste overlap rank"}.`;
  if (!model.move) return lines;
  return `${lines} ${model.synthetic ? "Dashed: slot before the move or new overlap." : "Dashed: published slot or new overlap."}`;
}

/** The drawing's accessible name: the day, the view it shows and its size. */
export function drawingTitle(model: DayGraphModel, view: GraphView): string {
  const size = `${pluralize(model.sets.length, "set")} on ${pluralize(model.stages.length, "stage")}`;
  const { move } = model;
  if (model.synthetic) {
    if (!move) return `${model.title}, invented timetable: ${size}`;
    return view === "moved"
      ? `${model.title}, invented timetable, drawn with ${move.label}: ${size}`
      : `${model.title}, invented timetable, without the move: ${size}`;
  }
  return move && view === "moved" ? `${model.title}, drawn with ${move.label}: ${size}` : `${model.title}, as published: ${size}`;
}
