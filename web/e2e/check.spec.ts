import fs from "node:fs";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { listDays, luminance, pdfPages, rgbOf } from "./helpers";
import { CheckPage } from "./pages/check-page";

/**
 * /check: a programmer pastes a draft grid and gets its rule breaks and its shared time, in the browser, with
 * nothing sent. The page opens on an invented sample with four planted rule breaks.
 */

const CLEAN_GRID = [
  "Sprints,Woodsies,14:00,15:00",
  "Katy J Pearson,The Park,14:00,14:45",
  "The Brian Jonestown Massacre,West Holts,18:30,19:30",
  "St. Vincent,Woodsies,18:30,19:30",
  "Nadine Shah,Other,12:30,13:15",
  "Gurriers,Woodsies,12:30,13:30",
  "Geordie Greep,The Park,12:45,13:30",
  "Jorja Smith,Woodsies,21:30,22:45",
].join("\n");

/** The review's "n / 4 rule breaks reviewed" line; its numerals and words sit in separate elements. */
const reviewed = (n: number) => new RegExp(String.raw`${n}\s*/\s*4\s*rule breaks reviewed`);

/** Anything the page sends beyond reading its own files and the day list: a request to the API with a body. */
const apiWrites = (requested: string[]) => requested.filter((url) => /\/api\/(price-grid|pair|runs|presets\/[^/]+\/whatif)/.test(url));

