#!/usr/bin/env node
/**
 * A G-RTL vizualis fele: a vizualis matrix jobbrol balra, a SHIPPELT bundle-on.
 *
 * Ugyanaz a matrix, mint a G-VISUAL-e (a matrix.json szelessegei, a mag
 * ORIENTATIONS-e es THEMES-e), ugyanaz a scenario — es minden eset a
 * `mirrorScene`-en at (/intl), a dist-bol. Kulon konyvtarban
 * (test/rtl/fixtures/), mert a G-VISUAL a sajat konyvtaraban minden
 * esetlen fajlt elavultnak vesz.
 *
 * Ugyanaz a harom dontes, mint a sdk_visual_snapshots.mjs-ben: a forditott
 * csomagot meri, ujragenerál es bajtra hasonlit (hianyzo fixture BUKAS), es
 * sha256-provenanciat tart.
 *
 * Hasznalat:
 *   node scripts/sdk_rtl_snapshots.mjs            # megirja a fixture-oket
 *   node scripts/sdk_rtl_snapshots.mjs --check    # kapu-mod: csak ellenoriz
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
  if (Number.isNaN(parsed)) throw new Error(`Ertelmezhetetlen idopont a scenarioban: ${String(value)}`);
  return parsed;
};

/** A scenario, ahogy a G-VISUAL is olvassa: ISO-sztringek epoch ms-re. */
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

/** A matrix RTL-esetei: szelesseg x orientacio x tema, a nev `-rtl` vegu. */
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

/** Egy eset: a G-VISUAL-e ugyanugy rajzolva, majd tukrozve. */
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
    note: "A G-RTL vizualis provenanciaja: a G-VISUAL matrixa tukrozve. A scenario, a matrix es minden fixture sha256-ja.",
    core: core.VERSION,
    scenarioSha256: sha256(scenarioSource),
    matrixSha256: sha256(matrixSource),
    cases: cases.map((entry) => ({ name: entry.name, sha256: sha256(rendered.get(`${entry.name}.svg`)) })),
  };

  if (!checkOnly) {
    mkdirSync(fixturesDir, { recursive: true });
    for (const [name, svg] of rendered) writeFileSync(join(fixturesDir, name), svg, "utf8");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`${String(rendered.size)} RTL-fixture megirva: ${fixturesDir}`);
    return;
  }

  const failures = [];
  if (!existsSync(manifestPath)) {
    failures.push(`nincs manifest (${manifestPath}) — nincs mihez hasonlitani, tehat BUKAS`);
  } else {
    const stored = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (stored.scenarioSha256 !== manifest.scenarioSha256) failures.push("a scenario megvaltozott, de az RTL-fixture-ok nem lettek ujrageneralva");
    if (stored.matrixSha256 !== manifest.matrixSha256) failures.push("a matrix megvaltozott, de az RTL-fixture-ok nem lettek ujrageneralva");
  }
  const onDisk = existsSync(fixturesDir) ? readdirSync(fixturesDir).filter((name) => name.endsWith(".svg")) : [];
  for (const name of onDisk) if (!rendered.has(name)) failures.push(`elavult RTL-fixture: ${name} — nincs hozza eset`);
  for (const [name, svg] of rendered) {
    const path = join(fixturesDir, name);
    if (!existsSync(path)) failures.push(`hianyzo RTL-fixture: ${name} — hianyzo fixture BUKAS, nem kihagyas`);
    else if (readFileSync(path, "utf8") !== svg) failures.push(`elcsuszott RTL-fixture: ${name}`);
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  HIBA ${failure}`);
    console.error(`\nG-RTL (fixture-ok) BUKOTT: ${String(failures.length)} hiba.`);
    process.exit(1);
  }
  console.log(`G-RTL fixture-ok: mind a ${String(rendered.size)} RTL-eset bajtra egyezik.`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
