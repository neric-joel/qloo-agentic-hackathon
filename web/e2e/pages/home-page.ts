import { isDeepStrictEqual } from "node:util";

import { expect, type Locator, type Page } from "@playwright/test";

import { READY_TIMEOUT, startsWith } from "../helpers";
import { SiteChrome } from "./site-chrome";

/**
 * The home page: the hero (the festival day, the day drawn as a graph with its toggle and key, and the decision
 * group beside it), the section nav, the index card under the hero, the board, and the sections under it.
 */
export class HomePage {
  readonly chrome: SiteChrome;

  // The hero.
  readonly heading: Locator;
  readonly hero: Locator;
  readonly lede: Locator;
  /** "Festival day": one option per saved day, labelled with the festival ("Glastonbury 2025"). */
  readonly dayPicker: Locator;
  /** The line under the picker: the day, the kind of timetable, the saved reading's date, the proof line. */
  readonly dateline: Locator;
  /** "Drawing shows": the day as published (on the invented day "Invented timetable"), or with the move. */
  readonly viewToggle: Locator;
  /** The day drawn as a graph: a group named for what it shows ("... drawn with ..." or "... as published ..."). */
  readonly graph: Locator;
  /** The key under the drawing ("Lines: the 15 costliest of ..."). */
  readonly graphKey: Locator;
  /** The decision group: the move lead, the readout, the side effects, the taste line, who scored it, Keep. */
  readonly group: Locator;
  readonly moveLead: Locator;
  readonly readout: Locator;
  readonly sideEffects: Locator;
  readonly tasteLine: Locator;
  readonly attribution: Locator;
  /** "Keep this move", which reads "Kept in your plan" in the same cell once the plan holds the move. */
  readonly keepMove: Locator;
  /** The room under Keep that its confirmation fills (always on the page while there is a move). */
  readonly keptSlot: Locator;
  /** "Kept in your plan." with its "See your plan" link, in its slot under Keep. */
  readonly keptNotice: Locator;
  readonly seeYourPlan: Locator;
  /** What the group says to a screen reader after a press ("Testing Sprints at 14:15.", "Already in your plan."). */
  readonly groupAnnouncement: Locator;
  readonly pasteLink: Locator;

  // The index card under the hero, in the section on what taste changes.
  /** The card itself: the index, its scale, Show the working (and below 1024 px every line and action). */
  readonly indexCard: Locator;
  /** From 1024 px, beside the card: its hidden-clash line and its change line, each closed by its action. */
  readonly indexBeside: Locator;
  /**
   * The index card with, from 1024 px, its two lines beside it: where its own actions are at any width. Below
   * 1024 px it is the card alone (the lines beside it are not drawn there).
   */
  readonly details: Locator;
  readonly indexBlock: Locator;
  readonly showWorking: Locator;
  readonly working: Locator;
  /** What the index card says to a screen reader after one of its own presses. */
  readonly detailsAnnouncement: Locator;

  // The rail.
  readonly rail: Locator;

  // The board.
  readonly boardHeading: Locator;
  /**
   * Round 37 (AO1): the board's grid sits in one disclosure, closed on arrival, whose summary says what it shows
   * ("Show 39 sets on 5 stages"). The legend, the coverage line, the caption and the clash list stay outside it.
   */
  readonly boardFold: Locator;
  readonly boardFoldSummary: Locator;
  /** The caption under the coverage row, read with no click: "Lines join the 10 costliest clashes. Board numbers ...". */
  readonly boardCaption: Locator;
  /** The grid itself, inside the fold: shown only once the fold is open (`openBoard`). */
  readonly board: Locator;
  readonly costliest: Locator;
  readonly clashLinks: Locator;
  readonly trace: Locator;

