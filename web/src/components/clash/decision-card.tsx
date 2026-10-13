"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowRight, Check, ChevronRight } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { LABEL_META } from "@/lib/clashes";
import { ATTRIBUTION, type DecisionCopy, type SharedTimeline, type TimelineBar } from "@/lib/decision";
import { ALREADY_KEPT } from "@/lib/rule-fix";
import { useInView, useIntroDone } from "@/lib/use-in-view";
import { formatRange } from "@/lib/timetable";
import { cn } from "@/lib/utils";

import { PairStrip, type StripLane } from "./pair-strip";
import { TradeoffTable } from "./tradeoff-table";
import { usePairCheckEnabled } from "./use-agent-status";
import { useAnnouncement } from "./use-announcement";

/** The anchor of the card, for the hero button and the jump links. */
export const DECISION_ID = "one-decision";
export const DECISION_HEADING_ID = "decision-heading";

/** Counted from the first card shown on the page, so the reveal runs once per page load. */
let revealed = false;

/** The hero receipt (M1) plays once per page load, on the first interactive card that comes into view. */
let receiptPlayed = false;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The index after the move, shown as it counts from the reading before to the reading after (420 to
 * 900 ms into "Keep this move"). The final value is what the page holds before and after, and what
 * screen readers get; with reduced motion the final value shows at once.
 */
