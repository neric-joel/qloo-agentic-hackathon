import fs from "node:fs";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { listDays, luminance, MESSY_GRID, MESSY_LINE_4, MESSY_NO_BREAKS, MESSY_SKIPPED, pdfPages, requireSavedDays, rgbOf } from "./helpers";
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

/** The time forms a skip or refusal names (round 36: the dotted and four-digit forms read too). */
const TIME_FORMS = "18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm";

/** What the rail says is open on the invented sample, before any decision (round 36). */
const OPEN_ON_SAMPLE = "4 rule breaks to review · 35 overlaps to decide";

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
    // Round 36: the rail says what is open with rule breaks apart from ordinary overlaps, beside its heading and in its
    // Open row, and never as one lumped "n open".
    await expect(check.review.getByText(OPEN_ON_SAMPLE, { exact: true })).toHaveCount(2);
    await expect(check.review.getByText(OPEN_ON_SAMPLE, { exact: true }).first()).toBeVisible();
    await expect(check.review).not.toContainText(/\b\d+ open\b/);
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
    // Round 36: each line's message names its act and quotes the value it could not read.
    await expect(alert).toContainText(`Line 1 (Zorp): the start time "25:99" is not a time such as ${TIME_FORMS}.`);
    await expect(alert).toContainText("Line 2 (Only): expected act, stage, start, end (and locked), but found 2 fields.");
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
    // Round 36: on paper it opens with its heading and the print date, and ends with the sign-off block.
    await check.expectDraftHeadingAndSignOff();

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

  // Round 36: a published day's locks are this app's (neither festival marks a set as fixed), and on both days the locked
  // sets are exactly the last set on each stage, so the read line says so; a pasted grid keeps "marked locked".
  for (const day of [
    { id: "glastonbury-2025-sun", label: "Glastonbury 2025, Sunday" },
    { id: "riot-fest-2026-sun", label: "Riot Fest 2026, Sunday" },
  ]) {
    test(`Check a published day (${day.label}) says whose locks they are: this app's, the last set on each stage, not the festival's`, async ({ page, guard }) => {
      await requireSavedDays(page);
      // The button offers the first published day the list names; to reach the other, the list is answered in the
      // order that puts it first (a GET answered from the server's own list, nothing else changed).
      await page.route(
        (url) => url.pathname === "/api/presets",
        async (route) => {
          const response = await route.fetch();
          const list = (await response.json()) as { id: string }[];
          await route.fulfill({ response, json: [...list.filter((item) => item.id === day.id), ...list.filter((item) => item.id !== day.id)] });
        },
      );
      const check = new CheckPage(page);
      await check.goto();
      await expect(check.publishedButton).toHaveAccessibleName(`Check a published day: ${day.label}`);
      await check.publishedButton.click();
      await expect(check.page.getByRole("status").filter({ hasText: "Published timetable loaded." })).toContainText(/Rule breaks: \d+\./);

      await expect(check.readLine).toHaveText(
        /^Read \d+ sets on \d+ stages; 5 locked by this app \(the last set on each stage\); the festival did not mark them\. Locked sets are still checked against your rules; they are only kept in place when you search for a change\.$/,
      );
      await expect(check.readLine).not.toContainText("marked locked");
      await expect(check.page.locator("body")).not.toContainText("not by the festival", { useInnerText: true });
      expect(guard.writes, "nothing sent").toEqual([]);
    });
  }
});

