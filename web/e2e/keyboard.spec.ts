import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { CheckPage } from "./pages/check-page";
import { HomePage } from "./pages/home-page";

/** The main controls work from the keyboard alone, in an order that matches the page, with a visible focus. */

test.describe("keyboard", () => {
  test.skip(({ isPhone }) => isPhone, "A keyboard path: the phone project has no keyboard.");
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  /** What has focus: its tag, its accessible-ish name (label or text), and whether it draws a focus ring. */
  async function stop(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return { tag: "BODY", name: "", ring: 0 };
      const style = getComputedStyle(element);
      const name = (element.getAttribute("aria-label") ?? element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
      return { tag: element.tagName, name, ring: style.outlineStyle === "none" ? 0 : parseFloat(style.outlineWidth) };
    });
  }

  test("Tab walks the first screen in reading order, and every stop shows a focus ring", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const expected = [
      /^Skip to main content$/,
      /^Clash Control, home$/,
      /^How we know$/,
      /^Check a draft grid$/,
      /^Color theme: /,
      /^Paste your own draft grid$/,
      /^See what Qloo changes$/,
      /^Open this move$/,
      /^Show the working$/,
      /^Sources$/,
      /^1 What Qloo changes$/,
      /^2 Why this matters$/,
      /^3 Timetable$/,
      /^4 Hidden clashes$/,
      /^5 Try a move$/,
      /^6 Recorded runs$/,
      /^7 Sources$/,
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

    await home.showWorking.focus();
    expect((await stop(page)).name).toBe("Show the working");
    await page.keyboard.press("Shift+Tab");
    expect((await stop(page)).name).toBe("Open this move");
    await page.keyboard.press("Shift+Tab");
    expect((await stop(page)).name).toBe("See what Qloo changes");
  });

  test("Enter on Open this move tests the move, and focus lands on the answer", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.openMove.focus();
    await page.keyboard.press("Enter");
    const plan = home.tryAMove.getByRole("group", { name: "Your tested moves" });
    await expect(plan).toBeFocused();
    await expect(plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem")).toHaveCount(1);
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

    await home.dayPicker.getByRole("radio", { name: DAYS.glastonbury.title }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(home.dayPicker.getByRole("radio", { name: DAYS.riot.title })).toBeChecked();
    await expect(page).toHaveURL(new RegExp(`preset=${DAYS.riot.id}`));
    await expect(home.page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible();
  });

  test("focus stays on the day tabs after the day changes, so the next arrow key works", async ({ page }) => {
    // DEFECT (app): choosing a day remounts the whole day view (PresetView is keyed by the preset id, and the
    // tabs live inside it), so keyboard focus drops to <body>. After ArrowRight on the tabs the next
    // ArrowLeft goes nowhere and a keyboard visitor has to Tab in from the top of the page again.
    // Repro: open /, focus the "Glastonbury 2025, Sunday" tab, press ArrowRight, read document.activeElement.
    test.fail(true, "Focus is lost to <body> when a day is chosen with the keyboard (see comment)");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.dayPicker.getByRole("radio", { name: DAYS.glastonbury.title }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(home.page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible();
    await expect(home.dayPicker.getByRole("radio", { name: DAYS.riot.title })).toBeFocused({ timeout: 3_000 });
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
