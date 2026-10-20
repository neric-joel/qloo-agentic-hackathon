import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LABEL_META } from "@/lib/clashes";
import { buildDecisionCopy, NO_PRICED_CLASH, parseDecision, sharedTimeline } from "@/lib/decision";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";
import { parseRuleFixes, plannedNote, STAGE_FIT_GLOSS } from "@/lib/rule-fix";
import { checkAdd, encodeMoves, type PlanAnswer, type StackMove, type StackStep } from "@/lib/stack";

import {
  ADD_TO_PLAN,
  builtDate,
  datelineWithReading,
  DecisionCard,
  DecisionCardSkeleton,
  focusShown,
  hiddenClashLine,
  INDEX_SCALE,
  IndexChange,
  indexDelta,
  isHiddenDecision,
  isInventedDecision,
  KEEP_MOVE,
  KeepMoveOffer,
  keepPressKind,
  planAtPress,
  KEPT_AGREE,
  KEPT_IN_PLAN,
  MOVE_CHOICE_LINE,
  PairRecheck,
  RECHECK_PAIR,
  REPLACE_PLAN,
  savedReadingLine,
  SEE_YOUR_PLAN,
  seeYourPlan,
  STRIP_LEGEND,
  tasteOverlapOf,
  timelineSpans,
} from "./decision-card";
import { ChangeCard, KeepApart } from "./keep-apart";
import { consequenceLine, TradeoffTable } from "./tradeoff-table";

// Every name and figure below is invented for the test.

/** Whether this server answers live pair checks, as the mocked health hook reports it. */
const pairCheck = vi.hoisted(() => ({ enabled: false }));
vi.mock("./use-agent-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-agent-status")>()),
  usePairCheckEnabled: () => pairCheck.enabled,
}));

/** The text the markup itself holds: tags dropped and nothing put between them, as a reader gets it. */
function realText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The "Show the working" region (a div with `data-working`) cut out of the card's markup by counting its
 * nested divs, the card with that region taken out, and the toggle button that controls it.
 */
function working(html: string): { region: string; outside: string; toggle: string } {
  const marker = html.indexOf('data-working=""');
  if (marker < 0) return { region: "", outside: html, toggle: "" };
  const start = html.lastIndexOf("<div", marker);
  let depth = 0;
  let at = start;
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = start;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) {
      at = m.index + m[0].length;
      break;
    }
  }
  const region = html.slice(start, at);
  const id = /\bid="([^"]+)"/.exec(region)?.[1] ?? "";
  const toggle = new RegExp(`<button[^>]*aria-controls="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?</button>`).exec(html)?.[0] ?? "";
  return { region, outside: html.slice(0, start) + " " + html.slice(at), toggle };
}

const RULE = {
  kind: "rule_fixes",
  a: { act_id: "ann", act: "Ann Arbor", locked: false, place: "Main 20:00-21:30" },
  b: { act_id: "bo", act: "Bo Diddly Squat", locked: false, place: "Side 20:30-22:00" },
  rule: "Ann Arbor and Bo Diddly Squat must not overlap",
  shared_minutes: 60,
  holds: false,
  single_set_places: 0,
  fixes_found: 0,
  searched: "x",
  fixes: [],
};

/** A change that moves two sets, in the order the list gives them. */
const TWO_SET_FIX = {
  sets_moved: 2,
  minutes_moved: 120,
  stage_changes: 0,
  budget_after: 98.4,
  moves: [
    {
      act_id: "bo",
      act: "Bo Diddly Squat",
      from: "Side 20:30-22:00",
      stage_id: "side",
      stage: "Side",
      day: 0,
      start: "21:30",
      end: "23:00",
      minutes_moved: 60,
    },
    {
      act_id: "ann",
      act: "Ann Arbor",
      from: "Main 20:00-21:30",
      stage_id: "main",
      stage: "Main",
      day: 0,
      start: "19:00",
      end: "20:30",
      minutes_moved: 60,
    },
  ],
};

const RULE_RAW = { ...RULE, fixes_found: 1, fixes: [TWO_SET_FIX] };

/** The tiny preset, on the invented day when asked, and with its one clash unlabelled when asked. */
function tinyPreset({ synthetic = false, label = "hidden" as string | null } = {}) {
  const raw = rawTinyPreset() as ReturnType<typeof rawTinyPreset> & { synthetic?: boolean };
  const report = raw.report as unknown as { clashes: { label: string | null }[] };
  report.clashes = report.clashes.map((clash) => ({ ...clash, label }));
  return parsePreset(synthetic ? { ...raw, synthetic: true } : raw);
}

function copy(overrides: Record<string, unknown> = {}, preset = tinyPreset()) {
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
    rule: RULE,
    ...overrides,
  });
  const built = buildDecisionCopy(preset, decision);
  if (!built) throw new Error("no card");
  return built;
}

/**
 * The hero strip's lane labels, each as its lines from 640px (the act, then its meta, then its range); under
 * 640px the same three run as one line, each after a " · " that is hidden from 640px.
 */
function laneLabels(figure: string): string[][] {
  const sep = '<span class="text-\\[0\\.8125rem\\] font-normal text-muted-foreground sm:hidden">\u00a0· </span>';
  return [
    ...figure.matchAll(
      new RegExp(
        '<p class="min-w-0 text-sm leading-5 font-semibold[^"]*sm:flex sm:min-h-9 sm:flex-col[^"]*"><span>([^<]*)</span>' +
          `(?:${sep}<span class="text-\\[0\\.8125rem\\] font-normal text-muted-foreground max-sm:whitespace-nowrap sm:text-xs sm:leading-4">([^<]*)</span>)?` +
          `(?:${sep}<span class="font-mono text-\\[0\\.8125rem\\] font-normal text-muted-foreground tabular-nums max-sm:whitespace-nowrap sm:text-xs sm:leading-4">([^<]*)</span>)?</p>`,
        "g",
      ),
    ),
  ].map((m) => m.slice(1).filter((line): line is string => line !== undefined));
}

/**
 * The three lanes the fixture's own figures give: the staying set (Ann Arbor, RULE.a's place), the moving
 * set Now (RULE.b's place) and Tested (the move's stage and times, or `testedStage` when a test changes it).
 */
function fixtureLanes(testedStage?: string): string[][] {
  const place = (value: string) => {
    const [stage, times] = value.split(" ");
    return { stage, range: times.replace("-", "–") };
  };
  const a = place(RULE.a.place);
  const b = place(RULE.b.place);
  const move = { stage: "Side", start: "21:30", end: "23:00" };
  return [
    [RULE.a.act, a.stage, a.range],
    [RULE.b.act, `Now · ${b.stage}`, b.range],
    [RULE.b.act, `Tested · ${testedStage ?? move.stage}`, `${move.start}–${move.end}`],
  ];
}

