#!/usr/bin/env node
/**
 * G-KEYBOARD: bizonyitja, hogy MINDEN gesztussal elerheto kepesseghez van
 * billentyus megfelelo — futasidoben, mindket orientacioban.
 *
 * A kepessegek listajat NEM ez a fajl irja: a gep tipusaibol jon
 * (sdk_gesture_vocabulary.mjs), ugyanaz, amit a G-NO-GESTURE-ONLY statikusan
 * ellenoriz. Igy egy uj gesztus-kepesseg mindket kapun egyszerre bukik, amig
 * nincs billentyuje es tesztje.
 *
 * Harom fuggetlen ellenorzes:
 *
 *  1. A KESZLET: a vitest-riportban minden kepesseghez (`[cap:<id>]`) es
 *     szabalyhoz (`[rule:<nev>]`) van zold teszt, VIZSZINTESEN ES
 *     FUGGOLEGESEN is; nincs bukott es nincs kihagyott teszt.
 *  2. A NAPLO: a paritas-teszt minden kepessegnel leirja, mit adott a
 *     gesztus es mit a billentyu (`.keyboard-parity.json`). A cim elcsuszhat
 *     a viselkedestol, a naplo nem, mert a gep irta. Minden kepesseg minden
 *     orientaciojahoz kell egy bejegyzes, ahol mindket ut adott eredmenyt,
 *     es a ketto egyezett.
 *  3. STATIKUS: a paritas-teszt ugyanazt a gep-tipust hajtja mindket uton
 *     (`machine.handle` es `machine.key`), es nem mockolja a gepet.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CORE, entryVocabulary, gestureVocabulary } from "./sdk_gesture_vocabulary.mjs";

const reportFile = join(CORE, ".keyboard-report.json");
const logFile = join(CORE, ".keyboard-parity.json");
/** A P19 kepessegeinek naploja (test/keyboard/entries.test.ts): a gepen kivul, a belepesi pontokban elnek. */
const entryLogFile = join(CORE, ".keyboard-parity-entries.json");
const parityTest = join(CORE, "test", "keyboard", "parity.test.ts");
const ORIENTATIONS = ["horizontal", "vertical"];
const MIN_TESTS = 60;

const failures = [];
const notes = [];
const vocabulary = gestureVocabulary();
for (const problem of vocabulary.problems) failures.push(`szokincs: ${problem}`);
const tagOf = (id) => (id.startsWith("rule.") ? `[rule:${id.slice("rule.".length)}]` : `[cap:${id}]`);
const entries = entryVocabulary();
for (const problem of entries.problems) failures.push(`P19-szokincs: ${problem}`);
const required = [...vocabulary.capabilities, ...entries.capabilities, ...vocabulary.rules];

