#!/usr/bin/env node
/**
 * G-RESOURCES: generalt hozzarendeleseken a kihasznaltsag minden idoresben
 * a hozzarendelesek osszege, a tulfoglalas pontosan ott jelolt, ahol a
 * kapacitas felett van, es az athuzas visszafordithato parancs.
 *
 * Futasidoben harom allitas (load-sum, overload-exact, reassign): a terhelest
 * egy, az elemekbol egyenesen kiolvasott referencia-osszeg ellen; a jeloleseket
 * (sav, piros oszlop, tulfoglalt elem) a referencia ellen, nem a soepres ellen;
 * az atrendelest a valodi bemeneti geppel, huzassal barmely sorra (a terhelesi
 * sav az eroforrasat jelenti) es Alt+nyillal. Statikusan: a /resources a
 * sajat belepesi pontjan van, es egyetlen masik belepesi pont kodjat sem
 * hozza — csak az alapbol importal.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const failures = checkReport({
  file: join(core, ".resources-report.json"),
  label: "eroforrasok",
  minTests: 9,
  claims: ["load-sum", "overload-exact", "reassign"],
});

const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "resources" && entry.input === "src/resources/index.ts")) {
  failures.push("a resources belepesi pont hianyzik az entries.json-bol");
}
const source = codeOf(readFileSync(join(core, "src", "resources", "index.ts"), "utf8"));
for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
  const target = match[1];
  // Csak az alap: ../a11y.js, ../render.js ... — egy masik belepesi pont (../gantt/, ../items/ ...) kodja nem.
  if (!/^\.\.\/[a-z0-9-]+\.js$/.test(target)) failures.push(`a /resources nem az alapbol importal: ${target}`);
}
finish("G-RESOURCES", failures);
