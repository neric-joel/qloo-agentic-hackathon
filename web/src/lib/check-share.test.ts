import { describe, expect, it } from "vitest";

import { runCheck } from "@/lib/check";
import {
  DECISION_COPY,
  breakDecisionId,
  cleanNote,
  decisionLine,
  pairDecisionId,
  targetDecision,
  visibleDecisions,
  type Decision,
} from "@/lib/check-decisions";
import { SAMPLE_GRID, SAMPLE_SETTINGS } from "@/lib/check-sample";
import { SHARE_COPY, SHARE_LIMIT, readShareHash, shareHash, shareable } from "@/lib/check-share";
import { applyChange, findChange, gridText, targetOfBreak, targetOfPair } from "@/lib/check-trial";

// Every name below is invented for the test.

const SAMPLE = { grid: SAMPLE_GRID, ...SAMPLE_SETTINGS };

describe("the share link", () => {
  it("carries the grid and the settings in the hash and reads them back exactly", () => {
    const hash = shareHash(SAMPLE);
    expect(hash).toMatch(/^#g=[A-Za-z0-9_-]+$/);
    expect(readShareHash(hash)).toEqual(SAMPLE);
    const odd = { grid: "Café Ñandú,Main,18:00,19:00\n\"A, B\",Side,18:30,19:30", changeover: "", curfew: "1:00 AM", pairs: "Café Ñandú | A, B" };
    expect(readShareHash(shareHash(odd))).toEqual(odd);
  });

  it("fits the sample in a link and offers none above 8,000 characters", () => {
    expect(shareable(`https://example.test/check${shareHash(SAMPLE)}`)).toBe(true);
    expect(shareable("x".repeat(SHARE_LIMIT + 1))).toBe(false);
    expect(SHARE_COPY.warning).toBe("Anyone with this link can read the grid.");
  });

  it("refuses anything that is not one of its links, without throwing", () => {
    for (const hash of ["", "#", "#g=", "#g=%%%", "#g=bm90IGpzb24", "#x=abc", `#g=${btoa(JSON.stringify({ v: 2, g: "", c: "", f: "", p: "" }))}`]) {
      expect(readShareHash(hash)).toBeNull();
    }
    const numbers = btoa(JSON.stringify({ v: 1, g: 5, c: "", f: "", p: "" })).replace(/=+$/, "");
    expect(readShareHash(`#g=${numbers}`)).toBeNull();
  });

  it("writes the working grid as the .csv: the template's columns, the changes applied, and it reads back", () => {
    const outcome = runCheck(SAMPLE);
    if (!outcome.ok) throw new Error("refused");
    const [change] = findChange(outcome.report, targetOfBreak(outcome.report.breaks[2])).changes;
    const working = applyChange(outcome.report, change);
    const csv = gridText(working.sets);
    expect(csv.split("\n")[0]).toBe("act,stage,start,end,locked");
    const again = runCheck({ ...SAMPLE, grid: csv });
    if (!again.ok) throw new Error(again.errors.join(" | "));
    expect(again.report.breaks).toHaveLength(working.breaks.length);
  });
});

describe("decisions", () => {
  const outcome = runCheck(SAMPLE);
  if (!outcome.ok) throw new Error("refused");
  const report = outcome.report;

  it("give each break and each pair its own id, stable across a re-check with other rows", () => {
    const ids = [...report.breaks.map((b) => breakDecisionId(b, report.sets)), ...report.shared.map(pairDecisionId)];
    expect(new Set(ids).size).toBe(ids.length);
    const moved = runCheck({ ...SAMPLE, grid: SAMPLE_GRID.replace("act,stage,start,end,locked\n", "act,stage,start,end,locked\nZed,Far Field,10:00,10:20,\n") });
    if (!moved.ok) throw new Error("refused");
    const again = [...moved.report.breaks.map((b) => breakDecisionId(b, moved.report.sets)), ...moved.report.shared.map(pairDecisionId)];
    for (const id of ids) expect(again).toContain(id);
  });

  it("change no figure: the report is the same object with any decisions held beside it", () => {
    const before = JSON.stringify(report);
    const decisions = new Map<string, Decision>([
      [pairDecisionId(report.shared[0]), { id: pairDecisionId(report.shared[0]), label: "x", status: "kept", reason: "Contract", note: "", change: null }],
    ]);
    expect(visibleDecisions(decisions, report)).toHaveLength(1);
    expect(JSON.stringify(report)).toBe(before);
  });

  it("name what a search targeted, for the Changed mark a tried change sets", () => {
    const item = report.breaks[3];
    expect(targetDecision(report, targetOfBreak(item))).toEqual({ id: breakDecisionId(item, report.sets), label: item.text });
    const pair = report.shared[0];
    expect(targetDecision(report, targetOfPair(pair))).toEqual({
      id: pairDecisionId(pair),
      label: `${pair.a.act} and ${pair.b.act} share ${pair.minutes} minutes`,
    });
  });

  it("list the ones about what is on show, and every Changed one", () => {
    const gone: Decision = { id: "pair:not-here", label: "Gone", status: "kept", reason: null, note: "", change: null };
    const changed: Decision = { id: "break:9:x", label: "A break.", status: "changed", reason: null, note: "", change: "A → Main 18:00–19:00" };
    const listed = visibleDecisions(new Map([[gone.id, gone], [changed.id, changed]]), report);
    expect(listed).toEqual([changed]);
  });

  it("word a decision with its reason and note, and keep a note to 80 characters on one line", () => {
    const base: Decision = { id: "x", label: "Saffron Season and Ivory Lights share 20 minutes", status: "kept", reason: null, note: "", change: null };
    expect(decisionLine(base)).toBe("Saffron Season and Ivory Lights share 20 minutes: Kept on purpose.");
    expect(decisionLine({ ...base, status: "not-changing", reason: "Travel" })).toBe(
      "Saffron Season and Ivory Lights share 20 minutes: Not changing. Travel.",
    );
    expect(decisionLine({ ...base, reason: "Contract", note: "headline clause" })).toBe(
      "Saffron Season and Ivory Lights share 20 minutes: Kept on purpose. Contract: headline clause",
    );
    expect(decisionLine({ ...base, label: "Rustic Harbour ends at 00:20.", status: "changed", change: "Rustic Harbour → Night Tent 23:00–00:00" })).toBe(
      "Rustic Harbour ends at 00:20: Changed. Rustic Harbour → Night Tent 23:00–00:00.",
    );
    expect(cleanNote(`a\nb${"z".repeat(100)}`)).toHaveLength(80);
    expect(cleanNote("a\nb")).toBe("a b");
    expect(DECISION_COPY.lead).toContain("A decision changes no figure on this page.");
  });
});
