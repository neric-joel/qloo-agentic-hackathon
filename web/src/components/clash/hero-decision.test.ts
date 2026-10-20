import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { qlooCredits } from "@/lib/credit";
import { buildDayGraph, keyLine, sideEffectText, type DayGraphModel } from "@/lib/day-graph";
import { buildDecisionCopy, NO_MOVE, parseDecision, type Decision } from "@/lib/decision";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset, type PresetSummary } from "@/lib/preset";
import { summarize } from "@/lib/server-summary";
import { checkAdd, encodeMoves, type PlanAnswer, type StackMove, type StackStep } from "@/lib/stack";

import {
  ADD_TO_PLAN,
  DRAWN_AS_PUBLISHED,
  DRAWN_WITHOUT_MOVE,
  focusShown,
  KEEP_MOVE,
  KeepMoveOffer,
  keepPressKind,
  KEPT_AGREE,
  KEPT_IN_PLAN,
  KeptNotice,
  planAtPress,
  REPLACE_PLAN,
  SEE_YOUR_PLAN,
  seeYourPlan,
} from "./decision-card";
import { HeroDecision, HeroDecisionSkeleton, KEPT_LABEL, tasteLineText } from "./hero-decision";

// Every name and figure below is invented for the test.

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** What a reader sees: invisible (visibility: hidden) and screen-reader-only spans taken out. */
function seen(html: string): string {
  let out = html.replace(/<span class="sr-only">[^<]*<\/span>/g, "");
  // The inactive label of the Keep button's cell is `invisible`; drop its whole span.
  out = out.replace(/<span(?: aria-hidden="true")? class="[^"]*\binvisible\b[^"]*">(?:<svg[\s\S]*?<\/svg>)?[^<]*<\/span>/g, "");
  return text(out);
}

/** The tiny preset, on the invented day when asked. */
function tinyPreset({ synthetic = false } = {}) {
  const raw = rawTinyPreset() as ReturnType<typeof rawTinyPreset> & { synthetic?: boolean };
  return parsePreset(synthetic ? { ...raw, synthetic: true } : raw);
}

/** The decision for the tiny preset: Bo Diddly Squat 60 minutes later, which ends its overlap with Ann Arbor. */
function decisionFor(overrides: Record<string, unknown> = {}): Decision {
  const decision = parseDecision({
    kind: "decision",
    day: 0,
    skipped_locked: 0,
    skipped_no_place: 0,
    clash: { a_id: "ann", b_id: "bo", rank: 1, minutes: 60 },
    published_budget: 104.2,
    move: {
      act_id: "bo",
      act: "Bo Diddly Squat",
      from: "Side 20:30-22:00",
      stage_id: "side",
      stage: "Side",
      day: 0,
      start: "21:30",
      end: "23:00",
      minutes_moved: 60,
      legal_places: 4,
      stage_changed: false,
      budget_after: 98.4,
      minutes_shared_after: 0,
      same_index_alternative: null,
    },
    rule: null,
    ...overrides,
  });
  if (!decision) throw new Error("no decision");
  return decision;
}

function day({ synthetic = false, decision = decisionFor() as Decision | null } = {}) {
  const preset = tinyPreset({ synthetic });
  const model = buildDayGraph(preset, decision, 0) as DayGraphModel;
  if (!model) throw new Error("no model");
  return { preset, model, copy: buildDecisionCopy(preset, decision) };
}

function hero(props: Record<string, unknown> = {}, options: Parameters<typeof day>[0] = {}) {
  const { model, copy } = day(options);
  return renderToStaticMarkup(
    createElement(HeroDecision, { model, copy, view: "moved", onOpenMove: () => null, ...props }),
  );
}

