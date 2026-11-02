#!/usr/bin/env node
/**
 * G-E2E-TOUCH-WEBKIT: the gesture claims of the Chromium G-E2E-TOUCH check in
 * WebKit, on an emulated iPhone and iPad — and a negative control that
 * fails.
 *
 * It is made of two measurements, because neither can do everything:
 *
 *  1. PLAYWRIGHT WEBKIT (`playwright.webkit.config.ts`): the same
 *     `e2e/touch.spec.ts` as in Chromium, with iPhone and iPad emulation.
 *     The multiple fingers come from the Playwright WebKit build's own
 *     `Input.dispatchTouchEvent` (real, `isTrusted` Pointer Events), not
 *     from an event injected into the page. This WebKit, however, runs on
 *     macOS without UIKit: it does not scroll or zoom on touch. So the two
 *     `touch-action` claims cannot be measured here — the config's
 *     `grepInvert` takes them out.
 *  2. REAL MOBILE SAFARI (`sdk_ios_touch.mjs`): in the Xcode iOS Simulator,
 *     through safaridriver. Here we measure the two claims taken out, the
 *     scroll absorption at the edge, the long press — and the NEGATIVE
 *     CONTROL: with `touch-action: auto` the same drag scrolls the page, so
 *     the "does not scroll" claim would fail. If the control does not
 *     scroll, the measurement is blind, and the check FAILS.
 *
 * The list of required claims is NOT kept here: we read it from the
 * REQUIRED_CLAIMS of the Chromium checker (`sdk_check_e2e_touch.mjs`), so the
 * two lists cannot drift apart. Every claim must pass either in Playwright
 * WebKit on BOTH devices, or in the iOS measurement.
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

// --- the shared claim list ---------------------------------------------------------------
const chromiumSource = readFileSync(chromiumChecker, "utf8");
const listMatch = /const REQUIRED_CLAIMS = \[([\s\S]*?)\];/.exec(chromiumSource);
const REQUIRED_CLAIMS = listMatch === null ? [] : [...listMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
check(REQUIRED_CLAIMS.length >= 10, `the Chromium checker's REQUIRED_CLAIMS cannot be read (${String(REQUIRED_CLAIMS.length)} entries)`);
/** Real Mobile Safari measures these; Playwright WebKit is blind to them. */
const IOS_CLAIMS = new Map([
  ["touch-action", ["none", "edge"]],
  ["TAKES the gesture", ["cooperative"]],
]);
for (const claim of IOS_CLAIMS.keys()) check(REQUIRED_CLAIMS.includes(claim), `the "${claim}" claim is no longer on the Chromium list — the split is out of date`);

