import { DAYS, expectNoHorizontalScroll, luminance, pdfPages, requireSavedDays, rgbOf } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { SiteChrome } from "./pages/site-chrome";
import { TryAMove } from "./pages/try-a-move";

/** /brief: the one-page print view of a festival day, with the plan a visitor kept. */

const PLAN = "moves=gurriers~woodsies~0~1215";
/** The hero decision's own move, which also sets the brief's two changes side by side (its longest form). */
const CARD_PLAN = "moves=sprints~woodsies~0~1415";

test.describe("one-page brief", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  async function open(page: import("@playwright/test").Page, query: string) {
    await page.goto(`/brief?${query}`, { waitUntil: "domcontentloaded" });
    const article = page.getByRole("article");
    await expect(article).toBeVisible();
    await new SiteChrome(page).waitForHydration();
    return article;
  }

  test("renders the day: its index, its costliest clashes, and what the figures are", async ({ page, isPhone }) => {
    const article = await open(page, `preset=${DAYS.glastonbury.id}&day=0`);

    await expect(article.getByRole("heading", { level: 1 })).toHaveText("Glastonbury Festival 2025 Sunday: where the clashes fall");
    await expect(article).toContainText("Scored by this app from the published timetable. Glastonbury Festival 2025 does not use Clash Control.");
    await expect(article.getByRole("region", { name: "The day" })).toContainText(/Clash Budget Index \d+\.\d\./);
    await expect(article.getByRole("region", { name: "The day" })).toContainText("Taste overlap is scored for 36 of 39 sets; 3 have no usable Qloo signal and are not priced.");

    // Five clashes: a table on a desk, a list of cards on a phone (a table does not fit 390 px).
    const clashes = article.getByRole("region", { name: "The five costliest clashes" });
    if (isPhone) {
      const cards = clashes.getByRole("listitem");
      await expect(cards).toHaveCount(5);
      await expect(cards.first()).toContainText("Sprints and Katy J Pearson");
      await expect(cards.first()).toContainText("Hidden");
      await expect(cards.first().getByRole("term")).toHaveText(["Time shared", "Taste overlap", "Combined draw", "Share of the day’s cost"]);
    } else {
      const table = clashes.getByRole("table", { name: /^The five costliest clashes on this day, costliest first$/ });
      await expect(table.getByRole("columnheader")).toHaveText([/^#$/, /^Clash$/, /^Time shared/, /^Taste overlap/, /^Combined draw/, /^Share of the day’s cost/, /^Hidden$/]);
      await expect(table.getByRole("row")).toHaveCount(6); // header + five
      await expect(table.getByRole("row").nth(1)).toContainText("Sprints and Katy J Pearson");
      await expect(table.getByRole("row").nth(1)).toContainText("Hidden");
    }

    await expect(article.getByRole("region", { name: "Hidden clashes" })).toContainText("hidden clashes");
    await expect(article.getByRole("region", { name: "How to read this" })).toContainText("It measures taste, not attendance.");
    await expect(article.getByRole("region", { name: "How to read this" })).toContainText("a reading, not a verdict on the festival");
    // The footer lines: who made it, that Qloo and the festival do not endorse it, and the sources.
    await expect(article).toContainText("This is an independent hackathon entry, not endorsed by Qloo or Glastonbury Festival 2025.");
    await expect(article).toContainText(/Timetable sources: .+\./);
  });

  test("with a kept move, the plan comes first and matches the plan on the home page", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);
    await home.keepMove.click(); // the hero's own move, so the brief can set it beside the alternative
    await expect(move.kept).toHaveCount(1);
    const keptLine = (await move.kept.first().innerText()).replace(/\s+/g, " ");
    const [, from, to] = /(\d+\.\d) → (\d+\.\d)/.exec(keptLine) ?? [];

    await move.briefLink.click();
    await expect(page).toHaveURL(/\/brief\?preset=glastonbury-2025-sun&day=0&moves=sprints~woodsies~0~/);
    const plan = page.getByRole("region", { name: "Your plan" });
    await expect(plan).toBeVisible();
    await expect(plan).toContainText(new RegExp(`1 kept move: Clash Budget Index ${from} → ${to}, `));
    await expect(plan.getByRole("listitem").first()).toContainText("1. Sprints · Woodsies");
    await expect(plan).toContainText("Scored by the same measure the places are found with");
    // Side by side with the decision's alternative, and the costliest clashes after the plan.
    await expect(plan.getByRole("region", { name: "The two changes side by side" })).toBeVisible();
    await expect(page.getByRole("region", { name: "The five costliest clashes with these moves" }).getByRole("listitem")).toHaveCount(5);
    await expect(page.getByRole("region", { name: "The costliest clash on the published day, before these moves" })).toBeVisible();
  });

  test("a second day has its own brief, and says no moves are kept when none are", async ({ page }) => {
    const article = await open(page, `preset=${DAYS.riot.id}&day=0`);

    await expect(article.getByRole("heading", { level: 1 })).toHaveText("Riot Fest 2026 Sunday: where the clashes fall");
    await expect(article).toContainText("Riot Fest 2026 does not use Clash Control.");
    await expect(article).toContainText("This is an independent hackathon entry, not endorsed by Qloo or Riot Fest 2026.");
    await expect(article.getByRole("region", { name: "Hidden clashes" })).toContainText(/1 of this day’s ranked clashes is a hidden clash: /);
    await expect(article.getByRole("region", { name: "Tested moves" })).toContainText("No moves kept.");
    await expect(article.getByRole("region", { name: "Your plan" })).toHaveCount(0);
  });

  test("Back to the timetable returns to the same day", async ({ page }) => {
    await open(page, `preset=${DAYS.riot.id}&day=0`);
    await page.getByRole("link", { name: "Back to the timetable" }).click();
    await expect(page).toHaveURL(new RegExp(`/\\?preset=${DAYS.riot.id}$`));
    await expect(new HomePage(page).heading).toBeVisible();
  });

  test("Print this brief asks the browser to print", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __prints: number }).__prints = 0;
      window.print = () => {
        (window as unknown as { __prints: number }).__prints += 1;
      };
    });
    await open(page, `preset=${DAYS.glastonbury.id}&day=0`);
    await page.getByRole("button", { name: "Print this brief" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);
  });

  test("print media: site chrome is left out, and the sheet is dark ink on white even in the dark theme", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.emulateMedia({ colorScheme: "dark" });
    const article = await open(page, `preset=${DAYS.glastonbury.id}&day=0&${PLAN}`);
    expect(await new SiteChrome(page).appliedTheme()).toBe("dark");

    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("contentinfo")).toBeHidden();
    await expect(page.getByRole("button", { name: "Print this brief" })).toBeHidden();
    await expect(article).toBeVisible();
    await expect.poll(async () => luminance(await rgbOf(page, "body", "backgroundColor")), "paper is white").toBeGreaterThan(0.95);
    await expect.poll(async () => luminance(await rgbOf(page, "body", "color")), "ink is dark").toBeLessThan(0.2);
    await expect(article.getByRole("heading", { level: 1 })).toBeVisible();
  });

  for (const [name, plan] of [["a plan", PLAN], ["the hero's move and its alternative", CARD_PLAN], ["no plan", ""]] as const) {
    test(`print media: the brief with ${name} fits one Letter page and one A4 page`, async ({ page }) => {
      await open(page, `preset=${DAYS.glastonbury.id}&day=0${plan ? `&${plan}` : ""}`);
      await page.emulateMedia({ media: "print" });
      for (const format of ["Letter", "A4"] as const) {
        const pdf = await page.pdf({ format, printBackground: true });
        expect(pdf.subarray(0, 5).toString("latin1"), "a PDF").toBe("%PDF-");
        expect(pdfPages(pdf), `${format} pages`).toBe(1);
      }
    });
  }

  test("a bare /brief renders the first published day's brief, with a heading and no moves kept yet", async ({ page }) => {
    await page.goto("/brief", { waitUntil: "domcontentloaded" });
    const article = page.getByRole("article");
    await expect(article).toBeVisible();
    await expect(article.getByRole("heading", { level: 1 })).toHaveText("Glastonbury Festival 2025 Sunday: where the clashes fall");
    await expect(article.getByRole("region", { name: "Tested moves" })).toContainText("No moves kept yet.");
    await expect(article.getByRole("region", { name: "Your plan" })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: /This brief link is unavailable/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to the timetable" })).toBeVisible();
  });

  test("a day that does not exist says so in one line, under a heading, and offers the way back", async ({ page }) => {
    await page.goto(`/brief?preset=${DAYS.glastonbury.id}&day=9`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText("The day in this link has no timetable.");
    await expect(page.getByRole("link", { name: "Back to the timetable" })).toBeVisible();
  });

  test("the brief says what it is not for, has a sign-off, and no stage-fit row", async ({ page }) => {
    const article = await open(page, `preset=${DAYS.glastonbury.id}&day=0&${CARD_PLAN}`);
    await expect(article.getByRole("region", { name: "Your plan" }).getByRole("region", { name: "The two changes side by side" })).toBeVisible();
    await expect(article).not.toContainText("Stage-fit flags");
    await expect(article).toContainText("Do not use this to set fees, billing order or an artist’s worth, or for crowd capacity, safety or attendance.");
    await expect(article).toContainText("Nothing moves until the acts’ teams agree.");
    await expect(article).toContainText("Prepared by");
    await expect(article).toContainText("Reviewed by (head of programming)");
  });

  test("a mangled plan in the link is ignored: the day's brief still renders", async ({ page }) => {
    const article = await open(page, `preset=${DAYS.glastonbury.id}&day=0&moves=garbage`);
    await expect(article.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(article.getByRole("region", { name: "Your plan" })).toHaveCount(0);
    await expect(article.getByRole("region", { name: "The day" })).toBeVisible();
  });

  test("does not scroll sideways", async ({ page }) => {
    await open(page, `preset=${DAYS.glastonbury.id}&day=0&${PLAN}`);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("one-page brief, unknown day", () => {
  // The browser itself reports the API's 404 for a day that does not exist as a console error.
  test.use({ ignoreConsole: [/status of 404/] });

  test("a day the server does not have is an unavailable link, not a crash", async ({ page, guard }) => {
    await page.goto("/brief?preset=no-such-day&day=0", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert").filter({ hasText: /This brief link is unavailable/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the timetable" })).toBeVisible();
    expect(guard.consoleErrors).toHaveLength(1);
  });
});
