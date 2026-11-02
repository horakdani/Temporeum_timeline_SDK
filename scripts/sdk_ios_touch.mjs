#!/usr/bin/env node
/**
 * The touch-action measurement in real Mobile Safari (half of the
 * G-E2E-TOUCH-WEBKIT check).
 *
 * Why it is needed. Playwright's WebKit runs on macOS, without iOS's UIKit
 * layer: there a touch does not scroll the page — with `touch-action: none`,
 * `pan-y` and `auto` alike, `scrollY` stays 0, and no `pointercancel` arrives
 * either (measured, 2026-10-31). So nothing can be learned there about whether
 * `touch-action` really stops page scrolling on iOS: the positive claim would
 * pass vacuously, and no negative control would fail. Only the WebKit that
 * also does the scrolling can tell: the iOS simulator's Mobile Safari.
 *
 * How. In Xcode's iOS simulator (iPhone and iPad), over safaridriver's W3C
 * WebDriver (no dependencies, with `fetch`), with `pointerType: "touch"`
 * actions. The page runs the SHIPPED dist (`e2e/serve.mjs`, the Chromium
 * suite's demo page). Every trial:
 *
 *  - a fresh safaridriver session, a fresh Safari (each trial runs once,
 *    there are no retries);
 *  - 1.5 s after the page loads: a first touch earlier than that was lost
 *    non-deterministically (measured);
 *  - the page sends its state to a collector with `sendBeacon`. This is not
 *    a convenience: when native scrolling takes over the touch, safaridriver
 *    waits for the synthetic release and never answers again (measured:
 *    exactly in the scrolling trials). So the state does not come back over
 *    WebDriver; a hang ends when the trial is torn down, and it goes into
 *    the report.
 *
 * The trials (on both devices):
 *
 *  1. none:        a vertical drag on the timeline — the page does NOT
 *                  scroll, the timeline pans (the Chromium suite's
 *                  "touch-action really applies" claim);
 *  2. edge:        the same, continued past the timeline's edge — the
 *                  gesture belongs to the timeline throughout, and the page
 *                  does not scroll then either (overscroll-behavior /
 *                  scroll swallowing);
 *  3. cooperative: `touch-action: pan-y` — the page scrolls, and the browser
 *                  TAKES the gesture: a real `pointercancel`, and the gesture
 *                  ends with `:cancelled` (the passive behaviour: the
 *                  library's listeners do not hold back scrolling);
 *  5. longpress:   a long press (700 ms) on an item, then a drag — the item
 *                  moves, iOS does not take it (callout, magnifier,
 *                  selection: no pointercancel), and the page does not scroll;
 *
 * What CANNOT be measured here: the two-finger pinch. On iOS, safaridriver
 * turns two simultaneous `touch` pointer sources into a single touch
 * (measured: one pointerdown, a pan instead of a pinch, and the control with
 * `touch-action: auto` did not zoom the page either — the control did not
 * bite). Whether a pinch zooms the timeline instead of the page has not been
 * measured on real iOS; the pinch gesture claim is measured in Playwright's WebKit.
 *  4. control:     NEGATIVE CONTROL — the same drag as in 1, but the root
 *                  gets `touch-action: auto`: the page MUST scroll. If it
 *                  does not, the measurement is blind, and the green of 1
 *                  proves nothing.
 *
 * Output: packages/docs/.ios-touch-report.json. The verdict is
 * `sdk_check_e2e_touch_webkit.mjs`'s; this script exits non-zero only if the
 * measurement itself could not run (no Xcode, simulator or safaridriver) —
 * and then the report says so too.
 */

/* global setTimeout, fetch, AbortSignal */
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repo, "packages", "docs");
const reportFile = join(docs, ".ios-touch-report.json");
const PAGE_PORT = 41739;
const BEACON_PORT = 41740;
const DRIVER_PORT = 41741;
const SETTLE_MS = 1500;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const report = { startedAt: new Date().toISOString(), runtime: null, devices: [], trials: [], error: null };
const save = () => writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

