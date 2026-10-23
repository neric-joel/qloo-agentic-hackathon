/**
 * The browser-only grid check (DECISION 3.6). It reads one pasted day of a draft timetable and the
 * settings next to it, and reports five rule breaks and the sets that share time. Nothing here
 * touches the network, storage or any other module: the text goes in, a plain object comes out.
 *
 * Guards that keep the page honest about what it read:
 * - one day, 60 sets, 10 stages and 8 KB; anything else is refused with a plain message;
 * - quoted fields with commas are read as one field; comma, semicolon or tab, decided by `gridDelimiter`: the
 *   first line's own separator when that line is a header; a title's, when the next line is a header, that
 *   header's; otherwise the separator that splits the most lines into four or more fields; and on a tie, or with
 *   no such line, the first line's, as it always was. A grid that reads with no skipped line reads exactly as it
 *   did under the first-line rule alone: a header keeps its own separator, and a grid without one has four or
 *   more fields on every line by that separator, which no other separator can beat;
 * - a title: the first non-blank line, when it is no header, holds no time (split on tab, comma and semicolon),
 *   has some text and does not have four or more fields with two or more filled, is not a row. It is read as a
 *   title, not checked and not a skipped line, and one note says so. Any other line that cannot be read as a
 *   row is a line fault, as before, so a title never hides a row;
 * - two kinds of failure. A fault of the whole input (empty, too big, an unreadable character, a header
 *   that does not read, more than one day, no readable set, over a limit, any settings problem) stops the
 *   check. A fault of one line (a quote left open, the wrong number of fields, a blank or overlong name,
 *   a time that does not read or runs backwards, a locked value, an after-midnight time out of order, a
 *   repeat of an earlier line) skips that line alone: the other lines are checked and the skipped ones
 *   are listed by their line number in the paste, never guessed and never checked;
 * - pair rules naming no set, or several, are rejected visibly; one naming an act found only on a
 *   skipped line is listed as not checked;
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
/**
 * H:MM or HH:MM, or the same with a dot (18.30), with optional seconds after a colon that are dropped
 * (spreadsheets often copy 18:00:00).
 */
const CLOCK = /^(\d{1,2})[:.]([0-5]\d)(?::[0-5]\d)?$/;
/** Hours and minutes around an h, as many European timetables write them: 18h30. */
const CLOCK_H = /^(\d{1,2})h([0-5]\d)$/i;
/** Four digits with no separator, 1830 or 0030: read in a start or end cell only, never in the curfew field. */
const CLOCK_COMPACT = /^(\d{2})([0-5]\d)$/;
/**
 * A 12-hour time as spreadsheets and exports write it: 2:00 PM, 2pm, 3:10pm, 6.30 pm, 12:30 a.m., and with a
 * single a or p: 6:30p, 6.30a.
 */
const CLOCK_12 = /^(\d{1,2})(?:[:.]([0-5]\d))?(?::[0-5]\d)?\s*([ap])(?:\.?\s*m)?\.?$/i;
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

/**
 * A pasted line the check could not read. It is left out of every rule, every pair and anything sent,
 * and listed by its line in the paste (counting the header and blank lines, from 1).
 */
export type SkippedLine = {
  line: number;
  /** Why, as the page says it, naming the act when the line has one and quoting a rejected value: "Line 4 (Glass Harbour): the start time "25:70" is not a time such as …". */
  message: string;
  /** The act as written on the line, when it can be told; a pair rule that names it is listed as not checked. */
  act: string | null;
  /**
   * The line read as one field and holds a semicolon while the first line set commas or tabs: it looks
   * separated by semicolons. Never true in a grid read by semicolons.
   */
  semicolons: boolean;
};

/** The first line of a paste, read as a title because it holds no time and cannot be a row. */
export type GridTitle = {
  /** Line number in the paste, counting from 1 (blank lines before it count). */
  line: number;
  /** The line as written, tidied and clipped to 80 characters. */
  text: string;
};

export type CheckReport = {
  sets: CheckSet[];
  stages: string[];
  lockedCount: number;
  settings: CheckSettings;
  breaks: RuleBreak[];
  shared: SharedPair[];
  /** What the page read but did not use, such as columns it ignores or a title line. Never a rule break. */
  notes: string[];
  /** The first line, when it was read as a title (it is in `notes`, never in `skipped`). Absent for none. */
  title?: GridTitle;
  /** Lines left out because they could not be read; the rules ran on the other lines. Empty or absent for none. */
  skipped?: SkippedLine[];
  /** "Pair line 2 not checked: Aurora is on a skipped line.", one per pair rule that names a skipped act. */
  uncheckedPairs?: string[];
  /** The day column's one value as first written (clipped to 20 characters); null or absent without one. */
  day?: string | null;
};

/**
 * A pair-rule name that matches no set, with the name the page would use instead: `match` when one act
 * starts with or holds the typed words (the visitor confirms it with one click), else the three nearest.
 */
export type PairSuggestion = {
  /** The error this suggestion belongs to, word for word. */
  message: string;
  line: number;
  side: 0 | 1;
  match: string | null;
  nearest: string[];
};

