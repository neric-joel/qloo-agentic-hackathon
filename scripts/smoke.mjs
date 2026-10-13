#!/usr/bin/env node
/**
 * Smoke test for a Clash Control deployment. Run it against the CANDIDATE deployment URLs, and only move an
 * alias once every line prints ok.
 *
 *   node scripts/smoke.mjs <web-origin> [--api <api-origin>] [--pair-check on|off|any] [--local]
 *
 * Before the judging-window switches, run it with --pair-check off (the live pair check is off on the
 * server); once PAIR_CHECK_ENABLED is on and the API is redeployed, run it again with --pair-check on.
 *
 * --local is for a local or clean-clone run (for example http://localhost:3000 --api http://localhost:8000
 * --local): one built preset, or none and the invented day, is enough, the invented day may come first, and
 * no Qloo key is required. A deployment smoke never uses it.
 *
 * Zero dependencies (Node 18 or newer). One line per check; exits 1 when any check fails, 2 on a usage error.
 * Nothing here can reach Qloo or a language model: it reads pages and saved presets, asks for a method that is
 * not allowed, asks the first preset for its lenses and every preset for its decision (saved data, no Qloo
 * request, no limiter slot), asks the first preset's rule search for one set against itself (refused before any
 * search or slot), and sends an empty body to the pair check and to the what-if route, which fail validation
 * before anything is spent, and a 20 KB padded body to the what-if route, which is refused as too large before
 * it is read.
 */

import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 15_000;
const PRESET_MIN_BYTES = 50 * 1024;
const PAIR_CHECK_MODES = ["on", "off", "any"];

const BUDGET_KEYS = ["budget_after", "published_budget"];
// Index points of the day's costliest clash, rounded to one decimal by the server (backend/app/decision.py).
const ONE_DECIMAL_KEYS = ["points"];
const BANNED_KEYS = ["matrix", "affinity", "values"];
const USAGE = "usage: node scripts/smoke.mjs <web-origin> [--api <api-origin>] [--pair-check on|off|any] [--local]";

class CheckFailed extends Error {}

function expect(condition, message) {
  if (!condition) throw new CheckFailed(message);
}

/** At most one decimal place, as the server rounds index points. */
function oneDecimal(value) {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

/**
 * The first problem in a decision body: a number with decimals that is not a budget or one-decimal index points,
 * or a key that holds taste data.
 */
export function decisionProblem(value, key = null) {
  if (typeof value === "number") {
    if (Number.isInteger(value) || BUDGET_KEYS.includes(key)) return null;
    if (ONE_DECIMAL_KEYS.includes(key) && oneDecimal(value)) return null;
    return `a decimal number under ${JSON.stringify(key)}`;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = decisionProblem(item, key);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [name, item] of Object.entries(value)) {
      if (BANNED_KEYS.includes(name)) return `a ${JSON.stringify(name)} key`;
      const found = decisionProblem(item, name);
      if (found) return found;
    }
  }
  return null;
}

function trimOrigin(origin) {
  return origin.replace(/\/+$/, "");
}

