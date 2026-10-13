import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The header and footer render the check link only while the flag is true: never a dead link. */
async function render(live: boolean): Promise<{ header: string; footer: string; hero: string }> {
  vi.resetModules();
  vi.doMock("@/lib/check-flag", () => ({ CHECK_LIVE: live }));
  const { ThemeProvider } = await import("@/components/theme/theme-provider");
  const { SiteHeader } = await import("@/components/site/site-header");
  const { SiteFooter } = await import("@/components/site/site-footer");
  const { ClashControlFallback } = await import("@/components/clash/clash-control");
  const { summarize } = await import("@/lib/server-summary");
  const { parsePreset } = await import("@/lib/preset");
  const { rawTinyPreset } = await import("@/lib/fixtures/tiny-preset");
  return {
    hero: renderToStaticMarkup(
      createElement(ClashControlFallback, { intro: createElement("h1", null, "Pitch"), summary: summarize(parsePreset(rawTinyPreset())) }),
    ),
    header: renderToStaticMarkup(createElement(ThemeProvider, null, createElement(SiteHeader))),
    footer: renderToStaticMarkup(createElement(SiteFooter)),
  };
}

afterEach(() => {
  vi.doUnmock("@/lib/check-flag");
  vi.resetModules();
});

describe("the check links follow the flag", () => {
  it("shows no /check link while the flag is false", async () => {
    const { header, footer } = await render(false);
    expect(header).not.toContain('href="/check"');
    expect(footer).not.toContain('href="/check"');
  });

  it("shows the header and footer links once the flag is true", async () => {
    const { header, footer } = await render(true);
    expect(header).toContain('href="/check"');
    expect(header).toContain('aria-label="Check a draft grid"');
    expect(footer).toContain('href="/check"');
    expect(footer).toContain("Check a draft grid");
  });

  it("names the page the same in the header and footer, and the hero says Paste your own draft grid", async () => {
    const { header, hero, footer } = await render(true);
    const label = (html: string) => {
      const from = html.indexOf('href="/check"');
      const open = html.indexOf(">", from) + 1;
      return html.slice(open, html.indexOf("</a>", open)).replace(/<[^>]+>/g, "").trim();
    };
    // The header link reads the same at every width: in full beside the theme control from 640 px, and
    // in full again in the phone menu, with the one name for assistive tech.
    expect(header).toContain('aria-label="Check a draft grid"');
    expect(label(header)).toBe("Check a draft grid");
    const checkLabels = [...header.matchAll(/href="\/check"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
    expect(checkLabels).toEqual(["Check a draft grid", "Check a draft grid"]);
    expect(header).not.toMatch(/>Check<|>Method</);
    expect(label(hero)).toBe("Paste your own draft grid");
    expect(label(footer)).toBe("Check a draft grid");
    for (const html of [header, hero, footer]) {
      expect(html).not.toContain("Check a grid");
      expect(html).not.toContain("Check your own grid");
    }
  });

  it("keeps the home link's name and the mark when the wordmark text is hidden below 360 px", async () => {
    const { header } = await render(false);
    expect(header).toContain('aria-label="Clash Control, home"');
    expect(header).toMatch(/max-\[359px\]:sr-only[^"]*">\s*Clash Control\s*<\/span>/);
  });
});
