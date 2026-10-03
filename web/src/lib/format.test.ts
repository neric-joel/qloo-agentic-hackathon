import { describe, expect, it } from "vitest";

import {
  describeStatus,
  formatCaptured,
  formatInteger,
  formatLatency,
  formatUtcTime,
  humanizeIdentifier,
  isSuccessStatus,
  latencyParts,
  median,
  pluralize,
  summarizeParam,
} from "./format";

describe("formatLatency", () => {
  it("uses milliseconds below one second", () => {
    expect(formatLatency(0)).toBe("0 ms");
    expect(formatLatency(184.4)).toBe("184 ms");
    expect(formatLatency(999.4)).toBe("999 ms");
  });

  it("switches to seconds with sensible precision", () => {
    expect(formatLatency(1000)).toBe("1.00 s");
    expect(formatLatency(1340)).toBe("1.34 s");
    expect(formatLatency(12_500)).toBe("12.5 s");
  });

  it("reports unusable values as n/a", () => {
    expect(formatLatency(Number.NaN)).toBe("n/a");
    expect(formatLatency(-5)).toBe("n/a");
    expect(latencyParts(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("splits the figure from the unit", () => {
    expect(latencyParts(368)).toEqual({ value: "368", unit: "ms" });
    expect(latencyParts(2500)).toEqual({ value: "2.50", unit: "s" });
  });
});

describe("humanizeIdentifier", () => {
  it("turns identifiers into readable labels", () => {
    expect(humanizeIdentifier("resolve_entities")).toBe("Resolve entities");
    expect(humanizeIdentifier("describeEntity")).toBe("Describe entity");
    expect(humanizeIdentifier("get-tags")).toBe("Get tags");
    expect(humanizeIdentifier("qloo.search")).toBe("Qloo search");
    expect(humanizeIdentifier("recommend")).toBe("Recommend");
  });

  it("returns the input when there is nothing to say", () => {
    expect(humanizeIdentifier("__")).toBe("__");
    expect(humanizeIdentifier("")).toBe("");
  });
});

describe("pluralize and formatInteger", () => {
  it("agrees with the count", () => {
    expect(pluralize(1, "request")).toBe("1 request");
    expect(pluralize(0, "request")).toBe("0 requests");
    expect(pluralize(2, "failed request")).toBe("2 failed requests");
    expect(pluralize(3, "entity", "entities")).toBe("3 entities");
  });

  it("groups thousands the same way on server and client", () => {
    expect(formatInteger(1840)).toBe("1,840");
  });
});

describe("formatCaptured", () => {
  it("prints the UTC date, whatever the local time zone", () => {
    expect(formatCaptured("2026-10-03T00:13:52+00:00")).toBe("2026-10-03 UTC");
    // Still 2 October in New York, already 3 October in UTC.
    expect(formatCaptured("2026-10-02T22:30:00-04:00")).toBe("2026-10-03 UTC");
    expect(formatCaptured(new Date(Date.UTC(2026, 0, 5, 12)))).toBe("2026-01-05 UTC");
  });

  it("returns null for a missing or invalid value", () => {
    expect(formatCaptured(undefined)).toBeNull();
    expect(formatCaptured("")).toBeNull();
    expect(formatCaptured("not a date")).toBeNull();
  });
});

describe("HTTP status helpers", () => {
  it("names common statuses", () => {
    expect(describeStatus(200)).toBe("200 OK");
    expect(describeStatus(429)).toBe("429 Rate limited");
    expect(describeStatus(418)).toBe("418");
    expect(describeStatus(0)).toBe("No response");
  });

  it("treats only 2xx as success", () => {
    expect(isSuccessStatus(200)).toBe(true);
    expect(isSuccessStatus(204)).toBe(true);
    expect(isSuccessStatus(304)).toBe(false);
    expect(isSuccessStatus(429)).toBe(false);
    expect(isSuccessStatus(0)).toBe(false);
  });
});

describe("median", () => {
  it("handles odd, even and empty lists without mutating the input", () => {
    const values = [30, 10, 20];
    expect(median(values)).toBe(20);
    expect(values).toEqual([30, 10, 20]);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBeNull();
  });
});

describe("formatUtcTime", () => {
  it("prints the UTC time of day with seconds", () => {
    expect(formatUtcTime("2026-10-06T14:02:11Z")).toBe("14:02:11");
    expect(formatUtcTime("2026-10-06T16:02:03+02:00")).toBe("14:02:03");
    expect(formatUtcTime(new Date(Date.UTC(2026, 9, 6, 0, 5, 9)))).toBe("00:05:09");
  });

  it("is null for a missing or unreadable value", () => {
    expect(formatUtcTime(undefined)).toBeNull();
    expect(formatUtcTime("")).toBeNull();
    expect(formatUtcTime("not a date")).toBeNull();
  });
});

describe("summarizeParam", () => {
  it("leaves a single value as sent", () => {
    expect(summarizeParam("E-1")).toEqual({ shown: "E-1", hidden: 0, full: "E-1" });
  });

  it("leaves a list of up to three items as sent", () => {
    expect(summarizeParam("E-1,E-2,E-3")).toEqual({ shown: "E-1,E-2,E-3", hidden: 0, full: "E-1,E-2,E-3" });
  });

  it("collapses a long list to its first three items and a count", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `E-${i + 1}`);
    const full = ids.join(",");
    expect(summarizeParam(full)).toEqual({ shown: "E-1, E-2, E-3", hidden: 37, full });
  });

  it("takes another limit and ignores empty items", () => {
    expect(summarizeParam("a, b,,c, d", 2)).toEqual({ shown: "a, b", hidden: 2, full: "a, b,,c, d" });
    expect(summarizeParam("")).toEqual({ shown: "", hidden: 0, full: "" });
  });
});
