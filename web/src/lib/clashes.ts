/**
 * Maps a preset into what the timetable screens draw: set views with their stage column and
 * clashes, receipts per clash, the Qloo requests behind a clash, and display formatting.
 */

import type { QlooRequestRecord } from "./events";
import type {
  Act,
  ClashLabel,
  Evidence,
  PairClash,
  Preset,
  Receipt,
  SetSlot,
  SharedTag,
  Stage,
} from "./preset";
import type { ToolCallState } from "./run-state";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 0.9865 -> "99%". Values are clamped to 0..1. */
export function formatPercent(value: number, digits = 0): string {
  const clamped = Math.min(1, Math.max(0, value));
  return `${(clamped * 100).toFixed(digits)}%`;
}

/** A 0..1 share shown with one decimal under 10% ("3.5%") and none above ("29%"). */
export function formatShare(value: number): string {
  return formatPercent(value, value < 0.1 ? 1 : 0);
}

/** Draw (Qloo popularity, 0..1) on a 0..100 scale: 0.9722 -> "97". */
export function formatDraw(value: number): string {
  return String(Math.round(Math.min(1, Math.max(0, value)) * 100));
}

/**
 * Taste overlap (a rank among the other acts on the bill, 0..1) as a number out of 100: 0.9865 ->
 * "99". Never printed with a percent sign: it is a rank, not a share of fans.
 */
export function formatOverlap(value: number): string {
  return String(Math.round(Math.min(1, Math.max(0, value)) * 100));
}

const ORDINAL_SUFFIX: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };

/** 1 -> "1st", 12 -> "12th", 22 -> "22nd", 111 -> "111th". */
export function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${ORDINAL_SUFFIX[n % 10] ?? "th"}`;
}

/** A 0..1 rank among one festival day's clashes, in words: 0.941 -> "94th percentile of that day's clashes". */
export function describeDayRank(value: number): string {
  if (value >= 0.995) return "highest of that day's clashes";
  return `${ordinal(Math.round(Math.min(1, Math.max(0, value)) * 100))} percentile of that day's clashes`;
}

/** Fan forums are not press: links to reddit.com read "Forum", everything else "Press". */
export function sourceLabel(url: string): "Forum" | "Press" {
  const host = hostOf(url).toLowerCase();
  return host === "reddit.com" || host.endsWith(".reddit.com") ? "Forum" : "Press";
}

/** How many of a pair's tags a screen shows before "+N more". */
export const TAG_LIMIT = 5;

/** Shown under a pair's tags, because some tags come back for most pairs and say little about one. */
export const BROAD_TAGS_NOTE = "Broad tags such as Jazz, Blues or Electronic come back for many pairs.";

/**
 * The first `limit` of a pair's tags, in the order they are stored (Qloo's score for the pair,
 * highest first), and how many more there are. The order is never changed here.
 */
export function leadingTags(tags: readonly SharedTag[], limit = TAG_LIMIT): { shown: SharedTag[]; more: number } {
  return { shown: tags.slice(0, limit), more: Math.max(0, tags.length - limit) };
}

/** How many acts with a Qloo signal have a draw of at least `cutoff`, out of all such acts. */
export function popularitySpread(acts: readonly Act[], cutoff = 0.9): { atLeast: number; total: number } {
  const scored = acts.filter((act) => act.popularity !== null);
  return {
    atLeast: scored.filter((act) => (act.popularity ?? 0) >= cutoff).length,
    total: scored.length,
  };
}

