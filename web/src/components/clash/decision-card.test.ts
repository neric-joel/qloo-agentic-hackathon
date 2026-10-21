import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LABEL_META } from "@/lib/clashes";
import { buildDecisionCopy, NO_PRICED_CLASH, parseDecision, sharedTimeline } from "@/lib/decision";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";
import { parseRuleFixes, plannedNote, STAGE_FIT_GLOSS } from "@/lib/rule-fix";

import {
  builtDate,
  datelineWithReading,
  DecisionDetails,
  hiddenClashLine,
  INDEX_SCALE,
  IndexChange,
  indexDelta,
  isHiddenDecision,
  isInventedDecision,
  KEEP_MOVE,
  MOVE_CHOICE_LINE,
  PairRecheck,
  RECHECK_PAIR,
  savedReadingLine,
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

describe("DecisionDetails, the index card under the hero", () => {
  it("leads with the index and its one paragraph, then the hidden-clash line, the working toggle, and only then rows 1 to 3 with the rule check beside row 3", () => {
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() }));
    const plain = text(html);
    const order = [
      "Clash Budget Index",
      "Derived",
      "104.2 → 98.4",
      "Selected and scored by this app’s index. A reading, not a verdict.",
      "A hidden clash",
      "Show the working",
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
    // The move, its readout and the heading the plan card scrolls back to are the hero's, never the card's.
    expect(html).not.toContain('id="decision-heading"');
    expect(plain).not.toContain("Bo Diddly Squat 60 minutes later");
    expect(html).toContain('aria-hidden="true"');
    // No kicker: the index label is a 13 px semibold sentence-case line, like the disclosure's subhead.
    expect(html).not.toContain("type-kicker");
    expect(html).toMatch(/<p class="text-\[0\.8125rem\] leading-5 font-semibold text-muted-foreground">Clash Budget Index<\/p>/);
    expect(html).toMatch(/<h3 class="text-\[0\.8125rem\] leading-5 font-semibold[^"]*">How this was chosen<\/h3>/);
    // The index label is followed by the Derived stamp: this app calculates the index.
    expect(html).toMatch(/>Clash Budget Index<\/p><span[^>]*data-provenance="derived"/);
  });

  it("draws the final frame in the server HTML: no hero receipt, no card entrance, no count-up", () => {
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), onTryRule: () => null }));
    expect(html).not.toMatch(/cc-hero-(slot|band|mark)|cc-overlap-band|cc-card-enter|cc-card-body/);
    // The figure is the reading after the move from the start; no number in between.
    expect(text(html)).toContain("104.2 → 98.4");
  });

  it("prints no three-rank line and no pointer to the readings: the section's heading and ladder carry them", () => {
    const plain = text(renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), onTryRule: () => {} })));
    expect(plain).not.toMatch(/Time alone ranks this pair|time and draw \(Qloo popularity\)|See what Qloo changes/);
    expect(plain).not.toContain("data-why-lines");
  });

  it("is one card: the card fill, a hairline surface edge, the 14 px panel corner and 20 / 24 px of padding", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionDetails, { copy: copy(), onTryRule: () => {}, onOpenHidden: () => {} }),
    );
    const frame = /^<div data-decision-details="" class="([^"]*)">/.exec(html)?.[1] ?? "";
    expect(frame.split(" ")).toEqual(
      expect.arrayContaining(["rounded-xl", "border", "border-surface-edge", "bg-card", "p-5", "lg:p-6"]),
    );
    // No shadow, no glass, no alpha colours; no square corner and no capsule.
    expect(html).not.toMatch(/shadow|backdrop-blur|color-mix|\b(bg|border|text|fill|stroke)-[a-z-]+\/(\[|\d)/);
    expect(html).not.toMatch(/rounded-(none|full|\[)/);
  });

  it("keeps rows 1 to 3 and the rule check in a closed disclosure, and the attribution and its limit in one caption outside it", () => {
    const card = copy();
    const limits = card.limitsLine ?? "never";
    expect(card.limitsLine).toBe("Checked against the timetable’s rules; its index is shown for information.");
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: card }));
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
    // The 10 px control corner and 8 px sides pulled back by 8 px, so the focus ring is a rounded box inside the card.
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
    expect(html.indexOf("Selected and scored")).toBeLessThan(html.indexOf("data-working"));
    // No visible text points at a row the reader cannot see.
    const plain = text(html);
    expect(plain).not.toMatch(/Lines 1 and 2|Line 4/);
    // The rows' "Line n" labels are for screen readers only; the visible text names no line at all.
    const visible = realText(html.replace(/<span class="sr-only">[^<]*<\/span>/g, ""));
    expect(visible).not.toMatch(/Line \d|Lines \d/);
    // The rows' numbers are the text face with tabular figures: monospace is retired.
    expect(html).not.toContain("font-mono");
  });

  it("reads the published times back from the decision's own timeline, so nothing computes them anew", () => {
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
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() }));
    const plain = text(html);
    const label = plain.indexOf("Clash Budget Index");
    expect(label).toBeGreaterThan(-1);
    expect(plain.indexOf("104.2 → 98.4")).toBeGreaterThan(label);
    expect(plain.indexOf("Selected and scored by this app’s index")).toBeGreaterThan(plain.indexOf("104.2 → 98.4"));
  });

  it("has no buttons the page cannot act on, shows each only with its handler and its seed, and leaves Keep this move to the hero", () => {
    expect(text(renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() })))).not.toMatch(
      /Try this rule yourself|Open a hidden clash|Keep the/,
    );
    const withHandlers = text(
      renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), onTryRule: () => {}, onOpenHidden: () => {} })),
    );
    expect(withHandlers).toContain("Try this rule yourself");
    expect(withHandlers).toContain("Open a hidden clash");
    // The one filled action, "Keep this move", is the hero's: the card holds no copy of it.
    expect(KEEP_MOVE).toBe("Keep this move");
    expect(withHandlers).not.toContain("Keep this move");
    // "Open a hidden clash" is a ruled line of type with its arrow, among the secondary actions under the
    // working, outside it: no click on "Show the working" is needed to reach it.
    const hiddenHtml = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), onOpenHidden: () => {} }));
    expect(hiddenHtml).toMatch(/<button[^>]*data-variant="ruled"[^>]*>Open a hidden clash<svg/);
    const hiddenParts = working(hiddenHtml);
    expect(text(hiddenParts.region)).not.toContain("Open a hidden clash");
    expect(text(hiddenParts.outside)).toContain("Open a hidden clash");
    expect(hiddenHtml.indexOf("Open a hidden clash")).toBeGreaterThan(hiddenHtml.indexOf("data-working"));
    // Nothing carries an order class, so the tab order is the order seen at every width.
    const ORDER = /(?:^|\s)(?:[a-z-]+:)*-?order-\d/;
    const ordered = [...hiddenHtml.matchAll(/<[a-z0-9]+\b[^>]*\bclass="([^"]*)"[^>]*>/g)].filter((m) => ORDER.test(m[1])).map((m) => m[0]);
    expect(ordered).toHaveLength(0);
    // Source order: the index block (its attribution last), the hidden-clash line, the toggle, the working,
    // then the secondary actions.
    const at = (needle: string) => hiddenHtml.indexOf(needle);
    expect(at("data-index-block")).toBeLessThan(at("data-hidden-line"));
    expect(at("data-hidden-line")).toBeLessThan(at("aria-expanded"));
    expect(at("aria-expanded")).toBeLessThan(at("data-working"));
    expect(at("data-working")).toBeLessThan(at("data-decision-actions"));
    const block = /<div data-index-block=""[\s\S]*?A reading, not a verdict\.<\/p><\/div>/.exec(hiddenHtml)?.[0] ?? "";
    expect(text(block)).toMatch(/104\.2 → 98\.4[\s\S]*Selected and scored by this app’s index\. A reading, not a verdict\.$/);
    // No solid button here: the secondary actions are ruled text, and none is raspberry.
    const handlersHtml = renderToStaticMarkup(
      createElement(DecisionDetails, { copy: copy(), onTryRule: () => {}, onOpenHidden: () => {} }),
    );
    expect(handlersHtml).not.toMatch(/data-variant="(default|ink|outline|soft|link|destructive)"/);
    expect(handlersHtml).not.toMatch(/bg-primary/);
    expect(handlersHtml).toMatch(/<button[^>]*data-variant="ruled"[^>]*>Try this rule yourself</);
    expect(handlersHtml.indexOf("Try this rule yourself")).toBeLessThan(handlersHtml.indexOf("Open a hidden clash"));
    expect(handlersHtml).not.toMatch(/\bh-0\.5\b|border-t-2/);
    const noRule = text(
      renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({ rule: null }), onTryRule: () => {} })),
    );
    expect(noRule).not.toContain("Try this rule yourself");
    expect(noRule).not.toContain("Line 3");
    expect(noRule).not.toContain("Line 4");
    // With no rule row there is no rule-check sentence; the caption still states the limits, outside every
    // disclosure.
    expect(copy({ rule: null }).limitsLine).toBeNull();
    expect(noRule).not.toContain("Checked against the timetable’s rules");
    const noRuleOpen = text(
      working(renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({ rule: null }), onTryRule: () => {} }))).outside,
    );
    expect(noRuleOpen).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
  });

  it("titles the disclosure 'Show the working' with no subtitle, and holds line 3 only with a rule line", () => {
    const summaryOf = (html: string) => working(html).toggle;
    const withRule = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() }));
    expect(copy().ruleLine).toBeTruthy();
    expect(realText(summaryOf(withRule))).toBe("Show the working");
    expect(text(withRule)).toContain("Line 3");
    const noRuleCopy = copy({ rule: null });
    expect(noRuleCopy.ruleLine).toBeFalsy();
    const noRule = renderToStaticMarkup(createElement(DecisionDetails, { copy: noRuleCopy }));
    expect(realText(summaryOf(noRule))).toBe("Show the working");
    expect(text(noRule)).not.toContain("Line 3");
    expect(text(noRule)).toContain("How this was chosen");
    expect(text(withRule)).not.toMatch(/lines 1 to/);
  });

  it("says beside the index figure what its change is, from the same two readings, and 'Lower is better' once, in the paragraph", () => {
    const plain = text(renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() })));
    // 104.2 → 98.4: a fall of 5.8, with a real minus sign, then one paragraph: the scale, the attribution, the limit.
    expect(plain).toContain(
      "104.2 to 98.4. −5.8 index points A score, not money: 100 = the average random valid timetable of this lineup. Lower is better. Selected and scored by this app’s index. A reading, not a verdict.",
    );
    // Tabular figures for the change; "index points" in the same face, muted (monospace is retired).
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() }));
    expect(html).toContain(
      '<p class="text-[0.8125rem] leading-snug text-muted-foreground"><span class="tabular-nums">−5.8</span> index points</p>',
    );
    expect(indexDelta("104.2", "98.4")).toBe("−5.8 index points");
    expect(indexDelta("116.7", "114.3")).toBe("−2.4 index points");
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
    const shown = text(renderToStaticMarkup(createElement(DecisionDetails, { copy: withChange, onKeepChange: () => {} })));
    // The button says what it keeps, and a visible line under it says what the change is.
    expect(withChange.changeLabel).toBe("Keep the single-set change");
    expect(shown).toContain("Keep the single-set change");
    expect(shown).toContain(withChange.changeSummary ?? "never");
    expect(withChange.changeSummary).toBe(
      "To keep Ann Arbor and Bo Diddly Squat apart: Bo Diddly Squat to Side 21:30–23:00; index 104.2 → 98.4.",
    );
    expect(shown).not.toContain("Keep this change");
    const bare = text(renderToStaticMarkup(createElement(DecisionDetails, { copy: withChange })));
    expect(bare).not.toContain("Keep the single-set change");
    expect(bare).not.toContain("To keep Ann Arbor");
    // No listed change on line 3: no button, even with a handler.
    const none = text(renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), onKeepChange: () => {} })));
    expect(none).not.toContain("Keep the single-set change");
    expect(none).not.toContain("Keep the two-set change");
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: withChange, onKeepChange: () => {} }));
    // The button is described by line 3 and by the summary line, both in the markup.
    const ids = /aria-describedby="([^"]+)"/.exec(html)?.[1]?.split(" ") ?? [];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
  });

  it("names a two-set change in its label and marks the card once the plan holds it", () => {
    const two = copy({ rule: { ...RULE, fixes_found: 1, fixes: [TWO_SET_FIX] } });
    expect(two.changeLabel).toBe("Keep the two-set change");
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: two, onKeepChange: () => {} }));
    expect(text(html)).toContain("Keep the two-set change");
    expect(text(html)).not.toContain("In your plan");
    const kept = renderToStaticMarkup(
      createElement(DecisionDetails, { copy: two, onKeepChange: () => {}, kept: { move: false, change: true } }),
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
    // A quiet state, not a primary button: no fill, no underline, and the unkept one is ruled text.
    expect(button).toContain('data-variant="ruled"');
    expect(button).toContain("no-underline");
    expect(button).not.toContain('data-variant="default"');
    expect(html).toMatch(/<button[^>]*data-variant="ruled"[^>]*class="[^"]* underline [^"]*"[^>]*>Keep the two-set change/);
  });

  it("says so, with no figure and no move, when no place lowers the index", () => {
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({ move: null }) }));
    const plain = text(html);
    expect(plain).toContain("No legal place for either set lowers the index.");
    expect(plain).not.toContain("Keep this move");
    // No figure: no index label; the paragraph (scale, attribution, limit) still shows with no click.
    expect(plain).not.toContain("Clash Budget Index");
    expect(html).not.toContain("data-index-block");
    expect(text(working(html).outside)).toContain(`${INDEX_SCALE} Selected and scored by this app’s index. A reading, not a verdict.`);
    // The only drawing left is the toggle's chevron.
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toMatch(/<svg[^>]*lucide-chevron-right/);
    expect(html).not.toContain("type-kicker");
  });

  it("uses none of the words the round forbids", () => {
    const plain = text(renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() })));
    for (const pattern of [/optimi[sz]/i, /improve/i, /recommend/i, /validated/i, /proven/i, /predicts/i, /\bfix/i, /crowd/i, /headcount/i, /revenue/i, /significant/i]) {
      expect(plain).not.toMatch(pattern);
    }
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
    expect(html).not.toMatch(/bg-success|text-success|text-primary|rounded-bar|\btag\b|bg-muted|bg-ink|font-mono/);
    expect(html.match(/<p[ >]/g)).toHaveLength(2);
    // A rise says so in words too; no reading, no line.
    expect(text(renderToStaticMarkup(createElement(IndexChange, { before: 98.4, after: 99, range: null })))).toContain("+0.6 index points");
    expect(renderToStaticMarkup(createElement(IndexChange, { before: null, after: 99, range: null }))).toBe("");
  });
});

