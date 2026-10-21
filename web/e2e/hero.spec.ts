import type { Locator } from "@playwright/test";

import { DAYS, HONESTY, literal, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { TryAMove } from "./pages/try-a-move";

/**
 * The hero: the day drawn as a graph beside one decision group (the move, its answer, what else it changes, the
 * pair's taste rank with its qualifier, who scored it) and "Keep this move", which keeps it in your plan in place.
 * The index, its scale and the working sit in the index card under the hero.
 */

/** The side-effect line of each published day's move, from the published times (DECISION.md 5.2, row 8). */
const SIDE_EFFECTS = {
  [DAYS.glastonbury.id]: "New 15 min overlap with Joy Crookes. Shortens 3 other overlaps by 15 min.",
  [DAYS.riot.id]: "Ends the 5 min overlap with Twin Peaks. No other overlap gets longer.",
} as const;

/**
 * The hero's boxes, in page pixels (scroll does not change them): the pitch, the picker, the dateline, the toggle,
 * the drawing, the decision group's lines, the filled action's place, the kept notice's room, the paste, the key
 * and the section nav. The drawing is the layout on show; the filled action is the group's first filled button
 * (Keep this move, or Add to your plan in its place while the offer is open).
 */
type HeroBox = { left: number; top: number; width: number; bottom: number };
async function heroBoxes(page: import("@playwright/test").Page): Promise<Record<string, HeroBox | null>> {
  return page.evaluate(() => {
    const box = (element: Element | null | undefined) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top + window.scrollY, width: rect.width, bottom: rect.bottom + window.scrollY };
    };
    const shown = (element: Element) => getComputedStyle(element).display !== "none" && element.getClientRects().length > 0;
    const group = document.querySelector("[data-hero-group]");
    const h1 = document.getElementById("pitch-heading");
    return {
      h1: box(h1),
      lede: box(h1?.nextElementSibling),
      picker: box(document.querySelector('[role="radiogroup"][aria-label="Festival day"]')),
      dateline: box(document.querySelector("[data-dateline]")),
      toggle: box(document.querySelector('[role="radiogroup"][aria-label="Drawing shows"]')),
      drawing: box([...document.querySelectorAll("[data-day-graph] > [data-layout]")].find(shown)),
      readout: box(document.querySelector("[data-readout]")),
      side: box(document.querySelector("[data-side-effects]")),
      taste: box(document.querySelector("[data-taste-line]")),
      attribution: box(document.querySelector("[data-attribution]")),
      keep: box(group ? [...group.querySelectorAll('button[data-variant="default"]')].find(shown) : null),
      slot: box(group?.querySelector("[data-kept-notice]")),
      paste: box(group ? [...group.querySelectorAll("a")].find((link) => /Paste your own draft grid/.test(link.textContent ?? "")) : null),
      key: box(document.querySelector("[data-day-graph-key]")),
      nav: box(document.querySelector('nav[aria-label="On this page"]')),
    };
  });
}

