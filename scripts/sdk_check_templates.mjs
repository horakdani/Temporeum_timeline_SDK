#!/usr/bin/env node
/**
 * G-EXAMPLES, harmadik fele: minden keretrendszer-sablon (packages/docs/templates)
 * epul es rajzol — a CSOMAGOLT tarballokkal, ahogy egy felhasznalo kapna.
 *
 * Sablononkent:
 *  1. masolat a .templates-work/<nev> ala (a sablon mappaja tiszta marad);
 *  2. a @temporeum/* fuggosegek helyere a hat `npm pack` tarball kerul
 *     (mind, mert az elem a magot, az adapterek az elemet kerik, es a
 *     verziok nincsenek az npm-en);
 *  3. npm install, npm run build — a sablon SAJAT build-szkriptje;
 *  4. kiszolgalas: a Vite- es az Astro-kimenet statikusan, a Next `next start`,
 *     a Nuxt a Nitro-kimenetbol, sajat porton (foglalt port: BUKAS);
 *  5. igazi Chromium: a lap betolt, konzolhiba es kivetel nelkul, legalabb
 *     harom `option` latszik (az elem shadow rootjaba is belat), es egy
 *     kattintas egy elemre kijeloli (aria-selected="true").
 *
 * Mindegyik sablonnak at kell mennie; hianyzo, nem futtathato vagy kihagyott
 * sablon BUKAS. A lista a templates/ mappabol jon, nem ebbol a fajlbol: egy
 * uj sablon magatol bekerul.
 */
/* global fetch, setTimeout */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repo, "packages", "docs");
const templatesDir = join(docs, "templates");
const work = join(docs, ".templates-work");
const BASE_PORT = Number(process.env.TL_TEMPLATES_PORT ?? 41766);
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
  return { kind: "none", reason: `${name}: a build utan nincs kiszolgalhato kimenet (.next, .output vagy dist/index.html)` };
}

// --- a csomagok --------------------------------------------------------------------
const templates = existsSync(templatesDir) ? readdirSync(templatesDir).filter((name) => existsSync(join(templatesDir, name, "package.json"))).sort() : [];
if (templates.length === 0) {
  console.error("G-EXAMPLES (sablonok): nincs egyetlen sablon sem — BUKAS");
  process.exit(1);
}
mkdirSync(join(work, "packs"), { recursive: true });
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
    problems.push(`${name}: build/pack bukott\n${tail(error)}`);
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
    if (errors.length > 0) return { ok: false, detail: `hiba a lapon:\n    ${errors.join("\n    ")}` };
    return { ok: true, detail: `${String(count)} option, kattintasra kijelol, konzolhiba nelkul` };
  } catch (error) {
    return { ok: false, detail: `a lap nem rajzolt vagy nem jelolt ki: ${error.message.split("\n")[0]}${errors.length > 0 ? `\n    ${errors.join("\n    ")}` : ""}` };
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
  // A friss masolat: a sablon forrasa, semmi mas (a node_modules marad, gyorsit).
  for (const entry of existsSync(dir) ? readdirSync(dir) : []) if (entry !== "node_modules") rmSync(join(dir, entry), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(join(templatesDir, name), dir, { recursive: true, filter: (source) => !/[/\\](node_modules|dist|\.next|\.nuxt|\.output|\.astro|\.angular|\.svelte-kit)([/\\]|$)/.test(source.slice(templatesDir.length)) });
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const declared = Object.keys(manifest.dependencies ?? {}).filter((dep) => dep.startsWith("@temporeum/"));
  if (declared.length === 0) {
    problems.push(`${name}: a sablon egyetlen @temporeum csomagot sem kér — nem a könyvtárat mutatja`);
    continue;
  }
  manifest.dependencies = { ...manifest.dependencies, ...Object.fromEntries(Object.entries(tarballs).map(([pkg, file]) => [pkg, `file:${file}`])) };
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", "--loglevel=error"], { cwd: dir });
    // Ugyanaz a verzioszam, mas tartalom: a file: fuggoseget kifejezetten ujratelepitjuk.
    run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", "--no-save", "--loglevel=error", ...Object.values(tarballs)], { cwd: dir });
  } catch (error) {
    problems.push(`${name}: a telepites bukott\n${tail(error)}`);
    continue;
  }
  try {
    run("npm", ["run", "build"], { cwd: dir });
  } catch (error) {
    problems.push(`${name}: a build bukott\n${tail(error)}`);
    continue;
  }
  const plan = servePlan(name, dir);
  if (plan.kind === "none") {
    problems.push(plan.reason);
    continue;
  }
  if (!(await portFree(port))) {
    problems.push(`${name}: a ${String(port)} port foglalt — idegen szervert mernenk, ezert BUKAS`);
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
    problems.push(`${name}: a szerver nem valaszolt 30 s alatt (${url})`);
    server.close();
    continue;
  }

  const verdict = await probe(url);
  server.close();
  if (verdict.ok) notes.push(`${name}: ${verdict.detail} (${String(Math.round((Date.now() - started) / 1000))} s)`);
  else problems.push(`${name}: ${verdict.detail}`);
}

// NEGATIV KONTROLL: egy lap, amely betolt, de idovonalat nem rajzol, es egy,
// amely rajzol, de konzolhibat dob. Ha barmelyik atmenne, a mero vak.
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
    if (empty.ok) problems.push("NEGATIV KONTROLL: egy idovonal nelkuli lap atment — a mero vak");
    if (noisy.ok) problems.push("NEGATIV KONTROLL: egy konzolhibat dobo lap atment — a mero nem hallja a hibat");
    if (!empty.ok && !noisy.ok) notes.push("negativ kontroll: az ures lap es a konzolhibas lap a meron bukik");
  } else {
    problems.push(`NEGATIV KONTROLL: a ${String(port)} port foglalt — nem futott, ezert BUKAS`);
  }
}
await browser?.close();

for (const note of notes) console.log(`  ok  ${note}`);
if (problems.length > 0) {
  console.error(`\nSablonok: ${String(problems.length)} problema`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log(`\nSablonok: mind a ${String(templates.length)} epul es rajzol a csomagolt tarballokkal.`);
