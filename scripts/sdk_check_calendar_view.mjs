#!/usr/bin/env node
/**
 * G-CALENDAR-VIEW: in the week and day views overlapping events sit side by
 * side, none covers another, and they can be walked with the keyboard.
 *
 * From the vitest report: every claim has a passing test. Statically: the
 * view lives at the /calendar entry point, and the element's view calls the
 * core's decision functions (resolveCalendarKey, calendarKeyStep,
 * calendarHit), not keyboard or hit-testing logic of its own.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".calendar-view-report.json"),
  label: "calendar view",
  minTests: 14,
  claims: ["side-by-side", "no-cover", "complete", "keyboard", "scene", "wall-clock"],
});
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "calendar" && entry.input === "src/calendar/index.ts")) failures.push("the calendar entry point is missing from entries.json");
const view = codeOf(readFileSync(join(root, "packages", "web-component", "src", "calendar-view.ts"), "utf8"));
for (const name of ["resolveCalendarKey(", "calendarKeyStep(", "calendarHit(", "layoutDays(", "calendarScene("]) {
  if (!view.includes(name)) failures.push(`the element's calendar view does not call the core's ${name.slice(0, -1)} function`);
}
if (!view.includes('addEventListener("keydown", onKey)')) failures.push("the element's calendar view does not listen for keydown");
finish("G-CALENDAR-VIEW", failures);
