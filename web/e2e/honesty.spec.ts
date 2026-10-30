import { DAYS, HONESTY, READY_TIMEOUT, literal, requireSavedDays, scrollThrough } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { SiteChrome } from "./pages/site-chrome";
import { TryAMove } from "./pages/try-a-move";

/**
 * The site's required honesty lines. "A reading, not a verdict." qualifies every Clash Budget Index it prints;
 * "Neither festival uses Clash Control." says the two festivals shown did not ask for this. Both have to
 * survive every state the page can be in: either day, either theme, after a move, after a day switch.
 */

/** What "Where the numbers come from" says about each day, with the festival's own name. */
const SOURCES_LINE: Record<string, string> = {
  [DAYS.glastonbury.id]: "Glastonbury Festival 2025 does not use Clash Control.",
  [DAYS.riot.id]: "Riot Fest 2026 does not use Clash Control.",
};

test.describe("honesty lines", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}: both lines are on the page`, async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      // The reading sits beside the move in the hero, on the first screen, and in the same block as the index
      // it qualifies, in the index card under the hero.
      await expect(home.attribution).toHaveText(`Selected and scored by this app’s index. ${HONESTY.reading}`);
      await expect(home.attribution).toBeInViewport();
      await expect(home.indexBlock).toContainText(HONESTY.reading);
      // The festivals did not ask for this: stated in the hero's dateline, and again where the numbers come from. The
      // dateline also says the saved reading is global: both days were read with no location sent.
      await expect(home.dateline).toContainText(HONESTY.neither);
      if (day.id === DAYS.glastonbury.id) {
        await expect(home.dateline).toHaveText(`Sunday. Published timetable; saved global Qloo reading built 3 Oct 2026. ${HONESTY.neither}`);
      } else {
        // The date's three parts are joined by no-break spaces, which a regular expression names.
        await expect(home.dateline).toHaveText(
          new RegExp(`^${day.dayName}\\. Published timetable; saved global Qloo reading built \\d{1,2}\\u00a0[A-Z][a-z]{2}\\u00a0\\d{4}\\. ${literal(HONESTY.neither)}$`),
        );
      }
      await expect(home.hero.getByText(HONESTY.neither)).toBeVisible();
      await expect(home.sources).toContainText(SOURCES_LINE[day.id]);
    });
  }

  test("the lines survive a move, a day switch and a theme change", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.keepMove.click();
    await expect(new TryAMove(page).plan).toBeVisible();
    await expect(home.attribution).toContainText(HONESTY.reading);
    await expect(home.indexBlock).toContainText(HONESTY.reading);
    await expect(home.hero).toContainText(HONESTY.neither);

    await home.chooseDay(DAYS.riot.festival);
    await expect(home.page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible();
    await expect(home.attribution).toContainText(HONESTY.reading);
    await expect(home.indexBlock).toContainText(HONESTY.reading);
    await expect(home.hero).toContainText(HONESTY.neither);

    await new SiteChrome(page).chooseTheme("Dark");
    await expect(home.attribution).toContainText(HONESTY.reading);
    await expect(home.indexBlock).toContainText(HONESTY.reading);
    await expect(home.hero).toContainText(HONESTY.neither);
  });

  test("every Clash Budget Index figure on the home page is within a block that says it is a reading", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await scrollThrough(page);

    // The index card's score, the dial's score and the plan's score each carry the caveat in their own block.
    await expect(home.indexBlock).toContainText("Selected and scored by this app’s index. A reading, not a verdict.");
    const dial = page.getByRole("figure").filter({ hasText: "Clash Budget Index" });
    // What 100 means and which way is better: in the sentence under the figure, in its explanation, and in the
    // scale's own description (which also says the random timetables are of this lineup).
    await expect(dial).toContainText("where 100 is the average random valid timetable and higher means more clash cost.");
    await expect(dial.locator("[data-index-explain]")).toHaveText("Lower is better. It counts only what clashes cost: taste overlap, time shared, draw and a rarity factor.");
    await expect(dial.getByRole("img", { name: /^Clash Budget Index \d+\.\d .*100 is the average of random valid timetables of this lineup.* Lower is better\.$/ })).toHaveCount(1);
    await home.keepMove.click();
    await expect(new TryAMove(page).planRegion).toContainText("Scored by the same measure the places are found with, so a lower number shows what that measure rewards, not that audiences would be better served.");
  });

  test("the pitch says who it is for and that Qloo taste data is used to schedule, not to recommend; the taste number says it is a rank, not attendance, beside it", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.lede).toContainText("For heads of programming:");
    // The data is named as Qloo's and its use is framed: scheduling, not recommending.
    await expect(home.lede).toContainText("Qloo taste data used to schedule, not to recommend.");
    await expect(home.lede).not.toContainText("attendance");
    // The qualifier sits beside its number, in one element with the Derived stamp (the rank is this app's).
    await expect(home.tasteLine).toContainText(/^Taste overlap: \d+ of 100 on this bill \(a rank, not attendance\)/);
    await expect(home.tasteLine.getByText("Derived")).toBeVisible();
    // The complaint figures left the hero: they sit in Why this matters, beside the line that limits them.
    await expect(home.hero).not.toContainText("Fans and press complained");
    const finding = home.whyThisMatters.getByRole("heading", { level: 3, name: /^45 clashes that fans or the press complained about at 5 festivals/ });
    await expect(finding).toBeVisible();
    const limit = home.whyThisMatters.getByText("Most of these complaints are about other festivals and days, not the days this app shows.");
    await expect(limit).toBeVisible();
    const [heading, line] = await Promise.all([finding.boundingBox(), limit.boundingBox()]);
    expect(Math.abs((line?.y ?? 0) - ((heading?.y ?? 0) + (heading?.height ?? 0))), "the limit sits right under the figures").toBeLessThan(200);
  });

  test("at 1440 x 900 the move's caveats are on the first screen: who scored it, that it is a reading, and the taste qualifier", async ({ page, isPhone }) => {
    test.skip(isPhone, "The desktop first screen is measured at 1440 x 900.");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    for (const part of [home.attribution, home.tasteLine, home.sideEffects, home.keepMove, home.dateline]) {
      const box = await part.boundingBox();
      expect(box, "drawn").not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0), "ends inside the first 900 px").toBeLessThanOrEqual(900);
    }
    await expect(home.attribution).toHaveText("Selected and scored by this app’s index. A reading, not a verdict.");
    await expect(home.tasteLine).toContainText("(a rank, not attendance)");
  });

  test("the printed brief carries the same caveats", async ({ page }) => {
    await page.goto(`/brief?preset=${DAYS.glastonbury.id}&day=0`, { waitUntil: "domcontentloaded" });
    const article = page.getByRole("article");
    await expect(article).toContainText("Glastonbury Festival 2025 does not use Clash Control.");
    await expect(article).toContainText("A reading, not a verdict on the festival.");
    await expect(article).toContainText("It measures taste, not attendance.");
    await expect(article).toContainText("not endorsed by Qloo or Glastonbury Festival 2025");
  });

  /**
   * The price words. Every index is "a score, not money", so the pages say "score": the footer's sources line,
   * /method's "pair score" family (its table header included) and formulaNote's "the printed score". No page says a
   * price word. Pages as opened, every
   * disclosure open, no Replay and no live press.
   */
  const PRICE_WORD = /\bpric(e|ed|es|ing)\b/gi;
  const FOOTER_SOURCES = "Popularity and audience comparisons are saved Qloo responses; taste overlap and clash scores are calculated by this app from them.";
  /** Older price strings, since renamed: none of them is on any page now. */
  const ROUND_36_KEPT = [/\bfull price\b/gi, /\bthe printed price\b/gi, /taste overlap and prices are calculated/gi] as const;
  /** Lock words no page says: the old ones, and one that would claim to know what the festival did. */
  const NOT_SAID = /not by the festival|which cannot move|Locked set: fixed slot|this set stays put/;

  for (const [name, url] of [
    ["the home page", `/?preset=${DAYS.glastonbury.id}`],
    ["Riot Fest's home page", `/?preset=${DAYS.riot.id}`],
    ["/method", "/method"],
    ["/check", "/check"],
    ["the kept Glastonbury brief", `/brief?preset=${DAYS.glastonbury.id}&day=0&moves=sprints~woodsies~0~1415`],
  ] as const) {
    test(`${name}: no "price" word at all, and no lock word claims the festival's view`, async ({ page, isPhone }) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await new SiteChrome(page).waitForHydration();
      if (url.startsWith("/?")) await new HomePage(page).waitUntilReady();
      if (url.startsWith("/brief")) await expect(page.getByRole("region", { name: "Your plan" })).toBeVisible();
      if (url === "/check") await expect(page.getByRole("region", { name: "Checked" })).toBeVisible();
      await scrollThrough(page);
      // The board's reading of its key is a view change, not a disclosure; open it too where it is a button.
      if (url.startsWith("/?") && !isPhone) await page.getByRole("button", { name: "How to read the board" }).click();
      // Every disclosure open, the board's fold included, so its tiles are read too.
      await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
      if (url.startsWith("/?")) await expect(new HomePage(page).board).toBeVisible();
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");

      // The footer's sources line: once, in its current words.
      expect(text.split(FOOTER_SOURCES).length - 1, "the footer's sources line").toBe(1);
      for (const kept of ROUND_36_KEPT) expect(text.match(kept)?.length ?? 0, `${name}: ${kept}`).toBe(0);
      if (url === "/method") {
        // The follow-up's table header says "Pair score" now, and no column says "Full price".
        await expect(page.getByRole("columnheader", { name: "Pair score" })).toHaveCount(1);
        await expect(page.getByRole("columnheader", { name: "Full price" })).toHaveCount(0);
      }
      const left = [...text.matchAll(PRICE_WORD)].map((match) => text.slice(Math.max(0, (match.index ?? 0) - 50), (match.index ?? 0) + 50));
      expect(left, `${name}: price words`).toEqual([]);
      expect(text, `${name}: lock words`).not.toMatch(NOT_SAID);
    });
  }

  test("the footer on every page says the festivals shown do not use Clash Control, with its licence line", async ({ page }) => {
    for (const url of ["/", "/method", "/check", "/brief"]) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      // On "/" the footer shows with the page: the server's frame holds it back while scripts run, so it can take as long as the page's own mount on a busy dev server.
      await expect(page.getByRole("contentinfo"), url).toContainText("The festivals shown do not use Clash Control", { timeout: READY_TIMEOUT });
      // One line with the licence, the source code and who the entry is not.
      const legal = page.getByRole("contentinfo").getByText(/^Independent entry: not endorsed by Qloo/);
      await expect(legal, url).toHaveText("Independent entry: not endorsed by Qloo, Glastonbury Festival or Riot Fest, and not affiliated with any of them.");
      await expect(page.getByRole("contentinfo").getByRole("link", { name: "MIT licence" }), url).toBeVisible();
      await expect(page.getByRole("contentinfo").getByRole("link", { name: "Source code" }), url).toBeVisible();
    }
  });
});
