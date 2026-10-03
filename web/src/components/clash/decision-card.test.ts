import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildDecisionCopy, parseDecision } from "@/lib/decision";
import type { Demand } from "@/lib/demand";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";

import { DecisionCard } from "./decision-card";
import { KeepApart } from "./keep-apart";
import { WhyThisMatters } from "./why-this-matters";

// Every name and figure below is invented for the test.

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
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

function copy(overrides: Record<string, unknown> = {}) {
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
  const built = buildDecisionCopy(parsePreset(rawTinyPreset()), decision);
  if (!built) throw new Error("no card");
  return built;
}

describe("DecisionCard", () => {
  it("leads with the receipt, then the heading, the four lines and the attribution beside the index", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    const plain = text(html);
    const order = [
      "Bo Diddly Squat 60 minutes later:",
      "One decision on Tiny Fest Saturday, published timetable",
      "The costliest clash with a set that can move",
      "Move one set: of the 4 legal places",
      "104.2 → 98.4",
      "Selected and scored by this app’s index",
      "If a rule says Ann Arbor and Bo Diddly Squat must never overlap:",
      "Lines 1 and 2 are selected and scored by this app’s index. Line 3 is checked against the timetable’s rules. A reading, not a verdict.",
    ].map((part) => plain.indexOf(part));
    order.forEach((at, i) => {
      expect(at, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    expect(html).toContain('id="decision-heading"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("has no buttons the page cannot act on, and shows each only with its handler and its seed", () => {
    expect(text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy() })))).not.toContain("Open this move");
    const withHandlers = text(
      renderToStaticMarkup(
        createElement(DecisionCard, { copy: copy(), onOpenMove: () => {}, onTryRule: () => {}, onOpenHidden: () => {} }),
      ),
    );
    expect(withHandlers).toContain("Open this move");
    expect(withHandlers).toContain("Try this rule yourself");
    expect(withHandlers).toContain("Open a hidden clash");
    const noRule = text(
      renderToStaticMarkup(
        createElement(DecisionCard, { copy: copy({ rule: null }), onOpenMove: () => {}, onTryRule: () => {} }),
      ),
    );
    expect(noRule).toContain("Open this move");
    expect(noRule).not.toContain("Try this rule yourself");
    expect(noRule).not.toContain("Line 3");
  });

  it("says so, with no receipt, figure, timeline or move to open, when no place lowers the index", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionCard, { copy: copy({ move: null }), onOpenMove: () => {} }),
    );
    const plain = text(html);
    expect(plain).toContain("No legal place for either set lowers the index.");
    expect(plain).not.toContain("Open this move");
    expect(plain).not.toContain("Selected and scored by this app’s index. ");
    expect(html).not.toContain("<svg");
  });

  it("uses none of the words the round forbids", () => {
    const plain = text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy() })));
    for (const pattern of [/optimi[sz]/i, /improve/i, /recommend/i, /validated/i, /proven/i, /predicts/i, /\bfix/i, /crowd/i, /headcount/i, /revenue/i, /significant/i]) {
      expect(plain).not.toMatch(pattern);
    }
  });
});

describe("WhyThisMatters", () => {
  it("prints the complaint figures, the failed pre-set test in the same block and the demand shell", () => {
    const plain = text(renderToStaticMarkup(createElement(WhyThisMatters)));
    expect(plain).toContain("Why this matters, and what is not known");
    expect(plain).toContain("45 clashes that fans or the press complained about at 5 festivals");
    expect(plain).toContain("86 pairs of acts, median 50 minutes");
    expect(plain).toContain("The test we set before looking failed. 46.8%");
    expect(plain).toContain("against a bar of 60%");
    expect(plain).toContain("AUC of 0.634 on this press-skewed set");
    expect(plain).toContain("They do not show that anyone would use or pay for this.");
    expect(plain).toContain("Who would pay is not known.");
    // Pending: no counts, no quote.
    expect(plain).not.toMatch(/We asked|One programmer told us/);
  });

  it("links four public voices to their pages and names no one without a source", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    expect((html.match(/rel="noopener noreferrer"/g) ?? []).length).toBe(5);
    for (const host of ["bbc.co.uk", "nme.com", "alpsinc.kr", "abc.net.au", "hadnews.com"]) expect(html).toContain(host);
    expect(html).not.toContain("&quot;");
  });

  it("prints a counted result or a reply only when the owner's data says so", () => {
    const none: Demand = { status: "none", asked: 7, dates: "Oct 6 to 17", checkedOn: "Oct 19" };
    expect(text(renderToStaticMarkup(createElement(WhyThisMatters, { demand: none })))).toContain(
      "We asked 7 festival programmers between Oct 6 to 17; none had replied by Oct 19.",
    );
    const reply: Demand = { status: "reply", asked: 7, replied: 1, dates: "Oct 6 to 17", role: "Programmer", quote: "A made-up reply.", changed: null };
    const plain = text(renderToStaticMarkup(createElement(WhyThisMatters, { demand: reply })));
    expect(plain).toContain("One programmer told us");
    expect(plain).toContain("Asked 7, replied 1.");
    expect(plain).toContain("Changed because of this reply: Nothing changed.");
  });
});

describe("KeepApart", () => {
  it("renders the form with both selects and a Search button, and no result before a search", () => {
    const html = renderToStaticMarkup(createElement(KeepApart, { preset: parsePreset(rawTinyPreset()), day: 0 }));
    const plain = text(html);
    expect(plain).toContain("Keep two sets apart");
    expect(plain).toContain("Pick two sets that share time. The search checks every place for either set and every swap of two sets that keeps all rules.");
    expect(plain).toContain("First set");
    expect(plain).toContain("Second set");
    expect(plain).toContain("(locked)");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Search<\/button>/);
    expect(plain).not.toContain("Smallest changes first");
  });
});
