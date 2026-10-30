"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { AbstainState, ErrorState, TraceDrawer } from "@/components/kernel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { AgentStatus } from "@/lib/agent-status";
import { describeReach, samplingReach } from "@/lib/clash-budget";
import { boardTraceDescription, popularityName, usedTitle } from "@/lib/credit";
import {
  buildSetViews,
  clashKey,
  daysWithSets,
  heroClash,
  involves,
  isFixedByLocks,
  partnerOf,
  topClashes,
  traceToolCalls,
  type HeroClash,
} from "@/lib/clashes";
import { buildDayGraph, type DayGraphModel, type GraphView } from "@/lib/day-graph";
import { buildDecisionCopy, decisionDay, requestDecision, type Decision } from "@/lib/decision";
import { pluralize } from "@/lib/format";
import { drawerRank, drawerRankOf } from "@/lib/lenses";
import { lockRuleHolds } from "@/lib/locks";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";
import { parsePreset, type Evidence, type PairClash, type Preset, type PresetSummary } from "@/lib/preset";
import type { RulePreview } from "@/lib/rule-fix";
import { carriedDecision, type ServerSummary } from "@/lib/server-summary";
import { isRuleStackStep, sameStep, seedOutcome, type PlanChoice, type PlanPreview, type StackStep } from "@/lib/stack";
import { cn } from "@/lib/utils";

import { AgentPanel } from "./agent-panel";
import { BudgetDial, Scorecard } from "./budget-dial";
import { ClashDrawer } from "./clash-drawer";
import { ClashList, liveClashRow } from "./clash-list";
import { CoverageMeter } from "./coverage-meter";
import { DayGraph, DayGraphKey } from "./day-graph";
import { builtDate, DecisionDetails, isHiddenDecision } from "./decision-card";
import {
  HERO_CELL_MIN,
  HeroDecision,
  HeroDecisionSkeleton,
  HeroLadderRoom,
  HeroNote,
  heroNote,
  INVENTED_HERO_CELL_MIN,
} from "./hero-decision";
import { HiddenWall, type HiddenDay } from "./hidden-wall";
import { MoreDetails } from "./more-details";
import { PresetSources } from "./preset-sources";
import { SummaryBoard, SummaryScore } from "./server-summary";
import { BoardSkeleton, ScoreSkeleton } from "./skeletons";
import { TimetableGrid } from "./timetable-grid";
import { LockKey, TimetableLegend, legendSymbolCount } from "./timetable-legend";
import { TimetableList } from "./timetable-list";
import { TRY_A_MOVE_ID, TryAMove, type SeedStep } from "./try-a-move";
import { TasteSection, WHAT_QLOO_ID, concurrentPairs, threeReadings, whatChangesTitle } from "./why-qloo";
import { WHY_THIS_MATTERS_ID, WhyThisMatters } from "./why-this-matters";
import { useAgentStatus } from "./use-agent-status";
import { useDecision } from "./use-decision";
import { useLenses } from "./use-lenses";
import { usePresets } from "./use-presets";
import { useRecordings } from "./use-recordings";

const TOP_LINKS = 10;

/** The anchor of the sources section, for the jump nav. */
export const SOURCES_ID = "sources";

/** The hidden-clash examples' section id (`hidden-wall.tsx`), for the jump nav. */
export const HIDDEN_WALL_ID = "hidden-wall";

/** The card's footer link says what it opens, and only rank 1 is called the costliest. */
const HERO_BUTTON: Record<HeroClash["kind"], string> = {
  hidden: "Open a hidden clash",
  evidence: "Open a clash and its evidence",
  costliest: "Open the costliest clash",
};

/**
 * What the index card's clash action opens, and what it says. When the card's own pair carries the Hidden label,
 * the card describes that pair in its hidden-clash line and the action closes that line, so it opens that same
 * pair ("Open a hidden clash"). Otherwise the action is a line of its own and opens the day's hero clash
 * (`heroClash`), named for its kind. Null when there is neither.
 */
export function cardClashAction(
  hero: HeroClash | null,
  cardPair: PairClash | null,
  cardHidden: boolean,
): { clash: PairClash; label: string } | null {
  if (cardPair && cardHidden) return { clash: cardPair, label: HERO_BUTTON.hidden };
  return hero ? { clash: hero.clash, label: HERO_BUTTON[hero.kind] } : null;
}

const PROOF_LINE = "Neither festival uses Clash Control.";
export const SYNTHETIC_PROOF_LINE =
  "Shown here on an invented day: the server has no built festival day, so the acts, times and readings are made up and no Qloo request was made.";

/**
 * What a card button adds to its announcement when it takes the place of a plan that is not empty:
 * "It replaced your earlier 2 kept steps." Null when it adds to nothing or the plan already holds it.
 */
function replacedNote(plan: readonly StackStep[], seed: StackStep): string | null {
  const outcome = seedOutcome(plan, seed);
  return outcome.kind === "replace" ? `It replaced your earlier ${pluralize(outcome.dropped, "kept step")}.` : null;
}

/** A festival day's label in the picker: its festival, the text before the first ", " of its title. */
export function festivalLabel(title: string): string {
  const comma = title.indexOf(", ");
  return comma >= 0 ? title.slice(0, comma) : title;
}

/**
 * The server's summary of the day the page opens on, with the location its saved Qloo reading was asked for
 * (`Preset.location`, read from the same preset response the summary is built from): null when the reading was
 * asked for no location, so it is global; undefined when the server could not say.
 */
export type HomeSummary = ServerSummary & { location?: string | null };

/**
 * The dateline's lead: the day, the kind of timetable and when its saved reading was built. The reading is
 * called global only where the preset sent no location (`location` null: it was asked for none); a location it
 * was asked for, or none known (undefined), prints no claim about place. The invented day says it is invented.
 * Null without a drawn day.
 */
export function datelineLead(
  model: Pick<DayGraphModel, "dayName" | "builtAt"> | null,
  synthetic: boolean,
  location: string | null | undefined,
): string | null {
  if (!model) return null;
  if (synthetic) return "Invented timetable.";
  // The date's three parts are joined by no-break spaces, so "3 Oct 2026" never breaks inside itself.
  const date = model.builtAt ? (builtDate(model.builtAt)?.replaceAll(" ", "\u00a0") ?? null) : null;
  const reading = location === null ? "saved global Qloo reading" : "saved Qloo reading";
  return `${model.dayName ? `${model.dayName}. ` : ""}Published timetable${date ? `; ${reading} built ${date}` : ""}.`;
}

/**
 * The line under the festival picker: the lead (`datelineLead`), then the proof line ("Sunday. Published
 * timetable; saved global Qloo reading built 3 Oct 2026. Neither festival uses Clash Control."). The invented day
 * says so and that no Qloo request was made. Without a drawn day (no server summary yet) the proof line stands
 * alone.
 */
function HeroDateline({
  model,
  synthetic = false,
  location,
}: {
  model: DayGraphModel | null;
  synthetic?: boolean;
  /** Where the day's saved reading was asked for: null for none (global), undefined when not known. */
  location: string | null | undefined;
}) {
  const lead = datelineLead(model, synthetic, location);
  return (
    <p
      data-dateline=""
      className="mt-1 max-w-[44rem] text-[0.8125rem] leading-[1.125rem] text-muted-foreground lg:mt-2 lg:text-sm lg:leading-5"
    >
      {lead ? `${lead} ` : null}
      {synthetic ? SYNTHETIC_PROOF_LINE : PROOF_LINE}
    </p>
  );
}

/** The drawing toggle's group name. */
const VIEW_TOGGLE_LABEL = "Drawing shows";

/**
 * What the day drawing shows: the day as published, or with the decision's move. The invented timetable was
 * never published, so on that day the first option reads "Invented timetable". It fills the row below
 * 1024 px. Nothing when there is no move.
 */
function ViewToggle({
  model,
  view,
  onChange,
}: {
  model: DayGraphModel;
  view: GraphView;
  /** Absent before the interactive view mounts: the toggle is drawn on the moved view, not yet pressable. */
  onChange?: (view: GraphView) => void;
}) {
  if (!model.move) return null;
  const options: { value: GraphView; label: string }[] = [
    { value: "published", label: model.synthetic ? "Invented timetable" : "As published" },
    { value: "moved", label: model.move.label },
  ];
  return (
    <SegmentedControl
      label={VIEW_TOGGLE_LABEL}
      size="sm"
      value={view}
      onValueChange={onChange ?? (() => {})}
      pending={!onChange}
      fill
      className="lg:inline-grid lg:w-auto"
      options={options}
    />
  );
}

/**
 * The toggle's 44 px room while the drawn day has no move to toggle (its decision still coming, or none), so
 * the drawing under it never moves when one comes. Nothing to read or press.
 */
function ToggleRoom() {
  return <div aria-hidden="true" data-toggle-room="" className="h-11" />;
}

/**
 * The hero, "the day is the graph", in one DOM order at every width: the pitch, the festival day (its picker
 * and dateline), the drawing's toggle, the drawing, the decision group, the drawing's key. Below 1024 px it
 * reads in that order. From 1024 px a grid puts the pitch, the day and the toggle in the left column, the
 * decision group in a right column 26rem wide (28rem from 1280 px) beside all three, and the drawing and its
 * key across both: the toggle sits at the foot of its row, directly over the drawing, which starts 40 px
 * under the taller column (8 px from 1280 px). Every track is minmax(0, ...) and every item min-w-0, so nothing pushes past the
 * page gutter on a phone. `busy` while another festival day is on its way to replace the one drawn. With
 * `reserve` (a decision group in any state) an empty room in the group's cell holds the settled group's height
 * from 1024 px (`HERO_CELL_MIN`, and `INVENTED_HERO_CELL_MIN` on the invented day, the `synthetic` one). It comes
 * second in the DOM, before the toggle and the drawing, so it is there from the first painted bytes: the left column,
 * which follows the taller column, never moves when the group streams in after the drawing, or comes later still.
 */
