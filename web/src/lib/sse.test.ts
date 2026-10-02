import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent } from "./events";
import { createSseDecoder, streamRun, type SseMessage } from "./sse";

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const started = { type: "run_started", run_id: "r1", mode: "live" } as const;
const stepRunning = { type: "step", id: "s1", label: "Read the request", status: "running" } as const;
const stepDone = { type: "step", id: "s1", label: "Read the request", status: "done" } as const;
const finished = { type: "run_finished", run_id: "r1", qloo_calls: 0, elapsed_ms: 12 } as const;

/** Frames events the way the backend does: `data: <json>` followed by a blank line. */
function frame(...events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

function bytesOf(text: string): Uint8Array {
  return encoder.encode(text);
}

/** A response whose body yields the given chunks one at a time, then closes. */
function responseOf(chunks: (string | Uint8Array)[], init: ResponseInit = {}): Response {
  const parts = chunks.map((chunk) => (typeof chunk === "string" ? bytesOf(chunk) : chunk));
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < parts.length) controller.enqueue(parts[index++]);
      else controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

function splitBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

async function collect(
  response: Response | (() => Response | Promise<Response>),
  options: { idleTimeoutMs?: number } = {},
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await streamRun("/api/runs", { scenario: "x" }, (event) => events.push(event), undefined, {
    ...options,
    fetch: async () => (typeof response === "function" ? response() : response),
  });
  return events;
}

/** A body that stays open until the test pushes data, closes it, or the request is aborted. */
function openBody(signal?: AbortSignal | null) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  // Real fetch errors the body stream when the request is aborted.
  signal?.addEventListener("abort", () => {
    try {
      controller.error(new DOMException("The operation was aborted.", "AbortError"));
    } catch {
      // already closed
    }
  });
  return {
    state,
    response: new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    push: (text: string) => controller.enqueue(bytesOf(text)),
    close: () => controller.close(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// decoder
// ---------------------------------------------------------------------------

describe("createSseDecoder", () => {
  function decode(...chunks: string[]): SseMessage[] {
    const messages: SseMessage[] = [];
    const decoder = createSseDecoder((message) => messages.push(message));
    for (const chunk of chunks) decoder.push(chunk);
    decoder.end();
    return messages;
  }

  it("emits one message per blank-line-terminated block", () => {
    expect(decode("data: one\n\ndata: two\n\n")).toEqual([
      { event: "message", data: "one" },
      { event: "message", data: "two" },
    ]);
  });

  it("joins multi-line data with newlines", () => {
    expect(decode("data: line one\ndata: line two\ndata:\ndata: line four\n\n")).toEqual([
      { event: "message", data: "line one\nline two\n\nline four" },
    ]);
  });

  it("ignores comments and does not dispatch comment-only blocks", () => {
    expect(decode(": keep-alive\n\n", "data: a\n", ": ping\n", "data: b\n\n", ":\n\n")).toEqual([
      { event: "message", data: "a\nb" },
    ]);
  });

  it("removes at most one leading space from a value", () => {
    expect(decode("data:  padded\n\n", "data:tight\n\n")).toEqual([
      { event: "message", data: " padded" },
      { event: "message", data: "tight" },
    ]);
  });

  it("handles CRLF and bare CR line endings", () => {
    expect(decode("data: a\r\n\r\ndata: b\r\rdata: c\n\n")).toEqual([
      { event: "message", data: "a" },
      { event: "message", data: "b" },
      { event: "message", data: "c" },
    ]);
  });

  it("handles CRLF split across chunks", () => {
    expect(decode("data: a\r", "\n\r", "\ndata: b\n\n")).toEqual([
      { event: "message", data: "a" },
      { event: "message", data: "b" },
    ]);
  });

  it("ignores empty chunks, even between the halves of a CRLF", () => {
    expect(decode("data: a\r", "", "\ndata: b\r\n\r\n")).toEqual([{ event: "message", data: "a\nb" }]);
  });

  it("reassembles one very long line delivered a character at a time", () => {
    const long = "z".repeat(50_000);
    const messages: SseMessage[] = [];
    const decoder = createSseDecoder((message) => messages.push(message));
    for (const char of `data: ${long}\n\n`) decoder.push(char);
    decoder.end();
    expect(messages).toEqual([{ event: "message", data: long }]);
  });

  it("reassembles events split at arbitrary positions", () => {
    const text = 'event: update\ndata: {"hello":"world"}\nid: 7\nretry: 1500\n\n';
    for (let cut = 1; cut < text.length; cut++) {
      expect(decode(text.slice(0, cut), text.slice(cut))).toEqual([
        { event: "update", data: '{"hello":"world"}', id: "7", retry: 1500 },
      ]);
    }
  });

  it("ignores unknown fields and non-numeric retry values", () => {
    expect(decode("foo: bar\nretry: soon\ndata: x\n\n")).toEqual([{ event: "message", data: "x" }]);
  });

  it("delivers a final event that is missing its blank line", () => {
    expect(decode("data: tail")).toEqual([{ event: "message", data: "tail" }]);
  });

  it("drops an incomplete block that has no data", () => {
    expect(decode("event: noop")).toEqual([]);
  });

  it("strips a leading byte order mark", () => {
    expect(decode("﻿data: x\n\n")).toEqual([{ event: "message", data: "x" }]);
  });
});

// ---------------------------------------------------------------------------
// streamRun
// ---------------------------------------------------------------------------

describe("streamRun", () => {
  it("posts JSON and delivers events in order", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => responseOf([frame(started, stepRunning, finished)]));
    const events: AgentEvent[] = [];
    await streamRun("/api/runs", { preset: "demo" }, (event) => events.push(event), undefined, {
      fetch: fetchMock,
    });

    expect(events.map((event) => event.type)).toEqual(["run_started", "step", "run_finished"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/runs");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ preset: "demo" }));
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("text/event-stream");
  });

  it("reassembles an event whose JSON is split across chunks", async () => {
    const text = frame(started, stepRunning, finished);
    const cut = text.indexOf('"label"') + 4; // inside the second event
    const events = await collect(responseOf([text.slice(0, cut), text.slice(cut)]));
    expect(events.map((event) => event.type)).toEqual(["run_started", "step", "run_finished"]);
  });

  it("reassembles events delivered one byte at a time", async () => {
    const events = await collect(responseOf(splitBytes(bytesOf(frame(started, stepDone, finished)), 1)));
    expect(events.map((event) => event.type)).toEqual(["run_started", "step", "run_finished"]);
  });

  it("delivers the same events however the bytes are chunked or terminated", async () => {
    const deltas = ["Zoë ", "– ", "🎪 ", "festival ", "café"].map((text) => ({
      type: "text_delta" as const,
      text,
    }));
    const expected: AgentEvent[] = [started, stepRunning, ...deltas, stepDone, finished];

    // Small deterministic generator so a failure can be reproduced.
    let seed = 1234;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };

    for (const eol of ["\n", "\r\n", "\r"]) {
      const text = expected
        .map((event) => `data: ${JSON.stringify(event)}${eol}${eol}`)
        .join(`: ping${eol}${eol}`);
      const bytes = bytesOf(text);
      for (let trial = 0; trial < 40; trial++) {
        const chunks: Uint8Array[] = [];
        for (let at = 0; at < bytes.length; ) {
          const size = 1 + Math.floor(random() * 19);
          chunks.push(bytes.slice(at, at + size));
          at += size;
        }
        expect(await collect(responseOf(chunks)), JSON.stringify(eol)).toEqual(expected);
      }
    }
  });

  it("delivers several events that arrive in a single chunk", async () => {
    const events = await collect(responseOf([frame(started, stepRunning, stepDone, finished)]));
    expect(events).toHaveLength(4);
    expect(events[2]).toMatchObject({ type: "step", status: "done" });
  });

  it("accepts a payload spread over several data lines", async () => {
    const pretty = JSON.stringify(started, null, 2)
      .split("\n")
      .map((line) => `data: ${line}`)
      .join("\n");
    const events = await collect(responseOf([`${pretty}\n\n`, frame(finished)]));
    expect(events.map((event) => event.type)).toEqual(["run_started", "run_finished"]);
  });

  it("ignores keep-alive comments", async () => {
    const events = await collect(
      responseOf([": keep-alive\n\n", frame(started), ": ping\n\n: ping\n\n", frame(finished)]),
    );
    expect(events.map((event) => event.type)).toEqual(["run_started", "run_finished"]);
  });

  it("decodes multi-byte characters that are split between chunks", async () => {
    const delta = { type: "text_delta", text: "Zoë – 🎪 festival" };
    const bytes = bytesOf(frame(started, delta, finished));
    const events = await collect(responseOf(splitBytes(bytes, 3)));
    expect(events[1]).toEqual(delta);
  });

  it("skips event types it does not know", async () => {
    const events = await collect(
      responseOf([frame(started, { type: "telemetry", n: 1 }, stepRunning, finished)]),
    );
    expect(events.map((event) => event.type)).toEqual(["run_started", "step", "run_finished"]);
  });

  it("surfaces malformed JSON as an error event and stops reading", async () => {
    const events = await collect(responseOf([frame(started), "data: {not json\n\n", frame(finished)]));
    expect(events.map((event) => event.type)).toEqual(["run_started", "error"]);
    expect(events[1]).toMatchObject({ type: "error", retryable: true });
  });

  it("surfaces events that break the contract as an error event", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const events = await collect(
      responseOf([frame(started, { type: "step", label: "No id", status: "running" }, finished)]),
    );
    expect(events.map((event) => event.type)).toEqual(["run_started", "error"]);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("step.id must be a string"));
  });

  it("passes on a server error and still reads the closing run_finished", async () => {
    const serverError = { type: "error", message: "Qloo is rate limiting.", retryable: true };
    const events = await collect(responseOf([frame(started, serverError, finished)]));
    expect(events).toEqual([started, serverError, finished]);
  });

  it("does not add an error when the stream closes after a server error", async () => {
    const serverError = { type: "error", message: "Qloo is rate limiting.", retryable: true };
    const events = await collect(responseOf([frame(started, serverError)]));
    expect(events).toEqual([started, serverError]);
  });

  it("stops reading at run_finished", async () => {
    const events = await collect(responseOf([frame(started, finished, stepRunning)]));
    expect(events.map((event) => event.type)).toEqual(["run_started", "run_finished"]);
  });

  it("reports a close before run_finished", async () => {
    const events = await collect(responseOf([frame(started, stepRunning)]));
    expect(events.at(-1)).toMatchObject({
      type: "error",
      message: expect.stringContaining("closed before the run finished"),
      retryable: true,
    });
  });

  it("does not report a close after run_finished", async () => {
    const events = await collect(responseOf([frame(started, finished)]));
    expect(events.map((event) => event.type)).toEqual(["run_started", "run_finished"]);
  });

  it("does not report a close after needs_input, where the run pauses", async () => {
    const question = {
      type: "needs_input",
      question: "Which one?",
      options: [{ id: "a", label: "A" }],
    };
    const events = await collect(responseOf([frame(started, stepRunning, question)]));
    expect(events.map((event) => event.type)).toEqual(["run_started", "step", "needs_input"]);
  });

  it("delivers a final event that lacks its blank line", async () => {
    const events = await collect(responseOf([frame(started), `data: ${JSON.stringify(finished)}`]));
    expect(events.map((event) => event.type)).toEqual(["run_started", "run_finished"]);
  });

  describe("HTTP failures", () => {
    it("uses the detail from a JSON error body", async () => {
      const events = await collect(
        new Response(JSON.stringify({ detail: "Scenario is not valid." }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      );
      expect(events).toEqual([{ type: "error", message: "Scenario is not valid.", retryable: false }]);
    });

    it("treats server errors as retryable", async () => {
      const events = await collect(new Response("<html>Bad gateway</html>", { status: 502 }));
      expect(events).toEqual([
        { type: "error", message: "The service is unavailable right now.", retryable: true },
      ]);
    });

    it("treats rate limiting as retryable", async () => {
      const events = await collect(new Response("", { status: 429 }));
      expect(events[0]).toMatchObject({ type: "error", retryable: true });
    });

    it("reads the first message out of a validation error list", async () => {
      const events = await collect(
        new Response(
          JSON.stringify({
            detail: [
              { loc: ["body", "input", "favorites"], msg: "List should have at least 1 item", type: "x" },
            ],
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      );
      expect(events).toEqual([
        { type: "error", message: "input.favorites: List should have at least 1 item", retryable: false },
      ]);
    });

    it("reports an empty response body", async () => {
      const events = await collect(new Response(null, { status: 200 }));
      expect(events).toEqual([
        { type: "error", message: "The server returned an empty response.", retryable: true },
      ]);
    });

    it("treats an abort it did not ask for as a retryable cancellation", async () => {
      const events = await collect(() => {
        throw new DOMException("Aborted by something else", "AbortError");
      });
      expect(events).toEqual([
        { type: "error", message: "The request was cancelled.", retryable: true },
      ]);
    });

    it("rejects for a body that cannot be serialized instead of blaming the network", async () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const fetchMock = vi.fn<typeof fetch>();
      await expect(
        streamRun("/api/runs", circular, () => undefined, undefined, { fetch: fetchMock }),
      ).rejects.toThrow(TypeError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reports an unreachable network", async () => {
      const events = await collect(() => {
        throw new TypeError("fetch failed");
      });
      expect(events).toEqual([
        {
          type: "error",
          message: "Could not reach the service. Check your connection.",
          retryable: true,
        },
      ]);
    });

    it("reports a connection that drops mid-stream", async () => {
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(bytesOf(frame(started)));
          else controller.error(new TypeError("network error"));
        },
      });
      const events = await collect(new Response(body, { status: 200 }));
      expect(events.map((event) => event.type)).toEqual(["run_started", "error"]);
      expect(events[1]).toMatchObject({ message: "The connection was interrupted." });
    });

    it("says interrupted, not unreachable, when only keep-alives arrived before the drop", async () => {
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(bytesOf(": keep-alive\n\n"));
          else controller.error(new TypeError("network error"));
        },
      });
      const events = await collect(new Response(body, { status: 200 }));
      expect(events).toEqual([
        { type: "error", message: "The connection was interrupted.", retryable: true },
      ]);
    });

    it("ignores a connection that drops after the run paused for input", async () => {
      let pulls = 0;
      const question = {
        type: "needs_input",
        question: "Which one?",
        options: [{ id: "a", label: "A" }],
      };
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(bytesOf(frame(started, question)));
          else controller.error(new TypeError("network error"));
        },
      });
      const events = await collect(new Response(body, { status: 200 }));
      expect(events.map((event) => event.type)).toEqual(["run_started", "needs_input"]);
    });
  });

  describe("abort", () => {
    it("does nothing when the signal is already aborted", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => responseOf([frame(started)]));
      const controller = new AbortController();
      controller.abort();
      const events: AgentEvent[] = [];
      await streamRun("/api/runs", {}, (event) => events.push(event), controller.signal, {
        fetch: fetchMock,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    it("stops quietly when aborted mid-stream and releases the connection", async () => {
      const controller = new AbortController();
      let body!: ReturnType<typeof openBody>;
      const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
        body = openBody(init?.signal);
        return body.response;
      });

      const events: AgentEvent[] = [];
      const run = streamRun("/api/runs", {}, (event) => events.push(event), controller.signal, {
        fetch: fetchMock,
      });
      await vi.waitFor(() => expect(body).toBeDefined());
      body.push(frame(started));
      await vi.waitFor(() => expect(events).toHaveLength(1));

      controller.abort();
      await expect(run).resolves.toBeUndefined();
      expect(events.map((event) => event.type)).toEqual(["run_started"]);
      expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    });

    it("drops events from the same chunk once the caller has aborted", async () => {
      const controller = new AbortController();
      const events: AgentEvent[] = [];
      await streamRun(
        "/api/runs",
        {},
        (event) => {
          events.push(event);
          controller.abort(); // abort while more events are already buffered
        },
        controller.signal,
        { fetch: async () => responseOf([frame(started, stepRunning, finished)]) },
      );
      expect(events.map((event) => event.type)).toEqual(["run_started"]);
    });

    it.each([
      ["the run finishes", frame(started, finished)],
      ["an event cannot be trusted", `${frame(started)}data: {not json\n\n`],
    ])("cancels a body that stays open when %s", async (_label, chunk) => {
      let body!: ReturnType<typeof openBody>;
      const run = streamRun("/api/runs", {}, () => undefined, undefined, {
        fetch: async (_url, init) => {
          body = openBody(init?.signal);
          return body.response;
        },
      });
      await vi.waitFor(() => expect(body).toBeDefined());
      body.push(chunk);
      await run; // resolves without the server ever closing the stream
      expect(body.state.cancelled).toBe(true);
    });
  });

  describe("idle watchdog", () => {
    it("reports a stalled connection", async () => {
      vi.useFakeTimers();
      let body!: ReturnType<typeof openBody>;
      const events: AgentEvent[] = [];
      const run = streamRun("/api/runs", {}, (event) => events.push(event), undefined, {
        idleTimeoutMs: 5_000,
        fetch: async (_url, init) => {
          body = openBody(init?.signal);
          return body.response;
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      body.push(frame(started));
      await vi.advanceTimersByTimeAsync(5_001);
      await run;
      expect(events.map((event) => event.type)).toEqual(["run_started", "error"]);
      expect(events[1]).toMatchObject({ message: "The connection stalled.", retryable: true });
    });

    it("treats keep-alive comments as activity", async () => {
      vi.useFakeTimers();
      let body!: ReturnType<typeof openBody>;
      const events: AgentEvent[] = [];
      const run = streamRun("/api/runs", {}, (event) => events.push(event), undefined, {
        idleTimeoutMs: 5_000,
        fetch: async (_url, init) => {
          body = openBody(init?.signal);
          return body.response;
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      body.push(frame(started));
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(4_000);
        body.push(": keep-alive\n\n");
      }
      body.push(frame(finished));
      body.close();
      await run;
      expect(events.map((event) => event.type)).toEqual(["run_started", "run_finished"]);
    });

    it("stays quiet when a connection that was left open goes silent after the run paused", async () => {
      vi.useFakeTimers();
      let body!: ReturnType<typeof openBody>;
      const events: AgentEvent[] = [];
      const question = {
        type: "needs_input",
        question: "Which one?",
        options: [{ id: "a", label: "A" }],
      };
      const run = streamRun("/api/runs", {}, (event) => events.push(event), undefined, {
        idleTimeoutMs: 5_000,
        fetch: async (_url, init) => {
          body = openBody(init?.signal);
          return body.response;
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      body.push(frame(started, question));
      await vi.advanceTimersByTimeAsync(5_001);
      await run;
      expect(events.map((event) => event.type)).toEqual(["run_started", "needs_input"]);
    });

    it("does not watch for silence when idleTimeoutMs is 0", async () => {
      vi.useFakeTimers();
      let body!: ReturnType<typeof openBody>;
      const events: AgentEvent[] = [];
      const run = streamRun("/api/runs", {}, (event) => events.push(event), undefined, {
        idleTimeoutMs: 0,
        fetch: async (_url, init) => {
          body = openBody(init?.signal);
          return body.response;
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      body.push(frame(started));
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // an hour of silence
      body.push(frame(finished));
      await run;
      expect(events.map((event) => event.type)).toEqual(["run_started", "run_finished"]);
    });
  });

  describe("cleanup", () => {
    it("leaves no timer and no abort listener behind after a run", async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const removed = vi.spyOn(controller.signal, "removeEventListener");
      await streamRun("/api/runs", {}, () => undefined, controller.signal, {
        idleTimeoutMs: 5_000,
        fetch: async () => responseOf([frame(started, finished)]),
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    });

    it("leaves no timer behind after a failure", async () => {
      vi.useFakeTimers();
      await collect(() => {
        throw new TypeError("fetch failed");
      });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("rejects when the event handler throws instead of misreporting a network error", async () => {
    const run = streamRun(
      "/api/runs",
      {},
      () => {
        throw new TypeError("handler bug");
      },
      undefined,
      { fetch: async () => responseOf([frame(started, finished)]) },
    );
    await expect(run).rejects.toThrow("handler bug");
  });
});
