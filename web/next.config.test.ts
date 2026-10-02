import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "./next.config";

async function destinationFor(backendUrl: string | undefined): Promise<string> {
  vi.stubEnv("BACKEND_URL", backendUrl);
  const rewrites = await nextConfig.rewrites?.();
  if (!Array.isArray(rewrites)) throw new Error("expected a flat list of rewrites");
  const api = rewrites.find((rule) => rule.source === "/api/:path*");
  if (!api) throw new Error("missing the /api rewrite");
  return api.destination;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config rewrites", () => {
  it("proxies /api to the local backend by default", async () => {
    expect(await destinationFor(undefined)).toBe("http://127.0.0.1:8000/api/:path*");
  });

  it("treats an empty or blank BACKEND_URL as unset", async () => {
    expect(await destinationFor("")).toBe("http://127.0.0.1:8000/api/:path*");
    expect(await destinationFor("   ")).toBe("http://127.0.0.1:8000/api/:path*");
  });

  it("uses BACKEND_URL and drops trailing slashes", async () => {
    expect(await destinationFor("https://api.example.com/")).toBe("https://api.example.com/api/:path*");
    expect(await destinationFor("http://localhost:9000//")).toBe("http://localhost:9000/api/:path*");
  });

  it("assumes https when the scheme is missing", async () => {
    expect(await destinationFor("api.example.com")).toBe("https://api.example.com/api/:path*");
  });
});

describe("next.config streaming", () => {
  it("keeps compression off so event streams are not held back by the proxy", () => {
    expect(nextConfig.compress).toBe(false);
  });
});
