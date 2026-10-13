import { ExternalLink } from "lucide-react";

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

/** The wall's count line: how many sourced examples it shows, and that the rest were not saved. */
export function wallCount(shown: number, total: number): string {
  if (shown >= total) return pluralize(shown, "sourced example");
  const rest = total - shown;
  return (
    `Showing ${shown} of ${total} sourced examples. ` +
    (rest === 1 ? "The other one is not saved with this day." : `The other ${rest} are not saved with this day.`)
  );
}

/** The wall's caveats, word for word wherever they are set. */
const NOT_A_TEST = "These are examples with their sources, not a test of how well the measure spots such clashes.";
const RANK_SCALE = "Both ranks run 0 to 100 within that day’s clashes, not on the timetable’s draw scale.";

/**
 * Sourced examples of hidden clashes: pairs the press or fans called out where the two acts share
 * no genre tag but their taste overlap is among the highest of that day. Shown as examples with
 * their sources, not as proof that the measure detects such clashes.
 */
export function HiddenWall({ evidence, synthetic = false }: { evidence: Evidence | null; synthetic?: boolean }) {
  const items = evidence?.hidden_wall ?? [];
  // A day with no sourced examples has nothing to show: the section, its link and its nav entry stay out.
  if (items.length === 0) return null;
  const total = evidence?.hidden_wall_total ?? items.length;
  return (
    <section id="hidden-wall" aria-labelledby="hidden-wall-heading">
      {/* The exhibit ends on its own last line: the bottom padding is shorter than the page's other sections, so
          no dead band opens before the next heading (whose own top padding still sets the gap). */}
      <div className="container-page pt-16 pb-10 lg:pt-20 lg:pb-12">
        <h2 id="hidden-wall-heading" className="type-title">
          {/* Every wall item is a called-out pair with no genre tag in common: the build keeps only those. */}
          Hidden clashes: {pluralize(items.length, "called-out pair")} with no genre tag in common
        </h2>
        <p className="mt-2 max-w-[70ch] text-[0.9375rem] leading-[1.55]">
          Clashes the press or fans called out where the acts share no genre tag, yet their taste overlap is
          among the highest of that day.
        </p>

        {/* The caveat that qualifies the finding sits in the finding's column, under the shared-minutes key; the
            count closes the exhibit (after the source details below 1024px, across both halves from 1024px); the
            rank scale and the broad-tags note close the pair's source details, word for word. On paper the
            switcher is left out and the whole caveat prints in one block, above every example as a card. */}
        <TasteRing
          items={items}
          synthetic={synthetic}
          badge={<ProvenanceChip provenance="recorded" size="sm" synthetic={synthetic} />}
          aside={<p className="max-w-[60ch] text-[0.8125rem] leading-relaxed text-muted-foreground">{NOT_A_TEST}</p>}
          closing={
            <p className="text-[0.8125rem] leading-relaxed font-medium text-muted-foreground">
              {wallCount(items.length, total)}
            </p>
          }
          notes={
            <p data-wall-notes className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              {RANK_SCALE} {BROAD_TAGS_NOTE}
            </p>
          }
          footnote={
            <div className="max-w-[90ch] space-y-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
              <p className="font-medium">{wallCount(items.length, total)}</p>
              <p className="text-muted-foreground">
                {NOT_A_TEST} {RANK_SCALE} {BROAD_TAGS_NOTE}
              </p>
            </div>
          }
        />
        <WallGrid items={items} synthetic={synthetic} className="mt-6 hidden print:grid" />
      </div>
    </section>
  );
}
