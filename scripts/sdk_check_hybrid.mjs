#!/usr/bin/env node
/**
 * G-HYBRID: bizonyitja, hogy UGYANABBAN a munkamenetben, UGYANAZON a
 * gep-peldanyon egerrel azonnal indul a huzas, ujjal pedig long-press kell.
 *
 * Miert ez a kapu: egy erintokijelzos laptop egy gep ket kezzel, es a
 * hasznalo kozben valt. Egy fel masodpercig tartott eger elromlottnak
 * erzodik, egy kontaktusra huzo ujjtol pedig a lista gorgethetetlen. A
 * konnyu hiba nem az, hogy valamelyik nem mukodik, hanem hogy a gep BELERAGAD
 * abba a kezbe, amelyik utoljara hozzaert.
 *
 * Harom fuggetlen ellenorzes:
 *
 *  1. FUTASIDEJU — a keszlet: a vitest JSON-riportjaban minden kotelezo
 *     allitasnak lennie kell, es mindnek zolden. A riport hianya BUKAS.
 *  2. FUTASIDEJU — a nyom: a teszt nem a cimevel bizonyit, hanem egy
 *     nyomvonallal, amit a GEP allitott elo. Innen derul ki, hogy egyetlen
 *     peldany volt, hogy az eger-huzas ora nelkul indult, hogy az ujjhoz
 *     kellett egy felebresztes, es hogy UTANA az eger megint azonnali —
 *     tehat nincs beragadas. Egy teszt cime elcsuszhat a viselkedestol; ez
 *     nem, mert a viselkedes irta.
 *  3. STATIKUS — a csovezetek: a mag tovabbra sem lat orat es nem hasznal
 *     idozitot (ezert reprodukalhato egy szekvencia a long press utan is), a
 *     kesleltetes a MAGBAN van definialva, es a bongeszo-kotes NEM tudja,
 *     mennyi egy long press — ez a P4 touchAction-hibajanak tanulsaga, ahol
 *     ugyanazt a szamot ket helyen kellett beallitani.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const testFile = join(corePackage, "test", "hybrid-pointer", "mixed.test.ts");
const machineFile = join(corePackage, "src", "input.ts");
const bindingFile = join(corePackage, "src", "dom", "attach.ts");
const reportFile = join(corePackage, ".hybrid-report.json");
const traceFile = join(corePackage, ".hybrid-trace.json");

const MIN_TESTS = 6;
/** A kapu proof-ja ezeket allitja; mindegyikhez kell egy zold teszt. */
const REQUIRED_CLAIMS = [
  "same session",
  "resize handle without the hold",
  "cancels the hold",
  "takes back the wake-up",
  "late move",
  "pen",
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

const failures = [];
const notes = [];

/** Kommentek nelkuli kod: egy tilalom nem a magyarazaton bukhat el. */
const codeOf = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- 1. FUTASIDEJU: a keszlet ------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `nincs vitest-riport (${reportFile}) — a hibrid-keszlet NEM futott le, ezert BUKAS`,
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);
  if (tests.length < MIN_TESTS) {
    failures.push(
      `${String(tests.length)} hibrid-teszt futott, de legalabb ${String(MIN_TESTS)} kell`,
    );
  }
  for (const test of tests) {
    if (test.status !== "passed") {
      failures.push(`nem zold hibrid-teszt: ${String(test.fullName)} (${String(test.status)})`);
    }
  }
  const names = tests.map((test) => String(test.fullName).toLowerCase());
  for (const claim of REQUIRED_CLAIMS) {
    if (!names.some((name) => name.includes(claim.toLowerCase()))) {
      failures.push(`a kapu allit valamit, amit senki nem mer: "${claim}"`);
    }
  }
  if (failures.length === 0) {
    notes.push(
      `${String(tests.length)} hibrid-teszt, mind zold, es mind a ` +
        `${String(REQUIRED_CLAIMS.length)} kotelezo allitasra van teszt`,
    );
  }
}

// --- 2. FUTASIDEJU: a nyom ---------------------------------------------------

if (!existsSync(traceFile)) {
  failures.push(
    `nincs gep-nyomvonal (${traceFile}) — a "ugyanabban a munkamenetben" allitas igy ` +
      "csak egy teszt cime, nem megfigyeles",
  );
} else {
  let trace;
  try {
    trace = JSON.parse(readFileSync(traceFile, "utf8"));
  } catch (error) {
    failures.push(`a nyomvonal olvashatatlan: ${String(error)}`);
  }
  if (trace !== undefined) {
    if (trace.machinesInSession !== 1) {
      failures.push(
        `${String(trace.machinesInSession)} gep-peldany a munkamenetben, de pontosan 1 kell — ` +
          "ket kulonbozo objektum kulonbozo viselkedese nem allit semmit a valtasrol",
      );
    }
    const events = Array.isArray(trace.events) ? trace.events : [];
    if (events.length !== 3) {
      failures.push(
        `${String(events.length)} lepes a nyomvonalban, de 3 kell: eger, ujj, majd ismet eger`,
      );
    } else {
      const [first, second, third] = events;
      const immediate = (event, label) => {
        if (event.pointerType !== "mouse") {
          failures.push(`${label}: ${String(event.pointerType)} pointer, de egeret vartunk`);
        }
        if (event.trigger !== "pointer") {
          failures.push(
            `${label}: a huzast "${String(event.trigger)}" inditotta, nem a pointer — ` +
              "egy egerrel tartani kell a gombot, ami elromlottnak erzodik",
          );
        }
        if (event.elapsed !== false || event.scheduled !== null) {
          failures.push(
            `${label}: az eger-huzashoz ora kellett (scheduled=${String(event.scheduled)}, ` +
              `elapsed=${String(event.elapsed)})`,
          );
        }
      };
      immediate(first, "1. lepes (eger)");
      if (second.pointerType !== "touch") {
        failures.push(`2. lepes: ${String(second.pointerType)} pointer, de ujjat vartunk`);
      }
      if (second.trigger !== "long-press") {
        failures.push(
          `2. lepes: a huzast "${String(second.trigger)}" inditotta, nem a long press — ` +
            "egy kontaktusra huzo ujjtol a lista gorgethetetlen",
        );
      }
      if (second.elapsed !== true || !Number.isFinite(second.scheduled)) {
        failures.push(
          "2. lepes: az ujjhoz nem kellett felebresztes — tehat nem volt tartas, " +
            `vagy a gep nem kert orat (scheduled=${String(second.scheduled)})`,
        );
      }
      // Ez a kapu lenyege: a HARMADIK lepes.
      immediate(third, "3. lepes (eger az ujj utan) — a gep beragadt");
    }
    if (failures.length === 0) {
      notes.push(
        "egyetlen gep-peldany nyomvonala: eger azonnal, ujj tartasra, majd az eger " +
          "ismet azonnal — nincs beragadas",
      );
    }
  }
}

