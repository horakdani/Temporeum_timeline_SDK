#!/usr/bin/env node
/**
 * The no-gesture-only check: proves statically that there is no gesture-only capability.
 *
 * Without running anything, from the source, in four steps:
 *
 *  1. The VOCABULARY comes from the machine's types (sdk_gesture_vocabulary.mjs):
 *     every effect type, viewport reason, editing mode, field and switch is
 *     classified, and every capability has a keyboard route. So a new gesture
 *     capability cannot be born without the check knowing.
 *  2. The ROUTE is real: the capability's action is handled in the machine's
 *     key dispatcher (`runKey`, editing in `keyEdit`), and that branch calls
 *     the gesture's OWN twin — the same function the gesture uses
 *     (panDomainBy, zoomDomainAt, runEdit…), not a copy.
 *  3. The BINDING is real: every such action has a key in the default
 *     key map, the axis-relative arrows resolve in both orientations, and the
 *     gesture-side `commit` calls only use reasons that are in the vocabulary.
 *  4. The BROWSER BINDING is real: the /dom binding listens for keydown and
 *     hands it to the machine.
 *
 * The runtime half (that the key really reaches the same thing) is the keyboard check.
 */

import { readFileSync } from "node:fs";

import ts from "typescript";

import {
  ATTACH_FILE,
  ENTRY_FILES,
  ENTRY_ROUTES,
  entryVocabulary,
  INPUT_FILE,
  KEY_ROUTES,
  KEYBOARD_FILE,
  REASON_CAPABILITIES,
  gestureVocabulary,
} from "./sdk_gesture_vocabulary.mjs";

const failures = [];

