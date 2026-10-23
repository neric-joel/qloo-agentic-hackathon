import { useEffect, useRef, type CSSProperties } from "react";

import {
  CHECK_COPY,
  CHECK_LIMITS,
  RULE_LABELS,
  clockWindow,
  formatClock,
  noBreaksLine,
  pairCountLabel,
  skippedSentence,
  titleNote,
  type CheckReport,
  type SharedPair,
  type SkippedLine,
} from "@/lib/check";
import { decisionLine, type Decision } from "@/lib/check-decisions";
import {
  PRICE_COPY,
  comparedPairs,
  coverageLine,
  defaultOrder,
  notCompared,
  notComparedLine,
  notComparedText,
  orderLine,
  pairLine,
  rankScope,
  sourceBanner,
  type PairOrder,
  type PassedOverlap,
  type PriceAnswer,
  type ScopeOf,
} from "@/lib/check-price";
import { SAMPLE_LABEL } from "@/lib/check-sample";
import { wasPlace, type TrialChange } from "@/lib/check-trial";
import { cn } from "@/lib/utils";

/** Rows printed per list before "+K more on screen". */
export const BRIEF_ROWS = 25;

/** Overlaps the printed draft lists under its counts, longest first, before "and {k} more overlaps not printed." */
export const BRIEF_OVERLAPS = 12;

/** One printed overlap: "Tidal Fields × Cobalt Rows: 45 min (14:15–15:00)", the earlier set first. */
export function overlapLine(pair: Pick<SharedPair, "a" | "b" | "minutes" | "windowStart" | "windowEnd">): string {
  return `${pair.a.act} × ${pair.b.act}: ${pair.minutes} min (${clockWindow(pair.windowStart, pair.windowEnd)})`;
}

/**
 * What the overlaps left off the page add up to, so none goes unaccounted: "They share 5 to 15 min each, 210 min
 * in all." (one length: "15 min each"; one pair: "It shares 15 min."). Lengths only, no names: the names are on screen.
 */
function restSummary(rest: readonly Pick<SharedPair, "minutes">[]): string {
  const total = rest.reduce((sum, pair) => sum + pair.minutes, 0);
  if (rest.length === 1) return `It shares ${total} min.`;
  const low = Math.min(...rest.map((pair) => pair.minutes));
  const high = Math.max(...rest.map((pair) => pair.minutes));
  const each = low === high ? `${high} min each` : `${low} to ${high} min each`;
  return `They share ${each}, ${total.toLocaleString("en-US")} min in all.`;
}

/**
 * The overlaps the printed draft lists: every pair that shares time, longest first (ties keep the check's order),
 * at most `BRIEF_OVERLAPS`, then "and {k} more overlaps not printed." with their range and total when there are
 * more. The page stays one page; the overflow line makes no claim about the screen.
 */
export function printedOverlaps(shared: readonly SharedPair[]): { lines: string[]; more: string | null } {
  const longest = [...shared].sort((x, y) => y.minutes - x.minutes);
  const k = longest.length - BRIEF_OVERLAPS;
  return {
    lines: longest.slice(0, BRIEF_OVERLAPS).map(overlapLine),
    more: k > 0 ? `and ${k} more ${k === 1 ? "overlap" : "overlaps"} not printed. ${restSummary(longest.slice(BRIEF_OVERLAPS))}` : null,
  };
}

/**
 * The rejected values a skipped line's message quotes (`lib/check.ts` `parseGrid`), each with the short name of
 * its field, read after the message's "Line 4 (Act): " opening.
 */
const QUOTED_VALUES: readonly (readonly [RegExp, string])[] = [
  [/^the start time "(.*)" is not a time such as /, "start"],
  [/^the end time "(.*)" is not a time such as /, "end"],
  [/^the set time "(.*)" is not a range such as /, "time"],
  [/^the locked column should be yes, no or blank, not "(.*)"\.$/, "locked"],
];

/**
 * One skipped line as the printed draft names it, by its act and the value the screen's message quotes, in a
 * short form: "Line 4 (Glass Harbour, start “25:70”) skipped and not checked." The act is named only where the
 * screen's message names it (a line that did not split has none); a line with no act or no quoted value leaves
 * that part out ("Line 9 skipped and not checked.").
 */
export function skippedName(item: Pick<SkippedLine, "line" | "act" | "message">): string {
  const withAct = item.act ? `Line ${item.line} (${item.act}): ` : null;
  const act = withAct !== null && item.message.startsWith(withAct) ? item.act : null;
  const opening = withAct !== null && act !== null ? withAct : `Line ${item.line}: `;
  const reason = item.message.startsWith(opening) ? item.message.slice(opening.length) : item.message;
  let value: string | null = null;
  for (const [pattern, field] of QUOTED_VALUES) {
    const found = reason.match(pattern);
    if (found) {
      value = `${field} “${found[1]}”`;
      break;
    }
  }
  const named = [act, value].filter((part): part is string => Boolean(part)).join(", ");
  return `Line ${item.line}${named ? ` (${named})` : ""} skipped and not checked.`;
}

