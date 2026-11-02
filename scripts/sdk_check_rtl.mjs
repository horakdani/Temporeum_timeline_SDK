#!/usr/bin/env node
/**
 * G-RTL: in RTL, horizontal time flows right to left, gestures and keys
 * work mirrored, and the visual matrix's RTL cases pass.
 *
 * The vitest report (test/rtl/) proves in both orientations: the mirrored
 * frame is exactly the left-to-right one inside a single mirroring group
 * (mirror-exact); horizontally time, vertically the lanes start from the
 * right (time-direction); drag and wheel pan in the mirrored direction
 * (gestures-mirrored); the arrows reach the machine swapped
 * (keys-mirrored); text turns back inside its own box, through both the
 * stylesheet and the attribute (text-readable); and all 12 RTL matrix cases
 * match the stored fixture byte for byte (visual-rtl). sdk_rtl_snapshots.mjs
 * --check verifies the fixtures against the shipped bundle before vitest.
 *
 * Statically: the element mirrors the frame at the end of frameScene, wires
 * the input with attachInput's direction, the tools layer, the group tree
 * and the drop measure from the right edge, and the PDF text turns back via
 * the attribute.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages", "core");
const element = join(root, "packages", "web-component", "src");
const failures = checkReport({
  file: join(core, ".rtl-report.json"),
  label: "RTL",
  minTests: 22,
  claims: ["mirror-exact", "time-direction", "gestures-mirrored", "keys-mirrored", "text-readable", "visual-rtl"],
  orientations: true,
});

const entries = JSON.parse(readFileSync(join(core, "entries.json"), "utf8")).entries;
if (!entries.some((entry) => entry.name === "intl" && entry.input === "src/intl/index.ts")) failures.push("the intl entry point is missing from entries.json");

const read = (file) => codeOf(readFileSync(join(element, file), "utf8"));
const needles = [
  ["config.ts", ['directionOf(config, state) === "rtl" ? mirrorScene(scene) : scene']],
  ["timeline.ts", ["direction: () => direction", "mirrorTextNodes(flattenHtmlText(scene))", 'direction === "rtl" ? box.right - event.clientX']],
  ["tools.ts", ["function setX(", "MIRRORED_KEYS[event.key]", "box.right - event.clientX"]],
  ["groups.ts", ["mirrorStyle(", "MIRRORED_KEYS[sample.key]", "box.right - event.clientX"]],
];
for (const [file, list] of needles) {
  const source = read(file);
  for (const needle of list) if (!source.includes(needle)) failures.push(`missing from the element's ${file}: ${needle}`);
}
const attach = codeOf(readFileSync(join(core, "src", "dom", "attach.ts"), "utf8"));
for (const needle of ["xOf(event.clientX, box)", "-wheelEvent.deltaX", "MIRRORED_KEYS[key.key]"]) {
  if (!attach.includes(needle)) failures.push(`missing from attachInput: ${needle}`);
}

finish("G-RTL", failures);
