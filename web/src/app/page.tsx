import type { Metadata } from "next";
import { Suspense } from "react";

import { ClashControl, ClashControlFallback, type HomeSummary } from "@/components/clash/clash-control";
import { parsePreset } from "@/lib/preset";
import { loadServerSummary } from "@/lib/server-summary";

/** The lede on a published day: who it is for, the frame, the stake, then what to compare. */
const LEDE =
  "For heads of programming: Qloo taste data used to schedule, not to recommend. Clashes make people choose. Compare time, popularity, taste.";

/** The lede on the invented day: the same frame, with no Qloo word (nothing on that day came from Qloo). */
const INVENTED_LEDE =
  "For heads of programming: taste data used to schedule, not to recommend. Clashes make people choose. Compare time, popularity, taste.";

/**
 * The pitch. Static, so it paints before any festival data arrives: the question, then one lede that names who
 * it is for, the frame (Qloo taste data used to schedule, not to recommend; on the invented day "taste data",
 * with no Qloo word), the stake (clashes make people choose) and what to compare (time, popularity, taste).
 * The qualifier on taste overlap sits beside its number in the hero's taste line, where the rank is printed. The day, its drawing
 * and the decision that follow are drawn by the interactive page.
 */
function Intro({ synthetic = false }: { synthetic?: boolean }) {
  return (
    <>
      <h1 id="pitch-heading" tabIndex={-1} className="type-poster outline-none">
        Which clash is worth moving?
      </h1>
      <p className="mt-2 max-w-[44rem] text-[0.9375rem] leading-[1.45] text-foreground lg:mt-4 lg:text-[1.125rem] lg:leading-[1.5]">
        {synthetic ? INVENTED_LEDE : LEDE}
      </p>
    </>
  );
}

type HomeProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The `?preset=` the visitor asked for, as the client reads it (the first value). */
async function requestedPreset(searchParams: HomeProps["searchParams"]): Promise<string | null> {
  const value = (await searchParams).preset;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** A preset's own route, `/api/presets/{id}`, and not its decision or any other route under it. */
const PRESET_ROUTE = /\/api\/presets\/[^/?#]+$/;

/**
 * The server summary of the day the page opens on, with the location its saved Qloo reading was asked for. The
 * location is read from the very preset response the summary is built from (the summary's own fetch, a copy of
 * its body parsed as the page parses a preset), so the dateline's "global" is true by construction. It stays
 * undefined when that response could not be read, and the dateline then makes no claim about place.
 */
async function loadHomeSummary(requestedId: string | null): Promise<HomeSummary | null> {
  let location: string | null | undefined;
  const fetcher = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    if (response.ok && PRESET_ROUTE.test(url)) {
      try {
        location = parsePreset(await response.clone().json()).location ?? null;
      } catch {
        location = undefined;
      }
    }
    return response;
  };
  const summary = await loadServerSummary(requestedId, { fetcher });
  return summary ? { ...summary, location } : null;
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
 * else the first), so a reader without JavaScript, or a preview fetch, gets the day's drawing and its
 * decision, the day's index, its costliest clashes and where the scores come from. The preset fetch is
 * cached for an hour.
 */
export default async function Home({ searchParams }: HomeProps) {
  // Null when the API does not answer: the page then renders exactly as it does without it.
  const summary = await loadHomeSummary(await requestedPreset(searchParams));
  const synthetic = summary?.synthetic === true;
  return (
    <Suspense fallback={<ClashControlFallback intro={<Intro synthetic={synthetic} />} summary={summary} />}>
      <ClashControl intro={<Intro synthetic={synthetic} />} summary={summary} />
    </Suspense>
  );
}
