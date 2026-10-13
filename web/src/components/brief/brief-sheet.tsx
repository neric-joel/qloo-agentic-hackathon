"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, LoaderCircle, Lock, Printer } from "lucide-react";

import { DiamondGlyph } from "@/components/clash/marks";
import { TradeoffTable } from "@/components/clash/tradeoff-table";
import { Button } from "@/components/ui/button";
import {
  BRIEF_CLASHES,
  HIDDEN_NOTE,
  NO_MOVES,
  READING_NOTE,
  TO_DECIDE,
  bandSentence,
  briefIntro,
  briefRows,
  baselineNote,
  briefSteps,
  briefTitle,
  briefTradeoff,
  clashesTitle,
  coverageSentence,
  dayFigures,
  figuresAttribution,
  hiddenNames,
  hiddenSentence,
  howToRead,
  indexSentence,
  noPricedClashes,
  isBriefRuleStep,
  planClashLines,
  planClashesTitle,
  planSummary,
  planVerdictSentence,
  sourceHosts,
  heavyPlan,
  tableClashes,
  tableOnPaper,
  type BriefRow,
  type BriefTradeoff,
} from "@/lib/brief";
import { daysWithSets } from "@/lib/clashes";
import { requestDecision, type Decision } from "@/lib/decision";
import { MOCK_PRESET_ID, mockPreset } from "@/lib/mock-preset";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";
import { PLAN_CAVEAT, RAISES_MARK } from "@/lib/plan-copy";
import { parsePreset, type Preset } from "@/lib/preset";
import { decodeMoves, encodeMoves, fetchPlan, isSafeId, type Plan, type StackStep } from "@/lib/stack";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------------------------ loading

