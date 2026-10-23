"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ArrowRight, Check, CornerDownLeft, History, LoaderCircle, RotateCcw, SkipForward, X } from "lucide-react";

import { ErrorState, MockBadge, ProvenanceChip, TraceDrawer, useAgentRun } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import {
  MAX_MESSAGE_CHARS,
  budgetDelta,
  buildClashBody,
  changeLabel,
  humanizeProblem,
  latestSession,
  readClashReply,
  suggestedPrompts,
  textBlocks,
  type ClashExplain,
  type ClashReply,
  type Exchange,
  type InlineSegment,
  type MoveOptions,
  type ReslotSuggestion,
  type WhatIf,
} from "@/lib/agent-session";
import { panelMode, type AgentStatus } from "@/lib/agent-status";
import { formatOverlap } from "@/lib/clashes";
import { agentDataLine, explainPrompt, usedTitle } from "@/lib/credit";
import { isRecord } from "@/lib/events";
import { formatLatency, humanizeIdentifier, pluralize } from "@/lib/format";
import { clockMinutes, fromRecordedRun } from "@/lib/moves";
import type { Festival, Preset } from "@/lib/preset";
import { askedQlooWhenRecorded, orderRecordings, replayFinalState, savedRequests, type RecordedRun } from "@/lib/recorded-run";
import type { RunResult, RunState, ToolCallState } from "@/lib/run-state";
import {
  checkAdd,
  encodeMoves,
  isRuleStackStep,
  keepNote,
  keptWord,
  sameStep,
  type AddCheck,
  type PlanAnswer,
  type StackMove,
  type StackStep,
} from "@/lib/stack";
import { formatClock } from "@/lib/timetable";
import { cn } from "@/lib/utils";

import { scaleRange, signedDelta, type ScaleRange } from "./budget-move";
import { IndexChange, KEEP_MOVE } from "./decision-card";
import { RecordedNotice, RecordedRuns, recordedQlooCalls } from "./recorded-runs";
import { AgentSkeleton, useHeldRoom } from "./skeletons";
import type { SeedMode } from "./try-a-move";
import { checkPlan } from "./use-moves";
import { useOtherDaysRecordings, useRecordings } from "./use-recordings";

const TOOL_LABELS: Record<string, string> = {
  list_timetable: "Read the timetable",
  clash_report: "Scored the day",
  explain_clash: "Explained a clash",
  find_moves: "Found legal places",
  try_move: "Tested a move",
  add_constraint: "Added a rule",
  reslot: "Suggested moves",
};

/** What the agent can do, in the present tense; the tool trail keeps the past-tense labels above. */
const CAPABILITIES: { tool: string; title: string; text: string }[] = [
  {
    tool: "explain_clash",
    title: "Explain a clash",
    text: "Explain why two sets clash, with the taste Qloo finds both audiences share.",
  },
  {
    tool: "find_moves",
    title: "Find legal places",
    text: "Check every start on a 5-minute grid and list the legal places a set could move to, each one scored.",
  },
  {
    tool: "try_move",
    title: "Test a move",
    text: "Test a move you name against the rules and score it, without changing anything.",
  },
  {
    tool: "add_constraint",
    title: "Record a rule",
    text: "Record your rules: keep a set in place, keep two acts apart, stage hours.",
  },
  {
    tool: "reslot",
    title: "Suggest moves",
    text: "Suggest moves when you ask, graded by the same measure.",
  },
];

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? humanizeIdentifier(tool);
}

/**
 * What the agent can and cannot do, one line each, every line read from the backend (cited per line). The
 * Qloo cap names Qloo, so the invented day, which made no Qloo request, gets a line without it.
 */
export function agentLimits(synthetic = false): string[] {
  return [
    // backend/app/agent/clash_tools.py:281 (try_move) and :755-758 (find_moves -> compute_move_options, the
    // function behind this page's /moves and /whatif, backend/app/whatif.py:157 and :383): every move, price
    // and Clash Budget in the agent's result cards is a tool result from that engine, not model text.
    "It calls the same timetable engine as this page, and every figure in its result cards comes from that engine.",
    // backend/app/agent/loop.py:41-43 streams the model's own text; the panel labels it with the LLM chip.
    "Its answer in words is written by a language model and labelled as such.",
    // backend/app/agent/clash_tools.py:358-369 and :789-797: try_move and find_moves do not change the
    // timetable; only Keep this move below (`KEEP_MOVE`, the hero's own label) hands a tested place to your plan.
    `It can test a move, but it never changes your timetable unless you press ${KEEP_MOVE}.`,
    // backend/app/agent/clash_tools.py:1003 (CLASH_TOOLS): its seven tools read and test the timetable;
    // none sends a message or publishes anything.
    "It never contacts anyone or publishes anything.",
    // backend/app/config.py:29-33: agent_max_qloo_calls_per_run = 12 (the run refuses further Qloo-backed
    // tools, backend/app/agent/tools.py:78-89) and agent_max_turns = 6 (backend/app/main.py:160), the agent
    // loop's turns.
    synthetic ? "At most 6 agent turns per run." : "At most 12 Qloo requests and 6 agent turns per run.",
  ];
}

/**
 * The one line under the run list about the recordings' Qloo use, read from the recordings: that they send no
 * new Qloo request when every listed run's saved count is 0, else null (each run then says its own count on its
 * row). The engine they test moves with scores with the day's saved Qloo reading (backend/app/runs.py:122-125,
 * `published_state`, puts the preset's matrix into the run's state; backend/app/agent/clash_tools.py:45 reads it,
 * :164 scores the day with it, and try_move :301/:315 and find_moves :471 score each place with it). Never on
 * the invented day.
 */
export function recordingsQlooLine(runs: readonly RecordedRun[], synthetic = false): string | null {
  if (synthetic || runs.length === 0 || runs.some((run) => recordedQlooCalls(run) !== 0)) return null;
  return runs.length === 1
    ? "This run sends no new Qloo request; it tests moves with this day’s saved reading."
    : "These runs send no new Qloo request; they test moves with this day’s saved reading.";
}

/** A published festival day, as the page's day list names it. */
export type PublishedDay = { id: string; title: string };

/**
 * Whether the shown day may point to another day's run that asked Qloo: a published day (one the page's day list
 * names, never the invented one) whose recorded runs are loaded and hold no Qloo request record at all, so its
 * runs line says they send no new Qloo request. Only then is another day's recordings asked for.
 */
export function mayPointElsewhere(
  presetId: string,
  synthetic: boolean,
  publishedDays: readonly PublishedDay[],
  runs: readonly RecordedRun[],
): boolean {
  if (synthetic || !publishedDays.some((day) => day.id === presetId)) return false;
  if (recordingsQlooLine(runs) === null) return false;
  return runs.every((run) => savedRequests(run).length === 0);
}

/**
 * The other published day the pointer names: the first, in the page's day list, whose loaded recordings hold a
 * run with at least one request that reached Qloo live while it was recorded (`askedQlooWhenRecorded`, read from
 * the saved events; a cached, fixture-served or unstated request never counts). Null when none does.
 */
export function pointerDay(
  publishedDays: readonly PublishedDay[],
  shownId: string,
  loaded: ReadonlyMap<string, readonly RecordedRun[]>,
): PublishedDay | null {
  for (const day of publishedDays) {
    if (day.id === shownId) continue;
    if ((loaded.get(day.id) ?? []).some(askedQlooWhenRecorded)) return day;
  }
  return null;
}

/** The pointer's sentence after the runs line: "A run on Riot Fest 2026, Sunday asked Qloo while it was recorded." */
export function askedElsewhereSentence(title: string): string {
  return `A run on ${title} asked Qloo while it was recorded.`;
}

/** The pointer's one control, which opens that day's agent section. */
export const SEE_THAT_RUN = "See that run";

/** Where "See that run" goes: the named day, at its agent section. */
export function agentSectionHref(presetId: string): string {
  return `/?preset=${encodeURIComponent(presetId)}#agent`;
}

/**
 * The runs line as it reads with the pointer: the recordings' own sentence unchanged, then the pointer's
 * ("These runs send no new Qloo request; they test moves with this day’s saved reading. A run on Riot Fest 2026,
 * Sunday asked Qloo while it was recorded."); "See that run" follows it. The runs line alone without a pointer.
 */
export function pointerLine(runsLine: string, pointer: PublishedDay | null): string {
  return pointer ? `${runsLine} ${askedElsewhereSentence(pointer.title)}` : runsLine;
}

/** No published days passed: no pointer. */
const NO_DAYS: readonly PublishedDay[] = [];

/** The day "See that run" opened, so its agent section is brought into view once that day is on screen. */
let openedFromPointer: string | null = null;
/** Whether this page load's address asked for the agent section (`#agent`) has been answered. */
let initialHashAnswered = false;

/** The trace trigger of a recorded run: its Qloo request count is the label, read from the recording. */
export function requestsLabel(count: number): string {
  return `Qloo requests in this run: ${count}`;
}

/** The label of a recorded run that sent no Qloo request. */
export const ZERO_REQUESTS_LABEL = requestsLabel(0);

