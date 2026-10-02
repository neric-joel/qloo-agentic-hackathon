/** Small display formatters shared by the kernel components. Locale is fixed so server and client agree. */

const integer = new Intl.NumberFormat("en-US");

export function formatInteger(value: number): string {
  return integer.format(value);
}

/** A latency split into a figure and its unit, for layouts that style them separately. */
export function latencyParts(ms: number): { value: string; unit: string } | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return { value: String(Math.round(ms)), unit: "ms" };
  return { value: (ms / 1000).toFixed(ms < 10_000 ? 2 : 1), unit: "s" };
}

/** "184 ms", "1.34 s", "12.5 s". */
export function formatLatency(ms: number): string {
  const parts = latencyParts(ms);
  return parts ? `${parts.value} ${parts.unit}` : "n/a";
}

/** "resolve_entities" -> "Resolve entities"; also splits camelCase and kebab-case. */
export function humanizeIdentifier(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatInteger(count)} ${count === 1 ? singular : plural}`;
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No content",
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  408: "Timeout",
  422: "Unprocessable",
  429: "Rate limited",
  500: "Server error",
  502: "Bad gateway",
  503: "Unavailable",
  504: "Gateway timeout",
};

/** "200 OK", "429 Rate limited". Status 0 means no response was received. */
export function describeStatus(status: number): string {
  if (status === 0) return "No response";
  const text = STATUS_TEXT[status];
  return text ? `${status} ${text}` : String(status);
}

export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
