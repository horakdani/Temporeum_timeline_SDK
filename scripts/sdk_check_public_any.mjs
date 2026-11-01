#!/usr/bin/env node
/**
 * G-TYPES második fele — bizonyítja, hogy a PUBLIKUS API-ban nincs `any`.
 *
 * A `tsc --noEmit` a strict módot ellenőrzi, de egy `any` a publikus
 * felületen attól még átmehet (pl. következtetésből vagy egy harmadik fél
 * típusából szivárog be). Az eslint `no-explicit-any` a kiírt `any`-t fogja
 * meg, a kikövetkeztetettet nem. Ez a szkript a VÉGEREDMÉNYT nézi: kiíratja a
 * .d.ts-eket egy ideiglenes könyvtárba, és abban keres `any`-t.
 *
 * Miért fontos: a típusígéret a termék része. Egy `any` a publikus felületen
 * azt jelenti, hogy a felhasználó pont ott nem kap autocomplete-et, ahol a
 * könyvtár a legtöbbet ígéri.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";

const packageDir = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : process.cwd();

const tsconfig = join(packageDir, "tsconfig.build.json");
const outDir = mkdtempSync(join(tmpdir(), "sdk-any-"));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** A megjegyzéseket kiszedi, hogy a magyarázó szöveg ne adjon hamis találatot. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

try {
  execFileSync(
    process.execPath,
    [
      // A typescript hoistolódhat a gyökérbe vagy a csomagba; feloldatjuk,
      // nem tippelünk útvonalat.
      createRequire(join(packageDir, "package.json")).resolve(
        "typescript/bin/tsc",
      ),
      "-p",
      tsconfig,
      "--emitDeclarationOnly",
      "--declaration",
      "--outDir",
      outDir,
    ],
    { stdio: "inherit", cwd: packageDir },
  );

  const declarations = walk(outDir);
  if (declarations.length === 0) {
    console.error(
      "HIBA: egyetlen .d.ts sem keletkezett — az ellenőrzés nem futott le, tehát BUKÁS.",
    );
    process.exit(1);
  }

  const hits = [];
  for (const path of declarations) {
    const lines = stripComments(readFileSync(path, "utf8")).split("\n");
    lines.forEach((line, index) => {
      if (/\bany\b/.test(line)) {
        hits.push(`${relative(outDir, path)}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  if (hits.length > 0) {
    console.error(`\nHIBA: ${hits.length} \`any\` a publikus típusfelületen:`);
    for (const hit of hits) console.error(`  ${hit}`);
    console.error("\nG-TYPES BUKOTT.");
    process.exit(1);
  }

  console.log(
    `  ok   ${declarations.length} .d.ts fájl, 0 \`any\` a publikus felületen`,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
