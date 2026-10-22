"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, Equal, LoaderCircle, Minus, Plus, RotateCcw, TriangleAlert } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { budgetDelta, changeLabel } from "@/lib/agent-session";
import { dayName } from "@/lib/clashes";
import { noSignalMove } from "@/lib/credit";
import { buildDayGraph, drawingHeight, type DayGraphModel } from "@/lib/day-graph";
import type { Decision } from "@/lib/decision";
import { pluralize } from "@/lib/format";
import { rangeLead } from "@/lib/plan-copy";
import type { RulePreview } from "@/lib/rule-fix";
import type { GrowingOverlap } from "@/lib/overlap-words";
import {
  OUTSIDE_LEAD,
  clashChanges,
  clockMinutes,
  concurrentActs,
  currentPlacement,
  movableSets,
  outsideClauses,
  outsideCount,
  outsideGrowth,
  placementOf,
  nextRankedPair,
  startingSets,
  type ClashChanges,
  type KeptClash,
  type MovesResult,
  type PartnerPoints,
  type PickableSet,
  type PlacedOption,
} from "@/lib/moves";
import type { PairClash, Preset, SetSlot } from "@/lib/preset";
import {
  MAX_STACK,
  applyMoves,
  encodeMoves,
  isRuleStackStep,
  moveCount,
  movedActs,
  planAnnouncement,
  planPreview,
  planStarters,
  readStoredMoves,
  keepChangeInPlan,
  seedOutcome,
  stepMoves,
  storeMoves,
  type GhostSlot,
  type PlanPreview,
  type RuleStackStep,
  type StackMove,
  type StackStep,
} from "@/lib/stack";
import { formatClock, overlapWindow } from "@/lib/timetable";
import { cn } from "@/lib/utils";

import { BudgetMove, scaleRange, signedDelta, type ScaleRange } from "./budget-move";
import { DayGraph } from "./day-graph";
import { KeepApart, SetSelect, fieldDisplay, setPlace } from "./keep-apart";
import { stripDomain } from "./pair-strip";
import { ScratchPlan } from "./scratch-plan";
import { useHeldRoom } from "./skeletons";
import {
  MOVES_LIMIT,
  clashParts,
  sharedMinutesByName,
  useMoveCheck,
  usePlan,
  type MoveCheck,
  type SharedByName,
} from "./use-moves";

/**
 * The one time domain and tick policy every pair strip shares ("Keep two sets apart" draws one), kept here for the
 * tests that pin it. Try a move itself draws a tested place with the hero's drawing (`TestedDrawing`).
 */
export { stripDomain };

/** Where the section sits on the page, for links that point at it. */
export const TRY_A_MOVE_ID = "try-a-move";

/** How many sets "Start with" lists: the card's pair (or the costliest clash's two sets); the select holds every other. */
export const START_WITH = 2;

/**
 * The kept plan's anchor ("See your plan" links here). It takes focus (tabIndex -1), and its scroll margin
 * clears the sticky site header (64 px) plus, from 768 px, the sticky section nav (44 px), with room to spare.
 */
export const YOUR_PLAN_ID = "your-plan";

/** Who handed "Try a move" a step to keep: the decision card or a tested place from an agent run. */
export type SeedSource = "card" | "agent";

/**
 * How a seeded step meets a plan that already holds steps: `replace` (the default, as before) makes it the
 * whole plan; `add` puts it after the kept steps, and only when the plan still holds exactly `base` (the
 * steps, encoded, that the timetable engine priced together with it before the press). Otherwise the plan
 * is left exactly as it was: an add is never partial and never turns into a replace.
 */
export type SeedMode = { mode: "add"; base: string } | { mode: "replace" };

/** A step handed in from outside the section; a new `nonce` keeps it, the same one does nothing. */
export type SeedStep = { nonce: number; step: StackStep; from?: SeedSource; mode?: "add" | "replace"; base?: string };

/** The plan card's next step: "Next: A × B, the next clash in the published day's ranking". */
export function nextLabel(pair: { a: string; b: string }): string {
  return `Next: ${pair.a} × ${pair.b}, the next clash in the published day’s ranking`;
}

/**
 * What a seeded step does to the plan: the steps the plan then holds, or null to leave it exactly as it was.
 * A step the plan already holds changes nothing. `replace` (the default) makes the step the whole plan. `add`
 * puts it after the kept steps only when the plan still holds exactly `base` (the steps the timetable engine
 * priced together with it), it moves no set the plan already moves, and the plan has room; otherwise nothing
 * changes, so an add is never partial and never a silent replace.
 */
export function seededPlan(
  moves: readonly StackStep[],
  seed: { step: StackStep; mode?: "add" | "replace"; base?: string },
): readonly StackStep[] | null {
  if (seedOutcome(moves, seed.step).kind === "same") return null;
  if (seed.mode !== "add") return [seed.step];
  const moved = movedActs(moves);
  const fits =
    seed.base === encodeMoves(moves) &&
    stepMoves(seed.step).every((move) => !moved.has(move.actId)) &&
    moveCount(moves) + stepMoves(seed.step).length <= MAX_STACK;
  return fits ? [...moves, seed.step] : null;
}

/** No step held: shared so its identity never changes. */
const NO_STEPS: readonly StackStep[] = [];

/**
 * The cap on a published day's changeover gap: the gap is the tightest published gap between two sets on a
 * stage, capped at this (`DEFAULT_CHANGEOVER` in backend/app/lineups/timetable.py, `to_festival`).
 */
const PUBLISHED_CHANGEOVER_CAP = 15;

/** How far from its published start a published day's movable set may start (`Reach.minutes`, timetable.py). */
const REACH_MINUTES = 120;

/**
 * The values of a published day's rules, read from its published timetable the way the timetable engine
 * builds them (backend/app/lineups/timetable.py, `to_festival`), so the sentence never states a value the
 * engine does not enforce:
 * - `curfew`: the day's latest published end (the engine's curfew);
 * - `changeover`: the tightest published gap between two sets on a stage, at most 15 minutes;
 * - `publishedHours`: every stage that plays that day has hours from its first published start to its last
 *   published end (the hours the engine checks each place against);
 * - `reach`: every set that may move carries a start window of its published start ± 120 minutes and the
 *   stages within one place of its own in the day's stage order (the engine's `Reach`, checked per place).
 * Null when the day has no set.
 */
export type DayRules = { curfew: number; changeover: number; publishedHours: boolean; reach: boolean };

export function dayRules(festival: Pick<Preset["festival"], "stages" | "timetable">, day: number): DayRules | null {
  const slots = festival.timetable.filter((slot) => slot.day === day);
  if (slots.length === 0) return null;
  const byStage = new Map<string, SetSlot[]>();
  for (const slot of slots) byStage.set(slot.stage_id, [...(byStage.get(slot.stage_id) ?? []), slot]);
  const gaps: number[] = [];
  for (const sets of byStage.values()) {
    const ordered = [...sets].sort((a, b) => a.start - b.start);
    for (let i = 1; i < ordered.length; i += 1) gaps.push(ordered[i].start - ordered[i - 1].end);
  }
  const tightest = gaps.length > 0 ? Math.max(0, Math.min(...gaps)) : PUBLISHED_CHANGEOVER_CAP;
  const publishedHours = [...byStage].every(([stageId, sets]) => {
    const hours = festival.stages.find((stage) => stage.id === stageId)?.hours.find((item) => item.day === day);
    return (
      hours !== undefined &&
      hours.open === Math.min(...sets.map((set) => set.start)) &&
      hours.close === Math.max(...sets.map((set) => set.end))
    );
  });
  const order = festival.stages.map((stage) => stage.id);
  const reach = slots
    .filter((slot) => !slot.locked)
    .every((slot) => {
      const own = order.indexOf(slot.stage_id);
      const near = order.filter((_, rank) => Math.abs(rank - own) <= 1);
      const stages = slot.stages ?? null;
      return (
        own >= 0 &&
        slot.not_before === Math.max(0, slot.start - REACH_MINUTES) &&
        slot.not_after === slot.start + REACH_MINUTES &&
        stages !== null &&
        stages.length === near.length &&
        near.every((id) => stages.includes(id))
      );
    });
  return {
    curfew: Math.max(...slots.map((slot) => slot.end)),
    changeover: Math.min(PUBLISHED_CHANGEOVER_CAP, tightest),
    publishedHours,
    reach,
  };
}

/**
 * What a legal place was checked against, said after "Adds no rule break.": the rules the timetable engine
 * tests every listed place on, with the shown day's own values. On a published day: each stage's published
 * hours, nothing after the day's latest published end, the changeover gap in minutes, the sets this app locks,
 * the reach limit when every movable set carries it, and pairs that must never overlap. The invented day names
 * the same kinds of rule without "published"; its curfew and changeover are not in the day the page holds, so
 * they are named without a value.
 */
export function rulesChecked(preset: Pick<Preset, "festival" | "synthetic">, day: number): string {
  if (preset.synthetic === true) {
    return "Checked against the invented day’s rules: each stage’s hours, the curfew, the changeover gap, locked sets, and pairs that must never overlap.";
  }
  const rules = dayRules(preset.festival, day);
  const clauses = [
    rules?.publishedHours ? "each stage’s published hours" : "each stage’s hours",
    rules ? `nothing after ${formatClock(rules.curfew)} (the day’s latest published end)` : "the curfew",
    rules ? `at least ${rules.changeover} min between sets on a stage` : "the changeover gap",
    "sets this app locks",
    ...(rules?.reach ? ["a start within two hours of the set’s published start, on its own stage or a neighbouring one"] : []),
  ];
  return `Checked against this app’s rules for the day, read from the published timetable: ${clauses.join(", ")}, and pairs that must never overlap.`;
}

/**
 * The rule status of a legal place and the rules it was checked against (`rulesChecked`, for the shown day),
 * in one line: the status in ink, the rules muted beside it. Every place the engine lists passed them, so the
 * tested place and each place in the full list say the same words.
 */
function RulesLine({ rules, className }: { rules: string; className?: string }) {
  return (
    <p data-rules-line className={className}>
      Adds no rule break. <span className="text-muted-foreground">{rules}</span>
    </p>
  );
}

/** Where "listed" is defined: the endpoint keeps each set's three costliest clashes before and after a place. */
export function listedLead(act: string): string {
  return `Listed clashes of ${act} (its three costliest, as scored): `;
}

/**
 * The line under a place's listed clashes when the place starts or lengthens an overlap that none of its lists
 * shows: "Outside the listed clashes: new 15 min overlap with Joy Crookes.", worded by the hero's own
 * `growthClauses`. Nothing when there is none.
 */
function OutsideLine({ grows, className }: { grows: readonly GrowingOverlap[] | undefined; className?: string }) {
  const clauses = outsideClauses(grows ?? []);
  if (clauses.length === 0) return null;
  return (
    <p data-outside-line className={cn("text-sm leading-snug break-words text-pretty", className)}>
      <span className="text-muted-foreground">{OUTSIDE_LEAD}</span> {clauses.join(" ")}
    </p>
  );
}

/** A sentence with its count and noun ("1 overlap") kept on one line, as the counts before it are. Same words. */
function CountTogether({ sentence }: { sentence: string }) {
  const match = /^(.*?)(\d+ overlaps?)(.*)$/.exec(sentence);
  if (!match) return <>{sentence}</>;
  return (
    <>
      {match[1]}
      <span className="whitespace-nowrap">{match[2]}</span>
      {match[3]}
    </>
  );
}

/**
 * Room held for words an answer will bring, drawn as quiet bars: the element's `data-ghost` words are laid out
 * through its ::before box (so they wrap as words of that length will, at any width) in a transparent ink over
 * the muted fill, one bar per line. The words are never in the page's text: not shown, not read, not
 * selectable. The same room /check holds while a compare is out.
 */
const GHOST_LINE =
  "before:rounded-xs before:bg-muted before:text-transparent before:content-[attr(data-ghost)] before:[-webkit-box-decoration-break:clone] before:[box-decoration-break:clone]";

/** The same room with nothing drawn: an unseen stand-in that only takes the width of its words. */
const GHOST_ROOM = "invisible before:content-[attr(data-ghost)]";

/**
 * The words the room of a listed-clashes line is laid out from while the answer is out, with no figure in them
 * (never shown): the counts of a long line as the engine's answers read (a place it has not told yet) or of a
 * middling one (a place whose move is known), and the sentence that ends the line when an overlap outside the
 * list starts or grows.
 */
const LISTED_LONG = "0 shortened (00 → 00 min), 0 lengthened (00 → 00 min), 0 added, 0 removed.";
const LISTED_MID = "0 shortened (00 → 00 min), 0 added, 0 removed.";
const OUTSIDE_COUNT = " Outside the list, 0 overlaps start or grow.";
/** The words an outside line's room is laid out from: one overlap with the named set. Never shown. */
function outsideRoom(partner: string): string {
  return `${OUTSIDE_LEAD} new 00 min overlap with ${partner}.`;
}

