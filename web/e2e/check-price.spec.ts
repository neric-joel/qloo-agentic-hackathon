import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures";
import { DAYS, listDays, requireSavedDays } from "./helpers";
import { CheckPage } from "./pages/check-page";

/**
 * "Compare audience overlap" on /check. Pressed with its default, it sends only act names and pairs to this
 * site's own server, which answers from a saved festival day (or the invented example day) with no Qloo
 * request. The page offers "Ask Qloo" only while `/api/health` says live grid pricing is on; it is off here,
 * so no spec presses it, and the suite's guard blocks any request in a mode other than "saved".
 */

/** A real Glastonbury Sunday grid: its act names are on the saved day, so the server can price it from it. */
const GLASTONBURY_GRID = [
  "The Brian Jonestown Massacre,West Holts,18:30,19:30",
  "St. Vincent,Woodsies,18:30,19:30",
  "Nadine Shah,Other,12:30,13:15",
  "Gurriers,Woodsies,12:30,13:30",
  "Geordie Greep,The Park,12:45,13:30",
  "Katy J Pearson,The Park,14:00,14:45",
  "Sprints,Woodsies,14:00,15:00",
  "Jorja Smith,Woodsies,21:30,22:45",
].join("\n");

/** Names no saved day has. */
const UNKNOWN_GRID = [
  "Zorp Quartet,Alpha,10:00,11:00",
  "Blurf Union,Beta,10:30,11:30",
  "Mrs Wibble,Alpha,12:00,13:00",
  "The Gronks,Beta,12:15,13:15",
  "Plinth,Gamma,12:30,13:30",
].join("\n");

type Body = { acts: string[]; pairs: string[][]; mode: string };

/** Records the bodies the page sends to /api/price-grid. The guard blocks anything that is not saved mode. */
function recordPriceBodies(page: import("@playwright/test").Page): Body[] {
  const sent: Body[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/price-grid")) sent.push(JSON.parse(request.postData() ?? "{}") as Body);
  });
  return sent;
}

/** The compared overlaps, one row each (the overlaps not compared wait in a fold of their own). */
function compared(check: CheckPage) {
  return check.priceSection.getByRole("list", { name: "Compared overlaps" }).getByRole("listitem");
}

/** The closed fold that names each overlap not compared and why. */
function notComparedFold(check: CheckPage) {
  return check.priceSection.locator("details").filter({ has: check.page.locator("summary", { hasText: /^Why (this was|these were) not compared \(\d+\)$/ }) });
}

