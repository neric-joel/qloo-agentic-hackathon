#!/usr/bin/env node
/**
 * Smoke test for a Clash Control deployment. Run it against the CANDIDATE deployment URLs, and only move an
 * alias once every line prints ok.
 *
 *   node scripts/smoke.mjs <web-origin> [--api <api-origin>] [--pair-check on|off|any]
 *
 * Zero dependencies (Node 18 or newer). One line per check; exits 1 when any check fails, 2 on a usage error.
 * Nothing here can reach Qloo or a language model: it reads pages and saved presets, asks for a method that is
 * not allowed, asks the first preset for its lenses (saved data, no Qloo request), and sends an empty body to the
 * pair check and to the what-if route, which fail validation before anything is spent (no limiter slot, no Qloo).
 */

import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 15_000;
const PRESET_MIN_BYTES = 50 * 1024;
const PAIR_CHECK_MODES = ["on", "off", "any"];

class CheckFailed extends Error {}

function expect(condition, message) {
  if (!condition) throw new CheckFailed(message);
}

function trimOrigin(origin) {
  return origin.replace(/\/+$/, "");
}

/** Run every check against the web origin (and the API origin when given); resolves to the list of results. */
export async function runSmoke({
  web,
  api = null,
  pairCheck = "any",
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
  log = () => {},
}) {
  const webOrigin = trimOrigin(web);
  const apiOrigin = api ? trimOrigin(api) : null;
  const results = [];

  async function request(origin, path, init = {}) {
    const response = await fetchImpl(origin + path, {
      ...init,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return { status: response.status, text, bytes: Buffer.byteLength(text) };
  }

  async function check(name, body) {
    let result;
    try {
      await body();
      result = { name, ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result = { name, ok: false, reason: error?.name === "TimeoutError" ? `no answer in ${timeoutMs} ms` : reason };
    }
    results.push(result);
    log(result.ok ? `ok    ${name}` : `FAIL  ${name}: ${result.reason}`);
  }

  function skip(name, why) {
    results.push({ name, ok: true, skipped: true });
    log(`skip  ${name} (${why})`);
  }

  function json(page) {
    try {
      return JSON.parse(page.text);
    } catch {
      throw new CheckFailed("the answer is not JSON");
    }
  }

  await check("web / answers 200 with the page heading", async () => {
    const page = await request(webOrigin, "/");
    expect(page.status === 200, `status ${page.status}`);
    expect(page.text.includes("<h1"), "no <h1 in the page");
    expect(page.text.includes("Clash Control"), 'no "Clash Control" in the page');
  });

  await check("web /method answers 200 with the test result", async () => {
    const page = await request(webOrigin, "/method");
    expect(page.status === 200, `status ${page.status}`);
    expect(page.text.includes("The test we set before building failed"), "the method page lacks its headline");
  });

  await check("web /brief answers 200", async () => {
    const page = await request(webOrigin, "/brief");
    expect(page.status === 200, `status ${page.status}`);
  });

  await check("web /api/health is ok with a Qloo key and the expected pair check", async () => {
    const page = await request(webOrigin, "/api/health");
    expect(page.status === 200, `status ${page.status}`);
    const body = json(page);
    expect(body.status === "ok", `status field is ${JSON.stringify(body.status)}`);
    expect(body.qloo_key_configured === true, "qloo_key_configured is not true");
    if (pairCheck !== "any") {
      const want = pairCheck === "on";
      expect(body.pair_check === want, `pair_check is ${JSON.stringify(body.pair_check)}, expected ${want}`);
    }
  });

  let presetId = null;
  await check("web /api/presets lists at least 2 presets", async () => {
    const page = await request(webOrigin, "/api/presets");
    expect(page.status === 200, `status ${page.status}`);
    const body = json(page);
    presetId = Array.isArray(body) && typeof body[0]?.id === "string" ? body[0].id : null;
    expect(Array.isArray(body) && body.length >= 2, `${Array.isArray(body) ? body.length : "no"} presets`);
    expect(presetId, "the first preset has no id");
  });

  await check("web first preset is over 50 KB and carries no matrix", async () => {
    expect(presetId, "no preset id to read");
    const page = await request(webOrigin, `/api/presets/${encodeURIComponent(presetId)}`);
    expect(page.status === 200, `status ${page.status}`);
    expect(page.bytes > PRESET_MIN_BYTES, `only ${page.bytes} bytes`);
    const body = json(page);
    expect(!("matrix" in body), "the preset carries a matrix key");
  });

  await check("web first preset lenses answer 200 and say kind lenses", async () => {
    expect(presetId, "no preset id to read");
    const page = await request(webOrigin, `/api/presets/${encodeURIComponent(presetId)}/lenses`);
    expect(page.status === 200, `status ${page.status}`);
    const body = json(page);
    expect(body.kind === "lenses", `kind is ${JSON.stringify(body.kind)}`);
  });

  await check("web POST first preset what-if with a malformed plan is 422", async () => {
    expect(presetId, "no preset id to read");
    const page = await request(webOrigin, `/api/presets/${encodeURIComponent(presetId)}/whatif`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moves: "not-a-list" }),
    });
    expect(page.status === 422, `status ${page.status}`);
  });

  await check("web GET /api/pair is 405", async () => {
    const page = await request(webOrigin, "/api/pair");
    expect(page.status === 405, `status ${page.status}`);
  });

  await check("web POST /api/pair with an empty body is 422", async () => {
    const page = await request(webOrigin, "/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(page.status === 422, `status ${page.status}`);
  });

  if (apiOrigin) {
    await check("api /api/health answers 200", async () => {
      const page = await request(apiOrigin, "/api/health");
      expect(page.status === 200, `status ${page.status}`);
    });
    await check("api /docs is off (404)", async () => {
      const page = await request(apiOrigin, "/docs");
      expect(page.status === 404, `status ${page.status}`);
    });
  } else {
    skip("api /api/health answers 200", "no --api given");
    skip("api /docs is off (404)", "no --api given");
  }

  return results;
}

export function parseArgs(argv) {
  const options = { web: null, api: null, pairCheck: "any" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--api" || arg === "--pair-check") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      if (arg === "--api") options.api = value;
      else if (PAIR_CHECK_MODES.includes(value)) options.pairCheck = value;
      else throw new Error("--pair-check takes on, off or any");
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else if (options.web === null) {
      options.web = arg;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (options.web === null) throw new Error("the web origin is required");
  for (const origin of [options.web, options.api]) {
    if (origin !== null && !/^https?:\/\/[^/]+/i.test(origin)) throw new Error(`not an origin: ${origin}`);
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\nusage: node scripts/smoke.mjs <web-origin> [--api <api-origin>] [--pair-check on|off|any]`);
    process.exit(2);
  }
  const results = await runSmoke({ ...options, log: (line) => console.log(line) });
  const failed = results.filter((result) => !result.ok).length;
  console.log(failed === 0 ? "smoke: all checks passed" : `smoke: ${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
