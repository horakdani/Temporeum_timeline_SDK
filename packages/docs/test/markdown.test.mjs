import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeHtml, parseMarkdown, renderBlocks, renderInline, slugify } from "../scripts/markdown.mjs";

test("headings get anchors, and a repeated heading a numbered one", () => {
  const { html, outline } = renderBlocks(parseMarkdown("# Title\n\n## How it works\n\n## How it works\n\n### Detail"));
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<h2 id="how-it-works">/);
  assert.match(html, /<h2 id="how-it-works-2">/);
  assert.deepEqual(
    outline.map((entry) => [entry.level, entry.id]),
    [
      [2, "how-it-works"],
      [2, "how-it-works-2"],
      [3, "detail"],
    ],
  );
  assert.equal(slugify("`createTimeline(container)`"), "createtimelinecontainer");
});

test("a fence keeps its text verbatim and its excerpt reference", () => {
  const [block] = parseMarkdown("```js excerpt:example/gantt\nconst a = 1 < 2;\n\n  indented();\n```");
  assert.equal(block.type, "code");
  assert.equal(block.lang, "js");
  assert.equal(block.excerpt, "example/gantt");
  assert.equal(block.text, "const a = 1 < 2;\n\n  indented();");
  const { html } = renderBlocks([block], { excerptHref: () => "recipes/gantt.html#example-gantt" });
  assert.match(html, /const a = 1 &lt; 2;/);
  assert.match(html, /From the running example <a href="recipes\/gantt.html#example-gantt">example\/gantt<\/a>/);
});

test("an unclosed fence is an error with its line, not a silently swallowed page", () => {
  assert.throws(() => parseMarkdown("text\n\n```js\nnever closed"), /line 3: unclosed code fence/);
});

test("raw HTML is escaped, so a page cannot smuggle markup past the checks", () => {
  const { html } = renderBlocks(parseMarkdown('A <script>alert("x")</script> paragraph'));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.equal(escapeHtml(`<a href="x">'`), "&lt;a href=&quot;x&quot;&gt;&#39;");
});

test("inline code is protected from emphasis and links", () => {
  assert.equal(renderInline("`a*b*c` and *em*"), "<code>a*b*c</code> and <em>em</em>");
  assert.equal(renderInline("**strong** `[x](y)`"), "<strong>strong</strong> <code>[x](y)</code>");
  assert.equal(renderInline("snake_case_name stays"), "snake_case_name stays");
});

test("links go through the rewriter", () => {
  const { html } = renderBlocks(parseMarkdown("See [the guide](guides/editing.md#rules)."), { href: (href) => href.replace(".md", ".html") });
  assert.match(html, /<a href="guides\/editing.html#rules">the guide<\/a>/);
});

test("a pipe table, with a pipe inside a code span and alignment", () => {
  const [table] = parseMarkdown("| Key | Does |\n|---|--:|\n| `a | b` | right |\n| x | y |");
  assert.equal(table.type, "table");
  assert.deepEqual(table.head, ["Key", "Does"]);
  assert.deepEqual(table.align, [null, "right"]);
  assert.deepEqual(table.rows[0], ["`a | b`", "right"]);
  const { html } = renderBlocks([table]);
  assert.match(html, /<th scope="col">Key<\/th>/);
  assert.match(html, /<td style="text-align:right">right<\/td>/);
});

test("lists keep continuation lines, and a numbered list its start", () => {
  const [list] = parseMarkdown("- one\n  continued\n- two\n\n- three");
  assert.deepEqual(list.items, ["one continued", "two", "three"]);
  const [ordered] = parseMarkdown("3. third\n4. fourth");
  assert.equal(ordered.start, 3);
  assert.match(renderBlocks([ordered]).html, /<ol start="3">/);
});

test("the two non-Markdown blocks reach the builder's hooks", () => {
  const blocks = parseMarkdown("::: example recipe-log\n\n{{api:TimelineConfig}}");
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["example", "slot"],
  );
  const { html } = renderBlocks(blocks, { example: (block) => `[example ${block.id}]`, slot: (block) => `[${block.name}:${block.argument}]` });
  assert.equal(html, "[example recipe-log]\n[api:TimelineConfig]");
});

test("an HTML comment is a note to the editor and is dropped", () => {
  const blocks = parseMarkdown("<!-- badge\nmore -->\nText");
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["paragraph"],
  );
});
