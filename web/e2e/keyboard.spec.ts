import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { CheckPage } from "./pages/check-page";
import { HomePage } from "./pages/home-page";

/** The main controls work from the keyboard alone, in an order that matches the page, with a visible focus. */

test.describe("keyboard", () => {
  test.skip(({ isPhone }) => isPhone, "A keyboard path: the phone project has no keyboard.");
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  /**
   * What has focus: its tag, its accessible-ish name (label or text), and whether it draws a focus ring. A radio of
   * a segmented control is visually hidden; its option draws the ring, so a radio's name and ring are its option's.
   */
  async function stop(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return { tag: "BODY", name: "", ring: 0 };
      const radio = element instanceof HTMLInputElement && element.type === "radio";
      const drawn = radio ? ((element.nextElementSibling as HTMLElement | null) ?? element) : element;
      const style = getComputedStyle(drawn);
      const name = radio
        ? (element.closest("label")?.innerText ?? "").replace(/\s+/g, " ").trim()
        : (element.getAttribute("aria-label") ?? element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
      return { tag: element.tagName, name, ring: style.outlineStyle === "none" ? 0 : parseFloat(style.outlineWidth) };
    });
  }

  test("Tab walks the first screen in reading order, and every stop shows a focus ring", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    // The hero in its one order: the festival day, the drawing's toggle, the drawing (one stop for its lines), Keep,
    // the paste; then the section nav, labels only.
    const expected = [
      /^Skip to main content$/,
      /^Clash Control, home$/,
      /^How we know$/,
      /^Check a draft grid$/,
      /^Color theme: /,
      /^Glastonbury 2025$/,
      /^Sprints 15 min later$/,
      /^#1 of \d+ clashes as published: Sprints × Katy J Pearson, /,
      /^Keep this move$/,
      /^Paste your own draft grid$/,
      /^What Qloo changes$/,
      /^Hidden clashes$/,
      /^Why this matters$/,
      /^Timetable$/,
      /^Try a move$/,
      /^Agent runs$/,
      /^Sources$/,
    ];
    for (const pattern of expected) {
      await page.keyboard.press("Tab");
      const focused = await stop(page);
      expect(focused.name, `focus stop ${pattern}`).toMatch(pattern);
      expect(focused.ring, `${focused.name}: a focus ring of at least 2px`).toBeGreaterThanOrEqual(2);
    }
  });

  test("Shift+Tab walks back the same way", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.pasteLink.focus();
    expect((await stop(page)).name).toBe("Paste your own draft grid");
    await page.keyboard.press("Shift+Tab");
    expect((await stop(page)).name).toBe("Keep this move");
    await page.keyboard.press("Shift+Tab");
    expect((await stop(page)).name).toMatch(/^#1 of \d+ clashes as published: Sprints × Katy J Pearson, /);
    await page.keyboard.press("Shift+Tab");
    expect((await stop(page)).name).toBe("Sprints 15 min later");
  });

  test("Enter on Keep this move keeps the move with focus on See your plan, and Enter there lands on the plan", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    // Focus follows a press only when the plan answers within 2 s (see answerKeepAtOnce).
    const answered = await home.answerKeepAtOnce(DAYS.glastonbury.id);

    await home.keepMove.focus();
    const scrolled = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("Enter");
    // Focus never drops to the page: it moves to the way to the plan, and the page does not scroll.
    await expect(home.seeYourPlan).toBeFocused();
    expect(answered(), "the press was answered with the server's own what-if").toBe(1);
    expect((await stop(page)).ring, "See your plan shows a focus ring").toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    await expect(home.plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem")).toHaveCount(1);

    await page.keyboard.press("Enter");
    await expect(home.plan).toBeFocused();
    await expect(home.plan).toBeInViewport();
  });

  test("a rail link opens its section on Enter", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.railLink("Hidden clashes").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#hidden-wall$/);
    await expect(page.locator("#hidden-wall")).toBeInViewport();
  });

  test("the clash drawer takes focus, keeps it inside while open, and gives it back on Escape", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await home.openBoard();

    const tile = home.tile("Sprints");
    await tile.focus();
    await page.keyboard.press("Enter");
    await expect(home.drawer).toBeVisible();
    await expect.poll(() => home.drawer.evaluate((dialog) => dialog.contains(document.activeElement)), "focus moved into the drawer").toBe(true);

    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      expect(await home.drawer.evaluate((dialog) => dialog.contains(document.activeElement)), `Tab ${i + 1} stays in the drawer`).toBe(true);
    }
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await home.drawer.evaluate((dialog) => dialog.contains(document.activeElement)), `Shift+Tab ${i + 1} stays in the drawer`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(home.drawer).toHaveCount(0);
    await expect(tile).toBeFocused();
  });

  test("the festival-day tabs move with the arrow keys", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.dayPicker.getByRole("radio", { name: DAYS.glastonbury.festival }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(home.dayPicker.getByRole("radio", { name: DAYS.riot.festival })).toBeChecked();
    await expect(page).toHaveURL(new RegExp(`preset=${DAYS.riot.id}`));
    await expect(home.page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible();
  });

  test("focus stays on the day tabs after the day changes, so the next arrow key works", async ({ page }) => {
    // Was defect D2 (round 31): choosing a day remounted the day view and dropped focus to <body>.
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.dayPicker.getByRole("radio", { name: DAYS.glastonbury.festival }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(home.page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible();
    await expect(home.dayPicker.getByRole("radio", { name: DAYS.riot.festival })).toBeFocused({ timeout: 3_000 });

    // The next arrow works from there.
    await page.keyboard.press("ArrowLeft");
    await expect(home.page.getByText(`Published timetable · ${DAYS.glastonbury.title}`)).toBeVisible();
    await expect(home.dayPicker.getByRole("radio", { name: DAYS.glastonbury.festival })).toBeFocused({ timeout: 3_000 });
  });

  test("the drawing's lines are one tab stop: the arrow keys step through them by rank, each showing its note; Enter pins it, Escape hides it", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const lines = home.graphLines();
    const count = await lines.count();
    expect(count, "the drawing has lines to inspect").toBeGreaterThan(1);
    // One tab stop for the lines drawn at this width: the chosen clash's.
    const tabbable = await lines.evaluateAll((all) => all.filter((line) => (line as HTMLElement).tabIndex === 0).length);
    expect(tabbable, "lines in the tab order").toBe(1);
    // Every line is at least 44 x 44 px to press.
    for (const box of await lines.evaluateAll((all) => all.map((line) => line.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(box.width, "hit area width").toBeGreaterThanOrEqual(44);
      expect(box.height, "hit area height").toBeGreaterThanOrEqual(44);
    }

    await home.viewToggle.getByRole("radio", { name: "Sprints 15 min later" }).focus();
    await page.keyboard.press("Tab");
    const focusedName = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    expect(await focusedName()).toMatch(/^#1 of \d+ clashes as published: Sprints × Katy J Pearson, /);
    expect((await stop(page)).ring, "the focused line shows a ring").toBeGreaterThanOrEqual(2);

    // Next and previous by rank, then the ends.
    await page.keyboard.press("ArrowRight");
    expect(await focusedName()).toMatch(/^#2 of /);
    await page.keyboard.press("ArrowDown");
    expect(await focusedName()).toMatch(/^#3 of /);
    await page.keyboard.press("ArrowUp");
    expect(await focusedName()).toMatch(/^#2 of /);
    await page.keyboard.press("ArrowLeft");
    expect(await focusedName()).toMatch(/^#1 of /);
    await page.keyboard.press("End");
    expect(await focusedName()).toMatch(new RegExp(`^#${count} of `));
    await page.keyboard.press("Home");
    expect(await focusedName()).toMatch(/^#1 of /);

    // A line reached from the keyboard shows its note at once, in words (round 35: no press of Enter needed); Enter
    // pins it; Escape hides it and leaves focus on the line.
    const note = home.graph.locator('[data-thread-note="line"]').filter({ visible: true });
    await expect(note).toBeVisible();
    await expect(note).toHaveText(await focusedName());
    await page.keyboard.press("Enter");
    await expect(note).toBeVisible();
    await expect(note).toHaveText(await focusedName());
    await expect(note).toContainText("(a rank, not attendance)");
    // In the moved view the chosen clash's note gives both figures: as published and with the move.
    await expect(note).toContainText(/45 min shared as published, 30 with the move/);
    await page.keyboard.press("Escape");
    await expect(note).toHaveCount(0);
    expect(await focusedName()).toMatch(/^#1 of /);
    // The line keeps its single tab stop: Tab leaves the drawing for Keep this move.
    await page.keyboard.press("Tab");
    await expect(home.keepMove).toBeFocused();
  });

  test("disclosures open and close with Enter and Space", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const rows = home.costliest.getByRole("button", { name: /^Clash \d+ / });
    const more = home.costliest.locator("summary", { hasText: /^Show the other \d+ costliest clashes$/ });
    await expect(rows).toHaveCount(5);
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(10);
    await page.keyboard.press("Space");
    await expect(rows).toHaveCount(5);
  });

  test("on /check, Table and CSV switch with the arrow keys and Enter checks the grid", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await check.page.getByRole("radio", { name: "Table" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(check.page.getByRole("radio", { name: "CSV" })).toBeChecked();
    await expect(check.grid).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(check.page.getByRole("radio", { name: "Table" })).toBeChecked();

    await check.clearButton.click();
    await check.paste("Sprints,Woodsies,14:00,15:00\nKaty J Pearson,The Park,14:00,14:45");
    await check.checkButton.focus();
    await page.keyboard.press("Enter");
    await expect(check.checked).toContainText("0 rule breaks found");
    await expect(check.announcement).toHaveText("Rule breaks: 0. Sets that share time: 1 pair.");
  });

  test("on /check, a decision is made with Space and every control shows a focus ring", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    const kept = check.rulesSection.getByRole("button", { name: /^Kept on purpose : Orchid Bloom/ });
    await kept.focus();
    await page.keyboard.press("Space");
    await expect(kept).toHaveAttribute("aria-pressed", "true");
    expect((await stop(page)).ring).toBeGreaterThanOrEqual(2);
  });
});
