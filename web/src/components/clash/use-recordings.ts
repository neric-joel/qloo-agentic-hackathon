"use client";

import { useEffect, useState } from "react";

import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";
import { parseRecordings, type RecordedRun } from "@/lib/recorded-run";

export type RecordingsState = { status: "loading" | "ready" | "error"; runs: RecordedRun[] };

const READY_EMPTY: RecordingsState = { status: "ready", runs: [] };
const LOADING: RecordingsState = { status: "loading", runs: [] };

/** One request per festival day, shared by every component that asks (the hero and the panel). */
const requests = new Map<string, Promise<RecordedRun[]>>();

function loadRecordings(presetId: string): Promise<RecordedRun[]> {
  const cached = requests.get(presetId);
  if (cached) return cached;
  const request = fetch(`/api/presets/${encodeURIComponent(presetId)}/recordings`, {
    headers: { Accept: "application/json" },
  })
    // A day with no recordings (404 included) or an unreadable answer simply has none to show.
    .then((response) => (response.ok ? response.json().catch(() => null) : null))
    .then(parseRecordings)
    .catch(() => {
      // A network failure is not an answer: let a later visit to this day ask again.
      requests.delete(presetId);
      return [];
    });
  requests.set(presetId, request);
  return request;
}

/**
 * The recorded agent runs for a festival day (`GET /api/presets/{id}/recordings`). Loading until
 * the request settles, then ready, with no runs when the day has none, the server does not answer
 * or the answer cannot be read. In mock mode there are none and nothing is fetched. Fetching never
 * starts an agent run.
 */
export function useRecordings(presetId: string): RecordingsState {
  const [loaded, setLoaded] = useState<{ presetId: string; runs: RecordedRun[] } | null>(null);

  useEffect(() => {
    if (MOCK_STREAM_ENABLED) return;
    let active = true;
    loadRecordings(presetId).then((runs) => {
      if (active) setLoaded({ presetId, runs });
    });
    return () => {
      active = false;
    };
  }, [presetId]);

  if (MOCK_STREAM_ENABLED) return READY_EMPTY;
  return loaded?.presetId === presetId ? { status: "ready", runs: loaded.runs } : LOADING;
}