/**
 * The skipped lines the printed draft names, as many as the screen lists their messages (five), then the
 * screen's own "And {n} more problems." line. The skipped sentence above them already gives every line number.
 */
export function printedSkipped(skipped: readonly Pick<SkippedLine, "line" | "act" | "message">[]): string[] {
  const { errorsShown } = CHECK_LIMITS;
  const named = skipped.slice(0, errorsShown).map(skippedName);
  const rest = skipped.length - named.length;
  return rest > 0 ? [...named, `And ${rest} more ${rest === 1 ? "problem" : "problems"}.`] : named;
}

/** The printed draft's heading, first on the page. */
export const DRAFT_HEADING = "Draft grid check";

/**
 * The sign-off block's labels, each printed with a line to write on: the same three as the published-day brief's
 * (`check-brief.test.ts` pins them equal to its `SIGN_OFF`, which this route does not import).
 */
export const DRAFT_SIGN_OFF = ["Prepared by", "Reviewed by (head of programming)", "Date"] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A date as the printed draft gives it: "20 Oct 2026", in the browser's own time zone. */
export function printedDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * The heading line's words before the print date: "Draft grid check", then " · Sat 14 June" when the grid's day
 * column holds exactly one day.
 */
export function draftHeading(day: string | null | undefined): string {
  return day ? `${DRAFT_HEADING} · ${day}` : DRAFT_HEADING;
}

/**
 * " · printed 20 Oct 2026", read from the browser's clock when the brief is drawn and again as printing starts
 * (`beforeprint`), written straight into its own empty span so the date on paper is the day it was printed.
 * Never stored and never sent; the server's render has no date.
 */
function PrintedOn() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const stamp = () => {
      if (ref.current) ref.current.textContent = ` · printed ${printedDate(new Date())}`;
    };
    stamp();
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);
  return <span ref={ref} data-printed-date="" />;
}

export const BRIEF_FOOTER = "Computed in your browser from the pasted grid.";

/** The same for a published day loaded here, which was not pasted. */
export const BRIEF_FOOTER_PUBLISHED = "Computed in your browser from the published timetable.";

/** The footer: where the figures came from, and what any taste overlap on the brief is a rank among. */
export function briefFooter(price: ScopeOf | null, published = false): string {
  const from = published ? BRIEF_FOOTER_PUBLISHED : BRIEF_FOOTER;
  return price ? `${from} Taste overlap: ${rankScope(price)}` : from;
}