function fail(message) {
  report.error = message;
  save();
  process.stderr.write(`sdk_ios_touch: ${message}\n`);
  process.exit(1);
}

// --- the devices -----------------------------------------------------------------------
let listing;
try {
  listing = JSON.parse(execFileSync("xcrun", ["simctl", "list", "-j", "devices", "available"], { encoding: "utf8" }));
  execFileSync("safaridriver", ["--version"], { encoding: "utf8" });
} catch (error) {
  fail(`no iOS simulator or safaridriver (Xcode is required): ${String(error).slice(0, 200)}`);
}
const runtimes = Object.keys(listing.devices)
  .filter((key) => /SimRuntime\.iOS-/.test(key) && listing.devices[key].length > 0)
  .sort((a, b) => {
    const version = (key) => key.split("iOS-")[1].split("-").map(Number);
    const [x, y] = [version(a), version(b)];
    return y[0] - x[0] || (y[1] ?? 0) - (x[1] ?? 0);
  });
if (runtimes.length === 0) fail("no iOS runtime in the simulator");
const runtime = runtimes[0];
report.runtime = runtime.split(".").pop();
const pool = listing.devices[runtime];
const pick = (patterns) => {
  for (const pattern of patterns) {
    const found = pool.find((device) => pattern.test(device.name));
    if (found !== undefined) return found;
  }
  return undefined;
};
const phone = pick([/^iPhone \d+$/, /^iPhone/]);
const tablet = pick([/^iPad Pro 11/, /^iPad Air 11/, /^iPad/]);
if (phone === undefined || tablet === undefined) fail(`the ${report.runtime} runtime has no iPhone and iPad`);

// --- the page and the collector -------------------------------------------------------------
const pageServer = spawn(process.execPath, [join(docs, "e2e", "serve.mjs")], {
  cwd: docs,
  env: { ...process.env, TL_E2E_PORT: String(PAGE_PORT) },
  stdio: "ignore",
});
const beacons = new Map();
const collector = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const trial = request.url?.split("/").pop() ?? "";
    try {
      const snapshot = JSON.parse(body);
      const previous = beacons.get(trial);
      if (previous === undefined || snapshot.t >= previous.t) beacons.set(trial, snapshot);
    } catch {
      // a truncated beacon is not a state
    }
    response.writeHead(204, { "access-control-allow-origin": "*" });
    response.end();
  });
});
await new Promise((done) => collector.listen(BEACON_PORT, "127.0.0.1", done));

let driver;
const booted = [];
function cleanup() {
  try {
    driver?.kill("SIGTERM");
  } catch {
    // best effort: the process or the page may already be gone
  }
  pageServer.kill("SIGTERM");
  collector.close();
  for (const udid of booted) {
    try {
      execFileSync("xcrun", ["simctl", "shutdown", udid], { stdio: "ignore" });
    } catch {
    // best effort: the process or the page may already be gone
  }
  }
}
process.on("exit", cleanup);

for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${String(PAGE_PORT)}/index.html`)).ok) break;
  } catch {
    // best effort: the process or the page may already be gone
  }
  await sleep(100);
}

// --- WebDriver -------------------------------------------------------------------------------
const DRIVER = `http://127.0.0.1:${String(DRIVER_PORT)}`;
async function request(method, path, body, ms) {
  const response = await fetch(`${DRIVER}${path}`, {
    method,
    signal: AbortSignal.timeout(ms),
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(json.value ?? json).slice(0, 300));
  return json.value;
}

async function freshSession(device) {
  try {
    driver?.kill("SIGTERM");
  } catch {
    // best effort: the process or the page may already be gone
  }
  try {
    execFileSync("xcrun", ["simctl", "terminate", device.udid, "com.apple.mobilesafari"], { stdio: "ignore" });
  } catch {
    // best effort: the process or the page may already be gone
  }
  await sleep(300);
  driver = spawn("safaridriver", ["-p", String(DRIVER_PORT)], { stdio: "ignore" });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await request("GET", "/status", undefined, 1000);
      break;
    } catch {
      await sleep(100);
    }
  }
  const session = await request(
    "POST",
    "/session",
    { capabilities: { alwaysMatch: { browserName: "Safari", platformName: "iOS", "safari:useSimulator": true, "safari:deviceUDID": device.udid } } },
    120_000,
  );
  return { id: session.sessionId, version: session.capabilities.browserVersion };
}

