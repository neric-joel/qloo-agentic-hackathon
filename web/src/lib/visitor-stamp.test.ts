import { describe, expect, it } from "vitest";

import { firstHop, stamp } from "./visitor-stamp";

describe("stamp", () => {
  it("signs the address like the API does", async () => {
    // Computed in Python: hmac.new(b"test-secret", b"203.0.113.7", "sha256").hexdigest(). The backend test
    // (backend/tests/test_limits.py) pins the same pair, so the two languages sign alike.
    expect(await stamp("test-secret", "203.0.113.7")).toBe(
      "65c1c9038cd619567fd4f79d0326b88e06b7217ab60052ba5e47e65deb6f89fc",
    );
  });

  it("is 64 lowercase hex characters, different for another address or secret", async () => {
    const signature = await stamp("test-secret", "203.0.113.8");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).not.toBe(await stamp("test-secret", "203.0.113.7"));
    expect(signature).not.toBe(await stamp("other-secret", "203.0.113.8"));
  });

  it("takes the secret and the address as UTF-8 text", async () => {
    expect(await stamp("clé", "2001:db8::7")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("firstHop", () => {
  it("takes the first non-empty hop of x-forwarded-for, trimmed", () => {
    expect(firstHop("203.0.113.7, 10.0.0.1", null)).toBe("203.0.113.7");
    expect(firstHop("  203.0.113.7  ", null)).toBe("203.0.113.7");
    expect(firstHop(", ,203.0.113.7,10.0.0.1", null)).toBe("203.0.113.7");
    expect(firstHop("2001:db8::7, 10.0.0.1", null)).toBe("2001:db8::7");
  });

  it("falls back to x-real-ip when there is no forwarded hop", () => {
    expect(firstHop(null, "198.51.100.2")).toBe("198.51.100.2");
    expect(firstHop("", " 198.51.100.2 ")).toBe("198.51.100.2");
    expect(firstHop(" , ", "198.51.100.2")).toBe("198.51.100.2");
    expect(firstHop("203.0.113.7", "198.51.100.2")).toBe("203.0.113.7");
  });

  it("is null when nothing looks like an address", () => {
    expect(firstHop(null, null)).toBeNull();
    expect(firstHop("", "")).toBeNull();
    expect(firstHop("unknown", null)).toBeNull();
    expect(firstHop("evil", "198.51.100.2")).toBeNull();
    expect(firstHop("[2001:db8::7]", null)).toBeNull();
    expect(firstHop("203.0.113.7 evil", null)).toBeNull();
    expect(firstHop(null, "x".repeat(10))).toBeNull();
  });

  it("refuses an address longer than 64 characters", () => {
    expect(firstHop("1".repeat(64), null)).toBe("1".repeat(64));
    expect(firstHop("1".repeat(65), null)).toBeNull();
  });
});
