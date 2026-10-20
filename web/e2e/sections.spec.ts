import type { Locator } from "@playwright/test";

import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/** The reading sections of the home page: what Qloo changes, who has complained, and where the numbers come from. */

/** The disclosure (a native details) inside a section whose summary starts with this text. */
function disclosure(section: Locator, summary: RegExp): Locator {
  return section.getByRole("group").filter({ has: section.page().locator("summary", { hasText: summary }) });
}

test.describe("what Qloo changes", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("ranks the card's clash three ways, and the card's own line quotes the same ranks", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const ranks = home.whatQloo.getByRole("list").first().getByRole("listitem");
    await expect(ranks).toHaveCount(3);
    await expect(ranks.nth(0)).toContainText("Time only");
    await expect(ranks.nth(0)).toContainText("Minutes shared");
    await expect(ranks.nth(1)).toContainText("Time + draw");
    await expect(ranks.nth(1)).toContainText("Draw is Qloo popularity, 0 to 100");
    await expect(ranks.nth(2)).toContainText("Time + draw + Qloo taste");
    await expect(ranks.nth(2)).toContainText("Taste overlap added: the index used here");

    const [timeOnly, drawn, tasted] = await ranks.evaluateAll((all) => all.map((item) => /#(\d+) of (\d+)/.exec(item.textContent ?? "")?.slice(1).map(Number) ?? []));
    expect(timeOnly[1], "all three rank among the same clashes").toBe(drawn[1]);
    expect(drawn[1]).toBe(tasted[1]);
    await expect(home.whatQloo).toContainText(`Place among the day’s ${tasted[1]} clashes, #1 at the left`);

    // The hero names the same three ranks on its own rank axis: time alone, time and draw, with taste.
    const line = await home.card.getByText(/Time alone ranks this pair #\d+, time and draw \(Qloo popularity\) #\d+, with taste #\d+\./).innerText();
    const [, alone, withDraw, withTaste] = /#(\d+), time and draw \(Qloo popularity\) #(\d+), with taste #(\d+)/.exec(line) ?? [];
    expect(Number(alone)).toBe(timeOnly[0]);
    expect(Number(withDraw)).toBe(drawn[0]);
    expect(Number(withTaste)).toBe(tasted[0]);
    // And the "decision above" is the card's own clash.
    await expect(home.whatQloo).toContainText("Sprints and Katy J Pearson, the clash in the decision above, ranked three ways.");
  });

  test("says what it does not prove, and closes on the failed test", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.whatQloo).toContainText("Qloo changes which clash rises to the top. It does not prove #1 is the right clash to move.");
    // The other half: a clash taste puts lower, which a programmer may choose to keep. It never says "costs little".
    const lowers = home.whatQloo.getByText(/^Taste also lowers some clashes: .+ × .+ ranks #\d+ on time and draw but #\d+ with taste\. Lower priority by this index; a candidate to keep\.$/);
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
    // The card's pair, with its two places (no saved-day figure is written into this test).
    await expect(rankings).toContainText(/Sprints and Katy J Pearson · \d+(st|nd|rd|th) of \d+ with taste overlap, \d+(st|nd|rd|th) of \d+ on draw and time alone/);
  });

  test("the second day says when taste does not change the pair's place", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.riot.id);

    await expect(home.whatQloo).toContainText(/Taste agrees with time and draw: #\d+ either way\./);
    // Here taste names a clash it lowers instead: one the time-and-draw ranking puts high and taste puts low.
    const lowers = home.whatQloo.getByText(/^Taste also lowers some clashes: Pierce the Veil × Elvis Costello & The Imposters ranks #\d+ on time and draw but #\d+ with taste\./);
    await expect(lowers).toBeVisible();
    const [, onDraw, withTaste] = /ranks #(\d+) on time and draw but #(\d+) with taste/.exec(await lowers.innerText()) ?? [];
    expect(Number(withTaste), "taste ranks it lower").toBeGreaterThan(Number(onDraw));
    await expect(lowers).toContainText("Lower priority by this index; a candidate to keep.");
    await expect(home.whatQloo).not.toContainText(/In this day’s two rankings, taste moves/);
    await expect(home.whatQloo).toContainText("Same timetable, ranked three ways. This shows what taste changes; it does not prove the taste ranking is better.");
  });
});

test.describe("who has complained, and what nobody has tested", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("states the problem with its public figures, and cites public voices with links", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const section = home.whyThisMatters;
    // The finding is the column's own heading.
    await expect(section.getByRole("heading", { level: 3, name: "45 clashes that fans or the press complained about at 5 festivals had a verified overlap in time." })).toBeVisible();
    await expect(section.getByRole("img", { name: /^Overlap range and median across 86 verified pairs\. Range 10 to 90 minutes; median 50 minutes/ })).toBeVisible();

    await expect(section.getByRole("heading", { level: 3, name: "What programmers have said in public" })).toBeVisible();
    // One statement in the open, the other three in one fold; each is our paraphrase and says so, with its sources.
    const open = section.getByRole("list").filter({ has: page.getByRole("link", { name: "BBC, 2017" }) }).getByRole("listitem");
    await expect(open).toHaveCount(1);
    await expect(open).toBeVisible();
    const more = disclosure(section, /^Three more statements, and what they show$/);
    await expect(more).toHaveJSProperty("open", false);
    await more.locator("summary").click();
    const rest = more.getByRole("listitem");
    await expect(rest).toHaveCount(3);
    const voices = open.or(rest);
    await expect(voices).toHaveCount(4);
    for (const voice of await voices.all()) {
      await expect(voice).toContainText("(our summary)");
      const links = voice.getByRole("link");
      expect(await links.count(), "every quoted voice has a source link").toBeGreaterThan(0);
      for (const link of await links.all()) {
        await expect(link).toHaveAttribute("href", /^https:\/\//);
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", /noopener/);
      }
    }
  });

  test("is plain about what is not known: no tested demand, no scheduler found, one answer is not a market", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const section = home.whyThisMatters;
    await expect(section.getByRole("heading", { level: 3, name: "No scheduler we found reads audience overlap" })).toBeVisible();
    await expect(section).toContainText("Our search, October 2026: absence of evidence only. Who would pay is not known.");

    const sources = disclosure(section, /^Three more statements, and what they show$/);
    await sources.locator("summary").click();
    await expect(sources).toContainText("Danny Bell, Goldenvoice");
    await expect(sources).toContainText("Whether programmers would use or pay for this has not been tested.");
    const schedulers = disclosure(section, /^Festival Pro and Lineup Ninja/);
    await schedulers.locator("summary").click();
    await expect(schedulers).toContainText("We found none that reads audience overlap (our search, October 2026).");
    // The pilot's success line says one answer is not a market, in the open. The pilot offers nothing that costs a
    // Qloo request, so the request arithmetic is not on the page (round 33 R1.9: it is on the Devpost page).
    await expect(section).toContainText("Success: you say which suggestion you would take or turn down, and why. One answer is not a market.");
    await expect(section.locator("summary", { hasText: /Qloo requests/ })).toHaveCount(0);
    await expect(section).not.toContainText("Pricing a new bill is not offered");
    const complaints = disclosure(section, /^86 pairs, median 50 minutes, and how the lists lean$/);
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
    await expect(section).toContainText("Contact is on the Devpost page.");
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
