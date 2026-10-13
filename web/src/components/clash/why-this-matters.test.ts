import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SyntheticContext } from "@/components/site/synthetic-context";
import { qlooCredits } from "@/lib/credit";
import { PAYER_GUESS, PILOT_TERMS, type Demand } from "@/lib/demand";
import { METHOD_FIGURES } from "@/lib/method-figures";
import { PUBLIC_SOURCES } from "@/lib/public-sources";
import { PUBLIC_VOICES } from "@/lib/public-voices";

import { TasteSection } from "./why-qloo";
import {
  BacktestBars,
  COMPLAINT_SOURCES,
  COMPLAINTS_ELSEWHERE,
  FIGURE_DOMAIN,
  FIGURE_TICKS,
  FailedTestNote,
  VOICES_LIMIT,
  WHY_THIS_MATTERS_ID,
  PRESS_OUTLETS,
  WhyThisMatters,
  along,
  complaintCaption,
  isForumThread,
} from "./why-this-matters";

// Every name and figure below is invented for the test, except the published figures the blocks read
// from METHOD_FIGURES, PILOT and PUBLIC_VOICES.

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
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

const FAILED =
  "Our test failed: taste overlap put 46.8% of complained-about clashes in the top quarter of their day, below our 60% bar. Popularity, also a Qloo field, did better. It reached 57.8%. The exploratory follow-up did not establish an advantage over popularity.";
const SECOND_OPINION =
  "So the taste reading is a second opinion beside time and draw: it is one of the four parts of the price of each clash, the part Qloo adds, and never the verdict on its own. It is nearly unrelated to popularity (r = 0.08).";

describe("FailedTestNote", () => {
  it("prints the failed pre-set test and what it taught us, with no AUC jargon, and links to the test on /method", () => {
    const html = renderToStaticMarkup(createElement(FailedTestNote));
    const plain = text(html);
    expect(plain).toContain("What the failed test taught us.");
    expect(plain).toContain(FAILED);
    // The AUC figures are on /method, where AUC is defined; the home block links there.
    expect(plain).not.toMatch(/\bAUC\b/);
    expect(html).toContain('href="/method#tested"');
    expect(plain).toContain(SECOND_OPINION);
    expect(plain).toMatch(/\(r = 0\.08\)\. How we know$/);
    // Round 32 (V3): the taste-removed check did not establish that taste adds to time and draw, so no
    // "Exploratory:" sentence about taste adding something is added here.
    expect(plain).not.toMatch(/Exploratory:|adds something|taste adds/);
    // Round 31: the price does include taste, so the note no longer says it is kept out of a verdict.
    expect(plain).not.toContain("never folded into a verdict");
    // The correlation is the figures module's, never typed.
    expect(plain).toContain(`(r = ${METHOD_FIGURES.backtest.popularityCorrelation})`);
    // Never a disclosure of its own: the failed test reads with no click.
    expect(html).not.toContain("<details");
  });
});

