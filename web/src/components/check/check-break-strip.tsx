"use client";

import { useId, type CSSProperties, type ReactNode } from "react";

import { formatClock, type CheckSet, type CheckSettings, type RuleBreak, type RuleId } from "@/lib/check";
import { cn } from "@/lib/utils";

/*
 * The strip primitives, held here as exact copies of `stripDomain`, `stripX` and `bracketWords`
 * (components/clash/pair-strip.tsx) and of `useOverlapPatternId`, `OverlapPattern`, `OverlapWindow` and
 * `OverlapEdges` (components/clash/marks.tsx). The /check route may import nothing outside its own
 * modules and a short allowlist (check-privacy.test.ts), and those two files reach the preset day's
 * modules (`@/lib/timetable`, `@/lib/clashes`). check-break-strip.test.ts renders each copy beside the
 * original and asserts they are identical, so the break strip draws the hero's marks and cannot drift.
 */

/** pair-strip's `stripDomain`, start and end only (the break strip prints no ticks). */
export function stripDomain(lanes: readonly BreakSpan[]): BreakSpan {
  const start = lanes.length > 0 ? Math.floor(Math.min(...lanes.map((lane) => lane.start)) / 15) * 15 : 0;
  const rawEnd = lanes.length > 0 ? Math.ceil(Math.max(...lanes.map((lane) => lane.end)) / 15) * 15 : 15;
  return { start, end: Math.max(rawEnd, start + 15) };
}

/** pair-strip's `stripX`: where a minute sits, as a share of the bar area (0 to 100). */
export function stripX(domain: BreakSpan, minute: number): number {
  return ((minute - domain.start) / (domain.end - domain.start)) * 100;
}

/** pair-strip's `bracketWords` in its "shared" wording: "45 min shared". */
export function bracketWords(minutes: number): string {
  return `${minutes} min shared`;
}

/** marks' `useOverlapPatternId`. */
export function useOverlapPatternId(): string {
  return `cc-overlap-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/** marks' `OVERLAP`: one 1.5px vermilion line every 16px, a 2px card gap inside the bar's edge. */
const OVERLAP = { period: 16, stroke: 1.5, gap: 2 } as const;

type Len = number | string;

/** marks' `OverlapPattern`. */
export function OverlapPattern({ id }: { id: string }) {
  return (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width={OVERLAP.period}
      height={OVERLAP.period}
      patternTransform="rotate(45)"
    >
      <line x1={0} y1={0} x2={0} y2={OVERLAP.period} stroke="var(--primary)" strokeWidth={OVERLAP.stroke} />
    </pattern>
  );
}

/** marks' `OverlapWindow`. */
export function OverlapWindow({
  patternId,
  clipId,
  bar,
  span,
  className,
  style,
  children,
}: {
  patternId: string;
  clipId: string;
  bar: { x: Len; y: number; width: Len; height: number };
  span: { x: Len; width: Len };
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const rx = bar.height / 2;
  return (
    <>
      <clipPath id={clipId}>
        <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={rx} />
      </clipPath>
      <g clipPath={`url(#${clipId})`} className={className} style={style}>
        <rect x={span.x} y={bar.y} width={span.width} height={bar.height} fill="var(--card)" />
        <rect x={span.x} y={bar.y} width={span.width} height={bar.height} fill={`url(#${patternId})`} />
        {children}
        <rect
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={rx}
          fill="none"
          stroke="var(--card)"
          strokeWidth={2 * OVERLAP.gap}
        />
      </g>
    </>
  );
}

/** marks' `OverlapEdges`. */
export function OverlapEdges({
  xs,
  bar,
  className,
  style,
}: {
  xs: readonly Len[];
  bar: { y: number; height: number };
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <g className={className} style={style}>
      {xs.map((x, i) => (
        <line
          key={`${x}-${i}`}
          x1={x}
          x2={x}
          y1={bar.y}
          y2={bar.y + bar.height}
          stroke="var(--primary)"
          strokeWidth={1}
          strokeLinecap="butt"
          shapeRendering="crispEdges"
        />
      ))}
    </g>
  );
}

/**
 * A break's rows in ascending row order (row 17 before row 21), for display: a sorted copy, so the
 * break itself (whose order some repair lines read) is never changed. The results list, the compact list
 * beside the sheet and the strip under each finding all read the rows in this order.
 */
export function rowsInOrder(rows: readonly number[]): number[] {
  return [...rows].sort((a, b) => a - b);
}

/** A span of the day in minutes from 00:00; after-midnight minutes run on past 1440, never wrapped. */
export type BreakSpan = { start: number; end: number };

/**
 * Everything one break's strip draws, built from the same sets and settings the check read. Every label
 * it prints is a number the finding already prints in its text or detail; the strip adds none.
 */
