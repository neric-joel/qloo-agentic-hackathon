/**
 * "Your decisions" on the check page: what the programmer decided about each rule break and each pair
 * that shares time. A decision is a mark for the team, held in the tab's memory only: it changes no
 * figure on the page, it is not sent anywhere, and it is gone on reload. "Changed" is set only by a
 * change tried on the working copy; the other two are the visitor's own.
 */

import { setIdentity, type CheckReport, type CheckSet, type RuleBreak, type SharedPair } from "@/lib/check";
import type { TrialTarget } from "@/lib/check-trial";

export type DecisionStatus = "kept" | "not-changing" | "changed";

export const DECISION_REASONS = ["Production", "Travel", "Contract", "Artistic", "Other"] as const;
export type DecisionReason = (typeof DECISION_REASONS)[number];

/** Characters of the optional note. */
export const NOTE_CHARS = 80;

export type Decision = {
  id: string;
  /** What the decision is about, as the page words the break or the pair. */
  label: string;
  status: DecisionStatus;
  reason: DecisionReason | null;
  note: string;
  /** For "Changed": the change tried, as its move lines. */
  change: string | null;
};

export type Decisions = ReadonlyMap<string, Decision>;

export const DECISION_COPY = {
  heading: "Your decisions",
  lead: "Marks for your team, kept in this tab only. A decision changes no figure on this page.",
  kept: "Kept on purpose",
  notChanging: "Not changing",
  changed: "Changed",
  changedHere: "Changed in the working copy.",
  reason: "Reason (optional)",
  note: "Note (optional, up to 80 characters)",
} as const;

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  kept: DECISION_COPY.kept,
  "not-changing": DECISION_COPY.notChanging,
  changed: DECISION_COPY.changed,
};

function identities(sets: readonly CheckSet[], rows: readonly number[], ordered: boolean): string {
  const byRow = new Map(sets.map((set) => [set.row, set]));
  const ids = rows.map((row) => {
    const set = byRow.get(row);
    return set ? setIdentity(set) : `row${row}`;
  });
  return (ordered ? ids : [...ids].sort()).join("|");
}

/** A break's id by its rule and its sets (act, stage and times), so it holds across a re-check whatever its rows. */
export function breakDecisionId(item: Pick<RuleBreak, "rule" | "rows">, sets: readonly CheckSet[]): string {
  return `break:${item.rule}:${identities(sets, item.rows, item.rule === 3)}`;
}

export function pairDecisionId(pair: Pick<SharedPair, "id">): string {
  return `pair:${pair.id}`;
}

/** "Saffron Season and Ivory Lights share 20 minutes". */
export function pairLabel(pair: Pick<SharedPair, "a" | "b" | "minutes">): string {
  return `${pair.a.act} and ${pair.b.act} share ${pair.minutes} ${pair.minutes === 1 ? "minute" : "minutes"}`;
}

/** The decision id and label of what a search targeted, on the grid it searched. */
export function targetDecision(report: CheckReport, target: TrialTarget): { id: string; label: string } | null {
  if (target.kind === "shared") {
    const [a, b] = target.rows;
    const pair = report.shared.find(
      (item) => (item.a.row === a && item.b.row === b) || (item.a.row === b && item.b.row === a),
    );
    return pair ? { id: pairDecisionId(pair), label: pairLabel(pair) } : null;
  }
  const item = report.breaks.find(
    (b) => b.rule === target.rule && b.rows.length === target.rows.length && b.rows.every((row, k) => row === target.rows[k]),
  );
  return item ? { id: breakDecisionId(item, report.sets), label: item.text } : null;
}

/** The decisions about what the report shows, and every "Changed" one, in the order made. */
export function visibleDecisions(decisions: Decisions, report: CheckReport): Decision[] {
  const present = new Set([
    ...report.breaks.map((item) => breakDecisionId(item, report.sets)),
    ...report.shared.map(pairDecisionId),
  ]);
  return [...decisions.values()].filter((d) => d.status === "changed" || present.has(d.id));
}

/** One line of the list: "Saffron Season and Ivory Lights share 20 minutes: Kept on purpose. Contract: agent's request." */
export function decisionLine(decision: Decision): string {
  const label = decision.label.replace(/\.$/, "");
  const parts = [`${label}: ${STATUS_LABEL[decision.status]}.`];
  if (decision.change) parts.push(`${decision.change}.`);
  const note = decision.note.trim();
  if (decision.reason && note) parts.push(`${decision.reason}: ${note}`);
  else if (decision.reason) parts.push(`${decision.reason}.`);
  else if (note) parts.push(note);
  return parts.join(" ");
}

/** The one-line mark of a decided row: "Kept on purpose · Contract". */
export function decisionBadge(decision: Pick<Decision, "status" | "reason">): string {
  return decision.reason ? `${STATUS_LABEL[decision.status]} · ${decision.reason}` : STATUS_LABEL[decision.status];
}

/** What the draft review counts: the checked grid, what is decided about it and what is still open. */
export type ReviewCounts = {
  sets: number;
  stages: number;
  breaks: number;
  /** Rule breaks with a decision of any kind. */
  breaksReviewed: number;
  pairs: number;
  pairsDecided: number;
  kept: number;
  notChanging: number;
  /** "Changed" decisions, including those whose finding the change ended. */
  changed: number;
  openBreaks: number;
  openPairs: number;
};

/** The counts of the review, from the report on show and the decisions made in this tab. */
export function reviewCounts(report: CheckReport, decisions: Decisions): ReviewCounts {
  const breaksReviewed = report.breaks.filter((item) => decisions.has(breakDecisionId(item, report.sets))).length;
  const pairsDecided = report.shared.filter((pair) => decisions.has(pairDecisionId(pair))).length;
  const listed = visibleDecisions(decisions, report);
  return {
    sets: report.sets.length,
    stages: report.stages.length,
    breaks: report.breaks.length,
    breaksReviewed,
    pairs: report.shared.length,
    pairsDecided,
    kept: listed.filter((d) => d.status === "kept").length,
    notChanging: listed.filter((d) => d.status === "not-changing").length,
    changed: listed.filter((d) => d.status === "changed").length,
    openBreaks: report.breaks.length - breaksReviewed,
    openPairs: report.shared.length - pairsDecided,
  };
}

/** The note as kept: trimmed of line breaks and cut at 80 characters. */
export function cleanNote(value: string): string {
  return Array.from(value.replace(/[\r\n\t]+/g, " ")).slice(0, NOTE_CHARS).join("");
}
