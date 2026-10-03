/**
 * Plays a list of timed events through a callback, the way a live stream would deliver them. Used
 * for recorded agent runs (`recorded-run.ts`) and the simulated stream (`mock-stream.ts`). Nothing
 * here touches the network.
 */

import type { AgentEvent } from "./events";

/** One event and how long to wait before delivering it, in milliseconds. */
export type ReplayBeat = { after: number; event: AgentEvent };

export type ReplayOptions = {
  /** Deliver every beat at once, synchronously, with no waiting. */
  instant?: boolean;
};

/** Resolves true after `ms`, or false right away if `signal` aborts first. */
export function wait(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (!(ms > 0)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Delivers `beats` in order, waiting `after` milliseconds before each one. Aborting stops playback
 * quietly: no further event is delivered and the promise resolves. With `instant`, every beat is
 * delivered before this function returns.
 */
export async function replayRun(
  beats: readonly ReplayBeat[],
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
  options: ReplayOptions = {},
): Promise<void> {
  if (options.instant) {
    for (const { event } of beats) {
      if (signal?.aborted) return;
      onEvent(event);
    }
    return;
  }
  for (const { after, event } of beats) {
    if (!(await wait(after, signal))) return;
    onEvent(event);
  }
}
