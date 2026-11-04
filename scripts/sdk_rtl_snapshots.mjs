#!/usr/bin/env node
/**
 * The visual half of the rtl check: the visual matrix right-to-left, on the SHIPPED bundle.
 *
 * The same matrix as the visual check's (the widths from matrix.json, the core's
 * ORIENTATIONS and THEMES), the same scenario — and every case goes through
 * `mirrorScene` (/intl), from dist. In a separate directory
 * (test/rtl/fixtures/), because the visual check treats every file in its own
 * directory that has no case as stale.
 *
 * The same three decisions as in sdk_visual_snapshots.mjs: it measures the
 * built package, regenerates and compares byte for byte (a missing fixture is
 * a FAILURE), and keeps sha256 provenance.
 *
 * Usage:
 *   node scripts/sdk_rtl_snapshots.mjs            # writes the fixtures
 *   node scripts/sdk_rtl_snapshots.mjs --check    # gate mode: only checks
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const visualDir = join(corePackage, "test", "visual");
const fixturesDir = join(corePackage, "test", "rtl", "fixtures");
const manifestPath = join(fixturesDir, "manifest.json");
const checkOnly = process.argv.includes("--check");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const time = (value) => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Unparseable time in the scenario: ${String(value)}`);
  return parsed;
};

/** The scenario, read the way the visual check reads it: ISO strings to epoch ms. */
export function hydrateScenario(scenario) {
  return {
    timeZone: scenario.timeZone,
    ariaLabel: scenario.ariaLabel,
    domain: [time(scenario.domain[0]), time(scenario.domain[1])],
    selectedIds: scenario.selectedIds ?? [],
    lanes: scenario.lanes,
    items: scenario.items.map((item) => ({
      ...item,
      start: time(item.start),
      ...(item.end === undefined ? {} : { end: time(item.end) }),
    })),
    decorations: scenario.decorations.map((decoration) =>
      decoration.time === undefined
        ? decoration.start === undefined
          ? decoration
          : { ...decoration, start: time(decoration.start), end: time(decoration.end) }
        : { ...decoration, time: time(decoration.time) },
    ),
  };
}

/** The matrix's RTL cases: width x orientation x theme, with names ending in `-rtl`. */
export function rtlCases(core, matrix) {
  const cases = [];
  for (const width of matrix.widths) {
    for (const orientation of core.ORIENTATIONS) {
      for (const theme of core.THEMES) {
        cases.push({
          name: `${String(width)}-${orientation}-${theme.name}-rtl`,
          width,
          height: matrix.height,
          orientation,
          density: matrix.densityForWidth[String(width)],
          theme: theme.name,
        });
      }
    }
  }
  return cases;
}

/** One case: drawn the same way as the visual check's, then mirrored. */
export function renderRtlCase(core, intl, scenario, entry) {
  const result = core.renderTimeline({
    items: scenario.items,
    lanes: scenario.lanes,
    domain: scenario.domain,
    width: entry.width,
    height: entry.height,
    orientation: entry.orientation,
    density: entry.density,
    theme: entry.theme,
    instanceId: entry.name.replace(/[^A-Za-z0-9_-]/g, "-"),
    timeZone: scenario.timeZone,
    decorations: scenario.decorations,
    selectedIds: scenario.selectedIds,
    ariaLabel: scenario.ariaLabel,
  });
  return `${core.renderToSvgString(intl.mirrorScene(result.scene), { pretty: true })}\n`;
}

async function main() {
  execFileSync("npm", ["run", "--silent", "build"], { cwd: corePackage, stdio: "pipe" });
  const core = await import(pathToFileURL(join(corePackage, "dist", "index.mjs")).href);
  const intl = await import(pathToFileURL(join(corePackage, "dist", "intl.mjs")).href);
  const matrixSource = readFileSync(join(visualDir, "matrix.json"), "utf8");
  const scenarioSource = readFileSync(join(visualDir, "scenario.json"), "utf8");
  const scenario = hydrateScenario(JSON.parse(scenarioSource));
  const cases = rtlCases(core, JSON.parse(matrixSource));
  const rendered = new Map(cases.map((entry) => [`${entry.name}.svg`, renderRtlCase(core, intl, scenario, entry)]));
  const manifest = {
    note: "The rtl check's visual provenance: the visual check's matrix, mirrored. The sha256 of the scenario, the matrix and every fixture.",
    core: core.VERSION,
    scenarioSha256: sha256(scenarioSource),
    matrixSha256: sha256(matrixSource),
    cases: cases.map((entry) => ({ name: entry.name, sha256: sha256(rendered.get(`${entry.name}.svg`)) })),
  };

  if (!checkOnly) {
    mkdirSync(fixturesDir, { recursive: true });
    for (const [name, svg] of rendered) writeFileSync(join(fixturesDir, name), svg, "utf8");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`${String(rendered.size)} RTL fixtures written: ${fixturesDir}`);
    return;
  }

  const failures = [];
  if (!existsSync(manifestPath)) {
    failures.push(`no manifest (${manifestPath}) — nothing to compare against, so FAIL`);
  } else {
    const stored = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (stored.scenarioSha256 !== manifest.scenarioSha256) failures.push("the scenario changed, but the RTL fixtures were not regenerated");
    if (stored.matrixSha256 !== manifest.matrixSha256) failures.push("the matrix changed, but the RTL fixtures were not regenerated");
  }
  const onDisk = existsSync(fixturesDir) ? readdirSync(fixturesDir).filter((name) => name.endsWith(".svg")) : [];
  for (const name of onDisk) if (!rendered.has(name)) failures.push(`stale RTL fixture: ${name} — no case for it`);
  for (const [name, svg] of rendered) {
    const path = join(fixturesDir, name);
    if (!existsSync(path)) failures.push(`missing RTL fixture: ${name} — a missing fixture is a FAILURE, not a skip`);
    else if (readFileSync(path, "utf8") !== svg) failures.push(`RTL fixture drifted: ${name}`);
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ERROR ${failure}`);
    console.error(`\nrtl (fixtures) FAILED: ${String(failures.length)} errors.`);
    process.exit(1);
  }
  console.log(`rtl fixtures: all ${String(rendered.size)} RTL cases match byte for byte.`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
