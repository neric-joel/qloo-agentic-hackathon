"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Equal, LoaderCircle, Minus, Plus, RotateCcw } from "lucide-react";

import { ProvenanceChip } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { budgetDelta, changeLabel } from "@/lib/agent-session";
import { dayName } from "@/lib/clashes";
import { pluralize } from "@/lib/format";
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
import type { PairClash, Preset } from "@/lib/preset";
import { cn } from "@/lib/utils";

import { BudgetMove, scaleRange, signedDelta, type ScaleRange } from "./budget-move";
import { useMoves } from "./use-moves";

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

/** The answer for one set: its legal places as a list, and the chosen one priced in full. */
function MovesCard({
  result,
  preset,
  range,
  index,
  onChoose,
}: {
  result: MovesResult;
  preset: Preset;
  range: ScaleRange;
  index: number;
  onChoose: (index: number) => void;
}) {
  const detailId = useId();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const { festival } = preset;
  const chosen = result.options[Math.min(index, result.options.length - 1)] ?? null;
  const multiDay = festival.days.length > 1;
  const chosenDelta = chosen ? budgetDelta(result.before, chosen.after) : null;

  const changes = useMemo(() => {
    if (!chosen) return null;
    const home = currentPlacement(preset, result.actId);
    const after = placementOf(chosen);
    return clashChanges(
      result.clashesNow,
      chosen.clashesAfter,
      home ? concurrentActs(preset, result.actId, home) : null,
      after ? concurrentActs(preset, result.actId, after) : null,
    );
  }, [chosen, preset, result]);

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
            </div>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            {pluralize(result.legalPlaces, "legal place")}, checking every start on a 5-minute grid. Tested
            only: the timetable above is unchanged.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * "Try a move": the visitor picks a set and sees every legal place it could go, priced by the
 * timetable engine, with the Clash Budget move and the clashes it ends and adds for the place they
 * choose. No language model is involved and nothing is applied: the answer comes from
 * `GET /api/presets/{id}/moves`, which uses the published timetable and its locks, and the
 * timetable above never changes. `ranked` is the day's priced clashes, costliest first.
 */
export function TryAMove({
  preset,
  day,
  ranked,
  isLocked,
}: {
  preset: Preset;
  day: number;
  ranked: readonly PairClash[];
  isLocked: (actId: string) => boolean;
}) {
  const selectId = useId();
  const startLabelId = useId();
  const sets = useMemo(() => movableSets(preset, day), [preset, day]);
  const groups = useMemo(() => byStage(sets), [sets]);
  const starters = useMemo(() => startingSets(ranked, isLocked), [ranked, isLocked]);
  const range = useMemo(() => scaleRange(preset.report.baseline), [preset]);

  const [picked, setPicked] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ actId: string; index: number } | null>(null);
  // A set from another day, or a locked one, is never asked about.
  const actId = picked && sets.some((set) => set.actId === picked && !set.locked) ? picked : null;
  const pickedName = sets.find((set) => set.actId === actId)?.name ?? null;
  const moves = useMoves(preset.id, actId);
  const index = choice && choice.actId === actId ? choice.index : 0;

  const announcement =
    moves.status === "ready"
      ? moves.result.movable
        ? `${pluralize(moves.result.legalPlaces, "legal place")} for ${moves.result.act}.`
        : `${moves.result.act} cannot move.`
      : moves.status === "error"
        ? "Could not load the places for this set."
        : "";

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
            start on a 5-minute grid, and prices each one. Locked sets stay put. Nothing here uses the
            language model, and nothing changes the timetable above.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-end gap-x-8 gap-y-5">
          <div className="w-full min-w-0 sm:w-auto">
            <label htmlFor={selectId} className="block text-sm font-semibold">
              Set to move
            </label>
            <select
              id={selectId}
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
                    <option key={set.actId} value={set.actId} disabled={set.locked}>
                      {set.start} {set.name}
                      {set.locked ? " (locked)" : ""}
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

        <div className="mt-8" aria-busy={moves.status === "loading"}>
          {moves.status === "loading" ? (
            <div className="flex min-h-32 items-center gap-2 rounded-xl border border-dashed border-border-strong p-6 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              Pricing every legal place for {pickedName ?? "this set"}
            </div>
          ) : moves.status === "error" ? (
            <div role="alert" className="rounded-xl border border-destructive/50 bg-danger-bg p-5">
              <p className="text-[0.9375rem] font-semibold">Could not load the places for this set.</p>
              <Button type="button" variant="outline" className="mt-3" onClick={moves.retry}>
                <RotateCcw aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : moves.status === "ready" ? (
            <MovesCard
              result={moves.result}
              preset={preset}
              range={range}
              index={index}
              onChoose={(next) => setChoice({ actId: moves.result.actId, index: next })}
            />
          ) : null}
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </section>
  );
}
