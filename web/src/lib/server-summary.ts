/**
 * The first page's figures, worked out on the server from the saved preset: the day's Clash Budget
 * Index, its five costliest clashes and where the prices come from. Everything here is a display
 * string made with the page's own formatters, so the server HTML prints exactly what the page
 * prints once it loads, and carries no tag, entity id or raw popularity.
 */

import { describeVsRandom } from "./clash-budget";
import {
  dayName,
  daysWithSets,
  festivalName,
  formatDraw,
  formatOverlap,
  formatShare,
  topClashes,
} from "./clashes";
import { buildDecisionCopy, decisionPath, parseDecision, type Decision, type DecisionCopy } from "./decision";
import { pluralize } from "./format";
import { parsePreset, parsePresetList, type Preset } from "./preset";

/** How many of the day's costliest clashes the first page lists. */
export const SUMMARY_CLASHES = 5;

export type SummaryClash = {
  rank: number;
  a: string;
  b: string;
  /** Taste overlap, a rank out of 100 among the bill ("99"). */
  taste: string;
  /** Draw of the two acts combined, 0 to 100 ("97"). */
  draw: string;
  /** Share of the day's clash cost ("29%"). */
  share: string;
};

export type ServerSummary = {
  /** The preset id, so the client can tell whether the summary is for the day it is loading. */
  id: string;
  title: string;
  /** The Clash Budget Index, rounded to a whole number; null when the day has none. */
  index: number | null;
  /** The dial's sentence for the index ("17% more taste-overlap cost than ..."); null without one. */
  vsRandom: string | null;
  /** The hero's one-line figure for narrow screens (`figureLine`); null without an index. */
  figure: string | null;
  clashes: SummaryClash[];
  /** Where the prices come from, in one sentence. */
  evidence: string;
  /** The page's meta and Open Graph description. */
  description: string;
  /**
   * The worked decision for the day (`GET /decision`), worded from the route and this preset, or null
   * when the route did not answer: the page then has no decision card and no button to it.
   */
  decision: DecisionCopy | null;
  /** The route's answer behind it, so the interactive page can show the same card without asking again. */
  decisionData: Decision | null;
};

/**
 * The hero's one-line figure for narrow screens, the same sentence the dial prints:
 * "117 on the Clash Budget Index: 17% more taste-overlap cost than .... Lower is better."
 */
export function figureLine(index: number): string {
  return `${Math.round(index)} on the Clash Budget Index: ${describeVsRandom(index)}. Lower is better.`;
}

/** "A and B", "A and B; C and D". */
function pairList(clashes: readonly SummaryClash[]): string {
  return clashes.map((clash) => `${clash.a} and ${clash.b}`).join("; ");
}

function evidenceSentence(preset: Preset): string {
  const { coverage } = preset.report;
  const total = coverage.strong + coverage.weak + coverage.none;
  const unpriced = Math.max(0, total - coverage.scored_acts);
  return (
    `Priced from ${pluralize(preset.requests.length, "saved Qloo request record")}: ` +
    `${coverage.scored_acts} of ${pluralize(total, "act")} matched to Qloo artists` +
    (unpriced > 0 ? `; ${unpriced} not priced.` : ".")
  );
}

function describeDay(preset: Preset, day: number, index: number | null, clashes: readonly SummaryClash[]): string {
  const { festival } = preset;
  const dayLabel = festival.days[day];
  const name = dayLabel ? `${festivalName(festival)} ${dayName(dayLabel)}` : preset.title;
  const head =
    index === null
      ? `${name} has no Clash Budget Index: its random valid timetables could not be sampled.`
      : `${name} scores ${index} on the Clash Budget Index (100 is the average random valid timetable of its lineup; lower is better).`;
  const top = clashes.slice(0, 2);
  if (top.length === 0) return head;
  return `${head} ${top.length === 1 ? "Costliest clash" : "Costliest clashes"}: ${pairList(top)}.`;
}

