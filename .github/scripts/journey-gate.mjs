#!/usr/bin/env node
// Reads a Playwright JSON report and fails unless every test in it passed and at least <minimum> did. A skipped test
// fails the gate: on a clean clone the real-day specs skip themselves (web/e2e/helpers.ts requireSavedDays), so a
// journey that skipped could pass while testing nothing.
//
//   node .github/scripts/journey-gate.mjs <report.json> <minimum passed>
//
// A test that passed only on a retry counts as passed and is named in the output, as the Playwright config intends.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Every test in the report, one entry per test and project, with its title path and how it ended. */
export function collectTests(report) {
  const found = [];
  const walk = (suite, trail) => {
    const here = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      for (const run of spec.tests ?? []) {
        const results = run.results ?? [];
        found.push({
          title: [...here, spec.title].join(" › "),
          project: run.projectName ?? "",
          expectedStatus: run.expectedStatus ?? "passed",
          status: run.status ?? "skipped",
          last: results.at(-1)?.status ?? "skipped",
          attempts: results.length,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report?.suites ?? []) walk(suite, []);
  return found;
}

/**
 * The gate's verdict: ok only when the report has no error, no test was skipped, every test passed (on a retry at
 * most), and at least `minimum` passed.
 */
export function judge(report, minimum) {
  const tests = collectTests(report);
  const name = (test) => `[${test.project}] ${test.title}`;
  const skipped = tests.filter((test) => test.status === "skipped" || test.expectedStatus === "skipped" || test.last === "skipped");
  const failed = tests.filter((test) => !skipped.includes(test) && test.status === "unexpected");
  const passed = tests.filter(
    (test) => !skipped.includes(test) && test.expectedStatus === "passed" && (test.status === "expected" || test.status === "flaky") && test.last === "passed",
  );
  const flaky = passed.filter((test) => test.status === "flaky");
  const other = tests.filter((test) => !skipped.includes(test) && !failed.includes(test) && !passed.includes(test));
  const errors = (report?.errors ?? []).map((error) => String(error?.message ?? error).split("\n")[0]);

  const reasons = [];
  if (errors.length > 0) reasons.push(`${errors.length} run error(s): ${errors.join(" | ")}`);
  if (skipped.length > 0) reasons.push(`${skipped.length} test(s) skipped; a skipped test proves nothing here`);
  if (failed.length > 0) reasons.push(`${failed.length} test(s) failed`);
  if (other.length > 0) reasons.push(`${other.length} test(s) neither passed nor failed plainly`);
  if (passed.length < minimum) reasons.push(`${passed.length} passed, fewer than the minimum of ${minimum}`);

  return {
    ok: reasons.length === 0,
    total: tests.length,
    passed: passed.length,
    reasons,
    skipped: skipped.map(name),
    failed: failed.map(name),
    flaky: flaky.map(name),
    other: other.map(name),
    errors,
  };
}

/** The verdict as lines of text for the job log. */
export function describe(verdict, minimum) {
  const lines = [
    `journey gate: ${verdict.ok ? "passed" : "FAILED"}: ${verdict.passed} of ${verdict.total} tests passed (minimum ${minimum})`,
  ];
  for (const reason of verdict.reasons) lines.push(`  - ${reason}`);
  for (const [label, list] of [
    ["skipped", verdict.skipped],
    ["failed", verdict.failed],
    ["not a plain pass", verdict.other],
    ["passed on a retry", verdict.flaky],
  ]) {
    if (list.length === 0) continue;
    lines.push(`  ${label}:`);
    for (const item of list) lines.push(`    ${item}`);
  }
  return lines;
}

function main(argv) {
  const [file, raw] = argv;
  const minimum = Number(raw);
  if (!file || !Number.isInteger(minimum) || minimum < 1) {
    console.error("usage: node .github/scripts/journey-gate.mjs <report.json> <minimum passed, at least 1>");
    return 2;
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`journey gate: FAILED: cannot read the report ${file}: ${error.message}`);
    return 1;
  }
  const verdict = judge(report, minimum);
  const lines = describe(verdict, minimum);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Journey on the invented day\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  }
  return verdict.ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
