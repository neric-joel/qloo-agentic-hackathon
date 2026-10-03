import { describe, expect, it } from "vitest";

import { rawTinyPreset as rawPreset } from "./fixtures/tiny-preset";
import { parsePreset, parsePresetList, PresetFormatError, toRecordedRequest } from "./preset";

describe("parsePreset", () => {
  it("reads a well-formed preset", () => {
    const preset = parsePreset(rawPreset());
    expect(preset.id).toBe("tiny-fest-sat");
    expect(preset.festival.stages.map((stage) => stage.name)).toEqual(["Main", "Side"]);
    expect(preset.festival.timetable[0]).toEqual({
      act_id: "ann",
      day: 0,
      stage_id: "main",
      start: 1200,
      end: 1290,
      locked: true,
      not_before: null,
      not_after: null,
      stages: null,
    });
    expect(preset.report.metrics.clash_budget_index).toBe(104.2);
    expect(preset.report.clashes[0].label).toBe("hidden");
    expect(preset.report.coverage.unscored[0].name).toBe("Cy Twombly");
    expect(preset.overlap_notes).toHaveLength(1);
  });

  it("reads each set's start window and allowed stages when the preset gives them", () => {
    const raw = rawPreset();
    const festival = raw.festival as { timetable: Record<string, unknown>[] };
    Object.assign(festival.timetable[0], { not_before: 1080, not_after: "22:00", stages: ["main", "side"] });
    Object.assign(festival.timetable[1], { not_before: "soon", not_after: Number.NaN, stages: "main" });
    Object.assign(festival.timetable[2], { stages: [] });
    const [first, second, third] = parsePreset(raw).festival.timetable;
    expect(first).toMatchObject({ not_before: 1080, not_after: 1320, stages: ["main", "side"] });
    expect(second).toMatchObject({ not_before: null, not_after: null, stages: null });
    expect(third).toMatchObject({ not_before: null, not_after: null, stages: null });
  });

  it("keeps only web links among the sources", () => {
    expect(parsePreset(rawPreset()).sources).toEqual([
      { url: "https://example.com/tiny", accessed: "2026-10-01" },
    ]);
  });

  it("marks every saved request as recorded and flattens parameters", () => {
    const [search, compare] = parsePreset(rawPreset()).requests;
    expect(search).toEqual({
      path: "/search",
      params: { query: "Ann Arbor", take: "3" },
      status: 200,
      latency_ms: Number.NaN,
      cached: true,
      recorded: true,
    });
    expect(compare.request_id).toBe("req-1");
  });

  it("reads the evidence and drops malformed tags", () => {
    const { evidence } = parsePreset(rawPreset());
    expect(evidence?.hidden_wall[0].shared_tags).toEqual([
      { name: "Garage", kind: "urn:tag:genre:music", score: 0.8 },
    ]);
    expect(evidence?.hidden_wall_total).toBe(4);
    expect(evidence?.receipts["ann|bo"]).toEqual({
      shared_tags: [{ name: "Garage", kind: null, score: 0.8 }],
      press: null,
    });
    expect(evidence?.twins[0].separate.act).toBe("Cy Twombly");
  });

  it("treats missing evidence as none", () => {
    const raw = rawPreset();
    raw.evidence = null;
    expect(parsePreset(raw).evidence).toBeNull();
  });

  it("rejects a set on an unknown stage", () => {
    const raw = rawPreset();
    const festival = raw.festival as { timetable: Record<string, unknown>[] };
    festival.timetable[0].stage_id = "nowhere";
    expect(() => parsePreset(raw)).toThrow(PresetFormatError);
  });

  it("rejects a malformed report", () => {
    const raw = rawPreset();
    (raw.report as Record<string, unknown>).clashes = "none";
    expect(() => parsePreset(raw)).toThrow(/report.clashes must be an array/);
  });

  it("rejects a set that ends before it starts", () => {
    const raw = rawPreset();
    const festival = raw.festival as { timetable: Record<string, unknown>[] };
    festival.timetable[0].end = 1100;
    expect(() => parsePreset(raw)).toThrow(/must end after it starts/);
  });
});

describe("parsePresetList", () => {
  it("reads the list", () => {
    expect(
      parsePresetList([
        { id: "a", title: "A", city: "X", sets: 3, stages: 2, scored_share: 0.5 },
        { id: "b", title: "B", city: null, sets: 1, stages: 1, scored_share: null },
      ]),
    ).toEqual([
      { id: "a", title: "A", city: "X", sets: 3, stages: 2, scored_share: 0.5, synthetic: false },
      { id: "b", title: "B", city: null, sets: 1, stages: 1, scored_share: null, synthetic: false },
    ]);
  });

  it("rejects anything that is not a list", () => {
    expect(() => parsePresetList({ presets: [] })).toThrow(PresetFormatError);
  });
});

describe("toRecordedRequest", () => {
  it("defaults a missing status to no response", () => {
    expect(toRecordedRequest({ path: "/search" }).status).toBe(0);
  });
});
