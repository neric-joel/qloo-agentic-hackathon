import type { Locator, Page } from "@playwright/test";

import { DAYS, requireSavedDays, scrollThrough } from "./helpers";
import { expect, test } from "./fixtures";
import { CheckPage } from "./pages/check-page";
import { HomePage } from "./pages/home-page";
import { TryAMove } from "./pages/try-a-move";

/**
 * One radius system (owner order, DECISION.md section 2.6): 6 px for marks in a drawing and small labels, 10 px for
 * controls, tiles, inset blocks and notes (every button), 14 px for cards and panels, full round only for dots and
 * discs. Measured as computed `border-radius` or SVG `rx`, at 1440 x 900 in the light theme (desktop project) and
 * 390 x 844 in the dark (phone project), and in print for /brief and /check. No box is sharp, in light, dark or
 * print; rules, axes, knockout plates, fills clipped inside a rounded mark, table cells and the screen-edge side
 * of a sheet are not boxes (2.6.2) and stay straight.
 */

type Sweep = { sharp: string[]; rects: string[]; pills: string[] };

/**
 * The page-wide sweep, run in the page. A box is an element with a visible border on two or more sides, or a fill
 * unlike the surface behind it; a sharp box is one whose four corners all compute 0px. Not boxes: anything 3 px or
 * less across (rules, axes, hairlines), a top-and-bottom rule pair on an unfilled element, a fill equal to what it
 * sits on (a knockout plate), a fill clipped by a rounded ancestor whose edge it touches, table cells, and sheets
 * (measured on their own). SVG: every painted rect has an rx unless a clip contains it. Pills: a box taller than
 * 12 px whose corner is half its height or more and that is not a disc.
 */
function sweepCorners(): Sweep {
  const px = (value: string) => parseFloat(value) || 0;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const rgba = (colour: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "rgba(0, 0, 0, 0)";
    context.fillStyle = colour;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const same = (a: number[], b: number[]) => a.every((value, i) => Math.abs(value - b[i]) <= 2);
  const describe = (element: Element) => {
    const cls = (element.getAttribute("class") ?? "").trim().split(/\s+/).slice(0, 6).join(".");
    const data = [...element.attributes].filter((attribute) => attribute.name.startsWith("data-")).map((attribute) => attribute.name).join(",");
    const box = element.getBoundingClientRect();
    return `${element.tagName.toLowerCase()}${data ? `[${data}]` : ""}${cls ? `.${cls}` : ""} "${(element.textContent ?? "").trim().slice(0, 40)}" ${Math.round(box.width)}x${Math.round(box.height)}`;
  };
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && px(style.opacity) > 0;
  };
  const surfaceBehind = (element: Element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const colour = rgba(getComputedStyle(parent).backgroundColor);
      if (colour[3] > 0) return colour;
    }
    return rgba(getComputedStyle(document.body).backgroundColor);
  };
  const clippedByRoundedMark = (element: Element) => {
    const box = element.getBoundingClientRect();
    for (let parent = element.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
      const style = getComputedStyle(parent);
      const clips = style.overflowX !== "visible" || style.overflowY !== "visible" || style.clipPath !== "none";
      if (!clips || px(style.borderTopLeftRadius) + px(style.borderBottomRightRadius) === 0) continue;
      const edge = parent.getBoundingClientRect();
      const touches =
        Math.abs(box.left - edge.left) < 2 || Math.abs(box.right - edge.right) < 2 || Math.abs(box.top - edge.top) < 2 || Math.abs(box.bottom - edge.bottom) < 2;
      if (touches || box.left < edge.left || box.right > edge.right) return true;
    }
    return false;
  };
  const SKIP = new Set(["HTML", "BODY", "TD", "TH", "TR", "THEAD", "TBODY", "TFOOT", "TABLE", "IMG", "PICTURE", "VIDEO", "CANVAS", "BR"]);
  const sharp: string[] = [];
  const pills: string[] = [];
  for (const element of document.body.querySelectorAll("*")) {
    if (SKIP.has(element.tagName) || element instanceof SVGElement || !visible(element)) continue;
    if (element.closest("[role=dialog]")) continue;
    const box = element.getBoundingClientRect();
    if (box.width <= 3 || box.height <= 3) continue;
    const style = getComputedStyle(element);
    const sides = (["Top", "Right", "Bottom", "Left"] as const).filter(
      (side) =>
        px(style[`border${side}Width`]) > 0 &&
        !["none", "hidden"].includes(style[`border${side}Style`]) &&
        rgba(style[`border${side}Color`])[3] > 0,
    );
    const fill = rgba(style.backgroundColor);
    const filled = (fill[3] > 0 && !same(fill, surfaceBehind(element))) || style.backgroundImage !== "none";
    const rulePair = !filled && sides.length === 2 && sides.includes("Top") && sides.includes("Bottom");
    if (!(sides.length >= 2 || filled) || rulePair) continue;
    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(px);
    const radius = Math.min(radii[0], box.height / 2);
    if (box.height > 12 && radius >= box.height / 2 - 0.5 && box.width > box.height * 1.15) pills.push(describe(element));
    if (radii.some((value) => value > 0)) continue;
    if (filled && sides.length < 2 && clippedByRoundedMark(element)) continue;
    sharp.push(describe(element));
  }
  const rects: string[] = [];
  for (const rect of document.querySelectorAll("svg rect")) {
    if (rect.closest("clipPath, mask, pattern, defs, symbol")) continue;
    const box = rect.getBoundingClientRect();
    if (box.width <= 3 || box.height <= 3) continue;
    const style = getComputedStyle(rect);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const painted = (style.fill !== "none" && !(style.fill.startsWith("rgb") && rgba(style.fill)[3] === 0)) || style.stroke !== "none";
    if (!painted) continue;
    const rx = px(style.rx) || px(style.ry) || px(rect.getAttribute("rx") ?? "") || px(rect.getAttribute("ry") ?? "");
    if (rx > 0) continue;
    let clipped = false;
    for (let node: Element | null = rect; node && node.tagName.toLowerCase() !== "svg"; node = node.parentElement) {
      if ((node.getAttribute("clip-path") ?? "") !== "" || getComputedStyle(node).clipPath !== "none") clipped = true;
    }
    if (!clipped) rects.push(describe(rect));
  }
  return { sharp, rects, pills };
}

