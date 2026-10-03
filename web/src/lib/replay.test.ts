import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent } from "./events";
import { replayRun, type ReplayBeat } from "./replay";

const beats: ReplayBeat[] = [
  { after: 0, event: { type: "run_started", run_id: "run_test", mode: "recorded" } },
  { after: 500, event: { type: "text_delta", text: "One " } },
  { after: 60, event: { type: "text_delta", text: "two." } },
  { after: 200, event: { type: "run_finished", run_id: "run_test", qloo_calls: 0, elapsed_ms: 760 } },
];

describe("replayRun", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers every beat in order, each after its wait", async () => {
    const seen: AgentEvent["type"][] = [];
    const done = replayRun(beats, (event) => seen.push(event.type));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(["run_started"]);
    await vi.advanceTimersByTimeAsync(499);
    expect(seen).toEqual(["run_started"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual(["run_started", "text_delta"]);
    await vi.advanceTimersByTimeAsync(260);
    await done;
    expect(seen).toEqual(["run_started", "text_delta", "text_delta", "run_finished"]);
  });

  it("stops quietly when aborted", async () => {
    const controller = new AbortController();
    const seen: AgentEvent["type"][] = [];
    const done = replayRun(beats, (event) => seen.push(event.type), controller.signal);
    await vi.advanceTimersByTimeAsync(520);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(done).resolves.toBeUndefined();
    expect(seen).toEqual(["run_started", "text_delta"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers nothing when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const onEvent = vi.fn();
    await replayRun(beats, onEvent, controller.signal);
    await replayRun(beats, onEvent, controller.signal, { instant: true });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("delivers every beat at once, synchronously, when instant", () => {
    const seen: AgentEvent["type"][] = [];
    void replayRun(beats, (event) => seen.push(event.type), undefined, { instant: true });
    expect(seen).toEqual(["run_started", "text_delta", "text_delta", "run_finished"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
