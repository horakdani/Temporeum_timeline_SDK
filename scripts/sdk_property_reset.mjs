#!/usr/bin/env node
/**
 * Deletes the property reports BEFORE the run.
 *
 * Why it is needed: the report is the evidence that the property test ran. But
 * a report left over from a previous run reads just as well as a fresh one —
 * so the report of a deleted or never-run property file would give a green
 * tick. The reset is what makes the presence of a report really mean that it
 * ran NOW.
 *
 * Without arguments it drops EVERY report, which is right before a full
 * property run. With suite names it drops only those — a check that runs a
 * single suite (G-INVERSE) must not make the other reports stale, because
 * then the order of the two checks would decide which one fails.
 */
import { readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corePackage = resolve(dirname(fileURLToPath(import.meta.url)), "..", "packages", "core");
const suites = process.argv.slice(2);
const wanted = (name) =>
  suites.length === 0 || suites.some((suite) => name === `.property-report-${suite}.json`);

let removed = 0;
for (const name of readdirSync(corePackage)) {
  if (name.startsWith(".property-report") && name.endsWith(".json") && wanted(name)) {
    rmSync(join(corePackage, name));
    removed += 1;
  }
}
const scope = suites.length === 0 ? "all" : suites.join(", ");
console.log(`property report reset (${scope}): ${String(removed)} stale reports deleted`);