  // The sections, in page order.
  readonly whatQloo: Locator;
  readonly whyThisMatters: Locator;
  readonly hiddenWall: Locator;
  readonly tryAMove: Locator;
  /** "Keep two sets apart" sits in a closed disclosure under Try a move; its summary opens it. */
  readonly keepApartSummary: Locator;
  readonly keepApart: Locator;
  readonly agent: Locator;
  /** The section nav's link to the agent section: "Agent runs" while recorded runs are shown. */
  readonly agentJump: Locator;
  /**
   * "See that run": on a day whose runs sent no Qloo request, it follows the runs line when another published day
   * holds a run that asked Qloo while it was recorded, and opens that day's agent section.
   */
  readonly agentPointer: Locator;
  readonly sources: Locator;
  /** The kept plan in "Try a move" (`#your-plan`), where "See your plan" lands. */
  readonly plan: Locator;

  readonly drawer: Locator;

  constructor(readonly page: Page) {
    this.chrome = new SiteChrome(page);

    this.heading = page.getByRole("heading", { level: 1, name: "Which clash is worth moving?" });
    this.hero = page.getByRole("region", { name: "Which clash is worth moving?" });
    this.lede = this.hero.getByText(/^For heads of programming: /);
    this.dayPicker = page.getByRole("radiogroup", { name: "Festival day" });
    this.dateline = this.hero.locator("[data-dateline]");
    this.viewToggle = this.hero.getByRole("radiogroup", { name: "Drawing shows" });
    this.graph = this.hero.locator("[data-day-graph]");
    this.graphKey = this.hero.locator("[data-day-graph-key]");
    this.group = this.hero.locator("[data-hero-group]");
    this.moveLead = this.group.getByRole("heading", { level: 2 });
    this.readout = this.group.locator("[data-readout]");
    this.sideEffects = this.group.locator("[data-side-effects]");
    this.tasteLine = this.group.locator("[data-taste-line]");
    this.attribution = this.group.locator("[data-attribution]");
    this.keepMove = this.group.getByRole("button", { name: /^(Keep this move|Kept in your plan)$/ });
    this.keptSlot = this.group.locator("[data-kept-notice]");
    this.keptNotice = this.keptSlot.filter({ hasText: "Kept in your plan." });
    this.seeYourPlan = this.keptNotice.getByRole("link", { name: "See your plan" });
    // The group's own spoken line is its last status region (the kept notice's slot comes before it).
    this.groupAnnouncement = this.group.getByRole("status").last();
    this.pasteLink = this.hero.getByRole("link", { name: "Paste your own draft grid" });

    this.indexCard = page.locator("[data-decision-details]");
    this.indexBeside = page.locator("[data-index-beside]");
    this.details = this.indexCard.or(this.indexBeside.filter({ visible: true }));
    this.indexBlock = this.details.locator("[data-index-block]");
    this.showWorking = this.details.getByRole("button", { name: "Show the working" });
    this.working = this.details.getByRole("region", { name: "Show the working" });
    this.detailsAnnouncement = this.details.getByRole("status").last();

    this.rail = page.getByRole("navigation", { name: "On this page" });

    this.boardHeading = page.getByRole("heading", { level: 2, name: /^Where the clashes fall/ });
    this.boardFold = page.locator("details[data-board-fold]");
    this.boardFoldSummary = this.boardFold.locator(":scope > summary");
    this.boardCaption = page.locator("[data-board-caption]");
    this.board = page.getByRole("group", { name: /timetable\. Use the arrow keys to move between sets\.$/ });
    this.costliest = page.getByRole("region", { name: /^The \d+ costliest clashes$/ });
    this.clashLinks = page.getByRole("list", { name: "Clash links" });
    this.trace = page.getByRole("button", { name: /^How Qloo was used/ }).first();

    // Named by its heading, which changes with what taste does to the pair; its id is the nav's target.
    this.whatQloo = page.locator("#what-qloo-changes");
    this.whyThisMatters = page.getByRole("region", { name: "Who has complained, and what nobody has tested" });
    this.hiddenWall = page.getByRole("region", { name: /^Hidden clashes: / });
    this.tryAMove = page.getByRole("region", { name: "Move a set and see what it costs" });
    this.keepApartSummary = page.locator("summary").filter({ hasText: /^Keep two sets apart: moves that end one overlap$/ });
    this.keepApart = page.getByRole("region", { name: "Keep two sets apart" });
    // While the live agent is off the section is named for what it holds; with it on, it invites a question.
    this.agent = page.getByRole("region", { name: /^(Recorded agent runs|The agent|Or describe the change in plain words)$/ });
    this.agentJump = this.rail.getByRole("link", { name: "Agent runs", exact: true });
    this.agentPointer = this.agent.getByRole("link", { name: "See that run", exact: true });
    this.sources = page.getByRole("region", { name: "Where the numbers come from" });

    this.plan = page.getByRole("group", { name: "Your tested moves" });

    this.drawer = page.getByRole("dialog");
  }

