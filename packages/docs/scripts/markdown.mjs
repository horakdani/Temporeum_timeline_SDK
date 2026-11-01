/**
 * The docs site's Markdown: a deliberate subset, and nothing it does not
 * need.
 *
 * Why its own and not a package: the campaign's dependency policy holds for
 * dev dependencies too, and the subset the pages use is small — headings,
 * paragraphs, lists, pipe tables, block quotes, fenced code, and inline
 * code, emphasis and links. Raw HTML is not part of it: it is escaped, so a
 * page cannot smuggle markup past the accessibility check.
 *
 * Three things are not Markdown and are the reason the converter is ours:
 *
 *   ::: example <id>       a live, editable example (the builder renders it)
 *   {{name:argument}}      a block the builder fills in (results, API tables)
 *   ```js excerpt:<ref>    a code block that claims to be part of a running
 *                          example — G-EXAMPLES holds it to that claim
 *
 * `parseMarkdown` returns blocks; `renderBlocks` turns them into HTML with
 * the builder's callbacks for the two non-Markdown kinds.
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text for an HTML text node or attribute value. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** `Getting started` → `getting-started`: a heading's anchor. */
export function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[`*_[\]()]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

/**
 * Inline Markdown: `code`, **strong**, *em* / _em_, [text](href).
 * `rewriteHref` maps a link target (the builder turns `x.md` into `x.html`).
 */
export function renderInline(text, rewriteHref = (href) => href) {
  // Code spans first, out of the way of every other rule.
  const spans = [];
  let source = String(text).replace(/`([^`]+)`/g, (_, code) => {
    spans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${String(spans.length - 1)}\u0000`;
  });
  source = escapeHtml(source);
  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const target = rewriteHref(href.replace(/&amp;/g, "&"));
    return `<a href="${escapeHtml(target)}">${label}</a>`;
  });
  source = source.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  source = source.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  source = source.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
  // eslint-disable-next-line no-control-regex
  return source.replace(/\u0000(\d+)\u0000/g, (_, index) => spans[Number(index)]);
}

const FENCE = /^(`{3,})\s*([^\s`]*)\s*(.*)$/;
const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const DIRECTIVE = /^:::\s*example\s+([a-z0-9-]+)\s*$/;
const SLOT = /^\{\{([a-z]+)(?::([^}]*))?\}\}\s*$/;
const TABLE_RULE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  // A `|` inside a code span is part of the code, not a cell edge.
  const cells = [];
  let cell = "";
  let inCode = false;
  for (let i = 0; i < row.length; i += 1) {
    const c = row[i];
    if (c === "`") inCode = !inCode;
    if (c === "\\" && row[i + 1] === "|") {
      cell += "|";
      i += 1;
      continue;
    }
    if (c === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Markdown → blocks. Every block carries the 1-based line it started on, so
 * a check can point at the place in the file.
 */
export function parseMarkdown(source) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  const isBlank = (line) => line === undefined || line.trim() === "";
  const startsBlock = (line) =>
    FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || ORDERED.test(line) || DIRECTIVE.test(line) || SLOT.test(line) || line.startsWith(">") || line.trim().startsWith("|");

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    const at = i + 1;
    // An HTML comment is a note to the editor (a README's badge, a TODO): dropped.
    if (line.trim().startsWith("<!--")) {
      while (i < lines.length && !lines[i].includes("-->")) i += 1;
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const [, ticks, lang, rest] = fence;
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith(ticks)) {
        body.push(lines[i]);
        i += 1;
      }
      if (i >= lines.length) throw new SyntaxError(`line ${String(at)}: unclosed code fence`);
      i += 1;
      const excerpt = /(?:^|\s)excerpt:(\S+)/.exec(rest);
      blocks.push({ type: "code", line: at, lang: lang.toLowerCase(), excerpt: excerpt ? excerpt[1] : null, info: rest.trim(), text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", line: at, level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    const directive = DIRECTIVE.exec(line);
    if (directive) {
      blocks.push({ type: "example", line: at, id: directive[1] });
      i += 1;
      continue;
    }
    const slot = SLOT.exec(line);
    if (slot) {
      blocks.push({ type: "slot", line: at, name: slot[1], argument: (slot[2] ?? "").trim() });
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|") && TABLE_RULE.test(lines[i + 1] ?? "")) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((cell) => (cell.endsWith(":") ? (cell.startsWith(":") ? "center" : "right") : null));
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", line: at, head, align, rows });
      continue;
    }
    if (line.startsWith(">")) {
      const body = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", line: at, blocks: parseMarkdown(body.join("\n")) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const kind = bullet ? "ul" : "ol";
      const pattern = bullet ? BULLET : ORDERED;
      const items = [];
      const startNumber = ordered ? Number(ordered[2]) : 1;
      while (i < lines.length) {
        const match = pattern.exec(lines[i]);
        if (match) {
          items.push([bullet ? match[2] : match[3]]);
          i += 1;
          continue;
        }
        // A continuation: an indented line under the item, or a lazy one.
        if (!isBlank(lines[i]) && !startsBlock(lines[i])) {
          items[items.length - 1].push(lines[i].trim());
          i += 1;
          continue;
        }
        // A blank line ends the list unless the next line is another item.
        if (isBlank(lines[i]) && pattern.test(lines[i + 1] ?? "")) {
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", line: at, kind, start: startNumber, items: items.map((parts) => parts.join(" ")) });
      continue;
    }
    const paragraph = [];
    while (i < lines.length && !isBlank(lines[i]) && !(paragraph.length > 0 && startsBlock(lines[i]))) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", line: at, text: paragraph.join(" ") });
  }
  return blocks;
}

/**
 * Blocks → HTML. `hooks.example(block)` and `hooks.slot(block)` render the
 * two kinds the builder owns; `hooks.href` rewrites link targets.
 * Returns the HTML and the h2/h3 outline for the page's contents list.
 */
export function renderBlocks(blocks, hooks = {}) {
  const href = hooks.href ?? ((target) => target);
  const outline = [];
  const used = new Set();
  const inline = (text) => renderInline(text, href);
  const html = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        let id = slugify(block.text);
        for (let n = 2; used.has(id); n += 1) id = `${slugify(block.text)}-${String(n)}`;
        used.add(id);
        if (block.level === 2 || block.level === 3) outline.push({ level: block.level, id, text: block.text });
        html.push(`<h${String(block.level)} id="${id}">${inline(block.text)}</h${String(block.level)}>`);
        break;
      }
      case "paragraph":
        html.push(`<p>${inline(block.text)}</p>`);
        break;
      case "list": {
        const start = block.kind === "ol" && block.start !== 1 ? ` start="${String(block.start)}"` : "";
        html.push(`<${block.kind}${start}>${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${block.kind}>`);
        break;
      }
      case "table": {
        const cell = (tag, text, index) => {
          const align = block.align[index];
          return `<${tag}${align ? ` style="text-align:${align}"` : ""}${tag === "th" ? ' scope="col"' : ""}>${inline(text)}</${tag}>`;
        };
        html.push(
          `<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on a narrow screen"><table><thead><tr>${block.head.map((text, index) => cell("th", text, index)).join("")}</tr></thead>` +
            `<tbody>${block.rows.map((row) => `<tr>${row.map((text, index) => cell("td", text, index)).join("")}</tr>`).join("")}</tbody></table></div>`,
        );
        break;
      }
      case "quote":
        html.push(`<blockquote>${renderBlocks(block.blocks, hooks).html}</blockquote>`);
        break;
      case "code": {
        const lang = block.lang === "" ? "text" : block.lang;
        const source = block.excerpt ? `<p class="code-source">From the running example <a href="${escapeHtml(hooks.excerptHref?.(block.excerpt) ?? "#")}">${escapeHtml(block.excerpt)}</a></p>` : "";
        html.push(`<figure class="code"><pre tabindex="0"><code class="language-${escapeHtml(lang)}">${escapeHtml(block.text)}</code></pre>${source}</figure>`);
        break;
      }
      case "example":
        html.push(hooks.example ? hooks.example(block) : "");
        break;
      case "slot":
        html.push(hooks.slot ? hooks.slot(block) : "");
        break;
      default:
        throw new Error(`unknown block type ${String(block.type)}`);
    }
  }
  return { html: html.join("\n"), outline };
}