// --- 1. A keszlet --------------------------------------------------------------
if (!existsSync(reportFile)) {
  failures.push(`nincs vitest-riport (${reportFile}) — a billentyu-keszlet NEM futott, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const tests = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  const failed = tests.filter((test) => test.status === "failed");
  const skipped = tests.filter((test) => test.status !== "passed" && test.status !== "failed");
  for (const test of failed) failures.push(`bukott: ${test.fullName}`);
  for (const test of skipped) failures.push(`nem futott (${test.status}): ${test.fullName}`);
  if (tests.length < MIN_TESTS) failures.push(`csak ${tests.length} teszt futott (legalabb ${MIN_TESTS} kell)`);
  for (const id of required) {
    for (const orientation of ORIENTATIONS) {
      const hit = tests.find(
        (test) =>
          test.status === "passed" &&
          test.title.includes(tagOf(id)) &&
          (test.ancestorTitles ?? []).some((title) => title.includes(`[${orientation}]`)),
      );
      if (hit === undefined) failures.push(`nincs zold teszt: ${tagOf(id)} ${orientation} orientacioban`);
    }
  }
  // P26: jobbrol balra is. A tukrozott keret a gepnek a masik nyilat adja
  // (attachInput direction); a nyilak ugy mozognak, ahogy a kepernyon mutatnak,
  // es minden nyilas kotes elerheto marad.
  for (const orientation of ORIENTATIONS) {
    const hit = tests.filter(
      (test) => test.status === "passed" && test.title.includes("[claim:rtl-keys]") && (test.ancestorTitles ?? []).some((title) => title.includes(`[${orientation}]`)),
    );
    if (hit.length < 2) failures.push(`nincs eleg zold RTL-billentyu-teszt ([claim:rtl-keys]) ${orientation} orientacioban: ${String(hit.length)} / 2`);
  }
  // P27: a heti es napi nezet. Ott a mutato egyetlen dolgot tesz — egy
  // kattintas kivalaszt egy esemenyt —, es ennek billentyuje az Enter azon az
  // esemenyen, amin a billentyuzet all. A nezetnek nincs orientacioja (az ido
  // mindig lefele fut), ezert itt nem orientacionkent, hanem oda-vissza
  // iranyban kell legalabb harom zold teszt: a kotesek, es hogy minden
  // esemenyre a kattintas es a billentyuk ugyanazt valasztjak.
  const calendarKeys = tests.filter((test) => test.status === "passed" && test.title.includes("[claim:calendar-keys]"));
  if (calendarKeys.length < 3) failures.push(`nincs eleg zold naptar-billentyu-teszt ([claim:calendar-keys]): ${String(calendarKeys.length)} / 3`);
  notes.push(`${tests.filter((test) => test.status === "passed").length} zold teszt a test/keyboard/ alatt`);
}

// --- 2. A naplo ------------------------------------------------------------------
if (!existsSync(logFile) || !existsSync(entryLogFile)) {
  failures.push(`nincs paritas-naplo (${existsSync(logFile) ? entryLogFile : logFile}) — nem tudni, mit adott a ket ut`);
} else {
  const log = [...JSON.parse(readFileSync(logFile, "utf8")), ...JSON.parse(readFileSync(entryLogFile, "utf8"))];
  let exact = 0;
  for (const id of required) {
    for (const orientation of ORIENTATIONS) {
      const entry = log.find((each) => each.capability === id && each.orientation === orientation);
      if (entry === undefined) {
        failures.push(`a naplobol hianyzik: ${id} ${orientation}`);
        continue;
      }
      // A JSON elhagyja az undefined-ot: ha a kulcs hianyzik, az az ut nem
      // adott semmit. (A null ertelmes eredmeny: "semmit nem talalt".)
      if (!("gesture" in entry) || !("keyboard" in entry)) {
        failures.push(`${id} ${orientation}: valamelyik ut nem adott eredmenyt`);
      }
      if (entry.same !== true) failures.push(`${id} ${orientation}: a gesztus es a billentyu mast adott`);
      if (JSON.stringify(entry.gesture) === JSON.stringify(entry.keyboard)) exact += 1;
    }
  }
  notes.push(`${required.length} kepesseg es szabaly x 2 orientacio a naploban; ebbol ${exact} bajtra azonos eredmeny (a tobbi azonos iranyu, pl. fel nezetnyi lapozas vs huzas)`);
}

// --- 3. Statikus ------------------------------------------------------------------
const source = existsSync(parityTest) ? readFileSync(parityTest, "utf8") : "";
if (!source.includes('from "../../src/input.js"') || !source.includes("machine.handle(") || !source.includes("machine.key(")) {
  failures.push("a paritas-teszt nem ugyanazt a gepet hajtja mindket uton");
}
if (/vi\.mock\(|vi\.fn\(/.test(source)) failures.push("a paritas-teszt mockol — a paritas igy nem a gep paritasa");

for (const note of notes) console.log(`  · ${note}`);
if (failures.length > 0) {
  console.error("\nG-KEYBOARD BUKOTT:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`\nG-KEYBOARD: mind a ${vocabulary.capabilities.length + entries.capabilities.length} gesztus-kepesseg es ${vocabulary.rules.length} szabaly billentyuvel is all, mindket orientacioban.`);
