import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MethodPage from "@/app/method/page";
import { SyntheticContext } from "@/components/site/synthetic-context";
import { qlooCredits } from "@/lib/credit";
import * as demandModule from "@/lib/demand";
import { PILOT, PILOT_TERMS, type Demand } from "@/lib/demand";
import { METHOD_FIGURES } from "@/lib/method-figures";
import { PUBLIC_SOURCES } from "@/lib/public-sources";

import { TasteSection } from "./why-qloo";
import {
  BacktestBars,
  COMPLAINT_SOURCES,
  COMPLAINTS_ELSEWHERE,
  FIGURE_DOMAIN,
  FIGURE_TICKS,
  FailedTestNote,
  WHY_THIS_MATTERS_ID,
  PRESS_OUTLETS,
  WHY_STAKE,
  WhyThisMatters,
  along,
  isForumThread,
} from "./why-this-matters";

// Every name and figure below is invented for the test, except the published figures the blocks read
// from METHOD_FIGURES and PILOT.

/** Words from the public statements block that round 34 (audit Y7) took off the page, with its limit sentence. */
const VOICE_WORDS = [
  "What programmers have said in public",
  "(our summary)",
  "The team looks at stage times to cut clashes",
  "The team had expected different audiences",
  "A clash between two acts turned out worse",
  "Builds the Portola lineup in a spreadsheet",
  "These sources show that clashes are a known complaint.",
];

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
/** Round 33 (H4): the reading's place, named for what Qloo's data adds (draw is a Qloo field too). */
const SECOND_OPINION =
  "So the taste reading is a second opinion beside time and draw: the part Qloo’s taste data adds to the index, never the verdict on its own.";

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
    expect(plain).toMatch(/never the verdict on its own\. How we know$/);
    // Round 32 (V3): the taste-removed check did not establish that taste adds to time and draw, so no
    // "Exploratory:" sentence about taste adding something is added here.
    expect(plain).not.toMatch(/Exploratory:|adds something|taste adds/);
    // Round 31: the price does include taste, so the note no longer says it is kept out of a verdict.
    expect(plain).not.toContain("never folded into a verdict");
    // Never "the part Qloo adds": draw is Qloo popularity too, so the part is Qloo's taste data.
    expect(plain).not.toContain("the part Qloo adds");
    // Never a disclosure of its own: the failed test reads with no click.
    expect(html).not.toContain("<details");
  });

  it("keeps every line the round-33 compression must keep, each in the open with no click", () => {
    const html = renderToStaticMarkup(createElement(FailedTestNote));
    const visible = text(withoutDisclosures(html));
    for (const line of [
      "What the failed test taught us.",
      "Our test failed: taste overlap put 46.8% of complained-about clashes in the top quarter of their day, below our 60% bar.",
      "Popularity, also a Qloo field, did better.",
      "It reached 57.8%.",
      "The exploratory follow-up did not establish an advantage over popularity.",
      "second opinion beside time and draw",
      "never the verdict on its own",
      "How we know",
    ]) {
      expect(visible, line).toContain(line);
    }
    expect(withoutDisclosures(html)).toMatch(/<a[^>]*href="\/method#tested"[^>]*>How we know<\/a>/);
  });

  it("leaves the correlation with popularity to /method, which states it from the figures module (the home pin, moved)", () => {
    // Round 33 (H4): "(r = 0.08)" left the home note because /method states it; the figure is never typed.
    const home = text(renderToStaticMarkup(createElement(FailedTestNote)));
    expect(home).not.toMatch(/\(r = |correlation/);
    const method = text(renderToStaticMarkup(createElement(MethodPage)));
    const r = String(METHOD_FIGURES.backtest.popularityCorrelation);
    expect(method).toMatch(new RegExp(`nearly unrelated to popularity \\((?:correlation|r =) ${r.replace(".", "\\.")}\\)`));
  });
});

