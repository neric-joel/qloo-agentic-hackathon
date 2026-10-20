import { HONESTY } from "./helpers";
import { expect, test } from "./fixtures";
import { SiteChrome } from "./pages/site-chrome";

/**
 * /method: what the score is, what it was tested against, and where the test failed. The failed pre-set test is
 * the page's first finding and has to stay on it, with the same figures wherever else they are quoted.
 */

test.describe("how we know (/method)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "How we know" })).toBeVisible();
    await new SiteChrome(page).waitForHydration();
  });

  test("renders its four sections after a short version that leads with the failed test", async ({ page }) => {
    await expect(page).toHaveTitle(/How we know/);
    const article = page.getByRole("article");
    await expect(article).toContainText("This page says what that number is, what we checked it against, and where the check fell short.");

    for (const name of ["The short version", "What the score is", "What we tested it against", "What taste overlap cannot tell you", "How the rest works"]) {
      await expect(article.getByRole("region", { name }).getByRole("heading", { level: 2, name })).toBeVisible();
    }
    // The failed test is the first thing said, before any section title.
    const short = article.getByRole("region", { name: "The short version" });
    await expect(short.getByRole("listitem").first()).toContainText("The test we set before building failed.");
    await expect(short.getByRole("listitem").first()).toContainText("The bar we wrote down before building was 60% and 10 points ahead.");
    await expect(short).toContainText("It ranks a day’s clashes and tests moves against timetable rules. Taste overlap is a rank, not attendance.");
  });

  test("states the failed pre-set test with its figures, and the check on moves that failed as written", async ({ page }) => {
    const article = page.getByRole("article");
    const short = article.getByRole("region", { name: "The short version" });

    await expect(short).toContainText("Taste overlap put 46.8% of complained-about clashes in the 25% highest-ranked clashes among that day’s pairs, 7.8 points ahead of genre tags.");
    // The failed test is stated once, in the short version's first item: the miss, popularity's figure, the moves check.
    const failed = short.getByRole("listitem").first();
    await expect(failed).toContainText("It missed the bar. Popularity did better: another Qloo field, it reached 57.8%.");
    await expect(failed).toContainText(/The check on suggested moves missed its bar too \(\d+(\.\d+)? index points against 10\)\./);
    await expect(failed.getByRole("link", { name: "See the full comparison below" })).toHaveAttribute("href", "#tested");
    // The exploratory follow-ups' finding for the full price is stated where they are reported, in the test's section.
    const tested = article.getByRole("region", { name: "What we tested it against" });
    await expect(tested).toContainText("The exploratory follow-up did not establish an advantage over popularity.");
    await expect(tested).toContainText("so the full price did not establish an advantage over popularity.");

    // The figure draws the same four numbers, with the bar that was set.
    const chart = short.getByRole("figure", { name: "Complained-about clashes in the day’s highest 25%, by method" });
    await expect(chart).toContainText("Bar we set: 60%");
    await expect(chart.getByRole("img", { name: "Taste overlap reached 46.8%; the bar was 60%" })).toBeVisible();
    await expect(chart.getByRole("img", { name: "Popularity reached 57.8%" })).toBeVisible();
    await expect(chart.getByRole("img", { name: "Genre tags reached 39.0%" })).toBeVisible();
    await expect(chart.getByRole("img", { name: "Random reached 26.3%" })).toBeVisible();

    // And the "Moving sets" part says the check failed as written.
    await expect(article.getByRole("heading", { level: 3, name: "Moving sets" })).toBeVisible();
    await expect(article).toContainText("the check failed as written.");
    await expect(article).toContainText("Suggested moves are graded by the same measure used to find them, so a better score is expected, not proof.");
  });

  test("the test's table agrees with the short version, and the honest caveats follow it", async ({ page }) => {
    const tested = page.getByRole("region", { name: "What we tested it against" });
    // The pre-set test's own table (the exploratory follow-up has a table of its own further down).
    const table = tested.getByRole("table").filter({ hasText: "Taste overlap (rank on the bill)" });

    await expect(table).toHaveCount(1);
    await expect(table.getByRole("columnheader")).toHaveText(["Method", "Complained-about clashes in the day’s top quarter", "AUC (95% interval)"]);
    const rows = table.getByRole("row");
    await expect(rows.filter({ hasText: "Taste overlap (rank on the bill)" })).toContainText("46.8%");
    await expect(rows.filter({ hasText: "Taste overlap (rank on the bill)" })).toContainText("0.634 (0.517 to 0.755)");
    await expect(rows.filter({ hasText: "Popularity (the lower of the two acts)" })).toContainText("57.8%");
    await expect(rows.filter({ hasText: "Genre-tag overlap" })).toContainText("39.0%");
    await expect(rows.filter({ hasText: /^Random/ })).toContainText("26.3%");
    await expect(rows.filter({ hasText: /^Random/ })).toContainText("0.500");
    // The section refers to the failed test stated in the short version ("It missed the bar." is pinned there) rather
    // than restating it.
    await expect(tested).toContainText("The failed test above is this table read against the bar we set before running it, for taste overlap alone.");
    await expect(tested).toContainText("So the test does not show that taste overlap predicts the clashes people complain about, and we do not claim it.");
    // Its correlation with popularity is stated here, where the test is reported (the home page links here for it).
    await expect(tested).toContainText(/It is nearly unrelated to popularity \(correlation 0\.\d+\), so it is a separate signal from popularity\./);
    await expect(tested).toContainText("One festival drives much of the favourable result.");
    await expect(tested).toContainText("Intervals resample whole festival days.");
    await expect(tested.getByRole("complementary", { name: "Exploratory follow-up, run after the test failed" })).toBeVisible();
    await expect(tested).toContainText("The exploratory follow-up did not establish an advantage over popularity.");

    const limits = page.getByRole("region", { name: "What taste overlap cannot tell you" });
    await expect(limits).toContainText("It is not attendance, and this app estimates no attendance or money figure anywhere.");
    await expect(limits).toContainText("Hidden clashes are examples, not detections.");
    await expect(limits).toContainText("Real programming weighs much more than taste overlap.");
  });

  test("the follow-up on taste inside the full price is open, says it is exploratory, and says what it did not establish", async ({ page }) => {
    const followUp = page.getByRole("region", { name: "What we tested it against" }).getByRole("group", { name: "Taste inside the full price (exploratory)" });
    const heading = followUp.getByRole("heading", { level: 3, name: "Taste inside the full price (exploratory)" });
    await expect(heading).toBeVisible();
    await expect(followUp).toContainText("Run after the failed test above, on the same 68 scored pairs, so it is exploratory.");
    await expect(followUp).toContainText("so the full price did not establish an advantage over popularity.");
    await expect(followUp).toContainText("This check did not establish that taste adds to time and draw.");
    await expect(followUp).toContainText("So the full price depends on the real taste values, which is not the same as taste adding to time and draw.");
    await expect(followUp).not.toContainText(/beats|better than popularity/);
    // One row per festival group, with the small one left uninterpreted.
    const table = followUp.getByRole("table");
    await expect(table).toHaveCount(1);
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText(["Festivals", "Popularity", "Time and draw", "Full price"]);
    await expect(table.getByRole("row").filter({ hasText: "Glastonbury 2025" })).toHaveCount(1);
    await expect(table.getByRole("row").filter({ hasText: "Four US festivals" })).toHaveCount(1);
    await expect(table.getByRole("row").filter({ hasText: "Riot Fest 2026, one of the four" })).toContainText("Not interpreted: too few complaints to read alone");
    // It is on the page with no click: not inside a closed disclosure.
    expect(await heading.evaluate((element) => element.closest("details:not([open])") === null)).toBe(true);
  });

  test("the home page quotes the same failed test", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const home = page.getByRole("region", { name: /^Same \d+-minute clash/ });
    await expect(home).toContainText("Our test failed: taste overlap put 46.8% of complained-about clashes in the top quarter of their day, below our 60% bar.");
    await expect(home.getByRole("link", { name: "How we know" })).toHaveAttribute("href", "/method#tested");
  });

  test("lists the Qloo endpoints the product calls, with what is sent and where it is sent live", async ({ page }) => {
    const rest = page.getByRole("region", { name: "How the rest works" });
    await expect(rest.getByRole("heading", { level: 3, name: "Qloo requests" })).toBeVisible();

    const endpoints = rest.getByRole("list", { name: /^The three Qloo endpoints this product calls/ }).getByRole("listitem");
    await expect(endpoints).toHaveCount(3);
    await expect(endpoints.nth(0).getByRole("heading", { level: 4 })).toHaveText("/search");
    await expect(endpoints.nth(1).getByRole("heading", { level: 4 })).toHaveText("/v2/insights");
    await expect(endpoints.nth(2).getByRole("heading", { level: 4 })).toHaveText("/v2/analysis/compare");
    for (const endpoint of await endpoints.all()) {
      await expect(endpoint).toContainText("We send");
      await expect(endpoint).toContainText("We get back");
      await expect(endpoint).toContainText("Sent live:");
    }
    await expect(endpoints.nth(0)).toContainText("The act's name.");
    await expect(endpoints.nth(1)).toContainText("filter.results.entities");
    await expect(endpoints.nth(2)).toContainText("a.signal.interests.entities");
    await expect(rest).toContainText("Each was saved when the day was built; each card says where it is also sent live.");
    // Live use is a short, named list, each limited per visitor.
    await expect(rest).toContainText("Live calls come only from the re-check route, the pasted-grid route in live mode and the agent route, each limited per visitor");
    // The path from a timetable to the index.
    await expect(rest.getByRole("list", { name: "From your timetable to the index" }).getByRole("listitem")).toHaveCount(4);
  });

  test("says where each number comes from, in four provenance words", async ({ page }) => {
    const rest = page.getByRole("region", { name: "How the rest works" });
    await expect(rest.getByRole("heading", { level: 3, name: "Where each number comes from" })).toBeVisible();
    await expect(rest.getByRole("term").filter({ hasText: /^Source: / })).toHaveText(["Source: Recorded", "Source: Derived", "Source: Qloo", "Source: LLM"]);
    await expect(rest.getByRole("definition").filter({ hasText: "A saved Qloo response." })).toBeVisible();
    await expect(rest.getByRole("definition").filter({ hasText: "Written by the language model." })).toBeVisible();
    await expect(rest).toContainText("The festival days shown were built from saved Qloo responses; the festivals themselves do not use Clash Control.");
  });

  test("the contents links jump to their sections and mark the current one", async ({ page }) => {
    const contents = page.getByRole("navigation", { name: "On this page" });
    await expect(contents.getByRole("link")).toHaveText(["1What the score is", "2What we tested it against", "3What taste overlap cannot tell you", "4How the rest works"]);
    for (const [label, id] of [["What we tested it against", "tested"], ["What taste overlap cannot tell you", "limits"], ["How the rest works", "the-rest"], ["What the score is", "price"]] as const) {
      const link = contents.getByRole("link", { name: label });
      await link.click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(page.locator(`#${id}`), `${label} in view`).toBeInViewport();
      await expect(link, `${label} is marked current`).toHaveAttribute("aria-current", "location");
    }
  });

  test("a deep link to /method#tested lands on the test, clear of the header", async ({ page }) => {
    await page.goto("/method#tested", { waitUntil: "domcontentloaded" });
    const heading = page.getByRole("heading", { level: 2, name: "What we tested it against" });
    await expect(heading).toBeInViewport();
    const [header, box] = await Promise.all([page.getByRole("banner").boundingBox(), heading.boundingBox()]);
    expect(box?.y, "the heading is below the sticky header").toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0) - 1);
  });

  test("its disclosures open: how the score is calculated, why 68 of 86 pairs, and the sources", async ({ page }) => {
    for (const name of [/^How the score is calculated/, /^Why 68 of 86 verified pairs were scored/, /^Sources for the 45 clashes/]) {
      const group = page.getByRole("group").filter({ has: page.locator("summary", { hasText: name }) });
      await group.locator("summary").click();
      await expect(group, String(name)).toHaveJSProperty("open", true);
    }
    const formula = page.getByRole("group").filter({ has: page.locator("summary", { hasText: /^How the score is calculated/ }) });
    await expect(formula).toContainText("taste overlap");
  });

  test("says what taste overlap is not, and links back to the timetable", async ({ page }) => {
    const article = page.getByRole("article");
    await expect(article).toContainText("Taste overlap is an app-derived rank");
    await expect(article).toContainText("It is not a share of fans and not attendance.");
    await expect(article).toContainText("Real programming weighs much more than taste overlap.");
    await expect(page.getByRole("contentinfo")).toContainText("The festivals shown do not use Clash Control");
    await article.getByRole("link", { name: "Back to the timetable" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Which clash is worth moving?" })).toBeVisible();
    // The home page's honesty lines, for completeness of the journey.
    await expect(page.getByRole("region", { name: "Which clash is worth moving?" })).toContainText(HONESTY.neither);
  });
});
