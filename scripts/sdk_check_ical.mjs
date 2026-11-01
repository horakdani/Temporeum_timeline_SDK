#!/usr/bin/env node
/**
 * G-ICAL: egy iCal-fajl importja es exportja oda-vissza ugyanazt az
 * esemenyhalmazt adja.
 *
 * A vitest-riportbol: minden allitasnak van zold tesztje, es a harom
 * mintafajl (Google, Outlook, Apple alakja) mind kulon tesztkent zold. A
 * mintafajlok leteznek es CRLF-esek — egy LF-re mentett mintafajl a
 * sortores-kezelest mar nem bizonyitana.
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
    if (!files.some((test) => String(test.title).includes(name))) failures.push(`a(z) ${name} oda-vissza tesztje nem zold`);
  }
} catch {
  // A riport hianyat a checkReport mar bukasnak vette.
}
for (const name of ["google.ics", "outlook.ics", "apple.ics"]) {
  const file = join(core, "test", "ical", "fixtures", name);
  if (!existsSync(file)) {
    failures.push(`hianyzik a mintafajl: ${name}`);
    continue;
  }
  const text = readFileSync(file, "utf8");
  if (/[^\r]\n/.test(text)) failures.push(`a(z) ${name} nem CRLF-es`);
}
finish("G-ICAL", failures);
