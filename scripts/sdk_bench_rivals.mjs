#!/usr/bin/env node
/**
 * The field benchmark: Temporeum against vis-timeline,
 * react-calendar-timeline, frappe-gantt and SVAR React Gantt, in Chromium,
 * Firefox and WebKit.
 *
 *   node scripts/sdk_bench_rivals.mjs
 *   npm run bench:field -w @temporeum/timeline-docs   (then the check)
 *
 * Env: FIELD_REPS (default 3) fresh pages per library x n x scenario x
 * browser; FIELD_BROWSERS (default "chromium,firefox,webkit"); FIELD_SMOKE=1
 * tries the harness on the small sizes only, once, and writes
 * .bench-work/field-smoke.json — never the published results.
 *
 * What it does, in order:
 *
 *  1. Builds core + element, so the browser runs the shipped dist.
 *  2. Installs the rivals, pinned below, into packages/docs/.bench-work with
 *     `npm install --no-save --prefix`, OUTSIDE the workspace (as the vis
 *     comparison does): no workspace package gains a dependency.
 *  3. Bundles the two React libraries, each with React 18 and its peers, and
 *     an empty React app as the framework's own baseline, with rolldown
 *     (production, minified, IIFE) into .bench-work/field-dist.
 *  4. Starts its OWN server on 127.0.0.1:41768 (TL_BENCH_FIELD_PORT) and
 *     refuses to run if the port is taken or a page is not ours.
 *  5. Two workloads, each library on its own page of packages/docs/bench/field
 *     with the same generator (bench/field/kit.js), in the same 1440 x 900
 *     box, DPR 1, a fresh browser context per page, NO CPU throttle (only
 *     Chromium has one; the browsers are compared like for like):
 *       timeline: Temporeum, vis-timeline, react-calendar-timeline;
 *                 1 000 and 10 000 items in 20 groups;
 *       gantt:    Temporeum (gantt), frappe-gantt, SVAR;
 *                 500 and 2 000 tasks, one per row, chained in runs of ten.
 *     Each library with its defaults and editing on, as users ship it.
 *
 * Scenarios, per page and repetition:
 *
 *  - load: first render (navigationStart -> item nodes in the box and
 *    visible, then two rAFs without a mutation), elements in the box, item
 *    nodes, items visible; Chromium also the JS heap after a forced GC.
 *  - pan, by the library's own way to move along time (the page says):
 *    `drag` — 24 real mouse drags of 240 px, 12 towards later time and 12
 *    back, each 400 ms with a move every ~16 ms and 100 ms between; or
 *    `wheel-x` — the same 24 strokes as horizontal wheel steps (25 steps of
 *    9.6 px, ~16 ms apart, then 100 ms). Frames recorded with rAF over the
 *    whole sequence. Chromium: heap after the pan.
 *  - zoom, where the library zooms on ctrl + wheel: a fresh page, the mouse
 *    at the chart's centre, Control held, 8 notches in and 8 out, 50 ms
 *    apart, the page's own |deltaY| per notch in and out (a 1.2x step where
 *    the library's rule allows it, else one mouse notch); the peak is recorded.
 *    A library without wheel zoom gets no zoom rows, and its capability says so.
 *
 * Missed frame: as in the vis comparison (V = 1000/60 ms; an interval
 * d > 1.5 V lost round(d / V) - 1 frames; missed % = lost / (lost + intervals)).
 *
 * Bytes: the JavaScript each page loaded for its library (recorded from the
 * network, the first time the page loads), each file minified (ours with oxc, since our dist is
 * not minified; the rivals as shipped or as bundled) and gzipped at level 9,
 * summed. Stylesheets are not counted. The React baseline is its own row.
 *
 * Verification — the run is not blind; on any failure results.json is NOT
 * written and the report goes to .bench-work/field-results.failed.json:
 * a page error (except a ResizeObserver loop notice, which WebKit raises as
 * one; those are counted in the results); first render past 120 s; fewer visible items than 10 (timeline)
 * or 5 (gantt); the pan did not move the view later by half the expected
 * distance after 12 strokes, or did not come back within a quarter of it;
 * a zoom that did not reach 1.3x or did not come back within 25%; any item
 * edited by a pan or a zoom; a page that loaded no script of its library.
 *
 * Output: packages/docs/site/benchmark/field/results.json
 */

/* global fetch, setTimeout, window */

import { spawnSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { arch, cpus, platform, release, totalmem, version as osVersion } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { chromium, firefox, webkit } from "@playwright/test";
import { minifySync } from "rolldown/utils";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "packages", "docs");
const fieldDir = join(docsDir, "bench", "field");
const workDir = join(docsDir, ".bench-work");
const workModules = join(workDir, "node_modules");
const bundleSrc = join(workDir, "field-src");
const bundleDist = join(workDir, "field-dist");
const outFile = process.env.FIELD_SMOKE === "1" ? join(docsDir, ".bench-work", "field-smoke.json") : join(docsDir, "site", "benchmark", "field", "results.json");
const failedFile = join(workDir, "field-results.failed.json");

/** The rivals and their peers, pinned. react-calendar-timeline's npm "latest" tag is a beta. */
const PINNED = {
  "vis-timeline": "8.5.6",
  "vis-data": "8.0.6",
  "react-calendar-timeline": "0.30.0-beta.4",
  "frappe-gantt": "1.2.2",
  "@svar-ui/react-gantt": "2.8.2",
  react: "18.3.1",
  "react-dom": "18.3.1",
  dayjs: "1.11.13",
  interactjs: "1.10.27",
};
const PORT = Number(process.env.TL_BENCH_FIELD_PORT ?? 41768);
const BASE = `http://127.0.0.1:${String(PORT)}`;
const VIEWPORT = { width: 1440, height: 900 };
const SMOKE = process.env.FIELD_SMOKE === "1";
const REPS = SMOKE ? 1 : Number(process.env.FIELD_REPS ?? 3);
const BROWSERS = (process.env.FIELD_BROWSERS ?? "chromium,firefox,webkit").split(",").map((name) => name.trim());
const LAUNCH = { chromium: () => chromium.launch({ channel: "chromium-headless-shell" }), firefox: () => firefox.launch(), webkit: () => webkit.launch() };
const NS = SMOKE ? { timeline: [1000], gantt: [200] } : { timeline: [1000, 10000], gantt: [500, 2000] };
const PAGES = [
  { library: "temporeum", workload: "timeline", page: "temporeum-timeline.html" },
  { library: "vis-timeline", workload: "timeline", page: "vis-timeline.html" },
  { library: "react-calendar-timeline", workload: "timeline", page: "react-calendar-timeline.html" },
  { library: "temporeum", workload: "gantt", page: "temporeum-gantt.html" },
  { library: "frappe-gantt", workload: "gantt", page: "frappe-gantt.html" },
  { library: "svar", workload: "gantt", page: "svar-gantt.html" },
];
/** Which loaded scripts are the library's (the kit is ours on every page, and not counted). */
const SCRIPT_OF = {
  temporeum: (path) => path.startsWith("/core/") || path.startsWith("/element/"),
  "vis-timeline": (path) => path.startsWith("/vis/"),
  "react-calendar-timeline": (path) => path === "/work/rct.js",
  "frappe-gantt": (path) => path.startsWith("/nm/frappe-gantt/"),
  svar: (path) => path === "/work/svar.js",
};
const VSYNC = 1000 / 60;
const MISSED_FRAME_DEFINITION =
  "V = 1000/60 ms. An rAF interval d > 1.5 V counts round(d / V) - 1 lost frames. missed % = lost frames / (lost frames + recorded rAF intervals) x 100, over the whole recording window.";
const PAN = { strokes: 24, forward: 12, distancePx: 240, durationMs: 400, moveEveryMs: 16, gapMs: 100, wheelSteps: 25 };
const ZOOM = { notches: 8, intervalMs: 50, tailMs: 300 };
const READY_TIMEOUT_MS = 120_000;
const BENIGN = /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/;
const ignored = new Map();

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const failures = [];
const check = (ok, message) => {
  if (!ok) {
    failures.push(message);
    console.error(`VERIFY FAIL: ${message}`);
  }
};
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`failed: ${command} ${args.join(" ")}`);
    process.exit(1);
  }
}

// --- 1. build ------------------------------------------------------------------
console.log("building @temporeum/timeline-core and @temporeum/timeline-element ...");
run("npm", ["run", "--silent", "build", "-w", "@temporeum/timeline-core", "-w", "@temporeum/timeline-element"], repoRoot);

