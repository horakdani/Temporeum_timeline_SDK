#!/usr/bin/env node
/**
 * G-PERF-DEEP (P14): bizonyitja, hogy a 4x-es csipes (zoom-deep: 100 px-rol
 * 400 px-re es vissza, ket masodperc) is tartja a G-PERF kuszobeit — a mag
 * utjan (bench.html) ES a publikus uton (bench-public.html, createTimeline
 * a shippelt bundle-bol) —, es hogy a meres ket negativ kontrollon BUKIK.
 *
 * A kuszobok ugyanazok, mint a sdk_check_perf.mjs-ben (P7-ben rogzitve):
 *
 *   kihagyott vsync-ek aranya <= 5%, leghosszabb kepkocka <= 100 ms,
 *   a gesztus utani nyugvo kepkocka <= 100 ms
 *
 * A P13 vegen ez a forgatokonyv csak tajekoztato volt: 9-11% kihagyas, hat
 * ujrahorgonyzassal. A P14 lepcsos, fokozatos ujrahorgonyzasa ota kapu.
 *
 * Ervenyesseg — ha barmelyik serul, a check BUKIK:
 *
 *   - a riport letezik, a `deep` merese, 4x lassitassal, 10 000 elemmel;
 *   - mindket lap FRISS dist-rol futott (a mag lapja a mag, a publikus a mag
 *     ES az element forras-lenyomataval);
 *   - a gesztus elejen 1900-2200 elem TENYLEG a nezetben van;
 *   - a bemenet ossze van vonva (tobb esemeny, mint rajzolas);
 *   - a publikus "space" futas tenyleg elemterben rajzolt, az "exact" nem;
 *   - a mag lapjan a "space" futas lepcsokkel ment, a "flat" nelkuluk.
 *
 * Negativ kontrollok:
 *
 *   - elemter nelkul (exact) mindket uton BUKNIA kell — kulonben a meres nem
 *     kulonbozteti meg a jot a rossztol, vagy a lassitas nem hat;
 *   - a mag lapjan lepcsok nelkul (flat: minden ujrahorgonyzas egy
 *     kepkockaban) MERHETOEN ROSSZABB a lepcsos utnal: vagy bukik, vagy
 *     legalabb 1 szazalekponttal tobb vsync-et hagy ki — kulonben a lepcsos
 *     ujrahorgonyzas nem szamit, es a kapu nem rola szol.
 *
 * A flat kontroll a P17-ig a kuszobon bukott. A P17-ben a DOM-folto
 * karcsusitasa (csomopontonkent egy attributum-hivatkozas ket Map helyett)
 * a teljes ujrahorgonyzast is olcsobba tette: a flat ut 2,4-3,2%-on a kuszob
 * ALATT maradt, mikozben a lepcsos 0,0% volt. A kuszob-bukas feltevese
 * ezzel megdolt — egy JAVITAS buktatta volna a kaput —, ezert a kontroll
 * azt allitja, amit tenyleg bizonyitani kell: a lepcsok merhetoen jobbak.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "docs", ".bench-deep.json");

const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MAX_SETTLE_MS = 100;
const BUDGET_VISIBLE = [1900, 2200];
/** Ennyivel tobb kihagyott vsync kell a flat kontrollon, mint a lepcsos uton. */
const MIN_FLAT_PENALTY = 0.01;

const failures = [];
const notes = [];

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
  `${(run.missedVsyncShare * 100).toFixed(1)}% kihagyott vsync, leghosszabb ${run.longestFrameMs.toFixed(0)} ms, ` +
  `nyugvo ${run.settleMs.toFixed(0)} ms, ujrahorgonyzas ${String(run.reanchors ?? "-")}`;

if (!existsSync(reportFile)) {
  failures.push(`nincs meresi riport (${reportFile}) — a meres NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (report.kind !== "deep") {
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
  const find = (path, mode) => runs.find((run) => run.path === path && run.mode === mode && run.name === "zoom-deep");

  for (const [path, mode] of [
    ["core", "space"],
    ["public", "space"],
  ]) {
    const run = find(path, mode);
    if (run === undefined) {
      failures.push(`hianyzik: ${path} ${mode} zoom-deep — a nem futtathato meres BUKAS`);
      continue;
    }
    if (run.totalItems !== 10_000) {
      failures.push(`${path}: ${String(run.totalItems)} elem az adatban, nem 10 000`);
    }
    const visible = run.before?.visibleItems;
    if (!(visible >= BUDGET_VISIBLE[0] && visible <= BUDGET_VISIBLE[1])) {
      failures.push(`${path}: a bongeszo szerint ${String(visible)} elem lathato, nem ${String(BUDGET_VISIBLE[0])}-${String(BUDGET_VISIBLE[1])}`);
    }
    if (!(run.inputEvents > run.draws)) {
      failures.push(`${path}: ${String(run.inputEvents)} esemeny es ${String(run.draws)} rajzolas — a bemenet nincs osszevonva`);
    }
    if (path === "public" && run.sceneSpace !== true) {
      failures.push("public space: a createTimeline nem elemterben rajzolt — nem a konfiguracio alapjat mertuk");
    }
    if (path === "core" && run.levels !== true) {
      failures.push("core space: a mag lapja lepcsok nelkul futott — nem az ajanlott utat mertuk");
    }
    const reasons = verdict(run);
    const line = `${path === "core" ? "mag utja" : "publikus ut"}: ${String(visible)} elem — ${describe(run)}`;
    if (reasons.length > 0) {
      failures.push(`${line} — ${reasons.join("; ")}`);
    } else {
      notes.push(line);
    }
  }

  for (const [path, mode, what] of [
    ["core", "exact", "mag, elemter nelkul"],
    ["public", "exact", "publikus, elemter nelkul"],
    ["core", "flat", "mag, lepcsok nelkul"],
  ]) {
    const run = find(path, mode);
    if (run === undefined) {
      failures.push(`hianyzik a negativ kontroll: ${what} — a nem futtathato kontroll BUKAS`);
      continue;
    }
    if (path === "public" && run.sceneSpace !== false) {
      failures.push("public exact: a kontroll elemterben rajzolt — nem kontroll");
    }
    if (path === "core" && mode === "flat" && run.levels !== false) {
      failures.push("core flat: a kontroll lepcsokkel futott — nem kontroll");
    }
    if (verdict(run).length > 0) {
      notes.push(`negativ kontroll bukik, ahogy kell — ${what}: ${describe(run)}`);
      continue;
    }
    const levelled = mode === "flat" ? find("core", "space") : undefined;
    if (levelled !== undefined && run.missedVsyncShare - levelled.missedVsyncShare >= MIN_FLAT_PENALTY) {
      notes.push(
        `negativ kontroll merhetoen rosszabb, ahogy kell — ${what}: ${describe(run)}; ` +
          `a lepcsos ut ${(levelled.missedVsyncShare * 100).toFixed(1)}%`,
      );
    } else {
      failures.push(`a negativ kontroll (${what}) NEM bukik${mode === "flat" ? ", es nem is merhetoen rosszabb" : ""}: ${describe(run)} — a meres nem kulonbozteti meg, amit allit`);
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  BUKAS ${failure}`);
console.log(failures.length === 0 ? "G-PERF-DEEP: atment" : `G-PERF-DEEP: BUKOTT (${String(failures.length)} hiba)`);
process.exit(failures.length === 0 ? 0 : 1);
