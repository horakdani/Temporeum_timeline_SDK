import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildSite, loadExamples } from "../scripts/build-site.mjs";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "tl-docs-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A copy of the site to break on purpose. */
function copy(name) {
  const dir = join(scratch, name);
  cpSync(join(docs, "site"), join(dir, "site"), { recursive: true });
  cpSync(join(docs, "templates"), join(dir, "templates"), { recursive: true, filter: (source) => !source.includes("node_modules") });
  return dir;
}

test("the real site builds, and its manifest lists every page and example exactly once", async () => {
  const out = join(scratch, "out");
  const manifest = await buildSite({ outDir: out });
  const nav = JSON.parse(readFileSync(join(docs, "site", "nav.json"), "utf8")).flatMap((section) => section.pages);
  assert.deepEqual(
    manifest.pages.map((page) => page.id),
    nav,
  );
  const ids = manifest.examples.map((example) => example.id);
  assert.deepEqual([...ids].sort(), [...loadExamples().keys()].sort());
  assert.equal(new Set(ids).size, ids.length);
  for (const page of manifest.pages) assert.ok(existsSync(join(out, page.path)), page.path);
  // The shipped bundles are in the site, and the import map points at them.
  for (const file of ["lib/core/index.mjs", "lib/core/dom.mjs", "lib/element/index.mjs", "lib/element/define.mjs", "lib/element/element.shared.mjs"]) {
    assert.ok(existsSync(join(out, file)), file);
  }
  // The API tables come from the source: TimelineConfig has its fields.
  const config = manifest.apiTables.find((table) => table.name === "TimelineConfig");
  for (const member of ["items", "lanes", "editing", "cluster", "orientation"]) assert.ok(config.members.includes(member), member);
});

test("a page missing from the navigation fails the build", async () => {
  const dir = copy("orphan-page");
  writeFileSync(join(dir, "site", "pages", "orphan.md"), "# Orphan\n\nNobody links here.\n");
  await assert.rejects(buildSite({ docsDir: dir, outDir: join(dir, "dist") }), /orphan\.md is not in nav\.json/);
});

test("an example no page shows fails the build", async () => {
  const dir = copy("orphan-example");
  cpSync(join(dir, "site", "examples", "quick-start"), join(dir, "site", "examples", "unused"), { recursive: true });
  await assert.rejects(buildSite({ docsDir: dir, outDir: join(dir, "dist") }), /example "unused" is on no page/);
});

test("an example without a claim fails the build: the suite could not tell it ran", async () => {
  const dir = copy("no-claim");
  writeFileSync(join(dir, "site", "examples", "quick-start", "meta.json"), JSON.stringify({ title: "x", expect: [] }));
  await assert.rejects(buildSite({ docsDir: dir, outDir: join(dir, "dist") }), /needs "expect"/);
});

test("a link to a page that does not exist fails the build", async () => {
  const dir = copy("dead-link");
  const index = join(dir, "site", "pages", "index.md");
  writeFileSync(index, `${readFileSync(index, "utf8")}\nSee [nothing](nowhere.md).\n`);
  await assert.rejects(buildSite({ docsDir: dir, outDir: join(dir, "dist") }), /links to nowhere\.md, which is not a page/);
});