/** Run every check against the web origin (and the API origin when given); resolves to the list of results. */
export async function runSmoke({
  web,
  api = null,
  pairCheck = "any",
  local = false,
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

  const healthName = local
    ? "web /api/health is ok with the expected pair check (no Qloo key needed locally)"
    : "web /api/health is ok with a Qloo key and the expected pair check";
  await check(healthName, async () => {
    const page = await request(webOrigin, "/api/health");
    expect(page.status === 200, `status ${page.status}`);
    const body = json(page);
    expect(body.status === "ok", `status field is ${JSON.stringify(body.status)}`);
    if (!local) expect(body.qloo_key_configured === true, "qloo_key_configured is not true");
    if (pairCheck !== "any") {
      const want = pairCheck === "on";
      expect(body.pair_check === want, `pair_check is ${JSON.stringify(body.pair_check)}, expected ${want}`);
    }
  });

  let presetId = null;
  let presetIds = [];
  const minPresets = local ? 1 : 2;
  await check(`web /api/presets lists at least ${minPresets} preset${minPresets === 1 ? "" : "s"}`, async () => {
    const page = await request(webOrigin, "/api/presets");
    expect(page.status === 200, `status ${page.status}`);
    const body = json(page);
    presetIds = Array.isArray(body) ? body.map((item) => item?.id).filter((id) => typeof id === "string") : [];
    presetId = Array.isArray(body) && typeof body[0]?.id === "string" ? body[0].id : null;
    expect(Array.isArray(body) && body.length >= minPresets, `${Array.isArray(body) ? body.length : "no"} presets`);
    expect(presetId, "the first preset has no id");
    expect(presetIds.length === body.length, "a preset has no id");
  });

  const firstName = local
    ? "web first preset is real (over 50 KB) or the invented day, and carries no matrix"
    : "web first preset is real (over 50 KB, not the synthetic day) and carries no matrix";
  await check(firstName, async () => {
    expect(presetId, "no preset id to read");
    const page = await request(webOrigin, `/api/presets/${encodeURIComponent(presetId)}`);
    expect(page.status === 200, `status ${page.status}`);
    const body = json(page);
    expect(!("matrix" in body), "the preset carries a matrix key");
    if (local && body.synthetic === true) return; // a clean clone serves only the invented day
    expect(page.bytes > PRESET_MIN_BYTES, `only ${page.bytes} bytes`);
    expect(body.synthetic !== true, "the server is serving the invented fallback day (presets missing?)");
  });

  await check("web first preset lenses answer 200 and say kind lenses", async () => {
    expect(presetId, "no preset id to read");
    const page = await request(webOrigin, `/api/presets/${encodeURIComponent(presetId)}/lenses`);
    expect(page.status === 200, `status ${page.status}`);
    const body = json(page);
    expect(body.kind === "lenses", `kind is ${JSON.stringify(body.kind)}`);
  });

  await check("web every preset's decision answers 200 with kind decision and no stray decimal", async () => {
    expect(presetIds.length > 0, "no preset id to read");
    for (const id of presetIds) {
      const page = await request(webOrigin, `/api/presets/${encodeURIComponent(id)}/decision`);
      expect(page.status === 200, `${id}: status ${page.status}`);
      const body = json(page);
      expect(body.kind === "decision", `${id}: kind is ${JSON.stringify(body.kind)}`);
      const problem = decisionProblem(body);
      expect(!problem, `${id}: the decision holds ${problem}`);
    }
  });

  await check("web first preset rule-fixes with one set against itself is 422", async () => {
    expect(presetId, "no preset id to read");
    const page = await request(webOrigin, `/api/presets/${encodeURIComponent(presetId)}/rule-fixes?a=x&b=x`);
    expect(page.status === 422, `status ${page.status}`);
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

  await check("web POST first preset what-if with a malformed rule step is 422", async () => {
    expect(presetId, "no preset id to read");
    const page = await request(webOrigin, `/api/presets/${encodeURIComponent(presetId)}/whatif`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moves: [{ rule: { a: "x", b: "x" }, moves: [] }] }),
    });
    expect(page.status === 422, `status ${page.status}`);
  });

  await check("web POST first preset what-if with a 20 KB padded body is 413", async () => {
    expect(presetId, "no preset id to read");
    const page = await request(webOrigin, `/api/presets/${encodeURIComponent(presetId)}/whatif`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"moves": []${" ".repeat(20 * 1024)}}`,
    });
    expect(page.status === 413, `status ${page.status}`);
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
  const options = { web: null, api: null, pairCheck: "any", local: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--local") {
      options.local = true;
    } else if (arg === "--api" || arg === "--pair-check") {
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
    console.error(`${error.message}\n${USAGE}\n--pair-check off before the judging-window switches; on after them.`);
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
