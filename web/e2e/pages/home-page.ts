import { expect, type Locator, type Page } from "@playwright/test";

import { startsWith } from "../helpers";
import { SiteChrome } from "./site-chrome";

/** The home page: the hero decision, the section rail, the board, and the sections under it. */
export class HomePage {
  readonly chrome: SiteChrome;

  // The hero.
  readonly heading: Locator;
  readonly hero: Locator;
  readonly card: Locator;
  readonly cardHeading: Locator;
  readonly openMove: Locator;
  readonly showWorking: Locator;
  readonly working: Locator;
  readonly pasteLink: Locator;

  // The rail.
  readonly rail: Locator;

  // The board.
  readonly boardHeading: Locator;
  readonly board: Locator;
  readonly dayPicker: Locator;
  readonly costliest: Locator;
  readonly clashLinks: Locator;
  readonly trace: Locator;

  // The sections, in page order.
  readonly whatQloo: Locator;
  readonly whyThisMatters: Locator;
  readonly hiddenWall: Locator;
  readonly tryAMove: Locator;
  readonly keepApart: Locator;
  readonly agent: Locator;
  readonly sources: Locator;

  readonly drawer: Locator;

  constructor(readonly page: Page) {
    this.chrome = new SiteChrome(page);

    this.heading = page.getByRole("heading", { level: 1, name: "Which clash is worth moving?" });
    this.hero = page.getByRole("region", { name: "Which clash is worth moving?" });
    // The card is the one region in the hero whose name ends in the minutes it shares.
    this.card = this.hero.getByRole("region", { name: /minutes? shared$/ });
    this.cardHeading = this.card.getByRole("heading", { level: 2 });
    // "Open this move" is drawn twice (one per width) and only one is displayed, so this finds one.
    this.openMove = this.card.getByRole("button", { name: "Open this move" });
    this.showWorking = this.card.getByRole("button", { name: "Show the working" });
    this.working = this.card.getByRole("region", { name: "Show the working" });
    this.pasteLink = this.hero.getByRole("link", { name: "Paste your own draft grid" });

    this.rail = page.getByRole("navigation", { name: "On this page" });

    this.boardHeading = page.getByRole("heading", { level: 2, name: /^Where the clash budget goes/ });
    this.board = page.getByRole("group", { name: /timetable\. Use the arrow keys to move between sets\.$/ });
    this.dayPicker = page.getByRole("radiogroup", { name: "Festival day" });
    this.costliest = page.getByRole("region", { name: /^The \d+ costliest clashes$/ });
    this.clashLinks = page.getByRole("list", { name: "Clash links" });
    this.trace = page.getByRole("button", { name: /^How Qloo was used/ }).first();

    this.whatQloo = page.getByRole("region", { name: /^Same \d+-minute clash/ });
    this.whyThisMatters = page.getByRole("region", { name: "Who has complained, and what nobody has tested" });
    this.hiddenWall = page.getByRole("region", { name: /^Hidden clashes: / });
    this.tryAMove = page.getByRole("region", { name: "Move a set and see what it costs" });
    this.keepApart = page.getByRole("region", { name: "Keep two sets apart" });
    this.agent = page.getByRole("region", { name: "Or describe the change in plain words" });
    this.sources = page.getByRole("region", { name: "Where the numbers come from" });

    this.drawer = page.getByRole("dialog");
  }

  /** Opens the home page, on a named day when given, and waits until the interactive board is drawn. */
  async goto(day?: string): Promise<void> {
    await this.page.goto(day ? `/?preset=${day}` : "/", { waitUntil: "domcontentloaded" });
    await this.waitUntilReady();
  }

  /**
   * The server draws the pitch and a summary at once; the interactive page replaces them when the day
   * has arrived in the browser. The board heading only exists in the interactive page, so once it shows
   * every button on the page has its handler. The rail's first link, "What Qloo changes", and the card's
   * pointer to it only appear when the day's three rankings have arrived (a separate request); waiting for
   * it means the page has stopped growing, so scroll positions and tab order are settled.
   */
  async waitUntilReady(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.boardHeading).toBeVisible();
    await expect(this.board).toBeVisible();
    await expect(this.rail.getByRole("link").first()).toHaveText(/What (Qloo|taste) changes/);
  }

  /** Chooses a festival day in the picker above the board, as a visitor does: by pressing its label. */
  async chooseDay(title: string): Promise<void> {
    await this.dayPicker.locator("label").filter({ hasText: title }).click();
  }

  /** The board's heading as text, e.g. "Where the clash budget goes: 5 stages, 39 sets". */
  async boardTitle(): Promise<string> {
    return (await this.boardHeading.innerText()).replace(/\s+/g, " ").trim();
  }

  /** A set's tile on the board, by the act's name. */
  tile(act: string): Locator {
    return this.board.getByRole("button", { name: startsWith(`${act} ,`) });
  }

  /** A row of the costliest-clashes list (or its full list under it), by the two acts' names. */
  clashRow(first: string, second: string): Locator {
    return this.clashLinks.getByRole("button", { name: new RegExp(`${first}.*${second}`) }).first();
  }

  /** A link in the section rail, by its label. */
  railLink(label: string | RegExp): Locator {
    return this.rail.getByRole("link", { name: label });
  }
}
