import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { RecordedBadge } from "@/components/kernel";
import { festivalName, hostOf, popularitySpread } from "@/lib/clashes";
import type { Preset } from "@/lib/preset";
import { SYNTHETIC_NOTICE } from "@/lib/synthetic-notice";

import { MoreDetails } from "./more-details";

/** How a data note about acts with no usable signal starts; the coverage meter says the same. */
const NO_SIGNAL_NOTE = "No usable Qloo signal";

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
  const spread = popularitySpread(preset.festival.acts);
  const synthetic = preset.synthetic === true;
  // The coverage meter above already lists the acts with no usable signal.
  const notes = preset.overlap_notes.filter((note) => !note.startsWith(NO_SIGNAL_NOTE));
  return (
    <section aria-labelledby="sources-heading">
      <div className="container-page grid gap-x-12 py-16 lg:grid-cols-12 lg:items-start lg:py-20">
        <div className="lg:col-span-5">
          <h2 id="sources-heading" className="type-title">
            Where the numbers come from
          </h2>
          {synthetic ? (
            <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed">
              <strong className="font-semibold">{SYNTHETIC_NOTICE}.</strong> The server has no built festival day, so it
              shows one made up for this page: the acts, set times, popularity and audience affinities are all invented,
              and no request was sent to Qloo. Nothing here says anything about a real festival.
            </p>
          ) : (
            <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed">
              <strong className="font-semibold">{festivalName(preset.festival)} does not use Clash Control.</strong>{" "}
              This page scores the festival&rsquo;s published timetable from public sources. Nothing here is the
              festival&rsquo;s own data or view.
            </p>
          )}
          {preset.built_at && !synthetic ? <RecordedBadge builtAt={preset.built_at} className="mt-4" /> : null}
        </div>

        <div className="lg:col-span-7">
          <div className="mt-4 max-w-prose space-y-2 lg:mt-0 text-[0.9375rem] leading-relaxed">
            {/* /method defines every figure but not this day's spread of draw, so that one line stays. */}
            <p>
              <strong className="font-semibold">
                {synthetic ? "Draw (invented popularity):" : "Draw (Qloo popularity):"}
              </strong>{" "}
              {spread.atLeast} of {spread.total} acts on this day score 90 or more out of 100.
            </p>
            <p>
              Draw, taste overlap, clash price and the Clash Budget Index are defined on{" "}
              <Link href="/method" className="font-semibold underline underline-offset-4 hover:text-primary">
                How we know
              </Link>
              .
            </p>
          </div>

          {preset.sources.length > 0 || notes.length > 0 ? (
            <div className="mt-5 space-y-3">
              {preset.sources.length > 0 ? (
                <MoreDetails summary={`Timetable sources (${preset.sources.length})`}>
                  <ul className="mt-2 mb-3 divide-y divide-border text-sm">
                    {preset.sources.map((source) => (
                      <li
                        key={source.url}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
                      >
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-w-0 flex-wrap items-center gap-1 font-semibold break-words underline-offset-4 hover:underline"
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
                </MoreDetails>
              ) : null}

              {notes.length > 0 ? (
                <MoreDetails summary={`Notes on the data (${notes.length})`}>
                  <ul className="mt-3 mb-3 max-w-prose space-y-2 text-sm">
                    {notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </MoreDetails>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
