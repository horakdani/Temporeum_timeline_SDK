#!/usr/bin/env node
/**
 * The element's Custom Elements Manifest (`custom-elements.json`,
 * schema 2.1.0): what an editor, Storybook or a framework's tooling reads to
 * know `<temporeum-timeline>` — its attributes, its properties and its
 * events, each with its type and its description.
 *
 * It is made from the source, with the TypeScript compiler, so it cannot
 * drift: the attributes are `OBSERVED_ATTRIBUTES`, described by the
 * configuration field each one sets; the properties are the class's
 * accessors and their JSDoc; the events are `TIMELINE_EVENTS`, under the
 * names the element dispatches them by, each a `CustomEvent` of its payload.
 *
 *   node scripts/sdk_custom_elements.mjs [out]   (default: packages/web-component/dist/custom-elements.json)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const element = join(repo, "packages/web-component/src/element.ts");
const timeline = join(repo, "packages/web-component/src/timeline.ts");
const config = join(repo, "packages/web-component/src/config.ts");

/** The configuration field an attribute sets, where the name does not say. */
const FIELD = { "time-zone": "timeZone", "aria-label": "ariaLabel", "pack-mode": "packMode", "touch-action": "touchAction", start: "domain", end: "domain", editable: "editing", "multi-select": "editing", "snap-ms": "editing" };
/** What an attribute says that its field's description does not. */
const SAYS = {
  start: "The start of the visible range: epoch milliseconds, or a date `Date.parse` reads. With `end`.",
  end: "The end of the visible range: epoch milliseconds, or a date `Date.parse` reads. With `start`.",
  editable: "Present (and not `\"false\"`): the reader can move and resize items.",
  "multi-select": "Present (and not `\"false\"`): Shift and Ctrl/Cmd add to the selection.",
  "snap-ms": "Moves and resizes snap to this many milliseconds.",
  height: "The height in pixels.",
  "aria-labelledby": "The ids of the page's elements whose text names the timeline, when there is no `aria-label`.",
};
/** The property an attribute is reflected by, when there is one. */
const PROPERTY = { orientation: "orientation", density: "density", theme: "theme", height: "height", editable: "editable" };

const docOf = (node) =>
  ts
    .getJSDocCommentsAndTags(node)
    .filter((doc) => ts.isJSDoc(doc))
    .map((doc) => (typeof doc.comment === "string" ? doc.comment : (doc.comment ?? []).map((part) => part.text).join("")))
    .join("\n")
    .trim();

const kebab = (name) => (name === "command" ? "timeline-command" : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));

/** The manifest, made from the source. */
export function manifest() {
  const program = ts.createProgram([element, timeline, config], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, baseUrl: repo, paths: { "@temporeum/timeline-core": [join(repo, "packages/core/src/index.ts")], "@temporeum/timeline-core/*": [join(repo, "packages/core/src/*/index.ts")] }, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"] });
  const checker = program.getTypeChecker();
  const text = (type) => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);

  // The configuration's fields, for the attributes' descriptions.
  const fields = new Map();
  ts.forEachChild(program.getSourceFile(config), (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "TimelineConfig") {
      for (const member of node.members) if (member.name !== undefined) fields.set(member.name.getText(), docOf(member));
    }
  });

  const source = program.getSourceFile(element);
  let attributes = [];
  let declaration;
  ts.forEachChild(source, (node) => {
    if (ts.isVariableStatement(node)) {
      for (const each of node.declarationList.declarations) {
        if (each.name.getText() !== "OBSERVED_ATTRIBUTES") continue;
        const list = ts.isAsExpression(each.initializer) ? each.initializer.expression : each.initializer;
        attributes = list.elements.map((item) => item.text);
      }
    }
    if (ts.isClassDeclaration(node) && node.name?.text === "TemporeumTimelineElement") declaration = node;
  });
  if (declaration === undefined || attributes.length === 0) throw new Error("sdk_custom_elements: the element class or OBSERVED_ATTRIBUTES is not where it was");

  const members = [];
  const seen = new Set();
  for (const member of declaration.members) {
    if (!ts.isGetAccessorDeclaration(member) && !ts.isSetAccessorDeclaration(member) && !ts.isMethodDeclaration(member)) continue;
    if (member.name === undefined || ts.isPrivateIdentifier(member.name)) continue;
    const name = member.name.getText();
    if (seen.has(name) || name.endsWith("Callback") || (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0) continue;
    if (name === "addEventListener" || name === "removeEventListener") continue;
    seen.add(name);
    const symbol = checker.getSymbolAtLocation(member.name);
    const description = (symbol === undefined ? "" : ts.displayPartsToString(symbol.getDocumentationComment(checker))).trim();
    if (ts.isMethodDeclaration(member)) {
      members.push({ kind: "method", name, description, parameters: member.parameters.map((param) => ({ name: param.name.getText(), type: { text: param.type?.getText() ?? "unknown" } })) });
    } else {
      const getter = declaration.members.find((each) => ts.isGetAccessorDeclaration(each) && each.name.getText() === name);
      const setter = declaration.members.some((each) => ts.isSetAccessorDeclaration(each) && each.name.getText() === name);
      const type = getter?.type?.getText() ?? "unknown";
      members.push({ kind: "field", name, type: { text: type }, description, ...(setter ? {} : { readonly: true }) });
    }
  }

  // The events: the instance's, by the name the element dispatches.
  // The map's own members and the core's it extends, through the checker.
  const events = [];
  ts.forEachChild(program.getSourceFile(timeline), (node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== "TimelineInstanceEventMap") return;
    const type = checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(node.name));
    for (const property of checker.getPropertiesOfType(type)) {
      const name = property.getName();
      const member = property.declarations?.[0];
      const payload = member !== undefined && ts.isPropertySignature(member) && member.type !== undefined ? member.type.getText() : text(checker.getTypeOfSymbol(property));
      const description = ts.displayPartsToString(property.getDocumentationComment(checker)).trim();
      events.push({ name: kebab(name), type: { text: `CustomEvent<${payload}>` }, description: description || `The instance's \`${name}\`, its payload as \`detail\`.` });
    }
  });

  return {
    schemaVersion: "2.1.0",
    readme: "README.md",
    modules: [
      {
        kind: "javascript-module",
        path: "dist/index.mjs",
        declarations: [
          {
            kind: "class",
            name: "TemporeumTimelineElement",
            description: docOf(declaration) || "The `<temporeum-timeline>` element.",
            customElement: true,
            tagName: "temporeum-timeline",
            attributes: attributes.map((name) => ({
              name,
              type: { text: "string" },
              description: SAYS[name] ?? fields.get(FIELD[name] ?? name) ?? "",
              ...(PROPERTY[name] === undefined ? {} : { fieldName: PROPERTY[name] }),
            })),
            members,
            events,
            superclass: { name: "HTMLElement" },
          },
        ],
        exports: [{ kind: "js", name: "TemporeumTimelineElement", declaration: { name: "TemporeumTimelineElement", module: "dist/index.mjs" } }],
      },
      {
        kind: "javascript-module",
        path: "dist/define.mjs",
        declarations: [],
        exports: [{ kind: "custom-element-definition", name: "temporeum-timeline", declaration: { name: "TemporeumTimelineElement", module: "dist/index.mjs" } }],
      },
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(repo, "packages/web-component/dist/custom-elements.json"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(manifest(), null, 2)}\n`);
  console.log(`custom-elements.json: ${out}`);
}
