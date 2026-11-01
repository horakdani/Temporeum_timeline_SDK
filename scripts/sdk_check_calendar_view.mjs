#!/usr/bin/env node
/**
 * G-CALENDAR-VIEW: a heti es napi nezetben az atfedo esemenyek egymas melle
 * kerulnek, egyik sem takar mast, es billentyuvel bejarhatok.
 *
 * A vitest-riportbol: minden allitasnak van zold tesztje. Statikusan: a
 * nezet a /calendar belepesi ponton van, es az elem nezete a mag
 * dontesfuggvenyeit hivja (resolveCalendarKey, calendarKeyStep,
 * calendarHit), nem sajat billentyu- vagy talalat-logikat.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".calendar-view-report.json"),
  label: "naptarnezet",
  minTests: 14,
  claims: ["side-by-side", "no-cover", "complete", "keyboard", "scene", "wall-clock"],
});
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "calendar" && entry.input === "src/calendar/index.ts")) failures.push("a calendar belepesi pont hianyzik az entries.json-bol");
const view = codeOf(readFileSync(join(root, "packages", "web-component", "src", "calendar-view.ts"), "utf8"));
for (const name of ["resolveCalendarKey(", "calendarKeyStep(", "calendarHit(", "layoutDays(", "calendarScene("]) {
  if (!view.includes(name)) failures.push(`az elem naptarnezete nem a mag ${name.slice(0, -1)} fuggvenyet hivja`);
}
if (!view.includes('addEventListener("keydown", onKey)')) failures.push("az elem naptarnezete nem figyeli a keydown-t");
finish("G-CALENDAR-VIEW", failures);