function HeroLayout({
  intro,
  day,
  toggle,
  graph,
  group,
  graphKey,
  busy = false,
  reserve = false,
  synthetic = false,
}: {
  intro: ReactNode;
  day?: ReactNode;
  toggle?: ReactNode;
  graph?: ReactNode;
  group?: ReactNode;
  graphKey?: ReactNode;
  busy?: boolean;
  reserve?: boolean;
  synthetic?: boolean;
}) {
  return (
    <section aria-labelledby="pitch-heading" aria-busy={busy || undefined}>
      {/* From 1024 px on a screen 790 px tall or less (1366 x 768) the top padding and the drawing's top margin
          tighten (32 to 16 px, 40 to 24 px), as the group's spaces do (`HERO_ROWS`), so the whole drawing fits above the fold; no text gets smaller. From
          1024 px the key sits 4 px above the section nav (whose 44 px row centres its links), so a key that takes a
          second line still leaves the nav on a 900 px first screen. Below 1280 px the ladder's two lines fill the
          group's notice cell, right above the drawing's right half, and a line's note keeps clear of them
          (day-graph.tsx, `shownAbove`); that cell stood empty on arrival until round 39, so the drawing there starts 16
          px lower than it did then, and the note keeps its room above the drawing's first names. From 1280 px (round 38, integrate) the drawing
          sits 8 px under the toggle at any height and the key right under the drawing (its last row keeps 19 px under
          its bars), which gives back the 28 px the taller 32/70 rows took, so the section nav still ends inside 900 px. */}
      <div className="container-page pt-4 pb-8 sm:pt-6 lg:pt-8 lg:pb-1 lg:[@media(max-height:790px)]:pt-4">
        <div
          data-hero=""
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_26rem] lg:grid-rows-[auto_auto_1fr_auto_auto] lg:gap-x-12 lg:[grid-template-areas:'pitch_group'_'day_group'_'toggle_group'_'graph_graph'_'key_key'] xl:grid-cols-[minmax(0,1fr)_28rem]"
        >
          <div className="min-w-0 lg:[grid-area:pitch]">{intro}</div>
          {reserve ? (
            <div
              aria-hidden="true"
              data-hero-room=""
              className={cn("hidden lg:block lg:[grid-area:group]", HERO_CELL_MIN, synthetic && INVENTED_HERO_CELL_MIN)}
            />
          ) : null}
          {day ? <div className="mt-2 min-w-0 lg:mt-6 xl:mt-4 lg:[grid-area:day]">{day}</div> : null}
          {toggle ? <div className="mt-2 min-w-0 lg:mt-6 xl:mt-2 lg:self-end lg:[grid-area:toggle]">{toggle}</div> : null}
          {graph ? (
            <div className="mt-1 min-w-0 lg:mt-10 xl:mt-2 lg:[@media(max-height:790px)]:mt-6 xl:[@media(max-height:790px)]:mt-2 lg:[grid-area:graph]">
              {graph}
            </div>
          ) : null}
          {group ? <div className="mt-2 min-w-0 lg:mt-0 lg:self-start lg:[grid-area:group]">{group}</div> : null}
          {graphKey ? <div className="mt-4 min-w-0 lg:mt-3 xl:mt-0 lg:[grid-area:key]">{graphKey}</div> : null}
        </div>
      </div>
    </section>
  );
}

/** The key under the drawing, as the hero sets it: 13 px muted, one line at 1440 px. */
const KEY_CLASS = "max-w-[75rem] text-[0.8125rem] leading-5 text-muted-foreground";

/**
 * The timetable section's frame: the page container's edges, like every other section. Five stage columns
 * get no wider than 13rem at 1280 or 1440 in either frame (the score rail takes 18rem), so the wider frame
 * returns only from 2xl (1536 px), where it buys the columns real room.
 */
function BoardFrame({
  label,
  labelledBy,
  children,
}: {
  label?: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} aria-labelledby={labelledBy} data-board-frame="">
      {/* Open sections are parted by space, not rules: 64 px above and below (80 px from 1024 px). */}
      <div className="container-page py-16 lg:py-20 2xl:max-w-[96rem]">{children}</div>
    </section>
  );
}

/**
 * The board's disclosure label: what the opened board shows, "Show 39 sets on 5 stages". It makes no claim about
 * numbering: the board numbers only the costliest clashes (`TOP_LINKS`).
 */
export function boardFoldSummary(sets: number, stages: number): string {
  return `Show ${pluralize(sets, "set")} on ${pluralize(stages, "stage")}`;
}

/** What the board fold just taken off the page showed: whether it was open, and whether its summary had focus. */
export type BoardFoldCarry = { open: boolean; focused: boolean };

/** The parts of the fold's `<details>` that `carryBoardFold` reads, so a test can hand it a stand-in. */
type FoldNode = Pick<HTMLDetailsElement, "open" | "ownerDocument"> & {
  querySelector(selector: "summary"): Pick<HTMLElement, "focus"> | null;
};

/**
 * The board fold's ref, so a visitor's press on the board's summary is never undone and the fold never shuts by
 * itself when the page swaps one fold for another (the server's frame for the interactive board, one festival
 * day's board for the next). Reported through `onToggle`, the page draws the next board in the reported state from
 * its first frame (so its chevron does not turn by itself); the server's frame, which React has not seen until the
 * page is interactive, reports a press made before then as soon as it is (`takeOver` false). On leaving the page a
 * fold also records in `carryRef` what the page itself showed: whether it was open and whether its summary had
 * focus. The fold that replaces it in the same commit (`takeOver` true) takes both over before the browser paints:
 * the focus, and an open state that no report reached in time (a press in the swap's own frame). It only opens,
 * never closes. Returns the ref's cleanup.
 */
export function carryBoardFold(
  node: FoldNode,
  carryRef: { current: BoardFoldCarry | null },
  { onToggle, takeOver }: { onToggle?: (open: boolean) => void; takeOver: boolean },
): () => void {
  const carried = carryRef.current;
  carryRef.current = null;
  if (!takeOver) {
    if (node.open) onToggle?.(true);
  } else if (carried) {
    if (carried.open && !node.open) {
      node.open = true;
      onToggle?.(true);
    }
    if (carried.focused) node.querySelector("summary")?.focus({ preventScroll: true });
  }
  return () => {
    const summary = node.querySelector("summary");
    carryRef.current = { open: node.open, focused: summary !== null && Object.is(node.ownerDocument.activeElement, summary) };
  };
}

/** Whether the board's fold now on the page is open: the server's copy, which a visitor may press before React runs. */
function foldOpenOnPage(): boolean {
  return typeof document !== "undefined" && document.querySelector<HTMLDetailsElement>("details[data-board-fold]")?.open === true;
}

/**
 * Where a visitor who scrolled on the server's frame is when the interactive page replaces it. The frame has the
 * board right under the hero; the page puts What Qloo changes, Hidden clashes and Why this matters before it, so
 * without this the page would rebuild under the visitor. The thing they look at keeps its place on the screen:
 * the board's summary when it is on screen (`fold`, its top), else the page's end when the footer is on screen
 * (`end`, the distance from the page's end; the frame holds the footer back while scripts run, so this is for a
 * browser that cannot), else the board when it fills the lower half of the screen or more (`board`, its top).
 * Null when the visitor has not scrolled, or mostly sees the hero, which both draw in one place.
 */
export type PagePlace = { anchor: "fold" | "board"; top: number } | { anchor: "end"; fromEnd: number };

/** A box on the screen (its top and bottom, in px from the top of the viewport), or null when it is not drawn. */
export type ScreenBox = { top: number; bottom: number } | null;

type PageView = { innerHeight: number; scrollY: number; scrollHeight: number };

/** The place to keep (`PagePlace`) from the frame's boxes and the screen, read just before the frame leaves. */
export function pagePlace(view: PageView, boxes: { fold: ScreenBox; board: ScreenBox; footer: ScreenBox }): PagePlace | null {
  if (view.scrollY <= 0) return null;
  const onScreen = (box: ScreenBox): box is { top: number; bottom: number } =>
    box !== null && box.bottom > 0 && box.top < view.innerHeight;
  if (onScreen(boxes.fold)) return { anchor: "fold", top: boxes.fold.top };
  if (onScreen(boxes.footer)) return { anchor: "end", fromEnd: view.scrollHeight - view.scrollY };
  if (boxes.board !== null && boxes.board.top < view.innerHeight / 2) return { anchor: "board", top: boxes.board.top };
  return null;
}

/**
 * The scroll position that puts the kept place where it was, read on the page that replaced the frame: the
 * summary's or the board's top on the same line of the screen, or the same distance from the page's end. The
 * summary, a control, never lands under the section nav where it sticks (`minTop`, the nav's foot), and no place
 * goes past either end of the page. Null when the page draws no such box.
 */
export function pagePlaceTarget(
  place: PagePlace,
  view: PageView,
  boxes: { fold: ScreenBox; board: ScreenBox },
  minTop = 0,
): number | null {
  let target: number;
  if (place.anchor === "end") target = view.scrollHeight - place.fromEnd;
  else {
    const box = boxes[place.anchor];
    if (box === null) return null;
    target = view.scrollY + box.top - (place.anchor === "fold" ? Math.max(place.top, minTop) : place.top);
  }
  return Math.min(Math.max(0, target), Math.max(0, view.scrollHeight - view.innerHeight));
}

/** A box as `pagePlace` reads it. */
function screenBox(element: Element | null): ScreenBox {
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}

/** The board's summary and the board's section on the page now: the frame's, or the interactive page's. */
function boardBoxes(): { fold: ScreenBox; board: ScreenBox } {
  return {
    fold: screenBox(document.querySelector("details[data-board-fold] > summary")),
    board: screenBox(document.querySelector("section[data-board-frame]")),
  };
}

function pageView(): PageView {
  return { innerHeight: window.innerHeight, scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight };
}

/** Read on the frame, while it is still whole: the place to keep (`pagePlace`). */
function readPagePlace(): PagePlace | null {
  return pagePlace(pageView(), { ...boardBoxes(), footer: screenBox(document.querySelector("main ~ footer")) });
}

/**
 * Run on the interactive page in the commit that drew it, before the browser paints: one instant scroll, so the
 * kept place is where it was. The section nav sticks from 768 px, so a kept top never lands under it.
 */
