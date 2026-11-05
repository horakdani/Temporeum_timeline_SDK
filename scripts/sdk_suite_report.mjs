/**
 * The shared half of the suite-report checks: reading a vitest JSON report.
 *
 * Every such check asks the report the same things: did it run (a missing
 * report is a FAILURE, not a skip), did every test file load (one that throws
 * on import has no tests to fail, so only its own status says so — and the
 * package script drops vitest's exit code, leaving this check the judge),
 * did enough tests run, are they all green,
 * and does every claim (`[claim:<name>]`) appear in the test names — in both
 * orientations if required. A claim whose test has disappeared is not proven.
 */
import { existsSync, readFileSync } from "node:fs";

/**
 * @param {{ file: string; label: string; minTests: number; claims: readonly string[]; orientations?: boolean }} spec
 * @returns {string[]} the failures
 */
export function checkReport(spec) {
  const failures = [];
  if (!existsSync(spec.file)) {
    return [`no vitest report (${spec.file}) — the ${spec.label} suite did NOT run, so FAIL`];
  }
  const report = JSON.parse(readFileSync(spec.file, "utf8"));
  for (const file of report.testResults ?? []) {
    if (file.status === "failed" && (file.assertionResults ?? []).every((test) => test.status === "passed")) {
      failures.push(`${spec.label} test file failed outside its tests: ${String(file.name)} — ${String(file.message ?? "").split("\n")[0]}`);
    }
  }
  const tests = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  if (tests.length < spec.minTests) {
    failures.push(`${String(tests.length)} ${spec.label} tests ran, at least ${String(spec.minTests)} are required`);
  }
  for (const test of tests) {
    if (test.status !== "passed") failures.push(`${spec.label} test not green: ${String(test.fullName)} (${String(test.status)})`);
  }
  const names = tests.filter((test) => test.status === "passed").map((test) => String(test.fullName));
  for (const claim of spec.claims) {
    const tag = `[claim:${claim}]`;
    const variants = spec.orientations ? ["[horizontal]", "[vertical]"] : [""];
    for (const variant of variants) {
      if (!names.some((name) => name.includes(tag) && name.includes(variant))) {
        failures.push(`the ${tag} claim has no green test${variant === "" ? "" : ` in the ${variant} orientation`}`);
      }
    }
  }
  return failures;
}

/** Prints the result, and exits according to the number of failures. */
export function finish(gate, failures, notes = []) {
  for (const note of notes) console.log(`  - ${note}`);
  if (failures.length > 0) {
    console.error(`${gate}: FAILED`);
    for (const failure of failures) console.error(`  x ${failure}`);
    process.exit(1);
  }
  console.log(`${gate}: every claim proven.`);
}

/** Source code without comments: a name standing in a comment is not a call. */
export const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