describe("DecisionCard", () => {
  it("leads with the festival and day as a dateline, then the action as the heading, why this clash, the index with its one paragraph, the timeline, and only then rows 1 to 3 with the rule check beside row 3", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    const plain = text(html);
    const order = [
      "Tiny Fest, Saturday · published timetable",
      "Bo Diddly Squat 60 minutes later:",
      "A hidden clash",
      "Clash Budget Index",
      "104.2 → 98.4",
      "Selected and scored by this app’s index. A reading, not a verdict.",
      "No other overlap gets longer.",
      "How this was chosen",
      "The costliest clash with a set that has a legal place that lowers the index",
      "Move one set: of the 4 legal places on the 5-minute grid",
      "If a rule says Ann Arbor and Bo Diddly Squat must never overlap:",
      "Checked against the timetable’s rules; its index is shown for information.",
    ].map((part) => plain.indexOf(part));
    order.forEach((at, i) => {
      expect(at, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    expect(html).toContain('id="decision-heading"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-hidden="true"');
    // The heading is the action and its result; the festival and day are not in it.
    const heading = /<h2[^>]*id="decision-heading"[^>]*>([\s\S]*?)<\/h2>/.exec(html)?.[1] ?? "";
    expect(text(heading)).toMatch(/^Bo Diddly Squat 60 minutes later: 60 → to 0 minutes shared$/);
    // No kicker: the dateline is a 13 px semibold sentence-case line with one middot, like the index label
    // and the disclosure's subhead.
    expect(html).not.toContain("type-kicker");
    expect(html).toMatch(/<p class="text-\[0\.8125rem\] leading-5 font-semibold text-muted-foreground[^"]*">Tiny Fest, Saturday · published timetable<\/p>/);
    expect(html).toMatch(/<p class="text-\[0\.8125rem\] leading-5 font-semibold text-muted-foreground">Clash Budget Index<\/p>/);
    expect(html).toMatch(/<h3 class="text-\[0\.8125rem\] leading-5 font-semibold[^"]*">How this was chosen<\/h3>/);
  });

  it("draws the final frame in the server HTML: no hero receipt class until the card plays in the browser", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), onOpenMove: () => null }));
    expect(html).not.toMatch(/cc-hero-(slot|band|mark)|cc-overlap-band/);
  });

  it("puts the line about taste (a pointer to the three readings) under the heading, above the index, outside the working, only when passed", () => {
    const readings = createElement("p", null, "Three readings here");
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), onOpenMove: () => {}, readings }));
    const plain = text(html);
    expect(plain).toContain("Three readings here");
    // After the heading; before the index, both copies of "Keep this move" and the drawing.
    expect(plain.indexOf("Three readings here")).toBeGreaterThan(plain.indexOf("minutes shared"));
    expect(plain.indexOf("Three readings here")).toBeLessThan(plain.indexOf("Clash Budget Index"));
    expect(plain.indexOf("Three readings here")).toBeLessThan(plain.indexOf("Keep this move"));
    expect(plain.indexOf("Three readings here")).toBeLessThan(plain.indexOf("Hatched: time shared."));
    expect(text(working(html).outside)).toContain("Three readings here");
    // The fixture's pair carries the Hidden label, so the hidden-clash sentence comes first, then the readings.
    expect(html).toMatch(
      /<div data-why-lines="" class="mt-3 space-y-1"><p data-hidden-line=""[^>]*>[^<]*<\/p><p>Three readings here<\/p><\/div><div data-index-block=""/,
    );
    expect(text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy() })))).not.toContain("Three readings here");
  });

  it("keeps rows 1 to 3 and the rule check in a closed disclosure, and the attribution and its limit in one caption outside it", () => {
    const card = copy();
    const limits = card.limitsLine ?? "never";
    expect(card.limitsLine).toBe("Checked against the timetable’s rules; its index is shown for information.");
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: card }));
    // "Show the working" is the card's one disclosure: a button with aria-expanded and aria-controls over a
    // region that starts closed and carries `hidden`, so nothing in it is in the tab order. The toggle's
    // label is the title alone; inside is a small "How this was chosen" subhead over rows 1 to 3.
    expect(html).not.toContain("<details");
    const { region, outside, toggle } = working(html);
    expect(region).not.toBe("");
    expect(toggle).toMatch(/^<button type="button" id="[^"]+" aria-expanded="false" aria-controls="[^"]+"/);
    expect(realText(toggle)).toBe("Show the working");
    // A 16 px chevron leads the label; it turns down on open (under motion-safe only).
    expect(toggle).toMatch(/<svg[^>]*class="[^"]*lucide-chevron-right[^"]*size-4[^"]*motion-safe:transition-transform/);
    // A 12 px corner and 8 px sides pulled back by 8 px, so the focus ring is a rounded box inside the card.
    expect(/^<button[^>]*class="([^"]*)"/.exec(toggle)?.[1].split(" ")).toEqual(
      expect.arrayContaining(["cc-disclosure-summary", "-mx-2", "min-h-11", "rounded-md", "px-2"]),
    );
    expect(region).toMatch(/^<div id="[^"]+" role="region" aria-labelledby="[^"]+" data-working="" hidden=""/);
    expect(/aria-labelledby="([^"]+)"/.exec(region)?.[1]).toBe(/<button[^>]*\bid="([^"]+)"/.exec(toggle)?.[1]);
    expect(html.match(/data-working=""/g)).toHaveLength(1);
    const how = region;
    expect(how).toMatch(/<h3[^>]*>How this was chosen<\/h3>/);
    // Inside it the rows keep their numbers for screen readers; the rule check sits beside row 3, after it.
    for (const n of [1, 2, 3]) expect(text(how)).toContain(`Line ${n}`);
    expect(text(how)).toContain(card.clashLine);
    expect(text(how)).toContain(card.moveLine);
    expect(text(how)).toContain(card.ruleLine ?? "never");
    expect(text(how)).toContain(limits);
    expect(text(how).indexOf(limits)).toBeGreaterThan(text(how).indexOf(card.ruleLine ?? "never"));
    const row3 = /<div class="grid grid-cols-\[1rem_minmax\(0,1fr\)\][^"]*"><span[^>]*><span class="sr-only">Line <\/span>3<\/span>[\s\S]*?<\/div><\/div>/.exec(how)?.[0] ?? "";
    expect(text(row3)).toContain(limits);
    // With every disclosure taken out, the attribution and its limit are still there, as one caption under
    // the index figure: no click hides them, and the rule check is not repeated outside.
    const open = text(outside);
    expect(open).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
    expect(open).not.toContain(limits);
    expect(open.match(/not a verdict/g)).toHaveLength(1);
    const caption =
      /<p data-index-scale="" class="([^"]*)">A score, not money: [^<]*Selected and scored by this app’s index\. A reading, not a verdict\.<\/p>/.exec(html)?.[1] ?? "";
    // 13 px under the index line, so it reads directly under the figure on a phone too.
    expect(caption.split(" ")).toEqual(expect.arrayContaining(["text-[0.8125rem]", "leading-snug", "text-muted-foreground"]));
    expect(html.indexOf("Selected and scored")).toBeLessThan(html.indexOf("<figure"));
    // No visible text points at a row the reader cannot see.
    const plain = text(html);
    expect(plain).not.toMatch(/Lines 1 and 2|Line 4/);
    // The rows' "Line n" labels are for screen readers only; the visible text names no line at all.
    const visible = realText(html.replace(/<span class="sr-only">[^<]*<\/span>/g, ""));
    expect(visible).not.toMatch(/Line \d|Lines \d/);
    // The drawing's lanes say "Now" and "Tested" in their muted meta (12 px from 640 px, 13 px under it), in
    // sentence case, with no row numeral and no mono margin label. Every lane is the same three items: the
    // act, its role and stage, then its range in mono (three lines from 640 px, one line joined by " · "
    // under it); the Now lane's range still names where the set ends now.
    const figure = /<figure[\s\S]*?<\/figure>/.exec(html)?.[0] ?? "";
    expect(laneLabels(figure)).toEqual(fixtureLanes());
    expect(laneLabels(figure).map((lines) => lines.length)).toEqual([3, 3, 3]);
    expect(figure).not.toMatch(/font-mono[^"]*">(1|2)</);
    expect(figure).not.toMatch(/font-mono[^"]*">(now|tested)</);
    // Under the strip, one line says what else the move changes, 8 px under it with no rule above it; how to
    // read the marks is the end of the strip's accessible name, not a printed legend.
    expect(html).toMatch(/<figcaption data-side-effects="" class="mt-2 text-\[0\.8125rem\] leading-snug text-muted-foreground">No other overlap gets longer\.<\/figcaption>/);
    expect(figure).toMatch(/<p class="sr-only">[^<]*Solid: where the sets play now\. Dashed: tested\. Hatched: time shared\.<\/p>/);
    expect(figure).not.toMatch(/border-t/);
  });

  it("labels the timeline rows and keeps its type at 12 units or more", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    const figure = /<figure[\s\S]*?<\/figure>/.exec(html)?.[0] ?? "";
    // Each role names its stage, and each lane its range (the Now lane's end, 22:00, is still said).
    expect(text(figure)).toContain("Now · Side · 20:30–22:00");
    expect(text(figure)).toContain("Tested · Side · 21:30–23:00");
    expect(text(figure)).not.toContain("to 22:00");
    expect(html).not.toMatch(/type-kicker[^"]*">(now|tested|Now|Tested)</);
    expect(html).not.toMatch(/text-\[(8|9)px\]/);
  });

  it("says in one plain sentence who clashes, where and when, and what the move leaves, from the card's own figures", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    const plain = text(html);
    // The sentence read in the drawing's place names every lane's stage and range, as its label does.
    expect(plain).toMatch(
      /Now: Ann Arbor \(Main, 20:00–21:30\) and Bo Diddly Squat \(Side, 20:30–22:00\) share 20:30–21:30, 60 minutes\. Tested: Bo Diddly Squat 60 minutes later \(Side, 21:30–23:00\) leaves no time shared\./,
    );
    // Three lanes: the staying set once with its stage and range, then the moving set Now (with its stage
    // and range, which still names its end) and Tested (with its stage and tested range), each label's items
    // joined by " · " (shown under 640 px). Type stays at 12 units or more.
    expect(plain).toContain(
      "Ann Arbor · Main · 20:00–21:30 Bo Diddly Squat · Now · Side · 20:30–22:00 60 min shared Bo Diddly Squat · Tested · Side · 21:30–23:00 no time shared",
    );
    // The headline states the move, so the strip carries no "Move:" caption and no arrow under it.
    expect(plain).not.toContain("Move: 60 minutes later");
    expect(html).not.toContain("cc-hero-arrow");
    expect(plain).toContain("60 min shared");
    expect(plain).toContain("no time shared");
    // The minutes under the bracket: 13 px mono vermilion; no time shared is muted, never vermilion.
    expect(html).toMatch(/<p data-strip-minutes="" class="[^"]*font-mono text-\[0\.8125rem\] leading-4[^"]*text-primary[^"]*"[^>]*>60 min shared<\/p>/);
    expect(html).toMatch(/<p data-strip-minutes="" class="[^"]*font-mono text-\[0\.8125rem\] leading-4 text-muted-foreground">no time shared<\/p>/);
    expect(html).not.toMatch(/text-\[(8|9|10|11)px\]/);
  });

  it("names the stage the move puts the set on, not the one it leaves", () => {
    const base = copy();
    const moved = { ...base, moveLine: base.moveLine.replace(/lowest index is Side /, "lowest index is Main ") };
    expect(moved.moveLine).not.toBe(base.moveLine);
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: moved }));
    const plain = text(html);
    expect(plain).toContain("Bo Diddly Squat · Tested · Main · 21:30–23:00");
    expect(plain).toContain("Bo Diddly Squat · Now · Side · 20:30–22:00");
    expect(laneLabels(/<figure[\s\S]*?<\/figure>/.exec(html)?.[0] ?? "")).toEqual(fixtureLanes("Main"));
    expect(plain).toContain("Tested: Bo Diddly Squat 60 minutes later (Main, 21:30–23:00)");
  });

  it("draws one pair strip of three lanes as geometry only: every word is HTML, the shared time hatched and bracketed, the drawing hidden", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    const figure = /<figure[\s\S]*?<\/figure>/.exec(html)?.[0] ?? "";
    // One PairStrip, with its screen-reader sentence first and the drawing hidden.
    expect(figure.match(/data-pair-strip=""/g)).toHaveLength(1);
    expect(figure).toMatch(/<div data-pair-strip="" class="min-w-0"><p class="sr-only">Now: Ann Arbor \(Main, 20:00–21:30\)[^<]*<\/p><div aria-hidden="true"/);
    // No text inside any SVG, and no type that scales with a viewBox.
    for (const svg of figure.match(/<svg[\s\S]*?<\/svg>/g) ?? []) expect(svg).not.toMatch(/<text/);
    expect(figure).not.toContain("viewBox");
    expect(figure).not.toContain("textLength");
    // Three lanes in order: the staying set once, then the moving set Now and Tested.
    const lanes = [...figure.matchAll(/data-strip-lane="(staying|now|tested)"/g)].map((m) => m[1]);
    expect(lanes).toEqual(["staying", "now", "tested"]);
    const bars = [...figure.matchAll(/<svg data-strip-bar="(staying|now|tested)"[\s\S]*?<\/svg>/g)];
    expect(bars.map((bar) => bar[1])).toEqual(["staying", "now", "tested"]);
    const [staying, now, tested] = bars.map((bar) => bar[0]);
    // The staying bar: one solid ink capsule (rx = half its 12 px height), never hatched, cut or vermilion.
    expect(staying).toMatch(/^<svg[^>]*><rect[^>]*height="12" rx="6" fill="var\(--foreground\)"><\/rect><\/svg>$/);
    expect(staying).not.toMatch(/url\(#|var\(--primary\)|clip-path/);
    // The overlap mark is the one definition in marks.tsx: a 16 px tile turned 45 degrees holding one 1.5 px
    // vermilion line at full strength. One pattern for the strip, no wash and no opacity anywhere.
    const patterns = [...figure.matchAll(/<pattern id="([^"]+)" patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate\(45\)"><line [^>]*stroke="var\(--primary\)" stroke-width="1.5"><\/line><\/pattern>/g)];
    expect(patterns).toHaveLength(1);
    expect(figure.match(/<pattern/g)).toHaveLength(1);
    const id = patterns[0]?.[1] ?? "";
    expect(id).not.toContain(":");
    expect(figure).not.toMatch(/fill-opacity|stroke-opacity|opacity="|cc-ink-hatch|cc-hatch-/);
    // The open bars: card fill first, the window (clipped to the bar's own capsule) next, the ink outline last.
    for (const bar of [now, tested]) {
      expect(bar).toMatch(/^<svg[^>]*><rect[^>]*rx="6" fill="var\(--card\)"/);
      const outline = bar.search(/<rect[^>]*fill="none" stroke="var\(--foreground\)" stroke-width="1.5"/);
      expect(outline).toBeGreaterThan(-1);
      const hatchAt = bar.indexOf(`fill="url(#${id})"`);
      if (hatchAt > -1) expect(hatchAt).toBeLessThan(outline);
    }
    const clips = [...now.matchAll(/<clipPath id="([^"]+)"><rect [^>]*rx="6"[^>]*><\/rect><\/clipPath><g clip-path="url\(#([^"]+)\)"/g)];
    expect(clips).toHaveLength(1);
    expect(clips[0][2]).toBe(clips[0][1]);
    // The Now window: its card rect and hatch over the span, the two edge cuts, then the card halo.
    const nowWindow = /<g clip-path="url\(#[^"]+\)">([\s\S]*?)<\/g><rect[^>]*fill="none" stroke="var\(--foreground\)"/.exec(now)?.[1] ?? "";
    expect(nowWindow).toMatch(/^<rect[^>]*fill="var\(--card\)"><\/rect><rect[^>]*fill="url\(#/);
    expect(nowWindow.match(/<line[^>]*stroke="var\(--primary\)" stroke-width="1"/g)).toHaveLength(2);
    expect(nowWindow).toMatch(/<rect[^>]*rx="6"[^>]*fill="none" stroke="var\(--card\)" stroke-width="4"><\/rect>$/);
    // Here the move leaves no time shared, so the tested bar has no window; dashed 4 3 means tested.
    expect(tested).not.toContain("clip-path");
    expect(tested).toMatch(/<rect[^>]*rx="6"[^>]*fill="none" stroke="var\(--foreground\)" stroke-width="1.5" stroke-dasharray="4 3"/);
    expect(now).not.toContain("stroke-dasharray");
    expect(figure).not.toMatch(/stroke="var\(--primary\)"[^>]*stroke-dasharray/);
    expect(figure).not.toContain('stroke-dasharray="2 3"');
    expect(figure).not.toContain("cc-hero-ghost");
    // No vermilion line runs across a bar: every vermilion stroke in a bar is inside its window's clip.
    for (const bar of [staying, now, tested]) {
      const bare = bar.replace(/<g clip-path="url\(#[^"]+\)">[\s\S]*?<\/g>(?=<rect[^>]*fill="none" stroke="var\(--foreground\)")/g, "");
      expect(bare).not.toContain("var(--primary)");
    }
    // The bracket under the shared zone: 1 px vermilion with round caps, its own svg 4 px under the bar.
    const brackets = figure.match(/<div data-strip-bracket=""><svg width="100%" height="6"[\s\S]*?<\/svg>/g) ?? [];
    expect(brackets).toHaveLength(1);
    expect(brackets[0]?.match(/<line[^>]*stroke="var\(--primary\)" stroke-width="1" stroke-linecap="round"/g)).toHaveLength(3);
    expect(brackets[0] ?? "").toContain('class="mt-1 block overflow-visible"');
    // One axis along the top, in 12 px mono, a tick on every multiple of 30 minutes inside the domain (here
    // both ends are on the step), over 1 px border-strong ticks: one tick per label, so no tick stands bare.
    const labels = [...figure.matchAll(/font-mono text-xs leading-4 whitespace-nowrap text-muted-foreground tabular-nums[^"]*"[^>]*>(\d{2}:\d{2})</g)].map((m) => m[1]);
    expect(labels).toEqual(["20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"]);
    const axis = /<div data-strip-axis=""[\s\S]*?<\/svg>/.exec(figure)?.[0] ?? "";
    expect(axis.match(/<line[^>]*stroke="var\(--border-strong\)" stroke-width="1"/g)).toHaveLength(labels.length);
    expect(axis).not.toContain("invisible");
    // One pitch: from 640 px the lanes sit in equal grid rows (8 px apart), every lane with the same room
    // under its bar. Under 640 px (6 px apart) the staying set, which draws no bracket, takes only its label
    // and bar (an auto row, no room under it); the two bracketed lanes share one height.
    expect(figure).toContain(
      'class="mt-2 grid gap-1.5 max-sm:grid-rows-(--strip-rows) sm:auto-rows-fr sm:gap-2" style="--strip-rows:auto 1fr 1fr"',
    );
    const pads = [...figure.matchAll(/<div data-strip-lane="[a-z]+" class="([^"]*)"/g)].map((m) => m[1].split(" ").filter((c) => /pb-/.test(c)).join(" "));
    expect(pads).toEqual(["sm:pb-1.5", "pb-6.5 sm:pb-1.5", "pb-6.5 sm:pb-1.5"]);
    // From 640 px every lane and the axis share the 9.5rem label column.
    expect(figure.match(/sm:grid sm:grid-cols-\[9\.5rem_minmax\(0,1fr\)\]/g)).toHaveLength(4);
    // Names wrap, never cut: no truncation in the figure.
    expect(figure).not.toMatch(/\btruncate\b|line-clamp|text-ellipsis/);
    // The line under it, word for word: what else the move changes (here, nothing gets longer).
    expect(text(/<figcaption[\s\S]*?<\/figcaption>/.exec(figure)?.[0] ?? "")).toBe("No other overlap gets longer.");
  });

  it("reads the published times back from the card's own drawing, so the strip computes nothing new", () => {
    for (const [fixed, moving, after] of [
      [{ start: 840, end: 885 }, { start: 840, end: 900 }, { start: 855, end: 915 }],
      [{ start: 1200, end: 1290 }, { start: 1230, end: 1320 }, { start: 1290, end: 1380 }],
      [{ start: 1425, end: 1470 }, { start: 1410, end: 1455 }, { start: 1440, end: 1485 }],
    ]) {
      const line = sharedTimeline({ name: "A", ...fixed }, { name: "B", ...moving }, after);
      const spans = line ? timelineSpans(line) : null;
      const shift = spans ? spans.staying.start - fixed.start : 0;
      // Past midnight the clock wraps; the spans keep their lengths and their places relative to each other.
      expect(shift % 1440).toBe(0);
      expect(spans).toEqual({
        staying: { start: fixed.start + shift, end: fixed.end + shift },
        now: { start: moving.start + shift, end: moving.end + shift },
        tested: { start: after.start + shift, end: after.end + shift },
      });
    }
  });

  it("states the index with a visible label and keeps the attribution under it", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    const plain = text(html);
    const label = plain.indexOf("Clash Budget Index");
    expect(label).toBeGreaterThan(-1);
    expect(plain.indexOf("104.2 → 98.4")).toBeGreaterThan(label);
    expect(plain.indexOf("Selected and scored by this app’s index")).toBeGreaterThan(plain.indexOf("104.2 → 98.4"));
  });

  it("has no buttons the page cannot act on, and shows each only with its handler and its seed", () => {
    expect(text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy() })))).not.toContain("Keep this move");
    const withHandlers = text(
      renderToStaticMarkup(
        createElement(DecisionCard, { copy: copy(), onOpenMove: () => {}, onTryRule: () => {}, onOpenHidden: () => {} }),
      ),
    );
    expect(withHandlers).toContain("Keep this move");
    expect(withHandlers).toContain("Try this rule yourself");
    expect(withHandlers).toContain("Open a hidden clash");
    // "Open a hidden clash" is a ruled line of type with its arrow, and the first line of the working: one
    // click on "Show the working" shows it.
    const hiddenHtml = renderToStaticMarkup(
      createElement(DecisionCard, { copy: copy(), onOpenMove: () => {}, onOpenHidden: () => {} }),
    );
    expect(hiddenHtml).toMatch(/<button[^>]*data-variant="ruled"[^>]*>Open a hidden clash<svg/);
    const hiddenParts = working(hiddenHtml);
    expect(hiddenParts.region).toMatch(/^<div [^>]*hidden=""[^>]*><div class="mb-4"><button[^>]*data-variant="ruled"[^>]*>Open a hidden clash<svg/);
    expect(text(hiddenParts.outside)).not.toContain("Open a hidden clash");
    // The button's row: "Keep this move", then the "Show the working" toggle directly after it, left-aligned
    // and wrapping below the button only when the row has no room.
    expect(hiddenHtml).toMatch(
      /<div class="mt-5 min-w-0"><div class="flex w-full flex-wrap items-center justify-start gap-x-6 gap-y-2"><button[^>]*>Keep this move<\/button><button type="button"[^>]*aria-controls=/,
    );
    // At every width the card reads in source order: the dateline, the headline, the index with its caption
    // directly after the readings, (below 1024 px) "Keep this move", the drawing and its key, the taste
    // line, the action row and the working, so a phone's first screen shows the action and the clash itself. Nothing carries an order class, so the tab order is
    // the order seen at every width; the figure holds nothing focusable.
    const ORDER = /(?:^|\s)(?:[a-z-]+:)*-?order-\d/;
    const phoneOrdered = [...hiddenHtml.matchAll(/<[a-z0-9]+\b[^>]*\bclass="([^"]*)"[^>]*>/g)].filter((m) => ORDER.test(m[1])).map((m) => m[0]);
    expect(phoneOrdered).toHaveLength(0);
    // 12 px under the index block's copy of the button below 640 px, 16 px to 1023 px, 12 px from 1024 px.
    expect(hiddenHtml).toMatch(/<figure data-shared-time="" class="mt-3 w-full min-w-0 max-lg:mt-4 max-sm:mt-3">/);
    const figureHtml = /<figure[\s\S]*?<\/figure>/.exec(hiddenHtml)?.[0] ?? "";
    expect(figureHtml).toContain("Solid: where the sets play now. Dashed: tested. Hatched: time shared.");
    expect(figureHtml).not.toMatch(/<(a|button|input|select|textarea)\b|tabindex=/);
    expect(hiddenHtml).toMatch(/<div data-index-block="" class="mt-4">/);
    for (const pattern of [/<h2[^>]*class="[^"]*"/, /<p class="text-\[0\.8125rem\] leading-5 font-semibold text-muted-foreground">Tiny Fest/]) {
      expect(pattern.exec(hiddenHtml)?.[0]).not.toMatch(ORDER);
    }
    // Source order: dateline, headline, why this clash, index (readings, then the attribution), the early
    // "Keep this move", drawing, the action row (its own "Keep this move"), working.
    const at = (needle: string) => hiddenHtml.indexOf(needle);
    expect(at("Tiny Fest, Saturday")).toBeLessThan(at('id="decision-heading"'));
    expect(at('id="decision-heading"')).toBeLessThan(at("data-why-lines"));
    expect(at("data-why-lines")).toBeLessThan(at("data-index-block"));
    expect(at("data-index-block")).toBeLessThan(at(">Keep this move<"));
    expect(at(">Keep this move<")).toBeLessThan(at("<figure"));
    expect(at("<figure")).toBeLessThan(hiddenHtml.lastIndexOf(">Keep this move<"));
    expect(hiddenHtml.lastIndexOf(">Keep this move<")).toBeLessThan(at("data-working"));
    // The attribution directly after the readings, inside the index block.
    const block = /<div data-index-block=""[\s\S]*?A reading, not a verdict\.<\/p><\/div>/.exec(hiddenHtml)?.[0] ?? "";
    expect(text(block)).toMatch(/104\.2 → 98\.4[\s\S]*Selected and scored by this app’s index\. A reading, not a verdict\.$/);
    // One dominant action: "Keep this move" is the only solid button, in the ink CTA fill; the rule search
    // is ruled text under it.
    const handlersHtml = renderToStaticMarkup(
      createElement(DecisionCard, { copy: copy(), onOpenMove: () => {}, onTryRule: () => {}, onOpenHidden: () => {} }),
    );
    // Two copies of it in the markup, one per width class: under the reading below 1024 px (lg:hidden) and
    // in the action row from 1024 px (max-lg:hidden), so one is displayed at every width.
    expect(handlersHtml.match(/data-variant="default"/g)).toHaveLength(2);
    expect(handlersHtml).toMatch(/<button[^>]*data-variant="default"[^>]*>Keep this move</);
    expect(/<button[^>]*data-variant="default"[^>]*>/.exec(handlersHtml)?.[0]).toMatch(/\bbg-cta\b/);
    expect(handlersHtml).not.toMatch(/bg-primary|data-variant="(soft|link|destructive)"/);
    expect(handlersHtml).toMatch(/<button[^>]*data-variant="ruled"[^>]*>Try this rule yourself</);
    expect(handlersHtml).not.toMatch(/data-variant="(outline|ink)"/);
    expect(handlersHtml.indexOf("Keep this move")).toBeLessThan(handlersHtml.indexOf("Try this rule yourself"));
    // The action row comes after the drawing, which spans the card (no width ceiling).
    expect(handlersHtml.lastIndexOf("</svg>", handlersHtml.indexOf("</figure>"))).toBeGreaterThan(-1);
    expect(handlersHtml.indexOf("</figure>")).toBeLessThan(handlersHtml.lastIndexOf("Keep this move"));
    expect(handlersHtml).toMatch(/<figure data-shared-time="" class="[^"]*w-full/);
    expect(handlersHtml).not.toMatch(/max-w-[(18|24)rem]/);
    // An open composition on the paper, not a box: one 1 px decorative rule along the top with 20/24 px
    // above the dateline, and no corner, no surface edge, no card fill, no side padding and no shadow; no
    // top bar either: no 2 px rule, inset or not, in the receipt or its skeleton, which wears the same frame.
    const sectionClass = /<section[^>]*class="([^"]*)"/.exec(handlersHtml)?.[1] ?? "";
    expect(sectionClass).toBe("@container min-w-0 border-t border-border pt-5 sm:pt-6");
    // Under 640 px the two-line heading gets leading 1.15 (1.1 from type-title elsewhere); its size and words stay.
    expect(/<h2 id="decision-heading"[^>]*class="([^"]*)"/.exec(handlersHtml)?.[1].split(" ")).toEqual(
      expect.arrayContaining(["type-title", "max-sm:leading-[1.15]"]),
    );
    const skeleton = renderToStaticMarkup(createElement(DecisionCardSkeleton));
    const skeletonClass = /^<div aria-hidden="true" class="([^"]*)"/.exec(skeleton)?.[1] ?? "";
    expect(skeletonClass).toBe("border-t border-border pt-5 sm:pt-6");
    for (const frame of [sectionClass, skeletonClass]) {
      const classes = frame.split(" ");
      for (const banned of ["rounded-xl", "border-surface-edge", "bg-card", "border", "p-5", "sm:p-6", "px-5"]) {
        expect(classes, banned).not.toContain(banned);
      }
      expect(frame).not.toMatch(/\brounded-|\bshadow|\bbg-|\bborder-(x|b|l|r)\b/);
    }
    expect(handlersHtml).not.toMatch(/shadow|color-mix|\b(bg|border|text|fill|stroke)-[a-z-]+\/(\[|\d)/);
    expect(handlersHtml).not.toMatch(/\bh-0\.5\b/);
    expect(renderToStaticMarkup(createElement(DecisionCardSkeleton))).not.toMatch(/\bh-0\.5\b/);
    expect(handlersHtml).not.toMatch(/rounded-(none|lg|2xl)|border-t-2/);
    expect(withHandlers).not.toContain("Keep this change");
    const noRule = text(
      renderToStaticMarkup(
        createElement(DecisionCard, { copy: copy({ rule: null }), onOpenMove: () => {}, onTryRule: () => {} }),
      ),
    );
    expect(noRule).toContain("Keep this move");
    expect(noRule).not.toContain("Try this rule yourself");
    expect(noRule).not.toContain("Line 3");
    expect(noRule).not.toContain("Line 4");
    // With no rule row there is no rule-check sentence; the caption still states the limits, outside every
    // disclosure.
    expect(copy({ rule: null }).limitsLine).toBeNull();
    expect(noRule).not.toContain("Checked against the timetable’s rules");
    const noRuleOpen = text(
      working(
        renderToStaticMarkup(
          createElement(DecisionCard, { copy: copy({ rule: null }), onOpenMove: () => {}, onTryRule: () => {} }),
        ),
      ).outside,
    );
    expect(noRuleOpen).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
  });

  it("puts a second Keep this move under the reading below 1024 px: after the attribution line, before the figure, one copy per width", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), onOpenMove: () => {}, onOpenHidden: () => {} }));
    const moves = [...html.matchAll(/<button[^>]*>Keep this move<\/button>/g)].map((m) => ({ tag: m[0], at: m.index ?? -1 }));
    expect(moves).toHaveLength(2);
    const [early, row] = moves;
    // The early copy: a sibling directly after the index block (never inside it), so "A reading, not a
    // verdict." stays the block's last line, directly under the index; then the figure.
    const blockEnd = html.indexOf("A reading, not a verdict.</p></div>");
    expect(blockEnd).toBeGreaterThan(-1);
    expect(html.slice(blockEnd)).toMatch(
      /^A reading, not a verdict\.<\/p><\/div><div class="mt-4 lg:hidden max-sm:mt-3"><button[^>]*>Keep this move<\/button><div role="status" aria-live="polite" data-kept-notice=""><\/div><\/div><figure data-shared-time=""/,
    );
    expect(early.at).toBeGreaterThan(blockEnd);
    expect(early.at).toBeLessThan(html.indexOf("<figure"));
    expect(row.at).toBeGreaterThan(html.indexOf("</figure>"));
    // The same solid button with the same words: auto width (no full-width class), 44 px at least. Below
    // 1024 px it is displayed (its wrapper lg:hidden), from 1024 px the action row's copy (max-lg:hidden).
    for (const { tag } of moves) {
      expect(tag).toMatch(/data-variant="default"/);
      expect(tag).toMatch(/\bmin-h-11\b/);
      expect(tag).not.toMatch(/\bid="/);
    }
    expect(early.tag).not.toMatch(/w-full|max-lg:hidden/);
    expect(row.tag).toMatch(/\bmax-lg:hidden\b/);
    expect(row.tag).not.toMatch(/(?:^|[\s"])lg:hidden\b/);
    // Without an index block, or without the handler or the seed, there is no early copy.
    const noIndex = renderToStaticMarkup(createElement(DecisionCard, { copy: { ...copy(), indexBefore: null }, onOpenMove: () => {} }));
    expect(noIndex.match(/>Keep this move<\/button>/g)).toHaveLength(1);
    expect(noIndex).not.toContain("lg:hidden");
    expect(renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }))).not.toContain("lg:hidden");
    // The skeleton holds the same 44 px block in the same place, below 1024 px only.
    const skeleton = renderToStaticMarkup(createElement(DecisionCardSkeleton));
    expect(skeleton).toMatch(/<div class="mt-4 flex h-11 items-center lg:hidden max-sm:mt-3"><div class="rounded-sm bg-muted h-11 w-37"><\/div><\/div><div class="mt-3 flex h-61.5 flex-col justify-around max-lg:mt-4 max-sm:mt-3 max-sm:h-57">/);
  });

  it("titles the disclosure 'Show the working' with no subtitle, and holds line 3 only with a rule line", () => {
    const summaryOf = (html: string) => working(html).toggle;
    const withRule = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    expect(copy().ruleLine).toBeTruthy();
    expect(realText(summaryOf(withRule))).toBe("Show the working");
    expect(text(withRule)).toContain("Line 3");
    const noRuleCopy = copy({ rule: null });
    expect(noRuleCopy.ruleLine).toBeFalsy();
    const noRule = renderToStaticMarkup(createElement(DecisionCard, { copy: noRuleCopy }));
    expect(realText(summaryOf(noRule))).toBe("Show the working");
    expect(text(noRule)).not.toContain("Line 3");
    expect(text(noRule)).toContain("How this was chosen");
    expect(text(withRule)).not.toMatch(/lines 1 to/);
  });

  it("says beside the index figure what its change is, from the same two readings, and 'Lower is better' once, in the paragraph", () => {
    const plain = text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy() })));
    // 104.2 → 98.4: a fall of 5.8, with a real minus sign, then one paragraph: the scale, the attribution, the limit.
    expect(plain).toContain(
      "104.2 to 98.4. \u22125.8 index points A score, not money: 100 = the average random valid timetable of this lineup. Lower is better. Selected and scored by this app’s index. A reading, not a verdict.",
    );
    // Mono for the figure only; "index points" in the sans, muted.
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    expect(html).toContain(
      '<p class="text-[0.8125rem] leading-snug text-muted-foreground"><span class="font-mono tabular-nums">\u22125.8</span> index points</p>',
    );
    expect(indexDelta("104.2", "98.4")).toBe("\u22125.8 index points");
    expect(indexDelta("116.7", "114.3")).toBe("\u22122.4 index points");
    expect(indexDelta("10.0", "12.5")).toBe("+2.5 index points");
    expect(indexDelta("10.0", "10.0")).toBe("0.0 index points");
    expect(indexDelta(null, "1.0")).toBeNull();
    expect(indexDelta("x", "1.0")).toBeNull();
  });

  it("offers Keep this change only with its handler and a listed change on line 3", () => {
    const fix = {
      sets_moved: 1,
      minutes_moved: 60,
      stage_changes: 0,
      budget_after: 98.4,
      moves: [
        {
          act_id: "bo",
          act: "Bo Diddly Squat",
          from: "Side 20:30-22:00",
          stage_id: "side",
          stage: "Side",
          day: 0,
          start: "21:30",
          end: "23:00",
          minutes_moved: 60,
        },
      ],
    };
    const withChange = copy({ rule: { ...RULE, fixes_found: 1, fixes: [fix] } });
    expect(withChange.seedChange).not.toBeNull();
    const shown = text(
      renderToStaticMarkup(createElement(DecisionCard, { copy: withChange, onOpenMove: () => {}, onKeepChange: () => {} })),
    );
    // The button says what it keeps, and a visible line under it says what the change is.
    expect(withChange.changeLabel).toBe("Keep the single-set change");
    expect(shown).toContain("Keep the single-set change");
    expect(shown).toContain(withChange.changeSummary ?? "never");
    expect(withChange.changeSummary).toBe(
      "To keep Ann Arbor and Bo Diddly Squat apart: Bo Diddly Squat to Side 21:30–23:00; index 104.2 → 98.4.",
    );
    expect(shown).not.toContain("Keep this change");
    const bare = text(renderToStaticMarkup(createElement(DecisionCard, { copy: withChange })));
    expect(bare).not.toContain("Keep the single-set change");
    expect(bare).not.toContain("To keep Ann Arbor");
    // No listed change on line 3: no button, even with a handler.
    const none = text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), onKeepChange: () => {} })));
    expect(none).not.toContain("Keep the single-set change");
    expect(none).not.toContain("Keep the two-set change");
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: withChange, onKeepChange: () => {} }));
    // The button is described by line 3 and by the summary line, both in the markup.
    const ids = /aria-describedby="([^"]+)"/.exec(html)?.[1]?.split(" ") ?? [];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
  });

  it("names a two-set change in its label and marks the card once the plan holds it", () => {
    const two = copy({ rule: { ...RULE, fixes_found: 1, fixes: [TWO_SET_FIX] } });
    expect(two.changeLabel).toBe("Keep the two-set change");
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: two, onKeepChange: () => {} }));
    expect(text(html)).toContain("Keep the two-set change");
    expect(text(html)).not.toContain("In your plan");
    const kept = renderToStaticMarkup(
      createElement(DecisionCard, { copy: two, onKeepChange: () => {}, kept: { move: false, change: true } }),
    );
    expect(text(kept)).toContain("In your plan");
    expect(text(kept)).toContain("the two-set change");
    expect(text(kept)).not.toContain("Keep the two-set change");
    // It is not disabled: a repeat press says "Already in your plan." instead of losing focus.
    // The button's own "In your plan" (the comparison's column head, above it, says the same of its column).
    const at = kept.indexOf('In your plan<span class="sr-only">');
    const button = kept.slice(kept.lastIndexOf("<button", at), at);
    expect(button).not.toBe("");
    expect(button).not.toContain(`disabled=""`);
    // A quiet state, not a second primary button: no fill, no underline, and the unkept one is ruled text.
    expect(button).toContain('data-variant="ruled"');
    expect(button).toContain("no-underline");
    expect(button).not.toContain('data-variant="default"');
    expect(html).toMatch(/<button[^>]*data-variant="ruled"[^>]*class="[^"]* underline [^"]*"[^>]*>Keep the two-set change/);
  });

  it("says so, with no receipt, figure, timeline or move to open, when no place lowers the index", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionCard, { copy: copy({ move: null }), onOpenMove: () => {} }),
    );
    const plain = text(html);
    expect(plain).toContain("No legal place for either set lowers the index.");
    expect(plain).not.toContain("Keep this move");
    // No figure: no index label; the paragraph (scale, attribution, limit) still shows with no click.
    expect(plain).not.toContain("Clash Budget Index");
    expect(html).not.toContain("data-index-block");
    expect(text(working(html).outside)).toContain(`${INDEX_SCALE} Selected and scored by this app’s index. A reading, not a verdict.`);
    expect(html).not.toContain("data-shared-time");
    expect(html).not.toContain("data-pair-strip");
    // The only drawing left is the toggle's chevron.
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toMatch(/<svg[^>]*lucide-chevron-right/);
    // The dateline is the heading, set as a title, not a kicker.
    expect(html).toMatch(/<h2 id="decision-heading"[^>]*class="[^"]*type-title[^"]*">Tiny Fest · Saturday · published timetable<\/h2>/);
    expect(html).not.toContain("type-kicker");
  });

  it("uses none of the words the round forbids", () => {
    const plain = text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy() })));
    for (const pattern of [/optimi[sz]/i, /improve/i, /recommend/i, /validated/i, /proven/i, /predicts/i, /\bfix/i, /crowd/i, /headcount/i, /revenue/i, /significant/i]) {
      expect(plain).not.toMatch(pattern);
    }
  });
});

