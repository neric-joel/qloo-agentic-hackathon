import { ExternalLink } from "lucide-react";

import { RecordedBadge } from "@/components/kernel";
import { festivalName, hostOf } from "@/lib/clashes";
import type { Preset } from "@/lib/preset";

/** "/news/lineups/some-long-slug..." trimmed to fit one line. */
function shortPath(url: string): string {
  try {
    const path = new URL(url).pathname;
    if (path.length <= 1) return "";
    return path.length > 48 ? `${path.slice(0, 47)}…` : path;
  } catch {
    return "";
  }
}

/** Where the timetable and the numbers come from, and what the tool is not. */
export function PresetSources({ preset }: { preset: Preset }) {
  const samples = preset.report.baseline?.samples;
  return (
    <section aria-labelledby="sources-heading" className="border-t border-border">
      <div className="container-page grid gap-10 py-14 sm:py-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div>
          <p className="type-kicker text-muted-foreground">Sources and method</p>
          <h2 id="sources-heading" className="type-headline mt-2">
            Where the numbers come from
          </h2>
          <p className="mt-5 max-w-prose text-[0.9375rem] leading-relaxed">
            <strong className="font-semibold">{festivalName(preset.festival)} does not use Clash Control.</strong>{" "}
            This page scores the festival&rsquo;s published timetable from public sources. Nothing
            here is the festival&rsquo;s own data or view.
          </p>
          {preset.built_at ? <RecordedBadge capturedAt={preset.built_at} className="mt-5" /> : null}
        </div>

        <div className="space-y-8">
          <dl className="space-y-4 text-[0.9375rem] leading-relaxed">
            <div>
              <dt className="font-semibold">Draw (Qloo popularity)</dt>
              <dd className="text-muted-foreground">
                Each act&rsquo;s popularity on Qloo, 0 to 100. A clash&rsquo;s fans at stake combine
                both acts&rsquo; draw.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Shared audience (by Qloo&rsquo;s measure)</dt>
              <dd className="text-muted-foreground">
                For each act, Qloo ranks every other act on the day for that act&rsquo;s fans. Both
                directions are rank-normalized and averaged. Always by Qloo&rsquo;s measure.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Clash price</dt>
              <dd className="text-muted-foreground">
                Shared audience &times; the share of the shorter set the two sets play at once
                &times; fans at stake. Acts without a Qloo signal are left out, never scored as zero.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Clash Budget Index</dt>
              <dd className="text-muted-foreground">
                100 &times; the day&rsquo;s total clash price divided by the average of{" "}
                {samples ? `${samples} ` : ""}random valid timetables for this lineup. It counts
                shared-audience cost only, by Qloo&rsquo;s measure, and lower is better. It is not a
                verdict on the festival: real programming weighs much more than shared audiences.
              </dd>
            </div>
          </dl>

          {preset.sources.length > 0 ? (
            <div>
              <h3 className="type-kicker border-b-2 border-foreground pb-2">Timetable sources</h3>
              <ul className="mt-3 divide-y divide-border text-sm">
                {preset.sources.map((source) => (
                  <li key={source.url} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-center gap-1 font-semibold break-all underline-offset-4 hover:underline"
                    >
                      {hostOf(source.url)}
                      <span className="font-normal text-muted-foreground">{shortPath(source.url)}</span>
                      <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                    {source.accessed ? (
                      <span className="font-mono text-xs text-muted-foreground">accessed {source.accessed}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preset.overlap_notes.length > 0 ? (
            <div>
              <h3 className="type-kicker border-b-2 border-foreground pb-2">Notes on the data</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {preset.overlap_notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
