import { describe, expect, it } from "vitest";

import {
  buildSetViews,
  clashKey,
  dayName,
  daysWithSets,
  describeDayRank,
  festivalLabel,
  festivalName,
  formatDraw,
  formatOverlap,
  formatPercent,
  formatShare,
  heroClash,
  hiddenReason,
  hostOf,
  isFixedByLocks,
  isWebUrl,
  leadingTags,
  ordinal,
  partnerOf,
  popularitySpread,
  receiptFor,
  requestsForActs,
  sourceLabel,
  TAG_LIMIT,
  tagLabel,
  topClashes,
  traceToolCalls,
  withoutTasteLine,
} from "./clashes";
import type { QlooRequestRecord } from "./events";
import { rawTinyPreset } from "./fixtures/tiny-preset";
import { parsePreset, type Act, type Evidence, type PairClash } from "./preset";

const preset = parsePreset(rawTinyPreset());

function record(path: string, params: Record<string, string>): QlooRequestRecord {
  return { path, params, status: 200, latency_ms: Number.NaN, cached: false, recorded: true };
}

describe("formatting", () => {
  it("formats percentages, shares and draw", () => {
    expect(formatPercent(0.9865)).toBe("99%");
    expect(formatPercent(1.2)).toBe("100%");
    expect(formatPercent(0.0353, 1)).toBe("3.5%");
    expect(formatShare(0.0353)).toBe("3.5%");
    expect(formatShare(0.29)).toBe("29%");
    expect(formatDraw(0.9722)).toBe("97");
  });

  it("turns tag ids into names and leaves names alone", () => {
    expect(tagLabel("urn:tag:genre:dream_pop")).toBe("Dream Pop");
    expect(tagLabel("urn:tag:genre:music:post_punk")).toBe("Post Punk");
    expect(tagLabel("indie")).toBe("Indie");
    expect(tagLabel("Hip Hop")).toBe("Hip Hop");
  });

  it("spells out day labels and drops a trailing day from festival names", () => {
    expect(dayName("Sun")).toBe("Sunday");
    expect(dayName("sat.")).toBe("Saturday");
    expect(dayName("Day 2")).toBe("Day 2");
    expect(festivalName({ name: "Riot Fest 2026, Sun", days: ["Sun"] })).toBe("Riot Fest 2026");
    expect(festivalName({ name: "Lanternfield", days: ["Sat"] })).toBe("Lanternfield");
    expect(festivalName({ name: "Sun", days: ["Sun"] })).toBe("Sun");
  });

  it("names festivals from their ids", () => {
    expect(festivalLabel("outside-lands-2026")).toBe("Outside Lands 2026");
    expect(festivalLabel("coachella-2026-w1")).toBe("Coachella 2026 W1");
  });

  it("reads hosts and only accepts web links", () => {
    expect(hostOf("https://www.nme.com/features/x")).toBe("nme.com");
    expect(hostOf("not a url")).toBe("not a url");
    expect(isWebUrl("https://example.com")).toBe(true);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl(null)).toBe(false);
  });

  it("prints taste overlap out of 100, never as a percent", () => {
    expect(formatOverlap(0.9865)).toBe("99");
    expect(formatOverlap(0.2703)).toBe("27");
    expect(formatOverlap(1.2)).toBe("100");
    expect(formatOverlap(-1)).toBe("0");
  });

  it("writes ordinals, including the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
      "111th",
    ]);
    expect(ordinal(0)).toBe("0th");
    expect(ordinal(112)).toBe("112th");
  });

  it("describes a rank among a day's clashes in words", () => {
    expect(describeDayRank(0.941)).toBe("94th percentile of that day's clashes");
    expect(describeDayRank(0.862)).toBe("86th percentile of that day's clashes");
    expect(describeDayRank(0.412)).toBe("41st percentile of that day's clashes");
    expect(describeDayRank(0.994)).toBe("99th percentile of that day's clashes");
    expect(describeDayRank(0.995)).toBe("highest of that day's clashes");
    expect(describeDayRank(1)).toBe("highest of that day's clashes");
  });

  it("labels fan forums apart from the press", () => {
    expect(sourceLabel("https://www.reddit.com/comments/1vevkfi/")).toBe("Forum");
    expect(sourceLabel("https://old.reddit.com/r/festivals/")).toBe("Forum");
    expect(sourceLabel("https://reddit.com/r/x")).toBe("Forum");
    expect(sourceLabel("https://www.nme.com/features/x")).toBe("Press");
    expect(sourceLabel("https://notreddit.com/x")).toBe("Press");
  });
});