test.describe("compare audience overlap, from a saved day", () => {
  test("the invented sample is answered from the invented example day, with no Qloo request", async ({ page }) => {
    const sent = recordPriceBodies(page);
    const check = new CheckPage(page);
    await check.goto();

    await expect(check.priceSection).toContainText("The checks above ran in your browser and used no Qloo data.");
    await expect(check.priceSection).toContainText("we send the 24 act names and the pairs to this site’s server to look for saved audience data.");
    await expect(check.priceSection).toContainText("No times, stages or rules are sent; names are not stored or logged.");
    expect(sent, "nothing is priced until the button is pressed").toEqual([]);

    await check.priceButton.click();

    // What leaves the browser: names and pairs, in saved mode, and nothing else.
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].mode).toBe("saved");
    expect(Object.keys(sent[0]).sort()).toEqual(["acts", "mode", "pairs"]);
    expect(sent[0].acts).toHaveLength(24);
    expect(sent[0].pairs).toHaveLength(5);
    expect(JSON.stringify(sent[0])).not.toMatch(/\d{2}:\d{2}/); // no times
    expect(JSON.stringify(sent[0])).not.toMatch(/Stage|Tent/); // no stages

    await expect(check.priceSection).toContainText(
      "Compared using the invented example day: its acts and affinities are invented, not Qloo data. No Qloo request was sent.",
    );
    await expect(check.priceSection).toContainText("24 acts sent: 24 matched, 23 with a usable signal; 1 matched with no signal.");
    const rows = check.priceSection.getByRole("listitem");
    await expect(rows).toHaveCount(5);
    // One name and one scale for the value: "taste overlap NN / 100" (the invented day's own figures).
    await expect(rows.first()).toContainText("Glass Mirror × Marble Machine: 80 min shared. Taste overlap 34 / 100, ranked 2 of 5.");
    for (const row of await rows.all()) await expect(row).toContainText(/Taste overlap \d{1,3} \/ 100, ranked \d of 5\./);
    // A rank, not attendance, and no index here.
    await expect(check.priceSection).toContainText("not Qloo data and not attendance");
    await expect(check.priceSection).toContainText("The Clash Budget Index needs a full priced day and is not computed here.");
  });

  test("the answer can be ordered by minutes or by audience overlap, and says what the order changed", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.priceButton.click();

    const rows = check.priceSection.getByRole("listitem");
    const longest = check.priceSection.getByRole("button", { name: "Longest first" });
    const highest = check.priceSection.getByRole("button", { name: "Highest taste overlap first" });
    await expect(longest).toHaveAttribute("aria-pressed", "true");
    const byMinutes = await rows.allInnerTexts();

    await highest.click();
    await expect(highest).toHaveAttribute("aria-pressed", "true");
    await expect(rows.first()).toContainText("ranked 1 of 5");
    const ranks = (await rows.allInnerTexts()).map((text) => Number(/ranked (\d) of 5/.exec(text)?.[1]));
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
    expect(await rows.allInnerTexts()).not.toEqual(byMinutes);
    await expect(check.priceSection).toContainText("Taste overlap changes the order of the 5 compared overlaps: Glass Mirror × Hollow Meadow moves from 3rd to 1st.");
  });

  test("a grid of real Glastonbury acts is answered from the saved festival day, and an unranked pair is listed by minutes only", async ({ page }) => {
    await requireSavedDays(page);
    const sent = recordPriceBodies(page);
    const check = new CheckPage(page);
    await check.goto();
    await check.clearButton.click();
    await check.paste(GLASTONBURY_GRID);
    await check.checkButton.click();
    await expect(check.sharedSection.getByRole("heading", { level: 2 })).toHaveText("Sets that share time (5 pairs)");

    await check.priceButton.click();
    await expect(check.priceSection).toContainText("Compared using a saved festival day. No Qloo request was sent.");
    expect(sent.map((body) => body.mode)).toEqual(["saved"]);
    await expect(check.priceSection).toContainText("8 acts sent: 8 matched, 8 with a usable signal.");

    // Counts and wording only: no taste value or rank from the saved day is written into this test.
    const rows = compared(check);
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: /Taste overlap \d{1,3} \/ 100, ranked \d of 4\./ })).toHaveCount(4);
    // The overlap without a reading is counted in one line, and says why in words inside a closed fold.
    await expect(check.priceSection).toContainText("1 overlap not compared: no reading served for the pair (1).");
    const fold = notComparedFold(check);
    await expect(fold.locator("summary")).toHaveText("Why this was not compared (1)");
    await expect(fold).toHaveJSProperty("open", false);
    await fold.locator("summary").click();
    await expect(fold.getByRole("listitem")).toHaveCount(1);
    await expect(fold.getByRole("listitem").filter({ hasText: "Nadine Shah × Geordie Greep" })).toContainText(/Not compared: \S.+\./);
    await expect(check.priceSection).toContainText("each is a rank among the acts on that day’s lineup of 36 acts, not among the acts you pasted, and not attendance.");
  });

  test("the answer is marked stale when the grid is edited after it", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.priceButton.click();
    await expect(check.priceSection).toContainText("No Qloo request was sent.");

    await check.csvView.click();
    await check.grid.fill((await check.grid.inputValue()) + "Extra Act,Main Stage,12:00,12:30\n");
    // The results above are for the grid as last checked, and the page says so.
    await expect(check.page.getByText("You changed the grid or settings; check again to search.")).toBeVisible();
  });
});

test.describe("compare audience overlap, names no saved day has", () => {
  // The saved attempt is refused with a 422, which the browser reports as a console error.
  test.use({ ignoreConsole: [/status of 422/] });

  test("with live pricing off on this server, there is no offer to ask Qloo: it says so, and nothing goes live", async ({ page, guard }) => {
    const health = await (await page.request.get("/api/health")).json();
    test.skip(health.price_grid_live !== false, "This server has live pricing on; this spec asserts the switched-off state.");
    const sent = recordPriceBodies(page);
    const check = new CheckPage(page);
    await check.goto();
    await check.clearButton.click();
    await check.paste(UNKNOWN_GRID);
    await check.checkButton.click();
    // Before the press, the page already says what happens when no saved day matches.
    await expect(check.priceSection).toContainText("If no saved day matches, nothing is compared: live Qloo pricing is off on this server.");
    await check.priceButton.click();

    await expect(check.priceSection).toContainText(
      "These acts are not on a saved day, and live Qloo pricing is off on this server, so they are not compared. Acts on a saved day still compare.",
    );
    await expect(check.page.getByRole("button", { name: /^Ask Qloo/ })).toHaveCount(0);
    await expect(check.page.getByText(/We can ask Qloo now/)).toHaveCount(0);
    // Only the saved attempt went out, and it was refused (422); nothing was sent in a live mode.
    expect(sent.map((body) => body.mode)).toEqual(["saved"]);
    expect(guard.spending).toEqual([]);
    expect(guard.consoleErrors).toHaveLength(1);
  });
});

