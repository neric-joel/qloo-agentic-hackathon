import { useId } from "react";

import { NO_PRICED_CLASH, TRADEOFF_HEADING_ALONE, type Tradeoff, type TradeoffRow } from "@/lib/decision";
import { cn } from "@/lib/utils";

/** What the plan already holds of the two changes; the matching column says so. */
export type TradeoffHeld = { move: boolean; change: boolean };

export const IN_YOUR_PLAN = "In your plan";

/** Rows the card's compact table leaves to the brief. */
const COMPACT_DROPS: ReadonlySet<TradeoffRow["id"]> = new Set(["flags", "costliest"]);

/** "then the costliest clash is A and B, 30 minutes, 9.5 index points", or that none is left. */
function costliestClause(cell: string, then: boolean): string {
  const lead = then ? "then " : "";
  if (cell === NO_PRICED_CLASH) return `${lead}no priced clash is left on this day`;
  return `${lead}the costliest clash ${then ? "is" : "after is"} ${cell}`;
}

/**
 * What the compact table leaves out, as one sentence under it: the stage-fit flags and the costliest
 * clash after each change, read from the same rows the brief prints (never a figure of its own). Null
 * when the route sent neither row.
 */
export function consequenceLine(tradeoff: Tradeoff): string | null {
  const flags = tradeoff.rows.find((row) => row.id === "flags");
  const costliest = tradeoff.rows.find((row) => row.id === "costliest");
  if (!flags && !costliest) return null;
  const rule = tradeoff.ruleHead.charAt(0).toLowerCase() + tradeoff.ruleHead.slice(1);
  // The same clash left after both changes is said once.
  if (flags && costliest && costliest.move === costliest.rule) {
    const after =
      costliest.move === NO_PRICED_CLASH
        ? "either way no priced clash is left on this day"
        : `either way the costliest clash after is ${costliest.move}`;
    return `${tradeoff.moveHead}: stage-fit flags go ${flags.move}; ${rule}: ${flags.rule}; ${after}.`;
  }
  const column = (side: "move" | "rule") =>
    [flags ? `stage-fit flags go ${flags[side]}` : null, costliest ? costliestClause(costliest[side], Boolean(flags)) : null]
      .filter(Boolean)
      .join(", ");
  return `${tradeoff.moveHead}: ${column("move")}; ${rule}: ${column("rule")}.`;
}

/**
 * The card's two changes in one place: "Move one set" and "Keep the two apart", one row per figure the
 * route gave for both. From `sm` up it is a table with the two changes as columns; on a phone every row is
 * stacked (the row's label, then each change on a line of its own, with the change's name before it), so
 * nothing needs a horizontal scroll at 320 px. It reads no figure of its own: every cell is text from
 * `buildTradeoff`. `print` sets the compact sizes the brief uses on paper. `compact` is the decision card's
 * shorter table: no stage-fit or costliest-clash row (one sentence under the table states both, from the
 * same rows), no note under the index row and no footnote (the card states its attribution and limits
 * elsewhere); the brief prints the full table. `hideHeading` is for a table whose heading is already shown
 * by what holds it (the card's disclosure summary): the heading stays for screen readers only.
 */