describe("the index scale in the card", () => {
  it("prints the scale, the attribution and the limit as one paragraph ending the index block, on a published and an invented day", () => {
    expect(INDEX_SCALE).toBe("A score, not money: 100 = the average random valid timetable of this lineup. Lower is better.");
    for (const preset of [tinyPreset(), tinyPreset({ synthetic: true })]) {
      const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({}, preset) }));
      const block = /<div data-index-block=""[\s\S]*?A reading, not a verdict\.<\/p><\/div>/.exec(html)?.[0] ?? "";
      expect(text(block)).toMatch(
        /index points A score, not money: 100 = the average random valid timetable of this lineup\. Lower is better\. Selected and scored by this app’s index\. A reading, not a verdict\.$/,
      );
      // The label, the figure with its change, then the one paragraph.
      expect(block.match(/<p[ >]/g)).toHaveLength(4);
      expect(text(working(html).outside)).toContain(INDEX_SCALE);
    }
  });

  it("calls the index Derived, and on the invented day never credits Qloo for it", () => {
    const published = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() }));
    expect(published).toMatch(/data-provenance="derived"[^>]*title="Calculated by this app from Qloo data\."|title="Calculated by this app from Qloo data\."[^>]*data-provenance="derived"/);
    const invented = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({}, tinyPreset({ synthetic: true })) }));
    expect(invented).toContain("Calculated by this app from invented figures.");
    expect(invented).not.toContain("Calculated by this app from Qloo data.");
  });

  it("says 'Lower is better' exactly once, and the attribution with its limit, in every state of the card", () => {
    const states = [
      renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() })),
      renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), onTryRule: () => null, kept: { move: false, change: false } })),
      renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), onTryRule: () => null, kept: { move: true, change: false } })),
      renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({ move: null }) })),
      renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({}, tinyPreset({ synthetic: true })) })),
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
  it("says the decision's own clash is a hidden clash, concretely, in ink, after the index and before the working, outside it", () => {
    const card = copy();
    expect(isHiddenDecision(card)).toBe(true);
    const taste = tasteOverlapOf(card);
    expect(taste).toMatch(/^\d{1,3}$/);
    const html = renderToStaticMarkup(
      createElement(DecisionDetails, { copy: card, hiddenCount: 4, genres: ["Garage Rock", "Folk Pop"] }),
    );
    const line = `A hidden clash, 1 of 4 on this day: main genres differ (Garage Rock, Folk Pop), yet their taste overlap ranks ${taste} of 100 on this bill.`;
    expect(text(working(html).outside)).toContain(line);
    const classes = /<p data-hidden-line="" class="([^"]*)">/.exec(html)?.[1] ?? "";
    expect(classes).not.toBe("");
    expect(classes).not.toMatch(/prov-qloo|text-primary|teal/);
    // After the index block, before the working.
    expect(html.indexOf("data-hidden-line")).toBeGreaterThan(html.indexOf("data-index-block"));
    expect(html.indexOf("data-hidden-line")).toBeLessThan(html.indexOf("data-working"));
    // No lift or complaint-share figure beside it: that counts a different population.
    expect(line).not.toMatch(/%|lift/);
  });

  it("keeps the board's definition, and drops the count without hiddenCount and the genres unless both are saved", () => {
    const card = copy();
    const taste = tasteOverlapOf(card);
    const bare = text(renderToStaticMarkup(createElement(DecisionDetails, { copy: card })));
    expect(bare).toContain(`A hidden clash: main genres differ, yet their taste overlap ranks ${taste} of 100 on this bill.`);
    expect(bare).not.toContain("1 of");
    // The printed rank says how high the overlap is, so "among the day’s highest" is said only without one.
    expect(bare).not.toContain("among the day’s highest");
    expect(hiddenClashLine({ count: 0, genres: ["Rock", null], taste: "88" })).toBe(
      "A hidden clash: main genres differ, yet their taste overlap ranks 88 of 100 on this bill.",
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
      createElement(DecisionDetails, { copy: card, hiddenCount: 5, rankedCount: 15, genres: ["Garage Rock", "Folk Pop"] }),
    );
    expect(text(working(html).outside)).toContain(
      `A hidden clash, 1 of 5 among the day’s 15 ranked clashes: main genres differ (Garage Rock, Folk Pop), yet their taste overlap ranks ${taste} of 100 on this bill.`,
    );
    expect(hiddenClashLine({ count: 5, ranked: 15, genres: null, taste: "97" })).toBe(
      "A hidden clash, 1 of 5 among the day’s 15 ranked clashes: main genres differ, yet their taste overlap ranks 97 of 100 on this bill.",
    );
    // The invented day says so, and names no source.
    expect(hiddenClashLine({ count: 2, ranked: 9, genres: null, taste: "70", invented: true })).toBe(
      "A hidden clash, 1 of 2 among the invented day’s 9 ranked clashes: main genres differ, yet their invented taste overlap ranks 70 of 100 on this bill.",
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
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: card, hiddenCount: 3 }));
    expect(text(html)).not.toContain("A hidden clash");
    expect(html).not.toContain("data-hidden-line");
  });

  it("says the day and the overlap are invented on the invented day, naming no source", () => {
    const card = copy({}, tinyPreset({ synthetic: true }));
    expect(isInventedDecision(card)).toBe(true);
    expect(isInventedDecision(copy())).toBe(false);
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: card, hiddenCount: 2, genres: ["Rock", "Jazz"] }));
    const line = /<p data-hidden-line=""[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? "";
    expect(line).toBe(
      `A hidden clash, 1 of 2 on this invented day: main genres differ (Rock, Jazz), yet their invented taste overlap ranks ${tasteOverlapOf(card)} of 100 on this bill.`,
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
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), saved }));
    const { region, outside } = working(html);
    expect(text(region)).toContain("Recorded Saved Qloo reading of this day: built 3 Oct 2026 from 12 saved Qloo responses.");
    expect(region).toMatch(/data-provenance="recorded"/);
    expect(text(outside)).not.toContain("Saved Qloo reading");
  });

  it("prints no saved reading without the prop, and none on the invented day even when passed", () => {
    expect(text(renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() })))).not.toContain("Saved Qloo reading");
    expect(text(renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), saved: null })))).not.toContain(
      "Saved Qloo reading",
    );
    const invented = renderToStaticMarkup(
      createElement(DecisionDetails, { copy: copy({}, tinyPreset({ synthetic: true })), saved }),
    );
    expect(text(invented)).not.toContain("Saved Qloo reading");
    expect(invented).not.toContain('data-provenance="recorded"');
  });

  it("dates a published day's saved reading in UTC, and never the invented day's", () => {
    // 00:13 UTC is still the day before in Arizona: the date is the UTC one, by the working's own formatter.
    const late = { builtAt: "2026-10-03T00:13:00+00:00", requests: 12 };
    expect(datelineWithReading("Tiny Fest · Saturday · published timetable", late, false)).toBe(
      "Tiny Fest, Saturday · published timetable · saved Qloo reading built 3 Oct 2026",
    );
    expect(datelineWithReading("Tiny Fest · Saturday · published timetable", null, false)).toBe("Tiny Fest, Saturday · published timetable");
    expect(datelineWithReading("Invented day · Saturday · invented timetable", late, true)).toBe("Invented day, Saturday · invented timetable");
    const published = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), saved: late }));
    // The working keeps the full line with the count; the hero's dateline carries the build date.
    expect(text(working(published).region)).toContain("Saved Qloo reading of this day: built 3 Oct 2026 from 12 saved Qloo responses.");
    const invented = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({}, tinyPreset({ synthetic: true })), saved: late }));
    expect(text(invented)).not.toMatch(/saved qloo/i);
  });

  it("gives every ruled text button the 10px control corner, which its focus ring follows, never the 6px label corner", () => {
    pairCheck.enabled = true;
    const html = renderToStaticMarkup(
      createElement(DecisionDetails, {
        copy: copy({ rule: { ...RULE, fixes_found: 1, fixes: [TWO_SET_FIX] } }),
        saved,
        onTryRule: () => {},
        onKeepChange: () => null,
        onOpenHidden: () => {},
        onOpenPair: () => {},
      }),
    );
    pairCheck.enabled = false;
    const ruled = [...html.matchAll(/<button[^>]*data-variant="ruled"[^>]*>/g)].map((m) => m[0]);
    // Try this rule yourself, Keep the two-set change, Open a hidden clash and the re-check.
    expect(ruled.length).toBeGreaterThanOrEqual(4);
    for (const button of ruled) {
      const classes = (/class="([^"]*)"/.exec(button)?.[1] ?? "").split(/\s+/);
      expect(classes, button).toContain("rounded-md");
      expect(classes, button).not.toContain("rounded-sm");
      expect(classes.filter((name) => /^rounded-/.test(name)), button).toEqual(["rounded-md"]);
    }
    const recheck = renderToStaticMarkup(createElement(PairRecheck, { onOpenPair: () => {} }));
    expect(/class="([^"]*)"/.exec(recheck)?.[1].split(/\s+/).filter((name) => /^rounded-/.test(name))).toEqual(["rounded-md"]);
  });

  it("offers the re-check only while the server answers live pair checks and the page passes the drawer's opener", () => {
    const onOpenPair = vi.fn();
    const render = (props: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(DecisionDetails, { copy: copy(), saved, ...props }));
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
      createElement(DecisionDetails, { copy: copy({}, tinyPreset({ synthetic: true })), onOpenPair }),
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

describe("the card's two parts in the section on what taste changes (round 35)", () => {
  const twoSet = () => copy({ rule: RULE_RAW });
  const props = {
    onTryRule: () => {},
    onKeepChange: () => null,
    onOpenHidden: () => {},
    hiddenCount: 5,
    rankedCount: 15,
  };
  const classOf = (html: string, pattern: RegExp) => pattern.exec(html)?.[1]?.split(/\s+/) ?? [];

  it("draws the whole card by default, with nothing shown or hidden by width", () => {
    const whole = renderToStaticMarkup(createElement(DecisionDetails, { copy: twoSet(), ...props }));
    const named = renderToStaticMarkup(createElement(DecisionDetails, { copy: twoSet(), ...props, part: "whole" }));
    expect(named).toBe(whole);
    expect(whole).not.toMatch(/\blg:(hidden|block|inline-flex)\b/);
    expect(whole).not.toContain("data-index-beside");
  });

  it("keeps the card's index block, scale, working and rule search at every width, and shows the two lines and their actions below 1024px only", () => {
    const card = renderToStaticMarkup(createElement(DecisionDetails, { copy: twoSet(), ...props, part: "card" }));
    const whole = renderToStaticMarkup(createElement(DecisionDetails, { copy: twoSet(), ...props }));
    // The same words in the same order as the whole card, below 1024px.
    const plain = text(card);
    expect(plain.replace(/Try this rule yourself /, "")).toBe(text(whole));
    // Below 1024px only: the hidden-clash line, the keep and open actions, the change line and the actions block.
    expect(classOf(card, /<p data-hidden-line="" class="([^"]*)">/)).toContain("lg:hidden");
    expect(classOf(card, /<button[^>]*class="([^"]*)"[^>]*>Keep the two-set change/)).toContain("lg:hidden");
    expect(classOf(card, /<button[^>]*class="([^"]*)"[^>]*>Open a hidden clash/)).toContain("lg:hidden");
    expect(classOf(card, /<p id="[^"]+" class="([^"]*)">To keep Ann Arbor/)).toContain("lg:hidden");
    expect(card).toMatch(/<div data-decision-actions="" class="mt-1 lg:hidden">/);
    // At every width: the index block and its one paragraph (scale, attribution, limit), and the working toggle.
    expect(card).toMatch(/<div data-index-block="">/);
    expect(classOf(card, /<p data-index-scale="" class="([^"]*)">/).join(" ")).not.toMatch(/hidden/);
    expect(text(working(card).outside)).toContain(
      `${INDEX_SCALE} Selected and scored by this app’s index. A reading, not a verdict.`,
    );
    // From 1024px the rule search sits on the working toggle's row, drawn once at each width.
    expect(card).toMatch(
      /<div class="mt-3 lg:flex lg:flex-wrap lg:items-center lg:gap-x-6"><button type="button" id="[^"]+" aria-expanded="false"[\s\S]*?<\/button><button[^>]*data-variant="ruled"[^>]*class="[^"]*\bhidden lg:inline-flex\b[^"]*"[^>]*>Try this rule yourself<svg/,
    );
    const tries = [...card.matchAll(/<button[^>]*class="([^"]*)"[^>]*>Try this rule yourself/g)].map((m) => m[1].split(/\s+/));
    expect(tries).toHaveLength(2);
    expect(tries.filter((cls) => cls.includes("lg:inline-flex") && cls.includes("hidden"))).toHaveLength(1);
    expect(tries.filter((cls) => cls.includes("lg:hidden"))).toHaveLength(1);
    // Still one card: the 14px panel corner, the hairline edge, and no figure moves out of it.
    expect(classOf(card, /^<div data-decision-details="" class="([^"]*)">/)).toEqual(
      expect.arrayContaining(["rounded-xl", "border", "border-surface-edge", "bg-card", "p-5", "lg:p-6"]),
    );
    expect(card).not.toContain("data-index-beside");
  });

  it("draws beside the card, from 1024px only, the hidden-clash line closed by its action and the change line closed by its keep button, and nothing else", () => {
    const decision = twoSet();
    const beside = renderToStaticMarkup(createElement(DecisionDetails, { copy: decision, ...props, part: "beside" }));
    expect(beside).toMatch(/^<div data-index-beside="" class="hidden space-y-4 lg:block">/);
    const plain = text(beside);
    const taste = tasteOverlapOf(decision);
    expect(plain).toContain(
      `A hidden clash, 1 of 5 among the day’s 15 ranked clashes: main genres differ, yet their taste overlap ranks ${taste} of 100 on this bill. Open a hidden clash`,
    );
    expect(plain).toContain(`${decision.changeSummary} Keep the two-set change`);
    expect(decision.changeSummary).toBe(
      "To keep Ann Arbor and Bo Diddly Squat apart: Bo Diddly Squat to Side 21:30–23:00 and Ann Arbor to Main 19:00–20:30; index 104.2 → 98.4.",
    );
    // The hidden-clash line first, in ink; then the change line in muted ink, its keep button described by it.
    expect(beside.indexOf("data-hidden-line")).toBeLessThan(beside.indexOf("data-change-line"));
    expect(classOf(beside, /<p data-hidden-line="" class="([^"]*)">/)).toEqual(["text-sm", "leading-snug"]);
    expect(classOf(beside, /<p data-change-line="" class="([^"]*)">/)).toEqual(["text-[0.8125rem]", "leading-snug", "text-muted-foreground"]);
    const described = /<span id="([^"]+)">To keep Ann Arbor/.exec(beside)?.[1] ?? "never";
    expect(beside).toMatch(new RegExp(`<button[^>]*aria-describedby="${described.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>Keep the two-set change`));
    // Nothing else of the card: no index, no scale, no working, no rule search, no chip.
    expect(beside).not.toMatch(/data-index-block|data-index-scale|data-working|aria-expanded|data-provenance|data-decision-details/);
    expect(plain).not.toMatch(/Clash Budget Index|Try this rule yourself|Show the working|Lower is better/);
    // Each action is the ruled line of type at the end of its sentence, at the sentence's size: no height of its own
    // past the line, and a 44px target from a hit area (14px above and below the line). Its box is the line, about
    // 20px tall, so it takes a text link's 6px corner: the 10px control corner would be half its height, a pill.
    // 4px of margin before it keeps its focus ring off the sentence's last word.
    const ruled = [...beside.matchAll(/<button[^>]*data-variant="ruled"[^>]*class="([^"]*)"/g)].map((m) => m[1].split(/\s+/));
    expect(ruled).toHaveLength(2);
    for (const cls of ruled) {
      expect(cls.filter((name) => /^rounded-/.test(name))).toEqual(["rounded-sm"]);
      expect(cls).not.toContain("rounded-md");
      expect(cls).toContain("ml-1");
      expect(cls).toEqual(
        expect.arrayContaining(["relative", "min-h-0", "text-[length:inherit]", "after:absolute", "after:-inset-y-3.5", "after:content-[&#x27;&#x27;]"]),
      );
      expect(cls).not.toContain("text-[0.9375rem]");
      expect(cls).not.toContain("min-h-11");
      // No padding that would grow the box past the line, and so the ring into the lines around it.
      expect(cls.filter((name) => /^-?(p|py|pt|pb|my|mt|mb)-/.test(name))).toEqual([]);
    }
    // Its own polite status, for what the keep button says when pressed here.
    expect(beside).toMatch(/<p role="status" aria-live="polite" class="sr-only"><\/p><\/div>$/);
  });

  it("keeps the kept state beside the card, and the day's clash on a line of its own when the card's pair is not hidden", () => {
    const kept = renderToStaticMarkup(
      createElement(DecisionDetails, { copy: twoSet(), ...props, kept: { move: false, change: true }, part: "beside" }),
    );
    expect(text(kept)).toMatch(/In your plan ?: the two-set change/);
    expect(text(kept)).not.toContain("Keep the two-set change");
    const keptButton = /<button[^>]*data-kept=""[^>]*>/.exec(kept)?.[0] ?? "";
    expect(keptButton).toContain('data-variant="ruled"');
    expect(keptButton).toMatch(/class="[^"]*\bno-underline\b/);
    // Not hidden: no hidden-clash line; the day's clash closes the part as a ruled line of its own.
    const plainCopy = copy({ rule: RULE_RAW }, tinyPreset({ label: null }));
    const beside = renderToStaticMarkup(
      createElement(DecisionDetails, { copy: plainCopy, ...props, hiddenLabel: "Open the costliest clash", part: "beside" }),
    );
    expect(beside).not.toContain("data-hidden-line");
    expect(text(beside).indexOf("Open the costliest clash")).toBeGreaterThan(text(beside).indexOf("Keep the two-set change"));
    expect(beside).toMatch(/<div><button[^>]*data-variant="ruled"[^>]*class="[^"]*\bmin-h-11\b[^"]*"[^>]*>Open the costliest clash<svg/);
    // And in the card that action shows below 1024px only too.
    const card = renderToStaticMarkup(
      createElement(DecisionDetails, { copy: plainCopy, ...props, hiddenLabel: "Open the costliest clash", part: "card" }),
    );
    expect(classOf(card, /<button[^>]*class="([^"]*)"[^>]*>Open the costliest clash/)).toContain("lg:hidden");
    // With neither line nor action, nothing is drawn beside the card.
    expect(renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({}, tinyPreset({ label: null })), part: "beside" }))).toBe("");
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
    return renderToStaticMarkup(createElement(DecisionDetails, { copy: comparedCopy(), kept }));
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
      "Clash Budget Index",
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

  it("puts the other actions under the working, outside it, with the comparison inside it, and no copy of Keep this move", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionDetails, {
        copy: comparedCopy(),
        onTryRule: () => {},
        onKeepChange: () => {},
      }),
    );
    const { region, outside } = working(html);
    expect(region).not.toBe("");
    const inside = text(region);
    // The comparison stays in the working, under its own heading.
    expect(inside).toContain("Sets moved");
    // The rule search and the keep button with what it keeps are in view with no click, after the working.
    for (const part of ["Try this rule yourself", "Keep the single-set change", comparedCopy().changeSummary ?? "never"]) {
      expect(text(outside), part).toContain(part);
      expect(inside, part).not.toContain(part);
      expect(html.indexOf(part), part).toBeGreaterThan(html.indexOf("data-working"));
    }
    // The one filled action is the hero's: here only ruled text and the toggle.
    expect(text(outside)).not.toContain("Keep this move");
    expect(outside.match(/<button/g)).toHaveLength(3);
    expect(outside).toMatch(/<button type="button"[^>]*aria-expanded="false"[^>]*><svg[\s\S]*?<\/svg><span>Show the working<\/span>/);
    // "{ATTRIBUTION}. A reading, not a verdict." stays in view in this state as well.
    expect(text(outside)).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
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
      "Move one set: no scored clash is left on this day; keep the two apart: the costliest clash after is Cy Twombly and Di Vine, 30 minutes, 9.5 index points.",
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
      "Keep the two apart: adds 1 stage-fit flag; either way no scored clash is left on this day.",
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
    const bareHtml = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({ rule: RULE_RAW }) }));
    expect(realText(working(bareHtml).toggle)).toBe("Show the working");
  });

  it("says which column the plan already holds", () => {
    expect(text(compared())).not.toContain("In your plan");
    expect(text(compared({ move: true, change: false }))).toContain("Move one set · In your plan");
    expect(text(compared({ move: false, change: true }))).toContain("Keep the two apart · In your plan");
  });

  it("is left out when the card has no change to compare the move with", () => {
    const plain = text(renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({ rule: null }) })));
    expect(plain).not.toContain("The two changes side by side");
    expect(plain).not.toContain("Move one set Keep the two apart");
  });
});

describe("why this move and not a bigger gain", () => {
  it("says in the working, beside line 2, that the move is chosen by clash, not by gain, and only with a move", () => {
    expect(MOVE_CHOICE_LINE).toBe(
      "Chosen by clash, not by gain: the lowest-index single move for the day’s costliest clash that has one. A move for another clash can lower the index more; Try a move scores the legal places of other sets.",
    );
    const html = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy() }));
    const { region, outside } = working(html);
    expect(text(region)).toContain(MOVE_CHOICE_LINE);
    expect(text(region).indexOf(MOVE_CHOICE_LINE)).toBeGreaterThan(text(region).indexOf(copy().moveLine));
    expect(text(outside)).not.toContain("Chosen by clash");
    const none = renderToStaticMarkup(createElement(DecisionDetails, { copy: copy({ move: null }) }));
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
