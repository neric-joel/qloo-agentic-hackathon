import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { runCheck } from "@/lib/check";
import { SAMPLE_GRID, SAMPLE_SETTINGS } from "@/lib/check-sample";
import { findChange, sizeLine, targetId, targetOfBreak, type TrialChange, type TrialResult as Result } from "@/lib/check-trial";

import { STAGE_SIGN_OFF, TrialResult, type TrialUi } from "./check-trial-panel";

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
function drawn(changes: TrialChange[]): string {
  const result: Result = { ...found, changes };
  const ui: TrialUi = {
    state: { targetId: targetId(target), label: "x", running: false, progress: null, result },
    onFind: () => {},
    onApply: () => {},
    onClose: () => {},
  };
  return renderToStaticMarkup(createElement(TrialResult, { target, ui }));
}

describe("a change that moves a set to another stage (C11)", () => {
  const [first] = found.changes;
  if (!first) throw new Error("the sample's first break should have a change");
  const sameStage: TrialChange = { ...first, stageChanges: 0 };
  const newStage: TrialChange = { ...first, stageChanges: 1 };

  it("prints one muted line, Changes stage: needs production sign-off, right under its size line", () => {
    const html = drawn([newStage]);
    expect(STAGE_SIGN_OFF).toBe("Changes stage: needs production sign-off");
    const size = `<p class="mt-0.5 text-sm text-muted-foreground">${sizeLine(newStage)}</p>`;
    expect(html).toContain(`${size}<p class="mt-0.5 text-sm text-muted-foreground">${STAGE_SIGN_OFF}</p>`);
    expect(html.split(STAGE_SIGN_OFF)).toHaveLength(2);
  });

  it("prints nothing of the kind for a change that keeps every set on its stage", () => {
    expect(drawn([sameStage])).not.toContain(STAGE_SIGN_OFF);
  });

  it("keeps the engine's order: the panel lists the changes exactly as the search ranked them", () => {
    const html = drawn([sameStage, newStage]);
    const items = text(html).split("Try it").slice(0, 2);
    expect(items[0]).not.toContain(STAGE_SIGN_OFF);
    expect(items[1]).toContain(STAGE_SIGN_OFF);
    const reversed = text(drawn([newStage, sameStage])).split("Try it").slice(0, 2);
    expect(reversed[0]).toContain(STAGE_SIGN_OFF);
    // No sort in the panel: the order is the engine's (lib/check-trial.ts ranks stage changes after equal moves).
    const source = readFileSync(fileURLToPath(new URL("./check-trial-panel.tsx", import.meta.url)), "utf8");
    expect(source).not.toMatch(/\.sort\(/);
  });

  it("uses an existing muted text pair, with no chip, pill, stripe or alpha colour", () => {
    const html = drawn([newStage]);
    const line = html.match(/<p[^>]*>Changes stage: needs production sign-off<\/p>/)?.[0] ?? "";
    expect(line).toBe(`<p class="mt-0.5 text-sm text-muted-foreground">${STAGE_SIGN_OFF}</p>`);
    const classes = /class="([^"]*)"/.exec(line)?.[1] ?? "";
    expect(classes).not.toMatch(/\btag\b|rounded|border-l|bg-|\/\d\d/);
  });
});
