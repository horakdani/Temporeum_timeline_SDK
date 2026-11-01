#!/usr/bin/env node
/**
 * G-PERF: bizonyitja, hogy 60 fps tarthato 2000 lathato elemmel a 10 000-bol
 * — MERVE, igazi Chromiumban, 4x CPU-lassitassal —, es hogy a meres a kuszob
 * alatt BUKIK.
 *
 * A meres a sdk_bench.mjs riportja (packages/core/.bench-perf.json). A
 * kuszobok ITT vannak, egy helyen, es a state.json P7-es donteseiben a
 * benchmark megirasa ELOTT rogzitve:
 *
 *   gesztusonkent a kihagyott vsync-ek aranya <= 5%   (effektiv >= 57 fps)
 *   a leghosszabb kepkocka                    <= 100 ms
 *   a gesztus utani nyugvo kepkocka           <= 100 ms (RAIL)
 *
 * Harom forgatokonyv, mind a harom kotelezo: pasztazas a keretnel, 2x-es
 * csipesz-zoom a keret pontjarol, es pasztazas a 2x-es nezetben, ahol ~1000
 * elemhez ~1000 cimke tartozik. A "2000 lathato elem" olvasata: BARMELY
 * nezet legfeljebb 2000 lathato elemmel — nem csak az, amelyiken a cimkek
 * nem ferenek ki.
 *
 * Ervenyessegi feltetelek — ha barmelyik serul, a meres nem bizonyit semmit,
 * es a check BUKIK, akarmilyen szamokat mutat:
 *
 *   - a riport letezik, es FRISS dist-rol szol (forras-lenyomat egyezik);
 *   - a lassitas 4x, es 10 000 elem van az adatban;
 *   - a keretnel a bongeszo szerint 1900-2200 elem TENYLEG a nezetben van;
 *   - a cimkes nezetben legalabb 500 cimke latszik (kulonben nem cimkes);
 *   - a bemenet tenyleg ossze van vonva: tobb esemeny jott, mint rajzolas;
 *   - a NEGATIV KONTROLL (elemter nelkul) a keretnel BUKIK. Ha atmenne, a
 *     meres nem kulonboztetne meg a jot a rossztol — vagy a lassitas nem hat.
 *
 * `node scripts/sdk_check_perf.mjs public` — G-PERF-PUBLIC (P13): UGYANEZEK a
 * kuszobok es feltetelek a publikus ut riportjara (packages/docs/
 * .bench-public.json, a bench-public.html lapon: createTimeline a shippelt
 * element-bundle-bol). Ott meg ket feltetel: a riport tenyleg a publikus
 * merese (kind), es a "space" futas tenyleg elemterben rajzolt, az "exact"
 * nem — kulonben a konfiguracio alapja helyett mast mernenk.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = process.argv[2] === "public";
const GATE = PUBLIC ? "G-PERF-PUBLIC" : "G-PERF";
const reportFile = PUBLIC ? join(repoRoot, "packages", "docs", ".bench-public.json") : join(repoRoot, "packages", "core", ".bench-perf.json");

const MAX_MISSED_SHARE = 0.05;
const MAX_LONGEST_FRAME_MS = 100;
const MAX_SETTLE_MS = 100;
const BUDGET_VISIBLE = [1900, 2200];
const MIN_LABELS_IN_LABELLED_VIEW = 500;
const REQUIRED = ["pan", "zoom", "pan-labelled"];

const failures = [];
const notes = [];

function verdict(run) {
  const reasons = [];
  if (!(run.missedVsyncShare <= MAX_MISSED_SHARE)) {
    reasons.push(
      `kihagyott vsync ${(run.missedVsyncShare * 100).toFixed(1)}% > ${String(MAX_MISSED_SHARE * 100)}% (${run.effectiveFps.toFixed(1)} fps)`,
    );
  }
  if (!(run.longestFrameMs <= MAX_LONGEST_FRAME_MS)) {
    reasons.push(`leghosszabb kepkocka ${run.longestFrameMs.toFixed(0)} ms > ${String(MAX_LONGEST_FRAME_MS)} ms`);
  }
  if (!(run.settleMs <= MAX_SETTLE_MS)) {
    reasons.push(`nyugvo kepkocka ${run.settleMs.toFixed(0)} ms > ${String(MAX_SETTLE_MS)} ms`);
  }
  return reasons;
}

if (!existsSync(reportFile)) {
  failures.push(`nincs meresi riport (${reportFile}) — a meres NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  // --- ervenyesseg --------------------------------------------------------
  if (report.kind !== (PUBLIC ? "public" : "perf")) {
    failures.push(`a riport egy masik meres riportja (${String(report.kind)}) — nem ezt az utat meri`);
  }
  if (PUBLIC) {
    for (const run of Array.isArray(report.runs) ? report.runs : []) {
      if (run.sceneSpace !== (run.mode === "space")) {
        failures.push(
          `${String(run.mode)} ${String(run.name)}: a createTimeline ${run.sceneSpace ? "elemterben" : "elemter nelkul"} rajzolt — ` +
            "nem az, amit a forgatokonyv mer",
        );
      }
    }
  }
  if (report.throttle !== 4) {
    failures.push(`a lassitas ${String(report.throttle)}x, nem a rogzitett 4x`);
  }
  const stale = (report.builds ?? []).filter((source) => source !== report.expectedSource);
  if ((report.builds ?? []).length === 0 || stale.length > 0) {
    failures.push(
      "a bongeszo NEM a friss dist-et futtatta (a dist/build.json lenyomata elter a forrasetol) — regi kod merese",
    );
  } else {
    notes.push(`friss dist: ${String(report.expectedSource).slice(0, 12)}…`);
  }
  const runs = Array.isArray(report.runs) ? report.runs : [];
  const find = (mode, name) => runs.find((run) => run.mode === mode && run.name === name);

  for (const name of REQUIRED) {
    const run = find("space", name);
    if (run === undefined) {
      failures.push(`hianyzik a forgatokonyv: ${name} — a nem futtathato meres BUKAS`);
      continue;
    }
    if (run.totalItems !== 10_000) {
      failures.push(`${name}: ${String(run.totalItems)} elem az adatban, nem 10 000`);
    }
    const visible = run.before?.visibleItems;
    if (name === "pan-labelled") {
      if (!(visible <= BUDGET_VISIBLE[1])) {
        failures.push(`${name}: ${String(visible)} lathato elem — a keret folott, nem ervenyes`);
      }
      if (!(run.before?.visibleLabels >= MIN_LABELS_IN_LABELLED_VIEW)) {
        failures.push(
          `${name}: csak ${String(run.before?.visibleLabels)} cimke latszik — ez nem a cimkes nezet, a meres ervenytelen`,
        );
      }
    } else if (!(visible >= BUDGET_VISIBLE[0] && visible <= BUDGET_VISIBLE[1])) {
      failures.push(
        `${name}: a bongeszo szerint ${String(visible)} elem lathato, nem ${String(BUDGET_VISIBLE[0])}-${String(BUDGET_VISIBLE[1])}`,
      );
    }
    if (!(run.inputEvents > run.draws)) {
      failures.push(
        `${name}: ${String(run.inputEvents)} esemeny es ${String(run.draws)} rajzolas — a bemenet nincs osszevonva kepkockankent`,
      );
    }
    // --- az itelet ---------------------------------------------------------
    const reasons = verdict(run);
    const line =
      `${name}: ${String(visible)} elem, ${String(run.before?.visibleLabels)} cimke — ` +
      `${(run.missedVsyncShare * 100).toFixed(1)}% kihagyott vsync, ${run.effectiveFps.toFixed(1)} fps, ` +
      `leghosszabb ${run.longestFrameMs.toFixed(0)} ms, nyugvo ${run.settleMs.toFixed(0)} ms, ` +
      `ujrahorgonyzas ${String(run.reanchors ?? "-")}`;
    if (reasons.length > 0) {
      failures.push(`${line} — ${reasons.join("; ")}`);
    } else {
      notes.push(line);
    }
  }

  // --- tajekoztatas, itelet nelkul ----------------------------------------
  const INFORMATIVE = { "zoom-deep": "4x-es csipesz", "pan-long": "hosszu pasztazas (4 x 1200 px)" };
  for (const [name, title] of Object.entries(INFORMATIVE)) {
    for (const mode of ["space", "exact"]) {
      const run = find(mode, name);
      if (run !== undefined) {
        notes.push(
          `tajekoztato, nem kapu — ${mode === "space" ? "terrel" : "ter nelkul"} ${title}: ` +
            `${(run.missedVsyncShare * 100).toFixed(1)}% kihagyott vsync, leghosszabb ${run.longestFrameMs.toFixed(0)} ms, ` +
            `nyugvo ${run.settleMs.toFixed(0)} ms, ujrahorgonyzas ${String(run.reanchors ?? "-")}`,
        );
      }
    }
  }

  // --- a negativ kontroll -------------------------------------------------
  const control = find("exact", "pan");
  if (control === undefined) {
    failures.push("hianyzik a negativ kontroll (elemter nelkuli pasztazas) — a meres erzekenysege bizonyitatlan");
  } else if (verdict(control).length === 0) {
    failures.push(
      `a negativ kontroll ATMENT (${(control.missedVsyncShare * 100).toFixed(1)}% kihagyas elemter nelkul) — ` +
        "a meres nem kulonbozteti meg a jot a rossztol, vagy a lassitas nem hat",
    );
  } else {
    notes.push(
      `negativ kontroll bukik, ahogy kell: elemter nelkul ${(control.missedVsyncShare * 100).toFixed(1)}% kihagyas`,
    );
  }
}

for (const note of notes) {
  console.log(`  ok    ${note}`);
}
for (const failure of failures) {
  console.log(`  BUKAS ${failure}`);
}
if (failures.length > 0) {
  console.log(`${GATE}: BUKOTT (${String(failures.length)} hiba)`);
  process.exit(1);
}
console.log(`${GATE}: atment`);
