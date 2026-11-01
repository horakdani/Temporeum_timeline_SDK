// A build ujjlenyomata: a dist/build.json a FORRAS lenyomatat hordozza.
//
// Miert: a bongeszos kapuk (G-E2E-TOUCH, G-RESPONSIVE, G-PERF, G-MEMORY) a
// buildelt dist-et futtatjak. Ha a build nemán elbukna es a regi dist maradna,
// a keszlet zolden hazudhatna — a regi kodrol. A merö szkript a lapon at
// kiolvassa ezt a fajlt, ujraszamolja a lenyomatot a forrasbol, es ha a ketto
// elter, a meres BUKAS. (Ajanlasok, 8. szakasz; kapu-allando-checkek 6.2.)
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
 * A forras lenyomata: minden src/ alatti fajl utja es tartalma, rendezve. A
 * csomag alapbol a core; a P13 ota az element is ezt hasznalja (a
 * G-PERF-PUBLIC a shippelt element-bundle-t meri).
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
