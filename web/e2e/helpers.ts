import { expect, test, type Locator, type Page } from "@playwright/test";

/** The two saved festival days the local API serves, by the id the page puts in `?preset=`. */
export const DAYS = {
  glastonbury: { id: "glastonbury-2025-sun", title: "Glastonbury 2025, Sunday" },
  riot: { id: "riot-fest-2026-sun", title: "Riot Fest 2026, Sunday" },
} as const;

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