export type CheckOutcome =
  | { ok: true; report: CheckReport }
  | {
      ok: false;
      errors: string[];
      suggestions: PairSuggestion[];
      /** The lines that could not be read, when the paste was read that far (for the separator hint). */
      skipped?: SkippedLine[];
    };

/** The page's set wording. */
export const CHECK_COPY = {
  kicker: "Check a draft grid",
  title: "Check a draft grid against your rules",
  lede: "Paste one day of a draft timetable to find rule breaks and sets that share time. Audience overlap is optional.",
  privacy:
    "Rule checks run in your browser; nothing is sent unless you press Compare audience overlap. Decisions you mark stay in this tab and clear on reload. A copied link contains your grid and settings; anyone with it can read them, and opening it fills the fields again.",
  printTitle: "Draft check, not a verdict",
  noBreaks: "No rule breaks found against the settings above.",
  elsewhere:
    "Rule checks like these also exist in scheduling software. What this app adds is the audience reading: on this page it is the optional Compare audience overlap step, read from a saved day or, if you ask, from Qloo.",
  /** In the preview column, in place of its outline, while the text on show does not read as a grid. */
  previewUnavailable: "Preview unavailable: fix the lines listed and check again.",
  /** After the line messages, when two or more unreadable lines look separated by semicolons. */
  separatorHint: "These lines look separated by semicolons. Use commas or tabs between act, stage, start and end.",
} as const;

/** "set" or "sets" with its count. */
function setsLabel(count: number): string {
  return `${count} ${count === 1 ? "set" : "sets"}`;
}

/**
 * The no-breaks sentence. While any line is skipped, or a title line was read and left out, it never stands
 * alone: it says how many sets were checked, so a clean result on part of a paste is never read as a clean grid.
 */
export function noBreaksLine(report: Pick<CheckReport, "sets" | "skipped" | "title">): string {
  if ((report.skipped ?? []).length === 0 && !report.title) return CHECK_COPY.noBreaks;
  return `No rule breaks found among the ${setsLabel(report.sets.length)} checked, against the settings above.`;
}

/**
 * What a partial check says first: "1 line skipped and not checked: line 4. The other 11 sets were checked."
 * Null when nothing was skipped.
 */
export function skippedSentence(skipped: readonly Pick<SkippedLine, "line">[], checked: number): string | null {
  if (skipped.length === 0) return null;
  const lines = skipped.map((item) => `line ${item.line}`).join(", ");
  const head = skipped.length === 1 ? "1 line skipped" : `${skipped.length} lines skipped`;
  const rest = checked === 1 ? "The other 1 set was checked." : `The other ${checked} sets were checked.`;
  return `${head} and not checked: ${lines}. ${rest}`;
}

/** The skipped lines' own messages, five at most and then "And n more problems.", as the refusal lists them. */
export function skippedMessages(skipped: readonly Pick<SkippedLine, "message">[]): string[] {
  const { errorsShown } = CHECK_LIMITS;
  const all = skipped.map((item) => item.message);
  if (all.length <= errorsShown) return all;
  return [...all.slice(0, errorsShown), `And ${plural(all.length - errorsShown, "more problem")}.`];
}

/** The separator hint, when two or more unreadable lines read as one field holding a semicolon; else null. */
export function separatorHint(skipped: readonly Pick<SkippedLine, "semicolons">[] | undefined): string | null {
  return (skipped ?? []).filter((item) => item.semicolons).length >= 2 ? CHECK_COPY.separatorHint : null;
}

/** The line a pair rule gets when one of its acts is only on a skipped line. */
export function pairNotChecked(line: number, act: string): string {
  return `Pair line ${line} not checked: ${clip(act)} is on a skipped line.`;
}

/**
 * The results header after a check: what the rule check read and how long it took in this browser, a
 * measurement of that one run (never stored, never sent, never a time saved). `ms` is at least 1.
 */
export function checkTimeLine(setCount: number, stageCount: number, ms: number): string {
  const stages = `${stageCount} ${stageCount === 1 ? "stage" : "stages"}`;
  return `Checked ${setsLabel(setCount)} on ${stages} in ${Math.max(1, Math.round(ms))} ms, in this browser.`;
}

