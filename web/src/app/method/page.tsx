import { Fragment, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { MoreDetails } from "@/components/clash/more-details";
import { BacktestBars, FIGURE_DOMAIN, along } from "@/components/clash/why-this-matters";
import { ProvenanceChip } from "@/components/kernel/provenance-chip";
import { BySyntheticDay } from "@/components/site/synthetic-context";
import { artSlot } from "@/lib/art";
import { CONTROL_ACTS, CONTROL_RANK_LIMIT } from "@/lib/control-acts";
import { BUILT_FROM_REAL, BUILT_FROM_SYNTHETIC, COUNTS_ONLY_NEUTRAL, formulaNote } from "@/lib/credit";
import { DO_NOT_USE } from "@/lib/demand";
import type { Provenance } from "@/lib/events";
import {
  METHOD_FIGURES,
  formatAuc,
  formatCount,
  exploratoryReading,
  formatDiff,
  formatDiffInterval,
  formatInterval,
  countsNote,
  disagreementSentence,
  tasteInPriceReading,
  formatP,
  formatPct,
  formatWholePct,
  formatWithin,
  methodRow,
  numberWord,
} from "@/lib/method-figures";
import { PUBLIC_SOURCES } from "@/lib/public-sources";
import { cn } from "@/lib/utils";

import { ContentsRail } from "./contents-rail";

export const metadata = {
  title: "How we know",
  description:
    "What Clash Control's taste overlap is, what we tested it against, and where it fell short.",
} satisfies Metadata;

const { backtest, complaints, coverage, exploratory, index, liveCheck, moves, price, scale, symmetry, tasteInPrice } =
  METHOD_FIGURES;
const reading = exploratoryReading();
const taste = methodRow("taste");
const genre = methodRow("genre");
const popularity = methodRow("popularity");
const [tasteLow, tasteHigh] = taste.auc95 ?? [taste.auc, taste.auc];

/**
 * Printed, /method leaves out the site header and footer (the brief and /check do the same); the light print
 * palette for every page is in globals.css.
 */
const PRINT_CSS = `
@media print {
  body > header, body > footer { display: none !important; }
}
`;
/** Image slot 2, a decorative band above the heading; nothing renders until its files are in place. */
const headerArt = artSlot("method");

/**
 * The page's reading column below 1280px: header, short version and every section share it. It starts at the
 * page container's left edge, the same x as the site header and footer, rather than centring. From 1280px the
 * column gives way to the page's hanging heads (HANGING), so it caps nothing there.
 */
const COLUMN = "max-w-[52rem] xl:max-w-none";
/**
 * Hanging heads from 1280px: a 12-column grid with the container's 48px gutter, each heading in columns 1 to 4
 * and its body in 5 to 12, tops level. Static: no heading stays in view as the page scrolls. Printed as one column (print:block).
 */
const HANGING = "xl:grid xl:grid-cols-12 xl:items-start xl:gap-x-12 print:block";
/** The heading's cell: columns 1 to 4. */
const HEAD_CELL = "xl:col-span-4";
/** The body's cell: columns 5 to 12. */
const BODY_CELL = "min-w-0 xl:col-span-8 xl:col-start-5";
/** Line spacing for running text: tighter than the site's relaxed default, still open enough to read. */
const LEADING = "leading-[1.55]";
/**
 * The body of a section or sub-block: its font, leading and spacing. Below 1280px the whole body sits at the
 * 76-character measure, as before; from 1280px the wrapper is the full body column, so a figure in it can use
 * that width, and the measure moves onto the running text itself (MEASURE).
 */
const PROSE_BODY = `min-w-0 max-w-[76ch] space-y-3 text-[0.9375rem] ${LEADING} sm:text-base xl:max-w-none`;
/**
 * The 76-character measure on the running text from 1280px: every paragraph, list, definition list and
 * disclosure directly in a body. Figures are none of these, so they take the full body column.
 */
const MEASURE =
  "xl:[&>p]:max-w-[76ch] xl:[&>ul]:max-w-[76ch] xl:[&>ol]:max-w-[76ch] xl:[&>dl]:max-w-[76ch] xl:[&>details]:max-w-[76ch] xl:[&>aside]:max-w-[76ch]";
/** A figure's caption at the running text's measure from 1280px, while the figure itself spans the body column. */
const CAPTION_MEASURE = "xl:max-w-[76ch]";

/**
 * A section of the page: its heading, then its text. Below 1280px both sit in the reading column; from 1280px the
 * heading hangs in columns 1 to 4 and the text, and the footer under it, take columns 5 to 12.
 *
 * `rail`, where given, is the section's own figure in the heading's columns, 32px under the heading, from 1280px
 * only, placed the way the short version places its verdict: two rows, the heading's own height and then the rest,
 * which the body spans, so the body's top stays level with the heading's. Static (it scrolls with the page), never printed (the body keeps
 * the printed copy). A section without one renders exactly as before.
 */
function Section({
  id,
  title,
  footer,
  rail,
  children,
}: {
  id: string;
  title: ReactNode;
  /** Drawn after the text, outside its spacing (the page's back link). */
  footer?: ReactNode;
  /** The section's own figure under its heading, from 1280px (the body hides its copy there). */
  rail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-16">
      {/* Sections are set apart by space alone, with no rule: 40/48 px above and below, so 80 to 96 px between
          two headings on one reading page. */}
      <div className="container-page">
        <div className={`${COLUMN} py-10 sm:py-12 ${HANGING}${rail ? " xl:grid-rows-[auto_1fr]" : ""}`}>
          <h2 id={`${id}-heading`} className={`type-title break-words ${HEAD_CELL}`}>
            {title}
          </h2>
          {rail ? (
            <div
              data-section-rail
              className="mt-8 hidden xl:block xl:col-span-4 xl:col-start-1 xl:row-start-2 print:hidden"
            >
              {rail}
            </div>
          ) : null}
          <div
            className={`mt-3 xl:mt-0 print:mt-3 ${BODY_CELL} ${PROSE_BODY} ${MEASURE}${rail ? " xl:row-span-2 xl:row-start-1" : ""}`}
          >
            {children}
          </div>
          {footer ? <div className={`mt-6 ${BODY_CELL}${rail ? " xl:row-start-3" : ""}`}>{footer}</div> : null}
        </div>
      </div>
    </section>
  );
}

/**
 * One part of "How the rest works": its own id (other pages link to some of them), a small heading, its text,
 * all inside the section's body column. The first sits right under the section's top; the others are set off by
 * space, with no rule.
 */
function SubBlock({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 pt-8 first:pt-0">
      <h3 id={`${id}-heading`} className="text-lg leading-snug font-semibold break-words">
        {title}
      </h3>
      <div className={`mt-2 ${PROSE_BODY} ${MEASURE}`}>{children}</div>
    </div>
  );
}

/**
 * The first finding as a picture: each method's share of complained-about clashes in the day's highest
 * 25%, on the one 0 to FIGURE_DOMAIN axis ruled only at 0, each value beside its own bar, and the bar we wrote
 * down before building as a 1.5px solid ink rule labelled at its top. Taste overlap and popularity are the same ink
 * bar, so taste overlap stopping short of the rule while popularity runs further is read from length alone; genre
 * tags and random are thin muted baselines. The chart is set at the prose's measure in the prose's own font size
 * (so 76ch resolves in the same metrics), and its last axis number ends at the prose's right edge. The sentences
 * that say so follow the figure directly. Drawn final.
 */
function MethodsDiagram() {
  const bar = backtest.bar.topQuarterPct;
  return (
    <figure className="mt-4 xl:mt-0 print:mt-4">
      <figcaption className="text-[0.8125rem] leading-5 text-muted-foreground">
        Complained-about clashes in the day&rsquo;s highest {scale.topQuarterPct}%, by method
      </figcaption>
      <div className="mt-3 min-w-0 max-w-[76ch] text-[0.9375rem] sm:text-base">
        <BacktestBars
          threshold={bar}
          describe={(id, label, reached) =>
            id === "taste"
              ? `Taste overlap reached ${formatPct(reached)}; the bar was ${bar}%`
              : `${label} reached ${formatPct(reached)}`
          }
        />
      </div>
    </figure>
  );
}

/** A link in running text: ink, with a 1px border-strong underline 4px off the text that turns ink on hover. */
const TEXT_LINK = "underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground";

/** A row of the short version after its lead: plain sentences, spaced, with no rule between paragraphs. */
const SHORT_ROW = "pt-3";

/**
 * A miss, drawn at the rail figure's width, at most 20rem, on a 0 to `domain` scale mapped through the chart's own
 * `along`, so a domain of FIGURE_DOMAIN is exactly the chart's scale: the reached `value` as an 8px ink bar ending
 * exactly at it (the 6px bar corner, clamped to half its height, rounds both ends), the `bar` set before building as
 * the chart's own 1.5px solid ink rule, rising 6px above and below the bar, and a 1px border-strong tick at 0, 8px
 * tall, so the scale's start reads. The bar starts 2px clear of the tick (its round start would otherwise cover it);
 * only its end carries the value. The paper between the bar's end and the rule is the miss: no fill, colour or
 * bracket in it, and no raspberry (the miss is not shared time). No labels: the lines around it carry the numbers. `space` is its top margin in the rail's rhythm.
 */
function VerdictMeter({ value, bar, domain, space }: { value: number; bar: number; domain: number; space: string }) {
  const at = (point: number) => along((point / domain) * FIGURE_DOMAIN);
  return (
    <div data-verdict-meter className={`relative ${space} h-5 max-w-[20rem]`}>
      <span data-meter-start className="absolute top-1.5 left-0 h-2 w-px bg-border-strong" />
      <span
        data-meter-reach
        className="absolute top-1.5 left-[3px] h-2 rounded-bar bg-foreground"
        style={{ width: `calc(${at(value)} - 3px)` }}
      />
      <span
        data-meter-bar
        className="absolute inset-y-0 w-0 -translate-x-1/2 border-l-[1.5px] border-solid border-foreground"
        style={{ left: at(bar) }}
      />
    </div>
  );
}

/**
 * The scale of the rail's two other meters, per unit of their bar: each runs from 0 to its bar times this, so its bar
 * rule sits where the first meter's does (the chart's bar over the chart's domain). Their units differ (points,
 * index points), so the rail says each line has its own scale.
 */
const RAIL_SCALE = FIGURE_DOMAIN / backtest.bar.topQuarterPct;

/**
 * The verdict in the short version's rail, from 1280px only: the three bars we set before building and how each was
 * missed. First, what the number measures (the chart caption's own words up to its comma), the chart's own row label,
 * taste overlap's share as one display numeral, the miss as a meter on the chart's own scale (VerdictMeter), the
 * chart's bar label and the page's own "It missed the bar.". Then the two other pre-set checks the body states in
 * prose, the lead over genre tags and the suggested moves against popularity-only, each as a 13px label, its value
 * and its bar, and a meter on its own scale whose bar rule sits at the first one's x; then one muted line saying
 * so. All in ink but that line, every number from the figures module. It repeats lines that stay visible beside it
 * (the caption, the chart, the failed test, the paragraph on popularity and the moves), so it is for the eye only:
 * aria-hidden, never printed, static (it scrolls with the page), and no box or raspberry.
 */
function ShortVerdict() {
  return (
    <div
      aria-hidden="true"
      data-short-verdict
      className="mt-8 hidden xl:block text-foreground xl:col-span-4 xl:col-start-1 xl:row-start-2 print:hidden"
    >
      <p className="max-w-[20rem] text-[0.8125rem] leading-5">
        Complained-about clashes in the day&rsquo;s highest {scale.topQuarterPct}%
      </p>
      <p className="mt-3 text-[0.8125rem] leading-5 font-semibold">Taste overlap</p>
      <p className="type-numeral mt-1 text-[3.5rem] leading-none tabular-nums">{formatPct(taste.topQuarterPct)}</p>
      <VerdictMeter value={taste.topQuarterPct} bar={backtest.bar.topQuarterPct} domain={FIGURE_DOMAIN} space="mt-3" />
      <p className="mt-2 text-[0.8125rem] leading-5">
        Bar we set: <span className="font-mono tabular-nums">{backtest.bar.topQuarterPct}%</span>
      </p>
      <p className="mt-1 text-[0.9375rem] leading-snug font-semibold">It missed the bar.</p>
      <p className="mt-6 text-[0.8125rem] leading-5 font-semibold">Lead over genre tags</p>
      <p className="mt-0.5 text-[0.8125rem] leading-5">
        <span className="font-mono tabular-nums">{backtest.leadOverGenrePoints}</span> points · bar{" "}
        <span className="font-mono tabular-nums">{backtest.bar.leadOverGenrePoints}</span>
      </p>
      <VerdictMeter
        value={backtest.leadOverGenrePoints}
        bar={backtest.bar.leadOverGenrePoints}
        domain={backtest.bar.leadOverGenrePoints * RAIL_SCALE}
        space="mt-1"
      />
      <p className="mt-5 text-[0.8125rem] leading-5 font-semibold">Suggested moves against popularity-only</p>
      <p className="mt-0.5 text-[0.8125rem] leading-5">
        <span className="font-mono tabular-nums">{moves.measuredPoints}</span> index points · bar{" "}
        <span className="font-mono tabular-nums">{moves.barPoints}</span>
      </p>
      <VerdictMeter value={moves.measuredPoints} bar={moves.barPoints} domain={moves.barPoints * RAIL_SCALE} space="mt-1" />
      <p className="mt-3 max-w-[20rem] text-[0.8125rem] leading-5 text-muted-foreground">
        Each line has its own scale, set by its own bar.
      </p>
    </div>
  );
}

/**
 * The short version, the page's first hanging block: from 1280px its heading sits in columns 1 to 4 and the chart,
 * the failed test and the paragraphs after it in 5 to 12 (a subgrid of the header's grid, so its columns are the
 * sections' columns), in that order, so the failed test still follows its chart directly. Its heading is set as the
 * sections' are; under it, in the same columns and from 1280px only, the verdict (ShortVerdict). Two rows: the
 * heading's own height, then the rest, which the body spans, so the verdict sits right under the heading.
 */
function ShortVersion() {
  return (
    <section
      aria-labelledby="short-heading"
      className="mt-12 xl:col-span-12 xl:grid xl:grid-cols-subgrid xl:grid-rows-[auto_1fr] xl:items-start print:block"
    >
      <h2 id="short-heading" className={`type-title break-words ${HEAD_CELL}`}>
        The short version
      </h2>
      <div className={`${BODY_CELL} xl:row-span-2 xl:row-start-1`}>
        <MethodsDiagram />
        <ul className={`mt-5 max-w-[76ch] text-[0.9375rem] ${LEADING} sm:text-base`}>
          {/* The failed test, said once on the page with its numbers (round 33): every later mention on the page
              points back here or sits in the test's own section. */}
          <li className="pb-4 text-base font-medium sm:text-lg sm:leading-[1.5]">
            <strong className="font-semibold">The test we set before building failed.</strong>{" "}
            Taste overlap put {formatPct(taste.topQuarterPct)} of complained-about clashes in the{" "}
            {scale.topQuarterPct}% highest-ranked clashes among that day&rsquo;s pairs,{" "}
            {backtest.leadOverGenrePoints} points ahead of genre tags. The bar we wrote down before
            building was {backtest.bar.topQuarterPct}% and {backtest.bar.leadOverGenrePoints} points
            ahead. It missed the bar. Popularity did better: another Qloo field, it reached{" "}
            {formatPct(popularity.topQuarterPct)}. The check on suggested moves missed its bar too
            ({moves.measuredPoints} index points against {moves.barPoints}).{" "}
            <a href="#tested" className={TEXT_LINK}>
              See the full comparison below
            </a>
            .
          </li>
          {/* What the same test did show is said once, in its own section ("What it does show"), with its figures. */}
          <li className={SHORT_ROW}>
            It ranks a day&rsquo;s clashes and tests moves against timetable rules. Taste overlap is a
            rank, not attendance.
          </li>
        </ul>
      </div>
      <ShortVerdict />
    </section>
  );
}

function BacktestTable() {
  return (
    <figure className="my-6">
      <figcaption id="backtest-caption" className={`text-sm text-muted-foreground ${CAPTION_MEASURE}`}>
        Share of complained-about clashes that rank in the top quarter of their day, and AUC (
        {scale.auc.chance} means no better than chance; {scale.auc.perfect} means every listed clash
        ranks above every unlisted pair) with a {scale.intervalPct}% interval
      </figcaption>
      <div
        role="region"
        aria-labelledby="backtest-caption"
        tabIndex={0}
        className="mt-3 overflow-x-auto rounded-lg border border-surface-edge px-4"
      >
        {/* On a phone the interval drops under its AUC and the headings shrink, so all three
            columns fit at 390 px; anything narrower scrolls inside this box, not the page. The frame's 16px
            padding insets the header rule and the row separators 16px from its edges. */}
        <table
          aria-labelledby="backtest-caption"
          className="w-full min-w-[19rem] border-collapse text-left text-sm"
        >
          <thead>
            <tr className="border-b border-border align-bottom text-xs sm:text-sm">
              <th scope="col" className="py-3 pr-3 font-semibold sm:pr-4">
                Method
              </th>
              <th scope="col" className="px-3 py-3 text-right font-semibold sm:px-4">
                Complained-about clashes in the day&rsquo;s top quarter
              </th>
              <th scope="col" className="py-3 pl-3 text-right font-semibold sm:pl-4">
                AUC ({scale.intervalPct}% interval)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {backtest.rows.map((row) => {
              const ours = row.id === "taste";
              return (
                <tr key={row.id} className={ours ? "font-semibold" : undefined}>
                  <th
                    scope="row"
                    className={`py-3 pr-3 sm:pr-4 ${ours ? "font-semibold" : "font-normal"}`}
                  >
                    {row.method}
                  </th>
                  <td className="px-3 py-3 text-right tabular-nums sm:px-4">
                    {formatPct(row.topQuarterPct)}
                  </td>
                  <td className="py-3 pl-3 text-right tabular-nums sm:pl-4 sm:whitespace-nowrap">
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
      <p className="mt-3 text-sm text-muted-foreground">Intervals resample whole festival days.</p>
    </figure>
  );
}

/** A parameter's value: prose, with the token itself (a URN, a number) in mono. */
type Param = { name: string; value: ReactNode };
const Token = ({ children }: { children: ReactNode }) => <code className="font-mono text-[0.8125rem]">{children}</code>;

/**
 * One card per Qloo endpoint the backend calls. Every line is read off backend/app/qloo/client.py (the
 * three paths), overlap.py (the build's parameters), pair.py, gridprice.py and agent/qloo_tools.py; a test
 * checks each path against the client's source. No response data appears here. Every row was saved when the day
 * was built (said once, in the caption), so `live` is only the part that differs: where it is also sent live.
 */
const QLOO_CALLS: readonly {
  path: string;
  purpose: string;
  plain: string;
  params: readonly Param[];
  returns: string;
  live: string;
}[] = [
  {
    path: "/search",
    purpose: "Match an act",
    plain: "To match an act, we ask Qloo for the artist by name.",
    params: [
      { name: "query", value: "The act's name." },
      { name: "types", value: <Token>urn:entity:artist</Token> },
      { name: "take", value: <Token>3</Token> },
    ],
    returns: "Candidate entities. We keep the one whose name matches and use its id as the act's identity.",
    live: "Sent live only by the pasted-grid score in live mode and the agent's tools, where switched on.",
  },
  {
    path: "/v2/insights",
    purpose: "Rank affinity",
    plain: "To rank affinity, we give Qloo one act and ask how strongly its audience leans toward the rest of the day's bill.",
    params: [
      { name: "filter.type", value: <Token>urn:entity:artist</Token> },
      { name: "signal.interests.entities", value: "One act." },
      { name: "filter.results.entities", value: "The day's other acts, up to 50 per request, with take set to match." },
      {
        name: "signal.location.query",
        value: "Not sent: both saved days were ranked without a location, so their taste overlap is a global reading, not a local one.",
      },
    ],
    returns: "How strongly the signal act's audience leans toward each listed act. Ranked within the day, this becomes taste overlap.",
    live: "Sent live by the pair re-check (two of its three requests), the pasted-grid score in live mode and the agent's tools, where switched on.",
  },
  {
    path: "/v2/analysis/compare",
    purpose: "Shared tags",
    plain: "To find shared tags, we give Qloo two acts and ask what their audiences have in common.",
    params: [
      { name: "a.signal.interests.entities", value: "One act." },
      { name: "b.signal.interests.entities", value: "The other act." },
      { name: "take", value: <Token>50</Token> },
    ],
    returns: "The tags the two audiences share. We keep genre, subgenre and theme tags, highest score first.",
    live: "Sent live by the pair re-check (its third request) and by the agent when it explains a clash, where switched on.",
  },
];

/**
 * The route from a timetable to the index, as four typed tokens: what passes from one step to the next. The two
 * Qloo returns (`qloo`) are teal, since Qloo /search and /v2/insights return them; the first and the last are ink,
 * the last, this app's index, semibold. Under each token, the step's existing label and sub-label (the endpoint).
 */
const FLOW: readonly { token: string; name: string; path?: string; qloo?: boolean }[] = [
  { token: "act names", name: "Your timetable" },
  { token: "entity IDs", name: "Qloo", path: "/search", qloo: true },
  { token: "overlap ranks", name: "Qloo", path: "/v2/insights", qloo: true },
  { token: "index (this app)", name: "Clash Budget Index" },
];

/**
 * The arrow's stroke: a 1.5px ink line with round caps and joins, so the four tokens read as one pipeline (ink on
 * paper 16.09 / 16.75). Never raspberry: the flow is not shared time.
 */
const ARROW = { stroke: "var(--foreground)", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;

/**
 * The arrow on to the next token, as inline SVG, from 768px: it runs across, at least 40px long, filling the gap to
 * the next column; the line stops 0.75px short of the head's tip so its round cap ends there.
 */
function FlowArrow() {
  return (
      <svg aria-hidden="true" data-flow-arrow="across" focusable="false" height={10} className="hidden min-w-10 flex-1 overflow-visible md:block">
        <line x1={2.25} y1={5} x2="100%" y2={5} transform="translate(-1.5 0)" {...ARROW} />
        <svg x="100%" y={0} overflow="visible">
          <path d="M-5 1.25 L-0.75 5 L-5 8.75" {...ARROW} />
        </svg>
      </svg>
  );
}

/**
 * On a phone, and in a stacked flow at any width, the same arrow points down under the step: 40px long on a phone;
 * 24px in the stacked form, 8px clear of the step above and of the next token (the list's row gap), so the four steps
 * read as one column. The head keeps the across arrow's size, its tip where the line ends.
 */
function FlowArrowDown({ stacked = false }: { stacked?: boolean }) {
  const length = stacked ? 24 : 40;
  const tip = length - 1.5;
  return (
      <svg
        aria-hidden="true"
        data-flow-arrow="down"
        focusable="false"
        width={10}
        height={length}
        className={stacked ? "mt-2 block overflow-visible" : "mt-2 block overflow-visible md:hidden"}
      >
        <line x1={5} y1={0.75} x2={5} y2={tip} {...ARROW} />
        <path d={`M1.25 ${tip - 4.25} L5 ${tip} L8.75 ${tip - 4.25}`} {...ARROW} />
      </svg>
  );
}

/**
 * Request to result, before the endpoint details: the four tokens in 14px mono joined by arrows, across from 768px
 * and down on a phone. No dots, nodes, boxes or raspberry. Under each token its label in 13px ink and its endpoint,
 * where it has one, in 13px muted mono. `stacked` keeps the phone's downward form at every width, with no outer
 * margin of its own: the form that hangs under "How the rest works" from 1280px.
 */
function RequestFlow({ stacked = false }: { stacked?: boolean }) {
  return (
    <ol
      aria-label="From your timetable to the index"
      className={stacked ? "grid gap-y-2" : "my-6 grid gap-y-2 md:grid-cols-4 md:gap-y-0"}
    >
      {FLOW.map((step, i) => {
        const last = i === FLOW.length - 1;
        return (
          <li key={step.token} data-flow-node className={stacked ? "min-w-0" : "min-w-0 md:pr-3"}>
            <div className="flex items-center gap-3">
              <code
                data-flow-token
                className={cn(
                  "font-mono text-sm leading-5 whitespace-nowrap",
                  step.qloo ? "text-prov-qloo" : "text-foreground",
                  last && "font-semibold",
                )}
              >
                {step.token}
              </code>
              {last || stacked ? null : <FlowArrow />}
            </div>
            <p className="mt-1.5 text-[0.8125rem] leading-snug text-foreground">{step.name}</p>
            {step.path ? (
              <code className="block font-mono text-[0.8125rem] leading-snug text-muted-foreground">{step.path}</code>
            ) : null}
            {last ? null : <FlowArrowDown stacked={stacked} />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A dotted parameter name (`signal.interests.entities`) with a word-break opportunity after each dot, so a narrow
 * column breaks it only there and never inside a word.
 */
function DottedKey({ name }: { name: string }) {
  const parts = name.split(".");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={`${part}-${i}`}>
          {part}
          {i < parts.length - 1 ? (
            <>
              .<wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

/**
 * "We send" as a group, and one parameter row of it. The switch follows the endpoint's own width, never the
 * viewport: each endpoint is a size container, and once it is 24rem wide (an 11rem key, a 1rem gap and at least
 * 12rem of meaning) each row is two columns, the key at the left and its meaning beside it on the same first line
 * (baselines level, so a key or meaning that wraps runs down from the top), 8px between rows, with one 1px hairline
 * above the group and one below it and none between rows. Narrower, the rows stack key over meaning as before, each
 * closed by its own hairline, so a key never reads as the meaning of the row above.
 */
const PARAM_LIST =
  "mt-1 border-t border-border @min-[24rem]:grid @min-[24rem]:gap-y-2 @min-[24rem]:border-b @min-[24rem]:py-2.5";
const PARAM_ROW =
  "border-b border-border py-2.5 @min-[24rem]:grid @min-[24rem]:grid-cols-[11rem_minmax(0,1fr)] @min-[24rem]:items-baseline @min-[24rem]:gap-x-4 @min-[24rem]:border-b-0 @min-[24rem]:py-0";

/**
 * Each Qloo endpoint straight on the page, with no box, in two columns from 1024px. Each: the path in 17px teal
 * semibold mono (it is Qloo's; teal on /method at all times), its purpose, one plain sentence, then what we send as
 * one hairline-ruled group (PARAM_LIST and PARAM_ROW: the parameter in 13px ink mono, breaking only after a dot, and
 * what it means at 15px, side by side where the endpoint is 24rem wide, key over meaning where it is narrower), what
 * we get back, and, as a muted last row, where it is also sent live. Parameter names are case-sensitive, so they keep
 * their case.
 */
function QlooCalls() {
  return (
    <figure className="my-2">
      <figcaption id="qloo-calls-caption" className={`text-sm text-muted-foreground ${CAPTION_MEASURE}`}>
        The three Qloo endpoints this product calls, what is sent, and how the answer is used. Each was saved when
        the day was built; each card says where it is also sent live. It lists the requests only.
      </figcaption>
      {/* Below 1280px, and in print at every width, the flow sits here; from 1280px on screen it hangs under the
          section's heading instead (Section's rail), so one copy is displayed at each width. The outer wrapper keeps
          the flow's 24px between the caption and the endpoints once the flow, and its margin, are not displayed. */}
      <div className="xl:pt-6 print:pt-0">
        <div data-flow-place="body" className="xl:hidden print:block">
          <RequestFlow />
        </div>
      </div>
      <ul aria-labelledby="qloo-calls-caption" className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
        {QLOO_CALLS.map((call) => (
          <li key={call.path} data-endpoint className="@container min-w-0">
            <h4 className="font-mono text-[1.0625rem] leading-snug font-semibold text-prov-qloo">{call.path}</h4>
            <p className="mt-1 text-[0.9375rem] font-semibold">{call.purpose}</p>
            <p className="mt-2 text-sm leading-snug">{call.plain}</p>
            <p className="mt-4 text-[0.8125rem] font-semibold">We send</p>
            <dl aria-label="What we send" className={PARAM_LIST}>
              {call.params.map(({ name, value }) => (
                <div key={name} data-param className={PARAM_ROW}>
                  <dt className="min-w-0 font-mono text-[0.8125rem] leading-snug text-foreground">
                    <DottedKey name={name} />
                  </dt>
                  <dd className="mt-1 min-w-0 text-[0.9375rem] leading-snug @min-[24rem]:mt-0">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[0.8125rem] font-semibold">We get back</p>
            <p className="mt-1 border-b border-border pb-2 text-sm leading-snug">{call.returns}</p>
            <p className="pt-2 text-[0.8125rem] leading-snug text-muted-foreground">
              <span className="sr-only">Sent live: </span>
              {call.live}
            </p>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * The exploratory result that followed the failed pre-set test, which it names as the test stated above (round 33:
 * the failed test is stated once, in the short version). Closed until opened; the line above it on the page says
 * what it did not establish.
 */
function Exploratory() {
  return (
    <aside aria-labelledby="exploratory-heading">
      <MoreDetails
        summary={
          <h3 id="exploratory-heading" className="inline">
            Exploratory follow-up, run after the test failed
          </h3>
        }
      >
        <div className="space-y-3 pb-4">
          <p>
            Run after the failed test above, on the same saved pairs, so it is exploratory.
          </p>
          <p>
            <strong className="font-semibold">What held,</strong> on this press-skewed complaint set: taste
            overlap separated the complained-about clashes from the day&rsquo;s other pairs (AUC{" "}
            {formatAuc(taste.auc)}, interval {formatInterval([tasteLow, tasteHigh])}). Press lists lean
            toward headliners, so the set is not a fair sample of every clash. To see how easily a score
            like that could arise by chance, we dealt the complaint labels out again at random among each
            festival day&rsquo;s pairs, keeping each day&rsquo;s number of complaints, {formatCount(exploratory.shuffles)}{" "}
            times. {numberWord(exploratory.shufflesAtLeast, { capitalize: true })} of the{" "}
            {formatCount(exploratory.shuffles)} shuffles scored that high or higher (p&nbsp;=&nbsp;
            {formatP(exploratory.p)}).
            {reading.pAboveBar
              ? ` That p is above ${exploratory.pBar}: shuffled labels often score this high, so this check does not separate the measure from chance.`
              : ""}{" "}
            The shuffle treats pairs as independent, but the {backtest.scoredPairs} pairs come from{" "}
            {backtest.clusters} complaints, so the real uncertainty is wider than that p suggests. {countsNote()}
          </p>
          <p>
            <strong className="font-semibold">What did not:</strong> popularity, also a Qloo field, scores
            higher ({formatAuc(popularity.auc)}). The gap between the two is {formatAuc(exploratory.gap)} in AUC
            (interval {formatInterval(exploratory.gapInterval)}); the interval{" "}
            {reading.gapIncludesZero
              ? "includes zero, so these data do not say which of the two ranks complained-about clashes higher"
              : "excludes zero"}
            .
          </p>
        </div>
      </MoreDetails>
    </aside>
  );
}

/** The anchor of the taste-inside-the-price block, for links that point at it. */
const TASTE_IN_PRICE_ID = "taste-in-price";

/** Said when the interval of the full price minus the taste-removed price holds zero. */
const TASTE_ADDS_NOT_ESTABLISHED = "This check did not establish that taste adds to time and draw.";

/**
 * Taste inside the full price, the second exploratory follow-up, in the open under its own heading: the full price
 * against popularity, against the same price with taste overlap held the same for every pair (time and draw only),
 * and against shuffled taste values; then the same by festival, Glastonbury against the four US festivals; then
 * (round 33) what that split may mean for use, labelled a hypothesis, where taste overlap and popularity disagree,
 * what a location would cost, and a replication test that has not been run. Every
 * figure is read from `METHOD_FIGURES.tasteInPrice`, and what each interval says is read from the figures
 * (`tasteInPriceReading`), so the words can never contradict the numbers. The heading is neutral: it names what was
 * checked, not a gain. A ruled table like the backtest's, on paper; no colour carries a value.
 */
function TasteInPrice() {
  const { fullPrice, popularity: pop, pairedVsPopularity, shuffled, tasteRemoved, pairedVsTasteRemoved } =
    tasteInPrice;
  const said = tasteInPriceReading();
  return (
    <div id={TASTE_IN_PRICE_ID} aria-labelledby={`${TASTE_IN_PRICE_ID}-heading`} role="group" className="scroll-mt-24 pt-4">
      <h3 id={`${TASTE_IN_PRICE_ID}-heading`} className="text-lg leading-snug font-semibold break-words">
        Taste inside the full price (exploratory)
      </h3>
      {/* Its paragraphs keep the running text's measure from 1280px, as a section body's do; the table spans the column. */}
      <div className="mt-2 space-y-3 xl:[&>p]:max-w-[76ch]">
        <p>
          Run after the failed test above, on the same {backtest.scoredPairs} complained-about pairs, so it is exploratory. The
          full price (the index&rsquo;s pair score: taste overlap &times; shared time &times; Qloo popularity) scored
          AUC {formatAuc(fullPrice.auc)} (interval {formatInterval(fullPrice.auc95)}); popularity alone scored{" "}
          {formatAuc(pop)}. The difference is {formatDiff(pairedVsPopularity.diff)} (interval{" "}
          {formatDiffInterval(pairedVsPopularity.interval)}), so the full price did not establish an advantage over
          popularity.
        </p>
        <p>
          With taste taken out, every pair given the same taste overlap so that only shared time and draw are left,
          the same score reached {formatAuc(tasteRemoved.auc)} (interval {formatInterval(tasteRemoved.auc95)}). The
          full price minus that is {formatDiff(pairedVsTasteRemoved.diff)} (interval{" "}
          {formatDiffInterval(pairedVsTasteRemoved.interval)}).{" "}
          {said.tasteAddsIncludesZero ? <strong className="font-semibold">{TASTE_ADDS_NOT_ESTABLISHED}</strong> : null}{" "}
          With the taste values shuffled among each day&rsquo;s pairs, {formatCount(shuffled.shuffles)} times, the full
          price fell to {formatAuc(shuffled.mean)} on average ({scale.intervalPct}% of shuffles between{" "}
          {formatAuc(shuffled.range95[0])} and {formatAuc(shuffled.range95[1])}). So the full price depends on the
          real taste values, which is not the same as taste adding to time and draw.
        </p>
        <TasteByFestival />
        <ScopedReading />
        <p>{disagreementSentence()}</p>
        <p>
          Location is untested: these rankings were made without a location, and asking again for the US festival
          days with each festival&rsquo;s city would cost {formatCount(tasteInPrice.locationRequests)} Qloo requests.
        </p>
        <ReplicationTest />
      </div>
    </div>
  );
}

/**
 * What the split by festival may mean for use, under the per-festival table (round 33): each sample's result with its
 * sign and interval, its size and its source inline, then a hypothesis labelled as one, with the confound that the
 * two samples differ in more than act size. Every figure from `METHOD_FIGURES`; whether the US interval holds zero is
 * read from the figures.
 */
function ScopedReading() {
  const [glasto, us] = tasteInPrice.festivals;
  const { glastonburyTasteAdds: up, usTasteAdds: down } = tasteInPrice;
  const usHoldsZero = down.interval[0] <= 0 && 0 <= down.interval[1];
  return (
    <>
      <p>
        On the {glasto.label} complaints ({glasto.complaintPairs} complaint pairs in {glasto.complaints} clusters, all
        from one {backtest.glastonbury.source} clash guide about mid-card acts), adding taste raised the full
        price&rsquo;s AUC by {formatAuc(up.diff)} (interval {formatDiffInterval(up.interval)}, resampled by complaint).
        On the {numberWord(backtest.usFestivals)} US festivals ({us.complaintPairs} complaint pairs in {us.complaints}{" "}
        clusters, press complaints that mostly named the day&rsquo;s biggest acts, which popularity already ranks
        well), adding taste lowered it by {formatAuc(Math.abs(down.diff))} (interval{" "}
        {formatDiffInterval(down.interval)}
        {usHoldsZero ? ", includes 0" : ""}).
      </p>
      <p>
        <strong className="font-semibold">A hypothesis for use, not a result:</strong> taste overlap may matter most
        for mid-card clashes; for clashes between the day&rsquo;s biggest acts, time and draw already carry most of the
        signal. The two samples also differ in festival, complaint source and act size, so this split cannot say
        which of those drives it. Untested beyond this data.
      </p>
    </>
  );
}

/**
 * The replication test that has not been run (round 33), as one paragraph with a plain bold lead, no kicker: held-out
 * bills that do not exist yet, scoring fixed in advance, complaints gathered the same way, a paired comparison on the
 * same pairs and a success threshold stated before any data. It promises no date beyond the bills' year and no result.
 */
function ReplicationTest() {
  const { replication } = METHOD_FIGURES;
  return (
    <p>
      <strong className="font-semibold">A replication test we have not run.</strong> It needs data that does not exist
      yet: the {replication.billsYear} bills of the same {numberWord(backtest.festivals)} festivals, scored when their
      set times are published and before any complaint is collected. The scoring would be fixed and written down before
      that data arrives, and complaints collected the same way as here. On the same complained-about pairs, the full
      price would be compared with the same score with taste held constant, as a paired difference, counted a success
      only if that difference&rsquo;s {scale.intervalPct}% interval lies above {replication.successAbove}. Both arms
      keep Qloo&rsquo;s popularity; a baseline with no Qloo data has not been tested.
    </p>
  );
}

/**
 * The taste-inside-the-price figures by festival, as a ruled table on paper like the backtest's: popularity, the
 * price with taste taken out (time and draw) and the full price, Glastonbury against the four US festivals pooled.
 * A festival with too few complaints to read alone (Riot Fest) prints its counts and says so, with no AUC.
 */
function TasteByFestival() {
  return (
    <figure className="my-4">
      <figcaption id="taste-by-festival-caption" className={`text-sm text-muted-foreground ${CAPTION_MEASURE}`}>
        AUC by festival, exploratory ({scale.auc.chance} means no better than chance)
      </figcaption>
      <div
        role="region"
        aria-labelledby="taste-by-festival-caption"
        tabIndex={0}
        className="mt-3 overflow-x-auto rounded-lg border border-surface-edge px-4"
      >
        <table aria-labelledby="taste-by-festival-caption" className="w-full min-w-[19rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border align-bottom text-xs sm:text-sm">
              <th scope="col" className="py-3 pr-3 font-semibold sm:pr-4">
                Festivals
              </th>
              <th scope="col" className="px-2 py-3 text-right font-semibold sm:px-4">
                Popularity
              </th>
              <th scope="col" className="px-2 py-3 text-right font-semibold sm:px-4">
                Time and draw
              </th>
              <th scope="col" className="py-3 pl-2 text-right font-semibold sm:pl-4">
                Full price
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tasteInPrice.festivals.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-3 pr-3 font-normal sm:pr-4">
                  <span className="block">{row.label}</span>
                  <span className="block text-xs text-muted-foreground sm:text-sm">
                    {row.complaintPairs} pairs from {row.complaints} complaints
                  </span>
                </th>
                {row.read ? (
                  <>
                    <td className="px-2 py-3 text-right tabular-nums sm:px-4">{formatAuc(row.read.popularity)}</td>
                    <td className="px-2 py-3 text-right tabular-nums sm:px-4">{formatAuc(row.read.tasteRemoved)}</td>
                    <td className="py-3 pl-2 text-right tabular-nums sm:pl-4">{formatAuc(row.read.fullPrice)}</td>
                  </>
                ) : (
                  <td colSpan={3} className="py-3 pl-2 text-right sm:pl-4">
                    Not interpreted: too few complaints to read alone
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** The forum threads by their id, named so the four links read apart. */
const THREAD_LABELS: Readonly<Record<string, string>> = {
  "1sk3vor": "Coachella 2026 - Reddit discussion",
  "1vevkfi": "Lollapalooza 2026 - Reddit discussion 1",
  "1vbhhdi": "Lollapalooza 2026 - Reddit discussion 2",
  "1v8cvd2": "Lollapalooza 2026 - Reddit discussion 3",
};

/** A readable name for a public page: a forum thread by its festival, anything else by its host, without "www.". */
function sourceLabel(url: string): string {
  const { hostname, pathname } = new URL(url);
  const host = hostname.replace(/^www\./, "");
  if (host !== "reddit.com") return host;
  const id = pathname.match(/\/comments\/([a-z0-9]+)/)?.[1];
  return (id && THREAD_LABELS[id]) || "reddit.com forum thread";
}

/** The public pages behind the complained-about clashes, collapsed until opened. */
function Sources() {
  return (
    <MoreDetails summary={<>Sources for the {complaints.clustersVerified} clashes</>}>
      <p className="text-sm text-muted-foreground">
        {complaints.clustersVerified} clashes that fans or the press complained about at{" "}
        {numberWord(complaints.festivals)} festivals had a verified overlap in time: {complaints.pairsVerified}{" "}
        pairs of acts, overlapping for a median of {complaints.medianMinutes} minutes (from{" "}
        {complaints.rangeMinutes[0]} to {complaints.rangeMinutes[1]}). They come from{" "}
        {numberWord(PUBLIC_SOURCES.length)} public pages; one page can name several clashes.
      </p>
      <ol className="mt-3 mb-4 list-decimal space-y-1 pl-5 text-sm">
        {PUBLIC_SOURCES.map((url) => (
          <li key={url} className="min-w-0 break-words">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={TEXT_LINK}
            >
              {sourceLabel(url)}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ol>
    </MoreDetails>
  );
}

/** The anchor of the block on why the app reads Qloo, not a similar-artists list or ticket data. */
const WHY_QLOO_ID = "why-qloo";

/** The anchor of the block on the build's control acts; the home page's "How Qloo was used" links its control rows here. */
const CONTROLS_ID = "controls";

/** "A, B, C and D": names in running text, with "and" before the last. */
function nameList(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The page's sections, in order, for its running order. */
const CONTENTS: readonly { id: string; title: string }[] = [
  { id: "price", title: "What the score is" },
  { id: "tested", title: "What we tested it against" },
  { id: "limits", title: "What taste overlap cannot tell you" },
  { id: "the-rest", title: "How the rest works" },
];

const LABELS: readonly { provenance: Provenance; meaning: string }[] = [
  { provenance: "recorded", meaning: "A saved Qloo response." },
  { provenance: "derived", meaning: "Calculated by this app from saved responses." },
  { provenance: "qloo", meaning: "Returned by Qloo in a live request." },
  { provenance: "llm", meaning: "Written by a language model. Not Qloo data." },
];

export default function MethodPage() {
  const [overlapLow, overlapHigh] = scale.overlap;
  return (
    <article>
      <style>{PRINT_CSS}</style>
      <header className="container-page pt-10 pb-10 sm:pt-14 sm:pb-12">
        {/* From 1280px the header is the sections' 12-column grid: the art, the title and the lede across all twelve
            columns, then the short version as the first hanging block, and the running order in its body column. */}
        <div className={`${COLUMN} ${HANGING}`}>
          {headerArt ? (
            <picture className="art-plate mb-8 block overflow-hidden rounded-lg sm:mb-10 xl:col-span-12">
              <source type="image/avif" srcSet={headerArt.avif} />
              {/* The files are encoded ahead of time (AVIF with a WebP fallback), so no image service is needed. */}
              <img
                src={headerArt.webp}
                width={headerArt.width}
                height={headerArt.height}
                alt={headerArt.alt}
                decoding="async"
                className="block h-auto w-full"
              />
            </picture>
          ) : null}
          {/* The one display step every page title takes (the home page's and /check's too), with no size of its own. */}
          <h1 className="type-poster xl:col-span-12">
            How we know
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-snug font-medium sm:text-xl xl:col-span-12">
            <BySyntheticDay
              real="Clash Control scores set-time clashes with a number it derives from Qloo data."
              invented="Clash Control scores set-time clashes with a number it calculates from taste-overlap and draw figures. The day this server is showing is an invented example, so its figures are invented and no Qloo request was made for it."
            />
          </p>
          <ShortVersion />
          {/* The page's running order, once at every width: after the short version, so the failed test is stated
              before any section title, as one compact sequence of titles that wraps; from 1280px in the body column,
              under the short version's last paragraph. Not printed: the reading column carries all of it. */}
          <div className={BODY_CELL}>
            <div className="mt-8 print:hidden">
              <ContentsRail items={CONTENTS} />
            </div>
          </div>
        </div>
      </header>

      <Section id="price" title="What the score is">
        <p className="font-mono text-base font-medium sm:text-lg">
          Pair score = taste overlap &times; share of the shorter set played at once &times; combined draw
          &times; rarity factor.
        </p>
        <p>
          Taste overlap is an app-derived rank of how alike Qloo ranks two audiences in taste, relative
          to that bill. It is not a share of fans and not attendance.
        </p>
        <MoreDetails summary="How the score is calculated">
          <div className="space-y-4 pb-4">
            <p>
              A clash&rsquo;s pair score is its taste overlap, times the share of the shorter set that the two
              sets play at once (counted only for sets on the same day and on different stages), times the
              two acts&rsquo; draw (their geometric mean), times a rarity factor of {price.rarityFloor} plus
              the average of the two acts&rsquo; rarity. On both saved days every act carries the neutral
              rarity {price.neutralRarity}, so the factor is {price.neutralFactor.toFixed(1)} for every pair
              and does not move any score. The invented example day, which a server shows when it has no
              built day, is the exception: its acts carry their own rarity.
            </p>
            <p>
              <BySyntheticDay real={formulaNote(false)} invented={formulaNote(true)} />
            </p>
            <p>
              Draw is each act&rsquo;s popularity on Qloo, a percentile among Qloo artists, and the two
              acts&rsquo; draw is the square root of their product. Taste overlap
              is derived: for each act, Qloo ranks every other act on that day&rsquo;s bill by how
              strongly the act&rsquo;s audience leans toward them. In the{" "}
              {formatCount(symmetry.pairs)} saved pairs we checked, Qloo&rsquo;s affinity came back the
              same whichever act was the signal (the {formatCount(symmetry.readings)} readings agree in
              both directions to within {formatWithin(symmetry.maxDifference)}), so for those pairs the
              two directions make one reading. The app turns that reading into a rank within each
              act&rsquo;s row of the bill, averages the two ranks, so an act that is close to everyone
              does not look close to everyone, and scales the result {overlapLow} to {overlapHigh}.
            </p>
            <p>
              The Clash Budget Index is {scale.indexMultiplier} times the day&rsquo;s total pair score
              divided by the mean total of {index.baselineSamples} sampled random valid timetables of the
              same lineup, in which each set stays inside its allowed window and stages and locked sets
              stay put. Lower
              is better. {COUNTS_ONLY_NEUTRAL}
            </p>
          </div>
        </MoreDetails>
      </Section>

      <Section id="tested" title="What we tested it against">
        <p>
          We collected clashes that the press or fans publicly complained about at{" "}
          {numberWord(backtest.festivals)} festivals, then looked at where each one ranks among all
          concurrent pairs on its festival day: {backtest.scoredPairs} complained-about pairs from{" "}
          {backtest.clusters} complaints (one complaint can name more than two acts), across{" "}
          {backtest.festivalDays} festival days.
        </p>
        <MoreDetails
          summary={
            <>
              Why {backtest.scoredPairs} of {complaints.pairsVerified} verified pairs were scored
            </>
          }
          className="border-b border-b-border"
        >
          <p className="pb-4">
            {numberWord(backtest.unscoredPairs, { capitalize: true })} more could not be scored because
            Qloo has no signal for one of the acts.{" "}
            {numberWord(backtest.outOfScopePairs, { capitalize: true })} more involve a set on a minor
            stage that the test leaves out, which makes the {complaints.pairsVerified} verified pairs.
          </p>
        </MoreDetails>
        <BacktestTable />
        {/* The failed test is stated once, in the short version; here it is referred to, not restated (round 33). */}
        <p>
          The failed test above is this table read against the bar we set before running it, for taste
          overlap alone. So the test does not show that taste overlap predicts the clashes people complain
          about, and we do not claim it.
        </p>
        <p>
          What it does show: in this test taste overlap ranked the complained-about clashes above
          genre tags did (AUC {formatAuc(taste.auc)} against {formatAuc(genre.auc)}), though the two
          intervals overlap widely. It is nearly unrelated to popularity (correlation{" "}
          {backtest.popularityCorrelation}), so it is a separate signal from popularity.
        </p>
        <p>
          One festival drives much of the favourable result. At {backtest.glastonbury.label},{" "}
          {backtest.glastonbury.inTopQuarter} of the {backtest.glastonbury.namedClashes} clashes named
          in one {backtest.glastonbury.source} guide ranked in the top quarter of their day (AUC{" "}
          {backtest.glastonbury.auc}). That is one source, found after the fact, and not yet repeated at
          other festivals. Across the {numberWord(backtest.usFestivals)} US festivals together the AUC
          was {backtest.usFestivalsAuc}.
        </p>
        <p>The exploratory follow-up did not establish an advantage over popularity.</p>
        <Exploratory />
        <TasteInPrice />
        <Sources />
      </Section>

      <Section id="limits" title="What taste overlap cannot tell you">
        {/* Hairline rows, like the lines of a running order, instead of bullets. */}
        <ul className="[&>li]:border-t [&>li]:border-border [&>li]:py-2">
          <li>It is not attendance, and this app estimates no attendance or money figure anywhere.</li>
          <li>
            It is a global reading: no location was sent, so it says how close two audiences are in general, not at
            this festival.
          </li>
          <li>
            Hidden clashes are examples, not detections. Of {backtest.hidden.pairs} pairs with
            top-quarter taste overlap and no shared genre tag, {backtest.hidden.complained} were
            complained about ({formatPct(backtest.hidden.complainedPct)}, against{" "}
            {formatPct(backtest.hidden.basePct)} for all pairs).
          </li>
          <li>
            The Hidden label on the timetable uses a stricter line than this count for taste overlap, the
            day&rsquo;s top tenth where the count above uses the top quarter, and a looser one for genre: the
            two acts&rsquo; main genre tags differ.
          </li>
          <li>
            A plan of kept moves is scored by the same measure the places are found with, so it shows
            what the measure rewards; whether it suits the real festival is the programmer&rsquo;s call.
          </li>
          <li>
            Qloo has a usable signal for {coverage.usableActs} of {coverage.totalActs} acts across the{" "}
            {numberWord(backtest.festivals)} festivals tested ({formatWholePct(coverage.usablePct)}).
            On the two days shown it is{" "}
            {coverage.days
              .map((day) => `${day.scored} of ${day.total} sets (${formatWholePct(day.pct)})`)
              .join(" and ")}
            . Where there is none, the app leaves the clash out of the score and says so.
          </li>
          <li>
            The Clash Budget Index compares a timetable with random valid timetables of the same
            lineup. It reads one kind of cost. Real programming weighs much more than taste overlap.
          </li>
          <li>{DO_NOT_USE}</li>
        </ul>
      </Section>

      <Section
        id="the-rest"
        title="How the rest works"
        rail={
          <div data-flow-place="rail">
            <RequestFlow stacked />
          </div>
        }
        footer={
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-sm py-2 text-base font-semibold underline-offset-4 hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to the timetable
          </Link>
        }
      >
        <SubBlock id="qloo-calls" title="Qloo requests">
          <QlooCalls />
          <p>
            The cards show the timetable&rsquo;s own requests. Live calls come only from the re-check route, the
            pasted-grid route in live mode and the agent route, each limited per visitor; their Qloo requests
            pause when the monthly Qloo allowance runs low. The agent&rsquo;s general explore tools, where switched
            on, can also send other entity types and signals to the same endpoints.
            The pair re-check sends exactly three requests and never reads a saved answer as live.
          </p>
        </SubBlock>

        <SubBlock id={WHY_QLOO_ID} title="Why Qloo, not a similar-artists list or ticket data">
          <p>
            A similar-artists list names an act&rsquo;s nearest neighbours. This app needs a reading for every
            clashing pair on a bill, so it asks Qloo to rank all of a day&rsquo;s acts against each act&rsquo;s audience
            (<code className="font-mono">filter.results.entities</code>). That works before tickets go on sale and for acts with no ticket
            history at the festival; acts Qloo has no signal for are left out, not scored as zero. It reads taste, not
            attendance, and this app estimates no attendance.
          </p>
        </SubBlock>

        <SubBlock id={CONTROLS_ID} title={`${numberWord(CONTROL_ACTS.length, { capitalize: true })} control acts`}>
          <p>
            Each build also looks up {numberWord(CONTROL_ACTS.length)} acts chosen to be unrelated to a festival bill:{" "}
            {nameList(CONTROL_ACTS)}. If their audiences do not rank near the bottom of the bill (a mean percentile
            of {CONTROL_RANK_LIMIT} or lower), the build says the signal does not separate audiences on that bill. On
            both saved days their mean percentile was {CONTROL_RANK_LIMIT} or lower. This does not test whether the
            clash rankings are useful. Their lookups are marked as control acts in How Qloo was used.
          </p>
        </SubBlock>

        <SubBlock id="moving-sets" title="Moving sets">
          <p>
            Before building this we set a check: suggestions made with taste overlap had to differ from
            suggestions made with popularity alone by {moves.barPoints} index points on the Glastonbury
            Sunday, graded on the same matrix. They differed by {moves.measuredPoints} index points (one point
            is {scale.indexPointPct}% of the average random timetable&rsquo;s cost), with{" "}
            {moves.movesDiffer} of {moves.movesCompared} moves different, so{" "}
            <strong className="font-semibold">the check failed as written.</strong>
          </p>
          <p>
            Suggested moves are graded by the same measure used to find them, so a better score is
            expected, not proof. The app does not claim that any suggestion is the best one.
          </p>
        </SubBlock>

        <SubBlock id="labels" title="Where each number comes from">
          <dl className="space-y-2">
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
            <BySyntheticDay real={BUILT_FROM_REAL} invented={BUILT_FROM_SYNTHETIC} />
          </p>
        </SubBlock>

        <SubBlock id="live-check" title="The live re-check">
          <p>
            While enabled, the day&rsquo;s costliest clashes can be re-checked with Qloo:{" "}
            {liveCheck.requests} requests in all. Fresh results appear beside the saved values and never
            replace them. Request IDs appear when Qloo supplies them. Checks are limited per visitor and
            per day, and pause when the monthly Qloo allowance runs low. When disabled, only saved
            results appear.
          </p>
        </SubBlock>

        <SubBlock
          id="brief"
          title={
            <>
              The <span className="whitespace-nowrap">one-page</span> brief
            </>
          }
        >
          <p>
            The brief page prints this day&rsquo;s costliest clashes, the day&rsquo;s Clash Budget Index
            and any moves you kept, using only figures the timetable page already shows. It is for
            evaluating this entry. The pilot on the home page walks a programmer through a published day&rsquo;s
            brief, with the same limits: no Qloo tags or identifiers, and not for redistribution.
          </p>
        </SubBlock>
      </Section>
    </article>
  );
}
