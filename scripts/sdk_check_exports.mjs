#!/usr/bin/env node
/**
 * G-EXPORTS — az exports map ESM-re, CJS-re és UMD-re helyes.
 *
 * Ez a legtöbb könyvtár néma hibája: a saját tesztjei a forrásból futnak,
 * a fogyasztó viszont a CSOMAGOT kapja, és ha a kettő elválik, azt csak egy
 * idegen projekt látja. Ezért ez a check nem a workspace-t nézi, hanem azt,
 * ami kiadásra kerülne: `npm pack` → tarball → telepítés egy üres
 * fogyasztó-projektbe, és onnan:
 *
 *  1. A manifeszt: minden belépési pont (exports minden feltétele, main,
 *     module, types, unpkg, typesVersions) a tarballban van, és a
 *     sideEffects nem hazudik.
 *  2. Az arethetypeswrong a tarballon: node10, node16-CJS, node16-ESM,
 *     bundler — egyetlen jelzett probléma is bukás. (A P11 nyitásakor a mag
 *     mindkét belépési pontján „Masquerading as ESM” volt, és a /dom
 *     node10-ben nem talált típust: két néma hiba, amit semmi más nem
 *     mutatott meg.)
 *  3. Futásidő Node-ban: minden alútvonal `import()`-tal ÉS `require()`-rel
 *     betölt, és a két export-halmaz azonos.
 *  4. UMD: a mag két UMD-je és az elem önálló UMD-je egy csupasz vm-
 *     kontextusban (nincs window, nincs document) betölt, a globálisan
 *     kitett nevek az ESM-éi; az elemé egy registryt is kap, és regisztrál.
 *  5. TypeScript-fogyasztó négy feloldással (node10, node16 CJS-ből és
 *     ESM-ből, bundler): ugyanaz a forrás típushiba nélkül fordul.
 *  6. A React-bundle-ök első utasítása a "use client".
 *
 * A P23 óta hat csomag: a Vue-adapter ESM-et és CJS-t ad, mint a React; a
 * Svelte- és az Angular-adapter CSAK ESM-et (a .svelte forrást és a részleges
 * Angular-deklarációkat a fogyasztó fordítója dolgozza fel, és mindkét
 * ökoszisztéma ESM-only). Ezeknél a manifeszt az import/default ágon kér
 * types-t, az attw `esm-only` profillal fut (a node10 és a node16-CJS nem
 * cél), a Node-próba nem tölti be őket (a keretrendszer buildje teszi, G-SSR
 * és G-TEMPLATES), a TypeScript-fogyasztó pedig a két ESM-feloldásban kéri.
 *  7. NEGATÍV KONTROLL: a mag a P11 előtti exports-térképével (egy types
 *     mindkét ágra) ugyanezen a mérőn BUKIK. Ha nem bukna, a mérő nem tudna
 *     különbséget tenni, és a zöldje semmit nem jelentene.
 *
 * A check hálózatot kér, ha az npm-gyorsítótárban nincs meg a React; ha nem
 * tud telepíteni, az BUKÁS, nem kihagyás.
 */
import { execFileSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = [
  { dir: "packages/core", name: "@temporeum/timeline-core" },
  { dir: "packages/web-component", name: "@temporeum/timeline-element" },
  { dir: "packages/react", name: "@temporeum/timeline-react" },
  { dir: "packages/vue", name: "@temporeum/timeline-vue" },
  { dir: "packages/svelte", name: "@temporeum/timeline-svelte", esmOnly: true },
  { dir: "packages/angular", name: "@temporeum/timeline-angular", esmOnly: true },
];
const versionOf = (dir, dep) => createRequire(join(repo, dir, "package.json"))(`${dep}/package.json`).version;
const REACT_VERSION = createRequire(join(repo, "packages/react/package.json"))("react/package.json").version;
const problems = [];
const notes = [];
const fail = (message) => problems.push(message);

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...options });
}

const work = mkdtempSync(join(tmpdir(), "tl-exports-"));
const packs = join(work, "packs");
mkdirSync(packs);

// --- build és pack ---------------------------------------------------------
const packed = new Map();
for (const pkg of PACKAGES) {
  try {
    run("npm", ["run", "--silent", "build", "-w", pkg.name], { cwd: repo });
  } catch (error) {
    fail(`${pkg.name}: a build bukott — ${String(error.stderr ?? error.message).slice(0, 400)}`);
    continue;
  }
  const [info] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packs], { cwd: join(repo, pkg.dir) }));
  packed.set(pkg.name, { ...pkg, tarball: join(packs, info.filename), files: new Set(info.files.map((file) => file.path)) });
}

