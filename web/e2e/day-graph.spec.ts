import type { Page } from "@playwright/test";

import { DAYS, expectNoHorizontalScroll, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { serveInventedDay } from "./invented-day";
import { HomePage } from "./pages/home-page";

/**
 * The hero's day drawn as a graph (DECISION.md sections 4 and 5): the server paints its final frame, nothing
 * shifts after it, the first screen holds its budgets at 390 and 375 px, the toggle animates the move in 450 ms (and
 * not at all under reduced motion), the side-effect line is said in every state, the drawing's name says which view
 * it shows, and no colour on the first screen sits in the old orange band.
 */

/** The side-effect line of each published day's move, from the published times (DECISION.md 5.2, row 8). */
const SIDE_EFFECTS = {
  [DAYS.glastonbury.id]: "New 15 min overlap with Joy Crookes. Shortens 3 other overlaps by 15 min.",
  [DAYS.riot.id]: "Ends the 5 min overlap with Twin Peaks. No other overlap gets longer.",
} as const;

/** The hero's boxes that must not move once painted: pitch, picker, toggle, drawing, readout, Keep. */
const HERO_BOXES = {
  h1: "#pitch-heading",
  lede: "#pitch-heading + p",
  picker: '[role="radiogroup"][aria-label="Festival day"]',
  toggle: '[role="radiogroup"][aria-label="Drawing shows"]',
  drawing: "[data-day-graph]",
  readout: "[data-readout]",
  keep: "[data-hero-group] button",
} as const;

type Box = { x: number; y: number; width: number; height: number } | null;

/** The bottom edge of a locator's box in page pixels (the page is at the top when it is read). */
async function bottomOf(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).filter({ visible: true }).first().boundingBox();
  expect(box, `${selector} is drawn`).not.toBeNull();
  return (box?.y ?? 0) + (box?.height ?? 0);
}

/** Every animation whose target is inside the drawing, with its duration. */
function drawingAnimations(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-day-graph]");
    return document
      .getAnimations()
      .filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return Boolean(root && target && root.contains(target));
      })
      .map((animation) => Number(animation.effect?.getTiming().duration ?? 0));
  });
}

