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
 * prints in the light palette whatever the screen theme, and the page box fits Letter and A4.
 */
const PRINT_CSS = `
@media print {
  @page { margin: 10mm; }
  body > header, body > footer, body > aside, body > a[href="#main"] { display: none !important; }
  :root, :root.dark {
    color-scheme: light;
    --background: #ffffff;
    --foreground: #1a1714;
    --card: #ffffff;
    --card-foreground: #1a1714;
    --muted: #f1efeb;
    --muted-foreground: #4d4843;
    --border: #c9c4bc;
    --border-strong: #6f6962;
    --highlight: #f3d75a;
    --highlight-foreground: #1a1714;
  }
  body { background: #ffffff !important; color: #1a1714; }
}
`;

function Loading() {
  return (
    <div className="container-page max-w-3xl py-16 sm:py-24">
      <p className="type-kicker text-muted-foreground">Clash brief</p>
      <p role="status" className="mt-3 text-lg font-semibold sm:text-xl">
        Loading the brief.
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
