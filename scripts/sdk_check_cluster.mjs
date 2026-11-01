#!/usr/bin/env node
/**
 * G-CLUSTER: bizonyitja, hogy a furtok darabszamanak osszege MINDIG egyenlo a
 * lathato elemek szamaval — nem veszik el elem.
 *
 * Ket fuggetlen bizonyitek, mindketto kotelezo — a hianyzo riport BUKAS:
 *
 *  1. A MAG (packages/core, test/cluster/): seedelt utemezesek szazai, zoom-
 *     sorozatokkal, pasztazassal, sav-gorgetessel, surusegvaltassal, fele
 *     reszben scene space-en at, a P7 csempe-gyorsitotaraval. Minden lepes
 *     utan a furtozott kepkocka a jelenetbol visszaolvasva, a furtozes nelkuli
 *     parjaval osszevetve: minden lathato elem PONTOSAN egyszer kepviselt, a
 *     jelolo darabszama a furt tagjai, tobblet csak a culling-hataron atlogo
 *     furt tavoli tagja. A naplobol: nulla hiba, es NEM ures (sok jelolo, sok
 *     ujrahasznalt csempe, sok pasztazas-osszevetes). A NEGATIV KONTROLLOK (egy
 *     felejto es egy duplazo rajzolas) ugyanazon a meron MINDIG bukjanak.
 *     Melle a szabalyok (mi furtozik, mit fed a jelolo), a koppintas es a
 *     billentyus iker, a hit test es az a11y — mindket orientacioban.
 *  2. A BONGESZO (packages/docs, e2e/cluster.spec.ts): igazi Chromium, a
 *     shippelt bundle, a patchelo mount. Ctrl+gorgo es huzas utan minden
 *     lepesben az ELO DOM jeloloi es elemei; koppintas Pixel 7 emulacioban,
 *     kattintas, billentyu; axe a furtos lapon. Itt is van negativ kontroll.
 *
 * A harmadik STATIKUS: a mag-teszt a valodi renderelot es a valodi scene
 * space-t hajtja (nem mockol), a demo lap a shippelt bundle-t es az elo DOM-ot.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(repoRoot, "packages", "core");
const docs = join(repoRoot, "packages", "docs");
const coreReport = join(core, ".cluster-report.json");
const coreLog = join(core, ".cluster-log.json");
const browserReport = join(docs, ".e2e-cluster-report.json");
const browserLog = join(docs, ".cluster-browser-log.json");
const conservationTest = join(core, "test", "cluster", "conservation.test.ts");
const clusterPage = join(docs, "public", "cluster.html");

/** Allitas -> legalabb egy zold teszt. */
const CORE_CLAIMS = [
  "joins",
  "item-size",
  "breakers",
  "min-count",
  "rows",
  "contiguous",
  "room",
  "zoom-factor",
  "space",
  "negative-control",
];
/** Mindket orientacioban kotelezo. */
const ORIENTED_CLAIMS = ["conservation", "marker", "pan-invariant", "off", "tap-zoom", "keyboard-twin", "hit-test", "a11y", "hooks"];
const BROWSER_CLAIMS = [
  "browser-conservation",
  "browser-tap-zoom",
  "browser-click",
  "browser-keyboard",
  "browser-negative-control",
  "browser-axe",
];
const CONTROLS = ["forgetful", "doubling"];
/** Ugyanazok a padlok, amiket a conservation.test.ts kovetel. */
const MIN_FRAMES = 10_000;
const MIN_FRAMES_WITH_MARKERS = 1500;
const MIN_MARKERS = 10_000;
const MIN_TAMPERED = 1000;
const MIN_BROWSER_STEPS = 50;

const failures = [];
const notes = [];
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

