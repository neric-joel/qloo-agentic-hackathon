import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel/provenance-chip";
import type { Provenance } from "@/lib/events";
import {
  METHOD_FIGURES,
  formatAuc,
  formatInterval,
  formatPct,
  formatWholePct,
  methodRow,
  numberWord,
} from "@/lib/method-figures";

export const metadata = {
  title: "How we know",
  description:
    "What Clash Control's taste overlap is, what we tested it against, and where it fell short.",
} satisfies Metadata;

const { backtest, coverage, index, liveCheck, moves, scale } = METHOD_FIGURES;
const taste = methodRow("taste");
const genre = methodRow("genre");
const popularity = methodRow("popularity");
const random = methodRow("random");

/** A section of the page: its heading on the left on wide screens, its text on the right. */
function Section({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="border-t border-border">
      <div className="container-page grid gap-6 py-12 sm:py-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div>
          <p className="type-kicker text-muted-foreground">{kicker}</p>
          <h2 id={`${id}-heading`} className="type-headline mt-2 break-words">
            {title}
          </h2>
        </div>
        <div className="min-w-0 max-w-prose space-y-4 text-[0.9375rem] leading-relaxed sm:text-base">
          {children}
        </div>
      </div>
    </section>
  );
}

/** The two checks set before building, both missed, stated before anything else. */
function ShortVersion() {
  return (
    <section
      aria-labelledby="short-heading"
      className="mt-10 max-w-3xl rounded-lg border-2 border-foreground bg-card p-5 sm:p-6"
    >
      <h2 id="short-heading" className="type-kicker">
        The short version
      </h2>
      <ul className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed sm:text-base">
        <li>
          <strong className="font-semibold">The test we set before building failed.</strong>{" "}
          Taste overlap put {formatPct(taste.topQuarterPct)} of complained-about clashes in the top
          quarter of their day, {backtest.leadOverGenrePoints} points ahead of genre tags. The bar
          was {backtest.bar.topQuarterPct}% and {backtest.bar.leadOverGenrePoints} points ahead.
        </li>
        <li>
          <strong className="font-semibold">Popularity did better.</strong> On the same test,
          popularity, another Qloo field, reached {formatPct(popularity.topQuarterPct)}.
        </li>
        <li>
          <strong className="font-semibold">The check on suggested moves failed too.</strong>{" "}
          Suggestions made with taste overlap differed from popularity-only ones by{" "}
          {moves.measuredPoints} index points; the bar was {moves.barPoints}.
        </li>
      </ul>
    </section>
  );
}

