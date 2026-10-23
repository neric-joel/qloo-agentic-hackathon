"use client";

import { useId, useState, type RefObject } from "react";
import { ArrowRight, Check, ChevronRight, LoaderCircle } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { ATTRIBUTION, type DecisionCopy, type SharedTimeline, type TimelineBar } from "@/lib/decision";
import { pluralize } from "@/lib/format";
import { rangeLead } from "@/lib/plan-copy";
import { ALREADY_KEPT } from "@/lib/rule-fix";
import { isRuleStackStep, keptWord, sameStep, type ScaleRange, type StackStep } from "@/lib/stack";
import { cn } from "@/lib/utils";

import { TradeoffTable } from "./tradeoff-table";
import { usePairCheckEnabled } from "./use-agent-status";
import { useAnnouncement } from "./use-announcement";

/** The anchor of the hero's decision group, for the hero button and the jump links. */
export const DECISION_ID = "one-decision";
export const DECISION_HEADING_ID = "decision-heading";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

function LineLabel({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("pt-0.5 text-xs text-muted-foreground tabular-nums", className)}>
      <span className="sr-only">Line </span>
      {n}
    </span>
  );
}

/**
 * Which part of the index card a rendering draws. "whole" is the card with everything in it. The section on what
 * taste changes renders the card twice: "card" is the card, whose hidden-clash line, two-set change line and their
 * two actions show below 1024px only, and "beside" is those two lines with their actions, shown from 1024px only, in
 * the section's right column beside the card, so the change line's index figure keeps the card's scale in view.
 */
export type DecisionPart = "whole" | "card" | "beside";

