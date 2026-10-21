"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { CHECK_LIVE } from "@/lib/check-flag";
import { sideEffectText, type DayGraphModel, type GraphView } from "@/lib/day-graph";
import { ATTRIBUTION, NO_MOVE, type DecisionCopy } from "@/lib/decision";
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

/** No kept steps: shared so its identity never changes. */
const NO_STEPS: readonly StackStep[] = [];

/** What "Keep this move" reads once the plan holds the move, in the same cell, so the button keeps its width. */
export const KEPT_LABEL = "Kept in your plan";

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
 * names the pair and says no legal place lowers the index; with no decision the taste line goes too.
 */
export function HeroDecision({ model, copy, view, onOpenMove, plan, kept, check, pending = false, className }: HeroDecisionProps) {
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
  // first, exactly as Keep this place does) or Replace, for the plan it was pressed on (`steps`; `stored` when that
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
  // offer takes the actions' own places (below 380 px Replace sits where the paste was, under the confirmation's
  // room), which on a short phone can run under the fold: the whole offer, Add, Replace and the words in that
  // room, then comes into view by the least scroll ("nearest"), at once under reduced motion.
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
  // The taste line needs a pair the decision chose: none without a decision.
  const taste = copy !== null ? model.tasteOfLit : null;
  // While the drawing shows the day without the move, a kept move says the drawing does not show it.
  const drawn = view === "published" && move ? (synthetic ? "invented" : "published") : null;

  return (
    <div ref={groupRef} id={DECISION_ID} data-hero-group="" className={cn("min-w-0", className)}>
      {/* The move lead: 20 px from 1024 px; below it the drawing's toggle names the move, so it is read only.
          scratch-plan.tsx scrolls to and focuses this heading. */}
      <h2
        id={DECISION_HEADING_ID}
        tabIndex={-1}
        className="text-[1.25rem] leading-[1.625rem] font-[620] tracking-[-0.015em] text-balance outline-none max-lg:sr-only"
      >
        {heading}
      </h2>

      {move ? (
        // The figures on their own line and the words under them, on both days and at every width, so the
        // answer keeps one shape (the words cannot share a 448 px line with 48 px figures anyway).
        <p data-readout="" className="lg:mt-2">
          <span className="type-numeral block text-[2.125rem] leading-[1.1] tracking-[-0.02em] lg:text-5xl lg:leading-[1.1]">
            {move.minutesBefore}
            <span aria-hidden="true"> → </span>
            <span className="sr-only"> to </span>
            <span className="text-primary">{move.minutesAfter}</span>
          </span>{" "}
          <span className="block text-[0.9375rem] leading-[1.375rem] lg:text-xl lg:leading-7">
            min shared with {move.partnerName}
          </span>
        </p>
      ) : null}

      {move ? (
        <p data-side-effects="" className="mt-1.5 text-sm leading-5 lg:mt-2 lg:text-[0.9375rem] lg:leading-[1.375rem]">
          {sideEffectText(move)}
        </p>
      ) : copy !== null ? (
        <p data-no-move="" className="mt-1.5 text-sm leading-5 lg:mt-2 lg:text-[0.9375rem] lg:leading-[1.375rem]">
          {NO_MOVE}
        </p>
      ) : null}

      {taste !== null ? (
        <p data-taste-line="" className="mt-1 text-sm leading-5 lg:mt-2 lg:text-[0.9375rem] lg:leading-[1.375rem]">
          {tasteLineText(taste, synthetic)} <ProvenanceChip provenance="derived" synthetic={synthetic} className="rounded-sm" />
        </p>
      ) : null}

      <p
        data-attribution=""
        className="mt-1 text-[0.8125rem] leading-[1.125rem] text-muted-foreground lg:mt-2 lg:text-sm lg:leading-5"
      >
        {ATTRIBUTION}. A reading, not a verdict.
      </p>

      {/* The actions: Keep, then the room its confirmation fills, then the paste, in that order at every width.
          From 1024 px the paste sits beside Keep and the confirmation runs under both. The Add / Replace offer
          is drawn in these places while Keep and the paste hold theirs unseen, so nothing moves. */}
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)] justify-items-start [grid-template-areas:'keep'_'notice'_'paste'] lg:mt-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-x-3 lg:[grid-template-areas:'keep_paste'_'notice_notice']">
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
        ) : null}
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
        {showKeep ? (
          // The room is held at every width: three 18 px lines on a phone (the longest confirmation as it wraps
          // at 320 px), two from 640 px, where it cannot take more, and two 20 px lines from 1024 px.
          <KeptNotice
            shown={keptShown}
            linkRef={linkRef}
            boxRef={noticeRef}
            drawn={drawn}
            className="mt-1 min-h-[3.375rem] w-full text-[0.8125rem] leading-[1.125rem] [grid-area:notice] sm:min-h-9 lg:min-h-10 lg:text-sm lg:leading-5"
          />
        ) : null}
        {CHECK_LIVE ? (
          <Button
            asChild
            variant="outline"
            size="default"
            className={cn("mt-2 [grid-area:paste] lg:mt-0 lg:h-12", showKeep && offerShown && "invisible")}
          >
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
 * Holds the hero group's footprint while a day's decision loads, at the heights its own rows take: the move
 * lead (from 1024 px), the readout, the side-effect and taste lines, the attribution and the 48 px button with
 * its confirmation's room. Nothing to read, nothing focusable.
 */
export function HeroDecisionSkeleton({ className }: { className?: string }) {
  const bar = "rounded-xs bg-muted";
  return (
    <div aria-hidden="true" data-hero-skeleton="" className={cn("min-w-0", className)}>
      <div className="flex h-[1.625rem] items-center max-lg:hidden">
        <div className={cn(bar, "h-4 w-3/5")} />
      </div>
      <div className="flex h-15 flex-col justify-center gap-2 lg:mt-2 lg:h-[5.125rem]">
        <div className={cn(bar, "h-7 w-2/5 lg:h-10")} />
        <div className={cn(bar, "h-3 w-3/4")} />
      </div>
      <div className="mt-1.5 flex h-10 flex-col justify-center gap-2 lg:mt-2 lg:h-11">
        <div className={cn(bar, "h-3 w-11/12")} />
        <div className={cn(bar, "h-3 w-2/3")} />
      </div>
      <div className="mt-1 flex h-10 flex-col justify-center gap-2 lg:mt-2 lg:h-11">
        <div className={cn(bar, "h-3 w-4/5")} />
        <div className={cn(bar, "h-3 w-1/2")} />
      </div>
      <div className="mt-1 flex h-9 flex-col justify-center gap-2 lg:mt-2 lg:h-10">
        <div className={cn(bar, "h-3 w-3/4")} />
      </div>
      <div className={cn("mt-2 h-12 w-40 rounded-md bg-muted lg:mt-4")} />
      <div className="mt-1 h-[3.375rem] sm:h-9 lg:h-10" />
    </div>
  );
}
