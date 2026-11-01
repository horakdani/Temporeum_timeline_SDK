#!/usr/bin/env node
/**
 * A CommonJS-fogyasztó típusai: minden `dist/**\/*.d.ts` mellé egy `.d.cts`.
 *
 * Miért kell. A csomagok `"type": "module"`-ok, ezért a TypeScript egy
 * `.d.ts`-t ESM-nek olvas. Egy `require()`-rel importáló projekt (node16 /
 * nodenext, CJS oldal) így ESM-típusokat kapott a CJS-kódhoz — az
 * arethetypeswrong ezt „Masquerading as ESM”-nek hívja, és a P11 nyitásakor
 * a mag mindkét belépési pontján pontosan ezt mutatta. Ez a hiba nem dob
 * semmit: a fogyasztó csak rossz `default`-importot és rossz interop-típust
 * kap, amit a fordító nem vesz észre. Ezért néma.
 *
 * A javítás nem egy második `tsc`-futás: ugyanaz a deklaráció, CJS-formátumú
 * kiterjesztéssel, a relatív specifierek `.js` → `.cjs` átírásával, hogy egy
 * `.d.cts` a testvér `.d.cts`-ére mutasson, ne vissza az ESM-típusra.
 *
 * A G-EXPORTS (scripts/sdk_check_exports.mjs) az eredményt az attw-vel és
 * egy valódi node16-CJS fogyasztó-projekttel ellenőrzi — ha ez a szkript
 * valamit kihagyna, ott bukik, nem itt kell bízni benne.
 *
 * Használat: `node ../../scripts/sdk_cjs_types.mjs` a csomag könyvtárából.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");

function declarations(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return declarations(path);
    return name.endsWith(".d.ts") ? [path] : [];
  });
}

const RELATIVE = /((?:from|import)\s*\(?\s*["'])(\.{1,2}\/[^"']*?)\.js(["'])/g;

let written = 0;
for (const path of declarations(dist)) {
  const source = readFileSync(path, "utf8").replace(/\n\/\/# sourceMappingURL=.*$/m, "");
  writeFileSync(path.replace(/\.d\.ts$/, ".d.cts"), source.replace(RELATIVE, "$1$2.cjs$3"));
  written += 1;
}
if (written === 0) {
  // Üres dist mellett a „kész” hazugság lenne: a CJS-típusok nem léteznek.
  process.stderr.write(`sdk_cjs_types: nincs .d.ts a ${dist} alatt\n`);
  process.exit(1);
}
