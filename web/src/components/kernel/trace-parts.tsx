import type { ReactNode } from "react";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";

import type { QlooRequestRecord } from "@/lib/events";
import { describeStatus, formatLatency, isSuccessStatus, summarizeParam } from "@/lib/format";
import type { TracedRequest } from "@/lib/run-state";

/**
 * Base look of the small status stamps in the trace: the house `.tag` stamp, its word in its own ink.
 * Only Recorded carries a glyph (the clock that marks a replay); the other words say their state.
 */
export const pill = "tag shrink-0";

/**
 * A dotted key, path or id that wraps only where it can break cleanly: after each dot (and each slash
 * of a path), never in the middle of a word. Normal wrapping, no forced breaks.
 */
export function dotted(text: string): ReactNode {
  const parts = text.split(/(?<=[./])/);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <span key={index}>
      {part}
      {index < parts.length - 1 ? <wbr /> : null}
    </span>
  ));
}

export function FailedPill({ children }: { children: ReactNode }) {
  return (
    <span className={cn(pill, "text-destructive")}>
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: number }) {
  const ok = isSuccessStatus(status);
  return (
    <span className={cn(pill, ok ? "text-success" : "text-destructive")}>
      <span className="sr-only">Status: </span>
      {describeStatus(status)}
    </span>
  );
}

function LatencyPill({ ms }: { ms: number }) {
  return (
    <span className={cn(pill, "text-foreground normal-case tabular-nums")}>
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
        className={cn(pill, "text-prov-recorded")}
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
        className={cn(pill, "text-muted-foreground")}
        title="Answered from this app's cache. No new request reached Qloo."
      >
        Cached
      </span>
    );
  }
  return (
    <span
      className={cn(pill, "text-foreground")}
      title="A live request to Qloo."
    >
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
        <p className="mt-1 min-w-0 break-words">{full}</p>
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
              className="w-[40%] min-w-0 py-1.5 pr-3 align-top font-mono font-medium text-muted-foreground"
            >
              {dotted(key)}
            </th>
            <td className="min-w-0 py-1.5 align-top font-mono break-words">
              <ParamValue value={value} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Why a saved, cached answer carries no request id, in words. A saved day's ledger keeps what the build saw:
 * `cached` marks a request answered from a response this app had saved (backend/app/qloo/client.py:352-353,
 * the fixtures-first path), and that saved response holds a request id only since request ids were kept with
 * saved responses (client.py:370-376 writes it; :437-450 reads it, None "when the fixture predates" it). The
 * published days were built before that (built_at 2026-10-03; the change came later), and the two requests
 * that reached Qloo live during the build keep theirs (backend/scripts/build_preset.py:91-97).
 */
export const NO_ID_SAVED_BEFORE = "No request id: this response was saved before request ids were kept.";

function requestIdNote(record: QlooRequestRecord): string {
  if (record.recorded) return "not saved with this response";
  if (record.cached) return "none (served from cache)";
  return "not supplied";
}

/**
 * One Qloo request: method, path, status, latency, source, parameters and request id. `synthetic`: the invented
 * day, whose rows are not saved Qloo responses, so they never get the saved-response reason.
 */
export function RequestItem({ item, synthetic = false }: { item: TracedRequest; synthetic?: boolean }) {
  const { record, ordinal } = item;
  const savedBefore = !record.request_id && record.recorded === true && record.cached && !synthetic;
  return (
    <li className="border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="font-mono text-xs text-muted-foreground tabular-nums">#{ordinal}</span>
        {/* Every Qloo endpoint this app calls is a GET. */}
        <h4 className="min-w-0 font-mono text-sm font-bold">
          <span className="mr-1.5 rounded-sm bg-foreground px-1.5 py-0.5 text-xs text-background">
            GET
          </span>
          {dotted(record.path)}
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
        {savedBefore ? NO_ID_SAVED_BEFORE : "Request ID "}
        {savedBefore ? null : record.request_id ? (
          <code className="min-w-0 font-mono break-words text-foreground">{dotted(record.request_id)}</code>
        ) : (
          <span>{requestIdNote(record)}</span>
        )}
      </p>
    </li>
  );
}
