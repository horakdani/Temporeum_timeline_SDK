#!/usr/bin/env node
/**
 * G-GROUPS: on generated group trees, in both orientations — the descendants
 * of a collapsed group are neither in the layout nor in the accessibility
 * tree, expanding gives back the same layout, and reordering is a reversible
 * command (dragging and the keyboard give the same one).
 *
 * Statically it also checks that createTimeline draws the group headers
 * outside the listbox, in a `role="tree"`, and that both dragging and the
 * keyboard call the core's `moveGroupCommand` — not a copy.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".groups-report.json"),
  label: "groups",
  minTests: 12,
  claims: ["collapsed-hidden", "expand-restores", "reorder-inverse", "drag-equals-key"],
  orientations: true,
});

const header = codeOf(readFileSync(join(root, "packages", "web-component", "src", "groups", "layer.ts"), "utf8"));
for (const needle of ['"tree"', '"treeitem"', '"aria-expanded"', '"aria-level"', "moveGroupCommand", "dropPosition", "groupKeyStep", "resolveGroupKey"]) {
  if (!header.includes(needle)) failures.push(`the group header layer (web-component/src/groups/layer.ts) does not use: ${needle}`);
}
finish("G-GROUPS", failures);
