#!/usr/bin/env node
/**
 * G-EXPORTS — the exports map is correct for ESM, CJS and UMD.
 *
 * This is the silent bug of most libraries: their own tests run from the
 * source, but the consumer gets the PACKAGE, and if the two drift apart,
 * only a foreign project sees it. So this check does not look at the
 * workspace, but at what would be published: `npm pack` → tarball → install
 * into an empty consumer project, and from there:
 *
 *  1. The manifest: every entry point (every exports condition, main,
 *     module, types, unpkg, typesVersions) is in the tarball, and
 *     sideEffects does not lie.
 *  2. arethetypeswrong on the tarball: node10, node16-CJS, node16-ESM,
 *     bundler — a single reported problem is a failure. (Before this check
 *     existed, both entry points of the core were "Masquerading as ESM", and
 *     /dom found no types in node10: two silent bugs that nothing else
 *     showed.)
 *  3. Runtime in Node: every subpath loads with `import()` AND `require()`,
 *     and the two export sets are identical.
 *  4. UMD: the core's two UMDs and the element's standalone UMD load in a
 *     bare vm context (no window, no document), the globally exposed names
 *     are the ESM's; the element's also gets a registry, and registers.
 *  5. A TypeScript consumer with four resolutions (node10, node16 from CJS
 *     and from ESM, bundler): the same source compiles without type errors.
 *  6. The first statement of the React bundles is "use client".
 *
 * There are six packages: the Vue adapter ships ESM and CJS, like React; the
 * Svelte and Angular adapters ship ONLY ESM (the consumer's compiler
 * processes the .svelte source and the partial Angular declarations, and
 * both ecosystems are ESM-only). For these the manifest asks for types on
 * the import/default branch, attw runs with the `esm-only` profile (node10
 * and node16-CJS are not targets), the Node probe does not load them (the
 * framework's build does, G-SSR and G-TEMPLATES), and the TypeScript consumer
 * asks for them in the two ESM resolutions.
 *  7. NEGATIVE CONTROL: the core with its earlier exports map (one types for
 *     both branches) FAILS on this same checker. If it did not fail, the
 *     checker could not tell the difference, and its pass would mean nothing.
 *
 * The check needs the network if React is not in the npm cache; if it cannot
 * install, that is a FAILURE, not a skip.
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

// --- build and pack --------------------------------------------------------
const packed = new Map();
for (const pkg of PACKAGES) {
  try {
    run("npm", ["run", "--silent", "build", "-w", pkg.name], { cwd: repo });
  } catch (error) {
    fail(`${pkg.name}: the build failed — ${String(error.stderr ?? error.message).slice(0, 400)}`);
    continue;
  }
  const [info] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packs], { cwd: join(repo, pkg.dir) }));
  packed.set(pkg.name, { ...pkg, tarball: join(packs, info.filename), files: new Set(info.files.map((file) => file.path)) });
}

// --- 1. the manifest -------------------------------------------------------
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
    if (!pkg.files.has(path)) fail(`${pkg.name}: the ${target} entry point is not in the tarball`);
  }
  for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
    if (typeof conditions === "string") continue;
    if (pkg.esmOnly) {
      // ESM only: a types at the head of the conditions, and neither require nor a CJS file.
      if (Object.keys(conditions)[0] !== "types") fail(`${pkg.name}: the first condition of ${subpath} is not types`);
      if ("require" in conditions) fail(`${pkg.name}: ${subpath} has a require branch, yet it is ESM-only`);
      if (targetsOf(conditions).some((target) => target.endsWith(".cjs"))) fail(`${pkg.name}: ${subpath} points to a CJS file, yet it is ESM-only`);
      continue;
    }
    for (const side of ["import", "require"]) {
      if (conditions[side]?.types === undefined) fail(`${pkg.name}: the ${side} branch of ${subpath} has no types of its own`);
    }
    if (conditions.require?.types !== undefined && !conditions.require.types.endsWith(".d.cts")) {
      fail(`${pkg.name}: the require types of ${subpath} are not .d.cts (${conditions.require.types}) — ESM types from CJS`);
    }
  }
  if (Array.isArray(manifest.sideEffects)) {
    for (const file of manifest.sideEffects) {
      if (!pkg.files.has(file.replace(/^\.\//, ""))) fail(`${pkg.name}: sideEffects names a file that is not shipped: ${file}`);
    }
  } else if (manifest.sideEffects !== false) {
    fail(`${pkg.name}: sideEffects is not declared`);
  }
  notes.push(`${pkg.name}: ${String(targets.length)} entry points, all in the tarball (${String(pkg.files.size)} files)`);
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
    if (found.length > 0) fail(`${pkg.name}: attw found ${String(found.length)} problems: ${found.map((each) => `${each.kind} (${each.entrypoint ?? ""} ${each.resolutionKind ?? ""})`).join("; ")}`);
    else notes.push(`${pkg.name}: attw — ${pkg.esmOnly ? "node16 ESM, bundler (esm-only profile)" : "node10, node16 CJS/ESM, bundler"}: 0 problems`);
  } catch (error) {
    fail(`${pkg.name}: attw did not run — ${String(error.message).slice(0, 300)}`);
  }
}

// --- install into a foreign project ----------------------------------------
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
      // The framework adapters: their framework for their types, and Vue for the Node probe.
      `vue@${versionOf("packages/vue", "vue")}`,
      `svelte@${versionOf("packages/svelte", "svelte")}`,
      `@angular/core@${versionOf("packages/angular", "@angular/core")}`,
      `@angular/common@${versionOf("packages/angular", "@angular/common")}`,
      `rxjs@${versionOf("packages/angular", "rxjs")}`,
    ],
    { cwd: consumer },
  );
} catch (error) {
  fail(`the tarballs cannot be installed into an empty project — ${String(error.stderr ?? error.message).slice(0, 400)}`);
}

// --- 3. ESM and CJS in Node -------------------------------------------------
// The core's subpaths come from entries.json: a new entry point is picked up
// automatically, a hand-written list would not see it.
const CORE_ENTRIES = JSON.parse(readFileSync(join(repo, "packages/core/entries.json"), "utf8")).entries;
const coreSpec = (entry) => (entry.name === "index" ? "@temporeum/timeline-core" : `@temporeum/timeline-core/${entry.name}`);
// The element's subpaths come from the package.json exports: a new plugin's
// entry point is picked up automatically, like the core's from entries.json.
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
      if (JSON.stringify(esm) !== JSON.stringify(cjs)) fail(`${spec}: ESM and CJS export different names (ESM: ${esm.length}, CJS: ${cjs.length})`);
      if (esm.length === 0 && !spec.endsWith("/define")) fail(`${spec}: empty export`);
    }
    notes.push(`Node: ${String(SUBPATHS.length)} subpaths with import() and require(), with identical export sets, without DOM globals`);
  } catch (error) {
    fail(`loading in Node failed — ${String(error.stderr ?? error.message).slice(0, 600)}`);
  }
}

// --- 4. UMD in a bare context ----------------------------------------------
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
    // The UMD of every core entry point, per entries.json.
    let coreKeys = [];
    for (const entry of CORE_ENTRIES) {
      const umd = loadUmd(installed("@temporeum/timeline-core", `dist/${entry.name}.umd.js`));
      const keys = Object.keys(umd[entry.umd] ?? {}).sort();
      if (entry.name === "index") coreKeys = keys;
      if (JSON.stringify(keys) !== JSON.stringify(esmKeys.get(coreSpec(entry)))) fail(`core ${entry.name} UMD: the names of the ${entry.umd} global are not the ESM's (${String(keys.length)})`);
    }
    // The element's UMD is standalone: the core is inside it, and it registers on load.
    const bare = loadUmd(installed("@temporeum/timeline-element", "dist/timeline-element.umd.js"));
    const elementKeys = Object.keys(bare.TemporeumTimelineElement ?? {}).sort();
    const expected = esmKeys.get("@temporeum/timeline-element");
    if (!expected.every((key) => elementKeys.includes(key))) fail("element UMD: a name of the ESM is missing from the TemporeumTimelineElement global");
    const defined = new Map();
    class FakeElement {}
    loadUmd(installed("@temporeum/timeline-element", "dist/timeline-element.umd.js"), {
      HTMLElement: FakeElement,
      customElements: { get: (name) => defined.get(name), getName: () => null, define: (name, constructor) => defined.set(name, constructor) },
    });
    if (!defined.has("temporeum-timeline")) fail("element UMD: it did not register <temporeum-timeline> on load");
    // A real import or require statement, not the examples in doc comments and not the text of an error
    // message (since the plugins were split, the element names the missing plugin's import in the TypeError).
    const external = (text) => {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
      return /\brequire\(/.test(code) || /^\s*(?:import|export)\b[^\n;]*\bfrom\s*["']@temporeum/m.test(code) || /\bimport\(\s*["']@temporeum/.test(code);
    };
    if (!external('/** a */\nimport { a } from "@temporeum/timeline-core";') || !external('var c = require("x");') || external('/**\n *     import { a } from "@temporeum/timeline-element";\n */\nthrow new TypeError(`import { x } from "@temporeum/timeline-element/x"`);')) fail("element UMD: the external-module checker gets its own control wrong");
    if (external(readFileSync(installed("@temporeum/timeline-element", "dist/timeline-element.umd.js"), "utf8"))) fail("element UMD: it refers to an external module — it is not standalone");
    notes.push(`UMD: core (${String(coreKeys.length)} names), ${CORE_ENTRIES.filter((e) => e.name !== "index").map((e) => e.name).join(", ")}, element (standalone, registers) — without window and document`);
  } catch (error) {
    fail(`loading the UMD failed — ${String(error.message).slice(0, 400)}`);
  }
}

