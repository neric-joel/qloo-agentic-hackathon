import Link from "next/link";

import { ThemeToggle } from "@/components/theme/theme-toggle";

import { LogoMark } from "./logo-mark";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/80">
      {/* Below the sm breakpoint the mark, wordmark and gaps run a size smaller, so the wordmark,
          the method link and the theme toggle share one line at 390 px. On narrower screens the
          link wraps onto two lines; the home link does not shrink at all from 360 px up (even a
          fraction of a pixel would draw the ellipsis), and below that the link's group still
          gives way a hundred times faster than the wordmark. */}
      <div className="container-page flex h-16 items-center justify-between gap-2">
        <Link
          href="/"
          className="-mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 min-[360px]:shrink-0 sm:gap-2.5"
          aria-label="Clash Control, home"
        >
          <LogoMark className="size-6 sm:size-8" />
          <span className="type-wordmark truncate text-base sm:text-xl">Clash Control</span>
        </Link>
        <div className="flex shrink-[100] items-center gap-2 sm:gap-5">
          <Link
            href="/method"
            className="rounded-sm py-1 text-[0.8125rem] leading-tight font-semibold underline-offset-4 hover:underline sm:text-sm"
          >
            {/* The no-break space keeps a wrapped link to two lines: "How we" over "know". */}
            How&nbsp;we know
          </Link>
          {/* No wrapping, so the group's narrowest width is the full toggle plus the wrapped link. */}
          <ThemeToggle className="shrink-0 flex-nowrap gap-0.5 sm:gap-1.5" />
        </div>
      </div>
    </header>
  );
}