// --- 1. Playwright WebKit ------------------------------------------------------------------
const config = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
check(config !== "", `no WebKit config: ${configFile}`);
const projectBlocks = [...config.matchAll(/\{\s*name:\s*"([^"]+)",\s*use:\s*\{([^}]*)\}\s*\}/g)].map((match) => ({ name: match[1], use: match[2] }));
const phones = projectBlocks.filter((project) => /devices\["iPhone/.test(project.use) && /browserName:\s*"webkit"/.test(project.use));
const tablets = projectBlocks.filter((project) => /devices\["iPad/.test(project.use) && /browserName:\s*"webkit"/.test(project.use));
check(phones.length > 0, "the WebKit config has no iPhone emulation with the webkit browser");
check(tablets.length > 0, "the WebKit config has no iPad emulation with the webkit browser");
check(projectBlocks.length === phones.length + tablets.length, "the WebKit config has a non-WebKit or non-iOS project");
check(/retries:\s*0/.test(config), "the WebKit config does not rule out retries");
const invert = /grepInvert:\s*\/(.*)\/,/.exec(config);
const inverted = invert === null ? [] : invert[1].split("|");
check(inverted.length === IOS_CLAIMS.size, `grepInvert takes out ${String(inverted.length)} claims, it should be ${String(IOS_CLAIMS.size)} (WebKit must measure the rest)`);

const spec = existsSync(specFile) ? readFileSync(specFile, "utf8") : "";
check(/_pageProxySession/.test(spec) && /Input\.dispatchTouchEvent/.test(spec), "the suite does not use WebKit's own touch input");
check(!/new TouchEvent|new PointerEvent|dispatchEvent\(/.test(spec), "the suite uses events injected into the page — that is not the browser's touch");

const projectNames = projectBlocks.map((project) => project.name);
if (!existsSync(webkitReportFile)) {
  failures.push(`no WebKit report (${webkitReportFile}) — the Playwright WebKit suite did NOT run`);
} else {
  const report = JSON.parse(readFileSync(webkitReportFile, "utf8"));
  const stats = report.stats ?? {};
  check(Number(stats.unexpected ?? 0) === 0, `${String(stats.unexpected)} failed WebKit tests`);
  check(Number(stats.flaky ?? 0) === 0, `${String(stats.flaky)} flaky WebKit tests`);
  check(Number(stats.skipped ?? 0) === 0, `${String(stats.skipped)} skipped WebKit tests — a skip is a FAILURE`);
  for (const project of report.config?.projects ?? []) check(Number(project.retries ?? 0) === 0, `the ${String(project.name)} project retries`);
  const green = new Map(projectNames.map((name) => [name, new Set()]));
  const walk = (suite) => {
    for (const each of suite.specs ?? []) {
      for (const test of each.tests ?? []) {
        if (test.status !== "expected") failures.push(`failing WebKit test: [${String(test.projectName)}] ${String(each.title)} (${String(test.status)})`);
        else green.get(test.projectName)?.add(String(each.title).toLowerCase());
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  for (const claim of REQUIRED_CLAIMS) {
    if (IOS_CLAIMS.has(claim)) continue;
    for (const name of projectNames) {
      check([...(green.get(name) ?? [])].some((title) => title.includes(claim.toLowerCase())), `[${name}] nobody measured the "${claim}" claim passing in WebKit`);
    }
  }
  notes.push(`Playwright WebKit: ${String(stats.expected)} passing tests, ${projectNames.join(", ")}`);
}

// --- 2. real Mobile Safari ---------------------------------------------------------------------
if (!existsSync(iosReportFile)) {
  failures.push(`no iOS report (${iosReportFile}) — the Mobile Safari measurement did NOT run, and a measurement that cannot run is a FAILURE`);
} else {
  const ios = JSON.parse(readFileSync(iosReportFile, "utf8"));
  check(ios.error === null, `the iOS measurement did not run: ${String(ios.error)}`);
  const kinds = (ios.devices ?? []).map((device) => device.kind);
  check(kinds.includes("iphone") && kinds.includes("ipad"), `the iOS measurement did not run on both iPhone and iPad (${kinds.join(", ")})`);
  const trial = (kind, name) => (ios.trials ?? []).find((each) => each.kind === kind && each.trial === name);
  const trusted = (final, type) => (final?.log ?? []).includes(`${type}:touch:true`);
  for (const kind of ["iphone", "ipad"]) {
    for (const name of ["none", "edge", "cooperative", "control", "longpress"]) {
      const result = trial(kind, name);
      if (result === undefined) {
        failures.push(`[${kind}] no "${name}" trial in the iOS report`);
        continue;
      }
      check(result.error === null, `[${kind}] ${name}: the trial did not run: ${String(result.error)}`);
      check(result.final !== null, `[${kind}] ${name}: the page sent no state`);
      check(trusted(result.final, "pointerdown"), `[${kind}] ${name}: the touch did not reach the page (no real touch pointerdown)`);
      check(result.final?.open === false, `[${kind}] ${name}: a gesture or edit was left open`);
    }
    // touch-action: none — the page does not scroll, the timeline pans and closes.
    for (const name of ["none", "edge"]) {
      const result = trial(kind, name);
      const final = result?.final;
      check(result?.setup?.touchAction === "none", `[${kind}] ${name}: the root's touch-action is ${String(result?.setup?.touchAction)}, not none`);
      check(final?.scrollY === 0, `[${kind}] ${name}: the page scrolled (${String(final?.scrollY)}) — touch-action has NO effect`);
      check((final?.gestures ?? []).includes("gestureStart:pan") && (final?.gestures ?? []).includes("gestureEnd:pan"), `[${kind}] ${name}: the timeline did not pan all the way (${JSON.stringify(final?.gestures)})`);
      check(!trusted(final, "pointercancel"), `[${kind}] ${name}: the browser took the gesture`);
    }
    // cooperative — the page scrolls, and the browser TAKES the gesture.
    {
      const final = trial(kind, "cooperative")?.final;
      const gestures = final?.gestures ?? [];
      check(trial(kind, "cooperative")?.setup?.touchAction === "pan-y", `[${kind}] cooperative: the touch-action is not pan-y`);
      check(Number(final?.scrollY ?? 0) > 0, `[${kind}] cooperative: the page did not scroll`);
      check(trusted(final, "pointercancel"), `[${kind}] cooperative: no real pointercancel arrived — the browser did not take the gesture`);
      const started = gestures.filter((entry) => entry.startsWith("gestureStart:")).length;
      const cancelled = gestures.filter((entry) => entry.startsWith("gestureEnd:") && entry.endsWith(":cancelled")).length;
      check(started === cancelled, `[${kind}] cooperative: of ${String(started)} started gestures ${String(cancelled)} ended with :cancelled (${JSON.stringify(gestures)})`);
      notes.push(`[${kind}] cooperative: scrolled ${String(final?.scrollY)} px, ${started === 0 ? "the browser took over before the pan threshold (there was nothing to close)" : "the pan ended with :cancelled"}`);
    }
    // the NEGATIVE CONTROL: with auto the same drag scrolls — "none" would fail.
    {
      const result = trial(kind, "control");
      check(result?.setup?.touchAction === "auto", `[${kind}] control: the touch-action is not auto`);
      check(Number(result?.final?.scrollY ?? 0) > 0, `[${kind}] NEGATIVE CONTROL: the page did not scroll even with touch-action: auto — the measurement is blind, "none" passing proves nothing`);
      notes.push(`[${kind}] negative control: with auto the same drag scrolled ${String(result?.final?.scrollY)} px — the "does not scroll" claim fails here`);
    }
    // long press: iOS does not take it, the item moves, the page does not scroll.
    {
      const final = trial(kind, "longpress")?.final;
      check((final?.edits ?? []).includes("editStart:move:long-press") && (final?.edits ?? []).includes("editEnd:move"), `[${kind}] long press: no edit happened (${JSON.stringify(final?.edits)})`);
      check(!trusted(final, "pointercancel"), `[${kind}] long press: iOS took the gesture (pointercancel)`);
      check(final?.scrollY === 0, `[${kind}] long press: the page scrolled`);
    }
  }
  const versions = [...new Set((ios.trials ?? []).map((each) => each.safari))].join(", ");
  notes.push(`Mobile Safari ${versions} (${String(ios.runtime)}, simulator): ${(ios.devices ?? []).map((device) => device.name).join(", ")}`);
}

for (const note of notes) process.stdout.write(`  ok   ${note}\n`);
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`  FAIL ${failure}\n`);
  process.stderr.write(`\nG-E2E-TOUCH-WEBKIT FAILED: ${String(failures.length)} problems.\n`);
  process.exit(1);
}
process.stdout.write("\nG-E2E-TOUCH-WEBKIT passed: the gestures in WebKit, touch-action in real Mobile Safari, the negative control bites.\n");
