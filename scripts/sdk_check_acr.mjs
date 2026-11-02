#!/usr/bin/env node
/**
 * G-ACR: the conformance report (packages/docs/site/conformance/
 * wcag22.json) lists EVERY A and AA success criterion of WCAG 2.2, and every
 * "supports" row is backed by an existing, PASSING test.
 *
 *  1. COMPLETENESS. The canonical list lives HERE (not in the data file): the
 *     32 A and 24 AA criteria of WCAG 2.2, including 4.1.1 (2.2 marks it
 *     obsolete and removed, but it keeps its place in the numbering). The
 *     data file must hold exactly these, in this order, with the same level
 *     and name; a missing, extra or duplicated criterion is a FAILURE.
 *  2. SHAPE. The status is one of the four; every row has remarks; a
 *     "supports" row has at least one test; a row whose remarks say "Not
 *     verified by a test" cannot be "supports"; a "not-applicable" row cites
 *     no test (what a test shows is not "not applicable").
 *  3. EXISTENCE. Every cited test file exists, and the cited title fragment
 *     appears verbatim in its source.
 *  4. PASSING. This checker RUNS the cited tests: the core's files with the
 *     core's vitest, the element's with the element's (browser) vitest, the
 *     docs e2e specs with their own Playwright config (and the JSON report
 *     that goes with it). Every citation needs at least one test that ran
 *     with the fragment in its title, and every such test must pass. A
 *     skipped, missing or failed test is a FAILURE; a run that cannot be
 *     executed is a FAILURE too.
 *  5. NEGATIVE CONTROL. An invented citation (existing file, non-existent
 *     title) fails at point 3, and a "supports" row without a test fails at
 *     point 2 — otherwise the checker is blind.
 *
 * Prerequisite: none; the checker builds the docs itself (the Playwright
 * specs measure the built pages).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = join(repo, "packages", "docs", "site", "conformance", "wcag22.json");
const failures = [];
const notes = [];

/** WCAG 2.2, A and AA: id, level, name — per the W3C Recommendation (2023-10-05, updated 2024-12-12). */
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

// --- 1-2. completeness and shape ------------------------------------------------
/** The shape and completeness problems of a report. */
export function judgeShape(data) {
  const problems = [];
  const criteria = Array.isArray(data?.criteria) ? data.criteria : [];
  const ids = criteria.map((row) => row.id);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`${String(id)} appears twice`);
    seen.add(id);
  }
  for (const [id, level, name] of WCAG22) {
    const row = criteria.find((each) => each.id === id);
    if (row === undefined) {
      problems.push(`missing: ${id} ${name} (${level})`);
      continue;
    }
    if (row.level !== level) problems.push(`${id}: the level is ${String(row.level)}, WCAG 2.2 says ${level}`);
    if (row.name !== name) problems.push(`${id}: the name is ${JSON.stringify(row.name)}, WCAG 2.2 says ${JSON.stringify(name)}`);
  }
  for (const id of ids) if (!WCAG22.some(([known]) => known === id)) problems.push(`not a WCAG 2.2 A/AA criterion: ${String(id)}`);
  if (JSON.stringify(ids) !== JSON.stringify(WCAG22.map(([id]) => id)) && problems.length === 0) problems.push("the criteria are not in WCAG order");
  for (const row of criteria) {
    if (!STATUSES.has(row.status)) problems.push(`${String(row.id)}: unknown status ${JSON.stringify(row.status)}`);
    if (typeof row.remarks !== "string" || row.remarks.trim().length < 10) problems.push(`${String(row.id)}: no remarks`);
    const tests = Array.isArray(row.tests) ? row.tests : null;
    if (tests === null) problems.push(`${String(row.id)}: no tests list`);
    if (row.status === "supports" && (tests ?? []).length === 0) problems.push(`${String(row.id)}: "supports", but no test shows it`);
    if (row.status === "supports" && /^Not verified by a test/i.test(row.remarks ?? "")) problems.push(`${String(row.id)}: "supports", but the remarks say it is not tested`);
    if (row.status === "not-applicable" && (tests ?? []).length > 0) problems.push(`${String(row.id)}: "not-applicable", yet it cites a test`);
    for (const ref of tests ?? []) {
      if (typeof ref?.file !== "string" || typeof ref?.test !== "string" || ref.test.length < 3) problems.push(`${String(row.id)}: malformed citation ${JSON.stringify(ref)}`);
    }
  }
  return problems;
}

// --- 3. existence -------------------------------------------------------------------
/** The existence problem of a citation, or null. */
export function judgeExists(ref) {
  const file = join(repo, ref.file);
  if (!existsSync(file)) return `no such test file: ${ref.file}`;
  if (!readFileSync(file, "utf8").includes(ref.test)) return `${ref.file}: no such title in the source: ${JSON.stringify(ref.test)}`;
  return null;
}

