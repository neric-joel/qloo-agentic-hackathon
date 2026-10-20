import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/** Hidden clashes: sourced pairs the press or fans called out, with no genre tag in common. Examples, not a detector. */

test.describe("hidden clashes", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("shows eight sourced examples one pair at a time, each with its ranks and press link", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const wall = home.hiddenWall;
    await expect(wall).toBeVisible();
    await expect(wall.getByRole("heading", { level: 2 })).toHaveText("Hidden clashes: 8 called-out pairs with no genre tag in common");
    const previous = wall.getByRole("button", { name: "Previous pair" });
    const next = wall.getByRole("button", { name: "Next pair" });
    const position = wall.getByText(/^Pair \d+ of 8: /);

    await expect(position).toHaveText(/^Pair 1 of 8: /);
    await expect(previous).toBeDisabled();
    const seen = new Set<string>();
    for (let n = 1; n <= 8; n++) {
      await expect(position).toHaveText(new RegExp(`^Pair ${n} of 8: `));
      const pair = wall.getByRole("group", { name: new RegExp(`^Pair ${n} of 8: `) });
      const title = await pair.getByRole("heading", { level: 3 }).innerText();
      expect(seen.has(title), `pair ${n} (${title}) is a new pair`).toBe(false);
      seen.add(title);
      await expect(pair).toContainText("No genre tag in common.");
      await expect(pair.getByRole("term").filter({ hasText: "Taste overlap rank" })).toBeVisible();
      await expect(pair.getByRole("term").filter({ hasText: "Draw rank" })).toBeVisible();
      await expect(pair.getByText("Source: Recorded")).toBeVisible();
      // The press source opens in a new tab and says so.
      const source = pair.getByRole("link", { name: /\(opens in a new tab\)$/ });
      await expect(source).toHaveAttribute("target", "_blank");
      await expect(source).toHaveAttribute("rel", /noopener/);
      if (n < 8) await next.click();
    }
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();
    expect(seen.size).toBe(8);
  });

  test("the arrow keys, Home and End step through the pairs", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const wall = home.hiddenWall;
    const position = wall.getByText(/^Pair \d+ of 8: /);
    await wall.getByRole("button", { name: "Next pair" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(position).toHaveText(/^Pair 2 of 8: /);
    await page.keyboard.press("ArrowLeft");
    await expect(position).toHaveText(/^Pair 1 of 8: /);
    await page.keyboard.press("End");
    await expect(position).toHaveText(/^Pair 8 of 8: /);
    await page.keyboard.press("Home");
    await expect(position).toHaveText(/^Pair 1 of 8: /);
  });

  test("says these are examples, not a test, and how many were saved", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const wall = home.hiddenWall;
    await expect(wall).toContainText("These are examples with their sources, not a test of how well the measure spots such clashes.");
    await expect(wall).toContainText(/Showing 8 of \d+ sourced examples\. The other \d+ are not saved with this day\./);
    await expect(wall).toContainText("Both ranks run 0 to 100 within that day’s clashes");
    // The wall is part of the page, not a claim of detection: it names the pairs as called-out, with sources.
    await expect(wall).toContainText("pairs the press or fans called out with no genre tag in common");
  });

  test("a hidden clash on the board is marked, and opens like any other", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    // Sprints and Katy J Pearson share no main genre, yet their taste overlap is among the day's highest.
    await expect(home.costliest.getByRole("button", { name: /^Clash 1 Sprints and Katy J Pearson Hidden clash/ })).toBeVisible();
    await home.costliest.getByRole("button", { name: /^Clash 1 / }).click();
    await expect(home.drawer).toContainText("Hidden clash");
    await expect(home.drawer.getByRole("heading", { name: "Label and confidence" })).toBeVisible();
  });
});
