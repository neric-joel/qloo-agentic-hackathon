"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { CHECK_LIVE } from "@/lib/check-flag";
import { sideEffectText, type DayGraphModel, type GraphView } from "@/lib/day-graph";
import { ATTRIBUTION, NO_MOVE, type Decision, type DecisionCopy } from "@/lib/decision";
import { pluralize } from "@/lib/format";
import { ALREADY_KEPT } from "@/lib/rule-fix";
import {
  checkAdd,
  encodeMoves,
  keptWord,
  readStoredMoves,
  type PlanAnswer,
  type PlanChoice,
  type StackStep,
} from "@/lib/stack";
import { cn } from "@/lib/utils";

import {
  DECISION_HEADING_ID,
  DECISION_ID,
  KEEP_MOVE,
  KeepMoveOffer,
  KeptNotice,
  keepPressKind,
  planAtPress,
  type KeepOffer,
} from "./decision-card";
import { useAnnouncement } from "./use-announcement";
import { checkPlan } from "./use-moves";
import { readingText, rungLabels, sharedCount, tasteHeading, type ThreeReadings } from "./why-qloo";

/** No kept steps: shared so its identity never changes. */
const NO_STEPS: readonly StackStep[] = [];

/** What "Keep this move" reads once the plan holds the move, in the same cell, so the button keeps its width. */
export const KEPT_LABEL = "Kept in your plan";

/**
 * The hero group's rows, in order, each with the space above it and the room it holds at every width. Every
 * state the group can be painted in builds from these: the settled answer, the same answer before the
 * interactive view mounts (`pending`), and the skeleton while a day's decision loads, so one never replaces
 * another at a different height. The rooms are min-heights, never fixed heights: a longer line grows its row
 * and is never clipped. Each is the settled row's own height on the published days at that width (the move
 * lead is screen-reader only below 1024 px; the readout's figures 34 px on 1.1, then 48 px; one 20 px line of
 * words, then 28 px; the side effects and the taste line two 20 px lines below 640 px, one from 640 px, two 22
 * px lines from 1024 px and, for the taste line, one from 1280 px, where it holds the 13 px Derived stamp; the
 * attribution two 18 px lines below 640 px, then one; Keep's 48 px; the confirmation's room three 18 px lines,
 * two from 640 px, two 20 px lines from 1024 px; the ladder's rungs, an 18 px name over a 24 px rank, and its
 * one-line sentence, 66 px on a phone (84 px below 360 px, where a rung's name takes two lines) and, from 1024 px, where it sits above Keep, 68 px and 12 px under it;
 * none from 1280 px, where the ladder is one line in the left column, `HeroLadderRoom`). On a screen 790 px tall or less,
 * from 1024 px, the spaces above the readout, the side effects, the taste line and the attribution are 4 px, the space
 * above Keep 8 px and the readout's words a 24 px line (28 px less in all), so a 1366 x 768 screen holds the whole
 * drawing; no text gets smaller. If a settled row is taller than its room at some width, its room for that width is
 * raised; the text is never shortened.
 */
export const HERO_ROWS = [
  { name: "lead", space: "", min: "lg:min-h-[1.625rem]" },
  { name: "readout", space: "lg:mt-2 lg:[@media(max-height:790px)]:mt-1", min: "min-h-[3.7125rem] lg:min-h-[5.05rem] lg:[@media(max-height:790px)]:min-h-[4.8rem]" },
  { name: "side-effects", space: "mt-1.5 lg:mt-2 lg:[@media(max-height:790px)]:mt-1", min: "min-h-10 sm:min-h-5 lg:min-h-11" },
  { name: "taste", space: "mt-1 lg:mt-2 lg:[@media(max-height:790px)]:mt-1", min: "min-h-10 sm:min-h-5 lg:min-h-11 xl:min-h-[1.375rem]" },
  { name: "attribution", space: "mt-1 lg:mt-2 lg:[@media(max-height:790px)]:mt-1", min: "min-h-9 sm:min-h-[1.125rem] lg:min-h-5" },
  { name: "actions", space: "mt-2 lg:mt-4 lg:[@media(max-height:790px)]:mt-2", min: "min-h-12" },
  { name: "notice", space: "mt-1", min: "min-h-[3.375rem] sm:min-h-9 lg:min-h-10" },
  { name: "ladder", space: "mt-3 lg:mt-0", min: "min-h-[4.125rem] max-[359px]:min-h-[5.25rem] lg:min-h-[5rem] xl:min-h-0" },
] as const;

