#!/usr/bin/env node
/**
 * A nem-alap belépési pontok méretkerete: határköltség.
 *
 * Az alap belépési pont (`index`) kerete önálló mérés, azt a size-limit
 * kényszeríti ki (a package.json "size-limit" mezője, az entries.json-ból
 * generálva). Egy másik belépési pont (/dom, és később /gantt, /schedule…)
 * viszont az alap nélkül nem használható: a magot onnan importálja. Az ára
 * tehát az, amennyivel TÖBBET tölt le az, aki az alap mellé ezt is behúzza:
 *
 *     határköltség = méret(alap + pont) − méret(alap)
 *
 * mindkét tag `import *`-gal, ugyanazzal a mérővel: rolldown-bundle a kiadott
 * ESM-ből, minify, gzip 9. Az önálló méretet is kiírja tájékoztatásul.
 *
 * Miért nem az önálló méret (a P16 keret-döntése, sdk/state.json): a /dom
 * kódja a darabolt buildben bájtra azonos a korábbival (9712 B minify), csak a
 * függvények sorrendje más, és ettől a gzip 41 B-tal nagyobb — az önálló
 * mérés a sorrendet mérte, nem a kódot. Egy /gantt önálló mérése pedig a mag
 * felét is tartalmazná, és semmit nem mondana arról, mit ad hozzá a Gantt.
 *
 * Használat: `node ../../scripts/sdk_size.mjs` (a `npm run size` része), a
 * buildelt dist-en. Bármelyik keret túllépése exit 1.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import { CORE_DIR, readEntries } from "./sdk_entries.mjs";

const VIRTUAL = "\0sdk-size-entry";

/** Az `names` belépési pontok együttes `import *`-os ára, minify + gzip 9. */
export async function measure(coreDir, names) {
  const files = names.map((name) => join(coreDir, "dist", `${name}.mjs`));
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`nincs buildelt belépési pont: ${file} — futtasd előbb a buildet`);
  }
  const source = files.map((file, i) => `import * as m${String(i)} from ${JSON.stringify(file)};`).join("\n") + `\nglobalThis.__sdkSize = [${files.map((_, i) => `m${String(i)}`).join(", ")}];\n`;
  const bundle = await rolldown({
    input: VIRTUAL,
    logLevel: "silent",
    plugins: [
      {
        name: "sdk-size-entry",
        resolveId: (id) => (id === VIRTUAL ? id : null),
        load: (id) => (id === VIRTUAL ? source : null),
      },
    ],
  });
  const { output } = await bundle.generate({ format: "es", minify: true });
  await bundle.close();
  const code = output.map((chunk) => (chunk.type === "chunk" ? chunk.code : "")).join("");
  return gzipSync(code, { level: 9 }).length;
}

export function parseLimit(limit) {
  return Math.round(Number.parseFloat(limit) * 1000);
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith("sdk_size.mjs");
if (isMain) {
  const entries = readEntries();
  const base = await measure(CORE_DIR, ["index"]);
  console.log(`  alap      index  ${String(base).padStart(6)} B  (a kerete a size-limit-ben: ${entries.find((e) => e.name === "index").limit})`);
  const problems = [];
  for (const entry of entries.filter((e) => e.name !== "index")) {
    const together = await measure(CORE_DIR, ["index", entry.name]);
    const alone = await measure(CORE_DIR, [entry.name]);
    const marginal = together - base;
    const limit = parseLimit(entry.limit);
    const ok = marginal <= limit;
    console.log(`  ${ok ? "ok  " : "HIBA"}      ${entry.name.padEnd(6)} ${String(marginal).padStart(6)} B határköltség / ${entry.limit} keret  (önállóan ${String(alone)} B, az alappal együtt ${String(together)} B)`);
    if (!ok) problems.push(`${entry.name}: határköltség ${String(marginal)} B > ${entry.limit}`);
  }
  if (problems.length > 0) {
    console.error(`\nMéretkeret túllépve: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log("\nsdk_size: minden nem-alap belépési pont a határköltség-keretén belül.");
}
