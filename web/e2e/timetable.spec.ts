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
    test(`on ${day.title}, the board's grid is one disclosure (open on arrival from 1280 px, closed on a phone) whose summary counts what it opens, and the caption, coverage, key and clash list stay open (round 37, L29 and L30; round 39, W2)`, async ({ page, isPhone }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      // Round 39 (W2, D13): open on arrival at 1440 with the grid shown, closed on a phone. At 1440 a visitor's press
      // closes it, and the rest runs on the closed board as before. Its summary is a 44 px control with the chevron.
      await expect(home.boardFold).toHaveCount(1);
      if (isPhone) {
        expect(await home.boardOpen(), "closed on arrival on a phone").toBe(false);
      } else {
        expect(await home.boardOpen(), "open on arrival at 1440").toBe(true);
        await expect(home.board).toBeVisible();
        await home.boardFoldSummary.click();
        expect(await home.boardOpen(), "closed by a press").toBe(false);
      }
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
    // Round 39 (W2): from 1280 px the board arrives open, so a visitor's press closes it first; on a phone it arrives
    // closed and nothing is pressed.
    await home.closeBoard();
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
    // Round 39 (W2): from 1280 px the board arrives open, so a visitor's press closes it first (the case this test
    // holds: the fold closed while the visitor is at Try a move); on a phone it arrives closed.
    await home.closeBoard();
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

/**
 * Round 39 (W2, D13): the board's disclosure arrives open on a screen 1280 px wide or more, and closed below. The width
 * is read once, as the interactive board is first drawn, so after arrival only a press (or a preview of the visitor's
 * own) changes it, and the next festival day is drawn the way this one was left. The server's frame knows no width, so
 * its fold is closed; the arrival open starts no transition (reduced-motion.spec.ts holds first paint with motion
 * allowed).
 */
test.describe("the board's disclosure on arrival (round 39, W2, D13)", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  /** The board's rail (the score and the costliest clashes) against the fold: rail bottom minus fold bottom, in px. */
  async function railPastFold(home: HomePage): Promise<number | null> {
    return home.boardFold.evaluate((fold, list) => {
      const rail = fold.parentElement?.parentElement?.children[0];
      if (!rail || !list || !rail.contains(list)) return null;
      return rail.getBoundingClientRect().bottom - fold.getBoundingClientRect().bottom;
    }, await home.costliest.elementHandle());
  }

  type Sample = { t: number; open: boolean | null; interactive: boolean; grid: boolean };
  type BoardStore = { start: number; until: number; done: boolean; samples: Sample[]; shift: number; tick: () => void };

  /**
   * Samples the board every 50 ms from DOMContentLoaded for 5 s, and at least 2 s past the interactive board's first
   * sample (on a busy dev server it can come late): whether the visible fold is open, whether it is the interactive
   * board's (its caption is drawn only there) and whether its grid is drawn. Also sums layout shift with no recent
   * input over the first 5 s.
   */
  async function sampleBoard(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const store = { start: 0, until: 5_000, done: false, samples: [] as Sample[], shift: 0, tick: () => {} };
      (window as unknown as { __board: typeof store }).__board = store;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; startTime: number }[]) {
          if (!entry.hadRecentInput && (store.start === 0 || entry.startTime - store.start <= 5_000)) store.shift += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
      store.tick = () => {
        const t = performance.now() - store.start;
        const fold = [...document.querySelectorAll<HTMLDetailsElement>("details[data-board-fold]")].find((element) => element.getClientRects().length > 0);
        const interactive = document.querySelector("[data-board-caption]") !== null;
        if (interactive && !store.samples.some((sample) => sample.interactive)) store.until = Math.max(store.until, t + 2_000);
        store.samples.push({
          t,
          open: fold ? fold.open : null,
          interactive,
          grid: [...document.querySelectorAll('[role="group"][aria-label$="timetable. Use the arrow keys to move between sets."]')].some((element) => element.getClientRects().length > 0),
        });
        if (t < Math.min(store.until, 20_000)) window.setTimeout(store.tick, 50);
        else store.done = true;
      };
      document.addEventListener("DOMContentLoaded", () => {
        store.start = performance.now();
        store.tick();
      });
    });
  }

  /** Keeps the sampler running for at least `ms` more, and returns the time now, in ms after DOMContentLoaded. */
  async function sampleFor(page: Page, ms: number): Promise<number> {
    return page.evaluate((more) => {
      const store = (window as unknown as { __board: BoardStore }).__board;
      const now = performance.now() - store.start;
      store.until = Math.max(store.until, now + more);
      if (store.done) {
        store.done = false;
        store.tick();
      }
      return now;
    }, ms);
  }

  async function readBoard(page: Page): Promise<BoardStore> {
    await expect.poll(() => page.evaluate(() => (window as unknown as { __board: BoardStore }).__board.done), { timeout: 30_000, message: "the board's samples" }).toBe(true);
    return page.evaluate(() => {
      const { start, until, done, samples, shift } = (window as unknown as { __board: BoardStore }).__board;
      return { start, until, done, samples, shift, tick: () => {} };
    });
  }

  /** The fold's open state every 50 ms for `ms`, from now (a festival-day switch is not a new load). */
  function watchFold(page: Page, ms: number): Promise<(boolean | null)[]> {
    return page.evaluate(
      (span) =>
        new Promise<(boolean | null)[]>((resolve) => {
          const out: (boolean | null)[] = [];
          const started = performance.now();
          const id = window.setInterval(() => {
            const fold = [...document.querySelectorAll<HTMLDetailsElement>("details[data-board-fold]")].find((element) => element.getClientRects().length > 0);
            out.push(fold ? fold.open : null);
            if (performance.now() - started >= span) {
              window.clearInterval(id);
              resolve(out);
            }
          }, 50);
        }),
      ms,
    );
  }

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, open with no click at 1440 x 900 and 1280 x 800 with the grid shown and no empty block beside the rail, closed at 1279 x 800, 1024 x 768 and 390 x 844; a press closes and a second opens, or on a closed board opens it`, async ({ page, isPhone }) => {
      const home = new HomePage(page);
      const sizes = isPhone
        ? [{ width: 390, height: 844, wide: false }]
        : [
            { width: 1440, height: 900, wide: true },
            { width: 1280, height: 800, wide: true },
            { width: 1279, height: 800, wide: false },
            { width: 1024, height: 768, wide: false },
          ];
      for (const size of sizes) {
        const at = `${size.width} x ${size.height}`;
        await page.setViewportSize({ width: size.width, height: size.height });
        await home.goto(day.id);
        if (size.wide) {
          expect(await home.boardOpen(), `${at}: open on arrival, with no click`).toBe(true);
          await expect(home.board, `${at}: the grid is shown`).toBeVisible();
          // The rail beside the board ends at or above the fold's foot: no empty block beside it (was 589 px at 1440).
          const gap = await railPastFold(home);
          test.info().annotations.push({ type: `rail bottom minus fold bottom at ${at}`, description: `${gap?.toFixed(1)} px` });
          expect(gap, `${at}: the rail is the fold's neighbour`).not.toBeNull();
          expect(gap ?? Infinity, `${at}: rail bottom minus fold bottom`).toBeLessThanOrEqual(0);
          await home.boardFoldSummary.click();
          expect(await home.boardOpen(), `${at}: closed by a press`).toBe(false);
          await expect(home.board, `${at}: the grid is hidden`).toBeHidden();
          await home.boardFoldSummary.click();
          expect(await home.boardOpen(), `${at}: opened by a second press`).toBe(true);
          await expect(home.board).toBeVisible();
        } else {
          expect(await home.boardOpen(), `${at}: closed on arrival`).toBe(false);
          await expect(home.board, `${at}: the grid is hidden`).toBeHidden();
          await home.boardFoldSummary.click();
          expect(await home.boardOpen(), `${at}: opened by a press`).toBe(true);
          await expect(home.board).toBeVisible();
        }
      }
    });
  }

  test("untouched, the next festival day's board arrives open; closed by a press, it stays closed on the next day (1440)", async ({ page, isPhone }) => {
    test.skip(isPhone, "On a phone the board arrives closed on every day.");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    expect(await home.boardOpen()).toBe(true);
    const glastonbury = await home.boardFoldSummary.innerText();

    // Untouched: the switch to Riot Fest draws its board open, and no sample reads it closed.
    let watching = watchFold(page, 3_000);
    await home.chooseDay(DAYS.riot.festival);
    await expect(page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible();
    await expect(home.boardFoldSummary).not.toHaveText(glastonbury);
    await expect(home.tile("Bowling for Soup"), "untouched: the next day's board is open").toBeVisible();
    expect((await watching).filter((open) => open === false), "untouched: closed samples through the switch").toEqual([]);
    const riot = await home.boardFoldSummary.innerText();

    // Closed by a press, then the switch back: it stays closed, in every sample.
    await home.closeBoard();
    watching = watchFold(page, 3_000);
    await home.chooseDay(DAYS.glastonbury.festival);
    await expect(page.getByText(`Published timetable · ${DAYS.glastonbury.title}`)).toBeVisible();
    await expect(home.boardFoldSummary).not.toHaveText(riot);
    expect((await watching).filter((open) => open === true), "closed by a press: open samples through the switch").toEqual([]);
    expect(await home.boardOpen(), "closed by a press: the next day's board stays closed").toBe(false);
    await expect(home.board).toBeHidden();
  });

  test("open from the interactive board's first paint at 1440 and closed at 390, layout shift over 5 s from load at most 0.01, and a press as soon as the board takes one holds (condition 9)", async ({ page, isPhone }) => {
    test.setTimeout(120_000);
    const home = new HomePage(page);
    // One load first, so the measured load is the page's own and not the dev server's first compile.
    await home.goto(DAYS.glastonbury.id);
    await sampleBoard(page);

    // Untouched: every sample in which the interactive board is drawn reads open at 1440 (its grid drawn) and closed at
    // 390, and layout shift over the first 5 s stays at most 0.01.
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    const untouched = await readBoard(page);
    const drawn = untouched.samples.filter((sample) => sample.interactive && sample.open !== null);
    test.info().annotations.push({
      type: "untouched load",
      description: `${drawn.length} of ${untouched.samples.length} samples on the interactive board, the first at ${Math.round(drawn[0]?.t ?? -1)} ms; layout shift ${untouched.shift.toFixed(5)}`,
    });
    expect(drawn.length, "samples on the interactive board").toBeGreaterThanOrEqual(10);
    expect(drawn.filter((sample) => sample.open !== !isPhone), isPhone ? "every interactive sample closed at 390" : "every interactive sample open at 1440").toEqual([]);
    if (!isPhone) expect(drawn.filter((sample) => !sample.grid), "the grid drawn in every interactive sample at 1440").toEqual([]);
    expect(untouched.shift, "layout shift over 5 s from load").toBeLessThanOrEqual(0.01);

    // A press as soon as the interactive board takes one (its caption is drawn only there): at 1440 it closes the
    // board, at 390 it opens it, and that holds in every sample for 3 s after it, with no change without a press.
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    await expect(home.boardCaption).toBeVisible({ timeout: 30_000 });
    await home.boardFoldSummary.click();
    const pressedAt = await sampleFor(page, 3_000);
    const pressed = await readBoard(page);
    const after = pressed.samples.filter((sample) => sample.t > pressedAt + 100 && sample.interactive);
    test.info().annotations.push({ type: "press", description: `pressed ${Math.round(pressedAt)} ms after DOMContentLoaded; ${after.length} samples after it` });
    expect(after.length, "samples after the press").toBeGreaterThanOrEqual(10);
    expect(after.filter((sample) => sample.open !== isPhone), isPhone ? "the press opened it, and it stays open" : "the press closed it, and it stays closed").toEqual([]);
    expect(await home.boardOpen(), "the press's state at the end").toBe(isPhone);
  });

  test("a festival-day switch as soon as the picker takes a press arrives open at 1440, with no closed sample after the press, and closed at 390 (condition 9)", async ({ page, isPhone }) => {
    test.setTimeout(120_000);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await sampleBoard(page);
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    // As soon as the interactive picker takes a press: the board's caption is drawn only by the interactive page.
    await expect(home.boardCaption).toBeVisible({ timeout: 30_000 });
    await home.chooseDay(DAYS.riot.festival);
    const pressedAt = await sampleFor(page, 3_000);
    await expect(page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible({ timeout: 20_000 });
    const switched = await readBoard(page);
    const after = switched.samples.filter((sample) => sample.t > pressedAt && sample.interactive && sample.open !== null);
    test.info().annotations.push({ type: "switch", description: `picked ${Math.round(pressedAt)} ms after DOMContentLoaded; ${after.length} samples after it` });
    expect(after.length, "samples after the switch").toBeGreaterThanOrEqual(10);
    expect(after.filter((sample) => sample.open !== !isPhone), isPhone ? "closed through the switch at 390" : "no closed sample after the switch at 1440").toEqual([]);
    expect(await home.boardOpen(), "the new day's board, untouched").toBe(!isPhone);
    if (!isPhone) await expect(home.tile("Bowling for Soup")).toBeVisible();
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
