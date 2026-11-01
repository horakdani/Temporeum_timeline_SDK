#!/usr/bin/env node
/**
 * G-RRULE: az RFC 5545 peldai es egy fuggetlen referencia-implementacioval
 * eloallitott tesztvektorok kimenete pontosan egyezik, a nyari idoszamitas
 * valtasain at is.
 *
 * A vitest-riportbol: minden allitasnak van zold tesztje, es az RFC mind a
 * 42 peldaja kulon tesztkent zold. A vektorfajlbol: a dateutil irta (a
 * generator a scripts/sdk_rrule_vectors.py), legalabb 800 eset, es legalabb
 * 100 atlep egy oraatallitast — kulonben a "valtasain at is" nem allitas.
 * Statikusan: az RRULE a /calendar sajat kodja, nem fuggoseg.
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
  if (examples.length < 43) failures.push(`csak ${String(examples.length)} zold [claim:rfc-examples] teszt (a 42 pelda es a teljesseg kell)`);
} catch {
  // A riport hianyat a checkReport mar bukasnak vette.
}

const examples = JSON.parse(readFileSync(join(core, "test", "rrule", "rfc5545-examples.json"), "utf8")).examples;
if (examples.length !== 42) failures.push(`az RFC 5545 3.8.5.3 peldaibol ${String(examples.length)} van a fixture-ben, 42 kell`);
const vectors = JSON.parse(readFileSync(join(core, "test", "rrule", "vectors.json"), "utf8"));
if (vectors.generator !== "python-dateutil") failures.push(`a vektorokat nem a dateutil irta: ${String(vectors.generator)}`);
if ((vectors.cases ?? []).length < 800) failures.push(`csak ${String(vectors.cases?.length)} vektor, legalabb 800 kell`);
if ((vectors.crossingClockChange ?? 0) < 100) failures.push(`csak ${String(vectors.crossingClockChange)} vektor lep at oraatallitast, legalabb 100 kell`);
notes.push(`${String(vectors.cases?.length)} dateutil-vektor (${String(vectors.dateutil)}), ${String(vectors.crossingClockChange)} oraatallitason at; kihagyva: ${JSON.stringify(vectors.skipped)}`);

const source = codeOf(readFileSync(join(core, "src", "calendar", "rrule.ts"), "utf8"));
for (const line of source.split("\n").filter((each) => /^\s*import /.test(each))) {
  if (!/from "\.\.?\//.test(line)) failures.push(`az RRULE nem sajat kodbol importal: ${line.trim()}`);
}
finish("G-RRULE", failures, notes);
