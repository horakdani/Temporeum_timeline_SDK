#!/usr/bin/env node
/**
 * G-GESTURE: bizonyitja, hogy a gesztus-keszlet tenyleg lefutott, es hogy
 * amit mer, az a VALODI csovezetek.
 *
 * A kapu `proof` mezoje negy dolgot allit: pan, pinch, pointercancel, es ujj
 * felemelese pinch kozben. Egy tesztfajl, amibol az egyik csendben kimarad,
 * zold pipat ad — a vitest nem tudja, hogy valamit meg kellett volna merni.
 *
 * Harom fuggetlen ellenorzes:
 *
 *  1. FUTASIDEJU: a vitest JSON-riportjaban minden kotelezo allitasnak lennie
 *     kell, es mindnek zolden. A riport hianya BUKAS, nem kihagyas.
 *  2. STATIKUS — a mertek: a tesztfajl a mag `createInputMachine` exportjat
 *     hajtja, mind a negy pointer-fazist feladja neki, legalabb harom
 *     pointert hasznal, es a horgonyzast a mag sajat `createTimeScale`-javal
 *     meri, nem helyi kepletbol.
 *  3. STATIKUS — a csovezetek: az `input.ts` nem lat orat es nem hasznal
 *     idozitot (ettol reprodukalhato egy szekvencia), a `dom/attach.ts` pedig
 *     nem ertelmez gesztust (ettol EGY csovezetek van, nem ketto).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const testFile = join(corePackage, "test", "gesture", "pointer.test.ts");
const machineFile = join(corePackage, "src", "input.ts");
const bindingFile = join(corePackage, "src", "dom", "attach.ts");
const reportFile = join(corePackage, ".gesture-report.json");

const MIN_TESTS = 10;
/** A kapu proof-ja ezeket allitja; mindegyikhez kell egy zold teszt. */
const REQUIRED_CLAIMS = [
  "one pointer",
  "two pointers",
  "pointercancel",
  "lifting one finger during a pinch",
  "double tap",
  "two-finger tap",
  "drag threshold",
  "wheel",
  "both orientations",
];
/** Ha ezek barmelyike bekerul a magba, egy szekvencia nem reprodukalhato. */
const FORBIDDEN_IN_MACHINE = [
  "Date.now",
  "performance.now",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "new Date(",
];
/** Ha ezek barmelyike bekerul a kotesbe, ket helyen ertelmezunk gesztust. */
const FORBIDDEN_IN_BINDING = ["zoomDomainAt", "panDomainBy", "clampDomain", "createTimeScale"];

const failures = [];
const notes = [];

// --- 1. FUTASIDEJU -----------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `nincs vitest-riport (${reportFile}) — a gesztus-keszlet NEM futott le, ezert BUKAS`,
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);
  if (tests.length < MIN_TESTS) {
    failures.push(
      `${String(tests.length)} gesztus-teszt futott, de legalabb ${String(MIN_TESTS)} kell`,
    );
  }
  for (const test of tests) {
    if (test.status !== "passed") {
      failures.push(`nem zold gesztus-teszt: ${String(test.fullName)} (${String(test.status)})`);
    }
  }
  const names = tests.map((test) => String(test.fullName).toLowerCase());
  for (const claim of REQUIRED_CLAIMS) {
    const covered = names.some((name) => name.includes(claim.toLowerCase()));
    if (!covered) {
      failures.push(`a kapu allit valamit, amit senki nem mer: "${claim}"`);
    }
  }
  if (failures.length === 0) {
    notes.push(
      `${String(tests.length)} gesztus-teszt, mind zold, es mind a ` +
        `${String(REQUIRED_CLAIMS.length)} kotelezo allitasra van teszt`,
    );
  }
}

// --- 2. STATIKUS: a mertek ---------------------------------------------------

if (!existsSync(testFile)) {
  failures.push(`nincs gesztus-tesztfajl: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");
  if (!/import\s*\{[^}]*\bcreateInputMachine\b[^}]*\}\s*from\s*"\.\.\/\.\.\/src\/input\.js"/.test(source)) {
    failures.push("a gesztus-teszt nem a mag createInputMachine exportjat hajtja");
  }
  for (const phase of ["down", "move", "up", "cancel"]) {
    if (!source.includes(`"${phase}"`)) {
      failures.push(`a gesztus-teszt nem adja fel a ${phase} fazist — a sor nem teljes`);
    }
  }
  const pointerIds = new Set([...source.matchAll(/at\(\s*(\d+)\s*,/g)].map((m) => m[1]));
  if (pointerIds.size < 3) {
    failures.push(
      `${String(pointerIds.size)} pointer-azonosito a tesztben, de a harmadik ujj viselkedese is allitas`,
    );
  }
  if (!/createTimeScale/.test(source)) {
    failures.push(
      "a horgonyzast nem a mag createTimeScale-javal meri — egy helyi keplet ugyanazt a hibat tartalmazhatja",
    );
  }
  if (failures.length === 0) {
    notes.push(
      `a mertek a valodi csovezeteket hajtja: mind a 4 pointer-fazis, ${String(pointerIds.size)} pointer, a mag skalajaval merve`,
    );
  }
}

// --- 3. STATIKUS: a csovezetek -----------------------------------------------

const machine = existsSync(machineFile) ? readFileSync(machineFile, "utf8") : "";
if (machine === "") {
  failures.push(`nincs bemeneti csovezetek: ${machineFile}`);
}
for (const forbidden of FORBIDDEN_IN_MACHINE) {
  // A kommentek nem szamitanak: csak a kodot nezzuk.
  const code = machine.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (code.includes(forbidden)) {
    failures.push(
      `a bemeneti csovezetek ${forbidden}-t hasznal — egy szekvencia igy nem reprodukalhato, es a gesztus-teszt flaky lesz`,
    );
  }
}

const binding = existsSync(bindingFile) ? readFileSync(bindingFile, "utf8") : "";
if (binding === "") {
  failures.push(`nincs bongeszo-kotes: ${bindingFile}`);
}
for (const forbidden of FORBIDDEN_IN_BINDING) {
  if (binding.includes(forbidden)) {
    failures.push(
      `a bongeszo-kotes ${forbidden}-t hasznal — a gesztus ertelmezese ketfele kerul, es EGY csovezetek volt a lenyeg`,
    );
  }
}
if (machine !== "" && binding !== "" && failures.length === 0) {
  notes.push("a mag ora- es idozitomentes, a kotes pedig nem ertelmez gesztust");
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
  console.error(`\nG-GESTURE BUKOTT: ${String(failures.length)} hiba.`);
  process.exit(1);
}

console.log("\nG-GESTURE atment: szintetikus pointer-szekvenciak hajtjak az EGYETLEN csovezeteket.");
