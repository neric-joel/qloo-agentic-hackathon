import type { Locator, Request } from "@playwright/test";

import { DAYS, expectNoHorizontalScroll, HONESTY, literal, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { serveInventedDay } from "./invented-day";
import { HomePage } from "./pages/home-page";
import { TryAMove } from "./pages/try-a-move";

/**
 * The hero: the day drawn as a graph beside one decision group (the move, its answer, what else it changes, the
 * pair's taste rank with its qualifier, who scored it) and "Keep this move", which keeps it in your plan in place.
 * The index, its scale and the working sit in the index card under the hero.
 */

/** The side-effect line of each published day's move, from the published times. */
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
      // The decision group itself, which keeps its height in every state.
      group: box(group),
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
    // The heading says whose ranks these are.
    await expect(home.whatQloo.getByRole("heading", { level: 2 })).toHaveText("Adding taste moves this pair from #18 to #1 in this app’s index");
    await expect(home.whatQloo).toContainText("Sprints × Katy J Pearson, 45 min shared, ranked three ways");
    await expect(home.whatQloo).toContainText("Time alone");
    await expect(home.whatQloo).toContainText("+ taste overlap from Qloo data");
    await expect(home.whatQloo).toContainText("This does not prove #1 is the right clash to move.");
  });

  test("Keep this move keeps the hero's move in place: \"Kept in your plan.\", focus on See your plan, no scroll", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    // Focus follows a press only when the plan answers within 2 s (see answerKeepAtOnce).
    const answered = await home.answerKeepAtOnce(DAYS.glastonbury.id);

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
    expect(answered(), "the press was answered with the server's own what-if").toBe(1);
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
    // Focus follows a press only when the plan answers within 2 s (see answerKeepAtOnce).
    const answered = await home.answerKeepAtOnce(DAYS.glastonbury.id);

    await home.chooseView("As published");
    await expect(home.graph).toHaveAttribute("data-view", "published");
    await expect(home.graph).toHaveAccessibleName(`${DAYS.glastonbury.title}, as published: 39 sets on 5 stages`);
    // The readout and its side effects describe the proposal, whichever view is drawn.
    await expect(home.readout).toHaveText(/^45 →\s+to 30 min shared with Katy J Pearson$/);
    await expect(home.sideEffects).toHaveText(SIDE_EFFECTS[DAYS.glastonbury.id]);

    await home.keepMove.click();
    await expect(home.keptNotice).toHaveText(/^Kept in your plan\.\s*Drawn here as published\.\s*Nothing moves until the acts’ teams agree\.\s*See your plan$/);
    await expect(home.seeYourPlan).toBeFocused();
    expect(answered(), "the press was answered with the server's own what-if").toBe(1);
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

        // Below 380 px Replace sits directly under Add, so the confirmation's room, which holds the offer's
        // words, is the row under Replace, and the paste (not shown while the offer is open, as before) gives up its row;
        // the group keeps its box, so every other box holds.
        const narrow = size.width < 380;
        const moved: string[] = [];
        for (const [name, before] of Object.entries(kept)) {
          const after = asked[name];
          expect(before, `${at}: ${name} is drawn in the kept state`).not.toBeNull();
          expect(after, `${at}: ${name} is drawn with the offer open`).not.toBeNull();
          for (const edge of ["left", "top", "width", "bottom"] as const) {
            if (Math.abs((after?.[edge] ?? 0) - (before?.[edge] ?? 0)) > 1) moved.push(`${name} ${edge} ${before?.[edge]} kept, ${after?.[edge]} with the offer`);
          }
        }
        test.info().annotations.push({ type: `boxes moved by the offer at ${at}`, description: moved.join("; ") || "none" });
        expect(moved.filter((item) => !(narrow && (item.startsWith("slot ") || item.startsWith("paste ")))), `${at}: hero boxes the offer moves`).toEqual([]);
        if (narrow) {
          const replace = await offer.getByRole("button", { name: "Replace your plan" }).boundingBox();
          const words = await home.group.locator("[data-keep-offer-status]").boundingBox();
          expect((words?.y ?? 0) + 1, `${at}: the offer's words sit under Replace`).toBeGreaterThanOrEqual((replace?.y ?? 0) + (replace?.height ?? 0));
          await expect(home.pasteLink, `${at}: the paste is not shown while the offer is open`).toBeHidden();
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
    await expect(home.whatQloo.getByRole("heading", { level: 2 })).toHaveText(/^Adding taste leaves this pair at #\d+ in this app’s index$/);
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
    const scale = home.indexCard.getByText(/^A score, not money: 100 = the average random valid timetable of this lineup\. Above 100: costlier\./);
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
    // The index's own paragraph, word for word, says what a reading above 100 means beside the
    // guarded scale ("of this lineup" beside the 100 it qualifies), and "Lower is better" leaves the card: the dial
    // beside the board still says it, with no click (honesty.spec.ts pins its words).
    await expect(home.indexCard.locator("[data-index-scale]")).toHaveText(INDEX_PARAGRAPH);
    expect(INDEX_PARAGRAPH.split(" ").length, "the paragraph's own word count, its cap").toBe(29);
    expect((await home.indexCard.innerText()).split("Above 100: costlier.").length - 1, "\"Above 100: costlier.\" once in the card").toBe(1);
    expect((await home.indexCard.innerText()).split("Lower is better").length - 1, "\"Lower is better\" not in the card").toBe(0);
    const dial = page.getByRole("figure").filter({ hasText: "Clash Budget Index" });
    await expect(dial.locator("[data-index-explain]")).toContainText("Lower is better.");
    await expect(dial.locator("[data-index-explain]")).toBeVisible();
    // The card holds no second Keep this move (the hero's is the one filled action) and no three-rank line.
    await expect(home.details.getByRole("button", { name: "Keep this move" })).toHaveCount(0);
    await expect(home.indexCard).not.toContainText(/Time alone ranks this pair/);
    if (!isPhone) await expect(home.indexBeside).not.toContainText(/Time alone ranks this pair/);
    // The day's saved reading is dated in the hero's dateline (a date, not a figure), and called global: both saved
    // days were read with no location sent.
    await expect(home.dateline).toHaveText(`Sunday. Published timetable; saved global Qloo reading built 3 Oct 2026. ${HONESTY.neither}`);
    // The date's three parts are joined by no-break spaces, so a regular expression (matched against
    // the raw text) names them.
    await expect(home.dateline).toHaveText(
      new RegExp(`^${DAYS.glastonbury.dayName}\\. Published timetable; saved global Qloo reading built \\d{1,2}\\u00a0[A-Z][a-z]{2}\\u00a0\\d{4}\\. ${literal(HONESTY.neither)}$`),
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

/** Each published day's move lead, as the hero says it once the day's decision is in. */
const MOVE_LEADS = {
  [DAYS.glastonbury.id]: "Sprints 15 minutes later",
  [DAYS.riot.id]: "Bowling for Soup 20 minutes later",
} as const;

/**
 * The hero's desktop note under the dateline, word for word: one line on what every move keeps and that a clash can be kept on purpose ("the latest published end" is the engine's curfew on a published day; the
 * locks are this app's). Why this move and the two-set change stay one click away, in the index card's "How this was
 * chosen". The same line on both published days. Desktop only.
 */
const HERO_NOTE = "Moves keep stage hours, the latest published end, changeovers and this app’s locks; a clash can be kept on purpose.";

/** The index card's paragraph: the guarded scale, what above 100 means, who scored it, the caveat. */
const INDEX_PARAGRAPH =
  "A score, not money: 100 = the average random valid timetable of this lineup. Above 100: costlier. Selected and scored by this app’s index. A reading, not a verdict.";

/** A browser request for a day's decision, and for a day's preset. */
const DECISION_PATH = /^\/api\/presets\/[^/]+\/decision$/;
const PRESET_PATH = /^\/api\/presets\/[^/]+$/;

/** Where the hero group's height is held: 1440 x 900 and 1024 x 768 on a desktop, 390 x 844 on a phone. */
function groupSizes(isPhone: boolean): { width: number; height: number }[] {
  return isPhone
    ? [{ width: 390, height: 844 }]
    : [
        { width: 1440, height: 900 },
        { width: 1024, height: 768 },
      ];
}

/**
 * The preset response carries the day's decision, so the server paints the hero
 * group whole (readout and Keep included) and the browser never asks for the decision on a published load; and when a
 * picker switch has to ask for it (an API without the seed), the group keeps one height while it waits. The CLS test in
 * day-graph.spec.ts holds the boxes; these hold the group and the requests.
 */
test.describe("the hero group while a day's decision loads", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));
  // The other day's read-ahead can still be in flight through a test's routes when it ends; they let go then.
  test.afterEach(async ({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, a published load asks no decision in the browser, draws the readout and Keep, and the group's height at DOMContentLoaded + 50 ms equals its height at 4 s`, async ({ page, isPhone }) => {
      test.setTimeout(120_000);
      // The group the visitor sees (the server's frame, then the interactive page), read 50 ms after DOMContentLoaded
      // and at 4 s, with what it holds.
      await page.addInitScript(() => {
        const store = window as unknown as { __group: Record<string, unknown> };
        store.__group = {};
        const read = () => {
          const group = [...document.querySelectorAll("[data-hero] [data-hero-group]")].find((element) => element.getBoundingClientRect().width > 0);
          if (!group) return null;
          return {
            height: group.getBoundingClientRect().height,
            state: group.getAttribute("data-hero-state") ?? "",
            readout: group.querySelectorAll("[data-readout]").length,
            buttons: group.querySelectorAll("button").length,
          };
        };
        document.addEventListener("DOMContentLoaded", () => {
          window.setTimeout(() => (store.__group.early = read()), 50);
          window.setTimeout(() => (store.__group.late = read()), 4_000);
        });
      });
      const home = new HomePage(page);
      const path = day.id === DAYS.glastonbury.id ? "/" : `/?preset=${day.id}`;
      for (const size of groupSizes(isPhone)) {
        await page.setViewportSize(size);
        const at = `${size.width} x ${size.height}`;
        // One load first, so the measured load is the page's own and not the dev server's first compile.
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await home.waitUntilReady();

        const asked: string[] = [];
        const onRequest = (request: Request) => {
          if (request.method() === "GET" && DECISION_PATH.test(new URL(request.url()).pathname)) asked.push(request.url());
        };
        page.on("request", onRequest);
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect
          .poll(() => page.evaluate(() => "late" in (window as unknown as { __group: object }).__group), { timeout: 20_000, message: `${at}: 4 s on the page` })
          .toBe(true);
        await home.waitUntilReady();
        // The group holds its readout and Keep, so the count below cannot pass on an empty page.
        await expect(home.readout, `${at}: the readout`).toHaveCount(1);
        await expect(home.keepMove, `${at}: Keep this move`).toHaveCount(1);
        await expect(home.moveLead).toHaveText(MOVE_LEADS[day.id]);
        // The other day's read-ahead runs after the page is ready; give it its moment before counting.
        await page.waitForTimeout(1_500);
        page.off("request", onRequest);

        type Read = { height: number; state: string; readout: number; buttons: number } | null;
        const { early, late } = await page.evaluate(() => (window as unknown as { __group: { early: Read; late: Read } }).__group);
        test.info().annotations.push({
          type: `hero group at ${at}`,
          description: `${early?.state} ${early?.height.toFixed(1)} px at DOMContentLoaded + 50 ms, ${late?.state} ${late?.height.toFixed(1)} px at 4 s; browser decision requests ${asked.length}`,
        });
        expect(asked, `${at}: browser GET /api/presets/*/decision on a published load`).toEqual([]);
        expect(early, `${at}: the group is in the server's frame`).not.toBeNull();
        expect(late, `${at}: the group is there at 4 s`).not.toBeNull();
        expect(early?.readout, `${at}: the server's frame draws the readout`).toBeGreaterThanOrEqual(1);
        expect(early?.buttons, `${at}: the server's frame draws Keep`).toBeGreaterThanOrEqual(1);
        expect(
          Math.abs((early?.height ?? 0) - (late?.height ?? Number.NaN)),
          `${at}: group height ${early?.height} at DOMContentLoaded + 50 ms, ${late?.height} at 4 s`,
        ).toBeLessThanOrEqual(0.5);
        // And once the interactive page has settled (on a busy dev server that can be after 4 s): the same height.
        await expect(home.group).toHaveAttribute("data-hero-state", "settled");
        const settled = (await home.group.boundingBox())?.height ?? Number.NaN;
        expect(Math.abs((early?.height ?? 0) - settled), `${at}: group height ${early?.height} at DOMContentLoaded + 50 ms, ${settled} settled`).toBeLessThanOrEqual(0.5);
      }
    });
  }

  for (const [day, other] of [
    [DAYS.glastonbury, DAYS.riot],
    [DAYS.riot, DAYS.glastonbury],
  ] as const) {
    test(`from ${day.title}, choosing ${other.festival} with the browser's decision request held 3 s keeps the group's height within 0.5 px in every frame until it settles`, async ({ page, isPhone }) => {
      test.setTimeout(120_000);
      // The browser's preset answers lose their decision (the shape of an API without the seed), so the page has to ask
      // for the decision itself; that request is held 3 s. The server's own frame is untouched.
      await page.route(
        (url) => PRESET_PATH.test(url.pathname),
        async (route) => {
          if (route.request().method() !== "GET") return route.fallback();
          const response = await route.fetch();
          const body = (await response.json()) as Record<string, unknown>;
          delete body.decision;
          await route.fulfill({ response, json: body });
        },
      );
      let held = 0;
      await page.route(
        (url) => DECISION_PATH.test(url.pathname),
        async (route) => {
          held += 1;
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          await route.fallback();
        },
      );
      const home = new HomePage(page);
      for (const size of groupSizes(isPhone)) {
        await page.setViewportSize(size);
        const at = `${size.width} x ${size.height}`;
        held = 0;
        await home.goto(day.id);
        await expect(home.moveLead).toHaveText(MOVE_LEADS[day.id]);
        // Every animation frame from the press until the other day's decision has settled.
        await page.evaluate(() => {
          const store = window as unknown as { __heights: number[]; __sampling: boolean };
          store.__heights = [];
          store.__sampling = true;
          const tick = () => {
            const group = [...document.querySelectorAll("[data-hero] [data-hero-group]")].find((element) => element.getBoundingClientRect().width > 0);
            store.__heights.push(group ? group.getBoundingClientRect().height : Number.NaN);
            if (store.__sampling) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await home.chooseDay(other.festival);
        await expect(home.moveLead, `${at}: the other day's move`).toHaveText(MOVE_LEADS[other.id], { timeout: 20_000 });
        await expect(home.group).toHaveAttribute("data-hero-state", "settled");
        await page.waitForTimeout(300);
        const heights = await page.evaluate(() => {
          const store = window as unknown as { __heights: number[]; __sampling: boolean };
          store.__sampling = false;
          return store.__heights;
        });
        const drawn = heights.filter((height) => !Number.isNaN(height));
        const range = Math.max(...drawn) - Math.min(...drawn);
        test.info().annotations.push({
          type: `group on the switch at ${at}`,
          description: `${heights.length} frames, range ${range.toFixed(2)} px, decision requests held ${held}`,
        });
        expect(held, `${at}: the browser asked for a decision, and it was held`).toBeGreaterThanOrEqual(1);
        expect(heights.length, `${at}: frames sampled`).toBeGreaterThan(10);
        expect(heights.length - drawn.length, `${at}: frames with no group`).toBe(0);
        expect(range, `${at}: the group's height range from the press to settle`).toBeLessThanOrEqual(0.5);
      }
    });
  }
});

/**
 * A visitor who scrolled down the server's frame before the page mounted saw the page reorder
 * under them (CLS 0.23 at 1440 and 0.60 to 0.93 at 390): the footer, the one node that outlived the swap, was pushed
 * off the screen, then the sections before the board filled in above the unchanged scroll position. The frame now holds
 * the footer back while scripts run, and the page puts the board's summary back on the line it was on.
 */
test.describe("the page keeps the visitor's place when it replaces the server's frame", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));
  test.afterEach(async ({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, scrolled to the board's summary on the server's frame, the mount shifts nothing and leaves the summary on its line; the frame holds the footer back while scripts run`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.addInitScript(() => {
        const store = window as unknown as { __shift: number; __shifts: string[] };
        store.__shift = 0;
        store.__shifts = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node | null }[] }[]) {
            if (entry.hadRecentInput) continue;
            store.__shift += entry.value;
            store.__shifts.push(`${entry.value.toFixed(4)}: ${(entry.sources ?? []).map((source) => (source.node instanceof Element ? source.node.tagName : "?")).join(", ")}`);
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const home = new HomePage(page);
      const path = day.id === DAYS.glastonbury.id ? "/" : `/?preset=${day.id}`;
      // One load first, so the measured load is the page's own and not the dev server's first compile.
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await home.waitUntilReady();
      // The browser's preset request is held 3 s, so the server's frame stays on screen while the visitor scrolls.
      let held = 0;
      await page.route(
        (url) => PRESET_PATH.test(url.pathname),
        async (route) => {
          if (route.request().method() !== "GET") return route.fallback();
          held += 1;
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          await route.fallback();
        },
      );
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const mounted = page.locator("#what-qloo-changes");
      const summary = page.locator("details[data-board-fold] > summary").filter({ visible: true });
      await expect(summary).toHaveCount(1);
      // Still the server's frame: no section of the page yet, and the footer held back.
      expect(await mounted.count(), "the page has not mounted yet").toBe(0);
      expect(await page.locator("body > footer, footer").first().evaluate((footer) => getComputedStyle(footer).display), "the frame's footer while scripts run").toBe("none");
      const before = await summary.evaluate((element) => {
        element.scrollIntoView({ block: "center" });
        const store = window as unknown as { __shift: number; __shifts: string[] };
        store.__shift = 0;
        store.__shifts = [];
        return element.getBoundingClientRect().top;
      });
      await expect(mounted, "the page mounted").toBeAttached({ timeout: 30_000 });
      // The sections the page puts before the board fill in after the mount; let them.
      await page.waitForTimeout(2_000);
      const found = await page.evaluate(() => {
        const store = window as unknown as { __shift: number; __shifts: string[] };
        return { shift: store.__shift, shifts: store.__shifts };
      });
      const after = await summary.evaluate((element) => element.getBoundingClientRect().top);
      test.info().annotations.push({ type: `mount, ${day.title}`, description: `summary ${before.toFixed(1)} -> ${after.toFixed(1)} px; ${JSON.stringify(found)}; held ${held}` });
      expect(held, "the browser's preset request was held").toBeGreaterThanOrEqual(1);
      expect(found.shift, `layout shift at the mount (${found.shifts.join("; ")})`).toBeLessThan(0.0005);
      expect(Math.abs(after - before), `the summary's top: ${before} on the frame, ${after} on the page`).toBeLessThanOrEqual(1);
      await expect(page.getByRole("contentinfo"), "the page's footer").toBeVisible();
    });
  }

  test("with scripts off, the server's frame shows the footer", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    try {
      const page = await context.newPage();
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.locator("details[data-board-fold] > summary").filter({ visible: true })).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toContainText("The festivals shown do not use Clash Control");
    } finally {
      await context.close();
    }
  });
});

