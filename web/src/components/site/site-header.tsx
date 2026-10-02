import Link from "next/link";

import { ThemeToggle } from "@/components/theme/theme-toggle";

import { LogoMark } from "./logo-mark";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="container-page flex h-16 items-center justify-between gap-2">
        <Link
          href="/"
          className="-mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-1 sm:gap-2.5"
          aria-label="Clash Control, home"
        >
          <LogoMark className="size-7 sm:size-8" />
          <span className="type-wordmark truncate text-[1.0625rem] sm:text-xl">Clash Control</span>
        </Link>
        <ThemeToggle className="shrink-0 gap-1 sm:gap-1.5" />
      </div>
    </header>
  );
}
