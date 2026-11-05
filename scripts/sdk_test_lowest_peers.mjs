#!/usr/bin/env node
/**
 * The lowest peers: every framework package's suite on the LOWEST version its
 * peer range admits, not only on the newest one the lockfile holds.
 *
 *  1. Every peer range is closed: each `||` alternative has an upper bound
 *     (`^`, `~` or `<`). An open `>=` claims versions nobody has tested.
 *  2. The floor of each range (the lowest version it admits) is installed in
 *     place of the development copy — the package's devDependency on that
 *     framework, and the framework's companion packages (react-dom,
 *     @angular/* but the build tool compiler-cli) on the same version — and
 *     the lockfile is re-resolved.
 *     The root's `overrides` put every other copy on the floor too: the
 *     build tools at the root (Vite's Svelte plugin compiling the component)
 *     must not bring a newer framework than the one the package runs on.
 *  3. From each package's own directory AND from the root, the framework
 *     now resolves to the floor: an install that kept the newer copy beside
 *     it (npm nests one when a range does not fit) is a FAILURE, not a green
 *     run on the wrong version — once, Svelte 5.57's compiler built the
 *     component for Svelte 5.46.4's runtime.
 *  4. Each package's `npm test` (build, typecheck, browser suite) passes.
 *
 * With --highest it does the same on the NEWEST version each range admits,
 * for every package whose development copy is not already that version — so a
 * range is tested at both ends: `@angular/core >=21 <23` is developed on 21
 * and runs here on the newest 22 (R26). A package whose suite already runs on
 * its range's newest is skipped, and says so.
 *
 * It rewrites package.json files and package-lock.json, so it runs only on a
 * throwaway checkout (CI, or a fresh export) and only with --throwaway.
 * NEGATIVE CONTROL: an open range and a range whose floor is not a release
 * fail on the same judge.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HIGHEST = process.argv.includes("--highest");
const END = HIGHEST ? "newest" : "lowest";

/**
 * The framework packages, the peer whose floor is tested, and its companions
 * installed on the same version. Angular's compiler-cli is not one: it is the
 * build tool that compiles the package partially (the app's own compiler
 * links it), not a runtime the app brings, and 21.0.0's does not install next
 * to TypeScript 6.
 */
const PACKAGES = [
  { dir: "react", peer: "react", companions: ["react-dom"] },
  // The suite compiles templates itself, with Vue's DOM compiler.
  { dir: "vue", peer: "vue", companions: ["@vue/compiler-dom"] },
  { dir: "svelte", peer: "svelte", companions: [] },
  {
    dir: "angular",
    peer: "@angular/core",
    companions: ["@angular/common", "@angular/compiler", "@angular/platform-browser", "@angular/platform-server"],
    // compiler-cli, the build tool at the root, needs the compiler of its own
    // version beside it; the suite's JIT compiler is the one beside the package.
    rootKeeps: ["@angular/compiler"],
  },
];

const parse = (version) => version.split(".").map(Number);
const compare = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** The lowest version a range admits, and whether every alternative is closed. Returns { floor, problems }. */
export function judgeRange(name, range) {
  const problems = [];
  const floors = [];
  for (const alternative of range.split("||").map((part) => part.trim())) {
    const lower = /^(?:\^|~|>=)\s*(\d+\.\d+\.\d+)/.exec(alternative);
    if (lower === null) {
      problems.push(`${name} "${range}": "${alternative}" has no lower bound of the form ^x.y.z, ~x.y.z or >=x.y.z`);
      continue;
    }
    const closed = /^[\^~]/.test(alternative) || /<\s*\d/.test(alternative);
    if (!closed) problems.push(`${name} "${range}": "${alternative}" is open — it admits versions nobody has tested`);
    floors.push(lower[1]);
  }
  floors.sort(compare);
  return { floor: floors[0], problems };
}

const manifests = PACKAGES.map(({ dir }) => ({ dir, path: join(repo, "packages", dir, "package.json"), manifest: JSON.parse(readFileSync(join(repo, "packages", dir, "package.json"), "utf8")) }));
const problems = [];
const floors = new Map();
for (const { dir, manifest } of manifests) {
  for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
    const judged = judgeRange(`${manifest.name} peer ${peer}`, range);
    problems.push(...judged.problems);
    floors.set(`${dir}:${peer}`, judged.floor);
  }
}

// The judge is not blind.
const open = judgeRange("control", ">=18.0.0").problems.length;
const bare = judgeRange("control", "18").problems.length;
const fine = judgeRange("control", "^18.0.0 || ^19.0.0");
if (open === 0 || bare === 0 || fine.problems.length !== 0 || fine.floor !== "18.0.0") problems.push("NEGATIVE CONTROL: the range judge does not tell an open or a bare range from a closed one — it is blind");
else console.log("  ok    negative control: an open range and a bare major fail, `^18.0.0 || ^19.0.0` has the floor 18.0.0");

if (problems.length > 0) finish();
for (const { manifest } of manifests) console.log(`  ok    ${manifest.name}: ${Object.entries(manifest.peerDependencies ?? {}).map(([peer, range]) => `${peer} "${range}"`).join(", ")} — closed`);

if (!process.argv.includes("--throwaway")) {
  console.log("\nlowest peers: the ranges are closed. The install and the suites run only with --throwaway: they rewrite the manifests and the lockfile.");
  process.exit(0);
}

