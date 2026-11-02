#!/usr/bin/env node
/**
 * G-TEMPLATE: the HTML template renders the same on the client and the
 * server, the element keeps its accessible name, and a template containing a
 * script does not run by default — WITH A NEGATIVE CONTROL: with
 * `sanitize: false` the same template does reach the DOM.
 *
 * Two reports: the core's vitest suite (mounted into the fake DOM), and a real
 * Chromium run from the docs package, where the script and the handler WOULD
 * actually run if the template let them through.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".template-report.json"),
  label: "template",
  minTests: 6,
  claims: ["same-tree", "accessible-name", "no-script", "negative-control"],
});
const e2e = join(root, "packages", "docs", ".template-e2e.json");
if (!existsSync(e2e)) {
  failures.push(`no browser template report (${e2e}) — the real Chromium run did NOT run, so this FAILS`);
} else {
  const log = JSON.parse(readFileSync(e2e, "utf8"));
  if (log.sanitized?.ran !== false) failures.push(`the sanitised template's script ran in the browser: ${JSON.stringify(log.sanitized)}`);
  if (log.unsanitized?.ran !== true) failures.push(`the negative control did not detect the run (sanitize: false): ${JSON.stringify(log.unsanitized)} — the probe is blind`);
  if (log.ssrEqual !== true) failures.push("the server and client template markup differed in the browser");
}
finish("G-TEMPLATE", failures);
