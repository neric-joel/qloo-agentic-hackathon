import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FIGURE_DOMAIN } from "@/components/clash/why-this-matters";
import { CONTROL_ACTS, CONTROL_RANK_LIMIT } from "@/lib/control-acts";
import { LOCK_RULE } from "@/lib/locks";
import { METHOD_FIGURES, methodRow } from "@/lib/method-figures";

import MethodPage from "./page";

/** Visible text of a slice of markup, tags dropped and spacing collapsed. */
const text = (part: string) =>
  part
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&rsquo;|’/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The chain's steps on /method (round 37, L59), each as its text, the agent's branch left out. */
const CHAIN = [
  "act names Your timetable",
  "entity IDs Qloo /search",
  "each act's ranked row of the bill Qloo /v2/insights",
  "percentile ranks and taste overlap This app",
  "pair score and Clash Budget Index This app",
  "legal moves under the day's rules The engine",
  "Keep this move You Nothing moves until the acts' teams agree.",
];

/** The agent's branch off the engine, as its text. */
const BRANCH = "On request: the agent explains a clash with one /v2/analysis/compare and tests moves through the same engine.";

/** The top-level items of the chain's ordered list, each with its markup (a nested list stays inside its item). */
function topLevelSteps(flow: string): string[] {
  const steps: string[] = [];
  // Lists open and close around items; an item of the outer list starts and ends at list depth 1.
  let depth = 0;
  let start = -1;
  for (const m of flow.matchAll(/<(\/?)(li|ul|ol)\b[^>]*>/g)) {
    const closing = m[1] === "/";
    const list = m[2] !== "li";
    if (list) depth += closing ? -1 : 1;
    else if (depth === 1 && !closing) start = m.index!;
    else if (depth === 1 && closing) {
      steps.push(flow.slice(start, m.index! + m[0].length));
      start = -1;
    }
  }
  return steps;
}

