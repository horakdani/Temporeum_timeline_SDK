/**
 * A P19-es kapuk kozos fele: egy vitest JSON-riport olvasasa.
 *
 * Minden P19-es check ugyanazt kerdezi a riporttol: lefutott-e (a riport
 * hianya BUKAS, nem kihagyas), elegendo teszt futott-e, mind zold-e, es
 * minden allitas (`[claim:<nev>]`) szerepel-e a tesztnevekben — ha kell,
 * mindket orientacioban. Egy allitas, aminek a tesztje eltunt, nem bizonyitott.
 */
import { existsSync, readFileSync } from "node:fs";

/**
 * @param {{ file: string; label: string; minTests: number; claims: readonly string[]; orientations?: boolean }} spec
 * @returns {string[]} a hibak, magyarul
 */
export function checkReport(spec) {
  const failures = [];
  if (!existsSync(spec.file)) {
    return [`nincs vitest-riport (${spec.file}) — a(z) ${spec.label} keszlet NEM futott le, ezert BUKAS`];
  }
  const report = JSON.parse(readFileSync(spec.file, "utf8"));
  const tests = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  if (tests.length < spec.minTests) {
    failures.push(`${String(tests.length)} ${spec.label}-teszt futott, legalabb ${String(spec.minTests)} kell`);
  }
  for (const test of tests) {
    if (test.status !== "passed") failures.push(`nem zold ${spec.label}-teszt: ${String(test.fullName)} (${String(test.status)})`);
  }
  const names = tests.filter((test) => test.status === "passed").map((test) => String(test.fullName));
  for (const claim of spec.claims) {
    const tag = `[claim:${claim}]`;
    const variants = spec.orientations ? ["[horizontal]", "[vertical]"] : [""];
    for (const variant of variants) {
      if (!names.some((name) => name.includes(tag) && name.includes(variant))) {
        failures.push(`a(z) ${tag} allitasnak nincs zold tesztje${variant === "" ? "" : ` ${variant} orientacioban`}`);
      }
    }
  }
  return failures;
}

/** Kiirja az eredmenyt, es a hibak szama szerint lep ki. */
export function finish(gate, failures, notes = []) {
  for (const note of notes) console.log(`  - ${note}`);
  if (failures.length > 0) {
    console.error(`${gate}: BUKOTT`);
    for (const failure of failures) console.error(`  x ${failure}`);
    process.exit(1);
  }
  console.log(`${gate}: minden allitas bizonyitva.`);
}

/** Megjegyzesek nelkuli forraskod: egy kommentben allo nev nem hivas. */
export const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
