#!/usr/bin/env node
/**
 * The ical check: importing and exporting an iCal file round-trips to the same set
 * of events.
 *
 * From the vitest report: every claim has a green test, and each of the
 * three sample files (Google, Outlook and Apple flavours) is green as a
 * separate test. The sample files exist and use CRLF — a sample saved with
 * LF would no longer prove the line-break handling.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const reportFile = join(core, ".ical-report.json");
const failures = checkReport({
  file: reportFile,
  label: "iCal",
  minTests: 12,
  claims: ["roundtrip-files", "roundtrip-generated", "folding", "zones", "meaning"],
});
try {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []).filter((test) => test.status === "passed" && String(test.title).includes("[claim:roundtrip-files]"));
  for (const name of ["google.ics", "outlook.ics", "apple.ics"]) {
    if (!files.some((test) => String(test.title).includes(name))) failures.push(`the round-trip test of ${name} is not green`);
  }
} catch {
  // checkReport has already counted a missing report as a failure.
}
for (const name of ["google.ics", "outlook.ics", "apple.ics"]) {
  const file = join(core, "test", "ical", "fixtures", name);
  if (!existsSync(file)) {
    failures.push(`sample file missing: ${name}`);
    continue;
  }
  const text = readFileSync(file, "utf8");
  if (/[^\r]\n/.test(text)) failures.push(`${name} does not use CRLF`);
}
finish("ical", failures);
