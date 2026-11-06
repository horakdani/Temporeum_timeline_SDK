/**
 * What a page of ours loads, in bytes: the one measurement the benchmarks and
 * the numbers check share.
 *
 * The benchmarks record which of our files a page loaded (`/core/…` from
 * packages/core/dist, `/element/…` from packages/web-component/dist) and their
 * size as shipped: our files ship unminified, so "minified" is oxc's output,
 * and gzip runs at level 9. The public texts state that number, and it went
 * stale without anyone noticing: after K11 the READMEs still said 55.8 kB for
 * a plain timeline's page while the build loaded 58.3 kB (K12, X9). So the
 * numbers check measures the recorded file list again on the current build,
 * with this same code, and fails when the recorded number has drifted.
 */
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { minifySync } from "rolldown/utils";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The URL prefixes the benchmark pages load our files from, and where they are. */
export const OWN_ROOTS = Object.freeze([
  ["/core/", join(repo, "packages", "core", "dist")],
  ["/element/", join(repo, "packages", "web-component", "dist")],
]);

export const gzipBytes = (text) => gzipSync(Buffer.from(text), { level: 9 }).length;

export function oxcMinify(file, code) {
  const out = minifySync(file, code, { compress: true, mangle: true });
  if (out.errors?.length) throw new Error(`minify ${file}: ${String(out.errors[0]?.message)}`);
  return out.code;
}

/** The file of one of our URL paths, or null when it is not ours. */
export function ownFile(pathname) {
  for (const [prefix, root] of OWN_ROOTS) {
    if (!pathname.startsWith(prefix)) continue;
    const target = resolve(join(root, decodeURIComponent(pathname.slice(prefix.length))));
    return target.startsWith(root + sep) ? target : null;
  }
  return null;
}

/** Bytes of our files as shipped: { min, minGz, oxcGz } in bytes. `fileFor` maps a URL path to its file. */
export function ownPageBytes(paths, fileFor = ownFile) {
  let min = 0;
  let minGz = 0;
  for (const path of paths) {
    const file = fileFor(path);
    if (file === null) throw new Error(`not one of our files: ${path}`);
    const shipped = oxcMinify(file, readFileSync(file, "utf8"));
    min += Buffer.byteLength(shipped);
    minGz += gzipBytes(shipped);
  }
  return { min, minGz };
}
