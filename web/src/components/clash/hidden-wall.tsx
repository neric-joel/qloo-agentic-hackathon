import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { ProvenanceChip } from "@/components/kernel";
import {
  BROAD_TAGS_NOTE,
  dayName,
  festivalLabel,
  hostOf,
  isWebUrl,
  sourceLabel,
  tagLabel,
} from "@/lib/clashes";
import { tagsTitle } from "@/lib/credit";
import { pluralize } from "@/lib/format";
import type { Evidence, HiddenWallItem, SharedTag } from "@/lib/preset";
import { watchReveal } from "@/lib/use-in-view";
import { cn } from "@/lib/utils";

import { DiamondGlyph } from "./marks";
import { DayRank, RankAxis, TasteRing } from "./taste-ring";

function GenreLine({ act, genres }: { act: string; genres: readonly string[] }) {
  return (
    <p className="text-xs leading-relaxed">
      <span className="font-semibold">{act}:</span>{" "}
      <span className="text-muted-foreground">
        {genres.length > 0 ? genres.slice(0, 4).map(tagLabel).join(", ") : "no genre tags"}
      </span>
    </p>
  );
}

/** Every one of the pair's tags, in the order they are stored (Qloo's score, highest first). */
function TagChips({ tags, className }: { tags: readonly SharedTag[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.map((tag) => (
        <li key={tag.name} className="tag max-w-full leading-tight whitespace-normal text-foreground">
          {tagLabel(tag.name)}
        </li>
      ))}
    </ul>
  );
}

/** The pair's tags, all of them, printed directly on the card. A pair with no tags prints nothing. */
function WallTags({ tags, synthetic }: { tags: readonly SharedTag[]; synthetic: boolean }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold">{tagsTitle(synthetic)}</p>
      <TagChips tags={tags} className="mt-1.5" />
    </div>
  );
}

/** Cards that start in the same frame are staggered by this, up to the fifth. */
const CARD_STAGGER_MS = 80;
const CARD_STAGGER_MAX = 4;

/**
 * M8, once per card the first time it scrolls into view: the corner mark pops, then "No genre tag in
 * common." firms up. It writes `data-reveal` on the card itself, so
 * nothing re-renders; a card on screen at load, in print or under reduced motion stays as drawn.
 */
function revealCard(card: HTMLLIElement | null): (() => void) | void {
  if (!card) return;
  return watchReveal(card, {
    threshold: 0.5,
    onPhase: (phase, order) => {
      if (phase === "still") {
        delete card.dataset.reveal;
        return;
      }
      card.style.setProperty("--reveal-delay", `${Math.min(order, CARD_STAGGER_MAX) * CARD_STAGGER_MS}ms`);
      card.dataset.reveal = phase;
    },
  });
}

function WallCard({ item, synthetic }: { item: HiddenWallItem; synthetic: boolean }) {
  const [a, b] = item.acts;
  const source = isWebUrl(item.source) ? item.source : null;
  return (
    <li ref={revealCard} className="flex flex-col rounded-lg border border-surface-edge bg-card">
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
            {festivalLabel(item.festival)}
            {item.day ? `, ${dayName(item.day)}` : ""}
          </p>
          <DiamondGlyph className="cc-wall-gem size-3.5 shrink-0" />
        </div>
        <h3 className="type-title mt-2 break-words">
          {a} <span className="text-muted-foreground">&times;</span> {b}
        </h3>
        <div className="mt-3 space-y-1">
          <GenreLine act={a} genres={item.genres[0]} />
          <GenreLine act={b} genres={item.genres[1]} />
        </div>
        <p className="cc-wall-note mt-2 text-xs font-semibold">No genre tag in common.</p>
      </div>

      {/* The card's one divider: a 1px hairline inset 16px from its edges. */}
      <div className="mx-4 border-t border-border" aria-hidden="true" />

      <div className="flex flex-1 flex-col p-4">
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Taste overlap rank</dt>
            <dd className="mt-1">
              <DayRank value={item.overlap_pct} />
              <RankAxis value={item.overlap_pct} halo="card" />
            </dd>
          </div>
          <div>
            <dt className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Draw rank</dt>
            <dd className="mt-1">
              {item.draw_pct !== null ? (
                <>
                  <DayRank value={item.draw_pct} />
                  <RankAxis value={item.draw_pct} halo="card" />
                </>
              ) : (
                <span className="block text-[0.9375rem] leading-snug font-semibold">n/a</span>
              )}
            </dd>
          </div>
        </dl>
        {item.overlap_min ? (
          <p className="mt-2 text-[0.8125rem] text-muted-foreground">
            <span className="font-mono tabular-nums">{item.overlap_min} min</span> at the same time.
          </p>
        ) : null}

        <WallTags tags={item.shared_tags} synthetic={synthetic} />

        <p className="mt-auto pt-3 text-xs">
          {source ? (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-foreground underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground"
            >
              {sourceLabel(source)}: {hostOf(source)}
              <ExternalLink aria-hidden="true" className="size-3" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <span className="text-muted-foreground">No press link saved.</span>
          )}
        </p>
      </div>
    </li>
  );
}