describe("the failed bar (M11)", () => {
  it("draws taste overlap's share short of the written-down bar, from the method figures, final in the server HTML", () => {
    const html = renderToStaticMarkup(createElement(MethodPage));
    const reached = methodRow("taste").topQuarterPct;
    const bar = METHOD_FIGURES.backtest.bar.topQuarterPct;
    expect(reached).toBeLessThan(bar);
    expect(html).toContain(`aria-label="Taste overlap reached ${reached.toFixed(1)}%; the bar was ${bar}%"`);
    // One 0 to 75 axis (FIGURE_DOMAIN, ticks 0 / 25 / 50 / 75), shared with the home figure: taste overlap's bar ends
    // at 46.8 / 75 of the plot, popularity's at 57.8 / 75, and the pre-set bar is a 1.5px SOLID ink line at 60 / 75
    // spanning the bars (dashed means tested), labelled at its top.
    expect(FIGURE_DOMAIN).toBe(75);
    const at = (pct: number) => `${Math.round((pct / FIGURE_DOMAIN) * 100000) / 1000}%`;
    // Round 34 (one radius system): each bar has the same 6px mark corner at both ends (rounded-bar, clamped to half
    // the height on a thin baseline). Taste overlap and popularity are the same solid ink bar, so popularity's longer
    // bar shows it did better; genre tags and random are 6px muted baselines; no bar is raspberry.
    expect(html).toContain(`rounded-bar h-4 bg-foreground" style="width:${at(reached)}"`);
    expect(html).toContain(`rounded-bar h-4 bg-foreground" style="width:${at(methodRow("popularity").topQuarterPct)}"`);
    expect(html).toContain(`rounded-bar h-1.5 bg-muted-foreground" style="width:${at(methodRow("genre").topQuarterPct)}"`);
    expect(html).toContain(`rounded-bar h-1.5 bg-muted-foreground" style="width:${at(methodRow("random").topQuarterPct)}"`);
    expect(html).not.toMatch(/rounded-bar[^"]*(bg-card|border-foreground|ink-3)/);
    // The chart is set at the prose's measure and in the prose's font size, so 76ch resolves in the same metrics as
    // the sentences under it.
    expect(html).toContain(
      '<div class="mt-3 min-w-0 max-w-[76ch] text-[0.9375rem] sm:text-base"><div class="@container relative" style="--bars-label:',
    );
    expect(html).toMatch(/<ul class="mt-5 max-w-\[76ch\] text-\[0\.9375rem\] leading-\[1\.55\] sm:text-base">/);
    expect(html).not.toContain("border-radius:0 2px 2px 0");
    expect(html).toContain(`border-solid border-foreground" style="left:${at(bar)}"`);
    const chart = html.slice(html.indexOf("<figure"), html.indexOf("</figure>"));
    expect(chart).not.toMatch(/bg-primary|text-primary|border-dashed/);
    // The sentences that say taste overlap missed the bar and popularity did better follow the figure directly.
    const after = html.slice(html.indexOf("</figure>"));
    expect(after.startsWith("</figure><ul")).toBe(true);
    const next = text(after.slice(0, after.indexOf("</ul>")));
    expect(next.indexOf("The test we set before building failed.")).toBe(0);
    expect(next).toContain("The bar we wrote down before building was 60");
    expect(next).toContain("It missed the bar. Popularity did better:");
    expect(html).toMatch(new RegExp(`Bar we set: <span class="font-mono tabular-nums">${bar}(<!-- -->)?%</span>`));
    // Each value sits beside its own bar, not in a far-right column.
    expect(html.match(/<span data-bar-value="true"/g)).toHaveLength(4);
    // In ink, outside the bar: never the paper colour on a fill.
    const figure = html.slice(html.indexOf("<figure"), html.indexOf("</figure>"));
    expect(figure).not.toContain("text-background");
    expect(figure).toMatch(/data-label-place="past" class="[^"]*text-foreground[^"]*">57\.8%/);
    expect(html).not.toContain("data-reveal");
  });
});

describe("the reading column and its folds (round 10)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const text = (part: string) =>
    part
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&#39;|&rsquo;|’/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  /** What a reader sees with no click: the page with every closed disclosure taken out. */
  const visible = text(html.replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/g, " "));
  const summaries = [...html.matchAll(/<details(?![^>]*\bopen\b)[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => text(m[1]));
  const { backtest, complaints } = METHOD_FIGURES;

  it("keeps the no-attendance limit and the sample size visible", () => {
    expect(visible).toContain("It is not attendance, and this app estimates no attendance or money figure anywhere.");
    expect(visible).toContain("It is not a share of fans and not attendance.");
    expect(visible).toContain(
      `${backtest.scoredPairs} complained-about pairs from ${backtest.clusters} complaints (one complaint can name more than two acts), across ${backtest.festivalDays} festival days.`,
    );
    expect(visible).toContain("The bar we wrote down before building was 60% and 10 points ahead.");
    expect(visible).toContain("It missed the bar.");
  });

  it("folds only the unscored and out-of-scope accounting, under a summary with the figures' own counts", () => {
    expect(summaries).toContain(`Why ${backtest.scoredPairs} of ${complaints.pairsVerified} verified pairs were scored`);
    expect(visible).not.toContain("Sixteen more could not be scored");
    expect(text(html)).toContain("Sixteen more could not be scored");
  });

  it("folds the exploratory follow-up under a summary that names it, with the line it did not establish an advantage left visible", () => {
    expect(summaries).toContain("Exploratory follow-up, run after the test failed");
    expect(visible).toContain("The exploratory follow-up did not establish an advantage over popularity.");
    expect(visible).not.toContain("What held");
    const line = visible.indexOf("The exploratory follow-up did not establish an advantage over popularity.");
    expect(line).toBeGreaterThan(visible.indexOf("It missed the bar."));
  });

  it("merges the small sections into one, keeping every id other pages link to and the labels list visible", () => {
    for (const id of ["price", "tested", "limits", "moving-sets", "labels", "live-check", "brief"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(visible).toContain("How the rest works");
    expect(visible).toContain("A saved Qloo response.");
    expect(visible).toContain("Calculated by this app from saved responses.");
    const rest = visible.slice(visible.indexOf("How the rest works"));
    for (const title of ["Moving sets", "Where each number comes from", "The live re-check", "The one-page brief", "Back to the timetable"]) {
      expect(rest).toContain(title);
    }
    // One contents nav on the page, named "On this page" and printed nowhere as visible text: the running order,
    // after the short version (so the failed test is stated before any section title) and before the first section,
    // at every width, as a wrapped sequence of plain links, not pills or a sticky rail. Not printed.
    expect(html.match(/<nav /g)).toHaveLength(1);
    expect(html.match(/On this page/g)).toHaveLength(1);
    expect(html).not.toContain("Page sections");
    const row = html.match(/<nav aria-label="On this page">[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(row).not.toBe("");
    expect(html.indexOf(row)).toBeGreaterThan(html.indexOf("The results do not establish an advantage over popularity."));
    expect(html.indexOf(row)).toBeLessThan(html.indexOf('id="price"'));
    expect(row).toContain("flex-wrap");
    expect(row).not.toMatch(/rounded|border|bg-|sticky/);
    for (const href of ["#price", "#tested", "#limits", "#the-rest"]) expect(row).toContain(`href="${href}"`);
    expect(html).toMatch(/<div class="mt-8 print:hidden"><nav aria-label="On this page">/);
    // Nothing is shown or hidden by width but the short version's verdict (round 27), which is xl only, and the
    // request flow's two places (round 28): the rail copy xl only, the body copy below xl. In that order.
    expect(html.match(/\bxl:(block|hidden)\b/g)).toEqual(["xl:block", "xl:block", "xl:hidden"]);
    expect(html).toMatch(/<div aria-hidden="true" data-short-verdict="true" class="[^"]*\bhidden xl:block\b/);
    expect(html).toMatch(/<div data-section-rail="true" class="[^"]*\bhidden xl:block\b[^"]*"><div data-flow-place="rail">/);
    expect(html).toMatch(/<div data-flow-place="body" class="xl:hidden print:block"><ol aria-label="From your timetable to the index"/);
  });
});

describe("the reading column's alignment and measure (round 10b)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));

  it("starts the column at the page container's left edge instead of centring it", () => {
    const columns = [...html.matchAll(/class="(max-w-\[52rem\][^"]*)"/g)].map((m) => m[1]);
    // The header and each of the four sections share the one column.
    expect(columns.length).toBe(5);
    for (const column of columns) expect(column).not.toMatch(/\bmx-auto\b/);
    expect(html).not.toMatch(/class="[^"]*\bmx-auto\b[^"]*max-w-\[52rem\]/);
    expect(html).not.toContain("max-w-[48rem]");
    // No sticky rail beside the column: nothing is positioned outside it or kept in view while the page scrolls.
    expect(html).not.toContain("52rem + 2.5rem");
    expect(html).not.toMatch(/\bsticky\b/);
    expect(html).not.toMatch(/class="absolute inset-y-0[^"]*\b(right-0|pr-6|pl-10)\b/);
    expect(html).toMatch(/^<article>/);
    // 20rem is the short version's verdict only (its opening line, its two meters and its scale note; round 37 fix
    // pass 1 took out the meter that drew the chart's taste bar again), never a rail beside the column.
    const verdictAt = html.indexOf('<div aria-hidden="true" data-short-verdict="true"');
    const verdictEnd = html.indexOf("</div></section>", verdictAt);
    expect(verdictAt).toBeGreaterThan(-1);
    expect(html.slice(verdictAt, verdictEnd).match(/max-w-\[20rem\]/g)).toHaveLength(4);
    expect(html.slice(0, verdictAt) + html.slice(verdictEnd)).not.toContain("max-w-[20rem]");
  });

  it("sets the running text to an explicit 72 to 80 character measure", () => {
    const measures = [...html.matchAll(/\bmax-w-\[(\d+)ch\]/g)].map((m) => Number(m[1]));
    expect(measures.length).toBeGreaterThan(0);
    for (const ch of measures) {
      expect(ch).toBeGreaterThanOrEqual(72);
      expect(ch).toBeLessThanOrEqual(80);
    }
    expect(html).not.toContain("max-w-prose space-y");
  });

  it("keeps the comparison table in a keyboard-focusable box that scrolls inside itself", () => {
    expect(html).toMatch(/<div role="region" aria-labelledby="backtest-caption" tabindex="0" class="[^"]*\boverflow-x-auto\b/);
  });
});

describe("Qloo requests (lane A; cards and the request flow, round 20)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const start = html.indexOf('id="qloo-calls"');
  const block = html.slice(start, html.indexOf('id="moving-sets"'));

  it("has the section and its anchor, right under the section heading with no rule of its own", () => {
    expect(html).toContain('id="qloo-calls"');
    expect(html).toContain(">Qloo requests</h3>");
    expect(html).not.toContain("Every Qloo call this product makes");
    expect(html).toMatch(/<div id="qloo-calls" class="scroll-mt-24 pt-8 first:pt-0">/);
    // Sub-blocks are set off by space: no rule above any of them.
    expect(html).not.toMatch(/<div id="[^"]*" class="scroll-mt-24 border-t/);
  });

  it("lists only endpoints the backend's Qloo client really calls, one card heading each", () => {
    const client = readFileSync(join(process.cwd(), "..", "backend", "app", "qloo", "client.py"), "utf-8");
    const listed = [...html.matchAll(/<h4 class="font-mono text-\[1\.0625rem\] leading-snug font-semibold[^"]*">(\/[^<]+)<\/h4>/g)].map((m) => m[1]);
    expect(listed).toEqual(["/search", "/v2/insights", "/v2/analysis/compare"]);
    for (const path of listed) expect(client).toContain(`"${path}"`);
  });

  it("draws the chain from request to decision before the endpoints as a typed column: seven mono tokens joined by arrows, the two Qloo returns in teal, the agent a branch off the engine (round 37, L59)", () => {
    const flow = block.match(/<ol aria-label="From your timetable to the index"[^>]*>[\s\S]*?<\/ol>/)?.[0] ?? "";
    // One column at every width (seven steps do not fit across), 8px between steps.
    expect(flow).toMatch(/^<ol aria-label="From your timetable to the index" class="my-6 grid gap-y-2">/);
    expect(flow).not.toMatch(/md:grid-cols|md:hidden|md:block/);
    expect(block.indexOf(flow)).toBeLessThan(block.indexOf("<h4"));
    // The steps in order: the list's own items, top level only (the branch is nested inside the engine's step).
    const steps = topLevelSteps(flow);
    expect(steps.map((step) => text(step.replace(/<ul data-flow-branch[\s\S]*?<\/ul>/, " ")))).toEqual(CHAIN);
    const order = ["/search", "/v2/insights", "The engine", "Keep this move"].map((needle) => steps.findIndex((s) => text(s).includes(needle)));
    expect(order).toEqual([1, 2, 5, 6]);
    // The agent's /v2/analysis/compare is on a branch inside the engine's step, never a step of its own and never
    // between the engine and the Keep.
    expect(steps.filter((step) => step.includes("/v2/analysis/compare"))).toHaveLength(1);
    const engine = steps[5];
    const branch = engine.match(/<ul data-flow-branch[^>]*>([\s\S]*?)<\/ul>/);
    expect(branch).not.toBeNull();
    expect(text(branch![1])).toBe(BRANCH);
    expect(text(steps[6])).not.toContain("compare");
    expect(text(steps[6])).toBe("Keep this move You Nothing moves until the acts' teams agree.");
    // The tokens: 14px mono, all ink (round 37, L59 LATE: teal only for Qloo's endpoints), the Keep semibold.
    const tokens = [...flow.matchAll(/<code data-flow-token="true" class="([^"]*)">([^<]+)<\/code>/g)].map((m) => [m[2], m[1]]);
    expect(tokens.map(([token]) => token.replace(/&#x27;|’/g, "'"))).toEqual([
      "act names",
      "entity IDs",
      "each act's ranked row of the bill",
      "percentile ranks and taste overlap",
      "pair score and Clash Budget Index",
      "legal moves under the day's rules",
      "Keep this move",
    ]);
    for (const [, cls] of tokens) expect(cls).toContain("font-mono text-sm");
    expect(tokens.map(([, cls]) => (cls.includes("text-prov-qloo") ? "qloo" : cls.includes("text-foreground") ? "ink" : "?"))).toEqual([
      "ink",
      "ink",
      "ink",
      "ink",
      "ink",
      "ink",
      "ink",
    ]);
    expect(tokens[6][1]).toContain("font-semibold");
    expect(tokens.slice(0, 6).every(([, cls]) => !cls.includes("font-semibold"))).toBe(true);
    // Teal only for Qloo's three endpoints, in mono: /search and /v2/insights on their steps, /v2/analysis/compare on
    // the branch; nothing else in the chain is teal.
    expect(branch![1]).toContain('<code class="font-mono text-prov-qloo">/v2/analysis/compare</code>');
    expect(flow.match(/text-prov-qloo/g)).toHaveLength(3);
    expect(flow.match(/<code class="font-mono text-prov-qloo">\/[^<]+<\/code>/g)).toEqual([
      '<code class="font-mono text-prov-qloo">/search</code>',
      '<code class="font-mono text-prov-qloo">/v2/insights</code>',
      '<code class="font-mono text-prov-qloo">/v2/analysis/compare</code>',
    ]);
    // Arrows: inline SVG in a 1.5px ink line with round caps: five 24px arrows down, the spine from the engine on to
    // the Keep (it runs the branch's height plus 24px) and the branch's own arrow off the spine.
    expect(flow.match(/<svg aria-hidden="true" data-flow-arrow="down" focusable="false" width="10" height="24" class="mt-2 block overflow-visible"/g)).toHaveLength(5);
    expect(flow.match(/data-flow-arrow="spine"/g)).toHaveLength(1);
    expect(flow.match(/data-flow-arrow="branch"/g)).toHaveLength(1);
    expect(engine).toContain('data-flow-arrow="spine"');
    expect(engine).toContain('data-flow-arrow="branch"');
    expect(flow).not.toContain('data-flow-arrow="across"');
    expect(flow.match(/<line [^>]*stroke="var\(--foreground\)" stroke-width="1.5" stroke-linecap="round"/g)).toHaveLength(7);
    expect(flow).not.toContain("var(--border-strong)");
    // No dots, circles, nodes, boxes or raspberry.
    expect(flow).not.toMatch(/<circle|rounded|class="[^"]*border|bg-card|var\(--primary\)|text-primary|bg-primary/);
    // The makers in 13px ink, Qloo's endpoints in teal mono on the same line, the Keep's note in 13px muted.
    expect(flow.match(/<p class="mt-1 text-\[0\.8125rem\] leading-snug text-foreground">/g)).toHaveLength(7);
    expect(flow).not.toMatch(/<code class="font-mono text-muted-foreground">/);
    expect(flow.match(/<p class="text-\[0\.8125rem\] leading-snug text-muted-foreground">/g)).toHaveLength(1);
    expect(flow).not.toContain("break-all");
    // Nothing focusable, and no motion.
    expect(flow).not.toMatch(/<a |<button|<input|<select|tabindex|<details|animate|transition/);
  });

  it("sets each endpoint on the page with no box, two columns from 1024px: the path in 17px teal mono, what we send as two-column rows where the endpoint is 24rem wide, what we get back", () => {
    expect(block).toMatch(/<ul aria-labelledby="qloo-calls-caption" class="grid gap-x-10 gap-y-10 lg:grid-cols-2">/);
    const cards = [...block.matchAll(/<li data-endpoint="true" class="([^"]*)">([\s\S]*?)<\/li>/g)];
    expect(cards).toHaveLength(3);
    for (const [, cls, card] of cards) {
      // Each endpoint is a size container, so its own width (never the viewport) decides its rows' columns.
      expect(cls).toBe("@container min-w-0");
      expect(text(card)).toMatch(/We send .* We get back /);
      expect(card).not.toMatch(/rounded|bg-card|tag /);
      // The endpoint heading is Qloo's, so teal on /method at all times (17px semibold mono), and wraps normally.
      expect(card).toMatch(/<h4 class="font-mono text-\[1\.0625rem\] leading-snug font-semibold text-prov-qloo">\//);
      // The parameters (round 29): from 24rem of the endpoint's own width, two columns, the key in a fixed 11rem
      // column and its meaning beside it, 16px apart, 8px between rows, one hairline above the group and one below and
      // none between rows. Narrower, key over meaning, each row closed by its hairline, as before.
      expect(card).toContain(
        '<dl aria-label="What we send" class="mt-1 border-t border-border @min-[24rem]:grid @min-[24rem]:gap-y-2 @min-[24rem]:border-b @min-[24rem]:py-2.5">',
      );
      const rows = card.match(/<div data-param="true" class="([^"]*)"><dt /g) ?? [];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toContain(
          'class="border-b border-border py-2.5 @min-[24rem]:grid @min-[24rem]:grid-cols-[11rem_minmax(0,1fr)] @min-[24rem]:items-baseline @min-[24rem]:gap-x-4 @min-[24rem]:border-b-0 @min-[24rem]:py-0"',
        );
      }
      // No viewport breakpoint decides the rows: only the container variant.
      expect(card.slice(card.indexOf("<dl"), card.indexOf("</dl>"))).not.toMatch(/\b(sm|md|lg|xl):/);
      expect(card).not.toContain("grid-cols-[40%");
      // The live line stays word for word as the muted last row. It opens with "Sent live by", so it labels itself:
      // no hidden "Sent live: " label before it, which a screen reader read as "Sent live: Sent live by ..." (round 36).
      expect(text(card)).toMatch(/ We get back [^]* Sent live (only )?by [^]*\.$/);
      const liveRow = card.slice(card.lastIndexOf("<p "));
      expect(liveRow).toMatch(/^<p class="pt-2 text-\[0\.8125rem\] leading-snug text-muted-foreground">Sent live (only )?by [^<]*\.<\/p>$/);
      expect(text(card)).not.toMatch(/Sent live:/);
      expect(card).not.toContain("sr-only");
    }
    for (const label of ["Match an act", "Rank affinity", "Shared tags"]) expect(block).toContain(label);
    // No table, no disclosure per card: the parameters are in the open.
    expect(block).not.toContain("<table");
    expect(block).not.toContain("<details");
    expect(block).not.toContain(">Parameters<");
    // One plain sentence before the technical details of each request.
    expect(block).toContain("To match an act, we ask Qloo for the artist by name.");
    expect(block).toContain("To rank affinity, we give Qloo one act and ask how strongly its audience leans toward the rest of the day&#x27;s bill.");
    expect(block).toContain("To find shared tags, we give Qloo two acts and ask what their audiences have in common.");
    expect(block.indexOf("To match an act")).toBeLessThan(block.indexOf('<dl aria-label="What we send"'));
    // The parameters are dt/dd pairs: the name in 13px ink mono on its own line, the description in 15px sans under
    // it, no chips or boxes; only the token itself (a URN, a number) is mono in the description.
    expect(block.match(/<dt class="min-w-0 font-mono text-\[0\.8125rem\] leading-snug text-foreground">/g)).toHaveLength(10);
    const dts = [...block.matchAll(/<dt class="min-w-0 font-mono text-\[0\.8125rem\][^"]*">([\s\S]*?)<\/dt>/g)].map((m) => m[1]);
    expect(dts.map((dt) => dt.replace(/<wbr\/?>/g, ""))).toEqual([
      "query", "types", "take",
      "filter.type", "signal.interests.entities", "filter.results.entities", "signal.location.query",
      "a.signal.interests.entities", "b.signal.interests.entities", "take",
    ]);
    // A dotted key breaks only after a dot: a <wbr> after every dot, no forced breaks inside words.
    for (const dt of dts) {
      const dots = (dt.match(/\./g) ?? []).length;
      expect((dt.match(/\.<wbr\/?>/g) ?? []).length).toBe(dots);
    }
    expect(dts.find((dt) => dt.startsWith("signal.<wbr"))).toMatch(/^signal\.<wbr\/?>interests\.<wbr\/?>entities$/);
    expect(block).not.toContain("break-all");
    expect(block).not.toContain("overflow-wrap:anywhere");
    expect(block).not.toContain("[overflow-wrap:anywhere]");
    expect(block.match(/<dd class="mt-1 min-w-0 text-\[0\.9375rem\] leading-snug @min-\[24rem\]:mt-0">/g)).toHaveLength(10);
    expect(block).toContain('<dd class="mt-1 min-w-0 text-[0.9375rem] leading-snug @min-[24rem]:mt-0"><code class="font-mono text-[0.8125rem]">urn:entity:artist</code></dd>');
    // Round 31: no saved day was ranked with a location, so the row says so.
    expect(block).toContain(
      "Not sent: both saved days were ranked without a location, so their taste overlap is a global reading, not a local one.",
    );
    expect(block).not.toContain("Sent when the festival has a city");
    expect(block).not.toContain("uppercase");
    expect(block).toContain("Sent live by the pair re-check (its third request)");
  });

  it("sets the helper text under the endpoints in the muted token, with no colour mix", () => {
    expect(block).not.toContain("color-mix");
    expect(block.match(/<p class="pt-2 text-\[0\.8125rem\] leading-snug text-muted-foreground">/g)).toHaveLength(3);
  });

  it("says once that every request was saved when the day was built, and gives each card only where it is also sent live", () => {
    expect(html.match(/saved when\s+the day was built/gi)).toHaveLength(1);
    expect(html).toContain("Each was saved when the day was built; each card says where it is also sent live.");
    expect(html).not.toContain("Saved; live in");
    expect(html).not.toContain("Saved when the day was built.");
    expect(html.match(/Sent live (only )?by /g)).toHaveLength(3);
  });

  it("says what each live path really sends: the clash agent asks Qloo only through compare, and /search's row claims no 'only' (round 36)", () => {
    // backend/app/agent/clash_tools.py: explain_clash is the clash agent's one Qloo request (/v2/analysis/compare);
    // the general explore tools are refused by backend/app/main.py unless allow_explore is switched on.
    const cards = [...block.matchAll(/<li data-endpoint="true" class="[^"]*">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    // Each card's last row read whole, hidden text included, so what a screen reader hears is exactly the visible row.
    const live = cards.map((card) => text(card.slice(card.lastIndexOf("<p "))));
    expect(live).toEqual([
      "Sent live by the pasted-grid score in live mode, where switched on.",
      "Sent live by the pair re-check (two of its three requests) and the pasted-grid score in live mode, where switched on.",
      "Sent live by the pair re-check (its third request) and by the agent when it explains a clash, where switched on.",
    ]);
    for (const card of cards.slice(0, 2)) expect(text(card)).not.toMatch(/agent's tools|agent’s tools/);
    expect(live[0]).not.toMatch(/\bonly\b/);
    expect(text(block)).toContain(
      "The page never offers the agent's general explore tools, and the API refuses them unless the deployment switches them on.",
    );
    expect(text(block)).not.toContain("can also send other entity types and signals");
  });
});

describe("one rule per section, and plain claims (round 20)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));

  it("draws no closing rule at the end of a section, so the next section's top rule is the only one", () => {
    for (const id of ["price", "tested", "limits"]) {
      const start = html.indexOf(`<section id="${id}"`);
      const section = html.slice(start, html.indexOf("</section>", start));
      const last = section.slice(section.lastIndexOf("<details") > section.lastIndexOf("<ul") ? section.lastIndexOf("<details") : section.lastIndexOf("<ul"));
      expect(last.slice(0, last.indexOf(">")), id).not.toMatch(/\bborder-b(?![a-z])/);
    }
    // The limits list keeps its running-order rows.
    expect(html).toContain('<ul class="[&amp;&gt;li]:border-t [&amp;&gt;li]:border-border [&amp;&gt;li]:py-2">');
  });

  it("states each limit in its own sentence, keeping every caveat and figure", () => {
    const plain = text(html);
    expect(plain).toContain("So the test does not show that taste overlap predicts the clashes people complain about");
    expect(plain).toContain("though the two intervals overlap widely.");
    expect(plain).toContain("That is one source, found after the fact, and not yet repeated at other festivals.");
    expect(plain).toContain("so a better score is expected, not proof. The app does not claim that any suggestion is the best one.");
    expect(plain).toContain("the check failed as written.");
  });
});

describe("the page's labels and short version (round 18)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const text = (part: string) => part.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'").replace(/\s+/g, " ").trim();

  it("sets no all-caps kicker on the page: no eyebrow over the title or the sections", () => {
    expect(html).not.toContain("type-kicker");
    expect(html).toContain('<h2 id="short-heading" class="type-title break-words xl:col-span-4">The short version</h2>');
  });

  it("keeps bold only on the failed pre-set test, and states the failed test, popularity's result and the moves check once, in one row (round 33)", () => {
    const short = html.slice(html.indexOf('id="short-heading"'), html.indexOf("</section>", html.indexOf('id="short-heading"')));
    expect(short.match(/<strong/g)).toHaveLength(1);
    expect(short).toContain('<strong class="font-semibold">The test we set before building failed.</strong>');
    const { backtest, moves } = METHOD_FIGURES;
    const popularity = methodRow("popularity");
    const first = text(short.slice(short.indexOf("<li"), short.indexOf("</li>")));
    expect(first).toContain(
      `The bar we wrote down before building was ${backtest.bar.topQuarterPct}% and ${backtest.bar.leadOverGenrePoints} points ahead. It missed the bar. Popularity did better: another Qloo field, it reached ${popularity.topQuarterPct.toFixed(1)}%. The check on suggested moves missed its bar too (${moves.measuredPoints} index points against ${moves.barPoints}). See the full comparison below`,
    );
    expect(text(short)).toContain("Taste overlap is a rank, not attendance.");
    // Each said once on the short version, and the failed test's figures are not restated anywhere else on the page
    // outside the eye-only verdict (round 33, E2).
    const once = (needle: RegExp) => (text(short).match(needle) ?? []).length;
    expect(once(/The test we set before building failed/g)).toBe(1);
    expect(once(/after the test failed/g)).toBe(0);
    expect(once(/did better/g)).toBe(1);
    expect((first.match(/missed the bar/g) ?? []).length).toBe(1);
    expect(once(/advantage over popularity|better than popularity/g)).toBe(0);
    expect(short).toContain('href="#tested"');
    // The prose only: the eye-only verdict and the figures (the chart's bar labels, the tables) left out.
    const page = text(
      html
        .replace(/<div aria-hidden="true" data-short-verdict="true"[\s\S]*?<\/div><\/section>/, "</section>")
        .replace(/<figure[\s\S]*?<\/figure>/g, " "),
    );
    expect(page.match(/46\.8%/g)).toHaveLength(1);
    expect(page.match(/did better/g)).toHaveLength(1);
    expect(page.match(/missed the bar/gi)).toHaveLength(1);
    expect(page.match(/The test we set before building failed/g)).toHaveLength(1);
    expect(page).toContain("The failed test above is this table read against the bar we set before running it");
  });
});

