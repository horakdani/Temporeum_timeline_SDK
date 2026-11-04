#!/usr/bin/env node
/**
 * The add-remove check: adding and removing issue the same command by gesture and by
 * keyboard, the inverse restores the exact starting point, and the host's
 * veto is atomic.
 *
 * The runtime half measures the core's pure functions. The static half checks
 * that both paths of createTimeline really call THESE: the gesture calls
 * `addTargetAt`, the keyboard calls `addTargetFromFocus`, and both run into
 * the same function that calls `addCommand`; both removal paths go through
 * `removeTargets` into `removeCommand`. The gesture recognises the remove
 * handle from the DOM target of the press (`data-tl-remove`), not from
 * geometry: under the item layer's transform, the target is what the user saw.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".add-remove-report.json"),
  label: "add-remove",
  minTests: 7,
  claims: ["same-command", "inverse-exact", "veto-atomic"],
});
const source = codeOf(readFileSync(join(root, "packages", "web-component", "src", "timeline.ts"), "utf8"));
const count = (needle) => source.split(needle).length - 1;
for (const needle of ["addTargetAt(", "addTargetFromFocus(", "resolveItemKey(", '"[data-tl-remove]"']) {
  if (count(needle) < 1) failures.push(`createTimeline does not call: ${needle}`);
}
if (count("addCommand(") !== 1) failures.push(`addCommand must be called exactly ONCE in createTimeline (now ${String(count("addCommand("))}): the gesture, the keyboard and the drop take one path`);
if (count("removeCommand(") !== 1) failures.push(`removeCommand must be called exactly ONCE (now ${String(count("removeCommand("))})`);
if (count("removeTargets(") < 1) failures.push("createTimeline does not pick the items to remove with removeTargets");
finish("add-remove", failures);