/**
 * Whether moving a set as `move` says starts or lengthens an overlap with a set outside its three costliest
 * clashes now (the report's, the ones the engine lists before a place), read from `timetable`: only then can the
 * answer for that place carry an outside line, so only then does a verdict hold that line's room while the place
 * is checked. False when the set is not on the timetable or the start does not read.
 */
export function mayGrowOutside(
  preset: Pick<Preset, "festival" | "report">,
  timetable: readonly SetSlot[],
  move: Pick<StackMove, "actId" | "day" | "start">,
): boolean {
  const slot = timetable.find((item) => item.act_id === move.actId);
  const start = clockMinutes(move.start);
  if (!slot || start === null) return false;
  const nameOf = (id: string) => preset.festival.acts.find((act) => act.id === id)?.name ?? null;
  const costliest = preset.report.clashes
    .filter((clash) => clash.day === slot.day && (clash.a.act_id === move.actId || clash.b.act_id === move.actId))
    .sort((p, q) => p.rank - q.rank)
    .slice(0, 3)
    .flatMap((clash) => {
      const name = nameOf(clash.a.act_id === move.actId ? clash.b.act_id : clash.a.act_id);
      return name ? [name] : [];
    });
  const home = { day: slot.day, start: slot.start, end: slot.end };
  const after = { day: move.day, start, end: start + (slot.end - slot.start) };
  return outsideGrowth(preset.festival.acts, timetable, move.actId, home, after, new Set(costliest)).length > 0;
}

/**
 * The room the rule status takes ("Adds no rule break."), without its words: the same letters in reverse order,
 * set on one line, so a box is exactly as wide as the status while no claim is in the page before the check,
 * not even in an attribute.
 */
const RULE_STATUS_ROOM = [..."Adds no rule break."].reverse().join("");

/**
 * The room the rules sentence takes, worded for a check still running ("Checking against …" for "Checked
 * against …"), so it wraps as the sentence will while the sentence that says the place was checked is not in the
 * page before the check.
 */
function checkingRules(rules: string): string {
  return rules.replace(/^Checked against/, "Checking against");
}

/**
 * The verdict lines while a place is checked, holding the room the answer's lines will take: "Checking rules…"
 * where the rule status will be (in a box as wide as "Adds no rule break.", so the rules after it wrap as they
 * will), the rules sentence's room after it, then the room of the listed-clashes line (`long` for a place not yet
 * told) and, when the place may start or lengthen an overlap outside the list (`outside`), of one outside line.
 * The status, the rules, the counts and the outside line are not in the page until the answer brings them, so
 * nothing is claimed before the check.
 */
function VerdictRoom({
  rules,
  listedName,
  partner,
  long,
  outside,
}: {
  rules: string;
  listedName: string | null;
  partner: string | null;
  long: boolean;
  outside: boolean;
}) {
  return (
    <>
      <p data-rules-room className="text-muted-foreground">
        <span className="inline-grid whitespace-nowrap">
          <span aria-hidden="true" data-ghost={RULE_STATUS_ROOM} className={cn(GHOST_ROOM, "col-start-1 row-start-1")} />
          <span className="col-start-1 row-start-1">Checking rules…</span>
        </span>{" "}
        <span aria-hidden="true" data-ghost={checkingRules(rules)} className={GHOST_LINE} />
      </p>
      {listedName ? (
        <p aria-hidden="true" data-listed-room>
          <span className="text-muted-foreground">{listedLead(listedName)}</span>
          <span data-ghost={`${long ? LISTED_LONG : LISTED_MID}${outside ? OUTSIDE_COUNT : ""}`} className={GHOST_LINE} />
        </p>
      ) : null}
      {outside ? (
        <p aria-hidden="true" data-outside-room>
          <span data-ghost={outsideRoom(partner ?? listedName ?? "a set")} className={GHOST_LINE} />
        </p>
      ) : null}
    </>
  );
}

/**
 * How soon after the visitor's own press (a key or a pointer) an answer counts as part of what the press did: the
 * page may change then. Under the browser's 500 ms, so the frame the answer paints in is still inside it.
 */
const PRESS_MS = 400;

/**
 * The height an answer's place keeps once the answer is in (`HeldRoom`): the pending room's, when the answer lands
 * late (`sincePress`, ms since the visitor's last press, is `PRESS_MS` or more), reads shorter than that room at the
 * same width, and ends above the fold (so what sits under it is on screen and would move up). Null otherwise: the
 * answer takes its own height, as part of the press, or moving nothing on screen.
 */
export function heldHeight(
  room: { width: number; height: number } | null,
  now: { width: number; height: number; end: number },
  fold: number,
  sincePress = Number.POSITIVE_INFINITY,
): number | null {
  if (!room || room.height <= 0 || Math.abs(room.width - now.width) > 0.5) return null;
  if (sincePress < PRESS_MS || now.end >= fold || now.height >= room.height) return null;
  return room.height;
}

/** When the visitor last pressed a key or a pointer, on `performance.now()`'s clock (watched once, in the browser). */
let lastPress = Number.NEGATIVE_INFINITY;
let watchingPresses = false;
function watchPresses() {
  if (watchingPresses || typeof window === "undefined") return;
  watchingPresses = true;
  const note = (event: Event) => {
    lastPress = event.timeStamp;
  };
  window.addEventListener("pointerdown", note, { capture: true, passive: true });
  window.addEventListener("keydown", note, { capture: true, passive: true });
}

/** Runs before paint in the browser; a static render (the tests') never runs it. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * An answer's place on the page. While the answer is out (`pending`) it records the room its pending frame takes.
 * When the answer comes (`hold`) and reads shorter, what sits under it would move up by the difference. Within
 * `PRESS_MS` of the visitor's own press that is part of what they did, and if the answer's end is below the fold
 * nothing that moves is on screen: either way the answer takes its own height at once. Else the place keeps the
 * pending room's height (the space stays under the answer) until the answer's end would be below the fold (a
 * scroll up), the width changes or another answer is asked for (`room`). So an answer that lands late moves
 * nothing that was on screen. A failed answer (`hold` false) takes its own height at once.
 */
