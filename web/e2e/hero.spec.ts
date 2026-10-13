import { DAYS, HONESTY, literal, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/** The hero decision: one costed clash, one tested move, and "Keep this move", which keeps it in your plan in place. */

test.describe("hero decision", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("the first screen holds the clash, its score, and the one filled action", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.cardHeading).toBeInViewport();
    await expect(home.card.getByText("Clash Budget Index", { exact: true })).toBeInViewport();
    await expect(home.keepMove).toBeInViewport();
    await expect(home.card).toContainText(HONESTY.reading);
    // The index says what its scale is, with no click, beside "Lower is better".
    const scale = home.card.getByText("A score, not money: 100 = the average random valid timetable of this lineup. Lower is better.");
    await expect(scale).toBeVisible();
    await expect(scale).toBeInViewport();
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

  test("Keep this move keeps the card's move in place: no scroll, \"Kept in your plan.\", focus on See your plan", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const receipt = await home.card.getByText(/^\d+\.\d to \d+\.\d\.$/).innerText();
    const [before = "", after = ""] = receipt.match(/\d+\.\d/g) ?? [];
    const mover = (await home.cardHeading.innerText()).split(/ \d+ minutes? (earlier|later)/)[0];

    // Nothing is said about the plan before the press.
    await expect(home.keptNotice).toHaveCount(0);
    await home.keepMove.scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() => window.scrollY);
    await home.keepMove.click();

    // The card confirms in place, in ink, and moves focus to the way to the plan, not to the page.
    await expect(home.keptNotice).toBeVisible();
    await expect(home.keptNotice).toHaveText(/^Kept in your plan\.\s*See your plan$/);
    await expect(home.seeYourPlan).toHaveAttribute("href", "#your-plan");
    await expect(home.seeYourPlan).toBeFocused();
    await expect(home.cardAnnouncement).toHaveText(new RegExp(`^Testing ${literal(mover)} at \\d{2}:\\d{2}\\.`));
    // The press never scrolls the page.
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    await expect(home.keptNotice).toBeInViewport();

    // One kept move, the card's: same set, and the plan's index is the card's "after".
    const kept = home.plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem");
    await expect(kept).toHaveCount(1);
    await expect(kept).toContainText(mover);
    await expect(home.plan.getByRole("region", { name: "Your tested moves" })).toContainText(`${before}`);
    await expect(home.plan.getByRole("region", { name: "Your tested moves" })).toContainText(`${after}`);
    await expect(home.plan.getByRole("link", { name: "Open as a one-page brief" })).toHaveAttribute("href", /^\/brief\?preset=glastonbury-2025-sun&day=0&moves=/);
    expect(await page.evaluate(() => window.scrollY), "the plan filled in without moving the page").toBe(scrolled);

    // The board's own index does not change: a tested plan is previewed, never applied.
    const dial = page.getByRole("figure").filter({ hasText: "Clash Budget Index" });
    await expect(dial.getByText(before, { exact: true }).first()).toBeVisible();

    // "See your plan" takes the visitor there and gives the plan focus.
    await home.seeYourPlan.click();
    await expect(home.plan).toHaveAttribute("id", "your-plan");
    await expect(home.plan).toBeFocused();
    await expect(home.plan).toBeInViewport();
  });

  test("pressing Keep this move again does not add the move twice", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.keepMove.click();
    const kept = home.plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem");
    await expect(kept).toHaveCount(1);
    await expect(home.keptNotice).toBeVisible();

    await home.keepMove.click();
    await expect(home.cardAnnouncement).toHaveText("Already in your plan.");
    await expect(home.keptNotice).toBeVisible();
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
    // Where this day's reading came from, with its Recorded stamp.
    await expect(home.card).toContainText(/Saved Qloo reading of this day: built .+ from \d+ saved Qloo responses?\./);
    // The live re-check is offered only while this server answers live pair checks.
    const health = (await (await page.request.get("/api/health")).json()) as { pair_check?: boolean };
    if (health.pair_check !== true) await expect(home.card.getByRole("button", { name: /^Re-check this pair with Qloo/ })).toHaveCount(0);

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

  test("the second day has its own decision, and Keep this move works there too", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.riot.id);

    await expect(home.card).toContainText(`${DAYS.riot.title} · published timetable`);
    await expect(home.card).toContainText(/Taste agrees with time and draw \(Qloo popularity\): #\d+ either way\./);
    await home.keepMove.click();
    await expect(home.keptNotice).toBeVisible();
    await expect(home.plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem")).toHaveCount(1);
    await expect(home.plan.getByRole("link", { name: "Open as a one-page brief" })).toHaveAttribute("href", /preset=riot-fest-2026-sun/);
  });
});
