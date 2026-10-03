"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ATTRIBUTION, type DecisionCopy, type SharedTimeline } from "@/lib/decision";
import { cn } from "@/lib/utils";

import { useAnnouncement } from "./use-announcement";

/** The anchor of the card, for the hero button and the jump links. */
export const DECISION_ID = "one-decision";
export const DECISION_HEADING_ID = "decision-heading";

/** Counted from the first card shown on the page, so the reveal runs once per page load. */
let revealed = false;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The index after the move, shown as it counts from the reading before to the reading after (420 to
 * 900 ms into "Open this move"). The final value is what the page holds before and after, and what
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

/**
 * Two rows on one time axis: where the pair plays now and where it plays with the move tested.
 * A solid slot is published, a dashed slot is tested, and the short bar under a row is the time the
 * two share. Each row is labelled ("Now", "Tested") in 13-unit type, which renders at 10 px or more
 * down to a 320 px screen. Decorative: the lines below print the same times and minutes.
 */
function SharedTimeMini({ line, playKey }: { line: SharedTimeline; playKey: number }) {
  const ratio =
    line.bandNow && line.bandAfter && line.bandAfter.w > 0 ? line.bandNow.w / line.bandAfter.w : null;
  const play = playKey > 0;
  return (
    <svg viewBox="0 0 288 120" className="block h-auto w-full max-w-[18rem]" aria-hidden="true">
      <text x="24" y="12" className="fill-foreground font-mono text-[13px] font-semibold">
        Now
      </text>
      <rect x={line.staying.x} y="18" width={line.staying.w} height="9" rx="2" fill="var(--foreground)" />
      <rect
        x={line.movingNow.x}
        y="31"
        width={line.movingNow.w}
        height="9"
        rx="2"
        fill="var(--card)"
        stroke="var(--foreground)"
        strokeWidth="1.5"
      />
      {line.bandNow ? <rect x={line.bandNow.x} y="44" width={line.bandNow.w} height="4" rx="2" fill="var(--primary)" /> : null}

      <text x="24" y="65" className="fill-foreground font-mono text-[13px] font-semibold">
        Tested
      </text>
      <rect x={line.staying.x} y="71" width={line.staying.w} height="9" rx="2" fill="var(--foreground)" />
      <rect
        x={line.movingAfter.x}
        y="84"
        width={line.movingAfter.w}
        height="9"
        rx="2"
        fill="var(--card)"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeDasharray="5 3"
      />
      {line.bandAfter ? (
        <rect
          key={`band-${playKey}`}
          x={line.bandAfter.x}
          y="97"
          width={line.bandAfter.w}
          height="4"
          rx="2"
          fill="var(--primary)"
          className={play && ratio ? "cc-overlap-band" : undefined}
          style={play && ratio ? ({ "--band-from": ratio } as React.CSSProperties) : undefined}
        />
      ) : null}

      {line.ticks.map((tick) => (
        <text
          key={tick.label}
          x={tick.x}
          y="117"
          textAnchor="middle"
          className="fill-muted-foreground font-mono text-[13px]"
        >
          {tick.label}
        </text>
      ))}
    </svg>
  );
}

function LineLabel({ n }: { n: number }) {
  return (
    <span className="pt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
      <span className="sr-only">Line </span>
      {n}
    </span>
  );
}

/** Holds the card's footprint while the day's decision loads: no heading, nothing to read. */
export function DecisionCardSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-xl border border-border-strong bg-card p-4 sm:p-5">
      <div className="h-14 w-4/5 rounded bg-muted" />
      <div className="mt-5 space-y-2.5">
        <div className="h-3.5 w-full rounded bg-muted" />
        <div className="h-3.5 w-11/12 rounded bg-muted" />
        <div className="h-3.5 w-3/4 rounded bg-muted" />
      </div>
    </div>
  );
}

type DecisionCardProps = {
  copy: DecisionCopy;
  /** Keeps the one move as the plan. Absent in the server HTML, where the page cannot act yet. */
  onOpenMove?: () => void;
  /** Opens the rule search for the pair. Absent when there is no rule line to try. */
  onTryRule?: () => void;
  /** Keeps line 3's change as one step of the plan. Absent in the server HTML and without that change. */
  onKeepChange?: () => void;
  /** Opens the day's hero clash (a hidden clash when it has one), with the button as the place to return to. */
  onOpenHidden?: (trigger: HTMLElement) => void;
  /** What that link says; "Open a hidden clash" unless the day has none. */
  hiddenLabel?: string;
  className?: string;
};

/** The disclosure's label, on the phone's button and above the lines from `sm` up. */
export const HOW_CHOSEN = "How this was chosen";

/**
 * One worked decision on the published day: the action first ("Sprints 15 minutes later: 45 → 30
 * minutes shared"), then the index with its attribution, the drawn timeline and the two buttons.
 * Under them, "How this was chosen" holds lines 1 to 4: the clash, the lowest-index move, the rule
 * search for the pair and what the lines can and cannot say. The lines are always in the markup
 * (the server HTML keeps them): from `sm` up they are open, on a phone they sit behind the button
 * until it is pressed. Every string comes from `buildDecisionCopy`, so the server HTML and this
 * client card are the same card. It never changes the dial, which stays the reading of the
 * published timetable.
 */
