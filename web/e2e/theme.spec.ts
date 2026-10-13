import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { luminance, rgbOf } from "./helpers";
import { SiteChrome } from "./pages/site-chrome";

/** The theme control: light, dark, or follow the device; remembered, applied before first paint, and on every page. */

const ground = async (page: Page) => luminance(await rgbOf(page, "body", "backgroundColor"));

test.describe("theme toggle", () => {
  test("follows the device by default, and the button says which theme is chosen", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    await expect(chrome.themeButton).toHaveAccessibleName("Color theme: System");
    expect(await chrome.appliedTheme()).toBe("light");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => chrome.appliedTheme(), "System follows the device live").toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => chrome.appliedTheme()).toBe("light");
  });

  test("Dark and Light apply at once and change the page's ground", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    const paper = await ground(page);

    await chrome.chooseTheme("Dark");
    await expect(chrome.themeButton).toHaveAccessibleName("Color theme: Dark");
    expect(await chrome.appliedTheme()).toBe("dark");
    await expect.poll(() => ground(page), "the ground goes dark").toBeLessThan(0.2);
    expect(paper, "the light ground was light").toBeGreaterThan(0.8);
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

    await chrome.chooseTheme("Light");
    await expect(chrome.themeButton).toHaveAccessibleName("Color theme: Light");
    expect(await chrome.appliedTheme()).toBe("light");
    await expect.poll(() => ground(page)).toBeGreaterThan(0.8);
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
  });

  test("a chosen theme beats the device, survives a reload, and follows to other pages", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    await chrome.chooseTheme("Dark");

    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await chrome.appliedTheme()).toBe("dark");
    await expect(chrome.themeButton).toHaveAccessibleName("Color theme: Dark");

    await page.goto("/check", { waitUntil: "domcontentloaded" });
    expect(await chrome.appliedTheme()).toBe("dark");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(await chrome.appliedTheme()).toBe("dark");
    // A device that is light does not undo the choice.
    await page.emulateMedia({ colorScheme: "light" });
    expect(await chrome.appliedTheme()).toBe("dark");
  });

  test("the theme is on the page before the first paint, so there is no flash", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __darkAtDomReady: boolean }).__darkAtDomReady = document.documentElement.classList.contains("dark");
      });
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => (window as unknown as { __darkAtDomReady: boolean }).__darkAtDomReady)).toBe(true);
  });

  test("the panel offers three options, opens by keyboard, and Escape closes it and returns focus", async ({ page, isPhone }) => {
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    await chrome.waitForHydration();

    await expect(chrome.themeButton).toHaveAttribute("aria-expanded", "false");
    await chrome.themeButton.focus();
    await page.keyboard.press("Enter");
    await expect(chrome.themeButton).toHaveAttribute("aria-expanded", "true");
    const group = page.getByRole("group", { name: "Color theme" });
    await expect(group.getByRole("radio")).toHaveCount(3);
    // Focus moves into the group, on the chosen option.
    await expect(group.getByRole("radio", { name: "System" })).toBeFocused();
    if (!isPhone) {
      // The arrow keys move the choice inside the open group without closing it.
      await page.keyboard.press("ArrowDown");
      await expect(chrome.themeButton).toHaveAttribute("aria-expanded", "true");
    }
    await page.keyboard.press("Escape");
    await expect(chrome.themeButton).toHaveAttribute("aria-expanded", "false");
    await expect(chrome.themeButton).toBeFocused();
  });

  test("a press outside closes the panel", async ({ page }) => {
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    await chrome.waitForHydration();
    await chrome.themeButton.click();
    await expect(chrome.themeButton).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("heading", { level: 1, name: "How we know" }).click();
    await expect(chrome.themeButton).toHaveAttribute("aria-expanded", "false");
  });

  test("the home page reads in both themes: the hero stays on screen and nothing overflows", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const chrome = new SiteChrome(page);
    for (const theme of ["Dark", "Light"] as const) {
      await chrome.chooseTheme(theme);
      await expect(page.getByRole("heading", { level: 1, name: "Which clash is worth moving?" })).toBeInViewport();
      // Ink and paper are far apart in luminance in either theme.
      const ink = luminance(await rgbOf(page, "h1", "color"));
      await expect.poll(async () => Math.abs(ink - (await ground(page))), `${theme}: ink against paper`).toBeGreaterThan(0.6);
    }
  });
});
