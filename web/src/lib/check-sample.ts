/**
 * An invented day for "Check an invented sample" on the check page: the 24 acts of the invented example day the
 * API serves when no festival day is built (Lanternfield, four stages), as a draft grid of 25 sets. The
 * act names come from this repo's synthetic generator (random word pairs); no real festival and no
 * real act is meant, and no Qloo data is in them. Because they are that day's acts, "Compare audience overlap" on the
 * sample is answered from the invented day without a Qloo request, on any clone.
 *
 * Exactly four findings are planted, so the first result is a visible list:
 * - an act on two stages at once: Orchid Bloom, Grove Stage 16:40 and Night Tent 16:30;
 * - a short changeover: Willow Circuit ends 18:55 and Neon Garden starts 19:05 on the Grove Stage;
 * - a set past the 00:00 curfew: Rustic Harbour ends 00:20 on the Night Tent;
 * - a pair listed as never overlapping that shares 20 minutes: Saffron Season and Ivory Lights.
 * Every other gap on a stage is 20 minutes or more and no two sets on one stage overlap.
 */

import { formatClock, normalizeName, parseGrid, type CheckInput, type CheckSet } from "./check";
import type { SavedRanking } from "./check-price";
import { gridText } from "./check-trial";
import { numberWord } from "./method-figures";

export const SAMPLE_GRID = [
  "act,stage,start,end,locked",
  "Tidal Fields,Main Stage,10:25,11:10,",
  "Juniper Bloom,Main Stage,11:40,12:35,",
  "Crimson Season,Main Stage,13:20,14:35,",
  "Marble Syndicate,Main Stage,15:15,16:25,",
  "Brass Choir,Main Stage,16:55,18:35,yes",
  "Glass Mirror,Main Stage,19:20,20:50,yes",
  "Fable Pilots,Main Stage,21:20,23:00,yes",
  "Willow Bloom,Riverside Stage,14:10,14:50,",
  "Echo Mirror,Riverside Stage,15:25,16:05,",
  "Saffron Season,Riverside Stage,16:40,17:40,",
  "Cobalt Choir,Riverside Stage,18:05,19:05,",
  "Marble Machine,Riverside Stage,19:25,20:45,",
  "Rustic Season,Riverside Stage,21:15,22:30,",
  "Cedar Roads,Grove Stage,14:15,15:00,",
  "Harbor Atlas,Grove Stage,15:25,16:05,",
  "Orchid Bloom,Grove Stage,16:40,17:20,",
  "Willow Circuit,Grove Stage,17:55,18:55,",
  "Neon Garden,Grove Stage,19:05,20:05,",
  "Fable Meadow,Grove Stage,20:40,22:00,",
  "Orchid Bloom,Night Tent,16:30,17:00,",
  "Ivory Lights,Night Tent,17:20,18:05,",
  "Cobalt Hours,Night Tent,18:25,19:10,",
  "Hollow Meadow,Night Tent,19:45,20:40,",
  "Neon Harbour,Night Tent,21:05,22:05,",
  "Rustic Harbour,Night Tent,23:20,00:20,",
  "",
].join("\n");

export const SAMPLE_SETTINGS = {
  changeover: "15",
  curfew: "00:00",
  pairs: "Saffron Season | Ivory Lights",
} as const;

/** The four planted findings listed above. */
export const SAMPLE_PLANTED_BREAKS = 4;

/** Sets in the sample grid: its lines, less the header. */
export const SAMPLE_SET_COUNT = SAMPLE_GRID.split("\n").filter((line) => line.trim() !== "").length - 1;

/** Shown above the results, and printed on the brief, while the checked grid is this sample. */
export const SAMPLE_LABEL = `Invented sample: ${SAMPLE_SET_COUNT} sets with ${numberWord(SAMPLE_PLANTED_BREAKS)} planted rule breaks.`;

/** True when every field holds exactly what "Check an invented sample" fills in. */
export function isSampleInput(input: { grid: string; changeover: string; curfew: string; pairs: string }): boolean {
  return (
    input.grid === SAMPLE_GRID &&
    input.changeover === SAMPLE_SETTINGS.changeover &&
    input.curfew === SAMPLE_SETTINGS.curfew &&
    input.pairs === SAMPLE_SETTINGS.pairs
  );
}

// ---------------------------------------------------------------------------------------------------
// Where a pair rule came from

/** The pair lines of a rules text, as written, blank lines left out. */
export function ruleLines(pairs: string): string[] {
  return pairs.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
}

