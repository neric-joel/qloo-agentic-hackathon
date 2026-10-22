#!/usr/bin/env node
// A small proxy between the web server and the API, used once by the "browser (invented day)" workflow to make the
// server's decision fetch fail on every load, so the hero's fallback can be measured. No dependencies.
//
//   node .github/scripts/decision-stub.mjs --log <file> [--port 8001] [--upstream http://127.0.0.1:8000] [--hold-ms 6000]
//
// The web dev server is started with BACKEND_URL pointing here. Two kinds of request then arrive:
//
//  - the web server's own fetches (lib/server-summary.ts: the preset list, the preset, its decision). They use Node's
//    fetch, which sends the user-agent "node" and no x-forwarded-host;
//  - the browser's requests, which reach the web server as /api/... and are proxied here by next.config.ts's rewrite.
//    The rewrite forwards the browser's own headers, so they carry the browser's user-agent ("Mozilla/5.0 ...") and
//    gain x-forwarded-host.
//
// The user-agent tells the two apart. Of the web server's own requests, GET /api/presets/{id} answers without its
// "decision" key (the server summary then takes its fallback, a separate GET .../decision), and GET
// /api/presets/{id}/decision is held for longer than the server waits (SUMMARY_TIMEOUT_MS, 4000 ms), then answered.
// Every other request, and every browser request, passes untouched. One line per request goes to the log file.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const STUB_PORT = 8001;
export const UPSTREAM = "http://127.0.0.1:8000";
/** How long the web server's own decision request is held: longer than its 4000 ms wait. */
export const HOLD_MS = 6000;

const PRESET = /^\/api\/presets\/[^/]+$/;
const DECISION = /^\/api\/presets\/[^/]+\/decision$/;

/** One header's value as a string ("" when absent; a repeated header's first value). */
function headerValue(headers, name) {
  const value = headers?.[name];
  if (Array.isArray(value)) return String(value[0] ?? "");
  return value === undefined || value === null ? "" : String(value);
}

/** "browser" when the request carries a browser's user-agent, else "server" (the web server's own fetch). */
export function clientOf(headers) {
  return /\bMozilla\/\d/.test(headerValue(headers, "user-agent")) ? "browser" : "server";
}

/** The request's path, without its query, and which route it is. */
export function routeOf(url) {
  const pathname = new URL(url, "http://stub.invalid").pathname;
  const kind = DECISION.test(pathname) ? "decision" : PRESET.test(pathname) ? "preset" : "other";
  return { path: pathname, kind };
}

/**
 * What the stub does with a request: "strip" the web server's own GET of a preset, "hold" its own GET of a decision,
 * "pass" everything else (every browser request included).
 */
export function planRequest({ method, url, headers }) {
  const client = clientOf(headers);
  const { path: requestPath, kind } = routeOf(url);
  let action = "pass";
  if (client === "server" && method === "GET") {
    if (kind === "decision") action = "hold";
    else if (kind === "preset") action = "strip";
  }
  return { action, client, method, path: requestPath };
}

/** How long to hold a request before forwarding it, in milliseconds (0: at once). */
export function holdFor(plan, holdMs = HOLD_MS) {
  return plan.action === "hold" ? holdMs : 0;
}

/**
 * The headers sent upstream: the request's own, with the host set to the upstream's. A request to strip asks for a
 * plain body (accept-encoding identity) so that it can be read; nothing else is changed.
 */
export function upstreamHeaders(headers, plan, host) {
  const out = { ...headers, host };
  if (plan.action === "strip") out["accept-encoding"] = "identity";
  return out;
}

/** The JSON body without its top-level "decision" key, and whether there was one to remove. */
export function stripDecision(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { text, removed: false };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "decision")) {
    return { text, removed: false };
  }
  delete value.decision;
  return { text: JSON.stringify(value), removed: true };
}

/** The answer to send back for a stripped request, from the upstream's status, headers and whole body. */
export function finishStrip({ status, headers, body }) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""), "utf8");
  if (status !== 200) return { status, headers, body: raw, removed: false };
  const out = stripDecision(raw.toString("utf8"));
  if (!out.removed) return { status, headers, body: raw, removed: false };
  const next = Buffer.from(out.text, "utf8");
  const sent = { ...headers, "content-length": String(next.length) };
  delete sent["transfer-encoding"];
  return { status, headers: sent, body: next, removed: true };
}

const FIELDS = ["time", "action", "client", "method", "path", "detail"];