describe("popularitySpread", () => {
  const act = (id: string, popularity: number | null): Act => ({
    id,
    name: id,
    qloo_id: null,
    popularity,
    genre: null,
    billing_tier: 3,
  });

  it("counts acts at or above the cutoff among acts with a Qloo signal", () => {
    const acts = [act("a", 0.99), act("b", 0.9), act("c", 0.89), act("d", null)];
    expect(popularitySpread(acts)).toEqual({ atLeast: 2, total: 3 });
    expect(popularitySpread(acts, 0.95)).toEqual({ atLeast: 1, total: 3 });
    expect(popularitySpread([])).toEqual({ atLeast: 0, total: 0 });
  });
});

describe("leadingTags", () => {
  // Stored as Qloo scored them, highest first; the names are deliberately not alphabetical.
  const tags = ["Folk", "Blues", "Jazz", "Soul", "Spirituals", "Ragtime", "Country", "Funk"].map(
    (name, i) => ({ name, kind: "urn:tag:genre:music", score: 0.98 - i * 0.05 }),
  );

  it("keeps the stored order and shows at most five", () => {
    const { shown, more } = leadingTags(tags);
    expect(TAG_LIMIT).toBe(5);
    expect(shown.map((tag) => tag.name)).toEqual(["Folk", "Blues", "Jazz", "Soul", "Spirituals"]);
    expect(more).toBe(3);
  });

  it("shows every tag when there are five or fewer", () => {
    expect(leadingTags(tags.slice(0, 5))).toEqual({ shown: tags.slice(0, 5), more: 0 });
    expect(leadingTags(tags.slice(0, 2))).toEqual({ shown: tags.slice(0, 2), more: 0 });
    expect(leadingTags([])).toEqual({ shown: [], more: 0 });
  });

  it("takes another limit", () => {
    expect(leadingTags(tags, 3).more).toBe(5);
  });
});

describe("buildSetViews", () => {
  const views = buildSetViews(preset, 0);

  it("orders sets by stage column, then start time", () => {
    expect(views.map((view) => [view.id, view.col])).toEqual([
      ["ann", 0],
      ["cy", 1],
      ["bo", 1],
    ]);
  });

  it("marks coverage and attaches each set's clashes", () => {
    const byId = Object.fromEntries(views.map((view) => [view.id, view]));
    expect(byId.cy.coverage).toBe("none");
    expect(byId.ann.coverage).toBe("strong");
    expect(byId.ann.clashes).toHaveLength(1);
    expect(byId.cy.clashes).toHaveLength(0);
    expect(byId.ann.stage.name).toBe("Main");
  });

  it("returns nothing for a day without sets", () => {
    expect(buildSetViews(preset, 3)).toEqual([]);
    expect(daysWithSets(preset)).toEqual([0]);
  });
});

describe("clash helpers", () => {
  const clash = preset.report.clashes[0];

  it("finds the other act and a stable key", () => {
    expect(partnerOf(clash, "ann").name).toBe("Bo Diddly Squat");
    expect(partnerOf(clash, "bo").name).toBe("Ann Arbor");
    expect(clashKey(clash)).toBe("ann|bo");
  });

  it("finds receipts in either key order", () => {
    expect(receiptFor(preset.evidence, "ann", "bo")?.shared_tags[0].name).toBe("Garage");
    expect(receiptFor(preset.evidence, "bo", "ann")?.shared_tags[0].name).toBe("Garage");
    expect(receiptFor(preset.evidence, "ann", "cy")).toBeNull();
    expect(receiptFor(null, "ann", "bo")).toBeNull();
  });

  it("keeps the costliest clashes of a day, in rank order", () => {
    const make = (rank: number, day: number) => ({ ...clash, rank, day }) satisfies PairClash;
    const ranked = topClashes([make(3, 0), make(1, 0), make(2, 1), make(4, 0)], 0, 2);
    expect(ranked.map((item) => item.rank)).toEqual([1, 3]);
  });
});

