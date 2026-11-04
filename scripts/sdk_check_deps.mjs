#!/usr/bin/env node
/**
 * The deps check — proves that the core has ZERO runtime dependencies.
 *
 * In two independent ways, because each catches a different bug:
 *
 *  1. The manifests: the core has no dependencies / peerDependencies /
 *     optionalDependencies. This checks the intent.
 *  2. The compiled bundles: not a single "bare" import or require specifier
 *     is left in them. This checks reality — an undeclared import does not
 *     show in the manifest, but it does in the output. With a REAL PARSER,
 *     not a text pattern: the comment on section 2 says why.
 *
 * If dist does not exist, that is a FAILURE, not a skip: check 2 did not run,
 * so the check cannot claim it proved anything.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// rollup is already the build tool: its parser is not a new dependency.
import { parseAst } from "rollup/parseAst";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = "@temporeum/timeline-core";
const WORKSPACE_SCOPE = "@temporeum/";

const problems = [];
const notes = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const rootManifest = readJson(join(repoRoot, "package.json"));
const workspaceDirs = (rootManifest.workspaces ?? []).map((w) =>
  join(repoRoot, w),
);
if (workspaceDirs.length === 0) {
  problems.push("The root package.json declares no workspaces.");
}

// --- 1. The manifests --------------------------------------------------------
let coreDir;
for (const dir of workspaceDirs) {
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) {
    problems.push(`No package.json in the workspace: ${dir}`);
    continue;
  }
  const manifest = readJson(manifestPath);
  const name = manifest.name ?? dir;
  if (name === CORE) coreDir = dir;

  const runtime = Object.keys(manifest.dependencies ?? {});
  const peers = Object.keys(manifest.peerDependencies ?? {});
  const optional = Object.keys(manifest.optionalDependencies ?? {});

  if (name === CORE) {
    for (const [kind, list] of [
      ["dependencies", runtime],
      ["peerDependencies", peers],
      ["optionalDependencies", optional],
    ]) {
      if (list.length > 0) {
        problems.push(
          `${name}: ${kind} is not empty (${list.join(", ")}) — the core has zero runtime dependencies.`,
        );
      }
    }
    notes.push(`${name}: 0 runtime dependencies in the manifest`);
    continue;
  }

  // Peer dependencies of the other packages are legitimate (react, e.g.), but
  // a runtime dependency can only be a workspace sibling.
  const foreign = runtime.filter((d) => !d.startsWith(WORKSPACE_SCOPE));
  if (foreign.length > 0) {
    problems.push(
      `${name}: external runtime dependency (${foreign.join(", ")}) — only workspace siblings are allowed.`,
    );
  }
  notes.push(
    `${name}: ${runtime.length} runtime deps (${runtime.join(", ") || "none"}), ${peers.length} peers`,
  );
}

if (coreDir === undefined) {
  problems.push(`The ${CORE} package is not among the workspaces.`);
}

// --- 2. The compiled bundles -----------------------------------------------
/**
 * The specifiers, with a REAL PARSER, not a text pattern.
 *
 * There used to be a regex here (`from\s*["']([^"']+)["']`), and it lied. At
 * one point this sentence went into `editing.ts`:
 *
 *     // ... which is the shortest path from "it
 *     // happened" to "it lasted".
 *
 * The pattern matched it, and the check reported an "external dependency"
 * named `it\n// happened` in all three bundles — while the manifest side
 * said 0 dependencies in the same run. The bundle was not wrong: the CHECK
 * was wrong.
 *
 * The first fix was a hand-written comment stripper. That was wrong too, and
 * a tampering test showed it: an `import x from "lodash"` written inside a
 * block comment STILL caused a failure, because the stripper lost its place
 * somewhere in the bundle (on a regex literal containing a quote), and from
 * there let the rest of the file through raw. A hand-written lexer is the
 * wrong answer to a question that has a parser.
 *
 * So now rollup's `parseAst` parses — **not a new dependency**, rollup is
 * already the build tool. To a parser a comment does not exist by
 * definition, so this class of bug is no longer possible, not just unlikely.
 *
 * What it looks at: `import ... from`, `export ... from`, `export * from`,
 * `import(...)` and `require(...)`. If the argument of an `import()` or
 * `require()` is not a string literal, that is a PROBLEM: a specifier put
 * together at runtime is exactly what the check cannot prove.
 */