  /** Opens the home page, on a named day when given, and waits until the interactive page is drawn. */
  async goto(day?: string): Promise<void> {
    await this.page.goto(day ? `/?preset=${day}` : "/", { waitUntil: "domcontentloaded" });
    await this.waitUntilReady();
  }

  /**
   * The server draws the hero's final frame at once (its Keep in place but not pressable); the interactive page
   * replaces it when the day has arrived in the browser. The board heading only exists in the interactive page,
   * so once it shows every control on the page has its handler. The decision group then waits for the day's
   * decision (a skeleton holds its room until it comes), and the section on what taste changes takes its
   * heading from the day's three rankings (a separate request); waiting for both means the page has stopped
   * growing, so scroll positions and tab order are settled.
   *
   * Those arrivals (and hydration) wait on the dev server, which under four workers can take longer than the
   * default 10 s expect timeout, so each step waits up to `READY_TIMEOUT` for its element; it returns as soon as
   * the element shows.
   */
  async waitUntilReady(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(this.boardHeading).toBeVisible({ timeout: READY_TIMEOUT });
    // Round 37: the grid is behind the board's closed disclosure, so readiness is the interactive board's caption
    // (the server's frame draws the fold over a skeleton and no caption) and its one fold, closed.
    await expect(this.boardCaption).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(this.boardFold).toHaveCount(1, { timeout: READY_TIMEOUT });
    await expect(this.group).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(this.rail.getByRole("link").first()).toHaveText(/What (Qloo|taste) changes/, { timeout: READY_TIMEOUT });
    await expect(this.whatQloo.getByRole("heading", { level: 2 })).toHaveText(/^Adding taste (moves|leaves) this pair/, {
      timeout: READY_TIMEOUT,
    });
    // Round 37: and the webfont. On a dev server busy with four workers it can land seconds after the page is drawn,
    // and its swap from the fallback face changes text widths by up to 4%, so a spec that compares two states' boxes
    // or a name plate's half-width rule would compare one face with the other.
    await this.page.evaluate(() => document.fonts.ready.then(() => undefined));
  }

  /**
   * The hero's Keep moves focus to "See your plan" only when the plan holds the move within 2 s of the press
   * (hero-decision.tsx: "A plan that took longer than two seconds to hold the move is no answer to this press"). On a
   * dev server busy with four workers the what-if answer alone has taken 1.7 s, so a spec that asserts that focus
   * first has the server answer the hero move's what-if itself (the same body the page sends, the engine's own route,
   * no Qloo), and the page's press is then answered at once with that same answer. Nothing else about the press
   * changes. Returns how many presses were answered this way; a spec checks it, so a change in the body the page
   * sends shows up as a failure here and not as a slow test.
   */
  async answerKeepAtOnce(day: string): Promise<() => number> {
    const preset = (await (await this.page.request.get(`/api/presets/${day}`)).json()) as {
      decision?: { move?: { act_id: string; stage_id: string; day: number; start: string } | null };
    };
    const move = preset.decision?.move;
    expect(move, `${day}: the day's decision has a move`).toBeTruthy();
    const body = { moves: [{ act: move?.act_id, stage_id: move?.stage_id, day: move?.day, start: move?.start }], act: null, limit: 8 };
    const primed = await this.page.request.post(`/api/presets/${day}/whatif`, { data: body });
    expect(primed.status(), `${day}: the server answers the hero move's what-if`).toBe(200);
    const answer = await primed.body();
    let answered = 0;
    await this.page.route(
      (url) => url.pathname === `/api/presets/${day}/whatif`,
      async (route) => {
        const request = route.request();
        let same = false;
        try {
          same = request.method() === "POST" && isDeepStrictEqual(JSON.parse(request.postData() ?? "null"), body);
        } catch {
          same = false;
        }
        if (!same) return route.fallback();
        answered += 1;
        return route.fulfill({ status: 200, contentType: "application/json", body: answer });
      },
    );
    return () => answered;
  }

