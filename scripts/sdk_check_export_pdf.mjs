#!/usr/bin/env node
/**
 * The export-pdf check: the exported PDF is valid according to an independent parser
 * (pdf.js, stopAtErrors), its text is selectable, and splitting it across
 * pages loses no item.
 *
 * The vitest JSON report: every test passes, and each of the four claims has
 * a passing test. The log (.export-pdf-log.json) brings the counts of the
 * generated cases: enough cases, enough multi-page cases, and at least one
 * label checked per page. Statically: the PDF writer imports nothing outside
 * the core — the "no dependencies" promise.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".export-pdf-report.json"),
  label: "export-pdf",
  minTests: 10,
  claims: ["valid", "selectable", "no-item-lost", "deterministic"],
});
const notes = [];
const logFile = join(core, ".export-pdf-log.json");
if (!existsSync(logFile)) {
  failures.push(`no log (${logFile}) — the generated page splitting did NOT run, so this is a FAILURE`);
} else {
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  if (!(log.cases >= 20)) failures.push(`only ${String(log.cases)} generated cases, at least 20 are required`);
  if (!(log.multiPage > log.cases / 2)) failures.push(`only ${String(log.multiPage)} multi-page cases — too few cases measure the cutting`);
  if (!(log.labels > 0)) failures.push("not a single label was checked per page");
  notes.push(`${String(log.cases)} cases, ${String(log.items)} items, ${String(log.pages)} pages, ${String(log.labels)} labels checked per page`);
}
// No dependencies: /export imports only from its own and the core's modules.
const dir = join(core, "src", "export");
for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
  const source = codeOf(readFileSync(join(dir, file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`/export/${file} imports an external module: ${match[1]}`);
  }
}
const pkg = JSON.parse(readFileSync(join(core, "package.json"), "utf8"));
if (Object.keys(pkg.dependencies ?? {}).length > 0) failures.push(`the core has runtime dependencies: ${Object.keys(pkg.dependencies).join(", ")}`);
finish("export-pdf", failures, notes);
