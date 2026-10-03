/**
 * The browser-only grid check (DECISION 3.6). It reads one pasted day of a draft timetable and the
 * settings next to it, and reports five rule breaks and the sets that share time. Nothing here
 * touches the network, storage or any other module: the text goes in, a plain object comes out.
 *
 * Guards that keep the page honest about what it read:
 * - one day, 60 sets, 10 stages and 8 KB; anything else is refused with a plain message;
 * - quoted fields with commas are read as one field; comma or tab, decided by the first line;
 * - duplicate rows, ambiguous after-midnight times and pair rules naming no set or several are
 *   rejected visibly, never guessed;
 * - names longer than 80 characters are refused and never echoed; anything echoed is clipped.
 *
 * Times are minutes from 00:00 of the day. Hours of 24 or more are after midnight. One day boundary
 * serves sets and curfew: an end before its start that is before 06:00 is the next day, but only for a
 * set that starts at 06:00 or later; a curfew before 06:00 is the next day too, unless every set starts
 * before 06:00 (a grid written after midnight), where it is read on the same clock and refused when it
 * falls at or before the first start. The engine's rule
 * semantics are mirrored on purpose (`backend/tests/test_check_parity.py` pins the counts): a changeover
 * break is a gap between neighbours on one stage (by start time) that is at least 0 and under the
 * setting; a curfew break is an end strictly after the curfew; a pair break is any shared minute.
 */

export const CHECK_LIMITS = {
  /** Bytes of the grid text (UTF-8). */
  bytes: 8192,
  sets: 60,
  stages: 10,
  /** Characters of an act or stage name. Longer names are refused, not shortened. */
  nameChars: 80,
  /** Bytes of the pair-rule text. */
  pairBytes: 2048,
  pairLines: 30,
  maxChangeover: 240,
  /** Hours as the engine reads them: 00:00 to 47:59. */
  maxMinutes: 2879,
  defaultChangeover: 15,
  /** Times before this are read as after midnight where the reading is not ambiguous. */
  dayStartsAt: 360,
  /** Errors listed before "and n more". */
  errorsShown: 5,
} as const;

/** The characters echoed at most from any pasted name. */
const ECHO_CHARS = 80;
const MINUTES_PER_DAY = 1440;
/** H:MM or HH:MM, with optional seconds that are dropped (spreadsheets often copy 18:00:00). */
const CLOCK = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/;
/**
 * Control characters (tab, carriage return and line feed are handled before this runs) and invisible
 * format characters, except the joiners real names use (U+200C, U+200D). Soft hyphens (U+00AD) are
 * stripped before this runs.
 */
const UNREADABLE = /[\p{Cc}\p{Cf}]/u;
const JOINERS = /[‌‍]/g;
const SOFT_HYPHEN = /­/g;

/** Fields joined as "3:abc4:wxyz": each is length-prefixed, so a name holding "@" or "|" cannot run into its neighbour. */
function lengthPrefixed(...fields: string[]): string {
  return fields.map((field) => `${field.length}:${field}`).join("");
}

export type CheckSet = {
  /** Line number in the paste, counting from 1. */
  row: number;
  act: string;
  stage: string;
  actKey: string;
  stageKey: string;
  start: number;
  end: number;
  locked: boolean;
};

export type CheckInput = {
  grid: string;
  changeover: string;
  curfew: string;
  pairs: string;
};

export type RuleId = 1 | 2 | 3 | 4 | 5;

export type RuleBreak = {
  rule: RuleId;
  /** The sentence for this rule, with the sets and times filled in. */
  text: string;
  /** The same break with times, for the second line of the row. */
  detail: string;
  /** The grid rows involved. */
  rows: number[];
};

export type SharedPair = {
  /** Stable for one pair of sets in one grid; keeps a "kept on purpose" mark across re-checks. */
  id: string;
  a: CheckSet;
  b: CheckSet;
  minutes: number;
  windowStart: number;
  windowEnd: number;
};

export type CheckSettings = {
  changeover: number;
  /** Latest end, in minutes from the start of the day; null for none. */
  curfew: number | null;
  /** Pairs of grid rows (by index into `sets`) that must never overlap, in the order written. */
  pairs: { a: CheckSet; b: CheckSet; line: number }[];
};

export type CheckReport = {
  sets: CheckSet[];
  stages: string[];
  lockedCount: number;
  settings: CheckSettings;
  breaks: RuleBreak[];
  shared: SharedPair[];
};

