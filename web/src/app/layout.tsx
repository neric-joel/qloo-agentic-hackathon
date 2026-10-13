import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";

import { IntroReveal } from "@/components/site/intro-reveal";
import { MockBanner } from "@/components/site/mock-banner";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SyntheticBanner } from "@/components/site/synthetic-banner";
import { SyntheticProvider } from "@/components/site/synthetic-context";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme-config";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { loadSyntheticFlag } from "@/lib/server-summary";

import "./globals.css";

// Archivo is a variable font with a width axis: condensed for display type, normal width for text.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

// The default for every page, so it says nothing that is true of only one kind of day: a published day
// credits Qloo and the invented day does not. The home page replaces it with the day it serves.
const DESCRIPTION =
  "Clash Control prices the set-time clashes on a festival timetable: how popular the two acts are, times how much their audiences overlap in taste. Taste, not attendance.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://clash-control.vercel.app"),
  title: {
    default: "Clash Control",
    template: "%s | Clash Control",
  },
  description: DESCRIPTION,
  applicationName: "Clash Control",
  // Shared links and crawlers see the pitch and its caveat without running the page. The card image
  // comes from the opengraph-image file convention; the large Twitter card reuses it.
  openGraph: { title: "Clash Control", description: DESCRIPTION, type: "website", siteName: "Clash Control" },
  twitter: { card: "summary_large_image", title: "Clash Control", description: DESCRIPTION },
};

/**
 * Arms the opening reveal before the first paint: `data-intro="play"` on `<html>` only on a first
 * visit to the home page itself (no hash), with motion allowed. Any first page writes the session key,
 * so the intro never shows mid-visit and a reload does not replay it. Anything that fails skips it.
 *
 * It also owns the skip, so it works before the page has hydrated. While the curtain is visible it
 * takes every pointer event (`globals.css`), so a press lands on it, never on a control under it: the
 * press and its click are stopped here, and the click (or a cancelled press, a wheel or any key) lifts
 * it at once (`data-intro="done"`, then the `cc:intro-done` event that starts the hero receipt). Keys
 * that would move focus, scroll or activate something are held back while it shows. Once the curtain
 * has gone (its own CSS end, hidden) none of this does anything.
 */
const INTRO_INIT_SCRIPT = [
  "(function(){try{",
  'var s=window.sessionStorage,k="cc.intro.v2";if(s.getItem(k))return;s.setItem(k,"1");',
  'if(location.pathname!=="/"||location.hash)return;',
  'if(!window.matchMedia||matchMedia("(prefers-reduced-motion: reduce)").matches)return;',
  'var d=document.documentElement,c=true;d.setAttribute("data-intro","play");',
  'var held=" Enter Tab ArrowUp ArrowDown ArrowLeft ArrowRight PageUp PageDown Home End ";',
  'var taps=["pointerdown","mousedown","pointerup","mouseup","click","pointercancel"];',
  // The curtain while it can still be hit: armed, in the page, and not yet hidden by its own end.
  'function shown(){if(d.getAttribute("data-intro")!=="play")return null;',
  'var o=document.querySelector(".cc-intro");return o&&getComputedStyle(o).visibility!=="hidden"?o:null}',
  'function done(){off();if(d.getAttribute("data-intro")!=="play")return;',
  'd.setAttribute("data-intro","done");window.dispatchEvent(new Event("cc:intro-done"))}',
  'function tap(e){var o=shown();if(!o||!(e.target instanceof Node)||!o.contains(e.target))return;',
  'e.preventDefault();e.stopPropagation();if(e.type==="click"||e.type==="pointercancel")done()}',
  'function key(e){if(!shown())return;',
  'if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.key===" "||held.indexOf(" "+e.key+" ")>-1)){e.preventDefault();e.stopPropagation()}done()}',
  "function wheel(){if(shown())done()}",
  'function off(){for(var i=0;i<taps.length;i++)window.removeEventListener(taps[i],tap,c);',
  'window.removeEventListener("keydown",key,c);window.removeEventListener("wheel",wheel,c)}',
  "for(var i=0;i<taps.length;i++)window.addEventListener(taps[i],tap,c);",
  'window.addEventListener("keydown",key,c);window.addEventListener("wheel",wheel,{capture:true,passive:true})',
  "}catch(e){}})();",
].join("");

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f4f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e15" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read on the server so the synthetic notice is in the HTML of every page that shows the day.
  const synthetic = await loadSyntheticFlag();
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: INTRO_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <IntroReveal />
        <ThemeProvider>
          <SyntheticProvider initial={synthetic}>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-background"
            >
              Skip to main content
            </a>
            <MockBanner />
            <SyntheticBanner initial={synthetic} />
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter synthetic={synthetic} />
          </SyntheticProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