test.describe("the hero's desktop note, the date and the keep offer", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, the note says what a move keeps and that a clash can be kept on purpose, on one line at 1440 x 900 and 1280 x 800, above the ladder and the toggle, and is not drawn at 1366 x 768 or on a phone`, async ({ page, isPhone }) => {
      const home = new HomePage(page);
      const note = home.hero.locator("[data-hero-note]");
      if (isPhone) {
        // The note is desktop only: the phone's first screen has no room for the note.
        for (const size of [
          { width: 390, height: 844 },
          { width: 375, height: 667 },
        ]) {
          await page.setViewportSize(size);
          await home.goto(day.id);
          await expect(note, `${size.width} x ${size.height}: no note`).toBeHidden();
        }
        return;
      }
      for (const size of [
        { width: 1440, height: 900 },
        { width: 1280, height: 800 },
      ]) {
        await page.setViewportSize(size);
        await home.goto(day.id);
        const at = `${size.width} x ${size.height}`;
        await expect(note, `${at}: the note`).toBeVisible();
        await expect(note).toHaveText(HERO_NOTE);
        const ladder = home.hero.locator("[data-hero-ladder-room] [data-hero-ladder]");
        await expect(ladder, `${at}: the ladder under the note`).toBeVisible();
        const [noteBox, ladderBox, toggleBox] = [await note.boundingBox(), await ladder.boundingBox(), await home.viewToggle.boundingBox()];
        expect(noteBox, `${at}: the note is drawn`).not.toBeNull();
        test.info().annotations.push({ type: `note height at ${at}`, description: `${noteBox?.height.toFixed(1)} px` });
        // One line of 20 px (at most 21 px), wholly above the ladder and the toggle.
        expect(noteBox?.height ?? Infinity, `${at}: one line`).toBeLessThanOrEqual(21);
        expect((noteBox?.y ?? 0) + (noteBox?.height ?? 0), `${at}: the note ends above the ladder`).toBeLessThanOrEqual(ladderBox?.y ?? 0);
        expect((noteBox?.y ?? 0) + (noteBox?.height ?? 0), `${at}: the note ends above the toggle`).toBeLessThanOrEqual(toggleBox?.y ?? 0);
        await expect(note, `${at}: on the first screen`).toBeInViewport({ ratio: 1 });
      }
      // At 790 px tall or less the first screen keeps the drawing whole instead (the drawing wins over the note).
      await page.setViewportSize({ width: 1366, height: 768 });
      await home.goto(day.id);
      await expect(note, "1366 x 768: no note").toBeHidden();
    });
  }

  test("the dateline's date stays on one line at every width: 1440 and 1024 on a desktop, 390, 360 and 320 on a phone", async ({ page, isPhone }) => {
    const home = new HomePage(page);
    const widths = isPhone ? [390, 360, 320] : [1440, 1024];
    for (const day of Object.values(DAYS)) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: isPhone ? 844 : 900 });
        await home.goto(day.id);
        // The tops of the date's line boxes, read through a range over its characters.
        const tops = await home.dateline.evaluate((element) => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? "";
            const match = /\d{1,2} [A-Z][a-z]{2} \d{4}/.exec(text);
            if (!match) continue;
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            return [...range.getClientRects()].map((rect) => Math.round(rect.top));
          }
          return null;
        });
        expect(tops, `${day.title} at ${width}: the date is in the dateline`).not.toBeNull();
        expect(new Set(tops).size, `${day.title} at ${width}: lines the date takes`).toBe(1);
      }
    }
  });

  test("Keep this move's offer keeps Add and Replace together: one under the other at 360 on a phone, side by side at 1440", async ({ page, isPhone }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await page.setViewportSize(isPhone ? { width: 360, height: 740 } : { width: 1440, height: 900 });
    await home.goto(DAYS.glastonbury.id);
    // The plan already holds another move, so Keep this move asks first.
    await move.choose("Gurriers");
    await move.keepButton.click();
    await expect(move.kept).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await home.keepMove.click();
    const offer = home.group.getByRole("group", { name: "Keep this move: add it to your plan, or replace your plan" });
    await expect(offer).toBeVisible();
    const add = await offer.getByRole("button", { name: "Add to your plan" }).boundingBox();
    const replace = await offer.getByRole("button", { name: "Replace your plan" }).boundingBox();
    expect(add, "Add is drawn").not.toBeNull();
    expect(replace, "Replace is drawn").not.toBeNull();
    const none = { x: 0, y: 0, width: 0, height: 0 };
    const [a, r] = [add ?? none, replace ?? none];
    if (isPhone) {
      // Replace sits directly under Add, in Add's column, with nothing pressable between them.
      expect(Math.abs(r.x - a.x), "Replace starts where Add starts").toBeLessThanOrEqual(1);
      const gap = r.y - (a.y + a.height);
      expect(gap, "Replace's top under Add's foot").toBeGreaterThanOrEqual(0);
      expect(gap, "the gap between Add and Replace").toBeLessThanOrEqual(12);
      const between = await home.group.locator("button, a").evaluateAll(
        (all, [top, bottom]) =>
          all.filter((element) => {
            const box = element.getBoundingClientRect();
            return box.height > 0 && box.top >= top - 0.5 && box.bottom <= bottom + 0.5;
          }).length,
        [a.y + a.height, r.y] as const,
      );
      expect(between, "controls between Add and Replace").toBe(0);
    } else {
      expect(Math.abs(r.y - a.y), "Add and Replace share one row").toBeLessThanOrEqual(1);
      expect(r.x, "Replace follows Add").toBeGreaterThan(a.x + a.width);
    }
  });
});

/**
 * The decision's clash ranked three ways, as a three-step ladder: the hero's picture of what Qloo changes, one `[data-hero-ladder]` list with its ranks in the
 * numeral type (at least 20 px), the last rung's count, then whose ranks these are, "in this app’s index". From 1280 px
 * it is one row in the left column's room under the note; below 1280 px it shares the decision group's notice cell
 * under Keep with Keep's confirmation, overlapping, never stacked, and is hidden (keeping its box) once Keep is pressed.
 * Exactly one ladder shows at any width, its ranks are the ones "What Qloo changes" prints, taste is credited with its
 * own step only, and taste's sentence ("Adding taste ...") is no longer in the hero.
 */
test.describe("the hero's ladder", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  /** The two placements: the left column's room (from 1280 px) and the group's notice cell (below 1280 px). */
  const ROOM = "[data-hero-ladder-room] [data-hero-ladder]";
  const CELL = '[data-hero-group] [data-hero-row="notice"] [data-hero-ladder-cell] [data-hero-ladder]';

  /**
   * What the page draws of each placement: the ladder's box (page pixels) where it is drawn and visible, its rank sizes
   * and tops, the room's min-height, and the notice row's box.
   */
  async function ladders(page: import("@playwright/test").Page) {
    return page.evaluate(
      ([room, cell]) => {
        const box = (element: Element | null | undefined) => {
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, height: rect.height };
        };
        const drawn = (element: Element | null) => {
          if (!element || element.getClientRects().length === 0) return false;
          for (let node: Element | null = element; node; node = node.parentElement) if (getComputedStyle(node).visibility === "hidden") return false;
          return true;
        };
        const read = (selector: string) => {
          const ladder = document.querySelector(selector);
          if (!drawn(ladder)) return null;
          const ranks = [...(ladder as Element).querySelectorAll("[data-rank]")];
          return {
            box: box(ladder),
            sizes: ranks.map((rank) => Number.parseFloat(getComputedStyle(rank).fontSize)),
            tops: ranks.map((rank) => rank.getBoundingClientRect().top),
          };
        };
        const roomElement = document.querySelector("[data-hero-ladder-room]");
        return {
          room: read(room),
          cell: read(cell),
          roomMin: roomElement ? Number.parseFloat(getComputedStyle(roomElement).minHeight) : Number.NaN,
          notice: box(document.querySelector('[data-hero-group] [data-hero-row="notice"]')),
          group: box(document.querySelector("[data-hero-group]")),
        };
      },
      [ROOM, CELL] as const,
    );
  }

  /** Each published day's ladder as the hero reads it, and the hero section's foot at 1440 x 900. */
  const LADDERS = [
    {
      day: DAYS.glastonbury,
      text: "Time alone #23 → + Qloo popularity #18 → + taste overlap #1 of 68 in this app’s index",
      time: "Time alone #23",
      draw: "+ Qloo popularity #18",
      taste: "+ taste overlap #1 of 68",
      // The section's foot without the ladder was 833.0 (833.5 with 0.5 px of slack), so the ladder adds no net height.
      heroBottom: 833.5,
    },
    {
      day: DAYS.riot,
      text: "Time alone #5 → + Qloo popularity #1 → + taste overlap #1 of 47 in this app’s index",
      time: "Time alone #5",
      draw: "+ Qloo popularity #1",
      taste: "+ taste overlap #1 of 47",
      // Riot Fest's own foot without the ladder: 852.8 (its key takes a second line), plus the same 0.5 px.
      heroBottom: 853.3,
    },
  ] as const;

  for (const ladder of LADDERS) {
    test(`on ${ladder.day.title}: one row in the left column at 1440 x 900 and 1280 x 800 with 20 px ranks and "in this app’s index", in the notice cell under Keep at 1024, under Keep at 390 and hidden once Keep is pressed`, async ({ page, isPhone }) => {
      const home = new HomePage(page);
      if (!isPhone) {
        for (const size of [
          { width: 1440, height: 900 },
          { width: 1280, height: 800 },
        ]) {
          const at = `${size.width} x ${size.height}`;
          await page.setViewportSize(size);
          await home.goto(ladder.day.id);
          const shown = home.hero.locator(ROOM);
          await expect(shown, `${at}: the ladder's words`).toHaveText(ladder.text);
          await expect(shown.locator('[data-rung="time"]')).toContainText(ladder.time);
          await expect(shown.locator('[data-rung="draw"]')).toContainText(ladder.draw);
          await expect(shown.locator('[data-rung="taste"]')).toContainText(ladder.taste);
          await expect(shown.locator("[data-ladder-scope]"), `${at}: whose ranks these are`).toHaveText("in this app’s index");
          // The time and draw rungs print their rank alone; the count closes the last rung only.
          await expect(shown.locator('[data-rung="time"]')).not.toContainText(" of ");
          await expect(shown.locator('[data-rung="draw"]')).not.toContainText(" of ");
          // Taste is a rank, never attendance; the arrows are drawn only; taste's sentence is not in the hero.
          await expect(shown).not.toContainText(/attend|fans|people/i);
          await expect(shown.locator('[aria-hidden="true"]')).toHaveText(["→", "→"]);
          await expect(home.hero).not.toContainText("Adding taste");

          const read = await ladders(page);
          expect(read.cell, `${at}: no ladder in the group's notice cell`).toBeNull();
          expect(read.room, `${at}: the ladder is drawn in the left column's room`).not.toBeNull();
          const room = read.room!;
          expect(room.sizes, `${at}: three ranks`).toHaveLength(3);
          for (const size of room.sizes) expect(size, `${at}: a rank's size`).toBeGreaterThanOrEqual(20);
          expect(Math.max(...room.tops) - Math.min(...room.tops), `${at}: one row (every rank on one line)`).toBeLessThanOrEqual(1);
          expect(room.box!.height, `${at}: the ladder fits its room's min-height (${read.roomMin} px)`).toBeLessThanOrEqual(read.roomMin + 0.5);
          expect(room.box!.right, `${at}: the ladder sits in the left column, clear of the group`).toBeLessThanOrEqual(read.group!.left);
          await expect(shown, `${at}: the ladder is on the first screen`).toBeInViewport({ ratio: 1 });
          // No net hero height: the toggle, the drawing and the hero's foot stay where they were.
          const [toggle, drawing, hero] = await Promise.all([
            home.viewToggle.boundingBox(),
            home.graph.locator(":scope > [data-layout]").filter({ visible: true }).first().boundingBox(),
            home.hero.boundingBox(),
          ]);
          expect(toggle?.y ?? Infinity, `${at}: the toggle's top`).toBeLessThanOrEqual(385.3);
          expect(drawing?.y ?? Infinity, `${at}: the drawing's top`).toBeLessThanOrEqual(437.3);
          if (size.width === 1440) expect((hero?.y ?? 0) + (hero?.height ?? Infinity), `${at}: the hero section's foot`).toBeLessThanOrEqual(ladder.heroBottom);
        }

        await page.setViewportSize({ width: 1024, height: 768 });
        await home.goto(ladder.day.id);
        const inCell = home.hero.locator(CELL);
        await expect(inCell, "1024: the ladder's words").toHaveText(ladder.text);
        const read = await ladders(page);
        expect(read.room, "1024: no ladder in the left column").toBeNull();
        expect(read.cell, "1024: the ladder is drawn in the notice cell").not.toBeNull();
        for (const size of read.cell!.sizes) expect(size, "1024: a rank's size").toBeGreaterThanOrEqual(20);
        const keep = await home.keepMove.boundingBox();
        const scroll = await page.evaluate(() => window.scrollY);
        expect(read.cell!.box!.top - scroll, "1024: the ladder sits under Keep").toBeGreaterThanOrEqual((keep?.y ?? 0) + (keep?.height ?? 0) - 0.5);
        await expect(inCell, "1024: the ladder is on the first screen").toBeInViewport({ ratio: 1 });
      } else {
        await home.goto(ladder.day.id);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        const inCell = home.hero.locator(CELL);
        await expect(inCell, "390: the ladder's words").toHaveText(ladder.text);
        await expect(home.hero).not.toContainText("Adding taste");
        const read = await ladders(page);
        expect(read.room, "390: no ladder in the left column").toBeNull();
        expect(read.cell, "390: the ladder is drawn in the notice cell").not.toBeNull();
        for (const size of read.cell!.sizes) expect(size, "390: a rank's size").toBeGreaterThanOrEqual(20);
        const keep = await home.keepMove.boundingBox();
        expect(read.cell!.box!.top, "390: the ladder sits under Keep").toBeGreaterThanOrEqual((keep?.y ?? 0) + (keep?.height ?? 0) - 0.5);
        // Keep keeps its place on the first screen: at most 780.3 (779.8 without the ladder; the guard's limit is 787).
        expect((keep?.y ?? 0) + (keep?.height ?? 0), "390: Keep's bottom").toBeLessThanOrEqual(780.3);
        await expect(inCell, "390: the ladder is wholly on the first screen").toBeInViewport({ ratio: 1 });
        expect(read.cell!.box!.bottom, "390: the ladder ends by 844").toBeLessThanOrEqual(844);

        // A press on Keep: its confirmation takes the cell, and the ladder goes invisible and hidden from assistive tech
        // while keeping its box, so the group keeps its height.
        const before = read.group!.height;
        await home.keepMove.click();
        await expect(home.keptNotice).toBeVisible();
        const cell = home.group.locator("[data-hero-ladder-cell]");
        await expect(cell, "390: the ladder's cell once Keep is pressed").toHaveAttribute("aria-hidden", "true");
        await expect(inCell, "390: the ladder is invisible once Keep is pressed").toBeHidden();
        expect(await inCell.evaluate((element) => element.getBoundingClientRect().height), "390: the hidden ladder keeps its box").toBeGreaterThan(0);
        const after = await ladders(page);
        expect(Math.abs(after.group!.height - before), `390: the group's height ${before} before the press, ${after.group!.height} after`).toBeLessThanOrEqual(0.5);
        const notice = await home.keptNotice.boundingBox();
        expect((notice?.y ?? 0) + (notice?.height ?? 0), "390: the confirmation ends by 844").toBeLessThanOrEqual(844);
      }
    });
  }

  test("at 320 x 640 and 768 x 1024 the page does not scroll sideways and the ladder lies inside the notice row", async ({ page }) => {
    const home = new HomePage(page);
    for (const size of [
      { width: 320, height: 640 },
      { width: 768, height: 1024 },
    ]) {
      const at = `${size.width} x ${size.height}`;
      await page.setViewportSize(size);
      await home.goto(DAYS.glastonbury.id);
      await expect(home.hero.locator(CELL), `${at}: the ladder's words`).toHaveText(LADDERS[0].text);
      await expectNoHorizontalScroll(page);
      const read = await ladders(page);
      expect(read.cell, `${at}: the ladder is drawn in the notice cell`).not.toBeNull();
      const [ladder, row] = [read.cell!.box!, read.notice!];
      for (const [edge, inside] of [
        ["top", ladder.top >= row.top - 0.5],
        ["bottom", ladder.bottom <= row.bottom + 0.5],
        ["left", ladder.left >= row.left - 0.5],
        ["right", ladder.right <= row.right + 0.5],
      ] as const) {
        expect(inside, `${at}: the ladder's ${edge} (${JSON.stringify(ladder)}) inside the notice row (${JSON.stringify(row)})`).toBe(true);
      }
    }
  });

  test("on the invented day the ladder says invented popularity and invented taste, in this app’s index, and names no Qloo", async ({ page, isPhone }) => {
    await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();
    const shown = home.hero.locator(isPhone ? CELL : ROOM);
    await expect(shown).toHaveText("Time alone #3 → + invented popularity #4 → + invented taste #1 of 31 in this app’s index");
    await expect(shown).not.toContainText("Qloo");
  });

  test("on a short desktop (1366 x 768) the one-row ladder and the whole drawing are on the first screen", async ({ page, isPhone }) => {
    test.skip(isPhone, "a desktop band");
    await page.setViewportSize({ width: 1366, height: 768 });
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    const shown = home.hero.locator(ROOM);
    await expect(shown.locator('[data-rung="taste"]')).toContainText("+ taste overlap #1 of 68");
    await expect(shown).toBeInViewport({ ratio: 1 });
    const read = await ladders(page);
    expect(Math.max(...read.room!.tops) - Math.min(...read.room!.tops), "1366 x 768: one row").toBeLessThanOrEqual(1);
    const drawing = await home.graph.locator(":scope > [data-layout]").filter({ visible: true }).first().boundingBox();
    expect((drawing?.y ?? 0) + (drawing?.height ?? 0), "1366 x 768: the drawing's bottom").toBeLessThanOrEqual(768);
  });
});