/** The pair rules "Check an invented sample" loads: each one is the sample's until the person edits it. */
export const SAMPLE_RULES: readonly string[] = ruleLines(SAMPLE_SETTINGS.pairs);

/**
 * The sample's rules still in a rules text the person has just edited: a sample line they left exactly as
 * it was stays the sample's, and anything they typed or changed is theirs. Counted, so two equal lines
 * are two rules.
 */
export function keepSampleRules(pairs: string, sampleRules: readonly string[]): string[] {
  const left = [...sampleRules];
  const kept: string[] = [];
  for (const line of ruleLines(pairs)) {
    const at = left.indexOf(line);
    if (at >= 0) {
      kept.push(line);
      left.splice(at, 1);
    }
  }
  return kept;
}

/** Act names of the invented sample, compared as the check compares them. */
const SAMPLE_ACT_KEYS: ReadonlySet<string> = new Set(
  SAMPLE_GRID.split("\n")
    .slice(1)
    .filter((line) => line.trim() !== "")
    .map((line) => normalizeName(line.split(",")[0])),
);

/**
 * Whether at least `share` of these names are the sample's acts, compared as the check compares names. The
 * sample's acts are the invented example day's lineup, and the server answers a saved compare from the saved
 * day holding most of the names sent (`share`, 0.8 there), so this says the sample's compare will be answered
 * from the invented day. False for no names.
 */
export function onSampleDay(names: readonly string[], share: number): boolean {
  if (names.length === 0) return false;
  const on = names.filter((name) => SAMPLE_ACT_KEYS.has(normalizeName(name))).length;
  return on >= share * names.length;
}

/**
 * Whether a grid replaced the invented sample rather than edited it: it keeps fewer than half of the
 * sample's act names. Renaming one act of the sample is an edit, not a replacement.
 */
export function replacesSample(sets: readonly Pick<CheckSet, "actKey">[]): boolean {
  const kept = new Set(sets.map((set) => set.actKey).filter((key) => SAMPLE_ACT_KEYS.has(key)));
  return kept.size * 2 < SAMPLE_ACT_KEYS.size;
}

/** What `dropSampleRules` did: the rules text after it, the sample's rules still in it, one notice per rule removed. */
export type RuleDrop = { pairs: string; sampleRules: string[]; removed: string[] };

/** The notice for one removed sample rule, naming it, said once in the results. */
export function removedNotice(line: string, missing: number): string {
  const rule = line
    .split("|")
    .map((part) => part.normalize("NFC").trim().replace(/\s+/g, " "))
    .join(" | ");
  return `Removed the sample's rule "${rule}": ${missing >= 2 ? "neither act is" : "one of these acts is not"} in this grid.`;
}

/**
 * After the grid text changes: drop each pair rule that came from the invented sample and names an act no
 * longer in the grid, but only when the new grid reads with no grid-level problem and replaced the sample
 * (`replacesSample`). An act written on a skipped line is still in the grid: a sample rule that names it is
 * kept, and the check lists it as "Pair line {p} not checked: {act} is on a skipped line." A rule the person
 * typed or edited is never removed here, whatever it names; an unmatched one still refuses at check time and
 * offers "Remove this rule". Pure.
 */
export function dropSampleRules(pairs: string, sampleRules: readonly string[], grid: string): RuleDrop {
  const sample = keepSampleRules(pairs, sampleRules);
  const unchanged: RuleDrop = { pairs, sampleRules: sample, removed: [] };
  if (sample.length === 0) return unchanged;
  const parsed = parseGrid(grid);
  if (!parsed.ok || !replacesSample(parsed.sets)) return unchanged;
  // The acts the check reads, and the acts written on lines it skips (compared as the check compares them).
  const acts = new Set([
    ...parsed.sets.map((set) => set.actKey),
    ...parsed.skipped.flatMap((item) => (item.act === null ? [] : [normalizeName(item.act)])),
  ]);
  const left = [...sample];
  const removed: string[] = [];
  const keptLines: string[] = [];
  for (const line of pairs.split(/\r\n|\r|\n/)) {
    const at = line.trim() === "" ? -1 : left.indexOf(line);
    if (at < 0) {
      keptLines.push(line);
      continue;
    }
    const missing = line.split("|").filter((part) => !acts.has(normalizeName(part))).length;
    if (missing === 0) {
      keptLines.push(line);
      continue;
    }
    left.splice(at, 1);
    removed.push(removedNotice(line, missing));
  }
  if (removed.length === 0) return unchanged;
  const next = keptLines.join("\n");
  return { pairs: next.trim() === "" ? "" : next, sampleRules: keepSampleRules(next, left), removed };
}

