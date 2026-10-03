"use client";

import { useId, useMemo, type ReactNode } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { ProvenanceChip, TraceDrawer } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { formatOverlap, leadingTags, tagLabel, traceToolCalls } from "@/lib/clashes";
import { formatUtcTime } from "@/lib/format";
import {
  agreement,
  pairCheckKey,
  rankingsText,
  savedTagsText,
  tagsAlsoSaved,
  verdictText,
  type PairCheck,
} from "@/lib/pair-check";
import type { Act, PairClash, Preset, Receipt } from "@/lib/preset";

import { usePairCheckEnabled } from "./use-agent-status";
import { usePairCheck } from "./use-pair-check";

type LiveRecheckProps = {
  preset: Preset;
  shown: PairClash;
  actA: Act | undefined;
  actB: Act | undefined;
  /** The pair's saved receipt, when the day has one; its tags are compared with the live ones. */
  receipt: Receipt | null;
  /** An earlier check of this pair, kept by the drawer so previous and next can come back to it. */
  earlier: PairCheck | null;
  onResult: (key: string, check: PairCheck) => void;
};

const IDLE_BODY =
  "The figures above come from Qloo responses saved when this day was built. This sends 3 requests " +
  "to Qloo right now (an audience ranking for each act and one comparison of the two) and works out " +
  "this pair’s taste overlap and tags again from the answers. It takes a couple of seconds, and " +
  "nothing on the page changes.";

function Tile({
  label,
  value,
  note,
  chip,
}: {
  label: string;
  value: string;
  note: string;
  chip: ReactNode;
}) {
  return (
    <div className="min-w-0 border-t border-border pt-3">
      <dt className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-kicker text-muted-foreground">{label}</span>
        {chip}
      </dt>
      <dd className="mt-2">
        <span className="type-numeral text-4xl leading-none tabular-nums">{value}</span>
        <span className="ml-1 font-mono text-xs text-muted-foreground">/ 100</span>
        <span className="mt-1.5 block text-xs leading-snug text-muted-foreground">{note}</span>
      </dd>
    </div>
  );
}

/** One finished check: the live and saved figures side by side, the rankings, the tags and the trace. */
function CheckResult({ check, receipt }: { check: PairCheck; receipt: Receipt | null }) {
  const toolCalls = useMemo(
    () => traceToolCalls(check.requests, `live-${check.a.actId}-${check.b.actId}`, "qloo"),
    [check],
  );
  const time = formatUtcTime(check.fetchedAt) ?? check.fetchedAt;
  const verdict = agreement(check.overlap.live, check.overlap.saved);
  const rankings = rankingsText(check);
  const { shown: tags, more } = leadingTags(check.tags);

  return (
    <div className="mt-5 rounded-lg border border-border-strong bg-card p-4">
      <h4 className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-semibold">
        Qloo answered at <span className="font-mono tabular-nums">{time}</span> UTC
        <ProvenanceChip provenance="qloo" size="sm" />
      </h4>

      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-5">
        <Tile
          label="Taste overlap now"
          value={formatOverlap(check.overlap.live)}
          note="Worked out by this app from the three answers."
          chip={<ProvenanceChip provenance="derived" size="sm" />}
        />
        <Tile
          label="Saved result"
          value={formatOverlap(check.overlap.saved)}
          note="Saved when this day was built."
          chip={<ProvenanceChip provenance="recorded" size="sm" />}
        />
      </dl>

      <p
        className={
          verdict.kind === "same"
            ? "mt-4 text-[0.9375rem] leading-relaxed"
            : "mt-4 border-l-2 border-foreground pl-3 text-[0.9375rem] leading-relaxed"
        }
      >
        {verdictText(verdict)}
      </p>

      {rankings ? (
        <p className="mt-4 text-sm leading-relaxed">
          <ProvenanceChip provenance="derived" size="sm" className="mr-2" />
          {rankings}
        </p>
      ) : null}

      <div className="mt-5">
        <p className="flex flex-wrap items-center gap-2">
          <span className="type-kicker text-muted-foreground">Tags Qloo returned just now</span>
          <ProvenanceChip provenance="qloo" size="sm" />
        </p>
        {check.tags.length > 0 ? (
          <>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li
                  key={tag.name}
                  className="rounded-full border border-prov-qloo-border bg-prov-qloo-bg px-2.5 py-1 text-xs font-semibold text-prov-qloo"
                >
                  {tagLabel(tag.name)}
                </li>
              ))}
              {more > 0 ? <li className="px-1 py-1 text-xs text-muted-foreground">+{more} more</li> : null}
            </ul>
            {receipt ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {savedTagsText(tagsAlsoSaved(check.tags, receipt.shared_tags), check.tags.length)}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Qloo returned no genre or theme tags for this pair just now.
          </p>
        )}
      </div>

      <TraceDrawer
        toolCalls={toolCalls}
        mode="live"
        triggerLabel="How Qloo answered"
        triggerClassName="mt-5"
        description="The 3 requests this check sent to Qloo just now, with the request ids Qloo returned. None of these are saved responses."
        footnote={`Live check · ${check.a.name} × ${check.b.name} · ${check.fetchedAt}`}
      />
    </div>
  );
}

