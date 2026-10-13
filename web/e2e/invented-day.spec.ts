import { HONESTY } from "./helpers";
import { expect, test } from "./fixtures";
import { serveInventedDay } from "./invented-day";
import { HomePage } from "./pages/home-page";
import { TryAMove } from "./pages/try-a-move";

/**
 * The invented example day (Lanternfield): what a clone with no built festival day serves. The local API has
 * built days, so the browser's /api/presets requests are answered from fixtures made by the backend's own
 * generator (see fixtures/generate-invented-day.py). The page must say, everywhere it shows figures, that
 * the day is invented and that no Qloo request was made.
 */

test.describe("invented example day", () => {
  test("loads, and says on the page that it is invented", async ({ page }) => {
    const day = await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();

    // The notice, the hero note, the board's dateline and the footer all say so. (The pitch's lede is drawn
    // by the server from its own reading of the day, which here is the real one, so it is not asserted.)
    await expect(page.getByRole("complementary", { name: "Synthetic data notice" })).toContainText(
      "Synthetic example day: invented acts, no Qloo data",
    );
    await expect(home.hero).toContainText("Shown here on an invented day");
    await expect(home.hero).toContainText("no Qloo request was made");
    await expect(page.getByText(/^Invented timetable · /)).toContainText("Lanternfield Friday (synthetic demo)");
    await expect(home.chrome.footer).toContainText("an invented example day, not a festival");
    await expect(home.chrome.footer).toContainText("no Qloo request was made");
    await expect(home.dayPicker).toHaveCount(0); // one day: no picker

    // It is a full day: a decision card, a score, and a board of the invented sets.
    await expect(home.cardHeading).toHaveAccessibleName(/ \d+ to \d+ minutes shared$/);
    await expect(home.card).toContainText(HONESTY.reading);
    await expect(home.card).toContainText("invented");
    // The index scale reads the same on the invented day; "draw" is glossed as invented popularity, and the card
    // names no saved Qloo reading.
    await expect(home.card).toContainText("A score, not money: 100 = the average random valid timetable of this lineup. Lower is better.");
    await expect(home.card).not.toContainText("Qloo popularity");
    await home.showWorking.click();
    await expect(home.working).toBeVisible();
    await expect(home.card).not.toContainText("Saved Qloo reading");
    // The dateline names no saved Qloo reading here either, and nothing in the card credits Qloo.
    await expect(home.card).not.toContainText(/saved Qloo reading|Qloo requests in this run/i);
    await expect(home.card.getByRole("button", { name: /^Re-check this pair with Qloo/ })).toHaveCount(0);
    await expect(home.board.getByRole("button")).toHaveCount(24);
    expect(day.served.some((line) => line.endsWith("/decision"))).toBe(true);
  });

  test("the card's move prices through the same engine", async ({ page }) => {
    const day = await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();

    await home.keepMove.click();
    await expect(home.keptNotice).toBeVisible();
    const plan = home.tryAMove.getByRole("region", { name: "Your tested moves" });
    await expect(plan).toBeVisible();
    await expect(plan.getByRole("list", { name: "Kept moves" })).toContainText("Neon Garden");
    await expect(plan.getByRole("link", { name: "Open as a one-page brief" })).toHaveAttribute(
      "href",
      new RegExp(`^/brief\\?preset=${day.id}&day=0&moves=act-16~grove~0~1300$`),
    );
  });

  test("a set's legal places are listed and priced", async ({ page }) => {
    await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();

    // Pick the first set the page suggests to start with. From 1024 px its best tested place comes first and the
    // full list opens from it; below 1024 px the list shows at once.
    const move = new TryAMove(page);
    await move.starters.getByRole("button").first().click();
    const places = move.places;
    const show = move.bestPlace.getByRole("button", { name: "Show every legal place" });
    await expect(places.or(show).first()).toBeVisible();
    if (await show.isVisible()) await show.click();
    await expect(places).toBeVisible();
    await expect(places.getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
    await expect(places.getByRole("button").first()).toHaveAccessibleName(/Clash Budget Index \d+\.\d/);
  });

  test("/method says the day it shows is invented", async ({ page }) => {
    await serveInventedDay(page);
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "How we know" })).toBeVisible();
    await expect(page.getByRole("article")).toContainText("The day this server is showing is an invented example");
    // The failed pre-set test is on the page whichever day is showing.
    await expect(page.getByRole("article")).toContainText("The test we set before building failed.");
  });
});
