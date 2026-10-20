import type { Metadata } from "next";

import { CheckTool } from "@/components/check/check-tool";
import { artSlot } from "@/lib/art";
import { CHECK_COPY } from "@/lib/check";
import { CHECK_LIVE } from "@/lib/check-flag";

// While the page is not linked from anywhere, keep it out of search results too.
export const metadata = {
  title: "Check a draft grid",
  description:
    "Paste one day of a draft timetable and list its rule breaks and the sets that share time. Rule checks run in your browser; nothing is sent unless you press Compare audience overlap.",
  robots: { index: CHECK_LIVE, follow: CHECK_LIVE },
} satisfies Metadata;

/**
 * Print rules for this page only (the same cool ink on white as the brief): the site header, footer and
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
  body { background: #ffffff !important; color: #141821; font-size: 9pt; line-height: 1.25; }
  .cc-check-rules, .cc-check-shared { animation: none !important; }
}
`;

/**
 * Image slot 3, a ruler on a blank gridded sheet, right of the lede from `lg` up. Decorative (hidden from
 * assistive technology), lazy, on its own paper plate, and nothing at all until `art.ts` enables it.
 */
function HeaderArt() {
  const art = artSlot("check");
  if (!art) return null;
  return (
    <div aria-hidden="true" className="art-plate hidden overflow-hidden rounded-lg lg:block">
      <picture>
        <source srcSet={art.avif} type="image/avif" sizes={art.sizes} />
        <source srcSet={art.webp} type="image/webp" sizes={art.sizes} />
        <img
          src={art.webp}
          alt={art.alt}
          width={art.width}
          height={art.height}
          sizes={art.sizes}
          loading="lazy"
          decoding="async"
          className="block h-auto w-full"
        />
      </picture>
    </div>
  );
}

export default function CheckPage() {
  const art = artSlot("check") !== null;
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="container-page pt-4 pb-10 sm:pt-6 print:max-w-none print:p-0">
        <header
          className={
            art
              ? "mb-3 grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] print:hidden"
              : "mb-3 max-w-5xl print:hidden"
          }
        >
          <div className="max-w-5xl">
            {/* The title says what the page is; no kicker repeats it. The one display step every page title
                takes (the home page's and /method's too), with no size of its own. */}
            <h1 className="type-poster break-words">
              {CHECK_COPY.title}
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed sm:text-lg sm:leading-normal lg:max-w-none">{CHECK_COPY.lede}</p>
          </div>
          <HeaderArt />
        </header>
        {/* Opens on the invented sample, checked in the browser and labelled as invented, so the first
            view is a result, not a blank form. Nothing is sent; "Clear" empties it. */}
        <CheckTool startWithSample />
      </div>
    </>
  );
}