function keepPagePlace(place: PagePlace): void {
  // The section nav's foot where it sticks (from 768 px: under the 64 px header, 44 px tall).
  const nav = document.querySelector<HTMLElement>('nav[aria-label="On this page"]');
  const style = nav === null ? null : getComputedStyle(nav);
  const minTop = nav !== null && style !== null && style.position === "sticky" ? (parseFloat(style.top) || 0) + nav.offsetHeight : 0;
  const target = pagePlaceTarget(place, pageView(), boardBoxes(), minTop);
  if (target !== null && Math.abs(target - window.scrollY) > 0.5) window.scrollTo({ top: target, behavior: "instant" });
}

/**
 * Whether a board's fold starts open (round 39, W2): as the fold before it on the page was left (`report`: a press,
 * or the open state that board was drawn in), else open on a screen of 1280 px or more (`wide`), where the board's
 * column would otherwise stand empty beside the rail, and closed below, where the home reaches Try a move sooner.
 */
export function boardStartsOpen(report: boolean | null, wide: boolean): boolean {
  return report ?? wide;
}

/**
 * The board behind one disclosure, its summary a 44 px control in the 10 px button shape with the chevron. The
 * interactive board arrives open from 1280 px (`boardStartsOpen`) and closed below, so a phone reaches Try a move and
 * the agent sooner. Opening is instant, and an arrival open is drawn open from the fold's first style, so the chevron's
 * turn (kept for a press) never plays then. With `open` the page holds its state (it opens itself for a preview);
 * without it the fold is the server's frame, closed until pressed (the server's HTML knows no width), and `onToggle`
 * only reports. With `carryRef` (the page's one carrier) the fold hands its state to the fold that replaces it
 * (`carryBoardFold`). `inert` is for the copy of the server's frame that the streamed page replaces before any script
 * runs (the page's loading fallback, on screen for about two frames): nothing could carry a press on it over, so it
 * takes none.
 */