describe("the short version and the contents card (round 19)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));

  it("sets no hairline above or between the short version's paragraphs: space alone opens it", () => {
    const start = html.indexOf('<section aria-labelledby="short-heading"');
    const short = html.slice(start, html.indexOf("</section>", start));
    expect(short).toMatch(
      /^<section aria-labelledby="short-heading" class="mt-12 xl:col-span-12 xl:grid xl:grid-cols-subgrid xl:grid-rows-\[auto_1fr\] xl:items-start print:block">/,
    );
    const list = short.slice(short.indexOf("<ul"));
    // No edge of any kind (the link's decoration-border-strong underline is not an edge).
    expect(list).not.toMatch(/(?<![w-])border(-[tblrxy])?(?![w-])|divide-/);
    // Round 34 (audit M4): two rows, the failed test and what the measure is; what the same test did show is said
    // once, in #tested.
    expect(list.match(/<li/g)).toHaveLength(2);
  });

  it("draws no full-width rule between the page's sections, and frames the table once with inset row rules", () => {
    for (const id of ["price", "tested", "limits", "the-rest"]) {
      const start = html.indexOf(`<section id="${id}"`);
      expect(html.slice(start, html.indexOf(">", html.indexOf("<div", html.indexOf("<div", start) + 1)) + 1), id).not.toContain("border-t");
    }
    expect(html).not.toContain("max-w-[48rem] border-t");
    // The table: one 14px frame (the panel corner) with 16px padding, so its header rule (1px, never a 2px ink rule)
    // and row rules are inset 16px.
    expect(html).toMatch(/<div role="region" aria-labelledby="backtest-caption" tabindex="0" class="mt-3 overflow-x-auto rounded-lg border border-surface-edge px-4">/);
    expect(html).toContain('<tr class="border-b border-border align-bottom text-xs sm:text-sm">');
    expect(html).not.toContain("border-b-2");
    // No muted surface (the baselines' bg-muted-foreground fill is ink, not a surface).
    expect(html).not.toMatch(/\bbg-muted(?!-foreground)/);
    // No colour mix, and the raspberry accent only for shared time: none on this page's chrome.
    expect(html).not.toContain("color-mix");
    expect(html).not.toMatch(/\b(bg|text)-primary\b/);
  });

  it("sets the contents as one compact running order after the short version: titles only, no numeral, no label, no surface, no tick", () => {
    const at = html.indexOf('<nav aria-label="On this page">');
    expect(at).toBeGreaterThan(-1);
    const order = html.slice(at, html.indexOf("</nav>", at));
    // One nav, named for screen readers and with no visible label (no kicker, no rail label), not printed.
    expect(html.match(/<nav /g)).toHaveLength(1);
    expect(html).not.toContain("data-rail-label");
    expect(html).not.toContain("data-rail-tick");
    expect(order).not.toContain("type-kicker");
    expect(html.slice(at - 60, at)).toContain('<div class="mt-8 print:hidden">');
    // One horizontal sequence that wraps, entries 24px apart, with no surface, rule, stripe, capsule or tick.
    expect(order).toContain('<ol class="flex flex-wrap gap-x-6 text-sm">');
    expect(order).not.toMatch(/\bbg-|rounded|shadow|border|divide-|sticky|h-\[3px\]/);
    // Each entry is one link holding the title alone, in the order of the four section headings (round 34, audit
    // M7: no numeral, since the sections are not steps; the list's order is the page's order).
    const entries = [...order.matchAll(/<a href="#([a-z-]+)" class="([^"]*)"><span class="([^"]*)">([^<]+)<\/span><\/a>/g)];
    expect(entries).toHaveLength(4);
    expect(order.match(/<a /g)).toHaveLength(4);
    expect(order).not.toMatch(/data-order-numeral|type-numeral|aria-hidden/);
    expect(text(order)).not.toMatch(/\d/);
    expect(entries.map((m) => m[1])).toEqual(["price", "tested", "limits", "the-rest"]);
    expect(entries.map((m) => m[4])).toEqual([
      "What the score is",
      "What we tested it against",
      "What taste overlap cannot tell you",
      "How the rest works",
    ]);
    // A 44px hit area: 6px above and below a 32px line. Inactive entries are muted (the server HTML marks none
    // active; the scroll observer sets aria-current="location" on the client).
    for (const [, , cls, titleCls] of entries) {
      expect(cls).toBe("group inline-flex min-h-11 items-baseline py-1.5 leading-8 hover:text-foreground text-muted-foreground");
      expect(titleCls).toBe("underline-offset-4 group-hover:underline");
    }
    expect(order).not.toContain("aria-current");
    expect(order).not.toMatch(/\b0[1-4]\b/);
    expect(order).not.toMatch(/(bg|text|border|decoration)-primary/);
    // The active entry: the title in ink, semibold, with a 2px ink underline 4px off it. Wayfinding is ink, never
    // raspberry.
    const source = readFileSync(join(process.cwd(), "src", "app", "method", "contents-rail.tsx"), "utf-8");
    expect(source).toContain('on ? "text-foreground" : "text-muted-foreground"');
    expect(source).toContain('on ? "font-semibold underline decoration-2 decoration-foreground" : "group-hover:underline"');
    expect(source).toContain('aria-current={on ? "location" : undefined}');
    expect(source).not.toMatch(/\b(bg|text)-primary\b|variant|sticky/);
  });
});

