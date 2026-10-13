import { DAYS, HONESTY, requireSavedDays, scrollThrough } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/** The home page loads on each saved festival day, switches between them, and keeps its two honesty lines. */

for (const day of Object.values(DAYS)) {
  test.describe(`home on ${day.title}`, () => {
    test.beforeEach(async ({ page }) => requireSavedDays(page));

    test("loads with the pitch, the decision card, the score and the board", async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      await expect(page).toHaveTitle(/Clash Control/);
      await expect(home.heading).toBeVisible();
      await expect(home.hero).toContainText("equal-length clashes can cost very different amounts");
      await expect(home.hero).toContainText("a rank, not attendance");
      // The lede says the app scores each clash; the card says the score is not money.
      await expect(home.hero).toContainText("Clash Control scores each by its audiences’ taste overlap, from Qloo data (a rank, not attendance).");

      // The decision card: a dateline naming the day, the receipt as its heading, the score and its caveat.
      await expect(home.card).toContainText(`${day.title} · published timetable`);
      await expect(home.cardHeading).toHaveAccessibleName(/ \d+ to \d+ minutes shared$/);
      await expect(home.card.getByText("Clash Budget Index", { exact: true })).toBeVisible();
      await expect(home.keepMove).toBeVisible();
      await expect(home.showWorking).toHaveAttribute("aria-expanded", "false");

      // The board names the day it shows, and draws as many sets as its heading counts.
      await expect(home.page.getByText(`Published timetable · ${day.title}`)).toBeVisible();
      const [, stages, sets] = /(\d+) stages, (\d+) sets/.exec(await home.boardTitle()) ?? [];
      expect(Number(stages), "stages in the heading").toBeGreaterThanOrEqual(2);
      await expect(home.board.getByRole("button")).toHaveCount(Number(sets));
      await expect(home.dayPicker.getByRole("radio", { name: day.title })).toBeChecked();
    });

    test("the card's starting score is the day's published Clash Budget Index", async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      const receipt = await home.card.getByText(/^\d+\.\d to \d+\.\d\.$/).innerText();
      const [before = "", after = ""] = receipt.match(/\d+\.\d/g) ?? [];
      expect(Number(after), "a move lowers the index").toBeLessThan(Number(before));

      const dial = page.getByRole("figure").filter({ hasText: "Clash Budget Index" });
      await expect(dial.getByText(before, { exact: true }).first()).toBeVisible();
      // The day against random valid timetables, said by this index and in a neutral form, beside "Lower is better".
      await expect(dial).toContainText(/By this index, the published timetable scores \d+% (above|below) the average random valid timetable\./);
      await expect(dial).toContainText("Lower is better");
    });

    test("says it is a reading, and that neither festival uses Clash Control", async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      await expect(home.card).toContainText("A reading, not a verdict.");
      await expect(home.hero).toContainText(HONESTY.neither);
      await expect(home.sources).toContainText("does not use Clash Control");
      await expect(home.chrome.footer).toContainText("The festivals shown do not use Clash Control");
    });
  });
}

test.describe("home page length", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  /** A ceiling with margin over the 6,800 px target at 1440 px: it catches growth, it does not pin a pixel. */
  const CEILING = 7_000;

  test(`at 1440 px the home page is at most ${CEILING.toLocaleString("en-US")} px tall`, async ({ page, isPhone }) => {
    test.skip(isPhone, "The length budget is measured at 1440 px.");
    // Known defect D5 (round 32): the page measures about 7,980 px at 1440 x 900 on Glastonbury, over this
    // ceiling (home lane budget L1). Repro: open /?preset=glastonbury-2025-sun at 1440 x 900, wait for the
    // board, read document.documentElement.scrollHeight. Remove this mark when the page fits.
    test.fail(true, "D5: the home page is taller than the 7,000 px ceiling at 1440 px");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await scrollThrough(page);

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    test.info().annotations.push({ type: "home height at 1440", description: `${height} px` });
    expect(height, `home height at 1440: ${height} px`).toBeLessThanOrEqual(CEILING);
  });
});

test.describe("switching festival day", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("the picker moves between the two days and the URL follows", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    const first = await home.cardHeading.innerText();

    await home.chooseDay(DAYS.riot.title);
    await expect(page).toHaveURL(new RegExp(`preset=${DAYS.riot.id}`));
    await expect(home.page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible();
    await expect(home.dayPicker.getByRole("radio", { name: DAYS.riot.title })).toBeChecked();
    await expect(home.cardHeading).not.toHaveText(first);
    await expect(home.tile("Bowling for Soup")).toBeVisible();
    await expect(home.tile("Sprints")).toHaveCount(0);

    await home.chooseDay(DAYS.glastonbury.title);
    await expect(page).toHaveURL(new RegExp(`preset=${DAYS.glastonbury.id}`));
    await expect(home.tile("Sprints")).toBeVisible();
  });

  test("without a preset the first saved day opens", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.page.getByText(/^Published timetable · /)).toContainText(DAYS.glastonbury.title);
  });

  test("a day id the server does not have falls back to the first saved day", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto("no-such-festival-day");
    await expect(home.page.getByText(/^Published timetable · /)).toContainText(DAYS.glastonbury.title);
    await expect(home.dayPicker.getByRole("radio", { name: DAYS.glastonbury.title })).toBeChecked();
  });
});