// --- 5. TypeScript consumer with four resolutions ----------------------------
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
/** Only in the ESM resolutions (node16-esm, bundler): the two ESM-only adapters. */
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
    if (error !== undefined) fail(`TypeScript ${setup.name}: the consumer does not compile — ${error}`);
  }
  if (problems.length === 0) notes.push(`TypeScript: ${SETUPS.map((setup) => setup.name).join(", ")} — the consumer compiles without type errors (skipLibCheck: false)`);
}

// --- 6. "use client" -------------------------------------------------------
for (const file of ["dist/index.mjs", "dist/index.cjs"]) {
  const path = installed("@temporeum/timeline-react", file);
  if (!existsSync(path)) continue;
  if (!readFileSync(path, "utf8").startsWith('"use client";')) fail(`react ${file}: the first statement is not "use client"`);
}

// --- 7. negative control ---------------------------------------------------
{
  const control = join(work, "control-core");
  cpSync(join(repo, "packages/core"), control, { recursive: true, filter: (path) => !path.includes("node_modules") && !path.includes("coverage") });
  const manifest = JSON.parse(readFileSync(join(control, "package.json"), "utf8"));
  // The earlier shape: one types for both branches, without typesVersions.
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
    if (found.length === 0) fail("NEGATIVE CONTROL: attw found no problem in the earlier exports map — the checker is blind");
    else notes.push(`negative control: the earlier exports map fails with ${String(found.length)} problems (${[...new Set(found.map((each) => each.kind))].join(", ")})`);
  } catch (error) {
    fail(`NEGATIVE CONTROL: did not run — ${String(error.message).slice(0, 300)}`);
  }
}

rmSync(work, { recursive: true, force: true });

for (const note of notes) process.stdout.write(`  ok  ${note}\n`);
if (problems.length > 0) {
  process.stdout.write(`\nG-EXPORTS: ${String(problems.length)} problems\n`);
  for (const problem of problems) process.stdout.write(`  FAIL  ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`\nG-EXPORTS: the exports map is correct for ESM, CJS and UMD, in ${String(packed.size)} packages.\n`);
