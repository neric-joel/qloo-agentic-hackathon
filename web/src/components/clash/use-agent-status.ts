"use client";

import { useEffect, useState } from "react";

import { pairCheckEnabled, parseHealth, type AgentStatus } from "@/lib/agent-status";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

/** How long the health check may take before the page stops waiting for it. */
export const HEALTH_TIMEOUT_MS = 4000;

/** The one `/api/health` request every hook on the page shares. */
let healthRequest: Promise<unknown> | null = null;
/** Its answer once it has one, so a hook mounted later starts from it instead of waiting. */
let healthAnswer: { json: unknown } | null = null;

/**
 * Asks `/api/health` once per page. The promise settles with the decoded body, or null when the
 * server answers with an error status. A network failure or an error status is not kept, so a hook
 * mounted later asks again.
 */
function loadHealth(): Promise<unknown> {
  if (healthRequest) return healthRequest;
  const request = fetch("/api/health", { cache: "no-store", headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) {
        healthRequest = null;
        return null;
      }
      const json: unknown = await response.json();
      healthAnswer = { json };
      return json;
    })
    .catch((error: unknown) => {
      healthRequest = null;
      throw error;
    });
  healthRequest = request;
  return request;
}

/**
 * Asks `/api/health` whether the live agent can answer here. "checking" while the check is in
 * flight; "unknown" when it fails or takes longer than `HEALTH_TIMEOUT_MS`, and in mock mode (the
 * simulated agent needs no language model). An answer that arrives after the timeout still counts,
 * so a slow server that reports the agent off still gets the off notice. The check never starts an
 * agent run.
 */
export function useAgentStatus(): AgentStatus {
  const [status, setStatus] = useState<AgentStatus>(MOCK_STREAM_ENABLED ? "unknown" : "checking");

  useEffect(() => {
    if (MOCK_STREAM_ENABLED) return;
    let active = true;
    const timer = setTimeout(() => {
      setStatus((current) => (current === "checking" ? "unknown" : current));
    }, HEALTH_TIMEOUT_MS);
    loadHealth()
      .then((json) => {
        if (active) setStatus(parseHealth(json));
      })
      .catch(() => {
        if (active) setStatus("unknown");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  return status;
}

/**
 * Whether this server answers live pair checks, from the same health request. False until the
 * health answer says `pair_check: true`, when the check fails, and in mock mode. Reading it never
 * starts a check.
 */
export function usePairCheckEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => !MOCK_STREAM_ENABLED && pairCheckEnabled(healthAnswer?.json));

  useEffect(() => {
    if (MOCK_STREAM_ENABLED) return;
    let active = true;
    loadHealth()
      .then((json) => {
        if (active) setEnabled(pairCheckEnabled(json));
      })
      .catch(() => {
        if (active) setEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return MOCK_STREAM_ENABLED ? false : enabled;
}
