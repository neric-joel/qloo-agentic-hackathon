import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NO_MOVES, TO_DECIDE, sharedMinutes, sharedMinutesSentence } from "@/lib/brief";
import { qlooCredits } from "@/lib/credit";
import { DO_NOT_USE } from "@/lib/demand";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import type { Lenses } from "@/lib/lenses";
import { parsePreset } from "@/lib/preset";
import type { Plan } from "@/lib/stack";

import {
  BARE_NO_MOVES,
  BriefContent,
  BriefScreen,
  SIGN_OFF,
  TEAMS_AGREE,
  UNAVAILABLE,
  briefTarget,
  chooseBriefPreset,
  outsideOnPaper,
  type Outcome,
} from "./brief-sheet";

// Every name and figure below is invented for the test: the tiny preset, and the invented day made from it.

const published = () => parsePreset(rawTinyPreset());
const invented = () => parsePreset({ ...rawTinyPreset(), synthetic: true });

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function screen(state: Outcome | { status: "loading" }, presetId: string | null = null): string {
  return renderToStaticMarkup(createElement(BriefScreen, { state, presetId, dayText: null, moves: [] }));
}

const h1s = (html: string) => html.match(/<h1\b/g) ?? [];

describe("what the address asks for", () => {
  it("reads no preset and no moves as a bare /brief, a safe id as a link, and anything else as unavailable", () => {
    expect(briefTarget(null, null)).toEqual({ kind: "bare" });
    expect(briefTarget("tiny-fest-sat", null)).toEqual({ kind: "link", presetId: "tiny-fest-sat" });
    expect(briefTarget("tiny-fest-sat", "garbage")).toEqual({ kind: "link", presetId: "tiny-fest-sat" });
    // Moves with no day to put them on, an empty id and an id this page would never send.
    expect(briefTarget(null, "ann~main~0~2000")).toEqual({ kind: "broken" });
    expect(briefTarget("", null)).toEqual({ kind: "broken" });
    expect(briefTarget("../etc", null)).toEqual({ kind: "broken" });
  });

  it("opens a bare /brief on the first published day the server lists, or its invented day when that is all it has", () => {
    expect(chooseBriefPreset([{ id: "made-up", synthetic: true }, { id: "fest-a" }, { id: "fest-b", synthetic: false }])).toBe("fest-a");
    expect(chooseBriefPreset([{ id: "fest-b", synthetic: false }, { id: "fest-a" }])).toBe("fest-b");
    expect(chooseBriefPreset([{ id: "made-up", synthetic: true }])).toBe("made-up");
    expect(chooseBriefPreset([])).toBeNull();
  });
});

describe("a bare /brief", () => {
  it("renders the published day's brief with nothing kept, and says how a kept move gets here", () => {
    const preset = published();
    const html = screen({ status: "ready", preset, plan: null, decision: null, bare: true });
    const plain = text(html);
    expect(h1s(html)).toHaveLength(1);
    expect(html).toMatch(/<h1 id="brief-heading"[^>]*>[^<]*where the clashes fall<\/h1>/);
    expect(plain).toContain(`Tested moves ${BARE_NO_MOVES}`);
    expect(BARE_NO_MOVES).toBe("No moves kept yet. Keep one on the timetable page and it appears here.");
    expect(plain).not.toContain(NO_MOVES);
    expect(plain).not.toContain("Your plan");
    // The way back is the timetable of the day it shows; the print button is there.
    expect(html).toContain(`href="/?preset=${preset.id}"`);
    expect(plain).toContain("Print this brief");
    expect(plain).toContain("does not use Clash Control.");
  });

  it("renders the invented day with its own labels when that is all the server has, crediting no Qloo", () => {
    const html = screen({ status: "ready", preset: invented(), plan: null, decision: null, bare: true });
    const plain = text(html);
    expect(h1s(html)).toHaveLength(1);
    expect(plain).toContain("Scored by this app on an invented festival day, not a published timetable.");
    expect(plain).toContain("an invented figure for an invented day");
    expect(plain).toContain(BARE_NO_MOVES);
    expect(qlooCredits(plain)).toEqual([]);
  });

  it("keeps the old words for a link that names a day but kept nothing", () => {
    const plain = text(screen({ status: "ready", preset: published(), plan: null, decision: null }, "tiny-fest-sat"));
    expect(plain).toContain(NO_MOVES);
    expect(plain).not.toContain(BARE_NO_MOVES);
  });
});