export type CheckOutcome = { ok: true; report: CheckReport } | { ok: false; errors: string[] };

/** The page's set wording. */
export const CHECK_COPY = {
  kicker: "Check a draft grid",
  title: "Check a draft grid against your rules",
  lede: "Paste one day of a draft timetable. This page lists the rule breaks and the sets that share time. It runs in your browser: nothing you paste is sent anywhere, including to Qloo.",
  printTitle: "Draft check, not a verdict",
  noBreaks: "No rule breaks found against the settings above.",
  notComputed:
    "Not computed: taste overlap. It needs a Qloo reading per act, and this page makes no request to Qloo or to anything else. The two published days on the home page show what it adds.",
  elsewhere:
    "Rule checks like these also exist in scheduling software. What this app adds is the audience reading on the published days; this page does not have it.",
} as const;

/** The file "Download a template" gives: a header and two invented rows. */
export const TEMPLATE_CSV = [
  "act,stage,start,end,locked",
  "Example act one,Main stage,18:00,19:00,",
  "Example act two,Side stage,18:30,19:30,",
  "",
].join("\n");

/** Rule kickers, in rule order. */
export const RULE_LABELS: Record<RuleId, string> = {
  1: "Act on two stages at once",
  2: "Same-stage overlap",
  3: "Changeover",
  4: "Curfew",
  5: "Pair kept apart",
};

