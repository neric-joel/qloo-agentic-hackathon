import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Lenses } from "@/lib/lenses";

import { lensLead, otherHalfLine, otherHalfPair, pairKeyOf, TasteLens } from "./taste-lens";

// Every name and figure below is invented for the test.
function lenses(overrides: Partial<Lenses> = {}): Lenses {
  return {
    day: 0,
    ranked: 15,
    with_taste: [
      { a: "Act One", b: "Act Two", a_id: "one", b_id: "two", rank: 1, rank_without_taste: 21 },
      { a: "Act Three", b: "Act Four", a_id: "three", b_id: "four", rank: 2, rank_without_taste: 3 },
      { a: "Act Five", b: "Act Six", a_id: "five", b_id: "six", rank: 4, rank_without_taste: null },
    ],
    without_taste: [
      { a: "Act Seven", b: "Act Eight", a_id: "seven", b_id: "eight", rank: 1, rank_with_taste: 17 },
      { a: "Act Three", b: "Act Four", a_id: "three", b_id: "four", rank: 3, rank_with_taste: 2 },
    ],
    only_with_taste: 9,
    only_without_taste: 9,
    apart: [],
    ...overrides,
  };
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function render(value: Lenses): string {
  return text(renderToStaticMarkup(createElement(TasteLens, { lenses: value, ranked: [], onOpen: () => {} })));
}

const SHUFFLED = { runs: 200, median: 10, low: 8, high: 12 };

describe("lensLead", () => {
  it("prints the server's counts", () => {
    expect(lensLead(lenses())).toBe(
      "Count only how popular two acts are (popularity is also a Qloo field) and how long they share the stage clock, and 9 of this day’s 15 costliest clashes would no longer be among the 15 costliest.",
    );
  });

  it("states the null beside the count when random taste numbers do about as much", () => {
    expect(lensLead(lenses({ only_with_taste: 10, shuffled: SHUFFLED }))).toBe(
      "Count only draw and time shared, and 10 of this day’s 15 costliest clashes would drop out of the 15. Random taste numbers do about as much: shuffled among the same acts 200 times, they drop 10 (usually 8 to 12). So this shows that taste overlap reorders the list, not that Qloo’s numbers pick the right clashes. The check we set before building did not pass (see How we know).",
    );
    // The top of the usual range is still within it.
    expect(lensLead(lenses({ only_with_taste: 12, shuffled: SHUFFLED }))).toContain(
      "Random taste numbers do about as much",
    );
  });

  it("says when the count is above what random taste numbers do", () => {
    expect(lensLead(lenses({ only_with_taste: 13, shuffled: SHUFFLED }))).toBe(
      "Count only draw and time shared, and 13 of this day’s 15 costliest clashes would drop out of the 15. That is more than random taste numbers do: shuffled among the same acts 200 times, they drop 10 (usually 8 to 12). It shows the numbers carry structure, not that they pick the right clashes. The check we set before building did not pass (see How we know).",
    );
  });

  it("keeps the both-zero lead whatever the shuffled numbers say", () => {
    expect(lensLead(lenses({ only_with_taste: 0, only_without_taste: 0, shuffled: SHUFFLED }))).toBe(
      "Counting taste overlap does not change which clashes are the 15 costliest on this day.",
    );
  });

  it("says nothing changes when both counts are 0", () => {
    expect(lensLead(lenses({ only_with_taste: 0, only_without_taste: 0 }))).toBe(
      "Counting taste overlap does not change which clashes are the 15 costliest on this day.",
    );
  });
});

describe("TasteLens", () => {
  it("renders the heading, the lead and the caveat", () => {
    const html = render(lenses());
    expect(html).toContain("What taste overlap changes");
    expect(html).toContain("9 of this day’s 15 costliest clashes would no longer be among the 15 costliest.");
    expect(html).toContain(
      "This shows how taste overlap reorders this ranking. The check we set before building did not pass (see How we know ).",
    );
  });

  it("puts the disclosure in the lead paragraph, in the same type, with no separate caveat", () => {
    const html = renderToStaticMarkup(
      createElement(TasteLens, {
        lenses: lenses({ only_with_taste: 10, shuffled: SHUFFLED }),
        ranked: [],
        onOpen: () => {},
      }),
    );
    expect(html).toContain("Random taste numbers do about as much");
    expect(html).toContain('href="/method">How we know</a>');
    expect(text(html)).not.toContain("This shows what the number changes in this ranking");
    // One paragraph holds the count and the disclosure: no smaller grey line follows it.
    const lead = /<p>(Count only draw and time shared.*?)<\/p>/.exec(html);
    expect(lead?.[1]).toContain("did not pass");
  });

  it("prints rank denominators in both lists when the server sends them, bare ordinals otherwise", () => {
    const withDenominators = render(lenses({ priced_with_taste: 68, priced_without_taste: 66 }));
    expect(withDenominators).toContain(
      "Act One and Act Two · 1st of 68 with taste overlap, 21st of 66 on draw and time alone",
    );
    expect(withDenominators).toContain(
      "Act Five and Act Six · 4th of 68 with taste overlap, not ranked on draw and time alone",
    );
    expect(withDenominators).toContain(
      "Act Seven and Act Eight · 1st of 66 on draw and time alone, 17th of 68 with taste overlap",
    );
    expect(render(lenses())).toContain("Act One and Act Two · 1st with taste overlap, 21st on draw and time alone");
  });

  it("opens the drawer only from rows whose pair is among the page's ranked clashes", () => {
    const clash = { a: { act_id: "seven" }, b: { act_id: "eight" } } as never;
    const html = renderToStaticMarkup(
      createElement(TasteLens, { lenses: lenses(), ranked: [clash], onOpen: () => {} }),
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(/<button[^>]*>.*Act Seven and Act Eight/.test(html)).toBe(true);
  });

  it("lists only pairs that leave the top in the other view, with their ranks", () => {
    const html = render(lenses());
    expect(html).toContain("Costliest with taste overlap, lower without");
    expect(html).toContain("Act One and Act Two · 1st with taste overlap, 21st on draw and time alone");
    expect(html).toContain("Act Five and Act Six · 4th with taste overlap, not ranked on draw and time alone");
    expect(html).not.toContain("Act Three and Act Four");
    expect(html).toContain("Costliest on draw and time alone, lower with taste overlap");
    expect(html).toContain("Act Seven and Act Eight · 1st on draw and time alone, 17th with taste overlap");
    expect(html).not.toMatch(/not concurrent/);
  });

  it("drops the caveat and the lists when nothing changes", () => {
    const html = render(
      lenses({
        only_with_taste: 0,
        only_without_taste: 0,
        with_taste: [{ a: "Act One", b: "Act Two", a_id: "one", b_id: "two", rank: 1, rank_without_taste: 2 }],
        without_taste: [{ a: "Act One", b: "Act Two", a_id: "one", b_id: "two", rank: 2, rank_with_taste: 1 }],
      }),
    );
    expect(html).toContain("Counting taste overlap does not change which clashes are the 15 costliest on this day.");
    expect(html).not.toContain("lower without");
    expect(html).not.toContain("did not pass");
  });

  it("shows the apart block only when the server sends pairs", () => {
    expect(render(lenses())).not.toContain("never on at the same time");
    const html = render(
      lenses({
        apart: [
          { a: "Act Nine", b: "Act Ten", a_id: "nine", b_id: "ten" },
          { a: "Act Eleven", b: "Act Twelve", a_id: "eleven", b_id: "twelve" },
        ],
      }),
    );
    expect(html).toContain("High taste overlap, never on at the same time: Act Nine and Act Ten; Act Eleven and Act Twelve.");
    expect(html).toContain(
      "Taste overlap only costs something when two sets share time, so these pairs price at zero. How the price works",
    );
  });

  it("sets the pairs that price at zero as one 10px inset block with a quiet edge on all sides, embedded or not (round 34, corners)", () => {
    const value = lenses({ apart: [{ a: "Act Nine", b: "Act Ten", a_id: "nine", b_id: "ten" }] });
    for (const embedded of [false, true]) {
      const html = renderToStaticMarkup(createElement(TasteLens, { lenses: value, ranked: [], onOpen: () => {}, embedded }));
      const cls = /<div data-lens-apart="" class="([^"]*)"/.exec(html)?.[1] ?? "";
      expect(cls.split(" "), String(embedded)).toEqual(expect.arrayContaining(["rounded-md", "border", "border-border", "p-4"]));
      // A note, not a card: no fill, no shadow, no capsule, and never a lone top rule.
      expect(cls).not.toMatch(/\bbg-|shadow|rounded-(full|lg|xl)|border-t\b/);
    }
  });

  it("sets the two lists side by side by the width of their slot when embedded, and by the page's width on its own", () => {
    const value = lenses();
    const embedded = renderToStaticMarkup(createElement(TasteLens, { lenses: value, ranked: [], onOpen: () => {}, embedded: true }));
    // Embedded, the block is a size container: the lists pair up once it is 36rem wide, and stack in a narrower slot.
    expect(embedded).toMatch(/^<div id="taste-lens" aria-labelledby="taste-lens-heading" role="group" class="@container">/);
    expect(embedded).toContain('<div class="mt-6 grid gap-8 @xl:grid-cols-2 @xl:gap-x-10 @xl:gap-y-0">');
    expect(embedded.match(/<div class="min-w-0 @xl:row-span-2 @xl:grid @xl:grid-rows-subgrid">/g)).toHaveLength(2);
    expect(embedded).not.toContain("lg:grid-cols-2");
    // On its own, the section keeps the page breakpoint.
    const own = renderToStaticMarkup(createElement(TasteLens, { lenses: value, ranked: [], onOpen: () => {} }));
    expect(own).toContain('<div class="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-x-12 lg:gap-y-0">');
    expect(own.match(/<div class="min-w-0 lg:row-span-2 lg:grid lg:grid-rows-subgrid">/g)).toHaveLength(2);
    expect(own).not.toContain("@container");
  });

  it("gives each lens row that opens a drawer the 10px row corner, so its hover and focus wash is never a sharp box", () => {
    const clash = { a: { act_id: "seven" }, b: { act_id: "eight" } } as never;
    const html = renderToStaticMarkup(createElement(TasteLens, { lenses: lenses(), ranked: [clash], onOpen: () => {} }));
    const button = /<button type="button" class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(button.split(" ")).toEqual(expect.arrayContaining(["rounded-md", "hover:bg-accent", "focus-visible:bg-accent"]));
  });
});

