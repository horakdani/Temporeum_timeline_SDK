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

test("the home page's title says the name once, every page has the icon, and the UMD globals are all named (R86)", async () => {
  const out = join(scratch, "out-r86");
  await buildSite({ outDir: out });
  const home = readFileSync(join(out, "index.html"), "utf8");
  assert.match(home, /<title>Temporeum Timeline<\/title>/);
  assert.match(readFileSync(join(out, "stability.html"), "utf8"), /<title>Stability — Temporeum Timeline<\/title>/);
  assert.match(home, /<link rel="icon" href="assets\/favicon\.svg" type="image\/svg\+xml">/);
  assert.ok(existsSync(join(out, "assets", "favicon.svg")));
  // entry-points.md named 6 of the 15 globals.
  const entries = JSON.parse(readFileSync(join(docs, "..", "core", "entries.json"), "utf8")).entries;
  const page = readFileSync(join(docs, "site", "pages", "reference", "entry-points.md"), "utf8");
  for (const entry of entries) assert.ok(page.includes(`\`${entry.umd}\``), entry.umd);
});

test("a demo that turns vertical on a phone gets a taller frame there, from its meta.json (narrowHeight)", async () => {
  const out = join(scratch, "out-narrow");
  await buildSite({ outDir: out });
  const home = readFileSync(join(out, "index.html"), "utf8");
  // The chronicle turns vertical on a phone: 920 px across a desktop, 1290 down a phone.
  assert.match(home, /<iframe class="example-frame" title="Five thousand years[^"]*" sandbox="[^"]*" style="height:920px;--frame-narrow:1290px" data-narrow><\/iframe>/);
  assert.match(readFileSync(join(out, "assets", "site.css"), "utf8"), /@media \(max-width: 640px\) \{ \.example-frame\[data-narrow\] \{ height: var\(--frame-narrow\) !important; \} \}/);
  // A frame without it keeps its one height.
  assert.doesNotMatch(home.replace(/<iframe[^>]*Five thousand years[^>]*><\/iframe>/, ""), /data-narrow/);
  const dir = copy("narrow-height");
  const meta = join(dir, "site", "examples", "showcase-chronicle", "meta.json");
  writeFileSync(meta, JSON.stringify({ ...JSON.parse(readFileSync(meta, "utf8")), narrowHeight: "tall" }));
  await assert.rejects(buildSite({ docsDir: dir, outDir: join(dir, "dist") }), /narrowHeight is a whole number of pixels/);
});