function BoardFold({
  summary,
  open,
  onToggle,
  carryRef,
  inert = false,
  className,
  children,
}: {
  summary: string;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  carryRef?: { current: BoardFoldCarry | null };
  inert?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const takeOver = open !== undefined;
  // The server's frame drawn anew over the server's HTML (React does that, instead of taking the HTML over, when the
  // page changes before it has): open if the visitor opened the copy it replaces. Read from the page once, while that
  // copy is still there; when React takes the HTML over, it reads this very fold.
  const [openOnPage] = useState(() => !takeOver && carryRef !== undefined && foldOpenOnPage());
  const carry = useCallback(
    (node: HTMLDetailsElement | null) => (node && carryRef ? carryBoardFold(node, carryRef, { onToggle, takeOver }) : undefined),
    [carryRef, onToggle, takeOver],
  );
  return (
    <details
      ref={carry}
      data-board-fold=""
      open={takeOver ? open : openOnPage || undefined}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
      inert={inert || undefined}
      // A press on the server's frame before the page is interactive adds `open`, which React would otherwise report
      // as a mismatch with the server's HTML when it takes the frame over.
      suppressHydrationWarning={!takeOver}
      className={cn("group/board", className)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-border-strong bg-card px-4 py-2.5 text-sm font-semibold hover:bg-accent [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 group-open/board:rotate-180 motion-safe:transition-transform motion-safe:duration-[160ms] motion-safe:ease-(--ease-out)"
        />
      </summary>
      {children}
    </details>
  );
}

type JumpLink = { href: string; label: string };

/**
 * The home page's sections under the hero and the section nav, in reading order: what Qloo changes for the
 * card's clash, the hidden-clash examples (second, so the clash no genre tag can find is met early), why
 * this matters, the timetable, Try a move, the agent's recorded or live runs, and the sources.
 */
export const HOME_ORDER = ["qloo", "wall", "why", "board", "move", "agent", "sources"] as const;

type HomeSection = (typeof HOME_ORDER)[number];

/** Renders the home sections in `HOME_ORDER`, whatever order the caller passes them in. */
export function HomeSections(sections: Record<HomeSection, ReactNode>) {
  return (
    <>
      {HOME_ORDER.map((key) => (
        <Fragment key={key}>{sections[key]}</Fragment>
      ))}
    </>
  );
}

/**
 * In-page links under the hero, in the order of the sections. From 768 px up it sticks under the site header, and the page's
 * anchor offset grows by its height so a jump lands below it; on a phone it is one row that
 * scrolls sideways.
 */
/**
 * The section nav's entries, in page order: What Qloo changes (when the page passes it), Hidden
 * clashes (when the day has examples), Why this matters, Timetable, Try a move, the agent's runs, Sources.
 */
export function jumpLinks({ agent, wall, qloo = null }: { agent: JumpLink; wall: boolean; qloo?: JumpLink | null }): JumpLink[] {
  return [
    ...(qloo ? [qloo] : []),
    ...(wall ? [{ href: `#${HIDDEN_WALL_ID}`, label: "Hidden clashes" }] : []),
    { href: `#${WHY_THIS_MATTERS_ID}`, label: "Why this matters" },
    { href: "#board-heading", label: "Timetable" },
    { href: `#${TRY_A_MOVE_ID}`, label: "Try a move" },
    agent,
    { href: `#${SOURCES_ID}`, label: "Sources" },
  ];
}

/**
 * The nav's entry for the agent section, which both labels land on (its heading: the recorded runs sit level
 * with it from 1024 px, and the list itself has no top padding, so a jump to it would land its label under the
 * sticky bar). "Agent runs" once the live agent is known to be off and the day has recorded runs, so the word
 * "agent" is in the first screen; while either answer is still coming it holds the label it will most likely
 * settle on (the agent off, the runs on their way), so the nav does not reflow; "Agent" otherwise.
 */
export function agentJump(
  agentStatus: AgentStatus,
  recordings: { status: "loading" | "ready" | "error"; runs: readonly unknown[] },
): JumpLink {
  const settled = agentStatus !== "checking" && recordings.status !== "loading";
  const recordedRuns = settled
    ? agentStatus === "off" && recordings.runs.length > 0
    : agentStatus !== "on" && (recordings.status === "loading" || recordings.runs.length > 0);
  return { href: "#agent", label: recordedRuns ? "Agent runs" : "Agent" };
}

/** The server's published festival days, in its order, for the agent section: never the invented day. */
export function publishedDays(presets: readonly PresetSummary[]): { id: string; title: string }[] {
  return presets.filter((item) => item.synthetic !== true).map((item) => ({ id: item.id, title: item.title }));
}

/**
 * The entry the nav marks current: the last section whose top is above 40% of the viewport, none at the
 * very top of the page before the first has reached that line; and the last entry once the page is
 * scrolled to its end (within 2 px), since a short last section can never reach that line.
 */
export function currentJump(
  tops: readonly { href: string; top: number | null }[],
  view: { innerHeight: number; scrollY: number; scrollHeight: number },
): string | null {
  if (tops.length > 0 && view.scrollY > 0 && view.innerHeight + view.scrollY >= view.scrollHeight - 2) {
    const last = [...tops].reverse().find((item) => item.top !== null);
    if (last) return last.href;
  }
  const line = view.innerHeight * 0.4;
  let active: string | null = null;
  for (const { href, top } of tops) if (top !== null && top <= line) active = href;
  return active;
}

function JumpNav({ agent, wall, qloo = null }: { agent: JumpLink; wall: boolean; qloo?: JumpLink | null }) {
  // In page order.
  const links = jumpLinks({ agent, wall, qloo });
  const hrefs = links.map((link) => link.href).join("|");
  const [current, setCurrent] = useState<string | null>(null);

  // The section in view (see `currentJump`).
  useEffect(() => {
    const targets = hrefs.split("|").map((href) => ({ href, id: href.slice(1) }));
    let frame = 0;
    function measure() {
      frame = 0;
      const tops = targets.map(({ href, id }) => ({
        href,
        top: document.getElementById(id)?.getBoundingClientRect().top ?? null,
      }));
      setCurrent(
        currentJump(tops, {
          innerHeight: window.innerHeight,
          scrollY: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
        }),
      );
    }
    function schedule() {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    }
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [hrefs]);

  // One marker under the current item, on the bar's hairline. The current item changes as the page scrolls, and
  // nothing on this page moves on scroll, so the marker takes the new item's place at once, with no slide, in
  // every motion setting. Drawn from the measured label, so it spans the word at any font size; hidden when no
  // section is current.
  const listRef = useRef<HTMLUListElement | null>(null);
  const markerRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    const marker = markerRef.current;
    if (!list || !marker) return;
    function place() {
      if (!list || !marker) return;
      const label = current ? list.querySelector<HTMLElement>(`a[href="${current}"] [data-nav-label]`) : null;
      if (!label) {
        marker.style.visibility = "hidden";
        return;
      }
      marker.style.width = `${label.offsetWidth}px`;
      marker.style.transform = `translateX(${label.offsetLeft}px)`;
      marker.style.visibility = "visible";
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [current]);

  // No rule above or below the bar: the opaque paper is its only edge. From 768 px the anchor offset is 82 px:
  // with a section's 80 px top padding, a jump lands its heading about 54 px under the bar's foot (64 px
  // header plus the 44 px bar). Under 768 px the bar does not stick, so the offset is the header's 64 px less 1.
  return (
    <nav
      aria-label="On this page"
      className="z-30 h-11 bg-background max-md:[html:has(&)]:scroll-pt-[3.9375rem] md:sticky md:top-16 md:[html:has(&)]:scroll-pt-[5.125rem]"
    >
      {/* Inside the content column: plain 14 px links, labels only, 44 px tall with 12 px sides (the first
          pulled back so its label starts on the content edge). The current item's 3 px ink marker, its ends
          round, sits at the bar's foot. The current item is ink and semibold (wayfinding is ink, never
          raspberry); no ground. */}
      <ul
        ref={listRef}
        className="container-page relative flex h-full items-center gap-x-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&>li:first-child]:-ml-3"
      >
        {links.map((link) => {
          const on = current === link.href;
          return (
            <li key={link.href}>
              <a
                href={link.href}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "inline-flex h-11 items-center rounded-md px-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  on ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                <span data-nav-label="">{link.label}</span>
              </a>
            </li>
          );
        })}
        <li
          ref={markerRef}
          aria-hidden="true"
          style={{ visibility: "hidden" }}
          className="pointer-events-none absolute bottom-0 left-0 h-[3px] list-none rounded-bar bg-foreground print:hidden"
        />
      </ul>
    </nav>
  );
}

/**
 * The first screen before the interactive page has a festival day: the server's summary of the day when
 * there is one (the server HTML carries it), skeletons otherwise. Its hero is the interactive hero's final
 * frame, drawn from the same model: the festival picker with the same options, the toggle on the moved view,
 * the drawing, the decision group with "Keep this move" in place, and the key, none of them pressable until
 * the interactive view mounts, so the swap changes no box. A summary without its decision (the API had none
 * for the day, or the older API's separate request failed) draws the group's skeleton, which holds the settled
 * group's rows, and the toggle's 44 px room, so the decision moves nothing when the browser's own request
 * brings it. The board's disclosure is the one thing a visitor can already press: `onFoldToggle` and
 * `foldCarryRef` let the interactive board open if it was pressed open here (`carryBoardFold`); `foldInert` keeps
 * the loading fallback's copy from taking a press it could not hand over. A visitor may also scroll here: the
 * frame records where they are as it leaves (`placeRef`, `pagePlace`) and holds the site's footer back while
 * scripts run, so the page that puts three sections before the board keeps the board where they were looking.
 */
function LoadingView({
  intro,
  summary,
  picker,
  status,
  onFoldToggle,
  foldCarryRef,
  foldInert = false,
  placeRef,
}: {
  intro: ReactNode;
  summary: HomeSummary | null;
  picker?: ReactNode;
  status?: ReactNode;
  onFoldToggle?: (open: boolean) => void;
  foldCarryRef?: { current: BoardFoldCarry | null };
  foldInert?: boolean;
  placeRef?: { current: PagePlace | null };
}) {
  // As the frame leaves, while it is still whole: where the visitor is on it, for the page that replaces it in the
  // same commit (`keepPagePlace`). Taken in that commit or never, so nothing stale is left for a later page.
  useLayoutEffect(() => {
    if (!placeRef) return;
    placeRef.current = null;
    return () => {
      placeRef.current = readPagePlace();
      queueMicrotask(() => {
        placeRef.current = null;
      });
    };
  }, [placeRef]);
  const model = summary?.dayGraph ?? null;
  const synthetic = summary?.synthetic === true;
  // The group answers only with the day's decision in hand; without it, its skeleton, never the no-decision words.
  const decided = model !== null && summary?.decisionData != null;
  return (
    <>
      <HeroLayout
        intro={intro}
        day={
          <>
            {picker}
            <HeroDateline model={model} synthetic={synthetic} location={summary?.location} />
            <HeroNote text={model ? heroNote(summary?.decisionData ?? null, synthetic) : null} />
            {model ? <HeroLadderRoom synthetic={synthetic} /> : null}
          </>
        }
        toggle={model ? model.move ? <ViewToggle model={model} view="moved" /> : <ToggleRoom /> : null}
        graph={model ? <DayGraph model={model} view={model.move ? "moved" : "published"} /> : null}
        group={
          <>
            {decided ? (
              <HeroDecision model={model} copy={summary?.decision ?? null} view={model.move ? "moved" : "published"} pending />
            ) : (
              <HeroDecisionSkeleton synthetic={synthetic} />
            )}
            {status}
          </>
        }
        graphKey={model ? <DayGraphKey model={model} className={KEY_CLASS} /> : null}
        reserve
        synthetic={synthetic}
      />
      <BoardFrame label="Timetable">
        {/* The day's score beside the clashes it adds up, where the interactive board puts its dial. */}
        <div className="grid gap-x-10 gap-y-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="min-w-0 max-w-[28rem]">{summary ? <SummaryScore summary={summary} /> : <ScoreSkeleton />}</div>
          {summary ? <SummaryBoard summary={summary} /> : null}
        </div>
        {model ? (
          // The board's disclosure, closed: the server's HTML knows no width. The interactive board that replaces it
          // opens from 1280 px, or as the visitor left this one.
          <BoardFold
            summary={boardFoldSummary(model.sets.length, model.stages.length)}
            onToggle={onFoldToggle}
            carryRef={foldCarryRef}
            inert={foldInert}
            className="mt-8"
          >
            <BoardSkeleton className="mt-6" />
          </BoardFold>
        ) : (
          <BoardSkeleton className="mt-8" />
        )}
      </BoardFrame>
      {/* While scripts run, the site's footer waits for the page: drawn under the frame's board, it would be pushed
          down by the sections the page adds (Try a move, the agent, the sources) under a visitor who scrolled to it.
          With scripts off nothing replaces the frame, and the footer shows. */}
      <div hidden data-frame-end="" className="[@media(scripting:enabled)]:[main:has(&)~footer]:hidden" />
    </>
  );
}

/**
 * The home page's loading fallback: the same first screen as `ClashControl`'s own before the festival day loads. The
 * streamed page swaps it for that one before any script runs (about two frames after the first paint), so its board
 * fold takes no press (`foldInert`): a press there could only be undone by the swap.
 */
export function ClashControlFallback({
  intro,
  summary = null,
}: {
  intro: ReactNode;
  summary?: HomeSummary | null;
}) {
  return (
    <LoadingView
      intro={intro}
      summary={summary}
      picker={<PresetPicker presets={summary?.presets ?? []} selectedId={summary?.id ?? null} />}
      foldInert
    />
  );
}

/** False in the server HTML and true once the page is in the browser, with no state to set in an effect. */
function useInBrowser(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Tailwind's `xl` (1280 px): from there the board's column stands beside the rail, and its fold arrives open. */
export const WIDE_BOARD_QUERY = "(min-width: 80rem)";

/** Whether the screen is 1280 px wide or more now. In the browser only. */
export function readWideBoard(): boolean {
  return window.matchMedia(WIDE_BOARD_QUERY).matches;
}

/** Listens to nothing: a board reads the width once, as it is drawn, and a later change must open or close nothing. */
export function subscribeNothing(): () => void {
  return () => {};
}

/**
 * Whether the screen is 1280 px wide or more, read as the interactive board is drawn. False in the server's render,
 * and in a hydration render, which must match it, so no width reaches the server's HTML. The board view mounts only in
 * the browser, after the festival days load, so its first render reads the real width.
 */
export function useWideBoard(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    readWideBoard,
    () => false,
  );
}

/** A festival day the page can draw whole: its saved preset and the decision its hero reads. */
export type DrawnDay = { preset: Preset; decision: Decision | null };

/**
 * The festival day the page draws. The chosen day once the page holds its preset and its decision (`decision`
 * is undefined while that is not known), so a day switch redraws the hero, its drawing and the sections under
 * it in one frame; until then the day already drawn, held whole with its picker, so no frame shows a skeleton,
 * a half-drawn hero or one day under another's tab. The first day drawn needs only its preset: its view reads
 * the server's decision or asks for one, as it always has. Null before any day can be drawn.
 */
export function dayToDraw(
  chosen: Preset | null,
  decision: Decision | null | undefined,
  drawn: DrawnDay | null,
): DrawnDay | null {
  if (chosen === null || chosen.id === drawn?.preset.id) return drawn;
  if (decision === undefined && drawn !== null) return drawn;
  return { preset: chosen, decision: decision ?? null };
}

/**
 * Another festival day's saved preset and decision, read ahead so that choosing it redraws at once: a GET of
 * the saved preset, whose response carries the day's decision (`carriedDecision`), and no Qloo request. Only a
 * response without that field (an API that predates it) is followed by `GET /decision` (which takes no what-if
 * slot). Null on any failure; `known` is false when no decision came back (the switch then asks for it) and true
 * when the decision, or the answer that there is none, is in hand.
 */
async function readDayAhead(id: string, signal: AbortSignal): Promise<(DrawnDay & { known: boolean }) | null> {
  try {
    const response = await fetch(`/api/presets/${encodeURIComponent(id)}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    const preset = parsePreset(raw);
    const day = decisionDay(preset);
    const carried = carriedDecision(raw);
    const decision = carried === undefined ? await requestDecision(preset.id, day, signal) : carried;
    const known = carried !== undefined || decision !== null;
    return { preset, decision: decision && decision.day === day ? decision : null, known };
  } catch {
    return null;
  }
}

/**
 * The landing screen: loads the preset festival days, lets the visitor pick one, and shows its
 * Clash Budget Index and coverage, the priced timetable with the costliest clashes, "Try a move"
 * (every legal place for a set, priced, with no language model), the agent (live or recorded runs),
 * the hidden-clash examples and the twin card.
 */
export function ClashControl({
  intro,
  summary = null,
}: {
  intro: ReactNode;
  summary?: HomeSummary | null;
}) {
  // The loading line is for a visitor waiting in the browser. Left out of the server HTML, it cannot
  // linger in the hidden streaming fallback and read as stale once the day has loaded.
  const inBrowser = useInBrowser();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("preset");
  const { list, preset, selectedId, retry } = usePresets(requestedId);
  // Asked once per page, alongside the presets, so the hero and the agent panel already know
  // whether the live agent is on when the festival day first renders.
  const agentStatus = useAgentStatus();
  // The board fold's state, handed from each fold to the one that replaces it (`carryBoardFold`): the server's
  // frame to the interactive board, and one festival day's board to the next. `foldReport` is what the fold on the
  // page last reported (a press, or the open state a board was drawn in), so the next board is drawn in it; null until
  // a fold reports, and the board then starts from the width (`boardStartsOpen`). The carrier holds what the page
  // showed at the swap. The setter goes to every fold as it is: React keeps it the same, so a fold's ref runs once.
  const [foldReport, setFoldReport] = useState<boolean | null>(null);
  const foldCarryRef = useRef<BoardFoldCarry | null>(null);
  // Where a visitor who scrolled on the server's frame was when it left (`pagePlace`), kept on the page that
  // replaced it in the same commit, before the browser paints. This effect runs after every child's, once the page
  // is whole (its board fold carried open, if it was pressed open).
  const pagePlaceRef = useRef<PagePlace | null>(null);
  useLayoutEffect(() => {
    const place = pagePlaceRef.current;
    if (place === null) return;
    pagePlaceRef.current = null;
    keepPagePlace(place);
  });

  // Other festival days read ahead (`readDayAhead`), and the decisions of days chosen before their read ahead
  // landed, by preset id; and the day drawn now (`dayToDraw`).
  const [ahead, setAhead] = useState<Record<string, Preset>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision | null>>({});
  const [drawn, setDrawn] = useState<DrawnDay | null>(null);
  const chosenId = list.status === "ready" ? selectedId : null;
  const chosen =
    chosenId === null
      ? null
      : drawn !== null && drawn.preset.id === chosenId
        ? drawn.preset
        : (ahead[chosenId] ?? (preset.status === "ready" ? preset.value : null));
  // What the page knows of the chosen day's decision: the server's (in its HTML), one read ahead or fetched, or
  // null in mock mode, which has no route; undefined while it is not known.
  const chosenDecision =
    chosen === null
      ? undefined
      : MOCK_STREAM_ENABLED
        ? null
        : summary !== null && summary.id === chosen.id && summary.decisionData !== null
          ? summary.decisionData
          : Object.hasOwn(decisions, chosen.id)
            ? decisions[chosen.id]
            : undefined;
  const shown = dayToDraw(chosen, chosenDecision, drawn);
  if (shown !== drawn) setDrawn(shown);
  // Another day is chosen and on its way: the day drawn stays whole, its picker included, until it is replaced.
  const holding = shown !== null && chosenId !== null && chosenId !== shown.preset.id;

  // A day chosen before its read ahead landed: its decision, so it can be drawn whole.
  const waitingId = holding && chosen !== null && chosenDecision === undefined ? chosen.id : null;
  const waitingDay = chosen !== null ? decisionDay(chosen) : 0;
  useEffect(() => {
    if (waitingId === null) return;
    const controller = new AbortController();
    void requestDecision(waitingId, waitingDay, controller.signal).then((decision) => {
      if (controller.signal.aborted) return;
      setDecisions((previous) => ({ ...previous, [waitingId]: decision && decision.day === waitingDay ? decision : null }));
    });
    return () => controller.abort();
  }, [waitingId, waitingDay]);

  // Once a day is drawn and the browser is idle, every other day of the list is read ahead, each once per page
  // (a day already drawn never is). Not in mock mode, which serves one day with no network.
  const listIds = list.status === "ready" ? list.value.map((item) => item.id).join("|") : "";
  const drawnId = shown?.preset.id ?? null;
  const begun = useRef(new Set<string>());
  useEffect(() => {
    if (drawnId === null || listIds === "" || MOCK_STREAM_ENABLED) return;
    const started = begun.current;
    started.add(drawnId);
    const wanted = listIds.split("|").filter((id) => !started.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) started.add(id);
    const open = new Set(wanted);
    const controller = new AbortController();
    const start = () => {
      for (const id of wanted) {
        void readDayAhead(id, controller.signal).then((day) => {
          if (controller.signal.aborted) return;
          open.delete(id);
          if (!day) return;
          setAhead((previous) => ({ ...previous, [id]: day.preset }));
          const decision = day.decision;
          if (day.known) setDecisions((previous) => (Object.hasOwn(previous, id) ? previous : { ...previous, [id]: decision }));
        });
      }
    };
    const idle = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(start, { timeout: 4000 }) : null;
    const timer = idle === null ? window.setTimeout(start, 1000) : null;
    return () => {
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timer !== null) window.clearTimeout(timer);
      controller.abort();
      // A day not read yet is read by the next run.
      for (const id of open) started.delete(id);
    };
  }, [drawnId, listIds]);

  // A new festival day remounts the whole view, its day tabs included, so a tab chosen with the arrow keys
  // (or a press) would leave focus on the page. The chosen tab takes focus back in each new tree (the
  // loading view's or the held day's, then the new day's), until the day itself is on screen.
  const pickerFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pickerFocus.current;
    if (!id) return;
    const tab = [...document.querySelectorAll<HTMLInputElement>(`[role="radiogroup"][aria-label="${PRESET_PICKER_LABEL}"] input[type="radio"]`)].find(
      (input) => input.value === id,
    );
    if (tab && document.activeElement !== tab) tab.focus({ preventScroll: true });
    if (tab && shown !== null && shown.preset.id === id) pickerFocus.current = null;
  });

  // The native history API keeps `useSearchParams` in sync without a server round trip, so
  // switching festival days needs nothing but the preset data itself.
  function choosePreset(id: string) {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.closest(`[aria-label="${PRESET_PICKER_LABEL}"]`)) pickerFocus.current = id;
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", id);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  // A failed list, or a failed day with no copy of it read ahead.
  const error = list.status === "error" ? list.error : preset.status === "error" && chosen === null ? preset.error : null;
  if (error) {
    return (
      <HeroLayout
        intro={intro}
        group={
          <ErrorState
            title="Could not load the timetable"
            titleAs="h2"
            message={error.message}
            retryable={error.retryable}
            onRetry={() => {
              retry();
              // The retry button goes away while the data reloads; keep focus on the page.
              document.getElementById("pitch-heading")?.focus();
            }}
          />
        }
      />
    );
  }

  if (list.status === "ready" && list.value.length === 0) {
    return (
      <HeroLayout
        intro={intro}
        group={
          <AbstainState
            title="No festival days to show yet"
            reason="This server has no scored festival days. A day appears here once its published timetable has been scored against Qloo audience data."
          />
        }
      />
    );
  }

  if (shown === null || list.status !== "ready") {
    // The server's summary is shown only while the day it describes is the one being loaded.
    const loadingId = selectedId ?? requestedId ?? summary?.id ?? null;
    return (
      <LoadingView
        intro={intro}
        summary={summary && summary.id === loadingId ? summary : null}
        onFoldToggle={setFoldReport}
        foldCarryRef={foldCarryRef}
        placeRef={pagePlaceRef}
        status={
          inBrowser ? (
            <p role="status" className="sr-only">
              Loading the festival day.
            </p>
          ) : null
        }
        picker={
          list.status === "ready" ? (
            <PresetPicker presets={list.value} selectedId={selectedId} onChange={choosePreset} />
          ) : (
            // Until the list is in, the server's own list, drawn in place and not yet pressable.
            <PresetPicker presets={summary?.presets ?? []} selectedId={summary?.id ?? null} />
          )
        }
      />
    );
  }

  return (
    <PresetView
      key={shown.preset.id}
      intro={intro}
      preset={shown.preset}
      agentStatus={agentStatus}
      serverDecision={shown.decision}
      presets={list.value}
      loading={holding}
      foldReport={foldReport}
      onBoardToggle={setFoldReport}
      foldCarryRef={foldCarryRef}
      // The picker names the day drawn: while another is on its way it stays on this one.
      picker={<PresetPicker presets={list.value} selectedId={shown.preset.id} onChange={choosePreset} />}
    />
  );
}

/** The festival-day tabs' group name, which also finds them again after a day change remounts the view. */
const PRESET_PICKER_LABEL = "Festival day";

/**
 * The festival days, as the hero's picker: one option per day, named by its festival (`festivalLabel`); the
 * dateline under it names the day. Without `onChange` (before the interactive view mounts) it is drawn in
 * place but not yet pressable. Nothing with fewer than two days.
 */
function PresetPicker({
  presets,
  selectedId,
  onChange,
  className,
}: {
  presets: readonly PresetSummary[];
  selectedId: string | null;
  onChange?: (id: string) => void;
  className?: string;
}) {
  if (presets.length < 2) return null;
  return (
    <SegmentedControl
      label={PRESET_PICKER_LABEL}
      size="sm"
      value={selectedId}
      onValueChange={onChange ?? (() => {})}
      pending={!onChange}
      options={presets.map((item) => ({
        value: item.id,
        label: festivalLabel(item.title),
        description: item.city ?? undefined,
      }))}
      className={className}
    />
  );
}

/** Sourced examples saved with another festival day, and that day's title. */
type BorrowedWall = { forId: string; evidence: Evidence; title: string };

/**
 * Whether a day shows another day's sourced hidden-clash examples: only a published day with none of its own.
 * Never the invented day, which credits nothing to Qloo, and never in mock mode.
 */
export function borrowsWall(preset: Pick<Preset, "evidence" | "synthetic">, mock: boolean = MOCK_STREAM_ENABLED): boolean {
  const own = (preset.evidence?.hidden_wall.length ?? 0) > 0;
  return !own && preset.synthetic !== true && !mock;
}

/** The published days a day may read examples from, in the server's order: never itself, never the invented day. */
export function wallLenders(presets: readonly PresetSummary[], id: string): string[] {
  return presets.filter((item) => item.id !== id && item.synthetic !== true).map((item) => item.id);
}

/**
 * The hidden-clash examples are cross-festival (each names its own festival and day), but a build saves
 * them with one festival day. A published day with none of its own shows another published day's, read
 * from the saved preset (a GET of a saved file: no Qloo request), labelled with the day they are saved with
 * (`wallCount`). Skipped as `borrowsWall` says. Null until found, or when no day has any.
 */
function useBorrowedWall(presets: readonly PresetSummary[], preset: Preset): BorrowedWall | null {
  const skip = !borrowsWall(preset);
  const [found, setFound] = useState<BorrowedWall | null>(null);
  const others = wallLenders(presets, preset.id).join("|");
  useEffect(() => {
    if (skip || others === "") return;
    const controller = new AbortController();
    const forId = preset.id;
    void (async () => {
      for (const id of others.split("|")) {
        try {
          const response = await fetch(`/api/presets/${encodeURIComponent(id)}`, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          });
          if (!response.ok) continue;
          const other = parsePreset(await response.json());
          if (controller.signal.aborted) return;
          if (other.synthetic !== true && other.evidence && other.evidence.hidden_wall.length > 0) {
            setFound({ forId, evidence: other.evidence, title: other.title });
            return;
          }
        } catch {
          if (controller.signal.aborted) return;
        }
      }
    })();
    return () => controller.abort();
  }, [skip, others, preset.id]);
  return !skip && found !== null && found.forId === preset.id ? found : null;
}

type Highlight = { kind: "set"; id: string } | { kind: "clash"; key: string } | null;

type DrawerState = { clash: PairClash | null; open: boolean; trigger: HTMLElement | null };

function PresetView({
  intro,
  preset,
  agentStatus,
  serverDecision,
  presets,
  picker,
  loading = false,
  foldReport = null,
  onBoardToggle,
  foldCarryRef,
}: {
  intro: ReactNode;
  preset: Preset;
  agentStatus: AgentStatus;
  /** The decision the page already holds for this preset's first day, so the card needs no request. */
  serverDecision: Decision | null;
  /** Every festival day the server has, so a day with no hidden-clash examples can show another's. */
  presets: readonly PresetSummary[];
  picker: ReactNode;
  /** Another festival day is chosen and on its way to replace this one. */
  loading?: boolean;
  /**
   * What the board fold on the page last reported (open or closed: a press, or the state a board was drawn in), so
   * this view's board starts the same way; null before any fold has reported, when the width decides.
   */
  foldReport?: boolean | null;
  /** Told each time the board's fold opens or closes, so the next festival day's board starts the same way. */
  onBoardToggle?: (open: boolean) => void;
  /** The page's board-fold carrier: the fold this view's board replaces left its state there (`carryBoardFold`). */
  foldCarryRef?: { current: BoardFoldCarry | null };
}) {
  const days = useMemo(() => daysWithSets(preset), [preset]);
  const [day, setDay] = useState(days[0] ?? 0);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [drawer, setDrawer] = useState<DrawerState>({ clash: null, open: false, trigger: null });
  // The tested plan from "Try a move", previewed on the grid as ghosts. Never changes the dial.
  const [planPreview, setPlanPreview] = useState<PlanPreview | null>(null);
  // A change from "Keep two sets apart", previewed as two ghosts. Separate from the plan above.
  const [rulePreview, setRulePreview] = useState<RulePreview | null>(null);
  // The board's disclosure (round 39, W2). On arrival it is as the fold this board replaces was left (its report: a
  // press, also one made on the server's frame, or the open state the last festival day's board was drawn in), else
  // open on a screen of 1280 px or more and closed below (`boardStartsOpen`). That is read once, in this board's first
  // render, never in an effect: crossing 1280 px later opens or closes nothing. After that it opens on a press on its
  // summary (the fold it replaces also hands over a press made in the swap's own frame, `carryBoardFold`), or with the
  // visitor's own preview (a tested place in Try a move, a change from Keep two sets apart) the moment one first shows.
  // That is latched here, while rendering, so the disclosure is open in the same commit in which the grid scrolls the
  // preview into view (its effect runs after that commit). It closes only on a press.
  const wide = useWideBoard();
  const [boardOpen, setBoardOpen] = useState(() => boardStartsOpen(foldReport, wide));
  const toggleBoard = useCallback(
    (open: boolean) => {
      setBoardOpen(open);
      onBoardToggle?.(open);
    },
    [onBoardToggle],
  );
  const preview = planPreview ?? rulePreview;
  const [previewSeen, setPreviewSeen] = useState<PlanPreview | RulePreview | null>(null);
  if (preview !== previewSeen) {
    setPreviewSeen(preview);
    if (preview !== null) setBoardOpen(true);
  }
  // The board's fold sits above Try a move. When a tested place opens it while the visitor is at that section or past
  // it, the opened board (about 1,200 px at 1440) would carry what they just pressed down the page, out of view: the
  // browser's scroll anchoring picks the fold's own summary when it is the first thing on screen (under the sticky
  // bars), and a summary does not move when its disclosure opens. So, as the plan arrives and while the fold is still
  // closed, the board's section is taken out of anchor selection for that one commit; the browser then anchors on Try a
  // move and keeps it where it was, before paint, and nothing on screen moves. Where a browser has no scroll anchoring
  // the page is scrolled by however far the section moved instead. A plan that arrives while the section is below the
  // screen (a Keep pressed in the hero) moves nothing on screen and is left alone, a press on the fold's own summary is
  // never touched, and a rule's preview keeps its own scroll to the board. This never opens or closes the fold. Only a
  // new plan notes a place (the plan state changes, so the commit that reads the note always follows it).
  const placeHold = useRef<{ top: number; board: HTMLElement | null } | null>(null);
  const lastPlan = useRef<PlanPreview | null>(null);
  // Notes where Try a move is before the fold opens over it, when it is on screen and the fold is still closed.
  const holdPlace = useCallback((opening: boolean) => {
    const fold = document.querySelector<HTMLDetailsElement>("details[data-board-fold]");
    const top = document.getElementById(TRY_A_MOVE_ID)?.getBoundingClientRect().top;
    if (opening && fold !== null && !fold.open && top !== undefined && top < window.innerHeight) {
      const board = fold.closest<HTMLElement>("section");
      if (board) board.style.overflowAnchor = "none";
      placeHold.current = { top, board };
    } else placeHold.current = null;
  }, []);
  // A pressed-for tested place that has not landed yet: the inline key lists the tested slot from the press, so the
  // key's row does not wrap anew above Try a move when a late answer draws the slot. Cleared when a tested place shows.
  const [placeComing, setPlaceComing] = useState(false);
  const changePlan = useCallback(
    (plan: PlanPreview | null) => {
      const fresh = plan !== lastPlan.current;
      lastPlan.current = plan;
      if (fresh) holdPlace(plan !== null);
      if (fresh && plan !== null) setPlaceComing(false);
      setPlanPreview(plan);
    },
    [holdPlace],
  );
  // A press for a set's places in Try a move opens the fold at once, in the press, the same way: its tested place is
  // coming, and an answer that lands after the browser's 500 ms input window would otherwise open the fold then, and
  // the slice of the opened board that enters the top of the screen would count as a shift no one asked for.
  const pickPress = useCallback(() => {
    holdPlace(true);
    setBoardOpen(true);
    setPlaceComing(true);
  }, [holdPlace]);
  useLayoutEffect(() => {
    const hold = placeHold.current;
    if (hold === null) return;
    placeHold.current = null;
    const top = document.getElementById(TRY_A_MOVE_ID)?.getBoundingClientRect().top;
    if (top !== undefined && Math.abs(top - hold.top) > 0.5) window.scrollBy({ top: top - hold.top, behavior: "instant" });
    if (hold.board) hold.board.style.overflowAnchor = "";
  });
  // The decision card's buttons hand "Try a move" a seed (a move, or line 3's change as one step); a
  // new nonce replays it, the same one never does.
  // An agent run's tested place reaches the plan the same way, marked as the agent's (`from`).
  const [seedStep, setSeedStep] = useState<SeedStep | null>(null);
  const [seedRule, setSeedRule] = useState<{ nonce: number; aId: string; bId: string } | null>(null);
  // The steps the plan holds now (priced by the engine), reported by "Try a move", so the decision card and the
  // agent panel say "Kept" only for what the plan really holds.
  const [keptSteps, setKeptSteps] = useState<readonly StackStep[]>([]);
  // What the hero's drawing shows: the moved view first, on every day and every festival day (a new festival
  // day remounts this view; a new day resets it).
  const [view, setView] = useState<GraphView>("moved");

  const { festival, report } = preset;
  const synthetic = preset.synthetic === true;
  const dayLabel = festival.days[day] ?? `Day ${day + 1}`;
  const views = useMemo(() => buildSetViews(preset, day), [preset, day]);
  const ranked = useMemo(() => topClashes(report.clashes, day, Number.POSITIVE_INFINITY), [report, day]);
  const links = useMemo(() => ranked.slice(0, TOP_LINKS), [ranked]);
  const slots = useMemo(() => new Map(festival.timetable.map((slot) => [slot.act_id, slot])), [festival]);
  const stages = useMemo(() => new Map(festival.stages.map((stage) => [stage.id, stage])), [festival]);
  const allCalls = useMemo(() => traceToolCalls(preset.requests, preset.id), [preset]);
  const reach = useMemo(() => describeReach(samplingReach(festival.timetable)), [festival]);
  const isLocked = useMemo(() => {
    const locked = new Set(festival.timetable.filter((slot) => slot.locked).map((slot) => slot.act_id));
    return (actId: string) => locked.has(actId);
  }, [festival]);
  // Whether the shown day's locked sets are exactly the last set on each stage, so the board's key may say so.
  const holds = useMemo(
    () =>
      lockRuleHolds(
        festival.timetable
          .filter((slot) => slot.day === day)
          .map((slot) => ({ stage: slot.stage_id, day: slot.day, start: slot.start, end: slot.end, locked: slot.locked })),
      ),
    [festival, day],
  );
  const hero = useMemo(() => heroClash(ranked, preset.evidence, isLocked), [ranked, preset.evidence, isLocked]);
  // The share of the day's cost that sits between two locked sets, over every ranked clash.
  const fixedShare = useMemo(
    () => ranked.filter((clash) => isFixedByLocks(clash, isLocked)).reduce((sum, clash) => sum + clash.regret_share, 0),
    [ranked, isLocked],
  );
  const recordings = useRecordings(preset.id);
  const twins = preset.evidence?.twins ?? [];
  // The day's clashes that carry the Hidden label, from the ranked list the board draws its marks from.
  // `hiddenClashes.length` is the one Hidden-label count for the day: the board's, the section's and the
  // hero card's.
  const hiddenClashes = useMemo(() => ranked.filter((clash) => clash.label === "hidden"), [ranked]);
  const hiddenDay = useMemo<HiddenDay>(
    () => ({
      ranked: ranked.length,
      hidden: hiddenClashes.map((clash) => ({ rank: clash.rank, a: clash.a.name, b: clash.b.name })),
    }),
    [ranked.length, hiddenClashes],
  );
  // The examples: the day's own, else another published day's.
  const borrowed = useBorrowedWall(presets, preset);
  const wallEvidence = (preset.evidence?.hidden_wall.length ?? 0) > 0 ? preset.evidence : (borrowed?.evidence ?? null);
  // The section, and its jump entry, are on every day with ranked clashes: the label's definition and the
  // day's count stand without examples.
  const hasWall = ranked.length > 0 || (wallEvidence?.hidden_wall.length ?? 0) > 0;
  const index = report.metrics.clash_budget_index;
  const decisionState = useDecision(preset.id, day, serverDecision);
  const decisionCopy = useMemo(
    () => (decisionState.status === "ready" ? buildDecisionCopy(preset, decisionState.decision) : null),
    [preset, decisionState],
  );
  // The hero's drawing of the day, from the same decision the hero group reads, built as the server summary
  // builds its final frame (`buildDayGraph`). Without a move it can only show the day as published.
  const decision = decisionState.status === "ready" ? decisionState.decision : null;
  const model = useMemo(() => buildDayGraph(preset, decision, day), [preset, decision, day]);
  const shownView: GraphView = model?.move ? view : "published";
  // What the plan already holds of the card: its move and line 3's change, so the buttons can say so.
  const seedMove = decisionCopy?.seedMove ?? null;
  const seedChange = decisionCopy?.seedChange ?? null;
  const cardKept = useMemo(
    () => ({
      move: seedMove !== null && keptSteps.some((step) => !isRuleStackStep(step) && sameStep(step, seedMove)),
      change: seedChange !== null && keptSteps.some((step) => sameStep(step, seedChange)),
    }),
    [seedMove, seedChange, keptSteps],
  );
  const lenses = useLenses(preset.id, day);
  // A tested plan or a rule change is drawn on the board: the key must say the lines are the published timetable's.
  const planShown = planPreview !== null || rulePreview !== null;
  const sharedPairs = useMemo(() => concurrentPairs(preset, day), [preset, day]);
  // The card's clash, for its three readings; only while the card is for the day on show.
  const decisionClash =
    decisionState.status === "ready" && decisionState.decision.day === day ? decisionState.decision.clash : null;
  // The card's move for Try a move, with the card's pair: "Start with" lists its two sets, and "Keep two sets
  // apart" opens on it.
  const cardMove = useMemo(
    () =>
      decisionCopy?.seedMove && decisionCopy.moveReceipt
        ? {
            move: decisionCopy.seedMove,
            receipt: decisionCopy.moveReceipt,
            pair: decisionClash ? { aId: decisionClash.aId, bId: decisionClash.bId } : null,
          }
        : null,
    [decisionCopy, decisionClash],
  );
  const lensRank = useMemo(() => drawerRank(lenses), [lenses]);
  // The hero's ladder: the card's clash ranked three ways, read as "What Qloo changes" reads it, once the lens data
  // is in; until then the hero holds the ladder's room empty.
  const heroLadder = useMemo(
    () => (decisionClash && lenses ? threeReadings(lenses, sharedPairs, decisionClash.aId, decisionClash.bId) : null),
    [decisionClash, lenses, sharedPairs],
  );
  const actName = (id: string) => festival.acts.find((act) => act.id === id)?.name ?? id;
  const agentLink = agentJump(agentStatus, recordings);
  // The published days, for the agent section's pointer to the run that asked Qloo, from the list this page
  // already holds (no second fetch of the list).
  const published = useMemo(() => publishedDays(presets), [presets]);

  const { activeSetIds, activeClashKeys } = useMemo(() => {
    const setIds = new Set<string>();
    const clashKeys = new Set<string>();
    if (highlight?.kind === "set") {
      setIds.add(highlight.id);
      for (const clash of ranked) {
        if (!involves(clash, highlight.id)) continue;
        clashKeys.add(clashKey(clash));
        setIds.add(partnerOf(clash, highlight.id).act_id);
      }
    } else if (highlight?.kind === "clash") {
      clashKeys.add(highlight.key);
      const clash = ranked.find((item) => clashKey(item) === highlight.key);
      if (clash) {
        setIds.add(clash.a.act_id);
        setIds.add(clash.b.act_id);
      }
    }
    return { activeSetIds: setIds, activeClashKeys: clashKeys };
  }, [highlight, ranked]);

  function openClash(clash: PairClash, trigger: HTMLElement | null) {
    setDrawer((previous) => ({ clash, open: true, trigger: previous.open ? previous.trigger : trigger }));
  }
  // The card's pair among the day's ranked clashes, so its re-check opens that pair's existing drawer.
  const decisionPair = decisionClash
    ? (ranked.find(
        (clash) =>
          (clash.a.act_id === decisionClash.aId && clash.b.act_id === decisionClash.bId) ||
          (clash.a.act_id === decisionClash.bId && clash.b.act_id === decisionClash.aId),
      ) ?? null)
    : null;
  // The hidden-clash line's facts, only while the card is for the day on show: the board's own Hidden
  // count for that day, and the card pair's two saved main genres (in the card's own order).
  const cardHiddenCount = decisionClash ? hiddenClashes.length : undefined;
  const cardGenres = decisionClash
    ? [decisionClash.aId, decisionClash.bId].map((id) => festival.acts.find((act) => act.id === id)?.genre ?? null)
    : null;
  // The card's clash action: the pair its hidden-clash line describes when it has that line, else the day's hero
  // clash (`cardClashAction`).
  const cardAction = cardClashAction(hero, decisionPair, decisionCopy !== null && isHiddenDecision(decisionCopy));

  // The decision's buttons, in the hero and in the index card under it: each hands "Try a move" a seed, so
  // Keep, Add and Replace write the real plan.
  const openMove = decisionCopy?.seedMove
    ? (choice?: PlanChoice) => {
        const move = decisionCopy.seedMove;
        if (!move) return null;
        const note = choice?.mode === "add" ? null : replacedNote(keptSteps, move);
        setSeedStep((previous) => ({
          nonce: (previous?.nonce ?? 0) + 1,
          step: move,
          from: "card",
          ...(choice ?? {}),
        }));
        return note;
      }
    : undefined;
  const tryRule = decisionCopy?.seedRule
    ? () => {
        const rule = decisionCopy.seedRule;
        if (rule) setSeedRule((previous) => ({ nonce: (previous?.nonce ?? 0) + 1, ...rule }));
      }
    : undefined;
  const keepChange = decisionCopy?.seedChange
    ? () => {
        const change = decisionCopy.seedChange;
        if (!change) return null;
        const note = replacedNote(keptSteps, change);
        setSeedStep((previous) => ({ nonce: (previous?.nonce ?? 0) + 1, step: change, from: "card" }));
        return note;
      }
    : undefined;
  const loadingDecision = decisionState.status === "loading";
  const heroGroup = loadingDecision ? (
    <HeroDecisionSkeleton synthetic={synthetic} />
  ) : model ? (
    <HeroDecision
      model={model}
      copy={decisionCopy}
      view={shownView}
      onOpenMove={openMove}
      plan={keptSteps}
      kept={cardKept}
      ladder={heroLadder}
    />
  ) : null;

  return (
    <>
      <HeroLayout
        intro={intro}
        day={
          <>
            {picker}
            <HeroDateline model={model} synthetic={synthetic} location={preset.location} />
            <HeroNote text={model ? heroNote(decision, synthetic) : null} />
            {model ? <HeroLadderRoom readings={heroLadder} synthetic={synthetic} /> : null}
          </>
        }
        toggle={
          model?.move ? (
            <ViewToggle model={model} view={view} onChange={setView} />
          ) : model ? (
            // The toggle's room while the day's decision loads, and after it if there is no move, so the drawing
            // does not jump when a decision comes or does not.
            <ToggleRoom />
          ) : null
        }
        graph={model ? <DayGraph model={model} view={shownView} /> : null}
        group={
          heroGroup || loading ? (
            <>
              {heroGroup}
              {loading ? (
                <p role="status" className="sr-only">
                  Loading the festival day.
                </p>
              ) : null}
            </>
          ) : null
        }
        graphKey={model ? <DayGraphKey model={model} className={KEY_CLASS} /> : null}
        busy={loading}
        reserve={heroGroup !== null}
        synthetic={synthetic}
      />

      <JumpNav
        agent={agentLink}
        wall={hasWall}
        // The section is always on the page (its failed test needs no lens data), so its entry is there from the
        // first frame: an entry that waited for the readings would push the others along when they came.
        qloo={{ href: `#${WHAT_QLOO_ID}`, label: whatChangesTitle(synthetic) }}
      />

      {/* Under the nav, in HOME_ORDER: what Qloo changes for the card's clash, the hidden-clash examples, why
          this matters, the timetable, Try a move, the agent's runs and the sources. */}
      <HomeSections
        qloo={
          // What Qloo changes for the card's clash, the equal-popularity pairs and the two rankings of the
          // day, closed by the failed test. Always rendered, so the failed test is there with no lens data.
          <TasteSection
            clash={
              decisionClash
                ? {
                    aId: decisionClash.aId,
                    bId: decisionClash.bId,
                    aName: actName(decisionClash.aId),
                    bName: actName(decisionClash.bId),
                  }
                : null
            }
            lenses={lenses}
            pairs={sharedPairs}
            twins={twins}
            acts={festival.acts}
            ranked={ranked}
            onOpen={openClash}
            synthetic={synthetic}
            aside={
              // The index card: the Clash Budget Index with its scale and attribution, the hidden-clash line,
              // the working and the secondary actions, under the claim and its limits.
              decisionCopy ? (
                <DecisionDetails
                  copy={decisionCopy}
                  kept={cardKept}
                  onTryRule={tryRule}
                  onKeepChange={keepChange}
                  onOpenHidden={cardAction ? (trigger) => openClash(cardAction.clash, trigger) : undefined}
                  hiddenLabel={cardAction?.label}
                  saved={
                    preset.synthetic || preset.built_at === null
                      ? null
                      : { builtAt: preset.built_at, requests: preset.requests.length }
                  }
                  onOpenPair={decisionPair ? (trigger) => openClash(decisionPair, trigger) : undefined}
                  hiddenCount={cardHiddenCount}
                  rankedCount={decisionClash ? ranked.length : undefined}
                  genres={cardGenres}
                />
              ) : null
            }
          />
        }
        wall={
          <HiddenWall
            evidence={wallEvidence}
            synthetic={synthetic}
            day={ranked.length > 0 ? hiddenDay : null}
            savedWith={borrowed ? borrowed.title : null}
          />
        }
        why={
          // The problem, the pilot and what is not known, after the hidden clashes and before the board.
          <WhyThisMatters />
        }
        board={
          <BoardFrame labelledBy="board-heading">
            {/* One header block: the dateline and heading on the left; on the right "How Qloo was used",
                right-aligned from 1024 px and at the left on a phone (the festival picker is the hero's). 32 px
                of paper under it (no rule), then the board's 24 px. */}
            <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <div className="min-w-0">
                <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
                  {synthetic ? "Invented timetable" : "Published timetable"} · {preset.title}
                  {festival.city ? `, ${festival.city}` : ""}
                </p>
                <h2 id="board-heading" className="type-title mt-1.5 scroll-mt-16 md:scroll-mt-26">
                  Where the clashes fall: {festival.stages.length} stages, {views.length} sets
                </h2>
              </div>
              <div className="flex min-w-0 flex-col items-start gap-2 lg:items-end">
                <TraceDrawer
                  toolCalls={allCalls}
                  mode="recorded"
                  triggerVariant="ink"
                  hideIcon
                  triggerClassName="min-h-11 text-[0.8125rem] font-semibold lg:min-h-6"
                  triggerLabel={usedTitle(preset.synthetic === true)}
                  title={usedTitle(preset.synthetic === true)}
                  synthetic={preset.synthetic === true}
                  description={boardTraceDescription(preset.synthetic === true, preset.title)}
                  footnote={`Preset ${preset.id}${preset.built_at ? ` · built ${preset.built_at.slice(0, 10)}` : ""}`}
                />
              </div>
            </div>
          
            {days.length > 1 ? (
              <SegmentedControl
                label="Day"
                size="sm"
                variant="tabs"
                value={String(day)}
                onValueChange={(value) => {
                  setDay(Number(value));
                  setHighlight(null);
                  setView("moved");
                }}
                options={days.map((index) => ({ value: String(index), label: festival.days[index] ?? `Day ${index + 1}` }))}
                className="mt-4"
              />
            ) : null}
          
            {/* From 1280 px up the rail holds the day's score above the costliest clashes, so the stage
                headers start right under coverage and the key. Below that the rail dissolves into the column
                (display: contents) and the score comes last, after the board: under 768 px the board leads,
                then the costliest clashes; from 768 px the costliest clashes lead, then the board. The score
                holds nothing focusable, and from 768 px the list and the board keep their source order. */}
            <div className="mt-6 grid gap-10 xl:grid-cols-[18rem_minmax(0,1fr)] xl:gap-10">
              {/* From 1280 px up the whole rail is sticky (below the site header and jump bar) and scrolls on
                  its own when taller than the screen, so it travels beside the grid instead of leaving blank.
                  There it holds the score and the costliest clashes under one 1px rule (their own surfaces
                  drop at that width). The scroll box reaches 12 px past the column on each side and pads it back,
                  so its content, and the rule drawn by the one wrapper inside it, start on the section's gutter
                  while the focus rings keep their room inside the clip. Below 1280 px both dissolve and each
                  child keeps its own surface. */}
              <div className="min-w-0 max-xl:contents xl:sticky xl:top-31 xl:max-h-[calc(100dvh-8.75rem)] xl:self-start xl:overflow-y-auto xl:overscroll-contain xl:-mx-3 xl:scroll-py-1 xl:px-3 xl:pb-1">
                <div className="flex min-w-0 flex-col gap-10 max-xl:contents xl:gap-6 xl:border-t xl:border-border xl:pt-6">
                {/* Below 1280 px the score is drawn after the board and, under 768 px, so is the list, though both come
                    first in the source. The browser's scroll anchoring walks the source, so either could be picked as
                    the anchor while it shows under a closed board, and a press on the board's summary would then
                    scroll the page down by the opened board (about 1,800 px on a phone): the summary left the screen.
                    Out of anchor selection where they are drawn after the board, the summary anchors itself and the
                    board opens under it. */}
                <Scorecard className="order-3 max-w-[28rem] max-xl:[overflow-anchor:none] xl:order-1 xl:max-w-none">
                  <BudgetDial index={index} baseline={report.baseline} reach={reach} compact synthetic={synthetic} />
                </Scorecard>
                <div className="order-2 min-w-0 max-md:[overflow-anchor:none] md:order-1 xl:order-2">
                  <ClashList
                    clashes={links}
                    slots={slots}
                    stages={stages}
                    totalRanked={ranked.length}
                    fixedShare={fixedShare}
                    isLocked={isLocked}
                    activeKeys={activeClashKeys}
                    dimmed={highlight !== null}
                    onOpen={openClash}
                    onHighlight={(key) => setHighlight(key ? { kind: "clash", key } : null)}
                    synthetic={preset.synthetic === true}
                  />
                </div>
                </div>
              </div>
              <div className="order-1 min-w-0 md:order-2 xl:order-none">
                <CoverageMeter
                  coverage={report.coverage}
                  metrics={report.metrics}
                  synthetic={synthetic}
                  legend={
                    <TimetableLegend
                      inline
                      planShown={planShown || placeComing}
                      synthetic={synthetic}
                      holds={holds}
                      className="max-md:hidden"
                      note={<>Open any set or clash for its figures, including its draw ({popularityName(synthetic)}).</>}
                    />
                  }
                />
                {/* Below 768 px: the key, then the board itself in a sideways scroller that snaps to the stage
                    columns, then the start-order list behind a summary. Under 640 px the key folds into one
                    closed summary unless a tested place is on the board, when its warning must show; the
                    lock's reading stays out of the fold, on its own line above it, so whose lock it is needs
                    no tap. */}
                {planShown ? (
                  <TimetableLegend planShown synthetic={synthetic} holds={holds} className="mt-4 mb-3 md:hidden" />
                ) : (
                  <>
                    <LockKey synthetic={synthetic} holds={holds} className="mt-4 sm:hidden" />
                    <MoreDetails
                      className="mt-3 mb-3 sm:hidden"
                      summary={`How to read the board (${pluralize(legendSymbolCount({ planShown, lockApart: true }), "symbol")})`}
                    >
                      <TimetableLegend synthetic={synthetic} holds={holds} lockApart className="mt-3 px-1" />
                    </MoreDetails>
                    <TimetableLegend synthetic={synthetic} holds={holds} className="mt-4 mb-3 hidden sm:flex md:hidden" />
                  </>
                )}
                {/* The board's caption, read with no click: which lines the board draws, and how its numbers and
                    the drawing's lines differ (the board numbers clash cost; the hero's lines show taste overlap). */}
                <p data-board-caption="" className="mt-3 max-w-prose text-[0.8125rem] leading-5 text-muted-foreground md:mt-6">
                  Lines join the {links.length} costliest clashes. Board numbers rank clash cost; drawing lines show taste overlap.
                </p>
                {/* The board itself behind one disclosure: the phone's scroll hint, the grid in its
                    sideways scroller and the phone's start-order list. Everything above stays open. */}
                <BoardFold
                  summary={boardFoldSummary(views.length, festival.stages.length)}
                  open={boardOpen}
                  onToggle={toggleBoard}
                  carryRef={foldCarryRef}
                  className="mt-4"
                >
                  <p className="mt-4 mb-3 text-xs text-muted-foreground md:hidden">Scroll sideways to see every stage.</p>
                  <div className="max-md:snap-x max-md:snap-mandatory max-md:scroll-pl-[72px] max-md:overflow-x-auto max-md:overscroll-x-contain max-md:pb-3 md:mt-6">
                    <TimetableGrid
                      className="max-md:min-w-[760px]"
                      views={views}
                      stages={festival.stages}
                      links={links}
                      dayLabel={dayLabel}
                      activeSetIds={activeSetIds}
                      activeClashKeys={activeClashKeys}
                      dimmed={highlight !== null}
                      focusSetId={highlight?.kind === "set" ? highlight.id : null}
                      onHighlightSet={(id) => setHighlight(id ? { kind: "set", id } : null)}
                      onHighlightClash={(key) => setHighlight(key ? { kind: "clash", key } : null)}
                      onOpen={openClash}
                      plan={planPreview}
                      rulePreview={rulePreview}
                      synthetic={synthetic}
                    />
                  </div>
                  <details className="group mt-8 md:hidden">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-border-strong bg-card px-4 py-2.5 text-sm font-semibold hover:bg-accent [&::-webkit-details-marker]:hidden">
                      Show the start-order list ({pluralize(views.length, "set")})
                      <ChevronDown
                        aria-hidden="true"
                        className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-[160ms] motion-safe:ease-(--ease-out)"
                      />
                    </summary>
                    <TimetableList className="mt-4" views={views} dayLabel={dayLabel} onOpen={openClash} synthetic={synthetic} />
                  </details>
                </BoardFold>
              </div>
            </div>
          </BoardFrame>
        }
        move={
          <TryAMove
            preset={preset}
            day={day}
            ranked={ranked}
            isLocked={isLocked}
            onPlanChange={changePlan}
            onPick={pickPress}
            onRulePreview={setRulePreview}
            seedStep={seedStep}
            seedRule={seedRule}
            onKeptChange={setKeptSteps}
            cardMove={cardMove}
          />
        }
        agent={
          <AgentPanel
            preset={preset}
            day={day}
            agentStatus={agentStatus}
            keptSteps={keptSteps}
            cardActId={decisionCopy?.seedMove?.actId ?? null}
            publishedDays={published}
            onKeepPlace={(move, choice) => {
              // The agent proposes, the programmer keeps: the same seed path as the card's Keep this move.
              // Add (checked whole by /whatif in the panel first) keeps the plan's steps; Replace replaces
              // them and says so. The plan's own /whatif prices it again either way.
              const note = choice?.mode === "add" ? null : replacedNote(keptSteps, move);
              setSeedStep((previous) => ({ nonce: (previous?.nonce ?? 0) + 1, step: move, from: "agent", ...(choice ?? {}) }));
              return note;
            }}
          />
        }
        sources={
          // The compact sources block has 16px of its own above, so a jump to it keeps 48px more clear of the
          // sticky header and section nav.
          <div id={SOURCES_ID} className="scroll-mt-12">
            <PresetSources preset={preset} />
          </div>
        }
      />

      <ClashDrawer
        preset={preset}
        clash={drawer.clash}
        open={drawer.open}
        ranked={ranked}
        onSelect={(clash) => openClash(clash, null)}
        onClose={() => {
          // A resize can have re-rendered the rail row that opened the drawer; return focus to its new row.
          const trigger = liveClashRow(drawer.trigger);
          setDrawer((previous) => ({ ...previous, open: false, trigger }));
        }}
        returnFocusTo={drawer.trigger}
        rankWithoutTaste={lensRank}
        rankWithoutTasteOf={drawerRankOf(lenses)}
      />
    </>
  );
}
