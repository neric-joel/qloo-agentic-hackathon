import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CHECK_COPY } from "@/lib/check";

import { PAPER } from "./check-brief";

const SRC = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
/** The retired warm print palette (ink, muted and rule). */
const WARM = ["#1a1714", "#f1efeb", "#c9c4bc", "#4d4843", "#6f6962", "#f3d75a"];
/**
 * True for a warm, saturated hex (hue 15 to 75): the retired red-orange accent family (round 34). Shared time is
 * raspberry and a rule break is ink, on paper as on screen, so no print colour may fall in it.
 */
function warmAccent(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < 0.25) return false;
  const hue = max === r ? (60 * ((g - b) / chroma) + 360) % 360 : max === g ? 60 * ((b - r) / chroma) + 120 : 60 * ((r - g) / chroma) + 240;
  return hue >= 15 && hue <= 75;
}
const hexes = (text: string) => text.match(/#[0-9a-f]{6}\b/gi) ?? [];
/**
 * The cool ink on white every print block now carries: raspberry for shared minutes only, and the rule-break
 * colour is the light ink, so a printed break reads in ink with its number and words.
 */
const COOL = {
  "--background": "#ffffff",
  "--foreground": "#141821",
  "--card": "#ffffff",
  "--card-foreground": "#141821",
  "--muted": "#e5e8ec",
  "--muted-foreground": "#525864",
  "--border": "#d6d9de",
  "--border-strong": "#7b818a",
  "--primary": "#b61b75",
  "--destructive": "#141821",
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
      expect(hexes(block).filter(warmAccent)).toEqual([]);
      for (const [token, value] of Object.entries(COOL)) expect(block).toContain(`${token}: ${value};`);
      expect(COOL["--destructive"]).toBe(COOL["--foreground"]);
      expect(block).toContain("color: #141821;");
    });
  }

  it("draws the brief's on-screen preview in the same palette", () => {
    const values = Object.values(PAPER).map((value) => String(value).toLowerCase());
    for (const hex of WARM) expect(values).not.toContain(hex);
    expect(values.filter((value) => /^#[0-9a-f]{6}$/.test(value)).filter(warmAccent)).toEqual([]);
    expect(hexes(read("components/check/check-brief.tsx")).filter(warmAccent)).toEqual([]);
    // The check itself catches a red-orange like the retired accent (rgb 217 72 15), unlike the raspberry that replaced it.
    const redOrange = `#${[217, 72, 15].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    expect(warmAccent(redOrange)).toBe(true);
    expect(warmAccent(COOL["--primary"])).toBe(false);
    for (const [token, value] of Object.entries(COOL)) expect((PAPER as Record<string, unknown>)[token]).toBe(value);
    expect(PAPER.color).toBe("#141821");
    expect(PAPER.background).toBe("#ffffff");
  });

  it("keeps the brief's own words", () => {
    expect(CHECK_COPY.printTitle).toBe("Draft check, not a verdict");
    expect(read("components/check/check-brief.tsx")).toContain("CHECK_COPY.printTitle");
  });
});
