"use client";

import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { Fragment, useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { dayName, festivalLabel, hostOf, isWebUrl, ordinal, sourceLabel, tagLabel } from "@/lib/clashes";
import { tagsSource, tagsTitle } from "@/lib/credit";
import type { HiddenWallItem, SharedTag } from "@/lib/preset";
import { cn } from "@/lib/utils";

import { DISCLOSURE_SUMMARY_CLASS, DisclosureMark } from "./more-details";

/**
 * The shared-tag list shows this many of the pair's tags below 1024px (one column), then "and N more"; the full list
 * stays in the source details.
 */
export const BRIDGE_TAGS_NARROW = 4;
/** From 1024px the list shows this many tags (two rows of four), then "and N more". */
export const BRIDGE_TAGS_WIDE = 8;

const NO_KIND = "tag";

/**
 * The label over the pair's shared tags: on a published day it names them as audience tags and says where
 * they come from, so they cannot be read as the acts' own genre tags; the invented day keeps its own wording.
 */
export function sharedTagsLabel(synthetic: boolean): string {
  return synthetic ? tagsTitle(true) : "Audience tags in common, from Qloo";
}

/** The pair's tags grouped by their type, in stored order; a tag with no type goes under "Tag". */
export function groupTags(tags: readonly SharedTag[]): { kind: string; tags: SharedTag[] }[] {
  const groups: { kind: string; tags: SharedTag[] }[] = [];
  for (const tag of tags) {
    const kind = tag.kind?.trim() || NO_KIND;
    const group = groups.find((g) => g.kind === kind);
    if (group) group.tags.push(tag);
    else groups.push({ kind, tags: [tag] });
  }
  return groups;
}

/** A tag type's name: Qloo's ids read "urn:tag:<type>:<domain>", so the type is the third part ("Genre", "Theme"). */
export function kindLabel(kind: string): string {
  const parts = kind.split(":");
  const label = tagLabel(kind.startsWith("urn:tag:") && parts.length > 2 ? parts[2] : kind);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** An act's own genre tags as shown: the first four, each as its label. */
function genreTags(genres: readonly string[] | undefined): string[] {
  return genres && genres.length > 0 ? genres.slice(0, 4).map(tagLabel) : [];
}

/** An act's genre tags as one plain string ("Dream Pop, Ambient, Dark Ambient, Slowcore"): the words the run reads as. */
export function genreText(genres: readonly string[] | undefined): string {
  const tags = genreTags(genres);
  return tags.length > 0 ? tags.join(", ") : "no genre tags";
}

/**
 * A run of tags that breaks only between tags: each tag is its own nowrap span carrying its trailing comma, and the
 * spans are joined by plain spaces, so "Dark Ambient" never splits across two lines. Plain text, never chips.
 */
function GenreRun({ genres }: { genres: readonly string[] | undefined }) {
  const tags = genreTags(genres);
  if (tags.length === 0) return <>{genreText(genres)}</>;
  return (
    <>
      {tags.map((tag, i) => (
        <Fragment key={i}>
          {i > 0 ? " " : null}
          <span className="whitespace-nowrap">
            {tag}
            {i < tags.length - 1 ? "," : null}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * The one rounding of a rank, shared by the sentence and its axis: the value clamped to 0 to 1, then the nearest
 * whole percentile. The words and the dot read this same number, so the picture can never disagree with them.
 */
export function rankPercentile(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/**
 * Where the axis's dot centre sits for percentile p: both scale ends are inset by the dot's outer radius (6px of
 * its 12px, halo included), so at 0 the centre is on the first tick, at 100 on the last, and the halo never passes
 * the axis box.
 */
export function rankAxisLeft(p: number): string {
  return `calc(6px + (100% - 12px) * ${p} / 100)`;
}

/**
 * A rank among the day's clashes, in one sentence at body size: the percentile in 15px semibold, then the
 * rest of the phrase as its muted caption ("90th percentile of that day's clashes"). The top pair is
 * printed the same way ("100th percentile"), so the two ranks of a pair read in one notation and can be
 * compared. The scale ("Both ranks run 0 to 100 within that day's clashes") is stated once under the
 * figure. Where a figure draws it, a rank is a position on its 0 to 100 axis (RankAxis), never a fill: a rank
 * is not a quantity to fill.
 */
export function DayRank({ value }: { value: number }) {
  const percentile = ordinal(rankPercentile(value));
  return (
    <span className="block text-[0.9375rem] leading-snug">
      <span className="font-semibold tabular-nums">{percentile} percentile</span>{" "}
      <span data-rank-caption className="text-muted-foreground">
        of that day&rsquo;s clashes
      </span>
    </span>
  );
}

/**
 * A rank as a position, under its DayRank sentence: the site's rank axis (as the why-qloo figure draws it), a 2px
 * border-strong line with 1px by 8px border-strong end ticks, and a 12px ink dot at the percentile the sentence
 * prints, ringed by a 2px halo in the fill it sits on (paper here, card in a printed card). Under the ends its scale,
 * "0" flush with the first tick's left edge and "100" with the last tick's right edge, in 12px muted tabular figures,
 * 4px under the dot's halo so a dot at either end never meets its label. At most 12rem wide. Ink, border-strong and
 * muted only: no fill, no bar, no raspberry. It is a picture of the sentence and nothing more, so the whole axis,
 * scale included, is aria-hidden and holds nothing focusable; the sentence stays the reading. A missing rank gets
 * no axis.
 */
export function RankAxis({ value, halo = "background" }: { value: number; halo?: "background" | "card" }) {
  const p = rankPercentile(value);
  return (
    <div aria-hidden="true" data-rank-axis="" data-p={p} className="mt-2 w-full max-w-48">
      <div className="relative h-3">
        <span className="absolute inset-x-1.5 top-1/2 h-0.5 -translate-y-1/2 bg-border-strong" />
        <span data-axis-end="first" className="absolute top-0.5 left-1.5 h-2 w-px bg-border-strong" />
        <span data-axis-end="last" className="absolute top-0.5 right-1.5 h-2 w-px bg-border-strong" />
        <span
          data-marker=""
          className={cn(
            "absolute top-0 size-3 -translate-x-1/2 rounded-full border-2 bg-foreground",
            halo === "card" ? "border-card" : "border-background",
          )}
          style={{ left: rankAxisLeft(p) }}
        />
      </div>
      <div data-axis-scale="" className="mt-1 flex justify-between px-1.5 font-mono text-xs leading-3 text-muted-foreground tabular-nums">
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  );
}

/** A rank the data does not give, in the same size and weight as a rank it does. */
function NoRank() {
  return <span className="block text-[0.9375rem] leading-snug font-semibold">n/a</span>;
}

/** A sentence-case label over a block: 13px semibold, no caps, no tracking. */
const LABEL = "text-[0.8125rem] leading-5 font-semibold";

/**
 * The time two sets share: the minutes in raspberry tabular figures, then the words. The saved examples carry no set
 * times, only these minutes, so nothing is drawn for them: no set bars, no time axis and no hatch key.
 */
function SharedTimeStrip({ minutes, className }: { minutes: number | null; className?: string }) {
  if (!minutes) return null;
  return (
    <p data-shared-minutes className={cn("text-sm leading-snug", className)}>
      <span className="font-mono text-primary tabular-nums">{minutes} min</span> at the same time
    </p>
  );
}

/** A 6px ink dot, drawn as a pseudo-element at a connector's end: the dots make a line read as a connector, not a rule. */
const DOT =
  "before:absolute before:size-1.5 before:rounded-full before:bg-foreground before:content-[''] after:absolute after:size-1.5 after:rounded-full after:bg-foreground after:content-['']";

/**
 * The connectors of the comparison: 1.5px ink lines with round caps (capsules) and a 6px ink dot at each end, ink
 * only. From 1024px each side of the label is ONE horizontal element, from 12px after the act's name to 12px before
 * the label (in the name's row), its dots inside its ends so the 12px clearances hold.
 */
const DESK_CONNECTOR = cn(
  "relative hidden h-[1.5px] min-w-6 flex-1 rounded-bar bg-foreground lg:block",
  DOT,
  "before:top-1/2 before:left-0 before:-translate-y-1/2 after:top-1/2 after:right-0 after:-translate-y-1/2",
);

/**
 * Below 1024px the same connector turned vertical: a 24px 1.5px ink line, 8px clear of the text above and below,
 * its dots inside its top and bottom ends. Its centre sits 3px in from the text edge, so the dots' left edges are on
 * the text's own left edge.
 */
const PHONE_CONNECTOR = cn(
  "relative my-2 ml-[2.25px] h-6 w-[1.5px] shrink-0 rounded-bar bg-foreground lg:hidden",
  DOT,
  "before:top-0 before:left-1/2 before:-translate-x-1/2 after:bottom-0 after:left-1/2 after:-translate-x-1/2",
);

/**
 * One act's name in the title face, with its connector to the audience tags. From 1024px it sits at its end of the
 * comparison's first row, the connector running to the label, act B flush right. Below 1024px the bridge is turned
 * vertical on the text's left edge: act A's name with its connector under it, act B's name with its connector over
 * it, so the two names hold the label and the tags between them.
 */
function ActName({ name, side }: { name: string; side: "start" | "end" }) {
  const end = side === "end";
  const desk = <span aria-hidden="true" data-connector className={DESK_CONNECTOR} />;
  const phone = <span aria-hidden="true" data-connector-phone className={PHONE_CONNECTOR} />;
  return (
    <div
      data-act-name={side}
      className={cn(
        "flex min-w-0 flex-col items-start lg:min-h-8 lg:flex-1 lg:flex-row lg:items-center lg:gap-3",
        end ? "lg:order-3 lg:justify-end lg:text-right" : "lg:order-1",
      )}
    >
      {end ? phone : null}
      {end ? desk : null}
      <p className="type-title max-w-full min-w-0 break-words [hyphens:auto]">{name}</p>
      {end ? null : desk}
      {end ? null : phone}
    </div>
  );
}

/**
 * One act's own genre tags under a 12.5px muted "Genre tags" label. Below 1024px the two blocks sit side by side
 * under the bridge, each introduced by its act's name in 15px semibold ink; from 1024px each sits in the
 * comparison's second row, under the name (act B flush right), and the name above it says whose tags they are.
 */
function ActGenres({ name, genres, side }: { name: string; genres: readonly string[] | undefined; side: "start" | "end" }) {
  const end = side === "end";
  return (
    <div
      data-act-genres={side}
      className={cn("min-w-0 lg:flex-1 lg:self-start", end ? "lg:order-7 lg:pl-6 lg:text-right" : "lg:order-5 lg:pr-6")}
    >
      <p data-act-intro className="text-[0.9375rem] leading-6 font-semibold text-foreground lg:hidden">
        {name}
      </p>
      <p className="mt-1 text-[0.78125rem] leading-4 font-semibold text-muted-foreground lg:mt-2">Genre tags</p>
      <p data-genre-run className="mt-0.5 text-[0.8125rem] leading-snug text-balance text-foreground">
        <GenreRun genres={genres} />
      </p>
    </div>
  );
}

/**
 * The tag list from 1024px: its width is its content's, centred between the two genre columns (which share the rest
 * equally), so its centre is the label's.
 */
const WIDE_LIST = "lg:order-6 lg:shrink-0 lg:self-start";

/**
 * From 1024px the list's tray: a 1px decorative rule above and below at the list's own width, 12px clear of the
 * tags, with no fill, no side edge and no corner. Below 1024px the bridge's connectors hold the tags instead.
 */
const WIDE_TRAY = "lg:mt-0 lg:border-y lg:border-border lg:py-3";

/** From 1024px the list's columns: four, each as wide as its widest tag. */
const WIDE_COLUMNS = 4;

/**
 * From 1024px, the cells of an incomplete last row of the list, so the row sits centred under the full ones: one tag
 * spans all four columns, two tags two each, and three tags take the first column, the middle two and the last.
 */
function wideTailClass(position: number, tail: number): string | null {
  if (tail === 1) return "lg:col-span-4";
  if (tail === 2) return "lg:col-span-2";
  if (tail === 3) return position === 1 ? "lg:col-span-2" : position === 2 ? "lg:col-start-4" : null;
  return null;
}

/**
 * The tags the pair's audiences share, in 15px medium ink. No commas, no middots and no chips. Below 1024px the block
 * is the middle of the vertical bridge, on the one text edge, on paper with no tray: the label, then the first four
 * tags in two columns, then "and N more" as a 44px text action under them. From 1024px the block steps aside
 * (`display: contents`): the label sits between the two names in the first row, 12px clear of each connector, and the
 * list is centred under it in the second row, in a ruled tray (a 1px decorative rule above and below, at the list's
 * own width, 12px clear of the tags; no fill, no sides, no corner), as one compact block of four columns, each as wide
 * as its widest tag, 32px apart; no tag wraps, and an incomplete last row is centred. Up to eight show there, then
 * "and N more" in its own centred 44px row inside the tray's bottom rule.
 * Collapsed tags are hidden by class, never removed, so one button serves both widths: it carries one count per
 * breakpoint, and one click shows the full list the label counts. The label names them as audience tags and says
 * where they come from and how many there are, so they cannot be read as the acts' own genre tags (which have none
 * in common). It is teal on a published day, where the tags came from Qloo, and ink on the invented day, which
 * credits nothing to Qloo.
 */
export function SharedTags({
  tags,
  synthetic,
  initiallyExpanded = false,
}: {
  tags: readonly SharedTag[];
  synthetic: boolean;
  /** For the tests, which render without a click: start with every tag shown. */
  initiallyExpanded?: boolean;
}) {
  const labelId = `shared-tags-${useId().replace(/:/g, "")}`;
  const listId = `${labelId}-list`;
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const total = tags.length;
  const moreNarrow = total - BRIDGE_TAGS_NARROW;
  const moreWide = total - BRIDGE_TAGS_WIDE;
  // From 1024px: how many tags show, and where the last, incomplete row of four starts.
  const shownWide = expanded ? total : Math.min(total, BRIDGE_TAGS_WIDE);
  const tail = shownWide % WIDE_COLUMNS;
  const tailStart = shownWide - tail;
  return (
    <div data-shared-block className="min-w-0 lg:contents">
      <p
        id={labelId}
        data-shared-label
        className={cn(
          LABEL,
          synthetic ? "text-foreground" : "text-prov-qloo",
          "lg:order-2 lg:mx-3 lg:flex lg:min-h-8 lg:max-w-[45%] lg:shrink-0 lg:items-center lg:justify-center lg:text-center",
        )}
      >
        <span>
          {sharedTagsLabel(synthetic)}
          {total > 0 ? (
            <>
              : <span className="font-mono tabular-nums">{total}</span>
            </>
          ) : null}
        </span>
      </p>
      {total > 0 ? (
        <div data-shared-list className={cn("mt-2 min-w-0", WIDE_LIST, WIDE_TRAY)}>
          <ul
            id={listId}
            aria-labelledby={labelId}
            data-shared-tags
            className="grid grid-cols-2 gap-x-6 gap-y-1 text-[0.9375rem] leading-6 font-medium text-foreground lg:grid-cols-[repeat(4,max-content)] lg:justify-center lg:gap-x-8"
          >
            {tags.map((tag, i) => (
              <li
                key={tag.name}
                className={cn(
                  "min-w-0 break-words lg:text-center lg:whitespace-nowrap",
                  !expanded && i >= BRIDGE_TAGS_NARROW && "max-lg:hidden",
                  !expanded && i >= BRIDGE_TAGS_WIDE && "lg:hidden",
                  i >= tailStart && i < shownWide && wideTailClass(i - tailStart, tail),
                )}
              >
                {tagLabel(tag.name)}
              </li>
            ))}
          </ul>
          {moreNarrow > 0 ? (
            <>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((open) => !open)}
                className={cn(
                  "inline-flex min-h-11 w-fit items-center rounded-sm text-left text-[0.9375rem] leading-6 font-semibold text-foreground underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  moreWide > 0 ? "lg:mx-auto lg:flex" : "lg:hidden",
                )}
              >
                {expanded ? (
                  "Show fewer"
                ) : (
                  <>
                    <span data-more="narrow" className="lg:hidden">
                      and <span className="font-mono tabular-nums">{moreNarrow}</span> more
                    </span>
                    {moreWide > 0 ? (
                      <span data-more="wide" className="max-lg:hidden">
                        and <span className="font-mono tabular-nums">{moreWide}</span> more
                      </span>
                    ) : null}
                  </>
                )}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <p className={cn("mt-2 text-[0.8125rem] text-muted-foreground lg:px-6 lg:text-center", WIDE_LIST)}>
          No tags saved for this pair.
        </p>
      )}
    </div>
  );
}

/** The pair's two ranks as words, each with its position on the rank axis (never a bar), and its press link. */
function PairFacts({ item, badge }: { item: HiddenWallItem; badge?: ReactNode }) {
  const source = isWebUrl(item.source) ? item.source : null;
  return (
    <div data-pair-facts>
      <dl className="grid grid-cols-2 gap-x-6">
        <div>
          <dt className={cn(LABEL, "text-muted-foreground")}>Taste overlap rank</dt>
          <dd className="mt-1.5">
            <DayRank value={item.overlap_pct} />
            <RankAxis value={item.overlap_pct} />
          </dd>
        </div>
        <div>
          <dt className={cn(LABEL, "text-muted-foreground")}>Draw rank</dt>
          <dd className="mt-1.5">
            {item.draw_pct !== null ? (
              <>
                <DayRank value={item.draw_pct} />
                <RankAxis value={item.draw_pct} />
              </>
            ) : (
              <NoRank />
            )}
          </dd>
        </div>
      </dl>
      {/* The source line, with the Recorded stamp at its end: the stamp says how that source's data was kept. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[0.8125rem]">
        {source ? (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-6 items-center gap-1 rounded-sm font-semibold text-foreground underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground"
          >
            {sourceLabel(source)}: {hostOf(source)}
            <ExternalLink aria-hidden="true" className="size-3" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <span className="text-muted-foreground">No press link saved.</span>
        )}
        {badge ? <span className="flex items-center">{badge}</span> : null}
      </div>
    </div>
  );
}

/** The pair's full tag inventory for the source details: every tag, the count per type, and the credit. */
function PairTagDetails({
  groups,
  flat,
  synthetic,
}: {
  groups: { kind: string; tags: SharedTag[] }[];
  flat: readonly SharedTag[];
  synthetic: boolean;
}) {
  return (
    <>
      <p className="text-[0.8125rem] font-semibold leading-[1.19]">{tagsTitle(synthetic)}</p>
      <p className="mt-1 text-[0.8125rem] leading-[1.19]">{flat.map((t) => tagLabel(t.name)).join(", ")}</p>
      {groups.length > 1 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] leading-5 text-muted-foreground" aria-label="Tag types">
          {groups.map((group) => (
            <li key={group.kind}>
              {kindLabel(group.kind)} <span className="font-mono tabular-nums">({group.tags.length})</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-[0.8125rem] leading-[1.19] text-muted-foreground">{tagsSource(synthetic)}</p>
    </>
  );
}

/**
 * Previous and Next: text-glyph buttons, an 18px ink arrow in a 44px hit area, with no edge, no fill and no
 * visible box; the page's own focus outline marks keyboard focus. At either end the button stays focusable
 * (aria-disabled, not disabled), so a keyboard visitor never loses focus to the page, and its arrow turns muted.
 */
const NAV_BUTTON =
  "group/nav inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-foreground aria-disabled:cursor-default aria-disabled:text-muted-foreground";

/** The arrow inside a live Previous or Next: on hover a 1px border-strong underline, 4px under the glyph. */
const NAV_GLYPH_LIVE =
  "after:absolute after:inset-x-0 after:top-[calc(100%+0.25rem)] after:hidden after:h-px after:bg-border-strong after:content-[''] group-hover/nav:after:block";

/**
 * The pair a key on the pager row moves to: ArrowRight (or ArrowDown) the next, wrapping to the first;
 * ArrowLeft (or ArrowUp) the previous, wrapping to the last; Home the first; End the last; -1 for any other key.
 */
export function pairKeyTarget(key: string, index: number, last: number): number {
  if (key === "ArrowRight" || key === "ArrowDown") return index === last ? 0 : index + 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return index === 0 ? last : index - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  return -1;
}

/**
 * The hidden-clash examples, one pair at a time, as an open exhibit on the page's paper: one 1px decorative rule
 * along its top and nothing else (no corner, no side edge, no fill), its text starting at the column's own left
 * edge, as the hero receipt is drawn. One row leads it: the dateline at the left and, from 640px, the pager at the
 * right edge (Previous, the tabular "1 of 8", Next); below 640px the pager is its own row under the dateline, its
 * Previous arrow on the dateline's x. The pair's names are not repeated in the row: they are printed large directly
 * below. The arrow keys, Home and End move between pairs from either button; a visually hidden live label, "Pair 1
 * of 8: A and B", is announced when the pair changes. The markup runs in reading order: the comparison (the two
 * names holding the audience tags in common between them, then each act's own genre tags), the finding with the
 * caveat that qualifies it, the ranks and their provenance, then the exhibit's closing line. Below 1024px that is
 * also the page's order, on one left edge: the bridge turned vertical (act A's name, a connector, the label and the
 * first four tags in two columns, a connector, act B's name), the two acts' genre tags side by side, the finding,
 * the ranks, the source details, then the closing line. From 1024px the comparison is placed as the bridge draws it:
 * act A's name, the audience-tags label centred, act B's name flush right, with one 1.5px ink connector each side
 * running from 12px after the name to 12px before the label; under them act A's genre tags, the tags in common in
 * their ruled tray, and act B's genre tags; below, in two halves on one top line, the finding with the shared
 * minutes and the ranks; then the closing line across the full width. Focus follows the page at both widths.
 * `badge` sits at the end of the source line. `aside` sits in the finding's column under the shared minutes;
 * `notes` closes the source details; `closing` ends the exhibit on screen, after the source details below 1024px
 * and under both halves from 1024px, never in a disclosure. `footnote` is for paper only, since paper cannot
 * switch pairs or open a disclosure.
 */
export function TasteRing({
  items,
  synthetic = false,
  badge,
  aside,
  notes,
  closing,
  footnote,
}: {
  items: readonly HiddenWallItem[];
  synthetic?: boolean;
  badge?: ReactNode;
  aside?: ReactNode;
  notes?: ReactNode;
  closing?: ReactNode;
  footnote?: ReactNode;
}) {
  const pairs = items;
  const [selected, setSelected] = useState(0);
  // Set once the visitor changes the pair. The panel fades in only then (`.cc-ring-lens[data-picked]` in
  // globals.css), so the first paint and every mount show it at rest, with no motion.
  const [picked, setPicked] = useState(false);
  const labelId = `ring-label-${useId().replace(/:/g, "")}`;
  const count = pairs.length;
  const index = Math.min(selected, Math.max(count - 1, 0));

  if (count === 0) return null;

  const pair = pairs[index];
  const [a, b] = pair.acts;
  const groups = groupTags(pair.shared_tags);
  const flat = groups.flatMap((g) => g.tags);
  const last = count - 1;

  /** Show pair `to`, marking the panel as the visitor's choice when the pair changes, so the new pair fades in. */
  function pick(to: number) {
    if (to === index) return;
    setPicked(true);
    setSelected(to);
  }

  function onKey(event: KeyboardEvent) {
    const to = pairKeyTarget(event.key, index, last);
    if (to < 0) return;
    event.preventDefault();
    pick(to);
  }

  /** Previous and Next stop at the ends; there the button says so (aria-disabled) and keeps focus. */
  function step(by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to > last) return;
    pick(to);
  }

  const where = `${festivalLabel(pair.festival)}${pair.day ? `, ${dayName(pair.day)}` : ""}`;

  return (
    <div className="cc-ring mt-8">
      {/* The hidden-clash exhibit: the pager and the comparison, open on paper under one top rule. On paper only
          the footnote prints. */}
      <div data-ring-card className="border-t border-border pt-5 sm:pt-6 print:hidden">
        <div data-ring-head className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between sm:gap-x-6">
          <p data-ring-dateline className="min-w-0 text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
            {where}
          </p>
          {/* The pager is set on its glyphs' edges: each 44px hit area reaches 13px (its 18px arrow's inset) past
              the exhibit's text edge, inside the page's side padding. */}
          <div
            data-pair-nav
            role="group"
            aria-label="Example pairs. Use the arrow keys or Previous and Next to see another pair."
            onKeyDown={onKey}
            className="flex shrink-0 items-center gap-x-2 print:hidden max-sm:-ml-[0.8125rem] sm:-mr-[0.8125rem]"
          >
            {count > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Previous pair"
                  aria-controls="ring-panel"
                  aria-disabled={index === 0 ? true : undefined}
                  className={NAV_BUTTON}
                  onClick={() => step(-1)}
                >
                  <span className={cn("relative inline-flex", index !== 0 && NAV_GLYPH_LIVE)}>
                    <ArrowLeft aria-hidden="true" className="size-4.5" />
                  </span>
                </button>
                <span
                  aria-hidden="true"
                  data-pair-count
                  className="font-mono text-[0.8125rem] whitespace-nowrap text-foreground tabular-nums"
                >
                  {index + 1} of {count}
                </span>
                <button
                  type="button"
                  aria-label="Next pair"
                  aria-controls="ring-panel"
                  aria-disabled={index === last ? true : undefined}
                  className={NAV_BUTTON}
                  onClick={() => step(1)}
                >
                  <span className={cn("relative inline-flex", index !== last && NAV_GLYPH_LIVE)}>
                    <ArrowRight aria-hidden="true" className="size-4.5" />
                  </span>
                </button>
              </>
            ) : null}
            {/* The live label: "Pair 1 of 8: A and B", for screen readers only; the names show large below. */}
            <p id={labelId} aria-live="polite" aria-atomic="true" className="sr-only">
              {`Pair ${index + 1} of ${count}: ${a} and ${b}`}
            </p>
          </div>
        </div>

        <div id="ring-panel" role="group" aria-labelledby={labelId} className="print:hidden">
          <h3 className="sr-only">
            {a} and {b}
          </h3>

          {/* The comparison, then its conclusion, in that order in the markup, so a phone reads the bridge and the
              tags it rests on before the finding, and focus follows the page. From 1024px one wrapping flex row places
              them as the bridge draws them: act A's name, the audience-tags label and act B's name (order 1 to 3), a
              full-width break (4), each act's genre tags either side of the list (5 to 7), then the finding and the
              ranks (8) and the closing line (9). */}
          <div
            key={`pair-${index}`}
            data-ring-body
            data-picked={picked ? "" : undefined}
            className="cc-ring-lens mt-2 min-w-0 sm:mt-0 lg:mt-1 lg:flex lg:flex-row lg:flex-wrap lg:items-center"
          >
            {/* The comparison: the bridge (the names, the connectors, the label and the tags in common), then each
                act's own genre tags. Below 1024px it runs top to bottom; from 1024px its parts step into the rows
                (display: contents). */}
            <figure
              data-ring-inventory
              aria-label={`${a} and ${b}: each act's own genre tags, and the tags their audiences share`}
              className="min-w-0 lg:contents"
            >
              <ActName name={a} side="start" />
              <SharedTags tags={flat} synthetic={synthetic} />
              <ActName name={b} side="end" />
              <div data-act-genres-row className="mt-6 grid grid-cols-2 gap-x-6 lg:contents">
                <ActGenres name={a} genres={pair.genres[0]} side="start" />
                <ActGenres name={b} genres={pair.genres[1]} side="end" />
              </div>
            </figure>
            {/* From 1024px: ends the first row (names and label), so the genre tags and the list start the second. */}
            <span aria-hidden="true" data-row-break className="hidden lg:order-4 lg:block lg:h-0 lg:basis-full" />

            {/* The finding and the ranks, in two halves on one top line from 1024px. */}
            <div
              data-ring-findings
              className="mt-6 grid min-w-0 gap-x-12 gap-y-6 lg:order-8 lg:mt-8 lg:basis-full lg:grid-cols-2 lg:items-start"
            >
              <div className="min-w-0">
                <p className="text-lg leading-snug font-semibold">
                  No genre tag in common.{" "}
                  <span className="block text-[0.8125rem] font-normal text-muted-foreground">
                    {synthetic
                      ? "Compared on each act’s own genre tags."
                      : "Compared on each act’s own genre tags; the audience tags come from Qloo."}
                  </span>
                </p>
                <SharedTimeStrip minutes={pair.overlap_min} className="mt-3" />
                {aside ? (
                  <div data-ring-aside className="mt-3 min-w-0">
                    {aside}
                  </div>
                ) : null}
              </div>
              <div className="min-w-0">
                <PairFacts item={pair} badge={badge} />
                {groups.length > 0 || notes ? (
                  // Directly under the press line, with no rule of its own: the ranks, the press link, Recorded and
                  // these details read as one group.
                  <details data-ring-source className="group mt-3">
                    <summary className={cn(DISCLOSURE_SUMMARY_CLASS, "text-[0.8125rem]")}>
                      {groups.length === 0 ? "Notes on the ranks" : synthetic ? "Tag details" : "Qloo source details"}
                      <DisclosureMark />
                    </summary>
                    <div className="pb-3">
                      {groups.length > 0 ? <PairTagDetails groups={groups} flat={flat} synthetic={synthetic} /> : null}
                      {notes ? (
                        <div data-ring-notes className={cn(groups.length > 0 && "mt-3")}>
                          {notes}
                        </div>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>

            {/* The exhibit's closing line, for every pair: below 1024px directly after the source details (outside
                them), from 1024px across the full width under both halves. */}
            {closing ? (
              <div data-ring-closing className="mt-3 min-w-0 lg:order-9 lg:mt-2.5 lg:basis-full">
                {closing}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* For paper only: the count and the caveats for every example, since a printout cannot switch pairs
          or open the source details. On screen the caveat sits beside the finding, the count closes the exhibit
          and the rest closes the source details. */}
      {footnote ? (
        <div data-ring-footnote className="hidden min-w-0 print:block">
          {footnote}
        </div>
      ) : null}
    </div>
  );
}