describe("hanging heads from 1280px (round 26)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const classOf = (tag: string) => tag.match(/class="([^"]*)"/)?.[1] ?? "";

  it("sets each section's heading and body in separate cells of a 12-column grid from xl, printed as one column", () => {
    for (const id of ["price", "tested", "limits", "the-rest"]) {
      const start = html.indexOf(`<section id="${id}"`);
      const section = html.slice(start, html.indexOf("</section>", start));
      const grid = section.match(/<div class="(max-w-\[52rem\][^"]*)">/)?.[1] ?? "";
      expect(grid, id).toContain("xl:max-w-none");
      expect(grid, id).toMatch(/\bxl:grid\b/);
      expect(grid, id).toContain("xl:grid-cols-12");
      expect(grid, id).toContain("xl:gap-x-12");
      expect(grid, id).toContain("print:block");
      // The heading in columns 1 to 4, the body (and any footer) in columns 5 to 12.
      expect(section, id).toMatch(new RegExp(`<h2 id="${id}-heading" class="type-title break-words xl:col-span-4">`));
      // The body follows the heading directly; only "How the rest works" has its rail between them (round 28).
      const afterHead = section.slice(section.indexOf("</h2>") + 5);
      const bodyAt = afterHead.indexOf('<div class="mt-3 xl:mt-0 print:mt-3 ');
      expect(bodyAt, id).toBeGreaterThan(-1);
      if (id === "the-rest") {
        expect(afterHead.startsWith('<div data-section-rail="true" class="mt-8 hidden xl:block xl:col-span-4 xl:col-start-1 xl:row-start-2 print:hidden">')).toBe(true);
      } else {
        expect(bodyAt, id).toBe(0);
        expect(section, id).not.toContain("data-section-rail");
        expect(grid, id).not.toContain("grid-rows");
      }
      const body = afterHead.slice(bodyAt);
      expect(classOf(body.slice(0, body.indexOf(">") + 1)), id).toMatch(/xl:col-span-8 xl:col-start-5/);
    }
    expect(html).toMatch(/<div class="mt-6 min-w-0 xl:col-span-8 xl:col-start-5 xl:row-start-3"><a [^>]*href="\/"/);
    // The header is the same grid: the title and lede across all twelve columns, the short version a subgrid
    // hanging its heading, and the running order in the body column.
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toMatch(/^<header [^>]*><div class="max-w-\[52rem\] xl:max-w-none xl:grid xl:grid-cols-12[^"]*print:block">/);
    expect(header).toMatch(/<h1 class="type-poster xl:col-span-12"/);
    expect(header).toMatch(/<p class="mt-4 max-w-2xl [^"]*xl:col-span-12">/);
    expect(header).toContain('xl:grid-cols-subgrid');
    expect(header).toMatch(/<div class="min-w-0 xl:col-span-8 xl:col-start-5"><div class="mt-8 print:hidden"><nav aria-label="On this page">/);
  });

  it("puts the measure on the running text from xl, so no figure wrapper carries 76ch there", () => {
    // Every wrapper at the 76ch measure below xl gives it up from xl, except the short version's chart and its
    // paragraphs, which keep the R25 rule (the chart at the prose's measure and font).
    const bare = [...html.matchAll(/class="([^"]*(?<![:\w])max-w-\[76ch\][^"]*)"/g)].map((m) => m[1]);
    const keep = bare.filter((cls) => !cls.includes("xl:max-w-none"));
    expect(keep).toEqual([
      "mt-3 min-w-0 max-w-[76ch] text-[0.9375rem] sm:text-base",
      "mt-5 max-w-[76ch] text-[0.9375rem] leading-[1.55] sm:text-base",
    ]);
    // Each section and sub-block body measures its paragraphs, lists and folds from xl (round 35: two more sub-blocks,
    // why Qloo and the control acts).
    const bodies = bare.filter((cls) => cls.includes("xl:max-w-none"));
    expect(bodies).toHaveLength(11);
    for (const cls of bodies) {
      for (const child of ["p", "ul", "ol", "details"]) expect(cls).toContain(`xl:[&amp;&gt;${child}]:max-w-[76ch]`);
    }
    // The figures themselves carry no measure: the comparison table, the Qloo requests, the request flow and the
    // endpoint grid take the full body column from xl. Only their captions keep the measure there.
    for (const caption of ["backtest-caption", "qloo-calls-caption"]) {
      const at = html.indexOf(`id="${caption}"`);
      const figure = html.slice(html.lastIndexOf("<figure", at), html.indexOf(">", html.lastIndexOf("<figure", at)) + 1);
      expect(figure).not.toContain("max-w");
      expect(html.slice(at, html.indexOf(">", at))).toContain("xl:max-w-[76ch]");
    }
    expect(html).toMatch(/<ol aria-label="From your timetable to the index" class="my-6 grid gap-y-2">/);
    expect(html).toMatch(/<ul aria-labelledby="qloo-calls-caption" class="grid gap-x-10 gap-y-10 lg:grid-cols-2">/);
  });

  it("keeps nothing sticky and every anchor other pages link to", () => {
    expect(html).not.toMatch(/\bsticky\b/);
    const source = readFileSync(join(process.cwd(), "src", "app", "method", "page.tsx"), "utf-8");
    expect(source).not.toMatch(/\bsticky\b/);
    for (const id of ["price", "tested", "limits", "the-rest", "qloo-calls", "why-qloo", "controls", "moving-sets", "labels", "live-check", "brief"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("sets the title on the one display step every page title takes, with no size of its own, as /check does", () => {
    expect(html).toContain('<h1 class="type-poster xl:col-span-12">How we know</h1>');
    // Round 34 (one display role, 52px wide and 30px on a phone, from type-poster alone): neither sub-page writes a
    // size of its own over it.
    const check = readFileSync(join(process.cwd(), "src", "app", "check", "page.tsx"), "utf-8");
    expect(check).toContain('<h1 className="type-poster break-words">');
    for (const source of [check, readFileSync(join(process.cwd(), "src", "app", "method", "page.tsx"), "utf-8")]) {
      expect(source).not.toMatch(/<h1[^>]*style=/);
    }
  });
});

describe("the short version's head and verdict (round 27)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const start = html.indexOf('<section aria-labelledby="short-heading"');
  const short = html.slice(start, html.indexOf("</section>", start));
  // The verdict is the short version's last child, so it runs to the section's end (it holds the meter's div).
  const verdict = (short + "</section>").match(/<div aria-hidden="true" data-short-verdict="true" class="([^"]*)">([\s\S]*?)<\/div><\/section>/);
  const meters = [...(verdict?.[2] ?? "").matchAll(/<div data-verdict-meter="true" class="([^"]*)">([\s\S]*?)<\/div>/g)];
  const meter = meters[0] ?? null;
  /** A share of the chart's domain as the percentage the markup carries. */
  const at = (pct: number) => `${Math.round((pct / FIGURE_DOMAIN) * 100000) / 1000}%`;
  /** The marks of one meter, in order: start tick, capsule, bar rule. */
  const marksOf = (inner: string) =>
    [...inner.matchAll(/<span (data-meter-[a-z]+)="true" class="([^"]*)"(?: style="([^"]*)")?><\/span>/g)].map((m) => ({
      mark: m[1],
      cls: m[2],
      style: m[3] ?? "",
    }));
  /** The one line under the last meter that says the scales differ: muted, the verdict's only non-ink line. */
  const SCALE_NOTE = "Each line has its own scale, set by its own bar.";
  const source = readFileSync(join(process.cwd(), "src", "app", "method", "page.tsx"), "utf-8");
  const { backtest, moves } = METHOD_FIGURES;
  const reached = methodRow("taste").topQuarterPct;

  it("sets the heading in the sections' own class, same id and words", () => {
    const section = html.slice(html.indexOf('<section id="price"'));
    const sectionHead = section.match(/<h2 id="price-heading" class="([^"]*)">/)![1];
    expect(short).toMatch(/^<section [^>]*><h2 id="short-heading" class="type-title break-words xl:col-span-4">The short version<\/h2>/);
    expect(sectionHead).toBe("type-title break-words xl:col-span-4");
  });

  it("draws one verdict figure under the heading, from 1280px only, for the eye only and never printed", () => {
    expect(verdict).not.toBeNull();
    const [, cls] = verdict!;
    expect(html.match(/data-short-verdict/g)).toHaveLength(1);
    expect(cls).toContain("hidden xl:block");
    expect(cls).toMatch(/\bprint:hidden\b/);
    expect(cls).toMatch(/\bmt-8\b/);
    // In the heading's columns, in the row under the heading; the body spans both rows, so their tops stay level.
    expect(cls).toMatch(/\bxl:col-span-4 xl:col-start-1 xl:row-start-2\b/);
    expect(short).toMatch(/<div class="min-w-0 xl:col-span-8 xl:col-start-5 xl:row-span-2 xl:row-start-1">/);
    // No box, rule, fill, raspberry, softer tone or sticky, outside the meters (round 28; two of them from round 37
    // fix pass 1), which draw only in ink and border-strong, and the one muted scale note.
    expect(meter).not.toBeNull();
    expect(meters).toHaveLength(2);
    const note = verdict![0].match(/<p class="([^"]*)">([^<]*)<\/p>/g)?.find((p) => p.includes(SCALE_NOTE)) ?? "";
    expect(note).toBe(`<p class="mt-3 max-w-[20rem] text-[0.8125rem] leading-5 text-muted-foreground">${SCALE_NOTE}</p>`);
    const rest = meters.reduce((all, m) => all.replace(m[0], ""), verdict![0]).replace(note, "");
    expect(rest).not.toMatch(/border|rounded|\bbg-|shadow|primary|muted|ink-3|sticky|<figure|<svg/);
    for (const m of meters) {
      expect(m[0]).not.toMatch(/shadow|primary|accent|destructive|muted|ink-3|prov-|sticky|<figure|<svg|-hatch|opacity/);
    }
  });

  it("draws taste overlap's share once on the first screen: the chart's bar, with no meter, row label or bar line for it in the verdict (round 37 fix pass 1, L58)", () => {
    const [, , inner] = verdict!;
    // The chart draws it, once: its ink bar ends at taste overlap's share of the domain, under the one bar line
    // labelled "Bar we set" (the failed bar test pins each); the sentence under the chart states the number (fix pass 2).
    const chart = short.slice(short.indexOf("<figure"), short.indexOf("</figure>"));
    expect(chart).toContain(`rounded-bar h-4 bg-foreground" style="width:${at(reached)}"`);
    expect(text(chart).split("Bar we set:")).toHaveLength(2);
    // The verdict beside it draws none of it again: no meter is called with taste overlap's share, its bar or the
    // chart's own domain, and no line repeats the chart's caption, its row label, its bar label or a figure of it.
    const verdictSource = source.slice(source.indexOf("function ShortVerdict"), source.indexOf("function ShortVersion"));
    expect(verdictSource).not.toContain("taste.topQuarterPct");
    expect(verdictSource).not.toContain("backtest.bar.topQuarterPct");
    expect(verdictSource).not.toContain("domain={FIGURE_DOMAIN}");
    const said = text(inner).replace(/ (?=%)/g, "");
    for (const repeated of [
      "Complained-about clashes",
      "Taste overlap",
      "Bar we set",
      "It missed the bar.",
      `${backtest.bar.topQuarterPct}%`,
      `${reached.toFixed(1)}%`,
      `${methodRow("popularity").topQuarterPct.toFixed(1)}%`,
    ]) {
      expect(said).not.toContain(repeated);
    }
    // In the short version the share is a bar exactly once: the chart's two ink bars are taste overlap and popularity,
    // and the verdict's only meters are the two checks the chart does not draw.
    expect(short.match(/rounded-bar h-4 bg-foreground/g)).toHaveLength(2);
    expect(short.match(/data-verdict-meter/g)).toHaveLength(2);
  });

  it("draws each miss as a meter: an ink capsule to its value, the chart's 1.5px ink bar rule, a border-strong start tick, and empty paper between (round 28)", () => {
    const [, meterCls, inner] = meter!;
    // Under its value line, at most the rail figure's 20rem, with no display numeral anywhere in the verdict.
    expect(meterCls).toBe("relative mt-1 h-5 max-w-[20rem]");
    const lines = verdict![2];
    expect(lines).not.toContain("type-numeral");
    expect(lines.indexOf(">Lead over genre tags</p>")).toBeGreaterThan(-1);
    expect(lines.indexOf(">Lead over genre tags</p>")).toBeLessThan(lines.indexOf("data-verdict-meter"));
    const marks = marksOf(inner);
    expect(marks.map((m) => m.mark)).toEqual(["data-meter-start", "data-meter-reach", "data-meter-bar"]);
    const [start, reach, rule] = marks;
    // The start tick: 1px border-strong, 8px tall, at 0.
    expect(start.cls).toBe("absolute top-1.5 left-0 h-2 w-px bg-border-strong");
    // The capsule: 8px ink, ending at the lead's share of its own domain; it starts 3px in, 2px clear of the 1px start
    // tick, which its round start would otherwise cover.
    expect(reach.cls).toBe("absolute top-1.5 left-[3px] h-2 rounded-bar bg-foreground");
    const domain = (backtest.bar.leadOverGenrePoints * FIGURE_DOMAIN) / backtest.bar.topQuarterPct;
    expect(Number(reach.style.match(/width:calc\(([\d.]+)% - 3px\)/)![1]) / 100).toBeCloseTo(backtest.leadOverGenrePoints / domain, 4);
    // The rule: the chart's 1.5px solid ink bar notation, across the meter's 20px, so 6px above and below the capsule,
    // at the chart's bar fraction.
    expect(rule.cls).toBe("absolute inset-y-0 w-0 -translate-x-1/2 border-l-[1.5px] border-solid border-foreground");
    expect(rule.style).toBe(`left:${at(backtest.bar.topQuarterPct)}`);
    // The gap between them is the miss: nothing else is drawn, and the meter holds no text.
    expect(inner.match(/<span/g)).toHaveLength(3);
    expect(text(inner)).toBe("");
    // Inside the aria-hidden, never-printed, xl-only verdict.
    expect(verdict![1]).toContain("hidden xl:block");
    expect(verdict![1]).toMatch(/\bprint:hidden\b/);
    // Both positions come from the figures module through the chart's own mapping: no number typed in.
    const component = source.slice(source.indexOf("function VerdictMeter"), source.indexOf("function ShortVerdict"));
    expect(component).toContain("along((point / domain) * FIGURE_DOMAIN)");
    expect(component).toContain("at(value)");
    expect(component).toContain("at(bar)");
    expect(component.replace(/\/\*\*[\s\S]*?\*\//g, "")).not.toMatch(/\d+(\.\d+)?%|\b(25|60|75)\b/);
    expect(source).toMatch(/import \{ BacktestBars, FIGURE_DOMAIN, along \} from "@\/components\/clash\/why-this-matters";/);
  });

  it("draws the two pre-set checks the chart does not draw as meters on their own scales, both bar rules at the chart's bar fraction (round 29)", () => {
    const [lead, movesMeter] = meters.map((m) => ({ cls: m[1], marks: marksOf(m[2]) }));
    // Called twice, with the figures module's values: the lead over genre tags against its bar, the moves against
    // theirs, each on 0 to bar x (FIGURE_DOMAIN / the chart's bar), so each bar sits at the chart's bar fraction.
    const verdictSource = source.slice(source.indexOf("function ShortVerdict"), source.indexOf("function ShortVersion"));
    expect(verdictSource.match(/<VerdictMeter\b/g)).toHaveLength(2);
    expect(source).toContain("const RAIL_SCALE = FIGURE_DOMAIN / backtest.bar.topQuarterPct;");
    expect(verdictSource.replace(/\s+/g, " ")).toContain(
      "<VerdictMeter value={backtest.leadOverGenrePoints} bar={backtest.bar.leadOverGenrePoints} domain={backtest.bar.leadOverGenrePoints * RAIL_SCALE} space=\"mt-1\" />",
    );
    expect(verdictSource).toContain(
      '<VerdictMeter value={moves.measuredPoints} bar={moves.barPoints} domain={moves.barPoints * RAIL_SCALE} space="mt-1" />',
    );
    // No figure typed in: the values and bars are read from the figures module.
    const typed = [backtest.leadOverGenrePoints, backtest.bar.leadOverGenrePoints, moves.measuredPoints, moves.barPoints];
    for (const n of typed) expect(verdictSource.replace(/\/\*\*[\s\S]*?\*\//g, "")).not.toMatch(new RegExp(`[^\\w.[-]${String(n).replace(".", "\\.")}(?![\\w.%-]|rem)`));
    // The same notation: same marks, same classes, only the capsule's end differs.
    expect(lead.cls).toBe("relative mt-1 h-5 max-w-[20rem]");
    expect(movesMeter.cls).toBe(lead.cls);
    expect(movesMeter.marks.map((m) => [m.mark, m.cls])).toEqual(lead.marks.map((m) => [m.mark, m.cls]));
    // Both bar rules at one x: the chart's bar over the chart's domain.
    const rule = (meter: typeof lead) => meter.marks.find((m) => m.mark === "data-meter-bar")!.style;
    expect(rule(lead)).toBe(`left:${at(backtest.bar.topQuarterPct)}`);
    expect(rule(movesMeter)).toBe(rule(lead));
    // Each capsule ends at its own value over its own domain.
    const reach = (meter: typeof lead) => Number(meter.marks.find((m) => m.mark === "data-meter-reach")!.style.match(/width:calc\(([\d.]+)% - 3px\)/)![1]) / 100;
    const domain = (bar: number) => (bar * FIGURE_DOMAIN) / backtest.bar.topQuarterPct;
    expect(reach(lead)).toBeCloseTo(backtest.leadOverGenrePoints / domain(backtest.bar.leadOverGenrePoints), 4);
    expect(reach(movesMeter)).toBeCloseTo(moves.measuredPoints / domain(moves.barPoints), 4);
    // Both missed: each capsule stops short of its rule.
    expect(backtest.leadOverGenrePoints).toBeLessThan(backtest.bar.leadOverGenrePoints);
    expect(moves.measuredPoints).toBeLessThan(moves.barPoints);
  });

  it("holds its lines in order, all in ink but the scale note, every number from the figures module", () => {
    const [, , inner] = verdict!;
    const lines = [...inner.matchAll(/<p class="([^"]*)">([\s\S]*?)<\/p>/g)].map((m) => ({ cls: m[1], text: text(m[2]).replace(/ (?=%)/g, "") }));
    expect(lines.map((l) => l.text)).toEqual([
      "Two other checks we set before building",
      "Lead over genre tags",
      `${backtest.leadOverGenrePoints} points · bar ${backtest.bar.leadOverGenrePoints}`,
      "Suggested moves against popularity-only",
      `${moves.measuredPoints} index points · bar ${moves.barPoints}`,
      SCALE_NOTE,
    ]);
    // The opening line at the rail's measure; the two checks 12px under it and 20px apart, labels 13px semibold ink,
    // value lines 13px with the numbers in mono tabular; nothing past 13px, so no stat strip.
    expect(lines[0].cls).toBe("max-w-[20rem] text-[0.8125rem] leading-5");
    expect(lines[1].cls).toBe("mt-3 text-[0.8125rem] leading-5 font-semibold");
    expect(lines[2].cls).toBe("mt-0.5 text-[0.8125rem] leading-5");
    expect(lines[3].cls).toBe("mt-5 text-[0.8125rem] leading-5 font-semibold");
    expect(lines[4].cls).toBe("mt-0.5 text-[0.8125rem] leading-5");
    expect(lines[5].cls).toBe("mt-3 max-w-[20rem] text-[0.8125rem] leading-5 text-muted-foreground");
    const mono = (n: number) => `<span class="font-mono tabular-nums">${n}</span>`;
    expect(inner).toContain(`${mono(backtest.leadOverGenrePoints)} points · bar ${mono(backtest.bar.leadOverGenrePoints)}`);
    expect(inner).toContain(`${mono(moves.measuredPoints)} index points · bar ${mono(moves.barPoints)}`);
    // The scale note sits right after the second meter.
    expect(inner.indexOf(SCALE_NOTE)).toBeGreaterThan(inner.lastIndexOf("data-verdict-meter"));
    // No display numeral and no restated share (round 37, L58): the chart beside the verdict draws taste overlap's
    // share and prints it, so the verdict neither draws nor states it. Never a stat strip.
    expect(inner).not.toContain("type-numeral");
    expect(text(inner)).not.toContain(`${reached.toFixed(1)}%`);
    expect(inner).not.toMatch(/text-\[(0\.9375|1|2|3|3\.5|4)rem\]/);
    // Ink: the wrapper sets the foreground and no line but the scale note (muted) sets another colour.
    expect(verdict![1]).toMatch(/\btext-foreground\b/);
    for (const line of lines.slice(0, -1)) expect(line.cls).not.toMatch(/\btext-(?!\[)/);
    // No number is typed into the page: the verdict reads them from METHOD_FIGURES.
    expect(source).not.toMatch(/46\.8|\b60\s*%|>\s*60\b/);
    const component = source.slice(source.indexOf("function ShortVerdict"), source.indexOf("function ShortVersion"));
    expect(component).not.toContain("formatPct(");
    expect(component).not.toMatch(/\d+\.\d+%|\b(25|60)\b/);
  });

  it("keeps the real lines visible where they are: the caption, the chart, the failed test and It missed the bar.", () => {
    const visible = text(html.replace(/<div aria-hidden="true" data-short-verdict="true"[\s\S]*?<\/div><\/section>/, "</section>"));
    expect(visible).toContain("Complained-about clashes in the day's highest 25%, by method");
    expect(visible).toContain("The test we set before building failed.");
    expect(visible).toContain("It missed the bar.");
    expect(visible).toMatch(/Bar we set: 60 ?%/);
    // The verdict comes after the body in the source, so the chart and the failed test still follow the heading.
    expect(short.indexOf("data-short-verdict")).toBeGreaterThan(short.indexOf("The test we set before building failed."));
  });
});

describe("the request flow in the rail of How the rest works (round 28)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const start = html.indexOf('<section id="the-rest"');
  const rest = html.slice(start, html.indexOf("</section>", start));
  const flows = [...html.matchAll(/<ol aria-label="From your timetable to the index"[^>]*>[\s\S]*?<\/ol>/g)].map((m) => m[0]);
  const nodesOf = (flow: string) => [...flow.matchAll(/<li data-flow-node="true"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));

  it("keeps two copies in the DOM, one displayed at each width: the rail copy hidden xl:block print:hidden, the body copy xl:hidden print:block", () => {
    expect(flows).toHaveLength(2);
    // The rail copy, right under the section's heading, in the heading's columns, row 2; not aria-hidden, since from
    // 1280px it is the only copy.
    const rail = rest.match(/<div data-section-rail="true" class="([^"]*)"><div data-flow-place="rail">(<ol [\s\S]*?<\/ol>)<\/div><\/div>/);
    expect(rail).not.toBeNull();
    expect(rail![1]).toBe("mt-8 hidden xl:block xl:col-span-4 xl:col-start-1 xl:row-start-2 print:hidden");
    expect(rest.indexOf("data-section-rail")).toBeGreaterThan(rest.indexOf("</h2>"));
    expect(rest.indexOf("data-section-rail")).toBeLessThan(rest.indexOf('id="qloo-calls"'));
    // The body copy, inside the Qloo requests figure after its caption and before the endpoints.
    const body = rest.match(/<div data-flow-place="body" class="([^"]*)">(<ol [\s\S]*?<\/ol>)<\/div>/);
    expect(body).not.toBeNull();
    expect(body![1]).toBe("xl:hidden print:block");
    // Its wrapper keeps the 24px between the caption and the endpoints from 1280px, where the flow's own margin goes
    // with it; in print the flow is back and brings its own.
    expect(rest).toContain('<div class="xl:pt-6 print:pt-0"><div data-flow-place="body" class="xl:hidden print:block"><ol ');
    expect(rest.indexOf('data-flow-place="body"')).toBeGreaterThan(rest.indexOf("</figcaption>"));
    expect(rest.indexOf('data-flow-place="body"')).toBeLessThan(rest.indexOf('<ul aria-labelledby="qloo-calls-caption"'));
    // Hidden only by display (hidden, xl:hidden, print:hidden), never by aria-hidden, sr-only, visibility or opacity.
    for (const cls of [rail![1], body![1]]) expect(cls).not.toMatch(/sr-only|invisible|opacity|order-/);
    expect(rest.slice(rest.indexOf("data-section-rail") - 40, rest.indexOf("data-section-rail"))).not.toContain("aria-hidden");
    for (const flow of flows) expect(flow).not.toMatch(/^<ol [^>]*aria-hidden/);
    // The section's grid gets the verdict's two rows only here: the heading's own height, then the rest, which the
    // body spans; the back link goes under both.
    const grid = rest.match(/<div class="(max-w-\[52rem\][^"]*)">/)?.[1] ?? "";
    expect(grid).toContain("xl:grid-rows-[auto_1fr]");
    expect(rest).toMatch(/<div class="mt-3 xl:mt-0 print:mt-3 [^"]*xl:col-span-8 xl:col-start-5[^"]* xl:row-span-2 xl:row-start-1">/);
    expect(rest).not.toMatch(/\bsticky\b/);
  });

  it("draws the rail copy as the body copy is drawn, words, tokens and paths unchanged (round 37: one column at every width)", () => {
    const [rail, body] = [flows.find((f) => f.includes('class="grid gap-y-2"'))!, flows.find((f) => f.includes('class="my-6 grid gap-y-2"'))!];
    expect(rail).toBeDefined();
    expect(body).toBeDefined();
    expect(rail).toMatch(/^<ol aria-label="From your timetable to the index" class="grid gap-y-2">/);
    expect(nodesOf(rail).map((node) => node.replace(/ On request: .*$/, ""))).toEqual(CHAIN);
    expect(nodesOf(body).map((node) => node.replace(/ On request: .*$/, ""))).toEqual(CHAIN);
    // The same markup inside both lists: the two copies differ only in the outer margin.
    const inner = (flow: string) => flow.slice(flow.indexOf(">") + 1);
    expect(inner(rail)).toBe(inner(body));
    // The same tokens in the same classes: ink, the Keep semibold.
    const tokens = (flow: string) => [...flow.matchAll(/<code data-flow-token="true" class="([^"]*)">([^<]+)<\/code>/g)].map((m) => [m[2], m[1]]);
    expect(tokens(rail)).toEqual(tokens(body));
    expect(tokens(rail)).toHaveLength(7);
    // Down arrows only, shown at every width, five of them 24px long, in ink, the head's tip where the line ends; the
    // spine and the branch arrow off the engine; no across arrows and no width variants.
    expect(rail.match(/<svg aria-hidden="true" data-flow-arrow="down" focusable="false" width="10" height="24" class="mt-2 block overflow-visible"/g)).toHaveLength(5);
    expect(rail.match(/<line x1="5" y1="0.75" x2="5" y2="22.5" stroke="var\(--foreground\)"/g)).toHaveLength(5);
    expect(rail.match(/<path d="M1.25 18.25 L5 22.5 L8.75 18.25" stroke="var\(--foreground\)"/g)).toHaveLength(5);
    expect(rail.match(/data-flow-arrow="spine"/g)).toHaveLength(1);
    expect(rail.match(/data-flow-arrow="branch"/g)).toHaveLength(1);
    expect(rail).not.toContain('data-flow-arrow="across"');
    expect(rail).not.toMatch(/\b(sm|md|lg|xl):/);
    // The makers and Qloo's endpoint paths under each token, as in the body copy: the endpoints teal, three of them.
    expect(rail.match(/<p class="mt-1 text-\[0\.8125rem\] leading-snug text-foreground">/g)).toHaveLength(7);
    expect(rail.match(/<code class="font-mono text-prov-qloo">\/[^<]+<\/code>/g)).toHaveLength(3);
    // No dots, nodes, boxes or raspberry, and nothing focusable in either copy.
    for (const flow of [rail, body]) {
      expect(flow).not.toMatch(/<circle|rounded|class="[^"]*border|bg-card|var\(--primary\)|text-primary|bg-primary/);
      expect(flow).not.toMatch(/<a |<button|<input|<select|tabindex|<details/);
    }
  });
});

