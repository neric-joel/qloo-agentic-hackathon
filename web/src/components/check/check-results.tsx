"use client";

import { useId, useRef, useState, type ReactNode, type Ref } from "react";

import {
  CHECK_COPY,
  RULE_LABELS,
  clockWindow,
  formatClock,
  minutesLabel,
  pairCountLabel,
  type CheckReport,
  type RuleBreak,
  type SharedPair,
} from "@/lib/check";
import { breakDecisionId, pairDecisionId, pairLabel, type Decision, type Decisions } from "@/lib/check-decisions";
import { PRICE_COPY } from "@/lib/check-price";
import { targetOfBreak, targetOfPair, type TrialTarget } from "@/lib/check-trial";
import { cn } from "@/lib/utils";

import { BreakStrip, rowsInOrder } from "./check-break-strip";
import { DecisionBadge, DecisionEditor, DecisionToggles, ROW_BUTTON, type DecideFn } from "./check-decision";
import { TrialButton, TrialResult, type TrialUi } from "./check-trial-panel";

/** Pairs listed before "Show all"; the heading always carries the total. */
export const SHARED_SHOWN = 5;

/** Under a pair whose two sets are both locked, in place of "Find a change": a lock says a set cannot move. */
export const BOTH_LOCKED = "Both sets are locked, so this search would not move them.";

/** What a pair's locks say after its window: " (both are locked).", " (one is locked)." or ".". */
export function lockNote(pair: Pick<SharedPair, "a" | "b">): string {
  if (pair.a.locked && pair.b.locked) return " (both are locked).";
  return pair.a.locked || pair.b.locked ? " (one is locked)." : ".";
}

/** Ids of the result sections, for the jump links above them and in the draft review. */
export const RESULT_IDS = {
  rules: "check-rules-heading",
  price: "check-price-heading",
  shared: "check-shared-heading",
  review: "check-review",
} as const;

type Props = {
  report: CheckReport;
  /** The decisions made in this tab, by break or pair id. */
  decisions: Decisions;
  onDecide: DecideFn;
  showAll: boolean;
  onShowAll: (showAll: boolean) => void;
  /** Changes with every check, so the sections reveal again (the reveal is skipped under reduced motion). */
  nonce: number;
  /**
   * Drawn in place with no reveal: the results the page opens with, which no press caused (motion answers a
   * visitor's action, never the first paint).
   */
  still?: boolean;
  /** The first heading, which takes focus after a check. */
  headingRef?: Ref<HTMLHeadingElement>;
  /** "Find a change" for each break and each pair; left out, the results carry no search. */
  trial?: TrialUi;
  /** The heading of a search result, which takes focus when a search ends. */
  trialHeadingRef?: Ref<HTMLHeadingElement>;
  /** Drawn between the rule breaks and the pairs: the optional audience step, reached before the long list. */
  between?: ReactNode;
  /** Drawn after the pairs, before the closing paragraph: the list of decisions. */
  after?: ReactNode;
  /**
   * One line under the count of sets that share time, saying why it differs from the count the home page
   * ranks (a published day loaded here, when its saved counts add up to this count); null for none.
   */
  countNote?: string | null;
  /** A rule break's row button: show that grid row. Left out, the rows are plain text. */
  onRow?: (row: number) => void;
  /** The break whose rows stay marked in the draft table, by its decision id. */
  selectedBreak?: string | null;
  /** A break's heading button: mark every row it names in the draft table (again: unmark them). */
  onSelectBreak?: (id: string, rows: readonly number[]) => void;
  /**
   * Each break's heading starts with its number (1..N), the number its rows carry in the draft table.
   * The page turns it off while the table shows other text than these results (an edit since the check,
   * or a working copy), so a number never points at the wrong row.
   */
  numbered?: boolean;
};

// A break's rows in ascending row order, for display (defined beside the strip, which lays its lanes out in it).
export { rowsInOrder };