/** "Snapshot: the invented sample as checked at 14:05, with 1 change applied in a working copy." */
export function snapshotLine({
  sample,
  checkedAt,
  applied,
  published = false,
}: {
  sample: boolean;
  /** The checked grid is the published day "Check a published day" loaded. */
  published?: boolean;
  /** Minutes from midnight, local time, when the check ran; null when unknown. */
  checkedAt: number | null;
  applied: number;
}): string {
  const what = sample ? "the invented sample" : published ? "the published timetable" : "the pasted grid";
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
  ["--primary" as string]: "#b61b75",
  ["--destructive" as string]: "#141821",
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
 * The draft brief "Print draft brief" prints (one page or more for a long grid): its heading line (the
 * grid's day when it has one, and the print date), the checked snapshot with each skipped line named (and a
 * title line left out, in the screen's words), counts,
 * the overlaps longest first (twelve at most), settings, applied changes, rule breaks, decisions, the compared
 * overlaps when there are any, and the sign-off block. Print only; with `preview` the same sheet is drawn on
 * screen as a small paper thumbnail, a sheet with the 14px panel corner, without the heading line, the named
 * skipped lines, the title note, the overlap list and the sign-off (they are on paper only). In print it is the page itself,
 * with no corner of its own.
 */
export function CheckBrief({
  report,
  applied,
  decisions,
  price,
  priceSkipped = [],
  priceOrder,
  sample = false,
  published = null,
  checkedAt = null,
  stale = false,
  preview = false,
}: {
  report: CheckReport;
  applied: readonly TrialChange[];
  decisions: readonly Decision[];
  price: PriceAnswer | null;
  /** Overlaps the compare step passed over before its request (both sets locked, or no usable signal). */
  priceSkipped?: readonly PassedOverlap[];
  /** The order the compared values are listed in on screen; left out, the answer's default (`defaultOrder`). */
  priceOrder?: PairOrder;
  /** The checked snapshot is the invented sample: the brief says so under its title. */
  sample?: boolean;
  /** The checked snapshot is a published day loaded by "Check a published day": its label, printed under the title. */
  published?: string | null;
  /** When the check ran, minutes from local midnight. */
  checkedAt?: number | null;
  /** The fields were edited after the check: the brief says it shows the grid as last checked. */
  stale?: boolean;
  /** Draw on screen, scaled down by the caller, instead of only in print. */
  preview?: boolean;
}) {
  const { sets, stages, settings, breaks, shared } = report;
  // A partial check prints what it left out under the title, and every pair rule it could not check.
  const skipped = skippedSentence(report.skipped ?? [], sets.length);
  const skippedLines = printedSkipped(report.skipped ?? []);
  const unchecked = report.uncheckedPairs ?? [];
  const overlaps = printedOverlaps(shared);
  const reorder = price ? orderLine(price) : null;
  const missed = price ? notCompared(priceSkipped, price) : [];
  const missedLine = price ? notComparedLine(missed, price) : null;
  return (
    <div
      className={cn(preview ? "rounded-lg p-[22pt]" : "hidden print:block", "text-[9pt] leading-snug")}
      style={preview ? PAPER : undefined}
    >
      <p data-draft-heading="" className="type-kicker hidden text-[9pt] leading-snug text-muted-foreground print:block">
        {draftHeading(report.day)}
        <PrintedOn />
      </p>
      <p className={cn("type-title text-[16pt]", !preview && "hidden print:block", "print:mt-[2pt]")}>{CHECK_COPY.printTitle}</p>
      {sample ? <p className="mt-[2pt] font-semibold">{SAMPLE_LABEL}</p> : null}
      {published ? <p className="mt-[2pt] font-semibold">{published}</p> : null}
      <p className="mt-[2pt]">{snapshotLine({ sample, checkedAt, applied: applied.length, published: Boolean(published) })}</p>
      {stale ? <p className="mt-[2pt] font-semibold">{BRIEF_STALE}</p> : null}
      {skipped ? (
        <p data-brief-skipped="" className="mt-[2pt] font-semibold break-words">
          {skipped}
        </p>
      ) : null}
      {/* Each skipped line by its act and rejected value, on paper only (the preview adds nothing on screen). */}
      {skippedLines.length > 0 ? (
        <ul data-brief-skipped-lines="" className="mt-[2pt] hidden space-y-[1pt] break-words print:block">
          {skippedLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {unchecked.map((line) => (
        <p key={line} className="mt-[2pt] break-words">
          {line}
        </p>
      ))}
      {/* A title line left out of the check, said on paper as the screen says it above "Read n sets" (paper only:
          the screen's own note is beside the preview). */}
      {report.title ? (
        <p data-brief-title-note="" className="mt-[2pt] hidden break-words print:block">
          {titleNote(report.title)}
        </p>
      ) : null}
      <p className="mt-[4pt]">
        Read {sets.length} {sets.length === 1 ? "set" : "sets"} on {stages.length} {stages.length === 1 ? "stage" : "stages"}.
        Rule breaks: {breaks.length}. Sets that share time: {pairCountLabel(shared.length)}.
      </p>
      {/* The pairs that share time, longest first, on paper only: twelve at most in two columns (read down, then
          across), then how many were left off, so a compared published day still prints on one page. */}
      {overlaps.lines.length > 0 ? (
        <div data-brief-overlaps="" className="hidden print:block">
          <ul className="mt-[2pt] list-disc columns-2 gap-x-[18pt] space-y-[1pt] pl-[12pt]">
            {overlaps.lines.map((line, index) => (
              <li key={index} className="break-inside-avoid break-words">
                {line}
              </li>
            ))}
          </ul>
          {overlaps.more ? <p className="mt-[2pt] italic">{overlaps.more}</p> : null}
        </div>
      ) : null}
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
          <p className="mt-[2pt]">{noBreaksLine(report)}</p>
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
          <h2 className="text-[11pt] font-semibold">{PRICE_COPY.briefHeading(price.pairs.length, price.basis)}</h2>
          <p className="mt-[2pt]">
            {sourceBanner(price)} {coverageLine(price)}.
          </p>
          {/* The screen's order: how the pairs were chosen, the computed order sentence, then the values. */}
          {price.basis === "saved_ranking" ? <p className="mt-[2pt]">{PRICE_COPY.workedExample}</p> : null}
          {reorder ? <p className="mt-[2pt]">{reorder}</p> : null}
          <Capped items={comparedPairs(price, priceOrder ?? defaultOrder(price.basis)).map((pair) => pairLine(pair, price))} />
          {missedLine ? (
            <>
              <p className="mt-[2pt]">{missedLine}</p>
              <Capped items={missed.map((item) => notComparedText(item, price, price.basis))} />
            </>
          ) : null}
        </section>
      ) : null}

      <p className="mt-[8pt] border-t border-border pt-[3pt] text-[8pt]">{briefFooter(price, Boolean(published))}</p>
      {/* Sign-off, on paper only: who prepared the draft and who reviewed it. Each label is followed by a line to
          write on, a 1px rule in the control-edge ink (a mark, never text), as on the published-day brief. */}
      <dl data-sign-off="" className="mt-[10pt] hidden flex-wrap gap-x-[18pt] gap-y-[6pt] text-[9pt] print:flex">
        {DRAFT_SIGN_OFF.map((label) => (
          <div key={label} className="flex min-w-0 items-end gap-[4pt]">
            <dt className="font-semibold whitespace-nowrap">{label}</dt>
            <dd
              aria-label="blank, to fill in"
              className={cn("h-[12pt] border-b border-border-strong", label === "Date" ? "w-[64pt]" : "w-[96pt]")}
            />
          </div>
        ))}
      </dl>
    </div>
  );
}
