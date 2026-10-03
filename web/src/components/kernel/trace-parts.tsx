import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Clock, History, Radio, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

import type { QlooRequestRecord } from "@/lib/events";
import { describeStatus, formatLatency, isSuccessStatus, summarizeParam } from "@/lib/format";
import type { TracedRequest } from "@/lib/run-state";

/** Base look of the small status pills in the trace. Each also carries an icon and a text label. */
export const pill =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs leading-none font-semibold whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0";

export function FailedPill({ children }: { children: ReactNode }) {
  return (
    <span className={cn(pill, "border-destructive/50 bg-danger-bg text-destructive")}>
      <CircleAlert aria-hidden="true" />
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: number }) {
  const ok = isSuccessStatus(status);
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <span
      className={cn(
        pill,
        ok
          ? "border-success/50 bg-success-bg text-success"
          : "border-destructive/50 bg-danger-bg text-destructive",
      )}
    >
      <Icon aria-hidden="true" />
      <span className="sr-only">Status: </span>
      {describeStatus(status)}
    </span>
  );
}

function LatencyPill({ ms }: { ms: number }) {
  return (
    <span className={cn(pill, "border-border bg-muted text-foreground tabular-nums")}>
      <Clock aria-hidden="true" />
      <span className="sr-only">Latency: </span>
      {formatLatency(ms)}
    </span>
  );
}

/** Whether the request hit Qloo live, was served from our cache, or came from a saved fixture. */
function SourcePill({ record }: { record: QlooRequestRecord }) {
  if (record.recorded) {
    return (
      <span
        className={cn(
          pill,
          "border-dashed border-prov-recorded-border bg-prov-recorded-bg text-prov-recorded",
        )}
        title="Served from a saved response, not a live Qloo call."
      >
        <History aria-hidden="true" />
        Recorded
      </span>
    );
  }
  if (record.cached) {
    return (
      <span
        className={cn(pill, "border-info/50 bg-info-bg text-info")}
        title="Answered from this app's cache. No new request reached Qloo."
      >
        <Zap aria-hidden="true" />
        Cached
      </span>
    );
  }
  return (
    <span
      className={cn(pill, "border-border-strong bg-card text-foreground")}
      title="A live request to Qloo."
    >
      <Radio aria-hidden="true" />
      Live
    </span>
  );
}

/**
 * A parameter value. A long comma list (the candidate acts of an audience ranking run to dozens of
 * ids) prints its first few items and a count; "Show all" holds the value exactly as sent.
 */
function ParamValue({ value }: { value: string }) {
  const { shown, hidden, full } = summarizeParam(value);
  if (hidden === 0) return <>{value}</>;
  const total = full.split(",").filter((item) => item.trim()).length;
  return (
    <>
      {shown}
      <span className="font-sans whitespace-nowrap text-muted-foreground"> +{hidden} more</span>
      <details className="mt-1">
        <summary className="w-fit cursor-pointer rounded-sm font-sans font-semibold text-foreground select-none">
          Show all {total}
        </summary>
        <p className="mt-1 break-all">{full}</p>
      </details>
    </>
  );
}

function ParamsTable({ item }: { item: TracedRequest }) {
  const entries = Object.entries(item.record.params);
  if (entries.length === 0) {
    return <p className="mt-3 text-xs text-muted-foreground">No parameters.</p>;
  }
  return (
    <table className="mt-3 w-full table-fixed border-collapse text-left text-xs">
      <caption className="sr-only">
        Parameters sent with request {item.ordinal}, GET {item.record.path}
      </caption>
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-t border-border first:border-t-0">
            <th
              scope="row"
              className="w-[40%] py-1.5 pr-3 align-top font-mono font-medium break-words text-muted-foreground"
            >
              {key}
            </th>
            <td className="py-1.5 align-top font-mono break-all">
              <ParamValue value={value} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function requestIdNote(record: QlooRequestRecord): string {
  if (record.recorded) return "not saved with this response";
  if (record.cached) return "none (served from cache)";
  return "none (not provided)";
}

/** One Qloo request: method, path, status, latency, source, parameters and request id. */
export function RequestItem({ item }: { item: TracedRequest }) {
  const { record, ordinal } = item;
  return (
    <li className="border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="font-mono text-xs text-muted-foreground tabular-nums">#{ordinal}</span>
        {/* Every Qloo endpoint this app calls is a GET. */}
        <h4 className="min-w-0 font-mono text-sm font-bold break-all">
          <span className="mr-1.5 rounded-sm bg-foreground px-1.5 py-0.5 text-xs text-background">
            GET
          </span>
          {record.path}
        </h4>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <StatusPill status={record.status} />
        {/* Saved requests may not carry a latency; show none rather than a made-up one. */}
        {Number.isFinite(record.latency_ms) ? <LatencyPill ms={record.latency_ms} /> : null}
        <SourcePill record={record} />
      </div>
      <ParamsTable item={item} />
      <p className="mt-2 text-xs text-muted-foreground">
        Request ID{" "}
        {record.request_id ? (
          <code className="font-mono break-all text-foreground">{record.request_id}</code>
        ) : (
          <span>{requestIdNote(record)}</span>
        )}
      </p>
    </li>
  );
}