test.describe("check a draft grid", () => {
  test("opens on the invented sample, already checked, and says it is invented", async ({ page, guard }) => {
    const check = new CheckPage(page);
    await check.goto();

    await expect(page).toHaveTitle(/Check a draft grid/);
    await expect(check.page.getByText("Paste one day of a draft timetable to find rule breaks and sets that share time. Audience overlap is optional.")).toBeVisible();
    await expect(check.page.getByText("Invented sample: 25 sets with four planted rule breaks.").first()).toBeVisible();
    await expect(check.page.getByText("Invented sample, to show the format")).toBeVisible();
    await expect(check.checked).toContainText("4 rule breaks found");
    await expect(check.announcement).toHaveText("Invented sample loaded. Rule breaks: 4. Sets that share time: 35 pairs.");
    await expect(check.table).toBeVisible();
    await expect(check.page.getByText(/^Read 25 sets on 4 stages; 3 marked locked\./).first()).toBeVisible();
    await expect(check.page.getByRole("group").filter({ hasText: "Rules this check applies" })).toContainText("15 min changeover, curfew 00:00, 1 pair rule");
    // The check ran in the browser: nothing was sent to price anything.
    expect(apiWrites(guard.requested)).toEqual([]);
    await expect(check.page.getByText("Rule checks run in your browser; nothing is sent unless you press Compare audience overlap.")).toBeVisible();
  });

  test("lists the four planted rule breaks, each with its rows and its next step", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await expect(check.rulesSection.getByRole("heading", { level: 2 })).toHaveText("Rule breaks (4)");
    const cards = check.breakCards();
    await expect(cards).toHaveCount(4);

    const expected = [
      ["Rule break 1. Act on two stages at once", "Orchid Bloom is booked on two stages at the same time.", "Night Tent 16:30–17:00 and Grove Stage 16:40–17:20; 20 minutes shared.", "Next: Move one Orchid Bloom set to another time", ["row 17", "row 21"]],
      ["Rule break 2. Changeover", "Willow Circuit and Neon Garden are 10 minutes apart on Grove Stage, under the 15-minute changeover.", "Willow Circuit ends 18:55; Neon Garden starts 19:05.", "Next: Start Neon Garden later or end Willow Circuit earlier", ["row 18", "row 19"]],
      ["Rule break 3. Curfew", "Rustic Harbour ends at 00:20, after the 00:00 curfew.", "Rustic Harbour, Night Tent 23:20–00:20.", "Next: End Rustic Harbour by the 00:00 curfew", ["row 26"]],
      ["Rule break 4. Pair kept apart", "Saffron Season and Ivory Lights share 20 minutes, and you asked that they never overlap.", "Saffron Season, Riverside Stage 16:40–17:40; Ivory Lights, Night Tent 17:20–18:05.", "Next: Move Saffron Season or Ivory Lights so the two no longer share time", ["row 11", "row 22"]],
    ] as const;
    for (const [i, [title, what, where, next, rows]] of expected.entries()) {
      const card = cards.nth(i);
      await expect(card.getByRole("heading", { level: 3 })).toContainText(title);
      await expect(card).toContainText(what);
      await expect(card).toContainText(where);
      await expect(card).toContainText(next);
      for (const row of rows) await expect(card.getByRole("button", { name: row, exact: true })).toBeVisible();
    }
    // The grid marks the same seven rows, numbered by their break.
    await expect(check.flaggedRows()).toHaveCount(7);
    await expect(check.table.getByRole("row", { name: /^Rule break 4\. 11 Saffron Season/ })).toBeVisible();
    await expect(check.table.getByRole("row", { name: /^Rule break 3\. 26 Rustic Harbour/ })).toBeVisible();
  });

  test("selecting a break marks it, and a row button brings that row into view", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    const pick = check.rulesSection.getByRole("button", { name: /^Rule break 3\. Curfew/ });
    await expect(pick).toHaveAttribute("aria-pressed", "false");
    await pick.click();
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await pick.click();
    await expect(pick).toHaveAttribute("aria-pressed", "false");

    await check.breakCards().nth(2).getByRole("button", { name: "row 26", exact: true }).click();
    await expect(check.table.getByRole("row", { name: /^Rule break 3\. 26 Rustic Harbour/ })).toBeInViewport();
  });

  test("lists the sets that share time, longest first, and Show all 35 opens the rest", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await expect(check.sharedSection.getByRole("heading", { level: 2 })).toHaveText("Sets that share time (35 pairs)");
    const pairs = check.sharedSection.getByRole("listitem").filter({ hasText: /min shared/ });
    await expect(pairs).toHaveCount(5);
    await expect(pairs.first()).toContainText("Glass Mirror (Main Stage) and Marble Machine (Riverside Stage)");
    await expect(pairs.first()).toContainText("80 min shared, 19:25–20:45");
    const minutes = await pairs.evaluateAll((all) => all.map((item) => Number(/(\d+) min shared/.exec(item.textContent ?? "")?.[1])));
    expect(minutes).toEqual([...minutes].sort((a, b) => b - a));

    await check.sharedSection.getByRole("button", { name: "Show all 35" }).click();
    await expect(pairs).toHaveCount(35);
    const all = await pairs.evaluateAll((items) => items.map((item) => Number(/(\d+) min shared/.exec(item.textContent ?? "")?.[1])));
    expect(all).toEqual([...all].sort((a, b) => b - a));
  });

  test("the grid shows 18 of 25 rows, with every flagged row, until Show all rows", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await expect(check.page.getByText("Showing 18 of 25 rows: the first 12 and every flagged row")).toBeVisible();
    await check.page.getByRole("button", { name: "Show all rows" }).click();
    await expect(check.table.getByRole("row", { name: /^(Rule break \d\. )?\d+ / })).toHaveCount(25);
  });

  test("rule settings change the verdict: loosen the changeover, drop the curfew, drop the pair rule", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    const rules = check.page.getByRole("group").filter({ hasText: "Rules this check applies" });
    await rules.locator("summary").click();
    await rules.getByRole("textbox", { name: "Changeover (minutes)" }).fill("5");
    await check.checkButton.click();
    await expect(check.rulesSection.getByRole("heading", { level: 2 })).toHaveText("Rule breaks (3)");
    await expect(check.rulesSection).not.toContainText("under the 15-minute changeover");

    await rules.getByRole("textbox", { name: "Curfew (latest end)" }).fill("");
    await check.checkButton.click();
    await expect(check.rulesSection.getByRole("heading", { level: 2 })).toHaveText("Rule breaks (2)");

    await rules.getByRole("textbox", { name: "Pairs that must never overlap" }).fill("");
    await check.checkButton.click();
    await expect(check.rulesSection.getByRole("heading", { level: 2 })).toHaveText("Rule breaks (1)");
    // What is left is the act on two stages at once, which no setting allows.
    await expect(check.rulesSection).toContainText("Orchid Bloom is booked on two stages at the same time.");
    await expect(check.announcement).toContainText("Rule breaks: 1.");
  });

  test("a pasted grid with no rule break says so and lists what shares time", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await check.clearButton.click();
    await expect(check.page.getByRole("region", { name: "Preview" })).toContainText("From the text on the left");
    await check.paste(CLEAN_GRID);
    await check.checkButton.click();

    await expect(check.checked).toContainText("0 rule breaks found");
    await expect(check.page.getByText("Read 8 sets on 4 stages.", { exact: true })).toBeVisible();
    await expect(check.rulesSection).toContainText("No rule breaks found against the settings above.");
    await expect(check.sharedSection.getByRole("heading", { level: 2 })).toHaveText("Sets that share time (5 pairs)");
    await expect(check.sharedSection).toContainText("The Brian Jonestown Massacre (West Holts) and St. Vincent (Woodsies)");
    await expect(check.sharedSection).toContainText("60 min shared, 18:30–19:30.");
    await expect(check.announcement).toHaveText("Rule breaks: 0. Sets that share time: 5 pairs.");
    // A pasted grid is not the invented sample.
    await expect(check.page.getByText("Invented sample: 25 sets with four planted rule breaks.")).toHaveCount(0);
  });

  test("reads 12-hour times and after-midnight times, and checks the curfew against them", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await check.clearButton.click();
    await check.paste(["Aurora,Main,6:00 PM,7:00 PM", "Borealis,Main,7:30pm,8:30pm", "Cygnus,Side,23:00,24:30"].join("\n"));
    // Clear also empties the rules; ask for a midnight curfew.
    const rules = check.page.getByRole("group").filter({ hasText: "Rules this check applies" });
    await rules.locator("summary").click();
    await rules.getByRole("textbox", { name: "Curfew (latest end)" }).fill("00:00");
    await check.checkButton.click();

    await expect(check.page.getByText("Read 3 sets on 2 stages.", { exact: true })).toBeVisible();
    await expect(check.rulesSection.getByRole("heading", { level: 2 })).toHaveText("Rule breaks (1)");
    await expect(check.rulesSection).toContainText("Cygnus ends at 00:30, after the 00:00 curfew.");
  });

  test("a grid that cannot be read is refused line by line, and nothing is checked", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await check.paste("Zorp,Alpha,25:99,11:00\nOnly,two");
    await check.checkButton.click();

    const alert = check.page.getByRole("alert").filter({ hasText: "The grid was not checked." });
    await expect(alert).toContainText("Line 1: the start time is not a time such as 18:00, 24:30, 6:00 PM or 6pm (hours up to 47).");
    await expect(alert).toContainText("Line 2: expected act, stage, start, end (and locked), but found 2 fields.");
    await expect(check.checked).toHaveCount(0);
  });

  test("Table and CSV show the same grid, and Clear empties it", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await expect(check.table).toBeVisible();
    await check.csvView.click();
    await expect(check.grid).toHaveValue(/^act,stage,start,end,locked\nTidal Fields,Main Stage,10:25,11:10,\n/);
    await expect(check.table).toHaveCount(0);
    await check.tableView.click();
    await expect(check.table).toBeVisible();

    await check.clearButton.click();
    await expect(check.page.getByText("Invented sample, to show the format")).toHaveCount(0);
    await expect(check.checked).toHaveCount(0);
  });

  test("Check an invented sample brings the sample back after a clear", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await check.clearButton.click();
    await expect(check.checked).toHaveCount(0);
    await check.sampleButton.click();
    await expect(check.checked).toContainText("4 rule breaks found");
    await expect(check.announcement).toHaveText("Invented sample loaded. Rule breaks: 4. Sets that share time: 35 pairs.");
  });

  test("decisions are the programmer's: marked with a reason, counted in the review, listed, and cleared on reload", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    // A decided break folds into a one-line summary with no heading, so find each by its sentence.
    const first = check.rulesSection.getByRole("listitem").filter({ hasText: "Orchid Bloom is booked on two stages" }).first();
    const second = check.rulesSection.getByRole("listitem").filter({ hasText: "Willow Circuit and Neon Garden are 10 minutes apart" }).first();

    // Kept on purpose, with a reason and a note; Done folds it into a one-line summary.
    await first.getByRole("button", { name: /^Kept on purpose : Orchid Bloom/ }).click();
    await expect(first.getByRole("button", { name: /^Kept on purpose : Orchid Bloom/ })).toHaveAttribute("aria-pressed", "true");
    await first.getByRole("button", { name: "Production" }).click();
    await first.getByRole("textbox", { name: /^Note \(optional, up to 80 characters\)/ }).fill("Headliner contract");
    await first.getByRole("button", { name: /^Done : / }).click();
    await expect(first).toContainText("Kept on purpose · Production");
    await expect(first).toContainText("Note: “Headliner contract”");
    await expect(first.getByRole("button", { name: /^Edit : your decision on Orchid Bloom/ })).toBeVisible();

    await expect(check.review).toContainText(reviewed(1));
    await expect(check.page.getByRole("heading", { name: "Your decisions (1)" })).toBeVisible();

    // Not changing, on another break.
    await second.getByRole("button", { name: /^Not changing : Willow Circuit/ }).click();
    await second.getByRole("button", { name: /^Done : / }).click();
    await expect(check.review).toContainText(reviewed(2));
    await expect(check.page.getByRole("heading", { name: "Your decisions (2)" })).toBeVisible();
    await expect(check.review.getByRole("term").filter({ hasText: "Not changing" })).toBeVisible();
    // A decision changes no figure and removes no rule break.
    await expect(check.rulesSection.getByRole("heading", { level: 2 })).toHaveText("Rule breaks (4)");
    await expect(check.page.getByText("A decision changes no figure on this page.")).toBeVisible();

    // Edit reopens it; pressing the pressed choice takes the decision back.
    await first.getByRole("button", { name: /^Edit : your decision on Orchid Bloom/ }).click();
    await first.getByRole("button", { name: /^Kept on purpose : Orchid Bloom/ }).click();
    await expect(check.page.getByRole("heading", { name: "Your decisions (1)" })).toBeVisible();
    await expect(check.review).toContainText(reviewed(1));

    // Decisions stay in this tab only: a reload clears them.
    await page.reload({ waitUntil: "domcontentloaded" });
    await check.goto();
    await expect(check.review).toContainText(reviewed(0));
    await expect(check.page.getByRole("heading", { name: /^Your decisions/ })).toHaveCount(0);
  });

  test("Find a change searches in the browser, and Try it makes a working copy that leaves the paste alone", async ({ page, guard }) => {
    const check = new CheckPage(page);
    await check.goto();

    await check.rulesSection.getByRole("button", { name: /^Find a change : Willow Circuit and Neon Garden/ }).click();
    await expect(
      check.page.getByRole("paragraph").filter({ hasText: /\d+ within 3 hours found, \d+ shown: each ends it, adds no rule break and makes none larger/ }),
    ).toBeVisible();
    const tryIt = check.page.getByRole("button", { name: "Try it" });
    await expect(tryIt.first()).toBeVisible();
    await tryIt.first().click();

    const copy = check.page.getByRole("region", { name: "Working copy" });
    await expect(copy).toContainText("Working copy: 1 change applied to the pasted grid. Nothing you pasted has been altered.");
    await expect(copy).toContainText("Willow Circuit → Grove Stage 17:50–18:50 (was Grove Stage 17:55–18:55)");
    await expect(check.rulesSection.getByRole("heading", { level: 2 })).toHaveText("Rule breaks (3)");
    await expect(check.announcement).toHaveText("Change applied to a working copy of the grid. Rule breaks: 3. Sets that share time: 35 pairs.");
    await copy.getByRole("button", { name: "Back to the pasted grid" }).click();
    await expect(check.rulesSection.getByRole("heading", { level: 2 })).toHaveText("Rule breaks (4)");
    expect(apiWrites(guard.requested)).toEqual([]);
  });

  test("Download CSV and Download a template save files", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    const [csv] = await Promise.all([page.waitForEvent("download"), check.review.getByRole("button", { name: "Download CSV" }).click()]);
    expect(csv.suggestedFilename()).toBe("clash-control-invented-sample-grid.csv");
    const text = fs.readFileSync((await csv.path()) as string, "utf8");
    expect(text).toMatch(/^act,stage,start,end,locked\nTidal Fields,Main Stage,10:25,11:10,\n/);
    expect(text.trim().split("\n")).toHaveLength(26); // header + 25 sets

    const [template] = await Promise.all([page.waitForEvent("download"), check.templateButton.click()]);
    expect(template.suggestedFilename()).toBe("clash-control-grid-template.csv");
    expect(fs.readFileSync((await template.path()) as string, "utf8")).toMatch(/^act,stage,start,end,locked\nExample act one,Main stage,18:00,19:00,\n/);
  });

  test("a share link carries the grid in its fragment, and opening it fills the fields again", async ({ page, context }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.clearButton.click();
    await check.paste(CLEAN_GRID);
    await check.checkButton.click();
    await expect(check.checked).toContainText("0 rule breaks found");

    await check.review.getByRole("button", { name: "Copy share link" }).click();
    const link = check.page.getByRole("textbox", { name: /link/i });
    await expect(link).toBeVisible();
    const url = await link.inputValue();
    // The grid travels in the fragment, which a server never receives.
    expect(url).toMatch(/\/check#g=[A-Za-z0-9_-]+/);
    await expect(check.review).toContainText("Anyone with this link can read the grid.");

    const other = await context.newPage();
    await other.goto(url, { waitUntil: "domcontentloaded" });
    const reopened = new CheckPage(other);
    await expect(reopened.heading).toBeVisible();
    await reopened.chrome.waitForHydration();
    // Opening the link fills the fields again; the check itself is the programmer's to run.
    await reopened.csvView.click();
    await expect(reopened.grid).toHaveValue(CLEAN_GRID);
    await expect(reopened.checked).toHaveCount(0);
    await reopened.checkButton.click();
    await expect(reopened.checked).toContainText("0 rule breaks found");
    await expect(reopened.sharedSection.getByRole("heading", { level: 2 })).toHaveText("Sets that share time (5 pairs)");
  });

  test("Print draft brief asks the browser to print", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      window.print = () => {
        (window as unknown as { __prints: number }).__prints += 1;
      };
    });
    const check = new CheckPage(page);
    await check.goto();
    await check.printButton.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);
  });

  test("print media: only the brief prints, as dark ink on white, on one page", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.emulateMedia({ colorScheme: "dark" });
    const check = new CheckPage(page);
    await check.goto();
    expect(await check.chrome.appliedTheme()).toBe("dark");
    await check.rulesSection.getByRole("button", { name: /^Kept on purpose : Orchid Bloom/ }).click();

    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    await expectPrintSheet(page);
    // The form, the buttons and the on-screen results are not printed; the brief is.
    await expect(check.checkButton).toBeHidden();
    await expect(check.printButton).toBeHidden();
    await expect(check.heading).toBeHidden();
    await expect(page.getByText("Draft check, not a verdict").filter({ visible: true }).first()).toBeVisible();
    // Under print rules the rendered text of the page is the brief: innerText leaves out what print hides.
    const sheet = page.locator("body");
    await expect(sheet).toContainText("Invented sample: 25 sets with four planted rule breaks.", { useInnerText: true });
    await expect(sheet).toContainText("Computed in your browser from the pasted grid.", { useInnerText: true });
    await expect(sheet).toContainText("Your decisions", { useInnerText: true });
    await expect(sheet).not.toContainText("Check the grid", { useInnerText: true });

    for (const format of ["Letter", "A4"] as const) {
      const pdf = await page.pdf({ format, printBackground: true });
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(pdfPages(pdf), `${format} pages`).toBe(1);
    }
  });
});

