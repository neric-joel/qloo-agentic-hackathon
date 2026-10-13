import { useRef, type CSSProperties } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { ordinal } from "@/lib/clashes";
import type { LensApart, Lenses } from "@/lib/lenses";
import type { PairClash } from "@/lib/preset";
import { useReveal } from "@/lib/use-in-view";

/** The anchor of the section. */
export const TASTE_LENS_ID = "taste-lens";

/** How many pairs each list shows. */
export const LENS_LIST_LIMIT = 5;

/** M6: rows rise this far apart; the second list starts this much after the first. */
const ROW_STAGGER_MS = 40;
const SECOND_LIST_MS = 160;

type LensRow = { a: string; b: string; a_id: string; b_id: string; rank: number; other: number | null };

const CHECK_NOT_PASSED = "The check we set before building did not pass (see How we know).";

/**
 * The lead, from the server's counts only. With the shuffled-overlap comparison it states the null
 * beside the count: random taste numbers move about as many clashes, or fewer. Without it (an older
 * backend) the lead is the plain count; the caveat is then a separate line (`lensCaveat`).
 */
export function lensLead(
  lenses: Pick<Lenses, "ranked" | "only_with_taste" | "only_without_taste" | "shuffled">,
  synthetic = false,
): string {
  const { ranked, only_with_taste: withOnly, only_without_taste: withoutOnly, shuffled } = lenses;
  if (withOnly === 0 && withoutOnly === 0) {
    return `Counting taste overlap does not change which clashes are the ${ranked} costliest on this day.`;
  }
  if (shuffled) {
    const count =
      `Count only draw and time shared, and ${withOnly} of this day’s ${ranked} costliest clashes ` +
      `would drop out of the ${ranked}.`;
    const spread = `shuffled among the same acts ${shuffled.runs} times, they drop ${shuffled.median} (usually ${shuffled.low} to ${shuffled.high})`;
    return withOnly <= shuffled.high
      ? `${count} Random taste numbers do about as much: ${spread}. So this shows that taste overlap reorders the list, not that ${synthetic ? "these numbers" : "Qloo’s numbers"} pick the right clashes. ${CHECK_NOT_PASSED}`
      : `${count} That is more than random taste numbers do: ${spread}. It shows the numbers carry structure, not that they pick the right clashes. ${CHECK_NOT_PASSED}`;
  }
  return (
    `Count only how popular two acts are (popularity is also ${synthetic ? "an invented figure here" : "a Qloo field"}) and how long they share ` +
    `the stage clock, and ${withOnly} of this day’s ${ranked} costliest clashes would no longer ` +
    `be among the ${ranked} costliest.`
  );
}

/** The separate caveat line of the old lead; the shuffled lead carries its own disclosure. */
export const LENS_CAVEAT =
  "This shows how taste overlap reorders this ranking. The check we set before building did not pass (see How we know).";

const HOW_WE_KNOW = "How we know";

/** Text with its "How we know" turned into the link to /method. */
function WithMethodLink({ text, linkClassName }: { text: string; linkClassName: string }) {
  const at = text.lastIndexOf(HOW_WE_KNOW);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Link href="/method" className={linkClassName}>
        {HOW_WE_KNOW}
      </Link>
      {text.slice(at + HOW_WE_KNOW.length)}
    </>
  );
}

/** Pairs in the top `ranked` of one view that fall outside it (or out of the ranking) in the other. */
function droppedRows(rows: readonly LensRow[], ranked: number): LensRow[] {
  return rows
    .filter((row) => row.other === null || row.other > ranked)
    .sort((p, q) => p.rank - q.rank)
    .slice(0, LENS_LIST_LIMIT);
}

function findClash(ranked: readonly PairClash[], aId: string, bId: string): PairClash | null {
  return (
    ranked.find(
      (clash) =>
        (clash.a.act_id === aId && clash.b.act_id === bId) || (clash.a.act_id === bId && clash.b.act_id === aId),
    ) ?? null
  );
}

/**
 * A rank in the other view. The timetable is the same in both, so a null there never means the
 * sets stop sharing time: the pair is unpriced or costs nothing in that view, so it has no rank.
 */
function rankText(rank: number | null, of?: number): string {
  return rank === null ? "not ranked" : placeText(rank, of);
}

/** "21st of 68" when the server says how many pairs are ranked in that view, else the bare ordinal. */
export function placeText(rank: number, of?: number): string {
  return of !== undefined && of >= rank ? `${ordinal(rank)} of ${of}` : ordinal(rank);
}

