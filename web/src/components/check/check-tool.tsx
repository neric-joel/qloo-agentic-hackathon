"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Download, Lock, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  CHECK_COPY,
  CHECK_LIMITS,
  RULE_LABELS,
  TEMPLATE_CSV,
  announcement,
  clockWindow,
  formatClock,
  isCloseName,
  parseGrid,
  pairCountLabel,
  removePairLine,
  replacePairName,
  runCheck,
  type CheckInput,
  type CheckOutcome,
  type CheckReport,
  type CheckSet,
  type PairSuggestion,
  type SharedPair,
} from "@/lib/check";
import {
  DECISION_COPY,
  breakDecisionId,
  reviewCounts,
  targetDecision,
  visibleDecisions,
  type Decision,
  type Decisions,
} from "@/lib/check-decisions";
import {
  PRICE_COPY,
  loadPublishedDay,
  loadPublishedTimetable,
  priceGridLive,
  priceRequest,
  requestPrice,
  sourceBanner,
  type PriceMode,
  type PublishedDay,
} from "@/lib/check-price";
import {
  SAMPLE_GRID,
  SAMPLE_LABEL,
  SAMPLE_RULES,
  SAMPLE_SETTINGS,
  dropSampleRules,
  isPublishedInput,
  isSampleInput,
  keepSampleRules,
  publishedDayInput,
  publishedPairsLine,
  type PublishedInput,
} from "@/lib/check-sample";
import { SHARE_COPY, csvName, readShareHash, shareHash, shareable } from "@/lib/check-share";
import {
  TRIAL_COPY,
  applyChange,
  daySpan,
  gridText,
  targetId,
  trialSteps,
  wasPlace,
  workingLabel,
  type TrialChange,
  type TrialTarget,
} from "@/lib/check-trial";

import { cn } from "@/lib/utils";

import { BreakStrip } from "./check-break-strip";
import { CheckBrief } from "./check-brief";
import { DecisionList, type DecisionPatch } from "./check-decision";
import { CheckPrice, type PriceOrder, type PriceState } from "./check-price";
import { BREAK_HEADING, BreakDisc, CheckResults, CheckState, breakMarks, nextStep, rowsInOrder } from "./check-results";
import { CheckReview } from "./check-review";
import { TEXT_ACTION, type TrialState, type TrialUi } from "./check-trial-panel";

/**
 * A text action in the sheet's name row ("Download a template", "Check an invented sample"): a ghost
 * button, 15px semibold ink, 44px tall, no border or fill at rest, underlined on hover. 8px side padding,
 * so the row's spacing is set by the margins between the actions.
 */
const BAR_TEXT_ACTION = "min-h-11 px-2 decoration-1 underline-offset-4 hover:bg-transparent hover:underline";

const FIELD =
  "mt-1.5 w-full min-w-0 rounded-md border border-border-strong bg-card px-3 text-[0.9375rem] text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * One check: `input` is what it read (the paste and settings as they were when it ran). `sample` and
 * `checkedAt` belong to that snapshot, so an edit after checking never relabels what is still shown.
 */
type Run = {
  nonce: number;
  outcome: CheckOutcome;
  note: string;
  input: CheckInput;
  sample: boolean;
  checkedAt: number | null;
  /** The invented sample the page opens with: drawn, but it takes no focus and scrolls nothing. */
  arrival?: boolean;
  /** The sample's pair rules dropped since the last check because the new grid has none of their acts. */
  removed?: string[];
  /** The checked grid is the published day "Check a published day" loaded: its label. */
  published?: string | null;
};

/** The pasted grid with some changes tried on it: a copy held in this tab, never the paste itself. */
type Working = { report: CheckReport; applied: TrialChange[] };

/** What "Copy link to this grid" did: copied, or shown to copy by hand, or refused as too long. */
type Share = { status: "copied" | "manual"; link: string } | { status: "too-long" } | null;

const EMPTY: CheckInput = { grid: "", changeover: "", curfew: "", pairs: "" };

/** The invented sample, exactly as "Check an invented sample" loads it. */
const SAMPLE_INPUT: CheckInput = {
  grid: SAMPLE_GRID,
  changeover: SAMPLE_SETTINGS.changeover,
  curfew: SAMPLE_SETTINGS.curfew,
  pairs: SAMPLE_SETTINGS.pairs,
};

/** The grid's column names, drawn above the paste like the stage headers above the timetable. */
const GRID_COLUMNS = ["Act", "Stage", "Start", "End", "Locked"] as const;

/** One line of the grid's mono text: the line-number gutter and the textarea share it exactly. */
const GRID_LINE = "font-mono text-[0.8125rem] leading-5";
const IDLE: PriceState = { phase: "idle" };

/** The published day's label for a check of it: with its pair counts when they match the overlaps found. */
function publishedRunLabel(published: PublishedInput, outcome: CheckOutcome): string {
  const line = outcome.ok ? publishedPairsLine(outcome.report.shared.length, published.pairCounts ?? null) : null;
  return line ? `${published.label} ${line}` : published.label;
}

/** Minutes from local midnight now. */
function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * A ruled disclosure row, drawn with the site's shared disclosure classes (globals.css) so it matches
 * the timetable's rows without importing from the timetable's components: label left, an optional
 * muted hint, and a plus that turns into a minus on open. Native `<details>`, so it needs no script.
 */
function RuledDetails({
  summary,
  hint,
  className,
  children,
}: {
  summary: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={`group cc-disclosure ${className ?? ""}`}>
      <summary className="cc-disclosure-summary">
        {summary}
        {hint ? <span className="cc-disclosure-hint">{hint}</span> : null}
        <span aria-hidden="true" className="cc-disclosure-mark" />
      </summary>
      {children}
    </details>
  );
}

const noSubscribe = () => () => {};

/** The rules' current values on the closed row, so a reader sees what will be applied without opening it. */
function rulesHint({ changeover, curfew, pairs }: CheckInput): string {
  const minutes = changeover.trim() || String(CHECK_LIMITS.defaultChangeover);
  const lines = pairs.split("\n").filter((line) => line.trim() !== "").length;
  return `${minutes} min changeover, curfew ${curfew.trim() || "none"}, ${lines} ${lines === 1 ? "pair rule" : "pair rules"}`;
}

/** How the draft grid is shown: read as a table, or the text itself to edit. */
type GridView = "table" | "csv";

const GRID_VIEWS = [
  { value: "table", label: "Table" },
  { value: "csv", label: "CSV" },
] as const;

/** Rows the table shows before "Show all rows". */
const TABLE_ROWS = 12;

/** A row the results asked to show: its grid row number, and a new `nonce` for each press. */
export type RowJump = { row: number; nonce: number };

/**
 * What a selected break's remedy row repeats from the results: the break's number (null while the results
 * are not numbered), its rule (`RULE_LABELS`) and its next repair (`nextStep`).
 */
export type Remedy = { n: number | null; title: string; next: string };

/**
 * The rows of the rule break selected in the results, kept marked until another break or Esc; a new `nonce`
 * for each press. With `remedy`, the table also draws that break's remedy row beside its rows.
 */
export type RowSelection = { rows: readonly number[]; nonce: number; remedy?: Remedy | null };

/**
 * The cited row a selected break's remedy row goes directly under: the last in table order when the rows
 * and the remedy fit in the view together, else the first (the other rows then print under its Next line).
 */
export function remedyAnchor(cited: readonly number[], fits: boolean): number | null {
  if (cited.length === 0) return null;
  const ordered = [...cited].sort((a, b) => a - b);
  return fits ? ordered[ordered.length - 1] : ordered[0];
}

/** 16px between the sticky site header and a selected break's first row, and below its remedy row. */
const VIEW_EDGE = 16;

/** The sticky site header's height (the page's own header, which rows scroll under), or 0 without one. */
function stickyHeaderHeight(): number {
  const header = document.querySelector<HTMLElement>("body > header");
  if (!header) return 0;
  const position = window.getComputedStyle(header).position;
  return position === "sticky" || position === "fixed" ? header.getBoundingClientRect().height : 0;
}

/** Esc lets go of the selected break's rows, unless something on top (a dialog, a menu) already took the key. */
export function escapeClears(event: Pick<KeyboardEvent, "key" | "defaultPrevented">): boolean {
  return event.key === "Escape" && !event.defaultPrevented;
}

/** How long a row the results pointed at stays marked, in milliseconds. */
const ROW_MARK_MS = 2000;

/**
 * The cells of one grid row. Each cell's own 1px edge is clear until its row is marked (then the edges
 * turn ink); the row's hairline separator is a pseudo-element, inset so it never meets the sheet's edge.
 * 5px above and below the 20px line (a 32px row with its 1px edges); 8px between columns on a phone, 12px
 * from `sm`.
 */
const CELL =
  "relative border-y border-transparent py-[5px] pr-2 sm:pr-3 after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-border after:content-[''] group-last/row:after:hidden";
/**
 * The first cell and the last: 8px inside the table's own 8px inset (4px on a phone, so the six columns fit
 * at 390px), the separators stopping 16px (12px) short of the edge.
 */
