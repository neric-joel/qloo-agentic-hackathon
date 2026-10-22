import type { Page } from "@playwright/test";

import { DAYS, literal, requireSavedDays, visibleTexts } from "./helpers";
import { expect, test } from "./fixtures";
import { serveInventedDay } from "./invented-day";
import { HomePage } from "./pages/home-page";

/** The board: every stage and set drawn, the key that explains its marks, the costliest clashes, and the clash drawer. */

/**
 * A lock's words in the board's key (round 36, lib/locks.ts). The published days' locks are this app's: the festivals
 * marked no set as fixed, and on both days the locked sets are exactly the last set on each stage, so the key states
 * that rule. The invented day's locks are part of the invented day.
 */
const LOCK_SHORT = "Locked by this app: the last set on its stage stays in place.";
const LOCK_INVENTED = "Locked: an invented fixed slot.";

/** The costliest clashes' locked share on a published day: whose locks they are, and that no move is suggested there. */
const LOCKED_SHARE = /\d+% of the day’s cost sits between two sets this app locks, so it suggests no move there\./;

/** Lock words the page no longer says (round 35's), and one it must never say. */
const OLD_LOCK_WORDS = /Locked set: fixed slot|which cannot move|this set stays put|not by the festival/;

/** Opens the board's key as a visitor does: "How to read the board" from 640 px, its fold on a phone. */
async function openBoardKey(page: Page, isPhone: boolean): Promise<void> {
  if (isPhone) await page.getByText(/^How to read the board \(\d+ symbols?\)$/).click();
  else await page.getByRole("button", { name: "How to read the board" }).click();
}

