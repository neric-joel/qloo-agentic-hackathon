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
  const { parseDecision } = await import("@/lib/decision");
  const { rawTinyPreset } = await import("@/lib/fixtures/tiny-preset");
  // The hero's group answers only with the day's decision in hand (round 37, L1; without it the server draws the
  // group's skeleton, with nothing to press), so the hero is rendered with one. Every name and figure is invented.
  const decision = parseDecision({
    kind: "decision",
    day: 0,
    skipped_locked: 0,
    skipped_no_place: 0,
    clash: { a_id: "ann", b_id: "bo", rank: 1, minutes: 60 },
    published_budget: 104.2,
    move: {
      act_id: "bo",
      act: "Bo Diddly Squat",
      from: "Side 20:30-22:00",
      stage_id: "side",
      stage: "Side",
      day: 0,
      start: "21:30",
      end: "23:00",
      minutes_moved: 60,
      legal_places: 4,
      stage_changed: false,
      budget_after: 98.4,
      minutes_shared_after: 0,
      same_index_alternative: null,
    },
    rule: null,
  });
  return {
    hero: renderToStaticMarkup(
      createElement(ClashControlFallback, {
        intro: createElement("h1", null, "Pitch"),
        summary: summarize(parsePreset(rawTinyPreset()), decision),
      }),
    ),
    header: renderToStaticMarkup(createElement(ThemeProvider, null, createElement(SiteHeader))),
    footer: renderToStaticMarkup(createElement(SiteFooter)),
  };
}

afterEach(() => {
  vi.doUnmock("@/lib/check-flag");
  vi.resetModules();
});

// Each test re-imports the header, footer and hero from a fresh module graph; the first, cold import can take
// several seconds on a loaded machine, so the suite allows 30 s a test.
describe("the check links follow the flag", { timeout: 30_000 }, () => {
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
    // One copy in the hero at every width: it sits in the decision group, after Keep's confirmation room.
    expect(hero.match(/href="\/check"/g)).toHaveLength(1);
    expect(hero.indexOf('href="/check"')).toBeGreaterThan(hero.indexOf("data-hero-group"));
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
