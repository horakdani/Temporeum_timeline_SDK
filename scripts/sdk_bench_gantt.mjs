#!/usr/bin/env node
/**
 * The G-PERF-GANTT measurement: 10 000 tasks and 10 000 dependencies on the
 * public path (packages/docs/bench/gantt.html, the shipped dist), pan and
 * wheel zoom, with 4x CPU throttling, on fresh pages — and the same without
 * arrow culling (`?cull=0`), as the negative control.
 *
 * The pan and the zoom are the same gestures as in the vis comparison
 * measurement (sdk_bench_field.mjs): 24 drags on the axis, and Control + 8
 * notches in and 8 out every 50 ms. The verdict is sdk_check_perf_gantt.mjs's.
 */

/* global fetch, setTimeout, window */

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { sourceHash } from "../packages/core/scripts/fingerprint.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "packages", "docs");
const coreDir = join(repoRoot, "packages", "core");
const elementDir = join(repoRoot, "packages", "web-component");
const PORT = Number(process.env.TL_BENCH_GANTT_PORT ?? 41767);
const BASE = `http://127.0.0.1:${String(PORT)}`;
const VIEWPORT = { width: 1440, height: 900 };
const THROTTLE = 4;
const REPS = Number(process.env.GANTT_REPS ?? 3);
const VSYNC = 1000 / 60;
const PAN = { drags: 24, forward: 12, distancePx: 240, durationMs: 400, moveEveryMs: 16, gapMs: 100, startX: 1100 };
const ZOOM = { notches: 8, intervalMs: 50, deltaY: Math.log(1.2) / 0.004, tailMs: 300 };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const build = (dir) => {
  const file = join(dir, "dist", "build.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).source ?? null) : null;
};
const fresh = { core: build(coreDir) === sourceHash(), element: build(elementDir) === sourceHash(elementDir) };

const ROOTS = [
  ["/bench/", join(docsDir, "bench")],
  ["/core/", join(coreDir, "dist")],
  ["/element/", join(elementDir, "dist")],
];
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".map": "application/json" };
const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", BASE);
  for (const [prefix, root] of ROOTS) {
    if (pathname.startsWith(prefix)) {
      const file = resolve(join(root, pathname.slice(prefix.length)));
      if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) {
        response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
        createReadStream(file).pipe(response);
        return;
      }
    }
  }
  response.writeHead(404).end();
});
await new Promise((done, fail) => {
  server.once("error", (error) => fail(error.code === "EADDRINUSE" ? new Error(`port ${String(PORT)} is taken — we do not measure someone else's page`) : error));
  server.listen(PORT, "127.0.0.1", done);
});
const marker = await (await fetch(`${BASE}/bench/gantt.html`)).text();
if (!marker.includes('data-bench-gantt="temporeum"')) {
  server.close();
  throw new Error("something other than the Gantt benchmark page answers on the port");
}

function frameStats(deltas) {
  let lost = 0;
  for (const d of deltas) if (d > 1.5 * VSYNC) lost += Math.round(d / VSYNC) - 1;
  return {
    missedShare: deltas.length === 0 ? 1 : lost / (lost + deltas.length),
    longestFrameMs: deltas.length === 0 ? Infinity : Math.max(...deltas),
    intervals: deltas.length,
  };
}

async function openPage(browser, cull) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await page.goto(`${BASE}/bench/gantt.html${cull ? "" : "?cull=0"}`);
  await page.waitForFunction(() => window.benchGantt !== undefined, undefined, { timeout: 120_000 });
  if ((await page.evaluate(() => window.benchGantt.marker)) !== "temporeum-bench-gantt") throw new Error("not the benchmark page");
  await page.evaluate(() => window.benchGantt.ready);
  if (errors.length > 0) throw new Error(`page error: ${errors.join("; ")}`);
  return { context, page };
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

const range = (page) => page.evaluate(() => window.benchGantt.getRange());

