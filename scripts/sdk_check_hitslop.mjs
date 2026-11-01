#!/usr/bin/env node
/**
 * G-HITSLOP: bizonyitja, hogy erdes pointerrel a 2 px-es elem is
 * eltalalhato — es hogy ez a POINTER erdeme, nem egy mindenkinek kiosztott
 * nagy zonae.
 *
 * Miert nem eleg egy "a 2 px-es elem eltalalhato" teszt: egy vegtelen
 * raharas is atengedne. Az az idovonal, ahol minden nyomas megfog valamit,
 * pontosan olyan hasznalhatatlan, mint az, ahol semmit. Ezert a kapu
 * PAROKAT ker: minden "eler" allitas mellett egy "nem er el" allitast.
 *
 * Harom fuggetlen ellenorzes:
 *
 *  1. FUTASIDEJU — a keszlet: a vitest JSON-riportjaban minden kotelezo
 *     allitasnak zolden kell lennie, MINDKET orientacioban. A raharas
 *     (main, cross) terben keszul; ha csak vizszintesen igaz, akkor a
 *     fuggoleges idovonalon egy ujj a szomszed sort fogja meg. A riport
 *     hianya BUKAS.
 *  2. STATIKUS — a csovezetek: a bemeneti gep a pointer tipusat ATADJA a
 *     talalati tablanak. Enelkul a zona a fuggvenyben letezik, a gesztusban
 *     nem — es a kapu egy olyan kepesseget bizonyitana, amit egy ujj soha
 *     nem kap meg.
 *  3. STATIKUS — egy szam, egy hely: a 4 / 12 / 24 a responsive.ts-ben van
 *     definialva, es a talalati tabla onnan kerdezi. Ez a P4 touchAction-
 *     hibajanak tanulsaga: ugyanaz a szam ket helyen = az egyik elcsuszik.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const srcDir = join(corePackage, "src");
const reportFile = join(corePackage, ".hitslop-report.json");
const machineFile = join(srcDir, "input.ts");
const testerFile = join(srcDir, "editing.ts");
const responsiveFile = join(srcDir, "responsive.ts");

const MIN_TESTS = 20;
/** A proof allitasai, parban: amit eler, es amit NEM. */
const REQUIRED_CLAIMS = [
  // eler
  "a finger reaches a 2 px item it misses by 10 px along time",
  "a finger reaches a 2 px item it misses by 10 px across the lanes",
  "a finger long press picks up the 2 px item",
  "dense raises even a mouse's target to 24 px",
  // nem er el
  "a mouse does not reach the same item from 10 px",
  "a mouse press at the same pixel picks up nothing",
  "without a pointer type the geometry is exact",
  "without a pointer type even dense stays exact",
  // nem lop
  "an exact hit wins over a slop hit on a neighbour",
  "in the gap between two items the nearest one wins",
  "a slop hit is the body, never a handle",
  "dense turns resizing off",
];

const failures = [];
const notes = [];

const codeOf = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- 1. FUTASIDEJU ------------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(`nincs vitest-riport (${reportFile}) — a talalati zona keszlete NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);
  if (tests.length < MIN_TESTS) {
    failures.push(`${String(tests.length)} teszt futott, de legalabb ${String(MIN_TESTS)} kell`);
  }
  for (const test of tests) {
    if (test.status !== "passed") {
      failures.push(`nem zold teszt: ${String(test.fullName)} (${String(test.status)})`);
    }
  }
  for (const claim of REQUIRED_CLAIMS) {
    for (const orientation of ["horizontal", "vertical"]) {
      const found = tests.some(
        (test) =>
          test.status === "passed" &&
          String(test.fullName).includes(`[${orientation}]`) &&
          String(test.fullName).includes(claim),
      );
      if (!found) {
        failures.push(`nincs zold teszt ${orientation} orientacioban erre: "${claim}"`);
      }
    }
  }
  if (failures.length === 0) {
    notes.push(
      `${String(tests.length)} teszt zold; ${String(REQUIRED_CLAIMS.length)} allitas x 2 orientacio, eler/nem er el parban`,
    );
  }
}

// --- 2. STATIKUS: a csovezetek -----------------------------------------------

const machine = existsSync(machineFile) ? codeOf(readFileSync(machineFile, "utf8")) : "";
if (machine === "") {
  failures.push(`nincs bemeneti gep: ${machineFile}`);
} else if (!/hitTest\(\s*\{[^}]*\}\s*,\s*pointer\.pointerType\s*\)/.test(machine)) {
  failures.push(
    "a bemeneti gep nem adja at a pointer tipusat a talalati tablanak — a zona a gesztusban nem letezik",
  );
} else {
  notes.push("a gep a lenyomas pointer-tipusat adja a talalati tablanak");
}

// --- 3. STATIKUS: egy szam, egy hely -----------------------------------------

const responsive = existsSync(responsiveFile) ? codeOf(readFileSync(responsiveFile, "utf8")) : "";
const tester = existsSync(testerFile) ? codeOf(readFileSync(testerFile, "utf8")) : "";
if (responsive === "") {
  failures.push(`nincs responsive.ts: ${responsiveFile}`);
} else {
  for (const [name, value] of [
    ["HIT_SLOP_FINE", 4],
    ["HIT_SLOP_COARSE", 12],
    ["DENSE_MIN_TARGET", 24],
  ]) {
    if (!new RegExp(`export const ${name} = ${String(value)};`).test(responsive)) {
      failures.push(`a responsive.ts nem definialja: ${name} = ${String(value)}`);
    }
    const elsewhere = readdirSync(srcDir, { recursive: true })
      .filter((name_) => String(name_).endsWith(".ts") && String(name_) !== "responsive.ts")
      .filter((file) =>
        new RegExp(`const ${name}\\b`).test(readFileSync(join(srcDir, String(file)), "utf8")),
      );
    if (elsewhere.length > 0) {
      failures.push(`a ${name} masodik helyen is definialva van: ${elsewhere.join(", ")}`);
    }
  }
}
if (tester === "") {
  failures.push(`nincs talalati tabla: ${testerFile}`);
} else if (
  !/import\s*\{[^}]*\bhitSlopFor\b[^}]*\bslopForExtent\b[^}]*\}\s*from\s*"\.\/responsive\.js"/.test(tester)
) {
  failures.push("a talalati tabla nem a responsive.ts-tol kerdezi a zonat");
} else {
  notes.push("a 4 / 12 / 24 egy helyen van, es a talalati tabla onnan kerdezi");
}

// --- Eredmeny ----------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}
if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  HIBA ${failure}`);
  }
  console.error(`\nG-HITSLOP BUKOTT: ${String(failures.length)} hiba.`);
  process.exit(1);
}
console.log("\nG-HITSLOP atment: erdes pointerrel a 2 px-es elem is eltalalhato, egerrel nem lop.");