function parse(file) {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function findFunction(source, name) {
  let found;
  const visit = (node) => {
    if (found !== undefined) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// --- 1. The vocabulary -------------------------------------------------------
const vocabulary = gestureVocabulary();
for (const problem of vocabulary.problems) failures.push(problem);

// --- 2. The route -------------------------------------------------------------
const input = parse(INPUT_FILE);

/**
 * The branches of a function's first `switch`: label -> the branch's text.
 * Consecutive empty `case`s share the text of the next non-empty branch. A
 * `default` branch is a FAILURE: it would silently swallow an unknown action.
 */
function switchBranches(name) {
  const fn = findFunction(input, name);
  const branches = new Map();
  if (fn === undefined) {
    failures.push(`no ${name} in the input machine`);
    return { branches, text: "" };
  }
  let switchNode;
  const visit = (node) => {
    if (switchNode === undefined && ts.isSwitchStatement(node)) switchNode = node;
    else ts.forEachChild(node, visit);
  };
  visit(fn);
  let pending = [];
  for (const clause of switchNode?.caseBlock.clauses ?? []) {
    if (ts.isDefaultClause(clause)) {
      failures.push(`the switch of ${name} has a default branch — an unhandled action would silently vanish there`);
      continue;
    }
    pending.push(clause.expression.text);
    if (clause.statements.length > 0) {
      const text = clause.statements.map((statement) => statement.getText(input)).join("\n");
      for (const label of pending) branches.set(label, text);
      pending = [];
    }
  }
  return { branches, text: fn.getText(input) };
}

const runKey = switchBranches("runKey");
const keyEdit = switchBranches("keyEdit");

function branchOf(action) {
  const text = runKey.branches.get(action);
  if (text === undefined) return undefined;
  if (text.includes("keyEdit(")) {
    const edit = keyEdit.branches.get(action);
    return edit === undefined ? undefined : { where: "keyEdit", text: edit, context: keyEdit.text };
  }
  return { where: "runKey", text, context: runKey.text };
}

// --- 3. The binding --------------------------------------------------------------
const keyboard = parse(KEYBOARD_FILE);
const bindings = [];
const arrows = {};
const visitKeyboard = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(keyboard) === "DEFAULT_KEY_BINDINGS" && node.initializer !== undefined) {
    for (const element of node.initializer.elements ?? []) {
      if (!ts.isObjectLiteralExpression(element)) continue;
      const binding = {};
      for (const property of element.properties) {
        const value = property.initializer;
        binding[property.name.getText(keyboard)] = ts.isStringLiteral(value) ? value.text : value.getText(keyboard);
      }
      bindings.push(binding);
    }
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(keyboard) === "ARROWS" && node.initializer !== undefined) {
    let table = node.initializer;
    while (!ts.isObjectLiteralExpression(table)) table = table.expression;
    for (const orientation of table.properties) {
      const values = orientation.initializer.properties.map((property) => property.initializer.text);
      arrows[orientation.name.getText(keyboard)] = values;
    }
  }
  ts.forEachChild(node, visitKeyboard);
};
visitKeyboard(keyboard);
for (const orientation of ["horizontal", "vertical"]) {
  const values = new Set(arrows[orientation] ?? []);
  for (const axis of ["main+", "main-", "cross+", "cross-"]) {
    if (!values.has(axis)) failures.push(`the arrows do not resolve the ${axis} axis in the ${orientation} orientation`);
  }
}

const rows = [];
for (const capability of vocabulary.capabilities) {
  const route = KEY_ROUTES[capability];
  if (route === undefined) continue;
  for (const action of route.actions) {
    const branch = branchOf(action);
    if (branch === undefined) {
      failures.push(`${capability}: the "${action}" action is not handled in the machine's key dispatcher`);
      continue;
    }
    for (const call of route.calls) {
      if (!branch.text.includes(call)) failures.push(`${capability}: the "${action}" branch (${branch.where}) does not call the gesture's twin: ${call}`);
    }
    for (const rule of route.context ?? []) {
      if (!branch.context.includes(rule)) failures.push(`${capability}: ${branch.where} does not apply this: ${rule}`);
    }
    const keys = bindings.filter((binding) => binding.action === action);
    if (keys.length === 0) failures.push(`${capability}: the "${action}" action has no key in the default key map`);
    const shown = keys
      .map((binding) => `${binding.shift === "true" ? "Shift+" : ""}${binding.alt === "true" ? "Alt+" : ""}${binding.key === " " ? "Space" : binding.key}`)
      .join(" / ");
    rows.push([capability, action, shown, branch.where, route.calls.join(", ")]);
  }
}

// On the gesture side every `commit` reason comes from the vocabulary.
const reasons = new Set();
const visitCommits = (node) => {
  if (ts.isCallExpression(node) && node.expression.getText(input) === "commit") {
    const reason = node.arguments[2];
    if (reason !== undefined && ts.isStringLiteral(reason)) reasons.add(reason.text);
  }
  ts.forEachChild(node, visitCommits);
};
visitCommits(input);
for (const reason of reasons) {
  if (!(reason in REASON_CAPABILITIES)) failures.push(`the machine moves the view with a reason that is not in the vocabulary: ${reason}`);
}
const inputText = input.getText();
if (!/key\(input\)\s*\{[\s\S]*?resolveKey\([\s\S]*?runKey\(/.test(inputText)) {
  failures.push("the machine's key() method does not go the resolveKey -> runKey way");
}

// --- 4. The browser binding ---------------------------------------------------
const attach = readFileSync(ATTACH_FILE, "utf8");
if (!attach.includes('"keydown"') || !attach.includes("machine.key(")) {
  failures.push("the /dom binding does not hand keydown to the machine");
}

// --- 5. The /groups and /items entry points -----------------------------------
// The capabilities of groups and items live in the /groups and /items entry
// points, and createTimeline wires them in. Every capability has a gesture
// path and a keyboard path, and both call the same shared function —
// not a copy.
const entries = entryVocabulary();
for (const problem of entries.problems) failures.push(`entry vocabulary: ${problem}`);
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const entrySources = Object.fromEntries(Object.entries(ENTRY_FILES).map(([name, file]) => [name, stripComments(readFileSync(file, "utf8"))]));
for (const capability of entries.capabilities) {
  const route = ENTRY_ROUTES[capability];
  if (route === undefined) continue;
  const text = entrySources[route.file];
  for (const needle of [...route.gesture, ...route.key]) {
    if (!text.includes(needle)) failures.push(`${capability}: no such path in the source of ${route.file}: ${needle}`);
  }
  if (text.split(route.shared).length - 1 < 2) failures.push(`${capability}: the shared function (${route.shared}) is not called by both paths`);
  rows.push([capability, "(entry)", route.key.join(" | ").slice(0, 28), route.file, route.shared]);
}
const timelineText = entrySources.timeline;
if (!timelineText.includes('addEventListener("keydown", onKey)')) failures.push("createTimeline does not listen for keydown for the items' keys");
if (!entrySources.layer.includes('addEventListener("keydown", onKeyDown)')) failures.push("the group tree does not listen for keydown");
// The tools layer listens on its own controls (sliders) and — for r and Esc — on the element, before the machine.
if (!entrySources.tools.includes('[element, "keydown", onLayerKey, false]')) failures.push("the tools layer does not listen for keydown on its controls");
if (!entrySources.tools.includes('[host.element, "keydown", onHostKey, true]')) failures.push("the tools layer does not listen for keydown on the element (capture)");

console.log("  capability                  action         key                          branch    twin");
for (const [capability, action, keys, where, calls] of rows) {
  console.log(`  ${capability.padEnd(27)} ${action.padEnd(14)} ${keys.padEnd(28)} ${where.padEnd(9)} ${calls}`);
}
console.log(
  `\n  · vocabulary from the types: ${vocabulary.raw.effectTypes.length} effect types, ${vocabulary.raw.reasons.length} viewport reasons, ${vocabulary.raw.modes.length} editing modes, ${vocabulary.raw.editingSwitches.length + vocabulary.raw.inputSwitches.length} switches -> ${vocabulary.capabilities.length} capabilities`,
);
console.log(`  · gesture-side commit reasons: ${[...reasons].sort().join(", ")}`);

if (failures.length > 0) {
  console.error("\nno-gesture-only FAILED:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`\nno-gesture-only: all ${vocabulary.capabilities.length + entries.capabilities.length} gesture capabilities have a key, through the gesture's own twin.`);
