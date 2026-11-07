#!/usr/bin/env node
/**
 * The throttled benchmark: @temporeum/timeline-element in Chromium at a 4x CPU
 * slowdown, at 1 000 and 10 000 items.
 *
 *   node scripts/sdk_bench_compare.mjs
 *   npm run bench:compare -w @temporeum/timeline-docs
 *
 * Env: BENCH_REPS (default 5) fresh pages per n x scenario.
 *
 * What it does, in order:
 *
 *  1. Builds core + element (`npm run build -w ...`), so the browser runs the
 *     shipped dist, not a stale one.
 *  2. Starts its OWN static server on 127.0.0.1:31764 (TL_BENCH_COMPARE_PORT)
 *     and refuses to run if the port is taken or answers with a page that is
 *     not ours (page marker check), so a foreign page is never measured.
 *  3. Chromium (Playwright, chromium-headless-shell), 1440 x 900, DPR 1, a
 *     fresh browser context per repetition, CDP Emulation.setCPUThrottlingRate
 *     4 set BEFORE navigation. Page: packages/docs/bench/temporeum.html.
 *
 * Scenarios, per n in {1000, 10000} x BENCH_REPS fresh pages:
 *
 *  - load page: first-render (navigationStart -> page `ready`: item nodes in
 *    the DOM and visible, then two consecutive rAFs with no DOM mutation
 *    in the container), heap after load, DOM nodes after load, then the PAN: 24 real
 *    `page.mouse` drags of 240 px on the time-axis band (12 towards later
 *    time, 12 back), each 400 ms with a move every ~16 ms, 100 ms between
 *    drags; frames recorded with rAF over the whole sequence; heap after pan.
 *  - zoom page: ctrl + real mouse wheel at the centre of the timeline,
 *    8 notches in then 8 out, 50 ms apart, the per-notch deltaY chosen so
 *    that each notch is a 1.2x step; the achieved peak factor is recorded
 *    and checked.
 *  - one unthrottled load per n, as a control that the throttle is applied
 *    (throttled first-render at n = 10000 must be > 1.5x the unthrottled one).
 *
 * Missed frame (MISSED_FRAME_DEFINITION below): with V = 1000/60 ms, an rAF
 * interval d > 1.5 V lost round(d / V) - 1 vsyncs; missed % = lost vsyncs /
 * (lost vsyncs + recorded intervals) * 100 over the recording window.
 *
 * Heap: CDP HeapProfiler.collectGarbage, then Performance.getMetrics
 * JSHeapUsedSize. DOM nodes: Performance.getMetrics `Nodes` (whole document,
 * after GC) and the element count inside the container.
 *
 * Bytes: the JS files the page actually loaded (recorded from the network,
 * checked against the expected list), each minified and gzipped (zlib level
 * 9) separately, summed. Our dist is not minified, so it is minified with oxc
 * (rolldown/utils minifySync, the only minifier in node_modules).
 *
 * Verification (exit 1, results.json NOT written, the failing report goes to
 * packages/docs/.bench-work/results.failed.json): item nodes rendered after
 * load >= 25% of the items overlapping the view; labels drawn at n = 1000;
 * the pan moved the view (+2880 px +-25% after 12 drags, back to within 25%
 * of a drag after 24); zoom peak >= 2x and back within 25%; no item edited
 * by any drag or wheel; the loaded JS is exactly the expected files; the
 * throttle control above.
 *
 * Output: packages/docs/site/benchmark/results.json
 *
 *   {
 *     generatedAt: ISO string,
 *     machine: { cpu, cores, memoryGB, os, node, chromium },
 *     settings: { throttle, viewport: {width,height}, repetitions, ns,
 *                 missedFrameDefinition, pan: {...}, zoom: {...}, readyDefinition },
 *     libraries: { temporeum: { version, coreVersion, commit, files[] } },
 *     results: [ { library, n, metric, unit, median, min, max, samples: number[] } ]
 *   }
 *
 * first-items-in-dom (ms) is the first rAF at which item nodes exist in the
 * container, visible or not.
 *
 * Metrics (unit): first-render (ms), first-items-in-dom (ms), first-render-unthrottled (ms),
 * pan-missed-frames (%), pan-p95-frame (ms), zoom-missed-frames (%),
 * zoom-p95-frame (ms), zoom-peak-factor (x), heap-after-load (MB),
 * heap-after-pan (MB), dom-nodes-after-load (nodes, CDP), container-elements
 * (elements), item-nodes-after-load (nodes), label-nodes-after-load (nodes),
 * visible-items-after-load (items), js-min-gz (kB), js-min (kB). Byte
 * metrics have n = null (independent of the data).
 * MB = 10^6 bytes, kB = 1000 bytes.
 */

