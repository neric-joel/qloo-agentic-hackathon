import type { Metadata } from "next";
import { Suspense } from "react";

import { ClashControl, ClashControlFallback } from "@/components/clash/clash-control";
import { WHY_THIS_MATTERS_ID } from "@/components/clash/why-this-matters";
import { METHOD_FIGURES } from "@/lib/method-figures";
import { loadServerSummary } from "@/lib/server-summary";

/**
 * The pitch. Static, so it paints before any festival data arrives: the question, then a lede of at most
 * 28 words on either kind of day that names who it is for, the benefit and the mechanism, with the
 * qualifier beside the claim it limits. The actions and the proof line that follow are drawn by the
 * interactive page, which knows whether a decision card exists.
 */
function Intro({ synthetic = false }: { synthetic?: boolean }) {
  return (
    <>
      <h1
        id="pitch-heading"
        tabIndex={-1}
        className="text-[clamp(2.55rem,10vw,3.25rem)] leading-[0.9] font-extrabold tracking-[-0.01em] uppercase outline-none [font-variation-settings:'wdth'_62] max-sm:text-[clamp(2.25rem,10vw,2.75rem)] lg:type-poster"
      >
        Which clash is worth moving?
      </h1>
      <p className="mt-5 max-w-[32rem] text-[1.0625rem] leading-[1.5] text-foreground max-sm:mt-4">
        For heads of programming: equal-length clashes can cost very different amounts. Clash Control scores each
        by its audiences’ taste overlap
        {synthetic ? " (an invented rank, not attendance)" : ", from Qloo data (a rank, not attendance)"}.
      </p>
    </>
  );
}

/**
 * The public complaint figures from the published festivals (`METHOD_FIGURES`), set as one 18 px sentence
 * with no rule above it, its three numerals in the sentence's own sans at its own size, semibold, with
 * tabular lining figures, on the baseline, so the line reads as one sentence. Its 28 px line pitch is the
 * one its lines had while the figures were set larger, so nothing under it moves. One sentence: no tiles,
 * no stat strip, no captions. "Sources" jumps to Why this matters, which gives each figure's source and
 * limits (and the count of pairs).
 */
/** A figure in the stat sentence: the sentence's sans at its size (18 px), semibold, tabular lining figures. */
const STAT_NUMERAL = "font-semibold tabular-nums lining-nums";

function HeroStats() {
  const { complaints } = METHOD_FIGURES;
  return (
    <div data-hero-stat="" className="max-w-[32rem] text-foreground">
      <p className="text-[1.125rem] leading-7">
        Fans and press complained about <span className={STAT_NUMERAL}>{complaints.clustersVerified}</span>{" "}
        clashes at <span className={STAT_NUMERAL}>{complaints.festivals}</span> festivals; the median
        overlap was <span className={STAT_NUMERAL}>{complaints.medianMinutes}</span> minutes.{" "}
        <a
          href={`#${WHY_THIS_MATTERS_ID}`}
          className="rounded-sm text-foreground underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Sources
        </a>
      </p>
    </div>
  );
}

type HomeProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The `?preset=` the visitor asked for, as the client reads it (the first value). */
async function requestedPreset(searchParams: HomeProps["searchParams"]): Promise<string | null> {
  const value = (await searchParams).preset;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export async function generateMetadata({ searchParams }: HomeProps): Promise<Metadata> {
  const summary = await loadServerSummary(await requestedPreset(searchParams));
  if (!summary) return {};
  return {
    description: summary.description,
    openGraph: { title: "Clash Control", description: summary.description, type: "website", siteName: "Clash Control" },
    twitter: { card: "summary_large_image", title: "Clash Control", description: summary.description },
  };
}

/**
 * The first page is built on the server from the saved preset the visitor asked for (`?preset=`,
 * else the first), so a reader without JavaScript, or a preview fetch, gets the day's index, its
 * costliest clashes and where the prices come from. The preset fetch is cached for an hour.
 */
export default async function Home({ searchParams }: HomeProps) {
  // Null when the API does not answer: the page then renders exactly as it does without it.
  const summary = await loadServerSummary(await requestedPreset(searchParams));
  const synthetic = summary?.synthetic === true;
  return (
    <Suspense
      fallback={<ClashControlFallback intro={<Intro synthetic={synthetic} />} stats={<HeroStats />} summary={summary} />}
    >
      <ClashControl intro={<Intro synthetic={synthetic} />} stats={<HeroStats />} summary={summary} />
    </Suspense>
  );
}
