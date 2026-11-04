#!/usr/bin/env node
/**
 * The api-docs check — every name on a public entry point is documented, and every
 * public function is called the way the naming rule says.
 *
 * What an editor shows for a name is its JSDoc: a payload, a constant or an
 * option type without one is a name the reader has to look up in the source.
 * So this check reads the entry points of all six packages with the
 * TypeScript compiler — the source, which is what the declarations are
 * emitted from — and fails on:
 *
 *  1. an exported name (function, class, constant, interface, type) whose
 *     declaration has no JSDoc text;
 *  2. an exported function with a positional `boolean` parameter — a call
 *     like `f(x, true)` says nothing at the call site; it takes an options
 *     object;
 *  3. an exported function with more than four positional parameters before
 *     a trailing options object.
 *
 * NEGATIVE CONTROL: a scratch module with an undocumented export, a boolean
 * parameter and five positional parameters is checked the same way, and has
 * to produce exactly those three failures — or the checker could not tell.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = JSON.parse(readFileSync(join(repo, "packages/core/entries.json"), "utf8")).entries;

const ENTRIES = [
  ...core.map((entry) => join(repo, "packages/core", entry.input)),
  ...["index", "calendar", "gantt", "resources", "export", "tools", "groups", "items", "intl", "story"].map((name) => join(repo, "packages/web-component/src", `${name}.ts`)),
  join(repo, "packages/react/src/index.ts"),
  join(repo, "packages/vue/src/index.ts"),
  join(repo, "packages/svelte/src/index.ts"),
  join(repo, "packages/angular/src/index.ts"),
];

/** The source a TypeScript program needs to resolve the packages to each other. */
const PATHS = {
  "@temporeum/timeline-core": [join(repo, "packages/core/src/index.ts")],
  ...Object.fromEntries(core.filter((entry) => entry.name !== "index").map((entry) => [`@temporeum/timeline-core/${entry.name}`, [join(repo, "packages/core", entry.input)]])),
  "@temporeum/timeline-element": [join(repo, "packages/web-component/src/index.ts")],
  "@temporeum/timeline-element/*": [join(repo, "packages/web-component/src/*.ts")],
};

function check(files) {
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    experimentalDecorators: true,
    baseUrl: repo,
    paths: PATHS,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  });
  const checker = program.getTypeChecker();
  const problems = [];
  const seen = new Set();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (source === undefined) {
      problems.push(`${relative(repo, file)}: not in the program`);
      continue;
    }
    const module = checker.getSymbolAtLocation(source);
    if (module === undefined) continue;
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const declarations = symbol.declarations ?? [];
      const declaration = declarations[0];
      if (declaration === undefined) continue;
      const where = `${relative(repo, declaration.getSourceFile().fileName)}: ${exported.name}`;
      if (seen.has(where)) continue;
      seen.add(where);
      const documented = declarations.some((each) => ts.getJSDocCommentsAndTags(each).some((doc) => ts.isJSDoc(doc) && (typeof doc.comment === "string" ? doc.comment.trim() !== "" : (doc.comment?.length ?? 0) > 0)));
      // A `const x = …` is documented on its statement.
      const statement = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : undefined;
      const onStatement = statement !== undefined && ts.getJSDocCommentsAndTags(statement).some((doc) => ts.isJSDoc(doc) && doc.comment !== undefined && String(typeof doc.comment === "string" ? doc.comment : doc.comment.map((part) => part.text).join("")).trim() !== "");
      if (!documented && !onStatement && symbol.getDocumentationComment(checker).length === 0) problems.push(`${where} has no JSDoc`);
      for (const each of declarations) {
        if (!ts.isFunctionDeclaration(each)) continue;
        const params = each.parameters;
        const last = params[params.length - 1];
        const optionsLast = last !== undefined && isObjectish(checker.getTypeAtLocation(last), checker);
        const positional = optionsLast ? params.length - 1 : params.length;
        if (positional > 4) problems.push(`${where} takes ${String(positional)} positional parameters (at most four, then an options object)`);
        for (const param of params) {
          if (param.dotDotDotToken !== undefined) continue;
          const type = checker.getTypeAtLocation(param);
          if (isBoolean(type)) problems.push(`${where} takes a positional boolean, \`${param.name.getText()}\` (an options object says what it means)`);
        }
      }
    }
  }
  return problems;
}

function isBoolean(type) {
  if (type.flags & ts.TypeFlags.BooleanLike) return true;
  // `boolean | undefined` from an optional parameter.
  return type.isUnion() && type.types.every((each) => each.flags & (ts.TypeFlags.BooleanLike | ts.TypeFlags.Undefined)) && type.types.some((each) => each.flags & ts.TypeFlags.BooleanLike);
}

function isObjectish(type, checker) {
  const parts = type.isUnion() ? type.types.filter((each) => !(each.flags & ts.TypeFlags.Undefined)) : [type];
  return parts.length > 0 && parts.every((each) => each.flags & ts.TypeFlags.Object && checker.getSignaturesOfType(each, ts.SignatureKind.Call).length === 0 && !checker.isArrayLikeType(each));
}

const problems = check(ENTRIES);

// --- negative control --------------------------------------------------------
const scratch = mkdtempSync(join(tmpdir(), "tl-api-docs-"));
const control = join(scratch, "control.ts");
writeFileSync(
  control,
  [
    "export function undocumented(): void {}",
    "/** Says nothing at the call site. */",
    "export function flagged(value: number, inline: boolean): number { return inline ? value : 0; }",
    "/** Too many. */",
    "export function many(a: number, b: number, c: number, d: number, e: number): number { return a + b + c + d + e; }",
    "/** Four, then options: allowed. */",
    "export function fine(a: number, b: number, c: number, d: number, options: { readonly e?: number } = {}): number { return a + b + c + d + (options.e ?? 0); }",
  ].join("\n"),
);
const caught = check([control]);
rmSync(scratch, { recursive: true, force: true });
const wanted = ["undocumented has no JSDoc", "flagged takes a positional boolean", "many takes 5 positional parameters"];
const controlOk = caught.length === wanted.length && wanted.every((text) => caught.some((problem) => problem.includes(text)));

if (!controlOk) problems.push(`the negative control did not fail as it should: ${JSON.stringify(caught)}`);
if (problems.length > 0) {
  console.error(`api-docs: FAILED (${String(problems.length)})`);
  for (const problem of problems) console.error(`  x ${problem}`);
  process.exit(1);
}
console.log(`api-docs: every public name of ${String(ENTRIES.length)} entry points is documented and called by the rule (control: ${String(caught.length)} failures, as planted).`);
