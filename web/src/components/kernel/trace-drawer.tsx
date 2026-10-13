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
import type { RunMode } from "@/lib/events";
import { formatLatency, isSuccessStatus, latencyParts, median, pluralize } from "@/lib/format";
import { selectRequests, type ToolCallState, type TracedRequest } from "@/lib/run-state";

import { CopyJsonButton } from "./copy-json-button";
import { PROVENANCE_META, PROVENANCE_ORDER, ProvenanceChip } from "./provenance-chip";
import { FailedPill, RequestItem, dotted } from "./trace-parts";

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
  /** Replaces the opening paragraph (which describes a live run). */
  description?: ReactNode;
  /** Replaces the run id line at the bottom. */
  footnote?: string;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

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
  const cachedCount = records.filter((record) => record.cached).length;
  const failedCount = records.filter((record) => !isSuccessStatus(record.status)).length;
  const liveLatencies = records
    .filter((record) => !record.cached && !record.recorded)
    .map((record) => record.latency_ms);
  const recordedCount = records.filter((record) => record.recorded).length;
  // A median only means something for requests that reached Qloo just now. A saved trace has none,
  // so it counts its recorded requests instead of printing an empty median.
  const hasLive = liveLatencies.length > 0;
  const medianLive = hasLive ? latencyParts(median(liveLatencies) ?? Number.NaN) : null;

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

  const json = useMemo(
    () =>
      JSON.stringify(
        {
          run_id: runId ?? null,
          mode: mode ?? null,
          qloo_calls: qlooCalls ?? total,
          requests: records,
        },
        null,
        2,
      ),
    [runId, mode, qlooCalls, total, records],
  );

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
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6"
        >
          <SheetDescription className="max-w-prose text-[0.9375rem] leading-relaxed">
            {description ??
              "Every request this run sent to Qloo, in order. The API key stays on the server and is never shown or sent to the browser."}
          </SheetDescription>

          <dl className="mt-6 grid grid-cols-3 gap-4 rounded-md bg-background p-4">
            <Stat value={String(total)} label={total === 1 ? "Request" : "Requests"} />
            <Stat value={String(cachedCount)} label="Cached" />
            {hasLive ? (
              <Stat value={medianLive?.value ?? "n/a"} unit={medianLive?.unit} label="Median" />
            ) : (
              <Stat value={String(recordedCount)} label="Recorded" />
            )}
          </dl>
          <p className="mt-3 mb-8 text-xs text-muted-foreground">
            {hasLive
              ? "Cached means answered from this app’s cache. The median covers live requests only."
              : synthetic
                ? "Cached means answered from this app’s cache. Recorded means replayed from a saved response, not fetched live."
                : "Cached means answered from this app’s cache. Recorded means replayed from a saved Qloo response, not fetched live."}
          </p>

          {/* Always mounted, so the end of the run is announced even while this drawer is open. */}
          <p
            role="status"
            className={cn("text-sm text-muted-foreground", live ? "mb-5" : "sr-only")}
          >
            {live
              ? "The run is still going. New requests are added here as they happen."
              : "The run has finished."}
          </p>

          {qlooCalls !== undefined && qlooCalls !== total ? (
            <p className="mb-5 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              The run summary reports {pluralize(qlooCalls, "Qloo call")}; {total} listed here.
            </p>
          ) : null}

          {total === 0 ? (
            <div className="rounded-md bg-background p-5">
              <p className="font-semibold">No Qloo requests in this run.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Whatever this run produced did not use Qloo data. Check the label on each value to
                see where it came from.
              </p>
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
