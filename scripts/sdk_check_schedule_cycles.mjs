#!/usr/bin/env node
/**
 * The cycle check: a dependency graph with a cycle reports an error naming the
 * cycle's members in finite time, and changes nothing.
 *
 * The members are measured against a brute-force reachability reference
 * (cycle-members), finite time on a 10 000-node ring and on a 2000-node,
 * 20 000-arrow tangle (finite), and that nothing changes (nothing-changed).
 * Statically: cycle detection is not recursive — a 10 000-node cycle would
 * drive a recursive search to the bottom of the stack.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".schedule-cycles-report.json"),
  label: "schedule-cycle",
  minTests: 3,
  claims: ["cycle-members", "finite", "nothing-changed"],
});
const source = codeOf(readFileSync(join(root, "packages", "core", "src", "schedule", "index.ts"), "utf8"));
const body = /function cyclesOf\([\s\S]*?\n}\n/.exec(source)?.[0];
if (body === undefined) failures.push("cyclesOf is missing from /schedule");
else if ((body.match(/cyclesOf\(/g) ?? []).length > 1) failures.push("cyclesOf is recursive");
finish("cycle", failures);
