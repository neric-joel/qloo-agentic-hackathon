import { expect, type Locator, type Page } from "@playwright/test";

/** The header, footer and theme control every page shares. */
export class SiteChrome {
  readonly header: Locator;
  readonly footer: Locator;
  readonly homeLink: Locator;
  readonly menuButton: Locator;
  readonly themeButton: Locator;
  readonly skipLink: Locator;

  constructor(readonly page: Page) {
    this.header = page.getByRole("banner");
    this.footer = page.getByRole("contentinfo");
    this.homeLink = this.header.getByRole("link", { name: "Clash Control, home" });
    this.menuButton = this.header.getByRole("button", { name: "Menu" });
    this.themeButton = this.header.getByRole("button", { name: /^Color theme/ });
    this.skipLink = page.getByRole("link", { name: "Skip to main content" });
  }

  /**
   * Waits until the page has hydrated. The theme button only learns its choice once the app's own code runs
   * in the browser ("Color theme" becomes "Color theme: System"), so a click made before that is lost.
   */
  async waitForHydration(): Promise<void> {
    await expect(this.themeButton).toHaveAccessibleName(/^Color theme: (Light|Dark|System)$/);
  }

  /** The two page links. Under 640 px they live in the Menu panel, which has to be open to see them. */
  async openMenuIfCollapsed(): Promise<void> {
    if (await this.menuButton.isVisible()) {
      if ((await this.menuButton.getAttribute("aria-expanded")) !== "true") await this.menuButton.click();
      await expect(this.menuButton).toHaveAttribute("aria-expanded", "true");
    }
  }

  async siteLink(name: "How we know" | "Check a draft grid"): Promise<Locator> {
    await this.openMenuIfCollapsed();
    return this.page.getByRole("navigation", { name: "Site" }).getByRole("link", { name });
  }

  /** The html element's theme class: "dark" or "light". */
  async appliedTheme(): Promise<"dark" | "light"> {
    return (await this.page.locator("html").evaluate((html) => html.classList.contains("dark"))) ? "dark" : "light";
  }

  /** Opens the theme panel and chooses one of its three options. */
  async chooseTheme(option: "Light" | "Dark" | "System"): Promise<void> {
    await this.waitForHydration();
    await this.themeButton.click();
    // The radio itself is visually hidden; a visitor presses its label.
    const radio = this.page.getByRole("radio", { name: option, exact: true });
    await this.page.locator("label").filter({ has: radio }).click();
    // Choosing closes the panel and keeps focus on the button.
    await expect(this.themeButton).toHaveAttribute("aria-expanded", "false");
  }
}
