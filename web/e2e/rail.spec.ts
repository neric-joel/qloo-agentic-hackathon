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
    // Hidden clashes comes second, straight after the hero pair's own three rankings. Labels only: no numerals. The
    // agent section is named for the agent ("Agent runs") while its recorded runs are shown.
    await expect(links).toHaveText(["What Qloo changes", "Hidden clashes", "Why this matters", "Timetable", "Try a move", "Agent runs", "Sources"]);
    await expect(home.agentJump).toHaveAttribute("href", "#agent");

    // Every link points at an element that exists, and the targets run down the page in the same order.
    const hrefs = await links.evaluateAll((all) => all.map((link) => link.getAttribute("href") ?? ""));
    const tops = await page.evaluate((targets) => targets.map((href) => {
      const element = document.querySelector(href);
      return element ? element.getBoundingClientRect().top + window.scrollY : null;
    }), hrefs);
    expect(tops.every((top) => top !== null), `every rail target exists: ${hrefs.join(" ")}`).toBe(true);
    expect([...tops]).toEqual([...tops].sort((a, b) => (a as number) - (b as number)));
  });

  test("a day with no hidden-clash examples of its own still has the section: its own Hidden count, and another day's examples, named", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.riot.id);

    await expect(home.railLink("Timetable")).toBeVisible();
    await expect(home.railLink("Try a move")).toBeVisible();
    await expect(home.agentJump).toHaveAttribute("href", "#agent");
    await expect(home.railLink("Hidden clashes")).toHaveAttribute("href", "#hidden-wall");
    await expect(home.hiddenWall).toBeVisible();
    // The section counts this day's own Hidden labels, and says which day its sourced examples are saved with.
    await expect(home.hiddenWall).toContainText(/On this day, \d+ of the \d+ ranked clashes (carries|carry) the Hidden label/);
    await expect(home.hiddenWall).toContainText(" sourced examples, saved with " + DAYS.glastonbury.title + ". ");
    await expect(home.hiddenWall).toContainText(/The other (one is|\d+ are) not saved with that day\./);
  });

  test("each link scrolls its section into view and becomes the current one", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    for (const label of ["Hidden clashes", "Why this matters", "Timetable", "Try a move", "Agent runs"]) {
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

  test("the last link, Sources, becomes the current section too", async ({ page }) => {
    // Was defect D1: at 1440x900 the page cannot scroll far enough to lift Sources above the
    // 40% line, so the rail now marks the last entry once the page is scrolled to its end.
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const link = home.railLink("Sources");
    await link.click();
    await expect(page.locator("#sources")).toBeInViewport();
    await expect(link).toHaveAttribute("aria-current", "location", { timeout: 3_000 });
  });

  test("Sources becomes current on a taller desktop window too (1440x1200)", async ({ page, isPhone }) => {
    test.skip(isPhone, "A tall desktop window only.");
    await page.setViewportSize({ width: 1440, height: 1200 });
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const link = home.railLink("Sources");
    await link.click();
    await expect(page.locator("#sources")).toBeInViewport();
    await expect(link).toHaveAttribute("aria-current", "location", { timeout: 3_000 });
    await expect(home.rail.locator('[aria-current="location"]')).toHaveCount(1);
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