export type DecisionDetailsProps = {
  copy: DecisionCopy;
  /** The part of the card to draw (`DecisionPart`); the whole card by default. */
  part?: DecisionPart;
  /** Opens the rule search for the pair. Absent when there is no rule line to try. */
  onTryRule?: () => void;
  /**
   * Keeps line 3's change as one step of the plan. Absent in the server HTML and without that change.
   * It may return what the status line should say instead of the default (the plan already holds the
   * change, or the change takes the place of earlier steps), so nothing is dropped silently.
   */
  onKeepChange?: () => string | null | void;
  /** What the plan already holds of this decision: the move, and line 3's change. */
  kept?: { move: boolean; change: boolean };
  /**
   * Opens the clash the hidden-clash line describes when the card has that line, otherwise the day's hero clash,
   * with the button as the place to return to.
   */
  onOpenHidden?: (trigger: HTMLElement) => void;
  /** What that link says; "Open a hidden clash" unless the day has none. */
  hiddenLabel?: string;
  /**
   * How many of the day's ranked clashes carry the Hidden label (the board's own labels). With it the
   * hidden-clash line says "1 of N on this day"; without it, or below 1, that part is left out.
   */
  hiddenCount?: number;
  /**
   * How many ranked clashes the day has, from the same list the Hidden count is read from. With it (and the
   * Hidden count) the hidden-clash line says "1 of 5 among the day's 15 ranked clashes".
   */
  rankedCount?: number;
  /** The two acts' main genre tags, for the hidden-clash line; left out unless both are saved. */
  genres?: readonly (string | null)[] | null;
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
 * What the index change is, beside the figure: "−2.4 index points". Read from the same two readings the
 * figure shows (one decimal each), so it can never disagree with them; a real minus sign (U+2212), and a
 * plus when the index would rise. Null when either reading is not a number. What the scale means (100, and a
 * reading above it) is said once, in the scale line under it.
 */
export function indexDelta(before: string | null, after: string | null): string | null {
  if (before === null || after === null) return null;
  const from = Number(before);
  const to = Number(after);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const tenths = Math.round((to - from) * 10);
  const size = (Math.abs(tenths) / 10).toFixed(1);
  const sign = tenths < 0 ? "−" : tenths > 0 ? "+" : "";
  return `${sign}${size} index points`;
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

/** The hero's one filled action: it keeps the move as the plan. */
export const KEEP_MOVE = "Keep this move";

/** What the hero says, in place, once the plan holds its move, and the link to that plan. */
export const KEPT_IN_PLAN = "Kept in your plan.";
/** Said with it: a kept move is a plan, not a change to the published timetable. */
export const KEPT_AGREE = "Nothing moves until the acts’ teams agree.";
export const SEE_YOUR_PLAN = "See your plan";
/** The plan card's heading (Try a move), which the link scrolls to and focuses. */
export const PLAN_ANCHOR = "your-plan";
/**
 * Said with it while the drawing shows the day without the move, so a kept move is never read off a drawing
 * that does not show it. The invented timetable was never published, so it says "without the move".
 */
export const DRAWN_AS_PUBLISHED = "Drawn here as published.";
export const DRAWN_WITHOUT_MOVE = "Drawn here without the move.";

/**
 * The index's scale, in the index block on every day: the same definition the dial uses, then what a reading
 * above 100 means, in the legend's own word for cost ("Clash link: stronger = costlier"). The first sentence is
 * pinned byte for byte, with "of this lineup" beside the 100 it qualifies. "Lower is better." is said once on the
 * page, by the dial's scorecard, so it is not repeated here. The scale is this app's, not a Qloo figure, so the
 * invented day says the same.
 */
export const INDEX_SCALE = "A score, not money: 100 = the average random valid timetable of this lineup. Above 100: costlier.";

/**
 * A Clash Budget Index change as one line, the hero's own treatment: the two readings in the index type
 * ("116.7 → 113.2"), then the change in words ("−3.5 index points", from `indexDelta`, so it never disagrees
 * with them) and what the scale means, then the day's range line when it has one, with the caller's verdict.
 * No chip, no bars and no colour: the words say which way it moved. Nothing when either reading is missing.
 */
export function IndexChange({
  before,
  after,
  range,
  verdict = null,
  className,
}: {
  before: number | null;
  after: number | null;
  range: ScaleRange;
  /** A sentence that follows the range line, such as where a plan sits against that range. */
  verdict?: string | null;
  className?: string;
}) {
  if (before === null || after === null || !Number.isFinite(before) || !Number.isFinite(after)) return null;
  const from = before.toFixed(1);
  const to = after.toFixed(1);
  const delta = indexDelta(from, to);
  const lead = rangeLead(range);
  return (
    <div data-index-change="" className={cn("mt-3", className)}>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="type-numeral text-[1.75rem] leading-none tabular-nums">
          <span aria-hidden="true">
            {from} → {to}
          </span>
          <span className="sr-only">
            {from} to {to},
          </span>
        </span>
        <span className="text-[0.8125rem] leading-snug text-muted-foreground">
          {delta ? (
            <>
              <span className="tabular-nums">{delta.slice(0, delta.indexOf(" "))}</span>
              {delta.slice(delta.indexOf(" "))}
              {" · "}
            </>
          ) : null}
          Clash Budget Index · lower is better
        </span>
      </p>
      {lead ? (
        <p className="mt-1.5 text-xs text-muted-foreground lg:text-[0.8125rem]">
          {lead}
          {verdict ? ` ${verdict}` : ""}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What a press of "Keep this move" does: `already` when the plan holds the move (it says so and changes
 * nothing), `offer` when the page passed the plan and it holds other steps (Add or Replace is offered and
 * nothing changes yet), else `keep` (the move is kept at once, as on an empty plan).
 */
export function keepPressKind(
  plan: readonly StackStep[] | undefined,
  move: DecisionCopy["seedMove"],
  keptMove: boolean,
): "already" | "offer" | "keep" {
  if (keptMove) return "already";
  if (!plan || plan.length === 0 || !move) return "keep";
  return plan.some((step) => !isRuleStackStep(step) && sameStep(step, move)) ? "already" : "offer";
}

/**
 * The steps a press of "Keep this move" is about: the scored plan the page passed or, while the page has no
 * answer for it yet (after a reload with a kept plan, the page reports the plan once the engine has scored it),
 * the plan this tab stored, so a press never replaces a plan the hero cannot see yet. None when the page passed
 * no plan (the server HTML).
 */
export function planAtPress(
  plan: readonly StackStep[] | undefined,
  stored: () => readonly StackStep[],
): readonly StackStep[] {
  if (!plan) return [];
  return plan.length > 0 ? plan : stored();
}

/** What the hero offers when "Keep this move" is pressed on a plan that already holds other steps. */
export const ADD_TO_PLAN = "Add to your plan";
export const REPLACE_PLAN = "Replace your plan";

/** The state of that offer: open, an Add being scored, an Add the engine refused (with why), or a choice sent. */
export type KeepOffer =
  | { state: "open" }
  | { state: "checking" }
  | { state: "rejected"; reason: string; retry: boolean }
  | { state: "sent" };

/**
 * The offer itself, drawn in the places of the hero's actions so that nothing moves when it opens: "Add to your
 * plan" (the outline button, Keep's 48 px) in Keep's place with "Replace your plan" (ghost) beside it, then how
 * many steps the plan holds (with what an Add is doing) or why an Add was refused, in the confirmation's room at
 * its held height. Below 380 px the two do not fit one row, so Replace takes the paste's place under that room;
 * from 1024 px the paste's place is beside Keep anyway. An Add the engine refused for good leaves only Replace, in
 * Keep's place with Add's outline, and its reason may run on into the room the paste left. The group draws no box
 * of its own (`display: contents`), so its parts take the actions grid's areas; Escape puts it away (`onDismiss`)
 * unless an Add is on its way. Existing Button variants, each with the 10px control corner; no id.
 */
export function KeepMoveOffer({
  offer,
  held,
  onAdd,
  onReplace,
  onDismiss,
  addRef,
  replaceRef,
  className,
}: {
  offer: KeepOffer;
  /** The steps the plan holds now. */
  held: readonly StackStep[];
  onAdd: () => void;
  onReplace: () => void;
  onDismiss?: () => void;
  addRef?: RefObject<HTMLButtonElement | null>;
  replaceRef?: RefObject<HTMLButtonElement | null>;
  className?: string;
}) {
  const checking = offer.state === "checking" || offer.state === "sent";
  const rejected = offer.state === "rejected" ? offer : null;
  const addShown = !(rejected && !rejected.retry);
  return (
    <div
      role="group"
      aria-label={`${KEEP_MOVE}: add it to your plan, or replace your plan`}
      data-keep-offer=""
      className={cn("contents", className)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || checking || !onDismiss) return;
        event.preventDefault();
        onDismiss();
      }}
    >
      {/* One row in Keep's place from 380 to 1023 px; elsewhere each button is a grid item of its own. */}
      <div className="contents min-[380px]:flex min-[380px]:gap-3 min-[380px]:[grid-area:keep] lg:contents">
        {addShown ? (
          <Button
            ref={addRef}
            type="button"
            variant="outline"
            size="lg"
            aria-disabled={checking || undefined}
            onClick={onAdd}
            className="[grid-area:keep]"
          >
            {ADD_TO_PLAN}
          </Button>
        ) : null}
        {/* Alone, Replace is a new button in Keep's place (not the old one carried across), drawn with Add's
            outline, since it is the one way left and a ghost would sit indented from the reason under it. */}
        <Button
          key={addShown ? "beside-add" : "alone"}
          ref={replaceRef}
          type="button"
          variant={addShown ? "ghost" : "outline"}
          onClick={onReplace}
          className={addShown ? "[grid-area:paste] max-[379px]:mt-2 min-[380px]:h-12" : "h-12 [grid-area:keep]"}
        >
          {REPLACE_PLAN}
        </Button>
      </div>
      {/* The confirmation's room, at its held height: a longer reason runs on below it and moves nothing. */}
      <p
        data-keep-offer-status=""
        className="mt-1 h-[3.375rem] w-full text-[0.8125rem] leading-[1.125rem] text-foreground [grid-area:notice] sm:h-9 lg:h-10 lg:text-sm lg:leading-5"
      >
        {rejected ? (
          rejected.reason
        ) : (
          <>
            Your plan already holds {pluralize(held.length, keptWord(held))}.
            {/* The spinner sits here, not in Add, so Add keeps its width and Replace beside it never moves. */}
            {offer.state === "checking" ? (
              <span className="text-muted-foreground">
                {" "}
                <LoaderCircle aria-hidden="true" className="inline-block size-4 align-[-0.1875rem] motion-safe:animate-spin" /> Scoring
                your plan with this move added.
              </span>
            ) : null}
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The pair's taste overlap as line 1 of the working prints it ("their taste overlap is 97 of 100 on this
 * bill"), read back from the card's own copy; null when line 1 does not say it.
 */
export function tasteOverlapOf(copy: Pick<DecisionCopy, "clashLine">): string | null {
  return /taste overlap is (\d{1,3}) of 100 on this bill/.exec(copy.clashLine)?.[1] ?? null;
}

/**
 * The hero's own clash, when it carries the board's Hidden label, said concretely: how many of the day's
 * ranked clashes carry that label (`count`, left out without it) and, with `ranked`, out of how many ranked
 * clashes ("1 of 5 among the day's 15 ranked clashes"), the two main genres (left out unless both are saved)
 * and the taste overlap line 1 prints. It keeps the board's definition
 * (`LABEL_META.hidden.explain`: the main genre tags differ, and the taste overlap is among the day's
 * highest): with the rank printed, the rank says it; without one, the definition's words do. Names no
 * source; on the invented day it says the day and the overlap are invented.
 */
export function hiddenClashLine({
  count,
  ranked,
  genres,
  taste,
  invented = false,
}: {
  count?: number | null;
  /** The day's ranked clashes, from the list the count is read from; with it the count says its scope. */
  ranked?: number | null;
  genres?: readonly (string | null | undefined)[] | null;
  taste: string | null;
  invented?: boolean;
}): string {
  const day = invented ? "this invented day" : "this day";
  const counted = count !== undefined && count !== null && Number.isInteger(count) && count >= 1;
  const scoped = counted && ranked !== undefined && ranked !== null && Number.isInteger(ranked) && ranked >= count;
  const share = scoped
    ? `, 1 of ${count} among ${invented ? "the invented day’s" : "the day’s"} ${ranked} ranked clashes`
    : counted
      ? `, 1 of ${count} on ${day}`
      : "";
  const named = (genres ?? []).map((genre) => genre?.trim() ?? "").filter(Boolean);
  const which = genres && genres.length === 2 && named.length === 2 ? ` (${named[0]}, ${named[1]})` : "";
  const overlap = invented ? "invented taste overlap" : "taste overlap";
  const rank = taste ? `ranks ${taste} of 100 on this bill` : "is among the day’s highest";
  return `A hidden clash${share}: main genres differ${which}, yet their ${overlap} ${rank}.`;
}

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

/**
 * The dateline with where the reading came from, on a published day with a saved reading: "Glastonbury
 * 2025, Sunday · published timetable · saved Qloo reading built 3 Oct 2026" (the date by `builtDate`, in
 * UTC, as the working's saved-reading line prints it). The plain dateline otherwise, and always on the
 * invented day.
 */
export function datelineWithReading(title: string, saved: SavedReading | null | undefined, invented: boolean): string {
  const dateline = datelineText(title);
  if (invented || !saved || savedReadingLine(saved) === null) return dateline;
  return `${dateline} · saved Qloo reading built ${builtDate(saved.builtAt)}`;
}

/**
 * Why the card's move is this one and not a bigger gain elsewhere, as `backend/app/decision.py` chooses
 * it: the day's costliest clash whose sets have a legal place that lowers the index, then the lower of
 * its two sets' lowest-index places.
 */
export const MOVE_CHOICE_LINE =
  "Chosen by clash, not by gain: the lowest-index single move for the day’s costliest clash that has one. A move for another clash can lower the index more; Try a move scores the legal places of other sets.";

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
 * Focuses the first of the links that is displayed (a view may draw one copy per width, the other
 * display:none), without scrolling the page. Returns the one it focused.
 */
export function focusShown(links: readonly (HTMLElement | null)[]): HTMLElement | null {
  const shown = links.find((link) => link !== null && link.getClientRects().length > 0) ?? null;
  shown?.focus({ preventScroll: true });
  return shown;
}

/**
 * The confirmation in place, under the button that was pressed: a polite live region that, once the
 * plan holds the move, reads "Kept in your plan. Nothing moves until the acts' teams agree." in ink with
 * the "See your plan" link (and, while the drawing shows the day without the move, says so between them).
 * Empty otherwise; the caller sizes it, so an empty notice can hold its room. The link reads as text in its
 * line and takes its 44px target from a hit area that adds no height, so the line never grows.
 */
export function KeptNotice({
  shown,
  linkRef,
  boxRef,
  drawn = null,
  className,
}: {
  shown: boolean;
  linkRef: RefObject<HTMLAnchorElement | null>;
  boxRef?: RefObject<HTMLDivElement | null>;
  /** The drawing shows the day without the move: as published, or (the invented day) without the move. */
  drawn?: "published" | "invented" | null;
  className?: string;
}) {
  return (
    <div ref={boxRef} role="status" aria-live="polite" data-kept-notice="" className={className}>
      {shown ? (
        <p className="text-foreground">
          <span className="font-semibold">
            <Check aria-hidden="true" className="mr-1 inline-block size-4 shrink-0 align-[-0.1875rem]" />
            {KEPT_IN_PLAN}
          </span>{" "}
          {drawn === "published" ? `${DRAWN_AS_PUBLISHED} ` : drawn === "invented" ? `${DRAWN_WITHOUT_MOVE} ` : null}
          {KEPT_AGREE}{" "}
          <a
            ref={linkRef}
            href={`#${PLAN_ANCHOR}`}
            onClick={(event) => seeYourPlan(event)}
            className="relative rounded-sm font-semibold whitespace-nowrap text-foreground underline decoration-border-strong decoration-1 underline-offset-4 after:absolute after:-inset-x-1 after:-inset-y-4 after:content-[''] hover:decoration-foreground"
          >
            {SEE_YOUR_PLAN}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The 10px control corner every button takes, given to the ruled text buttons too: the variant's own class
 * gives them the 6px label corner, which their focus ring would show.
 */
const RULED_CORNER = "rounded-md";

/**
 * The corner of an action that closes a sentence beside the card: a text link's 6px, never the 10px control
 * corner. Its box is the sentence's line, about 20px tall, so 10px would be half its height (a pill, and a stadium
 * ring); a box tall enough for 10px would put its focus ring through the line above. 4px of margin before it keeps
 * the ring clear of the sentence's last word.
 */
const INLINE_CORNER = "rounded-sm ml-1";

/** The re-check action itself, with no hook: it only opens the pair's drawer and sends nothing. */
export function PairRecheck({ onOpenPair }: { onOpenPair: (trigger: HTMLElement) => void }) {
  return (
    <Button
      type="button"
      variant="ruled"
      className={cn("py-2 text-left whitespace-normal", RULED_CORNER)}
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
 * The index card under the hero, in the section on what taste changes: one card (the card fill, a hairline
 * surface edge, the 14px panel corner) holding the Clash Budget Index block (its label and Derived stamp,
 * "116.7 → 114.3" with the change in words, and one paragraph: the scale, who selected and scored it, and
 * that it is a reading, not a verdict), the hidden-clash line when the pair carries that label, the "Show
 * the working" disclosure (the two changes side by side when there are two, then "How this was chosen",
 * rows 1 to 3 with the rule check beside row 3, the saved reading and the re-check), and under it the
 * secondary actions: the rule search, the keep button with what it keeps, and the day's hidden clash.
 * The move itself, its readout and "Keep this move" are the hero's (`HeroDecision`). Every string comes
 * from `buildDecisionCopy`, so the server HTML and the interactive page print the same card. It never
 * changes the dial, which stays the reading of the published timetable. `part` draws the whole card, or one of
 * the two parts the section on what taste changes places from 1024px (`DecisionPart`).
 */
export function DecisionDetails({
  copy,
  part = "whole",
  onTryRule,
  onKeepChange,
  kept,
  onOpenHidden,
  hiddenLabel,
  hiddenCount,
  rankedCount,
  genres,
  saved,
  onOpenPair,
  className,
}: DecisionDetailsProps) {
  const [status, say] = useAnnouncement();
  const ruleLineId = useId();
  const changeSummaryId = useId();
  // "Show the working": closed on every load; the region's id is what its toggle controls.
  const [workingOpen, setWorkingOpen] = useState(false);
  const workingId = useId();
  const workingToggleId = useId();
  const invented = isInventedDecision(copy);

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

  const deltaText = indexDelta(copy.indexBefore, copy.indexAfter);
  const delta = deltaText
    ? { figure: deltaText.slice(0, deltaText.indexOf(" ")), words: deltaText.slice(deltaText.indexOf(" ") + 1) }
    : null;
  const hasIndex = copy.indexBefore !== null && copy.indexAfter !== null;
  const figure = hasIndex ? (
      // The score as one block: the label with its Derived stamp, the figure with its change on the same
      // baseline, then one paragraph: the scale (100, and what a reading above it means), who selected and scored it,
      // and what kind of claim it is. It is outside the working, so the paragraph is read with no click.
      <div data-index-block="">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Clash Budget Index</p>
          <ProvenanceChip provenance="derived" synthetic={invented} className="rounded-sm" />
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className="type-numeral text-[1.75rem] leading-none tabular-nums">
            <span aria-hidden="true">
              {copy.indexBefore} → {copy.indexAfter}
            </span>
            <span className="sr-only">
              {copy.indexBefore} to {copy.indexAfter}.
            </span>
          </p>
          {delta ? (
            <p className="text-[0.8125rem] leading-snug text-muted-foreground">
              <span className="tabular-nums">{delta.figure}</span> {delta.words}
            </p>
          ) : null}
        </div>
        {/* The scale, where the index first appears, then the attribution, which ends the block. */}
        <p data-index-scale="" className="mt-1 max-w-prose text-[0.8125rem] leading-snug text-muted-foreground">
          {INDEX_SCALE} {ATTRIBUTION}. A reading, not a verdict.
        </p>
      </div>
    ) : (
      // With no move there is no figure, and the same paragraph still limits the card with no click.
      <p data-index-scale="" className="max-w-prose text-[0.8125rem] leading-snug text-muted-foreground">
        {INDEX_SCALE} {ATTRIBUTION}. A reading, not a verdict.
      </p>
    );

  // In the "card" part, what moves beside the card from 1024px shows below 1024px only.
  const narrowOnly = part === "card" ? "lg:hidden" : undefined;
  const hidden = isHiddenDecision(copy);
  const hiddenText = hidden
    ? hiddenClashLine({ count: hiddenCount, ranked: rankedCount, genres, taste: tasteOverlapOf(copy), invented })
    : null;
  // The decision's own clash, when it carries the Hidden label: in ink, as a fact of the board, never the
  // teal of a Qloo figure.
  const hiddenLine = hiddenText ? (
    <p data-hidden-line="" className={cn("mt-4 max-w-prose text-sm leading-snug", narrowOnly)}>
      {hiddenText}
    </p>
  ) : null;
  // The working's last lines on a published day: where the reading came from, with the Recorded stamp,
  // and (while the server answers live pair checks) the way to this pair's drawer and its re-check.
  const savedLine = !invented && saved ? savedReadingLine(saved) : null;
  const recheck = !invented && onOpenPair ? <PairRecheckWhenOn onOpenPair={onOpenPair} /> : null;

  // The secondary actions are ruled text (the button's "ruled" variant), like a note in a running order's
  // margin: no fill, no box. The one filled action, "Keep this move", is the hero's. Like every button they
  // take the 10px control corner (`RULED_CORNER`), which only their focus ring shows; the two that close a
  // sentence beside the card take a text link's corner instead (`INLINE_CORNER`).
  const ruled = cn("py-2 text-left whitespace-normal", RULED_CORNER);
  const showRule = Boolean(onTryRule && copy.seedRule);
  const showKeep = Boolean(onKeepChange && copy.seedChange);
  // Not disabled once kept: it stays pressable so a repeat press says "Already in your plan." and a keyboard
  // visitor never loses focus to the page. Once kept it is a quiet state: a check, no underline, muted ink.
  const keepLabel = kept?.change ? (
    <>
      <Check aria-hidden="true" />
      In your plan<span className="sr-only">: {copy.changeLabel?.replace(/^Keep /, "")}</span>
    </>
  ) : (
    (copy.changeLabel ?? "Keep this change")
  );
  const openLabel = (
    <>
      {hiddenLabel ?? "Open a hidden clash"}
      <ArrowRight aria-hidden="true" />
    </>
  );
  const tryLabel = (
    <>
      Try this rule yourself
      <ArrowRight aria-hidden="true" />
    </>
  );

  if (part === "beside") {
    // From 1024px, beside the card: each line with its action at its end, as a link closes a sentence, at the
    // sentence's own size. The action takes a text link's corner (`INLINE_CORNER`) and its 44px target from a hit
    // area that adds no height to the line. When the card's pair carries the Hidden label, the action that opens
    // that pair closes the hidden-clash line; otherwise the day's hero clash is a ruled line of its own, last, with
    // the 10px control corner. At the column's full measure, as the figure above them.
    const inline = cn(
      INLINE_CORNER,
      "relative min-h-0 align-baseline text-[length:inherit] after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']",
    );
    const openInline = onOpenHidden ? (
      <Button type="button" variant="ruled" className={inline} onClick={(event) => onOpenHidden(event.currentTarget)}>
        {openLabel}
      </Button>
    ) : null;
    const besideHidden = hiddenText ? (
      <p data-hidden-line="" className="text-sm leading-snug">
        {hiddenText}
        {openInline ? <> {openInline}</> : null}
      </p>
    ) : null;
    const besideChange =
      showKeep && copy.changeSummary ? (
        <p data-change-line="" className="text-[0.8125rem] leading-snug text-muted-foreground">
          <span id={changeSummaryId}>{copy.changeSummary}</span>{" "}
          <Button
            type="button"
            variant="ruled"
            data-kept={kept?.change ? "" : undefined}
            className={cn(inline, kept?.change && "text-muted-foreground no-underline")}
            aria-describedby={changeSummaryId}
            onClick={keepChange}
          >
            {keepLabel}
          </Button>
        </p>
      ) : null;
    const besideOpen =
      onOpenHidden && !hiddenText ? (
        <div>
          <Button type="button" variant="ruled" className={ruled} onClick={(event) => onOpenHidden(event.currentTarget)}>
            {openLabel}
          </Button>
        </div>
      ) : null;
    if (!besideHidden && !besideChange && !besideOpen) return null;
    return (
      <div data-index-beside="" className={cn("hidden space-y-4 lg:block", className)}>
        {besideHidden}
        {besideChange}
        {besideOpen}
        <p role="status" aria-live="polite" className="sr-only">
          {status}
        </p>
      </div>
    );
  }

  const actions =
    showRule || showKeep || onOpenHidden ? (
      <div className="flex flex-wrap gap-x-5">
        {showRule ? (
          <Button type="button" variant="ruled" className={cn(ruled, narrowOnly)} onClick={tryRule}>
            {tryLabel}
          </Button>
        ) : null}
        {showKeep ? (
          <Button
            type="button"
            variant="ruled"
            data-kept={kept?.change ? "" : undefined}
            className={cn(ruled, kept?.change && "text-muted-foreground no-underline", narrowOnly)}
            aria-describedby={`${ruleLineId} ${changeSummaryId}`}
            onClick={keepChange}
          >
            {keepLabel}
          </Button>
        ) : null}
        {onOpenHidden ? (
          // The card's hidden pair, or else the day's hero clash, as a ruled text link with its arrow, 44 px tall.
          <Button
            type="button"
            variant="ruled"
            className={cn(ruled, narrowOnly)}
            onClick={(event) => onOpenHidden(event.currentTarget)}
          >
            {openLabel}
          </Button>
        ) : null}
      </div>
    ) : null;
  // What the keep button keeps, under the buttons, across the card's width.
  const changeSummary =
    showKeep && copy.changeSummary ? (
      <p id={changeSummaryId} className={cn("mt-2 max-w-prose text-[0.8125rem] leading-snug text-muted-foreground", narrowOnly)}>
        {copy.changeSummary}
      </p>
    ) : null;
  // In the "card" part from 1024px, the rule search sits on the working toggle's row (the same action, drawn once at
  // each width), and every other action and the change line are beside the card.
  const tryBesideToggle =
    part === "card" && showRule ? (
      <Button type="button" variant="ruled" className={cn(ruled, "hidden lg:inline-flex")} onClick={tryRule}>
        {tryLabel}
      </Button>
    ) : null;
  // "Show the working": a native button, so click, Enter and Space all work; the region it controls
  // carries `hidden` while closed, so nothing in it is in the tab order. Its 10px control corner and 8px
  // sides (pulled back by the same 8px) give the focus ring a rounded box around the chevron and its label.
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
          "size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-[160ms] motion-safe:ease-(--ease-out)",
          workingOpen && "rotate-90",
        )}
      />
      <span>{SHOW_WORKING}</span>
    </button>
  );

  return (
    <div
      data-decision-details=""
      className={cn("min-w-0 rounded-xl border border-surface-edge bg-card p-5 lg:p-6", className)}
    >
      {figure}
      {hiddenLine}
      <div className={cn("mt-3", tryBesideToggle && "lg:flex lg:flex-wrap lg:items-center lg:gap-x-6")}>
        {workingToggle}
        {tryBesideToggle}
      </div>

      {/* The working, directly under its toggle: the two changes side by side (when the decision has a
          comparison) and rows 1 to 3. */}
      <div
        id={workingId}
        role="region"
        aria-labelledby={workingToggleId}
        data-working=""
        hidden={!workingOpen}
        className="mt-3"
      >
        {copy.tradeoff ? (
          <div className="mb-5 border-b border-border pb-5">
            {/* The table's own heading is the subhead: a small label over its column note and rows. */}
            <TradeoffTable tradeoff={copy.tradeoff} held={kept} compact />
          </div>
        ) : null}
        <h3 className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">{HOW_CHOSEN}</h3>
        <div className="mt-3 mb-1 space-y-4 text-sm leading-[1.5]">
          <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            <LineLabel n={1} />
            <p>{copy.clashLine}</p>
          </div>

          <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            <LineLabel n={2} />
            <div className="min-w-0">
              <p>{copy.moveLine}</p>
              {copy.indexBefore !== null && copy.indexAfter !== null ? (
                <p data-move-choice="" className="mt-2 text-[0.8125rem] text-muted-foreground">
                  {MOVE_CHOICE_LINE}
                </p>
              ) : null}
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

      {/* Under the working, the secondary actions and what the keep button keeps. */}
      {actions || changeSummary ? (
        <div data-decision-actions="" className={cn("mt-1", narrowOnly)}>
          {actions}
          {changeSummary}
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}
