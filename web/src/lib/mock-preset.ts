/**
 * A synthetic preset for building the screens without the backend (NEXT_PUBLIC_MOCK_STREAM=1).
 * Every act, stage, overlap figure and source here is invented; none of it is Qloo data. Clashes
 * are priced with the same formula the backend uses, so the screens behave as they do for real.
 */

import type { QlooRequestRecord } from "./events";
import type { Act, Evidence, PairClash, Preset, PresetSummary, SetSlot, Stage } from "./preset";
import { overlapWindow } from "./timetable";

export const MOCK_PRESET_ID = "lanternfield-synthetic-sat";

const STAGES: Stage[] = [
  { id: "meadow", name: "Meadow", tier: 1, hours: [{ day: 0, open: 720, close: 1380 }] },
  { id: "orchard", name: "Orchard", tier: 1, hours: [{ day: 0, open: 720, close: 1380 }] },
  { id: "hangar", name: "Hangar", tier: 2, hours: [{ day: 0, open: 750, close: 1380 }] },
  { id: "tent", name: "Lantern Tent", tier: 3, hours: [{ day: 0, open: 750, close: 1350 }] },
];

type MockAct = [id: string, name: string, genre: string, popularity: number | null, tier: number];

const ACTS: MockAct[] = [
  ["paper-lanterns", "Paper Lanterns", "Indie Pop", 0.81, 3],
  ["cobalt-heart", "Cobalt Heart", "Synth Pop", 0.9, 2],
  ["night-ferry", "The Night Ferry", "Indie Rock", 0.93, 2],
  ["harbor-lights", "Harbor Lights", "Pop Rock", 0.99, 1],
  ["velvet-static", "Velvet Static", "Shoegaze", 0.72, 3],
  ["moss-and-iron", "Moss & Iron", "Folk Rock", 0.64, 3],
  ["kite-theory", "Kite Theory", "Post Punk", 0.88, 2],
  ["juniper-rail", "Juniper Rail", "Indie Rock", 0.97, 1],
  ["low-tide-choir", "Low Tide Choir", "Ambient", 0.58, 4],
  ["neon-parish", "Neon Parish", "House", 0.83, 3],
  ["saltwater-radio", "Saltwater Radio", "Techno", 0.86, 2],
  ["signal-bloom", "Signal Bloom", "Electronic", 0.95, 1],
  ["marrow-and-vine", "Marrow & Vine", "Folk", 0.61, 4],
  ["quiet-comet", "Quiet Comet", "Dream Pop", 0.79, 3],
  ["ruby-engine", "Ruby Engine", "Rap", 0.9, 2],
  ["wolf-weather", "Wolf Weather", "Garage Rock", null, 3],
];

const SLOTS: [actId: string, stage: string, start: string, end: string, locked?: boolean][] = [
  ["paper-lanterns", "meadow", "12:30", "13:30"],
  ["cobalt-heart", "meadow", "14:30", "15:45"],
  ["night-ferry", "meadow", "17:00", "18:30"],
  ["harbor-lights", "meadow", "21:00", "23:00", true],
  ["velvet-static", "orchard", "12:45", "13:30"],
  ["moss-and-iron", "orchard", "14:15", "15:15"],
  ["kite-theory", "orchard", "16:45", "18:00"],
  ["juniper-rail", "orchard", "20:30", "22:15", true],
  ["low-tide-choir", "hangar", "13:00", "13:45"],
  ["neon-parish", "hangar", "14:45", "16:00"],
  ["saltwater-radio", "hangar", "17:30", "19:00"],
  ["signal-bloom", "hangar", "21:15", "23:00", true],
  ["marrow-and-vine", "tent", "13:15", "14:00"],
  ["quiet-comet", "tent", "15:00", "16:00"],
  ["ruby-engine", "tent", "17:45", "18:45"],
  ["wolf-weather", "tent", "20:45", "21:45"],
];

/** Invented overlaps for pairs that clash; every other pair is 0.3. */
const OVERLAP: Record<string, number> = {
  "night-ferry|kite-theory": 0.91,
  "harbor-lights|juniper-rail": 0.86,
  "kite-theory|ruby-engine": 0.83,
  "cobalt-heart|neon-parish": 0.78,
  "juniper-rail|signal-bloom": 0.42,
  "harbor-lights|signal-bloom": 0.55,
  "night-ferry|saltwater-radio": 0.36,
  "cobalt-heart|quiet-comet": 0.74,
  "neon-parish|quiet-comet": 0.48,
  "paper-lanterns|velvet-static": 0.69,
  "paper-lanterns|low-tide-choir": 0.21,
  "velvet-static|low-tide-choir": 0.62,
  "saltwater-radio|ruby-engine": 0.57,
  "kite-theory|saltwater-radio": 0.33,
  "night-ferry|ruby-engine": 0.64,
  "moss-and-iron|cobalt-heart": 0.71,
  "moss-and-iron|neon-parish": 0.19,
  "low-tide-choir|marrow-and-vine": 0.66,
};

