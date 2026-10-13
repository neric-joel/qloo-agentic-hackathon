import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  PRICE_COPY,
  coverageLine,
  coverageParts,
  orderLine,
  pairLine,
  recovery,
  scopeNote,
  sortedPairs,
  sourceBanner,
  type PriceAnswer,
  type PriceMode,
  type PriceRequest,
} from "@/lib/check-price";

/** What the page holds of pricing for the grid on show. Reset by every check and every change tried. */
export type PriceState =
  | { phase: "idle" }
  | { phase: "loading"; mode: PriceMode }
  /** The saved attempt found no saved day: the live button is offered now, and only now. */
  | { phase: "not_saved" }
  | { phase: "ready"; answer: PriceAnswer }
  | { phase: "refused"; mode: PriceMode; code: string; message: string }
  | { phase: "error"; mode: PriceMode };

export type PriceOrder = "minutes" | "overlap";

const PANEL = "rounded-lg border border-surface-edge bg-card p-5 sm:p-6";

const TOGGLE =
  "min-h-10 rounded-md border border-border-strong px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background";

/**
 * "Compare audience overlap (optional)", between the rule breaks and the pairs. Nothing here sends
 * anything: the buttons call `onPrice`, and the page makes its one request only then. A failed answer
 * or a refusal keeps every result above and offers a retry where one can help, never a re-check.
 * Not printed: the brief lists the compared overlaps when there are any.
 */
export function CheckPrice({
  request,
  noOverlap,
  state,
  order,
  onOrder,
  onPrice,
  stale,
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
}) {
  const k = request?.overlaps.length ?? 0;
  const n = request?.acts.length ?? 0;
  const busy = state.phase === "loading";
  const omitted = request?.omitted ?? 0;
  const savedButton = (
    <Button type="button" variant="outline" disabled={busy || stale} onClick={() => onPrice("saved")}>
      {PRICE_COPY.button}
    </Button>
  );
  const failed =
    state.phase === "error" ? recovery(state.mode, null) : state.phase === "refused" ? recovery(state.mode, state.code) : null;

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
          <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed">{PRICE_COPY.intro(k, n, omitted)}</p>
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
                  <span className="sr-only">: {failed.retry === "live" ? PRICE_COPY.askButton(n) : PRICE_COPY.button}</span>
                </Button>
              ) : null}
            </div>
          ) : null}
          {state.phase === "not_saved" ? (
            <div className="mt-4 rounded-md bg-background p-3 sm:p-4">
              <p className="text-sm leading-relaxed">{PRICE_COPY.notSaved(n, request.need)}</p>
              <Button type="button" variant="outline" className="mt-3" disabled={stale} onClick={() => onPrice("live")}>
                {PRICE_COPY.askButton(n)}
              </Button>
            </div>
          ) : null}
          {state.phase === "ready" ? <PricedList answer={state.answer} order={order} onOrder={onOrder} /> : null}
          <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {scopeNote(state.phase === "ready" ? state.answer : null, request)}
          </p>
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

function PricedList({
  answer,
  order,
  onOrder,
}: {
  answer: PriceAnswer;
  order: PriceOrder;
  onOrder: (order: PriceOrder) => void;
}) {
  const reorder = orderLine(answer);
  return (
    <div className="mt-4">
      <p className="rounded-md bg-background p-3 text-sm font-semibold leading-relaxed">{sourceBanner(answer)}</p>
      <Coverage answer={answer} />
      <div role="group" aria-label={PRICE_COPY.sortLabel} className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ["minutes", PRICE_COPY.longestFirst],
            ["overlap", PRICE_COPY.overlapFirst],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={order === value} onClick={() => onOrder(value)} className={TOGGLE}>
            {label}
          </button>
        ))}
      </div>
      <ol className="mt-3 divide-y divide-border">
        {sortedPairs(answer, order).map((pair) => (
          <li key={`${pair.a}\u0000${pair.b}`} className="py-2.5 text-sm break-words first:pt-0 last:pb-0">
            <span className={pair.status === "priced" ? "font-semibold" : "text-muted-foreground"}>{pairLine(pair, answer)}</span>
          </li>
        ))}
      </ol>
      {reorder ? <p className="mt-3 text-sm font-semibold">{reorder}</p> : null}
    </div>
  );
}
