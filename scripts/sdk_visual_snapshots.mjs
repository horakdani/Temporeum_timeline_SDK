#!/usr/bin/env node
/**
 * A G-VISUAL kapu első fele: visual regression a SHIPPELT bundle-ön.
 *
 * Mit bizonyít: a renderelő ugyanazt a frame-et adja 3 szélességen x 2
 * orientáción x 2 témán, mint amit a repóban eltárolt fixture-ök mondanak.
 *
 * Három döntés van benne, és mindhárom egy-egy hamis zöld ellen:
 *
 * 1. **A FORDÍTOTT csomagot méri, nem a forrást.** Előbb épít, aztán a
 *    `dist/index.mjs`-t importálja. Ez a P2 méret-kapujának a tanulsága: egy
 *    check, ami a forráson zöld, nem a felhasználó kódjáról állít semmit.
 * 2. **Újragenerál és bájtra összehasonlít.** Nincs "snapshot update" mód a
 *    kapuban: a vitest beépített snapshotja az első futáson MEGÍRJA a
 *    hiányzó fixture-t és zöldet ad, ami pont az ellenkezője egy
 *    regressziós kapunak. Hiányzó fixture itt BUKÁS.
 * 3. **sha256 provenancia.** A manifest a scenario és minden fixture
 *    lenyomatát tartalmazza, tehát egy kézzel szerkesztett fixture vagy egy
 *    elfelejtett scenario-változás látható, nem csendes.
 *
 * Használat:
 *   node scripts/sdk_visual_snapshots.mjs            # megírja a fixture-öket
 *   node scripts/sdk_visual_snapshots.mjs --check    # kapu-mód: csak ellenőriz
 *   node scripts/sdk_visual_snapshots.mjs --html <ki># áttekintő lap emberi szemnek
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/** Az ISO-sztringeket epoch ms-re fordítja, hogy a scenario olvasható maradjon. */
function time(value) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Értelmezhetetlen időpont a scenarióban: ${String(value)}`);
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
 * A mátrix: szélesség x orientáció x téma.
 *
 * A szélességek a megosztott matrix.json-ból, az orientációk és a témák a
 * MAGBÓL (ORIENTATIONS, THEMES) — egy helyi lista itt pont azt engedné meg,
 * hogy a kapu egy orientációt csendben kihagyjon.
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
    // Minden esetnek sajat scope: enelkul egy lapra tett tobb fixture
    // kozul az utolso dontene el a temat mindegyiknek. Pont ez a hiba
    // bukott ki az attekinto lapon.
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
    note: "A G-VISUAL provenanciája. A scenario és a fixture-ök sha256-ja; elavult fixture vagy kézi szerkesztés itt látszik.",
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
      `<!doctype html><html lang="hu"><meta charset="utf-8"><title>G-VISUAL fixture-ök</title>` +
        `<style>body{margin:0;padding:24px;font:14px system-ui;background:#888}` +
        `figure{margin:0 0 28px;background:#fff}figcaption{font:12px ui-monospace;padding:6px 8px;background:#222;color:#fff}` +
        `svg{display:block;max-width:100%}</style>${sections}</html>\n`,
      "utf8",
    );
    console.log(`áttekintő lap: ${htmlIndex}`);
  }

  if (!checkOnly) {
    for (const [name, svg] of rendered) {
      writeFileSync(join(fixturesDir, name), svg, "utf8");
    }
    writeFileSync(manifestPath, manifestText, "utf8");
    console.log(`${String(rendered.size)} fixture megírva: ${fixturesDir}`);
    for (const entry of stats) {
      console.log(
        `  ${entry.name.padEnd(22)} ${String(entry.nodes).padStart(4)} csomópont, ` +
          `${String(entry.labelsKept)}/${String(entry.labelsKept + entry.labelsDropped)} címke, ` +
          `${String(entry.bytes)} bájt`,
      );
    }
    return;
  }

  // --- kapu-mód ------------------------------------------------------------
  const failures = [];
  const onDisk = existsSync(fixturesDir)
    ? readdirSync(fixturesDir).filter((name) => name.endsWith(".svg"))
    : [];

  if (!existsSync(manifestPath)) {
    failures.push(`nincs manifest (${manifestPath}) — nincs mihez hasonlítani, tehát BUKÁS`);
  } else {
    const stored = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (stored.scenarioSha256 !== manifest.scenarioSha256) {
      failures.push(
        "a scenario megváltozott, de a fixture-ök nem lettek újragenerálva " +
          `(manifest ${String(stored.scenarioSha256).slice(0, 12)} vs most ${manifest.scenarioSha256.slice(0, 12)})`,
      );
    }
    if (stored.matrixSha256 !== manifest.matrixSha256) {
      failures.push("a mátrix megváltozott, de a fixture-ök nem lettek újragenerálva");
    }
  }

  for (const name of onDisk) {
    if (!rendered.has(name)) {
      failures.push(`elavult fixture: ${name} — nincs hozzá eset a mátrixban`);
    }
  }

  for (const [name, svg] of rendered) {
    const path = join(fixturesDir, name);
    if (!existsSync(path)) {
      failures.push(`hiányzó fixture: ${name} — hiányzó fixture BUKÁS, nem kihagyás`);
      continue;
    }
    const stored = readFileSync(path, "utf8");
    if (stored === svg) {
      continue;
    }
    const storedLines = stored.split("\n");
    const freshLines = svg.split("\n");
    let line = 0;
    while (line < storedLines.length && storedLines[line] === freshLines[line]) {
      line += 1;
    }
    failures.push(
      `elcsúszott fixture: ${name} — először a ${String(line + 1)}. sorban\n` +
        `      tárolt: ${String(storedLines[line] ?? "(vége)").trim().slice(0, 120)}\n` +
        `      mostani: ${String(freshLines[line] ?? "(vége)").trim().slice(0, 120)}`,
    );
  }

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(`  HIBA ${failure}`);
    }
    console.error(`\nG-VISUAL (fixture) BUKOTT: ${String(failures.length)} hiba.`);
    process.exit(1);
  }

  console.log(
    `  ok   ${String(rendered.size)} fixture bájtra egyezik a shippelt bundle kimenetével ` +
      `(${String(matrix.widths.length)} szélesség x ${String(core.ORIENTATIONS.length)} orientáció x ${String(core.THEMES.length)} téma)`,
  );
  console.log(`  ok   a scenario és a mátrix sha256-ja egyezik a manifesttel`);
}

await main();
