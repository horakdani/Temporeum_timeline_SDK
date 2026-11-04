#!/usr/bin/env node
/**
 * The second half of the visual check: proves that the visual MATRIX
 * really ran to the end.
 *
 * The fixture comparison (sdk_visual_snapshots.mjs --check) says that the
 * drawn frame did not change. This script says that the WHOLE of the
 * measurement ran: at every width, in both orientations, in both themes. The
 * two are deliberately not told by one script: a test file that silently
 * skips an orientation does not show on the fixture side.
 *
 * Two independent checks:
 *
 *  1. RUNTIME: in the vitest JSON report at least MIN_PER_CASE tests must
 *     have run for every matrix case, all passing. A missing report FAILS;
 *     it is not skipped.
 *  2. STATIC: the test file takes the matrix from the shared matrix.json and
 *     from the CORE's lists (ORIENTATIONS, THEMES), not from its own copy;
 *     and the fixture directory holds exactly the expected files.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const visualDir = join(corePackage, "test", "visual");
const fixturesDir = join(visualDir, "fixtures");
const testFile = join(visualDir, "scene.test.ts");
const reportFile = join(corePackage, ".visual-report.json");

const MIN_PER_CASE = 5;

const failures = [];
const notes = [];

const core = await import(pathToFileURL(join(corePackage, "dist", "index.mjs")).href);
const matrix = JSON.parse(readFileSync(join(visualDir, "matrix.json"), "utf8"));

const cases = [];
for (const width of matrix.widths) {
  for (const orientation of core.ORIENTATIONS) {
    for (const theme of core.THEMES) {
      cases.push({
        name: `${String(width)}-${orientation}-${theme.name}`,
        prefix: `frame ${String(width)}px ${orientation} ${theme.name}`,
        density: matrix.densityForWidth[String(width)],
      });
    }
  }
}

if (matrix.widths.length < 3) {
  failures.push(`${String(matrix.widths.length)} widths in the matrix, but at least 3 are required`);
}

// --- 1. RUNTIME --------------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `no vitest report (${reportFile}) — the visual matrix did NOT run, so this FAILS`,
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);

  if (tests.length === 0) {
    failures.push("the visual report contains no tests");
  }
  for (const test of tests) {
    if (test.status !== "passed") {
      failures.push(`visual test not passing: ${String(test.fullName)} (${String(test.status)})`);
    }
  }

  const densitiesSeen = new Set();
  for (const entry of cases) {
    const ran = tests.filter((test) => String(test.fullName).startsWith(entry.prefix));
    if (ran.length < MIN_PER_CASE) {
      failures.push(
        `${entry.prefix}: ${String(ran.length)} tests ran, but at least ` +
          `${String(MIN_PER_CASE)} are required — a skipped matrix case proves nothing`,
      );
    }
    for (const test of ran) {
      const match = /\((comfortable|compact|dense)\)/.exec(String(test.fullName));
      if (match !== null) {
        densitiesSeen.add(match[1]);
      }
    }
  }

  for (const density of core.DENSITIES) {
    if (!densitiesSeen.has(density)) {
      failures.push(`the "${density}" density appeared in no matrix case`);
    }
  }

  if (failures.length === 0) {
    notes.push(
      `${String(tests.length)} visual tests, ${String(cases.length)} matrix cases ` +
        `(${String(matrix.widths.length)} widths x ${String(core.ORIENTATIONS.length)} orientations x ` +
        `${String(core.THEMES.length)} themes), all passing`,
    );
    notes.push(`all ${String(core.DENSITIES.length)} densities appear in the matrix`);
  }
}

// --- 2. STATIC ---------------------------------------------------------------

if (!existsSync(testFile)) {
  failures.push(`no visual test file: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");
  const usesCoreLists =
    /ORIENTATIONS\b/.test(source) &&
    /THEMES\b/.test(source) &&
    /from "\.\.\/\.\.\/src\/geometry\.js"/.test(source) &&
    /from "\.\.\/\.\.\/src\/theme\.js"/.test(source);
  if (!usesCoreLists) {
    failures.push(
      "the visual test file does not build the matrix from the core's ORIENTATIONS/THEMES lists — " +
        "a local list would allow exactly that an orientation is silently left out",
    );
  } else {
    notes.push("the matrix rests on the core's ORIENTATIONS/THEMES lists, not on a local copy");
  }
  if (!/matrix\.json/.test(source)) {
    failures.push("the visual test file does not read the widths from the shared matrix.json");
  }
  if (/\[\s*"horizontal"\s*,\s*"vertical"\s*\]/.test(source)) {
    failures.push("the visual test file contains its own orientation list");
  }
}

if (!existsSync(fixturesDir)) {
  failures.push(`no fixture directory: ${fixturesDir}`);
} else {
  const onDisk = readdirSync(fixturesDir);
  const expected = new Set([...cases.map((entry) => `${entry.name}.svg`), "manifest.json"]);
  for (const name of onDisk) {
    if (!expected.has(name)) {
      failures.push(`unexpected file in the fixture directory: ${name}`);
    }
  }
  for (const name of expected) {
    const path = join(fixturesDir, name);
    if (!existsSync(path)) {
      failures.push(`missing fixture: ${name}`);
      continue;
    }
    if (name.endsWith(".svg")) {
      const text = readFileSync(path, "utf8");
      if (!text.startsWith("<svg")) {
        failures.push(`${name}: does not start with SVG`);
      }
      if (statSync(path).size < 1000) {
        failures.push(`${name}: empty or truncated fixture (${String(statSync(path).size)} bytes)`);
      }
    }
  }
  if (failures.length === 0) {
    notes.push(`${String(cases.length)} fixtures + manifest in place, all valid SVG`);
  }
}

// --- Result -------------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  FAIL ${failure}`);
  }
  console.error(`\nvisual FAILED: ${String(failures.length)} failure(s).`);
  process.exit(1);
}

console.log(
  "\nvisual passed: the frame is unchanged at 3 widths x 2 orientations x 2 themes.",
);
