import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

import { legendNoSignal } from "@/lib/credit";

function Item({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className="flex h-5 w-9 shrink-0 items-center justify-center">
        {swatch}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Block({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <span className={cn("flex h-5 w-8 items-start justify-end rounded-[4px] border bg-card p-0.5", className)}>
      {children}
    </span>
  );
}

/**
 * Key to the timetable. Every mark differs by shape or pattern as well as colour. While a tested
 * plan or a rule preview shows on the grid, it names the dashed slot and says the links still
 * describe the published timetable.
 */
export function TimetableLegend({
  showLinks = true,
  planShown = false,
  synthetic = false,
  className,
}: {
  showLinks?: boolean;
  planShown?: boolean;
  /** The invented day: the key does not name Qloo. */
  synthetic?: boolean;
  className?: string;
}) {
  return (
    <ul
      aria-label="Timetable key"
      className={cn("flex flex-wrap gap-x-6 gap-y-2.5 text-xs text-muted-foreground", className)}
    >
      <Item swatch={<Block className="border-border-strong" />}>Set (height = length)</Item>
      <Item
        swatch={
          <Block className="border-2 border-foreground">
            <Lock className="size-2.5 text-foreground" />
          </Block>
        }
      >
        Locked set: fixed slot
      </Item>
      <Item swatch={<Block className="bg-hatch border-dashed border-border-strong" />}>
        {legendNoSignal(synthetic)}
      </Item>
      {showLinks ? (
        <>
          <Item
            swatch={
              <svg viewBox="0 0 36 20" className="h-5 w-9">
                <path d="M3 17 Q18 1 33 17" fill="none" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
                <circle cx="18" cy="9" r="7" fill="var(--foreground)" />
                <text x="18" y="12" textAnchor="middle" className="fill-background font-mono text-[9px] font-bold">
                  1
                </text>
              </svg>
            }
          >
            Clash link: thicker = costlier
          </Item>
          <Item
            swatch={
              <svg viewBox="0 0 36 20" className="h-5 w-9">
                <path d="M3 17 Q18 1 33 17" fill="none" stroke="var(--primary)" strokeWidth="3" strokeDasharray="5 4" />
                <rect
                  x="12"
                  y="3"
                  width="12"
                  height="12"
                  rx="1.5"
                  transform="rotate(45 18 9)"
                  fill="var(--highlight)"
                  stroke="var(--foreground)"
                  strokeWidth="1.6"
                />
              </svg>
            }
          >
            Hidden clash: genres differ, taste overlap is high
          </Item>
        </>
      ) : null}
      {planShown ? (
        <>
          <Item swatch={<Block className="border-2 border-dashed border-primary" />}>
            Dashed slot: a tested place, not published
          </Item>
          <li className="basis-full font-semibold text-foreground">
            Lines and rank badges show the published timetable.
          </li>
        </>
      ) : null}
    </ul>
  );
}
