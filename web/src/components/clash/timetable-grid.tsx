"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

import { noSignalLabel, weakSignalLabel } from "@/lib/credit";
import { clashKey, formatDraw, formatShare, LABEL_META, partnerOf, type SetView } from "@/lib/clashes";
import { lockLabel } from "@/lib/locks";
import type { PairClash, Stage } from "@/lib/preset";
import type { RulePreview } from "@/lib/rule-fix";
import type { GhostSlot, PlanPreview } from "@/lib/stack";
import {
  columnFrames,
  columnGap,
  formatClock,
  formatRange,
  isNavKey,
  layoutLinks,
  nextNavItem,
  overlapWindow,
  timeDomain,
  timeScale,
  timeTicks,
  type LinkInput,
  type TimeRange,
} from "@/lib/timetable";

import { ClashDisc, clashMarkLabel } from "./marks";
import { usePublishCueTiles } from "./timetable-legend";

const AXIS_WIDTH = 52;
/**
 * A tile's rows, in px. A name of up to 22 characters is 14px semibold on a 17.5px line (leading-tight);
 * a longer one is 13px semibold on a 16.25px line. A name the measured board wraps to two lines or more
 * is set on a 1.2 line instead (16.8px, or 15.6px for a long name), so its lines read as one name. The
 * time is 13px tabular figures on a 16px line, each line of the genre 13px on a 15px line, and the signal
 * label at the foot (no signal, or a weak one) 12.5px on a 16px line: "No Qloo signal" runs 86px at 13px,
 * wider than a phone column's 85.6px inside its padding, and the label is never cut. A roomy tile has 8px
 * of padding top and bottom (4px in a short one), plus 2px for its 1px edge, and 4px over its foot.
 */
const NAME_LINE = 17.5;
const LONG_NAME_LINE = 16.25;
const WRAPPED_NAME_LINE = 16.8;
const WRAPPED_LONG_NAME_LINE = 15.6;
/** Names longer than this many characters are set at 13px instead of 14px. */
const LONG_NAME = 22;
const TIME_LINE = 16;
const GENRE_LINE = 15;
/** The foot line ("No Qloo signal", or a weak signal's words or cue): 12.5px on a 16px line. */
const FOOT_LINE = 16;
const FULL_CHROME = 16 + 2;
const SHORT_CHROME = 8 + 2;
const FOOT_GAP = 4;
const CARD_PAD_X = 10;
/**
 * The space between a tile and the tiles above and below it on its stage: a tile starts half of it
 * under the axis line of its start and ends half of it above the line of its end.
 */
const TILE_GAP = 4;
/**
 * The most lines a name is counted for. A name is never clamped or cut with an ellipsis: in a slot too
 * short for it the full name also prints in a tooltip on hover and focus.
 */
const MAX_NAME_LINES = 3;
/** About how wide a character of a 14px (or 13px) semibold name runs, for counting the lines a name needs. */
const NAME_CHAR_PX = 8;
const LONG_NAME_CHAR_PX = 7.4;
/** About how wide a character of the 13px genre runs (6.7px measured on average): generous, so a genre is never counted short. */
const GENRE_CHAR_PX = 7.6;
/** About how wide a character of the 12.5px medium foot label runs (6.1px measured), generous. */
const LABEL_CHAR_PX = 6.4;

/**
 * The word a weak-signal tile too narrow for "Weak Qloo signal" prints at its foot. The board key draws
 * the same word in its cue specimen, so the two cannot drift.
 */
export const WEAK_CUE_WORD = "weak";

/**
 * What a weak-signal tile prints at its foot, by the room the tile has across (`room` px; 0 or less
 * while the board is unmeasured): its words ("Weak Qloo signal") where they fit; else the cue word
 * "weak" (`cue`), which the board key explains; null where neither fits, and the qualifier is then
 * left to the title and the tile's screen-reader text, as a row a short tile hides is.
 */
export function weakCue(words: string, room: number): { text: string; cue: boolean } | null {
  const fits = (text: string) => room <= 0 || text.length * LABEL_CHAR_PX <= room;
  if (fits(words)) return { text: words, cue: false };
  if (fits(WEAK_CUE_WORD)) return { text: WEAK_CUE_WORD, cue: true };
  return null;
}

/** A name over 22 characters is set at 13px so it can wrap whole. */
export function isLongName(name: string): boolean {
  return name.length > LONG_NAME;
}

/**
 * What a set tile prints, by its height. The name comes first and gets every line it needs (up to
 * three); then the time, and the genre last (on every line it wraps to), each only where it still
 * fits, so a short tile hides its genre first and never gives the name fewer lines for another row. A
 * tile with no signal keeps its label ("No Qloo signal") before anything but the first line of its
 * name. A weak-signal tile says so at its foot where it has room after its time (`weakLine`, before the
 * genre). The draw is never printed on a tile, where a figure near-constant across the day is noise: it
 * is read out, and kept in the title, the clash drawer and the clash list. A row a tile leaves out is
 * still read out and kept in its title. `clamped` says the slot has room for fewer lines than the name
 * needs: the name is never clamped or ellipsised, and the full name also prints in a tooltip.
 */
export type CardRows = {
  roomy: boolean;
  nameLines: number;
  clamped: boolean;
  time: boolean;
  genre: boolean;
  label: boolean;
  /** A weak-signal tile with room for its qualifier on the foot line. */
  weakLine: boolean;
};

