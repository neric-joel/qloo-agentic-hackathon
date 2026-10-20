"use client";

import { useEffect, useState } from "react";

import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";
import { parseRecordings, type RecordedRun } from "@/lib/recorded-run";

/** Another festival day whose recordings this page has already loaded, with the title it was asked with. */
export type LoadedDay = { presetId: string; title: string; runs: RecordedRun[] };

export type RecordingsState = {
  status: "loading" | "ready" | "error";
  runs: RecordedRun[];
  /** Other days already loaded on this page (never fetched for this): read for a pointer, never on load. */
  others?: LoadedDay[];
};

const READY_EMPTY: RecordingsState = { status: "ready", runs: [] };
const LOADING: RecordingsState = { status: "loading", runs: [] };

/** One request per festival day, shared by every component that asks (the hero and the panel). */
const requests = new Map<string, Promise<RecordedRun[]>>();
/** The answers already in, by festival day, so a later day can point back at what an earlier one holds. */
const settled = new Map<string, RecordedRun[]>();
/** The title each day was asked with, when the asker gave one. */
const titles = new Map<string, string>();

function loadRecordings(presetId: string): Promise<RecordedRun[]> {
  const cached = requests.get(presetId);
  if (cached) return cached;
  const request = fetch(`/api/presets/${encodeURIComponent(presetId)}/recordings`, {
    headers: { Accept: "application/json" },
  })
    // A day with no recordings (404 included) or an unreadable answer simply has none to show.
    .then((response) => (response.ok ? response.json().catch(() => null) : null))
    .then((json) => {
      const runs = parseRecordings(json);
      settled.set(presetId, runs);
      return runs;
    })
    .catch(() => {
      // A network failure is not an answer: let a later visit to this day ask again.
      requests.delete(presetId);
      return [];
    });
  requests.set(presetId, request);
  return request;
}

/** The other days whose recordings are already in, with a title: nothing is fetched for them. */
function loadedOthers(presetId: string): LoadedDay[] {
  const others: LoadedDay[] = [];
  for (const [id, runs] of settled) {
    const title = titles.get(id);
    if (id !== presetId && title && runs.length > 0) others.push({ presetId: id, title, runs });
  }
  return others;
}

/**
 * The recorded agent runs for a festival day (`GET /api/presets/{id}/recordings`), in the server's order (the
 * panel puts them in its own, `orderRecordings`). Loading until the request settles, then ready, with no runs
 * when the day has none, the server does not answer or the answer cannot be read. In mock mode there are none
 * and nothing is fetched. Fetching never starts an agent run. `title` names the day for a later day's pointer
 * back at it; `others` lists the other days already loaded on this page, so a pointer never needs a fetch of
 * its own.
 */
export function useRecordings(presetId: string, title?: string): RecordingsState {
  const [loaded, setLoaded] = useState<{ presetId: string; runs: RecordedRun[] } | null>(null);

  useEffect(() => {
    if (title) titles.set(presetId, title);
  }, [presetId, title]);

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
  return loaded?.presetId === presetId
    ? { status: "ready", runs: loaded.runs, others: loadedOthers(presetId) }
    : LOADING;
}
