#!/usr/bin/env node
/**
 * G-CYCLE: egy koros fuggosegi graf veges idon belul hibat jelent a kor
 * tagjaival, es nem modosit semmit.
 *
 * A tagokat egy nyers eleresi referencia ellen merjuk (cycle-members), a
 * veges idot egy 10 000 tagu gyurun es egy 2000 tagu, 20 000 nyilas
 * gubancon (finite), es azt, hogy semmi nem valtozik (nothing-changed).
 * Statikusan: a korkereses nem rekurziv — egy 10 000 tagu kor egy rekurziv
 * keresest a verem aljaig vinne.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".schedule-cycles-report.json"),
  label: "utemezo-kor",
  minTests: 3,
  claims: ["cycle-members", "finite", "nothing-changed"],
});
const source = codeOf(readFileSync(join(root, "packages", "core", "src", "schedule", "index.ts"), "utf8"));
const body = /function cyclesOf\([\s\S]*?\n}\n/.exec(source)?.[0];
if (body === undefined) failures.push("a cyclesOf hianyzik a /schedule-bol");
else if ((body.match(/cyclesOf\(/g) ?? []).length > 1) failures.push("a cyclesOf rekurziv");
finish("G-CYCLE", failures);