test.describe("compare audience overlap on a published day", () => {
  test("Check a published day, then Compare: every pair sent is compared or says why not, in saved mode only", async ({ page, guard }) => {
    // Counts only: no taste value or rank from the saved day is written into this test. A clone without the
    // built days serves only the invented one, so there is no published day to check.
    const days = await listDays(page);
    test.skip(!days.some((day) => !day.synthetic), "The API serves no published day.");
    const sent = recordPriceBodies(page);
    const check = new CheckPage(page);
    await check.goto();

    await check.publishedButton.click();
    // The day says what it is and what it does not check (the draft review repeats it).
    await expect(check.page.getByText(/^Published timetable: .+\. Curfew and changeover from that day; its billing rules and stage hours are not checked here\./).first()).toBeVisible();
    await expect(check.rules).toContainText(/0 pair rules/);
    await check.priceButton.click();

    await expect(check.priceSection).toContainText("Compared using a saved festival day. No Qloo request was sent.");
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.every((body) => body.mode === "saved"), "the published day compares in saved mode only").toBe(true);
    const pairsSent = sent[0].pairs.length;

    const rows = compared(check);
    const priced = rows.filter({ hasText: /Taste overlap \d{1,3} \/ 100(, ranked \d+ of \d+|, the only pair compared)\./ });
    await expect(priced.first()).toBeVisible();
    const pricedCount = await priced.count();
    expect(pricedCount, "at least one pair is compared from the saved day").toBeGreaterThanOrEqual(1);
    expect(pricedCount, "every compared row carries its value").toBe(await rows.count());
    // The overlaps not compared are counted in one line and named, with a reason in words, in a closed fold.
    const fold = notComparedFold(check);
    let sentReasoned = 0;
    if ((await fold.count()) > 0) {
      await expect(fold).toHaveJSProperty("open", false);
      await fold.locator("summary").click();
      const items = fold.getByRole("listitem");
      for (const item of await items.all()) await expect(item).toContainText(/Not compared: \S.+\./);
      // A pair with both sets locked is passed over before sending; every other one in the fold was sent.
      sentReasoned = await items.filter({ hasNotText: "both sets are locked" }).count();
    }
    expect(pricedCount + sentReasoned, "every pair sent is compared or says why not").toBe(pairsSent);
    expect(guard.spending).toEqual([]);
  });

  test("on Glastonbury, the saved day's costliest clashes that can move are compared, the card's pair first, and the page says how they were chosen", async ({ page, guard }) => {
    // Counts and act names only. The card's pair (Sprints and Katy J Pearson) is the saved day's costliest clash.
    await requireSavedDays(page);
    const sent = recordPriceBodies(page);
    const check = new CheckPage(page);
    await check.goto();

    await expect(check.publishedButton).toHaveAccessibleName(`Check a published day: ${DAYS.glastonbury.title}`);
    await check.publishedButton.click();
    await expect(check.page.getByText(/^Published timetable: /).first()).toBeVisible();
    await check.priceButton.click();
    await expect(check.priceSection).toContainText("Compared using a saved festival day. No Qloo request was sent.");

    // What left the browser: one saved-mode body of act names and pairs, at least 5 and at most 10 pairs, the card's pair first.
    expect(sent).toHaveLength(1);
    expect(sent[0].mode).toBe("saved");
    expect(Object.keys(sent[0]).sort()).toEqual(["acts", "mode", "pairs"]);
    expect(sent[0].pairs.length).toBeGreaterThanOrEqual(5);
    expect(sent[0].pairs.length).toBeLessThanOrEqual(10);
    expect([...sent[0].pairs[0]].sort()).toEqual(["Katy J Pearson", "Sprints"]);
    expect(sent[0].acts, "every act of the day is sent in saved mode").toHaveLength(new Set(sent[0].acts).size);
    expect(sent[0].acts.length).toBeGreaterThan(25);
    expect(guard.spending, "nothing in a live mode").toEqual([]);

    // At least five pairs come back compared, the card's pair among them.
    const rows = compared(check);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(5);
    await expect(rows.filter({ hasText: /^Sprints × Katy J Pearson: \d+ min shared\. Taste overlap \d{1,3} \/ 100, ranked \d+ of \d+\.$/ })).toHaveCount(1);
    // The order sentence is computed from what came back, and how the pairs were picked is disclosed.
    await expect(check.priceSection.getByText(/^Taste overlap (does not change|changes) the order of the \d+ compared overlaps/)).toBeVisible();
    const disclosure = check.priceSection.getByText(
      "These pairs are the saved day's costliest by this app's index, which already includes taste overlap: a worked example, not a test.",
    );
    await expect(disclosure).toBeVisible();
    // Values first: the compared rows, then the disclosure, then the one line that counts what was not compared, then its fold.
    const countLine = check.priceSection.getByText(/^\d+ overlaps? not compared: .+\.$/);
    await expect(countLine).toBeVisible();
    const fold = notComparedFold(check);
    await expect(fold).toHaveJSProperty("open", false);
    const top = async (locator: Locator) => (await locator.boundingBox())?.y ?? Number.NaN;
    const order = [await top(rows.first()), await top(rows.last()), await top(disclosure), await top(countLine), await top(fold)];
    expect(order, "values, disclosure, count line and fold, top to bottom").toEqual([...order].sort((a, b) => a - b));
  });
});
