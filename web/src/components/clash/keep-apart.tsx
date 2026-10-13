"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type Ref } from "react";
import { Check, ChevronDown, LoaderCircle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { dayName } from "@/lib/clashes";
import { movableSets, type PickableSet } from "@/lib/moves";
import type { PairClash, Preset } from "@/lib/preset";
import {
  BOTH_LOCKED,
  INDEX_NOTE,
  NO_RESULT,
  SEARCH_COVERS,
  SEARCH_RULE,
  SMALLEST_FIRST,
  collapseSimilar,
  fixGhosts,
  fixIndexLine,
  fixStep,
  fixSummary,
  ALREADY_KEPT,
  keepAnnouncement,
  lockedNote,
  plannedNote,
  replacedChangeAnnouncement,
  STAGE_FIT_GLOSS,
  moveLine,
  previewAnnouncement,
  requestRuleFixes,
  rowsCover,
  similarLine,
  roomNote,
  searchedSentence,
  type RuleAnswer,
  stageFitNote,
  type RuleFix,
  type RuleFixes,
  type RulePreview,
} from "@/lib/rule-fix";
import { formatRange, overlapWindow } from "@/lib/timetable";
import { cn } from "@/lib/utils";
import { pluralize } from "@/lib/format";
import {
  MAX_STACK,
  isRuleStackStep,
  moveCount,
  keepChangeInPlan,
  movedActs,
  sameRuleStep,
  type RuleStackStep,
  type StackStep,
} from "@/lib/stack";

import { PairStrip, bracketWords } from "./pair-strip";
import { useAnnouncement } from "./use-announcement";

/** Where the section sits, for links and the seed's scroll. */
export const KEEP_APART_ID = "keep-apart";

/** Under a change that moves a set to another stage: the production side has to agree before it is used. */
export const STAGE_SIGN_OFF = "Changes stage: needs production sign-off";

/** The order note when same-stage changes were moved ahead of stage changes. */
export const SAME_STAGE_FIRST =
  "Changes that keep every set on its stage come first; within each group, smallest changes first: fewest sets, then fewest minutes moved.";

/**
 * The route's changes with every change that keeps its sets on their stages ahead of any that moves a set to
 * another stage, each group in the route's own order (a stable sort; the search itself is unchanged).
 */
export function sameStageFirst(fixes: readonly RuleFix[]): RuleFix[] {
  return [...fixes.filter((fix) => fix.stageChanges === 0), ...fixes.filter((fix) => fix.stageChanges !== 0)];
}

/** A search, a refusal or a failure for one pair; `idle` before the first search. */
type Search =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; fixes: RuleFixes }
  | { status: "refused"; key: string; message: string }
  | { status: "error"; key: string };

/** Answers already in, by preset and unordered pair, so asking again for a pair costs no request. */
const answers = new Map<string, RuleFixes>();

function pairKey(presetId: string, a: string, b: string): string {
  return `${presetId}:${a < b ? `${a}|${b}` : `${b}|${a}`}`;
}

type Group = { id: string; label: string; sets: PickableSet[] };

function groupByStage(sets: readonly PickableSet[]): Group[] {
  const groups: Group[] = [];
  for (const set of sets) {
    const last = groups.at(-1);
    if (last && last.id === set.stageId) last.sets.push(set);
    else groups.push({ id: set.stageId, label: set.stageName, sets: [set] });
  }
  return groups;
}

function SetOptions({ groups }: { groups: readonly Group[] }) {
  return groups.map((group) => (
    <optgroup key={group.id} label={group.label}>
      {group.sets.map((set) => (
        <option key={set.actId} value={set.actId}>
          {set.start} {set.name}
          {set.locked ? " (locked)" : ""}
        </option>
      ))}
    </optgroup>
  ));
}

/** What an underline field shows for its chosen set: the start time in mono, then the act. */
export type SetFieldDisplay = { time: string; name: string } | null;

/**
 * A native select drawn as a card control: 48px tall, the 12px control corner, a 1px border-strong edge
 * (3:1, so the edge itself names the control) that turns ink on hover (keyboard focus adds the 2px focus
 * ring), 16px side padding, the chosen set's start time in mono at 13px and then its name at 15px
 * semibold, and one 12px chevron at the right in place of the browser's. The platform control sits over
 * the whole box (transparent, `appearance-none`), so a click, the keyboard and screen readers all reach the
 * real select; the drawn text is only what it shows.
 */