/**
 * Under a recorded run that sent no Qloo request and scored every place it tested: where the taste in those
 * scores came from. The run's state holds the preset's saved matrix (backend/app/runs.py:122-125,
 * `published_state`), every tool reads it from there (backend/app/agent/clash_tools.py:45, `_state`) and
 * scores with it (:164, `score_festival(festival, matrix, config)`; try_move :301/:315, find_moves :471).
 */
export const SAVED_READING_LINE =
  "Every place it tested was scored with this day’s saved Qloo reading (taste overlap and popularity); it sent no new request.";

/**
 * True when a run's tool results priced at least one place and every place it tested was priced: an allowed
 * try_move, a find_moves list with places, or suggested moves, and no move the rules refused (a refused move
 * is not priced, so "every place it tested was scored" would not hold).
 */
export function pricedEveryPlace(reply: Pick<ClashReply, "whatIfs" | "moveOptions" | "reslots"> | null): boolean {
  if (!reply) return false;
  const priced =
    reply.whatIfs.some((whatIf) => whatIf.allowed) ||
    reply.moveOptions.some((options) => options.movable && options.options.length > 0) ||
    reply.reslots.some((reslot) => reslot.moves.length > 0);
  return priced && reply.whatIfs.every((whatIf) => whatIf.allowed);
}

/**
 * What a recorded run's trace says about Qloo, read from that recording at render time: the trigger is "Qloo
 * requests in this run: N" on every published day, N from the recording, and the saved-reading line shows only
 * when N is 0 and the run scored every place it tested. A live run and the invented day get neither (the
 * invented day credits no Qloo).
 */
export function recordedQloo(
  recording: RecordedRun | undefined,
  reply: Pick<ClashReply, "whatIfs" | "moveOptions" | "reslots"> | null,
  synthetic = false,
): { label: string | null; savedReading: boolean } {
  if (!recording || synthetic) return { label: null, savedReading: false };
  const calls = recordedQlooCalls(recording);
  return { label: requestsLabel(calls), savedReading: calls === 0 && pricedEveryPlace(reply) };
}

/**
 * The trace line a replayed run shows in its header, directly under its question: "Qloo requests in this run: N",
 * N read from the recording, so its words are known (and its room kept) from the replay's first beat. Null for a
 * live run and on the invented day, whose trace stays at the run's foot.
 */
export function headerTraceLabel(recording: RecordedRun | undefined, synthetic = false): string | null {
  return recording && !synthetic ? requestsLabel(recordedQlooCalls(recording)) : null;
}

/** The trace drawer of a run's answer, as its header line (a replay) or at its foot (a live run). */
function RunTrace({
  state,
  recorded,
  synthetic,
  label,
  countInLabel = false,
  savedReading,
  triggerVariant,
  triggerClassName,
}: {
  state: RunState;
  recorded: boolean;
  synthetic: boolean;
  label: string;
  countInLabel?: boolean;
  savedReading: boolean;
  triggerVariant: "ghost" | "ruled";
  triggerClassName: string;
}) {
  const qlooCalls = state.summary?.qlooCalls ?? state.toolCalls.reduce((sum, call) => sum + call.requests.length, 0);
  return (
    <TraceDrawer
      toolCalls={state.toolCalls}
      runId={state.runId}
      mode={state.mode}
      qlooCalls={qlooCalls}
      triggerVariant={triggerVariant}
      triggerClassName={triggerClassName}
      triggerLabel={label}
      countInLabel={countInLabel}
      title={usedTitle(synthetic)}
      synthetic={synthetic}
      savedReading={savedReading}
      description={
        recorded
          ? "The Qloo requests this run made when it was recorded. They are listed from the saved stream; none were made just now."
          : "The Qloo requests this answer made. Scores and what-ifs reuse the day's saved Qloo data; explaining a clash asks Qloo live for the taste both audiences share."
      }
    />
  );
}

/**
 * Under a run whose tested place moves another set than the move at the top of the page (internally the decision
 * card's): why their index changes differ. That move works on the day's costliest clash a move can lower
 * (backend/app/decision.py:1-4); a run looks for a place that lowers the index for the set it was asked about.
 * Null when the run tested no place, or the same set.
 */
export function runVersusCard(place: Pick<AgentPlace, "act" | "move"> | null, cardActId: string | null): string | null {
  if (!place || !cardActId || place.move.actId === cardActId) return null;
  return `This run looked for a place for ${place.act} that lowers the index; the move at the top of the page works on the day’s costliest clash that a move can lower, so their index changes differ.`;
}

/** A place an agent run tested and the engine found legal, as the plan keeps it, with what to print. */
export type AgentPlace = {
  move: StackMove;
  act: string;
  stage: string;
  start: string;
  end: string | null;
  /** The Clash Budget Index before and after, as the tool reported them. */
  before: number | null;
  after: number | null;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The last place a finished run's own tool results show the timetable engine marked legal, on this
 * festival day: a `try_move` whose result is `allowed`, or the first (lowest-index) place a `find_moves`
 * result lists. Read only from the run's `tool_data` (the engine's results, in call order), never from
 * the model's text. Null when there is none, when its set is locked or not on this day, when the stage
 * does not read, or when the place is where the set already plays. A live run and a replayed one stream
 * the same events, so both read the same way.
 */
export function keepableMove(results: readonly RunResult[], festival: Festival, day: number): AgentPlace | null {
  const result = results.find((item) => item.kind === "clash");
  if (!result || !isRecord(result.data) || !isRecord(result.data.tool_data)) return null;
  const byName = [...festival.acts].sort((a, b) => b.name.length - a.name.length);
  const stageNamed = (name: string) =>
    festival.stages.find((stage) => stage.name === name) ??
    festival.stages.find((stage) => stage.name.toLowerCase() === name.trim().toLowerCase()) ??
    null;
  let found: AgentPlace | null = null;
  for (const item of Object.values(result.data.tool_data)) {
    if (!isRecord(item)) continue;
    let actId: string | null = null;
    let stageName: string | null = null;
    let start: string | null = null;
    let before: number | null = null;
    let after: number | null = null;
    let anyDay = true;
    if (item.kind === "what_if" && item.allowed === true && typeof item.move === "string") {
      // "Act: Stage 14:00-15:00 -> Stage 14:15-15:15", the engine's own line; try_move keeps the set's day.
      const move = item.move;
      const act = byName.find((candidate) => move.startsWith(`${candidate.name}: `));
      const to = /->\s*(.+?)\s+(\d{1,2}:\d{2})-\d{1,2}:\d{2}\s*$/.exec(move);
      if (!act || !to) continue;
      actId = act.id;
      stageName = to[1];
      start = to[2];
      before = finite(item.clash_budget_before);
      after = finite(item.clash_budget_after);
    } else if (item.kind === "move_options" && item.movable !== false && Array.isArray(item.options)) {
      const first = item.options.find(isRecord);
      const act = festival.acts.find((candidate) => candidate.name === item.act);
      if (!first || !act || typeof first.stage !== "string" || typeof first.start !== "string") continue;
      actId = act.id;
      stageName = first.stage;
      start = first.start;
      before = finite(item.clash_budget_before);
      after = finite(first.clash_budget_after);
      // find_moves may list another day's place without naming the day, so only a one-day festival reads it.
      anyDay = false;
    } else {
      continue;
    }
    const slot = festival.timetable.find((candidate) => candidate.act_id === actId);
    const stage = stageNamed(stageName);
    const minutes = clockMinutes(start);
    if (!slot || !stage || minutes === null || slot.locked || slot.day !== day) continue;
    if (!anyDay && festival.days.length > 1) continue;
    if (stage.id === slot.stage_id && minutes === slot.start) continue;
    found = {
      move: { actId: slot.act_id, stageId: stage.id, day: slot.day, start: formatClock(minutes) },
      act: festival.acts.find((candidate) => candidate.id === slot.act_id)?.name ?? slot.act_id,
      stage: stage.name,
      start: formatClock(minutes),
      end: formatClock(minutes + (slot.end - slot.start)),
      before,
      after,
    };
  }
  return found;
}

