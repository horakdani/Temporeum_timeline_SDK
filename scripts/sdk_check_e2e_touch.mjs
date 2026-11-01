#!/usr/bin/env node
/**
 * G-E2E-TOUCH: bizonyitja, hogy a bongeszos keszlet tenyleg lefutott —
 * valodi erintessel, eszkoz-emulacioval, es a SHIPPELT csomagon.
 *
 * Ez a kapu a legkonnyebben hazudik magarol. Harom modon:
 *
 *  1. egyetlen teszt sem fut le, es a "0 passed" is 0-s exit (a Playwright
 *     `--pass-with-no-tests` nelkul ugyan bukik, de egy ures fajl mellett a
 *     keszlet csendben elsorvad);
 *  2. a tesztek lefutnak, de asztali bongeszoben, erintes nelkul — es akkor
 *     pont azt nem mertuk, amiert a kapu letezik;
 *  3. a lap a FORRAST tolti be, nem a dist-et, es akkor a bundle hibai
 *     lathatatlanok maradnak (ez a P2 tanulsaga, kulon kapuval).
 *
 * Ezert: a riportbol minden kotelezo allitasnak zolden kell lennie, a projekt
 * eszkoz-emulaciot hasznal (erintessel), es a kiszolgalt `/core/` a dist.
 *
 * NEGYEDIK mod, amit ez a kapu a P5-ig NEM vett eszre, es ez a sajat hibaja
 * volt: a P4 `proof` mezoje azt allitotta, hogy "valodi tap/drag/long-press",
 * a kotelezo allitasok kozt viszont long-press nem szerepelt — tehat a kapu
 * zolden atengedett egy keszletet, ami a sajat igeretenek egyharmadat meg sem
 * merte. Egy kapu, aminek a claim-listaja szukebb, mint a proof-ja, pont
 * annyit er, amennyi a listan van. A lista most a P5 szerkesztesi allitasait
 * is tartalmazza, es a statikus fel megkoveteli azt a ket dolgot, amit egy
 * cim nem tud elarulni: hogy a tartas VALODI oraval tortenik (ettol
 * bizonyit barmit a kotes idozitoje), es hogy ugyanaz a lap egerrel is meg
 * van hajtva (ettol lesz a hibrid eszkoz allitasa merve, nem allitva).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsPackage = join(repoRoot, "packages", "docs");
const reportFile = join(docsPackage, ".e2e-touch-report.json");
const configFile = join(docsPackage, "playwright.config.ts");
const serverFile = join(docsPackage, "e2e", "serve.mjs");
const pageFile = join(docsPackage, "public", "index.html");
const specFile = join(docsPackage, "e2e", "touch.spec.ts");

const MIN_TESTS = 15;
/**
 * A kapu proof-ja. Mindegyikhez kell zold teszt.
 *
 * Az elso hat a P4-e (gesztusok), a tobbi a P5-e (szerkesztes). A
 * "hosszú nyomás" azert all itt kulon, mert a P4 proof-ja mar allitotta, a
 * lista viszont nem kerte — es akkor senki nem merte.
 */
const REQUIRED_CLAIMS = [
  "pásztáz",
  "touch-action",
  "ELVESZI a gesztust",
  "pinch",
  "dupla koppintás",
  "két ujjas koppintás",
  "hosszú nyomás",
  "tartás NÉLKÜL",
  "az egér ugyanezen a lapon azonnal húz",
  "fogantyú",
  "hoszt szabálya",
  "lezárt elem",
  "visszavonás",
  "koppintás kijelöl",
];

const failures = [];
const notes = [];