/** True when every locator starts below the one before it in the document (DOM order). */
async function inDomOrder(parts: Locator[]): Promise<boolean> {
  const handles = await Promise.all(parts.map((part) => part.elementHandle()));
  return handles[0]!.evaluate((_, rest) => {
    const all = rest as Element[];
    return all.every((element, i) => i === 0 || Boolean(all[i - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
  }, handles);
}

test.describe("hero decision", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("the first screen holds the move, its answer, what else it changes, and the one filled action", async ({ page, isPhone }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    // The group reads in one order at every width: the move lead, the readout, the side effects, the taste line,
    // who scored it, Keep this move, the room its confirmation fills, then the paste.
    expect(
      await inDomOrder([home.moveLead, home.readout, home.sideEffects, home.tasteLine, home.attribution, home.keepMove, home.keptSlot, home.pasteLink]),
      "move lead, readout, side effects, taste line, attribution, Keep, kept slot, paste",
    ).toBe(true);
    await expect(home.moveLead).toHaveText("Sprints 15 minutes later");
    // The answer names the partner; the arrow is read as "to".
    await expect(home.readout).toHaveText(/^45 →\s+to 30 min shared with Katy J Pearson$/);
    await expect(home.readout.getByText("to", { exact: true })).toHaveClass(/sr-only/);
    // What else the move changes, every clause naming the overlap.
    await expect(home.sideEffects).toHaveText(SIDE_EFFECTS[DAYS.glastonbury.id]);
    // The taste rank with its qualifier beside the number and its Derived stamp, in one element.
    await expect(home.tasteLine).toHaveText(/^Taste overlap: \d+ of 100 on this bill \(a rank, not attendance\)\s*(Source:\s*)?Derived$/);
    await expect(home.tasteLine.getByText("Derived")).toBeVisible();
    // The rank is the drawing's own: the chosen clash's line names the same taste overlap rank.
    const taste = /Taste overlap: (\d+) of 100/.exec(await home.tasteLine.innerText())?.[1];
    await expect(home.graph.locator('[data-hit][aria-label*="Sprints × Katy J Pearson"]').first()).toHaveAttribute("aria-label", new RegExp(`Taste overlap rank ${taste} of 100 on this bill \\(a rank, not attendance\\)`));
    await expect(home.attribution).toHaveText("Selected and scored by this app’s index. A reading, not a verdict.");
    await expect(home.keepMove).toHaveAccessibleName("Keep this move");
    await expect(home.keepMove).toBeEnabled();

    // All of it is on the first screen, Keep included.
    for (const part of [home.readout, home.sideEffects, home.tasteLine, home.attribution, home.keepMove]) await expect(part).toBeInViewport({ ratio: 1 });
    if (!isPhone) await expect(home.moveLead).toBeInViewport();

    // The toggle names the drawing, and the drawing's title names its view.
    await expect(home.viewToggle.getByRole("radio")).toHaveCount(2);
    await expect(home.viewToggle.getByRole("radio", { name: "As published" })).not.toBeChecked();
    await expect(home.viewToggle.getByRole("radio", { name: "Sprints 15 min later" })).toBeChecked();
    await expect(home.graph).toHaveAccessibleName(`${DAYS.glastonbury.title}, drawn with Sprints 15 min later: 39 sets on 5 stages`);
  });

  test("the pitch offers a paste of the programmer's own grid", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    // The hero's old microcopy is gone (the check page states its own privacy rule).
    await expect(home.hero).not.toContainText("About a minute.");
    await home.pasteLink.click();
    await expect(page).toHaveURL(/\/check$/);
    await expect(page.getByRole("heading", { level: 1, name: "Check a draft grid against your rules" })).toBeVisible();
  });

  test("\"What Qloo changes\" in the section nav leads to the hero's pair ranked three ways, with its limit", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.railLink("What Qloo changes").click();
    await expect(page).toHaveURL(/#what-qloo-changes$/);
    await expect(home.whatQloo).toBeInViewport();
    await expect(home.whatQloo.getByRole("heading", { level: 2 })).toHaveText("Adding taste moves this pair from #18 to #1");
    await expect(home.whatQloo).toContainText("Sprints × Katy J Pearson, 45 min shared, ranked three ways");
    await expect(home.whatQloo).toContainText("Time alone");
    await expect(home.whatQloo).toContainText("+ taste overlap from Qloo data");
    await expect(home.whatQloo).toContainText("This does not prove #1 is the right clash to move.");
  });

  test("Keep this move keeps the hero's move in place: \"Kept in your plan.\", focus on See your plan, no scroll", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const { before, after } = await home.indexFigures();
    const mover = (await home.moveLead.innerText()).split(/ \d+ minutes? (earlier|later)/)[0];
    const width = (await home.keepMove.boundingBox())?.width ?? 0;

    // Nothing is said about the plan before the press, but its room is already held.
    await expect(home.keptNotice).toHaveCount(0);
    await expect(home.keptSlot).toBeAttached();
    const scrolled = await page.evaluate(() => window.scrollY);
    await home.keepMove.click();

    // The group confirms in place, in ink, and moves focus to the way to the plan, not to the page.
    await expect(home.keptNotice).toBeVisible();
    // It says that nothing changes on the real timetable until the acts' teams agree.
    await expect(home.keptNotice).toHaveText(/^Kept in your plan\.\s*Nothing moves until the acts’ teams agree\.\s*See your plan$/);
    await expect(home.seeYourPlan).toHaveAttribute("href", "#your-plan");
    await expect(home.seeYourPlan).toBeFocused();
    await expect(home.groupAnnouncement).toHaveText(new RegExp(`^Testing ${literal(mover)} at \\d{2}:\\d{2}\\.`));
    // The button says the plan holds the move, in the same width.
    await expect(home.keepMove).toHaveAccessibleName("Kept in your plan");
    expect(Math.abs(((await home.keepMove.boundingBox())?.width ?? 0) - width), "Keep keeps its width").toBeLessThanOrEqual(1);
    // The whole confirmation is on the screen, and the press did not scroll the page to show it.
    await expect(home.keptNotice).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    // The side effects stay said after the press.
    await expect(home.sideEffects).toHaveText(SIDE_EFFECTS[DAYS.glastonbury.id]);

    // One kept move, the hero's: same set, and the plan's index is the index card's "after".
    const kept = home.plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem");
    await expect(kept).toHaveCount(1);
    await expect(kept).toContainText(mover);
    await expect(home.plan.getByRole("region", { name: "Your tested moves" })).toContainText(`${before}`);
    await expect(home.plan.getByRole("region", { name: "Your tested moves" })).toContainText(`${after}`);
    await expect(home.plan.getByRole("link", { name: "Open as a one-page brief" })).toHaveAttribute("href", /^\/brief\?preset=glastonbury-2025-sun&day=0&moves=/);
    expect(await page.evaluate(() => window.scrollY), "the plan filled in without moving the page").toBe(scrolled);

    // The board's own index does not change: a tested plan is previewed, never applied.
    const dial = page.getByRole("figure").filter({ hasText: "Clash Budget Index" });
    await expect(dial.getByText(before, { exact: true }).first()).toBeVisible();

    // "See your plan" takes the visitor there and gives the plan focus.
    await home.seeYourPlan.click();
    await expect(home.plan).toHaveAttribute("id", "your-plan");
    await expect(home.plan).toBeFocused();
    await expect(home.plan).toBeInViewport();
  });

  test("pressing Keep this move again does not add the move twice", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.keepMove.click();
    const kept = home.plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem");
    await expect(kept).toHaveCount(1);
    await expect(home.keptNotice).toBeVisible();

    await home.keepMove.click();
    await expect(home.groupAnnouncement).toHaveText("Already in your plan.");
    await expect(home.keptNotice).toBeVisible();
    await expect(kept).toHaveCount(1);
  });

  test("kept while the drawing shows the day as published, the confirmation says the drawing does not show the move", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.chooseView("As published");
    await expect(home.graph).toHaveAttribute("data-view", "published");
    await expect(home.graph).toHaveAccessibleName(`${DAYS.glastonbury.title}, as published: 39 sets on 5 stages`);
    // The readout and its side effects describe the proposal, whichever view is drawn.
    await expect(home.readout).toHaveText(/^45 →\s+to 30 min shared with Katy J Pearson$/);
    await expect(home.sideEffects).toHaveText(SIDE_EFFECTS[DAYS.glastonbury.id]);

    await home.keepMove.click();
    await expect(home.keptNotice).toHaveText(/^Kept in your plan\.\s*Drawn here as published\.\s*Nothing moves until the acts’ teams agree\.\s*See your plan$/);
    await expect(home.seeYourPlan).toBeFocused();
    await expect(home.keptNotice).toBeInViewport({ ratio: 1 });
    await expect(home.sideEffects).toHaveText(SIDE_EFFECTS[DAYS.glastonbury.id]);
    await expect(home.plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem")).toHaveCount(1);

    // Back on the moved view, the confirmation drops the published note.
    await home.chooseView("Sprints 15 min later");
    await expect(home.keptNotice).toHaveText(/^Kept in your plan\.\s*Nothing moves until the acts’ teams agree\.\s*See your plan$/);
  });

  for (const choice of ["Add to your plan", "Replace your plan"] as const) {
    test(`with another move already in the plan, Keep this move asks first, and ${choice} does what it says`, async ({ page }) => {
      const home = new HomePage(page);
      const move = new TryAMove(page);
      await home.goto(DAYS.glastonbury.id);

      await move.choose("Gurriers");
      await move.keepButton.click();
      await expect(move.kept).toHaveCount(1);

      // Never a silent replace: the plan holds a move, so both ways are offered, Add first and focused.
      await home.keepMove.click();
      const offer = home.group.getByRole("group", { name: "Keep this move: add it to your plan, or replace your plan" });
      await expect(offer).toBeVisible();
      await expect(offer).toContainText("Your plan already holds 1 kept move.");
      await expect(offer.getByRole("button", { name: "Add to your plan" })).toBeFocused();
      await expect(home.groupAnnouncement).toHaveText("Your plan already holds 1 kept move. Add this move to it, or replace your plan.");
      await expect(move.kept).toHaveCount(1);

      await offer.getByRole("button", { name: choice }).click();
      await expect(home.keptNotice).toBeVisible();
      await expect(offer).toHaveCount(0);
      if (choice === "Add to your plan") {
        await expect(move.kept).toHaveCount(2);
        await expect(move.kept.nth(0)).toContainText("Gurriers");
        await expect(move.kept.nth(1)).toContainText("Sprints");
        await expect(home.groupAnnouncement).toContainText("Added: 2 kept moves.");
      } else {
        await expect(move.kept).toHaveCount(1);
        await expect(move.kept.first()).toContainText("Sprints");
        await expect(home.groupAnnouncement).toContainText("It replaced your earlier 1 kept step.");
      }
    });
  }

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, with the two-set change already kept, Keep this move's offer moves no hero box from the plain kept state, and the whole offer is in view`, async ({ page, isPhone }) => {
      const home = new HomePage(page);
      const move = new TryAMove(page);
      const offer = home.group.getByRole("group", { name: "Keep this move: add it to your plan, or replace your plan" });
      const sizes = isPhone
        ? [
            { width: 390, height: 844 },
            { width: 375, height: 667 },
          ]
        : [{ width: 1440, height: 900 }];
      for (const size of sizes) {
        await page.setViewportSize(size);
        const at = `${size.width} x ${size.height}`;

        // The plain kept state: an empty plan, then Keep this move.
        await home.goto(day.id);
        await page.evaluate(() => sessionStorage.clear());
        await home.goto(day.id);
        await home.keepMove.click();
        await expect(home.keptNotice).toBeVisible();
        await expect(move.kept).toHaveCount(1);
        const kept = await heroBoxes(page);

        // The existing-plan state: the index card's two-set change kept first, then Keep this move, which asks first.
        await page.evaluate(() => sessionStorage.clear());
        await home.goto(day.id);
        await home.details.getByRole("button", { name: "Keep the two-set change" }).click();
        await expect(move.kept).toHaveCount(1);
        await page.evaluate(() => window.scrollTo(0, 0));
        await home.keepMove.click();
        await expect(offer).toBeVisible();
        await expect(offer.getByRole("button", { name: "Add to your plan" })).toBeFocused();
        const asked = await heroBoxes(page);

        for (const [name, before] of Object.entries(kept)) {
          const after = asked[name];
          expect(before, `${at}: ${name} is drawn in the kept state`).not.toBeNull();
          expect(after, `${at}: ${name} is drawn with the offer open`).not.toBeNull();
          for (const edge of ["left", "top", "width", "bottom"] as const) {
            expect(Math.abs((after?.[edge] ?? 0) - (before?.[edge] ?? 0)), `${at}: ${name} ${edge} ${before?.[edge]} kept, ${after?.[edge]} with the offer`).toBeLessThanOrEqual(1);
          }
        }
        // The whole offer is on the screen: Add, Replace and the words in the confirmation's room.
        await expect(offer.getByRole("button", { name: "Add to your plan" })).toBeInViewport({ ratio: 1 });
        await expect(offer.getByRole("button", { name: "Replace your plan" })).toBeInViewport({ ratio: 1 });
        await expect(home.group.locator("[data-keep-offer-status]")).toBeInViewport({ ratio: 1 });
        // The plan holds the two-set change, which is a step (a change of two sets), not a move.
        await expect(home.group.locator("[data-keep-offer-status]")).toHaveText("Your plan already holds 1 kept step.");
      }
    });
  }

  test("Show the working opens by click and by keyboard, and says how the clash was chosen", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.working).toBeHidden();
    await home.showWorking.click();
    await expect(home.showWorking).toHaveAttribute("aria-expanded", "true");
    await expect(home.working).toBeVisible();
    await expect(home.working.getByRole("heading", { name: "How this was chosen" })).toBeVisible();
    await expect(home.working).toContainText("Line 1");
    await expect(home.working).toContainText("It is a rank, not attendance.");
    // The two changes side by side, as a table with its figures.
    await expect(home.working.getByRole("table")).toContainText("Ends the overlap");
    // The hidden clash is offered among the secondary actions under the working.
    await expect(home.details.getByRole("button", { name: "Open a hidden clash" })).toBeVisible();
    // Where this day's reading came from, with its Recorded stamp.
    await expect(home.working).toContainText(/Saved Qloo reading of this day: built .+ from \d+ saved Qloo responses?\./);
    // The live re-check is offered only while this server answers live pair checks.
    const health = (await (await page.request.get("/api/health")).json()) as { pair_check?: boolean };
    if (health.pair_check !== true) await expect(home.details.getByRole("button", { name: /^Re-check this pair with Qloo/ })).toHaveCount(0);

    await home.showWorking.focus();
    await page.keyboard.press("Enter");
    await expect(home.showWorking).toHaveAttribute("aria-expanded", "false");
    await expect(home.working).toBeHidden();
    await page.keyboard.press("Space");
    await expect(home.showWorking).toHaveAttribute("aria-expanded", "true");
  });

  test("the index card's hidden-clash button opens that clash's details", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.details.getByRole("button", { name: "Open a hidden clash" }).click();
    await expect(home.drawer).toBeVisible();
    await expect(home.drawer.getByRole("heading", { level: 2 })).toContainText("×");
    await page.keyboard.press("Escape");
    await expect(home.drawer).toHaveCount(0);
  });

  test("the second day has its own decision, and Keep this move works there too", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.riot.id);

    await expect(home.dateline).toContainText(`${DAYS.riot.dayName}. Published timetable; saved global Qloo reading built `);
    await expect(home.moveLead).toHaveText("Bowling for Soup 20 minutes later");
    await expect(home.readout).toHaveText(/^40 →\s+to 35 min shared with Alanis Morissette$/);
    await expect(home.sideEffects).toHaveText(SIDE_EFFECTS[DAYS.riot.id]);
    await expect(home.tasteLine).toContainText(/^Taste overlap: \d+ of 100 on this bill \(a rank, not attendance\)/);
    // Taste does not move this pair: the section under the hero says so, and no line says time alone agrees.
    await expect(home.whatQloo.getByRole("heading", { level: 2 })).toHaveText(/^Adding taste leaves this pair at #\d+$/);
    await expect(page.locator("body")).not.toContainText("Taste agrees with time");
    await home.keepMove.click();
    await expect(home.keptNotice).toBeVisible();
    await expect(home.plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem")).toHaveCount(1);
    await expect(home.plan.getByRole("link", { name: "Open as a one-page brief" })).toHaveAttribute("href", /preset=riot-fest-2026-sun/);
  });

  test("the index card reads in order: the index with its stamp, its scale, the hidden line, Show the working, then its actions (from 1024 px the hidden line and the change line sit beside the card)", async ({ page, isPhone }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const box = async (locator: Locator) => {
      const found = await locator.boundingBox();
      expect(found, "drawn").not.toBeNull();
      return found ?? { x: Number.NaN, y: Number.NaN, width: Number.NaN, height: Number.NaN };
    };
    const top = async (locator: Locator) => (await box(locator)).y;
    const index = home.indexCard.getByText("Clash Budget Index", { exact: true });
    const scale = home.indexCard.getByText(/^A score, not money: 100 = the average random valid timetable of this lineup\. Lower is better\./);
    // The hidden line states its scope: one of the day's hidden clashes, among the day's ranked clashes. Below 1024 px
    // it is in the card; from 1024 px it sits beside the card, closed by its action.
    const hidden = home.details.getByText(/^A hidden clash, 1 of \d+ among the day’s \d+ ranked clashes: main genres differ/).filter({ visible: true });
    const actions = home.details.getByRole("button", { name: "Open a hidden clash" });
    for (const part of [index, scale, hidden, home.showWorking, actions]) await expect(part).toBeVisible();
    await expect(hidden, "the hidden line is said once at this width").toHaveCount(1);
    if (isPhone) {
      // One column: index, scale, hidden line, Show the working, then the actions, top to bottom, all in the card.
      const ys = [await top(index), await top(scale), await top(hidden), await top(home.showWorking), await top(actions)];
      expect(ys, "index, scale, hidden line, Show the working and the actions, top to bottom").toEqual([...ys].sort((a, b) => a - b));
      await expect(home.indexCard.getByRole("button", { name: "Open a hidden clash" })).toBeVisible();
    } else {
      // The card reads index, scale, Show the working; beside it (to its right) the hidden line closed by its action,
      // then the change line closed by Keep the two-set change, whose top is at or above the card's foot.
      const ys = [await top(index), await top(scale), await top(home.showWorking)];
      expect(ys, "index, scale and Show the working, top to bottom in the card").toEqual([...ys].sort((a, b) => a - b));
      const card = await box(home.indexCard);
      const besideLine = home.indexBeside.locator("[data-hidden-line]");
      const changeLine = home.indexBeside.locator("[data-change-line]");
      await expect(besideLine).toBeVisible();
      await expect(changeLine).toBeVisible();
      await expect(besideLine.getByRole("button", { name: "Open a hidden clash" })).toBeVisible();
      await expect(changeLine.getByRole("button", { name: "Keep the two-set change" })).toBeVisible();
      const [hiddenBox, changeBox] = [await box(besideLine), await box(changeLine)];
      expect(hiddenBox.x, "the hidden line sits to the right of the card").toBeGreaterThanOrEqual(card.x + card.width);
      expect(hiddenBox.y, "the hidden line comes before the change line").toBeLessThan(changeBox.y);
      expect(changeBox.y, "the change line's top is at or above the card's foot").toBeLessThanOrEqual(card.y + card.height);
      // The card's own copies of those lines and actions are not drawn at this width: each is said once.
      await expect(home.indexCard.getByRole("button", { name: "Open a hidden clash" })).toHaveCount(0);
      await expect(home.indexCard.getByRole("button", { name: "Keep the two-set change" })).toHaveCount(0);
    }
    // The index carries its Derived stamp, and who scored it, in the index's own paragraph.
    await expect(home.indexBlock.getByText("Derived")).toBeVisible();
    await expect(home.indexBlock).toContainText("Selected and scored by this app’s index. A reading, not a verdict.");
    // "Lower is better" is said once in the card, in the index's own paragraph.
    expect((await home.indexCard.innerText()).split("Lower is better").length - 1, "\"Lower is better\" once in the card").toBe(1);
    // The card holds no second Keep this move (the hero's is the one filled action) and no three-rank line.
    await expect(home.details.getByRole("button", { name: "Keep this move" })).toHaveCount(0);
    await expect(home.indexCard).not.toContainText(/Time alone ranks this pair/);
    if (!isPhone) await expect(home.indexBeside).not.toContainText(/Time alone ranks this pair/);
    // The day's saved reading is dated in the hero's dateline (a date, not a figure), and called global: both saved
    // days were read with no location sent.
    await expect(home.dateline).toHaveText(`Sunday. Published timetable; saved global Qloo reading built 3 Oct 2026. ${HONESTY.neither}`);
    await expect(home.dateline).toHaveText(
      new RegExp(`^${DAYS.glastonbury.dayName}\\. Published timetable; saved global Qloo reading built \\d{1,2} [A-Z][a-z]{2} \\d{4}\\. ${literal(HONESTY.neither)}$`),
    );
  });

  test("on a phone, Keep this move and its confirmation are on the first screen, and pressing it does not scroll", async ({ page, isPhone }) => {
    test.skip(!isPhone, "The first-screen rule is measured at 390 x 844.");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const box = await home.keepMove.boundingBox();
    expect(box, "Keep this move is drawn").not.toBeNull();
    expect(box?.y ?? -1, "Keep this move starts on the page").toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0), "Keep this move ends above y = 787").toBeLessThanOrEqual(787);
    await home.keepMove.click();
    await expect(home.keptNotice).toBeVisible();
    const notice = await home.keptNotice.boundingBox();
    expect((notice?.y ?? 0) + (notice?.height ?? 0), "the whole confirmation ends above y = 844").toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => window.scrollY), "the press leaves the page where it was").toBe(0);
  });

  test("after the hero's move is kept, the plan offers the next clash in the published day's ranking, and opens it in Try a move", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.plan.getByRole("button", { name: /^Next: / })).toHaveCount(0);
    await home.keepMove.click();
    await expect(move.kept).toHaveCount(1);
    const next = home.plan.getByRole("button", { name: /^Next: .+ × .+, the next clash in the published day’s ranking$/ });
    await expect(next).toBeVisible();
    const [, a = "", b = ""] = /^Next: (.+) × (.+), the next clash/.exec((await next.innerText()).trim()) ?? [];
    // The kept move's own clash is addressed, so it is not the next one.
    expect([a, b].sort()).not.toEqual(["Katy J Pearson", "Sprints"]);
    await next.click();
    // Try a move now has one of that clash's two sets picked.
    await expect
      .poll(() => move.select.evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? ""))
      .toMatch(new RegExp(`^\\d{2}:\\d{2} (${literal(a)}|${literal(b)})`));
  });
});
