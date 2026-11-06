#!/usr/bin/env node
/**
 * The pack check: `npm publish --dry-run` of the packages to be released passes, and
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
 *     a path pointing to the source, .env or dotfile — and no file the build
 *     leaves in dist only for the repo's own tools (`dist/build.json`, the
 *     source fingerprint the benchmarks compare: a user has no use for it).
 *  3. The version is IDENTICAL in every package, and not a prerelease (no
 *     `-`; `--allow-prerelease` admits one, for the `next` dist-tag). The packages point to each other with `^<version>` — a caret on
 *     exactly this version, not an exact pin, another range or workspace: —
 *     and the VERSION constant is this too.
 *  4. The manifest is ready for release: MIT licence and a LICENSE in the
 *     tarball; repository/homepage/bugs as in packages/docs/site/project.json,
 *     repository.directory the package's own directory; publishConfig.access
 *     "public" and publishConfig.provenance true; the release workflow
 *     (.github/workflows/release.yml) publishes with the `id-token: write`
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
 *     file existing, while loading is up to the ssr check and the templates check.
 *  9. NEGATIVE CONTROL for 6-7: an exports branch pointing to a file that
 *     does not exist, a branch without types, and a workflow that leaves out
 *     a package FAIL.
 * 10. No name that only means something inside this repo reaches a user: the
 *     packed text (JS, declarations, maps with their sources, README) names
 *     no gate (`G-` and capitals) and no development phase (`P` and a number).
 *     NEGATIVE CONTROL: a planted gate and phase FAIL, and a C0 control, a
 *     `BYxxx` part, `VTODO` and `P-value` pass.
 * 12. The release workflow's own `npm publish` argument starts with ./ (npm
 *     reads `tarballs/x.tgz` as the GitHub repository tarballs/x.tgz) and,
 *     filled in for each package, publishes the tarballs of point 8 as a dry
 *     run, from a directory laid out as the workflow's download step lays it out.
 *     NEGATIVE CONTROL: the argument without ./ FAILS.
 * 13. Every package a packed declaration file imports (`from`, `import()`)
 *     is the package's dependency or peer. NEGATIVE CONTROL: a stray import FAILS.
 * 14. No packed declaration file of any of the six says `any`, outside
 *     comments and strings — the type surface a user gets, which is what
 *     "no `any` on the public surface" promises. The two framework compilers'
 *     own lines are the exception, and only they: Angular's `static ɵfac`,
 *     `ɵcmp` and `ɵdir` metadata and Svelte's `z_$$bindings`, which no user
 *     code reads. NEGATIVE CONTROL: a handler typed `(...args: any[]) => any`
 *     FAILS, an `any` in a comment or a string and a compiler line pass.
 * 15. The element and every adapter hand on, from their main entry, the
 *     types an app writes — the data (`Item`, `Lane`, `Group`, `TimeMs` …)
 *     and every event's payload — so one install types an app: under pnpm
 *     and Yarn PnP the engine, a dependency of a dependency, cannot be
 *     imported. NEGATIVE CONTROL: an entry without `Lane` FAILS.
 * 16. The framework an adapter is developed and tested with is inside the
 *     peer range it promises: a dependency update that takes it past the
 *     range (React 20 under `^18 || ^19`) would test what no user can
 *     install. NEGATIVE CONTROL: a development React 20 FAILS.
 * 17. Every starter template's `@temporeum/*` range takes the version being
 *     released: the examples check installs the tarballs over the ranges
 *     (`file:`), so a template still on `^1.0.0` at 2.0.0 would pass there
 *     and install the old major for a user (V31). NEGATIVE CONTROL: a 2.0.0
 *     release FAILS against today's templates.
 * 11. publint, strict and at the suggestion level, finds nothing in the six
 *     tarballs of point 8 (the very files the registry would get).
 *     NEGATIVE CONTROL: a tarball whose `exports` names a missing file and
 *     puts `types` after `default` FAILS.
 *
 * A dry run that cannot run is a FAILURE, not a skip.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

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
/** `--allow-prerelease`: the release workflow packs a pre-release for the `next` dist-tag. */
const ALLOW_PRERELEASE = process.argv.includes("--allow-prerelease");
const ALWAYS = /^(package\.json|README(\.md)?|LICEN[CS]E(\.md)?|CHANGELOG(\.md)?)$/i;
const FORBIDDEN = /(^|\/)(src|test|tests|e2e|scripts|node_modules)\/|\.test\.|\.spec\.|(^|\/)\.[^/]+$|\.env/;
/** Files the build leaves in dist for the repo's own tools (the benchmarks' source fingerprint). */
const BUILD_ONLY = /^dist\/build\.json$/;
/** A gate's name (`G-` and capitals) or a development phase's (`P` and a number): they mean nothing outside this repo. */
const INTERNAL_NAME = /(?<![\w-])(?:G-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*|P\d{1,3})(?![\w-])/g;
const PACKED_TEXT = /\.(?:m|c)?js$|\.d\.(?:m|c)?ts$|\.map$|\.svelte$|(^|\/)README(\.md)?$/i;

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
    if (BUILD_ONLY.test(path)) problems.push(`build-only file in the tarball: ${path}`);
    else if (FORBIDDEN.test(path)) problems.push(`forbidden file in the tarball: ${path}`);
    else if (!allowed.some((entry) => path === entry || path.startsWith(`${entry.replace(/\/$/, "")}/`))) problems.push(`file outside files: ${path}`);
  }
  return problems;
}