test.describe("check a draft grid, round 36: a real grid's own words", () => {
  /** The rail's open line once every rule break is decided or there were none: overlaps only, the zero part left out. */
  const OVERLAPS_ONLY = /^\d+ overlaps? to decide$/;

  /**
   * Pastes a grid over the sample and checks it; the answer reads the requests other than GET sent from the paste on
   * (it must be none: the check runs in the browser).
   */
  async function pasteAndCheck(check: CheckPage, grid: string, guard: { writes: string[] }): Promise<() => string[]> {
    const before = guard.writes.length;
    await check.replaceWith(grid);
    await check.checkButton.click();
    return () => guard.writes.slice(before);
  }

  for (const paste of [
    {
      name: "a header in the grid's own words (Artist, Stage, Start, Finish)",
      grid: ["Artist,Stage,Start,Finish", "Aurora,Main,18:00,19:00", "Borealis,Side,18:30,19:30", "Cygnus,Main,19:20,20:20", "Draco,Side,19:45,20:45", "Eridanus,Tent,18:15,19:15", "Fornax,Tent,19:30,20:30"],
      sets: 6,
      stages: 3,
    },
    {
      name: "one column of time ranges (Set time), with a hyphen, \"to\", an en dash and dotted and h forms",
      grid: ["Act,Stage,Set time", "Aurora,Main,18:00-19:00", "Borealis,Side,6pm to 7:15pm", "Cygnus,Tent,18:30–19:30", "Draco,Main,19.30 - 20h30"],
      sets: 4,
      stages: 3,
    },
    {
      name: "dotted, compact, h and one-letter times with no header",
      grid: ["Aurora,Main,6.30pm,7.30 pm", "Borealis,Side,6.30 pm,19:30", "Cygnus,Tent,18.30,1930", "Draco,Field,1830,19:45", "Eridanus,Hall,18h30,20h00", "Fornax,Yard,6:30p,7:30p"],
      sets: 6,
      stages: 6,
    },
  ]) {
    test(`${paste.name} is read line by line, every line, and nothing is sent`, async ({ page, guard }) => {
      const check = new CheckPage(page);
      await check.goto();
      const sent = await pasteAndCheck(check, paste.grid.join("\n"), guard);

      await check.expectEveryLineRead(paste.sets, paste.stages);
      await expect(check.checkTime).toHaveText(new RegExp(`^Checked ${paste.sets} sets on ${paste.stages} stages in \\d+ ms, in this browser\\.$`));
      expect(sent(), "requests other than GET while pasting and checking").toEqual([]);
      expect(apiWrites(guard.requested)).toEqual([]);
    });
  }

  test("a header it cannot read is refused in one message that names the missing column, quotes the cell it did not read, and reads no line after it", async ({ page, guard }) => {
    const check = new CheckPage(page);
    await check.goto();
    // Two more lines under it that would each be refused on their own (a bad time, two fields): neither is read.
    const sent = await pasteAndCheck(check, ["Act,Stage,Start,Endzeit", "Aurora,Main,25:99,19:00", "Only,two"].join("\n"), guard);

    await expect(check.refusal).toBeVisible();
    await expect(check.refusal.getByRole("listitem")).toHaveCount(1);
    await expect(check.refusal.getByRole("listitem")).toHaveText(
      'Line 1: no column reads as end. Not read: "Endzeit". For end this check reads: end, end time, ends, finish, finish time, finishes, until, to, set end.',
    );
    await expect(check.refusal).not.toContainText("Line 2");
    await expect(check.checked).toHaveCount(0);
    expect(sent(), "requests other than GET").toEqual([]);
  });

  test("the messy paste's skip names the act and quotes its value, and the rail counts only what is open: overlaps, no rule break", async ({ page, guard }) => {
    const check = new CheckPage(page);
    await check.goto();
    const sent = await pasteAndCheck(check, MESSY_GRID, guard);

    await expect(check.skippedNotice.locator("p").first()).toHaveText(MESSY_SKIPPED);
    await expect(check.skippedNotice).toContainText(MESSY_LINE_4);
    // The line is still marked in the editor.
    await expect(check.skippedMark(4)).toHaveText("skipped 4");
    // No rule break among the eleven sets read, so the rail's open line names only the overlaps, beside its heading and
    // in its Open row.
    const open = check.review.getByText(OVERLAPS_ONLY);
    await expect(open).toHaveCount(2);
    await expect(check.review.getByText(/^\d+ rule breaks? to review/)).toHaveCount(0);
    expect(sent(), "requests other than GET").toEqual([]);
  });
});

