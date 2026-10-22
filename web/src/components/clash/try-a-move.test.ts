import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { topClashes } from "@/lib/clashes";
import { buildDayGraph, drawingHeight, sideEffectText, type DayGraphModel } from "@/lib/day-graph";
import type { Decision } from "@/lib/decision";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { mockPreset } from "@/lib/mock-preset";
import { startingSets, type MovesResult, type PlacedOption } from "@/lib/moves";
import { parsePreset, type Preset } from "@/lib/preset";
import type { RuleFix } from "@/lib/rule-fix";
import { applyMoves, encodeMoves, planStorageKey, type StackMove } from "@/lib/stack";
import { formatClock } from "@/lib/timetable";

import {
  BestPlaceColumn,
  MovesCard,
  PlacesRoom,
  START_WITH,
  TestedPlace,
  TryAMove,
  bestPlace,
  dayRules,
  heldHeight,
  listedLead,
  mayGrowOutside,
  nextLabel,
  placeChanges,
  placeDrawing,
  rulesChecked,
  starterPairsOf,
  stripDomain,
  testedDecision,
  testedDrawing,
  type CardMove,
  type PlaceChanges,
  type PlaceRoom,
} from "./try-a-move";
import { scaleRange } from "./budget-move";
import { MOVES_LIMIT, clashParts, clashWords, listedPlace, moveCheck, sharedMinutesByName, splitKept, type MoveCheck } from "./use-moves";
import { ChangeCard, SAME_STAGE_FIRST, STAGE_SIGN_OFF, sameStageFirst } from "./keep-apart";
import { ScratchPlan } from "./scratch-plan";
import { ClashList, bothLockedLabel, lockedShareLine } from "./clash-list";
import { ClashDetails, bothLockedNote } from "./clash-drawer";
import { LockKey, TimetableLegend, legendSymbolCount } from "./timetable-legend";
import { lockedSetsLine } from "./try-a-move";
import { LOCK_GENERIC, LOCK_INVENTED, LOCK_SHORT, lockLabel, lockRuleHolds, type LockSlot } from "@/lib/locks";

/** The visible words. */
const text = (html: string) =>
  html
    .replace(/<\/dt>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The card's move: Sprints from 14:00 to 14:15 on Woodsies. */
const move: StackMove = { actId: "sprints", stageId: "woodsies", day: 0, start: "14:15" };

const option: PlacedOption = {
  move: "Sprints: Woodsies 14:00-15:00 -> Woodsies 14:15-15:15",
  stage: "Woodsies",
  start: "14:15",
  after: 38.8,
  stageId: "woodsies",
  end: "15:15",
  day: 0,
  clashesAfter: [{ name: "Katy J Pearson", points: 2.1 }],
};

const result: MovesResult = {
  act: "Sprints",
  actId: "sprints",
  from: "Woodsies 14:00-15:00",
  movable: true,
  why: null,
  before: 41.2,
  legalPlaces: 14,
  priced: true,
  clashesNow: [
    { name: "Katy J Pearson", points: 3.4 },
    { name: "Wet Leg", points: 1.2 },
  ],
  options: [option],
};

const card: CardMove = { move, receipt: "Sprints and Katy J Pearson share 30 minutes after this plan." };

/** The rules sentence Try a move passes its cards for the tiny fixture's day (`rulesChecked`). */
const RULES = rulesChecked(parsePreset(rawTinyPreset())!, 0);

function render(check: MoveCheck | null, changes: PlaceChanges = { ends: [{ name: "Wet Leg", points: 1.2 }], adds: [], keeps: [{ name: "Katy J Pearson", now: 3.4, after: 2.1 }] }) {
  return renderToStaticMarkup(
    createElement(TestedPlace, {
      card,
      mover: result.act,
      stage: "Woodsies",
      end: "15:15",
      minutes: { partner: "Katy J Pearson", before: 45, after: 30 },
      drawing: null,
      check,
      changes: check?.status === "ready" ? changes : null,
      keepFull: false,
      onKeep: () => {},
      onShowAll: () => {},
      rules: RULES,
    }),
  );
}

describe("the tested place's verdict before Keep this move", () => {
  it("states the index change, the rule status and the clashes it changes, from a listed place", () => {
    const check = moveCheck({ status: "ready", options: result }, move);
    expect(check.status).toBe("ready");
    const html = render(check);
    const words = text(html);
    // (a) the Clash Budget Index before and after, in tabular figures, with the signed change.
    expect(words).toContain("Index 41.2 → 38.8 (−2.4, lower is better)");
    // Both readings are ink: the from-value is not muted, so it never reads as disabled.
    expect(html).toMatch(/<span class="font-mono tabular-nums"><span>41\.2<\/span> →/);
    // (b) and (c) in one 14px block: the rule status with the rules it was checked against, then, after a muted
    // "Listed clashes of {mover} (its three costliest, as scored):" (the endpoint's lists stop at three, and the
    // line says so), the clashes it keeps (their minutes unread here), adds and removes, added and removed
    // always. A kept part still prints.
    expect(words).toContain(`Adds no rule break. ${RULES}`);
    expect(words).toContain(`Listed clashes of ${result.act} (its three costliest, as scored): 1 kept, 0 added, 1 removed.`);
    expect(words.indexOf("Adds no rule break.")).toBeLessThan(words.indexOf("Listed clashes of"));
    // The prefix is muted; the counts after it are not.
    const prefix = /<span class="text-muted-foreground">(Listed clashes of [^]*?)<\/span>/.exec(html)?.[1] ?? "";
    expect(text(prefix)).toBe(`Listed clashes of ${result.act} (its three costliest, as scored):`);
    // The minutes shared lead, in one line of the condensed face, at one weight: no lighter "45".
    expect(words).toContain("45 → 30 min shared with Katy J Pearson");
    expect(html).toMatch(/<p class="type-numeral text-2xl[^"]*">45 → 30 min shared/);
    const heading = /<p class="type-numeral text-2xl[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
    expect(heading).not.toContain("text-muted-foreground");
    expect(heading).not.toContain("font-normal");
    // A result, open on paper as the hero receipt is: one 1px decorative top rule, no corner, no surface edge,
    // no fill and no side padding; no 2px ink rule and no internal rule but the one hairline above the actions.
    expect(html).toMatch(/^<div data-tested-card="true" class="border-t border-border pt-5 sm:pt-6">/);
    const shell = /^<div[^>]*>/.exec(html)?.[0] ?? "";
    expect(shell).not.toMatch(/rounded|surface-edge|bg-card|p-6|px-/);
    expect(html).not.toContain("border-t-2");
    expect(html.match(/border-t(?![\w-])/g)).toHaveLength(2);
    expect(html).toContain('<div aria-hidden="true" data-actions-rule="true" class="mt-6 border-t border-border"></div>');
    // The dateline names the set it tested before its stage and times.
    expect(words).toContain(`${result.act} at Woodsies · 14:15–15:15`);
    // No key and value list any more, and the minutes are said once.
    expect(html).not.toContain("<dl");
    expect(words.match(/30/g)).toHaveLength(1);
    expect(words).not.toContain(card.receipt);
    expect(words).toContain("Keep this move");
  });

  it("says Checking rules… until the answer is in, and never claims the rules before it", () => {
    const html = render(moveCheck({ status: "loading", options: null }, move));
    expect(text(html)).toContain("Checking rules…");
    expect(text(html)).not.toContain("Adds no rule break");
    expect(text(html)).not.toContain("removed");
    // Keep this move stays as it was: enabled while the check runs.
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<svg[^>]*>[\s\S]*?Keep this move/);
  });

  it("does not confirm the rules for a place the list does not hold, or when the list fails", () => {
    const elsewhere = { ...move, start: "16:40" };
    expect(listedPlace(result, elsewhere)).toBeNull();
    const unlisted = moveCheck({ status: "ready", options: result }, elsewhere);
    expect(unlisted.status).toBe("unlisted");
    expect(text(render(unlisted))).toContain("Rules and clashes not checked for this place.");
    const failed = moveCheck({ status: "error", options: null }, move);
    expect(failed.status).toBe("error");
    expect(text(render(failed))).not.toContain("Adds no rule break");
  });

  it("prints the card's own index when the card passed one", () => {
    const html = render(
      { status: "ready", result, option },
      { ends: [], adds: [], keeps: [] },
    );
    expect(text(html)).toContain(`Adds no rule break. ${RULES}`);
    expect(text(html)).toContain(`Listed clashes of ${result.act} (its three costliest, as scored): 0 added, 0 removed.`);
    const withCard = renderToStaticMarkup(
      createElement(TestedPlace, {
        card: { ...card, indexBefore: "41.2", indexAfter: "38.8" },
        mover: result.act,
        stage: "Woodsies",
        end: "15:15",
        minutes: null,
        drawing: null,
        check: null,
        changes: null,
        keepFull: false,
        onKeep: () => {},
        onShowAll: () => {},
        rules: RULES,
      }),
    );
    expect(text(withCard)).toContain("Index 41.2 → 38.8");
    expect(text(withCard)).toContain("Checking rules…");
    // With no minutes row the receipt says the minutes instead.
    expect(text(withCard)).toContain(card.receipt);
  });

  it("names the tested set in the dateline, and keeps the stage-first dateline when no mover name is known", () => {
    const named = /<p data-dateline="true"[^>]*>([\s\S]*?)<\/p>/.exec(render(null))?.[1] ?? "";
    expect(text(named)).toBe(`${result.act} at Woodsies · 14:15–15:15`);
    expect(named).toContain(`<span class="font-semibold">${result.act}</span> at Woodsies`);
    expect(named).toContain('<span class="font-mono tabular-nums">14:15–15:15</span>');
    const unnamed = renderToStaticMarkup(
      createElement(TestedPlace, {
        card,
        mover: null,
        stage: "Woodsies",
        end: "15:15",
        minutes: null,
        drawing: null,
        check: null,
        changes: null,
        keepFull: false,
        onKeep: () => {},
        onShowAll: () => {},
        rules: RULES,
      }),
    );
    const plain = /<p data-dateline="true"[^>]*>([\s\S]*?)<\/p>/.exec(unnamed)?.[1] ?? "";
    expect(text(plain)).toBe("Woodsies · 14:15–15:15");
    expect(plain).toMatch(/^<span class="font-semibold">Woodsies<\/span> · <span class="font-mono tabular-nums">/);
  });
});

