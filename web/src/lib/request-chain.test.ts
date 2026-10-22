import { describe, expect, it } from "vitest";

import { parsePreset, type Preset } from "./preset";
import {
  CHAIN_INVENTED,
  CHAIN_TITLE,
  candidatesAsked,
  compareLine,
  comparesFor,
  insightsCount,
  insightsFor,
  MATCHED_LABEL,
  matchedNames,
  overlapLine,
  requestChain,
  requestNoun,
  retainedLine,
  savedLine,
  savedOnDate,
  shortId,
  tagsLine,
} from "./request-chain";

/**
 * A hand-built day in the backend's response shape, run through parsePreset as the page runs a preset. Every id and
 * figure is invented (not Qloo data). Six acts, each matched by a saved /search (take 3) and each with one saved
 * /v2/insights request whose signal is that act and whose filter.results.entities lists the whole bill, as the real
 * builds save them. Options add a /v2/analysis/compare request for the first pair and its receipt's tags.
 */
const BILL = [
  { id: "sprints", name: "Sprints", qloo_id: "AAAA1111-0000-4000-8000-000000000001", popularity: 0.9134, genre: "Post Punk" },
  { id: "katy", name: "Katy J Pearson", qloo_id: "BBBB2222-0000-4000-8000-000000000002", popularity: 0.8421, genre: "Indie Pop" },
  { id: "c", name: "Act C", qloo_id: "CCCC3333-0000-4000-8000-000000000003", popularity: 0.5, genre: "Rock" },
  { id: "d", name: "Act D", qloo_id: "DDDD4444-0000-4000-8000-000000000004", popularity: 0.4, genre: "Rock" },
  { id: "e", name: "Act E", qloo_id: "EEEE5555-0000-4000-8000-000000000005", popularity: 0.3, genre: "Folk" },
  { id: "f", name: "Act F", qloo_id: null, popularity: null, genre: null },
] as const;

function rawDay({
  compare = false,
  tags = 0,
  evidence = true,
  builtAt = "2026-10-03T00:13:52+00:00",
}: { compare?: boolean; tags?: number; evidence?: boolean; builtAt?: string | null } = {}): Record<string, unknown> {
  const ids = BILL.flatMap((act) => (act.qloo_id ? [act.qloo_id] : []));
  const searches = BILL.map((act) => ({
    path: "/search",
    params: { query: act.name, types: "urn:entity:artist", take: 3 },
    status: 200,
    cached: true,
    request_id: null,
  }));
  const insights = ids.map((id) => ({
    path: "/v2/insights",
    params: { "filter.type": "urn:entity:artist", "signal.interests.entities": [id], "filter.results.entities": ids, take: ids.length },
    status: 200,
    cached: true,
    request_id: null,
  }));
  const compares = compare
    ? [
        {
          path: "/v2/analysis/compare",
          params: { "a.signal.interests.entities": [BILL[0].qloo_id], "b.signal.interests.entities": [BILL[1].qloo_id], take: 50 },
          status: 200,
          cached: true,
          request_id: null,
        },
        // Another pair's comparison: never counted for the first pair.
        {
          path: "/v2/analysis/compare",
          params: { "a.signal.interests.entities": [BILL[2].qloo_id], "b.signal.interests.entities": [BILL[3].qloo_id], take: 50 },
          status: 200,
          cached: true,
          request_id: null,
        },
      ]
    : [];
  const sharedTags = Array.from({ length: tags }, (_, i) => ({ name: `Tag ${i + 1}`, kind: "urn:tag:genre:music", score: 0.9 - i / 100 }));
  return {
    id: "fixture-sun",
    title: "Fixture Fest, Sunday",
    built_at: builtAt,
    festival: {
      id: "fixture",
      name: "Fixture Fest",
      city: null,
      days: ["Sun"],
      stages: [
        { id: "one", name: "One", tier: 1, hours: [] },
        { id: "two", name: "Two", tier: 2, hours: [] },
      ],
      acts: BILL.map((act, i) => ({ ...act, billing_tier: 1 + (i % 4) })),
      timetable: BILL.map((act, i) => ({ act_id: act.id, day: 0, stage_id: i % 2 ? "two" : "one", start: 720 + 60 * Math.floor(i / 2), end: 780 + 60 * Math.floor(i / 2), locked: false })),
    },
    report: {
      festival_id: "fixture",
      metrics: { regret: 1, clash_budget_index: 100, scored_concurrent_pairs: 2, unscored_concurrent_pairs: 1 },
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
      coverage: { strong: 5, weak: 0, none: 1, scored_acts: 5, scored_share: 0.8333, unscored: [{ act_id: "f", name: "Act F", reason: "no_signal" }], weak_act_ids: [] },
      movability: null,
    },
    requests: [...searches, ...insights, ...compares],
    sources: [],
    overlap_notes: [],
    evidence: evidence
      ? { hidden_wall: [], hidden_wall_total: 0, receipts: { "sprints|katy": { shared_tags: sharedTags, press: null } }, twins: [] }
      : null,
  };
}

