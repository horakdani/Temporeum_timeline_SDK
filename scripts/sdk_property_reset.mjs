#!/usr/bin/env node
/**
 * Torli a property-riportokat a futas ELOTT.
 *
 * Miert kell: a riport a bizonyitek arra, hogy a property-teszt lefutott. Egy
 * elozo futasbol ottmaradt riport viszont ugyanolyan jol olvashato, mint egy
 * friss — tehat egy torolt vagy soha le nem futott property-fajl riportja
 * zold pipat adna. A reset az, ami miatt a riport jelenlete tenyleg azt
 * jelenti, hogy MOST futott le.
 *
 * Argumentum nelkul MINDEN riportot eldob, ami a teljes property-futas elott
 * a helyes. Keszletnevekkel csak azokat — egy kapu, ami egyetlen keszletet
 * futtat (G-INVERSE), nem teheti elavultta a tobbi riportjat, mert akkor a
 * ket kapu sorrendje dontene el, melyik bukik.
 */
import { readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const corePackage = resolve(dirname(fileURLToPath(import.meta.url)), "..", "packages", "core");
const suites = process.argv.slice(2);
const wanted = (name) =>
  suites.length === 0 || suites.some((suite) => name === `.property-report-${suite}.json`);

let removed = 0;
for (const name of readdirSync(corePackage)) {
  if (name.startsWith(".property-report") && name.endsWith(".json") && wanted(name)) {
    rmSync(join(corePackage, name));
    removed += 1;
  }
}
const scope = suites.length === 0 ? "mind" : suites.join(", ");
console.log(`property-riport reset (${scope}): ${String(removed)} elavult riport torolve`);
