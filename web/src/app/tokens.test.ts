import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * The colour tokens in globals.css, checked as a browser paints them: each oklch value goes to
 * oklab, then linear sRGB (clipped to the gamut), then the 8-bit sRGB hex, then WCAG 2 relative
 * luminance and contrast. Ported from the round-22 contrast script so the check lives with the code.
 */

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

/** The text of a rule's braces, from the first `{` after `start` to its matching `}`. */
function block(start: string): string {
  const from = css.indexOf(start);
  if (from < 0) throw new Error(`no ${start.trim()} block`);
  let depth = 0;
  for (let i = css.indexOf("{", from); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", from) + 1, i);
  }
  return "";
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1].slice(2)] = m[2].trim();
  return out;
}

const rootDecls = declarations(block("\n:root {"));
const darkDecls = declarations(block("\n.dark {"));
// `.dark` sits on the same root element, so every alias declared once in :root resolves against it.
const THEMES = { light: rootDecls, dark: { ...rootDecls, ...darkDecls } } as const;
type Theme = keyof typeof THEMES;

function resolve(theme: Theme, name: string, seen: string[] = []): string {
  const raw = THEMES[theme][name];
  if (raw === undefined) throw new Error(`--${name} is not defined (${theme})`);
  const alias = raw.match(/^var\(--([\w-]+)\)$/);
  if (!alias) return raw;
  if (seen.includes(alias[1])) throw new Error(`alias loop at --${name}`);
  return resolve(theme, alias[1], [...seen, name]);
}

type Oklch = [number, number, number];

