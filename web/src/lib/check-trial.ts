/**
 * "Find a change" for the browser-only grid check. Given one rule break (or one pair of sets that
 * share time) on the pasted grid, this searches single-set moves and then two-set swaps and keeps the
 * ones after which the targeted break is gone and the grid has no rule break it did not have before.
 * It runs entirely here: no index, no taste reading, no request, no storage, and no import beyond the
 * check module. The text goes in and plain objects come out, so it is unit tested.
 *
 * What is searched (the page says the same):
 * - One-set moves: each set of the break (or the breaking set), on a 5-minute grid within the day's
 *   span, on its own stage and on every other stage.
 * - Two-set swaps, only when fewer than five one-set changes exist: one set of the break takes the slot
 *   of another set (that set's stage and start), and the other set moves to a free place (a stage and a
 *   5-minute start where no other set is playing).
 * - Sets marked locked are never moved and never displaced.
 * - At most 20,000 candidates are tested; a candidate is one complete arrangement tested against the five
 *   rules. When the limit is hit the result says so.
 *
 * A candidate counts only when, after it, the targeted break is gone (or the pair shares no minute) and
 * every rule break on the grid was already there before, no larger than before. The five rules are the
 * ones in `check.ts`, with the visitor's changeover, curfew and pairs. The search tests candidates with
 * a fast incremental check; every change it shows is then re-tested with the full `findBreaks` and
 * `findShared`, so a displayed "adds no rule break" is the page's own rule check, not the shortcut.
 *
 * Ranking: fewest sets moved, then start-time minutes moved, then stage changes, then a fixed order.
 */

import {
  clockWindow,
  findBreaks,
  findShared,
  minutesLabel,
  type CheckReport,
  type CheckSet,
  type CheckSettings,
  type RuleBreak,
  type RuleId,
  type SharedPair,
} from "@/lib/check";

export const TRIAL_LIMITS = {
  /** Candidates tested per search, then the search stops and says so. */
  candidates: 20_000,
  /** Changes listed. */
  shown: 5,
  /** Start times are tried on this grid, in minutes. */
  grid: 5,
  /** Candidates tested between two yields when the search runs in chunks. */
  chunk: 1_500,
} as const;

export type TrialTarget =
  | { kind: "break"; rule: RuleId; rows: readonly number[] }
  | { kind: "shared"; rows: readonly [number, number] };

export type TrialMove = {
  row: number;
  act: string;
  stage: string;
  stageKey: string;
  fromStage: string;
  fromStart: number;
  fromEnd: number;
  start: number;
  end: number;
};

export type SharedTotals = { pairs: number; minutes: number };

export type TrialChange = {
  moves: TrialMove[];
  setsMoved: number;
  /** The sum of the sets' start-time shifts in minutes. */
  minutesMoved: number;
  stageChanges: number;
  /** One line per move: "{Act} → {Stage} {start}–{end}". */
  lines: string[];
  /** Shared minutes of the targeted pair before this change (pair targets only). */
  pairBefore: number | null;
  sharedBefore: SharedTotals;
  sharedAfter: SharedTotals;
};

export type TrialResult = {
  target: TrialTarget;
  /** Candidates tested. */
  tested: number;
  bound: number;
  /** True when the search stopped at the bound with moves left untried. */
  capped: boolean;
  /** True when every set of the target is locked, so nothing could be moved. */
  allLocked: boolean;
  /** Whether two-set swaps were searched (they are skipped when five one-set changes exist). */
  swapsSearched: boolean;
  /** Changes that passed, in total (the list shows the smallest). */
  found: number;
  changes: TrialChange[];
  summary: string;
};

export type TrialProgress = { tested: number; bound: number; phase: "one-set" | "two-set" };

export type TrialOptions = {
  /** Candidates to test at most. */
  bound?: number;
  /** The day's span in minutes, as the pasted grid has it. Defaults to this report's own first start and last end. */
  span?: readonly [number, number];
  /** Candidates between yields. */
  chunk?: number;
  /** Changes to list; five by default. */
  shown?: number;
};

