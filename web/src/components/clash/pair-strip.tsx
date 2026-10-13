"use client";

import type { CSSProperties, ReactNode } from "react";

import { formatClock, overlapWindow } from "@/lib/timetable";
import { cn } from "@/lib/utils";

import { OverlapEdges, OverlapPattern, OverlapWindow, useOverlapPatternId } from "./marks";

/** A span of the day in minutes from its start, as the strip draws it. */
export type StripSpan = { start: number; end: number };

/** The strip's time axis: its ends in minutes, the tick step, and every tick it labels (each a multiple of the step). */
export type StripDomain = { start: number; end: number; step: 30 | 60; ticks: number[] };

const QUARTER = 15;

/**
 * One time domain and one tick policy for every strip, so the hero, Try a move and Keep two sets apart
 * draw comparable geometry: from the earliest start of all lanes floored to 15 minutes to the latest end
 * ceiled to 15 minutes (at least 15 minutes long). Ticks every 30 minutes when the span is 3 hours or
 * less, else every 60: every multiple of the step inside the domain, its ends included, and nothing else,
 * so the axis keeps one even rhythm (14:00 to 15:15 reads 14:00, 14:30, 15:00). An end that is not a
 * multiple of the step gets no tick and no label, so every tick the strip draws carries its time and two
 * labels are always a whole step apart.
 */
export function stripDomain(lanes: readonly StripSpan[]): StripDomain {
  const start = lanes.length > 0 ? Math.floor(Math.min(...lanes.map((lane) => lane.start)) / QUARTER) * QUARTER : 0;
  const rawEnd = lanes.length > 0 ? Math.ceil(Math.max(...lanes.map((lane) => lane.end)) / QUARTER) * QUARTER : QUARTER;
  const end = Math.max(rawEnd, start + QUARTER);
  const step: 30 | 60 = end - start <= 180 ? 30 : 60;
  const ticks: number[] = [];
  for (let minute = Math.ceil(start / step) * step; minute <= end; minute += step) ticks.push(minute);
  return { start, end, step, ticks };
}

/** Where a minute sits on the strip, as a share of the bar area (0 to 100). Every lane of a strip uses it. */
export function stripX(domain: Pick<StripDomain, "start" | "end">, minute: number): number {
  return ((minute - domain.start) / (domain.end - domain.start)) * 100;
}

