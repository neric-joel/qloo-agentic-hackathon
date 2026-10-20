import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { runCheck } from "@/lib/check";
import { pairDecisionId } from "@/lib/check-decisions";
import { SCORE_COPY, type IndexScore } from "@/lib/check-price";
import { SAMPLE_GRID, SAMPLE_SETTINGS } from "@/lib/check-sample";
import {
  TRIAL_COPY,
  findChange,
  sizeLine,
  targetId,
  targetOfBreak,
  targetOfPair,
  type TrialChange,
  type TrialResult as Result,
} from "@/lib/check-trial";

import { SIGN_OFF_CLASS, STAGE_SIGN_OFF, TrialResult, scoreLine, splitChanges, type TrialUi } from "./check-trial-panel";

// Every name below is invented for the test (the invented sample).

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

const outcome = runCheck({ grid: SAMPLE_GRID, ...SAMPLE_SETTINGS });
if (!outcome.ok) throw new Error("the sample should read");
const report = outcome.report;
const target = targetOfBreak(report.breaks[0]);
const found = findChange(report, target);

/** The search result drawn under its break, with the changes given (in the order given). */
function drawn(changes: TrialChange[], kept: ReadonlySet<string> = new Set(), more: TrialChange[] = []): string {
  const result: Result = { ...found, changes, sameStageMore: more };
  const ui: TrialUi = {
    state: { targetId: targetId(target), label: "x", running: false, progress: null, result },
    onFind: () => {},
    onApply: () => {},
    onClose: () => {},
    kept,
  };
  return renderToStaticMarkup(createElement(TrialResult, { target, ui }));
}

describe("a change that moves a set to another stage (C11, R32 K6)", () => {
  const [first] = found.changes;
  if (!first) throw new Error("the sample's first break should have a change");
  const sameStage: TrialChange = { ...first, stageChanges: 0, lines: ["Same Stage → Grove Stage 12:00–13:00"] };
  const newStage: TrialChange = { ...first, stageChanges: 1, lines: ["New Stage → Night Tent 12:00–13:00"] };

  it("prints one ink line at medium weight, Changes stage: needs production sign-off, right under its size line", () => {
    const html = drawn([newStage]);
    expect(STAGE_SIGN_OFF).toBe("Changes stage: needs production sign-off");
    const size = `<p class="mt-0.5 text-sm text-muted-foreground">${sizeLine(newStage)}</p>`;
    expect(html).toContain(`${size}<p class="${SIGN_OFF_CLASS}">${STAGE_SIGN_OFF}</p>`);
    expect(html.split(STAGE_SIGN_OFF)).toHaveLength(2);
  });

  it("prints nothing of the kind for a change that keeps every set on its stage", () => {
    expect(drawn([sameStage])).not.toContain(STAGE_SIGN_OFF);
  });

  it("lists changes that keep every set on its stage first, each group in the engine's order", () => {
    const same2: TrialChange = { ...sameStage, lines: ["Second Same → Grove Stage 14:00–15:00"] };
    const new2: TrialChange = { ...newStage, lines: ["Second New → Night Tent 14:00–15:00"] };
    const order = (html: string) =>
      [...html.matchAll(/(Same Stage|Second Same|New Stage|Second New) →/g)]
        .map((m) => m[1])
        .filter((v, i, a) => a.indexOf(v) === i);
    expect(order(drawn([newStage, sameStage, new2, same2]))).toEqual(["Same Stage", "Second Same", "New Stage", "Second New"]);
    expect(order(drawn([sameStage, newStage]))).toEqual(["Same Stage", "New Stage"]);
    // The panel groups with filters, never a sort.
    const source = readFileSync(fileURLToPath(new URL("./check-trial-panel.tsx", import.meta.url)), "utf8");
    expect(source).not.toMatch(/\.sort\(/);
  });

  it("lists the next same-stage changes in the ranking first, ahead of the first five's stage changes", () => {
    const later: TrialChange = { ...sameStage, lines: ["Later Same → Grove Stage 16:00–17:00"] };
    const html = text(drawn([newStage], new Set(), [later]));
    expect(html.indexOf("Later Same")).toBeLessThan(html.indexOf("New Stage"));
    expect(html).not.toContain(TRIAL_COPY.noSameStage);
  });

  it("says so in one line before the stage changes when none listed keeps every set on its stage", () => {
    const html = drawn([newStage]);
    expect(TRIAL_COPY.noSameStage).toBe("None of the changes listed here keeps every set on its stage.");
    expect(text(html).indexOf(TRIAL_COPY.noSameStage)).toBeLessThan(text(html).indexOf("New Stage"));
    expect(html).toContain(`<p class="mt-3 text-sm font-medium text-foreground">${TRIAL_COPY.noSameStage}</p>`);
    expect(drawn([sameStage, newStage])).not.toContain(TRIAL_COPY.noSameStage);
  });

  it("uses plain ink text, with no chip, pill, stripe, fill or alpha colour", () => {
    const html = drawn([newStage]);
    const line = html.match(/<p[^>]*>Changes stage: needs production sign-off<\/p>/)?.[0] ?? "";
    expect(line).toBe(`<p class="mt-0.5 text-sm font-medium text-foreground">${STAGE_SIGN_OFF}</p>`);
    const classes = /class="([^"]*)"/.exec(line)?.[1] ?? "";
    expect(classes).not.toMatch(/\btag\b|rounded|border-l|bg-|\/\d\d|muted/);
  });
});