/** The page's wording for the trial, in one place. */
export const TRIAL_COPY = {
  button: "Find a change",
  heading: "What this search found",
  scope:
    "How it searched: one-set moves first, then two-set swaps, on a 5-minute grid within the day’s span, at most 20,000 candidates. A change is listed only if it ends this break, adds no rule break and makes none of the existing ones larger, under your settings. Sets marked locked are not moved. It uses no taste reading, and nothing leaves this browser.",
  adds: "Adds no rule break.",
  tryIt: "Try it",
  back: "Back to the pasted grid",
} as const;

// ---------------------------------------------------------------------------------------------------
// Targets

/** The break as a target. */
export function targetOfBreak(item: RuleBreak): TrialTarget {
  return { kind: "break", rule: item.rule, rows: item.rows };
}

/** A pair of sets that share time as a target. */
export function targetOfPair(pair: SharedPair): TrialTarget {
  return { kind: "shared", rows: [pair.a.row, pair.b.row] };
}

/** A stable id for one target in one grid, for the page to say which row a result belongs to. */
export function targetId(target: TrialTarget): string {
  return target.kind === "break" ? `break-${target.rule}-${target.rows.join("-")}` : `shared-${target.rows.join("-")}`;
}

/** The first start and last end of the grid: "the day's span". */
export function daySpan(report: CheckReport): [number, number] {
  let first = Infinity;
  let last = -Infinity;
  for (const set of report.sets) {
    first = Math.min(first, set.start);
    last = Math.max(last, set.end);
  }
  return report.sets.length === 0 ? [0, 0] : [first, last];
}

// ---------------------------------------------------------------------------------------------------
// The incremental rule check used while searching

const RULE_BASE = 1_000_000;
const MAJOR = 1_000;

type Place = { index: number; stage: number; start: number };

type Candidate = {
  places: Place[];
  minutesMoved: number;
  stageChanges: number;
};

/** The rule-break identity: rule, then the sets by index. Rules 1, 2 and 5 are unordered pairs; rule 3 is (first, second). */
function pairKey(rule: 1 | 2 | 5, i: number, j: number): number {
  return rule * RULE_BASE + Math.min(i, j) * MAJOR + Math.max(i, j);
}

class Search {
  readonly n: number;
  readonly rows: number[];
  readonly act: Int32Array;
  readonly stage: Int32Array;
  readonly start: Int32Array;
  readonly dur: Int32Array;
  readonly locked: boolean[];
  readonly stageKeys: string[] = [];
  readonly stageNames: string[] = [];
  readonly originalStage: Int32Array;
  readonly originalStart: Int32Array;
  readonly changeover: number;
  readonly curfew: number | null;
  readonly partners: number[][];
  readonly base: Map<number, number>;
  readonly movable: number[];
  readonly targetRows: number[];
  readonly targetIndexes: number[];
  readonly targetKey: number | null;
  readonly spanStart: number;
  readonly spanEnd: number;

  constructor(
    readonly report: CheckReport,
    readonly target: TrialTarget,
    span: readonly [number, number],
  ) {
    const sets = report.sets;
    this.n = sets.length;
    this.rows = sets.map((set) => set.row);
    const rowIndex = new Map(this.rows.map((row, index) => [row, index]));
    const actIds = new Map<string, number>();
    const stageIds = new Map<string, number>();
    this.act = new Int32Array(this.n);
    this.stage = new Int32Array(this.n);
    this.start = new Int32Array(this.n);
    this.dur = new Int32Array(this.n);
    this.locked = sets.map((set) => set.locked);
    sets.forEach((set, index) => {
      if (!actIds.has(set.actKey)) actIds.set(set.actKey, actIds.size);
      if (!stageIds.has(set.stageKey)) {
        stageIds.set(set.stageKey, stageIds.size);
        this.stageKeys.push(set.stageKey);
        this.stageNames.push(set.stage);
      }
      this.act[index] = actIds.get(set.actKey) as number;
      this.stage[index] = stageIds.get(set.stageKey) as number;
      this.start[index] = set.start;
      this.dur[index] = set.end - set.start;
    });
    this.originalStage = Int32Array.from(this.stage);
    this.originalStart = Int32Array.from(this.start);
    this.changeover = report.settings.changeover;
    this.curfew = report.settings.curfew;
    this.partners = sets.map(() => []);
    for (const pair of report.settings.pairs) {
      const a = rowIndex.get(pair.a.row);
      const b = rowIndex.get(pair.b.row);
      if (a === undefined || b === undefined) continue;
      this.partners[a].push(b);
      this.partners[b].push(a);
    }
    this.spanStart = span[0];
    this.spanEnd = span[1];

    this.targetRows = [...target.rows];
    this.targetIndexes = this.targetRows.flatMap((row) => {
      const index = rowIndex.get(row);
      return index === undefined ? [] : [index];
    });
    this.movable = this.targetIndexes.filter((index) => !this.locked[index]);
    this.targetKey = this.keyOfTarget();
    this.base = this.fullBreaks();
  }