test.describe("check a draft grid, round-31 paths", () => {
  /** Six invented acts on three stages: a fresh grid that shares no act with the sample. */
  const SIX_ACTS = [
    "Aurora,Main,18:00,19:00",
    "Borealis,Side,18:30,19:30",
    "Cygnus,Main,19:20,20:20",
    "Draco,Side,19:45,20:45",
    "Eridanus,Tent,18:15,19:15",
    "Fornax,Tent,19:30,20:30",
  ].join("\n");

  test("the first paste over the sample is checked, and the sample's pair rule it no longer fits is removed with a notice", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    // No Clear first: the visitor pastes straight over the invented sample.
    await check.paste(SIX_ACTS);
    await check.checkButton.click();

    await expect(check.page.getByRole("alert").filter({ hasText: "The grid was not checked." })).toHaveCount(0);
    await expect(check.checked).toContainText("0 rule breaks found");
    await expect(check.page.getByText("Read 6 sets on 3 stages.", { exact: true })).toBeVisible();
    const removed = "Removed the sample's rule \"Saffron Season | Ivory Lights\": neither act is in this grid.";
    await expect(check.page.getByText(removed, { exact: true }).first()).toBeVisible();
    await expect(check.page.getByRole("status").filter({ hasText: removed })).toContainText("Rule breaks: 0. Sets that share time: 7 pairs.");
    await expect(check.rules).toContainText("0 pair rules");
  });

  test("a pair rule the visitor typed is never removed for them; Remove this rule is the first fix offered", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.paste(SIX_ACTS);
    await check.rules.locator("summary").click();
    await check.rules.getByRole("textbox", { name: "Pairs that must never overlap" }).fill("Aurora | Nobody Here");
    await check.checkButton.click();

    const alert = check.page.getByRole("alert").filter({ hasText: "The grid was not checked." });
    await expect(alert).toContainText("Pair line 1: “Nobody Here” matches no set in the grid.");
    await expect(check.rules.getByRole("textbox", { name: "Pairs that must never overlap" })).toHaveValue("Aurora | Nobody Here");
    const fixes = alert.getByRole("button");
    await expect(fixes.first()).toHaveAccessibleName(/^Remove this rule/);

    await fixes.first().click();
    await expect(alert).toHaveCount(0);
    await expect(check.checked).toContainText("0 rule breaks found");
    await expect(check.page.getByRole("status").filter({ hasText: "Pair line 1 removed." })).toContainText("Rule breaks: 0.");
    await expect(check.rules).toContainText("0 pair rules");
  });

  test("a found change that moves a set to another stage says it needs production sign-off; one that keeps the stage does not", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await check.rulesSection.getByRole("button", { name: /^Find a change : Rustic Harbour/ }).click();
    // Each found change is a list item of its own that starts with what it ends (the break's card holds them all).
    const changes = check.page.getByRole("listitem").filter({ has: check.page.getByRole("button", { name: "Try it" }) }).filter({ hasText: /^Ends / });
    await expect(changes.first()).toBeVisible();
    const sameStage = changes.filter({ hasText: "Rustic Harbour → Night Tent 23:00–00:00 (was Night Tent 23:20–00:20)" });
    const otherStage = changes.filter({ hasText: "Rustic Harbour → Riverside Stage 23:00–00:00 (was Night Tent 23:20–00:20)" });
    await expect(sameStage).toHaveCount(1);
    await expect(otherStage).toHaveCount(1);
    await expect(otherStage).toContainText("Changes stage: needs production sign-off");
    await expect(sameStage).not.toContainText("Changes stage");
    // Changes that keep every set on its stage come first; the engine's order holds within each group.
    await expect(check.page.getByText(/Changes that keep every set on its stage are listed first/).first()).toBeVisible();
    const stageChanges = await changes.evaluateAll((all) => all.map((item) => (item.textContent ?? "").includes("Changes stage: needs production sign-off")));
    const firstStageChange = stageChanges.indexOf(true);
    expect(firstStageChange, "a stage change is listed").toBeGreaterThan(0);
    expect(stageChanges.slice(firstStageChange).every(Boolean), "no same-stage change after a stage change").toBe(true);
  });

  test("Find a change leaves out, by default, a change that ends a clash kept on purpose, and keeps it in a closed fold", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    // Mark an overlap as kept on purpose, then look for a change that ends that same overlap: every change does.
    const pair = "Glass Mirror and Marble Machine";
    await check.sharedSection.getByRole("button", { name: new RegExp(`^Kept on purpose\\s*:\\s*${pair}$`) }).click();
    await check.sharedSection.getByRole("button", { name: new RegExp(`^Find a change\\s*:\\s*${pair}$`) }).click();

    const none = check.page.getByText(/^All (\d+) changes found end a clash you kept on purpose, so none is listed\.$/);
    await expect(none).toBeVisible();
    const [, found = "0"] = /^All (\d+)/.exec(await none.innerText()) ?? [];
    expect(Number(found)).toBeGreaterThan(0);
    // Nothing is offered to try until the fold is opened: opening it is the explicit override.
    const fold = check.page.locator("details").filter({ has: check.page.locator("summary", { hasText: /^Changes that end a clash you kept on purpose \(\d+\)$/ }) });
    await expect(fold).toHaveCount(1);
    await expect(fold.locator("summary")).toHaveText(`Changes that end a clash you kept on purpose (${found})`);
    await expect(fold).toHaveJSProperty("open", false);
    const inside = fold.getByRole("listitem").filter({ has: check.page.getByRole("button", { name: "Try it" }) });
    await expect(inside).toHaveCount(0);

    await fold.locator("summary").click();
    await expect(fold).toHaveJSProperty("open", true);
    await expect(inside).toHaveCount(Number(found));
    for (const change of await inside.all()) await expect(change).toContainText("Ends a clash you kept on purpose");
  });

  test("the privacy line sits by the paste box, once, with no click", async ({ page, isPhone }) => {
    const check = new CheckPage(page);
    await check.goto();

    await expect(check.privacy).toHaveCount(1);
    await expect(check.privacy).toBeVisible();
    await expect(check.privacy).toContainText("Decisions you mark stay in this tab and clear on reload.");
    if (!isPhone) {
      // On a 1440x900 screen it is on the first screen, above the grid.
      const box = await check.privacy.boundingBox();
      expect(box?.y ?? Infinity, "the privacy line starts on the first screen").toBeLessThan(900);
      const grid = await check.table.boundingBox();
      expect(box?.y ?? Infinity).toBeLessThan(grid?.y ?? 0);
    }
  });

  test("Check a published day loads its timetable with its own rules and no pair rules, and says what it does not check", async ({ page }) => {
    const days = await listDays(page);
    test.skip(!days.some((day) => !day.synthetic), "The API serves no published day.");
    const check = new CheckPage(page);
    await check.goto();

    await check.publishedButton.click();
    await expect(check.page.getByText(/^Published timetable: /).first()).toBeVisible();
    await expect(check.page.getByRole("status").filter({ hasText: "Published timetable loaded." })).toContainText(/Rule breaks: \d+\./);
    await expect(check.rules).toContainText("0 pair rules");
    await expect(check.page.getByText(/its billing rules and stage hours are not checked here\./).first()).toBeVisible();
    // It is a published timetable, not the invented sample.
    await expect(check.page.getByText("Invented sample: 25 sets with four planted rule breaks.")).toHaveCount(0);
  });
});

async function expectPrintSheet(page: Page): Promise<void> {
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(page.getByRole("contentinfo")).toBeHidden();
  await expect.poll(async () => luminance(await rgbOf(page, "body", "backgroundColor")), "paper is white").toBeGreaterThan(0.95);
  await expect.poll(async () => luminance(await rgbOf(page, "body", "color")), "ink is dark").toBeLessThan(0.2);
}
