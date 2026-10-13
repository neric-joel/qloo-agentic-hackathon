import { expect, type Locator, type Page } from "@playwright/test";

import { literal } from "../helpers";

/** "Move a set and see what it costs", and "Keep two sets apart" under it. */
export class TryAMove {
  readonly section: Locator;
  readonly starters: Locator;
  readonly select: Locator;
  readonly card: Locator;
  readonly places: Locator;
  readonly keepButton: Locator;
  readonly plan: Locator;
  readonly planRegion: Locator;
  readonly kept: Locator;
  readonly undo: Locator;
  readonly startOver: Locator;
  readonly briefLink: Locator;
  readonly announcement: Locator;

  constructor(readonly page: Page) {
    this.section = page.getByRole("region", { name: "Move a set and see what it costs" });
    this.starters = this.section.getByRole("list", { name: "Start with" });
    this.select = this.section.getByRole("combobox", { name: /^(Or choose any set|Set to move)$/ });
    this.card = this.section.locator("[data-moves-card]");
    this.places = this.section.getByRole("list", { name: "Legal places" });
    this.keepButton = this.section.getByRole("button", { name: /^(Keep this move|Plan is full)$/ });
    this.plan = this.section.getByRole("group", { name: "Your tested moves" });
    this.planRegion = this.plan.getByRole("region", { name: "Your tested moves" });
    this.kept = this.plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem");
    this.undo = this.plan.getByRole("button", { name: "Undo last move" });
    this.startOver = this.plan.getByRole("button", { name: "Start over" });
    this.briefLink = this.plan.getByRole("link", { name: "Open as a one-page brief" });
    // The polite status line that says what just happened ("Plan: 2 kept moves. ...").
    this.announcement = this.section.getByRole("status").filter({ hasText: /\S/ });
  }

  /** The heading of the answer for the picked set: "Where Gurriers could go". */
  heading(act: string): Locator {
    return this.section.getByRole("heading", { level: 3, name: `Where ${act} could go` });
  }

  /** A set's row in the "Start with" list, by the act at its start (the partner is named after it). */
  starter(act: string): Locator {
    return this.starters.getByRole("button", { name: new RegExp(`^\\d{2}:\\d{2} ${literal(act)} `) });
  }

  /** Picks any set from the select, by the act's name (the option's label starts with its time). */
  async choose(act: string): Promise<void> {
    const option = this.select.locator("option").filter({ hasText: new RegExp(`^\\d{2}:\\d{2} ${literal(act)}( \\(.*\\))?$`) });
    await expect(option, `option for ${act}`).toHaveCount(1);
    await this.select.selectOption((await option.getAttribute("value")) as string);
    await expect(this.heading(act)).toBeVisible();
    await expect(this.places).toBeVisible();
  }

  /** The legal places as printed: stage, start, end, index and the change. */
  async placeLabels(): Promise<string[]> {
    return this.places.getByRole("button").evaluateAll((all) => all.map((button) => button.getAttribute("aria-label") ?? ""));
  }
}

export type Place = { stage: string; start: string; end: string; index: number; change: string };

/** Reads one place's accessible name: "Woodsies 12:45–13:45: Clash Budget Index 114.8, 1.9 lower". */
export function parsePlace(label: string): Place {
  const match = /^(.+?) (\d{2}:\d{2})–(\d{2}:\d{2}): Clash Budget Index (\d+\.\d)(?:, (.+))?$/.exec(label);
  if (!match) throw new Error(`Not a legal-place label: ${label}`);
  return { stage: match[1], start: match[2], end: match[3], index: Number(match[4]), change: match[5] ?? "" };
}

export function minutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}
