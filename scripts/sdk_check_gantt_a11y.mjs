#!/usr/bin/env node
/**
 * The gantt-a11y check: a task's predecessors and successors are in its accessible
 * description (in the rendered option's aria-label), and they can be reached
 * with the keyboard: `[` gets to every predecessor, `]` to every successor,
 * wrapping around.
 *
 * Statically it also checks that createTimeline calls the core's
 * resolveDependencyKey and dependencyKeyStep functions, and that the frame's
 * hooks go through ganttHooks.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".gantt-a11y-report.json"),
  label: "gantt-a11y",
  minTests: 4,
  claims: ["links-named", "key-jumps"],
});

const wc = (file) => codeOf(readFileSync(join(root, "packages", "web-component", "src", file), "utf8"));
for (const needle of ["resolveDependencyKey(", "dependencyKeyStep("]) {
  if (!wc("timeline.ts").includes(needle)) failures.push(`createTimeline does not use: ${needle}`);
}
if (!wc("config.ts").includes("ganttHooks(")) failures.push("the frame's hooks do not go through ganttHooks");
finish("gantt-a11y", failures);
