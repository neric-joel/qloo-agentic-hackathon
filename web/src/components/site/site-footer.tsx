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

/**
 * The footer. `synthetic` is what the server read; once the page is in the browser the footer follows
 * the shared flag (`SyntheticProvider`), the same one the banner reads, so the two always agree.
 */
export function SiteFooter({ synthetic = false }: { synthetic?: boolean }) {
  const invented = useSynthetic(synthetic);
  return (
    <footer className="border-t border-border">
      <div className="container-page flex flex-col gap-2 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <p className="type-wordmark text-base text-foreground">Clash Control</p>
          <Link
            href="/method"
            className="rounded-sm py-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          >
            How we know
          </Link>
          {CHECK_LIVE ? (
            <Link
              href="/check"
              className="rounded-sm py-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
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
    </footer>
  );
}
