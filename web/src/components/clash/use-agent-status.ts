"use client";

import { useEffect, useState } from "react";

import { parseHealth, type AgentStatus } from "@/lib/agent-status";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

/** How long the health check may take before the page stops waiting for it. */
export const HEALTH_TIMEOUT_MS = 4000;

/**
 * Asks `/api/health` once, on mount, whether the live agent can answer here. "checking" while the
 * check is in flight; "unknown" when it fails or takes longer than `HEALTH_TIMEOUT_MS`, and in mock
 * mode (the simulated agent needs no language model). An answer that arrives after the timeout
 * still counts, so a slow server that reports the agent off still gets the off notice. The check
 * never starts an agent run.
 */
export function useAgentStatus(): AgentStatus {
  const [status, setStatus] = useState<AgentStatus>(MOCK_STREAM_ENABLED ? "unknown" : "checking");

  useEffect(() => {
    if (MOCK_STREAM_ENABLED) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus((current) => (current === "checking" ? "unknown" : current));
    }, HEALTH_TIMEOUT_MS);
    fetch("/api/health", { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: unknown) => {
        if (!controller.signal.aborted) setStatus(parseHealth(json));
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("unknown");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return status;
}
