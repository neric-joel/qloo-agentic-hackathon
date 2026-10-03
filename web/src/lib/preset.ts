/**
 * Preset festival days: a published timetable scored ahead of time against Qloo audience data.
 *
 * `GET /api/presets` lists them; `GET /api/presets/{id}` returns one. The types mirror the backend
 * response, trimmed to what the screens use. `parsePreset` and `parsePresetList` validate untrusted
 * JSON so a contract change shows a clear error instead of a broken page.
 */

import { isRecord, type QlooRequestRecord } from "./events";

export type Coverage = "strong" | "weak" | "none";
export type ClashLabel = "hidden" | "false";

export type StageHours = { day: number; open: number; close: number };

export type Stage = {
  id: string;
  name: string;
  /** 1 = main stage, larger numbers = smaller stages. */
  tier: number;
  hours: StageHours[];
};

export type Act = {
  id: string;
  name: string;
  qloo_id: string | null;
  /** Qloo popularity, 0 to 1. Missing when Qloo has no signal for the act. */
  popularity: number | null;
  genre: string | null;
  /** 1 = headliner ... 4 = early undercard. */
  billing_tier: number;
};

/** One set. Times are minutes from the start of the festival day (past 1440 = after midnight). */
export type SetSlot = {
  act_id: string;
  day: number;
  stage_id: string;
  start: number;
  end: number;
  /** The set may not move at all. */
  locked: boolean;
  /** Earliest start the set may move to, in the same minutes. Null when the preset gives none. */
  not_before?: number | null;
  /** Latest start the set may move to. Null when the preset gives none. */
  not_after?: number | null;
  /** Ids of the stages the set may play on, its own included. Null means any stage. */
  stages?: string[] | null;
};

export type Festival = {
  id: string;
  name: string;
  city: string | null;
  days: string[];
  stages: Stage[];
  acts: Act[];
  timetable: SetSlot[];
};

export type ClashAct = { act_id: string; name: string; stage_id: string; genre: string | null };

/** A concurrent pair, priced: regret = overlap x concurrency x pair draw (x rarity). */
export type PairClash = {
  rank: number;
  a: ClashAct;
  b: ClashAct;
  day: number;
  overlap_minutes: number;
  /** Shared minutes over the shorter set's minutes, 0 to 1. */
  concurrency: number;
  /** Taste overlap: a rank among the acts compared for this bill, derived from Qloo, 0 to 1. */
  audience_overlap: number;
  /** Geometric mean of the two acts' draw, 0 to 1. */
  draw: number;
  regret: number;
  /** This pair's share of the timetable's total regret, 0 to 1. */
  regret_share: number;
  label: ClashLabel | null;
  confidence: "strong" | "weak";
};

export type ScheduleMetrics = {
  regret: number;
  /** 100 = mean of random valid timetables of the same lineup; lower is better. */
  clash_budget_index: number | null;
  scored_concurrent_pairs: number;
  unscored_concurrent_pairs: number;
};

export type BaselineStats = {
  samples: number;
  mean_regret: number;
  p10_index: number | null;
  p90_index: number | null;
  degenerate: boolean;
};

export type UnscoredAct = { act_id: string; name: string; reason: string };

export type CoverageSummary = {
  strong: number;
  weak: number;
  none: number;
  scored_acts: number;
  scored_share: number;
  unscored: UnscoredAct[];
  weak_act_ids: string[];
};

export type Movability = {
  total_sets: number;
  locked: number;
  unscored: number;
  movable: number;
  movable_share: number;
};

export type ScoreReport = {
  metrics: ScheduleMetrics;
  baseline: BaselineStats | null;
  /** Concurrent pairs ranked by regret, costliest first. */
  clashes: PairClash[];
  hidden_clash_count: number;
  thresholds: { hidden_overlap: number | null; false_overlap: number | null };
  coverage: CoverageSummary;
  movability: Movability | null;
};

export type SharedTag = { name: string; kind: string | null; score: number | null };

/** A clash the press called out, where the acts share no genre tag but share an audience. */
export type HiddenWallItem = {
  festival: string;
  day: string;
  acts: [string, string];
  /** Each act's Qloo genre tags (tag ids or names). */
  genres: [string[], string[]];
  overlap_pct: number;
  draw_pct: number | null;
  overlap_min: number | null;
  source: string | null;
  shared_tags: SharedTag[];
};