  private end(i: number): number {
    return this.start[i] + this.dur[i];
  }

  private overlapOf(i: number, j: number): number {
    return Math.min(this.end(i), this.end(j)) - Math.max(this.start[i], this.start[j]);
  }

  private keyOfTarget(): number | null {
    if (this.target.kind === "shared") return null;
    const [a, b] = this.targetIndexes;
    switch (this.target.rule) {
      case 1:
      case 2:
      case 5:
        return a === undefined || b === undefined ? null : pairKey(this.target.rule, a, b);
      case 3:
        return a === undefined || b === undefined ? null : 3 * RULE_BASE + a * MAJOR + b;
      case 4:
        return a === undefined ? null : 4 * RULE_BASE + a * MAJOR;
    }
  }

  private addPair(out: Map<number, number>, i: number, j: number): void {
    const shared = this.overlapOf(i, j);
    if (shared <= 0) return;
    if (this.act[i] === this.act[j] && this.stage[i] !== this.stage[j]) out.set(pairKey(1, i, j), shared);
    else if (this.stage[i] === this.stage[j]) out.set(pairKey(2, i, j), shared);
  }

  /** Rule 3 on one stage: neighbours by start time that are at least 0 and under the changeover apart. */
  private addChangeovers(out: Map<number, number>, stage: number): void {
    const members: number[] = [];
    for (let i = 0; i < this.n; i += 1) if (this.stage[i] === stage) members.push(i);
    members.sort((x, y) => this.start[x] - this.start[y] || this.end(x) - this.end(y) || x - y);
    for (let k = 0; k + 1 < members.length; k += 1) {
      const gap = this.start[members[k + 1]] - this.end(members[k]);
      if (gap >= 0 && gap < this.changeover) {
        out.set(3 * RULE_BASE + members[k] * MAJOR + members[k + 1], this.changeover - gap);
      }
    }
  }

  private addCurfew(out: Map<number, number>, i: number): void {
    if (this.curfew !== null && this.end(i) > this.curfew) out.set(4 * RULE_BASE + i * MAJOR, this.end(i) - this.curfew);
  }

  private addKeptApart(out: Map<number, number>, i: number): void {
    for (const p of this.partners[i]) {
      const shared = this.overlapOf(i, p);
      if (shared > 0) out.set(pairKey(5, i, p), shared);
    }
  }

  /** Every break on the grid as it stands, as identity to size (shared minutes, shortfall or minutes late). */
  private fullBreaks(): Map<number, number> {
    const out = new Map<number, number>();
    for (let i = 0; i < this.n; i += 1) {
      for (let j = i + 1; j < this.n; j += 1) this.addPair(out, i, j);
      this.addCurfew(out, i);
      this.addKeptApart(out, i);
    }
    for (let s = 0; s < this.stageKeys.length; s += 1) this.addChangeovers(out, s);
    return out;
  }

  /**
   * Tests the places together, then puts everything back. `gone` is whether the targeted break (or the
   * pair's shared time) is gone; `clean` is whether every break the places could touch was already on
   * the grid and is no larger now. Only breaks that involve a moved set, or a neighbour on a stage the
   * moves leave or enter, can differ from the grid as pasted, so only those are recomputed.
   */
  private test(places: readonly Place[]): { gone: boolean; clean: boolean } {
    const saved = places.map((p) => [this.stage[p.index], this.start[p.index]] as const);
    const stages = new Set<number>();
    for (const [stage] of saved) stages.add(stage);
    for (const p of places) {
      stages.add(p.stage);
      this.stage[p.index] = p.stage;
      this.start[p.index] = p.start;
    }
    const out = new Map<number, number>();
    for (const { index: m } of places) {
      for (let j = 0; j < this.n; j += 1) if (j !== m) this.addPair(out, m, j);
      this.addCurfew(out, m);
      this.addKeptApart(out, m);
    }
    for (const stage of stages) this.addChangeovers(out, stage);

    let clean = true;
    for (const [key, size] of out) {
      const before = this.base.get(key);
      if (before === undefined || size > before) {
        clean = false;
        break;
      }
    }
    let gone: boolean;
    if (this.target.kind === "shared") {
      const [a, b] = this.targetIndexes;
      gone = a !== undefined && b !== undefined && this.overlapOf(a, b) <= 0;
    } else {
      gone = this.targetKey !== null && !out.has(this.targetKey);
    }
    places.forEach((p, k) => {
      this.stage[p.index] = saved[k][0];
      this.start[p.index] = saved[k][1];
    });
    return { gone, clean };
  }