describe("heroClash and isFixedByLocks", () => {
  // Invented acts, shaped like a real day: rank 1 has no tags, rank 2 has tags and no label, rank 3
  // has tags and is hidden, rank 5 is between two locked sets.
  const pair = (rank: number, a: string, b: string, label: PairClash["label"] = null): PairClash => ({
    ...preset.report.clashes[0],
    rank,
    day: 0,
    label,
    a: { act_id: a, name: a.toUpperCase(), stage_id: "s1", genre: null },
    b: { act_id: b, name: b.toUpperCase(), stage_id: "s2", genre: null },
  });
  const tag = { name: "Indie rock", kind: "genre", score: 0.9 };
  const evidence: Evidence = {
    hidden_wall: [],
    hidden_wall_total: 0,
    twins: [],
    receipts: {
      "a1|b1": { shared_tags: [], press: null },
      "a2|b2": { shared_tags: [tag], press: null },
      "b3|a3": { shared_tags: [tag, tag], press: null },
      "a4|b4": { shared_tags: [tag], press: null },
      "a5|b5": { shared_tags: [tag], press: null },
    },
  };
  const ranked = [
    pair(1, "a1", "b1", "hidden"),
    pair(2, "a2", "b2"),
    pair(3, "a3", "b3", "hidden"),
    pair(4, "a4", "b4", "hidden"),
    pair(5, "a5", "b5", "hidden"),
    pair(6, "a6", "b6", "hidden"),
  ];
  const locked = (ids: string[]) => (id: string) => ids.includes(id);
  const none = locked([]);

  it("says a clash is fixed only when both sets are locked", () => {
    expect(isFixedByLocks(ranked[0], locked(["a1", "b1"]))).toBe(true);
    expect(isFixedByLocks(ranked[0], locked(["a1"]))).toBe(false);
    expect(isFixedByLocks(ranked[0], none)).toBe(false);
  });

  it("opens the first movable hidden clash with tags, not the untagged costliest one", () => {
    expect(heroClash(ranked, evidence, none)).toEqual({ clash: ranked[2], kind: "hidden" });
    // Tags found in either key order; a locked partner alone does not rule a clash out.
    expect(heroClash(ranked, evidence, locked(["a3"]))?.clash.rank).toBe(3);
  });

  it("skips clashes fixed by locks", () => {
    expect(heroClash(ranked, evidence, locked(["a3", "b3"]))).toEqual({ clash: ranked[3], kind: "hidden" });
  });

  it("falls back to a movable clash with tags, then to the costliest clash", () => {
    const noHidden = ranked.map((item) => ({ ...item, label: null }));
    expect(heroClash(noHidden, evidence, none)).toEqual({ clash: noHidden[1], kind: "evidence" });
    // Like a day with no saved evidence: the costliest clash, rank 1.
    expect(heroClash(ranked, null, none)).toEqual({ clash: ranked[0], kind: "costliest" });
    expect(heroClash(ranked, null, locked(["a1"]))).toEqual({ clash: ranked[0], kind: "costliest" });
  });

  it("looks only at the five costliest clashes", () => {
    const late = { ...evidence, receipts: { "a6|b6": { shared_tags: [tag], press: null } } };
    expect(heroClash(ranked, late, none)).toEqual({ clash: ranked[0], kind: "costliest" });
  });

  it("opens rank 1 when every clash is locked, and nothing on an empty day", () => {
    const all = locked(ranked.flatMap((item) => [item.a.act_id, item.b.act_id]));
    expect(heroClash(ranked, evidence, all)).toEqual({ clash: ranked[0], kind: "costliest" });
    expect(heroClash([], evidence, none)).toBeNull();
  });
});

describe("requestsForActs", () => {
  const acts = [
    { name: "Ann Arbor", qloo_id: "Q-ANN" },
    { name: "Bo Diddly Squat", qloo_id: "Q-BO" },
  ];
  const requests = [
    record("/search", { query: "ann arbor " }),
    record("/search", { query: "Someone Else" }),
    record("/v2/insights", { "signal.interests.entities": "Q-BO", "filter.results.entities": "Q-ANN,Q-X" }),
    record("/v2/insights", { "signal.interests.entities": "Q-X", "filter.results.entities": "Q-ANN,Q-BO" }),
    record("/v2/analysis/compare", { "a.signal.interests.entities": "Q-BO", "b.signal.interests.entities": "Q-ANN" }),
    record("/v2/analysis/compare", { "a.signal.interests.entities": "Q-ANN", "b.signal.interests.entities": "Q-X" }),
  ];

  it("keeps the searches, rankings from either act and comparisons of the two", () => {
    expect(requestsForActs(requests, acts)).toEqual([requests[0], requests[2], requests[4]]);
  });

  it("matches only searches for acts without a Qloo id", () => {
    expect(requestsForActs(requests, [{ name: "Ann Arbor", qloo_id: null }])).toEqual([requests[0]]);
  });
});

