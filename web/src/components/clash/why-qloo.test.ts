import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { qlooCredits } from "@/lib/credit";
import type { Lenses } from "@/lib/lenses";
import { parsePreset, type Act, type PairClash, type Twin } from "@/lib/preset";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";

import { otherHalfPair, placeText } from "./taste-lens";
import {
  changesLine,
  concurrentPairs,
  drawGloss,
  figureScale,
  NOT_AVAILABLE,
  QLOO_CHANGES_LINE,
  READINGS_CAPTION,
  READINGS_CAPTION_SYNTHETIC,
  rankX,
  readingText,
  TASTE_CHANGES_LINE_SYNTHETIC,
  TasteSection,
  tasteVerdict,
  threeReadings,
  WHAT_QLOO_ID,
  WhatQlooChanges,
  WhatQlooPointer,
  type SharedPair,
} from "./why-qloo";

// Every name and figure below is invented for the test.

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function lenses(overrides: Partial<Lenses> = {}): Lenses {
  return {
    day: 0,
    ranked: 15,
    with_taste: [
      // Taste changes this pair: 7th on draw and time, 1st with taste overlap.
      { a: "Act One", b: "Act Two", a_id: "one", b_id: "two", rank: 1, rank_without_taste: 7 },
      // Taste changes nothing: 2nd either way.
      { a: "Act Three", b: "Act Four", a_id: "three", b_id: "four", rank: 2, rank_without_taste: 2 },
      { a: "Act Five", b: "Act Six", a_id: "five", b_id: "six", rank: 3, rank_without_taste: null },
    ],
    without_taste: [
      { a: "Act Seven", b: "Act Eight", a_id: "seven", b_id: "eight", rank: 1, rank_with_taste: 19 },
      { a: "Act Three", b: "Act Four", a_id: "three", b_id: "four", rank: 2, rank_with_taste: 2 },
    ],
    only_with_taste: 4,
    only_without_taste: 4,
    apart: [],
    priced_with_taste: 40,
    priced_without_taste: 40,
    ...overrides,
  };
}

const PAIRS: SharedPair[] = [
  { aId: "one", bId: "two", minutes: 45 },
  { aId: "three", bId: "four", minutes: 60 },
  { aId: "five", bId: "six", minutes: 45 },
  { aId: "seven", bId: "eight", minutes: 90 },
];