  /** Start times on the 5-minute grid inside the day's span for a set of this length. */
  private starts(duration: number): { from: number; to: number } {
    const step = TRIAL_LIMITS.grid;
    return { from: Math.ceil(this.spanStart / step) * step, to: this.spanEnd - duration };
  }

  private candidateOf(places: Place[]): Candidate {
    let minutesMoved = 0;
    let stageChanges = 0;
    for (const p of places) {
      minutesMoved += Math.abs(p.start - this.originalStart[p.index]);
      if (p.stage !== this.originalStage[p.index]) stageChanges += 1;
    }
    return { places, minutesMoved, stageChanges };
  }

  /** Free places for set `y` (no other set playing there), nearest to where it plays now first. */
  private freePlaces(y: number): Place[] {
    const { from, to } = this.starts(this.dur[y]);
    const step = TRIAL_LIMITS.grid;
    const out: Place[] = [];
    for (let s = 0; s < this.stageKeys.length; s += 1) {
      const taken: [number, number][] = [];
      for (let k = 0; k < this.n; k += 1) if (k !== y && this.stage[k] === s) taken.push([this.start[k], this.end(k)]);
      taken.sort((a, b) => a[0] - b[0]);
      let cursor = -Infinity;
      const gaps: [number, number][] = [];
      for (const [a, b] of taken) {
        if (a > cursor) gaps.push([cursor, a]);
        cursor = Math.max(cursor, b);
      }
      gaps.push([cursor, Infinity]);
      for (const [gapStart, gapEnd] of gaps) {
        const lowest = Math.max(from, Number.isFinite(gapStart) ? Math.ceil(gapStart / step) * step : from);
        const highest = Math.min(to, gapEnd - this.dur[y]);
        for (let t = lowest; t <= highest; t += step) {
          if (s === this.originalStage[y] && t === this.originalStart[y]) continue;
          out.push({ index: y, stage: s, start: t });
        }
      }
    }
    const here = this.originalStart[y];
    return out.sort(
      (p, q) => Math.abs(p.start - here) - Math.abs(q.start - here) || p.stage - q.stage || p.start - q.start,
    );
  }

