"use client";

import { ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

import {
  clashKey,
  formatDraw,
  formatOverlap,
  formatPercent,
  formatShare,
  isFixedByLocks,
  LABEL_META,
} from "@/lib/clashes";
import type { PairClash, SetSlot, Stage } from "@/lib/preset";
import { formatRange, overlapWindow } from "@/lib/timetable";

import { DiamondGlyph } from "./marks";

type ClashListProps = {
  clashes: readonly PairClash[];
  slots: ReadonlyMap<string, SetSlot>;
  stages: ReadonlyMap<string, Stage>;
  /** Ranked clashes on this day in total (the list shows the first few). */
  totalRanked: number;
  /** The share of the day's cost between two locked sets, over every ranked clash, 0 to 1. */
  fixedShare?: number;
  /** Whether a set is locked in place; a clash between two locked sets cannot be moved. */
  isLocked?: (actId: string) => boolean;
  activeKeys: ReadonlySet<string>;
  dimmed: boolean;
  onOpen: (clash: PairClash, trigger: HTMLElement) => void;
  onHighlight: (key: string | null) => void;
  className?: string;
};

/** The costliest clashes of the day, each opening its details. */
export function ClashList({
  clashes,
  slots,
  stages,
  totalRanked,
  fixedShare = 0,
  isLocked = () => false,
  activeKeys,
  dimmed,
  onOpen,
  onHighlight,
  className,
}: ClashListProps) {
  const maxShare = Math.max(...clashes.map((clash) => clash.regret_share), 0.0001);
  const combined = clashes.reduce((sum, clash) => sum + clash.regret_share, 0);

  return (
    <section aria-labelledby="clash-list-heading" className={className}>
      <div className="border-b-2 border-foreground pb-3">
        <h3 id="clash-list-heading" className="type-kicker">
          The {clashes.length} costliest clashes
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Together {formatPercent(combined)} of the day&rsquo;s clash cost
          {totalRanked > clashes.length ? ` (${totalRanked} ranked in all)` : ""}.
          {fixedShare > 0 ? (
            <>
              {" "}
              {formatPercent(fixedShare)} of the day&rsquo;s cost sits between two locked sets, which
              cannot move.
            </>
          ) : null}{" "}
          Draw is Qloo popularity; overlap is a rank on this bill.
        </p>
      </div>

      {clashes.length === 0 ? (
        <p className="mt-4 rounded-lg border-2 border-dashed border-border-strong p-4 text-sm text-muted-foreground">
          No priced clashes on this day: no two acts with a Qloo signal play at the same time.
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {clashes.map((clash) => {
            const key = clashKey(clash);
            const a = slots.get(clash.a.act_id);
            const b = slots.get(clash.b.act_id);
            const window = a && b ? overlapWindow(a, b) : null;
            const active = activeKeys.has(key);
            const fixed = isFixedByLocks(clash, isLocked);
            return (
              <li key={key}>
                <button
                  type="button"
                  data-clash={key}
                  onClick={(event) => onOpen(clash, event.currentTarget)}
                  onMouseEnter={() => onHighlight(key)}
                  onMouseLeave={() => onHighlight(null)}
                  onFocus={() => onHighlight(key)}
                  onBlur={() => onHighlight(null)}
                  className={cn(
                    "group relative grid w-full cursor-pointer grid-cols-[2.25rem_minmax(0,1fr)_1rem] items-start gap-x-3 py-3 pr-1 pl-1 text-left transition-[background-color,opacity] duration-150 hover:bg-accent focus-visible:bg-accent",
                    active && "bg-accent",
                    dimmed && !active && "opacity-55",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-1 left-0 w-1 rounded-full bg-primary opacity-0 transition-opacity",
                      active && "opacity-100",
                    )}
                  />
                  <span className="type-numeral pt-0.5 text-right text-3xl leading-none tabular-nums">
                    <span className="sr-only">Clash </span>
                    {clash.rank}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 font-bold leading-snug">
                        {clash.a.name}
                        <span aria-hidden="true" className="px-1 font-normal text-muted-foreground">
                          &times;
                        </span>
                        <span className="sr-only"> and </span>
                        {clash.b.name}
                      </span>
                      {clash.label ? (
                        <span
                          className={cn(
                            "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.6875rem] leading-none font-semibold",
                            clash.label === "hidden"
                              ? "border-foreground bg-highlight text-highlight-foreground"
                              : "border-dashed border-border-strong",
                          )}
                        >
                          {clash.label === "hidden" ? <DiamondGlyph className="size-2" /> : null}
                          {LABEL_META[clash.label].short}
                          <span className="sr-only"> clash</span>
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {stages.get(clash.a.stage_id)?.name ?? clash.a.stage_id} +{" "}
                      {stages.get(clash.b.stage_id)?.name ?? clash.b.stage_id}
                      {window ? ` · ${formatRange(window)}` : ""} · {clash.overlap_minutes} min
                      {fixed ? (
                        <>
                          {" · "}
                          <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                            <Lock aria-hidden="true" className="size-3" />
                            Both sets locked
                          </span>
                        </>
                      ) : null}
                    </span>
                    <span className="mt-2 grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 font-mono text-xs tabular-nums">
                      <span title="Taste overlap, rank among the other acts on this bill">
                        <span className="text-muted-foreground">Overlap </span>
                        {formatOverlap(clash.audience_overlap)}
                        <span className="sr-only"> taste overlap, rank on this bill</span>
                      </span>
                      <span title="Draw (Qloo popularity) of the two acts combined">
                        <span className="text-muted-foreground">Draw </span>
                        {formatDraw(clash.draw)}
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden="true" className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${(clash.regret_share / maxShare) * 100}%` }}
                          />
                        </span>
                        <span>
                          {formatShare(clash.regret_share)}
                          <span className="sr-only"> of the day&rsquo;s clash cost</span>
                        </span>
                      </span>
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
