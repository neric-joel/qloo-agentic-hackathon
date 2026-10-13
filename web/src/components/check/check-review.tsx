import type { ReactNode } from "react";
import { Download, Link2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pairCountLabel } from "@/lib/check";
import type { ReviewCounts } from "@/lib/check-decisions";
import { PRICE_COPY } from "@/lib/check-price";
import { SHARE_COPY } from "@/lib/check-share";
import { cn } from "@/lib/utils";

import type { PriceState } from "./check-price";
import { RESULT_IDS } from "./check-results";
import { TEXT_ACTION } from "./check-trial-panel";

export const REVIEW_COPY = {
  heading: "Draft review",
  print: "Print draft brief",
  preview: "Printed brief, preview",
  allDecided: "Every finding decided",
  nothing: "No rule breaks to review.",
} as const;

/**
 * The "Compared with Qloo data" line: "not yet" until an answer is on show, then how many pairs and
 * from where. The invented day is never called Qloo data.
 */
export function comparedLine(state: PriceState): { value: string; done: boolean } {
  if (state.phase === "loading") return { value: "Comparing now", done: false };
  if (state.phase === "not_saved") return { value: "Not yet · no saved day matched", done: false };
  if (state.phase === "error") return { value: "Not yet · the server did not answer", done: false };
  if (state.phase === "refused") return { value: "Not yet · refused, see the step", done: false };
  if (state.phase !== "ready") return { value: "Not yet", done: false };
  const { answer } = state;
  const compared = answer.pairs.filter((pair) => pair.status === "priced").length;
  const pairs = `${compared} of ${pairCountLabel(answer.pairs.length)}`;
  if (answer.source === "invented_day") return { value: `No · invented day, not Qloo data (${pairs})`, done: true };
  if (answer.source === "saved_day") return { value: `${pairs} · saved day, no request now`, done: true };
  return { value: `${pairs} · asked Qloo just now`, done: true };
}

/** The "Rule breaks" row: "3 · 1 of 3 reviewed", or "0" when there is nothing to review. */
export function ruleBreaksValue(counts: Pick<ReviewCounts, "breaks" | "breaksReviewed">): string {
  return counts.breaks === 0 ? "0" : `${counts.breaks} · ${counts.breaksReviewed} of ${counts.breaks} reviewed`;
}

function Row({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-baseline gap-x-3 py-1.5">
      <dt className="text-[0.8125rem] leading-5 text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm break-words", strong ? "font-semibold text-foreground" : "text-foreground")}>{children}</dd>
    </div>
  );
}

/**
 * The completion summary of a checked draft: what was checked, what is decided, what is still open,
 * and the three ways to take it away. A right rail that stays in view from `lg` up; inline after the
 * results on a phone. It counts and links only: nothing here changes a figure or sends anything.
 */