const UNSCORED = new Set(["wolf-weather"]);
const WEAK = new Set(["moss-and-iron"]);
const DRAW_PRIOR: Record<number, number> = { 1: 0.9, 2: 0.7, 3: 0.5, 4: 0.3 };

function minutes(clock: string): number {
  const [hours, mins] = clock.split(":").map(Number);
  return hours * 60 + mins;
}

function overlapOf(a: string, b: string): number {
  return OVERLAP[`${a}|${b}`] ?? OVERLAP[`${b}|${a}`] ?? 0.3;
}

function mockRequest(path: string, params: Record<string, string>): QlooRequestRecord {
  return { path, params, status: 200, latency_ms: Number.NaN, cached: false, recorded: true };
}

/** Prices every concurrent pair the way the backend does, without the rarity term. */
function priceClashes(acts: Act[], timetable: SetSlot[]): PairClash[] {
  const byId = new Map(acts.map((act) => [act.id, act]));
  const draw = (act: Act) => act.popularity ?? DRAW_PRIOR[act.billing_tier] ?? 0.5;
  const priced: Omit<PairClash, "rank" | "regret_share">[] = [];
  for (let i = 0; i < timetable.length; i += 1) {
    for (let k = i + 1; k < timetable.length; k += 1) {
      const p = timetable[i];
      const q = timetable[k];
      if (p.stage_id === q.stage_id || p.day !== q.day) continue;
      if (UNSCORED.has(p.act_id) || UNSCORED.has(q.act_id)) continue;
      const window = overlapWindow(p, q);
      if (!window) continue;
      const a = byId.get(p.act_id)!;
      const b = byId.get(q.act_id)!;
      const shared = window.end - window.start;
      const concurrency = shared / Math.min(p.end - p.start, q.end - q.start);
      const overlap = overlapOf(a.id, b.id);
      const pairDraw = Math.sqrt(draw(a) * draw(b));
      const sameGenre = a.genre === b.genre;
      priced.push({
        a: { act_id: a.id, name: a.name, stage_id: p.stage_id, genre: a.genre },
        b: { act_id: b.id, name: b.name, stage_id: q.stage_id, genre: b.genre },
        day: p.day,
        overlap_minutes: shared,
        concurrency,
        audience_overlap: overlap,
        draw: Math.round(pairDraw * 10_000) / 10_000,
        regret: overlap * concurrency * pairDraw,
        label: !sameGenre && overlap >= 0.8 ? "hidden" : sameGenre && overlap <= 0.25 ? "false" : null,
        confidence: WEAK.has(a.id) || WEAK.has(b.id) ? "weak" : "strong",
      });
    }
  }
  const total = priced.reduce((sum, clash) => sum + clash.regret, 0);
  return priced
    .sort((p, q) => q.regret - p.regret)
    .map((clash, index) => ({
      ...clash,
      rank: index + 1,
      regret_share: total > 0 ? clash.regret / total : 0,
    }));
}