describe("Keep this move, confirmed in place", () => {
  const card = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), onOpenMove: () => null, ...props }));

  it("names the one filled action Keep this move at both widths", () => {
    const html = card({});
    expect(KEEP_MOVE).toBe("Keep this move");
    expect(html.match(/<button[^>]*data-variant="default"[^>]*>Keep this move<\/button>/g)).toHaveLength(2);
    expect(text(html)).not.toContain("Open this move");
  });

  it("says Kept in your plan. with a link to the plan, in ink, under each copy of the button once the plan holds the move", () => {
    const html = card({ kept: { move: true, change: false } });
    expect(KEPT_IN_PLAN).toBe("Kept in your plan.");
    expect(KEPT_AGREE).toBe("Nothing moves until the acts’ teams agree.");
    expect(SEE_YOUR_PLAN).toBe("See your plan");
    // Two live regions, one per width: the early copy's inside its lg:hidden wrapper, the row's max-lg:hidden.
    const notices = [
      ...html.matchAll(/<div role="status" aria-live="polite" data-kept-notice=""[^>]*>[\s\S]*?<\/a><\/p><\/div>/g),
    ].map((m) => m[0]);
    expect(notices).toHaveLength(2);
    for (const notice of notices) {
      expect(text(notice)).toBe("Kept in your plan. Nothing moves until the acts’ teams agree. See your plan");
      expect(notice).toMatch(/<a href="#your-plan" class="[^"]*\bmin-h-11\b[^"]*">See your plan<\/a>/);
      // Ink, never green or vermilion; no box, no pill, no id.
      expect(notice).toContain("text-foreground");
      expect(notice).not.toMatch(/text-(primary|index-lower|success|green|vermilion)|\bbg-|rounded-full|[\s"]border(-[trblxy])?[\s"]/);
      expect(notice).not.toMatch(/\bid="/);
    }
    expect(html.indexOf(notices[0])).toBeLessThan(html.indexOf("<figure"));
    expect(html.indexOf(notices[0])).toBeGreaterThan(html.indexOf(">Keep this move</button>"));
    const classes = [...html.matchAll(/<div role="status" aria-live="polite" data-kept-notice="" class="([^"]*)">/g)].map(
      (m) => m[1],
    );
    expect(classes[classes.length - 1]).toMatch(/\bmax-lg:hidden\b/);
    // "A reading, not a verdict." is still the index block's last line, the early button directly after it.
    expect(html).toMatch(/A reading, not a verdict\.<\/p><\/div><div class="mt-4 lg:hidden max-sm:mt-3"><button/);
  });

  it("leaves the live regions empty while the plan does not hold the move, and shows none without the button", () => {
    const notHeld = card({ kept: { move: false, change: false } });
    expect(notHeld).not.toContain(KEPT_IN_PLAN);
    expect(notHeld.match(/data-kept-notice=""( class="max-lg:hidden")?><\/div>/g)).toHaveLength(2);
    const server = renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), kept: { move: true, change: false } }));
    expect(server).not.toContain("data-kept-notice");
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

  it("after a press, focus goes to the displayed link (never the page), without scrolling", () => {
    const hidden = { getClientRects: () => [], focus: vi.fn() } as unknown as HTMLElement;
    const shown = { getClientRects: () => [{}], focus: vi.fn() } as unknown as HTMLElement;
    expect(focusShown([hidden, shown])).toBe(shown);
    expect(shown.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(focusShown([null, hidden])).toBeNull();
  });
});