export function cardRows(
  box: number,
  needed: number,
  hasGenre: boolean,
  {
    long = false,
    label = false,
    genreLines = 1,
    weak = false,
    wraps = false,
  }: { long?: boolean; label?: boolean; genreLines?: number; weak?: boolean; wraps?: boolean } = {},
): CardRows {
  // `wraps`: the measured board wraps the name to more than one line, so it is set on the 1.2 line.
  const line = wraps ? (long ? WRAPPED_LONG_NAME_LINE : WRAPPED_NAME_LINE) : long ? LONG_NAME_LINE : NAME_LINE;
  const lines = Math.max(1, Math.min(MAX_NAME_LINES, needed));
  // Roomy: the name, the time and a foot line fit with the full padding.
  const roomy = box >= FULL_CHROME + lines * line + TIME_LINE + FOOT_GAP + FOOT_LINE;
  const footRow = FOOT_LINE + (roomy ? FOOT_GAP : 0);
  let left = box - (roomy ? FULL_CHROME : SHORT_CHROME);
  if (label) left -= footRow;
  const nameLines = Math.max(1, Math.min(lines, Math.floor(left / line)));
  // The name prints every line it needs even where the slot has room for fewer (it is never cut), so the
  // rows under it count from its full height: a clamped name leaves no room for the time or the genre,
  // which would only push the foot label out of the tile.
  left -= lines * line;
  const time = left >= TIME_LINE;
  if (time) left -= TIME_LINE;
  const weakLine = weak && !label && time && left >= footRow;
  if (weakLine) left -= footRow;
  // The weak qualifier outranks the genre: a weak tile with no room for it shows no genre either.
  const genre = hasGenre && time && (!weak || weakLine) && left >= Math.max(1, genreLines) * GENRE_LINE;
  return { roomy, nameLines, clamped: nameLines < lines, time, genre, label, weakLine };
}

/** Tall enough that a 45-minute set prints its whole name on two lines, its time and its draw. */
const PX_PER_MINUTE = 2.1;
const BADGE = 26;
/**
 * The narrowest gutter between stages: a rank badge sits in the middle of the first gutter its link
 * crosses, so this keeps clear paper between the badge and the set cards on either side.
 */
const MIN_GUTTER = BADGE + 8;

type TimetableGridProps = {
  views: readonly SetView[];
  stages: readonly Stage[];
  /** The clashes drawn as links (the costliest of the day). */
  links: readonly PairClash[];
  dayLabel: string;
  activeSetIds: ReadonlySet<string>;
  activeClashKeys: ReadonlySet<string>;
  /** Something is highlighted, so everything else steps back. */
  dimmed: boolean;
  /** The set or clash that is hovered or focused right now. */
  focusSetId: string | null;
  onHighlightSet: (id: string | null) => void;
  onHighlightClash: (key: string | null) => void;
  onOpen: (clash: PairClash, trigger: HTMLElement) => void;
  /** A tested plan to preview: kept moves and the place being tried, drawn as ghosts. */
  plan?: PlanPreview | null;
  /** A change from "Keep two sets apart", drawn as ghosts and never part of the plan. */
  rulePreview?: RulePreview | null;
  /** The invented day: a set with no signal is "No taste signal", not "No Qloo signal". */
  synthetic?: boolean;
  /**
   * On a published day, the locked sets are exactly the last set on each stage (`lockRuleHolds`), so a
   * locked tile's screen-reader words may state that rule; otherwise they say only that this app keeps
   * the set in place.
   */
  holds?: boolean;
  className?: string;
};

type GhostKind = "kept" | "trying" | "rule";
type Ghost = { slot: GhostSlot; name: string; col: number; range: TimeRange; kind: GhostKind };

/** The pixels a block of this time range is drawn over, as the sets and the ghosts size themselves. */
function drawnSpan(range: TimeRange, y: (minute: number) => number): { top: number; bottom: number } {
  const top = y(range.start);
  const height = y(range.end) - top;
  return { top: top + TILE_GAP / 2, bottom: top + TILE_GAP / 2 + Math.max(height - TILE_GAP, 18) };
}

/** What a ghost is called, so its flight plays once and never again for the same place. */
function ghostSignature(ghost: Ghost): string {
  return `${ghost.kind}:${ghost.slot.actId}:${ghost.slot.stageId}:${ghost.slot.day}:${ghost.slot.start}`;
}

/** Where a tested place is drawn: its stage column and its minutes, kept inside the drawn day. */
function placeGhosts(
  plan: PlanPreview | null | undefined,
  rulePreview: RulePreview | null | undefined,
  views: ReadonlyMap<string, SetView>,
  stages: readonly Stage[],
  domain: TimeRange,
): Ghost[] {
  const slots: { slot: GhostSlot; kind: GhostKind }[] = [
    ...(plan?.kept ?? []).map((slot) => ({ slot, kind: "kept" as const })),
    ...(plan?.trying ? [{ slot: plan.trying, kind: "trying" as const }] : []),
    ...(rulePreview?.ghosts ?? []).map((slot) => ({ slot, kind: "rule" as const })),
  ];
  return slots.flatMap(({ slot, kind }) => {
    const view = views.get(slot.actId);
    const col = stages.findIndex((stage) => stage.id === slot.stageId);
    if (!view || view.slot.day !== slot.day || col < 0) return [];
    // A start written past midnight as "00:30" belongs after the day's last hour.
    const shift = slot.start < domain.start && slot.start + 1440 < domain.end ? 1440 : 0;
    const start = Math.max(domain.start, slot.start + shift);
    const end = Math.min(domain.end, slot.end + shift);
    if (end <= start) return [];
    return [{ slot, name: view.act.name, col, range: { start, end }, kind }];
  });
}

/**
 * About how many lines a set's name wraps to in a column `width` px wide (words kept whole), at 14px,
 * or at 13px for a name over 22 characters, so a tile can tell whether its genre also fits under the
 * name. Before the board has measured its columns it counts the most lines a name may take, so no
 * name is cut short on the first paint.
 */
export function estimateNameLines(name: string, width: number): number {
  if (width <= 0) return MAX_NAME_LINES;
  return wrapLines(name, width, isLongName(name) ? LONG_NAME_CHAR_PX : NAME_CHAR_PX);
}

/** About how many lines the 13px genre wraps to in `width` px (two before the columns are measured). */
function estimateGenreLines(genre: string, width: number): number {
  if (width <= 0) return 2;
  return wrapLines(genre, width, GENRE_CHAR_PX);
}

function wrapLines(text: string, width: number, char: number): number {
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = word.length * char;
    if (used === 0) used = w;
    else if (used + char / 2 + w <= width) used += char / 2 + w;
    else {
      lines += 1;
      used = w;
    }
  }
  return lines;
}

