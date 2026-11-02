#!/usr/bin/env node
/**
 * G-PACK: `npm publish --dry-run` of the packages to be released passes, and
 * what the registry would receive is exactly what it should be.
 *
 * Per package (core, element, react, vue, svelte, angular — the docs package
 * is private and is not published):
 *
 *  1. `npm publish --dry-run --json` from the package directory, with the
 *     built dist. Provenance cannot be produced locally (only in CI, with an
 *     OIDC token), so the dry run runs with `--provenance=false`, and point 4
 *     checks the provenance setting.
 *  2. The tarball carries only what `files` lists: every file is under an
 *     entry of `files`, or is one of those npm always includes
 *     (package.json, README, LICENSE, CHANGELOG). No source, test, map with
 *     a path pointing to the source, .env or dotfile.
 *  3. The version is IDENTICAL in every package, and not a prerelease (no
 *     `-`). The packages point to each other with exactly this version (not
 *     a range and not workspace:), and the VERSION constant is this too.
 *  4. The manifest is ready for release: MIT licence and a LICENSE in the
 *     tarball; repository/homepage/bugs as in packages/docs/site/project.json,
 *     repository.directory the package's own directory; publishConfig.access
 *     "public" and publishConfig.provenance true; the release workflow
 *     (.github/workflows/release.yml in the standalone repo, under
 *     sdk/standalone/ here) publishes with the `id-token: write`
 *     permission and with `--provenance`.
 *  5. NEGATIVE CONTROL: a copy of a manifest with a prerelease version, and
 *     a `files` that also packs a source file, FAIL with the same measure.
 *
 * In preparation for release, also:
 *
 *  6. Every exports branch has a file behind it in the tarball, and every JS
 *     branch has types behind it: `types` in the condition object, which is
 *     also in the tarball. The README is in the tarball too.
 *  7. The release workflow publishes ALL SIX packages (an earlier workflow
 *     would have published only three, leaving out the framework adapters),
 *     the core first, the element before the adapters.
 *  8. Clean directory: the six `npm pack` tarballs installed into an empty
 *     project (next to React and Vue, without the other peers) load EVERY
 *     subpath of the core, the element, and the React and Vue adapters with
 *     `import()` and, where there is a require branch, with `require()`, and
 *     the two export sets are identical (an entry point named in
 *     `sideEffects`, e.g. the element's `/define`, may export nothing, but
 *     must load without errors). The Svelte and Angular adapters are
 *     ESM-only, and their source is processed by the framework's compiler:
 *     for them the probe is the resolution (`import.meta.resolve`) and the
 *     file existing, while loading is up to G-SSR and G-TEMPLATES.
 *  9. NEGATIVE CONTROL for 6-7: an exports branch pointing to a file that
 *     does not exist, a branch without types, and a workflow that leaves out
 *     a package FAIL.
 *
 * A dry run that cannot run is a FAILURE, not a skip.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = JSON.parse(readFileSync(join(repo, "packages", "docs", "site", "project.json"), "utf8"));
const PACKAGES = [
  { dir: "core", name: "@temporeum/timeline-core" },
  { dir: "web-component", name: "@temporeum/timeline-element" },
  { dir: "react", name: "@temporeum/timeline-react" },
  // The three framework adapters.
  { dir: "vue", name: "@temporeum/timeline-vue" },
  { dir: "svelte", name: "@temporeum/timeline-svelte", esmOnly: true },
  { dir: "angular", name: "@temporeum/timeline-angular", esmOnly: true },
];
const ALWAYS = /^(package\.json|README(\.md)?|LICEN[CS]E(\.md)?|CHANGELOG(\.md)?)$/i;
const FORBIDDEN = /(^|\/)(src|test|tests|e2e|scripts|node_modules)\/|\.test\.|\.spec\.|(^|\/)\.[^/]+$|\.env/;

const failures = [];
const notes = [];
const manifestOf = (dir) => JSON.parse(readFileSync(join(repo, "packages", dir, "package.json"), "utf8"));

/** The dry-run tarball's files, or an error. */
function dryRun(cwd) {
  const out = execFileSync("npm", ["publish", "--dry-run", "--json", "--provenance=false", "--ignore-scripts"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, npm_config_provenance: "false" },
  });
  const report = JSON.parse(out.slice(out.indexOf("{")));
  const entry = report.files === undefined ? Object.values(report)[0] : report;
  return { files: entry.files.map((file) => file.path), version: entry.version, name: entry.name };
}

