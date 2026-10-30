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
    // The section waits in a closed disclosure under Try a move until a visitor opens it.
    await expect(keep.area).toBeHidden();
    await home.openKeepApart();

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
      await expect(change.getByRole("list").getByRole("listitem").first()).toContainText(/ → .+ \d{2}:\d{2}–\d{2}:\d{2} \((moves to |\d+ minutes (earlier|later), same stage)/);
    }
    const shifts = await keep.changes.evaluateAll((all) => all.map((item) => {
      const [, sets, minutes] = /(\d+) sets? · (\d+) minutes start-time shift/.exec(item.textContent ?? "") ?? [];
      return [Number(sets), Number(minutes)];
    }));
    // A change that moves a set to another stage says it needs production sign-off; one that keeps every set on
    // its stage does not, and those come first.
    const signOff = await keep.changes.evaluateAll((all) => all.map((item) => {
      const text = item.textContent ?? "";
      return { movesStage: /\(moves to /.test(text), says: text.includes("Changes stage: needs production sign-off") };
    }));
    for (const change of signOff) expect(change.says, "a stage-changing change asks for sign-off, and only it").toBe(change.movesStage);
    // The sign-off line is a fact production must act on: plain text in ink at medium weight, not a muted note.
    const signOffLine = keep.area.getByText("Changes stage: needs production sign-off").first();
    if ((await signOffLine.count()) > 0) {
      const weight = await signOffLine.evaluate((element) => Number(getComputedStyle(element).fontWeight));
      expect(weight, "medium weight or more").toBeGreaterThanOrEqual(500);
    }
    const firstStageChange = signOff.findIndex((change) => change.movesStage);
    if (firstStageChange >= 0) expect(signOff.slice(firstStageChange).every((change) => change.movesStage), "same-stage changes first").toBe(true);
    // Within each group, smallest change first: fewest sets, then the fewest minutes moved.
    const sameStage = shifts.filter((_, i) => !signOff[i].movesStage);
    const otherStage = shifts.filter((_, i) => signOff[i].movesStage);
    for (const group of [sameStage, otherStage]) expect(group).toEqual([...group].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    // It says how many it found, and that the index does not rank the list.
    await expect(keep.area.getByRole("status")).toContainText(/^\d+ changes found for Sprints and Katy J Pearson\.$/);
    await expect(keep.area).toContainText("The index is shown for information: it is this app’s own measure, not a verdict, and it does not rank this list.");
  });

  test("a preview is drawn on the board as tested slots, and clearing it takes them away", async ({ page }) => {
    const home = new HomePage(page);
    const keep = section(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);
    await home.openKeepApart();

    await keep.find.click();
    await expect(keep.clear).toBeDisabled();
    // The board's grid waits behind its closed disclosure until a preview needs it. From
    // 1280 px it arrives open, so a visitor's press closes it first; on a phone it arrives closed.
    await home.closeBoard();
    expect(await home.boardOpen(), "the board's disclosure is closed before the preview").toBe(false);
    await keep.changes.first().getByRole("button", { name: "Preview on the timetable" }).click();
    await expect(keep.area.getByRole("status")).toContainText(/^Previewing .+ 0 minutes shared; the change adds no rule break and ends this overlap\./);
    await expect(keep.clear).toBeEnabled();
    await expect(page.getByRole("list", { name: "Timetable key" }).filter({ visible: true }).filter({ hasText: "Tested place" })).toHaveCount(1);
    // The preview opens the board in the same step and brings its first tested slot into view.
    await expect(home.boardFold).toHaveAttribute("open", "");
    await expect(home.board).toBeVisible();
    const ghosts = home.boardFold.locator('[data-ghost="rule"]');
    await expect.poll(() => ghosts.count(), { message: "the preview's tested slots on the opened board" }).toBeGreaterThanOrEqual(1);
    await expect(ghosts.first()).toBeInViewport();
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
    await home.openKeepApart();

    await keep.find.click();
    const first = keep.changes.first();
    const [, from, to] = /Index (\d+\.\d) → (\d+\.\d)/.exec(await first.innerText()) ?? [];
    // An offered change carries no check mark: the mark is for a change the plan holds.
    const offer = first.getByRole("button", { name: "Keep this change" });
    await expect(offer.locator("svg")).toHaveCount(0);
    await offer.click();

    await expect(move.plan).toBeVisible();
    await expect(move.kept).toHaveCount(1);
    await expect(move.kept.first()).toContainText("Change to keep Sprints and Katy J Pearson apart:");
    await expect(move.kept.first()).toContainText(`${from} → ${to}`);
    await expect(move.kept.first()).toContainText("Confirmed: after this plan they share no time, and the plan adds no rule break.");
    await expect(first.getByRole("button", { name: "Kept in your plan" })).toBeVisible();
    await expect(first.getByRole("button", { name: "Kept in your plan" }).locator("svg")).toHaveCount(1);
    await expect(keep.changes.getByRole("button", { name: "Keep this change" }).locator("svg")).toHaveCount(0);
    await expect(move.announcement.last()).toHaveText(new RegExp(`^Plan: 1 kept step\\. Clash Budget Index ${from} to ${to}, `));
  });

  test("two sets that never overlap say the rule already holds", async ({ page }) => {
    const home = new HomePage(page);
    const keep = section(page);
    await home.goto(DAYS.glastonbury.id);
    await home.openKeepApart();

    await keep.first.selectOption({ label: "11:15 The Selecter" });
    await keep.second.selectOption({ label: "14:00 Cymande" });
    await keep.find.click();
    await expect(keep.area).toContainText("The Selecter and Cymande: 0 min at the same time");
    await expect(keep.area).toContainText("The Selecter and Cymande do not share any time on this timetable, so the rule already holds.");
    await expect(keep.changes).toHaveCount(0);
  });

  test("the index card's two buttons carry its pair here: Try this rule yourself, and Keep the two-set change", async ({ page }) => {
    const home = new HomePage(page);
    const keep = section(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    // The secondary actions sit under the working in the index card, with no click to reach them.
    await home.details.getByRole("button", { name: "Try this rule yourself" }).click();
    await expect(keep.area.getByRole("heading", { level: 4, name: "Keeping Sprints and Katy J Pearson apart" })).toBeFocused();
    await expect(keep.changes.first()).toBeVisible();

    await home.details.getByRole("button", { name: "Keep the two-set change" }).click();
    await expect(move.kept).toHaveCount(1);
    await expect(move.kept.first()).toContainText("Change to keep Sprints and Katy J Pearson apart:");
    // The card says it is in the plan, and pressing again says so.
    await expect(home.details.getByRole("button", { name: /^In your plan/ })).toBeVisible();
    await home.details.getByRole("button", { name: /^In your plan/ }).click();
    await expect(home.detailsAnnouncement).toHaveText("Already in your plan.");
    await expect(move.kept).toHaveCount(1);
  });
});
