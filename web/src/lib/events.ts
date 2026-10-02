/**
 * Agent event stream contract.
 *
 * Every POST run endpoint answers with `text/event-stream`; each event is `data: <json>\n\n`.
 * The types below mirror the backend contract. `parseAgentEvent` validates untrusted JSON
 * against them so a contract mismatch surfaces as a clear error instead of a broken screen.
 */

/** Where a value shown in the UI came from. */
export type Provenance = "qloo" | "derived" | "llm" | "recorded";

export type QlooRequestRecord = {
  path: string; // e.g. "/v2/insights"
  params: Record<string, string>; // never includes the key
  status: number;
  latency_ms: number;
  cached: boolean;
  request_id?: string; // x-qloo-request-id
  /** Served from a saved fixture instead of a live Qloo call (the backend flags these). */
  recorded?: boolean;
};

export type RunMode = "live" | "recorded";
export type StepStatus = "running" | "done" | "error" | "skipped";
export type NeedsInputOption = { id: string; label: string };
export type RunUsage = { input_tokens: number; output_tokens: number };

export type AgentEvent =
  | { type: "run_started"; run_id: string; mode: RunMode }
  | { type: "step"; id: string; label: string; status: StepStatus; detail?: string }
  | { type: "tool_call"; id: string; tool: string; input: unknown; provenance: Provenance }
  | {
      type: "tool_result";
      id: string;
      tool: string;
      ok: boolean;
      summary: string;
      latency_ms: number;
      provenance: Provenance;
      requests?: QlooRequestRecord[];
    }
  | { type: "text_delta"; text: string } // written prose, streamed
  | { type: "needs_input"; question: string; options: NeedsInputOption[] }
  | { type: "result"; kind: string; data: unknown } // structured artifact for the UI
  | { type: "error"; message: string; retryable: boolean }
  | {
      type: "run_finished";
      run_id: string;
      usage?: RunUsage;
      qloo_calls: number;
      elapsed_ms: number;
    };

export type AgentEventType = AgentEvent["type"];
export type AgentEventOf<T extends AgentEventType> = Extract<AgentEvent, { type: T }>;

// ---------------------------------------------------------------------------
// Result conventions shared by every screen
// ---------------------------------------------------------------------------

/** `result.kind` used when Qloo has too little data to answer; renders as the abstain state. */
export const ABSTAIN_RESULT_KIND = "abstain";

export type AbstainData = {
  reason: string;
  details?: string[];
};

const DEFAULT_ABSTAIN_REASON = "Qloo does not have enough data on these inputs to say.";

/** Reads an abstain payload defensively; `data` comes from the stream and is not trusted. */
export function readAbstainData(data: unknown): AbstainData {
  if (!isRecord(data)) return { reason: DEFAULT_ABSTAIN_REASON };
  const reason =
    typeof data.reason === "string" && data.reason.trim() ? data.reason : DEFAULT_ABSTAIN_REASON;
  const details = Array.isArray(data.details)
    ? data.details.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return details.length > 0 ? { reason, details } : { reason };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ParsedAgentEvent =
  /** A well-formed event. */
  | { kind: "event"; event: AgentEvent }
  /** A well-formed envelope with a `type` this client does not know; safe to ignore. */
  | { kind: "unknown"; type: string }
  /** A known event type whose payload does not match the contract. */
  | { kind: "invalid"; reason: string };

const PROVENANCES = ["qloo", "derived", "llm", "recorded"] as const;
const RUN_MODES = ["live", "recorded"] as const;
const STEP_STATUSES = ["running", "done", "error", "skipped"] as const;

type UnknownRecord = Record<string, unknown>;

class ContractError extends Error {}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reqString(source: UnknownRecord, key: string, at: string): string {
  const value = source[key];
  if (typeof value !== "string") throw new ContractError(`${at}.${key} must be a string`);
  return value;
}

/** Optional strings may arrive as `null` (e.g. from a serialized Python `None`). */
function optString(source: UnknownRecord, key: string, at: string): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ContractError(`${at}.${key} must be a string`);
  return value;
}

function reqNumber(source: UnknownRecord, key: string, at: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractError(`${at}.${key} must be a number`);
  }
  return value;
}

function reqBoolean(source: UnknownRecord, key: string, at: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") throw new ContractError(`${at}.${key} must be a boolean`);
  return value;
}

function reqOneOf<T extends string>(
  source: UnknownRecord,
  key: string,
  allowed: readonly T[],
  at: string,
): T {
  const value = source[key];
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new ContractError(`${at}.${key} must be one of ${allowed.join(", ")}`);
}

/** Qloo parameters are flat strings; anything else is flattened one level (lists use commas). */
function stringifyParam(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join(",");
  }
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