/**
 * Every example as a printed card, for paper only: on screen the taste figure's one switcher carries every
 * pair, and a printout cannot switch, so each pair prints with its ranks, tags and source.
 */
function WallGrid({
  items,
  synthetic,
  className,
}: {
  items: readonly HiddenWallItem[];
  synthetic: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {items.map((item) => (
        <WallCard key={`${item.festival}-${item.acts.join("|")}`} item={item} synthetic={synthetic} />
      ))}
    </ul>
  );
}

/**
 * The wall's count line: how many sourced examples it shows, and that the rest were not saved. With
 * `savedWith`, the examples were borrowed from another festival day (this day has none of its own), and
 * the line names that day.
 */
export function wallCount(shown: number, total: number, savedWith: string | null = null): string {
  if (savedWith) return borrowedCount(shown, total, savedWith);
  if (shown >= total) return pluralize(shown, "sourced example");
  const rest = total - shown;
  return (
    `Showing ${shown} of ${total} sourced examples. ` +
    (rest === 1 ? "The other one is not saved with this day." : `The other ${rest} are not saved with this day.`)
  );
}

/** The count line for another day's examples: the same count, naming the day they are saved with. */
function borrowedCount(shown: number, total: number, savedWith: string): string {
  if (shown >= total) return `${pluralize(shown, "sourced example")}, saved with ${savedWith}`;
  const rest = total - shown;
  return (
    `Showing ${shown} of ${total} sourced examples, saved with ${savedWith}. ` +
    (rest === 1 ? "The other one is not saved with that day." : `The other ${rest} are not saved with that day.`)
  );
}

/** The wall's caveats, word for word wherever they are set. */
const NOT_A_TEST = "These are examples with their sources, not a test of how well the measure spots such clashes.";
const RANK_SCALE = "Both ranks run 0 to 100 within that day’s clashes, not on the timetable’s draw scale.";

/**
 * The board's Hidden label, defined once and true to `clash_label` in backend/app/schedule/metrics.py: the
 * two acts' main genre tags differ and their taste overlap is at or above the 90th percentile of every
 * pair of priced acts on the bill.
 */
export const HIDDEN_DEFINITION =
  "On the timetable, Hidden means the acts’ main genre tags differ while their taste overlap is among the day’s highest (the top tenth of the bill’s priced pairs).";

/** The sourced examples go further than the label: no genre tag in common at all, and called out in public. */
export const WALL_LEAD =
  "The sourced examples below go further: pairs the press or fans called out that have no genre tag in common, yet their taste overlap is among the highest of that day.";

/** Where /method gives the complaint rate for pairs like the examples (a different population from the label). */
export const LIMITS_LINK = { href: "/method#limits", label: "How often such pairs drew complaints" } as const;

/** The day's own Hidden-labelled clashes, as the board ranks them. */
export type HiddenDay = {
  /** How many clashes the day ranks in all. */
  ranked: number;
  /** The ranked clashes that carry the Hidden label, costliest first. */
  hidden: readonly { rank: number; a: string; b: string }[];
};

/** At most this many Hidden pairs are named in the day line; more are given as a count. */
const NAMED_MAX = 2;

/**
 * How many of the day's ranked clashes carry the Hidden label, as a base rate beside the definition:
 * "On this day, 5 of the 15 ranked clashes carry the Hidden label.", naming one or two pairs with their
 * rank, or "No clash on this day carries the Hidden label."
 */
export function hiddenDayLine(day: HiddenDay): string {
  const count = day.hidden.length;
  if (count === 0) return "No clash on this day carries the Hidden label.";
  const of = `On this day, ${count} of the ${day.ranked} ranked clashes ${count === 1 ? "carries" : "carry"} the Hidden label`;
  if (count > NAMED_MAX) return `${of}.`;
  const names = day.hidden.map((pair) => `${pair.a} × ${pair.b} (#${pair.rank})`).join(" and ");
  return `${of}: ${names}.`;
}

