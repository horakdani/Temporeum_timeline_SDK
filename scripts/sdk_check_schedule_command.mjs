#!/usr/bin/env node
/**
 * The schedule-cmd check: auto-scheduling is a single command, its inverse restores
 * the exact starting point, and the core saves nothing while scheduling.
 *
 * At runtime: one 'schedule' command, covering only the moved tasks, with an
 * exact inverse in a sequence too, and with frozen input and trapped
 * network, storage and timers nothing reaches out. Statically: the
 * /schedule source has no I/O, storage, timer or DOM calls, and the command
 * comes from the core's createCommand (where the inverse contract lives).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "packages", "core", "src", "schedule");
const failures = checkReport({
  file: join(root, "packages", "core", ".schedule-command-report.json"),
  label: "schedule-command",
  minTests: 3,
  claims: ["one-command", "inverse-exact", "no-save"],
});

const FORBIDDEN = ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "localStorage", "sessionStorage", "indexedDB", "document.", "navigator.", "setTimeout(", "setInterval(", "queueMicrotask(", "postMessage("];
let code = "";
for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
  const text = codeOf(readFileSync(join(dir, file), "utf8"));
  code += text;
  for (const needle of FORBIDDEN) if (text.includes(needle)) failures.push(`/schedule (${file}) reaches out: ${needle}`);
}
if (!code.includes('createCommand("schedule"')) failures.push("scheduleCommand does not build the 'schedule' command with the core's createCommand");
finish("schedule-cmd", failures);
