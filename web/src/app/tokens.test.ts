import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * The colour tokens in globals.css, checked as a browser paints them: each oklch value goes to
 * oklab, then linear sRGB (clipped to the gamut), then the 8-bit sRGB hex, then WCAG 2 relative
 * luminance and contrast. Ported from the round-22 contrast script so the check lives with the code.
 */

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

/** The text of a rule's braces, from the first `{` after `start` (or after `from`) to its matching `}`. */
function block(start: string, from = css.indexOf(start)): string {
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
const printDecls = declarations(block("@media print {\n  :root.dark {"));
const themeDecls = declarations(block("@theme inline {"));
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

function parseOklch(value: string): Oklch | null {
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function oklch(theme: Theme, name: string): Oklch {
  const value = resolve(theme, name);
  const parsed = parseOklch(value);
  if (!parsed) throw new Error(`--${name} (${theme}) is not a plain oklch value: ${value}`);
  return parsed;
}

/** Linear sRGB, clipped to the gamut. */
function linear([L, C, H]: Oklch): number[] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => Math.min(1, Math.max(0, x)));
}

function hex(color: Oklch): string {
  const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return "#" + linear(color).map((x) => Math.round(encode(x) * 255).toString(16).padStart(2, "0")).join("");
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

/**
 * The same ratio from the unrounded linear values, the way the round-34 decision (DECISION.md section
 * 2.3) computed its table; it differs from the painted 8-bit ratio by a few hundredths at most.
 */
function exactContrast(theme: Theme, fg: string, bg: string): number {
  const lum = (color: Oklch) => {
    const [r, g, b] = linear(color);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [x, y] = [lum(oklch(theme, fg)), lum(oklch(theme, bg))].sort((p, q) => q - p);
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
  ["foreground", "shared-wash", 7, "act names on shared minutes"],
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
  ["border-strong", "background", 3, "control edge and set edge on paper (graphic)"],
  ["border-strong", "card", 3, "control edge and set edge against its fill (graphic)"],
  ["border-strong", "accent", 3, "control edge on the wash (graphic)"],
  ["ring", "background", 3, "focus ring"],
  ["ring", "card", 3, "focus ring"],
  ["ring", "accent", 3, "focus ring on the wash"],
  ["prov-qloo-border", "card", 3, "Qloo hairline (graphic)"],
  ["prov-qloo-border", "background", 3, "Qloo hairline on paper (graphic)"],
  ["primary", "card", 3, "hatch line and raspberry marks in the card window (graphic)"],
  ["primary", "background", 3, "clash disc and link on paper (graphic)"],
  ["primary", "accent", 3, "partner outline and clash disc on the wash (graphic)"],
  ["primary", "muted", 3, "cost fill on a meter track (graphic; no cost text on muted)"],
  ["primary", "shared-wash", 3, "hatch on its wash (graphic)"],
  ["prov-qloo", "shared-wash", 3, "the chosen clash's line over the wash (graphic)"],
  ["taste-quiet", "background", 3, "the other ranked lines on paper (graphic)"],
  ["taste-quiet", "card", 3, "a quiet line crossing a set (graphic)"],
  ["foreground", "card", 3, "dashed tested outline (graphic)"],
  ["foreground", "accent", 3, "selected outline on the wash (graphic)"],
];

/** DECISION.md section 2.3, row by row: [foreground, background, light, dark]. */
const DECISION_RATIOS: readonly [string, string, number, number][] = [
  ["foreground", "background", 16.02, 16.66],
  ["foreground", "card", 17.72, 14.79],
  ["foreground", "shared-wash", 14.22, 10.93],
  ["foreground", "muted", 14.42, 12.61],
  ["muted-foreground", "background", 6.44, 8.98],
  ["muted-foreground", "card", 7.12, 7.97],
  ["muted-foreground", "muted", 5.8, 6.8],
  ["primary", "background", 5.58, 7.78],
  ["primary", "card", 6.17, 6.91],
  ["primary", "accent", 5.26, 6.09],
  ["primary-hover", "card", 7.95, 8.05],
  ["primary-foreground", "primary", 6.17, 7.78],
  ["prov-qloo", "background", 6.48, 7.42],
  ["prov-qloo", "card", 7.17, 6.59],
  ["success", "card", 6.45, 8.98],
  ["success", "background", 5.83, 10.12],
  ["cta-foreground", "cta", 17.72, 16.66],
  ["cta-foreground", "cta-hover", 12.23, 11.8],
  ["primary", "shared-wash", 4.95, 5.11],
  ["primary", "muted", 5.02, 5.89],
  ["prov-qloo", "shared-wash", 5.75, 4.87],
  ["taste-quiet", "background", 3.18, 3.6],
  ["taste-quiet", "card", 3.52, 3.19],
  ["taste-quiet", "shared-wash", 2.83, 2.36],
  ["border-strong", "background", 3.57, 4.89],
  ["border-strong", "card", 3.95, 4.34],
  ["prov-qloo-border", "card", 3.51, 4.15],
  ["ring", "background", 5.14, 8.32],
  ["ring", "card", 5.69, 7.39],
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

  it.each(DECISION_RATIOS)("%s on %s matches the decision's table (%s light, %s dark) to within 0.02", (fg, bg, light, dark) => {
    expect(Math.abs(exactContrast("light", fg, bg) - light)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(exactContrast("dark", fg, bg) - dark)).toBeLessThanOrEqual(0.02);
  });

  it("taste-quiet on shared-wash stays under 3:1, so the drawing cases every quiet line over a wash", () => {
    expect(Math.abs(exactContrast("light", "taste-quiet", "shared-wash") - 2.83)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(exactContrast("dark", "taste-quiet", "shared-wash") - 2.36)).toBeLessThanOrEqual(0.02);
    expect(contrast("light", "taste-quiet", "shared-wash")).toBeLessThan(3);
    expect(contrast("dark", "taste-quiet", "shared-wash")).toBeLessThan(3);
  });

  it("sets the surface edge in both blocks and retunes the dark wash", () => {
    expect(rootDecls["surface-edge"]).toBe("oklch(0.8 0.008 258)");
    expect(darkDecls["surface-edge"]).toBe("oklch(0.43 0.02 260)");
    expect(darkDecls.accent).toBe("oklch(0.27 0.03 260)");
    expect(rootDecls.info).toBe("var(--muted-foreground)");
  });

  it("neutralises the light wash, sets the dark raspberry and calms the dark teal", () => {
    expect(rootDecls.accent).toBe("oklch(0.945 0.007 258)");
    expect(resolve("light", "secondary")).toBe("oklch(0.945 0.007 258)");
    expect(rootDecls.primary).toBe("oklch(0.52 0.2 352)");
    expect(rootDecls["primary-hover"]).toBe("oklch(0.46 0.19 352)");
    expect(darkDecls.primary).toBe("oklch(0.74 0.15 352)");
    expect(darkDecls["primary-hover"]).toBe("oklch(0.78 0.13 352)");
    expect(darkDecls["prov-qloo"]).toBe("oklch(0.70 0.066 195)");
    // The curtain and its own accent are gone.
    expect(css).not.toMatch(/--ci-accent/);
  });

  it("prints the light values, the raspberry and the two drawing tokens included", () => {
    for (const name of ["primary", "primary-hover", "shared-wash", "taste-quiet", "foreground", "background"]) {
      expect(printDecls[name], name).toBe(rootDecls[name]);
    }
  });

  it("prints on a light canvas even when the theme script set a dark scheme inline", () => {
    // The theme script writes `color-scheme` on <html> as an inline style; only `!important` outranks it.
    expect(block("@media print {\n  :root.dark {")).toMatch(/\n {2}:root \{\s*color-scheme: light !important;\s*\}/);
  });

  it("sets the shared wash and the quiet teal in both themes", () => {
    expect(rootDecls["shared-wash"]).toBe("oklch(0.93 0.035 352)");
    expect(darkDecls["shared-wash"]).toBe("oklch(0.33 0.07 352)");
    expect(rootDecls["taste-quiet"]).toBe("oklch(0.62 0.07 195)");
    expect(darkDecls["taste-quiet"]).toBe("oklch(0.52 0.055 195)");
    expect(hex(oklch("light", "shared-wash"))).toBe("#fcdfea");
    expect(hex(oklch("dark", "shared-wash"))).toBe("#502539");
  });

  it("draws a rule break in ink, never in the shared-time raspberry", () => {
    expect(rootDecls.destructive).toBe("var(--foreground)");
    expect(darkDecls.destructive).toBeUndefined();
    expect(resolve("dark", "destructive")).toBe(resolve("dark", "foreground"));
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

  it("puts no hue between 15 and 75 on any chromatic token, so the old red-orange cannot return", () => {
    const swept: string[] = [];
    for (const decls of [rootDecls, darkDecls, printDecls]) {
      for (const [name, value] of Object.entries(decls)) {
        const color = parseOklch(value);
        if (!color || color[1] < 0.05) continue;
        swept.push(name);
        expect(color[2] < 15 || color[2] > 75, `--${name}: ${value}`).toBe(true);
      }
    }
    // The sweep reaches the raspberry, its wash, the teals, cobalt and green in both themes.
    for (const name of ["primary", "primary-hover", "shared-wash", "prov-qloo", "taste-quiet", "ring", "success"]) {
      expect(swept, name).toContain(name);
    }
  });

  it("turns selected text ink, so raspberry or teal never shows on the selection colour", () => {
    // Raspberry on the highlight is 4.43:1 light and 3.43:1 dark: it must never be painted.
    expect(contrast("light", "primary", "highlight")).toBeLessThan(4.5);
    expect(contrast("dark", "primary", "highlight")).toBeLessThan(4.5);
    const selection = css.match(/::selection\s*\{([^}]*)\}/);
    expect(selection?.[1]).toMatch(/background:\s*var\(--highlight\);/);
    expect(selection?.[1]).toMatch(/color:\s*var\(--highlight-foreground\);/);
    expect(css.match(/::selection/g)).toHaveLength(1);
    expect(resolve("light", "highlight-foreground")).toBe(resolve("light", "foreground"));
    expect(resolve("dark", "highlight-foreground")).toBe(resolve("dark", "foreground"));
  });

  it("matches the published hexes of the paper and the raspberry in both themes", () => {
    expect(hex(oklch("light", "background"))).toBe("#f1f4f7");
    expect(hex(oklch("light", "foreground"))).toBe("#141821");
    expect(hex(oklch("light", "primary"))).toBe("#b61b75");
    expect(hex(oklch("dark", "background"))).toBe("#0a0e15");
    expect(hex(oklch("dark", "card"))).toBe("#161c25");
    expect(hex(oklch("dark", "primary"))).toBe("#f180b5");
  });
});

describe("one radius system", () => {
  it("sets 6px marks and labels, 10px controls and 14px cards, with no capsule", () => {
    expect(themeDecls["radius-xs"]).toBe("0.375rem");
    expect(themeDecls["radius-sm"]).toBe("0.375rem");
    expect(themeDecls["radius-md"]).toBe("0.625rem");
    expect(rootDecls.radius).toBe("0.625rem");
    expect(themeDecls["radius-lg"]).toBe("0.875rem");
    expect(themeDecls["radius-xl"]).toBe("0.875rem");
    expect(themeDecls["radius-2xl"]).toBe("0.875rem");
    expect(themeDecls["radius-bar"]).toBe("0.375rem");
    expect(css).not.toMatch(/9999px/);
  });

  it("keeps the corners in print and rounds every focus ring", () => {
    const prints = [...css.matchAll(/@media[^{]*\bprint\b[^{]*\{/g)].map((m) => block("@media", m.index));
    expect(prints.length).toBeGreaterThanOrEqual(4);
    expect(prints.join(" ")).not.toMatch(/border-radius:\s*0\b/);
    expect(css).not.toMatch(/border-radius:\s*0 !important/);
    expect(css).toMatch(
      /:where\(a, summary, button, \[role="button"\], \[tabindex\]\):focus-visible \{\s*border-radius: var\(--radius-xs\);/,
    );
    expect(css).toMatch(/\.tag \{[^}]*border-radius: var\(--radius-sm\);/);
  });
});

describe("type and the retired monospace", () => {
  const utility = (name: string) => block(`@utility ${name} {`);

  it("sets every type role in sentence case at normal width, with no tracked capitals", () => {
    for (const name of ["type-display", "type-poster", "type-headline", "type-title", "type-numeral", "type-wordmark", "type-kicker"]) {
      const body = utility(name);
      expect(body, name).not.toMatch(/text-transform/);
      expect(body, name).toMatch(/font-variation-settings: "wdth" 100;/);
      const tracking = body.match(/letter-spacing:\s*(-?[\d.]+)em/);
      if (tracking) expect(Number(tracking[1]), name).toBeLessThanOrEqual(0);
    }
    expect(utility("type-display")).toMatch(/font-size: clamp\(1\.875rem, 1\.2rem \+ 2\.6vw, 3\.25rem\);/);
    expect(utility("type-poster")).toMatch(/font-size: clamp\(1\.875rem, 1\.2rem \+ 2\.6vw, 3\.25rem\);/);
    expect(utility("type-headline")).toMatch(/font-size: clamp\(1\.625rem, 1\.2rem \+ 1\.3vw, 2\.5rem\);/);
    expect(utility("type-title")).toMatch(/font-size: clamp\(1\.25rem, 1\.15rem \+ 0\.5vw, 1\.5rem\);/);
  });

  it("sets the type floor: the text-xs role at 13px on its 16px line, and the .tag stamp at 13px", () => {
    expect(themeDecls["text-xs"]).toBe("0.8125rem");
    expect(themeDecls["text-xs--line-height"]).toBe("1rem");
    expect(css).toMatch(/\.tag \{[^}]*font-size: 13px;/);
    // No size the stylesheet sets itself is under 12.5px.
    const sizes = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/font-size:\s*([\d.]+)(px|rem)\b/g)].map(
      ([, n, unit]) => Number(n) * (unit === "rem" ? 16 : 1),
    );
    expect(sizes.length).toBeGreaterThanOrEqual(3);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12.5);
  });

  it("points font-mono at the text face with tabular lining figures, and sets them on the body", () => {
    expect(themeDecls["font-mono"]).toBe("var(--font-archivo), ui-sans-serif, system-ui, sans-serif");
    expect(themeDecls["font-mono--font-feature-settings"]).toBe('"tnum" 1, "lnum" 1');
    expect(css).not.toMatch(/jetbrains/i);
    expect(css).toMatch(/body \{[^}]*font-variant-numeric: tabular-nums lining-nums;/);
  });
});
