import { describe, expect, it } from "vitest";

import { buildSetViews } from "./clashes";
import { MOCK_PRESET_ID, mockPreset, mockPresetList } from "./mock-preset";
import { parsePreset } from "./preset";
import { overlapWindow } from "./timetable";

describe("mock preset", () => {
  const preset = mockPreset();

  it("survives the same validation as a real preset", () => {
    const roundTrip = parsePreset(JSON.parse(JSON.stringify(preset)));
    expect(roundTrip.id).toBe(MOCK_PRESET_ID);
    expect(roundTrip.report.clashes).toHaveLength(preset.report.clashes.length);
  });

  it("only ranks pairs that really play at the same time on different stages", () => {
    const slots = new Map(preset.festival.timetable.map((slot) => [slot.act_id, slot]));
    for (const clash of preset.report.clashes) {
      const a = slots.get(clash.a.act_id)!;
      const b = slots.get(clash.b.act_id)!;
      expect(a.stage_id).not.toBe(b.stage_id);
      expect(overlapWindow(a, b)?.end).toBeDefined();
    }
  });

  it("ranks by price and never prices an act without signal", () => {
    const { clashes } = preset.report;
    expect(clashes.map((clash) => clash.rank)).toEqual(clashes.map((_, index) => index + 1));
    for (let i = 1; i < clashes.length; i += 1) {
      expect(clashes[i - 1].regret).toBeGreaterThanOrEqual(clashes[i].regret);
    }
    expect(clashes.some((clash) => clash.a.act_id === "wolf-weather" || clash.b.act_id === "wolf-weather")).toBe(false);
    expect(buildSetViews(preset, 0).find((view) => view.id === "wolf-weather")?.coverage).toBe("none");
  });

  it("lists itself", () => {
    expect(mockPresetList()).toEqual([
      expect.objectContaining({ id: MOCK_PRESET_ID, sets: preset.festival.timetable.length }),
    ]);
  });
});
