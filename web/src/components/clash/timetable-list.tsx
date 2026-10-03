"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

import { formatDraw, partnerOf, type SetView } from "@/lib/clashes";
import type { PairClash } from "@/lib/preset";
import { formatClock, formatRange } from "@/lib/timetable";

import { DiamondGlyph } from "./marks";

type TimetableListProps = {
  views: readonly SetView[];
  dayLabel: string;
  onOpen: (clash: PairClash, trigger: HTMLElement) => void;
  className?: string;
};

/** Genre, draw and signal strength, for sets that have a Qloo signal. */
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
export function TimetableList({ views, dayLabel, onOpen, className }: TimetableListProps) {
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
      <p className="type-kicker border-b-2 border-foreground pb-2">{dayLabel}, in start order</p>
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
                    className={cn(
                      "rounded-md border bg-card px-3 py-2.5",
                      none ? "bg-hatch border-dashed border-border-strong" : "border-border-strong",
                      view.slot.locked && "border-2 border-foreground",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 leading-tight font-bold">{view.act.name}</p>
                      {view.slot.locked ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
                          <Lock aria-hidden="true" className="size-3" />
                          Locked
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
                      {formatRange(view.slot)} · {view.stage.name}
                    </p>
                    {meta(view) ? <p className="mt-0.5 text-xs text-muted-foreground">{meta(view)}</p> : null}
                    {none ? (
                      <p className="mt-1.5">
                        <span className="rounded-sm bg-card px-1 text-xs font-semibold">
                          No Qloo signal, not priced
                        </span>
                      </p>
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
                                "inline-flex min-h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-3 text-left text-xs font-semibold transition-colors hover:bg-accent",
                                hidden ? "border-foreground" : "border-border-strong",
                              )}
                            >
                              <span className="font-mono tabular-nums">#{clash.rank}</span>
                              {hidden ? <DiamondGlyph className="size-2.5 shrink-0" /> : null}
                              <span className="truncate">
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
