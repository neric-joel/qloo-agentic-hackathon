import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/** The section rail under the hero: one link per section, in page order, each landing on its section. */

test.describe("section rail", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("Glastonbury lists seven sections, in the order they appear on the page", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const links = home.rail.getByRole("link");
    await expect(links).toHaveText([
      /What Qloo changes/,
      /Why this matters/,
      /Timetable/,
      /Hidden clashes/,
      /Try a move/,
      /Recorded runs/,
      /Sources/,
    ]);

    // Every link points at an element that exists, and the targets run down the page in the same order.
    const hrefs = await links.evaluateAll((all) => all.map((link) => link.getAttribute("href") ?? ""));
    const tops = await page.evaluate((targets) => targets.map((href) => {
      const element = document.querySelector(href);
      return element ? element.getBoundingClientRect().top + window.scrollY : null;
    }), hrefs);
    expect(tops.every((top) => top !== null), `every rail target exists: ${hrefs.join(" ")}`).toBe(true);
    expect([...tops]).toEqual([...tops].sort((a, b) => (a as number) - (b as number)));
  });

  test("a day without hidden-clash examples has no Hidden clashes link", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.riot.id);

    await expect(home.railLink("Timetable")).toBeVisible();
    await expect(home.railLink("Try a move")).toBeVisible();
    await expect(home.railLink("Hidden clashes")).toHaveCount(0);
    await expect(home.hiddenWall).toHaveCount(0);
  });

  test("each link scrolls its section into view and becomes the current one", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    for (const label of ["Why this matters", "Timetable", "Hidden clashes", "Try a move", "Recorded runs"]) {
      const link = home.railLink(label);
      const href = await link.getAttribute("href");
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.locator(href as string), `${label} section in view`).toBeInViewport();
      await expect(link, `${label} is the current section`).toHaveAttribute("aria-current", "location");
      // Only the current section is marked.
      await expect(home.rail.locator('[aria-current="location"]')).toHaveCount(1);
    }
  });

  test("the last link, Sources, becomes the current section too", async ({ page, isPhone }) => {
    // DEFECT (app): the current section is the last one whose top is above 40% of the viewport
    // (JumpNav in clash-control.tsx). "Sources" is the last section, so the page cannot scroll far enough to
    // lift its top above that line when the viewport is tall: at 1440x900 its top rests at y=435 against a
    // line of y=360, and the marker stays on "Recorded runs" after "Sources" is pressed. Phone sizes pass.
    // Repro: open /, at 1440x900 press "Sources" in the section rail and read which link is marked current.
    test.fail(!isPhone, "Sources never becomes the current rail item at 1440x900 (see comment)");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const link = home.railLink("Sources");
    await link.click();
    await expect(page.locator("#sources")).toBeInViewport();
    await expect(link).toHaveAttribute("aria-current", "location", { timeout: 3_000 });
  });

  test("the bar stays under the header while a section is read (from 768 px)", async ({ page, isPhone }) => {
    test.skip(isPhone, "On a phone the bar scrolls away with the page; it only sticks from 768 px.");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.railLink("Try a move").click();
    await expect(home.rail).toBeInViewport();
    const [header, rail] = await Promise.all([home.chrome.header.boundingBox(), home.rail.boundingBox()]);
    expect(rail?.y, "the rail sits directly under the 64 px header").toBeGreaterThanOrEqual((header?.height ?? 0) - 1);
    expect(rail?.y).toBeLessThan((header?.height ?? 0) + 8);
    // The section heading lands clear of the bar, not under it.
    const heading = await home.tryAMove.getByRole("heading", { level: 2 }).boundingBox();
    expect(heading?.y).toBeGreaterThan((rail?.y ?? 0) + (rail?.height ?? 0));
  });

  test("on a phone the rail is one row that scrolls sideways", async ({ page, isPhone }) => {
    test.skip(!isPhone, "Phone layout only.");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const list = home.rail.getByRole("list");
    const { scrollWidth, clientWidth } = await list.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(scrollWidth, "seven links do not fit in 390 px").toBeGreaterThan(clientWidth);
    // The page itself does not scroll sideways because of it.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await home.railLink("Sources").scrollIntoViewIfNeeded();
    await expect(home.railLink("Sources")).toBeInViewport();
  });
});