export type BreakGeometry = {
  rule: RuleId;
  /** The x domain: `stripDomain` over the cited rows (and the changeover's end, or the curfew minute). */
  domain: BreakSpan;
  /** One lane per cited row, in table order. */
  lanes: (BreakSpan & { row: number })[];
  /** The time the two sets share, hatched on both lanes (rules 1, 2 and 5). */
  shared: BreakSpan | null;
  /**
   * The vermilion bracket under the lanes: the shared time (rules 1, 2, 5), the gap between the sets
   * (rule 3; start equals end when they meet), or the part of the set past the curfew (rule 4, unlabelled:
   * the finding prints no overrun in minutes).
   */
  cost: BreakSpan & { label: string | null };
  /** Rule 3: the changeover the gap falls under, from the first set's end, as a muted bracket over the lanes. */
  minimum: (BreakSpan & { label: string }) | null;
  /** Rule 4: the curfew, as a border-strong rule with its clock above it. */
  curfew: { minute: number; label: string } | null;
  /** Every label the strip prints besides "row N", in drawing order. */
  labels: string[];
};

type BreakInput = Pick<RuleBreak, "rule" | "text" | "detail" | "rows">;

/** "1 minute", "20 minutes": the words the check prints. */
function minutesWords(count: number): string {
  return `${count} ${count === 1 ? "minute" : "minutes"}`;
}

/** "16:40–17:20": a set's span as the check prints it. */
function spanWords(set: Pick<CheckSet, "start" | "end">): string {
  return `${formatClock(set.start)}–${formatClock(set.end)}`;
}

/**
 * A break's strip, as data: pure, from the same CheckSet fields and settings `findBreaks` reads (the
 * shared minutes as its overlap, the gap as the second set's start less the first set's end, the
 * changeover, the curfew). Times stay minutes from 00:00 on one axis, after midnight included. Returns
 * null, and the strip draws nothing, when a row cannot be found, the break's shape is not the rule's, or
 * any value the strip would print differs from the one the finding prints.
 */
export function breakGeometry(
  item: BreakInput,
  sets: readonly Pick<CheckSet, "row" | "start" | "end">[],
  settings: Pick<CheckSettings, "changeover" | "curfew">,
): BreakGeometry | null {
  const byRow = new Map(sets.map((set) => [set.row, set]));
  const cited = item.rows.map((row) => byRow.get(row));
  if (cited.length === 0 || cited.some((set) => set === undefined)) return null;
  if (new Set(item.rows).size !== item.rows.length) return null;
  const listed = cited as Pick<CheckSet, "row" | "start" | "end">[];
  const lanes = rowsInOrder(item.rows).map((row) => {
    const set = byRow.get(row) as Pick<CheckSet, "row" | "start" | "end">;
    return { row, start: set.start, end: set.end };
  });
  const said = `${item.text} ${item.detail}`;
  const domainOf = (spans: readonly BreakSpan[]): BreakSpan => {
    const { start, end } = stripDomain(spans);
    return { start, end };
  };

  switch (item.rule) {
    case 1:
    case 2:
    case 5: {
      if (listed.length !== 2) return null;
      const [a, b] = listed;
      const shared = { start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) };
      const minutes = shared.end - shared.start;
      if (minutes <= 0) return null;
      const printed =
        item.rule === 5
          ? item.text.includes(`share ${minutesWords(minutes)},`)
          : item.detail.includes(`; ${minutesWords(minutes)} shared.`);
      if (!printed || !said.includes(spanWords(a)) || !said.includes(spanWords(b))) return null;
      const label = bracketWords(minutes);
      return {
        rule: item.rule,
        domain: domainOf(lanes),
        lanes,
        shared,
        cost: { ...shared, label },
        minimum: null,
        curfew: null,
        labels: [label],
      };
    }
    case 3: {
      if (listed.length !== 2) return null;
      const [first, second] = listed;
      const gap = second.start - first.end;
      const changeover = settings.changeover;
      if (gap < 0 || gap >= changeover) return null;
      const printed =
        item.text.includes(` are ${minutesWords(gap)} apart `) &&
        item.text.includes(`under the ${changeover}-minute changeover.`) &&
        item.detail.includes(` ends ${formatClock(first.end)};`) &&
        item.detail.includes(` starts ${formatClock(second.start)}.`);
      if (!printed) return null;
      // The finding's own nouns: "under the 15-minute changeover", "10 minutes apart".
      const minimum = { start: first.end, end: first.end + changeover, label: `${changeover} min changeover` };
      const cost = { start: first.end, end: second.start, label: `${gap} min apart` };
      return {
        rule: 3,
        domain: domainOf([...lanes, minimum]),
        lanes,
        shared: null,
        cost,
        minimum,
        curfew: null,
        labels: [minimum.label, cost.label],
      };
    }
    case 4: {
      if (listed.length !== 1 || settings.curfew === null) return null;
      const [set] = listed;
      const minute = settings.curfew;
      if (set.end <= minute) return null;
      const label = formatClock(minute);
      const printed =
        item.text.includes(` ends at ${formatClock(set.end)}, after the ${label} curfew.`) && item.detail.includes(spanWords(set));
      if (!printed) return null;
      return {
        rule: 4,
        domain: domainOf([...lanes, { start: minute, end: minute }]),
        lanes,
        shared: null,
        cost: { start: Math.max(minute, set.start), end: set.end, label: null },
        minimum: null,
        curfew: { minute, label },
        labels: [label],
      };
    }
    default:
      return null;
  }
}

