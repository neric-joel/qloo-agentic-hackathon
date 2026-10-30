import { expect, type Locator, type Page } from "@playwright/test";

import { SiteChrome } from "./site-chrome";

/** The printed draft brief's sign-off labels, the same three as the published-day brief's. */
export const DRAFT_SIGN_OFF = ["Prepared by", "Reviewed by (head of programming)", "Date"];

/** The printed draft brief's first line: its heading, then the print date (a grid with no day column names no day). */
export const DRAFT_HEADING = /^Draft grid check · printed \d{1,2} [A-Z][a-z]{2} \d{4}$/;

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

  // A real paste survives first contact.
  /** The Table view's paste target: a paste there lands in the CSV editor. */
  readonly pasteTarget: Locator;
  /** The pair rules, one per line ("Act A | Act B"), inside the rule settings. */
  readonly pairs: Locator;
  /** After a check that skipped lines: the notice that says which, and why, first in the results. */
  readonly skippedNotice: Locator;
  /** After a check: "Checked {n} sets on {s} stages in {ms} ms, in this browser." */
  readonly checkTime: Locator;
  /** The refusal of a grid that cannot be checked ("The grid was not checked." and its line messages). */
  readonly refusal: Locator;
  /** In the preview's box, in place of its bars, while the text does not read. */
  readonly previewUnavailable: Locator;
  /** Under the refusal's line messages, when the lines look separated by semicolons. */
  readonly separatorHint: Locator;
  /** In the printed draft brief, under its title: the skipped sentence. */
  readonly briefSkipped: Locator;

  /** After a check: "Read {n} sets on {s} stages", then what it says about locks (on screen; the sheet has its own). */
  readonly readLine: Locator;
  /** The printed draft brief's first line ("Draft grid check · printed {date}"), drawn in print only. */
  readonly draftHeading: Locator;
  /** The printed draft brief's sign-off block, drawn in print only. */
  readonly signOff: Locator;

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

    this.pasteTarget = page.locator("[data-paste-target]");
    this.pairs = page.getByRole("textbox", { name: "Pairs that must never overlap" });
    this.skippedNotice = page.locator("[data-skipped]");
    this.checkTime = page.locator("[data-check-time]");
    this.refusal = page.getByRole("alert").filter({ hasText: "The grid was not checked." });
    this.previewUnavailable = page.locator("[data-preview-unavailable]");
    this.separatorHint = page.locator("[data-separator-hint]");
    this.briefSkipped = page.locator("[data-brief-skipped]");

    // The results' own line, not the rail preview's "Read {n} sets on {s} stages. Rule breaks: ..." copy of the sheet.
    // ("stages?" is pinned to the whole word by the lookahead for "." or ";", so it cannot back off to "stage".)
    this.readLine = page.getByText(/^Read \d+ sets? on \d+ stages?(?=[.;])(?!\. Rule breaks)/).filter({ visible: true });
    // The rail's preview thumbnail holds a copy of each, never drawn; the one that prints is the visible one.
    this.draftHeading = page.locator("[data-draft-heading]").filter({ visible: true });
    this.signOff = page.locator("[data-sign-off]").filter({ visible: true });
  }

  /**
   * After a check that read every line: "Read {n} sets on {s} stages.", no refusal and no skipped line, so every line
   * of the paste was read.
   */
  async expectEveryLineRead(sets: number, stages: number): Promise<void> {
    await expect(this.refusal).toHaveCount(0);
    await expect(this.skippedNotice).toHaveCount(0);
    await expect(this.readLine).toHaveText(`Read ${sets} sets on ${stages} stages.`);
  }

  /**
   * In print media: the draft brief's heading shows once, above everything else on the sheet, and its sign-off shows
   * its three labels in order, each with a blank line to write on. On screen neither is drawn.
   */
  async expectDraftHeadingAndSignOff(): Promise<void> {
    await expect(this.draftHeading).toHaveCount(1);
    await expect(this.draftHeading).toHaveText(DRAFT_HEADING);
    await expect(this.signOff).toHaveCount(1);
    await expect(this.signOff.getByRole("term")).toHaveText(DRAFT_SIGN_OFF);
    await expect(this.signOff.getByRole("definition")).toHaveCount(DRAFT_SIGN_OFF.length);
    const [top, bottom] = await Promise.all([this.draftHeading.boundingBox(), this.signOff.boundingBox()]);
    expect(top?.y ?? Infinity, "the heading is above the sign-off").toBeLessThan(bottom?.y ?? 0);
  }

  /** The gutter's mark beside a line the last check skipped ("skipped 4"), in the CSV view. */
  skippedMark(line: number): Locator {
    return this.page.locator(`[data-skipped-line="${line}"]`);
  }

  /** Clears the grid and the rules, and puts this text in the CSV editor. */
  async replaceWith(csv: string): Promise<void> {
    await this.clearButton.click();
    await this.paste(csv);
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