function parseRequestRecord(raw: unknown, at: string): QlooRequestRecord {
  if (!isRecord(raw)) throw new ContractError(`${at} must be an object`);
  const params: Record<string, string> = {};
  const rawParams = raw.params;
  if (rawParams !== undefined && rawParams !== null) {
    if (!isRecord(rawParams)) throw new ContractError(`${at}.params must be an object`);
    for (const [key, value] of Object.entries(rawParams)) {
      if (value !== undefined && value !== null) params[key] = stringifyParam(value);
    }
  }
  const record: QlooRequestRecord = {
    path: reqString(raw, "path", at),
    params,
    status: reqNumber(raw, "status", at),
    latency_ms: reqNumber(raw, "latency_ms", at),
    cached: raw.cached === undefined || raw.cached === null ? false : reqBoolean(raw, "cached", at),
  };
  const requestId = optString(raw, "request_id", at);
  if (requestId) record.request_id = requestId;
  if (raw.recorded === true) record.recorded = true;
  return record;
}

/** A question needs at least one way to answer it, and each answer needs its own id. */
function parseOptions(raw: unknown, at: string): NeedsInputOption[] {
  if (!Array.isArray(raw)) throw new ContractError(`${at} must be an array`);
  if (raw.length === 0) throw new ContractError(`${at} must not be empty`);
  const seen = new Set<string>();
  return raw.map((item, index) => {
    if (!isRecord(item)) throw new ContractError(`${at}[${index}] must be an object`);
    const id = reqString(item, "id", `${at}[${index}]`);
    if (seen.has(id)) throw new ContractError(`${at}[${index}].id must be unique`);
    seen.add(id);
    return { id, label: reqString(item, "label", `${at}[${index}]`) };
  });
}

function parseUsage(raw: unknown): RunUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const { input_tokens: input, output_tokens: output } = raw;
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { input_tokens: input, output_tokens: output };
}

function parseKnownEvent(raw: UnknownRecord, type: string): AgentEvent | null {
  switch (type) {
    case "run_started":
      return {
        type,
        run_id: reqString(raw, "run_id", type),
        mode: reqOneOf(raw, "mode", RUN_MODES, type),
      };
    case "step": {
      const detail = optString(raw, "detail", type);
      return {
        type,
        id: reqString(raw, "id", type),
        label: reqString(raw, "label", type),
        status: reqOneOf(raw, "status", STEP_STATUSES, type),
        ...(detail ? { detail } : {}),
      };
    }
    case "tool_call":
      return {
        type,
        id: reqString(raw, "id", type),
        tool: reqString(raw, "tool", type),
        input: raw.input,
        provenance: reqOneOf(raw, "provenance", PROVENANCES, type),
      };
    case "tool_result": {
      const rawRequests = raw.requests;
      let requests: QlooRequestRecord[] | undefined;
      if (rawRequests !== undefined && rawRequests !== null) {
        if (!Array.isArray(rawRequests)) throw new ContractError(`${type}.requests must be an array`);
        requests = rawRequests.map((item, index) =>
          parseRequestRecord(item, `${type}.requests[${index}]`),
        );
      }
      return {
        type,
        id: reqString(raw, "id", type),
        tool: reqString(raw, "tool", type),
        ok: reqBoolean(raw, "ok", type),
        summary: reqString(raw, "summary", type),
        latency_ms: reqNumber(raw, "latency_ms", type),
        provenance: reqOneOf(raw, "provenance", PROVENANCES, type),
        ...(requests ? { requests } : {}),
      };
    }
    case "text_delta":
      return { type, text: reqString(raw, "text", type) };
    case "needs_input":
      return {
        type,
        question: reqString(raw, "question", type),
        options: parseOptions(raw.options, `${type}.options`),
      };
    case "result":
      return { type, kind: reqString(raw, "kind", type), data: raw.data };
    case "error":
      // Already a failure path, so be forgiving about missing fields.
      return {
        type,
        message:
          typeof raw.message === "string" && raw.message.trim()
            ? raw.message
            : "Something went wrong.",
        retryable: raw.retryable === true,
      };
    case "run_finished": {
      const usage = parseUsage(raw.usage);
      return {
        type,
        run_id: reqString(raw, "run_id", type),
        qloo_calls: reqNumber(raw, "qloo_calls", type),
        elapsed_ms: reqNumber(raw, "elapsed_ms", type),
        ...(usage ? { usage } : {}),
      };
    }
    default:
      return null;
  }
}

/** Validates one decoded JSON value from the stream. Never throws. */
export function parseAgentEvent(raw: unknown): ParsedAgentEvent {
  if (!isRecord(raw)) return { kind: "invalid", reason: "event must be a JSON object" };
  const type = raw.type;
  if (typeof type !== "string") return { kind: "invalid", reason: "event.type must be a string" };
  try {
    const event = parseKnownEvent(raw, type);
    return event ? { kind: "event", event } : { kind: "unknown", type };
  } catch (error) {
    // Anything else (for example a payload nested deeply enough to overflow the stack) is also
    // a payload we cannot use, not a reason to throw out of the stream reader.
    const reason =
      error instanceof ContractError ? error.message : `${type} payload could not be read`;
    return { kind: "invalid", reason };
  }
}