export type HeroRowName = (typeof HERO_ROWS)[number]["name"];

/**
 * The room the hero layout's group cell holds from 1024 px, from first paint: the sum of `HERO_ROWS` at that
 * width (434.8 px from 1024 px; 332.8 px from 1280 px, where the taste line takes one line and the ladder leaves the
 * group; 28 px less on a screen 790 px tall or less: 406.8 and 304.8 px), so a group that
 * comes later, or one with an empty row, never moves the toggle and the drawing beside it.
 */
export const HERO_CELL_MIN =
  "lg:min-h-[27.175rem] xl:min-h-[20.8rem] lg:[@media(max-height:790px)]:min-h-[25.425rem] xl:[@media(max-height:790px)]:min-h-[19.05rem]";

/** A row's space and room (`HERO_ROWS`), then the classes of what it holds. */
function rowClass(name: HeroRowName, ...rest: Parameters<typeof cn>): string {
  const row = HERO_ROWS.find((item) => item.name === name);
  return cn(row?.space, row?.min, ...rest);
}

/**
 * The actions grid: Keep, then the room its confirmation fills, the ladder, then the paste, in that order on a
 * phone, where the ladder comes right under Keep's confirmation so Keep keeps its place on the first screen. From
 * 1024 px the ladder runs above Keep (to 1279 px; from 1280 px it is hidden here and shown as one line in the left
 * column), the paste sits beside Keep and the confirmation runs under both.
 */
const ACTIONS_GRID =
  "grid grid-cols-[minmax(0,1fr)] justify-items-start [grid-template-areas:'keep'_'notice'_'ladder'_'paste'] lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-x-3 lg:[grid-template-areas:'ladder_ladder'_'keep_paste'_'notice_notice']";

/** The ladder's cell in the actions grid: the full width, with 12 px under it above Keep from 1024 px. */
const LADDER_CELL = "w-full [grid-area:ladder] lg:pb-3 xl:hidden";

/** A rung's rank as the hero prints it: "#23", or the section's words when the page has no place for it. */
function rungRank(reading: ThreeReadings[keyof ThreeReadings]): string {
  return reading ? `#${reading.rank}` : readingText(reading);
}

/** The ladder's three rungs, named by the section's `rungLabels`; the shared count closes the last rung only. */
function ladderRungs(readings: ThreeReadings, synthetic: boolean) {
  const labels = rungLabels(synthetic, true);
  const shared = sharedCount([readings.time, readings.draw, readings.taste]);
  return (["time", "draw", "taste"] as const).map((key, i, keys) => {
    const reading = readings[key];
    const last = i === keys.length - 1;
    const of = reading && reading.of !== undefined && reading.of >= reading.rank && (shared === null || last) ? reading.of : null;
    return { key, label: labels[key], reading, last, of };
  });
}

/**
 * The hero's short ladder: the decision's clash ranked on time alone, then with Qloo popularity added, then with
 * taste overlap added (the index used here), read by `threeReadings` from the same lens data as "What Qloo
 * changes" and named by its `rungLabels`, so the two never disagree; then that section's own sentence for what
 * taste did (`tasteHeading`): "Adding taste moves this pair from #18 to #1." or "Adding taste leaves this pair at
 * #1.", which credits taste with its own step only, never with the step popularity made. The count the three
 * rungs share ("of 68") closes the last rung; when they rank different counts each rung carries its own. Ink only:
 * a rank is neither shared time nor a Qloo figure. Nothing without both readings that carry draw.
 */
