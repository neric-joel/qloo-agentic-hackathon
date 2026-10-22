#!/usr/bin/env node
// The hero when the web server's own decision fetch fails. Run by the "browser (invented day)" workflow against a web
// dev server whose BACKEND_URL is the decision stub (decision-stub.mjs): on every load the stub strips the decision
// from the server's preset answer and holds the server's GET .../decision past its 4 s wait, so the server renders the
// hero without a decision and the browser fetches it afterwards.
//
//   node .github/scripts/hero-fallback.cjs <web base URL> <stub log> [results.json]
//
// One load of / at 1440 x 900 and one at 390 x 844, each with the CPU slowed 4x, GET requests only. It fails unless,
// for each load:
//  - the stub's log shows a stripped preset and a held decision of the web server's own, and a passed browser request
//    (the failure happened, and the browser still reached the API);
//  - the first frame has no readout and no Keep, in the server's HTML and at DOMContentLoaded (the decision is
//    really missing there; nothing stands in for it);
//  - the hero group's height moved by 0.5 px or less, and the drawing's top by 1 px or less, from DOMContentLoaded +
//    50 ms to after the decision arrived;
//  - the cumulative layout shift stays under 0.0005, counted from the start of the load until at least 5 s after
//    DOMContentLoaded and 1 s after the hero settled.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PLAYWRIGHT = path.resolve(__dirname, "..", "..", "web", "node_modules", "playwright");

const LOADS = [
  { name: "1440 x 900", device: "Desktop Chrome", viewport: { width: 1440, height: 900 } },
  { name: "390 x 844", device: "Pixel 7", viewport: { width: 390, height: 844 } },
];
const CPU_RATE = 4;
const LIMITS = { groupHeight: 0.5, drawingTop: 1, shift: 0.0005 };
const WINDOW_AFTER_FIRST_FRAME_MS = 5_000;
const WINDOW_AFTER_SETTLE_MS = 1_000;
const SETTLE_TIMEOUT_MS = 60_000;
const SELECTORS = {
  group: "[data-hero] [data-hero-group]",
  readout: "[data-hero] [data-hero-group] [data-readout]",
  drawing: "[data-hero] [data-day-graph]",
  toggle: '[data-hero] [role="radiogroup"][aria-label="Drawing shows"]',
};
/** The hero's Keep button, by its label in either state (as web/e2e/pages/home-page.ts finds it). */
const KEEP = /^(Keep this move|Kept in your plan)$/;

/**
 * Registered before the page's own scripts: a buffered layout-shift observer from navigation, a snapshot function, and
 * two snapshots, at DOMContentLoaded (the first frame) and 50 ms after it.
 */
function initScript({ selectors, keepSource }) {
  const keep = new RegExp(keepSource);
  const store = { shift: 0, shifts: [], dcl: null, atDcl: null, early: null };
  window.__heroFallback = store;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      store.shift += entry.value;
      const sources = (entry.sources || []).map((source) => {
        const node = source.node;
        if (!node || node.nodeType !== 1) return node ? node.nodeName : "?";
        const tag = node.tagName.toLowerCase();
        const marks = [...node.attributes].filter((attribute) => attribute.name.startsWith("data-")).map((attribute) => attribute.name);
        return `${tag}${marks.length ? `[${marks.join(",")}]` : ""} ${Math.round(source.previousRect.y)}->${Math.round(source.currentRect.y)}`;
      });
      store.shifts.push({ at: Math.round(entry.startTime), value: entry.value, sources });
    }
  }).observe({ type: "layout-shift", buffered: true });

  const shown = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const first = (selector) => [...document.querySelectorAll(selector)].find(shown) || null;
  // A button's name as a screen reader hears it: its aria-label, else its text less any part hidden from it (Keep
  // holds both of its labels in one cell and hides the one not in use).
  const label = (button) => {
    const named = button.getAttribute("aria-label");
    if (named) return named.replace(/\s+/g, " ").trim();
    const parts = [];
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let hidden = false;
      for (let element = node.parentElement; element && element !== button.parentElement; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (element.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden") {
          hidden = true;
          break;
        }
      }
      if (!hidden) parts.push(node.textContent);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  };
  const snapshot = () => {
    const group = first(selectors.group);
    const drawing = first(selectors.drawing);
    const toggle = first(selectors.toggle);
    const buttons = [...document.querySelectorAll(`${selectors.group} button`)].filter((button) => keep.test(label(button)));
    const readouts = [...document.querySelectorAll(selectors.readout)];
    return {
      at: Math.round(performance.now()),
      groupHeight: group ? group.getBoundingClientRect().height : null,
      heroState: group ? group.getAttribute("data-hero-state") : null,
      drawingTop: drawing ? drawing.getBoundingClientRect().top + window.scrollY : null,
      toggleTop: toggle ? toggle.getBoundingClientRect().top + window.scrollY : null,
      readouts: readouts.length,
      readoutsShown: readouts.filter(shown).length,
      keeps: buttons.length,
      keepsShown: buttons.filter(shown).length,
    };
  };
  window.__heroFallbackSnapshot = snapshot;
  document.addEventListener("DOMContentLoaded", () => {
    store.dcl = performance.now();
    store.atDcl = snapshot();
    window.setTimeout(() => {
      store.early = snapshot();
    }, 50);
  });
}

