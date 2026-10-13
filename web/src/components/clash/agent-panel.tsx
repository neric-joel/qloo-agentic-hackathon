"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
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
  type Exchange,
  type InlineSegment,
  type MoveOptions,
  type ReslotSuggestion,
  type WhatIf,
} from "@/lib/agent-session";
import { panelMode, type AgentStatus } from "@/lib/agent-status";
import { formatOverlap } from "@/lib/clashes";
import { agentDataLine, explainPrompt } from "@/lib/credit";
import { isRecord } from "@/lib/events";
import { formatLatency, humanizeIdentifier, pluralize } from "@/lib/format";
import { clockMinutes } from "@/lib/moves";
import type { Festival, Preset } from "@/lib/preset";
import { replayFinalState, type RecordedRun } from "@/lib/recorded-run";
import type { RunResult, ToolCallState } from "@/lib/run-state";
import { isRuleStackStep, sameStep, type StackMove, type StackStep } from "@/lib/stack";
import { formatClock } from "@/lib/timetable";
import { cn } from "@/lib/utils";

import { BudgetMove, scaleRange, signedDelta, type ScaleRange } from "./budget-move";
import { RecordedNotice, RecordedRuns, recordedQlooCalls } from "./recorded-runs";
import { AgentSkeleton } from "./skeletons";
import { useRecordings } from "./use-recordings";

const TOOL_LABELS: Record<string, string> = {
  list_timetable: "Read the timetable",
  clash_report: "Priced the day",
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
    text: "Check every start on a 5-minute grid and list the legal places a set could move to, each one priced.",
  },
  {
    tool: "try_move",
    title: "Test a move",
    text: "Test a move you name against the rules and price it, without changing anything.",
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
    // timetable; only Keep this place below hands a tested place to your plan.
    "It can test a move, but it never changes your timetable unless you press Keep this place.",
    // backend/app/agent/clash_tools.py:1003 (CLASH_TOOLS): its seven tools read and test the timetable;
    // none sends a message or publishes anything.
    "It never contacts anyone or publishes anything.",
    // backend/app/config.py:29-33: agent_max_qloo_calls_per_run = 12 (the run refuses further Qloo-backed
    // tools, backend/app/agent/tools.py:78-89) and agent_max_turns = 6 (backend/app/main.py:160).
    synthetic ? "At most 6 model turns per run." : "At most 12 Qloo requests and 6 model turns per run.",
  ];
}

/** "three" for 3, up to ten; the figure past that. */
function countWord(n: number): string {
  return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}

/**
 * The one line about the recordings' Qloo use, read from the recordings: that none asked Qloo when every
 * run's saved count is 0, else null (each run then says its own count). Never on the invented day.
 */
