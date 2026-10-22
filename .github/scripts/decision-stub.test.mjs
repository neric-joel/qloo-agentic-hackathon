// Tests for decision-stub.mjs: its decisions only, as pure functions. No socket is opened here.
// Run: node --test .github/scripts/decision-stub.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  HOLD_MS,
  clientOf,
  finishStrip,
  formatLogLine,
  holdFor,
  parseLogLine,
  planRequest,
  routeOf,
  stripDecision,
  tally,
  upstreamHeaders,
} from "./decision-stub.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// What each side sends. The browser's requests reach the stub through the web's /api rewrite, which forwards the
// browser's own headers (user-agent included) and adds x-forwarded-host. The web server's own fetches carry Node's
// default user-agent, "node", and no x-forwarded-host.
const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36";
const PHONE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const SERVER = { "user-agent": "node", accept: "application/json", "accept-encoding": "gzip, deflate" };
const BROWSER = { "user-agent": DESKTOP_UA, accept: "*/*", "accept-encoding": "gzip, br", "x-forwarded-host": "127.0.0.1:3001" };

const ID = "synthetic-lanternfield-friday";

test("the user-agent tells the browser's requests from the web server's own", () => {
  assert.equal(clientOf({ "user-agent": DESKTOP_UA }), "browser");
  assert.equal(clientOf({ "user-agent": PHONE_UA }), "browser");
  assert.equal(clientOf({ "user-agent": "node" }), "server");
  assert.equal(clientOf({ "user-agent": "curl/8.5.0" }), "server");
  assert.equal(clientOf({}), "server", "no user-agent at all is not a browser");
  assert.equal(clientOf({ "user-agent": ["node", "extra"] }), "server");
});

test("routes: the preset itself, its decision, and everything else", () => {
  assert.deepEqual(routeOf(`/api/presets/${ID}`), { path: `/api/presets/${ID}`, kind: "preset" });
  assert.deepEqual(routeOf(`/api/presets/${ID}?fresh=1`), { path: `/api/presets/${ID}`, kind: "preset" });
  assert.deepEqual(routeOf(`/api/presets/${ID}/decision`), { path: `/api/presets/${ID}/decision`, kind: "decision" });
  assert.deepEqual(routeOf(`/api/presets/${ID}/decision?day=0`), { path: `/api/presets/${ID}/decision`, kind: "decision" });
  for (const other of ["/api/presets", "/api/presets/", `/api/presets/${ID}/lenses`, `/api/presets/${ID}/recordings`, "/api/health", "/"]) {
    assert.equal(routeOf(other).kind, "other", other);
  }
});

test("the web server's own preset request is stripped", () => {
  assert.deepEqual(planRequest({ method: "GET", url: `/api/presets/${ID}`, headers: SERVER }), {
    action: "strip",
    client: "server",
    method: "GET",
    path: `/api/presets/${ID}`,
  });
  assert.equal(planRequest({ method: "GET", url: "/api/presets/glastonbury-2025-sun?x=1", headers: SERVER }).action, "strip");
});

test("the web server's own decision request is held for longer than the server waits", () => {
  const plan = planRequest({ method: "GET", url: `/api/presets/${ID}/decision`, headers: SERVER });
  assert.deepEqual(plan, { action: "hold", client: "server", method: "GET", path: `/api/presets/${ID}/decision` });
  assert.equal(holdFor(plan), HOLD_MS);
  assert.equal(holdFor(plan, 7_000), 7_000);
  assert.equal(holdFor(planRequest({ method: "GET", url: `/api/presets/${ID}`, headers: SERVER })), 0);

  // The server's own wait, read from the web app's source: the hold must outlast it, or nothing fails.
  const source = fs.readFileSync(path.join(HERE, "..", "..", "web", "src", "lib", "server-summary.ts"), "utf8");
  const match = /export const SUMMARY_TIMEOUT_MS = (\d[\d_]*);/.exec(source);
  assert.ok(match, "SUMMARY_TIMEOUT_MS is declared in web/src/lib/server-summary.ts");
  const timeout = Number(match[1].replaceAll("_", ""));
  assert.ok(HOLD_MS > timeout, `the hold (${HOLD_MS} ms) outlasts the server's wait (${timeout} ms)`);
});

test("every browser request passes untouched, the preset and its decision included", () => {
  for (const [url, ua] of [
    [`/api/presets/${ID}`, DESKTOP_UA],
    [`/api/presets/${ID}/decision`, DESKTOP_UA],
    [`/api/presets/${ID}/decision`, PHONE_UA],
    ["/api/presets", DESKTOP_UA],
  ]) {
    const headers = { ...BROWSER, "user-agent": ua };
    const plan = planRequest({ method: "GET", url, headers });
    assert.equal(plan.action, "pass", url);
    assert.equal(plan.client, "browser", url);
    assert.equal(holdFor(plan), 0, url);
    // Forwarded with every header as the browser sent it; only the host names the upstream.
    const forwarded = upstreamHeaders(headers, plan, "127.0.0.1:8000");
    assert.deepEqual(forwarded, { ...headers, host: "127.0.0.1:8000" }, url);
  }
  // A body is never read on the way through: the browser's answer is the API's own.
  const plan = planRequest({ method: "POST", url: `/api/presets/${ID}/whatif`, headers: BROWSER });
  assert.equal(plan.action, "pass");
});

test("the web server's other requests pass too", () => {
  for (const [method, url] of [
    ["GET", "/api/presets"],
    ["GET", `/api/presets/${ID}/lenses`],
    ["GET", "/api/health"],
    ["HEAD", `/api/presets/${ID}`],
    ["POST", `/api/presets/${ID}/whatif`],
  ]) {
    assert.equal(planRequest({ method, url, headers: SERVER }).action, "pass", `${method} ${url}`);
  }
});

