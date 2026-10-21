import { describe, expect, it } from "vitest";

import { sideEffectText, type DayGraphMove, type OverlapChange } from "./day-graph";
import { growthClauses, lowerFirst } from "./overlap-words";

describe("growthClauses", () => {
  it("names a new overlap and a longer one", () => {
    expect(growthClauses([{ name: "Joy Crookes", before: 0, after: 15 }])).toEqual(["New 15 min overlap with Joy Crookes."]);
    expect(growthClauses([{ name: "X", before: 10, after: 25 }])).toEqual(["Lengthens the overlap with X from 10 to 25 min."]);
  });

  it("names the first two in the order given and counts the rest", () => {
    const grows = [
      { name: "Joy Crookes", before: 0, after: 15 },
      { name: "X", before: 10, after: 25 },
      { name: "Y", before: 5, after: 20 },
      { name: "Z", before: 0, after: 30 },
    ];
    expect(growthClauses(grows.slice(0, 2))).toEqual([
      "New 15 min overlap with Joy Crookes.",
      "Lengthens the overlap with X from 10 to 25 min.",
    ]);
    expect(growthClauses(grows.slice(0, 3))).toEqual([
      "New 15 min overlap with Joy Crookes.",
      "Lengthens the overlap with X from 10 to 25 min.",
      "1 more overlap gets longer.",
    ]);
    expect(growthClauses(grows)).toEqual([
      "New 15 min overlap with Joy Crookes.",
      "Lengthens the overlap with X from 10 to 25 min.",
      "2 more overlaps get longer.",
    ]);
    expect(growthClauses([...grows].reverse())[0]).toBe("New 30 min overlap with Z.");
  });

  it("says nothing when nothing grows", () => {
    expect(growthClauses([])).toEqual([]);
  });

  it("gives the hero's side-effect line its growth part, word for word", () => {
    const change = (name: string, before: number, after: number): OverlapChange => ({
      actId: name.toLowerCase(),
      name,
      stageIndex: 1,
      before,
      after,
      beforeWindow: null,
      afterWindow: null,
    });
    const grows = [change("Joy Crookes", 0, 15), change("X", 10, 25), change("Y", 5, 20), change("Z", 0, 30)];
    for (let n = 1; n <= grows.length; n += 1) {
      const move = { grows: grows.slice(0, n), shrinks: [] } as unknown as DayGraphMove;
      expect(sideEffectText(move)).toBe(growthClauses(move.grows).join(" "));
    }
  });
});

describe("lowerFirst", () => {
  it("lower-cases the first character only", () => {
    expect(lowerFirst("New 15 min")).toBe("new 15 min");
    expect(lowerFirst("Lengthens the overlap with X from 10 to 25 min.")).toBe("lengthens the overlap with X from 10 to 25 min.");
    expect(lowerFirst("2 more overlaps get longer.")).toBe("2 more overlaps get longer.");
    expect(lowerFirst("")).toBe("");
  });
});