describe("WhyThisMatters", () => {
  it("prints the complaint figures, what exists and what is not known, and the demand shell", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const plain = text(html);
    expect(html).toContain(`id="${WHY_THIS_MATTERS_ID}"`);
    expect(plain).toContain("Who has complained, and what nobody has tested");
    expect(plain).toContain("45 clashes that fans or the press complained about at 5 festivals");
    expect(plain).toContain("86 pairs, median 50 minutes, and how the lists lean");
    expect(plain).toContain("Press lists lean toward headliners, which flatters any taste-based method.");
    expect(plain).not.toMatch(/\bAUC\b/);
    expect(plain).toContain("Whether programmers would use or pay for this has not been tested.");
    expect(plain).not.toContain("They do not show that anyone would use or pay for this.");
    expect(plain).toContain("Who would pay is not known.");
    // Pending: no counts, no quote.
    expect(plain).not.toMatch(/We asked|One programmer told us/);
    // The failed test moved to the taste section (FailedTestNote); it is not printed twice.
    expect(plain).not.toContain("Our test failed");
  });

  it("keeps the figures, the competitor search with its limit, what is not known and the pilot visible with no click", () => {
    const visible = text(withoutDisclosures(renderToStaticMarkup(createElement(WhyThisMatters))));
    expect(visible).toContain("45 clashes that fans or the press complained about at 5 festivals had a verified overlap in time.");
    expect(visible).toContain(
      "No scheduler we found reads audience overlap Our search, October 2026: absence of evidence only. Who would pay is not known.",
    );
    expect(visible).toContain("Who would pay is not known.");
    expect(visible).toContain("Pilot offer");
    expect(visible).toContain("Walk through the Glastonbury 2025 Sunday brief with me");
    expect(visible.indexOf("Walk through")).toBeGreaterThan(visible.indexOf("Pilot offer"));
    expect(visible).toContain("Contact is on the Devpost page.");
    // Three voices print in the open; the fourth and the sentence that limits them wait in one disclosure.
    expect(visible).toContain("The team had expected different audiences, and the clash drew criticism.");
    expect(visible).not.toContain(VOICES_LIMIT);
    expect(visible).not.toContain("Builds the Portola lineup in a spreadsheet that holds mock set times.");
    // The rest of each finding is in its own disclosure, still in the server HTML.
    const plain = text(renderToStaticMarkup(createElement(WhyThisMatters)));
    expect(plain).toContain(
      "86 pairs, median 50 minutes, and how the lists lean Press lists lean toward headliners, which flatters any taste-based method.",
    );
    expect(plain).toContain(
      "Festival Pro and Lineup Ninja Both check double bookings and changeovers. We found none that reads audience overlap (our search, October 2026).",
    );
  });

  it("links four public voices to their pages and names no one without a source", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    expect((html.match(/rel="noopener noreferrer"/g) ?? []).length).toBe(5);
    for (const host of ["bbc.co.uk", "nme.com", "alpsinc.kr", "abc.net.au", "www.billboard.com"]) expect(html).toContain(host);
    expect(html).not.toContain("hadnews");
    expect(html).not.toContain("&quot;");
    expect(text(html)).toContain("The team had expected different audiences, and the clash drew criticism.");
  });

  it("prints three voices as a ruled list with no bar and no quotation marks, the name then dated source links under each, and keeps the fourth in one closed disclosure", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    expect(PUBLIC_VOICES.length).toBe(4);
    expect(text(html)).toContain("What programmers have said in public");
    // No left bar of any width on a quote, and no top rule on the section's blocks.
    expect(html).not.toContain("border-l-2");
    expect(html).not.toContain("border-t-2");
    const quotes = html.match(/<li data-voice="true"[^>]*>[\s\S]*?<\/li>/g) ?? [];
    expect(quotes).toHaveLength(3);
    PUBLIC_VOICES.slice(0, 3).forEach((voice, i) => {
      expect(quotes[i]).not.toContain("border-l");
      // One item of the ruled list, 20px above and below, the full column wide (the rule spans the column). The
      // paraphrase is 18px at 1.55, 500 weight, in ink, at most 62ch, with no stripe, italic or indent; the
      // attribution on its own line, 13px muted, name then links; no parentheses.
      expect(quotes[i]).toMatch(/^<li data-voice="true" class="py-5">/);
      expect(quotes[i]).toMatch(/<p class="max-w-\[62ch\] text-\[1\.125rem\] leading-\[1\.55\] font-medium text-foreground">/);
      expect(quotes[i]).not.toMatch(/\bitalic\b|\bindent-|\bpl-\d|\bml-\d/);
      expect(quotes[i]).toMatch(/<p class="[^"]*text-\[0\.8125rem\][^"]*text-muted-foreground">/);
      expect(text(quotes[i])).toContain(voice.said);
      expect(text(quotes[i])).toContain(voice.who);
      expect(text(quotes[i])).not.toMatch(/[()]/);
      expect(text(quotes[i]).indexOf(voice.who)).toBeLessThan(text(quotes[i]).indexOf(voice.links[0].label));
      for (const link of voice.links) expect(quotes[i]).toContain(link.href.replace(/&/g, "&amp;"));
    });
    // The voices are one ul, divided by 1px border-border rules between items (none above the first), and its
    // fold sits at the list's foot.
    expect(html).toMatch(/<ul class="mt-1 divide-y divide-border"><li data-voice="true"/);
    expect(html.match(/divide-y/g)).toHaveLength(1);
    expect(html.indexOf("Danny Bell, Goldenvoice, and what these sources")).toBeGreaterThan(html.lastIndexOf('data-voice="true"'));
    const opener = html.match(/<details(?![^>]*open)[^>]*><summary[^>]*>(?:<span[^>]*>)*Danny Bell, Goldenvoice, and what these sources <\/span><span class="whitespace-nowrap"><span[^>]*>show/);
    expect(opener).not.toBeNull();
    const at = opener?.index ?? -1;
    const inside = html.slice(at, html.indexOf("</details>", at));
    expect(inside).toContain("Builds the Portola lineup in a spreadsheet that holds mock set times.");
    expect(inside).toContain("www.billboard.com");
    // Paraphrases: never set in quotation marks, so no quote glyph hangs in the margin either.
    expect(html).not.toContain("&quot;");
    expect(html).not.toMatch(/[\u201c\u201d]/);
  });

  it("prints the sentence that limits the voices once, rewritten, inside the sources disclosure after the fourth source", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const sentence = "These sources show that clashes are a known complaint. Whether programmers would use or pay for this has not been tested.";
    expect(VOICES_LIMIT).toBe(sentence);
    expect(text(html).split(sentence).length - 1).toBe(1);
    expect(html).not.toContain("These show that clashes are a known problem. They do not show that anyone would use or pay for this.");
    // Its new place: the last line of the closed sources disclosure, under the fourth voice.
    const fold = html.match(/<details[^>]*><summary[^>]*>(?:<span[^>]*>)*Danny Bell, Goldenvoice, and what these sources <\/span><span class="whitespace-nowrap"><span[^>]*>show[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(fold).not.toBe("");
    const limit = fold.match(/<p data-voices-limit="true"[^>]*>([\s\S]*?)<\/p>/);
    expect(limit?.[1]).toBe(sentence);
    expect(fold.indexOf("data-voices-limit")).toBeGreaterThan(fold.indexOf("Builds the Portola lineup"));
    expect(text(withoutDisclosures(html))).not.toContain(sentence);
  });

  it("closes the last column with the pilot offer, its limits from the constant, and no contact until the owner adds one", () => {
    const plain = text(renderToStaticMarkup(createElement(WhyThisMatters)));
    // Round 32 (V4): the label, then the offer, word for word. It offers only what costs no Qloo request: a walk
    // through a published day's brief, and rule checks on the festival's own draft that run in the browser.
    expect(plain).toContain("Pilot offer Walk through the Glastonbury 2025 Sunday brief with me and say where it matches how your team would set those times. Your own draft can go through Check a draft grid, whose rule checks run in your browser and send nothing. Success: you say which suggestion you would take or turn down, and why.");
    // No promise to price or brief a new bill.
    expect(plain).not.toMatch(/Send one day|I will price|send back a brief|up to \d+ bills/);
    // What pricing a new bill would cost, true and conditional, with no offer, in a closed disclosure with a
    // 10px-rounded summary, still in the server HTML.
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    expect(html).toMatch(/<details(?![^>]*\bopen\b)[^>]*><summary class="[^"]*\brounded-md\b[^"]*">(?:<span[^>]*>)*About 40 Qloo requests per bill, only with the festival’s <\/span><span class="whitespace-nowrap"><span[^>]*>OK</);
    expect(plain).toContain("About 40 Qloo requests per bill, only with the festival’s OK Pricing a new bill is not offered: comparing its longest overlaps takes about 40 Qloo requests of the 10,000 shared this month, and a full-day reading took 104 and 70. Either needs the festival’s OK. One answer is not a market.");
    expect(plain).toContain("Contact is on the Devpost page.");
    expect(plain.indexOf("Pilot offer")).toBeGreaterThan(plain.indexOf("Who would pay is not known."));
    // The owner has not said bills are deleted after the run, so the page does not say it.
    expect(plain).not.toMatch(/deleted after the run/i);
    const withContact = renderToStaticMarkup(createElement(WhyThisMatters, { contact: "pilot@example.com" }));
    expect(withContact).toContain('href="mailto:pilot@example.com"');
    expect(text(withContact)).not.toContain("Contact is on the Devpost page.");
    expect(renderToStaticMarkup(createElement(WhyThisMatters, { contact: "https://example.com/pilot" }))).toContain(
      'href="https://example.com/pilot"',
    );
  });

  it("names the section in its heading with no eyebrow, and states the complaint test in one sentence instead of repeating the /method chart", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    expect(html).toMatch(/<h2 id="why-this-matters-heading" class="type-title">Who has complained, and what nobody has tested<\/h2>/);
    expect(text(html)).not.toContain("The problem Who has complained");
    // The chart is on /method only.
    expect(html).not.toContain("<figure");
    expect(html).not.toContain("data-bar-value");
    // Round 32: the complaint test's shares are said once, in FailedTestNote (46.8% and popularity's 57.8%), which
    // links to the full test; this section no longer repeats them in its fold.
    expect(html).not.toContain("data-test-line");
    expect(text(html)).not.toMatch(/57\.8%|46\.8%/);
    expect(text(renderToStaticMarkup(createElement(FailedTestNote)))).toContain("It reached 57.8%.");
    expect(html).toMatch(/<summary[^>]*>(?:<span[^>]*>)*86 pairs, median 50 minutes, and how the lists <\/span><span class="whitespace-nowrap"><span[^>]*>lean</);
  });

  it("sets no all-caps kicker anywhere in the section: each finding opens with an 18px semibold conclusion, the pilot's head 16px", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    expect(html).not.toContain("type-kicker");
    for (const head of ["The problem is public", "What programmers have said in public", "No scheduler we found reads audience overlap"]) {
      expect(html).toContain(`<h3 class="text-lg leading-snug font-semibold">${head}</h3>`);
    }
    // Every disclosure is named for what it holds, as a text action, not an accordion row: no rule above it and no
    // leading mark, the summary's words in 15px medium ink (the site's 15px, never a 13px override) with the page's
    // text-link underline (1px border-strong, 4px off the text, ink on hover), then a trailing 14px ink chevron after
    // the words that turns 180 degrees on open, the turn animated only under motion-safe. The 44px row stays.
    const summaries = [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => text(m[1]));
    expect(summaries).toEqual([
      "86 pairs, median 50 minutes, and how the lists lean",
      "Danny Bell, Goldenvoice, and what these sources show",
      "Festival Pro and Lineup Ninja",
      "About 40 Qloo requests per bill, only with the festival’s OK",
    ]);
    for (const generic of ["One more source", "Pilot limits", "More details"]) expect(html).not.toContain(`>${generic}<`);
    expect(html).not.toContain("data-fold-mark");
    expect(html).not.toContain("lucide-chevron-right");
    expect(html).not.toContain("cc-disclosure-mark");
    expect(html).not.toContain("group-hover/fold:bg-accent");
    const folds = [...html.matchAll(/<details class="([^"]*)"><summary class="([^"]*)">([\s\S]*?)<\/summary>/g)];
    expect(folds).toHaveLength(4);
    for (const [, detailsCls, summaryCls, inner] of folds) {
      expect(detailsCls).toMatch(/^group cc-disclosure border-t-0!/);
      expect(detailsCls).not.toMatch(/\bopen\b/);
      // The 44px row is the shared summary utility's min-height; the weight is set down to medium.
      expect(summaryCls).toMatch(/^cc-disclosure-summary group\/fold rounded-md font-medium! hover:no-underline!( justify-start)?$/);
      expect(summaryCls).not.toContain("text-[0.8125rem]");
      // The words first, underlined, then the chevron: never a leading mark. The last word and the chevron share a
      // no-wrap span, so a wrapped summary carries the chevron down with its last word, never alone on a line.
      expect(inner).toMatch(
        /^<span data-fold-text="true"><span class="underline decoration-border-strong decoration-1 underline-offset-4 group-hover\/fold:decoration-foreground">[^<]* <\/span><span class="whitespace-nowrap"><span class="underline decoration-border-strong decoration-1 underline-offset-4 group-hover\/fold:decoration-foreground">[^< ]+<\/span><svg [^>]*class="lucide lucide-chevron-down ml-1\.5 inline-block size-3\.5 align-\[-0\.125em\] group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out"[^>]*>[\s\S]*<\/svg><\/span><\/span>$/,
      );
      expect(inner).toMatch(/<svg [^>]*aria-hidden="true"/);
      // The turn is drawn under reduced motion too (group-open:rotate-180 has no motion prefix); only the
      // transition is motion-safe.
      expect(inner).not.toMatch(/(?<!motion-safe:)transition/);
      expect(inner).not.toMatch(/\bbg-/);
    }
    expect(html).not.toMatch(/bg-foreground\/|text-background\//);
    expect(html).toContain('<h3 class="text-base leading-snug font-semibold">Pilot offer</h3>');
  });

  it("draws the /method bars square at 0 and round at the value end on a 0 to 75 axis, the two Qloo measures in solid ink and the two baselines thin and muted, values clear of the rule", () => {
    const figure = renderToStaticMarkup(createElement(BacktestBars, { threshold: 60 }));
    expect(figure.match(/<span data-bar-value="true" data-label-place="[^"]*" class="[^"]*font-mono text-xs[^"]*text-foreground[^"]*">\d+\.\d%<\/span>/g)).toHaveLength(4);
    // The axis ends on a round tick: 0, 25, 50, 75.
    expect(FIGURE_DOMAIN).toBe(75);
    expect(FIGURE_TICKS).toEqual([0, 25, 50, 75]);
    expect(FIGURE_TICKS[FIGURE_TICKS.length - 1]).toBe(FIGURE_DOMAIN);
    expect(text(figure)).toMatch(/Random 26\.3% 0 25 50 75$/);
    // Taste overlap 46.8 of 75: square at the 0 axis, a capsule end at its value (radius = half the bar's height).
    expect(along(46.8)).toBe("62.4%");
    expect(figure).toContain(`style="width:${along(46.8)}"`);
    expect(figure).not.toContain("border-radius");
    expect(figure.match(/class="block shrink-0 rounded-r-bar (h-4|h-1\.5) /g)).toHaveLength(4);
    expect(figure).not.toContain("rounded-xs");
    // The target is a 1.5px SOLID ink line (dashed means tested), fixed at 60 of 75, from its label down through the bars.
    expect(figure).toMatch(/<span data-target-line="true" class="[^"]*border-l-\[1\.5px\] border-solid border-foreground" style="left:80%">/);
    expect(figure).not.toContain("border-dashed");
    expect(figure).toMatch(/<div aria-hidden="true" class="[^"]*bottom-6 top-6" style="left:/);
    // No gridlines but the 0 axis.
    expect(figure.match(/class="absolute inset-y-0 w-px/g)).toHaveLength(1);
    expect(figure).not.toMatch(/inset-y-0 w-px bg-border"/);
    // Every value sits outside its bar end, in ink. Popularity ends 2.2 points short of the line, so its value
    // always sits just past the line; the others sit at their bar end once the figure is wide enough.
    expect(figure).toMatch(/data-label-place="past" class="[^"]*text-foreground[^"]*">57\.8%/);
    expect(figure).not.toContain("text-background");
    expect(figure).toMatch(/data-label-place="40rem" class="[^"]*@min-\[40rem\]:left-[^"]*">46\.8%/);
    expect(figure).toMatch(/data-label-place="28rem"[^>]*>39\.0%/);
    expect(figure).toMatch(/data-label-place="22rem"[^>]*>26\.3%/);
    // Taste overlap and popularity, the two Qloo measures compared, are the same 16px solid ink bar, so popularity's
    // longer bar alone shows it did better; genre tags and random are 6px muted-ink baselines on the same row line.
    // No bar is vermilion, teal, an open card capsule or the old ink-3 grey, and each keeps its label and printed
    // value, so 57.8% against 46.8% reads without colour.
    const bar = (label: string) => figure.match(new RegExp(`>${label}</span><span [^>]*><span [^>]*class="block shrink-0 rounded-r-bar ([^"]*)"`))![1];
    expect(bar("Taste overlap")).toBe("h-4 bg-foreground");
    expect(bar("Popularity")).toBe("h-4 bg-foreground");
    // Round 27 (R25 held): the two Qloo measures share one fill and one thickness, so the losing measure is never
    // dimmed next to the product's own; taste overlap is told apart by its labels alone.
    expect(bar("Taste overlap")).toBe(bar("Popularity"));
    // Popularity's value, 57.8%, is regular ink: no weight, no softer tone.
    const pop = figure.match(/<span data-bar-value="true" data-label-place="past" class="([^"]*)">57\.8%<\/span>/)![1];
    expect(pop).toMatch(/\btext-foreground\b/);
    expect(pop).not.toMatch(/\bfont-(semibold|bold|medium)\b|text-muted-foreground/);
    for (const label of ["Genre tags", "Random"]) expect(bar(label)).toBe("h-1.5 bg-muted-foreground");
    const bars = figure.match(/class="block shrink-0 rounded-r-bar [^"]*"/g) ?? [];
    expect(bars).toHaveLength(4);
    for (const one of bars) expect(one).not.toMatch(/bg-card|border-foreground|ink-3|prov-qloo|primary/);
    // Every bar row centres its bar on one line (the 28px bar lane is a centred flex row).
    expect(figure.match(/<span class="relative flex h-7 items-center" style="--end:/g)).toHaveLength(4);
    // The taste overlap row label stays semibold ink, which marks it as the page's subject, and so is its value at its
    // bar's end (46.8%); the other three values stay regular. No new mark, number or colour.
    expect(figure).toContain('<span class="text-[0.8125rem] leading-tight font-semibold">Taste overlap</span>');
    const values = [...figure.matchAll(/<span data-bar-value="true" data-label-place="[^"]*" class="([^"]*)">([^<]+)<\/span>/g)];
    expect(values.map((m) => m[2])).toEqual(["46.8%", "57.8%", "39.0%", "26.3%"]);
    expect(values.map((m) => /\bfont-semibold\b/.test(m[1]))).toEqual([true, false, false, false]);
    for (const [, cls] of values) expect(cls).toMatch(/\btext-foreground\b/);
    expect(text(figure)).toMatch(/Taste overlap 46\.8% Popularity 57\.8%/);
    // The room right of the plot is only what the farthest value label needs (past the 60 line, 80% of the axis):
    // none on a wide figure, so the 75 ends on the figure's right edge, and at most 3rem on a narrow one.
    expect(figure).toContain("--bars-room:clamp(0px, calc((53px - 0.2 * (100cqw - 7.5rem)) / 0.8), 3rem)");
    expect(figure).not.toContain("bg-primary");
    expect(figure).not.toContain("text-primary");
    expect(figure).not.toMatch(/(bg|border|text)-foreground\//);
    expect(figure).not.toContain("color-mix");
    // The axis at 0 is the one rule, in border-strong.
    expect(figure).toMatch(/<span data-axis-zero="true" class="absolute inset-y-0 w-px bg-border-strong"/);
    // The line's label sits on its own 24px row above the plot in 12px ink, right-aligned to the top of the line,
    // before any value, on one line. It is set solid (leading-none) 10px above the row's foot, which is the line's
    // top; the line still starts at the row's foot (top-6, above).
    expect(figure).toMatch(/<div class="relative h-6" style="[^"]*"><span data-target-label="true" class="absolute bottom-2\.5 text-xs leading-none whitespace-nowrap text-foreground" style="right:20%">Bar we set: /);
    expect(figure.indexOf("Bar we set")).toBeLessThan(figure.indexOf("data-bar-value"));
    // Round 27: the label clears the taste overlap bar by at least 12px. Its foot is 10px (bottom-2.5) above the row
    // foot, and the first bar (16px, h-4) is centred in its 28px lane (h-7), so its top is 6px under the row foot:
    // 10 + 6 = 16px clear. The clearance comes from the label row alone; no bar moves or shortens.
    const labelFoot = 2.5 * 4;
    const barInset = (7 * 4 - 4 * 4) / 2;
    expect(labelFoot + barInset).toBeGreaterThanOrEqual(12);
    expect(figure.match(/<span class="relative flex h-7 items-center"/g)).toHaveLength(4);
    expect(figure.indexOf('<div class="relative h-6"')).toBeLessThan(figure.indexOf("Taste overlap"));
  });

  it("sets the pilot offer as one unboxed block under a top rule: no surface, fill, stat row or button, only the offer, the contact, the /check link and its fold", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const pilot = html.slice(html.indexOf("<div data-pilot"));
    // A 1px border-border rule across its top (a top rule, never a left stripe), 32px of paper under it, then the
    // text, left-aligned: at most 68ch wide in one column below 1024px, and from 1024px on the findings' own
    // 12-column grid with the same 48px gutter (lg:grid-cols-12 lg:gap-x-12), so its edges are the columns' edges.
    // No card, surface edge, radius or padding box.
    expect(pilot).toMatch(
      /^<div data-pilot="true" class="border-t border-border pt-8"><div class="max-w-\[68ch\] lg:grid lg:max-w-none lg:grid-cols-12 lg:grid-rows-\[auto_auto\] lg:gap-x-12 lg:gap-y-2"><div data-pilot-offer="true" class="lg:col-span-5 lg:row-span-2 lg:grid lg:grid-rows-subgrid">/,
    );
    expect(html).toMatch(/lg:grid-cols-12 lg:grid-rows-\[auto_1fr\] lg:gap-x-12 lg:gap-y-0"><div data-why-col="problem" class="min-w-0 lg:col-span-5/);
    expect(pilot).not.toMatch(/rounded-lg|border-surface-edge|\bbg-card\b|\bp-6\b|border-l/);
    // Outside the findings grid, after it, so neither limitation sits under it in the same column.
    expect(html.indexOf("<div data-pilot")).toBeGreaterThan(html.indexOf('data-why-col="unknown"'));
    const grid = html.slice(0, html.indexOf("<div data-pilot"));
    expect((grid.match(/<div data-why-col=/g) ?? []).length).toBe(3);
    // The section has no named surface at all now.
    expect(html.match(/border-surface-edge/g) ?? []).toHaveLength(0);
    // No shadow, no tint and no fill inside it (a link's decoration-border-strong underline is not an edge), and the
    // fold has no hover wash: no bg- class at all.
    expect(pilot).not.toContain("shadow");
    expect(pilot.match(/(?<![\w-])bg-[\w-]+/g) ?? []).toEqual([]);
    expect(pilot).toContain("group-hover/fold:decoration-foreground");
    // Columns 1 to 5 (the problem's x): the label, then the offer at body size, in a subgrid whose second row starts
    // at the offer's first line. Its size, weight and tone are inherited (no class of its own but the spacing), so
    // the promise is never set larger or heavier than "Who would pay is not known.", which is also plain body text.
    const offer = pilot.match(/<div data-pilot-offer="true"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(offer).toMatch(/^<h3 class="text-base leading-snug font-semibold">Pilot offer<\/h3><p class="mt-2 lg:mt-0">Walk through the Glastonbury 2025 Sunday brief with me/);
    expect(offer).not.toContain("Contact");
    expect(offer).not.toMatch(/text-(lg|xl|2xl)|font-(medium|semibold|bold)[^"]*">Walk/);
    expect(html).toContain('<p class="mt-2">Our search, October 2026: absence of evidence only. Who would pay is not known.</p>');
    // Columns 6 to 12 (the voices' x), in the offer's row, so the link's words are level with the offer's first line
    // (the 44px line pulled up 10px from 1024px, where nothing sits above it in these columns): while /check is live
    // the column opens on the action, the link on its own 44px line, then the contact in muted at body size, then
    // the fold under both, left-aligned, its chevron after its words. Below 1024px the same order in one column (the
    // link and the contact share a line from 640px, a middot between them; on a phone the contact takes its own
    // line). Nothing else.
    const next = pilot.match(/<div data-pilot-next="true" class="mt-3 lg:col-span-7 lg:col-start-6 lg:row-start-2 lg:mt-0">[\s\S]*$/)?.[0] ?? "";
    expect(next).toMatch(
      /^<div data-pilot-next="true" class="mt-3 lg:col-span-7 lg:col-start-6 lg:row-start-2 lg:mt-0"><div class="sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 lg:block"><p class="lg:-mt-2\.5"><a [^>]*href="\/check"[^>]*>Check a draft grid<svg[\s\S]*?<\/a><\/p><span aria-hidden="true" class="hidden text-muted-foreground sm:inline lg:hidden">·<\/span><p data-pilot-contact="true" class="text-muted-foreground">Contact is on the Devpost page\.<\/p><\/div><details /,
    );
    expect(html).toMatch(/<div data-why-col="voices" class="min-w-0 lg:col-span-7 lg:col-start-6 /);
    expect(next).not.toMatch(/lg:items-end|lg:self-end|lg:w-\[20rem\]|justify-end/);
    expect(next).toMatch(
      /<details class="group cc-disclosure border-t-0!"><summary class="cc-disclosure-summary group\/fold rounded-md font-medium! hover:no-underline! justify-start">(?:<span[^>]*>)*About 40 Qloo requests per bill, only with the festival’s <\/span><span class="whitespace-nowrap"><span[^>]*>OK/,
    );
    expect(text(pilot)).toBe(
      "Pilot offer Walk through the Glastonbury 2025 Sunday brief with me and say where it matches how your team would set those times. Your own draft can go through Check a draft grid, whose rule checks run in your browser and send nothing. Success: you say which suggestion you would take or turn down, and why. Check a draft grid · Contact is on the Devpost page. About 40 Qloo requests per bill, only with the festival’s OK Pricing a new bill is not offered: comparing its longest overlaps takes about 40 Qloo requests of the 10,000 shared this month, and a full-day reading took 104 and 70. Either needs the festival’s OK. One answer is not a market.",
    );
    expect(pilot.match(/<a /g)).toHaveLength(1);
    expect(pilot).not.toContain("<button");
    expect(pilot).not.toMatch(/<details[^>]*\bopen\b/);
    // The contact line: muted, at the section's 15px body size (no size class of its own), never ink-3.
    expect(html).toMatch(/<p data-pilot-contact="true" class="text-muted-foreground">Contact is on the Devpost page\.<\/p>/);
    expect(pilot).not.toMatch(/ink-3|text-(xs|sm|\[0\.8125rem\])[^"]*">Contact/);
  });

  it("gives the pilot a text link with an arrow to /check while the check page is live, ahead of the contact line, never a filled button", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const cta = html.match(/<a[^>]*href="\/check"[^>]*>Check a draft grid<svg[\s\S]*?<\/a>/);
    expect(cta).not.toBeNull();
    expect(cta?.[0]).not.toContain("bg-primary");
    expect(cta?.[0]).toContain("underline");
    // A 44px hit area.
    expect(cta?.[0]).toContain("min-h-11");
    // 16px semibold ink, with its arrow.
    expect(cta?.[0]).toMatch(/class="font-semibold text-foreground [^"]*text-base"/);
    expect(html).not.toContain("bg-primary");
    expect(html).not.toContain("Check a draft grid now");
    const plain = text(html);
    expect(plain.indexOf("Check a draft grid")).toBeLessThan(plain.indexOf("Contact is on the Devpost page."));
    expect(plain.indexOf("About 40 Qloo requests per bill")).toBeGreaterThan(plain.indexOf("Contact is on the Devpost page."));
  });

  it("lets the contact line lead, in ink, when the check page is not live", async () => {
    vi.resetModules();
    vi.doMock("@/lib/check-flag", () => ({ CHECK_LIVE: false }));
    try {
      const mod = await import("./why-this-matters");
      const html = renderToStaticMarkup(createElement(mod.WhyThisMatters));
      expect(html).not.toContain('href="/check"');
      const next = html.slice(html.indexOf("<div data-pilot-next"));
      expect(next).toMatch(/^<div data-pilot-next="true"[^>]*><div [^>]*><p data-pilot-contact="true">Contact is on the Devpost page\.<\/p><\/div><details /);
      expect(text(withoutDisclosures(html))).toContain("Contact is on the Devpost page.");
    } finally {
      vi.doUnmock("@/lib/check-flag");
      vi.resetModules();
    }
  });

  it("composes the findings on a 12-column grid from 1024px: problem then what is not known on the left (5), the voices on the right (7), one column below 1024px", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    expect(html).toMatch(
      /class="mt-8 grid items-start gap-y-12 text-\[0\.9375rem\] leading-\[1\.55\] lg:grid-cols-12 lg:grid-rows-\[auto_1fr\] lg:gap-x-12 lg:gap-y-0"/,
    );
    // One column below 1024px, md included: no md placement.
    expect(html).not.toMatch(/\bmd:(grid-cols|col-span|row-start)/);
    expect(html).toMatch(/<div data-why-col="problem" class="min-w-0 lg:col-span-5 lg:row-start-1">/);
    expect(html).toMatch(/<div data-why-col="voices" class="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1">/);
    expect(html).toMatch(/<div data-why-col="unknown" class="min-w-0 lg:col-span-5 lg:col-start-1 lg:row-start-2 lg:mt-12">/);
    // The problem's finding set large: 20px, 500 weight, ink, at body leading-snug.
    expect(html).toMatch(
      /<p data-why-finding="true" class="mt-3 text-xl leading-snug font-medium text-foreground">45 clashes that fans or the press complained about at 5 festivals had a verified overlap in time\.<\/p>/,
    );
    // The scheduler limitation stays the first paragraph under its heading, at body size, in ink (no size or tone
    // class of its own).
    expect(html).toContain(
      "<h3 class=\"text-lg leading-snug font-semibold\">No scheduler we found reads audience overlap</h3><p class=\"mt-2\">Our search, October 2026: absence of evidence only. Who would pay is not known.</p>",
    );
    // No filled band and no hairline above: the section sits open on the page's one background, spaced 64 then 80px.
    expect(html).toMatch(/^<section aria-labelledby="why-this-matters-heading" id="why-this-matters"><div class="container-page py-16 lg:py-20">/);
    expect(html).not.toMatch(/\bbg-(muted|secondary)/);
    // No card around the findings and no rule in them but the voices' dividers; the pilot's top rule is the one
    // other line in the section, and nothing is a left stripe.
    const findings = html.slice(0, html.indexOf("<div data-pilot"));
    expect(findings).not.toMatch(/\bbg-card\b|(?<![\w-])border(-[tblrxy])?(?![\w-])|border-t |border-l |rounded-lg/);
    expect(findings.match(/divide-[\w-]+/g)).toEqual(["divide-y", "divide-border"]);
    expect(html.match(/border-t /g)).toHaveLength(1);
    expect(html).not.toMatch(/border-l /);
    // The question the pilot's success line already answers is said once.
    expect(text(html)).not.toContain("The first test: does a programmer move a set");
    expect(text(html)).not.toContain("smaller than a sale");
  });

  it("orders the blocks problem, voices, then what is not known, with the pilot last (the one-column order below 1024px)", () => {
    const plain = text(renderToStaticMarkup(createElement(WhyThisMatters)));
    const voices = plain.indexOf("What programmers have said in public");
    expect(voices).toBeGreaterThan(plain.indexOf("See the full test"));
    expect(voices).toBeLessThan(plain.indexOf("Who would pay is not known."));
    expect(plain.indexOf("Pilot offer")).toBeGreaterThan(plain.indexOf("Who would pay is not known."));
  });

  it("prints a counted result or a reply only when the owner's data says so", () => {
    const none: Demand = { status: "none", asked: 7, dates: "Oct 6 to 17", checkedOn: "Oct 19" };
    const noneHtml = renderToStaticMarkup(createElement(WhyThisMatters, { demand: none }));
    expect(text(noneHtml)).toContain("We asked 7 festival programmers between Oct 6 to 17; none had replied by Oct 19.");
    // The demand line stays in the no-scheduler block, after its fold, never in the pilot surface.
    const asked = noneHtml.indexOf("We asked 7");
    expect(asked).toBeGreaterThan(noneHtml.indexOf('data-why-col="unknown"'));
    expect(noneHtml.lastIndexOf("</details>", asked)).toBeGreaterThan(noneHtml.indexOf("Festival Pro and Lineup Ninja"));
    expect(asked).toBeLessThan(noneHtml.indexOf("<div data-pilot"));
    const reply: Demand = { status: "reply", asked: 7, replied: 1, dates: "Oct 6 to 17", role: "Programmer", quote: "A made-up reply.", changed: null };
    const plain = text(renderToStaticMarkup(createElement(WhyThisMatters, { demand: reply })));
    expect(plain).toContain("One programmer told us");
    expect(plain).toContain("Asked 7, replied 1.");
    expect(plain).toContain("Changed because of this reply: Nothing changed.");
  });
});

describe("the complaint overlap figure", () => {
  const figureOf = (html: string) => html.match(/<div data-complaint-figure="true"[\s\S]*?<p data-complaint-caption="true"[^>]*>[^<]*<\/p><\/div>/)?.[0] ?? "";

  it("draws only METHOD_FIGURES.complaints, under the conclusion and before its fold, as an image with a caption and a name built from the fields", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const { pairsVerified, medianMinutes, rangeMinutes } = METHOD_FIGURES.complaints;
    const figure = figureOf(html);
    expect(figure).not.toBe("");
    // Placement: after the conclusion and who the complaints come from, before the fold "86 pairs, median 50
    // minutes, and how the lists lean".
    const at = html.indexOf("<div data-complaint-figure");
    expect(at).toBeGreaterThan(html.indexOf("had a verified overlap in time.</p>"));
    expect(at).toBeGreaterThan(html.indexOf("<p data-why-sources"));
    expect(at).toBeLessThan(html.indexOf("86 pairs, median 50 minutes, and how the lists"));
    expect(at).toBeLessThan(html.indexOf('data-why-col="voices"'));
    // The caption, exactly, and the accessible name from the same caption plus the range and the median.
    const caption = `Overlap range and median across ${pairsVerified} verified pairs.`;
    expect(complaintCaption(pairsVerified)).toBe(caption);
    expect(caption).toBe("Overlap range and median across 86 verified pairs.");
    expect(figure).toContain(`<p data-complaint-caption="true" class="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">${caption}</p>`);
    // The scale is not drawn, so the name states it: 0 to 120 minutes.
    expect(figure).toMatch(
      new RegExp(
        `^<div data-complaint-figure="true" role="img" aria-label="${caption.replace(/\./g, "\\.")} Range ${rangeMinutes[0]} to ${rangeMinutes[1]} minutes; median ${medianMinutes} minutes, on a 0 to 120 minute scale\\."`,
      ),
    );
    // Every number it prints: the median, the range ends and the pair count, each read from the figures. One scale:
    // no axis numbers, so no tick value (0, 30, 60, 120) is printed beside the range ends.
    expect(text(figure)).toBe(`median ${medianMinutes} min ${rangeMinutes[0]} min ${rangeMinutes[1]} min ${caption}`);
    expect(text(figure).match(/\d+/g)).toEqual([medianMinutes, rangeMinutes[0], rangeMinutes[1], pairsVerified].map(String));
    // Visible with no click, and no new claim beside it.
    expect(withoutDisclosures(html)).toContain("data-complaint-figure");
    expect(text(figure)).not.toMatch(/\b(shows?|proves?|finds?|best)\b/i);
  });

  it("re-draws from a changed copy of the figures, so no value is typed in by hand", async () => {
    vi.resetModules();
    vi.doMock("@/lib/method-figures", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/lib/method-figures")>();
      return {
        ...real,
        METHOD_FIGURES: {
          ...real.METHOD_FIGURES,
          complaints: { ...real.METHOD_FIGURES.complaints, pairsVerified: 71, medianMinutes: 35, rangeMinutes: [15, 105] },
        },
      };
    });
    try {
      const mod = await import("./why-this-matters");
      const figure = figureOf(renderToStaticMarkup(createElement(mod.WhyThisMatters)));
      expect(text(figure)).toBe("median 35 min 15 min 105 min Overlap range and median across 71 verified pairs.");
      expect(figure).toContain(
        'aria-label="Overlap range and median across 71 verified pairs. Range 15 to 105 minutes; median 35 minutes, on a 0 to 120 minute scale."',
      );
      // Geometry follows the copy too: the capsule from 15 to 105 of 120, the median at 35 of 120.
      expect(figure).toContain('data-capsule-outline="true" x="12.5%" y="6.5" width="75%"');
      expect(figure).toMatch(/<span data-range-end="true" class="[^"]*" style="left:12\.5%">15 min<\/span>/);
      expect(figure).toMatch(/<span data-range-end="true" class="[^"]*" style="left:87\.5%">105 min<\/span>/);
      expect(figure).toContain('data-median-mark="true" x="29.167%"');
    } finally {
      vi.doUnmock("@/lib/method-figures");
      vi.resetModules();
    }
  });

  it("draws the range as the shared-time capsule, ink outline on top, and the median as a 2px ink mark on a 6px card underlay, with no motion and no new colour", () => {
    const figure = figureOf(renderToStaticMarkup(createElement(WhyThisMatters)));
    // The capsule: 16px tall, rx 8, from 10 to 90 of 120, through OverlapWindow (card fill, the hatch, the 2px card
    // halo inside the edge), then a 1px ink outline drawn after it.
    expect(figure).toMatch(/<clipPath id="([^"]+)-clip"><rect x="8\.333%" y="6\.5" width="66\.667%" height="16" rx="8"><\/rect><\/clipPath>/);
    expect(figure).toMatch(/<rect x="8\.333%" y="6\.5" width="66\.667%" height="16" fill="var\(--card\)"><\/rect><rect [^>]*fill="url\(#cc-overlap-[^)]+\)"><\/rect><rect [^>]*rx="8" fill="none" stroke="var\(--card\)" stroke-width="4"><\/rect><\/g>/);
    const outline = figure.indexOf("data-capsule-outline");
    expect(outline).toBeGreaterThan(figure.indexOf('stroke="var(--card)" stroke-width="4"'));
    expect(figure).toContain('data-capsule-outline="true" x="8.333%" y="6.5" width="66.667%" height="16" rx="8" fill="none" stroke="var(--foreground)" stroke-width="1"');
    // The median: a 6px card underlay, then the 2px ink mark, both 29px tall (6px past the capsule's 17px outline
    // box, 6 to 23, above and below), centred on 50 of 120 and drawn after the outline so a 2px card gap separates
    // the mark from every hatch line. The svg is the mark's height.
    expect(figure).toContain('<svg width="100%" height="29" aria-hidden="true"');
    expect(figure).toContain('<rect data-median-underlay="true" x="41.667%" y="0" width="6" height="29" transform="translate(-3 0)" fill="var(--card)"');
    expect(figure).toContain('<rect data-median-mark="true" x="41.667%" y="0" width="2" height="29" transform="translate(-1 0)" fill="var(--foreground)"');
    expect(figure.indexOf("data-median-underlay")).toBeLessThan(outline);
    expect(figure.indexOf("data-median-mark")).toBeGreaterThan(outline);
    // The median's 13px label sits above the mark, centred on it.
    expect(figure).toMatch(/<span data-median-label="true" class="[^"]*text-\[0\.8125rem\][^"]*text-foreground" style="left:41\.667%">median <span class="font-mono tabular-nums">50<\/span> min<\/span>/);
    // One scale: no axis line, no tick, no axis number. 4px under the capsule, the range ends in 12px ink mono, each
    // centred under its own end of the capsule; then the caption.
    expect(figure).not.toMatch(/data-tick|data-axis|w-px|h-px/);
    // The only lines drawn are the hatch's own, inside its pattern definition.
    expect(figure.slice(figure.indexOf("</defs>"))).not.toContain("<line");
    expect(figure).not.toMatch(/(?<![\w-])bg-border(?![\w-])/);
    const [low, high] = METHOD_FIGURES.complaints.rangeMinutes;
    const end = (minutes: number) =>
      `<span data-range-end="true" class="absolute top-0 -translate-x-1/2" style="left:${Math.round((minutes / 120) * 100000) / 1000}%">${minutes} min</span>`;
    expect(figure).toContain(
      `</svg><div class="relative mt-1 h-4 font-mono text-xs leading-4 whitespace-nowrap text-foreground tabular-nums">${end(low)}${end(high)}</div><p data-complaint-caption="true"`,
    );
    expect(figure.match(/<span data-range-end="true"[^>]*>\d+ min<\/span>/g)).toHaveLength(2);
    // Vermilion only as the hatch (shared time), never as text or a fill; no animation, opacity or new colour.
    expect(figure).not.toMatch(/text-primary|bg-primary|fill="var\(--primary\)"|animate|transition|motion-|opacity|color-mix/);
    expect(figure.match(/var\(--primary\)/g)).toHaveLength(1);
    expect(figure).not.toMatch(/rounded-full|shadow|text-(2xl|3xl|4xl)/);
  });
});

describe("the failed test and why this matters, as the home page composes them", () => {
  function composed(): string {
    return renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(TasteSection, {
          clash: null,
          lenses: null,
          pairs: [],
          twins: [],
          acts: [],
          ranked: [],
          onOpen: () => {},
        }),
        createElement(WhyThisMatters),
      ),
    );
  }

  it("prints the failed test once, visible, before the complaint figures and the pilot, with the second opinion after it", () => {
    const html = composed();
    const plain = text(html);
    expect(plain.split("Our test failed").length - 1).toBe(1);
    const order = [
      "What the failed test taught us.",
      FAILED,
      SECOND_OPINION,
      "Who has complained, and what nobody has tested",
      "45 clashes that fans or the press complained about at 5 festivals",
      "Who would pay is not known.",
      "Pilot offer",
    ].map((part) => plain.indexOf(part));
    order.forEach((at, i) => {
      expect(at, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    const visible = text(withoutDisclosures(html));
    expect(visible).toContain(FAILED);
    expect(visible).toContain(SECOND_OPINION);
    expect(visible).not.toMatch(/\bAUC\b/);
    expect(withoutDisclosures(html)).toContain('href="/method#tested"');
  });
});

describe("forward-looking lines with no claim (round 31)", () => {
  it("follows Who would pay is not known. with our untested guess, in the open, before the pilot", () => {
    expect(PAYER_GUESS).toBe(
      "Our guess, not yet tested: the festival’s head of programming, once per edition, before set times go out.",
    );
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const visible = text(withoutDisclosures(html));
    expect(visible).toContain(`Who would pay is not known. ${PAYER_GUESS}`);
    expect(visible.indexOf(PAYER_GUESS)).toBeLessThan(visible.indexOf("Pilot offer"));
    expect(html).toContain(`<p data-payer-guess="true" class="mt-2">${PAYER_GUESS}</p>`);
  });

  it("prints the pilot terms under the offer only once the owner has set them, and nothing while they are null", () => {
    expect(PILOT_TERMS).toBeNull();
    const none = renderToStaticMarkup(createElement(WhyThisMatters));
    expect(none).not.toContain("data-pilot-terms");
    expect(text(none)).not.toMatch(/^Terms:|\bTerms:/);
    const terms = "Terms: invented terms for this test only.";
    const set = renderToStaticMarkup(createElement(WhyThisMatters, { terms }));
    const pilot = set.slice(set.indexOf("<div data-pilot"));
    expect(pilot).toContain(`<p data-pilot-terms="true" class="mt-4 max-w-[68ch] text-muted-foreground">${terms}</p>`);
    // Under the offer, in the open, with the contact fallback kept.
    expect(text(withoutDisclosures(pilot))).toContain(terms);
    expect(text(pilot).indexOf(terms)).toBeGreaterThan(text(pilot).indexOf("Pilot offer"));
    expect(text(pilot)).toContain("Contact is on the Devpost page.");
  });

  it("says, where the complaints are counted, that most are about other festivals and days than the ones shown", () => {
    expect(COMPLAINTS_ELSEWHERE).toBe("Most of these complaints are about other festivals and days, not the days this app shows.");
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const visible = text(withoutDisclosures(html));
    expect(visible).toContain(
      `45 clashes that fans or the press complained about at 5 festivals had a verified overlap in time. ${COMPLAINT_SOURCES} ${COMPLAINTS_ELSEWHERE}`,
    );
    // Muted on paper, an existing pair, with no new kicker.
    expect(html).toContain(`<p data-why-elsewhere="true" class="mt-2 text-muted-foreground">${COMPLAINTS_ELSEWHERE}</p>`);
  });
});

describe("the failed-test note on the invented day (round 31)", () => {
  const FAILED_QLOO_SENTENCE = "Popularity, also a Qloo field, did better.";

  it("names the price's fourth part without crediting Qloo, from the prop or the page's shared flag", () => {
    const viaProp = text(renderToStaticMarkup(createElement(FailedTestNote, { synthetic: true })));
    const viaFlag = text(
      renderToStaticMarkup(createElement(SyntheticContext.Provider, { value: true }, createElement(FailedTestNote))),
    );
    for (const plain of [viaProp, viaFlag]) {
      expect(plain).toContain(
        "So the taste reading is a second opinion beside time and draw: it is one of the four parts of the price of each clash, the taste-overlap part, and never the verdict on its own.",
      );
      // The one Qloo sentence left is the failed test's, about the published festivals.
      expect(qlooCredits(plain)).toEqual([FAILED_QLOO_SENTENCE]);
    }
    // A published day keeps the words the hero test pins.
    const real = text(renderToStaticMarkup(createElement(FailedTestNote, { synthetic: false })));
    expect(real).toContain(SECOND_OPINION);
  });
});

describe("who the complaints come from (round 32, V5)", () => {
  it("names the mixed sources in one sentence true of every listed page, with no attendance or wish claim", () => {
    expect(COMPLAINT_SOURCES).toBe(
      "They come from four Reddit threads and six press articles (NME, Time Out, Vice, SF Chronicle, Lambgoat, EDM Identity).",
    );
    // The counts are the public pages': four forum threads, six articles, ten in all.
    expect(PUBLIC_SOURCES.filter(isForumThread)).toHaveLength(4);
    expect(PUBLIC_SOURCES.filter((url) => !isForumThread(url))).toHaveLength(PRESS_OUTLETS.length);
    // Every article's host is one of the outlets named, and every outlet named has an article.
    const hosts = PUBLIC_SOURCES.filter((url) => !isForumThread(url)).map((url) => new URL(url).hostname.replace(/^www\./, ""));
    const outletOf: Record<string, (typeof PRESS_OUTLETS)[number]> = {
      "vice.com": "Vice",
      "sfchronicle.com": "SF Chronicle",
      "edmidentity.com": "EDM Identity",
      "timeout.com": "Time Out",
      "nme.com": "NME",
      "lambgoat.com": "Lambgoat",
    };
    expect(hosts.map((host) => outletOf[host]).sort()).toEqual([...PRESS_OUTLETS].sort());
    // Not every source is a fan who wanted to see both acts: the sentence claims nothing of the kind.
    expect(COMPLAINT_SOURCES).not.toMatch(/wanted to see|both acts|attend|same crowd|same people|fans at stake/i);
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    expect(html).toContain(`<p data-why-sources="true" class="mt-2">${COMPLAINT_SOURCES}</p>`);
  });
});