function BacktestTable() {
  return (
    <figure className="my-8">
      <figcaption id="backtest-caption" className="text-sm text-muted-foreground">
        Share of complained-about clashes that rank in the top quarter of their day, and AUC with a{" "}
        {scale.intervalPct}% interval
      </figcaption>
      <div
        role="region"
        aria-labelledby="backtest-caption"
        tabIndex={0}
        className="mt-3 overflow-x-auto rounded-lg border border-border-strong"
      >
        {/* On a phone the interval drops under its AUC and the headings shrink, so all three
            columns fit at 390 px; anything narrower scrolls inside this box, not the page. */}
        <table
          aria-labelledby="backtest-caption"
          className="w-full min-w-[19rem] border-collapse text-left text-sm"
        >
          <thead>
            <tr className="border-b-2 border-foreground align-bottom text-xs sm:text-sm">
              <th scope="col" className="px-3 py-3 font-semibold sm:px-4">
                Method
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold sm:px-4">
                Complained-about clashes in the day&rsquo;s top quartile
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold sm:px-4">
                AUC ({scale.intervalPct}% interval)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {backtest.rows.map((row) => {
              const ours = row.id === "taste";
              return (
                <tr key={row.id} className={ours ? "bg-muted font-semibold" : undefined}>
                  <th
                    scope="row"
                    className={`px-3 py-3 sm:px-4 ${ours ? "font-semibold" : "font-normal"}`}
                  >
                    {row.method}
                  </th>
                  <td className="px-3 py-3 text-right tabular-nums sm:px-4">
                    {formatPct(row.topQuarterPct)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums sm:px-4 sm:whitespace-nowrap">
                    {formatAuc(row.auc)}
                    {row.auc95 ? (
                      <span className="block text-xs font-normal whitespace-nowrap text-muted-foreground sm:inline sm:text-sm">
                        {" "}
                        ({formatInterval(row.auc95)})
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        AUC is the chance that a complained-about clash sits higher in its day&rsquo;s ranking than a
        pair nobody listed; {formatAuc(random.auc)} is a coin toss. Intervals resample whole festival
        days.
      </p>
    </figure>
  );
}

const LABELS: readonly { provenance: Provenance; meaning: string }[] = [
  { provenance: "recorded", meaning: "A saved Qloo response." },
  { provenance: "derived", meaning: "Calculated by this app from saved responses." },
  { provenance: "qloo", meaning: "Returned by Qloo in a live request." },
  { provenance: "llm", meaning: "Written by the language model." },
];

export default function MethodPage() {
  const [overlapLow, overlapHigh] = scale.overlap;
  return (
    <article>
      <header className="container-page pt-14 pb-12 sm:pt-20 sm:pb-16">
        <p className="type-kicker text-muted-foreground">Method</p>
        <h1 className="type-poster mt-4">How we know</h1>
        <p className="mt-6 max-w-2xl text-lg leading-snug font-medium sm:text-xl">
          Clash Control prices set-time clashes with a number it derives from Qloo data. This page
          says what that number is, what we checked it against, and where the check fell short.
        </p>
        <ShortVersion />
      </header>

      <Section id="price" kicker="The number" title="What the price is">
        <p className="font-mono text-base font-medium sm:text-lg">
          Price = taste overlap &times; time shared &times; combined draw.
        </p>
        <p>
          Draw is each act&rsquo;s popularity on Qloo, a percentile among Qloo artists. Taste overlap
          is derived: for each act, Qloo ranks every other act on that day&rsquo;s bill by how
          strongly the act&rsquo;s audience leans toward them; both directions are turned into
          ranks, averaged and scaled {overlapLow} to {overlapHigh}. It says how alike two audiences
          are in taste, relative to that bill. It is not a share of fans and not attendance.
        </p>
        <p>
          The Clash Budget Index is {scale.indexMultiplier} times the day&rsquo;s total price divided
          by the average of {index.baselineSamples} random re-orderings of the same lineup in which
          each set stays inside its allowed window and stages and locked sets stay put. Lower is
          better. It counts taste-overlap cost only.
        </p>
      </Section>

      <Section id="tested" kicker="The test" title="What we tested it against">
        <p>
          We collected clashes that the press or fans publicly complained about at{" "}
          {numberWord(backtest.festivals)} festivals, then looked at where each one ranks among all
          concurrent pairs on its festival day: {backtest.scoredPairs} scored pairs from{" "}
          {backtest.clusters} complaints (one complaint can name more than two acts), across{" "}
          {backtest.festivalDays} festival days. {numberWord(backtest.unscoredPairs, { capitalize: true })} more could not be
          scored because Qloo has no signal for one of the acts.
        </p>
        <BacktestTable />
        <p>
          We set the bar before running the test: taste overlap alone had to put at least{" "}
          {backtest.bar.topQuarterPct}% of those clashes in the top quarter and finish{" "}
          {backtest.bar.leadOverGenrePoints} points ahead of genre tags. It reached{" "}
          {formatPct(taste.topQuarterPct)}, {backtest.leadOverGenrePoints} points ahead.{" "}
          <strong className="font-semibold">It missed the bar.</strong>
        </p>
        <p>
          Popularity is also a Qloo field, and on this test it did better than taste overlap. So the
          test does not show that taste overlap predicts the clashes people complain about, and we
          do not claim it does.
        </p>
        <p>
          What it does show: in this test taste overlap ranked the complained-about clashes above
          genre tags did (AUC {formatAuc(taste.auc)} against {formatAuc(genre.auc)}), though the two
          intervals overlap widely. It is nearly unrelated to popularity (correlation{" "}
          {backtest.popularityCorrelation}), so it is a separate signal, not popularity under another
          name.
        </p>
        <p>
          One festival drives much of the favourable result. At {backtest.glastonbury.label},{" "}
          {backtest.glastonbury.inTopQuarter} of the {backtest.glastonbury.namedClashes} clashes named
          in one {backtest.glastonbury.source} guide ranked in the top quarter of their day (AUC{" "}
          {backtest.glastonbury.auc}; one source, found after the fact, not yet repeated on other
          festivals). Across the {numberWord(backtest.usFestivals)} US festivals together the AUC was{" "}
          {backtest.usFestivalsAuc}.
        </p>
      </Section>

      <Section id="limits" kicker="The limits" title="What taste overlap cannot tell you">
        <ul className="list-disc space-y-3 pl-5 marker:text-muted-foreground">
          <li>It is not attendance, and this app estimates no attendance or money figure anywhere.</li>
          <li>
            Hidden clashes are examples, not detections. Of {backtest.hidden.pairs} pairs with
            top-quarter taste overlap and no shared genre tag, {backtest.hidden.complained} were
            complained about ({formatPct(backtest.hidden.complainedPct)}, against{" "}
            {formatPct(backtest.hidden.basePct)} for all pairs).
          </li>
          <li>
            The Hidden label on the timetable uses a stricter line than this count: taste overlap in
            the day&rsquo;s top tenth, with no shared genre tag, where the count above uses the top
            quarter.
          </li>
          <li>
            Qloo has a usable signal for {coverage.usableActs} of {coverage.totalActs} acts across the{" "}
            {numberWord(backtest.festivals)} festivals tested ({formatWholePct(coverage.usablePct)}).
            On the two days shown it is{" "}
            {coverage.days
              .map((day) => `${day.scored} of ${day.total} sets (${formatWholePct(day.pct)})`)
              .join(" and ")}
            . Where there is none, the app leaves the clash unpriced and says so.
          </li>
          <li>
            The Clash Budget Index compares a timetable with random re-orderings of itself. It is a
            reading of one kind of cost, not a verdict on a festival; real programming weighs much
            more than taste overlap.
          </li>
        </ul>
      </Section>

      <Section id="moving-sets" kicker="Suggestions" title="Moving sets">
        <p>
          The app can test a move against your rules and price it, and the agent can suggest moves.
          Before building this we set a check: suggestions made with taste overlap had to differ from
          suggestions made with popularity alone by {moves.barPoints} index points on the Glastonbury
          Sunday, graded on the same matrix. They differed by {moves.measuredPoints}, with{" "}
          {moves.movesDiffer} of {moves.movesCompared} moves different, so{" "}
          <strong className="font-semibold">the check failed as written.</strong> Suggested moves
          are graded by the same measure used to find them, so a better score is expected, not
          proof, and the app does not claim that any suggestion is the best one.
        </p>
      </Section>

      <Section id="labels" kicker="Provenance" title="Where each number comes from">
        <p>Every value carries a label.</p>
        <dl className="space-y-3">
          {LABELS.map(({ provenance, meaning }) => (
            <div key={provenance} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <dt>
                <ProvenanceChip provenance={provenance} size="sm" />
              </dt>
              <dd className="min-w-0 flex-1">{meaning}</dd>
            </div>
          ))}
        </dl>
        <p>
          The festival days shown were built from saved Qloo responses; the festivals themselves do
          not use Clash Control.
        </p>
      </Section>

      <Section id="live-check" kicker="On request" title="The live re-check">
        <p>
          Every priced clash can be re-checked with Qloo on request when live checks are switched
          on. The check re-sends the two audience-ranking requests saved for the pair&rsquo;s acts
          and asks Qloo for a fresh comparison, {liveCheck.requests} requests in all, then works out
          the pair&rsquo;s taste overlap and tags again from the answers and shows them beside the
          saved result with Qloo&rsquo;s request ids. It never replaces a number on the page:
          Qloo&rsquo;s answers can change over time, and the saved values keep every figure
          comparable. It is limited per visitor and per day, and it pauses when this demo&rsquo;s
          monthly Qloo allowance runs low. While live checks are switched off, the drawer shows only
          the saved results.
        </p>
      </Section>

      <div className="border-t border-border">
        <div className="container-page py-12 sm:py-16">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-sm py-2 text-base font-semibold underline-offset-4 hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to the timetable
          </Link>
        </div>
      </div>
    </article>
  );
}