/** What the polite live region says once after a paste on the Table view lands in the CSV editor. */
export function pastedLine(text: string): string {
  const count = text.replace(/(\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).length;
  return `Pasted ${count} ${count === 1 ? "line" : "lines"} into the CSV editor. Press Check the grid.`;
}

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

type Clock = { minutes: number; twelveHour: boolean };

/**
 * Minutes for `H:MM`, `HH:MM`, `18.30` or `18h30` (hours up to 47), with `compact` also `1830`, or for a
 * 12-hour time (`2:00 PM`, `2pm`, `6.30pm`, `6:30p`; `12:30 AM` is 00:30), or null when it is none of these.
 * A bare number of one to three digits is never a time. `twelveHour` says which kind, because a 12-hour
 * time cannot be written as 24:30 for after midnight.
 */
function readClock(value: string, compact = false): Clock | null {
  const text = value.trim();
  const match = CLOCK.exec(text) ?? CLOCK_H.exec(text) ?? (compact ? CLOCK_COMPACT.exec(text) : null);
  if (match) {
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes <= CHECK_LIMITS.maxMinutes ? { minutes, twelveHour: false } : null;
  }
  const twelve = CLOCK_12.exec(text);
  if (!twelve) return null;
  const hour = Number(twelve[1]);
  if (hour < 1 || hour > 12) return null;
  const afternoon = twelve[3].toLowerCase() === "p";
  return { minutes: ((hour % 12) + (afternoon ? 12 : 0)) * 60 + Number(twelve[2] ?? 0), twelveHour: true };
}

function parseClock(value: string): number | null {
  return readClock(value)?.minutes ?? null;
}

const TIME_FORMS = "18:00, 18.00, 1800, 24:30, 6:00 PM or 6pm";

/**
 * The two sides of a time range in one cell, "18:00-19:00", "18:00–19:00" (en dash) or "6pm to 7:15pm",
 * each still to be read as a time; null when the cell is not two non-blank sides around one separator.
 */
function rangeSides(value: string): [string, string] | null {
  const text = value.trim();
  for (const separator of [/\s+to\s+/i, /\s*[-–]\s*/]) {
    const sides = text.split(separator);
    if (sides.length === 2 && sides.every((side) => side.trim() !== "")) return [sides[0].trim(), sides[1].trim()];
  }
  return null;
}

/** A cell a data row would hold for its times: a time, or a range of two. A header row holds neither. */
function readsAsTime(value: string): boolean {
  if (readClock(value, true) !== null) return true;
  const sides = rangeSides(value);
  return sides !== null && sides.every((side) => readClock(side, true) !== null);
}

/** A pasted value as a skip message quotes it: trimmed, at most 30 characters, in straight quotes. */
function quoted(value: string): string {
  return `"${clip(tidy(value), 30)}"`;
}

/** " (Act)" after a line number, when the line has an act to name; else nothing. */
function named(act: string | null): string {
  return act ? ` (${act})` : "";
}

/**
 * The delimiter one line sets by itself: a tab means tab; otherwise a semicolon when the line holds more
 * semicolons than commas outside its quoted fields (the CSV a spreadsheet writes where the comma is the decimal
 * mark), else a comma.
 */
function firstLineDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  const bare = line.replace(/"(?:[^"]|"")*"/g, "");
  const count = (char: string) => bare.split(char).length - 1;
  return count(";") > count(",") ? ";" : ",";
}

/** The separators a paste may use, tab first. */
const DELIMITERS = ["\t", ";", ","] as const;

/** Four fields are the least a row without a header has: act, stage, start and end. */
const ROW_FIELDS = 4;

/**
 * The delimiter of the paste, decided in this order:
 * (a) the first non-blank line's own, when that line reads as a header under it;
 * (b) when the first non-blank line is a title (no header, no time, not a row) and the next non-blank line
 *     reads as a header under its own, that header's: a title over `act;stage;time` reads by semicolons;
 * (c) the separator by which the most non-blank lines split (quotes respected) into four or more fields, when one
 *     separator has strictly more than each other; a tie, or no such line, falls to
 * (d) the first non-blank line's own (`firstLineDelimiter`), the rule before titles were read.
 * A grid that reads with no skipped line has the same delimiter under all four: a header keeps (a), and a grid
 * without one has four or more fields on every line by its first line's separator, which no other can exceed.
 */
export function gridDelimiter(lines: readonly string[]): string {
  const filled = lines.filter((line) => line.trim() !== "");
  const first = filled[0] ?? "";
  const own = firstLineDelimiter(first);
  const firstSplit = splitLine(first, own);
  if (firstSplit.ok && readsAsHeader(firstSplit.fields)) return own;
  if (firstSplit.ok && readsAsTitle(first, firstSplit.fields) && filled.length > 1) {
    const next = filled[1];
    const nextOwn = firstLineDelimiter(next);
    const nextSplit = splitLine(next, nextOwn);
    if (nextSplit.ok && readsAsHeader(nextSplit.fields)) return nextOwn;
  }
  const rows = DELIMITERS.map((delimiter) =>
    filled.filter((line) => {
      const split = splitLine(line, delimiter);
      return split.ok && split.fields.length >= ROW_FIELDS;
    }).length,
  );
  const most = Math.max(...rows);
  const leaders = DELIMITERS.filter((_, at) => rows[at] === most);
  return most > 0 && leaders.length === 1 ? leaders[0] : own;
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

type Column = "act" | "stage" | "start" | "end" | "locked" | "day";

/** What a header cell may be called, by column; spreadsheets say "Start time" or "Finish" and capitalise freely. */
const HEADER_NAMES: Record<Column, ReadonlySet<string>> = {
  act: new Set(["act", "act name", "artist", "artist name", "band", "performer"]),
  stage: new Set(["stage", "stage name", "venue", "tent", "area"]),
  start: new Set(["start", "start time", "starts", "begin", "begins", "from", "set start"]),
  end: new Set(["end", "end time", "ends", "finish", "finish time", "finishes", "until", "to", "set end"]),
  locked: new Set(["locked", "lock", "fixed"]),
  day: new Set(["day", "date"]),
};

const COLUMNS = Object.keys(HEADER_NAMES) as Column[];

/** The columns a header must name for any line to be read. */
const REQUIRED: readonly Column[] = ["act", "stage", "start", "end"];

/**
 * One column of time ranges ("18:00-19:00"), read into start and end when a header names no start and no
 * end column and exactly one column by one of these.
 */
const RANGE_NAMES: ReadonlySet<string> = new Set(["time", "times", "set time", "set times", "slot"]);

/** "end", "act or stage", "act, stage or end". */
function orList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * The one message for a header that is read as a header but leaves a needed column out: each missing column,
 * every header cell that named nothing, quoted, and the words this check reads for each missing column.
 * "Line 1: no column reads as end. Not read: "Endzeit". For end this check reads: end, end time, …"
 */
function headerRefusal(row: number, missing: readonly Column[], unread: readonly string[]): string {
  const notRead = unread.length > 0 ? ` Not read: ${unread.map(quoted).join(", ")}.` : "";
  const words = missing.map((column) => ` For ${column} this check reads: ${[...HEADER_NAMES[column]].join(", ")}.`).join("");
  const range =
    missing.includes("start") && missing.includes("end")
      ? ` Or one column of ranges such as 18:00-19:00, headed ${orList([...RANGE_NAMES])}.`
      : "";
  return `Line ${row}: no column reads as ${orList(missing)}.${notRead}${words}${range}`;
}

/**
 * A header cell as the name it is matched by: lower case, punctuation at either end dropped, underscores and
 * runs of spaces as one space. A spreadsheet's "Fixed?", "Start:" or "(Locked)" names its column.
 */
function headerName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/[_\s]+/g, " ");
}

