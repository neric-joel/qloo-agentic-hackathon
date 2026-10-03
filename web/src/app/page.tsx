import type { Metadata } from "next";
import { Suspense } from "react";

import { ClashControl, ClashControlFallback } from "@/components/clash/clash-control";
import { loadServerSummary } from "@/lib/server-summary";

/**
 * The pitch. Static, so it paints before any festival data arrives. The actions and the proof line
 * that follow it are drawn by the interactive page, which knows whether a decision card exists.
 */
function Intro({ synthetic = false }: { synthetic?: boolean }) {
  return (
    <>
      <p className="type-kicker text-muted-foreground">For heads of programming, before set times go out</p>
      <h1
        id="pitch-heading"
        tabIndex={-1}
        className="mt-3 text-[clamp(2.55rem,10vw,3.25rem)] leading-[0.9] font-extrabold tracking-[-0.01em] uppercase outline-none [font-variation-settings:'wdth'_62] lg:type-poster"
      >
        Which clash is worth moving?
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-[1.42] sm:mt-5 sm:text-[0.9375rem] sm:leading-[1.5]">
        Clash Control checks a timetable against hard rules (changeovers, curfew, locked sets, pairs that must never
        overlap), then ranks the set-time clashes by time shared, how big the acts are and{" "}
        <mark className="-mx-0.5 bg-highlight px-0.5 text-highlight-foreground [box-decoration-break:clone]">
          how much their audiences overlap in taste
        </mark>
        {synthetic ? " (invented on this day)" : ", from Qloo"}. Move one set, see what it does to the rest of the day,
        print the one-page brief.
      </p>
      <p className="mt-3 max-w-2xl text-xs leading-[1.4] text-muted-foreground sm:text-sm">
        {synthetic
          ? "On this invented day, taste overlap is an invented figure ranked within the day’s lineup. It is not attendance."
          : "Taste overlap is derived from Qloo data and ranked within each day’s lineup. It is not attendance."}
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
  const synthetic = summary?.synthetic === true;
  return (
    <Suspense fallback={<ClashControlFallback intro={<Intro synthetic={synthetic} />} summary={summary} />}>
      <ClashControl intro={<Intro synthetic={synthetic} />} summary={summary} />
    </Suspense>
  );
}
