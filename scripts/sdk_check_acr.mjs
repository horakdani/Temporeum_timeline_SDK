#!/usr/bin/env node
/**
 * G-ACR (P28): a megfelelosegi jelentes (packages/docs/site/conformance/
 * wcag22.json) a WCAG 2.2 MINDEN A es AA sikeressegi feltetelet felsorolja,
 * es minden "megfelel" (supports) sorhoz letezo, ZOLD teszt tartozik.
 *
 *  1. TELJESSEG. A kanonikus lista ITT van (nem az adatfajlban): a WCAG 2.2
 *     32 A es 24 AA feltetele, a 4.1.1-gyel (a 2.2 elavultnak es
 *     eltavolitottnak jeloli, de a szamozasban ott all). Az adatfajlban
 *     pontosan ezek legyenek, ebben a sorrendben, ugyanazzal a szinttel es
 *     nevvel; hianyzo, folosleges vagy ketszer szereplo feltetel BUKAS.
 *  2. ALAK. Az allapot a negy kozul valo; minden sornak van indoklasa; a
 *     "supports" sornak legalabb egy tesztje; a "Not verified by a test"
 *     indoklasu sor nem lehet "supports"; a "not-applicable" sor nem hivatkozik
 *     tesztre (amit teszt mutat, az nem "nem alkalmazhato").
 *  3. LETEZES. Minden hivatkozott tesztfajl letezik, es a hivatkozott
 *     cimreszlet szo szerint benne van a forrasban.
 *  4. ZOLD. A hivatkozott teszteket ez a mero FUTTATJA: a mag fajljait a mag
 *     vitestje, az elemeit az elem (bongeszos) vitestje, a docs e2e-speceit a
 *     sajat Playwright-konfiguraciojuk (a hozzajuk tartozo JSON-riporttal).
 *     Minden hivatkozashoz legalabb egy lefutott teszt kell, amelynek a
 *     cimeben a reszlet szerepel, es mindegyik ilyen zold. Kihagyott,
 *     hianyzo vagy bukott teszt BUKAS; a nem futtathato futas is BUKAS.
 *  5. NEGATIV KONTROLL. Egy kitalalt hivatkozas (letezo fajl, nem letezo
 *     cim) a 3. ponton bukik, es egy "supports" sor teszt nelkul a 2. ponton
 *     — kulonben a mero vak.
 *
 * Elofeltetel: nincs; a mero maga epiti a docs-ot (a Playwright-specek a
 * felepitett lapokat merik).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = join(repo, "packages", "docs", "site", "conformance", "wcag22.json");
const failures = [];
const notes = [];

/** WCAG 2.2, A es AA: azonosito, szint, nev — a W3C Recommendation (2023-10-05, frissitve 2024-12-12) szerint. */
const WCAG22 = [
  ["1.1.1", "A", "Non-text Content"],
  ["1.2.1", "A", "Audio-only and Video-only (Prerecorded)"],
  ["1.2.2", "A", "Captions (Prerecorded)"],
  ["1.2.3", "A", "Audio Description or Media Alternative (Prerecorded)"],
  ["1.2.4", "AA", "Captions (Live)"],
  ["1.2.5", "AA", "Audio Description (Prerecorded)"],
  ["1.3.1", "A", "Info and Relationships"],
  ["1.3.2", "A", "Meaningful Sequence"],
  ["1.3.3", "A", "Sensory Characteristics"],
  ["1.3.4", "AA", "Orientation"],
  ["1.3.5", "AA", "Identify Input Purpose"],
  ["1.4.1", "A", "Use of Color"],
  ["1.4.2", "A", "Audio Control"],
  ["1.4.3", "AA", "Contrast (Minimum)"],
  ["1.4.4", "AA", "Resize Text"],
  ["1.4.5", "AA", "Images of Text"],
  ["1.4.10", "AA", "Reflow"],
  ["1.4.11", "AA", "Non-text Contrast"],
  ["1.4.12", "AA", "Text Spacing"],
  ["1.4.13", "AA", "Content on Hover or Focus"],
  ["2.1.1", "A", "Keyboard"],
  ["2.1.2", "A", "No Keyboard Trap"],
  ["2.1.4", "A", "Character Key Shortcuts"],
  ["2.2.1", "A", "Timing Adjustable"],
  ["2.2.2", "A", "Pause, Stop, Hide"],
  ["2.3.1", "A", "Three Flashes or Below Threshold"],
  ["2.4.1", "A", "Bypass Blocks"],
  ["2.4.2", "A", "Page Titled"],
  ["2.4.3", "A", "Focus Order"],
  ["2.4.4", "A", "Link Purpose (In Context)"],
  ["2.4.5", "AA", "Multiple Ways"],
  ["2.4.6", "AA", "Headings and Labels"],
  ["2.4.7", "AA", "Focus Visible"],
  ["2.4.11", "AA", "Focus Not Obscured (Minimum)"],
  ["2.5.1", "A", "Pointer Gestures"],
  ["2.5.2", "A", "Pointer Cancellation"],
  ["2.5.3", "A", "Label in Name"],
  ["2.5.4", "A", "Motion Actuation"],
  ["2.5.7", "AA", "Dragging Movements"],
  ["2.5.8", "AA", "Target Size (Minimum)"],
  ["3.1.1", "A", "Language of Page"],
  ["3.1.2", "AA", "Language of Parts"],
  ["3.2.1", "A", "On Focus"],
  ["3.2.2", "A", "On Input"],
  ["3.2.3", "AA", "Consistent Navigation"],
  ["3.2.4", "AA", "Consistent Identification"],
  ["3.2.6", "A", "Consistent Help"],
  ["3.3.1", "A", "Error Identification"],
  ["3.3.2", "A", "Labels or Instructions"],
  ["3.3.3", "AA", "Error Suggestion"],
  ["3.3.4", "AA", "Error Prevention (Legal, Financial, Data)"],
  ["3.3.7", "A", "Redundant Entry"],
  ["3.3.8", "AA", "Accessible Authentication (Minimum)"],
  ["4.1.1", "A", "Parsing (Obsolete and removed)"],
  ["4.1.2", "A", "Name, Role, Value"],
  ["4.1.3", "AA", "Status Messages"],
];
const STATUSES = new Set(["supports", "partially-supports", "does-not-support", "not-applicable"]);

