import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { tagLabel } from "@/lib/clashes";
import type { Evidence, HiddenWallItem, SharedTag } from "@/lib/preset";

import { HiddenWall, wallCount } from "./hidden-wall";

// Every name and figure below is invented for the test.
function item(n: number): HiddenWallItem {
  return {
    festival: "test-fest-2025",
    day: "Sun",
    acts: [`Act ${n}A`, `Act ${n}B`],
    genres: [["urn:tag:genre:indie"], ["urn:tag:genre:punk"]],
    overlap_pct: 0.9,
    draw_pct: 0.8,
    overlap_min: 30,
    source: null,
    shared_tags: [],
  };
}

function evidence(shown: number, total: number): Evidence {
  return {
    hidden_wall: Array.from({ length: shown }, (_, i) => item(i + 1)),
    hidden_wall_total: total,
    receipts: {},
    twins: [],
  };
}

function tag(name: string): SharedTag {
  return { name: `urn:tag:genre:${name}`, kind: null, score: null };
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("wallCount", () => {
  it("says the rest are not saved when the wall shows fewer than the source counted", () => {
    expect(wallCount(8, 13)).toBe("Showing 8 of 13 sourced examples. The other 5 are not saved with this day.");
    expect(wallCount(3, 4)).toBe("Showing 3 of 4 sourced examples. The other one is not saved with this day.");
  });

  it("gives the plain count when the wall shows them all", () => {
    expect(wallCount(4, 4)).toBe("4 sourced examples");
    expect(wallCount(1, 1)).toBe("1 sourced example");
  });
});

describe("HiddenWall", () => {
  it("names the section and its count in the heading, with no kicker over it", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(8, 13) }));
    expect(html).toContain('<h2 id="hidden-wall-heading" class="type-title">Hidden clashes: 8 called-out pairs with no genre tag in common</h2>');
    expect(text(renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(1, 1) })))).toContain(
      "Hidden clashes: 1 called-out pair with no genre tag in common",
    );
    expect(html).not.toContain("Different genres, overlapping tastes");
    const before = html.slice(0, html.indexOf("<h2"));
    expect(before).not.toContain("type-kicker");
  });

  it("prints the count line above the cards", () => {
    const partial = text(renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(2, 5) })));
    expect(partial).toContain("Showing 2 of 5 sourced examples. The other 3 are not saved with this day.");
    const whole = text(renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(2, 2) })));
    expect(whole).toContain("2 sourced examples");
    expect(whole).not.toContain("Showing");
  });

  it("renders no section at all when the day has no examples", () => {
    expect(renderToStaticMarkup(createElement(HiddenWall, { evidence: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(0, 0) }))).toBe("");
  });

  it("prints the count line in sentence case, not as an all-caps label", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(2, 5) }));
    const line = html.match(/<p class="([^"]*)">Showing/);
    expect(line).not.toBeNull();
    expect(line?.[1]).not.toContain("type-kicker");
  });
});

describe("HiddenWall motion (M8)", () => {
  it("is drawn final in the server HTML, with the diamond and genre line ready to play on each printed card, and no dashed perforation", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(2, 2) }));
    expect(html).not.toContain("data-reveal");
    expect(html).not.toContain("--reveal-delay");
    // Dashed means only "tested" now: the ticket perforation is gone, and each card's divider is an inset hairline.
    expect(html).not.toContain("ticket-perforation");
    expect(html).not.toContain("cc-wall-perf");
    expect(html.match(/<div class="mx-4 border-t border-border" aria-hidden="true"><\/div>/g)).toHaveLength(2);
    expect(html.match(/cc-wall-gem/g)).toHaveLength(2);
    expect(html).toMatch(/class="cc-wall-note[^"]*">No genre tag in common\./);
  });
});

