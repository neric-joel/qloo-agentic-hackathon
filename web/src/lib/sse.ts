/**
 * Server-sent events over `fetch`.
 *
 * `EventSource` only supports GET, and the run endpoints are POST, so the stream is read from a
 * `ReadableStream` and decoded here. The decoder follows the SSE line grammar (CR, LF and CRLF
 * terminators, `:` comments, multi-line `data:` fields, events split across chunks).
 */

import { isRecord, parseAgentEvent, type AgentEvent } from "./events";

// ---------------------------------------------------------------------------
// Low-level decoder
// ---------------------------------------------------------------------------

export type SseMessage = {
  /** The `event:` field, or "message" when absent. */
  event: string;
  /** All `data:` lines joined with "\n". */
  data: string;
  id?: string;
  retry?: number;
};

export type SseDecoder = {
  /** Feeds decoded text. Complete events are delivered synchronously. */
  push(text: string): void;
  /** Signals end of stream. A final event that lacks its blank line is still delivered. */
  end(): void;
};

export function createSseDecoder(onMessage: (message: SseMessage) => void): SseDecoder {
  /** The current line so far; it holds no terminator. */
  let line = "";
  /** The last chunk ended with CR, so an LF at the start of the next one finishes a CRLF. */
  let skipLineFeed = false;
  let started = false;
  let eventName = "";
  let dataLines: string[] = [];
  let lastEventId: string | undefined;
  let retry: number | undefined;

  function dispatch(): void {
    if (dataLines.length === 0) {
      eventName = "";
      return;
    }
    const message: SseMessage = { event: eventName || "message", data: dataLines.join("\n") };
    if (lastEventId !== undefined) message.id = lastEventId;
    if (retry !== undefined) message.retry = retry;
    dataLines = [];
    eventName = "";
    onMessage(message);
  }

  function processLine(text: string): void {
    if (text === "") {
      dispatch();
      return;
    }
    if (text.charCodeAt(0) === 58 /* ":" */) return; // comment / keep-alive
    const colon = text.indexOf(":");
    let field = text;
    let value = "";
    if (colon !== -1) {
      field = text.slice(0, colon);
      value = text.slice(colon + 1);
      if (value.charCodeAt(0) === 32 /* " " */) value = value.slice(1);
    }
    switch (field) {
      case "data":
        dataLines.push(value);
        break;
      case "event":
        eventName = value;
        break;
      case "id":
        if (!value.includes("\0")) lastEventId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) retry = Number(value);
        break;
      default:
        break; // unknown fields are ignored
    }
  }

  return {
    push(text: string): void {
      // Chunks can be empty (a multi-byte character cut by the byte decoder): nothing to do, and
      // it must not disturb a CRLF that straddles the chunks around it.
      if (text.length === 0) return;
      if (!started) {
        started = true;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
      }
      let start = 0;
      if (skipLineFeed) {
        skipLineFeed = false;
        if (text.charCodeAt(0) === 10) start = 1;
      }
      // Only the new text is scanned, so a very long line arriving in small chunks stays linear.
      for (let i = start; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code !== 10 && code !== 13) continue; // not LF / CR
        processLine(line + text.slice(start, i));
        line = "";
        if (code === 13) {
          if (i + 1 === text.length) skipLineFeed = true;
          else if (text.charCodeAt(i + 1) === 10) i++;
        }
        start = i + 1;
      }
      line += text.slice(start);
    },
    end(): void {
      if (line.length > 0) {
        processLine(line);
        line = "";
      }
      dispatch();
    },
  };
}

// ---------------------------------------------------------------------------
// Run streaming
// ---------------------------------------------------------------------------

/** How long a connection may stay silent before it is treated as stalled. */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

