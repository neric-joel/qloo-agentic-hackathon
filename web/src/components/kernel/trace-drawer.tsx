"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { QlooRequestRecord, RunMode } from "@/lib/events";
import { formatLatency, isSuccessStatus, latencyParts, median, pluralize } from "@/lib/format";
import { selectRequests, type ToolCallState, type TracedRequest } from "@/lib/run-state";

import { CopyJsonButton } from "./copy-json-button";
import { PROVENANCE_META, PROVENANCE_ORDER, ProvenanceChip } from "./provenance-chip";
import { FailedPill, RequestItem, dotted, isLiveWhenRecorded } from "./trace-parts";

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-2 flex items-baseline gap-1.5">
        <span
          className={cn(
            "type-numeral text-4xl leading-none tabular-nums sm:text-5xl",
            value === "n/a" && "text-muted-foreground",
          )}
        >
          {value}
        </span>
        {unit ? <span className="font-mono text-xs text-muted-foreground">{unit}</span> : null}
      </dd>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return <h3 className="pb-2 text-[0.8125rem] leading-5 font-semibold">{children}</h3>;
}

/** The tool call that made a group of requests, or that made none. */
function ToolHeading({ call, suffix }: { call: ToolCallState; suffix?: string }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="min-w-0 font-mono text-sm font-bold">{dotted(call.tool)}</h3>
        <ProvenanceChip provenance={call.provenance} size="sm" />
        {call.status === "error" ? <FailedPill>Failed</FailedPill> : null}
        {call.latencyMs !== undefined ? (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {formatLatency(call.latencyMs)}
            {suffix}
          </span>
        ) : null}
      </div>
      {call.summary ? <p className="mt-1.5 text-sm text-muted-foreground">{call.summary}</p> : null}
    </>
  );
}

