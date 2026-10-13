import { expect, test } from "./fixtures";
import { requireSavedDays } from "./helpers";
import { CheckPage } from "./pages/check-page";

/**
 * "Compare audience overlap" on /check. Pressed with its default, it sends only act names and pairs to this
 * site's own server, which answers from a saved festival day (or the invented example day) with no Qloo
 * request. Only an explicit "Ask Qloo" would go live, and the live path is off here.
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
    await expect(rows.first()).toContainText("Glass Mirror × Marble Machine: 80 min shared. Audience overlap 0.34, ranked 2 of 5.");
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
    const highest = check.priceSection.getByRole("button", { name: "Highest audience overlap first" });
    await expect(longest).toHaveAttribute("aria-pressed", "true");
    const byMinutes = await rows.allInnerTexts();

    await highest.click();
    await expect(highest).toHaveAttribute("aria-pressed", "true");
    await expect(rows.first()).toContainText("ranked 1 of 5");
    const ranks = (await rows.allInnerTexts()).map((text) => Number(/ranked (\d) of 5/.exec(text)?.[1]));
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
    expect(await rows.allInnerTexts()).not.toEqual(byMinutes);
    await expect(check.priceSection).toContainText("Audience overlap changes the order of the 5 compared overlaps: Glass Mirror × Hollow Meadow moves from 3rd to 1st.");
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

    const rows = check.priceSection.getByRole("listitem");
    await expect(rows.filter({ hasText: /Audience overlap \d\.\d\d, ranked \d of 4\./ })).toHaveCount(4);
    // Katy J Pearson × Sprints is the day's costliest clash: first by audience overlap.
    await expect(rows.filter({ hasText: "Katy J Pearson × Sprints" })).toContainText("ranked 1 of 4");
    await expect(rows.filter({ hasText: "Nadine Shah × Geordie Greep" })).toContainText("Not compared: not ranked on the saved day. Shown by minutes only.");
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

  test("offers to ask Qloo, says what that sends and costs, and sends nothing until it is pressed", async ({ page, guard }) => {
    const sent = recordPriceBodies(page);
    const check = new CheckPage(page);
    await check.goto();
    await check.clearButton.click();
    await check.paste(UNKNOWN_GRID);
    await check.checkButton.click();
    await check.priceButton.click();

    await expect(check.priceSection).toContainText("These acts are not on a saved day. We can ask Qloo now.");
    await expect(check.priceSection).toContainText("This sends 5 names to Qloo and uses about 10 of its requests; live pricing is capped per day on this server.");
    await expect(check.priceSection.getByRole("button", { name: "Ask Qloo for these 5 acts" })).toBeVisible();
    // Only the saved attempt went out, and it was refused (422); the browser reports that as a console error.
    expect(sent.map((body) => body.mode)).toEqual(["saved"]);
    expect(guard.spending).toEqual([]);
    expect(guard.consoleErrors).toHaveLength(1);
  });
});

test.describe("compare audience overlap, live path refused", () => {
  // The saved attempt (422) and the refused live one (503) are reported by the browser as console errors.
  test.use({ ignoreConsole: [/status of (422|503)/] });

  test("pressing Ask Qloo on a server with live pricing switched off says so, and nothing is spent", async ({ page, guard }) => {
    const health = await (await page.request.get("/api/health")).json();
    test.skip(health.price_grid_live !== false, "This server has live pricing on; this spec only asserts the switched-off refusal.");

    // The one request this suite lets through to a live mode: the server refuses it first thing, before
    // any Qloo call or limiter (backend: price_grid checks the switch before anything else), because the
    // health check just above said it is off. It is stopped here if the switch is found on.
    const live: Body[] = [];
    await page.route("**/api/price-grid", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as Body;
      if (body.mode !== "live") return route.fallback();
      const again = await (await page.request.get("/api/health")).json();
      if (again.price_grid_live !== false) return route.abort("blockedbyclient");
      live.push(body);
      return route.continue();
    });

    const check = new CheckPage(page);
    await check.goto();
    await check.clearButton.click();
    await check.paste(UNKNOWN_GRID);
    await check.checkButton.click();
    await check.priceButton.click();
    await check.priceSection.getByRole("button", { name: "Ask Qloo for these 5 acts" }).click();

    await expect(check.priceSection.getByText("Live pricing is switched off on this server. A saved day still prices.")).toBeVisible();
    await expect(check.priceSection).toContainText("Everything above stays as it is: the checks, your decisions");
    await expect(check.review).toContainText("refused");
    expect(live).toHaveLength(1);
    expect(live[0].acts).toHaveLength(5);
    expect(guard.spending).toEqual([]);
    expect(guard.consoleErrors).toHaveLength(2);
  });
});