// --- 3. STATIKUS: a mertek es a csovezetek -----------------------------------

if (!existsSync(testFile)) {
  failures.push(`nincs hibrid-tesztfajl: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");
  if (
    !/import\s*\{[^}]*\bcreateInputMachine\b[^}]*\}\s*from\s*"\.\.\/\.\.\/src\/input\.js"/.test(
      source,
    )
  ) {
    failures.push("a hibrid-teszt nem a mag createInputMachine exportjat hajtja");
  }
  for (const kind of ['"mouse"', '"touch"', '"pen"']) {
    if (!source.includes(kind)) {
      failures.push(`a hibrid-teszt nem hasznal ${kind} pointert — a valtas mindharomrol szol`);
    }
  }
  if (!/\.elapse\(/.test(source)) {
    failures.push(
      "a hibrid-teszt nem hivja az elapse-t — akkor nem a gep orajat hajtja, hanem varakozik, " +
        "es egy ido-alapu teszt, ami tenyleg var, flaky",
    );
  }
  if (!/moveTrigger:\s*"auto"/.test(source)) {
    failures.push(
      'a hibrid-teszt nem a "auto" feloldast meri — a kezzel beallitott mod nem bizonyit ' +
        "semmit a valtasrol",
    );
  }
  if (failures.length === 0) {
    notes.push('a mertek a valodi gepet hajtja "auto" modban, mindharom pointer-tipussal');
  }
}

const machine = existsSync(machineFile) ? readFileSync(machineFile, "utf8") : "";
if (machine === "") {
  failures.push(`nincs bemeneti csovezetek: ${machineFile}`);
} else {
  const code = codeOf(machine);
  for (const forbidden of FORBIDDEN_IN_MACHINE) {
    if (code.includes(forbidden)) {
      failures.push(
        `a bemeneti csovezetek ${forbidden}-t hasznal — a long press utan is az a lenyeg, ` +
          "hogy a gep ne lassa az orat, kulonben egy szekvencia nem reprodukalhato",
      );
    }
  }
  if (!/DEFAULT_LONG_PRESS_MS\s*=\s*\d+/.test(code)) {
    failures.push(
      "a magban nincs long-press kesleltetes definialva — akkor valaki mas dont rola, " +
        "es a kuszob nem a gepe",
    );
  }
  if (!/type:\s*"schedule"/.test(code)) {
    failures.push(
      "a gep nem kuld schedule effektet — akkor nem KERI a felebresztest, hanem valahol " +
        "var ra, es az mar ora",
    );
  }
}

const binding = existsSync(bindingFile) ? readFileSync(bindingFile, "utf8") : "";
if (binding === "") {
  failures.push(`nincs bongeszo-kotes: ${bindingFile}`);
} else {
  const code = codeOf(binding);
  const timers = (code.match(/setTimeout\(/g) ?? []).length;
  if (timers !== 1) {
    failures.push(
      `${String(timers)} setTimeout a kotesben, de pontosan 1 kell — egy a long presshez, ` +
        "es semmi tobb, kulonben megint ket helyen all az idozites",
    );
  }
  for (const leak of ["longPressMs", "LONG_PRESS", "DEFAULT_LONG_PRESS_MS"]) {
    if (code.includes(leak)) {
      failures.push(
        `a bongeszo-kotes ismeri a(z) ${leak}-t — a kesleltetes igy ket helyen van ` +
          "definialva, ami pontosan a P4 touchAction-hibaja",
      );
    }
  }
  if (!/machine\.elapse\(/.test(code)) {
    failures.push(
      "a kotes nem hivja a machine.elapse-t — akkor a felebresztes nem er vissza a gephez",
    );
  }
  if (failures.length === 0) {
    notes.push(
      "a mag ora- es idozitomentes, a kesleltetes a magban all, es a kotes egyetlen " +
        "idozitot futtat anelkul, hogy tudna, mennyi egy long press",
    );
  }
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
  console.error(`\nG-HYBRID BUKOTT: ${String(failures.length)} hiba.`);
  process.exit(1);
}

console.log(
  "\nG-HYBRID atment: egy gepen, egy munkamenetben az eger azonnal huz, az ujj tartasra, " +
    "es az eger utana is azonnal.",
);