describe("the tested-move card's actions and its drawing (round 37, L21)", () => {
  // Every name, time and figure here is invented (the tiny fixture festival): Bo Diddly Squat plays Side 20:30–22:00
  // and shares 60 min with Ann Arbor (Main 20:00–21:30), the day's one ranked clash.
  const tiny = parsePreset(rawTinyPreset())!;
  const place = (start: string, end: string, after: number | null = 100.1, extra: Partial<PlacedOption> = {}): PlacedOption => ({
    move: `Bo Diddly Squat: Side 20:30-22:00 -> Side ${start}-${end}`,
    stage: "Side",
    start,
    after,
    stageId: "side",
    end,
    day: 0,
    clashesAfter: [],
    ...extra,
  });
  const bo: MovesResult = {
    act: "Bo Diddly Squat",
    actId: "bo",
    from: "Side 20:30-22:00",
    movable: true,
    why: null,
    before: 104.2,
    legalPlaces: 2,
    priced: true,
    clashesNow: [{ name: "Ann Arbor", points: 3 }],
    options: [place("21:00", "22:30"), place("22:05", "23:35", 101)],
  };
  const pairs = [{ aId: "ann", bId: "bo" }];
  const later = testedDrawing(tiny, tiny.festival.timetable, { result: bo, option: bo.options[0] }, "ann")!;

  function card(drawing: DayGraphModel | null): string {
    return renderToStaticMarkup(
      createElement(TestedPlace, {
        card: { move: { actId: "bo", stageId: "side", day: 0, start: "21:00" }, receipt: "" },
        mover: "Bo Diddly Squat",
        stage: "Side",
        end: "22:30",
        minutes: { partner: "Ann Arbor", before: 60, after: 30 },
        drawing,
        check: null,
        changes: null,
        keepFull: false,
        onKeep: () => {},
        onShowAll: () => {},
        rules: RULES,
      }),
    );
  }
  const titleOf = (html: string) => {
    const id = /<div data-day-graph="" data-view="moved" role="group" aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    return id ? text(new RegExp(`<p id="${id}"[^>]*>([^<]*)</p>`).exec(html)?.[1] ?? "") : "";
  };
  const descOf = (html: string) => {
    const id = /<div data-day-graph=""[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "";
    return id ? text(new RegExp(`<p id="${id}"[^>]*>([^<]*)</p>`).exec(html)?.[1] ?? "") : "";
  };

  it("keeps 'Keep this move' word for word as the one ink action, with no check icon, and 'Show every legal place' ruled", () => {
    const html = card(later);
    const keep = html.match(/<button[^>]*>[^]*?<\/button>/g)!.find((button) => button.includes("Keep this move"))!;
    expect(keep).toMatch(/data-variant="default"/);
    expect(keep).not.toContain("<svg");
    expect(keep).not.toContain("lucide-check");
    expect(text(keep)).toBe("Keep this move");
    const all = html.match(/<button[^>]*>[^]*?<\/button>/g)!.find((button) => button.includes("Show every legal place"))!;
    expect(all).toMatch(/data-variant="ruled"/);
  });

  it("builds the tested place as a decision from the engine's place and the timetable only", () => {
    const decision = testedDecision(tiny, tiny.festival.timetable, { result: bo, option: bo.options[0] }, "ann")!;
    // The clash is the set and its partner; the move is the engine's place for the set, on its own stage.
    expect(decision.day).toBe(0);
    expect(decision.clash).toEqual({ aId: "bo", bId: "ann", rank: 1, minutes: 60 });
    expect(decision.move).toMatchObject({
      actId: "bo",
      act: "Bo Diddly Squat",
      from: "Side 20:30-22:00",
      stageId: "side",
      stage: "Side",
      day: 0,
      start: "21:00",
      end: "22:30",
      minutesMoved: 30,
      legalPlaces: 2,
      stageChanged: false,
      budgetAfter: 100.1,
      minutesSharedAfter: 30,
      alternative: null,
      flagsNow: null,
      flagsAfter: null,
      costliestAfter: undefined,
    });
    expect(decision.rule).toBeNull();
    expect(decision.ruleChange).toBeNull();
    expect(decision.publishedBudget).toBeNull();
    // A place on another stage says so; an unpriced place and an unranked pair carry no figure, not a default.
    const elsewhere = testedDecision(tiny, tiny.festival.timetable, { result: bo, option: place("21:00", "22:30", null, { stageId: "main", stage: "Main" }) }, "ann")!;
    expect(elsewhere.move?.stageChanged).toBe(true);
    expect(elsewhere.move?.budgetAfter).toBeNaN();
    const unranked = testedDecision(tiny, tiny.festival.timetable, { result: bo, option: bo.options[0] }, "cy")!;
    expect(unranked.clash?.rank).toBeNaN();
    // Nothing for a place on another day, a partner or set not on the timetable, or times that do not read.
    expect(testedDecision(tiny, tiny.festival.timetable, { result: bo, option: { ...bo.options[0], day: 1 } }, "ann")).toBeNull();
    expect(testedDecision(tiny, tiny.festival.timetable, { result: bo, option: bo.options[0] }, "nobody")).toBeNull();
    expect(testedDecision(tiny, tiny.festival.timetable, { result: { ...bo, actId: "nobody" }, option: bo.options[0] }, "ann")).toBeNull();
    expect(testedDecision(tiny, tiny.festival.timetable, { result: bo, option: { ...bo.options[0], start: "late" } }, "ann")).toBeNull();
  });

  it("draws every figure from the place and the timetable: the fields the drawing never reads change nothing", () => {
    const decision = testedDecision(tiny, tiny.festival.timetable, { result: bo, option: bo.options[0] }, "ann")!;
    expect(later).toEqual(buildDayGraph(tiny, decision, 0));
    const scrambled: Decision = {
      ...decision,
      skippedLocked: 9,
      skippedNoPlace: 9,
      publishedBudget: 1,
      clash: { ...decision.clash!, rank: 99, minutes: 999 },
      move: { ...decision.move!, act: "Someone Else", from: "Nowhere 00:00-01:00", minutesMoved: 999, legalPlaces: 999, budgetAfter: 1, minutesSharedAfter: 999 },
    };
    expect(buildDayGraph(tiny, scrambled, 0)).toEqual(later);
    // The drawing's move: Bo from Side 20:30–22:00 to Side 21:00–22:30, 60 → 30 min shared with Ann Arbor.
    expect(later.move).toMatchObject({
      actId: "bo",
      partnerId: "ann",
      partnerName: "Ann Arbor",
      from: { start: 1230, end: 1320 },
      to: { start: 1260, end: 1350 },
      stageChanged: false,
      minutesBefore: 60,
      minutesAfter: 30,
      label: "Bo Diddly Squat 30 min later",
    });
    // A place that ends the overlap is drawn too; a partner it shares no time with now gives no drawing.
    const apart = testedDrawing(tiny, tiny.festival.timetable, { result: bo, option: bo.options[1] }, "ann")!;
    expect(apart.move).toMatchObject({ minutesBefore: 60, minutesAfter: 0, sharedAfter: null, label: "Bo Diddly Squat 95 min later" });
    expect(testedDrawing(tiny, tiny.festival.timetable, { result: bo, option: bo.options[0] }, "cy")).toBeNull();
  });

  it("draws the day on the plan's timetable, the one the place's lines read", () => {
    // A kept move put Cy Twombly at Side 18:00–19:00: the drawing has Cy there, as the lists do.
    const plan = applyMoves(tiny.festival.timetable, [{ actId: "cy", stageId: "side", day: 0, start: "18:00" }]);
    const drawn = testedDrawing(tiny, plan, { result: bo, option: bo.options[0] }, "ann")!;
    expect(drawn.sets.find((set) => set.actId === "cy")).toMatchObject({ start: 1080, end: 1140 });
    expect(later.sets.find((set) => set.actId === "cy")).toMatchObject({ start: 1000, end: 1060 });
  });

  it("replaces the before/after strip with the hero's drawing of the tested place, short layout, after the lines and before the actions", () => {
    const html = card(later);
    expect(html).not.toContain("data-move-strip");
    expect(html).not.toContain("data-pair-strip");
    expect(html.match(/<div data-day-graph=""/g)).toHaveLength(1);
    // Its frame: the drawing's own group with its title and description, in the moved view.
    expect(html).toMatch(/<div data-tested-drawing="true" class="mt-5 min-w-0"><div data-day-graph="" data-view="moved" role="group" aria-labelledby="[^"]+" aria-describedby="[^"]+"/);
    expect(titleOf(html)).toBe("Tiny Fest, Saturday, drawn with Bo Diddly Squat 30 min later: 3 sets on 2 stages");
    expect(descOf(html)).toContain("Bo Diddly Squat 30 min later.");
    expect(descOf(html)).toContain(sideEffectText(later.move!));
    // Only the short layout, with no viewport class hiding it, so it shows at every width.
    expect(html).toMatch(/data-layout="short" class="relative" style="height:\d+px"/);
    expect(html).not.toMatch(/data-layout="(desktop|phone)"/);
    // Its tag: the minutes still shared with the partner, as the large line above says them.
    expect(html).toContain("30 min shared");
    expect(text(html)).toContain("60 → 30 min shared with Ann Arbor");
    // Under the rule status and the lists, over the one hairline above the actions.
    expect(html.indexOf("data-place-verdict")).toBeLessThan(html.indexOf("data-tested-drawing"));
    expect(html.indexOf("data-tested-drawing")).toBeLessThan(html.indexOf("data-actions-rule"));
    // With no drawing passed (the card's own move: the hero draws it), none is drawn.
    expect(card(null)).not.toContain("data-day-graph");
  });

  it("draws a picked set's best place in the right column and each place chosen in the full list, a new frame per place", () => {
    const best = bestPlace(bo, tiny, tiny.festival.timetable, pairs)!;
    expect(best.drawing).toEqual(later);
    const column = renderToStaticMarkup(
      createElement(BestPlaceColumn, {
        status: "ready",
        result: bo,
        best,
        pickedName: "Bo Diddly Squat",
        synthetic: false,
        keepFull: false,
        onKeep: () => {},
        open: false,
        controls: "every-place",
        onToggle: () => {},
        rules: RULES,
      }),
    );
    expect(titleOf(column)).toBe("Tiny Fest, Saturday, drawn with Bo Diddly Squat 30 min later: 3 sets on 2 stages");
    const list = (option: PlacedOption) =>
      renderToStaticMarkup(
        createElement(MovesCard, {
          result: bo,
          preset: tiny,
          timetable: tiny.festival.timetable,
          kept: 0,
          range: scaleRange(tiny.report.baseline),
          chosen: option,
          keep: { full: false, onKeep: () => {} },
          onChoose: () => {},
          rules: RULES,
          drawing: placeDrawing(bo, option, tiny, tiny.festival.timetable, pairs),
        }),
      );
    const first = list(bo.options[0]);
    const second = list(bo.options[1]);
    expect(titleOf(first)).toBe("Tiny Fest, Saturday, drawn with Bo Diddly Squat 30 min later: 3 sets on 2 stages");
    expect(titleOf(second)).toBe("Tiny Fest, Saturday, drawn with Bo Diddly Squat 95 min later: 3 sets on 2 stages");
    expect(descOf(second)).toContain(sideEffectText(placeDrawing(bo, bo.options[1], tiny, tiny.festival.timetable, pairs)!.move!));
    // The drawing follows the place's lines, before the hairline over Keep this move.
    expect(first.indexOf("data-tested-drawing")).toBeGreaterThan(first.indexOf("data-rules-line"));
    // Without a drawing the list draws none.
    expect(
      renderToStaticMarkup(
        createElement(MovesCard, {
          result: bo,
          preset: tiny,
          timetable: tiny.festival.timetable,
          kept: 0,
          range: scaleRange(tiny.report.baseline),
          chosen: bo.options[0],
          keep: { full: false, onKeep: () => {} },
          onChoose: () => {},
          rules: RULES,
        }),
      ),
    ).not.toContain("data-day-graph");
    // Two drawings on one page share no id (each takes its ids from its own useId).
    const page = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(BestPlaceColumn, {
          status: "ready",
          result: bo,
          best,
          pickedName: "Bo Diddly Squat",
          synthetic: false,
          keepFull: false,
          onKeep: () => {},
          open: true,
          controls: "every-place",
          onToggle: () => {},
          rules: RULES,
        }),
        createElement(MovesCard, {
          result: bo,
          preset: tiny,
          timetable: tiny.festival.timetable,
          kept: 0,
          range: scaleRange(tiny.report.baseline),
          chosen: bo.options[1],
          keep: { full: false, onKeep: () => {} },
          onChoose: () => {},
          rules: RULES,
          drawing: placeDrawing(bo, bo.options[1], tiny, tiny.festival.timetable, pairs),
        }),
      ),
    );
    expect(page.match(/<div data-day-graph=""/g)).toHaveLength(2);
    const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("wires the drawing in the source: keyed by the place, the moved view, the short layout, no flight; the card's own move draws none", () => {
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    expect(source).toContain(
      '<DayGraph key={`${model.presetId}|${model.day}|${place}`} model={model} view="moved" layout="short" />',
    );
    // No settle callback and no view change: a new place mounts a new frame, drawn at once.
    expect(source).not.toMatch(/<DayGraph[^>]*onSettled/);
    expect(source).not.toMatch(/<DayGraph[^>]*view="published"/);
    expect(source.match(/<TestedDrawing model=\{drawing\} \/>/g)).toHaveLength(2);
    expect(source.match(/^\s+drawing=\{null\}$/gm)).toHaveLength(1);
    expect(source).toContain("drawing={best.drawing}");
    expect(source).toContain("drawing={chosenDrawing}");
    expect(source).not.toContain("PairStrip");
    expect(source).not.toContain("MoveStrip");
  });
});

describe("Try a move's picker", () => {
  it("puts the 'Or choose any set' select in the left column under 'Start with', and the tested-move card alone on the right", () => {
    const preset = parsePreset(rawTinyPreset());
    const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
    const html = renderToStaticMarkup(createElement(TryAMove, { preset, day: 0, ranked, isLocked: () => false }));
    const picker = html.match(/<div data-move-picker="true" class="([^"]*)">([^]*?)<\/select>/)!;
    expect(picker[1]).toContain("lg:col-span-5 lg:col-start-1 lg:row-start-2");
    const inside = picker[2];
    if (inside.includes("Start with")) {
      expect(inside.indexOf("Start with")).toBeLessThan(inside.indexOf("Or choose any set"));
      expect(inside.indexOf("Or choose any set")).toBeLessThan(inside.indexOf("<select"));
      // "Start with" is a list of choices open on paper, as the tested result beside it is: one 1px decorative
      // top rule with the result label's top padding, the label under it, then the rows. No box: no corner, no
      // surface edge, no fill, no clipping.
      expect(inside).toMatch(
        /^[^]*?<div data-start-block="true" class="border-t border-border pt-5 sm:pt-6"><p id="[^"]+" class="text-\[0\.8125rem\] leading-5 font-semibold text-muted-foreground">Start with<\/p><ul aria-labelledby="[^"]+" data-start-ledger="true" class="mt-1">/,
      );
      const ledger = /<ul aria-labelledby="[^"]+" data-start-ledger="true"[^>]*>[\s\S]*?<\/ul>/.exec(inside)?.[0] ?? "";
      expect(ledger).not.toMatch(/rounded-lg|surface-edge|bg-card|overflow-hidden|border-border-strong/);
      // Its rows: full-width 56px buttons. The shown row is marked inside itself: an inset, pointer-free 1.5px
      // ink outline (an overlay, so no row changes size), the check glyph in its reserved 16px slot and its start
      // in ink, with no wash. The others keep the slot empty and the start muted, and take the wash on hover only.
      const rows = inside.match(/<button type="button" data-start-row="true"[^>]*>[\s\S]*?<\/button>/g) ?? [];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((row) => row.includes("data-start-minutes"))).toBe(true);
      expect(rows.filter((row) => row.includes("lucide-check"))).toHaveLength(1);
      expect(rows.filter((row) => row.includes("data-start-cue"))).toHaveLength(1);
      for (const row of rows) {
        const open = /^<button[^>]*>/.exec(row)?.[0] ?? "";
        const classes = (/class="([^"]*)"/.exec(open)?.[1] ?? "").split(" ");
        expect(classes).toEqual(expect.arrayContaining(["relative", "min-h-14", "w-full", "rounded-md", "px-4", "py-3"]));
        // The button itself has no edge and no ring: only the overlay marks the shown row.
        expect(classes.filter((name) => /^(border|ring)(-|$)/.test(name))).toEqual([]);
        expect(classes).not.toContain("bg-accent");
        // Keyboard focus is the cobalt outline drawn 2px OUTSIDE the row, so on the shown row it sits apart from
        // the ink outline inside it: told apart by place, not only by colour.
        expect(classes).toEqual(
          expect.arrayContaining(["focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-ring"]),
        );
        expect(classes.some((name) => name.includes("-outline-offset"))).toBe(false);
        const slot = /<span data-start-check="true" class="flex h-5 items-center pt-px">([\s\S]*?)<\/span>/.exec(row);
        expect(slot).not.toBeNull();
        const time = /<span data-start-time="true" class="([^"]*)"/.exec(row)?.[1] ?? "";
        if (row.includes("lucide-check")) {
          expect(row).toContain(
            '<span aria-hidden="true" data-start-cue="true" class="pointer-events-none absolute inset-0 rounded-md border-[1.5px] border-foreground"></span>',
          );
          expect(classes).not.toContain("hover:bg-accent");
          expect(slot![1]).toMatch(/lucide-check size-4 text-foreground/);
          expect(time).toContain("text-foreground");
          expect(open).toContain('aria-pressed="');
        } else {
          expect(row).not.toContain("data-start-cue");
          expect(classes).toContain("hover:bg-accent");
          expect(slot![1]).toBe("");
          expect(time).toContain("text-muted-foreground");
        }
        // No left stripe and no wash as the cue.
        expect(row).not.toMatch(/border-l|before:/);
        // One rhythm: the act, then its stage and end, then (with a pair) the minutes and partner on a third
        // block-level line of their own, never an inline piece after a middot.
        expect(row).toMatch(/<span data-start-name="true" class="block text-\[0\.9375rem\] leading-snug font-semibold break-words">/);
        const meta = /<span data-start-meta="true" class="[^"]*">((?:[^<]|<span[^>]*>[^<]*<\/span>)*)<\/span>/.exec(row);
        if (meta) expect(text(meta[1])).not.toMatch(/ min|with/);
        // No inline swatch: the minutes carry shared time, in 13px raspberry tabular figures, then the set they are
        // shared with, by name; the list never says "min shared".
        expect(row).not.toContain('viewBox="0 0 40 12"');
        expect(row).not.toContain("<pattern");
        expect(row).not.toContain("min shared");
        if (row.includes("data-start-minutes")) {
          expect(row).toMatch(
            /<span data-start-pair="true" class="mt-0\.5 block text-\[0\.8125rem\] leading-5 break-words text-muted-foreground"><span data-start-minutes="true" class="font-mono whitespace-nowrap text-primary tabular-nums">\d+ min<\/span> with <span data-start-partner="true" class="text-foreground">[^<]+<\/span><\/span>/,
          );
          expect(row).not.toContain("inline-block");
          expect(row.indexOf("data-start-pair")).toBeGreaterThan(row.indexOf("data-start-meta"));
        }
      }
      // Each row is closed by a 1px hairline, the last too, with 4px above and below its button; the hairlines
      // either side of the shown row go transparent (keeping their pixel), so its ink outline stands alone.
      const rules = [...ledger.matchAll(/<li data-start-rule="true" class="border-b py-1 (border-[a-z]+)">/g)].map((m) => m[1]);
      expect(rules).toHaveLength(rows.length);
      const shownAt = rows.findIndex((row) => row.includes("lucide-check"));
      // Rule i sits under row i.
      rules.forEach((rule, i) => {
        expect(rule).toBe(i === shownAt || i + 1 === shownAt ? "border-transparent" : "border-border");
      });
    } else {
      expect(inside).toContain("Set to move");
    }
    // The select: 48px, 12px corner, card, a 1px border-strong edge, 16px padding, one 12px chevron; the one boxed
    // field here, the column's full width at every size, so its right edge is the Start-with list's.
    expect(inside).toMatch(/class="relative mt-1\.5 flex h-12 min-w-0 items-center rounded-md border border-border-strong bg-card pr-10 pl-4/);
    expect(inside).toMatch(/<div data-move-select="true"><div class="relative mt-1\.5 flex h-12/);
    expect(inside).not.toMatch(/data-move-select="true" class="[^"]*max-w-/);
    expect(html.slice(html.indexOf("data-move-picker"))).toMatch(/lucide-chevron-down[^"]*size-3/);
    // No section hairline, no alpha colour, no wash.
    expect(html).toMatch(/^<section id="try-a-move" aria-labelledby="try-a-move-heading"><div class="container-page grid gap-x-12 py-16/);
    expect(html).not.toMatch(/(bg|border|text)-(foreground|background|muted|destructive|muted-foreground|border-strong)\/\d/);
    expect(html).not.toContain("bg-danger-bg");
    expect(html).not.toContain("border-dashed");
    expect(html).not.toContain("fill-opacity");
  });

  it("from lg, starts the tested result in the picker's row, so the selection and its result share one band", () => {
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    const card = /<div data-move-card className="([^"]*)">/.exec(source)?.[1] ?? "";
    // Grid placement only: the second row, the right seven columns, no row span, the picker's own 32px top.
    expect(card.split(" ")).toEqual(expect.arrayContaining(["mt-8", "lg:col-span-7", "lg:col-start-6", "lg:row-start-2"]));
    expect(card).not.toMatch(/row-span|row-start-1|lg:mt-/);
    const picker = /<div data-move-picker className="([^"]*)">/.exec(source)?.[1] ?? "";
    expect(picker.split(" ")).toEqual(expect.arrayContaining(["mt-8", "lg:row-start-2"]));
    expect(picker).not.toMatch(/lg:mt-/);
    // The source (and Tab) order is unchanged: heading, ledger, select, then the result.
    expect(source.indexOf('id="try-a-move-heading"')).toBeLessThan(source.indexOf("data-move-picker className"));
    expect(source.indexOf("data-move-picker className")).toBeLessThan(source.indexOf("data-move-card className"));
  });

  it("opens 'Where X could go' onto paper: one top rule, no card, the page's 5/7 split", () => {
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    // A list of choices and its result: one 1px decorative top rule, no corner, surface edge, fill or padding.
    expect(source).toContain('<div data-moves-card className="border-t border-border pt-5">');
    const body = source.slice(source.indexOf("data-moves-card"), source.indexOf("/** The decision card's move"));
    expect(body).not.toMatch(/rounded-lg|border-surface-edge/);
    // The places and the priced detail sit on the page's own columns and gutter.
    expect(body).toContain('<div className="mt-5 grid gap-6 lg:grid-cols-12 lg:gap-x-12">');
    expect(body).toContain('<div className="min-w-0 lg:col-span-5">');
    expect(body).toContain('className="min-w-0 lg:col-span-7"');
  });
});