describe("the notices", () => {
  it("says a broken link is unavailable in one line, its sentence in one element, under the page's h1", () => {
    const html = screen({ status: "missing" }, "../etc");
    expect(h1s(html)).toHaveLength(1);
    expect(html).toContain('<h1 class="type-kicker text-muted-foreground">Clash brief</h1>');
    const alert = html.match(/<p role="alert"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    // One child: the whole sentence in one span, so the flex row never splits it into columns; "one-page" stays on
    // one line inside it.
    expect(alert).toMatch(/^<span>This brief link is unavailable\.[^<]*<span class="whitespace-nowrap">one-page<\/span> brief’\.<\/span>$/);
    expect(text(alert)).toBe(UNAVAILABLE);
    expect(UNAVAILABLE).toBe("This brief link is unavailable. Open the timetable and choose ‘Open as a one-page brief’.");
    expect(html).toContain('href="/"');
  });

  it("gives the loading and error states an h1 too", () => {
    for (const state of [{ status: "loading" }, { status: "error" }] as const) {
      const html = screen(state);
      expect(h1s(html), state.status).toHaveLength(1);
    }
    // The words in one element; still while loading (round 34: no spinner, nothing moves that the visitor did not cause).
    expect(screen({ status: "loading" })).toMatch(/<p role="status"[^>]*><span>Loading the brief\.<\/span><\/p>/);
    expect(screen({ status: "loading" })).not.toMatch(/<svg|animate-/);
    expect(text(screen({ status: "error" }))).toContain("Could not load this brief.");
  });

  it("holds a screen's height while loading, in the page's first paint and in the sheet's own notice, so the sheet arriving moves nothing in view (round 34)", () => {
    // The sheet's notice: a screen tall while loading; the final notices (error, unavailable) keep their own height.
    const container = (html: string) => (html.match(/^<div class="([^"]*)">/)?.[1] ?? "").split(" ");
    expect(container(screen({ status: "loading" }))).toContain("min-h-svh");
    expect(container(screen({ status: "error" }))).not.toContain("min-h-svh");
    expect(container(screen({ status: "missing" }, "../etc"))).not.toContain("min-h-svh");
    // The page's fallback, painted before the link is read: the same box, h1 and status line as the notice, still, and
    // a screen tall too.
    const page = readFileSync(fileURLToPath(new URL("../../app/brief/page.tsx", import.meta.url)), "utf8");
    const fallback = page.slice(page.indexOf("function Loading()"), page.indexOf("export default"));
    expect(fallback).toContain('<div className="container-page min-h-svh max-w-[60rem] pt-8 pb-12">');
    expect(fallback).toContain('<h1 className="type-kicker text-muted-foreground">Clash brief</h1>');
    const status = screen({ status: "loading" }).match(/<p role="status" class="([^"]*)"/)?.[1] ?? "";
    expect(status).not.toBe("");
    expect(fallback.replace(/\s*\n\s*/g, "")).toContain(`<p role="status" className="${status}"><span>Loading the brief.</span></p>`);
    expect(fallback).not.toMatch(/animate-|Loader/);
  });
});

