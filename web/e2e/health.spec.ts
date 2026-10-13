import { DAYS, requireSavedDays, scrollThrough } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { SiteChrome } from "./pages/site-chrome";

/**
 * Every page loads and scrolls through clean: a 200, no console error, no failed or refused request, a title and
 * language, one h1, the three landmarks, no duplicate ids, and a name on every image, button and link.
 */

const PAGES = [
  { name: "home, Glastonbury", url: `/?preset=${DAYS.glastonbury.id}`, saved: true, h1: "Which clash is worth moving?" },
  { name: "home, Riot Fest", url: `/?preset=${DAYS.riot.id}`, saved: true, h1: "Which clash is worth moving?" },
  { name: "/method", url: "/method", saved: false, h1: "How we know" },
  { name: "/check", url: "/check", saved: false, h1: "Check a draft grid against your rules" },
  { name: "/brief", url: `/brief?preset=${DAYS.glastonbury.id}&day=0&moves=gurriers~woodsies~0~1215`, saved: true, h1: "Glastonbury Festival 2025 Sunday: where the clash budget goes" },
] as const;

test.describe("pages load clean", () => {
  for (const entry of PAGES) {
    test(`${entry.name}`, async ({ page, guard }) => {
      if (entry.saved) await requireSavedDays(page);
      const refused: string[] = [];
      const failed: string[] = [];
      page.on("response", (response) => {
        if (response.status() >= 400) refused.push(`${response.status()} ${response.url()}`);
      });
      page.on("requestfailed", (request) => {
        // A request the page cancelled itself (a superseded fetch) is not a failure.
        if (request.failure()?.errorText !== "net::ERR_ABORTED") failed.push(`${request.failure()?.errorText} ${request.url()}`);
      });

      const response = await page.goto(entry.url, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(entry.h1);
      await new SiteChrome(page).waitForHydration();
      if (entry.url.startsWith("/?")) await new HomePage(page).waitUntilReady();
      await scrollThrough(page);

      expect(refused, "requests answered with an error").toEqual([]);
      expect(failed, "requests that failed").toEqual([]);
      expect(guard.consoleErrors, "console errors").toEqual([]);

      // Document basics.
      expect(await page.title()).toMatch(/Clash Control|Check a draft grid|How we know|Clash brief/);
      expect(await page.locator("html").getAttribute("lang")).toBe("en");
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{40,}/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);

      // Structure: unique ids, named controls, described images.
      const problems = await page.evaluate(() => {
        const seen = new Map<string, number>();
        for (const element of document.querySelectorAll("[id]")) seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
        const duplicateIds = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
        const name = (element: Element) =>
          (element.getAttribute("aria-label") ?? "").trim() ||
          (element.getAttribute("aria-labelledby") ? "labelled" : "") ||
          ((element as HTMLElement).innerText ?? "").trim() ||
          (element.textContent ?? "").trim() ||
          (element.getAttribute("title") ?? "").trim();
        const unnamedButtons = [...document.querySelectorAll("button")].filter((button) => !name(button)).map((button) => button.outerHTML.slice(0, 80));
        const unnamedLinks = [...document.querySelectorAll("a[href]")].filter((link) => !name(link) && !link.querySelector("img[alt]:not([alt=''])")).map((link) => link.outerHTML.slice(0, 80));
        const noAlt = [...document.querySelectorAll("img")].filter((image) => !image.hasAttribute("alt")).map((image) => image.outerHTML.slice(0, 80));
        const emptyHeadings = [...document.querySelectorAll("h1, h2, h3, h4")].filter((heading) => !(heading.textContent ?? "").trim()).length;
        return { duplicateIds, unnamedButtons, unnamedLinks, noAlt, emptyHeadings };
      });
      expect(problems.duplicateIds, "duplicate ids").toEqual([]);
      expect(problems.unnamedButtons, "buttons with no name").toEqual([]);
      expect(problems.unnamedLinks, "links with no name").toEqual([]);
      expect(problems.noAlt, "images with no alt attribute").toEqual([]);
      expect(problems.emptyHeadings, "empty headings").toBe(0);
    });
  }

  test("external links open in a new tab safely, and say so", async ({ page }) => {
    await requireSavedDays(page);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const links = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLAnchorElement>("a[href^='http']")]
        .filter((link) => !link.href.startsWith(location.origin))
        .map((link) => ({ href: link.href, target: link.target, rel: link.rel, name: (link.innerText || link.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim() })),
    );
    expect(links.length, "the page cites its sources").toBeGreaterThan(5);
    for (const link of links) {
      expect(link.target, `${link.href} opens in a new tab`).toBe("_blank");
      expect(link.rel, `${link.href} is noopener`).toMatch(/noopener/);
      expect(link.href, "only https").toMatch(/^https:\/\//);
    }
  });
});
