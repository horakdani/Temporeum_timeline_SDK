#!/usr/bin/env node
/**
 * G-SCHEDULE-CMD: az automatikus utemezes egyetlen parancs, az inverze a
 * pontos kiindulast adja vissza, es a mag utemezes kozben semmit nem ment.
 *
 * Futasidoben: egy 'schedule' parancs, csak a mozgatott feladatokra, pontos
 * inverz sorozatban is, es befagyasztott bemenet mellett, csapdaba tett
 * halozat, tarolo es idozito mellett semmi nem nyul ki. Statikusan: a
 * /schedule forrasaban nincs I/O, tarolo, idozito vagy DOM-hivas, es a
 * parancs a mag createCommand-jabol jon (az inverz-szerzodes ott van).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "packages", "core", "src", "schedule");
const failures = checkReport({
  file: join(root, "packages", "core", ".schedule-command-report.json"),
  label: "utemezo-parancs",
  minTests: 3,
  claims: ["one-command", "inverse-exact", "no-save"],
});

const FORBIDDEN = ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "localStorage", "sessionStorage", "indexedDB", "document.", "navigator.", "setTimeout(", "setInterval(", "queueMicrotask(", "postMessage("];
let code = "";
for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
  const text = codeOf(readFileSync(join(dir, file), "utf8"));
  code += text;
  for (const needle of FORBIDDEN) if (text.includes(needle)) failures.push(`a /schedule (${file}) kinyul: ${needle}`);
}
if (!code.includes('createCommand("schedule"')) failures.push("a scheduleCommand nem a mag createCommand-javal kesziti a 'schedule' parancsot");
finish("G-SCHEDULE-CMD", failures);
