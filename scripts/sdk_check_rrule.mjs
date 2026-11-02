#!/usr/bin/env node
/**
 * G-RRULE: the output matches the RFC 5545 examples and test vectors
 * produced by an independent reference implementation exactly, across
 * daylight-saving transitions too.
 *
 * From the vitest report: every claim has a passing test, and each of the
 * RFC's 42 examples passes as a test of its own. From the vector file: it was
 * written by dateutil (the generator is scripts/sdk_rrule_vectors.py), it
 * holds at least 800 cases, and at least 100 cross a clock change — otherwise
 * "across transitions too" is not a claim. Statically: RRULE is /calendar's
 * own code, not a dependency.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const reportFile = join(core, ".rrule-report.json");
const failures = checkReport({
  file: reportFile,
  label: "RRULE",
  minTests: 55,
  claims: ["rfc-examples", "reference-vectors", "dst", "window", "parse-format", "rdate-exdate"],
});
const notes = [];
try {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const examples = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []).filter((test) => test.status === "passed" && String(test.title).includes("[claim:rfc-examples]"));
  if (examples.length < 43) failures.push(`only ${String(examples.length)} passing [claim:rfc-examples] tests (the 42 examples plus the completeness test are required)`);
} catch {
  // checkReport has already counted the missing report as a failure.
}

const examples = JSON.parse(readFileSync(join(core, "test", "rrule", "rfc5545-examples.json"), "utf8")).examples;
if (examples.length !== 42) failures.push(`the fixture holds ${String(examples.length)} of the RFC 5545 3.8.5.3 examples, 42 are required`);
const vectors = JSON.parse(readFileSync(join(core, "test", "rrule", "vectors.json"), "utf8"));
if (vectors.generator !== "python-dateutil") failures.push(`the vectors were not written by dateutil: ${String(vectors.generator)}`);
if ((vectors.cases ?? []).length < 800) failures.push(`only ${String(vectors.cases?.length)} vectors, at least 800 are required`);
if ((vectors.crossingClockChange ?? 0) < 100) failures.push(`only ${String(vectors.crossingClockChange)} vectors cross a clock change, at least 100 are required`);
notes.push(`${String(vectors.cases?.length)} dateutil vectors (${String(vectors.dateutil)}), ${String(vectors.crossingClockChange)} across a clock change; skipped: ${JSON.stringify(vectors.skipped)}`);

const source = codeOf(readFileSync(join(core, "src", "calendar", "rrule.ts"), "utf8"));
for (const line of source.split("\n").filter((each) => /^\s*import /.test(each))) {
  if (!/from "\.\.?\//.test(line)) failures.push(`RRULE imports from outside its own code: ${line.trim()}`);
}
finish("G-RRULE", failures, notes);
