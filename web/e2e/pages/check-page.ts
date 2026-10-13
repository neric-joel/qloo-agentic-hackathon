import { expect, type Locator, type Page } from "@playwright/test";

import { SiteChrome } from "./site-chrome";

/** /check: paste a draft grid, read its rule breaks and shared time, and (optionally) compare audience overlap. */
export class CheckPage {
  readonly chrome: SiteChrome;

  readonly heading: Locator;
  readonly sampleButton: Locator;
  readonly templateButton: Locator;
  /** "Check a published day: <day>", shown when this server has a published (not invented) day. */
  readonly publishedButton: Locator;
  /** The one privacy sentence by the paste box. */
  readonly privacy: Locator;
  readonly checkButton: Locator;
  readonly clearButton: Locator;
  readonly tableView: Locator;
  readonly csvView: Locator;
  readonly grid: Locator;
  readonly table: Locator;

  readonly checked: Locator;
  readonly rulesSection: Locator;
  /** The rule settings (changeover, curfew, pair rules), a disclosure under the grid. */
  readonly rules: Locator;
  readonly priceSection: Locator;
  readonly priceButton: Locator;
  readonly sharedSection: Locator;
  readonly review: Locator;
  readonly printButton: Locator;
  /** What a screen reader hears after a check. */
  readonly announcement: Locator;

  constructor(readonly page: Page) {
    this.chrome = new SiteChrome(page);

    this.heading = page.getByRole("heading", { level: 1, name: "Check a draft grid against your rules" });
    this.sampleButton = page.getByRole("button", { name: "Check an invented sample" });
    this.templateButton = page.getByRole("button", { name: "Download a template" });
    this.publishedButton = page.getByRole("button", { name: /^Check a published day: / });
    this.privacy = page.getByText(/^Rule checks run in your browser; nothing is sent unless you press Compare audience overlap\./);
    this.checkButton = page.getByRole("button", { name: "Check the grid" });
    this.clearButton = page.getByRole("button", { name: "Clear", exact: true });
    this.tableView = page.getByRole("radiogroup", { name: "Show the draft grid as" }).locator("label").filter({ hasText: /^Table$/ });
    this.csvView = page.getByRole("radiogroup", { name: "Show the draft grid as" }).locator("label").filter({ hasText: /^CSV$/ });
    this.grid = page.getByRole("textbox", { name: "Draft grid" });
    this.table = page.getByRole("table", { name: "Draft grid as a table" });

    this.checked = page.getByRole("region", { name: "Checked" });
    this.rulesSection = page.getByRole("region", { name: /^Rule breaks \(\d+\)$/ });
    this.rules = page.getByRole("group").filter({ hasText: "Rules this check applies" });
    this.priceSection = page.getByRole("region", { name: /^Compare audience overlap/ });
    this.priceButton = this.priceSection.getByRole("button", { name: "Compare audience overlap" });
    this.sharedSection = page.getByRole("region", { name: /^Sets that share time \(\d+ pairs?\)$/ });
    this.review = page.getByRole("region", { name: "Draft review" });
    this.printButton = page.getByRole("button", { name: "Print draft brief" });
    this.announcement = page.getByRole("status").filter({ hasText: /Rule breaks: \d+/ });
  }

  async goto(): Promise<void> {
    await this.page.goto("/check", { waitUntil: "domcontentloaded" });
    await expect(this.heading).toBeVisible();
    await expect(this.checked).toBeVisible();
    // The sample's results are drawn by the server; its buttons work once the page has hydrated.
    await this.chrome.waitForHydration();
  }

  /** Shows the grid as editable text and replaces it. */
  async paste(csv: string): Promise<void> {
    await this.csvView.click();
    await expect(this.grid).toBeVisible();
    await this.grid.fill(csv);
  }

  /** The rule breaks as listed under the heading, one entry per break. */
  breakCards(): Locator {
    return this.rulesSection.getByRole("listitem").filter({ has: this.page.getByRole("heading", { level: 3 }) });
  }

  /** The grid rows the checker marked as breaking a rule. */
  flaggedRows(): Locator {
    return this.table.getByRole("row", { name: /^Rule break \d/ });
  }
}
