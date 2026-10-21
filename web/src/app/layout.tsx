import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";

import { MockBanner } from "@/components/site/mock-banner";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SyntheticBanner } from "@/components/site/synthetic-banner";
import { SyntheticProvider } from "@/components/site/synthetic-context";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme-config";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { loadSyntheticFlag } from "@/lib/server-summary";

import "./globals.css";

// Archivo, one family for every role; its width axis stays loaded but no display style uses it.
// "optional": the preloaded file is used when it is there for the first paint, and a page that painted
// without it keeps the size-matched fallback, so a slow font never re-wraps text the reader already sees.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "optional",
});

// The default for every page, so it says nothing that is true of only one kind of day: a published day
// credits Qloo and the invented day does not. The home page replaces it with the day it serves.
const DESCRIPTION =
  "Clash Control scores the set-time clashes on a festival timetable: how popular the two acts are, times how much their audiences overlap in taste. Taste, not attendance.";

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
    <html lang="en" suppressHydrationWarning className={archivo.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
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
