import { describe, expect, it, vi } from "vitest";

import { parseDecision } from "./decision";
import { rawTinyPreset } from "./fixtures/tiny-preset";
import { parsePreset } from "./preset";
import {
  choosePresetId,
  figureLine,
  loadServerSummary,
  resolveBackendUrl,
  summarize,
  SUMMARY_CLASHES,
} from "./server-summary";

// Every name and figure below is invented for the test (the tiny preset fixture and variants of it).

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function clash(rank: number, a: string, b: string, overrides: Raw = {}): Raw {
  return {
    rank,
    a: { act_id: a.toLowerCase(), name: a, stage_id: "main", genre: null },
    b: { act_id: b.toLowerCase(), name: b, stage_id: "side", genre: null },
    day: 0,
    overlap_minutes: 30,
    concurrency: 1,
    audience_overlap: 0.5,
    draw: 0.5,
    regret: 0.1,
    regret_share: 0.1,
    label: null,
    confidence: "strong",
    ...overrides,
  };
}

/** The tiny preset with seven clashes, so the summary has to cut the list at five. */
function busyPreset(): Raw {
  const raw = rawTinyPreset() as Raw;
  raw.report.clashes = [
    clash(3, "Gil", "Hal"),
    clash(1, "Ann", "Bo", { audience_overlap: 0.9865, draw: 0.9722, regret_share: 0.291 }),
    clash(2, "Cy", "Di", { regret_share: 0.035 }),
    clash(4, "Ed", "Flo"),
    clash(5, "Ivy", "Jo"),
    clash(6, "Kit", "Lu"),
    clash(7, "Mo", "Ned"),
  ];
  return raw;
}

