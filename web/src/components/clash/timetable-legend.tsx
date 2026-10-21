"use client";

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

import { legendNoSignal, noSignalLabel, weakSignalLabel } from "@/lib/credit";
import { lockLabel } from "@/lib/locks";

import { TEXT_TOGGLE_CLASS } from "./coverage-meter";
import { WEAK_CUE_WORD } from "./timetable-grid";

/**
 * A key glyph, centred in an 18px-high slot at least 16px wide (the cue specimen runs 36px). In the
 * full reading every slot is 36px wide, so the labels line up down the list.
 */
function Glyph({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex h-4.5 min-w-4 shrink-0 items-center justify-center", className)}>
      {children}
    </span>
  );
}

type LegendOptions = {
  showLinks?: boolean;
  planShown?: boolean;
  /** The invented day: the key does not name Qloo. */
  synthetic?: boolean;
  /**
   * On a published day, the locked sets are exactly the last set on each stage (`lockRuleHolds` on the
   * day's slots), so the lock's words may state that rule; otherwise they say only that this app keeps
   * them in place.
   */
  holds?: boolean;
  /**
   * The lock's reading is drawn apart, on its own line outside the key (`LockKey`, above the phone's
   * folded key), so the key leaves it out and does not count it.
   */
  lockApart?: boolean;
  /**
   * Some tile on the board prints the short weak cue (" · weak", "·weak" or "weak"), so the key draws
   * that cue and names it. Roomy weak tiles say "Weak Qloo signal" in words and need no key.
   */
  weak?: boolean;
};

/**
 * A key item. `cue` marks a cue key: a specimen of a word the board prints, drawn like a symbol but
 * not one of the symbols `legendSymbolCount` counts, and shown only while the board prints it.
 * `spelled` marks the item whose row entry is its whole reading (the lock, which says whose lock it is
 * with no click), so the reading under the row does not repeat it.
 */
type LegendItem = { key: string; swatch: ReactNode; name: string; label: string; cue?: true; spelled?: true };

/** The lock glyph, the same in the key's row and on the lock's own line. */
const LOCK_SWATCH = <Lock className="size-3.5 text-foreground" strokeWidth={2} />;

/**
 * How many tiles on the page's board print the short weak cue. `TimetableGrid` publishes it after it
 * renders, so every copy of the key (the row, the phone's fold) can draw the cue without being handed
 * it. The server and the first client render read 0, so hydration always matches.
 */
let boardCueTiles = 0;
const cueListeners = new Set<() => void>();

function subscribeCueTiles(listener: () => void): () => void {
  cueListeners.add(listener);
  return () => {
    cueListeners.delete(listener);
  };
}

function setBoardCueTiles(count: number): void {
  if (boardCueTiles === count) return;
  boardCueTiles = count;
  for (const listener of cueListeners) listener();
}

/**
 * Called by the board with its count of tiles that print the short weak cue; the key draws its cue
 * item while that is over 0.
 */
export function usePublishCueTiles(count: number): void {
  useEffect(() => {
    setBoardCueTiles(count);
    return () => setBoardCueTiles(0);
  }, [count]);
}

function useBoardCueTiles(): number {
  return useSyncExternalStore(
    subscribeCueTiles,
    () => boardCueTiles,
    () => 0,
  );
}

/**
 * The key's items, in order: glyph and word pairs. Each differs by shape or edge as well as colour
 * (a lock, a dotted mini tile, the cue word in a mini tile, a filled disc, an outlined disc, a dashed
 * ink slot).
 */
