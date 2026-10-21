import { DAYS, expectNoHorizontalScroll, listDays, requireSavedDays, scrollThrough } from "./helpers";
import { expect, test } from "./fixtures";
import { CheckPage } from "./pages/check-page";
import { HomePage } from "./pages/home-page";
import { SiteChrome } from "./pages/site-chrome";
import { TryAMove } from "./pages/try-a-move";

/**
 * No page scrolls sideways, at 390 px (phone project) or 1440 px (desktop project), in either theme and with
 * the page's own state open: a drawer, a kept plan, the check's results. A board that scrolls inside its own
 * frame on a phone is fine; the page itself must not.
 */

const ROUTES = [
  { name: "home, Glastonbury", url: `/?preset=${DAYS.glastonbury.id}`, saved: true },
  { name: "home, Riot Fest", url: `/?preset=${DAYS.riot.id}`, saved: true },
  { name: "/method", url: "/method", saved: false },
  { name: "/check", url: "/check", saved: false },
  { name: "/brief, with a plan", url: `/brief?preset=${DAYS.glastonbury.id}&day=0&moves=gurriers~woodsies~0~1215`, saved: true },
  { name: "the 404 page", url: "/no-such-page", saved: false },
] as const;

test.describe("no horizontal scroll", () => {
  // A deliberate 404 reports itself in the console.
  test.use({ ignoreConsole: [/status of 404/] });

  for (const route of ROUTES) {
    for (const theme of ["light", "dark"] as const) {
      test(`${route.name}, ${theme} theme`, async ({ page }) => {
        if (route.saved) await requireSavedDays(page);
        await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(route.url, { waitUntil: "domcontentloaded" });
        await new SiteChrome(page).waitForHydration();
        if (route.url.startsWith("/?")) await new HomePage(page).waitUntilReady();
        await scrollThrough(page);
        await expectNoHorizontalScroll(page);
      });
    }
  }

  test("home with the clash drawer open", async ({ page }) => {
    await requireSavedDays(page);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await home.tile("Sprints").click();
    await expect(home.drawer).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("home with a plan kept, the working open and a hidden pair showing", async ({ page }) => {
    await requireSavedDays(page);
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);
    await home.showWorking.click();
    await home.keepMove.click();
    await expect(move.plan).toBeVisible();
    await home.hiddenWall.getByRole("button", { name: "Next pair" }).click();
    await expectNoHorizontalScroll(page);
  });

  test("/check with every row, every pair, a price answer and a working copy", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.page.getByRole("button", { name: "Show all rows" }).click();
    await check.sharedSection.getByRole("button", { name: "Show all 35" }).click();
    await check.priceButton.click();
    await expect(check.priceSection).toContainText("No Qloo request was sent.");
    await check.rulesSection.getByRole("button", { name: /^Find a change : Willow Circuit and Neon Garden/ }).click();
    await check.page.getByRole("button", { name: "Try it" }).first().click();
    await expect(check.page.getByRole("region", { name: "Working copy" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // The CSV view and the open rules.
    await check.csvView.click();
    await check.page.getByRole("group").filter({ hasText: "Rules this check applies" }).locator("summary").click();
    await expectNoHorizontalScroll(page);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`/check does not shift while it loads (${theme} theme): layout shift 0.000 over 5 s`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      await page.emulateMedia({ colorScheme: theme });
      // A buffered layout-shift observer from navigation, registered before the page's own scripts.
      await page.addInitScript(() => {
        const store = window as unknown as { __shift: number; __entries: number };
        store.__shift = 0;
        store.__entries = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (entry.hadRecentInput) continue;
            store.__shift += entry.value;
            store.__entries += 1;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto("/check", { waitUntil: "domcontentloaded" });
      // The published day's action arrives after the API answers; its place is held, so nothing moves when it does.
      const days = await listDays(page);
      if (days.some((day) => !day.synthetic)) await expect(page.getByRole("button", { name: /^Check a published day: / })).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => page.evaluate(() => performance.now()), { timeout: 20_000, message: "5 s on the page" }).toBeGreaterThanOrEqual(5_000);
      const { shift, entries } = await page.evaluate(() => {
        const store = window as unknown as { __shift: number; __entries: number };
        return { shift: store.__shift, entries: store.__entries };
      });
      test.info().annotations.push({ type: `/check layout shift, ${theme}`, description: `${shift.toFixed(4)} (${entries} entries)` });
      expect(Number(shift.toFixed(3)), "cumulative layout shift over 5 s, to three places").toBe(0);
    });
  }

  test("the menu open on a phone", async ({ page, isPhone }) => {
    test.skip(!isPhone, "Phone layout only.");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    await chrome.waitForHydration();
    await chrome.openMenuIfCollapsed();
    await expectNoHorizontalScroll(page);
  });

  test("the viewport widths between the two projects, on the home page", async ({ page, isPhone }) => {
    test.skip(isPhone, "The desktop project sweeps the widths between 390 and 1440.");
    await requireSavedDays(page);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    for (const width of [360, 390, 600, 768, 1024, 1280, 1536]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalScroll(page);
    }
  });
});
