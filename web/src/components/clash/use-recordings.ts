"use client";

import { useEffect, useState } from "react";

import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";
import { parseRecordings, type RecordedRun } from "@/lib/recorded-run";

export type RecordingsState = {
  status: "loading" | "ready" | "error";
  runs: RecordedRun[];
};

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
    .then((json) => parseRecordings(json))
    .catch(() => {
      // A network failure is not an answer: let a later visit to this day ask again.
      requests.delete(presetId);
      return [];
    });
  requests.set(presetId, request);
  return request;
}

/**
 * The recorded agent runs for a festival day (`GET /api/presets/{id}/recordings`), in the server's order (the
 * panel puts them in its own, `orderRecordings`). Loading until the request settles, then ready, with no runs
 * when the day has none, the server does not answer or the answer cannot be read. In mock mode there are none
 * and nothing is fetched. Fetching never starts an agent run.
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

/** Each shown day and other day this page has already asked for, as `shown>other`. */
const askedFrom = new Set<string>();

const NONE: ReadonlyMap<string, RecordedRun[]> = new Map();

/**
 * Another day's recordings for a shown day's pointer: the request already made for that day when there is one
 * (in flight or answered: no new fetch), else a new one, at most once per page load for each shown day. Null
 * when this shown day has asked before and that request failed: it is not asked again.
 */
function otherDayRecordings(shownId: string, otherId: string): Promise<RecordedRun[]> | null {
  const pending = requests.get(otherId);
  if (pending) return pending;
  const pair = `${shownId}>${otherId}`;
  if (askedFrom.has(pair)) return null;
  askedFrom.add(pair);
  return loadRecordings(otherId);
}

/**
 * The recorded runs of other festival days, for the shown day's pointer to a run that asked Qloo: read only while
 * `enabled` (the panel enables it on a published day whose own runs hold no Qloo request), from
 * `GET /api/presets/{id}/recordings`, never on the invented day and never for the shown day itself. Each day is
 * asked at most once per page load per shown day (`otherDayRecordings`); a failed request shows nothing. In mock
 * mode nothing is fetched. Returns the runs of each day that answered, by preset id.
 */
export function useOtherDaysRecordings(
  shownId: string,
  otherIds: readonly string[],
  enabled: boolean,
): ReadonlyMap<string, RecordedRun[]> {
  const [loaded, setLoaded] = useState<{ shownId: string; days: ReadonlyMap<string, RecordedRun[]> } | null>(null);
  const key = enabled && !MOCK_STREAM_ENABLED ? otherIds.filter((id) => id !== shownId).join("|") : "";

  useEffect(() => {
    if (key === "") return;
    let active = true;
    const ids = key.split("|");
    const asked = ids.map((id) => otherDayRecordings(shownId, id));
    void Promise.all(asked.map((request) => request ?? Promise.resolve(null))).then((answers) => {
      if (!active) return;
      const days = new Map<string, RecordedRun[]>();
      answers.forEach((runs, i) => {
        if (runs) days.set(ids[i], runs);
      });
      setLoaded({ shownId, days });
    });
    return () => {
      active = false;
    };
  }, [shownId, key]);

  return key !== "" && loaded?.shownId === shownId ? loaded.days : NONE;
}
