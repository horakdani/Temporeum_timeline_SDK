#!/usr/bin/env node
/**
 * The i18n check: in a pseudo-locale there is not a single hard-coded string; in at
 * least five locales and three non-Gregorian calendars the ticks align
 * with the calendar's units.
 *
 * It reads two reports, because the library speaks in two places:
 *
 *  1. the core's vitest report (test/i18n/): frames drawn with a pseudo
 *     dictionary in both orientations — names, clusters, Gantt tasks, load,
 *     load bands, band headers — in which no Latin letter remains after the
 *     marked phrases, the host's words and the Intl dates (pseudo); five
 *     calendars (Hebrew, Umm al-Qura, Persian, Chinese, Ethiopic) in three
 *     zones, with a full day-by-day pan: every month and year start is a
 *     tick, and every tick is one (calendar-units); tick labels in six
 *     locales are Intl's own (five-locales); the dictionary's English
 *     matches the built-in one letter for letter (english-equal); plurals
 *     follow the locale's rules (plurals); with hidden dates too
 *     (hidden-calendar);
 *  2. the element's browser report (intl.browser.test.ts): the toolbar, the
 *     group tree, the task table and the waiting list also take their words
 *     from the dictionary (pseudo-element). This check runs it itself, on a
 *     fresh build — it runs before the full suite (`npm run test:all`), and a stale dist would be a false
 *     green.
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const element = join(root, "packages", "web-component");

const failures = checkReport({
  file: join(core, ".i18n-report.json"),
  label: "i18n",
  minTests: 25,
  claims: ["pseudo", "calendar-units", "five-locales", "english-equal", "plurals", "hidden-calendar"],
});

// The element's half: a fresh build, then its browser i18n suite, into its own report.
const elementReport = join(element, ".i18n-element-report.json");
rmSync(elementReport, { force: true });
try {
  execFileSync("npm", ["run", "--silent", "build", "-w", "@temporeum/timeline-core"], { cwd: root, stdio: "pipe" });
  execFileSync("npm", ["run", "--silent", "build", "-w", "@temporeum/timeline-element"], { cwd: root, stdio: "pipe" });
  execFileSync("npx", ["vitest", "run", "--project", "browser", "test/intl.browser.test.ts", "--reporter=json", `--outputFile.json=${elementReport}`], { cwd: element, stdio: "pipe" });
} catch (error) {
  if (!existsSync(elementReport)) failures.push(`the element's i18n suite did not run: ${String(error).split("\n")[0]}`);
}
failures.push(...checkReport({ file: elementReport, label: "element-i18n", minTests: 5, claims: ["pseudo-element", "rtl-element", "calendar-element"] }));

finish("i18n", failures);
