import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { BySyntheticDay } from "@/components/site/synthetic-context";
import { CHECK_LIVE } from "@/lib/check-flag";

import { DEMAND, PILOT_CONTACT, PILOT_TERMS, type Demand } from "@/lib/demand";
import { METHOD_FIGURES, formatPct, methodRow, numberWord, type MethodId } from "@/lib/method-figures";
import { PUBLIC_SOURCES } from "@/lib/public-sources";
import { cn } from "@/lib/utils";

import { DISCLOSURE_ROW_CLASS, DISCLOSURE_SUMMARY_CLASS } from "./more-details";

/** The anchor of the section, for links that point at it. */
export const WHY_THIS_MATTERS_ID = "why-this-matters";

/** A link in text: ink, with a 1px border-strong underline at offset 4px that turns ink on hover. Never raspberry. */
const LINK =
  "font-semibold text-foreground underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground";

/** A sentence-case label over a block: 13px semibold, no caps, no tracking. */
const LABEL = "text-[0.8125rem] leading-5 font-semibold";
/** A finding's one-line conclusion: 18px semibold, sentence case. */
const CONCLUSION = "text-lg leading-snug font-semibold";

/** A fold's words: the page's text-link underline, 1px border-strong 4px off the text, turning ink on hover. */
const FOLD_LABEL =
  "underline decoration-border-strong decoration-1 underline-offset-4 group-hover/fold:decoration-foreground";

/**
 * A closed disclosure named for what it holds, as a text action rather than an accordion row: no rule above or
 * around it and no leading mark, the summary's words in 15px medium ink with the page's text-link underline, then
 * a trailing 14px ink chevron kept on the last word's line that points down while closed and up once open. The turn
 * animates only under motion-safe; under reduced motion the open chevron is simply drawn turned. The row keeps its
 * 44px height. Native `<details>`, closed by default, so it works without JavaScript.
 */
function Fold({
  summary,
  className,
  summaryClassName,
  children,
}: {
  summary: string;
  className?: string;
  summaryClassName?: string;
  children: ReactNode;
}) {
  const cut = summary.lastIndexOf(" ") + 1;
  const head = summary.slice(0, cut);
  const last = summary.slice(cut);
  return (
    // cc-disclosure and its summary are emitted after the core utilities, so their rule, weight and hover underline
    // are overridden with the important form.
    <details className={cn("group", DISCLOSURE_ROW_CLASS, "border-t-0!", className)}>
      <summary
        className={cn(DISCLOSURE_SUMMARY_CLASS, "group/fold rounded-md font-medium! hover:no-underline!", summaryClassName)}
      >
        {/* The last word and the chevron share a no-wrap span, so a summary that wraps carries the chevron down
            with its last word and never leaves it alone on a line. */}
        <span data-fold-text>
          <span className={FOLD_LABEL}>{head}</span>
          <span className="whitespace-nowrap">
            <span className={FOLD_LABEL}>{last}</span>
            <ChevronDown
              aria-hidden="true"
              className="ml-1.5 inline-block size-3.5 align-[-0.125em] group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out"
            />
          </span>
        </span>
      </summary>
      {children}
    </details>
  );
}