// ---------------------------------------------------------------------------------------------------
// A published day, as a draft grid

/**
 * "Check a published day": one published festival day from this app's API (`GET /api/presets/{id}`) as
 * the sheet. The fields get only the public timetable (act names, stages, start and end times, locks) with
 * the day's own changeover, curfew and never-overlap pairs; nothing Qloo-derived is copied into them. The
 * day's billing rules and stage hours are not rules this page checks, so the label says so.
 *
 * Kept beside the fields, in memory only, from the same answer: the saved day's ranked clashes as act names
 * (costliest first, the order the timetable page ranks them), the acts it marks as having no usable signal,
 * and its counts of overlapping pairs with and without a usable signal. Compare audience overlap reads the
 * first two to choose its pairs; the label reads the counts. No taste value is read.
 */
export type PublishedInput = {
  input: CheckInput;
  title: string;
  label: string;
  /** The saved day's ranked clashes and its no-signal acts; null when the answer carries none. */
  ranking?: SavedRanking | null;
  /** The saved day's overlapping pairs where both acts have a usable signal, and the others; null when absent. */
  pairCounts?: { scored: number; unscored: number } | null;
  /**
   * The public timetable's own ids, so a change Find a change lists can be scored on that day's index:
   * the preset's id, the day checked, and its acts and stages by normalised name (`normalizeName`).
   */
  ids?: PublishedIds | null;
};

/** A published day's ids for the what-if route: no Qloo value, only the timetable's names and ids. */
export type PublishedIds = {
  presetId: string;
  day: number;
  acts: ReadonlyMap<string, string>;
  stages: ReadonlyMap<string, string>;
};

/** The label above the results and on the brief while the checked grid is a published day. */
export function publishedLabel(title: string): string {
  return `Published timetable: ${title}. Curfew and changeover from that day; its billing rules and stage hours are not checked here. Its taste overlap compares from the saved day; nothing is sent to Qloo.`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown, max = 80): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : null;
}

function asMinutes(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2 * 1440 ? value : null;
}

/**
 * The fields "Check a published day" fills, from the day's JSON: its first day's sets in stage order then
 * time, its changeover, its curfew for that day and its never-overlap pairs written with the acts' names.
 * Never the invented sample's settings. Null for an invented day, or when the JSON is not a festival day
 * with at least one set.
 */
