import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite for the web app (`npm run e2e`). It drives a real Chromium against a running site:
 * the dev server on http://localhost:3000 by default (reused when it is already up), or any other
 * deployment through BASE_URL. It never starts a Qloo or language-model request: the suite blocks any
 * request that could (see e2e/fixtures.ts), and the local API runs with those switched off.
 *
 *   npm run e2e                          both projects
 *   npx playwright test --project=phone  one project
 *   BASE_URL=http://localhost:3100 npm run e2e
 */
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(baseURL);
const port = new URL(baseURL).port || "3000";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // One retry locally, two in CI: it absorbs a one-off 5xx from the dev server's proxy under load, and the
  // report names any test that needed it as flaky, so nothing is hidden.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
  ],
  use: {
    baseURL,
    locale: "en-US",
    // Every spec reads end states with motion reduced; the few that measure the drawing's move or the theme switch
    // turn motion back on for themselves.
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  // Only a local site is started when it is not already running; a BASE_URL elsewhere is used as it is.
  webServer: local
    ? {
        command: `npm run dev -- --port ${port}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
        stdout: "ignore",
        stderr: "pipe",
      }
    : undefined,
});
