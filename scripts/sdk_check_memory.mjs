#!/usr/bin/env node
/**
 * G-MEMORY: bizonyitja, hogy hosszu pasztazas utan a csomopontszam nem no
 * monoton — vagyis hogy a pool TENYLEG ujrahasznosit, es nem csak letezik.
 *
 * A meres a sdk_bench.mjs riportja (packages/core/.bench-memory.json): 24
 * huzas igazi Chromiumban, az adat ~4 nezetnyi szelessegen at, huzasonkent a
 * foltozo szamlaloival ES a bongeszo sajat szamlaloival (CDP Performance
 * "Nodes", szemetgyujtes utan). Ket fuggetlen forras, mert a foltozo
 * szamlaloja a foltozo allitasa onmagarol — a CDP nem az.
 *
 * Kriteriumok:
 *
 *  1. A pool melegedese utan (a pasztazas masodik fele) gyakorlatilag nem
 *     jon letre uj csomopont: a novekmeny <= az elo DOM 0.5%-a — plusz
 *     annyi, amennyivel az elo cimke-csomopontok szama a masodik felben
 *     nott. (P14: a csempe-hataron atlogo cimke azota nem esik el, es a
 *     pasztazas az adat ritka vegen 0-rol 48 cimkere er. Azt a pool nem
 *     adhatja vissza: addig egyetlen cimke sem volt elengedve, egy rect-et
 *     pedig nem lehet szovegge tenni. A kriterium eddig minden letrehozast
 *     a poolnak rott fel, a novo elo halmazet is.)
 *  2. Az elo DOM es a CDP Nodes nem no a tavolsaggal: az utolso harmad
 *     maximuma <= az elso harmad maximuma x 1.05 (DOM) / x 1.10 (CDP, mert
 *     a poolban levo, lecsatolt csomopontokat is szamolja) — a cimkek
 *     csomopontjai nelkul (P17). A nezet tartalma, nem a pool: az adat ritka
 *     vegen az "auto" roviditas 0-rol ~400 cimkere er, cimkenkent ket elem
 *     (foreignObject + HTML-sor) es egy szovegcsomopont. Az 1. kriterium a
 *     cimkek NOVEKEDESET mar a P14 ota levonja; a 2. eddig nem, es cimkenkent
 *     egy csomoponttal szamolt.
 *  3. A pool a masodik felben legalabb annyit adott ki ujra (x 0.9), amennyit
 *     a pool nelkuli kontroll ugyanott letrehozott — vagyis ami a kontrollnak
 *     uj csomopont, az itt a poolbol jon. (A P7 elso valtozata itt az
 *     osszesitett "ujrahasznositas > letrehozas" aranyt kerte, ami a kezdeti
 *     felepitest is a letrehozas oldalra tette: igazsaga a meres hosszan es
 *     az elo halmaz meretén mulott, nem a poolon. A rajzolt tartomany
 *     haromszorosara nott, es a kriterium bukott, mikozben a masodik felben
 *     0 uj csomopont jott letre, es a pool pontosan annyit adott ki ujra,
 *     amennyit a kontroll letrehozott.)
 *  4. NEGATIV KONTROLL: ugyanez pool nelkul (poolLimit: 0) a masodik felben
 *     folyamatosan hoz letre csomopontot (>= az elo DOM 25%-a). Ha nem, a
 *     meres nem latja a pool hatasat, es az 1. kriterium semmit nem bizonyit.
 *
 * Ervenyesseg: friss dist (forras-lenyomat), legalabb 20 minta, es minden
 * mintaban >= 1800 lathato elem — egy pasztazas, ami ures teruletre fut,
 * trivialisan "nem noveli" a csomopontszamot.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = join(repoRoot, "packages", "core", ".bench-memory.json");

const MIN_SAMPLES = 20;
const MIN_VISIBLE = 1800;
const MAX_LATE_CREATION_SHARE = 0.005;
const MAX_DOM_GROWTH = 1.05;
const MAX_CDP_GROWTH = 1.1;
const MIN_CONTROL_CREATION_SHARE = 0.25;
const MIN_REUSE_OF_CONTROL_CREATION = 0.9;

const failures = [];
const notes = [];

const max = (values) => Math.max(...values);

function lateCreation(samples) {
  const middle = samples[Math.floor(samples.length / 2)];
  const last = samples[samples.length - 1];
  return {
    created: last.created - middle.created,
    reused: last.reused - middle.reused,
    live: last.domNodes,
    labelGrowth: Math.max(0, last.labelNodes - middle.labelNodes),
    labelsKnown: Number.isInteger(last.labelNodes) && Number.isInteger(middle.labelNodes),
  };
}

if (!existsSync(reportFile)) {
  failures.push(`nincs meresi riport (${reportFile}) — a meres NEM futott le, ezert BUKAS`);
} else {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const stale = (report.builds ?? []).filter((source) => source !== report.expectedSource);
  if ((report.builds ?? []).length === 0 || stale.length > 0) {
    failures.push("a bongeszo NEM a friss dist-et futtatta — regi kod merese");
  }
  const runs = Array.isArray(report.runs) ? report.runs : [];
  const pooled = runs.find((run) => run.poolLimit === null);
  const control = runs.find((run) => run.poolLimit === 0);

  for (const [name, run] of [
    ["pool", pooled],
    ["kontroll", control],
  ]) {
    if (run === undefined) {
      failures.push(`hianyzik a ${name} futas — a nem futtathato meres BUKAS`);
      continue;
    }
    const samples = run.samples ?? [];
    if (samples.length < MIN_SAMPLES) {
      failures.push(`${name}: ${String(samples.length)} minta, legalabb ${String(MIN_SAMPLES)} kell`);
    }
    const thin = samples.filter((sample) => !(sample.visibleItems >= MIN_VISIBLE));
    if (thin.length > 0) {
      failures.push(
        `${name}: ${String(thin.length)} mintaban ${String(MIN_VISIBLE)}-nel kevesebb elem latszik — a pasztazas kifutott az adatbol, a meres ervenytelen`,
      );
    }
  }

  if (pooled !== undefined && (pooled.samples ?? []).length >= MIN_SAMPLES) {
    const samples = pooled.samples;
    const third = Math.floor(samples.length / 3);
    const late = lateCreation(samples);
    const lateLine =
      `a masodik felben ${String(late.created)} uj csomopont (${String(late.live)} elo mellett, ` +
      `a cimke-csomopontok ${String(late.labelGrowth)}-vel nottek)`;
    if (!late.labelsKnown) {
      failures.push("pool: a mintak nem mondjak meg az elo cimke-csomopontokat (labelNodes) — a nem merheto BUKAS");
    } else if (late.created > late.live * MAX_LATE_CREATION_SHARE + late.labelGrowth) {
      failures.push(`pool: ${lateLine} — a pool nem hasznosit ujra`);
    } else {
      notes.push(`pool: ${lateLine}`);
    }
    if (!samples.every((sample) => Number.isInteger(sample.labelNodes) && Number.isInteger(sample.labelTree))) {
      failures.push("pool: a mintak nem mondjak meg a cimkek csomopontjait (labelNodes, labelTree) — a nem merheto BUKAS");
    }
    const domEarly = max(samples.slice(0, third).map((sample) => sample.domNodes - sample.labelNodes));
    const domLate = max(samples.slice(-third).map((sample) => sample.domNodes - sample.labelNodes));
    if (domLate > domEarly * MAX_DOM_GROWTH) {
      failures.push(`pool: az elo DOM (cimkek nelkul) ${String(domEarly)} -> ${String(domLate)} — no a tavolsaggal`);
    } else {
      notes.push(`pool: elo DOM (cimkek nelkul) elso harmad max ${String(domEarly)}, utolso harmad max ${String(domLate)}`);
    }
    const cdpEarly = max(samples.slice(0, third).map((sample) => sample.cdpNodes - sample.labelTree));
    const cdpLate = max(samples.slice(-third).map((sample) => sample.cdpNodes - sample.labelTree));
    if (!(cdpLate <= cdpEarly * MAX_CDP_GROWTH)) {
      failures.push(`pool: a CDP Nodes (cimkek nelkul) ${String(cdpEarly)} -> ${String(cdpLate)} — a bongeszo szerint no`);
    } else {
      notes.push(`pool: CDP Nodes (GC utan, cimkek nelkul) ${String(cdpEarly)} -> ${String(cdpLate)}`);
    }
    const last = samples[samples.length - 1];
    if (control !== undefined && (control.samples ?? []).length >= MIN_SAMPLES) {
      const controlLate = lateCreation(control.samples);
      const reuseLine =
        `a masodik felben ${String(late.reused)} ujrahasznositas, a kontroll ugyanott ` +
        `${String(controlLate.created)} csomopontot hozott letre`;
      if (!(late.reused >= controlLate.created * MIN_REUSE_OF_CONTROL_CREATION)) {
        failures.push(`pool: ${reuseLine} — a pool nem adja, amit a kontrollnak letre kell hoznia`);
      } else {
        notes.push(`pool: ${reuseLine}`);
      }
    }
    notes.push(`pool: ${String(last.reused)} ujrahasznositas, ${String(last.created)} letrehozas osszesen (csak riport)`);
    notes.push(
      `JS heap (GC utan, csak riport): ${(samples[0].jsHeapUsed / 1e6).toFixed(1)} -> ${(last.jsHeapUsed / 1e6).toFixed(1)} MB`,
    );
  }

  if (control !== undefined && (control.samples ?? []).length >= MIN_SAMPLES) {
    const late = lateCreation(control.samples);
    if (late.created < late.live * MIN_CONTROL_CREATION_SHARE) {
      failures.push(
        `a negativ kontroll pool nelkul is csak ${String(late.created)} csomopontot hozott letre — a meres nem latja a pool hatasat`,
      );
    } else {
      notes.push(`negativ kontroll: pool nelkul a masodik felben ${String(late.created)} uj csomopont, ahogy kell`);
    }
  }
}

for (const note of notes) {
  console.log(`  ok    ${note}`);
}
for (const failure of failures) {
  console.log(`  BUKAS ${failure}`);
}
if (failures.length > 0) {
  console.log(`G-MEMORY: BUKOTT (${String(failures.length)} hiba)`);
  process.exit(1);
}
console.log("G-MEMORY: atment");
