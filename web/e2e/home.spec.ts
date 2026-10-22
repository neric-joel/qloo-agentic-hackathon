import { DAYS, HONESTY, requireSavedDays, scrollThrough } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/** The home page loads on each saved festival day, switches between them, and keeps its two honesty lines. */

/** The lede on a published day: who it is for, the frame, the stake, then what to compare (owner-ordered closeout, round 37, 22 Oct 2026). */
const LEDE = "For heads of programming: Qloo taste data used to schedule, not to recommend. Clashes make people choose. Compare time, popularity, taste.";

for (const day of Object.values(DAYS)) {
  test.describe(`home on ${day.title}`, () => {
    test.beforeEach(async ({ page }) => requireSavedDays(page));

    test("loads with the pitch, the drawn day, the decision group, the index card and the board", async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      await expect(page).toHaveTitle(/Clash Control/);
      await expect(home.heading).toBeVisible();
      // The lede says who it is for and the frame (Qloo taste data used to schedule, not to recommend), then what the
      // ranking reads; the attendance qualifier sits beside the taste number, in the group's taste line.
      await expect(home.lede).toHaveText(LEDE);
      await expect(home.tasteLine).toContainText("(a rank, not attendance)");

      // The hero: the picker on this day, the dateline naming the day, the day drawn, and the decision group with
      // its move, readout and the one filled action.
      await expect(home.dayPicker.getByRole("radio", { name: day.festival })).toBeChecked();
      // Both saved days were read with no location sent, so the dateline calls the reading global.
      await expect(home.dateline).toContainText(`${day.dayName}. Published timetable; saved global Qloo reading built `);
      await expect(home.graph).toBeVisible();
      await expect(home.graph).toHaveAccessibleName(new RegExp(`^${day.title}, drawn with .+: \\d+ sets on \\d+ stages$`));
      // The key says what the drawing's lines, their width and its dashes mean, and names any overlap the move
      // changes that the ranked list does not hold (Riot Fest: the one the move ends), with "not ranked". Round 37
      // (L5): it also says what the lock and the dotted bars mean, each sentence only on a day that draws the mark, and
      // both published days draw both.
      await expect(home.graphKey).toHaveText(
        /^Lines: the \d+ costliest of \d+ scored clashes \(\d+ in all\)(, plus the chosen clash)?(, plus (the overlap the move (ends|shortens|lengthens)|\d+ overlaps the move changes)( \((\d+ )?not ranked\))?)?; thicker means a higher taste overlap rank\. Dashed: published slot or new overlap\. Lock: fixed by this app\. Dotted: no Qloo signal\.$/,
      );
      await expect(home.moveLead).toHaveText(/ \d+ minutes? (earlier|later)$/);
      await expect(home.readout).toHaveText(/^\d+ →\s+to \d+ min shared with .+$/);
      await expect(home.keepMove).toBeVisible();

      // The index card under the hero: the score and its caveat, the working closed.
      await expect(home.details.getByText("Clash Budget Index", { exact: true })).toBeVisible();
      await expect(home.showWorking).toHaveAttribute("aria-expanded", "false");

      // The board names the day it shows, and draws as many sets as its heading counts. Round 37 (AO1): the grid is
      // behind one closed disclosure whose summary counts what it shows; a press opens it.
      await expect(home.page.getByText(`Published timetable · ${day.title}`)).toBeVisible();
      const [, stages, sets] = /(\d+) stages, (\d+) sets/.exec(await home.boardTitle()) ?? [];
      expect(Number(stages), "stages in the heading").toBeGreaterThanOrEqual(2);
      expect(await home.boardOpen(), "the board's disclosure is closed on arrival").toBe(false);
      await expect(home.boardFoldSummary).toHaveText(`Show ${sets} sets on ${stages} stages`);
      await home.openBoard();
      await expect(home.board.getByRole("button")).toHaveCount(Number(sets));
      // The drawing draws the same day: as many sets and stages as the board.
      await expect(home.graph).toHaveAccessibleName(new RegExp(`: ${sets} sets on ${stages} stages$`));
    });

    test("the server's own HTML carries the lede, word for word, before any script runs", async ({ page }) => {
      const html = await (await page.request.get(`/?preset=${day.id}`)).text();
      expect(html, "the server HTML holds the lede").toContain(`>${LEDE}<`);
    });

    test("the index card's starting score is the day's published Clash Budget Index", async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      const { before, after } = await home.indexFigures();
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

      // Beside the move in the hero, and again in the index's own block.
      await expect(home.attribution).toContainText(HONESTY.reading);
      await expect(home.indexBlock).toContainText(HONESTY.reading);
      await expect(home.hero).toContainText(HONESTY.neither);
      await expect(home.sources).toContainText("does not use Clash Control");
      await expect(home.chrome.footer).toContainText("The festivals shown do not use Clash Control");
    });
  });
}

test.describe("home page length", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  /**
   * The home length budget (round 33, R2: 6,800 px at 1440 px in the light theme, 11,800 px at 390 px in the dark).
   * Round 37 (AO1, L30): with the board's grid behind its closed disclosure the ceilings fall to 6,400 and 10,900 px
   * (NEXT.md 5.4), measured with every disclosure closed, as the page arrives.
   */
  const BUDGET = {
    desktop: { width: 1440, theme: "light", ceiling: 6_400 },
    phone: { width: 390, theme: "dark", ceiling: 10_900 },
  } as const;

  test("the home page is at most 6,400 px tall at 1440 px light, and at most 10,900 px at 390 px dark", async ({ page, isPhone }) => {
    const budget = isPhone ? BUDGET.phone : BUDGET.desktop;
    expect(page.viewportSize()?.width, "measured at the budget's width").toBe(budget.width);
    await page.addInitScript((theme) => localStorage.setItem("theme", theme), budget.theme);
    await page.emulateMedia({ colorScheme: budget.theme });
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    expect(await home.chrome.appliedTheme(), "measured in the budget's theme").toBe(budget.theme);
    await scrollThrough(page);
    expect(await page.evaluate(() => [...document.querySelectorAll("details")].filter((details) => details.open).length), "every disclosure closed").toBe(0);

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
    const first = await home.moveLead.innerText();

    await home.chooseDay(DAYS.riot.festival);
    await expect(page).toHaveURL(new RegExp(`preset=${DAYS.riot.id}`));
    await expect(home.page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible();
    await expect(home.dayPicker.getByRole("radio", { name: DAYS.riot.festival })).toBeChecked();
    await expect(home.moveLead).not.toHaveText(first);
    // The drawing and the board both show the new day (the board read with its disclosure open).
    await expect(home.graph).toHaveAccessibleName(new RegExp(`^${DAYS.riot.title}, `));
    await home.openBoard();
    await expect(home.tile("Bowling for Soup")).toBeVisible();
    await expect(home.tile("Sprints")).toHaveCount(0);

    await home.chooseDay(DAYS.glastonbury.festival);
    await expect(page).toHaveURL(new RegExp(`preset=${DAYS.glastonbury.id}`));
    await home.openBoard();
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
    await expect(home.dayPicker.getByRole("radio", { name: DAYS.glastonbury.festival })).toBeChecked();
  });
});
