import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildDecisionCopy, parseDecision } from "@/lib/decision";
import type { Demand } from "@/lib/demand";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";
import { parseRuleFixes, plannedNote, STAGE_FIT_GLOSS } from "@/lib/rule-fix";

import { DecisionCard } from "./decision-card";
import { ChangeCard, KeepApart } from "./keep-apart";
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
  it("leads with the receipt, then the heading, the index with its attribution, the timeline, and only then the four lines", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    const plain = text(html);
    const order = [
      "Bo Diddly Squat 60 minutes later:",
      "One decision on Tiny Fest Saturday, published timetable",
      "104.2 → 98.4",
      "Selected and scored by this app’s index",
      "Solid: where the sets play now.",
      "How this was chosen",
      "The costliest clash with a set that has a legal place that lowers the index",
      "Move one set: of the 4 legal places on the 5-minute grid",
      "If a rule says Ann Arbor and Bo Diddly Squat must never overlap:",
      "Lines 1 and 2 are selected and scored by this app’s index. Line 3 is checked against the timetable’s rules; the index in it is shown for information, not as a verdict. A reading, not a verdict.",
    ].map((part) => plain.indexOf(part));
    order.forEach((at, i) => {
      expect(at, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    expect(html).toContain('id="decision-heading"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("keeps the four lines in the server HTML behind a phone disclosure that is open from sm up", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    // The button is for phones only and starts closed; the lines hide on a phone, never from sm up.
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*class="[^"]*sm:hidden[^"]*"[^>]*>How this was chosen/);
    expect(html).toMatch(/class="[^"]*max-sm:hidden[^"]*"/);
    expect(html).toMatch(/class="[^"]*sm:block[^"]*"/);
    const plain = text(html);
    for (const n of [1, 2, 3, 4]) expect(plain).toContain(`Line ${n}`);
    expect(plain).toContain("Bar: time shared with Ann Arbor.");
  });

  it("labels the timeline rows and keeps its type at 13 units", () => {
    const html = renderToStaticMarkup(createElement(DecisionCard, { copy: copy() }));
    expect(html).toContain(">Now<");
    expect(html).toContain(">Tested<");
    expect(html).not.toMatch(/text-\[(8|9)px\]/);
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
    expect(withHandlers).not.toContain("Keep this change");
    const noRule = text(
      renderToStaticMarkup(
        createElement(DecisionCard, { copy: copy({ rule: null }), onOpenMove: () => {}, onTryRule: () => {} }),
      ),
    );
    expect(noRule).toContain("Open this move");
    expect(noRule).not.toContain("Try this rule yourself");
    expect(noRule).not.toContain("Line 3");
    expect(noRule).toContain("Line 4");
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
    const button = kept.slice(kept.lastIndexOf("<button", kept.indexOf("In your plan")), kept.indexOf("In your plan"));
    expect(button).not.toBe("");
    expect(button).not.toContain(`disabled=""`);
  });

  it("says so, with no receipt, figure, timeline or move to open, when no place lowers the index", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionCard, { copy: copy({ move: null }), onOpenMove: () => {} }),
    );
    const plain = text(html);
    expect(plain).toContain("No legal place for either set lowers the index.");
    expect(plain).not.toContain("Open this move");
    expect(plain).not.toContain("Selected and scored by this app’s index. ");
    expect(html).not.toContain("viewBox=\"0 0 288");
  });

  it("uses none of the words the round forbids", () => {
    const plain = text(renderToStaticMarkup(createElement(DecisionCard, { copy: copy() })));
    for (const pattern of [/optimi[sz]/i, /improve/i, /recommend/i, /validated/i, /proven/i, /predicts/i, /\bfix/i, /crowd/i, /headcount/i, /revenue/i, /significant/i]) {
      expect(plain).not.toMatch(pattern);
    }
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
  function compared(kept?: { move: boolean; change: boolean }) {
    const built = copy({
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
    return renderToStaticMarkup(createElement(DecisionCard, { copy: built, kept }));
  }

  it("sits under the buttons and above the four lines, with both columns and every row", () => {
    const html = compared();
    const plain = text(html);
    const order = [
      "One decision on Tiny Fest Saturday",
      "The two changes side by side",
      "Move one set Keep the two apart",
      "Sets moved",
      "Start-time minutes moved",
      "Time the pair shares after",
      "Clash Budget Index, before → after",
      "Stage-fit flags, now → after",
      "Costliest clash after",
      "How this was chosen",
    ].map((part) => plain.indexOf(part));
    order.forEach((at, i) => {
      expect(at, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    expect(plain).toContain("104.2 → 98.4");
    expect(plain).toContain("104.2 → 99.1");
    expect(plain).toContain("1 → 1");
    expect(plain).toContain("1 → 2");
    expect(plain).toContain("Ed Sheeran-ish and Fay Wray, 45 minutes, 1.2 index points");
    expect(plain).toContain("Cy Twombly and Di Vine, 30 minutes, 9.5 index points");
    expect(plain).toContain(STAGE_FIT_GLOSS);
  });

  it("keeps the attribution beside the index row and stacks every row on a phone", () => {
    const html = compared();
    // The note is the row right after the index row, in the same group.
    expect(html).toMatch(/Clash Budget Index, before → after[\s\S]*?Selected and scored by this app’s index[\s\S]*?<\/tbody>/);
    // A phone stacks it: the table is a block, each cell carries its column's name, and nothing is fixed wide.
    expect(html).toMatch(/<table[^>]*class="[^"]*\bblock\b[^"]*sm:table[^"]*"/);
    expect(html).toContain('data-label="Move one set"');
    expect(html).toContain('data-label="Keep the two apart"');
    expect(html).not.toMatch(/\bw-\[\d+px\]|min-w-\[|overflow-x/);
    // Real table semantics for a screen reader: column and row headers.
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
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
    for (const host of ["bbc.co.uk", "nme.com", "alpsinc.kr", "abc.net.au", "www.billboard.com"]) expect(html).toContain(host);
    expect(html).not.toContain("hadnews");
    expect(html).not.toContain("&quot;");
    expect(text(html)).toContain("The team had expected different audiences, and the clash drew criticism.");
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
    expect(plain).toContain(
      "Pick two sets that share time. The search covers single places on the 5-minute grid for either set, and the two-set changes this search generates. Listed changes end this overlap and add no rule break.",
    );
    expect(plain).not.toMatch(/every (place|swap)|keeps all rules/);
    expect(plain).toContain("First set");
    expect(plain).toContain("Second set");
    expect(plain).toContain("(locked)");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Search<\/button>/);
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
      "Found on the published day; your plan already moves Ann Arbor, so the receipt after pricing is what counts.",
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