/** "rows 17 and 21", "rows 3, 4 and 9", "row 12": in ascending row order. */
function rowList(rows: readonly number[]): string {
  const ordered = rowsInOrder(rows);
  if (ordered.length === 1) return `row ${ordered[0]}`;
  return `rows ${ordered.slice(0, -1).join(", ")} and ${ordered[ordered.length - 1]}`;
}

/**
 * The next repair for a rule break, as one line built only from the rows the break names: no new
 * checking, no new figure. "Move one of rows 17 and 21 to another time".
 */
export function repairLine(item: Pick<RuleBreak, "rule" | "rows">): string {
  const rows = item.rows;
  if (rows.length === 0) return "";
  if (rows.length === 1) {
    return item.rule === 4 ? `Move row ${rows[0]} earlier so it ends by the curfew` : `Move row ${rows[0]} to another time`;
  }
  const [first, second] = rows;
  switch (item.rule) {
    case 2:
      return `Move one of ${rowList(rows)} to another time or stage`;
    case 3:
      return rows.length === 2
        ? `Start row ${second} later or end row ${first} earlier`
        : `Leave more time between ${rowList(rows)}`;
    case 4:
      return `Move ${rowList(rows)} earlier so they end by the curfew`;
    default:
      return `Move one of ${rowList(rows)} to another time`;
  }
}

/**
 * The next repair in words, naming the acts on the rows the break lists (and the curfew the check read):
 * "End Rustic Harbour by the 00:00 curfew". Built only from the break and the sets it names; when a row
 * cannot be found it falls back to `repairLine`, which names the rows.
 */
export function nextStep(item: Pick<RuleBreak, "rule" | "rows">, report: Pick<CheckReport, "sets" | "settings">): string {
  const acts = item.rows.map((row) => report.sets.find((set) => set.row === row)?.act);
  if (acts.length === 0 || acts.some((act) => act === undefined)) return repairLine(item);
  const [first, second] = acts as string[];
  const curfew = report.settings.curfew;
  switch (item.rule) {
    case 1:
      return `Move one ${first} set to another time`;
    case 2:
      return second !== undefined ? `Move ${first} or ${second} to another time or stage` : repairLine(item);
    case 3:
      return second !== undefined ? `Start ${second} later or end ${first} earlier` : repairLine(item);
    case 4:
      if (curfew === null) return repairLine(item);
      return acts.length === 1
        ? `End ${first} by the ${formatClock(curfew)} curfew`
        : `End ${acts.slice(0, -1).join(", ")} and ${acts[acts.length - 1]} by the ${formatClock(curfew)} curfew`;
    case 5:
      return second !== undefined ? `Move ${first} or ${second} so the two no longer share time` : repairLine(item);
    default:
      return repairLine(item);
  }
}

/**
 * A row reference as a button: "row 21" in 12px mono on the 6px label corner with a control edge, its hit
 * area stretched to 44px above and below. It shows that row in the draft table.
 */
const ROW_REF =
  "relative inline-flex h-7 items-center rounded-sm border border-border-strong px-1.5 font-mono text-xs text-foreground tabular-nums transition-colors duration-150 ease-out after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none";

/**
 * A break's heading as a button: pressed, every row the break names stays marked in the draft table.
 * The heading keeps its type and starts with the break's numbered disc; the press shows as the wash
 * with a 2px ink outline (the focus ring takes its place while the button has keyboard focus). Never
 * raspberry: a rule break is not shared time.
 */
export const BREAK_HEADING =
  "-mx-1.5 inline-flex min-h-11 max-w-full items-center gap-2 rounded-md px-1.5 text-left text-base leading-6 font-semibold transition-colors duration-150 ease-out hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-accent aria-pressed:not-focus-visible:outline-2 aria-pressed:not-focus-visible:outline-offset-0 aria-pressed:not-focus-visible:outline-foreground motion-reduce:transition-none";