export type TraceDrawerProps = {
  toolCalls: readonly ToolCallState[];
  runId?: string;
  mode?: RunMode;
  /** The run summary's own count. Mentioned only if it differs from the requests listed here. */
  qlooCalls?: number;
  /** The run is still streaming, so more requests may arrive. */
  live?: boolean;
  /**
   * The trigger's style. "ruled" (and "ink", which the board passes) sets it as a ruled line of type,
   * "How Qloo was used · 104 requests"; the others print the count in a pill.
   */
  triggerVariant?: "default" | "ink" | "outline" | "ghost" | "ruled";
  triggerClassName?: string;
  /** The trigger's text. Defaults to "How Qloo was used". */
  triggerLabel?: string;
  /**
   * The trigger's text already states the count ("Qloo requests in this run: 0"), so the count is not printed
   * again beside it, and the accessible name is the text alone. Off by default.
   */
  countInLabel?: boolean;
  /** Leaves the ruled trigger's trailing arrow off, for a trigger set as a plain text link. Its text and name do not change. */
  hideIcon?: boolean;
  /** The drawer's title. Defaults to "How Qloo was used"; an invented day names where its figures came from instead. */
  title?: string;
  /** The invented day: the notes under the counts do not describe saved Qloo responses. */
  synthetic?: boolean;
  /**
   * A recorded run that sent no Qloo request and scored every place it tested with the day's saved Qloo
   * reading (the agent panel reads this from the recording). With no request listed, the drawer then says so
   * instead of "did not use Qloo data". Never on the invented day, which has no saved Qloo reading.
   */
  savedReading?: boolean;
  /** Replaces the opening paragraph (which describes a live run). */
  description?: ReactNode;
  /** Replaces the run id line at the bottom. */
  footnote?: string;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Under "No Qloo requests in this run." for a recorded run that sent none and scored every place it tested
 * with the day's saved Qloo reading (the panel reads both from the recording).
 */
export const SAVED_READING_NOTE =
  "This run sent no new Qloo request; every place it tested was scored with this day’s saved Qloo reading.";

/** The same place for anything else with no request listed, and always on the invented day. */
export const NO_QLOO_NOTE =
  "Whatever this run produced did not use Qloo data. Check the label on each value to see where it came from.";

/** Which of the two notes a drawer with no request listed prints: the saved-reading one never on the invented day. */
export function noRequestsNote(savedReading: boolean, synthetic: boolean): string {
  return savedReading && !synthetic ? SAVED_READING_NOTE : NO_QLOO_NOTE;
}

/** One figure in the drawer's summary: its label, its value and any unit. */
export type TraceStat = { label: string; value: string; unit?: string };

/**
 * The drawer's summary, in order. Requests and Cached always; then the median latency of live requests when any
 * reached Qloo just now, else Recorded (a saved trace has no live latency to take a median of), followed by
 * "Live when recorded" when a replayed request reached Qloo live while its run was recorded (counted only from
 * the saved event's own flags, `isLiveWhenRecorded`).
 */
export function traceStats(records: readonly QlooRequestRecord[]): TraceStat[] {
  const total = records.length;
  const stats: TraceStat[] = [
    { label: total === 1 ? "Request" : "Requests", value: String(total) },
    { label: "Cached", value: String(records.filter((record) => record.cached).length) },
  ];
  const liveLatencies = records.filter((record) => !record.cached && !record.recorded).map((record) => record.latency_ms);
  if (liveLatencies.length > 0) {
    const medianLive = latencyParts(median(liveLatencies) ?? Number.NaN);
    stats.push({ label: "Median", value: medianLive?.value ?? "n/a", unit: medianLive?.unit });
    return stats;
  }
  stats.push({ label: "Recorded", value: String(records.filter((record) => record.recorded).length) });
  const liveWhenRecorded = records.filter(isLiveWhenRecorded).length;
  if (liveWhenRecorded > 0) stats.push({ label: "Live when recorded", value: String(liveWhenRecorded) });
  return stats;
}

/** What Copy JSON copies and Raw JSON shows: the run, and every request exactly as the trace holds it. */
export function traceJson(
  records: readonly QlooRequestRecord[],
  { runId, mode, qlooCalls }: { runId?: string; mode?: RunMode; qlooCalls?: number } = {},
): string {
  return JSON.stringify(
    { run_id: runId ?? null, mode: mode ?? null, qloo_calls: qlooCalls ?? records.length, requests: records },
    null,
    2,
  );
}

/**
 * The drawer's status line: a run still streaming says so; a run with an id has finished; a ledger that is not
 * a run (the day's saved build, one pair's requests) has nothing to finish, so it says nothing.
 */
export function runStatusText(live: boolean, runId?: string): string | null {
  if (live) return "The run is still going. New requests are added here as they happen.";
  return runId ? "The run has finished." : null;
}

/**
 * "How Qloo was used": every request the run sent to Qloo, with method, path, parameters, status,
 * latency, cache flag and request id, plus the same data as copyable JSON. The trigger shows the
 * request count so the evidence is visible without opening the drawer.
 */
export function TraceDrawer({
  toolCalls,
  runId,
  mode,
  qlooCalls,
  live = false,
  triggerVariant = "outline",
  triggerClassName,
  triggerLabel = "How Qloo was used",
  countInLabel = false,
  hideIcon = false,
  title = "How Qloo was used",
  synthetic = false,
  savedReading = false,
  description,
  footnote,
  open,
  onOpenChange,
}: TraceDrawerProps) {
  const traced = useMemo(() => selectRequests(toolCalls), [toolCalls]);
  const records = useMemo(() => traced.map((item) => item.record), [traced]);

  const total = records.length;
  const requestCount = pluralize(total, "request");
  // The board's toolbar trigger reads as a ruled line of text, not a filled button.
  const ruled = triggerVariant === "ruled" || triggerVariant === "ink";
  const failedCount = records.filter((record) => !isSuccessStatus(record.status)).length;
  // A median only means something for requests that reached Qloo just now. A saved trace has none,
  // so it counts its recorded requests instead of printing an empty median (`traceStats`).
  const hasLive = records.some((record) => !record.cached && !record.recorded);
  const stats = useMemo(() => traceStats(records), [records]);

  // Requests are numbered across the whole run, so each tool call takes the next slice.
  const groups = useMemo(() => {
    let offset = 0;
    const withRequests: { call: ToolCallState; items: TracedRequest[] }[] = [];
    for (const call of toolCalls) {
      if (call.requests.length === 0) continue;
      withRequests.push({ call, items: traced.slice(offset, offset + call.requests.length) });
      offset += call.requests.length;
    }
    return withRequests;
  }, [toolCalls, traced]);
  const otherCalls = toolCalls.filter((call) => call.requests.length === 0);

  const json = useMemo(() => traceJson(records, { runId, mode, qlooCalls }), [runId, mode, qlooCalls, records]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        {/* The count is part of the accessible name through aria-label, not a hidden span: a hidden span is read
            as its own word, with a space before its comma ("How Qloo was used , 0 requests"). */}
        {countInLabel ? (
          <Button variant={ruled ? "ruled" : triggerVariant} className={triggerClassName}>
            <span>{triggerLabel}</span>
            {ruled && !hideIcon ? <ArrowRight aria-hidden="true" /> : null}
          </Button>
        ) : ruled ? (
          <Button variant="ruled" className={triggerClassName} aria-label={`${triggerLabel}, ${requestCount}`}>
            <span>
              {triggerLabel} <span aria-hidden="true">&middot;</span>{" "}
              <span className="font-mono text-[0.8125rem] tabular-nums">{requestCount.split(" ")[0]}</span>{" "}
              {total === 1 ? "request" : "requests"}
            </span>
            {hideIcon ? null : <ArrowRight aria-hidden="true" />}
          </Button>
        ) : (
          <Button
            variant={triggerVariant}
            className={triggerClassName}
            aria-label={`${triggerLabel}, ${requestCount}`}
          >
            <span>{triggerLabel}</span>
            <span
              aria-hidden="true"
              className="ml-0.5 inline-flex min-w-6 items-center justify-center rounded-sm bg-foreground px-1.5 py-0.5 text-xs font-bold text-background tabular-nums"
            >
              {total}
            </span>
          </Button>
        )}
      </SheetTrigger>

      <SheetContent className="gap-0 p-0 data-[side=right]:lg:max-w-2xl">
        <SheetHeader className="gap-0 border-b border-border p-5 pr-14 sm:p-6 sm:pr-16">
          <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Trace</p>
          <SheetTitle className="type-headline mt-2 text-balance">{title}</SheetTitle>
        </SheetHeader>

        {/* A keyboard-reachable scroll area: focus starts on Close, so without this the arrow and
            page keys would have nothing to scroll until Tab found a control further down. */}
        <div
          tabIndex={0}
          role="region"
          aria-label="Trace details"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 focus-visible:-outline-offset-2 sm:px-6"
        >
          <SheetDescription className="max-w-prose text-[0.9375rem] leading-relaxed">
            {description ??
              "Every request this run sent to Qloo, in order. The API key stays on the server and is never shown or sent to the browser."}
          </SheetDescription>

          <dl
            className={cn(
              "mt-6 grid gap-4 rounded-md bg-background p-4",
              stats.length > 3 ? "grid-cols-2 items-end sm:grid-cols-4" : "grid-cols-3",
            )}
          >
            {stats.map((stat) => (
              <Stat key={stat.label} value={stat.value} unit={stat.unit} label={stat.label} />
            ))}
          </dl>
          <p className="mt-3 mb-8 text-xs text-muted-foreground">
            {hasLive
              ? "Cached means answered from this app’s cache. The median covers live requests only."
              : synthetic
                ? "Cached means answered from this app’s cache. Recorded means replayed from a saved response, not fetched live."
                : "Cached means answered from this app’s cache. Recorded means replayed from a saved Qloo response, not fetched live."}
          </p>

          {/* Always mounted, so the end of a run is announced even while this drawer is open. A ledger that is
              not a run (the day's saved build, one pair's requests) has no run to finish, so it says nothing. */}
          <p
            role="status"
            className={cn("text-sm text-muted-foreground", live ? "mb-5" : "sr-only")}
          >
            {runStatusText(live, runId)}
          </p>

          {qlooCalls !== undefined && qlooCalls !== total ? (
            <p className="mb-5 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              The run summary reports {pluralize(qlooCalls, "Qloo call")}; {total} listed here.
            </p>
          ) : null}

          {total === 0 ? (
            <div className="rounded-md bg-background p-5">
              <p className="font-semibold">No Qloo requests in this run.</p>
              <p className="mt-1 text-sm text-muted-foreground">{noRequestsNote(savedReading, synthetic)}</p>
            </div>
          ) : (
            <div className="space-y-8">
              {groups.map(({ call, items }) => (
                <section key={call.id}>
                  <ToolHeading call={call} suffix=" total" />
                  <ol className="mt-4">
                    {items.map((item) => (
                      <RequestItem key={item.ordinal} item={item} synthetic={synthetic} />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}

          {otherCalls.length > 0 ? (
            <section className="mt-10">
              <SectionHeading>No Qloo request</SectionHeading>
              <ul className="mt-4 space-y-4">
                {otherCalls.map((call) => (
                  <li key={call.id}>
                    <ToolHeading call={call} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-10">
            <SectionHeading>Reading the labels</SectionHeading>
            <dl className="mt-4 space-y-3">
              {PROVENANCE_ORDER.map((provenance) => (
                <div
                  key={provenance}
                  className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3"
                >
                  <dt>
                    <ProvenanceChip provenance={provenance} size="sm" synthetic={synthetic} />
                  </dt>
                  <dd className="text-sm text-muted-foreground">
                    {PROVENANCE_META[provenance].description}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <details className="mt-10 border-t border-border pt-4">
            <summary className="text-[0.8125rem] leading-5 font-semibold cursor-pointer rounded-sm py-1 select-none">
              Raw JSON
            </summary>
            <pre
              tabIndex={0}
              role="region"
              aria-label="Raw trace as JSON"
              className="mt-3 max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed"
            >
              {json}
            </pre>
          </details>

          <p className="mt-6 text-sm">
            <Link href="/method#qloo-calls" className="font-semibold underline underline-offset-4">
              All Qloo endpoints we use
            </Link>
          </p>

          <p className="mt-6 min-w-0 font-mono text-xs break-words text-muted-foreground">
            {footnote ?? (
              <>
                {runId ? `Run ${runId}` : "No run id yet"}
                {mode ? ` · ${mode} mode` : ""}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-popover px-5 py-3 sm:px-6">
          <CopyJsonButton json={json} />
          {mode === "recorded" ? <ProvenanceChip provenance="recorded" /> : null}
          {failedCount > 0 ? (
            <FailedPill>{pluralize(failedCount, "failed request")}</FailedPill>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