/**
 * How one set tile is laid out on a board drawn on `y`, in a column `columnWidth` px wide (0 while the
 * board is unmeasured): its box, its rows and a weak tile's foot. `foot` is undefined where the tile
 * prints no weak qualifier (not weak, or no room for the line), and null where neither the words nor
 * the cue word fit across.
 */
export function tileLayout(view: SetView, y: (minute: number) => number, columnWidth: number, synthetic = false) {
  const top = y(view.slot.start);
  const height = y(view.slot.end) - top;
  const box = Math.max(height - TILE_GAP, 18);
  const long = isLongName(view.act.name);
  const none = view.coverage === "none";
  const weak = view.coverage === "weak";
  const needed = Math.min(
    MAX_NAME_LINES,
    estimateNameLines(view.act.name, columnWidth - 2 * CARD_PAD_X - (view.slot.locked ? 16 : 0)),
  );
  const genreLines = view.act.genre ? estimateGenreLines(view.act.genre, columnWidth - 2 * CARD_PAD_X) : 1;
  // Only a measured board knows a name wraps; before that every name keeps its leading-tight line.
  const wraps = columnWidth > 0 && needed > 1;
  // The name is never cut: a short tile drops its genre, then its time (each still read out and kept
  // in the title) before it gives the name fewer lines than it needs, and then the full name also
  // prints in a tooltip.
  const rows = cardRows(box, needed, Boolean(view.act.genre), { long, label: none, genreLines, weak, wraps });
  // A weak tile too narrow for "Weak Qloo signal" says "weak" at its foot, and the key explains it.
  const foot = rows.weakLine
    ? weakCue(weakSignalLabel(synthetic).replace(/\.$/, ""), columnWidth - 2 * CARD_PAD_X - 2)
    : undefined;
  return { top, box, long, none, weak, wraps, rows, foot };
}

/**
 * How many tiles of a board print the weak cue word ("weak"), with its columns `columnWidths` px wide
 * (none while unmeasured, when every weak tile with room prints its words). The board publishes this
 * to its key, which draws the cue only while it is over 0: a weak tile wide enough says "Weak Qloo
 * signal" in words and needs no key.
 */
export function shortCueCount(views: readonly SetView[], columnWidths: readonly number[] = [], synthetic = false): number {
  const scale = timeScale(timeDomain(views.map((view) => view.slot)), PX_PER_MINUTE);
  return views.filter((view) => tileLayout(view, scale.y, columnWidths[view.col] ?? 0, synthetic).foot?.cue).length;
}

/**
 * The stage columns of a board `boardWidth` px across, as it lays them out once measured: the time axis
 * and its gutter come off, then equal columns with the board's gutters between them. None while the
 * width is unknown (0).
 */
export function boardColumnWidths(boardWidth: number, stageCount: number): number[] {
  if (boardWidth <= 0) return [];
  const gap = Math.max(columnGap(boardWidth), MIN_GUTTER);
  return columnFrames(boardWidth - AXIS_WIDTH - gap, stageCount, gap).map((frame) => frame.width);
}

/**
 * How wide a board shut in a closed fold will be once the fold opens: it fills the fold's content box
 * (`foldWidth`), and never runs narrower than its own minimum width (760 px in the phone's sideways
 * scroller).
 */
export function foldedBoardWidth(foldWidth: number, minWidth: number): number {
  return Math.max(foldWidth, minWidth, 0);
}

/**
 * The column widths the board's key counts the "weak" cue from. A board in a fold reads its own width
 * (`heldWidth`) whenever the fold changes width or opens or closes, shut or open, so the count never waits
 * for the board to be measured and never keeps a width from before the fold last changed. Otherwise
 * (no fold, 0) the measured columns once there are any (`areaWidth` over 0).
 */
export function cueColumnWidths(measured: readonly number[], areaWidth: number, heldWidth: number, stageCount: number): readonly number[] {
  if (heldWidth > 0) return boardColumnWidths(heldWidth, stageCount);
  return areaWidth > 0 ? measured : [];
}

/**
 * What a set block adds for screen readers after its visible text. A locked set says whose lock it is,
 * in the board key's words: this app's on a published day (the last-set rule only where `holds` proves
 * it), an invented fixed slot on the invented day.
 */
export function describeSetTail(view: SetView, moved: boolean, synthetic = false, holds = false): string {
  const parts = [
    view.coverage === "weak" ? weakSignalLabel(synthetic) : "",
    view.slot.locked ? lockLabel({ synthetic, holds }) : "",
    moved ? "Moved in your tested plan." : "",
  ];
  const [first] = view.clashes;
  if (first) {
    const partner = partnerOf(first, view.id);
    parts.push(
      `In ${view.clashes.length} ranked ${view.clashes.length === 1 ? "clash" : "clashes"}; press Enter to open the costliest, number ${first.rank}, with ${partner.name}.`,
    );
  } else if (view.coverage !== "none") {
    parts.push("No ranked clash.");
  }
  return parts.filter(Boolean).join(" ");
}

/** One pointer event as the hover rule reads it: which element, and what kind of pointer moved. */
export type HandEvent = { type: "enter" | "move" | "leave"; key: string; pointerType?: string };

/**
 * The hover rule, step by step. `moved` is the element the pointer has moved in since it entered, or null.
 * An entry alone does nothing: the browser also fires one when the page scrolls an element under a still
 * pointer (a jump link, the wheel), and no move follows it. The first move inside an element highlights it
 * ("on"), once; a touch never does (a tap opens). A leave clears the highlight ("off") only from the element
 * whose move set it.
 */
export function handStep(moved: string | null, event: HandEvent): { moved: string | null; action: "on" | "off" | null } {
  if (event.type === "enter") {
    // The pointer was outside, so a move still kept for this element is stale (it left the page without a
    // leave): the next move counts again.
    return { moved: moved === event.key ? null : moved, action: null };
  }
  if (event.type === "move") {
    if (event.pointerType === "touch" || moved === event.key) return { moved, action: null };
    return { moved: event.key, action: "on" };
  }
  if (moved !== event.key) return { moved, action: null };
  return { moved: null, action: "off" };
}

