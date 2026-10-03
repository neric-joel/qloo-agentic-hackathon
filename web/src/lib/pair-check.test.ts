import { describe, expect, it } from "vitest";

import {
  agreement,
  matchesPair,
  NETWORK_MESSAGE,
  NO_REQUEST_ID,
  pairCheckBody,
  pairCheckError,
  pairCheckKey,
  parsePairCheck,
  rankingFor,
  rankingsText,
  requestIdLabels,
  savedTagsText,
  tagsAlsoSaved,
  UNREADABLE_MESSAGE,
  unreadablePairCheck,
  verdictText,
} from "./pair-check";
import type { SharedTag } from "./preset";

/** A synthetic answer in the contract's shape. Every name, id and figure is invented. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    preset_id: "example-day",
    fetched_at: "2026-10-06T14:02:11Z",
    a: { act_id: "act-one", name: "Act One" },
    b: { act_id: "act-two", name: "Act Two" },
    taste_overlap: { live: 0.9189, saved: 0.9189 },
    rankings: [
      { for_act_id: "act-one", partner_act_id: "act-two", position: 3, of: 38 },
      { for_act_id: "act-two", partner_act_id: "act-one", position: 5, of: 38 },
    ],
    tags: [
      { name: "Folk", kind: "urn:tag:genre:music", score: 0.61 },
      { name: "Indie", kind: null, score: null },
    ],
    requests: [
      liveRequest("/v2/insights", { "signal.interests.entities": "E-1", "filter.results.entities": "E-2,E-3" }, "req-a"),
      liveRequest("/v2/insights", { "signal.interests.entities": "E-2" }, "req-b"),
      liveRequest("/v2/analysis/compare", { "a.signal.interests.entities": ["E-1"], take: 50 }, "req-c"),
    ],
    ...overrides,
  };
}

function liveRequest(path: string, params: Record<string, unknown>, requestId: string): Record<string, unknown> {
  return { path, params, status: 200, latency_ms: 412, cached: false, recorded: false, request_id: requestId };
}

function withRequest(index: number, change: Record<string, unknown>): Record<string, unknown> {
  const valid = body();
  const requests = (valid.requests as Record<string, unknown>[]).map((request, i) =>
    i === index ? { ...request, ...change } : request,
  );
  return { ...valid, requests };
}

describe("parsePairCheck", () => {
  it("reads a valid answer", () => {
    const check = parsePairCheck(body());
    expect(check).not.toBeNull();
    expect(check?.presetId).toBe("example-day");
    expect(check?.fetchedAt).toBe("2026-10-06T14:02:11Z");
    expect(check?.a).toEqual({ actId: "act-one", name: "Act One" });
    expect(check?.b).toEqual({ actId: "act-two", name: "Act Two" });
    expect(check?.overlap).toEqual({ live: 0.9189, saved: 0.9189 });
    expect(check?.rankings[0]).toEqual({ forActId: "act-one", partnerActId: "act-two", position: 3, of: 38 });
    expect(check?.tags).toEqual([
      { name: "Folk", kind: "urn:tag:genre:music", score: 0.61 },
      { name: "Indie", kind: null, score: null },
    ]);
  });

  it("keeps the requests in order with their flags and ids as sent", () => {
    const check = parsePairCheck(body());
    expect(check?.requests.map((r) => r.path)).toEqual(["/v2/insights", "/v2/insights", "/v2/analysis/compare"]);
    expect(check?.requests.map((r) => r.request_id)).toEqual(["req-a", "req-b", "req-c"]);
    expect(check?.requests.every((r) => r.cached === false && r.recorded === false)).toBe(true);
    expect(check?.requests[0].latency_ms).toBe(412);
    // Lists and numbers in the parameters are flattened to the strings the trace prints.
    expect(check?.requests[2].params).toEqual({ "a.signal.interests.entities": "E-1", take: "50" });
  });

  it("accepts a request Qloo sent no id for, and labels it as not supplied", () => {
    for (const missing of [null, undefined, ""]) {
      const check = parsePairCheck(withRequest(1, { request_id: missing }));
      expect(check, String(missing)).not.toBeNull();
      expect(check?.requests[1]).not.toHaveProperty("request_id");
      expect(check && requestIdLabels(check)).toEqual(["req-a", NO_REQUEST_ID, "req-c"]);
    }
    expect(NO_REQUEST_ID).toBe("request id not supplied");
    const all = parsePairCheck(body());
    expect(all && requestIdLabels(all)).toEqual(["req-a", "req-b", "req-c"]);
    // An id that is not a string still breaks the contract.
    expect(parsePairCheck(withRequest(0, { request_id: 42 }))).toBeNull();
  });

  it("gives null for a missing field", () => {
    for (const key of ["preset_id", "fetched_at", "a", "b", "taste_overlap", "rankings", "tags", "requests"]) {
      const partial = body();
      delete partial[key];
      expect(parsePairCheck(partial), key).toBeNull();
    }
    expect(parsePairCheck(body({ a: { act_id: "act-one" } }))).toBeNull();
    expect(parsePairCheck(body({ taste_overlap: { live: 0.5 } }))).toBeNull();
    expect(parsePairCheck(withRequest(1, { cached: undefined }))).toBeNull();
    expect(parsePairCheck(withRequest(0, { latency_ms: undefined }))).toBeNull();
  });

  it("gives null when any request is cached or recorded, so it is never shown as live", () => {
    expect(parsePairCheck(withRequest(0, { cached: true }))).toBeNull();
    expect(parsePairCheck(withRequest(2, { recorded: true }))).toBeNull();
    expect(parsePairCheck(withRequest(1, { recorded: "yes" }))).toBeNull();
  });

  it("gives null for answers that break the contract's figures", () => {
    expect(parsePairCheck(body({ taste_overlap: { live: 1.2, saved: 0.9 } }))).toBeNull();
    expect(parsePairCheck(body({ taste_overlap: { live: "0.9", saved: 0.9 } }))).toBeNull();
    expect(parsePairCheck(body({ fetched_at: "not a date" }))).toBeNull();
    expect(parsePairCheck(body({ b: { act_id: "act-one", name: "Act One" } }))).toBeNull();
    expect(
      parsePairCheck(body({ rankings: [{ for_act_id: "act-one", partner_act_id: "act-two", position: 3, of: 38 }] })),
    ).toBeNull();
    expect(
      parsePairCheck(
        body({
          rankings: [
            { for_act_id: "act-one", partner_act_id: "act-two", position: 40, of: 38 },
            { for_act_id: "act-two", partner_act_id: "act-one", position: 5, of: 38 },
          ],
        }),
      ),
    ).toBeNull();
    const two = body();
    two.requests = (two.requests as unknown[]).slice(0, 2);
    expect(parsePairCheck(two)).toBeNull();
  });

  it("gives null for garbage and never throws", () => {
    for (const garbage of [null, undefined, "ok", 42, [], [body()], { detail: "Pick two different sets." }]) {
      expect(parsePairCheck(garbage)).toBeNull();
    }
    let deep: unknown = {};
    for (let i = 0; i < 10_000; i += 1) deep = { params: deep };
    expect(() => parsePairCheck(body({ requests: [deep, deep, deep] }))).not.toThrow();
  });

  it("drops unusable tags and keeps an empty tag list", () => {
    expect(parsePairCheck(body({ tags: [] }))?.tags).toEqual([]);
    expect(parsePairCheck(body({ tags: [{ name: "" }, { kind: "x" }, "Folk", { name: "Folk" }] }))?.tags).toEqual([
      { name: "Folk", kind: null, score: null },
    ]);
  });
});

describe("matchesPair and rankingFor", () => {
  const check = parsePairCheck(body());

  it("matches the same day and pair in either order only", () => {
    if (!check) throw new Error("fixture must parse");
    expect(matchesPair(check, "example-day", "act-one", "act-two")).toBe(true);
    expect(matchesPair(check, "example-day", "act-two", "act-one")).toBe(true);
    expect(matchesPair(check, "other-day", "act-one", "act-two")).toBe(false);
    expect(matchesPair(check, "example-day", "act-one", "act-three")).toBe(false);
  });

  it("finds each direction's ranking", () => {
    if (!check) throw new Error("fixture must parse");
    expect(rankingFor(check, "act-two", "act-one")?.position).toBe(5);
    expect(rankingFor(check, "act-one", "act-three")).toBeNull();
  });
});

describe("pairCheckBody", () => {
  it("is a JSON object with the day and the two acts and nothing else", () => {
    const text = pairCheckBody("example-day", "act-one", "act-two");
    expect(text).toBe('{"preset":"example-day","a":"act-one","b":"act-two"}');
    expect(Object.keys(JSON.parse(text))).toEqual(["preset", "a", "b"]);
  });

  it("keeps characters a query string would mangle exactly as given", () => {
    const parsed = JSON.parse(pairCheckBody("day & night", "a+b", 'say "hi"?'));
    expect(parsed).toEqual({ preset: "day & night", a: "a+b", b: 'say "hi"?' });
  });
});

describe("pairCheckError", () => {
  it("uses the server's text for each refusal", () => {
    expect(pairCheckError(429, { detail: "Too many live checks this hour. Please try again later." })).toEqual({
      kind: "capped",
      message: "Too many live checks this hour. Please try again later.",
    });
    expect(pairCheckError(503, { detail: "Live checks are switched off on this server." })).toEqual({
      kind: "paused",
      message: "Live checks are switched off on this server.",
    });
    expect(pairCheckError(404, { detail: "That set is not on this festival day." }).kind).toBe("unavailable");
    expect(pairCheckError(422, { detail: "Pick two different sets." })).toEqual({
      kind: "unavailable",
      message: "Pick two different sets.",
    });
  });

  it("falls back to a plain text without a usable detail", () => {
    for (const status of [429, 503, 404, 422]) {
      for (const detail of [undefined, null, "", [{ msg: "field required" }], "x".repeat(301)]) {
        const error = pairCheckError(status, detail === undefined ? {} : { detail });
        expect(error.message.length).toBeGreaterThan(0);
        expect(error.message).not.toContain("field required");
        expect(error.message).not.toContain("xxx");
      }
    }
    expect(pairCheckError(429, null).message).toBe("Too many live checks right now. Please try again later.");
    expect(pairCheckError(422, "<html>").message).toBe("This pair cannot be re-checked.");
    // A server without the route answers with the framework's own text, which is not a refusal.
    expect(pairCheckError(404, { detail: "Not Found" })).toEqual({
      kind: "unavailable",
      message: "This pair cannot be re-checked.",
    });
    expect(pairCheckError(404, { detail: "No preset 'x'." }).message).toBe("No preset 'x'.");
  });

  it("treats any other status, and no response, as a network failure", () => {
    for (const status of [0, 400, 500, 502, 504, 200]) {
      expect(pairCheckError(status, { detail: "Traceback (most recent call last)" })).toEqual({
        kind: "network",
        message: NETWORK_MESSAGE,
      });
    }
  });

  it("words an unreadable answer without blaming the network", () => {
    expect(unreadablePairCheck()).toEqual({ kind: "network", message: UNREADABLE_MESSAGE });
  });
});

describe("agreement", () => {
  it("is the same when both print the same whole number", () => {
    expect(agreement(0.9189, 0.9189)).toEqual({ kind: "same", points: 0, direction: null });
    expect(agreement(0.9151, 0.9249)).toEqual({ kind: "same", points: 0, direction: null });
  });

  it("counts the printed points below and above", () => {
    expect(agreement(0.9, 0.92)).toEqual({ kind: "differs", points: 2, direction: "below" });
    expect(agreement(0.9349, 0.9249)).toEqual({ kind: "differs", points: 1, direction: "above" });
  });
});

describe("tagsAlsoSaved", () => {
  const tag = (name: string): SharedTag => ({ name, kind: null, score: null });

  it("counts the live tags that are also saved, by name", () => {
    expect(tagsAlsoSaved([tag("Folk"), tag("Indie"), tag("Jazz")], [tag("indie"), tag("Folk"), tag("Soul")])).toBe(2);
    expect(tagsAlsoSaved([tag("Folk"), tag("Folk")], [tag("Folk")])).toBe(1);
    expect(tagsAlsoSaved([tag("urn:tag:genre:music:post_punk"), tag("Art-Rock")], [tag("Post Punk"), tag("Art Rock")])).toBe(2);
  });

  it("is zero when either list is empty", () => {
    expect(tagsAlsoSaved([tag("Folk")], [])).toBe(0);
    expect(tagsAlsoSaved([], [tag("Folk")])).toBe(0);
  });
});

describe("wording", () => {
  it("keys a check by festival day and pair", () => {
    expect(pairCheckKey("example-day", "act-one", "act-two")).toBe("example-day:act-one|act-two");
  });

  it("states the verdict for the same number and for a difference", () => {
    expect(verdictText(agreement(0.92, 0.9189))).toBe("Same number as the saved result. Nothing on the page changed.");
    expect(verdictText(agreement(0.9, 0.92))).toBe(
      "2 points below the saved result. Qloo’s answers can change over time; the page keeps the saved number so every figure on it stays comparable. Nothing on the page changed.",
    );
    expect(verdictText(agreement(0.93, 0.92))).toMatch(/^1 point above the saved result\. /);
  });

  it("says where each act came in the other's ranking", () => {
    const check = parsePairCheck(body());
    if (!check) throw new Error("fixture must parse");
    expect(rankingsText(check)).toBe(
      "Qloo scored 38 acts for Act One’s audience, including a few unrelated control acts: Act Two came 3rd. For Act Two’s audience, Act One came 5th.",
    );
    const uneven = parsePairCheck(
      body({
        rankings: [
          { for_act_id: "act-one", partner_act_id: "act-two", position: 1, of: 38 },
          { for_act_id: "act-two", partner_act_id: "act-one", position: 12, of: 37 },
        ],
      }),
    );
    if (!uneven) throw new Error("fixture must parse");
    expect(rankingsText(uneven)).toMatch(/Act Two came 1st\. For Act Two’s audience, Act One came 12th of 37\.$/);
  });

  it("counts the tags that are also saved", () => {
    expect(savedTagsText(2, 6)).toBe("2 of these 6 also appear in the saved tags.");
    expect(savedTagsText(0, 3)).toBe("0 of these 3 also appear in the saved tags.");
    expect(savedTagsText(1, 7)).toBe("1 of these 7 also appears in the saved tags.");
    expect(savedTagsText(1, 1)).toBe("This tag also appears in the saved tags.");
    expect(savedTagsText(0, 1)).toBe("This tag does not appear in the saved tags.");
  });
});