describe("the sheet's limits and sign-off (screen and print)", () => {
  function step(actId: string, act: string, start: string, end: string, budgetAfter: number) {
    return { act, actId, move: `${act}: moved`, stage: "Main", stageId: "main", day: 0, start, end, budgetAfter };
  }
  const plan: Plan = {
    publishedBudget: 112.5,
    budget: 104.25,
    steps: [step("bo", "Bo Diddly Squat", "21:00", "22:00", 104.25)],
    clashes: [{ a: "Ann Arbor", b: "Cy Twombly", points: 3.5 }],
    options: null,
  };

  it("says what the figures must never be used for, on every brief", () => {
    expect(DO_NOT_USE).toBe(
      "Do not use this to set fees, billing order or an artist’s worth, or for crowd capacity, safety or attendance.",
    );
    for (const preset of [published(), invented()]) {
      for (const sheetPlan of [null, plan]) {
        const html = renderToStaticMarkup(createElement(BriefContent, { preset, day: 0, plan: sheetPlan }));
        expect(html).toContain(`<p data-do-not-use="true" class="mt-2 font-semibold print:mt-[2pt] print:text-[9pt]">${DO_NOT_USE}</p>`);
      }
    }
  });

  it("follows To decide with: nothing moves until the acts' teams agree", () => {
    const plain = text(renderToStaticMarkup(createElement(BriefContent, { preset: published(), day: 0, plan })));
    expect(TEAMS_AGREE).toBe("Nothing moves until the acts’ teams agree.");
    expect(plain).toContain(`${TO_DECIDE} ${TEAMS_AGREE}`);
  });

  it("closes with a sign-off: prepared by, reviewed by the head of programming, and the date, each with a line to write on", () => {
    expect([...SIGN_OFF]).toEqual(["Prepared by", "Reviewed by (head of programming)", "Date"]);
    for (const sheetPlan of [null, plan]) {
      const html = renderToStaticMarkup(createElement(BriefContent, { preset: published(), day: 0, plan: sheetPlan }));
      const signOff = html.match(/<dl data-sign-off="true"[\s\S]*?<\/dl>/)?.[0] ?? "";
      expect(signOff).not.toBe("");
      // The last thing on the sheet, printed (no print:hidden), with no box: three labels, three 1px rules.
      expect(html.indexOf(signOff) + signOff.length).toBe(html.lastIndexOf("</article>"));
      expect(signOff).not.toContain("print:hidden");
      expect([...signOff.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1])).toEqual([...SIGN_OFF]);
      expect(signOff.match(/<dd aria-label="blank, to fill in" class="[^"]*border-b border-border-strong/g)).toHaveLength(3);
      const classes = [...signOff.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
      expect(classes.filter((name) => /^(rounded|shadow|bg-)/.test(name))).toEqual([]);
      expect([...new Set(classes.filter((name) => name.startsWith("border")))]).toEqual(["border-b", "border-border-strong"]);
    }
  });
});

describe("the candidate to keep and the decision lines (round 33)", () => {
  // Invented rankings of the tiny day: the one pair falls from #1 on time and draw to #3 with taste.
  const lenses: Lenses = {
    day: 0,
    ranked: 1,
    with_taste: [],
    without_taste: [{ a: "Ann Arbor", b: "Bo Diddly Squat", a_id: "ann", b_id: "bo", rank: 1, rank_with_taste: 3 }],
    only_with_taste: 0,
    only_without_taste: 0,
    apart: [],
  };
  const plan: Plan = {
    publishedBudget: 112.5,
    budget: 104.25,
    steps: [{ act: "Bo Diddly Squat", actId: "bo", move: "Bo Diddly Squat: moved", stage: "Side", stageId: "side", day: 0, start: "21:00", end: "22:00", budgetAfter: 104.25 }],
    clashes: [{ a: "Ann Arbor", b: "Cy Twombly", points: 3.5 }],
    options: null,
  };

  it("prints the candidate line from the rankings the page loaded, and none when they did not load", () => {
    const line = "Taste also lowers: Ann Arbor × Bo Diddly Squat ranks #1 on time and draw, #3 with taste: a candidate to keep.";
    expect(text(screen({ status: "ready", preset: published(), plan: null, decision: null, lenses, bare: true }))).toContain(line);
    expect(text(screen({ status: "ready", preset: published(), plan: null, decision: null, bare: true }))).not.toContain(
      "a candidate to keep",
    );
    expect(text(screen({ status: "ready", preset: published(), plan: null, decision: null, lenses: null }))).not.toContain(
      "a candidate to keep",
    );
  });

  it("words it for the invented day, crediting no Qloo", () => {
    const plain = text(screen({ status: "ready", preset: invented(), plan: null, decision: null, lenses, bare: true }));
    expect(plain).toContain("On this invented day, taste also lowers: Ann Arbor × Bo Diddly Squat ranks #1 on time and draw");
    expect(qlooCredits(plain)).toEqual([]);
    expect(text(screen({ status: "ready", preset: published(), plan: null, decision: null, lenses, bare: true }))).not.toMatch(
      /invented/,
    );
  });

  it("prints the decision line beside each kept step on paper only, and keeps the sign-off last", () => {
    const html = renderToStaticMarkup(createElement(BriefContent, { preset: published(), day: 0, plan, lenses }));
    const marks = html.match(/<span data-decision="true" class="([^"]*)"/g) ?? [];
    expect(marks).toHaveLength(1);
    // display:none on the screen (no breakpoint brings it back); a block only in print.
    const classes = (marks[0] ?? "").replace(/^.*class="/, "").replace(/"$/, "").split(" ");
    expect(classes).toContain("hidden");
    expect(classes.filter((name) => /^(sm|md|lg|xl|2xl):/.test(name))).toEqual([]);
    expect(classes).toContain("print:block");
    // No colour of its own: the step's muted ink, and no box, chip or fill.
    expect(classes.filter((name) => /^(bg-|rounded|shadow|border)/.test(name))).toEqual([]);
    expect(text(html)).toContain("Decision: move / keep as published / kept on purpose Initials:");
    const signOff = html.match(/<dl data-sign-off="true"[\s\S]*?<\/dl>/)?.[0] ?? "";
    expect(html.indexOf(signOff) + signOff.length).toBe(html.lastIndexOf("</article>"));
  });
});

