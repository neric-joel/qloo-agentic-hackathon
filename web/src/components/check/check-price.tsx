import { TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { CheckReport } from "@/lib/check";
import {
  PRICE_COPY,
  PRICE_LIMITS,
  comparedPairs,
  coverageLine,
  coverageParts,
  extraNames,
  notCompared,
  notComparedLine,
  notComparedText,
  orderLine,
  pairLine,
  pairName,
  recovery,
  scopeNote,
  sentActs,
  sentOverlaps,
  sourceBanner,
  type PairOrder,
  type PriceAnswer,
  type PriceMode,
  type PriceRequest,
  type PriceSource,
} from "@/lib/check-price";
import { onSampleDay } from "@/lib/check-sample";
import { cn } from "@/lib/utils";

import {
  CheckDayStrip,
  CheckDayStripRoom,
  GHOST_LINE,
  GHOST_ROOM,
  RANK_NOTE,
  stripLayout,
  stripSize,
  type StripLayout,
  type StripSize,
} from "./check-day-strip";
import { TEXT_ACTION } from "./check-trial-panel";

/** What the page holds of pricing for the grid on show. Reset by every check and every change tried. */
export type PriceState =
  | { phase: "idle" }
  | { phase: "loading"; mode: PriceMode }
  /** The saved attempt found no saved day: the live button is offered now, and only now. */
  | { phase: "not_saved" }
  | { phase: "ready"; answer: PriceAnswer }
  | { phase: "refused"; mode: PriceMode; code: string; message: string }
  | { phase: "error"; mode: PriceMode };

/** How the compared pairs are listed (see `PairOrder`): a published day opens in its own ranking. */
export type PriceOrder = PairOrder;

const PANEL = "rounded-lg border border-surface-edge bg-card p-5 sm:p-6";

const TOGGLE =
  "min-h-11 rounded-md border border-border-strong px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background";

/** One key per pair of names (a NUL cannot be in a name the check reads). */
function pairKey(a: string, b: string): string {
  return `${a}\u0000${b}`;
}

/**
 * "Compare audience overlap (optional)", between the rule breaks and the pairs. Nothing here sends
 * anything: the buttons call `onPrice`, and the page makes its one request only then. A failed answer
 * or a refusal keeps every result above and offers a retry where one can help, never a re-check.
 * Not printed: the brief lists the compared overlaps when there are any.
 *
 * After an answer: the source line, (a published day) the worked-example line, the computed order sentence,
 * the sort control and the compared values (a published day opens in this app's ranking, the order its pairs
 * were chosen in; a pasted grid longest first), then one count line for the overlaps not compared and a
 * closed fold that gives each one's reason in words. After no saved day matched with live comparison off,
 * one text action loads the published day ("Try it on ...").
 *
 * On a published day loaded here, once an answer is on show and the page passes the grid's parsed rows
 * (`day`), a static strip of the day sits above the values (`CheckDayStrip`) with its caption beside it; the
 * scope note's "“Taste rank 1 of n” orders only the pairs compared here." moves into that caption, so it is
 * said once, beside the numbers. Without `day` nothing changes.
 *
 * While a compare is pending, "Comparing." sits in the room of what the press will most likely bring
 * (`pendingShape`): the answer's own blocks as quiet bars, or the no-saved-day box. `HeldRoom` keeps that
 * room's height when the answer fills it, so an answer that lands late moves nothing that was on screen.
 */
export function CheckPrice({
  request,
  noOverlap,
  state,
  order,
  onOrder,
  onPrice,
  stale,
  live = false,
  published = false,
  publishedTitle = null,
  onTryPublished,
  day = null,
}: {
  /** What a press would send; null when the grid has too few acts or no overlap. */
  request: PriceRequest | null;
  /** No two sets share time, so there is nothing to price. */
  noOverlap: boolean;
  state: PriceState;
  order: PriceOrder;
  onOrder: (order: PriceOrder) => void;
  onPrice: (mode: PriceMode) => void;
  /** The grid or settings changed since the last check: nothing is priced until the next one. */
  stale: boolean;
  /**
   * This server prices live (`price_grid_live` in its health answer). False until it says so, and when it
   * does not answer: the page never offers to ask Qloo when the server would refuse.
   */
  live?: boolean;
  /** The grid on show is the published day "Check a published day" loaded: it compares in saved mode only. */
  published?: boolean;
  /** The published day "Check a published day" offers: after no saved day matched, the one way on. */
  publishedTitle?: string | null;
  onTryPublished?: () => void;
  /** The grid's parsed rows as checked (its sets and the overlaps they share), for the published day's strip. */
  day?: Pick<CheckReport, "sets" | "shared"> | null;
}) {
  const k = request?.overlaps.length ?? 0;
  const n = request?.acts.length ?? 0;
  const liveN = request ? sentActs(request, "live").length : 0;
  const busy = state.phase === "loading";
  const savedButton = (
    <Button type="button" variant="outline" disabled={busy || stale} onClick={() => onPrice("saved")}>
      {PRICE_COPY.button}
    </Button>
  );
  const failed =
    state.phase === "error" ? recovery(state.mode, null) : state.phase === "refused" ? recovery(state.mode, state.code) : null;
  // Asking Qloo is offered only when this server prices live, and never for a published day loaded here.
  const offerLive = live && !published;
  const answer = state.phase === "ready" ? state.answer : null;
  // The published day's strip, drawn only from the rows on the page and the answer on show.
  const strip = published && answer && day ? stripLayout(day, answer) : null;
  const note = scopeNote(answer, request);
  const offerTry = !published && Boolean(publishedTitle && onTryPublished);
  // What a pending press holds room for, and whether what came is the thing it held room for.
  const pending = request && state.phase === "loading" ? { mode: state.mode, shape: pendingShape(request, state.mode) } : null;
  const pendingStrip = pending?.shape === "answer" && published && day ? stripSize(day) : null;
  const hold =
    request !== null &&
    ((state.phase === "ready" && pendingShape(request, state.answer.mode) === "answer") ||
      (state.phase === "not_saved" && pendingShape(request, "saved") === "not_saved"));

  return (
    <section aria-labelledby="check-price-heading" className={`${PANEL} print:hidden`}>
      <h2 id="check-price-heading" className="type-title scroll-mt-24">
        {PRICE_COPY.heading}
      </h2>
      {request === null ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {noOverlap ? PRICE_COPY.noOverlap : PRICE_COPY.tooFew}
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed">
            {PRICE_COPY.intro(k, n, live, request.basis, request.served ?? null, extraNames(request))}
          </p>
          <HeldRoom pending={pending !== null} hold={hold}>
            {state.phase === "idle" ? <div className="mt-4">{savedButton}</div> : null}
            {pending?.shape === "answer" ? <AnswerRoom request={request} mode={pending.mode} strip={pendingStrip} /> : null}
            {pending?.shape === "not_saved" ? (
              <NotSavedRoom request={request} live={live} published={published} tryTitle={offerTry ? publishedTitle : null} />
            ) : null}
            {failed ? (
              <div className="mt-4 rounded-md border border-warning bg-warning-bg p-3 sm:p-4">
                <p className="flex items-start gap-2 text-sm font-semibold leading-relaxed break-words">
                  <TriangleAlert aria-hidden="true" className="mt-[3px] size-4 shrink-0" />
                  <span className="min-w-0">{state.phase === "refused" ? state.message : PRICE_COPY.error}</span>
                </p>
                <p className="mt-1.5 text-sm leading-relaxed">{failed.text}</p>
                {failed.retry ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3"
                    disabled={stale}
                    onClick={() => onPrice(failed.retry as PriceMode)}
                  >
                    {PRICE_COPY.retry}
                    <span className="sr-only">: {failed.retry === "live" ? PRICE_COPY.askButton(liveN) : PRICE_COPY.button}</span>
                  </Button>
                ) : null}
              </div>
            ) : null}
            {state.phase === "not_saved" ? (
              <div className="mt-4 rounded-md bg-background p-3 sm:p-4">
                {offerLive ? (
                  <>
                    <p className="text-sm leading-relaxed">{PRICE_COPY.notSaved(liveN, request.need)}</p>
                    <Button type="button" variant="outline" className="mt-3" disabled={stale} onClick={() => onPrice("live")}>
                      {PRICE_COPY.askButton(liveN)}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed">{live ? PRICE_COPY.publishedNotSaved : PRICE_COPY.liveOff}</p>
                    {offerTry && publishedTitle && onTryPublished ? (
                      <button type="button" className={cn(TEXT_ACTION, "mt-1 -ml-2 h-auto py-2.5 text-left whitespace-normal")} onClick={onTryPublished}>
                        {PRICE_COPY.tryPublished(publishedTitle)}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
            {answer ? (
              <PricedList answer={answer} order={order} onOrder={onOrder} dayTitle={request.served?.title ?? null} strip={strip} />
            ) : null}
            <NotCompared request={request} answer={answer} />
            {pending?.shape === "answer" ? (
              // Quiet bars in the room of the note the answer will most likely bring; the note comes with the answer.
              <p
                aria-hidden="true"
                data-tail=""
                data-ghost={answerNote(request, pending.mode, pendingStrip)}
                className={cn(GHOST_LINE, "mt-4 max-w-prose text-sm leading-relaxed")}
              />
            ) : (
              <p data-tail="" className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {strip ? withoutRankNote(note) : note}
              </p>
            )}
          </HeldRoom>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// While a compare is pending

/** What a pending press holds room for: the answer's blocks, or the box that says no saved day holds these acts. */
export type PendingShape = "answer" | "not_saved";

/**
 * What a press will most likely bring, from what it sends: a live press, a published day's ranked clashes and a
 * paste whose names are on a saved day (`served`) are answered; the invented sample is answered from the invented
 * example day (the server's rule: most of the names on one saved day); any other paste finds no saved day.
 */
export function pendingShape(request: Pick<PriceRequest, "basis" | "acts">, mode: PriceMode): PendingShape {
  if (mode === "live" || request.basis !== "longest") return "answer";
  return onSampleDay(request.acts, PRICE_LIMITS.savedShare) ? "answer" : "not_saved";
}

/** A figure space: a digit's width that never breaks a line, standing in for a number not known yet. */
const FIGURE = "\u2007";

/** As many figure spaces as `n` has digits. */
function figures(n: number): string {
  return FIGURE.repeat(String(Math.max(0, Math.round(n))).length);
}

/** "1st", "2nd", "10th": for the room of the order sentence. */
function place(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** Where the answer to this press will say its values came from. */
function likelySource(request: Pick<PriceRequest, "basis">, mode: PriceMode): PriceSource {
  if (mode === "live") return "qloo_live";
  return request.basis === "longest" ? "invented_day" : "saved_day";
}

/** The scope note the answer will most likely bring, with its unknown counts at their widest. */
function answerNote(request: PriceRequest, mode: PriceMode, strip: StripSize | null): string {
  const source = likelySource(request, mode);
  const sent = sentActs(request, mode).length;
  const note = scopeNote(
    {
      source,
      sent,
      omitted: mode === "live" ? request.liveOmitted : request.omitted,
      // A saved day's lineup at two digits (a built day lists tens of acts); a live answer's longer wording (the
      // acts Qloo matched of those sent).
      comparator: source === "qloo_live" ? { kind: "live_subset", acts: sent } : { kind: "saved_day", acts: 99 },
      basis: request.basis,
    },
    request,
  );
  return strip ? withoutRankNote(note) : note;
}

/** Quiet words: room held by `data-ghost` words drawn as bars (`GHOST_LINE`). */
function Ghost({ words, hold, className }: { words: string; hold?: string; className?: string }) {
  return <p data-ghost={words} data-hold={hold} className={cn(GHOST_LINE, className)} />;
}

/**
 * The answer's room while it is pending, block for block as `PricedList` will draw it: the source box (holding
 * "Comparing." in the room of the source line), then, as quiet bars whose words set their wrap, a published day's
 * worked-example line, the order sentence, the strip's room, the sort control, one row per pair sent (each row's
 * words are its pair, its minutes and its value at its widest), the fold of further pairs and the coverage stamps.
 * No value, rank or count is shown or read, and nothing in it can be pressed or focused.
 */
function AnswerRoom({ request, mode, strip }: { request: PriceRequest; mode: PriceMode; strip: StripSize | null }) {
  const ranked = request.basis === "saved_ranking";
  const overlaps = sentOverlaps(request, mode);
  const listed = ranked ? overlaps : [...overlaps].sort((x, y) => y.minutes - x.minutes);
  const open = ranked ? listed : listed.slice(0, PRICE_LIMITS.shownOpen);
  const more = listed.length - open.length;
  const k = listed.length;
  const sent = sentActs(request, mode).length;
  // The order sentence names the pair that rises most by taste overlap; the longest overlap cannot rise, so the
  // room is the widest name of the rest.
  const risers = [...overlaps].sort((x, y) => y.minutes - x.minutes).slice(1);
  const widest = risers.map(pairName).reduce((a, b) => (b.length > a.length ? b : a), "");
  const value = `Taste overlap ${figures(100)} / 100, taste rank ${figures(k)} of ${figures(k)}.`;
  const sorts = ranked ? [PRICE_COPY.rankingFirst, PRICE_COPY.longestFirst, PRICE_COPY.overlapFirst] : [PRICE_COPY.longestFirst, PRICE_COPY.overlapFirst];
  return (
    <div data-price-room="answer" className="mt-4">
      <p className="grid rounded-md bg-background p-3 text-sm font-semibold leading-relaxed">
        <span aria-busy="true" className="col-start-1 row-start-1 font-normal text-muted-foreground">
          {PRICE_COPY.loading}
        </span>
        <span
          aria-hidden="true"
          data-ghost={sourceBanner({ source: likelySource(request, mode), requestsUsed: request.need })}
          className={cn(GHOST_ROOM, "col-start-1 row-start-1")}
        />
      </p>
      <div aria-hidden="true">
        {ranked ? <Ghost words={PRICE_COPY.workedExample} className="mt-3 max-w-prose text-sm leading-relaxed" /> : null}
        {k > 1 ? (
          <Ghost
            words={`Taste overlap changes the order of the ${k} compared overlaps: ${widest} moves from ${place(k)} to ${place(1)}.`}
            hold="order"
            className="mt-3 text-sm font-semibold"
          />
        ) : null}
        {strip ? <CheckDayStripRoom size={strip} /> : null}
        {k > 1 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {sorts.map((label) => (
              <span key={label} className="inline-flex min-h-11 items-center rounded-md border border-transparent bg-muted px-3 text-sm font-semibold">
                <span data-ghost={label} className={GHOST_ROOM} />
              </span>
            ))}
          </div>
        ) : null}
        {open.length > 0 ? (
          <div data-hold="rows" className="mt-3 divide-y divide-border">
            {open.map((overlap) => (
              <Ghost
                key={pairKey(overlap.a, overlap.b)}
                words={`${pairName(overlap)}: ${overlap.minutes} min shared. ${value}`}
                className="py-2.5 text-sm font-semibold break-words first:pt-0 last:pb-0"
              />
            ))}
          </div>
        ) : null}
        {more > 0 ? (
          <div data-hold="more" className="cc-disclosure mt-2 flex min-h-11 items-center py-2.5 pl-5 text-[0.9375rem] leading-[1.375rem] font-semibold">
            <span data-ghost={PRICE_COPY.moreCompared(more)} className={GHOST_LINE} />
          </div>
        ) : null}
        <div data-hold="coverage" className="mt-3">
          <ul className="flex flex-wrap gap-1.5">
            {["Sent", "Matched", "With a signal"].map((label) => (
              <li key={label} className={`${STATE} border-transparent bg-muted`}>
                <span data-ghost={label} className={GHOST_ROOM} />
                <span data-ghost={figures(sent)} className={cn(GHOST_ROOM, "leading-none tracking-normal tabular-nums")} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * The no-saved-day box's room while a paste that is on no saved day is pending: the box as it will read (the
 * live offer and its button where this server compares live, else the off line and the published day's text
 * action), holding "Comparing." in the room of its words. Nothing in it can be pressed or focused.
 */
function NotSavedRoom({
  request,
  live,
  published,
  tryTitle,
}: {
  request: PriceRequest;
  live: boolean;
  published: boolean;
  tryTitle: string | null | undefined;
}) {
  const offerLive = live && !published;
  const liveN = sentActs(request, "live").length;
  const words = offerLive ? PRICE_COPY.notSaved(liveN, request.need) : live ? PRICE_COPY.publishedNotSaved : PRICE_COPY.liveOff;
  return (
    <div data-price-room="not_saved" className="mt-4 rounded-md bg-background p-3 sm:p-4">
      <p className="grid text-sm leading-relaxed">
        <span aria-busy="true" className="col-start-1 row-start-1 text-muted-foreground">
          {PRICE_COPY.loading}
        </span>
        <span aria-hidden="true" data-ghost={words} className={cn(GHOST_ROOM, "col-start-1 row-start-1")} />
      </p>
      {offerLive ? (
        <span aria-hidden="true" className="mt-3 inline-flex h-11 items-center rounded-md border border-transparent bg-muted px-5 text-[0.9375rem] font-semibold">
          <span data-ghost={PRICE_COPY.askButton(liveN)} className={GHOST_ROOM} />
        </span>
      ) : tryTitle ? (
        <span aria-hidden="true" className={cn(TEXT_ACTION, "mt-1 -ml-2 h-auto py-2.5 text-left whitespace-normal")}>
          <span data-ghost={PRICE_COPY.tryPublished(tryTitle)} className={GHOST_LINE} />
        </span>
      ) : null}
    </div>
  );
}

/** Runs before paint in the browser; a static render (the tests') never runs it. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The step's answer area. While a compare is pending it records the room it takes, and the room of each block
 * marked `data-hold` (the order sentence, the rows, the coverage stamps). When what comes is what that room was
 * shaped for (`hold`), the blocks the answer keeps from the pending room (`data-tail`: the not-compared line and
 * the scope note) and everything under the step would move by however much the answer reads shorter. If they
 * are all below the fold, before and after, nothing that moves is on screen, so the answer takes its own height
 * at once. Else each shorter block keeps its room's height (so the space stays where the answer was shorter)
 * and the step keeps the whole room's, until those blocks would be below the fold (a scroll up), the width
 * changes or the step moves on. So an answer that lands late moves nothing that was on screen. Anything else
 * (a refusal, a failed answer) takes its own height at once.
 */
function HeldRoom({ pending, hold, children }: { pending: boolean; hold: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const held = useRef<{ width: number; height: number; parts: Map<string, number> } | null>(null);
  useBeforePaint(() => {
    const element = ref.current;
    if (!element) return;
    // Fractional sizes, so a held room is the pending room to the subpixel.
    const box = () => element.getBoundingClientRect();
    const parts = () => [...element.querySelectorAll<HTMLElement>("[data-hold]")];
    if (pending) {
      element.style.minHeight = "";
      const measure = () => {
        const { width, height } = box();
        held.current = { width, height, parts: new Map(parts().map((part) => [part.dataset.hold ?? "", part.getBoundingClientRect().height])) };
      };
      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    const room = held.current;
    held.current = null;
    const reset = () => {
      element.style.minHeight = "";
      for (const part of parts()) part.style.minHeight = "";
    };
    reset();
    if (!hold || !room || Math.abs(room.width - box().width) > 0.5) return;
    // The top of what the answer keeps from the pending room; under it, everything to the page's end.
    const tail = () => (element.querySelector("[data-tail]") ?? element).getBoundingClientRect().top;
    if (tail() >= window.innerHeight) return;
    let extra = 0;
    for (const part of parts()) {
      const was = room.parts.get(part.dataset.hold ?? "");
      const now = part.getBoundingClientRect().height;
      if (was === undefined || now >= was) continue;
      part.style.minHeight = `${was}px`;
      extra += was - now;
    }
    if (box().height < room.height) element.style.minHeight = `${room.height}px`;
    const release = () => {
      if (tail() - extra < window.innerHeight && Math.abs(box().width - room.width) <= 0.5) return;
      reset();
      window.removeEventListener("scroll", release);
      window.removeEventListener("resize", release);
    };
    window.addEventListener("scroll", release, { passive: true });
    window.addEventListener("resize", release);
    return () => {
      window.removeEventListener("scroll", release);
      window.removeEventListener("resize", release);
    };
  }, [pending, hold]);
  return (
    <div ref={ref} className="flow-root">
      {children}
    </div>
  );
}

/**
 * The scope note without its rank qualifier, which sits beside the strip while the strip is on show. A note
 * that does not hold the qualifier comes back as it was.
 */
export function withoutRankNote(note: string): string {
  return note.replace(` ${RANK_NOTE}`, "");
}

/** Each coverage count is a house stamp; its ink says what it is, never a fill. */
const STATE = "tag items-baseline gap-1.5";

/**
 * What happened to each act sent: matched with a usable signal, matched with none, matched more than
 * one act of that name (never guessed), or not found. A route without these fields gets one line.
 */
function Coverage({ answer }: { answer: PriceAnswer }) {
  const parts = coverageParts(answer);
  if (!parts)
    return (
      <p data-hold="coverage" className="mt-3 text-sm text-muted-foreground">
        {coverageLine(answer)}
      </p>
    );
  const states: [string, number, string][] = [
    ["Sent", parts.sent, "text-muted-foreground"],
    ["Matched", parts.matched, "text-foreground"],
    // The invented day's values are not Qloo data, so they never take the Qloo colour.
    [
      "With a signal",
      parts.priced,
      answer.source === "invented_day" ? "text-foreground" : "text-prov-qloo",
    ],
    ["No signal", parts.noSignal, "text-muted-foreground"],
    ["Ambiguous", parts.ambiguous, "text-warning"],
    ["Not found", parts.notFound, "text-muted-foreground"],
  ];
  const { noSignal, ambiguous } = answer.coverage;
  return (
    <div data-hold="coverage" className="mt-3">
      <p className="sr-only">{coverageLine(answer)}.</p>
      <ul aria-hidden="true" className="flex flex-wrap gap-1.5">
        {states
          .filter(([label, value]) => value > 0 || label === "Matched" || label === "With a signal")
          .map(([label, value, tone]) => (
            <li key={label} className={`${STATE} ${tone}`}>
              {label} <span className="leading-none tracking-normal tabular-nums">{value}</span>
            </li>
          ))}
      </ul>
      {ambiguous && ambiguous.length > 0 ? (
        <p className="mt-2 text-sm break-words">
          Not guessed: {ambiguous.join(", ")} matched more than one act of that name, so none was picked.
        </p>
      ) : null}
      {noSignal && noSignal.length > 0 ? (
        <p className="mt-1 text-sm break-words text-muted-foreground">Matched, with no usable signal: {noSignal.join(", ")}.</p>
      ) : null}
    </div>
  );
}

/** The sort control's choices: a published day's own ranking first, then the two sorts every answer has. */
function orderChoices(answer: PriceAnswer): readonly (readonly [PriceOrder, string])[] {
  const sorts = [
    ["minutes", PRICE_COPY.longestFirst],
    ["overlap", PRICE_COPY.overlapFirst],
  ] as const;
  return answer.basis === "saved_ranking" ? [["selection", PRICE_COPY.rankingFirst], ...sorts] : sorts;
}

/**
 * The answer: where it came from, then (a published day) how its pairs were chosen, then the computed order
 * sentence, the sort control and the compared values in the order chosen, then what happened to each act
 * sent. A published day's ten values all show; a pasted grid shows five, the rest in a closed fold. When
 * no pair sent got a value because none is one the saved day's page prints, one line says so.
 */
function PricedList({
  answer,
  order,
  onOrder,
  dayTitle = null,
  strip = null,
}: {
  answer: PriceAnswer;
  order: PriceOrder;
  onOrder: (order: PriceOrder) => void;
  /** The published day a pasted grid's names are on, when the page knows it. */
  dayTitle?: string | null;
  /** A published day's strip, drawn above the sort control and the values. */
  strip?: StripLayout | null;
}) {
  const reorder = orderLine(answer);
  const values = comparedPairs(answer, order);
  const open = answer.basis === "saved_ranking" ? values : values.slice(0, PRICE_LIMITS.shownOpen);
  const more = values.slice(open.length);
  const row = (pair: PriceAnswer["pairs"][number]) => (
    <li key={pairKey(pair.a, pair.b)} className="py-2.5 text-sm font-semibold break-words first:pt-0 last:pb-0">
      {pairLine(pair, answer)}
    </li>
  );
  const unserved =
    values.length === 0 && answer.pairs.length > 0 && answer.pairs.every((pair) => pair.reason === "not_ranked_on_saved_day");
  return (
    <div className="mt-4">
      <p className="rounded-md bg-background p-3 text-sm font-semibold leading-relaxed">{sourceBanner(answer)}</p>
      {answer.basis === "saved_ranking" ? (
        <p className="mt-3 max-w-prose text-sm leading-relaxed">{PRICE_COPY.workedExample}</p>
      ) : null}
      {reorder ? (
        <p data-hold="order" className="mt-3 text-sm font-semibold">
          {reorder}
        </p>
      ) : null}
      {unserved ? <p className="mt-3 max-w-prose text-sm leading-relaxed">{PRICE_COPY.noneServed(dayTitle)}</p> : null}
      {strip ? <CheckDayStrip layout={strip} /> : null}
      {values.length > 1 ? (
        <div role="group" aria-label={PRICE_COPY.sortLabel} className="mt-3 flex flex-wrap gap-2">
          {orderChoices(answer).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={order === value} onClick={() => onOrder(value)} className={TOGGLE}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {open.length > 0 ? (
        <ol aria-label="Compared overlaps" data-hold="rows" className="mt-3 divide-y divide-border">
          {open.map(row)}
        </ol>
      ) : null}
      {more.length > 0 ? (
        <details data-hold="more" className="group cc-disclosure mt-2">
          <summary className="cc-disclosure-summary text-sm">
            {PRICE_COPY.moreCompared(more.length)}
            <span aria-hidden="true" className="cc-disclosure-mark" />
          </summary>
          <ol aria-label="More compared overlaps" className="divide-y divide-border pb-2">
            {more.map(row)}
          </ol>
        </details>
      ) : null}
      <Coverage answer={answer} />
    </div>
  );
}

/**
 * The overlaps this step did not compare: one count line in ink, then a closed fold whose summary names it,
 * with each overlap and its reason in words (passed over before the request, or sent and answered with no
 * value). Before an answer it lists only the overlaps passed over. Nothing when every overlap was compared.
 */
function NotCompared({ request, answer }: { request: PriceRequest; answer: PriceAnswer | null }) {
  const items = notCompared(request.skipped, answer);
  const line = notComparedLine(items, answer);
  if (!line) return null;
  return (
    <div data-tail="" className="mt-4">
      <p className="max-w-prose text-sm leading-relaxed">{line}</p>
      <details className="group cc-disclosure mt-2">
        <summary className="cc-disclosure-summary text-sm">
          {PRICE_COPY.notComparedSummary(items.length)}
          <span aria-hidden="true" className="cc-disclosure-mark" />
        </summary>
        <ul aria-label="Overlaps not compared" className="max-w-prose space-y-1 pb-2 text-sm leading-relaxed break-words">
          {items.map((item) => {
            const pair = item.kind === "passed" ? item.overlap : item.pair;
            return <li key={`${item.kind} ${pairKey(pair.a, pair.b)}`}>{notComparedText(item, answer, request.basis)}</li>;
          })}
        </ul>
      </details>
    </div>
  );
}
