#!/usr/bin/env node
/**
 * G-CANMOVE: bizonyitja, hogy a hoszt szabalya tenyleg megallitja a
 * szerkesztest — MINDEN uton, es egeszben.
 *
 * Harom allitas, mindharom konnyen elromlik csendben:
 *
 *  - A veto ATOMI: egy visszautasitott elem az EGESZ ajanlatot visszautasitja.
 *    Egy reszleges mozgatas eszrevetlenul atrendezi azt, amit a hasznalo
 *    megfogott, es o ezt a konyvtar hibajanak olvassa, nem a sajat szabalya
 *    mukodesenek.
 *  - A veto NEM lemondas: az utolso elfogadott pozicio megy ki ujra
 *    `vetoed: true`-val. Az elem ott marad, ahol a szabaly engedte — nem
 *    ugrik vissza a kezdetre, es nem marad a visszautasitott helyen, amikor
 *    az ujj felemelkedik. A kapu ezert azt is meri, hogy visszautasitott
 *    pozicióra SOHA nem keletkezik command.
 *  - Mindket ut szamit: a gesztus ES a programozott iker. Egy veto, ami csak
 *    ujjra mukodik, az a billentyuzetes hasznalo adatvesztese. Eppen ez az,
 *    amit egy cimre epulo kapu nem lat: a `runEdit` veto-aga a P5 elott a
 *    lefedettsegben is lyuk volt.
 *
 * Harom fuggetlen ellenorzes: a vitest-riport (a keszlet lefutott es zold), a
 * gep nyomvonala (melyik uton volt tenyleg veto, es keletkezett-e command),
 * es a statikus fel (a veto az ELSO bukott patch-nel all meg, mindket uton
 * meg van hivva, es a lezart elem kimarad a huzasbol, nem visszautasitja).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const testFile = join(corePackage, "test", "canmove", "veto.test.ts");
const machineFile = join(corePackage, "src", "input.ts");
const reportFile = join(corePackage, ".canmove-report.json");
const traceFile = join(corePackage, ".canmove-trace.json");

const MIN_TESTS = 11;
const REQUIRED_CLAIMS = [
  "last accepted position",
  "not on every pixel",
  "whole selection",
  "refuses a resize",
  "programmatic twin",
  "programmatic resize",
  "locked item out of the drag",
  "will not start a drag on a locked item",
  "non-resizable",
];
/** Minden ut, amin egy szerkesztes elindulhat. Mindegyiken kell veto. */
const REQUIRED_ROUTES = ["gesture-move", "gesture-resize", "api-move", "api-resize"];

const failures = [];
const notes = [];

const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- 1. FUTASIDEJU: a keszlet ------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `nincs vitest-riport (${reportFile}) — a canMove-keszlet NEM futott le, ezert BUKAS`,
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);
  if (tests.length < MIN_TESTS) {
    failures.push(
      `${String(tests.length)} canMove-teszt futott, de legalabb ${String(MIN_TESTS)} kell`,
    );
  }
  for (const test of tests) {
    if (test.status !== "passed") {
      failures.push(`nem zold canMove-teszt: ${String(test.fullName)} (${String(test.status)})`);
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
      `${String(tests.length)} canMove-teszt, mind zold, es mind a ` +
        `${String(REQUIRED_CLAIMS.length)} kotelezo allitasra van teszt`,
    );
  }
}

// --- 2. FUTASIDEJU: a nyom ---------------------------------------------------

