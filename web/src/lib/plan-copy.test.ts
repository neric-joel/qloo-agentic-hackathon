import { describe, expect, it } from "vitest";

import { PLAN_CAVEAT, RAISES_MARK, planVerdict, publishedVerdict, raisesIndex, rangeLead } from "./plan-copy";

// Invented figures in the shape of a day's baseline (10th and 90th percentile).
const range = { low: 92.1568, high: 108.5582 };

describe("rangeLead", () => {
  it("names the middle 80% in whole numbers", () => {
    expect(rangeLead(range)).toBe("The middle 80% of random valid timetables of this lineup score 92 to 109.");
  });

  it("says nothing without a band", () => {
    expect(rangeLead(null)).toBeNull();
    expect(rangeLead({ low: Number.NaN, high: 108 })).toBeNull();
  });
});

describe("planVerdict", () => {
  it("gives the gap above the printed high to one decimal", () => {
    // 109.3 against a printed 109: 0.3, not 0.30000000000001.
    expect(planVerdict(109.3, null, range)).toBe("This plan scores 0.3 index points above that range.");
    expect(planVerdict(109.26, null, range)).toBe("This plan scores 0.3 index points above that range.");
    expect(planVerdict(120.04, null, range)).toBe("This plan scores 11.0 index points above that range.");
  });

  it("adds the published gap when the published timetable is above the band too", () => {
    expect(planVerdict(109.3, 116.71, range)).toBe(
      "This plan scores 0.3 index points above that range. The published timetable is 7.7 above it.",
    );
  });

  it("states a raising plan plainly even when it is above the band, with both indexes and the band", () => {
    // Without the standalone option the band is not said again: the card has just printed it.
    expect(planVerdict(109.3, 104.2, range)).toBe(
      "This plan’s index is 109.3, 5.1 higher than the published timetable’s 104.2.",
    );
    expect(planVerdict(109.3, 104.2, range, { standalone: true })).toBe(
      "This plan’s index is 109.3, 5.1 higher than the published timetable’s 104.2. The middle 80% of random valid timetables of this lineup score 92 to 109.",
    );
  });

  it("reads exactly the printed high as inside", () => {
    expect(planVerdict(109.0, 116.71, range)).toBe("This plan scores inside that range.");
    expect(planVerdict(109.04, 116.71, range)).toBe("This plan scores inside that range.");
    expect(planVerdict(100, 116.71, range)).toBe("This plan scores inside that range.");
  });

  it("reads below the printed low as below", () => {
    expect(planVerdict(91.9, 116.71, range)).toBe("This plan scores below that range.");
    expect(planVerdict(91.96, 116.71, range)).toBe("This plan scores inside that range.");
  });

  it("states a raised index as a plain fact in place of the range verdict, never as good news", () => {
    // Below the band, and higher than the published index: no "scores below that range" beside a higher figure.
    expect(planVerdict(88.8, 86.5, range)).toBe("This plan’s index is 88.8, 2.3 higher than the published timetable’s 86.5.");
    expect(planVerdict(100, 98.4, range)).toBe("This plan’s index is 100.0, 1.6 higher than the published timetable’s 98.4.");
    for (const [plan, published] of [[88.8, 86.5], [100, 98.4], [109.3, 104.2]]) {
      expect(planVerdict(plan, published, range)).not.toMatch(/scores (below|inside|[\d.]+ index points above) that range/);
    }
    // A lower or equal index adds nothing.
    expect(planVerdict(85.5, 86.5, range)).toBe("This plan scores below that range.");
    expect(planVerdict(86.5, 86.5, range)).toBe("This plan scores below that range.");
  });

  it("can state the band in the same sentence, for a reader who has not seen it", () => {
    expect(planVerdict(109.3, 116.71, range, { standalone: true })).toBe(
      "The middle 80% of random valid timetables of this lineup score 92 to 109; this plan scores 0.3 index points above that range. The published timetable is 7.7 above it.",
    );
    expect(planVerdict(88.8, 86.5, range, { standalone: true })).toBe(
      "This plan’s index is 88.8, 2.3 higher than the published timetable’s 86.5. The middle 80% of random valid timetables of this lineup score 92 to 109.",
    );
    expect(planVerdict(100, 116.71, null, { standalone: true })).toBeNull();
  });

  it("returns no sentence without a band", () => {
    expect(planVerdict(109.3, 116.71, null)).toBeNull();
    expect(planVerdict(Number.NaN, 116.71, range)).toBeNull();
  });

  it("never prints the bare verdict", () => {
    for (const value of [80, 100, 109.1, 130]) {
      expect(planVerdict(value, 116.71, range)).not.toBe("This plan scores above that range.");
    }
  });
});

describe("publishedVerdict", () => {
  it("places the published index against the middle 80%", () => {
    expect(publishedVerdict(116.71, range)).toBe(
      "The middle 80% of random valid timetables of this lineup score 92 to 109; the published timetable reads above that range.",
    );
    expect(publishedVerdict(108.6, range)).toMatch(/reads inside that range\.$/);
    expect(publishedVerdict(86.48, range)).toMatch(/reads below that range\.$/);
    expect(publishedVerdict(100, null)).toBeNull();
  });
});

describe("raisesIndex", () => {
  it("is true only when the printed after is higher than the printed before", () => {
    expect(raisesIndex(108.03, 109.21)).toBe(true);
    expect(raisesIndex(116.71, 110.24)).toBe(false);
    // Both print 110.2: no mark beside two equal figures.
    expect(raisesIndex(110.21, 110.24)).toBe(false);
    expect(RAISES_MARK).toBe(" · raises the index");
  });
});

describe("PLAN_CAVEAT", () => {
  it("keeps its words", () => {
    expect(PLAN_CAVEAT).toBe(
      "Scored by the same measure the places are found with, so a lower number shows what that measure rewards, not that audiences would be better served. It knows only the rules in the timetable, not an act’s own wishes.",
    );
  });
});
