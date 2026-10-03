import { cn } from "@/lib/utils";

import { ProvenanceChip } from "@/components/kernel";
import { formatDraw, formatOverlap, popularitySpread } from "@/lib/clashes";
import type { Act, Twin, TwinRival } from "@/lib/preset";

import { Meter } from "./marks";

/**
 * A rival's draw is its Qloo popularity from the festival's act list, the same value the timetable
 * shows, not the evidence pack's day rank. Null when the act or its popularity is missing.
 */
function drawOf(rival: TwinRival, acts: readonly Act[]): number | null {
  return acts.find((act) => act.id === rival.act_id)?.popularity ?? null;
}

const COLUMNS = "grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)]";
const COLUMNS_NO_DRAW = "grid-cols-[minmax(0,9rem)_minmax(0,1fr)]";

function RivalRow({ rival, of, draw }: { rival: TwinRival; of: string; draw: number | null }) {
  return (
    <div
      className={cn(
        "grid items-center gap-x-4 border-t border-border py-3 max-sm:grid-cols-2 max-sm:gap-y-2",
        draw !== null ? COLUMNS : COLUMNS_NO_DRAW,
      )}
    >
      <p className="font-bold leading-tight max-sm:col-span-2">{rival.act}</p>
      {draw !== null ? (
        <div className="min-w-0">
          <p className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground sm:sr-only">Draw</span>
            <span className="type-numeral text-2xl leading-none">{formatDraw(draw)}</span>
          </p>
          <Meter value={draw} label={`Draw ${formatDraw(draw)} of 100`} className="mt-1.5" />
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground sm:sr-only">Taste overlap</span>
          <span className="type-numeral text-2xl leading-none">{formatOverlap(rival.overlap)}</span>
        </p>
        <Meter
          value={rival.overlap}
          tone="qloo"
          label={`Taste overlap with ${of}, ${formatOverlap(rival.overlap)} out of 100`}
          className="mt-1.5"
        />
      </div>
    </div>
  );
}

function TwinCard({ twin, acts }: { twin: Twin; acts: readonly Act[] }) {
  const sharedDraw = drawOf(twin.shared, acts);
  const separateDraw = drawOf(twin.separate, acts);
  const hasDraw = sharedDraw !== null && separateDraw !== null;
  // Gaps between the printed figures, so the sentence matches the numbers above it.
  const drawGap = hasDraw ? Math.abs(Number(formatDraw(sharedDraw)) - Number(formatDraw(separateDraw))) : null;
  const overlapGap = Math.abs(Number(formatOverlap(twin.shared.overlap)) - Number(formatOverlap(twin.separate.overlap)));
  return (
    <li className="rounded-xl border border-border-strong bg-card p-5 sm:p-6">
      <p className="type-kicker text-muted-foreground">Two rivals for</p>
      <h3 className="type-title mt-1.5">{twin.act}</h3>
      <div className={cn("mt-5 grid gap-x-4 pb-2 max-sm:hidden", hasDraw ? COLUMNS : COLUMNS_NO_DRAW)}>
        <span />
        {hasDraw ? (
          <span className="text-xs font-semibold">
            Draw <span className="font-normal text-muted-foreground">(Qloo popularity)</span>
          </span>
        ) : null}
        <span className="text-xs font-semibold">
          Taste overlap <span className="font-normal text-muted-foreground">(rank on this bill)</span>
        </span>
      </div>
      <div className="max-sm:mt-4">
        <RivalRow rival={twin.shared} of={twin.act} draw={hasDraw ? sharedDraw : null} />
        <RivalRow rival={twin.separate} of={twin.act} draw={hasDraw ? separateDraw : null} />
      </div>
      <p className="mt-4 border-t-2 border-foreground pt-3 text-sm leading-relaxed">
        <strong className="font-semibold">
          {drawGap === null
            ? ""
            : `${drawGap === 0 ? "Level" : `${drawGap} ${drawGap === 1 ? "point" : "points"} apart`} on draw, `}
          {overlapGap} apart on taste overlap.
        </strong>{" "}
        Clashing {twin.act} with {twin.shared.act} puts two acts with much alike audiences against
        each other; clashing {twin.act} with {twin.separate.act} puts two unlike audiences against
        each other.
      </p>
    </li>
  );
}

/** "Same popularity, different audiences": one act, two rivals of near-equal draw, very different taste overlap. */
export function TwinCards({ twins, acts }: { twins: readonly Twin[]; acts: readonly Act[] }) {
  if (twins.length === 0) return null;
  const spread = popularitySpread(acts);
  return (
    <section aria-labelledby="twins-heading" className="container-page py-14 sm:py-20">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
        <div>
          <p className="type-kicker text-muted-foreground">Why taste overlap matters</p>
          <h2 id="twins-heading" className="type-headline mt-2">
            Same popularity, different audiences
          </h2>
        </div>
        <div className="space-y-3 text-[0.9375rem] leading-relaxed">
          <p>
            Draw is Qloo popularity, a percentile among Qloo artists: {spread.atLeast} of {spread.total}{" "}
            acts on this bill score 90 or more, so it barely separates one clash from another. These
            two rivals have near-equal draw and very different taste overlap with the same act.
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ProvenanceChip provenance="recorded" size="sm" />
            <ProvenanceChip provenance="derived" size="sm" />
            Draw is a saved Qloo value; taste overlap is derived from saved Qloo rankings.
          </p>
        </div>
      </div>
      <ul className="mt-8 grid gap-4 lg:grid-cols-2">
        {twins.map((twin) => (
          <TwinCard key={twin.act} twin={twin} acts={acts} />
        ))}
      </ul>
    </section>
  );
}
