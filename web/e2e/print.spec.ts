import { DAYS, luminance, pdfPages, requireSavedDays, rgbOf } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { SiteChrome } from "./pages/site-chrome";

/**
 * Print media beyond the two sheets built for it (/brief and /check, covered in their own specs). The home page
 * and /method have no print palette of their own, so what they print follows the screen theme.
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
      // DEFECT (app): only /brief and /check carry a print palette (cool ink on white, whatever the theme).
      // The home page and /method print with the screen's colours, so under the dark theme their text is
      // near-white (rgb 236, 239, 242) on the page's dark ground. A browser prints without background graphics
      // by default, so the ground is dropped and the text is light grey on white paper, which cannot be read.
      // Repro: choose Dark in the theme control, open the print preview of / or /method (Ctrl+P), and read it
      // with "Background graphics" off. Emulated here with page.emulateMedia({ media: "print" }).
      test.fail(true, "The dark theme prints near-white text on the home page and /method (see comment)");
      if (name === "the home page") await requireSavedDays(page);
      await page.addInitScript(() => localStorage.setItem("theme", "dark"));
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await new SiteChrome(page).waitForHydration();
      if (name === "the home page") await new HomePage(page).waitUntilReady();
      await page.emulateMedia({ media: "print", colorScheme: "dark" });
      await expect.poll(async () => luminance(await rgbOf(page, "body", "color")), { timeout: 3_000 }).toBeLessThan(0.5);
    });
  }
});