// `window` only appears inside page.evaluate callbacks, which run in the browser.
/* global fetch, setTimeout, window */

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, platform, release, totalmem, arch, version as osVersion } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { gzipBytes, oxcMinify } from "./sdk_page_bytes.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "packages", "docs");
const coreDist = join(repoRoot, "packages", "core", "dist");
const elementDist = join(repoRoot, "packages", "web-component", "dist");
const benchDir = join(docsDir, "bench");
const workDir = join(docsDir, ".bench-work");
const outFile = join(docsDir, "site", "benchmark", "results.json");
const failedFile = join(workDir, "results.failed.json");

const PORT = Number(process.env.TL_BENCH_COMPARE_PORT ?? 31764);
const BASE = `http://127.0.0.1:${String(PORT)}`;
const VIEWPORT = { width: 1440, height: 900 };
const THROTTLE = 4;
const REPS = Number(process.env.BENCH_REPS ?? 5);
const NS = [1000, 10000];
const LIBRARIES = ["temporeum"];
const PAGE_OF = { temporeum: "temporeum.html" };

const VSYNC = 1000 / 60;
const MISSED_FRAME_DEFINITION =
  "V = 1000/60 ms. An rAF interval d > 1.5 V counts round(d / V) - 1 lost frames. " +
  "missed % = lost frames / (lost frames + recorded rAF intervals) x 100, over the whole recording window.";

const PAN = { drags: 24, forward: 12, distancePx: 240, durationMs: 400, moveEveryMs: 16, gapMs: 100, startX: 1100 };
/** Each ctrl+wheel notch is a 1.2x step: factor = exp(|deltaY| * 0.004) (core DEFAULT_WHEEL_ZOOM_RATE). */
const ZOOM = {
  notches: 8,
  intervalMs: 50,
  stepFactor: 1.2,
  deltaY: { temporeum: Math.log(1.2) / 0.004 },
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const failures = [];
const check = (ok, message) => {
  if (!ok) {
    failures.push(message);
    console.error(`VERIFY FAIL: ${message}`);
  }
};

// --- 1. build ------------------------------------------------------------

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`failed: ${command} ${args.join(" ")}`);
    process.exit(1);
  }
}

console.log("building @temporeum/timeline-core and @temporeum/timeline-element ...");
run("npm", ["run", "--silent", "build", "-w", "@temporeum/timeline-core", "-w", "@temporeum/timeline-element"], repoRoot);

// --- 2. own server ----------------------------------------------------------

const ROOTS = [
  ["/bench/", benchDir],
  ["/core/", coreDist],
  ["/element/", elementDist],
];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function fileFor(pathname) {
  for (const [prefix, root] of ROOTS) {
    if (pathname.startsWith(prefix)) {
      const target = resolve(join(root, pathname.slice(prefix.length)));
      return target.startsWith(root + sep) ? target : null;
    }
  }
  return null;
}

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", BASE);
  const file = fileFor(pathname);
  if (file === null) {
    response.writeHead(403).end("forbidden");
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end(`not found: ${pathname}`);
    return;
  }
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(response);
});

await new Promise((done, fail) => {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      fail(new Error(`port ${String(PORT)} is taken — not measuring someone else's page (lsof -nP -iTCP:${String(PORT)})`));
    } else fail(error);
  });
  server.listen(PORT, "127.0.0.1", done);
});

for (const library of LIBRARIES) {
  const text = await (await fetch(`${BASE}/bench/${PAGE_OF[library]}`)).text();
  if (!text.includes(`data-bench-compare="${library}"`)) {
    server.close();
    throw new Error(`${PAGE_OF[library]} on port ${String(PORT)} is not our page`);
  }
}

// --- helpers --------------------------------------------------------------

function frameStats(deltas) {
  let lost = 0;
  for (const d of deltas) if (d > 1.5 * VSYNC) lost += Math.round(d / VSYNC) - 1;
  const sorted = [...deltas].sort((a, b) => a - b);
  return {
    missed: deltas.length === 0 ? 100 : (lost / (lost + deltas.length)) * 100,
    p95: sorted.length === 0 ? Infinity : sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
    intervals: deltas.length,
  };
}

