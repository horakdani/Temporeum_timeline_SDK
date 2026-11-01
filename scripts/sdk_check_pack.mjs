#!/usr/bin/env node
/**
 * G-PACK (P18): a kiadando csomagok `npm publish --dry-run`-ja atmegy, es
 * amit a registry kapna, az pontosan az, aminek lennie kell.
 *
 * Csomagonkent (core, element, react, es a P23 ota vue, svelte, angular —
 * a docs privat, nem kerul ki):
 *
 *  1. `npm publish --dry-run --json` a csomag konyvtarabol, a buildelt
 *     dist-tel. A provenance helyben nem allithato elo (csak CI-ban, OIDC-
 *     tokennel), ezert a dry-run `--provenance=false`-szal fut, a provenance
 *     beallitasat pedig a 4. pont ellenorzi.
 *  2. A tarball csak a `files` tartalmat viszi: minden fajl a `files` egy
 *     bejegyzese alatt van, vagy azok kozul valo, amit az npm mindig visz
 *     (package.json, README, LICENSE, CHANGELOG). Nincs benne forras, teszt,
 *     terkep a forrasra mutato utvonallal, .env vagy pont-fajl.
 *  3. A verzio minden csomagban AZONOS, es nem elozetes (nincs `-`). A
 *     csomagok egymasra pontosan ezzel a verzioval mutatnak (nem tartomannyal
 *     es nem workspace:-szal), es a VERSION konstans is ez.
 *  4. A manifeszt kiadasra kesz: MIT licenc es LICENSE a tarballban;
 *     repository/homepage/bugs a packages/docs/site/project.json szerint, a
 *     repository.directory a csomag sajat konyvtara; publishConfig.access
 *     "public" es publishConfig.provenance true; a kiadasi workflow
 *     (az onallo repoban .github/workflows/release.yml, itt a
 *     sdk/standalone/ alatt) `id-token: write`
 *     engedellyel es `--provenance`-szel publikal.
 *  5. NEGATIV KONTROLL: egy elozetes verzioju masolat-manifeszt es egy
 *     forrasfajlt is csomagolo `files` ugyanezen a meron BUKIK.
 *
 * A P32 ota (kiadas-elokeszites) meg:
 *
 *  6. Minden exports-ag mogott fajl van a tarballban, es minden JS-ag
 *     mogott tipus: a feltetel-objektumban `types`, ami szinten a
 *     tarballban van. A README is a tarballban van.
 *  7. A kiadasi workflow MIND A HAT csomagot publikalja (a P18-as workflow
 *     csak harmat publikalt volna, a P23 adapterei kimaradtak), a magot
 *     elsonek, az elemet az adapterek elott.
 *  8. Tiszta konyvtar: a hat `npm pack` tarball egy ures projektbe
 *     telepitve (a React es a Vue mellett, a tobbi peer nelkul) a mag, az
 *     elem, a React- es a Vue-adapter MINDEN alutvonala `import()`-tal es,
 *     ahol van require-aga, `require()`-rel betolt, es a ket export-halmaz
 *     azonos (egy `sideEffects`-ben nevezett belepesi pont, pl. az elem
 *     `/define`-ja, exportalhat semmit, de hiba nelkul kell betoltenie). A Svelte- es az Angular-adapter ESM-only, a forrasukat a
 *     keretrendszer forditoja dolgozza fel: naluk a feloldas (az
 *     `import.meta.resolve`) es a fajl letezese a proba, a betoltes a
 *     G-SSR-e es a G-TEMPLATES-e.
 *  9. NEGATIV KONTROLL a 6-7-re: egy nem letezo fajlra mutato exports-ag,
 *     egy tipus nelkuli ag es egy csomagot kihagyo workflow BUKIK.
 *
 * A nem futtathato dry-run BUKAS, nem kihagyas.
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
  // P23: a három keretrendszer-adapter.
  { dir: "vue", name: "@temporeum/timeline-vue" },
  { dir: "svelte", name: "@temporeum/timeline-svelte", esmOnly: true },
  { dir: "angular", name: "@temporeum/timeline-angular", esmOnly: true },
];
const ALWAYS = /^(package\.json|README(\.md)?|LICEN[CS]E(\.md)?|CHANGELOG(\.md)?)$/i;
const FORBIDDEN = /(^|\/)(src|test|tests|e2e|scripts|node_modules)\/|\.test\.|\.spec\.|(^|\/)\.[^/]+$|\.env/;

const failures = [];
const notes = [];
const manifestOf = (dir) => JSON.parse(readFileSync(join(repo, "packages", dir, "package.json"), "utf8"));

/** A dry-run tarball fajljai, vagy hiba. */
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