// --- 2. the rivals, outside the workspace -----------------------------------------
const installed = (name) => {
  const file = join(workModules, ...name.split("/"), "package.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).version : null;
};
if (Object.entries(PINNED).some(([name, version]) => installed(name) !== version)) {
  console.log(`installing ${Object.entries(PINNED).map(([name, version]) => `${name}@${version}`).join(" ")} into ${workDir} ...`);
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, "package.json"), `${JSON.stringify({ name: "temporeum-bench-work", private: true, description: "the benchmark's rivals, outside the workspace" }, null, 2)}\n`);
  run("npm", ["install", "--no-save", "--no-audit", "--no-fund", "--prefix", workDir, ...Object.entries(PINNED).map(([name, version]) => `${name}@${version}`)], workDir);
}

// --- 3. the React bundles ------------------------------------------------------------
const { build } = await import("rolldown");
mkdirSync(bundleSrc, { recursive: true });
mkdirSync(bundleDist, { recursive: true });
for (const name of ["rct", "svar", "react-baseline"]) {
  // Copied next to .bench-work/node_modules, so the rivals' own React resolves, not the workspace's.
  copyFileSync(join(fieldDir, "src", `${name}.js`), join(bundleSrc, `${name}.js`));
  await build({
    input: join(bundleSrc, `${name}.js`),
    platform: "browser",
    transform: { define: { "process.env.NODE_ENV": JSON.stringify("production") } },
    output: { file: join(bundleDist, `${name}.js`), format: "iife", minify: true },
    logLevel: "warn",
  });
}

// --- 4. own server ----------------------------------------------------------------------
const ROOTS = [
  ["/field/", fieldDir],
  ["/core/", join(repoRoot, "packages", "core", "dist")],
  ["/element/", join(repoRoot, "packages", "web-component", "dist")],
  ["/vis/", workModules],
  ["/nm/", workModules],
  ["/work/", bundleDist],
];
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
function fileFor(pathname) {
  for (const [prefix, root] of ROOTS) {
    if (!pathname.startsWith(prefix)) continue;
    const target = resolve(join(root, decodeURIComponent(pathname.slice(prefix.length))));
    return target.startsWith(root + sep) ? target : null;
  }
  return null;
}
const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", BASE);
  const file = fileFor(pathname);
  if (file === null) return void response.writeHead(403).end("forbidden");
  if (!existsSync(file) || !statSync(file).isFile()) return void response.writeHead(404).end(`not found: ${pathname}`);
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(response);
});
await new Promise((done, fail) => {
  server.once("error", (error) => fail(error.code === "EADDRINUSE" ? new Error(`port ${String(PORT)} is taken — not measuring someone else's page`) : error));
  server.listen(PORT, "127.0.0.1", done);
});
for (const { library, workload, page } of PAGES) {
  const text = await (await fetch(`${BASE}/field/${page}`)).text();
  if (!text.includes(`data-bench-field="${library}:${workload}"`)) {
    server.close();
    throw new Error(`${page} on port ${String(PORT)} is not our page`);
  }
}

// --- helpers ----------------------------------------------------------------------------------
function frameStats(deltas) {
  let lost = 0;
  for (const d of deltas) if (d > 1.5 * VSYNC) lost += Math.round(d / VSYNC) - 1;
  const sorted = [...deltas].sort((a, b) => a - b);
  return { missed: deltas.length === 0 ? 100 : (lost / (lost + deltas.length)) * 100, p95: sorted.length === 0 ? Infinity : sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)], intervals: deltas.length };
}

async function heap(cdp) {
  if (cdp === null) return null;
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  return (metrics.find((entry) => entry.name === "JSHeapUsedSize")?.value ?? 0) / 1e6;
}

async function openPage(browser, browserName, spec, n) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const scripts = [];
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.endsWith(".js") || pathname.endsWith(".mjs")) scripts.push(pathname);
  });
  const errors = [];
  page.on("pageerror", (error) => {
    const message = String(error.message ?? error);
    // The one error the run lets pass: WebKit reports a ResizeObserver loop as a page error, which
    // the specification calls a notice (SVAR triggers it). It is counted in the results, not hidden.
    if (BENIGN.test(message)) {
      ignored.set(`${browserName}|${spec.library}`, (ignored.get(`${browserName}|${spec.library}`) ?? 0) + 1);
      return;
    }
    errors.push(message);
  });
  let cdp = null;
  if (browserName === "chromium") {
    cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.enable");
  }
  await page.goto(`${BASE}/field/${spec.page}?n=${String(n)}`);
  await page.waitForFunction(() => window.benchField !== undefined, undefined, { timeout: READY_TIMEOUT_MS });
  if ((await page.evaluate(() => window.benchField.marker)) !== "temporeum-bench-field") throw new Error(`${spec.page}: not the benchmark page`);
  const { readyMs } = await page.evaluate(() => Promise.race([window.benchField.ready, new Promise((_, fail) => setTimeout(() => fail(new Error("ready timeout")), 120_000))]));
  if (errors.length > 0) throw new Error(`page error: ${errors.join("; ")}`);
  return { context, page, cdp, readyMs, scripts, errors };
}

