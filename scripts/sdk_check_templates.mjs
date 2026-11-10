#!/usr/bin/env node
/**
 * The examples check, third part: every framework template (packages/docs/templates)
 * builds and draws — with the PACKED tarballs, the way a user would get them.
 *
 * Per template:
 *  1. a copy under .templates-work/<name> (the template's folder stays clean);
 *  2. the @temporeum/* dependencies are replaced with the six `npm pack`
 *     tarballs (all of them, because the element needs the core, the adapters
 *     need the element, and the versions are not on npm);
 *  3. npm install, npm run build — the template's OWN build script; a template
 *     without one (plain HTML) is opened from disk as well, by its file:// URL;
 *  4. serving: the Vite and Astro output statically, Next with `next start`,
 *     Nuxt from the Nitro output, a template without a build from its own
 *     folder, on its own port (a port in use: FAIL);
 *  5. real Chromium: the page loads without console errors or exceptions, at
 *     least three `option`s are visible (it also looks into the element's
 *     shadow root), and a click on an item selects it (aria-selected="true").
 *
 * TL_TEMPLATES_FROM=npm: the PUBLISHED packages instead — nothing is packed,
 * the template's own `^x.y.z` ranges are installed from the registry into a
 * clean folder (.templates-npm), and each template must resolve every
 * @temporeum package to the registry at the version on npm's `latest`. This is
 * what a user who copies a template gets after a release.
 *
 * Every template must pass; a missing, unrunnable or skipped template FAILS.
 * The list comes from the templates/ folder, not from this file: a new
 * template is picked up on its own.
 */
/* global fetch, setTimeout */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repo, "packages", "docs");
const templatesDir = join(docs, "templates");
const FROM_NPM = process.env.TL_TEMPLATES_FROM === "npm";
const work = join(docs, FROM_NPM ? ".templates-npm" : ".templates-work");
const BASE_PORT = Number(process.env.TL_TEMPLATES_PORT ?? 31766);
const ENV = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NUXT_TELEMETRY_DISABLED: "1", ASTRO_TELEMETRY_DISABLED: "1" };

const problems = [];
const notes = [];
const children = [];

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, env: ENV, ...options });
const tail = (error) => String(error.stderr || error.stdout || error.message).trim().split("\n").slice(-15).join("\n");

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

function portFree(port) {
  return new Promise((done) => {
    const probe = createNetServer();
    probe.once("error", () => done(false));
    probe.once("listening", () => probe.close(() => done(true)));
    probe.listen(port, "127.0.0.1");
  });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
function serveStatic(root, port) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let path = join(root, decodeURIComponent(url.pathname));
    if (!resolve(path).startsWith(root)) return response.writeHead(403).end();
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    if (!existsSync(path)) return response.writeHead(404).end("not found");
    response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(response);
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  return false;
}

/** How each kind of template is served once built. */
function servePlan(name, dir) {
  if (existsSync(join(dir, ".next"))) return { kind: "process", command: "npx", args: ["next", "start", "-p", "{port}", "-H", "127.0.0.1"] };
  if (existsSync(join(dir, ".output", "server", "index.mjs"))) return { kind: "process", command: "node", args: [".output/server/index.mjs"], env: { PORT: "{port}", HOST: "127.0.0.1", NITRO_PORT: "{port}", NITRO_HOST: "127.0.0.1" } };
  if (existsSync(join(dir, "dist", "index.html"))) return { kind: "static", root: join(dir, "dist") };
  return { kind: "none", reason: `${name}: no servable output after the build (.next, .output or dist/index.html)` };
}