  /** Whether the board's disclosure is open. */
  async boardOpen(): Promise<boolean> {
    return this.boardFold.evaluate((element) => (element as HTMLDetailsElement).open);
  }

  /**
   * Opens the board's disclosure as a visitor does, by pressing its summary, unless it is open, and waits until the
   * grid shows. Every spec that reads the board's tiles, badges or grid calls this first (round 37, AO1).
   */
  async openBoard(): Promise<void> {
    await expect(this.boardCaption).toBeVisible({ timeout: READY_TIMEOUT });
    if (!(await this.boardOpen())) await this.boardFoldSummary.click();
    await expect(this.boardFold).toHaveAttribute("open", "");
    await expect(this.board).toBeVisible({ timeout: READY_TIMEOUT });
  }

  /** Opens the "Keep two sets apart" disclosure as a visitor does, by pressing its summary, unless it is open. */
  async openKeepApart(): Promise<void> {
    await expect(this.keepApartSummary).toBeVisible();
    if (!(await this.keepApart.isVisible())) await this.keepApartSummary.click();
    await expect(this.keepApart).toBeVisible();
  }

  /** Chooses a festival day in the hero's picker, as a visitor does: by pressing its label ("Riot Fest 2026"). */
  async chooseDay(festival: string): Promise<void> {
    await this.dayPicker.locator("label").filter({ hasText: festival }).click();
  }

  /** Chooses what the drawing shows, as a visitor does: by pressing the option's label. */
  async chooseView(label: string | RegExp): Promise<void> {
    await this.viewToggle.locator("label").filter({ hasText: label }).click();
  }

  /** The board's heading as text, e.g. "Where the clashes fall: 5 stages, 39 sets". */
  async boardTitle(): Promise<string> {
    return (await this.boardHeading.innerText()).replace(/\s+/g, " ").trim();
  }

  /** The drawing's accessible name: the title that names its view. */
  async graphTitle(): Promise<string> {
    return (await this.graph.getAttribute("aria-label")) ?? (await this.graph.evaluate((element) => {
      const id = element.getAttribute("aria-labelledby");
      return (id ? document.getElementById(id)?.textContent : "") ?? "";
    }));
  }

  /** The drawing's lines as drawn at this width: one button per line, in the layout on show. */
  graphLines(): Locator {
    return this.graph.locator("[data-hit]").filter({ visible: true });
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

  /** The day's published Clash Budget Index: the first figure of the index card's "A to B." */
  async publishedIndex(): Promise<string> {
    const figures = await this.indexBlock.getByText(/^\d+\.\d to \d+\.\d\.$/).innerText();
    return /^(\d+\.\d)/.exec(figures)?.[1] ?? "";
  }

  /** The index card's two figures: the published index and the index with the move. */
  async indexFigures(): Promise<{ before: string; after: string }> {
    const figures = await this.indexBlock.getByText(/^\d+\.\d to \d+\.\d\.$/).innerText();
    const [before = "", after = ""] = figures.match(/\d+\.\d/g) ?? [];
    return { before, after };
  }
}