function oklch(theme: Theme, name: string): Oklch {
  const value = resolve(theme, name);
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) throw new Error(`--${name} (${theme}) is not a plain oklch value: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function hex([L, C, H]: Oklch): string {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => Math.min(1, Math.max(0, x)));
  const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return "#" + linear.map((x) => Math.round(encode(x) * 255).toString(16).padStart(2, "0")).join("");
}

function luminance(color: Oklch): number {
  const h = hex(color);
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(theme: Theme, fg: string, bg: string): number {
  const [x, y] = [luminance(oklch(theme, fg)), luminance(oklch(theme, bg))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Every pair the UI paints that has a minimum: [foreground, background, minimum, what it is]. */
const PAIRS: readonly [string, string, number, string][] = [
  ["foreground", "background", 7, "body text"],
  ["foreground", "card", 7, "body text"],
  ["foreground", "accent", 7, "body text on the wash"],
  ["foreground", "muted", 7, "body text"],
  ["foreground", "highlight", 7, "selected text"],
  ["foreground", "popover", 7, "body text in the sheet"],
  ["muted-foreground", "background", 4.5, "muted text"],
  ["muted-foreground", "card", 4.5, "muted text"],
  ["muted-foreground", "muted", 4.5, "muted text"],
  ["muted-foreground", "accent", 4.5, "muted text on the wash"],
  ["muted-foreground", "popover", 4.5, "muted text in the sheet"],
  ["primary", "background", 4.5, "cost text"],
  ["primary", "card", 4.5, "cost text"],
  ["primary", "accent", 4.5, "cost text on the hover/selected wash"],
  ["primary-hover", "card", 4.5, "cost text hover"],
  ["primary-foreground", "primary", 4.5, "clash disc numeral"],
  ["prov-qloo", "background", 4.5, "Qloo text"],
  ["prov-qloo", "card", 4.5, "Qloo text"],
  ["prov-qloo", "accent", 4.5, "Qloo text on the wash"],
  ["success", "background", 4.5, "success text"],
  ["success", "card", 4.5, "success text"],
  ["success", "accent", 4.5, "success text on the wash"],
  ["cta-foreground", "cta", 7, "primary button label"],
  ["cta-foreground", "cta-hover", 4.5, "primary button label on hover"],
  ["ink-3", "background", 3, "comparator bar (graphic)"],
  ["ink-3", "card", 3, "comparator bar (graphic)"],
  ["border-strong", "background", 3, "control edge (graphic)"],
  ["border-strong", "card", 3, "control edge (graphic)"],
  ["border-strong", "accent", 3, "control edge on the wash (graphic)"],
  ["ring", "background", 3, "focus ring"],
  ["ring", "card", 3, "focus ring"],
  ["ring", "accent", 3, "focus ring on the wash"],
  ["prov-qloo-border", "card", 3, "Qloo hairline (graphic)"],
  ["prov-qloo-border", "background", 3, "Qloo hairline on paper (graphic)"],
  ["primary", "card", 3, "hatch line and vermilion marks in the card window (graphic)"],
  ["primary", "background", 3, "clash disc and link on paper (graphic)"],
  ["primary", "accent", 3, "partner outline and clash disc on the wash (graphic)"],
  ["primary", "muted", 3, "cost fill on a meter track (graphic; no cost text on muted)"],
  ["foreground", "card", 3, "dashed tested outline (graphic)"],
  ["foreground", "accent", 3, "selected outline on the wash (graphic)"],
];

describe("colour tokens", () => {
  for (const theme of ["light", "dark"] as const) {
    describe(theme, () => {
      it.each(PAIRS)("%s on %s reaches %s:1 (%s)", (fg, bg, min) => {
        expect(contrast(theme, fg, bg)).toBeGreaterThanOrEqual(min);
      });

      it("lifts the card off the paper by at least 1.08:1 with no shadow", () => {
        expect(contrast(theme, "card", "background")).toBeGreaterThanOrEqual(1.08);
      });

      it("keeps the neutral ladder cool and near grey (chroma at most 0.025)", () => {
        for (const name of ["background", "card", "border", "muted"]) {
          expect(oklch(theme, name)[1], name).toBeLessThanOrEqual(0.025);
        }
      });

      it("defines the surface edge, and keeps cobalt off the info stamp", () => {
        expect(THEMES[theme]["surface-edge"]).toMatch(/^oklch\(/);
        expect(resolve(theme, "info")).not.toBe(resolve(theme, "ring"));
        expect(THEMES[theme].info).not.toBe("var(--ring)");
      });
    });
  }

  it("sets the surface edge in both blocks and retunes the dark wash", () => {
    expect(rootDecls["surface-edge"]).toBe("oklch(0.8 0.008 258)");
    expect(darkDecls["surface-edge"]).toBe("oklch(0.43 0.02 260)");
    expect(darkDecls.accent).toBe("oklch(0.27 0.03 260)");
    expect(rootDecls.info).toBe("var(--muted-foreground)");
  });

  it("neutralises the light wash, pulls the dark vermilion to scarlet and calms the dark teal", () => {
    expect(rootDecls.accent).toBe("oklch(0.945 0.007 258)");
    expect(resolve("light", "secondary")).toBe("oklch(0.945 0.007 258)");
    expect(darkDecls.primary).toBe("oklch(0.67 0.2 29)");
    expect(darkDecls["primary-hover"]).toBe("oklch(0.7 0.19 29)");
    expect(darkDecls["prov-qloo"]).toBe("oklch(0.70 0.066 195)");
    expect(css).toMatch(/--ci-accent:\s*oklch\(0\.67 0\.2 29\);/);
    expect(css).not.toMatch(/--ci-accent:\s*oklch\(0\.67 0\.2 34\);/);
  });

  it("keeps the new wash and the new dark hues inside the contrast minimums", () => {
    expect(contrast("dark", "primary", "accent")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("dark", "prov-qloo", "card")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("light", "primary", "accent")).toBeGreaterThanOrEqual(4.5);
  });

  it("draws the light card lighter than the paper", () => {
    expect(luminance(oklch("light", "card"))).toBeGreaterThan(luminance(oklch("light", "background")));
  });

  it("uses no retired hue: no magenta (322), no yellow marker (0.16 92), no sodium amber (0.15 80)", () => {
    const tokens = block("\n:root {") + block("\n.dark {");
    expect(tokens).not.toMatch(/oklch\([\d.]+\s+[\d.]+\s+322\)/);
    expect(tokens).not.toMatch(/oklch\([\d.]+\s+0\.16\s+92\)/);
    expect(tokens).not.toMatch(/oklch\([\d.]+\s+0\.15\s+80\)/);
  });

  it("turns selected text ink, so vermilion or teal never shows on the selection colour", () => {
    // Vermilion on the highlight is 3.92:1 light and 2.60:1 dark: it must never be painted.
    expect(contrast("dark", "primary", "highlight")).toBeLessThan(4.5);
    const selection = css.match(/::selection\s*\{([^}]*)\}/);
    expect(selection?.[1]).toMatch(/background:\s*var\(--highlight\);/);
    expect(selection?.[1]).toMatch(/color:\s*var\(--highlight-foreground\);/);
    expect(css.match(/::selection/g)).toHaveLength(1);
    expect(resolve("light", "highlight-foreground")).toBe(resolve("light", "foreground"));
    expect(resolve("dark", "highlight-foreground")).toBe(resolve("dark", "foreground"));
  });

  it("matches the published hexes of the paper and the vermilion in both themes", () => {
    expect(hex(oklch("light", "background"))).toBe("#f1f4f7");
    expect(hex(oklch("light", "foreground"))).toBe("#141821");
    expect(hex(oklch("light", "primary"))).toBe("#ca2a02");
    expect(hex(oklch("dark", "background"))).toBe("#0a0e15");
    expect(hex(oklch("dark", "card"))).toBe("#161c25");
    expect(hex(oklch("dark", "primary"))).toBe("#f85646");
  });
});
