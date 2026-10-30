import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { topClashes } from "@/lib/clashes";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import type { Decision } from "@/lib/decision";
import { parsePreset, type Evidence, type Preset, type PresetSummary } from "@/lib/preset";
import { summarize } from "@/lib/server-summary";

import {
  boardFoldSummary,
  boardStartsOpen,
  carryBoardFold,
  ClashControlFallback,
  type BoardFoldCarry,
  HIDDEN_WALL_ID,
  HOME_ORDER,
  HomeSections,
  pagePlace,
  pagePlaceTarget,
  type PagePlace,
  SOURCES_ID,
  agentJump,
  borrowsWall,
  currentJump,
  dayToDraw,
  jumpLinks,
  publishedDays,
  readWideBoard,
  subscribeNothing,
  useWideBoard,
  wallLenders,
  WIDE_BOARD_QUERY,
} from "./clash-control";
import { KEEP_APART_ID, KEEP_APART_SUMMARY } from "./keep-apart";
import { TRY_A_MOVE_ID, TryAMove } from "./try-a-move";
import { WHAT_QLOO_ID } from "./why-qloo";
import { WHY_THIS_MATTERS_ID } from "./why-this-matters";

/** Each home section's anchor, as the section nav links to it. */
const ANCHORS: Record<(typeof HOME_ORDER)[number], string> = {
  qloo: WHAT_QLOO_ID,
  wall: HIDDEN_WALL_ID,
  why: WHY_THIS_MATTERS_ID,
  board: "board-heading",
  move: TRY_A_MOVE_ID,
  agent: "agent",
  sources: SOURCES_ID,
};

const agent = { href: "#agent", label: "Agent runs" };
const qloo = { href: `#${WHAT_QLOO_ID}`, label: "What Qloo changes" };