test("a request to strip asks the API for a plain body, so it can be read", () => {
  const plan = planRequest({ method: "GET", url: `/api/presets/${ID}`, headers: SERVER });
  assert.deepEqual(upstreamHeaders(SERVER, plan, "127.0.0.1:8000"), { ...SERVER, host: "127.0.0.1:8000", "accept-encoding": "identity" });
  assert.equal(SERVER["accept-encoding"], "gzip, deflate", "the request's own headers are not changed");
});

test("stripping removes the decision key and nothing else", () => {
  const preset = { id: ID, title: "Lanternfield Friday (synthetic demo)", synthetic: true, decision: { day: 0, clash: { rank: 1 } }, report: { a: 1 } };
  const out = stripDecision(JSON.stringify(preset));
  assert.equal(out.removed, true);
  const { decision: _dropped, ...rest } = preset;
  assert.deepEqual(JSON.parse(out.text), rest);
  assert.deepEqual(Object.keys(JSON.parse(out.text)), ["id", "title", "synthetic", "report"], "key order kept");

  // A null decision is a key too: it goes, so the server takes its fallback.
  assert.equal(stripDecision(JSON.stringify({ id: ID, decision: null })).removed, true);

  // Nothing to strip: the body is returned as it came.
  for (const text of [JSON.stringify({ id: ID }), "[1,2]", "null", "not json", ""]) {
    const same = stripDecision(text);
    assert.equal(same.removed, false, text);
    assert.equal(same.text, text, text);
  }
});

test("a stripped answer gets a content length that matches its new body", () => {
  const body = Buffer.from(JSON.stringify({ id: ID, title: "Lanternfield’s day", decision: { day: 0 } }), "utf8");
  const out = finishStrip({
    status: 200,
    headers: { "content-type": "application/json", "content-length": String(body.length), "transfer-encoding": "chunked", "cache-control": "public" },
    body,
  });
  assert.equal(out.removed, true);
  assert.equal(out.status, 200);
  assert.deepEqual(JSON.parse(out.body.toString("utf8")), { id: ID, title: "Lanternfield’s day" });
  assert.equal(out.headers["content-length"], String(out.body.length));
  assert.equal(out.headers["transfer-encoding"], undefined);
  assert.equal(out.headers["cache-control"], "public");
  assert.equal(out.headers["content-type"], "application/json");

  // An error answer, or one with no decision, goes back unchanged.
  for (const upstream of [
    { status: 404, headers: { "content-type": "application/json" }, body: Buffer.from('{"detail":"No preset"}') },
    { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(`{"id":"${ID}"}`) },
  ]) {
    const same = finishStrip(upstream);
    assert.equal(same.removed, false);
    assert.equal(same.status, upstream.status);
    assert.deepEqual(same.headers, upstream.headers);
    assert.equal(same.body.toString(), upstream.body.toString());
  }
});

test("the log has one line per request, naming the path and the user-agent class", () => {
  const entry = { time: "2026-10-21T18:00:00.000Z", action: "strip", client: "server", method: "GET", path: `/api/presets/${ID}`, detail: "200:decision-removed", ua: "node" };
  const line = formatLogLine(entry);
  assert.equal(line, `2026-10-21T18:00:00.000Z strip server GET /api/presets/${ID} 200:decision-removed ua=node`);
  assert.ok(!line.includes("\n"));
  assert.deepEqual(parseLogLine(line), entry);

  // The browser's long user-agent is cut to its first word, so a line stays one line of seven fields.
  const browser = formatLogLine({ time: entry.time, action: "pass", client: "browser", method: "GET", path: `/api/presets/${ID}/decision`, detail: "200", ua: DESKTOP_UA });
  assert.deepEqual(parseLogLine(browser), { time: entry.time, action: "pass", client: "browser", method: "GET", path: `/api/presets/${ID}/decision`, detail: "200", ua: "Mozilla/5.0" });
  assert.equal(parseLogLine(formatLogLine({ ...entry, ua: "" })).ua, "-");

  for (const junk of ["", "decision stub listening", "2026 strip server GET"]) assert.equal(parseLogLine(junk), null, junk);
});

test("a load's log shows whether the failure happened: a stripped preset, a held decision, a passed browser request", () => {
  const time = "2026-10-21T18:00:00.000Z";
  const lines = [
    formatLogLine({ time, action: "pass", client: "server", method: "GET", path: "/api/presets", detail: "200", ua: "node" }),
    formatLogLine({ time, action: "strip", client: "server", method: "GET", path: `/api/presets/${ID}`, detail: "200:decision-removed", ua: "node" }),
    formatLogLine({ time, action: "hold", client: "server", method: "GET", path: `/api/presets/${ID}/decision`, detail: "6000ms", ua: "node" }),
    formatLogLine({ time, action: "pass", client: "browser", method: "GET", path: `/api/presets/${ID}/decision`, detail: "200", ua: DESKTOP_UA }),
    "not a log line",
  ];
  assert.deepEqual(tally(lines.map(parseLogLine)), { stripped: 1, held: 1, passedBrowser: 1, passedServer: 1 });
  // A preset that came back with no decision to remove is logged as passed, and does not count as stripped.
  const none = formatLogLine({ time, action: "pass", client: "server", method: "GET", path: `/api/presets/${ID}`, detail: "200:no-decision", ua: "node" });
  assert.deepEqual(tally([parseLogLine(none)]), { stripped: 0, held: 0, passedBrowser: 0, passedServer: 1 });
});
