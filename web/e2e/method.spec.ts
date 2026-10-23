import { HONESTY, visibleTexts } from "./helpers";
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
    // The lede is one sentence; the line that only described the page is cut.
    await expect(article.getByText("Clash Control scores set-time clashes with a number it derives from Qloo data.", { exact: true })).toBeVisible();
    await expect(article).not.toContainText("This page says what that number is");

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
    // The exploratory follow-ups' finding for the pair score is stated where they are reported, in the test's section (round 37, R3: "full price" became "pair score").
    const tested = article.getByRole("region", { name: "What we tested it against" });
    await expect(tested).toContainText("The exploratory follow-up did not establish an advantage over popularity.");
    await expect(tested).toContainText("so the pair score did not establish an advantage over popularity.");

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

  test("the follow-up on taste inside the pair score is open, says it is exploratory, and says what it did not establish", async ({ page }) => {
    const followUp = page.getByRole("region", { name: "What we tested it against" }).getByRole("group", { name: "Taste inside the pair score (exploratory)" });
    const heading = followUp.getByRole("heading", { level: 3, name: "Taste inside the pair score (exploratory)" });
    await expect(heading).toBeVisible();
    await expect(followUp).toContainText("Run after the failed test above, on the same 68 complained-about pairs, so it is exploratory.");
    await expect(followUp).not.toContainText("scored pairs");
    await expect(followUp).toContainText("so the pair score did not establish an advantage over popularity.");
    await expect(followUp).toContainText("This check did not establish that taste adds to time and draw.");
    await expect(followUp).toContainText("So the pair score depends on the real taste values, which is not the same as taste adding to time and draw.");
    await expect(followUp).not.toContainText(/beats|better than popularity/);
    // One row per festival group, with the small one left uninterpreted.
    const table = followUp.getByRole("table");
    await expect(table).toHaveCount(1);
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText(["Festivals", "Popularity", "Time and draw", "Pair score"]);
    await expect(table.getByRole("row").filter({ hasText: "Glastonbury 2025" })).toHaveCount(1);
    await expect(table.getByRole("row").filter({ hasText: "Four US festivals" })).toHaveCount(1);
    await expect(table.getByRole("row").filter({ hasText: "Riot Fest 2026, one of the four" })).toContainText("Not interpreted: too few complaints to read alone");
    // It is on the page with no click: not inside a closed disclosure.
    expect(await heading.evaluate((element) => element.closest("details:not([open])") === null)).toBe(true);
  });

  test("the home page quotes the same failed test", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // The section under the hero, named by what taste does to the hero's pair.
    const home = page.locator("#what-qloo-changes");
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
      await expect(endpoint).toContainText(/Sent live (only )?by /);
      await expect(endpoint).not.toContainText("Sent live:");
    }
    await expect(endpoints.nth(0)).toContainText("The act's name.");
    await expect(endpoints.nth(1)).toContainText("filter.results.entities");
    await expect(endpoints.nth(2)).toContainText("a.signal.interests.entities");
    await expect(rest).toContainText("Each was saved when the day was built; each card says where it is also sent live.");
    // Live use is a short, named list, each limited per visitor.
    await expect(rest).toContainText("Live calls come only from the re-check route, the pasted-grid route in live mode and the agent route, each limited per visitor");
    // The path from a timetable to the index (round 37, L59): seven steps, and inside the engine's step one branch.
    const chain = rest.getByRole("list", { name: "From your timetable to the index" });
    await expect(chain.locator(":scope > li")).toHaveCount(7);
    await expect(chain.getByRole("listitem")).toHaveCount(8);
  });

  test("draws the chain from request to decision in order, with the agent as a branch off the engine, never a step of its own (round 37, L59)", async ({ page }) => {
    const rest = page.getByRole("region", { name: "How the rest works" });
    const chain = rest.getByRole("list", { name: "From your timetable to the index" });
    const steps = chain.locator(":scope > li");
    await expect(steps.locator(":scope > [data-flow-token]")).toHaveText([
      "act names",
      "entity IDs",
      "each act’s ranked row of the bill",
      "percentile ranks and taste overlap",
      "pair score and Clash Budget Index",
      "legal moves under the day’s rules",
      "Keep this move",
    ]);
    // Who makes each step, with Qloo's endpoint where it has one.
    await expect(steps.nth(0)).toContainText("Your timetable");
    await expect(steps.nth(1)).toContainText("Qloo /search");
    await expect(steps.nth(2)).toContainText("Qloo /v2/insights");
    await expect(steps.nth(3)).toContainText("This app");
    await expect(steps.nth(4)).toContainText("This app");
    await expect(steps.nth(5)).toContainText("The engine");
    await expect(steps.nth(6)).toContainText("You");
    await expect(steps.nth(6)).toContainText("Nothing moves until the acts’ teams agree.");
    // The agent: one nested item inside the engine's step, on request, with its one compare; no top-level step names it.
    const branch = steps.nth(5).locator("[data-flow-branch] > li");
    await expect(branch).toHaveCount(1);
    await expect(branch).toHaveText("On request: the agent explains a clash with one /v2/analysis/compare and tests moves through the same engine.");
    await expect(chain.locator("[data-flow-branch]")).toHaveCount(1);
    for (const i of [0, 1, 2, 3, 4, 6]) await expect(steps.nth(i)).not.toContainText("agent");
    // Drawn above the Keep: the branch ends before the Keep's step starts.
    const [branchBox, keepBox] = [await branch.boundingBox(), await steps.nth(6).boundingBox()];
    expect((branchBox?.y ?? 0) + (branchBox?.height ?? 0), "the branch ends above the Keep").toBeLessThanOrEqual(keepBox?.y ?? 0);
  });

  test("states the tag cap and how many saved pairs fill it, and names the six acts with no Qloo signal, with no click (round 37, L60 and L38)", async ({ page }) => {
    const calls = page.locator("#qloo-calls");
    const cap = calls.getByText(
      "This app keeps at most 8 shared genre, subgenre or theme tags per compared pair, and 17 of the 22 saved pairs fill all 8, so the number of tags is not a measure of overlap; read them as examples.",
      { exact: true },
    );
    await expect(cap).toBeVisible();
    expect(await cap.evaluate((element) => element.closest("details:not([open])") === null), "open, with no click").toBe(true);

    const limits = page.locator("#limits");
    const noSignal = limits.locator("li").filter({ hasText: /^Qloo has no usable signal for six acts/ });
    await expect(noSignal).toHaveCount(1);
    await expect(noSignal).toHaveText(
      "Qloo has no usable signal for six acts on the two published days: Thandii, Abel Selaocoe & the Bantu Ensemble and Westside Cowboy at Glastonbury, and Largemouth, William Shatner and Rose of Demise at Riot Fest. Their overlaps, such as Abel Selaocoe & the Bantu Ensemble × Gurriers (60 min) and The Format × William Shatner (35 min), are left out, not scored as zero, and drawn with no line.",
    );
    await expect(noSignal).toBeVisible();
    // No claim that these acts open their stages: two of them do not.
    await expect(limits).not.toContainText(/\bopen(er|ers|ing)?\b/i);
  });

  test("at the top of the page 46.8% is said once: in the failed test's sentence, with the chart's bar and no value label (round 37, L58, fix pass 2)", async ({ page, isPhone }) => {
    const fold = isPhone ? 844 : 900;
    const leaves = await page.evaluate((foot) => {
      const found: { tag: string; top: number }[] = [];
      for (const element of document.querySelectorAll("body *")) {
        if (element.children.length > 0 || element.textContent?.trim() !== "46.8%") continue;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (box.width <= 1 || box.height <= 1 || style.display === "none" || style.visibility === "hidden") continue;
        if (box.top + window.scrollY < foot)
          found.push({
            tag: `${element.tagName.toLowerCase()}${element.hasAttribute("data-bar-value") ? "[data-bar-value]" : ""}${element.hasAttribute("data-failed-figure") ? "[data-failed-figure]" : ""}`,
            top: box.top + window.scrollY,
          });
      }
      return found;
    }, fold);
    test.info().annotations.push({ type: `46.8% above ${fold} px`, description: JSON.stringify(leaves) });
    // One figure on the first screen, on both sizes: the sentence's (the chart's own label beside the taste bar is hidden).
    expect(leaves.map((leaf) => leaf.tag), `46.8% as a leaf above ${fold} px`).toEqual(["span[data-failed-figure]"]);
    // The chart keeps the taste bar and its accessible name; only the value label right after it is hidden.
    await expect(page.getByRole("img", { name: "Taste overlap reached 46.8%; the bar was 60%" })).toBeVisible();
    await expect(page.locator('[role="img"][aria-label^="Taste"] + [data-bar-value]')).toBeHidden();
    // The other three bars keep their value labels.
    const shownValues = page.locator('figure [data-bar-value]:not([role="img"][aria-label^="Taste"] + [data-bar-value])');
    await expect(shownValues).toHaveText(["57.8%", "39.0%", "26.3%"]);
    for (const value of await shownValues.all()) await expect(value).toBeVisible();
    // The failed test's sentence still carries the figure beside its bar (CHARTER 2.1).
    await expect(page.getByRole("region", { name: "The short version" })).toContainText("Taste overlap put 46.8% of complained-about clashes");
  });

  test("says what each live path really sends: no card names the agent's general tools, /search has no \"only\", and the page says the explore tools are refused", async ({ page }) => {
    // Round 36: the clash agent asks Qloo only through compare, when it explains a clash; its general explore tools are
    // never offered by the page and refused by the API unless the deployment switches them on.
    const rest = page.getByRole("region", { name: "How the rest works" });
    const endpoints = rest.getByRole("list", { name: /^The three Qloo endpoints this product calls/ }).getByRole("listitem");
    // Each card's last row; it opens with "Sent live by", so a screen reader hears exactly the visible row (no hidden label).
    const live = async (card: number) => visibleTexts(endpoints.nth(card).locator("p").filter({ hasText: /Sent live (only )?by / }));
    expect(await live(0)).toEqual(["Sent live by the pasted-grid score in live mode, where switched on."]);
    expect(await live(1)).toEqual(["Sent live by the pair re-check (two of its three requests) and the pasted-grid score in live mode, where switched on."]);
    expect(await live(2)).toEqual(["Sent live by the pair re-check (its third request) and by the agent when it explains a clash, where switched on."]);
    for (const card of [0, 1]) await expect(endpoints.nth(card)).not.toContainText(/agent[’']s tools/);
    expect((await live(0)).join(" "), "no \"only\" on the /search card's live row").not.toMatch(/\bonly\b/);
    const calls = page.locator("#qloo-calls");
    await expect(calls).toContainText("The page never offers the agent’s general explore tools, and the API refuses them unless the deployment switches them on.");
    await expect(calls).not.toContainText("can also send other entity types and signals");
    await expect(page.getByRole("article")).not.toContainText(/agent[’']s tools/);
  });

  test("states under its limits, with no click and in the shared words, whose locks they are", async ({ page }) => {
    // Round 36 (lib/locks.ts LOCK_RULE): on both published days the locked sets are exactly the last set on each stage.
    const rule = "On the published days, the locked sets are the last set on each stage. This app keeps them in place; the festivals did not mark them.";
    const items = page.locator("#limits li");
    await expect(items.filter({ hasText: rule })).toHaveCount(1);
    await expect(items.filter({ hasText: rule })).toHaveText(rule);
    await expect(items.filter({ hasText: rule })).toBeVisible();
    // Second to last, just before what the readings must never be used for.
    const all = await items.allInnerTexts();
    expect(all.at(-2), "the lock rule is the second-to-last limit").toBe(rule);
    expect(all.at(-1)).toBe("Do not use this to set fees, billing order or an artist’s worth, or for crowd capacity, safety or attendance.");
    await expect(page.getByRole("article")).not.toContainText("not by the festival");
    expect(await page.getByRole("article").innerText().then((text) => text.split(rule).length - 1), "stated once on the page").toBe(1);
  });

  test("the follow-up's finding against popularity is on the page with no click, and every address on the page lands on a block", async ({ page }) => {
    const tested = page.getByRole("region", { name: "What we tested it against" });
    const finding = tested.getByText("The exploratory follow-up did not establish an advantage over popularity.");
    await expect(finding).toBeVisible();
    expect(await finding.evaluate((element) => element.closest("details:not([open])") === null), "open, with no click").toBe(true);
    const withScore = tested.getByText(/so the pair score did not establish an advantage over popularity\./);
    await expect(withScore).toBeVisible();
    expect(await withScore.evaluate((element) => element.closest("details:not([open])") === null), "open, with no click").toBe(true);

    // The addresses the home page, the brief and the docs link to, and every in-page link, resolve to an element.
    const ids = ["price", "tested", "limits", "labels", "brief", "moving-sets", "live-check", "controls", "why-qloo", "qloo-calls", "taste-in-price"];
    for (const id of ids) await expect(page.locator(`[id="${id}"]`), `#${id}`).toHaveCount(1);
    const unresolved = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].map((link) => link.getAttribute("href") ?? "").filter((href) => href.length > 1 && !document.getElementById(decodeURIComponent(href.slice(1)))),
    );
    expect(unresolved, "in-page links with no target").toEqual([]);
  });

  test("says where each number comes from, in four provenance words", async ({ page }) => {
    const rest = page.getByRole("region", { name: "How the rest works" });
    await expect(rest.getByRole("heading", { level: 3, name: "Where each number comes from" })).toBeVisible();
    await expect(rest.getByRole("term").filter({ hasText: /^Source: / })).toHaveText(["Source: Recorded", "Source: Derived", "Source: Qloo", "Source: LLM"]);
    await expect(rest.getByRole("definition").filter({ hasText: "A saved Qloo response." })).toBeVisible();
    // The model's words are named as a model's, and as not Qloo data, the same words as the chip they explain.
    await expect(rest.getByRole("definition").filter({ hasText: "Written by a language model. Not Qloo data." })).toBeVisible();
    await expect(rest.getByRole("definition").filter({ hasText: "Written by the language model." })).toHaveCount(0);
    await expect(rest).toContainText("The festival days shown were built from saved Qloo responses; the festivals themselves do not use Clash Control.");
  });

  test("says why Qloo, not a similar-artists list or ticket data, and what the four control acts show and do not show, with no click", async ({ page }) => {
    const rest = page.getByRole("region", { name: "How the rest works" });

    // Why Qloo: its own block with its own address.
    const why = page.locator("#why-qloo");
    await expect(why.getByRole("heading", { level: 3 })).toHaveText("Why Qloo, not a similar-artists list or ticket data");
    await expect(why.getByRole("heading", { level: 3 })).toHaveAttribute("id", "why-qloo-heading");
    await expect(why.locator("p")).toHaveText(
      "A similar-artists list names an act’s nearest neighbours. This app needs a reading for every clashing pair on a bill, so it asks Qloo to rank all of a day’s acts against each act’s audience (filter.results.entities). That works before tickets go on sale and for acts with no ticket history at the festival; acts Qloo has no signal for are left out, not scored as zero. It reads taste, not attendance, and this app estimates no attendance.",
    );
    await expect(rest.locator("#why-qloo")).toHaveCount(1);

    // The control acts: named, with the threshold, the result on both saved days, and what the result does not test.
    const controls = page.locator("#controls");
    await expect(controls.getByRole("heading", { level: 3 })).toHaveText("Four control acts");
    await expect(controls.getByRole("heading", { level: 3 })).toHaveAttribute("id", "controls-heading");
    // Round 36: one sentence says how the control acts enter the percentiles (the mechanism, nothing more).
    await expect(controls.locator("p")).toHaveText(
      "Each build also looks up four acts chosen to be unrelated to a festival bill: Vienna Philharmonic, Raffi, Frankie Yankovic and Mormon Tabernacle Choir. If their audiences do not rank near the bottom of the bill (a mean percentile of 0.35 or lower), the build says the signal does not separate audiences on that bill. On both saved days their mean percentile was 0.35 or lower. They are also in each act’s ranked list, so they count in its percentiles. This does not test whether the clash rankings are useful. Their lookups are marked as control acts in How Qloo was used.",
    );
    await expect(controls).toContainText("On both saved days their mean percentile was 0.35 or lower. They are also in each act’s ranked list, so they count in its percentiles. This does not test whether the clash rankings are useful.");
    await expect(controls).not.toContainText(/moves a little|order in a list changes/);

    // Both are on the page with no click (not inside a closed disclosure), and their addresses land on them.
    for (const block of [why, controls]) {
      await expect(block).toBeVisible();
      expect(await block.evaluate((element) => element.closest("details:not([open])") === null), "open, with no click").toBe(true);
    }
    await page.goto("/method#controls", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#controls-heading")).toBeInViewport();
    await page.goto("/method#why-qloo", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#why-qloo-heading")).toBeInViewport();
  });

  test("names the backtest's sample as complained-about pairs, and says the taste reading is global, with no click", async ({ page }) => {
    const tested = page.getByRole("region", { name: "What we tested it against" });
    const sample = tested.getByText(/68 complained-about pairs from 42 complaints \(one complaint can name more than two acts\), across 15 festival days\./);
    await expect(sample).toBeVisible();
    expect(await sample.evaluate((element) => element.closest("details:not([open])") === null), "open, with no click").toBe(true);
    await expect(page.getByRole("article")).not.toContainText("scored pairs from");
    // The limits say the reading is global: no location was sent.
    const limits = page.getByRole("region", { name: "What taste overlap cannot tell you" });
    await expect(limits.getByText("It is a global reading: no location was sent, so it says how close two audiences are in general, not at this festival.")).toBeVisible();
  });

  test("the contents links jump to their sections and mark the current one", async ({ page }) => {
    const contents = page.getByRole("navigation", { name: "On this page" });
    // Labels only: no numerals.
    await expect(contents.getByRole("link")).toHaveText(["What the score is", "What we tested it against", "What taste overlap cannot tell you", "What people ask about clashes", "How long this takes", "How the rest works"]);
    for (const [label, id] of [["What we tested it against", "tested"], ["What taste overlap cannot tell you", "limits"], ["What people ask about clashes", "asked"], ["How long this takes", "how-long"], ["How the rest works", "the-rest"], ["What the score is", "price"]] as const) {
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
    // The complaint figures with their median: home states the 45 clashes, and the median of 50 minutes is said here.
    const sources = page.getByRole("group").filter({ has: page.locator("summary", { hasText: /^Sources for the 45 clashes/ }) });
    await expect(sources).toContainText(/45 clashes that fans or the press complained about at five festivals had a verified overlap in time: 86 pairs of acts, overlapping for a median of 50 minutes \(from 10 to 90\)\./);
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

  test("what people ask about clashes: counts pages, not people, with the three claims, the questions as closed disclosures and the sources behind one click (round 38)", async ({ page }) => {
    const asked = page.locator("#asked");
    await expect(asked.getByRole("heading", { level: 2, name: "What people ask about clashes" })).toBeVisible();
    const intro = asked.locator("[data-evidence-intro]");
    await expect(intro).toBeVisible();
    await expect(intro).toContainText("Nobody was asked anything.");
    await expect(intro).toContainText("It counts pages, not people");
    const claims = asked.locator("[data-evidence-claims] > li");
    await expect(claims).toHaveCount(3);
    await expect(asked.locator("[data-evidence-claims]")).toBeVisible();
    // Round 39 (W8): claim 1 counts pairs once per festival and year, never as distinct pairs; claim 2 counts accounts
    // of programming practice, says one is second-hand, and says what none of them describes.
    await expect(claims.nth(0)).toContainText("pairs of acts when counted separately for each festival and year");
    await expect(claims.nth(0)).not.toContainText("distinct pairs");
    await expect(claims.nth(1)).toHaveText(
      "In 21 public accounts of programming practice that we read, including one second-hand account, 10 describe attempts to avoid or limit clashes or give attendees time to move between stages. None describes ranking pairs of acts by audience closeness before times are published.",
    );
    // The questions: twelve closed disclosures, each opening to what the pages show, how it helps, where it does not.
    const questions = asked.locator("[data-evidence-questions] details");
    await expect(questions).toHaveCount(12);
    for (let i = 0; i < 12; i++) await expect(questions.nth(i)).toHaveJSProperty("open", false);
    const first = questions.first();
    await first.locator("summary").click();
    await expect(first).toHaveJSProperty("open", true);
    await expect(first).toContainText("What the pages show.");
    await expect(first).toContainText("How Clash Control helps.");
    await expect(first).toContainText("Where it does not.");
    await expect(first.getByRole("link")).toHaveCount(3);
    await expect(asked.locator("[data-evidence-method]")).toBeVisible();
    await expect(asked.locator("[data-evidence-limits]")).toBeVisible();
    const sources = asked.getByRole("group").filter({ has: page.locator("summary", { hasText: /^Sources for this analysis/ }) });
    await expect(sources).toHaveJSProperty("open", false);
    await sources.locator("summary").click();
    await expect(sources.getByRole("link")).toHaveCount(113);
    // The accounts are counted in one unit, the group's title the claim's own (round 39, W8).
    await expect(sources).toContainText("Accounts of programming practice (21)");
    await expect(sources.getByRole("link").first()).toHaveAttribute("target", "_blank");
    await expect(asked).not.toContainText(/survey|poll|people we asked|respondents/i);
  });

  test("how long this takes: the by-hand route is estimated, not measured; Clash Control's steps are machine time measured on production; never a survey or a time saved (round 38)", async ({ page }) => {
    const timing = page.locator("#how-long");
    await expect(timing.getByRole("heading", { level: 2, name: "How long this takes" })).toBeVisible();
    const manual = timing.locator("[data-timing-manual]");
    await expect(manual).toBeVisible();
    await expect(manual).toHaveText(/^Estimated, not measured: /);
    await expect(manual).toContainText("Nobody was timed.");
    const steps = timing.locator("[data-timing-steps] > li");
    await expect(steps).toHaveCount(5);
    for (let i = 0; i < 5; i++) await expect(steps.nth(i)).toContainText("(estimated)");
    // Clash Control's figures: machine time measured on production by the demo's timing script, in seconds.
    const machine = timing.locator("[data-timing-machine] > li");
    await expect(machine).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(machine.nth(i)).toContainText("Machine time on production");
      await expect(machine.nth(i)).toHaveText(/: \d\.\d s\.$/);
    }
    // The steps the timing script measured, by the names a visitor sees (round 39, W8: the print step opens the
    // printable brief; nothing is printed).
    for (const [i, step] of ["Load the day", "Open the costliest clash", "Show the tested move", "Keep this move", "Open the printable brief"].entries()) {
      await expect(machine.nth(i)).toHaveText(new RegExp(`^${step}\\. Machine time on production: \\d\\.\\d s\\.$`));
    }
    await expect(timing).not.toContainText("Print the brief");
    await expect(timing).toContainText("the median of 10 warm runs");
    await expect(timing).not.toContainText("measured on production during the final demo recording");
    await expect(timing.locator("[data-timing-note]")).toContainText("never set against the estimate");
    await expect(timing).not.toContainText(/survey|poll|people we asked|respondents|time saved|minutes saved|times faster/i);
  });
});