test.describe("the day graph", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, the first screen does not shift: no layout shift over 5 s, and the hero's boxes hold from DOMContentLoaded to 4 s`, async ({ page }) => {
      // Registered before the page's own scripts: a buffered layout-shift observer from navigation, and two
      // snapshots of the hero's boxes, 50 ms after DOMContentLoaded (the server's frame) and at 4 s.
      await page.addInitScript((selectors: Record<string, string>) => {
        const store = window as unknown as { __shift: number; __boxes: Record<string, unknown> };
        store.__shift = 0;
        store.__boxes = {};
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!entry.hadRecentInput) store.__shift += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        const snapshot = () =>
          Object.fromEntries(
            Object.entries(selectors).map(([name, selector]) => {
              const element = [...document.querySelectorAll(selector)].find((item) => item.getBoundingClientRect().width > 0);
              if (!element) return [name, null];
              const box = element.getBoundingClientRect();
              return [name, { x: box.x, y: box.y + window.scrollY, width: box.width, height: box.height }];
            }),
          );
        document.addEventListener("DOMContentLoaded", () => {
          window.setTimeout(() => (store.__boxes.early = snapshot()), 50);
          window.setTimeout(() => (store.__boxes.late = snapshot()), 4_000);
        });
      }, HERO_BOXES);

      await page.goto(`/?preset=${day.id}`, { waitUntil: "domcontentloaded" });
      await expect
        .poll(() => page.evaluate(() => performance.now() >= 5_000 && "late" in (window as unknown as { __boxes: object }).__boxes), {
          timeout: 20_000,
          message: "5 s on the page",
        })
        .toBe(true);
      const { shift, early, late } = await page.evaluate(() => {
        const store = window as unknown as { __shift: number; __boxes: Record<string, Record<string, Box>> };
        return { shift: store.__shift, early: store.__boxes.early, late: store.__boxes.late };
      });
      test.info().annotations.push({ type: `layout shift on ${day.title}`, description: shift.toFixed(4) });
      expect(shift, "cumulative layout shift over 5 s").toBeLessThan(0.0005);
      for (const name of Object.keys(HERO_BOXES)) {
        const [a, b] = [early[name], late[name]];
        expect(a, `${name} is in the server's frame`).not.toBeNull();
        expect(b, `${name} is there at 4 s`).not.toBeNull();
        for (const key of ["x", "y", "width", "height"] as const) {
          expect(Math.abs((a?.[key] ?? 0) - (b?.[key] ?? 0)), `${name} ${key}: ${a?.[key]} at DOMContentLoaded, ${b?.[key]} at 4 s`).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  for (const view of ["moved", "published"] as const) {
    test(`at 390 x 844, Keep this move ends by y = 787, and after Keep the whole confirmation ends by y = 844 (${view} view)`, async ({ page, isPhone }) => {
      test.skip(!isPhone, "The phone budget is measured at 390 x 844.");
      const home = new HomePage(page);
      await home.goto(DAYS.glastonbury.id);

      if (view === "published") await home.chooseView("As published");
      await expect(home.graph).toHaveAttribute("data-view", view);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const keep = await home.keepMove.boundingBox();
      expect((keep?.y ?? 0) + (keep?.height ?? 0), "Keep this move bottom").toBeLessThanOrEqual(787);
      // The side effects are on the first screen too.
      expect(await bottomOf(page, "[data-side-effects]"), "side-effect line bottom").toBeLessThanOrEqual(844);

      await home.keepMove.click();
      await expect(home.keptNotice).toBeVisible();
      expect(await page.evaluate(() => window.scrollY), "no scroll was needed").toBe(0);
      const notice = await home.keptNotice.boundingBox();
      expect((notice?.y ?? 0) + (notice?.height ?? 0), "the whole confirmation, its last line included").toBeLessThanOrEqual(844);
      await expect(home.keptNotice).toContainText("Nothing moves until the acts’ teams agree.");
    });
  }

  for (const view of ["moved", "published"] as const) {
    test(`at 375 x 667 the drawing has no overview strip, the side effects and Keep hold their budgets, and Keep brings its whole confirmation into view (${view} view)`, async ({ page, isPhone }) => {
      test.skip(!isPhone, "A short phone, measured in the phone project.");
      await page.setViewportSize({ width: 375, height: 667 });
      const home = new HomePage(page);
      await home.goto(DAYS.glastonbury.id);

      // The short layout: three rows, no overview strip.
      await expect(home.graph.locator('[data-layout="short"]')).toBeVisible();
      await expect(home.graph.locator('[data-layout="phone"]')).toBeHidden();
      await expect(home.graph.locator("[data-strip]").filter({ visible: true })).toHaveCount(0);
      if (view === "published") await home.chooseView("As published");
      await expect(home.graph).toHaveAttribute("data-view", view);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(await bottomOf(page, "[data-side-effects]"), "side-effect line bottom").toBeLessThanOrEqual(667);
      const keep = await home.keepMove.boundingBox();
      expect((keep?.y ?? 0) + (keep?.height ?? 0), "Keep this move bottom").toBeLessThanOrEqual(760);

      await home.keepMove.click();
      await expect(home.keptNotice).toBeVisible();
      await expect(home.seeYourPlan).toBeFocused();
      // The whole confirmation, "Nothing moves until the acts' teams agree." included, is on the screen.
      await expect(home.keptNotice).toBeInViewport({ ratio: 1 });
    });
  }

  test("no width from 320 to 1440 scrolls the page sideways", async ({ page, isPhone }) => {
    test.skip(isPhone, "The desktop project loads each width in turn.");
    const home = new HomePage(page);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await home.goto(DAYS.glastonbury.id);
      expect(await page.evaluate(() => window.innerWidth), "the width under test").toBe(width);
      await expectNoHorizontalScroll(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `scrollWidth at ${width}`).toBeLessThanOrEqual(width);
    }
  });

  test("the hero says what it needs in at most 120 visible words at 1440 and 117 at 390", async ({ page, isPhone }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    // Counted as DECISION.md 4.3 says: visible text in the hero that holds a letter, not screen-reader text; inside
    // the drawing only its tags count (act names, stage names and clock times are the drawing itself); numerals
    // are not words; the picker's and the toggle's group names are accessible names, not visible text.
    const counted = await page.locator("[data-hero]").evaluate((hero) => {
      const shown = (element: Element | null): boolean => {
        for (let node = element; node && node !== hero.parentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const box = node.getBoundingClientRect();
          if (box.width <= 1 && box.height <= 1) return false;
        }
        return true;
      };
      const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
      const words: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || !node.textContent?.trim() || !shown(parent)) continue;
        if (parent.closest("[data-day-graph]") && !parent.closest("[data-shared-tag]")) continue;
        words.push(...node.textContent.split(/\s+/).filter((token) => /\p{L}/u.test(token)));
      }
      return words;
    });
    const budget = isPhone ? 117 : 120;
    test.info().annotations.push({ type: `hero words at ${isPhone ? 390 : 1440}`, description: String(counted.length) });
    expect(counted.length, `visible hero words: ${counted.join(" ")}`).toBeLessThanOrEqual(budget);
    // The guarded lines are never trimmed to fit.
    await expect(home.tasteLine).toContainText("(a rank, not attendance)");
    await expect(home.attribution).toHaveText("Selected and scored by this app’s index. A reading, not a verdict.");
  });

  test.describe("with motion allowed", () => {
    test.use({ reducedMotion: "no-preference" });

    test("a toggle press moves the set in 450 ms, every animation in the drawing, and settles on the other view", async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(DAYS.glastonbury.id);
      expect(await drawingAnimations(page), "nothing moves on first paint").toEqual([]);

      await home.chooseView("As published");
      const durations = await drawingAnimations(page);
      expect(durations.length, "the press starts the move").toBeGreaterThan(0);
      for (const duration of durations) expect(Math.abs(duration - 450), `an animation of ${duration} ms`).toBeLessThanOrEqual(20);
      await expect(home.graph).toHaveAttribute("data-view", "published");
      // The settled view carries the published windows and no ghost.
      await expect.poll(() => drawingAnimations(page).then((all) => all.length), { timeout: 3_000, message: "the move settles" }).toBe(0);
      await expect(home.graph.locator("[data-ghost]").filter({ visible: true })).toHaveCount(0);
      await expect(home.graph.locator('[data-shared-tag="hatch"]').filter({ visible: true })).toHaveText("45 min shared");

      // And back: the move again, in the same time.
      await home.chooseView("Sprints 15 min later");
      const back = await drawingAnimations(page);
      expect(back.length).toBeGreaterThan(0);
      for (const duration of back) expect(Math.abs(duration - 450), `an animation of ${duration} ms`).toBeLessThanOrEqual(20);
      await expect.poll(() => drawingAnimations(page).then((all) => all.length), { timeout: 3_000 }).toBe(0);
      await expect(home.graph.locator("[data-ghost]").filter({ visible: true })).toHaveCount(1);
      await expect(home.graph.locator('[data-shared-tag="hatch"]').filter({ visible: true })).toHaveText("30 min shared");
    });
  });

  test("with reduced motion a toggle press creates no animation in the drawing: the view swaps at once", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.chooseView("As published");
    expect(await home.graph.getAttribute("data-view")).toBe("published");
    expect(await drawingAnimations(page), "no animation under reduced motion").toEqual([]);
    await home.chooseView("Sprints 15 min later");
    expect(await home.graph.getAttribute("data-view")).toBe("moved");
    expect(await drawingAnimations(page)).toEqual([]);
  });

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, the side-effect line is said in the server HTML, in both views, and after Keep`, async ({ page }) => {
      const line = SIDE_EFFECTS[day.id];
      // The server's own frame: the line is in the HTML before any script runs.
      const html = await (await page.request.get(`/?preset=${day.id}`)).text();
      expect(html, "the server HTML holds the side-effect line").toMatch(new RegExp(`data-side-effects=""[^>]*>${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`));

      const home = new HomePage(page);
      await home.goto(day.id);
      await expect(home.sideEffects).toHaveText(line);
      await home.chooseView("As published");
      await expect(home.sideEffects).toHaveText(line);
      await home.keepMove.click();
      await expect(home.keptNotice).toBeVisible();
      await expect(home.sideEffects).toHaveText(line);
      await home.chooseView(/ min (later|earlier)$/);
      await expect(home.sideEffects).toHaveText(line);
      // The drawing's description says it too, after the key and the move.
      await expect(home.graph).toHaveAccessibleDescription(new RegExp(`${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    });
  }

  test("the drawing's name says which view it shows", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.graph).toHaveAccessibleName(`${DAYS.glastonbury.title}, drawn with Sprints 15 min later: 39 sets on 5 stages`);
    await home.chooseView("As published");
    await expect(home.graph).toHaveAccessibleName(`${DAYS.glastonbury.title}, as published: 39 sets on 5 stages`);

    await home.goto(DAYS.riot.id);
    await expect(home.graph).toHaveAccessibleName(/^Riot Fest 2026, Sunday, drawn with Bowling for Soup 20 min later: \d+ sets on \d+ stages$/);
    await home.chooseView("As published");
    await expect(home.graph).toHaveAccessibleName(/^Riot Fest 2026, Sunday, as published: \d+ sets on \d+ stages$/);
  });

  test("the hero's colours keep one meaning per hue: nothing on the first screen sits between hue 15 and 75", async ({ page, isPhone }) => {
    // Light at 1440 and dark at 390, as the corner checks are measured.
    const theme = isPhone ? "dark" : "light";
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    await page.emulateMedia({ colorScheme: theme });
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    expect(await home.chrome.appliedTheme()).toBe(theme);

    const warm = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      // sRGB to OKLCH (Björn Ottosson's OKLab): chroma and hue in degrees.
      const oklch = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = "rgba(0, 0, 0, 0)";
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r8, g8, b8, a] = context.getImageData(0, 0, 1, 1).data;
        if (a === 0) return null;
        const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        const [r, g, b] = [r8, g8, b8].map((v) => lin(v / 255));
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
        const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
        return { chroma: Math.hypot(A, B), hue: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
      };
      const hero = document.querySelector("[data-hero]") as HTMLElement;
      const elements = [hero, ...hero.querySelectorAll<HTMLElement | SVGElement>("*")].filter((element) => element.getBoundingClientRect().width > 0);
      const found: string[] = [];
      for (const element of elements) {
        const style = getComputedStyle(element);
        const colours = [style.color, style.backgroundColor, style.borderTopColor, style.borderBottomColor, style.outlineColor];
        if (element instanceof SVGElement) colours.push(style.fill, style.stroke);
        for (const colour of colours) {
          if (!colour || colour === "none" || colour.startsWith("url(")) continue;
          const value = oklch(colour);
          if (value && value.chroma >= 0.05 && value.hue >= 15 && value.hue <= 75) {
            found.push(`${element.tagName.toLowerCase()} ${colour} (hue ${value.hue.toFixed(0)}, chroma ${value.chroma.toFixed(3)})`);
          }
        }
      }
      return found;
    });
    expect(warm, "computed colours with a hue between 15 and 75 in the hero").toEqual([]);
  });

  test("the page loads with no console error and no hydration warning, on both days", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()) && /hydrat|did not match|server rendered|server html/i.test(message.text())) warnings.push(message.text());
    });
    const home = new HomePage(page);
    for (const day of Object.values(DAYS)) {
      await home.goto(day.id);
      await home.chooseView("As published");
      await home.chooseView(/ min (later|earlier)$/);
    }
    expect(warnings, "hydration warnings").toEqual([]);
  });
});

test.describe("the day graph on the invented day", () => {
  test("its name says the timetable is invented and never calls it published, in both views", async ({ page }) => {
    await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();

    await expect(home.graph).toHaveAccessibleName(/, invented timetable, drawn with .+: \d+ sets on \d+ stages$/);
    await home.chooseView("Invented timetable");
    await expect(home.graph).toHaveAccessibleName(/, invented timetable, without the move: \d+ sets on \d+ stages$/);
    for (const name of [await home.graph.getAttribute("aria-labelledby")]) {
      expect(await page.evaluate((id) => document.getElementById(id ?? "")?.textContent ?? "", name)).not.toMatch(/published/i);
    }
  });
});