describe("WhyThisMatters", () => {
  it("prints the complaint figures, what exists and what is not known, and the demand shell", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const plain = text(html);
    expect(html).toContain(`id="${WHY_THIS_MATTERS_ID}"`);
    expect(plain).toContain("Who has complained, and what nobody has tested");
    expect(plain).toContain("45 clashes that fans or the press complained about at 5 festivals");
    // Round 34 (audit Y6): the fold is named for what it holds, with the pair count; the median left home with the
    // range chart (audit Y5) and is stated on /method.
    expect(plain).toContain("How the lists lean (86 verified pairs)");
    expect(plain).not.toContain("86 pairs, median 50 minutes, and how the lists lean");
    expect(plain).not.toMatch(/median/i);
    expect(plain).toContain("Press lists lean toward headliners, which flatters any taste-based method.");
    expect(plain).not.toMatch(/\bAUC\b/);
    // Round 34 (audit Y7): the statements and the sentence that limited them are gone; what is not known stays.
    expect(plain).not.toContain("Whether programmers would use or pay for this has not been tested.");
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
    expect(visible).toContain("One answer is not a market.");
    expect(visible).toContain(COMPLAINTS_ELSEWHERE);
    // The rest of each finding is in its own disclosure, still in the server HTML.
    const plain = text(renderToStaticMarkup(createElement(WhyThisMatters)));
    expect(plain).toContain(
      "How the lists lean (86 verified pairs) Press lists lean toward headliners, which flatters any taste-based method.",
    );
    expect(plain).toContain(
      "Festival Pro and Lineup Ninja Both check double bookings and changeovers. We found none that reads audience overlap (our search, October 2026).",
    );
  });

  it("prints no public statements, paraphrases or their fold (round 34, audit Y7), and no quotation marks", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const plain = text(html);
    for (const words of VOICE_WORDS) expect(plain, words).not.toContain(words);
    expect(html).not.toContain("data-voice");
    expect(html).not.toContain("data-voices-limit");
    // No statement's source page is linked any more, and the section opens no page in a new tab.
    expect(html).not.toContain('rel="noopener noreferrer"');
    for (const host of ["bbc.co.uk", "nme.com", "alpsinc.kr", "abc.net.au", "billboard.com"]) expect(html).not.toContain(host);
    expect(html).not.toMatch(/<summary[^>]*>(?:<span[^>]*>)*\w+ more statements?/);
    // No quote glyph anywhere in the section, and no left bar.
    expect(html).not.toContain("&quot;");
    expect(html).not.toMatch(/[\u201c\u201d]/);
    expect(html).not.toContain("border-l-2");
    expect(html).not.toContain("border-t-2");
  });

  it("closes the last column with the pilot offer, no request arithmetic on the page, and no contact until the owner adds one", () => {
    const plain = text(renderToStaticMarkup(createElement(WhyThisMatters)));
    // Round 32 (V4): the label, then the offer, word for word. It offers only what costs no Qloo request: a walk
    // through a published day's brief, and rule checks on the festival's own draft that run in the browser.
    // Round 33 (H3): the success line closes on the caveat that left with the fold, "One answer is not a market."
    expect(plain).toContain("Pilot offer Walk through the Glastonbury 2025 Sunday brief with me and say where it matches how your team would set those times. Your own draft can go through Check a draft grid, whose rule checks run in your browser and send nothing. Success: you say which suggestion you would take or turn down, and why. One answer is not a market.");
    // No promise to price or brief a new bill.
    expect(plain).not.toMatch(/Send one day|I will price|send back a brief|up to \d+ bills/);
    // Round 33 (H3): the request arithmetic read as contradicting the zero-quota offer, so it is not on the home
    // page at all (the Devpost page carries it, from PILOT); no fold holds it.
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    expect(plain).not.toMatch(/About \d+ Qloo requests|Qloo requests per bill|Pricing a new bill is not offered|full-day reading/);
    expect(plain).not.toContain(`${PILOT.requestsPerBill} Qloo requests`);
    expect(html).not.toMatch(/<summary[^>]*>(?:<span[^>]*>)*About /);
    // The arithmetic itself stays as it was, for the Devpost page.
    expect(PILOT).toEqual({ requestsPerBill: 40, monthlyRequests: 10_000, fullDayRequests: [104, 70] });
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
    expect(html).toMatch(/<summary[^>]*>(?:<span[^>]*>)*How the lists lean \(86 verified <\/span><span class="whitespace-nowrap"><span[^>]*>pairs\)</);
  });

  it("sets no all-caps kicker anywhere in the section: the problem opens on its finding, the other findings on an 18px semibold conclusion, the pilot's head 16px", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    expect(html).not.toContain("type-kicker");
    // Round 33: the problem's column opens on the finding itself, set as its heading at 20px (the label that
    // repeated it, "The problem is public", is gone).
    expect(html).toContain(
      '<h3 data-why-finding="true" class="text-xl leading-snug font-medium text-foreground">45 clashes that fans or the press complained about at 5 festivals had a verified overlap in time.</h3>',
    );
    expect(text(html)).not.toContain("The problem is public");
    expect(html).toContain(`<h3 class="text-lg leading-snug font-semibold">No scheduler we found reads audience overlap</h3>`);
    expect(html).not.toContain("What programmers have said in public");
    // Every disclosure is named for what it holds, as a text action, not an accordion row: no rule above it and no
    // leading mark, the summary's words in 15px medium ink (the site's 15px, never a 13px override) with the page's
    // text-link underline (1px border-strong, 4px off the text, ink on hover), then a trailing 14px ink chevron after
    // the words that turns 180 degrees on open, the turn animated only under motion-safe. The 44px row stays.
    const summaries = [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => text(m[1]));
    expect(summaries).toEqual(["How the lists lean (86 verified pairs)", "Festival Pro and Lineup Ninja"]);
    for (const generic of ["One more source", "Pilot limits", "More details"]) expect(html).not.toContain(`>${generic}<`);
    expect(html).not.toContain("data-fold-mark");
    expect(html).not.toContain("lucide-chevron-right");
    expect(html).not.toContain("cc-disclosure-mark");
    expect(html).not.toContain("group-hover/fold:bg-accent");
    const folds = [...html.matchAll(/<details class="([^"]*)"><summary class="([^"]*)">([\s\S]*?)<\/summary>/g)];
    expect(folds).toHaveLength(2);
    for (const [, detailsCls, summaryCls, inner] of folds) {
      expect(detailsCls).toMatch(/^group cc-disclosure border-t-0!/);
      expect(detailsCls).not.toMatch(/\bopen\b/);
      // The 44px row is the shared summary utility's min-height; the weight is set down to medium.
      expect(summaryCls).toMatch(/^cc-disclosure-summary group\/fold rounded-md font-medium! hover:no-underline!$/);
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

  it("draws the /method bars with the same 6px corner at both ends on a 0 to 75 axis, the two Qloo measures in solid ink and the two baselines thin and muted, values clear of the rule", () => {
    const figure = renderToStaticMarkup(createElement(BacktestBars, { threshold: 60 }));
    expect(figure.match(/<span data-bar-value="true" data-label-place="[^"]*" class="[^"]*font-mono text-xs[^"]*text-foreground[^"]*">\d+\.\d%<\/span>/g)).toHaveLength(4);
    // The axis ends on a round tick: 0, 25, 50, 75.
    expect(FIGURE_DOMAIN).toBe(75);
    expect(FIGURE_TICKS).toEqual([0, 25, 50, 75]);
    expect(FIGURE_TICKS[FIGURE_TICKS.length - 1]).toBe(FIGURE_DOMAIN);
    expect(text(figure)).toMatch(/Random 26\.3% 0 25 50 75$/);
    // Taste overlap 46.8 of 75. Round 34 (corners): every bar is a mark with the 6px mark corner at both ends
    // (rounded-bar), so no bar has one square end; the 6px baselines are clamped to a round end.
    expect(along(46.8)).toBe("62.4%");
    expect(figure).toContain(`style="width:${along(46.8)}"`);
    expect(figure).not.toContain("border-radius");
    expect(figure.match(/class="block shrink-0 rounded-bar (h-4|h-1\.5) /g)).toHaveLength(4);
    expect(figure).not.toMatch(/rounded-(r|l|s|e)-bar/);
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
    const bar = (label: string) => figure.match(new RegExp(`>${label}</span><span [^>]*><span [^>]*class="block shrink-0 rounded-bar ([^"]*)"`))![1];
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
    const bars = figure.match(/class="block shrink-0 rounded-bar [^"]*"/g) ?? [];
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

  it("sets the pilot offer as one unboxed block under a top rule: no surface, fill, stat row, fold or button, only the offer, the /check link and the contact", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const pilot = html.slice(html.indexOf("<div data-pilot"));
    // A 1px border-border rule across its top (a top rule, never a left stripe), 24px of paper under it, then the
    // text, left-aligned and at most 68ch wide. No card, surface edge, radius or padding box.
    expect(pilot).toMatch(/^<div data-pilot="true" class="border-t border-border pt-6"><div data-pilot-offer="true" class="max-w-\[68ch\]">/);
    expect(pilot).not.toMatch(/rounded-lg|border-surface-edge|\bbg-card\b|\bp-6\b|border-l/);
    // Round 34: from 1024px it sits in the findings' right columns, right under what is not known, so the offer reads
    // after "Who would pay is not known."; in reading order it comes last.
    expect(html).toMatch(/<div data-why-col="pilot" class="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-start-2"><div data-pilot="true"/);
    expect(html.indexOf("<div data-pilot")).toBeGreaterThan(html.indexOf('data-why-col="unknown"'));
    expect(html).toMatch(/<div data-why-col="unknown" class="min-w-0 lg:col-span-7 lg:col-start-6 /);
    // The section has no named surface at all.
    expect(html.match(/border-surface-edge/g) ?? []).toHaveLength(0);
    // No shadow, no tint and no fill inside it (a link's decoration-border-strong underline is not an edge).
    expect(pilot).not.toContain("shadow");
    expect(pilot.match(/(?<![\w-])bg-[\w-]+/g) ?? []).toEqual([]);
    // The label, then the offer at body size. Its size, weight and tone are inherited (no class of its own but the
    // spacing), so the promise is never set larger or heavier than "Who would pay is not known.", which is also plain
    // body text.
    const offer = pilot.match(/<div data-pilot-offer="true"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(offer).toMatch(/^<h3 class="text-base leading-snug font-semibold">Pilot offer<\/h3><p class="mt-2">Walk through the Glastonbury 2025 Sunday brief with me/);
    expect(offer).not.toContain("Contact");
    expect(offer).not.toMatch(/text-(lg|xl|2xl)|font-(medium|semibold|bold)[^"]*">Walk/);
    expect(html).toContain(
      `<p class="mt-2">Our search, October 2026: absence of evidence only. Who would pay is not known.</p>`,
    );
    // While /check is live the action leads: the link on its own 44px line, then the contact in muted at body size;
    // from 640px the two share a line, a middot between them; on a phone the contact takes its own line. Nothing
    // else: no fold.
    const next = pilot.match(/<div data-pilot-next="true" class="mt-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-2">[\s\S]*$/)?.[0] ?? "";
    expect(next).toMatch(
      /^<div data-pilot-next="true" class="mt-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-2"><p><a [^>]*href="\/check"[^>]*>Check a draft grid<svg[\s\S]*?<\/a><\/p><span aria-hidden="true" class="hidden text-muted-foreground sm:inline">·<\/span><p data-pilot-contact="true" class="text-muted-foreground">Contact is on the Devpost page\.<\/p><\/div>/,
    );
    expect(next).not.toMatch(/lg:items-end|lg:self-end|lg:w-\[20rem\]|justify-end/);
    expect(text(pilot)).toBe(
      "Pilot offer Walk through the Glastonbury 2025 Sunday brief with me and say where it matches how your team would set those times. Your own draft can go through Check a draft grid, whose rule checks run in your browser and send nothing. Success: you say which suggestion you would take or turn down, and why. One answer is not a market. Check a draft grid · Contact is on the Devpost page.",
    );
    expect(pilot.match(/<a /g)).toHaveLength(1);
    expect(pilot).not.toContain("<button");
    expect(pilot).not.toContain("<details");
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
    // Nothing follows the contact in the pilot: the request fold is gone (round 33, H3).
    const pilot = text(html.slice(html.indexOf("<div data-pilot")));
    expect(pilot.endsWith("Contact is on the Devpost page.")).toBe(true);
  });

  it("lets the contact line lead, in ink, when the check page is not live", async () => {
    vi.resetModules();
    vi.doMock("@/lib/check-flag", () => ({ CHECK_LIVE: false }));
    try {
      const mod = await import("./why-this-matters");
      const html = renderToStaticMarkup(createElement(mod.WhyThisMatters));
      expect(html).not.toContain('href="/check"');
      const next = html.slice(html.indexOf("<div data-pilot-next"));
      expect(next).toMatch(/^<div data-pilot-next="true"[^>]*><p data-pilot-contact="true">Contact is on the Devpost page\.<\/p><\/div>/);
      expect(text(withoutDisclosures(html))).toContain("Contact is on the Devpost page.");
    } finally {
      vi.doUnmock("@/lib/check-flag");
      vi.resetModules();
    }
  });

  it("composes the findings on a 12-column grid from 1024px: the problem on the left (5), what is not known then the pilot on the right (7), one column below 1024px", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    // Round 34: with the statements gone, two rows from 1024px: the problem spans both on the left; what is not known
    // (row 1) then the pilot (row 2) on the right, 40px under it. 40px between blocks below 1024px. Round 35: 24px
    // under the stake line, which opens the section.
    expect(html).toMatch(
      /class="mt-6 grid items-start gap-y-10 text-\[0\.9375rem\] leading-\[1\.55\] lg:grid-cols-12 lg:gap-x-12 lg:gap-y-6"/,
    );
    // One column below 1024px, md included: no md placement.
    expect(html).not.toMatch(/\bmd:(grid-cols|col-span|row-start)/);
    expect(html).toMatch(/<div data-why-col="problem" class="min-w-0 lg:col-span-5 lg:row-span-2 lg:row-start-1">/);
    expect(html).not.toContain('data-why-col="voices"');
    expect(html).toMatch(/<div data-why-col="unknown" class="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-start-1">/);
    expect(html).toMatch(/<div data-why-col="pilot" class="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-start-2">/);
    // The problem's finding set large and leading its column as its heading: 20px, 500 weight, ink, leading-snug.
    expect(html).toMatch(
      /<h3 data-why-finding="true" class="text-xl leading-snug font-medium text-foreground">45 clashes that fans or the press complained about at 5 festivals had a verified overlap in time\.<\/h3>/,
    );
    // The scheduler limitation stays the first paragraph under its heading, at body size, in ink (no size or tone
    // class of its own), and ends on "Who would pay is not known." (round 34, audit Y8: no guess after it).
    expect(html).toContain(
      "<h3 class=\"text-lg leading-snug font-semibold\">No scheduler we found reads audience overlap</h3><p class=\"mt-2\">Our search, October 2026: absence of evidence only. Who would pay is not known.</p>",
    );
    // No filled band and no hairline above: the section sits open on the page's one background, 64px above and below,
    // 80px above from 1024px.
    expect(html).toMatch(/^<section aria-labelledby="why-this-matters-heading" id="why-this-matters"><div class="container-page py-16 lg:pt-20">/);
    expect(html).not.toMatch(/\bbg-(muted|secondary)/);
    // No card around the findings and no rule in them; the pilot's top rule is the one line in the section, and
    // nothing is a left stripe.
    const findings = html.slice(0, html.indexOf("<div data-pilot"));
    expect(findings).not.toMatch(/\bbg-card\b|(?<![\w-])border(-[tblrxy])?(?![\w-])|border-t |border-l |rounded-lg/);
    expect(findings).not.toMatch(/divide-[\w-]+/);
    expect(html.match(/border-t /g)).toHaveLength(1);
    expect(html).not.toMatch(/border-l /);
    // The question the pilot's success line already answers is said once.
    expect(text(html)).not.toContain("The first test: does a programmer move a set");
    expect(text(html)).not.toContain("smaller than a sale");
  });

  it("opens on the stake and the moment of use, in words: one paragraph at body size in ink under the heading, above the findings, with no number and no count of people", () => {
    expect(WHY_STAKE).toBe(
      "When two sets clash, anyone who wants to see both has to choose. Clash Control is for the time after acts are booked and before set times go out.",
    );
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    // Directly under the heading, before the grid of findings.
    expect(html).toContain(
      `Who has complained, and what nobody has tested</h2><p data-why-stake="true" class="mt-2 text-base leading-normal text-foreground">${WHY_STAKE}</p><div class="mt-6 grid`,
    );
    const plain = text(html);
    expect(plain.indexOf(WHY_STAKE)).toBeLessThan(plain.indexOf("45 clashes that fans or the press complained about"));
    // Visible with no click, and at the container's full measure: no width cap of its own.
    expect(text(withoutDisclosures(html))).toContain(WHY_STAKE);
    const cls = /<p data-why-stake="true" class="([^"]*)">/.exec(html)?.[1] ?? "";
    expect(cls).not.toMatch(/max-w|hidden|muted|primary|prov-qloo/);
    // No figure, no fan count, no Qloo credit.
    expect(WHY_STAKE).not.toMatch(/\d|fans?\b|people|crowd|qloo/i);
    expect(qlooCredits(WHY_STAKE)).toEqual([]);
  });

  it("orders the blocks problem, then what is not known, with the pilot last (the one-column order below 1024px)", () => {
    const plain = text(renderToStaticMarkup(createElement(WhyThisMatters)));
    const problem = plain.indexOf("45 clashes that fans or the press complained about");
    const unknown = plain.indexOf("No scheduler we found reads audience overlap");
    expect(problem).toBeGreaterThan(-1);
    expect(unknown).toBeGreaterThan(problem);
    expect(plain.indexOf("Who would pay is not known.")).toBeGreaterThan(unknown);
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

describe("the complaint figures on home (round 34, audit Y5)", () => {
  it("draws no range chart: the finding, who the complaints come from and the fold stay, the median and the range go to /method", () => {
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const { rangeMinutes } = METHOD_FIGURES.complaints;
    for (const hook of ["data-complaint-figure", "data-capsule-outline", "data-median-mark", "data-range-end", "data-complaint-caption"]) {
      expect(html, hook).not.toContain(hook);
    }
    expect(html).not.toContain("<svg width");
    expect(html).not.toContain("var(--primary)");
    const plain = text(html);
    expect(plain).not.toContain("Overlap range and median across");
    expect(plain).not.toContain(`${rangeMinutes[0]} min`);
    expect(plain).not.toContain(`${rangeMinutes[1]} min`);
    // The fold follows the who-said-it paragraph directly, still in the problem's column.
    const at = html.indexOf("How the lists lean (");
    expect(at).toBeGreaterThan(html.indexOf("<p data-why-sources"));
    expect(at).toBeLessThan(html.indexOf('data-why-col="unknown"'));
  });

  it("reads the finding and the fold's pair count from a changed copy of the figures, so no value is typed in by hand", async () => {
    vi.resetModules();
    vi.doMock("@/lib/method-figures", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/lib/method-figures")>();
      return {
        ...real,
        METHOD_FIGURES: {
          ...real.METHOD_FIGURES,
          complaints: { ...real.METHOD_FIGURES.complaints, clustersVerified: 31, festivals: 4, pairsVerified: 71 },
        },
      };
    });
    try {
      const mod = await import("./why-this-matters");
      const plain = text(renderToStaticMarkup(createElement(mod.WhyThisMatters)));
      expect(plain).toContain("31 clashes that fans or the press complained about at 4 festivals had a verified overlap in time.");
      expect(plain).toContain("How the lists lean (71 verified pairs)");
    } finally {
      vi.doUnmock("@/lib/method-figures");
      vi.resetModules();
    }
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
  it("ends the paragraph on Who would pay is not known., in the open, before the pilot, with no guess after it (round 34, audit Y8)", () => {
    // The untested guess at who would pay left the page and the demand module with it.
    expect("PAYER_GUESS" in demandModule).toBe(false);
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const visible = text(withoutDisclosures(html));
    expect(visible).toContain("Who would pay is not known.");
    expect(visible.indexOf("Who would pay is not known.")).toBeLessThan(visible.indexOf("Pilot offer"));
    expect(visible).not.toMatch(/Our guess|not yet tested|once per edition/);
    expect(html).not.toContain("data-payer-guess");
    // In ink at body size, the last sentence of its paragraph.
    expect(html).toContain("Who would pay is not known.</p>");
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
    // Muted on paper, an existing pair, with no new kicker; round 33 sets it in the sources' own paragraph.
    expect(html).toContain(
      `<p data-why-sources="true" class="mt-2">${COMPLAINT_SOURCES} <span data-why-elsewhere="true" class="text-muted-foreground">${COMPLAINTS_ELSEWHERE}</span></p>`,
    );
  });
});

describe("the failed-test note on the invented day (round 31)", () => {
  const FAILED_QLOO_SENTENCE = "Popularity, also a Qloo field, did better.";

  it("names the index's taste part without crediting Qloo, from the prop or the page's shared flag", () => {
    const viaProp = text(renderToStaticMarkup(createElement(FailedTestNote, { synthetic: true })));
    const viaFlag = text(
      renderToStaticMarkup(createElement(SyntheticContext.Provider, { value: true }, createElement(FailedTestNote))),
    );
    for (const plain of [viaProp, viaFlag]) {
      expect(plain).toContain(
        "So the taste reading is a second opinion beside time and draw: the taste-overlap part of the index, never the verdict on its own.",
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
    expect(html).toContain(`<p data-why-sources="true" class="mt-2">${COMPLAINT_SOURCES} `);
  });
});
