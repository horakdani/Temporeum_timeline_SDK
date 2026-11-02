#!/usr/bin/env node
/**
 * G-SSR — importing in Node does not throw; the HTML rendered on the server
 * hydrates. Under Next (React adapter), Nuxt (Vue adapter), Astro (the
 * element), SvelteKit (Svelte adapter) and Angular SSR (Angular adapter).
 *
 * The smoke test measures the PACKAGE, not the workspace: the `npm pack`
 * tarballs of the six packages go into a fresh app each (packages/docs/ssr/*),
 * the way a third-party project would get them. So the smoke test also
 * measures the exports map, the `files` list and the "use client" directive
 * — which stay hidden from tests that run from source.
 *
 * Steps:
 *  1. Node import: every entry point of the packages with `import()` and
 *     `require()`, without DOM globals, and the server-side renderers
 *     (renderTimelineHtml, React renderToString) actually run.
 *  2. Build: next build, nuxt build, astro build, vite build (SvelteKit),
 *     ng build (Angular SSR) — the framework itself imports and runs the
 *     package on its own server side.
 *  3. Server: next start, the Nitro output, the static Astro output, the
 *     SvelteKit adapter-node output and the Angular Express server.
 *  4. Playwright (e2e/ssr.spec.ts) against each of them: the drawing is in
 *     the raw HTML; it is visible without JavaScript too; the client takes
 *     over the same nodes (MutationObserver), without console errors, and
 *     afterwards a real click selects.
 *     NEGATIVE CONTROL: an Astro page whose client rewrites the markup before
 *     registration (which Vue does with a dynamic v-html) FAILS the probe —
 *     otherwise a pass of hydrates would mean nothing.
 *  5. Verdict from the Playwright JSON report: every (claim × framework)
 *     pair ran and passed. A skipped, missing or failed pair: FAIL.
 *
 * It installs the frameworks from npm (with fresh metadata: with
 * `--prefer-offline` a stale package list failed with ETARGET);
 * if it cannot, that is a FAIL, not a skip.
 */
/* global fetch, setTimeout */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repo, "packages/docs");
const fixtures = join(docs, "ssr");
const work = join(docs, ".ssr-work");
const REPORT = join(docs, ".e2e-ssr-report.json");
const REACT = createRequire(join(repo, "packages/react/package.json"))("react/package.json").version;
const FRAMEWORKS = {
  next: { deps: { next: "16.4.3", react: REACT, "react-dom": REACT }, port: 41761 },
  nuxt: { deps: { nuxt: "4.6.3", vue: "^3.5.0" }, port: 41762 },
  // 7.4.1, not 7.4.2: 7.4.2 requires Node >=22.23.4, this machine's Node is
  // 22.22.0 (7.4.1 requires >=22.22.0). The last one that runs here.
  astro: { deps: { astro: "7.4.1" }, port: 41763 },
  // SvelteKit 3.1 requires Node >=22.17: this machine's 22.22.0 is enough.
  sveltekit: {
    deps: { "@sveltejs/kit": "3.1.0", "@sveltejs/adapter-node": "6.0.0", "@sveltejs/vite-plugin-svelte": "7.3.1", svelte: "5.57.3", vite: "8.3.5" },
    port: 41764,
  },
  // The Angular 21 line: 22 requires Node ^22.22.3, this machine has 22.22.0.
  // The build requires TS 5.9 (<6.0); the fixture's .npmrc sets
  // legacy-peer-deps, because npm 10.9.4 trips over @angular/build's optional
  // peer set.
  angular: {
    deps: {
      "@angular/build": "21.2.29",
      "@angular/cli": "21.2.29",
      "@angular/common": "21.2.25",
      "@angular/compiler": "21.2.25",
      "@angular/compiler-cli": "21.2.25",
      "@angular/core": "21.2.25",
      "@angular/platform-browser": "21.2.25",
      "@angular/platform-server": "21.2.25",
      "@angular/router": "21.2.25",
      "@angular/ssr": "21.2.29",
      "@types/express": "5.0.6",
      "@types/node": "22.20.5",
      express: "5.3.0",
      rxjs: "7.8.2",
      typescript: "5.9.3",
    },
    port: 41765,
  },
};
const CLAIMS = ["server-html", "no-js", "hydrates"];
const problems = [];
const notes = [];
const children = [];

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, ...options });
}
const tail = (error) => String(error.stderr || error.stdout || error.message).trim().split("\n").slice(-12).join("\n");

