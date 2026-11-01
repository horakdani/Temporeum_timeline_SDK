#!/usr/bin/env node
/**
 * G-BACKLOG: egy utemezetlen feladat gesztussal es billentyuvel is a vaszonra
 * kerul, ugyanazzal a paranccsal.
 *
 * Futasidoben (a magban): a gesztus celpontja (az elengedes alatti ido es
 * sav, a terhelesi sav az eroforrasat jelenti) es a billentyu celpontja (a
 * nezet kozepe a fokuszalt elem savjaban) ugyanazt az egy add parancsot adja,
 * a feladat sajat id-javal, mezoivel es hosszaval; ahol a gesztus a
 * billentyu helyen enged el, a ket parancs betu szerint azonos (same-command);
 * a feladat a parancsra lekerul a listarol, az inverzre a pontos elemekkel
 * visszakerul (back-on-undo).
 *
 * Statikusan (az elem forrasabol): a mountBacklog mutatos huzasa a
 * timeline.dropItemAt-et, a billentyuje a timeline.dropItem-et hivja; a
 * peldany dropItemAt-je, dropItem-je es a HTML-ejtes mind ugyanabba az egy
 * commitAdd-ba fut, ami az /items addCommand-jat hivja. Igy a ket ut
 * parancsa nem csak a tesztben azonos, hanem a kodban is egy helyen keszul.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".backlog-report.json"),
  label: "varolista",
  minTests: 2,
  claims: ["same-command", "back-on-undo"],
});

/**
 * Egy fuggveny vagy metodus torzse: a nev utani elso sorvegi `{`-tol a
 * parjaig. Sorvegi, mert egy parameter tipus-literalja (`{ readonly x }`)
 * is `{`-vel kezdodik, de nem a sor vegen.
 */
function bodyOf(code, head) {
  const at = code.indexOf(head);
  if (at < 0) return undefined;
  const open = code.indexOf("{\n", at + head.length);
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    else if (code[index] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(open, index + 1);
    }
  }
  return undefined;
}

const element = join(root, "packages", "web-component", "src");
const backlog = codeOf(readFileSync(join(element, "backlog.ts"), "utf8"));
const timeline = codeOf(readFileSync(join(element, "timeline.ts"), "utf8"));

const expectations = [
  [backlog, "function endDrag(", "timeline.dropItemAt(", "a varolista mutatos huzasa nem a timeline.dropItemAt-tel tesz le"],
  [backlog, "function onKey(", "timeline.dropItem(", "a varolista billentyuje nem a timeline.dropItem-mel tesz le"],
  [timeline, "dropItemAt(payload, at)", "dropAt(", "a peldany dropItemAt-je nem a kozos dropAt-on at tesz le"],
  [timeline, "function dropAt(", "commitAdd(", "a dropAt nem a commitAdd-ba fut"],
  [timeline, "dropItem(payload)", "commitAdd(", "a peldany dropItem-je nem a commitAdd-ba fut"],
  [timeline, "function onDrop(", "dropAt(", "a HTML-ejtes nem a kozos dropAt-on at tesz le"],
  [timeline, "function commitAdd(", "addCommand(", "a commitAdd nem az /items addCommand-javal kesziti a parancsot"],
];
for (const [code, head, call, message] of expectations) {
  const body = bodyOf(code, head);
  if (body === undefined) failures.push(`nincs ${head} a forrasban`);
  else if (!body.includes(call)) failures.push(message);
}
// A varolista nem kesziti maga a parancsot: egy masodik ut eltérhetne.
for (const needle of ["addCommand(", "createCommand(", "applyItemPatches("]) {
  if (backlog.includes(needle)) failures.push(`a varolista maga kesziti a parancsot (${needle})`);
}
finish("G-BACKLOG", failures);