/**
 * "Check it with Qloo now": on a click, and only then, asks the server to re-send this pair's
 * saved audience rankings and a fresh comparison to Qloo, and shows the taste overlap worked out
 * from the answers beside the saved one. Nothing on the page changes. Shown only when the server
 * says live checks are on. Render it with a `key` per pair, so a new pair starts from idle and a
 * check in flight is dropped when the pair changes.
 */
export function LiveRecheck({ preset, shown, actA, actB, receipt, earlier, onResult }: LiveRecheckProps) {
  const enabled = usePairCheckEnabled();
  const { state, run } = usePairCheck();
  const titleId = useId();

  if (!enabled) return null;

  const key = pairCheckKey(preset.id, shown.a.act_id, shown.b.act_id);
  // An act Qloo has no id for cannot be re-checked; name the first one.
  const unpriced = !actA?.qloo_id
    ? (actA?.name ?? shown.a.name)
    : !actB?.qloo_id
      ? (actB?.name ?? shown.b.name)
      : null;
  const loading = state.status === "loading";
  const error = state.status === "error" ? state.error : null;
  const result = state.status === "ready" ? state.check : earlier;
  const time = result ? (formatUtcTime(result.fetchedAt) ?? result.fetchedAt) : null;

  const onCheck = () => {
    if (loading) return;
    void run(preset.id, shown.a.act_id, shown.b.act_id).then((check) => {
      if (check) onResult(key, check);
    });
  };

  return (
    <section className="mt-8" aria-labelledby={titleId}>
      <h3 id={titleId} className="type-kicker border-b-2 border-foreground pb-2">
        Check it with Qloo now
      </h3>
      <div className="mt-4">
        {unpriced ? (
          <p className="max-w-prose text-[0.9375rem] leading-relaxed text-muted-foreground">
            Qloo has no usable signal for {unpriced}, so this pair is not priced and cannot be re-checked.
          </p>
        ) : (
          <>
            {result ? null : <p className="max-w-prose text-[0.9375rem] leading-relaxed">{IDLE_BODY}</p>}
            <Button
              type="button"
              className={result ? undefined : "mt-4"}
              onClick={onCheck}
              aria-busy={loading || undefined}
              aria-disabled={loading || undefined}
              disabled={error?.kind === "unavailable"}
            >
              {loading ? (
                <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {loading ? "Asking Qloo" : result ? "Check again" : "Re-check this pair live"}
            </Button>
            <p role="status" className="sr-only">
              {loading
                ? "Asking Qloo"
                : state.status === "ready"
                  ? `Qloo answered at ${time} UTC. ${verdictText(agreement(state.check.overlap.live, state.check.overlap.saved))}`
                  : ""}
            </p>
            {error ? (
              <p
                role="alert"
                className="mt-3 max-w-prose rounded-md border border-warning/50 bg-warning-bg px-3 py-2 text-sm text-warning"
              >
                {error.message}
              </p>
            ) : null}
            {result ? <CheckResult check={result} receipt={receipt} /> : null}
          </>
        )}
      </div>
    </section>
  );
}
