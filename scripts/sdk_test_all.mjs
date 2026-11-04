#!/usr/bin/env node
/**
 * The full suite (`npm run test:all`) is green, in EVERY package, not just in core.
 *
 * Why `npm run test --workspaces --if-present` is not enough: `--if-present`
 * SILENTLY skips a workspace without a `test` script, and the command returns
 * green. A package that has no tests then looks exactly like one whose tests
 * all passed — the "in EVERY package" claim cannot be proven from the output.
 * (At one point the docs workspace had no `test` script.)
 *
 * This script walks the workspace list of the root package.json: if a
 * workspace has no `test` script, that is a FAILURE, not a skip. Then it runs
 * them package by package, in sequence (so the browser suites' ports do not
 * clash), and at the end prints the exit code and the time for each package.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const workspaces = root.workspaces ?? [];
const results = [];
const problems = [];

if (workspaces.length === 0) problems.push("the root package.json declares no workspaces");
for (const workspace of workspaces) {
  const manifestPath = join(repo, workspace, "package.json");
  if (!existsSync(manifestPath)) {
    problems.push(`${workspace}: no package.json`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest.scripts?.test !== "string" || manifest.scripts.test.trim() === "") {
    problems.push(`${manifest.name ?? workspace}: no "test" script — a package without tests is not "green"`);
    continue;
  }
  const started = Date.now();
  process.stdout.write(`\n=== ${manifest.name} — npm run test\n`);
  const run = spawnSync("npm", ["run", "test", "-w", manifest.name], { cwd: repo, stdio: "inherit" });
  results.push({ name: manifest.name, status: run.status ?? 1, seconds: Math.round((Date.now() - started) / 1000) });
}

process.stdout.write("\nall — per package:\n");
for (const result of results) process.stdout.write(`  ${result.status === 0 ? "ok   " : "FAIL "}  ${result.name} (exit ${String(result.status)}, ${String(result.seconds)} s)\n`);
for (const result of results.filter((r) => r.status !== 0)) problems.push(`${result.name}: the test exited with code ${String(result.status)}`);
if (problems.length > 0) {
  for (const problem of problems) process.stdout.write(`  ✗ ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`\nall: the tests of all ${String(results.length)} workspaces ran and are green.\n`);