// --- 1. A mag ----------------------------------------------------------------
if (!existsSync(coreReport)) {
  failures.push(`nincs vitest-riport (${coreReport}) — a mag keszlete NEM futott, ezert BUKAS`);
} else {
  const tests = (read(coreReport).testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  if (tests.length === 0) failures.push("a mag riportjaban nincs egyetlen teszt sem");
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
  notes.push(`mag: ${tests.filter((test) => test.status === "passed").length} zold teszt a test/cluster/ alatt`);
}

if (!existsSync(coreLog)) {
  failures.push(`nincs utemezes-naplo (${coreLog}) — nem tudni, mit latott a mero`);
} else {
  const log = read(coreLog);
  for (const orientation of ["horizontal", "vertical"]) {
    const run = log[`conservation:${orientation}`];
    if (run === undefined) {
      failures.push(`a naplobol hianyzik: conservation:${orientation}`);
      continue;
    }
    if (run.problems !== 0) failures.push(`${orientation}: ${run.problems} hiba — ${JSON.stringify(run.firstProblems)}`);
    if (run.frames < MIN_FRAMES) failures.push(`${orientation}: csak ${run.frames} kepkocka (legalabb ${MIN_FRAMES})`);
    if (run.framesWithMarkers < MIN_FRAMES_WITH_MARKERS) {
      failures.push(`${orientation}: csak ${run.framesWithMarkers} kepkockaban volt jelolo (legalabb ${MIN_FRAMES_WITH_MARKERS}) — a meres ures`);
    }
    if (run.markers < MIN_MARKERS) failures.push(`${orientation}: csak ${run.markers} jelolo (legalabb ${MIN_MARKERS})`);
    if (!(run.reusedTiles > run.spacedFrames)) {
      failures.push(`${orientation}: alig volt ujrahasznalt csempe (${run.reusedTiles}/${run.spacedFrames}) — a gyorsitotar utja nincs merve`);
    }
    if (!(run.panChecks > run.frames)) failures.push(`${orientation}: kevés pasztazas-osszevetes (${run.panChecks})`);
    if (run.exactFrames + run.straddleFrames !== run.frames) {
      failures.push(`${orientation}: ${run.frames - run.exactFrames - run.straddleFrames} kepkocka osszege sem a lathato halmaz, sem a lathato + atlogo tagok`);
    }
    if (run.sum !== run.visible + run.extras) failures.push(`${orientation}: az osszegek nem egyeznek (${run.sum} != ${run.visible} + ${run.extras})`);
    if (!(run.straddleFrames > 0)) failures.push(`${orientation}: egyetlen atlogo furt sem volt — a hatar-eset nincs merve`);
    notes.push(
      `mag ${orientation}: ${run.schedules} utemezes, ${run.frames} kepkocka (${run.spacedFrames} space-ben, ${run.reusedTiles} ujrahasznalt csempe), ${run.markers} jelolo ${run.framesWithMarkers} kepkockaban; ` +
        `${run.exactFrames} kepkocka osszege PONTOSAN a lathato elemek szama, ${run.straddleFrames} a lathato + ${run.extras} atlogo tag; ${run.panChecks} pasztazas-osszevetes; 0 hiba`,
    );
  }
  for (const name of CONTROLS) {
    const control = log[`control:${name}`];
    if (control === undefined) {
      failures.push(`a naplobol hianyzik a negativ kontroll: ${name} — a mero vaksaga nincs kizarva`);
      continue;
    }
    if (!(control.tampered >= MIN_TAMPERED)) failures.push(`${name}: csak ${control.tampered} rontott kepkocka (legalabb ${MIN_TAMPERED})`);
    if (control.caught !== control.tampered) failures.push(`${name}: a mero ${control.tampered} rontott kepkockabol csak ${control.caught}-t talalt — vak lehet`);
    notes.push(`mag negativ kontroll (${name}): ${control.caught}/${control.tampered} rontott kepkocka elkapva (ahogy kell)`);
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
  // Egy kihagyott teszt itt is bukas: minden teszt csak a sajat eszkozen fut.
  for (const result of results.filter((each) => each.status !== "passed")) {
    failures.push(`bongeszo: ${result.status}: ${result.title} [${result.project}]`);
  }
  for (const claim of BROWSER_CLAIMS) {
    if (!results.some((result) => result.status === "passed" && result.title.includes(`[claim:${claim}]`))) {
      failures.push(`a bongeszoben nincs zold teszt ehhez: [claim:${claim}]`);
    }
  }
  if (!results.some((result) => result.status === "passed" && result.project === "pixel-7" && result.title.includes("[claim:browser-tap-zoom]"))) {
    failures.push("a koppintas nem touch-eszkozon futott zolden");
  }
  notes.push(`bongeszo: ${results.filter((result) => result.status === "passed").length}/${results.length} zold`);
}

if (!existsSync(browserLog)) {
  failures.push(`nincs bongeszos naplo (${browserLog})`);
} else {
  const log = read(browserLog);
  const run = log.conservation;
  if (run === undefined) {
    failures.push("a bongeszos naplobol hianyzik: conservation");
  } else {
    if (run.problemCount !== 0) failures.push(`bongeszo: ${run.problemCount} hiba — ${JSON.stringify(run.problems)}`);
    if (run.steps < MIN_BROWSER_STEPS) failures.push(`bongeszo: csak ${run.steps} lepes (legalabb ${MIN_BROWSER_STEPS})`);
    if (!(run.withMarkers > run.steps / 3)) failures.push(`bongeszo: csak ${run.withMarkers}/${run.steps} lepesben volt jelolo — a meres ures`);
    if (run.sum !== run.visible + run.extras) failures.push(`bongeszo: az osszegek nem egyeznek (${run.sum} != ${run.visible} + ${run.extras})`);
    notes.push(`bongeszo: ${run.steps} lepes (Ctrl+gorgo, huzas), ${run.markers} jelolo az elo DOM-ban ${run.withMarkers} lepesben; ${run.sum} = ${run.visible} lathato + ${run.extras} atlogo tag; 0 hiba`);
  }
  const tap = log.tap;
  if (tap === undefined || !(tap.taps?.length >= 2)) {
    failures.push(`bongeszo: a koppintasos nyitas kevesebb mint ket lepesbol allt (${JSON.stringify(tap?.taps ?? null)}) — a fokozatos nyitas nincs merve`);
  } else {
    notes.push(`bongeszo koppintas: ${tap.taps.map((each) => each.count).join(" → ")} tagu fürt, majd ${tap.target} onmaga`);
  }
  if (log.axe === undefined || log.axe.violations.length !== 0 || !(log.axe.markers > 0)) {
    failures.push(`bongeszo axe: ${JSON.stringify(log.axe ?? null)}`);
  } else {
    notes.push(`bongeszo axe: 0 sertes, ${log.axe.markers} jelolo option-kent a lapon`);
  }
  if (log.control === undefined || !(log.control.problemCount > 0)) {
    failures.push("a bongeszos negativ kontroll nem talalt hibat — a DOM-mero vak lehet");
  } else {
    notes.push(`bongeszo negativ kontroll: ${log.control.problemCount} hiba egy elemet elejto lapon (ahogy kell)`);
  }
}

// --- 3. Statikus ----------------------------------------------------------------
const testSource = existsSync(conservationTest) ? readFileSync(conservationTest, "utf8") : "";
for (const needle of ['from "../../src/render.js"', 'from "../../src/scene-space.js"', "renderTimeline(", "planSceneSpace(", "readFrame(", "measure("]) {
  if (!testSource.includes(needle)) failures.push(`a megmaradas-teszt nem a valodi utat jarja (hianyzik: ${needle})`);
}
if (/vi\.mock\(|vi\.fn\(/.test(testSource)) failures.push("a megmaradas-teszt mockol — igy nem a renderelot meri");
const page = existsSync(clusterPage) ? readFileSync(clusterPage, "utf8") : "";
for (const needle of ['from "/core/index.mjs"', "mountScene(", "cluster: true", "clusterZoom(", 'querySelectorAll("[data-tl-cluster]")']) {
  if (!page.includes(needle)) failures.push(`a demo lap nem a shippelt bundle-t vagy nem az elo DOM-ot meri (hianyzik: ${needle})`);
}

for (const note of notes) console.log(`  · ${note}`);
if (failures.length > 0) {
  console.error("\nG-CLUSTER BUKOTT:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log("\nG-CLUSTER: a furtok darabszamanak osszege minden kepkockaban a lathato elemek szama (a culling-hataron atlogo furt tavoli tagjaival) — a magban es az elo DOM-ban is, egy elem sem veszett el es egy sem latszott ketszer; a merok latnak (a negativ kontrollok bukanak).");
