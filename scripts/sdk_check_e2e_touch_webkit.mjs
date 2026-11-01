#!/usr/bin/env node
/**
 * G-E2E-TOUCH-WEBKIT (P31): a Chromiumos G-E2E-TOUCH gesztus-allitasai
 * WebKitben, emulalt iPhone-on es iPaden — es egy negativ kontroll, amely
 * bukik.
 *
 * Ket meresbol all, mert egyik sem tud mindent:
 *
 *  1. A PLAYWRIGHT WEBKIT (`playwright.webkit.config.ts`): ugyanaz a
 *     `e2e/touch.spec.ts`, mint a Chromiumban, iPhone- es iPad-emulacioval.
 *     A tobb ujjat a Playwright WebKit-buildjenek sajat
 *     `Input.dispatchTouchEvent`-je adja (valodi, `isTrusted` Pointer
 *     Events), nem a lapba injektalt esemeny. Ez a WebKit viszont macOS-en
 *     fut, UIKit nelkul: nem gorget es nem nagyit erintesre. A ket
 *     `touch-action`-allitas ezert itt nem merheto — a konfig `grepInvert`-je
 *     kiveszi oket.
 *  2. A VALODI MOBILE SAFARI (`sdk_ios_touch.mjs`): az Xcode
 *     iOS-szimulatoraban, safaridriveren at. Itt mérjuk a ket kivett
 *     allitast, a gorgetes-elnyelest a szelen, a hosszu nyomast — es a
 *     NEGATIV KONTROLLT: `touch-action: auto` mellett ugyanaz a huzas
 *     elgorgeti a lapot, tehat a "nem gorog" allitas bukna. Ha a kontroll
 *     nem gorget, a meres vak, es a kapu BUKIK.
 *
 * A kotelezo allitasok listajat NEM itt tartjuk: a Chromiumos ellenorzo
 * (`sdk_check_e2e_touch.mjs`) REQUIRED_CLAIMS-ebol olvassuk, hogy a ket lista
 * ne valhasson el. Minden allitasnak vagy a Playwright WebKitben kell zoldnek
 * lennie MINDKET eszkozon, vagy az iOS-meresben.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repo, "packages", "docs");
const webkitReportFile = join(docs, ".e2e-touch-webkit-report.json");
const iosReportFile = join(docs, ".ios-touch-report.json");
const configFile = join(docs, "playwright.webkit.config.ts");
const specFile = join(docs, "e2e", "touch.spec.ts");
const chromiumChecker = join(repo, "scripts", "sdk_check_e2e_touch.mjs");

const failures = [];
const notes = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

// --- a kozos allitas-lista ---------------------------------------------------------------
const chromiumSource = readFileSync(chromiumChecker, "utf8");
const listMatch = /const REQUIRED_CLAIMS = \[([\s\S]*?)\];/.exec(chromiumSource);
const REQUIRED_CLAIMS = listMatch === null ? [] : [...listMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
check(REQUIRED_CLAIMS.length >= 10, `a Chromiumos ellenorzo REQUIRED_CLAIMS-e nem olvashato (${String(REQUIRED_CLAIMS.length)} elem)`);
/** Ezeket a valodi Mobile Safari meri; a Playwright WebKit vak rajuk. */
const IOS_CLAIMS = new Map([
  ["touch-action", ["none", "edge"]],
  ["ELVESZI a gesztust", ["cooperative"]],
]);
for (const claim of IOS_CLAIMS.keys()) check(REQUIRED_CLAIMS.includes(claim), `a(z) "${claim}" allitas mar nincs a Chromiumos listan — a felosztas elavult`);