describe("threeReadings", () => {
  it("reads both draw ranks from the same lens entry the lens block prints, in either act order", () => {
    const value = lenses();
    for (const [a, b] of [
      ["one", "two"],
      ["two", "one"],
    ]) {
      const readings = threeReadings(value, PAIRS, a, b);
      const entry = value.with_taste[0];
      expect(readings.taste).toEqual({ rank: entry.rank, of: value.priced_with_taste });
      expect(readings.draw).toEqual({ rank: entry.rank_without_taste, of: value.priced_without_taste });
      // The lens block prints the same places: "1st of 40 with taste overlap, 7th of 40 on draw and time alone".
      expect(placeText(entry.rank, value.priced_with_taste)).toBe("1st of 40");
      expect(readingText(readings.taste)).toBe("#1 of 40");
      expect(readingText(readings.draw)).toBe("#7 of 40");
    }
  });

  it("says when taste changes this pair's place", () => {
    const readings = threeReadings(lenses(), PAIRS, "one", "two");
    // The rank axis in the card's own words: minutes alone, time and draw, then with taste.
    expect(tasteVerdict(readings)).toBe("Time alone ranks this pair #3, time and draw #7, with taste #1.");
    // Without a minutes reading the time clause is dropped, never guessed.
    expect(tasteVerdict({ ...readings, time: undefined })).toBe("Time and draw rank this pair #7, with taste #1.");
    expect(tasteVerdict({ draw: readings.draw, taste: readings.taste })).toBe("Time and draw rank this pair #7, with taste #1.");
  });

  it("says when taste changes nothing", () => {
    const readings = threeReadings(lenses(), PAIRS, "four", "three");
    expect(readings.taste).toEqual({ rank: 2, of: 40 });
    expect(readings.draw).toEqual({ rank: 2, of: 40 });
    // A finding, not a shrug: taste agrees with time and draw, at the shared place.
    expect(tasteVerdict(readings)).toBe("Taste agrees with time and draw: #2 either way.");
  });

  it("glosses draw once where the card first says it: Qloo popularity, or invented popularity on the invented day", () => {
    expect(drawGloss(false)).toBe("Qloo popularity");
    expect(drawGloss(true)).toBe("invented popularity");
    const moved = threeReadings(lenses(), PAIRS, "one", "two");
    const same = threeReadings(lenses(), PAIRS, "three", "four");
    expect(tasteVerdict(moved, drawGloss(false))).toBe(
      "Time alone ranks this pair #3, time and draw (Qloo popularity) #7, with taste #1.",
    );
    expect(tasteVerdict(moved, drawGloss(true))).toBe(
      "Time alone ranks this pair #3, time and draw (invented popularity) #7, with taste #1.",
    );
    expect(tasteVerdict(same, drawGloss(false))).toBe("Taste agrees with time and draw (Qloo popularity): #2 either way.");
    expect(tasteVerdict(same, drawGloss(true))).toBe("Taste agrees with time and draw (invented popularity): #2 either way.");
    expect(tasteVerdict(same, drawGloss(true))).not.toMatch(/Qloo/);
  });

  it("finds a pair listed only in the draw-and-time list", () => {
    const readings = threeReadings(lenses(), PAIRS, "seven", "eight");
    expect(readings.draw).toEqual({ rank: 1, of: 40 });
    expect(readings.taste).toEqual({ rank: 19, of: 40 });
    expect(tasteVerdict(readings)).toBe("Time alone ranks this pair #1, time and draw #1, with taste #19.");
  });

  it("ranks minutes alone with ties sharing a place, over the day's concurrent pairs", () => {
    expect(readingText(threeReadings(lenses(), PAIRS, "seven", "eight").time)).toBe("#1 of 4");
    expect(readingText(threeReadings(lenses(), PAIRS, "three", "four").time)).toBe("#2 of 4");
    expect(readingText(threeReadings(lenses(), PAIRS, "one", "two").time)).toBe("#3 of 4, tied with 1 other");
  });

  it("prints not available, never a guess, when a figure is missing", () => {
    const none = threeReadings(null, PAIRS, "one", "two");
    expect(none.draw).toBeUndefined();
    expect(none.taste).toBeUndefined();
    expect(readingText(none.draw)).toBe(NOT_AVAILABLE);
    expect(tasteVerdict(none)).toBe("What taste changes for this pair: not available.");
    // A pair the lens data does not list, and one the day's clashes do not hold.
    const unlisted = threeReadings(lenses(), PAIRS, "nine", "ten");
    expect(readingText(unlisted.time)).toBe(NOT_AVAILABLE);
    expect(readingText(unlisted.draw)).toBe(NOT_AVAILABLE);
    expect(readingText(unlisted.taste)).toBe(NOT_AVAILABLE);
    // A pair the server ranks nowhere without taste.
    const unranked = threeReadings(lenses(), PAIRS, "five", "six");
    expect(readingText(unranked.draw)).toBe("not ranked");
    expect(tasteVerdict(unranked)).toBe("What taste changes for this pair: not available.");
  });

  it("prints the bare place when an older backend sends no count", () => {
    const readings = threeReadings(lenses({ priced_with_taste: undefined, priced_without_taste: undefined }), PAIRS, "one", "two");
    expect(readingText(readings.taste)).toBe("#1");
  });
});

describe("concurrentPairs", () => {
  it("lists every pair of the day's priced sets that share time, from the timetable, with its minutes", () => {
    const preset = parsePreset(rawTinyPreset());
    const pairs = concurrentPairs(preset, 0);
    const unpriced = new Set(preset.report.coverage.unscored.map((act) => act.act_id));
    const slots = preset.festival.timetable.filter((slot) => slot.day === 0 && !unpriced.has(slot.act_id));
    let expected = 0;
    for (const [i, p] of slots.entries()) {
      for (const q of slots.slice(i + 1)) if (Math.min(p.end, q.end) > Math.max(p.start, q.start)) expected += 1;
    }
    expect(pairs.length).toBe(expected);
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(pair.minutes).toBeGreaterThan(0);
      expect(unpriced.has(pair.aId) || unpriced.has(pair.bId)).toBe(false);
    }
  });
});