// --highest: the newest version each range admits, from the registry, and
// only where the development copy is not already it.
if (HIGHEST) {
  for (const entry of [...manifests]) {
    const { dir, manifest } = entry;
    const { peer } = PACKAGES.find((p) => p.dir === dir);
    const range = manifest.peerDependencies?.[peer];
    const view = spawnSync("npm", ["view", `${peer}@${range}`, "version", "--json"], { cwd: repo, encoding: "utf8" });
    const listed = view.status === 0 ? JSON.parse(view.stdout) : undefined;
    const newest = (Array.isArray(listed) ? listed : [listed]).filter((v) => typeof v === "string" && !v.includes("-")).sort(compare).pop();
    if (newest === undefined) {
      problems.push(`${manifest.name}: the registry names no release in ${peer} "${range}" (npm view exited ${String(view.status)})`);
      continue;
    }
    let developed;
    try {
      // Read from the file, not required: a required JSON stays in the module cache through the install.
      developed = JSON.parse(readFileSync(createRequire(join(repo, "packages", dir, "package.json")).resolve(`${peer}/package.json`), "utf8")).version;
    } catch {
      developed = undefined;
    }
    if (developed === newest) {
      console.log(`  ok    ${manifest.name}: develops on ${peer}@${newest}, the newest its range admits — its suite already runs there`);
      manifests.splice(manifests.indexOf(entry), 1);
      continue;
    }
    floors.set(`${dir}:${peer}`, newest);
  }
  if (problems.length > 0) finish();
  if (manifests.length === 0) {
    console.log("\nnewest peers: every framework package already develops on the newest version its range admits.");
    process.exit(0);
  }
}

// 2. the floors (or the newest) in place of the development copies
for (const { dir, path, manifest } of manifests) {
  const { peer, companions } = PACKAGES.find((p) => p.dir === dir);
  const floor = floors.get(`${dir}:${peer}`);
  for (const name of [peer, ...companions]) {
    if (manifest.devDependencies?.[name] === undefined) {
      problems.push(`${manifest.name}: no devDependency on ${name} to put on ${floor}`);
      continue;
    }
    manifest.devDependencies[name] = floor;
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  ..    ${manifest.name}: ${[peer, ...companions].join(", ")} → ${floor}`);
}
// Every other copy on the floor too (the build tools at the root bring their own otherwise).
const rootPath = join(repo, "package.json");
const root = JSON.parse(readFileSync(rootPath, "utf8"));
root.overrides = { ...root.overrides };
const overridden = [];
for (const { dir } of manifests) {
  const { peer, companions, rootKeeps = [] } = PACKAGES.find((p) => p.dir === dir);
  for (const name of [peer, ...companions].filter((each) => !rootKeeps.includes(each))) {
    root.overrides[name] = floors.get(`${dir}:${peer}`);
    overridden.push(name);
  }
}
writeFileSync(rootPath, `${JSON.stringify(root, null, 2)}\n`);
// npm keeps a copy the lockfile already holds even when an override says
// otherwise: those entries go, so that the install resolves them again.
const lockPath = join(repo, "package-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
for (const key of Object.keys(lock.packages ?? {})) {
  if (overridden.some((name) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`))) delete lock.packages[key];
}
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
for (const name of overridden) rmSync(join(repo, "node_modules", ...name.split("/")), { recursive: true, force: true });
if (problems.length > 0) finish();
// npm 10.9 crashed on this install ("Exit handler never called"); npm 11 (Node 24's) does not.
const npmMajor = Number(spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout.split(".")[0]);
const [command, ...prefix] = npmMajor >= 11 ? ["npm"] : ["npx", "-y", "npm@11"];
const install = spawnSync(command, [...prefix, "install", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: repo, stdio: "inherit" });
if (install.status !== 0) {
  problems.push(`npm install with the floors exited with code ${String(install.status)}`);
  finish();
}

// 3. what each package really resolves, and 4. its suite
for (const { dir, path, manifest } of manifests) {
  const { peer, companions, rootKeeps = [] } = PACKAGES.find((p) => p.dir === dir);
  const floor = floors.get(`${dir}:${peer}`);
  const fromPackage = createRequire(path);
  const fromRoot = createRequire(rootPath);
  /** The version `name` resolves to from there; at the root, no copy at all is no other copy. */
  const versionOf = (from, name) => {
    try {
      return JSON.parse(readFileSync(from.resolve(`${name}/package.json`), "utf8")).version;
    } catch {
      return undefined;
    }
  };
  const wrong = [peer, ...companions]
    .flatMap((name) => [
      [name, versionOf(fromPackage, name) ?? "nothing", "beside the package"],
      [name, rootKeeps.includes(name) ? floor : (versionOf(fromRoot, name) ?? floor), "at the root"],
    ])
    .filter(([, version]) => version !== floor);
  if (wrong.length > 0) {
    problems.push(`${manifest.name}: resolves ${wrong.map(([name, version, where]) => `${name}@${version} ${where}`).join(", ")}, not ${floor} — the suite would run on the wrong version`);
    continue;
  }
  console.log(`\n=== ${manifest.name} on ${peer}@${floor} — npm test`);
  const run = spawnSync("npm", ["test", "-w", manifest.name], { cwd: repo, stdio: "inherit" });
  if (run.status !== 0) problems.push(`${manifest.name}: the suite on ${peer}@${floor} exited with code ${String(run.status)}`);
  else console.log(`  ok    ${manifest.name}: green on ${peer}@${floor}`);
}
finish();

function finish() {
  if (problems.length > 0) {
    console.error(`\n${END} peers FAILED — ${String(problems.length)} problems:`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }
  console.log(`\n${END} peers: every range is closed, and every framework package is green on the ${END} version its range admits.`);
  process.exit(0);
}