/**
 * Hover that answers the visitor's hand only, by `handStep`: `on(key)` runs on the first pointer move
 * inside an element, so nothing dims or lifts until the hand moves, and `off(key)` when the pointer leaves
 * the element whose move set it. `hand` is the key the pointer last moved in, for hover styles that must
 * not follow a scroll either. Keyboard focus and blur keep their own handlers.
 */
export function useHandHover(on: (key: string) => void, off: (key: string) => void) {
  const [hand, setHand] = useState<string | null>(null);
  const moved = useRef<string | null>(null);
  const step = (event: HandEvent) => {
    const next = handStep(moved.current, event);
    moved.current = next.moved;
    if (next.action === "on") {
      setHand(event.key);
      on(event.key);
    } else if (next.action === "off") {
      setHand(null);
      off(event.key);
    }
  };
  const bind = (key: string) => ({
    onPointerEnter: () => step({ type: "enter", key }),
    onPointerMove: (event: PointerEvent<HTMLElement>) => step({ type: "move", key, pointerType: event.pointerType }),
    onPointerLeave: () => step({ type: "leave", key }),
  });
  return { hand, bind };
}

/**
 * The day's timetable: stages as columns on a shared time axis, sets sized by length, and a level
 * line between the two sets of each of the costliest clashes at the middle of the minutes they
 * share, visible without a hover (a 1px line, stronger = costlier; an outlined disc = hidden clash). A line runs behind any stage in between, so it never crosses a set's text. Arrow keys move between sets;
 * Enter opens a set's costliest clash; each badge opens its clash. A tested plan, when given, shows
 * as dashed ghosts at the tested places; the links and badges stay on the published timetable.
 *
 * Below 768 px the board sits in a sideways scroller (see `clash-control.tsx`): the stage names
 * scroll with it instead of sticking, and the time axis stays at the left edge.
 */