/** The tarball's files against `files`. Returns the problems. */
function judgeFiles(files, allowed) {
  const problems = [];
  for (const path of files) {
    if (ALWAYS.test(path)) continue;
    if (FORBIDDEN.test(path)) problems.push(`forbidden file in the tarball: ${path}`);
    else if (!allowed.some((entry) => path === entry || path.startsWith(`${entry.replace(/\/$/, "")}/`))) problems.push(`file outside files: ${path}`);
  }
  return problems;
}

/** The versions and the cross-references. Returns the problems. */
function judgeVersions(manifests) {
  const problems = [];
  const versions = new Set(manifests.map((m) => m.version));
  if (versions.size !== 1) problems.push(`the versions do not match: ${[...versions].join(", ")}`);
  const [version] = versions;
  if (typeof version !== "string" || version.includes("-") || !/^\d+\.\d+\.\d+$/.test(version)) problems.push(`the version is a prerelease or invalid: ${String(version)}`);
  const names = new Set(manifests.map((m) => m.name));
  for (const manifest of manifests) {
    for (const [dep, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (names.has(dep) && range !== version) problems.push(`${manifest.name} -> ${dep}: "${String(range)}", the released version ("${String(version)}") is required`);
    }
  }
  return problems;
}

function judgeManifest(manifest, dir) {
  const problems = [];
  if (manifest.license !== "MIT") problems.push(`${manifest.name}: the licence is ${String(manifest.license)}, MIT is required`);
  if (manifest.private === true) problems.push(`${manifest.name}: private`);
  const url = manifest.repository?.url ?? "";
  if (url.replace(/^git\+/, "").replace(/\.git$/, "") !== project.repository) problems.push(`${manifest.name}: repository.url ${url}, project.json says ${project.repository}`);
  if (manifest.repository?.directory !== `packages/${dir}`) problems.push(`${manifest.name}: repository.directory ${String(manifest.repository?.directory)}`);
  if (manifest.homepage !== project.homepage) problems.push(`${manifest.name}: homepage ${String(manifest.homepage)}, project.json says ${project.homepage}`);
  if (manifest.bugs?.url !== `${project.repository}/issues`) problems.push(`${manifest.name}: bugs.url ${String(manifest.bugs?.url)}`);
  if (manifest.publishConfig?.access !== "public") problems.push(`${manifest.name}: publishConfig.access is not "public"`);
  if (manifest.publishConfig?.provenance !== true) problems.push(`${manifest.name}: publishConfig.provenance is not true`);
  if (!existsSync(join(repo, "packages", dir, "LICENSE"))) problems.push(`${manifest.name}: no LICENSE in the package directory`);
  return problems;
}

/** A file behind every exports branch, and types behind every JS branch — against the tarball's files. */
export function judgeExports(manifest, files) {
  const problems = [];
  const has = (target) => files.includes(String(target).replace(/^\.\//, ""));
  const walk = (subpath, node, trail) => {
    if (typeof node === "string") {
      if (!has(node)) problems.push(`${manifest.name}: ${subpath} ${trail.join(".") || "(branch)"} -> ${node}: not in the tarball`);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const leaves = Object.entries(node).filter(([, value]) => typeof value === "string");
    const js = leaves.some(([condition, target]) => condition !== "types" && /\.(m|c)?js$/.test(target));
    if (js && node.types === undefined) problems.push(`${manifest.name}: ${subpath} ${trail.join(".") || "(branch)"}: JS branch without types`);
    for (const [condition, value] of Object.entries(node)) walk(subpath, value, [...trail, condition]);
  };
  for (const [subpath, branch] of Object.entries(manifest.exports ?? {})) {
    if (subpath === "./package.json") continue;
    walk(subpath, branch, []);
  }
  for (const key of ["main", "module", "types"]) if (manifest[key] !== undefined && !has(manifest[key])) problems.push(`${manifest.name}: ${key} -> ${manifest[key]}: not in the tarball`);
  if (!files.some((path) => /^README(\.md)?$/i.test(path))) problems.push(`${manifest.name}: no README in the tarball`);
  return problems;
}

/** The release workflow's publish step: all six, the core first, the element before the adapters. */
export function judgeWorkflowPackages(text) {
  const problems = [];
  const order = [...text.matchAll(/packages\/(core|web-component|react|vue|svelte|angular)\b/g)].map((m) => m[1]);
  const publishLine = text.split("\n").find((line) => /for pkg in /.test(line)) ?? "";
  const published = [...publishLine.matchAll(/packages\/([a-z-]+)/g)].map((m) => m[1]);
  for (const pkg of PACKAGES) if (!published.includes(pkg.dir)) problems.push(`the release workflow does not publish: ${pkg.name}`);
  if (published[0] !== "core") problems.push(`the release workflow does not start with the core (${published.join(", ") || "no publish loop"})`);
  const element = published.indexOf("web-component");
  for (const adapter of ["react", "vue", "svelte", "angular"]) if (published.includes(adapter) && published.indexOf(adapter) < element) problems.push(`the release workflow publishes ${adapter} before the element`);
  return order.length === 0 ? ["the release workflow names no package"] : problems;
}

// --- 1-4: the real packages ---------------------------------------------------
const manifests = PACKAGES.map((pkg) => manifestOf(pkg.dir));
for (const [index, pkg] of PACKAGES.entries()) {
  const manifest = manifests[index];
  if (manifest.name !== pkg.name) failures.push(`packages/${pkg.dir}: the name is ${manifest.name}, not ${pkg.name}`);
  if (!existsSync(join(repo, "packages", pkg.dir, "dist"))) {
    failures.push(`${pkg.name}: no dist — the build did not run, the dry run cannot run, so this is a FAILURE`);
    continue;
  }
  let run;
  try {
    run = dryRun(join(repo, "packages", pkg.dir));
  } catch (error) {
    failures.push(`${pkg.name}: npm publish --dry-run did not run — ${String(error.stderr ?? error.message).trim().split("\n").slice(-3).join(" | ")}`);
    continue;
  }
  if (run.version !== manifest.version) failures.push(`${pkg.name}: the dry run packed version ${String(run.version)}, the manifest says ${manifest.version}`);
  if (!run.files.some((path) => /^LICEN[CS]E/i.test(path))) failures.push(`${pkg.name}: no LICENSE in the tarball`);
  if (!run.files.some((path) => path.startsWith("dist/"))) failures.push(`${pkg.name}: no dist in the tarball`);
  failures.push(...judgeExports(manifest, run.files));
  const fileProblems = judgeFiles(run.files, manifest.files ?? []);
  failures.push(...fileProblems.map((problem) => `${pkg.name}: ${problem}`));
  failures.push(...judgeManifest(manifest, pkg.dir));
  if (fileProblems.length === 0) notes.push(`${pkg.name}@${run.version}: ${String(run.files.length)} files, all from files`);
}
failures.push(...judgeVersions(manifests));
const versionTs = readFileSync(join(repo, "packages", "core", "src", "version.ts"), "utf8").match(/VERSION = "([^"]+)"/)?.[1];
if (versionTs !== manifests[0].version) failures.push(`the VERSION constant is "${String(versionTs)}", the manifest says "${manifests[0].version}"`);

// Under sdk/standalone/ in the monorepo, at the root in the standalone repo.
const workflow = [join(repo, ".github", "workflows", "release.yml"), join(repo, "sdk", "standalone", ".github", "workflows", "release.yml")].find((path) => existsSync(path) && readFileSync(path, "utf8").includes("npm publish"));
if (workflow === undefined) failures.push("no release workflow (.github/workflows/release.yml or sdk/standalone/.github/workflows/release.yml)");
else {
  const text = readFileSync(workflow, "utf8");
  if (!/id-token:\s*write/.test(text)) failures.push("the release workflow lacks id-token: write — it would publish without provenance");
  if (!/npm publish[^\n]*--provenance/.test(text)) failures.push("the release workflow's npm publish does not use --provenance");
  if (!/workflow_dispatch/.test(text)) failures.push("the release workflow cannot be started by hand (workflow_dispatch)");
  const publishProblems = judgeWorkflowPackages(text);
  failures.push(...publishProblems);
  if (publishProblems.length === 0) notes.push("the release workflow publishes all six packages, starting with the core, the element before the adapters");
  // 9. negative control for the workflow
  if (judgeWorkflowPackages(text.replace(" packages/vue", "")).length === 0) failures.push("NEGATIVE CONTROL: a workflow that leaves out a package does NOT fail");
  else notes.push("the negative control fails, as it should — the workflow without vue");
}

// --- 8: clean directory, ESM and CJS ------------------------------------------
const clean = mkdtempSync(join(tmpdir(), "tl-pack-install-"));
try {
  const packs = join(clean, "packs");
  const consumer = join(clean, "consumer");
  mkdirSync(packs);
  mkdirSync(consumer);
  const tarballs = [];
  for (const pkg of PACKAGES) {
    const out = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packs], { cwd: join(repo, "packages", pkg.dir), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    tarballs.push(join(packs, JSON.parse(out.slice(out.indexOf("[")))[0].filename));
  }
  // The loaded adapters' peers, as the user installs them: the React adapter also needs react-dom (portals).
  const peer = (dir, dep) => createRequire(join(repo, "packages", dir, "package.json"))(`${dep}/package.json`).version;
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "tl-pack-consumer", private: true, type: "module" }));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline", "--no-package-lock", "--legacy-peer-deps", "--ignore-scripts", ...tarballs, `react@${peer("react", "react")}`, `react-dom@${peer("react", "react-dom")}`, `vue@${peer("vue", "vue")}`], { cwd: consumer, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const plan = PACKAGES.map((pkg) => {
    const manifest = manifestOf(pkg.dir);
    return {
      name: pkg.name,
      esmOnly: pkg.esmOnly === true,
      subpaths: Object.entries(manifest.exports ?? {}).filter(([subpath]) => subpath !== "./package.json").map(([subpath, branch]) => ({ spec: subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`, require: typeof branch === "object" && branch !== null && "require" in branch, sideEffect: (manifest.sideEffects ?? []).some?.((file) => JSON.stringify(branch).includes(`"${file}"`)) === true, js: JSON.stringify(branch).match(/\.(m|c)?js"/) !== null })),
    };
  });
  writeFileSync(join(consumer, "probe.mjs"), `
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const plan = ${JSON.stringify(plan)};
const out = [];
for (const pkg of plan) for (const entry of pkg.subpaths) {
  const row = { spec: entry.spec };
  try {
    const resolved = fileURLToPath(import.meta.resolve(entry.spec));
    row.resolved = existsSync(resolved);
    if (!pkg.esmOnly && entry.js) {
      const esm = Object.keys(await import(entry.spec)).filter((k) => k !== "default").sort();
      row.esm = esm.length;
      row.sideEffect = entry.sideEffect;
      if (entry.require) {
        const cjs = Object.keys(require(entry.spec)).filter((k) => k !== "default" && k !== "__esModule").sort();
        row.cjs = cjs.length;
        row.same = JSON.stringify(esm) === JSON.stringify(cjs);
      }
    }
  } catch (error) { row.error = String(error.message).split("\\n")[0]; }
  out.push(row);
}
console.log(JSON.stringify(out));
`);
  const rows = JSON.parse(execFileSync("node", ["probe.mjs"], { cwd: consumer, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").pop());
  let loaded = 0;
  let resolvedOnly = 0;
  for (const row of rows) {
    if (row.error !== undefined) failures.push(`clean directory: ${row.spec} — ${row.error}`);
    else if (row.resolved !== true) failures.push(`clean directory: ${row.spec} resolved, but the file is missing`);
    else if (row.esm === undefined) resolvedOnly += 1;
    else if (row.esm === 0 && row.sideEffect !== true) failures.push(`clean directory: ${row.spec} is empty from ESM (and is not a side-effect entry point)`);
    else if (row.same === false) failures.push(`clean directory: ${row.spec} has ${String(row.esm)} exports from ESM, ${String(row.cjs)} from CJS — not the same`);
    else loaded += 1;
  }
  const withCjs = rows.filter((row) => row.cjs !== undefined && row.error === undefined && row.same !== false).length;
  notes.push(`clean directory: the six tarballs install; ${String(loaded)} subpaths load from ESM (${String(withCjs)} from CJS too, with identical exports), ${String(resolvedOnly)} only resolved (ESM-only adapter or non-JS branch)`);
} catch (error) {
  failures.push(`clean directory: the install or the probe did not run, so this is a FAILURE — ${String(error.stderr ?? error.message).trim().split("\n").slice(-3).join(" | ")}`);
} finally {
  rmSync(clean, { recursive: true, force: true });
}

// --- 5: negative control -----------------------------------------------------
const prerelease = judgeVersions(manifests.map((m, i) => (i === 0 ? { ...m, version: "1.0.0-rc.9" } : m)));
if (prerelease.length === 0) failures.push("NEGATIVE CONTROL: a prerelease version does NOT fail — the measure checks nothing");
else notes.push(`the negative control fails, as it should — prerelease version: ${prerelease[0]}`);
{
  const core = manifests[0];
  const files = ["package.json", "README.md", "dist/index.mjs", "dist/index.d.ts", "dist/index.cjs", "dist/index.d.cts"];
  const good = { name: core.name, exports: { ".": core.exports["."] } };
  const missing = judgeExports({ ...good, exports: { ".": core.exports["."], "./ghost": { import: { types: "./dist/ghost.d.ts", default: "./dist/ghost.mjs" } } } }, files);
  const untyped = judgeExports({ ...good, exports: { ".": { import: { default: "./dist/index.mjs" } } } }, files);
  if (judgeExports(good, files).length !== 0 || missing.length === 0 || untyped.length === 0) failures.push(`NEGATIVE CONTROL: the exports measure is blind (good: ${String(judgeExports(good, files).length)}, missing file: ${String(missing.length)}, without types: ${String(untyped.length)} problems)`);
  else notes.push(`the negative control fails, as it should — ${missing[0]} | ${untyped[0]}`);
}
const scratch = mkdtempSync(join(tmpdir(), "tl-pack-"));
try {
  cpSync(join(repo, "packages", "core", "package.json"), join(scratch, "package.json"));
  cpSync(join(repo, "packages", "core", "src"), join(scratch, "src"), { recursive: true });
  const leaky = { ...manifests[0], files: ["src"], scripts: {} };
  writeFileSync(join(scratch, "package.json"), JSON.stringify(leaky));
  const leak = judgeFiles(dryRun(scratch).files, ["dist"]);
  if (leak.length === 0) failures.push("NEGATIVE CONTROL: a files that packs the source does NOT fail");
  else notes.push(`the negative control fails, as it should — source in the tarball: ${leak[0]}`);
} catch (error) {
  failures.push(`NEGATIVE CONTROL did not run — ${String(error.message).split("\n")[0]}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "G-PACK: passed" : `G-PACK: FAILED (${String(failures.length)} failure(s))`);
process.exit(failures.length === 0 ? 0 : 1);
