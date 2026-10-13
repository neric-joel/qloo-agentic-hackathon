import type { CSSProperties } from "react";

import { CHECK_COPY, RULE_LABELS, formatClock, pairCountLabel, type CheckReport } from "@/lib/check";
import { decisionLine, type Decision } from "@/lib/check-decisions";
import {
  PRICE_COPY,
  coverageLine,
  orderLine,
  pairLine,
  rankScope,
  sourceBanner,
  type PriceAnswer,
  type ScopeOf,
} from "@/lib/check-price";
import { SAMPLE_LABEL } from "@/lib/check-sample";
import { wasPlace, type TrialChange } from "@/lib/check-trial";
import { cn } from "@/lib/utils";

/** Rows printed per list before "+K more on screen". */
export const BRIEF_ROWS = 25;

export const BRIEF_FOOTER = "Computed in your browser from the pasted grid.";

/** The footer: where the figures came from, and what any audience overlap on the brief is a rank among. */
export function briefFooter(price: ScopeOf | null): string {
  return price ? `${BRIEF_FOOTER} Audience overlap: ${rankScope(price)}` : BRIEF_FOOTER;
}

/** "Snapshot: the invented sample as checked at 14:05, with 1 change applied in a working copy." */
export function snapshotLine({
  sample,
  checkedAt,
  applied,
}: {
  sample: boolean;
  /** Minutes from midnight, local time, when the check ran; null when unknown. */
  checkedAt: number | null;
  applied: number;
}): string {
  const what = sample ? "the invented sample" : "the pasted grid";
  const when = checkedAt === null ? "" : ` at ${formatClock(checkedAt)}`;
  const changes = applied === 0 ? "" : `, with ${applied} ${applied === 1 ? "change" : "changes"} applied in a working copy`;
  return `Snapshot: ${what} as checked${when}${changes}.`;
}

export const BRIEF_STALE = "The fields were edited after this check; this brief shows the grid as last checked.";

/** The printed brief's palette, cool ink on white (the same values as the pages' print rules), for its on-screen preview. */
export const PAPER: CSSProperties = {
  ["--background" as string]: "#ffffff",
  ["--foreground" as string]: "#141821",
  ["--card" as string]: "#ffffff",
  ["--card-foreground" as string]: "#141821",
  ["--muted" as string]: "#e5e8ec",
  ["--muted-foreground" as string]: "#525864",
  ["--border" as string]: "#d6d9de",
  ["--border-strong" as string]: "#7b818a",
  ["--primary" as string]: "#ca2a02",
  ["--destructive" as string]: "#ca2a02",
  ["--highlight" as string]: "#c7dcfc",
  ["--highlight-foreground" as string]: "#141821",
  colorScheme: "light",
  background: "#ffffff",
  color: "#141821",
};

function Capped({ items }: { items: readonly string[] }) {
  const shown = items.slice(0, BRIEF_ROWS);
  const more = items.length - shown.length;
  return (
    <>
      <ul className="mt-[2pt] list-disc space-y-[1pt] pl-[12pt]">
        {shown.map((item, index) => (
          <li key={index} className="break-inside-avoid break-words">
            {item}
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="mt-[2pt] italic">+{more} more on screen</p> : null}
    </>
  );
}

/**
 * The draft brief "Print draft brief" prints (one page or more for a long grid): the checked snapshot,
 * counts, settings, applied changes, rule breaks, decisions and the compared overlaps when there are
 * any. Print only; with `preview` the same sheet is drawn on screen as a small paper thumbnail.
 */
export function CheckBrief({
  report,
  applied,
  decisions,
  price,
  sample = false,
  checkedAt = null,
  stale = false,
  preview = false,
}: {
  report: CheckReport;
  applied: readonly TrialChange[];
  decisions: readonly Decision[];
  price: PriceAnswer | null;
  /** The checked snapshot is the invented sample: the brief says so under its title. */
  sample?: boolean;
  /** When the check ran, minutes from local midnight. */
  checkedAt?: number | null;
  /** The fields were edited after the check: the brief says it shows the grid as last checked. */
  stale?: boolean;
  /** Draw on screen, scaled down by the caller, instead of only in print. */
  preview?: boolean;
}) {
  const { sets, stages, settings, breaks, shared } = report;
  const reorder = price ? orderLine(price) : null;
  return (
    <div
      className={cn(preview ? "p-[22pt]" : "hidden print:block", "text-[9pt] leading-snug")}
      style={preview ? PAPER : undefined}
    >
      <p className={cn("type-title text-[16pt]", !preview && "hidden print:block")}>{CHECK_COPY.printTitle}</p>
      {sample ? <p className="mt-[2pt] font-semibold">{SAMPLE_LABEL}</p> : null}
      <p className="mt-[2pt]">{snapshotLine({ sample, checkedAt, applied: applied.length })}</p>
      {stale ? <p className="mt-[2pt] font-semibold">{BRIEF_STALE}</p> : null}
      <p className="mt-[4pt]">
        Read {sets.length} {sets.length === 1 ? "set" : "sets"} on {stages.length} {stages.length === 1 ? "stage" : "stages"}.
        Rule breaks: {breaks.length}. Sets that share time: {pairCountLabel(shared.length)}.
      </p>
      <p className="mt-[2pt] break-words">
        <strong className="font-semibold">Settings.</strong> Changeover {settings.changeover} minutes. Curfew{" "}
        {settings.curfew === null ? "none" : formatClock(settings.curfew)}. Never overlap:{" "}
        {settings.pairs.length === 0 ? "none listed" : settings.pairs.map((p) => `${p.a.act} | ${p.b.act}`).join("; ")}.
      </p>

      {applied.length > 0 ? (
        <section className="mt-[6pt]">
          <h2 className="text-[11pt] font-semibold">Changes applied to a working copy ({applied.length})</h2>
          <Capped
            items={applied.flatMap((change) => change.moves.map((move, index) => `${change.lines[index]} (was ${wasPlace(move)})`))}
          />
        </section>
      ) : null}

      <section className="mt-[6pt]">
        <h2 className="text-[11pt] font-semibold">Rule breaks ({breaks.length})</h2>
        {breaks.length === 0 ? (
          <p className="mt-[2pt]">{CHECK_COPY.noBreaks}</p>
        ) : (
          <Capped items={breaks.map((item) => `${RULE_LABELS[item.rule]}: ${item.text}`)} />
        )}
      </section>

      <section className="mt-[6pt]">
        <h2 className="text-[11pt] font-semibold">Your decisions ({decisions.length})</h2>
        {decisions.length === 0 ? <p className="mt-[2pt]">None marked.</p> : <Capped items={decisions.map(decisionLine)} />}
      </section>

      {price ? (
        <section className="mt-[6pt]">
          <h2 className="text-[11pt] font-semibold">{PRICE_COPY.briefHeading(price.pairs.length)}</h2>
          <p className="mt-[2pt]">
            {sourceBanner(price)} {coverageLine(price)}.
          </p>
          <Capped items={price.pairs.map((pair) => pairLine(pair, price))} />
          {reorder ? <p className="mt-[2pt]">{reorder}</p> : null}
        </section>
      ) : null}

      <p className="mt-[8pt] border-t border-border pt-[3pt] text-[8pt]">{briefFooter(price)}</p>
    </div>
  );
}