/** The same generator as the pages: how many items overlap the initial view. */
function itemsInView(n) {
  const DAY = 86_400_000;
  const START = Date.UTC(2026, 0, 1);
  const starts = [];
  for (let index = 0; index < n; index += 1) {
    starts.push(START + Math.floor(index / 60) * 10 * DAY + (index % 60) * (10 * DAY / 60));
  }
  const total = starts[starts.length - 1] + 8 * DAY - START;
  const [a, b] = [START + total * 0.2, START + total * 0.4];
  return starts.filter((s) => s + 8 * DAY > a && s < b).length;
}

async function metrics(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics: list } = await cdp.send("Performance.getMetrics");
  const get = (name) => list.find((entry) => entry.name === name)?.value ?? null;
  return { heap: get("JSHeapUsedSize"), nodes: get("Nodes") };
}

async function openPage(browser, library, n, { throttle = THROTTLE } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const scripts = [];
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.endsWith(".js") || pathname.endsWith(".mjs")) scripts.push(pathname);
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  await page.goto(`${BASE}/bench/${PAGE_OF[library]}?n=${String(n)}`);
  await page.waitForFunction(() => window.benchCompare !== undefined, undefined, { timeout: 60_000 });
  const marker = await page.evaluate(() => window.benchCompare.marker);
  if (marker !== "temporeum-bench-compare") throw new Error(`${library}: not the benchmark page`);
  const { readyMs, firstItemsMs } = await page.evaluate(() => window.benchCompare.ready);
  if (errors.length > 0) throw new Error(`${library} n=${String(n)}: page error ${errors.join("; ")}`);
  return { context, page, cdp, readyMs, firstItemsMs, scripts };
}

/** One real mouse drag: press, move by time (not by frame), release. */
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

const range = (page) => page.evaluate(() => window.benchCompare.getRange());

// --- 3. measure --------------------------------------------------------------

const browser = await chromium.launch({ channel: "chromium-headless-shell" });
const chromiumVersion = browser.version();
const samples = new Map();
const add = (library, n, metric, unit, value) => {
  const key = `${library}|${String(n)}|${metric}`;
  if (!samples.has(key)) samples.set(key, { library, n, metric, unit, samples: [] });
  samples.get(key).samples.push(value);
};
const loadedScripts = { temporeum: null };
const startedAt = performance.now();