describe("HiddenWall: one switcher for every example", () => {
  it("puts every shown example in the switcher, so its counter agrees with the count line, with no 'other examples' fold", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(8, 13) }));
    expect(text(html)).toContain("Showing 8 of 13 sourced examples. The other 5 are not saved with this day.");
    expect(html.replace(/<[^>]+>/g, "")).toContain("Pair 1 of 8: Act 1A and Act 1B");
    expect(html).not.toContain("Show the other");
    // The switcher's one navigator: Previous cannot go on at the first pair (and keeps focus), Next is live.
    expect(html).toMatch(/<button type="button" aria-label="Previous pair"[^>]*aria-disabled="true"/);
    expect(html).toMatch(/<button type="button" aria-label="Next pair"(?![^>]*aria-disabled="true")[^>]*>/);
  });

  it("sets the Recorded badge beside the source link, and the count line as the exhibit's closing line after the source details, in 13px muted type", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(8, 13) }));
    const lead = html.indexOf("Clashes the press or fans called out");
    const tabs = html.indexOf("data-pair-nav");
    const count = html.indexOf("Showing 8 of 13");
    const next = html.indexOf("Next pair");
    const badge = html.search(/Recorded/i);
    expect(badge).toBeGreaterThan(next);
    // One lead sentence above the tabs; the count follows the figure.
    expect(lead).toBeLessThan(tabs);
    expect(count).toBeGreaterThan(next);
    // On screen: the count closes the exhibit, in its own full-width slot after the source details and outside them
    // (never in a disclosure), as one 13px muted line.
    expect(html).toMatch(
      /<\/details><\/div><\/div><div data-ring-closing="true" class="[^"]*lg:order-9[^"]*lg:basis-full"><p class="text-\[0\.8125rem\] leading-relaxed font-medium text-muted-foreground">Showing 8 of 13 sourced examples\. The other 5 are not saved with this day\.<\/p><\/div>/,
    );
    const fold = html.match(/<details data-ring-source[^>]*>[\s\S]*?<\/details>/)![0];
    expect(fold).not.toContain("Showing 8 of 13");
    expect(html.indexOf("Showing 8 of 13", html.indexOf("data-ring-closing"))).toBeGreaterThan(html.indexOf("</details>"));
    // The count line is no longer in the finding's column: the aside holds the caveat only.
    const aside = html.slice(html.indexOf("data-ring-aside"), html.indexOf("data-pair-facts"));
    expect(aside).not.toContain("Showing");
    expect(aside).toContain("not a test of how well the measure spots such clashes");
    // On paper: the whole count and caveat print in one block, hidden on screen.
    expect(html).toMatch(/<div data-ring-footnote="true" class="hidden min-w-0 print:block"><div class="[^"]*"><p class="[^"]*">Showing 8 of 13/);
  });

  it("reads in the phone's order: the names, the label and tags, the genre tags, the finding, its caveat, the ranks, the source line, the details, then the count line", () => {
    const ev = evidence(8, 13);
    ev.hidden_wall[0] = { ...ev.hidden_wall[0], shared_tags: ["jazz", "soul", "funk", "blues", "disco"].map(tag) };
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: ev }));
    const panel = html.slice(html.indexOf('id="ring-panel"'), html.indexOf("data-ring-footnote"));
    const order = [
      '<h3 class="sr-only">',
      'data-act-name="start"',
      "Audience tags in common, from Qloo",
      "data-shared-tags",
      "and <span",
      'data-act-name="end"',
      'data-act-genres="start"',
      'data-act-genres="end"',
      "No genre tag in common.",
      "Compared on each act’s own genre tags",
      "at the same time",
      "These are examples with their sources, not a test of how well the measure spots such clashes.",
      "Taste overlap rank",
      "Draw rank",
      "No press link saved.",
      "Recorded",
      "<details data-ring-source",
      "</details>",
      "Showing 8 of 13 sourced examples. The other 5 are not saved with this day.",
    ];
    for (let i = 1; i < order.length; i++) {
      expect(panel.indexOf(order[i - 1]), `${order[i - 1]} before ${order[i]}`).toBeLessThan(panel.indexOf(order[i]));
      expect(panel.indexOf(order[i]), order[i]).toBeGreaterThan(-1);
    }
    // "These are examples ..." stays beside the finding: right after the minutes, before the ranks, outside any disclosure.
    const open = panel.replace(/<details[^>]*>[\s\S]*?<\/details>/g, "");
    expect(text(open)).toContain("30 min at the same time These are examples with their sources, not a test of how well the measure spots such clashes. Taste overlap rank");
    expect(text(open)).toContain("Showing 8 of 13 sourced examples. The other 5 are not saved with this day.");
  });

  it("draws the printed cards' ranks and tags with no provenance teal, and the invented day with no teal at all", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(2, 2) }));
    const grid = html.slice(html.indexOf("print:grid"));
    expect(grid).not.toContain("prov-qloo");
    // On screen only the "from Qloo" label over the audience tags is teal.
    expect(html.match(/prov-qloo/g)).toHaveLength(1);
    expect(html).toMatch(/data-shared-label="true" class="[^"]*text-prov-qloo/);
    const invented = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(2, 2), synthetic: true }));
    expect(invented).not.toContain("prov-qloo");
  });

  it("opens straight on the paper, with no hairline above the section, and the switcher as one open exhibit under one top rule", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(8, 13) }));
    expect(html).toMatch(/^<section id="hidden-wall" aria-labelledby="hidden-wall-heading"><div class="container-page pt-16 pb-10 lg:pt-20 lg:pb-12">/);
    // The exhibit ends on its own last line: a shorter bottom than the other sections (py-16 lg:py-20), the top kept.
    expect(html).not.toMatch(/container-page[^"]*\bpy-/);
    expect(html).not.toMatch(/<section[^>]*class="[^"]*border-t/);
    // The exhibit sits open on paper, as the hero receipt does: one 1px decorative top rule, no box.
    const card = html.match(/data-ring-card="true" class="([^"]*)"/)![1];
    expect(card).toBe("border-t border-border pt-5 sm:pt-6 print:hidden");
    for (const cls of ["rounded-lg", "border-surface-edge", "bg-card"]) expect(card.split(" ")).not.toContain(cls);
    expect(html).not.toContain("data-ring-rule");
    // The heading and the lead stay open above the exhibit.
    expect(html.indexOf("Clashes the press or fans called out")).toBeLessThan(html.indexOf("data-ring-card"));
    // Printed cards link their source in ink with a border-strong underline, never vermilion.
    expect(html).not.toContain("text-primary underline");
  });

  it("draws each printed card's ranks on the same rank axis, its halo in the card's fill, and no axis for a missing rank", () => {
    const ev = evidence(2, 2);
    ev.hidden_wall[1] = { ...ev.hidden_wall[1], draw_pct: null };
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: ev }));
    const grid = html.slice(html.indexOf("print:grid"));
    // Three ranks on paper (two, then one where the draw rank is n/a), each one axis, aria-hidden, haloed in card.
    expect(grid.match(/data-rank-axis/g)).toHaveLength(3);
    expect(grid.match(/<div aria-hidden="true" data-rank-axis=""/g)).toHaveLength(3);
    expect(grid.match(/border-2 bg-foreground border-card/g)).toHaveLength(3);
    expect(grid).not.toContain("border-background");
    expect(grid).toContain('data-p="90"');
    expect(grid).toContain('data-p="80"');
    // The n/a draw rank is words only, never a dot at zero.
    expect(grid).not.toContain('data-p="0"');
    // On screen the exhibit's axes sit on paper, haloed in the paper's fill.
    const screen = html.slice(0, html.indexOf("print:grid"));
    expect(screen).toMatch(/data-rank-axis="" data-p="90"[\s\S]*?border-2 bg-foreground border-background/);
  });

  it("dates each printed card in sentence case, with no kicker and no zero-padded index", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(2, 2) }));
    expect(html).not.toContain("type-kicker");
    expect(html).toContain(">Test Fest 2025, Sunday</p>");
    expect(html).not.toMatch(/>0[1-9]</);
  });

  it("prints every example as a card for paper only, hidden on screen", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: evidence(8, 13) }));
    const grid = html.match(/<ul class="([^"]*)">(?:(?!<\/ul>)[\s\S])*?cc-wall-gem/);
    expect(grid?.[1]).toContain("hidden");
    expect(grid?.[1]).toContain("print:grid");
    expect(html.match(/cc-wall-gem/g)).toHaveLength(8);
    // On paper the switcher's navigator, finding, figure and facts are left out; the count and caveats print.
    expect(html).toMatch(/<div data-pair-nav="true"[^>]*class="[^"]*print:hidden/);
    // The whole pair (finding, figure and facts) is one block left off paper.
    expect(html).toMatch(/<div id="ring-panel"[^>]*class="[^"]*print:hidden/);
    const printed = html.lastIndexOf("Showing 8 of 13");
    expect(html.slice(printed - 200, printed)).toContain("print:block");
  });
});