export function TradeoffTable({
  tradeoff,
  held,
  print = false,
  compact = false,
  hideHeading = false,
  className,
}: {
  tradeoff: Tradeoff;
  held?: TradeoffHeld;
  print?: boolean;
  compact?: boolean;
  hideHeading?: boolean;
  className?: string;
}) {
  const headingId = useId();
  const rows = compact ? tradeoff.rows.filter((row) => !COMPACT_DROPS.has(row.id)) : tradeoff.rows;
  // The compact table states what it drops in one line, so the decision still shows its consequence.
  const consequence = compact ? consequenceLine(tradeoff) : null;
  const heads = [
    { label: tradeoff.moveHead, held: held?.move === true },
    { label: tradeoff.ruleHead, held: held?.change === true },
  ];
  const cell = cn(
    "grid grid-cols-[7.75rem_minmax(0,1fr)] gap-x-2 py-0.5 break-words",
    "before:text-xs before:font-semibold before:text-muted-foreground before:content-[attr(data-label)]",
    "sm:table-cell sm:py-2 sm:pr-3 sm:align-top sm:before:content-none",
    print && "print:table-cell print:py-0 print:pr-[6pt] print:align-top print:before:content-none",
  );
  return (
    <section aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <h3
        id={headingId}
        className={cn(
          "text-[0.8125rem] leading-5 font-semibold text-muted-foreground",
          hideHeading && "sr-only",
          print && tradeoff.heading !== TRADEOFF_HEADING_ALONE && "print:sr-only",
          print && tradeoff.heading === TRADEOFF_HEADING_ALONE && "print:text-[9pt]",
        )}
      >
        {tradeoff.heading}
      </h3>
      <p
        className={cn(
          "max-w-prose text-xs leading-snug text-muted-foreground",
          !hideHeading && "mt-1",
          !print && "lg:text-[0.8125rem]",
          print && "print:mt-0 print:max-w-none print:text-[9pt] print:leading-[1.15]",
        )}
      >
        {tradeoff.subtitle}
      </p>
      {/* The table is square inside a 14px clipped frame: hairline rules only, no boxed cells. */}
      <div className="mt-2 overflow-hidden rounded-md border border-border px-3 sm:px-4 print:overflow-visible print:rounded-none print:border-0 print:px-0">
      <table
        className={cn(
          "block w-full border-collapse text-left text-sm leading-snug sm:table",
          print && "print:mt-[1pt] print:table print:text-[9pt] print:leading-[1.15]",
        )}
      >
        <thead className={cn("sr-only sm:not-sr-only", print && "print:not-sr-only")}>
          <tr className="border-b border-border-strong text-xs">
            <th scope="col" className="py-1.5 pr-3 font-semibold print:py-0">
              <span className="sr-only">Figure</span>
              {print ? (
                <span aria-hidden="true" className="hidden text-[0.8125rem] font-semibold text-muted-foreground print:inline print:text-[9pt]">
                  Side by side
                </span>
              ) : null}
            </th>
            {heads.map((head) => (
              <th key={head.label} scope="col" className="py-1.5 pr-3 font-semibold print:py-0">
                {head.label}
                {head.held ? <span className="font-normal text-muted-foreground"> · {IN_YOUR_PLAN}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        {rows.map((row) => (
          <tbody
            key={row.id}
            className={cn(
              "block border-b border-border py-2 last:border-b-0 sm:table-row-group sm:py-0",
              print && "print:table-row-group print:py-0",
            )}
          >
            <tr className="block sm:table-row print:table-row">
              <th
                scope="row"
                className={cn(
                  "block pb-1 text-left text-xs font-semibold sm:table-cell sm:w-[26%] sm:py-2 sm:pr-3 sm:align-top sm:text-sm",
                  print && "print:table-cell print:w-[33%] print:py-0 print:pr-[6pt] print:align-top print:text-[9pt]",
                )}
              >
                {row.label}
              </th>
              <td data-label={heads[0].label} className={cell}>
                {row.move}
              </td>
              <td data-label={heads[1].label} className={cell}>
                {row.rule}
              </td>
            </tr>
            {row.note && !(compact && row.id === "index") ? (
              <tr className="block sm:table-row print:table-row">
                <td
                  colSpan={3}
                  className={cn(
                    "block pt-0.5 pb-1 text-xs leading-snug text-muted-foreground sm:table-cell sm:pt-0",
          !print && "lg:text-[0.8125rem]",
                    print && "print:table-cell print:pb-0 print:pt-0 print:text-[9pt]",
                  )}
                >
                  {row.note}
                </td>
              </tr>
            ) : null}
          </tbody>
        ))}
      </table>
      </div>
      {compact ? (
        consequence ? (
          <p className="mt-2 text-[0.8125rem] leading-snug text-muted-foreground">{consequence}</p>
        ) : null
      ) : (
        <p
          className={cn(
            "mt-2 text-xs leading-snug font-semibold text-muted-foreground",
          !print && "lg:text-[0.8125rem]",
            print && "print:mt-[1pt] print:text-[9pt] print:leading-[1.15]",
          )}
        >
          {tradeoff.footnote}
        </p>
      )}
    </section>
  );
}