export function publishedDayInput(json: unknown): PublishedInput | null {
  const preset = asRecord(json);
  if (!preset || preset.synthetic === true) return null;
  const title = asText(preset.title);
  const festival = asRecord(preset.festival);
  if (!title || !festival) return null;
  const stages = new Map<string, { name: string; order: number }>();
  (Array.isArray(festival.stages) ? festival.stages : []).forEach((item: unknown, order: number) => {
    const stage = asRecord(item);
    const id = asText(stage?.id);
    const name = asText(stage?.name);
    if (id && name) stages.set(id, { name, order });
  });
  const acts = new Map<string, string>();
  for (const item of Array.isArray(festival.acts) ? (festival.acts as unknown[]) : []) {
    const act = asRecord(item);
    const id = asText(act?.id);
    const name = asText(act?.name);
    if (id && name) acts.set(id, name);
  }
  const slots = (Array.isArray(festival.timetable) ? (festival.timetable as unknown[]) : []).flatMap((item) => {
    const slot = asRecord(item);
    const actId = asText(slot?.act_id) ?? "";
    const act = acts.get(actId);
    const stage = stages.get(asText(slot?.stage_id) ?? "");
    const start = asMinutes(slot?.start);
    const end = asMinutes(slot?.end);
    const day = asMinutes(slot?.day);
    if (!slot || !act || !stage || start === null || end === null || day === null || end <= start) return [];
    return [{ act, actId, stage: stage.name, order: stage.order, start, end, day, locked: slot.locked === true }];
  });
  if (slots.length === 0) return null;
  const day = Math.min(...slots.map((slot) => slot.day));
  const sets = slots
    .filter((slot) => slot.day === day)
    .sort((x, y) => x.order - y.order || x.start - y.start || x.act.localeCompare(y.act));
  const constraints = asRecord(festival.constraints);
  const changeover = constraints?.changeover_minutes;
  const curfew = asMinutes(asRecord(constraints?.curfew)?.[String(day)]);
  const onDay = new Set(sets.map((slot) => slot.actId));
  const rules = Array.isArray(constraints?.no_clash_with) ? (constraints.no_clash_with as unknown[]) : [];
  const pairs = rules.flatMap((item) => {
    if (!Array.isArray(item) || item.length !== 2) return [];
    const [a, b] = item.map((id: unknown) => (typeof id === "string" && onDay.has(id) ? acts.get(id) : undefined));
    return a && b ? [`${a} | ${b}`] : [];
  });
  const grid = gridText(
    sets.map((slot, index) => ({
      row: index + 2,
      act: slot.act,
      stage: slot.stage,
      actKey: normalizeName(slot.act),
      stageKey: normalizeName(slot.stage),
      start: slot.start,
      end: slot.end,
      locked: slot.locked,
    })),
  );
  const presetId = asText(preset.id);
  const actIds = new Map<string, string>();
  for (const slot of sets) actIds.set(normalizeName(slot.act), slot.actId);
  const stageIds = new Map<string, string>();
  for (const [id, stage] of stages) stageIds.set(normalizeName(stage.name), id);
  return {
    title,
    label: publishedLabel(title),
    ranking: savedRanking(preset.report, acts, day),
    pairCounts: pairCountsOf(preset.report),
    ids: presetId && /^[\w.-]{1,80}$/.test(presetId) ? { presetId, day, acts: actIds, stages: stageIds } : null,
    input: {
      grid,
      changeover:
        typeof changeover === "number" && Number.isInteger(changeover) && changeover >= 0 ? String(changeover) : "",
      curfew: curfew === null ? "" : formatClock(curfew),
      pairs: pairs.join("\n"),
    },
  };
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * The saved day's ranked clashes on `day`, costliest first, as act names, and the acts its coverage marks as
 * having no usable signal; null when the answer has no ranked clash for that day.
 */
function savedRanking(report: unknown, acts: ReadonlyMap<string, string>, day: number): SavedRanking | null {
  const saved = asRecord(report);
  if (!saved) return null;
  const pairs = (Array.isArray(saved.clashes) ? (saved.clashes as unknown[]) : []).flatMap((item) => {
    const clash = asRecord(item);
    if (!clash || asMinutes(clash.day) !== day) return [];
    const a = acts.get(asText(asRecord(clash.a)?.act_id) ?? "");
    const b = acts.get(asText(asRecord(clash.b)?.act_id) ?? "");
    return a && b && a !== b ? [{ a, b }] : [];
  });
  if (pairs.length === 0) return null;
  const unscored = asRecord(saved.coverage)?.unscored;
  const noSignal = (Array.isArray(unscored) ? (unscored as unknown[]) : []).flatMap((item) => {
    const name = acts.get(asText(asRecord(item)?.act_id) ?? "");
    return name ? [name] : [];
  });
  return { pairs, noSignal };
}

/** The saved day's overlapping pairs with a usable signal for both acts, and the others; null when absent. */
function pairCountsOf(report: unknown): { scored: number; unscored: number } | null {
  const metrics = asRecord(asRecord(report)?.metrics);
  const scored = asCount(metrics?.scored_concurrent_pairs);
  const unscored = asCount(metrics?.unscored_concurrent_pairs);
  return scored === null || unscored === null ? null : { scored, unscored };
}

/**
 * The published day's pair counts, said once, and only when one reason accounts for the whole difference:
 * "79 pairs share time; the timetable page ranks the 68 where both acts have a usable Qloo signal." (The
 * build ranks a concurrent pair only when it is `known`, both acts scored; backend schedule/metrics.py
 * `measure`.) Null when the counts are missing or do not add up to the overlaps this page found, or when
 * `withoutSignal` (this page's overlaps with an act the day marks as having no usable signal) is given and
 * is not every pair the page leaves unranked, so a second reason would be needed.
 */
export function publishedPairsLine(shared: number, counts: PublishedInput["pairCounts"], withoutSignal?: number): string | null {
  if (!counts || counts.unscored === 0 || counts.scored + counts.unscored !== shared) return null;
  if (withoutSignal !== undefined && withoutSignal !== counts.unscored) return null;
  return `${shared} pairs share time; the timetable page ranks the ${counts.scored} where both acts have a usable Qloo signal.`;
}

/** True when every field holds exactly what "Check a published day" filled in. */
export function isPublishedInput(input: CheckInput, published: PublishedInput | null): boolean {
  return (
    published !== null &&
    input.grid === published.input.grid &&
    input.changeover === published.input.changeover &&
    input.curfew === published.input.curfew &&
    input.pairs === published.input.pairs
  );
}