test.describe("check a draft grid, round 35: a real paste survives first contact", () => {
  /** The time line after any check, measured in this browser. */
  const TIME_LINE = /^Checked \d+ sets on \d+ stages in \d+ ms, in this browser\.$/;

  test("a paste into the Table view lands in the CSV editor, says so once, and checks nothing", async ({ page, context, guard }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const check = new CheckPage(page);
    await check.goto();

    // The page opens on the Table view, with the sample checked.
    await expect(check.table).toBeVisible();
    await expect(check.pasteTarget).toBeVisible();
    const lines = MESSY_GRID.split("\n").map((line) => line.split(",").join("\t"));
    await check.pasteTarget.click({ position: { x: 24, y: 24 } });
    await page.evaluate((text) => navigator.clipboard.writeText(text), lines.join("\n"));
    const before = guard.requested.length;
    await page.keyboard.press("ControlOrMeta+V");

    // The text is in the CSV editor, which has focus; the table and its paste target are gone.
    await expect(check.grid).toBeVisible();
    await expect(check.grid).toBeFocused();
    await expect(check.grid).toHaveValue(lines.join("\n"));
    await expect(check.pasteTarget).toHaveCount(0);
    await expect(check.table).toHaveCount(0);
    // It is said once, politely, and nothing was checked or sent: the sample's results stand until Check the grid.
    await expect(page.getByRole("status").filter({ hasText: "Pasted 12 lines into the CSV editor. Press Check the grid." })).toHaveCount(1);
    await expect(check.skippedNotice).toHaveCount(0);
    expect(guard.requested.slice(before).filter((url) => new URL(url).pathname.startsWith("/api/") && !/\/api\/(presets|health)/.test(new URL(url).pathname))).toEqual([]);

    // Checked, the pasted grid reads like the typed one.
    await check.checkButton.click();
    await expect(check.skippedNotice.locator("p").first()).toHaveText(MESSY_SKIPPED);
  });

  test("a grid with one unreadable line checks the other lines, says which line it skipped and why, and marks it", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.replaceWith(MESSY_GRID);
    await check.checkButton.click();

    // The skipped line comes first in the results, with its reason.
    await expect(check.skippedNotice).toBeVisible();
    await expect(check.skippedNotice.locator("p").first()).toHaveText(MESSY_SKIPPED);
    // Round 36: the reason names the act on the line and quotes the value it could not read.
    await expect(check.skippedNotice).toContainText(MESSY_LINE_4);
    // The rest was checked: the eleven readable sets, and no rule break among them, said with what was checked.
    await expect(check.page.getByText("Read 11 sets on 3 stages.", { exact: true })).toBeVisible();
    await expect(check.rulesSection).toContainText(MESSY_NO_BREAKS);
    await expect(check.page.locator("body")).not.toContainText("No rule breaks found against the settings above.", { useInnerText: true });
    await expect(check.refusal).toHaveCount(0);
    // The skipped line is marked beside the text, in ink, and the time line says what was read.
    const mark = check.skippedMark(4);
    await expect(mark).toBeVisible();
    await expect(mark).toHaveText("skipped 4");
    expect(await mark.evaluate((element) => getComputedStyle(element).color)).toBe(await check.page.evaluate(() => getComputedStyle(document.body).color));
    await expect(check.checkTime).toHaveText(TIME_LINE);
    await expect(check.checkTime).toHaveText(/^Checked 11 sets on 3 stages in /);
    // A screen reader hears the skipped sentence once.
    await expect(check.page.getByRole("status").filter({ hasText: MESSY_SKIPPED })).toHaveCount(1);
  });

  test("a pair rule naming an act on a skipped line is listed as not checked, never passed silently", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.replaceWith(MESSY_GRID);
    await check.rules.locator("summary").click();
    await check.pairs.fill("Glass Harbour | Tidal Fields");
    await check.checkButton.click();

    await expect(check.skippedNotice.locator("p").first()).toHaveText(MESSY_SKIPPED);
    await expect(check.skippedNotice).toContainText("Pair line 1 not checked: Glass Harbour is on a skipped line.");
    await expect(check.rulesSection).toContainText(MESSY_NO_BREAKS);
  });

  for (const fault of [
    {
      name: "a header that does not read",
      // A header (it names known columns) that lacks two of the four it needs, so no line can be read with confidence.
      // Round 36: "begins" and "ends" now read as start and end, so the words here are ones it does not know; the one
      // message names each missing column, quotes the cells it did not read, and lists the words it reads for each.
      grid: ["artist,stage,kickoff,endzeit", "Tidal Fields,Main Stage,14:00,15:00", "Cobalt Rows,Side Stage,14:15,15:15"].join("\n"),
      says: 'Line 1: no column reads as start or end. Not read: "kickoff", "endzeit". For start this check reads: start, start time, starts, begin, begins, from, set start. For end this check reads: end, end time, ends, finish, finish time, finishes, until, to, set end. Or one column of ranges such as 18:00-19:00, headed time, times, set time, set times or slot.',
    },
    {
      name: "two days",
      grid: ["act,stage,start,end,day", "Tidal Fields,Main Stage,14:00,15:00,Friday", "Cobalt Rows,Side Stage,14:15,15:15,Saturday"].join("\n"),
      says: "This grid has more than one day (Friday, Saturday). Paste one day at a time.",
    },
    {
      name: "more sets than the page reads",
      grid: Array.from({ length: 61 }, (_, i) => {
        const hour = String(10 + Math.floor(i / 6)).padStart(2, "0");
        return `Act ${i + 1},Stage ${(i % 6) + 1},${hour}:00,${hour}:45`;
      }).join("\n"),
      says: "That is 61 sets. This page reads up to 60 sets, one day at a time.",
    },
  ]) {
    test(`${fault.name} still stops the whole check: "The grid was not checked."`, async ({ page }) => {
      const check = new CheckPage(page);
      await check.goto();
      await check.replaceWith(fault.grid);
      await check.checkButton.click();

      await expect(check.refusal).toBeVisible();
      await expect(check.refusal).toContainText(fault.says);
      await expect(check.checked).toHaveCount(0);
      await expect(check.skippedNotice).toHaveCount(0);
      await expect(check.checkTime).toHaveCount(0);
      // The preview says it cannot draw the grid, in place of its bars.
      await expect(check.previewUnavailable).toHaveText("Preview unavailable: fix the lines listed and check again.");
    });
  }

  test("lines separated by semicolons are refused with a hint, and the preview's notice takes its bars' place at their height", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.clearButton.click();
    await check.csvView.click();
    const box = check.page.locator("[data-preview-box]");
    await expect(box).toBeVisible();
    const empty = await box.boundingBox();
    // Before any text, the preview's outline bars are drawn and there is no notice.
    await expect(check.previewUnavailable).toHaveCount(0);

    // Round 36 fix pass: a grid separated by semicolons from its first line is read, so the hint is for a comma header
    // over lines that use semicolons.
    await check.grid.fill(["act,stage,start,end", ...MESSY_GRID.split("\n").map((line) => line.split(",").join(";"))].join("\n"));
    await check.checkButton.click();
    await expect(check.refusal).toBeVisible();
    await expect(check.refusal).toContainText("And 7 more problems.");
    await expect(check.separatorHint).toHaveCount(1);
    await expect(check.separatorHint).toHaveText("These lines look separated by semicolons. Use commas or tabs between act, stage, start and end.");
    // Nothing can be read, so the preview draws no bars: its notice says so, in the same box at the same height.
    await expect(check.previewUnavailable).toHaveText("Preview unavailable: fix the lines listed and check again.");
    const bars = await box
      .locator("span.bg-muted")
      .evaluateAll((all) => all.filter((bar) => getComputedStyle(bar).visibility !== "hidden" && bar.getClientRects().length > 0).length);
    expect(bars, "skeleton bars drawn while nothing can be read").toBe(0);
    const unavailable = await box.boundingBox();
    expect(Math.abs((unavailable?.height ?? 0) - (empty?.height ?? 0)), "the preview box keeps its height").toBeLessThanOrEqual(1);
  });

  test("a grid separated by semicolons from its first line, as a comma-decimal spreadsheet saves it, is read line by line", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.replaceWith(MESSY_GRID.split("\n").map((line) => line.split(",").join(";")).join("\n"));
    await check.checkButton.click();
    await expect(check.refusal).toHaveCount(0);
    await expect(check.separatorHint).toHaveCount(0);
    await expect(check.skippedNotice.locator("p").first()).toHaveText(MESSY_SKIPPED);
    await expect(check.skippedNotice).toContainText(MESSY_LINE_4);
  });

  test("every check says what it read and how long it took, in this browser: the sample, a published day, a paste", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();

    await check.sampleButton.click();
    await expect(check.checkTime).toHaveText(TIME_LINE);
    await expect(check.checkTime).toHaveText(/^Checked 25 sets on 4 stages in /);
    const days = await listDays(page);
    if (days.some((day) => !day.synthetic)) {
      await check.publishedButton.click();
      // Wait for the published day to arrive and be checked (the sample's time line is already on the page).
      await expect(check.page.getByRole("status").filter({ hasText: "Published timetable loaded." })).toContainText(/Rule breaks: \d+\./);
      await expect(check.checkTime).toHaveText(TIME_LINE);
      await expect(check.checkTime).not.toHaveText(/^Checked 25 sets on 4 stages in /);
    }
    await check.replaceWith(CLEAN_GRID);
    await check.checkButton.click();
    await expect(check.checkTime).toHaveText(TIME_LINE);
    await expect(check.checkTime).toHaveText(/^Checked 8 sets on 4 stages in /);
  });
});

