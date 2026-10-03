"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  Check,
  CornerDownLeft,
  History,
  LoaderCircle,
  PowerOff,
  RotateCcw,
  SkipForward,
  X,
} from "lucide-react";

import { ErrorState, MockBadge, ProvenanceChip, TraceDrawer, useAgentRun } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import {
  MAX_MESSAGE_CHARS,
  budgetDelta,
  buildClashBody,
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
import { formatLatency, humanizeIdentifier, pluralize } from "@/lib/format";
import type { Festival, Preset } from "@/lib/preset";
import type { RecordedRun } from "@/lib/recorded-run";
import type { ToolCallState } from "@/lib/run-state";
import { cn } from "@/lib/utils";

import { BudgetMove, scaleRange, signedDelta, type ScaleRange } from "./budget-move";
import { RecordedNotice, RecordedRuns } from "./recorded-runs";
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
  { tool: "reslot", title: "Suggest moves", text: "Suggest moves when you ask, graded by the same measure." },
];

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? humanizeIdentifier(tool);
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

/** What the agent did, one line per tool call, so the answer can be checked against its steps. */
function ToolTrail({ calls }: { calls: readonly ToolCallState[] }) {
  if (calls.length === 0) return null;
  return (
    <ol aria-label="What the agent did" className="space-y-1.5">
      {calls.map((call) => (
        <li key={call.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full border",
              call.status === "running" && "border-primary text-primary",
              call.status === "done" && "border-success bg-success text-background",
              call.status === "error" && "border-destructive bg-destructive text-background",
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
    <div className="rounded-lg border border-border-strong bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="type-kicker text-muted-foreground">What if</p>
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
      <p className="mt-3 text-xs text-muted-foreground">Tested only. The timetable above is unchanged.</p>
    </div>
  );
}

/**
 * Moves the agent tested that break a rule, in one card rather than one each. The engine's reason
 * is put in plain words with the stage and day named as the page names them (`festival`).
 */
function RuledOutCard({ whatIfs, festival }: { whatIfs: readonly WhatIf[]; festival: Festival }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="type-kicker text-muted-foreground">
          Ruled out · {pluralize(whatIfs.length, "move")}
        </p>
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
  const [best, ...rest] = options.options;
  return (
    <div className="rounded-lg border border-border-strong bg-card p-4 sm:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <p className="type-kicker text-muted-foreground">Where {options.act} could go</p>
        <ProvenanceChip provenance="derived" size="sm" />
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">Now: {options.from}</p>
      {!options.movable ? (
        <p className="mt-2 text-sm font-semibold">It cannot move: {options.why ?? "it is fixed in place"}.</p>
      ) : !best ? (
        <p className="mt-2 text-sm font-semibold">No free slot it may use breaks no rule.</p>
      ) : (
        <>
          <p className="mt-3 font-semibold">
            Best: {best.stage} at {best.start}
          </p>
          <BudgetMove before={options.before} after={best.after} range={range} />
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
          <p className="mt-3 text-xs text-muted-foreground">
            {pluralize(options.legalPlaces, "legal place")}, checking every start on a 5-minute grid.
            Tested only: the timetable above is unchanged.
          </p>
        </>
      )}
    </div>
  );
}

/** `recorded`: the tags were returned when the run was recorded, not just now. */
function ExplainCard({ explain, recorded = false }: { explain: ClashExplain; recorded?: boolean }) {
  return (
    <div className="rounded-lg border border-border-strong bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="type-kicker text-muted-foreground">Clash</p>
        <ProvenanceChip provenance="derived" size="sm" />
      </div>
      <p className="mt-1.5 font-semibold break-words">
        {explain.a} <span className="text-muted-foreground">×</span> {explain.b}
      </p>
      {explain.sharedAudience === null ? (
        <p className="mt-2 text-sm text-muted-foreground">{explain.note ?? "Qloo has no signal for one of these acts."}</p>
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
                  <li key={tag} className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium">
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
    <div className="rounded-lg border border-border-strong bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="type-kicker text-muted-foreground">Suggested moves</p>
        <ProvenanceChip provenance="derived" size="sm" />
      </div>
      {reslot.moves.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{reslot.message ?? "No move lowers this day's Clash Budget under your rules."}</p>
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
          <p className="mt-3 text-xs text-muted-foreground">
            Suggestions are graded by the same measure used to find them, so a better score here is
            expected, not proof.
          </p>
        </>
      )}
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
  onRetry,
  onSkip,
  onWatchRecorded,
}: {
  exchange: PanelExchange;
  latest: boolean;
  range: ScaleRange;
  /** Names the stages and days in the engine's reasons for a ruled-out move. */
  festival: Festival;
  onRetry: () => void;
  /** Finishes a replay at once. */
  onSkip: () => void;
  /** Plays a recorded run instead; only offered when the day has one. */
  onWatchRecorded?: () => void;
}) {
  const { state, recording } = exchange;
  const reply = useMemo(() => readClashReply(state.results), [state.results]);
  const running = state.status === "running";
  const text = reply?.text || state.text;
  const qlooCalls = state.summary?.qlooCalls ?? state.toolCalls.reduce((sum, call) => sum + call.requests.length, 0);

  return (
    <li id={`agent-${exchange.id}`} className="space-y-4">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-4 py-2.5 text-[0.9375rem] leading-relaxed text-background break-words">
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
              <span className="type-kicker text-muted-foreground">Agent</span>
              <ProvenanceChip provenance="llm" size="sm" />
            </div>
            <AgentText text={text} />
          </div>
        ) : null}

        {reply && reply.whatIfs.length + reply.explains.length + reply.reslots.length + reply.moveOptions.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {reply.explains.map((explain, i) => (
              <ExplainCard key={`e${i}`} explain={explain} recorded={exchange.recording !== undefined || exchange.recorded === true} />
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
                variant="link"
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
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Capabilities() {
  return (
    <div>
      <h3 className="type-kicker border-b-2 border-foreground pb-2 text-foreground">What it can do</h3>
      <ul className="mt-4 space-y-3 text-sm">
        {CAPABILITIES.map((item) => (
          <li key={item.tool} className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
            <span className="font-semibold">{item.title}</span>
            <span className="text-muted-foreground">{item.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted-foreground">
        Prices, overlaps and Clash Budgets in its answers come from the steps listed with them. It
        never changes the real festival, which does not use Clash Control.
      </p>
    </div>
  );
}

function AgentHeading({ isMock }: { isMock: boolean }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
      <div>
        <p className="type-kicker flex flex-wrap items-center gap-2 text-muted-foreground">
          Ask the agent {isMock ? <MockBadge /> : null}
        </p>
        <h2 id="agent-heading" className="type-headline mt-2">
          Or describe the change in plain words
        </h2>
      </div>
      <p className="text-[0.9375rem] leading-relaxed">
        The agent works on this day&rsquo;s timetable with the same Qloo data. Ask why two sets
        clash, give it a rule, or ask it to try a move: it tests the move against every rule and
        prices it before saying anything.
      </p>
    </div>
  );
}

/**
 * Shown instead of the question box while the language model is off, so the panel never looks
 * broken. With recorded runs to offer, it ends by pointing at them.
 */
function AgentOffCard({ withRecordings }: { withRecordings: boolean }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-border-strong bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <PowerOff aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h3 className="type-title">The live agent is switched off right now</h3>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
            Its answers come from a language model, which is off here to keep this demo free to run.
            Everything above (prices, clashes, receipts) works without it.
            {withRecordings ? " Watch a recorded run instead:" : null}
          </p>
        </div>
      </div>
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
}: {
  preset: Preset;
  day: number;
  agentStatus?: AgentStatus;
}) {
  const run = useAgentRun({ endpoint: "/api/runs" });
  const recordings = useRecordings(preset.id);
  const [exchanges, setExchanges] = useState<PanelExchange[]>([]);
  const [current, setCurrent] = useState<{ id: string; message: string; recording?: RecordedRun } | null>(null);
  const [draft, setDraft] = useState("");
  const counter = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const runs = recordings.runs;
  const mode = panelMode(agentStatus, runs.length > 0, recordings.status === "loading");
  const range = useMemo<ScaleRange>(() => scaleRange(preset.report.baseline), [preset]);

  const all = useMemo<PanelExchange[]>(
    () =>
      current
        ? [...exchanges, { ...current, recorded: current.recording !== undefined, state: run.state }]
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
    document
      .getElementById(`agent-${current.id}`)
      ?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [current]);

  /** Moves the exchange in progress into the finished list and returns that list. */
  function commit(): PanelExchange[] {
    const committed: PanelExchange[] = current
      ? [...exchanges, { ...current, recorded: current.recording !== undefined, state: run.state }]
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
    setCurrent({ id: `q${counter.current}`, message: recording.question, recording });
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
            onRetry={run.retry}
            onSkip={skip}
            onWatchRecorded={runs.length > 0 ? () => play(runs[0]) : undefined}
          />
        ))}
      </ol>
    ) : null;

  const recorded = <RecordedRuns runs={runs} onPlay={play} disabled={busy} />;

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
        {mode === "off-recorded" ? <div className="mt-6">{recorded}</div> : null}
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

        <form onSubmit={onSubmit} className="rounded-xl border border-border-strong bg-card p-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
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
        <p className="mt-2 text-xs text-muted-foreground">
          Answers are written live by a language model from the tools&rsquo; results. Questions are
          limited per visitor to keep the demo free.
        </p>

        {runs.length > 0 ? <div className="mt-10 border-t border-border pt-6">{recorded}</div> : null}
      </>
    );
  }

  return (
    <section id="agent" aria-labelledby="agent-heading" className="border-t border-border bg-muted/40">
      <div className="container-page py-14 sm:py-20">
        <AgentHeading isMock={run.isMock} />

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
          <div className="min-w-0">
            {main}
            {mode !== "checking" ? (
              <p role="status" aria-live="polite" className="sr-only">
                {status}
              </p>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-8">
            {rules.length > 0 ? (
              <div>
                <h3 className="type-kicker border-b-2 border-foreground pb-2 text-foreground">Your rules</h3>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {rules.map((rule) => (
                    <li key={rule} className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Capabilities />
            {all.length > 0 && mode !== "checking" ? (
              <Button type="button" variant="outline" size="sm" onClick={startOver} disabled={busy}>
                <RotateCcw aria-hidden="true" /> Start over
              </Button>
            ) : null}
          </aside>
        </div>
      </div>
    </section>
  );
}