/** One log line: "<time> <action> <client> <method> <path> <detail> ua=<first word of the user-agent>". */
export function formatLogLine({ time, action, client, method, path: requestPath, detail, ua }) {
  const word = String(ua ?? "").trim().split(/\s+/)[0] || "-";
  const parts = [time, action, client, method, requestPath, detail || "-", `ua=${word}`];
  return parts.map((part) => String(part).replace(/\s+/g, "_")).join(" ");
}

/** A log line read back, or null for anything that is not one. */
export function parseLogLine(line) {
  const parts = String(line ?? "").trim().split(" ");
  if (parts.length !== 7 || !parts[6].startsWith("ua=")) return null;
  const entry = Object.fromEntries(FIELDS.map((field, index) => [field, parts[index]]));
  if (!["strip", "hold", "pass"].includes(entry.action) || !["server", "browser"].includes(entry.client)) return null;
  return { ...entry, ua: parts[6].slice(3) };
}

/**
 * What a run of log entries shows: presets stripped and decisions held on the web server's own requests, and requests
 * passed for the browser and for the server. Entries that did not parse (null) are ignored.
 */
export function tally(entries) {
  const counts = { stripped: 0, held: 0, passedBrowser: 0, passedServer: 0 };
  for (const entry of entries) {
    if (!entry) continue;
    const { kind } = routeOf(entry.path);
    if (entry.action === "strip" && entry.client === "server" && kind === "preset") counts.stripped += 1;
    else if (entry.action === "hold" && entry.client === "server" && kind === "decision") counts.held += 1;
    else if (entry.action === "pass" && entry.client === "browser") counts.passedBrowser += 1;
    else if (entry.action === "pass" && entry.client === "server") counts.passedServer += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// The proxy itself (runs only when this file is the program, never on import)
// ---------------------------------------------------------------------------

function serve({ port, upstream, logFile, holdMs }) {
  const target = new URL(upstream);
  const log = (plan, detail, ua) => {
    const line = formatLogLine({ time: new Date().toISOString(), ...plan, detail, ua });
    fs.appendFileSync(logFile, `${line}\n`);
  };

  const forward = (req, res, plan) => {
    const headers = upstreamHeaders(req.headers, plan, target.host);
    const upstreamRequest = http.request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers },
      (answer) => {
        if (plan.action === "strip") {
          const chunks = [];
          answer.on("data", (chunk) => chunks.push(chunk));
          answer.on("end", () => {
            const out = finishStrip({ status: answer.statusCode, headers: answer.headers, body: Buffer.concat(chunks) });
            res.writeHead(out.status, out.headers);
            res.end(out.body);
            const logged = out.removed ? plan : { ...plan, action: "pass" };
            log(logged, `${answer.statusCode}:${out.removed ? "decision-removed" : "no-decision"}`, req.headers["user-agent"]);
          });
          return;
        }
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
        if (plan.action === "pass") log(plan, String(answer.statusCode), req.headers["user-agent"]);
      },
    );
    upstreamRequest.on("error", (error) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("The stub could not reach the API.");
      if (plan.action !== "hold") log({ ...plan, action: "pass" }, `502:${error.code ?? "upstream-error"}`, req.headers["user-agent"]);
    });
    if (req.method === "GET" || req.method === "HEAD") upstreamRequest.end();
    else req.pipe(upstreamRequest);
  };

  const server = http.createServer((req, res) => {
    const plan = planRequest({ method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers });
    const wait = holdFor(plan, holdMs);
    if (wait === 0) {
      forward(req, res, plan);
      return;
    }
    // Logged when the hold starts, so the log shows it while the web server is still waiting.
    log(plan, `${wait}ms`, req.headers["user-agent"]);
    const timer = setTimeout(() => forward(req, res, plan), wait);
    res.on("close", () => clearTimeout(timer));
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`decision stub on http://127.0.0.1:${port}, forwarding to ${target.origin}; holding decisions ${holdMs} ms; log ${logFile}`);
  });
}

function main() {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: String(STUB_PORT) },
      upstream: { type: "string", default: UPSTREAM },
      log: { type: "string" },
      "hold-ms": { type: "string", default: String(HOLD_MS) },
    },
  });
  if (!values.log) {
    console.error("usage: node .github/scripts/decision-stub.mjs --log <file> [--port 8001] [--upstream http://127.0.0.1:8000] [--hold-ms 6000]");
    process.exit(2);
  }
  const logFile = path.resolve(values.log);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, "");
  serve({ port: Number(values.port), upstream: values.upstream, logFile, holdMs: Number(values["hold-ms"]) });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
