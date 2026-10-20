import { HONESTY } from "./helpers";
import { expect, test } from "./fixtures";
import { serveInventedDay } from "./invented-day";
import { HomePage } from "./pages/home-page";
import { TryAMove } from "./pages/try-a-move";

/**
 * The invented example day (Lanternfield): what a clone with no built festival day serves. The local API has
 * built days, so the browser's /api/presets requests are answered from fixtures made by the backend's own
 * generator (see fixtures/generate-invented-day.py). The page must say, everywhere it shows figures, that
 * the day is invented and that no Qloo request was made.
 */

test.describe("invented example day", () => {
  test("loads, and says on the page that it is invented", async ({ page }) => {
    const day = await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();

    // The notice, the hero's dateline, the board's dateline and the footer all say so. (The pitch's lede is drawn
    // by the server from its own reading of the day, which here is the real one, so it is not asserted.)
    await expect(page.getByRole("complementary", { name: "Synthetic data notice" })).toContainText(
      "Synthetic example day: invented acts, no Qloo data",
    );
    await expect(home.dateline).toContainText(/^Invented timetable\. /);
    await expect(home.dateline).toContainText("Shown here on an invented day");
    await expect(home.dateline).toContainText("no Qloo request was made");
    await expect(page.getByText(/^Invented timetable · /)).toContainText("Lanternfield Friday (synthetic demo)");
    await expect(home.chrome.footer).toContainText("an invented example day, not a festival");
    await expect(home.chrome.footer).toContainText("no Qloo request was made");
    await expect(home.dayPicker).toHaveCount(0); // one day: no picker

    // It is a full day: the drawn day with its move, the decision group, an index card and a board of the
    // invented sets.
    await expect(home.moveLead).toHaveText(/ \d+ minutes? (earlier|later)$/);
    await expect(home.readout).toHaveText(/^\d+ →\s+to \d+ min shared with .+$/);
    await expect(home.attribution).toContainText(HONESTY.reading);
    // The taste rank says the bill and the rank are invented, beside its number, with its Derived stamp.
    await expect(home.tasteLine).toHaveText(/^Taste overlap: \d+ of 100 on this invented bill \(an invented rank, not attendance\)\s*(Source:\s*)?Derived$/);
    // An invented timetable is never called published: the toggle's first option, the drawing's title in both views.
    await expect(home.viewToggle.getByRole("radio")).toHaveCount(2);
    await expect(home.viewToggle.getByRole("radio").first()).toHaveAccessibleName("Invented timetable");
    await expect(home.graph).toHaveAccessibleName(/, invented timetable, drawn with .+: \d+ sets on \d+ stages$/);
    await home.chooseView("Invented timetable");
    await expect(home.graph).toHaveAccessibleName(/, invented timetable, without the move: \d+ sets on \d+ stages$/);
    await expect(home.graphKey).toContainText("thicker means a higher invented taste overlap rank");
    await expect(home.graphKey).toContainText("Dashed: slot before the move or new overlap.");

    // The index scale reads the same on the invented day; "draw" is glossed as invented popularity, and the card
    // names no saved Qloo reading.
    await expect(home.details).toContainText(HONESTY.reading);
    await expect(home.details).toContainText("A score, not money: 100 = the average random valid timetable of this lineup. Lower is better.");
    await expect(home.details).not.toContainText("Qloo popularity");
    await home.showWorking.click();
    await expect(home.working).toBeVisible();
    await expect(home.details).not.toContainText(/saved Qloo reading|Qloo requests in this run/i);
    await expect(home.details.getByRole("button", { name: /^Re-check this pair with Qloo/ })).toHaveCount(0);
    await expect(home.board.getByRole("button")).toHaveCount(24);
    expect(day.served.some((line) => line.endsWith("/decision"))).toBe(true);
  });

  test("the invented hero never says published and credits no Qloo, and its lines are ink, never teal", async ({ page }) => {
    await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();

    // The words a visitor reads in the hero below the pitch, the drawing's title and description, every line's
    // note and the key, in both views, with the move kept in the view without it.
    const words = async () => {
      const visible = await page.locator("[data-hero] > *").evaluateAll((all) => all.slice(1).map((part) => (part as HTMLElement).innerText).join("\n"));
      const named = await home.graph.evaluate((graph) => {
        const ids = [graph.getAttribute("aria-labelledby"), graph.getAttribute("aria-describedby")].filter(Boolean) as string[];
        const labels = [...graph.querySelectorAll("[data-hit]")].map((hit) => hit.getAttribute("aria-label") ?? "");
        return [...ids.map((id) => document.getElementById(id)?.textContent ?? ""), ...labels].join("\n");
      });
      return `${visible}\n${named}`;
    };
    const check = async (state: string) => {
      const text = await words();
      expect(text, `${state}: no "published" on the invented day`).not.toMatch(/published/i);
      // A negation ("no Qloo request was made") is required, not a credit; nothing else names Qloo.
      expect(text.replaceAll("no Qloo request was made", ""), `${state}: no Qloo credit`).not.toMatch(/Qloo/);
    };
    await check("moved view");
    await home.chooseView("Invented timetable");
    await check("view without the move");
    await home.keepMove.click();
    await expect(home.keptNotice).toHaveText(/^Kept in your plan\.\s*Drawn here without the move\.\s*Nothing moves until the acts’ teams agree\.\s*See your plan$/);
    await check("kept, drawn without the move");

    // No line is drawn in a Qloo colour: every stroke and end dot in the drawing computes neither the Qloo teal nor
    // the quiet teal of the other ranked lines.
    const colours = await home.graph.evaluate((graph) => {
      const probe = document.createElement("span");
      document.body.append(probe);
      const resolve = (value: string) => {
        probe.style.color = value;
        return getComputedStyle(probe).color;
      };
      const teal = [resolve("var(--prov-qloo)"), resolve("var(--taste-quiet)")];
      probe.remove();
      const used = new Set<string>();
      for (const line of graph.querySelectorAll("line")) used.add(getComputedStyle(line).stroke);
      for (const dot of graph.querySelectorAll<HTMLElement>("[data-end-dot]")) used.add(getComputedStyle(dot).backgroundColor);
      return { teal, used: [...used] };
    });
    expect(colours.used.length, "the drawing has lines").toBeGreaterThan(0);
    for (const colour of colours.used) expect(colours.teal, `line colour ${colour}`).not.toContain(colour);
  });

  test("the hero's move prices through the same engine", async ({ page }) => {
    const day = await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();

    await home.keepMove.click();
    await expect(home.keptNotice).toBeVisible();
    const plan = home.tryAMove.getByRole("region", { name: "Your tested moves" });
    await expect(plan).toBeVisible();
    await expect(plan.getByRole("list", { name: "Kept moves" })).toContainText("Neon Garden");
    await expect(plan.getByRole("link", { name: "Open as a one-page brief" })).toHaveAttribute(
      "href",
      new RegExp(`^/brief\\?preset=${day.id}&day=0&moves=act-16~grove~0~1300$`),
    );
  });

  test("a set's legal places are listed and priced", async ({ page }) => {
    await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();

    // Pick the first set the page suggests to start with. From 1024 px its best tested place comes first and the
    // full list opens from it; below 1024 px the list shows at once.
    const move = new TryAMove(page);
    await move.starters.getByRole("button").first().click();
    const places = move.places;
    const show = move.bestPlace.getByRole("button", { name: "Show every legal place" });
    await expect(places.or(show).first()).toBeVisible();
    if (await show.isVisible()) await show.click();
    await expect(places).toBeVisible();
    await expect(places.getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
    await expect(places.getByRole("button").first()).toHaveAccessibleName(/Clash Budget Index \d+\.\d/);
  });

  test("/method says the day it shows is invented", async ({ page }) => {
    await serveInventedDay(page);
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "How we know" })).toBeVisible();
    await expect(page.getByRole("article")).toContainText("The day this server is showing is an invented example");
    // The failed pre-set test is on the page whichever day is showing.
    await expect(page.getByRole("article")).toContainText("The test we set before building failed.");
  });
});
