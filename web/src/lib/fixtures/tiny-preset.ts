/**
 * Test fixture: a tiny hand-written preset in the backend's response shape. Every name and figure is
 * invented; it is not Qloo data.
 */
export function rawTinyPreset(): Record<string, unknown> {
  return {
    id: "tiny-fest-sat",
    title: "Tiny Fest, Saturday",
    built_at: "2026-10-01T10:00:00+00:00",
    festival: {
      id: "tiny-fest",
      name: "Tiny Fest",
      city: null,
      days: ["Sat"],
      stages: [
        { id: "main", name: "Main", tier: 1, capacity: null, hours: [{ day: 0, open: 720, close: 1380 }] },
        { id: "side", name: "Side", tier: 2, hours: [] },
      ],
      acts: [
        { id: "ann", name: "Ann Arbor", qloo_id: "Q-ANN", popularity: 0.9, genre: "Indie", billing_tier: 1 },
        { id: "bo", name: "Bo Diddly Squat", qloo_id: "Q-BO", popularity: 0.8, genre: "Punk", billing_tier: 2 },
        { id: "cy", name: "Cy Twombly", qloo_id: null, popularity: null, genre: null, billing_tier: 3 },
      ],
      timetable: [
        { act_id: "ann", day: 0, stage_id: "main", start: 1200, end: 1290, locked: true, not_after: null },
        { act_id: "bo", day: 0, stage_id: "side", start: "20:30", end: 1320 },
        { act_id: "cy", day: 0, stage_id: "side", start: 1000, end: 1060 },
      ],
      constraints: { changeover_minutes: 15 },
    },
    matrix: { act_ids: ["ann", "bo"], values: [[0, 0.7], [0.7, 0]], coverage: {}, source: "qloo" },
    report: {
      festival_id: "tiny-fest",
      metrics: {
        regret: 0.5,
        clash_budget_index: 104.2,
        split_quality: 0,
        split_index: null,
        objective: null,
        scored_concurrent_pairs: 1,
        unscored_concurrent_pairs: 0,
      },
      baseline: { samples: 300, mean_regret: 0.48, std_regret: 0.1, p10_index: 90, p90_index: 110, degenerate: false },
      clashes: [
        {
          rank: 1,
          a: { act_id: "ann", name: "Ann Arbor", stage_id: "main", genre: "Indie" },
          b: { act_id: "bo", name: "Bo Diddly Squat", stage_id: "side", genre: "Punk" },
          day: 0,
          overlap_minutes: 60,
          concurrency: 1,
          audience_overlap: 0.7,
          draw: 0.8485,
          regret: 0.5,
          regret_share: 1,
          split_quality: null,
          label: "hidden",
          confidence: "strong",
        },
      ],
      false_clashes: [],
      splits: [],
      hidden_clash_count: 1,
      false_clash_count: 0,
      regret_by_act: { ann: 0.25, bo: 0.25 },
      top_draw_acts: ["ann"],
      thresholds: { hidden_overlap: 0.65, false_overlap: 0.2, top_draw_cutoff: 0.9 },
      stage_fit: [],
      coverage: {
        strong: 2,
        weak: 0,
        none: 1,
        scored_acts: 2,
        scored_share: 0.6667,
        unscored: [{ act_id: "cy", name: "Cy Twombly", reason: "no_signal" }],
        weak_act_ids: [],
      },
      movability: { total_sets: 3, locked: 1, frozen_by_existing_violations: 0, unscored: 1, movable: 1, movable_share: 0.33 },
      violations: [],
    },
    requests: [
      { path: "/search", params: { query: "Ann Arbor", take: 3 }, status: 200, cached: true, request_id: null },
      { path: "/v2/analysis/compare", params: { "a.signal.interests.entities": "Q-ANN", "b.signal.interests.entities": "Q-BO" }, status: 200, cached: false, request_id: "req-1" },
    ],
    sources: [{ url: "https://example.com/tiny", accessed: "2026-10-01" }, { url: "javascript:alert(1)" }],
    overlap_notes: ["No usable signal for: Cy Twombly."],
    evidence: {
      hidden_wall: [
        {
          festival: "other-fest-2025",
          day: "Sun",
          acts: ["Ann Arbor", "Bo Diddly Squat"],
          entity_ids: ["Q-ANN", "Q-BO"],
          genres: [["urn:tag:genre:indie"], ["urn:tag:genre:punk"]],
          overlap_pct: 0.9,
          draw_pct: 0.8,
          overlap_min: 30,
          source: "https://example.com/press",
          basis: "pair",
          shared_tags: [{ name: "Garage", tag_id: "urn:tag:genre:music:garage", kind: "urn:tag:genre:music", score: 0.8 }, { bad: true }],
        },
      ],
      hidden_wall_total: 4,
      receipts: { "ann|bo": { shared_tags: [{ name: "Garage", score: 0.8 }], press: null } },
      twins: [
        {
          act: "Ann Arbor",
          act_id: "ann",
          shared: { act: "Bo Diddly Squat", act_id: "bo", overlap: 0.9, draw_pct: 0.8 },
          separate: { act: "Cy Twombly", act_id: "cy", overlap: 0.2, draw_pct: 0.79 },
          gap: 0.7,
        },
      ],
      press_pairs_today: [["Ann Arbor", "Bo Diddly Squat"]],
    },
  };
}