function columnOf(value: string): Column | null {
  const name = headerName(value);
  return COLUMNS.find((column) => HEADER_NAMES[column].has(name)) ?? null;
}

/** What each cell of a line names: a column, "range" for a column of time ranges, or nothing. */
function headerNaming(fields: readonly string[]): (Column | "range" | null)[] {
  return fields.map((field) => columnOf(field) ?? (RANGE_NAMES.has(headerName(field)) ? "range" : null));
}

/** A line with no time in it, two or more of whose cells name a column, is a header. */
function readsAsHeader(fields: readonly string[]): boolean {
  return headerNaming(fields).filter((name) => name !== null).length >= 2 && !fields.some(readsAsTime);
}

/**
 * Whether a first line (already split into `fields`) is a title rather than a row: it is no header, it holds some
 * text, and it does not have four or more fields in all with two or more of them filled (a row with a bad or blank
 * cell, "A,Main,,bad", stays a line fault); and no part of it, however the line is cut by tab, comma or semicolon
 * and with or without its quotes, reads as a time. "Saturday\t\t\t" (one filled field) and "Saturday, 4 July" (two
 * fields) are titles; "Sunday,18:00" and "A,Main,xx,yy" are not.
 */
function readsAsTitle(line: string, fields: readonly string[]): boolean {
  if (readsAsHeader(fields)) return false;
  const filled = fields.filter((field) => field.trim() !== "").length;
  if (filled === 0 || (fields.length >= ROW_FIELDS && filled >= 2)) return false;
  const parts = [...fields, ...line.split(/[\t,;]/)].map((part) => part.trim().replace(/^"+|"+$/g, "").trim());
  return !parts.some(readsAsTime);
}

/**
 * Where each column sits in a row; without a header, act, stage, start, end and locked in that order. With
 * `range`, start and end are the same column, each cell a range such as 18:00-19:00.
 */
type Layout = {
  act: number;
  stage: number;
  start: number;
  end: number;
  locked: number | null;
  day: number | null;
  width: number;
  range: boolean;
};

const POSITIONAL: Layout = { act: 0, stage: 1, start: 2, end: 3, locked: 4, day: null, width: 5, range: false };

/** Distinct day values listed in the refusal of a grid with more than one day. */
const DAYS_SHOWN = 5;

const LOCKED_YES = new Set(["locked", "yes", "y", "true", "1", "x"]);
const LOCKED_NO = new Set(["", "no", "n", "false", "0"]);

type Draft = {
  row: number;
  act: string;
  stage: string;
  start: number;
  end: number;
  locked: boolean;
  /** A 12-hour start before 06:00, which cannot be written as 24:30: read as after midnight in an evening grid. */
  earlyTwelve: boolean;
};

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

/**
 * What `parseGrid` read: the readable sets, the skipped lines, the day column's one value (null when the
 * grid has no day column or no day written) and the first line when it was read as a title, or the problems
 * that stop the whole check.
 */
export type GridResult =
  | { ok: true; sets: CheckSet[]; notes: string[]; skipped: SkippedLine[]; day: string | null; title?: GridTitle }
  | { ok: false; errors: string[]; skipped?: SkippedLine[] };

/** An act name fit to compare with a pair rule: tidied, not blank and within the length limit; else null. */
function actName(value: string | undefined): string | null {
  const act = tidy(value ?? "");
  return act === "" || Array.from(act).length > CHECK_LIMITS.nameChars ? null : act;
}