describe("true sentences about location, the test that held, the brief and its limits (round 31)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const plain = text(html);
  const { backtest, scale } = METHOD_FIGURES;
  const taste = methodRow("taste");
  const genre = methodRow("genre");
  const popularity = methodRow("popularity");

  it("says what the same test did show once, in #tested ('What it does show'), every figure from METHOD_FIGURES; the short version no longer repeats it (round 34, audit M4)", () => {
    const [low, high] = taste.auc95!;
    // The same figures the short version's duplicate line carried: taste overlap's AUC against genre tags', the
    // overlapping intervals, and the correlation with popularity, in the test's own section.
    const shows =
      `What it does show: in this test taste overlap ranked the complained-about clashes above genre tags did ` +
      `(AUC ${taste.auc.toFixed(3)} against ${genre.auc.toFixed(3)}), though the two intervals overlap widely. ` +
      `It is nearly unrelated to popularity (correlation ${backtest.popularityCorrelation}), so it is a separate signal from popularity.`;
    expect(shows).toBe(
      "What it does show: in this test taste overlap ranked the complained-about clashes above genre tags did (AUC 0.634 against 0.512), though the two intervals overlap widely. It is nearly unrelated to popularity (correlation 0.08), so it is a separate signal from popularity.",
    );
    const start = html.indexOf('<section id="tested"');
    const tested = text(html.slice(start, html.indexOf("</section>", start)));
    expect(tested).toContain(shows);
    expect(plain.match(/What it does show/g)).toHaveLength(1);
    // Taste overlap's interval against chance stays on the page, in the comparison table whose caption says what 0.5
    // means; the interval's floor is above chance in the figures themselves.
    const table = text(html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>")));
    expect(table).toContain(`${taste.auc.toFixed(3)} (${low.toFixed(3)} to ${high.toFixed(3)})`);
    expect(plain).toContain(`AUC (${scale.auc.chance} means no better than chance;`);
    expect(low).toBeGreaterThan(scale.auc.chance);
    // Popularity's result is said once in the short version's first row (round 32).
    expect(popularity.auc).toBe(0.722);
    const shortAt = html.indexOf('<section aria-labelledby="short-heading"');
    const short = html.slice(shortAt, html.indexOf("</section>", shortAt));
    const items = [...short.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/^The test we set before building failed\./);
    expect(items[1]).toBe("It ranks a day's clashes and tests moves against timetable rules. Taste overlap is a rank, not attendance.");
    // The duplicate line is gone from the page, and the short version states no AUC at all.
    expect(plain).not.toContain("In the same test, taste overlap ranked");
    expect(plain).not.toContain("which stays above");
    expect(text(short)).not.toContain("AUC");
    // No heading of its own, and none of the words the decision rules out.
    expect(short).not.toMatch(/the result that held|beat genre tags/i);
    expect(plain).not.toMatch(/the result that held|beat genre tags|pre-registered/i);
  });

  it("says the location parameter is not sent, as a row of the /v2/insights card", () => {
    expect(text(html.replace(/<wbr\/?>/g, ""))).toContain(
      "signal.location.query Not sent: both saved days were ranked without a location, so their taste overlap is a global reading, not a local one.",
    );
    expect(plain).not.toContain("Sent when the festival has a city");
  });

  it("describes the brief the way the home page's pilot offers it, and says what the figures must never be used for under #limits", () => {
    expect(plain).toContain(
      "It is for evaluating this entry. The pilot on the home page walks a programmer through a published day's brief, with the same limits: no Qloo tags or identifiers, and not for redistribution.",
    );
    expect(plain).not.toContain("it is not offered to festivals");
    // The pilot no longer offers a brief for a new bill (round 32, V4).
    expect(plain).not.toMatch(/sends one back|sends its bill/);
    const start = html.indexOf('<section id="limits"');
    const limits = text(html.slice(start, html.indexOf("</section>", start)));
    expect(limits).toContain(
      "Do not use this to set fees, billing order or an artist's worth, or for crowd capacity, safety or attendance.",
    );
  });

  it("leaves the site header and footer off the printed page; the light print palette is the stylesheet's", () => {
    expect(html).toMatch(/<style>[\s\S]*@media print \{\s*body > header, body > footer \{ display: none !important; \}/);
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const print = css.slice(css.indexOf("@media print {\n  :root.dark {"));
    expect(print).toMatch(/^@media print \{\s*:root\.dark \{/);
    expect(print.slice(0, print.indexOf("}"))).toContain("--foreground: oklch(0.21 0.018 262);");
    // Paper is light in either theme: in the same block, an important rule outranks the theme script's inline
    // color-scheme (round 34 moved it out of :root.dark for that reason).
    const block = print.slice(0, print.indexOf("\n}\n"));
    expect(block).toMatch(/:root \{\s*color-scheme: light !important;\s*\}/);
  });
});

describe("taste inside the pair score, the second exploratory follow-up (round 32, V2; round 37 score words)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const visible = text(html.replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/g, " "));
  const start = html.indexOf('id="taste-in-price"');
  const block = html.slice(start, html.indexOf("<details", start));
  const blockText = text(block);

  it("sits in the open inside #tested, after the first follow-up's fold and before the sources, under a neutral heading", () => {
    expect(start).toBeGreaterThan(html.indexOf('id="tested"'));
    expect(start).toBeLessThan(html.indexOf('id="limits"'));
    expect(start).toBeGreaterThan(html.indexOf("Exploratory follow-up, run after the test failed"));
    expect(html).toContain(
      '<h3 id="taste-in-price-heading" class="text-lg leading-snug font-semibold break-words">Taste inside the pair score (exploratory)</h3>',
    );
    expect(html).not.toContain("What taste adds");
    expect(visible).toContain("Taste inside the pair score (exploratory)");
  });

  it("prints every figure from METHOD_FIGURES and says it did not establish an advantage over popularity", () => {
    // The index's pair score, named with its factors once, in its own clause (round 33, E1; round 37, R3: "pair
    // score" in place of the backtest's "full price").
    expect(blockText).toContain(
      "Run after the failed test above, on the same 68 complained-about pairs, so it is exploratory. The pair score (taste overlap × shared time × Qloo popularity) scored AUC 0.746 (interval 0.675 to 0.812); popularity alone scored 0.722. The difference is +0.024 (interval -0.074 to +0.136), so the pair score did not establish an advantage over popularity.",
    );
    expect(blockText.match(/The pair score \(taste overlap × shared time × Qloo popularity\)/g)).toHaveLength(1);
    expect(blockText).toContain(
      "With taste taken out, every pair given the same taste overlap so that only shared time and draw are left, the same score reached 0.754 (interval 0.690 to 0.828). The pair score minus that is -0.009 (interval -0.102 to +0.079). This check did not establish that taste adds to time and draw.",
    );
    expect(blockText).toContain(
      "With the taste values shuffled among each day's pairs, 1,000 times, the pair score fell to 0.652 on average (95% of shuffles between 0.593 and 0.706). So the pair score depends on the real taste values, which is not the same as taste adding to time and draw.",
    );
    expect(visible).toContain("so the pair score did not establish an advantage over popularity.");
    expect(blockText).not.toMatch(/full price/i);
    expect(visible).toContain("This check did not establish that taste adds to time and draw.");
  });

  it("says plainly that taste adding was not established, in bold, because the interval holds zero", () => {
    expect(block).toContain('<strong class="font-semibold">This check did not establish that taste adds to time and draw.</strong>');
  });

  it("tables the figures by festival, Glastonbury against the four US festivals, with Riot Fest not interpreted", () => {
    expect(block).toContain('<figcaption id="taste-by-festival-caption"');
    const table = text(block.slice(block.indexOf("<table"), block.indexOf("</table>")));
    expect(table).toBe(
      "Festivals Popularity Time and draw Pair score " +
        "Glastonbury 2025 14 pairs from 8 complaints 0.563 0.671 0.871 " +
        "Four US festivals 54 pairs from 34 complaints 0.768 0.779 0.715 " +
        "Riot Fest 2026, one of the four 5 pairs from 3 complaints Not interpreted: too few complaints to read alone",
    );
    expect(blockText).toContain("AUC by festival, exploratory (0.5 means no better than chance)");
  });

  it("states each sample's result with its sign, interval, size and source, then a labelled hypothesis with its confound (round 33, E3)", () => {
    expect(blockText).toContain(
      "On the Glastonbury 2025 complaints (14 complaint pairs in 8 clusters, all from one NME clash guide about mid-card acts), adding taste raised the pair score's AUC by 0.201 (interval +0.111 to +0.277, resampled by complaint). On the four US festivals (54 complaint pairs in 34 clusters, press complaints that mostly named the day's biggest acts, which popularity already ranks well), adding taste lowered it by 0.065 (interval -0.163 to +0.025, includes 0).",
    );
    expect(blockText).toContain(
      "A hypothesis for use, not a result: taste overlap may matter most for mid-card clashes; for clashes between the day's biggest acts, time and draw already carry most of the signal. The two samples also differ in festival, complaint source and act size, so this split cannot say which of those drives it. Untested beyond this data.",
    );
    // After the per-festival table, still labelled exploratory, and the hypothesis after the two results.
    expect(block.indexOf("A hypothesis for use")).toBeGreaterThan(block.indexOf("</table>"));
    expect(blockText.indexOf("A hypothesis for use")).toBeGreaterThan(blockText.indexOf("adding taste lowered it"));
    expect(blockText).toContain("exploratory");
    expect(blockText).not.toMatch(/cross-genre|it did not\b/i);
    expect(blockText).toContain(
      "Location is untested: these rankings were made without a location, and asking again for the US festival days with each festival's city would cost 347 Qloo requests.",
    );
    expect(blockText).not.toMatch(/\bbeats?\b|better than popularity|predicts|validated|proves|pre-registered|What taste adds/i);
  });

  it("states the disagreement count once, aggregate only, with no pair named (round 33, E4)", () => {
    expect(blockText).toContain(
      "Complained-about clashes that taste overlap put in their day's top quarter while popularity put them in the bottom half: 4 of 68, from 2 complaint clusters; all 4 were also in the top quarter on time and draw.",
    );
    expect(text(html).match(/4 of 68/g)).toHaveLength(1);
  });

  it("describes a replication test that has not been run, with its threshold stated before any data and no result promised (round 33, E5)", () => {
    expect(blockText).toContain(
      "A replication test we have not run. It needs data that does not exist yet: the 2027 bills of the same five festivals, scored when their set times are published and before any complaint is collected. The scoring would be fixed and written down before that data arrives, and complaints collected the same way as here. On the same complained-about pairs, the pair score would be compared with the same score with taste held constant, as a paired difference, counted a success only if that difference's 95% interval lies above 0. Both arms keep Qloo's popularity; a baseline with no Qloo data has not been tested.",
    );
    // A plain bold lead, never a kicker or a heading of its own.
    expect(block).toContain('<strong class="font-semibold">A replication test we have not run.</strong>');
    expect(block).not.toContain("type-kicker");
    expect(blockText).not.toMatch(/pre-registered|settle|will show|will find|would show that/i);
  });

  it("keeps the anchors other pages link to", () => {
    for (const id of ["price", "tested", "limits", "labels", "brief"]) expect(html).toContain(`id="${id}"`);
  });
});

describe("the Hidden label's definition (round 32, V6)", () => {
  const plain = text(renderToStaticMarkup(createElement(MethodPage)));

  it("says the label's genre test is that main genre tags differ, and keeps the count line and its caveats", () => {
    expect(plain).toContain(
      "The Hidden label on the timetable uses a stricter line than this count for taste overlap, the day's top tenth where the count above uses the top quarter, and a looser one for genre: the two acts' main genre tags differ.",
    );
    expect(plain).toContain(
      "Hidden clashes are examples, not detections. Of 185 pairs with top-quarter taste overlap and no shared genre tag, 15 were complained about (8.1%, against 5.0% for all pairs).",
    );
    // One definition of the label: the old "with no shared genre tag" wording of the label is gone.
    expect(plain).not.toContain("top tenth, with no shared genre tag");
  });
});

describe("the lede and the index's words (round 33, E1)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const plain = text(html);

  it("opens with 'scores', as the home page does, and leaves no money word for the index anywhere on the page, folds included (round 37, R3)", () => {
    expect(plain).toContain("Clash Control scores set-time clashes with a number it derives from Qloo data.");
    // Round 34 (audit M2): the lede is that one sentence; the self-describing second sentence is cut.
    const lede = text(html.match(/<p class="mt-4 max-w-2xl [^"]*xl:col-span-12">([\s\S]*?)<\/p>/)?.[1] ?? "");
    expect(lede).toBe("Clash Control scores set-time clashes with a number it derives from Qloo data.");
    expect(plain).not.toContain("This page says what that number is");
    expect(plain).not.toMatch(/Clash Control prices/);
    // The page says score or index everywhere, the anchor id kept for links (round 37, R3: nothing is excused; the
    // backtest's "full price" is the pair score, and formulaNote says "the printed score" inside the closed fold).
    const words = plain.match(/\b(price|prices|priced|unpriced|pricing)\b/gi) ?? [];
    expect(words).toEqual([]);
    expect(plain).toContain("so they may not multiply to exactly the printed score.");
    expect(html).toContain('id="price"');
    expect(plain).toContain("Pair score = taste overlap × share of the shorter set played at once × combined draw × rarity factor.");
  });
});

describe("the complaint median stays on /method (round 34, guardian S2)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const { complaints } = METHOD_FIGURES;

  it("shows the median overlap of the complained-about pairs, 50 minutes, with its count, range and sources", () => {
    // The hero's stat line left home; its median stays here, beside the figures it summarises.
    expect(complaints.medianMinutes).toBe(50);
    const sentence =
      `${complaints.clustersVerified} clashes that fans or the press complained about at five festivals had a verified ` +
      `overlap in time: ${complaints.pairsVerified} pairs of acts, overlapping for a median of ${complaints.medianMinutes} ` +
      `minutes (from ${complaints.rangeMinutes[0]} to ${complaints.rangeMinutes[1]}).`;
    expect(sentence).toBe(
      "45 clashes that fans or the press complained about at five festivals had a verified overlap in time: 86 pairs of acts, overlapping for a median of 50 minutes (from 10 to 90).",
    );
    expect(text(html)).toContain(sentence);
    // In the sources fold of #tested, whose summary names the clashes with no click.
    const sources = [...html.matchAll(/<details[\s\S]*?<\/details>/g)].map((m) => m[0]).find((d) => d.includes("Sources for the")) ?? "";
    expect(text(sources)).toContain(sentence);
    expect(text(sources.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "")).toBe(`Sources for the ${complaints.clustersVerified} clashes`);
    const tested = html.indexOf('<section id="tested"');
    expect(html.indexOf(sources)).toBeGreaterThan(tested);
    expect(html.indexOf(sources)).toBeLessThan(html.indexOf("</section>", tested));
  });
});

describe("why Qloo, the control acts, the backtest's pairs, the legend and the global reading (round 35)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  /** What a reader sees with no click: the page with every closed disclosure taken out. */
  const visible = text(html.replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/g, " "));
  const restStart = html.indexOf('<section id="the-rest"');
  const rest = html.slice(restStart, html.indexOf("</section>", restStart));
  /** A sub-block of "How the rest works", from its id to the next sub-block. */
  const block = (id: string) => {
    const start = rest.indexOf(`<div id="${id}"`);
    const next = rest.indexOf('<div id="', start + 1);
    return rest.slice(start, next < 0 ? undefined : next);
  };

  it("answers why Qloo and not a similar-artists list or ticket data, under How the rest works, in the open", () => {
    const why = block("why-qloo");
    expect(why).toMatch(
      /^<div id="why-qloo" class="scroll-mt-24 pt-8 first:pt-0"><h3 id="why-qloo-heading" class="text-lg leading-snug font-semibold break-words">Why Qloo, not a similar-artists list or ticket data<\/h3>/,
    );
    const said =
      "A similar-artists list names an act's nearest neighbours. This app needs a reading for every clashing pair on a bill, so it asks Qloo to rank all of a day's acts against each act's audience (filter.results.entities). That works before tickets go on sale and for acts with no ticket history at the festival; acts Qloo has no signal for are left out, not scored as zero. It reads taste, not attendance, and this app estimates no attendance.";
    // The inline code token adds no space around itself in the rendered text.
    const inline = (part: string) => text(part.replace(/<\/?code[^>]*>/g, ""));
    expect(inline(why)).toBe(`Why Qloo, not a similar-artists list or ticket data ${said}`);
    expect(inline(html.replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/g, " "))).toContain(said);
    // The parameter is marked as code at the sentence's own size; nothing says streaming data shows attendance.
    expect(why).toContain('(<code class="font-mono">filter.results.entities</code>)');
    expect(text(why)).not.toMatch(/streaming/i);
    // After the Qloo requests it explains, before Moving sets.
    expect(rest.indexOf('id="why-qloo"')).toBeGreaterThan(rest.indexOf('id="qloo-calls"'));
    expect(rest.indexOf('id="why-qloo"')).toBeLessThan(rest.indexOf('id="moving-sets"'));
  });

  it("names the four control acts and their limit from the shared contract, says what the result does not test, and says nothing passed act by act", () => {
    const controls = block("controls");
    expect(CONTROL_ACTS).toEqual(["Vienna Philharmonic", "Raffi", "Frankie Yankovic", "Mormon Tabernacle Choir"]);
    expect(CONTROL_RANK_LIMIT).toBe(0.35);
    expect(controls).toMatch(
      /^<div id="controls" class="scroll-mt-24 pt-8 first:pt-0"><h3 id="controls-heading" class="text-lg leading-snug font-semibold break-words">Four control acts<\/h3>/,
    );
    // Round 36: the control acts are candidates in every act's /v2/insights row (backend/app/qloo/overlap.py), so the
    // block says they count in its percentiles: the mechanism only, nothing on how much a value moves.
    const said =
      "Each build also looks up four acts chosen to be unrelated to a festival bill: Vienna Philharmonic, Raffi, Frankie Yankovic and Mormon Tabernacle Choir. If their audiences do not rank near the bottom of the bill (a mean percentile of 0.35 or lower), the build says the signal does not separate audiences on that bill. On both saved days their mean percentile was 0.35 or lower. They are also in each act's ranked list, so they count in its percentiles. This does not test whether the clash rankings are useful. Their lookups are marked as control acts in How Qloo was used.";
    expect(text(controls)).toBe(`Four control acts ${said}`);
    expect(visible).toContain(said);
    expect(controls).toContain("They are also in each act’s ranked list, so they count in its percentiles.");
    expect(text(controls)).not.toMatch(/moves a little|order in a list changes/);
    // The build tests the mean, so no line says an act passed.
    expect(text(controls)).not.toMatch(/each (act )?passed|every act passed|all four passed/i);
    // The names and the limit come from the contract: none is typed in the page's source.
    const source = readFileSync(join(process.cwd(), "src", "app", "method", "page.tsx"), "utf-8");
    for (const name of CONTROL_ACTS) expect(source).not.toContain(name);
    expect(source).not.toContain("0.35");
    expect(rest.indexOf('id="controls"')).toBeGreaterThan(rest.indexOf('id="why-qloo"'));
    expect(rest.indexOf('id="controls"')).toBeLessThan(rest.indexOf('id="moving-sets"'));
  });

  /** The published days from the backend's built presets, when this checkout has them (they are not committed). */
  type SavedDay = { discriminates?: boolean; report?: { discriminates?: boolean }; requests: { path: string; params: Record<string, string> }[] };
  const saved: SavedDay[] = ["glastonbury-2025-sun.json", "riot-fest-2026-sun.json"]
    .map((file) => join(process.cwd(), "..", "backend", "presets", file))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, "utf8")) as SavedDay);

  it.skipIf(saved.length < 2)("says both saved days met the control limit only because both saved days' builds say so", () => {
    for (const preset of saved) {
      // Each build looked up all four control acts by name.
      const searched = preset.requests.filter((request) => request.path === "/search").map((request) => request.params.query);
      for (const name of CONTROL_ACTS) expect(searched).toContain(name);
      // backend/app/qloo/overlap.py: discriminates is true when the mean control rank was CONTROL_RANK_LIMIT or lower.
      expect(preset.discriminates ?? preset.report?.discriminates).toBe(true);
    }
  });

  it("calls the backtest's pairs complained-about pairs, with the sample size in the open, so they are not read as a day's scored clashes", () => {
    const { backtest } = METHOD_FIGURES;
    expect(visible).toContain(`${backtest.scoredPairs} complained-about pairs from ${backtest.clusters} complaints`);
    expect(text(html)).toContain(`on the same ${backtest.scoredPairs} complained-about pairs, so it is exploratory`);
    // No "scored pairs" is left for the backtest's 68, on the page or in the two sources.
    expect(text(html)).not.toMatch(/scored pairs/);
    const source = readFileSync(join(process.cwd(), "src", "app", "method", "page.tsx"), "utf-8");
    expect(source).not.toMatch(/scored pairs/);
    const figures = readFileSync(join(process.cwd(), "src", "lib", "method-figures.ts"), "utf-8");
    expect(figures).not.toMatch(/scored pairs?\b/);
  });

  it("describes the LLM label in the chip's own words", () => {
    const labels = rest.slice(rest.indexOf('<div id="labels"'), rest.indexOf('<div id="live-check"'));
    expect(text(labels)).toContain("LLM Written by a language model. Not Qloo data.");
    expect(text(labels)).not.toContain("Written by the language model.");
    expect(visible).toContain("Written by a language model. Not Qloo data.");
  });

  it("says under its limits, once, that the reading is global", () => {
    const start = html.indexOf('<section id="limits"');
    const limits = html.slice(start, html.indexOf("</section>", start));
    const line = "It is a global reading: no location was sent, so it says how close two audiences are in general, not at this festival.";
    const items = [...limits.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
    expect(items).toContain(line);
    expect(items.indexOf(line)).toBe(items.indexOf("It is not attendance, and this app estimates no attendance or money figure anywhere.") + 1);
    expect(text(html).split(line).length - 1).toBe(1);
    // The location cost is said once, in the evidence text, not repeated here.
    expect(text(limits)).not.toContain("347");
  });

  it("says under its limits, once and in the shared words, that the published days' locks are this app's (round 36)", () => {
    const start = html.indexOf('<section id="limits"');
    const limits = html.slice(start, html.indexOf("</section>", start));
    expect(LOCK_RULE).toBe(
      "On the published days, the locked sets are the last set on each stage. This app keeps them in place; the festivals did not mark them.",
    );
    const items = [...limits.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    // Byte for byte as lib/locks.ts writes it, as its own row, once on the page and in the open.
    expect(items).toContain(LOCK_RULE);
    expect(html.split(LOCK_RULE).length - 1).toBe(1);
    expect(visible).toContain(LOCK_RULE);
    // A row of the limits list, before the do-not-use line that closes it.
    expect(items.indexOf(LOCK_RULE)).toBe(items.length - 2);
    expect(text(html)).not.toMatch(/not by the festival/i);
  });
});