describe("TasteLens motion (round 34: no scroll-in motion)", () => {
  it("is drawn final in the server HTML with nothing to play: no reveal phase, stagger or rising rows", () => {
    const html = renderToStaticMarkup(createElement(TasteLens, { lenses: lenses(), ranked: [], onOpen: () => {} }));
    expect(html).not.toContain("data-reveal");
    expect(html).not.toContain("--reveal-delay");
    expect(html).not.toContain("cc-lens-row");
    // Every listed pair is a plain row, drawn where it rests.
    expect(html.match(/<li>/g)).toHaveLength(3);
  });
});

describe("otherHalfPair", () => {
  it("picks the draw-and-time pair whose place falls furthest once taste counts, read from the lens data", () => {
    expect(otherHalfPair(lenses())).toEqual({ a: "Act Seven", b: "Act Eight", aId: "seven", bId: "eight", from: 1, to: 17 });
  });

  it("skips pairs that rise, stay or go unranked with taste, and breaks a tie toward the higher place on time and draw", () => {
    const value = lenses({
      without_taste: [
        { a: "A", b: "B", a_id: "a", b_id: "b", rank: 6, rank_with_taste: 10 },
        { a: "C", b: "D", a_id: "c", b_id: "d", rank: 2, rank_with_taste: 6 },
        { a: "E", b: "F", a_id: "e", b_id: "f", rank: 1, rank_with_taste: null },
        { a: "G", b: "H", a_id: "g", b_id: "h", rank: 3, rank_with_taste: 1 },
      ],
    });
    expect(otherHalfPair(value)).toMatchObject({ a: "C", b: "D", from: 2, to: 6 });
    expect(otherHalfPair(lenses({ without_taste: [] }))).toBeNull();
  });

  it("leaves out excluded pairs in either act order, so a pair resting on a missing reading can be dropped", () => {
    expect(pairKeyOf("eight", "seven")).toBe(pairKeyOf("seven", "eight"));
    expect(otherHalfPair(lenses(), new Set([pairKeyOf("eight", "seven")]))).toBeNull();
  });
});

describe("otherHalfLine", () => {
  it("says where the pair ranks, with its taste overlap only when given, and names no source on the invented day", () => {
    const pair = { a: "Act Seven", b: "Act Eight", from: 1, to: 17 };
    // Round 34 (row 26): the hedge is cut, and the reading stays attributed to this index.
    expect(otherHalfLine(pair, null)).toBe(
      "Taste also lowers some clashes: Act Seven × Act Eight ranks #1 on time and draw but #17 with taste: by this index, a candidate to keep.",
    );
    expect(otherHalfLine(pair, null)).not.toContain("Lower priority");
    expect(otherHalfLine(pair, "8")).toContain("#17 with taste (taste overlap 8 of 100 on this bill): by this index, a candidate to keep.");
    const invented = otherHalfLine(pair, "8", true);
    expect(invented).toMatch(/^On this invented day, taste also lowers some clashes:/);
    expect(invented).toContain("(invented taste overlap 8 of 100 on this bill)");
    for (const line of [otherHalfLine(pair, null), invented]) {
      expect(line).not.toMatch(/qloo|same crowd|costs little|overlap little|fine to keep|fans/i);
    }
  });
});