// --- 1. a manifeszt --------------------------------------------------------
function targetsOf(value, into = []) {
  if (typeof value === "string") into.push(value);
  else if (value !== null && typeof value === "object") for (const each of Object.values(value)) targetsOf(each, into);
  return into;
}
for (const pkg of packed.values()) {
  const manifest = JSON.parse(readFileSync(join(repo, pkg.dir, "package.json"), "utf8"));
  const targets = [
    ...targetsOf(manifest.exports),
    ...["main", "module", "types", "unpkg", "jsdelivr"].map((key) => manifest[key]).filter(Boolean),
    ...targetsOf(manifest.typesVersions ?? {}),
  ];
  for (const target of targets) {
    const path = target.replace(/^\.\//, "");
    if (path === "package.json") continue;
    if (!pkg.files.has(path)) fail(`${pkg.name}: a(z) ${target} belépési pont nincs a tarballban`);
  }
  for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
    if (typeof conditions === "string") continue;
    if (pkg.esmOnly) {
      // Csak ESM: egy types a feltételek élén, és se require, se CJS-fájl.
      if (Object.keys(conditions)[0] !== "types") fail(`${pkg.name}: ${subpath} első feltétele nem a types`);
      if ("require" in conditions) fail(`${pkg.name}: ${subpath} require-ágat ad, pedig ESM-only`);
      if (targetsOf(conditions).some((target) => target.endsWith(".cjs"))) fail(`${pkg.name}: ${subpath} CJS-fájlra mutat, pedig ESM-only`);
      continue;
    }
    for (const side of ["import", "require"]) {
      if (conditions[side]?.types === undefined) fail(`${pkg.name}: ${subpath} ${side} ágának nincs saját types-a`);
    }
    if (conditions.require?.types !== undefined && !conditions.require.types.endsWith(".d.cts")) {
      fail(`${pkg.name}: ${subpath} require-típusa nem .d.cts (${conditions.require.types}) — CJS-ből ESM-típus`);
    }
  }
  if (Array.isArray(manifest.sideEffects)) {
    for (const file of manifest.sideEffects) {
      if (!pkg.files.has(file.replace(/^\.\//, ""))) fail(`${pkg.name}: sideEffects egy nem szállított fájlt nevez meg: ${file}`);
    }
  } else if (manifest.sideEffects !== false) {
    fail(`${pkg.name}: a sideEffects nincs kimondva`);
  }
  notes.push(`${pkg.name}: ${String(targets.length)} belépési pont, mind a tarballban (${String(pkg.files.size)} fájl)`);
}

// --- 2. arethetypeswrong ---------------------------------------------------
const attw = join(repo, "node_modules/.bin/attw");
function attwProblems(target, pack = false, profile = undefined) {
  // Into a file, not a pipe: the attw exits with its code before a pipe
  // past 64 kB is drained, and the report arrives cut in half.
  const out = join(work, `attw-${String(Math.random()).slice(2)}.json`);
  const fd = openSync(out, "w");
  try {
    execFileSync(attw, [...(pack ? ["--pack", target] : [target]), "--format", "json", ...(profile === undefined ? [] : ["--profile", profile])], { stdio: ["ignore", fd, "pipe"] });
  } catch (error) {
    // A non-zero exit is how it reports problems; the report is still written.
    if (error.status === null) throw error;
  } finally {
    closeSync(fd);
  }
  const report = JSON.parse(readFileSync(out, "utf8"));
  const list = report.analysis?.problems ?? report.problems ?? [];
  const found = Array.isArray(list) ? list : Object.values(list).flat();
  // The JSON lists every problem whatever the profile; the profile only
  // decides the exit code. The resolutions a profile does not target are
  // left out here as the attw's own text report leaves them out.
  const ignored = PROFILE_IGNORES[profile ?? "strict"] ?? [];
  return found.filter((each) => !ignored.includes(each.resolutionKind));
}
/** The resolutions each attw profile does not target (@arethetypeswrong/cli, profiles). */
const PROFILE_IGNORES = { strict: [], node16: ["node10"], "esm-only": ["node10", "node16-cjs"] };
for (const pkg of packed.values()) {
  try {
    const found = attwProblems(pkg.tarball, false, pkg.esmOnly ? "esm-only" : undefined);
    if (found.length > 0) fail(`${pkg.name}: attw ${String(found.length)} problémát talált: ${found.map((each) => `${each.kind} (${each.entrypoint ?? ""} ${each.resolutionKind ?? ""})`).join("; ")}`);
    else notes.push(`${pkg.name}: attw — ${pkg.esmOnly ? "node16 ESM, bundler (esm-only profil)" : "node10, node16 CJS/ESM, bundler"}: 0 probléma`);
  } catch (error) {
    fail(`${pkg.name}: az attw nem futott le — ${String(error.message).slice(0, 300)}`);
  }
}

// --- telepítés egy idegen projektbe -----------------------------------------
const consumer = join(work, "consumer");
mkdirSync(consumer);
writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "tl-consumer", private: true, type: "module" }, null, 2));
try {
  run(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--prefer-offline",
      "--no-package-lock",
      ...[...packed.values()].map((pkg) => pkg.tarball),
      `react@${REACT_VERSION}`,
      `react-dom@${REACT_VERSION}`,
      "@types/react@19",
      // A P23 adapterei: a keretrendszerük a típusaikhoz, és a Vue a Node-próbához.
      `vue@${versionOf("packages/vue", "vue")}`,
      `svelte@${versionOf("packages/svelte", "svelte")}`,
      `@angular/core@${versionOf("packages/angular", "@angular/core")}`,
      `@angular/common@${versionOf("packages/angular", "@angular/common")}`,
      `rxjs@${versionOf("packages/angular", "rxjs")}`,
    ],
    { cwd: consumer },
  );
} catch (error) {
  fail(`a tarballok nem telepíthetők egy üres projektbe — ${String(error.stderr ?? error.message).slice(0, 400)}`);
}

