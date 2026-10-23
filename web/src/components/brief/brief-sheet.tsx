"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Lock, Printer } from "lucide-react";

import { BriefDayFigure } from "@/components/brief/brief-day-figure";
import { otherHalfPair } from "@/components/clash/taste-lens";
import { TradeoffTable } from "@/components/clash/tradeoff-table";
import { Button } from "@/components/ui/button";
import {
  BRIEF_CLASHES,
  BRIEF_HEADING_TAIL,
  DECISION_CHOICES,
  DECISION_INITIALS,
  HIDDEN_NOTE,
  INDEX_MEANING,
  NO_MOVES,
  READING_NOTE,
  TO_DECIDE,
  bandSentence,
  briefFigure,
  briefIntro,
  briefLockLine,
  briefRows,
  baselineNote,
  briefSteps,
  briefTitle,
  briefTradeoff,
  candidateLine,
  clashesCaption,
  clashesTitle,
  coverageSentence,
  dayFigures,
  figureOnPaper,
  figuresAttribution,
  hiddenNames,
  hiddenSentence,
  howToRead,
  indexSentence,
  noPricedClashes,
  isBriefRuleStep,
  onPaper,
  planClashLines,
  planClashesTitle,
  planSummary,
  planVerdictSentence,
  sharedMinutes,
  sharedMinutesSentence,
  sourceHosts,
  heavyPlan,
  tableClashes,
  tableOnPaper,
  type BriefRow,
  type BriefTradeoff,
} from "@/lib/brief";
import { daysWithSets } from "@/lib/clashes";
import { requestDecision, type Decision } from "@/lib/decision";
import { DO_NOT_USE } from "@/lib/demand";
import { parseLenses, type Lenses } from "@/lib/lenses";
import { MOCK_PRESET_ID, mockPreset, mockPresetList } from "@/lib/mock-preset";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";
import { PLAN_CAVEAT, RAISES_MARK } from "@/lib/plan-copy";
import { parsePreset, parsePresetList, type Preset, type PresetSummary } from "@/lib/preset";
import { decodeMoves, encodeMoves, fetchPlan, isSafeId, type Plan, type StackStep } from "@/lib/stack";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------------------------ the words

/** Under "Tested moves" on a bare /brief, which opens on a festival day with nothing kept. */
export const BARE_NO_MOVES = "No moves kept yet. Keep one on the timetable page and it appears here.";

/** After "To decide": nothing on the page moves a set by itself. */
export const TEAMS_AGREE = "Nothing moves until the acts’ teams agree.";

/** The sign-off at the foot of the sheet, each label followed by a line to write on. */
export const SIGN_OFF = ["Prepared by", "Reviewed by (head of programming)", "Date"] as const;

/** A link that names a day this page cannot read, or carries moves with no day. */
export const UNAVAILABLE = "This brief link is unavailable. Open the timetable and choose ‘Open as a one-page brief’.";

// ------------------------------------------------------------------------------------ loading

export type Outcome =
  | {
      status: "ready";
      preset: Preset;
      plan: Plan | null;
      decision: Decision | null;
      /**
       * The day's two rankings (`GET /api/presets/{id}/lenses`), for the line under the published day's table that
       * names the clash taste overlap lowers furthest. Null, or absent, when they did not load: the line is left out.
       */
      lenses?: Lenses | null;
      /** True when the page was opened with no link: the server's first published day, nothing kept. */
      bare?: boolean;
    }
  | { status: "missing" }
  | { status: "error" };

/**
 * What the address asks for. No preset and no moves is a bare /brief, which opens on a festival day; moves with no
 * preset, or a preset id this page would not send, is an unavailable link.
 */
export type BriefTarget = { kind: "bare" } | { kind: "link"; presetId: string } | { kind: "broken" };

export function briefTarget(presetId: string | null, movesText: string | null): BriefTarget {
  if (presetId === null) return movesText === null ? { kind: "bare" } : { kind: "broken" };
  return isSafeId(presetId) ? { kind: "link", presetId } : { kind: "broken" };
}

/** The day a bare /brief opens on: the first published day the server lists, else its first (the invented day). */
export function chooseBriefPreset(list: readonly Pick<PresetSummary, "id" | "synthetic">[]): string | null {
  return (list.find((item) => item.synthetic !== true) ?? list[0])?.id ?? null;
}

/**
 * The brief's own reads skip the browser's HTTP cache. The API marks its answers `stale-while-revalidate`, so a
 * second read of an address the page (or the timetable before it) already read is answered from the cache and
 * starts a background revalidation, which keeps the page from ever reaching network idle. The brief reads each
 * address once, fresh, and shows the same figures.
 */
