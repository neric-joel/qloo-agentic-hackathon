import { describe, expect, it } from "vitest";

import { describeVsRandom, dialArc, dialDomain, dialFraction, dialPoint } from "./clash-budget";

const baseline = { p10_index: 92.6, p90_index: 108.1 };

describe("dialDomain", () => {
  it("is at least 60 to 140", () => {
    expect(dialDomain(116, baseline)).toEqual({ min: 60, max: 140 });
  });

  it("widens to fit an extreme index, in steps of 10", () => {
    expect(dialDomain(171, baseline)).toEqual({ min: 60, max: 190 });
    expect(dialDomain(31, baseline)).toEqual({ min: 10, max: 140 });
  });

  it("never goes below zero and copes without a baseline", () => {
    expect(dialDomain(5, null)).toEqual({ min: 0, max: 140 });
  });
});

describe("dialFraction and dialPoint", () => {
  const domain = { min: 60, max: 140 };

  it("maps the index onto the dial and clamps it", () => {
    expect(dialFraction(100, domain)).toBe(0.5);
    expect(dialFraction(60, domain)).toBe(0);
    expect(dialFraction(200, domain)).toBe(1);
    expect(dialFraction(100, { min: 100, max: 100 })).toBe(0.5);
  });

  it("runs from the left end over the top to the right end", () => {
    const left = dialPoint(0, 100, 100, 50);
    const top = dialPoint(0.5, 100, 100, 50);
    const right = dialPoint(1, 100, 100, 50);
    expect(left.x).toBeCloseTo(50);
    expect(left.y).toBeCloseTo(100);
    expect(top.x).toBeCloseTo(100);
    expect(top.y).toBeCloseTo(50);
    expect(right.x).toBeCloseTo(150);
    expect(right.y).toBeCloseTo(100);
  });

  it("draws an arc between two fractions in either order", () => {
    expect(dialArc(0, 1, 100, 100, 50)).toBe("M 50 100 A 50 50 0 0 1 150 100");
    expect(dialArc(1, 0.5, 100, 100, 50)).toBe(dialArc(0.5, 1, 100, 100, 50));
  });
});

describe("describeVsRandom", () => {
  it("states the gap to the random average", () => {
    expect(describeVsRandom(116.07)).toBe("16% above the random average");
    expect(describeVsRandom(82.08)).toBe("18% below the random average");
    expect(describeVsRandom(100.3)).toBe("level with the random average");
  });
});
