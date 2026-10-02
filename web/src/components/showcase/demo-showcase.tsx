"use client";

import { useRef, useState, type ReactNode } from "react";
import { Play, RotateCcw, Square } from "lucide-react";
import { cn } from "@/lib/utils";

import {
  AbstainState,
  ErrorState,
  LlmOnlyToggle,
  MockBadge,
  NeedsInput,
  ProvenanceChip,
  RecordedBadge,
  RunSteps,
  TraceDrawer,
  useAgentRun,
  type AnswerSource,
} from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { MOCK_SCENARIOS, readMockSummary, type MockScenario } from "@/lib/mock-stream";
import { selectAbstain, selectContentResults, selectSteps } from "@/lib/run-state";

import { DemoResultCard } from "./demo-result-card";
import { RunSummary } from "./run-summary";

const SCENARIO_OPTIONS: readonly SegmentedOption<MockScenario>[] = MOCK_SCENARIOS.map(
  ({ value, label, hint }) => ({ value, label, description: hint }),
);

const DEMO_REQUEST = { preset: "demo" };

/**
 * Kernel showcase: plays the simulated stream through RunSteps, TraceDrawer and a result card,
 * and exercises every honest state. Temporary; delete it when the real screens land.
 */
export function DemoShowcase({
  kicker,
  title,
  lede,
}: {
  kicker: ReactNode;
  title: ReactNode;
  lede: ReactNode;
}) {
  const [scenario, setScenario] = useState<MockScenario>("live");
  const [source, setSource] = useState<AnswerSource>("qloo");

  // The showcase always replays the simulated stream, whatever NEXT_PUBLIC_MOCK_STREAM says.
  const qloo = useAgentRun({ endpoint: "/api/runs", mock: { scenario } });
  const baseline = useAgentRun({
    endpoint: "/api/baseline/llm-only",
    mock: { scenario: "baseline" },
  });

  const active = source === "llm-only" ? baseline : qloo;
  const { state } = active;
  const busy = qloo.isRunning || baseline.isRunning;
  const hasRun = qloo.state.status !== "idle";

  // The retry and answer controls disappear when their run restarts, so hand focus to the run
  // button (which becomes "Stop") instead of letting it fall back to the page.
  const runButtonRef = useRef<HTMLButtonElement>(null);

  function runDemo() {
    setSource("qloo");
    baseline.reset();
    qloo.start(DEMO_REQUEST);
  }

  // Either run may be the one in flight, whichever is on screen.
  function stop() {
    qloo.cancel();
    baseline.cancel();
  }

  function retry() {
    active.retry();
    runButtonRef.current?.focus();
  }

  function answer(option: Parameters<typeof qloo.answer>[0]) {
    qloo.answer(option);
    runButtonRef.current?.focus();
  }

  function changeSource(next: AnswerSource) {
    setSource(next);
    if (next === "llm-only" && baseline.state.status === "idle") baseline.start(DEMO_REQUEST);
  }

  const scenarioHint = MOCK_SCENARIOS.find((item) => item.value === scenario)?.hint;
  const abstain = selectAbstain(state.results);
  const content = selectContentResults(state.results);
  // Outcomes a screen reader user would miss if they only heard "Run complete."
  const outcome = abstain
    ? `Run finished without an answer. ${abstain.reason}`
    : state.needsInput
      ? `Waiting for your answer. ${state.needsInput.question}`
      : undefined;
  const showsBody =
    state.status !== "idle" && (state.text !== "" || state.results.length > 0 || state.needsInput);

  return (
    <>
      <section className="relative isolate overflow-hidden">
        <div
          aria-hidden="true"
          className="bg-timegrid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_30%,transparent)]"
        />
        <div className="container-page pt-10 pb-12 sm:pt-14 sm:pb-16 lg:pt-16 lg:pb-20">
          {kicker}
          <div className="mt-4 grid gap-8 sm:mt-5 sm:gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
            <div className="@container">{title}</div>

            <div className="min-w-0 space-y-8">
              {lede}

              <div className="space-y-6">
                <Button
                  ref={runButtonRef}
                  size="lg"
                  variant={busy ? "outline" : "default"}
                  onClick={busy ? stop : runDemo}
                  className="w-full sm:w-auto sm:min-w-44"
                >
                  {busy ? (
                    <Square aria-hidden="true" />
                  ) : hasRun ? (
                    <RotateCcw aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                  {busy ? "Stop" : hasRun ? "Run again" : "Run demo"}
                </Button>

                <div className="space-y-3">
                  <p className="type-kicker text-muted-foreground">Simulated scenario</p>
                  <SegmentedControl
                    label="Simulated scenario"
                    value={scenario}
                    onValueChange={setScenario}
                    options={SCENARIO_OPTIONS}
                    disabled={busy}
                  />
                  <p className="max-w-prose text-sm text-muted-foreground">
                    {scenarioHint} Every event comes from a built-in script, and no requests are
                    sent to Qloo.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="demo-run-heading" className="border-t border-border">
        <div className="container-page grid gap-12 py-10 sm:py-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <h2 id="demo-run-heading" className="sr-only">
            Demo run
          </h2>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <RunSteps steps={selectSteps(state)} status={state.status} outcome={outcome} />
          </div>

          <div className="min-w-0">
            <header className="border-b-2 border-foreground pb-2">
              <h3 className="type-kicker">Result</h3>
            </header>

            <div className="mt-5 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <MockBadge />
                  {state.mode === "recorded" ? <RecordedBadge /> : null}
                </div>
                {state.status !== "idle" ? (
                  <TraceDrawer
                    toolCalls={state.toolCalls}
                    runId={state.runId}
                    mode={state.mode}
                    qlooCalls={state.summary?.qlooCalls}
                    live={state.status === "running"}
                  />
                ) : null}
              </div>

              {qloo.state.status === "done" ? (
                <LlmOnlyToggle value={source} onValueChange={changeSource} />
              ) : null}

              {state.status === "idle" ? (
                <div className="rounded-lg border-2 border-dashed border-border-strong p-6 text-muted-foreground">
                  <p className="font-semibold text-foreground">Nothing has run yet.</p>
                  <p className="mt-1 text-sm">
                    Choose a scenario and run the demo. Progress, the written summary, the result and
                    the Qloo trace appear here.
                  </p>
                </div>
              ) : null}

              {state.status === "running" && !showsBody ? <ResultSkeleton /> : null}

              {state.status === "cancelled" ? (
                <p className="rounded-lg border border-dashed border-border-strong p-4 text-sm text-muted-foreground">
                  Run stopped. Whatever arrived before that is shown here and in the progress list.
                </p>
              ) : null}

              {state.text !== "" ? (
                <div>
                  <div className="flex items-center gap-2.5">
                    <ProvenanceChip provenance="llm" size="sm" />
                    <span className="type-kicker text-muted-foreground">Written summary</span>
                  </div>
                  <div className="mt-3 max-w-prose space-y-4 text-[1.0625rem] leading-relaxed">
                    {state.text.split("\n\n").map((paragraph, index, paragraphs) => (
                      <p
                        key={index}
                        className={cn(
                          state.status === "running" && index === paragraphs.length - 1 && "stream-caret",
                        )}
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              {state.status === "awaiting_input" && state.needsInput ? (
                <NeedsInput
                  question={state.needsInput.question}
                  options={state.needsInput.options}
                  onSelect={answer}
                />
              ) : null}

              {content.map((result, index) => {
                const summary = result.kind === "summary" ? readMockSummary(result.data) : null;
                return summary ? (
                  <DemoResultCard key={`${result.kind}-${index}`} data={summary} />
                ) : (
                  <p
                    key={`${result.kind}-${index}`}
                    className="rounded-lg border border-dashed border-border-strong p-4 text-sm text-muted-foreground"
                  >
                    No renderer for results of kind &ldquo;{result.kind}&rdquo; yet.
                  </p>
                );
              })}

              {abstain ? <AbstainState reason={abstain.reason} details={abstain.details} /> : null}

              {state.status === "error" && state.error ? (
                <ErrorState
                  message={state.error.message}
                  retryable={state.error.retryable}
                  onRetry={retry}
                />
              ) : null}

              {state.summary && state.status !== "error" ? <RunSummary summary={state.summary} /> : null}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function ResultSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <div className="h-4 w-3/4 rounded bg-muted motion-safe:animate-pulse" />
      <div className="h-4 w-full rounded bg-muted motion-safe:animate-pulse" />
      <div className="h-4 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
    </div>
  );
}
