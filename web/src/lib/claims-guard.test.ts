/**
 * Keeps claims the product cannot back out of the shipped UI: headcount phrasing ("same people",
 * "fans at stake", "% of fans"), optimizer language, and business or safety effects. Taste overlap
 * is a rank within a lineup, not a count of fans, and suggestions are graded by the same measure
 * that found them.
 *
 * Each file is scanned whole, as a reader would see its text: line breaks, indentation and {" "}
 * spacers collapse to one space, adjacent string literals joined with + are joined, HTML entities
 * (named and numeric) are decoded and zero-width characters are dropped. So a phrase wrapped across
 * lines, split by {" "} or hidden behind an entity or an invisible character is still caught. The
 * simulated stream (mock-*) ships in the bundle behind a build flag, so it is scanned
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
  /\d+\s*%\s*of (the |all )?(fans|audience)/i,
  /fans forced/i,
  /crowds? (split|torn)/i,
  /headcount/i,
  /optimi[sz]/i,
  /optimal/i,
  /outperform/i,
  /beats popularity/i,
  /improves? (this day|the timetable)/i,
  /improves? on /i,
  /regret cut/i,
  // A derived number is "calculated from Qloo data", never "Qloo's measure". "Qloo's score" stays
  // allowed: comments use it for the tag order, a value Qloo returned.
  /qloo'?s (own )?measure/i,
  /no fan is torn/i,
  /revenue/i,
  /resale/i,
  /crowd safety/i,
];

/** Phrases a forbidden pattern would match that say the opposite, such as "not a headcount". */
const ALLOWED: readonly RegExp[] = [/not (a )?headcount/gi];

/** Zero-width characters, typed or written as a \u escape: U+200B to U+200D, U+2060 and U+FEFF. */
const INVISIBLE = /[​-‍⁠﻿]|\\u(?:200[bcd]|2060|feff)|\\u\{(?:200[bcd]|2060|feff)\}/gi;

/** The character a numeric entity stands for; nothing for a code point no character has. */
function fromCodePoint(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

/**
 * Source text as a reader would see it. {" "} and {' '} become a space, "a " + "b" becomes "a b",
 * numeric entities (&#39;, &#x27;) and the named ones JSX text uses are decoded (&amp; last, so
 * nothing is decoded twice), zero-width characters are dropped, and every run of whitespace,
 * newlines included, becomes one space.
 */
function normalize(source: string): string {
  return source
    .replace(/\{\s*(["'])\s*\1\s*\}/g, " ")
    .replace(/(["'`])\s*\+\s*\1/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => fromCodePoint(parseInt(code, 16)))
    .replace(INVISIBLE, "")
    .replace(/&rsquo;|&lsquo;|&apos;|[‘’]/g, "'")
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
    // Two patterns catch this one (any "% of the fans", and a figure "% of the fans or audience").
    expect(findClaims("<p>40% of the fans</p>")).not.toEqual([]);
    expect(findClaims("<p>Two crowds torn</p>")).toHaveLength(1);
  });

  it("catches the phrases added after the second review", () => {
    expect(findClaims("<p>Moving it would improve on the published day.</p>")).toHaveLength(1);
    expect(findClaims("<p>A regret cut of 12 points.</p>")).toHaveLength(1);
    expect(findClaims("<p>Clashing them strands 40 % of the audience.</p>")).toHaveLength(1);
    expect(findClaims("<p>30% of all fans</p>")).not.toEqual([]);
    expect(findClaims("<p>By Qloo&rsquo;s measure, they clash.</p>")).toHaveLength(1);
    expect(findClaims('const note = "These figures come from Qloo\'s own measure.";')).toHaveLength(1);
    // The tag order is a value Qloo returned, so "Qloo's score" is allowed.
    expect(findClaims("// The tags in Qloo's score order, highest first.")).toEqual([]);
  });

  it("catches phrases hidden behind numeric entities or zero-width characters", () => {
    expect(findClaims("<p>Qloo&#39;s measure</p>")).toHaveLength(1);
    expect(findClaims("<p>Qloo&#x27;s measure</p>")).toHaveLength(1);
    expect(findClaims("<p>the same&#32;crowd</p>")).toHaveLength(1);
    expect(findClaims("<p>head​count</p>")).toHaveLength(1);
    expect(findClaims("<p>the same cr⁠owd</p>")).toHaveLength(1);
    expect(findClaims("<p>opti﻿mal</p>")).toHaveLength(1);
    expect(findClaims('const text = "the same \\u200bpeople";')).toHaveLength(1);
    expect(findClaims("<p>reven&#8203;ue</p>")).toHaveLength(1);
    // An entity that names no character is dropped rather than breaking the scan.
    expect(findClaims("<p>&#0; &#x110000; fine</p>")).toEqual([]);
  });

  it("allows headcount and attendance only where they are denied", () => {
    expect(findClaims("<p>Taste overlap is not a headcount and not attendance.</p>")).toEqual([]);
    expect(findClaims("<p>It is not\n  headcount.</p>")).toEqual([]);
    expect(findClaims("<p>A headcount of 400 fans.</p>")).toHaveLength(1);
  });
});
