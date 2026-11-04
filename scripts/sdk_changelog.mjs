#!/usr/bin/env node
/**
 * The release heading of the six changelogs.
 *
 *   node scripts/sdk_changelog.mjs --date [YYYY-MM-DD]   # "## <version> — Unreleased" → "## <version> — <date>"
 *   node scripts/sdk_changelog.mjs --check               # fails unless every changelog dates the version
 *   node scripts/sdk_changelog.mjs --check-entry         # every changelog has an entry for the version, dated or not (CI)
 *
 * Until a release is prepared, the entry being written is "Unreleased". The
 * pull request that prepares the release dates it (`--date`, today by
 * default), and the release workflow runs `--check` before it publishes
 * anything: a version on npm whose changelog still says "Unreleased" would
 * be a release nobody can date.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["core", "web-component", "react", "vue", "svelte", "angular"];
const version = JSON.parse(readFileSync(join(repo, "packages", "core", "package.json"), "utf8")).version;
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^## ${escaped} — (.+)$`, "m");

const args = process.argv.slice(2);
const failures = [];
if (args[0] === "--date") {
  const date = args[1] ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`not a date (YYYY-MM-DD): ${date}`);
    process.exit(2);
  }
  for (const name of PACKAGES) {
    const file = join(repo, "packages", name, "CHANGELOG.md");
    const text = readFileSync(file, "utf8");
    const match = heading.exec(text);
    if (match === null) failures.push(`packages/${name}/CHANGELOG.md has no "## ${version} — …" heading`);
    else if (match[1] !== "Unreleased" && match[1] !== date) failures.push(`packages/${name}/CHANGELOG.md already dates ${version}: ${match[1]}`);
    else writeFileSync(file, text.replace(heading, `## ${version} — ${date}`));
  }
  if (failures.length === 0) console.log(`dated ${version} as ${date} in ${String(PACKAGES.length)} changelogs`);
} else if (args[0] === "--check") {
  for (const name of PACKAGES) {
    const match = heading.exec(readFileSync(join(repo, "packages", name, "CHANGELOG.md"), "utf8"));
    if (match === null) failures.push(`packages/${name}/CHANGELOG.md has no "## ${version} — …" heading`);
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(match[1])) failures.push(`packages/${name}/CHANGELOG.md does not date ${version} ("${match[1]}"): run node scripts/sdk_changelog.mjs --date`);
  }
  if (failures.length === 0) console.log(`every changelog dates ${version}`);
} else if (args[0] === "--check-entry") {
  // On every change, not only at release: the version's heading is there and
  // says something, so a release is never prepared from an empty entry.
  for (const name of PACKAGES) {
    const text = readFileSync(join(repo, "packages", name, "CHANGELOG.md"), "utf8");
    const match = heading.exec(text);
    if (match === null) {
      failures.push(`packages/${name}/CHANGELOG.md has no "## ${version} — …" heading`);
      continue;
    }
    const rest = text.slice(match.index + match[0].length);
    const body = rest.slice(0, rest.search(/^## /m) === -1 ? rest.length : rest.search(/^## /m));
    if (!/^\s*- \S/m.test(body)) failures.push(`packages/${name}/CHANGELOG.md: the ${version} entry lists nothing`);
  }
  if (failures.length === 0) console.log(`every changelog has an entry for ${version}`);
} else {
  console.error("usage: node scripts/sdk_changelog.mjs --date [YYYY-MM-DD] | --check | --check-entry");
  process.exit(2);
}
for (const failure of failures) console.error(`FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