const day = (options?: Parameters<typeof rawDay>[0]): Preset => parsePreset(rawDay(options));

describe("requestChain: the saved requests and values behind a pair, read from the preset only (round 37, L85)", () => {
  it("counts an act's /v2/insights requests by signal.interests.entities only: one per act, not one per request on the bill", () => {
    const preset = day();
    const chain = requestChain(preset, "sprints", "katy")!;
    expect(chain.acts.map((act) => act.insights)).toEqual([1, 1]);
    // Every insights request lists the whole bill in filter.results.entities, so matching any parameter would count
    // every one of them for every act.
    const anyParameter = (id: string) =>
      preset.requests.filter((r) => r.path.endsWith("/insights") && Object.values(r.params).join(",").includes(id)).length;
    expect(anyParameter(BILL[0].qloo_id!)).toBe(5);
    expect(insightsFor(preset.requests, BILL[0].qloo_id)).toBe(1);
    expect(insightsFor(preset.requests, BILL[2].qloo_id)).toBe(1);
    // An act with no entity has no ranked row of its own.
    expect(insightsFor(preset.requests, null)).toBe(0);
  });

  it("gives each act its saved /search, the entity this app used, its popularity and genre", () => {
    const [a, b] = requestChain(day(), "sprints", "katy")!.acts;
    expect(a).toEqual({
      id: "sprints",
      name: "Sprints",
      search: { path: "/search", query: "Sprints", types: "urn:entity:artist", take: 3, status: 200, cached: true, request_id: null },
      entityId: "AAAA1111-0000-4000-8000-000000000001",
      popularity: 0.9134,
      genre: "Post Punk",
      insights: 1,
      matchedName: null,
    });
    expect(b.search?.query).toBe("Katy J Pearson");
    expect(b.entityId).toBe("BBBB2222-0000-4000-8000-000000000002");
    expect(b.popularity).toBe(0.8421);
  });

  it("holds a saved compare request with empty tags (the headline pair's case)", () => {
    const chain = requestChain(day({ compare: true, tags: 0 }), "katy", "sprints")!;
    expect(chain.compares).toBe(1);
    expect(chain.sharedTags).toEqual([]);
    expect(chain.overlap).toBe(0.9865);
    expect(chain.savedOn).toBe("3 Oct 2026");
    expect(compareLine(chain.compares)).toBe("1 saved /v2/analysis/compare request.");
    expect(retainedLine(chain.sharedTags)).toBe("Matched names were not retained; no shared tags are stored here.");
  });

  it("holds no compare request and no evidence (the Riot Fest case)", () => {
    const chain = requestChain(day({ compare: false, evidence: false }), "sprints", "katy")!;
    expect(chain.compares).toBe(0);
    expect(chain.sharedTags).toEqual([]);
    expect(compareLine(chain.compares)).toBe("No comparison was saved for this pair.");
    expect(retainedLine(chain.sharedTags)).toBe("Matched names were not retained; no shared tags are stored here.");
  });

  it("holds stored tags", () => {
    const chain = requestChain(day({ compare: true, tags: 8 }), "sprints", "katy")!;
    expect(chain.sharedTags).toHaveLength(8);
    expect(chain.sharedTags[0].name).toBe("Tag 1");
    expect(retainedLine(chain.sharedTags)).toBe("Matched names were not retained.");
  });

  it("counts only a comparison of exactly the pair's two entities, in either order", () => {
    const preset = day({ compare: true });
    expect(comparesFor(preset.requests, BILL[0].qloo_id, BILL[1].qloo_id)).toBe(1);
    expect(comparesFor(preset.requests, BILL[1].qloo_id, BILL[0].qloo_id)).toBe(1);
    expect(comparesFor(preset.requests, BILL[0].qloo_id, BILL[2].qloo_id)).toBe(0);
    expect(comparesFor(preset.requests, BILL[0].qloo_id, null)).toBe(0);
    expect(comparesFor(preset.requests, BILL[0].qloo_id, BILL[0].qloo_id)).toBe(0);
  });

  it("reads nothing it does not hold: an act off the preset, a pair the report does not list, a missing date", () => {
    expect(requestChain(day(), "sprints", "nobody")).toBeNull();
    const unlisted = requestChain(day(), "c", "d")!;
    expect(unlisted.overlap).toBeNull();
    const noEntity = requestChain(day(), "sprints", "f")!;
    expect(noEntity.acts[1].entityId).toBeNull();
    expect(noEntity.acts[1].insights).toBe(0);
    expect(noEntity.acts[1].popularity).toBeNull();
    expect(requestChain(day({ builtAt: null }), "sprints", "katy")!.savedOn).toBeNull();
  });

  it("fetches nothing: it is a pure read of the preset", () => {
    const preset = day({ compare: true });
    const before = JSON.stringify(preset);
    const first = requestChain(preset, "sprints", "katy");
    expect(requestChain(preset, "sprints", "katy")).toEqual(first);
    expect(JSON.stringify(preset)).toBe(before);
  });
});

