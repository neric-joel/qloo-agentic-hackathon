"use client";

import { useId, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { LABEL_META } from "@/lib/clashes";
import type { ClashLabel } from "@/lib/preset";

/**
 * The shared overlap mark's pattern id: unique per instance (React's id with everything but letters,
 * digits, `_` and `-` stripped, so it is safe in `url(#...)`).
 */
export function useOverlapPatternId(): string {
  return `cc-overlap-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/**
 * Shared time, defined once. One 1.5px raspberry line every 16px at 45 degrees, at full opacity,
 * inside a card-coloured window cut into the open bar of a pair; the window keeps a 2px card gap
 * inside the bar's edge. Raspberry appears only on shared time and never touches ink: there is no
 * wash, no opacity and no second hatch.
 */
export const OVERLAP = { period: 16, stroke: 1.5, gap: 2 } as const;

/** An SVG length: user units, or a percentage string such as "37.5%". */
type Len = number | string;

/**
 * The shared-time hatch: 16px user-space tiles turned 45 degrees, each holding one 1.5px
 * `var(--primary)` line at full opacity (one 1.5px raspberry line every 16px). Put it in the SVG's `<defs>`; fill only through
 * `OverlapWindow`.
 */
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

/**
 * The shared-time window, drawn ONLY on the open bar of a pair (card fill, ink outline); the solid
 * ink bar is never hatched or cut. Draw order for the open bar: its `var(--card)` fill, then this
 * window over the shared span (with `OverlapEdges` as its children), then the bar's 1.5px
 * `var(--foreground)` outline (dashed "4 3" when tested).
 *
 * Inside a clip of the bar's capsule it paints a card rect over the span, the hatch, the children,
 * and last a card halo on the capsule edge (`2 * OVERLAP.gap` wide, so only its inner 2px survive
 * the clip). The hatch and the cuts therefore end 2px inside the bar, 1.25px clear of the ink
 * outline, at the capsule's round ends too, and percentage geometry needs no inset arithmetic.
 * `className` and `style` go on the clipped group (the hero's grow animation).
 */
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

/**
 * The straight cuts where shared time starts and ends: a 1px `var(--primary)` line at each x, from
 * the top of the bar to its foot. Render it only as a child of `OverlapWindow`, which clips it to
 * the capsule and ends it under the card halo, so no cut touches the ink outline.
 */
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
 * The legend key for shared time: a 40x12 capsule (two hatch lines show at the 16px period) with the
 * card fill, the hatch, a 3px card halo inside the edge, and a 1px ink outline on top.
 */
export function OverlapSwatch({ className }: { className?: string }) {
  const patternId = useOverlapPatternId();
  const clipId = `${patternId}-clip`;
  return (
    <svg
      width={40}
      height={12}
      viewBox="0 0 40 12"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <defs>
        <OverlapPattern id={patternId} />
        <clipPath id={clipId}>
          <rect x={0} y={0} width={40} height={12} rx={6} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x={0} y={0} width={40} height={12} fill="var(--card)" />
        <rect x={0} y={0} width={40} height={12} fill={`url(#${patternId})`} />
        <rect x={0} y={0} width={40} height={12} rx={6} fill="none" stroke="var(--card)" strokeWidth={3} />
      </g>
      <rect x={0.5} y={0.5} width={39} height={11} rx={5.5} fill="none" stroke="var(--foreground)" strokeWidth={1} />
    </svg>
  );
}

/**
 * The hidden-clash mark beside the word Hidden: an ink ring on the card in a 12px box, so it differs
 * from a seen clash (a filled disc) by fill as well as by name. Hidden is a label of the board, not
 * shared time, so it is ink: raspberry is kept for shared minutes and their cost. The name is kept
 * for the callers that already import it.
 */
export function DiamondGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" className={cn("size-3 shrink-0", className)}>
      <circle data-mark="hidden" cx={6} cy={6} r={4.75} fill="var(--card)" stroke="var(--foreground)" strokeWidth="2" />
    </svg>
  );
}

/** The seen-clash mark: a filled raspberry disc in a 12px box, the board's filled clash disc. */
export function SeenDiscGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" className={cn("size-3 shrink-0", className)}>
      <circle data-mark="seen" cx={6} cy={6} r={5.75} fill="var(--primary)" />
    </svg>
  );
}

/**
 * The board's clash disc at its real 22px: filled raspberry for a seen clash, an ink ring on the card
 * for a hidden one. Hidden is a label of the board, not shared time, so its ring is ink, as it is in
 * the list and the drawer; the raspberry link the disc sits on still marks the shared time. Round,
 * never turned. The board lays its rank numeral over it (paper on the filled disc, ink in the ring).
 */
export function ClashDisc({ hidden, className }: { hidden: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-clash-disc={hidden ? "hidden" : "seen"}
      className={cn(
        "block size-5.5 shrink-0 rounded-full",
        hidden ? "border-2 border-foreground bg-card" : "bg-primary",
        className,
      )}
    />
  );
}

/**
 * What a clash link and its numbered mark on the board are called, built from the pair:
 * "Hidden clash 3: Nadine Shah and Abel Selaocoe & the Bantu Ensemble", or "Clash 1: A and B".
 * The mark's button reads it first and shows it as its native tooltip.
 */
export function clashMarkLabel(clash: {
  rank: number;
  label?: ClashLabel | null;
  a: { name: string };
  b: { name: string };
}): string {
  return `${clash.label === "hidden" ? "Hidden clash" : "Clash"} ${clash.rank}: ${clash.a.name} and ${clash.b.name}`;
}

/** A clash's label as the board's one tag, in ink: Hidden with its outlined ink disc, the others as words alone. */
export function LabelBadge({ label, className }: { label: ClashLabel; className?: string }) {
  const meta = LABEL_META[label];
  return (
    <span
      className={cn("tag tag-ink shrink-0", className)}
      title={meta.explain}
    >
      {label === "hidden" ? <DiamondGlyph /> : null}
      {meta.name}
    </span>
  );
}

/**
 * A labelled 0..1 bar, a capsule (rounded-bar) on the muted track; the fill is clipped inside it:
 * ink, raspberry only for a cost, or teal for a value from Qloo. The figure is always printed next to it, so the
 * bar is never the only cue. The fill is drawn at its width, with no entrance motion.
 */
export function Meter({
  value,
  label,
  tone = "ink",
  className,
}: {
  value: number;
  /** Accessible name, e.g. "Draw 97 of 100". */
  label: string;
  tone?: "ink" | "primary" | "qloo";
  className?: string;
}) {
  const width = `${Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10}%`;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("relative block h-2 overflow-hidden rounded-bar bg-muted", className)}
    >
      <span
        className={cn(
          "cc-meter-fill absolute inset-y-0 left-0",
          tone === "primary" ? "bg-primary" : tone === "qloo" ? "bg-prov-qloo" : "bg-foreground",
        )}
        style={{ width }}
      />
    </span>
  );
}
