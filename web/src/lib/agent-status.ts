/**
 * Whether the live agent can answer here. `GET /api/health` reports `llm_configured`; the agent
 * panel switches to a plain notice when it is false, so nothing on the page looks broken while the
 * language model is off. Reading the health check never calls the model.
 */

import { isRecord } from "./events";

export type AgentStatus = "unknown" | "on" | "off";

/** `llm_configured: true` is "on", `false` is "off", and anything else (including no answer) is "unknown". */
export function parseHealth(json: unknown): AgentStatus {
  if (!isRecord(json)) return "unknown";
  if (json.llm_configured === true) return "on";
  if (json.llm_configured === false) return "off";
  return "unknown";
}