// --- 3. ESM és CJS Node-ban --------------------------------------------------
// A mag alútvonalai az entries.json-ból jönnek (P16): egy új belépési pont
// magától bekerül, egy kézi lista nem látná.
const CORE_ENTRIES = JSON.parse(readFileSync(join(repo, "packages/core/entries.json"), "utf8")).entries;
const coreSpec = (entry) => (entry.name === "index" ? "@temporeum/timeline-core" : `@temporeum/timeline-core/${entry.name}`);
// Az elem alútvonalai a package.json exports-ából (P30): egy új plugin pontja
// magától bekerül, mint a magé az entries.json-ból.
const ELEMENT_SUBPATHS = Object.keys(JSON.parse(readFileSync(join(repo, "packages/web-component/package.json"), "utf8")).exports)
  .filter((key) => key !== "./package.json")
  .map((key) => (key === "." ? "@temporeum/timeline-element" : `@temporeum/timeline-element/${key.slice(2)}`));
const SUBPATHS = [...CORE_ENTRIES.map(coreSpec), ...ELEMENT_SUBPATHS, "@temporeum/timeline-react", "@temporeum/timeline-vue"];
const esmKeys = new Map();
if (existsSync(join(consumer, "node_modules/@temporeum/timeline-react"))) {
  const probe = join(consumer, "probe.mjs");
  writeFileSync(
    probe,
    `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const out = {};
for (const spec of ${JSON.stringify(SUBPATHS)}) {
  const esm = await import(spec);
  const cjs = require(spec);
  out[spec] = { esm: Object.keys(esm).filter((k) => k !== "default").sort(), cjs: Object.keys(cjs).filter((k) => k !== "default" && k !== "__esModule").sort() };
}
for (const name of ["window", "document", "HTMLElement", "customElements"]) if (name in globalThis) throw new Error(name + " appeared");
process.stdout.write(JSON.stringify(out));`,
  );
  try {
    const result = JSON.parse(run(process.execPath, [probe], { cwd: consumer }));
    for (const [spec, { esm, cjs }] of Object.entries(result)) {
      esmKeys.set(spec, esm);
      if (JSON.stringify(esm) !== JSON.stringify(cjs)) fail(`${spec}: az ESM és a CJS más neveket exportál (ESM: ${esm.length}, CJS: ${cjs.length})`);
      if (esm.length === 0 && !spec.endsWith("/define")) fail(`${spec}: üres export`);
    }
    notes.push(`Node: ${String(SUBPATHS.length)} alútvonal import()-tal és require()-rel, azonos export-halmazzal, DOM-globál nélkül`);
  } catch (error) {
    fail(`a Node-os betöltés bukott — ${String(error.stderr ?? error.message).slice(0, 600)}`);
  }
}