describe("Keep this move on a plan that already holds steps (P1)", () => {
  // The card's own move (Bo Diddly Squat to Side 21:30) and another kept move (invented).
  const move = copy().seedMove as StackMove;
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

  it("draws the card the same with an empty plan as with none, and draws no offer before a press", () => {
    const card = (props: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), onOpenMove: () => null, ...props }));
    expect(card({ plan: [] })).toBe(card({}));
    const holding = card({ plan: [other], kept: { move: false, change: false } });
    expect(holding).not.toContain("data-keep-offer");
    expect(text(holding)).not.toContain(ADD_TO_PLAN);
    expect(text(holding)).not.toContain(REPLACE_PLAN);
    // The card's limits stay where they were, with no click, whatever the plan holds.
    expect(text(working(holding).outside)).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
  });

  it("offers Add first (the outline button) and Replace (ghost), 44 px each, under what the plan holds, with no id", () => {
    expect([ADD_TO_PLAN, REPLACE_PLAN]).toEqual(["Add to your plan", "Replace your plan"]);
    const offer = (state: Parameters<typeof KeepMoveOffer>[0]["offer"], held: readonly StackStep[] = [other]) =>
      renderToStaticMarkup(createElement(KeepMoveOffer, { offer: state, held, onAdd: () => {}, onReplace: () => {} }));
    const open = offer({ state: "open" });
    expect(text(open)).toBe("Your plan already holds 1 kept move. Add to your plan Replace your plan");
    expect(open).toMatch(/role="group" aria-label="Keep this move: add it to your plan, or replace your plan"/);
    expect(open).toMatch(/data-variant="outline" data-size="default" class="[^"]*\bh-11\b[^"]*"[^>]*>Add to your plan<\/button>/);
    expect(open).toMatch(/data-variant="ghost" data-size="default" class="[^"]*\bh-11\b[^"]*"[^>]*>Replace your plan<\/button>/);
    expect(open.indexOf(ADD_TO_PLAN)).toBeLessThan(open.indexOf(REPLACE_PLAN));
    expect(open).not.toMatch(/\bid="|rounded-full|shadow|bg-(primary|success)|text-(primary|success)/);
    // A kept change counts as a step.
    expect(text(offer({ state: "open" }, [other, change]))).toContain("Your plan already holds 2 kept steps.");
    // While the whole plan is scored, Add is unavailable and says what is happening; the spinner moves only
    // when motion is allowed.
    const checking = offer({ state: "checking" });
    expect(checking).toMatch(/aria-disabled="true"[^>]*>.*Add to your plan<\/button>/);
    expect(checking).toContain("motion-safe:animate-spin");
    expect(text(checking)).toContain("Scoring your plan with this move added.");
    // Refused for good: the reason in words, and Replace alone. Refused for now: both ways stay.
    const reason = "Not added: your plan already moves Bo Diddly Squat, and a plan moves each set once. Your plan is unchanged.";
    const refused = offer({ state: "rejected", reason, retry: false });
    expect(text(refused)).toBe(`Your plan already holds 1 kept move. ${REPLACE_PLAN} ${reason}`);
    const failed = offer({ state: "rejected", reason, retry: true });
    expect(text(failed)).toContain(ADD_TO_PLAN);
    expect(text(failed)).toContain(REPLACE_PLAN);
  });

  it("adds only once the engine scored the whole plan, and leaves the plan unchanged when it refuses", async () => {
    const kept: StackStep[] = [other];
    const check = vi.fn(async (steps: readonly StackStep[]) => (steps.length === 2 ? ready : ({ status: "error" } as PlanAnswer)));
    const act = copy().moveAct ?? "";
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

describe("a Clash Budget Index change as one line (the hero's treatment)", () => {
  it("prints the two readings in the index type and the change in words, with the day's range, and no bars or chip", () => {
    const html = renderToStaticMarkup(
      createElement(IndexChange, { before: 116.7, after: 113.2, range: { low: 92, high: 109 }, verdict: "This plan scores 4.2 index points above that range." }),
    );
    expect(text(html)).toBe(
      "116.7 → 113.2 116.7 to 113.2, −3.5 index points · Clash Budget Index · lower is better The middle 80% of random valid timetables of this lineup score 92 to 109. This plan scores 4.2 index points above that range.",
    );
    // The same figure type as the hero's index; the words carry the direction, so no colour, bar or chip.
    expect(html).toMatch(/<span class="type-numeral text-\[1\.75rem\] leading-none tabular-nums"><span aria-hidden="true">116\.7 → 113\.2<\/span>/);
    expect(html).not.toMatch(/bg-success|text-success|text-primary|rounded-bar|\btag\b|bg-muted|bg-ink/);
    expect(html.match(/<p[ >]/g)).toHaveLength(2);
    // A rise says so in words too; no reading, no line.
    expect(text(renderToStaticMarkup(createElement(IndexChange, { before: 98.4, after: 99, range: null })))).toContain("+0.6 index points");
    expect(renderToStaticMarkup(createElement(IndexChange, { before: null, after: 99, range: null }))).toBe("");
  });

  it("moves the strip's legend into its accessible name, word for word", () => {
    expect(STRIP_LEGEND).toBe("Solid: where the sets play now. Dashed: tested. Hatched: time shared.");
  });
});

describe("the index scale in the card", () => {
  it("prints the scale, the attribution and the limit as one paragraph ending the index block, on a published and an invented day", () => {
    expect(INDEX_SCALE).toBe("A score, not money: 100 = the average random valid timetable of this lineup. Lower is better.");
    for (const preset of [tinyPreset(), tinyPreset({ synthetic: true })]) {
      const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy({}, preset), onOpenMove: () => null }));
      const block = /<div data-index-block=""[\s\S]*?A reading, not a verdict\.<\/p><\/div>/.exec(html)?.[0] ?? "";
      expect(text(block)).toMatch(
        /index points A score, not money: 100 = the average random valid timetable of this lineup\. Lower is better\. Selected and scored by this app’s index\. A reading, not a verdict\.$/,
      );
      // Under the label: the figure with its change, then the one paragraph.
      expect(block.match(/<p[ >]/g)).toHaveLength(4);
      expect(text(working(html).outside)).toContain(INDEX_SCALE);
    }
  });

  it("says 'Lower is better' exactly once, and the attribution with its limit, in every state of the card", () => {
    const states = [
      renderToStaticMarkup(createElement(DecisionCard, { copy: copy() })),
      renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), onOpenMove: () => null, kept: { move: false, change: false } })),
      renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), onOpenMove: () => null, kept: { move: true, change: false } })),
      renderToStaticMarkup(createElement(DecisionCard, { copy: copy({ move: null }), onOpenMove: () => null })),
      renderToStaticMarkup(createElement(DecisionCard, { copy: copy({}, tinyPreset({ synthetic: true })), onOpenMove: () => null })),
    ];
    for (const html of states) {
      const outside = text(working(html).outside);
      expect(outside.match(/lower is better/gi)).toHaveLength(1);
      expect(outside).toContain("100 = the average random valid timetable");
      expect(outside).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
      // One paragraph, shown at every width (no width-hidden class on it).
      const paragraph = /<p data-index-scale="" class="([^"]*)">/.exec(html)?.[1] ?? "";
      expect(paragraph).not.toBe("");
      expect(paragraph).not.toMatch(/hidden/);
      expect(html.match(/data-index-scale=""/g)).toHaveLength(1);
    }
  });
});