/** The repo-internal names in the packed text files. Returns the problems. */
/**
 * Every package a packed declaration file imports is one the package depends on
 * (or has as a peer). TypeScript writes `import("@temporeum/timeline-core")` into
 * an inferred type even when the package only depends on the element; under
 * pnpm or Yarn PnP that import does not resolve, and with skipLibCheck the
 * payload silently becomes any.
 */
export function judgeTypeImports(manifest, declarations) {
  const allowed = new Set([manifest.name, ...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
  const problems = [];
  for (const [file, text] of declarations) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of code.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"'./][^"']*)["']/g)) {
      const spec = m[1];
      if (spec.startsWith("node:")) continue;
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (!allowed.has(name)) problems.push(`${file} imports ${spec}, which ${manifest.name} does not depend on`);
    }
  }
  return [...new Set(problems)];
}

/** The framework compilers' own declaration lines, which carry their `any` and no user code reads. */
const COMPILER_LINE = /^\s*(?:static ɵ(?:fac|cmp|dir|inj|prov|mod)\b|z_\$\$bindings\?:)/;

/** The types an app writes, which the element and each adapter export from their main entry (point 15). */
export const HOST_TYPES = [
  "Item", "Lane", "Group", "TimeMs", "Domain", "TimeBar", "TimeRange",
  "TimelineInstanceEventMap", "TimelineInstanceEventName",
  "ItemEventPayload", "HoverPayload", "SelectionChangedPayload", "ViewportChangedPayload", "LayoutChangedPayload", "ItemMovedPayload", "ItemResizedPayload", "CommandPayload",
  "DensityChangedPayload", "OrientationChangedPayload", "ClusterOpenedPayload", "JumpRequestPayload", "ItemsAddedPayload", "ItemsRemovedPayload", "ItemsChangedPayload",
  "GroupToggledPayload", "GroupMovedPayload", "TimeBarMovedPayload", "SlotsChangedPayload", "InputSkippedPayload",
];

/** The names a declaration file exports. */
export function exportedNames(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const names = new Set();
  for (const m of code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  for (const m of code.matchAll(/\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|type|class|function|const|let|enum)\s+(\w+)/g)) names.add(m[1]);
  return names;
}