try {
  for (const n of NS) {
    const expectedInView = itemsInView(n);
    for (const library of LIBRARIES) {
      // Throttle control: one unthrottled load.
      {
        const { context, readyMs } = await openPage(browser, library, n, { throttle: 1 });
        add(library, n, "first-render-unthrottled", "ms", readyMs);
        await context.close();
      }
      for (let rep = 0; rep < REPS; rep += 1) {
        // --- load + pan page ---
        {
          const { context, page, cdp, readyMs, firstItemsMs, scripts } = await openPage(browser, library, n);
          loadedScripts[library] ??= [...new Set(scripts)].sort();
          add(library, n, "first-render", "ms", readyMs);
          add(library, n, "first-items-in-dom", "ms", firstItemsMs);
          const loaded = await metrics(cdp);
          const counts = await page.evaluate(() => window.benchCompare.counts());
          add(library, n, "heap-after-load", "MB", loaded.heap / 1e6);
          add(library, n, "dom-nodes-after-load", "nodes", loaded.nodes);
          add(library, n, "container-elements", "elements", counts.elements);
          add(library, n, "item-nodes-after-load", "nodes", counts.itemNodes);
          add(library, n, "label-nodes-after-load", "nodes", counts.labelNodes);
          add(library, n, "visible-items-after-load", "items", counts.visibleItems);
          check(
            counts.itemNodes >= 0.25 * expectedInView,
            `${library} n=${String(n)}: ${String(counts.itemNodes)} item nodes, ${String(expectedInView)} items overlap the view`,
          );
          if (n === 1000) check(counts.labelNodes > 0, `${library} n=1000: no label nodes`);

          const y = await page.evaluate(() => window.benchCompare.axisY());
          check(y !== null && y > 0 && y < VIEWPORT.height, `${library} n=${String(n)}: no axis band to drag on (y=${String(y)})`);
          const r0 = await range(page);
          const msPerPx = (r0.end - r0.start) / VIEWPORT.width;
          await page.evaluate(() => window.benchCompare.frames.start());
          let mid = null;
          for (let index = 0; index < PAN.drags; index += 1) {
            const forward = index < PAN.forward;
            await drag(page, forward ? PAN.startX : PAN.startX - PAN.distancePx, y, forward ? -PAN.distancePx : PAN.distancePx);
            await sleep(PAN.gapMs);
            if (index === PAN.forward - 1) mid = await range(page);
          }
          await sleep(200);
          const panFrames = frameStats(await page.evaluate(() => window.benchCompare.frames.stop()));
          const r1 = await range(page);
          add(library, n, "pan-missed-frames", "%", panFrames.missed);
          add(library, n, "pan-p95-frame", "ms", panFrames.p95);
          const midPx = (mid.start - r0.start) / msPerPx;
          const endPx = (r1.start - r0.start) / msPerPx;
          const target = PAN.forward * PAN.distancePx;
          check(
            Math.abs(midPx - target) <= 0.25 * target,
            `${library} n=${String(n)}: 12 drags moved the view ${midPx.toFixed(0)} px, expected ~${String(target)}`,
          );
          check(
            Math.abs(endPx) <= 0.25 * PAN.distancePx,
            `${library} n=${String(n)}: 24 drags ended ${endPx.toFixed(0)} px away from the start`,
          );
          const after = await metrics(cdp);
          add(library, n, "heap-after-pan", "MB", after.heap / 1e6);
          const edits = await page.evaluate(() => window.benchCompare.edits());
          check(edits === 0, `${library} n=${String(n)}: the pan edited ${String(edits)} items`);
          console.log(
            `${library.padEnd(12)} n=${String(n).padStart(5)} rep ${String(rep + 1)}: ready ${readyMs.toFixed(0)} ms,` +
              ` items ${String(counts.itemNodes)} (visible ${String(counts.visibleItems)}, labels ${String(counts.labelNodes)}),` +
              ` pan ${midPx.toFixed(0)}/${endPx.toFixed(0)} px missed ${panFrames.missed.toFixed(1)}% p95 ${panFrames.p95.toFixed(1)} ms,` +
              ` heap ${(loaded.heap / 1e6).toFixed(1)} -> ${(after.heap / 1e6).toFixed(1)} MB, nodes ${String(loaded.nodes)}`,
          );
          await context.close();
        }
        // --- zoom page ---
        {
          const { context, page, readyMs, firstItemsMs } = await openPage(browser, library, n);
          add(library, n, "first-render", "ms", readyMs);
          add(library, n, "first-items-in-dom", "ms", firstItemsMs);
          const r0 = await range(page);
          const span0 = r0.end - r0.start;
          await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
          await page.keyboard.down("Control");
          await page.evaluate(() => window.benchCompare.frames.start());
          let peak = 1;
          const delta = ZOOM.deltaY[library];
          const began = performance.now();
          for (let index = 0; index < 2 * ZOOM.notches; index += 1) {
            const wait = began + index * ZOOM.intervalMs - performance.now();
            if (wait > 0) await sleep(wait);
            await page.mouse.wheel(0, index < ZOOM.notches ? -delta : delta);
            if (index === ZOOM.notches - 1) {
              const r = await range(page);
              peak = span0 / (r.end - r.start);
            }
          }
          await sleep(300);
          const zoomFrames = frameStats(await page.evaluate(() => window.benchCompare.frames.stop()));
          await page.keyboard.up("Control");
          const r1 = await range(page);
          const final = span0 / (r1.end - r1.start);
          add(library, n, "zoom-missed-frames", "%", zoomFrames.missed);
          add(library, n, "zoom-p95-frame", "ms", zoomFrames.p95);
          add(library, n, "zoom-peak-factor", "x", peak);
          check(peak >= 2, `${library} n=${String(n)}: ctrl+wheel zoomed only ${peak.toFixed(2)}x`);
          check(final > 0.8 && final < 1.25, `${library} n=${String(n)}: zoom did not come back (${final.toFixed(2)}x)`);
          const edits = await page.evaluate(() => window.benchCompare.edits());
          check(edits === 0, `${library} n=${String(n)}: the zoom edited ${String(edits)} items`);
          console.log(
            `${library.padEnd(12)} n=${String(n).padStart(5)} rep ${String(rep + 1)}: zoom peak ${peak.toFixed(2)}x end ${final.toFixed(2)}x` +
              ` missed ${zoomFrames.missed.toFixed(1)}% p95 ${zoomFrames.p95.toFixed(1)} ms (${String(zoomFrames.intervals)} frames)`,
          );
          await context.close();
        }
      }
    }
  }
} finally {
  await browser.close().catch(() => {});
  server.close();
}

// --- bytes ---------------------------------------------------------------------