function legendItems({
  showLinks = true,
  planShown = false,
  synthetic = false,
  holds = false,
  lockApart = false,
  weak = false,
}: LegendOptions): LegendItem[] {
  const weakLabel = weakSignalLabel(synthetic).replace(/\.$/, "");
  return [
    ...(lockApart
      ? []
      : [
          {
            key: "locked",
            swatch: LOCK_SWATCH,
            name: "Locked",
            label: lockLabel({ synthetic, holds }),
            spelled: true as const,
          },
        ]),
    {
      key: "no-signal",
      // The no-signal tile in small: the board's paper in a dotted control-grey edge, 20 x 12, drawn at
      // 1.5px so the dots read at this size, on a mark's 6px corner (clamped to half its height).
      swatch: (
        <svg aria-hidden="true" data-mark="no-signal" width="20" height="12" viewBox="0 0 20 12" className="block">
          <rect
            x="0.75"
            y="0.75"
            width="18.5"
            height="10.5"
            rx="6"
            fill="var(--background)"
            stroke="var(--border-strong)"
            strokeWidth={1.5}
            strokeDasharray="1.5 2"
          />
        </svg>
      ),
      name: noSignalLabel(synthetic),
      label: legendNoSignal(synthetic),
    },
    // The board's narrow-tile cue ("weak"), drawn as a specimen: the word the tiles print, in their
    // 12px medium, on a 36 x 18 mini tile. Only while some tile prints it; a cue key, not counted.
    ...(weak
      ? [
          {
            key: "weak",
            swatch: (
              <svg aria-hidden="true" data-mark="weak" width="36" height="18" viewBox="0 0 36 18" className="block">
                <rect x="0.5" y="0.5" width="35" height="17" rx="6" fill="var(--card)" stroke="var(--border-strong)" strokeWidth={1} />
                <text
                  x="18"
                  y="9"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="12"
                  fill="var(--muted-foreground)"
                  className="font-medium"
                >
                  {WEAK_CUE_WORD}
                </text>
              </svg>
            ),
            name: weakLabel,
            label: weakLabel,
            cue: true as const,
          },
        ]
      : []),
    ...(showLinks
      ? [
          {
            key: "link",
            // The board's filled clash disc, at 10px.
            swatch: <span data-mark="seen" className="block size-2.5 rounded-full bg-primary" />,
            name: "Clash",
            label: "Clash link: stronger = costlier",
          },
          {
            key: "hidden",
            // The board's outlined disc: a raspberry ring on the card, at 10px.
            swatch: <span data-mark="hidden" className="block size-2.5 rounded-full border-[1.5px] border-primary bg-card" />,
            name: "Hidden clash",
            label: "Hidden clash: genres differ, taste overlap is high",
          },
        ]
      : []),
    ...(planShown
      ? [
          {
            key: "tested",
            // The tested ghost in small: the sheet in a 2px dashed ink edge, 14 x 10.
            swatch: <span data-mark="tested" className="block h-2.5 w-3.5 rounded-sm border-2 border-dashed border-foreground bg-card" />,
            name: "Tested place",
            label: "Dashed slot: a tested place, not published",
          },
        ]
      : []),
  ];
}

/**
 * How many symbols the key shows. The published-timetable warning line is not a symbol, and neither is
 * the weak cue key: it is drawn only while the board prints the cue, so the count is the same with or
 * without it.
 */
export function legendSymbolCount(options: LegendOptions = {}): number {
  return legendItems(options).filter((item) => !item.cue).length;
}