describe("the clashes line tells a shorter clash from an unchanged one", () => {
  const changes = {
    ends: [] as { name: string; points: number }[],
    adds: [] as { name: string; points: number }[],
    keeps: [
      { name: "Katy J Pearson", now: 3.4, after: 2.1 },
      { name: "Wet Leg", now: 1.2, after: 1.2 },
      { name: "Fontaines D.C.", now: 0.8, after: 0.8 },
    ],
  };
  const shared = new Map([
    ["Katy J Pearson", { before: 45, after: 30 }],
    ["Wet Leg", { before: 20, after: 20 }],
    ["Fontaines D.C.", { before: 15, after: 15 }],
  ]);

  it("counts shorter, longer and unchanged from the shared minutes before and after", () => {
    const split = splitKept(changes.keeps, shared);
    expect(split.shorter.map((item) => item.name)).toEqual(["Katy J Pearson"]);
    expect(split.unchanged).toHaveLength(2);
    expect(split.longer).toHaveLength(0);
    expect(split.unknown).toHaveLength(0);
    expect(clashWords(clashParts(changes, shared))).toBe("1 shortened (45 → 30 min), 2 unchanged, 0 added, 0 removed");
  });

  it("always shows added and removed, and shorter, longer and unchanged only above 0", () => {
    const longer = new Map([...shared, ["Wet Leg", { before: 20, after: 35 }]]);
    const parts = clashParts(
      { ...changes, ends: [{ name: "Wet Leg 2", points: 1 }], adds: [{ name: "New", points: 1 }] },
      longer,
    );
    expect(clashWords(parts)).toBe("1 shortened (45 → 30 min), 1 lengthened (20 → 35 min), 1 unchanged, 1 added, 1 removed");
    expect(clashWords(clashParts({ ends: [], adds: [], keeps: [] }, null))).toBe("0 added, 0 removed");
    // Two shortened clashes are counted without a single pair of minutes.
    const two = new Map([...shared, ["Wet Leg", { before: 20, after: 10 }]]);
    expect(clashWords(clashParts(changes, two))).toBe("2 shortened, 1 unchanged, 0 added, 0 removed");
  });

  it("reads the minutes from the timetable in memory, by the partner's name", () => {
    const acts = [
      { id: "sprints", name: "Sprints" },
      { id: "katy", name: "Katy J Pearson" },
    ];
    const timetable = [
      { act_id: "sprints", day: 0, stage_id: "woodsies", start: 840, end: 900, locked: false },
      { act_id: "katy", day: 0, stage_id: "park", start: 855, end: 945, locked: false },
    ];
    const minutes = sharedMinutesByName(
      acts,
      timetable,
      "sprints",
      { day: 0, start: 840, end: 900 },
      { day: 0, start: 825, end: 885 },
      ["Katy J Pearson", "Not on the day"],
    );
    expect(minutes.get("Katy J Pearson")).toEqual({ before: 45, after: 30 });
    expect(minutes.has("Not on the day")).toBe(false);
  });

  it("prints the row on the tested place in that order", () => {
    const html = render({ status: "ready", result, option }, { ...changes, shared });
    expect(text(html)).toContain(`Adds no rule break. ${RULES}`);
    expect(text(html)).toContain(
      `Listed clashes of ${result.act} (its three costliest, as scored): ${clashWords(clashParts(changes, shared))}.`,
    );
    expect(text(html)).toContain(
      "Listed clashes of Sprints (its three costliest, as scored): 1 shortened (45 → 30 min), 2 unchanged, 0 added, 0 removed.",
    );
  });

  it("still prints a lengthened part after the listed prefix, in clashParts' order", () => {
    const longer = new Map([...shared, ["Wet Leg", { before: 20, after: 35 }]]);
    const html = render({ status: "ready", result, option }, { ...changes, shared: longer });
    const counts = clashWords(clashParts(changes, longer));
    expect(counts).toContain("1 lengthened (20 → 35 min)");
    expect(text(html)).toContain(`Adds no rule break. ${RULES}`);
    expect(text(html)).toContain(`Listed clashes of ${result.act} (its three costliest, as scored): ${counts}.`);
  });
});