describe("summarize", () => {
  it("rounds the index and prints the dial's sentence", () => {
    const summary = summarize(parsePreset(rawTinyPreset()));
    expect(summary.id).toBe("tiny-fest-sat");
    expect(summary.title).toBe("Tiny Fest, Saturday");
    expect(summary.index).toBe(104);
    expect(summary.vsRandom).toBe(
      "By this index, the published timetable scores 104.2, where 100 is the average random valid timetable and higher means more clash cost",
    );
    expect(summary.figure).toBe(`104 on the Clash Budget Index. ${summary.vsRandom}. Lower is better.`);
  });

  it("calls an invented day's timetable invented in the index sentence", () => {
    const summary = summarize(parsePreset({ ...rawTinyPreset(), synthetic: true }));
    expect(summary.vsRandom).toBe(
      "By this index, the invented timetable scores 104.2, where 100 is the average random valid timetable and higher means more clash cost",
    );
    expect(summary.figure).not.toContain("published");
  });

  it("lists the five costliest clashes through the page's formatters", () => {
    const summary = summarize(parsePreset(busyPreset()));
    expect(summary.clashes).toHaveLength(SUMMARY_CLASHES);
    expect(summary.clashes.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(summary.clashes[0]).toEqual({ rank: 1, a: "Ann", b: "Bo", taste: "99", draw: "97", share: "29%" });
    expect(summary.clashes[1].share).toBe("3.5%");
  });

  it("handles fewer than five clashes and none", () => {
    expect(summarize(parsePreset(rawTinyPreset())).clashes).toHaveLength(1);
    const empty = rawTinyPreset() as Raw;
    empty.report.clashes = [];
    const summary = summarize(parsePreset(empty));
    expect(summary.clashes).toEqual([]);
    expect(summary.description).toBe(
      "Tiny Fest Saturday scores 104 on the Clash Budget Index (100 is the average random valid timetable of its lineup; lower is better).",
    );
  });

  it("writes the evidence sentence from the request records and coverage", () => {
    expect(summarize(parsePreset(rawTinyPreset())).evidence).toBe(
      "Priced from 2 saved Qloo request records: 2 of 3 acts matched to Qloo artists; 1 not priced.",
    );
    const full = rawTinyPreset() as Raw;
    full.report.coverage = { ...full.report.coverage, none: 0, unscored: [] };
    full.requests = full.requests.slice(0, 1);
    expect(summarize(parsePreset(full)).evidence).toBe(
      "Priced from 1 saved Qloo request record: 2 of 2 acts matched to Qloo artists.",
    );
  });

  it("describes the day for the meta tags", () => {
    expect(summarize(parsePreset(busyPreset())).description).toBe(
      "Tiny Fest Saturday scores 104 on the Clash Budget Index (100 is the average random valid timetable of its lineup; lower is better). Costliest clashes: Ann and Bo; Cy and Di.",
    );
    expect(summarize(parsePreset(rawTinyPreset())).description).toMatch(/Costliest clash: Ann Arbor and Bo Diddly Squat\.$/);
  });

  it("has no index, sentence or figure without a baseline", () => {
    const raw = rawTinyPreset() as Raw;
    raw.report.metrics.clash_budget_index = null;
    raw.report.baseline = null;
    const summary = summarize(parsePreset(raw));
    expect(summary.index).toBeNull();
    expect(summary.vsRandom).toBeNull();
    expect(summary.figure).toBeNull();
    expect(summary.description).toMatch(/^Tiny Fest Saturday has no Clash Budget Index: /);
  });

  it("carries no forbidden words, ids or raw popularity", () => {
    const summary = summarize(parsePreset(busyPreset()));
    const all = JSON.stringify(summary);
    for (const pattern of [/optimi[sz]/i, /optimal/i, /recommend/i, /validated/i, /predicts/i, /same (crowd|fans|people)/i, /better for/i]) {
      expect(all).not.toMatch(pattern);
    }
    expect(all).not.toContain("Q-ANN");
    expect(all).not.toContain("0.9722");
  });
});

const RAW_DECISION: Raw = {
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

describe("the decision card in the summary", () => {
  it("has none until the route answers", () => {
    const summary = summarize(parsePreset(rawTinyPreset()));
    expect(summary.decision).toBeNull();
    expect(summary.decisionData).toBeNull();
  });

  it("is worded from the route and the preset", () => {
    const summary = summarize(parsePreset(rawTinyPreset()), parseDecision(RAW_DECISION));
    expect(summary.decision?.receipt).toBe("Bo Diddly Squat 60 minutes later: 60 → 0 minutes shared");
    expect(summary.decision?.presetId).toBe("tiny-fest-sat");
    expect(summary.decisionData?.clash?.rank).toBe(1);
  });

  it("is fetched with the preset, and a failed fetch leaves the rest of the summary", async () => {
    const make = (decision: Response | "down") =>
      vi.fn(async (url: string) => {
        if (url.endsWith("/decision")) {
          if (decision === "down") throw new TypeError("fetch failed");
          return decision;
        }
        if (url === "http://api.test/api/presets") {
          return new Response(JSON.stringify([{ id: "tiny-fest-sat", title: "Tiny Fest, Saturday", city: null, sets: 3, stages: 2, scored_share: 0.67 }]), { status: 200 });
        }
        return new Response(JSON.stringify(rawTinyPreset()), { status: 200 });
      });
    const ok = await loadServerSummary(null, { backend: "http://api.test", fetcher: make(new Response(JSON.stringify(RAW_DECISION), { status: 200 })) });
    expect(ok?.decision?.title).toBe("Tiny Fest · Saturday · published timetable");
    for (const failing of ["down", new Response("{}", { status: 500 }), new Response("not json", { status: 200 }), new Response("{}", { status: 200 })] as const) {
      const summary = await loadServerSummary(null, { backend: "http://api.test", fetcher: make(failing) });
      expect(summary?.index).toBe(104);
      expect(summary?.decision).toBeNull();
    }
  });
});

describe("figureLine", () => {
  it("is the dial's sentence on one line", () => {
    expect(figureLine(86.4)).toBe(
      "86 on the Clash Budget Index. By this index, the published timetable scores 86.4, where 100 is the average random valid timetable and higher means more clash cost. Lower is better.",
    );
    expect(figureLine(117, true)).toContain("the invented timetable scores 117.0, where 100");
  });
});

describe("resolveBackendUrl", () => {
  it("matches the rewrite's resolution", () => {
    expect(resolveBackendUrl(undefined)).toBe("http://127.0.0.1:8000");
    expect(resolveBackendUrl("  ")).toBe("http://127.0.0.1:8000");
    expect(resolveBackendUrl("api.example.com/")).toBe("https://api.example.com");
    expect(resolveBackendUrl("http://localhost:9000//")).toBe("http://localhost:9000");
  });
});

describe("choosePresetId", () => {
  const list = [{ id: "first" }, { id: "second" }];
  it("picks the requested preset when the list has it, else the first", () => {
    expect(choosePresetId(list, "second")).toBe("second");
    expect(choosePresetId(list, "missing")).toBe("first");
    expect(choosePresetId(list, null)).toBe("first");
    expect(choosePresetId([], "second")).toBeNull();
  });
});

describe("loadServerSummary", () => {
  function second(): Raw {
    const raw = rawTinyPreset() as Raw;
    raw.id = "other-fest-sun";
    raw.title = "Other Fest, Sunday";
    raw.festival.name = "Other Fest";
    raw.festival.days = ["Sun"];
    raw.report.metrics.clash_budget_index = 86.4;
    return raw;
  }

  function fakeBackend() {
    const list = [
      { id: "tiny-fest-sat", title: "Tiny Fest, Saturday", city: null, sets: 3, stages: 2, scored_share: 0.67 },
      { id: "other-fest-sun", title: "Other Fest, Sunday", city: null, sets: 3, stages: 2, scored_share: 0.67 },
    ];
    const bodies: Record<string, unknown> = {
      "http://api.test/api/presets": list,
      "http://api.test/api/presets/tiny-fest-sat": rawTinyPreset(),
      "http://api.test/api/presets/other-fest-sun": second(),
    };
    return vi.fn(async (url: string) =>
      url in bodies ? new Response(JSON.stringify(bodies[url]), { status: 200 }) : new Response("{}", { status: 404 }),
    );
  }

  it("summarizes the first preset by default", async () => {
    const fetcher = fakeBackend();
    const summary = await loadServerSummary(null, { backend: "http://api.test", fetcher });
    expect(summary?.id).toBe("tiny-fest-sat");
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/api/presets",
      expect.objectContaining({ next: { revalidate: 3600 } }),
    );
  });

  it("summarizes the preset the visitor asked for", async () => {
    const summary = await loadServerSummary("other-fest-sun", { backend: "http://api.test", fetcher: fakeBackend() });
    expect(summary?.id).toBe("other-fest-sun");
    expect(summary?.index).toBe(86);
    expect(summary?.description).toMatch(/^Other Fest Sunday scores 86 /);
  });

  it("falls back to the first preset for an unknown id", async () => {
    const summary = await loadServerSummary("nope", { backend: "http://api.test", fetcher: fakeBackend() });
    expect(summary?.id).toBe("tiny-fest-sat");
  });

  it("is null when the API is down, slow, failing or speaks another shape", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await loadServerSummary(null, { backend: "http://api.test", fetcher: down })).toBeNull();

    const slow = vi.fn(() => new Promise<Response>(() => {}));
    expect(await loadServerSummary(null, { backend: "http://api.test", fetcher: slow, timeoutMs: 10 })).toBeNull();

    const failing = vi.fn(async () => new Response("{}", { status: 500 }));
    expect(await loadServerSummary(null, { backend: "http://api.test", fetcher: failing })).toBeNull();

    const odd = vi.fn(async () => new Response(JSON.stringify({ presets: [] }), { status: 200 }));
    expect(await loadServerSummary(null, { backend: "http://api.test", fetcher: odd })).toBeNull();

    const empty = vi.fn(async () => new Response("[]", { status: 200 }));
    expect(await loadServerSummary(null, { backend: "http://api.test", fetcher: empty })).toBeNull();
  });
});
