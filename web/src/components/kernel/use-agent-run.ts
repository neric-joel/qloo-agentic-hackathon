"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import { isRecord, type AgentEvent, type NeedsInputOption } from "@/lib/events";
import { MOCK_STREAM_ENABLED, mockStreamRun, type MockStreamOptions } from "@/lib/mock-stream";
import { initialRunState, runReducer, type RunState } from "@/lib/run-state";
import { streamRun } from "@/lib/sse";

export type UseAgentRunOptions = {
  /** POST endpoint that answers with an event stream, e.g. "/api/runs". */
  endpoint: string;
  /**
   * Replay the simulated stream instead of calling the endpoint.
   * Defaults to on when `NEXT_PUBLIC_MOCK_STREAM=1`. Pass options to pick a scenario.
   * Options are read when `start()` runs, so they reflect the latest render.
   */
  mock?: boolean | MockStreamOptions;
  /**
   * Builds the request body for the follow-up run once the user answers a question.
   * The default adds `answer: { question, option_id }` to the previous body.
   */
  buildAnswerBody?: (context: {
    previousBody: unknown;
    question: string;
    option: NeedsInputOption;
  }) => unknown;
};

export type AgentRun = {
  state: RunState;
  isRunning: boolean;
  /** True when events come from the simulated stream. Screens should label such output. */
  isMock: boolean;
  /** Starts a run, cancelling any run in progress. */
  start: (body?: unknown) => void;
  /** Starts again with the body of the last run. */
  retry: () => void;
  /** Continues after a `needs_input` question. */
  answer: (option: NeedsInputOption) => void;
  /** Stops the run in progress and keeps what has arrived so far. */
  cancel: () => void;
  reset: () => void;
};

function resolveMock(mock: UseAgentRunOptions["mock"]): MockStreamOptions | null {
  if (mock === false) return null;
  if (typeof mock === "object") return mock;
  return mock === true || MOCK_STREAM_ENABLED ? {} : null;
}

/**
 * Wires an event stream (real or simulated) to the run state the kernel components render.
 * The stream is aborted when the component unmounts or a new run starts.
 */
export function useAgentRun(options: UseAgentRunOptions): AgentRun {
  const [state, dispatch] = useReducer(runReducer, initialRunState);
  const optionsRef = useRef(options);
  const controllerRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<unknown>(undefined);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const start = useCallback((body?: unknown) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    bodyRef.current = body;
    dispatch({ type: "start" });

    const { endpoint, mock } = optionsRef.current;
    const mockOptions = resolveMock(mock);
    const onEvent = (event: AgentEvent) => {
      // A newer run or an unmount has superseded this one.
      if (!controller.signal.aborted) dispatch({ type: "event", event });
    };

    const run = mockOptions
      ? mockStreamRun(body, onEvent, controller.signal, mockOptions)
      : streamRun(endpoint, body ?? {}, onEvent, controller.signal);

    run.catch((error: unknown) => {
      console.error("[agent-run] The stream failed unexpectedly", error);
      onEvent({ type: "error", message: "The run stopped unexpectedly.", retryable: true });
    });
  }, []);

  const retry = useCallback(() => start(bodyRef.current), [start]);

  const question = state.needsInput?.question ?? "";
  const answer = useCallback(
    (option: NeedsInputOption) => {
      const previousBody = bodyRef.current;
      const { buildAnswerBody } = optionsRef.current;
      start(
        buildAnswerBody
          ? buildAnswerBody({ previousBody, question, option })
          : {
              ...(isRecord(previousBody) ? previousBody : {}),
              answer: { question, option_id: option.id },
            },
      );
    },
    [question, start],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    dispatch({ type: "cancel" });
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    dispatch({ type: "reset" });
  }, []);

  return {
    state,
    isRunning: state.status === "running",
    isMock: resolveMock(options.mock) !== null,
    start,
    retry,
    answer,
    cancel,
    reset,
  };
}