const REPORTER = `
const [url] = arguments;
window.__tlr = { log: [], scrolled: false };
const snap = () => {
  let state = {};
  try { state = JSON.parse(document.querySelector("#state").textContent); } catch (error) {}
  navigator.sendBeacon(url, JSON.stringify({
    t: performance.now(),
    scrollY: window.scrollY,
    scale: window.visualViewport ? window.visualViewport.scale : null,
    log: window.__tlr.log,
    gestures: state.gestures ?? null,
    edits: state.edits ?? null,
    spanDays: state.spanDays ?? null,
    days: state.days ?? null,
    open: document.querySelector("#frame").hasAttribute("data-tl-gesture") || document.querySelector("#frame").hasAttribute("data-tl-edit"),
  }));
};
for (const type of ["pointerdown", "pointerup", "pointercancel"]) {
  window.addEventListener(type, (event) => { window.__tlr.log.push(type + ":" + event.pointerType + ":" + event.isTrusted); snap(); }, { capture: true, passive: true });
}
window.addEventListener("scroll", () => { if (!window.__tlr.scrolled) { window.__tlr.scrolled = true; window.__tlr.log.push("scroll"); } }, { passive: true });
setInterval(snap, 150);
snap();
const svg = document.querySelector("#frame svg");
const box = svg.getBoundingClientRect();
return { touchAction: getComputedStyle(svg).touchAction, item: window.tl.boxOf("d", 0.5), top: box.top, left: box.left, width: box.width, height: box.height, innerHeight: window.innerHeight, scrollHeight: document.documentElement.scrollHeight };
`;

const TRIALS = [
  { name: "none", query: "", style: "", path: "inside" },
  { name: "edge", query: "", style: "", path: "edge" },
  { name: "cooperative", query: "?touchAction=cooperative", style: "", path: "inside" },
  // The negative control: the same as "none", except the root's touch-action is auto.
  { name: "control", query: "", style: "#frame svg{touch-action:auto !important}", path: "inside" },
  // A long press on an item, then a drag: iOS does not take it (callout,
  // magnifier, selection), and the page does not scroll.
  { name: "longpress", query: "", style: "", path: "hold" },
];

/** One finger's W3C actions. */
function finger(id, from, to, steps, hold) {
  return {
    type: "pointer",
    id,
    parameters: { pointerType: "touch" },
    actions: [
      { type: "pointerMove", x: Math.round(from.x), y: Math.round(from.y), duration: 0 },
      { type: "pointerDown", button: 0 },
      ...(hold > 0 ? [{ type: "pause", duration: hold }] : []),
      ...Array.from({ length: steps }, (_, index) => ({
        type: "pointerMove",
        x: Math.round(from.x + ((to.x - from.x) * (index + 1)) / steps),
        y: Math.round(from.y + ((to.y - from.y) * (index + 1)) / steps),
        duration: 60,
      })),
      { type: "pointerUp", button: 0 },
    ],
  };
}

