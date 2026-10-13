import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { decisionProblem, parseArgs, runSmoke } from "./smoke.mjs";

const SCRIPT = fileURLToPath(new URL("./smoke.mjs", import.meta.url));
const BIG = "x".repeat(60 * 1024);

/** A stub deployment. `broken` names the pieces to get wrong. */
function stubHandler(broken = {}) {
  return (req, res) => {
    const send = (status, body, type = "text/html") => {
      res.writeHead(status, { "content-type": type });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const { method, url } = req;
    if (url === "/") return send(200, broken.noHeading ? "<p>hi</p>" : "<h1>Clash Control</h1>");
    if (url === "/method") {
      return send(200, broken.noMethod ? "<p>x</p>" : "<b>The test we set before building failed.</b>");
    }
    if (url === "/brief") return send(broken.briefStatus ?? 200, "<p>brief</p>");
    if (url === "/api/health" && (method === "GET" || method === "HEAD")) {
      return send(
        200,
        { status: "ok", qloo_key_configured: !broken.noKey, llm_configured: false, pair_check: !!broken.pairOn },
        "application/json",
      );
    }
    if (url === "/api/presets") {
      const list = broken.onePreset ? [{ id: "one" }] : [{ id: "one" }, { id: "two" }];
      return send(200, list, "application/json");
    }
    if (url === "/api/presets/two/decision" && method === "GET") {
      // the second day's costliest clash is worth one-decimal index points, as the server rounds them
      const body = { kind: "decision", published_budget: 98.25, clash: { rank: 1, minutes: 30, points: 5.7 } };
      if (broken.secondDecisionPoints) body.clash.points = 5.75;
      return send(broken.secondDecisionStatus ?? 200, body, "application/json");
    }
    if (url === "/api/presets/one") {
      const body = { id: "one", filler: BIG, ...(broken.matrix ? { matrix: {} } : {}), ...(broken.synthetic ? { synthetic: true } : {}) };
      const small = { id: "one", ...(broken.synthetic ? { synthetic: true } : {}) };
      return send(200, broken.smallPreset ? small : body, "application/json");
    }
    if (url === "/api/presets/one/lenses" && method === "GET") {
      return send(broken.lensesStatus ?? 200, { kind: broken.lensesKind ?? "lenses", day: 0 }, "application/json");
    }
    if (url === "/api/presets/one/decision" && method === "GET") {
      const body = {
        kind: broken.decisionKind ?? "decision",
        published_budget: 116.71,
        clash: { rank: 1, minutes: 45, points: 5.5 },
      };
      if (broken.decisionFloat) body.clash.draw = 0.8874;
      if (broken.decisionMatrix) body.matrix = [];
      return send(broken.decisionStatus ?? 200, body, "application/json");
    }
    if (url === "/api/presets/one/rule-fixes?a=x&b=x" && method === "GET") {
      return send(broken.ruleFixesStatus ?? 422, { detail: "Pick two different sets." }, "application/json");
    }
    if (url === "/api/presets/one/whatif" && method === "POST") {
      let text = "";
      req.on("data", (chunk) => (text += chunk));
      req.on("end", () => {
        if (text.length > 16 * 1024) return send(broken.bigBodyStatus ?? 413, { detail: "Request too large." }, "application/json");
        const status = text.includes('"rule"') ? (broken.ruleStepStatus ?? 422) : (broken.whatifStatus ?? 422);
        send(status, { detail: [] }, "application/json");
      });
      return;
    }
    if (url === "/api/pair") {
      if (method === "GET") return send(broken.pairGet ?? 405, { detail: "Method Not Allowed" }, "application/json");
      if (method === "POST") return send(broken.pairPost ?? 422, { detail: [] }, "application/json");
    }
    if (url === "/docs") return send(broken.docsOn ? 200 : 404, "docs");
    return send(404, { detail: "Not Found" }, "application/json");
  };
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

const servers = [];
async function stub(broken) {
  const started = await listen(stubHandler(broken));
  servers.push(started.server);
  return started.origin;
}

after(() => {
  for (const server of servers) server.close();
});

function failures(results) {
  return results.filter((result) => !result.ok).map((result) => result.name);
}

const DECISION = "web every preset's decision answers 200 with kind decision and no stray decimal";

describe("runSmoke against a stub deployment", () => {
  it("passes on a healthy stub, with one line per check", async () => {
    const origin = await stub();
    const lines = [];
    const results = await runSmoke({ web: origin, api: origin, log: (line) => lines.push(line) });
    assert.deepEqual(failures(results), []);
    assert.equal(lines.length, results.length);
    assert.ok(lines.every((line) => line.startsWith("ok ")), lines.join("\n"));
    assert.equal(results.length, 16);
  });

  it("skips the API checks when no API origin is given", async () => {
    const origin = await stub();
    const lines = [];
    const results = await runSmoke({ web: origin, log: (line) => lines.push(line) });
    assert.deepEqual(failures(results), []);
    assert.equal(results.filter((result) => result.skipped).length, 2);
    assert.equal(lines.filter((line) => line.startsWith("skip")).length, 2);
  });

  it("checks the pair_check flag only when asked", async () => {
    const off = await stub();
    const on = await stub({ pairOn: true });
    assert.deepEqual(failures(await runSmoke({ web: off, pairCheck: "off" })), []);
    assert.deepEqual(failures(await runSmoke({ web: on, pairCheck: "on" })), []);
    assert.deepEqual(failures(await runSmoke({ web: on, pairCheck: "any" })), []);
    assert.equal(failures(await runSmoke({ web: off, pairCheck: "on" })).length, 1);
    assert.equal(failures(await runSmoke({ web: on, pairCheck: "off" })).length, 1);
  });

  it("fails each check on its own when the stub is wrong", async () => {
    const cases = [
      [{ noHeading: true }, "web / answers 200 with the page heading"],
      [{ noMethod: true }, "web /method answers 200 with the test result"],
      [{ briefStatus: 500 }, "web /brief answers 200"],
      [{ noKey: true }, "web /api/health is ok with a Qloo key and the expected pair check"],
      [{ onePreset: true }, "web /api/presets lists at least 2 presets"],
      [{ smallPreset: true }, "web first preset is real (over 50 KB, not the synthetic day) and carries no matrix"],
      [{ matrix: true }, "web first preset is real (over 50 KB, not the synthetic day) and carries no matrix"],
      [{ synthetic: true }, "web first preset is real (over 50 KB, not the synthetic day) and carries no matrix"],
      [{ lensesStatus: 404 }, "web first preset lenses answer 200 and say kind lenses"],
      [{ lensesKind: "other" }, "web first preset lenses answer 200 and say kind lenses"],
      [{ decisionStatus: 404 }, DECISION],
      [{ decisionKind: "lenses" }, DECISION],
      [{ decisionFloat: true }, DECISION],
      [{ decisionMatrix: true }, DECISION],
      [{ secondDecisionStatus: 500 }, DECISION],
      [{ secondDecisionPoints: true }, DECISION],
      [{ ruleFixesStatus: 200 }, "web first preset rule-fixes with one set against itself is 422"],
      [{ ruleFixesStatus: 404 }, "web first preset rule-fixes with one set against itself is 422"],
      [{ whatifStatus: 200 }, "web POST first preset what-if with a malformed plan is 422"],
      [{ whatifStatus: 404 }, "web POST first preset what-if with a malformed plan is 422"],
      [{ ruleStepStatus: 200 }, "web POST first preset what-if with a malformed rule step is 422"],
      [{ ruleStepStatus: 404 }, "web POST first preset what-if with a malformed rule step is 422"],
      [{ bigBodyStatus: 200 }, "web POST first preset what-if with a 20 KB padded body is 413"],
      [{ bigBodyStatus: 422 }, "web POST first preset what-if with a 20 KB padded body is 413"],
      [{ pairGet: 200 }, "web GET /api/pair is 405"],
      [{ pairPost: 200 }, "web POST /api/pair with an empty body is 422"],
      [{ docsOn: true }, "api /docs is off (404)"],
    ];
    for (const [broken, name] of cases) {
      const origin = await stub(broken);
      const results = await runSmoke({ web: origin, api: origin });
      assert.deepEqual(failures(results), [name], JSON.stringify(broken));
    }
  });

  it("fails every check that cannot reach the server", async () => {
    const { server, origin } = await listen(stubHandler());
    await new Promise((resolve) => server.close(resolve));
    const lines = [];
    const results = await runSmoke({ web: origin, api: origin, timeoutMs: 2000, log: (line) => lines.push(line) });
    assert.equal(failures(results).length, results.length);
    assert.ok(lines.every((line) => line.startsWith("FAIL ")));
  });

  it("fails a check that gets no answer in time", async () => {
    const { server, origin } = await listen(() => {});
    servers.push(server);
    const results = await runSmoke({ web: origin, timeoutMs: 100 });
    assert.ok(failures(results).length > 0);
    assert.match(results[0].reason, /no answer in 100 ms/);
  });
});

describe("--local: a local or clean-clone run", () => {
  it("accepts one built day, or only the invented day first, and no Qloo key", async () => {
    for (const broken of [{ onePreset: true }, { onePreset: true, synthetic: true, smallPreset: true }, { noKey: true }]) {
      const origin = await stub(broken);
      const lines = [];
      const results = await runSmoke({ web: origin, api: origin, local: true, log: (line) => lines.push(line) });
      assert.deepEqual(failures(results), [], JSON.stringify(broken));
      assert.ok(lines.some((line) => line.includes("lists at least 1 preset")));
    }
  });

  it("still fails a matrix, a stray decimal, a wrong pair-check flag and every refusal check", async () => {
    const cases = [
      [{ matrix: true }, "web first preset is real (over 50 KB) or the invented day, and carries no matrix"],
      [{ smallPreset: true }, "web first preset is real (over 50 KB) or the invented day, and carries no matrix"],
      [{ decisionFloat: true }, DECISION],
      [{ secondDecisionPoints: true }, DECISION],
      [{ pairPost: 200 }, "web POST /api/pair with an empty body is 422"],
      [{ docsOn: true }, "api /docs is off (404)"],
    ];
    for (const [broken, name] of cases) {
      const origin = await stub(broken);
      const results = await runSmoke({ web: origin, api: origin, local: true });
      assert.deepEqual(failures(results), [name], JSON.stringify(broken));
    }
    const on = await stub({ pairOn: true });
    assert.equal(failures(await runSmoke({ web: on, local: true, pairCheck: "off" })).length, 1);
  });

  it("without --local, one preset, the invented day or a missing key each fail", async () => {
    for (const broken of [{ onePreset: true }, { synthetic: true }, { noKey: true }]) {
      const origin = await stub(broken);
      assert.equal(failures(await runSmoke({ web: origin, api: origin })).length, 1, JSON.stringify(broken));
    }
  });
});

describe("decisionProblem", () => {
  it("allows whole numbers, budgets and one-decimal points, and nothing else", () => {
    assert.equal(decisionProblem({ clash: { points: 5.5, minutes: 30 }, published_budget: 116.71 }), null);
    assert.equal(decisionProblem({ points: 12 }), null);
    assert.match(decisionProblem({ points: 5.55 }), /under "points"/);
    assert.match(decisionProblem({ clash: { draw: 0.8874 } }), /under "draw"/);
    assert.match(decisionProblem({ minutes: 4.5 }), /under "minutes"/);
    assert.match(decisionProblem({ nested: { matrix: [] } }), /"matrix" key/);
  });
});

describe("parseArgs", () => {
  it("reads the origin and the options", () => {
    assert.deepEqual(parseArgs(["https://a.example", "--api", "https://b.example", "--pair-check", "on"]), {
      web: "https://a.example",
      api: "https://b.example",
      pairCheck: "on",
      local: false,
    });
    assert.deepEqual(parseArgs(["http://localhost:3000"]), {
      web: "http://localhost:3000",
      api: null,
      pairCheck: "any",
      local: false,
    });
    assert.deepEqual(parseArgs(["http://localhost:3000", "--api", "http://localhost:8000", "--local"]), {
      web: "http://localhost:3000",
      api: "http://localhost:8000",
      pairCheck: "any",
      local: true,
    });
  });

  it("refuses a missing origin, a bad flag value or an unknown option", () => {
    assert.throws(() => parseArgs([]), /web origin is required/);
    assert.throws(() => parseArgs(["https://a.example", "--pair-check", "maybe"]), /on, off or any/);
    assert.throws(() => parseArgs(["https://a.example", "--api"]), /needs a value/);
    assert.throws(() => parseArgs(["https://a.example", "--nope"]), /unknown option/);
    assert.throws(() => parseArgs(["not-a-url"]), /not an origin/);
    assert.throws(() => parseArgs(["https://a.example", "https://b.example"]), /unexpected argument/);
  });
});

describe("the command line", () => {
  let good;
  let bad;
  before(async () => {
    good = await stub();
    bad = await stub({ noMethod: true });
  });

  function run(args) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("close", (code) => resolve({ code, out, err }));
    });
  }

  it("exits 0 and prints one line per check when everything passes", async () => {
    const { code, out } = await run([good, "--api", good, "--pair-check", "off"]);
    assert.equal(code, 0, out);
    assert.match(out, /smoke: all checks passed/);
    assert.equal(out.split("\n").filter((line) => line.startsWith("ok ")).length, 16);
  });

  it("exits 1 and names the failing check", async () => {
    const { code, out } = await run([bad]);
    assert.equal(code, 1);
    assert.match(out, /FAIL {2}web \/method/);
    assert.match(out, /1 check\(s\) failed/);
  });

  it("exits 2 with the usage line when the arguments are wrong", async () => {
    const { code, err } = await run([]);
    assert.equal(code, 2);
    assert.match(err, /usage: node scripts\/smoke\.mjs/);
    assert.match(err, /\[--local\]/);
    assert.match(err, /--pair-check off before the judging-window switches; on after them/);
  });

  it("exits 0 with --local against a stub that serves only the invented day", async () => {
    const invented = await stub({ onePreset: true, synthetic: true, smallPreset: true, noKey: true });
    const { code, out } = await run([invented, "--api", invented, "--local", "--pair-check", "off"]);
    assert.equal(code, 0, out);
    assert.match(out, /smoke: all checks passed/);
  });
});