function FullKey({ items, className }: { items: readonly LegendItem[]; className?: string }) {
  return (
    <ul className={cn("space-y-2 text-[0.8125rem] text-foreground", className)}>
      {items.filter((item) => !item.spelled).map((item) => (
        <li key={item.key} className="flex items-center gap-2.5">
          <Glyph className="w-9">{item.swatch}</Glyph>
          <span data-legend-item={item.key}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The lock's reading on a line of its own, in the key's glyph and words: on a phone it sits above the
 * folded key (which then leaves the lock out), so whose lock it is is said with no tap.
 */
export function LockKey({ synthetic = false, holds = false, className }: Pick<LegendOptions, "synthetic" | "holds"> & { className?: string }) {
  return (
    <p className={cn("flex items-start gap-x-2 text-[0.8125rem] text-foreground", className)}>
      <Glyph>{LOCK_SWATCH}</Glyph>
      <span data-legend-item="locked">{lockLabel({ synthetic, holds })}</span>
    </p>
  );
}

/**
 * Key to the timetable: one row of 16px glyphs and 13px ink words, the lock's in full so whose lock it
 * is needs no click (under the coverage line when
 * `inline`, with the toggle at that line's right end), and a quiet underlined "How to read the board"
 * toggle that opens the full reading of each symbol and the
 * board's note under the row (in the HTML either way, so it prints and never needs script to
 * exist). Every mark differs by shape or pattern as well as colour. While a tested plan or a rule
 * preview shows on the grid, it names the dashed slot and says, visibly, that the links still
 * describe the published timetable.
 *
 * Inside a disclosure of its own (the phone's folded key) the full reading prints directly, so it is
 * never two clicks away.
 */
export function TimetableLegend({
  showLinks = true,
  planShown = false,
  synthetic = false,
  holds = false,
  lockApart = false,
  weak,
  inline = false,
  note,
  className,
}: LegendOptions & {
  /**
   * Set inside the coverage row (`CoverageMeter`'s `legend`): the key and its toggle join that row,
   * and the reading opens on a line of its own under it.
   */
  inline?: boolean;
  /** The board's caption ("Lines join the ... costliest clashes"), printed inside "How to read the board". */
  note?: ReactNode;
  className?: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const published = useBoardCueTiles() > 0;
  const items = legendItems({ showLinks, planShown, synthetic, holds, lockApart, weak: weak ?? published });
  // Inside the coverage row the parts take two deliberate rows: coverage and this toggle on the first
  // (the toggle at its right end), the key alone on the second, then the warning and the reading. The
  // source order (key, toggle) stays, so nothing focusable changes place in the tab order.
  const key = (
    <>
      <ul
        aria-label="Timetable key"
        className={cn(
          "flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.8125rem] text-foreground",
          inline && "order-1 basis-full",
        )}
      >
        {items.map((item) =>
          item.spelled ? (
            // The lock reads in full here, so whose lock it is needs no click. A sentence, it may wrap on a
            // narrow key, its glyph on the first line.
            <li key={item.key} className="flex min-w-0 items-start gap-x-2">
              <Glyph>{item.swatch}</Glyph>
              <span data-legend-item={item.key}>{item.label}</span>
            </li>
          ) : (
            // Glyph and word never part: each item is one unbreakable unit.
            <li key={item.key} className="flex items-center gap-x-2 whitespace-nowrap">
              <Glyph>{item.swatch}</Glyph>
              <span data-legend-item={item.key}>{item.name}</span>
            </li>
          ),
        )}
      </ul>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(TEXT_TOGGLE_CLASS, "ml-auto whitespace-nowrap in-[details]:hidden")}
      >
        How to read the board
      </button>
    </>
  );
  return (
    <div className={cn(inline ? "contents" : "flex-col", className)}>
      {inline ? key : <div className="flex flex-wrap items-center gap-x-5 gap-y-2">{key}</div>}
      {planShown ? (
        <p className={cn("mt-2 basis-full text-[0.8125rem] font-semibold text-foreground", inline && "order-2")}>
          Lines and rank badges show the published timetable.
        </p>
      ) : null}
      <div
        id={panelId}
        className={cn(
          "mt-3 basis-full in-[details]:hidden print:block",
          inline && "order-3",
          open ? "block" : "hidden",
        )}
      >
        <FullKey items={items} />
        {note ? <p className="mt-2 max-w-prose text-[0.8125rem] text-muted-foreground">{note}</p> : null}
      </div>
      <FullKey items={items} className="mt-3 hidden in-[details]:block" />
      {note ? <p className="mt-2 hidden max-w-prose text-[0.8125rem] text-muted-foreground in-[details]:block">{note}</p> : null}
    </div>
  );
}
