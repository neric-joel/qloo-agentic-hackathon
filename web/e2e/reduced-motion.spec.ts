import type { Page } from "@playwright/test";

import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";

/**
 * With reduced motion the page shows every end state at once: no opening, no reveal, the day drawn at its final
 * frame, the drawing's toggle swapping the view without a move, "Keep this move" with no press scale, and "See
 * your plan" jumping without a smooth scroll. The suite runs with reduced motion by default; this spec says so on
 * its own, so the promise holds if that default changes.
 */

/** Animations that are still running on the page. */
const running = (page: Page) => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length);

/** Every animation on the page whose target sits inside `selector` (CSS transitions included). */
const animationsIn = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const root = document.querySelector(sel);
    return document.getAnimations().filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return Boolean(root && target && root.contains(target));
    }).length;
  }, selector);

/** Waits two animation frames, so anything a press starts has started. */
const twoFrames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/**
 * Records, from before the page's own scripts run, every CSS animation start, every CSS transition start (and run)
 * and every animation made through the Web Animations API (`Element.prototype.animate`), anywhere on the page.
 */
async function recordMotion(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as { __motion: { kind: string; at: number; what: string }[] };
    store.__motion = [];
    const name = (target: EventTarget | null) => {
      const element = target as Element | null;
      if (!element || !("tagName" in element)) return String(target);
      const cls = (element.getAttribute("class") ?? "").trim().split(/\s+/).slice(0, 3).join(".");
      return `${element.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`;
    };
    for (const kind of ["animationstart", "transitionstart", "transitionrun"]) {
      window.addEventListener(
        kind,
        (event) => {
          const detail = event as AnimationEvent & TransitionEvent;
          store.__motion.push({ kind, at: performance.now(), what: `${name(event.target)} ${detail.animationName ?? detail.propertyName ?? ""}`.trim() });
        },
        true,
      );
    }
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
      store.__motion.push({ kind: "animate", at: performance.now(), what: name(this) });
      return animate.apply(this, args);
    };
  });
}

/**
 * Loads a home day and waits out the first 3 s of the load, or until 1.5 s after the page is ready when a slow
 * server makes it later, then reports what moved and what is still animating.
 */
async function firstLoadMotion(page: Page, day: string): Promise<{ starts: string[]; runs: string[]; running: string[] }> {
  await recordMotion(page);
  const home = new HomePage(page);
  await home.goto(day);
  const ready = await page.evaluate(() => performance.now());
  const until = Math.max(3_000, ready + 1_500);
  await expect.poll(() => page.evaluate(() => performance.now()), { timeout: 20_000, message: "the first seconds of the load" }).toBeGreaterThanOrEqual(until);
  return page.evaluate(() => {
    const motion = (window as unknown as { __motion: { kind: string; at: number; what: string }[] }).__motion;
    return {
      starts: motion.filter((item) => item.kind !== "transitionrun").map((item) => `${item.kind} ${item.what} at ${Math.round(item.at)} ms`),
      runs: motion.filter((item) => item.kind === "transitionrun").map((item) => `${item.what} at ${Math.round(item.at)} ms`),
      running: document.getAnimations().map((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
        return `${target?.tagName.toLowerCase() ?? "?"} ${(animation as CSSAnimation).animationName ?? (animation as CSSTransition).transitionProperty ?? ""}`;
      }),
    };
  });
}

test.describe("nothing moves on first paint, with motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  for (const day of Object.values(DAYS)) {
    test(`a load of ${day.title} starts no CSS animation, no CSS transition and no Web Animation anywhere on the page, and nothing is animating once it settles`, async ({ page }) => {
      const found = await firstLoadMotion(page, day.id);
      test.info().annotations.push({ type: `first-load motion on ${day.title}`, description: `${found.starts.length} starts, ${found.runs.length} transition runs, ${found.running.length} running` });
      expect(found.starts, "animation starts, transition starts and animate() calls in the first seconds").toEqual([]);
      expect(found.running, "document.getAnimations() once the load has settled").toEqual([]);
    });
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("a load starts no animation or transition anywhere on the page, and nothing is animating once it settles", async ({ page }) => {
    const found = await firstLoadMotion(page, DAYS.glastonbury.id);
    expect(found.starts, "animation starts, transition starts and animate() calls in the first seconds").toEqual([]);
    expect(found.running, "document.getAnimations() once the load has settled").toEqual([]);
  });

  test("a first visit shows no opening and no reveal: the day is drawn at its final frame", async ({ page }) => {
    const home = new HomePage(page);
    await page.goto(`/?preset=${DAYS.glastonbury.id}`, { waitUntil: "domcontentloaded" });
    await expect(home.heading).toBeVisible();
    // No opening: nothing sits over the heading, which is fully drawn from the first paint.
    const firstPaint = await home.heading.evaluate((heading) => {
      const box = heading.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      let opacity = 1;
      for (let node: Element | null = heading; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return { covered: Boolean(hit && !heading.contains(hit)), opacity };
    });
    expect(firstPaint.covered, "nothing covers the heading").toBe(false);
    expect(firstPaint.opacity, "neither the heading nor anything around it is faded in").toBe(1);
    await home.waitUntilReady();

    // The drawing is on the move, and the index card reads its result at once: no count-up.
    await expect(home.graph).toHaveAttribute("data-view", "moved");
    const { before, after } = await home.indexFigures();
    await expect(home.indexBlock).toContainText(`${before} → ${after}`);
    expect(await running(page), "nothing animates under reduced motion").toBe(0);
  });

  test("the drawing's toggle swaps the view at once, with no animation in the drawing", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.chooseView("As published");
    // The swap is immediate: the next check finds the published view and nothing animating in the drawing.
    expect(await home.graph.getAttribute("data-view")).toBe("published");
    expect(await animationsIn(page, "[data-day-graph]"), "no animation in the drawing").toBe(0);
    await twoFrames(page);
    expect(await animationsIn(page, "[data-day-graph]"), "still none two frames later").toBe(0);
    await expect(home.graph).toHaveAccessibleName(/, as published: \d+ sets on \d+ stages$/);

    await home.chooseView("Sprints 15 min later");
    expect(await home.graph.getAttribute("data-view")).toBe("moved");
    await twoFrames(page);
    expect(await animationsIn(page, "[data-day-graph]")).toBe(0);
    // The segmented thumb moves with no transition either.
    expect(await animationsIn(page, '[role="radiogroup"][aria-label="Drawing shows"]'), "the toggle's thumb jumps").toBe(0);
  });

  test("Keep this move shows its end state at once and does not scroll; See your plan jumps without a smooth scroll", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.keepMove.scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() => window.scrollY);
    await home.keepMove.click();
    await expect(home.keptNotice).toBeVisible();
    await expect(home.seeYourPlan).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    // No press scale on the button, and nothing else plays.
    expect(await home.keepMove.evaluate((button) => button.getAnimations().length), "Keep starts no animation").toBe(0);
    expect(await home.keepMove.evaluate((button) => getComputedStyle(button).scale), "Keep is not scaled").toMatch(/^(none|1)$/);
    expect(await running(page), "nothing plays after the press").toBe(0);

    // The jump lands in one step: where the page is right after the press is where it stays.
    await home.seeYourPlan.click();
    const landed = await page.evaluate(() => window.scrollY);
    expect(landed, "the page moved to the plan").toBeGreaterThan(scrolled);
    await expect(home.plan).toBeFocused();
    await expect(home.plan).toBeInViewport();
    await twoFrames(page);
    expect(await page.evaluate(() => window.scrollY), "no smooth scroll still under way").toBe(landed);
  });
});