describe("the rules a legal place was checked against, with the shown day's own values (round 37, L8)", () => {
  // An invented day in the shape backend/app/lineups/timetable.py gives a published one: each stage's hours run
  // from its first published start to its last published end, the closing set of each stage is locked, and every
  // set carries a start window of its published start ± 120 minutes and the stages within one place of its own.
  const reach = (start: number, stages: string[]) => ({ not_before: Math.max(0, start - 120), not_after: start + 120, stages });
  function publishedShape(change: (festival: Record<string, unknown>) => Record<string, unknown> = (festival) => festival): Preset {
    const raw = rawTinyPreset() as Record<string, unknown> & { festival: Record<string, unknown> };
    const festival = {
      ...raw.festival,
      stages: [
        { id: "main", name: "Main", tier: 1, hours: [{ day: 0, open: 720, close: 1395 }] },
        { id: "side", name: "Side", tier: 2, hours: [{ day: 0, open: 1000, close: 1320 }] },
        { id: "barn", name: "Barn", tier: 3, hours: [{ day: 0, open: 900, close: 1260 }] },
      ],
      acts: [
        { id: "ann", name: "Ann Arbor", qloo_id: "Q-ANN", popularity: 0.9, genre: "Indie", billing_tier: 1 },
        { id: "bo", name: "Bo Diddly Squat", qloo_id: "Q-BO", popularity: 0.8, genre: "Punk", billing_tier: 4 },
        { id: "cy", name: "Cy Twombly", qloo_id: null, popularity: null, genre: null, billing_tier: 3 },
        { id: "dee", name: "Dee Lite", qloo_id: "Q-DEE", popularity: 0.5, genre: "Pop", billing_tier: 2 },
        { id: "eli", name: "Eli Paperboy", qloo_id: "Q-ELI", popularity: 0.4, genre: "Folk", billing_tier: 2 },
      ],
      timetable: [
        { act_id: "bo", day: 0, stage_id: "main", start: 720, end: 800, locked: false, ...reach(720, ["main", "side"]) },
        { act_id: "ann", day: 0, stage_id: "main", start: 1305, end: 1395, locked: true, ...reach(1305, ["main", "side"]) },
        { act_id: "cy", day: 0, stage_id: "side", start: 1000, end: 1060, locked: false, ...reach(1000, ["main", "side", "barn"]) },
        { act_id: "dee", day: 0, stage_id: "side", start: 1090, end: 1320, locked: true, ...reach(1090, ["main", "side", "barn"]) },
        { act_id: "eli", day: 0, stage_id: "barn", start: 900, end: 1260, locked: true, ...reach(900, ["side", "barn"]) },
      ],
    };
    return parsePreset({ ...raw, festival: change(festival) });
  }
  const PUBLISHED =
    "Checked against this app’s rules for the day, read from the published timetable: each stage’s published hours, nothing after 23:15 (the day’s latest published end), at least 15 min between sets on a stage, sets this app locks, a start within two hours of the set’s published start, on its own stage or a neighbouring one, and pairs that must never overlap.";

  it("on a published day: the latest published end, the changeover in minutes, the published hours and the reach limit", () => {
    const day = publishedShape();
    expect(dayRules(day.festival, 0)).toEqual({ curfew: 1395, changeover: 15, publishedHours: true, reach: true });
    expect(rulesChecked(day, 0)).toBe(PUBLISHED);
    // Every kind of rule the round-35 sentence named stays named.
    for (const kind of ["hours", "nothing after", "between sets on a stage", "locks", "pairs that must never overlap"]) {
      expect(rulesChecked(day, 0)).toContain(kind);
    }
  });

  it("reads each value from the day, never a default: a 10-minute gap gives 10, a later end moves the time", () => {
    // Dee Lite 20 minutes earlier: 10 minutes after Cy Twombly on the side stage (the stage's hours move with it).
    const tight = publishedShape((festival) => ({
      ...festival,
      stages: (festival.stages as Record<string, unknown>[]).map((stage) =>
        stage.id === "side" ? { ...stage, hours: [{ day: 0, open: 1000, close: 1300 }] } : stage,
      ),
      timetable: (festival.timetable as Record<string, unknown>[]).map((slot) =>
        slot.act_id === "dee" ? { ...slot, start: 1070, end: 1300, ...reach(1070, ["main", "side", "barn"]) } : slot,
      ),
    }));
    expect(dayRules(tight.festival, 0)).toMatchObject({ changeover: 10, curfew: 1395 });
    expect(rulesChecked(tight, 0)).toContain("at least 10 min between sets on a stage");
    // The engine caps the gap at 15 minutes (the base day's tightest published gap is 30 minutes), and a day with no
    // two sets on one stage has no published gap at all: 15 minutes, as the engine gives it.
    const wide = publishedShape((festival) => ({
      ...festival,
      timetable: (festival.timetable as Record<string, unknown>[]).filter((slot) => slot.act_id !== "bo" && slot.act_id !== "cy"),
      stages: (festival.stages as Record<string, unknown>[]).map((stage) =>
        stage.id === "main" ? { ...stage, hours: [{ day: 0, open: 1305, close: 1395 }] } : stage.id === "side" ? { ...stage, hours: [{ day: 0, open: 1090, close: 1320 }] } : stage,
      ),
    }));
    expect(dayRules(wide.festival, 0)).toMatchObject({ changeover: 15, publishedHours: true });
    // A day whose last set ends 23:40 says 23:40.
    const late = publishedShape((festival) => ({
      ...festival,
      stages: (festival.stages as Record<string, unknown>[]).map((stage) =>
        stage.id === "main" ? { ...stage, hours: [{ day: 0, open: 720, close: 1420 }] } : stage,
      ),
      timetable: (festival.timetable as Record<string, unknown>[]).map((slot) => (slot.act_id === "ann" ? { ...slot, start: 1330, end: 1420 } : slot)),
    }));
    expect(rulesChecked(late, 0)).toContain("nothing after 23:40 (the day’s latest published end)");
  });

  it("names a clause's value only where the day carries it: no reach clause without every window, no 'published hours' without them", () => {
    // One movable set without its start window: the reach limit is not claimed.
    const open = publishedShape((festival) => ({
      ...festival,
      timetable: (festival.timetable as Record<string, unknown>[]).map((slot) =>
        slot.act_id === "cy" ? { ...slot, not_before: null, not_after: null, stages: null } : slot,
      ),
    }));
    expect(dayRules(open.festival, 0)?.reach).toBe(false);
    expect(rulesChecked(open, 0)).not.toContain("two hours");
    expect(rulesChecked(open, 0)).not.toContain("neighbouring");
    // A window wider than two hours, or a stage two places away, is not the reach limit either.
    const wider = publishedShape((festival) => ({
      ...festival,
      timetable: (festival.timetable as Record<string, unknown>[]).map((slot) => (slot.act_id === "bo" ? { ...slot, not_after: 900 } : slot)),
    }));
    expect(dayRules(wider.festival, 0)?.reach).toBe(false);
    const far = publishedShape((festival) => ({
      ...festival,
      timetable: (festival.timetable as Record<string, unknown>[]).map((slot) =>
        slot.act_id === "bo" ? { ...slot, stages: ["main", "side", "barn"] } : slot,
      ),
    }));
    expect(dayRules(far.festival, 0)?.reach).toBe(false);
    // A locked set needs no window: the limit is about the sets that may move.
    const lockedBare = publishedShape((festival) => ({
      ...festival,
      timetable: (festival.timetable as Record<string, unknown>[]).map((slot) =>
        slot.act_id === "ann" ? { ...slot, not_before: null, not_after: null, stages: null } : slot,
      ),
    }));
    expect(dayRules(lockedBare.festival, 0)?.reach).toBe(true);
    // A stage whose hours are not its first published start to its last published end: "each stage’s hours".
    const hours = publishedShape((festival) => ({
      ...festival,
      stages: (festival.stages as Record<string, unknown>[]).map((stage) =>
        stage.id === "barn" ? { ...stage, hours: [{ day: 0, open: 870, close: 1260 }] } : stage,
      ),
    }));
    expect(dayRules(hours.festival, 0)?.publishedHours).toBe(false);
    expect(rulesChecked(hours, 0)).toContain(": each stage’s hours, nothing after 23:15");
    expect(rulesChecked(hours, 0)).not.toContain("published hours");
  });

  it("on the invented day: the same kinds of rule, no 'published', and no value the day does not carry", () => {
    const invented = { ...mockPreset(), synthetic: true };
    const sentence = rulesChecked(invented, invented.festival.timetable[0]?.day ?? 0);
    expect(sentence).toBe(
      "Checked against the invented day’s rules: each stage’s hours, the curfew, the changeover gap, locked sets, and pairs that must never overlap.",
    );
    expect(sentence).not.toMatch(/published/i);
    // Even an invented day shaped like a published one says no "published".
    expect(rulesChecked({ ...publishedShape(), synthetic: true }, 0)).not.toMatch(/published/i);
  });

  it("is worked out once per day in Try a move and passed to every card that says 'Adds no rule break.'", () => {
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    expect(source).toContain("const rules = useMemo(() => rulesChecked(preset, day), [preset, day]);");
    expect(source.match(/<RulesLine rules=\{rules\}/g)).toHaveLength(2);
    expect(source).not.toContain("RULES_CHECKED");
    // The tested place, the best tested place and the full list each take the day's sentence, and so does the full
    // list's room while it loads (round 37 fix pass 2), so its rules' room is laid out from the same day's words.
    expect(source.match(/^\s+rules=\{rules\}$/gm)).toHaveLength(5);
  });
});

describe("Try a move says what 'listed' means, what grows outside the list and what a legal place was checked against", () => {
  // Invented names and figures (the card's move above, and the tiny fixture festival).
  const verdict = (html: string) => /<div aria-live="polite" data-place-verdict="true"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  const paragraph = (html: string, hook: string) =>
    text(new RegExp(`<p ${hook}="true"[^>]*>([\\s\\S]*?)</p>`).exec(html)?.[1] ?? "");
  const kept = { ends: [], adds: [], keeps: [{ name: "Katy J Pearson", now: 3.4, after: 2.1 }], shared: new Map([["Katy J Pearson", { before: 45, after: 30 }]]) };

  it("pins the rules sentence and the inline definition of 'listed'", () => {
    // The tiny fixture's side stage has no hours and its sets carry no reach window, so neither clause claims more.
    expect(RULES).toBe(
      "Checked against this app’s rules for the day, read from the published timetable: each stage’s hours, nothing after 22:00 (the day’s latest published end), at least 15 min between sets on a stage, sets this app locks, and pairs that must never overlap.",
    );
    expect(listedLead("Sprints")).toBe("Listed clashes of Sprints (its three costliest, as scored): ");
  });

  it("prints the rules sentence after 'Adds no rule break.' for every legal place, and never before the rules are in", () => {
    const places = ["14:05", "14:10", "14:15"].map((start, i): PlacedOption => ({ ...option, start, end: `15:${String(5 * (i + 1)).padStart(2, "0")}` }));
    const all: MovesResult = { ...result, options: places };
    for (const place of places) {
      const html = render({ status: "ready", result: all, option: place });
      // The rule status and its rules in one line: ink status, the rules muted beside it.
      expect(paragraph(html, "data-rules-line")).toBe(`Adds no rule break. ${RULES}`);
      expect(html).toContain(`<p data-rules-line="true">Adds no rule break. <span class="text-muted-foreground">${RULES}</span></p>`);
      // Under it, the listed clashes.
      expect(verdict(html).indexOf("data-rules-line")).toBeLessThan(verdict(html).indexOf("data-listed-line"));
    }
    // The picked set's best place says it too.
    const tiny = parsePreset(rawTinyPreset())!;
    const picked: MovesResult = { ...result, act: "Bo Diddly Squat", actId: "bo", options: [{ ...option, stageId: "side", stage: "Side", start: "22:05", end: "23:35" }] };
    const column = renderToStaticMarkup(
      createElement(BestPlaceColumn, {
        status: "ready",
        result: picked,
        best: bestPlace(picked, tiny, tiny.festival.timetable, [{ aId: "ann", bId: "bo" }]),
        pickedName: "Bo Diddly Squat",
        synthetic: false,
        keepFull: false,
        onKeep: () => {},
        open: false,
        controls: "every-place",
        onToggle: () => {},
        rules: RULES,
      }),
    );
    expect(text(column)).toContain(`Adds no rule break. ${RULES}`);
    // Not while checking, not for a place the list does not hold, not when the list failed.
    for (const check of [
      moveCheck({ status: "loading", options: null }, move),
      moveCheck({ status: "ready", options: result }, { ...move, start: "16:40" }),
      moveCheck({ status: "error", options: null }, move),
    ]) {
      expect(render(check)).not.toContain(RULES);
    }
  });

  it("ends the summary with the outside sentence and adds the outside line only when an unlisted overlap starts or grows", () => {
    const one = render({ status: "ready", result, option }, { ...kept, outside: [{ name: "Joy Crookes", before: 0, after: 15 }] });
    expect(paragraph(one, "data-listed-line")).toBe(
      "Listed clashes of Sprints (its three costliest, as scored): 1 shortened (45 → 30 min), 0 added, 0 removed. Outside the list, 1 overlap starts or grows.",
    );
    expect(paragraph(one, "data-outside-line")).toBe("Outside the listed clashes: new 15 min overlap with Joy Crookes.");
    // The lead is muted; the clauses after it are ink.
    expect(one).toContain(
      '<p data-outside-line="true" class="text-sm leading-snug break-words text-pretty"><span class="text-muted-foreground">Outside the listed clashes:</span> new 15 min overlap with Joy Crookes.</p>',
    );
    // The line sits under the listed clashes, inside the one block read out together.
    expect(verdict(one).indexOf("data-listed-line")).toBeLessThan(verdict(one).indexOf("data-outside-line"));

    const four = render(
      { status: "ready", result, option },
      {
        ...kept,
        outside: [
          { name: "Wet Leg", before: 10, after: 25 },
          { name: "Joy Crookes", before: 0, after: 15 },
          { name: "Fontaines D.C.", before: 5, after: 15 },
          { name: "Cymande", before: 0, after: 5 },
        ],
      },
    );
    expect(paragraph(four, "data-listed-line")).toMatch(/0 removed\. Outside the list, 4 overlaps start or grow\.$/);
    expect(paragraph(four, "data-outside-line")).toBe(
      "Outside the listed clashes: lengthens the overlap with Wet Leg from 10 to 25 min. new 15 min overlap with Joy Crookes. 2 more overlaps get longer.",
    );

    for (const none of [{ ...kept, outside: [] }, kept]) {
      const html = render({ status: "ready", result, option }, none);
      expect(paragraph(html, "data-listed-line")).toBe(
        "Listed clashes of Sprints (its three costliest, as scored): 1 shortened (45 → 30 min), 0 added, 0 removed.",
      );
      expect(html).not.toContain("data-outside-line");
      expect(text(html)).not.toContain("Outside the list");
    }
  });

  it("titles the full list's lists 'Listed clashes it ends', 'Listed clashes it adds' and 'Listed clashes it keeps', with the outside line under them", () => {
    const tiny = parsePreset(rawTinyPreset())!;
    const place: PlacedOption = { ...option, stageId: "side", stage: "Side", start: "21:00", end: "22:30", clashesAfter: [{ name: "Ann Arbor", points: 2 }] };
    const picked: MovesResult = { ...result, act: "Bo Diddly Squat", actId: "bo", from: "Side 20:30-22:00", clashesNow: [{ name: "Ann Arbor", points: 3 }], options: [place] };
    const card = (timetable = tiny.festival.timetable) =>
      renderToStaticMarkup(
        createElement(MovesCard, {
          result: picked,
          preset: tiny,
          timetable,
          kept: 0,
          range: scaleRange(tiny.report.baseline),
          chosen: place,
          keep: { full: false, onKeep: () => {} },
          onChoose: () => {},
          rules: RULES,
        }),
      );
    const plain = card();
    const headings = [...plain.matchAll(/<h4[^>]*>([^<]*)<\/h4>/g)].map((match) => match[1]);
    expect(headings).toEqual(["Listed clashes it ends", "Listed clashes it adds", "Listed clashes it keeps"]);
    expect(plain).not.toMatch(/>Clashes it (ends|adds|keeps)</);
    expect(plain).not.toContain("data-outside-line");
    // Cy Twombly moved to 22:15-23:15 on the timetable: Bo at 21:00-22:30 now starts 15 minutes with it.
    const withCy = tiny.festival.timetable.map((slot) => (slot.act_id === "cy" ? { ...slot, start: 1335, end: 1395 } : slot));
    const outside = card(withCy);
    expect(text(outside)).toContain("Outside the listed clashes: new 15 min overlap with Cy Twombly.");
    expect(outside).toMatch(/<p data-outside-line="true" class="text-sm leading-snug break-words text-pretty sm:col-span-2">/);
  });

  it("says which rules a place passed for every place in the full list, above its listed clashes, and only for a legal place", () => {
    const tiny = parsePreset(rawTinyPreset())!;
    const places = ["21:00", "21:05", "21:10"].map(
      (start, i): PlacedOption => ({
        ...option,
        stageId: "side",
        stage: "Side",
        start,
        end: `22:${String(30 + 5 * i)}`,
        after: 38.8 + i / 10,
        clashesAfter: [{ name: "Ann Arbor", points: 2 }],
      }),
    );
    const picked: MovesResult = { ...result, act: "Bo Diddly Squat", actId: "bo", from: "Side 20:30-22:00", clashesNow: [{ name: "Ann Arbor", points: 3 }], options: places };
    const card = (answer: MovesResult, chosen: PlacedOption | null) =>
      renderToStaticMarkup(
        createElement(MovesCard, {
          result: answer,
          preset: tiny,
          timetable: tiny.festival.timetable,
          kept: 0,
          range: scaleRange(tiny.report.baseline),
          chosen,
          keep: { full: false, onKeep: () => {} },
          onChoose: () => {},
          rules: RULES,
        }),
      );
    const rules = (html: string) => [...html.matchAll(/<p data-rules-line="true"[^>]*>([\s\S]*?)<\/p>/g)].map((match) => text(match[1]));
    for (const place of places) {
      const html = card(picked, place);
      // One line per chosen place, in the tested place's words: the status in ink, the rules muted beside it.
      expect(rules(html)).toEqual([`Adds no rule break. ${RULES}`]);
      expect(html).toContain(
        `<p data-rules-line="true" class="mt-4 text-sm leading-snug break-words text-pretty">Adds no rule break. <span class="text-muted-foreground">${RULES}</span></p>`,
      );
      // Under the place's Clash Budget move, above the lists of the clashes it changes.
      expect(html.indexOf("data-rules-line")).toBeLessThan(html.indexOf("Listed clashes it ends"));
    }
    // A set that cannot move, or has no legal place, claims no rule status.
    expect(card({ ...picked, movable: false, why: "it is locked", options: [] }, null)).not.toContain("Adds no rule break");
    expect(card({ ...picked, options: [] }, null)).not.toContain("Adds no rule break");
  });

  it("says scored, never priced, in its visible and spoken words", () => {
    const tiny = parsePreset(rawTinyPreset())!;
    const ranked = topClashes(tiny.report.clashes, 0, Number.POSITIVE_INFINITY);
    const html = renderToStaticMarkup(createElement(TryAMove, { preset: tiny, day: 0, ranked, isLocked: () => false }));
    expect(text(html)).toContain("Pick a set to see every legal place on the 5-minute grid, scored.");
    // Cy Twombly has no usable signal: the select says so in the same word.
    expect(html).toMatch(/<option value="cy"[^>]*>[^<]*Cy Twombly \(not scored\)<\/option>/);
    expect(text(html)).not.toMatch(/pric/i);
    const unread = renderToStaticMarkup(
      createElement(TestedPlace, {
        card,
        mover: "Sprints",
        stage: "Woodsies",
        end: "15:15",
        minutes: null,
        drawing: null,
        check: { status: "error" },
        changes: null,
        keepFull: false,
        onKeep: () => {},
        onShowAll: () => {},
        rules: RULES,
      }),
    );
    expect(text(unread)).toContain("Index not scored here");
    expect(text(unread)).not.toMatch(/pric/i);
    // The plan's error box and the status line it speaks.
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    expect(source.match(/Could not score this plan\./g)).toHaveLength(2);
    expect(source).not.toContain("Could not price");
    expect(source.match(/Scoring every legal place for/g)).toHaveLength(2);
    expect(source).toContain("Scoring your tested moves");
  });
});

