"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

import { clashKey, formatDraw, formatShare, LABEL_META, partnerOf, type SetView } from "@/lib/clashes";
import type { PairClash, Stage } from "@/lib/preset";
import type { GhostSlot, PlanPreview } from "@/lib/stack";
import {
  blockDensity,
  columnFrames,
  columnGap,
  formatClock,
  formatRange,
  isNavKey,
  layoutLinks,
  nextNavItem,
  overlapWindow,
  timeDomain,
  timeScale,
  timeTicks,
  type LinkInput,
  type TimeRange,
} from "@/lib/timetable";

const AXIS_WIDTH = 52;
const PX_PER_MINUTE = 1.7;
const BADGE = 26;

type TimetableGridProps = {
  views: readonly SetView[];
  stages: readonly Stage[];
  /** The clashes drawn as links (the costliest of the day). */
  links: readonly PairClash[];
  dayLabel: string;
  activeSetIds: ReadonlySet<string>;
  activeClashKeys: ReadonlySet<string>;
  /** Something is highlighted, so everything else steps back. */
  dimmed: boolean;
  /** The set or clash that is hovered or focused right now. */
  focusSetId: string | null;
  onHighlightSet: (id: string | null) => void;
  onHighlightClash: (key: string | null) => void;
  onOpen: (clash: PairClash, trigger: HTMLElement) => void;
  /** A tested plan to preview: kept moves and the place being tried, drawn as ghosts. */
  plan?: PlanPreview | null;
  className?: string;
};

type Ghost = { slot: GhostSlot; name: string; col: number; range: TimeRange; trying: boolean };

/** Where a tested place is drawn: its stage column and its minutes, kept inside the drawn day. */
function placeGhosts(
  plan: PlanPreview | null | undefined,
  views: ReadonlyMap<string, SetView>,
  stages: readonly Stage[],
  domain: TimeRange,
): Ghost[] {
  if (!plan) return [];
  const slots = [
    ...plan.kept.map((slot) => ({ slot, trying: false })),
    ...(plan.trying ? [{ slot: plan.trying, trying: true }] : []),
  ];
  return slots.flatMap(({ slot, trying }) => {
    const view = views.get(slot.actId);
    const col = stages.findIndex((stage) => stage.id === slot.stageId);
    if (!view || view.slot.day !== slot.day || col < 0) return [];
    // A start written past midnight as "00:30" belongs after the day's last hour.
    const shift = slot.start < domain.start && slot.start + 1440 < domain.end ? 1440 : 0;
    const start = Math.max(domain.start, slot.start + shift);
    const end = Math.min(domain.end, slot.end + shift);
    if (end <= start) return [];
    return [{ slot, name: view.act.name, col, range: { start, end }, trying }];
  });
}

/** What a set block adds for screen readers after its visible text. */
function describeSetTail(view: SetView, moved: boolean): string {
  const parts = [
    view.coverage === "weak" ? "Weak Qloo signal." : "",
    view.slot.locked ? "Locked set." : "",
    moved ? "Moved in your tested plan." : "",
  ];
  const [first] = view.clashes;
  if (first) {
    const partner = partnerOf(first, view.id);
    parts.push(
      `In ${view.clashes.length} ranked ${view.clashes.length === 1 ? "clash" : "clashes"}; press Enter to open the costliest, number ${first.rank}, with ${partner.name}.`,
    );
  } else if (view.coverage !== "none") {
    parts.push("No ranked clash.");
  }
  return parts.filter(Boolean).join(" ");
}

/**
 * The day's timetable: stages as columns on a shared time axis, sets sized by length, and an arc
 * between the two sets of each of the costliest clashes, visible without a hover (thicker and
 * stronger = costlier; dashed with a diamond badge = hidden clash). Arrow keys move between sets;
 * Enter opens a set's costliest clash; each badge opens its clash. A tested plan, when given, shows
 * as dashed ghosts at the tested places; the links and badges stay on the published timetable.
 *
 * Below 768 px the board sits in a sideways scroller (see `clash-control.tsx`): the stage names
 * scroll with it instead of sticking, and the time axis stays at the left edge.
 */
