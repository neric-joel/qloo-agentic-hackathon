import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/**
 * The opening curtain: it plays once, on a first visit to the home page, when the device allows motion. Any
 * key, press or wheel skips it, it never replays within the visit, and it is never in the way of reduced motion.
 */

test.describe("opening curtain, with motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("plays on the first visit, and a key skips it and shows the hero", async ({ page }) => {
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-intro", "play");
    await expect(page.locator(".cc-intro")).toBeVisible();
    // The curtain is decoration: hidden from assistive technology, and the page behind it is already in the tree.
    await expect(page.locator(".cc-intro")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("heading", { level: 1, name: "Which clash is worth moving?" })).toBeAttached();

    await page.keyboard.press("Space");
    await expect(html).toHaveAttribute("data-intro", "done");
    await expect(page.locator(".cc-intro")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Which clash is worth moving?" })).toBeInViewport();
    expect(await page.evaluate(() => sessionStorage.getItem("cc.intro.v2"))).toBe("1");
  });

  test("lifts by itself within a few seconds", async ({ page }) => {
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-intro", "play");
    await expect(page.locator("html")).toHaveAttribute("data-intro", "done", { timeout: 9_000 });
    await expect(page.locator(".cc-intro")).toBeHidden();
  });

  test("a press on the curtain lifts it and does not press the control beneath", async ({ page }) => {
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-intro", "play");
    // Press where the hero's link sits; the curtain takes it.
    await page.mouse.click(40, 40);
    await expect(page.locator("html")).toHaveAttribute("data-intro", "done");
    await expect(page).toHaveURL(new RegExp(`/\\?preset=${DAYS.glastonbury.id}$`));
  });

  test("does not replay on a reload, or when the home page is visited again in the same tab", async ({ page }) => {
    const home = new HomePage(page);
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-intro", "play");
    await page.keyboard.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-intro", "done");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(home.heading).toBeVisible();
    expect(await page.locator("html").getAttribute("data-intro")).not.toBe("play");

    await page.goto("/method", { waitUntil: "domcontentloaded" });
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    await expect(home.heading).toBeVisible();
    expect(await page.locator("html").getAttribute("data-intro")).not.toBe("play");
  });

  test("a first visit that is not the bare home page does not play it", async ({ page }) => {
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "How we know" })).toBeVisible();
    expect(await page.locator("html").getAttribute("data-intro")).not.toBe("play");
    await page.goto("/#why-this-matters", { waitUntil: "domcontentloaded" });
    expect(await page.locator("html").getAttribute("data-intro")).not.toBe("play");
  });
});

test.describe("opening curtain, with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("never plays", async ({ page }) => {
    await requireSavedDays(page);
    const home = new HomePage(page);
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    await expect(home.heading).toBeVisible();
    expect(await page.locator("html").getAttribute("data-intro")).toBeNull();
    await expect(page.locator(".cc-intro")).toBeHidden();
    await home.waitUntilReady();
  });
});