// --- 1-2. teljesseg es alak ------------------------------------------------------
/** Egy jelentes alak- es teljessegi hibai. */
export function judgeShape(data) {
  const problems = [];
  const criteria = Array.isArray(data?.criteria) ? data.criteria : [];
  const ids = criteria.map((row) => row.id);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`${String(id)} ketszer szerepel`);
    seen.add(id);
  }
  for (const [id, level, name] of WCAG22) {
    const row = criteria.find((each) => each.id === id);
    if (row === undefined) {
      problems.push(`hianyzik: ${id} ${name} (${level})`);
      continue;
    }
    if (row.level !== level) problems.push(`${id}: a szint ${String(row.level)}, a WCAG 2.2 szerint ${level}`);
    if (row.name !== name) problems.push(`${id}: a nev ${JSON.stringify(row.name)}, a WCAG 2.2 szerint ${JSON.stringify(name)}`);
  }
  for (const id of ids) if (!WCAG22.some(([known]) => known === id)) problems.push(`nem WCAG 2.2 A/AA feltetel: ${String(id)}`);
  if (JSON.stringify(ids) !== JSON.stringify(WCAG22.map(([id]) => id)) && problems.length === 0) problems.push("a feltetelek nem a WCAG sorrendjeben allnak");
  for (const row of criteria) {
    if (!STATUSES.has(row.status)) problems.push(`${String(row.id)}: ismeretlen allapot ${JSON.stringify(row.status)}`);
    if (typeof row.remarks !== "string" || row.remarks.trim().length < 10) problems.push(`${String(row.id)}: nincs indoklas`);
    const tests = Array.isArray(row.tests) ? row.tests : null;
    if (tests === null) problems.push(`${String(row.id)}: nincs tests lista`);
    if (row.status === "supports" && (tests ?? []).length === 0) problems.push(`${String(row.id)}: "supports", de nincs teszt, ami mutatja`);
    if (row.status === "supports" && /^Not verified by a test/i.test(row.remarks ?? "")) problems.push(`${String(row.id)}: "supports", de az indoklas szerint nincs tesztelve`);
    if (row.status === "not-applicable" && (tests ?? []).length > 0) problems.push(`${String(row.id)}: "not-applicable", megis tesztre hivatkozik`);
    for (const ref of tests ?? []) {
      if (typeof ref?.file !== "string" || typeof ref?.test !== "string" || ref.test.length < 3) problems.push(`${String(row.id)}: hibas hivatkozas ${JSON.stringify(ref)}`);
    }
  }
  return problems;
}

