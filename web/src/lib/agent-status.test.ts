import { describe, expect, it } from "vitest";

import { parseHealth } from "./agent-status";

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
