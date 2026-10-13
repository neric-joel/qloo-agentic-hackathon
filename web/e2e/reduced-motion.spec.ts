import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/**
 * With reduced motion the page shows every end state at once: no opening curtain, the hero's receipt already
 * at its final figures, and "Keep this move" and "See your plan" jump without a smooth scroll. The suite runs
 * with reduced motion by default; this spec says so on its own, so the promise holds if that default changes.
 */

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  /** Animations that are still running on the page. */
  const running = (page: import("@playwright/test").Page) =>
    page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length);

  test("a first visit shows no curtain, and the hero holds its final figures", async ({ page }) => {
    const home = new HomePage(page);
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    await expect(home.heading).toBeVisible();
    expect(await page.locator("html").getAttribute("data-intro")).toBeNull();
    await expect(page.locator(".cc-intro")).toBeHidden();
    await home.waitUntilReady();

    // The index block reads its result at once: the receipt's two figures are the ones the card states.
    const receipt = await home.card.getByText(/^\d+\.\d to \d+\.\d\.$/).innerText();
    const [before = "", after = ""] = receipt.match(/\d+\.\d/g) ?? [];
    await expect(home.card.locator("[data-index-block]")).toContainText(`${before} → ${after}`);
    expect(await running(page), "nothing animates under reduced motion").toBe(0);
  });

  test("Keep this move shows its end state at once and does not scroll; See your plan jumps without a smooth scroll", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.keepMove.scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() => window.scrollY);
    await home.keepMove.click();
    await expect(home.keptNotice).toBeVisible();
    await expect(home.seeYourPlan).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    expect(await running(page), "the bracket and the count do not play").toBe(0);

    // The jump lands in one step: where the page is right after the press is where it stays.
    await home.seeYourPlan.click();
    const landed = await page.evaluate(() => window.scrollY);
    expect(landed, "the page moved to the plan").toBeGreaterThan(scrolled);
    await expect(home.plan).toBeFocused();
    await expect(home.plan).toBeInViewport();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => window.scrollY), "no smooth scroll still under way").toBe(landed);
  });
});
