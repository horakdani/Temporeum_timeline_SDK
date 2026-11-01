#!/usr/bin/env node
/**
 * G-ASYNC: bizonyitja, hogy gyors zoomolas kozben a megszakitott keresek
 * eredmenye SOHA nem kerul ki a vaszonra.
 *
 * Ket fuggetlen bizonyitek, mindketto kotelezo — a hianyzo riport BUKAS:
 *
 *  1. A MAG (packages/core, test/async-window/): seedelt utemezesek szazai,
 *     gyors zoom-sorozatokkal, egy kezzel valaszolo forrassal, ami az abortalt
 *     keresekre is valaszol. Minden lepes utan a host modjara renderelt
 *     jelenetet olvassa vissza (az option-nevekben a keres sorszama), fele
 *     reszben scene space-en at, a P7 csempe-gyorsitotaraval. A naplobol:
 *     nulla szivargas, es NEM ures (volt abortalt keres, ami megis valaszolt,
 *     es volt kirajzolt elem). A NEGATIV KONTROLL (egy naiv betolto, ami
 *     megtart minden valaszt) ugyanazon a mérőn szivárogjon.
 *  2. A BONGESZO (packages/docs, e2e/async.spec.ts): igazi Chromium, valodi
 *     idozitok, Ctrl+gorgos gyors zoom; egy MutationObserver MINDEN valaha
 *     beszurt option-nevet rogzit, nem csak a vegallapotot. Ket szerver:
 *     amelyik megszakit, es amelyik nem (ott a valasz tenyleg megjon). Itt is
 *     van negativ kontroll.
 *
 * A harmadik STATIKUS: a mag-teszt a valodi betoltot es a valodi renderelot
 * hajtja (nem mockol), a demo lap a shippelt bundle betoltojet hasznalja.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(repoRoot, "packages", "core");
const docs = join(repoRoot, "packages", "docs");
const coreReport = join(core, ".async-window-report.json");
const coreLog = join(core, ".async-window-log.json");
const browserReport = join(docs, ".e2e-async-report.json");
const browserLog = join(docs, ".async-browser-log.json");
const noStaleTest = join(core, "test", "async-window", "no-stale.test.ts");
const asyncPage = join(docs, "public", "async.html");

/** Allitas -> hany zold tesztet kovetel (orientacionkent kulon, ahol ket orientacio van). */
const CORE_CLAIMS = [
  "windows-nest",
  "zoom-in-reuse",
  "abort-on-leave",
  "discard-late",
  "failure-retry",
  "merge",
  "evict",
  "apply-replay",
  "invalidate",
  "array-source",
  "destroy",
  "reduced-motion",
  "negative-control",
];
/** Mindket orientacioban kotelezo. */
const ORIENTED_CLAIMS = ["axis-mark", "aria-busy", "no-stale"];
const BROWSER_CLAIMS = [
  "browser-no-stale",
  "browser-negative-control",
  "browser-loading-mark",
  "browser-reduced-motion",
  "browser-failure",
];
const MIN_SCHEDULES = 100;
const MIN_FRAMES = 10_000;

const failures = [];
const notes = [];
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

