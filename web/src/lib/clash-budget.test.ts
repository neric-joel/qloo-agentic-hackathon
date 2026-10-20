import { describe, expect, it } from "vitest";

import {
  describeReach,
  describeVsRandom,
  dialArc,
  dialDomain,
  dialFraction,
  dialPoint,
  rangePosition,
  samplingReach,
} from "./clash-budget";
import type { SetSlot } from "./preset";

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
  const TAIL = ", where 100 is the average random valid timetable and higher means more clash cost";
  it("states the day's index and its direction in the sentence itself, as a score of this index, not a verdict", () => {
    expect(describeVsRandom(116.71)).toBe(`By this index, the published timetable scores 116.7${TAIL}`);
    expect(describeVsRandom(117)).toBe(`By this index, the published timetable scores 117.0${TAIL}`);
    expect(describeVsRandom(86.48)).toBe(`By this index, the published timetable scores 86.5${TAIL}`);
    expect(describeVsRandom(100)).toBe(`By this index, the published timetable scores 100.0${TAIL}`);
    // Neither praise nor verdict: no "above" or "below" left for a reader to take as a grade.
    for (const value of [86.48, 100, 116.71]) expect(describeVsRandom(value)).not.toMatch(/\b(above|below|better|worse)\b/);
  });

  it("calls the invented day's timetable invented, never published", () => {
    expect(describeVsRandom(116.71, true)).toBe(`By this index, the invented timetable scores 116.7${TAIL}`);
    expect(describeVsRandom(117, true)).not.toContain("published");
    expect(describeVsRandom(117, true)).not.toContain("Qloo");
  });

  it("names no cost the festival bears: no taste-overlap cost, price or money word", () => {
    for (const value of [86.48, 100, 117]) {
      expect(describeVsRandom(value)).not.toMatch(/more taste-overlap cost|less taste-overlap cost|price|money/);
    }
  });
});

/** A day shaped like the real presets: 39 sets, each free to start 2 hours either side of its
 * published start, on 2 or 3 stages, 5 of them locked. */
function realShapedDay(): SetSlot[] {
  return Array.from({ length: 39 }, (_, i) => {
    const start = 600 + i * 15;
    return {
      act_id: `act-${i}`,
      day: 0,
      stage_id: "a",
      start,
      end: start + 60,
      locked: i < 5,
      not_before: start - 120,
      not_after: start + 120,
      stages: i % 2 === 0 ? ["a", "b"] : ["a", "b", "c"],
    };
  });
}

describe("rangePosition", () => {
  it("places the index above, within or below the shaded band", () => {
    // Shaped like the two festival days shown: 116.71 against 92.16 to 108.56, 86.48 against 89.42 to 110.54.
    expect(rangePosition(116.71, 92.16, 108.56)).toBe("above");
    expect(rangePosition(86.48, 89.42, 110.54)).toBe("below");
    expect(rangePosition(100, 92.16, 108.56)).toBe("within");
  });

  it("compares the whole numbers the dial prints", () => {
    // 108.7 prints as 109, the same as the band's top, so it is not called above it.
    expect(rangePosition(108.7, 92.16, 108.56)).toBe("within");
    expect(rangePosition(109.5, 92.16, 108.56)).toBe("above");
    expect(rangePosition(91.6, 92.16, 108.56)).toBe("within");
    expect(rangePosition(91.4, 92.16, 108.56)).toBe("below");
  });

  it("is null without a band", () => {
    expect(rangePosition(116.71, null, 108.56)).toBeNull();
    expect(rangePosition(116.71, 92.16, null)).toBeNull();
    expect(rangePosition(Number.NaN, 92.16, 108.56)).toBeNull();
  });
});

describe("samplingReach", () => {
  it("reads the shared window, the stage freedom and the locks of a real-shaped day", () => {
    expect(samplingReach(realShapedDay())).toEqual({ windowMinutes: 120, neighbourStages: true, locked: 5 });
  });

  it("has no shared window when one set lacks a bound, is uneven, or differs from the rest", () => {
    const missing = realShapedDay();
    missing[7] = { ...missing[7], not_after: null };
    expect(samplingReach(missing).windowMinutes).toBeNull();

    const uneven = realShapedDay();
    uneven[3] = { ...uneven[3], not_before: uneven[3].start - 60 };
    expect(samplingReach(uneven).windowMinutes).toBeNull();

    const different = realShapedDay();
    different[12] = { ...different[12], not_before: different[12].start - 90, not_after: different[12].start + 90 };
    expect(samplingReach(different).windowMinutes).toBeNull();

    const absent = realShapedDay().map((slot) => ({ ...slot, not_before: undefined, not_after: undefined }));
    expect(samplingReach(absent).windowMinutes).toBeNull();
    expect(samplingReach([]).windowMinutes).toBeNull();
  });

  it("sees no stage freedom when every set lists one stage or none", () => {
    const fixed = realShapedDay().map((slot, i) => ({ ...slot, stages: i % 2 === 0 ? ["a"] : null }));
    expect(samplingReach(fixed)).toMatchObject({ neighbourStages: false, locked: 5 });
  });
});

describe("describeReach", () => {
  it("names the window, the neighbouring stages and the locked sets", () => {
    expect(describeReach({ windowMinutes: 120, neighbourStages: true, locked: 5 })).toBe(
      "each set stays within 2 hours of its published start, on its own stage or a neighbouring one, with the 5 locked sets fixed",
    );
  });

  it("drops the stage clause and the locks clause when they do not apply", () => {
    expect(describeReach({ windowMinutes: 120, neighbourStages: false, locked: 5 })).toBe(
      "each set stays within 2 hours of its published start, with the 5 locked sets fixed",
    );
    expect(describeReach({ windowMinutes: 120, neighbourStages: true, locked: 0 })).toBe(
      "each set stays within 2 hours of its published start, on its own stage or a neighbouring one",
    );
    expect(describeReach({ windowMinutes: 60, neighbourStages: false, locked: 1 })).toBe(
      "each set stays within 1 hour of its published start, with the 1 locked set fixed",
    );
    expect(describeReach({ windowMinutes: 90, neighbourStages: false, locked: 0 })).toBe(
      "each set stays within 90 minutes of its published start",
    );
  });

  it("falls back to the general rule without a shared window", () => {
    expect(describeReach({ windowMinutes: null, neighbourStages: true, locked: 5 })).toBe(
      "each set stays inside its allowed window and stages",
    );
  });

  it("describes the real-shaped day", () => {
    expect(describeReach(samplingReach(realShapedDay()))).toBe(
      "each set stays within 2 hours of its published start, on its own stage or a neighbouring one, with the 5 locked sets fixed",
    );
  });
});
