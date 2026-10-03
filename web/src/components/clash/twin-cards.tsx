import { ProvenanceChip } from "@/components/kernel";
import { formatDraw, formatPercent } from "@/lib/clashes";
import type { Twin, TwinRival } from "@/lib/preset";

import { Meter } from "./marks";

function RivalRow({ rival, of }: { rival: TwinRival; of: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 border-t border-border py-3 max-sm:grid-cols-2 max-sm:gap-y-2">
      <p className="font-bold leading-tight max-sm:col-span-2">{rival.act}</p>
      <div className="min-w-0">
        <p className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground sm:sr-only">Draw</span>
          <span className="type-numeral text-2xl leading-none">{formatDraw(rival.draw_pct)}</span>
        </p>
        <Meter value={rival.draw_pct} label={`Draw ${formatDraw(rival.draw_pct)} of 100`} className="mt-1.5" />
      </div>
      <div className="min-w-0">
        <p className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground sm:sr-only">Shared audience</span>
          <span className="type-numeral text-2xl leading-none">{formatPercent(rival.overlap)}</span>
        </p>
        <Meter
          value={rival.overlap}
          tone="qloo"
          label={`Shared audience with ${of} ${formatPercent(rival.overlap)}, by Qloo's measure`}
          className="mt-1.5"
        />
      </div>
    </div>
  );
}

function TwinCard({ twin }: { twin: Twin }) {
  const drawGap = Math.round(Math.abs(twin.shared.draw_pct - twin.separate.draw_pct) * 100);
  const overlapGap = Math.round(Math.abs(twin.shared.overlap - twin.separate.overlap) * 100);
  return (
    <li className="rounded-xl border border-border-strong bg-card p-5 sm:p-6">
      <p className="type-kicker text-muted-foreground">Two rivals for</p>
      <h3 className="type-title mt-1.5">{twin.act}</h3>
      <div className="mt-5 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 pb-2 max-sm:hidden">
        <span />
        <span className="text-xs font-semibold">
          Draw <span className="font-normal text-muted-foreground">(Qloo popularity)</span>
        </span>
        <span className="text-xs font-semibold">
          Shared audience <span className="font-normal text-muted-foreground">(by Qloo&rsquo;s measure)</span>
        </span>
      </div>
      <div className="max-sm:mt-4">
        <RivalRow rival={twin.shared} of={twin.act} />
        <RivalRow rival={twin.separate} of={twin.act} />
      </div>
      <p className="mt-4 border-t-2 border-foreground pt-3 text-sm leading-relaxed">
        <strong className="font-semibold">
          {drawGap === 0 ? "Level" : `${drawGap} ${drawGap === 1 ? "point" : "points"} apart`} on draw,{" "}
          {overlapGap} apart on shared audience.
        </strong>{" "}
        By Qloo&rsquo;s measure, clashing {twin.act} with {twin.shared.act} makes much the same fans
        choose; clashing {twin.act} with {twin.separate.act} mostly splits two different crowds.
      </p>
    </li>
  );
}

/** "Same size crowd, different people": one act, two rivals of near-equal draw, very different overlap. */
export function TwinCards({ twins }: { twins: readonly Twin[] }) {
  if (twins.length === 0) return null;
  return (
    <section aria-labelledby="twins-heading" className="container-page py-14 sm:py-20">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
        <div>
          <p className="type-kicker text-muted-foreground">Why shared audience matters</p>
          <h2 id="twins-heading" className="type-headline mt-2">
            Same size crowd, different people
          </h2>
        </div>
        <div className="space-y-3 text-[0.9375rem] leading-relaxed">
          <p>
            Draw (Qloo popularity) says how many fans a clash puts at stake. It cannot say whether
            they are the same fans. These rivals have near-equal draw and a very different shared
            audience, by Qloo&rsquo;s measure.
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ProvenanceChip provenance="qloo" size="sm" /> Draw and shared audience both come from Qloo.
          </p>
        </div>
      </div>
      <ul className="mt-8 grid gap-4 lg:grid-cols-2">
        {twins.map((twin) => (
          <TwinCard key={twin.act} twin={twin} />
        ))}
      </ul>
    </section>
  );
}
