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
    await expect(ranks.nth(2)).toContainText("Taste overlap added: the price used here");

    const [timeOnly, drawn, tasted] = await ranks.evaluateAll((all) => all.map((item) => /#(\d+) of (\d+)/.exec(item.textContent ?? "")?.slice(1).map(Number) ?? []));
    expect(timeOnly[1], "all three rank among the same clashes").toBe(drawn[1]);
    expect(drawn[1]).toBe(tasted[1]);
    await expect(home.whatQloo).toContainText(`Place among the day’s ${tasted[1]} clashes, #1 at the left`);

    // The hero says where taste moves this pair from and to: the draw rank, then the taste rank.
    const line = await home.card.getByText(/^Taste moves this pair from #\d+ to #\d+\.$/).innerText();
    const [, from, to] = /#(\d+) to #(\d+)/.exec(line) ?? [];
    expect(Number(from)).toBe(drawn[0]);
    expect(Number(to)).toBe(tasted[0]);
    // And the "decision above" is the card's own clash.
    await expect(home.whatQloo).toContainText("Sprints and Katy J Pearson, the clash in the decision above, ranked three ways.");
  });

  test("says what it does not prove, and closes on the failed test", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.whatQloo).toContainText("Qloo changes which clash rises to the top. It does not prove #1 is the right clash to move.");
    await expect(home.whatQloo.getByRole("heading", { level: 3, name: "What the failed test taught us." })).toBeVisible();
    await expect(home.whatQloo).toContainText("Our test failed: taste overlap put 46.8% of complained-about clashes in the top quarter of their day, below our 60% bar.");
    await expect(home.whatQloo).toContainText("So the taste reading is a second opinion beside time and draw, never folded into a verdict.");
    await expect(home.whatQloo.getByRole("link", { name: "How we know" })).toHaveAttribute("href", "/method#tested");
  });

  test("its two disclosures show equal-popularity rivals and the day's two rankings", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const rivals = disclosure(home.whatQloo, /^Equal-popularity pairs/);
    await rivals.locator("summary").click();
    await expect(rivals).toContainText("Draw is Qloo popularity, a percentile among Qloo artists");
    await expect(rivals).toContainText("Level on draw, 68 apart on taste overlap.");

    const rankings = disclosure(home.whatQloo, /^Two rankings of this day/);
    await rankings.locator("summary").click();
    await expect(rankings).toContainText("What taste overlap changes");
    await expect(rankings).toContainText("So this shows that taste overlap reorders the list, not that Qloo’s numbers pick the right clashes.");
    await expect(rankings).toContainText("The check we set before building did not pass (see How we know).");
    await expect(rankings).toContainText("Sprints and Katy J Pearson · 1st of 68 with taste overlap, 18th of 68 on draw and time alone");
  });

  test("the second day says when taste does not change the pair's place", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.riot.id);

    await expect(home.whatQloo).toContainText("Taste does not change this pair’s place.");
    await expect(home.whatQloo).toContainText("Same timetable, ranked three ways. This shows what taste changes; it does not prove the taste ranking is better.");
  });
});

test.describe("who has complained, and what nobody has tested", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("states the problem with its public figures, and cites public voices with links", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const section = home.whyThisMatters;
    await expect(section.getByRole("heading", { level: 3, name: "The problem is public" })).toBeVisible();
    await expect(section).toContainText("45 clashes that fans or the press complained about at 5 festivals had a verified overlap in time.");
    await expect(section.getByRole("img", { name: /^Overlap range and median across 86 verified pairs\. Range 10 to 90 minutes; median 50 minutes/ })).toBeVisible();

    await expect(section.getByRole("heading", { level: 3, name: "What programmers have said in public" })).toBeVisible();
    const voices = section.getByRole("list").filter({ has: page.getByRole("link", { name: "BBC, 2017" }) }).getByRole("listitem");
    await expect(voices).toHaveCount(3);
    for (const voice of await voices.all()) {
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

    const sources = disclosure(section, /^Danny Bell, Goldenvoice/);
    await sources.locator("summary").click();
    await expect(sources).toContainText("Whether programmers would use or pay for this has not been tested.");
    const schedulers = disclosure(section, /^Festival Pro and Lineup Ninja/);
    await schedulers.locator("summary").click();
    await expect(schedulers).toContainText("We found none that reads audience overlap (our search, October 2026).");
    const cost = disclosure(section, /^About 40 Qloo requests per bill/);
    await cost.locator("summary").click();
    await expect(cost).toContainText("Each bill costs about 40 Qloo requests, so ten use about 400 of the 10,000 shared this month. One answer is not a market.");
    const complaints = disclosure(section, /^86 pairs, median 50 minutes/);
    await complaints.locator("summary").click();
    await expect(complaints).toContainText("Popularity scored higher than taste overlap on this test: it put 57.8% of these clashes in the top quarter of their day, taste overlap 46.8%.");
  });

  test("the pilot offer asks for a bill and points to the check page", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const section = home.whyThisMatters;
    await expect(section.getByRole("heading", { level: 3, name: "Pilot offer" })).toBeVisible();
    await expect(section).toContainText("Send one day’s draft or published bill.");
    await expect(section).toContainText("Success: a programmer moves a set, or keeps one on purpose.");
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

    await expect(home.sources).toContainText("Glastonbury Festival 2025 does not use Clash Control.");
    await expect(home.sources).toContainText("This page scores the festival’s published timetable from public sources. Nothing here is the festival’s own data or view.");
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
