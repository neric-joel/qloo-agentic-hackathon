import type { Locator } from "@playwright/test";

import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/** The reading sections of the home page: what taste changes for the hero's pair, who has complained, and where the numbers come from. */

/** The disclosure (a native details) inside a section whose summary starts with this text. */
function disclosure(section: Locator, summary: RegExp): Locator {
  return section.getByRole("group").filter({ has: section.page().locator("summary", { hasText: summary }) });
}

test.describe("what Qloo changes", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("ranks the hero's clash three ways, and its heading names the step taste adds", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const ranks = home.whatQloo.getByRole("list").first().getByRole("listitem");
    await expect(ranks).toHaveCount(3);
    await expect(ranks.nth(0)).toContainText("Time alone");
    await expect(ranks.nth(0)).toContainText("Minutes shared");
    await expect(ranks.nth(1)).toContainText("Time + Qloo popularity");
    await expect(ranks.nth(1)).toContainText("Draw is Qloo popularity, 0 to 100");
    // The third rung is cumulative, and the rank is this app's, read from Qloo data.
    await expect(ranks.nth(2)).toContainText("+ taste overlap from Qloo data");
    await expect(ranks.nth(2)).toContainText("Taste overlap added: the index used here");

    const [timeOnly, drawn, tasted] = await ranks.evaluateAll((all) => all.map((item) => /#(\d+) of (\d+)/.exec(item.textContent ?? "")?.slice(1).map(Number) ?? []));
    expect(timeOnly[1], "all three rank among the same clashes").toBe(drawn[1]);
    expect(drawn[1]).toBe(tasted[1]);
    await expect(home.whatQloo).toContainText(`Place among the day’s ${tasted[1]} clashes, #1 at the left`);
    // Time alone shows its tie, on the full axis.
    await expect(ranks.nth(0)).toContainText(/tied with \d+ others?/);

    // The heading credits taste with its own step only: from the time-and-popularity rank to the taste rank.
    const heading = home.whatQloo.getByRole("heading", { level: 2 });
    await expect(heading).toHaveText("Adding taste moves this pair from #18 to #1");
    const [, from, to] = /from #(\d+) to #(\d+)$/.exec(await heading.innerText()) ?? [];
    expect(Number(from), "the heading's first rank is the time + popularity rung").toBe(drawn[0]);
    expect(Number(to), "the heading's second rank is the taste rung").toBe(tasted[0]);
    // The pair line names the hero's own clash, with the count the three rungs agree on.
    await expect(home.whatQloo).toContainText(`Sprints × Katy J Pearson, 45 min shared, ranked three ways among the day’s ${tasted[1]} scored clashes.`);
    await expect(home.whatQloo).not.toContainText("the clash in the decision above");
  });

  test("says what it does not prove, and closes on the failed test", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const limit = home.whatQloo.getByText("This does not prove #1 is the right clash to move.", { exact: true });
    await expect(limit).toBeVisible();
    // The limit sits directly under the ranks it limits.
    const [figure, under] = await Promise.all([home.whatQloo.getByText(/^Place among the day’s \d+ clashes/).boundingBox(), limit.boundingBox()]);
    expect((under?.y ?? 0) - ((figure?.y ?? 0) + (figure?.height ?? 0)), "the limit line is at most 24 px under the figure").toBeLessThanOrEqual(24);
    // The other half: a clash taste puts lower, which a programmer may choose to keep, said by this index. It never
    // says "costs little".
    const lowers = home.whatQloo.getByText(/^Taste also lowers some clashes: .+ × .+ ranks #\d+ on time and draw but #\d+ with taste: by this index, a candidate to keep\.$/);
    await expect(lowers).toBeVisible();
    await expect(home.whatQloo).not.toContainText(/costs little|fine to keep/);
    await expect(home.whatQloo.getByRole("heading", { level: 3, name: "What the failed test taught us." })).toBeVisible();
    await expect(home.whatQloo).toContainText("Our test failed: taste overlap put 46.8% of complained-about clashes in the top quarter of their day, below our 60% bar.");
    await expect(home.whatQloo).toContainText("Popularity, also a Qloo field, did better.");
    await expect(home.whatQloo).toContainText("The exploratory follow-up did not establish an advantage over popularity.");
    await expect(home.whatQloo).toContainText("So the taste reading is a second opinion beside time and draw: the part Qloo’s taste data adds to the index, never the verdict on its own.");
    // The correlation with popularity is stated on /method, where it is defined (method.spec.ts pins it there).
    await expect(home.whatQloo).not.toContainText(/unrelated to popularity/);
    await expect(home.whatQloo).not.toContainText("never folded into a verdict");
    await expect(home.whatQloo.getByRole("link", { name: "How we know" })).toHaveAttribute("href", "/method#tested");
    // The exploratory split stays on /method only: no interval on home.
    await expect(home.whatQloo).not.toContainText(/\+0\.201|−0\.065/);
  });

  test("its two disclosures show equal-popularity rivals and the day's two rankings", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const rivals = disclosure(home.whatQloo, /^Equal-popularity pairs/);
    await rivals.locator("summary").click();
    await expect(rivals).toContainText("Draw is Qloo popularity, a percentile among Qloo artists");
    await expect(rivals).toContainText(/Level on draw, \d+ apart on taste overlap\./);

    const rankings = disclosure(home.whatQloo, /^Two rankings of this day/);
    await rankings.locator("summary").click();
    await expect(rankings).toContainText("What taste overlap changes");
    await expect(rankings).toContainText("So this shows that taste overlap reorders the list, not that Qloo’s numbers pick the right clashes.");
    await expect(rankings).toContainText("The check we set before building did not pass (see How we know).");
    // The hero's pair, with its two places (no saved-day figure is written into this test).
    await expect(rankings).toContainText(/Sprints and Katy J Pearson · \d+(st|nd|rd|th) of \d+ with taste overlap, \d+(st|nd|rd|th) of \d+ on draw and time alone/);
  });

  test("the second day says when taste does not change the pair's place, without saying time alone agrees", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.riot.id);

    const ranks = home.whatQloo.getByRole("list").first().getByRole("listitem");
    const [timeOnly, drawn, tasted] = await ranks.evaluateAll((all) => all.map((item) => Number(/#(\d+) of/.exec(item.textContent ?? "")?.[1])));
    expect(tasted, "taste leaves the pair where popularity put it").toBe(drawn);
    await expect(home.whatQloo.getByRole("heading", { level: 2 })).toHaveText(`Adding taste leaves this pair at #${tasted}`);
    // Time alone still shows its own place and its tie; nothing says it agrees.
    expect(timeOnly).toBeGreaterThanOrEqual(tasted);
    await expect(ranks.nth(0)).toContainText(/tied with \d+ others?/);
    await expect(home.whatQloo).not.toContainText("Taste agrees with time");
    // Here taste names a clash it lowers instead: one the time-and-draw ranking puts high and taste puts low.
    const lowers = home.whatQloo.getByText(/^Taste also lowers some clashes: Pierce the Veil × Elvis Costello & The Imposters ranks #\d+ on time and draw but #\d+ with taste/);
    await expect(lowers).toBeVisible();
    const [, onDraw, withTaste] = /ranks #(\d+) on time and draw but #(\d+) with taste/.exec(await lowers.innerText()) ?? [];
    expect(Number(withTaste), "taste ranks it lower").toBeGreaterThan(Number(onDraw));
    await expect(lowers).toContainText("by this index, a candidate to keep.");
    await expect(home.whatQloo).not.toContainText(/In this day’s two rankings, taste moves/);
    await expect(home.whatQloo).toContainText("Same timetable, ranked three ways. This shows what taste changes; it does not prove the taste ranking is better.");
  });
});

test.describe("what Qloo changes: its height and the index card's lines beside it", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, the section is at most 760 px tall at 1440 light and 1,500 px at 390 dark; from 1024 px the two-set line's top is at or above the index card's foot`, async ({ page, isPhone }) => {
      const theme = isPhone ? "dark" : "light";
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      await page.emulateMedia({ colorScheme: theme });
      const home = new HomePage(page);
      await home.goto(day.id);
      expect(await home.chrome.appliedTheme()).toBe(theme);

      // Every disclosure closed, as the page opens.
      await expect(home.whatQloo.locator("details[open]")).toHaveCount(0);
      const height = await home.whatQloo.evaluate((section) => section.getBoundingClientRect().height);
      const ceiling = isPhone ? 1_500 : 760;
      test.info().annotations.push({ type: `What Qloo changes on ${day.title} at ${isPhone ? "390 dark" : "1440 light"}`, description: `${height.toFixed(1)} px` });
      expect(height, `"What Qloo changes" height at ${isPhone ? "390 dark" : "1440 light"}`).toBeLessThanOrEqual(ceiling);

      if (!isPhone) {
        // The two-set change line sits beside the index card, high enough that the index it names is read beside the
        // card's scale; on Glastonbury the hidden-clash line comes before it.
        const card = await home.indexCard.boundingBox();
        const change = await home.indexBeside.locator("[data-change-line]").boundingBox();
        expect(card, "the index card is drawn").not.toBeNull();
        expect(change, "the two-set line is drawn beside the card").not.toBeNull();
        expect(change?.y ?? Infinity, "the two-set line's top is at or above the card's foot").toBeLessThanOrEqual((card?.y ?? 0) + (card?.height ?? 0));
        expect(change?.x ?? 0, "beside the card, to its right").toBeGreaterThanOrEqual((card?.x ?? 0) + (card?.width ?? 0));
        await expect(home.indexBeside.locator("[data-change-line]").getByRole("button", { name: "Keep the two-set change" })).toBeVisible();
      }
    });
  }
});

test.describe("who has complained, and what nobody has tested", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("says what the public pages show, that it counts pages and not people, with no click, and links to the sources on /method (round 38)", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    const claim = home.whyThisMatters.locator("[data-why-public]");
    await expect(claim).toBeVisible();
    expect(await claim.evaluate((element) => element.closest("details:not([open])") === null), "open, with no click").toBe(true);
    await expect(claim).toContainText(
      "Our analysis of 70 public press articles, fan-post summaries and one artist statement from 17 festivals (2015 to 2026) found 325 named set-time clashes, covering 538 distinct pairs of acts.",
    );
    await expect(claim).toContainText("It counts pages, not people, so it shows the complaint keeps coming back, not how many people mind.");
    await expect(claim).not.toContainText(/survey|poll|people we asked|respondents/i);
    const link = claim.getByRole("link", { name: "Sources and limits" });
    await expect(link).toHaveAttribute("href", "/method#asked");
    await expect(link).not.toHaveAttribute("target", "_blank");
    await link.click();
    await expect(page).toHaveURL(/\/method#asked$/);
    await expect(page.getByRole("heading", { level: 2, name: "What people ask about clashes" })).toBeInViewport();
  });

  test("opens on the stake and the moment of use, with no click", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const stake = home.whyThisMatters.getByText(
      "When two sets clash, anyone who wants to see both has to choose. Clash Control is for the time after acts are booked and before set times go out.",
      { exact: true },
    );
    await expect(stake).toBeVisible();
    expect(await stake.evaluate((element) => element.closest("details:not([open])") === null), "open, with no click").toBe(true);
    // It is the section's first line under its heading, before the finding.
    const [lead, finding] = await Promise.all([
      stake.boundingBox(),
      home.whyThisMatters.getByRole("heading", { level: 3, name: /^45 clashes that fans or the press complained about/ }).boundingBox(),
    ]);
    expect(lead?.y ?? Infinity, "the stake comes before the finding").toBeLessThan(finding?.y ?? 0);
  });

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, right after the stake, one paragraph says how to keep a clash on purpose, what not to decide with this, what an act's team would see if a festival used it, and that no artist content is written (round 37, L35, L36, L37)`, async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      const use = home.whyThisMatters.locator("[data-why-use]");
      await expect(use).toHaveCount(1);
      await expect(use).toHaveText(
        "A clash can stay: in Check a draft grid, choose “Kept on purpose”. Do not use this to set fees, billing order or an artist’s worth, or for crowd capacity, safety or attendance. If a festival used it, an act’s team would see the brief: the proposed time and the minutes shared before and after. This app writes no artist bios, images or messages.",
      );
      await expect(use).toBeVisible();
      expect(await use.evaluate((element) => element.closest("details:not([open])") === null), "open, with no click").toBe(true);
      // Directly after the stake, and before the columns.
      const order = await use.evaluate((element) => ({
        previous: element.previousElementSibling?.textContent ?? "",
        nextIsColumns: Boolean(element.nextElementSibling?.querySelector("h3")),
      }));
      expect(order.previous, "the paragraph before it is the stake").toBe(
        "When two sets clash, anyone who wants to see both has to choose. Clash Control is for the time after acts are booked and before set times go out.",
      );
      expect(order.nextIsColumns, "the columns with their findings follow it").toBe(true);
      // The do-not-use sentence is the same words as /method's.
      await page.goto("/method", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#limits li").filter({ hasText: /^Do not use this to set fees/ })).toHaveText(
        "Do not use this to set fees, billing order or an artist’s worth, or for crowd capacity, safety or attendance.",
      );
    });
  }

  test("states the problem with its public figures beside what limits them, and quotes no paraphrased voices", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const section = home.whyThisMatters;
    // The finding is the column's own heading, and the line that limits it follows it, with no click.
    await expect(section.getByRole("heading", { level: 3, name: "45 clashes that fans or the press complained about at 5 festivals had a verified overlap in time." })).toBeVisible();
    await expect(section.getByText(/Most of these complaints are about other festivals and days, not the days this app shows\.$/)).toBeVisible();
    // The range chart and the programmers' paraphrases are cut (they claimed more than they showed); the median
    // stays on /method with its figures.
    await expect(section.getByRole("img", { name: /^Overlap range and median/ })).toHaveCount(0);
    await expect(section.getByRole("heading", { name: "What programmers have said in public" })).toHaveCount(0);
    await expect(section).not.toContainText("(our summary)");
    await expect(section).not.toContainText("median 50 minutes");
    // What is still not known stays said in the open.
    await expect(section).toContainText("Who would pay is not known.");
  });

  test("is plain about what is not known: no tested demand, no scheduler found, one answer is not a market", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const section = home.whyThisMatters;
    await expect(section.getByRole("heading", { level: 3, name: "No scheduler we found reads audience overlap" })).toBeVisible();
    await expect(section).toContainText("Our search, October 2026: absence of evidence only. Who would pay is not known.");

    // The guess at who would pay is cut: only what is known is said.
    await expect(section).not.toContainText("Our guess, not yet tested");
    const schedulers = disclosure(section, /^Festival Pro and Lineup Ninja/);
    await schedulers.locator("summary").click();
    await expect(schedulers).toContainText("We found none that reads audience overlap (our search, October 2026).");
    // The pilot's success line says one answer is not a market, in the open. The pilot offers nothing that costs a
    // Qloo request, so the request arithmetic is not on the page (round 33 R1.9: it is on the Devpost page).
    await expect(section).toContainText("Success: you say which suggestion you would take or turn down, and why. One answer is not a market.");
    await expect(section.locator("summary", { hasText: /Qloo requests/ })).toHaveCount(0);
    await expect(section).not.toContainText("Pricing a new bill is not offered");
    const complaints = disclosure(section, /^How the lists lean \(86 verified pairs\)$/);
    await complaints.locator("summary").click();
    await expect(complaints).toContainText("Press lists lean toward headliners, which flatters any taste-based method.");
    // Where the complaints come from, said as counts of public pages, with no claim about who attended.
    await expect(section).toContainText(/They come from \w+ Reddit threads and \w+ press articles \(.+\)\./);
    await expect(section).toContainText("Most of these complaints are about other festivals and days, not the days this app shows.");
    // The failed test and the popularity result are stated once on the page, in What Qloo changes, not repeated here.
    await expect(home.whatQloo).toContainText("Popularity, also a Qloo field, did better. It reached 57.8%.");
    await expect(section).not.toContainText("57.8%");
  });

  test("the pilot offer asks for a walk-through of the saved brief and points to the check page", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const section = home.whyThisMatters;
    await expect(section.getByRole("heading", { level: 3, name: "Pilot offer" })).toBeVisible();
    // A zero-quota offer: the saved Glastonbury brief, and the browser-only check for a programmer's own draft.
    await expect(section).toContainText("Walk through the Glastonbury 2025 Sunday brief with me and say where it matches how your team would set those times.");
    await expect(section).toContainText("Your own draft can go through Check a draft grid, whose rule checks run in your browser and send nothing.");
    await expect(section).toContainText("Success: you say which suggestion you would take or turn down, and why.");
    // The owner's contact, as a mail link.
    await expect(section).toContainText("Contact: nericjoel07@gmail.com");
    await expect(section.getByRole("link", { name: "nericjoel07@gmail.com", exact: true })).toHaveAttribute("href", "mailto:nericjoel07@gmail.com");
    await section.getByRole("link", { name: "Check a draft grid" }).click();
    await expect(page).toHaveURL(/\/check$/);
  });
});

test.describe("where the numbers come from", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("says the day is recorded, not live, and which festival does not use the product", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.sources).toContainText("Glastonbury Festival 2025 does not use Clash Control. Nothing here is the festival’s own data or view.");
    // That the published timetables are scored by this app is said once, in the footer every page shares.
    await expect(home.chrome.footer).toContainText("The festivals shown do not use Clash Control; their published timetables are scored by this app.");
    await expect(home.sources).toContainText("Recorded, not live.");
    await expect(home.sources).toContainText(/Preset built \d{4}-\d{2}-\d{2} UTC from saved Qloo responses\./);
    await expect(home.sources).toContainText("31 of 36 acts on this day score 90 or more out of 100.");
    await expect(home.sources.getByRole("link", { name: "How we know" })).toHaveAttribute("href", "/method");
  });

  test("lists the timetable sources as links that open in a new tab", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const group = disclosure(home.sources, /^Timetable sources \(8\)/);
    await group.locator("summary").click();
    const links = group.getByRole("link");
    await expect(links).toHaveCount(8);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("href", /^https:\/\//);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
      await expect(link).toContainText("(opens in a new tab)");
    }
    await expect(group).toContainText("accessed 2026-10-02");
  });
});