/**
 * The act field of a line that would not split, read loosely (its quotes dropped). It is only ever compared
 * with a pair rule's names, so a rule that names it is listed as not checked; it is never checked itself.
 */
function looseAct(line: string, delimiter: string, at: number): string | null {
  return actName((line.split(delimiter)[at] ?? "").trim().replace(/^"+|"+$/g, ""));
}

/**
 * The grid text into rows. A title line and a header row are optional (a title is only ever the first
 * non-blank line, and the header test then runs on the next). A fault of one line skips that line, listed by
 * its line number in the paste (counting the title, the header and blank lines); the other lines are read. A
 * fault of the whole input, or no readable line at all, stops the check with every problem listed.
 */
export function parseGrid(raw: string): GridResult {
  const problems = new Problems();
  const notes: string[] = [];
  const skipped: SkippedLine[] = [];
  // A fault of the whole input: nothing is checked, however many lines read.
  let whole = false;
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
  const delimiter = gridDelimiter(lines);
  const drafts: (Draft & { day: string })[] = [];
  let headerChecked = false;
  // Whether the first non-blank line has been met; only that line can be read as a title.
  let firstMet = false;
  let title: GridTitle | undefined;
  let layout: Layout = POSITIONAL;
  let headed = false;
  // A header read as a header that leaves a needed column out: its one message is the whole answer, and no
  // line after it is read (none could be read with confidence).
  let refusal: string | null = null;

  /** One line left out: its message is listed, and nothing on it is checked. */
  const skip = (row: number, message: string, act: string | null, semicolons = false) => {
    problems.add(message);
    skipped.push({ line: row, message, act, semicolons });
  };

  lines.forEach((line, index) => {
    if (refusal !== null || line.trim() === "") return;
    const row = index + 1;
    const first = !firstMet;
    firstMet = true;
    const split = splitLine(line, delimiter);
    if (!split.ok) {
      const loose = looseAct(line, delimiter, layout.act);
      skip(row, `Line ${row}${named(loose)}: a quote is not closed or has text after it.`, loose);
      return;
    }
    const fields = split.fields;
    if (first && readsAsTitle(line, fields)) {
      // No header, no time and not a row: a title. It is left out of every rule and every list of skipped lines,
      // and said once, so the grid under it is never read as the whole paste.
      const shown = clip(tidy(line));
      title = { line: row, text: shown };
      notes.push(`Skipped line ${row} (${quoted(shown)}): no times found, so it was read as a title.`);
      return;
    }
    if (!headerChecked) {
      headerChecked = true;
      // A first line with no time in it, two or more of whose cells name a column, is a header.
      const naming = headerNaming(fields);
      if (readsAsHeader(fields)) {
        const found = new Map<Column, number>();
        let repeated = false;
        naming.forEach((name, at) => {
          if (name === null || name === "range") return;
          if (found.has(name)) repeated = true;
          else found.set(name, at);
        });
        const ranges = naming.flatMap((name, at) => (name === "range" ? [at] : []));
        // One time-range column stands in for start and end when the header names neither.
        const range = !found.has("start") && !found.has("end") && ranges.length === 1;
        // Every cell that named nothing, in header order (a range column this header does not use among them).
        const unread = fields.filter(
          (field, at) => field.trim() !== "" && (naming[at] === null || (naming[at] === "range" && !range)),
        );
        const missing = REQUIRED.filter((column) => !found.has(column) && !(range && (column === "start" || column === "end")));
        if (missing.length > 0) {
          refusal = headerRefusal(row, missing, unread);
        } else if (repeated) {
          refusal = `Line ${row}: the header should read act, stage, start, end (locked and day are optional; other columns are ignored).`;
        } else {
          const at = range ? ranges[0] : null;
          layout = {
            act: found.get("act") as number,
            stage: found.get("stage") as number,
            start: at ?? (found.get("start") as number),
            end: at ?? (found.get("end") as number),
            locked: found.get("locked") ?? null,
            day: found.get("day") ?? null,
            width: fields.length,
            range,
          };
          headed = true;
          const ignored = unread.map((field) => clip(tidy(field), 30));
          if (ignored.length > 0) {
            const names = ignored.join(", ");
            // A last name that ends in its own mark ("Notes?") ends the sentence; no full stop after it.
            const stop = /[.?!…]$/u.test(names) ? "" : ".";
            notes.push(
              `Ignored ${ignored.length === 1 ? "a column" : `${ignored.length} columns`} this page does not read: ${names}${stop}`,
            );
          }
        }
        return;
      }
    }
    while (fields.length > layout.width && fields[fields.length - 1].trim() === "") fields.pop();
    const needed = Math.max(layout.act, layout.stage, layout.start, layout.end) + 1;
    const fits = headed
      ? fields.length >= needed && fields.length <= layout.width
      : fields.length >= 4 && fields.length <= 5;
    if (!fits) {
      const act = actName(fields[layout.act]);
      // A line that did not split at all has no act to name, only its whole text.
      const who = fields.length > 1 ? named(act) : "";
      skip(
        row,
        headed
          ? `Line ${row}${who}: the header has ${plural(layout.width, "column")}, but this line has ${plural(fields.length, "field")}.`
          : `Line ${row}${who}: expected act, stage, start, end (and locked), but found ${plural(fields.length, "field")}.`,
        act,
        // Only where the first line set another separator: in a grid read by semicolons, no line looks like one.
        delimiter !== ";" && fields.length === 1 && line.includes(";"),
      );
      return;
    }
    const act = tidy(fields[layout.act]);
    const stage = tidy(fields[layout.stage]);
    if (act === "" || stage === "") {
      skip(row, `Line ${row}${named(actName(act))}: the act and the stage cannot be blank.`, actName(act));
      return;
    }
    if (Array.from(act).length > CHECK_LIMITS.nameChars || Array.from(stage).length > CHECK_LIMITS.nameChars) {
      skip(row, `Line ${row}${named(actName(act))}: a name is longer than ${CHECK_LIMITS.nameChars} characters.`, actName(act));
      return;
    }
    let startText = fields[layout.start];
    let endText = fields[layout.end];
    if (layout.range) {
      const sides = rangeSides(fields[layout.start]);
      if (sides === null) {
        skip(row, `Line ${row}${named(act)}: the set time ${quoted(fields[layout.start])} is not a range such as 18:00-19:00 or 6pm to 7:15pm.`, act);
        return;
      }
      [startText, endText] = sides;
    }
    const startClock = readClock(startText, true);
    const endClock = readClock(endText, true);
    if (startClock === null) {
      skip(row, `Line ${row}${named(act)}: the start time ${quoted(startText)} is not a time such as ${TIME_FORMS}.`, act);
      return;
    }
    if (endClock === null) {
      skip(row, `Line ${row}${named(act)}: the end time ${quoted(endText)} is not a time such as ${TIME_FORMS}.`, act);
      return;
    }
    const start = startClock.minutes;
    let end = endClock.minutes;
    if (end < start) {
      // Only a set that starts in the day proper can run past midnight by writing a small end; a set
      // that starts after midnight and ends earlier could mean anything.
      if (end < CHECK_LIMITS.dayStartsAt && start >= CHECK_LIMITS.dayStartsAt) end += MINUTES_PER_DAY;
      else {
        skip(row, `Line ${row}${named(act)}: the set ends before it starts. For after midnight, write the end as 24:30 or later.`, act);
        return;
      }
    }
    if (end <= start) {
      skip(row, `Line ${row}${named(act)}: the set must end after it starts.`, act);
      return;
    }
    const rawFlag = layout.locked === null ? "" : (fields[layout.locked] ?? "");
    const flag = rawFlag.trim().toLowerCase();
    if (!LOCKED_YES.has(flag) && !LOCKED_NO.has(flag)) {
      skip(row, `Line ${row}${named(act)}: the locked column should be yes, no or blank, not ${quoted(rawFlag)}.`, act);
      return;
    }
    drafts.push({
      row,
      act,
      stage,
      start,
      end,
      locked: LOCKED_YES.has(flag),
      earlyTwelve: startClock.twelveHour && start < CHECK_LIMITS.dayStartsAt,
      day: layout.day === null ? "" : tidy(fields[layout.day] ?? ""),
    });
  });

  // Assigned inside the loop above, so read it back here as either kind.
  const refused = refusal as string | null;
  if (refused !== null) return { ok: false, errors: [refused] };

  // The day's order and repeats, over the lines that read. A line that fails either is skipped (a repeat:
  // the later line), and its message is listed after the whole-input problems, as it always was.
  const lateStart = drafts.some((d) => d.start >= 720);
  const seen = new Map<string, number>();
  const readable: typeof drafts = [];
  const later: SkippedLine[] = [];
  const skipLater = (d: Draft, message: string) => later.push({ line: d.row, message, act: d.act, semicolons: false });
  for (const d of drafts) {
    if (lateStart && d.start < CHECK_LIMITS.dayStartsAt) {
      if (d.earlyTwelve) {
        // 12:30 AM in an evening grid is after midnight: a 12-hour time has no 24:30 to write instead.
        // Each endpoint moves once: an end already written as 24:45 (or later) is already the next day.
        d.start += MINUTES_PER_DAY;
        if (d.end < MINUTES_PER_DAY) d.end += MINUTES_PER_DAY;
        if (d.end <= d.start || d.end > CHECK_LIMITS.maxMinutes) {
          skipLater(d, `Line ${d.row}${named(d.act)}: the set ends before it starts. For after midnight, write the end as 24:30 or later.`);
          continue;
        }
      } else {
        skipLater(
          d,
          `Line ${d.row}${named(d.act)}: starts before 06:00 while other sets start in the afternoon or evening. Write after-midnight times as 24:30 or later so the day reads in order.`,
        );
        continue;
      }
    }
    const key = lengthPrefixed(normalizeName(d.act), normalizeName(d.stage), String(d.start), String(d.end));
    const first = seen.get(key);
    if (first !== undefined) {
      skipLater(d, `Line ${d.row}${named(d.act)}: the same set as line ${first} (same act, stage and times).`);
      continue;
    }
    seen.set(key, d.row);
    readable.push(d);
  }

  // Distinct day values among the lines that read, in the order first seen, keyed by their compared form.
  const days = new Map<string, string>();
  for (const d of readable) {
    if (d.day !== "" && !days.has(normalizeName(d.day))) days.set(normalizeName(d.day), clip(d.day, 20));
  }
  if (days.size > 1) {
    whole = true;
    const named = [...days.values()];
    const listed = named.length > DAYS_SHOWN ? [...named.slice(0, DAYS_SHOWN), "…"] : named;
    problems.add(`This grid has more than one day (${listed.join(", ")}). Paste one day at a time.`);
  }

  if (readable.length === 0 && !problems.any && later.length === 0) {
    problems.add("No sets found. Put one set on each line: act, stage, start, end.");
  }
  if (readable.length > CHECK_LIMITS.sets) {
    whole = true;
    problems.add(`That is ${readable.length} sets. This page reads up to ${CHECK_LIMITS.sets} sets, one day at a time.`);
  }

  const stageKeys = new Set(readable.map((d) => normalizeName(d.stage)));
  if (stageKeys.size > CHECK_LIMITS.stages) {
    whole = true;
    problems.add(`That is ${stageKeys.size} stages. This page reads up to ${CHECK_LIMITS.stages}.`);
  }

  for (const item of later) {
    problems.add(item.message);
    skipped.push(item);
  }
  skipped.sort((a, b) => a.line - b.line);

  if (whole || readable.length === 0) return { ok: false, errors: problems.shown(), skipped };
  // Assigned inside the loop above, so read it back here as either kind.
  const titled = title as GridTitle | undefined;
  return {
    ok: true,
    notes,
    skipped,
    day: days.size === 1 ? [...days.values()][0] : null,
    ...(titled ? { title: titled } : {}),
    sets: readable.map((d) => ({
      row: d.row,
      act: d.act,
      stage: d.stage,
      start: d.start,
      end: d.end,
      locked: d.locked,
      actKey: normalizeName(d.act),
      stageKey: normalizeName(d.stage),
    })),
  };
}