async function expectPrintSheet(page: Page): Promise<void> {
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(page.getByRole("contentinfo")).toBeHidden();
  await expect.poll(async () => luminance(await rgbOf(page, "body", "backgroundColor")), "paper is white").toBeGreaterThan(0.95);
  await expect.poll(async () => luminance(await rgbOf(page, "body", "color")), "ink is dark").toBeLessThan(0.2);
}

test.describe("check a draft grid, round 37: the rejected value, a paste with nothing focused, a late published day, the printed overlaps", () => {
  /** The selected characters of the CSV editor. */
  const selection = (check: CheckPage) => check.grid.evaluate((area: HTMLTextAreaElement) => area.value.slice(area.selectionStart, area.selectionEnd));

  test("a skipped line's mark selects its rejected value in the editor, and Show it in the grid does the same from the Table view (L64)", async ({ page, guard }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.replaceWith(MESSY_GRID);
    await check.checkButton.click();
    await expect(check.skippedNotice.locator("p").first()).toHaveText(MESSY_SKIPPED);

    // The mark is a control named for what it does, and still reads "skipped 4".
    const mark = page.getByRole("button", { name: "Select the rejected value on line 4" });
    await expect(mark).toHaveText("skipped 4");
    await mark.click();
    await expect(check.grid).toBeFocused();
    expect(await selection(check), "the rejected value, selected").toBe("25:70");

    // From the Table view, "Show it in the grid" turns to the text and selects the same characters.
    await check.tableView.click();
    await expect(check.grid).toHaveCount(0);
    await page.getByRole("button", { name: "Show it in the grid" }).click();
    await expect(check.grid).toBeFocused();
    expect(await selection(check), "the rejected value, selected again").toBe("25:70");
    expect(apiWrites(guard.requested), "nothing sent").toEqual([]);
  });

  test("a paste with nothing focused goes into the editor as a paste there would, is said once, and checks nothing (L65)", async ({ page, context, guard }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const check = new CheckPage(page);
    await check.goto();
    await expect(check.table).toBeVisible();
    const read = await check.readLine.innerText();

    const text = ["Aurora,Main,18:00,19:00", "Borealis,Side,18:30,19:30"].join("\n");
    await page.evaluate((value) => navigator.clipboard.writeText(value), text);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await page.evaluate(() => document.activeElement === document.body), "nothing has focus").toBe(true);
    const before = guard.requested.length;
    await page.keyboard.press("ControlOrMeta+V");

    await expect(check.grid).toBeVisible();
    await expect(check.grid).toHaveValue(text);
    await expect(page.getByRole("status").filter({ hasText: "Pasted 2 lines into the CSV editor. Press Check the grid." })).toHaveCount(1);
    // Nothing was checked: the sample's results stand until Check the grid, and nothing was sent.
    await expect(check.readLine).toHaveText(read);
    expect(guard.requested.slice(before).filter((url) => new URL(url).pathname.startsWith("/api/") && !/\/api\/(presets|health)/.test(new URL(url).pathname))).toEqual([]);
  });

  test("Check a published day, with a grid pasted while the day loads: the paste is kept, the late day ignored, and that is said once (L70)", async ({ page }) => {
    await requireSavedDays(page);
    const check = new CheckPage(page);
    await check.goto();
    await expect(check.publishedButton).toBeVisible();
    // The day's own timetable is held 3 s, as on a slow connection.
    let held = 0;
    await page.route(
      (url) => /^\/api\/presets\/[^/]+$/.test(url.pathname),
      async (route) => {
        held += 1;
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        await route.fallback();
      },
    );
    await check.publishedButton.click();
    await expect(page.getByRole("status").filter({ hasText: "Loading the published timetable." })).toHaveCount(1);
    const text = ["Aurora,Main,18:00,19:00", "Borealis,Side,18:30,19:30"].join("\n");
    await check.paste(text);
    const kept = page.getByRole("status").filter({ hasText: "Kept your pasted grid; ignored the published day that arrived later." });
    await expect(kept).toHaveCount(1, { timeout: 15_000 });
    await expect(kept).toHaveText("Kept your pasted grid; ignored the published day that arrived later.");
    await expect(check.grid).toHaveValue(text);
    expect(held, "the day's request was made, and held").toBeGreaterThanOrEqual(1);
  });

  test("the sample's pair rule stays when one of its acts is on a skipped line of a fresh grid, and the check says it was not checked (L71)", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    // A fresh grid in place of the sample, with Saffron Season (in the sample's pair rule) on a line that cannot be read.
    await check.paste(
      [
        "Amber Kite,Main,18:00,19:00",
        "Basalt Choir,Side,18:30,19:30",
        "Copper Field,Main,19:15,20:00",
        "Dune Signal,Side,19:45,20:30",
        "Ember Coast,Tent,18:00,19:00",
        "Flint Arcade,Tent,19:30,20:30",
        "Saffron Season,Barn,25:70,22:00",
        "Ivory Lights,Hill,21:00,22:00",
      ].join("\n"),
    );
    await check.checkButton.click();
    await expect(check.skippedNotice).toContainText("Pair line 1 not checked: Saffron Season is on a skipped line.");
    await expect(page.locator("body")).not.toContainText(/Removed the sample|neither act is in this grid/, { useInnerText: true });
  });

  test("on paper the draft brief lists the overlaps longest first, twelve at most, then says how many more were not printed, on one page (L66)", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.checkButton.click();
    await expect(check.announcement).toHaveText(/^Rule breaks: \d+/);
    const overlaps = page.locator("[data-brief-overlaps]").filter({ visible: true });
    // On screen the list is not drawn; it is paper only.
    await expect(overlaps).toHaveCount(0);
    await page.emulateMedia({ media: "print" });
    await expect(overlaps).toHaveCount(1);
    const lines = overlaps.getByRole("listitem");
    await expect(lines).toHaveCount(12);
    const minutes = (await lines.allInnerTexts()).map((line) => {
      const match = /^.+ × .+: (\d+) min \(\d{2}:\d{2}–\d{2}:\d{2}\)$/.exec(line.trim());
      expect(match, `a printed overlap line: "${line}"`).not.toBeNull();
      return Number(match?.[1]);
    });
    expect(minutes, "longest first").toEqual([...minutes].sort((a, b) => b - a));
    // The sample shares time in 35 pairs: 12 printed, 23 not.
    await expect(overlaps).toContainText("and 23 more overlaps not printed.");
    for (const format of ["Letter", "A4"] as const) expect(pdfPages(await page.pdf({ format, printBackground: true })), `${format} pages`).toBe(1);
  });
});

