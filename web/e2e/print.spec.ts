import { DAYS, luminance, MESSY_GRID, MESSY_NO_BREAKS, MESSY_SKIPPED, pdfPages, requireSavedDays, rgbOf } from "./helpers";
import { expect, test } from "./fixtures";
import { CheckPage } from "./pages/check-page";
import { HomePage } from "./pages/home-page";
import { SiteChrome } from "./pages/site-chrome";

/**
 * Print media beyond the two sheets built for it (/brief and /check, covered in their own specs): the home page
 * and /method print dark ink on white paper in either theme; and /check's draft brief after a check that skipped a
 * line says so on its one page.
 */

test.describe("print media for a check that skipped a line", () => {
  test("the printed draft brief says which line was skipped, says what the no-breaks line counted, and fits one Letter page and one A4 page", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await check.replaceWith(MESSY_GRID);
    await check.checkButton.click();
    await expect(check.skippedNotice.locator("p").first()).toHaveText(MESSY_SKIPPED);

    await page.emulateMedia({ media: "print" });
    // The skipped sentence prints under the brief's title; the on-screen notice does not print.
    const printed = check.briefSkipped.filter({ visible: true });
    await expect(printed).toHaveCount(1);
    await expect(printed).toHaveText(MESSY_SKIPPED);
    await expect(check.skippedNotice).toBeHidden();
    // Only the brief prints, so the no-breaks line on the page in print is the brief's, with what it counted.
    await expect(page.getByText(MESSY_NO_BREAKS, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("No rule breaks found against the settings above.", { exact: true }).filter({ visible: true })).toHaveCount(0);
    // The sheet opens with "Draft grid check" and the print date, and closes with the three sign-off labels,
    // still on one page.
    await check.expectDraftHeadingAndSignOff();
    for (const format of ["Letter", "A4"] as const) expect(pdfPages(await page.pdf({ format, printBackground: true })), `${format} pages`).toBe(1);
  });

  test("on screen the draft brief's heading and sign-off are not drawn: they are on paper only", async ({ page }) => {
    const check = new CheckPage(page);
    await check.goto();
    await expect(check.draftHeading).toHaveCount(0);
    await expect(check.signOff).toHaveCount(0);
    await page.emulateMedia({ media: "print" });
    await check.expectDraftHeadingAndSignOff();
  });
});

test.describe("print media on the home page and /method", () => {
  for (const [name, url] of [
    ["the home page", `/?preset=${DAYS.glastonbury.id}`],
    ["/method", "/method"],
  ] as const) {
    test(`${name} prints in the light theme as dark ink, in more than one page`, async ({ page }) => {
      if (name === "the home page") await requireSavedDays(page);
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await new SiteChrome(page).waitForHydration();
      if (name === "the home page") await new HomePage(page).waitUntilReady();
      await page.emulateMedia({ media: "print", colorScheme: "light" });
      await expect.poll(async () => luminance(await rgbOf(page, "body", "color"))).toBeLessThan(0.3);
      const pdf = await page.pdf({ format: "Letter" });
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(pdfPages(pdf)).toBeGreaterThan(1);
    });

    test(`${name} prints dark ink on paper in the dark theme too`, async ({ page }) => {
      // Was defect D3: / and /method printed the screen's dark-theme colours, near-white text that a
      // browser prints on white paper. They now print dark ink on white whatever the theme.
      if (name === "the home page") await requireSavedDays(page);
      await page.addInitScript(() => localStorage.setItem("theme", "dark"));
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await new SiteChrome(page).waitForHydration();
      if (name === "the home page") await new HomePage(page).waitUntilReady();
      await page.emulateMedia({ media: "print", colorScheme: "dark" });
      await expect.poll(async () => luminance(await rgbOf(page, "body", "color")), { timeout: 3_000 }).toBeLessThan(0.3);
      await expect.poll(async () => luminance(await rgbOf(page, "body", "backgroundColor")), "paper is white").toBeGreaterThan(0.95);
      if (name === "/method") {
        // /method prints without its site header and footer.
        await expect(page.getByRole("banner")).toBeHidden();
        await expect(page.getByRole("contentinfo")).toBeHidden();
      }
    });
  }
});