describe("the hidden clash in the card", () => {
  it("says the card's own clash is a hidden clash, concretely, in ink, under the heading and above the index, outside the working", () => {
    const card = copy();
    expect(isHiddenDecision(card)).toBe(true);
    const taste = tasteOverlapOf(card);
    expect(taste).toMatch(/^\d{1,3}$/);
    const html = renderToStaticMarkup(
      createElement(DecisionCard, { copy: card, onOpenMove: () => null, hiddenCount: 4, genres: ["Garage Rock", "Folk Pop"] }),
    );
    const line = `A hidden clash, 1 of 4 on this day: main genres differ (Garage Rock, Folk Pop), yet their taste overlap ranks ${taste} of 100 on this bill, among the day’s highest.`;
    expect(text(working(html).outside)).toContain(line);
    const classes = /<p data-hidden-line="" class="([^"]*)">/.exec(html)?.[1] ?? "";
    expect(classes).not.toBe("");
    expect(classes).not.toMatch(/prov-qloo|text-primary|teal/);
    // After the heading, before the index block and the drawing.
    expect(html.indexOf("data-hidden-line")).toBeGreaterThan(html.indexOf("</h2>"));
    expect(html.indexOf("data-hidden-line")).toBeLessThan(html.indexOf("data-index-block"));
    expect(html.indexOf("data-hidden-line")).toBeLessThan(html.indexOf("<figure"));
    // No lift or complaint-share figure beside it: that counts a different population.
    expect(line).not.toMatch(/%|lift/);
  });

  it("keeps the board's definition, and drops the count without hiddenCount and the genres unless both are saved", () => {
    const card = copy();
    const taste = tasteOverlapOf(card);
    const bare = text(renderToStaticMarkup(createElement(DecisionCard, { copy: card })));
    expect(bare).toContain(
      `A hidden clash: main genres differ, yet their taste overlap ranks ${taste} of 100 on this bill, among the day’s highest.`,
    );
    expect(bare).not.toContain("1 of");
    expect(hiddenClashLine({ count: 0, genres: ["Rock", null], taste: "88" })).toBe(
      "A hidden clash: main genres differ, yet their taste overlap ranks 88 of 100 on this bill, among the day’s highest.",
    );
    expect(hiddenClashLine({ count: 1, genres: ["Rock", "Jazz"], taste: null })).toBe(
      "A hidden clash, 1 of 1 on this day: main genres differ (Rock, Jazz), yet their taste overlap is among the day’s highest.",
    );
    // The board's Hidden label means the same: main genre tags differ, taste overlap among the day's highest.
    expect(LABEL_META.hidden.explain).toBe("The acts' main genre tags differ, but their taste overlap is among the day's highest.");
  });

  it("says the count's scope, out of the day's ranked clashes, when the page passes both counts from the same list", () => {
    const card = copy();
    const taste = tasteOverlapOf(card);
    const html = renderToStaticMarkup(
      createElement(DecisionCard, { copy: card, onOpenMove: () => null, hiddenCount: 5, rankedCount: 15, genres: ["Garage Rock", "Folk Pop"] }),
    );
    expect(text(working(html).outside)).toContain(
      `A hidden clash, 1 of 5 among the day’s 15 ranked clashes: main genres differ (Garage Rock, Folk Pop), yet their taste overlap ranks ${taste} of 100 on this bill, among the day’s highest.`,
    );
    expect(hiddenClashLine({ count: 5, ranked: 15, genres: null, taste: "97" })).toBe(
      "A hidden clash, 1 of 5 among the day’s 15 ranked clashes: main genres differ, yet their taste overlap ranks 97 of 100 on this bill, among the day’s highest.",
    );
    // The invented day says so, and names no source.
    expect(hiddenClashLine({ count: 2, ranked: 9, genres: null, taste: "70", invented: true })).toBe(
      "A hidden clash, 1 of 2 among the invented day’s 9 ranked clashes: main genres differ, yet their invented taste overlap ranks 70 of 100 on this bill, among the day’s highest.",
    );
    // A ranked count that cannot hold the Hidden count, or none at all, leaves the scope out rather than guess it.
    expect(hiddenClashLine({ count: 5, ranked: 3, genres: null, taste: "97" })).toMatch(/^A hidden clash, 1 of 5 on this day: /);
    expect(hiddenClashLine({ count: 5, ranked: null, genres: null, taste: "97" })).toMatch(/^A hidden clash, 1 of 5 on this day: /);
    expect(hiddenClashLine({ count: 5, ranked: 15.5, genres: null, taste: "97" })).toMatch(/^A hidden clash, 1 of 5 on this day: /);
    expect(hiddenClashLine({ count: null, ranked: 15, genres: null, taste: "97" })).toMatch(/^A hidden clash: /);
  });

  it("says nothing of the kind for a pair without the Hidden label", () => {
    const card = copy({}, tinyPreset({ label: null }));
    expect(isHiddenDecision(card)).toBe(false);
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: card, onOpenMove: () => null, hiddenCount: 3 }));
    expect(text(html)).not.toContain("A hidden clash");
    expect(html).not.toContain("data-hidden-line");
  });

  it("says the day and the overlap are invented on the invented day, naming no source", () => {
    const card = copy({}, tinyPreset({ synthetic: true }));
    expect(isInventedDecision(card)).toBe(true);
    expect(isInventedDecision(copy())).toBe(false);
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: card, hiddenCount: 2, genres: ["Rock", "Jazz"] }));
    const line = /<p data-hidden-line=""[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? "";
    expect(line).toBe(
      `A hidden clash, 1 of 2 on this invented day: main genres differ (Rock, Jazz), yet their invented taste overlap ranks ${tasteOverlapOf(card)} of 100 on this bill, among the day’s highest.`,
    );
    expect(line).not.toMatch(/qloo/i);
  });
});

