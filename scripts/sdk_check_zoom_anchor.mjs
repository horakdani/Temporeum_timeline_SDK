#!/usr/bin/env node
/**
 * G-ANCHOR: bizonyitja, hogy a zoom a gesztus fokuszahoz van horgonyozva —
 * es hogy a mereshez hasznalt turelem tenyleg szoros.
 *
 * Ez a kapu azert kulonleges, mert itt a MERES maga a kockazat. Egy teszt,
 * ami "50 pixelen belul" allitja a horgonyt, zolden atmegy, miközben a zoom
 * erzete tonkre van: a tartalom elszokik az ujj alol. Ezert a szkript nem
 * csak az eredmenyt olvassa, hanem a turelmet is ellenorzi, statikusan is.
 *
 * Harom ellenorzes:
 *
 *  1. FUTASIDEJU: minden forgatokonyvnek zoldnek kell lennie, legalabb
 *     MIN_CASES generalt esettel, es a legnagyobb hiba a turelem alatt.
 *  2. NEM TRIVIALIS: a generalt esetek tenyleg zoomoltak BE es KI is (a
 *     span-arany szorasa), es a gesztus tenyleg mozgott. Egy keszlet, ami
 *     csak 1.0-hoz kozeli faktorokat probal, barmit atenged.
 *  3. STATIKUS: a turelem-konstans a tesztfajlban is a kuszob alatt van, az
 *     esetszam a kuszob felett, es a hibat a mag sajat skalajaval merik.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const testFile = join(corePackage, "test", "zoom-anchor", "anchor.test.ts");
const reportFile = join(corePackage, ".zoom-anchor-report.json");

const MIN_SCENARIOS = 5;
const MIN_CASES = 200;
/** Ennel nagyobb turelem mar nem bizonyit erzetet. Fel keppont a maximum. */
const MAX_TOLERANCE_PX = 0.5;
const MAX_SKIPPED_RATIO = 0.02;
/** A keszletnek be ES ki is kell zoomolnia. */
const NEEDED_ZOOM_IN = 0.5;
const NEEDED_ZOOM_OUT = 2;
const MIN_TRAVEL_PX = 10;

const failures = [];
const notes = [];

// --- 1-2. FUTASIDEJU ---------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `nincs horgony-riport (${reportFile}) — a meres NEM futott le, ezert BUKAS`,
  );
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (!Array.isArray(report) || report.length < MIN_SCENARIOS) {
    failures.push(
      `${String(Array.isArray(report) ? report.length : 0)} forgatokonyv futott, de legalabb ${String(MIN_SCENARIOS)} kell`,
    );
  }
  for (const entry of report) {
    const name = String(entry?.scenario ?? "(nevtelen)");
    if (entry?.passed !== true) {
      failures.push(`bukott forgatokonyv: ${name} — ${String(entry?.maxErrorPx)} px hiba`);
    }
    if (!Number.isInteger(entry?.cases) || entry.cases < MIN_CASES) {
      failures.push(`${name}: ${String(entry?.cases)} eset, de legalabb ${String(MIN_CASES)} kell`);
    }
    if (!Number.isFinite(entry?.tolerancePx) || entry.tolerancePx > MAX_TOLERANCE_PX) {
      failures.push(
        `${name}: ${String(entry?.tolerancePx)} px turelem — ${String(MAX_TOLERANCE_PX)} px fölött a zold pipa nem erzet, csak formasag`,
      );
    }
    if (!Number.isFinite(entry?.maxErrorPx) || entry.maxErrorPx > entry.tolerancePx) {
      failures.push(`${name}: a legnagyobb hiba (${String(entry?.maxErrorPx)} px) a turelem fölött`);
    }
    if (!Number.isFinite(entry?.seed)) {
      failures.push(`${name}: nincs seed, tehat egy bukas nem reprodukalhato`);
    }
    if (Number(entry?.skipped ?? 0) > Number(entry?.cases ?? 0) * MAX_SKIPPED_RATIO) {
      failures.push(
        `${name}: ${String(entry?.skipped)} kihagyott eset ${String(entry?.cases)}-bol — ennyi kihagyas mar a meres kikerulese`,
      );
    }
    if (!Number.isFinite(entry?.travelPxMax) || entry.travelPxMax < MIN_TRAVEL_PX) {
      failures.push(
        `${name}: a gesztus legtobb ${String(entry?.travelPxMax)} px-t mozgott — egy allo gesztuson barmi igaz`,
      );
    }
  }
  const zoomedIn = report.some((entry) => Number(entry?.spanRatioMin) <= NEEDED_ZOOM_IN);
  const zoomedOut = report.some((entry) => Number(entry?.spanRatioMax) >= NEEDED_ZOOM_OUT);
  if (!zoomedIn) {
    failures.push("egyetlen forgatokonyv sem zoomolt BE legalabb ketszeresere");
  }
  if (!zoomedOut) {
    failures.push("egyetlen forgatokonyv sem zoomolt KI legalabb a felere");
  }
  if (failures.length === 0) {
    const total = report.reduce((sum, entry) => sum + entry.cases, 0);
    const worst = Math.max(...report.map((entry) => entry.maxErrorPx));
    notes.push(
      `${String(report.length)} forgatokonyv, ${String(total)} generalt gesztus: ` +
        report.map((entry) => entry.scenario).join(", "),
    );
    notes.push(
      `a legnagyobb horgony-hiba ${worst.toExponential(2)} px, a turelem ${String(report[0].tolerancePx)} px`,
    );
  }
}

// --- 3. STATIKUS -------------------------------------------------------------

if (!existsSync(testFile)) {
  failures.push(`nincs horgony-tesztfajl: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");
  const tolerance = /const\s+TOLERANCE_PX\s*=\s*([0-9.e-]+)/.exec(source);
  const cases = /const\s+CASES\s*=\s*(\d+)/.exec(source);
  if (tolerance === null || Number(tolerance[1]) > MAX_TOLERANCE_PX) {
    failures.push(
      `a tesztfajl turelme ${String(tolerance?.[1])} px — a riport allithat barmit, a forras a dontő`,
    );
  }
  if (cases === null || Number(cases[1]) < MIN_CASES) {
    failures.push(`a tesztfajl esetszama ${String(cases?.[1])}, de legalabb ${String(MIN_CASES)} kell`);
  }
  if (!/createTimeScale/.test(source)) {
    failures.push("a hibat nem a mag createTimeScale-javal merik — helyi keplet ugyanazt a hibat tartalmazhatja");
  }
  if (!/makeRandom/.test(source)) {
    failures.push("nincs generator: kezzel valasztott pontokon a horgony konnyen igaz");
  }
}

// --- Eredmeny ----------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  HIBA ${failure}`);
  }
  console.error(`\nG-ANCHOR BUKOTT: ${String(failures.length)} hiba.`);
  process.exit(1);
}

console.log("\nG-ANCHOR atment: a fokusz alatti IDOPILLANAT a zoom utan ugyanott van.");
