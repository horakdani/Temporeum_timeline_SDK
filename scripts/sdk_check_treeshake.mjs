#!/usr/bin/env node
/**
 * The treeshake check — a consumer gets only what it imports.
 *
 * Every capability of the core lives in one package, split into entry
 * points. That only keeps the base lean if the structure of the published
 * ESM and CJS can do three things — this script proves them on the built
 * dist:
 *
 *  1. NO DUPLICATION: every source module (src/**) appears in exactly ONE
 *     published ESM file and one CJS file (according to the source maps'
 *     `sources` field). A consumer of two entry points together thus gets the
 *     shared code once. Before the code-splitting build, both /dom and the
 *     index shipped the code of formatNumber and placePopover.
 *  2. ISOLATION: the bundle of an entry point's consumer (rolldown,
 *     `import *`) contains nothing from the own code (src/<name>/) of ANOTHER
 *     non-base entry point.
 *  3. TREE-SHAKING: importing a single function from the base (`toTimeMs`)
 *     is a fraction of the whole base (`import *`) — at most 10% of it,
 *     minify + gzip 9. The package is `"sideEffects": false`; if a module
 *     loaded with a side effect, or the splitting pulled everything in, this
 *     ratio would shoot up.
 *
 * NEGATIVE CONTROLS — both must fail, otherwise the probe is blind:
 *  - the REAL package source without splitting (createConfig({ split: false }),
 *    a standalone ESM/CJS per entry point — the structure before splitting),
 *    built into a temporary directory: check 1 must find duplication;
 *  - the same function from the unsplittable UMD (from a copy outside the
 *    package): the ratio must go above the threshold.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import { rollup } from "rollup";
import { createConfig } from "../packages/core/scripts/build-config.mjs";
import { CORE_DIR, readEntries } from "./sdk_entries.mjs";

const SHAKE_MAX_RATIO = 0.1;
const PROBE_EXPORT = "toTimeMs";
const entries = readEntries();
const failures = [];
const ok = (message) => console.log(`  ok   ${message}`);

/** Every ESM or CJS file in dist, recursively (the chunks too). */
function codeFiles(dist, ext) {
  return readdirSync(dist, { withFileTypes: true }).flatMap((dirent) => {
    const path = join(dist, dirent.name);
    if (dirent.isDirectory()) return codeFiles(path, ext);
    return dirent.name.endsWith(`.${ext}`) ? [path] : [];
  });
}

/** The source modules of a published file, relative to the package root (src/...). */
function sourcesOf(file, coreDir) {
  const mapFile = `${file}.map`;
  if (!existsSync(mapFile)) throw new Error(`no source map: ${relative(coreDir, mapFile)}`);
  const map = JSON.parse(readFileSync(mapFile, "utf8"));
  return map.sources.map((source) => relative(coreDir, resolve(dirname(file), source)).replaceAll("\\", "/"));
}

/** 1. Is every source module in exactly one file? Returns the duplicates. */
function duplicates(coreDir) {
  const found = [];
  for (const ext of ["mjs", "cjs"]) {
    const home = new Map();
    for (const file of codeFiles(join(coreDir, "dist"), ext)) {
      for (const source of sourcesOf(file, coreDir)) {
        const where = relative(coreDir, file);
        if (home.has(source)) found.push(`${source} in two ${ext} files: ${home.get(source)} and ${where}`);
        else home.set(source, where);
      }
    }
    if (home.size === 0) found.push(`no ${ext} file's source map names a source module — the measurement did not run`);
  }
  return found;
}

/** A consumer bundle from the given source code, resolved to the dist files. */
async function consumer(coreDir, source, { minify = false } = {}) {
  const id = "\0sdk-treeshake-consumer";
  const bundle = await rolldown({
    input: id,
    logLevel: "silent",
    plugins: [
      {
        name: "sdk-treeshake-consumer",
        resolveId: (spec) => (spec === id ? id : null),
        load: (spec) => (spec === id ? source : null),
      },
    ],
  });
  const { output } = await bundle.generate({ format: "es", minify });
  await bundle.close();
  const [chunk] = output;
  // Only our own published files: the consumer module and the bundler's own
  // runtime (rolldown/runtime) are not part of the package.
  const dist = join(coreDir, "dist");
  return { code: chunk.code, files: chunk.moduleIds.filter((m) => m.startsWith(dist)) };
}

const distFile = (coreDir, name) => join(coreDir, "dist", `${name}.mjs`);

// --- 1. No duplication ---------------------------------------------------
const dup = duplicates(CORE_DIR);
if (dup.length > 0) failures.push(...dup.map((d) => `duplication: ${d}`));
else ok("every source module is in exactly one ESM file and one CJS file (according to the source maps)");

// --- 2. Isolation --------------------------------------------------------
const ownDir = (entry) => entry.input.replace(/index\.ts$/, "");
for (const entry of entries) {
  const { files } = await consumer(CORE_DIR, `import * as m from ${JSON.stringify(distFile(CORE_DIR, entry.name))}; globalThis.m = m;`);
  const sources = new Set(files.flatMap((file) => sourcesOf(file, CORE_DIR)));
  for (const other of entries.filter((e) => e !== entry && e.name !== "index")) {
    const leaked = [...sources].filter((source) => source.startsWith(ownDir(other)));
    if (leaked.length > 0) failures.push(`isolation: the consumer of ${entry.name} also gets the own code of ${other.name}: ${leaked.join(", ")}`);
  }
  ok(`${entry.name}: the consumer's bundle contains ${String(sources.size)} source modules, and no other entry point's own code`);
}

