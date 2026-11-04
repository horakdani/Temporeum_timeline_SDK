// The build's fingerprint: dist/build.json carries the hash of the SOURCE.
//
// Why: the browser checks (the e2e-touch check, the responsive check, the perf check, the memory check) run
// the built dist. If the build failed silently and the old dist stayed, the
// suite could report green falsely — about the old code. The measuring script
// reads this file through the page, recomputes the hash from the source, and
// if the two differ, the measurement FAILS.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function files(dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    })
    .sort();
}

/**
 * The source hash: the path and content of every file under src/, sorted.
 * The package defaults to the core; the element uses it too (the
 * the perf-public check measures the shipped element bundle).
 */
export function sourceHash(packageDir = coreDir) {
  const hash = createHash("sha256");
  for (const path of [...files(join(packageDir, "src")), join(packageDir, "rollup.config.mjs")]) {
    hash.update(relative(packageDir, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageDir = resolve(process.argv[2] ?? coreDir);
  writeFileSync(
    join(packageDir, "dist", "build.json"),
    `${JSON.stringify({ source: sourceHash(packageDir) }, null, 2)}\n`,
  );
}