describe("the block's words (round 37, L85)", () => {
  it("words each line as the round's brief gives it", () => {
    expect(CHAIN_TITLE).toBe("Saved requests and values");
    expect(CHAIN_INVENTED).toBe("Invented day: no Qloo request was made; the acts and figures are invented.");
    expect(shortId("AAAA1111-0000-4000-8000-000000000001")).toBe("AAAA1111…");
    expect(shortId("SHORT")).toBe("SHORT");
    expect(candidatesAsked(3)).toBe("(3 candidates asked)");
    expect(candidatesAsked(1)).toBe("(1 candidate asked)");
    expect(insightsCount(1)).toBe("1 /v2/insights request");
    expect(insightsCount(2)).toBe("2 /v2/insights requests");
    expect(requestNoun(1)).toBe("request");
    expect(requestNoun(3)).toBe("requests");
    expect(overlapLine("99")).toBe("Taste overlap 99 of 100 on this bill (a rank, not attendance) → pair score → Clash Budget Index.");
    expect(compareLine(2)).toBe("2 saved /v2/analysis/compare requests.");
    expect(savedLine("3 Oct 2026")).toBe("Saved 3 Oct 2026.");
  });

  it("prints the saved date in UTC, so the server and every browser print the same day", () => {
    expect(savedOnDate("2026-10-03T00:13:52+00:00")).toBe("3 Oct 2026");
    // 23:30 in Arizona on 2 Oct is 3 Oct in UTC.
    expect(savedOnDate("2026-10-02T23:30:00-07:00")).toBe("3 Oct 2026");
    expect(savedOnDate("not a date")).toBeNull();
    expect(savedOnDate(null)).toBeNull();
  });
});

