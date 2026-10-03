import { Suspense } from "react";

import { ClashControl, ClashControlFallback } from "@/components/clash/clash-control";

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
        Clash Control prices the set-time clashes on a festival timetable with Qloo: how popular the
        two acts are, times{" "}
        <mark className="-mx-0.5 bg-highlight px-0.5 text-highlight-foreground [box-decoration-break:clone]">
          how much their audiences overlap in taste
        </mark>
        . It shows the hidden clashes genre labels miss, and lets a programmer test any change
        against their own rules.
      </p>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        Taste overlap is derived from Qloo data and ranked within each day&rsquo;s lineup. It is not
        attendance.
      </p>
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<ClashControlFallback intro={<Intro />} />}>
      <ClashControl intro={<Intro />} />
    </Suspense>
  );
}