export function DecisionCard({
  copy,
  onOpenMove,
  onTryRule,
  onKeepChange,
  onOpenHidden,
  hiddenLabel,
  className,
}: DecisionCardProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [playKey, setPlayKey] = useState(0);
  const [status, say] = useAnnouncement();
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const ruleLineId = useId();
  const counted = useCount(copy.indexFrom, copy.indexTo, playKey);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // The reveal runs once per page load, after the card is in the page: the server HTML is already
  // readable, so nothing waits on it.
  useEffect(() => {
    if (revealed) return;
    revealed = true;
    if (!reducedMotion()) rootRef.current?.classList.add("cc-card-enter");
  }, []);

  function openMove() {
    if (!onOpenMove) return;
    setPlayKey((key) => key + 1);
    say(copy.testing ?? "");
    onOpenMove();
  }

  function tryRule() {
    if (!onTryRule) return;
    say("");
    onTryRule();
  }

  function keepChange() {
    if (!onKeepChange) return;
    say(copy.testingChange ?? "");
    onKeepChange();
  }

  const figure =
    copy.indexBefore !== null && copy.indexAfter !== null ? (
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="type-numeral text-[1.75rem] leading-none tabular-nums">
          <span aria-hidden="true">
            {copy.indexBefore} → {counted ?? copy.indexAfter}
          </span>
          <span className="sr-only">
            Clash Budget Index {copy.indexBefore} to {copy.indexAfter}.
          </span>
        </p>
        <p className="text-xs text-muted-foreground">{ATTRIBUTION}</p>
      </div>
    ) : null;

  return (
    <section
      id={DECISION_ID}
      aria-labelledby={DECISION_HEADING_ID}
      ref={rootRef}
      className={cn("rounded-xl border border-border-strong bg-card p-4 sm:p-5", className)}
    >
      {copy.receipt && copy.receiptLead && copy.minutesBefore !== null && copy.minutesAfter !== null ? (
        <p className="type-title break-words">
          {copy.receiptLead}:{" "}
          <span className="type-numeral">
            {copy.minutesBefore}
            <span aria-hidden="true"> → </span>
            <span className="sr-only"> to </span>
            {copy.minutesAfter}
          </span>{" "}
          {copy.minutesAfter === 1 ? "minute" : "minutes"} shared
        </p>
      ) : null}
      <h2
        id={DECISION_HEADING_ID}
        ref={headingRef}
        tabIndex={-1}
        className="type-kicker mt-3 text-muted-foreground outline-none"
      >
        {copy.title}
      </h2>

      {figure}
      {copy.timeline ? (
        <figure className="mt-3">
          <SharedTimeMini line={copy.timeline} playKey={playKey} />
          <figcaption className="mt-1.5 max-w-[18rem] text-xs leading-snug text-muted-foreground">
            Solid: where the sets play now. Dashed: {copy.timeline.movingName}, tested. Bar: time shared with{" "}
            {copy.timeline.stayingName}.
          </figcaption>
        </figure>
      ) : null}

      {(onOpenMove && copy.seedMove) || (onTryRule && copy.seedRule) || (onKeepChange && copy.seedChange) ? (
        <div className="mt-4 flex flex-wrap gap-2 max-[390px]:flex-col max-[390px]:items-stretch">
          {onOpenMove && copy.seedMove ? (
            <Button type="button" variant="ink" onClick={openMove}>
              Open this move
            </Button>
          ) : null}
          {onTryRule && copy.seedRule ? (
            <Button type="button" variant="outline" onClick={tryRule}>
              Try this rule yourself
            </Button>
          ) : null}
          {onKeepChange && copy.seedChange ? (
            <Button type="button" variant="outline" aria-describedby={ruleLineId} onClick={keepChange}>
              Keep this change
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 border-t border-border pt-1 sm:pt-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((open) => !open)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm text-left text-sm font-semibold sm:hidden"
        >
          {HOW_CHOSEN}
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150", expanded && "rotate-180")}
          />
        </button>
        <p className="type-kicker hidden text-muted-foreground sm:block">{HOW_CHOSEN}</p>
        <div
          id={bodyId}
          className={cn(
            "cc-how cc-card-body space-y-4 text-sm leading-[1.5] sm:mt-3 sm:block",
            expanded ? "mt-3" : "max-sm:hidden",
          )}
        >
          <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            <LineLabel n={1} />
            <p>{copy.clashLine}</p>
          </div>

          <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            <LineLabel n={2} />
            <div className="min-w-0">
              <p>{copy.moveLine}</p>
              {copy.rangeLine ? <p className="mt-2 text-xs text-muted-foreground">{copy.rangeLine}</p> : null}
            </div>
          </div>

          {copy.ruleLine ? (
            <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 border-t border-border pt-3">
              <LineLabel n={3} />
              <p id={ruleLineId}>{copy.ruleLine}</p>
            </div>
          ) : null}

          <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
            <LineLabel n={4} />
            <p className="text-xs leading-relaxed text-muted-foreground">{copy.limitsLine}</p>
          </div>
        </div>
        {/* Without scripts a phone cannot press the button, so the lines show. */}
        <noscript>
          <style>{".cc-how{display:block !important}"}</style>
        </noscript>
      </div>

      {onOpenHidden ? (
        <button
          type="button"
          onClick={(event) => onOpenHidden(event.currentTarget)}
          className="mt-3 min-h-11 rounded-sm text-sm font-semibold underline underline-offset-4 hover:text-primary"
        >
          {hiddenLabel ?? "Open a hidden clash"}
        </button>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </section>
  );
}