function DemandLine({ demand }: { demand: Demand }) {
  if (demand.status === "pending") return null;
  if (demand.status === "none") {
    return (
      <p className="mt-3">
        We asked {demand.asked} festival programmers between {demand.dates}; none had replied by {demand.checkedOn}.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <p className={cn(LABEL, "text-muted-foreground")}>One programmer told us</p>
      <p className="mt-1.5 text-muted-foreground">
        Asked {demand.asked}, replied {demand.replied}. {demand.dates}.
      </p>
      {/* 15px, with the source on the next line at 13px muted. No quotation marks: nothing says the reply is
          stored word for word. */}
      <blockquote data-quote className="mt-2 text-[0.9375rem] break-words">
        {demand.quote}
      </blockquote>
      <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">{demand.role}</p>
      <p className="mt-2">Changed because of this reply: {demand.changed ?? "Nothing changed."}</p>
    </div>
  );
}

/** A contact the owner wrote in: an address opens mail, anything else is a link. */
function contactHref(contact: string): string {
  return contact.includes("@") && !/^https?:/i.test(contact) ? `mailto:${contact}` : contact;
}

/**
 * The pilot offer as one unboxed editorial block: a 1px border-border rule across its top (a top rule, never a
 * left stripe), 24px of paper, then left-aligned text at most 68ch wide. From 1024px it sits in the findings' right
 * columns, right under what is not known, so the offer is read after "Who would pay is not known." In order: the
 * 16px label, the offer at body size (its success line closes on "One answer is not a
 * market."), then the way to /check first as a 44px text link with an arrow (never a button, so the viewport keeps
 * one primary action) and the contact in muted at body size, sharing a line from 640px with a middot between. With
 * no /check the contact leads, in ink. The offer is never set larger or heavier than "Who would pay is not known.".
 * No card, fill, stat, fold or button. It names no customer, count or reply, and offers nothing that costs a Qloo
 * request (the request arithmetic is on the Devpost page, from `PILOT` in lib/demand.ts).
 */
function PilotOffer({ contact, terms }: { contact: string | null; terms: string | null }) {
  return (
    <div data-pilot className="border-t border-border pt-6">
      <div data-pilot-offer className="max-w-[68ch]">
        <h3 className="text-base leading-snug font-semibold">Pilot offer</h3>
        <p className="mt-2">
          Walk through the {PILOT_DAY} brief with me and say where it matches how your team would set those
          times. Your own draft can go through Check a draft grid, whose rule checks run in your browser and send
          nothing. Success: you say which suggestion you would take or turn down, and why. One answer is not a
          market.
        </p>
      </div>
      {/* While /check is live the action leads: the link (16px semibold ink, its arrow, a 44px line), then the
          contact in muted at body size, on one line from 640px joined by a middot; on a phone the contact takes its
          own line. With no /check the contact leads, in ink, as before. */}
      <div data-pilot-next className="mt-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-2">
        {CHECK_LIVE ? (
          <>
            <p>
              <Link href="/check" className={cn(LINK, "inline-flex min-h-11 items-center gap-1.5 text-base")}>
                Check a draft grid
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </p>
            <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
              &middot;
            </span>
          </>
        ) : null}
        <p data-pilot-contact className={CHECK_LIVE ? "text-muted-foreground" : undefined}>
          {contact ? (
            <>
              Contact:{" "}
              <a href={contactHref(contact)} className={LINK}>
                {contact}
              </a>
            </>
          ) : (
            "Contact is on the Devpost page."
          )}
        </p>
      </div>
      {/* The terms, once the owner has confirmed them: in the open under the offer, body size, muted on paper. */}
      {terms ? (
        <p data-pilot-terms className="mt-4 max-w-[68ch] text-muted-foreground">
          {terms}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Said under the complaint finding, so no reader takes the complaints for a verdict on the day above: most are about
 * other festivals and days (a few name sets on the two published days, so "none" would not be true).
 */
export const COMPLAINTS_ELSEWHERE = "Most of these complaints are about other festivals and days, not the days this app shows.";

/**
 * What is at stake when two sets clash, and when Clash Control is used: the section's first line, under its heading.
 * No number and no count of people.
 */
export const WHY_STAKE =
  "When two sets clash, anyone who wants to see both has to choose. Clash Control is for the time after acts are booked and before set times go out.";

/** The published day the zero-request pilot walks through: its brief exists and costs no Qloo request. */
export const PILOT_DAY = "Glastonbury 2025 Sunday";

/** The press outlets among the public pages the complaints come from (`PUBLIC_SOURCES`), as printed. */
export const PRESS_OUTLETS = ["NME", "Time Out", "Vice", "SF Chronicle", "Lambgoat", "EDM Identity"] as const;

/** A public page that is a forum thread rather than a press article. */
export function isForumThread(url: string): boolean {
  return new URL(url).hostname.replace(/^www\./, "") === "reddit.com";
}

/**
 * Who the complaints come from, in one sentence true of every listed source: forum threads and press articles,
 * named. No claim about who attended or wanted to see both acts. The counts are read from `PUBLIC_SOURCES`.
 */
export const COMPLAINT_SOURCES = (() => {
  const threads = PUBLIC_SOURCES.filter(isForumThread).length;
  const articles = PUBLIC_SOURCES.length - threads;
  return `They come from ${numberWord(threads)} Reddit threads and ${numberWord(articles)} press articles (${PRESS_OUTLETS.join(", ")}).`;
})();

/** Short row labels for the figure; the full method names are on /method. */
const FIGURE_LABELS: Record<MethodId, string> = {
  taste: "Taste overlap",
  popularity: "Popularity",
  genre: "Genre tags",
  random: "Random",
};
const FIGURE_ORDER: readonly MethodId[] = ["taste", "popularity", "genre", "random"];
/**
 * Bar marks, in the product's own ink and muted ink. Taste overlap and popularity, the two Qloo measures the test
 * compares, are the same 16px solid ink bar, so their lengths are read against each other with nothing else
 * changing: popularity's longer bar is what shows it did better. Taste overlap is marked as the page's subject by its
 * semibold ink row label and its semibold ink value at the bar's end ("46.8%"), not by its fill. Genre tags and random are the comparator baselines, 6px bars in
 * muted ink centred on the same row line, so they read as reference marks rather than contenders. Every bar keeps
 * the one 0 to FIGURE_DOMAIN scale, so all four lengths stay comparable. No bar is raspberry or teal: raspberry
 * means shared time and its cost, and a coloured taste bar read as the winner on a chart where popularity did
 * better. The value beside each bar and its row label carry the figure, so no mark carries it alone.
 */
const FIGURE_FILL: Record<MethodId, string> = {
  taste: "h-4 bg-foreground",
  popularity: "h-4 bg-foreground",
  genre: "h-1.5 bg-muted-foreground",
  random: "h-1.5 bg-muted-foreground",
};
/**
 * The axis runs 0 to 75, so it ends on a round tick and the longest bar (popularity, 57.8) ends at 77% of the plot.
 * Shared with /method's test, which imports it.
 */
export const FIGURE_DOMAIN = 75;
/** Axis numbers at these shares, every 25 to the domain's end. Only 0 is ruled; the rest are read from the numbers. */
export const FIGURE_TICKS = [0, 25, 50, 75] as const;
/** Where a share sits along the axis, as a percentage of the plot's width. */
export function along(pct: number): string {
  return `${Math.round((pct / FIGURE_DOMAIN) * 100000) / 1000}%`;
}

/**
 * Where a bar's value label sits. It is always outside the bar end, 8px past it, in ink. When the target line
 * would cross it, the label sits 8px past the line instead. Whether it would cross depends on the figure's
 * width, so each placement is a container query on the figure: the label stays past the line until the figure is
 * wide enough to keep it clear (an assumed 45px label, "57.8%" in 12px mono).
 */
const LABEL_PLACE = {
  /** Past the line at any width: the bar ends too close to the line. */
  past: "left-[calc(var(--rule)_+_0.5rem)]",
  /** At the bar end from a 352px figure. */
  "22rem": "left-[calc(var(--rule)_+_0.5rem)] @min-[22rem]:left-[calc(var(--end)_+_0.5rem)]",
  /** At the bar end from a 448px figure. */
  "28rem": "left-[calc(var(--rule)_+_0.5rem)] @min-[28rem]:left-[calc(var(--end)_+_0.5rem)]",
  /** At the bar end from a 640px figure. */
  "40rem": "left-[calc(var(--rule)_+_0.5rem)] @min-[40rem]:left-[calc(var(--end)_+_0.5rem)]",
  /** At the bar end always: no line, or the bar ends past it. */
  outside: "left-[calc(var(--end)_+_0.5rem)]",
} as const;
type LabelPlace = keyof typeof LABEL_PLACE;

/**
 * The figure's fixed columns: label 108px, gap 12px, and the most room `barsRoom` ever keeps, 48px; the plot is the
 * rest. Room under 48px only widens the plot, so a placement that clears the line here clears it at any room.
 */
const FIXED_PX = 168;
/** A value label's assumed width plus its 8px offset, and the clearance it keeps from the line. */
const LABEL_PX = 53;
const CLEAR_PX = 8;

/**
 * The room right of the plot: just enough for the farthest value label (past the line, or past the longest bar) to
 * end inside the figure, between 0 and 3rem. With `reach` the farthest label anchor as a share of the axis, the label
 * ends at 7.5rem + reach x plot + LABEL_PX, so the room solves that against the figure's width (100cqw, resolved on
 * the figure's own container). Wide figures need none, so the axis's last number ends on the figure's right edge,
 * the edge of the prose beside it.
 */
function barsRoom(threshold: number | undefined): string {
  const farthest = Math.max(threshold ?? 0, ...FIGURE_ORDER.map((id) => methodRow(id).topQuarterPct));
  const reach = Math.min(1, farthest / FIGURE_DOMAIN);
  if (reach <= 0) return "0px";
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return `clamp(0px, calc((${LABEL_PX}px - ${round(1 - reach)} * (100cqw - 7.5rem)) / ${round(reach)}), 3rem)`;
}

/**
 * Where `reached`'s label goes: at its bar end once the figure is wide enough to keep it clear of the line. The
 * width it needs follows from FIGURE_DOMAIN, so the 0 to 75 axis keeps every real bar's placement: 46.8% from 40rem
 * (515px), 39.0% from 28rem (386px), 26.3% from 22rem (304px), and 57.8% past the line at any width.
 */
function placeLabel(reached: number, threshold: number | undefined): LabelPlace {
  if (threshold === undefined || reached >= threshold) return "outside";
  const figure = ((LABEL_PX + CLEAR_PX) * FIGURE_DOMAIN) / (threshold - reached) + FIXED_PX;
  if (figure <= 352) return "22rem";
  if (figure <= 448) return "28rem";
  if (figure <= 640) return "40rem";
  return "past";
}

/**
 * The complaint backtest as bars on one 0 to 75 axis: each method's share of complained-about clashes in the
 * top quarter of their day, from `METHOD_FIGURES.backtest`. Each value sits in ink, 12px mono, just past its own
 * bar end on the same row (past the target line where the line would cross it). The one rule is the 0 axis in
 * border-strong; the optional `threshold` is a 1.5px SOLID ink line that spans the bars (solid, because dashed
 * means tested), with its label ("Bar we set: 60%") in 12px ink on a 24px row of its own above the plot,
 * right-aligned to the top of the line and set 10px above the row's foot (the line's top), so its foot clears the
 * taste overlap bar's top by 16px (10px plus the bar's 6px inset in its 28px lane) and no value label can meet it.
 * Each bar is a mark with the same 6px corner at both ends (`rounded-bar`), so no bar has one square end; the 6px
 * baselines are clamped to a round end.
 * Drawn on /method only; the home page states the two figures in one sentence instead.
 */
export function BacktestBars({
  threshold,
  describe,
}: {
  /** The bar set before the test, drawn as a solid ink line with its label ("Bar we set: 60%"). */
  threshold?: number;
  /** Each bar's accessible name; without it the bars are decorative and the row text carries the value. */
  describe?: (id: MethodId, label: string, reached: number) => string;
}) {
  // Label column, gap, and room on the right for a value past the longest bar (or the line).
  const grid = { "--bars-label": "6.75rem", "--bars-gap": "0.75rem", "--bars-room": barsRoom(threshold) } as CSSProperties;
  const plot = { left: "calc(var(--bars-label) + var(--bars-gap))", right: "var(--bars-room)" } as const;
  const inset = { marginLeft: "calc(var(--bars-label) + var(--bars-gap))", marginRight: "var(--bars-room)" } as const;
  return (
    <div className="@container relative" style={grid}>
      {threshold !== undefined ? (
        <div className="relative h-6" style={inset}>
          <span
            data-target-label
            className="absolute bottom-2.5 text-xs leading-none whitespace-nowrap text-foreground"
            style={{ right: `${Math.round((100 - (threshold / FIGURE_DOMAIN) * 100) * 1000) / 1000}%` }}
          >
            Bar we set: <span className="font-mono tabular-nums">{threshold}%</span>
          </span>
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className={cn("pointer-events-none absolute bottom-6", threshold !== undefined ? "top-6" : "top-0")}
        style={plot}
      >
        <span data-axis-zero className="absolute inset-y-0 w-px bg-border-strong" style={{ left: along(0) }} />
        {threshold !== undefined ? (
          <span
            data-target-line
            className="absolute inset-y-0 w-0 -translate-x-1/2 border-l-[1.5px] border-solid border-foreground"
            style={{ left: along(threshold) }}
          />
        ) : null}
      </div>
      <div className="relative space-y-1.5">
        {FIGURE_ORDER.map((id) => {
          const reached = methodRow(id).topQuarterPct;
          const label = FIGURE_LABELS[id];
          const name = describe?.(id, label, reached);
          const place = placeLabel(reached, threshold);
          return (
            <div
              key={id}
              className="grid min-h-7 items-center"
              style={{
                gridTemplateColumns: "var(--bars-label) minmax(0,1fr)",
                columnGap: "var(--bars-gap)",
                paddingRight: "var(--bars-room)",
              }}
            >
              <span className={cn("text-[0.8125rem] leading-tight", id === "taste" && "font-semibold")}>{label}</span>
              <span
                className="relative flex h-7 items-center"
                style={{ "--end": along(reached), "--rule": along(threshold ?? 0) } as CSSProperties}
              >
                <span
                  role={name ? "img" : undefined}
                  aria-label={name}
                  aria-hidden={name ? undefined : true}
                  className={cn("block shrink-0 rounded-bar", FIGURE_FILL[id])}
                  style={{ width: along(reached) }}
                />
                <span
                  data-bar-value
                  data-label-place={place}
                  className={cn(
                    "absolute top-1/2 -translate-y-1/2 bg-background px-0.5 font-mono text-xs leading-none whitespace-nowrap text-foreground tabular-nums",
                    LABEL_PLACE[place],
                    id === "taste" && "font-semibold",
                  )}
                >
                  {formatPct(reached)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="relative mt-1 h-5 font-mono text-xs text-muted-foreground tabular-nums" style={inset}>
        {FIGURE_TICKS.map((tick) => (
          <span
            key={tick}
            className={cn("absolute top-0.5", tick === 0 ? "" : tick === FIGURE_DOMAIN ? "-translate-x-full" : "-translate-x-1/2")}
            style={{ left: along(tick) }}
          >
            {tick}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The taste reading's place in the index, on a published day and on the invented one. */
export const QLOO_PART = "the part Qloo’s taste data adds to the index";
export const QLOO_PART_INVENTED = "the taste-overlap part of the index";

/**
 * What the failed pre-set test taught us, in one paragraph under its heading: the figure against the bar, that
 * popularity did better (with its figure), that the exploratory follow-up did not establish an advantage, and what
 * that makes the taste reading. It is the last block of the taste section on the home page, always rendered and
 * never inside a disclosure. The AUC figures and the correlation with popularity stay on /method, where they are
 * defined; this block links there. Server-rendered.
 */
export function FailedTestNote({
  className,
  synthetic,
}: {
  className?: string;
  /** The invented day, when the caller knows it; without it the page's shared flag decides. */
  synthetic?: boolean;
}) {
  const { backtest } = METHOD_FIGURES;
  const taste = methodRow("taste");
  const popularity = methodRow("popularity");
  // Nothing on the invented day credits Qloo, so there the index's taste part is named for what it is.
  const part =
    synthetic === undefined ? (
      <BySyntheticDay real={QLOO_PART} invented={QLOO_PART_INVENTED} />
    ) : synthetic ? (
      QLOO_PART_INVENTED
    ) : (
      QLOO_PART
    );
  return (
    <div data-failed-test className={cn("text-sm leading-relaxed", className)}>
      <h3 className="text-base font-semibold">What the failed test taught us.</h3>
      <p className="mt-2 max-w-prose">
        Our test failed: taste overlap put {formatPct(taste.topQuarterPct)} of complained-about clashes in the top
        quarter of their day, below our {backtest.bar.topQuarterPct}% bar. Popularity, also a Qloo field, did
        better. It reached {formatPct(popularity.topQuarterPct)}. The exploratory follow-up did not establish an
        advantage over popularity. So the taste reading is a second opinion beside time and draw: {part}, never the
        verdict on its own.{" "}
        <Link href="/method#tested" className={LINK}>
          How we know
        </Link>
      </p>
    </div>
  );
}

/**
 * What is public about the problem and what is not known, right after the taste section and before the board,
 * open on the paper with no rule above it and no card around it. Under its heading, first, the stake and the moment
 * of use (`WHY_STAKE`), one paragraph at body size in ink across the container. From 1024px it is a 12-column composition: on
 * the left (5 columns) the problem, its finding set large at 20px as the column's heading; on the right (7
 * columns) what is not known, then the pilot offer, an unboxed block under a top rule set 24px below it (24px of
 * paper on each side of the rule), so the offer is read right after "Who would pay is not known.". Below 1024px it
 * is one column with 40px between blocks:
 * problem, what is not known, pilot. The other finding opens with its conclusion (an existing heading, 18px
 * semibold); the rest sits in its text toggle. The caveats, the competitor search's "absence of evidence only"
 * (the first line under its heading, at body size, in ink), what is not known, the pilot offer and every source
 * link stay in the open. The complaint counts are read from `METHOD_FIGURES`; the failed test they were scored in
 * is `FailedTestNote`, in the taste section, and the overlap figures and the chart are on /method. Server-rendered;
 * nothing here needs JavaScript.
 */
export function WhyThisMatters({
  demand = DEMAND,
  contact = PILOT_CONTACT,
  terms = PILOT_TERMS,
}: {
  demand?: Demand;
  /** Where to send a bill for the pilot; null points at the Devpost page. */
  contact?: string | null;
  /** The pilot's terms as the owner confirmed them; null prints nothing. */
  terms?: string | null;
}) {
  const { complaints } = METHOD_FIGURES;
  return (
    <section aria-labelledby="why-this-matters-heading" id={WHY_THIS_MATTERS_ID}>
      {/* 64px under the last block from 1024px too (the next section's own top padding keeps the gap). */}
      <div className="container-page py-16 lg:pt-20">
        <h2 id="why-this-matters-heading" className="type-title">
          Who has complained, and what nobody has tested
        </h2>
        {/* The stake and the moment of use, first, at body size in ink across the container's full measure. */}
        <p data-why-stake className="mt-2 text-base leading-normal text-foreground">
          {WHY_STAKE}
        </p>
        <div className="mt-6 grid items-start gap-y-10 text-[0.9375rem] leading-[1.55] lg:grid-cols-12 lg:gap-x-12 lg:gap-y-6">
          <div data-why-col="problem" className="min-w-0 lg:col-span-5 lg:row-span-2 lg:row-start-1">
            {/* The finding is the column's heading: the conclusion itself, set at 20px, 500 weight, in ink. */}
            <h3 data-why-finding className="text-xl leading-snug font-medium text-foreground">
              {complaints.clustersVerified} clashes that fans or the press complained about at {complaints.festivals}{" "}
              festivals had a verified overlap in time.
            </h3>
            {/* Who the complaints come from, then, in muted in the same paragraph, that most are about other days. */}
            <p data-why-sources className="mt-2">
              {COMPLAINT_SOURCES} <span data-why-elsewhere className="text-muted-foreground">{COMPLAINTS_ELSEWHERE}</span>
            </p>
            <Fold className="mt-2" summary={`How the lists lean (${complaints.pairsVerified} verified pairs)`}>
              <p className="pb-3">Press lists lean toward headliners, which flatters any taste-based method.</p>
            </Fold>
          </div>

          <div data-why-col="unknown" className="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-start-1">
            <h3 className={CONCLUSION}>No scheduler we found reads audience overlap</h3>
            <p className="mt-2">Our search, October 2026: absence of evidence only. Who would pay is not known.</p>
            <Fold className="mt-2" summary="Festival Pro and Lineup Ninja">
              <p className="pb-3">
                Both check double bookings and changeovers. We found none that reads audience overlap (our search,
                October 2026).
              </p>
            </Fold>
            <DemandLine demand={demand} />
          </div>

          {/* The pilot, last in reading order; from 1024px under what is not known, beside the problem. */}
          <div data-why-col="pilot" className="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-start-2">
            <PilotOffer contact={contact} terms={terms} />
          </div>
        </div>
      </div>
    </section>
  );
}