/** Names and stages compare after trimming, collapsing spaces and lower-casing. */
export function normalizeName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function tidy(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** At most 80 characters of anything pasted, with an ellipsis when cut. */
export function clip(value: string, max: number = ECHO_CHARS): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max).join("")}…`;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** `HH:MM` on the clock; 24:30 shows as 00:30. */
export function formatClock(minutes: number): string {
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function span(start: number, end: number): string {
  return `${formatClock(start)}–${formatClock(end)}`;
}

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Minutes for `H:MM` or `HH:MM` (hours up to 47), or null when it is not one. */
function parseClock(value: string): number | null {
  const match = CLOCK.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes <= CHECK_LIMITS.maxMinutes ? minutes : null;
}

/** The delimiter of the paste: a tab on the first non-blank line means tab, otherwise comma. */
function delimiterOf(lines: readonly string[]): string {
  const first = lines.find((line) => line.trim() !== "") ?? "";
  return first.includes("\t") ? "\t" : ",";
}

type SplitResult = { ok: true; fields: string[] } | { ok: false };

/** One line into fields. A field that starts with a quote runs to the closing quote ("" is a quote). */
function splitLine(line: string, delimiter: string): SplitResult {
  const fields: string[] = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    let field = "";
    let j = i;
    while (j < n && line[j] === " ") j += 1;
    if (j < n && line[j] === '"') {
      j += 1;
      let closed = false;
      while (j < n) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') {
            field += '"';
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        field += line[j];
        j += 1;
      }
      if (!closed) return { ok: false };
      while (j < n && line[j] === " ") j += 1;
      if (j < n && line[j] !== delimiter) return { ok: false };
    } else {
      j = i;
      while (j < n && line[j] !== delimiter) j += 1;
      field = line.slice(i, j);
    }
    fields.push(field);
    if (j >= n) break;
    i = j + 1;
    if (i === n) {
      fields.push("");
      break;
    }
  }
  return { ok: true, fields };
}

/** What a header cell may be called, by column; spreadsheets say "Start time" and capitalise freely. */
const HEADER_NAMES: readonly ReadonlySet<string>[] = [
  new Set(["act", "act name", "artist"]),
  new Set(["stage", "stage name"]),
  new Set(["start", "start time"]),
  new Set(["end", "end time"]),
  new Set(["locked"]),
];

function headerName(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, " ");
}

const LOCKED_YES = new Set(["locked", "yes", "y", "true", "1", "x"]);
const LOCKED_NO = new Set(["", "no", "n", "false", "0"]);

type Draft = { row: number; act: string; stage: string; start: number; end: number; locked: boolean };

/** Errors are collected, not thrown, so the page can list several at once. */
class Problems {
  readonly list: string[] = [];
  add(message: string): void {
    this.list.push(message);
  }
  get any(): boolean {
    return this.list.length > 0;
  }
  shown(): string[] {
    const { errorsShown } = CHECK_LIMITS;
    if (this.list.length <= errorsShown) return [...this.list];
    const rest = this.list.length - errorsShown;
    return [...this.list.slice(0, errorsShown), `And ${plural(rest, "more problem")}.`];
  }
}

/** Soft hyphens carry no meaning in a name; they come with text copied from PDFs and Word. */
function stripSoftHyphens(text: string): string {
  return text.replace(SOFT_HYPHEN, "");
}

/** The first line with a character this page will not read, named by its line number. */
function textProblem(text: string, linePrefix: string): string | null {
  const lines = text.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const probe = lines[index].replace(/\t/g, "").replace(JOINERS, "");
    if (probe.includes("\u0000")) {
      return `${linePrefix} ${index + 1} contains a character this page cannot read (a NUL, as in a UTF-16 file). Paste plain text.`;
    }
    if (UNREADABLE.test(probe)) {
      return `${linePrefix} ${index + 1} contains a control or invisible character (such as a zero-width space or a text-direction mark). Remove it or retype the name.`;
    }
  }
  return null;
}

/** The grid text into rows, or the problems that stop it. Header row optional. */
export function parseGrid(raw: string): { ok: true; sets: CheckSet[] } | { ok: false; errors: string[] } {
  const problems = new Problems();
  const text = stripSoftHyphens(raw.startsWith("﻿") ? raw.slice(1) : raw);
  if (text.trim() === "") return { ok: false, errors: ["Paste a grid first: one set per line."] };
  const size = utf8Length(text);
  if (size > CHECK_LIMITS.bytes) {
    return {
      ok: false,
      errors: [
        `That paste is ${size.toLocaleString("en-US")} bytes. This page reads up to 8 KB (about 60 sets), one day at a time.`,
      ],
    };
  }
  const unreadable = textProblem(text, "Line");
  if (unreadable) return { ok: false, errors: [unreadable] };

  const lines = text.split(/\r\n|\r|\n/);
  const delimiter = delimiterOf(lines);
  const drafts: Draft[] = [];
  let headerChecked = false;

  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    const row = index + 1;
    const split = splitLine(line, delimiter);
    if (!split.ok) {
      problems.add(`Line ${row}: a quote is not closed or has text after it.`);
      return;
    }
    const fields = split.fields;
    if (!headerChecked) {
      headerChecked = true;
      const names = fields.map(headerName);
      const looksLikeHeader =
        (names[2] !== undefined && HEADER_NAMES[2].has(names[2])) ||
        (HEADER_NAMES[0].has(names[0]) && fields[2] !== undefined && parseClock(fields[2]) === null);
      if (looksLikeHeader) {
        const matches =
          names.length >= 4 && names.length <= 5 && names.every((n, k) => HEADER_NAMES[k].has(n));
        if (!matches) problems.add(`Line ${row}: the header should read act, stage, start, end (and locked).`);
        return;
      }
    }
    while (fields.length > 5 && fields[fields.length - 1].trim() === "") fields.pop();
    if (fields.length < 4 || fields.length > 5) {
      problems.add(`Line ${row}: expected act, stage, start, end (and locked), but found ${plural(fields.length, "field")}.`);
      return;
    }
    const act = tidy(fields[0]);
    const stage = tidy(fields[1]);
    if (act === "" || stage === "") {
      problems.add(`Line ${row}: the act and the stage cannot be blank.`);
      return;
    }
    if (Array.from(act).length > CHECK_LIMITS.nameChars || Array.from(stage).length > CHECK_LIMITS.nameChars) {
      problems.add(`Line ${row}: a name is longer than ${CHECK_LIMITS.nameChars} characters.`);
      return;
    }
    const start = parseClock(fields[2]);
    let end = parseClock(fields[3]);
    if (start === null) {
      problems.add(`Line ${row}: the start time is not H:MM or HH:MM (hours up to 47).`);
      return;
    }
    if (end === null) {
      problems.add(`Line ${row}: the end time is not H:MM or HH:MM (hours up to 47).`);
      return;
    }
    if (end < start) {
      // Only a set that starts in the day proper can run past midnight by writing a small end; a set
      // that starts after midnight and ends earlier could mean anything.
      if (end < CHECK_LIMITS.dayStartsAt && start >= CHECK_LIMITS.dayStartsAt) end += MINUTES_PER_DAY;
      else {
        problems.add(
          `Line ${row}: the set ends before it starts. For after midnight, write the end as 24:30 or later.`,
        );
        return;
      }
    }
    if (end <= start) {
      problems.add(`Line ${row}: the set must end after it starts.`);
      return;
    }
    const flag = (fields[4] ?? "").trim().toLowerCase();
    if (!LOCKED_YES.has(flag) && !LOCKED_NO.has(flag)) {
      problems.add(`Line ${row}: the locked column should be yes, no or blank.`);
      return;
    }
    drafts.push({ row, act, stage, start, end, locked: LOCKED_YES.has(flag) });
  });

  if (drafts.length === 0 && !problems.any) {
    problems.add("No sets found. Put one set on each line: act, stage, start, end.");
  }
  if (drafts.length > CHECK_LIMITS.sets) {
    problems.add(`That is ${drafts.length} sets. This page reads up to ${CHECK_LIMITS.sets} sets, one day at a time.`);
  }

  const stageKeys = new Set(drafts.map((d) => normalizeName(d.stage)));
  if (stageKeys.size > CHECK_LIMITS.stages) {
    problems.add(`That is ${stageKeys.size} stages. This page reads up to ${CHECK_LIMITS.stages}.`);
  }

  const lateStart = drafts.some((d) => d.start >= 720);
  const seen = new Map<string, number>();
  for (const d of drafts) {
    if (lateStart && d.start < CHECK_LIMITS.dayStartsAt) {
      problems.add(
        `Line ${d.row}: starts before 06:00 while other sets start in the afternoon or evening. Write after-midnight times as 24:30 or later so the day reads in order.`,
      );
    }
    const key = lengthPrefixed(normalizeName(d.act), normalizeName(d.stage), String(d.start), String(d.end));
    const first = seen.get(key);
    if (first === undefined) seen.set(key, d.row);
    else problems.add(`Line ${d.row}: the same set as line ${first} (same act, stage and times).`);
  }

  if (problems.any) return { ok: false, errors: problems.shown() };
  return {
    ok: true,
    sets: drafts.map((d) => ({
      ...d,
      actKey: normalizeName(d.act),
      stageKey: normalizeName(d.stage),
    })),
  };
}

type SettingsResult = { ok: true; settings: CheckSettings } | { ok: false; errors: string[] };

/** Changeover, curfew and pair rules, checked against the sets they name. */
export function parseSettings(input: Omit<CheckInput, "grid">, sets: readonly CheckSet[]): SettingsResult {
  const problems = new Problems();

  let changeover: number = CHECK_LIMITS.defaultChangeover;
  const rawChange = input.changeover.trim();
  if (rawChange !== "") {
    if (/^\d{1,3}$/.test(rawChange) && Number(rawChange) <= CHECK_LIMITS.maxChangeover) {
      changeover = Number(rawChange);
    } else {
      problems.add(`Changeover should be a whole number of minutes from 0 to ${CHECK_LIMITS.maxChangeover}.`);
    }
  }

  let curfew: number | null = null;
  const rawCurfew = input.curfew.trim();
  if (rawCurfew !== "") {
    const parsed = parseClock(rawCurfew);
    if (parsed === null) problems.add("Curfew should be a time as H:MM or HH:MM, or blank for none.");
    else if (parsed >= CHECK_LIMITS.dayStartsAt) curfew = parsed;
    else if (sets.length > 0 && sets.every((set) => set.start < CHECK_LIMITS.dayStartsAt)) {
      // The whole grid is written after midnight, so a curfew before 06:00 is on the same clock as the
      // sets. One that falls at or before the first start cannot be told apart from the night before.
      const first = Math.min(...sets.map((set) => set.start));
      if (parsed > first) curfew = parsed;
      else {
        problems.add(
          `The curfew is at or before the first set starts, so this page cannot tell which day it means. Write the grid’s times as 24:30 or later (and the curfew the same way) to keep the day in order.`,
        );
      }
    } else if (sets.some((set) => set.start < CHECK_LIMITS.dayStartsAt)) {
      // Sets before 06:00 beside morning sets and none in the afternoon: the night and the morning could be
      // either side of the curfew, so the page refuses rather than guess.
      problems.add(
        `The grid has sets before 06:00 and sets in the morning, so this page cannot tell which side of the curfew they fall. Write after-midnight times as 24:30 or later (and the curfew the same way) to keep the day in order.`,
      );
    } else curfew = parsed + MINUTES_PER_DAY;
  }

  const pairs: CheckSettings["pairs"] = [];
  const pairText = stripSoftHyphens(input.pairs.replace(/^﻿/, ""));
  const sizeProblem =
    utf8Length(pairText) > CHECK_LIMITS.pairBytes
      ? "The pair rules are longer than 2 KB. This page reads up to 30 lines."
      : textProblem(pairText, "Pair line");
  if (sizeProblem) {
    problems.add(sizeProblem);
  } else if (pairText.trim() !== "") {
    const byKey = new Map<string, CheckSet[]>();
    for (const set of sets) byKey.set(set.actKey, [...(byKey.get(set.actKey) ?? []), set]);
    const written = new Set<string>();
    const lines = pairText.split(/\r\n|\r|\n/);
    if (lines.filter((line) => line.trim() !== "").length > CHECK_LIMITS.pairLines) {
      problems.add(`More than ${CHECK_LIMITS.pairLines} pair rules. This page reads up to ${CHECK_LIMITS.pairLines}.`);
      return { ok: false, errors: problems.shown() };
    }
    lines.forEach((line, index) => {
      if (line.trim() === "") return;
      const lineNo = index + 1;
      const parts = line.split("|");
      if (parts.length !== 2 || parts.some((part) => tidy(part) === "")) {
        problems.add(`Pair line ${lineNo}: write two names with a bar between them, as Act A | Act B.`);
        return;
      }
      const keys = parts.map(normalizeName);
      if (keys[0] === keys[1]) {
        problems.add(`Pair line ${lineNo}: the two names are the same set.`);
        return;
      }
      const found: CheckSet[] = [];
      let broken = false;
      parts.forEach((part, side) => {
        const matches = byKey.get(keys[side]) ?? [];
        if (matches.length === 0) {
          problems.add(`Pair line ${lineNo}: “${clip(tidy(part))}” matches no set in the grid.`);
          broken = true;
        } else if (matches.length > 1) {
          problems.add(
            `Pair line ${lineNo}: “${clip(tidy(part))}” matches ${matches.length} rows, so this page cannot tell which set you mean. Give each set a unique name.`,
          );
          broken = true;
        } else {
          found.push(matches[0]);
        }
      });
      if (broken) return;
      const unordered = [keys[0], keys[1]].sort().join("|");
      if (written.has(unordered)) return;
      written.add(unordered);
      pairs.push({ a: found[0], b: found[1], line: lineNo });
    });
  }

  if (problems.any) return { ok: false, errors: problems.shown() };
  return { ok: true, settings: { changeover, curfew, pairs } };
}

function overlap(a: CheckSet, b: CheckSet): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function byTime(a: CheckSet, b: CheckSet): number {
  return a.start - b.start || a.end - b.end || a.row - b.row;
}

function where(set: CheckSet): string {
  return `${set.act}, ${set.stage} ${span(set.start, set.end)}`;
}

/** The five rules, in rule order, each break named with its sets and times. */
export function findBreaks(sets: readonly CheckSet[], settings: CheckSettings): RuleBreak[] {
  const doubled: RuleBreak[] = [];
  const stacked: RuleBreak[] = [];
  const tight: RuleBreak[] = [];
  const late: RuleBreak[] = [];
  const apart: RuleBreak[] = [];
  const ordered = [...sets].sort(byTime);

  for (let i = 0; i < ordered.length; i += 1) {
    for (let k = i + 1; k < ordered.length; k += 1) {
      const a = ordered[i];
      const b = ordered[k];
      const shared = overlap(a, b);
      if (shared === 0) continue;
      if (a.actKey === b.actKey && a.stageKey !== b.stageKey) {
        doubled.push({
          rule: 1,
          text: `${a.act} is booked on two stages at the same time.`,
          detail: `${a.stage} ${span(a.start, a.end)} and ${b.stage} ${span(b.start, b.end)}; ${plural(shared, "minute")} shared.`,
          rows: [a.row, b.row],
        });
      } else if (a.stageKey === b.stageKey) {
        stacked.push({
          rule: 2,
          text: `${a.act} and ${b.act} overlap on ${a.stage}.`,
          detail: `${a.act} ${span(a.start, a.end)}; ${b.act} ${span(b.start, b.end)}; ${plural(shared, "minute")} shared.`,
          rows: [a.row, b.row],
        });
      }
    }
  }

  const byStage = new Map<string, CheckSet[]>();
  for (const set of ordered) byStage.set(set.stageKey, [...(byStage.get(set.stageKey) ?? []), set]);
  for (const members of byStage.values()) {
    for (let i = 0; i + 1 < members.length; i += 1) {
      const first = members[i];
      const second = members[i + 1];
      const gap = second.start - first.end;
      if (gap >= 0 && gap < settings.changeover) {
        tight.push({
          rule: 3,
          text: `${first.act} and ${second.act} are ${plural(gap, "minute")} apart on ${first.stage}, under the ${settings.changeover}-minute changeover.`,
          detail: `${first.act} ends ${formatClock(first.end)}; ${second.act} starts ${formatClock(second.start)}.`,
          rows: [first.row, second.row],
        });
      }
    }
  }

  if (settings.curfew !== null) {
    for (const set of ordered) {
      if (set.end > settings.curfew) {
        late.push({
          rule: 4,
          text: `${set.act} ends at ${formatClock(set.end)}, after the ${formatClock(settings.curfew)} curfew.`,
          detail: `${where(set)}.`,
          rows: [set.row],
        });
      }
    }
  }

  for (const pair of settings.pairs) {
    const shared = overlap(pair.a, pair.b);
    if (shared > 0) {
      const [a, b] = [pair.a, pair.b].sort(byTime);
      apart.push({
        rule: 5,
        text: `${pair.a.act} and ${pair.b.act} share ${plural(shared, "minute")}, and you asked that they never overlap.`,
        detail: `${a.act}, ${a.stage} ${span(a.start, a.end)}; ${b.act}, ${b.stage} ${span(b.start, b.end)}.`,
        rows: [pair.a.row, pair.b.row],
      });
    }
  }
  apart.sort((x, y) => x.rows[0] - y.rows[0] || x.rows[1] - y.rows[1]);

  return [...doubled, ...stacked, ...tight, ...late, ...apart];
}

/** One set as a pair-id part: act, stage and times, length-prefixed so no field can bleed into the next. */
function setIdentity(set: CheckSet): string {
  return lengthPrefixed(set.actKey, set.stageKey, String(set.start), String(set.end));
}

/** Every two different acts that share a minute, longest first. The same act twice is a rule-1 break, not a pair. */
export function findShared(sets: readonly CheckSet[]): SharedPair[] {
  const found: SharedPair[] = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let k = i + 1; k < sets.length; k += 1) {
      const [a, b] = [sets[i], sets[k]].sort(byTime);
      if (a.actKey === b.actKey) continue;
      const minutes = overlap(a, b);
      if (minutes === 0) continue;
      const windowStart = Math.max(a.start, b.start);
      found.push({
        // Act, stage and both times, each field length-prefixed: one act booked on two stages at once
        // must not share an id, and a name that holds "@" or "|" cannot run into the next field.
        id: [a, b].map(setIdentity).join("|"),
        a,
        b,
        minutes,
        windowStart,
        windowEnd: windowStart + minutes,
      });
    }
  }
  return found.sort(
    (x, y) =>
      y.minutes - x.minutes ||
      x.windowStart - y.windowStart ||
      x.a.actKey.localeCompare(y.a.actKey) ||
      x.b.actKey.localeCompare(y.b.actKey),
  );
}

/** Read the paste and the settings, then run the five rules. Pure: the same input gives the same answer. */
export function runCheck(input: CheckInput): CheckOutcome {
  const grid = parseGrid(input.grid);
  const errors: string[] = [];
  if (!grid.ok) errors.push(...grid.errors);
  const settings = parseSettings(input, grid.ok ? grid.sets : []);
  if (!settings.ok && grid.ok) errors.push(...settings.errors);
  else if (!settings.ok) {
    // Settings that do not depend on the grid (changeover, curfew, size) are still worth naming.
    errors.push(...settings.errors.filter((e) => !e.startsWith("Pair line")));
  }
  if (errors.length > 0 || !grid.ok || !settings.ok) return { ok: false, errors };

  const sets = grid.sets;
  return {
    ok: true,
    report: {
      sets,
      stages: [...new Map(sets.map((s) => [s.stageKey, s.stage])).values()],
      lockedCount: sets.filter((s) => s.locked).length,
      settings: settings.settings,
      breaks: findBreaks(sets, settings.settings),
      shared: findShared(sets),
    },
  };
}

/** What the polite live region says once a check has run. */
export function announcement(outcome: CheckOutcome): string {
  if (!outcome.ok) {
    return `The grid was not checked. ${plural(outcome.errors.length, "problem")} listed.`;
  }
  const { breaks, shared } = outcome.report;
  return `Rule breaks: ${breaks.length}. Sets that share time: ${plural(shared.length, "pair")}.`;
}

export function pairCountLabel(count: number): string {
  return plural(count, "pair");
}

export function minutesLabel(count: number): string {
  return plural(count, "minute");
}

export function clockWindow(start: number, end: number): string {
  return span(start, end);
}