const EXPECTED_SCRIPTS = {
  // The core's code lives in the internal chunks/index chunk; index.mjs and
  // dom.mjs import from there (packages/core/scripts/build-config.mjs).
  // The element does not import /calendar: the calendar view is the element's
  // own subpath (@temporeum/timeline-element/calendar). Nor /gantt, /resources
  // or /export: those are the element's plugins
  // (@temporeum/timeline-element/gantt, /resources, /export), and a plain
  // timeline page does not load them. Nor /groups, /items, /tools or /intl:
  // those are plugins too; instead it loads /live (live data) and /words (the
  // English words).
  temporeum: [
    "/core/chunks/index.mjs",
    "/core/dom.mjs",
    "/core/index.mjs",
    "/core/live.mjs",
    "/core/words.mjs",
    "/element/element.shared.mjs",
    "/element/index.mjs",
  ],
};
const kB = (bytes) => bytes / 1000;
// The same measurement the numbers check repeats on the current build (X9).
const gz = gzipBytes;
const oxc = oxcMinify;
for (const library of LIBRARIES) {
  const got = loadedScripts[library] ?? [];
  check(
    JSON.stringify(got) === JSON.stringify(EXPECTED_SCRIPTS[library]),
    `${library}: the page loaded ${JSON.stringify(got)}, expected ${JSON.stringify(EXPECTED_SCRIPTS[library])}`,
  );
  let min = 0;
  let minGz = 0;
  for (const path of EXPECTED_SCRIPTS[library]) {
    const file = fileFor(path);
    // The dist ships unminified: "as loaded, minified" is the oxc output.
    const shipped = oxc(file, readFileSync(file, "utf8"));
    min += Buffer.byteLength(shipped);
    minGz += gz(shipped);
  }
  add(library, null, "js-min", "kB", kB(min));
  add(library, null, "js-min-gz", "kB", kB(minGz));
  console.log(`${library}: JS ${kB(min).toFixed(1)} kB min, ${kB(minGz).toFixed(1)} kB min+gz`);
}

// Throttle control: the slowdown must show in the numbers.
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
// Only at n = 10000: at n = 1000 our first render is ~100 ms, of which the
// fixed frame waits of the ready rule are a third, so the ratio says little.
for (const library of LIBRARIES) {
  for (const n of [10000]) {
    const throttled = median(samples.get(`${library}|${String(n)}|first-render`).samples);
    const free = median(samples.get(`${library}|${String(n)}|first-render-unthrottled`).samples);
    check(throttled > 1.5 * free, `${library} n=${String(n)}: throttled first render ${throttled.toFixed(0)} ms vs unthrottled ${free.toFixed(0)} ms — is the throttle applied?`);
  }
}

// --- report ---------------------------------------------------------------------

const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
const pkg = (path) => JSON.parse(readFileSync(path, "utf8"));
const report = {
  generatedAt: new Date().toISOString(),
  machine: {
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    memoryGB: Math.round(totalmem() / 1e9),
    os: `${osVersion()} (${platform()} ${release()} ${arch()})`,
    node: process.version,
    chromium: chromiumVersion,
  },
  settings: {
    throttle: THROTTLE,
    viewport: VIEWPORT,
    repetitions: REPS,
    ns: NS,
    missedFrameDefinition: MISSED_FRAME_DEFINITION,
    firstItemsDefinition: "navigationStart -> the first rAF at which item nodes exist in the container, visible or not",
    readyDefinition:
      "navigationStart (performance.now() in the page) -> the rAF at which item nodes are in the container AND visible (checkVisibility), and two consecutive rAFs have seen no DOM mutation in it",
    pan: { ...PAN, input: "page.mouse down/move/up on the time-axis band; frames recorded over all 24 drags and the gaps" },
    zoom: { ...ZOOM, input: "Control held + page.mouse.wheel at the centre of the timeline" },
    runSeconds: Math.round((performance.now() - startedAt) / 1000),
  },
  libraries: {
    temporeum: {
      version: pkg(join(repoRoot, "packages", "web-component", "package.json")).version,
      coreVersion: pkg(join(repoRoot, "packages", "core", "package.json")).version,
      commit: git.status === 0 ? git.stdout.trim() : null,
      files: EXPECTED_SCRIPTS.temporeum,
    },
  },
  results: [...samples.values()].map((entry) => ({
    library: entry.library,
    n: entry.n,
    metric: entry.metric,
    unit: entry.unit,
    median: median(entry.samples),
    min: Math.min(...entry.samples),
    max: Math.max(...entry.samples),
    samples: entry.samples,
  })),
};

if (failures.length > 0) {
  writeFileSync(failedFile, `${JSON.stringify({ ...report, failures }, null, 2)}\n`);
  console.error(`${String(failures.length)} verification failure(s); results.json NOT written. Report: ${failedFile}`);
  process.exit(1);
}
rmSync(failedFile, { force: true });
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`results: ${outFile} (${String(report.settings.runSeconds)} s)`);