export type Receipt = { shared_tags: SharedTag[]; press: string | null };

export type TwinRival = { act: string; act_id: string | null; overlap: number; draw_pct: number };

/** One act, two rivals with near-equal draw and very different audience overlap. */
export type Twin = {
  act: string;
  act_id: string | null;
  shared: TwinRival;
  separate: TwinRival;
  gap: number;
};

export type Evidence = {
  hidden_wall: HiddenWallItem[];
  hidden_wall_total: number;
  /** Keyed `"<actIdA>|<actIdB>"`, in either order. */
  receipts: Record<string, Receipt>;
  twins: Twin[];
};

export type SourceLink = { url: string; accessed: string | null };

export type Preset = {
  id: string;
  title: string;
  built_at: string | null;
  /**
   * True for the invented day the server serves when it has no built preset: invented acts, no Qloo
   * data. Missing or false for a real day.
   */
  synthetic?: boolean;
  festival: Festival;
  report: ScoreReport;
  /** Every Qloo request behind the preset, replayed from storage (flagged `recorded`). */
  requests: QlooRequestRecord[];
  sources: SourceLink[];
  overlap_notes: string[];
  evidence: Evidence | null;
};

export type PresetSummary = {
  id: string;
  title: string;
  city: string | null;
  sets: number;
  stages: number;
  scored_share: number | null;
  /** True when the day is the invented one; missing or false for a real day. */
  synthetic?: boolean;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class PresetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresetFormatError";
  }
}

type Obj = Record<string, unknown>;

function obj(value: unknown, at: string): Obj {
  if (!isRecord(value)) throw new PresetFormatError(`${at} must be an object`);
  return value;
}

function arr(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new PresetFormatError(`${at} must be an array`);
  return value;
}

/** Optional lists may be missing or `null`. */
function optArr(value: unknown, at: string): unknown[] {
  return value === undefined || value === null ? [] : arr(value, at);
}

function str(source: Obj, key: string, at: string): string {
  const value = source[key];
  if (typeof value !== "string") throw new PresetFormatError(`${at}.${key} must be a string`);
  return value;
}

function optStr(source: Obj, key: string, at: string): string | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new PresetFormatError(`${at}.${key} must be a string`);
  return value;
}

function num(source: Obj, key: string, at: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PresetFormatError(`${at}.${key} must be a number`);
  }
  return value;
}

function optNum(source: Obj, key: string, at: string): number | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  return num(source, key, at);
}

function bool(source: Obj, key: string): boolean {
  return source[key] === true;
}

function strList(value: unknown, at: string): string[] {
  return optArr(value, at).filter((item): item is string => typeof item === "string");
}

function parseStage(raw: unknown, at: string): Stage {
  const o = obj(raw, at);
  return {
    id: str(o, "id", at),
    name: str(o, "name", at),
    tier: optNum(o, "tier", at) ?? 1,
    hours: optArr(o.hours, `${at}.hours`).map((item, i) => {
      const h = obj(item, `${at}.hours[${i}]`);
      return {
        day: num(h, "day", `${at}.hours[${i}]`),
        open: num(h, "open", `${at}.hours[${i}]`),
        close: num(h, "close", `${at}.hours[${i}]`),
      };
    }),
  };
}

function parseAct(raw: unknown, at: string): Act {
  const o = obj(raw, at);
  return {
    id: str(o, "id", at),
    name: str(o, "name", at),
    qloo_id: optStr(o, "qloo_id", at),
    popularity: optNum(o, "popularity", at),
    genre: optStr(o, "genre", at),
    billing_tier: optNum(o, "billing_tier", at) ?? 3,
  };
}

const CLOCK = /^(\d{1,2}):([0-5]\d)$/;

/** Minutes from day start, or an "HH:MM" string as the backend also accepts. */
function minutes(source: Obj, key: string, at: string): number {
  const value = source[key];
  if (typeof value === "string") {
    const match = CLOCK.exec(value.trim());
    if (match) return Number(match[1]) * 60 + Number(match[2]);
  }
  return num(source, key, at);
}