describe("the time domain every pair strip shares", () => {
  it("floors the earliest start and ceils the latest end to 15 minutes, with a tick every 30 and both ends", () => {
    // 14:05-15:00 and 14:40-15:50 -> 14:00 to 16:00.
    const domain = stripDomain([
      { start: 845, end: 900 },
      { start: 880, end: 950 },
    ]);
    expect([domain.start, domain.end, domain.step]).toEqual([840, 960, 30]);
    expect(domain.ticks).toEqual([840, 870, 900, 930, 960]);
  });

  it("gives the same lanes the same domain, in any order", () => {
    const a = { start: 845, end: 900 };
    const b = { start: 880, end: 950 };
    expect(stripDomain([a, b])).toEqual(stripDomain([b, a]));
  });
});

describe("Start with names the partner of every row, from the one map the card reads too", () => {
  /** A published day from the backend's built presets, when this checkout has them (they are not committed). */
  function published(file: string): Preset | null {
    const path = join(process.cwd(), "..", "backend", "presets", file);
    return existsSync(path) ? parsePreset(JSON.parse(readFileSync(path, "utf8"))) : null;
  }
  const glastonbury = published("glastonbury-2025-sun.json");
  const riot = published("riot-fest-2026-sun.json");
  const fixtures: [string, Preset | null][] = [
    ["Glastonbury 2025, Sunday", glastonbury],
    ["Riot Fest 2026, Sunday", riot],
    ["the invented day", { ...mockPreset(), synthetic: true }],
    ["the tiny fixture", parsePreset(rawTinyPreset())],
  ];

  type Row = { actId: string; minutes: number | null; partner: string | null };

  const unescape = (value: string) => value.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

  /** The rows "Start with" draws, in order: the figure and the name beside it, when there is one. */
  function rowsOf(html: string, starters: readonly { actId: string; name: string }[]): Row[] {
    const rows = html.match(/<button type="button" data-start-row="true"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(rows).toHaveLength(starters.length);
    return rows.map((row, i) => {
      const minutes = /<span data-start-minutes="true"[^>]*>(\d+) min<\/span>/.exec(row);
      const partner = /<span data-start-partner="true"[^>]*>([^<]+)<\/span>/.exec(row);
      // Never a figure without a name, nor a name without its figure.
      expect(Boolean(minutes), `row ${i}`).toBe(Boolean(partner));
      return {
        actId: starters[i].actId,
        minutes: minutes ? Number(minutes[1]) : null,
        partner: partner ? unescape(partner[1]) : null,
      };
    });
  }

  /** The card's minutes line: "45 → 30 min shared with Katy J Pearson", or null when it prints none. */
  function cardLine(html: string): { before: number; partner: string | null } | null {
    const heading = /<p class="type-numeral text-2xl[^"]*">([\s\S]*?)<\/p>/.exec(html)?.[1];
    if (!heading) return null;
    const words = unescape(text(heading));
    const match = /^(\d+) → \d+ min shared(?: with (.+))?$/.exec(words);
    expect(match, words).not.toBeNull();
    return { before: Number(match![1]), partner: match![2] ?? null };
  }

  /** The card's move for a set: 15 minutes later on its own stage, with a receipt naming its costliest partner. */
  function cardFor(preset: Preset, ranked: ReturnType<typeof topClashes>, actId: string): CardMove | null {
    const slot = preset.festival.timetable.find((item) => item.act_id === actId);
    const clash = ranked.find((item) => item.a.act_id === actId || item.b.act_id === actId);
    if (!slot || !clash) return null;
    const self = clash.a.act_id === actId ? clash.a : clash.b;
    const other = clash.a.act_id === actId ? clash.b : clash.a;
    return {
      move: { actId, stageId: slot.stage_id, day: slot.day, start: formatClock(slot.start + 15) },
      receipt: `${self.name} and ${other.name} share less time after this plan.`,
    };
  }

  function check(preset: Preset, kept: readonly StackMove[]) {
    const day = preset.festival.timetable[0]?.day ?? 0;
    const ranked = topClashes(preset.report.clashes, day, Number.POSITIVE_INFINITY);
    const moved = new Set(kept.map((move) => move.actId));
    const starters = startingSets(ranked, () => false).filter((set) => !moved.has(set.actId)).slice(0, START_WITH);
    expect(starters.length).toBeGreaterThan(0);
    const timetable = applyMoves(preset.festival.timetable, kept);
    let named = 0;
    for (const shown of starters) {
      const cardMove = cardFor(preset, ranked, shown.actId);
      const html = renderToStaticMarkup(createElement(TryAMove, { preset, day, ranked, isLocked: () => false, cardMove }));
      const pairs = starterPairsOf({
        actIds: [...starters.map((set) => set.actId), ...(cardMove ? [cardMove.move.actId] : [])],
        timetable,
        acts: preset.festival.acts,
        clashes: ranked.map((clash) => ({ aId: clash.a.act_id, bId: clash.b.act_id })),
        seed: null,
      });
      for (const row of rowsOf(html, starters)) {
        const pair = pairs.get(row.actId);
        if (pair && pair.minutes > 0) {
          expect(row.partner).toBe(pair.partnerName);
          expect(row.minutes).toBe(pair.minutes);
        } else {
          expect(row.minutes).toBeNull();
        }
      }
      // Wherever the card names a partner for the set it shows, it is the row's partner.
      const line = cardLine(html);
      if (line?.partner) {
        named += 1;
        expect(line.partner).toBe(pairs.get(shown.actId)?.partnerName);
        if (kept.length === 0) expect(line.before).toBe(pairs.get(shown.actId)?.minutes);
      }
    }
    return named;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.skipIf(glastonbury === null)(
    "on the Glastonbury Sunday default, the Sprints row and the card both say 45 minutes with Katy J Pearson",
    () => {
      const preset = glastonbury!;
      const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
      const sprints = preset.festival.acts.find((act) => act.name === "Sprints")!;
      const cardMove = cardFor(preset, ranked, sprints.id)!;
      expect(cardMove.receipt).toContain("Katy J Pearson");
      const html = renderToStaticMarkup(createElement(TryAMove, { preset, day: 0, ranked, isLocked: () => false, cardMove }));
      const starters = startingSets(ranked, () => false).slice(0, START_WITH);
      const row = rowsOf(html, starters).find((item) => item.actId === sprints.id);
      expect(row).toEqual({ actId: sprints.id, minutes: 45, partner: "Katy J Pearson" });
      // The same facts in two lines: "Woodsies · to 15:00", then "45 min with Katy J Pearson" on its own line.
      const slot = preset.festival.timetable.find((item) => item.act_id === sprints.id)!;
      const stage = preset.festival.stages.find((item) => item.id === slot.stage_id)!.name;
      const rowHtml = (html.match(/<button type="button" data-start-row="true"[^>]*>[\s\S]*?<\/button>/g) ?? []).find((item) =>
        item.includes(`>${sprints.name}</span>`),
      )!;
      const meta = /<span data-start-meta="true" class="[^"]*">((?:[^<]|<span[^>]*>[^<]*<\/span>)*)<\/span>/.exec(rowHtml)?.[1] ?? "";
      expect(text(meta)).toBe(`${stage} · to ${formatClock(slot.end)}`);
      const pair = /<span data-start-pair="true" class="[^"]*">([\s\S]*?<\/span>[^<]*<span[^>]*>[^<]*<\/span>)<\/span>/.exec(rowHtml)?.[1] ?? "";
      expect(text(pair)).toBe(`${row!.minutes} min with ${row!.partner}`);
      expect(text(html)).toContain(`${stage} · to ${formatClock(slot.end)} ${row!.minutes} min with ${row!.partner}`);
      expect(cardLine(html)).toEqual({ before: 45, partner: "Katy J Pearson" });
    },
  );

  it.skipIf(glastonbury === null)(
    "on the Glastonbury Sunday default, the counts line reads 'Listed clashes of Sprints (its three costliest, as scored):' then clashWords' counts",
    () => {
      const preset = glastonbury!;
      const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
      const sprints = preset.festival.acts.find((act) => act.name === "Sprints")!;
      const cardMove = cardFor(preset, ranked, sprints.id)!;
      // The endpoint's answer for the card's place, from the fixture: the set's clashes, at most three,
      // largest first, before and at the tested place (the same partners, still on the list).
      const listed = ranked
        .filter((clash) => clash.a.act_id === sprints.id || clash.b.act_id === sprints.id)
        .slice(0, 3)
        .map((clash) => ({ name: clash.a.act_id === sprints.id ? clash.b.name : clash.a.name, points: Math.round(clash.regret * 10) / 10 }));
      expect(listed.length).toBeGreaterThan(0);
      const stage = preset.festival.stages.find((item) => item.id === cardMove.move.stageId)!.name;
      const slot = preset.festival.timetable.find((item) => item.act_id === sprints.id)!;
      const start = Number(cardMove.move.start.slice(0, 2)) * 60 + Number(cardMove.move.start.slice(3));
      const end = formatClock(start + (slot.end - slot.start));
      const place: PlacedOption = {
        move: `${sprints.name}: moved`,
        stage,
        start: cardMove.move.start,
        after: 0,
        stageId: cardMove.move.stageId,
        end,
        day: 0,
        clashesAfter: listed,
      };
      const answer: MovesResult = { ...result, act: sprints.name, actId: sprints.id, clashesNow: listed, options: [place] };
      const changes = placeChanges(preset.festival, preset.festival.timetable, answer, place);
      const counts = clashWords(clashParts(changes, changes.shared));
      const html = renderToStaticMarkup(
        createElement(TestedPlace, {
          card: cardMove,
          mover: sprints.name,
          stage,
          end,
          minutes: null,
          drawing: null,
          check: { status: "ready", result: answer, option: place },
          changes,
          keepFull: false,
          onKeep: () => {},
          onShowAll: () => {},
          rules: rulesChecked(preset, 0),
        }),
      );
      expect(text(html)).toContain(`Adds no rule break. ${rulesChecked(preset, 0)}`);
      expect(text(html)).toContain(`Listed clashes of Sprints (its three costliest, as scored): ${counts}.`);
    },
  );

  it.skipIf(glastonbury === null)(
    "on Glastonbury, Sprints at Woodsies 14:15 says 'Listed clashes it adds', ends its summary with the outside sentence and names Joy Crookes",
    () => {
      const preset = glastonbury!;
      const sprints = preset.festival.acts.find((act) => act.name === "Sprints")!;
      // The moves route's answer for Sprints on the saved day (GET /api/presets/glastonbury-2025-sun/moves?act=sprints),
      // its first legal place: the hero's move. Its lists hold Sprints' three costliest clashes before and after.
      const place: PlacedOption = {
        move: "Sprints: Woodsies 14:00-15:00 -> Woodsies 14:15-15:15",
        stage: "Woodsies",
        start: "14:15",
        after: 114.26,
        stageId: "woodsies",
        end: "15:15",
        day: 0,
        clashesAfter: [
          { name: "Katy J Pearson", points: 2.7 },
          { name: "Cymande", points: 2 },
          { name: "The Libertines", points: 1.7 },
        ],
      };
      const answer: MovesResult = {
        ...result,
        act: "Sprints",
        actId: sprints.id,
        from: "Woodsies 14:00-15:00",
        before: 116.71,
        legalPlaces: 6,
        clashesNow: [
          { name: "Katy J Pearson", points: 4.1 },
          { name: "Cymande", points: 2.6 },
          { name: "The Libertines", points: 2.3 },
        ],
        options: [place],
      };
      const changes = placeChanges(preset.festival, preset.festival.timetable, answer, place);
      expect(changes.outside).toEqual([{ name: "Joy Crookes", before: 0, after: 15 }]);
      const tested = renderToStaticMarkup(
        createElement(TestedPlace, {
          card: { move: { actId: sprints.id, stageId: "woodsies", day: 0, start: "14:15" }, receipt: "" },
          mover: "Sprints",
          stage: "Woodsies",
          end: "15:15",
          minutes: null,
          drawing: null,
          check: { status: "ready", result: answer, option: place },
          changes,
          keepFull: false,
          onKeep: () => {},
          onShowAll: () => {},
          rules: rulesChecked(preset, 0),
        }),
      );
      const listed = text(/<p data-listed-line="true">([\s\S]*?)<\/p>/.exec(tested)?.[1] ?? "");
      expect(listed).toBe(
        "Listed clashes of Sprints (its three costliest, as scored): 3 shortened, 0 added, 0 removed. Outside the list, 1 overlap starts or grows.",
      );
      const outside = text(/<p data-outside-line="true"[^>]*>([\s\S]*?)<\/p>/.exec(tested)?.[1] ?? "");
      expect(outside).toBe("Outside the listed clashes: new 15 min overlap with Joy Crookes.");
      // No line reads "0 added" alone: the one that says it also says what grows outside the list.
      for (const paragraph of tested.match(/<p[^>]*>[\s\S]*?<\/p>/g) ?? []) {
        if (text(paragraph).includes("0 added")) expect(text(paragraph)).toContain("Outside the list, 1 overlap starts or grows.");
      }
      // The full list for the same place: the lists say "Listed", and the outside line sits under them.
      const card = renderToStaticMarkup(
        createElement(MovesCard, {
          result: answer,
          preset,
          timetable: preset.festival.timetable,
          kept: 0,
          range: scaleRange(preset.report.baseline),
          chosen: place,
          keep: { full: false, onKeep: () => {} },
          onChoose: () => {},
          rules: rulesChecked(preset, 0),
        }),
      );
      const headings = [...card.matchAll(/<h4[^>]*>([^<]*)<\/h4>/g)].map((match) => match[1]);
      expect(headings).toEqual(["Listed clashes it ends", "Listed clashes it adds", "Listed clashes it keeps"]);
      expect(card).toMatch(/>Listed clashes it adds<\/h4><p class="[^"]*">None<\/p>/);
      expect(text(card)).toContain("Outside the listed clashes: new 15 min overlap with Joy Crookes.");
      expect(card.indexOf("data-outside-line")).toBeGreaterThan(card.indexOf("Listed clashes it keeps"));
      // The full list's place says which rules it passed, as the tested place does.
      expect(text(card)).toContain(`Adds no rule break. ${rulesChecked(preset, 0)}`);
    },
  );

  for (const [name, preset] of fixtures) {
    it.skipIf(preset === null)(`on ${name}, every starting row's partner and minutes come from starterPairsOf, and the card agrees`, () => {
      expect(check(preset!, [])).toBeGreaterThan(0);
    });

    it.skipIf(preset === null)(`on ${name}, after one kept move, the rows read the plan's timetable and still agree with the card`, () => {
      const day = preset!.festival.timetable[0]?.day ?? 0;
      const ranked = topClashes(preset!.report.clashes, day, Number.POSITIVE_INFINITY);
      // Keep a move of the costliest clash's second set: an hour later on its own stage.
      const set = ranked[0].b.act_id;
      const slot = preset!.festival.timetable.find((item) => item.act_id === set)!;
      const kept: StackMove[] = [{ actId: set, stageId: slot.stage_id, day: slot.day, start: formatClock(slot.start + 60) }];
      const store = new Map([[planStorageKey(preset!.id), encodeMoves(kept)]]);
      vi.stubGlobal("window", {
        sessionStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: () => {},
          removeItem: () => {},
        },
      });
      check(preset!, kept);
    });
  }

  it("prefers the card's own pair, then the costliest clash that still shares time, then the longest overlap", () => {
    const acts = ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase() }));
    const slot = (act_id: string, start: number, end: number) => ({ act_id, day: 0, stage_id: act_id, start, end, locked: false });
    const timetable = [slot("a", 600, 660), slot("b", 630, 690), slot("c", 600, 700), slot("d", 800, 860)];
    const clashes = [
      { aId: "a", bId: "b" },
      { aId: "a", bId: "c" },
    ];
    const pairs = starterPairsOf({ actIds: ["a", "b", "c", "d"], timetable, acts, clashes, seed: { actId: "c", partnerId: "b" } });
    // A's costliest clash is with B (30 minutes), though it shares more with C.
    expect(pairs.get("a")).toEqual({ partnerId: "b", partnerName: "B", minutes: 30 });
    // C carries the card's pair, B.
    expect(pairs.get("c")).toEqual({ partnerId: "b", partnerName: "B", minutes: 60 });
    // B is in A's clash first.
    expect(pairs.get("b")).toEqual({ partnerId: "a", partnerName: "A", minutes: 30 });
    // D shares no time with any set: no entry, so its row prints no figure.
    expect(pairs.has("d")).toBe(false);
    // A clash that no longer shares time on the list's timetable gives way to the longest overlap.
    const moved = timetable.map((item) => (item.act_id === "b" ? { ...item, start: 900, end: 960 } : item));
    expect(starterPairsOf({ actIds: ["a"], timetable: moved, acts, clashes: [{ aId: "a", bId: "b" }], seed: null }).get("a")).toEqual({
      partnerId: "c",
      partnerName: "C",
      minutes: 60,
    });
  });
});