/** An SVG percentage, rounded to a thousandth. */
function pct(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

/**
 * One lane of the strip. `staying` is the set that stays put: a solid ink capsule, never hatched or cut.
 * `now` is the open set where it plays now: a card capsule with a 1.5px ink outline. `tested` is the same
 * open capsule at a tested place, its outline dashed "4 3" (dashed always means tested).
 */
export type StripLane = StripSpan & {
  key: string;
  name: string;
  /** The second line of the label from 640px ("The Park", "Now · Woodsies"); inline after a middot under it. */
  meta?: ReactNode;
  /**
   * The third line of the label, the lane's time range ("14:00–15:00"), set in mono. With `evenPitch` every
   * lane's name, meta and range stack as three lines from 640px, and run as one line joined by middots
   * under it.
   */
  range?: ReactNode;
  kind: "staying" | "now" | "tested";
  /** The minutes printed under the bracket, when the caller already holds them; else read from the spans. */
  minutes?: number | null;
};

/**
 * The strip's optional motion. `hero` is the hero receipt: the Now window grows from its top edge, the
 * tested slot flies in from where the set plays now and the bracket under it shrinks to what is left.
 * `replay` replays the bracket alone. The classes live in globals.css, which shows the final frame under
 * reduced motion and in print.
 */
export type StripMotion = { mode: "hero" | "replay"; key: number } | null;

const BAR = 12;
const RX = BAR / 2;

/** The bar of one lane, as SVG with percentage x and width, so it sits on the strip's one scale at any width. */
function LaneBar({
  lane,
  domain,
  shared,
  patternId,
  grow,
  slot,
}: {
  lane: StripLane;
  domain: StripDomain;
  shared: StripSpan | null;
  patternId: string;
  grow: boolean;
  slot: { className: string; style: CSSProperties } | null;
}) {
  const x = pct(stripX(domain, lane.start));
  const width = pct(stripX(domain, lane.end) - stripX(domain, lane.start));
  const geometry = { x, y: 0, width, height: BAR };
  return (
    <svg
      data-strip-bar={lane.kind}
      width="100%"
      height={BAR}
      aria-hidden="true"
      focusable="false"
      className="block overflow-visible"
    >
      {lane.kind === "staying" ? (
        <rect {...geometry} rx={RX} fill="var(--foreground)" />
      ) : (
        <>
          {/* The open bar: its card fill, the shared time's window, then its ink outline over both. */}
          <rect {...geometry} rx={RX} fill="var(--card)" {...slot} />
          {shared ? (
            <OverlapWindow
              patternId={patternId}
              clipId={`${patternId}-${lane.key}`}
              bar={geometry}
              span={{
                x: pct(stripX(domain, shared.start)),
                width: pct(stripX(domain, shared.end) - stripX(domain, shared.start)),
              }}
              className={grow ? "cc-hero-clash" : undefined}
              style={grow ? { animationName: "cc-edge-grow" } : undefined}
            >
              <OverlapEdges
                xs={[pct(stripX(domain, shared.start)), pct(stripX(domain, shared.end))]}
                bar={{ y: 0, height: BAR }}
              />
            </OverlapWindow>
          ) : null}
          <rect
            {...geometry}
            rx={RX}
            fill="none"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            strokeDasharray={lane.kind === "tested" ? "4 3" : undefined}
            {...slot}
          />
        </>
      )}
    </svg>
  );
}

/** The words after the minutes under a bracket: "45 min shared", or "45 min at the same time". */
export type StripWording = "shared" | "same-time";

/** The line under a bracket, built from its minutes. */
export function bracketWords(minutes: number, wording: StripWording): string {
  return wording === "same-time" ? `${minutes} min at the same time` : `${minutes} min shared`;
}

/**
 * Under an open lane that shares time with the staying set: the bracket 4px below the bar (1px vermilion,
 * round caps, 4px end ticks) and the minutes under it in 13px mono vermilion, centred on the window and held
 * inside the bar area. With no time shared, "no time shared" (or "0 min at the same time") in muted mono,
 * under the bar's start.
 */
function Bracket({
  domain,
  shared,
  minutes,
  showMinutes,
  wording,
  bracketClass,
  bracketStyle,
}: {
  domain: StripDomain;
  shared: StripSpan | null;
  minutes: number;
  showMinutes: boolean;
  wording: StripWording;
  bracketClass?: string;
  bracketStyle?: CSSProperties;
}) {
  if (!shared) {
    return (
      <p data-strip-minutes="" className="mt-1 font-mono text-[0.8125rem] leading-4 text-muted-foreground">
        {wording === "same-time" ? bracketWords(0, wording) : "no time shared"}
      </p>
    );
  }
  const words = bracketWords(minutes, wording);
  // The label's box: about half a rem per 13px mono character, plus a rem, centred on the window.
  const box = Math.ceil(words.length / 2) + 1;
  const left = stripX(domain, shared.start);
  const right = stripX(domain, shared.end);
  const centre = (left + right) / 2;
  const stroke = { stroke: "var(--primary)", strokeWidth: 1, strokeLinecap: "round" } as const;
  return (
    <div data-strip-bracket="">
      <svg width="100%" height="6" aria-hidden="true" focusable="false" className="mt-1 block overflow-visible">
        <g className={bracketClass} style={bracketStyle}>
          <line x1={pct(left)} x2={pct(left)} y1="0.5" y2="5.5" {...stroke} />
          <line x1={pct(left)} x2={pct(right)} y1="5.5" y2="5.5" {...stroke} />
          <line x1={pct(right)} x2={pct(right)} y1="0.5" y2="5.5" {...stroke} />
        </g>
      </svg>
      {showMinutes ? (
        <div className="relative h-4">
          <p
            data-strip-minutes=""
            className="absolute top-0 text-center font-mono text-[0.8125rem] leading-4 whitespace-nowrap text-primary tabular-nums"
            style={{
              width: `${box}rem`,
              left: `clamp(0rem, calc(${pct(centre)} - ${box / 2}rem), calc(100% - ${box}rem))`,
            }}
          >
            {words}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** The label column every caller shares from 640px, so the bars of every strip start at the same x in their cards. */
const COLUMNS = "sm:grid sm:grid-cols-[9.5rem_minmax(0,1fr)]";

/**
 * One pair strip, as a strip cut from a printed running order: every lane on one time axis
 * (`stripDomain`), each a 12px capsule. The staying set is solid ink; each open lane (now or tested) is
 * hatched inside its own bar over the minutes it shares with the staying set (`OverlapWindow` and
 * `OverlapEdges` from marks.tsx), with a bracket 4px under it and the minutes under the bracket. From
 * 640px a 9.5rem label column holds each act's name (14px semibold ink) over its meta (12px muted),
 * centred on its bar; under 640px the label sits 4px above the bar. Names wrap and are never cut. One
 * axis along the top: 12px mono muted times over 1px `var(--border-strong)` ticks, every tick with its
 * time, each a whole step from the next. With `evenPitch` (the hero) every lane is one block of the same
 * height, its label three lines from 640px (name, meta, range) and one line joined by middots under it,
 * and its bar at the same offset inside it, so the bars sit on one pitch and a label that wraps grows
 * every block with it. Under 640px a lane that draws no bracket (the staying set) takes only its label and
 * its bar, and the bracketed lanes keep one height between them. The drawing is hidden from screen readers; the
 * caller's `description` is read in its place (null when a visible line beside the strip already says
 * the same).
 */
export function PairStrip({
  lanes,
  description,
  minutes = true,
  wording = "shared",
  motion = null,
  evenPitch = false,
  className,
}: {
  lanes: readonly StripLane[];
  description: ReactNode | null;
  /** Whether the minutes print under each bracket. */
  minutes?: boolean;
  /** The words after the minutes: "min shared" (the hero and Try a move) or "min at the same time" (Keep two sets apart). */
  wording?: StripWording;
  motion?: StripMotion;
  /** Every lane one block of the same height, its label three lines from 640px (one under it), its bar at the same offset. */
  evenPitch?: boolean;
  className?: string;
}) {
  const patternId = useOverlapPatternId();
  const domain = stripDomain(lanes);
  const staying = lanes.find((lane) => lane.kind === "staying") ?? null;
  const sharedOf = (lane: StripLane): StripSpan | null =>
    staying && lane.kind !== "staying" ? overlapWindow(lane, staying) : null;
  const now = lanes.find((lane) => lane.kind === "now") ?? null;
  const tested = lanes.find((lane) => lane.kind === "tested") ?? null;
  const nowShared = now ? sharedOf(now) : null;
  const testedShared = tested ? sharedOf(tested) : null;
  // The bracket under what is left shrinks from the width of what was shared before.
  const ratio =
    nowShared && testedShared ? (nowShared.end - nowShared.start) / (testedShared.end - testedShared.start) : null;
  const hero = motion?.mode === "hero";
  // Whether a lane draws a bracket (and its minutes) under its bar.
  const bracketed = (lane: StripLane) => lane.kind !== "staying" && Boolean(minutes || sharedOf(lane));
  // On one pitch every lane keeps the room the open lanes need under their bars, so the blocks match. Under
  // 640px a lane that draws no bracket (the staying set) gives that room back: it takes only its label and
  // its bar, and the bracketed lanes share one height (the template's equal `1fr` rows).
  const hangs = lanes.some(bracketed);
  const phoneRows = { "--strip-rows": lanes.map((lane) => (bracketed(lane) ? "1fr" : "auto")).join(" ") } as CSSProperties;

  return (
    <div data-pair-strip="" className={cn("min-w-0", className)}>
      {description ? <p className="sr-only">{description}</p> : null}
      <div aria-hidden="true" className="min-w-0">
        <svg width="0" height="0" className="absolute" focusable="false">
          <defs>
            <OverlapPattern id={patternId} />
          </defs>
        </svg>

        {/* The clock along the top: one axis for the whole strip. */}
        <div data-strip-axis="" className={COLUMNS}>
          <span className="max-sm:hidden" />
          <div className="min-w-0">
            <div className="relative h-4">
              {/* A label at the domain's start starts at it, one at its end ends at it, and every other label
                  is centred on its tick; the ticks are a whole step apart, so no two labels meet. */}
              {domain.ticks.map((minute) => (
                <span
                  key={minute}
                  className={cn(
                    "absolute top-0 font-mono text-xs leading-4 whitespace-nowrap text-muted-foreground tabular-nums",
                    minute === domain.start ? "" : minute === domain.end ? "-translate-x-full" : "-translate-x-1/2",
                  )}
                  style={{ left: pct(stripX(domain, minute)) }}
                >
                  {formatClock(minute)}
                </span>
              ))}
            </div>
            <svg width="100%" height="6" className="block overflow-visible" focusable="false">
              {domain.ticks.map((minute) => (
                <line
                  key={minute}
                  x1={pct(stripX(domain, minute))}
                  x2={pct(stripX(domain, minute))}
                  y1="1"
                  y2="6"
                  stroke="var(--border-strong)"
                  strokeWidth="1"
                  shapeRendering="crispEdges"
                />
              ))}
            </svg>
          </div>
        </div>

        {/* On one pitch the lanes sit 6px apart under 640px (8px from it), so the phone's strip and its key
            fit the first screen; a lane's label stays 4px over its bar. From 640px every row is one height;
            under it the rows follow `phoneRows`. */}
        <div
          className={
            evenPitch ? "mt-2 grid gap-1.5 max-sm:grid-rows-(--strip-rows) sm:auto-rows-fr sm:gap-2" : "mt-2 space-y-2"
          }
          style={evenPitch ? phoneRows : undefined}
        >
          {lanes.map((lane) => {
            const shared = sharedOf(lane);
            const open = lane.kind !== "staying";
            const count = typeof lane.minutes === "number" ? lane.minutes : shared ? shared.end - shared.start : 0;
            const slot =
              hero && lane.kind === "tested" && now
                ? {
                    className: "cc-hero-slot",
                    style: { "--dx": pct(stripX(domain, now.start) - stripX(domain, lane.start)) } as CSSProperties,
                  }
                : null;
            const band =
              lane.kind === "tested" && ratio && motion
                ? {
                    bracketClass: hero ? "cc-hero-band" : "cc-overlap-band",
                    bracketStyle: { "--band-from": ratio } as CSSProperties,
                  }
                : {};
            return (
              <div
                key={lane.key}
                data-strip-lane={lane.kind}
                className={cn(
                  COLUMNS,
                  "min-w-0 sm:items-center",
                  evenPitch
                    ? // Every block as tall as the tallest (the grid's equal rows), with the same room under
                      // its bar: the bracket (4 + 6px) and the minutes (16px). From 640px the bar is centred on
                      // a label of at least three lines (52px), which holds 20px of that room under it; under
                      // 640px the label and bar sit at the foot of the block, so a label that wraps moves no bar,
                      // and a lane with no bracket keeps no room under its bar.
                      cn(
                        "max-sm:flex max-sm:flex-col max-sm:justify-end",
                        hangs && minutes && (bracketed(lane) ? "pb-6.5 sm:pb-1.5" : "sm:pb-1.5"),
                        hangs && !minutes && bracketed(lane) && "pb-2.5 sm:pb-0",
                      )
                    : // Room for what hangs under the bar: the bracket (4 + 6px) and the minutes (16px). From
                      // 640px the 36px label row already holds 12px of it under the centred bar.
                      cn(open && minutes && "pb-6.5 sm:pb-3.5", open && !minutes && shared && "pb-2.5 sm:pb-0"),
                )}
              >
                {evenPitch ? (
                  // From 640px three lines in the label column: the name, the meta ("Now · Woodsies"), the
                  // range in mono. Under 640px one line 4px over the bar: the name in 14px semibold ink, then
                  // " · " and the meta, then " · " and the range, in 13px muted. The meta and the range never
                  // break inside, and each middot holds to the item before it, so a line too long for the
                  // strip wraps between items only.
                  <p className="min-w-0 text-sm leading-5 font-semibold break-words text-foreground sm:flex sm:min-h-9 sm:flex-col sm:justify-center sm:pr-3">
                    <span>{lane.name}</span>
                    {lane.meta ? (
                      <>
                        <span className="text-[0.8125rem] font-normal text-muted-foreground sm:hidden">{" · "}</span>
                        <span className="text-[0.8125rem] font-normal text-muted-foreground max-sm:whitespace-nowrap sm:text-xs sm:leading-4">
                          {lane.meta}
                        </span>
                      </>
                    ) : null}
                    {lane.range ? (
                      <>
                        <span className="text-[0.8125rem] font-normal text-muted-foreground sm:hidden">{" · "}</span>
                        <span className="font-mono text-[0.8125rem] font-normal text-muted-foreground tabular-nums max-sm:whitespace-nowrap sm:text-xs sm:leading-4">
                          {lane.range}
                        </span>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="min-w-0 text-[0.8125rem] leading-5 font-semibold break-words text-foreground sm:flex sm:min-h-9 sm:flex-col sm:justify-center sm:pr-3 sm:text-sm">
                    <span>{lane.name}</span>
                    {lane.meta ? (
                      <span className="text-xs leading-4 font-normal text-muted-foreground">
                        <span className="sm:hidden"> · </span>
                        {lane.meta}
                      </span>
                    ) : null}
                    {lane.range ? (
                      <span className="font-mono text-xs leading-4 font-normal text-muted-foreground tabular-nums">
                        <span className="sm:hidden"> · </span>
                        {lane.range}
                      </span>
                    ) : null}
                  </p>
                )}
                <div className="relative min-w-0 max-sm:mt-1">
                  <LaneBar
                    lane={lane}
                    domain={domain}
                    shared={shared}
                    patternId={patternId}
                    grow={hero && lane.kind === "now"}
                    slot={slot}
                  />
                  {open && (minutes || shared) ? (
                    <div className="absolute inset-x-0 top-full">
                      <Bracket
                        key={motion ? `band-${motion.key}` : "band"}
                        domain={domain}
                        shared={shared}
                        minutes={count}
                        showMinutes={minutes}
                        wording={wording}
                        {...band}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
