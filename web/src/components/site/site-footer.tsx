"use client";

import Link from "next/link";

import { CHECK_LIVE } from "@/lib/check-flag";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

import { useSynthetic } from "./synthetic-context";

/** What the footer says about where the figures come from, on a real day and on the invented one. */
export const FOOTER_SOURCES =
  "Popularity and audience comparisons are saved Qloo responses; taste overlap and prices are calculated by this app from them. The festivals shown do not use Clash Control; their published timetables are scored by this app.";
export const FOOTER_SYNTHETIC =
  "This server is showing an invented example day, not a festival: its acts, times and figures are made up, and no Qloo request was made. Prices are calculated by this app from the invented figures.";

/** The licence and the source code, linked from every page (the repository is made public with the entry). */
export const LICENSE_URL = "https://github.com/neric-joel/qloo-agentic-hackathon/blob/main/LICENSE";
export const SOURCE_URL = "https://github.com/neric-joel/qloo-agentic-hackathon";
/**
 * Who the entry is not, after the licence and source links. Worded "not endorsed by Qloo" first so it reads as a
 * denial on the invented day too (`qlooCredits` in lib/credit.ts), where nothing may credit Qloo.
 */
export const FOOTER_INDEPENDENT =
  "Independent entry: not endorsed by Qloo, Glastonbury Festival or Riot Fest, and not affiliated with any of them.";

/** A footer link: ink, with a 1px control-edge underline 4px below that turns ink on hover. */
const FOOTER_LINK =
  "rounded-sm py-2 text-sm font-semibold text-foreground underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground";

/**
 * The footer, parted from the page by 64 px of space, with no rule above it. `synthetic` is what the server read; once the page is in the browser the footer follows
 * the shared flag (`SyntheticProvider`), the same one the banner reads, so the two always agree.
 */
export function SiteFooter({ synthetic = false }: { synthetic?: boolean }) {
  const invented = useSynthetic(synthetic);
  return (
    <footer className="pt-16">
      <div className="container-page flex flex-col gap-2 pb-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <p className="type-wordmark text-base text-foreground">Clash Control</p>
          <Link
            href="/method"
            className={FOOTER_LINK}
          >
            How we know
          </Link>
          {CHECK_LIVE ? (
            <Link
              href="/check"
              className={FOOTER_LINK}
            >
              Check a draft grid
            </Link>
          ) : null}
        </div>
        <p className="max-w-prose">
          {MOCK_STREAM_ENABLED
            ? "Figures on this preview are simulated, and no requests reach Qloo."
            : invented
              ? FOOTER_SYNTHETIC
              : FOOTER_SOURCES}
        </p>
      </div>
      {/* One line on every page and on both days: the licence, the source and the independence sentence. */}
      <div className="container-page pb-8 text-sm text-muted-foreground">
        <p data-footer-legal className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {/* New tab, said to screen readers in the label (the visible text stays the pinned "MIT licence · Source code"). */}
          <a
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="MIT licence (opens in a new tab)"
            className={FOOTER_LINK}
          >
            MIT licence
          </a>
          <span aria-hidden="true">&middot;</span>
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Source code (opens in a new tab)"
            className={FOOTER_LINK}
          >
            Source code
          </a>
          {/* On a phone the sentence starts its own line, so no middot is left at a line's end. */}
          <span aria-hidden="true" className="hidden sm:inline">
            &middot;
          </span>
          <span className="basis-full sm:basis-auto">{FOOTER_INDEPENDENT}</span>
        </p>
      </div>
    </footer>
  );
}