/** A tarball fajljai a `files` ellen. Visszaadja a hibakat. */
function judgeFiles(files, allowed) {
  const problems = [];
  for (const path of files) {
    if (ALWAYS.test(path)) continue;
    if (FORBIDDEN.test(path)) problems.push(`tiltott fajl a tarballban: ${path}`);
    else if (!allowed.some((entry) => path === entry || path.startsWith(`${entry.replace(/\/$/, "")}/`))) problems.push(`a files-on kivuli fajl: ${path}`);
  }
  return problems;
}

/** A verziok es a kolcsonos hivatkozasok. Visszaadja a hibakat. */
function judgeVersions(manifests) {
  const problems = [];
  const versions = new Set(manifests.map((m) => m.version));
  if (versions.size !== 1) problems.push(`a verziok nem egyeznek: ${[...versions].join(", ")}`);
  const [version] = versions;
  if (typeof version !== "string" || version.includes("-") || !/^\d+\.\d+\.\d+$/.test(version)) problems.push(`a verzio elozetes vagy ervenytelen: ${String(version)}`);
  const names = new Set(manifests.map((m) => m.name));
  for (const manifest of manifests) {
    for (const [dep, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (names.has(dep) && range !== version) problems.push(`${manifest.name} -> ${dep}: "${String(range)}", a kiadott verzio ("${String(version)}") kell`);
    }
  }
  return problems;
}

function judgeManifest(manifest, dir) {
  const problems = [];
  if (manifest.license !== "MIT") problems.push(`${manifest.name}: a licenc ${String(manifest.license)}, MIT kell`);
  if (manifest.private === true) problems.push(`${manifest.name}: private`);
  const url = manifest.repository?.url ?? "";
  if (url.replace(/^git\+/, "").replace(/\.git$/, "") !== project.repository) problems.push(`${manifest.name}: repository.url ${url}, a project.json szerint ${project.repository}`);
  if (manifest.repository?.directory !== `packages/${dir}`) problems.push(`${manifest.name}: repository.directory ${String(manifest.repository?.directory)}`);
  if (manifest.homepage !== project.homepage) problems.push(`${manifest.name}: homepage ${String(manifest.homepage)}, a project.json szerint ${project.homepage}`);
  if (manifest.bugs?.url !== `${project.repository}/issues`) problems.push(`${manifest.name}: bugs.url ${String(manifest.bugs?.url)}`);
  if (manifest.publishConfig?.access !== "public") problems.push(`${manifest.name}: publishConfig.access nem "public"`);
  if (manifest.publishConfig?.provenance !== true) problems.push(`${manifest.name}: publishConfig.provenance nem true`);
  if (!existsSync(join(repo, "packages", dir, "LICENSE"))) problems.push(`${manifest.name}: nincs LICENSE a csomag konyvtaraban`);
  return problems;
}

/** Minden exports-ag mogott fajl, es minden JS-ag mogott tipus — a tarball fajljai ellen. */
export function judgeExports(manifest, files) {
  const problems = [];
  const has = (target) => files.includes(String(target).replace(/^\.\//, ""));
  const walk = (subpath, node, trail) => {
    if (typeof node === "string") {
      if (!has(node)) problems.push(`${manifest.name}: ${subpath} ${trail.join(".") || "(ag)"} -> ${node}: nincs a tarballban`);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const leaves = Object.entries(node).filter(([, value]) => typeof value === "string");
    const js = leaves.some(([condition, target]) => condition !== "types" && /\.(m|c)?js$/.test(target));
    if (js && node.types === undefined) problems.push(`${manifest.name}: ${subpath} ${trail.join(".") || "(ag)"}: JS-ag tipus nelkul`);
    for (const [condition, value] of Object.entries(node)) walk(subpath, value, [...trail, condition]);
  };
  for (const [subpath, branch] of Object.entries(manifest.exports ?? {})) {
    if (subpath === "./package.json") continue;
    walk(subpath, branch, []);
  }
  for (const key of ["main", "module", "types"]) if (manifest[key] !== undefined && !has(manifest[key])) problems.push(`${manifest.name}: ${key} -> ${manifest[key]}: nincs a tarballban`);
  if (!files.some((path) => /^README(\.md)?$/i.test(path))) problems.push(`${manifest.name}: nincs README a tarballban`);
  return problems;
}

/** A kiadasi workflow publish-lepese: mind a hat, a mag elol, az elem az adapterek elott. */
export function judgeWorkflowPackages(text) {
  const problems = [];
  const order = [...text.matchAll(/packages\/(core|web-component|react|vue|svelte|angular)\b/g)].map((m) => m[1]);
  const publishLine = text.split("\n").find((line) => /for pkg in /.test(line)) ?? "";
  const published = [...publishLine.matchAll(/packages\/([a-z-]+)/g)].map((m) => m[1]);
  for (const pkg of PACKAGES) if (!published.includes(pkg.dir)) problems.push(`a kiadasi workflow nem publikalja: ${pkg.name}`);
  if (published[0] !== "core") problems.push(`a kiadasi workflow nem a maggal kezd (${published.join(", ") || "nincs publish-ciklus"})`);
  const element = published.indexOf("web-component");
  for (const adapter of ["react", "vue", "svelte", "angular"]) if (published.includes(adapter) && published.indexOf(adapter) < element) problems.push(`a kiadasi workflow a(z) ${adapter}-t az elem elott publikalja`);
  return order.length === 0 ? ["a kiadasi workflow nem nevez meg csomagot"] : problems;
}

// --- 1-4: a valodi csomagok ---------------------------------------------------
const manifests = PACKAGES.map((pkg) => manifestOf(pkg.dir));
for (const [index, pkg] of PACKAGES.entries()) {
  const manifest = manifests[index];
  if (manifest.name !== pkg.name) failures.push(`packages/${pkg.dir}: a nev ${manifest.name}, nem ${pkg.name}`);
  if (!existsSync(join(repo, "packages", pkg.dir, "dist"))) {
    failures.push(`${pkg.name}: nincs dist — a build nem futott, a dry-run nem futtathato, ezert BUKAS`);
    continue;
  }
  let run;
  try {
    run = dryRun(join(repo, "packages", pkg.dir));
  } catch (error) {
    failures.push(`${pkg.name}: az npm publish --dry-run nem futott le — ${String(error.stderr ?? error.message).trim().split("\n").slice(-3).join(" | ")}`);
    continue;
  }
  if (run.version !== manifest.version) failures.push(`${pkg.name}: a dry-run ${String(run.version)} verziot csomagolt, a manifeszt ${manifest.version}`);
  if (!run.files.some((path) => /^LICEN[CS]E/i.test(path))) failures.push(`${pkg.name}: nincs LICENSE a tarballban`);
  if (!run.files.some((path) => path.startsWith("dist/"))) failures.push(`${pkg.name}: nincs dist a tarballban`);
  failures.push(...judgeExports(manifest, run.files));
  const fileProblems = judgeFiles(run.files, manifest.files ?? []);
  failures.push(...fileProblems.map((problem) => `${pkg.name}: ${problem}`));
  failures.push(...judgeManifest(manifest, pkg.dir));
  if (fileProblems.length === 0) notes.push(`${pkg.name}@${run.version}: ${String(run.files.length)} fajl, mind a files-bol`);
}
failures.push(...judgeVersions(manifests));
const versionTs = readFileSync(join(repo, "packages", "core", "src", "version.ts"), "utf8").match(/VERSION = "([^"]+)"/)?.[1];
if (versionTs !== manifests[0].version) failures.push(`a VERSION konstans "${String(versionTs)}", a manifeszt "${manifests[0].version}"`);

// A monorepoban a sdk/standalone/ alatt, az onallo repoban a gyokerben.
const workflow = [join(repo, ".github", "workflows", "release.yml"), join(repo, "sdk", "standalone", ".github", "workflows", "release.yml")].find((path) => existsSync(path) && readFileSync(path, "utf8").includes("npm publish"));
if (workflow === undefined) failures.push("nincs kiadasi workflow (.github/workflows/release.yml vagy sdk/standalone/.github/workflows/release.yml)");
else {
  const text = readFileSync(workflow, "utf8");
  if (!/id-token:\s*write/.test(text)) failures.push("a kiadasi workflow-bol hianyzik az id-token: write — provenance nelkul publikalna");
  if (!/npm publish[^\n]*--provenance/.test(text)) failures.push("a kiadasi workflow npm publish-a nem --provenance");
  if (!/workflow_dispatch/.test(text)) failures.push("a kiadasi workflow nem kezzel indithato (workflow_dispatch)");
  const publishProblems = judgeWorkflowPackages(text);
  failures.push(...publishProblems);
  if (publishProblems.length === 0) notes.push("a kiadasi workflow mind a hat csomagot publikalja, a maggal kezdve, az elemet az adapterek elott");
  // 9. negativ kontroll a workflow-ra
  if (judgeWorkflowPackages(text.replace(" packages/vue", "")).length === 0) failures.push("NEGATIV KONTROLL: egy csomagot kihagyo workflow NEM bukik");
  else notes.push("negativ kontroll bukik, ahogy kell — a vue-t kihagyo workflow");
}

// --- 8: tiszta konyvtar, ESM es CJS -------------------------------------------
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
  // A betoltott adapterek peerjei, ahogy a felhasznalo telepiti oket: a P35 ota a React-adapter a react-dom-ot is (portalok).
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
    if (row.error !== undefined) failures.push(`tiszta konyvtar: ${row.spec} — ${row.error}`);
    else if (row.resolved !== true) failures.push(`tiszta konyvtar: ${row.spec} feloldott, de a fajl nincs meg`);
    else if (row.esm === undefined) resolvedOnly += 1;
    else if (row.esm === 0 && row.sideEffect !== true) failures.push(`tiszta konyvtar: ${row.spec} ESM-bol ures (es nem side-effect belepesi pont)`);
    else if (row.same === false) failures.push(`tiszta konyvtar: ${row.spec} ESM-bol ${String(row.esm)}, CJS-bol ${String(row.cjs)} export — nem ugyanaz`);
    else loaded += 1;
  }
  const withCjs = rows.filter((row) => row.cjs !== undefined && row.error === undefined && row.same !== false).length;
  notes.push(`tiszta konyvtar: a hat tarball telepul; ${String(loaded)} alutvonal betolt ESM-bol (${String(withCjs)} CJS-bol is, azonos exportokkal), ${String(resolvedOnly)} csak feloldva (ESM-only adapter vagy nem-JS ag)`);
} catch (error) {
  failures.push(`tiszta konyvtar: a telepites vagy a proba nem futott le, ezert BUKAS — ${String(error.stderr ?? error.message).trim().split("\n").slice(-3).join(" | ")}`);
} finally {
  rmSync(clean, { recursive: true, force: true });
}

// --- 5: negativ kontroll ----------------------------------------------------
const prerelease = judgeVersions(manifests.map((m, i) => (i === 0 ? { ...m, version: "1.0.0-rc.9" } : m)));
if (prerelease.length === 0) failures.push("NEGATIV KONTROLL: egy elozetes verzio NEM bukik — a mero nem ellenoriz semmit");
else notes.push(`negativ kontroll bukik, ahogy kell — elozetes verzio: ${prerelease[0]}`);
{
  const core = manifests[0];
  const files = ["package.json", "README.md", "dist/index.mjs", "dist/index.d.ts", "dist/index.cjs", "dist/index.d.cts"];
  const good = { name: core.name, exports: { ".": core.exports["."] } };
  const missing = judgeExports({ ...good, exports: { ".": core.exports["."], "./ghost": { import: { types: "./dist/ghost.d.ts", default: "./dist/ghost.mjs" } } } }, files);
  const untyped = judgeExports({ ...good, exports: { ".": { import: { default: "./dist/index.mjs" } } } }, files);
  if (judgeExports(good, files).length !== 0 || missing.length === 0 || untyped.length === 0) failures.push(`NEGATIV KONTROLL: az exports-mero vak (jo: ${String(judgeExports(good, files).length)}, hianyzo fajl: ${String(missing.length)}, tipus nelkul: ${String(untyped.length)} hiba)`);
  else notes.push(`negativ kontroll bukik, ahogy kell — ${missing[0]} | ${untyped[0]}`);
}
const scratch = mkdtempSync(join(tmpdir(), "tl-pack-"));
try {
  cpSync(join(repo, "packages", "core", "package.json"), join(scratch, "package.json"));
  cpSync(join(repo, "packages", "core", "src"), join(scratch, "src"), { recursive: true });
  const leaky = { ...manifests[0], files: ["src"], scripts: {} };
  writeFileSync(join(scratch, "package.json"), JSON.stringify(leaky));
  const leak = judgeFiles(dryRun(scratch).files, ["dist"]);
  if (leak.length === 0) failures.push("NEGATIV KONTROLL: a forrast csomagolo files NEM bukik");
  else notes.push(`negativ kontroll bukik, ahogy kell — forras a tarballban: ${leak[0]}`);
} catch (error) {
  failures.push(`NEGATIV KONTROLL nem futott le — ${String(error.message).split("\n")[0]}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-PACK: atment" : `G-PACK: BUKOTT (${String(failures.length)} hiba)`);
process.exit(failures.length === 0 ? 0 : 1);
