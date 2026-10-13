/**
 * Whether the live agent can answer here. `GET /api/health` reports `llm_configured`; the agent
 * panel switches to a plain notice when it is false, so nothing on the page looks broken while the
 * language model is off. Reading the health check never calls the model.
 */

import { isRecord } from "./events";

/** "checking" until the health check answers; "unknown" when it fails or takes too long. */
export type AgentStatus = "checking" | "unknown" | "on" | "off";

/** `llm_configured: true` is "on", `false` is "off", and anything else (including no answer) is "unknown". */
export function parseHealth(json: unknown): AgentStatus {
  if (!isRecord(json)) return "unknown";
  if (json.llm_configured === true) return "on";
  if (json.llm_configured === false) return "off";
  return "unknown";
}

/**
 * Whether this server answers live pair checks (`GET /api/pair`). True only for `pair_check: true`
 * in the health answer; a missing field, any other value or no answer at all means off, so the clash
 * drawer never offers a check the server would refuse. Reading the health check calls nothing else.
 */
export function pairCheckEnabled(json: unknown): boolean {
  return isRecord(json) && json.pair_check === true;
}

/**
 * Whether this server prices a pasted grid live with Qloo (`POST /api/price-grid` with mode "live"). True
 * only for `price_grid_live: true` in the health answer; a missing field, any other value or no answer at
 * all means off, so the check page never offers to ask Qloo when the server would refuse. Reading the
 * health check calls nothing else.
 */
export function isPriceGridLive(json: unknown): boolean {
  return isRecord(json) && json.price_grid_live === true;
}

/**
 * What the agent panel shows:
 * - "checking": a placeholder while the health check is in flight (no question box yet);
 * - "live": the question box, for "on" and for "unknown" (a failed check must not hide the agent);
 * - "off-recorded": the agent is off and recorded runs can be watched instead;
 * - "off": the agent is off and there is nothing recorded to show.
 *
 * `hasRecordings` is true once the recorded runs have loaded and there is at least one. While they
 * are still loading (`recordingsLoading`), an "off" agent keeps the placeholder, so the panel does
 * not flash the plain notice before the recorded runs arrive.
 */
export function panelMode(
  status: AgentStatus,
  hasRecordings: boolean,
  recordingsLoading = false,
): "checking" | "live" | "off-recorded" | "off" {
  if (status === "checking") return "checking";
  if (status === "on" || status === "unknown") return "live";
  if (hasRecordings) return "off-recorded";
  return recordingsLoading ? "checking" : "off";
}