  /** The search itself, yielding progress every `chunk` candidates. */
  *run(bound: number, chunk: number): Generator<TrialProgress, SearchOutcome, void> {
    const found: Candidate[] = [];
    let tested = 0;
    let capped = false;
    let singles = 0;
    let swaps = 0;
    let swapsSearched = false;
    let phase: TrialProgress["phase"] = "one-set";
    const marker = (): TrialProgress => ({ tested, bound, phase });
    const singleKeys = new Set<string>();

    // One-set moves.
    for (const index of this.movable) {
      const { from, to } = this.starts(this.dur[index]);
      const order = [this.originalStage[index], ...this.stageKeys.map((_, s) => s).filter((s) => s !== this.originalStage[index])];
      for (const stage of order) {
        for (let t = from; t <= to; t += TRIAL_LIMITS.grid) {
          if (stage === this.originalStage[index] && t === this.originalStart[index]) continue;
          if (tested >= bound) {
            capped = true;
            break;
          }
          tested += 1;
          if (tested % chunk === 0) yield marker();
          const place: Place = { index, stage, start: t };
          const { gone, clean } = this.test([place]);
          if (gone && clean) {
            singles += 1;
            singleKeys.add(`${index}:${stage}:${t}`);
            found.push(this.candidateOf([place]));
          }
        }
        if (capped) break;
      }
      if (capped) break;
    }

    // Two-set swaps, only when five one-set changes are not already there to show.
    if (!capped && singles < TRIAL_LIMITS.shown) {
      swapsSearched = true;
      phase = "two-set";
      yield marker();
      swapLoop: for (const x of this.movable) {
        const others = [...Array(this.n).keys()]
          .filter((y) => y !== x && !this.locked[y])
          .sort((p, q) => Math.abs(this.originalStart[p] - this.originalStart[x]) - Math.abs(this.originalStart[q] - this.originalStart[x]) || p - q);
        for (const y of others) {
          if (tested >= bound) {
            capped = true;
            break swapLoop;
          }
          const takes: Place = { index: x, stage: this.originalStage[y], start: this.originalStart[y] };
          if (takes.stage === this.originalStage[x] && takes.start === this.originalStart[x]) continue;
          // The set keeps its own length, so taking a shorter slot can run past the day's span.
          if (takes.start + this.dur[x] > this.spanEnd) continue;
          tested += 1;
          if (tested % chunk === 0) yield marker();
          const alone = this.test([takes]);
          // The one set's move on its own is enough: a second move would only be noise.
          if (alone.gone && alone.clean) continue;
          // Nothing the other set does can end a break the first set's move did not end, unless it is the
          // other set of the break.
          if (!alone.gone && !this.targetIndexes.includes(y)) continue;

          const saved = [this.stage[x], this.start[x]] as const;
          this.stage[x] = takes.stage;
          this.start[x] = takes.start;
          const places = this.freePlaces(y);
          this.stage[x] = saved[0];
          this.start[x] = saved[1];

          for (const place of places) {
            if (singleKeys.has(`${y}:${place.stage}:${place.start}`)) continue;
            if (tested >= bound) {
              capped = true;
              break swapLoop;
            }
            tested += 1;
            if (tested % chunk === 0) yield marker();
            const { gone, clean } = this.test([takes, place]);
            if (gone && clean) {
              swaps += 1;
              found.push(this.candidateOf([takes, place]));
            }
          }
        }
      }
    }

    found.sort(compareCandidates);
    return { found, tested, capped, singles, swaps, swapsSearched };
  }
}

type SearchOutcome = {
  found: Candidate[];
  tested: number;
  capped: boolean;
  singles: number;
  swaps: number;
  swapsSearched: boolean;
};

