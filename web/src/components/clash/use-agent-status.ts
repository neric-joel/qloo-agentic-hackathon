"use client";

import { useEffect, useState } from "react";

import { parseHealth, type AgentStatus } from "@/lib/agent-status";
import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

/**
 * Asks `/api/health` once, on mount, whether the live agent can answer here. Stays "unknown" while
 * the check is in flight, when it fails, and in mock mode (the simulated agent needs no language
 * model). The check never starts an agent run.
 */
export function useAgentStatus(): AgentStatus {
  const [status, setStatus] = useState<AgentStatus>("unknown");

  useEffect(() => {
    if (MOCK_STREAM_ENABLED) return;
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: unknown) => {
        if (!controller.signal.aborted) setStatus(parseHealth(json));
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("unknown");
      });
    return () => controller.abort();
  }, []);

  return status;
}
