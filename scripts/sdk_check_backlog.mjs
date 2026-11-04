#!/usr/bin/env node
/**
 * The backlog check: an unscheduled task reaches the canvas by gesture and by
 * keyboard alike, with the same command.
 *
 * At runtime (in the core): the gesture's target (the time and lane under the
 * release, where a load lane stands for its resource) and the keyboard's
 * target (the middle of the view, in the focused item's lane) yield the same
 * single add command, with the task's own id, fields and duration; where the
 * gesture releases at the keyboard's spot, the two commands are identical to
 * the letter (same-command); the command takes the task off the list, and the
 * inverse puts it back with the exact items (back-on-undo).
 *
 * Statically (from the element's source): mountBacklog's pointer drag calls
 * timeline.dropItemAt, its keyboard calls timeline.dropItem; the instance's
 * dropItemAt, dropItem and the HTML drop all run into the same single
 * commitAdd, which calls the /items addCommand. So the two paths' command is
 * not only identical in the test, it is also built in one place in the code.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkReport, codeOf, finish } from "./sdk_suite_report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = checkReport({
  file: join(root, "packages", "core", ".backlog-report.json"),
  label: "backlog",
  minTests: 2,
  claims: ["same-command", "back-on-undo"],
});

/**
 * The body of a function or method: from the first line-ending `{` after the
 * name to its match. Line-ending, because a parameter's type literal
 * (`{ readonly x }`) also starts with `{`, but not at the end of a line.
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
  [backlog, "function endDrag(", "timeline.dropItemAt(", "the backlog's pointer drag does not drop through timeline.dropItemAt"],
  [backlog, "function onKey(", "timeline.dropItem(", "the backlog's keyboard does not drop through timeline.dropItem"],
  [timeline, "dropItemAt(payload, at)", "dropAt(", "the instance's dropItemAt does not drop through the shared dropAt"],
  [timeline, "function dropAt(", "commitAdd(", "dropAt does not run into commitAdd"],
  [timeline, "dropItem(payload)", "commitAdd(", "the instance's dropItem does not run into commitAdd"],
  [timeline, "function onDrop(", "dropAt(", "the HTML drop does not drop through the shared dropAt"],
  [timeline, "function commitAdd(", "addCommand(", "commitAdd does not build the command with the /items addCommand"],
];
for (const [code, head, call, message] of expectations) {
  const body = bodyOf(code, head);
  if (body === undefined) failures.push(`no ${head} in the source`);
  else if (!body.includes(call)) failures.push(message);
}
// The backlog does not build the command itself: a second path could diverge.
for (const needle of ["addCommand(", "createCommand(", "applyItemPatches("]) {
  if (backlog.includes(needle)) failures.push(`the backlog builds the command itself (${needle})`);
}
finish("backlog", failures);
