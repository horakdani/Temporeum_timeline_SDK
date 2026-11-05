#!/usr/bin/env node
/**
 * The claim checks: every `test:<name>` script of the core and of the docs
 * site — a suite and the checker that reads its report (`scripts/sdk_check_*.mjs`:
 * a minimum number of tests, every `[claim:…]` passing, a negative control)
 * — in CI, not only on a developer's machine.
 *
 * `vitest run` alone is green when a claim's test was deleted, skipped or
 * renamed; the checkers are what notice. They run here exactly as they run
 * locally (`npm run test:<name> -w <package>`), one after the other, and the
 * summary lists each one's exit code and time. (Three checkers had gone stale
 * without anyone seeing, and the print suite had failed since a pdf.js
 * upgrade: nothing ran them.)
 *
 * No script is forgotten: every `test:*` script of the two packages runs
 * here, unless ELSEWHERE names it — and then the CI workflow must run it as a
 * step of its own, or this FAILS — or NOT_IN_CI says why it cannot run there.
 * NEGATIVE CONTROL: an ELSEWHERE name the workflow does not run fails on the
 * same judge.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = [
  join(repo, ".github", "workflows", "ci.yml"),
][0];

/**
 * Per package: the test scripts the CI workflow runs as steps of their own
 * (the name, and what the workflow must say for it), and the ones it cannot
 * run (with why).
 */
const PACKAGES = [
  {
    name: "@temporeum/timeline-core",
    dir: "core",
    elsewhere: {
      "test:coverage": "npm run test:coverage -w packages/core",
      // The same suite as test:coverage, and then the no-DOM probe of the build.
      "test:node": "node scripts/sdk_check_nodom.mjs",
      "test:orientation": "npm run test:orientation -w packages/core",
      "test:property": "npm run test:property -w packages/core",
      "test:visual": "npm run test:visual -w packages/core",
      "test:rtl": "npm run test:rtl -w packages/core",
      "test:dep-routing": "npm run test:dep-routing -w packages/core",
      "test:treeshake": "npm run test:treeshake -w packages/core",
    },
    // Where the package has it: the export leaves it out, as it measures against code outside this repository.
    notInCi: { "test:golden": "measures against the old renderer of the application the engine came from" },
  },
  {
    name: "@temporeum/timeline-docs",
    dir: "docs",
    elsewhere: {
      "test:examples": "npm run test:examples -w @temporeum/timeline-docs",
      "test:migration": "npm run test:migration -w @temporeum/timeline-docs",
      "test:a11y": "npm run test:a11y -w @temporeum/timeline-docs",
      "test:ssr": "npm run test:ssr -w @temporeum/timeline-docs",
      "test:e2e:touch": "npm run test:e2e:touch -w @temporeum/timeline-docs",
      "test:e2e:touch:webkit:linux": "npm run test:e2e:touch:webkit:linux -w @temporeum/timeline-docs",
    },
    notInCi: { "test:e2e:touch:webkit": "drives Mobile Safari in Xcode's iOS Simulator: macOS only, a release measurement" },
  },
];

/** An ELSEWHERE entry the workflow does not run, or one the package does not have. Returns the problems. */
export function judgeElsewhere(packageName, scripts, elsewhere, workflowText) {
  // A step named in a comment is not run: only the lines that are not comments count.
  const workflow = workflowText
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  const problems = [];
  for (const [name, needle] of Object.entries(elsewhere)) {
    if (!(name in scripts)) problems.push(`${packageName}: ELSEWHERE names ${name}, which the package does not have`);
    else if (!workflow.includes(needle)) problems.push(`${packageName}: ELSEWHERE says the workflow runs ${name} ("${needle}"), and it does not`);
  }
  return problems;
}

const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
const problems = [];
if (workflow === "") problems.push(`no CI workflow at ${workflowPath}`);
const toRun = [];
for (const pkg of PACKAGES) {
  const scripts = JSON.parse(readFileSync(join(repo, "packages", pkg.dir, "package.json"), "utf8")).scripts ?? {};
  problems.push(...judgeElsewhere(pkg.name, scripts, pkg.elsewhere, workflow));
  for (const name of Object.keys(scripts)) {
    if (name.startsWith("test:") && !(name in pkg.elsewhere) && !(name in pkg.notInCi)) toRun.push({ pkg: pkg.name, name });
  }
}

// The judge is not blind.
const control = judgeElsewhere("control", { "test:ghost": "vitest run" }, { "test:ghost": "npm run test:ghost -w packages/core" }, workflow);
if (control.length === 0) problems.push("NEGATIVE CONTROL: an ELSEWHERE name the workflow lacks passes — the judge is blind");
else console.log("  ok    negative control: an ELSEWHERE name the workflow does not run fails");
const commented = judgeElsewhere("control", { "test:ghost": "vitest run" }, { "test:ghost": "npm run test:ghost -w packages/core" }, `${workflow}\n      # npm run test:ghost -w packages/core\n`);
if (commented.length === 0) problems.push("NEGATIVE CONTROL: an ELSEWHERE step only in a YAML comment passes — the judge reads comments");
else console.log("  ok    negative control: an ELSEWHERE step only in a comment fails");

const results = [];
if (problems.length === 0) {
  for (const { pkg, name } of toRun) {
    const started = Date.now();
    process.stdout.write(`\n=== ${pkg} ${name}\n`);
    const run = spawnSync("npm", ["run", "--silent", name, "-w", pkg], { cwd: repo, stdio: "inherit" });
    results.push({ pkg, name, status: run.status ?? 1, seconds: Math.round((Date.now() - started) / 1000) });
  }
  process.stdout.write("\nclaims — per script:\n");
  for (const result of results) process.stdout.write(`  ${result.status === 0 ? "ok   " : "FAIL "}  ${result.pkg} ${result.name} (exit ${String(result.status)}, ${String(result.seconds)} s)\n`);
  for (const result of results.filter((r) => r.status !== 0)) problems.push(`${result.pkg} ${result.name}: exited with code ${String(result.status)}`);
}

if (problems.length > 0) {
  console.error(`\nclaims FAILED — ${String(problems.length)} problems:`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
const elsewhere = PACKAGES.reduce((sum, pkg) => sum + Object.keys(pkg.elsewhere).length, 0);
console.log(`\nclaims: all ${String(results.length)} claim checks of the core and the docs site ran and passed; ${String(elsewhere)} more are steps of the CI workflow of their own.`);
