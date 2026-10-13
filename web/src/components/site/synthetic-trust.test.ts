import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BriefContent } from "@/components/brief/brief-sheet";
import { ClashControlFallback, SYNTHETIC_PROOF_LINE } from "@/components/clash/clash-control";
import { SummaryBoard, SummaryScore } from "@/components/clash/server-summary";
import {
  HOW_TO_READ,
  HOW_TO_READ_SYNTHETIC,
  briefIntro,
  coverageSentence,
  figuresAttribution,
  noPricedClashes,
} from "@/lib/brief";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";
import {
  SYNTHETIC_DESCRIPTION_LEAD,
  SYNTHETIC_EVIDENCE,
  loadServerSummary,
  loadSyntheticFlag,
  summarize,
} from "@/lib/server-summary";

import { FOOTER_SOURCES, FOOTER_SYNTHETIC, SiteFooter } from "./site-footer";
import { SyntheticBanner } from "./synthetic-banner";

// Every name and figure below is invented for the test. The synthetic day is the tiny preset with the
// server's flag set, which is how the API marks its invented day.

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const synthetic = () => parsePreset({ ...rawTinyPreset(), synthetic: true });
const real = () => parsePreset(rawTinyPreset());

describe("the server summary of an invented day", () => {
  it("says the day is invented and that no Qloo request was made, never 'matched to Qloo artists'", () => {
    const summary = summarize(synthetic());
    expect(summary.synthetic).toBe(true);
    expect(summary.evidence).toBe(SYNTHETIC_EVIDENCE);
    expect(summary.evidence).toMatch(/invented/);
    expect(summary.evidence).toMatch(/no Qloo request was made/);
    expect(summary.evidence).not.toMatch(/matched to Qloo/);
    expect(summary.evidence).not.toMatch(/saved Qloo request/);
    expect(summary.evidence).not.toMatch(/\d/);
  });

  it("keeps the real wording, and a false flag, for a real day", () => {
    const summary = summarize(real());
    expect(summary.synthetic).toBe(false);
    expect(summary.evidence).toBe(
      "Priced from 2 saved Qloo request records: 2 of 3 acts matched to Qloo artists; 1 not priced.",
    );
  });

  it("puts the invented day in the meta and Open Graph description", () => {
    const description = summarize(synthetic()).description;
    expect(description.startsWith(SYNTHETIC_DESCRIPTION_LEAD)).toBe(true);
    expect(description).toMatch(/no Qloo data/);
    expect(description).toMatch(/Clash Budget Index/);
    expect(summarize(real()).description).not.toMatch(/Invented|no Qloo data/);
  });

  it("is read from the server's own flag in the server HTML of the first page", () => {
    const summary = summarize(synthetic());
    const html = renderToStaticMarkup(createElement(SummaryScore, { summary }));
    expect(text(html)).toContain(SYNTHETIC_EVIDENCE);
    expect(text(html)).not.toMatch(/matched to Qloo/);
    const board = text(renderToStaticMarkup(createElement(SummaryBoard, { summary })));
    expect(board).toMatch(/invented figures for an invented day/);
    expect(board).not.toMatch(/Draw is Qloo popularity/);
    expect(board).not.toMatch(/derived from Qloo data/);
    const realBoard = text(renderToStaticMarkup(createElement(SummaryBoard, { summary: summarize(real()) })));
    expect(realBoard).toMatch(/Draw is Qloo popularity/);
  });

  it("carries the flag from the fetched preset", async () => {
    const list = [{ id: "tiny-fest-sat", title: "Tiny Fest, Saturday", city: null, sets: 3, stages: 2, scored_share: 0.67, synthetic: true }];
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/api/presets")) return new Response(JSON.stringify(list), { status: 200 });
      if (url.endsWith("/decision")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ ...rawTinyPreset(), synthetic: true }), { status: 200 });
    });
    const summary = await loadServerSummary(null, { backend: "http://api.test", fetcher });
    expect(summary?.synthetic).toBe(true);
    expect(summary?.evidence).toBe(SYNTHETIC_EVIDENCE);
  });
});

describe("the first screen while the day loads", () => {
  const intro = createElement("h1", null, "Pitch");

  it("prints the invented-day proof line, not the published-day one", () => {
    const html = text(
      renderToStaticMarkup(createElement(ClashControlFallback, { intro, summary: summarize(synthetic()) })),
    );
    expect(html).toContain(SYNTHETIC_PROOF_LINE);
    expect(html).not.toContain("Glastonbury 2025");
    expect(html).not.toContain("Riot Fest 2026");
    expect(html).not.toMatch(/matched to Qloo/);
  });

  it("keeps the published-day proof line for a real day and for no summary", () => {
    for (const summary of [summarize(real()), null]) {
      const html = text(renderToStaticMarkup(createElement(ClashControlFallback, { intro, summary })));
      expect(html).toContain("Glastonbury 2025");
      expect(html).not.toContain(SYNTHETIC_PROOF_LINE);
    }
  });
});