async function runTrial(device, trial) {
  const id = `${device.kind}-${trial.name}`;
  const result = { id, device: device.name, kind: device.kind, trial: trial.name, safari: null, setup: null, actionsMs: null, driverHung: false, final: null, error: null };
  try {
    const session = await freshSession(device);
    result.safari = session.version;
    const at = (path) => `/session/${session.id}${path}`;
    await request("POST", at("/url"), { url: `http://127.0.0.1:${String(PAGE_PORT)}/index.html${trial.query}` }, 30_000);
    await request("POST", at("/execute/sync"), { script: "return new Promise((done) => { const wait = () => ('tl' in window ? done(1) : setTimeout(wait, 50)); wait(); })", args: [] }, 15_000);
    if (trial.style !== "") {
      await request("POST", at("/execute/sync"), { script: "const style = document.createElement('style'); style.textContent = arguments[0]; document.head.append(style); return 1", args: [trial.style] }, 10_000);
    }
    const setup = await request("POST", at("/execute/sync"), { script: REPORTER, args: [`http://127.0.0.1:${String(BEACON_PORT)}/beacon/${id}`] }, 10_000);
    result.setup = setup;
    await sleep(SETTLE_MS);
    const x = Math.round(setup.left + setup.width / 2);
    const from = Math.round(setup.top + setup.height * 0.85);
    let actions;
    if (trial.path === "hold") {
      const item = setup.item;
      actions = [finger("finger", item, { x: item.x + 70, y: item.y }, 6, 700)];
    } else {
      // inside: 90 CSS px upwards, within the timeline. edge: past the top of the
      // timeline, up to the top of the viewport — most of the gesture goes over the page.
      const to = trial.path === "edge" ? 2 : from - 90;
      actions = [finger("finger", { x, y: from }, { x, y: to }, 6, 0)];
    }
    const started = Date.now();
    try {
      await request(
        "POST",
        at("/actions"),
        { actions },
        20_000,
      );
      result.actionsMs = Date.now() - started;
      // The release reaches the page only when the action state is released (measured).
      await request("DELETE", at("/actions"), undefined, 8_000);
    } catch (error) {
      result.driverHung = true;
      result.driverError = String(error).slice(0, 160);
    }
    await sleep(1500);
  } catch (error) {
    result.error = String(error).slice(0, 300);
  }
  result.final = beacons.get(id) ?? null;
  return result;
}

for (const [kind, device] of [["iphone", phone], ["ipad", tablet]]) {
  device.kind = kind;
  if (device.state !== "Booted") {
    execFileSync("xcrun", ["simctl", "boot", device.udid]);
    booted.push(device.udid);
  }
  execFileSync("xcrun", ["simctl", "bootstatus", device.udid, "-b"], { stdio: "ignore" });
  for (const [domain, key] of [["com.apple.mobilesafari", "WebKitRemoteAutomationEnabled"], ["com.apple.mobilesafari", "RemoteAutomationEnabled"], ["com.apple.WebInspector", "RemoteAutomationEnabled"]]) {
    execFileSync("xcrun", ["simctl", "spawn", device.udid, "defaults", "write", domain, key, "-bool", "YES"]);
  }
  report.devices.push({ kind, name: device.name, udid: device.udid });
  for (const trial of TRIALS) {
    const result = await runTrial(device, trial);
    report.trials.push(result);
    save();
    const final = result.final;
    process.stdout.write(
      `  ${result.id.padEnd(20)} touch-action ${String(result.setup?.touchAction)}  scrollY ${String(final?.scrollY)}  ` +
        `scale ${String(final?.scale)}  gestures ${JSON.stringify(final?.gestures)}  edits ${JSON.stringify(final?.edits)}  ${result.driverHung ? "(the driver hung)" : ""}${result.error === null ? "" : ` ERROR ${result.error}`}\n`,
    );
  }
  try {
    driver?.kill("SIGTERM");
  } catch {
    // best effort: the process or the page may already be gone
  }
  try {
    execFileSync("xcrun", ["simctl", "terminate", device.udid, "com.apple.mobilesafari"], { stdio: "ignore" });
  } catch {
    // best effort: the process or the page may already be gone
  }
}

report.finishedAt = new Date().toISOString();
save();
process.stdout.write(`sdk_ios_touch: ${String(report.trials.length)} trials, ${phone.name} and ${tablet.name}, ${report.runtime} — ${reportFile}\n`);
process.exit(0);