/** Each corner of an element, as computed: [top-left, top-right, bottom-right, bottom-left]. */
async function corners(locator: Locator): Promise<string[]> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
  });
}

/** Every visible element of a locator's set, with its four corners. */
async function allCorners(locator: Locator): Promise<{ name: string; radii: string[] }[]> {
  return locator.evaluateAll((all) =>
    all
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          name: `${element.tagName.toLowerCase()} "${(element.textContent ?? element.getAttribute("aria-label") ?? "").trim().slice(0, 40)}"`,
          radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
        };
      }),
  );
}

/** Expects every visible element of the set to compute this radius on all four corners (and at least one to exist). */
async function expectRadius(locator: Locator, radius: string, what: string): Promise<void> {
  await expect(locator.filter({ visible: true }).first(), `${what} is drawn`).toBeVisible();
  const found = await allCorners(locator);
  expect(found.length, `${what}: at least one is drawn`).toBeGreaterThan(0);
  for (const item of found) expect(item.radii, `${what}: ${item.name}`).toEqual([radius, radius, radius, radius]);
}

/** An SVG rect's corner radius, as computed. */
async function rxOf(locator: Locator): Promise<{ rx: number; width: number }> {
  return locator.evaluate((rect) => ({ rx: parseFloat(getComputedStyle(rect).rx) || parseFloat(rect.getAttribute("rx") ?? "") || 0, width: rect.getBoundingClientRect().width }));
}

/** The theme each project is measured in: light at 1440, dark at 390. */
async function useSeatTheme(page: Page, isPhone: boolean): Promise<"light" | "dark"> {
  const theme = isPhone ? "dark" : "light";
  await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
  await page.emulateMedia({ colorScheme: theme });
  return theme;
}

/** Puts the pointer on the page into keyboard mode, so a scripted focus draws the ring a Tab would. */
async function keyboardFocus(page: Page, target: Locator): Promise<void> {
  await page.keyboard.press("Shift");
  await target.focus();
}

const ROUTES = [
  { name: "home, Glastonbury", url: `/?preset=${DAYS.glastonbury.id}`, home: true },
  { name: "home, Riot Fest", url: `/?preset=${DAYS.riot.id}`, home: true },
  { name: "/method", url: "/method", home: false },
  { name: "/check, after checking the sample grid", url: "/check", home: false },
  { name: "/brief", url: `/brief?preset=${DAYS.glastonbury.id}&day=0`, home: false },
] as const;