// --- 4. UMD egy csupasz kontextusban ---------------------------------------
function loadUmd(file, globals = {}) {
  const sandbox = { ...globals };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(file, "utf8"), sandbox, { filename: file });
  return sandbox;
}
const installed = (name, file) => join(consumer, "node_modules", name, file);
if (esmKeys.size > 0) {
  try {
    // A mag minden belépési pontjának UMD-je, az entries.json szerint.
    let coreKeys = [];
    for (const entry of CORE_ENTRIES) {
      const umd = loadUmd(installed("@temporeum/timeline-core", `dist/${entry.name}.umd.js`));
      const keys = Object.keys(umd[entry.umd] ?? {}).sort();
      if (entry.name === "index") coreKeys = keys;
      if (JSON.stringify(keys) !== JSON.stringify(esmKeys.get(coreSpec(entry)))) fail(`core ${entry.name} UMD: a ${entry.umd} globál nevei nem az ESM-éi (${String(keys.length)})`);
    }
    // Az elem UMD-je önálló: a mag benne van, és betöltéskor regisztrál.
    const bare = loadUmd(installed("@temporeum/timeline-element", "dist/timeline-element.umd.js"));
    const elementKeys = Object.keys(bare.TemporeumTimelineElement ?? {}).sort();
    const expected = esmKeys.get("@temporeum/timeline-element");
    if (!expected.every((key) => elementKeys.includes(key))) fail("element UMD: hiányzik az ESM egy neve a TemporeumTimelineElement globálról");
    const defined = new Map();
    class FakeElement {}
    loadUmd(installed("@temporeum/timeline-element", "dist/timeline-element.umd.js"), {
      HTMLElement: FakeElement,
      customElements: { get: (name) => defined.get(name), getName: () => null, define: (name, constructor) => defined.set(name, constructor) },
    });
    if (!defined.has("temporeum-timeline")) fail("element UMD: betöltéskor nem regisztrálta a <temporeum-timeline>-t");
    // Egy valódi import- vagy require-utasítás, nem a doc-kommentek példái és nem egy hibaüzenet szövege
    // (az elem a P29 óta a hiányzó plugin importját a TypeError-ban nevezi meg).
    const external = (text) => {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
      return /\brequire\(/.test(code) || /^\s*(?:import|export)\b[^\n;]*\bfrom\s*["']@temporeum/m.test(code) || /\bimport\(\s*["']@temporeum/.test(code);
    };
    if (!external('/** a */\nimport { a } from "@temporeum/timeline-core";') || !external('var c = require("x");') || external('/**\n *     import { a } from "@temporeum/timeline-element";\n */\nthrow new TypeError(`import { x } from "@temporeum/timeline-element/x"`);')) fail("element UMD: a külső-modul mérő a saját kontrollján hibázik");
    if (external(readFileSync(installed("@temporeum/timeline-element", "dist/timeline-element.umd.js"), "utf8"))) fail("element UMD: külső modulra hivatkozik — nem önálló");
    notes.push(`UMD: core (${String(coreKeys.length)} név), ${CORE_ENTRIES.filter((e) => e.name !== "index").map((e) => e.name).join(", ")}, element (önálló, regisztrál) — window és document nélkül`);
  } catch (error) {
    fail(`az UMD-betöltés bukott — ${String(error.message).slice(0, 400)}`);
  }
}

// --- 5. TypeScript-fogyasztó négy feloldással --------------------------------
const tsc = join(repo, "node_modules/typescript/bin/tsc");
const SOURCE = `import { renderTimeline, type Item } from "@temporeum/timeline-core";
import { mountScene, type SceneMount } from "@temporeum/timeline-core/dom";
import { createTimeline, renderTimelineHtml, type Timeline } from "@temporeum/timeline-element";
import { Timeline as TimelineComponent, useTimelineState, type TimelineProps } from "@temporeum/timeline-react";
const items: Item[] = [{ id: "a", start: 0, end: 1 }];
export const html: string = renderTimelineHtml({ items });
export const frame = renderTimeline({ items, domain: [0, 10], width: 100, height: 50 });
export type Mounted = SceneMount;
export const make: (element: HTMLElement) => Timeline = (element) => createTimeline(element, { items });
export const props: TimelineProps = { items, onItemMoved: (payload) => void payload.command.inverse };
export const component = TimelineComponent;
export const hook = useTimelineState;
export const unused = mountScene;
import { Timeline as VueTimeline, useTimelineState as useVueState } from "@temporeum/timeline-vue";
export const vue = [VueTimeline, useVueState] as const;
`;
/** Csak az ESM-feloldásokban (node16-esm, bundler): a két ESM-only adapter. */
const ESM_ONLY_SOURCE = `import { Timeline as SvelteTimeline, timelineState, type Readable } from "@temporeum/timeline-svelte";
import { TimelineComponent as AngularTimeline, timelineState as timelineSignal } from "@temporeum/timeline-angular";
export const svelte: [typeof SvelteTimeline, typeof timelineState] = [SvelteTimeline, timelineState];
export type Store = Readable<readonly string[] | undefined>;
export const angular = [AngularTimeline, timelineSignal] as const;
`;
const SETUPS = [
  { name: "node10", type: "commonjs", ext: "ts", options: { module: "commonjs", moduleResolution: "node10", ignoreDeprecations: "6.0" } },
  { name: "node16-cjs", type: "commonjs", ext: "cts", options: { module: "node16", moduleResolution: "node16" } },
  { name: "node16-esm", type: "module", ext: "mts", options: { module: "node16", moduleResolution: "node16" } },
  { name: "bundler", type: "module", ext: "ts", options: { module: "esnext", moduleResolution: "bundler" } },
];
function typecheck(root, setup) {
  const dir = join(root, `ts-${setup.name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: setup.type }));
  const esm = setup.name === "node16-esm" || setup.name === "bundler";
  writeFileSync(join(dir, `consumer.${setup.ext}`), esm ? SOURCE + ESM_ONLY_SOURCE : SOURCE);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { ...setup.options, target: "es2022", lib: ["es2022", "dom"], strict: true, noEmit: true, skipLibCheck: false, types: [] }, files: [`consumer.${setup.ext}`] }),
  );
  try {
    run(process.execPath, [tsc, "-p", join(dir, "tsconfig.json")], { cwd: dir });
    return undefined;
  } catch (error) {
    return String(error.stdout || error.stderr || error.message).split("\n").filter(Boolean).slice(0, 4).join(" | ");
  }
}
if (esmKeys.size > 0) {
  for (const setup of SETUPS) {
    const error = typecheck(consumer, setup);
    if (error !== undefined) fail(`TypeScript ${setup.name}: a fogyasztó nem fordul — ${error}`);
  }
  if (problems.length === 0) notes.push(`TypeScript: ${SETUPS.map((setup) => setup.name).join(", ")} — a fogyasztó típushiba nélkül fordul (skipLibCheck: false)`);
}

// --- 6. "use client" -------------------------------------------------------
for (const file of ["dist/index.mjs", "dist/index.cjs"]) {
  const path = installed("@temporeum/timeline-react", file);
  if (!existsSync(path)) continue;
  if (!readFileSync(path, "utf8").startsWith('"use client";')) fail(`react ${file}: az első utasítás nem a "use client"`);
}

// --- 7. negatív kontroll ---------------------------------------------------
{
  const control = join(work, "control-core");
  cpSync(join(repo, "packages/core"), control, { recursive: true, filter: (path) => !path.includes("node_modules") && !path.includes("coverage") });
  const manifest = JSON.parse(readFileSync(join(control, "package.json"), "utf8"));
  // A P11 előtti alak: egy types mindkét ágra, typesVersions nélkül.
  manifest.types = "./dist/index.d.ts";
  manifest.exports = {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs", require: "./dist/index.cjs", default: "./dist/index.mjs" },
    "./dom": { types: "./dist/dom/index.d.ts", import: "./dist/dom.mjs", require: "./dist/dom.cjs", default: "./dist/dom.mjs" },
    "./package.json": "./package.json",
  };
  delete manifest.typesVersions;
  delete manifest.scripts.prepack;
  writeFileSync(join(control, "package.json"), JSON.stringify(manifest, null, 2));
  try {
    const found = attwProblems(control, true);
    if (found.length === 0) fail("NEGATÍV KONTROLL: a P11 előtti exports-térképen az attw nem talált hibát — a mérő vak");
    else notes.push(`negatív kontroll: a P11 előtti exports-térkép ${String(found.length)} problémával bukik (${[...new Set(found.map((each) => each.kind))].join(", ")})`);
  } catch (error) {
    fail(`NEGATÍV KONTROLL: nem futott le — ${String(error.message).slice(0, 300)}`);
  }
}

rmSync(work, { recursive: true, force: true });

for (const note of notes) process.stdout.write(`  ok  ${note}\n`);
if (problems.length > 0) {
  process.stdout.write(`\nG-EXPORTS: ${String(problems.length)} probléma\n`);
  for (const problem of problems) process.stdout.write(`  BUKÁS  ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`\nG-EXPORTS: az exports map ESM-re, CJS-re és UMD-re helyes, ${String(packed.size)} csomagban.\n`);