// --- the packages ------------------------------------------------------------------
const templates = existsSync(templatesDir) ? readdirSync(templatesDir).filter((name) => existsSync(join(templatesDir, name, "package.json"))).sort() : [];
if (templates.length === 0) {
  console.error("examples (templates): there are no templates at all — FAIL");
  process.exit(1);
}
mkdirSync(join(work, "packs"), { recursive: true });
const tarballs = {};
const latest = {};
for (const [name, dir] of FROM_NPM ? [] : [
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

if (FROM_NPM) {
  for (const name of ["@temporeum/timeline-core", "@temporeum/timeline-element", "@temporeum/timeline-react", "@temporeum/timeline-vue", "@temporeum/timeline-svelte", "@temporeum/timeline-angular"]) {
    try {
      latest[name] = run("npm", ["view", name, "dist-tags.latest"]).trim();
    } catch (error) {
      problems.push(`${name}: not on npm\n${tail(error)}`);
    }
  }
}

/** The same verdict for every template: it draws, it selects on a click, it says nothing on the console. */
async function probe(url) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  try {
    await page.goto(url, { waitUntil: "load" });
    const options = page.locator("[role=option]");
    await options.nth(2).waitFor({ timeout: 15_000 });
    const count = await options.count();
    await page.waitForTimeout(300);
    await options.first().click();
    await page.locator('[role=option][aria-selected="true"]').first().waitFor({ timeout: 5_000 });
    if (errors.length > 0) return { ok: false, detail: `errors on the page:\n    ${errors.join("\n    ")}` };
    return { ok: true, detail: `${String(count)} options, selects on a click, no console errors` };
  } catch (error) {
    return { ok: false, detail: `the page did not draw or did not select: ${error.message.split("\n")[0]}${errors.length > 0 ? `\n    ${errors.join("\n    ")}` : ""}` };
  } finally {
    await page.close();
  }
}

const browser = problems.length === 0 ? await chromium.launch({ channel: "chromium-headless-shell" }) : undefined;

for (const [index, name] of templates.entries()) {
  if (browser === undefined) break;
  const dir = join(work, name);
  const port = BASE_PORT + index;
  const started = Date.now();
  // The fresh copy: the template's source and nothing else (node_modules stays, for speed).
  for (const entry of existsSync(dir) ? readdirSync(dir) : []) if (FROM_NPM || entry !== "node_modules") rmSync(join(dir, entry), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(join(templatesDir, name), dir, { recursive: true, filter: (source) => !/[/\\](node_modules|dist|\.next|\.nuxt|\.output|\.astro|\.angular|\.svelte-kit)([/\\]|$)/.test(source.slice(templatesDir.length)) });
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const declared = Object.keys(manifest.dependencies ?? {}).filter((dep) => dep.startsWith("@temporeum/"));
  if (declared.length === 0) {
    problems.push(`${name}: the template requires no @temporeum package — it does not show the library`);
    continue;
  }
  if (!FROM_NPM) {
    manifest.dependencies = { ...manifest.dependencies, ...Object.fromEntries(Object.entries(tarballs).map(([pkg, file]) => [pkg, `file:${file}`])) };
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  try {
    run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", "--loglevel=error"], { cwd: dir });
    // Same version number, different content: the file: dependency is reinstalled explicitly.
    if (!FROM_NPM) run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", "--no-save", "--loglevel=error", ...Object.values(tarballs)], { cwd: dir });
  } catch (error) {
    problems.push(`${name}: the install failed\n${tail(error)}`);
    continue;
  }
  if (FROM_NPM) {
    // Every @temporeum package in the tree, the transitive ones too, from the registry at `latest`.
    let listing;
    try {
      listing = run("npm", ["ls", "--all", "--json"], { cwd: dir });
    } catch (error) {
      listing = String(error.stdout ?? "{}"); // npm ls exits 1 on any extraneous or invalid package; the tree is still printed
    }
    const tree = JSON.parse(listing);
    const wrong = [];
    const walk = (node) => {
      for (const [pkg, child] of Object.entries(node.dependencies ?? {})) {
        // A deduped copy carries no `resolved`: the one it points at is checked where it is listed in full.
        const fromRegistry = child.resolved === undefined || String(child.resolved).startsWith("https://registry.npmjs.org/");
        if (pkg.startsWith("@temporeum/") && (child.version !== latest[pkg] || !fromRegistry)) wrong.push(`${pkg}@${child.version} from ${child.resolved ?? "?"}`);
        walk(child);
      }
    };
    walk(tree);
    if (wrong.length > 0) {
      problems.push(`${name}: not the published packages: ${wrong.join(", ")}`);
      continue;
    }
  }
  // A template without a build script is a page that runs as it is: served
  // from its own folder, and opened from disk too — the double-click it promises.
  const noBuild = manifest.scripts?.build === undefined;
  let fromDisk;
  if (noBuild) {
    if (!existsSync(join(dir, "index.html"))) {
      problems.push(`${name}: no build script and no index.html — nothing to open`);
      continue;
    }
    fromDisk = await probe(pathToFileURL(join(dir, "index.html")).href);
    if (!fromDisk.ok) {
      problems.push(`${name}, opened from disk: ${fromDisk.detail}`);
      continue;
    }
  } else {
    try {
      run("npm", ["run", "build"], { cwd: dir });
    } catch (error) {
      problems.push(`${name}: the build failed\n${tail(error)}`);
      continue;
    }
  }
  const plan = noBuild ? { kind: "static", root: dir } : servePlan(name, dir);
  if (plan.kind === "none") {
    problems.push(plan.reason);
    continue;
  }
  if (!(await portFree(port))) {
    problems.push(`${name}: port ${String(port)} is in use — we would be measuring a foreign server, so this FAILS`);
    continue;
  }
  let server;
  if (plan.kind === "static") {
    server = await serveStatic(plan.root, port);
  } else {
    const fill = (value) => value.replace("{port}", String(port));
    const child = spawn(plan.command, plan.args.map(fill), {
      cwd: dir,
      detached: true,
      stdio: "ignore",
      env: { ...ENV, ...Object.fromEntries(Object.entries(plan.env ?? {}).map(([key, value]) => [key, fill(value)])) },
    });
    children.push(child);
    server = { close: () => process.kill(-child.pid, "SIGTERM") };
  }
  const url = `http://127.0.0.1:${String(port)}/`;
  if (!(await waitFor(url, 30_000))) {
    problems.push(`${name}: the server did not respond within 30 s (${url})`);
    server.close();
    continue;
  }

  const verdict = await probe(url);
  server.close();
  if (verdict.ok) notes.push(`${name}: ${verdict.detail}${fromDisk ? "; from disk too" : ""} (${String(Math.round((Date.now() - started) / 1000))} s)`);
  else problems.push(`${name}: ${verdict.detail}`);
}

// NEGATIVE CONTROL: a page that loads but draws no timeline, and one that
// draws but throws a console error. If either passed, the probe is blind.
if (browser !== undefined) {
  const control = join(work, "control");
  rmSync(control, { recursive: true, force: true });
  mkdirSync(control, { recursive: true });
  writeFileSync(join(control, "index.html"), '<!doctype html><html lang="en"><title>empty</title><main><p>No timeline here.</p></main></html>');
  writeFileSync(
    join(control, "noisy.html"),
    '<!doctype html><html lang="en"><title>noisy</title><div role="listbox"><div role="option" aria-selected="false" onclick="this.setAttribute(\'aria-selected\',\'true\')">a</div><div role="option">b</div><div role="option">c</div></div><script>console.error("boom")</script></html>',
  );
  const port = BASE_PORT + templates.length;
  if (await portFree(port)) {
    const server = await serveStatic(control, port);
    const empty = await probe(`http://127.0.0.1:${String(port)}/`);
    const noisy = await probe(`http://127.0.0.1:${String(port)}/noisy.html`);
    server.close();
    if (empty.ok) problems.push("NEGATIVE CONTROL: a page without a timeline passed — the probe is blind");
    if (noisy.ok) problems.push("NEGATIVE CONTROL: a page that throws a console error passed — the probe does not hear the error");
    if (!empty.ok && !noisy.ok) notes.push("negative control: the empty page and the page with a console error both fail the probe");
  } else {
    problems.push(`NEGATIVE CONTROL: port ${String(port)} is in use — it did not run, so this FAILS`);
  }
}
await browser?.close();

for (const note of notes) console.log(`  ok  ${note}`);
if (problems.length > 0) {
  console.error(`\nTemplates: ${String(problems.length)} problem(s)`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log(`\nTemplates: all ${String(templates.length)} build and draw with ${FROM_NPM ? `the packages on npm (${Object.entries(latest).map(([pkg, version]) => `${pkg.slice(20)} ${version}`).join(", ")})` : "the packed tarballs"}.`);
