#!/usr/bin/env node
/**
 * The first half of the visual check: visual regression on the SHIPPED bundle.
 *
 * What it proves: the renderer produces the same frame at 3 widths x 2
 * orientations x 2 themes as the fixtures stored in the repo say.
 *
 * There are three decisions in it, each against a false green:
 *
 * 1. **It measures the BUILT package, not the source.** It builds first, then
 *    imports `dist/index.mjs`. This is a lesson from the size check: a check
 *    that is green on the source says nothing about the user's code.
 * 2. **It regenerates and compares byte for byte.** There is no "snapshot
 *    update" mode in the check: vitest's built-in snapshot WRITES a missing
 *    fixture on the first run and passes, which is exactly the opposite of a
 *    regression check. A missing fixture is a FAILURE here.
 * 3. **sha256 provenance.** The manifest holds the fingerprint of the
 *    scenario and of every fixture, so a hand-edited fixture or a forgotten
 *    scenario change is visible, not silent.
 *
 * Usage:
 *   node scripts/sdk_visual_snapshots.mjs            # writes the fixtures
 *   node scripts/sdk_visual_snapshots.mjs --check    # gate mode: only checks
 *   node scripts/sdk_visual_snapshots.mjs --html <out># an overview page for human eyes
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { intlStable } from "../packages/core/test/intl-text.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const visualDir = join(corePackage, "test", "visual");
const fixturesDir = join(visualDir, "fixtures");
const manifestPath = join(fixturesDir, "manifest.json");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const htmlIndex = args.includes("--html") ? args[args.indexOf("--html") + 1] : undefined;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function buildCore() {
  execFileSync("npm", ["run", "--silent", "build"], { cwd: corePackage, stdio: "pipe" });
}

/** Converts the ISO strings to epoch ms, so that the scenario stays readable. */
function time(value) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Unparseable time in the scenario: ${String(value)}`);
  }
  return parsed;
}

function hydrate(scenario) {
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

/**
 * The matrix: width x orientation x theme.
 *
 * The widths come from the shared matrix.json, the orientations and themes
 * from the CORE (ORIENTATIONS, THEMES) — a local list here would allow
 * exactly what we want to avoid: the check silently skipping an orientation.
 */
function buildMatrix(core, matrix) {
  const cases = [];
  for (const width of matrix.widths) {
    const density = matrix.densityForWidth[String(width)];
    for (const orientation of core.ORIENTATIONS) {
      for (const theme of core.THEMES) {
        cases.push({
          name: `${String(width)}-${orientation}-${theme.name}`,
          width,
          height: matrix.height,
          orientation,
          density,
          theme: theme.name,
        });
      }
    }
  }
  return cases;
}

function renderCase(core, scenario, entry) {
  const result = core.renderTimeline({
    items: scenario.items,
    lanes: scenario.lanes,
    domain: scenario.domain,
    width: entry.width,
    height: entry.height,
    orientation: entry.orientation,
    density: entry.density,
    theme: entry.theme,
    // Every case gets its own scope: without it, of several fixtures put on
    // one page, the last one would decide the theme for all of them. That
    // is exactly the bug that showed up on the overview page.
    instanceId: entry.name.replace(/[^A-Za-z0-9_-]/g, "-"),
    timeZone: scenario.timeZone,
    decorations: scenario.decorations,
    selectedIds: scenario.selectedIds,
    ariaLabel: scenario.ariaLabel,
  });
  return {
    svg: `${core.renderToSvgString(result.scene, { pretty: true })}\n`,
    result,
  };
}

async function main() {
  buildCore();
  const core = await import(pathToFileURL(join(corePackage, "dist", "index.mjs")).href);
  const matrixSource = readFileSync(join(visualDir, "matrix.json"), "utf8");
  const scenarioSource = readFileSync(join(visualDir, "scenario.json"), "utf8");
  const matrix = JSON.parse(matrixSource);
  const scenario = hydrate(JSON.parse(scenarioSource));
  const cases = buildMatrix(core, matrix);

  mkdirSync(fixturesDir, { recursive: true });
  const rendered = new Map();
  const stats = [];
  for (const entry of cases) {
    const { svg, result } = renderCase(core, scenario, entry);
    rendered.set(`${entry.name}.svg`, svg);
    stats.push({
      name: entry.name,
      nodes: core.countSceneNodes(result.scene),
      items: result.visibleCount,
      rows: result.layout.rowCount,
      labelsKept: result.labels.kept.length,
      labelsDropped: result.labels.dropped.length,
      ticks: result.ticks.length,
      bytes: svg.length,
    });
  }

  const manifest = {
    note: "The visual check's provenance. The sha256 of the scenario and of the fixtures; a stale fixture or a hand edit shows up here.",
    core: core.VERSION,
    scenarioSha256: sha256(scenarioSource),
    matrixSha256: sha256(matrixSource),
    cases: stats.map((entry) => ({
      ...entry,
      sha256: sha256(rendered.get(`${entry.name}.svg`)),
    })),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

  if (htmlIndex !== undefined) {
    const sections = cases
      .map(
        (entry) =>
          `<figure><figcaption>${entry.name} · ${entry.density}</figcaption>\n${rendered
            .get(`${entry.name}.svg`)
            .replace(/<\?xml[^>]*>/, "")}</figure>`,
      )
      .join("\n");
    writeFileSync(
      htmlIndex,
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>Visual fixtures</title>` +
        `<style>body{margin:0;padding:24px;font:14px system-ui;background:#888}` +
        `figure{margin:0 0 28px;background:#fff}figcaption{font:12px ui-monospace;padding:6px 8px;background:#222;color:#fff}` +
        `svg{display:block;max-width:100%}</style>${sections}</html>\n`,
      "utf8",
    );
    console.log(`overview page: ${htmlIndex}`);
  }

  if (!checkOnly) {
    for (const [name, svg] of rendered) {
      writeFileSync(join(fixturesDir, name), svg, "utf8");
    }
    writeFileSync(manifestPath, manifestText, "utf8");
    console.log(`${String(rendered.size)} fixtures written: ${fixturesDir}`);
    for (const entry of stats) {
      console.log(
        `  ${entry.name.padEnd(22)} ${String(entry.nodes).padStart(4)} nodes, ` +
          `${String(entry.labelsKept)}/${String(entry.labelsKept + entry.labelsDropped)} labels, ` +
          `${String(entry.bytes)} bytes`,
      );
    }
    return;
  }

  // --- gate mode -----------------------------------------------------------
  const failures = [];
  const onDisk = existsSync(fixturesDir)
    ? readdirSync(fixturesDir).filter((name) => name.endsWith(".svg"))
    : [];

  if (!existsSync(manifestPath)) {
    failures.push(`no manifest (${manifestPath}) — nothing to compare against, so FAIL`);
  } else {
    const stored = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (stored.scenarioSha256 !== manifest.scenarioSha256) {
      failures.push(
        "the scenario changed, but the fixtures were not regenerated " +
          `(manifest ${String(stored.scenarioSha256).slice(0, 12)} vs now ${manifest.scenarioSha256.slice(0, 12)})`,
      );
    }
    if (stored.matrixSha256 !== manifest.matrixSha256) {
      failures.push("the matrix changed, but the fixtures were not regenerated");
    }
  }

  for (const name of onDisk) {
    if (!rendered.has(name)) {
      failures.push(`stale fixture: ${name} — no case for it in the matrix`);
    }
  }

  for (const [name, svg] of rendered) {
    const path = join(fixturesDir, name);
    if (!existsSync(path)) {
      failures.push(`missing fixture: ${name} — a missing fixture is a FAILURE, not a skip`);
      continue;
    }
    const stored = readFileSync(path, "utf8");
    // An ICU update's spacing in the accessible names' dates is no drift (intl-text.mjs).
    if (intlStable(stored) === intlStable(svg)) {
      continue;
    }
    const storedLines = stored.split("\n");
    const freshLines = svg.split("\n");
    let line = 0;
    while (line < storedLines.length && storedLines[line] === freshLines[line]) {
      line += 1;
    }
    failures.push(
      `fixture drifted: ${name} — first at line ${String(line + 1)}\n` +
        `      stored: ${String(storedLines[line] ?? "(end)").trim().slice(0, 120)}\n` +
        `      now:    ${String(freshLines[line] ?? "(end)").trim().slice(0, 120)}`,
    );
  }

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(`  ERROR ${failure}`);
    }
    console.error(`\nvisual (fixtures) FAILED: ${String(failures.length)} errors.`);
    process.exit(1);
  }

  console.log(
    `  ok   ${String(rendered.size)} fixtures match the shipped bundle's output byte for byte ` +
      `(${String(matrix.widths.length)} widths x ${String(core.ORIENTATIONS.length)} orientations x ${String(core.THEMES.length)} themes)`,
  );
  console.log(`  ok   the scenario's and the matrix's sha256 match the manifest`);
}

await main();
