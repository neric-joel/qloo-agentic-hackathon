import type { Metadata } from "next";

import { CheckTool } from "@/components/check/check-tool";
import { CHECK_COPY } from "@/lib/check";
import { CHECK_LIVE } from "@/lib/check-flag";

// While the page is not linked from anywhere, keep it out of search results too.
export const metadata = {
  title: "Check a draft grid",
  description:
    "Paste one day of a draft timetable and list its rule breaks and the sets that share time. It runs in your browser; nothing you paste is sent anywhere.",
  robots: { index: CHECK_LIVE, follow: CHECK_LIVE },
} satisfies Metadata;

/**
 * Print rules for this page only (the same light palette as the brief): the site header, footer and
 * notices are left out and the page box fits Letter and A4. The one-day sample fits one page; a longer
 * paste flows onto more pages without the type getting smaller.
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
    --primary: oklch(0.56 0.2 33);
    --destructive: oklch(0.5 0.2 27);
  }
  body { background: #ffffff !important; color: #1a1714; font-size: 9pt; line-height: 1.25; }
  .cc-check-rules, .cc-check-shared { animation: none !important; }
}
`;

export default function CheckPage() {
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="container-page max-w-[68rem] py-8 sm:py-12 print:max-w-none print:p-0">
        <header className="mb-8 max-w-3xl print:hidden">
          <p className="type-kicker text-muted-foreground">{CHECK_COPY.kicker}</p>
          <h1 className="type-headline mt-2 break-words">{CHECK_COPY.title}</h1>
          <p className="mt-4 text-base leading-relaxed sm:text-lg">{CHECK_COPY.lede}</p>
        </header>
        <CheckTool />
      </div>
    </>
  );
}