/**
 * Round 39 (W1, D12): a title line above a grid ("Glastonbury Sunday", "Saturday, 4 July") no longer refuses the whole
 * grid. The first line is read as a title only when no time stands in it, and the check says so in one note above "Read
 * n sets on m stages"; the title is never a skipped line, so no partial notice shows, but the no-breaks line still says
 * how many sets were checked (a clean result on part of a paste is never read as a clean grid). A first line with a clock
 * time among its words is a line fault, listed as before. The semicolon hint is held by its own test above.
 */
test.describe("check a draft grid, round 39: a title line above the grid (W1, D12)", () => {
  /** The note for a title on line 1, as the check prints it. */
  const titleNote = (title: string) => `Skipped line 1 ("${title}"): no times found, so it was read as a title.`;

  for (const paste of [
    {
      name: "a tab grid under \"Glastonbury Sunday\"",
      title: "Glastonbury Sunday",
      grid: ["Glastonbury Sunday", "Sprints\tWoodsies\t14:00\t14:45", "Katy J Pearson\tThe Park\t14:00\t15:00", "Joy Crookes\tWoodsies\t15:00\t16:00"],
      sets: 3,
      stages: 2,
    },
    {
      name: "a comma grid under \"Saturday, 4 July\"",
      title: "Saturday, 4 July",
      grid: ["Saturday, 4 July", "A,Main,18:00,19:00", "B,Side,18:30,19:30"],
      sets: 2,
      stages: 2,
    },
  ]) {
    test(`${paste.name} is read under its title: no refusal, the title note once, no skipped-line notice, and the no-breaks line counts the sets checked`, async ({ page, guard }) => {
      const check = new CheckPage(page);
      await check.goto();
      const before = guard.writes.length;
      await check.replaceWith(paste.grid.join("\n"));
      await check.checkButton.click();

      // Every grid line read; the title is no skipped line, so neither the refusal nor the partial notice shows.
      await check.expectEveryLineRead(paste.sets, paste.stages);
      await expect(page.getByText(titleNote(paste.title), { exact: true }).filter({ visible: true }), "the title note, once on screen").toHaveCount(1);
      // The note sits above "Read n sets on m stages".
      const [note, read] = await Promise.all([page.getByText(titleNote(paste.title), { exact: true }).filter({ visible: true }).boundingBox(), check.readLine.boundingBox()]);
      expect(note?.y ?? Infinity, "the note comes before the read line").toBeLessThan(read?.y ?? 0);
      // No rule break here, and the no-breaks line says how many sets were checked: never the bare sentence.
      await expect(check.rulesSection).toContainText(`No rule breaks found among the ${paste.sets} sets checked, against the settings above.`);
      await expect(page.getByText("No rule breaks found against the settings above.", { exact: true }).filter({ visible: true })).toHaveCount(0);
      expect(guard.writes.slice(before), "requests other than GET while pasting and checking").toEqual([]);
    });
  }

  test("a first line with a clock time among its words is a skipped line, never a title: \"Doors 18:00\" over two comma rows", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.replaceWith(["Doors 18:00", "A,Main,18:00,19:00", "B,Side,18:30,19:30"].join("\n"));
    await check.checkButton.click();

    await expect(check.refusal).toHaveCount(0);
    await expect(check.skippedNotice.locator("p").first()).toHaveText("1 line skipped and not checked: line 1. The other 2 sets were checked.");
    await expect(page.getByText(/so it was read as a title\.$/).filter({ visible: true })).toHaveCount(0);
    await expect(check.readLine).toHaveText("Read 2 sets on 2 stages.");
    await expect(check.rulesSection).toContainText("No rule breaks found among the 2 sets checked, against the settings above.");
  });

  test("print media: after a titled paste the draft brief says the title line was left out, before what it read, on one page", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.replaceWith(["Glastonbury Sunday", "Sprints\tWoodsies\t14:00\t14:45", "Katy J Pearson\tThe Park\t14:00\t15:00", "Joy Crookes\tWoodsies\t15:00\t16:00"].join("\n"));
    await check.checkButton.click();
    await check.expectEveryLineRead(3, 2);
    // On screen the sheet's own copy of the note is not drawn (the results say it).
    await expect(page.locator("[data-brief-title-note]").filter({ visible: true })).toHaveCount(0);

    await page.emulateMedia({ media: "print" });
    const printed = page.locator("[data-brief-title-note]").filter({ visible: true });
    await expect(printed).toHaveCount(1);
    await expect(printed).toHaveText(titleNote("Glastonbury Sunday"));
    const sheetRead = page.getByText(/^Read 3 sets on 2 stages\. Rule breaks: 0\./).filter({ visible: true });
    await expect(sheetRead).toHaveCount(1);
    const [note, read] = await Promise.all([printed.boundingBox(), sheetRead.boundingBox()]);
    expect(note?.y ?? Infinity, "on paper the note comes before the read line").toBeLessThan(read?.y ?? 0);
    await expect(page.getByText("No rule breaks found among the 3 sets checked, against the settings above.", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    for (const format of ["Letter", "A4"] as const) expect(pdfPages(await page.pdf({ format, printBackground: true })), `${format} pages`).toBe(1);
  });
});
