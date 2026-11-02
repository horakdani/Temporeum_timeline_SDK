#!/usr/bin/env node
/**
 * G-MINIMAP: dragging the overview bar's window gives the same view as the matching pan (panDomainBy), with hidden dates too; by keyboard too. Statically: every move in minimap.ts runs into panDomainBy.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".minimap-report.json"),
  label: "minimap",
  minTests: 10,
  claims: ["drag-is-pan", "keyboard"],
  orientations: true,
});

// /tools has its own entry point and imports only from the base.
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "tools" && entry.input === "src/tools/index.ts")) failures.push("the tools entry point is missing from entries.json");
for (const file of ["minimap.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "tools", file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`/tools/${file} imports from outside the base: ${match[1]}`);
  }
}
const minimap = codeOf(readFileSync(join(core, "src", "tools", "minimap.ts"), "utf8"));
for (const name of ["minimapDragDomain", "minimapKeyDomain"]) {
  const body = minimap.slice(minimap.indexOf(`export function ${name}(`));
  const end = body.indexOf("\n}\n");
  if (!body.slice(0, end).includes("panDomainBy(") && !body.slice(0, end).includes("minimapDragDomain(")) failures.push(`${name} does not run into panDomainBy`);
}

finish("G-MINIMAP", failures);
