import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parsePreset, type Preset } from "@/lib/preset";

import { ClashDetails } from "./clash-drawer";

/**
 * A hand-built day in the backend's response shape, parsed as the page parses a preset. Ids, popularity and every
 * figure are invented (not Qloo data). Four acts, each with a saved /search (take 3) and one saved /v2/insights
 * request whose signal is that act and whose filter.results.entities lists the whole bill, as the real builds save
 * them; `compare` adds a saved /v2/analysis/compare for clash #1's pair, `evidence` its receipt with no tags.
 */
const BILL = [
  { id: "sprints", name: "Sprints", qloo_id: "AAAA1111-0000-4000-8000-000000000001", popularity: 0.9134, genre: "Post Punk" },
  { id: "katy", name: "Katy J Pearson", qloo_id: "BBBB2222-0000-4000-8000-000000000002", popularity: 0.8421, genre: "Indie Pop" },
  { id: "c", name: "Act C", qloo_id: "CCCC3333-0000-4000-8000-000000000003", popularity: 0.5, genre: "Rock" },
  { id: "d", name: "Act D", qloo_id: "DDDD4444-0000-4000-8000-000000000004", popularity: 0.4, genre: "Rock" },
] as const;

function preset({
  compare,
  evidence,
  synthetic = false,
  names,
}: {
  compare: boolean;
  evidence: boolean;
  synthetic?: boolean;
  /** Qloo's matched names, as backend/scripts/enrich_matched_names.py adds them (invented here). */
  names?: Record<string, string>;
}): Preset {
  const ids = BILL.map((act) => act.qloo_id);
  return parsePreset({
    id: synthetic ? "synthetic-sat" : "fixture-sun",
    title: "Fixture Fest, Sunday",
    built_at: "2026-10-03T00:13:52+00:00",
    synthetic,
    festival: {
      id: "fixture",
      name: "Fixture Fest",
      city: null,
      days: ["Sun"],
      stages: [
        { id: "one", name: "One", tier: 1, hours: [] },
        { id: "two", name: "Two", tier: 2, hours: [] },
      ],
      acts: BILL.map((act, i) => ({ ...act, billing_tier: 1 + i })),
      timetable: BILL.map((act, i) => ({ act_id: act.id, day: 0, stage_id: i % 2 ? "two" : "one", start: 840 + 90 * Math.floor(i / 2), end: 885 + 90 * Math.floor(i / 2), locked: false })),
    },
    report: {
      festival_id: "fixture",
      metrics: { regret: 1, clash_budget_index: 100, scored_concurrent_pairs: 2, unscored_concurrent_pairs: 0 },
      baseline: null,
      clashes: [
        {
          rank: 1,
          a: { act_id: "sprints", name: "Sprints", stage_id: "one", genre: "Post Punk" },
          b: { act_id: "katy", name: "Katy J Pearson", stage_id: "two", genre: "Indie Pop" },
          day: 0,
          overlap_minutes: 45,
          concurrency: 1,
          audience_overlap: 0.9865,
          draw: 0.877,
          regret: 0.865,
          regret_share: 0.5,
          label: "hidden",
          confidence: "strong",
        },
      ],
      hidden_clash_count: 1,
      thresholds: { hidden_overlap: 0.9, false_overlap: 0.2 },
      coverage: { strong: 4, weak: 0, none: 0, scored_acts: 4, scored_share: 1, unscored: [], weak_act_ids: [] },
      movability: null,
    },
    requests: synthetic
      ? []
      : [
          ...BILL.map((act) => ({ path: "/search", params: { query: act.name, types: "urn:entity:artist", take: 3 }, status: 200, cached: true, request_id: null })),
          ...ids.map((id) => ({
            path: "/v2/insights",
            params: { "filter.type": "urn:entity:artist", "signal.interests.entities": [id], "filter.results.entities": ids, take: ids.length },
            status: 200,
            cached: true,
            request_id: null,
          })),
          ...(compare
            ? [
                {
                  path: "/v2/analysis/compare",
                  params: { "a.signal.interests.entities": [ids[0]], "b.signal.interests.entities": [ids[1]], take: 50 },
                  status: 200,
                  cached: true,
                  request_id: null,
                },
              ]
            : []),
        ],
    sources: [],
    overlap_notes: [],
    evidence: evidence ? { hidden_wall: [], hidden_wall_total: 0, receipts: { "sprints|katy": { shared_tags: [], press: null } }, twins: [] } : null,
    ...(names ? { matched_names: names } : {}),
  });
}

/** The drawer's body for clash #1, as markup and as text. */
function render(day: Preset) {
  const html = renderToStaticMarkup(createElement(ClashDetails, { preset: day, shown: day.report.clashes[0] }));
  const at = html.indexOf(">Saved requests and values</h3>");
  const end = html.indexOf("</section>", at);
  const block = at < 0 ? "" : html.slice(at + 1, end);
  const text = (part: string) =>
    part
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ")
      .replace(/ ([.,;:)])/g, "$1")
      .replace(/([“(]) /g, "$1")
      .replace(/ ”/g, "”")
      .trim();
  return { html, block, text: text(block), all: text(html) };
}

