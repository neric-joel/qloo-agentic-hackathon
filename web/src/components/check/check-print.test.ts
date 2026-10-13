import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CHECK_COPY } from "@/lib/check";

import { PAPER } from "./check-brief";

const SRC = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
/** The retired warm print palette (ink, muted and rule). */
const WARM = ["#1a1714", "#f1efeb", "#c9c4bc", "#4d4843", "#6f6962", "#f3d75a"];
/** The cool ink on white every print block now carries. */
const COOL = {
  "--background": "#ffffff",
  "--foreground": "#141821",
  "--card": "#ffffff",
  "--card-foreground": "#141821",
  "--muted": "#e5e8ec",
  "--muted-foreground": "#525864",
  "--border": "#d6d9de",
  "--border-strong": "#7b818a",
  "--primary": "#ca2a02",
  "--destructive": "#ca2a02",
  "--highlight": "#c7dcfc",
  "--highlight-foreground": "#141821",
};

describe("print tokens: cool ink on white", () => {
  for (const page of ["app/check/page.tsx", "app/brief/page.tsx"]) {
    it(`${page} prints with no warm hex and every cool token`, () => {
      const source = read(page);
      const block = source.slice(source.indexOf("@media print"), source.indexOf("`;", source.indexOf("@media print")));
      expect(block).not.toBe("");
      for (const hex of WARM) expect(block.toLowerCase()).not.toContain(hex);
      for (const [token, value] of Object.entries(COOL)) expect(block).toContain(`${token}: ${value};`);
      expect(block).toContain("color: #141821;");
    });
  }

  it("draws the brief's on-screen preview in the same palette", () => {
    const values = Object.values(PAPER).map((value) => String(value).toLowerCase());
    for (const hex of WARM) expect(values).not.toContain(hex);
    for (const [token, value] of Object.entries(COOL)) expect((PAPER as Record<string, unknown>)[token]).toBe(value);
    expect(PAPER.color).toBe("#141821");
    expect(PAPER.background).toBe("#ffffff");
  });

  it("keeps the brief's own words", () => {
    expect(CHECK_COPY.printTitle).toBe("Draft check, not a verdict");
    expect(read("components/check/check-brief.tsx")).toContain("CHECK_COPY.printTitle");
  });
});
