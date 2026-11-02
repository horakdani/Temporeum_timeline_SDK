#!/usr/bin/env node
/**
 * G-SCHEDULE: on generated projects, scheduling honours every dependency,
 * constraint and working calendar, is idempotent, matches an exhaustive
 * reference solver on small cases, and the critical path is exactly the
 * chain of zero-slack tasks.
 *
 * Working-time arithmetic is checked by counting quarter hours (calendar);
 * the other claims measure in that working time. Statically it also checks
 * that the scheduler lives on the /schedule entry point and takes only types
 * from /gantt: the code of the two entry points does not mix.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".schedule-report.json"),
  label: "scheduler",
  minTests: 13,
  claims: ["calendar", "dependencies", "constraints", "calendars", "idempotent", "reference", "critical-path"],
});

const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "schedule" && entry.input === "src/schedule/index.ts")) {
  failures.push("the schedule entry point is missing from entries.json");
}
const source = codeOf(readFileSync(join(core, "src", "schedule", "index.ts"), "utf8"));
for (const line of source.split("\n").filter((each) => each.includes("gantt/index.js"))) {
  if (!/^\s*(import|export) type /.test(line)) failures.push(`/schedule takes more than types from /gantt: ${line.trim()}`);
}
finish("G-SCHEDULE", failures);