test.describe("corners: one radius system", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  for (const route of ROUTES) {
    test(`${route.name}: no sharp box, no square SVG mark, no pill`, async ({ page, isPhone }) => {
      const theme = await useSeatTheme(page, isPhone);
      if (route.home) {
        await new HomePage(page).goto(route.url.slice("/?preset=".length));
      } else if (route.url === "/check") {
        const check = new CheckPage(page);
        await check.goto();
        await check.checkButton.click();
        await expect(check.announcement).toHaveText(/^Rule breaks: \d+/);
      } else {
        await page.goto(route.url, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await new HomePage(page).chrome.waitForHydration();
      }
      expect(await new HomePage(page).chrome.appliedTheme(), "measured in the seat's theme").toBe(theme);
      await scrollThrough(page);

      const found = await page.evaluate(sweepCorners);
      expect(found.sharp, "boxes with four square corners").toEqual([]);
      expect(found.rects, "painted SVG rects with no rx").toEqual([]);
      expect(found.pills, "pill-shaped boxes").toEqual([]);

      // Print keeps the screen's corners on the two pages that print.
      if (route.url.startsWith("/brief") || route.url === "/check") {
        await page.emulateMedia({ media: "print" });
        const printed = await page.evaluate(sweepCorners);
        expect(printed.sharp, "in print: boxes with four square corners").toEqual([]);
        expect(printed.rects, "in print: painted SVG rects with no rx").toEqual([]);
        expect(printed.pills, "in print: pill-shaped boxes").toEqual([]);
      }
    });
  }

  test("the day drawing's marks: 6px bars, ghost and windows, 2px clear of both bars; round end dots; 10px hit areas", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const visible = (selector: string) => home.graph.locator(selector).filter({ visible: true });
    await expectRadius(visible("[data-set]"), "6px", "set bar");
    // The ghost of the published slot: a dashed outline with the bar's corners.
    await expectRadius(visible("[data-ghost]"), "6px", "ghost");
    expect(await visible("[data-ghost]").evaluate((ghost) => getComputedStyle(ghost).borderTopStyle)).toBe("dashed");
    await expectRadius(visible("[data-end-dot]"), "50%", "end dot");
    await expectRadius(visible("[data-hit]"), "10px", "line hit area");
    if (isPhone) await expectRadius(visible("[data-bracket]"), "6px", "overview bracket");

    // The hatch window and every new-overlap window: rx 6 (or half the width when narrower), inset 2 px from the
    // bar above and the bar below.
    const windows = visible("[data-shared-window], [data-created]");
    expect(await windows.count(), "the moved view draws the hatch window and the new overlap").toBeGreaterThanOrEqual(2);
    const bars = await visible("[data-set]").evaluateAll((all) => all.map((bar) => bar.getBoundingClientRect().toJSON() as DOMRect));
    for (const window of await windows.all()) {
      const { rx, width } = await rxOf(window);
      expect(rx, "window rx").toBeCloseTo(Math.min(6, width / 2), 0);
      // The window's own geometry (a dashed outline is centred on it, so it straddles that edge by half its width).
      const box = await window.evaluate((rect) => {
        const { x, y, width: w, height: h } = rect.getBoundingClientRect();
        return { x, y, width: w, height: h };
      });
      const across = bars.filter((bar) => bar.left < box.x + box.width - 0.5 && bar.right > box.x + 0.5);
      const above = across.filter((bar) => bar.bottom <= box.y + 1).reduce((best, bar) => Math.max(best, bar.bottom), -Infinity);
      const below = across.filter((bar) => bar.top >= box.y + box.height - 1).reduce((best, bar) => Math.min(best, bar.top), Infinity);
      expect(box.y - above, "clear of the bar above").toBeCloseTo(2, 0);
      expect(below - (box.y + box.height), "clear of the bar below").toBeCloseTo(2, 0);
    }
    const created = visible("[data-created]");
    expect(await created.first().evaluate((rect) => getComputedStyle(rect).strokeDasharray), "the new overlap's outline is dashed").not.toBe("none");
  });

  test("a pinned line note is 10px, and a keyboard-focused line keeps its 10px corner with the ring 2px outside it", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const line = home.graphLines().first();
    await keyboardFocus(page, line);
    const ring = await line.evaluate((element) => {
      const style = getComputedStyle(element);
      return { radius: style.borderTopLeftRadius, offset: style.outlineOffset, width: style.outlineWidth, outline: style.outlineStyle };
    });
    expect(ring).toEqual({ radius: "10px", offset: "2px", width: "2px", outline: "solid" });
    await page.keyboard.press("Enter");
    const note = home.graph.locator('[data-thread-note="line"]').filter({ visible: true });
    await expect(note).toBeVisible();
    expect(await corners(note)).toEqual(["10px", "10px", "10px", "10px"]);
  });

  test("segmented tracks are 10px and their thumbs 6px, inset 4px and never scaled; a focused option's ring is drawn 4px inside", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    for (const track of [home.dayPicker, home.viewToggle]) {
      expect(await corners(track)).toEqual(["10px", "10px", "10px", "10px"]);
      const thumb = track.locator('[data-slot="segmented-marker"]');
      await expect(thumb).toBeVisible();
      expect(await corners(thumb)).toEqual(["6px", "6px", "6px", "6px"]);
      const [outer, inner] = await Promise.all([track.boundingBox(), thumb.boundingBox()]);
      expect((inner?.y ?? 0) - (outer?.y ?? 0), "thumb inset from the track's top").toBeCloseTo(4, 0);
      expect((outer?.y ?? 0) + (outer?.height ?? 0) - ((inner?.y ?? 0) + (inner?.height ?? 0)), "thumb inset from the track's bottom").toBeCloseTo(4, 0);
      const transform = await thumb.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform));
      expect([transform.a, transform.d], "the thumb moves by translation alone").toEqual([1, 1]);
    }

    const radio = home.viewToggle.getByRole("radio", { checked: true });
    await keyboardFocus(page, radio);
    const option = radio.locator("xpath=following-sibling::span[1]");
    expect(await option.evaluate((element) => getComputedStyle(element).outlineOffset)).toBe("-4px");
  });

  test("every button with a box is 10px and never a pill; inputs and selects 10px; chips 6px", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    for (const button of [home.keepMove, home.pasteLink]) {
      const [radius] = await corners(button);
      expect(radius, "Keep and Paste take the control radius").toBe("10px");
      const box = await button.boundingBox();
      expect(parseFloat(radius), "under half the height: no pill").toBeLessThan((box?.height ?? 0) / 2);
    }
    // Every button drawn as a box (a fill or an edge) is 10px; a text button with no box has its own corner for its
    // focus ring.
    const buttons = await page.locator('[data-slot="button"]').evaluateAll((all) =>
      all
        .filter((button) => button.getBoundingClientRect().width > 0)
        .map((button) => {
          const style = getComputedStyle(button);
          const boxed =
            !["rgba(0, 0, 0, 0)", "transparent"].includes(style.backgroundColor) ||
            (parseFloat(style.borderTopWidth) > 0 && !style.borderTopColor.endsWith(", 0)") && style.borderTopColor !== "transparent");
          return { name: (button.textContent ?? "").trim().slice(0, 40), boxed, radius: style.borderTopLeftRadius };
        }),
    );
    expect(buttons.filter((button) => button.boxed).length, "buttons drawn as boxes").toBeGreaterThan(1);
    for (const button of buttons) {
      if (button.boxed) expect(button.radius, `button "${button.name}"`).toBe("10px");
      else expect(parseFloat(button.radius), `text button "${button.name}" has a corner for its ring`).toBeGreaterThan(0);
    }
    await expectRadius(new TryAMove(page).select, "10px", "Try a move's select");

    // /check: the rule settings' fields, and the grid as editable text.
    const check = new CheckPage(page);
    await check.goto();
    await check.rules.locator("summary").click();
    await expectRadius(check.rules.locator("input:not([type=radio]):not([type=checkbox]), select"), "10px", "/check rule field");
    // The grid as text fills the editor panel edge to edge: it draws no box of its own, and the 14px panel that
    // holds it clips its corners (2.6.2: a fill clipped inside a rounded surface).
    await check.csvView.click();
    await expect(check.grid).toBeVisible();
    const grid = await check.grid.evaluate((textarea) => {
      const style = getComputedStyle(textarea);
      const edges = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].filter((width) => parseFloat(width) > 0).length;
      let clip: string | null = null;
      for (let node = textarea.parentElement; node; node = node.parentElement) {
        if (getComputedStyle(node).overflow !== "visible") {
          clip = getComputedStyle(node).borderTopLeftRadius;
          break;
        }
      }
      return { radius: style.borderTopLeftRadius, edges, clip };
    });
    if (grid.radius === "0px") expect({ edges: grid.edges < 2, clip: grid.clip }, "a square grid is clipped by the 14px panel").toEqual({ edges: true, clip: "14px" });
    else expect(grid.radius, "/check grid as text").toBe("10px");
    await expectRadius(page.locator(".tag"), "6px", "chip");
  });

  test("cards and panels are 14px, inset blocks 10px", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expectRadius(home.indexCard, "14px", "the index card");
    await home.showWorking.click();
    await expectRadius(home.working.getByRole("table").locator("xpath=ancestor::div[contains(@class,'border')][1]"), "10px", "the trade-off table's block");
    const rankings = home.whatQloo.getByRole("group").filter({ has: page.locator("summary", { hasText: /^Two rankings of this day/ }) });
    await rankings.locator("summary").click();
    await expectRadius(rankings.locator("[data-lens-apart]"), "10px", "the taste-lens block");

    await home.keepMove.click();
    await expectRadius(home.plan.getByRole("region", { name: "Your tested moves" }), "14px", "Try a move's plan panel");

    // The hidden-clash examples print as cards.
    await page.emulateMedia({ media: "print" });
    await expectRadius(home.hiddenWall.locator("li.bg-card"), "14px", "hidden-wall cards");
  });

  test("the board: 10px tiles, a 6px tooltip, the dial's band at rx 4, the key's swatches rounded", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expectRadius(home.board.locator("[data-set]"), "10px", "board tile");
    // A name too long for its slot also shows in full on focus, as a 6px label beside the tile. On the saved days
    // only Riot Fest at 390 px has such a slot, so the label is measured there.
    if (isPhone) {
      await home.goto(DAYS.riot.id);
      const tip = page.locator("[data-name-tooltip]").first();
      await keyboardFocus(page, tip.locator("xpath=preceding-sibling::button[1]"));
      await expect(tip).toBeVisible();
      expect(await corners(tip)).toEqual(["6px", "6px", "6px", "6px"]);
    }
    const band = page.locator("rect[data-band]").filter({ visible: true }).first();
    expect((await rxOf(band)).rx, "the dial's band").toBe(4);
    for (const swatch of await page.locator("svg rect").filter({ visible: true }).all()) {
      if (!(await swatch.evaluate((rect) => Boolean(rect.closest('[aria-label="Timetable key"], [role="list"]'))))) continue;
      expect((await rxOf(swatch)).rx, "a key swatch").toBeGreaterThan(0);
    }
  });

  test("the failed-test bars end round at both ends (the figure is drawn on /method; home states the test in words)", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    for (const url of ["/method"]) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const bars = page.locator("span:has(+ [data-bar-value])").filter({ visible: true });
      await expect(bars.first(), `${url}: the result bars are drawn`).toBeVisible();
      for (const item of await allCorners(bars)) {
        const [tl, tr, br, bl] = item.radii;
        expect(parseFloat(tl), `${url} ${item.name}`).toBeGreaterThan(0);
        expect([tl, bl], `${url} ${item.name}: the same corner at both ends`).toEqual([tr, br]);
      }
    }
  });

  test("a keyboard-focused text link takes the 6px mark corner, so its ring is never square", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const link = home.whatQloo.getByRole("link", { name: "How we know" });
    await link.scrollIntoViewIfNeeded();
    await keyboardFocus(page, link);
    const ring = await link.evaluate((element) => ({ radius: getComputedStyle(element).borderTopLeftRadius, outline: getComputedStyle(element).outlineStyle }));
    expect(ring).toEqual({ radius: "6px", outline: "solid" });
  });

  test("the clash drawer rounds every corner off the screen's edge at 14px, and a corner on the edge is straight", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    const home = new HomePage(page);
    // Below 640 px a side sheet fills the screen, so all four corners sit on its edges (2.6.2) and compute 0; from 640 px
    // it floats inside the window and every corner computes 14px. Any corner off the screen's edge is 14px everywhere.
    const sizes = isPhone
      ? [
          { width: 390, height: 844, all: "0px" },
          { width: 320, height: 640, all: null },
        ]
      : [
          { width: 1440, height: 900, all: "14px" },
          { width: 1024, height: 768, all: "14px" },
          { width: 640, height: 900, all: "14px" },
        ];
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await home.goto(DAYS.glastonbury.id);
      await home.tile("Sprints").click();
      const sheet = page.locator('[data-slot="sheet-content"]');
      await expect(sheet).toBeVisible();
      const found = await sheet.evaluate((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const [w, h] = [document.documentElement.clientWidth, window.innerHeight];
        const touches = { top: box.top <= 0.5, right: box.right >= w - 0.5, bottom: box.bottom >= h - 0.5, left: box.left <= 0.5 };
        // A corner sits on the screen's edge when both of its sides lie on the screen's edges.
        return [
          { corner: "top-left", radius: style.borderTopLeftRadius, edge: touches.top && touches.left },
          { corner: "top-right", radius: style.borderTopRightRadius, edge: touches.top && touches.right },
          { corner: "bottom-right", radius: style.borderBottomRightRadius, edge: touches.bottom && touches.right },
          { corner: "bottom-left", radius: style.borderBottomLeftRadius, edge: touches.bottom && touches.left },
        ];
      });
      const at = `${size.width} x ${size.height}`;
      if (size.all) expect(found.map((item) => item.radius), `${at}: the drawer's four corners`).toEqual([size.all, size.all, size.all, size.all]);
      for (const item of found) {
        expect(item.radius, `${at}: the ${item.corner} corner, ${item.edge ? "on the screen's edge" : "off the screen's edge"}`).toBe(item.edge ? "0px" : "14px");
      }
      await page.keyboard.press("Escape");
      await expect(home.drawer).toHaveCount(0);
    }
  });

  test("ruled text buttons take the 10px control corner, on both days", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    const home = new HomePage(page);
    for (const day of Object.values(DAYS)) {
      await home.goto(day.id);
      await scrollThrough(page);
      // Every one drawn at this width with a box of its own: the card's actions below 1024 px, Try this rule
      // yourself, the costliest clash's action on its own line, the re-check.
      const ruled = page.locator('[data-slot="button"][data-variant="ruled"]:not([data-index-beside] p *)');
      expect(await ruled.count(), `${day.title}: ruled buttons on the page`).toBeGreaterThan(2);
      await expectRadius(ruled, "10px", `${day.title}: ruled button`);
      // From 1024 px the two actions that close a sentence beside the index card sit in its line, about 20 px
      // tall: they take a text link's 6px corner, and that corner stays under half the box's height (never a pill).
      const inline = page.locator('[data-index-beside] p [data-slot="button"][data-variant="ruled"]');
      if (isPhone) {
        await expect(inline.filter({ visible: true }), `${day.title}: no sentence beside the card on a phone`).toHaveCount(0);
        continue;
      }
      await expectRadius(inline, "6px", `${day.title}: action closing a sentence beside the card`);
      const boxes = await inline.evaluateAll((all) =>
        all
          .filter((element) => element.getBoundingClientRect().width > 0)
          .map((element) => ({
            name: (element.textContent ?? "").trim().slice(0, 40),
            radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
            height: element.getBoundingClientRect().height,
          })),
      );
      for (const box of boxes) expect(box.radius, `${day.title}: "${box.name}" is not a pill`).toBeLessThan(box.height / 2);
    }
  });

  test("/check: the editor is a 14px panel edged on four sides, and the review card and its preview sheet are 14px", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    const check = new CheckPage(page);
    await check.goto();
    await check.checkButton.click();

    const panel = await page.getByRole("radiogroup", { name: "Show the draft grid as" }).evaluate((switcher) => {
      for (let node = switcher.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const sides = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map((value) => parseFloat(value));
        if (sides.every((width) => width > 0)) return { radius: style.borderTopLeftRadius, sides, overflow: style.overflow };
      }
      return null;
    });
    expect(panel, "the editor panel has an edge on all four sides").not.toBeNull();
    expect(panel?.radius, "the editor panel's corner").toBe("14px");
    expect(panel?.overflow, "the panel clips what it holds to its corner").toBe("hidden");
    await expectRadius(check.review, "14px", "the review card");
    // The brief drawn small beside it, from 1024 px.
    if (!isPhone) await expectRadius(check.review.locator("[class*='p-[22pt]']"), "14px", "the printed brief's preview sheet");
  });

  test("/brief: the sheet on screen is a 14px card", async ({ page, isPhone }) => {
    await useSeatTheme(page, isPhone);
    await page.goto(`/brief?preset=${DAYS.glastonbury.id}&day=0`, { waitUntil: "domcontentloaded" });
    const sheet = page.getByRole("article");
    await expect(sheet).toBeVisible();
    await expectRadius(sheet, "14px", "the brief sheet");
  });
});
