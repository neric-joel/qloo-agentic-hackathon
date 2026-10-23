import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { heroClash, topClashes } from "@/lib/clashes";
import { qlooCredits } from "@/lib/credit";
import { buildDayGraph, keyLine, sideEffectText, type DayGraphModel } from "@/lib/day-graph";
import { buildDecisionCopy, NO_MOVE, parseDecision, type Decision } from "@/lib/decision";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset, type PairClash, type PresetSummary } from "@/lib/preset";
import { summarize } from "@/lib/server-summary";
import { checkAdd, encodeMoves, type PlanAnswer, type StackMove, type StackStep } from "@/lib/stack";

import {
  ADD_TO_PLAN,
  DRAWN_AS_PUBLISHED,
  DRAWN_WITHOUT_MOVE,
  focusShown,
  isHiddenDecision,
  KEEP_MOVE,
  KeepMoveOffer,
  keepPressKind,
  KEPT_AGREE,
  KEPT_IN_PLAN,
  KeptNotice,
  planAtPress,
  REPLACE_PLAN,
  SEE_YOUR_PLAN,
  seeYourPlan,
} from "./decision-card";
import {
  HERO_CELL_MIN,
  HERO_NOTE,
  HERO_NOTE_INVENTED,
  HERO_ROWS,
  HeroDecision,
  HeroDecisionSkeleton,
  HeroLadder,
  HeroLadderRoom,
  HeroNote,
  heroNote,
  KEPT_LABEL,
  LADDER_SCOPE,
  noticeTaken,
  offerPartToShow,
  tasteLineText,
} from "./hero-decision";
import { rungLabels, type ThreeReadings } from "./why-qloo";

// Every name and figure below is invented for the test.

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** What a reader sees: invisible (visibility: hidden) and screen-reader-only spans taken out. */
function seen(html: string): string {
  let out = html.replace(/<span class="sr-only">[^<]*<\/span>/g, "");
  // The inactive label of the Keep button's cell is `invisible`; drop its whole span.
  out = out.replace(/<span(?: aria-hidden="true")? class="[^"]*\binvisible\b[^"]*">(?:<svg[\s\S]*?<\/svg>)?[^<]*<\/span>/g, "");
  return text(out);
}

/** What a screen reader hears: the drawn-only (aria-hidden) spans taken out, such as the ladder's arrows. */
function heard(html: string): string {
  return text(html.replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/g, ""));
}

/** The tiny preset, on the invented day when asked. */
function tinyPreset({ synthetic = false } = {}) {
  const raw = rawTinyPreset() as ReturnType<typeof rawTinyPreset> & { synthetic?: boolean };
  return parsePreset(synthetic ? { ...raw, synthetic: true } : raw);
}

/** The route's answer for the tiny preset: Bo Diddly Squat 60 minutes later, which ends its overlap with Ann Arbor. */
const RAW_DECISION = {
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
  rule: null,
};

/** The decision for the tiny preset (`RAW_DECISION`, parsed), with any field replaced. */
function decisionFor(overrides: Record<string, unknown> = {}): Decision {
  const decision = parseDecision({ ...RAW_DECISION, ...overrides });
  if (!decision) throw new Error("no decision");
  return decision;
}

function day({ synthetic = false, decision = decisionFor() as Decision | null } = {}) {
  const preset = tinyPreset({ synthetic });
  const model = buildDayGraph(preset, decision, 0) as DayGraphModel;
  if (!model) throw new Error("no model");
  return { preset, model, copy: buildDecisionCopy(preset, decision) };
}

function hero(props: Record<string, unknown> = {}, options: Parameters<typeof day>[0] = {}) {
  const { model, copy } = day(options);
  return renderToStaticMarkup(
    createElement(HeroDecision, { model, copy, view: "moved", onOpenMove: () => null, ...props }),
  );
}

