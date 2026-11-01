import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isElision, matchExcerpt, normalizeLine, resolveExcerptSource } from "../scripts/excerpts.mjs";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = ["import { a } from 'x';", "", "const config = {", "  items,", "  lanes,", "  height: 320,", "};", "run(config);"].join("\n");

test("an excerpt may leave lines out, and mark where", () => {
  const result = matchExcerpt("import { a } from 'x';\nconst config = {\n  // …\n  height: 320,\n};", SOURCE);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 4);
});

test("indentation and inner spacing do not count, the text does", () => {
  assert.equal(normalizeLine("   const   a =  1; "), "const a = 1;");
  assert.equal(matchExcerpt("items,\n      lanes,", SOURCE).ok, true);
});

test("a changed line fails, and says which", () => {
  const result = matchExcerpt("const config = {\n  height: 300,", SOURCE);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [{ line: 2, text: "height: 300,", reason: "not in the source" }]);
});

test("a reordered line fails as out of order", () => {
  const result = matchExcerpt("  lanes,\n  items,", SOURCE);
  assert.equal(result.ok, false);
  assert.equal(result.missing[0].reason, "out of order");
});

test("elision marks in the comment styles of every language the docs use", () => {
  for (const mark of ["// …", "// ...", "…", "# …", "/* … */", "<!-- … -->", "{/* … */}", ""]) assert.equal(isElision(mark), true, mark);
  assert.equal(isElision("// a real comment"), false);
});

test("references resolve to an example or a template, and nothing else", () => {
  const example = resolveExcerptSource("example/recipe-gantt", docs);
  assert.ok(example.text.includes("createTimeline"));
  assert.ok(example.files.every((file) => file.includes(join("site", "examples", "recipe-gantt"))));
  const file = resolveExcerptSource("template/react/src/App.jsx", docs);
  assert.equal(file.files.length, 1);
  assert.match(resolveExcerptSource("example/does-not-exist", docs).error, /names nothing/);
  assert.match(resolveExcerptSource("packages/core/src/index.ts", docs).error, /neither example/);
  assert.match(resolveExcerptSource("example/../../../package.json", docs).error ?? "", /names nothing|neither/);
});
