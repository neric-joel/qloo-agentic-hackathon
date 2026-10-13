import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FIGURE_DOMAIN } from "@/components/clash/why-this-matters";
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
    // Each bar is square at the 0 axis and round at its value end. Taste overlap and popularity are the same solid
    // ink bar, so popularity's longer bar shows it did better; genre tags and random are 6px muted baselines; no bar
    // is vermilion.
    expect(html).toContain(`rounded-r-bar h-4 bg-foreground" style="width:${at(reached)}"`);
    expect(html).toContain(`rounded-r-bar h-4 bg-foreground" style="width:${at(methodRow("popularity").topQuarterPct)}"`);
    expect(html).toContain(`rounded-r-bar h-1.5 bg-muted-foreground" style="width:${at(methodRow("genre").topQuarterPct)}"`);
    expect(html).toContain(`rounded-r-bar h-1.5 bg-muted-foreground" style="width:${at(methodRow("random").topQuarterPct)}"`);
    expect(html).not.toMatch(/rounded-r-bar[^"]*(bg-card|border-foreground|ink-3)/);
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
    expect(next).toContain("Popularity did better.");
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
      `${backtest.scoredPairs} scored pairs from ${backtest.clusters} complaints (one complaint can name more than two acts), across ${backtest.festivalDays} festival days.`,
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
    // 20rem is the short version's verdict only (its caption, its three meters and its scale note, round 29), never a
    // rail beside the column.
    const verdictAt = html.indexOf('<div aria-hidden="true" data-short-verdict="true"');
    const verdictEnd = html.indexOf("</div></section>", verdictAt);
    expect(verdictAt).toBeGreaterThan(-1);
    expect(html.slice(verdictAt, verdictEnd).match(/max-w-\[20rem\]/g)).toHaveLength(5);
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

  it("draws the request flow before the endpoints as a typed pipeline: four mono tokens joined by arrows, the two Qloo returns in teal, across from 768px and down on a phone", () => {
    const flow = block.match(/<ol aria-label="From your timetable to the index"[^>]*>[\s\S]*?<\/ol>/)?.[0] ?? "";
    expect(flow).toMatch(/class="[^"]*grid [^"]*md:grid-cols-4/);
    expect(block.indexOf(flow)).toBeLessThan(block.indexOf("<h4"));
    const nodes = [...flow.matchAll(/<li data-flow-node="true"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
    expect(nodes).toEqual([
      "act names Your timetable",
      "entity IDs Qloo /search",
      "overlap ranks Qloo /v2/insights",
      "index (this app) Clash Budget Index",
    ]);
    // The tokens: 14px mono; entity IDs and overlap ranks teal (Qloo returns them), the others ink, the last semibold.
    const tokens = [...flow.matchAll(/<code data-flow-token="true" class="([^"]*)">([^<]+)<\/code>/g)].map((m) => [m[2], m[1]]);
    expect(tokens.map(([token]) => token)).toEqual(["act names", "entity IDs", "overlap ranks", "index (this app)"]);
    for (const [, cls] of tokens) expect(cls).toContain("font-mono text-sm");
    expect(tokens.map(([, cls]) => (cls.includes("text-prov-qloo") ? "qloo" : cls.includes("text-foreground") ? "ink" : "?"))).toEqual([
      "ink",
      "qloo",
      "qloo",
      "ink",
    ]);
    expect(tokens[3][1]).toContain("font-semibold");
    // Arrows: inline SVG in a 1.5px ink line with round caps (round 29: ink, so the flow reads as one pipeline), three
    // across (at least 40px) and three down, 40px long on a phone.
    expect(flow.match(/<svg aria-hidden="true" data-flow-arrow="across"[^>]*class="hidden min-w-10 flex-1 overflow-visible md:block"/g)).toHaveLength(3);
    expect(flow.match(/<svg aria-hidden="true" data-flow-arrow="down"[^>]*class="[^"]*md:hidden"/g)).toHaveLength(3);
    expect(flow.match(/<svg aria-hidden="true" data-flow-arrow="down" focusable="false" width="10" height="40"/g)).toHaveLength(3);
    expect(flow).toMatch(/<line [^>]*stroke="var\(--foreground\)" stroke-width="1.5" stroke-linecap="round"/);
    expect(flow).not.toContain("var(--border-strong)");
    // No dots, circles, nodes, boxes or vermilion.
    expect(flow).not.toMatch(/<circle|rounded|class="[^"]*border|bg-card|var\(--primary\)|text-primary|bg-primary/);
    // The labels in 13px ink, the endpoints in 13px muted mono, never broken mid-word.
    expect(flow.match(/<p class="mt-1\.5 text-\[0\.8125rem\] leading-snug text-foreground">/g)).toHaveLength(4);
    expect(flow.match(/<code class="block font-mono text-\[0\.8125rem\] leading-snug text-muted-foreground">\/[^<]+<\/code>/g)).toHaveLength(2);
    expect(flow).not.toContain("break-all");
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
      // The live line stays word for word as the muted last row.
      expect(text(card)).toMatch(/Sent live: Sent live [^]*\.$/);
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
    expect(block).toContain("Sent when the festival has a city.");
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

  it("keeps bold only on the failed pre-set test, and merges popularity and the moves check into one plain paragraph", () => {
    const short = html.slice(html.indexOf('id="short-heading"'), html.indexOf("</section>", html.indexOf('id="short-heading"')));
    expect(short.match(/<strong/g)).toHaveLength(1);
    expect(short).toContain('<strong class="font-semibold">The test we set before building failed.</strong>');
    const { moves, scale } = METHOD_FIGURES;
    expect(text(short)).toContain(
      `Popularity did better. On the same test, popularity, another Qloo field, reached ${methodRow("popularity").topQuarterPct.toFixed(1)}%. The check on suggested moves failed too: taste-overlap suggestions differed from popularity-only ones by ${moves.measuredPoints} index points (one point is ${scale.indexPointPct}% of the average random timetable's cost); the bar was ${moves.barPoints}.`,
    );
    expect(text(short)).toContain("Taste overlap is a rank, not attendance");
    expect(text(short)).toContain("The results do not establish an advantage over popularity.");
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
    expect(list.match(/<li/g)).toHaveLength(4);
  });

  it("draws no full-width rule between the page's sections, and frames the table once with inset row rules", () => {
    for (const id of ["price", "tested", "limits", "the-rest"]) {
      const start = html.indexOf(`<section id="${id}"`);
      expect(html.slice(start, html.indexOf(">", html.indexOf("<div", html.indexOf("<div", start) + 1)) + 1), id).not.toContain("border-t");
    }
    expect(html).not.toContain("max-w-[48rem] border-t");
    // The table: one 20px frame with 16px padding, so its header rule (1px, never a 2px ink rule) and row rules are inset 16px.
    expect(html).toMatch(/<div role="region" aria-labelledby="backtest-caption" tabindex="0" class="mt-3 overflow-x-auto rounded-lg border border-surface-edge px-4">/);
    expect(html).toContain('<tr class="border-b border-border align-bottom text-xs sm:text-sm">');
    expect(html).not.toContain("border-b-2");
    // No muted surface (the baselines' bg-muted-foreground fill is ink, not a surface).
    expect(html).not.toMatch(/\bbg-muted(?!-foreground)/);
    // No colour mix, and vermilion only for cost: none on this page's chrome.
    expect(html).not.toContain("color-mix");
    expect(html).not.toMatch(/\b(bg|text)-primary\b/);
  });

  it("sets the contents as one compact running order after the short version: numbered 1 to 4 in the display face, no label, no surface, no tick", () => {
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
    // Each entry is one link: the numeral in the condensed display face at 15px (the home section nav's numerals),
    // never zero-padded, then the title, in the order of the four section headings.
    const entries = [
      ...order.matchAll(
        /<a href="#([a-z-]+)" class="([^"]*)"><span aria-hidden="true" data-order-numeral="true" class="type-numeral text-\[0\.9375rem\]">(\d+)<\/span><span class="([^"]*)">([^<]+)<\/span><\/a>/g,
      ),
    ];
    expect(entries.map((m) => m[3])).toEqual(["1", "2", "3", "4"]);
    expect(entries.map((m) => m[1])).toEqual(["price", "tested", "limits", "the-rest"]);
    expect(entries.map((m) => m[5])).toEqual([
      "What the price is",
      "What we tested it against",
      "What taste overlap cannot tell you",
      "How the rest works",
    ]);
    // A 44px hit area: 6px above and below a 32px line. Inactive entries are muted (the server HTML marks none
    // active; the scroll observer sets aria-current="location" on the client).
    for (const [, , cls, , titleCls] of entries) {
      expect(cls).toBe("group inline-flex min-h-11 items-baseline gap-1.5 py-1.5 leading-8 hover:text-foreground text-muted-foreground");
      expect(titleCls).toBe("underline-offset-4 group-hover:underline");
    }
    expect(order).not.toContain("aria-current");
    expect(order).not.toMatch(/\b0[1-4]\b/);
    expect(order).not.toMatch(/(bg|text|border|decoration)-primary/);
    // The active entry: numeral and title in ink, the title semibold with a 2px ink underline 4px off it. Wayfinding
    // is ink, never vermilion.
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
    // Each section and sub-block body measures its paragraphs, lists and folds from xl.
    const bodies = bare.filter((cls) => cls.includes("xl:max-w-none"));
    expect(bodies).toHaveLength(9);
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
    expect(html).toMatch(/<ol aria-label="From your timetable to the index" class="my-6 grid gap-y-2 md:grid-cols-4 md:gap-y-0">/);
    expect(html).toMatch(/<ul aria-labelledby="qloo-calls-caption" class="grid gap-x-10 gap-y-10 lg:grid-cols-2">/);
  });

  it("keeps nothing sticky and every anchor other pages link to", () => {
    expect(html).not.toMatch(/\bsticky\b/);
    const source = readFileSync(join(process.cwd(), "src", "app", "method", "page.tsx"), "utf-8");
    expect(source).not.toMatch(/\bsticky\b/);
    for (const id of ["price", "tested", "limits", "the-rest", "qloo-calls", "moving-sets", "labels", "live-check", "brief"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("sets the title on the sub-page step, the same clamp /check writes", () => {
    expect(html).toContain('<h1 class="type-poster xl:col-span-12" style="font-size:clamp(2.25rem, 1.5rem + 2.5vw, 3rem)">How we know</h1>');
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
  /** The marks of one meter, in order: start tick, capsule, bar rule. */
  const marksOf = (inner: string) =>
    [...inner.matchAll(/<span (data-meter-[a-z]+)="true" class="([^"]*)"(?: style="([^"]*)")?><\/span>/g)].map((m) => ({
      mark: m[1],
      cls: m[2],
      style: m[3] ?? "",
    }));
  /** The one line under the third meter that says the scales differ: muted, the verdict's only non-ink line. */
  const SCALE_NOTE = "Each line has its own scale, set by its own bar.";
  const source = readFileSync(join(process.cwd(), "src", "app", "method", "page.tsx"), "utf-8");
  const { backtest, moves, scale } = METHOD_FIGURES;
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
    // No box, rule, fill, vermilion, softer tone or sticky, outside the meters (round 28; three of them from round
    // 29), which draw only in ink and border-strong, and the one muted scale note.
    expect(meter).not.toBeNull();
    expect(meters).toHaveLength(3);
    const note = verdict![0].match(/<p class="([^"]*)">([^<]*)<\/p>/g)?.find((p) => p.includes(SCALE_NOTE)) ?? "";
    expect(note).toBe(`<p class="mt-3 max-w-[20rem] text-[0.8125rem] leading-5 text-muted-foreground">${SCALE_NOTE}</p>`);
    const rest = meters.reduce((all, m) => all.replace(m[0], ""), verdict![0]).replace(note, "");
    expect(rest).not.toMatch(/border|rounded|\bbg-|shadow|primary|muted|ink-3|sticky|<figure|<svg/);
    for (const m of meters) {
      expect(m[0]).not.toMatch(/shadow|primary|accent|destructive|muted|ink-3|prov-|sticky|<figure|<svg|-hatch|opacity/);
    }
  });

  it("draws the miss as a meter on the chart's own scale: ink capsule to taste overlap, the chart's ink bar rule, a border-strong start tick, and empty paper between (round 28)", () => {
    const [, meterCls, inner] = meter!;
    // Between the numeral and the bar line, at most the rail figure's 20rem.
    expect(meterCls).toBe("relative mt-3 h-5 max-w-[20rem]");
    const lines = verdict![2];
    expect(lines.indexOf("type-numeral")).toBeLessThan(lines.indexOf("data-verdict-meter"));
    expect(lines.indexOf("data-verdict-meter")).toBeLessThan(lines.indexOf("Bar we set:"));
    const at = (pct: number) => `${Math.round((pct / FIGURE_DOMAIN) * 100000) / 1000}%`;
    const marks = marksOf(inner);
    expect(marks.map((m) => m.mark)).toEqual(["data-meter-start", "data-meter-reach", "data-meter-bar"]);
    const [start, reach, rule] = marks;
    // The start tick: 1px border-strong, 8px tall, at 0.
    expect(start.cls).toBe("absolute top-1.5 left-0 h-2 w-px bg-border-strong");
    // The capsule: 8px ink, ending at taste overlap's share of the chart's domain (left + width = that share); it
    // starts 3px in, 2px clear of the 1px start tick, which its round start would otherwise cover.
    expect(reach.cls).toBe("absolute top-1.5 left-[3px] h-2 rounded-bar bg-foreground");
    expect(reach.style).toBe(`width:calc(${at(reached)} - 3px)`);
    expect(Number(reach.style.match(/width:calc\(([\d.]+)% - 3px\)/)![1]) / 100).toBeCloseTo(reached / FIGURE_DOMAIN, 4);
    // The rule: the chart's 1.5px solid ink bar notation, across the meter's 20px, so 6px above and below the capsule.
    expect(rule.cls).toBe("absolute inset-y-0 w-0 -translate-x-1/2 border-l-[1.5px] border-solid border-foreground");
    expect(rule.style).toBe(`left:${at(backtest.bar.topQuarterPct)}`);
    expect(Number(rule.style.match(/left:([\d.]+)%/)![1]) / 100).toBeCloseTo(backtest.bar.topQuarterPct / FIGURE_DOMAIN, 4);
    // The gap between them is the miss: nothing else is drawn, and the meter holds no text.
    expect(inner.match(/<span/g)).toHaveLength(3);
    expect(text(inner)).toBe("");
    // Inside the aria-hidden, never-printed, xl-only verdict.
    expect(verdict![1]).toContain("hidden xl:block");
    expect(verdict![1]).toMatch(/\bprint:hidden\b/);
    // Both positions come from the figures module through the chart's own mapping: no number typed in. From round 29
    // the meter takes (value, bar, domain), and the first one is called with taste overlap, its bar and the chart's
    // own domain, so its geometry is the round 28 one.
    const component = source.slice(source.indexOf("function VerdictMeter"), source.indexOf("function ShortVerdict"));
    expect(component).toContain("along((point / domain) * FIGURE_DOMAIN)");
    expect(component).toContain("at(value)");
    expect(component).toContain("at(bar)");
    expect(component.replace(/\/\*\*[\s\S]*?\*\//g, "")).not.toMatch(/\d+(\.\d+)?%|\b(25|60|75)\b/);
    const verdictSource = source.slice(source.indexOf("function ShortVerdict"), source.indexOf("function ShortVersion"));
    expect(verdictSource).toContain(
      '<VerdictMeter value={taste.topQuarterPct} bar={backtest.bar.topQuarterPct} domain={FIGURE_DOMAIN} space="mt-3" />',
    );
    expect(source).toMatch(/import \{ BacktestBars, FIGURE_DOMAIN, along \} from "@\/components\/clash\/why-this-matters";/);
  });

  it("draws the two other pre-set checks as meters on their own scales, each bar rule at the first meter's rule x (round 29)", () => {
    const [first, lead, movesMeter] = meters.map((m) => ({ cls: m[1], marks: marksOf(m[2]) }));
    // Called three times, with the figures module's values: the lead over genre tags against its bar, the moves
    // against theirs, each on 0 to bar x (FIGURE_DOMAIN / the chart's bar), so each bar sits at the chart's bar fraction.
    const verdictSource = source.slice(source.indexOf("function ShortVerdict"), source.indexOf("function ShortVersion"));
    expect(verdictSource.match(/<VerdictMeter\b/g)).toHaveLength(3);
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
    for (const meter of [lead, movesMeter]) {
      expect(meter.cls).toBe("relative mt-1 h-5 max-w-[20rem]");
      expect(meter.marks.map((m) => [m.mark, m.cls])).toEqual(first.marks.map((m) => [m.mark, m.cls]));
    }
    // Every bar rule at the same x: the same along(bar) fraction as the first meter's.
    const rule = (meter: typeof first) => meter.marks.find((m) => m.mark === "data-meter-bar")!.style;
    expect(rule(lead)).toBe(rule(first));
    expect(rule(movesMeter)).toBe(rule(first));
    // Each capsule ends at its own value over its own domain.
    const reach = (meter: typeof first) => Number(meter.marks.find((m) => m.mark === "data-meter-reach")!.style.match(/width:calc\(([\d.]+)% - 3px\)/)![1]) / 100;
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
      `Complained-about clashes in the day's highest ${scale.topQuarterPct}%`,
      "Taste overlap",
      `${reached.toFixed(1)}%`,
      `Bar we set: ${backtest.bar.topQuarterPct}%`,
      "It missed the bar.",
      "Lead over genre tags",
      `${backtest.leadOverGenrePoints} points · bar ${backtest.bar.leadOverGenrePoints}`,
      "Suggested moves against popularity-only",
      `${moves.measuredPoints} index points · bar ${moves.barPoints}`,
      SCALE_NOTE,
    ]);
    // Round 29: the two added checks, 24px under "It missed the bar." and 20px apart, labels 13px semibold ink, value
    // lines 13px with the numbers in mono tabular; nothing past 13px, so no stat strip.
    expect(lines[5].cls).toBe("mt-6 text-[0.8125rem] leading-5 font-semibold");
    expect(lines[6].cls).toBe("mt-0.5 text-[0.8125rem] leading-5");
    expect(lines[7].cls).toBe("mt-5 text-[0.8125rem] leading-5 font-semibold");
    expect(lines[8].cls).toBe("mt-0.5 text-[0.8125rem] leading-5");
    expect(lines[9].cls).toBe("mt-3 max-w-[20rem] text-[0.8125rem] leading-5 text-muted-foreground");
    const mono = (n: number) => `<span class="font-mono tabular-nums">${n}</span>`;
    expect(inner).toContain(`${mono(backtest.leadOverGenrePoints)} points · bar ${mono(backtest.bar.leadOverGenrePoints)}`);
    expect(inner).toContain(`${mono(moves.measuredPoints)} index points · bar ${mono(moves.barPoints)}`);
    // The scale note sits right after the third meter.
    expect(inner.indexOf(SCALE_NOTE)).toBeGreaterThan(inner.lastIndexOf("data-verdict-meter"));
    // The definition is the chart caption's own words up to its comma.
    const caption = text(html.slice(html.indexOf("<figcaption"), html.indexOf("</figcaption>")));
    expect(caption.replace(/ (?=%)/g, "").startsWith(`${lines[0].text}, by method`)).toBe(true);
    expect(lines[0].cls).toBe("max-w-[20rem] text-[0.8125rem] leading-5");
    expect(lines[1].cls).toBe("mt-3 text-[0.8125rem] leading-5 font-semibold");
    expect(lines[2].cls).toBe("type-numeral mt-1 text-[3.5rem] leading-none tabular-nums");
    expect(lines[3].cls).toBe("mt-2 text-[0.8125rem] leading-5");
    expect(lines[4].cls).toBe("mt-1 text-[0.9375rem] leading-snug font-semibold");
    // The bar's value in mono, as the chart's label sets it.
    expect(inner).toMatch(new RegExp(`Bar we set: <span class="font-mono tabular-nums">${backtest.bar.topQuarterPct}(<!-- -->)?%</span>`));
    // Exactly one display numeral: a single figure, never a stat strip.
    expect(inner.match(/type-numeral/g)).toHaveLength(1);
    // Ink: the wrapper sets the foreground and no line but the scale note (muted) sets another colour.
    expect(verdict![1]).toMatch(/\btext-foreground\b/);
    for (const line of lines.slice(0, -1)) expect(line.cls).not.toMatch(/\btext-(?!\[)/);
    // No number is typed into the page: the verdict reads them from METHOD_FIGURES.
    expect(source).not.toMatch(/46\.8|\b60\s*%|>\s*60\b/);
    const component = source.slice(source.indexOf("function ShortVerdict"), source.indexOf("function ShortVersion"));
    expect(component).toContain("{scale.topQuarterPct}%");
    expect(component).toContain("{formatPct(taste.topQuarterPct)}");
    expect(component).toContain("{backtest.bar.topQuarterPct}%");
    expect(component).not.toMatch(/\d+\.\d+%|\b(25|60)\b/);
  });

  it("keeps the real lines visible where they are: the caption, the chart, the failed test and It missed the bar.", () => {
    const visible = text(html.replace(/<div aria-hidden="true" data-short-verdict="true"[\s\S]*?<\/div><\/section>/, "</section>"));    expect(visible).toContain("Complained-about clashes in the day's highest 25%, by method");
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

  it("draws the rail copy in the flow's own vertical form, words, tokens and paths unchanged", () => {
    const [rail, body] = [flows.find((f) => f.includes('class="grid gap-y-2"'))!, flows.find((f) => f.includes("md:grid-cols-4"))!];
    expect(rail).toBeDefined();
    expect(body).toBeDefined();
    expect(rail).toMatch(/^<ol aria-label="From your timetable to the index" class="grid gap-y-2">/);
    const expected = [
      "act names Your timetable",
      "entity IDs Qloo /search",
      "overlap ranks Qloo /v2/insights",
      "index (this app) Clash Budget Index",
    ];
    expect(nodesOf(rail)).toEqual(expected);
    expect(nodesOf(body)).toEqual(expected);
    // The same tokens in the same classes: teal on the two Qloo returns, ink on the rest, the last semibold.
    const tokens = (flow: string) => [...flow.matchAll(/<code data-flow-token="true" class="([^"]*)">([^<]+)<\/code>/g)].map((m) => [m[2], m[1]]);
    expect(tokens(rail)).toEqual(tokens(body));
    // Down arrows only, shown at every width (no md:hidden), three of them; no across arrows.
    expect(rail.match(/<svg aria-hidden="true" data-flow-arrow="down"[^>]*class="mt-2 block overflow-visible"/g)).toHaveLength(3);
    // Round 29: 24px long in the stacked form (8px clear above, the list's 8px row gap below), in ink, the head's tip
    // where the line ends; the phone form keeps 40px.
    expect(rail.match(/<svg aria-hidden="true" data-flow-arrow="down" focusable="false" width="10" height="24"/g)).toHaveLength(3);
    expect(rail.match(/<line x1="5" y1="0.75" x2="5" y2="22.5" stroke="var\(--foreground\)"/g)).toHaveLength(3);
    expect(rail.match(/<path d="M1.25 18.25 L5 22.5 L8.75 18.25" stroke="var\(--foreground\)"/g)).toHaveLength(3);
    expect(body.match(/<line x1="5" y1="0.75" x2="5" y2="38.5" stroke="var\(--foreground\)"/g)).toHaveLength(3);
    expect(body.match(/<path d="M1.25 34.25 L5 38.5 L8.75 34.25" stroke="var\(--foreground\)"/g)).toHaveLength(3);
    expect(rail).not.toContain('data-flow-arrow="across"');
    expect(rail).not.toMatch(/md:/);
    // The labels and endpoint paths under each token, as in the body copy.
    expect(rail.match(/<p class="mt-1\.5 text-\[0\.8125rem\] leading-snug text-foreground">/g)).toHaveLength(4);
    expect(rail.match(/<code class="block font-mono text-\[0\.8125rem\] leading-snug text-muted-foreground">\/[^<]+<\/code>/g)).toHaveLength(2);
    // No dots, nodes, boxes or vermilion, and nothing focusable in either copy.
    for (const flow of [rail, body]) {
      expect(flow).not.toMatch(/<circle|rounded|class="[^"]*border|bg-card|var\(--primary\)|text-primary|bg-primary/);
      expect(flow).not.toMatch(/<a |<button|<input|<select|tabindex|<details/);
    }
  });
});