describe("a change that ends a clash you kept on purpose (R32 K7)", () => {
  const [first] = found.changes;
  const keptId = "pair:kept-pair";
  const ends: TrialChange = { ...first, stageChanges: 0, ends: [keptId], lines: ["Ender → Grove Stage 12:00–13:00"] };
  const keeps: TrialChange = { ...first, stageChanges: 0, ends: ["pair:other"], lines: ["Keeper → Grove Stage 14:00–15:00"] };

  it("leaves it out of the list by default and offers it in a closed fold with its line", () => {
    const html = drawn([ends, keeps], new Set([keptId]));
    const list = html.slice(0, html.indexOf("<details class=\"group cc-disclosure"));
    expect(text(list)).toContain("Keeper →");
    expect(text(list)).not.toContain("Ender →");
    expect(text(list)).toContain("1 change found ends a clash you kept on purpose, so it is not listed above.");
    const at = html.indexOf("<details class=\"group cc-disclosure");
    const fold = html.slice(at, html.indexOf("</details>", at));
    // Closed: no open attribute, and the summary names what it holds.
    expect(fold).toMatch(/^<details class="group cc-disclosure mt-2">/);
    expect(text(fold)).toContain("Changes that end a clash you kept on purpose (1)");
    expect(text(fold)).toContain("Ends a clash you kept on purpose");
    expect(text(fold)).toContain("Ender →");
    // Native details and summary: reachable by Tab and opened with Enter or Space, with the shared focus ring.
    expect(fold).toContain('<summary class="cc-disclosure-summary text-sm">');
    expect(html.split("Ends a clash you kept on purpose").length - 1).toBe(1);
  });

  it("draws neither line nor fold when no change ends a kept clash", () => {
    const html = drawn([ends, keeps]);
    expect(html).not.toContain("kept on purpose");
    expect(html).not.toContain('<details class="group cc-disclosure');
    expect(text(html)).toContain("Ender →");
  });

  it("splits by the search's own ended pairs, dropping nothing", () => {
    const split = splitChanges({ changes: [ends, keeps] }, new Set([keptId]));
    expect(split.endsKept).toEqual([ends]);
    expect([...split.sameStage, ...split.stageChange]).toEqual([keeps]);
  });

  it("records, for each change the search finds, the overlaps it ends", () => {
    const pair = report.shared[0];
    const result = findChange(report, targetOfPair(pair));
    expect(result.changes.length).toBeGreaterThan(0);
    for (const change of result.changes) expect(change.ends).toContain(pairDecisionId(pair));
    // A kept target: every change ends it, so the list is empty and all of them wait in the fold.
    const ui: TrialUi = {
      state: { targetId: targetId(targetOfPair(pair)), label: "x", running: false, progress: null, result },
      onFind: () => {},
      onApply: () => {},
      onClose: () => {},
      kept: new Set([pairDecisionId(pair)]),
    };
    const html = renderToStaticMarkup(createElement(TrialResult, { target: targetOfPair(pair), ui }));
    const all = result.changes.length + (result.sameStageMore ?? []).length;
    expect(text(html)).toContain(`Changes that end a clash you kept on purpose (${all})`);
    expect(text(html)).toContain(`All ${all} changes found end a clash you kept on purpose, so none is listed.`);
    expect(html.indexOf("<ol")).toBeGreaterThan(html.indexOf("<details class=\"group cc-disclosure"));
  });
});

describe("the first changes listed, scored on a published day's index (C6)", () => {
  const changes = found.changes.slice(0, 4);
  if (changes.length < 4) throw new Error("the sample's first break should list four changes");

  /** The panel with an index per change (as the page fills it after the visitor's own search) and the line over it. */
  function scored(scores: ReadonlyMap<TrialChange, IndexScore | "scoring">, note: string | null): string {
    const result: Result = { ...found, changes, sameStageMore: [] };
    const ui: TrialUi = {
      state: { targetId: targetId(target), label: "x", running: false, progress: null, result },
      onFind: () => {},
      onApply: () => {},
      onClose: () => {},
      scores,
      scoreNote: note,
    };
    return renderToStaticMarkup(createElement(TrialResult, { target, ui }));
  }

  it("prints each scored change's index before and after under it, the line over the list, and nothing on the rest", () => {
    const map = new Map<TrialChange, IndexScore | "scoring">([
      [changes[0], { status: "scored", before: 116.71, after: 115.12 }],
      [changes[1], { status: "not_scored", reason: SCORE_COPY.limit }],
      [changes[2], "scoring"],
    ]);
    const html = scored(map, SCORE_COPY.scope(3));
    const page = text(html);
    expect(page).toContain(SCORE_COPY.scope(3).replace(/&#x27;/g, "'"));
    expect(page.indexOf(SCORE_COPY.scope(3))).toBeLessThan(page.indexOf("Index 116.7 → 115.1."));
    expect(page).toContain("Index 116.7 → 115.1.");
    expect(page).toContain("Index not scored: this server’s limit on what-if requests was reached.");
    expect(html).toContain('aria-busy="true" class="mt-0.5 text-sm font-semibold break-words text-foreground">Scoring on the index.</p>');
    // One index line each for the three scored, none for the fourth; ink text, no chip or colour.
    expect(page.match(/Index \d|Index not scored|Scoring on the index/g)).toHaveLength(3);
    expect(scoreLine({ status: "scored", before: 116.71, after: 115.12 })).toBe("Index 116.7 → 115.1.");
    expect(html).not.toMatch(/bg-(?:success|good|green)|text-(?:success|green)/);
  });

  it("says why nothing is scored where scoring is not available, and adds no index line", () => {
    const page = text(scored(new Map(), SCORE_COPY.unavailable));
    expect(page).toContain("Index scoring is available on the published days only.");
    expect(page).not.toMatch(/Index \d|Index not scored/);
    // No line and no index when the page passes none (the panel as it was).
    expect(text(drawn(changes))).not.toMatch(/Index scoring|Index \d/);
  });
});