export function recordingsQlooLine(runs: readonly RecordedRun[], synthetic = false): string | null {
  if (synthetic || runs.length === 0 || runs.some((run) => recordedQlooCalls(run) !== 0)) return null;
  return runs.length === 1
    ? "This recorded run did not ask Qloo: it tests moves with the timetable engine."
    : `None of these ${countWord(runs.length)} recorded runs asked Qloo: they test moves with the timetable engine.`;
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
 * stream (live or replayed) rather than a timer, and each step's dot pops in as the step appears.
 */
function ToolTrail({ calls }: { calls: readonly ToolCallState[] }) {
  if (calls.length === 0) return null;
  return (
    <ol aria-label="What the agent did" className="space-y-1.5">
      {calls.map((call, i) => (
        <li key={call.id} className="relative flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
          <span
            aria-hidden="true"
            data-done={call.status === "running" ? undefined : ""}
            className={cn(
              // Over the exchange's own left rule (`border-l-2` with `pl-4`), which it fills as steps finish.
              "cc-rail absolute top-0 -left-[1.125rem] w-0.5 bg-border-strong",
              i < calls.length - 1 ? "-bottom-1.5" : "bottom-0",
            )}
          />
          <span
            aria-hidden="true"
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full border",
              call.status === "running" && "border-foreground text-foreground",
              call.status === "done" && "border-success bg-success text-background",
              call.status === "error" && "border-destructive bg-destructive text-primary-foreground",
            )}
          >
            {call.status === "running" ? (
              <LoaderCircle className="size-3 motion-safe:animate-spin" />
            ) : call.status === "done" ? (
              <Check className="size-3" />
            ) : (
              <X className="size-3" />
            )}
          </span>
          <span className="font-semibold">{toolLabel(call.tool)}</span>
          {call.summary ? <span className="min-w-0 text-muted-foreground">{call.summary}</span> : null}
          <span className="sr-only">
            {call.status === "running" ? "(running)" : call.status === "error" ? "(failed)" : ""}
          </span>
          <ProvenanceChip provenance={call.provenance} size="sm" />
        </li>
      ))}
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
        <BudgetMove before={whatIf.before} after={whatIf.after} range={range} />
      ) : (
        <div className="mt-2 text-sm">
          <p className="font-semibold text-destructive">Breaks a rule, so it was not priced</p>
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
          <BudgetMove before={options.before} after={lowest.after} range={range} />
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
          <BudgetMove before={reslot.before} after={reslot.after} range={range} />
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

/** The press behind Keep this place: it hands the run's tested place, unchanged, to the page's keep path. */
export function keepPress(place: AgentPlace, onKeep: (move: StackMove) => string | null): () => string | null {
  return () => onKeep(place.move);
}

/**
 * Under a finished run whose own tool results hold a place the engine found legal: the place, and Keep
 * this place, which hands it to the plan through the same path as the decision card's Keep this move (the
 * plan's own /whatif prices it again). Nothing is kept until it is pressed. "Kept in your plan." (ink, in
 * a status region) shows only once the plan holds the place, and focus then moves to its "See your plan"
 * link, which takes the visitor to the plan.
 */
function KeepThisPlace({
  place,
  kept,
  onKeep,
}: {
  place: AgentPlace;
  /** The steps the plan holds (priced), so "Kept" is said only for a place the plan really holds. */
  kept: readonly StackStep[];
  onKeep: (move: StackMove) => string | null;
}) {
  // The press, its replaced-steps note, and whether the plan has held the place since: once it has and then
  // lets it go (Undo, Start over, another keep), the press is spent and the button is back.
  const [pressed, setPressed] = useState<{ note: string | null; held: boolean } | null>(null);
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const held = planHolds(kept, place.move);
  const delta = budgetDelta(place.before, place.after);
  if (pressed && held && !pressed.held) setPressed({ ...pressed, held: true });
  if (pressed && !held && pressed.held) setPressed(null);

  // Once the plan holds the place this press sent, focus moves to the way there (never on a plan that
  // already held it before any press).
  const announced = pressed !== null && held;
  useEffect(() => {
    if (announced) linkRef.current?.focus();
  }, [announced]);

  function seePlan(event: MouseEvent<HTMLAnchorElement>) {
    const plan = document.getElementById(PLAN_ANCHOR);
    if (!plan) return;
    event.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    plan.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    plan.focus({ preventScroll: true });
  }

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
        Nothing changes until you keep it; your plan then prices it again against the published timetable.
      </p>
      {held && pressed ? null : (
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => setPressed({ note: keepPress(place, onKeep)(), held: false })}
        >
          Keep this place
        </Button>
      )}
      <p role="status" className="mt-2 text-sm">
        {pressed && held ? (
          <>
            <span className="font-semibold text-foreground">Kept in your plan.</span>
            {pressed.note ? <span className="text-foreground"> {pressed.note}</span> : null}{" "}
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
          <span className="text-muted-foreground">Sent to your plan to be priced.</span>
        ) : null}
      </p>
    </div>
  );
}

/** An exchange in the panel: a replayed one keeps the recorded run it plays. */
type PanelExchange = Exchange & { recording?: RecordedRun };