const FIRST_CELL = "border-l pl-2 before:left-2 after:left-2";
const LAST_CELL = "border-r pr-2 sm:pr-2 before:right-2 after:right-2";
/**
 * Where a row's stage differs from the shown row above it: that row's top separator, 1px in the control
 * edge colour (border-strong) instead of the hairline, at the same 16px inset. No fill, no heading row.
 */
const STAGE_RULE =
  "before:pointer-events-none before:absolute before:top-0 before:right-0 before:left-0 before:h-px before:bg-border-strong before:content-['']";
/** A header cell: 13px semibold muted over the inset hairline, its side padding the body cells'. */
const HEAD_CELL =
  "relative pt-3 pr-2 pb-2 text-[0.8125rem] leading-5 font-semibold whitespace-nowrap text-muted-foreground after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-border after:content-[''] sm:pr-3";
/** Locked's own left inset, so End's times and the lock never touch: 8 + 8 = 16px on a phone, 12 + 12 = 24px from `sm`. */
const LOCKED_INSET = "pl-2 sm:pl-3";
/** The table's columns: the row-number gutter, then the grid's own five. */
const TABLE_COLUMNS = GRID_COLUMNS.length + 1;

/**
 * The current text read as a ledger, with the same parser the check uses, in the browser: a header with
 * no fill (13px semibold muted labels over an inset hairline), inset horizontal hairlines only, the act
 * in 14px semibold, the stage muted, mono times set right, and an inline lock glyph and the word for a
 * locked set (no box). Each row opens with a gutter that prints its grid row number (the number the
 * results cite as "row 17"), as plain 12px mono text set right; a row a rule break names carries that
 * break's numbered vermilion disc in the gutter, left of the number (every disc, for a row in two or more
 * breaks: two side by side from `sm`, then wrapping onto further lines; stacked above the number on a
 * phone), and says "Rule break N." to assistive technology. Where the stage changes from the shown row
 * above, the separator between them is the control edge colour rather than the hairline. Twelve rows show, then the
 * sheet's footer row: "Showing 12 of N rows" with a text action that shows the rest in place (and folds
 * them again). With `flagged` (a check result is on show) the folded table also keeps every row a rule
 * break names, in source order, with one plain muted line for each run of rows left out ("Rows 14 to 16
 * not shown"), and the footer says which rows it shows. The rows of a selected break take the wash
 * inside a 1px ink edge. A row the results point at (`jump`) is shown (every row first, when it is folded
 * away), scrolled to (no smooth scroll under reduced motion) and marked for two seconds with the same
 * ink edge on rounded ends. Selection is ink, never vermilion. Text that does not read as a grid shows
 * the parser's first problem instead.
 */
