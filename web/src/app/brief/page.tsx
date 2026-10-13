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
    --primary: #ca2a02;
    --destructive: #ca2a02;
    --highlight: #c7dcfc;
    --highlight-foreground: #141821;
  }
  body { background: #ffffff !important; color: #141821; }
}
`;

function Loading() {
  return (
    <div className="container-page max-w-[60rem] pt-8 pb-12">
      <p className="type-kicker text-muted-foreground">Clash brief</p>
      <p role="status" className="mt-2 text-lg font-semibold sm:text-xl">
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