type Outcome =
  | { status: "ready"; preset: Preset; plan: Plan | null; decision: Decision | null }
  | { status: "missing" }
  | { status: "error" };

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
  const response = await fetch(`/api/presets/${encodeURIComponent(id)}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) throw new NotFound();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parsePreset(await response.json());
}

/**
 * The preset and, only when the link carries kept moves, their plan, priced by the server, and the day's
 * decision (for the card's side-by-side comparison). The decision never fails the brief: an older server, a
 * failed request or mock mode leaves it null, and the brief prints without the comparison.
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
    return { status: "ready", preset, plan, decision };
  } catch (error) {
    return error instanceof NotFound ? { status: "missing" } : { status: "error" };
  }
}

/** Loads the brief's data once per preset and plan; a malformed preset id never reaches the network. */
function useBrief(
  presetId: string | null,
  dayText: string | null,
  moves: readonly StackStep[],
): Outcome | { status: "loading" } {
  const key = `${presetId ?? ""}|${dayText ?? ""}|${encodeMoves(moves)}`;
  const safe = isSafeId(presetId);
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  useEffect(() => {
    if (!safe || presetId === null) return;
    const controller = new AbortController();
    loadBrief(presetId, dayText, moves, controller.signal).then((outcome) => {
      if (!controller.signal.aborted) setResult({ key, outcome });
    });
    return () => controller.abort();
  }, [safe, presetId, dayText, moves, key]);

  if (!safe) return { status: "missing" };
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

/** Loading, error and unknown-link states: one short line and the way back. */
function Notice({ children, href, busy = false }: { children: ReactNode; href: string; busy?: boolean }) {
  return (
    <div className="container-page max-w-[60rem] pt-8 pb-12">
      <p className="type-kicker text-muted-foreground">Clash brief</p>
      <p
        role={busy ? "status" : "alert"}
        className="mt-2 flex max-w-prose items-center gap-2 text-lg leading-snug font-semibold sm:text-xl"
      >
        {busy ? <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" /> : null}
        {children}
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
  const state = useBrief(presetId, dayText, moves);
  const back = backHref(presetId);

  if (state.status === "loading") {
    return (
      <Notice href={back} busy>
        Loading the brief.
      </Notice>
    );
  }
  if (state.status === "error") return <Notice href={back}>Could not load this brief.</Notice>;
  if (state.status === "missing") {
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
        className="mt-4 print:mt-0"
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------ the sheet

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
  return (
    <section aria-labelledby={id} className={cn("mt-7 break-inside-avoid print:mt-[3pt]", className)}>
      <h2
        id={id}
        className={cn(
          "type-kicker pb-1.5 print:pb-[1pt] print:text-[10pt]",
          quietInPrint && "print:sr-only",
        )}
      >
        {title}
      </h2>
      <div className="mt-3 print:mt-[3pt]">{children}</div>
    </section>
  );
}

function HiddenMark() {
  return (
    <span className="tag text-foreground print:px-[3pt] print:text-[9pt]">
      <DiamondGlyph className="size-2" />
      Hidden
    </span>
  );
}

function LockedMark() {
  return (
    <span className="inline-flex items-center gap-1 font-semibold whitespace-nowrap text-foreground">
      <Lock aria-hidden="true" className="size-3 print:size-[9pt]" />
      both locked
    </span>
  );
}

const TH = "px-2 py-2 font-semibold align-bottom print:px-[2pt] print:py-[2pt]";
const TD = "px-2 py-2 align-top print:px-[2pt] print:py-[1pt]";

/** The costliest clashes as a table (wide screens and print). */
function ClashTable({ rows, captionId }: { rows: readonly BriefRow[]; captionId: string }) {
  return (
    <table
      aria-labelledby={captionId}
      className="hidden w-full border-collapse text-left text-sm sm:table print:table print:text-[9pt] print:leading-[1.25]"
    >
      <thead>
        <tr className="border-b border-border-strong text-xs print:text-[9pt]">
          <th scope="col" className={cn(TH, "w-8 text-right")}>
            #
          </th>
          <th scope="col" className={TH}>
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
              <span className="block text-xs text-muted-foreground print:text-[9pt]">
                {row.stageA} + {row.stageB}
                {row.bothLocked ? (
                  <>
                    {" · "}
                    <LockedMark />
                  </>
                ) : null}
              </span>
            </td>
            <td className={cn(TD, "font-mono text-xs whitespace-nowrap tabular-nums print:text-[9pt]")}>
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
  className,
}: {
  preset: Preset;
  day: number;
  plan: Plan | null;
  /** The decision card's two changes side by side, when the plan holds one of them. */
  tradeoff?: BriefTradeoff | null;
  className?: string;
}) {
  const { festival, day: dayLabel } = briefTitle(preset, day);
  const figures = dayFigures(preset);
  const band = figures.index === null ? null : bandSentence(figures.index, figures.range);
  const hidden = hiddenSentence(hiddenNames(preset, day));
  const steps = plan && plan.steps.length > 0 ? briefSteps(preset, plan, tradeoff?.moveReceipt ?? null) : [];
  const withMoves = steps.length > 0;
  const twoColumns = steps.length > 3;
  // A long plan shortens the published-day table to three clashes so the sheet stays on one page.
  const limit = withMoves ? tableClashes(steps, twoColumns ? 2 : 1, tradeoff !== null) : BRIEF_CLASHES;
  const rows = briefRows(preset, day, limit);
  // A tall plan with the comparison on the sheet has no room for the published day's one-row table on paper:
  // the comparison names the same clash and says what each change leaves of it. It stays on the screen.
  const tableOnPage = !withMoves || tableOnPaper(steps, twoColumns ? 2 : 1, tradeoff !== null);
  const tableTitle = clashesTitle(rows.length, withMoves);
  const planLines = plan && withMoves ? planClashLines(plan) : [];
  const verdict = plan && withMoves ? planVerdictSentence(plan, figures.range) : null;
  const synthetic = preset.synthetic === true;
  const hosts = sourceHosts(preset);
  const tableCaption = "brief-clashes-caption";

  const dayBlock = (
    <Block title="The day">
      <p>
        <strong className="font-semibold">{indexSentence(figures.index)}</strong>
        {band ? ` ${band}` : ""}
      </p>
      <p className="mt-1 print:mt-[2pt]">{coverageSentence(figures, synthetic)}</p>
    </Block>
  );

  const tableBlock = (
    <Block title={tableTitle} className={tableOnPage ? undefined : "print:hidden"}>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{noPricedClashes(synthetic)}</p>
      ) : (
        <>
          <p id={tableCaption} className="sr-only">
            {withMoves ? `${tableTitle}, costliest first` : `${tableTitle} on this day, costliest first`}
          </p>
          <ClashTable rows={rows} captionId={tableCaption} />
          <ClashCards rows={rows} />
          <p className="mt-2 text-sm text-muted-foreground print:mt-[3pt] print:text-[9pt]">
            {HIDDEN_NOTE} {READING_NOTE}
          </p>
        </>
      )}
    </Block>
  );

  // On paper the comparison takes the room of the list of hidden clashes, which the table's own marks repeat.
  const hiddenOnPaper = !(tradeoff || (withMoves && heavyPlan(steps, twoColumns ? 2 : 1)));
  const hiddenBlock = hidden ? (
    <Block title="Hidden clashes" quietInPrint className={hiddenOnPaper ? undefined : "print:hidden"}>
      <p className="print:text-[9pt]">{hidden}</p>
    </Block>
  ) : null;
  // What the printed page leaves off the published day is said on paper, in one line, so a sheet that fits one page
  // never reads as the whole baseline: the day's costliest clash and the count of the rest, or the count not listed.
  const baseline =
    withMoves && (!tableOnPage || (hidden !== null && !hiddenOnPaper))
      ? baselineNote(preset, day, { rows: tableOnPage ? rows.length : 0, hiddenListed: hiddenOnPaper })
      : null;
  const baselineBlock = baseline ? (
    <p className="mt-2 hidden text-sm text-muted-foreground print:mt-[3pt] print:block print:text-[9pt]">{baseline}</p>
  ) : null;

  const howBlock = (
    <Block title="How to read this">
      <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground print:space-y-[1pt] print:pl-[12pt] print:text-[9pt]">
        {howToRead(synthetic).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Block>
  );

  // With kept moves the sheet leads with the plan: what it does, then what the day looks like with it,
  // then the line that says what the page cannot weigh, and only then the published day it is read
  // against. Without moves it is the published day, and says that no moves were kept.
  const planBlock =
    plan && withMoves ? (
      <>
        <Block title="Your plan">
          <p className="text-lg leading-snug font-bold print:inline print:text-[10pt]">{planSummary(plan)}</p>
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
              "mt-2 grid gap-x-6 gap-y-2 print:mt-[2pt] print:gap-y-[2pt]",
              twoColumns && "md:grid-cols-2 print:block print:columns-2 print:gap-x-[24px]",
            )}
          >
            {steps.map((step) =>
              isBriefRuleStep(step) ? (
                <li key={step.n} className={cn("min-w-0 break-inside-avoid", twoColumns && "print:mb-[2pt]")}>
                  <span className="font-semibold break-words print:text-[9pt]">
                    <span className="tabular-nums">{step.n}.</span> {step.line}
                  </span>
                  <span className="block text-sm text-muted-foreground print:text-[9pt]">
                    <span className="font-mono tabular-nums">
                      {step.before} → {step.after}
                    </span>
                    {step.raises ? RAISES_MARK : null} · {step.receipt}
                  </span>
                </li>
              ) : (
                <li key={step.n} className={cn("min-w-0 break-inside-avoid", twoColumns && "print:mb-[2pt]")}>
                  <span className="font-semibold break-words print:text-[9pt]">
                    <span className="tabular-nums">{step.n}.</span> {step.act} · {step.place}
                  </span>
                  <span className="block text-sm text-muted-foreground print:text-[9pt]">
                    {step.shift} ·{" "}
                    <span className="font-mono tabular-nums">
                      {step.before} → {step.after}
                    </span>
                    {step.raises ? RAISES_MARK : null}
                    {step.receipt ? <> · {step.receipt}</> : null}
                  </span>
                </li>
              ),
            )}
          </ol>
          {tradeoff ? (
            <TradeoffTable
              print
              tradeoff={tradeoff.tradeoff}
              held={tradeoff.held}
              className={cn(
                "mt-4 border-t border-border pt-2 print:mt-[3pt] print:pt-[2pt]",
                // Tested alone, so it sits below the plan's own receipts in lighter type, never as the plan's result.
                tradeoff.alone && "text-[0.9375rem]",
              )}
            />
          ) : null}
          {tradeoff?.pairNote ? (
            <p className="mt-1 text-sm text-muted-foreground print:mt-[1pt] print:text-[9pt] print:leading-[1.15]">
              {tradeoff.pairNote}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground print:mt-[4pt] print:text-[9pt]">{PLAN_CAVEAT}</p>
        </Block>

        <Block title={planClashesTitle(planLines.length)}>
          {planLines.length === 0 ? (
            <p className="text-muted-foreground">None priced.</p>
          ) : (
            <ol
              className={cn(
                "grid gap-x-6 gap-y-1 print:flex print:flex-wrap print:gap-x-[14pt] print:gap-y-[1pt] print:text-[9pt]",
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

        <p className="mt-5 font-semibold print:mt-[4pt]">{TO_DECIDE}</p>
      </>
    ) : (
      <Block title="Tested moves">
        <p className="text-muted-foreground">{NO_MOVES}</p>
      </Block>
    );

  return (
    <article
      aria-labelledby="brief-heading"
      className={cn(
        "rounded-lg border border-surface-edge bg-card p-5 text-[0.9375rem] leading-relaxed sm:p-8 lg:p-10",
        "print:rounded-none print:border-0 print:bg-transparent print:p-0 print:text-[9pt] print:leading-[1.17]",
        className,
      )}
    >
      <p className="type-kicker text-muted-foreground print:text-[9pt]">
        Clash brief · {festival}, {dayLabel}
      </p>
      <h1
        id="brief-heading"
        className="type-title mt-2 text-[1.625rem] break-words sm:text-[2.125rem] print:mt-[2pt] print:text-[16pt]"
      >
        {festival} {dayLabel}: where the clash budget goes
      </h1>
      <p className="mt-2 text-muted-foreground print:mt-[3pt]">{briefIntro(festival, synthetic)}</p>

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

      <div className="mt-8 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground print:mt-[6pt] print:pt-[3pt] print:text-[9pt] print:leading-[1.25]">
        <p>{figuresAttribution(preset, festival)}</p>
        {hosts.length > 0 ? <p className="mt-1 print:mt-0">Timetable sources: {hosts.join(", ")}.</p> : null}
      </div>
    </article>
  );
}
