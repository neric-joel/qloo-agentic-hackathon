import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { TryAMove } from "./pages/try-a-move";

/**
 * Keep two sets apart: choose two overlapping sets and find the smallest moves that end the overlap
 * without breaking a rule. Each answer is checked against the rules; its index is for information.
 */

test.describe("keep two sets apart", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  function section(page: import("@playwright/test").Page) {
    const area = new HomePage(page).keepApart;
    return {
      area,
      first: area.getByRole("combobox", { name: "First set" }),
      second: area.getByRole("combobox", { name: "Second set" }),
      find: area.getByRole("button", { name: "Find changes that end this overlap" }),
      // One entry per change; each lists its moves in a nested list of its own.
      changes: area.getByRole("list", { name: "Changes that end the overlap" }).locator(":scope > li"),
      clear: area.getByRole("button", { name: "Clear preview" }),
    };
  }

  test("opens on the day's costliest pair, and lists changes that end its overlap", async ({ page }) => {
    const home = new HomePage(page);
    const keep = section(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(keep.first).toHaveValue("sprints");
    await expect(keep.second).toHaveValue("katy-j-pearson");
    await expect(keep.area).toContainText("Sprints and Katy J Pearson: 45 min at the same time");

    await keep.find.click();
    await expect(keep.area.getByRole("heading", { level: 4, name: "Keeping Sprints and Katy J Pearson apart" })).toBeVisible();
    await expect(keep.changes.first()).toBeVisible();
    const count = await keep.changes.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (const change of await keep.changes.all()) {
      await expect(change).toContainText("Adds no rule break; ends this overlap.");
      await expect(change).toContainText(/\d+ sets? · \d+ minutes start-time shift · Index \d+\.\d → \d+\.\d/);
      await expect(change.getByRole("list").getByRole("listitem").first()).toContainText(/ → .+ \d{2}:\d{2}–\d{2}:\d{2} \(moves to /);
    }
    // Smallest change first: fewest sets, then the fewest minutes moved.
    const shifts = await keep.changes.evaluateAll((all) => all.map((item) => {
      const [, sets, minutes] = /(\d+) sets? · (\d+) minutes start-time shift/.exec(item.textContent ?? "") ?? [];
      return [Number(sets), Number(minutes)];
    }));
    expect(shifts).toEqual([...shifts].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    // It says how many it found, and that the index does not rank the list.
    await expect(keep.area.getByRole("status")).toContainText(/^\d+ changes found for Sprints and Katy J Pearson\.$/);
    await expect(keep.area).toContainText("The index is shown for information: it is this app’s own measure, not a verdict, and it does not rank this list.");
  });

  test("a preview is drawn on the board as tested slots, and clearing it takes them away", async ({ page }) => {
    const home = new HomePage(page);
    const keep = section(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await keep.find.click();
    await expect(keep.clear).toBeDisabled();
    await keep.changes.first().getByRole("button", { name: "Preview on the timetable" }).click();
    await expect(keep.area.getByRole("status")).toContainText(/^Previewing .+ 0 minutes shared; the change adds no rule break and ends this overlap\./);
    await expect(keep.clear).toBeEnabled();
    await expect(page.getByRole("list", { name: "Timetable key" }).filter({ visible: true }).filter({ hasText: "Tested place" })).toHaveCount(1);
    // A preview is not a kept change: there is no plan.
    await expect(move.plan).toHaveCount(0);

    await keep.clear.click();
    await expect(keep.clear).toBeDisabled();
    await expect(page.getByRole("list", { name: "Timetable key" }).filter({ visible: true }).filter({ hasText: "Tested place" })).toHaveCount(0);
  });

  test("keeping a change adds it to the plan with its own index, and confirms the pair no longer shares time", async ({ page }) => {
    const home = new HomePage(page);
    const keep = section(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await keep.find.click();
    const first = keep.changes.first();
    const [, from, to] = /Index (\d+\.\d) → (\d+\.\d)/.exec(await first.innerText()) ?? [];
    await first.getByRole("button", { name: "Keep this change" }).click();

    await expect(move.plan).toBeVisible();
    await expect(move.kept).toHaveCount(1);
    await expect(move.kept.first()).toContainText("Change to keep Sprints and Katy J Pearson apart:");
    await expect(move.kept.first()).toContainText(`${from} → ${to}`);
    await expect(move.kept.first()).toContainText("Confirmed: after this plan they share no time, and the plan adds no rule break.");
    await expect(first.getByRole("button", { name: "Kept in your plan" })).toBeVisible();
    await expect(move.announcement.last()).toHaveText(new RegExp(`^Plan: 1 kept step\\. Clash Budget Index ${from} to ${to}, `));
  });

  test("two sets that never overlap say the rule already holds", async ({ page }) => {
    const home = new HomePage(page);
    const keep = section(page);
    await home.goto(DAYS.glastonbury.id);

    await keep.first.selectOption({ label: "11:15 The Selecter" });
    await keep.second.selectOption({ label: "14:00 Cymande" });
    await keep.find.click();
    await expect(keep.area).toContainText("The Selecter and Cymande: 0 min at the same time");
    await expect(keep.area).toContainText("The Selecter and Cymande do not share any time on this timetable, so the rule already holds.");
    await expect(keep.changes).toHaveCount(0);
  });

  test("the card's two buttons carry its pair here: Try this rule yourself, and Keep the two-set change", async ({ page }) => {
    const home = new HomePage(page);
    const keep = section(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await home.showWorking.click();
    await home.working.getByRole("button", { name: "Try this rule yourself" }).click();
    await expect(keep.area.getByRole("heading", { level: 4, name: "Keeping Sprints and Katy J Pearson apart" })).toBeFocused();
    await expect(keep.changes.first()).toBeVisible();

    await home.working.getByRole("button", { name: "Keep the two-set change" }).click();
    await expect(move.kept).toHaveCount(1);
    await expect(move.kept.first()).toContainText("Change to keep Sprints and Katy J Pearson apart:");
    // The card says it is in the plan, and pressing again says so.
    await expect(home.working.getByRole("button", { name: /^In your plan/ })).toBeVisible();
    await home.working.getByRole("button", { name: /^In your plan/ }).click();
    await expect(home.card.getByRole("status")).toHaveText("Already in your plan.");
    await expect(move.kept).toHaveCount(1);
  });
});
