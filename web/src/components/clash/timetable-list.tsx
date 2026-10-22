"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

import { noSignalLabel } from "@/lib/credit";
import { formatDraw, partnerOf, type SetView } from "@/lib/clashes";
import { lockLabel } from "@/lib/locks";
import type { PairClash } from "@/lib/preset";
import { formatClock, formatRange } from "@/lib/timetable";

import { DiamondGlyph } from "./marks";
import { isLongName } from "./timetable-grid";

type TimetableListProps = {
  views: readonly SetView[];
  dayLabel: string;
  onOpen: (clash: PairClash, trigger: HTMLElement) => void;
  /** The invented day: a set with no signal is "No taste signal", not "No Qloo signal". */
  synthetic?: boolean;
  className?: string;
};

/** Genre, draw and signal strength, for sets that have a usable signal. */
function meta(view: SetView): string {
  if (view.coverage === "none") return view.act.genre ?? "";
  return [
    view.act.genre,
    view.act.popularity !== null ? `Draw ${formatDraw(view.act.popularity)}` : null,
    view.coverage === "weak" ? "weak signal" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The small-screen timetable: every set in start order, grouped by hour, with its ranked clashes. */
export function TimetableList({ views, dayLabel, onOpen, synthetic = false, className }: TimetableListProps) {
  const ordered = [...views].sort((p, q) => p.slot.start - q.slot.start || p.col - q.col);
  const groups: { hour: number; items: SetView[] }[] = [];
  for (const view of ordered) {
    const hour = Math.floor(view.slot.start / 60) * 60;
    const last = groups[groups.length - 1];
    if (last && last.hour === hour) last.items.push(view);
    else groups.push({ hour, items: [view] });
  }

  return (
    <div className={className}>
      <p className="pb-2 text-[0.8125rem] leading-5 font-semibold">{dayLabel}, in start order</p>
      <ol className="mt-1">
        {groups.map((group) => (
          <li key={group.hour} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 border-b border-border py-3">
            <p className="type-numeral pt-0.5 text-xl leading-none tabular-nums">{formatClock(group.hour)}</p>
            <ul className="space-y-3">
              {group.items.map((view) => {
                const none = view.coverage === "none";
                return (
                  <li
                    key={view.id}
                    // The board's tile, on its 8px corner: the sheet in a 1px hairline (the stronger edge
                    // when it is in a ranked clash), or, with no signal, the sheet in a 1px dotted
                    // control-grey edge with an ink name (its label says why it is not priced).
                    className={cn(
                      "rounded-sm border px-2.5 py-2",
                      none
                        ? "border-dotted border-border-strong bg-card text-foreground"
                        : cn("bg-card", view.clashes.length > 0 ? "border-border-strong" : "border-border"),
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      {/* The name wraps in full: the list has no height to keep, so nothing is cut. */}
                      <p
                        className={cn(
                          "min-w-0 font-semibold break-words",
                          isLongName(view.act.name) ? "text-[0.8125rem] leading-tight" : "text-sm leading-tight",
                        )}
                      >
                        {view.act.name}
                      </p>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
                      {formatRange(view.slot)} · {view.stage.name}
                    </p>
                    {/* Whose lock it is, on its own line so the name keeps the card's full width: the board
                        tile's words ("Locked by this app: kept in place"; the invented day's own sentence). */}
                    {view.slot.locked ? (
                      <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold">
                        <Lock aria-hidden="true" className="size-3 shrink-0" />
                        {lockLabel({ synthetic, holds: false }).replace(/\.$/, "")}
                      </p>
                    ) : null}
                    {meta(view) ? <p className="mt-0.5 text-xs text-muted-foreground">{meta(view)}</p> : null}
                    {none ? (
                      <p className="mt-1.5 text-xs font-semibold text-muted-foreground">{noSignalLabel(synthetic)}, not scored</p>
                    ) : null}
                    {view.clashes.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {view.clashes.map((clash) => {
                          const partner = partnerOf(clash, view.id);
                          const hidden = clash.label === "hidden";
                          return (
                            <button
                              key={`${clash.a.act_id}|${clash.b.act_id}`}
                              type="button"
                              onClick={(event) => onOpen(clash, event.currentTarget)}
                              className={cn(
                                "inline-flex min-h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1 text-left text-xs font-semibold transition-colors duration-150 ease-out hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                                hidden ? "border-foreground" : "border-border-strong",
                              )}
                            >
                              <span className="font-mono tabular-nums">#{clash.rank}</span>
                              {hidden ? <DiamondGlyph className="size-2.5 shrink-0" /> : null}
                              <span className="min-w-0 break-words">
                                <span className="sr-only">Clash with </span>
                                {partner.name}
                                {hidden ? <span className="sr-only">, hidden clash</span> : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