describe("the hero's answer", () => {
  it("reads in one order: the move lead, the readout, the side effect, the taste line, the attribution, Keep, the confirmation's room, the paste", () => {
    vi.stubEnv("NEXT_PUBLIC_CHECK_LIVE", "1");
    const html = hero();
    const at = (needle: string) => html.indexOf(needle);
    const order = [
      'id="decision-heading"',
      "data-readout",
      "data-side-effects",
      "data-taste-line",
      "data-attribution",
      `>${KEEP_MOVE}<`,
      "data-kept-notice",
    ].map(at);
    order.forEach((value, i) => {
      expect(value, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(value).toBeGreaterThan(order[i - 1]);
    });
    vi.unstubAllEnvs();
  });

  it("leads with the move as a heading the plan card can scroll back to, read only below 1024 px", () => {
    const html = hero();
    const heading = /<h2 id="decision-heading" tabindex="-1" class="([^"]*)">([^<]*)<\/h2>/.exec(html);
    expect(heading?.[2]).toBe("Bo Diddly Squat 60 minutes later");
    // 20 px, weight 620; screen-reader only below 1024 px, where the drawing's toggle names the move.
    expect(heading?.[1].split(" ")).toEqual(expect.arrayContaining(["text-[1.25rem]", "font-[620]", "max-lg:sr-only", "outline-none"]));
  });

  it("states the result with its partner: the figures in the answer type, the minutes left in raspberry, the arrow read as 'to'", () => {
    const html = hero();
    const readout = /<p data-readout=""[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
    expect(text(readout)).toBe("60 → to 0 min shared with Ann Arbor");
    expect(seen(readout)).toBe("60 → 0 min shared with Ann Arbor");
    // 34 px on a phone, 48 px from 1024 px; the words 15 px and 20 px, on their own line.
    expect(readout).toMatch(/class="type-numeral block text-\[2\.125rem\][^"]*lg:text-5xl/);
    expect(readout).toMatch(/<span class="block text-\[0\.9375rem\][^"]*lg:text-xl[^"]*">min shared with Ann Arbor<\/span>/);
    expect(readout).toContain('<span class="text-primary">0</span>');
    expect(readout).toContain('<span aria-hidden="true"> → </span><span class="sr-only"> to </span>');
    // Only the minutes left are raspberry: the figure before and the arrow are ink.
    expect(readout.match(/text-primary/g)).toHaveLength(1);
  });

  it("says what else the move changes, every clause naming the overlap, from the published times", () => {
    const { model } = day();
    const html = hero();
    const line = /<p data-side-effects="" class="([^"]*)">([^<]*)<\/p>/.exec(html);
    expect(line?.[2]).toBe(sideEffectText(model.move!));
    expect(line?.[2]).toBe("No other overlap gets longer.");
    // 14 px on a phone, 15 px from 1024 px, in ink.
    expect(line?.[1].split(" ")).toEqual(expect.arrayContaining(["text-sm", "lg:text-[0.9375rem]"]));
    expect(line?.[1]).not.toMatch(/muted|primary/);
  });

  it("gives the taste rank its qualifier beside the number, in one element with the Derived stamp", () => {
    const html = hero();
    const line = /<p data-taste-line=""[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(line.startsWith("Taste overlap: 70 of 100 on this bill (a rank, not attendance) <span")).toBe(true);
    // The rank is this app's, calculated from Qloo data: Derived, never a Qloo stamp; the words are ink.
    expect(line).toMatch(/<span[^>]*data-provenance="derived"[^>]*>/);
    expect(line).not.toMatch(/data-provenance="qloo"|text-prov-qloo/);
    expect(line).toContain("Calculated by this app from Qloo data.");
    expect(tasteLineText(99, false)).toBe("Taste overlap: 99 of 100 on this bill (a rank, not attendance)");
    expect(tasteLineText(88, true)).toBe("Taste overlap: 88 of 100 on this invented bill (an invented rank, not attendance)");
  });

  it("says who selected and scored it, and what kind of claim it is, in muted 13 / 14 px", () => {
    const html = hero();
    const line = /<p data-attribution="" class="([^"]*)">([^<]*)<\/p>/.exec(html);
    expect(line?.[2]).toBe("Selected and scored by this app’s index. A reading, not a verdict.");
    expect(line?.[1].split(" ")).toEqual(expect.arrayContaining(["text-[0.8125rem]", "text-muted-foreground", "lg:text-sm"]));
  });

  it("names the one filled action Keep this move: 48 px, the ink fill, the 10 px control corner, and one copy at every width", () => {
    const html = hero();
    expect(KEEP_MOVE).toBe("Keep this move");
    const buttons = [...html.matchAll(/<button[^>]*data-variant="default"[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(1);
    const [keep] = buttons;
    expect(keep).toMatch(/data-size="lg"/);
    expect(keep).toMatch(/\bh-12\b/);
    expect(keep).toMatch(/\bbg-cta\b/);
    expect(keep).toMatch(/\brounded-md\b/);
    expect(keep).not.toMatch(/rounded-full|bg-primary|\bid="|max-lg:hidden|lg:hidden/);
    // The press answers with a 0.97 scale in 120 ms on the house ease-out, only when motion is welcome.
    expect(keep).toContain("motion-safe:active:scale-97");
    expect(keep).toContain("motion-safe:duration-(--dur-feedback)");
    expect(keep).toContain("motion-safe:ease-(--ease-out)");
    expect(seen(keep)).toBe("Keep this move");
    expect(text(html)).not.toContain("Open this move");
  });

  it("keeps the button's width once kept: both labels share one cell, the kept one with a tick", () => {
    const fresh = hero({ kept: { move: false, change: false } });
    const kept = hero({ kept: { move: true, change: false } });
    const cell = (html: string) => /<button[^>]*data-variant="default"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? "";
    for (const html of [fresh, kept]) {
      expect(cell(html)).toMatch(/^<span class="grid"><span class="col-start-1 row-start-1[^"]*">Keep this move<\/span><span[^>]*class="col-start-1 row-start-1 [^"]*"><svg[^>]*lucide-check[^>]*>[\s\S]*?<\/svg>Kept in your plan<\/span><\/span>$/);
    }
    expect(KEPT_LABEL).toBe("Kept in your plan");
    expect(seen(cell(fresh))).toBe("Keep this move");
    expect(seen(cell(kept))).toBe("Kept in your plan");
    // The inactive label is hidden from screen readers too.
    expect(cell(fresh)).toMatch(/<span aria-hidden="true" class="[^"]*invisible[^"]*">/);
  });

  it("holds the confirmation's room under Keep at every width, and fills it in place once the plan holds the move", () => {
    const empty = hero({ kept: { move: false, change: false } });
    const notice = /<div role="status" aria-live="polite" data-kept-notice="" class="([^"]*)"><\/div>/.exec(empty);
    expect(notice).not.toBeNull();
    // Three 18 px lines on a phone (54 px), two 20 px lines from 1024 px (40 px), so nothing moves when it fills.
    expect(notice?.[1].split(" ")).toEqual(expect.arrayContaining(["min-h-[3.375rem]", "lg:min-h-10", "text-[0.8125rem]", "leading-[1.125rem]", "lg:text-sm", "lg:leading-5"]));
    expect(empty).not.toContain(KEPT_IN_PLAN);
    const kept = hero({ kept: { move: true, change: false } });
    const filled = /<div role="status" aria-live="polite" data-kept-notice=""[^>]*>([\s\S]*?)<\/div>/.exec(kept)?.[1] ?? "";
    expect(text(filled)).toBe("Kept in your plan. Nothing moves until the acts’ teams agree. See your plan");
    // Ink, never green or raspberry; no box, no pill, no id.
    expect(filled).toContain("text-foreground");
    expect(filled).not.toMatch(/text-(primary|success|green)|\bbg-|rounded-full|[\s"]border(-[trblxy])?[\s"]|\bid="/);
    // "See your plan" reads as text and takes its 44 px target from a hit area that adds no height.
    expect(filled).toMatch(/<a href="#your-plan" class="relative rounded-sm [^"]*after:absolute after:-inset-x-1 after:-inset-y-4 after:content-\[&#x27;&#x27;\][^"]*">See your plan<\/a>/);
    expect(filled).not.toContain("min-h-11");
    // One confirmation: a single live region, after Keep.
    expect(kept.match(/data-kept-notice=""/g)).toHaveLength(1);
    expect(kept.indexOf("data-kept-notice")).toBeGreaterThan(kept.indexOf(">Keep this move<"));
  });

  it("says the drawing does not show a kept move while it is drawn as published (and 'without the move' on the invented day)", () => {
    expect([DRAWN_AS_PUBLISHED, DRAWN_WITHOUT_MOVE]).toEqual(["Drawn here as published.", "Drawn here without the move."]);
    const notice = (html: string) => text(/<div role="status" aria-live="polite" data-kept-notice=""[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "");
    expect(notice(hero({ kept: { move: true, change: false }, view: "published" }))).toBe(
      "Kept in your plan. Drawn here as published. Nothing moves until the acts’ teams agree. See your plan",
    );
    const invented = hero({ kept: { move: true, change: false }, view: "published" }, { synthetic: true });
    expect(notice(invented)).toBe("Kept in your plan. Drawn here without the move. Nothing moves until the acts’ teams agree. See your plan");
    expect(text(invented)).not.toMatch(/published/i);
    // The moved view says nothing of the kind.
    expect(notice(hero({ kept: { move: true, change: false } }))).not.toContain("Drawn here");
  });

  it("keeps the side-effect line in every state with a move", () => {
    const { model } = day();
    const line = sideEffectText(model.move!);
    const other: StackMove = { actId: "cy", stageId: "main", day: 0, start: "16:00" };
    const states = {
      moved: hero(),
      published: hero({ view: "published" }),
      kept: hero({ kept: { move: true, change: false } }),
      "kept as published": hero({ kept: { move: true, change: false }, view: "published" }),
      "existing plan": hero({ plan: [other], kept: { move: false, change: false } }),
      "server fallback": hero({ onOpenMove: undefined, pending: true }),
      invented: hero({}, { synthetic: true }),
    };
    for (const [name, html] of Object.entries(states)) {
      expect(html.match(/data-side-effects=""/g), name).toHaveLength(1);
      expect(html, name).toContain(`>${line}</p>`);
    }
    // The readout and the taste line describe the proposal: the published view prints them unchanged.
    expect(text(states.published).replace(/See your plan/g, "")).toBe(text(states.moved));
  });

  it("draws Keep in place before the interactive view mounts, not yet pressable and not dimmed", () => {
    const html = hero({ onOpenMove: undefined, pending: true });
    const keep = /<button[^>]*data-variant="default"[^>]*>/.exec(html)?.[0] ?? "";
    expect(keep).toContain('disabled=""');
    expect(keep).toContain("disabled:opacity-100");
    expect(keep).toMatch(/\bh-12\b/);
    expect(html).toContain("data-kept-notice");
    // The same boxes as the live hero: only the button's pressability differs.
    const live = hero();
    const strip = (markup: string) =>
      markup
        .replace(/ disabled=""/g, "")
        .replace(/ disabled:(opacity-50|opacity-100|cursor-default)/g, "");
    expect(strip(html)).toBe(strip(live));
  });

  it("names the pair and says no legal place lowers the index when there is no move, with no Keep", () => {
    const decision = decisionFor({ move: null });
    const html = hero({}, { decision });
    const heading = /<h2 id="decision-heading"[^>]*>([^<]*)<\/h2>/.exec(html)?.[1];
    expect(heading).toBe("Ann Arbor × Bo Diddly Squat: 60 min shared");
    expect(text(html)).toContain(NO_MOVE);
    expect(html).toContain("data-taste-line");
    expect(text(html)).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
    expect(html).not.toContain("data-readout");
    expect(html).not.toContain("data-side-effects");
    expect(text(html)).not.toContain(KEEP_MOVE);
    expect(html).not.toContain("data-kept-notice");
  });

  it("drops the no-move line and the taste line too when the day has no decision", () => {
    const html = hero({}, { decision: null });
    const heading = /<h2 id="decision-heading"[^>]*>([^<]*)<\/h2>/.exec(html)?.[1];
    // The day's costliest clash names the heading.
    expect(heading).toBe("Ann Arbor × Bo Diddly Squat: 60 min shared");
    expect(text(html)).not.toContain(NO_MOVE);
    expect(html).not.toContain("data-taste-line");
    expect(text(html)).not.toContain(KEEP_MOVE);
    expect(text(html)).toContain("A reading, not a verdict.");
  });

  it("on the invented day says the bill and the rank are invented, and credits Qloo nowhere", () => {
    const html = hero({}, { synthetic: true });
    const line = /<p data-taste-line=""[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(line.startsWith("Taste overlap: 70 of 100 on this invented bill (an invented rank, not attendance) <span")).toBe(true);
    expect(line).toContain("Calculated by this app from invented figures.");
    for (const state of [html, hero({ view: "published" }, { synthetic: true }), hero({ kept: { move: true, change: false } }, { synthetic: true })]) {
      const all = `${text(state)}. ${[...state.matchAll(/(?:title|aria-label)="([^"]*)"/g)].map((m) => m[1]).join(". ")}`;
      expect(qlooCredits(all)).toEqual([]);
      expect(all).not.toContain("(a rank, not attendance)");
    }
  });

  it("holds the hero-text qualifiers in its source, on both kinds of day", () => {
    const source = readFileSync(join(__dirname, "hero-decision.tsx"), "utf8");
    expect(source).toContain("(a rank, not attendance)");
    expect(source).toContain("an invented rank, not attendance");
  });

  it("holds the group's footprint while the decision loads, with nothing to read or focus", () => {
    const html = renderToStaticMarkup(createElement(HeroDecisionSkeleton));
    expect(html).toMatch(/^<div aria-hidden="true" data-hero-skeleton=""/);
    expect(text(html)).toBe("");
    expect(html).not.toMatch(/<(a|button|input)\b|tabindex/);
    // The button's place at its 48 px and 10 px corner; the marks at the 6 px mark corner.
    expect(html).toMatch(/h-12 w-40 rounded-md bg-muted/);
    expect(html).not.toMatch(/rounded-(sm|full|none|\[)/);
  });
});

describe("Keep this move, confirmed in place", () => {
  it("names the confirmation's words and its link", () => {
    expect(KEPT_IN_PLAN).toBe("Kept in your plan.");
    expect(KEPT_AGREE).toBe("Nothing moves until the acts’ teams agree.");
    expect(SEE_YOUR_PLAN).toBe("See your plan");
  });

  it("leaves the live region empty while the plan does not hold the move, and shows none without the button", () => {
    const linkRef = { current: null };
    expect(renderToStaticMarkup(createElement(KeptNotice, { shown: false, linkRef }))).toBe(
      '<div role="status" aria-live="polite" data-kept-notice=""></div>',
    );
    // The server HTML with no decision to keep draws no confirmation at all.
    expect(hero({ onOpenMove: undefined })).not.toContain("data-kept-notice");
  });

  it("See your plan scrolls the plan heading into view, smoothly or at once under reduced motion, then focuses it without a second scroll", () => {
    for (const reduce of [false, true]) {
      const scrollIntoView = vi.fn();
      const focus = vi.fn();
      const target = { scrollIntoView, focus } as unknown as HTMLElement;
      const getElementById = vi.fn(() => target);
      const preventDefault = vi.fn();
      expect(seeYourPlan({ preventDefault }, { getElementById }, reduce)).toBe(true);
      expect(getElementById).toHaveBeenCalledWith("your-plan");
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: reduce ? "auto" : "smooth", block: "start" });
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    }
    // No plan heading on the page: the link is left to the browser.
    const preventDefault = vi.fn();
    expect(seeYourPlan({ preventDefault }, { getElementById: () => null }, false)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("focuses the first displayed of several links, without scrolling", () => {
    const hidden = { getClientRects: () => [], focus: vi.fn() } as unknown as HTMLElement;
    const shown = { getClientRects: () => [{}], focus: vi.fn() } as unknown as HTMLElement;
    expect(focusShown([hidden, shown])).toBe(shown);
    expect(shown.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(focusShown([null, hidden])).toBeNull();
  });

  it("after a press, focus moves to the link without preventScroll, and a confirmation not wholly in view scrolls into view first", () => {
    const source = readFileSync(join(__dirname, "hero-decision.tsx"), "utf8");
    const effect = source.slice(source.indexOf("const link = linkRef.current;"), source.indexOf("}, [focusAsk, keptShown]);"));
    expect(effect).toContain('notice.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });');
    // Focus follows the scroll (at once under reduced motion, when the smooth scroll lands otherwise), so the
    // browser has nothing left to scroll; it is never asked to skip scrolling.
    expect(effect.match(/link\.focus\(\);/g)?.length).toBe(3);
    expect(effect).toContain('window.addEventListener("scrollend", land, { once: true });');
    expect(effect).not.toContain("preventScroll");
  });
});

describe("Keep this move on a plan that already holds steps (P1)", () => {
  // The decision's own move (Bo Diddly Squat to Side 21:30) and another kept move (invented).
  const move = day().copy?.seedMove as StackMove;
  const other: StackMove = { actId: "cy", stageId: "main", day: 0, start: "16:00" };
  const change: StackStep = { rule: { aId: "ann", bId: "bo" }, moves: [{ actId: "ann", stageId: "main", day: 0, start: "19:00" }] };
  const ready: PlanAnswer = { status: "ready", plan: { publishedBudget: 104.2, budget: 97.1, steps: [], clashes: [], options: null } };

  it("keeps the move at once on an empty plan, and asks Add or Replace only when the plan holds other steps", () => {
    // Empty, or a page that does not pass the plan: one press keeps the move, exactly as before.
    expect(keepPressKind(undefined, move, false)).toBe("keep");
    expect(keepPressKind([], move, false)).toBe("keep");
    expect(keepPressKind([other], null, false)).toBe("keep");
    // Other steps held: never a silent replace.
    expect(keepPressKind([other], move, false)).toBe("offer");
    expect(keepPressKind([change], move, false)).toBe("offer");
    // The plan holds this move already (alone or with others): it says so and changes nothing.
    expect(keepPressKind([move], move, false)).toBe("already");
    expect(keepPressKind([other, { ...move }], move, false)).toBe("already");
    expect(keepPressKind([other], move, true)).toBe("already");
  });

  it("reads the plan a press is about from the page, or from the tab's stored plan before the page has scored it", () => {
    const stored = vi.fn(() => [other] as readonly StackStep[]);
    // The page's scored plan wins; the store is not even read.
    expect(planAtPress([change], stored)).toEqual([change]);
    expect(stored).not.toHaveBeenCalled();
    // An empty plan from the page (its first answer not in yet after a reload): the tab's stored plan, so the
    // press offers Add or Replace instead of replacing a plan it cannot see yet.
    expect(planAtPress([], stored)).toEqual([other]);
    expect(keepPressKind(planAtPress([], stored), move, false)).toBe("offer");
    expect(keepPressKind(planAtPress([], () => [move]), move, false)).toBe("already");
    expect(keepPressKind(planAtPress([], () => []), move, false)).toBe("keep");
    // No plan from the page at all (the server HTML): nothing to read (the two reads above are the only ones).
    expect(planAtPress(undefined, stored)).toEqual([]);
    expect(stored).toHaveBeenCalledTimes(2);
  });

  it("draws the hero the same with an empty plan as with none, and draws no offer before a press", () => {
    expect(hero({ plan: [] })).toBe(hero({}));
    const holding = hero({ plan: [other], kept: { move: false, change: false } });
    expect(holding).not.toContain("data-keep-offer");
    expect(text(holding)).not.toContain(ADD_TO_PLAN);
    expect(text(holding)).not.toContain(REPLACE_PLAN);
    // The limits stay where they were, with no click, whatever the plan holds.
    expect(text(holding)).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
  });

  it("offers Add first (the outline button) and Replace (ghost) in the actions' own places, then what the plan holds in the confirmation's held room, with no id", () => {
    expect([ADD_TO_PLAN, REPLACE_PLAN]).toEqual(["Add to your plan", "Replace your plan"]);
    const offer = (state: Parameters<typeof KeepMoveOffer>[0]["offer"], held: readonly StackStep[] = [other]) =>
      renderToStaticMarkup(createElement(KeepMoveOffer, { offer: state, held, onAdd: () => {}, onReplace: () => {} }));
    const open = offer({ state: "open" });
    expect(text(open)).toBe("Add to your plan Replace your plan Your plan already holds 1 kept move.");
    // One named group that draws no box of its own, so its parts sit in the hero's actions grid.
    expect(open).toMatch(/^<div role="group" aria-label="Keep this move: add it to your plan, or replace your plan" data-keep-offer="" class="contents">/);
    // Add in Keep's place at Keep's 48 px; Replace beside it (48 px) from 380 px, in the paste's place below that
    // (the paste's 44 px); both buttons in one row, side by side, from 380 to 1023 px.
    expect(open).toMatch(/<div class="contents min-\[380px\]:flex min-\[380px\]:gap-3 min-\[380px\]:\[grid-area:keep\] lg:contents">/);
    expect(open).toMatch(/data-variant="outline" data-size="lg" class="[^"]*\bh-12\b[^"]*\[grid-area:keep\][^"]*"[^>]*>Add to your plan<\/button>/);
    expect(open).toMatch(/data-variant="ghost" data-size="default" class="[^"]*\bh-11\b[^"]*\[grid-area:paste\] max-\[379px\]:mt-2 min-\[380px\]:h-12"[^>]*>Replace your plan<\/button>/);
    expect(open.indexOf(ADD_TO_PLAN)).toBeLessThan(open.indexOf(REPLACE_PLAN));
    // The words take the confirmation's room at exactly its held height (54 px phone, 36 px from 640, 40 px from
    // 1024), in its type, so a longer line runs on below it instead of moving anything.
    const status = /<p data-keep-offer-status="" class="([^"]*)">/.exec(open)?.[1].split(" ") ?? [];
    expect(status).toEqual(
      expect.arrayContaining(["h-[3.375rem]", "sm:h-9", "lg:h-10", "[grid-area:notice]", "mt-1", "text-[0.8125rem]", "leading-[1.125rem]", "lg:text-sm", "lg:leading-5"]),
    );
    expect(status.some((name) => /^(min-h|max-h|overflow|line-clamp|truncate)/.test(name))).toBe(false);
    expect(open).not.toMatch(/\bid="|rounded-full|shadow|bg-(primary|success)|text-(primary|success)/);
    // A kept change counts as a step.
    expect(text(offer({ state: "open" }, [other, change]))).toContain("Your plan already holds 2 kept steps.");
    // While the whole plan is scored, Add is unavailable and the room says what is happening; the spinner sits
    // in those words (so Add keeps its width) and moves only when motion is allowed.
    const checking = offer({ state: "checking" });
    expect(checking).toMatch(/aria-disabled="true"[^>]*>Add to your plan<\/button>/);
    expect(checking).toContain("motion-safe:animate-spin");
    expect(text(checking)).toContain("Your plan already holds 1 kept move. Scoring your plan with this move added.");
    const button = /<button[^>]*>Add to your plan<\/button>/.exec(checking)?.[0] ?? "";
    expect(button).not.toContain("<svg");
    // Refused for good: the reason in words, and Replace alone, a new button in Keep's place with Add's outline
    // and Keep's 48 px. Refused for now: both ways stay, the reason in the room.
    const reason = "Not added: your plan already moves Bo Diddly Squat, and a plan moves each set once. Your plan is unchanged.";
    const refused = offer({ state: "rejected", reason, retry: false });
    expect(text(refused)).toBe(`${REPLACE_PLAN} ${reason}`);
    expect(refused).toMatch(/data-variant="outline" data-size="default" class="[^"]*\bh-12 \[grid-area:keep\]"[^>]*>Replace your plan<\/button>/);
    expect(refused).not.toContain(ADD_TO_PLAN);
    const failed = offer({ state: "rejected", reason, retry: true });
    expect(text(failed)).toBe(`${ADD_TO_PLAN} ${REPLACE_PLAN} ${reason}`);
  });

  it("draws the offer where Keep, its room and the paste are, holding their places unseen, so nothing moves", () => {
    const source = readFileSync(join(__dirname, "hero-decision.tsx"), "utf8");
    // The actions grid has no row of its own for the offer.
    expect(source).toContain("[grid-template-areas:'keep'_'notice'_'paste']");
    expect(source).toContain("lg:[grid-template-areas:'keep_paste'_'notice_notice']");
    expect(source).not.toContain("grid-area:offer");
    // Keep and the paste stay in the layout while the offer is up, unseen (not display: none).
    expect(source).toContain('offerShown && "invisible"');
    expect(source).toContain('showKeep && offerShown && "invisible"');
    expect(source).not.toMatch(/offerShown && "hidden"/);
    // Escape puts the offer away and hands focus back to Keep; Replace under the fold comes into view by the
    // least scroll, at once under reduced motion.
    expect(source).toContain("onDismiss={dismissOffer}");
    expect(source).toContain("keepRef.current?.focus({ preventScroll: true });");
    expect(source).toContain('last.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });');
    // Escape on the offer puts it away (open, or refused); other keys do nothing, and so does Escape while an Add
    // is on its way.
    const keyDown = (state: Parameters<typeof KeepMoveOffer>[0]["offer"], key: string, onDismiss: () => void) => {
      const group = KeepMoveOffer({ offer: state, held: [other], onAdd: () => {}, onReplace: () => {}, onDismiss });
      const preventDefault = vi.fn();
      (group.props as { onKeyDown: (event: { key: string; preventDefault: () => void }) => void }).onKeyDown({ key, preventDefault });
      return preventDefault;
    };
    const dismissed = vi.fn();
    expect(keyDown({ state: "open" }, "Escape", dismissed)).toHaveBeenCalledTimes(1);
    expect(dismissed).toHaveBeenCalledTimes(1);
    keyDown({ state: "rejected", reason: "Not added.", retry: false }, "Escape", dismissed);
    expect(dismissed).toHaveBeenCalledTimes(2);
    keyDown({ state: "open" }, "Enter", dismissed);
    keyDown({ state: "checking" }, "Escape", dismissed);
    keyDown({ state: "sent" }, "Escape", dismissed);
    expect(dismissed).toHaveBeenCalledTimes(2);
  });

  it("adds only once the engine scored the whole plan, and leaves the plan unchanged when it refuses", async () => {
    const kept: StackStep[] = [other];
    const check = vi.fn(async (steps: readonly StackStep[]) => (steps.length === 2 ? ready : ({ status: "error" } as PlanAnswer)));
    const act = day().copy?.moveAct ?? "";
    expect(act).toBe("Bo Diddly Squat");
    const outcome = await checkAdd(kept, { act, move }, check, "move");
    // One question, about the kept move then this one, and the choice names the plan it was scored with.
    expect(check).toHaveBeenCalledWith([other, move]);
    expect(outcome).toEqual({ kind: "ready", choice: { mode: "add", base: encodeMoves(kept) }, count: 2 });
    const invalid = await checkAdd(kept, { act, move }, async () => ({ status: "invalid" }), "move");
    expect(invalid).toEqual({
      kind: "rejected",
      reason: "Not added: with your kept moves in place, the timetable engine finds this is no longer a legal place for Bo Diddly Squat. Your plan is unchanged.",
      retry: false,
    });
    expect(kept).toEqual([other]);
  });
});

describe("the hero's layout (server fallback, the interactive hero's final frame)", () => {
  const PRESETS: PresetSummary[] = [
    { id: "tiny-fest-sat", title: "Tiny Fest, Saturday", city: "Tiny Town", sets: 3, stages: 2, scored_share: 0.67 },
    { id: "other-fest-sun", title: "Other Fest 2031, Sunday", city: null, sets: 3, stages: 2, scored_share: 0.67 },
  ];

  afterEach(() => {
    vi.doUnmock("@/lib/art");
    vi.doUnmock("@/lib/check-flag");
    vi.resetModules();
  });

  async function fallback({ synthetic = false, art = false, live = true } = {}): Promise<string> {
    vi.resetModules();
    const real = await vi.importActual<typeof import("@/lib/art")>("@/lib/art");
    vi.doMock("@/lib/art", () => ({
      ...real,
      artSlot: (name: keyof typeof real.ART) => (art ? { ...real.ART[name], enabled: true } : null),
    }));
    vi.doMock("@/lib/check-flag", () => ({ CHECK_LIVE: live }));
    const { ClashControlFallback } = await import("./clash-control");
    const { summarize: build } = await import("@/lib/server-summary");
    const summary = build(tinyPreset({ synthetic }), decisionFor(), PRESETS);
    return renderToStaticMarkup(createElement(ClashControlFallback, { intro: createElement("h1", { id: "pitch-heading" }, "Pitch"), summary }));
  }

  it("reads in one DOM order at every width: pitch, day, toggle, drawing, decision group, key", async () => {
    const html = await fallback();
    const order = ["lg:[grid-area:pitch]", "lg:[grid-area:day]", "lg:[grid-area:toggle]", "lg:[grid-area:graph]", "lg:[grid-area:group]", "lg:[grid-area:key]"].map(
      (area) => html.indexOf(area),
    );
    order.forEach((at, i) => {
      expect(at, `area ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    // From 1024 px the grid puts the group beside the pitch, the day and the toggle, and the drawing and its key
    // across both columns; the right column is 26rem, 28rem from 1280 px; the toggle sits at its row's foot.
    expect(html).toMatch(/lg:\[grid-template-areas:(&#x27;|')pitch_group\1_\1day_group\1_\1toggle_group\1_\1graph_graph\1_\1key_key\1\]/);
    expect(html).toContain("lg:grid-cols-[minmax(0,1fr)_26rem]");
    expect(html).toContain("xl:grid-cols-[minmax(0,1fr)_28rem]");
    expect(html).toContain("lg:grid-rows-[auto_auto_1fr_auto_auto]");
    expect(html).toMatch(/class="[^"]*lg:self-end lg:\[grid-area:toggle\]"/);
    // Nothing reorders it: no order class, so the tab order is the order seen.
    expect(html.slice(0, html.indexOf('aria-label="Timetable"'))).not.toMatch(/(?:^|\s)(?:[a-z-]+:)*-?order-\d/);
  });

  it("puts the festival picker in the hero, named by festival, with the day in the dateline under it", async () => {
    const html = await fallback();
    const picker = /<div role="radiogroup" aria-label="Festival day"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(picker).not.toBe("");
    expect(text(picker)).toBe("Tiny Fest Other Fest 2031");
    // Drawn before the page can act: the inputs are disabled, the chosen one checked.
    const radios = picker.match(/<input type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    for (const radio of radios) expect(radio).toContain('disabled=""');
    expect(radios[0]).toContain('checked=""');
    // One picker on the page: the board's header no longer has one.
    expect(html.match(/aria-label="Festival day"/g)).toHaveLength(1);
    const dateline = /<p data-dateline=""[^>]*>([^<]*)<\/p>/.exec(html)?.[1];
    expect(dateline).toBe("Saturday. Published timetable; saved Qloo reading built 1 Oct 2026. Neither festival uses Clash Control.");
  });

  it("draws the toggle on the moved view, its first option 'As published' (on the invented day 'Invented timetable')", async () => {
    const toggle = (html: string) => /<div role="radiogroup" aria-label="Drawing shows"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    const published = toggle(await fallback());
    expect(text(published)).toBe("As published Bo Diddly Squat 60 min later");
    expect(published).toMatch(/value="moved"[^>]*checked=""|checked=""[^>]*value="moved"/);
    // It fills the row below 1024 px.
    expect(published).toMatch(/^<div role="radiogroup" aria-label="Drawing shows"[^>]*class="[^"]*\bgrid w-full\b[^"]*lg:inline-grid lg:w-auto/);
    const invented = toggle(await fallback({ synthetic: true }));
    expect(text(invented)).toBe("Invented timetable Bo Diddly Squat 60 min later");
  });

  it("prints the drawing's key under it, saying how to read the lines and the dashes", async () => {
    const html = await fallback();
    const { model } = day();
    const key = /<p data-day-graph-key=""[^>]*>([^<]*)<\/p>/.exec(html)?.[1];
    expect(key).toBe(keyLine(model));
    expect(key).toContain("Dashed: published slot or new overlap.");
    expect(html.indexOf("data-day-graph-key")).toBeGreaterThan(html.indexOf("data-hero-group"));
  });

  it("offers the paste as the outline secondary button beside Keep, and no microcopy", async () => {
    const html = await fallback();
    const plain = text(html);
    expect(plain).toContain("Paste your own draft grid");
    expect(plain).not.toContain("About a minute.");
    expect(plain).not.toContain("Nothing leaves your browser unless you ask to compare audiences.");
    // The secondary button: outline (no fill), 44 px on a phone and 48 px beside Keep from 1024 px, the 10 px
    // control corner, with a trailing arrow, so "Keep this move" stays the one solid button.
    expect(html).toMatch(/<a(?=[^>]*data-variant="outline")(?=[^>]*data-size="default")(?=[^>]*href="\/check")(?=[^>]*lg:h-12)[^>]*>Paste your own draft grid<svg/);
    expect(html).not.toMatch(/<a(?=[^>]*data-variant="(default|ruled|soft)")(?=[^>]*href="\/check")/);
    expect(html.match(/>Paste your own draft grid</g)).toHaveLength(1);
    // After Keep and its confirmation's room in the DOM.
    expect(html.indexOf("Paste your own draft grid")).toBeGreaterThan(html.indexOf("data-kept-notice"));
    // Without /check live there is no paste.
    expect(text(await fallback({ live: false }))).not.toContain("Paste your own draft grid");
  });

  it("never draws an art slot in the hero, even once art.ts enables it, and has no stat sentence", async () => {
    for (const art of [false, true]) {
      const html = await fallback({ art });
      expect(html).not.toContain("hero-site-plan");
      expect(html).not.toContain("data-hero-stat");
    }
  });

  it("shows the invented day's proof line and 'Invented timetable', and credits Qloo nowhere in the hero", async () => {
    const html = await fallback({ synthetic: true });
    const heroHtml = html.slice(0, html.indexOf('aria-label="Timetable"'));
    const dateline = /<p data-dateline=""[^>]*>([^<]*)<\/p>/.exec(heroHtml)?.[1] ?? "";
    expect(dateline.startsWith("Invented timetable. Shown here on an invented day")).toBe(true);
    expect(dateline).toContain("no Qloo request was made");
    const all = `${text(heroHtml)}. ${[...heroHtml.matchAll(/(?:title|aria-label)="([^"]*)"/g)].map((m) => m[1]).join(". ")}`;
    expect(qlooCredits(all)).toEqual([]);
    expect(text(heroHtml)).not.toMatch(/as published|Published timetable/);
  });

  it("builds its drawing from the same model the server summary carries", () => {
    const summary = summarize(tinyPreset(), decisionFor(), PRESETS);
    expect(summary.dayGraph).toEqual(day().model);
    expect(summary.presets).toEqual(PRESETS);
  });
});