/**
 * The server's HTML as a document (parsed, never run), and what its heroes hold: every [data-hero], streamed parts
 * included, with its groups, readouts and Keep buttons (named as a screen reader names them, less aria-hidden text).
 */
function serverFrame({ html, selectors, keepSource }) {
  const keep = new RegExp(keepSource);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const named = (button) => {
    const label = button.getAttribute("aria-label");
    if (label) return label.replace(/\s+/g, " ").trim();
    const parts = [];
    const walker = doc.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement?.closest('[aria-hidden="true"]')) parts.push(node.textContent);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  };
  return {
    heroes: doc.querySelectorAll("[data-hero]").length,
    groups: doc.querySelectorAll(selectors.group).length,
    readouts: doc.querySelectorAll(selectors.readout).length,
    keeps: [...doc.querySelectorAll(`${selectors.group} button`)].filter((button) => keep.test(named(button))).length,
  };
}

function readLog(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function measureOnce({ browser, devices, base, logFile, load, stub }) {
  const context = await browser.newContext({
    ...devices[load.device],
    viewport: load.viewport,
    reducedMotion: "reduce",
    // In development the web server skips its fetch cache for a request that says no-cache, so every load asks the
    // stub again and meets the failure again.
    extraHTTPHeaders: { "cache-control": "no-cache" },
  });
  const aborted = [];
  await context.route("**/*", (route) => {
    const request = route.request();
    const { hostname } = new URL(request.url());
    if (request.method() !== "GET" || !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
      aborted.push(`${request.method()} ${request.url()}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await context.addInitScript(initScript, { selectors: SELECTORS, keepSource: KEEP.source });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });

  // A second document in the same load (a development server's full reload) starts the page's clock and its
  // observers again, so such a load is not measured; it is tried once more.
  let documents = 0;
  page.on("domcontentloaded", () => {
    documents += 1;
  });

  const offset = readLog(logFile).length;
  const started = Date.now();
  const response = await page.goto(new URL("/", base).href, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const html = response ? await response.text() : "";

  let settled = null;
  let until = null;
  let store = null;
  let after = null;
  let served = null;
  try {
    // Settled: the readout and Keep are shown and the group and drawing have held still for four reads in a row.
    const reads = [];
    for (const deadline = Date.now() + SETTLE_TIMEOUT_MS; Date.now() < deadline; ) {
      const read = await page.evaluate(() => window.__heroFallbackSnapshot());
      reads.push(read);
      const last = reads.slice(-4);
      if (
        read.readoutsShown > 0 &&
        read.keepsShown > 0 &&
        last.length === 4 &&
        last.every((item) => item.groupHeight === read.groupHeight && item.drawingTop === read.drawingTop)
      ) {
        settled = read;
        break;
      }
      await sleep(250);
    }
    const sofar = await page.evaluate(() => window.__heroFallback);
    until = Math.max((sofar.dcl ?? 0) + WINDOW_AFTER_FIRST_FRAME_MS, (settled?.at ?? 0) + WINDOW_AFTER_SETTLE_MS);
    await page.waitForFunction((time) => performance.now() >= time, until, { timeout: 60_000, polling: 100 });
    store = await page.evaluate(() => window.__heroFallback);
    after = await page.evaluate(() => window.__heroFallbackSnapshot());
    served = await page.evaluate(serverFrame, { html, selectors: SELECTORS, keepSource: KEEP.source });
  } catch (error) {
    if (!/Execution context was destroyed|navigation/i.test(String(error?.message))) throw error;
    documents = Math.max(documents, 2);
  }
  const reloaded = documents > 1;
  await context.close();

  // The held request is answered after the hold; the next load starts only once it has been, so it meets its own hold.
  const spent = Date.now() - started;
  if (spent < stub.HOLD_MS + 3_000) await sleep(stub.HOLD_MS + 3_000 - spent);
  const entries = readLog(logFile).slice(offset).map(stub.parseLogLine).filter(Boolean);
  const counts = stub.tally(entries);
  if (reloaded) return { load: load.name, ok: false, reloaded: true, failures: ["the page reloaded itself during the measurement"], stub: counts };

  const failures = [];
  if (counts.stripped < 1) failures.push("the stub's log shows no stripped preset of the web server's own");
  if (counts.held < 1) failures.push("the stub's log shows no held decision of the web server's own");
  if (counts.passedBrowser < 1) failures.push("the stub's log shows no browser request passed through");

  if (served.heroes === 0) failures.push("the server's HTML holds no hero ([data-hero])");
  if (served.readouts > 0) failures.push(`the server's HTML has ${served.readouts} readout(s) in the hero: the decision was not missing`);
  if (served.keeps > 0) failures.push(`the server's HTML has ${served.keeps} Keep button(s) in the hero: the decision was not missing`);

  const { atDcl, early: first } = store;
  if (!atDcl || !first) failures.push("no snapshot at DOMContentLoaded");
  else {
    if (atDcl.readouts > 0 || atDcl.keeps > 0) {
      failures.push(`at DOMContentLoaded the hero already had ${atDcl.readouts} readout(s) and ${atDcl.keeps} Keep button(s): its first frame was not the one without a decision`);
    }
    if (first.groupHeight === null) failures.push("no hero group ([data-hero-group]) at DOMContentLoaded + 50 ms");
    if (first.drawingTop === null) failures.push("no drawing ([data-day-graph]) at DOMContentLoaded + 50 ms");
  }
  if (!settled) failures.push(`the hero did not settle with a readout and Keep within ${SETTLE_TIMEOUT_MS / 1000} s`);
  if (after.readoutsShown < 1 || after.keepsShown < 1) failures.push("after settling the hero shows no readout or no Keep: the decision never reached the browser");

  const groupMove = first?.groupHeight != null && after.groupHeight != null ? Math.abs(after.groupHeight - first.groupHeight) : null;
  const drawingMove = first?.drawingTop != null && after.drawingTop != null ? Math.abs(after.drawingTop - first.drawingTop) : null;
  if (groupMove !== null && groupMove > LIMITS.groupHeight) {
    failures.push(`the hero group's height moved ${groupMove.toFixed(1)} px (${first.groupHeight.toFixed(1)} -> ${after.groupHeight.toFixed(1)}); at most ${LIMITS.groupHeight}`);
  }
  if (drawingMove !== null && drawingMove > LIMITS.drawingTop) {
    failures.push(`the drawing's top moved ${drawingMove.toFixed(1)} px (${first.drawingTop.toFixed(1)} -> ${after.drawingTop.toFixed(1)}); at most ${LIMITS.drawingTop}`);
  }
  if (!(store.shift < LIMITS.shift)) failures.push(`cumulative layout shift ${store.shift.toFixed(5)}; it must stay under ${LIMITS.shift}`);

  return {
    load: load.name,
    ok: failures.length === 0,
    failures,
    stub: counts,
    stubLines: entries.map((entry) => `${entry.action} ${entry.client} ${entry.method} ${entry.path} ${entry.detail}`),
    serverHtml: { ...served, bytes: html.length },
    domContentLoadedMs: store.dcl === null ? null : Math.round(store.dcl),
    firstFrame: atDcl,
    early: first,
    settledAtMs: settled?.at ?? null,
    after,
    groupHeightMove: groupMove,
    drawingTopMove: drawingMove,
    layoutShift: store.shift,
    shifts: store.shifts,
    windowEndMs: Math.round(until),
    aborted,
    consoleErrors,
  };
}

/** One load, tried a second time only if the page reloaded itself during the first. */
async function measure(options) {
  const first = await measureOnce(options);
  if (!first.reloaded) return first;
  const second = await measureOnce(options);
  return { ...second, retriedAfterReload: true };
}

async function main() {
  const [base, logFile, outFile] = process.argv.slice(2);
  if (!base || !logFile) {
    console.error("usage: node .github/scripts/hero-fallback.cjs <web base URL> <stub log> [results.json]");
    process.exitCode = 2;
    return;
  }
  const stub = await import(pathToFileURL(path.join(__dirname, "decision-stub.mjs")).href);
  const { chromium, devices } = require(PLAYWRIGHT);
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const load of LOADS) results.push(await measure({ browser, devices, base, logFile, load, stub }));
  } finally {
    await browser.close();
  }

  const lines = [];
  for (const result of results) {
    lines.push(
      `${result.ok ? "PASS" : "FAIL"} ${result.load}: group ${fmt(result.early?.groupHeight)} -> ${fmt(result.after?.groupHeight)} px, ` +
        `drawing top ${fmt(result.early?.drawingTop)} -> ${fmt(result.after?.drawingTop)} px, layout shift ${fmt(result.layoutShift, 5)}, ` +
        `stub: ${result.stub.stripped} stripped, ${result.stub.held} held, ${result.stub.passedBrowser} browser passed`,
    );
    for (const failure of result.failures) lines.push(`  - ${failure}`);
  }
  console.log(JSON.stringify(results, null, 2));
  console.log(lines.join("\n"));
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Hero without the server's decision\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  }
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
}

function fmt(value, digits = 1) {
  return value === null || value === undefined ? "none" : value.toFixed(digits);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
