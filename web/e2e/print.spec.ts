import { DAYS, luminance, pdfPages, requireSavedDays, rgbOf } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { SiteChrome } from "./pages/site-chrome";

/**
 * Print media beyond the two sheets built for it (/brief and /check, covered in their own specs): the home page
 * and /method print dark ink on white paper in either theme.
 */

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
      // Was defect D3 (round 31): / and /method printed the screen's dark-theme colours, near-white text that a
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
