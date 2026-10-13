"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
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
import { MoreDetails } from "./more-details";

/** Rows shown before the disclosure: five from the `sm` breakpoint up, three on a phone. */
const ROWS_WIDE = 5;
const ROWS_NARROW = 3;
const WIDE_QUERY = "(min-width: 640px)";

function subscribeWide(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function wideSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(WIDE_QUERY).matches;
}

/** True from 640 px up; the server HTML (and any render without a window) counts as wide. */
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, wideSnapshot, () => true);
}

/**
 * The rail's row for a clash, in the page now, with any closed disclosure around it opened so it can
 * take focus. Rows four and five move between the list and its disclosure at 640 px, so an element
 * kept from before a resize may have left the page.
 */
export function clashRowFor(key: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const row = document.querySelector<HTMLElement>(
    `section[aria-labelledby="clash-list-heading"] button[data-clash="${CSS.escape(key)}"]`,
  );
  const disclosure = row?.closest("details");
  if (disclosure && !disclosure.open) disclosure.open = true;
  return row ?? null;
}

/** The same row again when the one given has left the page (a resize moved it); otherwise the one given. */
export function liveClashRow(element: HTMLElement | null): HTMLElement | null {
  if (!element || element.isConnected) return element;
  const key = element.dataset.clash;
  return key ? clashRowFor(key) : null;
}

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
  /** The invented day: its draw and taste figures are invented, not Qloo's. */
  synthetic?: boolean;
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
  synthetic = false,
  className,
}: ClashListProps) {
  const maxShare = Math.max(...clashes.map((clash) => clash.regret_share), 0.0001);
  const combined = clashes.reduce((sum, clash) => sum + clash.regret_share, 0);
  const visible = useWide() ? ROWS_WIDE : ROWS_NARROW;
  const shown = clashes.slice(0, visible);
  const rest = clashes.slice(visible);

  // The row that has keyboard focus. Crossing 640 px re-renders rows four and five in the other
  // list, so when the focused row has left the page, focus goes to the same clash's new row.
  const focusedRow = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const last = focusedRow.current;
    if (!last || last.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const next = liveClashRow(last);
    focusedRow.current = next;
    next?.focus({ preventScroll: true });
  }, [visible]);

  const renderRow = (clash: PairClash) => {
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
          onFocus={(event) => {
            focusedRow.current = event.currentTarget;
            onHighlight(key);
          }}
          onBlur={(event) => {
            const row = event.currentTarget;
            onHighlight(null);
            // A row still in the page lost focus to something else: forget it. One that a resize took
            // out of the page is kept, so the effect above can find its replacement.
            setTimeout(() => {
              if (focusedRow.current === row && row.isConnected) focusedRow.current = null;
            }, 0);
          }}
          className={cn(
            "group relative grid w-full cursor-pointer grid-cols-[2rem_minmax(0,1fr)_1rem] items-start gap-x-2.5 rounded-md px-1.5 py-3 text-left transition-[background-color,opacity] duration-150 ease-out hover:bg-accent focus-visible:bg-accent",
            active && "bg-accent",
            dimmed && !active && "opacity-55",
          )}
        >
          <span className="type-numeral pt-0.5 text-right text-3xl leading-none tabular-nums">
            <span className="sr-only">Clash </span>
            {clash.rank}
          </span>
          <span className="min-w-0">
            {/* The names have the row to themselves and wrap whole, never cut; the badge sits on the line
                under them, so a long name can never run beneath it. */}
            <span className="flex">
              <span className="min-w-0 flex-1 text-[0.9375rem] leading-snug font-semibold break-words">
                {/* Real spaces around the "×", so a line can break on either side of it. */}
                {clash.a.name}{" "}
                <span aria-hidden="true" className="font-normal text-muted-foreground">
                  &times;
                </span>
                <span className="sr-only">and</span> {clash.b.name}
              </span>
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {clash.label ? (
                <>
                  {/* The label as the legend writes it, open on the line: a hidden clash takes the
                      legend's outlined vermilion mark and its word in vermilion; any other label is ink
                      words alone. Row grounds are paper, card or the accent wash, never bg-muted. */}
                  <span
                    data-clash-badge=""
                    className={cn(
                      "mr-1.5 text-xs font-semibold whitespace-nowrap",
                      clash.label === "hidden" ? "text-primary" : "text-foreground",
                    )}
                  >
                    {clash.label === "hidden" ? <DiamondGlyph className="mr-1 inline-block align-[-2px]" /> : null}
                    {LABEL_META[clash.label].short}
                    <span className="sr-only"> clash</span>
                  </span>{" "}
                </>
              ) : null}
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
            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span title="Taste overlap, a rank out of 100 among the acts compared for this bill">
                <span className="text-muted-foreground">Taste </span>
                <span className="font-mono tabular-nums">{formatOverlap(clash.audience_overlap)}</span>
                <span className="sr-only"> taste overlap, rank on this bill</span>
              </span>
              <span title={synthetic ? "Draw (invented popularity) of the two acts combined" : "Draw (Qloo popularity) of the two acts combined"}>
                <span className="text-muted-foreground">Draw </span>
                <span className="font-mono tabular-nums">{formatDraw(clash.draw)}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2">
                {/* The share of the day's cost: a vermilion 6px capsule on a muted track, scaled to the costliest clash shown. */}
                <span aria-hidden="true" className="relative h-1.5 w-12 shrink-0 overflow-hidden rounded-bar bg-muted">
                  <span
                    className="absolute inset-y-0 left-0 rounded-bar bg-primary"
                    style={{ width: `${(clash.regret_share / maxShare) * 100}%` }}
                  />
                </span>
                <span className="font-mono tabular-nums">
                  {formatShare(clash.regret_share)}
                  <span className="sr-only font-sans"> of the day&rsquo;s clash cost</span>
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
  };

  return (
    <section
      aria-labelledby="clash-list-heading"
      className={cn(
        // From 1280px the rail is the one surface: the list drops its own and sits under one 1px rule.
        "rounded-lg border border-surface-edge bg-card p-6 xl:rounded-none xl:border-x-0 xl:border-b-0 xl:border-t xl:border-t-border xl:bg-transparent xl:p-0 xl:pt-6",
        className,
      )}
    >
      {/* The rail's second surface, matching the Index card 32px above it: the heading and its note,
          then the rows, divided by hairlines inset 16px from the card's edges with no rule above the first.
          From 1280px, where the card drops, the rows and their hairlines span the rail column exactly, so
          nothing reaches past the section's gutter. */}
      <div className="pb-3">
        <h3 id="clash-list-heading" className="text-[0.9375rem] leading-5 font-semibold">
          The {clashes.length} costliest clashes
        </h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
          Together {formatPercent(combined)} of the day&rsquo;s clash cost
          {totalRanked > clashes.length ? ` (${totalRanked} ranked in all)` : ""}.
          {fixedShare > 0 ? (
            <>
              {" "}
              {formatPercent(fixedShare)} of the day&rsquo;s cost sits between two locked sets, which
              cannot move.
            </>
          ) : null}{" "}
          {synthetic
            ? "Draw and taste overlap are invented figures; taste overlap is a rank on this bill."
            : "Draw is Qloo popularity; taste overlap is a rank on this bill."}
        </p>
      </div>

      {clashes.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {synthetic
            ? "No priced clashes on this day: no two priced acts play at the same time."
            : "No priced clashes on this day: no two acts with a Qloo signal play at the same time."}
        </p>
      ) : (
        <>
          <ol className="-mx-2 divide-y divide-border xl:mx-0">{shown.map(renderRow)}</ol>
          {rest.length > 0 ? (
            <MoreDetails className="mt-2" summary={`Show the other ${rest.length} costliest clashes`}>
              <ol start={shown.length + 1} className="-mx-2 mt-1 divide-y divide-border xl:mx-0">
                {rest.map(renderRow)}
              </ol>
            </MoreDetails>
          ) : null}
        </>
      )}
    </section>
  );
}
