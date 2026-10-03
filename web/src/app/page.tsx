import type { Metadata } from "next";
import { Suspense } from "react";

import { ClashControl, ClashControlFallback } from "@/components/clash/clash-control";
import { loadServerSummary } from "@/lib/server-summary";

/** The pitch. Static, so it paints before any festival data arrives. */
function Intro() {
  return (
    <>
      <p className="type-kicker text-muted-foreground">Timetable audit for festival programmers</p>
      <h1 id="pitch-heading" tabIndex={-1} className="type-poster mt-4 outline-none">
        Every clash
        <br />
        has a price.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-snug font-medium sm:text-xl">
        For heads of programming, in the weeks between a lineup announcement and the published set
        times, when a clash can still be moved. Clash Control prices the clashes on a timetable with
        Qloo: how popular the two acts are, times{" "}
        <mark className="-mx-0.5 bg-highlight px-0.5 text-highlight-foreground [box-decoration-break:clone]">
          how much their audiences overlap in taste
        </mark>
        . It shows which clashes cost most, which ones genre labels hide, and what a move does to the
        rest of the day. Here it is run on two published days from festivals that do not use it.
      </p>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        Taste overlap is derived from Qloo data and ranked within each day&rsquo;s lineup. It is not
        attendance.
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
  return (
    <Suspense fallback={<ClashControlFallback intro={<Intro />} summary={summary} />}>
      <ClashControl intro={<Intro />} summary={summary} />
    </Suspense>
  );
}