describe("the clash drawer's Saved requests and values (round 37, L85)", () => {
  it("walks clash #1 on a published day with a saved comparison: both acts' searches, the entity ids, one ranked row each, the compare line, what was not retained and the saved date", () => {
    const { html, block, text } = render(preset({ compare: true, evidence: true }));
    expect(block).not.toBe("");
    expect(text).toContain(
      "Sprints: /search “Sprints” (3 candidates asked) · entity this app used AAAA1111… · popularity 0.9134 · its ranked row: 1 /v2/insights request",
    );
    expect(text).toContain(
      "Katy J Pearson: /search “Katy J Pearson” (3 candidates asked) · entity this app used BBBB2222… · popularity 0.8421 · its ranked row: 1 /v2/insights request",
    );
    expect(text).toContain("Taste overlap 99 of 100 on this bill (a rank, not attendance) → pair score → Clash Budget Index.");
    expect(text).toContain("1 saved /v2/analysis/compare request.");
    expect(text).toContain("Matched names were not retained; no shared tags are stored here.");
    expect(text).toContain("Saved 3 Oct 2026.");
    expect(text).not.toContain("No comparison was saved for this pair.");
    // The full id in a title attribute beside the shortened one; never "36 /v2/insights requests".
    expect(block).toContain('title="AAAA1111-0000-4000-8000-000000000001"');
    expect(block).toContain('title="BBBB2222-0000-4000-8000-000000000002"');
    expect(text).not.toMatch(/[2-9] \/v2\/insights requests/);
    // Qloo's endpoints in teal mono, nothing else teal; no box, no raspberry, no control.
    expect(block.match(/<code class="font-mono text-\[0\.8125rem\] text-prov-qloo">\/[a-z0-9/]+<\/code>/g)).toEqual([
      '<code class="font-mono text-[0.8125rem] text-prov-qloo">/search</code>',
      '<code class="font-mono text-[0.8125rem] text-prov-qloo">/v2/insights</code>',
      '<code class="font-mono text-[0.8125rem] text-prov-qloo">/search</code>',
      '<code class="font-mono text-[0.8125rem] text-prov-qloo">/v2/insights</code>',
      '<code class="font-mono text-[0.8125rem] text-prov-qloo">/v2/analysis/compare</code>',
    ]);
    expect(block).not.toMatch(/rounded|border|bg-|primary|<button|<a |<input/);
    // After "The score" and before "Label and confidence".
    expect(html.indexOf(">The score</h3>")).toBeLessThan(html.indexOf(">Saved requests and values</h3>"));
    expect(html.indexOf(">Saved requests and values</h3>")).toBeLessThan(html.indexOf(">Label and confidence</h3>"));
  });

  it("says no comparison was saved where the ledger holds none (the Riot Fest case)", () => {
    const { text } = render(preset({ compare: false, evidence: false }));
    expect(text).toContain("No comparison was saved for this pair.");
    expect(text).not.toContain("saved /v2/analysis/compare request");
    expect(text).toContain("Matched names were not retained; no shared tags are stored here.");
    expect(text).toContain("its ranked row: 1 /v2/insights request");
  });

  it("shows Qloo's search match from the saved reading in place of the not-retained line, where the preset holds the names", () => {
    const { block, text } = render(preset({ compare: true, evidence: true, names: { sprints: "Sprints Band", katy: "Katy J Pearson" } }));
    expect(text).toContain("Qloo’s search match, from the saved reading: Sprints as “Sprints Band”; Katy J Pearson as “Katy J Pearson”.");
    expect(text).not.toContain("Matched names were not retained");
    // This fixture's pair is not one whose saved compare this app has read, so the plain line stands.
    expect(text).toContain("No shared tags are stored here.");
    expect(block).toContain("data-matched-names");
    // The order: compare line, matched names, tags line, saved date.
    const order = ["1 saved /v2/analysis/compare request.", "Qloo’s search match", "No shared tags are stored here.", "Saved 3 Oct 2026."];
    expect(order.map((part) => text.indexOf(part))).toEqual([...order.map((part) => text.indexOf(part))].sort((x, y) => x - y));
    expect(order.every((part) => text.includes(part))).toBe(true);
  });

  it("says plainly why the headline pair holds no shared genre tags", () => {
    const day = preset({ compare: true, evidence: true, names: { sprints: "Sprints", katy: "Katy J Pearson" } });
    const ids: Record<string, string> = {
      sprints: "2D309B5E-4AAB-4B4C-9F70-BCDDB12DB708",
      katy: "3F1B7EC6-EB80-4DD1-A342-EF02D61D0918",
    };
    const swap = (id: string) => (id === BILL[0].qloo_id ? ids.sprints : id === BILL[1].qloo_id ? ids.katy : id);
    const headline: Preset = {
      ...day,
      festival: { ...day.festival, acts: day.festival.acts.map((act) => ({ ...act, qloo_id: act.qloo_id ? swap(act.qloo_id) : null })) },
      requests: day.requests.map((r) => ({
        ...r,
        params: Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, v.split(",").map(swap).join(",")])),
      })),
    };
    const { text } = render(headline);
    expect(text).toContain("1 saved /v2/analysis/compare request.");
    expect(text).toContain(
      "No shared genre tags: the saved compare returned only audience and instrument tags, which this app does not count.",
    );
    expect(text).not.toContain("No shared tags are stored here.");
  });

  it("reads one line on the invented day: no request was made", () => {
    const { block, text } = render(preset({ compare: false, evidence: false, synthetic: true }));
    expect(text).toBe("Saved requests and values Invented day: no Qloo request was made; the acts and figures are invented.");
    expect(block).not.toContain("/search");
    expect(block).not.toContain("text-prov-qloo");
  });
});
