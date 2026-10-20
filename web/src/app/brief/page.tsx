import { Suspense } from "react";
import type { Metadata } from "next";

import { BriefSheet } from "@/components/brief/brief-sheet";

export const metadata = {
  title: "Clash brief",
  description: "A one-page print view of one festival day's clash figures, for evaluating this demo.",
  robots: { index: false, follow: false },
} satisfies Metadata;

/**
 * Print rules for this page only: the site header, footer and notices are left out, the sheet
 * prints in cool ink on white whatever the screen theme, and the page box fits Letter and A4.
 */
const PRINT_CSS = `
@media print {
  @page { margin: 10mm; }
  body > header, body > footer, body > aside, body > a[href="#main"] { display: none !important; }
  :root, :root.dark {
    color-scheme: light;
    --background: #ffffff;
    --foreground: #141821;
    --card: #ffffff;
    --card-foreground: #141821;
    --muted: #e5e8ec;
    --muted-foreground: #525864;
    --border: #d6d9de;
    --border-strong: #7b818a;
    --primary: #b61b75;
    --destructive: #141821;
    --highlight: #c7dcfc;
    --highlight-foreground: #141821;
  }
  body { background: #ffffff !important; color: #141821; }
}
`;

/**
 * The first paint, before the link is read: the sheet's own loading notice, box for box (still, with no spinner), a
 * screen tall so the footer starts below the fold and nothing in view moves when the sheet arrives.
 */
function Loading() {
  return (
    <div className="container-page min-h-svh max-w-[60rem] pt-8 pb-12">
      <h1 className="type-kicker text-muted-foreground">Clash brief</h1>
      <p role="status" className="mt-2 flex max-w-prose items-center gap-2 text-lg leading-snug font-semibold sm:text-xl">
        <span>Loading the brief.</span>
      </p>
    </div>
  );
}

export default function BriefPage() {
  return (
    <>
      <style>{PRINT_CSS}</style>
      <Suspense fallback={<Loading />}>
        <BriefSheet />
      </Suspense>
    </>
  );
}
