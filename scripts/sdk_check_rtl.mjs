#!/usr/bin/env node
/**
 * G-RTL: RTL-ben vizszintesen az ido jobbrol balra folyik, a gesztusok es a
 * billentyuk tukrozve mukodnek, es a vizualis matrix RTL-esetei zoldek.
 *
 * A vitest-riport (test/rtl/) mindket orientacioban bizonyitja: a tukrozott
 * keret pontosan a balrol jobbra futo, egyetlen tukrozo csoportban
 * (mirror-exact); vizszintesen az ido, fuggolegesen a savok jobbrol
 * indulnak (time-direction); a huzas es a gorgo a tukor-iranyba pasztaz
 * (gestures-mirrored); a nyilak felcserelve jutnak a gephez
 * (keys-mirrored); a szoveg a sajat dobozaban visszafordul, stiluslappal es
 * attributummal is (text-readable); es mind a 12 RTL-matrixeset bajtra a
 * tarolt fixture (visual-rtl). A fixture-oket a shippelt bundle-bol a
 * sdk_rtl_snapshots.mjs --check meg a vitest elott ellenorzi.
 *
 * Statikusan: az elem a keretet a frameScene vegen tukrozi, a bemenetet az
 * attachInput iranyaval kapcsolja, az eszkozreteg, a csoportfa es az ejtes
 * a jobb szelrol mer, es a PDF szovege attributummal fordul vissza.
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
if (!entries.some((entry) => entry.name === "intl" && entry.input === "src/intl/index.ts")) failures.push("az intl belepesi pont hianyzik az entries.json-bol");

const read = (file) => codeOf(readFileSync(join(element, file), "utf8"));
const needles = [
  ["config.ts", ['directionOf(config, state) === "rtl" ? mirrorScene(scene) : scene']],
  ["timeline.ts", ["direction: () => direction", "mirrorTextNodes(flattenHtmlText(scene))", 'direction === "rtl" ? box.right - event.clientX']],
  ["tools.ts", ["function setX(", "MIRRORED_KEYS[event.key]", "box.right - event.clientX"]],
  ["groups.ts", ["mirrorStyle(", "MIRRORED_KEYS[sample.key]", "box.right - event.clientX"]],
];
for (const [file, list] of needles) {
  const source = read(file);
  for (const needle of list) if (!source.includes(needle)) failures.push(`az elem ${file}-jabol hianyzik: ${needle}`);
}
const attach = codeOf(readFileSync(join(core, "src", "dom", "attach.ts"), "utf8"));
for (const needle of ["xOf(event.clientX, box)", "-wheelEvent.deltaX", "MIRRORED_KEYS[key.key]"]) {
  if (!attach.includes(needle)) failures.push(`az attachInput-bol hianyzik: ${needle}`);
}

finish("G-RTL", failures);