describe("after a set is picked, the right column is never empty from 1024 px", () => {
  // Every name and figure here is invented (the tiny fixture festival).
  const tiny = parsePreset(rawTinyPreset())!;
  const place = (start: string, end: string, after: number): PlacedOption => ({
    move: `Bo Diddly Squat: Side 20:30-22:00 -> Side ${start}-${end}`,
    stage: "Side",
    start,
    after,
    stageId: "side",
    end,
    day: 0,
    clashesAfter: [],
  });
  const picked: MovesResult = {
    act: "Bo Diddly Squat",
    actId: "bo",
    from: "Side 20:30-22:00",
    movable: true,
    why: null,
    before: 104.2,
    legalPlaces: 2,
    priced: true,
    clashesNow: [{ name: "Ann Arbor", points: 3 }],
    options: [place("22:05", "23:35", 100.1), place("22:10", "23:40", 101)],
  };
  const pairs = [{ aId: "ann", bId: "bo" }];

  function column(props: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      createElement(BestPlaceColumn, {
        status: "ready",
        result: picked,
        best: bestPlace(picked, tiny, tiny.festival.timetable, pairs),
        pickedName: "Bo Diddly Squat",
        synthetic: false,
        keepFull: false,
        onKeep: () => {},
        open: false,
        controls: "every-place",
        onToggle: () => {},
        rules: RULES,
        ...props,
      }),
    );
  }

  it("takes the engine's first listed place as its best tested place, with its minutes and clashes", () => {
    const best = bestPlace(picked, tiny, tiny.festival.timetable, pairs)!;
    expect(best.option).toBe(picked.options[0]);
    expect(best.move).toEqual({ actId: "bo", stageId: "side", day: 0, start: "22:05" });
    expect(best.figures?.minutes).toEqual({ partner: "Ann Arbor", before: 60, after: 0 });
    expect(bestPlace({ ...picked, movable: false, options: [] }, tiny, tiny.festival.timetable, pairs)).toBeNull();
    expect(bestPlace(null, tiny, tiny.festival.timetable, pairs)).toBeNull();
  });

  it("shows its best tested place with Keep this move and the way to every legal place, in the right column", () => {
    const html = column();
    const words = text(html);
    expect(words).toContain("Best tested place");
    expect(words).toContain("Bo Diddly Squat at Side · 22:05–23:35");
    expect(words).toContain("60 → 0 min shared with Ann Arbor");
    expect(words).toContain("Index 104.2 → 100.1");
    expect(words).toContain("Adds no rule break.");
    expect(words).toContain("Keep this move");
    expect(words).toContain("Show every legal place");
    expect(html).toMatch(/aria-expanded="false" aria-controls="every-place"/);
    // The right seven columns of the picker's row from 1024 px, and not shown below it (one copy per width).
    const shell = /^<div[^>]*>/.exec(html)?.[0] ?? "";
    expect(shell).toContain("max-lg:hidden");
    expect(shell).toContain("lg:col-start-6");
    expect(shell).toContain("lg:row-start-2");
    // The full list is open: the button says how to close it.
    expect(column({ open: true })).toMatch(/aria-expanded="true"[^>]*>Hide every legal place/);
  });

  it("is not empty while the places load, nor for a set that cannot move", () => {
    expect(text(column({ status: "loading", result: null, best: null }))).toContain(
      "Scoring every legal place for Bo Diddly Squat",
    );
    const locked = { ...picked, movable: false, why: "locked in place", options: [] };
    expect(text(column({ result: locked, best: null }))).toContain("It cannot move: locked in place.");
  });

  it("from 1024 px keeps the full list closed under it until asked, and below 1024 px shows it as before", () => {
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    expect(source).toContain('<div className={cn("mt-6", !allOpen && "lg:hidden")}>');
    // The list's room while it loads, under the columns, is the phone's copy only; the column holds its own from 1024 px.
    expect(source).toMatch(/<div className="mt-6 lg:hidden">\s*<PlacesRoom\s+name=\{pickedName \?\? "this set"\}/);
  });
});

