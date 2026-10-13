import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "*.test.ts"],
    // The Playwright suite (e2e/*.spec.ts) runs with `npm run e2e`, in a real browser, never under vitest.
    exclude: [...configDefaults.exclude, "e2e/**", "test-results/**", "playwright-report/**"],
  },
});
