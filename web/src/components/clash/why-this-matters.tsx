import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { BySyntheticDay } from "@/components/site/synthetic-context";
import { CHECK_LIVE } from "@/lib/check-flag";

import { DEMAND, PAYER_GUESS, PILOT, PILOT_CONTACT, PILOT_TERMS, type Demand } from "@/lib/demand";
import { METHOD_FIGURES, formatCount, formatPct, methodRow, numberWord, type MethodId } from "@/lib/method-figures";
import { PUBLIC_SOURCES } from "@/lib/public-sources";
import { PUBLIC_VOICES, type PublicVoice } from "@/lib/public-voices";
import { cn } from "@/lib/utils";

import { OverlapPattern, OverlapWindow, useOverlapPatternId } from "./marks";
import { DISCLOSURE_ROW_CLASS, DISCLOSURE_SUMMARY_CLASS } from "./more-details";

/** The anchor of the section, for links that point at it. */
export const WHY_THIS_MATTERS_ID = "why-this-matters";

/** A link in text: ink, with a 1px border-strong underline at offset 4px that turns ink on hover. Never vermilion. */
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
 * The pilot offer, with its stated limits read from `PILOT`, as one unboxed editorial block under the findings:
 * a 1px border-border rule across its top (a top rule, never a left stripe), 32px of paper, then left-aligned text.
 * From 1024px it sits on the findings' own 12-column grid (the same 48px gutter), so its edges are theirs: the 16px
 * label and the offer at body size in columns 1 to 5, the problem's x; in columns 6 to 12, the voices' x, the way to
 * /check first as a 44px text link with an arrow (never a button, so the viewport keeps one primary action), its words
 * level with the offer's first line (a subgrid row under the label), then the contact in muted at body size, then
 * the request arithmetic in its closed fold. With no /check the contact leads, as before. Below 1024px it is one
 * column at most 68ch wide, in the same order, the link and the contact sharing a line from 640px with a middot
 * between. The columns end where their content ends. The offer is never set larger or
 * heavier than "Who would pay is not known." above it. No card, fill, stat or button. It names no customer, count or
 * reply: it says what would count as success and that one answer is not a market.
 */
