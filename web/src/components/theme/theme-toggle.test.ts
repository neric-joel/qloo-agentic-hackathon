import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { revealRadius, shouldAnimateReveal, ThemeProvider } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

const base = {
  supportsViewTransitions: true,
  reducedMotion: false,
  printing: false,
  appearanceChanges: true,
  hasOrigin: true,
};

describe("revealRadius", () => {
  it("reaches the farthest corner", () => {
    expect(revealRadius({ x: 0, y: 0 }, 300, 400)).toBeCloseTo(500);
    expect(revealRadius({ x: 300, y: 400 }, 300, 400)).toBeCloseTo(500);
    expect(revealRadius({ x: 100, y: 100 }, 300, 400)).toBeCloseTo(Math.hypot(200, 300));
  });
});

describe("shouldAnimateReveal", () => {
  it("animates when everything allows it", () => {
    expect(shouldAnimateReveal(base)).toBe(true);
  });

  it("falls back to an instant switch", () => {
    expect(shouldAnimateReveal({ ...base, supportsViewTransitions: false })).toBe(false);
    expect(shouldAnimateReveal({ ...base, reducedMotion: true })).toBe(false);
    expect(shouldAnimateReveal({ ...base, printing: true })).toBe(false);
    expect(shouldAnimateReveal({ ...base, appearanceChanges: false })).toBe(false);
    expect(shouldAnimateReveal({ ...base, hasOrigin: false })).toBe(false);
  });
});

describe("ThemeToggle markup", () => {
  it("renders one menu button over the named radio group, nothing selected before the stored choice is read", () => {
    const html = renderToString(createElement(ThemeProvider, null, createElement(ThemeToggle)));
    // The menu button: named, closed, announcing its popup.
    const button = html.match(/<button[^>]*>/)?.[0] ?? "";
    expect(button).toContain('aria-label="Color theme"');
    expect(button).toContain('aria-haspopup="true"');
    expect(button).toContain('aria-expanded="false"');
    // The panel starts hidden and holds a fieldset named by its legend: the native radio group.
    expect(html).toMatch(/<div[^>]*hidden=""[^>]*>[\s\S]*?<fieldset/);
    expect(html).toMatch(/<fieldset[^>]*>[\s\S]*?<legend[^>]*>Color theme<\/legend>/);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    // Visible labels, not screen-reader-only ones.
    for (const label of ["Light", "Dark", "System"]) {
      expect(html).toContain(`<span>${label}</span>`);
    }
    expect(html).not.toContain("sr-only\">Light");
    expect(html).not.toContain('checked=""');
  });

  it("draws the moon as a stroked crescent path, never a masked or filled disc", () => {
    const html = renderToString(createElement(ThemeProvider, null, createElement(ThemeToggle)));
    expect(html).not.toContain("<mask");
    expect(html).toMatch(/<path d="M15\.4 10\.6A6\.5 6\.5 0 1 1 7\.4 2\.6a6 6 0 0 0 8 8Z"/);
    // Every glyph is a 1.5 px line with round ends on an 18 px grid, in the text colour, with no fill.
    const svgs = html.match(/<svg[^>]*>/g) ?? [];
    expect(svgs).toHaveLength(3);
    for (const svg of svgs) {
      expect(svg).toContain('viewBox="0 0 18 18"');
      expect(svg).toContain('fill="none"');
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).toContain('stroke-width="1.5"');
      expect(svg).toContain('stroke-linecap="round"');
    }
    // The sun is a 7 px ring with eight rays.
    expect(html).toContain('<circle cx="9" cy="9" r="3.5"></circle>');
    expect(html.match(/<path d="M14\.5 9L16\.5 9[^"]*"/)?.[0].match(/M/g)).toHaveLength(8);
    expect(html).not.toContain("lucide");
  });

  it("draws the menu button as the header's 44 px borderless control with the control corner, the wash on hover and when open", () => {
    const html = renderToString(createElement(ThemeProvider, null, createElement(ThemeToggle)));
    const button = html.match(/<button[^>]*>/)?.[0] ?? "";
    expect(button).toContain("size-11");
    expect(button).toContain("rounded-md");
    expect(button).not.toMatch(/\bborder\b|border-border/);
    expect(button).toContain("bg-transparent");
    expect(button).not.toMatch(/bg-background|hover:bg-muted|shadow/);
    expect(button).toContain("hover:bg-accent");
    expect(button).toContain("aria-expanded:bg-accent");
    // No alpha ink ground: the wash is a named token.
    expect(button).not.toMatch(/bg-foreground\//);
    // The menu rows use the wash too, never the meter-track grey.
    expect(html).not.toMatch(/(hover|peer-checked):bg-muted/);
  });
});