describe("the synthetic notice in the server HTML", () => {
  it("renders from the server's flag, without waiting for the browser", () => {
    const html = text(renderToStaticMarkup(createElement(SyntheticBanner, { initial: true })));
    expect(html).toBe("Synthetic example day: invented acts, no Qloo data");
    expect(renderToStaticMarkup(createElement(SyntheticBanner, { initial: false }))).toBe("");
    expect(renderToStaticMarkup(createElement(SyntheticBanner))).toBe("");
  });

  it("reads the flag from the preset list alone, and is false on any failure", async () => {
    const entry = { id: "a", title: "A", city: null, sets: 3, stages: 2, scored_share: 0.9 };
    const serve = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
    const options = { backend: "http://api.test" };
    expect(await loadSyntheticFlag({ ...options, fetcher: serve([{ ...entry, synthetic: true }]) })).toBe(true);
    expect(await loadSyntheticFlag({ ...options, fetcher: serve([entry]) })).toBe(false);
    expect(await loadSyntheticFlag({ ...options, fetcher: serve([]) })).toBe(false);
    expect(await loadSyntheticFlag({ ...options, fetcher: serve({}, 500) })).toBe(false);
    expect(await loadSyntheticFlag({ ...options, fetcher: serve("not a list") })).toBe(false);
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await loadSyntheticFlag({ ...options, fetcher: down })).toBe(false);
  });

  it("changes the footer's source line", () => {
    const real = text(renderToStaticMarkup(createElement(SiteFooter)));
    expect(real).toContain(FOOTER_SOURCES);
    const invented = text(renderToStaticMarkup(createElement(SiteFooter, { synthetic: true })));
    expect(invented).toContain(FOOTER_SYNTHETIC);
    expect(invented).not.toContain("saved Qloo responses");
    expect(FOOTER_SYNTHETIC).toMatch(/no Qloo request was made/);
  });
});

describe("the brief of an invented day", () => {
  const props = { day: 0, plan: null };
  const sheet = (preset: ReturnType<typeof parsePreset>) =>
    text(renderToStaticMarkup(createElement(BriefContent, { preset, ...props })));

  it("attributes its figures to an invented day in the footer, the intro and the reading notes", () => {
    const plain = sheet(synthetic());
    expect(plain).toContain(
      "Figures are calculated by this app from an invented day: its acts, times and figures are made up, and no Qloo request was made.",
    );
    expect(plain).toContain("Scored by this app on an invented festival day, not a published timetable.");
    expect(plain).not.toMatch(/from saved Qloo audience data/);
    expect(plain).not.toMatch(/Qloo audience data saved/);
    expect(plain).not.toMatch(/does not use Clash Control/);
    expect(plain).not.toMatch(/calculated by this app from Qloo data/);
    expect(plain).not.toMatch(/Qloo ranks each act/);
    expect(plain).not.toMatch(/Qloo popularity/);
    expect(plain).not.toMatch(/no usable Qloo signal/);
    expect(plain).toContain("Taste overlap here is an invented figure for an invented day");
    expect(plain).toMatch(/not endorsed by Qloo\./);
  });

  it("keeps the real attribution, saved date and all, for a real day", () => {
    const plain = sheet(real());
    expect(plain).toMatch(/Figures are calculated by this app from Qloo audience data saved \d{4}-\d{2}-\d{2}\./);
    expect(plain).toContain("does not use Clash Control");
    expect(plain).not.toMatch(/invented/);
  });

  it("has a wording for each invented-day sentence", () => {
    expect(HOW_TO_READ_SYNTHETIC).toHaveLength(HOW_TO_READ.length);
    for (const line of HOW_TO_READ_SYNTHETIC.slice(0, 2)) expect(line).not.toMatch(/Qloo/);
    expect(coverageSentence({ scored: 3, total: 3, unpriced: 0 }, true)).toBe("Taste overlap is invented for all 3 sets.");
    expect(coverageSentence({ scored: 2, total: 3, unpriced: 1 }, true)).toBe(
      "Taste overlap is invented for 2 of 3 sets; 1 is not priced.",
    );
    expect(coverageSentence({ scored: 1, total: 3, unpriced: 2 }, true)).toBe(
      "Taste overlap is invented for 1 of 3 sets; 2 are not priced.",
    );
    expect(briefIntro("Tiny Fest", true)).not.toMatch(/Tiny Fest/);
    expect(noPricedClashes(true)).not.toMatch(/Qloo/);
    expect(noPricedClashes(false)).toMatch(/Qloo signal/);
    const built = (preset: Raw) => figuresAttribution(parsePreset(preset), "Tiny Fest");
    expect(built({ ...rawTinyPreset(), synthetic: true })).toMatch(/^Figures are calculated by this app from an invented day/);
    expect(built(rawTinyPreset() as Raw)).toMatch(/not endorsed by Qloo or Tiny Fest\./);
  });
});