// --- 1. FUTASIDEJU -----------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(`nincs e2e-riport (${reportFile}) — a bongeszos keszlet NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const stats = report.stats ?? {};
  const specs = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      specs.push(spec);
    }
    for (const child of suite.suites ?? []) {
      walk(child);
    }
  };
  for (const suite of report.suites ?? []) {
    walk(suite);
  }

  if (specs.length < MIN_TESTS) {
    failures.push(`${String(specs.length)} e2e teszt futott, de legalabb ${String(MIN_TESTS)} kell`);
  }
  if (Number(stats.unexpected ?? 0) > 0) {
    failures.push(`${String(stats.unexpected)} bukott e2e teszt`);
  }
  if (Number(stats.flaky ?? 0) > 0) {
    failures.push(
      `${String(stats.flaky)} flaky e2e teszt — egy bizonytalan bizonyitek nem bizonyitek`,
    );
  }
  if (Number(stats.skipped ?? 0) > 0) {
    failures.push(`${String(stats.skipped)} kihagyott e2e teszt — a kihagyas BUKAS, nem semleges`);
  }
  for (const spec of specs) {
    for (const test of spec.tests ?? []) {
      if (test.status !== "expected") {
        failures.push(`nem zold e2e teszt: ${String(spec.title)} (${String(test.status)})`);
      }
    }
  }
  const titles = specs.map((spec) => String(spec.title).toLowerCase());
  for (const claim of REQUIRED_CLAIMS) {
    if (!titles.some((title) => title.includes(claim.toLowerCase()))) {
      failures.push(`a kapu allit valamit, amit senki nem mer a bongeszoben: "${claim}"`);
    }
  }
  const projects = report.config?.projects ?? [];
  if (projects.length === 0) {
    failures.push("a riport egyetlen projektet sem nevez meg — nem tudjuk, min futott");
  }
  for (const project of projects) {
    if (Number(project.retries ?? 0) > 0) {
      failures.push(
        `a ${String(project.name)} projekt ujraprobal (${String(project.retries)}) — az elrejti a flaky gesztust`,
      );
    }
  }
  if (failures.length === 0) {
    notes.push(
      `${String(specs.length)} bongeszos teszt, mind zold, ${String(projects.length)} eszkozon: ` +
        projects.map((project) => project.name).join(", "),
    );
  }
}

// --- 2. STATIKUS: valodi eszkoz, valodi csomag -------------------------------

const config = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
if (config === "") {
  failures.push(`nincs playwright konfig: ${configFile}`);
} else {
  if (!/devices\[/.test(config)) {
    failures.push(
      "a konfig nem hasznal eszkoz-emulaciot (`devices[...]`) — asztali bongeszoben nincs erintes",
    );
  }
  if (!/retries:\s*0/.test(config)) {
    failures.push("a konfig nem zarja ki az ujraprobalast");
  }
}

const spec = existsSync(specFile) ? readFileSync(specFile, "utf8") : "";
if (spec === "") {
  failures.push(`nincs bongeszos keszlet: ${specFile}`);
} else {
  if (!/waitForTimeout\(/.test(spec)) {
    failures.push(
      "a keszlet sehol nem var valodi orat — a hosszu nyomast csak igy lehet megmerni, " +
        "es a kotes idozitojerol enelkul semmit nem allitottunk",
    );
  }
  if (!/page\.mouse\./.test(spec)) {
    failures.push(
      "a keszlet nem hajtja meg a lapot egerrel — egy erintokijelzos eszkozon is van eger, " +
        "es eppen az a kerdes, hogy a ketto nem mossa ossze egymast",
    );
  }
  if (failures.length === 0) {
    notes.push("a tartas valodi oraval megy, es ugyanaz a lap egerrel is meg van hajtva");
  }
}

const page = existsSync(pageFile) ? readFileSync(pageFile, "utf8") : "";
if (page === "") {
  failures.push(`nincs demo lap: ${pageFile}`);
} else if (!/from\s*"\/core\/index\.mjs"/.test(page) || !/from\s*"\/core\/dom\.mjs"/.test(page)) {
  failures.push("a demo lap nem a `/core/` ala kiszolgalt csomagbol importal");
}

const server = existsSync(serverFile) ? readFileSync(serverFile, "utf8") : "";
if (server === "") {
  failures.push(`nincs statikus szerver: ${serverFile}`);
} else if (!/"core",\s*"dist"/.test(server)) {
  failures.push(
    "a szerver nem a dist-et szolgalja ki a `/core/` ala — a bongeszoben a SHIPPELT csomagnak kell futnia",
  );
} else {
  notes.push("a bongeszo a shippelt dist-et futtatja, nem a forrast");
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
  console.error(`\nG-E2E-TOUCH BUKOTT: ${String(failures.length)} hiba.`);
  process.exit(1);
}

console.log("\nG-E2E-TOUCH atment: valodi tap, huzas es pinch egy emulalt erintokijelzon.");
