/**
 * Keeps claims the product cannot back out of the shipped UI: headcount phrasing ("same people",
 * "fans at stake", "% of fans"), optimizer language, and business or safety effects. Taste overlap
 * is a rank within a lineup, not a count of fans, and suggestions are graded by the same measure
 * that found them.
 *
 * Each file is scanned whole, as a reader would see its text: line breaks, indentation and {" "}
 * spacers collapse to one space, adjacent string literals joined with + are joined, and the HTML
 * entities used in JSX text are decoded. So a phrase wrapped across lines or split by {" "} is still
 * caught. The simulated stream (mock-*) ships in the bundle behind a build flag, so it is scanned
 * too; only tests and test fixtures are skipped.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const ROOTS = ["app", "components", "lib"];

const FORBIDDEN: readonly RegExp[] = [
  /same people/i,
  /same crowd/i,
  /same fans/i,
  /different people/i,
  /fans at stake/i,
  /fans of both/i,
  /same size crowd/i,
  /shared audiences?/i,
  /% of (the )?fans/i,
  /fans forced/i,
  /crowds? (split|torn)/i,
  /headcount/i,
  /optimi[sz]/i,
  /optimal/i,
  /outperform/i,
  /beats popularity/i,
  /improves? (this day|the timetable)/i,
  /no fan is torn/i,
  /revenue/i,
  /resale/i,
  /crowd safety/i,
];

/** Phrases a forbidden pattern would match that say the opposite, such as "not a headcount". */
const ALLOWED: readonly RegExp[] = [/not (a )?headcount/gi];

/**
 * Source text as a reader would see it. {" "} and {' '} become a space, "a " + "b" becomes "a b",
 * the entities JSX text uses are decoded (&amp; last, so nothing is decoded twice), and every run of
 * whitespace, newlines included, becomes one space.
 */
function normalize(source: string): string {
  return source
    .replace(/\{\s*(["'])\s*\1\s*\}/g, " ")
    .replace(/(["'`])\s*\+\s*\1/g, "")
    .replace(/&rsquo;|&lsquo;|&apos;|&#39;|[‘’]/g, "'")
    .replace(/&nbsp;| /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Every forbidden phrase in a source text, each with a little of the text around it. */
function findClaims(source: string): string[] {
  const text = ALLOWED.reduce((current, allowed) => current.replace(allowed, " "), normalize(source));
  return FORBIDDEN.flatMap((pattern) =>
    [...text.matchAll(new RegExp(pattern.source, "gi"))].map((match) => {
      const start = Math.max(0, match.index - 50);
      const context = text.slice(start, match.index + match[0].length + 50).trim();
      return `"${match[0]}" in "...${context}..."`;
    }),
  );
}

/** "components/clash/clash-drawer.tsx", with forward slashes on every platform. */
function srcPath(path: string): string {
  return relative(SRC, path).replace(/\\/g, "/");
}

function shipped(path: string): boolean {
  const rel = srcPath(path);
  const name = rel.split("/").pop() ?? rel;
  if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return false;
  return !rel.startsWith("lib/fixtures/");
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

describe("claims guard", () => {
  const files = ROOTS.flatMap((root) => walk(join(SRC, root))).filter(shipped);

  it("finds the shipped sources, the simulated stream included", () => {
    const names = files.map(srcPath);
    expect(names).toContain("app/page.tsx");
    expect(names).toContain("components/clash/clash-drawer.tsx");
    expect(names).toContain("lib/clashes.ts");
    expect(names).toContain("lib/mock-stream.ts");
    expect(names).toContain("lib/mock-preset.ts");
    expect(names).toContain("components/site/mock-banner.tsx");
    expect(names.some((name) => name.includes("fixtures/") || /\.test\.tsx?$/.test(name))).toBe(false);
  });

  it("ships no forbidden claim", () => {
    const hits = files.flatMap((path) =>
      findClaims(readFileSync(path, "utf8")).map((hit) => `${srcPath(path)}: ${hit}`),
    );
    expect(hits).toEqual([]);
  });

  it("catches a phrase split across a JSX line break and {\" \"}", () => {
    const jsx = ["<p>", '  Clashing these two splits the same{" "}', "  crowd in two.", "</p>"].join("\n");
    // Line by line, as the guard used to read, there is nothing to catch.
    expect(jsx.split("\n").some((line) => /same crowd/i.test(line))).toBe(false);
    expect(findClaims(jsx)).toEqual([expect.stringContaining('"same crowd"')]);
  });

  it("catches phrases split by a line break, an entity or a string concatenation", () => {
    expect(findClaims("<p>\n  Their shared\n  audiences differ.\n</p>")).toHaveLength(1);
    expect(findClaims("<p>{' '}Fans at&nbsp;stake</p>")).toHaveLength(1);
    expect(findClaims('const text =\n  "they draw the same " +\n  "people";')).toHaveLength(1);
    expect(findClaims("<p>40% of the fans</p>")).toHaveLength(1);
    expect(findClaims("<p>Two crowds torn</p>")).toHaveLength(1);
  });

  it("allows headcount and attendance only where they are denied", () => {
    expect(findClaims("<p>Taste overlap is not a headcount and not attendance.</p>")).toEqual([]);
    expect(findClaims("<p>It is not\n  headcount.</p>")).toEqual([]);
    expect(findClaims("<p>A headcount of 400 fans.</p>")).toHaveLength(1);
  });
});