describe("traceToolCalls", () => {
  it("groups requests by what they were for, keeping their order", () => {
    const calls = traceToolCalls(
      [
        record("/v2/insights", {}),
        record("/search", { query: "a" }),
        record("/search", { query: "b" }),
        record("/v2/analysis/compare", {}),
        record("/v2/other", {}),
      ],
      "preset",
    );
    expect(calls.map((call) => [call.tool, call.requests.length])).toEqual([
      ["match_acts", 2],
      ["rank_audiences", 1],
      ["compare_audiences", 1],
      ["other_requests", 1],
    ]);
    expect(calls[0].requests.map((r) => r.params.query)).toEqual(["a", "b"]);
    expect(calls.every((call) => call.provenance === "recorded")).toBe(true);
    expect(calls[0].id).toBe("preset-match_acts");
  });

  it("flags a group with a failed request", () => {
    const failed = { ...record("/search", {}), status: 429 };
    expect(traceToolCalls([failed], "x")[0].status).toBe("error");
  });

  it("returns no calls for no requests", () => {
    expect(traceToolCalls([], "x")).toEqual([]);
  });

  it("labels the calls with the provenance it is given, recorded by default", () => {
    const records = [record("/v2/insights", {}), record("/v2/analysis/compare", {}), record("/v2/other", {})];
    expect(traceToolCalls(records, "x").map((call) => call.provenance)).toEqual(["recorded", "recorded", "recorded"]);
    const live = traceToolCalls(records, "live", "qloo");
    expect(live.map((call) => call.provenance)).toEqual(["qloo", "qloo", "qloo"]);
    expect(live.map((call) => call.tool)).toEqual(["rank_audiences", "compare_audiences", "other_requests"]);
  });
});

describe("hiddenReason and withoutTasteLine", () => {
  // Invented acts and genres.
  const base = preset.report.clashes[0];
  const hidden = (aGenre: string | null, bGenre: string | null): PairClash => ({
    ...base,
    label: "hidden",
    audience_overlap: 0.9712,
    a: { act_id: "x1", name: "Act X", stage_id: "s1", genre: aGenre },
    b: { act_id: "y1", name: "Act Y", stage_id: "s2", genre: bGenre },
  });

  it("names both main genre tags and the taste-overlap rank out of 100", () => {
    expect(hiddenReason(hidden("Indie Rock", "Post Punk"))).toBe(
      "Act X: Indie Rock. Act Y: Post Punk. Main genre tags differ, and their taste overlap is 97 of 100, a rank among the acts compared for this bill.",
    );
  });

  it("says when a genre tag was not saved", () => {
    expect(hiddenReason(hidden(null, "  "))).toBe(
      "Act X: no genre tag saved. Act Y: no genre tag saved. Main genre tags differ, and their taste overlap is 97 of 100, a rank among the acts compared for this bill.",
    );
  });

  it("prints the draw-and-time rank as an ordinal, names draw as a Qloo field", () => {
    expect(withoutTasteLine(21)).toBe("On draw and time alone (draw is also a Qloo field) this clash would rank 21st.");
    expect(withoutTasteLine(2)).toBe("On draw and time alone (draw is also a Qloo field) this clash would rank 2nd.");
  });

  it("adds the denominator when the server sends it, and keeps the bare ordinal otherwise", () => {
    expect(withoutTasteLine(21, 68)).toBe(
      "On draw and time alone (draw is also a Qloo field) this clash would rank 21st of 68.",
    );
    expect(withoutTasteLine(21, undefined)).toBe(
      "On draw and time alone (draw is also a Qloo field) this clash would rank 21st.",
    );
    // A denominator smaller than the rank cannot be right: print the bare ordinal.
    expect(withoutTasteLine(21, 5)).toBe("On draw and time alone (draw is also a Qloo field) this clash would rank 21st.");
  });

  it("treats a null from the lens as no cost in that view, never as not concurrent", () => {
    const line = withoutTasteLine(null);
    expect(line).toBe("On draw and time alone this pair would not be ranked: it carries no cost in that view.");
    expect(line).not.toMatch(/concurrent|same time/);
  });

  it("prints nothing without a lens reading or with a rank that is not a whole number from 1", () => {
    expect(withoutTasteLine(undefined)).toBeNull();
    expect(withoutTasteLine(0)).toBeNull();
    expect(withoutTasteLine(2.5)).toBeNull();
    expect(withoutTasteLine(Number.NaN)).toBeNull();
  });
});
