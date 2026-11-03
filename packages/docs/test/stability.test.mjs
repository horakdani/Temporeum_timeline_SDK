import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// What stability.md calls public is what 1.x promises not to break. A
// package it leaves out (the Vue, Svelte and Angular adapters, until W14 of
// the quality round) has no promise at all.
const pages = new URL("../site/pages/", import.meta.url);
const packages = new URL("../../", import.meta.url);

test("the stability page's public API names every published package", () => {
  const text = readFileSync(new URL("stability.md", pages), "utf8");
  const section = text.slice(text.indexOf("## What is public"), text.indexOf("\n## ", text.indexOf("## What is public") + 1));
  assert.ok(section.length > 0, "no 'What is public' section");
  const published = readdirSync(packages)
    .map((dir) => {
      try {
        return JSON.parse(readFileSync(new URL(`${dir}/package.json`, packages), "utf8"));
      } catch {
        return undefined;
      }
    })
    .filter((manifest) => manifest !== undefined && manifest.private !== true && String(manifest.name).startsWith("@temporeum/"))
    .map((manifest) => manifest.name);
  assert.equal(published.length, 6);
  const missing = published.filter((name) => !section.includes(`\`${name}\``));
  assert.deepEqual(missing, []);
});
