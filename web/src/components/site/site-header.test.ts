import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeProvider } from "@/components/theme/theme-provider";

import { nextMenu, SITE_LINKS, SiteHeader } from "./site-header";

function header(): string {
  return renderToStaticMarkup(createElement(ThemeProvider, null, createElement(SiteHeader)));
}

/** The visible words of every link to `href`, in page order. */
function labels(html: string, href: string): string[] {
  return [...html.matchAll(new RegExp(`href="${href}"[^>]*>([\\s\\S]*?)</a>`, "g"))].map((m) => m[1].replace(/<[^>]+>/g, ""));
}

describe("SiteHeader", () => {
  it("says the same words at every width: the desktop links and the phone menu rows match", () => {
    const html = header();
    expect(labels(html, "/method")).toEqual(["How we know", "How we know"]);
    for (const link of SITE_LINKS) {
      expect(labels(html, link.href)).toEqual([link.label, link.label]);
      expect(html).toContain(`aria-label="${link.label}"`);
    }
    expect(html).not.toMatch(/>Method<|>Check</);
  });

  it("draws a closed Menu icon button under 640 px that controls a full-width panel of 48 px rows", () => {
    const html = header();
    const whole = /<button[^>]*aria-label="Menu"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    const button = /<button[^>]*>/.exec(whole)?.[0] ?? "";
    expect(button).not.toBe("");
    expect(button).toContain('aria-haspopup="true"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).not.toContain("type-kicker");
    // A 44 x 44 borderless icon button with the 12 px control corner and the wash on hover and while
    // open, matching the theme button beside it. No alpha ink ground.
    expect(button).toContain("size-11");
    expect(button).toContain("rounded-md");
    expect(button).not.toMatch(/\bborder\b|border-border/);
    expect(button).toContain("hover:bg-accent");
    expect(button).toContain("aria-expanded:bg-accent");
    expect(button).not.toMatch(/bg-foreground\//);
    expect(button).toContain("sm:hidden");
    // Three lines at 20 px with a 1.75 stroke, hidden from assistive tech: the name is the aria-label.
    expect(whole).toMatch(/<svg[^>]*stroke-width="1.75"[^>]*aria-hidden="true"[^>]*class="size-5"/);
    expect(whole.match(/<path d="([^"]+)"/)?.[1].match(/M/g)).toHaveLength(3);
    const controls = /aria-controls="([^"]+)"/.exec(button)?.[1] ?? "";
    expect(controls).not.toBe("");
    const panel = new RegExp(`<nav id="${controls}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(panel).toContain('hidden=""');
    expect(panel).toContain("inset-x-0");
    expect(panel).toContain("border-b");
    expect(panel).toContain("border-x");
    expect(panel).toContain("rounded-b-lg");
    expect(panel).toContain("bg-background");
    // The rows are parted by hairlines inset 16 px from the panel's sides.
    expect(html.match(/<li class="mx-4[^"]*">/g)).toHaveLength(SITE_LINKS.length);
    expect(html.match(/flex h-12 items-center/g)).toHaveLength(SITE_LINKS.length);
    // From 640 px the links are inline and the Menu button is gone.
    expect(html).toMatch(/<nav aria-label="Site" class="hidden items-center gap-6 sm:flex">/);
  });

  it("draws the sticky bar with no rule under it, and the page links in ink, never vermilion", () => {
    const html = header();
    const bar = /<header[^>]*>/.exec(html)?.[0] ?? "";
    expect(bar).toContain("sticky");
    expect(bar).toContain("bg-background");
    expect(bar).not.toMatch(/border-b|border-border/);
    for (const link of [...html.matchAll(/<a[^>]*href="\/(method|check)"[^>]*>/g)].map((m) => m[0])) {
      expect(link).toContain("text-foreground");
      expect(link).not.toMatch(/text-primary|decoration-primary/);
    }
  });

  it("opens on a press, and Escape or a press outside closes it with focus back on the button; a link closes it", () => {
    expect(nextMenu(false, "toggle")).toEqual({ open: true, returnFocus: false });
    expect(nextMenu(true, "toggle")).toEqual({ open: false, returnFocus: false });
    expect(nextMenu(true, "escape")).toEqual({ open: false, returnFocus: true });
    expect(nextMenu(true, "outside")).toEqual({ open: false, returnFocus: true });
    expect(nextMenu(true, "link")).toEqual({ open: false, returnFocus: false });
    // Closed already: nothing moves focus.
    expect(nextMenu(false, "escape")).toEqual({ open: false, returnFocus: false });
    expect(nextMenu(false, "outside")).toEqual({ open: false, returnFocus: false });
  });
});