export function TimetableGrid({
  views,
  stages,
  links,
  dayLabel,
  activeSetIds,
  activeClashKeys,
  dimmed,
  focusSetId,
  onHighlightSet,
  onHighlightClash,
  onOpen,
  plan = null,
  className,
}: TimetableGridProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const setRefs = useRef(new Map<string, HTMLButtonElement>());
  const [width, setWidth] = useState(0);
  const [boardWidth, setBoardWidth] = useState(0);
  const [rovingId, setRovingId] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const area = areaRef.current;
    if (!root || !area) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === root) setBoardWidth(entry.contentRect.width);
        else setWidth(entry.contentRect.width);
      }
    });
    observer.observe(root);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  // Wider gutters once the board has room, so the arcs between neighbouring stages show.
  const gap = columnGap(boardWidth);

  const domain = useMemo(() => timeDomain(views.map((view) => view.slot)), [views]);
  const scale = useMemo(() => timeScale(domain, PX_PER_MINUTE), [domain]);
  const hours = useMemo(() => timeTicks(domain, 60), [domain]);
  const halfHours = useMemo(
    () => timeTicks(domain, 30).filter((minute) => minute % 60 !== 0),
    [domain],
  );
  const frames = useMemo(() => columnFrames(width, stages.length, gap), [width, stages.length, gap]);
  const byId = useMemo(() => new Map(views.map((view) => [view.id, view])), [views]);
  const ghosts = useMemo(() => placeGhosts(plan, byId, stages, domain), [plan, byId, stages, domain]);
  const movedIds = useMemo(() => new Set((plan?.kept ?? []).map((slot) => slot.actId)), [plan]);
  const navItems = useMemo(
    () => views.map((view) => ({ id: view.id, col: view.col, start: view.slot.start, end: view.slot.end })),
    [views],
  );
  const tabStop = rovingId && byId.has(rovingId) ? rovingId : (views[0]?.id ?? null);

  const maxShare = Math.max(...links.map((clash) => clash.regret_share), 0.0001);
  const layouts = useMemo(() => {
    if (width === 0) return [];
    const inputs: LinkInput[] = links.flatMap((clash) => {
      const a = byId.get(clash.a.act_id);
      const b = byId.get(clash.b.act_id);
      const window = a && b ? overlapWindow(a.slot, b.slot) : null;
      if (!a || !b || !window || a.col === b.col) return [];
      return [{ id: clashKey(clash), colA: a.col, colB: b.col, window, weight: clash.regret_share / maxShare }];
    });
    return layoutLinks(inputs, frames, scale, { badgeSize: BADGE });
  }, [links, byId, frames, scale, maxShare, width]);
  const clashByKey = useMemo(() => new Map(links.map((clash) => [clashKey(clash), clash])), [links]);

  function onSetKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (!isNavKey(event.key)) return;
    event.preventDefault();
    const next = nextNavItem(navItems, id, event.key);
    if (next) setRefs.current.get(next)?.focus();
  }

  const columnsTemplate = `${AXIS_WIDTH}px repeat(${stages.length}, minmax(0, 1fr))`;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {/* Stage names stay in view while the day scrolls past, under the site header and the
          page's jump nav. In the phone scroller they scroll with the board instead. */}
      <div
        className="z-20 grid border-b-2 border-foreground bg-background/95 py-2.5 backdrop-blur supports-backdrop-filter:bg-background/85 md:sticky md:top-27"
        style={{ gridTemplateColumns: columnsTemplate, columnGap: gap }}
      >
        <p className="type-kicker self-end text-muted-foreground">{dayLabel}</p>
        {stages.map((stage) => {
          const count = views.filter((view) => view.stage.id === stage.id).length;
          return (
            <div key={stage.id} className="min-w-0 snap-start">
              <p className="type-wordmark truncate text-lg">{stage.name}</p>
              <p className="font-mono text-[0.6875rem] text-muted-foreground">
                {count} {count === 1 ? "set" : "sets"}
              </p>
            </div>
          );
        })}
      </div>

      <div
        className="relative mt-3 grid"
        style={{ gridTemplateColumns: `${AXIS_WIDTH}px minmax(0, 1fr)`, columnGap: gap }}
      >
        {/* Time axis. In the phone scroller it stays at the left edge while the stages pass. */}
        <div
          aria-hidden="true"
          className="relative max-md:sticky max-md:left-0 max-md:z-20 max-md:bg-background"
          style={{ height: scale.height }}
        >
          {hours.map((minute) => (
            <span
              key={minute}
              className="absolute right-0 -translate-y-1/2 font-mono text-[0.6875rem] text-muted-foreground tabular-nums"
              style={{ top: scale.y(minute) }}
            >
              {formatClock(minute)}
            </span>
          ))}
        </div>

        <div ref={areaRef} className="relative" style={{ height: scale.height }}>
          {/* Hour and half-hour rules */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {hours.map((minute) => (
              <span
                key={`h${minute}`}
                className="absolute inset-x-0 border-t border-border"
                style={{ top: scale.y(minute) }}
              />
            ))}
            {halfHours.map((minute) => (
              <span
                key={`m${minute}`}
                className="absolute inset-x-0 border-t border-dashed border-border/70"
                style={{ top: scale.y(minute) }}
              />
            ))}
          </div>

          {/* Links between clashing sets. Drawn behind the sets, so a link that jumps a stage never
              covers the text of the set in between; it shows in the gutters and in open time. */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={width}
            height={scale.height}
          >
            {layouts.map((layout) => {
              const clash = clashByKey.get(layout.id);
              if (!clash) return null;
              const active = activeClashKeys.has(layout.id);
              const opacity = dimmed ? (active ? 1 : 0.12) : layout.opacity;
              const dash = clash.label === "hidden" ? "7 5" : undefined;
              return (
                <g key={layout.id} style={{ opacity }} className="transition-opacity duration-150">
                  <path
                    d={layout.path}
                    fill="none"
                    stroke="var(--background)"
                    strokeWidth={layout.strokeWidth + 4}
                    strokeLinecap="round"
                  />
                  <path
                    d={layout.path}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth={active ? layout.strokeWidth + 1 : layout.strokeWidth}
                    strokeLinecap={dash ? "butt" : "round"}
                    strokeDasharray={dash}
                  />
                </g>
              );
            })}
          </svg>

          {/* Sets */}
          <div
            role="group"
            aria-label={`${dayLabel} timetable. Use the arrow keys to move between sets.`}
            className="absolute inset-0 grid"
            style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`, columnGap: gap }}
          >
            {stages.map((stage) => (
              <div key={stage.id} className="relative snap-start">
                {views
                  .filter((view) => view.stage.id === stage.id)
                  .map((view) => {
                    const top = scale.y(view.slot.start);
                    const height = scale.y(view.slot.end) - top;
                    const density = blockDensity(height);
                    const related = activeSetIds.has(view.id);
                    const isFocus = focusSetId === view.id;
                    const costliest = view.clashes[0];
                    const none = view.coverage === "none";
                    const moved = movedIds.has(view.id);
                    return (
                      <button
                        key={view.id}
                        type="button"
                        ref={(element) => {
                          if (element) setRefs.current.set(view.id, element);
                          else setRefs.current.delete(view.id);
                        }}
                        tabIndex={view.id === tabStop ? 0 : -1}
                        onKeyDown={(event) => onSetKeyDown(event, view.id)}
                        onFocus={() => {
                          setRovingId(view.id);
                          onHighlightSet(view.id);
                        }}
                        onBlur={() => onHighlightSet(null)}
                        onMouseEnter={() => onHighlightSet(view.id)}
                        onMouseLeave={() => onHighlightSet(null)}
                        onClick={(event) => {
                          if (costliest) onOpen(costliest, event.currentTarget);
                        }}
                        data-set={view.id}
                        className={cn(
                          "absolute inset-x-0 flex flex-col overflow-hidden rounded-md border text-left transition-[opacity,background-color,border-color,box-shadow] duration-150",
                          "focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          density === "tiny" ? "px-2 py-1" : "px-2.5 py-1.5",
                          none
                            ? "bg-hatch border-dashed border-border-strong bg-card text-muted-foreground"
                            : view.coverage === "weak"
                              ? "border-dotted border-border-strong bg-card"
                              : "border-border-strong bg-card",
                          view.slot.locked && "border-2 border-foreground",
                          moved && "bg-hatch",
                          costliest ? "cursor-pointer hover:bg-accent" : "cursor-default",
                          isFocus && "border-foreground bg-accent",
                          related && !isFocus && "shadow-[0_0_0_2px_var(--primary)]",
                          dimmed && !related && !isFocus && "opacity-40",
                        )}
                        style={{ top: top + 1, height: Math.max(height - 2, 18) }}
                      >
                        <span className="flex min-w-0 items-start gap-1">
                          <span
                            className={cn(
                              "min-w-0 flex-1 text-[0.8125rem] leading-tight font-bold [font-variation-settings:'wdth'_85]",
                              density === "full" ? "line-clamp-2" : "truncate",
                              none ? "text-foreground" : "",
                            )}
                          >
                            {view.act.name}
                            <span className="sr-only">, {view.stage.name}. </span>
                            {density === "tiny" ? <span className="sr-only">{formatRange(view.slot)}. </span> : null}
                          </span>
                          {view.slot.locked ? (
                            <Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                          ) : null}
                        </span>
                        {density !== "tiny" ? (
                          <span className="mt-0.5 truncate font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
                            {formatRange(view.slot)}
                            {density === "full" && view.act.genre ? ` · ${view.act.genre}` : ""}
                            <span className="sr-only">
                              . {density !== "full" && view.act.genre ? `${view.act.genre}. ` : ""}
                            </span>
                          </span>
                        ) : null}
                        {density === "full" ? (
                          <span className="mt-auto flex items-center gap-1.5 pt-1 font-mono text-[0.6875rem]">
                            {none ? (
                              <span className="rounded-sm bg-card px-1 font-sans font-semibold text-foreground">
                                No Qloo signal
                                <span className="sr-only">, not priced. </span>
                              </span>
                            ) : view.act.popularity !== null ? (
                              <>
                                <span className="text-muted-foreground">Draw</span>{" "}
                                <span className="tabular-nums">{formatDraw(view.act.popularity)}</span>
                                <span className="sr-only">. </span>
                                {/* The bar shows only on the set in hand; at rest the number is enough. */}
                                {isFocus ? (
                                  <span aria-hidden="true" className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                                    <span
                                      className="block h-full bg-foreground/70"
                                      style={{ width: `${view.act.popularity * 100}%` }}
                                    />
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                            {view.coverage === "weak" ? (
                              <span className="shrink-0 font-sans text-muted-foreground">weak</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="sr-only">
                            {none
                              ? "No Qloo signal, not priced. "
                              : view.act.popularity !== null
                                ? `Draw ${formatDraw(view.act.popularity)}. `
                                : ""}
                          </span>
                        )}
                        <span className="sr-only">{describeSetTail(view, moved)}</span>
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>

          {/* Tested places from "Try a move": a dashed ghost per kept move (the place being tried
              is lighter). Decorative: the moved set's own block says it moved. */}
          {ghosts.length > 0 ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {ghosts.map((ghost) => {
                const frame = frames[ghost.col];
                if (!frame) return null;
                const top = scale.y(ghost.range.start);
                const height = scale.y(ghost.range.end) - top;
                return (
                  <div
                    key={`${ghost.trying ? "trying" : "kept"}-${ghost.slot.actId}`}
                    data-ghost={ghost.trying ? "trying" : "kept"}
                    className={cn(
                      "absolute flex flex-col overflow-hidden rounded-md border-2 border-dashed px-2 py-1 text-left",
                      ghost.trying
                        ? "border-primary/55 bg-background/70 text-foreground/80"
                        : "border-primary bg-background/85 text-foreground",
                    )}
                    style={{ left: frame.left, width: frame.width, top: top + 1, height: Math.max(height - 2, 18) }}
                  >
                    <span className="truncate text-[0.75rem] leading-tight font-bold [font-variation-settings:'wdth'_85]">
                      {ghost.name} · tested
                    </span>
                    {height >= 36 ? (
                      <span className="truncate font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
                        {formatRange(ghost.range)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Over the sets: a faint trace of each link where it passes behind a set in between, so
              the arc reads end to end without hiding the set's text, and the two ends where the
              link meets its sets. */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={width}
            height={scale.height}
          >
            {layouts.map((layout) => {
              const clash = clashByKey.get(layout.id);
              const active = activeClashKeys.has(layout.id);
              const opacity = dimmed ? (active ? 1 : 0.12) : layout.opacity;
              return (
                <g key={layout.id} style={{ opacity }} className="transition-opacity duration-150">
                  <path
                    d={layout.path}
                    fill="none"
                    stroke="var(--primary)"
                    strokeOpacity={0.4}
                    strokeWidth={1.5}
                    strokeDasharray={clash?.label === "hidden" ? "4 4" : undefined}
                  />
                  <circle cx={layout.x1} cy={layout.y} r={4} fill="var(--primary)" stroke="var(--background)" strokeWidth={1.5} />
                  <circle cx={layout.x2} cy={layout.y} r={4} fill="var(--primary)" stroke="var(--background)" strokeWidth={1.5} />
                </g>
              );
            })}
          </svg>

          {/* Rank badges: one button per drawn clash */}
          <ul aria-label="Clash links" className="absolute inset-0 z-10" style={{ pointerEvents: "none" }}>
            {layouts.map((layout) => {
              const clash = clashByKey.get(layout.id);
              if (!clash) return null;
              const hidden = clash.label === "hidden";
              const active = activeClashKeys.has(layout.id);
              return (
                <li key={layout.id}>
                  <button
                    type="button"
                    aria-label={`Clash ${clash.rank}: ${clash.a.name} and ${clash.b.name}${clash.label ? `, ${LABEL_META[clash.label].name.toLowerCase()}` : ""}, ${formatShare(clash.regret_share)} of the day's clash cost. Open details.`}
                    onClick={(event) => onOpen(clash, event.currentTarget)}
                    onMouseEnter={() => onHighlightClash(layout.id)}
                    onMouseLeave={() => onHighlightClash(null)}
                    onFocus={() => onHighlightClash(layout.id)}
                    onBlur={() => onHighlightClash(null)}
                    className={cn(
                      "pointer-events-auto absolute grid cursor-pointer place-items-center font-mono text-xs font-bold tabular-nums transition-[opacity,transform] duration-150 hover:scale-110 focus-visible:scale-110",
                      dimmed && !active && "opacity-30",
                    )}
                    style={{
                      left: layout.badge.x - BADGE / 2,
                      top: layout.badge.y - BADGE / 2,
                      width: BADGE,
                      height: BADGE,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-0.5 shadow-sm",
                        hidden
                          ? "rotate-45 rounded-[3px] border-2 border-foreground bg-highlight"
                          : "rounded-full border-2 border-background bg-foreground",
                      )}
                    />
                    <span
                      aria-hidden="true"
                      className={cn("relative", hidden ? "text-highlight-foreground" : "text-background")}
                    >
                      {clash.rank}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