describe("round 37: one 46.8% on the first screen, the tag cap and the no-signal acts (L58, L60, L38)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  /** What a reader sees with no click: the page with every closed disclosure taken out. */
  const visible = text(html.replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/g, " "));
  const { compareTags, noSignal } = METHOD_FIGURES;
  const reached = `${methodRow("taste").topQuarterPct.toFixed(1)}%`;

  it("states taste overlap's share once above the fold: in the failed test's sentence, with the chart's bar and no value label beside it, and not in the verdict (L58)", () => {
    // Fix pass 2: the failed test's sentence states it (CHARTER 2.1). The chart keeps the bar drawn short of 60 and
    // its accessible name, and still writes all four value labels (the failed bar test pins them), but the figure
    // hides the label after the one bar whose name starts "Taste". The verdict neither draws nor states it (fix
    // pass 1). So a reader sees the number once on the first screen.
    const shortAt = html.indexOf('<section aria-labelledby="short-heading"');
    const short = html.slice(shortAt, html.indexOf("</section>", shortAt));
    const chart = short.slice(short.indexOf("<figure"), short.indexOf("</figure>"));
    // The rule on the figure: an element named "Taste…" with role img, then the value label right after it, is hidden.
    expect(chart.slice(0, chart.indexOf(">"))).toBe(
      '<figure class="mt-4 xl:mt-0 print:mt-4 [&amp;_[role=img][aria-label^=Taste]+[data-bar-value]]:hidden"',
    );
    const bars = [...chart.matchAll(/<span role="img" aria-label="([^"]*)"[^>]*><\/span>(<span data-bar-value="true"[^>]*>([^<]*)<\/span>)/g)];
    expect(bars).toHaveLength(4);
    const named = bars.filter((m) => m[1].startsWith("Taste"));
    // Exactly one bar matches, and the label it hides is taste overlap's share; the other three stay.
    expect(named).toHaveLength(1);
    expect(named[0][1]).toBe(`Taste overlap reached ${reached}; the bar was ${METHOD_FIGURES.backtest.bar.topQuarterPct}%`);
    expect(named[0][3]).toBe(reached);
    expect(bars.filter((m) => m[3] === reached)).toHaveLength(1);
    // What shows once that label is hidden: one figure leaf, the sentence's, and one 46.8% in the text.
    const seen = short.replace(named[0][2], "");
    const leaves = [...seen.matchAll(/<(p|span)\b[^>]*>([^<]*)<\/\1>/g)].filter((m) => m[2].trim() === reached);
    expect(leaves).toHaveLength(1);
    expect(leaves[0][0]).toBe(`<span data-failed-figure="true">${reached}</span>`);
    expect(text(seen).split(reached)).toHaveLength(2);
    // In the markup it is there twice, no more: the hidden label and the sentence. No third copy creeps in.
    expect(text(short).split(reached)).toHaveLength(3);
    const verdict = short.slice(short.indexOf("data-short-verdict"));
    expect(text(verdict)).not.toContain(reached);
    expect(verdict).not.toContain("Taste overlap");
    // The sentence keeps the figure: the failed test is stated with its number.
    expect(text(short.slice(short.indexOf("<li"), short.indexOf("</li>")))).toContain(`Taste overlap put ${reached} of complained-about clashes`);
  });

  it("says what the number of compare tags means, with the cap and the counts from the figures, after the endpoint cards (L60)", () => {
    expect(compareTags).toEqual({ tagCap: 8, savedPairs: 22, fullPairs: 17 });
    const sentence = `This app keeps at most ${compareTags.tagCap} shared genre, subgenre or theme tags per compared pair, and ${compareTags.fullPairs} of the ${compareTags.savedPairs} saved pairs fill all ${compareTags.tagCap}, so the number of tags is not a measure of overlap; read them as examples.`;
    expect(sentence).toBe(
      "This app keeps at most 8 shared genre, subgenre or theme tags per compared pair, and 17 of the 22 saved pairs fill all 8, so the number of tags is not a measure of overlap; read them as examples.",
    );
    expect(visible).toContain(sentence);
    expect(text(html).split(sentence)).toHaveLength(2);
    // In "Qloo requests", after the cards (the /v2/analysis/compare card says which tags are kept), before Why Qloo.
    const at = html.indexOf("This app keeps at most");
    expect(at).toBeGreaterThan(html.indexOf('<ul aria-labelledby="qloo-calls-caption"'));
    expect(at).toBeLessThan(html.indexOf('id="why-qloo"'));
    // No median and no other baseline: with a cap of 8 a median would be the cap.
    expect(text(html)).not.toMatch(/median of \d+ tags|typical pair|tags a typical/i);
  });

  it("names the acts with no Qloo signal on each published day under #limits, and says their overlaps are left out and drawn with no line, with no claim about where they play (L38)", () => {
    expect(noSignal).toEqual([
      {
        festival: "Glastonbury",
        acts: ["Thandii", "Abel Selaocoe & the Bantu Ensemble", "Westside Cowboy"],
        example: { acts: ["Abel Selaocoe & the Bantu Ensemble", "Gurriers"], minutes: 60 },
      },
      {
        festival: "Riot Fest",
        acts: ["Largemouth", "William Shatner", "Rose of Demise"],
        example: { acts: ["The Format", "William Shatner"], minutes: 35 },
      },
    ]);
    const bullet =
      "Qloo has no usable signal for six acts on the two published days: Thandii, Abel Selaocoe & the Bantu Ensemble and Westside Cowboy at Glastonbury, and Largemouth, William Shatner and Rose of Demise at Riot Fest. Their overlaps, such as Abel Selaocoe & the Bantu Ensemble × Gurriers (60 min) and The Format × William Shatner (35 min), are left out, not scored as zero, and drawn with no line.";
    const start = html.indexOf('<section id="limits"');
    const limits = html.slice(start, html.indexOf("</section>", start));
    const items = [...limits.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1].replace(/&amp;/g, "&")));
    expect(items).toContain(bullet);
    // Right after the coverage row it explains, and before the index, lock and do-not-use rows.
    const coverage = items.findIndex((item) => item.startsWith("Qloo has a usable signal for"));
    expect(items.indexOf(bullet)).toBe(coverage + 1);
    expect(visible.replace(/&amp;/g, "&")).toContain(bullet);
    // No claim that these acts open their stages: two of them do not.
    expect(bullet).not.toMatch(/\bopen/i);
    expect(text(limits)).not.toMatch(/\bopen(s|ing|er|ers)?\b/i);
  });

  it("says the chain's steps and the agent's branch in the open, in both copies, and resolves every anchor other pages link to (L59, L57)", () => {
    for (const id of ["price", "tested", "limits", "labels", "brief", "moving-sets", "live-check", "controls", "why-qloo", "qloo-calls", "taste-in-price"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(text(html).split(BRANCH)).toHaveLength(3);
    expect(visible).toContain("pair score did not establish an advantage over popularity");
    expect(visible).toContain("did not establish that taste adds to time and draw");
  });
});

describe("what an index above 100 means (round 37, a judge's question)", () => {
  it("says it in one plain sentence beside the index's definition, as a reading and not a verdict", () => {
    const plain = text(renderToStaticMarkup(createElement(MethodPage)));
    const sentence =
      "An index above 100 means that, by this reading, the day's shared minutes cost more than they would in the average random valid timetable of the same lineup; below 100, less. It is a reading of one kind of cost, not a verdict on how the festival was programmed.";
    expect(plain).toContain(sentence);
    expect(plain.indexOf("Lower is better.")).toBeLessThan(plain.indexOf(sentence));
  });
});