export function GridTable({
  grid,
  jump = null,
  selection = null,
  marks = null,
  flagged = false,
  remedyFits = true,
}: {
  grid: string;
  jump?: RowJump | null;
  selection?: RowSelection | null;
  /** Each row's rule-break numbers (from `breakMarks`), drawn as discs at the start of its act cell. */
  marks?: ReadonlyMap<number, readonly number[]> | null;
  /** A check result is on show: the folded table keeps every row `marks` names as well as the first 12. */
  flagged?: boolean;
  /**
   * Whether the selected break's rows and remedy fit the view together, before the table has measured it
   * (a server render has no view). The browser measures it for each new selection before paint.
   */
  remedyFits?: boolean;
}) {
  const parsed = useMemo(() => parseGrid(grid), [grid]);
  const [all, setAll] = useState(false);
  const [marked, setMarked] = useState<number | null>(null);
  const [handled, setHandled] = useState(0);
  const [handledSelection, setHandledSelection] = useState(0);
  const flaggedView = flagged && marks !== null && marks.size > 0;
  // The rows the folded table shows: the first 12, and with a result on show every flagged row.
  const folded = new Set(
    parsed.ok ? parsed.sets.filter((set, at) => at < TABLE_ROWS || (flaggedView && Boolean(marks?.has(set.row)))).map((set) => set.row) : [],
  );
  const selectionNonce = selection?.nonce ?? 0;
  const selected = new Set(selection?.rows ?? []);
  // A newly selected break shows every row when any row it names is folded away, as state adjusted while rendering.
  if (selectionNonce !== 0 && selectionNonce !== handledSelection) {
    setHandledSelection(selectionNonce);
    if (parsed.ok && parsed.sets.some((set) => selected.has(set.row) && !folded.has(set.row))) setAll(true);
  }
  const tableRef = useRef<HTMLTableElement>(null);
  const jumpNonce = jump?.nonce ?? 0;
  const jumpRow = jump?.row ?? null;
  // A new jump shows every row when its row is folded away and marks it, as state adjusted while rendering.
  if (jumpNonce !== 0 && jumpNonce !== handled && jumpRow !== null) {
    setHandled(jumpNonce);
    setMarked(jumpRow);
    if (parsed.ok && parsed.sets.some((set) => set.row === jumpRow) && !folded.has(jumpRow)) setAll(true);
  }
  useEffect(() => {
    if (jumpNonce === 0 || jumpRow === null) return;
    const row = tableRef.current?.querySelector<HTMLElement>(`[data-row="${jumpRow}"]`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    const timer = window.setTimeout(() => setMarked(null), ROW_MARK_MS);
    return () => window.clearTimeout(timer);
  }, [jumpNonce, jumpRow]);
  // Where the selected break's remedy row goes, measured for each new selection before paint: under the
  // last cited row when the first row's top to the remedy's bottom fits the view below the sticky header
  // (16px above and below), else under the first cited row.
  const [fit, setFit] = useState<{ nonce: number; fits: boolean } | null>(null);
  const fits = fit !== null && fit.nonce === selectionNonce ? fit.fits : remedyFits;
  const scrolledFor = useRef(0);
  useLayoutEffect(() => {
    if (selectionNonce === 0) return;
    const table = tableRef.current;
    const first = table?.querySelector<HTMLElement>("tr[data-selected]");
    if (!table || !first) return;
    const header = stickyHeaderHeight();
    const remedyRow = table.querySelector<HTMLElement>("tr[data-remedy-row]");
    if (remedyRow && fit?.nonce !== selectionNonce) {
      const span = remedyRow.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
      if (span > window.innerHeight - header - 2 * VIEW_EDGE) {
        // Too tall: draw the remedy under the first row instead; this effect runs again for the scroll.
        setFit({ nonce: selectionNonce, fits: false });
        return;
      }
    }
    if (scrolledFor.current === selectionNonce) return;
    scrolledFor.current = selectionNonce;
    // The first cited row's top 16px under the header (no smooth scroll under reduced motion).
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: window.scrollY + first.getBoundingClientRect().top - header - VIEW_EDGE,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [selectionNonce, fit]);
  if (!parsed.ok) {
    return (
      <>
        <p className="px-4 py-4 text-sm leading-relaxed break-words text-muted-foreground">{parsed.errors[0]}</p>
      </>
    );
  }
  const total = parsed.sets.length;
  const long = total > TABLE_ROWS;
  const rows = long && !all ? parsed.sets.filter((set) => folded.has(set.row)) : parsed.sets;
  const lines = foldedLines(parsed.sets, long && !all ? folded : null, flaggedView);
  const stageStarts = stageStartRows(lines);
  // The selected break's rows the table shows, in table order, and the one its remedy row goes under.
  const remedy = selection?.remedy ?? null;
  const cited = rows.filter((set) => selected.has(set.row)).map((set) => set.row);
  const anchor = remedy ? remedyAnchor(cited, fits) : null;
  const others = anchor !== null && !fits ? cited.filter((row) => row !== anchor) : [];
  return (
    <div>
      <div className="px-2 max-sm:px-1">
        <table
          ref={tableRef}
          aria-label="Draft grid as a table"
          className="w-full border-separate border-spacing-0 text-left text-sm leading-5"
        >
          <thead>
            <tr>
              {/* The gutter's header cell: empty to the eye, "Row" to assistive technology. */}
              <th scope="col" className={cn(HEAD_CELL, "w-px pl-2 after:left-2")}>
                <span className="sr-only">Row</span>
              </th>
              {GRID_COLUMNS.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={cn(
                    HEAD_CELL,
                    index === GRID_COLUMNS.length - 1 && cn("pr-2 sm:pr-2 after:right-2", LOCKED_INSET),
                    (column === "Start" || column === "End") && "text-right",
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, at) => {
              if (line.kind === "gap") {
                // A run of rows the folded table leaves out, drawn as an elided row of the ledger: a vertical
                // ellipsis centred in the row-number gutter (decorative), then the plain words set left at the
                // Act column's edge in 13px muted, on the row's own hairlines. Not a control, not focusable.
                // The row's hairline gives way to a stage rule under it, as a grid row's does.
                const after = lines[at + 1];
                const gapBeforeStage = after?.kind === "set" && stageStarts.has(after.set.row);
                return (
                  <tr
                    key={`gap-${line.first}`}
                    data-gap={`${line.first}-${line.last}`}
                    className={cn("group/row", gapBeforeStage && "[&>td]:after:hidden")}
                  >
                    <td className={cn(CELL, FIRST_CELL, "w-px text-center text-[0.8125rem] leading-5 text-muted-foreground max-sm:pr-1.5")}>
                      <span aria-hidden="true">&#x22EE;</span>
                    </td>
                    <td colSpan={TABLE_COLUMNS - 1} className={cn(CELL, LAST_CELL, "text-[0.8125rem] leading-5 text-muted-foreground")}>
                      {gapLabel(line)}
                    </td>
                  </tr>
                );
              }
              const set = line.set;
              const next = lines[at + 1];
              const above = lines[at - 1];
              const on = marked === set.row;
              const picked = selected.has(set.row);
              const edged = picked || on;
              // The shown row right above (no elided row between) carries the ink edge.
              const aboveEdged = above?.kind === "set" && (selected.has(above.set.row) || marked === above.set.row);
              // A new stage starts here: its top separator is the control edge colour, unless an ink edge already
              // separates the two rows. The row right above drops its own hairline so the two never double up.
              const stageTop = stageStarts.has(set.row) && !edged && !aboveEdged;
              const beforeStage = next?.kind === "set" && stageStarts.has(next.set.row);
              // The row just above an elided row keeps its hairline: the elided row is a row of the ledger.
              const numbers = marks?.get(set.row) ?? [];
              const cell = (...classes: Parameters<typeof cn>) => cn(CELL, stageTop && STAGE_RULE, ...classes);
              const row = (
                <tr
                  key={set.row}
                  data-row={set.row}
                  data-selected={picked ? "" : undefined}
                  data-breaks={numbers.length > 0 ? numbers.join(" ") : undefined}
                  data-stage-start={stageTop ? "" : undefined}
                  className={cn(
                    "group/row scroll-mt-24 transition-colors duration-150 ease-out motion-reduce:transition-none",
                    // A selected break's rows, and the row a break pointed at: the wash inside a 1px ink edge drawn
                    // on the cells' own edges (the gutter's too), with the hairlines hidden under it. The pointed-at
                    // row also rounds its ends.
                    edged && "bg-accent [&>td]:border-foreground [&>td]:after:hidden",
                    beforeStage && "[&>td]:after:hidden",
                    on && "[&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md",
                  )}
                >
                  {/* The gutter: the row's grid number as plain text (the number the results cite), ink with the
                      rest of an edged row, and the row's break discs left of it. */}
                  <td
                    className={cell(
                      FIRST_CELL,
                      "w-px text-right font-mono text-xs leading-5 whitespace-nowrap tabular-nums max-sm:pr-1.5",
                      edged ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span className="flex min-w-[max(1rem,3ch)] flex-col items-end gap-1 sm:min-w-[calc(2.5rem+3ch)] sm:flex-row sm:items-start sm:justify-end">
                      {numbers.length > 0 ? (
                        <span className="flex flex-col items-end gap-1 sm:w-9 sm:shrink-0 sm:flex-row sm:flex-wrap sm:justify-end sm:py-0.5">
                          {numbers.map((n) => (
                            <BreakDisc key={n} n={n} size={16} />
                          ))}
                          <span className="sr-only">{numbers.map((n) => `Rule break ${n}.`).join(" ")} </span>
                        </span>
                      ) : null}
                      <span className="min-w-[3ch]">{set.row}</span>
                    </span>
                  </td>
                  <td className={cell("max-w-[14rem] font-semibold break-words")}>{set.act}</td>
                  <td className={cell("break-words text-muted-foreground")}>{set.stage}</td>
                  <td className={cell("text-right font-mono text-[0.8125rem] whitespace-nowrap tabular-nums")}>{formatClock(set.start)}</td>
                  <td className={cell("text-right font-mono text-[0.8125rem] whitespace-nowrap tabular-nums")}>{formatClock(set.end)}</td>
                  <td className={cell(LAST_CELL, LOCKED_INSET, "text-[0.8125rem] whitespace-nowrap text-muted-foreground")}>
                    {set.locked ? (
                      <span className="inline-flex h-5 items-center gap-1 align-top">
                        <Lock aria-hidden="true" className="size-3.5" />
                        Locked
                      </span>
                    ) : (
                      <span className="sr-only">Not locked</span>
                    )}
                  </td>
                </tr>
              );
              if (!remedy || anchor !== set.row) return row;
              return [row, <RemedyRow key={`remedy-${set.row}`} remedy={remedy} others={others} />];
            })}
          </tbody>
        </table>
      </div>
      {long ? (
        // The sheet's footer row: what the table shows and the action
        // that shows the rest, centred on a hairline inset 16px from the sheet's edges.
        <div className="relative flex min-w-0 justify-center px-4 py-3.5">
          <span aria-hidden="true" className="absolute inset-x-4 top-1/2 h-px bg-border" />
          <div className="relative flex min-w-0 flex-wrap items-center justify-center gap-x-1 bg-card px-3 text-center">
            <p className="text-[0.8125rem] text-muted-foreground">
              Showing <span className="font-mono tabular-nums">{rows.length}</span> of{" "}
              <span className="font-mono tabular-nums">{total}</span> rows
              {flaggedView && !all ? `: the first ${TABLE_ROWS} and every flagged row` : null}
            </p>
            <button type="button" className={TEXT_ACTION} aria-expanded={all} onClick={() => setAll((open) => !open)}>
              {all ? "Show fewer rows" : "Show all rows"}
            </button>
          </div>
        </div>
      ) : (
        <div aria-hidden="true" className="h-3" />
      )}
    </div>
  );
}

/**
 * The selected break's remedy, carried by the table beside its rows: one full-width row on the wash with the
 * break's disc, its rule (14px semibold ink) and its Next line exactly as the results print it (a muted
 * "Next: ", then the repair in 14px ink). `others` are the break's other cited rows, printed as plain 12px
 * mono muted text ("row 21 row 26") when the remedy sits under the first row. It repeats words the results
 * hold, so it is hidden from assistive technology; it holds nothing focusable, is not a control and does
 * not print.
 */
function RemedyRow({ remedy, others }: { remedy: Remedy; others: readonly number[] }) {
  return (
    <tr data-remedy-row="" aria-hidden="true" className="print:hidden">
      <td colSpan={TABLE_COLUMNS} className="bg-accent px-2 py-2.5 sm:px-3">
        <span className="flex min-w-0 items-start gap-2">
          {remedy.n !== null ? (
            <span className="flex h-5 shrink-0 items-center">
              <BreakDisc n={remedy.n} size={16} />
            </span>
          ) : null}
          <span className="block min-w-0">
            <span className="block text-sm leading-5 font-semibold break-words text-foreground">{remedy.title}</span>
            {remedy.next ? (
              <span className="mt-0.5 block text-sm leading-5 break-words text-foreground">
                <span className="text-muted-foreground">Next: </span>
                {remedy.next}
              </span>
            ) : null}
            {others.length > 0 ? (
              <span data-remedy-others="" className="mt-0.5 block font-mono text-xs leading-5 text-muted-foreground tabular-nums">
                {others.map((row) => `row ${row}`).join(" ")}
              </span>
            ) : null}
          </span>
        </span>
      </td>
    </tr>
  );
}

/** A line of the table's body: a grid row, or one plain line for a run of rows the folded view leaves out. */
type TableLine = { kind: "set"; set: CheckSet } | { kind: "gap"; first: number; last: number; count: number };

/**
 * The table's lines in source order. With `shown` (the folded view), the rows it leaves out between two
 * shown rows become one gap line each; with `trailing`, so do the rows after the last shown one. With no
 * `shown`, every row.
 */
export function foldedLines(sets: readonly CheckSet[], shown: ReadonlySet<number> | null, trailing: boolean): TableLine[] {
  if (shown === null) return sets.map((set) => ({ kind: "set", set }));
  const lines: TableLine[] = [];
  let hidden: CheckSet[] = [];
  const close = () => {
    if (hidden.length > 0) {
      lines.push({ kind: "gap", first: hidden[0].row, last: hidden[hidden.length - 1].row, count: hidden.length });
    }
    hidden = [];
  };
  for (const set of sets) {
    if (shown.has(set.row)) {
      close();
      lines.push({ kind: "set", set });
    } else {
      hidden.push(set);
    }
  }
  if (trailing) close();
  return lines;
}

/**
 * The shown rows whose stage differs from the shown row above them (an elided row between them is skipped):
 * where the table's separator reads as a group break. The first row has nothing above it.
 */
export function stageStartRows(lines: readonly TableLine[]): Set<number> {
  const starts = new Set<number>();
  let previous: CheckSet | null = null;
  for (const line of lines) {
    if (line.kind !== "set") continue;
    if (previous !== null && previous.stage !== line.set.stage) starts.add(line.set.row);
    previous = line.set;
  }
  return starts;
}

/** "Row 20 not shown", or "Rows 14 to 16 not shown". */
export function gapLabel({ first, last, count }: { first: number; last: number; count: number }): string {
  return count === 1 ? `Row ${first} not shown` : `Rows ${first} to ${last} not shown`;
}

/** Pairs the right column lists before "Show all N". */
export const PREVIEW_PAIRS = 5;

/**
 * The pairs that share time as a ruled list, read like a price list: at the left the first act (stage),
 * the second act (stage) under it and the window in 12px mono; at the right the shared minutes in the
 * condensed display face. Names wrap; nothing is cut off. Five show; "Show all N" opens the rest in
 * place (it stays where it is, so focus stays on it) and "Show fewer" folds them again.
 */
export function SharedPreview({
  shared,
  open,
  onToggle,
}: {
  shared: readonly SharedPair[];
  open: boolean;
  onToggle: () => void;
}) {
  const more = shared.length - PREVIEW_PAIRS;
  const pairs = open ? shared : shared.slice(0, PREVIEW_PAIRS);
  return (
    <>
      <ul className="mt-1 divide-y divide-border border-y border-border">
        {pairs.map((pair) => (
          <li key={pair.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 py-2.5 text-sm leading-5">
            <span className="min-w-0">
              <span className="block font-medium break-words">
                {pair.a.act} <span className="font-normal text-muted-foreground">({pair.a.stage})</span>
              </span>
              <span className="block font-medium break-words">
                <span className="sr-only">and </span>
                {pair.b.act} <span className="font-normal text-muted-foreground">({pair.b.stage})</span>
              </span>
              <span className="mt-0.5 block font-mono text-xs text-muted-foreground tabular-nums">
                {clockWindow(pair.windowStart, pair.windowEnd)}
              </span>
            </span>
            <span className="text-right whitespace-nowrap">
              <span className="type-numeral text-[1.25rem] leading-none">{pair.minutes}</span>
              <span className="ml-1 text-xs text-muted-foreground">min</span>
            </span>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={onToggle} className="mt-3">
          {open ? "Show fewer" : `Show all ${shared.length}`}
        </Button>
      ) : null}
    </>
  );
}

/**
 * One rule break under the verdict: its numbered disc and the rule, its next repair ("Next: ..."), then
 * each row it involves in ascending row order (row number and time in mono, then the act), then `figure`,
 * the break drawn from those rows (the results' `BreakStrip`), under the row lines and on the same
 * condition. With `onSelect`, the rule is the same button as the break's heading in the results: pressed,
 * its rows stay marked in the draft table; the figure does not change with it.
 */
export function BreakItem({
  n,
  rule,
  rows,
  next,
  figure,
  pressed,
  onSelect,
}: {
  n: number;
  rule: string;
  /** The rows the break names, in ascending row order. */
  rows: readonly CheckSet[];
  /** The break's next repair, the same line the results print under its heading (`nextStep`). */
  next: string;
  /** The break drawn from its rows: aria-hidden, print:hidden and holding no control. */
  figure?: ReactNode;
  pressed: boolean;
  onSelect?: () => void;
}) {
  return (
    <li className="py-2.5">
      {onSelect ? (
        <button type="button" aria-pressed={pressed} onClick={onSelect} className={BREAK_HEADING}>
          <BreakDisc n={n} />
          <span className="sr-only">Rule break {n}. </span>
          <span className="text-[0.9375rem] leading-snug">{rule}</span>
          <span className="sr-only">: mark its rows in the draft grid</span>
        </button>
      ) : (
        <p className="flex items-center gap-2 text-[0.9375rem] leading-snug font-semibold">
          <BreakDisc n={n} />
          <span className="sr-only">Rule break {n}. </span>
          {rule}
        </p>
      )}
      {next ? (
        <p className="mt-0.5 pl-7 text-sm leading-5 break-words">
          <span className="text-muted-foreground">Next: </span>
          {next}
        </p>
      ) : null}
      <ul className="mt-1 space-y-0.5 pl-7 text-[0.8125rem] leading-5">
        {rows.map((set) => (
          <li key={set.row} className="grid grid-cols-[3.25rem_6.75rem_minmax(0,1fr)] gap-x-2">
            <span className="font-mono text-muted-foreground tabular-nums">row {set.row}</span>
            <span className="font-mono tabular-nums">{clockWindow(set.start, set.end)}</span>
            <span className="min-w-0 break-words">{set.act}</span>
          </li>
        ))}
      </ul>
      {rows.length > 0 ? figure : null}
    </li>
  );
}

/** The one line under the verdict that ties the list to the table's numbered rows. */
function flaggedLine(count: number): string {
  return count === 1
    ? "Flagged rows are marked 1 in the grid. Select a break to highlight its rows."
    : `Flagged rows are marked 1 to ${count} in the grid. Select a break to highlight its rows.`;
}

/**
 * "What you get": the check's own rule function run on the text as it stands, in the browser, so the
 * right column shows the shape of a result before anything is pressed. On the results surface: the state
 * label (Preview until the text on show is the text last checked, then Checked), the verdict as one
 * sentence, one line that says the table carries the same numbers, the rule breaks themselves (each
 * numbered rule, then its rows), then the pairs that share time, minutes first, five at a time with
 * "Show all N" opening the rest in place. Text that does not read yet shows the outline of a result with
 * no figures in it. Nothing is sent.
 */
function WhatYouGet({
  outcome,
  checked,
  selectedBreak,
  onSelectBreak,
}: {
  /** `runCheck` on the text the table shows: the same breaks, in the same order, as the table's numbers. */
  outcome: CheckOutcome;
  checked: boolean;
  selectedBreak?: string | null;
  onSelectBreak?: (id: string, rows: readonly number[]) => void;
}) {
  const report = outcome.ok ? outcome.report : null;
  const [open, setOpen] = useState(false);
  const byRow = new Map(report?.sets.map((set) => [set.row, set]) ?? []);
  return (
    <section aria-label={checked ? "Checked" : "Preview"} className="border-t border-border pt-5 sm:pt-6">
      <CheckState checked={checked} />
      {checked ? null : (
        <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
          <span className="lg:hidden">From the text above</span>
          <span className="max-lg:hidden">From the text on the left</span>
        </p>
      )}
      {report ? (
        <div className="mt-2">
          <p className="type-title">
            <span className="tabular-nums">{report.breaks.length}</span>{" "}
            {report.breaks.length === 1 ? "rule break" : "rule breaks"} found
          </p>
          {report.breaks.length > 0 ? (
            <>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{flaggedLine(report.breaks.length)}</p>
              <ul aria-label="Rule breaks" className="mt-3 divide-y divide-border border-y border-border">
                {report.breaks.map((item, index) => {
                  const id = breakDecisionId(item, report.sets);
                  return (
                    <BreakItem
                      key={`${item.rule}-${item.rows.join("-")}-${index}`}
                      n={index + 1}
                      rule={RULE_LABELS[item.rule]}
                      rows={rowsInOrder(item.rows).flatMap((row) => byRow.get(row) ?? [])}
                      next={nextStep(item, report)}
                      figure={<BreakStrip item={item} sets={report.sets} settings={report.settings} className="pl-7" />}
                      pressed={selectedBreak === id}
                      onSelect={onSelectBreak ? () => onSelectBreak(id, item.rows) : undefined}
                    />
                  );
                })}
              </ul>
            </>
          ) : null}
          <p className="mt-4 text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
            Sets that share time ({pairCountLabel(report.shared.length)})
          </p>
          {report.shared.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">No two sets on different acts share a minute.</p>
          ) : (
            <SharedPreview shared={report.shared} open={open} onToggle={() => setOpen((current) => !current)} />
          )}
        </div>
      ) : (
        <div aria-hidden="true" className="mt-3 space-y-3">
          <span className="block h-6 w-44 rounded-sm bg-muted" />
          <span className="block h-2.5 w-32 rounded-sm bg-muted" />
          <span className="block h-3 w-4/5 rounded-sm bg-muted" />
          <span className="block h-2.5 w-1/2 rounded-sm bg-muted" />
          <span className="block h-3 w-3/4 rounded-sm bg-muted" />
          <span className="block h-2.5 w-2/5 rounded-sm bg-muted" />
        </div>
      )}
    </section>
  );
}

/** "Pair line 3: ..." errors carry their line; any other error has none. */
export function pairLineOf(error: string): number | null {
  const match = /^Pair line (\d+):/.exec(error);
  return match ? Number(match[1]) : null;
}

/**
 * The fixes offered under one refused pair line, in order: "Remove this rule" first (once per line), then
 * the name the page would use when one act starts with or holds the typed words, then the nearest names
 * only when they are close to what was typed (a typo), never an unrelated act.
 */
export function pairFixes(
  error: string,
  suggestion: PairSuggestion | undefined,
  typed: string | null,
  firstOfLine: boolean,
): { remove: number | null; names: string[] } {
  const line = pairLineOf(error);
  const remove = line !== null && firstOfLine ? line : null;
  if (!suggestion) return { remove, names: [] };
  if (suggestion.match) return { remove, names: [suggestion.match] };
  const names = typed === null ? [] : suggestion.nearest.filter((name) => isCloseName(typed, name));
  return { remove, names };
}

/** What was typed on one side of one pair line, or null when the line is not there. */
export function typedName(pairs: string, line: number, side: 0 | 1): string | null {
  const parts = pairs.split(/\r\n|\r|\n/)[line - 1]?.split("|");
  return parts && parts.length === 2 ? parts[side] : null;
}

function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The check page's one interactive piece. Everything pasted stays in this component's state: no
 * storage and no cookie, and no request until the visitor presses Compare audience overlap (then only the act
 * names and the pairs to price go, through `requestPrice`). Decisions are state too, so they are gone
 * when the tab closes or reloads, and the page says so. A share link carries the grid in its hash,
 * which no request includes.
 */
export function CheckTool({
  initial = EMPTY,
  checkOnLoad = false,
  startWithSample = false,
}: {
  initial?: CheckInput;
  /** Run the check on `initial` at first render (for the server-rendered test; the page never sets it). */
  checkOnLoad?: boolean;
  /**
   * Open with the invented sample in the fields and its results drawn, through the same local check as
   * "Check an invented sample" (labelled as invented; nothing is sent). The page sets this; "Clear"
   * empties everything.
   */
  startWithSample?: boolean;
}) {
  const [input, setInput] = useState<CheckInput>(startWithSample ? SAMPLE_INPUT : initial);
  // The pair lines that came from the invented sample, not from the person (only these are ever removed
  // without a press, and only when a pasted grid replaced the sample and has none of their acts).
  const [sampleRules, setSampleRules] = useState<readonly string[]>(() =>
    startWithSample || isSampleInput(initial) ? SAMPLE_RULES : [],
  );
  // Sample rules removed since the last check: said once, in the results of the next check.
  const removedSince = useRef<string[]>([]);
  // Whether this server prices live; unknown counts as off, so the page never offers what it would refuse.
  const [live, setLive] = useState(false);
  // The published day "Check a published day" offers (none until this app's API names one), and the one loaded.
  const [publishedDay, setPublishedDay] = useState<PublishedDay | null>(null);
  const publishedRef = useRef<PublishedInput | null>(null);
  const [published, setPublished] = useState<PublishedInput | null>(null);
  const [publishedNote, setPublishedNote] = useState("");
  // The invented sample opens as a table; a paste is edited as text.
  const [view, setView] = useState<GridView>(startWithSample ? "table" : "csv");
  // "Clear" switches to the text and focuses it once it is back in view.
  const [focusGrid, setFocusGrid] = useState(0);
  // The preview reads the text a beat behind typing, so a long paste never slows the keyboard.
  const previewInput = useDeferredValue(input);
  // The preview's breaks number the table's rows and the right column's list alike.
  const previewOutcome = useMemo(() => runCheck(previewInput), [previewInput]);
  const marks = useMemo(
    () => (previewOutcome.ok ? breakMarks(previewOutcome.report.breaks) : null),
    [previewOutcome],
  );
  const editingSample = isSampleInput(input);
  const editingPublished = isPublishedInput(input, published);
  const [run, setRun] = useState<Run | null>(() =>
    startWithSample
      ? {
          nonce: 1,
          outcome: runCheck(SAMPLE_INPUT),
          note: "Invented sample loaded. ",
          input: SAMPLE_INPUT,
          sample: true,
          checkedAt: null,
          arrival: true,
        }
      : checkOnLoad
        ? { nonce: 1, outcome: runCheck(initial), note: "", input: initial, sample: isSampleInput(initial), checkedAt: null }
        : null,
  );
  const [decisions, setDecisions] = useState<Decisions>(() => new Map());
  const [showAll, setShowAll] = useState(false);
  const [working, setWorking] = useState<Working | null>(null);
  // What the live region says after a search, a try or a price; blank means the counts of the check.
  const [note, setNote] = useState("");
  const [trial, setTrial] = useState<TrialState | null>(null);
  const [price, setPrice] = useState<PriceState>(IDLE);
  const [priceOrder, setPriceOrder] = useState<PriceOrder>("minutes");
  const [share, setShare] = useState<Share>(null);
  // Targets searched with "Find a change" since the last check, for the draft review.
  const [searched, setSearched] = useState<ReadonlySet<string>>(() => new Set());
  // The brief's small preview is drawn in the browser only (decorative, and not in the server HTML).
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [linkNote, setLinkNote] = useState("");
  // A row a rule break points at: the table view shows it and marks it for two seconds.
  const [rowJump, setRowJump] = useState<RowJump | null>(null);
  // The rule break whose rows stay marked in the table, until another break is chosen or Esc is pressed.
  const [picked, setPicked] = useState<{ id: string; selection: RowSelection } | null>(null);
  const pickCount = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const gridRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const trialHeadingRef = useRef<HTMLHeadingElement>(null);
  const workingRef = useRef<HTMLElement>(null);
  // The search runs a chunk at a time from a timer; a new search, a new check or leaving the page stops it.
  const searchTimer = useRef<number | null>(null);
  const searchToken = useRef(0);
  // The target of the search on show, so a change tried from it can be marked "Changed".
  const searchTarget = useRef<TrialTarget | null>(null);
  // A price request in flight; a new check, a change tried or leaving the page drops its answer.
  const priceAbort = useRef<AbortController | null>(null);
  const ids = {
    grid: useId(),
    gridHelp: useId(),
    privacy: useId(),
    changeover: useId(),
    changeoverHelp: useId(),
    curfew: useId(),
    curfewHelp: useId(),
    pairs: useId(),
    pairsHelp: useId(),
    errors: useId(),
    shareLink: useId(),
  };

  // A share link fills the fields on arrival (or when pasted into this tab's address bar); nothing is
  // checked until the visitor presses Check.
  useEffect(() => {
    const fill = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#g=")) return;
      const fields = readShareHash(hash);
      if (fields) {
        setInput(fields);
        // A link's rules are the sender's own, never the sample's.
        setSampleRules([]);
        removedSince.current = [];
        // The sample the page opened with is not this grid: it gives way rather than showing as stale.
        setRun((current) => (current?.arrival ? null : current));
      }
      setLinkNote(fields ? SHARE_COPY.filled : SHARE_COPY.unreadable);
    };
    fill();
    window.addEventListener("hashchange", fill);
    return () => window.removeEventListener("hashchange", fill);
  }, []);

  useEffect(() => {
    if (focusGrid === 0) return;
    gridRef.current?.focus();
  }, [focusGrid]);

  // Two reads of this app's own API, carrying nothing of the visitor's: whether live pricing is on, and
  // which published day to offer. Neither reaches Qloo; a failure leaves live off and the offer hidden.
  useEffect(() => {
    const controller = new AbortController();
    void priceGridLive(controller.signal).then((on) => {
      if (!controller.signal.aborted) setLive(on);
    });
    void loadPublishedDay(controller.signal).then((day) => {
      if (!controller.signal.aborted) setPublishedDay(day);
    });
    return () => controller.abort();
  }, []);

  // After a check that read the grid, or a change tried on it, the first result heading takes focus.
  useEffect(() => {
    const heading = headingRef.current;
    if (!run?.outcome.ok || !heading || (run.arrival && !working)) return;
    heading.focus({ preventScroll: true });
    // Over a working copy, the notice that says so sits just above the heading and scrolls into view with it.
    (workingRef.current ?? heading).scrollIntoView({ block: "start" });
  }, [run, working]);

  // When a search ends, its result heading takes focus.
  const searchDone = trial?.result ?? null;
  useEffect(() => {
    const heading = trialHeadingRef.current;
    if (!searchDone || !heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "nearest" });
  }, [searchDone]);

  const stopSearch = useCallback(() => {
    searchToken.current += 1;
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = null;
  }, []);

  const dropPrice = useCallback(() => {
    priceAbort.current?.abort();
    priceAbort.current = null;
    setPrice(IDLE);
    setPriceOrder("minutes");
  }, []);

  useEffect(
    () => () => {
      stopSearch();
      priceAbort.current?.abort();
    },
    [stopSearch],
  );

  const check = useCallback(
    (next: CheckInput, note = "") => {
      const outcome = runCheck(next);
      const removed = removedSince.current;
      removedSince.current = [];
      const publishedNow = publishedRef.current;
      stopSearch();
      dropPrice();
      setTrial(null);
      setWorking(null);
      setShare(null);
      setLinkNote("");
      setNote("");
      setShowAll(false);
      setSearched(new Set());
      setPicked(null);
      // A change tried on the last grid is gone with its working copy.
      setDecisions((current) => new Map([...current].filter(([, d]) => d.status !== "changed")));
      setRun((previous) => ({
        nonce: (previous?.nonce ?? 0) + 1,
        outcome,
        note,
        input: next,
        sample: isSampleInput(next),
        checkedAt: nowMinutes(),
        removed,
        published: isPublishedInput(next, publishedNow) && publishedNow ? publishedRunLabel(publishedNow, outcome) : null,
      }));
    },
    [stopSearch, dropPrice],
  );

  // Any edit to the paste or the settings drops the search results on show: they were for the grid
  // as last checked, and nothing is searched, tried or compared until the next check. The results on
  // show keep the provenance of their snapshot (an invented sample stays labelled as one).
  /**
   * Where each pair rule came from, after an edit of one field. A pair line the person typed or changed is
   * theirs from then on. A pasted grid that replaced the invented one drops the invented rules whose acts it
   * does not have (the next check says so) and returns the rules text without them; a rule the person
   * typed is never dropped. Null when the rules text stays as it is. It never touches a result's labels.
   */
  function rulesAfter(field: keyof CheckInput, value: string): string | null {
    if (field === "pairs") setSampleRules((current) => keepSampleRules(value, current));
    if (field !== "grid") return null;
    const drop = dropSampleRules(input.pairs, sampleRules, value);
    if (drop.removed.length === 0) return null;
    removedSince.current = [...removedSince.current, ...drop.removed];
    setSampleRules(drop.sampleRules);
    return drop.pairs;
  }

  function update(field: keyof CheckInput, value: string) {
    stopSearch();
    setTrial(null);
    const pairs = rulesAfter(field, value);
    setInput((current) => ({ ...current, [field]: value, ...(pairs === null ? {} : { pairs }) }));
  }

  /** A rule break's row button: the sheet shows as a table, scrolls to the row and marks it. */
  function jumpToRow(row: number) {
    setView("table");
    setRowJump((current) => ({ row, nonce: (current?.nonce ?? 0) + 1 }));
  }

  /**
   * A rule break's heading: its rows stay marked in the table, with its remedy row beside them; pressed
   * again, they are unmarked. The remedy repeats the break's own rule and Next line: numbered as in the
   * table when the break is one of the table's own (the text on show), else from the results on show with
   * no number.
   */
  function selectBreak(id: string, rows: readonly number[]) {
    if (picked?.id === id) {
      setPicked(null);
      return;
    }
    setView("table");
    pickCount.current += 1;
    setPicked({ id, selection: { rows, nonce: pickCount.current, remedy: remedyOf(id) } });
  }

  function remedyOf(id: string): Remedy | null {
    const sources: [CheckReport | null, boolean][] = [
      [previewOutcome.ok ? previewOutcome.report : null, true],
      [shown, false],
    ];
    for (const [report, numbered] of sources) {
      const at = report ? report.breaks.findIndex((item) => breakDecisionId(item, report.sets) === id) : -1;
      if (!report || at < 0) continue;
      const item = report.breaks[at];
      return { n: numbered ? at + 1 : null, title: RULE_LABELS[item.rule], next: nextStep(item, report) };
    }
    return null;
  }

  // Esc lets go of the selected break's rows.
  const hasPick = picked !== null;
  useEffect(() => {
    if (!hasPick) return;
    const onKey = (event: KeyboardEvent) => {
      if (escapeClears(event)) setPicked(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasPick]);

  function loadSample() {
    setInput(SAMPLE_INPUT);
    setSampleRules(SAMPLE_RULES);
    removedSince.current = [];
    check(SAMPLE_INPUT, "Invented sample loaded. ");
  }

  /**
   * "Check a published day": the day's public timetable from this app's API, with that day's own
   * changeover, curfew and pair rules (never the sample's), checked at once. Nothing is sent to Qloo.
   */
  async function loadPublished() {
    if (!publishedDay) return;
    setPublishedNote("Loading the published timetable.");
    const day = publishedDayInput(await loadPublishedTimetable(publishedDay.id));
    if (!day) {
      setPublishedNote("The published timetable did not load. Your fields are unchanged.");
      return;
    }
    setPublishedNote("");
    publishedRef.current = day;
    setPublished(day);
    setInput(day.input);
    setSampleRules([]);
    removedSince.current = [];
    setView("table");
    check(day.input, "Published timetable loaded. ");
  }

  /** "Clear": empty fields, no results, no marks; the grid field takes focus for a paste. */
  function clearAll() {
    stopSearch();
    dropPrice();
    setInput(EMPTY);
    setSampleRules([]);
    removedSince.current = [];
    setRun(null);
    setTrial(null);
    setWorking(null);
    setShare(null);
    setLinkNote("");
    setNote("");
    setShowAll(false);
    setSearched(new Set());
    setDecisions(new Map());
    setPicked(null);
    if (gutterRef.current) gutterRef.current.scrollTop = 0;
    // The empty field takes focus for a paste, in the text view.
    setView("csv");
    setFocusGrid((count) => count + 1);
  }

  /** "Use it": the pair line takes the suggested name, and the grid is checked again. */
  function applySuggestion(suggestion: PairSuggestion, name: string) {
    const next = { ...input, pairs: replacePairName(input.pairs, suggestion.line, suggestion.side, name) };
    setInput(next);
    setSampleRules((current) => keepSampleRules(next.pairs, current));
    check(next, `Pair line ${suggestion.line} now names ${name}. `);
  }

  /** "Remove this rule": that pair line alone is taken out, and the grid is checked again. */
  function removeRule(line: number) {
    const next = { ...input, pairs: removePairLine(input.pairs, line) };
    setInput(next);
    setSampleRules((current) => keepSampleRules(next.pairs, current));
    check(next, `Pair line ${line} removed. `);
  }

  function decide(id: string, label: string, patch: DecisionPatch) {
    setDecisions((current) => {
      const next = new Map(current);
      if (patch === null) {
        next.delete(id);
        return next;
      }
      const was: Decision = current.get(id) ?? { id, label, status: "kept", reason: null, note: "", change: null };
      next.set(id, { ...was, ...patch });
      return next;
    });
  }

  const outcome = run?.outcome;
  const pasted = outcome?.ok ? outcome.report : null;
  const stale =
    run !== null &&
    (input.grid !== run.input.grid ||
      input.changeover !== run.input.changeover ||
      input.curfew !== run.input.curfew ||
      input.pairs !== run.input.pairs);
  const shown = working?.report ?? pasted;
  /** The text on show is the text last checked, and it read: the right column says Checked, not Preview. */
  const checkedNow = run !== null && Boolean(outcome?.ok) && !stale;
  // A published day loaded here compares its saved day's own ranked clashes; a pasted grid its longest overlaps.
  const request = shown ? priceRequest(shown, run?.published && published ? (published.ranking ?? null) : null) : null;
  /** The grid on show and the settings it was checked with: what the link and the .csv carry. */
  const shownInput: CheckInput | null =
    run && shown ? { ...run.input, grid: working ? gridText(working.report.sets) : run.input.grid } : null;
  const shareHashText = shownInput ? shareHash(shownInput) : "";

  function findChange(target: TrialTarget, label: string) {
    if (!shown || !pasted || stale) return;
    stopSearch();
    const token = searchToken.current;
    const id = targetId(target);
    searchTarget.current = target;
    const steps = trialSteps(shown, target, { span: daySpan(pasted) });
    setTrial({ targetId: id, label, running: true, progress: null, result: null });
    setNote("");
    const tick = () => {
      if (searchToken.current !== token) return;
      const next = steps.next();
      if (next.done) {
        setTrial({ targetId: id, label, running: false, progress: null, result: next.value });
        setSearched((current) => new Set(current).add(id));
        setNote(`${label.replace(/\.$/, "")}. ${next.value.summary}`);
        return;
      }
      setTrial({ targetId: id, label, running: true, progress: next.value, result: null });
      searchTimer.current = window.setTimeout(tick, 0);
    };
    searchTimer.current = window.setTimeout(tick, 0);
  }

  function tryChange(change: TrialChange) {
    if (!shown || stale) return;
    stopSearch();
    dropPrice();
    const target = searchTarget.current;
    const about = target ? targetDecision(shown, target) : null;
    if (about) {
      setDecisions((current) =>
        new Map(current).set(about.id, {
          id: about.id,
          label: about.label,
          status: "changed",
          reason: current.get(about.id)?.reason ?? null,
          note: current.get(about.id)?.note ?? "",
          change: change.lines.join(" and "),
        }),
      );
    }
    const report = applyChange(shown, change);
    setTrial(null);
    setShowAll(false);
    setShare(null);
    setWorking((current) => ({ report, applied: [...(current?.applied ?? []), change] }));
    setNote(`Change applied to a working copy of the grid. ${announcement({ ok: true, report })}`);
  }

  function backToPasted() {
    stopSearch();
    dropPrice();
    setTrial(null);
    setShowAll(false);
    setShare(null);
    setWorking(null);
    setDecisions((current) => new Map([...current].filter(([, d]) => d.status !== "changed")));
    setNote(pasted ? `Back to the pasted grid. ${announcement({ ok: true, report: pasted })}` : "");
  }

  async function priceIt(mode: PriceMode) {
    if (!request || stale || price.phase === "loading") return;
    priceAbort.current?.abort();
    const controller = new AbortController();
    priceAbort.current = controller;
    setPrice({ phase: "loading", mode });
    setNote("");
    const result = await requestPrice(request, mode, controller.signal);
    if (controller.signal.aborted) return;
    priceAbort.current = null;
    if (result.status === "ready") {
      setPrice({ phase: "ready", answer: result.answer });
      setNote(sourceBanner(result.answer));
    } else if (result.status === "not_saved") {
      // Ask the server again whether it prices live before offering it; no answer counts as off.
      const on = await priceGridLive(controller.signal);
      if (controller.signal.aborted) return;
      setLive(on);
      setPrice({ phase: "not_saved" });
      setNote(
        !on ? PRICE_COPY.liveOff : run?.published ? PRICE_COPY.publishedNotSaved : PRICE_COPY.notSaved(request.liveActs.length, request.need),
      );
    } else if (result.status === "refused") {
      setPrice({ phase: "refused", mode, code: result.code, message: result.message });
      setNote(result.message);
    } else {
      setPrice({ phase: "error", mode });
      setNote(PRICE_COPY.error);
    }
  }

  /** The decisions marked "Kept on purpose": Find a change leaves out, by default, a change that ends one. */
  const keptIds = useMemo(
    () => new Set([...decisions.values()].filter((decision) => decision.status === "kept").map((decision) => decision.id)),
    [decisions],
  );

  async function copyLink() {
    if (!shownInput) return;
    const link = `${window.location.origin}${window.location.pathname}${shareHash(shownInput)}`;
    if (!shareable(link)) {
      setShare({ status: "too-long" });
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setShare({ status: "copied", link });
      setNote(SHARE_COPY.copied);
    } catch {
      setShare({ status: "manual", link });
      setNote(SHARE_COPY.manual);
    }
  }

  const trialUi: TrialUi = {
    state: trial,
    stale,
    kept: keptIds,
    onFind: findChange,
    onApply: tryChange,
    onClose: () => {
      stopSearch();
      setTrial(null);
    },
  };

  const listed = shown ? visibleDecisions(decisions, shown) : [];
  /** The printed brief, and its preview: the snapshot on show, with its own provenance. */
  const brief =
    run && shown
      ? {
          report: shown,
          applied: working?.applied ?? [],
          decisions: listed,
          price: price.phase === "ready" ? price.answer : null,
          priceSkipped: request?.skipped ?? [],
          sample: run.sample,
          published: run.published ?? null,
          checkedAt: run.checkedAt,
          stale,
        }
      : null;

  return (
    <div>
      <form
        className="print:hidden"
        onSubmit={(event) => {
          event.preventDefault();
          check(input);
        }}
      >
        {/* One column on a phone: the sheet's name with its two input utilities under it, the sheet (its
            header row of Table / CSV and "Check the grid"), "Clear" on a quiet row under it, the preview and
            the rules, then the notes. From lg the name row (its actions and the privacy line under it) runs over both columns, the sheet and its notes
            run down it, and the preview's top lines up with the sheet's top. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[auto_auto_1fr] lg:gap-x-8 lg:gap-y-0">
          {/* The sheet's name (and, while the invented rows are on show, a plain muted line that says so), then
              the two utilities that fill the sheet, "Download a template" and "Check an invented sample": ghost
              text actions on paper, 20px between their words. From sm they sit at the right end of the name's
              row, their 44px hit areas pulled into its 24px line by negative block margins (10px over and
              under: the 12px under the row keeps them 2px clear of the sheet's frame), their words on the
              name's line. Where the name and its muted line leave too little room (the sheet's column at
              1024, a 640 screen), the pair wraps whole to a line of its own, still set right, 10px under the
              name so no hit area reaches its text; the muted line itself never wraps to make room. On a
              phone they sit on their own lines under the name, set left, before the sheet. */}
          <div className="min-w-0 pb-2 sm:pb-3 lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <div className="flex min-w-0 flex-wrap items-start gap-x-6 sm:gap-y-2.5">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <label htmlFor={ids.grid} className="block text-[0.9375rem] leading-6 font-semibold">
                  Draft grid
                </label>
                {editingSample ? (
                  <span className="text-[0.8125rem] leading-5 text-muted-foreground">Invented sample, to show the format</span>
                ) : editingPublished && published ? (
                  <span className="text-[0.8125rem] leading-5 text-muted-foreground">Published timetable: {published.title}</span>
                ) : null}
              </div>
              <div className="ml-auto flex flex-wrap items-center max-sm:ml-0 sm:-my-2.5 sm:-mr-2">
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(BAR_TEXT_ACTION, "max-sm:-ml-2")}
                  onClick={() => saveFile("clash-control-grid-template.csv", TEMPLATE_CSV, "text/csv")}
                >
                  Download a template
                  <Download aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" className={cn(BAR_TEXT_ACTION, "ml-1 max-sm:-ml-2")} onClick={loadSample}>
                  Check an invented sample
                </Button>
                {publishedDay ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(BAR_TEXT_ACTION, "ml-1 max-sm:-ml-2 max-sm:h-auto max-sm:min-h-11 max-sm:justify-start max-sm:py-2.5 max-sm:text-left max-sm:whitespace-normal")}
                    onClick={() => void loadPublished()}
                  >
                    Check a published day: {publishedDay.title}
                  </Button>
                ) : null}
              </div>
            </div>
            {publishedNote ? (
              <p role="status" className="mt-1 text-sm font-semibold">
                {publishedNote}
              </p>
            ) : null}
            {/* What leaves the browser, said where the paste happens: under the sheet's name, above the field. */}
            <p id={ids.privacy} className="mt-2 flex max-w-5xl items-start gap-2 text-[0.8125rem] leading-5 sm:mt-1.5">
              <Lock aria-hidden="true" className="mt-[3px] size-3.5 shrink-0" />
              <span>{CHECK_COPY.privacy}</span>
            </p>
          </div>
          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            {/* The editor surface: a field in the site's ruled style, marked by its card fill and a 1px
                border-strong rule above and below it (no side edges, no radius), clipped. Its header bar does
                one job, show the grid and check it: the Table / CSV switch at the left (its text in line with
                the table's first column) and "Check the grid" at the right, the bar's one filled control (it
                submits this form), both 44px tall, over a hairline inset 16px, one row from sm. On a phone
                "Check the grid" takes the full width under the switch. No control in the bar is outlined, and
                the source order is the visual order (the switch, then the check). As text: the column names
                run along the top like the timetable's stage headers, and a line-number gutter (decorative,
                kept in step with the scroll) sits left. As a table: the same text read by the check's parser,
                its flagged rows numbered. */}
            <div className="overflow-hidden border-y border-border-strong bg-card has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-ring">
              <div className="relative flex flex-wrap items-center justify-between gap-3 py-2 pr-4 pl-1 lg:gap-2 after:pointer-events-none after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border after:content-['']">
                <SegmentedControl
                  label="Show the draft grid as"
                  value={view}
                  onValueChange={(next) => {
                    setView(next);
                    setRowJump(null);
                  }}
                  options={GRID_VIEWS}
                  size="sm"
                />
                <Button type="submit" className="max-sm:w-full lg:px-4">
                  Check the grid
                </Button>
              </div>
              {view === "table" ? (
                <GridTable
                  grid={input.grid}
                  jump={rowJump}
                  selection={picked?.selection ?? null}
                  marks={marks}
                  flagged={Boolean(run?.outcome.ok)}
                />
              ) : null}
              <div hidden={view !== "csv"}>
                <div aria-hidden="true" className="flex border-b border-border">
                  <span className="w-10 shrink-0 border-r border-border" />
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 px-3 py-2 text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
                    {GRID_COLUMNS.map((column, index) => (
                      <span key={column} className="inline-flex items-center gap-x-2">
                        {index > 0 ? <span>&middot;</span> : null}
                        {column}
                      </span>
                    ))}
                  </p>
                </div>
                <div className="flex">
                  <div
                    ref={gutterRef}
                    aria-hidden="true"
                    className={`w-10 shrink-0 overflow-hidden border-r border-border pt-3 pr-2 pb-8 text-right text-muted-foreground tabular-nums select-none ${GRID_LINE}`}
                  >
                    {Array.from({ length: Math.max(1, input.grid.split("\n").length) }, (_, line) => (
                      <div key={line}>{line + 1}</div>
                    ))}
                  </div>
                  <textarea
                    ref={gridRef}
                    id={ids.grid}
                    value={input.grid}
                    onChange={(event) => update("grid", event.target.value)}
                    onScroll={(event) => {
                      if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    wrap="off"
                    aria-describedby={`${ids.gridHelp} ${ids.privacy}`}
                    placeholder="Example act,Main stage,18:00,19:00"
                    rows={8}
                    className={`block h-40 min-h-36 min-w-0 flex-1 resize-y overflow-auto bg-transparent px-3 py-3 whitespace-pre text-foreground outline-none placeholder:text-muted-foreground sm:h-auto sm:min-h-44 ${GRID_LINE}`}
                  />
                </div>
              </div>
            </div>
            {/* A quiet foot row under the sheet, outside it: "Clear" alone, as a muted text action. */}
            <div className="mt-3 flex">
              <Button
                type="button"
                variant="ghost"
                className="-ml-2 min-h-11 px-2 font-normal text-muted-foreground decoration-1 underline-offset-4 hover:bg-transparent hover:text-foreground hover:underline"
                onClick={clearAll}
              >
                Clear
              </Button>
            </div>
            {outcome && !outcome.ok ? (
              <div
                id={ids.errors}
                role="alert"
                className="mt-4 rounded-md border-[1.5px] border-destructive bg-card p-4 text-sm leading-relaxed"
              >
                <p className="flex items-center gap-2 font-semibold">
                  <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />
                  The grid was not checked.
                </p>
                <ul className="mt-2 list-disc space-y-2 pl-5 break-words">
                  {outcome.errors.map((error, index) => {
                    const suggestion = outcome.suggestions.find((item) => item.message === error);
                    const line = pairLineOf(error);
                    const firstOfLine = line !== null && outcome.errors.findIndex((other) => pairLineOf(other) === line) === index;
                    const typed = suggestion ? typedName(input.pairs, suggestion.line, suggestion.side) : null;
                    const { remove, names } = pairFixes(error, suggestion, typed, firstOfLine);
                    return (
                      <li key={index}>
                        {error}
                        {remove !== null || (suggestion && names.length > 0) ? (
                          <span className="mt-1.5 flex flex-wrap gap-2">
                            {remove !== null ? (
                              <Button type="button" variant="outline" size="sm" onClick={() => removeRule(remove)}>
                                Remove this rule
                                <span className="sr-only">: pair line {remove}</span>
                              </Button>
                            ) : null}
                            {suggestion ? names.map((name) => (
                              <Button
                                key={name}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => applySuggestion(suggestion, name)}
                              >
                                {suggestion.match ? "Use it" : `Use “${name}”`}
                                {suggestion.match ? (
                                  <span className="sr-only">
                                    : {name} on pair line {suggestion.line}
                                  </span>
                                ) : null}
                              </Button>
                            )) : null}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:self-start">
            <WhatYouGet
              outcome={previewOutcome}
              checked={checkedNow}
              selectedBreak={picked?.id ?? null}
              onSelectBreak={selectBreak}
            />
            <RuledDetails
              summary="Rules this check applies"
              hint={rulesHint(input)}
              className="border-b border-b-border-strong"
            >
            <div className="space-y-5 pb-5">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div>
                <label htmlFor={ids.changeover} className="block text-[0.8125rem] leading-5 font-semibold">
                  Changeover (minutes)
                </label>
                <input
                  id={ids.changeover}
                  type="text"
                  inputMode="numeric"
                  value={input.changeover}
                  onChange={(event) => update("changeover", event.target.value)}
                  autoComplete="off"
                  aria-describedby={ids.changeoverHelp}
                  className={`${FIELD} h-11 font-mono`}
                />
                <p id={ids.changeoverHelp} className="mt-1.5 text-xs leading-snug text-muted-foreground">
                  The least gap between two sets on a stage. Blank means {CHECK_LIMITS.defaultChangeover}.
                </p>
              </div>
              <div>
                <label htmlFor={ids.curfew} className="block text-[0.8125rem] leading-5 font-semibold">
                  Curfew (latest end)
                </label>
                <input
                  id={ids.curfew}
                  type="text"
                  value={input.curfew}
                  onChange={(event) => update("curfew", event.target.value)}
                  autoComplete="off"
                  aria-describedby={ids.curfewHelp}
                  className={`${FIELD} h-11 font-mono`}
                />
                <p id={ids.curfewHelp} className="mt-1.5 text-xs leading-snug text-muted-foreground">
                  Blank means none. Times before 06:00 read as after midnight, so 00:00 is midnight.
                </p>
              </div>
            </div>
            <div>
              <label htmlFor={ids.pairs} className="block text-[0.8125rem] leading-5 font-semibold">
                Pairs that must never overlap
              </label>
              <textarea
                id={ids.pairs}
                value={input.pairs}
                onChange={(event) => update("pairs", event.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder="Act A | Act B"
                aria-describedby={ids.pairsHelp}
                rows={4}
                className={`${FIELD} min-h-28 resize-y p-3 font-mono text-sm leading-relaxed`}
              />
              <p id={ids.pairsHelp} className="mt-1.5 text-xs leading-snug text-muted-foreground">
                One pair per line, with the names as written in the grid. A short or misspelt name is
                not guessed: the page offers the name it would use, and you confirm it.
              </p>
            </div>
            </div>
            </RuledDetails>
          </div>

          <div className="min-w-0 lg:col-start-1 lg:row-start-3 lg:pt-4">
            <p id={ids.gridHelp} className="mt-1 text-sm leading-relaxed text-muted-foreground">
              One set per line: act, stage, start, end, and optionally locked. CSV or tabs; up to{" "}
              {CHECK_LIMITS.sets} sets, {CHECK_LIMITS.stages} stages and 8 KB. Write after-midnight times
              as 24:30 or later.
            </p>
            <RuledDetails summary="Format and midnight examples" className="mt-3 text-sm leading-relaxed text-muted-foreground">
              <p className="pb-3">
                With a header row, the columns can come in any order, a day column is read (one day at a
                time) and other columns are ignored. Times as 18:00, 6:00 PM or 6pm; after midnight also
                as 12:30 AM. A set that ends before 06:00 and before it starts is read as ending the next
                day.
              </p>
            </RuledDetails>
            {linkNote ? (
              <p role="status" className="mt-3 text-sm font-semibold">
                {linkNote}
              </p>
            ) : null}
          </div>
        </div>
      </form>

      <p role="status" aria-live="polite" className="sr-only">
        {run && outcome?.ok ? note || `${run.note}${(run.removed ?? []).map((notice) => `${notice} `).join("")}${announcement(outcome)}` : ""}
      </p>

      {run && outcome?.ok && shown ? (
        <>
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="min-w-0 space-y-5">
              <div className="print:hidden">
                <CheckState checked />
              </div>
              {run.sample ? (
                <p className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm font-semibold text-foreground print:hidden">
                  {SAMPLE_LABEL}
                </p>
              ) : null}
              {run.published ? <p className="text-sm leading-relaxed font-semibold text-foreground print:hidden">{run.published}</p> : null}
              {run.removed && run.removed.length > 0 ? (
                <div className="space-y-1 print:hidden">
                  {run.removed.map((notice) => (
                    <p key={notice} className="text-sm leading-relaxed break-words text-foreground">
                      {notice}
                    </p>
                  ))}
                </div>
              ) : null}
              {working ? (
                <section
                  ref={workingRef}
                  aria-label="Working copy"
                  className="scroll-mt-24 rounded-lg border-2 border-dashed border-foreground bg-card p-5 sm:p-6 print:hidden"
                >
                  <p className="font-semibold">{workingLabel(working.applied.length)}</p>
                  <ul className="mt-2 space-y-1 text-sm break-words">
                    {working.applied.flatMap((change, at) =>
                      change.moves.map((move, index) => (
                        <li key={`${at}-${move.row}`}>
                          {change.lines[index]} <span className="text-muted-foreground">(was {wasPlace(move)})</span>
                        </li>
                      )),
                    )}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button type="button" variant="outline" onClick={backToPasted}>
                      {TRIAL_COPY.back}
                    </Button>
                  </div>
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold">
                      Working grid as text
                    </summary>
                    <textarea
                      readOnly
                      value={gridText(working.report.sets)}
                      rows={Math.min(14, working.report.sets.length + 2)}
                      spellCheck={false}
                      aria-label="Working grid as text, to copy"
                      className={`${FIELD} resize-y p-3 font-mono text-sm leading-relaxed`}
                    />
                  </details>
                </section>
              ) : null}
              {/* Always in the page, so the line is announced when it appears: the results below it are for the grid as last checked. */}
              <div role="status" className="empty:hidden print:hidden">
                {stale ? <p className="text-sm font-semibold text-warning">{TRIAL_COPY.stale}</p> : null}
              </div>
              <CheckResults
                report={shown}
                decisions={decisions}
                onDecide={decide}
                showAll={showAll}
                onShowAll={setShowAll}
                nonce={run.nonce * 1000 + (working?.applied.length ?? 0)}
                headingRef={headingRef}
                trial={trialUi}
                trialHeadingRef={trialHeadingRef}
                onRow={jumpToRow}
                selectedBreak={picked?.id ?? null}
                onSelectBreak={selectBreak}
                numbered={!working && !stale}
                between={
                  <CheckPrice
                    request={request}
                    noOverlap={shown.shared.length === 0}
                    state={price}
                    order={priceOrder}
                    onOrder={setPriceOrder}
                    onPrice={(mode) => void priceIt(mode)}
                    stale={stale}
                    live={live}
                    published={Boolean(run.published)}
                  />
                }
                after={
                  // Shown once something is marked; the printed brief always carries the count, even at 0.
                  listed.length > 0 ? (
                    <section aria-labelledby="check-decisions-heading" className="rounded-lg border border-surface-edge bg-card p-5 sm:p-6 print:hidden">
                      <h2 id="check-decisions-heading" className="type-title">
                        {DECISION_COPY.heading} ({listed.length})
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">{DECISION_COPY.lead}</p>
                      <DecisionList decisions={listed} onDecide={decide} />
                    </section>
                  ) : null
                }
              />
            </div>

            <div className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain">
              <CheckReview
                counts={reviewCounts(shown, decisions)}
                sample={run.sample}
                price={price}
                searched={searched.size}
                applied={working?.applied.length ?? 0}
                stale={stale}
                onPrint={() => window.print()}
                onCopy={() => void copyLink()}
                onDownload={() => saveFile(csvName({ sample: run.sample }), gridText(shown.sets), "text/csv")}
                canShare={shareable(shareHashText)}
                share={
                  <>
                    {shareable(shareHashText) && share === null ? <p className="text-muted-foreground">{SHARE_COPY.warning}</p> : null}
                    {!shareable(shareHashText) || share?.status === "too-long" ? <p className="font-semibold">{SHARE_COPY.tooLong}</p> : null}
                    {share && share.status !== "too-long" ? (
                      <>
                        <p className="font-semibold">{share.status === "copied" ? SHARE_COPY.copied : SHARE_COPY.manual}</p>
                        <input
                          type="text"
                          readOnly
                          value={share.link}
                          aria-label={SHARE_COPY.linkLabel}
                          onFocus={(event) => event.currentTarget.select()}
                          className={`${FIELD} h-10 font-mono text-xs`}
                        />
                      </>
                    ) : null}
                  </>
                }
                preview={mounted && brief ? <CheckBrief {...brief} preview /> : null}
              />
            </div>
          </div>

          {brief ? <CheckBrief {...brief} /> : null}
        </>
      ) : null}
    </div>
  );
}