describe("HiddenWall wording", () => {
  it("opens with one short lead sentence, keeps 'not a test' beside the finding, and moves the rank scale and broad-tags note, word for word, into the source details", () => {
    const tagged: HiddenWallItem = { ...item(1), shared_tags: [{ name: "urn:tag:genre:jazz", kind: null, score: null }] };
    const html = renderToStaticMarkup(
      createElement(HiddenWall, { evidence: { ...evidence(3, 3), hidden_wall: [tagged, item(2), item(3)] } }),
    );
    const paragraphs = (html.match(/<p[^>]*>[\s\S]*?<\/p>/g) ?? []).map(text);
    const lead = "Clashes the press or fans called out where the acts share no genre tag, yet their taste overlap is among the highest of that day.";
    expect(paragraphs).toContain(lead);
    expect(lead.split(" ").length).toBeLessThanOrEqual(25);

    const notTest = "These are examples with their sources, not a test of how well the measure spots such clashes.";
    const scale = "Both ranks run 0 to 100 within that day’s clashes, not on the timetable’s draw scale.";
    const broad = "Broad tags such as Jazz, Blues or Electronic come back for many pairs.";
    // On screen: "not a test" is its own visible line in the finding's column, outside any disclosure.
    const aside = html.slice(html.indexOf("data-ring-aside"), html.indexOf("<details data-ring-source"));
    expect(text(aside)).toContain(notTest);
    expect(aside).not.toContain("<details");
    // The rank scale and the broad-tags note close the pair's source details, word for word.
    const fold = html.match(/<details data-ring-source[^>]*>[\s\S]*?<\/details>/)![0];
    expect(fold).toContain("Qloo source details");
    const notes = fold.match(/<p data-wall-notes="true"[^>]*>[\s\S]*?<\/p>/)![0];
    expect(text(notes)).toBe(`${scale} ${broad}`);
    // On paper: the whole caveat, word for word, once, in the print-only block.
    const footnote = html.slice(html.indexOf("data-ring-footnote"));
    const caption = (footnote.match(/<p[^>]*>[\s\S]*?<\/p>/g) ?? []).map(text).filter((p) => p.includes(notTest));
    expect(caption).toHaveLength(1);
    expect(caption[0]).toBe(`${notTest} ${scale} ${broad}`);
    // Every caveat follows the switcher's pager.
    const plain = text(html);
    expect(plain.indexOf(notTest)).toBeGreaterThan(plain.indexOf("Next pair"));
    expect(paragraphs.filter((p) => p === notTest)).toHaveLength(1);
  });
});

