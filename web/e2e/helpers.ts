import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The two saved festival days the local API serves, by the id the page puts in `?preset=`. `festival` is the
 * hero picker's label (the title before its first ", "); the day's name opens the dateline under it.
 */
export const DAYS = {
  glastonbury: { id: "glastonbury-2025-sun", title: "Glastonbury 2025, Sunday", festival: "Glastonbury 2025", dayName: "Sunday" },
  riot: { id: "riot-fest-2026-sun", title: "Riot Fest 2026, Sunday", festival: "Riot Fest 2026", dayName: "Sunday" },
} as const;

/**
 * How long a page-readiness wait may take: hydration, and the day's data arriving from the API. On a dev server
 * running four workers this can pass the default 10 s expect timeout, so readiness waits (not assertions about
 * content) use the navigation timeout instead. A wait on an element returns as soon as it holds.
 */
export const READY_TIMEOUT = 30_000;

/** The two lines the site must always say, wherever the figures come from. */
export const HONESTY = {
  reading: "A reading, not a verdict.",
  neither: "Neither festival uses Clash Control.",
} as const;

/** Escapes a name for use inside a regular expression. */
export function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A name that matches only the whole accessible name or its start, ignoring case. */
export function startsWith(text: string): RegExp {
  return new RegExp(`^${literal(text)}`, "i");
}

export type Overflow = {
  viewport: number;
  scrollWidth: number;
  /** How far the page scrolls sideways, in pixels (0 or less is none). */
  excess: number;
  /** The widest culprits, when there is excess: the element and how far its right edge is past the viewport. */
  offenders: string[];
};

/**
 * Measures sideways scrolling of the page itself. A board that scrolls inside its own scroller is fine;
 * this looks at the document, and names the elements that reach past the viewport when it overflows.
 */
export async function horizontalOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const viewport = root.clientWidth;
    const scrollWidth = Math.max(root.scrollWidth, document.body.scrollWidth);
    const offenders: string[] = [];
    if (scrollWidth > viewport) {
      for (const element of document.body.querySelectorAll("*")) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.right <= viewport + 1) continue;
        // Inside a box that scrolls on its own, reaching past the edge is the point of it.
        let scroller = element.parentElement;
        let contained = false;
        while (scroller && scroller !== document.body) {
          const { overflowX } = getComputedStyle(scroller);
          if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden" || overflowX === "clip") {
            contained = true;
            break;
          }
          scroller = scroller.parentElement;
        }
        if (contained) continue;
        const tag = element.tagName.toLowerCase();
        const cls = typeof element.className === "string" ? element.className.trim().split(/\s+/).slice(0, 4).join(".") : "";
        offenders.push(`${tag}${cls ? `.${cls}` : ""} (+${Math.round(box.right - viewport)}px)`);
        if (offenders.length >= 6) break;
      }
    }
    return { viewport, scrollWidth, excess: scrollWidth - viewport, offenders };
  });
}

/**
 * Fails with the offending elements named when the page scrolls sideways. A resize can leave the board's line
 * layer one frame behind (it is re-measured after the new width lands), so it is given a moment to settle;
 * an overflow that stays is a real one.
 */
export async function expectNoHorizontalScroll(page: Page, settle = 3_000): Promise<void> {
  let last = await horizontalOverflow(page);
  try {
    await expect.poll(async () => (last = await horizontalOverflow(page)).excess, { timeout: settle }).toBeLessThanOrEqual(0);
  } catch {
    expect(last.excess, `the page scrolls sideways by ${last.excess}px: ${last.offenders.join(", ")}`).toBeLessThanOrEqual(0);
  }
}

/** Scrolls the page to the bottom in steps, so lazy content and sticky bars have all been laid out once. */
export async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = Math.max(400, Math.floor((page.viewportSize()?.height ?? 800) * 0.8));
  for (let y = 0; y < height; y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * The text a sighted visitor sees inside each element: its text nodes, less any inside a screen-reader-only box
 * (clipped to 1 px) or a box that is not rendered. `innerText` keeps screen-reader text, so it cannot say this.
 */
export async function visibleTexts(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((all) =>
    all.map((root) => {
      const shown = (element: Element | null): boolean => {
        for (let node = element; node && node !== root.parentElement; node = node.parentElement) {
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return false;
          if (box.width <= 1 && box.height <= 1) return false;
        }
        return true;
      };
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const parts: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.trim() && shown(node.parentElement)) parts.push(node.textContent);
      }
      return parts.join(" ").replace(/\s+/g, " ").trim();
    }),
  );
}