/**
 * The Hidden clashes section: the board's definition of the label and how many of the day's ranked
 * clashes carry it, then sourced examples of hidden clashes, pairs the press or fans called out where
 * the two acts share no genre tag but their taste overlap is among the highest of that day. Shown as
 * examples with their sources, not as proof that the measure detects such clashes. A day with no
 * examples of its own can show another day's (`savedWith` names that day). With neither the examples
 * nor the day's line there is nothing to show, and no section.
 */
export function HiddenWall({
  evidence,
  synthetic = false,
  day = null,
  savedWith = null,
}: {
  evidence: Evidence | null;
  synthetic?: boolean;
  /** The day's Hidden-labelled clashes, from the same ranked list the board draws. */
  day?: HiddenDay | null;
  /** The festival day the examples are saved with, when it is not the day on show. */
  savedWith?: string | null;
}) {
  const items = evidence?.hidden_wall ?? [];
  if (items.length === 0 && day === null) return null;
  const total = evidence?.hidden_wall_total ?? items.length;
  return (
    <section id="hidden-wall" aria-labelledby="hidden-wall-heading">
      {/* The exhibit ends on its own last line: the bottom padding is shorter than the page's other sections, so
          no dead band opens before the next heading (whose own top padding still sets the gap). */}
      <div className="container-page pt-16 pb-10 lg:pt-20 lg:pb-12">
        <h2 id="hidden-wall-heading" className="type-title">
          {/* Every wall item is a called-out pair with no genre tag in common: the build keeps only those. */}
          {items.length > 0
            ? `Hidden clashes: ${pluralize(items.length, "called-out pair")} with no genre tag in common`
            : "Hidden clashes"}
        </h2>
        {/* The label's definition and the day's count first, then the examples' own rule and, after it, the link
            to the complaint rate for pairs like the examples: an inline text action whose 12px of padding above
            and below gives it a 44px hit area without opening the line. */}
        {/* From 1024px the two sit side by side, each at a readable measure, so the intro stays four lines. */}
        <div className="mt-2 grid max-w-[70ch] gap-y-2 text-[0.9375rem] leading-[1.55] lg:max-w-none lg:grid-cols-2 lg:gap-x-12">
          {day ? (
            <p data-hidden-definition="">
              {HIDDEN_DEFINITION} {hiddenDayLine(day)}
            </p>
          ) : null}
          {items.length > 0 ? (
            <p>
              {WALL_LEAD}{" "}
              <Link
                href={LIMITS_LINK.href}
                className="rounded-sm py-3 font-semibold text-foreground underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring print:no-underline"
              >
                {LIMITS_LINK.label}
              </Link>
            </p>
          ) : null}
        </div>

        {/* The caveat that qualifies the finding sits in the finding's column, under the shared-minutes key; the
            count closes the exhibit (after the source details below 1024px, across both halves from 1024px); the
            rank scale and the broad-tags note close the pair's source details, word for word. On paper the
            switcher is left out and the whole caveat prints in one block, above every example as a card. */}
        {items.length > 0 ? (
          <>
            <TasteRing
              items={items}
              synthetic={synthetic}
              badge={<ProvenanceChip provenance="recorded" size="sm" synthetic={synthetic} />}
              aside={<p className="max-w-[60ch] text-[0.8125rem] leading-relaxed text-muted-foreground">{NOT_A_TEST}</p>}
              closing={<p className="text-[0.8125rem] leading-relaxed font-medium text-muted-foreground">{wallCount(items.length, total, savedWith)}</p>}
              notes={
                <p data-wall-notes className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                  {RANK_SCALE} {BROAD_TAGS_NOTE}
                </p>
              }
              footnote={
                <div className="max-w-[90ch] space-y-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
                  <p className="font-medium">{wallCount(items.length, total, savedWith)}</p>
                  <p className="text-muted-foreground">
                    {NOT_A_TEST} {RANK_SCALE} {BROAD_TAGS_NOTE}
                  </p>
                </div>
              }
            />
            <WallGrid items={items} synthetic={synthetic} className="mt-6 hidden print:grid" />
          </>
        ) : null}
      </div>
    </section>
  );
}