describe("the first page's meta and Open Graph description", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serveDay(synthetic: boolean) {
    const list = [{ id: "tiny-fest-sat", title: "Tiny Fest, Saturday", city: null, sets: 3, stages: 2, scored_share: 0.67, synthetic }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/presets")) return new Response(JSON.stringify(list), { status: 200 });
        if (url.endsWith("/decision")) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ ...rawTinyPreset(), synthetic }), { status: 200 });
      }),
    );
  }

  it("says the day is invented in every description a shared link shows", async () => {
    serveDay(true);
    const { generateMetadata } = await import("@/app/page");
    const meta = await generateMetadata({ searchParams: Promise.resolve({}) });
    for (const description of [meta.description, meta.openGraph?.description, meta.twitter?.description]) {
      expect(description).toMatch(/^Invented example day, no Qloo data: /);
    }
  });

  it("says in the hero that taste overlap is a rank, not attendance, on both kinds of day", async () => {
    for (const invented of [false, true]) {
      serveDay(invented);
      const { default: Home } = await import("@/app/page");
      const page = await Home({ searchParams: Promise.resolve({}) });
      // The first paint is the fallback, which carries the same static pitch the interactive page gets.
      const plain = text(renderToStaticMarkup(page.props.fallback));
      expect(plain).toContain("Which clash is worth moving?");
      // The audience leads the lede: no eyebrow above the headline.
      expect(plain).toContain("For heads of programming: equal-length clashes can cost very different amounts.");
      // The lede is at most 28 words on both kinds of day, the parenthetical included.
      const ledeHtml = /<h1 id="pitch-heading"[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/.exec(
        renderToStaticMarkup(page.props.fallback),
      )?.[1];
      expect(ledeHtml).toBeDefined();
      const lede = text(ledeHtml ?? "").trim();
      expect(lede.startsWith("For heads of programming")).toBe(true);
      expect(lede.endsWith(invented ? "(an invented rank, not attendance)." : "(a rank, not attendance).")).toBe(true);
      expect(lede.split(/\s+/).length).toBeLessThanOrEqual(28);
      expect(plain.indexOf("For heads of programming")).toBeGreaterThan(plain.indexOf("Which clash is worth moving?"));
      // The complaint figures are one sentence after the lede, with a link to their sources, on both days.
      const stat = "Fans and press complained about 45 clashes at 5 festivals; the median overlap was 50 minutes. Sources";
      expect(plain).toContain(stat);
      expect(plain.indexOf(stat)).toBeGreaterThan(plain.indexOf("taste overlap"));
      // The count of pairs stays in Why this matters; the hero carries one figure line, not a strip.
      expect(plain).not.toContain("pairs of acts");
      expect(renderToStaticMarkup(page.props.fallback)).toMatch(/<a href="#why-this-matters"[^>]*>Sources<\/a>/);
      // In the foreground colour, not muted, so the figures keep their contrast.
      const statTag = /<div data-hero-stat=""[^>]*>/.exec(renderToStaticMarkup(page.props.fallback))?.[0] ?? "";
      expect(statTag).toContain("text-foreground");
      expect(statTag).not.toContain("text-muted-foreground");
      if (invented) {
        expect(plain).toContain("taste overlap (an invented rank, not attendance).");
        // Nothing on an invented day credits Qloo in the lede.
        expect(ledeHtml).not.toMatch(/Qloo/);
        expect(plain).not.toContain("(a rank, not attendance)");
        expect(plain).toContain(SYNTHETIC_PROOF_LINE);
      } else {
        expect(plain).toContain("from Qloo data (a rank, not attendance).");
        expect(plain).toContain(
          "Run on the public timetables of Glastonbury 2025 and Riot Fest 2026. Neither festival uses Clash Control.",
        );
      }
    }
  });

  it("keeps the published-day description for a real day", async () => {
    serveDay(false);
    const { generateMetadata } = await import("@/app/page");
    const meta = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(meta.description).not.toMatch(/Invented/);
    expect(meta.description).toMatch(/Clash Budget Index/);
  });
});