// --- 3. Tree-shaking ------------------------------------------------------
const size = (code) => gzipSync(code, { level: 9 }).length;
const baseFile = JSON.stringify(distFile(CORE_DIR, "index"));
const full = size((await consumer(CORE_DIR, `import * as m from ${baseFile}; globalThis.m = m;`, { minify: true })).code);
const shakeSource = `import { ${PROBE_EXPORT} } from ${baseFile}; globalThis.m = ${PROBE_EXPORT};`;
const one = size((await consumer(CORE_DIR, shakeSource, { minify: true })).code);
const ratio = one / full;
if (ratio > SHAKE_MAX_RATIO) failures.push(`tree-shaking: ${PROBE_EXPORT} on its own is ${String(one)} B, ${(ratio * 100).toFixed(1)}% of the whole base's ${String(full)} B (threshold ${String(SHAKE_MAX_RATIO * 100)}%)`);
else ok(`tree-shaking: ${PROBE_EXPORT} on its own is ${String(one)} B — ${(ratio * 100).toFixed(1)}% of the whole base (${String(full)} B)`);

// --- Negative control: the same function from an unsplittable bundle -----
// `treeshake: false` is not a control: the minifier drops unexported, unused
// functions on its own (it came out at 0.8% when tried).
// The UMD is a single closed function with a side effect — a consumer that
// takes the same function from there gets everything. If the probe did not
// see this above the threshold, the pass of check 3 would mean nothing. The
// UMD copy sits OUTSIDE the package: the package's `"sideEffects": false`
// applies to every file in dist, and inside the package the bundler drops
// the UMD's side-effect import entirely (it came out at 0.2% that way — the
// signal works, but then the control does not measure unsplittability).
const umdDir = mkdtempSync(join(tmpdir(), "sdk-treeshake-umd-"));
let unshaken;
try {
  const umdCopy = join(umdDir, "index.umd.js");
  writeFileSync(umdCopy, readFileSync(join(CORE_DIR, "dist", "index.umd.js")));
  const umdSource = `import ${JSON.stringify(umdCopy)}; globalThis.m = globalThis.TemporeumTimeline.${PROBE_EXPORT};`;
  unshaken = size((await consumer(umdDir, umdSource, { minify: true })).code);
} finally {
  rmSync(umdDir, { recursive: true, force: true });
}
if (unshaken / full <= SHAKE_MAX_RATIO) failures.push(`NEGATIVE CONTROL did not fail: ${PROBE_EXPORT} from the UMD is also only ${(unshaken / full * 100).toFixed(1)}% — the probe cannot tell the difference`);
else ok(`control fails: ${PROBE_EXPORT} from the UMD is ${String(unshaken)} B, ${(unshaken / full * 100).toFixed(0)}% of the whole base`);

// --- Negative control: the real source duplicates without splitting -----
const work = mkdtempSync(join(tmpdir(), "sdk-treeshake-"));
const cwd = process.cwd();
try {
  process.chdir(work);
  const configs = createConfig({
    entries: entries.map((entry) => ({ ...entry, input: join(CORE_DIR, entry.input) })),
    banner: "/* control */",
    tsconfig: join(CORE_DIR, "tsconfig.build.json"),
    split: false,
  });
  // Only the ESM/CJS builds; the UMD is irrelevant to this measurement.
  for (const config of configs.filter((c) => Array.isArray(c.output))) {
    const bundle = await rollup({ ...config, onwarn: () => {} });
    for (const output of config.output) await bundle.write({ ...output, dir: join(work, "dist") });
    await bundle.close();
  }
  process.chdir(cwd);
  // The source maps point to the real src; the path relative to CORE_DIR
  // has to be aligned to the real package instead of work/dist.
  const found = [];
  for (const ext of ["mjs", "cjs"]) {
    const home = new Map();
    for (const file of codeFiles(join(work, "dist"), ext)) {
      const map = JSON.parse(readFileSync(`${file}.map`, "utf8"));
      for (const source of map.sources.map((s) => relative(CORE_DIR, resolve(dirname(file), s)))) {
        if (home.has(source)) found.push(source);
        else home.set(source, file);
      }
    }
  }
  if (found.length === 0) failures.push("NEGATIVE CONTROL did not fail: the build without splitting does not duplicate either — the probe cannot tell the difference");
  else ok(`control fails: without splitting the real source duplicates ${String(found.length)} source modules (e.g. ${found[0]})`);
} catch (error) {
  process.chdir(cwd);
  failures.push(`NEGATIVE CONTROL did not run: ${String(error.message).split("\n")[0]} — a control that did not run is a failure, not a skip`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  console.error(`\ntreeshake FAILED: ${String(failures.length)} problem(s).`);
  process.exit(1);
}
console.log(`\ntreeshake passed: ${String(entries.length)} entry points, no duplication, isolation and tree-shaking proven, 2 negative controls fail.`);