describe("a late answer holds its room, so it moves nothing on screen (round 37, fix pass 2, F1)", () => {
  // Every name and figure here is invented (the tiny fixture festival).
  const tiny = parsePreset(rawTinyPreset())!;
  const picked: MovesResult = {
    act: "Bo Diddly Squat",
    actId: "bo",
    from: "Side 20:30-22:00",
    movable: true,
    why: null,
    before: 104.2,
    legalPlaces: 2,
    priced: true,
    clashesNow: [{ name: "Ann Arbor", points: 3 }],
    options: [
      { move: "Bo Diddly Squat: Side 20:30-22:00 -> Side 22:05-23:35", stage: "Side", start: "22:05", end: "23:35", after: 100.1, stageId: "side", day: 0, clashesAfter: [] },
    ],
  };
  const pairs = [{ aId: "ann", bId: "bo" }];
  const best = bestPlace(picked, tiny, tiny.festival.timetable, pairs)!;
  const drawn = drawingHeight(best.drawing!, "short");
  const room: PlaceRoom = { partner: { name: "Ann Arbor", minutes: 60 }, unscored: false, drawing: drawn };
  const column = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(BestPlaceColumn, {
        status: "ready",
        result: picked,
        best,
        pickedName: "Bo Diddly Squat",
        synthetic: false,
        keepFull: false,
        onKeep: () => {},
        open: false,
        controls: "every-place",
        onToggle: () => {},
        rules: RULES,
        room,
        roomKey: ":bo",
        ...props,
      }),
    );
  const pending = column({ status: "loading", result: null, best: null });
  const settled = column({});
  // The class lists that shape each line, in page order: what both frames must hold, line for line.
  const LINES = [
    "border-t border-border pt-5 sm:pt-6",
    "text-[0.8125rem] leading-5 font-semibold text-muted-foreground",
    "type-numeral text-2xl leading-tight break-words",
    "mt-1.5 space-y-1 text-sm leading-snug break-words text-pretty",
    "mt-6 border-t border-border",
  ];
  const at = (html: string, needle: string) => html.indexOf(`class="${needle}`);
  // The rule status's room: "Adds no rule break." with its letters reversed, so no claim is in the page before the check.
  const RULE_STATUS_ROOM_OF_TEST = ".kaerb elur on sddA";

  it("keeps the place's room when the answer reads shorter and what sits under it is on screen, and only then", () => {
    const was = { width: 600, height: 540 };
    // A shorter answer whose end is on screen: the room stays, so nothing under it moves up.
    expect(heldHeight(was, { width: 600, height: 500, end: 860 }, 900)).toBe(540);
    // Scrolled past: the answer ends above the screen and what is under it is in view.
    expect(heldHeight(was, { width: 600, height: 500, end: -40 }, 900)).toBe(540);
    // The answer ends below the fold: nothing that moves is on screen, so it takes its own height.
    expect(heldHeight(was, { width: 600, height: 500, end: 900 }, 900)).toBeNull();
    // As tall or taller: nothing to hold.
    expect(heldHeight(was, { width: 600, height: 540, end: 700 }, 900)).toBeNull();
    expect(heldHeight(was, { width: 600, height: 620, end: 700 }, 900)).toBeNull();
    // The width changed, or no room was measured (a hidden copy measures 0): the answer takes its own height.
    expect(heldHeight(was, { width: 601, height: 500, end: 700 }, 900)).toBeNull();
    expect(heldHeight({ width: 0, height: 0 }, { width: 0, height: 0, end: 0 }, 900)).toBeNull();
    expect(heldHeight(null, { width: 600, height: 500, end: 700 }, 900)).toBeNull();
    // An answer within 400 ms of the visitor's own press is part of what the press did: it takes its own height
    // (so a quick answer never leaves space under it); from 400 ms on it is late, and the room is kept.
    expect(heldHeight(was, { width: 600, height: 500, end: 860 }, 900, 120)).toBeNull();
    expect(heldHeight(was, { width: 600, height: 500, end: 860 }, 900, 399)).toBeNull();
    expect(heldHeight(was, { width: 600, height: 500, end: 860 }, 900, 400)).toBe(540);
    expect(heldHeight(was, { width: 600, height: 500, end: 860 }, 900, 1500)).toBe(540);
  });

  it("draws the best place's pending frame line for line with the place it holds the room of", () => {
    for (const line of LINES) {
      expect(at(pending, line), line).toBeGreaterThan(-1);
      expect(at(settled, line), line).toBeGreaterThan(-1);
    }
    // In the same order in both.
    const order = (html: string) => LINES.map((line) => at(html, line));
    expect(order(pending)).toEqual([...order(pending)].sort((p, q) => p - q));
    expect(order(settled)).toEqual([...order(settled)].sort((p, q) => p - q));
    // The dateline's one line: the same size and leading.
    expect(pending).toMatch(/<p class="mt-1 flex items-start gap-2 text-\[0\.9375rem\] leading-snug text-muted-foreground">/);
    expect(settled).toContain('<p data-dateline="true" class="mt-1 text-[0.9375rem] leading-snug">');
    // The drawing's room is the drawing's own height, after the same 20px.
    expect(settled).toContain('data-tested-drawing="true" class="mt-5 min-w-0"');
    expect(pending).toContain(`data-drawing-room="true" class="mt-5 rounded-md bg-muted" style="height:${drawn}px"`);
    // The actions' row: the buttons' 44px, 16px under the rule.
    expect(settled).toMatch(/class="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2"><button[^>]*class="[^"]*h-11/);
    expect(pending).toContain('data-actions-room="true" class="mt-4 h-11"');
  });

  it("sets in words only what the page already knows, and claims nothing before the answer", () => {
    const words = text(pending);
    expect(words).toContain("Best tested place");
    expect(words).toContain("Scoring every legal place for Bo Diddly Squat");
    // The set it shares time with and the minutes they share now; the minutes after wait for the answer.
    expect(words).toContain("60 → min shared with Ann Arbor");
    expect(words).toContain("Index checking…");
    expect(words).toContain("Checking rules…");
    for (const claim of ["Adds no rule break", "removed", "added", "Outside the listed clashes", "Keep this move", "Show every legal place", "100.1", "22:05"]) {
      expect(words).not.toContain(claim);
    }
    // Not even in an attribute: the rule status's room is its letters reversed, the rules' room is worded for a
    // check still running.
    expect(pending).not.toContain(RULES);
    expect(pending).not.toContain("Adds no rule break");
    expect(pending).toContain('data-ghost=".kaerb elur on sddA"');
    expect(pending).toContain(`data-ghost="${RULES.replace(/^Checked against/, "Checking against")}"`);
    // Nothing in it can be pressed or focused.
    expect(pending).not.toMatch(/<(button|a)\b/);
    expect(pending).not.toContain("tabindex");
  });

  it("opens with the no-signal line when the day's coverage does not score the set, as the answer will", () => {
    expect(text(column({ status: "loading", result: null, best: null, room: { ...room, unscored: true } }))).toContain(
      "Qloo has no usable signal for Bo Diddly Squat, so its clashes are not scored and no place changes the Clash Budget Index.",
    );
    expect(text(pending)).not.toContain("no usable signal");
  });

  it("holds the tested place's verdict room while its rules are checked", () => {
    const checking = render(moveCheck({ status: "loading", options: null }, move));
    const done = render(moveCheck({ status: "ready", options: result }, move));
    const verdictOf = (html: string) => /<div aria-live="polite" data-place-verdict="true"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    // The rule status's line, the listed line and one outside line, each in the lines' own block.
    expect(verdictOf(checking)).toMatch(/^<p data-rules-room="true" class="text-muted-foreground"><span class="inline-grid whitespace-nowrap">/);
    expect(verdictOf(checking)).toContain(`<p aria-hidden="true" data-listed-room="true"><span class="text-muted-foreground">${listedLead(result.act)}</span>`);
    expect(verdictOf(checking)).toContain('<p aria-hidden="true" data-outside-room="true">');
    expect(verdictOf(checking)).toContain('data-ghost="Outside the listed clashes: new 00 min overlap with Katy J Pearson."');
    expect(verdictOf(done)).toContain("data-rules-line");
    // A known move's listed room is the shape of a middling listed line, with no figure from any answer; while it
    // is not known whether the place grows an overlap outside the list, the line's last sentence and the outside
    // line keep their room.
    expect(checking).toContain('data-ghost="0 shortened (00 → 00 min), 0 added, 0 removed. Outside the list, 0 overlaps start or grow."');
    expect(text(checking)).toContain("Checking rules…");
    expect(checking).not.toContain(RULES);
    // A place that cannot grow an overlap outside the list holds no outside room.
    const inside = renderToStaticMarkup(
      createElement(TestedPlace, {
        card,
        mover: result.act,
        stage: "Woodsies",
        end: "15:15",
        minutes: { partner: "Katy J Pearson", before: 45, after: 30 },
        drawing: null,
        check: { status: "checking" },
        changes: null,
        keepFull: false,
        onKeep: () => {},
        onShowAll: () => {},
        rules: RULES,
        outside: false,
      }),
    );
    expect(inside).toContain('data-ghost="0 shortened (00 → 00 min), 0 added, 0 removed."');
    expect(inside).not.toContain("data-outside-room");
    // The best place's room, before the engine names a place, holds the long line and the outside line.
    expect(pending).toContain('data-ghost="0 shortened (00 → 00 min), 0 lengthened (00 → 00 min), 0 added, 0 removed. Outside the list, 0 overlaps start or grow."');
    expect(pending).toContain('data-ghost="Outside the listed clashes: new 00 min overlap with Ann Arbor."');
  });

  it("holds an outside line's room for a known move only when it can start or lengthen an overlap outside the list", () => {
    // The tiny fixture's day (invented): Bo Diddly Squat 20:30–22:00 on Side; Ann Arbor 20:00–21:30 overlaps it (its
    // one clash, so its costliest); Cy Twombly 16:40–17:40 overlaps nothing.
    const at = (start: string) => mayGrowOutside(tiny, tiny.festival.timetable, { actId: "bo", day: 0, start });
    // Where it plays now, or later (the overlap with Ann Arbor shrinks): nothing grows.
    expect(at("20:30")).toBe(false);
    expect(at("20:45")).toBe(false);
    // Earlier, its overlap with Ann Arbor grows, but that clash is in the list: no outside line can come.
    expect(at("20:15")).toBe(false);
    // Over Cy Twombly, a new overlap outside its costliest clashes starts: the room is held.
    expect(at("16:40")).toBe(true);
    // A set that is not on the timetable, or a start that does not read: no room.
    expect(mayGrowOutside(tiny, tiny.festival.timetable, { actId: "nobody", day: 0, start: "20:00" })).toBe(false);
    expect(at("later")).toBe(false);
    // The source passes the card's move through it.
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    expect(source).toContain("(seedShown ? mayGrowOutside(preset, timetable, seedShown.move) : false)");
    expect(source).toMatch(/roomKey=\{encodeMoves\(moves\)\}\s+outside=\{seedOutside\}/);
  });

  it("holds the full list's room under 1024 px: its heading's words, a quiet row per place it can show, the drawing's height", () => {
    const html = renderToStaticMarkup(
      createElement(PlacesRoom, { name: "Bo Diddly Squat", rules: RULES, drawing: drawn, range: scaleRange(tiny.report.baseline) }),
    );
    expect(text(html)).toContain("Where Bo Diddly Squat could go");
    // The card's blocks in its order: the index's room, the rules', the clashes', the drawing's, the action's, the footnote's.
    const blocks = ['data-ghost="000.0 → 000.0"', `data-ghost="${RULE_STATUS_ROOM_OF_TEST} `, 'data-ghost="Listed clashes it ends"', `style="height:${drawn}px"`, 'class="mt-4 h-11"', 'data-ghost="00 legal places'];
    const where = blocks.map((block) => html.indexOf(block));
    expect(where.every((index) => index > -1), JSON.stringify(where)).toBe(true);
    expect(where).toEqual([...where].sort((p, q) => p - q));
    expect(text(html)).toContain("Scoring every legal place for Bo Diddly Squat");
    // Not a heading: the answer's own heading is the one that takes focus and that a test waits for.
    expect(html).not.toMatch(/<h[1-6]\b/);
    expect(html).toContain('<p class="type-title break-words">Where Bo Diddly Squat could go</p>');
    expect(html.match(/<li class="h-11 rounded-md bg-muted"><\/li>/g)).toHaveLength(MOVES_LIMIT);
    expect(html).toContain(`style="height:${drawn}px"`);
    expect(html).not.toMatch(/<(button|a)\b/);
    expect(html).not.toContain(RULES);
    expect(html).not.toContain("Adds no rule break");
  });

  it("wires the held room around the best place, the full list and the tested place, keyed by the question", () => {
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    expect(source).toContain('<HeldRoom room={roomKey ?? pickedName ?? ""} pending={status === "loading"} hold={status === "ready"}>');
    expect(source).toContain('<HeldRoom room={choiceKey} pending={state.status === "loading"} hold={state.status === "ready"}>');
    // The tested place holds its verdict's room (not the whole card), so its actions under the verdict never move.
    expect(source).toMatch(
      /<HeldRoom\s+room=\{`\$\{roomKey\}\|\$\{card\.move\.actId\}@\$\{card\.move\.stageId\}:\$\{card\.move\.day\}:\$\{card\.move\.start\}`\}\s+pending=\{checking\}\s+hold=\{check\?\.status === "ready" \|\| check\?\.status === "unlisted"\}\s*>\s*<div aria-live="polite" data-place-verdict/,
    );
    expect(source).toMatch(/rules=\{rules\}\s+roomKey=\{encodeMoves\(moves\)\}/);
    expect(source).toMatch(/room=\{placeRoom\}\s+roomKey=\{choiceKey\}/);
    // The only height it sets is the one `heldHeight` decides (with the time since the visitor's last key or pointer
    // press, watched from the section's start), and it is dropped on a scroll or resize that leaves nothing on screen
    // to move.
    expect(source).toContain("const keep = hold ? heldHeight(was, now(), window.innerHeight, performance.now() - lastPress) : null;");
    expect(source).toContain('window.addEventListener("pointerdown", note, { capture: true, passive: true });');
    expect(source).toContain('window.addEventListener("keydown", note, { capture: true, passive: true });');
    expect(source).toContain("useEffect(() => watchPresses(), []);");
    expect(source.match(/element\.style\.minHeight = `\$\{keep\}px`;/g)).toHaveLength(1);
    expect(source).toContain('window.addEventListener("scroll", release, { passive: true });');
  });
});

describe("the kept plan's anchor and the seeds from outside the section", () => {
  const tiny = parsePreset(rawTinyPreset())!;
  const ranked = topClashes(tiny.report.clashes, 0, Number.POSITIVE_INFINITY);
  const kept: StackMove = { actId: "bo", stageId: "side", day: 0, start: "22:05" };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives the plan id your-plan, focusable, with a scroll margin under the sticky header and nav", () => {
    const store = new Map([[planStorageKey(tiny.id), encodeMoves([kept])]]);
    vi.stubGlobal("window", {
      sessionStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: () => {}, removeItem: () => {} },
    });
    const html = renderToStaticMarkup(createElement(TryAMove, { preset: tiny, day: 0, ranked, isLocked: (id: string) => id === "ann" }));
    const plan = /<div[^>]*id="your-plan"[^>]*>/.exec(html)?.[0] ?? "";
    expect(plan).toContain('tabindex="-1"');
    expect(plan).toContain("scroll-mt-12");
    expect(html.match(/id="your-plan"/g)).toHaveLength(1);
  });

  it("keeps a step seeded by an agent run as the plan, as the card's keep does", () => {
    const html = renderToStaticMarkup(
      createElement(TryAMove, {
        preset: tiny,
        day: 0,
        ranked,
        isLocked: (id: string) => id === "ann",
        seedStep: { nonce: 1, step: kept, from: "agent" },
      }),
    );
    expect(html).toContain('id="your-plan"');
  });

  it("offers the next clash in the published day's ranking under a plan, as one plain text action", () => {
    const store = new Map([[planStorageKey(tiny.id), encodeMoves([kept])]]);
    vi.stubGlobal("window", {
      sessionStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: () => {}, removeItem: () => {} },
    });
    // The label names the pair and says whose ranking it is; never "costliest" after the plan.
    expect(nextLabel({ a: "Act One", b: "Act Two" })).toBe("Next: Act One × Act Two, the next clash in the published day’s ranking");
    expect(nextLabel({ a: "Act One", b: "Act Two" })).not.toMatch(/costliest/);
    const plan = {
      publishedBudget: 104.2,
      budget: 100.1,
      steps: [{ act: "Bo Diddly Squat", actId: "bo", move: "Bo Diddly Squat: moved", stage: "Side", stageId: "side", day: 0, start: "22:05", end: "23:35", budgetAfter: 100.1 }],
      clashes: [],
      options: null,
    };
    const onPress = vi.fn();
    const card = (next: { label: string; onPress: () => void } | null) =>
      renderToStaticMarkup(
        createElement(ScratchPlan, {
          preset: tiny,
          day: 0,
          plan,
          moves: [kept],
          range: { low: 92, high: 109 },
          onUndo: () => {},
          onStartOver: () => {},
          next,
        }),
      );
    const label = nextLabel({ a: "Ann Arbor", b: "Cy Twombly" });
    const html = card({ label, onPress });
    // A ruled text button (44px tall), not a pill or badge, and only when there is a next clash.
    expect(html).toMatch(new RegExp(`<button[^>]*data-variant="ruled"[^>]*>${label}`));
    expect(html).toMatch(/<button[^>]*class="[^"]*min-h-11[^"]*"[^>]*>Next:/);
    expect(card(null)).not.toContain("Next:");
    // The section reads it from the published ranking with the kept moves skipped (nextRankedPair, lib/moves.test.ts).
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    expect(source).toContain("nextRankedPair(ranked, moved,");
  });

  it("neither scrolls nor moves focus for a card's or an agent's seed", () => {
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    const seeded = source.slice(source.indexOf("const seedFrom ="), source.indexOf("// Keep the tab's plan in step"));
    expect(seeded).not.toContain("focusOn(");
    expect(seeded).toContain('setFromCard(seedFrom === "card")');
  });

  it("tells the page only the steps the engine has priced, never a step it refused", () => {
    const source = readFileSync(join(__dirname, "try-a-move.tsx"), "utf8");
    expect(source).toContain("const held = state.plan ? moves : NO_STEPS;");
    expect(source).toMatch(/keptOut\.current\?\.\(heldNow\.current\);\s*\}, \[heldKey\]\);/);
  });
});