test.describe("timetable board", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("draws every stage's sets, marks the locked ones and the ones Qloo has no signal for", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await home.openBoard();

    const tiles = home.board.getByRole("button");
    await expect(tiles).toHaveCount(39);
    // Seven on the Pyramid, eight on each other stage, as the column heads say.
    await expect(tiles.filter({ hasText: /, Pyramid\./ })).toHaveCount(7);
    for (const stage of ["Other", "West Holts", "Woodsies", "The Park"]) {
      await expect(tiles.filter({ hasText: new RegExp(`, ${stage}\\.`) }), stage).toHaveCount(8);
    }
    // Round 37 (L33): a locked tile says whose lock it is ("Locked set." said no owner).
    await expect(tiles.filter({ hasText: /Locked by this app: kept in place\./ })).toHaveCount(5);
    await expect(tiles.filter({ hasText: /Locked set\./ })).toHaveCount(0);
    await expect(home.tile("The Prodigy")).toHaveAccessibleName(
      /Draw \d+\.\s+Locked by this app: kept in place\. In \d+ ranked clash(es)?; press Enter to open the costliest, number \d+, with .+\.$/,
    );
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

  test("coverage says how many sets were scored, and the three left out are the dotted ones", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const coverage = page.getByRole("region", { name: "Qloo coverage" });
    // Round 36: the count is of sets, as the board draws them.
    await expect(coverage).toContainText("36 of 39 sets scored");
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
    // Round 36 fix pass: the key row spells whose lock it is with no click.
    await expect(key.getByRole("listitem")).toHaveText([LOCK_SHORT, "No Qloo signal", "Clash", "Hidden clash"]);
    await page.getByRole("button", { name: "How to read the board" }).click();
    // The key is drawn once per width band; the one on show is the one that counts. Round 36: the lock says whose it is.
    for (const meaning of [
      LOCK_SHORT,
      "No Qloo signal: left out, not scored as zero",
      "Clash link: stronger = costlier",
      "Hidden clash: genres differ, taste overlap is high",
    ]) {
      await expect(page.getByText(meaning).filter({ visible: true }), meaning).toHaveCount(1);
    }
  });

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, the key says whose lock it is, and the costliest clashes' locked share says the same`, async ({ page, isPhone }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      await openBoardKey(page, isPhone);
      // The rule's words, once on show (the key is drawn once per width band), and never the old "fixed slot".
      await expect(page.getByText(LOCK_SHORT, { exact: true }).filter({ visible: true })).toHaveCount(1);
      await expect(page.getByText(LOCK_INVENTED, { exact: true })).toHaveCount(0);
      // The locked share under the costliest clashes: "sets this app locks", in its short form.
      await expect(home.costliest.getByText(LOCKED_SHARE)).toBeVisible();
      await expect(page.locator("body")).not.toContainText(OLD_LOCK_WORDS, { useInnerText: true });
    });
  }

  test("on a phone the key is one closed summary and the board scrolls inside its own frame", async ({ page, isPhone }) => {
    test.skip(!isPhone, "Phone layout only.");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const summary = page.getByText(/^How to read the board \(\d+ symbols?\)$/);
    await expect(summary).toBeVisible();
    // The scroll hint, the scroller and the start-order list are inside the board's disclosure (round 37).
    await home.openBoard();
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

  test("a clash opens its drawer with the score worked out from its factors", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const row = home.costliest.getByRole("button", { name: /^Clash 2 The Brian Jonestown Massacre and St\. Vincent/ });
    await row.click();
    await expect(home.drawer).toBeVisible();
    await expect(home.drawer.getByRole("heading", { level: 2 })).toHaveText("The Brian Jonestown Massacre × St. Vincent");
    await expect(home.drawer).toContainText("Clash 2 of 15");
    await expect(home.drawer).toContainText("Taste overlap is not attendance.");
    // Round 36: the section is "The score", and the drawer says no price word.
    await expect(home.drawer.getByRole("heading", { name: "The score" })).toBeVisible();
    await expect(home.drawer).not.toContainText(/\bpric(e|ed|es|ing)\b/i);
    for (const factor of ["Taste overlap", "Time shared", "Combined draw", "Share of day's cost"]) {
      await expect(home.drawer.getByRole("term").filter({ hasText: factor })).toBeVisible();
    }

    // The printed product is the product of the printed factors, to rounding.
    const formula = await home.drawer.getByText(/^score = taste overlap /).innerText();
    const [overlap, share, draw, rarity, score] = (formula.match(/\d\.\d{3}/g) ?? []).map(Number);
    expect(overlap * share * draw * rarity).toBeCloseTo(score, 2);

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
    await home.openBoard();

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

    await home.openBoard();
    await home.tile("Sprints").click();
    await expect(home.drawer).toBeVisible();
    await expect(home.drawer.getByRole("button", { name: /Re-check this pair live|Check again/ })).toHaveCount(0);
    await expect(home.drawer.getByRole("heading", { name: "Check it with Qloo now" })).toHaveCount(0);
    expect(guard.requested.filter((url) => url.includes("/api/pair"))).toEqual([]);
  });

  test("a set outside every ranked clash opens nothing", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await home.openBoard();

    await home.tile("The Libertines").click();
    await expect(home.drawer).toHaveCount(0);
  });

  test("focusing a set highlights its clash partner and dims the unrelated sets", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await home.openBoard();

    await home.tile("Sprints").focus();
    await expect(home.tile("Katy J Pearson")).toHaveCSS("opacity", "1");
    await expect(home.tile("The Selecter")).toHaveCSS("opacity", "0.4");
    await home.tile("Sprints").blur();
    await expect(home.tile("The Selecter")).toHaveCSS("opacity", "1");
  });

  test("the board is one tab stop, and the arrow keys move between sets", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await home.openBoard();

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

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, the board's grid is one closed disclosure whose summary counts what it opens, and the caption, coverage, key and clash list stay open (round 37, L29 and L30)`, async ({ page, isPhone }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      // Closed on arrival, its summary a 44 px control with the chevron.
      await expect(home.boardFold).toHaveCount(1);
      expect(await home.boardOpen(), "closed on arrival").toBe(false);
      await expect(home.board).toBeHidden();
      const summaryBox = await home.boardFoldSummary.boundingBox();
      expect(summaryBox?.height ?? 0, "the summary is a 44 px control").toBeGreaterThanOrEqual(44);
      const summary = (await home.boardFoldSummary.innerText()).replace(/\s+/g, " ").trim();
      const [, n, s] = /^Show (\d+) sets on (\d+) stages$/.exec(summary) ?? [];
      expect(n, `the summary "${summary}"`).toBeTruthy();

      // Read with no click: the caption (its count, and how the board's numbers and the drawing's lines differ), the
      // coverage, the lock's words and the costliest clashes.
      await expect(home.boardCaption).toBeVisible();
      await expect(home.boardCaption).toHaveText(/^Lines join the (\d+) costliest clashes\. Board numbers rank clash cost; drawing lines show taste overlap\.$/);
      const k = Number(/^Lines join the (\d+) /.exec(await home.boardCaption.innerText())?.[1]);
      await expect(page.getByRole("region", { name: "Qloo coverage" })).toBeVisible();
      await expect(page.getByText(LOCK_SHORT, { exact: true }).filter({ visible: true })).toHaveCount(1);
      await expect(home.costliest).toBeVisible();

      // A press opens it: the summary's counts are the opened board's tiles and stages, and the caption's count is its
      // numbered badges.
      await home.boardFoldSummary.click();
      await expect(home.boardFold).toHaveAttribute("open", "");
      await expect(home.board).toBeVisible();
      await expect(home.board.getByRole("button"), "tiles in the opened board").toHaveCount(Number(n));
      // The opened board's stage names (its column heads), and the board heading's own count of stages and sets.
      const heads = await home.boardFold.locator("p.type-wordmark").filter({ visible: true }).allInnerTexts();
      expect(heads.length, `stage names in the opened board: ${heads.join(", ")}`).toBe(Number(s));
      const [, headingStages, headingSets] = /(\d+) stages, (\d+) sets/.exec(await home.boardTitle()) ?? [];
      expect([headingStages, headingSets], "the board heading counts the same").toEqual([s, n]);
      const badges = home.clashLinks.getByRole("button");
      expect(k, "the caption names at least one clash").toBeGreaterThanOrEqual(1);
      await expect(badges, "numbered badges in the opened board").toHaveCount(k);
      if (isPhone) await expect(page.getByText("Scroll sideways to see every stage.")).toBeVisible();

      // A second press closes it again.
      await home.boardFoldSummary.click();
      expect(await home.boardOpen(), "closed by a second press").toBe(false);
      await expect(home.board).toBeHidden();
    });
  }

  /**
   * The clash drawer's "Saved requests and values" (round 37, L85), on each day's clash 1, every line from the saved
   * preset: each act's /search and the 3 candidates it asked for, the entity this app used (first 8 characters, the
   * whole id in its title), its saved popularity and its one ranked /v2/insights request; the overlap with its
   * qualifier; the compare line as the request ledger has it; Qloo's search match for each act from the saved reading,
   * and what the saved compare holds of shared tags; the saved date. Nothing is fetched.
   * Every figure is read from GET /api/presets/{id} or from the page, never written here.
   */
  const CHAIN = {
    [DAYS.glastonbury.id]: {
      pair: ["Sprints", "Katy J Pearson"],
      compare: "1 saved /v2/analysis/compare request.",
      tags: "No shared genre tags: the saved compare returned only audience and instrument tags, which this app does not count.",
    },
    [DAYS.riot.id]: {
      pair: ["Alanis Morissette", "Bowling for Soup"],
      compare: "No comparison was saved for this pair.",
      tags: "No shared tags are stored here.",
    },
  } as const;

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, clash 1's drawer lists the saved requests and values behind it, each from the saved day, with nothing fetched (L85)`, async ({ page, guard }) => {
      const want = CHAIN[day.id];
      const preset = (await (await page.request.get(`/api/presets/${day.id}`)).json()) as {
        festival: { acts: { id: string; name: string; qloo_id: string | null; popularity: number | null }[] };
        matched_names: Record<string, string>;
      };
      const home = new HomePage(page);
      await home.goto(day.id);
      // Clash 1 is the hero's own pair on both days, so its taste rank is the hero's taste line's.
      const taste = /Taste overlap: (\d+) of 100/.exec(await home.tasteLine.innerText())?.[1];
      expect(taste, "the hero's taste rank").toBeTruthy();

      await home.costliest.getByRole("button", { name: /^Clash 1 / }).click();
      await expect(home.drawer).toBeVisible();
      await expect(home.drawer.getByRole("heading", { level: 2 })).toHaveText(`${want.pair[0]} × ${want.pair[1]}`);
      const asked = guard.requested.length;
      await expect(home.drawer.getByRole("heading", { name: "Saved requests and values" })).toBeVisible();
      const block = home.drawer.locator("[data-request-chain]");
      const acts = block.locator("li[data-chain-act]");
      await expect(acts).toHaveCount(2);
      for (const [i, name] of want.pair.entries()) {
        const act = preset.festival.acts.find((item) => item.name === name);
        expect(act?.qloo_id, `${name} has a Qloo entity`).toBeTruthy();
        const id = act?.qloo_id ?? "";
        const line = acts.nth(i);
        await expect(line).toHaveText(
          new RegExp(
            `^${literal(name)}: /search “${literal(name)}” \\(3 candidates asked\\) · entity this app used ${literal(id.slice(0, 8))}… · popularity ${literal(String(act?.popularity))} · its ranked row: 1 /v2/insights request$`,
          ),
        );
        await expect(line.locator(`[title="${id}"]`), `${name}: the whole id in its title`).toHaveCount(1);
      }
      await expect(block).toContainText(`Taste overlap ${taste} of 100 on this bill (a rank, not attendance) → pair score → Clash Budget Index.`);
      await expect(block).toContainText(want.compare);
      // Qloo's search match for each act of the pair, read from the saved day's matched names, then the tags line.
      const matchedAs = want.pair.map((name) => {
        const act = preset.festival.acts.find((item) => item.name === name);
        const matched = act ? preset.matched_names[act.id] : undefined;
        expect(matched, `${name}: a saved search match`).toBeTruthy();
        return `${name} as “${matched}”`;
      });
      await expect(block).toContainText(`Qloo’s search match, from the saved reading: ${matchedAs.join("; ")}.`);
      await expect(block).toContainText(want.tags);
      await expect(block).not.toContainText("Matched names were not retained");
      await expect(block).toContainText("Saved 3 Oct 2026.");
      // Opening the drawer and reading the block fetched nothing new from the API.
      expect(guard.requested.slice(asked).filter((url) => /\/api\/presets\/[^/]+\/(decision|moves|lenses|recordings)|\/api\/pair|\/api\/runs/.test(url))).toEqual([]);
    });
  }

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

