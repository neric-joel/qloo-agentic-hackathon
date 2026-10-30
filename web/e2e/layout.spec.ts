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
        // The board's grid is behind its disclosure; with it open, the page still does not scroll
        // sideways (the board scrolls inside its own frame on a phone).
        if (route.url.startsWith("/?")) {
          await new HomePage(page).openBoard();
          await scrollThrough(page);
          await expectNoHorizontalScroll(page);
        }
      });
    }
  }

  test("home with the clash drawer open", async ({ page }) => {
    await requireSavedDays(page);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await home.openBoard();
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

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, a 1366 x 768 screen shows the drawing whole on the first screen; a phone's first screen holds Keep`, async ({ page, isPhone }) => {
      await requireSavedDays(page);
      const home = new HomePage(page);
      const sizes = isPhone
        ? [
            { width: 390, height: 844, keep: 787 },
            { width: 375, height: 667, keep: 760 },
          ]
        : [{ width: 1366, height: 768, keep: null }];
      for (const size of sizes) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await home.goto(day.id);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        const at = `${size.width} x ${size.height}`;
        if (size.keep === null) {
          // The layout on show ends inside the first 768 px.
          const bottom = await home.graph.evaluate((graph) => {
            const layout = [...graph.querySelectorAll(":scope > [data-layout]")].find((element) => getComputedStyle(element).display !== "none");
            return layout ? layout.getBoundingClientRect().bottom : Number.POSITIVE_INFINITY;
          });
          expect(bottom, `${at}: the drawing's bottom`).toBeLessThanOrEqual(768);
        } else {
          const keep = await home.keepMove.boundingBox();
          expect((keep?.y ?? 0) + (keep?.height ?? 0), `${at}: Keep this move's bottom`).toBeLessThanOrEqual(size.keep);
        }
      }
    });
  }

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, no text on the home page is under 12.5 px, every disclosure open, except the drawing's clock axis`, async ({ page, isPhone }) => {
      await requireSavedDays(page);
      const theme = isPhone ? "dark" : "light";
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      await page.emulateMedia({ colorScheme: theme });
      const home = new HomePage(page);
      await home.goto(day.id);
      await home.openBoard();
      await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
      await scrollThrough(page);
      // Every text node a visitor sees (not screen-reader text clipped to 1 px, not a box that is not drawn), with its
      // computed size. The one exemption, by design: the drawing's clock axis, [data-axis].
      // The type floor's known residuals are all off the home page (/check's print sheet and results,
      // the brief's print figure), so none is exempted here.
      const found = await page.evaluate(() => {
        const small: string[] = [];
        let read = 0;
        const shown = (element: Element) => {
          for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") return false;
            const box = node.getBoundingClientRect();
            if (box.width <= 1 && box.height <= 1) return false;
          }
          return true;
        };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (!parent || !node.textContent?.trim() || !shown(parent)) continue;
          if (parent.closest("[data-axis]")) continue;
          read += 1;
          const size = parseFloat(getComputedStyle(parent).fontSize);
          if (size < 12.5 - 0.01) small.push(`"${node.textContent.trim().slice(0, 40)}" ${size}px in ${parent.tagName.toLowerCase()}`);
        }
        return { read, small };
      });
      test.info().annotations.push({ type: `text nodes read on ${day.title}`, description: `${found.read}; under 12.5 px: ${found.small.length}` });
      expect(found.read, "text nodes read").toBeGreaterThan(300);
      expect(found.small, "visible text under 12.5 px").toEqual([]);
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
