"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Equal, LoaderCircle, Minus, Plus, RotateCcw } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { budgetDelta, changeLabel } from "@/lib/agent-session";
import { dayName } from "@/lib/clashes";
import { pluralize } from "@/lib/format";
import type { RulePreview } from "@/lib/rule-fix";
import {
  clashChanges,
  concurrentActs,
  currentPlacement,
  movableSets,
  placementOf,
  startingSets,
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
  planAnnouncement,
  planPreview,
  planStarters,
  readStoredMoves,
  storeMoves,
  type GhostSlot,
  type PlanPreview,
  type StackMove,
} from "@/lib/stack";
import { cn } from "@/lib/utils";

import { BudgetMove, scaleRange, signedDelta, type ScaleRange } from "./budget-move";
import { KeepApart } from "./keep-apart";
import { ScratchPlan } from "./scratch-plan";
import { usePlan } from "./use-moves";

/** Where the section sits on the page, for links that point at it. */
export const TRY_A_MOVE_ID = "try-a-move";

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
    else groups.push({ stageId: set.stageId, stageName: set.stageName, sets: [set] });
  }
  return groups;
}

/**
 * The plan kept for this preset in this tab, when every move is still a set of this festival that
 * may move. Anything else is dropped, and the server checks the rest.
 */