function walkAst(node, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    walkAst(node[key], visit);
  }
}

function isStringLiteral(node) {
  return (
    node !== null &&
    typeof node === "object" &&
    node.type === "Literal" &&
    typeof node.value === "string"
  );
}

/** Every specifier in the module, and the number of non-literal sites. */
function specifiersOf(code) {
  const specifiers = new Set();
  const computed = [];
  walkAst(parseAst(code), (node) => {
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
        if (isStringLiteral(node.source)) specifiers.add(node.source.value);
        break;
      case "ImportExpression":
        if (isStringLiteral(node.source)) specifiers.add(node.source.value);
        else computed.push("import()");
        break;
      case "CallExpression":
        if (node.callee.type === "Identifier" && node.callee.name === "require") {
          const [first] = node.arguments;
          if (isStringLiteral(first)) specifiers.add(first.value);
          else computed.push("require()");
        }
        break;
      default:
        break;
    }
  });
  return { specifiers, computed };
}

if (coreDir !== undefined) {
  // Every entry point (entries.json) and every shared chunk (dist/chunks/)
  // is shipped code: an external import in a new entry point or chunk is a
  // dependency just as much as one in the base. The list comes from the
  // source, not by hand — a hand-written list would not see a new entry point.
  const { entries } = JSON.parse(readFileSync(join(coreDir, "entries.json"), "utf8"));
  const chunkDir = join(coreDir, "dist", "chunks");
  const chunks = existsSync(chunkDir)
    ? readdirSync(chunkDir).filter((name) => /\.(mjs|cjs)$/.test(name)).map((name) => `dist/chunks/${name}`)
    : [];
  const bundles = [
    ...entries.flatMap((entry) => [`dist/${entry.name}.mjs`, `dist/${entry.name}.cjs`, `dist/${entry.name}.umd.js`]),
    ...chunks,
  ];
  for (const rel of bundles) {
    const path = join(coreDir, rel);
    if (!existsSync(path)) {
      problems.push(
        `No compiled bundle: ${rel} — the runtime import check did NOT run. Run this first: npm run build -w packages/core`,
      );
      continue;
    }
    let parsed;
    try {
      parsed = specifiersOf(readFileSync(path, "utf8"));
    } catch (error) {
      // A parse error is a FAILURE too: we cannot say anything about a bundle
      // that does not parse, and "we cannot say anything" is not a pass.
      problems.push(`${rel}: does not parse (${error.message}) — the check did not run.`);
      continue;
    }
    const external = [...parsed.specifiers].filter(
      (spec) => !spec.startsWith(".") && !spec.startsWith("/"),
    );
    if (external.length > 0) {
      // node: built-ins are a failure too: the core runs in the browser.
      problems.push(
        `${rel}: external specifier in the output (${external.join(", ")}) — the bundle is not self-contained.`,
      );
    }
    if (parsed.computed.length > 0) {
      problems.push(
        `${rel}: ${String(parsed.computed.length)} non-literal specifiers (${[...new Set(parsed.computed)].join(", ")}) — the check cannot prove a load put together at runtime.`,
      );
    }
    if (external.length === 0 && parsed.computed.length === 0) {
      notes.push(
        `${rel}: 0 external specifiers (${String(parsed.specifiers.size)} relative, by parser)`,
      );
    }
  }
}

for (const note of notes) console.log(`  ok   ${note}`);
if (problems.length > 0) {
  console.error("");
  for (const problem of problems) console.error(`  FAIL ${problem}`);
  console.error(`\ndeps FAILED: ${problems.length} problems.`);
  process.exit(1);
}
console.log(`\ndeps passed: zero runtime dependencies, ${notes.length} checks.`);
