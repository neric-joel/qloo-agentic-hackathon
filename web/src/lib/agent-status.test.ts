import { describe, expect, it } from "vitest";

import { pairCheckEnabled, panelMode, parseHealth } from "./agent-status";

describe("parseHealth", () => {
  it("reads whether the language model is configured", () => {
    expect(parseHealth({ status: "ok", qloo_key_configured: true, llm_configured: true })).toBe("on");
    expect(parseHealth({ status: "ok", qloo_key_configured: true, llm_configured: false })).toBe("off");
  });

  it("is unknown for anything else", () => {
    expect(parseHealth({ status: "ok" })).toBe("unknown");
    expect(parseHealth({ llm_configured: "false" })).toBe("unknown");
    expect(parseHealth({ llm_configured: null })).toBe("unknown");
    expect(parseHealth({ llm_configured: 0 })).toBe("unknown");
    expect(parseHealth(null)).toBe("unknown");
    expect(parseHealth(undefined)).toBe("unknown");
    expect(parseHealth("ok")).toBe("unknown");
    expect(parseHealth([{ llm_configured: false }])).toBe("unknown");
  });
});

describe("panelMode", () => {
  it("shows the placeholder while the health check is in flight", () => {
    expect(panelMode("checking", false)).toBe("checking");
    expect(panelMode("checking", true)).toBe("checking");
  });

  it("shows the live panel when the agent is on or its state is unknown", () => {
    for (const recordings of [true, false]) {
      expect(panelMode("on", recordings)).toBe("live");
      expect(panelMode("unknown", recordings)).toBe("live");
    }
  });

  it("offers recorded runs when the agent is off and there are some", () => {
    expect(panelMode("off", true)).toBe("off-recorded");
    expect(panelMode("off", false)).toBe("off");
  });

  it("keeps the placeholder for an off agent until the recorded runs have loaded", () => {
    expect(panelMode("off", false, true)).toBe("checking");
    expect(panelMode("off", true, false)).toBe("off-recorded");
    expect(panelMode("on", false, true)).toBe("live");
  });
});

describe("pairCheckEnabled", () => {
  it("is true only when the health answer says pair_check is true", () => {
    expect(pairCheckEnabled({ status: "ok", llm_configured: false, pair_check: true })).toBe(true);
  });

  it("is false for a missing flag, any other value or no answer", () => {
    expect(pairCheckEnabled({ status: "ok", llm_configured: true })).toBe(false);
    expect(pairCheckEnabled({ pair_check: false })).toBe(false);
    expect(pairCheckEnabled({ pair_check: "true" })).toBe(false);
    expect(pairCheckEnabled({ pair_check: 1 })).toBe(false);
    expect(pairCheckEnabled({ pair_check: null })).toBe(false);
    expect(pairCheckEnabled(null)).toBe(false);
    expect(pairCheckEnabled(undefined)).toBe(false);
    expect(pairCheckEnabled([{ pair_check: true }])).toBe(false);
  });

  it("leaves the agent status as it was", () => {
    expect(parseHealth({ llm_configured: false, pair_check: true })).toBe("off");
    expect(parseHealth({ llm_configured: true, pair_check: false })).toBe("on");
  });
});