const READ: RequestInit = { headers: { Accept: "application/json" }, cache: "no-store" };

/** The server's festival days, from `GET /api/presets`; in mock mode the synthetic day only. */
async function loadList(signal: AbortSignal): Promise<PresetSummary[]> {
  if (MOCK_STREAM_ENABLED) return mockPresetList();
  const response = await fetch("/api/presets", { ...READ, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parsePresetList(await response.json());
}

/**
 * One day's two rankings, for the candidate-to-keep line. Never fails the brief: mock mode, an older server, a
 * failed request, an unreadable answer or one for another day all give null, and the sheet prints without the line.
 */
async function loadLenses(id: string, day: number | null, signal: AbortSignal): Promise<Lenses | null> {
  if (MOCK_STREAM_ENABLED || day === null) return null;
  try {
    const response = await fetch(`/api/presets/${encodeURIComponent(id)}/lenses?day=${day}`, { ...READ, signal });
    if (!response.ok) return null;
    const lenses = parseLenses(await response.json());
    return lenses && lenses.day === day ? lenses : null;
  } catch {
    return null;
  }
}

/** A bare /brief: the chosen day with no plan and no comparison. Any failure is "could not load", never "unavailable". */
async function loadBareBrief(signal: AbortSignal): Promise<Outcome> {
  try {
    const id = chooseBriefPreset(await loadList(signal));
    if (id === null) return { status: "error" };
    const preset = await loadPreset(id, signal);
    const lenses = await loadLenses(id, resolveDay(preset, null), signal);
    return { status: "ready", preset, plan: null, decision: null, lenses, bare: true };
  } catch {
    return { status: "error" };
  }
}

class NotFound extends Error {}

/**
 * The festival day, from `GET /api/presets/{id}` only (no list request, so an unknown id is shown as
 * unknown rather than swapped for another day). In mock mode the synthetic day is served locally.
 */
async function loadPreset(id: string, signal: AbortSignal): Promise<Preset> {
  if (MOCK_STREAM_ENABLED) {
    if (id !== MOCK_PRESET_ID) throw new NotFound();
    return mockPreset();
  }
  const response = await fetch(`/api/presets/${encodeURIComponent(id)}`, { ...READ, signal });
  if (response.status === 404) throw new NotFound();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parsePreset(await response.json());
}

/**
 * The preset and, only when the link carries kept moves, their plan, scored by the server, and the day's
 * decision (for the card's side-by-side comparison), with the day's two rankings. The decision and the rankings
 * never fail the brief: an older server, a failed request or mock mode leaves them null, and the brief prints
 * without the comparison or the candidate-to-keep line.
 */
async function loadBrief(
  id: string,
  dayText: string | null,
  moves: readonly StackStep[],
  signal: AbortSignal,
): Promise<Outcome> {
  try {
    const day = dayText !== null && /^\d{1,2}$/.test(dayText) ? Number(dayText) : null;
    const [preset, plan, decision] = await Promise.all([
      loadPreset(id, signal),
      moves.length > 0 ? fetchPlan(id, moves, null, signal) : Promise.resolve(null),
      moves.length > 0 && !MOCK_STREAM_ENABLED
        ? requestDecision(id, day, signal).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (moves.length > 0 && plan === null) return { status: "error" };
    // The rankings are asked for only once the day is known to exist: an unknown day or link sends no request for
    // them. A link with no day opens on the first day with sets.
    const lenses = await loadLenses(id, resolveDay(preset, dayText), signal);
    return { status: "ready", preset, plan, decision, lenses };
  } catch (error) {
    return error instanceof NotFound ? { status: "missing" } : { status: "error" };
  }
}

/** Loads the brief's data once per target and plan; a malformed preset id never reaches the network. */
function useBrief(
  target: BriefTarget,
  dayText: string | null,
  moves: readonly StackStep[],
): Outcome | { status: "loading" } {
  const kind = target.kind;
  const presetId = target.kind === "link" ? target.presetId : null;
  const key = `${kind}|${presetId ?? ""}|${dayText ?? ""}|${encodeMoves(moves)}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  useEffect(() => {
    if (kind === "broken") return;
    const controller = new AbortController();
    const work =
      presetId === null
        ? loadBareBrief(controller.signal)
        : loadBrief(presetId, dayText, moves, controller.signal);
    work.then((outcome) => {
      if (!controller.signal.aborted) setResult({ key, outcome });
    });
    return () => controller.abort();
  }, [kind, presetId, dayText, moves, key]);

  if (kind === "broken") return { status: "missing" };
  return result && result.key === key ? result.outcome : { status: "loading" };
}

/** The day in the link, if it is one of the preset's days with sets; the first such day when absent. */
function resolveDay(preset: Preset, text: string | null): number | null {
  const days = daysWithSets(preset);
  if (text === null || text === "") return days[0] ?? null;
  if (!/^\d{1,2}$/.test(text)) return null;
  const day = Number(text);
  return days.includes(day) ? day : null;
}

// ------------------------------------------------------------------------------------ the page

const BACK_LINK =
  "inline-flex items-center gap-2 rounded-sm py-2 text-sm font-semibold underline-offset-4 hover:underline";

function backHref(presetId: string | null): string {
  return isSafeId(presetId) ? `/?preset=${encodeURIComponent(presetId)}` : "/";
}

function BackLink({ href }: { href: string }) {
  return (
    <Link href={href} className={BACK_LINK}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to the timetable
    </Link>
  );
}

/**
 * Loading, error and unknown-link states: the page's h1, one short line and the way back. The line's words sit in one
 * element, so a sentence never splits into flex columns. While loading it is still (no spinner: nothing moves that the
 * visitor did not cause) and holds a screen's height, as the page's own fallback does, so the footer starts below the
 * fold and the sheet arriving moves nothing in view.
 */
function Notice({ children, href, busy = false }: { children: ReactNode; href: string; busy?: boolean }) {
  return (
    <div className={cn("container-page max-w-[60rem] pt-8 pb-12", busy && "min-h-svh")}>
      <h1 className="type-kicker text-muted-foreground">Clash brief</h1>
      <p
        role={busy ? "status" : "alert"}
        className="mt-2 flex max-w-prose items-center gap-2 text-lg leading-snug font-semibold sm:text-xl"
      >
        <span>{children}</span>
      </p>
      {busy ? null : (
        <div className="mt-4">
          <BackLink href={href} />
        </div>
      )}
    </div>
  );
}

/**
 * The brief page: reads `preset`, `day` and `moves` from the link, loads the festival day (and the
 * plan when moves were kept), and shows the one-page sheet with a print button. Nothing here is a
 * download, a share or an email: the sheet stays on this site.
 */
export function BriefSheet() {
  const params = useSearchParams();
  const presetId = params.get("preset");
  const dayText = params.get("day");
  const movesText = params.get("moves");
  const moves = useMemo(() => decodeMoves(movesText), [movesText]);
  const target = useMemo(() => briefTarget(presetId, movesText), [presetId, movesText]);
  const state = useBrief(target, dayText, moves);
  return <BriefScreen state={state} presetId={presetId} dayText={dayText} moves={moves} />;
}

/**
 * The page for one loading state: the notice, or the sheet with its print button. A bare /brief's way back is the
 * timetable of the day it shows. Kept apart from the loading so each state renders on its own.
 */
export function BriefScreen({
  state,
  presetId,
  dayText,
  moves,
}: {
  state: Outcome | { status: "loading" };
  presetId: string | null;
  dayText: string | null;
  moves: readonly StackStep[];
}) {
  const back = backHref(state.status === "ready" && state.bare ? state.preset.id : presetId);

  if (state.status === "loading") {
    return (
      <Notice href={back} busy>
        Loading the brief.
      </Notice>
    );
  }
  if (state.status === "error") return <Notice href={back}>Could not load this brief.</Notice>;
  if (state.status === "missing") {
    // UNAVAILABLE, with "one-page" kept on one line.
    return (
      <Notice href="/">
        This brief link is unavailable. Open the timetable and choose ‘Open as a{" "}
        <span className="whitespace-nowrap">one-page</span> brief’.
      </Notice>
    );
  }

  const day = resolveDay(state.preset, dayText);
  if (day === null) {
    return <Notice href={back}>The day in this link has no timetable.</Notice>;
  }

  return (
    <div className="container-page max-w-[60rem] pt-6 pb-16 sm:pt-8 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 print:hidden">
        <BackLink href={back} />
        <Button type="button" variant="ink" size="sm" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          Print this brief
        </Button>
      </div>
      <BriefContent
        preset={state.preset}
        day={day}
        plan={state.plan}
        tradeoff={briefTradeoff(state.preset, state.decision, moves, day)}
        lenses={state.lenses ?? null}
        bare={state.bare === true}
        className="mt-4 print:mt-0"
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------ the sheet

/**
 * The printed sheet's type (round 37): its running text (paragraphs, list lines, notes, caveats, the sign-off) at
 * 10 pt and everything else at 9.5 pt or more. Each size carries its own leading, because `text-sm` and `text-xs` set a
 * screen line height that would otherwise print at 1.33 to 1.43 and push the sheet onto a second page.
 */
const PRINT_TEXT = "print:text-[10pt] print:leading-[1.15]";
const PRINT_SMALL = "print:text-[9.5pt] print:leading-[1.15]";

/**
 * The comparison table and the drawing's caption are shared components with their own 9 pt print sizes; on this sheet
 * they print at its sizes: the comparison's sentences at 10 pt, its table and heads at 9.5 pt, and the caption at
 * 9.5 pt. The table's cells keep the sheet's leading (their screen `text-sm` would print at 1.43), and its frame sits
 * 2 pt under the sentence above it, not the screen's 8px. Set from here, by descendant, so the components and their
 * other uses stay as they are.
 */
const TRADEOFF_PRINT = [
  "print:[&>div]:mt-[2pt]",
  "print:[&_p]:text-[10pt] print:[&_h3]:text-[10pt]",
  "print:[&_table]:text-[9.5pt] print:[&_th]:text-[9.5pt] print:[&_td]:text-[9.5pt] print:[&_th_span]:text-[9.5pt]",
  "print:[&_th]:leading-[1.15] print:[&_td]:leading-[1.15]",
].join(" ");

/**
 * The drawing's labels print at the wide frame's `printFont`, 12.7 units, so on A4 they are 9.5 pt like the rest of
 * the sheet's small type (lib/brief.ts FIGURE_FRAMES: the layout leaves room for that size). The stage names sit 0.35
 * of a unit lower for each unit they grow, so they stay centred on their bars. Set from here, by descendant, as the
 * caption is: the drawing itself, and the screen, stay at 10 units.
 */
const FIGURE_PRINT = [
  "print:[&_figcaption]:text-[9.5pt]",
  "print:[&_svg[data-frame=wide]]:text-[12.7px]",
  "print:[&_svg[data-frame=wide]_[data-stage]]:translate-y-[0.945px]",
].join(" ");

function Block({
  title,
  children,
  className,
  quietInPrint = false,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  /** The heading is left off the printed page (the block's first sentence says what it is). */
  quietInPrint?: boolean;
}) {
  const id = `brief-${title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`;
  // On paper a heading takes the sheet's own leading, not the screen label's 18px line.
  return (
    <section aria-labelledby={id} className={cn("mt-7 break-inside-avoid print:mt-[3pt]", className)}>
      <h2
        id={id}
        className={cn(
          "type-kicker pb-1.5 print:pb-0 print:text-[10pt] print:leading-[1.15]",
          quietInPrint && "print:sr-only",
        )}
      >
        {title}
      </h2>
      <div className="mt-3 print:mt-[1pt]">{children}</div>
    </section>
  );
}

/**
 * A hidden clash's mark in the table and the stacked rows: the word "Hidden" as plain semibold ink, with no ring,
 * chip or fill (the note under the table says what it means). Raspberry stays on shared minutes.
 */
function HiddenMark() {
  return <span className="font-semibold whitespace-nowrap text-foreground print:text-[9.5pt]">Hidden</span>;
}

function LockedMark() {
  return (
    <span className="inline-flex items-center gap-1 font-semibold whitespace-nowrap text-foreground">
      <Lock aria-hidden="true" className="size-3 print:size-[9.5pt]" />
      both locked
    </span>
  );
}

/**
 * Beside a kept step, on paper only: what the head of programming decided about it, to circle, and a line for their
 * initials (a 1px rule in the control-edge ink, as the sign-off's lines are). Muted text, as the step's own second
 * line; never shown on the screen, and never a verdict of the page's own. `beside` floats it to the right of the
 * step's first line (one column of steps); otherwise it is its own line under the step (two columns).
 */
function DecisionMark({ beside }: { beside: boolean }) {
  return (
    <span
      data-decision
      className={cn(
        "hidden text-muted-foreground print:text-[10pt]",
        beside ? "print:float-right print:ml-[10pt] print:block" : "print:block",
      )}
    >
      {DECISION_CHOICES}
      <span className="ml-[8pt]">{DECISION_INITIALS}</span>{" "}
      <span className="inline-block w-[40pt] border-b border-border-strong" />
    </span>
  );
}

const TH = "px-2 py-2 font-semibold align-bottom print:px-[2pt] print:py-[1pt]";
const TD = "px-2 py-2 align-top print:px-[2pt] print:py-[1pt]";

/** The costliest clashes as a table (wide screens and print). */
function ClashTable({ rows, captionId }: { rows: readonly BriefRow[]; captionId: string }) {
  return (
    <table
      aria-labelledby={captionId}
      className="hidden w-full border-collapse text-left text-sm sm:table print:table print:text-[9.5pt] print:leading-[1.15]"
    >
      <thead>
        <tr className={cn("border-b border-border-strong text-xs", PRINT_SMALL)}>
          <th scope="col" className={cn(TH, "w-8 text-right")}>
            #
          </th>
          {/* On paper the names get the room, so a pair prints on one line and the figures' heads wrap instead. */}
          <th scope="col" className={cn(TH, "print:w-[40%]")}>
            Clash
          </th>
          <th scope="col" className={TH}>
            Time shared
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Taste overlap<span className="hidden print:inline"> /100</span>
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Combined draw<span className="hidden print:inline"> /100</span>
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Share of the day&rsquo;s cost
          </th>
          <th scope="col" className={TH}>
            Hidden
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr key={row.rank} className="break-inside-avoid">
            <td className={cn(TD, "text-right font-mono tabular-nums")}>{row.rank}</td>
            <td className={TD}>
              <span className="font-semibold">
                {row.a} and {row.b}
              </span>
              <span className={cn("block text-xs text-muted-foreground", PRINT_SMALL)}>
                {row.stageA} + {row.stageB}
                {row.bothLocked ? (
                  <>
                    {" · "}
                    <LockedMark />
                  </>
                ) : null}
              </span>
            </td>
            <td className={cn(TD, "font-mono text-xs whitespace-nowrap tabular-nums", PRINT_SMALL)}>
              {row.window ?? "Times not known"}
              <span className="block text-muted-foreground">{row.minutes} min</span>
            </td>
            <td className={cn(TD, "text-right font-mono whitespace-nowrap tabular-nums")}>
              {row.overlap}
              <span className="text-muted-foreground print:hidden"> / 100</span>
            </td>
            <td className={cn(TD, "text-right font-mono whitespace-nowrap tabular-nums")}>
              {row.draw}
              <span className="text-muted-foreground print:hidden"> / 100</span>
            </td>
            <td className={cn(TD, "text-right font-mono tabular-nums")}>{row.share}</td>
            <td className={TD}>{row.hidden ? <HiddenMark /> : <span className="sr-only">Not hidden</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The same rows stacked, for narrow screens; never printed. */
function ClashCards({ rows }: { rows: readonly BriefRow[] }) {
  return (
    <ol className="divide-y divide-border sm:hidden print:hidden">
      {rows.map((row) => (
        <li key={row.rank} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 py-3">
          <span className="type-numeral text-right text-2xl leading-none tabular-nums">
            <span className="sr-only">Clash </span>
            {row.rank}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold leading-snug">
              <span className="min-w-0 break-words">
                {row.a} and {row.b}
              </span>
              {row.hidden ? <HiddenMark /> : null}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {row.stageA} + {row.stageB}
              {row.bothLocked ? (
                <>
                  {" · "}
                  <LockedMark />
                </>
              ) : null}
            </p>
            <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
              <div>
                <dt className="inline text-muted-foreground">Time shared </dt>
                <dd className="inline">
                  {row.window ? `${row.window} · ` : ""}
                  {row.minutes} min
                </dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Taste overlap </dt>
                <dd className="inline">{row.overlap} / 100</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Combined draw </dt>
                <dd className="inline">{row.draw} / 100</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Share of the day&rsquo;s cost </dt>
                <dd className="inline">{row.share}</dd>
              </div>
            </dl>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The one-page sheet itself: the day's Clash Budget Index against the middle 80% of random valid
 * timetables, its costliest clashes (labelled as the published day, before the moves, when moves
 * were kept), its hidden clashes, any kept moves and the moved timetable's own costliest clashes
 * (both from the plan answer), how to read the figures, and where they come from. Every figure is
 * the timetable page's own or the server's, through `lib/brief.ts`.
 */
export function BriefContent({
  preset,
  day,
  plan,
  tradeoff = null,
  lenses = null,
  bare = false,
  className,
}: {
  preset: Preset;
  day: number;
  plan: Plan | null;
  /** The decision card's two changes side by side, when the plan holds one of them. */
  tradeoff?: BriefTradeoff | null;
  /** The day's two rankings, for the candidate-to-keep line under the published day's table; null leaves it out. */
  lenses?: Lenses | null;
  /** Opened with no link: says how a kept move gets here. */
  bare?: boolean;
  className?: string;
}) {
  const { festival, day: dayLabel } = briefTitle(preset, day);
  const figures = dayFigures(preset);
  const band = figures.index === null ? null : bandSentence(figures.index, figures.range);
  const hidden = hiddenSentence(hiddenNames(preset, day));
  const steps = plan && plan.steps.length > 0 ? briefSteps(preset, plan, tradeoff?.moveReceipt ?? null) : [];
  const withMoves = steps.length > 0;
  const twoColumns = steps.length > 3;
  const columns = twoColumns ? 2 : 1;
  // The drawing of the day prints on a sheet with no kept step, and beside the comparison for one single move.
  const figurePrinted = figureOnPaper(steps, columns, tradeoff !== null);
  // A long plan shortens the published-day table to three clashes so the sheet stays on one page.
  const limit = withMoves ? tableClashes(steps, columns, tradeoff !== null) : BRIEF_CLASHES;
  const rows = briefRows(preset, day, limit);
  // A tall plan with the comparison on the sheet has no room for the published day's one-row table on paper:
  // the comparison names the same clash and says what each change leaves of it. It stays on the screen.
  const tableOnPage = !withMoves || tableOnPaper(steps, columns, tradeoff !== null, figurePrinted);
  const tableTitle = clashesTitle(rows.length, withMoves);
  const planLines = plan && withMoves ? planClashLines(plan) : [];
  const verdict = plan && withMoves ? planVerdictSentence(plan, figures.range) : null;
  const synthetic = preset.synthetic === true;
  const hosts = sourceHosts(preset);
  const tableCaption = "brief-clashes-caption";
  // Under the published day's table: the clash taste overlap lowers furthest among the day's costliest on time and
  // draw, as the home page names it, from the same two rankings. The invented day's wording credits no source.
  const fallen = lenses && lenses.day === day ? otherHalfPair(lenses) : null;
  const candidate = fallen ? candidateLine(fallen, synthetic) : null;
  // What the plan does to the timetable's shared minutes, over the published day's ranked clashes and outside them.
  const minutes = plan && withMoves ? sharedMinutes(preset, day, plan) : null;
  // The decision lines are what a full sheet leaves off paper (the screen never shows them). The minutes line, which
  // leads the plan, always prints.
  const paper = onPaper(steps, columns);
  // The day, drawn: as the plan leaves it, or as published; partners only where the sheet names them.
  const figure = briefFigure(preset, day, dayLabel, withMoves ? plan : null, { pair: tradeoff?.pair ?? null, minutes });
  // Under the table, once: whose locks the "both locked" rows are, only when a shown row has the mark.
  const lockLine = briefLockLine(preset, day, rows);

  // What a reading above 100 means runs on after the band sentence, in the same paragraph, and prints on every sheet but
  // one: the card's single move with the comparison and the drawing, the fullest, which has about 12 px of room on a
  // Letter page without it, less than its one 10 pt line (15.3 px). Every other sheet measured has 79 px or more. It
  // stays on the screen there, and the sheet's own "How to read this" still gives the 100 and "lower is better".
  const meaningOnPaper = tradeoff === null;
  // On paper the coverage sentence runs on after the band sentence, in the room its last line leaves.
  const dayBlock = (
    <Block title="The day">
      <p className="print:inline">
        <strong className="font-semibold">{indexSentence(figures.index)}</strong>
        {band ? ` ${band}` : ""}
        {figures.index === null ? null : <span className={meaningOnPaper ? undefined : "print:hidden"}>{` ${INDEX_MEANING}`}</span>}
      </p>{" "}
      <p className="mt-1 print:mt-0 print:inline">{coverageSentence(figures, synthetic)}</p>
    </Block>
  );

  const tableBlock = (
    <Block title={tableTitle} className={tableOnPage ? undefined : "print:hidden"}>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{noPricedClashes(synthetic)}</p>
      ) : (
        <>
          <p id={tableCaption} className="sr-only">
            {clashesCaption(rows.length, withMoves)}
          </p>
          <ClashTable rows={rows} captionId={tableCaption} />
          <ClashCards rows={rows} />
          {lockLine ? (
            <p data-lock-rule className={cn("mt-2 text-sm text-muted-foreground print:mt-[2pt]", PRINT_TEXT)}>
              {lockLine}
            </p>
          ) : null}
          <p
            className={cn(
              lockLine ? "mt-1 text-sm text-muted-foreground print:mt-[1pt]" : "mt-2 text-sm text-muted-foreground print:mt-[2pt]",
              PRINT_TEXT,
            )}
          >
            {HIDDEN_NOTE} {READING_NOTE}
          </p>
          {candidate ? (
            <p data-candidate className={cn("mt-1 text-sm print:mt-[1pt]", PRINT_TEXT)}>
              {candidate}
            </p>
          ) : null}
        </>
      )}
    </Block>
  );

  // On paper the comparison takes the room of the list of hidden clashes, which the table's own marks repeat.
  const hiddenOnPaper = !(tradeoff || (withMoves && heavyPlan(steps, columns)));
  const hiddenBlock = hidden ? (
    <Block title="Hidden clashes" quietInPrint className={hiddenOnPaper ? undefined : "print:hidden"}>
      <p>{hidden}</p>
    </Block>
  ) : null;
  // What the printed page leaves off the published day is said on paper, in one line, so a sheet that fits one page
  // never reads as the whole baseline: the day's costliest clash and the count of the rest, or the count not listed.
  const baseline =
    withMoves && (!tableOnPage || (hidden !== null && !hiddenOnPaper))
      ? baselineNote(preset, day, { rows: tableOnPage ? rows.length : 0, hiddenListed: hiddenOnPaper })
      : null;
  const baselineBlock = baseline ? (
    <p className={cn("mt-2 hidden text-sm text-muted-foreground print:mt-[2pt] print:block", PRINT_TEXT)}>{baseline}</p>
  ) : null;

  const howBlock = (
    <Block title="How to read this">
      <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground print:space-y-0 print:pl-[12pt]">
        {howToRead(synthetic).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p data-do-not-use className={cn("mt-2 font-semibold print:mt-[1pt]", PRINT_TEXT)}>
        {DO_NOT_USE}
      </p>
    </Block>
  );

  // With kept moves the sheet leads with the plan: what it does, then what the day looks like with it,
  // then the line that says what the page cannot weigh, and only then the published day it is read
  // against. Without moves it is the published day, and says that no moves were kept.
  const planBlock =
    plan && withMoves ? (
      <>
        <Block title="Your plan">
          {/* The plan leads with its minutes (round 37, R5): the timetable minutes the published day's ranked clashes
              share before and with the plan, and what it adds outside them, on the screen and on paper; then the
              index line and its band. */}
          {minutes ? (
            <p data-shared-minutes className="mb-1 print:mb-[1pt]">
              {sharedMinutesSentence(minutes)}
            </p>
          ) : null}
          <p className="text-lg leading-snug font-bold print:inline print:text-[10pt] print:leading-[1.15]">{planSummary(plan)}</p>
          {verdict ? (
            <>
              {" "}
              <p className="mt-1 print:mt-0 print:inline">{verdict}</p>
            </>
          ) : null}
          {/* Up to three steps are one column. More are two columns, and on paper they flow down the
              first column and then the second, so a long kept change never stretches a row. */}
          <ol
            className={cn(
              "mt-2 grid gap-x-6 gap-y-2 print:mt-[1pt] print:gap-y-[1pt]",
              twoColumns && "md:grid-cols-2 print:block print:columns-2 print:gap-x-[24px]",
            )}
          >
            {steps.map((step) => {
              // On paper only: beside the step's first line in one column, under the step in two.
              const decision = paper.decisions ? <DecisionMark beside={!twoColumns} /> : null;
              return isBriefRuleStep(step) ? (
                <li key={step.n} className={cn("min-w-0 break-inside-avoid", twoColumns && "print:mb-[2pt]")}>
                  {twoColumns ? null : decision}
                  <span className="font-semibold break-words">
                    <span className="tabular-nums">{step.n}.</span> {step.line}
                  </span>
                  <span className={cn("block text-sm text-muted-foreground", PRINT_TEXT)}>
                    <span className="font-mono tabular-nums">
                      {step.before} → {step.after}
                    </span>
                    {step.raises ? RAISES_MARK : null} · {step.receipt}
                  </span>
                  {twoColumns ? decision : null}
                </li>
              ) : (
                <li key={step.n} className={cn("min-w-0 break-inside-avoid", twoColumns && "print:mb-[2pt]")}>
                  {twoColumns ? null : decision}
                  <span className="font-semibold break-words">
                    <span className="tabular-nums">{step.n}.</span> {step.act} · {step.place}
                  </span>
                  <span className={cn("block text-sm text-muted-foreground", PRINT_TEXT)}>
                    {step.shift} ·{" "}
                    <span className="font-mono tabular-nums">
                      {step.before} → {step.after}
                    </span>
                    {step.raises ? RAISES_MARK : null}
                    {step.receipt ? <> · {step.receipt}</> : null}
                  </span>
                  {twoColumns ? decision : null}
                </li>
              );
            })}
          </ol>
          {tradeoff ? (
            <TradeoffTable
              print
              tradeoff={tradeoff.tradeoff}
              held={tradeoff.held}
              className={cn(
                "mt-4 border-t border-border pt-2 print:mt-[1pt] print:pt-[1pt]",
                TRADEOFF_PRINT,
                // Tested alone, so it sits below the plan's own receipts in lighter type, never as the plan's result.
                tradeoff.alone && "text-[0.9375rem]",
              )}
            />
          ) : null}
          {tradeoff?.pairNote ? (
            <p className={cn("mt-1 text-sm text-muted-foreground print:mt-[1pt]", PRINT_TEXT)}>
              {tradeoff.pairNote}
            </p>
          ) : null}
          <p className={cn("mt-2 text-sm text-muted-foreground print:mt-[1pt]", PRINT_TEXT)}>{PLAN_CAVEAT}</p>
        </Block>

        <Block title={planClashesTitle(planLines.length)}>
          {planLines.length === 0 ? (
            <p className="text-muted-foreground">None scored.</p>
          ) : (
            <ol
              className={cn(
                "grid gap-x-6 gap-y-1 print:flex print:flex-wrap print:gap-x-[14pt] print:gap-y-0",
                planLines.length > 2 && "md:grid-cols-2",
              )}
            >
              {planLines.map((line) => (
                <li key={line} className="min-w-0 break-words">
                  {line}
                </li>
              ))}
            </ol>
          )}
        </Block>

        <p className="mt-5 font-semibold print:mt-[3pt]">
          {TO_DECIDE} {TEAMS_AGREE}
        </p>
      </>
    ) : (
      <Block title="Tested moves">
        <p className="text-muted-foreground">{bare ? BARE_NO_MOVES : NO_MOVES}</p>
      </Block>
    );

  return (
    <article
      aria-labelledby="brief-heading"
      className={cn(
        "rounded-lg border border-surface-edge bg-card p-5 text-[0.9375rem] leading-relaxed sm:p-8 lg:p-10",
        "print:rounded-none print:border-0 print:bg-transparent print:p-0 print:text-[10pt] print:leading-[1.15]",
        className,
      )}
    >
      <p className="type-kicker text-muted-foreground print:text-[10pt] print:leading-[1.15]">
        Clash brief · {festival}, {dayLabel}
      </p>
      <h1
        id="brief-heading"
        className="type-title mt-2 text-[1.625rem] break-words sm:text-[2.125rem] print:mt-[2pt] print:text-[16pt]"
      >
        {festival} {dayLabel}: {BRIEF_HEADING_TAIL}
      </h1>
      <p className="mt-2 text-muted-foreground print:mt-[2pt]">{briefIntro(festival, synthetic)}</p>
      {figure ? (
        <BriefDayFigure figure={figure} className={cn("mt-5 print:mt-[2pt]", FIGURE_PRINT, !figurePrinted && "print:hidden")} />
      ) : null}

      {withMoves ? (
        <>
          {planBlock}
          {dayBlock}
          {tableBlock}
          {baselineBlock}
          {hiddenBlock}
        </>
      ) : (
        <>
          {dayBlock}
          {tableBlock}
          {hiddenBlock}
          {planBlock}
        </>
      )}
      {howBlock}

      <div className={cn("mt-8 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground print:mt-[3pt] print:pt-[2pt]", PRINT_TEXT)}>
        <p>{figuresAttribution(preset, festival)}</p>
        {hosts.length > 0 ? <p className="mt-1 print:mt-0">Timetable sources: {hosts.join(", ")}.</p> : null}
      </div>
      {/* Sign-off: who prepared the sheet and who reviewed it, on paper and on screen. Each label is followed by a
          line to write on, a 1px rule in the control-edge ink (a mark, never text). */}
      <dl
        data-sign-off
        className={cn("mt-6 flex flex-wrap gap-x-8 gap-y-4 text-sm print:mt-[4pt] print:gap-x-[14pt]", PRINT_TEXT)}
      >
        {SIGN_OFF.map((label) => (
          // On a phone each label takes its own row and its line runs to the edge; from 640px and on paper the three
          // share a row, each line a fixed length.
          <div key={label} className="flex w-full min-w-0 items-end gap-2 sm:w-auto print:w-auto">
            <dt className="font-semibold sm:whitespace-nowrap">{label}</dt>
            <dd
              aria-label="blank, to fill in"
              className={cn(
                "h-5 min-w-16 flex-1 border-b border-border-strong sm:flex-none print:h-[12pt] print:flex-none",
                label === "Date" ? "sm:w-24 print:w-[52pt]" : "sm:w-36 print:w-[80pt]",
              )}
            />
          </div>
        ))}
      </dl>
    </article>
  );
}