function buildMockPreset(): Preset {
  const acts: Act[] = ACTS.map(([id, name, genre, popularity, tier]) => ({
    id,
    name,
    qloo_id: UNSCORED.has(id) ? null : `synthetic-${id}`,
    popularity,
    genre,
    billing_tier: tier,
  }));
  const timetable: SetSlot[] = SLOTS.map(([act_id, stage_id, start, end, locked]) => ({
    act_id,
    day: 0,
    stage_id,
    start: minutes(start),
    end: minutes(end),
    locked: locked === true,
  }));
  const allClashes = priceClashes(acts, timetable);
  const regret = allClashes.reduce((sum, clash) => sum + clash.regret, 0);
  const clashes = allClashes.slice(0, 15);
  const top = clashes[0];

  const evidence: Evidence = {
    hidden_wall: [
      {
        festival: "example-fest-2025",
        day: "Sat",
        acts: ["Night Ferry", "Kite Theory"],
        genres: [
          ["urn:tag:genre:indie_rock", "urn:tag:genre:britpop"],
          ["urn:tag:genre:post_punk", "urn:tag:genre:noise_rock"],
        ],
        overlap_pct: 0.91,
        draw_pct: 0.9,
        overlap_min: 60,
        source: "https://example.com/clash-guide",
        shared_tags: [
          { name: "Art Rock", kind: "urn:tag:genre:music", score: 0.82 },
          { name: "Krautrock", kind: "urn:tag:genre:music", score: 0.74 },
          { name: "Dance Punk", kind: "urn:tag:genre:music", score: 0.61 },
        ],
      },
      {
        festival: "sample-weekender-2026",
        day: "Fri",
        acts: ["Quiet Comet", "Cobalt Heart"],
        genres: [["urn:tag:genre:dream_pop"], ["urn:tag:genre:synth_pop", "urn:tag:genre:electropop"]],
        overlap_pct: 0.74,
        draw_pct: 0.84,
        overlap_min: 45,
        source: null,
        shared_tags: [{ name: "Chillwave", kind: "urn:tag:genre:music", score: 0.7 }],
      },
    ],
    hidden_wall_total: 3,
    receipts: top
      ? {
          [`${top.a.act_id}|${top.b.act_id}`]: {
            shared_tags: [
              { name: "Art Rock", kind: "urn:tag:genre:music", score: 0.82 },
              { name: "Krautrock", kind: "urn:tag:genre:music", score: 0.74 },
            ],
            press: "https://example.com/clash-guide",
          },
        }
      : {},
    twins: [
      {
        act: "Kite Theory",
        act_id: "kite-theory",
        shared: { act: "The Night Ferry", act_id: "night-ferry", overlap: 0.91, draw_pct: 0.93 },
        separate: { act: "Saltwater Radio", act_id: "saltwater-radio", overlap: 0.33, draw_pct: 0.86 },
        gap: 0.58,
      },
    ],
  };

  const requests: QlooRequestRecord[] = [
    ...acts.map((act) => mockRequest("/search", { query: act.name, types: "urn:entity:artist", take: "3" })),
    ...acts
      .filter((act) => act.qloo_id)
      .map((act) =>
        mockRequest("/v2/insights", {
          "filter.type": "urn:entity:artist",
          "signal.interests.entities": act.qloo_id!,
          take: String(acts.length - 1),
        }),
      ),
    ...(top
      ? [
          mockRequest("/v2/analysis/compare", {
            "a.signal.interests.entities": `synthetic-${top.a.act_id}`,
            "b.signal.interests.entities": `synthetic-${top.b.act_id}`,
            take: "50",
          }),
        ]
      : []),
  ];

  const scored = acts.length - UNSCORED.size;
  return {
    id: MOCK_PRESET_ID,
    title: "Lanternfield, Saturday (synthetic)",
    built_at: "2026-10-01T12:00:00+00:00",
    festival: {
      id: "lanternfield",
      name: "Lanternfield (synthetic)",
      city: "Nowhere in particular",
      days: ["Sat"],
      stages: STAGES,
      acts,
      timetable,
    },
    report: {
      metrics: {
        regret,
        clash_budget_index: 112.4,
        scored_concurrent_pairs: allClashes.length,
        unscored_concurrent_pairs: 2,
      },
      baseline: { samples: 300, mean_regret: regret / 1.124, p10_index: 93.1, p90_index: 107.6, degenerate: false },
      clashes,
      hidden_clash_count: clashes.filter((clash) => clash.label === "hidden").length,
      thresholds: { hidden_overlap: 0.8, false_overlap: 0.25 },
      coverage: {
        strong: scored - WEAK.size,
        weak: WEAK.size,
        none: UNSCORED.size,
        scored_acts: scored,
        scored_share: scored / acts.length,
        unscored: acts
          .filter((act) => UNSCORED.has(act.id))
          .map((act) => ({ act_id: act.id, name: act.name, reason: "no_signal" })),
        weak_act_ids: [...WEAK],
      },
      movability: {
        total_sets: timetable.length,
        locked: timetable.filter((slot) => slot.locked).length,
        unscored: UNSCORED.size,
        movable: timetable.length - 3 - UNSCORED.size,
        movable_share: (timetable.length - 3 - UNSCORED.size) / timetable.length,
      },
    },
    requests,
    sources: [{ url: "https://example.com/lanternfield-timetable", accessed: "2026-10-01" }],
    overlap_notes: ["No usable signal for: Wolf Weather. It is left out, not scored as zero."],
    evidence,
  };
}

let cached: Preset | null = null;

/** The synthetic preset (built once). */
export function mockPreset(): Preset {
  cached ??= buildMockPreset();
  return cached;
}

export function mockPresetList(): PresetSummary[] {
  const preset = mockPreset();
  return [
    {
      id: preset.id,
      title: preset.title,
      city: preset.festival.city,
      sets: preset.festival.timetable.length,
      stages: preset.festival.stages.length,
      scored_share: preset.report.coverage.scored_share,
    },
  ];
}