/**
 * A rule break's number as an ink disc with the number in paper, drawn as inline SVG: 20px beside a
 * break's heading, 16px at the start of each grid row the break names. A rule break is ink with its
 * number and words, never the raspberry of shared time. Decorative: the heading and the row say "Rule
 * break N." to assistive technology in words.
 */
export function BreakDisc({ n, size = 20 }: { n: number; size?: 16 | 20 }) {
  const r = size / 2;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-break-disc={n}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="inline-block shrink-0 align-middle"
    >
      <circle cx={r} cy={r} r={r} fill="var(--foreground)" />
      <text
        x={r}
        y={r}
        dy="0.35em"
        textAnchor="middle"
        fill="var(--background)"
        fontSize={size === 20 ? 11 : 10}
        fontWeight={700}
        className="font-mono tabular-nums"
      >
        {n}
      </text>
    </svg>
  );
}

/** Each grid row's rule-break numbers, 1..N in the order the breaks are listed; a row in two breaks has both. */
export function breakMarks(breaks: readonly Pick<RuleBreak, "rows">[]): Map<number, number[]> {
  const marks = new Map<number, number[]>();
  breaks.forEach((item, index) => {
    for (const row of item.rows) {
      const list = marks.get(row) ?? [];
      if (!list.includes(index + 1)) list.push(index + 1);
      marks.set(row, list);
    }
  });
  return marks;
}

/**
 * A result section: open on paper under one 1px hairline, as the home page's receipt (findings sit open;
 * only the surfaces you type or decide within keep a box). Print is unchanged.
 */
const PANEL = "border-t border-border pt-5 sm:pt-6 print:rounded-none print:border-0 print:p-0";
const JUMP =
  "inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-[0.8125rem] font-semibold text-muted-foreground hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The check's state as one plain 13px muted label: "Preview" before a check (or once the text has
 * changed since it), "Checked" after it. The word carries the state; no glyph repeats it.
 */
export function CheckState({ checked }: { checked: boolean }) {
  return <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">{checked ? "Checked" : "Preview"}</p>;
}

/**
 * One finding's controls. Undecided: its text, then the two decisions and "Find a change" on one line.
 * Decided: one line ("Kept on purpose · Contract", Edit, Find a change), so the list gets shorter as
 * the programmer decides; Edit opens the decision, its reason and its note again. A search result is
 * drawn under the row either way.
 */
function FindingRow({
  id,
  label,
  name,
  decision,
  onDecide,
  editing,
  onEditing,
  target,
  trial,
  trialHeadingRef,
  compact,
  extra,
  children,
}: {
  id: string;
  label: string;
  name: string;
  decision: Decision | undefined;
  onDecide: DecideFn;
  editing: boolean;
  onEditing: (open: boolean) => void;
  target: TrialTarget;
  trial?: TrialUi;
  trialHeadingRef?: Ref<HTMLHeadingElement>;
  /** The one-line text of the decided row. */
  compact: ReactNode;
  /** Shown above the reason while the decided row is open. */
  extra?: ReactNode;
  children: ReactNode;
}) {
  const editId = useId();
  const row = useRef<HTMLDivElement>(null);
  const collapsed = decision !== undefined && !editing;

  function open() {
    onEditing(true);
    window.setTimeout(() => {
      row.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"], button')?.focus();
    }, 0);
  }
  function done() {
    onEditing(false);
    window.setTimeout(() => document.getElementById(editId)?.focus(), 0);
  }

  return (
    <div ref={row}>
      {collapsed ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-[1_1_16rem] text-sm font-semibold break-words text-muted-foreground">{compact}</p>
          <DecisionBadge decision={decision} />
          <div className="flex flex-wrap gap-2 print:hidden">
            <button id={editId} type="button" aria-expanded={false} onClick={open} className={ROW_BUTTON}>
              Edit<span className="sr-only">: your decision on {name}</span>
            </button>
            {trial ? <TrialButton target={target} label={name} ui={trial} className={ROW_BUTTON} /> : null}
          </div>
          {decision.note ? (
            <p className="basis-full text-sm break-words text-muted-foreground">
              <span className="sr-only">Note: </span>“{decision.note}”
            </p>
          ) : null}
          {extra ? <div className="basis-full">{extra}</div> : null}
        </div>
      ) : (
        <>
          {children}
          {/* One control line from `sm` up: the two decisions, a rule, Find a change. Below it the two
              decisions share a row and Find a change takes the next; the DOM order is the same. */}
          <div className="mt-2 flex flex-wrap items-center gap-2 print:hidden">
            <DecisionToggles id={id} label={label} name={name} decision={decision} onDecide={onDecide} />
            {trial ? (
              <>
                <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border sm:block" />
                <TrialButton target={target} label={name} ui={trial} className={cn(ROW_BUTTON, "max-sm:basis-full max-sm:justify-center")} />
              </>
            ) : null}
          </div>
          {decision ? (
            <div className="mt-2.5 space-y-2 rounded-md bg-background p-3 print:hidden">
              {extra}
              <DecisionEditor decision={decision} name={name} onDecide={onDecide} />
              <button type="button" onClick={done} className={ROW_BUTTON}>
                Done<span className="sr-only">: {name}</span>
              </button>
            </div>
          ) : null}
        </>
      )}
      {trial ? <TrialResult target={target} ui={trial} headingRef={trialHeadingRef} /> : null}
    </div>
  );
}

