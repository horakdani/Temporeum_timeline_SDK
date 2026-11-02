#!/usr/bin/env node
/**
 * The second half of G-TYPES — proves that there is no `any` in the PUBLIC API.
 *
 * `tsc --noEmit` checks strict mode, but an `any` can still get through on the
 * public surface (e.g. it leaks in through inference or from a third party's
 * types). eslint's `no-explicit-any` catches a written `any`, not an inferred
 * one. This script looks at the END RESULT: it emits the .d.ts files into a
 * temporary directory and searches them for `any`.
 *
 * Why it matters: the type promise is part of the product. An `any` on the
 * public surface means the user gets no autocomplete exactly where the
 * library promises the most.
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

/** Strips the comments, so that explanatory text does not give a false hit. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

try {
  execFileSync(
    process.execPath,
    [
      // typescript may be hoisted to the root or sit in the package; we resolve
      // it rather than guess a path.
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
      "ERROR: not a single .d.ts was produced — the check did not run, so this is a FAILURE.",
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
    console.error(`\nERROR: ${hits.length} \`any\` on the public type surface:`);
    for (const hit of hits) console.error(`  ${hit}`);
    console.error("\nG-TYPES FAILED.");
    process.exit(1);
  }

  console.log(
    `  ok   ${declarations.length} .d.ts files, 0 \`any\` on the public surface`,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