/** The hero's capsule: 12px tall, fully rounded. */
const BAR = 12;
const RX = BAR / 2;
/** Bar top to bar top. */
const PITCH = 18;
/** The room a 13px label takes over the bars (rule 4): a 14px line and 2px clear of the first outline. */
const HEAD = 16;
/**
 * Rule 3's head: the changeover's label on its own 14px line, then its bracket (the rule at 17.5, its ends
 * down to 21.5), then 4.5px clear of the first outline. The label never shares a line with the bracket.
 */
const MINIMUM_HEAD = 26;
/** The changeover bracket's rule and the foot of its two ends. */
const MINIMUM_RULE = 17.5;
const MINIMUM_FOOT = 21.5;
/** The minutes under a bracket: one 16px line, as the hero's. */
const FOOT_LINE = 16;

/** An SVG percentage, rounded to a thousandth. */
function pct(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

/** A 13px mono label's box, as the hero's bracket sizes it: about half a rem per character, plus a rem. */
function labelBox(words: string): number {
  return Math.ceil(words.length / 2) + 1;
}

/** A label centred on x (a percentage of the bar area) and held inside it, as the hero's minutes are. */
function centredOn(x: number, words: string, top: number): CSSProperties {
  const box = labelBox(words);
  return {
    top,
    width: `${box}rem`,
    left: `clamp(0rem, calc(${pct(x)} - ${box / 2}rem), calc(100% - ${box}rem))`,
  };
}

const VERMILION = { stroke: "var(--primary)", strokeWidth: 1, strokeLinecap: "round" } as const;
const RULE_LINE = { stroke: "var(--border-strong)", strokeWidth: 1, strokeLinecap: "round" } as const;
/** The changeover the gap falls under: the rule, in the muted text colour, so it reads as a value, not scaffolding. */
const MINIMUM_LINE = { stroke: "var(--muted-foreground)", strokeWidth: 1, strokeLinecap: "round" } as const;
const LABEL = "absolute font-mono text-[0.8125rem] whitespace-nowrap tabular-nums";

/**
 * One rule break drawn in the hero's figure language, under the finding's row references: a lane per
 * cited row, each the hero's "now" capsule (12px, card fill, 1.5px ink outline) on one time axis, with
 * no clock ticks. Rules 1, 2 and 5 hatch the shared time on both lanes (`OverlapWindow`, as the hero)
 * and bracket it under the lower lane with "{N} min shared". Rule 3 brackets the gap in vermilion
 * ("{gap} min apart") under the lanes and the changeover it falls under in muted ("{changeover} min
 * changeover") over them, each label centred on its own bracket on its own line. Rule 4 draws the curfew as a border-strong rule with its clock above and an unlabelled
 * vermilion bracket under the part of the bar past it. Vermilion never touches ink: the brackets hang 4px
 * under the capsules and the hatch stays inside the window's card halo. The drawing repeats the finding
 * above it, so it is hidden from screen readers and from print, and holds no control.
 */
export function BreakStrip({
  item,
  sets,
  settings,
  className,
}: {
  item: BreakInput;
  sets: readonly Pick<CheckSet, "row" | "start" | "end">[];
  settings: Pick<CheckSettings, "changeover" | "curfew">;
  className?: string;
}) {
  const patternId = useOverlapPatternId();
  const geometry = breakGeometry(item, sets, settings);
  if (!geometry) return null;
  const { domain, lanes, shared, cost, minimum, curfew } = geometry;
  const x = (minute: number) => stripX(domain, minute);

  // Rows top to bottom: an optional head (the changeover or curfew label), the lanes, then the bracket.
  const head = minimum ? MINIMUM_HEAD : curfew ? HEAD : 2;
  const barTop = (i: number) => head + (curfew ? 4 : 0) + i * PITCH;
  const lastBottom = barTop(lanes.length - 1) + BAR;
  // The curfew rule runs 4px past the bar, so its bracket starts 2px under the rule's end.
  const bracketTop = lastBottom + (curfew ? 6 : 4);
  const height = bracketTop + 6 + (cost.label ? FOOT_LINE : 0);

  const left = x(cost.start);
  const right = x(cost.end);

  return (
    <div
      aria-hidden="true"
      data-break-strip={geometry.rule}
      className={cn("mt-2 grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] print:hidden", className)}
    >
      <div className="relative" style={{ height }}>
        {lanes.map((lane, i) => (
          <span
            key={lane.row}
            data-strip-row={lane.row}
            className="absolute left-0 font-mono text-xs leading-4 whitespace-nowrap text-muted-foreground tabular-nums"
            style={{ top: barTop(i) + RX - 8 }}
          >
            row {lane.row}
          </span>
        ))}
      </div>
      <div className="relative min-w-0" style={{ height }}>
        <svg width="100%" height={height} focusable="false" className="block overflow-visible">
          <defs>
            <OverlapPattern id={patternId} />
          </defs>

          {lanes.map((lane, i) => {
            const bar = { x: pct(x(lane.start)), y: barTop(i), width: pct(x(lane.end) - x(lane.start)), height: BAR };
            return (
              <g key={lane.row} data-strip-lane={lane.row}>
                <rect {...bar} rx={RX} fill="var(--card)" />
                {shared ? (
                  <OverlapWindow
                    patternId={patternId}
                    clipId={`${patternId}-row${lane.row}`}
                    bar={bar}
                    span={{ x: pct(x(shared.start)), width: pct(x(shared.end) - x(shared.start)) }}
                  >
                    <OverlapEdges xs={[pct(x(shared.start)), pct(x(shared.end))]} bar={{ y: bar.y, height: BAR }} />
                  </OverlapWindow>
                ) : null}
                {curfew ? (
                  <line
                    data-strip-curfew=""
                    x1={pct(x(curfew.minute))}
                    x2={pct(x(curfew.minute))}
                    y1={bar.y - 4}
                    y2={bar.y + BAR + 4}
                    {...RULE_LINE}
                    strokeLinecap="butt"
                    shapeRendering="crispEdges"
                  />
                ) : null}
                <rect {...bar} rx={RX} fill="none" stroke="var(--foreground)" strokeWidth={1.5} />
              </g>
            );
          })}

          {minimum ? (
            <g data-strip-minimum="">
              <line x1={pct(x(minimum.start))} x2={pct(x(minimum.start))} y1={MINIMUM_RULE} y2={MINIMUM_FOOT} {...MINIMUM_LINE} />
              <line x1={pct(x(minimum.start))} x2={pct(x(minimum.end))} y1={MINIMUM_RULE} y2={MINIMUM_RULE} {...MINIMUM_LINE} />
              <line x1={pct(x(minimum.end))} x2={pct(x(minimum.end))} y1={MINIMUM_RULE} y2={MINIMUM_FOOT} {...MINIMUM_LINE} />
            </g>
          ) : null}

          <g data-strip-cost="">
            {cost.end > cost.start ? (
              <>
                <line x1={pct(left)} x2={pct(left)} y1={bracketTop + 0.5} y2={bracketTop + 5.5} {...VERMILION} />
                <line x1={pct(left)} x2={pct(right)} y1={bracketTop + 5.5} y2={bracketTop + 5.5} {...VERMILION} />
                <line x1={pct(right)} x2={pct(right)} y1={bracketTop + 0.5} y2={bracketTop + 5.5} {...VERMILION} />
              </>
            ) : (
              // The two sets meet: the gap is one 4px tick at the boundary.
              <line x1={pct(left)} x2={pct(left)} y1={bracketTop + 1} y2={bracketTop + 5} {...VERMILION} />
            )}
          </g>
        </svg>

        {minimum ? (
          <span
            data-strip-label="minimum"
            className={cn(LABEL, "leading-3.5 text-center text-muted-foreground")}
            style={centredOn((x(minimum.start) + x(minimum.end)) / 2, minimum.label, 0)}
          >
            {minimum.label}
          </span>
        ) : null}
        {curfew ? (
          <span
            data-strip-label="curfew"
            className={cn(LABEL, "leading-3.5 text-center text-muted-foreground")}
            style={centredOn(x(curfew.minute), curfew.label, 0)}
          >
            {curfew.label}
          </span>
        ) : null}
        {cost.label ? (
          <span
            data-strip-label="cost"
            className={cn(LABEL, "leading-4 text-center text-primary")}
            style={centredOn((left + right) / 2, cost.label, bracketTop + 6)}
          >
            {cost.label}
          </span>
        ) : null}
      </div>
    </div>
  );
}
