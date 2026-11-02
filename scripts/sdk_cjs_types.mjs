#!/usr/bin/env node
/**
 * Types for CommonJS consumers: a `.d.cts` next to every `dist/**\/*.d.ts`.
 *
 * Why it is needed. The packages are `"type": "module"`, so TypeScript reads
 * a `.d.ts` as ESM. A project importing with `require()` (node16 / nodenext,
 * the CJS side) therefore got ESM types for CJS code — arethetypeswrong calls
 * this "Masquerading as ESM", and at one point it reported exactly that on
 * both of the core's entry points. This bug throws nothing: the consumer just
 * gets a wrong `default` import and a wrong interop type, which the compiler
 * does not notice. That is why it is silent.
 *
 * The fix is not a second `tsc` run: it is the same declaration, with a
 * CJS-style extension and relative specifiers rewritten `.js` → `.cjs`, so
 * that a `.d.cts` points to its sibling `.d.cts`, not back to the ESM type.
 *
 * G-EXPORTS (scripts/sdk_check_exports.mjs) checks the result with attw and a
 * real node16 CJS consumer project — if this script missed something, it
 * fails there; you do not have to trust it here.
 *
 * Usage: `node ../../scripts/sdk_cjs_types.mjs` from the package directory.
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
  // With an empty dist, "done" would be a lie: the CJS types do not exist.
  process.stderr.write(`sdk_cjs_types: no .d.ts under ${dist}\n`);
  process.exit(1);
}