// --- 3. letezes ---------------------------------------------------------------------
/** Egy hivatkozas letezesi hibaja, vagy null. */
export function judgeExists(ref) {
  const file = join(repo, ref.file);
  if (!existsSync(file)) return `nincs ilyen tesztfajl: ${ref.file}`;
  if (!readFileSync(file, "utf8").includes(ref.test)) return `${ref.file}: nincs ilyen cim a forrasban: ${JSON.stringify(ref.test)}`;
  return null;
}

if (!existsSync(dataFile)) {
  failures.push(`nincs megfelelosegi jelentes: ${relative(repo, dataFile)}`);
}
const data = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, "utf8")) : { criteria: [] };
if (data.standard !== "WCAG 2.2") failures.push(`a jelentes szabvanya ${JSON.stringify(data.standard)}, WCAG 2.2 kell`);
failures.push(...judgeShape(data));
const refs = data.criteria.flatMap((row) => (row.status === "supports" || row.status === "partially-supports" ? row.tests : []).map((ref) => ({ ...ref, id: row.id, status: row.status })));
for (const ref of refs) {
  const problem = judgeExists(ref);
  if (problem !== null) failures.push(`${ref.id}: ${problem}`);
}
const counts = Object.fromEntries([...STATUSES].map((status) => [status, data.criteria.filter((row) => row.status === status).length]));
notes.push(`${String(data.criteria.length)} feltetel (${WCAG22.filter(([, level]) => level === "A").length} A, ${WCAG22.filter(([, level]) => level === "AA").length} AA): ${JSON.stringify(counts)}; ${String(refs.length)} teszthivatkozas`);

// --- 5. negativ kontroll (alak es letezes) ----------------------------------------------
{
  const invented = judgeExists({ file: "packages/core/test/a11y/contrast.test.ts", test: "a title no test has, invented for the control" });
  const bare = judgeShape({ criteria: WCAG22.map(([id, level, name]) => ({ id, level, name, status: "supports", remarks: "Claimed without a test, for the control.", tests: [] })) });
  const short = judgeShape({ criteria: WCAG22.slice(1).map(([id, level, name]) => ({ id, level, name, status: "not-applicable", remarks: "Left out one criterion, for the control.", tests: [] })) });
  if (invented === null) failures.push("NEGATIV KONTROLL: egy kitalalt teszthivatkozas NEM bukik");
  if (bare.length === 0) failures.push('NEGATIV KONTROLL: a teszt nelkuli "supports" NEM bukik');
  if (!short.some((problem) => problem.startsWith("hianyzik: 1.1.1"))) failures.push("NEGATIV KONTROLL: a hianyzo feltetel NEM bukik");
  else notes.push("negativ kontroll bukik, ahogy kell — kitalalt cim, teszt nelkuli supports, hianyzo feltetel");
}

// --- 4. zold --------------------------------------------------------------------------
const RUNNERS = [
  { prefix: "packages/core/test/", kind: "vitest", cwd: join(repo, "packages", "core"), report: ".acr-core-report.json" },
  { prefix: "packages/web-component/test/", kind: "vitest", cwd: join(repo, "packages", "web-component"), report: ".acr-element-report.json" },
];
/** A docs e2e-specek: mindegyik a sajat konfiguraciojaval es riportjaval, ahogy a sajat npm-szkriptje futtatja. */
const SPECS = {
  "packages/docs/e2e/a11y.spec.ts": { config: "playwright.a11y.config.ts", report: ".e2e-a11y-report.json", env: {} },
  "packages/docs/e2e/responsive.spec.ts": { config: "playwright.responsive.config.ts", report: ".e2e-responsive-report.json", env: {} },
  "packages/docs/e2e/touch.spec.ts": { config: "playwright.config.ts", report: ".e2e-touch-report.json", env: {} },
  "packages/docs/e2e/tooltip.spec.ts": {
    config: "playwright.p19.config.ts",
    report: ".e2e-tooltip-report.json",
    env: { TL_P19_SPEC: "tooltip.spec.ts", TL_P19_REPORT: ".e2e-tooltip-report.json", TL_P19_PORT: "41767" },
  },
};
const docs = join(repo, "packages", "docs");

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } });
  return result.status;
}