/** "urn:tag:genre:music:dream_pop" or "dream_pop" -> "Dream Pop". Plain names pass through. */
export function tagLabel(tag: string): string {
  const raw = tag.includes(":") ? (tag.split(":").pop() ?? tag) : tag;
  if (!/[_-]/.test(raw) && raw !== raw.toLowerCase()) return raw;
  return raw
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "outside-lands-2026" -> "Outside Lands 2026"; "coachella-2026-w1" -> "Coachella 2026 W1". */
export function festivalLabel(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => (/^w\d+$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

const DAY_NAMES: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  tues: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** "Sun" -> "Sunday"; other labels pass through. */
export function dayName(label: string): string {
  return DAY_NAMES[label.trim().toLowerCase().replace(/\.$/, "")] ?? label;
}

/** The festival's name without a trailing day ("Riot Fest 2026, Sun" -> "Riot Fest 2026"). */
export function festivalName(festival: { name: string; days: readonly string[] }): string {
  for (const day of festival.days) {
    for (const suffix of [`, ${day}`, ` - ${day}`, ` ${day}`]) {
      if (festival.name.endsWith(suffix) && festival.name.length > suffix.length) {
        return festival.name.slice(0, -suffix.length);
      }
    }
  }
  return festival.name;
}

/** "https://www.nme.com/features/..." -> "nme.com". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Only http(s) links are ever rendered as links. */
export function isWebUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const LABEL_META: Record<ClashLabel, { name: string; short: string; explain: string }> = {
  hidden: {
    name: "Hidden clash",
    short: "Hidden",
    explain: "The acts' main genre tags differ, but their taste overlap is among the day's highest.",
  },
  false: {
    name: "False clash",
    short: "False",
    explain: "The acts share a main genre tag, but their taste overlap is low.",
  },
};

// ---------------------------------------------------------------------------
// Timetable views
// ---------------------------------------------------------------------------

export type SetCoverage = "strong" | "weak" | "none";

export type SetView = {
  /** The act id; each act has one set. */
  id: string;
  slot: SetSlot;
  act: Act;
  stage: Stage;
  /** Stage column, in festival stage order. */
  col: number;
  coverage: SetCoverage;
  /** Ranked clashes this set is part of, costliest first. */
  clashes: PairClash[];
};

/** The other act in a clash. */
export function partnerOf(clash: PairClash, actId: string): PairClash["a"] {
  return clash.a.act_id === actId ? clash.b : clash.a;
}

export function involves(clash: PairClash, actId: string): boolean {
  return clash.a.act_id === actId || clash.b.act_id === actId;
}

/** Every set on one festival day, with its stage column, coverage and ranked clashes. */
export function buildSetViews(preset: Pick<Preset, "festival" | "report">, day: number): SetView[] {
  const { festival, report } = preset;
  const acts = new Map(festival.acts.map((act) => [act.id, act]));
  const stageIndex = new Map(festival.stages.map((stage, index) => [stage.id, index]));
  const unscored = new Set(report.coverage.unscored.map((item) => item.act_id));
  const weak = new Set(report.coverage.weak_act_ids);
  const dayClashes = report.clashes.filter((clash) => clash.day === day);

  return festival.timetable
    .filter((slot) => slot.day === day)
    .flatMap((slot) => {
      const act = acts.get(slot.act_id);
      const col = stageIndex.get(slot.stage_id);
      if (!act || col === undefined) return [];
      return [
        {
          id: act.id,
          slot,
          act,
          stage: festival.stages[col],
          col,
          coverage: unscored.has(act.id) ? "none" : weak.has(act.id) ? "weak" : "strong",
          clashes: dayClashes.filter((clash) => involves(clash, act.id)),
        } satisfies SetView,
      ];
    })
    .sort((p, q) => p.col - q.col || p.slot.start - q.slot.start);
}

/** Days that have at least one set, as indexes into `festival.days`. */
export function daysWithSets(preset: Pick<Preset, "festival">): number[] {
  return [...new Set(preset.festival.timetable.map((slot) => slot.day))].sort((p, q) => p - q);
}

/** The costliest `limit` clashes of a day. */
export function topClashes(clashes: readonly PairClash[], day: number, limit = 10): PairClash[] {
  return clashes
    .filter((clash) => clash.day === day)
    .sort((p, q) => p.rank - q.rank)
    .slice(0, limit);
}

/** Stable id for a clash, used in element ids and selection state. */
export function clashKey(clash: Pick<PairClash, "a" | "b">): string {
  return pairKey(clash.a.act_id, clash.b.act_id);
}

export function pairKey(a: string, b: string): string {
  return `${a}|${b}`;
}

/** The receipt for a pair, whichever order its key was written in. */
export function receiptFor(evidence: Evidence | null, a: string, b: string): Receipt | null {
  if (!evidence) return null;
  return evidence.receipts[pairKey(a, b)] ?? evidence.receipts[pairKey(b, a)] ?? null;
}

// ---------------------------------------------------------------------------
// Qloo requests
// ---------------------------------------------------------------------------

const ENTITY_PARAMS = [
  "signal.interests.entities",
  "a.signal.interests.entities",
  "b.signal.interests.entities",
] as const;

function entitiesIn(record: QlooRequestRecord): string[] {
  return ENTITY_PARAMS.flatMap((key) => (record.params[key] ?? "").split(",")).filter(Boolean);
}

/**
 * The requests that fed a clash between these acts: the searches that matched each act to Qloo,
 * the audience rankings run from each act, and any direct comparison of the two.
 */
export function requestsForActs(
  requests: readonly QlooRequestRecord[],
  acts: readonly Pick<Act, "name" | "qloo_id">[],
): QlooRequestRecord[] {
  const names = new Set(acts.map((act) => act.name.trim().toLowerCase()));
  const ids = acts.map((act) => act.qloo_id).filter((id): id is string => Boolean(id));
  const idSet = new Set(ids);
  return requests.filter((record) => {
    if (record.path.endsWith("/search")) {
      return names.has((record.params.query ?? "").trim().toLowerCase());
    }
    const entities = entitiesIn(record);
    if (record.path.endsWith("/analysis/compare")) {
      return ids.length === 2 && entities.length >= 2 && entities.every((id) => idSet.has(id));
    }
    return entities.some((id) => idSet.has(id));
  });
}

type RequestGroup = { tool: string; summary: string; match: (path: string) => boolean };

const REQUEST_GROUPS: readonly RequestGroup[] = [
  {
    tool: "match_acts",
    summary: "Matched each act on the timetable to a Qloo artist entity.",
    match: (path) => path.endsWith("/search"),
  },
  {
    tool: "rank_audiences",
    summary:
      "For one act's fans, ranked every other act on the day. Both directions, rank-normalized and averaged, give the audience overlap.",
    match: (path) => path.endsWith("/insights"),
  },
  {
    tool: "compare_audiences",
    summary: "Compared two acts' audiences and returned the tags their fans share.",
    match: (path) => path.endsWith("/analysis/compare"),
  },
];

/**
 * Groups saved requests into the trace drawer's tool calls, by what they were used for. The order
 * of requests inside each group is kept.
 */
export function traceToolCalls(records: readonly QlooRequestRecord[], idPrefix: string): ToolCallState[] {
  const groups: { group: RequestGroup; requests: QlooRequestRecord[] }[] = REQUEST_GROUPS.map(
    (group) => ({ group, requests: [] }),
  );
  const other: QlooRequestRecord[] = [];
  for (const record of records) {
    const target = groups.find(({ group }) => group.match(record.path));
    if (target) target.requests.push(record);
    else other.push(record);
  }
  const calls: ToolCallState[] = groups
    .filter(({ requests }) => requests.length > 0)
    .map(({ group, requests }, index) => ({
      id: `${idPrefix}-${group.tool}`,
      tool: group.tool,
      provenance: "recorded",
      status: requests.every((r) => r.status >= 200 && r.status < 300) ? "done" : "error",
      summary: group.summary,
      requests,
      seq: index,
    }));
  if (other.length > 0) {
    calls.push({
      id: `${idPrefix}-other`,
      tool: "other_requests",
      provenance: "recorded",
      status: "done",
      requests: other,
      seq: calls.length,
    });
  }
  return calls;
}
