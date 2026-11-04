#!/usr/bin/env node
/**
 * The inverse check: proves that the inverse of every command restores the EXACT
 * starting state — for generated SEQUENCES too.
 *
 * This is the editing layer's most important claim, because everything else
 * builds on it: an undo that "almost" restores quietly corrupts the user's
 * data, and the bug only shows three operations later. So trying it with
 * hand-written cases is not enough.
 *
 * Two independent checks:
 *
 *  1. RUNTIME: in the property report every required property must be
 *     green, with a name and a seed, and at least MIN_CASES generated cases.
 *     A missing report is a FAILURE, not a skip — the package command deletes
 *     it first, so the report being there means it ran NOW.
 *  2. STATIC: the structure of the proof. That the suite drives the REAL
 *     input machine (not only the patch helpers), that it takes "exact"
 *     literally (it compares the key set too, not only the values), that it
 *     unwinds the sequence backwards, and that the core has the three
 *     structural conditions the claim rests on: the inverse is not
 *     enumerable and is memoised (otherwise the command is circular and the
 *     undo stack grows without bound), invertPatch restores only the keys
 *     that changed, and ItemPatch.laneId can take null (otherwise the
 *     "was not in a lane" state cannot be expressed, and the inverse of a
 *     drag into a lane is inexact).
 *
 * Without the static half the runtime half would vouch for itself: five
 * green properties that only go round their own helpers read just as well.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");
const testFile = join(corePackage, "test", "property", "inverse.test.ts");
const reportFile = join(corePackage, ".property-report-inverse.json");
const editingFile = join(corePackage, "src", "editing.ts");
const typesFile = join(corePackage, "src", "types.ts");

const MIN_CASES = 500;
const REQUIRED_PROPERTIES = [
  "one inverse restores the state",
  "a sequence of inverses restores the state",
  "an inverse of an inverse is the command",
  "a command is serialisable",
  "the machine's own commands invert",
  // Adding, removing and reordering groups are commands too — the inverse check
  // proof explicitly asks for these commands as well.
  "an add or a remove inverts exactly",
  "a group reorder inverts exactly",
  // Automatic scheduling is a command too — the inverse check's proof asks for
  // every command, and the schedule-cmd check asks for this one separately.
  "a schedule inverts exactly",
  // Reassigning between resources is the lane-changing move, with load
  // bands between the rows — a drag onto any row is a 'move' command, and
  // the inverse check's proof asks for every command.
  "a move between resources inverts exactly",
];

const failures = [];
const notes = [];

// --- 1. RUNTIME --------------------------------------------------------------

if (!existsSync(reportFile)) {
  failures.push(
    `no property report (${reportFile}) — the inverse suite did NOT run, so this is a FAILURE`,
  );
} else {
  let report;
  try {
    report = JSON.parse(readFileSync(reportFile, "utf8"));
  } catch (error) {
    report = undefined;
    failures.push(`the property report is unreadable: ${String(error)}`);
  }
  if (report !== undefined) {
    if (!Array.isArray(report) || report.length === 0) {
      failures.push("the property report is empty");
    } else {
      for (const name of REQUIRED_PROPERTIES) {
        const entry = report.find((candidate) => candidate?.name === name);
        if (entry === undefined) {
          failures.push(`required property missing: "${name}"`);
          continue;
        }
        if (entry.passed !== true) {
          failures.push(
            `failed property: ${name} — ${JSON.stringify(entry.counterexample ?? null)}`,
          );
        }
        if (!Number.isInteger(entry.cases) || entry.cases < MIN_CASES) {
          failures.push(
            `${name}: ${String(entry.cases)} cases, but at least ${String(MIN_CASES)} are required`,
          );
        }
        if (!Number.isFinite(entry.seed)) {
          failures.push(`${name}: no seed, so a failure is not reproducible`);
        }
      }
      const extra = report.filter(
        (entry) => !REQUIRED_PROPERTIES.includes(String(entry?.name ?? "")),
      );
      if (extra.length > 0) {
        // Not an error, but keep it visible: the report's content is the proof.
        notes.push(`further properties in the report: ${extra.map((e) => e.name).join(", ")}`);
      }
      if (failures.length === 0) {
        const total = report.reduce((sum, entry) => sum + entry.cases, 0);
        notes.push(
          `${String(report.length)} inverse properties, ${String(total)} generated cases, all green`,
        );
      }
    }
  }
}

// --- 2. STATIC ---------------------------------------------------------------

if (!existsSync(testFile)) {
  failures.push(`no inverse property file: ${testFile}`);
} else {
  const source = readFileSync(testFile, "utf8");

  if (
    !/import\s*\{[^}]*\bcreateInputMachine\b[^}]*\}\s*from\s*"\.\.\/\.\.\/src\/input\.js"/.test(
      source,
    ) ||
    !/createInputMachine\s*\(/.test(source)
  ) {
    failures.push(
      "the suite does not drive the real input machine (createInputMachine) — " +
        "the patch helpers being invertible says nothing about the command " +
        "a finger actually produces",
    );
  } else {
    notes.push("one property drives the REAL input machine, with generated gestures");
  }

  if (!/Object\.keys\(/.test(source) || !/Object\.is\(/.test(source)) {
    failures.push(
      "the comparison is not literal: an 'EXACT' state needs the key set compared too " +
        "(Object.keys) and the values with Object.is, otherwise an explicit undefined " +
        "left behind after an undo passes",
    );
  } else {
    notes.push("'exact' is literal: key set + Object.is");
  }

  if (!/for \(let index = commands\.length - 1; index >= 0; index -= 1\)/.test(source)) {
    failures.push(
      "the sequence is not unwound backwards — an undo stack unwinds LIFO, " +
        "and the order is exactly what a claim about sequences is meant to prove",
    );
  } else {
    notes.push("the sequence unwinds LIFO, the way an undo stack does");
  }
}

if (!existsSync(editingFile)) {
  failures.push(`missing: ${editingFile}`);
} else {
  const source = readFileSync(editingFile, "utf8");

  const defineBlock = /Object\.defineProperty\(\s*command,\s*"inverse",\s*\{([\s\S]*?)\n\s*\}\);/.exec(
    source,
  );
  if (defineBlock === null) {
    failures.push(
      "the inverse is not built with Object.defineProperty — as a plain field the command " +
        "is circular and cannot be stored as JSON",
    );
  } else {
    const body = defineBlock[1];
    if (!/enumerable:\s*false/.test(body)) {
      failures.push(
        "the inverse is enumerable — the command would serialise itself, so an " +
          "undo stack saved by the host is not plain JSON",
      );
    }
    if (!/inverse \?\?=/.test(body)) {
      failures.push(
        "the inverse is not memoised — every read returns a new object, so " +
          "cmd.inverse.inverse !== cmd, and an undo pressed back and forth grows without bound",
      );
    }
    if (failures.length === 0) {
      notes.push("the inverse is a lazy, non-enumerable, memoised getter");
    }
  }

  const invertBody = /export function invertPatch<T>\(([\s\S]*?)\n\}/.exec(source);
  if (invertBody === null) {
    failures.push("invertPatch not found");
  } else {
    const body = invertBody[1];
    const guards = ['"start" in patch', '"end" in patch', '"laneId" in patch'];
    for (const guard of guards) {
      if (!body.includes(guard)) {
        failures.push(
          `invertPatch does not decide by ${guard} — an inverse that also restores a field ` +
            "nobody changed overwrites whatever the host did with it " +
            "in the meantime",
        );
      }
    }
    const assignments = (body.match(/restored\.[a-zA-Z]+\s*=/g) ?? []).length;
    if (assignments !== guards.length) {
      failures.push(
        `invertPatch restores ${String(assignments)} fields, but there must be ${String(guards.length)} ` +
          "guarded branches — an unguarded restore is exactly the bug above",
      );
    }
  }
}

if (!existsSync(typesFile)) {
  failures.push(`missing: ${typesFile}`);
} else {
  const source = readFileSync(typesFile, "utf8");
  const patch = /export interface ItemPatch \{([\s\S]*?)\n\}/.exec(source);
  if (patch === null) {
    failures.push("ItemPatch not found");
  } else if (!/laneId\?:\s*string\s*\|\s*null/.test(patch[1])) {
    failures.push(
      "ItemPatch.laneId cannot take null — then the 'was not in a lane' state " +
        "cannot be expressed, and the inverse of dragging any item that started outside a lane " +
        "into a lane is inexact",
    );
  } else {
    notes.push("ItemPatch.laneId is nullable, so the 'no lane' state can be expressed");
  }
}

// --- Result ------------------------------------------------------------------

for (const note of notes) {
  console.log(`  ok   ${note}`);
}

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`  FAIL ${failure}`);
  }
  console.error(`\ninverse FAILED: ${String(failures.length)} failure(s).`);
  process.exit(1);
}

console.log(
  "\ninverse passed: the inverse of every command restores the EXACT starting state, " +
    "for generated sequences too.",
);
