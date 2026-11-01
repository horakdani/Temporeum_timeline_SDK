#!/usr/bin/env node
/**
 * G-INVERSE: bizonyitja, hogy minden command inverze visszaallitja a PONTOS
 * kiindulasi allapotot — generalt SOROZATOKRA is.
 *
 * Ez a P5 legfontosabb allitasa, mert erre epul minden tovabbi: egy undo,
 * ami "majdnem" visszaall, csendben rontja el a felhasznalo adatait, es a
 * hiba csak harom muvelettel kesobb latszik. Ezert nem eleg kezzel irt
 * esetekkel probalni.
 *
 * Ket fuggetlen ellenorzes:
 *
 *  1. FUTASIDEJU: a property-riportbol mind az OT property-nek zoldnek kell
 *     lennie, nevvel es seeddel, legalabb MIN_CASES generalt esettel. A
 *     riport hianya BUKAS, nem kihagyas — a csomagparancs elotte torli, tehat
 *     a riport jelenlete azt jelenti, hogy MOST futott le.
 *  2. STATIKUS: a bizonyitek szerkezete. Hogy a keszlet a VALODI bemeneti
 *     gepet hajtja (nem csak a patch-segedfuggvenyeket), hogy a "pontos"
 *     szot szo szerint veszi (kulcshalmazt is hasonlit, nem csak erteket),
 *     hogy a sorozatot visszafele bontja vissza, es hogy a magban megvan a
 *     harom szerkezeti feltetel, amin az allitas all: az inverz nem
 *     enumeralhato es memoizalt (kulonben a command cirkularis es az undo-vem
 *     vegtelenul no), az invertPatch csak a megvaltoztatott kulcsokat
 *     allitja vissza, es az ItemPatch.laneId felveheti a null-t (kulonben a
 *     "nem volt savban" allapot nem kifejezheto, es a savba huzas inverze
 *     pontatlan).
 *
 * A statikus fel nelkul a futasideju fel onmagat igazolna: ot zold property,
 * ami csak a sajat segedfuggvenyeit jarja korbe, ugyanolyan jol olvashato.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const testFile = join(corePackage, "test", "property", "inverse.test.ts");
const reportFile = join(corePackage, ".property-report-inverse.json");
const editingFile = join(corePackage, "src", "editing.ts");
const typesFile = join(corePackage, "src", "types.ts");

const MIN_CASES = 500;
const REQUIRED_PROPERTIES = [
  "one inverse restores the state",
  "a sequence of inverses restores the state",
  "an inverse of an inverse is the command",
  "a command is serialisable",
  "the machine's own commands invert",
  // P19: a hozzaadas, a torles es a csoport-atrendezes is command — a P19
  // kapujanak G-INVERSE proof-ja kifejezetten az uj parancsokat is keri.
  "an add or a remove inverts exactly",
  "a group reorder inverts exactly",
  // P21: az automatikus utemezes is command — a P21 kapujanak G-INVERSE
  // proof-ja minden commandot ker, a G-SCHEDULE-CMD pedig ezt kulon is.
  "a schedule inverts exactly",
  // P22: az eroforrasok kozti atrendeles a savvalto mozgatas, terhelesi
  // savokkal a sorok kozott — a huzas barmely sorra egy 'move' parancs, es a
  // P22 kapujanak G-INVERSE proof-ja minden commandot ker.
  "a move between resources inverts exactly",
];

const failures = [];
const notes = [];

// --- 1. FUTASIDEJU -----------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `nincs property-riport (${reportFile}) — az inverz-keszlet NEM futott le, ezert BUKAS`,
  );
} else {
  let report;
  try {
    report = JSON.parse(readFileSync(reportFile, "utf8"));
  } catch (error) {
    report = undefined;
    failures.push(`a property-riport olvashatatlan: ${String(error)}`);
  }
  if (report !== undefined) {
    if (!Array.isArray(report) || report.length === 0) {
      failures.push("a property-riport ures");
    } else {
      for (const name of REQUIRED_PROPERTIES) {
        const entry = report.find((candidate) => candidate?.name === name);
        if (entry === undefined) {
          failures.push(`a kotelezo property hianyzik: "${name}"`);
          continue;
        }
        if (entry.passed !== true) {
          failures.push(
            `bukott property: ${name} — ${JSON.stringify(entry.counterexample ?? null)}`,
          );
        }
        if (!Number.isInteger(entry.cases) || entry.cases < MIN_CASES) {
          failures.push(
            `${name}: ${String(entry.cases)} eset, de legalabb ${String(MIN_CASES)} kell`,
          );
        }
        if (!Number.isFinite(entry.seed)) {
          failures.push(`${name}: nincs seed, tehat egy bukas nem reprodukalhato`);
        }
      }
      const extra = report.filter(
        (entry) => !REQUIRED_PROPERTIES.includes(String(entry?.name ?? "")),
      );
      if (extra.length > 0) {
        // Nem hiba, de legyen latszodo: a riport tartalma a bizonyitek.
        notes.push(`tovabbi property a riportban: ${extra.map((e) => e.name).join(", ")}`);
      }
      if (failures.length === 0) {
        const total = report.reduce((sum, entry) => sum + entry.cases, 0);
        notes.push(
          `${String(report.length)} inverz-property, ${String(total)} generalt eset, mind zold`,
        );
      }
    }
  }
}

// --- 2. STATIKUS -------------------------------------------------------------

if (!existsSync(testFile)) {
  failures.push(`nincs inverz-property fajl: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");

  if (
    !/import\s*\{[^}]*\bcreateInputMachine\b[^}]*\}\s*from\s*"\.\.\/\.\.\/src\/input\.js"/.test(
      source,
    ) ||
    !/createInputMachine\s*\(/.test(source)
  ) {
    failures.push(
      "a keszlet nem hajtja a valodi bemeneti gepet (createInputMachine) — " +
        "a patch-segedfuggvenyek megforditashatosaga semmit nem allit arrol a commandrol, " +
        "amit egy ujj tenylegesen eloallit",
    );
  } else {
    notes.push("egy property a VALODI bemeneti gepet hajtja, generalt gesztusokkal");
  }

  if (!/Object\.keys\(/.test(source) || !/Object\.is\(/.test(source)) {
    failures.push(
      "az osszehasonlitas nem szo szerinti: a 'PONTOS' allapothoz a kulcshalmazt is " +
        "hasonlitani kell (Object.keys) es az ertekeket Object.is-szel, kulonben egy " +
        "undo utan ottmaradt explicit undefined atmegy",
    );
  } else {
    notes.push("a 'pontos' szo szerinti: kulcshalmaz + Object.is");
  }

  if (!/for \(let index = commands\.length - 1; index >= 0; index -= 1\)/.test(source)) {
    failures.push(
      "a sorozatot nem visszafele bontja vissza — egy undo-verem LIFO-ban bont, " +
        "es eppen a sorrend az, amit egy sorozatra szolo allitas bizonyitani hivatott",
    );
  } else {
    notes.push("a sorozat visszabontasa LIFO, ahogy egy undo-verem bont");
  }
}

if (!existsSync(editingFile)) {
  failures.push(`nincs ${editingFile}`);
} else {
  const source = readFileSync(editingFile, "utf8");

  const defineBlock = /Object\.defineProperty\(\s*command,\s*"inverse",\s*\{([\s\S]*?)\n\s*\}\);/.exec(
    source,
  );
  if (defineBlock === null) {
    failures.push(
      "az inverse nem Object.defineProperty-vel keszul — sima mezoként a command " +
        "cirkularis, es JSON-kent nem tarolhato",
    );
  } else {
    const body = defineBlock[1];
    if (!/enumerable:\s*false/.test(body)) {
      failures.push(
        "az inverse enumeralhato — a command sajat magat szerializalna, tehat egy " +
          "hoszt altal eltett undo-verem nem sima JSON",
      );
    }
    if (!/inverse \?\?=/.test(body)) {
      failures.push(
        "az inverse nincs memoizalva — minden lekeres uj objektumot ad, tehat " +
          "cmd.inverse.inverse !== cmd, es egy ide-oda nyomott undo vegtelenul no",
      );
    }
    if (failures.length === 0) {
      notes.push("az inverse lusta, nem enumeralhato es memoizalt getter");
    }
  }

  const invertBody = /export function invertPatch<T>\(([\s\S]*?)\n\}/.exec(source);
  if (invertBody === null) {
    failures.push("nem talalhato az invertPatch");
  } else {
    const body = invertBody[1];
    const guards = ['"start" in patch', '"end" in patch', '"laneId" in patch'];
    for (const guard of guards) {
      if (!body.includes(guard)) {
        failures.push(
          `az invertPatch nem ${guard} alapjan dont — egy inverz, ami olyan mezot is ` +
            "visszaallit, amit senki nem valtoztatott, feluliria azt, amit a hoszt " +
            "kozben tett vele",
        );
      }
    }
    const assignments = (body.match(/restored\.[a-zA-Z]+\s*=/g) ?? []).length;
    if (assignments !== guards.length) {
      failures.push(
        `az invertPatch ${String(assignments)} mezot allit vissza, de ${String(guards.length)} ` +
          "orzott agnak kell lennie — egy orzes nelkuli visszaallitas pont a fenti hiba",
      );
    }
  }
}

if (!existsSync(typesFile)) {
  failures.push(`nincs ${typesFile}`);
} else {
  const source = readFileSync(typesFile, "utf8");
  const patch = /export interface ItemPatch \{([\s\S]*?)\n\}/.exec(source);
  if (patch === null) {
    failures.push("nem talalhato az ItemPatch");
  } else if (!/laneId\?:\s*string\s*\|\s*null/.test(patch[1])) {
    failures.push(
      "az ItemPatch.laneId nem veheti fel a null-t — akkor a 'nem volt savban' allapot " +
        "nem kifejezheto, es minden savon kivul indult elem savba huzasanak az inverze " +
        "pontatlan",
    );
  } else {
    notes.push("az ItemPatch.laneId nullozhato, tehat a 'nincs sav' allapot kifejezheto");
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
  console.error(`\nG-INVERSE BUKOTT: ${String(failures.length)} hiba.`);
  process.exit(1);
}

console.log(
  "\nG-INVERSE atment: minden command inverze visszaallitja a PONTOS kiindulasi allapotot, " +
    "generalt sorozatokra is.",
);