/** The day with Qloo's matched names added, as backend/scripts/enrich_matched_names.py adds them (invented names). */
const enriched = (options?: Parameters<typeof rawDay>[0], names: Record<string, unknown> = { sprints: "Sprints Band", katy: "Katy J Pearson" }) =>
  parsePreset({ ...rawDay(options), matched_names: names });

/** The day with clash #1's two entity ids set to Glastonbury 2025 Sunday's headline pair (ids only; no other Qloo data). */
const headlineIds = (raw: Record<string, unknown>) =>
  JSON.parse(
    JSON.stringify(raw)
      .replaceAll("AAAA1111-0000-4000-8000-000000000001", "2D309B5E-4AAB-4B4C-9F70-BCDDB12DB708")
      .replaceAll("BBBB2222-0000-4000-8000-000000000002", "3F1B7EC6-EB80-4DD1-A342-EF02D61D0918"),
  ) as Record<string, unknown>;

describe("Qloo's matched names from the saved reading (round 37, L85 enrichment)", () => {
  it("parses matched_names leniently: keeps non-empty strings, drops anything else, and reads a missing field as empty", () => {
    expect(parsePreset(rawDay()).matched_names).toEqual({});
    expect(parsePreset({ ...rawDay(), matched_names: ["Sprints"] }).matched_names).toEqual({});
    expect(enriched({}, { sprints: "Sprints Band", katy: 7, c: "  ", d: null }).matched_names).toEqual({ sprints: "Sprints Band" });
  });

  it("gives each act the name Qloo's saved /search returned for its entity", () => {
    const [a, b] = requestChain(enriched(), "sprints", "katy")!.acts;
    expect(a.matchedName).toBe("Sprints Band");
    expect(b.matchedName).toBe("Katy J Pearson");
    expect(matchedNames([a, b])).toBe("Sprints as “Sprints Band”; Katy J Pearson as “Katy J Pearson”.");
    expect(MATCHED_LABEL).toBe("Qloo’s search match, from the saved reading:");
  });

  it("says no match for an act without one, and gives no line when neither act has a name (so the old line stands)", () => {
    const chain = requestChain(enriched({}, { katy: "Katy J Pearson" }), "sprints", "katy")!;
    expect(matchedNames(chain.acts)).toBe("Sprints: no match; Katy J Pearson as “Katy J Pearson”.");
    expect(matchedNames(requestChain(day(), "sprints", "katy")!.acts)).toBeNull();
  });

  it("explains the headline pair's empty tags from its saved compare, and only where the compare was saved and no tag kept", () => {
    const chain = requestChain(parsePreset(headlineIds({ ...rawDay({ compare: true, tags: 0 }), matched_names: { sprints: "Sprints" } })), "sprints", "katy")!;
    expect(chain.untaggedReason).toBe(
      "No shared genre tags: the saved compare returned only audience and instrument tags, which this app does not count.",
    );
    expect(tagsLine(chain)).toBe(chain.untaggedReason);
    const noCompare = requestChain(parsePreset(headlineIds(rawDay({ compare: false }))), "sprints", "katy")!;
    expect(noCompare.untaggedReason).toBeNull();
    expect(tagsLine(noCompare)).toBe("No shared tags are stored here.");
    const tagged = requestChain(parsePreset(headlineIds(rawDay({ compare: true, tags: 3 }))), "sprints", "katy")!;
    expect(tagged.untaggedReason).toBeNull();
    expect(tagsLine(tagged)).toBeNull();
  });

  it("does not explain another pair's empty tags it has not read", () => {
    const chain = requestChain(enriched({ compare: true, tags: 0 }), "sprints", "katy")!;
    expect(chain.untaggedReason).toBeNull();
    expect(tagsLine(chain)).toBe("No shared tags are stored here.");
  });
});