test.describe("timetable board on the invented day", () => {
  test("the key calls a lock an invented fixed slot, never this app's, and states no last-set rule", async ({ page, isPhone }) => {
    await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();

    await openBoardKey(page, isPhone);
    await expect(page.getByText(LOCK_INVENTED, { exact: true }).filter({ visible: true })).toHaveCount(1);
    // The rule is about the published days' slots; the invented day's locks are invented, and nobody else's.
    await expect(page.locator("body")).not.toContainText(/Locked by this app|the last set on its stage/, { useInnerText: true });
    await expect(page.locator("body")).not.toContainText(OLD_LOCK_WORDS, { useInnerText: true });
  });
});

test.describe("the board's disclosure opens where the visitor is (round 37 merge)", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  /**
   * Below 1280 px the score (and, on a phone, the costliest-clashes list) is drawn after the board but comes before it
   * in the source, and the browser's scroll anchoring walks the source: a press on the summary used to scroll the page
   * down by the opened board (about 1,800 px on a phone), so the summary left the screen. Now the board opens under the
   * summary, which stays where it was pressed, and a second press closes it in place.
   */
  test("a press on its summary opens the board under the summary, and the summary stays where it was pressed", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await home.boardFoldSummary.evaluate((summary) => window.scrollTo(0, summary.getBoundingClientRect().top + window.scrollY - 300));
    const top = () => home.boardFoldSummary.evaluate((summary) => summary.getBoundingClientRect().top);
    const before = await top();
    await home.boardFoldSummary.click();
    await expect(home.boardFold).toHaveAttribute("open", "");
    await expect(home.board).toBeVisible();
    await expect.poll(async () => Math.abs((await top()) - before), { message: "the summary's top against where it was pressed" }).toBeLessThanOrEqual(1);
    await home.boardFoldSummary.click();
    await expect(home.boardFold).not.toHaveAttribute("open", "");
    expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(1);
  });

  /**
   * Round 37, verify-2 N4: at 768 px the board's inline key gained "Weak Qloo signal" only once the fold opened (the
   * board was never measured while shut), so the key wrapped to a second line and a press moved the summary 28 px. The
   * key's count now comes from the width the board opens to, so its items are the same shut and open.
   */
  test("at 768 px the board's key shows the same items with the fold shut and open, so a press leaves the summary where it was (round 37, verify-2 N4)", async ({ page, isPhone }) => {
    test.skip(isPhone, "The desktop project sets the 768 px width.");
    await page.setViewportSize({ width: 768, height: 1024 });
    const home = new HomePage(page);
    const items = () =>
      page.locator("[data-legend-item]").evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().width > 0).map((element) => element.getAttribute("data-legend-item")));
    for (const day of [DAYS.glastonbury, DAYS.riot]) {
      await home.goto(day.id);
      await home.boardFoldSummary.evaluate((summary) => window.scrollTo(0, summary.getBoundingClientRect().top + window.scrollY - 300));
      const top = () => home.boardFoldSummary.evaluate((summary) => summary.getBoundingClientRect().top);
      const shut = await items();
      const before = await top();
      expect(shut, `${day.title}: the key's items with the fold shut`).toContain("weak");
      await home.boardFoldSummary.click();
      await expect(home.boardFold).toHaveAttribute("open", "");
      await expect(home.board).toBeVisible();
      expect(await items(), `${day.title}: the key's items with the fold open`).toEqual(shut);
      expect(Math.abs((await top()) - before), `${day.title}: the summary's top against where it was pressed`).toBeLessThanOrEqual(1);
      await home.boardFoldSummary.click();
      await expect(home.boardFold).not.toHaveAttribute("open", "");
      expect(await items(), `${day.title}: the key's items with the fold shut again`).toEqual(shut);
      expect(Math.abs((await top()) - before), `${day.title}: the summary's top after the second press`).toBeLessThanOrEqual(1);
    }
  });

  /**
   * The fold opens on its own when Try a move first shows a tested place. From 1280 px the summary was the scroll anchor
   * when it sat at the top of the screen, so the opened board (about 1,200 px) carried the picked set down the page,
   * out of view. The picked row now stays where it was pressed.
   */
  test("a tested place from Try a move opens the board above the section without moving the picked row on screen", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    expect(await home.boardOpen()).toBe(false);
    await home.tryAMove.scrollIntoViewIfNeeded();
    const row = home.tryAMove.locator("button[data-start-row]").nth(1);
    const top = () => row.evaluate((element) => element.getBoundingClientRect().top);
    const before = await top();
    await row.click();
    await expect(home.boardFold).toHaveAttribute("open", "", { timeout: 15_000 });
    await expect(home.tryAMove.getByText("Best tested place", { exact: true }).first()).toBeAttached();
    await expect.poll(async () => Math.abs((await top()) - before), { message: "the picked row's top against where it was pressed" }).toBeLessThanOrEqual(2);
  });
});