/** A lefutott tesztek: { file, title, status } — a vitest JSON-riportjabol. */
function vitestResults(path) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  return (report.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((test) => ({ file: relative(repo, file.name), title: String(test.fullName ?? test.title), status: test.status })),
  );
}

/** A lefutott tesztek a Playwright JSON-riportjabol, minden projektben. */
function playwrightResults(path) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  const out = [];
  const walk = (suite, trail) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = (test.results ?? []).at(-1);
        out.push({ file: relative(repo, join(docs, "e2e", spec.file ?? suite.file ?? "")), title: [...trail, spec.title].join(" "), project: test.projectName, status: last?.status === "passed" ? "passed" : String(last?.status ?? test.status ?? "missing") });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return out;
}

const results = [];
const greenRefs = refs.filter((ref) => ref.status === "supports");
for (const runner of RUNNERS) {
  const files = [...new Set(greenRefs.filter((ref) => ref.file.startsWith(runner.prefix)).map((ref) => relative(runner.cwd, join(repo, ref.file))))];
  if (files.length === 0) continue;
  const report = join(runner.cwd, runner.report);
  rmSync(report, { force: true });
  run("npx", ["vitest", "run", ...files, "--reporter=default", "--reporter=json", `--outputFile.json=${runner.report}`], runner.cwd);
  if (!existsSync(report)) failures.push(`a(z) ${relative(repo, runner.cwd)} vitest-futasa nem irt riportot — nem futtathato, ezert BUKAS`);
  else results.push(...vitestResults(report));
}
const specFiles = [...new Set(greenRefs.filter((ref) => ref.file.startsWith("packages/docs/e2e/")).map((ref) => ref.file))];
if (specFiles.length > 0) {
  if (run("npm", ["run", "--silent", "build", "-w", "@temporeum/timeline-docs"], repo) !== 0) failures.push("a docs build bukott — az e2e-specek nem futtathatok, ezert BUKAS");
  else {
    for (const file of specFiles) {
      const spec = SPECS[file];
      if (spec === undefined) {
        failures.push(`${file}: nincs hozza futtatasi mod a merokben — nem futtathato, ezert BUKAS`);
        continue;
      }
      const report = join(docs, spec.report);
      rmSync(report, { force: true });
      run("npx", ["playwright", "test", "-c", spec.config], docs, spec.env);
      if (!existsSync(report)) failures.push(`${file}: a Playwright-futas nem irt riportot (${spec.report}) — nem futtathato, ezert BUKAS`);
      else results.push(...playwrightResults(report));
    }
  }
}
let green = 0;
for (const ref of greenRefs) {
  const matching = results.filter((result) => result.file === ref.file && result.title.includes(ref.test));
  if (matching.length === 0) failures.push(`${ref.id}: a hivatkozott teszt nem futott le: ${ref.file} — ${JSON.stringify(ref.test)}`);
  // A Playwright-teszt, amit a spec egy projektben szandekosan kihagy (a billentyuzet csak
  // asztalon), csak akkor nem bukas, ha ugyanaz a teszt egy masik projektben zold.
  const passedIn = (title) => matching.some((result) => result.title === title && result.status === "passed");
  const red = matching.filter((result) => result.status !== "passed" && !(result.status === "skipped" && result.project !== undefined && passedIn(result.title)));
  for (const result of red) failures.push(`${ref.id}: nem zold: ${ref.file} — ${result.title} (${result.status})`);
  if (matching.length > 0 && red.length === 0) green += 1;
}
notes.push(`${String(green)}/${String(greenRefs.length)} "supports"-hivatkozas zold (${String(results.length)} lefutott teszt)`);

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-ACR: atment" : `G-ACR: BUKOTT (${String(failures.length)} hiba)`);
process.exit(failures.length === 0 ? 0 : 1);
