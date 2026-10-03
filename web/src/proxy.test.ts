import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "./proxy";

const STAMP_203 = "65c1c9038cd619567fd4f79d0326b88e06b7217ab60052ba5e47e65deb6f89fc"; // see visitor-stamp.test.ts

/** The request headers the proxy hands on: Next puts them on the response as `x-middleware-request-*`. */
function forwarded(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  const override = response.headers.get("x-middleware-override-headers");
  for (const name of override ? override.split(",") : []) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    if (value !== null) out[name] = value;
  }
  return out;
}

function request(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/health", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy with the secret set", () => {
  it("replaces whatever stamp the caller sent with one for the address the host reports", async () => {
    vi.stubEnv("VISITOR_STAMP_SECRET", "test-secret");
    const response = await proxy(
      request({
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "x-clash-visitor": "evil",
        "x-clash-sig": "forged",
      }),
    );
    const headers = forwarded(response);
    expect(headers["x-clash-visitor"]).toBe("203.0.113.7");
    expect(headers["x-clash-sig"]).toBe(STAMP_203);
    expect(Object.values(headers)).not.toContain("evil");
    expect(Object.values(headers)).not.toContain("forged");
  });

  it("falls back to x-real-ip, and keeps the other headers", async () => {
    vi.stubEnv("VISITOR_STAMP_SECRET", "test-secret");
    const response = await proxy(request({ "x-real-ip": "203.0.113.7", "content-type": "application/json" }));
    const headers = forwarded(response);
    expect(headers["x-clash-visitor"]).toBe("203.0.113.7");
    expect(headers["x-clash-sig"]).toBe(STAMP_203);
    expect(headers["content-type"]).toBe("application/json");
  });

  it("strips a caller's stamp and adds none when there is no usable address", async () => {
    vi.stubEnv("VISITOR_STAMP_SECRET", "test-secret");
    const none = forwarded(await proxy(request({ "x-clash-visitor": "evil", "x-clash-sig": "forged" })));
    expect(none["x-clash-visitor"]).toBeUndefined();
    expect(none["x-clash-sig"]).toBeUndefined();
    const odd = forwarded(
      await proxy(request({ "x-forwarded-for": "unknown", "x-clash-visitor": "evil", "x-clash-sig": "x" })),
    );
    expect(odd["x-clash-visitor"]).toBeUndefined();
    expect(odd["x-clash-sig"]).toBeUndefined();
  });
});

describe("proxy without the secret", () => {
  it("only strips: the stamp stays inert", async () => {
    vi.stubEnv("VISITOR_STAMP_SECRET", "");
    const response = await proxy(
      request({ "x-forwarded-for": "203.0.113.7", "x-clash-visitor": "evil", "x-clash-sig": "forged" }),
    );
    const headers = forwarded(response);
    expect(headers["x-clash-visitor"]).toBeUndefined();
    expect(headers["x-clash-sig"]).toBeUndefined();
    expect(headers["x-forwarded-for"]).toBe("203.0.113.7");
  });

  it("treats an unset secret the same", async () => {
    vi.stubEnv("VISITOR_STAMP_SECRET", undefined);
    const headers = forwarded(await proxy(request({ "x-forwarded-for": "203.0.113.7" })));
    expect(headers["x-clash-visitor"]).toBeUndefined();
  });
});

describe("proxy matcher", () => {
  it("covers the pair check, the agent route, what-if and health, and not the cached reads", () => {
    expect(config.matcher).toEqual(["/api/pair", "/api/runs", "/api/presets/:id/whatif", "/api/health"]);
    expect(config.matcher.some((path) => path.includes("moves"))).toBe(false);
  });
});