function LensList({
  title,
  rows,
  describe,
  ranked,
  onOpen,
  startMs,
  embedded = false,
}: {
  title: string;
  rows: readonly LensRow[];
  describe: (row: LensRow) => string;
  ranked: readonly PairClash[];
  onOpen: (clash: PairClash, trigger: HTMLElement | null) => void;
  /** When this list's rows start to rise, if the section plays (M6). */
  startMs: number;
  /**
   * These pairs drop out of the top once taste overlap counts. The list's heading names it; the rows
   * carry no edge of their own (no left stripe).
   */
  marked?: boolean;
  /** Inside the taste section, under its h3: the list heading is an h4. */
  embedded?: boolean;
}) {
  if (rows.length === 0) return null;
  const Heading = embedded ? "h4" : "h3";
  return (
    // On wide screens both lists share two grid rows (heading, rows), so a heading that wraps in one
    // column leaves the two lists' rows aligned.
    <div className="min-w-0 lg:row-span-2 lg:grid lg:grid-rows-subgrid">
      <Heading className="pb-2 text-[0.8125rem] leading-5 font-semibold">{title}</Heading>
      <ol className="divide-y divide-border">
        {rows.map((row, i) => {
          const clash = findClash(ranked, row.a_id, row.b_id);
          const body = (
            <>
              <span className="font-bold">
                {row.a} and {row.b}
              </span>
              <span className="text-muted-foreground"> · {describe(row)}</span>
            </>
          );
          return (
            <li
              key={`${row.a_id}|${row.b_id}`}
              className="cc-lens-row"
              style={{ "--reveal-delay": `${startMs + i * ROW_STAGGER_MS}ms` } as CSSProperties}
            >
              {clash ? (
                <button
                  type="button"
                  onClick={(event) => onOpen(clash, event.currentTarget)}
                  className="group grid min-h-11 w-full cursor-pointer grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-3 py-2.5 pr-1 pl-1 text-left text-sm leading-snug hover:bg-accent focus-visible:bg-accent"
                >
                  <span className="min-w-0">{body}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              ) : (
                <p className="py-2.5 pr-1 pl-1 text-sm leading-snug">{body}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A pair taste overlap moves down: its names and ids, its place on time and draw and with taste. */
export type OtherHalfPair = { a: string; b: string; aId: string; bId: string; from: number; to: number };

/** One key per unordered pair of act ids, for `otherHalfPair`'s exclusion list. */
export function pairKeyOf(aId: string, bId: string): string {
  return [aId, bId].sort().join("|");
}

/**
 * The other half of what taste does: among the day's costliest clashes on time and draw (the lens's
 * draw-and-time list), the pair whose place falls furthest once taste overlap counts. `from` is its place
 * on time and draw, `to` its place with taste; both are read from the lens data, never computed. A pair
 * the taste ranking leaves unranked is skipped, and so is any pair in `exclude` (keys from `pairKeyOf`).
 * Ties go to the pair placed higher on time and draw. Null when no listed pair falls.
 */
export function otherHalfPair(
  lenses: Pick<Lenses, "without_taste">,
  exclude: ReadonlySet<string> = new Set(),
): OtherHalfPair | null {
  let best: OtherHalfPair | null = null;
  for (const entry of lenses.without_taste) {
    if (entry.rank_with_taste === null || exclude.has(pairKeyOf(entry.a_id, entry.b_id))) continue;
    const fall = entry.rank_with_taste - entry.rank;
    if (fall <= 0) continue;
    const bestFall = best ? best.to - best.from : 0;
    if (!best || fall > bestFall || (fall === bestFall && entry.rank < best.from)) {
      best = { a: entry.a, b: entry.b, aId: entry.a_id, bId: entry.b_id, from: entry.rank, to: entry.rank_with_taste };
    }
  }
  return best;
}

/**
 * "Taste also lowers some clashes: A × B ranks #9 on time and draw but #31 with taste (taste overlap 12
 * of 100 on this bill). Lower priority by this index; a candidate to keep." The parenthesis only with the
 * pair's own taste overlap from page data (`overlap`, already formatted 0 to 100). It says where the pair
 * ranks, nothing about how many people it shares. On the invented day it says so and credits no source.
 */
export function otherHalfLine(pair: Pick<OtherHalfPair, "a" | "b" | "from" | "to">, overlap: string | null, synthetic = false): string {
  const reading = overlap === null ? "" : ` (${synthetic ? "invented taste overlap" : "taste overlap"} ${overlap} of 100 on this bill)`;
  const lead = synthetic ? "On this invented day, taste also lowers some clashes" : "Taste also lowers some clashes";
  return `${lead}: ${pair.a} × ${pair.b} ranks #${pair.from} on time and draw but #${pair.to} with taste${reading}. Lower priority by this index; a candidate to keep.`;
}

function apartLine(apart: readonly LensApart[]): string {
  return apart.map((pair) => `${pair.a} and ${pair.b}`).join("; ");
}

/**
 * "What taste overlap changes": the day's costliest clashes ranked with the page's price and on
 * draw and time alone, side by side, as the server ranked them. It shows what the number moves in
 * this ranking, not that it finds clashes better. Rendered only when the lens data loaded.
 */
export function TasteLens({
  lenses,
  ranked,
  onOpen,
  synthetic = false,
  embedded = false,
  className,
}: {
  lenses: Lenses;
  /** The day's priced concurrent clashes, costliest first: a listed pair opens its drawer from here. */
  ranked: readonly PairClash[];
  onOpen: (clash: PairClash, trigger: HTMLElement | null) => void;
  /** The invented day: the lead does not credit Qloo's numbers or its popularity field. */
  synthetic?: boolean;
  /**
   * Inside the taste section's "Two rankings of this day" disclosure: no section or container of its
   * own, the heading an h3 (list headings h4) in one column, and no label above it (the summary names it).
   */
  embedded?: boolean;
  className?: string;
}) {
  const withTaste = droppedRows(
    lenses.with_taste.map((pair) => ({ ...pair, other: pair.rank_without_taste })),
    lenses.ranked,
  );
  const withoutTaste = droppedRows(
    lenses.without_taste.map((pair) => ({ ...pair, other: pair.rank_with_taste })),
    lenses.ranked,
  );
  const unchanged = lenses.only_with_taste === 0 && lenses.only_without_taste === 0;
  // M6: once the lists scroll into view, the draw-and-time rows rise, then the taste rows, then the
  // pairs taste overlap pushes out of the top get their edge. The server HTML is the final frame.
  const listsRef = useRef<HTMLDivElement | null>(null);
  const phase = useReveal(listsRef, { threshold: 0.4 });
  const { priced_with_taste: pricedWith, priced_without_taste: pricedWithout } = lenses;

  const linkClass = "font-semibold text-foreground underline underline-offset-4";
  const lead = (
    <>
      <p>
        <WithMethodLink text={lensLead(lenses, synthetic)} linkClassName={linkClass} />
      </p>
      {unchanged || lenses.shuffled ? null : (
        <p className="text-sm text-muted-foreground">
          <WithMethodLink text={LENS_CAVEAT} linkClassName={linkClass} />
        </p>
      )}
    </>
  );
  const lists =
    withTaste.length > 0 || withoutTaste.length > 0 ? (
      <div
        ref={listsRef}
        data-reveal={phase === "still" ? undefined : phase}
        className={embedded ? "mt-6 grid gap-8 lg:grid-cols-2 lg:gap-x-10 lg:gap-y-0" : "mt-8 grid gap-10 lg:grid-cols-2 lg:gap-x-12 lg:gap-y-0"}
      >
        <LensList
          title="Costliest with taste overlap, lower without"
          rows={withTaste}
          describe={(row) =>
            `${placeText(row.rank, pricedWith)} with taste overlap, ${rankText(row.other, pricedWithout)} on draw and time alone`
          }
          ranked={ranked}
          onOpen={onOpen}
          startMs={SECOND_LIST_MS}
          embedded={embedded}
        />
        <LensList
          title="Costliest on draw and time alone, lower with taste overlap"
          rows={withoutTaste}
          describe={(row) =>
            `${placeText(row.rank, pricedWithout)} on draw and time alone, ${rankText(row.other, pricedWith)} with taste overlap`
          }
          ranked={ranked}
          onOpen={onOpen}
          startMs={0}
          marked
          embedded={embedded}
        />
      </div>
    ) : null;
  const apart =
    lenses.apart.length > 0 ? (
      <div
        className={
          embedded
            ? "mt-6 max-w-prose space-y-1.5 border-t border-border pt-4 text-sm leading-relaxed"
            : "mt-8 max-w-3xl space-y-1.5 rounded-md border border-border p-4 text-sm leading-relaxed sm:p-5"
        }
      >
        <p>
          <span className="font-semibold">High taste overlap, never on at the same time:</span>{" "}
          {apartLine(lenses.apart)}.
        </p>
        <p className="text-muted-foreground">
          Taste overlap only costs something when two sets share time, so these pairs price at zero.{" "}
          <Link href="/method#price" className={linkClass}>
            How the price works
          </Link>
        </p>
      </div>
    ) : null;

  if (embedded) {
    return (
      <div id={TASTE_LENS_ID} aria-labelledby="taste-lens-heading" role="group" className={className}>
        <h3 id="taste-lens-heading" className="type-title">
          What taste overlap changes
        </h3>
        <div className="mt-2 max-w-prose space-y-2 text-[0.9375rem] leading-relaxed">{lead}</div>
        {lists}
        {apart}
      </div>
    );
  }

  return (
    <section id={TASTE_LENS_ID} aria-labelledby="taste-lens-heading" className={className}>
      <div className="container-page py-16 lg:py-20">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
          <div>
            <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Two rankings of this day</p>
            <h2 id="taste-lens-heading" className="type-headline mt-2">
              What taste overlap changes
            </h2>
          </div>
          <div className="space-y-2 text-[0.9375rem] leading-relaxed">{lead}</div>
        </div>
        {lists}
        {apart}
      </div>
    </section>
  );
}