describe("HiddenWall tags", () => {
  const names = ["jazz", "soul", "funk", "blues", "disco"];
  function withTags(shown: number): Evidence {
    const ev = evidence(shown, shown);
    ev.hidden_wall = ev.hidden_wall.map((card) => ({ ...card, shared_tags: names.map(tag) }));
    return ev;
  }

  it("prints every tag on each printed card, with no '+N more' and no disclosure but the ring's source fold", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: withTags(6) }));
    const blocks = (html.match(/<details[^>]*>[\s\S]*?<\/details>/g) ?? []).filter((block) => !block.startsWith("<details data-ring-source"));
    expect(blocks).toHaveLength(0);
    expect(html.match(/<p class="text-xs font-semibold">Tags Qloo returned for this pair<\/p>/g)).toHaveLength(6);
    for (const name of names) {
      expect(html.match(new RegExp(`>${tagLabel(`urn:tag:genre:${name}`)}</li>`, "g"))!.length).toBeGreaterThanOrEqual(6);
    }
    expect(html).not.toMatch(/\+\d+ more/);
  });

  it("names the invented day's tags without crediting Qloo", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: withTags(2), synthetic: true }));
    expect(html.match(/>Shared tags for this pair</g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("Tags Qloo returned");
  });

  it("gives a card with no tags no tag block", () => {
    const ev = withTags(2);
    ev.hidden_wall[1] = { ...ev.hidden_wall[1], shared_tags: [] };
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: ev }));
    expect(html.match(/<p class="text-xs font-semibold">Tags Qloo returned for this pair<\/p>/g)).toHaveLength(1);
  });

  it("keeps the finding and its caveats word for word on screen, with no click, beside the ranks", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: { ...withTags(8), hidden_wall_total: 13 } }));
    const open = html.replace(/<details[^>]*>[\s\S]*?<\/details>/g, "");
    const screen = text(open.slice(open.indexOf('id="ring-panel"'), open.indexOf("data-ring-footnote")));
    for (const line of [
      "No genre tag in common.",
      "30 min at the same time",
      "The other 5 are not saved with this day.",
      "not a test of how well the measure spots such clashes",
      "Audience tags in common, from Qloo: 5",
      "Taste overlap rank",
      "Draw rank",
    ]) {
      expect(screen).toContain(line);
    }
    // The finding's column (heading, minutes and caveat) comes before the ranks' column in one grid.
    const findings = html.slice(html.indexOf("data-ring-findings"));
    expect(findings.indexOf("No genre tag in common.")).toBeLessThan(findings.indexOf("not a test of how well"));
    expect(findings.indexOf("not a test of how well")).toBeLessThan(findings.indexOf("Taste overlap rank"));
    expect(html).toContain('data-ring-findings="true" class="mt-6 grid min-w-0 gap-x-12 gap-y-6 lg:order-8 lg:mt-8 lg:basis-full lg:grid-cols-2 lg:items-start"');
    // The bridge (the names holding the audience tags in common) comes before the finding in the markup, so a phone
    // reads the figure, then the conclusion with its caveat directly under it.
    expect(html.indexOf("data-ring-inventory")).toBeLessThan(html.indexOf("No genre tag in common."));
    expect(html.indexOf("Audience tags in common")).toBeLessThan(html.indexOf("not a test of how well"));
  });

  it("keeps the finding, ranks and minutes on screen in the pair panel, outside any disclosure", () => {
    const html = renderToStaticMarkup(createElement(HiddenWall, { evidence: withTags(2) }));
    const outside = html.replace(/<details[^>]*>[\s\S]*?<\/details>/g, "");
    const screen = outside.slice(outside.indexOf('id="ring-panel"'), outside.indexOf("print:grid"));
    expect(screen).toContain("No genre tag in common.");
    expect(screen).toContain("Taste overlap rank");
    expect(screen).toContain("Draw rank");
    expect(text(screen)).toContain("30 min at the same time");
  });
});
