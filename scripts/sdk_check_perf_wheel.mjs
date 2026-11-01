#!/usr/bin/env node
/**
 * G-PERF-WHEEL (P15): bizonyitja, hogy a vis-osszevetes zoomja — friss,
 * csendes lapon Control + valodi gorgo, 8 lepes be es 8 ki, 50 ms-onkent,
 * lepesenkent 1,2x, 4,3x-es csucs — is tartja a G-PERF kuszobeit, a mag
 * utjan (bench.html, a README ciklusa) ES a publikus uton (bench-public.html,
 * createTimeline a shippelt bundle-bol, a vis-osszevetes lapjanak
 * beallitasaval: szerkesztes be, a surusseg alaperteke), es hogy a meres
 * harom negativ kontrollon BUKIK.
 *
 * A kuszobok ugyanazok, mint a sdk_check_perf.mjs-ben (P7-ben rogzitve):
 *
 *   kihagyott vsync-ek aranya <= 5%, leghosszabb kepkocka <= 100 ms,
 *   a gorgo-sorozat utani nyugalmi kepkocka <= 100 ms
 *
 * Minden valtozat harom friss lapon fut, es a check a MEDIANT iteli meg —
 * a kontrolloket is —, mert a felvetel egy kihagyott vsync-je 1,5%: egyetlen
 * futas a kuszob korul egy kepkocka szerencsejen mulna. A riport minden
 * futast tartalmaz, a check a legrosszabbat is kiirja.
 *
 * A P14 vegen ez a forgatokonyv a vis-osszevetesben 9,8% volt a publikus
 * uton; a README ciklusan, amely a gorgo minden lepese utan nyugalomba allt,
 * 53%.
 *
 * Ervenyesseg — ha barmelyik serul, a check BUKIK:
 *
 *   - a riport letezik, a `wheel` merese, 4x lassitassal, 10 000 elemmel,
 *     valtozatonkent legalabb harom futassal;
 *   - mindket lap FRISS dist-rol futott;
 *   - a gorgo elejen 1900-2200 elem TENYLEG a nezetben van;
 *   - mind a 16 gorgo-lepes megerkezett a laphoz, a csucs legalabb 4x, es a
 *     nezet visszaert (0,8-1,25x);
 *   - a publikus "space" futas tenyleg elemterben rajzolt, az "exact" nem;
 *   - a mag lapjan a "space" futas a gorgo-sorozattal ment, a "norun" nelkule.
 *
 * Negativ kontrollok, mindharomnak BUKNIA kell:
 *
 *   - elemter nelkul (exact) mindket uton — kulonben a meres nem kulonbozteti
 *     meg a jot a rossztol, vagy a lassitas nem hat;
 *   - a mag lapjan gorgo-sorozat nelkul (norun: a hoszt minden lepes utan
 *     nyugalomba all, ahogy a P15 elotti gep mellett) — kulonben nem a
 *     gorgo-sorozat tartja a kuszobot, es a kapu nem rola szol.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "docs", ".bench-wheel.json");

const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MAX_SETTLE_MS = 100;
const BUDGET_VISIBLE = [1900, 2200];
const MIN_REPS = 3;
const NOTCHES = 16;

const failures = [];
const notes = [];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** A futasok mediánja, mertekenkent. */
function summary(runs) {
  return {
    missedVsyncShare: median(runs.map((run) => run.missedVsyncShare)),
    longestFrameMs: median(runs.map((run) => run.longestFrameMs)),
    settleMs: median(runs.map((run) => run.settleMs)),
    all: runs.map((run) => `${(run.missedVsyncShare * 100).toFixed(1)}%`).join(" "),
  };
}

function verdict(run) {
  const reasons = [];
  if (!(run.missedVsyncShare <= MAX_MISSED_SHARE)) {
    reasons.push(`kihagyott vsync ${(run.missedVsyncShare * 100).toFixed(1)}% > ${String(MAX_MISSED_SHARE * 100)}%`);
  }
  if (!(run.longestFrameMs <= MAX_LONGEST_FRAME_MS)) {
    reasons.push(`leghosszabb kepkocka ${run.longestFrameMs.toFixed(0)} ms > ${String(MAX_LONGEST_FRAME_MS)} ms`);
  }
  if (!(run.settleMs <= MAX_SETTLE_MS)) {
    reasons.push(`nyugvo kepkocka ${run.settleMs.toFixed(0)} ms > ${String(MAX_SETTLE_MS)} ms`);
  }
  return reasons;
}

const describe = (run) =>
  `median ${(run.missedVsyncShare * 100).toFixed(1)}% kihagyott vsync (futasok: ${run.all}), ` +
  `leghosszabb ${run.longestFrameMs.toFixed(0)} ms, nyugvo ${run.settleMs.toFixed(0)} ms`;

