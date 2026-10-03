import type { Ref } from "react";

import {
  CHECK_COPY,
  RULE_LABELS,
  clockWindow,
  formatClock,
  minutesLabel,
  pairCountLabel,
  type CheckReport,
  type SharedPair,
} from "@/lib/check";
import { cn } from "@/lib/utils";

/** Pairs listed before "Show all". */
export const SHARED_SHOWN = 15;

type Props = {
  report: CheckReport;
  /** Pair ids marked "Kept on purpose" in this tab. */
  kept: ReadonlySet<string>;
  onKeep: (id: string, kept: boolean) => void;
  showAll: boolean;
  onShowAll: (showAll: boolean) => void;
  /** Changes with every check, so the sections reveal again (the reveal is skipped under reduced motion). */
  nonce: number;
  /** The first heading, which takes focus after a check. */
  headingRef?: Ref<HTMLHeadingElement>;
};

const PANEL = "rounded-xl border border-border bg-card p-4 sm:p-6 print:rounded-none print:border-0 print:p-0";

function SharedRow({
  pair,
  kept,
  isBreak,
  onKeep,
}: {
  pair: SharedPair;
  kept: boolean;
  isBreak: boolean;
  onKeep: (id: string, kept: boolean) => void;
}) {
  const names = `${pair.a.act} and ${pair.b.act}`;
  return (
    <li className="break-inside-avoid py-3 first:pt-0 last:pb-0 print:py-[1.5pt]">
      <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 print:flex print:flex-wrap print:items-baseline print:gap-x-3">
          <p className="font-semibold break-words">
            {pair.a.act} <span className="text-muted-foreground">({pair.a.stage})</span> and {pair.b.act}{" "}
            <span className="text-muted-foreground">({pair.b.stage})</span>
          </p>
          <p className="mt-0.5 text-sm break-words text-muted-foreground print:mt-0">
            {minutesLabel(pair.minutes)} shared, {clockWindow(pair.windowStart, pair.windowEnd)}
            {pair.a.locked || pair.b.locked ? " (one is locked)." : "."}
          </p>
        </div>
        <label className="-mt-0.5 flex min-h-11 w-fit shrink-0 cursor-pointer items-center gap-2.5 text-sm print:hidden">
          <input
            type="checkbox"
            checked={kept}
            onChange={(event) => onKeep(pair.id, event.target.checked)}
            className="size-5 shrink-0 accent-primary"
          />
          <span>
            Kept on purpose<span className="sr-only">: {names}</span>
          </span>
        </label>
      </div>
      {kept ? (
        <p className="mt-1 hidden text-sm font-semibold print:block">Kept by the programmer</p>
      ) : null}
      {kept && isBreak ? (
        <p className="mt-0.5 text-sm text-muted-foreground">
          Still listed under rule breaks: you asked that they never overlap.
        </p>
      ) : null}
    </li>
  );
}

export function CheckResults({ report, kept, onKeep, showAll, onShowAll, nonce, headingRef }: Props) {
  const { breaks, shared, settings, sets, stages, lockedCount } = report;
  const shown = showAll ? shared : shared.slice(0, SHARED_SHOWN);
  const hiddenCount = shared.length - shown.length;
  const breakPairs = new Set(
    breaks
      .filter((b) => b.rule === 5)
      .map((b) => b.rows.slice().sort((x, y) => x - y).join("-")),
  );

  return (
    <div className="mt-8 space-y-6 print:mt-0 print:space-y-[8pt]">
      <p className="text-sm text-muted-foreground">
        Read {sets.length} {sets.length === 1 ? "set" : "sets"} on {stages.length}{" "}
        {stages.length === 1 ? "stage" : "stages"}
        {lockedCount > 0
          ? `; ${lockedCount} marked locked. Locked sets are shown but have no effect on these rules.`
          : "."}
      </p>

      <p className="hidden text-sm break-words print:block">
        <strong className="font-semibold">Settings.</strong> Changeover {settings.changeover} minutes.
        Curfew {settings.curfew === null ? "none" : formatClock(settings.curfew)}. Never overlap:{" "}
        {settings.pairs.length === 0
          ? "none listed"
          : settings.pairs.map((p) => `${p.a.act} | ${p.b.act}`).join("; ")}
        .
      </p>

      <section key={`rules-${nonce}`} aria-labelledby="check-rules-heading" className={cn(PANEL, "cc-check-rules")}>
        <h2 id="check-rules-heading" ref={headingRef} tabIndex={-1} className="type-title scroll-mt-24 outline-offset-4 print:text-[13pt] print:outline-none">
          Rule breaks ({breaks.length})
        </h2>
        {breaks.length === 0 ? (
          <p className="mt-3">{CHECK_COPY.noBreaks}</p>
        ) : (
          <ol className="mt-4 space-y-4 print:mt-[4pt] print:space-y-[4pt]">
            {breaks.map((item, index) => (
              <li
                key={`${item.rule}-${item.rows.join("-")}-${index}`}
                className="break-inside-avoid border-l-4 border-primary pl-3"
              >
                <p className="type-kicker text-muted-foreground">{RULE_LABELS[item.rule]}</p>
                <p className="mt-1 font-semibold break-words">{item.text}</p>
                <p className="mt-0.5 text-sm break-words text-muted-foreground">{item.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        key={`shared-${nonce}`}
        aria-labelledby="check-shared-heading"
        className={cn(PANEL, "cc-check-shared")}
      >
        <h2 id="check-shared-heading" className="type-title print:text-[13pt]">
          Sets that share time ({pairCountLabel(shared.length)})
        </h2>
        {shared.length === 0 ? (
          <p className="mt-3">No two sets on different acts share a minute.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground print:hidden">
              Longest first. A mark under a pair is yours: it never removes a rule break above.
            </p>
            <p className="mt-1 hidden text-sm text-muted-foreground print:block">
              Longest first.
              {hiddenCount > 0 ? ` The ${SHARED_SHOWN} longest of ${pairCountLabel(shared.length)} are listed.` : ""}
            </p>
            <ul className="mt-4 divide-y divide-border print:mt-[4pt] print:divide-y-0">
              {shown.map((pair) => (
                <SharedRow
                  key={pair.id}
                  pair={pair}
                  kept={kept.has(pair.id)}
                  isBreak={breakPairs.has([pair.a.row, pair.b.row].sort((x, y) => x - y).join("-"))}
                  onKeep={onKeep}
                />
              ))}
            </ul>
            {shared.length > SHARED_SHOWN ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => onShowAll(!showAll)}
                  aria-expanded={showAll}
                  className="min-h-11 rounded-md border border-border-strong px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring print:hidden"
                >
                  {showAll ? `Show the ${SHARED_SHOWN} longest` : `Show all ${shared.length}`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <div className="max-w-prose space-y-3 text-[0.9375rem] leading-relaxed print:space-y-[3pt] print:text-[9pt]">
        <p>{CHECK_COPY.notComputed}</p>
        <p>{CHECK_COPY.elsewhere}</p>
      </div>
    </div>
  );
}
