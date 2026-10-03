import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The header and footer render the check link only while the flag is true: never a dead link. */
async function render(live: boolean): Promise<{ header: string; footer: string }> {
  vi.resetModules();
  vi.doMock("@/lib/check-flag", () => ({ CHECK_LIVE: live }));
  const { ThemeProvider } = await import("@/components/theme/theme-provider");
  const { SiteHeader } = await import("@/components/site/site-header");
  const { SiteFooter } = await import("@/components/site/site-footer");
  return {
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

  it("keeps the home link's name and the mark when the wordmark text is hidden below 340 px", async () => {
    const { header } = await render(false);
    expect(header).toContain('aria-label="Clash Control, home"');
    expect(header).toMatch(/max-\[339px\]:sr-only[^"]*">\s*Clash Control\s*<\/span>/);
  });
});
