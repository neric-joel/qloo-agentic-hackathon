import { DAYS, requireSavedDays, visibleTexts } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/** The board: every stage and set drawn, the key that explains its marks, the costliest clashes, and the clash drawer. */

test.describe("timetable board", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("draws every stage's sets, marks the locked ones and the ones Qloo has no signal for", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const tiles = home.board.getByRole("button");
    await expect(tiles).toHaveCount(39);
    // Seven on the Pyramid, eight on each other stage, as the column heads say.
    await expect(tiles.filter({ hasText: /, Pyramid\./ })).toHaveCount(7);
    for (const stage of ["Other", "West Holts", "Woodsies", "The Park"]) {
      await expect(tiles.filter({ hasText: new RegExp(`, ${stage}\\.`) }), stage).toHaveCount(8);
    }
    await expect(tiles.filter({ hasText: /Locked set\./ })).toHaveCount(5);
    // The three sets with no Qloo signal say so to a screen reader as "not scored" (round 35: never "priced").
    const unscored = tiles.filter({ hasText: /not scored/ });
    await expect(unscored).toHaveCount(3);
    await expect(unscored.filter({ hasText: /^Thandii/ })).toHaveCount(1);
    await expect(tiles.filter({ hasText: /priced/ })).toHaveCount(0);

    // Every tile names its act, stage, times and draw; a priced one says whether it is in a ranked clash.
    await expect(home.tile("Sprints")).toHaveAccessibleName(/^Sprints , Woodsies\. 14:00–15:00 .*Draw \d+\. .*In 1 ranked clash; press Enter to open the costliest, number 1, with Katy J Pearson\.$/);
    // The draw is said to a screen reader and in the tile's title, and no longer printed on any tile.
    await expect(home.tile("Sprints")).toHaveAttribute("title", /· Draw \d+$/);
    const printed = (await visibleTexts(tiles)).filter((text) => /Draw \d+/.test(text));
    expect(printed, "tiles whose visible text prints a draw").toEqual([]);
    // The one festival-day picker is in the hero, not in the board's header.
    await expect(page.getByRole("radiogroup", { name: "Festival day" })).toHaveCount(1);
    await expect(home.hero.getByRole("radiogroup", { name: "Festival day" })).toHaveCount(1);
    await expect(home.tile("The Libertines")).toHaveAccessibleName(/No ranked clash\.$/);
  });

  test("coverage says how many acts were scored, and the three left out are the dotted ones", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const coverage = page.getByRole("region", { name: "Qloo coverage" });
    await expect(coverage).toContainText("36 of 39 acts scored");
    await expect(coverage).not.toContainText("priced");
    await coverage.getByRole("button", { name: /3 left out, not scored as zero/ }).click();
    await expect(coverage).toContainText("Thandii, Abel Selaocoe & the Bantu Ensemble and Westside Cowboy");
    await expect(coverage).toContainText("Of the 39 acts: 35 strong signal, 1 weak signal, 3 no Qloo signal.");
  });

  test("the key explains each mark on the board", async ({ page, isPhone }) => {
    test.skip(isPhone, "On a phone the key folds into a summary.");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const key = page.getByRole("list", { name: "Timetable key" });
    await expect(key.getByRole("listitem")).toHaveText(["Locked", "No Qloo signal", "Clash", "Hidden clash"]);
    await page.getByRole("button", { name: "How to read the board" }).click();
    // The key is drawn once per width band; the one on show is the one that counts.
    for (const meaning of [
      "Locked set: fixed slot",
      "No Qloo signal: left out, not scored as zero",
      "Clash link: stronger = costlier",
      "Hidden clash: genres differ, taste overlap is high",
    ]) {
      await expect(page.getByText(meaning).filter({ visible: true }), meaning).toHaveCount(1);
    }
  });

  test("on a phone the key is one closed summary and the board scrolls inside its own frame", async ({ page, isPhone }) => {
    test.skip(!isPhone, "Phone layout only.");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const summary = page.getByText(/^How to read the board \(\d+ symbols?\)$/);
    await expect(summary).toBeVisible();
    await expect(page.getByText("Scroll sideways to see every stage.")).toBeVisible();
    // The start-order list is behind its own summary and lists the same sets.
    await page.getByText(/^Show the start-order list \(39 sets\)$/).click();
    await expect(page.getByRole("list").filter({ has: page.getByRole("button", { name: /Sprints/ }) }).first()).toBeVisible();
  });

  test("the costliest clashes list shows the first few, and the rest of the ten behind a disclosure", async ({ page, isPhone }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const rows = home.costliest.getByRole("button", { name: /^Clash \d+ / });
    await expect(home.costliest.getByRole("heading", { level: 3 })).toHaveText("The 10 costliest clashes");
    // Five rows show at once (three on a phone); the rest sit in a closed disclosure, so ten in all.
    const shown = isPhone ? 3 : 5;
    await expect(rows).toHaveCount(shown);
    await expect(rows.first()).toHaveAccessibleName(/^Clash 1 Sprints and Katy J Pearson Hidden clash /);
    await home.costliest.getByText(new RegExp(`^Show the other ${10 - shown} costliest clashes$`)).click();
    await expect(rows).toHaveCount(10);
    await expect(rows.last()).toHaveAccessibleName(/^Clash 10 /);
    // Ranked in order, 1 to 10.
    for (let rank = 1; rank <= 10; rank++) {
      await expect(rows.nth(rank - 1), `row ${rank}`).toHaveAccessibleName(new RegExp(`^Clash ${rank} `));
    }
  });

  test("a clash opens its drawer with the price worked out from its factors", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const row = home.costliest.getByRole("button", { name: /^Clash 2 The Brian Jonestown Massacre and St\. Vincent/ });
    await row.click();
    await expect(home.drawer).toBeVisible();
    await expect(home.drawer.getByRole("heading", { level: 2 })).toHaveText("The Brian Jonestown Massacre × St. Vincent");
    await expect(home.drawer).toContainText("Clash 2 of 15");
    await expect(home.drawer).toContainText("Taste overlap is not attendance.");
    await expect(home.drawer.getByRole("heading", { name: "The price" })).toBeVisible();
    for (const factor of ["Taste overlap", "Time shared", "Combined draw", "Share of day's cost"]) {
      await expect(home.drawer.getByRole("term").filter({ hasText: factor })).toBeVisible();
    }

    // The printed product is the product of the printed factors, to rounding.
    const formula = await home.drawer.getByText(/^price = taste overlap /).innerText();
    const [overlap, share, draw, rarity, price] = (formula.match(/\d\.\d{3}/g) ?? []).map(Number);
    expect(overlap * share * draw * rarity).toBeCloseTo(price, 2);

    // Its two sets, their draw, and where its sources sit.
    await expect(home.drawer).toContainText("Draw (Qloo popularity)");
    await expect(home.drawer.getByRole("heading", { name: "How Qloo was used" })).toBeVisible();
    await expect(home.drawer.getByRole("button", { name: /^How Qloo was used, \d+ requests?/ })).toBeVisible();
  });

  test("the drawer steps to the next and previous clash, and Escape returns focus to the row", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const row = home.costliest.getByRole("button", { name: /^Clash 2 / });
    await row.click();
    await expect(home.drawer).toContainText("Clash 2 of 15");

    await home.drawer.getByRole("button", { name: "Clash 3" }).click();
    await expect(home.drawer).toContainText("Clash 3 of 15");
    await expect(home.drawer.getByRole("heading", { level: 2 })).toHaveText("Nadine Shah × Gurriers");
    await home.drawer.getByRole("button", { name: "Clash 2" }).click();
    await expect(home.drawer).toContainText("Clash 2 of 15");

    await page.keyboard.press("Escape");
    await expect(home.drawer).toHaveCount(0);
    await expect(row).toBeFocused();
  });

  test("the drawer's Close button closes it", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.tile("Sprints").click();
    await expect(home.drawer.getByRole("heading", { level: 2 })).toHaveText("Sprints × Katy J Pearson");
    await home.drawer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(home.drawer).toHaveCount(0);
  });

  test("a live re-check is not offered while the server has it switched off", async ({ page, guard }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    const health = await (await page.request.get("/api/health")).json();
    test.skip(health.pair_check === true, "This server has the live pair check on; this spec only proves the off state.");

    await home.tile("Sprints").click();
    await expect(home.drawer).toBeVisible();
    await expect(home.drawer.getByRole("button", { name: /Re-check this pair live|Check again/ })).toHaveCount(0);
    await expect(home.drawer.getByRole("heading", { name: "Check it with Qloo now" })).toHaveCount(0);
    expect(guard.requested.filter((url) => url.includes("/api/pair"))).toEqual([]);
  });

  test("a set outside every ranked clash opens nothing", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.tile("The Libertines").click();
    await expect(home.drawer).toHaveCount(0);
  });

  test("focusing a set highlights its clash partner and dims the unrelated sets", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.tile("Sprints").focus();
    await expect(home.tile("Katy J Pearson")).toHaveCSS("opacity", "1");
    await expect(home.tile("The Selecter")).toHaveCSS("opacity", "0.4");
    await home.tile("Sprints").blur();
    await expect(home.tile("The Selecter")).toHaveCSS("opacity", "1");
  });

  test("the board is one tab stop, and the arrow keys move between sets", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const tabbable = await home.board.getByRole("button").evaluateAll((all) => all.filter((tile) => (tile as HTMLElement).tabIndex === 0).length);
    expect(tabbable, "tiles in the tab order").toBe(1);

    await home.tile("The Selecter").focus();
    await page.keyboard.press("ArrowDown");
    await expect(home.tile("Celeste")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(home.tile("The Libertines")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(home.tile("Celeste")).toBeFocused();
    await page.keyboard.press("End");
    await expect(home.tile("Olivia Rodrigo")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(home.tile("The Selecter")).toBeFocused();
    // Right goes to the set on the next stage that is playing closest to the middle of this one.
    await page.keyboard.press("ArrowRight");
    await expect(home.board.getByRole("button", { name: /, Other\./ }).and(page.locator(":focus"))).toHaveCount(1);
    // Enter opens the clash the set is in.
    await home.tile("Sprints").focus();
    await page.keyboard.press("Enter");
    await expect(home.drawer.getByRole("heading", { level: 2 })).toHaveText("Sprints × Katy J Pearson");
  });

  test("How Qloo was used lists the saved requests behind the day, none of them live", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.trace).toHaveAccessibleName(/^How Qloo was used, \d+ requests$/);
    const total = /(\d+) requests$/.exec((await home.trace.getAttribute("aria-label")) ?? (await home.trace.innerText()))?.[1];
    await home.trace.click();
    await expect(home.drawer).toBeVisible();
    await expect(home.drawer.getByRole("heading", { level: 2 })).toHaveText("How Qloo was used");
    await expect(home.drawer).toContainText("replayed from the saved preset rather than fetched live");
    await expect(home.drawer).toContainText("The API key stays on the server and is never sent to the browser.");
    await expect(home.drawer.getByRole("definition").first()).toHaveText(total ?? /\d+/);
    await expect(home.drawer.getByRole("heading", { level: 3 }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(home.drawer).toHaveCount(0);
  });
});