describe("the saved reading and the live re-check in the working", () => {
  // An invented build date and count.
  const saved = { builtAt: "2026-10-03T09:15:00+00:00", requests: 12 };
  afterEach(() => {
    pairCheck.enabled = false;
  });

  it("prints when and from how many saved responses the published day was built, with the Recorded stamp, inside the working", () => {
    expect(builtDate("2026-10-03T09:15:00+00:00")).toBe("3 Oct 2026");
    expect(builtDate("not a date")).toBeNull();
    expect(savedReadingLine(saved)).toBe("Saved Qloo reading of this day: built 3 Oct 2026 from 12 saved Qloo responses.");
    expect(savedReadingLine({ ...saved, requests: 1 })).toBe(
      "Saved Qloo reading of this day: built 3 Oct 2026 from 1 saved Qloo response.",
    );
    expect(savedReadingLine({ ...saved, requests: 0 })).toBeNull();
    expect(savedReadingLine({ ...saved, builtAt: "" })).toBeNull();
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), saved }));
    const { region, outside } = working(html);
    expect(text(region)).toContain("Recorded Saved Qloo reading of this day: built 3 Oct 2026 from 12 saved Qloo responses.");
    expect(region).toMatch(/data-provenance="recorded"/);
    expect(text(outside)).not.toContain("Saved Qloo reading");
  });

  it("prints no saved reading without the prop, and none on the invented day even when passed", () => {
    expect(text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy() })))).not.toContain("Saved Qloo reading");
    expect(text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), saved: null })))).not.toContain(
      "Saved Qloo reading",
    );
    const invented = renderToStaticMarkup(
      createElement(DecisionCard, { copy: copy({}, tinyPreset({ synthetic: true })), saved }),
    );
    expect(text(invented)).not.toContain("Saved Qloo reading");
    expect(invented).not.toContain('data-provenance="recorded"');
  });

  it("puts the saved reading's build date on the dateline of a published day, in UTC, and never on the invented day", () => {
    // 00:13 UTC is still the day before in Arizona: the date is the UTC one, by the working's own formatter.
    const late = { builtAt: "2026-10-03T00:13:00+00:00", requests: 12 };
    expect(datelineWithReading("Tiny Fest · Saturday · published timetable", late, false)).toBe(
      "Tiny Fest, Saturday · published timetable · saved Qloo reading built 3 Oct 2026",
    );
    expect(datelineWithReading("Tiny Fest · Saturday · published timetable", null, false)).toBe("Tiny Fest, Saturday · published timetable");
    const dateline = (html: string) =>
      text(/<p class="text-\[0\.8125rem\] leading-5 font-semibold text-muted-foreground">([^<]*)<\/p>/.exec(html)?.[1] ?? "");
    const published = renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), saved: late }));
    expect(dateline(published)).toBe("Tiny Fest, Saturday · published timetable · saved Qloo reading built 3 Oct 2026");
    // The working keeps the full line with the count.
    expect(text(working(published).region)).toContain("Saved Qloo reading of this day: built 3 Oct 2026 from 12 saved Qloo responses.");
    expect(dateline(renderToStaticMarkup(createElement(DecisionCard, { copy: copy() })))).toBe("Tiny Fest, Saturday · published timetable");
    const invented = renderToStaticMarkup(createElement(DecisionCard, { copy: copy({}, tinyPreset({ synthetic: true })), saved: late }));
    expect(dateline(invented)).toMatch(/^Invented day/);
    expect(text(invented)).not.toMatch(/qloo/i);
  });

  it("offers the re-check only while the server answers live pair checks and the page passes the drawer's opener", () => {
    const onOpenPair = vi.fn();
    const render = (props: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), saved, ...props }));
    pairCheck.enabled = false;
    expect(text(render({ onOpenPair }))).not.toContain(RECHECK_PAIR);
    pairCheck.enabled = true;
    expect(text(render({}))).not.toContain(RECHECK_PAIR);
    const on = render({ onOpenPair });
    expect(RECHECK_PAIR).toBe("Re-check this pair with Qloo (3 requests)");
    expect(text(working(on).region)).toContain(RECHECK_PAIR);
    expect(on).toMatch(/<button[^>]*data-variant="ruled"[^>]*>Re-check this pair with Qloo \(3 requests\)<svg/);
    // Never on the invented day.
    const invented = renderToStaticMarkup(
      createElement(DecisionCard, { copy: copy({}, tinyPreset({ synthetic: true })), onOpenPair }),
    );
    expect(text(invented)).not.toContain(RECHECK_PAIR);
    // The card sends nothing: rendering it called nothing.
    expect(onOpenPair).not.toHaveBeenCalled();
  });

  it("only opens the pair's drawer, with the button as the place to return to", () => {
    const onOpenPair = vi.fn();
    const element = PairRecheck({ onOpenPair }) as unknown as {
      props: { onClick: (event: { currentTarget: unknown }) => void };
    };
    const trigger = { tagName: "BUTTON" };
    element.props.onClick({ currentTarget: trigger });
    expect(onOpenPair).toHaveBeenCalledTimes(1);
    expect(onOpenPair).toHaveBeenCalledWith(trigger);
  });
});