function storedPlan(preset: Preset): StackMove[] {
  const stored = readStoredMoves(preset.id);
  const movable = new Set(preset.festival.timetable.filter((slot) => !slot.locked).map((slot) => slot.act_id));
  return stored.every((move) => movable.has(move.actId)) ? stored : [];
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
      <h4 className="type-kicker text-muted-foreground">{title}</h4>
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

/** Clashes a move keeps, each with its index points before and after (both from the server). */
function KeptClashList({ items }: { items: readonly KeptClash[] }) {
  return (
    <div className="min-w-0 sm:col-span-2">
      <h4 className="type-kicker text-muted-foreground">Clashes it keeps</h4>
      <ul className="mt-1.5 space-y-1 text-sm">
        {items.map((item) => {
          const Icon = item.after < item.now ? ArrowDown : item.after > item.now ? ArrowUp : Equal;
          return (
            <li key={item.name} className="flex gap-2">
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  item.after < item.now ? "text-success" : item.after > item.now ? "text-primary" : "text-muted-foreground",
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
        "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        pressed
          ? "border-foreground bg-foreground text-background"
          : "border-border-strong bg-card hover:bg-accent",
      )}
    >
      <span className="min-w-0">
        <span className="font-semibold">{option.stage}</span>{" "}
        <span className="tabular-nums">
          {option.start}–{option.end}
        </span>
        {dayLabel ? <span className={pressed ? "text-background/75" : "text-muted-foreground"}> · {dayLabel}</span> : null}
      </span>
      <span className={cn("tabular-nums", pressed ? "text-background/80" : "text-muted-foreground")}>
        {option.after !== null ? option.after.toFixed(1) : "?"}
        {delta !== null ? ` (${signedDelta(delta)})` : ""}
      </span>
    </button>
  );
}

/** Keeping the chosen place: the button, or why the plan cannot take another move. */
type KeepControl = { full: boolean; onKeep: (option: PlacedOption) => void };

/**
 * The answer for one set: its legal places as a list, and the chosen one priced in full. With kept
 * moves the places are priced on top of them (`result.before` is the plan's Clash Budget Index) and
 * `timetable` is the published one with those moves made, so the clashes a place ends and adds are
 * read against where every set plays in the plan.
 */
function MovesCard({
  result,
  preset,
  timetable,
  kept,
  range,
  chosen,
  keep,
  onChoose,
}: {
  result: MovesResult;
  preset: Preset;
  timetable: readonly SetSlot[];
  kept: number;
  range: ScaleRange;
  chosen: PlacedOption | null;
  keep: KeepControl;
  onChoose: (index: number) => void;
}) {
  const detailId = useId();
  const fullHelpId = useId();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const { festival } = preset;
  const multiDay = festival.days.length > 1;
  const chosenDelta = chosen ? budgetDelta(result.before, chosen.after) : null;

  const changes = useMemo(() => {
    if (!chosen) return null;
    const planned = { festival: { ...festival, timetable: [...timetable] } };
    const home = currentPlacement(planned, result.actId);
    const after = placementOf(chosen);
    return clashChanges(
      result.clashesNow,
      chosen.clashesAfter,
      home ? concurrentActs(planned, result.actId, home) : null,
      after ? concurrentActs(planned, result.actId, after) : null,
    );
  }, [chosen, festival, timetable, result]);

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
      detail.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  }

  return (
    <div className="rounded-xl border border-border-strong bg-card p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="type-title break-words">Where {result.act} could go</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">Now: {dashRanges(result.from)}</p>
        </div>
        <ProvenanceChip provenance="derived" size="sm" className="mt-1" />
      </div>

      {!result.movable ? (
        <p className="mt-4 text-[0.9375rem] font-semibold">It cannot move: {result.why ?? "it is fixed in place"}.</p>
      ) : !chosen ? (
        <p className="mt-4 text-[0.9375rem] font-semibold">No free slot it may use breaks no rule.</p>
      ) : (
        <>
          {!result.priced ? (
            <p className="mt-4 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
              Qloo has no usable signal for {result.act}, so its clashes are not priced and no place changes the
              Clash Budget Index.
            </p>
          ) : null}
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
            <div className="min-w-0">
              <p className="type-kicker text-muted-foreground">
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

            <div id={detailId} ref={detailRef} className="min-w-0 lg:border-l lg:border-border lg:pl-8">
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
              <BudgetMove before={result.before} after={chosen.after} range={range} />
              {changes ? (
                <div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                  <ClashChangeList title="Clashes it ends" items={changes.ends} tone="ends" />
                  <ClashChangeList title="Clashes it adds" items={changes.adds} tone="adds" />
                  {changes.keeps.length > 0 ? <KeptClashList items={changes.keeps} /> : null}
                </div>
              ) : null}
              <div className="mt-5 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="ink"
                  disabled={keep.full}
                  aria-describedby={keep.full ? fullHelpId : undefined}
                  onClick={() => keep.onKeep(chosen)}
                >
                  {keep.full ? null : <Check aria-hidden="true" />}
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
          <p className="mt-5 text-xs text-muted-foreground">
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

/** A plan that could not be priced: try again, or start over. */
function PlanError({ onRetry, onStartOver }: { onRetry: () => void; onStartOver: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/50 bg-danger-bg p-5">
      <p className="text-[0.9375rem] font-semibold">Could not price this plan.</p>
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
  onRulePreview,
  seedMove = null,
  seedRule = null,
}: {
  preset: Preset;
  day: number;
  ranked: readonly PairClash[];
  isLocked: (actId: string) => boolean;
  onPlanChange?: (preview: PlanPreview | null) => void;
  /** A change previewed from "Keep two sets apart": two ghost slots, never part of the kept plan. */
  onRulePreview?: (preview: RulePreview | null) => void;
  /** The decision card's move: a new `nonce` makes it the kept plan; the same one does nothing. */
  seedMove?: { nonce: number; move: StackMove } | null;
  /** The decision card's rule: a new `nonce` runs the search for the pair in "Keep two sets apart". */
  seedRule?: { nonce: number; aId: string; bId: string } | null;
}) {
  const selectId = useId();
  const startLabelId = useId();
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const planRef = useRef<HTMLDivElement | null>(null);
  const sets = useMemo(() => movableSets(preset, day), [preset, day]);
  const groups = useMemo(() => byStage(sets), [sets]);
  const range = useMemo(() => scaleRange(preset.report.baseline), [preset]);
  const unpriced = useMemo(
    () => new Set(preset.report.coverage.unscored.map((act) => act.act_id)),
    [preset],
  );

  // The page is drawn in the browser once the festival day has loaded, so the tab's saved plan can
  // be read when this section first renders.
  const [moves, setMoves] = useState<readonly StackMove[]>(() => storedPlan(preset));
  const moved = useMemo(() => new Set(moves.map((move) => move.actId)), [moves]);
  const timetable = useMemo(() => applyMoves(preset.festival.timetable, moves), [preset, moves]);

  const [picked, setPicked] = useState<string | null>(null);
  // The plan Keep, Undo or Start over just made, and the set picked after it: the status region
  // speaks the plan's reading until another set is picked.
  const [planNews, setPlanNews] = useState<{ moves: string; picked: string | null } | null>(null);
  const [choice, setChoice] = useState<{ key: string; index: number } | null>(null);
  // A set from another day, a locked one or one already in the plan is never asked about.
  const actId =
    picked && !moved.has(picked) && sets.some((set) => set.actId === picked && !set.locked) ? picked : null;
  const pickedName = sets.find((set) => set.actId === actId)?.name ?? null;
  const state = usePlan(preset.id, moves, actId);
  const result = state.status === "ready" ? state.options : null;
  const choiceKey = `${encodeMoves(moves)}:${actId ?? ""}`;
  const index = choice && choice.key === choiceKey ? choice.index : 0;
  const chosen =
    result && result.movable ? (result.options[Math.min(index, result.options.length - 1)] ?? null) : null;

  const starters = useMemo(() => {
    if (moves.length > 0 && state.plan) {
      const pickable = sets.map((set) => ({ ...set, locked: set.locked || isLocked(set.actId) }));
      return planStarters(state.plan.clashes, pickable, moved);
    }
    return startingSets(ranked, isLocked).filter((set) => !moved.has(set.actId));
  }, [moves.length, state.plan, sets, ranked, isLocked, moved]);

  // What the grid may draw: the kept moves and the place being tried on top of them.
  const trying = useMemo<GhostSlot | null>(() => {
    const at = chosen ? placementOf(chosen) : null;
    return chosen && at && result
      ? { actId: result.actId, stageId: chosen.stageId, day: at.day, start: at.start, end: at.end }
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

  function update(next: readonly StackMove[]) {
    setMoves(next);
    storeMoves(preset.id, next);
  }

  // The rule panel previews through a stable callback, so its cleanup never fires on a re-render.
  const rulePreviewRef = useRef(onRulePreview);
  useEffect(() => {
    rulePreviewRef.current = onRulePreview;
  }, [onRulePreview]);
  const emitRulePreview = useCallback((next: RulePreview | null) => rulePreviewRef.current?.(next), []);

  // A move seeded by the decision card becomes the kept plan: state adjusted while rendering, as
  // React advises for a prop that changes. The plan is priced as any kept move is (this section's own
  // `/whatif` request); focus reaches the plan card once the card's own motion (the band and the
  // figure, 900 ms) has played, at once with reduced motion.
  const seedNonce = seedMove?.nonce ?? 0;
  const seedMoveValue = seedMove?.move ?? null;
  const [handledSeed, setHandledSeed] = useState(0);
  const [focusNonce, setFocusNonce] = useState(0);
  if (
    seedMoveValue &&
    seedNonce !== 0 &&
    seedNonce !== handledSeed &&
    sets.some((set) => set.actId === seedMoveValue.actId && !set.locked)
  ) {
    const next = [seedMoveValue];
    setHandledSeed(seedNonce);
    setMoves(next);
    setPicked(null);
    setPlanNews({ moves: encodeMoves(next), picked: null });
    setFocusNonce(seedNonce);
  }
  // Keep the tab's plan in step with the moves, whichever way they changed.
  useEffect(() => {
    storeMoves(preset.id, moves);
  }, [preset.id, moves]);
  useEffect(() => {
    if (focusNonce === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const show = () => {
      planRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      planRef.current?.focus({ preventScroll: true });
    };
    const timer = window.setTimeout(show, reduce ? 0 : 900);
    return () => window.clearTimeout(timer);
  }, [focusNonce]);

  function keep(option: PlacedOption) {
    if (!actId || moves.length >= MAX_STACK || moved.has(actId)) return;
    const next = [...moves, { actId, stageId: option.stageId, day: option.day, start: option.start }];
    update(next);
    setPicked(null);
    setPlanNews({ moves: encodeMoves(next), picked: null });
    // The places card goes; the plan card is where the kept move now shows.
    requestAnimationFrame(() => planRef.current?.focus());
  }

  function undo() {
    const next = moves.slice(0, -1);
    update(next);
    setPlanNews({ moves: encodeMoves(next), picked });
    // With moves left the plan card is where the change shows; with none, the set picker.
    requestAnimationFrame(() => (next.length === 0 ? selectRef.current : planRef.current)?.focus());
  }

  function startOver() {
    update([]);
    setPicked(null);
    setPlanNews({ moves: "", picked: null });
    requestAnimationFrame(() => selectRef.current?.focus());
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
          ? "Could not price this plan."
          : "Could not load the places for this set."
        : state.status === "invalid"
          ? "That plan is no longer possible."
          : "");

  return (
    <section
      id={TRY_A_MOVE_ID}
      aria-labelledby="try-a-move-heading"
      className="border-t border-border"
    >
      <div className="container-page py-14 sm:py-20">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
          <div>
            <p className="type-kicker text-muted-foreground">Try a move</p>
            <h2 id="try-a-move-heading" className="type-headline mt-2">
              Move a set and see what it costs
            </h2>
          </div>
          <p className="text-[0.9375rem] leading-relaxed">
            Pick a set. The timetable engine lists every place it could legally go, checking every
            start on a 5-minute grid, and prices each one. Keep a move to test the next one on top of
            it. Locked sets stay put. Nothing here uses the language model, and nothing changes the
            timetable above.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-end gap-x-8 gap-y-5">
          <div className="w-full min-w-0 sm:w-auto">
            <label htmlFor={selectId} className="block text-sm font-semibold">
              Set to move
            </label>
            <select
              id={selectId}
              ref={selectRef}
              value={actId ?? ""}
              onChange={(event) => setPicked(event.target.value || null)}
              className="mt-1.5 h-11 w-full min-w-0 rounded-md border border-border-strong bg-card px-3 text-[0.9375rem] text-foreground sm:w-80"
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
                          ? " (locked)"
                          : unpriced.has(set.actId)
                            ? " (not priced)"
                            : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {starters.length > 0 ? (
            <div className="min-w-0">
              <p id={startLabelId} className="text-sm font-semibold">
                Start with
              </p>
              <ul aria-labelledby={startLabelId} className="mt-1.5 flex flex-wrap gap-2">
                {starters.map((set) => (
                  <li key={set.actId}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={actId === set.actId}
                      className="h-auto min-h-11 whitespace-normal text-left aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
                      onClick={() => setPicked(set.actId)}
                    >
                      {set.name}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {actId ? (
          <div className="mt-8" aria-busy={state.status === "loading"}>
            {state.status === "loading" ? (
              <div className="flex min-h-32 items-center gap-2 rounded-xl border border-dashed border-border-strong p-6 text-sm text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                Pricing every legal place for {pickedName ?? "this set"}
              </div>
            ) : state.status === "error" ? (
              planned ? (
                <PlanError onRetry={state.retry} onStartOver={startOver} />
              ) : (
                <div role="alert" className="rounded-xl border border-destructive/50 bg-danger-bg p-5">
                  <p className="text-[0.9375rem] font-semibold">Could not load the places for this set.</p>
                  <Button type="button" variant="outline" className="mt-3" onClick={state.retry}>
                    <RotateCcw aria-hidden="true" />
                    Try again
                  </Button>
                </div>
              )
            ) : result ? (
              <MovesCard
                result={result}
                preset={preset}
                timetable={timetable}
                kept={moves.length}
                range={range}
                chosen={chosen}
                keep={{ full: moves.length >= MAX_STACK, onKeep: keep }}
                onChoose={(next) => setChoice({ key: choiceKey, index: next })}
              />
            ) : null}
          </div>
        ) : null}

        {planned ? (
          <div
            ref={planRef}
            tabIndex={-1}
            role="group"
            aria-label="Your tested moves"
            className="mt-8 rounded-xl focus:outline-none"
            aria-busy={state.status === "loading" && !state.plan}
          >
            {state.status === "invalid" ? (
              <div role="alert" className="rounded-xl border border-destructive/50 bg-danger-bg p-5">
                <p className="text-[0.9375rem] font-semibold">That plan is no longer possible. Start over to try again.</p>
                <Button type="button" variant="outline" className="mt-3" onClick={startOver}>
                  Start over
                </Button>
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
              />
            ) : state.status === "error" && !actId ? (
              <PlanError onRetry={state.retry} onStartOver={startOver} />
            ) : state.status === "loading" ? (
              <div className="flex min-h-32 items-center gap-2 rounded-xl border border-dashed border-border-strong p-6 text-sm text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                Pricing your tested moves
              </div>
            ) : null}
          </div>
        ) : null}

        <KeepApart key={day} preset={preset} day={day} seed={seedRule} onPreview={emitRulePreview} />

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </section>
  );
}
