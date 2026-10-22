import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { CHECK_COPY, runCheck } from "@/lib/check";

import { CheckBrief, PAPER } from "./check-brief";

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

describe("round 37: the printed overlap list and the named skipped lines", () => {
  // Invented acts: fourteen sets in seven pairs of two stages, each pair sharing a different number of minutes,
  // and one line whose start cannot be read.
  const grid = [
    ...Array.from({ length: 14 }, (_, i) => {
      const hour = 10 + Math.floor(i / 2);
      const pair = Math.floor(i / 2);
      return i % 2 === 0 ? `Lark ${pair},North,${hour}:00,${hour}:50` : `Wren ${pair},South,${hour}:${String(50 - 5 - pair * 5).padStart(2, "0")},${hour}:55`;
    }),
    "Glass Harbour,Tent,25:70,19:30",
  ].join("\n");
  const outcome = runCheck({ grid, changeover: "", curfew: "", pairs: "" });
  if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
  const html = renderToStaticMarkup(createElement(CheckBrief, { report: outcome.report, applied: [], decisions: [], price: null }));
  const block = (hook: string) => html.match(new RegExp(`<(?:div|ul) ${hook}="" class="([^"]*)">([\\s\\S]*?)</(?:div|ul)>(?!</li>)`));

  it("prints the overlaps longest first in ink, on paper only, with no colour of their own", () => {
    expect(outcome.report.shared).toHaveLength(7);
    const overlaps = block("data-brief-overlaps");
    expect(overlaps?.[1].split(" ")).toEqual(["hidden", "print:block"]);
    const lines = [...(overlaps?.[2] ?? "").matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);
    expect(lines).toEqual([
      "Lark 0 × Wren 0: 5 min (10:45–10:50)",
      "Lark 1 × Wren 1: 10 min (11:40–11:50)",
      "Lark 2 × Wren 2: 15 min (12:35–12:50)",
      "Lark 3 × Wren 3: 20 min (13:30–13:50)",
      "Lark 4 × Wren 4: 25 min (14:25–14:50)",
      "Lark 5 × Wren 5: 30 min (15:20–15:50)",
      "Lark 6 × Wren 6: 35 min (16:15–16:50)",
    ].reverse());
    // Ink on paper: raspberry is for the screen's shared minutes, and a list line is words.
    expect(overlaps?.[0]).not.toMatch(/text-primary|text-prov|text-warning|bg-/);
  });

  it("names the skipped line under the skipped sentence, on paper only", () => {
    const skipped = block("data-brief-skipped-lines");
    expect(skipped?.[1].split(" ")).toEqual(expect.arrayContaining(["hidden", "print:block"]));
    expect(skipped?.[2]).toContain("Line 15 (Glass Harbour, start “25:70”) skipped and not checked.");
    expect(html.indexOf("data-brief-skipped=")).toBeLessThan(html.indexOf("data-brief-skipped-lines"));
    expect(html.indexOf("data-brief-skipped-lines")).toBeLessThan(html.indexOf("data-brief-overlaps"));
  });
});