function HeldRoom({ room, pending, hold, children }: { room: string; pending: boolean; hold: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const held = useRef<{ width: number; height: number } | null>(null);
  useBeforePaint(() => {
    watchPresses();
    const element = ref.current;
    if (!element) return;
    // Fractional sizes, so a held room is the pending room to the subpixel.
    const box = () => element.getBoundingClientRect();
    element.style.minHeight = "";
    if (pending) {
      const measure = () => {
        const { width, height } = box();
        held.current = { width, height };
      };
      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    const was = held.current;
    held.current = null;
    // Where the answer itself ends: its last block's bottom (the place's own bottom while it holds a room).
    const now = () => {
      const { width, height, top } = box();
      return { width, height, end: element.lastElementChild?.getBoundingClientRect().bottom ?? top };
    };
    const keep = hold ? heldHeight(was, now(), window.innerHeight, performance.now() - lastPress) : null;
    if (keep === null || !was) return;
    element.style.minHeight = `${keep}px`;
    const release = () => {
      const at = now();
      if (at.end < window.innerHeight && Math.abs(at.width - was.width) <= 0.5) return;
      element.style.minHeight = "";
      window.removeEventListener("scroll", release);
      window.removeEventListener("resize", release);
    };
    window.addEventListener("scroll", release, { passive: true });
    window.addEventListener("resize", release);
    return () => {
      window.removeEventListener("scroll", release);
      window.removeEventListener("resize", release);
    };
  }, [room, pending, hold]);
  return (
    <div ref={ref} className="flow-root">
      {children}
    </div>
  );
}

/** What the page already knows of a picked set's best tested place before the engine answers (`PendingPlace`). */
export type PlaceRoom = {
  /** The set its minutes are read against (`pickedPartner`, the one the answer reads) and the minutes they share now. */
  partner: { name: string; minutes: number } | null;
  /** The day's coverage has no usable signal for the set, so the answer opens with the no-signal line. */
  unscored: boolean;
  /** The height of the place's drawing in its short layout (`drawingHeight`), or null when none will be drawn. */
  drawing: number | null;
};

const NO_ROOM: PlaceRoom = { partner: null, unscored: false, drawing: null };

/**
 * A picked set's best tested place while the engine scores its legal places: the tested place's own frame, each
 * line in the room the answer's line will take. What the page already knows is set in words (the label, the set,
 * the set it shares time with and the minutes they share now, the no-signal line); what the answer brings is
 * held by quiet bars laid out from words of its length, the drawing by its own height and the actions by their
 * row. Nothing in it can be pressed or focused.
 */
function PendingPlace({ label, name, room, rules, synthetic }: { label: string; name: string; room: PlaceRoom; rules: string; synthetic: boolean }) {
  return (
    <div data-place-room>
      {room.unscored ? <p className="mb-4 text-sm">{noSignalMove(synthetic, name)}</p> : null}
      <div className="border-t border-border pt-5 sm:pt-6">
        <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">{label}</p>
        <p className="mt-1 flex items-start gap-2 text-[0.9375rem] leading-snug text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin" />
          <span className="min-w-0">Scoring every legal place for {name}</span>
        </p>
        <div className="mt-4">
          {room.partner ? (
            <p className="type-numeral text-2xl leading-tight break-words">
              {room.partner.minutes} →{" "}
              <span aria-hidden="true" data-ghost={String(room.partner.minutes)} className={GHOST_LINE} /> min shared with{" "}
              {room.partner.name}
            </p>
          ) : null}
          <p className={cn("text-[0.9375rem] leading-snug text-muted-foreground", room.partner && "mt-1.5")}>Index checking…</p>
          <div className="mt-1.5 space-y-1 text-sm leading-snug break-words text-pretty">
            <VerdictRoom rules={rules} listedName={name} partner={room.partner?.name ?? null} long outside />
          </div>
          {room.drawing ? (
            <div aria-hidden="true" data-drawing-room className="mt-5 rounded-md bg-muted" style={{ height: `${room.drawing}px` }} />
          ) : null}
        </div>
        <div aria-hidden="true" className="mt-6 border-t border-border" />
        <div aria-hidden="true" data-actions-room className="mt-4 h-11" />
      </div>
    </div>
  );
}

/**
 * A picked set's full list of legal places while the engine scores them (the copy under 1024 px): the list's
 * own frame, block for block, holding the room each block will take. Its heading's words and its source chip,
 * then the scoring line where "Lowest Clash Budget first" will be, a quiet row for each place the list can show
 * (`MOVES_LIMIT`), and the chosen place's frame: its line, its index and scale, its rules, the clashes it ends and
 * adds, its drawing (at its own height), its action, and the list's footnote. What the answer brings is held by
 * quiet bars laid out from words of its length. Nothing in it can be pressed or focused.
 */
export function PlacesRoom({
  name,
  rules,
  drawing,
  range = null,
  synthetic = false,
}: {
  name: string;
  rules: string;
  drawing: number | null;
  /** The day's scale (`scaleRange`), for the room of the line under the index's bars. */
  range?: ScaleRange | null;
  synthetic?: boolean;
}) {
  const lead = range ? rangeLead(range) : null;
  return (
    <div data-places-room className="border-t border-border pt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-title break-words">Where {name} could go</p>
          <p aria-hidden="true" className="mt-1.5 text-sm">
            <span data-ghost="Now: Stage 00:00–00:00" className={GHOST_LINE} />
          </p>
        </div>
        <ProvenanceChip provenance="derived" size="sm" className="mt-1" synthetic={synthetic} />
      </div>
      <div className="mt-5 grid gap-6">
        <div className="min-w-0">
          <p className="flex items-start gap-2 text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin" />
            <span className="min-w-0">Scoring every legal place for {name}</span>
          </p>
          <ul aria-hidden="true" className="mt-2 space-y-1.5">
            {Array.from({ length: MOVES_LIMIT }, (_, i) => (
              <li key={i} className="h-11 rounded-md bg-muted" />
            ))}
          </ul>
        </div>
        <div aria-hidden="true" className="min-w-0">
          <p className="font-semibold break-words">
            <span data-ghost={`${name} → Stage 00:00–00:00`} className={GHOST_LINE} />
          </p>
          {/* The index before and after, its change and its caption, then its two bars and the scale's line. */}
          <div className="mt-3">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span data-ghost="000.0 → 000.0" className={cn("type-numeral text-3xl leading-none", GHOST_LINE)} />
              <span className="tag invisible">
                <span data-ghost="↓ 0.0 lower" className={GHOST_ROOM} />
              </span>
              <span data-ghost="Clash Budget Index · lower is better" className={cn("text-[0.8125rem]", GHOST_LINE)} />
            </p>
            <div className="mt-2.5 space-y-1.5">
              {["Now", "After"].map((label) => (
                <div key={label} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2 text-xs">
                  <span data-ghost={label} className={GHOST_ROOM} />
                  <span className="block h-2 rounded-bar bg-muted" />
                </div>
              ))}
            </div>
            {lead ? (
              <p className="mt-2 text-xs lg:text-[0.8125rem]">
                <span data-ghost={lead} className={GHOST_LINE} />
              </p>
            ) : null}
          </div>
          <p className="mt-4 text-sm leading-snug break-words text-pretty">
            <span data-ghost={`${RULE_STATUS_ROOM} ${checkingRules(rules)}`} className={GHOST_LINE} />
          </p>
          {/* The clashes it ends and adds, one line each, and one outside line. */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {["Listed clashes it ends", "Listed clashes it adds"].map((title) => (
              <div key={title} className="min-w-0">
                <p className="text-[0.8125rem] leading-5">
                  <span data-ghost={title} className={GHOST_LINE} />
                </p>
                <p className="mt-1.5 text-sm">
                  <span data-ghost="Stage Name · 0.0 index points" className={GHOST_LINE} />
                </p>
              </div>
            ))}
            <p className="text-sm leading-snug break-words text-pretty sm:col-span-2">
              <span data-ghost={outsideRoom(name)} className={GHOST_LINE} />
            </p>
          </div>
          {drawing ? <div data-drawing-room className="mt-5 rounded-md bg-muted" style={{ height: `${drawing}px` }} /> : null}
          <div className="mt-6 border-t border-border" />
          <div className="mt-4 h-11" />
        </div>
      </div>
      <p aria-hidden="true" className="mt-5 text-xs lg:text-[0.8125rem]">
        <span data-ghost="00 legal places, checking every start on a 5-minute grid. Tested only: the timetable above is unchanged." className={GHOST_LINE} />
      </p>
    </div>
  );
}

/** "15:45-16:30" -> "15:45–16:30", as the rest of the page prints a time range. */
function dashRanges(text: string): string {
  return text.replace(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/g, "$1–$2");
}

type StageGroup = { stageId: string; stageName: string; sets: PickableSet[] };

function byStage(sets: readonly PickableSet[]): StageGroup[] {
  const groups: StageGroup[] = [];
  for (const set of sets) {
    const last = groups.at(-1);
    if (last && last.stageId === set.stageId) last.sets.push(set);
    else
      groups.push({
        stageId: set.stageId,
        stageName: set.stageName,
        sets: [set],
      });
  }
  return groups;
}

/**
 * The plan kept for this preset in this tab, when every move is still a set of this festival that
 * may move and every rule step's pair is still on this festival. Anything else is dropped, and the
 * server checks the rest.
 */
function storedPlan(preset: Preset): StackStep[] {
  const stored = readStoredMoves(preset.id);
  const all = new Set(preset.festival.timetable.map((slot) => slot.act_id));
  const movable = new Set(preset.festival.timetable.filter((slot) => !slot.locked).map((slot) => slot.act_id));
  return stored.every(
    (step) =>
      stepMoves(step).every((move) => movable.has(move.actId)) &&
      (!isRuleStackStep(step) || (all.has(step.rule.aId) && all.has(step.rule.bId))),
  )
    ? stored
    : [];
}

function ClashChangeList({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly PartnerPoints[];
  tone: "ends" | "adds";
}) {
  const Icon = tone === "ends" ? Minus : Plus;
  return (
    <div className="min-w-0">
      <h4 className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="mt-1.5 space-y-1 text-sm">
          {items.map((item) => (
            <li key={item.name} className="flex gap-2">
              <Icon
                aria-hidden="true"
                className={cn("mt-0.5 size-4 shrink-0", tone === "ends" ? "text-success" : "text-primary")}
              />
              <span className="min-w-0 break-words">
                {item.name} · <span className="tabular-nums">{item.points.toFixed(1)}</span> index points
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Listed clashes a move keeps (in the set's list before the place and after it), each with its index points
 * before and after (both from the server).
 */
function KeptClashList({ items }: { items: readonly KeptClash[] }) {
  return (
    <div className="min-w-0 sm:col-span-2">
      <h4 className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Listed clashes it keeps</h4>
      <ul className="mt-1.5 space-y-1 text-sm">
        {items.map((item) => {
          const Icon = item.after < item.now ? ArrowDown : item.after > item.now ? ArrowUp : Equal;
          return (
            <li key={item.name} className="flex gap-2">
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  item.after < item.now
                    ? "text-success"
                    : item.after > item.now
                      ? "text-primary"
                      : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 break-words">
                {item.name} ·{" "}
                <span className="tabular-nums">
                  {item.now.toFixed(1)} → {item.after.toFixed(1)}
                </span>{" "}
                index points
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One legal place in the list: where and when, and the Clash Budget Index it gives the day. */
function PlaceButton({
  option,
  before,
  dayLabel,
  pressed,
  controls,
  onPress,
}: {
  option: PlacedOption;
  before: number | null;
  dayLabel: string | null;
  pressed: boolean;
  controls: string;
  onPress: () => void;
}) {
  const delta = budgetDelta(before, option.after);
  const where = `${option.stage} ${option.start}–${option.end}${dayLabel ? `, ${dayLabel}` : ""}`;
  const price =
    option.after !== null
      ? `: Clash Budget Index ${option.after.toFixed(1)}${delta !== null ? `, ${changeLabel(delta)}` : ""}`
      : "";
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-controls={controls}
      aria-label={`${where}${price}`}
      onClick={onPress}
      className={cn(
        "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md text-left text-sm motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        // Selected is the wash with a 1.5px ink edge (the edge is the cue; never an ink or raspberry fill);
        // the others keep a 1px border-strong edge (3:1, so the edge names the control) and take the wash on
        // hover. The padding gives back the extra half pixel, so the button keeps its size when pressed.
        pressed
          ? "border-[1.5px] border-foreground bg-accent px-[11.5px] py-[7.5px]"
          : "border border-border-strong bg-card px-3 py-2 hover:bg-accent",
      )}
    >
      <span className="min-w-0">
        <span className="font-semibold">{option.stage}</span>{" "}
        <span className="tabular-nums">
          {option.start}–{option.end}
        </span>
        {dayLabel ? <span className="text-muted-foreground"> · {dayLabel}</span> : null}
      </span>
      <span className={cn("tabular-nums", pressed ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {option.after !== null ? option.after.toFixed(1) : "?"}
        {delta !== null ? ` (${signedDelta(delta)})` : ""}
      </span>
    </button>
  );
}

/** Keeping the chosen place: the button, or why the plan cannot take another move. */
type KeepControl = { full: boolean; onKeep: (option: PlacedOption) => void };

/**
 * The answer for one set: its legal places as a list, and the chosen one priced in full, with the hero's
 * drawing of it when one is passed (`drawing`). With kept moves the places are priced on top of them
 * (`result.before` is the plan's Clash Budget Index) and `timetable` is the published one with those moves
 * made, so the clashes a place ends and adds are read against where every set plays in the plan.
 */
export function MovesCard({
  result,
  preset,
  timetable,
  kept,
  range,
  chosen,
  keep,
  onChoose,
  headingRef,
  rules,
  drawing = null,
}: {
  result: MovesResult;
  preset: Preset;
  timetable: readonly SetSlot[];
  kept: number;
  range: ScaleRange;
  chosen: PlacedOption | null;
  keep: KeepControl;
  onChoose: (index: number) => void;
  /** The heading takes focus when "Show every legal place" opened this list. */
  headingRef?: Ref<HTMLHeadingElement>;
  /** What every legal place was checked against, with the shown day's values (`rulesChecked`). */
  rules: string;
  /** The hero's drawing of the chosen place (`placeDrawing`); redrawn for each place chosen. */
  drawing?: DayGraphModel | null;
}) {
  const detailId = useId();
  const fullHelpId = useId();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const { festival } = preset;
  const multiDay = festival.days.length > 1;
  const chosenDelta = chosen ? budgetDelta(result.before, chosen.after) : null;

  const changes = useMemo(
    () => (chosen ? placeChanges(festival, timetable, result, chosen) : null),
    [chosen, festival, timetable, result],
  );

  const dayLabelOf = (option: PlacedOption) =>
    multiDay ? dayName(festival.days[option.day] ?? `Day ${option.day + 1}`) : null;

  /**
   * Shows a place. On a narrow screen the priced detail sits under the whole list, so when it is
   * out of sight it is brought into view; beside the list (wide screens) nothing scrolls.
   */
  function choose(next: number) {
    onChoose(next);
    requestAnimationFrame(() => {
      const detail = detailRef.current;
      // Leave it be while its heading and the before and after readings already show.
      if (!detail || detail.getBoundingClientRect().top < window.innerHeight - 200) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      detail.scrollIntoView({
        block: "nearest",
        behavior: reduce ? "auto" : "smooth",
      });
    });
  }

  return (
    // A list of choices and its result, open on paper under one 1px decorative top rule, as the tested
    // result and the Start-with list are: no box, no fill, no side padding. The place buttons keep their own
    // edges (they are controls).
    <div data-moves-card className="border-t border-border pt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 ref={headingRef} tabIndex={-1} className="type-title break-words outline-none">
            Where {result.act} could go
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">Now: {dashRanges(result.from)}</p>
        </div>
        <ProvenanceChip provenance="derived" size="sm" className="mt-1" synthetic={preset.synthetic === true} />
      </div>

      {!result.movable ? (
        <p className="mt-4 text-[0.9375rem] font-semibold">It cannot move: {result.why ?? "it is fixed in place"}.</p>
      ) : !chosen ? (
        <p className="mt-4 text-[0.9375rem] font-semibold">No free slot it may use breaks no rule.</p>
      ) : (
        <>
          {!result.priced ? (
            <p className="mt-4 rounded-md bg-background px-3 py-2 text-sm">
              {noSignalMove(preset.synthetic === true, result.act)}
            </p>
          ) : null}
          {/* The page's own 5/7 split and 48px gutter, so with no card padding the places line up under the
              Start-with list and the priced detail under the tested result. */}
          <div className="mt-5 grid gap-6 lg:grid-cols-12 lg:gap-x-12">
            <div className="min-w-0 lg:col-span-5">
              <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
                Lowest Clash Budget first
                {result.options.length < result.legalPlaces
                  ? ` · ${result.options.length} of ${result.legalPlaces} shown`
                  : ""}
              </p>
              <ol aria-label="Legal places" className="mt-2 space-y-1.5">
                {result.options.map((option, i) => (
                  <li key={`${option.day}-${option.stageId}-${option.start}`}>
                    <PlaceButton
                      option={option}
                      before={result.before}
                      dayLabel={dayLabelOf(option)}
                      pressed={option === chosen}
                      controls={detailId}
                      onPress={() => choose(i)}
                    />
                  </li>
                ))}
              </ol>
            </div>

            <div id={detailId} ref={detailRef} className="min-w-0 lg:col-span-7">
              <p aria-live="polite" className="font-semibold break-words">
                {result.act} → {chosen.stage}{" "}
                <span className="tabular-nums">
                  {chosen.start}–{chosen.end}
                </span>
                {dayLabelOf(chosen) ? ` · ${dayLabelOf(chosen)}` : ""}
                {chosenDelta !== null && result.before !== null && chosen.after !== null ? (
                  <span className="sr-only">
                    {`: Clash Budget Index ${result.before.toFixed(1)} to ${chosen.after.toFixed(1)}, ${changeLabel(chosenDelta)}`}
                  </span>
                ) : null}
              </p>
              <BudgetMove
                before={result.before}
                after={chosen.after}
                range={range}
                stamp={`${chosen.day}-${chosen.stageId}-${chosen.start}`}
              />
              {/* Every place in this list is one the engine found legal, so each says which rules it passed,
                  in the tested place's words, above the clashes it changes. */}
              <RulesLine rules={rules} className="mt-4 text-sm leading-snug break-words text-pretty" />
              {changes ? (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <ClashChangeList title="Listed clashes it ends" items={changes.ends} tone="ends" />
                  <ClashChangeList title="Listed clashes it adds" items={changes.adds} tone="adds" />
                  {changes.keeps.length > 0 ? <KeptClashList items={changes.keeps} /> : null}
                  <OutsideLine grows={changes.outside} className="sm:col-span-2" />
                </div>
              ) : null}
              {drawing ? <TestedDrawing model={drawing} /> : null}
              {/* The result's one inner separator: a 1px hairline above the action. */}
              <div aria-hidden="true" className="mt-6 border-t border-border" />
              <div className="mt-4">
                <Button
                  type="button"
                  variant="default"
                  disabled={keep.full}
                  aria-describedby={keep.full ? fullHelpId : undefined}
                  onClick={() => keep.onKeep(chosen)}
                >
                  {keep.full ? "Plan is full" : "Keep this move"}
                </Button>
                {keep.full ? (
                  <p id={fullHelpId} className="mt-2 text-sm text-muted-foreground">
                    Eight moves is the most a plan holds here. Undo one or start over.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <p className="mt-5 text-xs text-muted-foreground lg:text-[0.8125rem]">
            {kept > 0
              ? `${pluralize(result.legalPlaces, "legal place")} on top of your ${pluralize(kept, "kept move")}, checking every start on a 5-minute grid.`
              : `${pluralize(result.legalPlaces, "legal place")}, checking every start on a 5-minute grid.`}{" "}
            Tested only: the timetable above is unchanged.
          </p>
        </>
      )}
    </div>
  );
}

/** The decision card's move as the client already holds it: its readings, each optional. */
export type CardMove = {
  move: StackMove;
  receipt: string;
  /** The index before and after the move, one decimal, as the card prints them. */
  indexBefore?: string | null;
  indexAfter?: string | null;
  /** Minutes the card's pair shares before and after the move. */
  minutesBefore?: number | null;
  minutesAfter?: number | null;
  /** The card's pair, so "Keep two sets apart" can open on it. */
  pair?: { aId: string; bId: string } | null;
};

/** The minutes two published sets share before a move and after it, for the pair named in the receipt. */
export type SharedMinutes = { partner: string; before: number; after: number };

/**
 * The minutes the moved set shares with `partnerId` now and at the card's place, read from the
 * published timetable. Null when either set is not on it, the move is to another day, or a time does
 * not read.
 */
export function cardSharedMinutes(
  timetable: readonly SetSlot[],
  move: StackMove,
  partnerId: string,
  partnerName: string,
): SharedMinutes | null {
  const mover = timetable.find((slot) => slot.act_id === move.actId);
  const partner = timetable.find((slot) => slot.act_id === partnerId);
  const start = clockMinutes(move.start);
  if (!mover || !partner || start === null || move.day !== mover.day || partner.day !== mover.day) return null;
  const length = mover.end - mover.start;
  const span = (window: { start: number; end: number } | null) => (window ? window.end - window.start : 0);
  return {
    partner: partnerName,
    before: span(overlapWindow(mover, partner)),
    after: span(overlapWindow({ start, end: start + length }, partner)),
  };
}

/** A span of the day in minutes from its start. */
type Span = { start: number; end: number };

/**
 * The minutes a move's set shares with `partnerId` before and after the move, read from `timetable` (the
 * published one, or the plan's). Null when the minutes do not read.
 */
function moveFigures(
  timetable: readonly SetSlot[],
  move: StackMove,
  partnerId: string,
  partnerName: string,
): { minutes: SharedMinutes } | null {
  const minutes = cardSharedMinutes(timetable, move, partnerId, partnerName);
  return minutes ? { minutes } : null;
}

/** What the timetable engine answered for one tested place, as Try a move holds it: the set's answer and the place. */
export type TestedAnswer = {
  result: Pick<MovesResult, "act" | "actId" | "from" | "legalPlaces">;
  option: Pick<PlacedOption, "stageId" | "stage" | "day" | "start" | "end" | "after">;
};

/**
 * One tested place as a decision the hero's drawing can draw (`buildDayGraph`): the clash is the set and
 * `partnerId`, the set its minutes are read against; the move is the engine's place for it (stage, day, start and
 * end) and whether that changes its stage. `buildDayGraph` reads only those: the two ids and the move's set, day,
 * stage, start, end and stage change, and it takes every rank, minute and window it draws from the report and from
 * the timetable. The fields it never reads carry the engine's own figures (the index after, the legal places), the
 * timetable's minutes the lines above print, or no value (`null`, or `NaN` for a number with no source), so nothing
 * here is a default. Null when the set or its partner is not on `timetable`, they play on different days, or the
 * place is on another day or its times do not read.
 */
export function testedDecision(
  preset: Pick<Preset, "report">,
  timetable: readonly SetSlot[],
  answer: TestedAnswer,
  partnerId: string,
): Decision | null {
  const { result, option } = answer;
  const slot = timetable.find((item) => item.act_id === result.actId);
  const partner = timetable.find((item) => item.act_id === partnerId);
  const start = clockMinutes(option.start);
  if (!slot || !partner || start === null || clockMinutes(option.end) === null) return null;
  if (partner.day !== slot.day || option.day !== slot.day) return null;
  const span = (window: Span | null) => (window ? window.end - window.start : 0);
  const ranked = preset.report.clashes.find(
    (clash) =>
      clash.day === slot.day &&
      ((clash.a.act_id === result.actId && clash.b.act_id === partnerId) ||
        (clash.a.act_id === partnerId && clash.b.act_id === result.actId)),
  );
  return {
    day: slot.day,
    skippedLocked: 0,
    skippedNoPlace: 0,
    publishedBudget: null,
    clash: {
      aId: result.actId,
      bId: partnerId,
      rank: ranked?.rank ?? Number.NaN,
      minutes: span(overlapWindow(slot, partner)),
    },
    move: {
      actId: result.actId,
      act: result.act,
      from: result.from,
      stageId: option.stageId,
      stage: option.stage,
      day: option.day,
      start: option.start,
      end: option.end,
      minutesMoved: start - slot.start,
      legalPlaces: result.legalPlaces,
      stageChanged: option.stageId !== slot.stage_id,
      budgetAfter: option.after ?? Number.NaN,
      minutesSharedAfter: span(overlapWindow({ start, end: start + (slot.end - slot.start) }, partner)),
      alternative: null,
      flagsNow: null,
      flagsAfter: null,
      costliestAfter: undefined,
    },
    rule: null,
    ruleChange: null,
  };
}

/**
 * The hero's drawing of one tested place: the day on `timetable` (the plan's, the published one with the kept
 * moves made: the timetable the place's lines are read from), with the place drawn as the decision's move is.
 * Null when `testedDecision` is, or when the drawing would not show the move (the set shares no time with its
 * partner where it plays now), so a drawing here always shows its tested place.
 */
export function testedDrawing(
  preset: Preset,
  timetable: readonly SetSlot[],
  answer: TestedAnswer,
  partnerId: string,
): DayGraphModel | null {
  const decision = testedDecision(preset, timetable, answer, partnerId);
  if (!decision) return null;
  const model = buildDayGraph({ ...preset, festival: { ...preset.festival, timetable: [...timetable] } }, decision, decision.day);
  return model?.move ? model : null;
}

/**
 * A tested place drawn with the hero's own drawing, in its short layout at every width: the stages around the
 * move, the set at the tested place with its published slot dashed, the minutes it still shares with its partner
 * hatched and any new overlap dashed with its tag. Keyed by the place, so another set or place draws a new frame
 * at once, with no flight. The drawing keeps its own role="group", title and description; the lines above say
 * the same minutes in words.
 */
function TestedDrawing({ model }: { model: DayGraphModel }) {
  const { move } = model;
  const place = move ? `${move.actId}@${move.to.stageIndex}:${move.to.start}` : "none";
  return (
    <div data-tested-drawing className="mt-5 min-w-0">
      <DayGraph key={`${model.presetId}|${model.day}|${place}`} model={model} view="moved" layout="short" />
    </div>
  );
}

/** "1.5 → 1.2 (−0.3, lower is better)": the index before and after, in tabular figures, as the card prints it. */
function IndexValue({ before, after }: { before: number; after: number }) {
  return (
    <>
      <span className="font-mono tabular-nums">
        <span>{before.toFixed(1)}</span> →{" "}
        <span className="font-semibold">{after.toFixed(1)}</span>
      </span>{" "}
      <span className="text-muted-foreground">
        (<span className="font-mono tabular-nums">{signedDelta(Math.round((after - before) * 10) / 10)}</span>, lower is
        better)
      </span>
    </>
  );
}

/**
 * A place's clash changes, with the minutes each kept clash shares before and after (when they read), and the
 * overlaps it starts or lengthens with sets none of its lists shows (`outside`, the hero's order).
 */
export type PlaceChanges = ClashChanges & { shared?: SharedByName; outside?: GrowingOverlap[] };

/**
 * The clashes a place ends, adds and keeps, read from the timetable engine's lists for that set, with
 * the minutes each kept clash shares before and after, and the overlaps outside those lists that it starts
 * or lengthens, both read from the timetable already in memory.
 */
export function placeChanges(
  festival: Preset["festival"],
  timetable: readonly SetSlot[],
  result: MovesResult,
  option: PlacedOption,
): PlaceChanges {
  const planned = { festival: { ...festival, timetable: [...timetable] } };
  const home = currentPlacement(planned, result.actId);
  const after = placementOf(option);
  const changes = clashChanges(
    result.clashesNow,
    option.clashesAfter,
    home ? concurrentActs(planned, result.actId, home) : null,
    after ? concurrentActs(planned, result.actId, after) : null,
  );
  const shared = sharedMinutesByName(
    festival.acts,
    timetable,
    result.actId,
    home,
    after,
    changes.keeps.map((keep) => keep.name),
  );
  const listed = new Set([...changes.ends, ...changes.adds, ...changes.keeps].map((item) => item.name));
  const outside = outsideGrowth(festival.acts, timetable, result.actId, home, after, listed);
  return { ...changes, shared, outside };
}

/**
 * The decision card's move for the set shown, read as one result before anything is kept, open on paper
 * under a 1px top rule: the set, its place and times, then the minutes shared in one large line (from the published timetable), the Clash
 * Budget Index before and after in tabular figures, the rule status and the clashes it removes and adds in one
 * 14px line, the hero’s drawing of the tested place when one is passed (`drawing`), then one action row: Keep this move and
 * Show every legal place. The index comes from the card
 * when it passed one, else from the timetable engine's list of legal places for the set (`check`); the
 * rule status and the clashes only ever come from that list, and read "Checking rules…" until it is in.
 */
export function TestedPlace({
  card,
  mover,
  stage,
  end,
  minutes,
  drawing,
  check,
  changes,
  keepFull,
  onKeep,
  onShowAll,
  label = "Tested place",
  showAll = null,
  rules,
  roomKey = "",
  outside = true,
}: {
  card: CardMove;
  /** The moved set's name, for "Listed clashes of {mover}:". */
  mover: string | null;
  stage: string;
  end: string | null;
  minutes: SharedMinutes | null;
  /** The hero’s drawing of this place (`testedDrawing`), or null to draw none (the card’s own move: the hero draws it). */
  drawing: DayGraphModel | null;
  check: MoveCheck | null;
  changes: PlaceChanges | null;
  keepFull: boolean;
  onKeep: () => void;
  onShowAll: () => void;
  /** The label over the result: "Tested place" for the card's move, "Best tested place" for a picked set's first. */
  label?: string;
  /** When "Show every legal place" opens a list on this page rather than asking for one: whether it is open. */
  showAll?: { expanded: boolean; controls: string } | null;
  /** What a legal place was checked against, with the shown day's values (`rulesChecked`). */
  rules: string;
  /** The plan the place is checked on top of (encoded), so a new question drops a verdict room held for the last. */
  roomKey?: string;
  /**
   * While the rules are checked: whether the place may start or lengthen an overlap outside the list
   * (`mayGrowOutside`), so the verdict holds an outside line's room. Held when not known.
   */
  outside?: boolean;
}) {
  const fullHelpId = useId();
  const cardBefore = card.indexBefore ? Number(card.indexBefore) : Number.NaN;
  const cardAfter = card.indexAfter ? Number(card.indexAfter) : Number.NaN;
  const ready = check?.status === "ready" ? check : null;
  const index =
    Number.isFinite(cardBefore) && Number.isFinite(cardAfter)
      ? { before: cardBefore, after: cardAfter }
      : ready && ready.result.before !== null && ready.option.after !== null
        ? { before: ready.result.before, after: ready.option.after }
        : null;
  const checking = check === null || check.status === "checking";
  const minutesBefore = typeof card.minutesBefore === "number" ? card.minutesBefore : (minutes?.before ?? null);
  const minutesAfter = typeof card.minutesAfter === "number" ? card.minutesAfter : (minutes?.after ?? null);
  const hasMinutes = minutesBefore !== null && minutesAfter !== null;
  const listedName = mover ?? drawing?.move?.name ?? null;
  // The summary's last sentence when the outside line shows: "Outside the list, 1 overlap starts or grows."
  const outsideSentence = changes ? outsideCount(changes.outside?.length ?? 0) : null;
  return (
    // A result, not a control group: it sits open on paper under one 1px decorative top rule, as the
    // hero receipt does, with no other edge, no fill and no side padding.
    <div data-tested-card className="border-t border-border pt-5 sm:pt-6">
      <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">{label}</p>
      {/* The dateline names the set it tested, then its stage and times: "Sprints at Woodsies · 14:15–15:15".
          The one place the tested time is printed. With no mover name it reads as before: "Woodsies · …". */}
      <p data-dateline className="mt-1 text-[0.9375rem] leading-snug">
        {listedName ? (
          <>
            <span className="font-semibold">{listedName}</span> at {stage}
          </>
        ) : (
          <span className="font-semibold">{stage}</span>
        )}
        {" · "}
        <span className="font-mono tabular-nums">
          {card.move.start}
          {end ? `–${end}` : ""}
        </span>
      </p>
      <div className="mt-4">
        {/* The minutes shared, set large in the condensed face: "45 → 30 min shared with Katy J Pearson". */}
        {hasMinutes ? (
          <p className="type-numeral text-2xl leading-tight break-words">
            {minutesBefore} → {minutesAfter} min shared
            {minutes ? <> with {minutes.partner}</> : null}
          </p>
        ) : null}
        <p className={cn("text-[0.9375rem] leading-snug", hasMinutes && "mt-1.5")}>
          <span className="text-muted-foreground">Index </span>
          {index ? (
            <IndexValue before={index.before} after={index.after} />
          ) : checking ? (
            <span className="text-muted-foreground">checking…</span>
          ) : (
            <span className="text-muted-foreground">not scored here</span>
          )}
        </p>
        {/* The rule status with the rules it was checked against; then the listed clashes it changes, counted as
            before, with "listed" defined where it appears; then, when the place starts or lengthens an overlap
            none of the lists shows, the outside line in the hero's words. One 14px block, read out together.
            While the rules are checked it holds the room the answer's lines will take, and keeps it when they read
            shorter, so a late check moves nothing under it: the drawing, the actions, the rest of the page. */}
        <HeldRoom
          room={`${roomKey}|${card.move.actId}@${card.move.stageId}:${card.move.day}:${card.move.start}`}
          pending={checking}
          hold={check?.status === "ready" || check?.status === "unlisted"}
        >
          <div aria-live="polite" data-place-verdict className="mt-1.5 space-y-1 text-sm leading-snug break-words text-pretty">
            {checking ? (
              // "Checking rules…", in the room the answer's lines will take, so a late answer moves nothing under it.
              <VerdictRoom rules={rules} listedName={listedName} partner={minutes?.partner ?? null} long={false} outside={outside} />
            ) : ready ? (
              <>
                <RulesLine rules={rules} />
                {changes ? (
                  <>
                    <p data-listed-line>
                      {/* The endpoint lists at most three of the set's clashes before and after, so the counts are
                          of the listed clashes, and the line says what listed means. */}
                      {listedName ? <span className="text-muted-foreground">{listedLead(listedName)}</span> : null}
                      {clashParts(changes, changes.shared).map((part, i) => (
                        <span key={part.word}>
                          {i > 0 ? ", " : null}
                          {/* A count stays on the line of its word. */}
                          <span className="whitespace-nowrap">
                            <span className="font-mono tabular-nums">{part.count}</span> {part.word}
                          </span>
                          {part.minutes ? (
                            <span className="text-muted-foreground">
                              {" "}
                              (
                              <span className="font-mono tabular-nums">
                                {part.minutes.before} → {part.minutes.after}
                              </span>{" "}
                              min)
                            </span>
                          ) : null}
                        </span>
                      ))}
                      .
                      {outsideSentence ? (
                        <>
                          {" "}
                          <CountTogether sentence={outsideSentence} />
                        </>
                      ) : null}
                    </p>
                    <OutsideLine grows={changes.outside} />
                  </>
                ) : (
                  <p className="text-muted-foreground">Clashes not checked for this place.</p>
                )}
              </>
            ) : check?.status === "error" ? (
              <p className="text-muted-foreground">Not checked: the legal places did not load.</p>
            ) : (
              <p className="text-muted-foreground">Rules and clashes not checked for this place.</p>
            )}
          </div>
        </HeldRoom>
        {drawing ? <TestedDrawing model={drawing} /> : null}
      </div>
      {/* The receipt says the minutes in words; it shows only when the fact list has no minutes row. */}
      {hasMinutes || !card.receipt ? null : <p className="mt-3 text-sm leading-relaxed">{card.receipt}</p>}
      {/* The result's one inner separator: a decorative 1px hairline above the actions, the column's width. */}
      <div aria-hidden="true" data-actions-rule className="mt-6 border-t border-border" />
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button
          type="button"
          variant="default"
          disabled={keepFull}
          aria-describedby={keepFull ? fullHelpId : undefined}
          onClick={onKeep}
        >
          {keepFull ? "Plan is full" : "Keep this move"}
        </Button>
        <Button
          type="button"
          variant="ruled"
          aria-expanded={showAll ? showAll.expanded : undefined}
          aria-controls={showAll ? showAll.controls : undefined}
          onClick={onShowAll}
        >
          {showAll?.expanded ? "Hide every legal place" : "Show every legal place"}
          <ArrowRight
            aria-hidden="true"
            className={showAll ? (showAll.expanded ? "-rotate-90" : "rotate-90") : undefined}
          />
        </Button>
      </div>
      {keepFull ? (
        <p id={fullHelpId} className="mt-2 text-sm text-muted-foreground">
          Eight moves is the most a plan holds here. Undo one or start over.
        </p>
      ) : null}
    </div>
  );
}

/** A picked set's best tested place: the engine's first legal place, with what the tested-place card prints. */
export type BestPlace = {
  option: PlacedOption;
  move: StackMove;
  figures: { minutes: SharedMinutes } | null;
  /** The hero's drawing of the place (`testedDrawing`), against the same partner as `figures`. */
  drawing: DayGraphModel | null;
  changes: PlaceChanges;
};

/** The set a picked set's places are read against: its partner in `starterPairsOf`, the one the starting rows name. */
function pickedPartner(
  actId: string,
  preset: Preset,
  timetable: readonly SetSlot[],
  clashes: readonly { aId: string; bId: string }[],
): StarterPair | null {
  return starterPairsOf({ actIds: [actId], timetable, acts: preset.festival.acts, clashes, seed: null }).get(actId) ?? null;
}

/**
 * The hero's drawing of any listed place of a picked set (`testedDrawing`), against the partner its best place
 * reads (`pickedPartner`), on `timetable`, the plan's. Null with no partner or no drawing.
 */
export function placeDrawing(
  result: MovesResult,
  option: PlacedOption,
  preset: Preset,
  timetable: readonly SetSlot[],
  clashes: readonly { aId: string; bId: string }[],
): DayGraphModel | null {
  const partner = pickedPartner(result.actId, preset, timetable, clashes);
  return partner ? testedDrawing(preset, timetable, { result, option }, partner.partnerId) : null;
}

/**
 * A picked set's best tested place, read as the card's tested place is: the first place the engine
 * lists (lowest Clash Budget first), the minutes the set shares with its partner before and after (on
 * `timetable`, the plan's), the hero's drawing of the place against that partner, and the clashes the engine
 * lists for it there. Null with no legal place.
 */
export function bestPlace(
  result: MovesResult | null,
  preset: Preset,
  timetable: readonly SetSlot[],
  clashes: readonly { aId: string; bId: string }[],
): BestPlace | null {
  const option = result && result.movable ? (result.options[0] ?? null) : null;
  if (!result || !option) return null;
  const move: StackMove = { actId: result.actId, stageId: option.stageId, day: option.day, start: option.start };
  const partner = pickedPartner(result.actId, preset, timetable, clashes);
  return {
    option,
    move,
    figures: partner ? moveFigures(timetable, move, partner.partnerId, partner.partnerName) : null,
    drawing: partner ? testedDrawing(preset, timetable, { result, option }, partner.partnerId) : null,
    changes: placeChanges(preset.festival, timetable, result, option),
  };
}

/**
 * The right column once a set is picked, from 1024 px (display:none below, where the full list follows the
 * picker as before, so one copy shows at each width): its best tested place with Keep this move, and "Show
 * every legal place", which opens the full list under the two columns (`controls`). While the places load
 * it says so; a set that cannot move, or has no legal place, says that.
 */
export function BestPlaceColumn({
  status,
  result,
  best,
  pickedName,
  synthetic,
  keepFull,
  onKeep,
  open,
  controls,
  onToggle,
  rules,
  room,
  roomKey,
}: {
  status: "idle" | "loading" | "error" | "ready" | "invalid";
  result: MovesResult | null;
  best: BestPlace | null;
  pickedName: string | null;
  synthetic: boolean;
  keepFull: boolean;
  onKeep: (option: PlacedOption) => void;
  open: boolean;
  controls: string;
  onToggle: () => void;
  /** What the best place was checked against, with the shown day's values (`rulesChecked`). */
  rules: string;
  /** What the page knows of the place before the answer, for the room it holds while scoring (`PendingPlace`). */
  room?: PlaceRoom;
  /** The question being answered (the plan and the set), so a new pick drops a room held for the last one. */
  roomKey?: string;
}) {
  return (
    <div
      data-best-place
      className="mt-8 min-w-0 max-lg:hidden lg:col-span-7 lg:col-start-6 lg:row-start-2"
      aria-busy={status === "loading"}
    >
      {/* While the places are scored, the tested place's frame holds the room the place will take. */}
      <HeldRoom room={roomKey ?? pickedName ?? ""} pending={status === "loading"} hold={status === "ready"}>
        {status === "loading" ? (
          <PendingPlace label="Best tested place" name={pickedName ?? "this set"} room={room ?? NO_ROOM} rules={rules} synthetic={synthetic} />
        ) : result && best ? (
          <>
            {!result.priced ? <p className="mb-4 text-sm">{noSignalMove(synthetic, result.act)}</p> : null}
            <TestedPlace
              card={{ move: best.move, receipt: "" }}
              mover={result.act}
              stage={best.option.stage}
              end={best.option.end}
              minutes={best.figures?.minutes ?? null}
              drawing={best.drawing}
              check={{ status: "ready", result, option: best.option }}
              changes={best.changes}
              keepFull={keepFull}
              onKeep={() => onKeep(best.option)}
              onShowAll={onToggle}
              label="Best tested place"
              showAll={{ expanded: open, controls }}
              rules={rules}
            />
          </>
        ) : result ? (
          <div className="border-t border-border pt-5 sm:pt-6">
            <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Where {result.act} could go</p>
            <p className="mt-1 text-[0.9375rem] font-semibold">
              {result.movable ? "No free slot it may use breaks no rule." : `It cannot move: ${result.why ?? "it is fixed in place"}.`}
            </p>
          </div>
        ) : null}
      </HeldRoom>
    </div>
  );
}

/** The set a starting row names beside its own, and the minutes the two share on the list's timetable. */
export type StarterPair = { partnerId: string; partnerName: string; minutes: number };

/** The minutes two sets of the same day share on `timetable`; 0 when either is missing or they do not meet. */
function minutesShared(timetable: readonly SetSlot[], aId: string, bId: string): number {
  const a = timetable.find((slot) => slot.act_id === aId);
  const b = timetable.find((slot) => slot.act_id === bId);
  if (!a || !b || a.day !== b.day) return 0;
  const window = overlapWindow(a, b);
  return window ? window.end - window.start : 0;
}

/**
 * Each starting set where the list's timetable has it now, and the set it shares the most time with on
 * that day (its id and name), or null when it shares time with no set.
 */
function starterOverlapOf(
  actIds: readonly string[],
  timetable: readonly SetSlot[],
  nameOf: (id: string) => string | null,
): Map<string, { set: Span; partner: { id: string; name: string; minutes: number } | null }> {
  const out = new Map<string, { set: Span; partner: { id: string; name: string; minutes: number } | null }>();
  for (const actId of actIds) {
    const slot = timetable.find((item) => item.act_id === actId);
    if (!slot || out.has(actId)) continue;
    let best: { id: string; name: string; minutes: number } | null = null;
    for (const other of timetable) {
      if (other.act_id === actId || other.day !== slot.day) continue;
      const window = overlapWindow(slot, other);
      const minutes = window ? window.end - window.start : 0;
      const name = nameOf(other.act_id);
      if (minutes > (best?.minutes ?? 0) && name) best = { id: other.act_id, name, minutes };
    }
    out.set(actId, { set: { start: slot.start, end: slot.end }, partner: best });
  }
  return out;
}

/**
 * The one source of the partner a starting row names and the tested-move card prints, keyed by set:
 * for the card's set, the card's own pair when it carries one; else the costliest clash the set is in
 * that still shares time on the list's timetable (`clashes`, costliest first: the day's ranked clashes,
 * or the plan's once a move is kept); else the set it shares the most time with. `minutes` is what the
 * set and that partner share on `timetable`, the one the list is built from. A set that shares time
 * with no set has no entry, so no row prints a figure without a name.
 */
export function starterPairsOf({
  actIds,
  timetable,
  acts,
  clashes,
  seed,
}: {
  actIds: readonly string[];
  timetable: readonly SetSlot[];
  acts: readonly { id: string; name: string }[];
  clashes: readonly { aId: string; bId: string }[];
  seed: { actId: string; partnerId: string } | null;
}): Map<string, StarterPair> {
  const nameOf = (id: string) => acts.find((act) => act.id === id)?.name ?? null;
  const longest = starterOverlapOf(actIds, timetable, nameOf);
  const out = new Map<string, StarterPair>();
  for (const actId of actIds) {
    if (out.has(actId)) continue;
    const seeded = seed && seed.actId === actId ? seed.partnerId : null;
    const seededName = seeded ? nameOf(seeded) : null;
    if (seeded && seededName) {
      out.set(actId, { partnerId: seeded, partnerName: seededName, minutes: minutesShared(timetable, actId, seeded) });
      continue;
    }
    let found: StarterPair | null = null;
    for (const clash of clashes) {
      const partnerId = clash.aId === actId ? clash.bId : clash.bId === actId ? clash.aId : null;
      const partnerName = partnerId ? nameOf(partnerId) : null;
      const minutes = partnerId ? minutesShared(timetable, actId, partnerId) : 0;
      if (partnerId && partnerName && minutes > 0) {
        found = { partnerId, partnerName, minutes };
        break;
      }
    }
    const fallback = longest.get(actId)?.partner ?? null;
    if (!found && fallback) found = { partnerId: fallback.id, partnerName: fallback.name, minutes: fallback.minutes };
    if (found) out.set(actId, found);
  }
  return out;
}

/** A plan that could not be priced: try again, or start over. */
function PlanError({ onRetry, onStartOver }: { onRetry: () => void; onStartOver: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-destructive bg-card p-5">
      <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-destructive">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
        Could not score this plan.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onRetry}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
        <Button type="button" variant="outline" onClick={onStartOver}>
          Start over
        </Button>
      </div>
    </div>
  );
}

/**
 * The intro's last sentence, on locked sets. On a published day the locks are this app's, so the words say
 * so; the invented day keeps its own words. The short form, on every published day: the rule itself (the
 * last set on each stage) is stated in the board's key, on /method and in the brief, so the intro keeps its
 * height.
 */
export function lockedSetsLine(synthetic: boolean): string {
  return synthetic ? "Locked sets stay put." : "Sets this app locks stay put.";
}

/**
 * "Try a move": the visitor picks a set and sees every legal place it could go, priced by the
 * timetable engine, with the Clash Budget move and the clashes it ends and adds for the place they
 * choose. A place can be kept, and the next set is then priced on top of the kept moves; the plan
 * card shows them priced together against the published reading. No language model is involved
 * and nothing is applied: with no kept moves the answer comes from `GET /api/presets/{id}/moves`,
 * with kept moves from `POST /api/presets/{id}/whatif`, and the timetable above never changes.
 * `ranked` is the day's priced clashes, costliest first. `onPlanChange` hears the kept moves and the
 * place being tried, so the grid can draw them, and null when there is neither.
 */
export function TryAMove({
  preset,
  day,
  ranked,
  isLocked,
  onPlanChange,
  onPick,
  onRulePreview,
  seedStep = null,
  seedRule = null,
  onKeptChange,
  cardMove = null,
}: {
  preset: Preset;
  day: number;
  ranked: readonly PairClash[];
  isLocked: (actId: string) => boolean;
  onPlanChange?: (preview: PlanPreview | null) => void;
  /**
   * The visitor pressed for a set's places (a starting row, the select, "Show every legal place", "Next"): heard in
   * the press itself, so the page can open the board for the tested place to come while the browser still counts
   * the change as the visitor's own, instead of when a late answer lands (round 37).
   */
  onPick?: () => void;
  /** A change previewed from "Keep two sets apart": two ghost slots, never part of the kept plan. */
  onRulePreview?: (preview: RulePreview | null) => void;
  /**
   * The decision card's move or change, or an agent run's tested place: a new `nonce` makes it the kept
   * plan (or adds it to the plan, `mode: "add"`, see `seededPlan`); the same one does nothing. Neither source scrolls the page or moves focus: the source says
   * "Kept in your plan." itself and offers the way here.
   */
  seedStep?: SeedStep | null;
  /** The decision card's rule: a new `nonce` runs the search for the pair in "Keep two sets apart". */
  seedRule?: { nonce: number; aId: string; bId: string } | null;
  /**
   * Hears the steps the plan really holds: the kept steps once the timetable engine has priced them
   * together (`/whatif`), and none while that answer is out or after it refused them. So the decision
   * card and the agent panel say "Kept" only for a step the plan holds.
   */
  onKeptChange?: (steps: readonly StackStep[]) => void;
  /**
   * The card's move and its receipt: a plan that is just that move prints the receipt under its step,
   * and while no set is picked the move shows as one evaluated row under the set it moves.
   */
  cardMove?: CardMove | null;
}) {
  const selectId = useId();
  const startLabelId = useId();
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const planRef = useRef<HTMLDivElement | null>(null);
  const sets = useMemo(() => movableSets(preset, day), [preset, day]);
  const groups = useMemo(() => byStage(sets), [sets]);
  const range = useMemo(() => scaleRange(preset.report.baseline), [preset]);
  const unpriced = useMemo(() => new Set(preset.report.coverage.unscored.map((act) => act.act_id)), [preset]);
  // What every legal place is checked against, with this day's own values.
  const rules = useMemo(() => rulesChecked(preset, day), [preset, day]);

  // The page is drawn in the browser once the festival day has loaded, so the tab's saved plan can
  // be read when this section first renders.
  const [moves, setMoves] = useState<readonly StackStep[]>(() => storedPlan(preset));
  // A line above the plan when a button took the place of earlier steps ("Replaced ..."), and whether the
  // plan came from the decision card, so the plan can offer the way back to it.
  const [notice, setNotice] = useState<string | null>(null);
  const [fromCard, setFromCard] = useState(false);
  const moved = useMemo(() => movedActs(moves), [moves]);
  const used = moveCount(moves);
  const timetable = useMemo(() => applyMoves(preset.festival.timetable, moves), [preset, moves]);

  const [picked, setPicked] = useState<string | null>(null);
  // The plan Keep, Undo or Start over just made, and the set picked after it: the status region
  // speaks the plan's reading until another set is picked.
  const [planNews, setPlanNews] = useState<{
    moves: string;
    picked: string | null;
  } | null>(null);
  const [choice, setChoice] = useState<{ key: string; index: number } | null>(null);
  // A set from another day, a locked one or one already in the plan is never asked about.
  const actId = picked && !moved.has(picked) && sets.some((set) => set.actId === picked && !set.locked) ? picked : null;
  const pickedName = sets.find((set) => set.actId === actId)?.name ?? null;
  const state = usePlan(preset.id, moves, actId);
  // While the plan's answer is out (after Keep this move, an undo or a new pick), its place holds room down past the
  // screen's foot, so a plan that lands late, however long, moves nothing under it that a visitor sees (round 37).
  useHeldRoom(planRef, state.status === "loading");
  const result = state.status === "ready" ? state.options : null;
  const choiceKey = `${encodeMoves(moves)}:${actId ?? ""}`;
  const index = choice && choice.key === choiceKey ? choice.index : 0;
  const chosen = result && result.movable ? (result.options[Math.min(index, result.options.length - 1)] ?? null) : null;
  // From 1024 px a picked set's answer fills the right column with its best tested place (the engine's first
  // legal place, lowest Clash Budget first), and "Show every legal place" opens the full list under the two
  // columns. Below 1024 px the full list shows at once, as before. Open for one set on one plan only.
  const [allFor, setAllFor] = useState<string | null>(null);
  const allOpen = allFor === choiceKey;
  const placesId = useId();
  const placesHeadingRef = useRef<HTMLHeadingElement | null>(null);
  // The list "Show every legal place" asked for from the card's tested place: its heading takes focus once it
  // is on the page, so focus never drops to the page when the button that was pressed goes.
  const focusPlaces = useRef<string | null>(null);
  useEffect(() => {
    if (!result || focusPlaces.current !== choiceKey) return;
    const heading = placesHeadingRef.current;
    if (!heading) return;
    focusPlaces.current = null;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    heading.focus({ preventScroll: true });
  }, [result, choiceKey]);

  // Two sets to start with (`START_WITH`): the decision card's pair when both may move, else the sets of the
  // day's costliest clashes; every other set stays one pick away in the select under them.
  const cardA = cardMove?.pair?.aId ?? null;
  const cardB = cardMove?.pair?.bId ?? null;
  const starters = useMemo(() => {
    if (moves.length > 0 && state.plan) {
      const pickable = sets.map((set) => ({
        ...set,
        locked: set.locked || isLocked(set.actId),
      }));
      return planStarters(state.plan.clashes, pickable, moved, START_WITH);
    }
    const free = (id: string) => !moved.has(id) && !isLocked(id) && sets.some((set) => set.actId === id && !set.locked);
    const lead = (cardA && cardB ? [cardA, cardB] : []).filter(free).flatMap((id) => {
      const set = sets.find((item) => item.actId === id);
      return set ? [{ actId: set.actId, name: set.name }] : [];
    });
    const rest = startingSets(ranked, isLocked).filter(
      (set) => !moved.has(set.actId) && !lead.some((item) => item.actId === set.actId),
    );
    return [...lead, ...rest].slice(0, START_WITH);
  }, [moves.length, state.plan, sets, ranked, isLocked, moved, cardA, cardB]);

  // After the first kept step: the next clash in the published day's ranking that no kept step addresses (the
  // plan's own ranking is not recomputed for it), and the set in it that may move.
  const nextPair = useMemo(
    () => (moves.length > 0 ? nextRankedPair(ranked, moved, (id) => isLocked(id) || !sets.some((set) => set.actId === id && !set.locked)) : null),
    [moves.length, ranked, moved, isLocked, sets],
  );

  // The set the picker opens on, so the section never arrives empty: the decision card's move when it
  // is still a set that may move, else the first set to start with. Only shown; a starting set's places
  // are asked for when the visitor presses for them or picks it. The card's move alone is checked at
  // once (`useMoveCheck`), so its tested place can state its rule status before Keep this move.
  const preselect = useMemo(() => {
    if (actId) return null;
    const free = (id: string) =>
      !moved.has(id) && !isLocked(id) && sets.some((set) => set.actId === id && !set.locked);
    const seed = cardMove?.move.actId;
    if (seed && free(seed)) return seed;
    return starters.find((set) => free(set.actId))?.actId ?? null;
  }, [actId, moved, isLocked, sets, cardMove, starters]);
  const shown = actId ?? preselect;
  const shownName = shown ? (sets.find((set) => set.actId === shown)?.name ?? null) : null;
  const seedShown = !actId && preselect !== null && cardMove?.move.actId === preselect ? cardMove : null;
  const seedStage = seedShown
    ? (preset.festival.stages.find((stage) => stage.id === seedShown.move.stageId)?.name ?? seedShown.move.stageId)
    : null;
  // The moved set keeps its length, so its new end is the card's start plus the published length.
  const seedEnd = useMemo(() => {
    if (!seedShown) return null;
    const slot = preset.festival.timetable.find((candidate) => candidate.act_id === seedShown.move.actId);
    const start = clockMinutes(seedShown.move.start);
    return slot && start !== null ? formatClock(start + (slot.end - slot.start)) : null;
  }, [seedShown, preset]);
  // The clashes a starting row reads its partner from, costliest first: the day's ranked clashes, or the
  // plan's (the list `planStarters` reads) once a move is kept and the plan is priced.
  const pairClashes = useMemo(() => {
    if (moves.length > 0 && state.plan) {
      const idOf = (name: string) => preset.festival.acts.find((act) => act.name === name)?.id ?? null;
      return state.plan.clashes.flatMap((clash) => {
        const aId = idOf(clash.a);
        const bId = idOf(clash.b);
        return aId && bId ? [{ aId, bId }] : [];
      });
    }
    return ranked.map((clash) => ({ aId: clash.a.act_id, bId: clash.b.act_id }));
  }, [moves.length, state.plan, preset, ranked]);
  // One source for the partner of every starting row and of the card's set (`starterPairsOf`): the rows
  // and the tested-move card read their partner from it, so the two always name the same set.
  const cardActId = cardMove?.move.actId ?? null;
  const cardPair = cardMove?.pair ?? null;
  const starterPairs = useMemo(() => {
    const seed =
      cardActId && cardPair && (cardPair.aId === cardActId || cardPair.bId === cardActId)
        ? { actId: cardActId, partnerId: cardPair.aId === cardActId ? cardPair.bId : cardPair.aId }
        : null;
    return starterPairsOf({
      actIds: [...starters.map((set) => set.actId), ...(cardActId ? [cardActId] : [])],
      timetable,
      acts: preset.festival.acts,
      clashes: pairClashes,
      seed,
    });
  }, [starters, cardActId, cardPair, timetable, preset, pairClashes]);

  // The minutes the moved set shares with the partner `starterPairs` names for it, now and at the card's
  // place, read from the published timetable; shown only when the card carries its pair or its receipt
  // names that set, so the figures and the sentence always speak of the same pair.
  const seedFigures = useMemo(() => {
    if (!seedShown) return null;
    const mover = seedShown.move.actId;
    const nameOf = (id: string) => preset.festival.acts.find((act) => act.id === id)?.name ?? null;
    const partnerId = starterPairs.get(mover)?.partnerId ?? null;
    const partnerName = partnerId ? nameOf(partnerId) : null;
    if (!partnerId || !partnerName || (!seedShown.pair && !seedShown.receipt.includes(partnerName))) return null;
    return moveFigures(preset.festival.timetable, seedShown.move, partnerId, partnerName);
  }, [seedShown, preset, starterPairs]);
  const seedMinutes = seedFigures?.minutes ?? null;
  // The card's move checked against the engine's legal places for its set, so the tested place can say
  // its index, rule status and clashes before Keep this move; "Checking rules…" until the answer is in.
  const seedCheck = useMoveCheck(preset.id, moves, seedShown?.move ?? null);
  // Whether that answer can carry an outside line, so its verdict holds that line's room only then.
  const seedOutside = useMemo(
    () => (seedShown ? mayGrowOutside(preset, timetable, seedShown.move) : false),
    [seedShown, preset, timetable],
  );
  const seedChanges = useMemo(
    () =>
      seedCheck?.status === "ready"
        ? placeChanges(preset.festival, timetable, seedCheck.result, seedCheck.option)
        : null,
    [seedCheck, preset, timetable],
  );

  // The picked set's best tested place, read as the card's tested place is: the engine's first listed place,
  // the minutes it shares with its partner before and after (from the plan's timetable) and the clashes the
  // engine lists for it there.
  const best = useMemo(() => bestPlace(result, preset, timetable, pairClashes), [result, timetable, preset, pairClashes]);
  // The visitor's presses are watched from the start, so the first answer already knows whether it came with one.
  useEffect(() => watchPresses(), []);
  // While a picked set's places are scored, its best place and its list hold the room the answer will take: the
  // drawing's height in its short layout (the day's stages, three at most, on the plan's timetable), and what the
  // page already knows of the place: the set it is read against with the minutes they share now, and whether the
  // day's coverage scores the set.
  const drawingRoom = useMemo(() => {
    const model = buildDayGraph({ ...preset, festival: { ...preset.festival, timetable: [...timetable] } }, null, day);
    return model ? drawingHeight(model, "short") : null;
  }, [preset, timetable, day]);
  const placeRoom = useMemo<PlaceRoom>(() => {
    const partner = actId ? pickedPartner(actId, preset, timetable, pairClashes) : null;
    return {
      partner: partner ? { name: partner.partnerName, minutes: partner.minutes } : null,
      unscored: actId !== null && unpriced.has(actId),
      drawing: partner ? drawingRoom : null,
    };
  }, [actId, preset, timetable, pairClashes, unpriced, drawingRoom]);
  // The place chosen in the full list, drawn with the hero's drawing against the same partner; a new drawing
  // for each place chosen.
  const chosenDrawing = useMemo(
    () => (result && chosen ? placeDrawing(result, chosen, preset, timetable, pairClashes) : null),
    [result, chosen, preset, timetable, pairClashes],
  );


  // What the grid may draw: the kept moves and the place being tried on top of them.
  const trying = useMemo<GhostSlot | null>(() => {
    const at = chosen ? placementOf(chosen) : null;
    return chosen && at && result
      ? {
          actId: result.actId,
          stageId: chosen.stageId,
          day: at.day,
          start: at.start,
          end: at.end,
        }
      : null;
  }, [chosen, result]);
  const preview = useMemo(() => planPreview(preset.festival.timetable, moves, trying), [preset, moves, trying]);
  const previewKey = JSON.stringify(preview);
  const notify = useRef(onPlanChange);
  useEffect(() => {
    notify.current = onPlanChange;
  }, [onPlanChange]);
  const previewRef = useRef(preview);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(() => {
    notify.current?.(previewRef.current);
  }, [previewKey]);

  function update(next: readonly StackStep[]) {
    setMoves(next);
    storeMoves(preset.id, next);
  }

  // The rule panel previews through a stable callback, so its cleanup never fires on a re-render.
  const rulePreviewRef = useRef(onRulePreview);
  useEffect(() => {
    rulePreviewRef.current = onRulePreview;
  }, [onRulePreview]);
  const emitRulePreview = useCallback((next: RulePreview | null) => rulePreviewRef.current?.(next), []);

  // Where focus goes after a plan change, once the page has committed it (an effect, never a frame
  // callback, so it also runs when the tab is in the background): the plan card (scrolled to, or not),
  // or the set picker when no plan is left.
  const [focus, setFocus] = useState<{
    nonce: number;
    delay: number;
    target: "plan" | "plan-here" | "picker" | "picker-shown";
  }>({
    nonce: 0,
    delay: 900,
    target: "plan",
  });
  function focusOn(target: "plan" | "plan-here" | "picker" | "picker-shown", delay = 0) {
    setFocus((previous) => ({ nonce: previous.nonce + 1, delay, target }));
  }

  // A move or change seeded by the decision card (or a place an agent run tested) becomes the kept plan:
  // state adjusted while rendering, as React advises for a prop that changes. A plan that already holds it
  // is left as it is; one that does not is replaced, and the notice above the plan says so, unless the seed
  // asks to add (`seededPlan`): then it goes after the kept steps the engine priced it with, or nothing changes. The plan is
  // priced as any kept step is (this section's own `/whatif` request), which re-checks it against the
  // published timetable. Nothing scrolls and focus stays where it is: the source announces the keep and
  // offers "See your plan" (#your-plan), so the visitor is never carried off the card they pressed.
  const seedNonce = seedStep?.nonce ?? 0;
  const seedStepValue = seedStep?.step ?? null;
  const seedFrom = seedStep?.from ?? "card";
  const seedAdds = seedStep?.mode === "add";
  const seedBase = seedStep?.base ?? null;
  const [handledSeed, setHandledSeed] = useState(0);
  if (
    seedStepValue &&
    seedNonce !== 0 &&
    seedNonce !== handledSeed &&
    stepMoves(seedStepValue).every((move) => sets.some((set) => set.actId === move.actId && !set.locked)) &&
    (!isRuleStackStep(seedStepValue) ||
      (sets.some((set) => set.actId === seedStepValue.rule.aId) &&
        sets.some((set) => set.actId === seedStepValue.rule.bId)))
  ) {
    const outcome = seedOutcome(moves, seedStepValue);
    setHandledSeed(seedNonce);
    const next = seededPlan(moves, { step: seedStepValue, mode: seedAdds ? "add" : "replace", base: seedBase ?? undefined });
    if (next) {
      setMoves(next);
      setPicked(null);
      setPlanNews({ moves: encodeMoves(next), picked: null });
      if (seedAdds) {
        // Added after the kept steps: the plan card lists them all; nothing was replaced.
        setNotice(null);
      } else {
        // Only the card's own plan offers the way back to the card.
        setFromCard(seedFrom === "card");
        setNotice(
          outcome.kind === "replace"
            ? `Replaced your earlier ${pluralize(outcome.dropped, "kept step")} with this ${isRuleStackStep(seedStepValue) ? "change" : "move"}. Start over clears the plan.`
            : null,
        );
      }
    }
  }
  // Keep the tab's plan in step with the moves, whichever way they changed.
  useEffect(() => {
    storeMoves(preset.id, moves);
  }, [preset.id, moves]);
  // Tell the page what the plan holds, so the decision card and the agent panel can mark their own move or
  // change: the kept steps once the engine has priced them together (a plan priced for exactly these
  // steps), none before that answer is in or when it refused them (`invalid`, which keeps no plan).
  const held = state.plan ? moves : NO_STEPS;
  const keptOut = useRef(onKeptChange);
  useEffect(() => {
    keptOut.current = onKeptChange;
  }, [onKeptChange]);
  const heldNow = useRef(held);
  useEffect(() => {
    heldNow.current = held;
  }, [held]);
  const heldKey = state.plan ? encodeMoves(moves) : "";
  useEffect(() => {
    keptOut.current?.(heldNow.current);
  }, [heldKey]);
  useEffect(() => {
    if (focus.nonce === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const show = () => {
      if (focus.target === "picker") {
        selectRef.current?.focus();
        return;
      }
      if (focus.target === "picker-shown") {
        // The picker now shows the next pair's set: the picker column (with the tested place beside it from
        // 1024 px) is brought clear of the sticky header and nav when it fits the screen, else the field alone;
        // then the field takes focus.
        const select = selectRef.current;
        if (!select) return;
        const column = select.closest<HTMLElement>("[data-move-picker]");
        const fits = column !== null && column.getBoundingClientRect().height < window.innerHeight - 160;
        (fits ? column : select).scrollIntoView({ block: fits ? "start" : "center", behavior: reduce ? "auto" : "smooth" });
        select.focus({ preventScroll: true });
        return;
      }
      if (focus.target === "plan") {
        planRef.current?.scrollIntoView({
          block: "start",
          behavior: reduce ? "auto" : "smooth",
        });
      }
      planRef.current?.focus({ preventScroll: true });
    };
    const timer = window.setTimeout(show, reduce ? 0 : focus.delay);
    return () => window.clearTimeout(timer);
  }, [focus]);

  function keep(option: PlacedOption) {
    if (!actId || used >= MAX_STACK || moved.has(actId)) return;
    const next = [...moves, { actId, stageId: option.stageId, day: option.day, start: option.start }];
    update(next);
    setPicked(null);
    setNotice(null);
    setPlanNews({ moves: encodeMoves(next), picked: null });
    // The places card goes; the plan card is where the kept move now shows.
    focusOn("plan-here");
  }

  /** The decision card's move, kept from its tested-place row as Keep this move keeps any place. */
  function keepCardMove(move: StackMove) {
    if (used >= MAX_STACK || moved.has(move.actId)) return;
    const next = [...moves, { actId: move.actId, stageId: move.stageId, day: move.day, start: move.start }];
    update(next);
    setPicked(null);
    setNotice(null);
    setFromCard(true);
    setPlanNews({ moves: encodeMoves(next), picked: null });
    focusOn("plan-here");
  }

  /**
   * A listed change from "Keep two sets apart", kept as one step; the plan card takes focus. A change
   * for a pair the plan already has a change for takes that step's place, so a second change for the
   * same pair is never refused as impossible; the notice above the plan says it replaced the first.
   */
  function keepChange(step: RuleStackStep) {
    const outcome = keepChangeInPlan(moves, step);
    if (outcome.kind === "same") {
      focusOn("plan");
      return;
    }
    if (outcome.kind === "full") return;
    const next = outcome.steps;
    update(next);
    setPicked(null);
    const nameOf = (id: string) => sets.find((set) => set.actId === id)?.name ?? id;
    setNotice(
      outcome.kind === "replaced"
        ? `Replaced the earlier change for ${nameOf(step.rule.aId)} and ${nameOf(step.rule.bId)}.`
        : null,
    );
    setPlanNews({ moves: encodeMoves(next), picked: null });
    // The plan card is where the change now shows; focus reaches it once it is in the page.
    focusOn("plan");
  }

  function undo() {
    // One press takes back a whole step: a single move, or both sets of a kept change.
    const next = moves.slice(0, -1);
    update(next);
    setNotice(null);
    if (next.length === 0) setFromCard(false);
    setPlanNews({ moves: encodeMoves(next), picked });
    // With moves left the plan card is where the change shows; with none, the set picker.
    focusOn(next.length === 0 ? "picker" : "plan-here");
  }

  /** Every legal place for `id`, opened at once (from the card's tested place, or with no card move). */
  function showEvery(id: string) {
    const key = `${encodeMoves(moves)}:${id}`;
    setPicked(id);
    onPick?.();
    setAllFor(key);
    focusPlaces.current = key;
  }

  /** "Next: A × B": opens this section on that pair's movable set; focus goes to the picker that now shows it. */
  function openNext(actId: string) {
    setPicked(actId);
    onPick?.();
    setNotice(null);
    focusOn("picker-shown");
  }

  function startOver() {
    update([]);
    setPicked(null);
    setNotice(null);
    setFromCard(false);
    setPlanNews({ moves: "", picked: null });
    focusOn("picker");
  }

  const planned = moves.length > 0;
  const planSpoken =
    planNews &&
    planNews.moves === encodeMoves(moves) &&
    planNews.picked === picked &&
    state.status !== "error" &&
    state.status !== "invalid"
      ? planAnnouncement(state.plan && state.plan.steps.length === moves.length ? state.plan : null, moves.length)
      : null;
  const announcement =
    planSpoken ??
    (state.status === "ready" && result
      ? result.movable
        ? `${pluralize(result.legalPlaces, "legal place")} for ${result.act}.`
        : `${result.act} cannot move.`
      : state.status === "error"
        ? planned
          ? "Could not score this plan."
          : "Could not load the places for this set."
        : state.status === "invalid"
          ? "That plan is no longer possible."
          : "");

  return (
    <section id={TRY_A_MOVE_ID} aria-labelledby="try-a-move-heading">
      <div className="container-page grid gap-x-12 py-16 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:items-start lg:py-20">
        {/* From lg: the heading and intro alone in the first row, on the left; in the second row, the sets to
            start with and the picker on the left and the tested result on the right, both 32px under the
            intro, so the Start-with list's top rule is level with the result's and each column reads rule,
            label, content: the selection and what it tested read as one band. Only the tops align; each column's content sets its own bottom. The source
            (and Tab) order stays heading, ledger, select, result. On a phone: the same order, stacked. */}
        <div className="lg:col-span-5 lg:col-start-1 lg:row-start-1">
          <h2 id="try-a-move-heading" className="type-title">
            Move a set and see what it costs
          </h2>
          <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed">
            Pick a set to see every legal place on the 5-minute grid, scored. Keep a move to stack the next one.{" "}
            {lockedSetsLine(preset.synthetic === true)}
          </p>
        </div>

        <div data-move-picker className="mt-8 min-w-0 lg:col-span-5 lg:col-start-1 lg:row-start-2">
          {starters.length > 0 ? (
            // A list of choices, open on paper like the tested result beside it: one 1px decorative top rule
            // (level with the result's), "Start with" under it with the result label's top padding, then the
            // rows, each closed by a 1px hairline (the last too). No box, no fill.
            <div data-start-block className="border-t border-border pt-5 sm:pt-6">
              <p id={startLabelId} className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
                Start with
              </p>
              <ul aria-labelledby={startLabelId} data-start-ledger className="mt-1">
                {starters.map((set, i) => {
                  const place = setPlace(preset, set.actId);
                  const slot = timetable.find((item) => item.act_id === set.actId) ?? null;
                  const pair = starterPairs.get(set.actId) ?? null;
                  const minutes = pair && pair.minutes > 0 ? pair : null;
                  const selected = shown === set.actId;
                  // The hairlines either side of the chosen row go transparent (they keep their pixel, so no
                  // row moves), so its ink outline stands alone and no grey line runs along its corners. Each row
                  // keeps 4px above and below its button, so a focus outline (2px out, 2px wide) never meets the
                  // next row's button or its ink outline.
                  const besideSelected = selected || (i + 1 < starters.length && shown === starters[i + 1].actId);
                  return (
                    // Keyed by row, not by set: when a late plan answer changes which sets start the list, each row
                    // keeps its place and only its words change, so no row moves under a visitor (round 37).
                    <li
                      key={i}
                      data-start-rule
                      className={cn("border-b py-1", besideSelected ? "border-transparent" : "border-border")}
                    >
                      {/* A row of the running order, the column's full width and at least 56px tall, in one rhythm:
                          the set's start in tabular figures, a 16px slot for the check, then the act; its stage and
                          end; and, when it has a pair, the minutes it shares (raspberry tabular figures) with the set named after them,
                          on a line of their own. The chosen row is marked inside itself: a 1.5px ink outline inset
                          at its edge (an overlay, so the row never changes size; the text keeps 12px or more clear
                          of it), the check in its slot and its start in ink. No wash marks it; the wash is only the
                          other rows' hover. Keyboard focus is the cobalt outline drawn 2px OUTSIDE the row, so a
                          focused chosen row shows both, told apart by place as well as colour. */}
                      <button
                        type="button"
                        data-start-row
                        aria-pressed={actId === set.actId}
                        className={cn(
                          "relative grid min-h-14 w-full grid-cols-[3rem_1rem_minmax(0,1fr)] items-start gap-x-2.5 rounded-md px-4 py-3 text-left motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          selected ? null : "hover:bg-accent",
                        )}
                        onClick={() => {
                          setPicked(set.actId);
                          onPick?.();
                        }}
                      >
                        {selected ? (
                          <span
                            aria-hidden="true"
                            data-start-cue
                            className="pointer-events-none absolute inset-0 rounded-md border-[1.5px] border-foreground"
                          />
                        ) : null}
                        <span
                          data-start-time
                          className={cn(
                            "pt-px font-mono text-[0.8125rem] leading-5 tabular-nums",
                            selected ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {slot ? formatClock(slot.start) : null}
                        </span>
                        <span data-start-check className="flex h-5 items-center pt-px">
                          {selected ? <Check aria-hidden="true" className="size-4 text-foreground" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span data-start-name className="block text-[0.9375rem] leading-snug font-semibold break-words">
                            {set.name}
                          </span>
                          {/* Spaces between the lines, so the button's name reads as words. */}
                          {place ? " " : null}
                          {place ? (
                            <span data-start-meta className="mt-0.5 block text-[0.8125rem] leading-5 break-words text-muted-foreground">
                              {place.stage}
                              {slot ? (
                                <>
                                  {" "}
                                  · to <span className="font-mono tabular-nums">{formatClock(slot.end)}</span>
                                </>
                              ) : null}
                            </span>
                          ) : null}
                          {minutes ? " " : null}
                          {minutes ? (
                            // Its own line: the figure, then the partner, whose name wraps within it when it must; it is never cut.
                            <span data-start-pair className="mt-0.5 block text-[0.8125rem] leading-5 break-words text-muted-foreground">
                              <span data-start-minutes className="font-mono whitespace-nowrap text-primary tabular-nums">
                                {minutes.minutes} min
                              </span>{" "}
                              with <span data-start-partner className="text-foreground">{minutes.partnerName}</span>
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <label
            htmlFor={selectId}
            className={cn(
              "block text-[0.8125rem] leading-5 font-semibold text-muted-foreground",
              starters.length > 0 && "mt-6",
            )}
          >
            {starters.length > 0 ? "Or choose any set" : "Set to move"}
          </label>
          {/* The one boxed field here: the native select, the column's full width at every size, so its right edge
              is the Start-with list's right edge and the column has one right edge. */}
          <div data-move-select>
            <SetSelect
              id={selectId}
              selectRef={selectRef}
              value={shown ?? ""}
              display={fieldDisplay(sets, shown)}
              onChange={(event) => {
                setPicked(event.target.value || null);
                if (event.target.value) onPick?.();
              }}
            >
              <option value="" disabled>
                Choose a set
              </option>
              {groups.map((group) => (
                <optgroup key={group.stageId} label={group.stageName}>
                  {group.sets.map((set) => (
                    <option key={set.actId} value={set.actId} disabled={set.locked || moved.has(set.actId)}>
                      {set.start} {set.name}
                      {moved.has(set.actId)
                        ? " (already moved)"
                        : set.locked
                          ? " (locked by this app)"
                          : unpriced.has(set.actId)
                            ? " (not scored)"
                            : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </SetSelect>
          </div>
        </div>

        {/* The right column's only element: the tested result (or the way to every legal place). */}
        {shown && shownName && !actId ? (
          <div data-move-card className="mt-8 min-w-0 lg:col-span-7 lg:col-start-6 lg:row-start-2">
            {seedShown && seedStage ? (
              // While its rules are checked, its verdict holds the room the answer's lines will take (`TestedPlace`).
              <TestedPlace
                card={seedShown}
                mover={shownName}
                stage={seedStage}
                end={seedEnd}
                minutes={seedMinutes}
                // The card's own move: the hero above draws this same move, so here the figures stand alone.
                // A set the visitor picks, and each place it lists, gets its own drawing (BestPlaceColumn, MovesCard).
                drawing={null}
                check={seedCheck}
                changes={seedChanges}
                keepFull={used >= MAX_STACK}
                onKeep={() => keepCardMove(seedShown.move)}
                onShowAll={() => showEvery(shown)}
                rules={rules}
                roomKey={encodeMoves(moves)}
                outside={seedOutside}
              />
            ) : (
              <Button type="button" variant="ruled" onClick={() => showEvery(shown)}>
                Show every legal place
                <ArrowRight aria-hidden="true" />
              </Button>
            )}
          </div>
        ) : null}

        {/* From 1024 px, once a set is picked, the right column holds its best tested place, so it is never
            empty beside the picker; below 1024 px this column is not shown and the full list follows the
            picker as before (one copy at each width). */}
        {actId ? (
          <BestPlaceColumn
            status={state.status}
            result={result}
            best={best}
            pickedName={pickedName}
            synthetic={preset.synthetic === true}
            keepFull={used >= MAX_STACK}
            onKeep={keep}
            open={allOpen}
            controls={placesId}
            onToggle={() => setAllFor(allOpen ? null : choiceKey)}
            rules={rules}
            room={placeRoom}
            roomKey={choiceKey}
          />
        ) : null}

        {actId ? (
          <div id={placesId} className="lg:col-span-12" aria-busy={state.status === "loading"}>
            {/* While the places are scored, the list's frame holds the room the list will take. */}
            <HeldRoom room={choiceKey} pending={state.status === "loading"} hold={state.status === "ready"}>
              {state.status === "loading" ? (
                <div className="mt-6 lg:hidden">
                  <PlacesRoom
                    name={pickedName ?? "this set"}
                    rules={rules}
                    drawing={placeRoom.drawing}
                    range={range}
                    synthetic={preset.synthetic === true}
                  />
                </div>
              ) : state.status === "error" ? (
                <div className="mt-6">
                  {planned ? (
                    <PlanError onRetry={state.retry} onStartOver={startOver} />
                  ) : (
                    <div role="alert" className="rounded-md border border-destructive bg-card p-5">
                      <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-destructive">
                        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
                        Could not load the places for this set.
                      </p>
                      <Button type="button" variant="outline" className="mt-3" onClick={state.retry}>
                        <RotateCcw aria-hidden="true" />
                        Try again
                      </Button>
                    </div>
                  )}
                </div>
              ) : result ? (
                // From 1024 px the list waits under its best tested place until "Show every legal place" opens it.
                <div className={cn("mt-6", !allOpen && "lg:hidden")}>
                  <MovesCard
                    result={result}
                    preset={preset}
                    timetable={timetable}
                    kept={used}
                    range={range}
                    chosen={chosen}
                    keep={{ full: used >= MAX_STACK, onKeep: keep }}
                    onChoose={(next) => setChoice({ key: choiceKey, index: next })}
                    headingRef={placesHeadingRef}
                    rules={rules}
                    drawing={chosenDrawing}
                  />
                </div>
              ) : null}
            </HeldRoom>
          </div>
        ) : null}

        {planned ? (
          <div
            ref={planRef}
            id={YOUR_PLAN_ID}
            tabIndex={-1}
            role="group"
            aria-label="Your tested moves"
            // The sticky header (64 px) and, from 768 px, the section nav (44 px) sit over the top of the page:
            // the page's own scroll padding (63 / 82 px) plus this 48 px margin lands the plan below both.
            className="mt-6 scroll-mt-12 rounded-lg focus:outline-none lg:col-span-12"
            aria-busy={state.status === "loading" && !state.plan}
          >
            {notice ? (
              <p className="mb-3 rounded-md border border-border-strong bg-card px-3 py-2 text-sm">{notice}</p>
            ) : null}
            {state.status === "invalid" ? (
              <div role="alert" className="rounded-md border border-destructive bg-card p-5">
                <p className="flex items-start gap-2 text-[0.9375rem] font-semibold text-destructive">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>That plan is no longer possible. Undo the last step or start over to try again.</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={undo}>
                    Undo last step
                  </Button>
                  <Button type="button" variant="outline" onClick={startOver}>
                    Start over
                  </Button>
                </div>
              </div>
            ) : state.plan ? (
              <ScratchPlan
                preset={preset}
                day={day}
                plan={state.plan}
                moves={moves}
                range={range}
                onUndo={undo}
                onStartOver={startOver}
                backToDecision={fromCard}
                cardMove={cardMove}
                next={nextPair ? { label: nextLabel(nextPair), onPress: () => openNext(nextPair.actId) } : null}
              />
            ) : state.status === "error" && !actId ? (
              <PlanError onRetry={state.retry} onStartOver={startOver} />
            ) : state.status === "loading" ? (
              <div className="flex min-h-32 items-center gap-2 rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                Scoring your tested moves
              </div>
            ) : null}
          </div>
        ) : null}

        <KeepApart
          key={day}
          preset={preset}
          day={day}
          opening={cardMove?.pair ?? null}
          prefer={cardMove?.move.actId ?? null}
          seed={seedRule}
          onPreview={emitRulePreview}
          plan={moves}
          onKeep={keepChange}
        />

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </section>
  );
}