export function judgeHostTypes(manifest, readMain) {
  const root = manifest.exports?.["."];
  const main = root?.import?.types ?? root?.types;
  if (main === undefined) return [`${manifest.name}: no types for its main entry`];
  const names = exportedNames(readMain(main.replace(/^\.\//, "")));
  const missing = HOST_TYPES.filter((name) => !names.has(name));
  return missing.length === 0 ? [] : [`${manifest.name}: its main entry (${main}) does not export ${missing.join(", ")}`];
}

export function judgePublicAny(declarations) {
  const problems = [];
  for (const [file, text] of declarations) {
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
    code.split("\n").forEach((line, index) => {
      if (/\bany\b/.test(line) && !COMPILER_LINE.test(line)) problems.push(`${file}:${String(index + 1)} says any: ${line.trim().slice(0, 120)}`);
    });
  }
  return problems;
}

/** A name marked `@internal` in a declaration file: `stripInternal` keeps what modules share out of what hosts see. */
export function judgeInternalDeclarations(declarations) {
  return declarations.filter(([, text]) => /@internal\b/.test(text)).map(([file]) => `${file} declares a name marked @internal`);
}

function judgeInternalNames(dir, files) {
  const problems = [];
  for (const path of files.filter((file) => PACKED_TEXT.test(file))) {
    const text = readFileSync(join(dir, path), "utf8");
    const found = [...new Set([...text.matchAll(INTERNAL_NAME)].map((match) => match[0]))];
    if (found.length > 0) problems.push(`${path} names ${found.join(", ")}, which means nothing outside this repo`);
  }
  return problems;
}

/**
 * The packed source maps: each source a map names is either in the map
 * (`sourcesContent`) or in the tarball. A map that points at a file the
 * tarball does not carry sends an editor's "go to definition" nowhere.
 */
function judgeMaps(dir, files) {
  const problems = [];
  const packed = new Set(files);
  for (const path of files.filter((file) => file.endsWith(".map"))) {
    let map;
    try {
      map = JSON.parse(readFileSync(join(dir, path), "utf8"));
    } catch {
      problems.push(`${path}: not a readable source map`);
      continue;
    }
    for (const [index, source] of (map.sources ?? []).entries()) {
      if (typeof map.sourcesContent?.[index] === "string") continue;
      const target = posix.normalize(posix.join(posix.dirname(path), map.sourceRoot ?? "", source));
      if (!packed.has(target)) problems.push(`${path}: names ${source}, which is neither in the map nor in the tarball`);
    }
  }
  return problems;
}

/** A copy of a dependency map with the six packages' ranges on `^version`. */
function rewriteInternal(deps, version) {
  if (deps === undefined) return undefined;
  return Object.fromEntries(Object.entries(deps).map(([name, range]) => [name, name.startsWith("@temporeum/timeline-") ? `^${version}` : range]));
}

/** The versions and the cross-references. Returns the problems. */
function judgeVersions(manifests, { allowPrerelease = false } = {}) {
  const problems = [];
  const versions = new Set(manifests.map((m) => m.version));
  if (versions.size !== 1) problems.push(`the versions do not match: ${[...versions].join(", ")}`);
  const [version] = versions;
  const shape = allowPrerelease ? /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/ : /^\d+\.\d+\.\d+$/;
  if (typeof version !== "string" || !shape.test(version)) problems.push(`the version is ${allowPrerelease ? "invalid" : "a prerelease or invalid (a pre-release is packed with --allow-prerelease, for the next dist-tag)"}: ${String(version)}`);
  const names = new Set(manifests.map((m) => m.name));
  for (const manifest of manifests) {
    for (const [dep, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      // A caret on the released version: an app that has the element and an
      // adapter gets one copy of each, not one pinned beside one it chose.
      if (names.has(dep) && range !== `^${String(version)}`) problems.push(`${manifest.name} -> ${dep}: "${String(range)}", "^${String(version)}" is required`);
    }
  }
  return problems;
}

/** The text of a package's sources: what its imports can be read from. */
function sourcesOf(dir) {
  const root = join(repo, "packages", dir, "src");
  return readdirSync(root, { recursive: true })
    .filter((path) => /\.(ts|svelte|mts)$/.test(String(path)))
    .map((path) => readFileSync(join(root, String(path)), "utf8"))
    .join("\n");
}

/** A peer dependency the sources never import is one every app is made to install for nothing. */
export function judgePeers(manifest, sources) {
  const problems = [];
  for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
    const escaped = peer.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    if (!new RegExp(`from\\s+["']${escaped}(?:/[^"']*)?["']|import\\(\\s*["']${escaped}(?:/[^"']*)?["']`).test(sources)) problems.push(`${manifest.name}: the peer ${peer} is not imported by the sources`);
  }
  return problems;
}

/** Whether a version is in an npm range of the shapes the peers use: `||`, `^`, `~`, `>=`, `<`, `=`. */
export function inRange(version, range) {
  const parts = (text) => text.split(".").map(Number);
  const compare = (a, b) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };
  return range.split("||").some((alternative) =>
    alternative.trim().split(/\s+/).every((term) => {
      const [, op, base] = /^(\^|~|>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/.exec(term) ?? [];
      if (base === undefined) return false;
      const [major, minor] = parts(base);
      if (op === "^") return compare(version, base) >= 0 && parts(version)[0] === major;
      if (op === "~") return compare(version, base) >= 0 && parts(version)[0] === major && parts(version)[1] === minor;
      const order = compare(version, base);
      return op === ">=" ? order >= 0 : op === "<=" ? order <= 0 : op === ">" ? order > 0 : op === "<" ? order < 0 : order === 0;
    }),
  );
}

/** The framework an adapter is developed with is one its peer range lets a user install (V32). */
export function judgeDevPeers(manifest) {
  const problems = [];
  for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
    const dev = manifest.devDependencies?.[peer];
    if (dev === undefined) continue;
    const version = /\d+(?:\.\d+){0,2}/.exec(dev)?.[0];
    if (version === undefined || !inRange(version, range)) problems.push(`${manifest.name}: developed with ${peer}@${dev}, outside its peer range ${range}`);
  }
  return problems;
}

/** The starter templates' ranges on the packages take `version` (V31). */
export function judgeTemplateRanges(version) {
  const root = join(repo, "packages", "docs", "templates");
  const problems = [];
  for (const name of readdirSync(root)) {
    const file = join(root, name, "package.json");
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    for (const [dep, range] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (dep.startsWith("@temporeum/") && !inRange(String(version).replace(/-.*$/, ""), range)) problems.push(`the ${name} template asks for ${dep}@${range}, which ${String(version)} is not in`);
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
/**
 * The release workflow's rights: nothing writes at the workflow's level, no
 * long-lived npm token (trusted publishing), releases only from main, a
 * checkout that does not leave its token in .git/config for the steps after it,
 * and a global install pinned to an exact version: a job holding `id-token:
 * write` runs only what was reviewed.
 */
export function judgeReleaseRights(text) {
  const problems = [];
  const top = text.slice(0, text.search(/^jobs:/m));
  if (/:\s*write/.test(top)) problems.push("the release workflow grants a write permission to every job (workflow-level permissions)");
  if (/NPM_TOKEN|NODE_AUTH_TOKEN/.test(text)) problems.push("the release workflow uses a long-lived npm token instead of trusted publishing");
  if (!/refs\/heads\/main/.test(text)) problems.push("the release workflow does not refuse a run from a branch other than main");
  if (!/persist-credentials:\s*false/.test(text)) problems.push("the release workflow's checkout keeps its token in .git/config");
  for (const m of text.matchAll(/npm install --global (\S+)/g)) if (!/@\d+\.\d+\.\d+$/.test(m[1])) problems.push(`the release workflow installs ${m[1]}, not an exact version`);
  // A ref or an input is text the person who dispatches the run chooses: an env value, never spliced into a script.
  for (const line of text.split("\n")) {
    if (/\$\{\{\s*(?:github\.(?:ref|head_ref|ref_name)|inputs\.[\w-]+)\s*\}\}/.test(line) && !/^\s*[A-Z_]+:\s*\$\{\{/.test(line)) problems.push(`the release workflow splices a ref or an input into a script: ${line.trim()}`);
  }
  return problems;
}

/**
 * The publish step's tarball argument. npm reads an argument shaped `a/b` that
 * does not start with `./`, `../` or `/` as GitHub shorthand, and runs
 * `git ls-remote` against github.com/a/b instead of reading the file — so a
 * release would stop at the first package and publish nothing.
 */
export function publishArgumentOf(text) {
  const m = /npm publish\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(text);
  return m === null ? undefined : (m[1] ?? m[2] ?? m[3]);
}

export function judgePublishArgument(arg) {
  if (arg === undefined) return ["the release workflow's npm publish names no tarball"];
  if (!/^(\.{1,2}\/|\/)/.test(arg)) return [`the release workflow publishes "${arg}", which npm reads as a GitHub repository (owner/repo), not as a file — start the path with ./`];
  return [];
}

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

/** publint's messages for one packed tarball (strict: warnings count as errors; suggestions too). */
async function publintProblems(pack, pkgDir = undefined) {
  const { messages, pkg } = await publint({ pack, level: "suggestion", strict: true, ...(pkgDir === undefined ? {} : { pkgDir }) });
  return messages.map((message) => `${message.type} ${message.code}: ${formatMessage(message, pkg, { color: false }) ?? ""}`);
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
  const mapProblems = judgeMaps(join(repo, "packages", pkg.dir), run.files);
  failures.push(...mapProblems.map((problem) => `${pkg.name}: ${problem}`));
  failures.push(...judgeInternalNames(join(repo, "packages", pkg.dir), run.files).map((problem) => `${pkg.name}: ${problem}`));
  const declarations = run.files.filter((file) => /\.d\.(?:[mc]?ts|svelte\.ts)$|\.svelte\.d\.ts$/.test(file)).map((file) => [file, readFileSync(join(repo, "packages", pkg.dir, file), "utf8")]);
  const importProblems = judgeTypeImports(manifest, declarations);
  failures.push(...importProblems.map((problem) => `${pkg.name}: ${problem}`));
  if (importProblems.length === 0) notes.push(`${pkg.name}: its ${String(declarations.length)} declaration files import only what it depends on`);
  const anyProblems = judgePublicAny(declarations);
  failures.push(...anyProblems.map((problem) => `${pkg.name}: ${problem}`));
  failures.push(...judgeInternalDeclarations(declarations).map((problem) => `${pkg.name}: ${problem}`));
  if (anyProblems.length === 0) notes.push(`${pkg.name}: no \`any\` in its declaration files`);
  if (pkg.dir !== "core") {
    const hostProblems = judgeHostTypes(manifest, (file) => readFileSync(join(repo, "packages", pkg.dir, file), "utf8"));
    failures.push(...hostProblems);
    if (hostProblems.length === 0) notes.push(`${pkg.name}: its main entry exports the ${String(HOST_TYPES.length)} types an app writes`);
  }
  failures.push(...judgeManifest(manifest, pkg.dir));
  failures.push(...judgePeers(manifest, sourcesOf(pkg.dir)));
  failures.push(...judgeDevPeers(JSON.parse(readFileSync(join(repo, "packages", pkg.dir, "package.json"), "utf8"))));
  if (fileProblems.length === 0) notes.push(`${pkg.name}@${run.version}: ${String(run.files.length)} files, all from files`);
}
failures.push(...judgeVersions(manifests, { allowPrerelease: ALLOW_PRERELEASE }));
{
  const templateProblems = judgeTemplateRanges(manifests[0]?.version);
  failures.push(...templateProblems);
  if (templateProblems.length === 0) notes.push(`every starter template's @temporeum range takes ${String(manifests[0]?.version)}`);
  if (judgeTemplateRanges("2.0.0").length === 0) failures.push("NEGATIVE CONTROL: a 2.0.0 release does NOT fail against the templates' ranges");
  else notes.push("the negative control fails, as it should — a 2.0.0 release against the templates' ranges");
}
const versionTs = readFileSync(join(repo, "packages", "core", "src", "version.ts"), "utf8").match(/VERSION = "([^"]+)"/)?.[1];
if (versionTs !== manifests[0].version) failures.push(`the VERSION constant is "${String(versionTs)}", the manifest says "${manifests[0].version}"`);
// The element's plugin registry is per release (R45): its key names the version.
const elementIndex = PACKAGES.findIndex((pkg) => pkg.dir === "web-component");
const releaseTs = readFileSync(join(repo, "packages", "web-component", "src", "plugins.ts"), "utf8").match(/RELEASE = "([^"]+)"/)?.[1];
if (releaseTs !== manifests[elementIndex]?.version) failures.push(`the element's plugin registry RELEASE is "${String(releaseTs)}", its manifest says "${String(manifests[elementIndex]?.version)}"`);

let workflowText;
const workflow = [
  join(repo, ".github", "workflows", "release.yml"),
].find((path) => existsSync(path) && readFileSync(path, "utf8").includes("npm publish"));
if (workflow === undefined) failures.push("no release workflow that runs npm publish (.github/workflows/release.yml)");
else {
  const text = readFileSync(workflow, "utf8");
  if (!/id-token:\s*write/.test(text)) failures.push("the release workflow lacks id-token: write — it would publish without provenance");
  if (!/npm publish[^\n]*--provenance/.test(text)) failures.push("the release workflow's npm publish does not use --provenance");
  if (!/workflow_dispatch/.test(text)) failures.push("the release workflow cannot be started by hand (workflow_dispatch)");
  workflowText = text;
  const argumentProblems = judgePublishArgument(publishArgumentOf(text));
  failures.push(...argumentProblems);
  if (judgePublishArgument("tarballs/temporeum-timeline-$short-$VERSION.tgz").length === 0) failures.push("NEGATIVE CONTROL: a publish argument without ./ (GitHub shorthand to npm) does NOT fail");
  else notes.push("the negative control fails, as it should — a publish argument without ./ is GitHub shorthand to npm");
  const publishProblems = judgeWorkflowPackages(text);
  failures.push(...publishProblems);
  if (publishProblems.length === 0) notes.push("the release workflow publishes all six packages, starting with the core, the element before the adapters");
  const rightsProblems = judgeReleaseRights(text);
  failures.push(...rightsProblems);
  if (rightsProblems.length === 0) notes.push("the release workflow writes only in its tag job, publishes without a token, from main only");
  const loose = "permissions:\n  contents: write\n  id-token: write\njobs:\n  publish:\n    env:\n      NODE_AUTH_TOKEN: x\n";
  if (judgeReleaseRights(loose).length < 4) failures.push(`NEGATIVE CONTROL: a workflow with write rights for every job and a token does NOT fail (${judgeReleaseRights(loose).join("; ")})`);
  else notes.push("the negative control fails, as it should — workflow-level write, a token, any branch, a kept checkout token");
  if (!judgeReleaseRights(text.replace(/npm install --global npm@\S+/, "npm install --global npm@11")).some((p) => p.includes("not an exact version"))) failures.push("NEGATIVE CONTROL: an unpinned npm install in the release workflow does NOT fail");
  else notes.push("the negative control fails, as it should — npm@11 instead of an exact version");
  if (!judgeReleaseRights(`${text}\n        run: echo "\${{ github.ref }}"\n`).some((p) => p.includes("splices"))) failures.push("NEGATIVE CONTROL: a ref spliced into a release script does NOT fail");
  else notes.push("the negative control fails, as it should — a ref spliced into a script");
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
  // --- 11: publint on the same tarballs
  try {
    const linted = [];
    for (const tarball of tarballs) {
      const problems = await publintProblems({ tarball: new Uint8Array(readFileSync(tarball)).buffer });
      failures.push(...problems.map((problem) => `publint ${posix.basename(tarball)}: ${problem}`));
      if (problems.length === 0) linted.push(posix.basename(tarball, ".tgz"));
    }
    if (linted.length === tarballs.length) notes.push(`publint (strict, suggestions too): nothing in the ${String(linted.length)} tarballs`);
    const broken = await publintProblems({
      files: [
        { name: "package/package.json", data: JSON.stringify({ name: "tl-broken", version: "1.0.0", type: "module", exports: { ".": { default: "./dist/index.js", types: "./dist/index.d.ts" }, "./ghost": "./dist/ghost.js" } }) },
        { name: "package/dist/index.js", data: "export {};\n" },
        { name: "package/dist/index.d.ts", data: "export {};\n" },
      ],
    }, "package");
    if (broken.length < 2) failures.push(`NEGATIVE CONTROL: publint passes a broken tarball (${broken.join("; ") || "no problems"})`);
    else notes.push(`the negative control fails, as it should — publint: ${broken.join(" | ")}`);
  } catch (error) {
    failures.push(`publint did not run, so this is a FAILURE — ${String(error.message).split("\n")[0]}`);
  }
  // --- 12: the workflow's own publish argument, run as a dry run on the same tarballs
  const argument = workflowText === undefined ? undefined : publishArgumentOf(workflowText);
  if (argument !== undefined && judgePublishArgument(argument).length === 0) {
    const release = join(clean, "release");
    const dried = [];
    PACKAGES.forEach((pkg, index) => {
      const short = pkg.name.replace("@temporeum/timeline-", "");
      const path = argument.replaceAll("$short", short).replace(/\$\{?VERSION\}?/g, manifests[index].version);
      if (posix.basename(path) !== posix.basename(tarballs[index])) {
        failures.push(`the release workflow publishes ${path}, but npm pack makes ${posix.basename(tarballs[index])}`);
        return;
      }
      mkdirSync(dirname(join(release, path)), { recursive: true });
      cpSync(tarballs[index], join(release, path));
      try {
        execFileSync("npm", ["publish", path, "--dry-run", "--provenance=false", "--ignore-scripts", "--access", "public"], { cwd: release, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, env: { ...process.env, GIT_SSH_COMMAND: "ssh -o BatchMode=yes" } });
        dried.push(short);
      } catch (error) {
        failures.push(`the release workflow's own npm publish ${path} fails as a dry run — ${String(error.stderr ?? error.message).trim().split("\n").slice(-2).join(" | ")}`);
      }
    });
    if (dried.length === PACKAGES.length) notes.push(`the release workflow's npm publish argument (${argument}) publishes all six tarballs as a dry run`);
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
// --allow-prerelease lets a pre-release through, and nothing else that is not a version
const rcAllowed = judgeVersions(manifests.map((m) => ({ ...m, version: "1.0.0-rc.9" })).map((m) => ({ ...m, dependencies: rewriteInternal(m.dependencies, "1.0.0-rc.9"), peerDependencies: rewriteInternal(m.peerDependencies, "1.0.0-rc.9") })), { allowPrerelease: true });
const junkAllowed = judgeVersions(manifests.map((m) => ({ ...m, version: "1.0" })), { allowPrerelease: true });
if (rcAllowed.length !== 0 || junkAllowed.length === 0) failures.push(`NEGATIVE CONTROL: --allow-prerelease is wrong (rc: ${rcAllowed.join("; ") || "passes"}, "1.0": ${junkAllowed.length === 0 ? "passes" : "fails"})`);
else notes.push("--allow-prerelease passes 1.0.0-rc.9 and still fails \"1.0\"");
{
  const angular = manifests.find((m) => m.name.endsWith("-angular"));
  const extra = angular === undefined ? [] : judgePeers({ ...angular, peerDependencies: { ...angular.peerDependencies, rxjs: "^7.4.0" } }, sourcesOf("angular"));
  if (extra.length === 0) failures.push("NEGATIVE CONTROL: a peer the sources do not import does NOT fail");
  else notes.push(`the negative control fails, as it should — ${extra[0]}`);
  const react = JSON.parse(readFileSync(join(repo, "packages", "react", "package.json"), "utf8"));
  const ahead = judgeDevPeers({ ...react, devDependencies: { ...react.devDependencies, react: "^20.0.0" } });
  const angularDev = JSON.parse(readFileSync(join(repo, "packages", "angular", "package.json"), "utf8"));
  const angularAhead = judgeDevPeers({ ...angularDev, devDependencies: { ...angularDev.devDependencies, "@angular/core": "~23.0.0" } });
  if (ahead.length === 0 || angularAhead.length === 0) failures.push("NEGATIVE CONTROL: a development framework past its peer range does NOT fail");
  else notes.push(`the negative control fails, as it should — ${ahead[0]}`);
}
const pinned = judgeVersions(manifests.map((m) => (m.dependencies?.["@temporeum/timeline-core"] === undefined ? m : { ...m, dependencies: { ...m.dependencies, "@temporeum/timeline-core": m.version } })));
if (pinned.length === 0) failures.push("NEGATIVE CONTROL: an exact pin on the core does NOT fail");
else notes.push(`the negative control fails, as it should — an exact pin: ${pinned[0]}`);
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
  // a declaration map whose source is not packed, and one that carries it
  mkdirSync(join(scratch, "dist"), { recursive: true });
  writeFileSync(join(scratch, "dist", "a.d.ts.map"), JSON.stringify({ version: 3, sources: ["../src/a.ts"], mappings: "" }));
  writeFileSync(join(scratch, "dist", "b.js.map"), JSON.stringify({ version: 3, sources: ["../src/b.ts"], sourcesContent: ["export {};"], mappings: "" }));
  const maps = judgeMaps(scratch, ["dist/a.d.ts.map", "dist/b.js.map"]);
  if (maps.length !== 1 || !maps[0].startsWith("dist/a.d.ts.map")) failures.push(`NEGATIVE CONTROL: the source-map measure is blind (${maps.join("; ") || "no problems"})`);
  else notes.push(`the negative control fails, as it should — ${maps[0]}`);
  // the benchmarks' fingerprint in the tarball
  const fingerprint = judgeFiles(["dist/index.mjs", "dist/build.json"], ["dist"]);
  if (fingerprint.length !== 1) failures.push(`NEGATIVE CONTROL: dist/build.json in the tarball does NOT fail (${fingerprint.join("; ") || "no problems"})`);
  else notes.push(`the negative control fails, as it should — ${fingerprint[0]}`);
  // a planted gate and phase (put together from pieces, so a rewrite of the names cannot reach them), and the look-alikes that are not names
  writeFileSync(join(scratch, "dist", "c.d.ts"), `/** the routes ${"G-"}NO-GESTURE-ONLY reads */\nexport {};\n`);
  writeFileSync(join(scratch, "dist", "d.mjs"), `// since ${"P"}17\nexport {};\n`);
  writeFileSync(join(scratch, "dist", "e.d.ts"), "/** a C0 control, every BYxxx part, a VTODO, a P-value, P2P, GG-A */\nexport {};\n");
  const named = judgeInternalNames(scratch, ["dist/c.d.ts", "dist/d.mjs", "dist/e.d.ts"]);
  if (named.length !== 2 || !named[0].startsWith("dist/c.d.ts") || !named[1].startsWith("dist/d.mjs")) failures.push(`NEGATIVE CONTROL: the internal-name measure is wrong (${named.join("; ") || "no problems"})`);
  else notes.push(`the negative control fails, as it should — ${named[0]} | ${named[1]}`);
  const stray = judgeTypeImports({ name: "@x/adapter", dependencies: { "@x/element": "^1.0.0" }, peerDependencies: { react: "^19" } }, [["dist/a.d.ts", 'import type { A } from "@x/element";\nexport declare const b: import("@x/core").B;\nimport "react/jsx-runtime";\n']]);
  if (stray.length !== 1 || !stray[0].includes("@x/core")) failures.push(`NEGATIVE CONTROL: a declaration importing a package it does not depend on does NOT fail (${stray.join("; ") || "no problems"})`);
  else notes.push(`the negative control fails, as it should — ${stray[0]}`);
  const internal = judgeInternalDeclarations([["dist/a.d.ts", "/**\n * Shared.\n *\n * @internal\n */\nexport declare function f(): string;\n"], ["dist/b.d.ts", "export declare const b = 1;\n"]]);
  if (internal.length !== 1 || !internal[0].startsWith("dist/a.d.ts")) failures.push(`NEGATIVE CONTROL: an @internal declaration does NOT fail (${internal.join("; ") || "no problems"})`);
  else notes.push(`the negative control fails, as it should — ${internal[0]}`);
  const loose = judgePublicAny([
    ["dist/a.d.ts", "/** any comment may say any */\nexport declare const a: { onX?: (...args: any[]) => any };\nexport type B = \"any\" | 'any';\n"],
    ["dist/b.d.ts", "declare class C {\n    static ɵfac: i0.ɵɵFactoryDeclaration<C<any>, never>;\n    z_$$bindings?: ReturnType<R<any>['bindings']>;\n}\n"],
  ]);
  if (loose.length !== 1 || !loose[0].startsWith("dist/a.d.ts:2")) failures.push(`NEGATIVE CONTROL: the any measure is wrong (${loose.join("; ") || "no problems"})`);
  else notes.push(`the negative control fails, as it should — ${loose[0]}`);
  const all = HOST_TYPES.filter((name) => name !== "Lane");
  const host = (text) => judgeHostTypes({ name: "@x/adapter", exports: { ".": { types: "./dist/index.d.ts" } } }, () => text);
  const lacking = host(`export type { ${all.slice(0, 5).join(", ")} } from "@x/element";\nexport type { Lane as Row, ${all.slice(5).join(", ")} } from "@x/element";\n// export type { Lane }\n`);
  const whole = host(`export type { ${all.join(", ")} } from "@x/element";\nexport interface Lane {}\n`);
  if (lacking.length !== 1 || !lacking[0].endsWith("does not export Lane") || whole.length !== 0) failures.push(`NEGATIVE CONTROL: the host-types measure is wrong (${[...lacking, ...whole].join("; ") || "no problems"})`);
  else notes.push(`the negative control fails, as it should — ${lacking[0]}`);
} catch (error) {
  failures.push(`NEGATIVE CONTROL did not run — ${String(error.message).split("\n")[0]}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(failures.length === 0 ? "pack: passed" : `pack: FAILED (${String(failures.length)} failure(s))`);
process.exit(failures.length === 0 ? 0 : 1);