async function panRun(browser, cull) {
  const { context, page } = await openPage(browser, cull);
  try {
    const setup = await page.evaluate(() => ({ tasks: window.benchGantt.tasks, dependencies: window.benchGantt.dependencies, cull: window.benchGantt.cull, counts: window.benchGantt.counts() }));
    const y = await page.evaluate(() => window.benchGantt.axisY());
    const r0 = await range(page);
    const msPerPx = (r0.end - r0.start) / VIEWPORT.width;
    await page.evaluate(() => window.benchGantt.frames.start());
    let mid = null;
    for (let index = 0; index < PAN.drags; index += 1) {
      const forward = index < PAN.forward;
      await drag(page, forward ? PAN.startX : PAN.startX - PAN.distancePx, y, forward ? -PAN.distancePx : PAN.distancePx);
      await sleep(PAN.gapMs);
      if (index === PAN.forward - 1) mid = await range(page);
    }
    await sleep(200);
    const frames = frameStats(await page.evaluate(() => window.benchGantt.frames.stop()));
    const r1 = await range(page);
    return {
      ...setup,
      ...frames,
      midPx: (mid.start - r0.start) / msPerPx,
      endPx: (r1.start - r0.start) / msPerPx,
      edits: await page.evaluate(() => window.benchGantt.edits()),
    };
  } finally {
    await context.close();
  }
}

async function zoomRun(browser, cull) {
  const { context, page } = await openPage(browser, cull);
  try {
    const setup = await page.evaluate(() => ({ counts: window.benchGantt.counts() }));
    const r0 = await range(page);
    const span0 = r0.end - r0.start;
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.keyboard.down("Control");
    await page.evaluate(() => window.benchGantt.frames.start());
    let peak = 1;
    const began = performance.now();
    for (let index = 0; index < 2 * ZOOM.notches; index += 1) {
      const wait = began + index * ZOOM.intervalMs - performance.now();
      if (wait > 0) await sleep(wait);
      await page.mouse.wheel(0, index < ZOOM.notches ? -ZOOM.deltaY : ZOOM.deltaY);
      if (index === ZOOM.notches - 1) {
        const r = await range(page);
        peak = span0 / (r.end - r.start);
      }
    }
    await sleep(ZOOM.tailMs);
    const frames = frameStats(await page.evaluate(() => window.benchGantt.frames.stop()));
    await page.keyboard.up("Control");
    const r1 = await range(page);
    return { ...setup, ...frames, peakFactor: peak, finalFactor: span0 / (r1.end - r1.start), edits: await page.evaluate(() => window.benchGantt.edits()) };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ channel: "chromium-headless-shell" });
const report = { kind: "gantt", browser: browser.version(), viewport: VIEWPORT, throttle: THROTTLE, repetitions: REPS, fresh, pan: PAN, zoom: ZOOM, runs: { culled: { pan: [], zoom: [] }, control: { pan: [], zoom: [] } } };
try {
  for (let rep = 0; rep < REPS; rep += 1) {
    for (const [name, cull] of [["culled", true], ["control", false]]) {
      const pan = await panRun(browser, cull);
      report.runs[name].pan.push(pan);
      const zoom = await zoomRun(browser, cull);
      report.runs[name].zoom.push(zoom);
      console.log(
        `${name} #${String(rep + 1)}: arrow nodes ${String(pan.counts.arrows)}` +
          ` | pan ${(pan.missedShare * 100).toFixed(1)}% longest ${pan.longestFrameMs.toFixed(0)} ms` +
          ` | zoom ${(zoom.missedShare * 100).toFixed(1)}% longest ${zoom.longestFrameMs.toFixed(0)} ms (peak ${zoom.peakFactor.toFixed(2)}x)`,
      );
    }
  }
} finally {
  await browser.close();
  server.close();
}

const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
report.commit = git.status === 0 ? git.stdout.trim() : null;
const out = join(docsDir, ".bench-gantt.json");
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`report: ${out}`);
