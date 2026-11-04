#!/usr/bin/env node
/**
 * The element's browser suite in Firefox and WebKit too, not only in Chromium:
 * the stability page promises the current Firefox and Safari.
 *
 * `npm test` in packages/web-component runs the suite in Chromium (with the
 * coverage threshold); this runs the same suite once per other engine, the
 * engine chosen by TL_BROWSER (packages/web-component/vitest.config.ts).
 * From vitest's JSON report it then proves that each run really ran in the
 * engine it was asked for — a config that ignored TL_BROWSER would run
 * Chromium three times and pass — and that it ran tests at all.
 *
 *   node scripts/sdk_test_browsers.mjs            # firefox and webkit
 *   node scripts/sdk_test_browsers.mjs webkit     # one engine
 *
 * The browsers must be installed (`npx playwright install --with-deps firefox webkit`).
 * NEGATIVE CONTROL: a report from the wrong engine, an empty report and a
 * file that did not load fail on the same judge.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const element = join(repo, "packages", "web-component");
const ENGINES = ["firefox", "webkit"];
const asked = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const engines = asked.length === 0 ? ENGINES : asked;
const problems = [];

/** What a vitest JSON report says about the run in `engine`. Returns { passed, problems }. */
export function judgeReport(report, engine) {
  const found = [];
  const results = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  const files = new Set((report.testResults ?? []).map((file) => String(file.name ?? "")).filter(Boolean));
  if (results.length === 0) found.push(`${engine}: the report holds no test — nothing ran`);
  // The engine the run's own browser reported (test/engine.browser.test.ts).
  const ran = report.engine;
  if (ran !== engine) found.push(`${engine}: the suite ran in ${String(ran)}, not in ${engine}`);
  // A file that failed to load (a throwing beforeAll) has no failed test of its own.
  for (const file of report.testResults ?? []) if (file.status === "failed" && !(file.assertionResults ?? []).some((result) => result.status === "failed")) found.push(`${engine}: ${String(file.name)}: ${String(file.message ?? "failed").split("\n")[0]}`);
  const failed = results.filter((result) => result.status === "failed");
  for (const result of failed) found.push(`${engine}: ${result.fullName ?? result.title}`);
  return { passed: results.filter((result) => result.status === "passed").length, files: files.size, problems: found };
}

for (const engine of engines) {
  if (!["chromium", ...ENGINES].includes(engine)) {
    problems.push(`no such engine: ${engine}`);
    continue;
  }
  const scratch = mkdtempSync(join(tmpdir(), "tl-browsers-"));
  const output = join(scratch, "report.json");
  console.log(`\n=== the element's browser suite in ${engine}`);
  const run = spawnSync("npx", ["vitest", "run", "--project", "browser", "--reporter=default", "--reporter=json", `--outputFile.json=${output}`], {
    cwd: element,
    stdio: "inherit",
    env: { ...process.env, TL_BROWSER: engine },
  });
  let report;
  try {
    report = JSON.parse(readFileSync(output, "utf8"));
  } catch {
    problems.push(`${engine}: vitest wrote no report (exit ${String(run.status)}) — the suite did not run`);
    rmSync(scratch, { recursive: true, force: true });
    continue;
  }
  rmSync(scratch, { recursive: true, force: true });
  // Which engine the suite ran in: test/engine.browser.test.ts writes it into its own name.
  const engineTest = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []).find((result) => /^runs in /.test(result.title ?? ""));
  report.engine = engineTest?.status === "passed" ? /^runs in (\w+)/.exec(engineTest.title)?.[1] : undefined;
  const judged = judgeReport(report, engine);
  problems.push(...judged.problems);
  if (run.status !== 0 && judged.problems.length === 0) problems.push(`${engine}: vitest exited with code ${String(run.status)}`);
  if (judged.problems.length === 0 && run.status === 0) console.log(`  ok    ${engine}: ${String(judged.passed)} tests passed in ${String(judged.files)} files`);
}

// The judge is not blind.
const passing = { testResults: [{ name: "a", assertionResults: [{ title: "x", status: "passed" }] }] };
const brokenFile = { testResults: [...passing.testResults, { name: "b", status: "failed", message: "beforeAll threw", assertionResults: [{ title: "y", status: "skipped" }] }], engine: "webkit" };
if (
  judgeReport({ ...passing, engine: "chromium" }, "webkit").problems.length === 0 ||
  judgeReport({ testResults: [], engine: "webkit" }, "webkit").problems.length === 0 ||
  judgeReport(brokenFile, "webkit").problems.length === 0 ||
  judgeReport({ ...passing, engine: "webkit" }, "webkit").problems.length !== 0
) {
  problems.push("NEGATIVE CONTROL: the report judge passes a run in the wrong engine, an empty one or a file that did not load — it is blind");
} else console.log("  ok    negative control: a report from the wrong engine, an empty one and a file that did not load fail");

if (problems.length > 0) {
  console.error(`\nbrowsers FAILED — ${String(problems.length)} problems:`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log(`\nbrowsers: the element's browser suite is green in ${engines.join(" and ")}.`);