function ExchangeView({
  exchange,
  latest,
  range,
  festival,
  day,
  kept = [],
  onKeepPlace,
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
  /** The steps the plan holds, so Keep this place can say when its place is kept. */
  kept?: readonly StackStep[];
  /** Keeps a tested place through the page's keep path; absent, no Keep this place is offered. */
  onKeepPlace?: (move: StackMove) => string | null;
  onRetry: () => void;
  /** Finishes a replay at once. */
  onSkip: () => void;
  /** Plays a recorded run instead; only offered when the day has one. */
  onWatchRecorded?: () => void;
  /** Clears the conversation; offered with the latest finished run's own controls. */
  onStartOver?: () => void;
}) {
  const { state, recording } = exchange;
  const reply = useMemo(() => readClashReply(state.results), [state.results]);
  // The place to keep comes only from the finished run's own tool results, never from its text.
  const place = useMemo(
    () => (state.status === "done" && onKeepPlace ? keepableMove(state.results, festival, day) : null),
    [state.status, state.results, festival, day, onKeepPlace],
  );
  const running = state.status === "running";
  const text = reply?.text || state.text;
  const qlooCalls = state.summary?.qlooCalls ?? state.toolCalls.reduce((sum, call) => sum + call.requests.length, 0);

  return (
    <li id={`agent-${exchange.id}`} className="space-y-4">
      <div>
        <p aria-hidden="true" className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
          {recording ? "Asked" : "You asked"}
        </p>
        <p className="mt-1 max-w-prose border-l-2 border-foreground pl-4 text-[0.9375rem] leading-relaxed text-foreground break-words">
          <span className="sr-only">{recording ? "The recorded run was asked: " : "You asked: "}</span>
          {exchange.message}
        </p>
      </div>

      <div className="space-y-4 border-l-2 border-border pl-4">
        {recording ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <RecordedNotice capturedAt={recording.capturedAt} />
            {running && latest ? (
              <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
                <SkipForward aria-hidden="true" />
                Skip to the answer
              </Button>
            ) : null}
          </div>
        ) : null}

        <ToolTrail calls={state.toolCalls} />

        {running && !text ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
            {state.toolCalls.length === 0 ? "Reading the timetable" : "Working"}
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

        {place && onKeepPlace ? <KeepThisPlace place={place} kept={kept} onKeep={onKeepPlace} /> : null}

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

        {state.status !== "running" && (state.toolCalls.length > 0 || state.summary) ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {state.summary ? (
              <span>
                {pluralize(state.toolCalls.length, "step")} · {formatLatency(state.summary.elapsedMs)}
              </span>
            ) : null}
            <TraceDrawer
              toolCalls={state.toolCalls}
              runId={state.runId}
              mode={state.mode}
              qlooCalls={qlooCalls}
              triggerVariant="ghost"
              triggerClassName="h-8 px-2 text-xs"
              description={
                recording
                  ? "The Qloo requests this run made when it was recorded. They are listed from the saved stream; none were made just now."
                  : "The Qloo requests this answer made. Prices and what-ifs reuse the day's saved Qloo data; explaining a clash asks Qloo live for the taste both audiences share."
              }
            />
            {latest && onStartOver ? (
              <Button type="button" variant="ghost" size="sm" onClick={onStartOver}>
                <RotateCcw aria-hidden="true" /> Start over
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
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
        Prices, overlaps and Clash Budgets in its answers come from the steps listed with them. {NEVER_CHANGES}
      </p>
    </div>
  );
}

/** Said beside the capabilities when the agent is on, and beside the recorded runs when it is off. */
const NEVER_CHANGES = "It never changes the real festival, which does not use Clash Control.";

/**
 * The lede under the heading while the live agent is off: what the agent does, and that a replay calls
 * nothing (the off card below says it is off). The invented day names no Qloo call, since it never had one.
 */
function offLede(withRecordings: boolean, synthetic: boolean): string {
  const does = "The agent tests a move against every rule and prices it before it answers.";
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
        <h2 id="agent-heading" className={cn("type-title", isMock && "mt-1.5")}>
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
      <h2 id="agent-heading" className="type-title mt-1.5">
        Or describe the change in plain words
      </h2>
      <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed">
        {lede ?? (
          <>
            The agent works on this day&rsquo;s timetable {agentDataLine(synthetic)}. Ask why two sets clash, give it a
            rule, or ask it to try a move: it tests the move against every rule and prices it before saying anything.
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
          <li key={line} className="max-w-prose">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Why the live agent is off, said plainly wherever the panel stands in for it. */
const AGENT_OFF =
  "The live agent is off here to keep this demo free to run; its answers come from a language model. Prices, clashes and receipts above work without it.";

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
          <ToolTrail calls={calls} />
        </div>
      ) : null}
      <Button type="button" variant="ruled" className="mt-3" disabled={disabled} onClick={onReplay}>
        Replay this run
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * "Ask the agent": a conversation about this festival day. The agent prices clashes, explains them
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
}: {
  preset: Preset;
  day: number;
  agentStatus?: AgentStatus;
  /** The steps the kept plan holds (priced), so a run's Keep this place says when its place is kept. */
  keptSteps?: readonly StackStep[];
  /**
   * Keeps a place a run tested through the page's keep path (the decision card's), returning the note on
   * any steps it replaced. Absent: no run offers Keep this place.
   */
  onKeepPlace?: (move: StackMove) => string | null;
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

  const runs = recordings.runs;
  const mode = panelMode(agentStatus, runs.length > 0, recordings.status === "loading");
  const off = mode === "off" || mode === "off-recorded";
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

  useEffect(() => {
    if (!current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Bring the question to the top so the answer streams into view below it, not below the fold.
    document.getElementById(`agent-${current.id}`)?.scrollIntoView({
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
            onRetry={run.retry}
            onSkip={skip}
            onWatchRecorded={runs.length > 0 ? () => play(runs[0]) : undefined}
            onStartOver={!busy && mode !== "checking" ? startOver : undefined}
          />
        ))}
      </ol>
    ) : null;

  const synthetic = preset.synthetic === true;
  // The recordings' Qloo use, read from the recordings: one line when none asked Qloo, else each run's own
  // count on its row. The invented day names no Qloo request either way.
  const qlooLine = recordingsQlooLine(runs, synthetic);
  const recorded = <RecordedRuns runs={runs} onPlay={play} disabled={busy} qlooCounts={!synthetic && qlooLine === null} />;
  // While the agent is off, the heading already says saved runs replay with no live call, so the list
  // keeps its kicker and drops the line under it.
  const recordedOff = (
    <RecordedRuns runs={runs} onPlay={play} disabled={busy} description={null} qlooCounts={!synthetic && qlooLine === null} />
  );
  // The side column, under the heading: the rules said so far, the capabilities (live agent only) and what
  // the agent can and cannot do. Start over sits with the latest run's own controls, not here.
  const aside = mode !== "checking";

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
        {mode === "off-recorded" ? (
          <div className="mt-8">
            {recordedOff}
            <p className="mt-3 max-w-prose text-sm text-muted-foreground">
              {qlooLine ? `${qlooLine} ` : ""}
              {NEVER_CHANGES}
            </p>
          </div>
        ) : null}
        {conversation ? <div className="mt-10">{conversation}</div> : null}
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
          to keep the demo free.
        </p>

        {runs.length > 0 ? (
          <div className="mt-12">
            {recorded}
            {qlooLine ? <p className="mt-3 max-w-prose text-sm text-muted-foreground">{qlooLine}</p> : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section id="agent" aria-labelledby="agent-heading">
      <div className="container-page grid gap-x-12 py-10 sm:py-12 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="lg:col-span-5">
          <AgentHeading
            isMock={run.isMock}
            synthetic={synthetic}
            off={agentStatus === "off" ? (mode === "off" ? "none" : "recorded") : null}
            lede={off || agentStatus === "off" ? offLede(mode !== "off", synthetic) : undefined}
          />
        </div>

        <div className="mt-5 min-w-0 lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1 lg:mt-0">
          {main}
          {mode !== "checking" ? (
            <p role="status" aria-live="polite" className="sr-only">
              {status}
            </p>
          ) : null}
        </div>

        {aside ? (
          <aside className="mt-10 min-w-0 space-y-8 lg:col-span-5 lg:row-start-2 lg:mt-8">
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
            {mode === "live" ? <Capabilities synthetic={synthetic} /> : null}
            <AgentLimits synthetic={synthetic} />
          </aside>
        ) : null}
      </div>
    </section>
  );
}