export function CheckResults({
  report,
  decisions,
  onDecide,
  showAll,
  onShowAll,
  nonce,
  still = false,
  headingRef,
  trial,
  trialHeadingRef,
  between,
  after,
  countNote = null,
  onRow,
  selectedBreak = null,
  onSelectBreak,
  numbered = true,
}: Props) {
  const { breaks, shared, sets, stages, lockedCount } = report;
  // The one decided row left open; marking another row opens that one and folds this one away.
  const [editing, setEditing] = useState<string | null>(null);
  const shown = showAll ? shared : shared.slice(0, SHARED_SHOWN);
  const breakPairs = new Set(
    breaks
      .filter((b) => b.rule === 5)
      .map((b) => b.rows.slice().sort((x, y) => x - y).join("-")),
  );

  const decide: DecideFn = (id, label, patch) => {
    onDecide(id, label, patch);
    if (patch === null) setEditing((current) => (current === id ? null : current));
    else if (patch.status) setEditing(id);
  };
  const editingOf = (id: string) => ({
    editing: editing === id,
    onEditing: (open: boolean) => setEditing(open ? id : null),
  });

  return (
    <div className="space-y-5 print:hidden">
      {report.notes.map((note) => (
        <p key={note} className="text-sm break-words text-muted-foreground">
          {note}
        </p>
      ))}
      <div>
        <p className="text-sm text-muted-foreground">
          Read {sets.length} {sets.length === 1 ? "set" : "sets"} on {stages.length}{" "}
          {stages.length === 1 ? "stage" : "stages"}
          {lockedCount > 0
            ? `; ${lockedCount} marked locked. Locked sets are still checked against your rules; they are only kept in place when you search for a change.`
            : "."}
        </p>
        <nav aria-label="Results" className="mt-3 flex flex-wrap gap-2">
          <a href={`#${RESULT_IDS.rules}`} className={JUMP}>
            Rule breaks <span className="type-numeral text-base text-foreground">{breaks.length}</span>
          </a>
          {between ? (
            <a href={`#${RESULT_IDS.price}`} className={cn(JUMP, "text-foreground")}>
              {PRICE_COPY.button} <span aria-hidden="true">↓</span>
            </a>
          ) : null}
          <a href={`#${RESULT_IDS.shared}`} className={JUMP}>
            Sets that share time <span className="type-numeral text-base text-foreground">{shared.length}</span>
          </a>
          <a href={`#${RESULT_IDS.review}`} className={cn(JUMP, "lg:hidden")}>
            Draft review <span aria-hidden="true">↓</span>
          </a>
        </nav>
      </div>

      <section key={`rules-${nonce}`} aria-labelledby={RESULT_IDS.rules} className={cn(PANEL, !still && "cc-check-rules")}>
        <h2 id={RESULT_IDS.rules} ref={headingRef} tabIndex={-1} className="type-title scroll-mt-24 outline-offset-4 print:text-[13pt] print:outline-none">
          Rule breaks ({breaks.length})
        </h2>
        {breaks.length === 0 ? (
          <p className="mt-3">{CHECK_COPY.noBreaks}</p>
        ) : (
          <ol className="mt-3 divide-y divide-border border-t border-border print:mt-[4pt] print:divide-y-0 print:border-0">
            {breaks.map((item, index) => {
              const id = breakDecisionId(item, sets);
              const decision = decisions.get(id);
              const folded = decision !== undefined && editing !== id;
              return (
                <li
                  key={`${item.rule}-${item.rows.join("-")}-${index}`}
                  data-folded={folded ? "" : undefined}
                  className="break-inside-avoid py-3.5 last:pb-0 print:py-[2pt]"
                >
                  <FindingRow
                    id={id}
                    label={item.text}
                    name={item.text}
                    decision={decision}
                    onDecide={decide}
                    {...editingOf(id)}
                    target={targetOfBreak(item)}
                    trial={trial}
                    trialHeadingRef={trialHeadingRef}
                    compact={item.text}
                  >
                    {/* The repair hierarchy: the numbered rule, the next repair, what broke it, then the rows to look at. */}
                    <h3 className="text-base leading-6 font-semibold">
                      {onSelectBreak ? (
                        <button
                          type="button"
                          aria-pressed={selectedBreak === id}
                          onClick={() => onSelectBreak(id, item.rows)}
                          className={BREAK_HEADING}
                        >
                          {numbered ? (
                            <>
                              <BreakDisc n={index + 1} />
                              <span className="sr-only">Rule break {index + 1}. </span>
                            </>
                          ) : null}
                          {RULE_LABELS[item.rule]}
                          <span className="sr-only">: mark its rows in the draft grid</span>
                        </button>
                      ) : numbered ? (
                        <span className="inline-flex max-w-full items-center gap-2">
                          <BreakDisc n={index + 1} />
                          <span className="sr-only">Rule break {index + 1}. </span>
                          {RULE_LABELS[item.rule]}
                        </span>
                      ) : (
                        RULE_LABELS[item.rule]
                      )}
                    </h3>
                    {nextStep(item, report) ? (
                      <p className="mt-1 text-sm font-semibold break-words">
                        <span className="text-muted-foreground">Next: </span>
                        {nextStep(item, report)}
                      </p>
                    ) : null}
                    <p className="mt-2 text-[0.9375rem] break-words">{item.text}</p>
                    <p className="mt-0.5 text-sm break-words text-muted-foreground">{item.detail}</p>
                    {onRow && item.rows.length > 0 ? (
                      <>
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 py-2 print:hidden">
                          <span className="sr-only">Show in the grid: </span>
                          {rowsInOrder(item.rows).map((row) => (
                            <button key={row} type="button" className={ROW_REF} onClick={() => onRow(row)}>
                              row {row}
                            </button>
                          ))}
                        </p>
                        {/* The break drawn from its rows, under the references and on the same condition. */}
                        <BreakStrip item={item} sets={sets} settings={report.settings} />
                      </>
                    ) : null}
                  </FindingRow>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {between}

      <section key={`shared-${nonce}`} aria-labelledby={RESULT_IDS.shared} className={cn(PANEL, !still && "cc-check-shared")}>
        <h2 id={RESULT_IDS.shared} className="type-title scroll-mt-24 print:text-[13pt]">
          Sets that share time ({pairCountLabel(shared.length)})
        </h2>
        {countNote ? <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground">{countNote}</p> : null}
        {shared.length === 0 ? (
          <p className="mt-3">No two sets on different acts share a minute.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Longest first. A decision under a pair or a break is yours: it changes no figure, never
              removes a rule break above, and prints in the brief under “Your decisions”.
            </p>
            <ul className="mt-4 divide-y divide-border print:mt-[4pt] print:divide-y-0">
              {shown.map((pair) => (
                <li key={pair.id} className="break-inside-avoid py-2.5 first:pt-0 last:pb-0 print:py-[1.5pt]">
                  <SharedRow
                    pair={pair}
                    decisions={decisions}
                    isBreak={breakPairs.has([pair.a.row, pair.b.row].sort((x, y) => x - y).join("-"))}
                    onDecide={decide}
                    editingOf={editingOf}
                    trial={trial}
                    trialHeadingRef={trialHeadingRef}
                  />
                </li>
              ))}
            </ul>
            {shared.length > SHARED_SHOWN ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => onShowAll(!showAll)}
                  aria-expanded={showAll}
                  className="min-h-11 rounded-md border-[1.5px] border-foreground px-4 text-sm font-semibold transition-colors duration-150 ease-out hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring print:hidden"
                >
                  {showAll ? `Show the ${SHARED_SHOWN} longest` : `Show all ${shared.length}`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {after}

      <p className="max-w-prose text-[0.9375rem] leading-relaxed">{CHECK_COPY.elsewhere}</p>
    </div>
  );
}

function SharedRow({
  pair,
  decisions,
  isBreak,
  onDecide,
  editingOf,
  trial,
  trialHeadingRef,
}: {
  pair: SharedPair;
  decisions: Decisions;
  isBreak: boolean;
  onDecide: DecideFn;
  editingOf: (id: string) => { editing: boolean; onEditing: (open: boolean) => void };
  trial?: TrialUi;
  trialHeadingRef?: Ref<HTMLHeadingElement>;
}) {
  const names = `${pair.a.act} and ${pair.b.act}`;
  const id = pairDecisionId(pair);
  const decision = decisions.get(id);
  // Neither set can move, so no search is offered for this pair; a line says why instead.
  const bothLocked = pair.a.locked && pair.b.locked;
  return (
    <FindingRow
      id={id}
      label={pairLabel(pair)}
      name={names}
      decision={decision}
      onDecide={onDecide}
      {...editingOf(id)}
      target={targetOfPair(pair)}
      trial={bothLocked ? undefined : trial}
      trialHeadingRef={trialHeadingRef}
      compact={`${names} · ${minutesLabel(pair.minutes)} shared`}
      extra={
        decision?.status === "kept" && isBreak ? (
          <p className="text-sm text-muted-foreground">Still listed under rule breaks: you asked that they never overlap.</p>
        ) : null
      }
    >
      <div className="min-w-0 print:flex print:flex-wrap print:items-baseline print:gap-x-3">
        <p className="text-[0.9375rem] font-semibold break-words">
          {pair.a.act} <span className="text-sm font-normal text-muted-foreground">({pair.a.stage})</span> and {pair.b.act}{" "}
          <span className="text-sm font-normal text-muted-foreground">({pair.b.stage})</span>
        </p>
        <p className="mt-0.5 text-sm break-words text-muted-foreground print:mt-0">
          <span className="font-mono text-[0.8125rem] text-foreground tabular-nums">{pair.minutes} min</span> shared,{" "}
          <span className="font-mono text-[0.8125rem] tabular-nums">{clockWindow(pair.windowStart, pair.windowEnd)}</span>
          {lockNote(pair)}
        </p>
        {bothLocked && trial ? <p className="mt-0.5 text-sm break-words text-muted-foreground print:hidden">{BOTH_LOCKED}</p> : null}
      </div>
    </FindingRow>
  );
}
