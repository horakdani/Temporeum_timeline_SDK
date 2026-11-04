#!/usr/bin/env node
/**
 * The keyboard check: proves that EVERY capability reachable by a gesture has a
 * keyboard equivalent — at runtime, in both orientations.
 *
 * This file does NOT write the list of capabilities: it comes from the
 * machine's types (sdk_gesture_vocabulary.mjs), the same list the
 * the no-gesture-only check verifies statically. So a new gesture capability
 * fails both checks at once until it has a key and a test.
 *
 * Three independent checks:
 *
 *  1. THE SUITE: in the vitest report every capability (`[cap:<id>]`) and
 *     rule (`[rule:<name>]`) has a green test, HORIZONTALLY AND VERTICALLY;
 *     no test failed and none was skipped.
 *  2. THE LOG: for every capability the parity test records what the
 *     gesture produced and what the key produced (`.keyboard-parity.json`).
 *     A title can drift from the behaviour, the log cannot, because the
 *     machine wrote it. Every capability needs an entry for every
 *     orientation in which both paths produced a result and the two agreed.
 *  3. STATIC: the parity test drives the same machine type on both paths
 *     (`machine.handle` and `machine.key`), and does not mock the machine.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CORE, entryVocabulary, gestureVocabulary } from "./sdk_gesture_vocabulary.mjs";

const reportFile = join(CORE, ".keyboard-report.json");
const logFile = join(CORE, ".keyboard-parity.json");
/** The log of the entry-point capabilities (test/keyboard/entries.test.ts): they live outside the machine, in the entry points. */
const entryLogFile = join(CORE, ".keyboard-parity-entries.json");
const parityTest = join(CORE, "test", "keyboard", "parity.test.ts");
const ORIENTATIONS = ["horizontal", "vertical"];
const MIN_TESTS = 60;

const failures = [];
const notes = [];
const vocabulary = gestureVocabulary();
for (const problem of vocabulary.problems) failures.push(`vocabulary: ${problem}`);
const tagOf = (id) => (id.startsWith("rule.") ? `[rule:${id.slice("rule.".length)}]` : `[cap:${id}]`);
const entries = entryVocabulary();
for (const problem of entries.problems) failures.push(`entry-point vocabulary: ${problem}`);
const required = [...vocabulary.capabilities, ...entries.capabilities, ...vocabulary.rules];

// --- 1. The suite --------------------------------------------------------------
if (!existsSync(reportFile)) {
  failures.push(`no vitest report (${reportFile}) — the keyboard suite did NOT run, so this is a FAILURE`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const tests = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  const failed = tests.filter((test) => test.status === "failed");
  const skipped = tests.filter((test) => test.status !== "passed" && test.status !== "failed");
  for (const test of failed) failures.push(`failed: ${test.fullName}`);
  for (const test of skipped) failures.push(`did not run (${test.status}): ${test.fullName}`);
  if (tests.length < MIN_TESTS) failures.push(`only ${tests.length} tests ran (at least ${MIN_TESTS} are required)`);
  for (const id of required) {
    for (const orientation of ORIENTATIONS) {
      const hit = tests.find(
        (test) =>
          test.status === "passed" &&
          test.title.includes(tagOf(id)) &&
          (test.ancestorTitles ?? []).some((title) => title.includes(`[${orientation}]`)),
      );
      if (hit === undefined) failures.push(`no green test: ${tagOf(id)} in the ${orientation} orientation`);
    }
  }
  // Right to left too. The mirrored frame gives the machine the other arrow
  // (attachInput direction); the arrows move the way they point on screen,
  // and every arrow binding stays reachable.
  for (const orientation of ORIENTATIONS) {
    const hit = tests.filter(
      (test) => test.status === "passed" && test.title.includes("[claim:rtl-keys]") && (test.ancestorTitles ?? []).some((title) => title.includes(`[${orientation}]`)),
    );
    if (hit.length < 2) failures.push(`not enough green RTL key tests ([claim:rtl-keys]) in the ${orientation} orientation: ${String(hit.length)} / 2`);
  }
  // The week and day views. There the pointer does a single thing — a
  // click selects an event — and its key is Enter on the event the keyboard
  // is on. The view has no orientation (time always runs downwards), so
  // instead of per orientation it needs at least three green tests in both
  // directions: the bindings, and that for every event the click and the
  // keys select the same thing.
  const calendarKeys = tests.filter((test) => test.status === "passed" && test.title.includes("[claim:calendar-keys]"));
  if (calendarKeys.length < 3) failures.push(`not enough green calendar key tests ([claim:calendar-keys]): ${String(calendarKeys.length)} / 3`);
  notes.push(`${tests.filter((test) => test.status === "passed").length} green tests under test/keyboard/`);
}

// --- 2. The log ------------------------------------------------------------------
if (!existsSync(logFile) || !existsSync(entryLogFile)) {
  failures.push(`no parity log (${existsSync(logFile) ? entryLogFile : logFile}) — there is no knowing what the two paths produced`);
} else {
  const log = [...JSON.parse(readFileSync(logFile, "utf8")), ...JSON.parse(readFileSync(entryLogFile, "utf8"))];
  let exact = 0;
  for (const id of required) {
    for (const orientation of ORIENTATIONS) {
      const entry = log.find((each) => each.capability === id && each.orientation === orientation);
      if (entry === undefined) {
        failures.push(`missing from the log: ${id} ${orientation}`);
        continue;
      }
      // JSON drops undefined: if the key is missing, that path produced
      // nothing. (null is a meaningful result: "found nothing".)
      if (!("gesture" in entry) || !("keyboard" in entry)) {
        failures.push(`${id} ${orientation}: one of the paths produced no result`);
      }
      if (entry.same !== true) failures.push(`${id} ${orientation}: the gesture and the key produced different results`);
      if (JSON.stringify(entry.gesture) === JSON.stringify(entry.keyboard)) exact += 1;
    }
  }
  notes.push(`${required.length} capabilities and rules x 2 orientations in the log; ${exact} of them byte-identical results (the rest agree in direction, e.g. a half-view page vs a drag)`);
}

// --- 3. Static ------------------------------------------------------------------
const source = existsSync(parityTest) ? readFileSync(parityTest, "utf8") : "";
if (!source.includes('from "../../src/input.js"') || !source.includes("machine.handle(") || !source.includes("machine.key(")) {
  failures.push("the parity test does not drive the same machine on both paths");
}
if (/vi\.mock\(|vi\.fn\(/.test(source)) failures.push("the parity test mocks — then the parity is not the machine's parity");

for (const note of notes) console.log(`  · ${note}`);
if (failures.length > 0) {
  console.error("\nkeyboard FAILED:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`\nkeyboard: all ${vocabulary.capabilities.length + entries.capabilities.length} gesture capabilities and ${vocabulary.rules.length} rules also work by keyboard, in both orientations.`);