function compareCandidates(a: Candidate, b: Candidate): number {
  const byCount = a.places.length - b.places.length;
  if (byCount !== 0) return byCount;
  const byMinutes = a.minutesMoved - b.minutesMoved;
  if (byMinutes !== 0) return byMinutes;
  const byStages = a.stageChanges - b.stageChanges;
  if (byStages !== 0) return byStages;
  for (let k = 0; k < a.places.length; k += 1) {
    const diff =
      a.places[k].index - b.places[k].index || a.places[k].stage - b.places[k].stage || a.places[k].start - b.places[k].start;
    if (diff !== 0) return diff;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------
// Applying a change to a working copy, and re-testing it with the page's own rules

/** The identity of a break from `findBreaks`: rules 1, 2 and 5 are unordered pairs, rule 3 keeps its order. */
function breakId(item: { rule: RuleId; rows: readonly number[] }): string {
  const rows = item.rule === 3 ? item.rows : [...item.rows].sort((x, y) => x - y);
  return `${item.rule}:${rows.join("-")}`;
}

function overlapBetween(a: CheckSet, b: CheckSet): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** The size of a break on this grid: shared minutes, the shortfall under the changeover, or minutes past the curfew. */
function breakSize(item: RuleBreak, sets: readonly CheckSet[], settings: CheckSettings): number {
  const byRow = new Map(sets.map((set) => [set.row, set]));
  const [a, b] = item.rows.map((row) => byRow.get(row) as CheckSet);
  if (item.rule === 3) return settings.changeover - (b.start - a.end);
  if (item.rule === 4) return a.end - (settings.curfew ?? a.end);
  return overlapBetween(a, b);
}

function stageNameOf(report: CheckReport, stageKey: string): string {
  return report.sets.find((set) => set.stageKey === stageKey)?.stage ?? stageKey;
}

/**
 * The report with the change applied: the same sets and settings, with the moved sets in their new
 * places, and the rules and the sets that share time run again. Pure.
 */
export function applyChange(report: CheckReport, change: Pick<TrialChange, "moves">): CheckReport {
  const moved = new Map(change.moves.map((move) => [move.row, move]));
  const sets = report.sets.map((set) => {
    const move = moved.get(set.row);
    return move ? { ...set, stage: move.stage, stageKey: move.stageKey, start: move.start, end: move.end } : set;
  });
  const byRow = new Map(sets.map((set) => [set.row, set]));
  const settings: CheckSettings = {
    ...report.settings,
    pairs: report.settings.pairs.map((pair) => ({
      ...pair,
      a: byRow.get(pair.a.row) as CheckSet,
      b: byRow.get(pair.b.row) as CheckSet,
    })),
  };
  return {
    ...report,
    sets,
    stages: [...new Map(sets.map((set) => [set.stageKey, set.stage])).values()],
    settings,
    breaks: findBreaks(sets, settings),
    shared: findShared(sets),
  };
}

function totals(report: CheckReport): SharedTotals {
  return { pairs: report.shared.length, minutes: report.shared.reduce((sum, pair) => sum + pair.minutes, 0) };
}

/**
 * Re-tests a found change with the full rules. True when the targeted break is gone (or the pair
 * shares nothing) and no break exists that was not there, or that is larger than before.
 */
export function confirmChange(report: CheckReport, target: TrialTarget, change: Pick<TrialChange, "moves">): boolean {
  const after = applyChange(report, change);
  const before = new Map(report.breaks.map((item) => [breakId(item), breakSize(item, report.sets, report.settings)]));
  if (target.kind === "shared") {
    const [a, b] = target.rows.map((row) => after.sets.find((set) => set.row === row) as CheckSet);
    if (overlapBetween(a, b) > 0) return false;
  } else {
    const id = breakId({ rule: target.rule, rows: target.rows });
    if (after.breaks.some((item) => breakId(item) === id)) return false;
  }
  return after.breaks.every((item) => {
    const was = before.get(breakId(item));
    return was !== undefined && breakSize(item, after.sets, after.settings) <= was;
  });
}

function buildChange(report: CheckReport, target: TrialTarget, search: Search, candidate: Candidate): TrialChange {
  const moves: TrialMove[] = candidate.places
    .map((place) => {
      const set = report.sets[place.index];
      const stageKey = search.stageKeys[place.stage];
      return {
        row: set.row,
        act: set.act,
        stage: stageNameOf(report, stageKey),
        stageKey,
        fromStage: set.stage,
        fromStart: set.start,
        fromEnd: set.end,
        start: place.start,
        end: place.start + search.dur[place.index],
      };
    })
    .sort((p, q) => p.row - q.row);
  const after = applyChange(report, { moves });
  let pairBefore: number | null = null;
  if (target.kind === "shared" || (target.kind === "break" && target.rule !== 3 && target.rule !== 4)) {
    const [a, b] = target.rows.map((row) => report.sets.find((set) => set.row === row) as CheckSet);
    pairBefore = overlapBetween(a, b);
  }
  return {
    moves,
    setsMoved: moves.length,
    minutesMoved: candidate.minutesMoved,
    stageChanges: candidate.stageChanges,
    lines: moves.map((move) => `${move.act} → ${move.stage} ${clockWindow(move.start, move.end)}`),
    pairBefore,
    sharedBefore: totals(report),
    sharedAfter: totals(after),
  };
}

// ---------------------------------------------------------------------------------------------------
// The search, its words, and the wrappers

function count(value: number, one: string, many: string = `${one}s`): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? one : many}`;
}

/** One sentence on what the search did, for the result and the polite live region. */
export function trialSummary(result: Omit<TrialResult, "summary">): string {
  if (result.allLocked) {
    return "Every set in this break is marked locked, and this search does not move locked sets.";
  }
  if (result.found === 0) {
    const within = result.capped ? `${result.bound.toLocaleString("en-US")} candidates (the limit)` : count(result.tested, "candidate");
    return `This search found no change that ends it within ${within}; it did not look for longer chains.`;
  }
  const parts = [
    `This search found ${count(result.found, "change")} that end${result.found === 1 ? "s" : ""} it and add${result.found === 1 ? "s" : ""} no rule break, within ${count(result.tested, "candidate")} tested.`,
  ];
  if (result.found > result.changes.length) parts.push(`The ${result.changes.length} smallest are listed.`);
  if (!result.swapsSearched && !result.capped) {
    parts.push(`It did not try two-set swaps because ${TRIAL_LIMITS.shown} one-set changes were found.`);
  }
  if (result.capped) parts.push(`It stopped at the limit of ${result.bound.toLocaleString("en-US")} candidates, so there may be more.`);
  return parts.join(" ");
}

/** The shared-time line of a change: the pair's minutes (pair targets) and the grid as a whole. */
export function sharedEffect(change: TrialChange): string {
  const pair = change.pairBefore === null ? "" : `${minutesLabel(change.pairBefore)} shared by the pair → 0. `;
  const { sharedBefore: before, sharedAfter: after } = change;
  return `${pair}Across the grid: ${count(before.pairs, "pair")} sharing ${minutesLabel(before.minutes)} → ${count(after.pairs, "pair")} sharing ${minutesLabel(after.minutes)}.`;
}

/** The size line of a change. */
export function sizeLine(change: TrialChange): string {
  const sets = change.setsMoved === 1 ? "One set moved" : "Two sets moved";
  return `${sets}; ${minutesLabel(change.minutesMoved)} of start time; ${count(change.stageChanges, "stage change")}.`;
}

/**
 * The search as a generator: `next()` tests up to a chunk of candidates and yields progress, then
 * returns the result. Draining it gives `findChange`; the page steps it from a timer so it stays responsive.
 */
export function* trialSteps(
  report: CheckReport,
  target: TrialTarget,
  options: TrialOptions = {},
): Generator<TrialProgress, TrialResult, void> {
  const bound = options.bound ?? TRIAL_LIMITS.candidates;
  const chunk = options.chunk ?? TRIAL_LIMITS.chunk;
  const search = new Search(report, target, options.span ?? daySpan(report));
  const allLocked = search.movable.length === 0;
  const outcome: SearchOutcome = allLocked
    ? { found: [], tested: 0, capped: false, singles: 0, swaps: 0, swapsSearched: false }
    : yield* search.run(bound, chunk);

  const shown = options.shown ?? TRIAL_LIMITS.shown;
  const changes: TrialChange[] = [];
  let confirmed = 0;
  for (const candidate of outcome.found) {
    // The list is the smallest few; the rest are only counted, from the search's own tally.
    if (changes.length >= shown) break;
    const change = buildChange(report, target, search, candidate);
    if (!confirmChange(report, target, change)) continue;
    confirmed += 1;
    changes.push(change);
  }
  const base = {
    target,
    tested: outcome.tested,
    bound,
    capped: outcome.capped,
    allLocked,
    swapsSearched: outcome.swapsSearched,
    found: changes.length === 0 ? 0 : Math.max(outcome.singles + outcome.swaps, confirmed),
    changes,
  };
  return { ...base, summary: trialSummary(base) };
}

/** The whole search at once. */
export function findChange(report: CheckReport, target: TrialTarget, options: TrialOptions = {}): TrialResult {
  const steps = trialSteps(report, target, options);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

// ---------------------------------------------------------------------------------------------------
// The working grid as text

function csvField(value: string): string {
  return /[",\t\n\r]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** H:MM from minutes without wrapping, so 24:30 stays 24:30 and the grid reads back in the same order. */
function clockText(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The sets as the text the check reads: a header and one line per set, after-midnight times as 24:30 or later. */
export function gridText(sets: readonly CheckSet[]): string {
  const lines = sets.map((set) =>
    [csvField(set.act), csvField(set.stage), clockText(set.start), clockText(set.end), set.locked ? "yes" : ""].join(","),
  );
  return ["act,stage,start,end,locked", ...lines, ""].join("\n");
}

/** Where a moved set played before the change: "Night Tent 16:15–17:00". */
export function wasPlace(move: TrialMove): string {
  return `${move.fromStage} ${clockWindow(move.fromStart, move.fromEnd)}`;
}

/** What the page says over a working copy that has these changes applied. */
export function workingLabel(changes: number): string {
  return `Working copy: ${changes === 1 ? "1 change" : `${changes} changes`} applied to the pasted grid. Nothing you pasted has been altered.`;
}
