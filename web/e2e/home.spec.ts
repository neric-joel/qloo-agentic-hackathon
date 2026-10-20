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
      // The day against random valid timetables, said by this index with the day's own figure and its direction
      // (100 is the average random valid timetable; higher is more clash cost), beside "Lower is better".
      await expect(dial).toContainText(
        `By this index, the published timetable scores ${before}, where 100 is the average random valid timetable and higher means more clash cost.`,
      );
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

  /** The home length budget (round 33, R2): 6,800 px at 1440 px in the light theme, 11,800 px at 390 px in the dark. */
  const BUDGET = {
    desktop: { width: 1440, theme: "light", ceiling: 6_800 },
    phone: { width: 390, theme: "dark", ceiling: 11_800 },
  } as const;

  test("the home page is at most 6,800 px tall at 1440 px light, and at most 11,800 px at 390 px dark", async ({ page, isPhone }) => {
    const budget = isPhone ? BUDGET.phone : BUDGET.desktop;
    expect(page.viewportSize()?.width, "measured at the budget's width").toBe(budget.width);
    await page.addInitScript((theme) => localStorage.setItem("theme", theme), budget.theme);
    await page.emulateMedia({ colorScheme: budget.theme });
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    expect(await home.chrome.appliedTheme(), "measured in the budget's theme").toBe(budget.theme);
    await scrollThrough(page);

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const label = `home height at ${budget.width} ${budget.theme}`;
    test.info().annotations.push({ type: label, description: `${height} px` });
    expect(height, `${label}: ${height} px`).toBeLessThanOrEqual(budget.ceiling);
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