function Inline({ segments }: { segments: readonly InlineSegment[] }) {
  return segments.map((segment, index) =>
    segment.strong ? (
      <strong key={index} className="font-semibold">
        {segment.text}
      </strong>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  );
}

function AgentText({ text }: { text: string }) {
  const blocks = useMemo(() => textBlocks(text), [text]);
  return (
    <div className="space-y-3 text-[0.9375rem] leading-relaxed">
      {blocks.map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index}>
            <Inline segments={block.segments} />
          </p>
        ) : block.ordered ? (
          <ol key={index} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, i) => (
              <li key={i}>
                <Inline segments={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={index} className="list-disc space-y-1 pl-5">
            {block.items.map((item, i) => (
              <li key={i}>
                <Inline segments={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

/**
 * What the agent did, one line per tool call, so the answer can be checked against its steps. M10: the
 * exchange's left rule fills beside the steps one step at a time as each finishes, so it follows the
 * stream (live or replayed) rather than a timer.
 *
 * `reserve` (a replay): the run's steps as it ends. Every step's line is laid out from the first beat, at its
 * final size, and shown in place when its step arrives (a step not there yet keeps its place, hidden; a running
 * step keeps its summary's room), so nothing under the steps moves while the replay plays. `still` (a run shown
 * before anything is pressed, or a measure of one): the rail is drawn full with no transition, so nothing moves
 * on first paint.
 */
function ToolTrail({
  calls,
  reserve,
  still = false,
  waiting = null,
}: {
  calls: readonly ToolCallState[];
  reserve?: readonly ToolCallState[];
  still?: boolean;
  /** While a replay waits for its next step: what it is doing, said in that step's place until the step arrives. */
  waiting?: string | null;
}) {
  const rows = useMemo(() => {
    if (!reserve) return calls.map((call) => ({ call, final: undefined as ToolCallState | undefined }));
    const live = new Map(calls.map((call) => [call.id, call]));
    const planned = new Set(reserve.map((final) => final.id));
    return [
      ...reserve.map((final) => ({ call: live.get(final.id), final })),
      ...calls.filter((call) => !planned.has(call.id)).map((call) => ({ call, final: undefined })),
    ];
  }, [calls, reserve]);
  if (rows.length === 0) return null;
  const arrived = rows.filter((row) => row.call !== undefined).length;
  const next = rows.findIndex((row) => row.call === undefined);
  return (
    <ol aria-label="What the agent did" className="space-y-1.5">
      {rows.map(({ call, final }, i) => {
        // A step not there yet keeps its final line, hidden: the same words, so the same size.
        const view = (call ?? final) as ToolCallState;
        const pending = call === undefined;
        const summary = view.summary ?? null;
        const roomFor = !summary && final?.summary ? final.summary : null;
        return (
          <li
            key={view.id}
            className={cn("relative flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm", pending && "invisible")}
          >
            {pending && i === next && waiting ? (
              // Shown over the next step's hidden line, so it takes no room of its own and nothing moves when it goes.
              <span aria-hidden="true" className="visible absolute inset-x-0 top-0 flex h-5 items-center gap-2 text-muted-foreground">
                <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" />
                {waiting}
              </span>
            ) : null}
            <span
              aria-hidden="true"
              data-done={still || (!pending && view.status !== "running") ? "" : undefined}
              className={cn(
                // Over the exchange's own left rule (`border-l-2` with `pl-4`), which it fills as steps finish.
                "absolute top-0 -left-[1.125rem] w-0.5 bg-border-strong",
                !still && "cc-rail",
                i < (still ? rows.length : arrived) - 1 ? "-bottom-1.5" : "bottom-0",
              )}
            />
            <span
              aria-hidden="true"
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border",
                view.status === "running" && "border-foreground text-foreground",
                view.status === "done" && "border-success bg-success text-background",
                view.status === "error" && "border-destructive bg-destructive text-primary-foreground",
              )}
            >
              {view.status === "running" ? (
                <LoaderCircle className="size-3 motion-safe:animate-spin" />
              ) : view.status === "done" ? (
                <Check className="size-3" />
              ) : (
                <X className="size-3" />
              )}
            </span>
            <span className="font-semibold">{toolLabel(view.tool)}</span>
            {/* The step's label, right after its name, so a long summary wraps under both rather than pushing it to a line of its own. */}
            <ProvenanceChip provenance={view.provenance} size="sm" />
            {summary ? <span className="min-w-0 text-muted-foreground">{summary}</span> : null}
            {roomFor ? (
              <span aria-hidden="true" className="invisible min-w-0 text-muted-foreground">
                {roomFor}
              </span>
            ) : null}
            <span className="sr-only">
              {view.status === "running" ? "(running)" : view.status === "error" ? "(failed)" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function WhatIfCard({ whatIf, range }: { whatIf: WhatIf; range: ScaleRange }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">What if</p>
        <ProvenanceChip provenance="derived" size="sm" />
      </div>
      <p className="mt-1.5 font-semibold break-words">{whatIf.move.replace(/ -> /g, " → ")}</p>
      {whatIf.allowed ? (
        <IndexChange before={whatIf.before} after={whatIf.after} range={range} />
      ) : (
        <div className="mt-2 text-sm">
          <p className="font-semibold text-destructive">Breaks a rule, so it was not scored</p>
          {whatIf.problems.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {whatIf.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground lg:text-[0.8125rem]">
        Tested only. The timetable above is unchanged.
      </p>
    </div>
  );
}

/**
 * Moves the agent tested that break a rule, in one card rather than one each. The engine's reason
 * is put in plain words with the stage and day named as the page names them (`festival`).
 */
function RuledOutCard({ whatIfs, festival }: { whatIfs: readonly WhatIf[]; festival: Festival }) {
  return (
    <div className="rounded-md border border-dashed border-border-strong p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Ruled out · {pluralize(whatIfs.length, "move")}</p>
        <ProvenanceChip provenance="derived" size="sm" />
      </div>
      <ul className="mt-2 space-y-1.5 text-sm">
        {whatIfs.map((whatIf, i) => (
          <li key={i}>
            <span className="font-semibold">{whatIf.move.replace(/ -> /g, " → ")}</span>
            {whatIf.problems[0] ? (
              <span className="text-muted-foreground"> · {humanizeProblem(whatIf.problems[0], festival)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MoveOptionsCard({ options, range }: { options: MoveOptions; range: ScaleRange }) {
  const [lowest, ...rest] = options.options;
  return (
    <div className="rounded-md border border-border bg-card p-4 sm:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Where {options.act} could go</p>
        <ProvenanceChip provenance="derived" size="sm" />
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">Now: {options.from}</p>
      {!options.movable ? (
        <p className="mt-2 text-sm font-semibold">It cannot move: {options.why ?? "it is fixed in place"}.</p>
      ) : !lowest ? (
        <p className="mt-2 text-sm font-semibold">No free slot it may use breaks no rule.</p>
      ) : (
        <>
          <p className="mt-3 font-semibold">
            Lowest index: {lowest.stage} at {lowest.start}
          </p>
          <IndexChange before={options.before} after={lowest.after} range={range} />
          {rest.length > 0 ? (
            <ol className="mt-3 space-y-1 border-t border-border pt-3 text-sm" aria-label="Other legal places">
              {rest.map((option) => {
                const delta = budgetDelta(options.before, option.after);
                return (
                  <li key={`${option.stage}-${option.start}`} className="flex flex-wrap justify-between gap-x-4">
                    <span>
                      {option.stage} at {option.start}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {option.after !== null ? option.after.toFixed(1) : "?"}
                      {delta !== null ? ` (${signedDelta(delta)})` : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground lg:text-[0.8125rem]">
            {pluralize(options.legalPlaces, "legal place")}, checking every start on a 5-minute grid. Tested only: the
            timetable above is unchanged.
          </p>
        </>
      )}
    </div>
  );
}

/** `recorded`: the tags were returned when the run was recorded, not just now. */
function ExplainCard({ explain, recorded = false }: { explain: ClashExplain; recorded?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Clash</p>
        <ProvenanceChip provenance="derived" size="sm" />
      </div>
      <p className="mt-1.5 font-semibold break-words">
        {explain.a} <span className="text-muted-foreground">×</span> {explain.b}
      </p>
      {explain.sharedAudience === null ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {explain.note ?? "Qloo has no signal for one of these acts."}
        </p>
      ) : (
        <>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <dt className="sr-only">Taste overlap</dt>
              <dd>
                <span className="type-numeral text-2xl leading-none">{formatOverlap(explain.sharedAudience)}</span>{" "}
                <span className="text-muted-foreground">taste overlap (rank on this bill)</span>
              </dd>
            </div>
            <div>
              <dt className="sr-only">Overlap</dt>
              <dd>
                <span className="type-numeral text-2xl leading-none">{explain.minutesOverlapping}</span>{" "}
                <span className="text-muted-foreground">minutes at the same time</span>
              </dd>
            </div>
          </dl>
          {explain.sharedTaste.length > 0 ? (
            <div className="mt-3">
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                Tags Qloo returned <ProvenanceChip provenance={recorded ? "recorded" : "qloo"} size="sm" />
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {explain.sharedTaste.map((tag) => (
                  <li
                    key={tag}
                    className="tag text-foreground"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ReslotCard({ reslot, range }: { reslot: ReslotSuggestion; range: ScaleRange }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Suggested moves</p>
        <ProvenanceChip provenance="derived" size="sm" />
      </div>
      {reslot.moves.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {reslot.message ?? "No move lowers this day's Clash Budget under your rules."}
        </p>
      ) : (
        <>
          <IndexChange before={reslot.before} after={reslot.after} range={range} />
          <ol className="mt-3 space-y-1.5 text-sm">
            {reslot.moves.map((move) => (
              <li key={`${move.act}-${move.to}`}>
                <span className="font-semibold">{move.act}</span>: {move.from} → {move.to}
                {move.why ? <span className="text-muted-foreground"> · {move.why}</span> : null}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground lg:text-[0.8125rem]">
            Suggestions are graded by the same measure used to find them, so a better score here is expected, not proof.
          </p>
        </>
      )}
    </div>
  );
}

/** The kept plan's anchor in "Try a move" (`try-a-move.tsx`, YOUR_PLAN_ID). */
const PLAN_ANCHOR = "your-plan";

/** True when the plan holds this place as one of its kept moves. */
export function planHolds(steps: readonly StackStep[], move: StackMove): boolean {
  return steps.some((step) => !isRuleStackStep(step) && sameStep(step, move));
}

/**
 * How Keep this move hands its place to the plan: `replace` makes it the whole plan (the decision card's
 * path); `add` puts it after the kept steps the engine just priced it with (`base`). Shaped as "Try a move"
 * reads a seed (`SeedMode`, try-a-move.tsx), so the page can pass it straight through.
 */
export type KeepChoice = SeedMode;

/** The page's keep path: hands a place to the plan, with how; returns any note on steps it replaced. */
export type KeepPlace = (move: StackMove, choice?: KeepChoice) => string | null;

/**
 * The place Keep this move offers: the run's tested place, marked as kept from a recorded agent run when the run
 * on show is a replay, so the plan list says "(from a recorded agent run)" after it. A live run's place carries no
 * source. The mark changes nothing about the place: not how it compares, encodes or is sent.
 */
export function placeToKeep(tested: AgentPlace | null, recorded: boolean): AgentPlace | null {
  if (!tested) return null;
  return recorded ? { ...tested, move: fromRecordedRun(tested.move) } : tested;
}

/** The press behind Keep this move: it hands the run's tested place, unchanged, to the page's keep path. */
export function keepPress(
  place: AgentPlace,
  onKeep: KeepPlace,
  choice: KeepChoice = { mode: "replace" },
): () => string | null {
  return () => onKeep(place.move, choice);
}

/**
 * The add check and the note after a keep live with the plan's own code (`lib/stack.ts`), so the decision
 * card's Keep this move uses exactly the same ones; they are re-exported here for this panel's callers.
 */
export { checkAdd, keepNote, type AddCheck };

/**
 * Under a finished run whose own tool results hold a place the engine found legal: the place, and Keep
 * this move (`KEEP_MOVE`, the decision card's own label), which hands it to the plan through the same path
 * as the decision card's Keep this move (the plan's own /whatif prices it again). Nothing is kept until it
 * is pressed. With an empty plan it is one button; when the plan already holds kept steps it offers "Add to
 * your plan" (first) and "Replace your plan": Add is priced with the kept steps first (`checkAdd`) and
 * changes nothing if the engine refuses it, saying why and leaving Replace. "Kept in your plan." (ink, in a
 * status region) shows only once the plan holds the place, with what happened ("Added: 2 kept moves."), and
 * focus then moves to its "See your plan" link, which takes the visitor to the plan.
 */
export function KeepThisPlace({
  place,
  kept,
  onKeep,
  check,
}: {
  place: AgentPlace;
  /** The steps the plan holds (priced), so "Kept" is said only for a place the plan really holds. */
  kept: readonly StackStep[];
  onKeep: KeepPlace;
  /** Prices a whole plan before Add keeps anything (the page's /whatif). */
  check: (steps: readonly StackStep[]) => Promise<PlanAnswer>;
}) {
  // The press, what the plan held before it, and whether the plan has held the place since: once it has and
  // then lets it go (Undo, Start over, another keep), the press is spent and the buttons are back.
  const [pressed, setPressed] = useState<{ before: readonly StackStep[]; held: boolean } | null>(null);
  // An Add being checked, or refused, for the plan it was checked against (a changed plan clears it).
  const [adding, setAdding] = useState<
    { base: string; state: "checking" } | { base: string; state: "rejected"; reason: string; retry: boolean } | null
  >(null);
  const labelId = useId();
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const replaceRef = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const held = planHolds(kept, place.move);
  const delta = budgetDelta(place.before, place.after);
  if (pressed && held && !pressed.held) setPressed({ ...pressed, held: true });
  if (pressed && !held && pressed.held) setPressed(null);
  const keptKey = encodeMoves(kept);
  const addState = adding && adding.base === keptKey ? adding : null;
  const rejected = addState?.state === "rejected" ? addState : null;
  const checking = addState?.state === "checking";
  // The plan already holds kept steps, and not this place: Add or Replace.
  const choose = kept.length > 0 && !held;

  // Once the plan holds the place this press sent, focus moves to the way there (never on a plan that
  // already held it before any press). A refused Add moves focus to Replace, the way still open.
  const announced = pressed !== null && held;
  useEffect(() => {
    if (announced) linkRef.current?.focus();
  }, [announced]);
  const refusedKey = rejected ? `${rejected.base}|${rejected.reason}` : null;
  useEffect(() => {
    if (refusedKey) replaceRef.current?.focus();
  }, [refusedKey]);

  function seePlan(event: MouseEvent<HTMLAnchorElement>) {
    const plan = document.getElementById(PLAN_ANCHOR);
    if (!plan) return;
    event.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    plan.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    plan.focus({ preventScroll: true });
  }

  function replace() {
    setAdding(null);
    setPressed({ before: kept, held: false });
    keepPress(place, onKeep, { mode: "replace" })();
  }

  async function add() {
    if (checking) return;
    const base = kept;
    const key = encodeMoves(base);
    setAdding({ base: key, state: "checking" });
    const outcome = await checkAdd(base, place, check);
    if (!alive.current) return;
    if (outcome.kind === "rejected") {
      setAdding({ base: key, state: "rejected", reason: outcome.reason, retry: outcome.retry });
      return;
    }
    setAdding(null);
    setPressed({ before: base, held: false });
    keepPress(place, onKeep, outcome.choice)();
  }

  const note = pressed && held ? keepNote(pressed.before, kept) : null;

  return (
    <div data-agent-keep className="border-t border-border pt-4">
      <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Legal place this run tested</p>
      <p className="mt-1 text-[0.9375rem] leading-snug font-semibold break-words">
        {place.act} → {place.stage}{" "}
        <span className="font-mono tabular-nums">
          {place.start}
          {place.end ? `–${place.end}` : ""}
        </span>
      </p>
      {place.before !== null && place.after !== null && delta !== null ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Clash Budget Index{" "}
          <span className="font-mono tabular-nums">
            {place.before.toFixed(1)} → {place.after.toFixed(1)}
          </span>{" "}
          ({changeLabel(delta)}), from the run&rsquo;s own tool result.
        </p>
      ) : null}
      <p className="mt-1 text-sm text-muted-foreground">
        Nothing changes until you keep it; your plan then scores it again against the published timetable.
      </p>
      {held && pressed ? null : choose ? (
        <div role="group" aria-labelledby={labelId} className="mt-3">
          <p id={labelId} className="text-sm">
            <span className="font-semibold text-foreground">{KEEP_MOVE}</span>
            <span className="text-muted-foreground">: your plan already holds {pluralize(kept.length, keptWord(kept))}.</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {rejected && !rejected.retry ? null : (
              <Button type="button" variant="outline" aria-disabled={checking || undefined} onClick={add}>
                {checking ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : null}
                Add to your plan
              </Button>
            )}
            <Button ref={replaceRef} type="button" variant="ghost" onClick={replace}>
              Replace your plan
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => {
            // Here the plan is empty or already holds this place, so the press replaces nothing.
            setPressed({ before: [], held: false });
            keepPress(place, onKeep, { mode: "replace" })();
          }}
        >
          {KEEP_MOVE}
        </Button>
      )}
      <p role="status" className="mt-2 text-sm">
        {pressed && held ? (
          <>
            <span className="font-semibold text-foreground">Kept in your plan.</span>
            {note ? <span className="text-foreground"> {note}</span> : null}{" "}
            <a
              ref={linkRef}
              href={`#${PLAN_ANCHOR}`}
              onClick={seePlan}
              className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              See your plan
            </a>
          </>
        ) : pressed ? (
          <span className="text-muted-foreground">Sent to your plan to be scored.</span>
        ) : checking ? (
          <span className="text-muted-foreground">Scoring your plan with this place added.</span>
        ) : rejected ? (
          <span className="text-foreground">{rejected.reason}</span>
        ) : null}
      </p>
    </div>
  );
}

/** Without a checker nothing can be added: the add is refused as not priced, and nothing is kept. */
const checkNothing = (): Promise<PlanAnswer> => Promise.resolve({ status: "error" });

/** An exchange in the panel: a replayed one keeps the recorded run it plays. */
type PanelExchange = Exchange & { recording?: RecordedRun };

/** A press that does nothing: the measured copy of a finished replay draws Start over without acting on it. */
const noop = () => {};

/** What an exchange's answer shows, below its question; shared by the exchange on screen and its measured copy. */
type ExchangeBodyProps = {
  exchange: PanelExchange;
  /** The run as it stands (the exchange on screen), or as it ends (the measured copy of a replay). */
  state: PanelExchange["state"];
  latest: boolean;
  range: ScaleRange;
  festival: Festival;
  day: number;
  kept: readonly StackStep[];
  onKeepPlace?: KeepPlace;
  check: (steps: readonly StackStep[]) => Promise<PlanAnswer>;
  cardActId: string | null;
  synthetic: boolean;
  onRetry: () => void;
  onWatchRecorded?: () => void;
  onStartOver?: () => void;
  /** A replay: the steps as the run ends, so each step's line keeps its place until it arrives (`ToolTrail`). */
  reserveSteps?: readonly ToolCallState[];
  /** The measured copy: rails drawn full with no transition. */
  still?: boolean;
};

function ExchangeBody({
  exchange,
  state,
  latest,
  range,
  festival,
  day,
  kept,
  onKeepPlace,
  check,
  cardActId,
  synthetic,
  onRetry,
  onWatchRecorded,
  onStartOver,
  reserveSteps,
  still = false,
}: ExchangeBodyProps) {
  const { recording } = exchange;
  const reply = useMemo(() => readClashReply(state.results), [state.results]);
  // The place to keep comes only from the finished run's own tool results, never from its text.
  const tested = useMemo(
    () => (state.status === "done" ? keepableMove(state.results, festival, day) : null),
    [state.status, state.results, festival, day],
  );
  // A place a recorded run tested carries that source into the plan, so the plan list can say where it came from.
  const place = useMemo(
    () => (onKeepPlace ? placeToKeep(tested, recording !== undefined) : null),
    [onKeepPlace, tested, recording],
  );
  const running = state.status === "running";
  const text = reply?.text || state.text;
  // A recorded run's Qloo use, read from its own recording: "Qloo requests in this run: 0" and, when it priced
  // every place it tested, where that taste came from. That trace line sits in the run's header, under its
  // question (`ExchangeView`); here only the saved-reading line, and the trace of a live run at the foot.
  const qloo = state.status === "done" ? recordedQloo(recording, reply, synthetic) : { label: null, savedReading: false };
  const traceInHeader = headerTraceLabel(recording, synthetic) !== null;
  const versus = runVersusCard(tested, cardActId);
  // What the run is doing while it waits: said in the next step's place while a replay has steps still to come
  // (so the words never move), else under the steps, as for a live run.
  const waitingLabel = state.toolCalls.length === 0 ? "Reading the timetable" : "Working";
  const trailWaiting =
    running &&
    !text &&
    reserveSteps !== undefined &&
    reserveSteps.some((step) => !state.toolCalls.some((call) => call.id === step.id));

  return (
    <div className="space-y-4 border-l-2 border-border pl-4">
      {recording ? <RecordedNotice capturedAt={recording.capturedAt} /> : null}

      <ToolTrail
        calls={state.toolCalls}
        reserve={reserveSteps}
        still={still}
        waiting={trailWaiting ? waitingLabel : null}
      />

      {running && !text && !trailWaiting ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          {waitingLabel}
        </p>
      ) : null}

      {text ? (
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Agent</span>
            <ProvenanceChip provenance="llm" size="sm" />
          </div>
          <AgentText text={text} />
        </div>
      ) : null}

      {reply && reply.whatIfs.length + reply.explains.length + reply.reslots.length + reply.moveOptions.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {reply.explains.map((explain, i) => (
            <ExplainCard
              key={`e${i}`}
              explain={explain}
              recorded={exchange.recording !== undefined || exchange.recorded === true}
            />
          ))}
          {reply.moveOptions.map((options, i) => (
            <MoveOptionsCard key={`m${i}`} options={options} range={range} />
          ))}
          {reply.whatIfs
            .filter((whatIf) => whatIf.allowed)
            .map((whatIf, i) => (
              <WhatIfCard key={`w${i}`} whatIf={whatIf} range={range} />
            ))}
          {reply.whatIfs.some((whatIf) => !whatIf.allowed) ? (
            <RuledOutCard whatIfs={reply.whatIfs.filter((whatIf) => !whatIf.allowed)} festival={festival} />
          ) : null}
          {reply.reslots.map((reslot, i) => (
            <ReslotCard key={`r${i}`} reslot={reslot} range={range} />
          ))}
        </div>
      ) : null}

      {versus ? <p className="max-w-prose text-sm text-muted-foreground">{versus}</p> : null}

      {place && onKeepPlace ? <KeepThisPlace place={place} kept={kept} onKeep={onKeepPlace} check={check} /> : null}

      {state.status === "error" && state.error ? (
        <div>
          <ErrorState
            title="The agent could not answer"
            message={state.error.message}
            retryable={latest && state.error.retryable}
            onRetry={onRetry}
          />
          {latest && onWatchRecorded ? (
            <Button
              type="button"
              variant="ruled"
              size="sm"
              className="mt-2 h-auto px-0 py-1"
              onClick={onWatchRecorded}
            >
              <History aria-hidden="true" />
              Watch a recorded run instead
            </Button>
          ) : null}
        </div>
      ) : null}

      {state.status === "cancelled" ? <p className="text-sm text-muted-foreground">Stopped.</p> : null}

      {qloo.savedReading ? <p className="max-w-prose text-sm text-muted-foreground">{SAVED_READING_LINE}</p> : null}

      {state.status !== "running" && (state.toolCalls.length > 0 || state.summary) ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {state.summary ? (
            <span>
              {pluralize(state.toolCalls.length, "step")} · {formatLatency(state.summary.elapsedMs)}
            </span>
          ) : null}
          {traceInHeader ? null : (
            <RunTrace
              state={state}
              recorded={recording !== undefined}
              synthetic={synthetic}
              label={usedTitle(synthetic)}
              savedReading={qloo.savedReading}
              triggerVariant="ghost"
              triggerClassName="h-8 px-2 text-xs"
            />
          )}
          {latest && onStartOver ? (
            <Button type="button" variant="ghost" size="sm" onClick={onStartOver}>
              <RotateCcw aria-hidden="true" /> Start over
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Holds a replay's answer at the size it ends at from its first beat, so nothing under it moves while it plays:
 * `measure` (the answer as the run ends) is laid out once, hidden and in the answer's own column, its height read
 * before the browser paints, and then removed; the answer keeps that height as its least while it is the exchange
 * on show. Without `measure` the answer takes its own height, as a live run's does.
 */
function HeldHeight({ measure, children }: { measure: ReactNode | null; children: ReactNode }) {
  const [height, setHeight] = useState<number | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const measuring = measure !== null && height === null;
  useLayoutEffect(() => {
    if (measuring && measureRef.current) setHeight(measureRef.current.offsetHeight);
  }, [measuring]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)]">
      <div className="col-start-1 row-start-1" style={measure !== null && height !== null ? { minHeight: height } : undefined}>
        {children}
      </div>
      {measuring ? (
        <div ref={measureRef} aria-hidden="true" inert className="invisible col-start-1 row-start-1 self-start">
          {measure}
        </div>
      ) : null}
    </div>
  );
}

/** One question and its answer in the conversation: a live run, or a replayed recording. */
export function ExchangeView({
  exchange,
  latest,
  range,
  festival,
  day,
  kept = [],
  onKeepPlace,
  check = checkNothing,
  cardActId = null,
  synthetic = false,
  onRetry,
  onSkip,
  onWatchRecorded,
  onStartOver,
}: {
  exchange: PanelExchange;
  latest: boolean;
  range: ScaleRange;
  /** Names the stages and days in the engine's reasons for a ruled-out move. */
  festival: Festival;
  /** The festival day on show: a tested place is offered to keep only on it. */
  day: number;
  /** The steps the plan holds, so Keep this move can say when its place is kept. */
  kept?: readonly StackStep[];
  /** Keeps a tested place through the page's keep path; absent, no Keep this move is offered. */
  onKeepPlace?: KeepPlace;
  /** Prices a whole plan before Add keeps anything (the page's /whatif). */
  check?: (steps: readonly StackStep[]) => Promise<PlanAnswer>;
  /** The set the move at the top of the page moves, so a run that moved another set can say why the two differ. */
  cardActId?: string | null;
  /** The invented day: no Qloo wording. */
  synthetic?: boolean;
  onRetry: () => void;
  /** Finishes a replay at once. */
  onSkip: () => void;
  /** Plays a recorded run instead; only offered when the day has one. */
  onWatchRecorded?: () => void;
  /** Clears the conversation; offered with the latest finished run's own controls. */
  onStartOver?: () => void;
}) {
  const { state, recording } = exchange;
  const running = state.status === "running";
  // A replay's end is known before it plays: the same saved events, through the same reducer.
  const final = useMemo(() => (recording ? replayFinalState(recording) : null), [recording]);
  const body: ExchangeBodyProps = {
    exchange,
    state,
    latest,
    range,
    festival,
    day,
    kept,
    onKeepPlace,
    check,
    cardActId,
    synthetic,
    onRetry,
    onWatchRecorded,
    onStartOver,
  };
  // The replay on show is held at the size it ends at: measured as it will stand once finished, Start over
  // included (it is offered on the latest run as soon as the replay ends).
  const measure =
    final && latest ? (
      <ExchangeBody {...body} state={final} onStartOver={onStartOver ?? noop} onRetry={noop} still />
    ) : null;
  // A replay's trace line, under its question: its words come from the recording, so its room is kept from the
  // first beat (hidden, not focusable) and it shows, without moving anything, once the replay has played.
  const traceLabel = headerTraceLabel(recording, synthetic);
  const reply = useMemo(() => readClashReply(state.results), [state.results]);
  const done = state.status === "done";
  const savedReading = done && recordedQloo(recording, reply, synthetic).savedReading;

  return (
    // Brought to the top when it starts, below the page's own scroll padding and, from 768 px, clear of the
    // sticky section nav, so its question and Skip are in view (from 1024 px the first run's margin is set as it
    // starts, so the section's heading beside it stays in view too: `replayScrollMargin`). On a phone its title row
    // (Asked, with Skip while it plays) lands 12 px under the 63 px scroll padding, 19 px clear of the 56 px header,
    // with the question and the replay's Recorded notice under it; the section's heading is then above the screen.
    <li id={`agent-${exchange.id}`} className="scroll-mt-3 space-y-4 md:scroll-mt-10">
      <div>
        {/* A replay's label shares its line with Skip, in a line that keeps Skip's height once it goes, so the
            answer below never moves up when the replay ends. */}
        <div className={cn("flex items-end justify-between gap-3", recording && "min-h-9")}>
          <p aria-hidden="true" className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
            {recording ? "Asked" : "You asked"}
          </p>
          {recording && running && latest ? (
            <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
              <SkipForward aria-hidden="true" />
              Skip to the answer
            </Button>
          ) : null}
        </div>
        <p className="mt-1 max-w-prose border-l-2 border-foreground pl-4 text-[0.9375rem] leading-relaxed text-foreground break-words">
          <span className="sr-only">{recording ? "The recorded run was asked: " : "You asked: "}</span>
          {exchange.message}
        </p>
        {traceLabel ? (
          <div data-run-trace="" className={cn("mt-1", !done && "invisible")}>
            <RunTrace
              state={state}
              recorded
              synthetic={synthetic}
              label={traceLabel}
              countInLabel
              savedReading={savedReading}
              triggerVariant="ruled"
              triggerClassName="text-sm"
            />
          </div>
        ) : null}
      </div>

      <HeldHeight measure={measure}>
        <ExchangeBody {...body} reserveSteps={final?.toolCalls} />
      </HeldHeight>
    </li>
  );
}

function Capabilities({ synthetic = false }: { synthetic?: boolean }) {
  return (
    <div>
      <h3 className="pb-2 text-[0.8125rem] leading-5 font-semibold text-foreground">What it can do</h3>
      <ul className="mt-4 space-y-3 text-sm">
        {CAPABILITIES.map((item) => (
          <li key={item.tool} className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
            <span className="font-semibold">{item.title}</span>
            <span className="text-muted-foreground">
              {item.tool === "explain_clash" ? explainPrompt(synthetic) : item.text}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted-foreground">
        Scores, overlaps and Clash Budgets in its answers come from the steps listed with them. {NEVER_CHANGES}
      </p>
    </div>
  );
}

/** Said beside the capabilities when the agent is on, and beside the recorded runs when it is off. */
const NEVER_CHANGES = "It never changes the real festival, which does not use Clash Control.";

/**
 * What to ask the agent, said in the section's intro right after what it does, on every day (it names no Qloo).
 * Each clause is one of its tools (backend/app/agent/clash_tools.py): set rules, add_constraint (:832); find a
 * move, find_moves (:387) and reslot (:930); test a move, try_move (:281); explain, explain_clash (:202) and the
 * run's answer in words, written from those tools' results (backend/app/agent/loop.py streams it).
 */
export const ASK_IT = "Ask it to set rules, find and test a move, then explain the result.";

/**
 * The lede under the heading while the live agent is off: what the agent does, what to ask it (`ASK_IT`), and that
 * a replay calls nothing (the off card below says it is off). The invented day names no Qloo call, since it never
 * had one.
 */
export function offLede(withRecordings: boolean, synthetic: boolean): string {
  const does = `The agent tests a move against every rule and scores it before it answers. ${ASK_IT}`;
  if (!withRecordings) return does;
  return synthetic
    ? `${does} Saved runs on this day replay with no live call.`
    : `${does} Saved runs on this day replay with no live Qloo or model call.`;
}

/** The section's heading while the live agent is off and it shows recorded runs. */
export const RECORDED_HEADING = "Recorded agent runs";

/**
 * The section's heading. While the live agent is off (`off`) it says what the section holds, recorded runs
 * ("Recorded agent runs", or "The agent" on a day with none), with no invitation to type and a lede in
 * place of one; the kicker is left out, since it would only repeat the heading. While the agent is on (or
 * its state is unknown) it invites a question, as before.
 */
export function AgentHeading({
  isMock,
  synthetic = false,
  lede,
  off = null,
}: {
  isMock: boolean;
  synthetic?: boolean;
  /** Replaces the invitation to ask while the live agent is off. */
  lede?: string;
  /** The live agent is off: "recorded" with recorded runs to show, "none" without. */
  off?: "recorded" | "none" | null;
}) {
  if (off) {
    return (
      <div>
        {isMock ? (
          <p className="flex max-w-prose flex-wrap items-center gap-2">
            <MockBadge />
          </p>
        ) : null}
        <h2 id="agent-heading" tabIndex={-1} className={cn("type-title w-fit", isMock && "mt-1.5")}>
          {off === "recorded" ? RECORDED_HEADING : "The agent"}
        </h2>
        {lede ? <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed">{lede}</p> : null}
      </div>
    );
  }
  return (
    <div>
      <p className="flex max-w-prose flex-wrap items-center gap-2 text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
        Ask the agent {isMock ? <MockBadge /> : null}
      </p>
      <h2 id="agent-heading" tabIndex={-1} className="type-title mt-1.5 w-fit">
        Or describe the change in plain words
      </h2>
      <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed">
        {lede ?? (
          <>
            The agent works on this day&rsquo;s timetable {agentDataLine(synthetic)}. Ask why two sets clash, give it a
            rule, or ask it to try a move: it tests the move against every rule and scores it before saying anything.{" "}
            {ASK_IT}
          </>
        )}
      </p>
    </div>
  );
}

/**
 * "What the agent can and cannot do": a short open list, every line true to the backend (see
 * `agentLimits`), so the section says what the agent is before anything is pressed.
 */
export function AgentLimits({ synthetic = false }: { synthetic?: boolean }) {
  return (
    <div>
      <h3 className="pb-2 text-[0.8125rem] leading-5 font-semibold text-foreground">What the agent can and cannot do</h3>
      <ul className="mt-2 space-y-2 text-sm leading-relaxed">
        {agentLimits(synthetic).map((line) => (
          <li key={line} className="max-w-prose lg:max-w-none">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The section's grid places from 1024 px (two rows, `auto 1fr`; one column below it, in source order: side,
 * run, picker). In every state the side column (heading, can/cannot list) sits top left, the run picker under
 * it on the left, and the run (the still transcript, or the replay) spans both rows on the right, so the
 * picker never changes column when a run starts or ends. While and after a run plays (`playing`) the picker
 * stays in view as the answer scrolls, sticky under the site header (64 px) and the section nav (44 px). Its track
 * (`pickerTrack`) then reaches 3rem past the run's foot, into the section's own bottom padding (3rem from 640 px),
 * so where the page ends just below a run the picker can stay that much lower and its label clears the sticky
 * bars instead of riding up under them; it never reaches past the section.
 */
export function agentLayout(
  playing: boolean,
  aside = true,
): { side: string; run: string; picker: string; pickerTrack: string; pickerInner: string } {
  return {
    side: "min-w-0 lg:col-span-6 lg:col-start-1 lg:row-start-1",
    run: cn("min-w-0 lg:col-span-6 lg:col-start-7 lg:row-span-2 lg:row-start-1 lg:mt-0", aside ? "mt-8" : "mt-5"),
    picker: "mt-8 min-w-0 lg:col-span-6 lg:col-start-1 lg:row-start-2 lg:mt-4 lg:self-stretch",
    pickerTrack: playing ? "lg:h-[calc(100%_+_3rem)]" : "",
    pickerInner: playing ? "lg:sticky lg:top-32" : "",
  };
}

/**
 * Where a run's question lands when it starts: the scroll margin (px) to give its item, or null to keep the item's
 * own (`scroll-mt-3 md:scroll-mt-10`). From 1024 px (`wide`) the section's heading sits in the column beside the run,
 * so while the question is near enough to the section's top (`offset`, px) to land in the upper half of the screen,
 * the margin grows by that distance and the section lands where the "Agent runs" jump lands it (`sectionMargin`, its
 * own scroll margin, past the page's scroll padding `padding`): the heading clear of the sticky bars, the question
 * beside it. On one column, or for a later run far down the conversation, the heading is not beside the question
 * and the item's own margin stands.
 */
export function replayScrollMargin({
  wide,
  offset,
  sectionMargin,
  padding,
  viewport,
}: {
  wide: boolean;
  offset: number;
  sectionMargin: number;
  padding: number;
  viewport: number;
}): number | null {
  if (!wide) return null;
  const margin = Math.round(offset + sectionMargin);
  return padding + margin <= viewport / 2 ? margin : null;
}

/** Why the live agent is off, said plainly wherever the panel stands in for it. */
const AGENT_OFF =
  "The live agent is off here to keep this demo free to run; its answers come from a language model. Scores, clashes and moves above work without it.";

/**
 * Shown instead of the question box while the language model is off, so the panel never looks
 * broken. With recorded runs to offer, the block is labelled "Recorded run" and the sentence sits
 * under that label as one quiet line; with none, the sentence stands alone.
 */
function AgentOffCard({ withRecordings }: { withRecordings: boolean }) {
  if (!withRecordings) {
    return <p className="max-w-prose text-[0.9375rem] leading-relaxed">{AGENT_OFF}</p>;
  }
  return (
    <div className="pt-0">
      <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">Recorded run</p>
      <p className="mt-1.5 max-w-prose text-[0.8125rem] leading-relaxed text-muted-foreground">{AGENT_OFF}</p>
    </div>
  );
}

/**
 * The first recorded run as a still transcript: its question and the steps it took, read from the
 * saved stream with no playback, so the section shows the agent at work before anything is pressed.
 * Labelled recorded throughout; Replay plays it in full.
 */
function RecordedTranscript({
  run,
  disabled,
  onReplay,
}: {
  run: RecordedRun;
  disabled: boolean;
  onReplay: () => void;
}) {
  const calls = useMemo(() => replayFinalState(run).toolCalls, [run]);
  return (
    <div className="mt-5 border-t border-border pt-4">
      <RecordedNotice capturedAt={run.capturedAt} />
      <p className="mt-4">
        <span className="block text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
          <span className="sr-only">The recorded run was asked: </span>
          <span aria-hidden="true">Asked</span>
        </span>
        <span className="mt-1 block text-[0.9375rem] leading-relaxed font-semibold break-words">{run.question}</span>
      </p>
      {calls.length > 0 ? (
        <div className="mt-4 border-l-2 border-border pl-4">
          {/* Shown before anything is pressed, so its rail is drawn full and still: nothing moves on first paint. */}
          <ToolTrail calls={calls} still />
        </div>
      ) : null}
      {/* From 1024 px, beside the run list in the other column; below it the list follows at once and its first
          row replays this run, so this copy is not drawn there. */}
      <Button type="button" variant="ruled" className="mt-3 max-lg:hidden" disabled={disabled} onClick={onReplay}>
        Replay this run
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * The least height (px) the agent section holds at a width (`width`, px) while its recorded runs are still out: above
 * the tallest settled section measured on the published days (round 37, F3; with the recordings of 21 Oct 2026,
 * Glastonbury's is the taller: 1,819 px at 320, 1,588 at 390, 1,217 from 640 to 1,023, 1,004 at 1,024 and 879 from
 * 1,280; Riot Fest's 1,360, 1,168, 994, 653 and 611). Room the runs do not fill stays under them only while it is on
 * screen (`useHeldRoom`).
 */
export function agentRoomFloor(width: number): number {
  if (width >= 1024) return 1100;
  if (width >= 640) return 1350;
  return 2000;
}

/**
 * "Ask the agent": a conversation about this festival day. The agent scores clashes, explains them
 * with Qloo's shared taste, records rules and tests moves; each answer shows its steps, the budget
 * before and after a tested move, and the Qloo requests behind it.
 *
 * What it shows depends on whether the live agent is on (`agentStatus`, see `panelMode`): a
 * placeholder while that is being checked, the question box when it is on (or unknown), and a
 * notice when it is off. Real runs saved for this day can be replayed in every state but the
 * placeholder; a replay makes no request and never feeds the live conversation.
 */
export function AgentPanel({
  preset,
  day,
  agentStatus = "unknown",
  keptSteps = [],
  onKeepPlace,
  cardActId = null,
  publishedDays = NO_DAYS,
}: {
  preset: Preset;
  day: number;
  agentStatus?: AgentStatus;
  /**
   * The published festival days, as the page's day list already holds them (never the invented one), so the
   * runs line can point to another day's run that asked Qloo without asking for the list again.
   */
  publishedDays?: readonly PublishedDay[];
  /** The steps the kept plan holds (priced), so a run's Keep this move says when its place is kept. */
  keptSteps?: readonly StackStep[];
  /**
   * Keeps a place a run tested through the page's keep path (the decision card's), with how (`choice`:
   * replace the plan, or add after the kept steps it was priced with), returning the note on any steps it
   * replaced. Absent: no run offers Keep this move.
   */
  onKeepPlace?: KeepPlace;
  /** The set the decision card's move moves, so a run that moved another set says why their changes differ. */
  cardActId?: string | null;
}) {
  const run = useAgentRun({ endpoint: "/api/runs" });
  const recordings = useRecordings(preset.id);
  const [exchanges, setExchanges] = useState<PanelExchange[]>([]);
  const [current, setCurrent] = useState<{
    id: string;
    message: string;
    recording?: RecordedRun;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const counter = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // A run that ends with a place to keep is listed first and is the default replay, one whose saved events hold a
  // Qloo request ahead of one whose events hold none; a run the rules refuse is listed last (`orderRecordings`,
  // read from each run's own tool results and saved requests, never its id, title or place in the file).
  const runs = useMemo(() => orderRecordings(recordings.runs), [recordings.runs]);
  const mode = panelMode(agentStatus, runs.length > 0, recordings.status === "loading");
  const off = mode === "off" || mode === "off-recorded";
  // While the agent's state or this day's recorded runs are still out, the section holds the room the settled panel
  // takes at its width (`agentRoomFloor`) and reaches past the screen's foot while it is on screen, so the runs land
  // without moving the sources or the footer under it, even for a visitor at the page's foot (round 37, F3). The heading and the can/cannot list are drawn as they will settle, so nothing above the run moves.
  const sectionRef = useRef<HTMLElement | null>(null);
  useHeldRoom(sectionRef, mode === "checking" || recordings.status === "loading", agentRoomFloor);
  const range = useMemo<ScaleRange>(() => scaleRange(preset.report.baseline), [preset]);

  const all = useMemo<PanelExchange[]>(
    () =>
      current
        ? [
            ...exchanges,
            {
              ...current,
              recorded: current.recording !== undefined,
              state: run.state,
            },
          ]
        : exchanges,
    [exchanges, current, run.state],
  );
  const rules = useMemo(() => latestSession(all)?.rules ?? [], [all]);
  // A replayed question does not count as asked: it can still be asked live.
  const asked = useMemo(
    () => new Set(all.filter((exchange) => !exchange.recorded).map((exchange) => exchange.message)),
    [all],
  );
  const prompts = useMemo(() => {
    const locked = new Set(preset.festival.timetable.filter((slot) => slot.locked).map((slot) => slot.act_id));
    return suggestedPrompts(preset.report.clashes, day, (id) => locked.has(id), preset.evidence).filter(
      (prompt) => !asked.has(prompt),
    );
  }, [preset, day, asked]);
  const busy = run.isRunning;
  const replaying = current?.recording !== undefined;
  const presetId = preset.id;
  const check = useMemo(() => (steps: readonly StackStep[]) => checkPlan(presetId, steps), [presetId]);

  // The pointer to another published day's run that asked Qloo: only on a published day whose own loaded runs
  // hold no Qloo request, and from the day list the page already holds (never a second fetch of it). The other
  // day's recordings are asked for at most once per page load for this day; a failure shows nothing new.
  const synthetic = preset.synthetic === true;
  const pointing =
    recordings.status === "ready" && mayPointElsewhere(presetId, synthetic, publishedDays, recordings.runs);
  const otherIds = useMemo(() => publishedDays.map((item) => item.id), [publishedDays]);
  const otherRuns = useOtherDaysRecordings(presetId, otherIds, pointing);
  const pointer = pointing ? pointerDay(publishedDays, presetId, otherRuns) : null;

  // "See that run" opened this day: its agent section comes into view once the day is on screen, at once (no
  // scroll animation), and the section's heading takes focus so the keyboard carries on from there (the link
  // itself went with the day it was on). An address that names the agent section (`#agent`) is brought into view
  // the same way, once per page load, since the section is drawn only after the page has loaded.
  useEffect(() => {
    const fromPointer = openedFromPointer === presetId;
    const fromAddress = !initialHashAnswered && window.location.hash === "#agent";
    initialHashAnswered = true;
    if (!fromPointer && !fromAddress) return;
    openedFromPointer = null;
    document.getElementById("agent")?.scrollIntoView({ block: "start", behavior: "auto" });
    if (fromPointer) document.getElementById("agent-heading")?.focus({ preventScroll: true });
  }, [presetId]);

  /** "See that run": the named day replaces this one in place (no reload), at its agent section. */
  function openPointedDay(event: MouseEvent<HTMLAnchorElement>, target: PublishedDay) {
    // A new tab or window, or a modified press, follows the link as written.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openedFromPointer = target.id;
    window.history.pushState(null, "", agentSectionHref(target.id));
  }

  useEffect(() => {
    if (!current) return;
    const item = document.getElementById(`agent-${current.id}`);
    if (!item) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // From 1024 px the first run's question lands with the section's heading in view beside it, clear of the sticky
    // bars, as the "Agent runs" jump lands it (`replayScrollMargin`); otherwise the item keeps its own margin.
    const section = document.getElementById("agent");
    const margin = section
      ? replayScrollMargin({
          wide: window.matchMedia("(min-width: 64rem)").matches,
          offset: item.getBoundingClientRect().top - section.getBoundingClientRect().top,
          sectionMargin: Number.parseFloat(getComputedStyle(section).scrollMarginTop) || 0,
          padding: Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0,
          viewport: window.innerHeight,
        })
      : null;
    item.style.scrollMarginTop = margin === null ? "" : `${margin}px`;
    // Bring the question to the top so the answer streams into view below it, not below the fold.
    item.scrollIntoView({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [current]);

  /** Moves the exchange in progress into the finished list and returns that list. */
  function commit(): PanelExchange[] {
    const committed: PanelExchange[] = current
      ? [
          ...exchanges,
          {
            ...current,
            recorded: current.recording !== undefined,
            state: run.state,
          },
        ]
      : exchanges;
    counter.current += 1;
    setExchanges(committed);
    return committed;
  }

  function send(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    const committed = commit();
    setCurrent({ id: `q${counter.current}`, message: text });
    setDraft("");
    run.start(buildClashBody(preset.id, text, committed));
  }

  /** Replays a recorded run as a new exchange. Nothing is sent; the live session is untouched. */
  function play(recording: RecordedRun) {
    if (busy) return;
    commit();
    setCurrent({
      id: `q${counter.current}`,
      message: recording.question,
      recording,
    });
    run.replay(recording);
  }

  function skip() {
    if (current?.recording && busy) run.replay(current.recording, { instant: true });
  }

  function startOver() {
    run.reset();
    setExchanges([]);
    setCurrent(null);
    inputRef.current?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  }

  const status =
    run.state.status === "running"
      ? replaying
        ? "Replaying a recorded run."
        : "The agent is working."
      : run.state.status === "done"
        ? replaying
          ? "The recorded run has finished."
          : "The agent answered."
        : run.state.status === "error"
          ? "The agent could not answer."
          : "";

  const conversation =
    all.length > 0 ? (
      <ol aria-label="Conversation" aria-busy={busy} className="space-y-8">
        {all.map((exchange, index) => (
          <ExchangeView
            key={exchange.id}
            exchange={exchange}
            latest={index === all.length - 1}
            range={range}
            festival={preset.festival}
            day={day}
            kept={keptSteps}
            onKeepPlace={onKeepPlace}
            check={check}
            cardActId={cardActId}
            synthetic={synthetic}
            onRetry={run.retry}
            onSkip={skip}
            onWatchRecorded={runs.length > 0 ? () => play(runs[0]) : undefined}
            onStartOver={!busy && mode !== "checking" ? startOver : undefined}
          />
        ))}
      </ol>
    ) : null;

  // The recordings' Qloo use, read from the recordings: one line when none asked Qloo, else each run's own
  // count on its row. When the line says no new request and another published day holds a run that asked Qloo
  // while it was recorded, the line goes on to say so and "See that run" opens that day's agent section. The
  // invented day names no Qloo request either way.
  const runsLine = recordingsQlooLine(runs, synthetic);
  const qlooLine: ReactNode =
    runsLine === null ? null : pointer ? (
      <>
        {pointerLine(runsLine, pointer)}{" "}
        <a
          href={agentSectionHref(pointer.id)}
          onClick={(event) => openPointedDay(event, pointer)}
          data-agent-pointer=""
          className="font-semibold text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
        >
          {SEE_THAT_RUN}
        </a>
      </>
    ) : (
      runsLine
    );
  const recorded = <RecordedRuns runs={runs} onPlay={play} disabled={busy} qlooCounts={!synthetic && runsLine === null} />;
  // While the agent is off, the heading already says saved runs replay with no live call, so the list
  // keeps its kicker and drops the line under it.
  const recordedOff = (
    <RecordedRuns runs={runs} onPlay={play} disabled={busy} description={null} qlooCounts={!synthetic && runsLine === null} />
  );
  // The side column, under the heading: the rules said so far and what the agent can and cannot do (drawn in the
  // section below), the same in every mode. Start over sits with the latest run's own controls, not here. It is drawn
  // while the panel is still checking too (none of it waits on the runs or on /api/health), so the run under it on a
  // phone never moves down when they land. The live agent's capabilities follow the question form instead, so a late
  // health answer (or its timeout to unknown) adds nothing above the run.
  // From 1024 px the run picker sits in the side column, under the can/cannot list, in every state, so it never
  // jumps between columns; while and after a run plays it stays in view as the answer scrolls (sticky under the
  // site header and section nav). It is one element, never re-mounted, so a pressed Replay keeps focus. On a
  // phone it follows the run, after the can/cannot list and the run.
  const playing = all.length > 0;
  const layout = agentLayout(playing);
  const picker =
    mode !== "checking" && runs.length > 0 ? (
      <div data-agent-picker data-beside-run={playing ? "" : undefined} className={layout.picker}>
        <div data-agent-picker-track className={layout.pickerTrack}>
          <div className={layout.pickerInner}>
            {mode === "live" ? recorded : recordedOff}
            {/* From 1024 px the line takes the column's full measure, so the pointer adds at most one line. */}
            {mode === "live" ? (
              qlooLine ? <p className="mt-3 max-w-prose text-sm text-muted-foreground lg:max-w-none">{qlooLine}</p> : null
            ) : (
              <p className="mt-3 max-w-prose text-sm text-muted-foreground lg:max-w-none">
                {qlooLine}
                {/* After the pointer's link, the closing sentence starts its own line, so the link ends the line it closes. */}
                {pointer ? <span className="block">{NEVER_CHANGES}</span> : `${qlooLine ? " " : ""}${NEVER_CHANGES}`}
              </p>
            )}
          </div>
        </div>
      </div>
    ) : null;

  let main: ReactNode;
  if (mode === "checking") {
    main = (
      <>
        <AgentSkeleton />
        <p role="status" className="sr-only">
          Checking whether the live agent is on.
        </p>
      </>
    );
  } else if (mode === "off" || mode === "off-recorded") {
    main = (
      <>
        <AgentOffCard withRecordings={mode === "off-recorded"} />
        {mode === "off-recorded" && runs[0] && !conversation ? (
          <RecordedTranscript run={runs[0]} disabled={busy} onReplay={() => play(runs[0])} />
        ) : null}
        {conversation ? <div className="mt-8">{conversation}</div> : null}
      </>
    );
  } else {
    main = (
      <>
        {conversation ? <div className="mb-8">{conversation}</div> : null}

        {prompts.length > 0 && !busy ? (
          <div className="mb-4">
            <p className="text-xs text-muted-foreground">{all.length === 0 ? "Try one" : "Or try"}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {prompts.map((prompt) => (
                <li key={prompt}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-9 py-1.5 text-left whitespace-normal"
                    onClick={() => send(prompt)}
                  >
                    {prompt}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form
          onSubmit={onSubmit}
          className="rounded-md border border-border-strong bg-card p-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
        >
          <label htmlFor="agent-input" className="sr-only">
            Ask the agent about this festival day
          </label>
          <textarea
            id="agent-input"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={MAX_MESSAGE_CHARS}
            rows={2}
            placeholder="e.g. Keep the headliner on the main stage, then try moving the set it clashes with"
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-[0.9375rem] leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CornerDownLeft aria-hidden="true" className="size-3" /> Enter to send · Shift+Enter for a new line
              {draft.length > MAX_MESSAGE_CHARS - 100 ? ` · ${MAX_MESSAGE_CHARS - draft.length} left` : ""}
            </p>
            <div className="flex items-center gap-2">
              {busy ? (
                <Button type="button" variant="ghost" size="sm" onClick={run.cancel}>
                  Stop
                </Button>
              ) : null}
              <Button type="submit" variant="ink" size="sm" disabled={busy || !draft.trim()}>
                {busy && !replaying ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : null}
                Ask
              </Button>
            </div>
          </div>
        </form>
        <p className="mt-2 text-xs text-muted-foreground lg:text-[0.8125rem]">
          Answers are written live by a language model from the tools&rsquo; results. Questions are limited per visitor
          and in total per day. The recorded runs in this section make no live call, so they still play when the
          day&rsquo;s questions are used up.
        </p>
        <div className="mt-8">
          <Capabilities synthetic={synthetic} />
        </div>
      </>
    );
  }

  return (
    <section ref={sectionRef} id="agent" aria-labelledby="agent-heading">
      {/* From 1024 px two columns: on the left the heading and what the agent can and cannot do; on the right the
          off notice and the run (a still transcript, or the replay). The run picker sits under the transcript
          before any run plays, and under the can/cannot list (sticky) while and after one does. On a phone one
          column in source order: the heading, the can/cannot list, the run, then the picker. */}
      <div className="container-page grid gap-x-12 py-10 sm:py-12 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:items-start">
        <div data-agent-side className={layout.side}>
          <AgentHeading
            isMock={run.isMock}
            synthetic={synthetic}
            off={agentStatus === "off" ? (mode === "off" ? "none" : "recorded") : null}
            lede={off || agentStatus === "off" ? offLede(mode !== "off", synthetic) : undefined}
          />

          <aside data-agent-limits className="mt-8 min-w-0 space-y-8">
            {rules.length > 0 ? (
              <div>
                <h3 className="pb-2 text-[0.8125rem] leading-5 font-semibold text-foreground">Your rules</h3>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {rules.map((rule) => (
                    <li key={rule} className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <AgentLimits synthetic={synthetic} />
          </aside>
        </div>

        <div data-agent-run className={layout.run}>
          {main}
          {mode !== "checking" ? (
            <p role="status" aria-live="polite" className="sr-only">
              {status}
            </p>
          ) : null}
        </div>

        {picker}
      </div>
    </section>
  );
}
