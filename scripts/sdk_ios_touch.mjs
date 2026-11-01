#!/usr/bin/env node
/**
 * A touch-action meres a valodi Mobile Safariban (P31, a G-E2E-TOUCH-WEBKIT
 * fele).
 *
 * Miert kell. A Playwright WebKitje macOS-en fut, az iOS UIKit-retege nelkul:
 * ott az erintes nem gorgeti a lapot — `touch-action: none`, `pan-y` es
 * `auto` mellett is `scrollY` 0 marad, `pointercancel` sem jon (2026-10-31,
 * mérve). Arrol tehat, hogy a `touch-action` iOS-en tenyleg megallitja-e a
 * lapgorgetest, ott semmit nem lehet megtudni: a pozitiv allitas uresen
 * menne at, es egy negativ kontroll sem bukna. Ezt csak az a WebKit tudja,
 * amelyik a gorgetest is csinalja: az iOS-szimulator Mobile Safarija.
 *
 * Hogyan. Az Xcode iOS-szimulatoraban (iPhone es iPad), a safaridriver
 * W3C WebDriveren at (fuggoseg nelkul, `fetch`-csel), `pointerType: "touch"`
 * akciokkal. A lap a SHIPPELT dist-et futtatja (`e2e/serve.mjs`, a
 * Chromium-keszlet demo lapja). Minden proba:
 *
 *  - friss safaridriver-munkamenet, friss Safari (a proba egyszer fut,
 *    ujraprobalas nincs);
 *  - a lap betoltese utan 1,5 s: az elso erintes ennel korabban
 *    nem-determinisztikusan elveszett (mérve, P31);
 *  - a lap az allapotat `sendBeacon`-nel egy gyujtonek kuldi. Ez nem
 *    kenyelem: amikor a natív gorgetes atveszi az erintest, a safaridriver a
 *    szintetikus felengedesre var, es tobbe nem valaszol (mérve: pontosan a
 *    gorgeto probakban). Az allapot ezert nem a WebDriveren jon vissza; a
 *    beragadas a proba lebontasaval er veget, es a riportba kerul.
 *
 * A probak (mindket eszkozon):
 *
 *  1. none:        fuggoleges huzas az idovonalon — a lap NEM gorog, az
 *                  idovonal pasztaz (a Chromium-keszlet "touch-action tenyleg
 *                  szól" allitasa);
 *  2. edge:        ugyanez az idovonal szelen tul folytatva — a gesztus
 *                  vegig az idovonale, a lap akkor sem gorog
 *                  (overscroll-behavior / gorgetes-elnyeles);
 *  3. cooperative: `touch-action: pan-y` — a lap gorog, es a bongeszo
 *                  ELVESZI a gesztust: valodi `pointercancel`, a gesztus
 *                  `:cancelled`-del zarul (a passziv viselkedes: a
 *                  konyvtar figyeloi nem tartjak vissza a gorgetest);
 *  5. longpress:   hosszu nyomas (700 ms) egy elemen, majd huzas — az elem
 *                  mozdul, az iOS nem veszi el (callout, nagyito,
 *                  kijeloles: nincs pointercancel), a lap nem gorog;
 *
 * Ami itt NEM merheto: a ket ujjas csipes. A safaridriver ket egyideju
 * `touch` pointer-forrasabol iOS-en egyetlen erintes lesz (mérve, P31: egy
 * pointerdown, a csipes helyett pasztazas, es a `touch-action: auto`-s
 * kontroll sem nagyitotta a lapot — a kontroll nem harapott). Hogy a csipes
 * a lap helyett az idovonalat nagyitja-e, azt valodi iOS-en senki nem merte;
 * a csipes gesztus-allitasa a Playwright WebKitben mérve.
 *  4. control:     NEGATIV KONTROLL — ugyanaz a huzas, mint az 1-ben, de a
 *                  gyokerre `touch-action: auto` kerul: a lapnak gorognie
 *                  KELL. Ha nem gorog, a meres vak, es az 1. zoldje semmit
 *                  nem bizonyit.
 *
 * Kimenet: packages/docs/.ios-touch-report.json. Az itelet a
 * `sdk_check_e2e_touch_webkit.mjs`-e; ez a szkript csak akkor lep ki nem
 * nullaval, ha a meres maga nem futhatott (nincs Xcode, szimulator,
 * safaridriver) — es akkor a riport is ezt mondja.
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

// --- az eszkozok -----------------------------------------------------------------------
let listing;
try {
  listing = JSON.parse(execFileSync("xcrun", ["simctl", "list", "-j", "devices", "available"], { encoding: "utf8" }));
  execFileSync("safaridriver", ["--version"], { encoding: "utf8" });
} catch (error) {
  fail(`nincs iOS-szimulator vagy safaridriver (Xcode kell): ${String(error).slice(0, 200)}`);
}
const runtimes = Object.keys(listing.devices)
  .filter((key) => /SimRuntime\.iOS-/.test(key) && listing.devices[key].length > 0)
  .sort((a, b) => {
    const version = (key) => key.split("iOS-")[1].split("-").map(Number);
    const [x, y] = [version(a), version(b)];
    return y[0] - x[0] || (y[1] ?? 0) - (x[1] ?? 0);
  });
if (runtimes.length === 0) fail("nincs iOS-futtatokornyezet a szimulatorban");
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
if (phone === undefined || tablet === undefined) fail(`a(z) ${report.runtime} futtatokornyezetben nincs iPhone es iPad`);

// --- a lap es a gyujto ----------------------------------------------------------------------
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
      // egy csonka beacon nem allapot
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
  // A negativ kontroll: ugyanaz, mint a "none", csak a gyoker touch-action-je auto.
  { name: "control", query: "", style: "#frame svg{touch-action:auto !important}", path: "inside" },
  // Hosszu nyomas egy elemen, majd huzas: az iOS nem veszi el (callout, nagyito,
  // kijeloles), es a lap nem gorog.
  { name: "longpress", query: "", style: "", path: "hold" },
];

/** Egy ujj W3C-akcioi. */
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
      // inside: 90 CSS-px felfele, az idovonalon belul. edge: az idovonal tetejen tul,
      // a viewport tetejeig — a gesztus nagyobbik fele mar a lap folott megy.
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
      // A felengedes csak az akcio-allapot elengedesevel jut el a laphoz (mérve).
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
        `scale ${String(final?.scale)}  gestures ${JSON.stringify(final?.gestures)}  edits ${JSON.stringify(final?.edits)}  ${result.driverHung ? "(a meghajto beragadt)" : ""}${result.error === null ? "" : ` HIBA ${result.error}`}\n`,
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
process.stdout.write(`sdk_ios_touch: ${String(report.trials.length)} proba, ${phone.name} es ${tablet.name}, ${report.runtime} — ${reportFile}\n`);
process.exit(0);
