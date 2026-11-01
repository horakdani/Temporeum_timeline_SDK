#!/usr/bin/env node
/**
 * G-ALL — a teljes keszlet zold, MINDEN csomagban, nem csak a core-ban.
 *
 * Miert nem eleg a `npm run test --workspaces --if-present`: az `--if-present`
 * a `test` szkript nelkuli workspace-t CSENDBEN atugorja, es a parancs
 * zolden ter vissza. Egy csomag, amelynek nincs tesztje, igy pont ugy nez ki,
 * mint egy, amelynek minden tesztje atment — a "MINDEN csomagban" allitas a
 * kimenetbol nem bizonyithato. (A P12 elejen a docs-workspace-nek nem volt
 * `test`-je.)
 *
 * Ez a szkript a gyoker package.json workspace-listajat jarja be: ha egy
 * workspace-nek nincs `test` szkriptje, az BUKAS, nem kihagyas. Utana
 * csomagonkent, sorban futtat (a bongeszos keszletek portjai nem utkoznek),
 * es a vegen csomagonkent kiirja az exit kodot es az idot.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const workspaces = root.workspaces ?? [];
const results = [];
const problems = [];

if (workspaces.length === 0) problems.push("a gyoker package.json nem deklaral workspace-t");
for (const workspace of workspaces) {
  const manifestPath = join(repo, workspace, "package.json");
  if (!existsSync(manifestPath)) {
    problems.push(`${workspace}: nincs package.json`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest.scripts?.test !== "string" || manifest.scripts.test.trim() === "") {
    problems.push(`${manifest.name ?? workspace}: nincs "test" szkript — egy teszt nelkuli csomag nem "zold"`);
    continue;
  }
  const started = Date.now();
  process.stdout.write(`\n=== ${manifest.name} — npm run test\n`);
  const run = spawnSync("npm", ["run", "test", "-w", manifest.name], { cwd: repo, stdio: "inherit" });
  results.push({ name: manifest.name, status: run.status ?? 1, seconds: Math.round((Date.now() - started) / 1000) });
}

process.stdout.write("\nG-ALL — csomagonkent:\n");
for (const result of results) process.stdout.write(`  ${result.status === 0 ? "ok   " : "BUKAS"}  ${result.name} (exit ${String(result.status)}, ${String(result.seconds)} s)\n`);
for (const result of results.filter((r) => r.status !== 0)) problems.push(`${result.name}: a teszt ${String(result.status)} koddal lepett ki`);
if (problems.length > 0) {
  for (const problem of problems) process.stdout.write(`  ✗ ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`\nG-ALL: mind a ${String(results.length)} workspace tesztje lefutott es zold.\n`);