function PilotOffer({ contact, terms }: { contact: string | null; terms: string | null }) {
  const { requestsPerBill, monthlyRequests, fullDayRequests } = PILOT;
  return (
    <div data-pilot className="border-t border-border pt-8">
      <div className="max-w-[68ch] lg:grid lg:max-w-none lg:grid-cols-12 lg:grid-rows-[auto_auto] lg:gap-x-12 lg:gap-y-2">
        <div data-pilot-offer className="lg:col-span-5 lg:row-span-2 lg:grid lg:grid-rows-subgrid">
          <h3 className="text-base leading-snug font-semibold">Pilot offer</h3>
          <p className="mt-2 lg:mt-0">
            Walk through the {PILOT_DAY} brief with me and say where it matches how your team would set those
            times. Your own draft can go through Check a draft grid, whose rule checks run in your browser and send
            nothing. Success: you say which suggestion you would take or turn down, and why.
          </p>
        </div>
        {/* While /check is live the column opens on its action: the link (16px semibold ink, its arrow, a 44px
            line), then the contact in muted at body size, then the fold. From 640px the link and the contact share
            one line, joined by a middot; on a phone, and from 1024px in the right-hand columns, the contact takes
            its own line under the link. With no /check the contact leads, in ink, as before. The fold sits under
            both, left-aligned. */}
        <div data-pilot-next className="mt-3 lg:col-span-7 lg:col-start-6 lg:row-start-2 lg:mt-0">
          <div className="sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 lg:block">
            {CHECK_LIVE ? (
              <>
                <p className="lg:-mt-2.5">
                  <Link href="/check" className={cn(LINK, "inline-flex min-h-11 items-center gap-1.5 text-base")}>
                    Check a draft grid
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </p>
                <span aria-hidden="true" className="hidden text-muted-foreground sm:inline lg:hidden">
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
          <Fold
            summaryClassName="justify-start"
            summary={`About ${requestsPerBill} Qloo requests per bill, only with the festival’s OK`}
          >
            <p className="pb-1 text-muted-foreground">
              Pricing a new bill is not offered: comparing its longest overlaps takes about {requestsPerBill} Qloo
              requests of the {formatCount(monthlyRequests)} shared this month, and a full-day reading took{" "}
              {fullDayRequests[0]} and {fullDayRequests[1]}. Either needs the festival&rsquo;s OK. One answer is not a
              market.
            </p>
          </Fold>
        </div>
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
 * The complaint figure's scale: 0 to 120 minutes across its full width. It is not drawn (no axis line, ticks or
 * numbers), so the figure carries one scale, its own printed values; the accessible name states it.
 */
const COMPLAINT_AXIS = 120;
/** Where a number of minutes sits along the complaint figure, as a percentage of its width. */
function minutesAt(minutes: number): string {
  return `${Math.round((minutes / COMPLAINT_AXIS) * 100000) / 1000}%`;
}

/**
 * Said under the complaint finding, so no reader takes the complaints for a verdict on the day above: most are about
 * other festivals and days (a few name sets on the two published days, so "none" would not be true).
 */
export const COMPLAINTS_ELSEWHERE = "Most of these complaints are about other festivals and days, not the days this app shows.";

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

/** The complaint figure's caption, built from the pair count. */
export function complaintCaption(pairsVerified: number): string {
  return `Overlap range and median across ${pairsVerified} verified pairs.`;
}

/**
 * The verified complaints' overlap as one figure, drawn from `METHOD_FIGURES.complaints` only, with one scale: its
 * own three printed values. Top to bottom: the median's label over its mark; one 16px capsule from the shortest to
 * the longest overlap, placed on an undrawn 0 to 120 minute scale (the accessible name states it), in the
 * shared-time notation (card fill, the vermilion hatch inside OverlapWindow's 2px card halo, then a 1px ink outline
 * on top, so no hatch pixel meets the ink); the median as a 2px ink mark 6px past the capsule above and below, on a
 * 6px card underlay of the same height, so a 2px card gap separates it from every hatch line; 4px under the capsule
 * the range ends, each under its own end; then the caption. No axis line, tick or axis number: a second scale under
 * the printed minutes read as two. Drawn final, with no motion.
 */
function ComplaintFigure() {
  const { pairsVerified, medianMinutes, rangeMinutes } = METHOD_FIGURES.complaints;
  const [low, high] = rangeMinutes;
  const patternId = useOverlapPatternId();
  const clipId = `${patternId}-clip`;
  const caption = complaintCaption(pairsVerified);
  // The capsule's edge sits on a half pixel, so its 1px outline covers whole pixels: its outline box runs 6 to 23.
  const bar = { x: minutesAt(low), y: 6.5, width: minutesAt(high - low), height: 16 };
  // The median mark and its underlay run 6px past the outline box above and below.
  const markHeight = bar.y - 0.5 + bar.height + 1 + 6;
  const median = minutesAt(medianMinutes);
  return (
    <div
      data-complaint-figure
      role="img"
      aria-label={`${caption} Range ${low} to ${high} minutes; median ${medianMinutes} minutes, on a 0 to ${COMPLAINT_AXIS} minute scale.`}
      className="mt-5 w-full min-w-[18rem]"
    >
      <div className="relative mb-1 h-5">
        <span
          data-median-label
          className="absolute bottom-0 -translate-x-1/2 text-[0.8125rem] leading-5 font-medium whitespace-nowrap text-foreground"
          style={{ left: median }}
        >
          median <span className="font-mono tabular-nums">{medianMinutes}</span> min
        </span>
      </div>
      <svg width="100%" height={markHeight} aria-hidden="true" focusable="false" className="block overflow-visible">
        <defs>
          <OverlapPattern id={patternId} />
        </defs>
        <OverlapWindow patternId={patternId} clipId={clipId} bar={bar} span={{ x: bar.x, width: bar.width }} />
        <rect
          data-median-underlay
          x={median}
          y={0}
          width={6}
          height={markHeight}
          transform="translate(-3 0)"
          fill="var(--card)"
          shapeRendering="crispEdges"
        />
        <rect
          data-capsule-outline
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={bar.height / 2}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1}
        />
        <rect
          data-median-mark
          x={median}
          y={0}
          width={2}
          height={markHeight}
          transform="translate(-1 0)"
          fill="var(--foreground)"
          shapeRendering="crispEdges"
        />
      </svg>
      <div className="relative mt-1 h-4 font-mono text-xs leading-4 whitespace-nowrap text-foreground tabular-nums">
        <span data-range-end className="absolute top-0 -translate-x-1/2" style={{ left: minutesAt(low) }}>
          {low} min
        </span>
        <span data-range-end className="absolute top-0 -translate-x-1/2" style={{ left: minutesAt(high) }}>
          {high} min
        </span>
      </div>
      <p data-complaint-caption className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
        {caption}
      </p>
    </div>
  );
}

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
 * the one 0 to FIGURE_DOMAIN scale, so all four lengths stay comparable. No bar is vermilion or teal: vermilion
 * means shared time and its cost, and a red or teal taste bar read as the winner on a chart where popularity did
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
 * taste overlap bar's top by 16px (10px plus the bar's 6px inset in its 28px lane) and no value label can meet it. Each bar is square at the 0 axis and round at its value
 * end (radius = half its height).
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
                  className={cn("block shrink-0 rounded-r-bar", FIGURE_FILL[id])}
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

/** A voice's source links, printed as the attribution's own links after the name. */
function VoiceLinks({ voice }: { voice: PublicVoice }) {
  return (
    <>
      {voice.links.map((link, i) => (
        <span key={link.href}>
          {i > 0 ? "; " : ""}
          <a href={link.href} target="_blank" rel="noopener noreferrer" className={LINK}>
            {link.label}
          </a>
        </span>
      ))}
    </>
  );
}

/** How many voices print in the open; the rest wait in one disclosure. */
const VOICES_SHOWN = 3;

/** What the public voices show and what they leave untested, word for word wherever it is printed. */
export const VOICES_LIMIT =
  "These sources show that clashes are a known complaint. Whether programmers would use or pay for this has not been tested.";

/**
 * What programmers have said in public: the first three as a ruled list, each voice one item with 20px above and
 * below and a 1px border-border rule between items across the column (none above the first). Each paraphrase is
 * 18px at 1.55, 500 weight, in ink, at most 62ch, with no stripe, mark, italic, indent or quotation marks (they are
 * paraphrases, not words said verbatim, so no quotation mark hangs in the margin). The name and the dated source
 * links sit on their own line under each in 13px muted. Every source link stays in the open. One closed
 * disclosure at the list's foot, named for what it holds, carries any other voices and the sentence that limits
 * what they all show.
 */
function PublicVoices() {
  const shown = PUBLIC_VOICES.slice(0, VOICES_SHOWN);
  const rest = PUBLIC_VOICES.slice(VOICES_SHOWN);
  return (
    <div>
      <h3 className={CONCLUSION}>What programmers have said in public</h3>
      <ul className="mt-1 divide-y divide-border">
        {shown.map((voice) => (
          <li key={voice.who} data-voice className="py-5">
            <p className="max-w-[62ch] text-[1.125rem] leading-[1.55] font-medium text-foreground">{voice.said}</p>
            <p className="mt-2 text-[0.8125rem] leading-snug text-muted-foreground">
              <span className="font-semibold text-foreground">{voice.who}</span>
              {" · "}
              <VoiceLinks voice={voice} />
            </p>
          </li>
        ))}
      </ul>
      <Fold
        className="max-w-[62ch]"
        summary={rest.length > 0 ? `${rest.map((voice) => voice.who).join("; ")}, and what these sources show` : "What these sources show"}
      >
        <div className="pb-3">
          {rest.length > 0 ? (
            <ul className="space-y-2.5 text-sm leading-relaxed">
              {rest.map((voice) => (
                <li key={voice.who} className="max-w-prose">
                  <span className="font-semibold">{voice.who}:</span> {voice.said}{" "}
                  <span className="text-muted-foreground">
                    <VoiceLinks voice={voice} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p data-voices-limit className={cn("text-[0.8125rem] text-muted-foreground", rest.length > 0 && "mt-3")}>
            {VOICES_LIMIT}
          </p>
        </div>
      </Fold>
    </div>
  );
}

/** The taste reading's place in the price, on a published day and on the invented one. */
export const QLOO_PART = "the part Qloo adds";
export const QLOO_PART_INVENTED = "the taste-overlap part";

/**
 * What the failed pre-set test taught us, in its own block: the figure against the bar, that popularity
 * did better, and what that makes the taste reading. It is the last block of the taste section on the
 * home page, always rendered and never inside a disclosure. The AUC figures stay on /method, where AUC
 * is defined; this block links there. Server-rendered.
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
  // Nothing on the invented day credits Qloo, so there the price's fourth part is named for what it is.
  const part =
    synthetic === undefined ? (
      <BySyntheticDay real={QLOO_PART} invented={QLOO_PART_INVENTED} />
    ) : synthetic ? (
      QLOO_PART_INVENTED
    ) : (
      QLOO_PART
    );
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      <h3 className="text-base font-semibold">What the failed test taught us.</h3>
      <div className="mt-2 grid gap-x-8 gap-y-3 lg:grid-cols-2">
        <p className="max-w-prose">
          Our test failed: taste overlap put {formatPct(taste.topQuarterPct)} of complained-about clashes in the top
          quarter of their day, below our {backtest.bar.topQuarterPct}% bar. Popularity, also a Qloo field, did
          better. It reached {formatPct(popularity.topQuarterPct)}. The exploratory follow-up did not establish an
          advantage over popularity.
        </p>
        <p className="max-w-prose">
          So the taste reading is a second opinion beside time and draw: it is one of the four parts of the price of
          each clash, {part}, and never the verdict on its own. It is nearly unrelated to popularity (r ={" "}
          {backtest.popularityCorrelation}).{" "}
          <Link href="/method#tested" className={LINK}>
            How we know
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * What is public about the problem and what is not known, right after the taste section and before the board,
 * open on the paper with no rule above it and no card around it. From 1024px it is a 12-column composition: on
 * the left (5 columns) the problem, its finding set large at 20px with the overlap figure under it, then 48px lower
 * what is not known; on the right (7 columns) the public voices as a ruled list. The columns are not balanced. Under
 * both, the pilot offer is an unboxed block under a top rule, full width; the section has no named surface. Below
 * 1024px it is one column: problem, voices, what is not known, pilot. Each finding
 * opens with its conclusion (an existing heading, 18px semibold); the rest sits in its text toggle. The caveats,
 * the competitor search's "absence of evidence only" (the first line under its heading, at body size, in ink),
 * what is not known, the pilot offer and every source link stay in the open. The complaint counts are read from
 * `METHOD_FIGURES`; the failed test they were scored in is `FailedTestNote`, in the taste section, and the chart
 * is on /method. The voices are linked
 * paraphrases and problem evidence only, printed with the sentence that says so. Server-rendered; nothing here
 * needs JavaScript.
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
      <div className="container-page py-16 lg:py-20">
        <h2 id="why-this-matters-heading" className="type-title">
          Who has complained, and what nobody has tested
        </h2>
        <div className="mt-8 grid items-start gap-y-12 text-[0.9375rem] leading-[1.55] lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-0">
          <div data-why-col="problem" className="min-w-0 lg:col-span-5 lg:row-start-1">
            <h3 className={CONCLUSION}>The problem is public</h3>
            <p data-why-finding className="mt-3 text-xl leading-snug font-medium text-foreground">
              {complaints.clustersVerified} clashes that fans or the press complained about at {complaints.festivals}{" "}
              festivals had a verified overlap in time.
            </p>
            <p data-why-sources className="mt-2">
              {COMPLAINT_SOURCES}
            </p>
            <p data-why-elsewhere className="mt-2 text-muted-foreground">
              {COMPLAINTS_ELSEWHERE}
            </p>
            <ComplaintFigure />
            <Fold
              className="mt-2"
              summary={`${complaints.pairsVerified} pairs, median ${complaints.medianMinutes} minutes, and how the lists lean`}
            >
              <p className="pb-3">Press lists lean toward headliners, which flatters any taste-based method.</p>
            </Fold>
          </div>

          <div data-why-col="voices" className="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1">
            <PublicVoices />
          </div>

          <div data-why-col="unknown" className="min-w-0 lg:col-span-5 lg:col-start-1 lg:row-start-2 lg:mt-12">
            <h3 className={CONCLUSION}>No scheduler we found reads audience overlap</h3>
            <p className="mt-2">
              Our search, October 2026: absence of evidence only. Who would pay is not known.
            </p>
            <p data-payer-guess className="mt-2">
              {PAYER_GUESS}
            </p>
            <Fold className="mt-2" summary="Festival Pro and Lineup Ninja">
              <p className="pb-3">
                Both check double bookings and changeovers. We found none that reads audience overlap (our search,
                October 2026).
              </p>
            </Fold>
            <DemandLine demand={demand} />
          </div>
        </div>
        <div className="mt-12 text-[0.9375rem] leading-[1.55]">
          <PilotOffer contact={contact} terms={terms} />
        </div>
      </div>
    </section>
  );
}