// --- 1. a Playwright WebKit ----------------------------------------------------------------
const config = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
check(config !== "", `nincs WebKit-konfig: ${configFile}`);
const projectBlocks = [...config.matchAll(/\{\s*name:\s*"([^"]+)",\s*use:\s*\{([^}]*)\}\s*\}/g)].map((match) => ({ name: match[1], use: match[2] }));
const phones = projectBlocks.filter((project) => /devices\["iPhone/.test(project.use) && /browserName:\s*"webkit"/.test(project.use));
const tablets = projectBlocks.filter((project) => /devices\["iPad/.test(project.use) && /browserName:\s*"webkit"/.test(project.use));
check(phones.length > 0, "a WebKit-konfigban nincs iPhone-emulacio webkit bongeszovel");
check(tablets.length > 0, "a WebKit-konfigban nincs iPad-emulacio webkit bongeszovel");
check(projectBlocks.length === phones.length + tablets.length, "a WebKit-konfigban van nem-WebKit vagy nem-iOS projekt");
check(/retries:\s*0/.test(config), "a WebKit-konfig nem zarja ki az ujraprobalast");
const invert = /grepInvert:\s*\/(.*)\/,/.exec(config);
const inverted = invert === null ? [] : invert[1].split("|");
check(inverted.length === IOS_CLAIMS.size, `a grepInvert ${String(inverted.length)} allitast vesz ki, ${String(IOS_CLAIMS.size)}-t kellene (a tobbit a WebKitnek kell mernie)`);

const spec = existsSync(specFile) ? readFileSync(specFile, "utf8") : "";
check(/_pageProxySession/.test(spec) && /Input\.dispatchTouchEvent/.test(spec), "a keszlet nem a WebKit sajat erintes-bemenetet hasznalja");
check(!/new TouchEvent|new PointerEvent|dispatchEvent\(/.test(spec), "a keszlet a lapba injektalt esemenyt hasznal — az nem a bongeszo erintese");

const projectNames = projectBlocks.map((project) => project.name);
if (!existsSync(webkitReportFile)) {
  failures.push(`nincs WebKit-riport (${webkitReportFile}) — a Playwright WebKit-keszlet NEM futott`);
} else {
  const report = JSON.parse(readFileSync(webkitReportFile, "utf8"));
  const stats = report.stats ?? {};
  check(Number(stats.unexpected ?? 0) === 0, `${String(stats.unexpected)} bukott WebKit-teszt`);
  check(Number(stats.flaky ?? 0) === 0, `${String(stats.flaky)} flaky WebKit-teszt`);
  check(Number(stats.skipped ?? 0) === 0, `${String(stats.skipped)} kihagyott WebKit-teszt — a kihagyas BUKAS`);
  for (const project of report.config?.projects ?? []) check(Number(project.retries ?? 0) === 0, `a(z) ${String(project.name)} projekt ujraprobal`);
  const green = new Map(projectNames.map((name) => [name, new Set()]));
  const walk = (suite) => {
    for (const each of suite.specs ?? []) {
      for (const test of each.tests ?? []) {
        if (test.status !== "expected") failures.push(`nem zold WebKit-teszt: [${String(test.projectName)}] ${String(each.title)} (${String(test.status)})`);
        else green.get(test.projectName)?.add(String(each.title).toLowerCase());
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  for (const claim of REQUIRED_CLAIMS) {
    if (IOS_CLAIMS.has(claim)) continue;
    for (const name of projectNames) {
      check([...(green.get(name) ?? [])].some((title) => title.includes(claim.toLowerCase())), `[${name}] a(z) "${claim}" allitast senki nem merte zolden WebKitben`);
    }
  }
  notes.push(`Playwright WebKit: ${String(stats.expected)} zold teszt, ${projectNames.join(", ")}`);
}

// --- 2. a valodi Mobile Safari ----------------------------------------------------------------
if (!existsSync(iosReportFile)) {
  failures.push(`nincs iOS-riport (${iosReportFile}) — a Mobile Safari-meres NEM futott, es a nem futtathato meres BUKAS`);
} else {
  const ios = JSON.parse(readFileSync(iosReportFile, "utf8"));
  check(ios.error === null, `az iOS-meres nem futott: ${String(ios.error)}`);
  const kinds = (ios.devices ?? []).map((device) => device.kind);
  check(kinds.includes("iphone") && kinds.includes("ipad"), `az iOS-meres nem futott iPhone-on es iPaden is (${kinds.join(", ")})`);
  const trial = (kind, name) => (ios.trials ?? []).find((each) => each.kind === kind && each.trial === name);
  const trusted = (final, type) => (final?.log ?? []).includes(`${type}:touch:true`);
  for (const kind of ["iphone", "ipad"]) {
    for (const name of ["none", "edge", "cooperative", "control", "longpress"]) {
      const result = trial(kind, name);
      if (result === undefined) {
        failures.push(`[${kind}] nincs "${name}" proba az iOS-riportban`);
        continue;
      }
      check(result.error === null, `[${kind}] ${name}: a proba nem futott: ${String(result.error)}`);
      check(result.final !== null, `[${kind}] ${name}: a lap nem kuldott allapotot`);
      check(trusted(result.final, "pointerdown"), `[${kind}] ${name}: az erintes nem jutott el a laphoz (nincs valodi touch pointerdown)`);
      check(result.final?.open === false, `[${kind}] ${name}: a gesztus vagy szerkesztes nyitva maradt`);
    }
    // touch-action: none — a lap nem gorog, az idovonal pasztaz es lezar.
    for (const name of ["none", "edge"]) {
      const result = trial(kind, name);
      const final = result?.final;
      check(result?.setup?.touchAction === "none", `[${kind}] ${name}: a gyoker touch-action-je ${String(result?.setup?.touchAction)}, nem none`);
      check(final?.scrollY === 0, `[${kind}] ${name}: a lap elgorgott (${String(final?.scrollY)}) — a touch-action NEM szol`);
      check((final?.gestures ?? []).includes("gestureStart:pan") && (final?.gestures ?? []).includes("gestureEnd:pan"), `[${kind}] ${name}: az idovonal nem pasztazott vegig (${JSON.stringify(final?.gestures)})`);
      check(!trusted(final, "pointercancel"), `[${kind}] ${name}: a bongeszo elvette a gesztust`);
    }
    // cooperative — a lap gorog, es a bongeszo ELVESZI a gesztust.
    {
      const final = trial(kind, "cooperative")?.final;
      const gestures = final?.gestures ?? [];
      check(trial(kind, "cooperative")?.setup?.touchAction === "pan-y", `[${kind}] cooperative: a touch-action nem pan-y`);
      check(Number(final?.scrollY ?? 0) > 0, `[${kind}] cooperative: a lap nem gorgott`);
      check(trusted(final, "pointercancel"), `[${kind}] cooperative: nem jott valodi pointercancel — a bongeszo nem vette el a gesztust`);
      const started = gestures.filter((entry) => entry.startsWith("gestureStart:")).length;
      const cancelled = gestures.filter((entry) => entry.startsWith("gestureEnd:") && entry.endsWith(":cancelled")).length;
      check(started === cancelled, `[${kind}] cooperative: ${String(started)} megkezdett gesztusbol ${String(cancelled)} zarult :cancelled-del (${JSON.stringify(gestures)})`);
      notes.push(`[${kind}] cooperative: gorgetes ${String(final?.scrollY)} px, ${started === 0 ? "a bongeszo a pasztazas kuszobe elott vette at (nem volt mit lezarni)" : "a pasztazas :cancelled-del zarult"}`);
    }
    // a NEGATIV KONTROLL: auto mellett ugyanaz a huzas gorget — a "none" bukna.
    {
      const result = trial(kind, "control");
      check(result?.setup?.touchAction === "auto", `[${kind}] kontroll: a touch-action nem auto`);
      check(Number(result?.final?.scrollY ?? 0) > 0, `[${kind}] NEGATIV KONTROLL: touch-action: auto mellett sem gorgott a lap — a meres vak, a "none" zoldje semmit nem bizonyit`);
      notes.push(`[${kind}] negativ kontroll: auto mellett ugyanaz a huzas ${String(result?.final?.scrollY)} px-t gorgetett — a "nem gorog" allitas itt bukik`);
    }
    // hosszu nyomas: az iOS nem veszi el, az elem mozdul, a lap nem gorog.
    {
      const final = trial(kind, "longpress")?.final;
      check((final?.edits ?? []).includes("editStart:move:long-press") && (final?.edits ?? []).includes("editEnd:move"), `[${kind}] hosszu nyomas: nem lett szerkesztes (${JSON.stringify(final?.edits)})`);
      check(!trusted(final, "pointercancel"), `[${kind}] hosszu nyomas: az iOS elvette a gesztust (pointercancel)`);
      check(final?.scrollY === 0, `[${kind}] hosszu nyomas: a lap elgorgott`);
    }
  }
  const versions = [...new Set((ios.trials ?? []).map((each) => each.safari))].join(", ");
  notes.push(`Mobile Safari ${versions} (${String(ios.runtime)}, szimulator): ${(ios.devices ?? []).map((device) => device.name).join(", ")}`);
}

for (const note of notes) process.stdout.write(`  ok   ${note}\n`);
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`  HIBA ${failure}\n`);
  process.stderr.write(`\nG-E2E-TOUCH-WEBKIT BUKOTT: ${String(failures.length)} hiba.\n`);
  process.exit(1);
}
process.stdout.write("\nG-E2E-TOUCH-WEBKIT atment: a gesztusok WebKitben, a touch-action a valodi Mobile Safariban, a negativ kontroll harap.\n");