function useCount(from: number | null, to: number | null, playKey: number): string | null {
  const final = to === null ? null : to.toFixed(1);
  const [shown, setShown] = useState<{ key: number; value: string | null }>({ key: 0, value: final });

  useEffect(() => {
    if (playKey === 0 || from === null || to === null) return;
    let frame = 0;
    // Under reduced motion the final reading shows at once, with no number in between.
    if (reducedMotion()) {
      const timer = window.setTimeout(() => setShown({ key: playKey, value: to.toFixed(1) }), 0);
      return () => window.clearTimeout(timer);
    }
    const length = 480;
    let begin = 0;
    const tick = (now: number) => {
      if (begin === 0) begin = now;
      const t = Math.min(1, (now - begin) / length);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown({ key: playKey, value: (from + (to - from) * eased).toFixed(1) });
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, 420);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [from, to, playKey]);

  // Until the count starts, the figure holds the reading before the move.
  if (playKey === 0 || from === null) return final;
  return shown.key === playKey ? shown.value : from.toFixed(1);
}

/** The stages and times the card's own lines state, read back so the drawing can name them; null parts are left off. */
type TimelineFacts = {
  stayingStage: string | null;
  movingStage: string | null;
  window: string | null;
  /** The stage the tested move puts the moving set on (it can differ from where it plays now). */
  afterStage: string | null;
  afterPlace: string | null;
  /** "60 minutes later" or "to Radical 19:45": the headline's own words for the move. */
  shift: string | null;
};

/**
 * Reads the stage names, the shared window and the new place out of `clashLine`, `moveLine` and
 * `receiptLead`, which `buildDecisionCopy` wrote from the same figures. Nothing is invented: a line that
 * does not match leaves its part null and the drawing simply omits it.
 */
export function readTimelineFacts(copy: DecisionCopy, line: SharedTimeline): TimelineFacts {
  const facts: TimelineFacts = {
    stayingStage: null,
    movingStage: null,
    window: null,
    afterStage: null,
    afterPlace: null,
    shift: null,
  };
  const pair = /: (.+?) \(([^()]+)\) and (.+?) \(([^()]+)\) share /.exec(copy.clashLine);
  if (pair) {
    if (pair[1] === line.stayingName && pair[3] === line.movingName) {
      facts.stayingStage = pair[2];
      facts.movingStage = pair[4];
    } else if (pair[3] === line.stayingName && pair[1] === line.movingName) {
      facts.stayingStage = pair[4];
      facts.movingStage = pair[2];
    }
  }
  facts.window = /share [^,.]*?minutes?, (\d{2}:\d{2}–\d{2}:\d{2})\./.exec(copy.clashLine)?.[1] ?? null;
  const place = /lowest index is (.+?) (\d{2}:\d{2}–\d{2}:\d{2}) \(/.exec(copy.moveLine);
  facts.afterStage = place ? place[1] : null;
  facts.afterPlace = place ? place[2] : null;
  const lead = copy.receiptLead;
  facts.shift = lead && lead.startsWith(`${line.movingName} `) ? lead.slice(line.movingName.length + 1) : null;
  return facts;
}

/**
 * A plain sentence for how to read the drawing: who clashes, where and when, and what the move does, with
 * each lane's stage and time range as its label shows them (the ranges from `spans`, the drawing's own
 * times; left off when it is null). Null without the stages.
 */
export function timelineSentence(
  copy: DecisionCopy,
  line: SharedTimeline,
  facts: TimelineFacts,
  spans: ReturnType<typeof timelineSpans> = null,
): string | null {
  if (copy.minutesBefore === null || copy.minutesAfter === null || !facts.stayingStage || !facts.movingStage) return null;
  const when = facts.window ? ` ${facts.window}` : "";
  const minutes = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;
  const range = (span: { start: number; end: number } | undefined) => (span ? formatRange(span) : null);
  // "(Main, 20:00–21:30)": the parts the lane's label shows, in its order; nothing when it shows neither.
  const at = (...parts: (string | null)[]) => {
    const said = parts.filter(Boolean);
    return said.length > 0 ? ` (${said.join(", ")})` : "";
  };
  const first =
    facts.stayingStage === facts.movingStage
      ? `${line.stayingName}${at(range(spans?.staying))} and ${line.movingName}${at(range(spans?.now))} on ${facts.stayingStage}`
      : `${line.stayingName}${at(facts.stayingStage, range(spans?.staying))} and ${line.movingName}${at(facts.movingStage, range(spans?.now))}`;
  const left = copy.minutesAfter === 0 ? "no time shared" : `${minutes(copy.minutesAfter)} shared`;
  const tested = at(facts.afterStage ?? facts.movingStage, range(spans?.tested));
  return `Now: ${first} share${when}, ${minutes(copy.minutesBefore)}. Tested: ${line.movingName}${facts.shift ? ` ${facts.shift}` : ""}${tested} leaves ${left}.`;
}

/**
 * The published times behind the drawing, read back from its own geometry: `sharedTimeline` puts a tick
 * every 15 minutes from the axis's first quarter hour and labels some of them, so one labelled tick fixes
 * the clock and the tick spacing fixes the scale. Nothing is computed that the card did not already hold.
 * Null when no tick is labelled.
 */
export function timelineSpans(line: SharedTimeline): {
  staying: { start: number; end: number };
  now: { start: number; end: number };
  tested: { start: number; end: number };
} | null {
  const ticks = line.ticks;
  const at = ticks.findIndex((tick) => /^\d{2}:\d{2}$/.test(tick.label));
  if (at < 0 || ticks.length < 2) return null;
  const [h, m] = ticks[at].label.split(":").map(Number);
  const first = h * 60 + m - 15 * at;
  const unit = (ticks[ticks.length - 1].x - ticks[0].x) / (15 * (ticks.length - 1));
  if (!(unit > 0)) return null;
  const minute = (x: number) => Math.round(first + (x - ticks[0].x) / unit);
  const span = (bar: TimelineBar) => ({ start: minute(bar.x), end: minute(bar.x + bar.w) });
  return { staying: span(line.staying), now: span(line.movingNow), tested: span(line.movingAfter) };
}

/**
 * The hero's three lanes on one `PairStrip`, each label the same three lines: the act, then its role and
 * stage, then its time range. The staying set: its stage. The moving set Now: "Now · {stage}", where it
 * plays on the published timetable. Tested (the move, dashed): "Tested · {stage}", the stage the move puts
 * it on, or the same stage when the move keeps it. Every range is the drawing's own times
 * (`timelineSpans`), with an en dash, which the strip sets in mono. The minutes under each bracket are the
 * card's own.
 */
function heroLanes(
  line: SharedTimeline,
  facts: TimelineFacts,
  minutesBefore: number | null,
  minutesAfter: number | null,
): StripLane[] | null {
  const spans = timelineSpans(line);
  if (!spans) return null;
  const testedStage = facts.afterStage ?? facts.movingStage;
  return [
    {
      key: "staying",
      kind: "staying",
      name: line.stayingName,
      meta: facts.stayingStage,
      range: formatRange(spans.staying),
      ...spans.staying,
    },
    {
      key: "now",
      kind: "now",
      name: line.movingName,
      meta: facts.movingStage ? `Now · ${facts.movingStage}` : "Now",
      range: formatRange(spans.now),
      minutes: minutesBefore,
      ...spans.now,
    },
    {
      key: "tested",
      kind: "tested",
      name: line.movingName,
      meta: testedStage ? `Tested · ${testedStage}` : "Tested",
      range: formatRange(spans.tested),
      minutes: minutesAfter,
      ...spans.tested,
    },
  ];
}

function LineLabel({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("pt-0.5 font-mono text-xs text-muted-foreground tabular-nums", className)}>
      <span className="sr-only">Line </span>
      {n}
    </span>
  );
}

/**
 * Holds the receipt's footprint while the day's decision loads: no heading, nothing to read. The same open
 * frame as the receipt (one 1px rule along the top, nothing else) and the same rows at the heights the
 * receipt's own rows take (the dateline, the heading, the index block, below 1024 px the 44 px button
 * under it, the strip of three lanes and its key, the taste line, the action row, in that order, as the
 * receipt puts them), so the swap moves nothing below it.
 */
export function DecisionCardSkeleton() {
  const bar = "rounded-sm bg-muted";
  return (
    <div aria-hidden="true" className="border-t border-border pt-5 sm:pt-6">
      <div>
        <div className="flex h-5 items-center">
          <div className={cn(bar, "h-3 w-2/5")} />
        </div>
        <div className="mt-1 flex h-13 items-center sm:h-7.5">
          <div className={cn(bar, "h-6 w-4/5")} />
        </div>
        {/* The index block with its scale line: 132 px at 390 px, 97 px from 640 px (measured). */}
        <div className="mt-3 flex h-33 flex-col justify-center gap-2.5 sm:h-24.25">
          <div className={cn(bar, "h-3 w-1/4")} />
          <div className={cn(bar, "h-6 w-1/2")} />
          <div className={cn(bar, "h-3 w-4/5")} />
          <div className={cn(bar, "h-3 w-3/4")} />
        </div>
        {/* Below 1024 px: "Keep this move", 44 px, under the index block. */}
        <div className="mt-4 flex h-11 items-center lg:hidden max-sm:mt-3">
          <div className={cn(bar, "h-11 w-37")} />
        </div>
        <div className="mt-3 flex h-62.5 flex-col justify-around max-lg:mt-4 max-sm:mt-3">
          {[0, 1, 2].map((lane) => (
            <div key={lane} className="flex items-center gap-3">
              <div className={cn(bar, "h-3 w-24 shrink-0")} />
              <div className={cn(bar, "h-3 flex-1")} />
            </div>
          ))}
        </div>
        <div className="mt-4 flex h-10 items-center sm:h-5">
          <div className={cn(bar, "h-3 w-3/5")} />
        </div>
        <div className="mt-5 flex h-11 items-center">
          <div className={cn(bar, "h-3 w-28")} />
        </div>
      </div>
    </div>
  );
}

type DecisionCardProps = {
  copy: DecisionCopy;
  /** Keeps the one move as the plan. Absent in the server HTML, where the page cannot act yet. */
  onOpenMove?: () => string | null | void;
  /** Opens the rule search for the pair. Absent when there is no rule line to try. */
  onTryRule?: () => void;
  /**
   * Keeps line 3's change as one step of the plan. Absent in the server HTML and without that change.
   * It may return what the status line should say instead of the default (the plan already holds the
   * change, or the change takes the place of earlier steps), so nothing is dropped silently.
   */
  onKeepChange?: () => string | null | void;
  /** What the plan already holds of this card: the move, and line 3's change. */
  kept?: { move: boolean; change: boolean };
  /** Opens the day's hero clash (a hidden clash when it has one), with the button as the place to return to. */
  onOpenHidden?: (trigger: HTMLElement) => void;
  /** What that link says; "Open a hidden clash" unless the day has none. */
  hiddenLabel?: string;
  /** "Same clash, three readings", above the actions; absent in the server HTML, which has no lens data. */
  readings?: ReactNode;
  /**
   * The published day's saved Qloo reading: when it was built and how many saved responses built it.
   * Printed in the working with the Recorded stamp; never on the invented day, even when passed.
   */
  saved?: SavedReading | null;
  /**
   * Opens this pair's existing clash drawer, with the button as the place to return to. With it, and
   * while the server answers live pair checks, the working offers the re-check, which only opens the
   * drawer: the drawer's own button asks before anything is sent.
   */
  onOpenPair?: (trigger: HTMLElement) => void;
  className?: string;
};

/**
 * What the index change means, under the figure: "−2.4 index points · lower is better". Read from the
 * same two readings the figure shows (one decimal each), so it can never disagree with them; a real minus
 * sign (U+2212), and a plus when the index would rise. Null when either reading is not a number.
 */
export function indexDelta(before: string | null, after: string | null): string | null {
  if (before === null || after === null) return null;
  const from = Number(before);
  const to = Number(after);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const tenths = Math.round((to - from) * 10);
  const size = (Math.abs(tenths) / 10).toFixed(1);
  const sign = tenths < 0 ? "−" : tenths > 0 ? "+" : "";
  return `${sign}${size} index points · lower is better`;
}

/**
 * The dateline as the card prints it: the festival and day joined by a comma, then one middot before
 * the kind of timetable ("Glastonbury 2025, Sunday · published timetable"). Every word of the title
 * stays; only the first separator changes. A title with no separator prints as it is.
 */
export function datelineText(title: string): string {
  return title.replace(" · ", ", ");
}

/** The label of the one disclosure toggle, whose region holds the comparison and rows 1 to 3. */
export const SHOW_WORKING = "Show the working";

/** The subhead over rows 1 to 3, inside that disclosure. */
export const HOW_CHOSEN = "How this was chosen";

/** The card's one filled action: it keeps the move as the plan. */
export const KEEP_MOVE = "Keep this move";

/** What the card says, in place, once the plan holds its move, and the link to that plan. */
export const KEPT_IN_PLAN = "Kept in your plan.";
export const SEE_YOUR_PLAN = "See your plan";
/** The plan card's heading (Try a move), which the link scrolls to and focuses. */
export const PLAN_ANCHOR = "your-plan";

/**
 * The index's scale, in the index block on every day: the same definition the dial uses, and the
 * pinned "Lower is better". The scale is this app's, not a Qloo figure, so the invented day says the same.
 */
export const INDEX_SCALE = "A score, not money: 100 = the average random valid timetable of this lineup. Lower is better.";

/**
 * The hero's own clash, when it carries the board's Hidden label: the Hidden wall's definition
 * (`LABEL_META.hidden.explain`), so the card and the wall say one thing. Names no source, so it reads
 * the same on the invented day.
 */
export const HIDDEN_CLASH_LINE = `A hidden clash: ${LABEL_META.hidden.explain.charAt(0).toLowerCase()}${LABEL_META.hidden.explain.slice(1)}`;

/**
 * Whether the card's pair carries the Hidden label. `buildDecisionCopy` writes "Their main genre tags
 * differ; ..." into line 1 for exactly that label, so the card reads it from its own copy.
 */
export function isHiddenDecision(copy: Pick<DecisionCopy, "clashLine">): boolean {
  return copy.clashLine.includes("Their main genre tags differ;");
}

/** Whether the card is for the invented day, whose dateline says so (`decisionDateline`). */
export function isInventedDecision(copy: Pick<DecisionCopy, "title">): boolean {
  return copy.title.startsWith("Invented day");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Oct 2026" in UTC, so the server and every browser print the same day; null when it is not a date. */
export function builtDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** What the saved reading of a published day is: when it was built and from how many saved Qloo responses. */
export type SavedReading = { builtAt: string; requests: number };

/**
 * "Saved Qloo reading of this day: built 3 Oct 2026 from 104 saved Qloo responses." The count is the
 * whole day's build (most were served from the build's own cache), never this pair's. Null without a
 * date or a count.
 */
export function savedReadingLine(saved: SavedReading): string | null {
  const date = builtDate(saved.builtAt);
  if (!date || !Number.isInteger(saved.requests) || saved.requests < 1) return null;
  const responses = saved.requests === 1 ? "1 saved Qloo response" : `${saved.requests} saved Qloo responses`;
  return `Saved Qloo reading of this day: built ${date} from ${responses}.`;
}

/** The working's text action that opens this pair's clash drawer, where the live re-check asks before it sends. */
export const RECHECK_PAIR = "Re-check this pair with Qloo (3 requests)";

/**
 * "See your plan": scrolls the plan card's heading into view (at once under reduced motion) and gives it
 * focus without a second scroll. Without that heading on the page the link is left to the browser.
 */
export function seeYourPlan(
  event: { preventDefault: () => void },
  doc: Pick<Document, "getElementById"> = document,
  reduce: boolean = reducedMotion(),
): boolean {
  const target = doc.getElementById(PLAN_ANCHOR);
  if (!target) return false;
  event.preventDefault();
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  target.focus({ preventScroll: true });
  return true;
}

/**
 * Focuses the first of the links that is displayed (the card draws one copy per width, the other
 * display:none), without scrolling the page. Returns the one it focused.
 */
export function focusShown(links: readonly (HTMLElement | null)[]): HTMLElement | null {
  const shown = links.find((link) => link !== null && link.getClientRects().length > 0) ?? null;
  shown?.focus({ preventScroll: true });
  return shown;
}

/**
 * The confirmation in place, under the button that was pressed: a polite live region that, once the
 * plan holds the card's move, reads "Kept in your plan." in ink with the "See your plan" link. Empty
 * otherwise, so it takes no room.
 */
function KeptNotice({
  shown,
  linkRef,
  className,
}: {
  shown: boolean;
  linkRef: RefObject<HTMLAnchorElement | null>;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" data-kept-notice="" className={className}>
      {shown ? (
        <p className="flex flex-wrap items-center gap-x-3 text-sm leading-snug text-foreground">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Check aria-hidden="true" className="size-4 shrink-0" />
            {KEPT_IN_PLAN}
          </span>
          <a
            ref={linkRef}
            href={`#${PLAN_ANCHOR}`}
            onClick={(event) => seeYourPlan(event)}
            className="inline-flex min-h-11 items-center font-semibold text-foreground underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground"
          >
            {SEE_YOUR_PLAN}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** The re-check action itself, with no hook: it only opens the pair's drawer and sends nothing. */
export function PairRecheck({ onOpenPair }: { onOpenPair: (trigger: HTMLElement) => void }) {
  return (
    <Button
      type="button"
      variant="ruled"
      className="py-2 text-left whitespace-normal"
      onClick={(event) => onOpenPair(event.currentTarget)}
    >
      {RECHECK_PAIR}
      <ArrowRight aria-hidden="true" />
    </Button>
  );
}

/** Shows the re-check only while this server answers live pair checks (`/api/health`). */
function PairRecheckWhenOn({ onOpenPair }: { onOpenPair: (trigger: HTMLElement) => void }) {
  const enabled = usePairCheckEnabled();
  return enabled ? <PairRecheck onOpenPair={onOpenPair} /> : null;
}

/**
 * One worked decision on the published day: the festival and day as a dateline, then the action and
 * its result as the heading ("Sprints 15 minutes later: 45 → 30 minutes shared"), then the labelled index
 * with one caption under it (who selected and scored it, and that it is a reading, not a verdict), the
 * drawn timeline across the card, the pointer to the three readings, then one row: the one solid button,
 * "Keep this move", and directly after it the "Show the working" toggle. Below 1024 px that button sits
 * instead directly under the index block, before the drawing, and the row holds the toggle alone; one
 * copy is displayed at each width. The working opens directly under that row: the hidden-clash link
 * first, then the two changes side by side under the table's own heading, with
 * the secondary actions (the rule search, the keep button and what it keeps) under the table, then "How
 * this was chosen", rows 1 to 3: the clash, the lowest-index move and the rule search for the pair, with
 * the rule-check sentence beside row 3. A card without that comparison shows the secondary actions under
 * the button as before. The rows are in the server HTML, in a region marked `hidden` until it is opened.
 * Every string comes from `buildDecisionCopy`, so the server HTML and this client card are the same
 * card. It never changes the dial, which stays the reading of the published timetable.
 */
export function DecisionCard({
  copy,
  onOpenMove,
  onTryRule,
  onKeepChange,
  kept,
  onOpenHidden,
  hiddenLabel,
  readings,
  saved,
  onOpenPair,
  className,
}: DecisionCardProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [playKey, setPlayKey] = useState(0);
  const [status, say] = useAnnouncement();
  const ruleLineId = useId();
  const changeSummaryId = useId();
  // "Show the working": closed on every load; the region's id is what its toggle controls.
  const [workingOpen, setWorkingOpen] = useState(false);
  const workingId = useId();
  const workingToggleId = useId();
  const counted = useCount(copy.indexFrom, copy.indexTo, playKey);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const invented = isInventedDecision(copy);

  // "Keep this move" confirms in place: once the plan holds the card's move (or, for a card told
  // nothing about the plan, once pressed) the notice under the button reads "Kept in your plan." with
  // its link. A press moves focus to that link, never to the page, and never scrolls it.
  const [pressed, setPressed] = useState(false);
  const keptShown = kept ? kept.move : pressed;
  const [focusAsk, setFocusAsk] = useState<{ key: number; at: number }>({ key: 0, at: 0 });
  const focusedAsk = useRef(0);
  const earlyLinkRef = useRef<HTMLAnchorElement | null>(null);
  const rowLinkRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (focusAsk.key === 0 || !keptShown || focusedAsk.current === focusAsk.key) return;
    focusedAsk.current = focusAsk.key;
    // A plan that took longer than two seconds to hold the move is no answer to this press.
    if (Date.now() - focusAsk.at > 2000) return;
    focusShown([earlyLinkRef.current, rowLinkRef.current]);
  }, [focusAsk, keptShown]);

  // M1, the hero receipt: once the interactive card is in view (or 1.2 s after it mounts), the shared
  // time hatches in, the tested slot flies, the bracket under what is left shrinks and the index counts
  // down. The server HTML is the final frame; under reduced motion and in print nothing plays. While
  // the opening reveal covers the page it waits, so it plays on the card the visitor can see.
  const [heroPlay, setHeroPlay] = useState<number | null>(null);
  const introDone = useIntroDone();
  const receiptReady = Boolean(onOpenMove) && copy.timeline !== null && copy.indexFrom !== null && !receiptPlayed;
  const receiptInView = useInView(rootRef, { threshold: 0.6, fallbackMs: 1200, enabled: receiptReady && introDone });
  useEffect(() => {
    if (!receiptInView || receiptPlayed) return;
    // Set inside the timer, so an effect run that is cleaned up at once (React's development check)
    // does not use up the page's one play.
    const timer = window.setTimeout(() => {
      receiptPlayed = true;
      // A press of "Keep this move" got there first: that was the play.
      if (playKey > 0) return;
      setHeroPlay(1);
      setPlayKey(1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [receiptInView, playKey]);

  // The reveal runs once per page load, after the card is in the page: the server HTML is already
  // readable, so nothing waits on it.
  useEffect(() => {
    if (revealed) return;
    revealed = true;
    if (!reducedMotion()) rootRef.current?.classList.add("cc-card-enter");
  }, []);

  function openMove() {
    if (!onOpenMove) return;
    setPressed(true);
    setFocusAsk((previous) => ({ key: previous.key + 1, at: Date.now() }));
    // Pressing it again for a move the plan already holds changes nothing and says so.
    if (kept?.move) {
      say(ALREADY_KEPT);
      onOpenMove();
      return;
    }
    setHeroPlay(null);
    setPlayKey((key) => key + 1);
    const extra = onOpenMove();
    say([copy.testing, typeof extra === "string" ? extra : null].filter(Boolean).join(" "));
  }

  function tryRule() {
    if (!onTryRule) return;
    say("");
    onTryRule();
  }

  function keepChange() {
    if (!onKeepChange) return;
    if (kept?.change) {
      say(ALREADY_KEPT);
      onKeepChange();
      return;
    }
    const extra = onKeepChange();
    say([copy.testingChange, typeof extra === "string" ? extra : null].filter(Boolean).join(" "));
  }

  const receiptShown =
    copy.receipt !== null && copy.receiptLead !== null && copy.minutesBefore !== null && copy.minutesAfter !== null;

  const deltaText = indexDelta(copy.indexBefore, copy.indexAfter);
  const delta = deltaText
    ? { figure: deltaText.slice(0, deltaText.indexOf(" ")), words: deltaText.slice(deltaText.indexOf(" ") + 1) }
    : null;
  const figure =
    copy.indexBefore !== null && copy.indexAfter !== null ? (
      // The score as one block of about 80 px: the label, the figure with what its change means on the
      // same baseline, then one caption: who selected and scored it, and what kind of claim it is. It is
      // outside the working in every state of the card, so the caption is read with no click.
      <div data-index-block="" className="mt-3">
        <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Clash Budget Index</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className="type-numeral text-[1.75rem] leading-none tabular-nums">
            <span aria-hidden="true">
              {copy.indexBefore} → {counted ?? copy.indexAfter}
            </span>
            <span className="sr-only">
              {copy.indexBefore} to {copy.indexAfter}.
            </span>
          </p>
          {delta ? (
            <p className="text-[0.8125rem] leading-snug text-muted-foreground">
              {/* Mono for the figure only; its words in the sans. */}
              <span className="font-mono tabular-nums">{delta.figure}</span> {delta.words}
            </p>
          ) : null}
        </div>
        {/* The scale, where the index first appears; the attribution stays the block's last line. */}
        <p data-index-scale="" className="mt-1 text-[0.8125rem] leading-snug text-muted-foreground">
          {INDEX_SCALE}
        </p>
        <p className="mt-1 text-[0.8125rem] leading-snug text-muted-foreground">{ATTRIBUTION}. A reading, not a verdict.</p>
      </div>
    ) : null;

  // The taste line says so when the card's own clash carries the Hidden label: in ink, as a fact of
  // the board, never the teal of a Qloo figure.
  const hiddenLine = isHiddenDecision(copy) ? (
    <p data-hidden-line="" className="text-sm leading-snug">
      {HIDDEN_CLASH_LINE}
    </p>
  ) : null;
  // The working's last lines on a published day: where the reading came from, with the Recorded stamp,
  // and (while the server answers live pair checks) the way to this pair's drawer and its re-check.
  const savedLine = !invented && saved ? savedReadingLine(saved) : null;
  const recheck = !invented && onOpenPair ? <PairRecheckWhenOn onOpenPair={onOpenPair} /> : null;

  const timelineFacts = copy.timeline ? readTimelineFacts(copy, copy.timeline) : null;
  const timelineText =
    copy.timeline && timelineFacts
      ? timelineSentence(copy, copy.timeline, timelineFacts, timelineSpans(copy.timeline))
      : null;
  const lanes =
    copy.timeline && timelineFacts ? heroLanes(copy.timeline, timelineFacts, copy.minutesBefore, copy.minutesAfter) : null;
  // The first play of the page is the hero receipt (the shared time hatches in, the slot flies, the
  // bracket shrinks); a press of "Keep this move" after it replays the bracket alone.
  const motion =
    playKey === 0
      ? null
      : { mode: heroPlay !== null && heroPlay === playKey ? ("hero" as const) : ("replay" as const), key: playKey };
  // Wrapped labels instead of a label running past the card; the button keeps a 44 px height at least.
  const wrap = "h-auto min-h-11 py-2 text-left whitespace-normal";
  const showMove = Boolean(onOpenMove && copy.seedMove);
  // Below 1024 px "Keep this move" sits directly under the reading, after the index block (never inside
  // it, so "A reading, not a verdict." stays the block's last line) and before the drawing, so a phone's
  // first screen holds the result, its one filled action and the clash. From 1024 px this copy is
  // display:none and the action row's copy shows instead: one copy displayed at every width, neither
  // with an id. Both call the same `openMove`, so the M1 play and its replay start from either.
  const earlyMove =
    showMove && figure ? (
      <div className="mt-4 lg:hidden max-sm:mt-3">
        <Button type="button" variant="default" className={wrap} onClick={openMove}>
          {KEEP_MOVE}
        </Button>
        <KeptNotice shown={keptShown} linkRef={earlyLinkRef} className={keptShown ? "mt-1" : undefined} />
      </div>
    ) : null;
  const timeline = lanes ? (
    // One pair strip across the card: the staying set once, then the moving set Now and Tested. Its words
    // are HTML at fixed sizes, so nothing grows with the width. At every width it and its key sit directly
    // under the index (below 1024 px under the index and its "Keep this move") and before the taste line
    // and the action row, so a phone's first screen shows the clash itself. It holds nothing focusable.
    <figure
      data-shared-time=""
      className={cn("mt-3 w-full min-w-0 max-sm:mt-4", earlyMove && "max-lg:mt-4 max-sm:mt-3")}
    >
      <PairStrip lanes={lanes} description={timelineText} motion={motion} evenPitch />
      <figcaption className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">
        Solid: where the sets play now. Dashed: tested. Hatched: time shared.
      </figcaption>
    </figure>
  ) : null;

  // The secondary actions are ruled text (the button's "ruled" variant), like a note in a running
  // order's margin: no fill, no box. Only "Keep this move" is a solid button.
  const ruled = "py-2 text-left whitespace-normal";
  const showRule = Boolean(onTryRule && copy.seedRule);
  const showKeep = Boolean(onKeepChange && copy.seedChange);
  const secondary =
    showRule || showKeep ? (
      <div className="flex flex-wrap gap-x-6">
        {showRule ? (
          <Button type="button" variant="ruled" className={ruled} onClick={tryRule}>
            Try this rule yourself
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : null}
        {showKeep ? (
          // Not disabled once kept: it stays pressable so a repeat press says "Already in your plan."
          // and a keyboard visitor never loses focus to the page. Once kept it is a quiet state: a
          // check, no underline, muted ink.
          <Button
            type="button"
            variant="ruled"
            data-kept={kept?.change ? "" : undefined}
            className={cn(ruled, kept?.change && "text-muted-foreground no-underline")}
            aria-describedby={`${ruleLineId} ${changeSummaryId}`}
            onClick={keepChange}
          >
            {kept?.change ? (
              <>
                <Check aria-hidden="true" />
                In your plan<span className="sr-only">: {copy.changeLabel?.replace(/^Keep /, "")}</span>
              </>
            ) : (
              (copy.changeLabel ?? "Keep this change")
            )}
          </Button>
        ) : null}
      </div>
    ) : null;
  // What the keep button keeps, under the buttons, across the card's width.
  const changeSummary =
    onKeepChange && copy.seedChange && copy.changeSummary ? (
      <p id={changeSummaryId} className="mt-2 max-w-prose text-[0.8125rem] leading-snug text-muted-foreground">
        {copy.changeSummary}
      </p>
    ) : null;
  // With a comparison on the card, "Keep this move" is the one action in view; the rule search and the
  // keep button with its summary sit under the comparison, in "Show the working".
  const tucked = copy.tradeoff !== null;
  // The day's hero clash, as a ruled text link with its arrow: the first line of the working, one click
  // away. The same ruled line of type as the card's other text actions, 44 px tall.
  const hiddenLink = onOpenHidden ? (
    <Button
      type="button"
      variant="ruled"
      className={cn(ruled, "text-[0.9375rem]")}
      onClick={(event) => onOpenHidden(event.currentTarget)}
    >
      {hiddenLabel ?? "Open a hidden clash"}
      <ArrowRight aria-hidden="true" />
    </Button>
  ) : null;
  // "Show the working": the disclosure toggle directly after "Keep this move" from 1024 px, and the action
  // row's only control below it, where that button sits under the reading. A native button, so click,
  // Enter and Space all work; the region it controls
  // carries `hidden` while closed, so nothing in it is in the tab order. Its 12 px corner and 8 px sides
  // (pulled back by the same 8 px) give the global focus ring a rounded box around the chevron and its label.
  const workingToggle = (
    <button
      type="button"
      id={workingToggleId}
      aria-expanded={workingOpen}
      aria-controls={workingId}
      onClick={() => setWorkingOpen((value) => !value)}
      className="cc-disclosure-summary -mx-2 min-h-11 rounded-md border-0 bg-transparent px-2 text-left"
    >
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out",
          workingOpen && "rotate-90",
        )}
      />
      <span>{SHOW_WORKING}</span>
    </button>
  );
  const actions = (
    <div className="mt-5 min-w-0">
      <div className="flex w-full flex-wrap items-center justify-start gap-x-6 gap-y-2">
        {showMove ? (
          // From 1024 px only; below it the copy under the reading is the one shown (`earlyMove`). Without
          // that copy (no index block) this one shows at every width, as before.
          <Button
            type="button"
            variant="default"
            className={cn(wrap, "max-[390px]:w-full", earlyMove && "max-lg:hidden")}
            onClick={openMove}
          >
            {KEEP_MOVE}
          </Button>
        ) : null}
        {workingToggle}
      </div>
      {/* The row's own confirmation, shown with the row's button (from 1024 px when the card has the early copy). */}
      {showMove ? (
        <KeptNotice
          shown={keptShown}
          linkRef={rowLinkRef}
          className={cn(keptShown && "mt-1", earlyMove && "max-lg:hidden")}
        />
      ) : null}
      {tucked ? null : secondary}
      {tucked ? null : changeSummary}
    </div>
  );

  return (
    <section
      id={DECISION_ID}
      aria-labelledby={DECISION_HEADING_ID}
      ref={rootRef}
      className={cn(
        // An open composition on the page's paper, not a box: one 1px decorative rule along the top and
        // nothing else (no corner, no side or foot edge, no fill, no shadow), its text and its strip starting
        // at the column's own left edge: a read-only receipt drawn with the timetable's own marks. It reads
        // in source order at every width: the dateline, the heading, the index with its caption, (below
        // 1024 px) "Keep this move", the drawing and its key, the taste line, the action row and the working.
        "@container min-w-0 border-t border-border pt-5 sm:pt-6",
        className,
      )}
    >
      {/* The festival and day are the dateline; the heading is the action and its result, or the
          dateline alone, as a title, when no move lowers the index. */}
      {receiptShown ? (
        <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
          {datelineText(copy.title)}
        </p>
      ) : null}
      <h2
        id={DECISION_HEADING_ID}
        ref={headingRef}
        tabIndex={-1}
        className={cn(
          "break-words outline-none",
          // Under 640 px the two-line heading gets a little more air between its lines.
          receiptShown ? "type-title mt-1 max-sm:leading-[1.15]" : "type-title max-sm:leading-[1.15]",
        )}
      >
        {receiptShown ? (
          <>
            {copy.receiptLead}:{" "}
            <span className="type-numeral">
              {copy.minutesBefore}
              <span aria-hidden="true"> → </span>
              <span className="sr-only"> to </span>
              {copy.minutesAfter}
            </span>{" "}
            {copy.minutesAfter === 1 ? "minute" : "minutes"} shared
          </>
        ) : (
          copy.title
        )}
      </h2>

      {figure}
      {/* Below 1024 px the one filled action, directly under the reading; from 1024 px it is in the action row. */}
      {earlyMove}
      {/* The drawing spans the card; the pointer to the three readings, then the action row, sit under it. */}
      {timeline}
      {hiddenLine || readings ? (
        <div className="mt-4 space-y-1">
          {hiddenLine}
          {readings}
        </div>
      ) : null}
      {actions}

      {/* The working, directly under the button's row: the hidden-clash link first, then the two changes
          side by side (when the card has a comparison, with the secondary actions under it) and rows 1 to 3. */}
      <div
        id={workingId}
        role="region"
        aria-labelledby={workingToggleId}
        data-working=""
        hidden={!workingOpen}
        className="mt-4"
      >
        {hiddenLink ? <div className="mb-4">{hiddenLink}</div> : null}
        {copy.tradeoff ? (
          <div className="mb-5 border-b border-border pb-5">
            {/* The table's own heading is the subhead: a small kicker over its column note and rows. */}
            <TradeoffTable tradeoff={copy.tradeoff} held={kept} compact />
            {secondary || changeSummary ? (
              <div className="mt-4 border-t border-border pt-3">
                {secondary}
                {changeSummary}
              </div>
            ) : null}
          </div>
        ) : null}
        <h3 className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">{HOW_CHOSEN}</h3>
        <div className="cc-card-body mt-3 mb-1 space-y-4 text-sm leading-[1.5]">
          <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            <LineLabel n={1} />
            <p>{copy.clashLine}</p>
          </div>

          <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            <LineLabel n={2} />
            <div className="min-w-0">
              <p>{copy.moveLine}</p>
              {copy.rangeLine ? <p className="mt-2 text-[0.8125rem] text-muted-foreground">{copy.rangeLine}</p> : null}
            </div>
          </div>

          {copy.ruleLine ? (
            <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 border-t border-border pt-3">
              <LineLabel n={3} />
              <div className="min-w-0">
                <p id={ruleLineId}>{copy.ruleLine}</p>
                {/* What row 3 is, beside it: checked against the rules, its index for information. */}
                {copy.limitsLine ? (
                  <p className="mt-2 text-[0.8125rem] text-muted-foreground">{copy.limitsLine}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {savedLine ? (
          <div data-saved-reading="" className="mt-4 border-t border-border pt-3">
            <p className="max-w-prose text-[0.8125rem] leading-snug text-muted-foreground">
              <ProvenanceChip provenance="recorded" size="sm" className="mr-1.5" /> {savedLine}
            </p>
            {recheck}
          </div>
        ) : (
          recheck
        )}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </section>
  );
}
