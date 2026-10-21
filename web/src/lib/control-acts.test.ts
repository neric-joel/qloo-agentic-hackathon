import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONTROL_ACTS, CONTROL_RANK_LIMIT, isControlQuery } from "./control-acts";

/** The backend module that resolves the control acts and checks their rank. */
const OVERLAP_PY = fileURLToPath(new URL("../../../backend/app/qloo/overlap.py", import.meta.url));

describe("control acts", () => {
  const source = readFileSync(OVERLAP_PY, "utf-8");

  it("lists the backend's control acts, in its order", () => {
    const tuple = /^CONTROL_ARTISTS\s*=\s*\(([^)]*)\)/m.exec(source);
    expect(tuple, "CONTROL_ARTISTS in overlap.py").not.toBeNull();
    const names = [...(tuple?.[1] ?? "").matchAll(/"([^"]*)"|'([^']*)'/g)].map((match) => match[1] ?? match[2]);
    expect(names).toEqual([...CONTROL_ACTS]);
    expect(CONTROL_ACTS).toEqual(["Vienna Philharmonic", "Raffi", "Frankie Yankovic", "Mormon Tabernacle Choir"]);
  });

  it("uses the backend's limit for a control act's rank", () => {
    expect(source).toContain("control_rank <= 0.35");
    expect(CONTROL_RANK_LIMIT).toBe(0.35);
  });

  it("matches a search query to a control act by its whole name, ignoring case and outer spaces", () => {
    for (const name of CONTROL_ACTS) expect(isControlQuery(name), name).toBe(true);
    expect(isControlQuery("  raffi ")).toBe(true);
    expect(isControlQuery("MORMON TABERNACLE CHOIR")).toBe(true);
    expect(isControlQuery("Vienna")).toBe(false);
    expect(isControlQuery("Raffi Cavoukian")).toBe(false);
    expect(isControlQuery("Vienna  Philharmonic")).toBe(false);
    expect(isControlQuery("")).toBe(false);
    expect(isControlQuery("Joy Crookes")).toBe(false);
  });
});