describe("WhatQlooChanges", () => {
  function render(props: { aId: string; bId: string; synthetic?: boolean; lenses?: Lenses | null }) {
    return renderToStaticMarkup(
      createElement(WhatQlooChanges, {
        lenses: props.lenses === undefined ? lenses() : props.lenses,
        pairs: PAIRS,
        aName: "Act One",
        bName: "Act Two",
        ...props,
      }),
    );
  }

  it("is its own block with an anchor: the clash's minutes, then the three readings in order, then its claim and limit", () => {
    const html = render({ aId: "one", bId: "two" });
    expect(html).toContain(`id="${WHAT_QLOO_ID}"`);
    const plain = text(html);
    const order = [
      "What Qloo changes",
      "Same 45-minute clash. Same timetable.",
      "Act One and Act Two",
      "Time only Minutes shared #3 of 4 tied with 1 other",
      "Time + draw Draw is Qloo popularity, 0 to 100 #7 of 40",
      "Time + draw + Qloo taste Taste overlap added: the index used here #1 of 40",
      QLOO_CHANGES_LINE,
    ].map((part) => plain.indexOf(part));
    order.forEach((at, i) => {
      expect(at, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    expect(QLOO_CHANGES_LINE).toBe(
      "Qloo changes which clash rises to the top. It does not prove #1 is the right clash to move.",
    );
    // The claim carries its own limit, so the caption is not repeated; no invented-day words on a real day.
    expect(plain).not.toContain(READINGS_CAPTION);
    expect(plain).not.toMatch(/invented/i);
    expect(plain).not.toMatch(/counterfactual/i);
  });

  /** The figure's markup, and each reading's row in it. */
  function figure(html: string) {
    const fig = /<div data-rank-figure="">[\s\S]*?<\/ol>[\s\S]*?(?=<p class="mt-4)/.exec(html)?.[0] ?? "";
    const row = (key: string) => new RegExp(`<li data-reading="${key}"[\\s\\S]*?</li>`).exec(fig)?.[0] ?? "";
    const at = (markup: string) => Number(/data-at="([^"]+)"/.exec(markup)?.[1]);
    const marker = (markup: string) => /<span data-marker="" class="([^"]*)" style="left:([^"]+)"/.exec(markup);
    return { fig, row, at, marker };
  }

  it("draws the three readings as one figure: three rows on one shared rank axis, #1 at the left", () => {
    const html = render({ aId: "one", bId: "two" });
    const { fig, row, at, marker } = figure(html);
    expect(fig).not.toBe("");
    // One figure, no card per row: three rows in one list, divided by hairlines across the figure only.
    expect(fig.match(/<ol\b/g)).toHaveLength(1);
    expect(fig).toContain('<ol class="divide-y divide-border">');
    expect(fig.match(/<li data-reading=/g)).toHaveLength(3);
    expect(fig).not.toMatch(/\brounded-(md|lg)\b|\bbg-card\b|\bp-3\.5\b/);
    // One axis for all three: the largest "of" among them (40), and one scale function, rankX.
    const readings = threeReadings(lenses(), PAIRS, "one", "two");
    const maxOf = figureScale([readings.time, readings.draw, readings.taste]);
    expect(maxOf).toBe(40);
    const expected = { time: rankX(3, 40), draw: rankX(7, 40), taste: rankX(1, 40) };
    expect(expected).toEqual({ time: 2 / 39, draw: 6 / 39, taste: 0 });
    for (const [key, x] of Object.entries(expected)) {
      expect(at(row(key)), key).toBe(x);
      expect(marker(row(key))?.[2], key).toBe(`${x * 100}%`);
      // Every row's axis: a 2px border-strong line with 1px, 8px ticks at #1 and at #maxOf, and no muted bar.
      expect(row(key)).toContain('<span class="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-border-strong"></span>');
      expect(row(key)).toContain('<span data-tick="first" class="absolute top-0 left-0 h-2 w-px bg-border-strong"></span>');
      expect(row(key)).toContain('<span data-tick="last" class="absolute top-0 right-0 h-2 w-px bg-border-strong"></span>');
    }
    expect(fig).not.toContain("bg-muted");
    // The marker: the ink dot on a 2px card halo, 12px, and 16px for the index used here.
    expect(marker(row("time"))?.[1]).toMatch(/rounded-full border-2 border-card bg-foreground size-3$/);
    expect(marker(row("draw"))?.[1]).toMatch(/size-3$/);
    expect(marker(row("taste"))?.[1]).toMatch(/size-4$/);
    // Each rank in the 1.75rem numeral with its own "of N" in 13px mono muted beside it.
    expect(row("time")).toMatch(/text-\[1\.75rem\] leading-none">#3<\/span> <span class="font-mono text-\[0\.8125rem\] text-muted-foreground tabular-nums">of 4<\/span>/);
    expect(row("draw")).toContain(">#7</span>");
    expect(row("taste")).toMatch(/>#1<\/span> <span[^>]*>of 40<\/span>/);
    // The tie stays, under its rank.
    expect(text(row("time"))).toBe("Time only Minutes shared #3 of 4 tied with 1 other");
  });

  it("keeps each row's own count beside its rank, and ends a shorter reading with a tick at its own last place", () => {
    // Invented: the draw reading ranks 30 pairs, the index 40, minutes alone 4.
    const html = render({ aId: "one", bId: "two", lenses: lenses({ priced_without_taste: 30 }) });
    const { row } = figure(html);
    const own = (markup: string) => /<span data-tick="own"[^>]*style="left:([^"]+)"/.exec(markup)?.[1];
    expect(text(row("draw"))).toContain("#7 of 30");
    expect(text(row("time"))).toContain("#3 of 4");
    expect(text(row("taste"))).toContain("#1 of 40");
    expect(own(row("draw"))).toBe(`${rankX(30, 40) * 100}%`);
    expect(own(row("time"))).toBe(`${rankX(4, 40) * 100}%`);
    expect(own(row("taste"))).toBeUndefined();
    // The axis is the longest reading's, whichever row holds it.
    expect(figureScale([{ rank: 2, of: 68 }, { rank: 1, of: 12 }, null])).toBe(68);
    expect(figureScale([undefined, null, { rank: 1 }])).toBeNull();
    expect(figureScale([{ rank: 1, of: 1 }])).toBeNull();
  });

  it("marks the index used here only by weight and a larger dot: no ink border, no fill, no vermilion", () => {
    const { fig, row } = figure(render({ aId: "one", bId: "two" }));
    expect(fig).not.toContain("border-foreground");
    expect(fig).not.toMatch(/\b(border|bg|text|fill|stroke)-primary\b/);
    const label = (markup: string) => /<p class="text-sm leading-5 (font-\w+)">/.exec(markup)?.[1];
    expect(label(row("time"))).toBe("font-normal");
    expect(label(row("draw"))).toBe("font-normal");
    expect(label(row("taste"))).toBe("font-semibold");
    // The labels and glosses keep their sizes: 14px ink, 13px muted, and nothing on the figure under 12px.
    expect(row("taste")).toContain('<p class="text-[0.8125rem] leading-snug text-muted-foreground">Taste overlap added: the index used here</p>');
    expect(fig).not.toMatch(/text-\[(?:0\.6875rem|0\.625rem|1[01]px)\]/);
  });

  it("captions the axis with numbers read from the readings, #1 at the left end and #maxOf at the right", () => {
    for (const [value, maxOf] of [
      [lenses(), 40],
      [lenses({ priced_with_taste: 68, priced_without_taste: 68 }), 68],
    ] as const) {
      const { fig } = figure(render({ aId: "one", bId: "two", lenses: value }));
      const caption = /<p data-axis-caption=""[^>]*>([\s\S]*?)<\/p>/.exec(fig)?.[1] ?? "";
      expect(text(caption)).toBe(`#1 Place among the day’s ${maxOf} clashes, #1 at the left #${maxOf}`);
      expect(caption).toMatch(/^<span aria-hidden="true" class="shrink-0 font-mono tabular-nums">#1<\/span>/);
      expect(caption).toMatch(new RegExp(`<span aria-hidden="true" class="shrink-0 font-mono tabular-nums">#${maxOf}</span>$`));
    }
    const { fig } = figure(render({ aId: "one", bId: "two" }));
    expect(fig).toMatch(/<p data-axis-caption="" class="[^"]*text-xs text-muted-foreground">/);
  });

  it("flips a place's label to the marker's left once the marker is past 70% of the track", () => {
    // Invented: taste overlap puts the pair 35th of 40, at 34/39 of the track.
    const late = lenses({
      with_taste: [{ a: "Act One", b: "Act Two", a_id: "one", b_id: "two", rank: 35, rank_without_taste: 7 }],
    });
    const { row } = figure(render({ aId: "one", bId: "two", lenses: late }));
    expect(row("taste")).toMatch(/data-at="[^"]+" data-flip=""/);
    expect(row("taste")).toMatch(/ml-auto items-end text-right" style="margin-right:calc\([\d.]+% \+ 14px\)/);
    expect(row("draw")).not.toContain("data-flip");
    expect(row("draw")).toMatch(/style="margin-left:calc\([\d.]+% \+ 12px\)/);
  });

  it("draws no axis when no reading has a place, and keeps the rows as text", () => {
    const html = render({ aId: "nine", bId: "ten", lenses: null });
    const { fig } = figure(html);
    expect(fig).not.toContain("data-axis");
    expect(fig).not.toContain("data-marker");
    expect(fig.match(/<li data-reading=/g)).toHaveLength(3);
    expect(text(fig)).toBe(
      "Time only Minutes shared not available Time + draw Draw is Qloo popularity, 0 to 100 not available Time + draw + Qloo taste Taste overlap added: the index used here not available",
    );
    // A reading with no figure in a drawn figure keeps its text and has no marker.
    const partial = figure(render({ aId: "one", bId: "two", lenses: null }));
    expect(partial.row("time")).toContain("data-marker");
    expect(partial.row("draw")).not.toContain("data-marker");
    expect(text(partial.row("draw"))).toBe("Time + draw Draw is Qloo popularity, 0 to 100 not available");
  });

  it("uses no teal in the figure on the invented day", () => {
    const { fig } = figure(render({ aId: "one", bId: "two", synthetic: true }));
    expect(fig).not.toMatch(/prov-qloo|teal/);
    expect(text(fig)).not.toMatch(/Qloo/);
  });

  it("makes no claim when taste does not move the pair, and keeps the caption then", () => {
    const plain = text(render({ aId: "three", bId: "four" }));
    expect(plain).toContain("Same 60-minute clash.");
    expect(plain).toContain("Taste agrees with time and draw: #2 either way.");
    expect(plain).not.toContain(QLOO_CHANGES_LINE);
    expect(plain).toContain(READINGS_CAPTION);
    expect(changesLine(threeReadings(lenses(), PAIRS, "three", "four"))).toBe("Taste agrees with time and draw: #2 either way.");
  });

  it("labels the invented day everywhere and never credits Qloo for it", () => {
    const plain = text(render({ aId: "one", bId: "two", synthetic: true }));
    expect(plain).toContain("What taste changes · Invented day");
    expect(plain).toContain("Time + draw Draw is invented popularity #7 of 40");
    expect(plain).toContain("Time + draw + invented taste");
    expect(plain).toContain(TASTE_CHANGES_LINE_SYNTHETIC);
    expect(plain).toContain(READINGS_CAPTION_SYNTHETIC);
    expect(plain).not.toMatch(/Qloo/);
  });

  it("prints not available, never a guess, when the lens data is missing", () => {
    const plain = text(render({ aId: "one", bId: "two", lenses: null }));
    expect(plain).toContain("Time + draw Draw is Qloo popularity, 0 to 100 not available");
    expect(plain).toContain("Time + draw + Qloo taste Taste overlap added: the index used here not available");
    expect(plain).toContain("What taste changes for this pair: not available.");
    expect(plain).not.toContain(QLOO_CHANGES_LINE);
  });
});

describe("WhatQlooPointer", () => {
  it("leaves one line in the card, pointing at the block", () => {
    const html = renderToStaticMarkup(
      createElement(WhatQlooPointer, { lenses: lenses(), pairs: PAIRS, aId: "one", bId: "two" }),
    );
    expect(text(html)).toBe(
      "Time alone ranks this pair #3, time and draw (Qloo popularity) #7, with taste #1. See what Qloo changes",
    );
    expect(html).toContain(`href="#${WHAT_QLOO_ID}"`);
    const synthetic = renderToStaticMarkup(
      createElement(WhatQlooPointer, { lenses: lenses(), pairs: PAIRS, aId: "one", bId: "two", synthetic: true }),
    );
    expect(text(synthetic)).toBe(
      "Time alone ranks this pair #3, time and draw (invented popularity) #7, with taste #1. See what taste changes",
    );
    const same = renderToStaticMarkup(
      createElement(WhatQlooPointer, { lenses: lenses(), pairs: PAIRS, aId: "three", bId: "four" }),
    );
    expect(text(same)).toBe("Taste agrees with time and draw (Qloo popularity): #2 either way. See what Qloo changes");
  });
});

describe("TasteSection", () => {
  const ACTS = [
    { id: "one", name: "Act One", popularity: 0.95 },
    { id: "two", name: "Act Two", popularity: 0.94 },
    { id: "three", name: "Act Three", popularity: 0.93 },
  ] as unknown as Act[];
  const TWIN: Twin = {
    act: "Act One",
    act_id: "one",
    shared: { act: "Act Two", act_id: "two", overlap: 0.9, draw_pct: 0.8 },
    separate: { act: "Act Three", act_id: "three", overlap: 0.2, draw_pct: 0.8 },
    gap: 0.7,
  };
  const CLASH = { aId: "one", bId: "two", aName: "Act One", bName: "Act Two" };
  /**
   * The failed test's pinned words, up to "did better" (the evidence lane owns what follows it, such as
   * popularity's own figure).
   */
  const FAILED =
    "Our test failed: taste overlap put 46.8% of complained-about clashes in the top quarter of their day, below our 60% bar. Popularity, also a Qloo field, did better";
  /** The one sentence of the failed test that names Qloo: it is about the published festivals' test. */
  const FAILED_QLOO_SENTENCE = /^Popularity, also a Qloo field, did better[ .]/;

  function render(
    props: Partial<{
      clash: typeof CLASH | null;
      lenses: Lenses | null;
      twins: Twin[];
      synthetic: boolean;
      ranked: PairClash[];
    }> = {},
  ): string {
    return renderToStaticMarkup(
      createElement(TasteSection, {
        clash: props.clash === undefined ? CLASH : props.clash,
        lenses: props.lenses === undefined ? lenses() : props.lenses,
        pairs: PAIRS,
        twins: props.twins ?? [TWIN],
        acts: ACTS,
        ranked: props.ranked ?? [],
        onOpen: () => {},
        synthetic: props.synthetic,
      }),
    );
  }

  /** The markup with every `<details>` block taken out: what a reader sees with no click. */
  function withoutDisclosures(html: string): string {
    let out = html;
    for (let before = ""; before !== out; ) {
      before = out;
      out = out.replace(/<details\b[^>]*>(?:(?!<details\b)[\s\S])*?<\/details>/g, "");
    }
    return out;
  }

  it("is one section with the block's anchor: the three readings and their limit visible, two closed disclosures, then the failed test", () => {
    const html = render();
    expect(html.match(/<section\b/g)?.length).toBe(1);
    expect(html.match(new RegExp(`id="${WHAT_QLOO_ID}"`, "g"))?.length).toBe(1);
    expect(html.match(/<h2\b/g)?.length).toBe(1);
    const plain = text(html);
    const order = [
      "What Qloo changes",
      "Same 45-minute clash. Same timetable.",
      "Act One and Act Two, the clash in the decision above, ranked three ways.",
      "Time only Minutes shared #3 of 4 tied with 1 other",
      "Time + draw Draw is Qloo popularity, 0 to 100 #7 of 40",
      "Time + draw + Qloo taste Taste overlap added: the index used here #1 of 40",
      QLOO_CHANGES_LINE,
      "Equal-popularity pairs (1)",
      "Two rankings of this day (15 costliest clashes)",
      "What the failed test taught us.",
      FAILED,
    ].map((part) => plain.indexOf(part));
    order.forEach((at, i) => {
      expect(at, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    // Exactly one disclosure each, both closed, none nested: the embedded blocks bring no disclosure of their own.
    expect(html.match(/<details\b/g)?.length).toBe(2);
    expect(html).toMatch(/<details(?![^>]*\bopen\b)[^>]*><summary[^>]*>Equal-popularity pairs \(1\)/);
    expect(html).toMatch(/<details(?![^>]*\bopen\b)[^>]*><summary[^>]*><span>Two rankings of this day/);
    expect(html).not.toContain("See the equal-popularity pairs");
    // The embedded lens is an h3 with h4 list headings, under the section's one h2.
    expect(html).toMatch(/<h3 id="taste-lens-heading" class="type-title">What taste overlap changes<\/h3>/);
    expect(html).toContain("<h4");
    // Visible with no click: the claim's limit and the failed test; inside the disclosures: the cards and the lists.
    const visible = text(withoutDisclosures(html));
    expect(visible).toContain(QLOO_CHANGES_LINE);
    expect(visible).toContain(FAILED);
    expect(visible).toContain(
      "So the taste reading is a second opinion beside time and draw: the part Qloo’s taste data adds to the index, never the verdict on its own.",
    );
    expect(visible).not.toContain("never folded into a verdict");
    expect(withoutDisclosures(html)).toContain('href="/method#tested"');
    expect(visible).not.toContain("Two rivals for");
    expect(visible).not.toContain("Costliest with taste overlap, lower without");
    expect(plain).toContain("Two rivals for Act One");
    expect(plain).toContain("This shows how taste overlap reorders this ranking");
  });

  it("draws the same one figure, with its line and caption directly under it, and closes with the failed test", () => {
    const html = render({ clash: { ...CLASH, aId: "three", bId: "four" } });
    expect(html.match(/<div data-rank-figure="">/g)).toHaveLength(1);
    expect(html).not.toContain("border-foreground");
    expect(html).not.toMatch(/<li[^>]*class="[^"]*\brounded-md\b/);
    // The figure's axis caption, then the changes line, then the readings caption: nothing between them.
    const after = html.slice(html.indexOf("data-axis-caption"));
    expect(after).toMatch(
      /^data-axis-caption=""[^>]*>[\s\S]*?<\/p><\/div><\/div><p class="mt-4 font-semibold">Taste agrees with time and draw: #2 either way\.<\/p><p class="mt-1\.5 max-w-prose text-\[0\.8125rem\] leading-snug">/,
    );
    expect(text(after)).toContain(READINGS_CAPTION);
    // The failed test is the last block, outside every disclosure.
    const visible = withoutDisclosures(html);
    expect(text(visible).endsWith("How we know")).toBe(true);
    expect(text(visible)).toContain(FAILED);
    expect(visible.lastIndexOf("What the failed test taught us.")).toBeGreaterThan(visible.lastIndexOf("data-rank-figure"));
  });

  it("keeps the caption visible when taste does not move the pair", () => {
    const visible = text(withoutDisclosures(render({ clash: { ...CLASH, aId: "three", bId: "four" } })));
    expect(visible).toContain("Taste agrees with time and draw: #2 either way.");
    expect(visible).toContain(READINGS_CAPTION);
  });

  it("says the other half of what taste does: the costliest pair on time and draw that falls furthest with taste, a candidate to keep", () => {
    // In the fixture, Act Seven and Act Eight fall furthest: #1 on time and draw, #19 with taste.
    expect(otherHalfPair(lenses())).toMatchObject({ a: "Act Seven", b: "Act Eight", from: 1, to: 19 });
    const line =
      "Taste also lowers some clashes: Act Seven × Act Eight ranks #1 on time and draw but #19 with taste. Lower priority by this index; a candidate to keep.";
    // On both kinds of day: when taste moves the card's own pair, and when it leaves it where it was.
    for (const clash of [CLASH, { ...CLASH, aId: "three", bId: "four" }]) {
      const visible = withoutDisclosures(render({ clash }));
      expect(text(visible)).toContain(line);
      expect(visible.match(/data-other-half=""/g)).toHaveLength(1);
      expect(visible).not.toMatch(/data-other-half=""[^>]*class="[^"]*(prov-qloo|text-primary)/);
      // Visible, under the heading (first in the readings' column when taste leaves the pair where it was, after
      // the bold line when taste moves it) and before the disclosures and the failed test.
      expect(text(visible).indexOf(line)).toBeGreaterThan(text(visible).indexOf("Same timetable"));
      expect(visible.indexOf("data-other-half")).toBeLessThan(visible.indexOf("What the failed test taught us."));
    }
    // It replaces the old mover sentence: never both.
    expect(text(render({ clash: { ...CLASH, aId: "three", bId: "four" } }))).not.toContain("the most:");
    // Never "how many people", never a verdict.
    expect(line).not.toMatch(/same crowd|same people|overlap little|costs little|fine to keep|fans/i);
  });

  it("leads with the clash taste lowers when taste leaves the card's pair where it was (Riot Fest's #1 either way), and keeps it after the readings when taste moves the pair (Glastonbury)", () => {
    // Round 33 (H4): the order follows the readings, never a festival name, and no sentence is added.
    const line =
      "Taste also lowers some clashes: Act Seven × Act Eight ranks #1 on time and draw but #19 with taste. Lower priority by this index; a candidate to keep.";
    // Riot Fest's case, invented here: the card's pair is #2 either way, so the clash taste lowers is the finding.
    const still = text(withoutDisclosures(render({ clash: { ...CLASH, aId: "three", bId: "four" } })));
    const either = "Taste agrees with time and draw: #2 either way.";
    expect(still).toContain(either);
    expect(still.indexOf(line)).toBeGreaterThan(still.indexOf("ranked three ways."));
    expect(still.indexOf(line)).toBeLessThan(still.indexOf("Time only Minutes shared"));
    expect(still.indexOf(line)).toBeLessThan(still.indexOf(either));
    // Glastonbury's case, invented here: taste moves the card's pair (#7 to #1), so the readings and their claim
    // lead and the line follows them, as before.
    const moved = text(withoutDisclosures(render()));
    expect(moved.indexOf(line)).toBeGreaterThan(moved.indexOf("Time + draw + Qloo taste"));
    expect(moved.indexOf(line)).toBeGreaterThan(moved.indexOf(QLOO_CHANGES_LINE));
    // The same line, once, on both.
    for (const plain of [still, moved]) expect(plain.split(line).length - 1).toBe(1);
  });

  it("keeps every line of the failed test the round-33 compression must keep outside any disclosure", () => {
    for (const props of [{}, { clash: { ...CLASH, aId: "three", bId: "four" } }, { clash: null, lenses: null, twins: [] }]) {
      const html = render(props);
      const open = withoutDisclosures(html);
      const visible = text(open);
      for (const needle of [
        "What the failed test taught us.",
        "Our test failed: taste overlap put 46.8% of complained-about clashes in the top quarter of their day, below our 60% bar.",
        "Popularity, also a Qloo field, did better.",
        "It reached 57.8%.",
        "The exploratory follow-up did not establish an advantage over popularity.",
        "second opinion beside time and draw",
        "never the verdict on its own",
      ]) {
        expect(visible, needle).toContain(needle);
      }
      expect(open).toMatch(/<a[^>]*href="\/method#tested"[^>]*>How we know<\/a>/);
    }
  });

  it("adds the pair's own taste overlap only when the page holds that pair's reading", () => {
    const pair = { a: { act_id: "eight", name: "Act Eight" }, b: { act_id: "seven", name: "Act Seven" }, audience_overlap: 0.12 } as unknown as PairClash;
    expect(text(render({ ranked: [pair] }))).toContain(
      "Taste also lowers some clashes: Act Seven × Act Eight ranks #1 on time and draw but #19 with taste (taste overlap 12 of 100 on this bill). Lower priority by this index; a candidate to keep.",
    );
    expect(text(render({ ranked: [] }))).not.toContain("(taste overlap");
  });

  it("renders nothing when no costly pair falls with taste", () => {
    const still = lenses({
      without_taste: [
        { a: "Act Three", b: "Act Four", a_id: "three", b_id: "four", rank: 2, rank_with_taste: 2 },
        { a: "Act Seven", b: "Act Eight", a_id: "seven", b_id: "eight", rank: 4, rank_with_taste: 1 },
        { a: "Act Five", b: "Act Six", a_id: "five", b_id: "six", rank: 5, rank_with_taste: null },
      ],
    });
    expect(otherHalfPair(still)).toBeNull();
    const html = render({ lenses: still });
    expect(html).not.toContain("data-other-half");
    expect(text(html)).not.toContain("Taste also lowers");
  });

  it("says it is invented on the invented day and credits no source", () => {
    const plain = text(render({ synthetic: true }));
    const line =
      "On this invented day, taste also lowers some clashes: Act Seven × Act Eight ranks #1 on time and draw but #19 with taste. Lower priority by this index; a candidate to keep.";
    expect(plain).toContain(line);
    expect(qlooCredits(line)).toEqual([]);
    const pair = { a: { act_id: "seven", name: "Act Seven" }, b: { act_id: "eight", name: "Act Eight" }, audience_overlap: 0.3 } as unknown as PairClash;
    expect(text(render({ synthetic: true, ranked: [pair] }))).toContain("(invented taste overlap 30 of 100 on this bill)");
  });

  it("still renders its heading and the failed test, visible, with no clash and no lens data", () => {
    for (const props of [{ clash: null }, { lenses: null }, { clash: null, lenses: null, twins: [] }]) {
      const html = render(props);
      expect(html).toContain(`id="${WHAT_QLOO_ID}"`);
      expect(html).toMatch(/<h2 id="what-qloo-heading" class="type-title">What Qloo changes<\/h2>/);
      expect(text(html)).not.toContain("ranked three ways");
      expect(text(withoutDisclosures(html))).toContain(FAILED);
      expect(withoutDisclosures(html)).toContain('href="/method#tested"');
    }
    // No lens data: no rankings disclosure; the twins keep theirs.
    const noLenses = render({ lenses: null });
    expect(noLenses.match(/<details\b/g)?.length).toBe(1);
    expect(text(noLenses)).not.toContain("Two rankings of this day");
    // Nothing to fold: no disclosure at all, and the failed test still closes the section.
    const bare = render({ clash: null, lenses: null, twins: [] });
    expect(bare).not.toContain("<details");
    expect(text(bare)).toMatch(/How we know$/);
  });

  it("still renders the failed test, visible, with no equal-popularity pairs", () => {
    const html = render({ twins: [] });
    expect(text(html)).not.toContain("Equal-popularity pairs");
    expect(html.match(/<details\b/g)?.length).toBe(1);
    expect(text(withoutDisclosures(html))).toContain(FAILED);
  });

  it("labels the invented day and credits Qloo for none of its figures; the failed test is still visible", () => {
    for (const props of [{}, { clash: null, lenses: null, twins: [] }]) {
      const html = render({ ...props, synthetic: true });
      const plain = text(html);
      expect(text(withoutDisclosures(html))).toContain(FAILED);
      // The one Qloo sentence left is the failed test's, about the published festivals' test; nothing
      // credits Qloo for the invented day's readings, pairs or rankings.
      const credits = qlooCredits(plain);
      expect(credits).toHaveLength(1);
      expect(credits[0]).toMatch(FAILED_QLOO_SENTENCE);
      expect(qlooCredits(plain.replace(FAILED, ""))).toEqual([]);
    }
    const plain = text(render({ synthetic: true }));
    expect(plain).toContain("What taste changes · Invented day");
    expect(plain).toContain(TASTE_CHANGES_LINE_SYNTHETIC);
    expect(plain).toContain(READINGS_CAPTION_SYNTHETIC);
    expect(plain).toContain("Draw is an invented popularity figure");
    expect(text(render({ synthetic: true, clash: null }))).toContain("What taste changes");
  });
});