/** The first page's figures for a preset, on the first day that has sets (the day the page opens on). */
export function summarize(preset: Preset, decision: Decision | null = null): ServerSummary {
  const day = daysWithSets(preset)[0] ?? 0;
  const raw = preset.report.metrics.clash_budget_index;
  const index = raw === null || !Number.isFinite(raw) ? null : Math.round(raw);
  const clashes = topClashes(preset.report.clashes, day, SUMMARY_CLASHES).map((clash) => ({
    rank: clash.rank,
    a: clash.a.name,
    b: clash.b.name,
    taste: formatOverlap(clash.audience_overlap),
    draw: formatDraw(clash.draw),
    share: formatShare(clash.regret_share),
  }));
  return {
    id: preset.id,
    title: preset.title,
    index,
    vsRandom: raw === null || index === null ? null : describeVsRandom(raw),
    figure: raw === null || index === null ? null : figureLine(raw),
    clashes,
    evidence: evidenceSentence(preset),
    description: describeDay(preset, day, index, clashes),
    decision: buildDecisionCopy(preset, decision),
    decisionData: decision,
  };
}

// ---------------------------------------------------------------------------
// Loading (server only)
// ---------------------------------------------------------------------------

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

/**
 * Origin of the API service, resolved the way `next.config.ts` resolves the `/api` rewrite: an
 * empty value falls back to the local default; a missing scheme is assumed to be https.
 */
export function resolveBackendUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_BACKEND_URL;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}

/** How long the server waits for each preset request before it renders the page without figures. */
export const SUMMARY_TIMEOUT_MS = 4000;

/** How long the server keeps a fetched preset before it asks the API again, in seconds. */
export const SUMMARY_REVALIDATE_SECONDS = 3600;

type FetchLike = (url: string, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function getJson(fetcher: FetchLike, url: string, timeoutMs: number): Promise<unknown> {
  const response = await withTimeout(
    fetcher(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: SUMMARY_REVALIDATE_SECONDS },
    }),
    timeoutMs,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return withTimeout(response.json() as Promise<unknown>, timeoutMs);
}

/**
 * The preset the page opens on, chosen as the client chooses it (`use-presets.ts`): the one
 * `requestedId` names when the list has it, else the first.
 */
export function choosePresetId(list: readonly { id: string }[], requestedId: string | null | undefined): string | null {
  if (list.length === 0) return null;
  return (list.find((item) => item.id === requestedId) ?? list[0]).id;
}

/** The day's decision, or null on any failure: a missing decision never costs the page its summary. */
async function loadDecision(fetcher: FetchLike, backend: string, id: string, timeoutMs: number): Promise<Decision | null> {
  const path = decisionPath(id);
  if (!path) return null;
  try {
    return parseDecision(await getJson(fetcher, `${backend}${path}`, timeoutMs));
  } catch {
    return null;
  }
}

/**
 * The summary of the preset the page opens on (`?preset=` when the list has it, else the first),
 * or null on any failure (no backend, a timeout, an error status or a shape the page does not
 * understand): the page then renders exactly as it does without one.
 */
export async function loadServerSummary(
  requestedId: string | null = null,
  options: { backend?: string; fetcher?: FetchLike; timeoutMs?: number } = {},
): Promise<ServerSummary | null> {
  const backend = options.backend ?? resolveBackendUrl(process.env.BACKEND_URL);
  const fetcher = options.fetcher ?? (fetch as FetchLike);
  const timeoutMs = options.timeoutMs ?? SUMMARY_TIMEOUT_MS;
  try {
    const list = parsePresetList(await getJson(fetcher, `${backend}/api/presets`, timeoutMs));
    const id = choosePresetId(list, requestedId);
    if (id === null) return null;
    const [preset, decision] = await Promise.all([
      getJson(fetcher, `${backend}/api/presets/${encodeURIComponent(id)}`, timeoutMs).then(parsePreset),
      loadDecision(fetcher, backend, id, timeoutMs),
    ]);
    return summarize(preset, decision);
  } catch {
    return null;
  }
}
