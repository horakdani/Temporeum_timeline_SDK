#!/usr/bin/env node
/**
 * G-COMPAT (P28): a vis-timeline dokumentaciojanak peldai a kompatibilitasi
 * retegen at ugyanazokat az elemeket ugyanarra az idore es csoportba teszik.
 *
 * A vitest-riportbol: minden allitasnak van zold tesztje, es minden
 * dokumentacios pelda kulon tesztkent zold (a vektorfajl peldainak szama
 * + 1). A vektorfajlbol: a vis-timeline 8.5.6 irta (a generator a
 * scripts/sdk_vis_compat_vectors.mjs), legalabb 80 pelda es 2000 elem, van
 * csoportos pelda es van a sajat szelso eseteket hordozo lap; a kihagyott
 * peldak oka kiirva. Statikusan: a reteg sajat kod (nem importal vis-t vagy
 * momentet), es a /vis-compat belepesi pont a entries.json-ban van.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const reportFile = join(core, ".vis-compat-report.json");
const vectors = JSON.parse(readFileSync(join(core, "test", "vis-compat", "vectors.json"), "utf8"));
const docs = (vectors.vectors ?? []).filter((vector) => !String(vector.page).startsWith("edge/"));
const failures = checkReport({
  file: reportFile,
  label: "vis-compat",
  minTests: docs.length + 8,
  claims: ["docs-examples", "group-order", "edge-times", "warnings", "options", "negative-control"],
});
const notes = [];
try {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const green = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []).filter((test) => test.status === "passed" && String(test.title).includes("[claim:docs-examples]"));
  if (green.length < docs.length + 1) failures.push(`csak ${String(green.length)} zold [claim:docs-examples] teszt, ${String(docs.length + 1)} kell (peldankent egy, es a teljesseg)`);
} catch {
  // A riport hianyat a checkReport mar bukasnak vette.
}

if (vectors.visTimeline !== "8.5.6") failures.push(`a vektorokat nem a vis-timeline 8.5.6 irta: ${String(vectors.visTimeline)}`);
if (!String(vectors.$comment ?? "").includes("sdk_vis_compat_vectors.mjs")) failures.push("a vektorfajl nem a generator kimenete");
const items = docs.reduce((sum, vector) => sum + (vector.vis?.items?.length ?? 0), 0);
if (docs.length < 80) failures.push(`csak ${String(docs.length)} dokumentacios pelda, legalabb 80 kell`);
if (items < 2000) failures.push(`csak ${String(items)} elem, legalabb 2000 kell`);
if (!docs.some((vector) => vector.vis?.groupOrder !== null)) failures.push("nincs csoportos pelda a vektorok kozott");
if (!(vectors.vectors ?? []).some((vector) => String(vector.page).startsWith("edge/"))) failures.push("hianyzik a szelso esetek lapja");
notes.push(`${String(docs.length)} vis-pelda, ${String(items)} elem, zona ${String(vectors.timeZone)}; kihagyva: ${(vectors.skipped ?? []).map((each) => `${each.page} (${each.reason})`).join(", ")}`);

for (const file of ["index.ts", "convert.ts", "time.ts"]) {
  const source = codeOf(readFileSync(join(core, "src", "vis-compat", file), "utf8"));
  for (const line of source.split("\n").filter((each) => /^\s*import /.test(each))) {
    if (!/from "\.\.?\//.test(line)) failures.push(`a vis-compat nem sajat kodbol importal (${file}): ${line.trim()}`);
  }
}
const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "vis-compat" && entry.input === "src/vis-compat/index.ts")) failures.push("a /vis-compat nincs a belepesi pontok kozott (entries.json)");
finish("G-COMPAT", failures, notes);