/** A start-window bound, read leniently: anything that is not a time counts as no bound. */
function optMinutes(source: Obj, key: string): number | null {
  const value = source[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const match = CLOCK.exec(value.trim());
    if (match) return Number(match[1]) * 60 + Number(match[2]);
  }
  return null;
}

/** Allowed stages, read leniently: anything but a non-empty list of ids counts as any stage. */
function optStageIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return ids.length > 0 ? ids : null;
}

function parseSlot(raw: unknown, at: string): SetSlot {
  const o = obj(raw, at);
  const slot: SetSlot = {
    act_id: str(o, "act_id", at),
    day: num(o, "day", at),
    stage_id: str(o, "stage_id", at),
    start: minutes(o, "start", at),
    end: minutes(o, "end", at),
    locked: bool(o, "locked"),
    not_before: optMinutes(o, "not_before"),
    not_after: optMinutes(o, "not_after"),
    stages: optStageIds(o.stages),
  };
  if (slot.end <= slot.start) throw new PresetFormatError(`${at} must end after it starts`);
  return slot;
}

function parseFestival(raw: unknown): Festival {
  const at = "festival";
  const o = obj(raw, at);
  const festival: Festival = {
    id: str(o, "id", at),
    name: str(o, "name", at),
    city: optStr(o, "city", at),
    days: strList(o.days, `${at}.days`),
    stages: arr(o.stages, `${at}.stages`).map((s, i) => parseStage(s, `${at}.stages[${i}]`)),
    acts: arr(o.acts, `${at}.acts`).map((a, i) => parseAct(a, `${at}.acts[${i}]`)),
    timetable: arr(o.timetable, `${at}.timetable`).map((s, i) =>
      parseSlot(s, `${at}.timetable[${i}]`),
    ),
  };
  if (festival.days.length === 0) festival.days = ["Day 1"];
  const stageIds = new Set(festival.stages.map((s) => s.id));
  const actIds = new Set(festival.acts.map((a) => a.id));
  for (const slot of festival.timetable) {
    if (!stageIds.has(slot.stage_id)) {
      throw new PresetFormatError(`set for ${slot.act_id} is on unknown stage ${slot.stage_id}`);
    }
    if (!actIds.has(slot.act_id)) throw new PresetFormatError(`timetable lists unknown act ${slot.act_id}`);
  }
  return festival;
}

function parseClashAct(raw: unknown, at: string): ClashAct {
  const o = obj(raw, at);
  return {
    act_id: str(o, "act_id", at),
    name: str(o, "name", at),
    stage_id: str(o, "stage_id", at),
    genre: optStr(o, "genre", at),
  };
}

function parseClash(raw: unknown, at: string): PairClash {
  const o = obj(raw, at);
  const label = o.label === "hidden" || o.label === "false" ? o.label : null;
  return {
    rank: num(o, "rank", at),
    a: parseClashAct(o.a, `${at}.a`),
    b: parseClashAct(o.b, `${at}.b`),
    day: num(o, "day", at),
    overlap_minutes: num(o, "overlap_minutes", at),
    concurrency: num(o, "concurrency", at),
    audience_overlap: num(o, "audience_overlap", at),
    draw: num(o, "draw", at),
    regret: num(o, "regret", at),
    regret_share: num(o, "regret_share", at),
    label,
    confidence: o.confidence === "weak" ? "weak" : "strong",
  };
}

