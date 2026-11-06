import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { NPM_DRY_RUN_FLAGS } from "../../../scripts/sdk_npm_dry_run.mjs";

// X1: npm 11 refuses `publish --dry-run` for a version the registry already
// has, so the pack check failed on every push once 1.0.0 was on npm, and the
// documented first publication (by hand, then the workflow once to tag) died
// in the release build. The dry run's flags send it to a registry that is not
// there, so a version that is already published is no longer its business.

const run = promisify(execFile);
const scripts = new URL("../../../scripts/", import.meta.url);

test("a dry run of a version the registry already has still reports the tarball (X1)", async (t) => {
  const name = "@temporeum/timeline-dry-run-probe";
  const version = "1.0.0";
  const asked = [];
  // A registry where this exact version is already published.
  const registry = createServer((request, response) => {
    asked.push(request.url);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ name, "dist-tags": { latest: version }, versions: { [version]: { name, version } }, time: { [version]: "2026-11-06T00:00:00.000Z" } }));
  });
  await new Promise((done) => registry.listen(0, "127.0.0.1", done));
  t.after(() => registry.close());
  const url = `http://127.0.0.1:${String(registry.address().port)}/`;
  const dir = mkdtempSync(join(tmpdir(), "tl-dry-run-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version, files: ["index.js"] }));
  writeFileSync(join(dir, "index.js"), "export {};\n");
  // The host's own configuration points at the registry that has the version,
  // as a CI runner's or a maintainer's .npmrc would point at npmjs.com.
  const env = { ...process.env, npm_config_registry: url, [`npm_config_@temporeum:registry`]: url };
  const { stdout } = await run("npm", ["publish", ...NPM_DRY_RUN_FLAGS, "--json"], { cwd: dir, env, timeout: 60_000 });
  const report = JSON.parse(stdout.slice(stdout.indexOf("{")));
  const entry = report.files === undefined ? Object.values(report)[0] : report;
  assert.equal(entry.version, version);
  assert.deepEqual(entry.files.map((file) => file.path).sort(), ["index.js", "package.json"]);
  assert.deepEqual(asked, [], "the dry run asked the real registry");
});

test("every npm publish --dry-run of the pack check goes through the shared flags (X1)", () => {
  const source = readFileSync(new URL("sdk_check_pack.mjs", scripts), "utf8");
  const publishes = [...source.matchAll(/execFileSync\(\s*"npm",\s*\[\s*"publish"[^\]]*\]/g)].map((match) => match[0]);
  assert.ok(publishes.length >= 2, `found ${String(publishes.length)} npm publish calls`);
  const bare = publishes.filter((call) => !call.includes("...NPM_DRY_RUN_FLAGS"));
  assert.deepEqual(bare, []);
  assert.doesNotMatch(source, /"--dry-run"/);
});

test("a changelog that promises provenance names the first, hand-made publication's exception (X5)", () => {
  // RELEASING.md's first publication goes out by hand with --provenance=false,
  // so "published with npm provenance" alone is not true of 1.0.0.
  const packages = new URL("../../", import.meta.url);
  for (const dir of ["core", "web-component", "react", "vue", "svelte", "angular"]) {
    const changelog = readFileSync(new URL(`${dir}/CHANGELOG.md`, packages), "utf8");
    for (const line of changelog.split("\n").filter((text) => /provenance/i.test(text))) {
      assert.match(line, /unless 1\.0\.0 has to be created by hand/, `${dir}/CHANGELOG.md: ${line}`);
    }
  }
});

test("the release build runs the suite that fails on a workspace without tests, as CI does (X6)", () => {
  // `npm test` is `--workspaces --if-present`: a workspace without a `test`
  // script is skipped in silence. `test:all` (sdk_test_all.mjs) fails on it.
  const repo = new URL("../../../", import.meta.url);
  const candidates = [
    ".github/workflows/",
  ].map((dir) => new URL(dir, repo));
  const dir = candidates.find((url) => {
    try {
      return readFileSync(new URL("release.yml", url), "utf8").length > 0;
    } catch {
      return false;
    }
  });
  assert.ok(dir !== undefined, "no release workflow");
  for (const file of ["release.yml", "ci.yml"]) {
    const text = readFileSync(new URL(file, dir), "utf8");
    assert.doesNotMatch(text, /^\s*(?:run:\s*)?npm test\s*$/m, `${file} runs a bare npm test`);
  }
  assert.match(readFileSync(new URL("release.yml", dir), "utf8"), /npm run test:all/);
});

test("RELEASING.md says provenance needs the repository to be public (X7)", () => {
  const repo = new URL("../../../", import.meta.url);
  const text = [
    new URL("RELEASING.md", repo),
  ].map((url) => {
    try {
      return readFileSync(url, "utf8");
    } catch {
      return "";
    }
  }).join("\n");
  assert.match(text, /Provenance needs a public repository/);
});
