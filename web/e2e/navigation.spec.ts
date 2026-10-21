import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { SiteChrome } from "./pages/site-chrome";

/** The header, the footer, and the page that is not there. */

test.describe("site navigation", () => {
  test("the header links reach /method and /check, mark the current page, and the logo goes home", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    await chrome.waitForHydration();

    await (await chrome.siteLink("How we know")).click();
    await expect(page).toHaveURL(/\/method$/);
    await expect(page.getByRole("heading", { level: 1, name: "How we know" })).toBeVisible();
    await expect(await chrome.siteLink("How we know")).toHaveAttribute("aria-current", "page");
    await expect(await chrome.siteLink("Check a draft grid")).not.toHaveAttribute("aria-current", "page");

    await (await chrome.siteLink("Check a draft grid")).click();
    await expect(page).toHaveURL(/\/check$/);
    await expect(page.getByRole("heading", { level: 1, name: "Check a draft grid against your rules" })).toBeVisible();
    await expect(await chrome.siteLink("Check a draft grid")).toHaveAttribute("aria-current", "page");

    await chrome.homeLink.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Which clash is worth moving?" })).toBeVisible();
  });

  test("the footer repeats the two links and says where the figures come from", async ({ page }) => {
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    await expect(chrome.footer).toContainText("Clash Control");
    await expect(chrome.footer.getByRole("link", { name: "How we know" })).toHaveAttribute("href", "/method");
    await expect(chrome.footer.getByRole("link", { name: "Check a draft grid" })).toHaveAttribute("href", "/check");
    await expect(chrome.footer).toContainText(
      "Popularity and audience comparisons are saved Qloo responses; taste overlap and prices are calculated by this app from them.",
    );
    await chrome.footer.getByRole("link", { name: "Check a draft grid" }).click();
    await expect(page).toHaveURL(/\/check$/);
  });

  test("on a phone the two links are behind a Menu button that opens, closes with Escape, and closes on a link", async ({ page, isPhone }) => {
    test.skip(!isPhone, "The Menu button exists under 640 px only.");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    await chrome.waitForHydration();

    await expect(page.getByRole("navigation", { name: "Site" })).toHaveCount(0); // the closed panel and the desk row are both out of the tree
    await expect(chrome.menuButton).toHaveAttribute("aria-expanded", "false");
    await chrome.menuButton.click();
    await expect(chrome.menuButton).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByRole("navigation", { name: "Site" });
    await expect(panel.getByRole("link")).toHaveText(["How we know", "Check a draft grid"]);

    await page.keyboard.press("Escape");
    await expect(chrome.menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(chrome.menuButton).toBeFocused();

    await chrome.menuButton.click();
    await panel.getByRole("link", { name: "How we know" }).click();
    await expect(page).toHaveURL(/\/method$/);
    await expect(chrome.menuButton).toHaveAttribute("aria-expanded", "false");
  });

  test("the skip link is the first stop, appears on focus, and moves to the main content", async ({ page, isPhone }) => {
    test.skip(isPhone, "Keyboard path.");
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    await chrome.waitForHydration();

    await page.keyboard.press("Tab");
    await expect(chrome.skipLink).toBeFocused();
    await expect(chrome.skipLink).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator("#main")).toBeInViewport();
  });
});

test.describe("the section nav under the hero", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, it names the agent section "Agent runs", and at 1440 x 900 that link is on the first screen`, async ({ page, isPhone }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      // The word "agent" is on the first screen: the jump link to the recorded runs is named for the agent.
      await expect(home.agentJump).toHaveCount(1);
      await expect(home.agentJump).toHaveAttribute("href", "#agent");
      await expect(home.rail.getByRole("link", { name: "Recorded runs" })).toHaveCount(0);
      if (!isPhone) {
        await expect(home.agentJump).toBeInViewport({ ratio: 1 });
        const box = await home.agentJump.boundingBox();
        expect((box?.y ?? 0) + (box?.height ?? 0), "the link ends inside the first 900 px").toBeLessThanOrEqual(900);
      }
      // It leads to the agent section, which says what it holds.
      await home.agentJump.click();
      await expect(page).toHaveURL(/#agent$/);
      await expect(home.agent).toBeInViewport();
      await expect(home.agent.getByRole("heading", { level: 2 })).toHaveText("Recorded agent runs");
    });
  }
});

test.describe("page not found", () => {
  // The browser reports the 404 of the page itself as a console error.
  test.use({ ignoreConsole: [/status of 404/] });

  test("an unknown address answers 404 with a page that says so and offers the way home", async ({ page }) => {
    const response = await page.goto("/no-such-page", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(404);

    await expect(page).toHaveTitle("Page not found | Clash Control");
    await expect(page.getByText("Error 404", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(/^Off the\s*bill$/);
    await expect(page.getByText("That page is not on the lineup. Head back to the start.")).toBeVisible();
    // The site's header and footer are still there.
    const chrome = new SiteChrome(page);
    await expect(chrome.header).toBeVisible();
    await expect(chrome.footer).toBeVisible();

    await chrome.waitForHydration();
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Which clash is worth moving?" })).toBeVisible();
  });

  for (const path of ["/method/nope", "/check/nope", "/brief/nope", "/index.html", "/%00"]) {
    test(`${path} is a 404 page, not an error`, async ({ page }) => {
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(404);
      await expect(page.getByText("Error 404", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
    });
  }
});