if (!existsSync(traceFile)) {
  failures.push(
    `nincs veto-nyomvonal (${traceFile}) — akkor nem tudjuk, melyik uton volt tenyleg veto, ` +
      "csak azt, hogy a tesztek zoldek",
  );
} else {
  let trace;
  try {
    trace = JSON.parse(readFileSync(traceFile, "utf8"));
  } catch (error) {
    failures.push(`a veto-nyomvonal olvashatatlan: ${String(error)}`);
  }
  if (trace !== undefined) {
    const vetoed = Array.isArray(trace.vetoed) ? trace.vetoed : [];
    for (const route of REQUIRED_ROUTES) {
      if (!vetoed.includes(route)) {
        failures.push(
          `a(z) "${route}" uton nem volt veto — ha ezen az uton a szabaly nem all meg, ` +
            "ez az ut irja felul a hoszt sajat szabalyat",
        );
      }
    }
    if (trace.commandsAfterVeto !== 0) {
      failures.push(
        `${String(trace.commandsAfterVeto)} command keletkezett visszautasitott pozicióra — ` +
          "a veto ilyenkor csak latszolagos: a valtozas megis eltarolhato",
      );
    }
    const atomic = Array.isArray(trace.atomic) ? trace.atomic : [];
    const proven = atomic.filter((entry) => entry.selected >= 2 && entry.movedAnyway === 0);
    if (proven.length === 0) {
      failures.push(
        "egyetlen tobbelemu ajanlat sincs, amit egy veto EGESZBEN utasitott vissza — " +
          `az atomicitas igy nincs merve (${String(atomic.length)} probalkozas a nyomvonalban)`,
      );
    }
    if (!Number.isInteger(trace.canMoveCalls) || trace.canMoveCalls < 1) {
      failures.push("a szabalyt egyszer sem kerdeztek meg — a keszlet nem a canMove-ot meri");
    }
    if (failures.length === 0) {
      notes.push(
        `mind a ${String(REQUIRED_ROUTES.length)} uton volt veto, ${String(trace.canMoveCalls)} ` +
          "szabaly-kerdes, egyetlen command sem keletkezett visszautasitott pozicióra, " +
          "es a tobbelemu ajanlatot egeszben utasitotta vissza",
      );
    }
  }
}

// --- 3. STATIKUS: a mertek es a csovezetek -----------------------------------

if (!existsSync(testFile)) {
  failures.push(`nincs canMove-tesztfajl: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");
  if (
    !/import\s*\{[^}]*\bcreateInputMachine\b[^}]*\}\s*from\s*"\.\.\/\.\.\/src\/input\.js"/.test(
      source,
    )
  ) {
    failures.push("a canMove-teszt nem a mag createInputMachine exportjat hajtja");
  }
  if (!/canMove:/.test(source)) {
    failures.push("a canMove-teszt nem ad at canMove szabalyt — akkor mit mer?");
  }
  for (const twin of ["moveItems(", "resizeItem("]) {
    if (!source.includes(twin)) {
      failures.push(
        `a canMove-teszt nem hajtja a ${twin} programozott ikret — a billentyuzetes ut ` +
          "pont az, ami kimaradhat",
      );
    }
  }
  if (!/multiSelect:\s*true/.test(source)) {
    failures.push("a canMove-teszt nem mer tobbes kijelolest — az atomicitas csak ott latszik");
  }
  if (failures.length === 0) {
    notes.push("a mertek a valodi gepet hajtja, mindket uton, tobbes kijelolessel");
  }
}

const machine = existsSync(machineFile) ? readFileSync(machineFile, "utf8") : "";
if (machine === "") {
  failures.push(`nincs bemeneti csovezetek: ${machineFile}`);
} else {
  const code = codeOf(machine);
  const callSites = (code.match(/\brefused\(/g) ?? []).length;
  // Egy definicio + legalabb ket hivas: a gesztus es a programozott iker.
  if (callSites < 3) {
    failures.push(
      `a refused() ${String(callSites - 1 > 0 ? callSites - 1 : 0)} helyen van meghivva, de ` +
        "legalabb kettore kell: a gesztus-utra es a programozott ikerre",
    );
  }
  const body = /function refused\(([\s\S]*?)\n {2}\}/.exec(code);
  if (body === null) {
    failures.push("nem talalhato a refused()");
  } else if (!/for \(const patch of patches\)[\s\S]*return true;/.test(body[1])) {
    failures.push(
      "a refused() nem az ELSO bukott patch-nel all meg — egy olyan ellenorzes, ami " +
        "osszegyujti a bukasokat es reszben engedi az ajanlatot, nem atomi",
    );
  }
  if (!/other\.item\.movable !== false/.test(code)) {
    failures.push(
      "a huzas nem hagyja ki a lezart elemet (movable === false) — ha helyette " +
        "visszautasitja az egesz gesztust, egy kijelolesben egyetlen kitüzott elem " +
        "hasznalhatatlanna teszi a kijelolest",
    );
  }
  if (failures.length === 0) {
    notes.push(
      "a veto az elso bukott patch-nel all meg, mindket uton meg van hivva, es a lezart " +
        "elem kimarad a huzasbol",
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
  console.error(`\nG-CANMOVE BUKOTT: ${String(failures.length)} hiba.`);
  process.exit(1);
}

console.log(
  "\nG-CANMOVE atment: a hoszt szabalya mindket uton megall, egeszben, es " +
    "visszautasitott pozicióra nem keletkezik command.",
);
