"use client";

import { useCallback, useEffect, useState } from "react";

import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";
import { mockPreset, mockPresetList } from "@/lib/mock-preset";
import {
  parsePreset,
  parsePresetList,
  PresetFormatError,
  type Preset,
  type PresetSummary,
} from "@/lib/preset";

export type LoadError = { message: string; retryable: boolean };

type Outcome<T> = { ok: true; value: T } | { ok: false; error: LoadError };

export type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; error: LoadError }
  | { status: "ready"; value: T };

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new HttpError(response.status);
  return response.json();
}

function describeFailure(error: unknown, what: string): LoadError {
  if (error instanceof PresetFormatError) {
    return {
      message: `The ${what} arrived in a shape this page does not understand (${error.message}).`,
      retryable: false,
    };
  }
  if (error instanceof HttpError && error.status === 404) {
    return { message: `The ${what} was not found on the server.`, retryable: false };
  }
  return {
    message: `The scoring service did not answer with the ${what}. It may be starting up or briefly offline.`,
    retryable: true,
  };
}

async function settle<T>(work: () => Promise<T>, what: string): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: describeFailure(error, what) };
  }
}

function loadList(signal: AbortSignal): Promise<PresetSummary[]> {
  if (MOCK_STREAM_ENABLED) return Promise.resolve(mockPresetList());
  return getJson("/api/presets", signal).then(parsePresetList);
}

function loadPreset(id: string, signal: AbortSignal): Promise<Preset> {
  if (MOCK_STREAM_ENABLED) return Promise.resolve(mockPreset());
  return getJson(`/api/presets/${encodeURIComponent(id)}`, signal).then(parsePreset);
}

function toState<T>(entry: { attempt: number; outcome: Outcome<T> } | undefined, attempt: number): LoadState<T> {
  // A result from an earlier attempt still counts as loading while a retry is in flight,
  // unless it succeeded (then there is nothing to retry).
  if (!entry || (entry.attempt !== attempt && !entry.outcome.ok)) return { status: "loading" };
  return entry.outcome.ok
    ? { status: "ready", value: entry.outcome.value }
    : { status: "error", error: entry.outcome.error };
}

/**
 * Loads the preset list, then the chosen preset (the first one unless `requestedId` names another).
 * Presets already loaded are kept, so switching back is instant. In mock mode the synthetic
 * preset is served without touching the network.
 */
export function usePresets(requestedId: string | null) {
  const [listAttempt, setListAttempt] = useState(0);
  const [presetAttempt, setPresetAttempt] = useState(0);
  const [listEntry, setListEntry] = useState<{ attempt: number; outcome: Outcome<PresetSummary[]> }>();
  const [presetEntries, setPresetEntries] = useState<
    Record<string, { attempt: number; outcome: Outcome<Preset> }>
  >({});

  useEffect(() => {
    const controller = new AbortController();
    settle(() => loadList(controller.signal), "list of festival days").then((outcome) => {
      if (controller.signal.aborted) return;
      setListEntry({ attempt: listAttempt, outcome });
    });
    return () => controller.abort();
  }, [listAttempt]);

  const list = toState(listEntry, listAttempt);
  const presets = list.status === "ready" ? list.value : null;
  const selectedId =
    presets && presets.length > 0
      ? (presets.find((item) => item.id === requestedId) ?? presets[0]).id
      : null;
  const selectedEntry = selectedId ? presetEntries[selectedId] : undefined;
  const needsFetch =
    selectedId !== null &&
    (!selectedEntry || (!selectedEntry.outcome.ok && selectedEntry.attempt !== presetAttempt));

  useEffect(() => {
    if (!needsFetch || selectedId === null) return;
    const controller = new AbortController();
    settle(() => loadPreset(selectedId, controller.signal), "festival day").then((outcome) => {
      if (controller.signal.aborted) return;
      setPresetEntries((previous) => ({ ...previous, [selectedId]: { attempt: presetAttempt, outcome } }));
    });
    return () => controller.abort();
  }, [needsFetch, selectedId, presetAttempt]);

  const preset: LoadState<Preset> =
    selectedId === null ? { status: "loading" } : toState(selectedEntry, presetAttempt);

  const retry = useCallback(() => {
    if (list.status === "error") setListAttempt((n) => n + 1);
    else setPresetAttempt((n) => n + 1);
  }, [list.status]);

  return { list, preset, selectedId, retry };
}