export function SetSelect({
  id,
  value,
  onChange,
  selectRef,
  describedBy,
  display = null,
  placeholder = "Choose a set",
  children,
}: {
  id: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  selectRef?: Ref<HTMLSelectElement>;
  describedBy?: string;
  /** The chosen set as the field draws it; null draws the placeholder. */
  display?: SetFieldDisplay;
  placeholder?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative mt-1.5 flex h-12 min-w-0 items-center rounded-md border border-border-strong bg-card pr-10 pl-4 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out hover:border-foreground",
        "has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-ring",
      )}
    >
      <span aria-hidden="true" className="pointer-events-none flex min-w-0 flex-1 items-baseline gap-2.5">
        {display ? (
          <>
            <span className="shrink-0 font-mono text-[0.8125rem] text-muted-foreground tabular-nums">{display.time}</span>
            <span className="min-w-0 truncate font-sans text-[0.9375rem] font-semibold">{display.name}</span>
          </>
        ) : (
          <span className="truncate text-[0.9375rem] text-muted-foreground">{placeholder}</span>
        )}
      </span>
      <select
        id={id}
        ref={selectRef}
        value={value}
        onChange={onChange}
        aria-describedby={describedBy}
        className="absolute inset-0 h-full w-full min-w-0 cursor-pointer appearance-none rounded-md bg-card text-[0.9375rem] text-foreground opacity-0 outline-none"
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-4 size-3 -translate-y-1/2 text-foreground"
      />
    </div>
  );
}

/** The field's drawing for a set id: its start and name, or null when it is not on the list. */
export function fieldDisplay(sets: readonly PickableSet[], actId: string | null): SetFieldDisplay {
  const set = actId ? sets.find((candidate) => candidate.actId === actId) : undefined;
  return set ? { time: set.start, name: set.name } : null;
}

/** Where a set plays on the published day: "Pyramid · 21:30–23:00". Null for a set not on the timetable. */
export function setWhere(preset: Pick<Preset, "festival">, actId: string): string | null {
  const slot = preset.festival.timetable.find((candidate) => candidate.act_id === actId);
  if (!slot) return null;
  const stage = preset.festival.stages.find((candidate) => candidate.id === slot.stage_id)?.name ?? slot.stage_id;
  return `${stage} · ${formatRange(slot)}`;
}

/** Where a set plays, split so the stage is set in the sans and the time in mono. Null off the timetable. */
export function setPlace(preset: Pick<Preset, "festival">, actId: string): { stage: string; time: string } | null {
  const slot = preset.festival.timetable.find((candidate) => candidate.act_id === actId);
  if (!slot) return null;
  const stage = preset.festival.stages.find((candidate) => candidate.id === slot.stage_id)?.name ?? slot.stage_id;
  return { stage, time: formatRange(slot) };
}

/**
 * The chosen set under its select, as a line of a running order: the act, then its stage and time in
 * mono. `id` lets the select point at it.
 */