export function CheckReview({
  counts,
  sample,
  price,
  searched,
  applied,
  stale,
  onPrint,
  onCopy,
  onDownload,
  canShare,
  share,
  preview,
}: {
  counts: ReviewCounts;
  /** The checked snapshot is the invented sample. */
  sample: boolean;
  price: PriceState;
  /** Searches run ("Find a change") on this check, and changes applied to the working copy. */
  searched: number;
  applied: number;
  stale: boolean;
  onPrint: () => void;
  onCopy: () => void;
  onDownload: () => void;
  /** The link fits; when it does not, the share button is left out and `share` says why. */
  canShare: boolean;
  /** What the share button did, and the warning before it is pressed. */
  share: ReactNode;
  /** The brief drawn small, from `lg` up. */
  preview?: ReactNode;
}) {
  const compared = comparedLine(price);
  const open = counts.openBreaks + counts.openPairs;
  return (
    <section
      id={RESULT_IDS.review}
      aria-labelledby="check-review-heading"
      className="scroll-mt-24 overflow-hidden rounded-lg border border-surface-edge bg-card print:hidden"
    >
      <div className="mx-5 flex items-baseline justify-between gap-3 border-b border-border pt-4 pb-3.5">
        <h2 id="check-review-heading" className="text-[0.9375rem] leading-6 font-semibold text-foreground">
          {REVIEW_COPY.heading}
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">
          {open === 0 ? REVIEW_COPY.allDecided : `${open} open`}
        </p>
      </div>

      <div className="px-5 pt-4 pb-3">
        {sample ? (
          <p className="tag mb-3 text-muted-foreground">
            Invented sample
          </p>
        ) : null}
        {counts.breaks === 0 ? (
          // Nothing to review is not a finished review: no count and no bar, only the words.
          <p className="text-[0.9375rem] leading-6 font-semibold text-foreground">{REVIEW_COPY.nothing}</p>
        ) : (
          <>
            <p className="flex items-baseline gap-2">
              <span className="type-numeral text-5xl leading-none text-foreground">{counts.breaksReviewed}</span>
              <span className="type-numeral text-2xl leading-none text-muted-foreground">/ {counts.breaks}</span>
              <span className="ml-1 text-sm text-muted-foreground">rule breaks reviewed</span>
            </p>
            <div aria-hidden="true" data-review-bar="" className="mt-3 flex gap-1">
              {Array.from({ length: counts.breaks }, (_, index) => (
                <span
                  key={index}
                  className={cn("h-1.5 flex-1 rounded-bar", index < counts.breaksReviewed ? "bg-foreground" : "bg-muted")}
                />
              ))}
            </div>
          </>
        )}

        <dl className="mt-3 divide-y divide-border">
          <Row label="Sets checked">
            {counts.sets} on {counts.stages} {counts.stages === 1 ? "stage" : "stages"}
          </Row>
          <Row label="Rule breaks">{ruleBreaksValue(counts)}</Row>
          <Row label="Overlaps">
            {pairCountLabel(counts.pairs)} · {counts.pairsDecided} decided
          </Row>
          <Row label="Compared with Qloo data" strong={compared.done}>
            {compared.value}
            {!compared.done && price.phase !== "loading" ? (
              <>
                <br />
                <a
                  href={`#${RESULT_IDS.price}`}
                  className="font-semibold text-foreground underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {PRICE_COPY.button}
                </a>
              </>
            ) : null}
          </Row>
          <Row label="Changes">
            {searched === 0 && applied === 0 ? "None tested yet" : `${searched} tested · ${applied} applied`}
          </Row>
          <Row label="Kept on purpose">{counts.kept}</Row>
          <Row label="Not changing">{counts.notChanging}</Row>
          <Row label="Open" strong={open > 0}>
            {open === 0
              ? "None"
              : [
                  counts.openBreaks > 0 ? `${counts.openBreaks} rule ${counts.openBreaks === 1 ? "break" : "breaks"}` : null,
                  counts.openPairs > 0 ? pairCountLabel(counts.openPairs) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </Row>
        </dl>
        {stale ? <p className="mt-2 text-sm font-semibold text-warning">These counts are for the grid as last checked.</p> : null}
      </div>

      <div className="mx-5 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-border py-4">
        <Button type="button" variant="outline" className="col-span-2" onClick={onPrint}>
          <Printer aria-hidden="true" />
          {REVIEW_COPY.print}
        </Button>
        {canShare ? (
          <button type="button" className={cn(TEXT_ACTION, "-ml-2")} onClick={onCopy} aria-describedby="check-review-share">
            <Link2 aria-hidden="true" />
            {SHARE_COPY.button}
          </button>
        ) : null}
        <button type="button" className={cn(TEXT_ACTION, canShare ? undefined : "col-span-2 -ml-2 justify-self-start")} onClick={onDownload}>
          <Download aria-hidden="true" />
          {SHARE_COPY.download}
        </button>
        <div id="check-review-share" className="col-span-2 text-xs leading-relaxed">
          {share}
        </div>
      </div>

      {preview ? (
        <div aria-hidden="true" className="mx-5 hidden border-t border-border pt-3 pb-5 lg:block">
          <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">{REVIEW_COPY.preview}</p>
          <div className="relative mt-2 h-48 overflow-hidden rounded-md border border-border-strong bg-white">
            <div inert className="pointer-events-none absolute top-0 left-0 w-[640px] origin-top-left scale-[0.4375] select-none">
              {preview}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