/** The accessible name of whatever has keyboard focus, or its text when it has none. */
export async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return "";
    return (
      element.getAttribute("aria-label") ??
      (element as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ??
      element.textContent?.trim() ??
      ""
    );
  });
}

/** Presses Tab until the locator has focus, at most `limit` times; returns how many presses it took. */
export async function tabTo(page: Page, target: Locator, limit = 60): Promise<number> {
  for (let presses = 1; presses <= limit; presses++) {
    await page.keyboard.press("Tab");
    const focused = await target.evaluate((element) => element === document.activeElement).catch(() => false);
    if (focused) return presses;
  }
  throw new Error(`Tab did not reach the target within ${limit} presses`);
}

/** What the saved days the API serves are: the ids from `GET /api/presets`, and whether they are invented. */
export async function listDays(page: Page): Promise<{ id: string; synthetic: boolean }[]> {
  const response = await page.request.get("/api/presets");
  expect(response.ok(), "GET /api/presets").toBeTruthy();
  const list = (await response.json()) as { id: string; synthetic?: boolean }[];
  return list.map((item) => ({ id: item.id, synthetic: item.synthetic === true }));
}

/**
 * Skips the test unless the API serves the saved festival days (`DAYS`). A clone without the built presets
 * serves only the invented day, and the specs that read a published day cannot run there.
 */
export async function requireSavedDays(page: Page): Promise<void> {
  const days = await listDays(page);
  const ids = new Set(days.filter((day) => !day.synthetic).map((day) => day.id));
  const missing = Object.values(DAYS).filter((day) => !ids.has(day.id));
  test.skip(missing.length > 0, `the API does not serve ${missing.map((day) => day.id).join(", ")}`);
}

/**
 * Where the sticky bars at the top of the screen end, in viewport pixels: the site header, and under it the home page's
 * section nav where that sticks too (from 768 px). A bar that is not stuck to the top at this moment is left out.
 */
export async function stickyBarsFoot(page: Page): Promise<number> {
  const bars = [page.getByRole("banner"), page.getByRole("navigation", { name: "On this page" })];
  let foot = 0;
  for (const bar of bars) {
    if ((await bar.count()) === 0) continue;
    const { top, bottom, position } = await bar.first().evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, position: getComputedStyle(element).position };
    });
    if ((position === "sticky" || position === "fixed") && top >= -1 && top <= foot + 1) foot = Math.max(foot, bottom);
  }
  return foot;
}

/** A computed colour as RGB, whatever notation the browser reports it in (oklch included). */
export async function rgbOf(page: Page, selector: string, property: "backgroundColor" | "color"): Promise<[number, number, number]> {
  return page.evaluate(
    ([sel, prop]) => {
      const element = document.querySelector(sel) as HTMLElement;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.fillStyle = "#000";
      context.fillStyle = getComputedStyle(element)[prop as "color"];
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b] as [number, number, number];
    },
    [selector, property] as const,
  );
}

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: [number, number, number]): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** How many pages a PDF made by `page.pdf()` has. */
export function pdfPages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/**
 * A pasted draft grid with one line that cannot be read (round 35): twelve invented acts, line 4 starting at 25:70,
 * and one stage written "Main   Stage". The check reads the other eleven lines and lists line 4 as skipped.
 */
export const MESSY_GRID = [
  "Tidal Fields,Main Stage,14:00,15:00",
  "Cobalt Rows,Side Stage,14:15,15:15",
  "Paper Lanterns,Tent,14:30,15:15",
  "Glass Harbour,Tent,25:70,19:30",
  "Saltmarsh,Main Stage,15:30,16:30",
  "Quiet Engine,Side Stage,15:45,16:45",
  "Nobody Has Heard Of Us,Tent,16:00,16:45",
  "Velvet Static,Main   Stage,17:00,18:00",
  "Orbit Choir,Side Stage,17:15,18:15",
  "Lowland Kites,Tent,17:30,18:15",
  "Amber Kite,Main Stage,18:30,19:30",
  "Ember Coast,Side Stage,18:45,19:45",
].join("\n");

/** What a check of MESSY_GRID says first, and its no-breaks line. */
export const MESSY_SKIPPED = "1 line skipped and not checked: line 4. The other 11 sets were checked.";
export const MESSY_NO_BREAKS = "No rule breaks found among the 11 sets checked, against the settings above.";

/** Why MESSY_GRID's line 4 was skipped (round 36): the act on the line, and the value it could not read, quoted. */
export const MESSY_LINE_4 = 'Line 4 (Glass Harbour): the start time "25:70" is not a time such as 18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm.';