export function HeroLadder({ readings, synthetic }: { readings: ThreeReadings; synthetic: boolean }) {
  if (!readings.draw || !readings.taste) return null;
  const rungs = ladderRungs(readings, synthetic);
  return (
    <div data-hero-ladder="">
      <ol className="grid grid-cols-[repeat(3,minmax(0,auto))] justify-start gap-x-6 lg:gap-x-8">
        {rungs.map(({ key, label, reading, last, of }) => {
          return (
            <li key={key} data-rung={key} className="flex min-w-0 flex-col justify-between">
              <span className={cn("text-[0.8125rem] leading-[1.125rem]", last ? "font-semibold" : "text-muted-foreground")}>{label}</span>
              <span className="mt-0.5 flex items-baseline gap-x-1 leading-6 whitespace-nowrap">
                <span className="type-numeral text-xl leading-6">{rungRank(reading)}</span>
                {of !== null ? <span className="font-mono text-[0.8125rem] leading-none text-muted-foreground tabular-nums">of {of}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <p data-ladder-line="" className="mt-1 text-[0.8125rem] leading-[1.125rem] lg:text-sm lg:leading-5">
        {tasteHeading(readings, synthetic)}.
      </p>
    </div>
  );
}

/**
 * The ladder as one line, for the hero's left column from 1280 px (`HeroLadderRoom`): "Time alone #23 → + Qloo
 * popularity #18 → + taste overlap #1 of 68", the same rungs, ranks and counts as `HeroLadder` (which the group
 * shows below 1280 px), so the right-hand group keeps its height and the drawing its place on the first screen. The
 * arrows are drawn only; a screen reader hears the three rungs as a list. The sentence for what taste did stays in
 * "What Qloo changes" below, which says it in full. Ink only, no motion. Nothing without both readings that carry draw.
 */
export function HeroLadderLine({ readings, synthetic }: { readings: ThreeReadings; synthetic: boolean }) {
  if (!readings.draw || !readings.taste) return null;
  const rungs = ladderRungs(readings, synthetic);
  return (
    <ol data-hero-ladder-line="" className="flex flex-wrap items-baseline gap-x-2 text-[0.8125rem] leading-[1.125rem]">
      {rungs.map(({ key, label, reading, last, of }, i) => (
        <li key={key} data-rung={key} className="flex items-baseline gap-x-2 whitespace-nowrap">
          {i > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
          ) : null}
          <span className={last ? "font-semibold" : "text-muted-foreground"}>
            {label} <span className="font-semibold text-foreground tabular-nums">{rungRank(reading)}</span>
            {of !== null ? <span className="text-muted-foreground tabular-nums"> of {of}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The one-line ladder's room in the hero's left column, under the dateline (and the desktop note), held from 1280
 * px in every state, 18 px, empty and hidden from assistive tech until the lens data comes, so the toggle and the
 * drawing under it never move when it fills. Hidden below 1280 px, where the group shows the ladder.
 */
export function HeroLadderRoom({ readings = null, synthetic }: { readings?: ThreeReadings | null; synthetic: boolean }) {
  const shown = readings !== null && Boolean(readings.draw && readings.taste);
  return (
    <div data-hero-ladder-room="" aria-hidden={shown ? undefined : true} className="mt-1.5 hidden min-h-[1.125rem] xl:block">
      {shown && readings ? <HeroLadderLine readings={readings} synthetic={synthetic} /> : null}
    </div>
  );
}

/** The paste's cell: 44 px under the confirmation's room on a phone, 48 px beside Keep from 1024 px. */
const PASTE_CELL = "mt-2 [grid-area:paste] lg:mt-0 lg:h-12";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The taste line's words: the pair's taste overlap with its qualifier beside the number, the one place on the
 * first screen that says what 99 means. The rank is this app's, calculated from Qloo data, so the stamp that
 * follows it is Derived; on the invented day the bill and the rank are invented and nothing credits Qloo.
 */
export function tasteLineText(taste: number, synthetic: boolean): string {
  return synthetic
    ? `Taste overlap: ${taste} of 100 on this invented bill (an invented rank, not attendance)`
    : `Taste overlap: ${taste} of 100 on this bill (a rank, not attendance)`;
}

/** The desktop note's sentences, word for word. */
export const NOTE_LOWEST = "Of the legal moves checked, this gives the lowest index.";
export const NOTE_TIED = "Of the legal moves checked, this ties for the lowest index.";
export const NOTE_TWO_SETS = "Moving two sets ends the overlap instead.";
export const NOTE_NEAR_100 = "Near 100 means closer tastes among the acts compared.";
export const NOTE_NEAR_100_INVENTED = "Near 100 means closer invented tastes among the acts compared.";

/**
 * The note under the dateline for a day's decision: every sentence whose condition holds, none dropped to fit.
 * First, why this move: the engine checks every legal single-set place of the clash's two sets (each start on a
 * 5-minute grid in the free time it may use, minus any place that breaks a rule) and takes the place with the lowest
 * index (`backend/app/decision.py`, `_candidates`, from `compute_move_options`), so it "gives" the lowest index, or
 * "ties for" it when the other set's first place gives the same (`move.alternative`). Then, only when the rule
 * answer's first change moves two sets and leaves the pair 0 minutes shared, that two sets end the overlap (no figure:
 * the index block keeps its own). Last, what the taste line's scale means. Null without a move; nothing credits Qloo.
 */
export function heroNote(decision: Decision | null, synthetic: boolean): string | null {
  if (!decision?.move) return null;
  const first = decision.rule && !decision.rule.holds ? decision.rule.fixes[0] : undefined;
  const twoSets = first?.setsMoved === 2 && decision.ruleChange?.minutesSharedAfter === 0;
  return [
    decision.move.alternative ? NOTE_TIED : NOTE_LOWEST,
    twoSets ? NOTE_TWO_SETS : null,
    synthetic ? NOTE_NEAR_100_INVENTED : NOTE_NEAR_100,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The note in the hero's left column, under the dateline: 13 px on 20 px, muted ink, at most two lines in the
 * column's 704 px. Shown only from 1280 px wide and 791 px tall, where the column, with the ladder's one line under
 * the note (`HeroLadderRoom`), ends no lower than the group beside it, so it moves nothing; hidden on a phone and on
 * shorter screens. Nothing without a note.
 */
export function HeroNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p
      data-hero-note=""
      className="mt-1 hidden max-w-[44rem] text-[0.8125rem] leading-5 text-muted-foreground xl:[@media(min-height:791px)]:block"
    >
      {text}
    </p>
  );
}

/**
 * Which part of the Add / Replace offer to bring into view so that the whole offer shows, its words in the
 * confirmation's room included: the lowest part when the offer runs past the foot of the viewport, the highest
 * when it starts above the top (each by the least scroll, "nearest"), none when it is all in view. The offer is
 * never taller than the viewport (at most three short rows), so bringing one end in brings the whole.
 */
export function offerPartToShow<T>(parts: readonly { part: T; top: number; bottom: number }[], viewportHeight: number): T | null {
  if (parts.length === 0) return null;
  const lowest = parts.reduce((low, item) => (item.bottom > low.bottom ? item : low));
  const highest = parts.reduce((high, item) => (item.top < high.top ? item : high));
  if (lowest.bottom > viewportHeight) return lowest.part;
  if (highest.top < 0) return highest.part;
  return null;
}

/** The pair a hero without a move names in its heading: the decision's clash, else the day's costliest. */
function namedPair(model: DayGraphModel) {
  return model.threads.find((thread) => thread.lit) ?? model.threads[0] ?? null;
}

type HeroDecisionProps = {
  model: DayGraphModel;
  /** The decision's words (`buildDecisionCopy`); null when the day has no decision. */
  copy: DecisionCopy | null;
  /** What the drawing shows now; the readout, side effect and taste line describe the proposal in both. */
  view: GraphView;
  /**
   * Keeps the one move. With no `choice`, or `{ mode: "replace" }`, the move becomes the whole plan; with
   * `{ mode: "add", base }` it goes after the kept steps, only while the plan still holds exactly `base` (the seed
   * path of "Try a move"). It may return what the status line should say about steps it replaced.
   */
  onOpenMove?: (choice?: PlanChoice) => string | null | void;
  /**
   * The steps the plan holds now (scored). With it, a press on a plan that holds other steps offers "Add to your
   * plan" or "Replace your plan" instead of replacing it; without it the press keeps the move.
   */
  plan?: readonly StackStep[];
  /** What the plan already holds of the decision: the move, and line 3's change. */
  kept?: { move: boolean; change: boolean };
  /** Scores a whole plan before Add keeps anything; the page's own /whatif for this day by default. */
  check?: (steps: readonly StackStep[]) => Promise<PlanAnswer>;
  /**
   * The server HTML and the first screen before the interactive view mounts: "Keep this move" is drawn in
   * place, at its size, but cannot be pressed yet, so the swap to the live hero moves nothing.
   */
  pending?: boolean;
  /**
   * The decision's clash ranked three ways (`threeReadings`), for the ladder; null or absent while the lens data
   * loads, in the server HTML and when it never comes: the ladder's room is then held empty.
   */
  ladder?: ThreeReadings | null;
  className?: string;
};

/**
 * The hero's answer, beside the day it is drawn on, in one order at every width: the move as its heading (a
 * screen-reader heading below 1024px, where the drawing's toggle names the move), the readout ("45 → 30 min
 * shared with Katy J Pearson": the figures in the answer type, the minutes left in raspberry, the words on their
 * own line under them), what else the move changes (every overlap it starts, lengthens, shortens or ends,
 * from the published times), the pair's taste overlap with its qualifier and Derived stamp, and who selected and
 * scored it; then the one filled button, "Keep this move", the slot its confirmation fills (always holding its
 * room, so nothing moves when it fills), and "Paste your own draft grid". Keep writes the real plan through
 * `onOpenMove` (Add or Replace when the plan holds other steps); a press confirms in place and moves focus to
 * the confirmation's link, scrolling the whole confirmation into view when it is not. With no move the heading
 * names the pair and says no legal place lowers the index; with no decision the taste line goes too. Every row
 * keeps its room (`HERO_ROWS`) in every state, an empty one hidden from assistive tech, so the group's height
 * never changes from one state to the next.
 */
export function HeroDecision({
  model,
  copy,
  view,
  onOpenMove,
  plan,
  kept,
  check,
  pending = false,
  ladder = null,
  className,
}: HeroDecisionProps) {
  const [status, say] = useAnnouncement();
  const { move, synthetic } = model;
  const showKeep = move !== null && (pending || Boolean(onOpenMove && copy?.seedMove));

  // "Keep this move" confirms in place: once the plan holds the move (or, for a hero told nothing about the
  // plan, once pressed) the slot under the button reads "Kept in your plan." with its link, and the button
  // says so in the same width. A press moves focus to that link, never to the page.
  const [pressed, setPressed] = useState(false);
  const keptShown = kept ? kept.move : pressed;
  const [focusAsk, setFocusAsk] = useState<{ key: number; at: number }>({ key: 0, at: 0 });
  const focusedAsk = useRef(0);
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusAsk.key === 0 || !keptShown || focusedAsk.current === focusAsk.key) return;
    focusedAsk.current = focusAsk.key;
    // A plan that took longer than two seconds to hold the move is no answer to this press.
    if (Date.now() - focusAsk.at > 2000) return;
    const link = linkRef.current;
    const notice = noticeRef.current;
    if (!link || !notice) return;
    // The whole confirmation, its "Nothing moves until the acts' teams agree." included, comes into view by
    // the least scroll ("nearest"), then the link takes focus. Focus waits for the scroll to land: a browser
    // centres an element focused off screen, which would jump the page instead.
    const box = notice.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) {
      link.focus();
      return;
    }
    const reduce = reducedMotion();
    notice.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    if (reduce) {
      link.focus();
      return;
    }
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      link.focus();
    };
    window.addEventListener("scrollend", land, { once: true });
    const timer = window.setTimeout(land, 900);
    return () => {
      window.removeEventListener("scrollend", land);
      window.clearTimeout(timer);
    };
  }, [focusAsk, keptShown]);

  // A press on a plan that already holds other steps never replaces it silently: it offers Add (scored whole
  // first, exactly as an agent run's Keep this move does) or Replace, for the plan it was pressed on (`steps`; `stored` when that
  // was the tab's stored plan, before the page had the plan's first answer). A changed plan, or the move kept,
  // puts the offer away.
  const [offer, setOffer] = useState<{
    base: string;
    steps: readonly StackStep[];
    stored: boolean;
    key: number;
    at: KeepOffer;
  } | null>(null);
  const held = plan ?? NO_STEPS;
  const heldKey = encodeMoves(held);
  const offerShown =
    offer !== null && !keptShown && (offer.base === heldKey || (offer.stored && held.length === 0)) ? offer.at : null;
  const addRef = useRef<HTMLButtonElement | null>(null);
  const replaceRef = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // A choice the plan did not take within a few seconds (it changed under it) is offered again, never left dead.
  const sentKey = offerShown?.state === "sent" ? offer?.key : null;
  useEffect(() => {
    if (sentKey === null || sentKey === undefined) return;
    const timer = window.setTimeout(() => {
      setOffer((previous) => (previous && previous.key === sentKey && previous.at.state === "sent" ? { ...previous, at: { state: "open" } } : previous));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [sentKey]);
  // Focus follows the offer: to Add when it opens, to Replace when an Add is refused (the way still open). The
  // offer takes the actions' own places: Add in Keep's, Replace beside it from 380 px and, below 380 px, directly
  // under it (the paste's row comes up under Keep's while the offer shows), then the words in the confirmation's
  // room. On a short phone that can run under the fold: the whole offer, Add, Replace and those words, then comes
  // into view by the least scroll ("nearest"), at once under reduced motion.
  const groupRef = useRef<HTMLDivElement | null>(null);
  const offerFocus = offerShown && (offerShown.state === "open" || offerShown.state === "rejected") ? `${offer?.key}:${offerShown.state}` : null;
  useEffect(() => {
    if (!offerFocus) return;
    const refused = offerFocus.endsWith(":rejected");
    const target = refused ? replaceRef.current : (addRef.current ?? replaceRef.current);
    target?.focus({ preventScroll: true });
    const words = groupRef.current?.querySelector<HTMLElement>("[data-keep-offer-status]") ?? null;
    const parts = [addRef.current, replaceRef.current, words].flatMap((element) => {
      if (!element) return [];
      const box = element.getBoundingClientRect();
      return [{ part: element, top: box.top, bottom: box.bottom }];
    });
    const part = offerPartToShow(parts, window.innerHeight);
    part?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [offerFocus]);
  // Escape puts the offer away and hands focus back to Keep, which is drawn again in its place.
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const [backToKeep, setBackToKeep] = useState(0);
  useEffect(() => {
    if (backToKeep > 0) keepRef.current?.focus({ preventScroll: true });
  }, [backToKeep]);
  function dismissOffer() {
    setOffer(null);
    setBackToKeep((previous) => previous + 1);
  }

  /** Hands the move to the plan (`choice`: replace, the default, or add after the steps it was scored with). */
  function keepMove(choice?: PlanChoice, added?: string) {
    if (!onOpenMove) return;
    setPressed(true);
    setFocusAsk((previous) => ({ key: previous.key + 1, at: Date.now() }));
    const extra = choice ? onOpenMove(choice) : onOpenMove();
    say([copy?.testing ?? null, added ?? null, typeof extra === "string" ? extra : null].filter(Boolean).join(" "));
  }

  function openMove() {
    if (!onOpenMove || !copy) return;
    const steps = planAtPress(plan, () => readStoredMoves(copy.presetId));
    const kind = keepPressKind(steps, copy.seedMove, Boolean(kept?.move));
    // Pressing it again for a move the plan already holds changes nothing and says so.
    if (kind === "already") {
      setPressed(true);
      setFocusAsk((previous) => ({ key: previous.key + 1, at: Date.now() }));
      say(ALREADY_KEPT);
      onOpenMove();
      return;
    }
    // The plan holds other steps: ask first, Add or Replace; nothing changes yet.
    if (kind === "offer") {
      const stored = held.length === 0;
      setOffer((previous) => ({ base: encodeMoves(steps), steps, stored, key: (previous?.key ?? 0) + 1, at: { state: "open" } }));
      say(`Your plan already holds ${pluralize(steps.length, keptWord(steps))}. Add this move to it, or replace your plan.`);
      return;
    }
    keepMove();
  }

  async function addMove() {
    const seed = copy?.seedMove;
    if (!copy || !seed || !offer || !offerShown || offerShown.state === "checking" || offerShown.state === "sent") return;
    const { base: key, steps: base, stored, key: number } = offer;
    setOffer({ base: key, steps: base, stored, key: number, at: { state: "checking" } });
    say("Scoring your plan with this move added.");
    const outcome = await checkAdd(
      base,
      { act: copy.moveAct ?? move?.name ?? "this set", move: seed },
      check ?? ((steps) => checkPlan(copy.presetId, steps)),
      "move",
    );
    if (!alive.current) return;
    if (outcome.kind === "rejected") {
      setOffer({ base: key, steps: base, stored, key: number + 1, at: { state: "rejected", reason: outcome.reason, retry: outcome.retry } });
      say(outcome.reason);
      return;
    }
    setOffer({ base: key, steps: base, stored, key: number, at: { state: "sent" } });
    keepMove(outcome.choice, `Added: ${pluralize(outcome.count, keptWord([...base, seed]))}.`);
  }

  function replaceMove() {
    if (!offerShown || offerShown.state === "sent") return;
    setOffer((previous) => (previous ? { ...previous, at: { state: "sent" } } : previous));
    keepMove({ mode: "replace" });
  }

  const pair = move ? null : namedPair(model);
  const heading = move
    ? (copy?.receiptLead ?? move.label)
    : pair
      ? `${pair.aName} × ${pair.bName}: ${pair.minutes} min shared`
      : model.title;
  // The ladder needs the readings that carry draw; until they come its room is held empty.
  const ladderShown = ladder !== null && Boolean(ladder.draw && ladder.taste);
  // The taste line needs a pair the decision chose: none without a decision.
  const taste = copy !== null ? model.tasteOfLit : null;
  // While the drawing shows the day without the move, a kept move says the drawing does not show it.
  const drawn = view === "published" && move ? (synthetic ? "invented" : "published") : null;
  // The move lead, or the pair without a move: 20 px from 1024 px; below it the drawing's toggle names the move, so
  // it is read only. scratch-plan.tsx scrolls to and focuses this heading.
  const headingElement = (
    <h2
      id={DECISION_HEADING_ID}
      tabIndex={-1}
      className="text-[1.25rem] leading-[1.625rem] font-[620] tracking-[-0.015em] text-balance outline-none max-lg:sr-only"
    >
      {heading}
    </h2>
  );

  return (
    <div
      ref={groupRef}
      id={DECISION_ID}
      data-hero-group=""
      data-hero-state={pending ? "pending" : "settled"}
      className={cn("min-w-0", className)}
    >
      {/* Every row holds its room (`HERO_ROWS`) in every state, filled or not, so the group keeps one height. With
          a move the heading is the lead's one line. Without one it names a pair ("A × B: 40 min shared"), which
          can take two or three lines at 26rem, so it sits in the readout's room, empty then and as tall as three
          of its lines, and the lead's room stays empty: the group keeps its height when a day's decision does not
          come (a failed request) or comes with no move. */}
      <div data-hero-row="lead" aria-hidden={move ? undefined : true} className={rowClass("lead")}>
        {move ? headingElement : null}
      </div>

      <div data-hero-row="readout" className={rowClass("readout")}>
        {!move ? (
          headingElement
        ) : (
          // The figures on their own line and the words under them, on both days and at every width, so the
          // answer keeps one shape (the words cannot share a 448 px line with 48 px figures anyway).
          <p data-readout="">
            <span className="type-numeral block text-[2.125rem] leading-[1.1] tracking-[-0.02em] lg:text-5xl lg:leading-[1.1]">
              {move.minutesBefore}
              <span aria-hidden="true"> → </span>
              <span className="sr-only"> to </span>
              <span className="text-primary">{move.minutesAfter}</span>
            </span>{" "}
            <span className="block text-[0.9375rem] leading-[1.375rem] lg:text-xl lg:leading-7 lg:[@media(max-height:790px)]:leading-6">
              min shared with {move.partnerName}
            </span>
          </p>
        )}
      </div>

      <div data-hero-row="side-effects" aria-hidden={move || copy !== null ? undefined : true} className={rowClass("side-effects")}>
        {move ? (
          <p data-side-effects="" className="text-sm leading-5 lg:text-[0.9375rem] lg:leading-[1.375rem]">
            {sideEffectText(move)}
          </p>
        ) : copy !== null ? (
          <p data-no-move="" className="text-sm leading-5 lg:text-[0.9375rem] lg:leading-[1.375rem]">
            {NO_MOVE}
          </p>
        ) : null}
      </div>

      {/* Without the decision's pair (copy null) the taste row holds its room with nothing in it: no number
          and no qualifier. */}
      <div data-hero-row="taste" aria-hidden={taste !== null ? undefined : true} className={rowClass("taste")}>
        {taste !== null ? (
          <p data-taste-line="" className="text-sm leading-5 lg:text-[0.9375rem] lg:leading-[1.375rem]">
            {tasteLineText(taste, synthetic)} <ProvenanceChip provenance="derived" synthetic={synthetic} className="rounded-sm" />
          </p>
        ) : null}
      </div>

      <div data-hero-row="attribution" className={rowClass("attribution")}>
        <p data-attribution="" className="text-[0.8125rem] leading-[1.125rem] text-muted-foreground lg:text-sm lg:leading-5">
          {ATTRIBUTION}. A reading, not a verdict.
        </p>
      </div>

      {/* The actions: Keep, then the room its confirmation fills, then the paste, in that order at every width.
          From 1024 px the paste sits beside Keep and the confirmation runs under both. The Add / Replace offer
          is drawn in these places while Keep and the paste hold theirs unseen, so nothing moves; below 380 px,
          while it shows, the paste's row comes up under Keep's, so Replace sits directly under Add and the
          confirmation's room, which holds the offer's words, follows them (the same three rows, so the group
          keeps its height). Without Keep, its place and its room are held empty. */}
      <div
        data-hero-row="actions"
        className={rowClass("actions", ACTIONS_GRID, showKeep && offerShown && "max-[379px]:[grid-template-areas:'keep'_'paste'_'notice'_'ladder']")}
      >
        {showKeep ? (
          <Button
            ref={keepRef}
            type="button"
            variant="default"
            size="lg"
            disabled={pending || undefined}
            onClick={openMove}
            className={cn(
              "[grid-area:keep] motion-safe:transition-[scale] motion-safe:duration-(--dur-feedback) motion-safe:ease-(--ease-out) motion-safe:active:translate-y-0 motion-safe:active:scale-97",
              pending && "disabled:cursor-default disabled:opacity-100",
              offerShown && "invisible",
            )}
          >
            {/* Both labels share one cell, so the button is as wide as the longer and never reflows. */}
            <span className="grid">
              <span className={cn("col-start-1 row-start-1", keptShown && "invisible")}>{KEEP_MOVE}</span>
              <span
                aria-hidden={keptShown ? undefined : true}
                className={cn("col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5", !keptShown && "invisible")}
              >
                <Check aria-hidden="true" />
                {KEPT_LABEL}
              </span>
            </span>
          </Button>
        ) : (
          <div aria-hidden="true" className="h-12 [grid-area:keep]" />
        )}
        {showKeep && offerShown ? (
          <KeepMoveOffer
            offer={offerShown}
            held={offer?.steps ?? held}
            onAdd={addMove}
            onReplace={replaceMove}
            onDismiss={dismissOffer}
            addRef={addRef}
            replaceRef={replaceRef}
          />
        ) : null}
        <div data-hero-row="notice" className={rowClass("notice", "w-full [grid-area:notice]")}>
          {showKeep ? (
            // The room is held at every width: three 18 px lines on a phone (the longest confirmation as it wraps
            // at 320 px), two from 640 px, where it cannot take more, and two 20 px lines from 1024 px.
            <KeptNotice
              shown={keptShown}
              linkRef={linkRef}
              boxRef={noticeRef}
              drawn={drawn}
              className="min-h-[3.375rem] w-full text-[0.8125rem] leading-[1.125rem] sm:min-h-9 lg:min-h-10 lg:text-sm lg:leading-5"
            />
          ) : null}
        </div>
        {/* The ladder's room, held in every state; empty, and hidden from assistive tech, until the lens data comes. */}
        <div data-hero-row="ladder" aria-hidden={ladderShown ? undefined : true} className={rowClass("ladder", LADDER_CELL)}>
          {ladderShown && ladder ? <HeroLadder readings={ladder} synthetic={synthetic} /> : null}
        </div>
        {CHECK_LIVE ? (
          <Button asChild variant="outline" size="default" className={cn(PASTE_CELL, showKeep && offerShown && "invisible")}>
            <Link href="/check">
              Paste your own draft grid
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}

/**
 * Holds the hero group's footprint while a day's decision loads, built from the same rows as the answer
 * (`HERO_ROWS`), so the answer takes exactly its place when it comes: the move lead (from 1024 px), the readout,
 * the side-effect and taste rows, the attribution, then Keep's place, its confirmation's room and the paste's.
 * It shows no move and no pair, so it prints nothing: no text, no figure, no attribution, and nothing to press
 * or focus. Each row holds a quiet bar inside its room.
 */
export function HeroDecisionSkeleton({ className }: { className?: string }) {
  const bar = "rounded-xs bg-muted";
  const lines = "flex flex-col justify-center gap-2";
  return (
    <div aria-hidden="true" data-hero-skeleton="" data-hero-group="" data-hero-state="skeleton" className={cn("min-w-0", className)}>
      <div data-hero-row="lead" className={rowClass("lead", lines, "max-lg:hidden")}>
        <div className={cn(bar, "h-4 w-3/5")} />
      </div>
      <div data-hero-row="readout" className={rowClass("readout", lines)}>
        <div className={cn(bar, "h-7 w-2/5 lg:h-10")} />
        <div className={cn(bar, "h-3 w-3/4")} />
      </div>
      <div data-hero-row="side-effects" className={rowClass("side-effects", lines)}>
        <div className={cn(bar, "h-3 w-11/12")} />
      </div>
      <div data-hero-row="taste" className={rowClass("taste", lines)}>
        <div className={cn(bar, "h-3 w-4/5")} />
      </div>
      <div data-hero-row="attribution" className={rowClass("attribution", lines)}>
        <div className={cn(bar, "h-3 w-3/4")} />
      </div>
      <div data-hero-row="actions" className={rowClass("actions", ACTIONS_GRID)}>
        <div className="h-12 w-40 rounded-md bg-muted [grid-area:keep]" />
        <div data-hero-row="notice" className={rowClass("notice", "w-full [grid-area:notice]")} />
        <div data-hero-row="ladder" className={rowClass("ladder", LADDER_CELL, lines)}>
          <div className={cn(bar, "h-3 w-4/5")} />
          <div className={cn(bar, "h-3 w-3/5")} />
        </div>
        {CHECK_LIVE ? <div className={cn(PASTE_CELL, "h-11 w-56 rounded-md bg-muted")} /> : null}
      </div>
    </div>
  );
}
