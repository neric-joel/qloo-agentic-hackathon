import { useId } from "react";

import { FIGURE_FRAMES, layoutFigure, type BriefFigure, type FigureFrame } from "@/lib/brief";
import { cn } from "@/lib/utils";

/**
 * The brief's day, drawn: one lane per stage with its name, every lane at one pitch, an hourly axis, every set as a
 * rounded rectangle outlined in ink at the time the sheet leaves it, each kept step's published slot dashed and the
 * minutes its set still shares with its named partner hatched (with no kept step, the costliest clash's shared
 * minutes). A set is the day drawing's mark, smaller: every bar, dashed slot and hatch clip takes `frame.radius`, a
 * third of the bar's height, so it never closes into a capsule. The hatch is a 45-degree line pattern in the current
 * colour, raspberry on the screen and ink on paper, so it survives greyscale. Static: no motion, no control, no
 * tooltip (pointer events are off, so the title never shows as one).
 *
 * Two frames of the same drawing: the wide one from 640px and on paper, the narrow one on a phone. Each SVG carries
 * the caption's first sentence as its title and the rest as its description.
 */
export function BriefDayFigure({ figure, className }: { figure: BriefFigure; className?: string }) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  return (
    <figure data-brief-figure="" className={cn("break-inside-avoid", className)}>
      <DaySvg figure={figure} frame={FIGURE_FRAMES.wide} name="wide" id={`${uid}w`} className="hidden sm:block print:block" />
      <DaySvg figure={figure} frame={FIGURE_FRAMES.narrow} name="narrow" id={`${uid}n`} className="block sm:hidden print:hidden" />
      <figcaption className="mt-1.5 text-sm leading-snug text-muted-foreground print:mt-[1.5pt] print:text-[9pt] print:leading-[1.17]">
        {figure.caption}
      </figcaption>
    </figure>
  );
}

function DaySvg({
  figure,
  frame,
  name,
  id,
  className,
}: {
  figure: BriefFigure;
  frame: FigureFrame;
  name: "wide" | "narrow";
  id: string;
  className: string;
}) {
  const layout = layoutFigure(figure, frame);
  const hatchId = `${id}-hatch`;
  const clipId = (bar: number) => `${id}-clip-${bar}`;
  const clipped = [...new Set(layout.hatches.map((hatch) => hatch.bar))];
  const labelY = frame.bar / 2 + frame.font * 0.35;

  return (
    <svg
      data-frame={name}
      role="img"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      focusable="false"
      fontSize={frame.font}
      className={cn("pointer-events-none h-auto w-full overflow-visible select-none", className)}
    >
      <title id={`${id}-title`}>{figure.title}</title>
      <desc id={`${id}-desc`}>{figure.desc}</desc>
      <defs>
        {/* The hatch: one 1.5-unit line every 5 units at 45 degrees, in the pattern's current colour. */}
        <pattern
          id={hatchId}
          patternUnits="userSpaceOnUse"
          width={5}
          height={5}
          patternTransform="rotate(45)"
          className="text-primary print:text-foreground"
        >
          <line x1={2.5} y1={0} x2={2.5} y2={5} stroke="currentColor" strokeWidth={1.5} />
        </pattern>
        {clipped.map((index) => {
          const bar = layout.bars[index];
          return (
            <clipPath key={index} id={clipId(index)}>
              <rect x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={frame.radius} />
            </clipPath>
          );
        })}
      </defs>

      {/* Hours: a recessive gridline on each, a label on each whole step that has room. */}
      {layout.ticks.map((tick) => (
        <line
          key={`grid-${tick.x}`}
          x1={tick.x}
          x2={tick.x}
          y1={frame.hourBaseline + 1.5}
          y2={layout.height}
          stroke="var(--border)"
          strokeWidth={0.75}
        />
      ))}
      {layout.ticks.map((tick) =>
        tick.label ? (
          <text key={`hour-${tick.x}`} data-hour="" x={tick.x} y={frame.hourBaseline} textAnchor="middle" fill="var(--muted-foreground)">
            {tick.label}
          </text>
        ) : null,
      )}

      {layout.lanes.map((lane) => (
        <text key={`stage-${lane.name}`} data-stage="" x={0} y={lane.barY + labelY} fill="var(--muted-foreground)">
          {lane.name}
        </text>
      ))}

      {/* The named sets, each in the gap over its own bar. A halo in the sheet's colour lifts the name off the hour
          gridlines; the marks are drawn after it, so it never cuts a bar's edge or a dashed slot. */}
      {layout.names.map((label) => (
        <text
          key={`name-${label.actId}`}
          data-name={label.actId}
          x={label.x}
          y={label.y}
          fontWeight={600}
          fill="var(--foreground)"
          stroke="var(--card)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {label.text}
        </text>
      ))}

      {/* Under the bars, so a set kept on its own stage covers the part of its old slot it still holds. */}
      {layout.ghosts.map((ghost) => (
        <rect
          key={`ghost-${ghost.actId}`}
          data-ghost={ghost.actId}
          x={ghost.x}
          y={ghost.y}
          width={ghost.w}
          height={ghost.h}
          rx={frame.radius}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1.25}
          strokeDasharray="3 2"
        />
      ))}

      {layout.bars.map((bar) => (
        <rect
          key={`set-${bar.actId}`}
          data-set={bar.actId}
          data-named={bar.named ? "" : undefined}
          data-moved={bar.moved ? "" : undefined}
          x={bar.x}
          y={bar.y}
          width={bar.w}
          height={bar.h}
          rx={frame.radius}
          fill="var(--card)"
          stroke="var(--foreground)"
          strokeWidth={bar.named ? 1.5 : 0.75}
        />
      ))}

      {/* Shared minutes: the wash (screen only) and the hatch, clipped by the bar's own rounded shape, then the bar's
          edge again on top so it stays one clean line. */}
      {layout.hatches.map((hatch) => {
        const bar = layout.bars[hatch.bar];
        return (
          <g key={`hatch-${hatch.bar}-${hatch.x}`} clipPath={`url(#${clipId(hatch.bar)})`}>
            <rect x={hatch.x} y={bar.y} width={hatch.w} height={bar.h} fill="var(--shared-wash)" className="print:hidden" />
            <rect data-hatch={bar.actId} x={hatch.x} y={bar.y} width={hatch.w} height={bar.h} fill={`url(#${hatchId})`} />
          </g>
        );
      })}
      {clipped.map((index) => {
        const bar = layout.bars[index];
        return (
          <rect
            key={`edge-${index}`}
            x={bar.x}
            y={bar.y}
            width={bar.w}
            height={bar.h}
            rx={frame.radius}
            fill="none"
            stroke="var(--foreground)"
            strokeWidth={bar.named ? 1.5 : 0.75}
          />
        );
      })}
    </svg>
  );
}