export function TimetableGrid({
  views,
  stages,
  links,
  dayLabel,
  activeSetIds,
  activeClashKeys,
  dimmed,
  focusSetId,
  onHighlightSet,
  onHighlightClash,
  onOpen,
  plan = null,
  rulePreview = null,
  synthetic = false,
  holds = false,
  className,
}: TimetableGridProps) {
  // A tile or a badge highlights on the visitor's first pointer move inside it, never because the page
  // scrolled it under a still pointer. Keys: "set:{id}" and "clash:{key}".
  const { hand, bind: handHover } = useHandHover(
    (key) => (key.startsWith("set:") ? onHighlightSet(key.slice(4)) : onHighlightClash(key.slice(6))),
    (key) => (key.startsWith("set:") ? onHighlightSet(null) : onHighlightClash(null)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const setRefs = useRef(new Map<string, HTMLButtonElement>());
  const [width, setWidth] = useState(0);
  const [boardWidth, setBoardWidth] = useState(0);
  const [rovingId, setRovingId] = useState<string | null>(null);
  // The width the observer last reported, read by the preview's scroll (below) without waiting for a render.
  const measuredWidth = useRef(0);

  // The observer measures the board whenever its size changes, so a board hidden and shown again (display
  // none, or a closed fold, reports 0 and then its width) lays its columns, links and badges out afresh.
  useEffect(() => {
    const root = rootRef.current;
    const area = areaRef.current;
    if (!root || !area) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === root) setBoardWidth(entry.contentRect.width);
        else {
          measuredWidth.current = entry.contentRect.width;
          setWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(root);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  // Wider gutters once the board has room, so the links between neighbouring stages show.
  const gap = Math.max(columnGap(boardWidth), MIN_GUTTER);

  const domain = useMemo(() => timeDomain(views.map((view) => view.slot)), [views]);
  const scale = useMemo(() => timeScale(domain, PX_PER_MINUTE), [domain]);
  const hours = useMemo(() => timeTicks(domain, 60), [domain]);
  const frames = useMemo(() => columnFrames(width, stages.length, gap), [width, stages.length, gap]);
  // The key draws the narrow tiles' "weak" cue while some tile on this board prints it. Shut in its closed
  // fold, the board's observer reports nothing, so the key learnt of the cue only once the fold opened, and
  // gained a line above the summary just pressed (28 px at 768 px). So the board reads its own width before
  // the first paint, and again whenever the fold changes width, opens or closes: the key holds the same
  // items shut and open. Chromium lays out a closed fold's board when asked; a browser that does not reads
  // 0, and then the width comes from the fold, which the board fills (never under its own minimum width).
  const [heldWidth, setHeldWidth] = useState(0);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const fold = root?.closest("details");
    if (!root || !fold) return;
    const read = () => {
      const own = root.getBoundingClientRect().width;
      const style = getComputedStyle(fold);
      const sides = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"] as const;
      const foldWidth = sides.reduce((left, side) => left - (parseFloat(style[side]) || 0), fold.getBoundingClientRect().width);
      setHeldWidth(own > 0 ? own : foldedBoardWidth(foldWidth, parseFloat(getComputedStyle(root).minWidth) || 0));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(fold);
    fold.addEventListener("toggle", read);
    return () => {
      observer.disconnect();
      fold.removeEventListener("toggle", read);
    };
  }, []);
  const cueTiles = useMemo(
    () =>
      shortCueCount(
        views,
        cueColumnWidths(
          frames.map((frame) => frame.width),
          width,
          heldWidth,
          stages.length,
        ),
        synthetic,
      ),
    [views, frames, width, heldWidth, stages.length, synthetic],
  );
  usePublishCueTiles(cueTiles);
  const byId = useMemo(() => new Map(views.map((view) => [view.id, view])), [views]);
  // A tile in one of the costed clashes drawn on the board (it carries a link and a disc).
  const costedIds = useMemo(() => new Set(links.flatMap((clash) => [clash.a.act_id, clash.b.act_id])), [links]);
  // Tiles whose rows the browser could not fit after all (the line counts above are estimates): their
  // names get the hover and focus tooltip too. Measured after layout and after the fonts load.
  const [overflowing, setOverflowing] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const ids = new Set<string>();
      area.querySelectorAll<HTMLElement>("button[data-set]").forEach((element) => {
        if (element.scrollHeight > element.clientHeight + 1) ids.add(element.dataset.set ?? "");
      });
      setOverflowing((previous) =>
        previous.size === ids.size && [...ids].every((id) => previous.has(id)) ? previous : ids,
      );
    };
    const frame = requestAnimationFrame(measure);
    void document.fonts?.ready.then(measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [width, gap, views]);
  // A rule preview is a tested timetable of its own: while it shows, the kept plan's ghosts step
  // aside (the preview was checked against the published day, not the plan) and return on Clear.
  const shownPlan = rulePreview ? null : plan;
  const ghosts = useMemo(
    () => placeGhosts(shownPlan, rulePreview, byId, stages, domain),
    [shownPlan, rulePreview, byId, stages, domain],
  );
  const movedIds = useMemo(() => new Set((shownPlan?.kept ?? []).map((slot) => slot.actId)), [shownPlan]);
  // A published set gives way to a ghost on its stage when the two blocks, as drawn, overlap: it
  // dims and its visible title hides (its accessible name stays) so the two never print on one
  // another. A ghost that only starts near a set, without covering it, leaves the set as it is.
  const overprintedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ghost of ghosts) {
      const drawn = drawnSpan(ghost.range, scale.y);
      for (const view of views) {
        if (view.slot.stage_id !== ghost.slot.stageId) continue;
        const set = drawnSpan(view.slot, scale.y);
        if (set.top < drawn.bottom && drawn.top < set.bottom) ids.add(view.id);
      }
    }
    return ids;
  }, [ghosts, views, scale]);
  // A previewed rule change ends the overlap of its pair: a small outlined zero sits between the two.
  const zero = useMemo(() => {
    if (!rulePreview || width === 0) return null;
    const centre = (actId: string): { x: number; y: number } | null => {
      const ghost = ghosts.find((item) => item.kind === "rule" && item.slot.actId === actId);
      const view = byId.get(actId);
      const col = ghost ? ghost.col : view?.col;
      const range = ghost ? ghost.range : view?.slot;
      const frame = col === undefined ? undefined : frames[col];
      if (!frame || !range) return null;
      return { x: frame.left + frame.width / 2, y: (scale.y(range.start) + scale.y(range.end)) / 2 };
    };
    const a = centre(rulePreview.pair.aId);
    const b = centre(rulePreview.pair.bId);
    if (!a || !b) return null;
    const key = `${rulePreview.pair.aId}|${rulePreview.pair.bId}|${rulePreview.ghosts.map((g) => `${g.actId}@${g.start}`).join(",")}`;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, key };
  }, [rulePreview, width, ghosts, byId, frames, scale]);
  // Motion starts after the board has settled, and only for what appears after that: whatever is
  // already on the board then (a plan kept in this tab) never flies in, and each flight, lift or
  // zero plays once and is marked done when it ends, so scrolling the board back into view never
  // replays it. A thing that leaves the board (Start over, Clear on a preview) is forgotten, so
  // the next time it appears it plays once again; a kept plan hidden behind a preview is not.
  const names = useMemo(
    () => [
      ...ghosts.map(ghostSignature),
      ...[...movedIds].map((id) => `lift:${id}`),
      ...(zero ? [`zero:${zero.key}`] : []),
    ],
    [ghosts, movedIds, zero],
  );
  const [armed, setArmed] = useState(false);
  const [spent, setSpent] = useState<ReadonlySet<string>>(() => new Set());
  const [seen, setSeen] = useState(names);
  if (seen !== names) {
    setSeen(names);
    if (rulePreview === null) {
      const stay = [...spent].filter((name) => names.includes(name));
      if (stay.length !== spent.size) setSpent(new Set(stay));
    }
  }
  const onBoard = useRef(names);
  useEffect(() => {
    onBoard.current = names;
  }, [names]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSpent((previous) => new Set([...previous, ...onBoard.current]));
      setArmed(true);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);
  const mayPlay = (name: string) => armed && !spent.has(name);
  const markPlayed = (name: string) => setSpent((previous) => (previous.has(name) ? previous : new Set(previous).add(name)));

  // "Preview on the timetable" brings the first tested slot into view (at once with reduced motion),
  // and its flight starts after the scroll, so it is seen. A board shown in the same render as the
  // preview (a closed fold that opens for it) has not been measured yet, so its ghosts do not stand where
  // they will be drawn: the scroll then waits two frames, for the observer's width and the render it brings.
  const [ruleShown, setRuleShown] = useState<RulePreview | null>(null);
  useEffect(() => {
    if (!rulePreview) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer = 0;
    let frame = 0;
    const scroll = () => {
      const first = rootRef.current?.querySelector<HTMLElement>('[data-ghost="rule"]');
      first?.scrollIntoView({ block: "center", inline: "center", behavior: reduce ? "auto" : "smooth" });
      timer = window.setTimeout(() => setRuleShown(rulePreview), reduce || !first ? 0 : 500);
    };
    const area = areaRef.current;
    const stale = area !== null && Math.abs(area.getBoundingClientRect().width - measuredWidth.current) > 0.5;
    if (stale) {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(scroll);
      });
    } else scroll();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [rulePreview]);
  const ruleSeen = rulePreview !== null && ruleShown === rulePreview;
  const navItems = useMemo(
    () => views.map((view) => ({ id: view.id, col: view.col, start: view.slot.start, end: view.slot.end })),
    [views],
  );
  const tabStop = rovingId && byId.has(rovingId) ? rovingId : (views[0]?.id ?? null);

  // The links and their badges are drawn in full from the first paint: nothing on the board plays
  // because it scrolled into view. The badges are buttons, focusable and labelled, from the start.
  const maxShare = Math.max(...links.map((clash) => clash.regret_share), 0.0001);
  const layouts = useMemo(() => {
    if (width === 0) return [];
    const inputs: LinkInput[] = links.flatMap((clash) => {
      const a = byId.get(clash.a.act_id);
      const b = byId.get(clash.b.act_id);
      if (!a || !b || a.col === b.col) return [];
      // The minutes the two share; failing that, the span between the later set's start and the
      // earlier set's end, so the line sits between two times the data gives.
      const [earlier, later] = a.slot.start <= b.slot.start ? [a.slot, b.slot] : [b.slot, a.slot];
      const window = overlapWindow(a.slot, b.slot) ?? {
        start: Math.min(later.start, earlier.end),
        end: Math.max(later.start, earlier.end),
      };
      return [{ id: clashKey(clash), colA: a.col, colB: b.col, window, weight: clash.regret_share / maxShare }];
    });
    // No rise: every link is one level line from set edge to set edge, its badge in the first gutter.
    return layoutLinks(inputs, frames, scale, {
      badgeSize: BADGE,
      bulgePerColumn: 0,
      maxBulge: 0,
      minStroke: 2,
      maxStroke: 5,
    });
  }, [links, byId, frames, scale, maxShare, width]);
  const clashByKey = useMemo(() => new Map(links.map((clash) => [clashKey(clash), clash])), [links]);

  function onSetKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (!isNavKey(event.key)) return;
    event.preventDefault();
    const next = nextNavItem(navItems, id, event.key);
    if (next) setRefs.current.get(next)?.focus();
  }

  const columnsTemplate = `${AXIS_WIDTH}px repeat(${stages.length}, minmax(0, 1fr))`;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {/* Stage names stay in view while the day scrolls past, under the site header and the
          page's jump nav. In the phone scroller they scroll with the board instead. */}
      <div
        className="z-20 grid bg-background pt-2.5 pb-3 md:sticky md:top-27"
        style={{ gridTemplateColumns: columnsTemplate, columnGap: gap }}
      >
        <p className="self-end text-[0.8125rem] font-semibold text-muted-foreground">{dayLabel}</p>
        {stages.map((stage) => {
          const count = views.filter((view) => view.stage.id === stage.id).length;
          return (
            <div key={stage.id} className="min-w-0 snap-start">
              <p className="type-wordmark text-lg break-words">{stage.name}</p>
              <p className="text-xs font-medium text-muted-foreground">
                <span className="font-mono tabular-nums">{count}</span> {count === 1 ? "set" : "sets"}
              </p>
            </div>
          );
        })}
      </div>

      <div
        className="relative mt-3 grid"
        style={{ gridTemplateColumns: `${AXIS_WIDTH}px minmax(0, 1fr)`, columnGap: gap }}
      >
        {/* Time axis. In the phone scroller it stays at the left edge while the stages pass. */}
        <div
          aria-hidden="true"
          className="relative max-md:sticky max-md:left-0 max-md:z-20 max-md:bg-background"
          style={{ height: scale.height }}
        >
          {hours.map((minute) => (
            <span
              key={minute}
              className="absolute right-0 -translate-y-1/2 font-mono text-xs text-muted-foreground tabular-nums"
              style={{ top: scale.y(minute) }}
            >
              {formatClock(minute)}
            </span>
          ))}
        </div>

        <div ref={areaRef} className="relative" style={{ height: scale.height }}>
          {/* Hour rules and stage guides, 1px, beneath the tiles and the links: every tile is opaque, so
              no rule shows through one. A guide runs down the middle of each gap between two stages,
              from the first hour line to the last, so the board reads as one ruled sheet. Decorative. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {hours.map((minute) => (
              <span
                key={`h${minute}`}
                className="absolute inset-x-0 border-t border-border"
                style={{ top: scale.y(minute) }}
              />
            ))}
            {width > 0 && hours.length > 1
              ? frames.slice(0, -1).map((frame, index) => (
                  <span
                    key={`g${index}`}
                    data-stage-guide=""
                    className="absolute border-l border-border"
                    style={{
                      left: frame.left + frame.width + gap / 2 - 0.5,
                      top: scale.y(hours[0] ?? domain.start),
                      height: scale.y(hours[hours.length - 1] ?? domain.end) - scale.y(hours[0] ?? domain.start),
                    }}
                  />
                ))
              : null}
          </div>

          {/* Links between clashing sets: one level line each, from the inner edge of one set to the
              inner edge of the other. Drawn behind the sets, so a link that jumps a stage passes under
              the set in between and shows only in the gutters and in open time. */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={width}
            height={scale.height}
          >
            {layouts.map((layout) => {
              const clash = clashByKey.get(layout.id);
              if (!clash) return null;
              const active = activeClashKeys.has(layout.id);
              const opacity = dimmed ? (active ? 1 : 0.12) : layout.opacity;
              // Every link is one 1px solid raspberry line with round caps, 2px for the active pair; the
              // disc says whether the clash is hidden.
              return (
                <g key={layout.id} style={{ opacity }} className="transition-opacity duration-150 ease-out">
                  <path d={layout.path} fill="none" stroke="var(--primary)" strokeWidth={active ? 2 : 1} strokeLinecap="round" />
                </g>
              );
            })}
          </svg>

          {/* Sets */}
          <div
            role="group"
            aria-label={`${dayLabel} timetable. Use the arrow keys to move between sets.`}
            className="absolute inset-0 grid"
            style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`, columnGap: gap }}
          >
            {stages.map((stage) => (
              <div key={stage.id} className="relative snap-start">
                {views
                  .filter((view) => view.stage.id === stage.id)
                  .map((view) => {
                    const { top, box, long, none, weak, wraps, rows, foot } = tileLayout(
                      view,
                      scale.y,
                      frames[view.col]?.width ?? 0,
                      synthetic,
                    );
                    const related = activeSetIds.has(view.id);
                    const isFocus = focusSetId === view.id;
                    const costliest = view.clashes[0];
                    const moved = movedIds.has(view.id);
                    const overprinted = overprintedIds.has(view.id);
                    const clamped = rows.clamped || overflowing.has(view.id);
                    const drawText = none
                      ? noSignalLabel(synthetic)
                      : view.act.popularity !== null
                        ? `Draw ${formatDraw(view.act.popularity)}`
                        : "";
                    // The tile's tooltip names everything it holds, shown or not. A lock shows on the tile as an
                    // icon alone, so its tooltip says whose lock it is, in the tail's words.
                    const title = [
                      view.act.name,
                      formatRange(view.slot),
                      view.act.genre,
                      drawText,
                      weak ? weakSignalLabel(synthetic) : "",
                      view.slot.locked ? lockLabel({ synthetic, holds }) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <div key={view.id} className="group/tile contents">
                        <button
                          type="button"
                          ref={(element) => {
                            if (element) setRefs.current.set(view.id, element);
                            else setRefs.current.delete(view.id);
                          }}
                          tabIndex={view.id === tabStop ? 0 : -1}
                          onKeyDown={(event) => onSetKeyDown(event, view.id)}
                          onFocus={() => {
                            setRovingId(view.id);
                            onHighlightSet(view.id);
                          }}
                          onBlur={() => onHighlightSet(null)}
                          {...handHover(`set:${view.id}`)}
                          onClick={(event) => {
                            if (costliest) onOpen(costliest, event.currentTarget);
                          }}
                          title={title}
                          data-set={view.id}
                          data-overprinted={overprinted ? "true" : undefined}
                          onAnimationEnd={moved ? () => markPlayed(`lift:${view.id}`) : undefined}
                          className={cn(
                            // A tile's corner is the control and tile radius; its focus ring follows it.
                            "group/set absolute inset-x-0 flex min-w-0 flex-col overflow-hidden rounded-md border text-left transition-opacity duration-150 ease-out",
                            "focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                            rows.roomy ? "px-2.5 py-2" : "px-2.5 py-1",
                            // Moved in the tested plan: the slot it left, paper with muted text and no
                            // edge. No Qloo signal: the board's own paper (opaque, so no rule shows through)
                            // in a 1px dotted control-grey edge with an ink name, so an unpriced set weighs
                            // less than a priced one (its label says why it is not priced). The board sits on
                            // paper at every width; the list view draws its tiles on its own classes. A priced
                            // tile is the sheet in a 1px hairline (its name identifies it), and a tile in one
                            // of the costed clashes gets the stronger edge.
                            moved
                              ? "border-transparent bg-background text-muted-foreground"
                              : none
                                ? "border-dotted border-border-strong bg-background text-foreground"
                                : cn("bg-card text-foreground", costedIds.has(view.id) ? "border-border-strong" : "border-border"),
                            moved && mayPlay(`lift:${view.id}`) && "cc-lift",
                            // The hovered tile takes the wash with the highlight (isFocus, below), set by the hand's
                            // first move: a tile scrolled under a still pointer stays as it is.
                            costliest ? "cursor-pointer" : "cursor-default",
                            isFocus && "bg-accent outline-2 -outline-offset-2 outline-foreground",
                            related && !isFocus && "outline-2 -outline-offset-2 outline-primary",
                            dimmed && !related && !isFocus && "opacity-40",
                            "data-[overprinted=true]:opacity-30 data-[overprinted=true]:focus-visible:opacity-100",
                          )}
                          style={{ top: top + TILE_GAP / 2, height: box }}
                        >
                          <span className="flex min-w-0 items-start gap-1">
                            <span
                              data-set-name={view.id}
                              className={cn(
                                "min-w-0 flex-1 font-semibold break-words",
                                long ? "text-[0.8125rem]" : "text-sm",
                                wraps ? "leading-[1.2]" : "leading-tight",
                                "transition-opacity duration-150 group-data-[overprinted=true]/set:opacity-0 group-data-[overprinted=true]/set:group-focus-visible/set:opacity-100",
                              )}
                            >
                              {view.act.name}
                              <span className="sr-only">, {view.stage.name}. </span>
                              {rows.time ? null : <span className="sr-only">{formatRange(view.slot)}. </span>}
                            </span>
                            {view.slot.locked ? <Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" /> : null}
                          </span>
                          {rows.time ? (
                            // The act and its time are the tile's two ink lines; genre and signal stay muted.
                            // The slot a tested move left keeps its muted text throughout.
                            <span
                              className={cn(
                                "block font-mono text-xs leading-4 whitespace-nowrap tabular-nums",
                                moved ? "text-muted-foreground" : "text-foreground",
                              )}
                            >
                              {formatRange(view.slot)}
                              <span className="sr-only">. {view.act.genre && !rows.genre ? `${view.act.genre}. ` : ""}</span>
                            </span>
                          ) : view.act.genre ? (
                            <span className="sr-only">{view.act.genre}. </span>
                          ) : null}
                          {rows.genre ? (
                            <span data-genre="" className="block text-xs leading-[15px] break-words text-muted-foreground">
                              {view.act.genre}
                              <span className="sr-only">. </span>
                            </span>
                          ) : null}
                          {rows.label ? (
                            // No Qloo signal is the tile's label, never the row a short tile hides.
                            <span
                              data-no-signal=""
                              className={cn("mt-auto block text-[0.78125rem] leading-4 font-medium whitespace-nowrap text-muted-foreground", rows.roomy && "pt-1")}
                            >
                              {noSignalLabel(synthetic)}
                              <span className="sr-only">, not scored. </span>
                            </span>
                          ) : (
                            <>
                              {/* The draw is read out, never printed on the tile: it stays in the title, the
                                  clash drawer and the clash list. */}
                              {view.act.popularity !== null ? (
                                <span className="sr-only">{`Draw ${formatDraw(view.act.popularity)}. `}</span>
                              ) : null}
                              {foot ? (
                                // A weak signal, said at the foot in the no-signal label's style: in words, or as the
                                // key's cue word on a tile too narrow for them. Read out once, in the tile's tail.
                                <span
                                  aria-hidden="true"
                                  data-weak={foot.cue ? "cue" : "line"}
                                  className={cn("mt-auto block text-[0.78125rem] leading-4 font-medium whitespace-nowrap text-muted-foreground", rows.roomy && "pt-1")}
                                >
                                  {foot.text}
                                </span>
                              ) : null}
                            </>
                          )}
                          <span className="sr-only">{describeSetTail(view, moved, synthetic, holds)}</span>
                        </button>
                        {clamped ? (
                          // A name in a slot too short for every line it needs also shows in full on hover
                          // (the hand's first move over the tile) and on focus. Decorative: the tile's own text
                          // and its title carry the whole name.
                          <span
                            aria-hidden="true"
                            data-name-tooltip=""
                            className={cn(
                              "pointer-events-none absolute left-0 z-30 hidden w-max max-w-64 rounded-sm bg-foreground px-2 py-1 text-xs text-background group-focus-within/tile:block print:hidden",
                              hand === `set:${view.id}` && "block",
                            )}
                            style={{ top: top + TILE_GAP / 2 + box + 4 }}
                          >
                            {view.act.name}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>

          {/* Tested places: a dashed ink ghost per kept move, for the place being tried and per
              set of a previewed rule change. Decorative: the moved set's own block says it moved.
              A ghost that appears after the board has settled flies in from the set's published
              place (`--dx`, `--dy`, in this area's own pixels); the published block never moves. */}
          {ghosts.length > 0 ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {ghosts.map((ghost) => {
                const frame = frames[ghost.col];
                if (!frame) return null;
                const top = scale.y(ghost.range.start);
                const height = scale.y(ghost.range.end) - top;
                const home = byId.get(ghost.slot.actId);
                const homeFrame = home ? frames[home.col] : undefined;
                const name = ghostSignature(ghost);
                const flies =
                  mayPlay(name) &&
                  ghost.kind !== "trying" &&
                  (ghost.kind !== "rule" || ruleSeen) &&
                  home !== undefined &&
                  homeFrame !== undefined;
                const flight =
                  flies && home && homeFrame
                    ? ({
                        "--dx": `${homeFrame.left - frame.left}px`,
                        "--dy": `${scale.y(home.slot.start) - top}px`,
                      } as CSSProperties)
                    : undefined;
                return (
                  <div
                    key={`${ghost.kind}-${ghost.slot.actId}`}
                    data-ghost={ghost.kind}
                    onAnimationEnd={flies ? () => markPlayed(name) : undefined}
                    className={cn(
                      // A tested place, kept or being tried: dashed ink on the sheet, never raspberry, on the
                      // tile's own corner (the dashes follow the curve).
                      "absolute flex flex-col overflow-hidden rounded-md border-2 border-dashed border-foreground bg-card bg-clip-padding px-2.5 py-1 text-left text-foreground",
                      flies && "cc-slot-flight",
                    )}
                    style={{
                      left: frame.left,
                      width: frame.width,
                      top: top + TILE_GAP / 2,
                      height: Math.max(height - TILE_GAP, 18),
                      ...flight,
                    }}
                  >
                    <span className="text-[0.8125rem] leading-tight font-bold break-words">
                      {ghost.name} · tested
                    </span>
                    {height >= 36 ? (
                      <span className="font-mono text-xs font-medium whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatRange(ghost.range)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
              {zero ? (
                <span
                  key={zero.key}
                  data-ghost="zero"
                  onAnimationEnd={() => markPlayed(`zero:${zero.key}`)}
                  className={cn(
                    "absolute grid size-5.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-foreground bg-card font-mono text-[0.8125rem] font-bold text-foreground",
                    mayPlay(`zero:${zero.key}`) && ruleSeen && "cc-zero",
                  )}
                  style={{ left: zero.x, top: zero.y }}
                >
                  0
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Over the sets: a 6px dot where each link meets each of its two sets, on the set's edge. */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={width}
            height={scale.height}
          >
            {layouts.map((layout) => {
              const active = activeClashKeys.has(layout.id);
              const opacity = dimmed ? (active ? 1 : 0.12) : layout.opacity;
              return (
                <g key={layout.id} style={{ opacity }} className="transition-opacity duration-150">
                  <circle cx={layout.x1} cy={layout.y} r={3} fill="var(--primary)" />
                  <circle cx={layout.x2} cy={layout.y} r={3} fill="var(--primary)" />
                </g>
              );
            })}
          </svg>

          {/* Rank badges: one button per drawn clash */}
          <ul aria-label="Clash links" className="absolute inset-0 z-10" style={{ pointerEvents: "none" }}>
            {layouts.map((layout) => {
              const clash = clashByKey.get(layout.id);
              if (!clash) return null;
              const hidden = clash.label === "hidden";
              const active = activeClashKeys.has(layout.id);
              return (
                <li key={layout.id}>
                  <button
                    type="button"
                    aria-label={`${clashMarkLabel(clash)}${clash.label && !hidden ? `, ${LABEL_META[clash.label].name.toLowerCase()}` : ""}, ${formatShare(clash.regret_share)} of the day's clash cost. Open details.`}
                    title={clashMarkLabel(clash)}
                    onClick={(event) => onOpen(clash, event.currentTarget)}
                    {...handHover(`clash:${layout.id}`)}
                    onFocus={() => onHighlightClash(layout.id)}
                    onBlur={() => onHighlightClash(null)}
                    // The lift follows the hand (its first move over the badge) and keyboard focus, never a
                    // scroll that carries the badge under a still pointer.
                    data-hand={hand === `clash:${layout.id}` ? "" : undefined}
                    className={cn(
                      "cc-link-badge pointer-events-auto absolute grid cursor-pointer place-items-center rounded-full font-mono text-[0.78125rem] font-bold tabular-nums transition-[opacity,transform] duration-150 data-[hand]:scale-110 focus-visible:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      dimmed && !active && "opacity-30",
                    )}
                    style={{
                      left: layout.badge.x - BADGE / 2,
                      top: layout.badge.y - BADGE / 2,
                      width: BADGE,
                      height: BADGE,
                    }}
                  >
                    {/* Every clash is a 22px numbered disc, centred in the first gutter the line crosses,
                        clear of the sets: a seen clash is filled raspberry with a paper numeral, a hidden
                        one is an ink ring on the card with an ink numeral (Hidden is a label, not shared
                        time; the raspberry link under it is the shared time). The numeral is 12.5px bold:
                        "10" runs 15.6px at 13px and would touch the hidden ring's 18px inside. */}
                    <ClashDisc hidden={hidden} className="absolute top-0.5 left-0.5" />
                    <span aria-hidden="true" className={cn("relative", hidden ? "text-foreground" : "text-primary-foreground")}>
                      {clash.rank}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
