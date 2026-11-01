#!/usr/bin/env node
/**
 * G-NODOM: a mag DOM nelkul is mukodik — a LEFORDITOTT csomagon bizonyitva.
 *
 * A vitest `node` environmentje a forrast futtatja; ez a szkript a shippelt
 * bundle-t. A ketto nem ugyanaz az allitas: a szerveroldali ut azon all vagy
 * bukik, hogy a kozzetett csomag toltodik-e be egy csupasz Node-ban.
 *
 * Ezert elobb epit (hogy ne egy elavult dist-et mersunk), aztan kulon
 * processzben lefuttatja a probat.
 */

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(repoRoot, "packages", "core");
const probe = join(repoRoot, "scripts", "sdk_nodom_probe.mjs");

try {
  // Friss dist: egy elavult bundle-on mert "zold" pont az a fajta csend,
  // amitol a kapu ertelmet veszti.
  execFileSync("npm", ["run", "--silent", "build"], { cwd: packageDir, stdio: "inherit" });
} catch {
  console.error("  HIBA a csomag nem epult fel — a szerveroldali proba nem futtathato");
  console.error("\nG-NODOM BUKOTT: build nelkul nincs mit megmerni.");
  process.exit(1);
}

try {
  execFileSync(process.execPath, [probe, packageDir], { cwd: repoRoot, stdio: "inherit" });
} catch {
  process.exit(1);
}

console.log("\nG-NODOM atment: a lefordított ESM és CJS csomag elaknásított DOM-globálokkal is lefut.");
