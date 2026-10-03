import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";

import { MockBanner } from "@/components/site/mock-banner";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme-config";
import { ThemeProvider } from "@/components/theme/theme-provider";

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

const DESCRIPTION =
  "Clash Control prices the set-time clashes on a festival timetable with Qloo: how popular the two acts are, times how much their audiences overlap in taste. Taste, not attendance.";

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
    { media: "(prefers-color-scheme: light)", color: "#f9f5ee" },
    { media: "(prefers-color-scheme: dark)", color: "#140e0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <ThemeProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-background"
          >
            Skip to main content
          </a>
          <MockBanner />
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
