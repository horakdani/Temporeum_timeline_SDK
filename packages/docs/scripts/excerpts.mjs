/**
 * Excerpts: the rule that keeps a code block in the docs from going stale.
 *
 * A documented code block is one of two things. Either it is a whole live
 * example (`::: example <id>`), and G-EXAMPLES runs it. Or it is marked as a
 * part of one — ```js excerpt:example/gantt — and then every line it shows
 * has to be in that example's source, in the same order. Lines may be left
 * out (an excerpt is a part), and `// …` marks where; nothing may be added,
 * changed or reordered. So a README snippet cannot drift away from code that
 * runs: the day the example changes, the snippet fails the check.
 *
 * What is exempt: shell sessions and plain text (`bash`, `sh`, `shell`,
 * `console`, `text`). Every other block — and a block with no language — has
 * to be one or the other.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const EXEMPT_LANGS = new Set(["bash", "sh", "shell", "console", "text"]);

/** Folders under a template that are output or installs, never source. */
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".nuxt", ".output", ".astro", ".vite", "build"]);
const SKIP_FILES = new Set(["package-lock.json"]);

/** One line as the comparison sees it: trimmed, inner runs of space collapsed. */
export function normalizeLine(line) {
  return line.trim().replace(/\s+/g, " ");
}

/** A line an excerpt may show without the source having it: blank, or an elision mark. */
export function isElision(line) {
  const text = normalizeLine(line);
  return text === "" || /^(\/\/|#|\/\*|<!--|\{\/\*)?\s*(…|\.\.\.)\s*(\*\/|-->|\*\/\})?$/.test(text);
}

/**
 * Does every non-elided line of `excerpt` appear in `source`, in order?
 * Returns the lines that did not, with their 1-based line in the excerpt.
 */
export function matchExcerpt(excerpt, source) {
  const wanted = excerpt.split("\n").map((text, index) => ({ line: index + 1, text })).filter((entry) => !isElision(entry.text));
  const haystack = source.split("\n").map(normalizeLine);
  const missing = [];
  let at = 0;
  for (const entry of wanted) {
    const needle = normalizeLine(entry.text);
    let found = -1;
    for (let i = at; i < haystack.length; i += 1) {
      if (haystack[i] === needle) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      // Is it there at all, only earlier? Say so: a reorder reads differently from a change.
      const earlier = haystack.indexOf(needle);
      missing.push({ line: entry.line, text: entry.text.trim(), reason: earlier >= 0 && earlier < at ? "out of order" : "not in the source" });
      continue;
    }
    at = found + 1;
  }
  return { ok: missing.length === 0, checked: wanted.length, missing };
}

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith(".")) walk(path, out);
    } else if (!SKIP_FILES.has(name)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * The source text an excerpt reference names.
 *
 *   example/<id>[/<file>]     packages/docs/site/examples/<id>
 *   template/<name>[/<path>]  packages/docs/templates/<name>
 *
 * A folder is its files, in path order, one after another.
 */
export function resolveExcerptSource(ref, docsDir) {
  const match = /^(example|template)\/(.+)$/.exec(ref);
  if (!match) return { error: `"${ref}" is neither example/<id> nor template/<name>` };
  const root = join(docsDir, match[1] === "example" ? join("site", "examples") : "templates");
  const target = join(root, match[2]);
  if (!target.startsWith(root) || !existsSync(target)) return { error: `"${ref}" names nothing (${relative(docsDir, target)})` };
  const files = statSync(target).isDirectory() ? walk(target, []) : [target];
  if (files.length === 0) return { error: `"${ref}" is an empty folder` };
  return { files, text: files.map((file) => readFileSync(file, "utf8")).join("\n") };
}