type SettingsResult =
  /** `unchecked`: one line per pair rule that names an act found only on a skipped line. */
  | { ok: true; settings: CheckSettings; unchecked: string[] }
  | { ok: false; errors: string[]; suggestions: PairSuggestion[] };

/** Edit distance between two compared names (insert, delete, substitute), for "nearest" only. */
function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let previous = Array.from({ length: y.length + 1 }, (_, k) => k);
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i];
    for (let k = 1; k <= y.length; k += 1) {
      current[k] = Math.min(previous[k] + 1, current[k - 1] + 1, previous[k - 1] + (x[i - 1] === y[k - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[y.length];
}

function wordsOf(key: string): string[] {
  return key.split(/[\s&+,./()-]+/).filter((word) => word !== "");
}

/** Nearest names listed when nothing matches. */
const NEAREST_SHOWN = 3;

/**
 * The act a typed pair name most likely means. One act whose name starts with it, or holds each of its
 * words at the start of a word ("Marlowe", "the tides"), is offered as the match; otherwise the three
 * nearest names by spelling are listed. Nothing is matched without the visitor's click.
 */
export function suggestName(typed: string, acts: ReadonlyMap<string, string>): { match: string | null; nearest: string[] } {
  const key = normalizeName(typed);
  const typedWords = wordsOf(key);
  const hits: string[] = [];
  if (Array.from(key).length >= 2 && typedWords.length > 0) {
    for (const [actKey, act] of acts) {
      const words = wordsOf(actKey);
      if (actKey.startsWith(key) || typedWords.every((word) => words.some((other) => other.startsWith(word)))) hits.push(act);
    }
  }
  if (hits.length === 1) return { match: hits[0], nearest: [] };
  const scored = [...acts].map(([actKey, act]) => {
    const prefix = Array.from(actKey).slice(0, Array.from(key).length).join("");
    const words = wordsOf(actKey).map((word) => editDistance(key, word));
    return { act, score: Math.min(editDistance(key, actKey), editDistance(key, prefix) + 1, ...words.map((d) => d + 1)) };
  });
  scored.sort((p, q) => p.score - q.score || p.act.localeCompare(q.act));
  return { match: null, nearest: scored.slice(0, NEAREST_SHOWN).map((item) => item.act) };
}

/**
 * Whether a listed name is close enough to what was typed to offer it as the same act: a typo of the whole
 * name, of its start or of one of its words (about one edit in four letters). "Marlwe" is close to
 * "Marlowe & The Tides"; "Saffron Season" is not close to an unrelated act, so the page never offers to
 * swap a pair rule onto an act the person did not mean.
 */
export function isCloseName(typed: string, name: string): boolean {
  const key = normalizeName(typed);
  const other = normalizeName(name);
  const length = Array.from(key).length;
  if (length === 0) return false;
  const allowed = Math.max(1, Math.floor(length / 4));
  const prefix = Array.from(other).slice(0, length).join("");
  const words = wordsOf(other).map((word) => editDistance(key, word));
  return Math.min(editDistance(key, other), editDistance(key, prefix), ...words) <= allowed;
}

/** The pair rules with one line (counting from 1) taken out, as "Remove this rule" asks; other lines exactly as typed. */
export function removePairLine(pairs: string, line: number): string {
  const lines = pairs.split(/\r\n|\r|\n/);
  const at = line - 1;
  if (at < 0 || at >= lines.length) return pairs;
  const next = lines.filter((_, index) => index !== at).join("\n");
  return next.trim() === "" ? "" : next;
}

/**
 * Changeover, curfew and pair rules, checked against the sets they name. A pair rule that names an act found
 * only on a skipped line (`skipped`) is not checked and is listed in `unchecked`; one that names no line at
 * all is a problem, as before.
 */
export function parseSettings(
  input: Omit<CheckInput, "grid">,
  sets: readonly CheckSet[],
  skipped: readonly SkippedLine[] = [],
): SettingsResult {
  const problems = new Problems();
  const unchecked: string[] = [];

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
  const suggestions: PairSuggestion[] = [];
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
      return { ok: false, errors: problems.shown(), suggestions: [] };
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
      // The first act of the rule that is only on a skipped line, as written there.
      let onSkipped: string | null = null;
      parts.forEach((part, side) => {
        const matches = byKey.get(keys[side]) ?? [];
        const hidden = matches.length === 0 ? skipped.find((item) => item.act !== null && normalizeName(item.act) === keys[side]) : undefined;
        if (hidden?.act) {
          onSkipped ??= hidden.act;
        } else if (matches.length === 0) {
          const named = clip(tidy(part));
          const acts = new Map(sets.map((set) => [set.actKey, set.act]));
          const { match, nearest } = suggestName(part, acts);
          const message =
            match !== null
              ? `Pair line ${lineNo}: “${named}” matches “${match}”. Use it?`
              : `Pair line ${lineNo}: “${named}” matches no set in the grid.${
                  nearest.length > 0 ? ` Nearest: ${nearest.map((name) => `“${name}”`).join(", ")}.` : ""
                }`;
          problems.add(message);
          if (match !== null || nearest.length > 0) {
            suggestions.push({ message, line: lineNo, side: side === 0 ? 0 : 1, match, nearest });
          }
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
      // Listed, never passed silently: the skipped line holds one of its sets, so the rule cannot be checked.
      if (onSkipped !== null) unchecked.push(pairNotChecked(lineNo, onSkipped));
      else pairs.push({ a: found[0], b: found[1], line: lineNo });
    });
  }

  if (problems.any) {
    const shown = problems.shown();
    return { ok: false, errors: shown, suggestions: suggestions.filter((item) => shown.includes(item.message)) };
  }
  return { ok: true, settings: { changeover, curfew, pairs }, unchecked };
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
export function setIdentity(set: CheckSet): string {
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

/**
 * Read the paste and the settings, then run the five rules on the lines that read. Pure: the same input
 * gives the same answer. A skipped line is in no rule, no pair and nothing sent; the report lists it.
 */
export function runCheck(input: CheckInput): CheckOutcome {
  const grid = parseGrid(input.grid);
  const skipped = grid.skipped ?? [];
  const settings = parseSettings(input, grid.ok ? grid.sets : [], grid.ok ? grid.skipped : []);
  if (!grid.ok) {
    // Settings that do not depend on the grid (changeover, curfew, size) are still worth naming.
    const rest = settings.ok ? [] : settings.errors.filter((e) => !e.startsWith("Pair line"));
    return { ok: false, errors: [...grid.errors, ...rest], suggestions: [], skipped };
  }
  if (!settings.ok) {
    // A settings problem stops the whole check; the lines that would be skipped are named with it.
    return { ok: false, errors: [...skippedMessages(skipped), ...settings.errors], suggestions: settings.suggestions, skipped };
  }

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
      notes: grid.notes,
      ...(grid.title ? { title: grid.title } : {}),
      skipped,
      uncheckedPairs: settings.unchecked,
      day: grid.day,
    },
  };
}

/**
 * The pair rules with one name replaced, as the visitor's click on "Use it" asks: the line keeps its
 * other name and is written back as "A | B". Lines other than `line` are left exactly as typed.
 */
export function replacePairName(pairs: string, line: number, side: 0 | 1, name: string): string {
  const lines = pairs.split(/\r\n|\r|\n/);
  const at = line - 1;
  if (at < 0 || at >= lines.length || name.includes("|")) return pairs;
  const parts = lines[at].split("|");
  if (parts.length !== 2) return pairs;
  parts[side] = name;
  lines[at] = parts.map(tidy).join(" | ");
  return lines.join("\n");
}

/** What the polite live region says once a check has run. */
export function announcement(outcome: CheckOutcome): string {
  if (!outcome.ok) {
    return `The grid was not checked. ${plural(outcome.errors.length, "problem")} listed.`;
  }
  const { breaks, shared } = outcome.report;
  // A partial check says what it left out before its counts.
  const lead = skippedSentence(outcome.report.skipped ?? [], outcome.report.sets.length);
  return `${lead ? `${lead} ` : ""}Rule breaks: ${breaks.length}. Sets that share time: ${plural(shared.length, "pair")}.`;
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
