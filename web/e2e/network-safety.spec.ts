import { DAYS, requireSavedDays, scrollThrough } from "./helpers";
import { expect, test, isOwnHost } from "./fixtures";
import { CheckPage } from "./pages/check-page";
import { HomePage } from "./pages/home-page";
import { TryAMove } from "./pages/try-a-move";

/**
 * The browser talks to this site and nothing else. No request goes to qloo.com or anthropic.com (or any other
 * host), and no request that could spend Qloo quota or a model call leaves the browser. The `guard` fixture
 * already blocks and records both for every test; these specs walk the whole product with it and say so.
 */

const FORBIDDEN_HOSTS = /(^|\.)(qloo\.com|anthropic\.com|openai\.com|googleapis\.com|gstatic\.com|vercel\.com|vercel-insights\.com)$/;

function hosts(requested: string[]): string[] {
  return [...new Set(requested.map((url) => new URL(url).host))].sort();
}

test.describe("the browser only talks to this site", () => {
  test("a full tour of the product requests no other host and spends nothing", async ({ page, guard, baseURL }) => {
    await requireSavedDays(page);
    const home = new HomePage(page);
    const move = new TryAMove(page);

    // Home on both days: the day, its decision, lenses, recordings, health, and every move list.
    await home.goto(DAYS.glastonbury.id);
    await scrollThrough(page);
    await home.openMove.click();
    await expect(move.plan).toBeVisible();
    await move.choose("Gurriers");
    await move.keepButton.click();
    await home.tile("Sprints").click();
    await expect(home.drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await home.trace.click();
    await expect(home.drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await home.agent.getByRole("button", { name: /^Replay the recorded run: Ask for a move the rules refuse/ }).click();
    await home.agent.getByRole("button", { name: "Skip to the answer" }).click();
    await expect(home.agent.getByRole("status").filter({ hasText: /\S/ })).toHaveText("The recorded run has finished.", { timeout: 15_000 });
    await home.chooseDay(DAYS.riot.title);
    await expect(home.page.getByText(`Published timetable · ${DAYS.riot.title}`)).toBeVisible();

    // The method page, the brief, and the check with its one optional request, in saved mode.
    await page.goto("/method", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "How we know" })).toBeVisible();
    await page.goto(`/brief?preset=${DAYS.glastonbury.id}&day=0&moves=gurriers~woodsies~0~1215`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("article")).toBeVisible();
    const check = new CheckPage(page);
    await check.goto();
    await check.priceButton.click();
    await expect(check.priceSection).toContainText("No Qloo request was sent.");

    // Everything asked for was this site (the guard also blocked anything that was not).
    expect(guard.requested.length).toBeGreaterThan(20);
    expect(guard.requested.every(isOwnHost), `hosts: ${hosts(guard.requested).join(", ")}`).toBe(true);
    expect(hosts(guard.requested)).toEqual([new URL(baseURL as string).host]);
    expect(guard.requested.filter((url) => FORBIDDEN_HOSTS.test(new URL(url).hostname))).toEqual([]);
    expect(guard.requested.filter((url) => /qloo\.com|anthropic\.com/i.test(url))).toEqual([]);
    expect(guard.external).toEqual([]);
    expect(guard.spending).toEqual([]);

    // The API the page used is a short, known list, and the only non-GET calls are the pricing ones.
    const api = guard.requested.filter((url) => new URL(url).pathname.startsWith("/api/")).map((url) => new URL(url).pathname.replace(/\/presets\/[^/]+/, "/presets/:id"));
    expect(new Set(api)).toEqual(
      new Set(["/api/presets", "/api/presets/:id", "/api/presets/:id/decision", "/api/presets/:id/lenses", "/api/presets/:id/moves", "/api/presets/:id/recordings", "/api/presets/:id/whatif", "/api/health", "/api/price-grid"]),
    );
  });

  test("the pages load no scripts, styles, fonts or images from anywhere else", async ({ page }) => {
    for (const url of ["/", "/method", "/check", `/brief?preset=${DAYS.glastonbury.id}&day=0`]) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const outside = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("script[src], link[href], img[src], iframe[src], source[src], source[srcset], video[src], audio[src]")]
          .map((element) => element.getAttribute("src") ?? element.getAttribute("href") ?? element.getAttribute("srcset") ?? "")
          // Links to other sites that the visitor can follow are plain anchors; only loaded resources count.
          .filter((address) => /^(https?:)?\/\//.test(address) && !address.startsWith(location.origin)),
      );
      expect(outside, `${url}: resources from another origin`).toEqual([]);
    }
  });

  test("fonts are served by this site", async ({ page, guard }) => {
    await page.goto("/", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const fonts = guard.requested.filter((url) => /\.(woff2?|ttf|otf)(\?|$)/.test(url));
    expect(fonts.length, "the page's fonts were requested").toBeGreaterThan(0);
    expect(fonts.every(isOwnHost)).toBe(true);
  });

  test("a live pair check or agent run is never started by loading or scrolling a page", async ({ page, guard }) => {
    await requireSavedDays(page);
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    await scrollThrough(page);
    await home.tile("Sprints").click();
    await expect(home.drawer).toBeVisible();
    // The drawer offers no live re-check on this server, so there is nothing to press and nothing sent.
    expect(guard.requested.filter((url) => /\/api\/(pair|runs)/.test(url))).toEqual([]);
    expect(guard.spending).toEqual([]);
  });

  test("the server's own answers carry no Qloo key or model key", async ({ page }) => {
    const health = await page.request.get("/api/health");
    const text = JSON.stringify(await health.json());
    expect(text).not.toMatch(/sk-[A-Za-z0-9]|api[_-]?key["']?\s*:\s*["'][A-Za-z0-9]/i);
    // It says whether a key is configured, as a flag, never the key.
    expect(JSON.parse(text)).toMatchObject({ status: "ok" });
    for (const url of ["/", "/method", "/check"]) {
      const body = await (await page.request.get(url)).text();
      expect(body, `${url} embeds no secret`).not.toMatch(/QLOO_API_KEY|ANTHROPIC_API_KEY|AI_GATEWAY_API_KEY|x-api-key/i);
    }
  });
});
