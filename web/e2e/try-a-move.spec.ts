import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { minutes, parsePlace, TryAMove } from "./pages/try-a-move";

/**
 * Try a move: pick a set, see every legal place on the 5-minute grid with its price, keep a move, stack
 * another, undo, start over. Every price comes from the engine through /api, with no language model.
 */

test.describe("try a move", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("the starting list names four sets, each with the minutes it shares and its partner", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    const rows = move.starters.getByRole("button");
    await expect(rows).toHaveCount(4);
    for (const row of await rows.all()) {
      await expect(row).toHaveAccessibleName(/^\d{2}:\d{2} .+ \d+ min with .+$/);
      await expect(row).toHaveAttribute("aria-pressed", "false");
    }
    await expect(move.starter("Sprints")).toContainText("45 min");
    await expect(move.starter("Sprints")).toContainText("with Katy J Pearson");
  });

  test("a picked set lists its legal places on the 5-minute grid, lowest index first", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await move.choose("Gurriers");
    await expect(move.card).toContainText("Now: Woodsies 12:30–13:30");
    await expect(move.card).toContainText("Lowest Clash Budget first");
    await expect(move.card).toContainText("Tested only: the timetable above is unchanged.");

    const places = (await move.placeLabels()).map(parsePlace);
    expect(places.length).toBeGreaterThanOrEqual(2);
    for (const place of places) {
      // Every start is on the 5-minute grid and the set keeps its length of 60 minutes.
      expect(minutes(place.start) % 5, `${place.start} is on the 5-minute grid`).toBe(0);
      expect(minutes(place.end) - minutes(place.start), "length is kept").toBe(60);
      expect(place.stage).not.toBe("");
      // It is not the published slot itself.
      expect(`${place.stage} ${place.start}`).not.toBe("Woodsies 12:30");
    }
    // Lowest index first.
    const indexes = places.map((place) => place.index);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    // The legal-places count line agrees with the list.
    await expect(move.card).toContainText(`${places.length} legal places, checking every start on a 5-minute grid.`);
    // The first place is chosen already and priced in full.
    await expect(move.places.getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
    await expect(move.card.getByRole("heading", { name: "Clashes it ends" })).toBeVisible();
    await expect(move.card.getByRole("heading", { name: "Clashes it adds" })).toBeVisible();
    await expect(move.card.getByRole("heading", { name: "Clashes it keeps" })).toBeVisible();
  });

  test("choosing another place re-prices the detail, and nothing on the timetable moves", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    const tileBefore = await home.tile("Gurriers").getAttribute("aria-label");
    await move.choose("Gurriers");
    const buttons = move.places.getByRole("button");
    const second = parsePlace((await buttons.nth(1).getAttribute("aria-label")) as string);
    await buttons.nth(1).click();
    await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(buttons.nth(0)).toHaveAttribute("aria-pressed", "false");
    // The summary line under the list reads the chosen place back, with its index.
    await expect(move.card).toContainText(`Gurriers → ${second.stage} ${second.start}–${second.end}`);
    await expect(move.card).toContainText(new RegExp(`Clash Budget Index \\d+\\.\\d to ${second.index.toFixed(1)}`));
    // The published tile is untouched: a tested place is a preview.
    expect(await home.tile("Gurriers").getAttribute("aria-label")).toBe(tileBefore);
  });

  test("keeping a move puts it in the plan with its price, and previews it on the board", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await move.choose("Gurriers");
    const first = parsePlace((await move.places.getByRole("button").first().getAttribute("aria-label")) as string);
    await move.keepButton.click();

    await expect(move.plan).toBeVisible();
    await expect(move.kept).toHaveCount(1);
    await expect(move.kept.first()).toContainText(`1. Gurriers · ${first.stage} ${first.start}–${first.end}`);
    await expect(move.kept.first()).toContainText(`→ ${first.index.toFixed(1)}`);
    await expect(move.announcement.last()).toHaveText(/^Plan: 1 kept move\. Clash Budget Index \d+\.\d to \d+\.\d, \d+\.\d lower\.$/);
    // The plan is previewed on the board, and the key says what a dashed slot is.
    await expect(page.getByRole("list", { name: "Timetable key" }).filter({ visible: true }).filter({ hasText: "Tested place" })).toHaveCount(1);
    // The published index above the board is still the published one.
    const dial = page.getByRole("figure").filter({ hasText: "Clash Budget Index" });
    await expect(dial.getByText("116.7", { exact: true }).first()).toBeVisible();
    await expect(move.planRegion).toContainText("Scored by the same measure the places are found with");
  });

  test("a second move stacks on the first: its starting index is the first's result", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await move.choose("Gurriers");
    await move.keepButton.click();
    await expect(move.kept).toHaveCount(1);
    await move.choose("Cymande");
    await move.keepButton.click();
    await expect(move.kept).toHaveCount(2);

    const [first, second] = await move.kept.allInnerTexts();
    const arrow = (text: string) => /(\d+\.\d) → (\d+\.\d)/.exec(text)?.slice(1).map(Number) ?? [];
    const [firstFrom, firstTo] = arrow(first);
    const [secondFrom, secondTo] = arrow(second);
    expect(secondFrom, "the second move is priced on top of the first").toBe(firstTo);
    expect(firstFrom).toBe(116.7);
    expect(secondTo).toBeLessThanOrEqual(secondFrom);
    await expect(move.announcement.last()).toHaveText(new RegExp(`^Plan: 2 kept moves\\. Clash Budget Index 116\\.7 to ${secondTo.toFixed(1)}`));
    // A set already moved cannot be picked a second time.
    await expect(move.select.locator("option").filter({ hasText: /Gurriers.*already moved/ })).toBeDisabled();
  });

  test("Undo removes the last move, Start over clears the plan", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await move.choose("Gurriers");
    await move.keepButton.click();
    await move.choose("Cymande");
    await move.keepButton.click();
    await expect(move.kept).toHaveCount(2);

    await move.undo.click();
    await expect(move.kept).toHaveCount(1);
    await expect(move.kept.first()).toContainText("Gurriers");
    await move.startOver.click();
    await expect(move.plan).toHaveCount(0);
    await expect(move.announcement.last()).toHaveText("Plan cleared.");
    // Gone from the board's key, too.
    await expect(page.getByRole("list", { name: "Timetable key" }).filter({ visible: true }).filter({ hasText: "Tested place" })).toHaveCount(0);
  });

  test("the plan survives a reload in the same tab", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await move.choose("Gurriers");
    await move.keepButton.click();
    const line = await move.kept.first().innerText();

    await page.reload({ waitUntil: "domcontentloaded" });
    await home.waitUntilReady();
    await expect(move.plan).toBeVisible();
    await expect(move.kept).toHaveCount(1);
    expect(await move.kept.first().innerText()).toBe(line);
  });

  test("a locked set cannot be picked, and a set with no Qloo signal says nothing can change", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(move.select.locator("option").filter({ hasText: /Olivia Rodrigo \(locked\)/ })).toBeDisabled();
    await expect(move.starters).not.toContainText("Olivia Rodrigo");

    await move.choose("Thandii");
    await expect(move.card).toContainText("Qloo has no usable signal for Thandii, so its clashes are not priced and no place changes the Clash Budget Index.");
    for (const label of await move.placeLabels()) expect(parsePlace(label).change).toBe("No change");
  });

  test("works from the keyboard alone", async ({ page, isPhone }) => {
    test.skip(isPhone, "Keyboard path: a phone has no keyboard.");
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await move.starter("Katy J Pearson").focus();
    await page.keyboard.press("Enter");
    await expect(move.heading("Katy J Pearson")).toBeVisible();
    await expect(move.starter("Katy J Pearson")).toHaveAttribute("aria-pressed", "true");

    const buttons = move.places.getByRole("button");
    await buttons.nth(1).focus();
    await page.keyboard.press("Space");
    await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");

    await move.keepButton.focus();
    await page.keyboard.press("Enter");
    await expect(move.kept).toHaveCount(1);
    await expect(move.kept.first()).toContainText("Katy J Pearson");
  });

  test("the plan holds eight moves, then says it is full", async ({ page }) => {
    test.setTimeout(120_000);
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    const sets = ["The Selecter", "Celeste", "The Libertines", "Rod Stewart", "Nile Rodgers & Chic", "Noah Kahan", "Louis Dunford", "Nadine Shah"];
    for (const [i, act] of sets.entries()) {
      await move.choose(act);
      await move.keepButton.click();
      await expect(move.kept).toHaveCount(i + 1);
    }
    await move.choose("Shaboozey");
    await expect(move.keepButton).toHaveText("Plan is full");
    await expect(move.keepButton).toBeDisabled();
    await expect(move.kept).toHaveCount(8);
  });
});
