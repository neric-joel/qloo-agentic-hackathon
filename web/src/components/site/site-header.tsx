"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { CHECK_LIVE } from "@/lib/check-flag";

import { LogoMark } from "./logo-mark";

/** The header's page links, with one label each at every width: the same words on a phone and a desk. */
export const SITE_LINKS: readonly { href: string; label: string }[] = [
  { href: "/method", label: "How we know" },
  ...(CHECK_LIVE ? [{ href: "/check", label: "Check a draft grid" }] : []),
];

type MenuEvent = "toggle" | "escape" | "outside" | "link";

/**
 * What the phone menu does on each event: the button toggles it; Escape and a press outside close it
 * and send focus back to the button; following a link closes it and leaves focus to the new page.
 * Events that arrive while it is closed change nothing.
 */
export function nextMenu(open: boolean, event: MenuEvent): { open: boolean; returnFocus: boolean } {
  if (event === "toggle") return { open: !open, returnFocus: false };
  if (!open) return { open: false, returnFocus: false };
  return { open: false, returnFocus: event !== "link" };
}

/**
 * A page link: ink, with a 1px control-edge underline 4px below on hover that turns ink; the current page
 * keeps a 1px ink underline (aria-current), never vermilion.
 */
const LINK =
  "rounded-sm py-1 text-sm leading-tight font-semibold whitespace-nowrap text-foreground decoration-1 underline-offset-4 hover:underline hover:decoration-border-strong aria-[current=page]:underline aria-[current=page]:decoration-foreground";

/**
 * Opaque, like the masthead of a printed running order: nothing scrolls through it, and no rule under it.
 * From 640 px the two page links sit in full beside the theme control. Under 640 px a 44 x 44 borderless
 * "Menu" icon button (three 20 px lines) takes their place and opens a panel under the header (paper, a
 * hairline at its sides and foot, 20 px lower corners) holding the same two links, with the same words,
 * as 48 px rows parted by hairlines inset 16 px. Escape or a press outside closes it and returns focus to the button; a link closes it.
 * Under 360 px the wordmark text is hidden visually (the mark stays and the link keeps its name).
 * The bar is 56 px on a phone with the 16 px page gutter; from 768 px it stays 64 px, the height the
 * board's sticky jump bar is pinned under.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  // The page the visitor is on; its link carries aria-current and an ink underline.
  const pathname = usePathname();
  const current = (href: string) => (pathname === href ? ("page" as const) : undefined);
  const panelId = `${useId()}-menu`;
  const root = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const send = useCallback(
    (event: MenuEvent) => {
      const next = nextMenu(open, event);
      setOpen(next.open);
      if (next.returnFocus) button.current?.focus();
    },
    [open],
  );

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) send("outside");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        send("escape");
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, send]);

  return (
    <header ref={root} className="sticky top-0 z-40 bg-background">
      <div className="container-page flex h-14 items-center justify-between gap-2 md:h-16">
        <Link
          href="/"
          className="-mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 min-[360px]:shrink-0 sm:gap-2.5"
          aria-label="Clash Control, home"
        >
          <LogoMark className="size-6 sm:size-8" />
          <span className="type-wordmark truncate text-[0.875rem] max-[359px]:sr-only min-[390px]:text-base sm:text-xl">
            Clash Control
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2 sm:gap-6">
          <nav aria-label="Site" className="hidden items-center gap-6 sm:flex">
            {SITE_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-label={link.label}
                aria-current={current(link.href)}
                className={LINK}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <button
            ref={button}
            type="button"
            aria-label="Menu"
            aria-haspopup="true"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => send("toggle")}
            className="inline-flex size-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-expanded:bg-accent motion-reduce:transition-none sm:hidden"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              aria-hidden="true"
              className="size-5"
            >
              <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
            </svg>
          </button>
          <ThemeToggle className="shrink-0" />
        </div>
      </div>
      <nav
        id={panelId}
        aria-label="Site"
        hidden={!open}
        className="absolute inset-x-0 top-full rounded-b-lg border-x border-b border-border bg-background sm:hidden print:hidden"
      >
        <ul className="py-1">
          {SITE_LINKS.map((link, i) => (
            <li key={link.href} className={i > 0 ? "mx-4 border-t border-border" : "mx-4"}>
              <Link
                href={link.href}
                aria-label={link.label}
                aria-current={current(link.href)}
                onClick={() => send("link")}
                className="flex h-12 items-center rounded-md text-[0.9375rem] font-semibold text-foreground decoration-1 underline-offset-4 hover:underline hover:decoration-border-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:underline aria-[current=page]:decoration-foreground"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