function cleanup() {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

function finish() {
  for (const note of notes) process.stdout.write(`  ok  ${note}\n`);
  if (problems.length > 0) {
    process.stdout.write(`\nG-SSR: ${String(problems.length)} problem(s)\n`);
    for (const problem of problems) process.stdout.write(`  FAIL  ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write("\nG-SSR: importable in Node, and the HTML rendered on the server hydrates — Next, Nuxt, Astro, SvelteKit, Angular.\n");
  process.exit(0);
}

rmSync(REPORT, { force: true });
mkdirSync(join(work, "packs"), { recursive: true });

// --- the packages, as they would be published ------------------------------
const tarballs = {};
for (const [name, dir] of [
  ["@temporeum/timeline-core", "packages/core"],
  ["@temporeum/timeline-element", "packages/web-component"],
  ["@temporeum/timeline-react", "packages/react"],
  ["@temporeum/timeline-vue", "packages/vue"],
  ["@temporeum/timeline-svelte", "packages/svelte"],
  ["@temporeum/timeline-angular", "packages/angular"],
]) {
  try {
    run("npm", ["run", "--silent", "build", "-w", name], { cwd: repo });
    const [info] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", join(work, "packs")], { cwd: join(repo, dir) }));
    tarballs[name] = join(work, "packs", info.filename);
  } catch (error) {
    problems.push(`${name}: build/pack failed\n${tail(error)}`);
  }
}
if (problems.length > 0) finish();

// --- install and build per framework ---------------------------------------
for (const [name, framework] of Object.entries(FRAMEWORKS)) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  for (const stale of [".next", ".nuxt", ".output", "dist", "app", "src", "plugins", "shared", "build", ".svelte-kit", ".angular"]) rmSync(join(dir, stale), { recursive: true, force: true });
  cpSync(join(fixtures, name), dir, { recursive: true });
  cpSync(join(fixtures, "shared"), join(dir, "shared"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(fixtures, name, "package.json"), "utf8"));
  manifest.dependencies = {
    ...framework.deps,
    ...Object.fromEntries(Object.entries(tarballs).map(([pkg, file]) => [pkg, `file:${file}`])),
  };
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", "--loglevel=error"], { cwd: dir });
    // The tarball's content changes; npm does not always refresh a file:
    // dependency when the version number is the same. So it is reinstalled explicitly.
    run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", "--no-save", "--loglevel=error", ...Object.values(tarballs)], { cwd: dir });
  } catch (error) {
    problems.push(`${name}: the install failed\n${tail(error)}`);
    continue;
  }
  try {
    run("npm", ["run", "build"], { cwd: dir, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NUXT_TELEMETRY_DISABLED: "1", ASTRO_TELEMETRY_DISABLED: "1" } });
    notes.push(`${name}: the build ran with the packed tarballs`);
  } catch (error) {
    problems.push(`${name}: the build failed\n${tail(error)}`);
  }
}
if (problems.length > 0) finish();

// --- 1. Node import, from the installed packages ---------------------------
// Every subpath of the element comes from package.json's exports: a new
// plugin's entry point is picked up on its own.
const ELEMENT_SPECS = Object.keys(JSON.parse(readFileSync(join(repo, "packages/web-component/package.json"), "utf8")).exports)
  .filter((key) => key !== "./package.json")
  .map((key) => (key === "." ? "@temporeum/timeline-element" : `@temporeum/timeline-element/${key.slice(2)}`));
{
  const probe = join(work, "next", "probe.mjs");
  writeFileSync(
    probe,
    `import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
const require = createRequire(import.meta.url);
const specs = ["@temporeum/timeline-core", "@temporeum/timeline-core/dom", "@temporeum/timeline-core/calendar", "@temporeum/timeline-core/vis-compat", ...${JSON.stringify(ELEMENT_SPECS)}, "@temporeum/timeline-react"];
for (const spec of specs) { await import(spec); require(spec); }
for (const name of ["window", "document", "HTMLElement", "customElements"]) if (name in globalThis) throw new Error(name + " appeared at import");
const { renderTimelineHtml } = await import("@temporeum/timeline-element");
const { Timeline } = await import("@temporeum/timeline-react");
const { createElement } = await import("react");
const { renderToString } = await import("react-dom/server");
const config = { items: [{ id: "a", start: 0, end: 86400000, label: "A" }], domain: [0, 864000000] };
const html = renderTimelineHtml(config);
const react = renderToString(createElement(Timeline, config));
if (!html.includes('role="option"') || !react.includes('role="option"')) throw new Error("the server drew no item");
process.stdout.write(String(specs.length));`,
  );
  try {
    const count = run(process.execPath, [probe], { cwd: join(work, "next") });
    notes.push(`Node: ${count} entry points with import() and require(), without DOM globals; renderTimelineHtml and React renderToString draw`);
  } catch (error) {
    problems.push(`Node import failed\n${tail(error)}`);
  }
  // The Vue adapter the same way, from the Nuxt install (Vue is there):
  // import() and require(), without DOM globals, and Vue's own server
  // renderer draws. The Svelte and Angular packages are compiled by their
  // frameworks (.svelte source, partial Angular declarations) — their own
  // builds import and run them on the server.
  const vueProbe = join(work, "nuxt", "probe.mjs");
  writeFileSync(
    vueProbe,
    `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
await import("@temporeum/timeline-vue"); require("@temporeum/timeline-vue");
for (const name of ["window", "document", "HTMLElement", "customElements"]) if (name in globalThis) throw new Error(name + " appeared at import");
const { Timeline } = await import("@temporeum/timeline-vue");
const { createSSRApp, h } = await import("vue");
const { renderToString } = await import("vue/server-renderer");
const html = await renderToString(createSSRApp({ render: () => h(Timeline, { items: [{ id: "a", start: 0, end: 86400000, label: "A" }], domain: [0, 864000000] }) }));
if (!html.includes('role="option"')) throw new Error("the Vue server drew no item");
process.stdout.write("ok");`,
  );
  try {
    run(process.execPath, [vueProbe], { cwd: join(work, "nuxt") });
    notes.push("Node: the Vue adapter with import() and require(), without DOM globals; Vue's renderToString draws");
  } catch (error) {
    problems.push(`Node import (Vue) failed\n${tail(error)}`);
  }
}

// --- servers ----------------------------------------------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
function serveStatic(root, port) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    let path = join(root, decodeURIComponent(url.pathname));
    if (!path.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    if (!existsSync(path)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(response);
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}
function start(name, command, args, env) {
  const child = spawn(command, args, { cwd: join(work, name), env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  children.push(child);
  return () => log;
}
async function ready(url, logOf) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // not yet
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  problems.push(`${url} did not start\n${logOf?.().slice(-1500) ?? ""}`);
  return false;
}

// A port in use is a FAIL: an old server left behind would answer the
// measurement, and the check would pass against a different build (exactly
// this happened once after a debugging session — the old Nuxt served the old
// bundle).
for (const [name, framework] of Object.entries(FRAMEWORKS)) {
  const free = await new Promise((done) => {
    const probe = createNetServer();
    probe.once("error", () => done(false));
    probe.listen(framework.port, "127.0.0.1", () => probe.close(() => done(true)));
  });
  if (!free) problems.push(`${name}: port ${String(framework.port)} is in use — a foreign server would answer the measurement`);
}
if (problems.length > 0) finish();

const targets = [];
const nextLog = start("next", process.execPath, [join(work, "next/node_modules/next/dist/bin/next"), "start", "-p", String(FRAMEWORKS.next.port), "-H", "127.0.0.1"], { NEXT_TELEMETRY_DISABLED: "1" });
const nuxtLog = start("nuxt", process.execPath, [join(work, "nuxt/.output/server/index.mjs")], { PORT: String(FRAMEWORKS.nuxt.port), HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", NITRO_PORT: String(FRAMEWORKS.nuxt.port) });
const astro = await serveStatic(join(work, "astro/dist"), FRAMEWORKS.astro.port);
const svelteLog = start("sveltekit", process.execPath, [join(work, "sveltekit/build/index.js")], { PORT: String(FRAMEWORKS.sveltekit.port), HOST: "127.0.0.1" });
const angularLog = start("angular", process.execPath, [join(work, "angular/dist/server/server.mjs")], { PORT: String(FRAMEWORKS.angular.port) });
// "adapter": the framework component puts the instance on window.__tl, and
// writes the selection out from its own store (#selected); "element": the
// <temporeum-timeline> itself.
for (const [name, kind, logOf] of [
  ["next", "adapter", nextLog],
  ["nuxt", "adapter", nuxtLog],
  ["astro", "element", undefined],
  ["sveltekit", "adapter", svelteLog],
  ["angular", "adapter", angularLog],
]) {
  const url = `http://127.0.0.1:${String(FRAMEWORKS[name].port)}/`;
  if (await ready(url, logOf)) targets.push({ name, kind, url });
}

// --- 4. Playwright ----------------------------------------------------------
if (targets.length === Object.keys(FRAMEWORKS).length) {
  // Asynchronously: the Astro output is served from this very process, and
  // a synchronous child would block the loop that answers its requests.
  // The verdict is read from the report below, test by test.
  await new Promise((done) => {
    const child = spawn(join(repo, "node_modules/.bin/playwright"), ["test", "-c", "playwright.ssr.config.ts"], {
      cwd: docs,
      env: { ...process.env, TL_SSR_TARGETS: JSON.stringify(targets) },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("exit", done);
  });
}
astro.close();
cleanup();

// --- 5. the verdict ----------------------------------------------------------
if (!existsSync(REPORT)) {
  problems.push("no Playwright report: the browser part did not run");
} else {
  const report = JSON.parse(readFileSync(REPORT, "utf8"));
  const results = new Map();
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const claim = /\[claim:([\w-]+)\]/.exec(spec.title)?.[1];
      const target = /@(\w+)/.exec(spec.title)?.[1];
      for (const test of spec.tests ?? []) {
        const outcome = test.results?.at(-1)?.status ?? "missing";
        results.set(`${String(claim)}@${String(target)}`, outcome);
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  for (const name of Object.keys(FRAMEWORKS)) {
    // The control lives on the Astro build: a page whose client rewrites
    // the server's markup must be caught, or "hydrates" proves nothing.
    for (const claim of name === "astro" ? [...CLAIMS, "control"] : CLAIMS) {
      const outcome = results.get(`${claim}@${name}`);
      if (outcome !== "passed") problems.push(`${claim} @${name}: ${outcome ?? "did not run"}`);
    }
  }
  if (problems.length === 0) notes.push(`browser: ${String(CLAIMS.length)} claims × ${String(Object.keys(FRAMEWORKS).length)} frameworks + the negative control = ${String(results.size)} passing pairs`);
}
finish();