function parseReport(raw: unknown): ScoreReport {
  const at = "report";
  const o = obj(raw, at);
  const m = obj(o.metrics, `${at}.metrics`);
  const c = obj(o.coverage, `${at}.coverage`);
  const b = isRecord(o.baseline) ? o.baseline : null;
  const t = isRecord(o.thresholds) ? o.thresholds : {};
  const mv = isRecord(o.movability) ? o.movability : null;
  const clashes = arr(o.clashes, `${at}.clashes`).map((item, i) =>
    parseClash(item, `${at}.clashes[${i}]`),
  );
  clashes.sort((x, y) => x.rank - y.rank);
  return {
    metrics: {
      regret: num(m, "regret", `${at}.metrics`),
      clash_budget_index: optNum(m, "clash_budget_index", `${at}.metrics`),
      scored_concurrent_pairs: optNum(m, "scored_concurrent_pairs", `${at}.metrics`) ?? 0,
      unscored_concurrent_pairs: optNum(m, "unscored_concurrent_pairs", `${at}.metrics`) ?? 0,
    },
    baseline: b
      ? {
          samples: optNum(b, "samples", `${at}.baseline`) ?? 0,
          mean_regret: optNum(b, "mean_regret", `${at}.baseline`) ?? 0,
          p10_index: optNum(b, "p10_index", `${at}.baseline`),
          p90_index: optNum(b, "p90_index", `${at}.baseline`),
          degenerate: bool(b, "degenerate"),
        }
      : null,
    clashes,
    hidden_clash_count: optNum(o, "hidden_clash_count", at) ?? 0,
    thresholds: {
      hidden_overlap: optNum(t, "hidden_overlap", `${at}.thresholds`),
      false_overlap: optNum(t, "false_overlap", `${at}.thresholds`),
    },
    coverage: {
      strong: num(c, "strong", `${at}.coverage`),
      weak: num(c, "weak", `${at}.coverage`),
      none: num(c, "none", `${at}.coverage`),
      scored_acts: num(c, "scored_acts", `${at}.coverage`),
      scored_share: num(c, "scored_share", `${at}.coverage`),
      unscored: optArr(c.unscored, `${at}.coverage.unscored`).map((item, i) => {
        const u = obj(item, `${at}.coverage.unscored[${i}]`);
        return {
          act_id: str(u, "act_id", `${at}.coverage.unscored[${i}]`),
          name: str(u, "name", `${at}.coverage.unscored[${i}]`),
          reason: optStr(u, "reason", `${at}.coverage.unscored[${i}]`) ?? "no_signal",
        };
      }),
      weak_act_ids: strList(c.weak_act_ids, `${at}.coverage.weak_act_ids`),
    },
    movability: mv
      ? {
          total_sets: optNum(mv, "total_sets", `${at}.movability`) ?? 0,
          locked: optNum(mv, "locked", `${at}.movability`) ?? 0,
          unscored: optNum(mv, "unscored", `${at}.movability`) ?? 0,
          movable: optNum(mv, "movable", `${at}.movability`) ?? 0,
          movable_share: optNum(mv, "movable_share", `${at}.movability`) ?? 0,
        }
      : null,
  };
}

function parseTags(raw: unknown, at: string): SharedTag[] {
  return optArr(raw, at).flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim()) return [];
    return [
      {
        name: item.name,
        kind: typeof item.kind === "string" ? item.kind : null,
        score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : null,
      },
    ];
  });
}

function parsePair<T>(raw: unknown, at: string, read: (item: unknown, at: string) => T): [T, T] {
  const items = arr(raw, at);
  if (items.length !== 2) throw new PresetFormatError(`${at} must have two entries`);
  return [read(items[0], `${at}[0]`), read(items[1], `${at}[1]`)];
}

function parseWallItem(raw: unknown, at: string): HiddenWallItem {
  const o = obj(raw, at);
  const genres = Array.isArray(o.genres) && o.genres.length === 2 ? o.genres : [[], []];
  return {
    festival: str(o, "festival", at),
    day: optStr(o, "day", at) ?? "",
    acts: parsePair(o.acts, `${at}.acts`, (item, where) => {
      if (typeof item !== "string") throw new PresetFormatError(`${where} must be a string`);
      return item;
    }),
    genres: [strList(genres[0], `${at}.genres[0]`), strList(genres[1], `${at}.genres[1]`)],
    overlap_pct: num(o, "overlap_pct", at),
    draw_pct: optNum(o, "draw_pct", at),
    overlap_min: optNum(o, "overlap_min", at),
    source: optStr(o, "source", at),
    shared_tags: parseTags(o.shared_tags, `${at}.shared_tags`),
  };
}

function parseRival(raw: unknown, at: string): TwinRival {
  const o = obj(raw, at);
  return {
    act: str(o, "act", at),
    act_id: optStr(o, "act_id", at),
    overlap: num(o, "overlap", at),
    draw_pct: num(o, "draw_pct", at),
  };
}