describe("the side-by-side comparison in the card", () => {
  const ONE_SET_FIX = {
    sets_moved: 1,
    minutes_moved: 60,
    stage_changes: 0,
    budget_after: 99.1,
    stage_fit_flags_now: 1,
    stage_fit_flags_after: 2,
    minutes_shared_after: 0,
    costliest_after: { a: "Cy Twombly", b: "Di Vine", minutes: 30, points: 9.5 },
    moves: [TWO_SET_FIX.moves[0]],
  };
  function comparedCopy() {
    return copy({
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
        stage_fit_flags_now: 1,
        stage_fit_flags_after: 1,
        costliest_after: { a: "Ed Sheeran-ish", b: "Fay Wray", minutes: 45, points: 1.2 },
      },
      rule: { ...RULE, fixes_found: 1, fixes: [ONE_SET_FIX] },
    });
  }
  function compared(kept?: { move: boolean; change: boolean }) {
    return renderToStaticMarkup(createElement(DecisionCard, { copy: comparedCopy(), kept }));
  }
  /** The full table, as the brief prints it: the card's compact table leaves rows and notes to it. */
  function fullTable() {
    const tradeoff = comparedCopy().tradeoff;
    if (!tradeoff) throw new Error("no tradeoff");
    return renderToStaticMarkup(createElement(TradeoffTable, { tradeoff }));
  }
  const NOTE = "Weigh this reading; once you keep a change, the plan receipt below is what your plan does.";

  it("sits under the buttons and above the four lines, with both columns and the card's rows", () => {
    const html = compared();
    const plain = text(html);
    const order = [
      "Tiny Fest, Saturday · published timetable",
      "The two changes side by side",
      "Move one set Keep the two apart",
      "Sets moved",
      "Start-time minutes moved",
      "Time the pair shares, before → after",
      "Ends the overlap",
      "Clash Budget Index, before → after",
      "How this was chosen",
    ].map((part) => plain.indexOf(part));
    order.forEach((at, i) => {
      expect(at, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    expect(plain).toContain("104.2 → 98.4");
    expect(plain).toContain("104.2 → 99.1");
    // The pair's minutes before and after each change, and a yes or no for whether each ends the overlap.
    expect(plain).toMatch(/Time the pair shares, before → after \d+ → 0 minutes \d+ → 0 minutes/);
    expect(plain).toMatch(/Ends the overlap Yes Yes/);
    // The card's table is the compact one: stage fit and the costliest clash after are not rows...
    expect(plain).not.toContain("Stage-fit flags, now → after");
    expect(plain).not.toContain("Costliest clash after");
    expect(plain).not.toContain(STAGE_FIT_GLOSS);
    // ...but one sentence under the table still says what each change leads to, from the same figures,
    // with no walk through unchanged flag counts.
    const consequence =
      "Move one set: the costliest clash after is Ed Sheeran-ish and Fay Wray, 45 minutes, 1.2 index points; " +
      "keep the two apart: adds 1 stage-fit flag, then the costliest clash is Cy Twombly and Di Vine, 30 minutes, 9.5 index points.";
    expect(plain).toContain(consequence);
    expect(plain.indexOf(consequence)).toBeGreaterThan(plain.indexOf("Clash Budget Index, before → after"));
    expect(plain.indexOf(consequence)).toBeLessThan(plain.indexOf("How this was chosen"));
    // The brief's full table prints the rows, not the sentence.
    expect(text(fullTable())).not.toContain(consequence);
  });

  it("leaves Keep this move as the one action in view and opens on the other actions, above the comparison", () => {
    const readings = createElement("p", null, "Taste moves this pair from #3 to #1.");
    const html = renderToStaticMarkup(
      createElement(DecisionCard, {
        copy: comparedCopy(),
        onOpenMove: () => {},
        onTryRule: () => {},
        onKeepChange: () => {},
        readings,
      }),
    );
    const { region, outside } = working(html);
    expect(region).not.toBe("");
    const inside = text(region);
    for (const part of ["Try this rule yourself", "Keep the single-set change", comparedCopy().changeSummary ?? "never"]) {
      expect(inside, part).toContain(part);
      // Under the table and its consequence line, before the lines of how this was chosen.
      expect(inside.indexOf(part), part).toBeGreaterThan(inside.indexOf("Sets moved"));
      expect(inside.indexOf(part), part).toBeLessThan(inside.indexOf("How this was chosen"));
    }
    // Outside the working only "Keep this move" is left to press, beside the toggle that opens it. The
    // pointer to the three readings stays in view, above the actions, in the tucked state too.
    const open = outside;
    expect(text(open)).toContain("Keep this move");
    expect(text(open)).not.toContain("Try this rule yourself");
    expect(text(open)).toContain("Taste moves this pair");
    expect(inside).not.toContain("Taste moves this pair");
    expect(text(open).indexOf("Taste moves this pair")).toBeLessThan(text(open).lastIndexOf("Keep this move"));
    // Three buttons in the markup: "Keep this move" under the reading (below 1024 px), the action row's
    // copy (from 1024 px), the toggle; two are displayed at any width.
    expect(open.match(/<button/g)).toHaveLength(3);
    expect(open.match(/>Keep this move<\/button>/g)).toHaveLength(2);
    expect(open).toMatch(/<button type="button"[^>]*aria-expanded="false"[^>]*><svg[\s\S]*?<\/svg><span>Show the working<\/span>/);
    // "{ATTRIBUTION}. A reading, not a verdict." stays in view in this tucked state as well.
    expect(text(open)).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
    expect(inside).not.toContain("A reading, not a verdict");
    // The keep button is still described by line 3 and by its summary, and both ids are in the markup.
    const ids = /aria-describedby="([^"]+)"/.exec(html)?.[1]?.split(" ") ?? [];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
  });

  it("states the consequence with what the route sent, and when no priced clash is left", () => {
    const tradeoff = comparedCopy().tradeoff;
    if (!tradeoff) throw new Error("no tradeoff");
    const rows = tradeoff.rows;
    const only = (ids: string[]) => ({ ...tradeoff, rows: rows.filter((row) => !["flags", "costliest"].includes(row.id) || ids.includes(row.id)) });
    expect(consequenceLine(only([]))).toBeNull();
    // No walk through flag counts ("go 1 → 1"): only a change that adds flags says so.
    expect(consequenceLine(only(["flags"]))).toBe("Keep the two apart: adds 1 stage-fit flag.");
    const noneAdded = {
      ...tradeoff,
      rows: rows.filter((row) => row.id !== "costliest").map((row) => (row.id === "flags" ? { ...row, rule: "2 → 2" } : row)),
    };
    expect(consequenceLine(noneAdded)).toBeNull();
    const moveAdds = { ...tradeoff, rows: rows.map((row) => (row.id === "flags" ? { ...row, move: "0 → 3", rule: "1 → 1" } : row)) };
    expect(consequenceLine(moveAdds)).toBe(
      "Move one set: adds 3 stage-fit flags, then the costliest clash is Ed Sheeran-ish and Fay Wray, 45 minutes, 1.2 index points; keep the two apart: the costliest clash after is Cy Twombly and Di Vine, 30 minutes, 9.5 index points.",
    );
    for (const variant of [tradeoff, moveAdds, noneAdded]) expect(consequenceLine(variant) ?? "").not.toMatch(/flags go/);
    const cleared = {
      ...tradeoff,
      rows: rows.map((row) => (row.id === "costliest" ? { ...row, move: NO_PRICED_CLASH } : row)).filter((row) => row.id !== "flags"),
    };
    expect(consequenceLine(cleared)).toBe(
      "Move one set: no priced clash is left on this day; keep the two apart: the costliest clash after is Cy Twombly and Di Vine, 30 minutes, 9.5 index points.",
    );
    // The same clash left after both changes is named once.
    const same = {
      ...tradeoff,
      rows: rows.map((row) => (row.id === "costliest" ? { ...row, rule: row.move } : row)),
    };
    expect(consequenceLine(same)).toBe(
      "Keep the two apart: adds 1 stage-fit flag; either way the costliest clash after is Ed Sheeran-ish and Fay Wray, 45 minutes, 1.2 index points.",
    );
    const none = {
      ...tradeoff,
      rows: rows.map((row) => (row.id === "costliest" ? { ...row, move: NO_PRICED_CLASH, rule: NO_PRICED_CLASH } : row)),
    };
    expect(consequenceLine(none)).toBe(
      "Keep the two apart: adds 1 stage-fit flag; either way no priced clash is left on this day.",
    );
  });

  it("prints every row, the notes and the footnote in the full table the brief uses", () => {
    const plain = text(fullTable());
    const order = [
      "Clash Budget Index, before → after",
      "Selected and scored by this app’s index",
      "Stage-fit flags, now → after",
      "Costliest clash after",
      NOTE,
    ].map((part) => plain.indexOf(part));
    order.forEach((at, i) => {
      expect(at, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    expect(plain).toContain("1 → 1");
    expect(plain).toContain("1 → 2");
    expect(plain).toContain("Ed Sheeran-ish and Fay Wray, 45 minutes, 1.2 index points");
    expect(plain).toContain("Cy Twombly and Di Vine, 30 minutes, 9.5 index points");
    expect(plain).toContain(STAGE_FIT_GLOSS);
  });

  it("says what each column is, under the heading, on a phone too, and leaves the footnote to the brief", () => {
    const html = compared();
    const plain = text(html);
    const subtitle =
      "Each change tested alone on the published day: the first column is the single move with the lowest index; the second is the smallest change this search found that ends the overlap.";
    expect(plain.indexOf(subtitle)).toBeGreaterThan(plain.indexOf("The two changes side by side"));
    expect(plain.indexOf(subtitle)).toBeLessThan(plain.indexOf("Move one set Keep the two apart"));
    expect(plain).not.toContain(NOTE);
    // The subtitle is not in the collapsed disclosure: no `hidden` or `max-sm:hidden` class on its paragraph.
    const paragraph = html.slice(html.lastIndexOf("<p", html.indexOf(subtitle.slice(0, 30))), html.indexOf(subtitle.slice(0, 30)));
    expect(paragraph).not.toMatch(/hidden/);
  });

  it("keeps the attribution by the headline index, not under the index row, and stacks every row on a phone", () => {
    const html = compared();
    // The card states the attribution once, beside the headline figure; the compact row has no note.
    expect(text(html)).toMatch(/104\.2 → 98\.4 .*Selected and scored by this app’s index/);
    expect(html).not.toMatch(/Clash Budget Index, before → after[\s\S]*?Selected and scored by this app’s index[\s\S]*?<\/tbody>/);
    // A phone stacks it: the table is a block, each cell carries its column's name, and nothing is fixed wide.
    expect(html).toMatch(/<table[^>]*class="[^"]*\bblock\b[^"]*sm:table[^"]*"/);
    expect(html).toContain('data-label="Move one set"');
    expect(html).toContain('data-label="Keep the two apart"');
    expect(html).not.toMatch(/\bw-\[\d+px\]|min-w-\[|overflow-x/);
    // Real table semantics for a screen reader: column and row headers.
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });

  it("sits in the one closed 'Show the working' disclosure, under the table's own visible heading", () => {
    const tradeoff = comparedCopy().tradeoff;
    if (!tradeoff) throw new Error("no tradeoff");
    const html = compared();
    expect(html).not.toContain("<details");
    const { region: inside, toggle } = working(html);
    // The title alone: no subtitle naming what it holds.
    expect(realText(toggle)).toBe("Show the working");
    expect(inside).toMatch(/^<div [^>]*hidden=""/);
    // Inside, the two subheads in order: the table's own heading, shown once, then how this was chosen.
    const heading = new RegExp(`<h3[^>]*>${tradeoff.heading}</h3>`).exec(inside)?.[0] ?? "";
    expect(heading).not.toBe("");
    expect(heading).not.toMatch(/sr-only/);
    expect(inside.split(tradeoff.heading)).toHaveLength(2);
    expect(inside.indexOf(tradeoff.heading)).toBeLessThan(inside.indexOf("How this was chosen</h3>"));
    const bareHtml = renderToStaticMarkup(createElement(DecisionCard, { copy: copy({ rule: RULE_RAW }) }));
    expect(realText(working(bareHtml).toggle)).toBe("Show the working");
  });

  it("says which column the plan already holds", () => {
    expect(text(compared())).not.toContain("In your plan");
    expect(text(compared({ move: true, change: false }))).toContain("Move one set · In your plan");
    expect(text(compared({ move: false, change: true }))).toContain("Keep the two apart · In your plan");
  });

  it("is left out when the card has no change to compare the move with", () => {
    const plain = text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy({ rule: null }) })));
    expect(plain).not.toContain("The two changes side by side");
    expect(plain).not.toContain("Move one set Keep the two apart");
  });
});

