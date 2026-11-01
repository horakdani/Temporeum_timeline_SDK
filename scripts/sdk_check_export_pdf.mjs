#!/usr/bin/env node
/**
 * G-EXPORT-PDF: az exportalt PDF egy fuggetlen elemzovel (pdf.js, stopAtErrors)
 * ervenyes, a szoveg kijelolheto, es a tobb oldalra bontas nem veszit el elemet.
 *
 * A vitest JSON-riportja: minden teszt zold, es a negy allitas mindegyikenek
 * van zold tesztje. A naplo (.export-pdf-log.json) a generalt esetek szamait
 * hozza: eleg eset, eleg tobboldalas eset, es legalabb egy cimke laponkent
 * ellenorizve. Statikusan: a PDF-iro nem importal semmit a magon kivul — a
 * "fuggoseg nelkul" igeret.
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
  failures.push(`nincs naplo (${logFile}) — a generalt lapokra bontas NEM futott, ezert BUKAS`);
} else {
  const log = JSON.parse(readFileSync(logFile, "utf8"));
  if (!(log.cases >= 20)) failures.push(`csak ${String(log.cases)} generalt eset, legalabb 20 kell`);
  if (!(log.multiPage > log.cases / 2)) failures.push(`csak ${String(log.multiPage)} tobboldalas eset — a vagast keves eset meri`);
  if (!(log.labels > 0)) failures.push("egyetlen cimke sem lett laponkent ellenorizve");
  notes.push(`${String(log.cases)} eset, ${String(log.items)} elem, ${String(log.pages)} lap, ${String(log.labels)} cimke laponkent ellenorizve`);
}
// Fuggoseg nelkul: az /export csak a sajat es a mag moduljaibol importal.
const dir = join(core, "src", "export");
for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
  const source = codeOf(readFileSync(join(dir, file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`a /export/${file} kulso modult importal: ${match[1]}`);
  }
}
const pkg = JSON.parse(readFileSync(join(core, "package.json"), "utf8"));
if (Object.keys(pkg.dependencies ?? {}).length > 0) failures.push(`a magnak futasideju fuggosege van: ${Object.keys(pkg.dependencies).join(", ")}`);
finish("G-EXPORT-PDF", failures, notes);
