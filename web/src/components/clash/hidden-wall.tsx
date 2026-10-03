import { ExternalLink } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel";
import { festivalLabel, formatDraw, formatPercent, hostOf, isWebUrl, tagLabel } from "@/lib/clashes";
import type { Evidence, HiddenWallItem } from "@/lib/preset";

import { DiamondGlyph, Meter } from "./marks";

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

function WallCard({ item }: { item: HiddenWallItem }) {
  const [a, b] = item.acts;
  const source = isWebUrl(item.source) ? item.source : null;
  return (
    <li className="flex flex-col rounded-xl border border-border-strong bg-background">
      <div className="p-4 pb-5">
        <div className="flex items-center justify-between gap-2">
          <p className="type-kicker text-muted-foreground">
            {festivalLabel(item.festival)}
            {item.day ? ` · ${item.day}` : ""}
          </p>
          <DiamondGlyph className="size-3.5 shrink-0" />
        </div>
        <h3 className="type-title mt-2 break-words">
          {a} <span className="text-muted-foreground">&times;</span> {b}
        </h3>
        <div className="mt-3 space-y-1">
          <GenreLine act={a} genres={item.genres[0]} />
          <GenreLine act={b} genres={item.genres[1]} />
        </div>
        <p className="mt-2 text-xs font-semibold">No genre tag in common.</p>
      </div>

      <div className="ticket-perforation mx-4" aria-hidden="true" />

      <div className="flex flex-1 flex-col p-4 pt-5">
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="type-kicker flex min-h-8 items-end text-muted-foreground">Shared audience</dt>
            <dd className="mt-1">
              <span className="type-numeral block text-3xl leading-none">{formatPercent(item.overlap_pct)}</span>
              <Meter
                value={item.overlap_pct}
                tone="qloo"
                label={`Shared audience ${formatPercent(item.overlap_pct)}, by Qloo's measure`}
                className="mt-2 h-1.5"
              />
            </dd>
          </div>
          <div>
            <dt className="type-kicker flex min-h-8 items-end text-muted-foreground">Draw</dt>
            <dd className="mt-1">
              <span className="type-numeral block text-3xl leading-none">
                {item.draw_pct !== null ? formatDraw(item.draw_pct) : "n/a"}
              </span>
              {item.draw_pct !== null ? (
                <Meter value={item.draw_pct} label={`Draw ${formatDraw(item.draw_pct)} of 100`} className="mt-2 h-1.5" />
              ) : null}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Shared audience by Qloo&rsquo;s measure; draw is Qloo popularity.
          {item.overlap_min ? ` ${item.overlap_min} min at the same time.` : ""}
        </p>

        {item.shared_tags.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-semibold">Fans of both also lean toward</p>
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {item.shared_tags.slice(0, 5).map((tag) => (
                <li
                  key={tag.name}
                  className="rounded-full border border-prov-qloo-border bg-prov-qloo-bg px-2 py-0.5 text-[0.6875rem] font-semibold text-prov-qloo"
                >
                  {tagLabel(tag.name)}
                </li>
              ))}
              {item.shared_tags.length > 5 ? (
                <li className="px-1 py-0.5 text-[0.6875rem] text-muted-foreground">
                  +{item.shared_tags.length - 5} more
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <p className="mt-auto pt-4 text-xs">
          {source ? (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-4 hover:text-primary-hover"
            >
              Press: {hostOf(source)}
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
 * Sourced examples of hidden clashes: pairs the press called out where the two acts share no genre
 * tag but, by Qloo's measure, share an audience. Shown as examples with their sources, not as
 * proof that the measure detects such clashes.
 */
export function HiddenWall({ evidence }: { evidence: Evidence | null }) {
  const items = evidence?.hidden_wall ?? [];
  return (
    <section
      aria-labelledby="hidden-wall-heading"
      className="border-y border-border bg-card [--ticket-bg:var(--card)]"
    >
      <div className="container-page py-14 sm:py-20">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
          <div>
            <p className="type-kicker flex items-center gap-2 text-muted-foreground">
              <DiamondGlyph className="size-3" /> Hidden clashes
            </p>
            <h2 id="hidden-wall-heading" className="type-headline mt-2">
              Different genres, same crowd
            </h2>
          </div>
          <div className="space-y-2 text-[0.9375rem] leading-relaxed">
            <p>
              Sourced examples: clashes the press called out where the acts share no genre tag but,
              by Qloo&rsquo;s measure, share an audience.
            </p>
            <p className="text-sm text-muted-foreground">
              These are examples with their sources, not a test of how well the measure spots such
              clashes.
            </p>
          </div>
        </div>

        {items.length > 0 ? (
          <>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-b-2 border-foreground pb-2">
              <p className="type-kicker">
                {items.length} of {evidence?.hidden_wall_total ?? items.length} examples
              </p>
              <ProvenanceChip provenance="recorded" size="sm" />
            </div>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {items.map((item) => (
                <WallCard key={`${item.festival}-${item.acts.join("|")}`} item={item} />
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-8 rounded-lg border-2 border-dashed border-border-strong p-5 text-sm text-muted-foreground">
            No sourced examples were saved with this festival day.
          </p>
        )}
      </div>
    </section>
  );
}