export type StreamRunOptions = {
  /** Abort when no bytes (comments included) arrive for this long. 0 disables the watchdog. */
  idleTimeoutMs?: number;
  /** Override `fetch`, for tests. */
  fetch?: typeof fetch;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorEvent(message: string, retryable: boolean): AgentEvent {
  return { type: "error", message, retryable };
}

/** The message in an error body: `detail`, `message` or `error`, including FastAPI's list form. */
function readDetail(payload: unknown): string {
  if (!isRecord(payload)) return "";
  for (const candidate of [payload.detail, payload.message, payload.error]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (Array.isArray(candidate)) {
      const first: unknown = candidate[0];
      if (isRecord(first) && typeof first.msg === "string") {
        // Validation errors carry a location such as ["body", "input", "favorites"].
        const where = Array.isArray(first.loc) ? first.loc.slice(1).join(".") : "";
        return where ? `${where}: ${first.msg}` : first.msg;
      }
    }
  }
  return "";
}

/** Turns a non-2xx response into a short, human-readable error event. */
async function describeHttpFailure(response: Response): Promise<AgentEvent> {
  const { status } = response;
  let detail = "";
  try {
    const text = (await response.text()).slice(0, 2000);
    try {
      detail = readDetail(JSON.parse(text));
    } catch {
      // Not JSON: HTML error pages and the like are not worth showing.
    }
  } catch {
    // Body unreadable: fall through to the generic message.
  }

  if (status === 429) return errorEvent(detail || "Too many requests. Wait a moment.", true);
  if (status >= 500) {
    const generic =
      status === 502 || status === 503 || status === 504
        ? "The service is unavailable right now."
        : "The service hit an error.";
    return errorEvent(detail || generic, true);
  }
  return errorEvent(detail || `The request was rejected (HTTP ${status}).`, false);
}

/**
 * POSTs `body` as JSON and delivers each `AgentEvent` from the event stream to `onEvent`.
 *
 * Failures surface as a single `error` event rather than a rejected promise: HTTP errors, a
 * stalled or dropped connection, and malformed or contract-violating events (later events could
 * no longer be trusted, so reading stops). Reading also stops at `run_finished`. A server
 * `error` event is passed on and the read continues only to pick up the closing `run_finished`.
 * Once a run's outcome is known (`run_finished`, `needs_input` or `error`), a later dropped or
 * silent connection is not reported. Aborting through `signal` resolves quietly and emits
 * nothing. The promise rejects only for bugs in the caller: a body that cannot be serialized, or
 * an `onEvent` that throws.
 */
export async function streamRun(
  url: string,
  body: unknown,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
  options: StreamRunOptions = {},
): Promise<void> {
  if (signal?.aborted) return;
  // Serialize first: an unserializable body is a bug in the caller, not a network failure.
  const payload = JSON.stringify(body ?? {});
  const { idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, fetch: fetchImpl = globalThis.fetch } = options;

  // Internal controller so a stalled connection can be cut without touching the caller's signal.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  const armWatchdog = () => {
    clearTimeout(timer);
    if (idleTimeoutMs > 0) {
      timer = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, idleTimeoutMs);
    }
  };

  let receivedBytes = false;
  // The outcome is known once the run finishes, pauses for input (the server may close the stream
  // there, because the answer arrives in a new request) or fails. After that, a dropped or silent
  // connection changes nothing, so it is not reported.
  let sawEnd = false;
  let halted = false;
  let handlerFailure: { error: unknown } | undefined;

  const emit = (event: AgentEvent) => {
    if (signal?.aborted) return; // the caller has gone: say nothing more, not even about failures
    if (event.type === "run_finished" || event.type === "needs_input" || event.type === "error") {
      sawEnd = true;
    }
    if (event.type === "run_finished") halted = true; // nothing follows the closing event
    try {
      onEvent(event);
    } catch (error) {
      handlerFailure = { error };
      halted = true;
    }
  };

  /** Reports something we cannot trust and stops reading. */
  const fail = (message: string) => {
    halted = true;
    emit(errorEvent(message, true));
  };

  const handleMessage = (message: SseMessage) => {
    if (halted) return;
    let json: unknown;
    try {
      json = JSON.parse(message.data);
    } catch {
      fail("The server sent a malformed event.");
      return;
    }
    const parsed = parseAgentEvent(json);
    if (parsed.kind === "event") {
      emit(parsed.event);
    } else if (parsed.kind === "invalid") {
      console.error(`[stream] Rejected event: ${parsed.reason}`);
      fail("The server sent an event this app could not read.");
    }
    // Unknown event types are skipped so newer servers do not break older clients.
  };

  const execute = async (): Promise<void> => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      armWatchdog();
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: payload,
        signal: controller.signal,
      });

      if (!response.ok) {
        emit(await describeHttpFailure(response));
      } else if (!response.body) {
        fail("The server returned an empty response.");
      } else {
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        const sse = createSseDecoder(handleMessage);

        while (!halted && !signal?.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes = true;
          armWatchdog();
          sse.push(decoder.decode(value, { stream: true }));
        }
        if (!halted && !signal?.aborted) {
          sse.push(decoder.decode());
          sse.end();
        }
        if (!halted && !sawEnd) {
          emit(errorEvent("The connection closed before the run finished.", true));
        }
      }
    } catch (error) {
      if (signal?.aborted) return; // the caller cancelled: nothing to report
      // fetch() and body reads reject with TypeError for network failures. An AbortError we did
      // not ask for (our own aborts are the caller's or the watchdog's) is treated the same way.
      const transport = stalled || isAbortError(error) || error instanceof TypeError;
      if (!transport) throw error;
      if (sawEnd) return; // the outcome was already reported; a late failure changes nothing
      if (stalled) {
        emit(errorEvent("The connection stalled.", true));
      } else if (isAbortError(error)) {
        emit(errorEvent("The request was cancelled.", true));
      } else {
        emit(
          errorEvent(
            receivedBytes
              ? "The connection was interrupted."
              : "Could not reach the service. Check your connection.",
            true,
          ),
        );
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
      // Release the connection whether we finished, halted, or were aborted.
      reader?.cancel().catch(() => undefined);
    }
  };

  await execute();
  if (handlerFailure) throw handlerFailure.error;
}
