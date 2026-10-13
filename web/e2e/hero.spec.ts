import { DAYS, HONESTY, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/** The hero decision: one costed clash, one tested move, and the button that carries it into "Try a move". */

test.describe("hero decision", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("the first screen holds the clash, its score, and the one filled action", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.cardHeading).toBeInViewport();
    await expect(home.card.getByText("Clash Budget Index", { exact: true })).toBeInViewport();
    await expect(home.openMove).toBeInViewport();
    await expect(home.card).toContainText(HONESTY.reading);
    // The drawing says what its three kinds of line mean.
    await expect(home.card.getByRole("figure")).toContainText("Solid: where the sets play now. Dashed: tested. Hatched: time shared.");
    // The same drawing in words, for a screen reader: where each set plays now and tested, and what is shared.
    await expect(home.card.getByRole("figure")).toContainText(/Now: .* share .*, \d+ minutes\. Tested: .* leaves \d+ minutes shared\./);
  });

  test("the pitch offers a paste of the programmer's own grid", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.hero).toContainText("About a minute. Nothing leaves your browser unless you ask for prices.");
    await home.pasteLink.click();
    await expect(page).toHaveURL(/\/check$/);
    await expect(page.getByRole("heading", { level: 1, name: "Check a draft grid against your rules" })).toBeVisible();
  });

  test("\"See what Qloo changes\" jumps to the three rankings of the card's own clash", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.card.getByRole("link", { name: "See what Qloo changes" }).click();
    await expect(page).toHaveURL(/#what-qloo-changes$/);
    await expect(home.whatQloo).toBeInViewport();
    await expect(home.whatQloo).toContainText("Time only");
    await expect(home.whatQloo).toContainText("Time + draw + Qloo taste");
    await expect(home.whatQloo).toContainText("It does not prove #1 is the right clash to move.");
  });

  test("Open this move tests the card's move and carries it into Try a move", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const receipt = await home.card.getByText(/^\d+\.\d to \d+\.\d\.$/).innerText();
    const [before = "", after = ""] = receipt.match(/\d+\.\d/g) ?? [];
    const mover = (await home.cardHeading.innerText()).split(/ \d+ minutes? (earlier|later)/)[0];

    await home.openMove.click();

    // The page says what it is testing, and moves focus to the answer.
    await expect(home.card.getByRole("status")).toHaveText(new RegExp(`^Testing ${mover} at \\d{2}:\\d{2}\\.`));
    const plan = home.tryAMove.getByRole("group", { name: "Your tested moves" });
    await expect(plan).toBeVisible();
    await expect(plan).toBeFocused();
    await expect(plan).toBeInViewport();

    // One kept move, the card's: same set, and the plan's index is the card's "after".
    const kept = plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem");
    await expect(kept).toHaveCount(1);
    await expect(kept).toContainText(mover);
    await expect(plan.getByRole("region", { name: "Your tested moves" })).toContainText(`${before}`);
    await expect(plan.getByRole("region", { name: "Your tested moves" })).toContainText(`${after}`);
    await expect(plan.getByRole("link", { name: "Open as a one-page brief" })).toHaveAttribute("href", /^\/brief\?preset=glastonbury-2025-sun&day=0&moves=/);

    // The board's own index does not change: a tested plan is previewed, never applied.
    const dial = page.getByRole("figure").filter({ hasText: "Clash Budget Index" });
    await expect(dial.getByText(before, { exact: true }).first()).toBeVisible();
  });

  test("pressing Open this move again does not add the move twice", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.openMove.click();
    const kept = home.tryAMove.getByRole("list", { name: "Kept moves" }).getByRole("listitem");
    await expect(kept).toHaveCount(1);

    await home.openMove.click();
    await expect(home.card.getByRole("status")).toHaveText("Already in your plan.");
    await expect(kept).toHaveCount(1);
  });

  test("Show the working opens by click and by keyboard, and says how the clash was chosen", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.working).toBeHidden();
    await home.showWorking.click();
    await expect(home.showWorking).toHaveAttribute("aria-expanded", "true");
    await expect(home.working).toBeVisible();
    await expect(home.working.getByRole("heading", { name: "How this was chosen" })).toBeVisible();
    await expect(home.working).toContainText("Line 1");
    await expect(home.working).toContainText("It is a rank, not attendance.");
    // The two changes side by side, as a table with its figures.
    await expect(home.working.getByRole("table")).toContainText("Ends the overlap");
    await expect(home.working.getByRole("button", { name: "Open a hidden clash" })).toBeVisible();

    await home.showWorking.focus();
    await page.keyboard.press("Enter");
    await expect(home.showWorking).toHaveAttribute("aria-expanded", "false");
    await expect(home.working).toBeHidden();
    await page.keyboard.press("Space");
    await expect(home.showWorking).toHaveAttribute("aria-expanded", "true");
  });

  test("the working's hidden-clash link opens that clash's details", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.showWorking.click();
    await home.working.getByRole("button", { name: "Open a hidden clash" }).click();
    await expect(home.drawer).toBeVisible();
    await expect(home.drawer.getByRole("heading", { level: 2 })).toContainText("×");
    await page.keyboard.press("Escape");
    await expect(home.drawer).toHaveCount(0);
  });

  test("the second day has its own decision, and Open this move works there too", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.riot.id);

    await expect(home.card).toContainText(`${DAYS.riot.title} · published timetable`);
    await expect(home.card).toContainText("Taste does not change this pair’s place.");
    await home.openMove.click();
    const plan = home.tryAMove.getByRole("group", { name: "Your tested moves" });
    await expect(plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem")).toHaveCount(1);
    await expect(plan.getByRole("link", { name: "Open as a one-page brief" })).toHaveAttribute("href", /preset=riot-fest-2026-sun/);
  });
});