describe("the hero's answer", () => {
  it("reads in one order: the move lead, the readout, the side effect, the taste line, the attribution, Keep, the confirmation's room, the paste", () => {
    vi.stubEnv("NEXT_PUBLIC_CHECK_LIVE", "1");
    const html = hero();
    const at = (needle: string) => html.indexOf(needle);
    const order = [
      'id="decision-heading"',
      "data-readout",
      "data-side-effects",
      "data-taste-line",
      "data-attribution",
      `>${KEEP_MOVE}<`,
      "data-kept-notice",
    ].map(at);
    order.forEach((value, i) => {
      expect(value, `part ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(value).toBeGreaterThan(order[i - 1]);
    });
    vi.unstubAllEnvs();
  });

  it("leads with the move as a heading the plan card can scroll back to, read only below 1024 px", () => {
    const html = hero();
    const heading = /<h2 id="decision-heading" tabindex="-1" class="([^"]*)">([^<]*)<\/h2>/.exec(html);
    expect(heading?.[2]).toBe("Bo Diddly Squat 60 minutes later");
    // 20 px, weight 620; screen-reader only below 1024 px, where the drawing's toggle names the move.
    expect(heading?.[1].split(" ")).toEqual(expect.arrayContaining(["text-[1.25rem]", "font-[620]", "max-lg:sr-only", "outline-none"]));
  });

  it("states the result with its partner: the figures in the answer type, the minutes left in raspberry, the arrow read as 'to'", () => {
    const html = hero();
    const readout = /<p data-readout=""[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
    expect(text(readout)).toBe("60 → to 0 min shared with Ann Arbor");
    expect(seen(readout)).toBe("60 → 0 min shared with Ann Arbor");
    // 34 px on a phone, 48 px from 1024 px; the words 15 px and 20 px, on their own line.
    expect(readout).toMatch(/class="type-numeral block text-\[2\.125rem\][^"]*lg:text-5xl/);
    expect(readout).toMatch(/<span class="block text-\[0\.9375rem\][^"]*lg:text-xl[^"]*">min shared with Ann Arbor<\/span>/);
    expect(readout).toContain('<span class="text-primary">0</span>');
    expect(readout).toContain('<span aria-hidden="true"> → </span><span class="sr-only"> to </span>');
    // Only the minutes left are raspberry: the figure before and the arrow are ink.
    expect(readout.match(/text-primary/g)).toHaveLength(1);
  });

  it("says what else the move changes, every clause naming the overlap, from the published times", () => {
    const { model } = day();
    const html = hero();
    const line = /<p data-side-effects="" class="([^"]*)">([^<]*)<\/p>/.exec(html);
    expect(line?.[2]).toBe(sideEffectText(model.move!));
    expect(line?.[2]).toBe("No other overlap gets longer.");
    // 14 px on a phone, 15 px from 1024 px, in ink.
    expect(line?.[1].split(" ")).toEqual(expect.arrayContaining(["text-sm", "lg:text-[0.9375rem]"]));
    expect(line?.[1]).not.toMatch(/muted|primary/);
  });

  it("gives the taste rank its qualifier beside the number, in one element with the Derived stamp", () => {
    const html = hero();
    const line = /<p data-taste-line=""[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(line.startsWith("Taste overlap: 70 of 100 on this bill (a rank, not attendance) <span")).toBe(true);
    // The rank is this app's, calculated from Qloo data: Derived, never a Qloo stamp; the words are ink.
    expect(line).toMatch(/<span[^>]*data-provenance="derived"[^>]*>/);
    expect(line).not.toMatch(/data-provenance="qloo"|text-prov-qloo/);
    expect(line).toContain("Calculated by this app from Qloo data.");
    expect(tasteLineText(99, false)).toBe("Taste overlap: 99 of 100 on this bill (a rank, not attendance)");
    expect(tasteLineText(88, true)).toBe("Taste overlap: 88 of 100 on this invented bill (an invented rank, not attendance)");
  });

  it("says who selected and scored it, and what kind of claim it is, in muted 13 / 14 px", () => {
    const html = hero();
    const line = /<p data-attribution="" class="([^"]*)">([^<]*)<\/p>/.exec(html);
    expect(line?.[2]).toBe("Selected and scored by this app’s index. A reading, not a verdict.");
    expect(line?.[1].split(" ")).toEqual(expect.arrayContaining(["text-[0.8125rem]", "text-muted-foreground", "lg:text-sm"]));
  });

  it("names the one filled action Keep this move: 48 px, the ink fill, the 10 px control corner, and one copy at every width", () => {
    const html = hero();
    expect(KEEP_MOVE).toBe("Keep this move");
    const buttons = [...html.matchAll(/<button[^>]*data-variant="default"[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(1);
    const [keep] = buttons;
    expect(keep).toMatch(/data-size="lg"/);
    expect(keep).toMatch(/\bh-12\b/);
    expect(keep).toMatch(/\bbg-cta\b/);
    expect(keep).toMatch(/\brounded-md\b/);
    expect(keep).not.toMatch(/rounded-full|bg-primary|\bid="|max-lg:hidden|lg:hidden/);
    // The press answers with a 0.97 scale in 120 ms on the house ease-out, only when motion is welcome.
    expect(keep).toContain("motion-safe:active:scale-97");
    expect(keep).toContain("motion-safe:duration-(--dur-feedback)");
    expect(keep).toContain("motion-safe:ease-(--ease-out)");
    expect(seen(keep)).toBe("Keep this move");
    expect(text(html)).not.toContain("Open this move");
  });

  it("keeps the button's width once kept: both labels share one cell, the kept one with a tick", () => {
    const fresh = hero({ kept: { move: false, change: false } });
    const kept = hero({ kept: { move: true, change: false } });
    const cell = (html: string) => /<button[^>]*data-variant="default"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? "";
    for (const html of [fresh, kept]) {
      expect(cell(html)).toMatch(/^<span class="grid"><span class="col-start-1 row-start-1[^"]*">Keep this move<\/span><span[^>]*class="col-start-1 row-start-1 [^"]*"><svg[^>]*lucide-check[^>]*>[\s\S]*?<\/svg>Kept in your plan<\/span><\/span>$/);
    }
    expect(KEPT_LABEL).toBe("Kept in your plan");
    expect(seen(cell(fresh))).toBe("Keep this move");
    expect(seen(cell(kept))).toBe("Kept in your plan");
    // The inactive label is hidden from screen readers too.
    expect(cell(fresh)).toMatch(/<span aria-hidden="true" class="[^"]*invisible[^"]*">/);
  });

  it("holds the confirmation's room under Keep at every width, and fills it in place once the plan holds the move", () => {
    const empty = hero({ kept: { move: false, change: false } });
    const notice = /<div role="status" aria-live="polite" data-kept-notice="" class="([^"]*)"><\/div>/.exec(empty);
    expect(notice).not.toBeNull();
    // Round 39 (W3): the notice row holds the room (three 18 px lines on a phone, 54 px; two from 640 px; the
    // ladder's two 24 px lines from 1024 px, 48 px; two 20 px lines from 1280 px, 40 px), so nothing moves when it
    // fills; the confirmation itself keeps its type and the row's one cell, and no min-height of its own.
    expect(notice?.[1].split(" ")).toEqual(
      expect.arrayContaining(["col-start-1", "row-start-1", "w-full", "text-[0.8125rem]", "leading-[1.125rem]", "lg:text-sm", "lg:leading-5"]),
    );
    expect(notice?.[1]).not.toMatch(/min-h-/);
    const row = /<div data-hero-row="notice" class="([^"]*)">/.exec(empty)?.[1].split(" ") ?? [];
    expect(row).toEqual(expect.arrayContaining(["min-h-[3.375rem]", "sm:min-h-9", "lg:min-h-12", "xl:min-h-10", "grid", "grid-cols-[minmax(0,1fr)]", "[grid-area:notice]"]));
    expect(empty).not.toContain(KEPT_IN_PLAN);
    const kept = hero({ kept: { move: true, change: false } });
    const filled = /<div role="status" aria-live="polite" data-kept-notice=""[^>]*>([\s\S]*?)<\/div>/.exec(kept)?.[1] ?? "";
    expect(text(filled)).toBe("Kept in your plan. Nothing moves until the acts’ teams agree. See your plan");
    // Ink, never green or raspberry; no box, no pill, no id.
    expect(filled).toContain("text-foreground");
    expect(filled).not.toMatch(/text-(primary|success|green)|\bbg-|rounded-full|[\s"]border(-[trblxy])?[\s"]|\bid="/);
    // "See your plan" reads as text and takes its 44 px target from a hit area that adds no height.
    expect(filled).toMatch(/<a href="#your-plan" class="relative rounded-sm [^"]*after:absolute after:-inset-x-1 after:-inset-y-4 after:content-\[&#x27;&#x27;\][^"]*">See your plan<\/a>/);
    expect(filled).not.toContain("min-h-11");
    // One confirmation: a single live region, after Keep.
    expect(kept.match(/data-kept-notice=""/g)).toHaveLength(1);
    expect(kept.indexOf("data-kept-notice")).toBeGreaterThan(kept.indexOf(">Keep this move<"));
  });

  it("says the drawing does not show a kept move while it is drawn as published (and 'without the move' on the invented day)", () => {
    expect([DRAWN_AS_PUBLISHED, DRAWN_WITHOUT_MOVE]).toEqual(["Drawn here as published.", "Drawn here without the move."]);
    const notice = (html: string) => text(/<div role="status" aria-live="polite" data-kept-notice=""[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "");
    expect(notice(hero({ kept: { move: true, change: false }, view: "published" }))).toBe(
      "Kept in your plan. Drawn here as published. Nothing moves until the acts’ teams agree. See your plan",
    );
    const invented = hero({ kept: { move: true, change: false }, view: "published" }, { synthetic: true });
    expect(notice(invented)).toBe("Kept in your plan. Drawn here without the move. Nothing moves until the acts’ teams agree. See your plan");
    expect(text(invented)).not.toMatch(/published/i);
    // The moved view says nothing of the kind.
    expect(notice(hero({ kept: { move: true, change: false } }))).not.toContain("Drawn here");
  });

  it("keeps the side-effect line in every state with a move", () => {
    const { model } = day();
    const line = sideEffectText(model.move!);
    const other: StackMove = { actId: "cy", stageId: "main", day: 0, start: "16:00" };
    const states = {
      moved: hero(),
      published: hero({ view: "published" }),
      kept: hero({ kept: { move: true, change: false } }),
      "kept as published": hero({ kept: { move: true, change: false }, view: "published" }),
      "existing plan": hero({ plan: [other], kept: { move: false, change: false } }),
      "server fallback": hero({ onOpenMove: undefined, pending: true }),
      invented: hero({}, { synthetic: true }),
    };
    for (const [name, html] of Object.entries(states)) {
      expect(html.match(/data-side-effects=""/g), name).toHaveLength(1);
      expect(html, name).toContain(`>${line}</p>`);
    }
    // The readout and the taste line describe the proposal: the published view prints them unchanged.
    expect(text(states.published).replace(/See your plan/g, "")).toBe(text(states.moved));
  });

  it("draws Keep in place before the interactive view mounts, not yet pressable and not dimmed", () => {
    const html = hero({ onOpenMove: undefined, pending: true });
    const keep = /<button[^>]*data-variant="default"[^>]*>/.exec(html)?.[0] ?? "";
    expect(keep).toContain('disabled=""');
    expect(keep).toContain("disabled:opacity-100");
    expect(keep).toMatch(/\bh-12\b/);
    expect(html).toContain("data-kept-notice");
    // The same boxes as the live hero: only the button's pressability, and the state the group names, differ.
    const live = hero();
    expect(html).toContain('data-hero-state="pending"');
    expect(live).toContain('data-hero-state="settled"');
    const strip = (markup: string) =>
      markup
        .replace(/ disabled=""/g, "")
        .replace(/ disabled:(opacity-50|opacity-100|cursor-default)/g, "")
        .replace(/ data-hero-state="(pending|settled)"/, "");
    expect(strip(html)).toBe(strip(live));
  });

  it("names the pair and says no legal place lowers the index when there is no move, with no Keep", () => {
    const decision = decisionFor({ move: null });
    const html = hero({}, { decision });
    const heading = /<h2 id="decision-heading"[^>]*>([^<]*)<\/h2>/.exec(html)?.[1];
    expect(heading).toBe("Ann Arbor × Bo Diddly Squat: 60 min shared");
    expect(text(html)).toContain(NO_MOVE);
    expect(html).toContain("data-taste-line");
    expect(text(html)).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
    expect(html).not.toContain("data-readout");
    expect(html).not.toContain("data-side-effects");
    expect(text(html)).not.toContain(KEEP_MOVE);
    expect(html).not.toContain("data-kept-notice");
  });

  it("drops the no-move line and the taste line too when the day has no decision", () => {
    const html = hero({}, { decision: null });
    const heading = /<h2 id="decision-heading"[^>]*>([^<]*)<\/h2>/.exec(html)?.[1];
    // The day's costliest clash names the heading.
    expect(heading).toBe("Ann Arbor × Bo Diddly Squat: 60 min shared");
    expect(text(html)).not.toContain(NO_MOVE);
    expect(html).not.toContain("data-taste-line");
    expect(text(html)).not.toContain(KEEP_MOVE);
    expect(text(html)).toContain("A reading, not a verdict.");
  });

  it("on the invented day says the bill and the rank are invented, and credits Qloo nowhere", () => {
    const html = hero({}, { synthetic: true });
    const line = /<p data-taste-line=""[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(line.startsWith("Taste overlap: 70 of 100 on this invented bill (an invented rank, not attendance) <span")).toBe(true);
    expect(line).toContain("Calculated by this app from invented figures.");
    for (const state of [html, hero({ view: "published" }, { synthetic: true }), hero({ kept: { move: true, change: false } }, { synthetic: true })]) {
      const all = `${text(state)}. ${[...state.matchAll(/(?:title|aria-label)="([^"]*)"/g)].map((m) => m[1]).join(". ")}`;
      expect(qlooCredits(all)).toEqual([]);
      expect(all).not.toContain("(a rank, not attendance)");
    }
  });

  it("holds the hero-text qualifiers in its source, on both kinds of day", () => {
    const source = readFileSync(join(__dirname, "hero-decision.tsx"), "utf8");
    expect(source).toContain("(a rank, not attendance)");
    expect(source).toContain("an invented rank, not attendance");
  });

  it("holds the group's footprint while the decision loads, with nothing to read or focus", () => {
    const html = renderToStaticMarkup(createElement(HeroDecisionSkeleton));
    expect(html).toMatch(/^<div aria-hidden="true" data-hero-skeleton=""/);
    expect(text(html)).toBe("");
    expect(html).not.toMatch(/<(a|button|input)\b|tabindex/);
    // The button's place at its 48 px and 10 px corner; the marks at the 6 px mark corner.
    expect(html).toMatch(/h-12 w-40 rounded-md bg-muted/);
    expect(html).not.toMatch(/rounded-(sm|full|none|\[)/);
  });
});

describe("one row geometry for every state the hero group can be painted in (round 37, L1)", () => {
  /**
   * Two days built here from the tiny preset: Bo Diddly Squat moved to Main at 15:25, which starts a new 15 min
   * overlap with Cy Twombly; and, with Cy Twombly at Main 21:55 (5 min shared with Bo Diddly Squat), Bo Diddly Squat
   * moved to 18:25, which ends that overlap. Every name and figure is invented for the test.
   */
  function rowDay(kind: "new" | "ends") {
    const raw = rawTinyPreset() as ReturnType<typeof rawTinyPreset> & {
      festival: { timetable: { act_id: string; stage_id: string; start: number | string; end: number }[] };
    };
    if (kind === "ends") {
      raw.festival.timetable = raw.festival.timetable.map((slot) =>
        slot.act_id === "cy" ? { ...slot, stage_id: "main", start: 1315, end: 1375 } : slot,
      );
    }
    const preset = parsePreset(raw);
    const place =
      kind === "new"
        ? { stage_id: "main", stage: "Main", start: "15:25", end: "16:55", minutes_moved: 305, stage_changed: true }
        : { stage_id: "side", stage: "Side", start: "18:25", end: "19:55", minutes_moved: 125, stage_changed: false };
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
        day: 0,
        ...place,
        legal_places: 4,
        budget_after: 98.4,
        minutes_shared_after: 0,
        same_index_alternative: null,
      },
      rule: null,
    });
    if (!decision) throw new Error("no decision");
    const model = buildDayGraph(preset, decision, 0) as DayGraphModel;
    return { preset, decision, model, copy: buildDecisionCopy(preset, decision) };
  }

  /** Each row of a rendered group, in DOM order: its name, its min-height classes and its space classes. */
  function rowsOf(html: string): { name: string; min: string[]; space: string[] }[] {
    return [...html.matchAll(/<div\b(?=[^>]*\bdata-hero-row="([^"]+)")(?=[^>]*\bclass="([^"]*)")[^>]*>/g)].map((m) => {
      const classes = m[2].split(" ");
      return {
        name: m[1],
        min: classes.filter((name) => /(^|:)min-h-/.test(name)),
        space: classes.filter((name) => /(^|:)mt-/.test(name)),
      };
    });
  }

  /** What a row holds: the markup between its opening tag and the next row's. */
  function rowMarkup(html: string, name: string): string {
    const from = html.indexOf(`data-hero-row="${name}"`);
    const next = html.indexOf("data-hero-row=", from + 1);
    return html.slice(html.indexOf(">", from) + 1, next === -1 ? undefined : html.lastIndexOf("<", next));
  }

  const expected = HERO_ROWS.map((row) => ({
    name: row.name,
    min: row.min.split(" ").filter(Boolean),
    space: row.space.split(" ").filter(Boolean),
  }));

  for (const kind of ["new", "ends"] as const) {
    it(`gives the settled group, the pending group without its words and the skeleton the same rows (${kind === "new" ? "a new 15 min overlap" : "the move ends a 5 min overlap"})`, () => {
      const { model, copy } = rowDay(kind);
      expect(sideEffectText(model.move!)).toMatch(kind === "new" ? /^New 15 min overlap with Cy Twombly\./ : /^Ends the 5 min overlap with Cy Twombly\./);
      expect(copy).not.toBeNull();
      const settled = renderToStaticMarkup(createElement(HeroDecision, { model, copy, view: "moved", onOpenMove: () => null }));
      const pending = renderToStaticMarkup(createElement(HeroDecision, { model, copy: null, view: "moved", pending: true }));
      const skeleton = renderToStaticMarkup(createElement(HeroDecisionSkeleton));

      // One ordered list of rows, with the same rooms and the same space above each, in all three.
      // Round 39 (W3): the ladder's own row is gone; below 1280 px the ladder shares the notice row's one cell.
      expect(HERO_ROWS.map((row) => row.name)).toEqual(["lead", "readout", "side-effects", "taste", "attribution", "actions", "notice"]);
      for (const html of [settled, pending, skeleton]) expect(rowsOf(html)).toEqual(expected);
      // Every room is a min-height, never a fixed height that could clip a longer line.
      for (const row of HERO_ROWS) expect(`${row.min} ${row.space}`).not.toMatch(/(^|\s|:)(h-|max-h-|overflow|line-clamp|truncate)/);

      // Settled: the group, the readout, Keep and the attribution in full.
      expect(settled).toMatch(/^<div id="one-decision" data-hero-group="" data-hero-state="settled"/);
      expect(settled).toContain("data-readout");
      expect(settled).toMatch(/<button[^>]*data-variant="default"[^>]*>[\s\S]*Keep this move/);
      expect(text(rowMarkup(settled, "attribution"))).toBe("Selected and scored by this app’s index. A reading, not a verdict.");
      expect(settled).toContain("data-taste-line");

      // Pending without the decision's words: the attribution keeps its text; the taste row holds its room empty,
      // hidden from assistive tech, with no number and no qualifier.
      expect(pending).toMatch(/^<div id="one-decision" data-hero-group="" data-hero-state="pending"/);
      expect(text(rowMarkup(pending, "attribution"))).toBe("Selected and scored by this app’s index. A reading, not a verdict.");
      expect(pending).toMatch(/<div data-hero-row="taste" aria-hidden="true" class="[^"]*"><\/div>/);
      expect(text(rowMarkup(pending, "taste"))).toBe("");
      expect(rowMarkup(pending, "taste")).not.toMatch(/\d|rank|attendance/);
      expect(pending).not.toContain("data-taste-line");

      // The skeleton: the group's hooks, and nothing to read or press.
      expect(skeleton).toMatch(/^<div aria-hidden="true" data-hero-skeleton="" data-hero-group="" data-hero-state="skeleton"/);
      expect(text(skeleton)).toBe("");
      expect(text(skeleton)).not.toMatch(/\d/);
      expect(skeleton).not.toMatch(/<(a|button|input)\b|tabindex|data-readout|data-attribution|Keep this move/);
    });
  }

  it("holds every row, empty where it has nothing, when there is no move or no decision", () => {
    const noMove = hero({}, { decision: decisionFor({ move: null }) });
    const noDecision = hero({}, { decision: null });
    for (const html of [noMove, noDecision]) {
      expect(rowsOf(html)).toEqual(expected);
      // Keep's place is held, but there is no button and no confirmation.
      expect(html).toContain('<div aria-hidden="true" class="h-12 [grid-area:keep]"></div>');
      expect(html).not.toMatch(/<button/);
      // The pair's heading, two or three lines at 26rem, sits in the readout's room (empty without a move, and as
      // tall as three of its lines), so a decision that does not come, or comes with no move, keeps the group's
      // height; the lead's room is held empty, hidden from assistive tech.
      expect(rowMarkup(html, "lead")).toBe("</div>");
      expect(html).toMatch(/<div data-hero-row="lead" aria-hidden="true" class="[^"]*">/);
      expect(rowMarkup(html, "readout")).toMatch(/^<h2 id="decision-heading"[^>]*>Ann Arbor × Bo Diddly Squat: 60 min shared<\/h2><\/div>$/);
      expect(html).toMatch(/<div data-hero-row="readout" class="[^"]*">/);
    }
    // With a move the heading is the lead's one line, and the readout holds the figures.
    const moved = hero({}, { decision: decisionFor() });
    expect(rowMarkup(moved, "lead")).toMatch(/^<h2 id="decision-heading"[^>]*>Bo Diddly Squat 60 minutes later<\/h2><\/div>$/);
    expect(rowMarkup(moved, "readout")).toMatch(/^<p data-readout="">/);
  });

  // The test imports clash-control cold (its whole module graph); under a loaded runner that alone passed the
  // 5-second default (vitest flake, round 37), so it allows 30 s, as check-links.test.ts does.
  it("reserves the settled group's height in the layout's group cell from 1024 px, the sum of the rows", async () => {
    // The rows' space and room at a breakpoint, mobile first, in px (Tailwind's 4 px spacing scale and rem values).
    const px = (token: string) => {
      const value = token.replace(/^(min-h|mt)-/, "");
      const rem = /^\[([\d.]+)rem\]$/.exec(value);
      return rem ? Number(rem[1]) * 16 : Number(value) * 4;
    };
    const at = (classes: string, screens: readonly string[], kind: "min-h" | "mt") => {
      let found = 0;
      for (const token of classes.split(" ").filter(Boolean)) {
        const cut = token.lastIndexOf(":");
        const [screen, name] = cut === -1 ? ["", token] : [token.slice(0, cut), token.slice(cut + 1)];
        if (name.startsWith(`${kind}-`) && screens.includes(screen)) found = px(name);
      }
      return found;
    };
    const total = (screens: readonly string[]) =>
      HERO_ROWS.reduce((sum, row) => sum + at(row.space, screens, "mt") + Math.max(at(row.min, screens, "min-h"), 0), 0);
    // From 1024 px the paste sits beside Keep, so the actions row is Keep's 48 px and the notice cell under it.
    // Round 39 (W3): the ladder's 80 px room above Keep goes; from 1024 px the ladder shares the notice cell, whose
    // room rises from 40 to 48 px (the ladder's two 24 px lines in the 26rem group), so 434.8 becomes 362.8. From
    // 1280 px the ladder is one line in the left column (`HeroLadderRoom`) and the cell is the confirmation's 40 px;
    // on a screen 790 px tall or less, from 1024 px, the spaces above the readout, the side effects, the taste line and
    // the attribution tighten from 8 to 4 px, the space above Keep from 16 to 8 px and the readout's words from a 28 to
    // a 24 px line (28 px in all), so a 1366 x 768 screen holds the whole drawing.
    const short = "[@media(max-height:790px)]";
    const lg = total(["", "sm", "md", "lg"]);
    const xl = total(["", "sm", "md", "lg", "xl"]);
    const lgShort = total(["", "sm", "md", "lg", `lg:${short}`]);
    const xlShort = total(["", "sm", "md", "lg", "xl", `lg:${short}`, `xl:${short}`]);
    expect(lg).toBeCloseTo(362.8, 5);
    expect(xl).toBeCloseTo(332.8, 5);
    expect(lgShort).toBeCloseTo(362.8 - 28, 5);
    expect(xlShort).toBeCloseTo(332.8 - 28, 5);
    const rem = (value: number) => +(value / 16).toFixed(4);
    expect(HERO_CELL_MIN).toBe(
      `lg:min-h-[${rem(lg)}rem] xl:min-h-[${rem(xl)}rem] lg:${short}:min-h-[${rem(lgShort)}rem] xl:${short}:min-h-[${rem(xlShort)}rem]`,
    );
    // The layout holds it in an empty room in the group's cell, second in the hero's DOM, right after the pitch:
    // before the dateline, the toggle, the drawing and the group, so it is there from the first bytes the browser
    // paints, whatever state the group streams in (a decision, or none and the skeleton).
    const { ClashControlFallback } = await import("./clash-control");
    const room = `<div aria-hidden="true" data-hero-room="" class="hidden lg:block lg:[grid-area:group] ${HERO_CELL_MIN}"></div>`;
    const list: PresetSummary[] = [{ id: "tiny-fest-sat", title: "Tiny Fest, Saturday", city: "Tiny Town", sets: 3, stages: 2, scored_share: 0.67 }];
    for (const summary of [summarize(tinyPreset(), decisionFor(), list), summarize(tinyPreset(), null, list)]) {
      const html = renderToStaticMarkup(
        createElement(ClashControlFallback, { intro: createElement("h1", { id: "pitch-heading" }, "Pitch"), summary }),
      );
      const heroHtml = html.slice(html.indexOf('data-hero=""'));
      const at = heroHtml.indexOf(room);
      expect(at).toBeGreaterThan(heroHtml.indexOf('id="pitch-heading"'));
      for (const later of ["data-dateline", 'data-toggle-room=""|aria-label="Drawing shows"', "data-day-graph", "data-hero-group"]) {
        const next = later.split("|").map((needle) => heroHtml.indexOf(needle)).filter((index) => index >= 0);
        expect(next.length).toBeGreaterThan(0);
        expect(at).toBeLessThan(Math.min(...next));
      }
      expect(html.match(/data-hero-room=""/g)).toHaveLength(1);
    }
    // The interactive view holds it while it draws a group in any state.
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    expect(source).toContain("reserve={heroGroup !== null}");
  }, 30_000);
});

describe("Keep this move, confirmed in place", () => {
  it("names the confirmation's words and its link", () => {
    expect(KEPT_IN_PLAN).toBe("Kept in your plan.");
    expect(KEPT_AGREE).toBe("Nothing moves until the acts’ teams agree.");
    expect(SEE_YOUR_PLAN).toBe("See your plan");
  });

  it("leaves the live region empty while the plan does not hold the move, and shows none without the button", () => {
    const linkRef = { current: null };
    expect(renderToStaticMarkup(createElement(KeptNotice, { shown: false, linkRef }))).toBe(
      '<div role="status" aria-live="polite" data-kept-notice=""></div>',
    );
    // The server HTML with no decision to keep draws no confirmation at all.
    expect(hero({ onOpenMove: undefined })).not.toContain("data-kept-notice");
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

  it("focuses the first displayed of several links, without scrolling", () => {
    const hidden = { getClientRects: () => [], focus: vi.fn() } as unknown as HTMLElement;
    const shown = { getClientRects: () => [{}], focus: vi.fn() } as unknown as HTMLElement;
    expect(focusShown([hidden, shown])).toBe(shown);
    expect(shown.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(focusShown([null, hidden])).toBeNull();
  });

  it("after a press, focus moves to the link without preventScroll, and a confirmation not wholly in view scrolls into view first", () => {
    const source = readFileSync(join(__dirname, "hero-decision.tsx"), "utf8");
    const effect = source.slice(source.indexOf("const link = linkRef.current;"), source.indexOf("}, [focusAsk, keptShown]);"));
    expect(effect).toContain('notice.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });');
    // Focus follows the scroll (at once under reduced motion, when the smooth scroll lands otherwise), so the
    // browser has nothing left to scroll; it is never asked to skip scrolling.
    expect(effect.match(/link\.focus\(\);/g)?.length).toBe(3);
    expect(effect).toContain('window.addEventListener("scrollend", land, { once: true });');
    expect(effect).not.toContain("preventScroll");
  });
});

describe("Keep this move on a plan that already holds steps (P1)", () => {
  // The decision's own move (Bo Diddly Squat to Side 21:30) and another kept move (invented).
  const move = day().copy?.seedMove as StackMove;
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

  it("draws the hero the same with an empty plan as with none, and draws no offer before a press", () => {
    expect(hero({ plan: [] })).toBe(hero({}));
    const holding = hero({ plan: [other], kept: { move: false, change: false } });
    expect(holding).not.toContain("data-keep-offer");
    expect(text(holding)).not.toContain(ADD_TO_PLAN);
    expect(text(holding)).not.toContain(REPLACE_PLAN);
    // The limits stay where they were, with no click, whatever the plan holds.
    expect(text(holding)).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
  });

  it("offers Add first (the outline button) and Replace (ghost) in the actions' own places, then what the plan holds in the confirmation's held room, with no id", () => {
    expect([ADD_TO_PLAN, REPLACE_PLAN]).toEqual(["Add to your plan", "Replace your plan"]);
    const offer = (state: Parameters<typeof KeepMoveOffer>[0]["offer"], held: readonly StackStep[] = [other]) =>
      renderToStaticMarkup(createElement(KeepMoveOffer, { offer: state, held, onAdd: () => {}, onReplace: () => {} }));
    const open = offer({ state: "open" });
    expect(text(open)).toBe("Add to your plan Replace your plan Your plan already holds 1 kept move.");
    // One named group that draws no box of its own, so its parts sit in the hero's actions grid.
    expect(open).toMatch(/^<div role="group" aria-label="Keep this move: add it to your plan, or replace your plan" data-keep-offer="" class="contents">/);
    // Add in Keep's place at Keep's 48 px; Replace beside it (48 px) from 380 px, in the paste's place below that
    // (the paste's 44 px); both buttons in one row, side by side, from 380 to 1023 px.
    expect(open).toMatch(/<div class="contents min-\[380px\]:flex min-\[380px\]:gap-3 min-\[380px\]:\[grid-area:keep\] lg:contents">/);
    expect(open).toMatch(/data-variant="outline" data-size="lg" class="[^"]*\bh-12\b[^"]*\[grid-area:keep\][^"]*"[^>]*>Add to your plan<\/button>/);
    expect(open).toMatch(/data-variant="ghost" data-size="default" class="[^"]*\bh-11\b[^"]*\[grid-area:paste\] max-\[379px\]:mt-2 min-\[380px\]:h-12"[^>]*>Replace your plan<\/button>/);
    expect(open.indexOf(ADD_TO_PLAN)).toBeLessThan(open.indexOf(REPLACE_PLAN));
    // The words take the confirmation's room at exactly its held height (54 px phone, 36 px from 640, 40 px from
    // 1024), in its type, so a longer line runs on below it instead of moving anything.
    const status = /<p data-keep-offer-status="" class="([^"]*)">/.exec(open)?.[1].split(" ") ?? [];
    expect(status).toEqual(
      expect.arrayContaining(["h-[3.375rem]", "sm:h-9", "lg:h-10", "[grid-area:notice]", "mt-1", "text-[0.8125rem]", "leading-[1.125rem]", "lg:text-sm", "lg:leading-5"]),
    );
    expect(status.some((name) => /^(min-h|max-h|overflow|line-clamp|truncate)/.test(name))).toBe(false);
    expect(open).not.toMatch(/\bid="|rounded-full|shadow|bg-(primary|success)|text-(primary|success)/);
    // A kept change counts as a step.
    expect(text(offer({ state: "open" }, [other, change]))).toContain("Your plan already holds 2 kept steps.");
    // While the whole plan is scored, Add is unavailable and the room says what is happening; the spinner sits
    // in those words (so Add keeps its width) and moves only when motion is allowed.
    const checking = offer({ state: "checking" });
    expect(checking).toMatch(/aria-disabled="true"[^>]*>Add to your plan<\/button>/);
    expect(checking).toContain("motion-safe:animate-spin");
    expect(text(checking)).toContain("Your plan already holds 1 kept move. Scoring your plan with this move added.");
    const button = /<button[^>]*>Add to your plan<\/button>/.exec(checking)?.[0] ?? "";
    expect(button).not.toContain("<svg");
    // Refused for good: the reason in words, and Replace alone, a new button in Keep's place with Add's outline
    // and Keep's 48 px. Refused for now: both ways stay, the reason in the room.
    const reason = "Not added: your plan already moves Bo Diddly Squat, and a plan moves each set once. Your plan is unchanged.";
    const refused = offer({ state: "rejected", reason, retry: false });
    expect(text(refused)).toBe(`${REPLACE_PLAN} ${reason}`);
    expect(refused).toMatch(/data-variant="outline" data-size="default" class="[^"]*\bh-12 \[grid-area:keep\]"[^>]*>Replace your plan<\/button>/);
    expect(refused).not.toContain(ADD_TO_PLAN);
    const failed = offer({ state: "rejected", reason, retry: true });
    expect(text(failed)).toBe(`${ADD_TO_PLAN} ${REPLACE_PLAN} ${reason}`);
  });

  it("draws the offer where Keep, its room and the paste are, holding their places unseen, so nothing moves", () => {
    const source = readFileSync(join(__dirname, "hero-decision.tsx"), "utf8");
    // The actions grid has no row of its own for the offer, and none for the ladder (round 39: it shares the notice cell).
    expect(source).toContain("[grid-template-areas:'keep'_'notice'_'paste']");
    expect(source).toContain("lg:[grid-template-areas:'keep_paste'_'notice_notice']");
    expect(source).not.toMatch(/grid-area:ladder|_'ladder'|ladder_ladder|LADDER_CELL/);
    expect(source).not.toContain("grid-area:offer");
    // Keep and the paste stay in the layout while the offer is up, unseen (not display: none).
    expect(source).toContain('offerShown && "invisible"');
    expect(source).toContain('showKeep && offerShown && "invisible"');
    expect(source).not.toMatch(/offerShown && "hidden"/);
    // Below 380 px, while the offer shows, the paste's row comes up under Keep's: Replace (in the paste's place) sits
    // directly under Add (in Keep's), with no control between them, and the words in the confirmation's room follow.
    expect(source).toContain(`showKeep && offerShown && "max-[379px]:[grid-template-areas:'keep'_'paste'_'notice']"`);
    // Escape puts the offer away and hands focus back to Keep; the whole offer under the fold (Add, Replace and
    // the words in the confirmation's room) comes into view by the least scroll, at once under reduced motion.
    expect(source).toContain("onDismiss={dismissOffer}");
    expect(source).toContain("keepRef.current?.focus({ preventScroll: true });");
    expect(source).toContain('const words = groupRef.current?.querySelector<HTMLElement>("[data-keep-offer-status]") ?? null;');
    expect(source).toContain("const parts = [addRef.current, replaceRef.current, words].flatMap(");
    expect(source).toContain('part?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });');
    // Escape on the offer puts it away (open, or refused); other keys do nothing, and so does Escape while an Add
    // is on its way.
    const keyDown = (state: Parameters<typeof KeepMoveOffer>[0]["offer"], key: string, onDismiss: () => void) => {
      const group = KeepMoveOffer({ offer: state, held: [other], onAdd: () => {}, onReplace: () => {}, onDismiss });
      const preventDefault = vi.fn();
      (group.props as { onKeyDown: (event: { key: string; preventDefault: () => void }) => void }).onKeyDown({ key, preventDefault });
      return preventDefault;
    };
    const dismissed = vi.fn();
    expect(keyDown({ state: "open" }, "Escape", dismissed)).toHaveBeenCalledTimes(1);
    expect(dismissed).toHaveBeenCalledTimes(1);
    keyDown({ state: "rejected", reason: "Not added.", retry: false }, "Escape", dismissed);
    expect(dismissed).toHaveBeenCalledTimes(2);
    keyDown({ state: "open" }, "Enter", dismissed);
    keyDown({ state: "checking" }, "Escape", dismissed);
    keyDown({ state: "sent" }, "Escape", dismissed);
    expect(dismissed).toHaveBeenCalledTimes(2);
  });

  it("brings the whole offer into view by its lowest part under the fold, its highest above the top, or not at all", () => {
    const viewport = 667;
    // A short phone below 380 px: Add in Keep's place, Replace directly under it in the paste's place (the paste's
    // row comes up while the offer shows), then the words in the confirmation's room.
    const add = { part: "add", top: 700, bottom: 748 };
    const replace = { part: "replace", top: 756, bottom: 800 };
    const words = { part: "words", top: 804, bottom: 858 };
    expect(offerPartToShow([add, replace, words], viewport)).toBe("words");
    // Whichever part is lowest is the one brought in, whatever order the parts come in.
    expect(offerPartToShow([add, { ...replace, top: 862, bottom: 906 }, words], viewport)).toBe("replace");
    // From 380 px both buttons share Keep's row, so the words in the room are the offer's foot.
    expect(offerPartToShow([add, { ...replace, top: 700, bottom: 748 }, words], viewport)).toBe("words");
    // Wholly in view: no scroll at all.
    expect(offerPartToShow([{ part: "add", top: 337, bottom: 385 }, { part: "words", top: 389, bottom: 429 }], 900)).toBeNull();
    // Scrolled past: its top comes back by the least scroll.
    expect(offerPartToShow([{ part: "add", top: -40, bottom: 8 }, { part: "words", top: 12, bottom: 66 }], viewport)).toBe("add");
    expect(offerPartToShow([], viewport)).toBeNull();
  });

  it("adds only once the engine scored the whole plan, and leaves the plan unchanged when it refuses", async () => {
    const kept: StackStep[] = [other];
    const check = vi.fn(async (steps: readonly StackStep[]) => (steps.length === 2 ? ready : ({ status: "error" } as PlanAnswer)));
    const act = day().copy?.moveAct ?? "";
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

describe("the hero's layout (server fallback, the interactive hero's final frame)", () => {
  const PRESETS: PresetSummary[] = [
    { id: "tiny-fest-sat", title: "Tiny Fest, Saturday", city: "Tiny Town", sets: 3, stages: 2, scored_share: 0.67 },
    { id: "other-fest-sun", title: "Other Fest 2031, Sunday", city: null, sets: 3, stages: 2, scored_share: 0.67 },
  ];

  afterEach(() => {
    vi.doUnmock("@/lib/art");
    vi.doUnmock("@/lib/check-flag");
    vi.resetModules();
  });

  async function fallback({ synthetic = false, art = false, live = true } = {}): Promise<string> {
    vi.resetModules();
    const real = await vi.importActual<typeof import("@/lib/art")>("@/lib/art");
    vi.doMock("@/lib/art", () => ({
      ...real,
      artSlot: (name: keyof typeof real.ART) => (art ? { ...real.ART[name], enabled: true } : null),
    }));
    vi.doMock("@/lib/check-flag", () => ({ CHECK_LIVE: live }));
    const { ClashControlFallback } = await import("./clash-control");
    const { summarize: build } = await import("@/lib/server-summary");
    const summary = build(tinyPreset({ synthetic }), decisionFor(), PRESETS);
    return renderToStaticMarkup(createElement(ClashControlFallback, { intro: createElement("h1", { id: "pitch-heading" }, "Pitch"), summary }));
  }

  it("reads in one DOM order at every width: pitch, day, toggle, drawing, decision group, key", async () => {
    const html = await fallback();
    // The group's own cell (the empty room that holds its height comes earlier, and holds nothing to read).
    const order = ["lg:[grid-area:pitch]", "lg:[grid-area:day]", "lg:[grid-area:toggle]", "lg:[grid-area:graph]", "lg:self-start lg:[grid-area:group]", "lg:[grid-area:key]"].map(
      (area) => html.indexOf(area),
    );
    order.forEach((at, i) => {
      expect(at, `area ${i}`).toBeGreaterThan(-1);
      if (i > 0) expect(at).toBeGreaterThan(order[i - 1]);
    });
    // From 1024 px the grid puts the group beside the pitch, the day and the toggle, and the drawing and its key
    // across both columns; the right column is 26rem, 28rem from 1280 px; the toggle sits at its row's foot.
    expect(html).toMatch(/lg:\[grid-template-areas:(&#x27;|')pitch_group\1_\1day_group\1_\1toggle_group\1_\1graph_graph\1_\1key_key\1\]/);
    expect(html).toContain("lg:grid-cols-[minmax(0,1fr)_26rem]");
    expect(html).toContain("xl:grid-cols-[minmax(0,1fr)_28rem]");
    expect(html).toContain("lg:grid-rows-[auto_auto_1fr_auto_auto]");
    expect(html).toMatch(/class="[^"]*lg:self-end lg:\[grid-area:toggle\]"/);
    // Nothing reorders it: no order class, so the tab order is the order seen.
    expect(html.slice(0, html.indexOf('aria-label="Timetable"'))).not.toMatch(/(?:^|\s)(?:[a-z-]+:)*-?order-\d/);
  });

  it("puts the festival picker in the hero, named by festival, with the day in the dateline under it", async () => {
    const html = await fallback();
    const picker = /<div role="radiogroup" aria-label="Festival day"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(picker).not.toBe("");
    expect(text(picker)).toBe("Tiny Fest Other Fest 2031");
    // Drawn before the page can act: the inputs are disabled, the chosen one checked.
    const radios = picker.match(/<input type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    for (const radio of radios) expect(radio).toContain('disabled=""');
    expect(radios[0]).toContain('checked=""');
    // One picker on the page: the board's header no longer has one.
    expect(html.match(/aria-label="Festival day"/g)).toHaveLength(1);
    const dateline = /<p data-dateline=""[^>]*>([^<]*)<\/p>/.exec(html)?.[1];
    expect(dateline).toBe("Saturday. Published timetable; saved Qloo reading built 1\u00a0Oct\u00a02026. Neither festival uses Clash Control.");
  });

  it("calls the saved reading global only where the preset sent no location, and makes no place claim otherwise", async () => {
    const { ClashControlFallback, datelineLead } = await import("./clash-control");
    const { summarize: build } = await import("@/lib/server-summary");
    const summary = build(tinyPreset(), decisionFor(), PRESETS);
    const dateline = (location: string | null | undefined) =>
      /<p data-dateline=""[^>]*>([^<]*)<\/p>/.exec(
        renderToStaticMarkup(
          createElement(ClashControlFallback, { intro: createElement("h1", { id: "pitch-heading" }, "Pitch"), summary: { ...summary, location } }),
        ),
      )?.[1];
    // None sent: the reading was asked for no place, so it is global.
    expect(dateline(null)).toBe("Saturday. Published timetable; saved global Qloo reading built 1\u00a0Oct\u00a02026. Neither festival uses Clash Control.");
    // A place sent: no "global", and no city claim.
    expect(dateline("London")).toBe("Saturday. Published timetable; saved Qloo reading built 1\u00a0Oct\u00a02026. Neither festival uses Clash Control.");
    // Not known (the server could not say): no claim either way.
    expect(dateline(undefined)).toBe("Saturday. Published timetable; saved Qloo reading built 1\u00a0Oct\u00a02026. Neither festival uses Clash Control.");
    // The lead on its own: the invented day and a day with no build date carry no reading to call global.
    const model = day().model;
    expect(datelineLead(model, false, null)).toBe("Saturday. Published timetable; saved global Qloo reading built 1\u00a0Oct\u00a02026.");
    expect(datelineLead(model, false, "Chicago, IL")).toBe("Saturday. Published timetable; saved Qloo reading built 1\u00a0Oct\u00a02026.");
    expect(datelineLead(model, true, null)).toBe("Invented timetable.");
    expect(datelineLead({ ...model, builtAt: null }, false, null)).toBe("Saturday. Published timetable.");
    expect(datelineLead(null, false, null)).toBeNull();
    // The interactive view reads the preset's own parsed location, the fallback the summary's.
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    expect(source).toContain("<HeroDateline model={model} synthetic={synthetic} location={preset.location} />");
    expect(source).toContain("<HeroDateline model={model} synthetic={synthetic} location={summary?.location} />");
  });

  it("keeps the build date in one piece: its three parts joined by no-break spaces, the rest of the sentence unchanged", async () => {
    const { datelineLead } = await import("./clash-control");
    const lead = datelineLead(day().model, false, null) ?? "";
    expect(lead).toContain("built 1 Oct 2026.");
    expect(lead.match(/ /g)).toHaveLength(2);
    expect(lead.replaceAll(" ", " ")).toBe("Saturday. Published timetable; saved global Qloo reading built 1 Oct 2026.");
  });

  it("puts the desktop note under the dateline, before the toggle, and none without a move", async () => {
    const html = await fallback();
    const note = /<p data-hero-note=""[^>]*>([^<]*)<\/p>/.exec(html);
    expect(note?.[1]).toBe(HERO_NOTE);
    expect(html.indexOf("data-hero-note")).toBeGreaterThan(html.indexOf("data-dateline"));
    expect(html.indexOf("data-hero-note")).toBeLessThan(html.indexOf("lg:[grid-area:toggle]"));
    // In the day's slot of the left column.
    const daySlot = html.slice(html.indexOf("lg:[grid-area:day]"), html.indexOf("lg:[grid-area:toggle]"));
    expect(daySlot).toContain("data-hero-note");
    // The invented day: the invented day's own rules, and nothing credits Qloo.
    const invented = /<p data-hero-note=""[^>]*>([^<]*)<\/p>/.exec(await fallback({ synthetic: true }))?.[1] ?? "";
    expect(invented).toBe(HERO_NOTE_INVENTED);
    expect(qlooCredits(invented)).toEqual([]);
    // The interactive view words it from its own decision.
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    expect(source).toContain("<HeroNote text={model ? heroNote(decision, synthetic) : null} />");
    expect(source).toContain("<HeroNote text={model ? heroNote(summary?.decisionData ?? null, synthetic) : null} />");
  });

  it("draws the toggle on the moved view, its first option 'As published' (on the invented day 'Invented timetable')", async () => {
    const toggle = (html: string) => /<div role="radiogroup" aria-label="Drawing shows"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    const published = toggle(await fallback());
    expect(text(published)).toBe("As published Bo Diddly Squat 60 min later");
    expect(published).toMatch(/value="moved"[^>]*checked=""|checked=""[^>]*value="moved"/);
    // It fills the row below 1024 px.
    expect(published).toMatch(/^<div role="radiogroup" aria-label="Drawing shows"[^>]*class="[^"]*\bgrid w-full\b[^"]*lg:inline-grid lg:w-auto/);
    const invented = toggle(await fallback({ synthetic: true }));
    expect(text(invented)).toBe("Invented timetable Bo Diddly Squat 60 min later");
  });

  it("prints the drawing's key under it, saying how to read the lines and the dashes", async () => {
    const html = await fallback();
    const { model } = day();
    const key = /<p data-day-graph-key=""[^>]*>([^<]*)<\/p>/.exec(html)?.[1];
    expect(key).toBe(keyLine(model));
    expect(key).toContain("Dashed: published slot or new overlap.");
    expect(html.indexOf("data-day-graph-key")).toBeGreaterThan(html.indexOf("data-hero-group"));
  });

  it("offers the paste as the outline secondary button beside Keep, and no microcopy", async () => {
    const html = await fallback();
    const plain = text(html);
    expect(plain).toContain("Paste your own draft grid");
    expect(plain).not.toContain("About a minute.");
    expect(plain).not.toContain("Nothing leaves your browser unless you ask to compare audiences.");
    // The secondary button: outline (no fill), 44 px on a phone and 48 px beside Keep from 1024 px, the 10 px
    // control corner, with a trailing arrow, so "Keep this move" stays the one solid button.
    expect(html).toMatch(/<a(?=[^>]*data-variant="outline")(?=[^>]*data-size="default")(?=[^>]*href="\/check")(?=[^>]*lg:h-12)[^>]*>Paste your own draft grid<svg/);
    expect(html).not.toMatch(/<a(?=[^>]*data-variant="(default|ruled|soft)")(?=[^>]*href="\/check")/);
    expect(html.match(/>Paste your own draft grid</g)).toHaveLength(1);
    // After Keep and its confirmation's room in the DOM.
    expect(html.indexOf("Paste your own draft grid")).toBeGreaterThan(html.indexOf("data-kept-notice"));
    // Without /check live there is no paste.
    expect(text(await fallback({ live: false }))).not.toContain("Paste your own draft grid");
  });

  it("never draws an art slot in the hero, even once art.ts enables it, and has no stat sentence", async () => {
    for (const art of [false, true]) {
      const html = await fallback({ art });
      expect(html).not.toContain("hero-site-plan");
      // No stat attribute (data-hero-state, the group's state, is another attribute).
      expect(html).not.toMatch(/data-hero-stat(?!e=)/);
    }
  });

  it("shows the invented day's proof line and 'Invented timetable', and credits Qloo nowhere in the hero", async () => {
    const html = await fallback({ synthetic: true });
    const heroHtml = html.slice(0, html.indexOf('aria-label="Timetable"'));
    const dateline = /<p data-dateline=""[^>]*>([^<]*)<\/p>/.exec(heroHtml)?.[1] ?? "";
    expect(dateline.startsWith("Invented timetable. Shown here on an invented day")).toBe(true);
    expect(dateline).toContain("no Qloo request was made");
    const all = `${text(heroHtml)}. ${[...heroHtml.matchAll(/(?:title|aria-label)="([^"]*)"/g)].map((m) => m[1]).join(". ")}`;
    expect(qlooCredits(all)).toEqual([]);
    expect(text(heroHtml)).not.toMatch(/as published|Published timetable/);
  });

  it("draws the toggle, the readout and Keep in the server's frame from a complete seed, with no second request (round 37, L1)", async () => {
    const { ClashControlFallback } = await import("./clash-control");
    const { loadServerSummary } = await import("@/lib/server-summary");
    const render = async (decision: unknown) => {
      const asked: string[] = [];
      const fetcher = vi.fn(async (url: string) => {
        const path = url.replace("http://api.test", "");
        asked.push(path);
        if (path === "/api/presets") return new Response(JSON.stringify(PRESETS), { status: 200 });
        if (path === "/api/presets/tiny-fest-sat") return new Response(JSON.stringify({ ...rawTinyPreset(), decision }), { status: 200 });
        return new Response("{}", { status: 404 });
      });
      const summary = await loadServerSummary(null, { backend: "http://api.test", fetcher });
      const html = renderToStaticMarkup(createElement(ClashControlFallback, { intro: createElement("h1", { id: "pitch-heading" }, "Pitch"), summary }));
      return { html, asked };
    };
    // The preset response carries the decision: one consistent frame, and only the list and the preset asked.
    const seeded = await render(RAW_DECISION);
    expect(seeded.asked).toEqual(["/api/presets", "/api/presets/tiny-fest-sat"]);
    const toggle = /<div role="radiogroup" aria-label="Drawing shows"[\s\S]*?<\/div>/.exec(seeded.html)?.[0] ?? "";
    expect(text(toggle)).toBe("As published Bo Diddly Squat 60 min later");
    const readout = /<p data-readout=""[^>]*>[\s\S]*?<\/p>/.exec(seeded.html)?.[0] ?? "";
    expect(seen(readout)).toBe("60 → 0 min shared with Ann Arbor");
    const keep = /<button[^>]*data-variant="default"[^>]*>[\s\S]*?<\/button>/.exec(seeded.html)?.[0] ?? "";
    expect(seen(keep)).toBe("Keep this move");
    expect(keep).toContain('disabled=""');
    expect(seeded.html).toContain('data-hero-state="pending"');
    expect(seeded.html).toContain("data-taste-line");
    // A seed that says the day has no decision: the skeleton and the toggle's room, still no second request.
    const none = await render(null);
    expect(none.asked).toEqual(["/api/presets", "/api/presets/tiny-fest-sat"]);
    expect(none.html).toContain('data-hero-state="skeleton"');
    expect(none.html).toContain('data-toggle-room=""');
    expect(none.html).not.toMatch(/data-readout|aria-label="Drawing shows"|Keep this move/);
  });

  it("builds its drawing from the same model the server summary carries", () => {
    const summary = summarize(tinyPreset(), decisionFor(), PRESETS);
    expect(summary.dayGraph).toEqual(day().model);
    expect(summary.presets).toEqual(PRESETS);
  });
});

describe("the index card's clash action", () => {
  it("opens the pair its hidden-clash line describes, and the day's hero clash only when the card has no such line", async () => {
    const { cardClashAction } = await import("./clash-control");
    const preset = tinyPreset();
    const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
    const built = buildDecisionCopy(preset, decisionFor());
    expect(built).not.toBeNull();
    const copy = built ?? { clashLine: "" };
    // The tiny day's card pair (Ann Arbor and Bo Diddly Squat) carries the Hidden label, so the card describes it in
    // its hidden-clash line; the action that closes that line opens that same pair.
    expect(isHiddenDecision(copy)).toBe(true);
    const cardPair = ranked.find((clash) => clash.a.act_id === "ann" && clash.b.act_id === "bo") ?? null;
    expect(cardPair).not.toBeNull();
    // Another hidden clash, which the day's hero button would choose first.
    const other: PairClash = {
      ...ranked[0],
      rank: 2,
      a: { ...ranked[0].a, act_id: "cy", name: "Cy Twombly" },
      b: { ...ranked[0].b, act_id: "di", name: "Di Gata" },
    };
    const hero = { clash: other, kind: "hidden" as const };
    expect(cardClashAction(hero, cardPair, true)).toEqual({ clash: cardPair, label: "Open a hidden clash" });
    // Without that line (the card's pair is not hidden), the action is a line of its own: the hero clash, named
    // for its kind, and only rank 1 is called the costliest.
    expect(cardClashAction(hero, cardPair, false)).toEqual({ clash: other, label: "Open a hidden clash" });
    expect(cardClashAction({ clash: other, kind: "evidence" }, cardPair, false)).toEqual({ clash: other, label: "Open a clash and its evidence" });
    expect(cardClashAction({ clash: ranked[0], kind: "costliest" }, null, false)).toEqual({ clash: ranked[0], label: "Open the costliest clash" });
    // A card whose pair is not among the day's ranked clashes: the hero clash.
    expect(cardClashAction(hero, null, true)).toEqual({ clash: other, label: "Open a hidden clash" });
    expect(cardClashAction(null, cardPair, true)).toEqual({ clash: cardPair, label: "Open a hidden clash" });
    expect(cardClashAction(null, null, false)).toBeNull();
    // On the tiny day itself the hero clash is the card's pair as well.
    expect(cardClashAction(heroClash(ranked, preset.evidence, () => false), cardPair, isHiddenDecision(copy))?.clash).toBe(cardPair);
    // The page hands the card this action, decided by the line's own test, and opens no other clash past it.
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    expect(source).toContain("const cardAction = cardClashAction(hero, decisionPair, decisionCopy !== null && isHiddenDecision(decisionCopy));");
    expect(source).toContain("onOpenHidden={cardAction ? (trigger) => openClash(cardAction.clash, trigger) : undefined}");
    expect(source).toContain("hiddenLabel={cardAction?.label}");
    expect(source).not.toContain("openClash(hero.clash");
  });
});

describe("the desktop note under the dateline (round 39, W6)", () => {
  /** A rule answer for the clash's pair whose first change moves two sets and leaves 0 minutes shared. */
  const twoSetRule = {
    kind: "rule_fixes",
    a: { act_id: "ann", act: "Ann Arbor", locked: false, place: "Main 20:00-21:30" },
    b: { act_id: "bo", act: "Bo Diddly Squat", locked: false, place: "Side 20:30-22:00" },
    rule: "Ann Arbor and Bo Diddly Squat must not overlap",
    shared_minutes: 60,
    holds: false,
    single_set_places: 1,
    fixes_found: 1,
    searched: "x",
    fixes: [
      {
        sets_moved: 2,
        minutes_moved: 120,
        stage_changes: 0,
        budget_after: 98.4,
        minutes_shared_after: 0,
        moves: [
          { act_id: "bo", act: "Bo Diddly Squat", from: "Side 20:30-22:00", stage_id: "side", stage: "Side", day: 0, start: "21:30", end: "23:00", minutes_moved: 60 },
          { act_id: "cy", act: "Cy Twombly", from: "Side 20:30-22:00", stage_id: "side", stage: "Side", day: 0, start: "19:00", end: "20:00", minutes_moved: 60 },
        ],
      },
    ],
  };
  const alternative = {
    act_id: "ann",
    act: "Ann Arbor",
    from: "Main 20:00-21:30",
    stage_id: "main",
    stage: "Main",
    day: 0,
    start: "18:30",
    end: "20:00",
    minutes_moved: 90,
  };

  it("says what every move keeps, and that a clash can be kept on purpose, word for word on each kind of day", () => {
    expect(HERO_NOTE).toBe("Moves keep stage hours, the latest published end, changeovers and this app’s locks; a clash can be kept on purpose.");
    expect(HERO_NOTE_INVENTED).toBe("Moves keep the invented day’s stage hours, curfew, changeovers and locks; a clash can be kept on purpose.");
    expect(heroNote(decisionFor(), false)).toBe(HERO_NOTE);
    expect(heroNote(decisionFor(), true)).toBe(HERO_NOTE_INVENTED);
    // One line whatever the decision holds: a tie for the lowest index or a two-set rule change adds nothing to it.
    const tied = decisionFor({ move: { ...RAW_DECISION.move, same_index_alternative: alternative }, rule: twoSetRule });
    expect(tied.move?.alternative?.act).toBe("Ann Arbor");
    expect(tied.rule?.fixes[0].setsMoved).toBe(2);
    expect(heroNote(tied, false)).toBe(HERO_NOTE);
    expect(heroNote(tied, true)).toBe(HERO_NOTE_INVENTED);
    // The locks are this app's and the published day's curfew is its latest published end; no figure, no Qloo, and the
    // invented day names no "published" and no app lock.
    for (const note of [HERO_NOTE, HERO_NOTE_INVENTED]) {
      expect(note).toContain("a clash can be kept on purpose");
      expect(note).not.toMatch(/\d/);
      expect(qlooCredits(note)).toEqual([]);
    }
    expect(HERO_NOTE_INVENTED).not.toMatch(/published|this app/);
    // The round-37 sentences are gone from the hero (S1 and S2 live in the index card's "How this was chosen").
    const source = readFileSync(join(__dirname, "hero-decision.tsx"), "utf8");
    expect(source).not.toMatch(/NOTE_LOWEST|NOTE_TIED|NOTE_TWO_SETS|NOTE_NEAR_100|Near 100 means|Of the legal moves checked/);
  });

  it("is null without a move, and without a decision", () => {
    expect(heroNote(decisionFor({ move: null }), false)).toBeNull();
    expect(heroNote(decisionFor({ move: null }), true)).toBeNull();
    expect(heroNote(null, false)).toBeNull();
    expect(renderToStaticMarkup(createElement(HeroNote, { text: null }))).toBe("");
  });

  it("prints one muted 13 px paragraph on 20 px, shown only from 1280 px wide and 791 px tall", () => {
    const html = renderToStaticMarkup(createElement(HeroNote, { text: HERO_NOTE }));
    expect(html).toBe(
      `<p data-hero-note="" class="mt-1 hidden max-w-[44rem] text-[0.8125rem] leading-5 text-muted-foreground xl:[@media(min-height:791px)]:block">${HERO_NOTE}</p>`,
    );
  });
});

describe("the hero's ladder (round 39, W3): the decision's clash ranked three ways, the hero's picture of what Qloo changes", () => {
  const moved: ThreeReadings = { time: { rank: 23, of: 68, tied: 18 }, draw: { rank: 18, of: 68 }, taste: { rank: 1, of: 68 } };
  const unmoved: ThreeReadings = { time: { rank: 5, of: 47 }, draw: { rank: 1, of: 47 }, taste: { rank: 1, of: 47 } };
  const ladder = (readings: ThreeReadings, synthetic = false) => renderToStaticMarkup(createElement(HeroLadder, { readings, synthetic }));

  it("names each rung by what it adds, closes on whose ranks they are, and credits taste with its own step only (Glastonbury)", () => {
    const html = ladder(moved);
    // What a screen reader hears (the arrows are drawn only), and what the eye reads.
    expect(heard(html)).toBe("Time alone #23 + Qloo popularity #18 + taste overlap #1 of 68 in this app’s index");
    expect(text(html)).toBe("Time alone #23 → + Qloo popularity #18 → + taste overlap #1 of 68 in this app’s index");
    expect(html.match(/<span aria-hidden="true"[^>]*>→<\/span>/g)).toHaveLength(2);
    expect(LADDER_SCOPE).toBe("in this app’s index");
    // Taste's step is #18 to #1; nothing reads as taste moving the pair from #23.
    expect(text(html)).not.toMatch(/taste[^.]*#23|from #23/);
    // The section's sentence for what taste did is no longer in the hero; "What Qloo changes" says it in full.
    expect(text(html)).not.toMatch(/Adding taste/);
    // One ordered list, one item per rung, named by the section's own helper.
    expect(html).toMatch(/^<ol data-hero-ladder=""/);
    const labels = rungLabels(false, true);
    for (const key of ["time", "draw", "taste"] as const) {
      expect(html).toContain(`data-rung="${key}"`);
      expect(html).toContain(`>${labels[key]}</span>`);
    }
    expect(html.match(/<li\b/g)).toHaveLength(3);
    // Ink only: no raspberry (shared time) and no teal (Qloo) on a rank or anywhere in the ladder.
    expect(html).not.toMatch(/text-primary|text-qloo|prov-qloo|bg-primary|text-teal|raspberry/);
  });

  it("says taste leaves the pair where it was by its ranks alone, with the shared count once (Riot Fest)", () => {
    const html = ladder(unmoved);
    expect(heard(html)).toBe("Time alone #5 + Qloo popularity #1 + taste overlap #1 of 47 in this app’s index");
    expect(text(html)).toBe("Time alone #5 → + Qloo popularity #1 → + taste overlap #1 of 47 in this app’s index");
    expect(text(html).match(/ of 47/g)).toHaveLength(1);
  });

  it("names no Qloo on the invented day, and prints each rung's own count when they rank different numbers", () => {
    const shared = text(ladder(moved, true));
    expect(shared).toBe("Time alone #23 → + invented popularity #18 → + invented taste #1 of 68 in this app’s index");
    const own = text(ladder({ ...moved, draw: { rank: 18, of: 60 } }, true));
    expect(own).toBe("Time alone #23 of 68 → + invented popularity #18 of 60 → + invented taste #1 of 68 in this app’s index");
    for (const line of [shared, own]) {
      expect(line).toContain("+ invented taste #1 of 68");
      expect(line).not.toMatch(/Qloo/);
      expect(qlooCredits(line)).toEqual([]);
      expect(line).not.toMatch(/taste[^.]*#23|from #23/);
    }
  });

  it("prints each rank in the numeral type, 20 px on a 24 px line and 24 px on a 28 px line from 1280 px, its name 13 px", () => {
    const html = ladder(moved);
    const ranks = [...html.matchAll(/<span data-rank="" class="([^"]*)">([^<]*)<\/span>/g)];
    expect(ranks.map((m) => m[2])).toEqual(["#23", "#18", "#1"]);
    for (const [, classes] of ranks) expect(classes.split(" ")).toEqual(["type-numeral", "text-xl", "leading-6", "xl:text-2xl", "xl:leading-7"]);
    // The names 13 px on a 16 px line, inside the ranks' line, so a line of rungs is exactly its ranks' height.
    expect(html).toMatch(/^<ol data-hero-ladder="" class="text-\[0\.8125rem\] leading-4">/);
    // Muted for the first two names, semibold ink for the last; the count and whose ranks they are, muted.
    expect(html).toContain('<span class="text-muted-foreground">Time alone</span>');
    expect(html).toContain('<span class="text-muted-foreground">+ Qloo popularity</span>');
    expect(html).toContain('<span class="font-semibold">+ taste overlap</span>');
    expect(html).toMatch(/<span class="text-muted-foreground tabular-nums"> of (<!-- -->)?68<\/span>/);
    expect(html).toContain(`<span data-ladder-scope="" class="whitespace-nowrap text-muted-foreground">${LADDER_SCOPE}</span>`);
  });

  it("breaks a line only between rungs and before whose ranks they are, never inside a rung or between a rank and its count", () => {
    const html = ladder(moved);
    // Every rung holds its name, rank and count on one line.
    const rungs = [...html.matchAll(/<li data-rung="(\w+)" class="([^"]*)">/g)];
    expect(rungs.map((m) => m[1])).toEqual(["time", "draw", "taste"]);
    for (const [, , classes] of rungs) expect(classes.split(" ")).toEqual(expect.arrayContaining(["inline", "whitespace-nowrap"]));
    // The rungs are parted by a normal space in the list itself, where a line may break.
    expect(html).toMatch(/<\/li> <li data-rung="draw"/);
    expect(html).toMatch(/<\/li> <li data-rung="taste"/);
    // Inside the last rung, the one break: a normal space before "in this app’s index", which never breaks itself.
    expect(html).toContain(`<span class="whitespace-normal"> <span data-ladder-scope="" class="whitespace-nowrap text-muted-foreground">${LADDER_SCOPE}</span></span>`);
  });

  it("prints nothing without the readings that carry draw", () => {
    expect(ladder({ ...moved, draw: undefined })).toBe("");
    expect(ladder({ ...moved, taste: null })).toBe("");
    expect(ladder({ ...moved, draw: null })).toBe("");
  });

  it("below 1280 px sits in the notice cell, sharing it with Keep's confirmation, beside its live region and never in it", () => {
    vi.stubEnv("NEXT_PUBLIC_CHECK_LIVE", "1");
    const settled = hero({ ladder: moved });
    const at = (needle: string) => settled.indexOf(needle);
    // One cell: the confirmation's live region, then the ladder, both in the notice row, before the paste.
    const row = settled.slice(at('data-hero-row="notice"'), at('href="/check"'));
    expect(row).toContain("data-kept-notice");
    expect(row).toContain("data-hero-ladder");
    expect(row.indexOf("data-hero-ladder")).toBeGreaterThan(row.indexOf("data-kept-notice"));
    const live = /<div role="status" aria-live="polite" data-kept-notice=""[^>]*>([\s\S]*?)<\/div>/.exec(settled)?.[1] ?? "";
    expect(live).not.toContain("data-hero-ladder");
    // Both take the row's one cell, so they overlap and never stack; the ladder's cell is hidden from 1280 px.
    const cell = /<div data-hero-ladder-cell=""( aria-hidden="true")? class="([^"]*)">/.exec(settled);
    expect(cell?.[1]).toBeUndefined();
    expect(cell?.[2].split(" ")).toEqual(["col-start-1", "row-start-1", "min-w-0", "xl:hidden"]);
    expect(/data-kept-notice="" class="([^"]*)"/.exec(settled)?.[1].split(" ")).toEqual(expect.arrayContaining(["col-start-1", "row-start-1"]));
    expect(heard(row)).toContain("Time alone #23 + Qloo popularity #18 + taste overlap #1 of 68 in this app’s index");
    // No ladder row of its own any more, at any width.
    expect(settled).not.toContain('data-hero-row="ladder"');
    // Every guarded line stays beside its number with the ladder in.
    expect(text(settled)).toContain("(a rank, not attendance)");
    expect(text(settled)).toContain("Selected and scored by this app’s index. A reading, not a verdict.");
    // Its cell is held empty, and hidden from assistive tech, until the readings that carry draw come.
    for (const html of [hero(), hero({ ladder: { ...moved, draw: undefined } }), hero({ ladder: null })]) {
      expect(html).toMatch(/<div data-hero-ladder-cell="" aria-hidden="true" class="col-start-1 row-start-1 min-w-0 xl:hidden"><\/div>/);
      expect(html).not.toContain("data-hero-ladder=");
    }
    vi.unstubAllEnvs();
  });

  it("steps aside, unseen and hidden from assistive tech but still in its cell, while the confirmation or the offer shows", () => {
    // The plan holds the move: the confirmation fills the cell, and the ladder keeps its place unseen.
    for (const kept of [hero({ ladder: moved, kept: { move: true, change: false } }), hero({ ladder: moved, kept: { move: true, change: false } }, { synthetic: true })]) {
      const cell = /<div data-hero-ladder-cell="" aria-hidden="true" class="([^"]*)">([\s\S]*?)<\/ol><\/div>/.exec(kept);
      expect(cell).not.toBeNull();
      expect(cell?.[1].split(" ")).toEqual(["col-start-1", "row-start-1", "min-w-0", "xl:hidden", "invisible"]);
      expect(cell?.[2]).toMatch(/^<ol data-hero-ladder=""/);
      expect(text(/<div role="status" aria-live="polite" data-kept-notice=""[^>]*>([\s\S]*?)<\/div>/.exec(kept)?.[1] ?? "")).toMatch(/^Kept in your plan\./);
    }
    // The cell steps aside for the confirmation or the offer's words, only where Keep is drawn.
    expect(noticeTaken(true, false, null)).toBe(false);
    expect(noticeTaken(true, true, null)).toBe(true);
    for (const offer of [{ state: "open" }, { state: "checking" }, { state: "sent" }, { state: "rejected", reason: "Not added.", retry: false }] as const) {
      expect(noticeTaken(true, false, offer)).toBe(true);
    }
    expect(noticeTaken(false, true, { state: "open" })).toBe(false);
    // The hero hides the ladder by exactly that test (an offer shows only after a press, so it is read in the source).
    const source = readFileSync(join(__dirname, "hero-decision.tsx"), "utf8");
    expect(source).toContain("const noticeShown = noticeTaken(showKeep, keptShown, offerShown);");
    expect(source).toContain("aria-hidden={ladderShown && !noticeShown ? undefined : true}");
    expect(source).toContain('className={cn(NOTICE_CELL, "xl:hidden", noticeShown && "invisible")}');
    // Not kept, no offer: the ladder shows and is heard.
    expect(hero({ ladder: moved, kept: { move: false, change: false } })).toMatch(
      /<div data-hero-ladder-cell="" class="col-start-1 row-start-1 min-w-0 xl:hidden"><ol data-hero-ladder=""/,
    );
  });

  it("from 1280 px is one row in the left column, under the dateline and the note, its 29 px room held empty until the readings come", () => {
    // The room: mt-2 and 29 px (the filled ladder measures 28 px at 1280 x 800, 1366 x 768 and 1440 x 900), from
    // 1280 px only, empty and hidden from assistive tech without the readings.
    const room = '<div data-hero-ladder-room="" aria-hidden="true" class="mt-2 hidden min-h-[1.8125rem] xl:block"></div>';
    expect(renderToStaticMarkup(createElement(HeroLadderRoom, { synthetic: false }))).toBe(room);
    expect(renderToStaticMarkup(createElement(HeroLadderRoom, { readings: { ...moved, draw: undefined }, synthetic: false }))).toBe(room);
    const filled = renderToStaticMarkup(createElement(HeroLadderRoom, { readings: moved, synthetic: false }));
    expect(filled).toMatch(/^<div data-hero-ladder-room="" class="mt-2 hidden min-h-\[1\.8125rem\] xl:block"><ol data-hero-ladder=""/);
    // The same component, the same words, in both places.
    expect(heard(filled)).toBe("Time alone #23 + Qloo popularity #18 + taste overlap #1 of 68 in this app’s index");
    expect(heard(renderToStaticMarkup(createElement(HeroLadderRoom, { readings: unmoved, synthetic: false })))).toBe(
      "Time alone #5 + Qloo popularity #1 + taste overlap #1 of 47 in this app’s index",
    );
    const invented = heard(renderToStaticMarkup(createElement(HeroLadderRoom, { readings: moved, synthetic: true })));
    expect(invented).toBe("Time alone #23 + invented popularity #18 + invented taste #1 of 68 in this app’s index");
    // Both hero paths hold the room right after the note, in the day's slot.
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    expect(source).toContain("{model ? <HeroLadderRoom synthetic={synthetic} /> : null}");
    expect(source).toContain("{model ? <HeroLadderRoom readings={heroLadder} synthetic={synthetic} /> : null}");
    expect(source.match(/<HeroNote [^\n]*\n\s*\{model \? <HeroLadderRoom /g)).toHaveLength(2);
  });
});