describe("Keep two sets apart: a stage change says it needs sign-off", () => {
  // Invented changes for the tiny fixture's two sets.
  const fix = (stageChanges: number, start: string, stage = "Side"): RuleFix => ({
    setsMoved: 1,
    minutesMoved: 30,
    stageChanges,
    budgetAfter: 100,
    flagsNow: 0,
    flagsAfter: 0,
    moves: [
      {
        actId: "bo",
        act: "Bo Diddly Squat",
        from: "Side 20:30-22:00",
        stageId: stage.toLowerCase(),
        stage,
        day: 0,
        start,
        end: "23:30",
        minutesMoved: 30,
      },
    ],
  });
  const row = (change: RuleFix) =>
    text(
      renderToStaticMarkup(
        createElement(ChangeCard, {
          fix: change,
          n: 1,
          before: 104.2,
          dayLabel: () => null,
          pressed: false,
          keepState: "ready",
          roomText: null,
          note: null,
          onPreview: () => {},
          onKeep: () => {},
          buttonRef: () => {},
        }),
      ),
    );

  it("labels a change that moves a set to another stage, and only that one", () => {
    expect(STAGE_SIGN_OFF).toBe("Changes stage: needs production sign-off");
    expect(row(fix(1, "21:00", "Main"))).toContain(STAGE_SIGN_OFF);
    expect(row(fix(0, "21:00"))).not.toContain("Changes stage");
    // Ink words, medium weight, on the row's paper: a fact production acts on, not small grey print, and no chip.
    const html = renderToStaticMarkup(
      createElement(ChangeCard, {
        fix: fix(1, "21:00", "Main"),
        n: 1,
        before: 104.2,
        dayLabel: () => null,
        pressed: false,
        keepState: null,
        roomText: null,
        note: null,
        onPreview: () => {},
        onKeep: () => {},
        buttonRef: () => {},
      }),
    );
    expect(html).toContain(`<p class="mt-0.5 text-sm font-medium text-foreground">${STAGE_SIGN_OFF}</p>`);
    expect(html).not.toMatch(/text-muted-foreground">Changes stage/);
  });

  it("shows the check on Keep this change only once the plan holds the change", () => {
    const button = (keepState: "ready" | "kept" | "full") => {
      const html = renderToStaticMarkup(
        createElement(ChangeCard, {
          fix: fix(1, "21:00", "Main"),
          n: 1,
          before: 104.2,
          dayLabel: () => null,
          pressed: false,
          keepState,
          roomText: null,
          note: null,
          onPreview: () => {},
          onKeep: () => {},
          buttonRef: () => {},
        }),
      );
      const label = keepState === "kept" ? "Kept in your plan" : "Keep this change";
      return html.slice(html.lastIndexOf("<button", html.indexOf(label)), html.indexOf(label));
    };
    // Before it is pressed: the words alone.
    expect(button("ready")).not.toContain("lucide-check");
    expect(button("full")).not.toContain("lucide-check");
    // Kept: the check beside "Kept in your plan".
    expect(button("kept")).toContain("lucide-check");
  });

  it("lists same-stage changes before stage changes, each group in the route's own order", () => {
    const a = fix(1, "21:00", "Main");
    const b = fix(0, "21:05");
    const c = fix(1, "21:10", "Main");
    const d = fix(0, "21:15");
    expect(sameStageFirst([a, b, c, d])).toEqual([b, d, a, c]);
    expect(sameStageFirst([b, d])).toEqual([b, d]);
    expect(SAME_STAGE_FIRST).toContain("smallest changes first: fewest sets, then fewest minutes moved.");
  });
});

describe("the lock words: this app's locks on a published day, the invented day's own (round 36)", () => {
  type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  // The tiny day: Main's one set (Ann Arbor) is locked; Side's last set (Bo Diddly Squat, 20:30) is not, so its
  // locks are not exactly the last set on each stage. Locking Bo Diddly Squat makes them exactly that.
  const day = (synthetic: boolean, lastLocked: boolean) => {
    const raw = rawTinyPreset() as Raw;
    raw.synthetic = synthetic;
    if (lastLocked) raw.festival.timetable[1].locked = true;
    return parsePreset(raw)!;
  };
  const holdsOf = (preset: Preset) =>
    lockRuleHolds(
      preset.festival.timetable
        .filter((slot) => slot.day === 0)
        .map((slot): LockSlot => ({ stage: slot.stage_id, day: slot.day, start: slot.start, end: slot.end, locked: slot.locked })),
    );
  const legend = (preset: Preset) =>
    text(
      renderToStaticMarkup(
        createElement(TimetableLegend, { synthetic: preset.synthetic === true, holds: holdsOf(preset) }),
      ),
    );
  const list = (preset: Preset, fixedShare: number) =>
    text(
      renderToStaticMarkup(
        createElement(ClashList, {
          clashes: topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY),
          slots: new Map(preset.festival.timetable.map((slot) => [slot.act_id, slot])),
          stages: new Map(preset.festival.stages.map((stage) => [stage.id, stage])),
          totalRanked: preset.report.clashes.length,
          fixedShare,
          isLocked: (actId: string) => preset.festival.timetable.some((slot) => slot.act_id === actId && slot.locked),
          activeKeys: new Set<string>(),
          dimmed: false,
          onOpen: () => {},
          onHighlight: () => {},
          synthetic: preset.synthetic === true,
        }),
      ),
    ).replace(/&#x27;|&rsquo;/g, "’");

  it("labels the board's lock by the rule only where the locked sets are exactly the last set on each stage", () => {
    expect(holdsOf(day(false, true))).toBe(true);
    expect(legend(day(false, true))).toContain(LOCK_SHORT);
    expect(LOCK_SHORT).toBe("Locked by this app: the last set on its stage stays in place.");
    // A day whose locks are not exactly the stages' last sets: the generic words, never the rule.
    expect(holdsOf(day(false, false))).toBe(false);
    expect(legend(day(false, false))).toContain("Locked by this app: kept in place.");
    expect(LOCK_GENERIC).toBe("Locked by this app: kept in place.");
    expect(legend(day(false, false))).not.toContain("the last set on its stage");
    // The old words, which read as the festival's own fact, are gone.
    expect(legend(day(false, true))).not.toContain("Locked set: fixed slot");
    // The key's row spells the lock's words in full beside its lock swatch, so whose lock it is needs no click
    // (round 36 fix pass: the short name alone said it only after "How to read the board").
    const html = renderToStaticMarkup(createElement(TimetableLegend, { synthetic: false, holds: true }));
    expect(html).toContain(`<span data-legend-item="locked">${LOCK_SHORT}</span>`);
    expect(html).not.toContain('<span data-legend-item="locked">Locked</span>');
    expect(html).toContain("lucide-lock");
  });

  it("says whose lock it is in the key's row with no click, once: the reading under the row does not repeat it", () => {
    for (const synthetic of [false, true])
      for (const holds of [false, true]) {
        const html = renderToStaticMarkup(createElement(TimetableLegend, { synthetic, holds }));
        const label = lockLabel({ synthetic, holds });
        // In the row (the key's list), as a sentence that may wrap on a narrow key, its glyph on the first line.
        const row = html.slice(html.indexOf('aria-label="Timetable key"'), html.indexOf("</ul>"));
        expect(row).toContain(`<li class="flex min-w-0 items-start gap-x-2">`);
        expect(row).toContain(`<span data-legend-item="locked">${label}</span>`);
        // Once in all: neither the toggled reading nor the folded one says it again.
        expect(html.split(label)).toHaveLength(2);
        expect(html.match(/data-legend-item="locked"/g)).toHaveLength(1);
        // Every other symbol keeps its short name in the row and its reading below.
        expect(row).toContain('<li class="flex items-center gap-x-2 whitespace-nowrap">');
        expect(row).toContain('data-legend-item="no-signal"');
      }
  });

  it("on a phone keeps the lock out of the folded key, on its own line above the fold, so it needs no tap", () => {
    for (const synthetic of [false, true])
      for (const holds of [false, true]) {
        const line = renderToStaticMarkup(createElement(LockKey, { synthetic, holds }));
        expect(line).toContain(`<span data-legend-item="locked">${lockLabel({ synthetic, holds })}</span>`);
        expect(line).toContain("lucide-lock");
        expect(line.includes("by this app")).toBe(!synthetic);
        // The fold leaves the lock out and does not count it.
        const fold = renderToStaticMarkup(createElement(TimetableLegend, { synthetic, holds, lockApart: true }));
        expect(fold).not.toContain('data-legend-item="locked"');
        expect(fold).not.toContain("lucide-lock");
        expect(fold).not.toContain(lockLabel({ synthetic, holds }));
        expect(fold).toContain('data-legend-item="no-signal"');
      }
    for (const planShown of [false, true])
      expect(legendSymbolCount({ planShown, lockApart: true })).toBe(legendSymbolCount({ planShown }) - 1);
    // In the page: the line sits above the phone's fold, hidden from 640 px, where the key's row says it.
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    const lockKeys = source.match(/<LockKey\b[^>]*>/g) ?? [];
    expect(lockKeys).toEqual(['<LockKey synthetic={synthetic} holds={holds} className="mt-4 sm:hidden" />']);
    const fold = source.slice(source.indexOf("<LockKey"), source.indexOf("</MoreDetails>", source.indexOf("<LockKey")));
    expect(fold).toContain('className="mt-3 mb-3 sm:hidden"');
    expect(fold).toContain("legendSymbolCount({ planShown, lockApart: true })");
    expect(fold).toContain("<TimetableLegend synthetic={synthetic} holds={holds} lockApart");
  });

  it("says whose locks they are on a clash between two locked sets, in its row and in its details", () => {
    expect(bothLockedLabel(false)).toBe("Both sets locked by this app");
    expect(bothLockedLabel(true)).toBe("Both sets locked");
    expect(bothLockedNote(false)).toBe("This app locks both sets, so it suggests no move for this clash. It still counts in the day’s cost.");
    expect(bothLockedNote(true)).toBe("Both sets are locked, so this clash cannot be moved. It still counts in the day’s cost.");
    // The tiny day with both its clash's sets locked: the row's mark.
    expect(list(day(false, true), 0)).toContain("Both sets locked by this app");
    const invented = list(day(true, true), 0);
    expect(invented).toContain("Both sets locked");
    expect(invented).not.toContain("by this app");
    // The details under the opening sentence.
    for (const synthetic of [false, true]) {
      const preset = day(synthetic, true);
      const details = text(renderToStaticMarkup(createElement(ClashDetails, { preset, shown: preset.report.clashes[0] }))).replace(
        /&#x27;|&rsquo;/g,
        "’",
      );
      expect(details).toContain(bothLockedNote(synthetic));
      expect(details.includes("cannot be moved")).toBe(synthetic);
    }
    // The drawer's chip reads the same words as the row.
    const drawer = readFileSync(join(__dirname, "clash-drawer.tsx"), "utf8");
    expect(drawer).toContain("{bothLockedLabel(preset.synthetic === true)}");
    expect(drawer).not.toMatch(/>\s*Both sets locked\s*</);
  });

  it("gives the invented day its own lock words, never the published days' rule", () => {
    for (const lastLocked of [false, true]) {
      const plain = legend(day(true, lastLocked));
      expect(plain).toContain("Locked: an invented fixed slot.");
      expect(plain).not.toContain("the last set on its stage");
      expect(plain).not.toContain("by this app");
    }
    expect(LOCK_INVENTED).toBe("Locked: an invented fixed slot.");
  });

  it("says whose the locks are in the costliest clashes' locked share, and that no move is suggested there", () => {
    expect(lockedShareLine("8%", false)).toBe("8% of the day’s cost sits between two sets this app locks, so it suggests no move there.");
    expect(lockedShareLine("8%", true)).toBe("8% of the day’s cost sits between two locked sets of the invented day.");
    for (const lastLocked of [false, true]) {
      const published = list(day(false, lastLocked), 0.08);
      expect(published).toContain("8% of the day’s cost sits between two sets this app locks, so it suggests no move there.");
      expect(published).not.toContain("which cannot move");
      const invented = list(day(true, lastLocked), 0.08);
      expect(invented).toContain("8% of the day’s cost sits between two locked sets of the invented day.");
      expect(invented).not.toContain("this app locks");
    }
    // No locked share, no sentence.
    expect(list(day(false, true), 0)).not.toContain("of the day’s cost sits between");
  });

  it("says in Try a move that the sets it keeps in place are this app's locks on a published day", () => {
    expect(lockedSetsLine(false)).toBe("Sets this app locks stay put.");
    expect(lockedSetsLine(true)).toBe("Locked sets stay put.");
    for (const synthetic of [false, true]) {
      const preset = day(synthetic, true);
      const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
      const plain = text(renderToStaticMarkup(createElement(TryAMove, { preset, day: 0, ranked, isLocked: () => false })));
      expect(plain).toContain(
        `Pick a set to see every legal place on the 5-minute grid, scored. Keep a move to stack the next one. ${lockedSetsLine(synthetic)}`,
      );
      expect(plain.includes("Sets this app locks stay put.")).toBe(!synthetic);
    }
  });

  it("never says the locks are not the festival's, in any of the three places", () => {
    const words = [
      LOCK_SHORT,
      LOCK_GENERIC,
      LOCK_INVENTED,
      lockedShareLine("8%", false),
      lockedShareLine("8%", true),
      lockedSetsLine(false),
      lockedSetsLine(true),
      bothLockedLabel(false),
      bothLockedLabel(true),
      bothLockedNote(false),
      bothLockedNote(true),
    ];
    for (const line of words) expect(line).not.toMatch(/not by the festival/i);
  });

  it("works out once, in the page, whether the shown day's locks are the last sets, and hands it to every copy of the key", () => {
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    expect(source).toContain('import { lockRuleHolds } from "@/lib/locks";');
    expect(source.match(/lockRuleHolds\(/g)).toHaveLength(1);
    expect(source).toMatch(/\.filter\(\(slot\) => slot\.day === day\)/);
    // `[^>]` crosses line ends, so each match runs from the tag's name to its first ">".
    const legends = source.match(/<TimetableLegend\b[^>]*>/g) ?? [];
    expect(legends).toHaveLength(4);
    for (const tag of legends) expect(tag).toContain("holds={holds}");
  });
});