describe("the table's caption (round 32, V7)", () => {
  it("says costliest first only when the table orders two rows or more", () => {
    const html = renderToStaticMarkup(createElement(BriefContent, { preset: published(), day: 0, plan: null }));
    const caption = html.match(/<p id="brief-clashes-caption" class="sr-only">([^<]*)<\/p>/)?.[1] ?? "";
    const rows = (html.match(/<table[\s\S]*?<\/table>/)?.[0].match(/<tr/g) ?? []).length - 1;
    expect(caption).not.toBe("");
    expect(caption.endsWith(", costliest first")).toBe(rows >= 2);
    expect(caption.startsWith(rows === 1 ? "The costliest clash" : "The ")).toBe(true);
  });
});

describe("the Hidden mark (round 34, R3)", () => {
  it("prints Hidden as plain ink text in the table and the stacked rows: no ring, chip, fill or corner", () => {
    const html = renderToStaticMarkup(createElement(BriefContent, { preset: published(), day: 0, plan: null }));
    const marks = [...html.matchAll(/<span class="([^"]*)">Hidden<\/span>/g)].map((m) => m[1]);
    // One in the wide table and one in the stacked rows for the tiny day's one hidden clash.
    expect(marks).toHaveLength(2);
    for (const cls of marks) {
      expect(cls).toBe("font-semibold whitespace-nowrap text-foreground print:text-[9pt]");
      expect(cls.split(" ").filter((name) => /^(tag|ring|bg-|border|rounded|shadow)/.test(name))).toEqual([]);
    }
    // No hidden-clash ring glyph and no chip beside it: raspberry stays on shared minutes. Since round 36 the sheet
    // draws the day, whose hatch over shared minutes is the one raspberry on the sheet: none outside the drawing, and
    // inside it only the hatch's pattern colour and the wash under it.
    expect(html).not.toContain('data-mark="hidden"');
    expect(html).not.toContain('class="tag');
    const figure = html.match(/<figure data-brief-figure=""[\s\S]*?<\/figure>/)?.[0] ?? "";
    expect(figure).not.toBe("");
    expect(html.replace(figure, "")).not.toMatch(/var\(--primary\)|text-primary|bg-primary/);
    expect(figure.match(/text-primary/g)).toHaveLength(2);
    expect(figure).toMatch(/<pattern [^>]*class="text-primary print:text-foreground"/);
    expect(figure).not.toMatch(/var\(--primary\)|bg-primary|fill="currentColor"|text-primary(?! print:text-foreground)/);
    // The table's column still says what the word means, with the note under the table.
    expect(text(html)).toContain("Hidden clashes: the two acts’ main genre tags differ");
  });

  it("draws the sheet on screen as a 14px panel and prints it as the page, with no corner, edge or fill", () => {
    const html = renderToStaticMarkup(createElement(BriefContent, { preset: published(), day: 0, plan: null }));
    const article = html.match(/<article aria-labelledby="brief-heading" class="([^"]*)"/)?.[1].split(" ") ?? [];
    expect(article).toContain("rounded-lg");
    expect(article).toContain("border");
    expect(article).toContain("bg-card");
    for (const name of ["print:rounded-none", "print:border-0", "print:bg-transparent", "print:p-0"]) expect(article).toContain(name);
    expect(article.filter((name) => /^rounded/.test(name))).toEqual(["rounded-lg"]);
  });
});

