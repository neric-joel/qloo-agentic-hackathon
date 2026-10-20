import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  recovery,
  scopeNote,
  sentActs,
  sourceBanner,
  type PairOrder,
  type PriceAnswer,
  type PriceMode,
  type PriceRequest,
} from "@/lib/check-price";
import { cn } from "@/lib/utils";

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
          {state.phase === "idle" ? <div className="mt-4">{savedButton}</div> : null}
          {state.phase === "loading" ? (
            <p aria-busy="true" className="mt-4 text-sm text-muted-foreground">
              {PRICE_COPY.loading}
            </p>
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
                  {!published && publishedTitle && onTryPublished ? (
                    <button type="button" className={cn(TEXT_ACTION, "mt-1 -ml-2 h-auto py-2.5 text-left whitespace-normal")} onClick={onTryPublished}>
                      {PRICE_COPY.tryPublished(publishedTitle)}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          {answer ? <PricedList answer={answer} order={order} onOrder={onOrder} dayTitle={request.served?.title ?? null} /> : null}
          <NotCompared request={request} answer={answer} />
          <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">{scopeNote(answer, request)}</p>
        </>
      )}
    </section>
  );
}

/** Each coverage count is a house stamp; its ink says what it is, never a fill. */
const STATE = "tag items-baseline gap-1.5";

/**
 * What happened to each act sent: matched with a usable signal, matched with none, matched more than
 * one act of that name (never guessed), or not found. A route without these fields gets one line.
 */
function Coverage({ answer }: { answer: PriceAnswer }) {
  const parts = coverageParts(answer);
  if (!parts) return <p className="mt-3 text-sm text-muted-foreground">{coverageLine(answer)}</p>;
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
    <div className="mt-3">
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
}: {
  answer: PriceAnswer;
  order: PriceOrder;
  onOrder: (order: PriceOrder) => void;
  /** The published day a pasted grid's names are on, when the page knows it. */
  dayTitle?: string | null;
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
      {reorder ? <p className="mt-3 text-sm font-semibold">{reorder}</p> : null}
      {unserved ? <p className="mt-3 max-w-prose text-sm leading-relaxed">{PRICE_COPY.noneServed(dayTitle)}</p> : null}
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
        <ol aria-label="Compared overlaps" className="mt-3 divide-y divide-border">
          {open.map(row)}
        </ol>
      ) : null}
      {more.length > 0 ? (
        <details className="group cc-disclosure mt-2">
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
    <div className="mt-4">
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
