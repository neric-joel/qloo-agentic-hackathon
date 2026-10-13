import { DAYS, HONESTY, requireSavedDays, scrollThrough } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { SiteChrome } from "./pages/site-chrome";
import { TryAMove } from "./pages/try-a-move";

/**
 * The site's required honesty lines. "A reading, not a verdict." qualifies every Clash Budget Index it prints;
 * "Neither festival uses Clash Control." says the two festivals shown did not ask for this. Both have to
 * survive every state the page can be in: either day, either theme, after a move, after a day switch.
 */

/** What "Where the numbers come from" says about each day, with the festival's own name. */
const SOURCES_LINE: Record<string, string> = {
  [DAYS.glastonbury.id]: "Glastonbury Festival 2025 does not use Clash Control.",
  [DAYS.riot.id]: "Riot Fest 2026 does not use Clash Control.",
};

test.describe("honesty lines", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}: both lines are on the page`, async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      // The reading sits in the decision card, in the same block as the index it qualifies.
      const reading = home.card.getByText(HONESTY.reading);
      await expect(reading).toBeVisible();
      await expect(reading).toBeInViewport();
      await expect(home.card.locator("[data-index-block]")).toContainText(HONESTY.reading);
      // The festivals did not ask for this: stated in the hero, and again where the numbers come from.
      await expect(home.hero.getByText(HONESTY.neither)).toBeVisible();
      await expect(home.hero).toContainText("Run on the public timetables of Glastonbury 2025 and Riot Fest 2026.");
      await expect(home.sources).toContainText(SOURCES_LINE[day.id]);
    });
  }

  test("the lines survive a move, a day switch and a theme change", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.openMove.click();
    await expect(new TryAMove(page).plan).toBeVisible();
    await expect(home.card).toContainText(HONESTY.reading);
    await expect(home.hero).toContainText(HONESTY.neither);

    await home.chooseDay(DAYS.riot.title);
    await expect(home.page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible();
    await expect(home.card).toContainText(HONESTY.reading);
    await expect(home.hero).toContainText(HONESTY.neither);

    await new SiteChrome(page).chooseTheme("Dark");
    await expect(home.card).toContainText(HONESTY.reading);
    await expect(home.hero).toContainText(HONESTY.neither);
  });

  test("every Clash Budget Index figure on the home page is within a block that says it is a reading", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await scrollThrough(page);

    // The card's score, the dial's score and the plan's score each carry the caveat in their own block.
    await expect(home.card.locator("[data-index-block]")).toContainText("Selected and scored by this app’s index. A reading, not a verdict.");
    const dial = page.getByRole("figure").filter({ hasText: "Clash Budget Index" });
    await expect(dial).toContainText("lower is better");
    await expect(dial).toContainText("It counts only what clashes cost: taste overlap, time shared, draw and a rarity factor.");
    await home.openMove.click();
    await expect(new TryAMove(page).planRegion).toContainText("Scored by the same measure the places are found with, so a lower number shows what that measure rewards, not that audiences would be better served.");
  });

  test("the pitch says taste overlap is a rank, not attendance, and who it is for", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.hero).toContainText("For heads of programming:");
    await expect(home.hero).toContainText("from Qloo data (a rank, not attendance)");
    await expect(home.hero).toContainText("Fans and press complained about 45 clashes at 5 festivals; the median overlap was 50 minutes.");
  });

  test("the printed brief carries the same caveats", async ({ page }) => {
    await page.goto(`/brief?preset=${DAYS.glastonbury.id}&day=0`, { waitUntil: "domcontentloaded" });
    const article = page.getByRole("article");
    await expect(article).toContainText("Glastonbury Festival 2025 does not use Clash Control.");
    await expect(article).toContainText("A reading, not a verdict on the festival.");
    await expect(article).toContainText("It measures taste, not attendance.");
    await expect(article).toContainText("not endorsed by Qloo or Glastonbury Festival 2025");
  });

  test("the footer on every page says the festivals shown do not use Clash Control", async ({ page }) => {
    for (const url of ["/", "/method", "/check"]) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("contentinfo"), url).toContainText("The festivals shown do not use Clash Control");
    }
  });
});
