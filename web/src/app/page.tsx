import { Suspense } from "react";

import { ClashControl, ClashControlFallback } from "@/components/clash/clash-control";

/** The pitch. Static, so it paints before any festival data arrives. */
function Intro() {
  return (
    <>
      <p className="type-kicker text-muted-foreground">Festival timetable audit</p>
      <h1 id="pitch-heading" tabIndex={-1} className="type-poster mt-4 outline-none">
        Every clash
        <br />
        has a price.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-snug font-medium sm:text-xl">
        Clash Control prices every set-time clash with Qloo: fans at stake times{" "}
        <mark className="-mx-0.5 bg-highlight px-0.5 text-highlight-foreground [box-decoration-break:clone]">
          how many of them are the same people
        </mark>
        . It shows the hidden clashes genre labels miss, and lets a programmer test any change
        against their own rules.
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
