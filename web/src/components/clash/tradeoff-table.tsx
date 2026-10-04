import { useId } from "react";

import { TRADEOFF_HEADING_ALONE, type Tradeoff } from "@/lib/decision";
import { cn } from "@/lib/utils";

/** What the plan already holds of the two changes; the matching column says so. */
export type TradeoffHeld = { move: boolean; change: boolean };

export const IN_YOUR_PLAN = "In your plan";

/**
 * The card's two changes in one place: "Move one set" and "Keep the two apart", one row per figure the
 * route gave for both. From `sm` up it is a table with the two changes as columns; on a phone every row is
 * stacked (the row's label, then each change on a line of its own, with the change's name before it), so
 * nothing needs a horizontal scroll at 320 px. It reads no figure of its own: every cell is text from
 * `buildTradeoff`. `print` sets the compact sizes the brief uses on paper.
 */
export function TradeoffTable({
  tradeoff,
  held,
  print = false,
  className,
}: {
  tradeoff: Tradeoff;
  held?: TradeoffHeld;
  print?: boolean;
  className?: string;
}) {
  const headingId = useId();
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
          "type-kicker text-muted-foreground",
          print && tradeoff.heading !== TRADEOFF_HEADING_ALONE && "print:sr-only",
          print && tradeoff.heading === TRADEOFF_HEADING_ALONE && "print:text-[9pt]",
        )}
      >
        {tradeoff.heading}
      </h3>
      <p
        className={cn(
          "mt-1 max-w-prose text-xs leading-snug text-muted-foreground",
          print && "print:mt-0 print:max-w-none print:text-[9pt] print:leading-[1.15]",
        )}
      >
        {tradeoff.subtitle}
      </p>
      <table
        className={cn(
          "mt-2 block w-full border-collapse text-left text-sm leading-snug sm:table",
          print && "print:mt-[1pt] print:table print:text-[9pt] print:leading-[1.15]",
        )}
      >
        <thead className={cn("sr-only sm:not-sr-only", print && "print:not-sr-only")}>
          <tr className="border-b border-border-strong text-xs">
            <th scope="col" className="py-1.5 pr-3 font-semibold print:py-0">
              <span className="sr-only">Figure</span>
              {print ? (
                <span aria-hidden="true" className="type-kicker hidden font-semibold text-muted-foreground print:inline print:text-[9pt]">
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
        {tradeoff.rows.map((row) => (
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
            {row.note ? (
              <tr className="block sm:table-row print:table-row">
                <td
                  colSpan={3}
                  className={cn(
                    "block pt-0.5 pb-1 text-xs leading-snug text-muted-foreground sm:table-cell sm:pt-0",
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
      <p
        className={cn(
          "mt-2 text-xs leading-snug font-semibold text-muted-foreground",
          print && "print:mt-[1pt] print:text-[9pt] print:leading-[1.15]",
        )}
      >
        {tradeoff.footnote}
      </p>
    </section>
  );
}
