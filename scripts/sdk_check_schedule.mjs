#!/usr/bin/env node
/**
 * G-SCHEDULE: generalt projekteken az utemezes minden fuggoseget, megkotest
 * es munkanaptarat betart, idempotens, kis eseteken egyezik egy kimerito
 * referencia-megoldassal, es a kritikus ut pontosan a nulla tartaleku
 * feladatok lanca.
 *
 * A munkaido-szamitast a negyedorak megszamolasaval ellenorzi (calendar), a
 * tobbi allitas ebben a munkaidoben mer. Statikusan azt is nezi, hogy az
 * utemezo a /schedule belepesi ponton van, es a /gantt-bol csak tipust hoz:
 * a ket belepesi pont kodja nem keveredik.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".schedule-report.json"),
  label: "utemezo",
  minTests: 13,
  claims: ["calendar", "dependencies", "constraints", "calendars", "idempotent", "reference", "critical-path"],
});

const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "schedule" && entry.input === "src/schedule/index.ts")) {
  failures.push("a schedule belepesi pont hianyzik az entries.json-bol");
}
const source = codeOf(readFileSync(join(core, "src", "schedule", "index.ts"), "utf8"));
for (const line of source.split("\n").filter((each) => each.includes("gantt/index.js"))) {
  if (!/^\s*(import|export) type /.test(line)) failures.push(`a /schedule nem csak tipust hoz a /gantt-bol: ${line.trim()}`);
}
finish("G-SCHEDULE", failures);