if (!existsSync(reportFile)) {
  failures.push(`nincs meresi riport (${reportFile}) — a meres NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (report.kind !== "wheel") {
    failures.push(`a riport egy masik meres riportja (${String(report.kind)})`);
  }
  if (report.throttle !== 4) {
    failures.push(`a lassitas ${String(report.throttle)}x, nem a rogzitett 4x`);
  }
  const builds = Array.isArray(report.builds) ? report.builds : [];
  const stale = builds.filter((build) => build.actual !== build.expected);
  if (builds.length === 0 || stale.length > 0) {
    failures.push(`a bongeszo NEM a friss dist-et futtatta (${stale.map((build) => build.path).join(", ")}) — regi kod merese`);
  } else {
    notes.push(`friss dist mindket lapon (${String(builds.length)} megnyitas)`);
  }
  const runs = Array.isArray(report.runs) ? report.runs : [];
  const find = (path, mode) => runs.filter((run) => run.path === path && run.mode === mode && run.name === "zoom-wheel");

  /** A futasok ervenyessege; a hibak a `failures`-be mennek. */
  function valid(path, mode, found) {
    if (found.length < MIN_REPS) {
      failures.push(`${path} ${mode}: ${String(found.length)} futas, nem legalabb ${String(MIN_REPS)} — a nem futtathato meres BUKAS`);
      return false;
    }
    let ok = true;
    for (const run of found) {
      const where = `${path} ${mode} #${String(run.rep + 1)}`;
      if (run.totalItems !== 10_000) {
        failures.push(`${where}: ${String(run.totalItems)} elem az adatban, nem 10 000`);
        ok = false;
      }
      const visible = run.before?.visibleItems;
      if (!(visible >= BUDGET_VISIBLE[0] && visible <= BUDGET_VISIBLE[1])) {
        failures.push(`${where}: a bongeszo szerint ${String(visible)} elem lathato, nem ${String(BUDGET_VISIBLE[0])}-${String(BUDGET_VISIBLE[1])}`);
        ok = false;
      }
      if (run.inputEvents !== NOTCHES) {
        failures.push(`${where}: ${String(run.inputEvents)} gorgo-esemeny erkezett, nem ${String(NOTCHES)}`);
        ok = false;
      }
      if (!(run.peakFactor >= 4) || !(run.finalFactor > 0.8 && run.finalFactor < 1.25)) {
        failures.push(`${where}: csucs ${String(run.peakFactor)}x, vege ${String(run.finalFactor)}x — nem a rogzitett zoom`);
        ok = false;
      }
      if (path === "public" && run.sceneSpace !== (mode === "space")) {
        failures.push(`${where}: a createTimeline ${run.sceneSpace ? "" : "nem "}elemterben rajzolt — nem az, amit a valtozat allit`);
        ok = false;
      }
      if (path === "core" && run.wheelRun !== (mode !== "norun")) {
        failures.push(`${where}: a lap ${run.wheelRun ? "" : "nem "}vette gesztusnak a gorgo-sorozatot — nem az, amit a valtozat allit`);
        ok = false;
      }
      if (path === "core" && mode !== "exact" && run.levels !== true) {
        failures.push(`${where}: a mag lapja lepcsok nelkul futott — nem az ajanlott utat mertuk`);
        ok = false;
      }
    }
    return ok;
  }

  for (const [path, mode] of [
    ["core", "space"],
    ["public", "space"],
  ]) {
    const found = find(path, mode);
    if (!valid(path, mode, found)) {
      continue;
    }
    const run = summary(found);
    const reasons = verdict(run);
    const line = `${path === "core" ? "mag utja" : "publikus ut"}: ${describe(run)}`;
    if (reasons.length > 0) {
      failures.push(`${line} — ${reasons.join("; ")}`);
    } else {
      notes.push(line);
    }
  }

  for (const [path, mode, what] of [
    ["core", "exact", "mag, elemter nelkul"],
    ["public", "exact", "publikus, elemter nelkul"],
    ["core", "norun", "mag, gorgo-sorozat nelkul"],
  ]) {
    const found = find(path, mode);
    if (!valid(path, mode, found)) {
      continue;
    }
    const run = summary(found);
    if (verdict(run).length === 0) {
      failures.push(`a negativ kontroll (${what}) NEM bukik: ${describe(run)} — a meres nem kulonbozteti meg, amit allit`);
    } else {
      notes.push(`negativ kontroll bukik, ahogy kell — ${what}: ${describe(run)}`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-PERF-WHEEL: atment" : `G-PERF-WHEEL: BUKOTT (${String(failures.length)} hiba)`);
process.exit(failures.length === 0 ? 0 : 1);
