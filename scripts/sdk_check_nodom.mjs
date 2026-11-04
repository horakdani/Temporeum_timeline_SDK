#!/usr/bin/env node
/**
 * The nodom check: the core works without a DOM — proven on the BUILT package.
 *
 * Vitest's `node` environment runs the source; this script runs the shipped
 * bundle. The two are not the same claim: the server-side path stands or
 * falls on whether the published package loads in a bare Node.
 *
 * So it builds first (so that we do not measure a stale dist), then runs the
 * probe in a separate process.
 */

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(repoRoot, "packages", "core");
const probe = join(repoRoot, "scripts", "sdk_nodom_probe.mjs");

try {
  // A fresh dist: a "green" measured on a stale bundle is exactly the kind
  // of silence that makes the check meaningless.
  execFileSync("npm", ["run", "--silent", "build"], { cwd: packageDir, stdio: "inherit" });
} catch {
  console.error("  FAIL the package did not build — the server-side probe cannot run");
  console.error("\nnodom FAILED: without a build there is nothing to measure.");
  process.exit(1);
}

try {
  execFileSync(process.execPath, [probe, packageDir], { cwd: repoRoot, stdio: "inherit" });
} catch {
  process.exit(1);
}

console.log("\nnodom passed: the built ESM and CJS packages run even with booby-trapped DOM globals.");