function parseEvidence(raw: unknown): Evidence | null {
  if (raw === undefined || raw === null) return null;
  const at = "evidence";
  const o = obj(raw, at);
  const receipts: Record<string, Receipt> = {};
  if (isRecord(o.receipts)) {
    for (const [key, value] of Object.entries(o.receipts)) {
      if (!isRecord(value)) continue;
      receipts[key] = {
        shared_tags: parseTags(value.shared_tags, `${at}.receipts.${key}.shared_tags`),
        press: typeof value.press === "string" && value.press ? value.press : null,
      };
    }
  }
  const hiddenWall = optArr(o.hidden_wall, `${at}.hidden_wall`).map((item, i) =>
    parseWallItem(item, `${at}.hidden_wall[${i}]`),
  );
  return {
    hidden_wall: hiddenWall,
    hidden_wall_total: Math.max(optNum(o, "hidden_wall_total", at) ?? 0, hiddenWall.length),
    receipts,
    twins: optArr(o.twins, `${at}.twins`).map((item, i) => {
      const t = obj(item, `${at}.twins[${i}]`);
      return {
        act: str(t, "act", `${at}.twins[${i}]`),
        act_id: optStr(t, "act_id", `${at}.twins[${i}]`),
        shared: parseRival(t.shared, `${at}.twins[${i}].shared`),
        separate: parseRival(t.separate, `${at}.twins[${i}].separate`),
        gap: optNum(t, "gap", `${at}.twins[${i}]`) ?? 0,
      };
    }),
  };
}

/** Qloo parameters are flat strings; anything else is flattened (lists use commas). */
function paramString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => String(item)).join(",");
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * A request saved with the preset. These are replayed, not live, so they are flagged `recorded`.
 * Latency is not stored with presets and is left as NaN, which the trace shows as unknown.
 */
export function toRecordedRequest(raw: unknown, at = "request"): QlooRequestRecord {
  const o = obj(raw, at);
  const params: Record<string, string> = {};
  if (isRecord(o.params)) {
    for (const [key, value] of Object.entries(o.params)) {
      if (value !== undefined && value !== null) params[key] = paramString(value);
    }
  }
  const record: QlooRequestRecord = {
    path: str(o, "path", at),
    params,
    status: optNum(o, "status", at) ?? 0,
    latency_ms: optNum(o, "latency_ms", at) ?? Number.NaN,
    cached: bool(o, "cached"),
    recorded: true,
  };
  const requestId = optStr(o, "request_id", at);
  if (requestId) record.request_id = requestId;
  return record;
}

function parseSources(raw: unknown): SourceLink[] {
  return optArr(raw, "sources").flatMap((item) => {
    if (!isRecord(item) || typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) return [];
    return [{ url: item.url, accessed: typeof item.accessed === "string" ? item.accessed : null }];
  });
}

/** Validates a preset from `GET /api/presets/{id}`. Throws `PresetFormatError`. */
export function parsePreset(raw: unknown): Preset {
  const o = obj(raw, "preset");
  return {
    id: str(o, "id", "preset"),
    title: str(o, "title", "preset"),
    built_at: optStr(o, "built_at", "preset"),
    synthetic: bool(o, "synthetic"),
    festival: parseFestival(o.festival),
    report: parseReport(o.report),
    requests: optArr(o.requests, "requests").map((item, i) =>
      toRecordedRequest(item, `requests[${i}]`),
    ),
    sources: parseSources(o.sources),
    overlap_notes: strList(o.overlap_notes, "overlap_notes"),
    evidence: parseEvidence(o.evidence),
  };
}

/** Validates the list from `GET /api/presets`. Throws `PresetFormatError`. */
export function parsePresetList(raw: unknown): PresetSummary[] {
  return arr(raw, "presets").map((item, i) => {
    const at = `presets[${i}]`;
    const o = obj(item, at);
    return {
      id: str(o, "id", at),
      title: str(o, "title", at),
      city: optStr(o, "city", at),
      sets: optNum(o, "sets", at) ?? 0,
      stages: optNum(o, "stages", at) ?? 0,
      scored_share: optNum(o, "scored_share", at),
      synthetic: bool(o, "synthetic"),
    };
  });
}