describe("why this move and not a bigger gain", () => {
  it("says in the working, beside line 2, that the move is chosen by clash, not by gain, and only with a move", () => {
    expect(MOVE_CHOICE_LINE).toBe(
      "Chosen by clash, not by gain: the lowest-index single move for the day’s costliest clash that has one. A move for another clash can lower the index more; Try a move scores the legal places of other sets.",
    );
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy(), onOpenMove: () => null }));
    const { region, outside } = working(html);
    expect(text(region)).toContain(MOVE_CHOICE_LINE);
    expect(text(region).indexOf(MOVE_CHOICE_LINE)).toBeGreaterThan(text(region).indexOf(copy().moveLine));
    expect(text(outside)).not.toContain("Chosen by clash");
    const none = renderToStaticMarkup(createElement(DecisionCard, { copy: copy({ move: null }) }));
    expect(text(none)).not.toContain("Chosen by clash");
    expect(MOVE_CHOICE_LINE).not.toMatch(/best|optimal|beats|predicts|proves/i);
  });
});

describe("KeepApart", () => {
  it("renders the form with both selects and a Find changes button, and no result before a search", () => {
    const html = renderToStaticMarkup(createElement(KeepApart, { preset: parsePreset(rawTinyPreset()), day: 0 }));
    const plain = text(html);
    expect(plain).toContain("Keep two sets apart");
    expect(plain).toContain(
      "Choose two overlapping sets. Find the moves that end the overlap without breaking a rule.",
    );
    expect(plain).not.toMatch(/every (place|swap)|keeps all rules/);
    expect(plain).toContain("First set");
    expect(plain).toContain("Second set");
    expect(plain).toContain("(locked)");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Find changes that end this overlap<\/button>/);
    expect(plain).not.toContain("Smallest changes first");
  });
});

describe("a listed change row", () => {
  const rule = parseRuleFixes(RULE_RAW)!;

  function row(props: Record<string, unknown> = {}) {
    return text(
      renderToStaticMarkup(
        createElement(ChangeCard, {
          fix: rule.fixes[0],
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
          ...props,
        }),
      ),
    );
  }

  it("shows the note that the plan already moves a set, and the gloss only beside a stage-fit flag", () => {
    const plain = row({ note: plannedNote(rule, rule.fixes[0], new Set(["ann"])) });
    expect(plain).toContain(
      "Found on the published day; your plan already moves Ann Arbor, so the index with your plan applied is what counts.",
    );
    expect(plain).toContain("Keep this change");
    expect(plain).not.toContain("A stage-fit flag marks");
    expect(row()).not.toContain("Found on the published day");
    const flagged = row({ fix: { ...rule.fixes[0], flagsNow: 0, flagsAfter: 2 } });
    expect(flagged).toContain("Adds 2 stage-fit flags");
    expect(flagged).toContain(STAGE_FIT_GLOSS);
  });

  it("says a kept change is kept, and keeps its button pressable so a repeat press can answer", () => {
    const html = renderToStaticMarkup(
      createElement(ChangeCard, {
        fix: rule.fixes[0],
        n: 1,
        before: 104.2,
        dayLabel: () => null,
        pressed: false,
        keepState: "kept",
        roomText: null,
        note: null,
        onPreview: () => {},
        onKeep: () => {},
        buttonRef: () => {},
      }),
    );
    expect(text(html)).toContain("Kept in your plan");
    const button = html.slice(html.lastIndexOf("<button", html.indexOf("Kept in your plan")), html.indexOf("Kept in your plan"));
    expect(button).not.toContain(`disabled=""`);
  });

  it("disables the button only when the plan has no room, and says why", () => {
    const html = renderToStaticMarkup(
      createElement(ChangeCard, {
        fix: rule.fixes[0],
        n: 1,
        before: 104.2,
        dayLabel: () => null,
        pressed: false,
        keepState: "full",
        roomText: "Your plan holds 8 moves, the most it can. Undo one or start over.",
        note: null,
        onPreview: () => {},
        onKeep: () => {},
        buttonRef: () => {},
      }),
    );
    expect(html).toContain(`disabled=""`);
    expect(text(html)).toContain("Your plan holds 8 moves");
  });
});

describe("the hero", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/art");
    vi.resetModules();
  });

  async function hero(enabled: boolean): Promise<string> {
    vi.resetModules();
    const real = await vi.importActual<typeof import("@/lib/art")>("@/lib/art");
    vi.doMock("@/lib/art", () => ({
      ...real,
      artSlot: (name: keyof typeof real.ART) => (enabled ? { ...real.ART[name], enabled: true } : null),
    }));
    const { ClashControlFallback } = await import("./clash-control");
    const { summarize } = await import("@/lib/server-summary");
    return renderToStaticMarkup(
      createElement(ClashControlFallback, { intro: null, summary: summarize(parsePreset(rawTinyPreset())) }),
    );
  }

  it("fills the pitch column with the stat sentence, not image slot 1, even once art.ts enables it", async () => {
    expect(await hero(false)).not.toContain("hero-site-plan");
    expect(await hero(true)).not.toContain("hero-site-plan");
    const { ClashControlFallback } = await import("./clash-control");
    const html = renderToStaticMarkup(
      createElement(ClashControlFallback, { intro: createElement("h1", null, "Pitch"), stats: createElement("p", null, "Strip") }),
    );
    // Below 1024 px the page reads in source order, pitch, card, action, stat sentence, note, so a phone's
    // first screen shows the clash itself before the paste. From 1024 px the grid's areas set the two
    // columns; the pitch column is top-aligned with no hole: pitch, action, stat sentence 40 px under it,
    // note, then a flexible last row that takes the card's spare height.
    expect(html).toMatch(/<div class="min-w-0 \[grid-area:stats\] lg:mt-10"><p>Strip<\/p><\/div>/);
    expect(html).toMatch(/\[grid-template-areas:(&#x27;|')pitch\1_\1card\1_\1actions\1_\1stats\1_\1note\1\]/);
    // The paste action is rendered twice in the actions area, so the order seen is the tab order at every
    // width: once before the card, display:none below 1024 px, and once directly after it, display:none from
    // 1024 px. Exactly one copy is shown at any width; neither is hidden by sr-only, visibility, opacity,
    // aria-hidden or an order class.
    const paste = await hero(false);
    const copies = [...paste.matchAll(/<div class="min-w-0 \[grid-area:actions\] ([^"]*)">/g)].map((m) => m[1]);
    expect(copies).toEqual(["max-lg:hidden", "lg:hidden"]);
    const at = (needle: string, from = 0) => paste.indexOf(needle, from);
    const first = at("[grid-area:actions] max-lg:hidden");
    const second = at("[grid-area:actions] lg:hidden");
    expect(at("grid-area:pitch")).toBeLessThan(first);
    expect(first).toBeLessThan(at("grid-area:card"));
    expect(at("grid-area:card")).toBeLessThan(second);
    // (This render has no stat sentence, so the note follows the second copy.)
    expect(second).toBeLessThan(at("grid-area:note"));
    expect(paste.match(/>Paste your own draft grid</g)).toHaveLength(2);
    for (const part of [paste.slice(first, at("grid-area:card")), paste.slice(second, at("grid-area:note"))]) {
      expect(part).toMatch(/<a[^>]*href="\/check"[^>]*>Paste your own draft grid<svg/);
      for (const [, cls] of part.matchAll(/class="([^"]*)"/g)) {
        expect(cls).not.toMatch(/(?:^|\s)(?:sr-only|invisible|opacity-0|-?order-\d+)(?:\s|$)/);
      }
      expect(part).not.toMatch(/<(div|a|p)[^>]*aria-hidden="true"/);
    }
    expect(html).toMatch(/lg:grid-rows-\[auto_auto_auto_auto_1fr\]/);
    expect(html).toMatch(/lg:\[grid-template-areas:(&#x27;|')pitch_card\1_\1actions_card\1_\1stats_card\1_\1note_card\1_\1\._card\1\]/);
    // The section's 40 px foot, at every width, is the gap between the card and the jump nav, with no rule.
    expect(html).toMatch(/<div class="container-page pt-6 pb-10 sm:pt-8 lg:pt-10">/);
    // Open sections are parted by space, not rules: the timetable frame has no top rule.
    expect(html).toMatch(/<section aria-label="Timetable"><div class="container-page py-16 lg:py-20/);
    expect(html).not.toMatch(/<section[^>]*class="[^"]*border-t/);
    // The note is one 14 px muted paragraph across the column from 1024 px.
    expect(html).toMatch(/<p class="max-w-\[32rem\] text-sm leading-relaxed text-muted-foreground lg:max-w-none \[grid-area:note\]/);
    expect(html).toMatch(/class="grid [^"]*items-start/);
    const order = ["grid-area:pitch", "grid-area:actions", "grid-area:card", "grid-area:stats", "grid-area:note"].map((a) => html.indexOf(a));
    order.forEach((at, i) => {
      expect(at, `area ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    expect(text(html).indexOf("Pitch")).toBeLessThan(text(html).indexOf("Strip"));
  });

  it("offers the /check paste as the outline secondary button, with what it costs and what leaves the browser", async () => {
    const html = await hero(false);
    const plain = text(html);
    expect(plain).toContain("Paste your own draft grid");
    expect(plain).toContain("About a minute. Nothing leaves your browser unless you ask to compare audiences.");
    // The secondary button: outline (a 1.5 px ink edge, no fill), 44 px (the default size, the same height as
    // "Keep this move"), with a trailing arrow and no fill, so the card's "Keep this move" stays the one solid button.
    expect(html).toMatch(/<a(?=[^>]*data-variant="outline")(?=[^>]*data-size="default")(?=[^>]*href="\/check")[^>]*>Paste your own draft grid<svg/);
    expect(html).not.toMatch(/<a(?=[^>]*data-variant="(default|ruled|soft)")(?=[^>]*href="\/check")/);
  });
});