if (!existsSync(dataFile)) {
  failures.push(`no conformance report: ${relative(repo, dataFile)}`);
}
const data = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, "utf8")) : { criteria: [] };
if (data.standard !== "WCAG 2.2") failures.push(`the report's standard is ${JSON.stringify(data.standard)}, WCAG 2.2 is required`);
failures.push(...judgeShape(data));
const refs = data.criteria.flatMap((row) => (row.status === "supports" || row.status === "partially-supports" ? row.tests : []).map((ref) => ({ ...ref, id: row.id, status: row.status })));
for (const ref of refs) {
  const problem = judgeExists(ref);
  if (problem !== null) failures.push(`${ref.id}: ${problem}`);
}
const counts = Object.fromEntries([...STATUSES].map((status) => [status, data.criteria.filter((row) => row.status === status).length]));
notes.push(`${String(data.criteria.length)} criteria (${WCAG22.filter(([, level]) => level === "A").length} A, ${WCAG22.filter(([, level]) => level === "AA").length} AA): ${JSON.stringify(counts)}; ${String(refs.length)} test citations`);

// --- 5. negative control (shape and existence) ------------------------------------------
{
  const invented = judgeExists({ file: "packages/core/test/a11y/contrast.test.ts", test: "a title no test has, invented for the control" });
  const bare = judgeShape({ criteria: WCAG22.map(([id, level, name]) => ({ id, level, name, status: "supports", remarks: "Claimed without a test, for the control.", tests: [] })) });
  const short = judgeShape({ criteria: WCAG22.slice(1).map(([id, level, name]) => ({ id, level, name, status: "not-applicable", remarks: "Left out one criterion, for the control.", tests: [] })) });
  if (invented === null) failures.push("NEGATIVE CONTROL: an invented test citation does NOT fail");
  if (bare.length === 0) failures.push('NEGATIVE CONTROL: a "supports" without a test does NOT fail');
  if (!short.some((problem) => problem.startsWith("missing: 1.1.1"))) failures.push("NEGATIVE CONTROL: a missing criterion does NOT fail");
  else notes.push("negative control fails, as it should — invented title, supports without a test, missing criterion");
}

// --- 4. passing -----------------------------------------------------------------------
const RUNNERS = [
  { prefix: "packages/core/test/", kind: "vitest", cwd: join(repo, "packages", "core"), report: ".acr-core-report.json" },
  { prefix: "packages/web-component/test/", kind: "vitest", cwd: join(repo, "packages", "web-component"), report: ".acr-element-report.json" },
];
/** The docs e2e specs: each with its own config and report, as its own npm script runs it. */
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

/** The tests that ran: { file, title, status } — from the vitest JSON report. */
function vitestResults(path) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  return (report.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((test) => ({ file: relative(repo, file.name), title: String(test.fullName ?? test.title), status: test.status })),
  );
}

/** The tests that ran, from the Playwright JSON report, in every project. */
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
  if (!existsSync(report)) failures.push(`the vitest run of ${relative(repo, runner.cwd)} wrote no report — it cannot be run, so this is a FAILURE`);
  else results.push(...vitestResults(report));
}
const specFiles = [...new Set(greenRefs.filter((ref) => ref.file.startsWith("packages/docs/e2e/")).map((ref) => ref.file))];
if (specFiles.length > 0) {
  if (run("npm", ["run", "--silent", "build", "-w", "@temporeum/timeline-docs"], repo) !== 0) failures.push("the docs build failed — the e2e specs cannot be run, so this is a FAILURE");
  else {
    for (const file of specFiles) {
      const spec = SPECS[file];
      if (spec === undefined) {
        failures.push(`${file}: the checker has no way to run it — it cannot be run, so this is a FAILURE`);
        continue;
      }
      const report = join(docs, spec.report);
      rmSync(report, { force: true });
      run("npx", ["playwright", "test", "-c", spec.config], docs, spec.env);
      if (!existsSync(report)) failures.push(`${file}: the Playwright run wrote no report (${spec.report}) — it cannot be run, so this is a FAILURE`);
      else results.push(...playwrightResults(report));
    }
  }
}
let green = 0;
for (const ref of greenRefs) {
  const matching = results.filter((result) => result.file === ref.file && result.title.includes(ref.test));
  if (matching.length === 0) failures.push(`${ref.id}: the cited test did not run: ${ref.file} — ${JSON.stringify(ref.test)}`);
  // A Playwright test the spec skips on purpose in one project (the keyboard is desktop
  // only) is not a failure only if the same test passes in another project.
  const passedIn = (title) => matching.some((result) => result.title === title && result.status === "passed");
  const red = matching.filter((result) => result.status !== "passed" && !(result.status === "skipped" && result.project !== undefined && passedIn(result.title)));
  for (const result of red) failures.push(`${ref.id}: not passing: ${ref.file} — ${result.title} (${result.status})`);
  if (matching.length > 0 && red.length === 0) green += 1;
}
notes.push(`${String(green)}/${String(greenRefs.length)} "supports" citations passing (${String(results.length)} tests ran)`);

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "G-ACR: passed" : `G-ACR: FAILED (${String(failures.length)} problems)`);
process.exit(failures.length === 0 ? 0 : 1);