export function SetCard({
  name,
  where,
  id,
  className,
  children,
}: {
  name: string;
  where: string | null;
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div id={id} className={cn("mt-2.5 min-w-0", className)}>
      <p className="text-[0.9375rem] leading-snug font-semibold break-words">{name}</p>
      {where ? <p className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">{where}</p> : null}
      {children}
    </div>
  );
}

/** One set as the strip draws it: its name and its published start and end, in minutes from the day's start. */
type StripSet = { name: string; start: number; end: number };

/**
 * The two chosen sets as the hero's `PairStrip` draws a clash: the first set the solid ink capsule, the
 * second the open capsule, hatched in its card window over the minutes they share, with straight cuts where
 * the shared time starts and ends, on the one strip domain and the same 9.5rem label column as the other
 * strips. The figure is the strip's own bracket and the minutes under it, as on the hero and in Try a move,
 * worded "N min at the same time" in 13px vermilion mono. The drawing is hidden from readers; a live line
 * says both names and the same figure for them. Drawn from the published timetable; nothing is requested.
 */
export function ChosenPairStrip({ a, b }: { a: StripSet; b: StripSet }) {
  const shared = overlapWindow(a, b);
  const minutes = shared ? shared.end - shared.start : 0;
  return (
    <div className="min-w-0">
      <PairStrip
        description={null}
        wording="same-time"
        lanes={[
          { key: "a", kind: "staying", name: a.name, start: a.start, end: a.end },
          { key: "b", kind: "now", name: b.name, start: b.start, end: b.end, minutes },
        ]}
      />
      <p aria-live="polite" className="sr-only">
        {a.name} and {b.name}: {bracketWords(minutes, "same-time")}
      </p>
    </div>
  );
}

/**
 * The pair the form opens on, so it never arrives half empty: the pair asked for when both are sets of
 * this day; else the costliest clash (the lowest rank) that has `prefer` in it; else the day's
 * costliest clash; else nothing. Read locally; nothing is searched until Find changes is pressed.
 */
function openingPair(
  preset: Pick<Preset, "festival" | "report">,
  day: number,
  wanted: { aId: string; bId: string } | null,
  prefer: string | null,
): { a: string; b: string } {
  const onDay = new Set(movableSets(preset, day).map((set) => set.actId));
  if (wanted && wanted.aId !== wanted.bId && onDay.has(wanted.aId) && onDay.has(wanted.bId)) {
    return { a: wanted.aId, b: wanted.bId };
  }
  const clashes = preset.report.clashes.filter(
    (clash) => clash.day === day && onDay.has(clash.a.act_id) && onDay.has(clash.b.act_id),
  );
  const costliest = (list: readonly PairClash[]) =>
    list.reduce<PairClash | null>((best, clash) => (!best || clash.rank < best.rank ? clash : best), null);
  const top =
    (prefer ? costliest(clashes.filter((clash) => clash.a.act_id === prefer || clash.b.act_id === prefer)) : null) ??
    costliest(clashes);
  return top ? { a: top.a.act_id, b: top.b.act_id } : { a: "", b: "" };
}

/** Whether a listed change can be kept now: it can, the plan has no room for it, or it is already in the plan. */
type KeepState = "ready" | "full" | "kept";

export function ChangeCard({
  fix,
  similar = 0,
  n,
  before,
  dayLabel,
  pressed,
  keepState,
  roomText,
  note,
  onPreview,
  onKeep,
  buttonRef,
}: {
  fix: RuleFix;
  /** Near-duplicates of this change (the same sets and stages, starts within five minutes) that share this row. */
  similar?: number;
  n: number;
  before: number | null;
  dayLabel: (day: number) => string | null;
  pressed: boolean;
  keepState: KeepState | null;
  roomText: string | null;
  /** Under the buttons: the change replaces the plan's earlier one, or the plan already moves its sets. */
  note: string | null;
  onPreview: () => void;
  onKeep: () => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  const index = fixIndexLine(fix, before);
  const flags = stageFitNote(fix);
  const roomId = useId();
  return (
    <li className="rounded-md border border-border bg-background p-3.5 sm:p-4">
      <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Change {n}</p>
      <ul className="mt-1.5 space-y-0.5 font-semibold">
        {fix.moves.map((move) => (
          <li key={move.actId} className="break-words">
            {moveLine(move, dayLabel(move.day))}
          </li>
        ))}
      </ul>
      {similar > 0 ? <p className="mt-0.5 text-sm text-muted-foreground">{similarLine(similar)}</p> : null}
      <p className="mt-1.5 text-sm text-muted-foreground tabular-nums">
        {fixSummary(fix)}
        {index ? ` · ${index}` : ""}
        {flags ? ` · ${flags}` : ""}
      </p>
      {flags ? <p className="mt-0.5 text-xs text-muted-foreground lg:text-[0.8125rem]">{STAGE_FIT_GLOSS}</p> : null}
      {/* A fact production must act on: ink, medium weight, plain text (no badge). */}
      {fix.stageChanges > 0 ? <p className="mt-0.5 text-sm font-medium text-foreground">{STAGE_SIGN_OFF}</p> : null}
      <p className="mt-0.5 text-sm">Adds no rule break; ends this overlap.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          ref={buttonRef}
          type="button"
          variant={pressed ? "ink" : "outline"}
          aria-pressed={pressed}
          onClick={onPreview}
        >
          Preview on the timetable
        </Button>
        {keepState ? (
          <Button
            type="button"
            variant="outline"
            // A kept row stays pressable: pressing it again says "Already in your plan." and keeps focus here.
            disabled={keepState === "full"}
            aria-describedby={keepState === "full" ? roomId : undefined}
            onClick={onKeep}
          >
            {/* The check marks a change the plan holds, never one that is only offered. */}
            {keepState === "kept" ? <Check aria-hidden="true" /> : null}
            {keepState === "kept" ? "Kept in your plan" : "Keep this change"}
          </Button>
        ) : null}
      </div>
      {keepState === "full" && roomText ? (
        <p id={roomId} className="mt-2 text-sm text-muted-foreground">
          {roomText}
        </p>
      ) : null}
      {note ? <p className="mt-2 text-sm">{note}</p> : null}
    </li>
  );
}

/**
 * "Keep two sets apart": the visitor picks two sets that share time and the route searches the
 * places it covers (single places on the 5-minute grid for either set and the two-set changes it
 * generates; the route's own `searched` sentence is printed with an answer), keeping only changes
 * after which the two share no minute and the day has no new rule break. A change can be previewed
 * on the timetable as ghost slots that replace the kept plan's ghosts while they show; that preview
 * is separate from the kept plan. "Keep this change" adds a listed change to the plan as one step
 * (a two-set change counts 2 of its 8 moves), closes the preview and moves focus to the plan card;
 * the plan prices it and the brief prints it. The index shown is the route's, for information: it
 * does not order the list.
 */
export function KeepApart({
  preset,
  day,
  seed,
  onPreview,
  plan = [],
  onKeep,
  opening = null,
  prefer = null,
}: {
  preset: Preset;
  day: number;
  /** The decision card's pair, preselected while the visitor has not picked a set. */
  opening?: { aId: string; bId: string } | null;
  /** Without `opening`, the costliest clash with this set in it is preselected (the card's mover). */
  prefer?: string | null;
  /** A pair the decision card asks for; a new `nonce` runs the search again, the same one does not. */
  seed?: { nonce: number; aId: string; bId: string } | null;
  onPreview?: (preview: RulePreview | null) => void;
  /** The kept plan, so a change can be shown as kept and the room it has left counted. */
  plan?: readonly StackStep[];
  /** Keeps a listed change as one step of the plan. Absent: the rows have no Keep button. */
  onKeep?: (step: RuleStackStep) => void;
}) {
  const firstId = useId();
  const secondId = useId();
  const resultHeadingId = useId();
  const pairHintId = useId();
  const sectionRef = useRef<HTMLElement | null>(null);
  const resultRef = useRef<HTMLHeadingElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const refusedRef = useRef<HTMLParagraphElement | null>(null);
  const previewButtons = useRef(new Map<number, HTMLButtonElement>());
  const wantsFocus = useRef(false);
  const { festival } = preset;

  const sets = useMemo(() => movableSets(preset, day), [preset, day]);
  const byId = useMemo(() => new Map(sets.map((set) => [set.actId, set])), [sets]);
  const slots = useMemo(() => new Map(festival.timetable.map((slot) => [slot.act_id, slot])), [festival]);
  // Both sets open on the decision's pair (or the day's costliest clash), so the form arrives ready to
  // search; nothing is searched until Find changes is pressed. Until the visitor picks a set, a pair that
  // arrives later (the decision loads after the page) takes the place of the first one.
  const opened = openingPair(preset, day, opening, prefer);
  const openedKey = `${opened.a}|${opened.b}`;
  const [first, setFirst] = useState(opened.a);
  const [second, setSecond] = useState(opened.b);
  const [touched, setTouched] = useState(false);
  const [shownOpening, setShownOpening] = useState(openedKey);
  // The pair last searched for, and the answer that came back for it.
  const [wanted, setWanted] = useState<{
    a: string;
    b: string;
    attempt: number;
  } | null>(null);
  const [outcome, setOutcome] = useState<{
    key: string;
    attempt: number;
    answer: RuleAnswer;
  } | null>(null);
  // The change being previewed, tied to the pair it belongs to.
  const [previewing, setPreviewing] = useState<{
    key: string;
    index: number;
  } | null>(null);
  const [announcement, setAnnouncement] = useAnnouncement(5000);
  const [handledSeed, setHandledSeed] = useState(0);
  const multiDay = festival.days.length > 1;
  const dayLabel = useCallback(
    (index: number) => (multiDay ? dayName(festival.days[index] ?? `Day ${index + 1}`) : null),
    [festival, multiDay],
  );
  const before = preset.report.metrics.clash_budget_index;

  const wantedKey = wanted ? pairKey(preset.id, wanted.a, wanted.b) : null;
  const known = wantedKey ? answers.get(wantedKey) : undefined;
  const search: Search =
    !wanted || !wantedKey
      ? { status: "idle" }
      : known
        ? { status: "ready", key: wantedKey, fixes: known }
        : outcome && outcome.key === wantedKey && outcome.attempt === wanted.attempt
          ? outcome.answer.status === "ready"
            ? { status: "ready", key: wantedKey, fixes: outcome.answer.fixes }
            : outcome.answer.status === "refused"
              ? {
                  status: "refused",
                  key: wantedKey,
                  message: outcome.answer.message,
                }
              : { status: "error", key: wantedKey }
          : { status: "loading", key: wantedKey };

  const groups = useMemo(() => groupByStage(sets), [sets]);
  // The second select lists the sets that share time with the first before every other set.
  const partnerGroups = useMemo(() => {
    const mine = slots.get(first);
    if (!mine) return { partners: [] as Group[], others: groupByStage(sets) };
    const concurrent = sets.filter((set) => {
      const slot = slots.get(set.actId);
      return set.actId !== first && slot && slot.day === mine.day && overlapWindow(mine, slot) !== null;
    });
    const ids = new Set(concurrent.map((set) => set.actId));
    return {
      partners: groupByStage(concurrent),
      others: groupByStage(sets.filter((set) => set.actId !== first && !ids.has(set.actId))),
    };
  }, [sets, slots, first]);

  // The preview leaves with the section and whenever the pair searched for changes.
  const previewOut = useRef(onPreview);
  useEffect(() => {
    previewOut.current = onPreview;
  }, [onPreview]);
  useEffect(() => {
    previewOut.current?.(null);
  }, [wantedKey]);
  useEffect(() => () => previewOut.current?.(null), []);

  // Asks the route for the pair unless the page already holds the answer.
  const attempt = wanted?.attempt ?? 0;
  const wantedA = wanted?.a;
  const wantedB = wanted?.b;
  useEffect(() => {
    if (!wantedA || !wantedB || !wantedKey || answers.has(wantedKey)) return;
    let active = true;
    requestRuleFixes(preset.id, wantedA, wantedB).then((answer) => {
      if (answer.status === "ready") answers.set(wantedKey, answer.fixes);
      if (active) setOutcome({ key: wantedKey, attempt, answer });
    });
    return () => {
      active = false;
    };
  }, [preset.id, wantedA, wantedB, wantedKey, attempt]);

  function run(aId: string, bId: string) {
    if (aId === bId || !byId.has(aId) || !byId.has(bId)) return;
    wantsFocus.current = true;
    setPreviewing(null);
    setAnnouncement("");
    setWanted((current) => ({
      a: aId,
      b: bId,
      attempt: (current?.attempt ?? 0) + 1,
    }));
  }

  if (openedKey !== shownOpening) {
    setShownOpening(openedKey);
    if (!touched && !wanted) {
      setFirst(opened.a);
      setSecond(opened.b);
    }
  }

  // A seed from the decision card: choose both sets and search, as state adjusted while rendering. A
  // new nonce runs it again, the same one does not. The section scrolls into view once.
  const seedNonce = seed?.nonce ?? 0;
  const seedA = seed?.aId;
  const seedB = seed?.bId;
  if (
    seedA &&
    seedB &&
    seedNonce !== 0 &&
    seedNonce !== handledSeed &&
    byId.has(seedA) &&
    byId.has(seedB) &&
    seedA !== seedB
  ) {
    setHandledSeed(seedNonce);
    setFirst(seedA);
    setSecond(seedB);
    setPreviewing(null);
    setAnnouncement("");
    setWanted((current) => ({
      a: seedA,
      b: seedB,
      attempt: (current?.attempt ?? 0) + 1,
    }));
  }
  useEffect(() => {
    if (seedNonce === 0) return;
    wantsFocus.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sectionRef.current?.scrollIntoView({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [seedNonce]);

  // Focus lands on the result heading once it is on the page; when the search failed or was
  // refused, on the retry button or the refusal, so a keyboard visitor is never left on the page.
  const status = search.status;
  const settled = status !== "idle" && status !== "loading";
  useEffect(() => {
    if (!settled || !wantsFocus.current) return;
    wantsFocus.current = false;
    const target = status === "ready" ? resultRef.current : status === "error" ? retryRef.current : refusedRef.current;
    target?.focus({ preventScroll: true });
  }, [settled, status, wantedKey, attempt]);

  function changePick(setter: (id: string) => void, id: string) {
    setter(id);
    setTouched(true);
    setWanted(null);
    setPreviewing(null);
    setAnnouncement("");
  }

  function previewFix(fix: RuleFix, index: number, fixes: RuleFixes) {
    const ghosts = fixGhosts(fix);
    if (ghosts.length === 0 || !wantedKey) return;
    setPreviewing({ key: wantedKey, index });
    onPreview?.({ ghosts, pair: { aId: fixes.a.actId, bId: fixes.b.actId } });
    setAnnouncement(previewAnnouncement(fix));
  }

  function keepFix(fix: RuleFix, fixes: RuleFixes) {
    const step = fixStep(fixes, fix);
    if (!step || !onKeep) return;
    // The preview is a tested timetable of its own; once the change is in the plan, the plan's own
    // ghosts show it, so the preview closes.
    setPreviewing(null);
    onPreview?.(null);
    if (plan.some((item) => isRuleStackStep(item) && sameRuleStep(item, step))) {
      // Already kept: nothing changes, and the visitor is told so.
      setAnnouncement(ALREADY_KEPT);
    } else if (earlierFor(step)) {
      setAnnouncement(replacedChangeAnnouncement(fixes.a.act, fixes.b.act));
    } else {
      setAnnouncement(keepAnnouncement(fixes));
    }
    onKeep(step);
  }

  function clearPreview() {
    // The Clear button disables as the preview goes, so focus returns first to the row's own
    // Preview button, which is where the visitor was before the board took their eye.
    const row = previewing && previewing.key === wantedKey ? previewing.index : null;
    if (row !== null) previewButtons.current.get(row)?.focus();
    setPreviewing(null);
    onPreview?.(null);
    setAnnouncement("Preview cleared.");
  }

  const activePreview = previewing && previewing.key === wantedKey ? previewing.index : null;
  const used = moveCount(plan);
  const left = MAX_STACK - used;
  /** The plan's own change for this step's pair, when it is another change than this one. */
  function earlierFor(step: RuleStackStep): RuleStackStep | null {
    return keepChangeInPlan(plan, step).replaced;
  }
  // A change for a pair the plan already has one for takes that step's place, so its moves are freed.
  function roomFor(step: RuleStackStep): number {
    return left + (earlierFor(step)?.moves.length ?? 0);
  }
  function keepStateOf(fix: RuleFix, fixes: RuleFixes): KeepState | null {
    if (!onKeep) return null;
    const step = fixStep(fixes, fix);
    if (!step) return null;
    const kind = keepChangeInPlan(plan, step).kind;
    return kind === "same" ? "kept" : kind === "full" ? "full" : "ready";
  }
  function roomTextOf(fix: RuleFix, fixes: RuleFixes): string {
    const step = fixStep(fixes, fix);
    return roomNote(fix.moves.length, step ? roomFor(step) : left);
  }
  /**
   * Under a row that is not kept yet: it replaces the plan's earlier change for this pair, and/or the plan
   * already moves a set it was found for on the published day, so the receipt after pricing is what counts.
   */
  function noteOf(fix: RuleFix, fixes: RuleFixes): string | null {
    if (!onKeep) return null;
    const step = fixStep(fixes, fix);
    if (!step || plan.some((item) => isRuleStackStep(item) && sameRuleStep(item, step))) return null;
    const earlier = earlierFor(step);
    const parts: string[] = [];
    if (earlier) parts.push(`Keeping this replaces your earlier change for ${fixes.a.act} and ${fixes.b.act}.`);
    const rest = earlier ? plan.filter((item) => item !== earlier) : plan;
    const spoiled = plannedNote(fixes, fix, movedActs(rest));
    if (spoiled) parts.push(spoiled);
    return parts.length > 0 ? parts.join(" ") : null;
  }

  const needsPair = first === "" || second === "" || first === second;
  // The two chosen sets on one axis, when both are on this day's timetable.
  const strip = useMemo(() => {
    const slotA = slots.get(first);
    const slotB = slots.get(second);
    const setA = byId.get(first);
    const setB = byId.get(second);
    if (needsPair || !slotA || !slotB || !setA || !setB || slotA.day !== slotB.day) return null;
    return {
      a: { name: setA.name, start: slotA.start, end: slotA.end },
      b: { name: setB.name, start: slotB.start, end: slotB.end },
    };
  }, [needsPair, slots, byId, first, second]);
  const canSearch = !needsPair && search.status !== "loading";
  const result = search.status === "ready" ? search.fixes : null;
  // Near-duplicates (the same sets and stages, starts within five minutes) share a row; the route's count stays as sent.
  // Same-stage changes list before stage changes (which need production's sign-off), then rows collapse.
  const ordered = useMemo(() => (result ? sameStageFirst(result.fixes) : []), [result]);
  const reordered = result !== null && ordered.some((fix, i) => fix !== result.fixes[i]);
  const rows = useMemo(() => collapseSimilar(ordered), [ordered]);
  const covered = rowsCover(rows);
  const note = result ? lockedNote(result) : null;

  return (
    <section
      id={KEEP_APART_ID}
      ref={sectionRef}
      aria-labelledby="keep-apart-heading"
      className="mt-16 grid gap-x-12 lg:col-span-12 lg:grid-cols-12 lg:items-start"
    >
      <div className="lg:col-span-5">
        <h3 id="keep-apart-heading" className="type-title">
          Keep two sets apart
        </h3>
        <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed">
          Choose two overlapping sets. Find the moves that end the overlap without breaking a rule.
        </p>
        <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 sm:items-start lg:grid-cols-1">
          <div className="min-w-0">
            <label htmlFor={firstId} className="block text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
              First set
            </label>
            <SetSelect
              id={firstId}
              value={first}
              display={fieldDisplay(sets, first)}
              describedBy={needsPair ? pairHintId : undefined}
              onChange={(event) => changePick(setFirst, event.target.value)}
            >
              <option value="" disabled>
                Choose a set
              </option>
              <SetOptions groups={groups} />
            </SetSelect>
          </div>
          <div className="min-w-0">
            <label htmlFor={secondId} className="block text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
              Second set
            </label>
            <SetSelect
              id={secondId}
              value={second}
              display={fieldDisplay(sets, second)}
              describedBy={needsPair ? pairHintId : undefined}
              onChange={(event) => changePick(setSecond, event.target.value)}
            >
              <option value="" disabled>
                Choose a set
              </option>
              {partnerGroups.partners.length > 0 ? (
                <optgroup label={`Share time with ${byId.get(first)?.name ?? "the first set"}`}>
                  {partnerGroups.partners.flatMap((group) =>
                    group.sets.map((set) => (
                      <option key={set.actId} value={set.actId}>
                        {set.start} {set.name} · {group.label}
                        {set.locked ? " (locked)" : ""}
                      </option>
                    )),
                  )}
                </optgroup>
              ) : null}
              <SetOptions groups={partnerGroups.others} />
            </SetSelect>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:col-span-2 lg:col-span-1">
            <Button
              type="button"
              variant="outline"
              disabled={!canSearch}
              aria-describedby={needsPair ? pairHintId : undefined}
              className={cn(needsPair && "border-border bg-transparent text-muted-foreground disabled:opacity-100")}
              onClick={() => run(first, second)}
            >
              Find changes that end this overlap
            </Button>
            {needsPair ? (
              <p id={pairHintId} className="text-[0.8125rem] text-muted-foreground">
                Pick two sets first
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-6 min-w-0 lg:col-span-7 lg:mt-0" aria-busy={search.status === "loading"}>
        {strip ? <ChosenPairStrip a={strip.a} b={strip.b} /> : null}
        <div className={cn(strip && search.status !== "idle" && "mt-6")}>
        {search.status === "loading" ? (
          <div className="flex min-h-20 items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
            Searching {SEARCH_COVERS} for {byId.get(first)?.name ?? "the first set"} and{" "}
            {byId.get(second)?.name ?? "the second set"}
          </div>
        ) : search.status === "error" ? (
          <div role="alert" className="rounded-md border border-destructive bg-card p-4">
            <p className="text-[0.9375rem] font-semibold">Could not run this search.</p>
            <Button ref={retryRef} type="button" variant="outline" className="mt-3" onClick={() => run(first, second)}>
              <RotateCcw aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : search.status === "refused" ? (
          <p
            ref={refusedRef}
            role="alert"
            tabIndex={-1}
            className="rounded-md border border-border-strong bg-card p-4 text-[0.9375rem] font-semibold outline-none"
          >
            {search.message}
          </p>
        ) : result ? (
          <div>
            <h4
              id={resultHeadingId}
              ref={resultRef}
              tabIndex={-1}
              className="text-[0.9375rem] leading-6 font-semibold outline-none"
            >
              Keeping {result.a.act} and {result.b.act} apart
            </h4>
            {result.holds ? (
              <p className="mt-2 text-[0.9375rem] font-semibold">
                {result.a.act} and {result.b.act} do not share any time on this timetable, so the rule already holds.
              </p>
            ) : result.a.locked && result.b.locked ? (
              <p className="mt-2 text-[0.9375rem] font-semibold">{BOTH_LOCKED}</p>
            ) : (
              <>
                {note ? <p className="mt-2 text-[0.9375rem] font-semibold">{note}</p> : null}
                {result.fixes.length === 0 ? (
                  <p className="mt-2 text-[0.9375rem] font-semibold">{NO_RESULT}</p>
                ) : (
                  <>
                    <ol aria-label="Changes that end the overlap" className="mt-3 grid gap-3 sm:grid-cols-2">
                      {rows.map(({ fix, similar }, i) => (
                        <ChangeCard
                          key={fix.moves.map((move) => `${move.actId}@${move.start}`).join("+")}
                          fix={fix}
                          similar={similar}
                          n={i + 1}
                          before={before}
                          dayLabel={dayLabel}
                          pressed={activePreview === i}
                          keepState={keepStateOf(fix, result)}
                          roomText={roomTextOf(fix, result)}
                          note={noteOf(fix, result)}
                          onPreview={() => previewFix(fix, i, result)}
                          onKeep={() => keepFix(fix, result)}
                          buttonRef={(element) => {
                            if (element) previewButtons.current.set(i, element);
                            else previewButtons.current.delete(i);
                          }}
                        />
                      ))}
                    </ol>
                    {/* What the search covered, set directly under the changes it qualifies. */}
                    <p className="mt-2.5 max-w-prose text-[0.8125rem] leading-relaxed text-muted-foreground">
                      {searchedSentence(result)} {SEARCH_RULE} {reordered ? SAME_STAGE_FIRST : SMALLEST_FIRST}{" "}
                      {result.singleSetPlaces === 0
                        ? "This search found no single-set place that ends it."
                        : `${pluralize(result.singleSetPlaces, "single-set place")} end${result.singleSetPlaces === 1 ? "s" : ""} it.`}
                      {result.fixesFound > covered ? ` Showing ${covered} of ${result.fixesFound} changes found.` : ""}
                      {covered > rows.length
                        ? " A change that moves the same sets to the same stages, with starts within 5 minutes, shares a row."
                        : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <Button type="button" variant="outline" disabled={activePreview === null} onClick={clearPreview}>
                        Clear preview
                      </Button>
                      <p className="min-w-0 flex-1 basis-64 text-xs leading-relaxed text-muted-foreground lg:text-[0.8125rem]">
                        {INDEX_NOTE}
                      </p>
                    </div>
                    {activePreview !== null ? (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground lg:text-[0.8125rem]">
                        This is a tested timetable, not a kept change. While it shows, it replaces any kept plan’s
                        ghosts on the timetable; Clear preview brings them back. The links and rank badges still
                        describe the published day.
                      </p>
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>
        ) : null}
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement ||
          (result && !result.holds
            ? result.fixes.length > 0
              ? `${pluralize(result.fixesFound, "change")} found for ${result.a.act} and ${result.b.act}.`
              : NO_RESULT
            : "")}
      </p>
    </section>
  );
}