test.describe("every lock word on a published day says whose lock it is (round 37, L33, merge)", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  for (const day of [DAYS.glastonbury, DAYS.riot]) {
    test(`on ${day.title}, the set pickers mark locked sets "(locked by this app)", and the phone's start-order list names the owner`, async ({ page, isPhone }) => {
      const home = new HomePage(page);
      await home.goto(day.id);
      // Try a move's "Or choose any set" and Keep two sets apart's two pickers.
      await home.openKeepApart();
      const lockOptions = await page
        .locator("#try-a-move select option")
        .evaluateAll((options) => options.map((option) => option.textContent?.trim() ?? "").filter((text) => /locked/i.test(text)));
      expect(lockOptions.length, "locked sets in the pickers").toBeGreaterThan(0);
      for (const text of lockOptions) expect(text).toMatch(/ \(locked by this app\)$/);
      if (!isPhone) return;
      // The phone's start-order list, inside the opened board: no bare "Locked", the owner's words on each locked card.
      await home.openBoard();
      await page.getByText(/^Show the start-order list \(\d+ sets\)$/).click();
      const cards = home.boardFold.locator("details li.rounded-sm");
      await expect(cards.first()).toBeVisible();
      const words = await cards.evaluateAll((items) =>
        items.map((item) => [...item.querySelectorAll("*")].filter((el) => el.childNodes.length > 0 && [...el.childNodes].every((n) => n.nodeType === 3)).map((el) => el.textContent?.trim() ?? "")),
      );
      expect(words.flat()).not.toContain("Locked");
      const texts = await cards.allTextContents();
      expect(texts.filter((text) => text.includes("Locked by this app: kept in place")).length, "locked cards with the owner's words").toBeGreaterThan(0);
      expect(texts.filter((text) => /Locked(?! by this app)/.test(text))).toEqual([]);
    });
  }
});
