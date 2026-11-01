#!/usr/bin/env node
/**
 * G-MINIMAP: az attekinto sav ablakanak huzasa ugyanazt a nezetet adja, mint a megfelelo pasztazas (panDomainBy), rejtett datumokkal is; billentyuvel is. Statikusan: a minimap.ts minden mozgatasa a panDomainBy-ba fut.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".minimap-report.json"),
  label: "attekinto-sav",
  minTests: 10,
  claims: ["drag-is-pan", "keyboard"],
  orientations: true,
});

// A /tools a sajat belepesi pontjan van, es csak az alapbol importal.
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "tools" && entry.input === "src/tools/index.ts")) failures.push("a tools belepesi pont hianyzik az entries.json-bol");
for (const file of ["minimap.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "tools", file), "utf8"));
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    if (!/^\.\.?\/[a-z0-9-]+\.js$/.test(match[1])) failures.push(`a /tools/${file} nem az alapbol importal: ${match[1]}`);
  }
}
const minimap = codeOf(readFileSync(join(core, "src", "tools", "minimap.ts"), "utf8"));
for (const name of ["minimapDragDomain", "minimapKeyDomain"]) {
  const body = minimap.slice(minimap.indexOf(`export function ${name}(`));
  const end = body.indexOf("\n}\n");
  if (!body.slice(0, end).includes("panDomainBy(") && !body.slice(0, end).includes("minimapDragDomain(")) failures.push(`a ${name} nem a panDomainBy-ba fut`);
}

finish("G-MINIMAP", failures);
