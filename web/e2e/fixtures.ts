import { test as base, expect, type Page, type Request } from "@playwright/test";

/**
 * The suite's shared `test`. Every test gets, with no setup of its own:
 *
 *  - a network guard: any request to a host other than the site's own is blocked before it leaves the
 *    browser and recorded, and so is any request that could reach Qloo or a language model (the agent
 *    route, the live pair check, and grid pricing in anything but its saved mode). The test fails
 *    afterwards if either list is not empty, so no spec can spend quota by accident.
 *  - a console watch: a console error or an uncaught page error fails the test, unless the spec names the
 *    one it expects (`test.use({ ignoreConsole: [/status of 404/] })`, for a page that is meant to 404).
 *  - `isPhone`, true for the 390 px project, for the few places where the page itself differs.
 */

const BASE = new URL(process.env.BASE_URL ?? "http://localhost:3000");
const OWN_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", BASE.hostname]);

/** Paths whose answer comes from Qloo or a language model. */
const SPENDING_PATHS = [/^\/api\/pair(\/|$)/, /^\/api\/runs(\/|$)/, /^\/api\/baseline(\/|$)/, /^\/api\/agent(\/|$)/];

export type Guard = {
  /** Every URL the browser asked for, in order. */
  requested: string[];
  /** Requests to a host that is not the site's own (blocked). */
  external: string[];
  /** Requests that would have reached Qloo or a model (blocked). */
  spending: string[];
  /** Console errors and uncaught page errors. */
  consoleErrors: string[];
};

export function isOwnHost(url: string): boolean {
  try {
    return OWN_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** True when this request could spend Qloo or model quota. Grid pricing is fine in its saved mode only. */
export function spendsQuota(request: Pick<Request, "url" | "method" | "postData">): boolean {
  const { pathname } = new URL(request.url());
  if (SPENDING_PATHS.some((pattern) => pattern.test(pathname))) return true;
  if (pathname === "/api/price-grid") {
    try {
      return (JSON.parse(request.postData() ?? "{}") as { mode?: string }).mode !== "saved";
    } catch {
      return true;
    }
  }
  return false;
}

type Fixtures = {
  guard: Guard;
  /** Console errors a spec expects, by pattern; anything else still fails the test. */
  ignoreConsole: RegExp[];
  isPhone: boolean;
};

export const test = base.extend<Fixtures>({
  ignoreConsole: [[], { option: true }],

  isPhone: async ({ viewport }, run) => {
    await run((viewport?.width ?? 1440) < 640);
  },

  guard: [
    async ({ context, ignoreConsole }, run) => {
      const guard: Guard = { requested: [], external: [], spending: [], consoleErrors: [] };

      context.on("request", (request) => guard.requested.push(request.url()));

      const watch = (page: Page) => {
        page.on("console", (message) => {
          if (message.type() === "error") guard.consoleErrors.push(`${message.text()} (${message.location().url})`);
        });
        page.on("pageerror", (error) => guard.consoleErrors.push(`pageerror: ${error.message}`));
      };
      context.pages().forEach(watch);
      context.on("page", watch);

      // Registered first, so it runs last: specs' own mocks (page.route) win, and anything they let
      // through is checked here.
      await context.route(
        (url) => !OWN_HOSTS.has(url.hostname),
        (route) => {
          guard.external.push(route.request().url());
          return route.abort("blockedbyclient");
        },
      );
      await context.route(
        (url) => url.pathname.startsWith("/api/"),
        (route) => {
          if (spendsQuota(route.request())) {
            guard.spending.push(`${route.request().method()} ${route.request().url()}`);
            return route.abort("blockedbyclient");
          }
          return route.fallback();
        },
      );

      await run(guard);

      expect(guard.external, "the browser asked for a host other than the site's own").toEqual([]);
      expect(guard.spending, "a request that could reach Qloo or a language model was attempted").toEqual([]);
      const unexpected = guard.consoleErrors.filter((error) => !ignoreConsole.some((pattern) => pattern.test(error)));
      expect(unexpected, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