describe("the home page's order", () => {
  it("puts Hidden clashes second, after What Qloo changes and before Why this matters and the timetable", () => {
    expect(HOME_ORDER).toEqual(["qloo", "wall", "why", "board", "move", "agent", "sources"]);
  });

  it("renders the sections in that order in the DOM, whatever order they are passed in", () => {
    const section = (key: string) => createElement("section", { id: ANCHORS[key as keyof typeof ANCHORS] });
    const html = renderToStaticMarkup(
      createElement(HomeSections, {
        sources: section("sources"),
        agent: section("agent"),
        move: section("move"),
        board: section("board"),
        why: section("why"),
        wall: section("wall"),
        qloo: section("qloo"),
      }),
    );
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(HOME_ORDER.map((key) => ANCHORS[key]));
  });

  it("lists the section nav in the same order, labels only", () => {
    const links = jumpLinks({ agent, wall: true, qloo });
    expect(links.map((link) => link.label)).toEqual([
      "What Qloo changes",
      "Hidden clashes",
      "Why this matters",
      "Timetable",
      "Try a move",
      "Agent runs",
      "Sources",
    ]);
    expect(links.map((link) => link.href)).toEqual(HOME_ORDER.map((key) => `#${ANCHORS[key]}`));
    // A day without examples, or a card without its readings, drops only that entry; the rest keep their order.
    expect(jumpLinks({ agent, wall: false, qloo: null }).map((link) => link.label)).toEqual([
      "Why this matters",
      "Timetable",
      "Try a move",
      "Agent runs",
      "Sources",
    ]);
  });

  it("names the agent section 'Agent runs' while recorded runs are shown, and 'Agent' when there are none", () => {
    const runs = [{}, {}, {}];
    // The live agent off and the day's runs in: the word "agent" is in the first screen's nav.
    expect(agentJump("off", { status: "ready", runs })).toEqual({ href: "#agent", label: "Agent runs" });
    // While either answer is coming, the label it will most likely settle on, so the nav does not reflow.
    expect(agentJump("checking", { status: "loading", runs: [] }).label).toBe("Agent runs");
    expect(agentJump("unknown", { status: "loading", runs: [] }).label).toBe("Agent runs");
    expect(agentJump("checking", { status: "ready", runs }).label).toBe("Agent runs");
    // No recorded runs shown: the live agent is on, or the day has none.
    expect(agentJump("on", { status: "ready", runs })).toEqual({ href: "#agent", label: "Agent" });
    expect(agentJump("on", { status: "loading", runs: [] }).label).toBe("Agent");
    expect(agentJump("off", { status: "ready", runs: [] }).label).toBe("Agent");
    expect(agentJump("off", { status: "error", runs: [] }).label).toBe("Agent");
    expect(agentJump("checking", { status: "ready", runs: [] }).label).toBe("Agent");
    // The page builds the nav's entry from it, and nowhere else says "Recorded runs" in the nav.
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    expect(source).toContain("const agentLink = agentJump(agentStatus, recordings);");
    expect(source).toContain("agent={agentLink}");
    expect(source).not.toContain('label: "Recorded runs"');
  });

  it("hands the agent section the published days from the list the page holds, never the invented day, with no second fetch", () => {
    const presets = [
      { id: "glasto", title: "Glasto Fest 2030, Sunday", city: null, sets: 1, stages: 1, scored_share: 1, synthetic: false },
      { id: "invented", title: "Invented", city: null, sets: 1, stages: 1, scored_share: 1, synthetic: true },
      { id: "riot", title: "Riot Fest 2031, Sunday", city: null, sets: 1, stages: 1, scored_share: 1, synthetic: false },
    ] as unknown as PresetSummary[];
    expect(publishedDays(presets)).toEqual([
      { id: "glasto", title: "Glasto Fest 2030, Sunday" },
      { id: "riot", title: "Riot Fest 2031, Sunday" },
    ]);
    expect(publishedDays([])).toEqual([]);
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    const view = source.slice(source.indexOf("function PresetView("), source.indexOf("<ClashDrawer"));
    expect(view).toContain("const published = useMemo(() => publishedDays(presets), [presets]);");
    const panel = view.slice(view.indexOf("<AgentPanel"), view.indexOf("/>", view.indexOf("<AgentPanel")));
    expect(panel).toContain("publishedDays={published}");
    // The page reads the list once (usePresets); the view adds no fetch of the list.
    expect(view).not.toMatch(/fetch\(["`]\/api\/presets["`]/);
  });

  it("draws the section nav with no numerals: each link is its label, with the one ink marker under the current one", () => {
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    const nav = source.slice(source.indexOf("function JumpNav("), source.indexOf("function LoadingView("));
    expect(nav).not.toBe("");
    // The label is the link's only content; no step number before it, in any face.
    expect(nav).toContain('<span data-nav-label="">{link.label}</span>');
    expect(nav).not.toMatch(/index \+ 1|type-numeral/);
    // The same links and the same marker (its round ends: a 3 px bar, clamped by the mark corner).
    expect(nav).toContain("rounded-bar bg-foreground");
    expect(nav).toContain('aria-current={on ? "location" : undefined}');
    // The current item changes as the page scrolls, and nothing moves on scroll: the marker takes its new place at
    // once, in every motion setting, with no transition, duration or animation anywhere in the nav.
    expect(nav).not.toMatch(/transition|duration-|animate|ease-/);
    expect(nav).toContain('marker.style.transform = `translateX(${label.offsetLeft}px)`;');
  });

  it("passes every section through HomeSections in the page itself", () => {
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    const view = source.slice(source.indexOf("<HomeSections"), source.indexOf("<ClashDrawer"));
    for (const key of HOME_ORDER) expect(view, key).toMatch(new RegExp(`\\n        ${key}=\\{`));
    for (const element of ["<TasteSection", "<HiddenWall", "<WhyThisMatters", "<BoardFrame", "<TryAMove", "<AgentPanel", "<PresetSources"]) {
      expect(view, element).toContain(element);
    }
    // Keep two sets apart is no home section of its own; it lives inside Try a move.
    expect(view).not.toContain("<KeepApart");
    expect(HOME_ORDER).not.toContain("apart" as never);
  });

  it("keeps two sets apart inside Try a move, in one closed disclosure after the move's result, named for what it holds", () => {
    const preset = parsePreset(rawTinyPreset());
    const ranked = topClashes(preset.report.clashes, 0, Number.POSITIVE_INFINITY);
    const html = renderToStaticMarkup(createElement(TryAMove, { preset, day: 0, ranked, isLocked: () => false }));
    // Inside the Try a move section.
    expect(html.startsWith(`<section id="${TRY_A_MOVE_ID}"`)).toBe(true);
    const fold = /<details data-keep-apart-fold=""([^>]*)>([\s\S]*)<\/details>/.exec(html);
    expect(fold).not.toBeNull();
    // Closed on arrival: no open attribute.
    expect(fold?.[1]).not.toMatch(/\bopen\b/);
    // The summary says what is inside; the shared disclosure row (44px, the caret, the cobalt focus ring).
    expect(KEEP_APART_SUMMARY).toBe("Keep two sets apart: moves that end one overlap");
    expect(fold?.[2]).toMatch(new RegExp(`^<summary class="cc-disclosure-summary">${KEEP_APART_SUMMARY}<span aria-hidden="true" class="cc-disclosure-mark"></span></summary>`));
    // The section itself, its region name and its controls, unchanged inside the fold.
    expect(fold?.[2]).toContain(`<section id="${KEEP_APART_ID}"`);
    expect(fold?.[2]).toContain('aria-labelledby="keep-apart-heading"');
    expect(fold?.[2]).toContain('<h3 id="keep-apart-heading" class="sr-only">Keep two sets apart</h3>');
    expect(fold?.[2]).toContain("Find changes that end this overlap");
    expect(fold?.[2]).toMatch(/<p role="status" aria-live="polite" class="sr-only">/);
    // After the move's result (the picker and the tested place), and before the section's own status line.
    expect(html.indexOf("<details data-keep-apart-fold")).toBeGreaterThan(html.indexOf("data-move-picker"));
    expect(html.indexOf("<details data-keep-apart-fold")).toBeLessThan(html.lastIndexOf('<p role="status"'));
    expect(html.match(/<details data-keep-apart-fold/g)).toHaveLength(1);
    expect(html.match(new RegExp(`id="${KEEP_APART_ID}"`, "g"))).toHaveLength(1);
  });
});

describe("hidden-clash examples borrowed from another published day (kept)", () => {
  const evidence = (n: number): Evidence => ({
    hidden_wall: Array.from({ length: n }, (_, i) => ({
      festival: "test-fest-2025",
      day: "Sun",
      acts: [`Act ${i}A`, `Act ${i}B`],
      genres: [["urn:tag:genre:indie"], ["urn:tag:genre:punk"]],
      overlap_pct: 0.9,
      draw_pct: 0.8,
      overlap_min: 30,
      source: null,
      shared_tags: [],
    })),
    hidden_wall_total: n,
    receipts: {},
    twins: [],
  });
  const day = (evidenceOf: Evidence | null, synthetic?: boolean): Pick<Preset, "evidence" | "synthetic"> =>
    ({ evidence: evidenceOf, synthetic }) as Pick<Preset, "evidence" | "synthetic">;

  it("borrows only for a published day with no examples of its own, never on the invented day or in mock mode", () => {
    expect(borrowsWall(day(null), false)).toBe(true);
    expect(borrowsWall(day(evidence(0)), false)).toBe(true);
    expect(borrowsWall(day(evidence(3)), false)).toBe(false);
    // The invented day credits nothing to Qloo, so it never shows a published day's examples.
    expect(borrowsWall(day(null, true), false)).toBe(false);
    // Mock mode never fetches another day.
    expect(borrowsWall(day(null), true)).toBe(false);
  });

  it("reads only other published days, never the day itself or the invented day", () => {
    const presets = [
      { id: "riot", title: "Riot", city: null, sets: 1, stages: 1, scored_share: 1, synthetic: false },
      { id: "glasto", title: "Glasto", city: null, sets: 1, stages: 1, scored_share: 1, synthetic: false },
      { id: "invented", title: "Invented", city: null, sets: 1, stages: 1, scored_share: 1, synthetic: true },
    ] as unknown as PresetSummary[];
    expect(wallLenders(presets, "riot")).toEqual(["glasto"]);
    expect(wallLenders(presets, "invented")).toEqual(["riot", "glasto"]);
  });
});

describe("the section nav's current entry", () => {
  const tops = (values: (number | null)[]) => values.map((top, i) => ({ href: `#s${i}`, top }));
  const view = { innerHeight: 900, scrollY: 2000, scrollHeight: 10000 };

  it("marks the last section whose top has passed 40% of the viewport, and none at the very top", () => {
    expect(currentJump(tops([-500, 200, 800]), view)).toBe("#s1");
    expect(currentJump(tops([500, 800, 1200]), { ...view, scrollY: 0 })).toBeNull();
  });

  it("marks the last section once the page is scrolled to its end, though its top never reaches the line", () => {
    const end = { innerHeight: 900, scrollY: 9100, scrollHeight: 10000 };
    expect(currentJump(tops([-3000, -800, 500]), end)).toBe("#s2");
    // Within 2 px of the end counts; 3 px short does not.
    expect(currentJump(tops([-3000, -800, 500]), { ...end, scrollY: 9098 })).toBe("#s2");
    expect(currentJump(tops([-3000, -800, 500]), { ...end, scrollY: 9097 })).toBe("#s1");
    // A missing last section does not take the mark.
    expect(currentJump(tops([-3000, -800, null]), end)).toBe("#s1");
  });
});

describe("switching festival day", () => {
  const glasto = { ...parsePreset(rawTinyPreset()), id: "glasto" } as Preset;
  const riot = { ...parsePreset(rawTinyPreset()), id: "riot" } as Preset;
  // Only the decision's identity matters here: the page passes it on to the day's view untouched.
  const glastoDecision = { day: 0 } as unknown as Decision;
  const riotDecision = { day: 0 } as unknown as Decision;

  it("draws the first day as soon as its preset is in, with the decision the page holds or none", () => {
    expect(dayToDraw(null, undefined, null)).toBeNull();
    expect(dayToDraw(glasto, glastoDecision, null)).toEqual({ preset: glasto, decision: glastoDecision });
    // No decision in the server HTML: the day's own view asks for it, as it always has.
    expect(dayToDraw(glasto, undefined, null)).toEqual({ preset: glasto, decision: null });
  });

  it("holds the day drawn, the same object, while the chosen day's preset or decision is on its way", () => {
    const drawn = { preset: glasto, decision: glastoDecision };
    // The chosen day's preset has not come.
    expect(dayToDraw(null, undefined, drawn)).toBe(drawn);
    // Its preset is in, its decision is not.
    expect(dayToDraw(riot, undefined, drawn)).toBe(drawn);
    // The day drawn chosen again (another copy of its preset) changes nothing.
    expect(dayToDraw({ ...glasto } as Preset, glastoDecision, drawn)).toBe(drawn);
  });

  it("replaces the day drawn in one step once the chosen day's preset and decision are both in", () => {
    const drawn = { preset: glasto, decision: glastoDecision };
    expect(dayToDraw(riot, riotDecision, drawn)).toEqual({ preset: riot, decision: riotDecision });
    // A day whose route gave no decision is drawn with none, not held.
    expect(dayToDraw(riot, null, drawn)).toEqual({ preset: riot, decision: null });
    // Back to the first day: its decision is still known, so it is drawn at once.
    const back = { preset: riot, decision: riotDecision };
    expect(dayToDraw(glasto, glastoDecision, back)).toEqual(drawn);
  });

  it("never draws a loading view on a switch, and its picker names the day drawn", () => {
    const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
    const control = source.slice(source.indexOf("export function ClashControl("), source.indexOf("/** The festival-day tabs' group name"));
    expect(control).not.toBe("");
    // The loading view only before any day is drawn; after that the day drawn is held whole.
    expect(control).toContain("const shown = dayToDraw(chosen, chosenDecision, drawn);");
    expect(control).toContain("if (shown === null || list.status !== \"ready\") {");
    expect(control).toContain("key={shown.preset.id}");
    expect(control).toContain("selectedId={shown.preset.id}");
    // The other days are read ahead once a day is drawn, with GETs of saved files only.
    const ahead = source.slice(source.indexOf("async function readDayAhead("), source.indexOf("export function ClashControl("));
    expect(ahead).toContain("fetch(`/api/presets/${encodeURIComponent(id)}`");
    expect(ahead).toContain("requestDecision(preset.id, day, signal)");
    expect(ahead).not.toMatch(/method:|whatif|price-grid|\/pair|\/runs/);
  });
});

describe("the board behind one disclosure", () => {
  const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
  const boardSection = source.slice(source.indexOf("board={"), source.indexOf("move={", source.indexOf("board={")));

  it("names what the opened board shows, and makes no claim about numbering", () => {
    expect(boardFoldSummary(39, 5)).toBe("Show 39 sets on 5 stages");
    expect(boardFoldSummary(1, 1)).toBe("Show 1 set on 1 stage");
    expect(boardFoldSummary(39, 5)).not.toMatch(/number|rank|clash/i);
    // The interactive board counts the set tiles it draws and the festival's stages.
    expect(boardSection).toContain("summary={boardFoldSummary(views.length, festival.stages.length)}");
  });

  it("is closed in the server's frame too, a 44 px control in the 10 px button shape with the chevron", () => {
    const preset = parsePreset(rawTinyPreset());
    const html = renderToStaticMarkup(
      createElement(ClashControlFallback, { intro: createElement("h1", { id: "pitch-heading" }, "Pitch"), summary: summarize(preset) }),
    );
    const fold = /<details data-board-fold=""[^>]*>/.exec(html)?.[0] ?? "";
    expect(fold).not.toBe("");
    expect(fold).not.toMatch(/\bopen\b/);
    const summary = /<details data-board-fold=""[^>]*><summary class="([^"]*)">([\s\S]*?)<\/summary>/.exec(html);
    expect(summary?.[2].replace(/<[^>]+>/g, "").trim()).toBe("Show 3 sets on 2 stages");
    expect(summary?.[1].split(" ")).toEqual(expect.arrayContaining(["min-h-11", "rounded-md", "border", "cursor-pointer"]));
    expect(summary?.[2]).toContain("<svg");
    expect(html.match(/data-board-fold=""/g)).toHaveLength(1);
  });

  it("holds the board itself, and nothing else of the section: the scroll hint, the grid's scroller and the phone's start-order list", () => {
    const fold = boardSection.slice(boardSection.indexOf("<BoardFold"), boardSection.indexOf("</BoardFold>"));
    expect(fold).toContain("Scroll sideways to see every stage.");
    expect(fold).toContain("<TimetableGrid");
    expect(fold).toContain("<TimetableList");
    // The header, the day control, coverage with its legend and caption, the phone's lock line and key, and the
    // rail (the score and the costliest clashes) stay open, before it.
    const before = boardSection.slice(0, boardSection.indexOf("<BoardFold"));
    for (const open of ['id="board-heading"', "<SegmentedControl", "<CoverageMeter", "<TimetableLegend", "<LockKey", "<Scorecard", "<ClashList", "data-board-caption"]) {
      expect(before).toContain(open);
      expect(fold).not.toContain(open);
    }
  });

  it("says, with no click, which lines the board draws and how its numbers differ from the drawing's lines", () => {
    expect(boardSection).toMatch(
      /<p data-board-caption=""[^>]*>\s*Lines join the \{links\.length\} costliest clashes\. Board numbers rank clash cost; drawing lines show taste overlap\.\s*<\/p>/,
    );
  });

  it("starts open from 1280 px or as the last fold was left, opens on a press and in the same render as the visitor's own preview, never in an effect, and never closes itself", () => {
    expect(boardSection).toContain("open={boardOpen}");
    expect(boardSection).toContain("onToggle={toggleBoard}");
    // The arrival state is read in the board's first render, by useState's initializer: the last fold's report, else
    // the width. Then only the visitor changes it.
    const latch = source.slice(source.indexOf("const wide = useWideBoard();"));
    expect(latch).toMatch(
      /^const wide = useWideBoard\(\);\s*const \[boardOpen, setBoardOpen\] = useState\(\(\) => boardStartsOpen\(foldReport, wide\)\);\s*const toggleBoard = useCallback\(\s*\(open: boolean\) => \{\s*setBoardOpen\(open\);\s*onBoardToggle\?\.\(open\);\s*\},\s*\[onBoardToggle\],\s*\);\s*const preview = planPreview \?\? rulePreview;\s*const \[previewSeen, setPreviewSeen\] = useState<PlanPreview \| RulePreview \| null>\(null\);\s*if \(preview !== previewSeen\) \{\s*setPreviewSeen\(preview\);\s*if \(preview !== null\) setBoardOpen\(true\);\s*\}/,
    );
    // The old start (a plain boolean that was always false on arrival) is gone.
    expect(source).not.toContain("useState(boardOpenAtStart)");
    // Nothing else sets it, so it never closes on its own: the latch only opens, the press for a set's places in Try a
    // move only opens, and the one other setter passes on the disclosure's own toggle (a press, or
    // the browser's report of the open state the board was drawn in, which sets what it already holds), wired nowhere
    // but its `onToggle`.
    expect(source.match(/setBoardOpen\(/g)).toHaveLength(3);
    expect(source.match(/setBoardOpen\((?!true\)|open\))/g)).toBeNull();
    expect(source.match(/setBoardOpen\(open\)/g)).toHaveLength(1);
    expect(source.match(/\btoggleBoard\b/g)).toHaveLength(2);
    expect(source).not.toMatch(/useEffect\([^;]*setBoardOpen/);
    // The hand-over between folds only ever opens one.
    const carry = source.slice(source.indexOf("export function carryBoardFold("), source.indexOf("function BoardFold("));
    expect(carry).not.toBe("");
    expect(carry).not.toMatch(/onToggle\??\.?\((?!true\))/);
  });

  it("opens where it is pressed: what is drawn after the board but sits before it in the source is never the scroll anchor", () => {
    // Below 1280 px the score is drawn after the board (order-3), and below 768 px so is the list (order-2), though
    // both come before it in the source; out of anchor selection there, a press opens the board under its summary.
    expect(boardSection).toMatch(/<Scorecard className="order-3 [^"]*max-xl:\[overflow-anchor:none\][^"]*xl:order-1/);
    expect(boardSection).toMatch(/<div className="order-2 min-w-0 max-md:\[overflow-anchor:none\] md:order-1 xl:order-2">\s*<ClashList/);
    // Only there: the board's own column and the fold stay eligible, so the summary can anchor itself.
    expect(boardSection.match(/overflow-anchor:none/g)).toHaveLength(2);
    expect(boardSection.indexOf("max-xl:[overflow-anchor:none]")).toBeLessThan(boardSection.indexOf("<BoardFold"));
  });

  it("keeps Try a move where the visitor is when a tested place opens the fold above it, and never opens or closes the fold to do so", () => {
    expect(source).toContain("onPlanChange={changePlan}");
    expect(source).not.toContain("onPlanChange={setPlanPreview}");
    const change = source.slice(source.indexOf("const holdPlace = useCallback("), source.indexOf("// A press for a set's places in Try a"));
    expect(change).not.toBe("");
    const all = source.slice(source.indexOf("const holdPlace = useCallback("), source.indexOf("// The decision card's buttons"));
    // A place is noted only for a new plan, with the fold still closed and the section on screen or above it; the
    // board's section leaves anchor selection for that commit and gets its own value back in the same layout effect.
    expect(change).toMatch(/const fresh = plan !== lastPlan\.current;/);
    expect(change).toMatch(/if \(fresh\) holdPlace\(plan !== null\);/);
    expect(change).toMatch(/opening && fold !== null && !fold\.open && top !== undefined && top < window\.innerHeight/);
    expect(change).toMatch(/board\.style\.overflowAnchor = "none";/);
    expect(all).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*placeHold\.current = null;[\s\S]*hold\.board\.style\.overflowAnchor = "";\s*\}\);/);
    // The fallback scroll is instant and only where the section really moved; nothing here touches the fold's state.
    expect(all).toMatch(/Math\.abs\(top - hold\.top\) > 0\.5\) window\.scrollBy\(\{ top: top - hold\.top, behavior: "instant" \}\)/);
    expect(change).not.toMatch(/setBoardOpen|toggleBoard|\.open = /);
  });

  it("opens the fold in the press for a set's places, holding Try a move where it is, so a late answer opens nothing above it", () => {
    expect(source).toContain("onPick={pickPress}");
    const press = source.slice(source.indexOf("const pickPress = useCallback("), source.indexOf("useLayoutEffect(() => {", source.indexOf("const pickPress = useCallback(")));
    expect(press).toMatch(/^const pickPress = useCallback\(\(\) => \{\s*holdPlace\(true\);\s*setBoardOpen\(true\);\s*setPlaceComing\(true\);\s*\}, \[holdPlace\]\);/);
    // The inline key lists the tested slot from the press, and drops the "coming" mark only once a tested place shows.
    expect(boardSection).toContain("planShown={planShown || placeComing}");
    expect(source).toMatch(/if \(fresh && plan !== null\) setPlaceComing\(false\);/);
    expect(source.match(/setPlaceComing\(/g)).toHaveLength(2);
  });
});

/** A stand-in for `window.matchMedia` on a screen `width` px wide: answers `(min-width: Nrem)` at 16 px a rem. */
function screenOf(width: number) {
  const asked: string[] = [];
  const listened: string[] = [];
  const matchMedia = (query: string) => {
    asked.push(query);
    const rem = /^\(min-width: ([\d.]+)rem\)$/.exec(query);
    return {
      matches: rem !== null && width >= Number(rem[1]) * 16,
      media: query,
      addEventListener: (type: string) => listened.push(`${query} ${type}`),
      removeEventListener: () => {},
      addListener: () => listened.push(`${query} change`),
      removeListener: () => {},
    };
  };
  return { window: { matchMedia, addEventListener: (type: string) => listened.push(`window ${type}`), removeEventListener: () => {} }, asked, listened };
}

describe("the board's fold on arrival: open from 1280 px, closed below", () => {
  const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
  const view = source.slice(source.indexOf("function PresetView("), source.indexOf("<ClashDrawer"));

  it("reads the width from Tailwind's xl media query, (min-width: 80rem), in the browser only", () => {
    expect(WIDE_BOARD_QUERY).toBe("(min-width: 80rem)");
    for (const [width, wide] of [
      [1440, true],
      [1280, true],
      [1279, false],
      [1024, false],
      [390, false],
    ] as const) {
      const screen = screenOf(width);
      vi.stubGlobal("window", screen.window);
      try {
        expect(readWideBoard(), `${width} px`).toBe(wide);
        expect(screen.asked).toEqual(["(min-width: 80rem)"]);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it("is never wide in the server's render, whatever the screen: its snapshot is false", () => {
    const screen = screenOf(1440);
    vi.stubGlobal("window", screen.window);
    try {
      const Probe = () => createElement("i", null, String(useWideBoard()));
      expect(renderToStaticMarkup(createElement(Probe))).toBe("<i>false</i>");
      // The server's render asks the screen nothing.
      expect(screen.asked).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
    const hook = source.slice(source.indexOf("export function useWideBoard("), source.indexOf("}", source.indexOf("export function useWideBoard(")) + 1);
    expect(hook).toMatch(/return useSyncExternalStore\(\s*subscribeNothing,\s*readWideBoard,\s*\(\) => false,\s*\);/);
  });

  it("starts from what the last fold reported, which wins over the width, else open from 1280 px and closed below", () => {
    // A report wins: a board the visitor closed stays closed on a wide screen, and one left open stays open on a narrow one.
    expect(boardStartsOpen(false, true)).toBe(false);
    expect(boardStartsOpen(true, false)).toBe(true);
    expect(boardStartsOpen(true, true)).toBe(true);
    expect(boardStartsOpen(false, false)).toBe(false);
    // No report yet: the width decides.
    expect(boardStartsOpen(null, true)).toBe(true);
    expect(boardStartsOpen(null, false)).toBe(false);
    // The page hands each board the last report, null before any fold has made one.
    expect(view).toMatch(/foldReport = null,/);
    expect(view).toMatch(/foldReport\?: boolean \| null;/);
  });

  it("latches the arrival state per board mount: a later width change, or a later report, opens or closes nothing", () => {
    // Nothing listens for a width change: the subscription adds no listener anywhere.
    const screen = screenOf(1440);
    vi.stubGlobal("window", screen.window);
    try {
      // React hands the subscription a callback; this one takes none, so no width change can ever reach the board.
      expect(subscribeNothing.length).toBe(0);
      const unsubscribe = subscribeNothing();
      expect(screen.listened).toEqual([]);
      expect(screen.asked).toEqual([]);
      unsubscribe();
    } finally {
      vi.unstubAllGlobals();
    }
    // The width and the report are read in the board's first render only, by useState's initializer, and nowhere else
    // in the view: no render, effect or handler after it reads either again.
    expect(view.match(/\bwide\b/g)).toHaveLength(2);
    expect(view.match(/\bfoldReport\b/g)).toHaveLength(3);
    expect(view).toContain("const [boardOpen, setBoardOpen] = useState(() => boardStartsOpen(foldReport, wide));");
    expect(view).not.toMatch(/useEffect\([^;]*\b(wide|foldReport|setBoardOpen)\b/);
    // The media query is read in one place only.
    expect(source.match(/matchMedia\(/g)).toHaveLength(1);
    expect(source).toContain("window.matchMedia(WIDE_BOARD_QUERY).matches");
  });

  it("draws the arrival open in the fold's first style, so the chevron's 160 ms turn never plays on arrival", () => {
    // The interactive board's <details> is created with `open` from its first render (a new element when the view
    // mounts), so the chevron is turned in its first style and its transition, kept for a press, has nothing to run.
    const fold = source.slice(source.indexOf("function BoardFold("), source.indexOf("type JumpLink"));
    expect(fold).toContain("open={takeOver ? open : openOnPage || undefined}");
    expect(fold).toMatch(/group-open\/board:rotate-180 motion-safe:transition-transform motion-safe:duration-\[160ms\]/);
    // The browser reports the open state it was drawn in through the same onToggle a press uses, so the next festival
    // day starts as this one was left.
    expect(fold).toContain("onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}");
    // The comments say the new rule, not the old one.
    expect(source).not.toMatch(/closed on arrival/i);
  });
});

/** A stand-in for the fold's `<details>`: its open state, its summary's focus and the page's focused element. */
function foldStandIn(open: boolean) {
  const page = { activeElement: null as unknown };
  const focused: (FocusOptions | undefined)[] = [];
  const summary = {
    focus(options?: FocusOptions) {
      focused.push(options);
      page.activeElement = summary;
    },
  };
  const node = { open, ownerDocument: page as unknown as Document, querySelector: (selector: "summary") => (selector === "summary" ? summary : null) };
  return { node, summary, focused, page };
}

describe("a press on the board's fold is never undone when the page swaps folds", () => {
  const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");

  it("reports a press made on the server's frame before the page was interactive, once the page takes the frame over", () => {
    const carrier: { current: BoardFoldCarry | null } = { current: null };
    const reported: boolean[] = [];
    // The visitor opened the server's fold while React had not seen it yet.
    const pressed = foldStandIn(true);
    carryBoardFold(pressed.node, carrier, { onToggle: (open) => reported.push(open), takeOver: false });
    expect(reported).toEqual([true]);
    expect(pressed.node.open).toBe(true);
    // An untouched fold reports nothing.
    const untouched = foldStandIn(false);
    carryBoardFold(untouched.node, carrier, { onToggle: (open) => reported.push(open), takeOver: false });
    expect(reported).toEqual([true]);
  });

  it("hands the server's frame's open fold and its focused summary to the interactive board, before the browser paints", () => {
    const carrier: { current: BoardFoldCarry | null } = { current: null };
    const server = foldStandIn(false);
    const leave = carryBoardFold(server.node, carrier, { takeOver: false });
    // A press: the fold opens and its summary takes focus. Then the interactive board replaces it.
    server.node.open = true;
    server.page.activeElement = server.summary;
    leave();
    expect(carrier.current).toEqual({ open: true, focused: true });

    const board = foldStandIn(false);
    const opened: boolean[] = [];
    carryBoardFold(board.node, carrier, { onToggle: (open) => opened.push(open), takeOver: true });
    expect(board.node.open).toBe(true);
    expect(opened).toEqual([true]);
    expect(board.focused).toEqual([{ preventScroll: true }]);
    // Taken once: the carrier is empty again.
    expect(carrier.current).toBeNull();
  });

  it("leaves a board already drawn open as it is, still moving the focus over", () => {
    const carrier: { current: BoardFoldCarry | null } = { current: { open: true, focused: true } };
    const board = foldStandIn(true);
    const opened: boolean[] = [];
    carryBoardFold(board.node, carrier, { onToggle: (open) => opened.push(open), takeOver: true });
    expect(opened).toEqual([]);
    expect(board.node.open).toBe(true);
    expect(board.focused).toHaveLength(1);
  });

  it("never opens a board nobody pressed, never closes one, and the server's frame takes nothing over", () => {
    const opened: boolean[] = [];
    const onToggle = (open: boolean) => opened.push(open);
    // The server's frame left closed and unfocused: the board stays closed, focus stays where it is.
    const closedCarrier: { current: BoardFoldCarry | null } = { current: { open: false, focused: false } };
    const closed = foldStandIn(false);
    carryBoardFold(closed.node, closedCarrier, { onToggle, takeOver: true });
    expect(closed.node.open).toBe(false);
    expect(closed.focused).toEqual([]);
    // A closed carrier never shuts a board that is open.
    const shutCarrier: { current: BoardFoldCarry | null } = { current: { open: false, focused: false } };
    const open = foldStandIn(true);
    carryBoardFold(open.node, shutCarrier, { onToggle, takeOver: true });
    expect(open.node.open).toBe(true);
    // Nothing in the carrier: nothing happens.
    const empty = foldStandIn(false);
    carryBoardFold(empty.node, { current: null }, { onToggle, takeOver: true });
    expect(empty.node.open).toBe(false);
    // The server's frame does not take a carrier over; it only empties it.
    const stale: { current: BoardFoldCarry | null } = { current: { open: true, focused: true } };
    const server = foldStandIn(false);
    carryBoardFold(server.node, stale, { onToggle, takeOver: false });
    expect(server.node.open).toBe(false);
    expect(server.focused).toEqual([]);
    expect(stale.current).toBeNull();
    expect(opened).toEqual([]);
  });

  it("keeps one festival day's open board open on the next day's board", () => {
    const carrier: { current: BoardFoldCarry | null } = { current: null };
    const glastonbury = foldStandIn(true);
    const leave = carryBoardFold(glastonbury.node, carrier, { onToggle: () => {}, takeOver: true });
    leave();
    expect(carrier.current).toEqual({ open: true, focused: false });
    const riot = foldStandIn(false);
    carryBoardFold(riot.node, carrier, { onToggle: () => {}, takeOver: true });
    expect(riot.node.open).toBe(true);
    expect(riot.focused).toEqual([]);
  });

  it("wires one carrier and one reported state through the server's frame, the interactive board and every festival day", () => {
    const control = source.slice(source.indexOf("export function ClashControl("), source.indexOf("/** The festival-day tabs' group name"));
    // No report before a fold has made one: the first board then starts from the width.
    expect(control).toContain("const [foldReport, setFoldReport] = useState<boolean | null>(null);");
    expect(control).not.toMatch(/useState\(false\)/);
    expect(control).toContain("const foldCarryRef = useRef<BoardFoldCarry | null>(null);");
    // The server's frame reports its fold; each festival day's board starts in the reported state and reports back.
    // Both pass React's own state setter, which never changes, so the fold's ref callback runs once per fold.
    const loading = control.slice(control.indexOf("<LoadingView"), control.indexOf("/>", control.indexOf("<LoadingView")));
    expect(loading).toContain("onFoldToggle={setFoldReport}");
    expect(loading).toContain("foldCarryRef={foldCarryRef}");
    const view = control.slice(control.indexOf("<PresetView"));
    for (const prop of ["foldReport={foldReport}", "onBoardToggle={setFoldReport}", "foldCarryRef={foldCarryRef}"]) expect(view).toContain(prop);
    // The server's fold is never controlled (a press before the page is interactive stays), and only reports.
    const frame = source.slice(source.indexOf("function LoadingView("), source.indexOf("export function ClashControlFallback("));
    expect(frame).toMatch(
      /<BoardFold\s+summary=\{boardFoldSummary\(model\.sets\.length, model\.stages\.length\)\}\s+onToggle=\{onFoldToggle\}\s+carryRef=\{foldCarryRef\}\s+inert=\{foldInert\}\s+className="mt-8"\s*>/,
    );
    // The interactive board takes the carrier over.
    const boardSection = source.slice(source.indexOf("board={"), source.indexOf("move={", source.indexOf("board={")));
    expect(boardSection).toContain("carryRef={foldCarryRef}");
    // The fold's ref runs the hand-over; an uncontrolled fold does not report a press as a hydration mismatch.
    const fold = source.slice(source.indexOf("function BoardFold("), source.indexOf("type JumpLink"));
    expect(fold).toContain("const takeOver = open !== undefined;");
    expect(fold).toContain("carryBoardFold(node, carryRef, { onToggle, takeOver })");
    expect(fold).toContain("ref={carry}");
    expect(fold).toContain("suppressHydrationWarning={!takeOver}");
    // The server's frame drawn anew over the server's HTML opens if the copy it replaces was open: read from the page
    // once, for the reporting fold only, never for the page's own board.
    expect(fold).toContain("const [openOnPage] = useState(() => !takeOver && carryRef !== undefined && foldOpenOnPage());");
    expect(fold).toContain("open={takeOver ? open : openOnPage || undefined}");
    expect(source).toMatch(/function foldOpenOnPage\(\): boolean \{\s*return typeof document !== "undefined" && document\.querySelector<HTMLDetailsElement>\("details\[data-board-fold\]"\)\?\.open === true;\s*\}/);
  });

  it("gives the loading fallback's copy, which the streamed page swaps out before any script runs, no press to lose", () => {
    const preset = parsePreset(rawTinyPreset());
    const html = renderToStaticMarkup(
      createElement(ClashControlFallback, { intro: createElement("h1", { id: "pitch-heading" }, "Pitch"), summary: summarize(preset) }),
    );
    const fold = /<details data-board-fold=""[^>]*>/.exec(html)?.[0] ?? "";
    expect(fold).toMatch(/\binert=""/);
    expect(fold).not.toMatch(/\bopen\b/);
    // Only the fallback: ClashControl's own frame, which React takes over, stays pressable.
    const fallback = source.slice(source.indexOf("export function ClashControlFallback("), source.indexOf("/** False in the server HTML"));
    expect(fallback).toContain("foldInert");
    const control = source.slice(source.indexOf("export function ClashControl("), source.indexOf("/** The festival-day tabs' group name"));
    expect(control).not.toContain("foldInert");
  });
});

describe("a visitor who scrolls on the server's frame keeps their place when the page replaces it", () => {
  const source = readFileSync(join(__dirname, "clash-control.tsx"), "utf8");
  // A 1440 x 900 screen, scrolled on the frame (the hero, then the board; 1,504 px tall with the footer held back).
  const view = { innerHeight: 900, scrollY: 604, scrollHeight: 1504 };
  const off = { top: 1200, bottom: 1404 };

  it("keeps nothing when the visitor has not scrolled, or mostly sees the hero, which both draw in one place", () => {
    expect(pagePlace({ ...view, scrollY: 0 }, { fold: { top: 776, bottom: 820 }, board: { top: 260, bottom: 900 }, footer: null })).toBeNull();
    // The board's top below the middle of the screen: the hero fills the upper half or more.
    expect(pagePlace({ ...view, scrollY: 120 }, { fold: { top: 1100, bottom: 1144 }, board: { top: 451, bottom: 1300 }, footer: off })).toBeNull();
  });

  it("keeps the board's summary on its line of the screen when it is on screen, even in part, before anything else", () => {
    expect(pagePlace(view, { fold: { top: 776, bottom: 820 }, board: { top: 227, bottom: 900 }, footer: null })).toEqual({ anchor: "fold", top: 776 });
    expect(pagePlace(view, { fold: { top: -20, bottom: 24 }, board: { top: -600, bottom: 120 }, footer: null })).toEqual({ anchor: "fold", top: -20 });
    expect(pagePlace(view, { fold: { top: 820, bottom: 864 }, board: { top: 300, bottom: 1000 }, footer: { top: 860, bottom: 900 } })).toEqual({
      anchor: "fold",
      top: 820,
    });
  });

  it("keeps the page's end when the footer is on screen and the summary is not, and the board when it fills the lower half", () => {
    expect(
      pagePlace({ ...view, scrollHeight: 1708 }, { fold: { top: -300, bottom: -256 }, board: { top: -900, bottom: 500 }, footer: { top: 696, bottom: 900 } }),
    ).toEqual({ anchor: "end", fromEnd: 1708 - 604 });
    expect(pagePlace(view, { fold: { top: 950, bottom: 994 }, board: { top: 449, bottom: 1100 }, footer: off })).toEqual({ anchor: "board", top: 449 });
    // Scrolled into the board with its summary still below the screen: the board's own top, above the screen.
    expect(pagePlace({ ...view, innerHeight: 400 }, { fold: { top: 450, bottom: 494 }, board: { top: -300, bottom: 600 }, footer: off })).toEqual({
      anchor: "board",
      top: -300,
    });
  });

  it("puts the kept summary or board top back on the same line, within the page's ends", () => {
    // The page draws three sections before the board, so its summary is further down the page.
    const page = { innerHeight: 900, scrollY: 604, scrollHeight: 5867 };
    const fold: PagePlace = { anchor: "fold", top: 776 };
    expect(pagePlaceTarget(fold, page, { fold: { top: 3076, bottom: 3120 }, board: { top: 2500, bottom: 3300 } })).toBe(604 + 3076 - 776);
    const board: PagePlace = { anchor: "board", top: -300 };
    expect(pagePlaceTarget(board, page, { fold: null, board: { top: 2000, bottom: 3200 } })).toBe(604 + 2000 + 300);
    // Never past either end of the page.
    expect(pagePlaceTarget(fold, page, { fold: { top: 9000, bottom: 9044 }, board: null })).toBe(5867 - 900);
    expect(pagePlaceTarget(fold, { ...page, scrollY: 0 }, { fold: { top: 100, bottom: 144 }, board: null })).toBe(0);
    // Nothing to keep on a page that draws no such box.
    expect(pagePlaceTarget(fold, page, { fold: null, board: { top: 2000, bottom: 3200 } })).toBeNull();
  });

  it("never puts the summary under the section nav where it sticks, while the board's top keeps its line", () => {
    const page = { innerHeight: 900, scrollY: 0, scrollHeight: 5867 };
    expect(pagePlaceTarget({ anchor: "fold", top: 80 }, page, { fold: { top: 3000, bottom: 3044 }, board: null }, 108)).toBe(3000 - 108);
    expect(pagePlaceTarget({ anchor: "fold", top: 400 }, page, { fold: { top: 3000, bottom: 3044 }, board: null }, 108)).toBe(3000 - 400);
    expect(pagePlaceTarget({ anchor: "board", top: 40 }, page, { fold: null, board: { top: 3000, bottom: 4000 } }, 108)).toBe(3000 - 40);
  });

  it("keeps the same distance from the page's end", () => {
    const page = { innerHeight: 900, scrollY: 0, scrollHeight: 5867 };
    expect(pagePlaceTarget({ anchor: "end", fromEnd: 1104 }, page, { fold: null, board: null })).toBe(5867 - 1104);
    expect(pagePlaceTarget({ anchor: "end", fromEnd: 600 }, page, { fold: null, board: null })).toBe(5867 - 900);
  });

  it("reads the place on the frame as it leaves, while it is still whole, and keeps it on the page in the same commit, before paint", () => {
    const frame = source.slice(source.indexOf("function LoadingView("), source.indexOf("export function ClashControlFallback("));
    // The frame's own layout effect: emptied when the frame is drawn, filled in its cleanup (React runs it before it
    // takes any of the frame's nodes off the page), and emptied again once that commit is over.
    expect(frame).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(!placeRef\) return;\s*placeRef\.current = null;\s*return \(\) => \{\s*placeRef\.current = readPagePlace\(\);\s*queueMicrotask\(\(\) => \{\s*placeRef\.current = null;\s*\}\);\s*\};\s*\}, \[placeRef\]\);/,
    );
    const control = source.slice(source.indexOf("export function ClashControl("), source.indexOf("/** The festival-day tabs' group name"));
    expect(control).toContain("const pagePlaceRef = useRef<PagePlace | null>(null);");
    // After every child's layout effect (the fold carried open first), with no dependency list: it runs in the commit
    // that swaps the frame for the page.
    expect(control).toMatch(
      /useLayoutEffect\(\(\) => \{\s*const place = pagePlaceRef\.current;\s*if \(place === null\) return;\s*pagePlaceRef\.current = null;\s*keepPagePlace\(place\);\s*\}\);/,
    );
    const loading = control.slice(control.indexOf("<LoadingView"), control.indexOf("/>", control.indexOf("<LoadingView")));
    expect(loading).toContain("placeRef={pagePlaceRef}");
    // Only ClashControl's own frame records: the loading fallback is swapped for that frame by the streamed page itself.
    const fallback = source.slice(source.indexOf("export function ClashControlFallback("), source.indexOf("/** False in the server HTML"));
    expect(fallback).not.toContain("placeRef");
    expect(control.slice(control.indexOf("<PresetView"))).not.toContain("placeRef");
    // One instant scroll, only where the place really moved: no motion.
    const keep = source.slice(source.indexOf("function keepPagePlace("), source.indexOf("function BoardFold("));
    expect(keep).toContain('window.scrollTo({ top: target, behavior: "instant" })');
    expect(keep).toContain("Math.abs(target - window.scrollY) > 0.5");
    expect(keep.match(/scroll(To|By)\(/g)).toHaveLength(1);
    // The frame's board and the page's board are found the same way.
    expect(source).toMatch(/<section aria-label=\{label\} aria-labelledby=\{labelledBy\} data-board-frame="">/);
    expect(source.match(/<BoardFrame /g)).toHaveLength(2);
  });

  it("holds the site's footer back under the frame while scripts run, and takes no room itself", () => {
    const preset = parsePreset(rawTinyPreset());
    const html = renderToStaticMarkup(
      createElement(ClashControlFallback, { intro: createElement("h1", { id: "pitch-heading" }, "Pitch"), summary: summarize(preset) }),
    );
    expect(html).toMatch(/<section aria-label="Timetable" data-board-frame="">/);
    const end = /<div hidden="" data-frame-end="" class="([^"]*)"><\/div>/.exec(html);
    expect(end?.[1]).toBe("[@media(scripting:enabled)]:[main:has(&amp;)~footer]:hidden");
    // After the frame's board, as its last node.
    expect(html.indexOf("data-frame-end")).toBeGreaterThan(html.indexOf("data-board-fold"));
    expect(html.slice(html.indexOf("data-frame-end"))).not.toMatch(/<section|<details/);
    // The page itself has no such marker, so the footer shows as soon as the page replaces the frame.
    expect(source.slice(source.indexOf("function PresetView("))).not.toContain("data-frame-end");
    expect(source.match(/data-frame-end/g)).toHaveLength(1);
  });
});