async function drag(page, x0, y, dx) {
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const began = performance.now();
  for (;;) {
    const u = Math.min((performance.now() - began) / PAN.durationMs, 1);
    await page.mouse.move(x0 + dx * u, y);
    if (u >= 1) break;
    await sleep(PAN.moveEveryMs);
  }
  await page.mouse.up();
}

async function wheelStroke(page, x, y, dx) {
  await page.mouse.move(x, y);
  for (let step = 0; step < PAN.wheelSteps; step += 1) {
    await page.mouse.wheel(dx / PAN.wheelSteps, 0);
    await sleep(PAN.moveEveryMs);
  }
}

// --- 5. measure ------------------------------------------------------------------------------
const samples = new Map();
const add = (library, workload, browser, n, metric, unit, value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return;
  const key = [library, workload, browser, String(n), metric].join("|");
  if (!samples.has(key)) samples.set(key, { library, workload, browser, n, metric, unit, samples: [] });
  samples.get(key).samples.push(value);
};
const loadedScripts = new Map();
const browserVersions = {};
const capabilities = {};
const startedAt = performance.now();

for (const browserName of BROWSERS) {
  const launch = LAUNCH[browserName];
  if (launch === undefined) {
    check(false, `unknown browser ${browserName}`);
    continue;
  }
  const browser = await launch();
  browserVersions[browserName] = browser.version();
  try {
    for (const spec of PAGES) {
      for (const n of NS[spec.workload]) {
        const tag = `${browserName.padEnd(8)} ${spec.library.padEnd(24)} ${spec.workload.padEnd(8)} n=${String(n).padStart(5)}`;
        for (let rep = 0; rep < REPS; rep += 1) {
          // --- load + pan ---
          let zoomSupported = false;
          let zoomStep = { in: 0, out: 0 };
          try {
            const { context, page, cdp, readyMs, scripts, errors } = await openPage(browser, browserName, spec, n);
            const key = `${spec.library}|${spec.workload}`;
            if (!loadedScripts.has(key)) loadedScripts.set(key, [...new Set(scripts.filter(SCRIPT_OF[spec.library]))].sort());
            add(spec.library, spec.workload, browserName, n, "first-render", "ms", readyMs);
            const counts = await page.evaluate(() => window.benchField.counts());
            add(spec.library, spec.workload, browserName, n, "dom-elements-after-load", "elements", counts.elements);
            add(spec.library, spec.workload, browserName, n, "item-nodes-after-load", "nodes", counts.itemNodes);
            add(spec.library, spec.workload, browserName, n, "visible-items-after-load", "items", counts.visibleItems);
            add(spec.library, spec.workload, browserName, n, "heap-after-load", "MB", await heap(cdp));
            check(counts.visibleItems >= (spec.workload === "timeline" ? 10 : 5), `${tag}: only ${String(counts.visibleItems)} items visible after load`);
            const zoom = await page.evaluate(() => window.benchField.zoom);
            zoomSupported = zoom.supported;
            zoomStep = { in: zoom.stepIn, out: zoom.stepOut };
            capabilities[spec.library] = { ...(capabilities[spec.library] ?? {}), wheelZoom: zoom.supported };
            const pan = await page.evaluate(() => window.benchField.pan);
            capabilities[spec.library] = { ...capabilities[spec.library], pan: pan.mode };
            await page.evaluate(() => window.benchField.frames.start());
            let mid = null;
            for (let index = 0; index < PAN.strokes; index += 1) {
              const forward = index < PAN.forward;
              if (pan.mode === "drag") await drag(page, forward ? pan.x : pan.x - PAN.distancePx, pan.y, forward ? -PAN.distancePx : PAN.distancePx);
              else await wheelStroke(page, pan.x, pan.y, forward ? PAN.distancePx : -PAN.distancePx);
              await sleep(PAN.gapMs);
              if (index === PAN.forward - 1) mid = await page.evaluate(() => window.benchField.offsetPx());
            }
            await sleep(200);
            const panFrames = frameStats(await page.evaluate(() => window.benchField.frames.stop()));
            const end = await page.evaluate(() => window.benchField.offsetPx());
            add(spec.library, spec.workload, browserName, n, "pan-missed-frames", "%", panFrames.missed);
            add(spec.library, spec.workload, browserName, n, "pan-p95-frame", "ms", panFrames.p95);
            add(spec.library, spec.workload, browserName, n, "heap-after-pan", "MB", await heap(cdp));
            const target = PAN.forward * PAN.distancePx;
            check(mid >= 0.5 * target, `${tag}: 12 strokes (${pan.mode}) moved the view ${mid.toFixed(0)} px, expected ~${String(target)}`);
            check(Math.abs(end) <= 0.25 * target, `${tag}: 24 strokes ended ${end.toFixed(0)} px from the start`);
            const edits = await page.evaluate(() => window.benchField.edits());
            check(edits === 0, `${tag}: the pan edited ${String(edits)} items`);
            check(errors.length === 0, `${tag}: page error during the pan: ${errors.join("; ")}`);
            console.log(`${tag} rep ${String(rep + 1)}: ready ${readyMs.toFixed(0)} ms, visible ${String(counts.visibleItems)}, elements ${String(counts.elements)}, pan ${pan.mode} ${mid.toFixed(0)}/${end.toFixed(0)} px missed ${panFrames.missed.toFixed(1)}% p95 ${panFrames.p95.toFixed(1)} ms`);
            await context.close();
          } catch (error) {
            check(false, `${tag} rep ${String(rep + 1)}: ${String(error.message).split("\n")[0]}`);
            continue;
          }
          // --- zoom ---
          if (!zoomSupported) continue;
          try {
            const { context, page, readyMs, errors } = await openPage(browser, browserName, spec, n);
            add(spec.library, spec.workload, browserName, n, "first-render", "ms", readyMs);
            const pan = await page.evaluate(() => window.benchField.pan);
            const at = spec.workload === "gantt" ? { x: pan.x, y: pan.y } : { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
            await page.mouse.move(at.x, at.y);
            await page.keyboard.down("Control");
            await page.evaluate(() => window.benchField.frames.start());
            let peak = 1;
            const began = performance.now();
            for (let index = 0; index < 2 * ZOOM.notches; index += 1) {
              const wait = began + index * ZOOM.intervalMs - performance.now();
              if (wait > 0) await sleep(wait);
              await page.mouse.wheel(0, index < ZOOM.notches ? -zoomStep.in : zoomStep.out);
              if (index === ZOOM.notches - 1) peak = await page.evaluate(() => window.benchField.zoomFactor());
            }
            await sleep(ZOOM.tailMs);
            const zoomFrames = frameStats(await page.evaluate(() => window.benchField.frames.stop()));
            await page.keyboard.up("Control");
            const final = await page.evaluate(() => window.benchField.zoomFactor());
            add(spec.library, spec.workload, browserName, n, "zoom-missed-frames", "%", zoomFrames.missed);
            add(spec.library, spec.workload, browserName, n, "zoom-p95-frame", "ms", zoomFrames.p95);
            add(spec.library, spec.workload, browserName, n, "zoom-peak-factor", "x", peak);
            check(peak >= 1.3, `${tag}: ctrl + wheel zoomed only ${String(peak?.toFixed?.(2) ?? peak)}x`);
            check(final > 0.8 && final < 1.25, `${tag}: the zoom did not come back (${String(final?.toFixed?.(2) ?? final)}x)`);
            const edits = await page.evaluate(() => window.benchField.edits());
            check(edits === 0, `${tag}: the zoom edited ${String(edits)} items`);
            check(errors.length === 0, `${tag}: page error during the zoom: ${errors.join("; ")}`);
            console.log(`${tag} rep ${String(rep + 1)}: zoom peak ${peak.toFixed(2)}x end ${final.toFixed(2)}x missed ${zoomFrames.missed.toFixed(1)}% p95 ${zoomFrames.p95.toFixed(1)} ms`);
            await context.close();
          } catch (error) {
            check(false, `${tag} rep ${String(rep + 1)} zoom: ${String(error.message).split("\n")[0]}`);
          }
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
server.close();

// --- bytes ---------------------------------------------------------------------------------
const gz = (text) => gzipSync(Buffer.from(text), { level: 9 }).length;
const oxc = (file, code) => {
  const out = minifySync(file, code, { compress: true, mangle: true });
  if (out.errors?.length) throw new Error(`minify ${file}: ${String(out.errors[0]?.message)}`);
  return out.code;
};
const files = {};
for (const { library, workload } of PAGES) {
  const key = `${library}|${workload}`;
  const list = loadedScripts.get(key) ?? [];
  check(list.length > 0, `${library} (${workload}): the page loaded no script of its library`);
  files[key] = list;
  let min = 0;
  let minGz = 0;
  for (const path of list) {
    const file = fileFor(path);
    const source = readFileSync(file, "utf8");
    const shipped = library === "temporeum" ? oxc(file, source) : source;
    min += Buffer.byteLength(shipped);
    minGz += gz(shipped);
  }
  add(library, workload, null, null, "js-min", "kB", min / 1000);
  add(library, workload, null, null, "js-min-gz", "kB", minGz / 1000);
}
{
  const source = readFileSync(join(bundleDist, "react-baseline.js"), "utf8");
  add("react (baseline)", null, null, null, "js-min", "kB", Buffer.byteLength(source) / 1000);
  add("react (baseline)", null, null, null, "js-min-gz", "kB", gz(source) / 1000);
}

// --- report ------------------------------------------------------------------------------------
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const pkg = (path) => JSON.parse(readFileSync(path, "utf8"));
const report = {
  generatedAt: new Date().toISOString(),
  smoke: SMOKE,
  machine: { cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, memoryGB: Math.round(totalmem() / 1e9), os: `${osVersion()} (${platform()} ${release()} ${arch()})`, node: process.version },
  browsers: browserVersions,
  settings: {
    throttle: null,
    viewport: VIEWPORT,
    repetitions: REPS,
    ns: NS,
    missedFrameDefinition: MISSED_FRAME_DEFINITION,
    readyDefinition: "navigationStart -> the rAF at which item nodes are in the box AND visible, and two consecutive rAFs have seen no DOM mutation in it",
    pan: { ...PAN, input: "the library's own: drag (mouse down, move, up) or wheel-x (horizontal wheel steps), as the page says" },
    zoom: { ...ZOOM, input: "Control held + mouse wheel at the chart's centre, the page's |deltaY| per notch in and out: one 1.2x step where the library's rule allows it (Temporeum, vis-timeline, react-calendar-timeline), one mouse notch (100) for SVAR" },
    heap: "Chromium only: CDP HeapProfiler.collectGarbage, then Performance.getMetrics JSHeapUsedSize",
    runSeconds: Math.round((performance.now() - startedAt) / 1000),
  },
  libraries: {
    temporeum: { version: pkg(join(repoRoot, "packages", "web-component", "package.json")).version },
    "vis-timeline": { version: installed("vis-timeline"), with: { "vis-data": installed("vis-data") } },
    "react-calendar-timeline": { version: installed("react-calendar-timeline"), with: { react: installed("react"), dayjs: installed("dayjs"), interactjs: installed("interactjs") } },
    "frappe-gantt": { version: installed("frappe-gantt") },
    svar: { name: "@svar-ui/react-gantt", version: installed("@svar-ui/react-gantt"), with: { react: installed("react") } },
    "react (baseline)": { version: installed("react") },
  },
  workloads: { timeline: ["temporeum", "vis-timeline", "react-calendar-timeline"], gantt: ["temporeum", "frappe-gantt", "svar"] },
  capabilities,
  files,
  ignoredPageErrors: { pattern: String(BENIGN), counts: Object.fromEntries(ignored) },
  results: [...samples.values()].map((entry) => ({ ...entry, median: median(entry.samples), min: Math.min(...entry.samples), max: Math.max(...entry.samples) })),
};
if (failures.length > 0) {
  mkdirSync(workDir, { recursive: true });
  writeFileSync(failedFile, `${JSON.stringify({ ...report, failures }, null, 2)}\n`);
  console.error(`${String(failures.length)} verification failure(s); results.json NOT written. Report: ${failedFile}`);
  process.exit(1);
}
rmSync(failedFile, { force: true });
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`results: ${outFile} (${String(report.settings.runSeconds)} s)`);