// --- 1. A mag ----------------------------------------------------------------
if (!existsSync(coreReport)) {
  failures.push(`nincs vitest-riport (${coreReport}) — a mag keszlete NEM futott, ezert BUKAS`);
} else {
  const tests = (read(coreReport).testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  for (const test of tests.filter((each) => each.status === "failed")) failures.push(`bukott: ${test.fullName}`);
  for (const test of tests.filter((each) => each.status !== "passed" && each.status !== "failed")) {
    failures.push(`nem futott (${test.status}): ${test.fullName}`);
  }
  const green = (claim, orientation) =>
    tests.some(
      (test) =>
        test.status === "passed" &&
        test.title.includes(`[claim:${claim}]`) &&
        (orientation === undefined ||
          test.title.includes(orientation) ||
          (test.ancestorTitles ?? []).some((title) => title.includes(`[${orientation}]`))),
    );
  for (const claim of CORE_CLAIMS) {
    if (!green(claim)) failures.push(`a magban nincs zold teszt ehhez: [claim:${claim}]`);
  }
  for (const claim of ORIENTED_CLAIMS) {
    for (const orientation of ["horizontal", "vertical"]) {
      if (!green(claim, orientation)) failures.push(`a magban nincs zold teszt ehhez: [claim:${claim}] ${orientation}`);
    }
  }
  notes.push(`mag: ${tests.filter((test) => test.status === "passed").length} zold teszt a test/async-window/ alatt`);
}

if (!existsSync(coreLog)) {
  failures.push(`nincs utemezes-naplo (${coreLog}) — nem tudni, mit latott a mérő`);
} else {
  const log = read(coreLog);
  for (const orientation of ["horizontal", "vertical"]) {
    const run = log[`loader:${orientation}`];
    if (run === undefined) {
      failures.push(`a naplobol hianyzik: loader:${orientation}`);
      continue;
    }
    if (run.leaks !== 0) failures.push(`${orientation}: ${run.leaks} szivargas — ${JSON.stringify(run.firstLeaks)}`);
    if (run.schedules < MIN_SCHEDULES) failures.push(`${orientation}: csak ${run.schedules} utemezes (legalabb ${MIN_SCHEDULES})`);
    if (run.frames < MIN_FRAMES) failures.push(`${orientation}: csak ${run.frames} kepkocka (legalabb ${MIN_FRAMES})`);
    if (!(run.answeredAfterAbort >= run.schedules)) {
      failures.push(`${orientation}: alig volt abortalt keres, ami megis valaszolt (${run.answeredAfterAbort}) — a mérés ures`);
    }
    if (!(run.drawn > run.frames)) failures.push(`${orientation}: alig volt kirajzolt elem (${run.drawn}) — a mérés ures`);
    notes.push(
      `mag ${orientation}: ${run.schedules} utemezes, ${run.frames} kepkocka, ${run.zoomSteps} zoom-lepes, ${run.fetches} keres, ebbol ${run.aborted} abortalt, ${run.answeredAfterAbort} megis valaszolt; ${run.drawn} kirajzolt elem-nev, 0 szivargas`,
    );
  }
  const control = log.control;
  if (control === undefined) {
    failures.push("a naplobol hianyzik a negativ kontroll — a mérő vaksaga nincs kizarva");
  } else {
    if (!(control.schedulesWithLeaks > control.schedules / 2)) {
      failures.push(`a negativ kontroll csak ${control.schedulesWithLeaks}/${control.schedules} utemezesben szivargott — a mérő vak lehet`);
    }
    notes.push(`mag negativ kontroll: ${control.schedulesWithLeaks}/${control.schedules} utemezesben ${control.leaks} szivargast talalt (ahogy kell)`);
  }
}

// --- 2. A bongeszo ------------------------------------------------------------
if (!existsSync(browserReport)) {
  failures.push(`nincs Playwright-riport (${browserReport}) — a bongeszos keszlet NEM futott, ezert BUKAS`);
} else {
  const results = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        results.push({ title: spec.title, project: test.projectName, status: test.results?.at(-1)?.status ?? "missing" });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of read(browserReport).suites ?? []) walk(suite);
  for (const result of results.filter((each) => each.status !== "passed")) {
    failures.push(`bongeszo: ${result.status}: ${result.title} [${result.project}]`);
  }
  for (const claim of BROWSER_CLAIMS) {
    if (!results.some((result) => result.status === "passed" && result.title.includes(`[claim:${claim}]`))) {
      failures.push(`a bongeszoben nincs zold teszt ehhez: [claim:${claim}]`);
    }
  }
  notes.push(`bongeszo: ${results.filter((result) => result.status === "passed").length}/${results.length} zold`);
}

if (!existsSync(browserLog)) {
  failures.push(`nincs bongeszos naplo (${browserLog})`);
} else {
  const log = read(browserLog);
  for (const mode of ["abort", "ignore-abort"]) {
    const run = log[mode];
    if (run === undefined) {
      failures.push(`a bongeszos naplobol hianyzik: ${mode}`);
      continue;
    }
    if (run.leaks.length !== 0) failures.push(`bongeszo ${mode}: szivargas — ${run.leaks.slice(0, 3).join("; ")}`);
    if (!(run.aborted > 5)) failures.push(`bongeszo ${mode}: csak ${run.aborted} abortalt keres — a gyors zoom nem volt gyors`);
    if (!(run.namesSeen > 50)) failures.push(`bongeszo ${mode}: csak ${run.namesSeen} latott nev — a mérés ures`);
    if (mode === "ignore-abort" && !(run.answeredAfterAbort > 5)) {
      failures.push(`bongeszo ignore-abort: csak ${run.answeredAfterAbort} abortalt keres valaszolt — a nehez eset nem fordult elo`);
    }
    notes.push(
      `bongeszo ${mode}: ${run.requests} keres, ${run.aborted} abortalt, ${run.answeredAfterAbort} megis valaszolt, ${run.namesSeen} kulonbozo nev latva ${run.draws} rajzolasban, 0 szivargas`,
    );
  }
  const control = log.control;
  if (control === undefined || !(control.leaks > 0)) {
    failures.push("a bongeszos negativ kontroll nem talalt szivargast — a MutationObserver-mérő vak lehet");
  } else {
    notes.push(`bongeszo negativ kontroll: ${control.leaks} szivargo nev (ahogy kell)`);
  }
}

// --- 3. Statikus ----------------------------------------------------------------
const testSource = existsSync(noStaleTest) ? readFileSync(noStaleTest, "utf8") : "";
for (const needle of ['from "../../src/data.js"', 'from "../../src/render.js"', "renderTimeline(", "fetchesShown(", "planSceneSpace("]) {
  if (!testSource.includes(needle)) failures.push(`a no-stale teszt nem a valodi utat jarja (hianyzik: ${needle})`);
}
if (/vi\.mock\(|vi\.fn\(/.test(testSource)) failures.push("a no-stale teszt mockol — igy nem a betolto viselkedeset meri");
const page = existsSync(asyncPage) ? readFileSync(asyncPage, "utf8") : "";
if (!page.includes('from "/core/index.mjs"') || !page.includes("createItemLoader({ source })") || !page.includes("MutationObserver")) {
  failures.push("a demo lap nem a shippelt betoltot hasznalja, vagy nem figyeli a DOM-ot");
}

for (const note of notes) console.log(`  · ${note}`);
if (failures.length > 0) {
  console.error("\nG-ASYNC BUKOTT:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log("\nG-ASYNC: gyors zoom kozben egy megszakitott keres eleme sem kerult a vaszonra — a magban es igazi bongeszoben sem, es mindket mérő lat (a negativ kontrollok szivarognak).");