describe("the new overlap on paper (round 34, pass 1)", () => {
  function step(actId: string, act: string, stage: string, stageId: string, start: string, end: string, budgetAfter: number) {
    return { act, actId, move: `${act}: moved`, stage, stageId, day: 0, start, end, budgetAfter };
  }
  // Four kept moves on the tiny day: two columns of steps, so a full sheet leaves the minutes line off paper. Cy
  // Twombly ends on Side 20:00 to 21:00, under Ann Arbor's set on Main: 60 new minutes outside the day's one ranked
  // clash, which Bo Diddly Squat's later set shortens from 60 to 30.
  const four: Plan = {
    publishedBudget: 112.5,
    budget: 101,
    steps: [
      step("cy", "Cy Twombly", "Side", "side", "17:00", "18:00", 110),
      step("cy", "Cy Twombly", "Side", "side", "17:15", "18:15", 108),
      step("bo", "Bo Diddly Squat", "Side", "side", "21:00", "22:00", 104),
      step("cy", "Cy Twombly", "Side", "side", "20:00", "21:00", 101),
    ],
    clashes: [{ a: "Ann Arbor", b: "Bo Diddly Squat", points: 2.1 }],
    options: null,
  };
  const one: Plan = { ...four, steps: [four.steps[2]], budget: 104 };

  it("words what the plan adds outside the ranked clashes as the minutes line does, with the set named", () => {
    expect(outsideOnPaper({ ranked: 15, before: 815, after: 800, outside: { added: 15, longest: { a: "Sprints", b: "Joy Crookes", minutes: 15 } } })).toBe(
      "Outside the published day’s 15 ranked clashes, the plan adds 15 min of new or longer overlap (longest: Sprints × Joy Crookes, 15 min).",
    );
    expect(outsideOnPaper({ ranked: 1, before: 45, after: 30, outside: { added: 0, longest: null } })).toBe(
      "Outside the published day’s one ranked clash, no overlap gets longer.",
    );
    // The same claim and figures as the minutes line's second sentence: only its "them" is named.
    const minutes = { ranked: 6, before: 210, after: 150, outside: { added: 105, longest: { a: "Act Seven", b: "Act One", minutes: 60 } } };
    expect(sharedMinutesSentence(minutes)).toContain(outsideOnPaper(minutes).replace("Outside the published day’s 6 ranked clashes", "Outside them"));
    expect(outsideOnPaper(minutes)).not.toMatch(/attend|people|fans|crowd|audience|revenue|money|\$|£/i);
  });

  it("prints it after the verdict whenever the minutes line is left off paper, and never on the screen", () => {
    const minutes = sharedMinutes(published(), 0, four);
    expect(minutes).toEqual({ ranked: 1, before: 60, after: 30, outside: { added: 60, longest: { a: "Cy Twombly", b: "Ann Arbor", minutes: 60 } } });
    const line = "Outside the published day’s one ranked clash, the plan adds 60 min of new or longer overlap (longest: Cy Twombly × Ann Arbor, 60 min).";
    expect(outsideOnPaper(minutes!)).toBe(line);
    const html = renderToStaticMarkup(createElement(BriefContent, { preset: published(), day: 0, plan: four }));
    // The whole minutes line stays on the screen and leaves paper; the new overlap stays on paper, run on after the
    // verdict, in the sheet's own ink, and is hidden on the screen at every width.
    expect(html).toMatch(/<p data-shared-minutes="true" class="mt-1 print:mt-\[2pt\] print:hidden">/);
    const clause = html.match(/<p data-new-overlap="true" class="([^"]*)">([^<]*)<\/p>/);
    expect(clause?.[1]).toBe("hidden print:inline");
    expect(clause?.[2]).toBe(line);
    expect(html.indexOf("data-new-overlap")).toBeGreaterThan(html.indexOf("4 kept moves"));
    expect(html.indexOf("data-new-overlap")).toBeLessThan(html.indexOf("data-shared-minutes"));
    // Where the minutes line prints (one kept move, one column), it says this itself, and nothing repeats it.
    const short = renderToStaticMarkup(createElement(BriefContent, { preset: published(), day: 0, plan: one }));
    expect(short).toMatch(/<p data-shared-minutes="true" class="mt-1 print:mt-\[2pt\]">/);
    expect(short).not.toContain("data-new-overlap");
    expect(renderToStaticMarkup(createElement(BriefContent, { preset: published(), day: 0, plan: null }))).not.toContain("data-new-overlap");
  });

  it("sets the sheet's kicker and section heads in the sheet's own leading on paper, so the line fits the page", () => {
    const html = renderToStaticMarkup(createElement(BriefContent, { preset: published(), day: 0, plan: four }));
    const heads = [...html.matchAll(/<h2 id="brief-[^"]*" class="([^"]*)"/g)].map((m) => m[1].split(" "));
    expect(heads.length).toBeGreaterThan(3);
    for (const head of heads) expect(head).toEqual(expect.arrayContaining(["type-kicker", "print:text-[10pt]", "print:leading-[1.17]"]));
    expect(html).toContain('<p class="type-kicker text-muted-foreground print:text-[9pt] print:leading-[1.17]">Clash brief · ');
  });
});
