#!/usr/bin/env node
/**
 * The schedule-perf check: scheduling 10 000 tasks and 20 000 dependencies in Node
 * stays within its budget.
 *
 * It measures the shipped ESM (dist/schedule.mjs; the package command builds
 * it first), with a Budapest work calendar, public holidays and a daylight
 * saving time change, all four dependency types, lags and constraints.
 * Every run gets a fresh calendar object, so compiling the calendar is part
 * of the measured time too. The median of seven runs must be within budget.
 *
 * The measured run is not empty: in the result every dependency holds (in
 * working time, in the successor's calendar), there are no cycles, and most
 * tasks move — a budget that a scheduler doing nothing would meet proves
 * nothing.
 */
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "core", "dist", "schedule.mjs");
const BUDGET_MS = 100;
const RUNS = 7;
const TASKS = 10_000;
const DEPENDENCIES = 20_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

if (!existsSync(dist)) {
  console.error(`schedule-perf: no ${dist} — the build did not run, so FAIL`);
  process.exit(1);
}
const { scheduleTasks, workTime } = await import(pathToFileURL(dist).href);

let seed = 21;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const BASE = Date.UTC(2025, 0, 6, 7);
const TYPES = ["FS", "SS", "FF", "SF"];
const items = [];
for (let index = 0; index < TASKS; index += 1) {
  const start = BASE + Math.floor(random() * 300) * DAY + Math.floor(random() * 8) * HOUR;
  items.push(random() < 0.05 ? { id: `t${index}`, start, kind: "milestone" } : { id: `t${index}`, start, end: start + (1 + Math.floor(random() * 40)) * HOUR });
}
const dependencies = [];
while (dependencies.length < DEPENDENCIES) {
  const to = 1 + Math.floor(random() * (TASKS - 1));
  const from = Math.floor(random() * to);
  dependencies.push({ from: `t${from}`, to: `t${to}`, type: TYPES[Math.floor(random() * 4)], lagMs: Math.floor(random() * 5 - 2) * HOUR });
}
const constraints = new Map();
for (let index = 0; index < TASKS; index += 50) {
  constraints.set(`t${index}`, { type: index % 100 === 0 ? "startNoEarlierThan" : "finishNoLaterThan", date: BASE + Math.floor(random() * 300) * DAY });
}
const calendarOf = () => ({
  timeZone: "Europe/Budapest",
  exceptions: [{ date: "2025-04-18", until: "2025-04-21" }, { date: "2025-05-01" }, { date: "2025-08-20" }, { date: "2025-10-23" }],
});

const times = [];
let result;
let calendar;
for (let run = 0; run < RUNS; run += 1) {
  calendar = calendarOf();
  const started = performance.now();
  result = scheduleTasks(items, dependencies, { calendar, constraintOf: (item) => constraints.get(item.id), projectStart: BASE });
  times.push(performance.now() - started);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(RUNS / 2)];

const failures = [];
if (result.cycles.length > 0) failures.push(`the measured project has cycles (${result.cycles.length})`);
const time = workTime(calendar);
let broken = 0;
for (const dependency of dependencies) {
  const from = result.tasks.get(dependency.from);
  const to = result.tasks.get(dependency.to);
  const fromEdge = dependency.type[0] === "S" ? from.start : (from.end ?? from.start);
  const toEdge = dependency.type[1] === "S" ? to.start : (to.end ?? to.start);
  if (time.work(toEdge) < time.work(fromEdge) + dependency.lagMs) broken += 1;
}
if (broken > 0) failures.push(`${broken} dependencies do not hold in the measured result`);
const moved = [...result.tasks.values()].filter((task) => task.moved).length;
if (moved < TASKS / 2) failures.push(`only ${moved} tasks moved — the measured run is almost empty`);

console.log(`  ${TASKS} tasks, ${DEPENDENCIES} dependencies, Budapest work calendar: median ${median.toFixed(1)} ms (runs: ${times.map((t) => t.toFixed(1)).join(" ")} ms), budget ${BUDGET_MS} ms`);
console.log(`  moved ${moved}, critical ${result.critical.length}, conflicts ${result.conflicts.length}, broken dependencies ${broken}`);
if (!(median <= BUDGET_MS)) failures.push(`the median is ${median.toFixed(1)} ms, the budget ${BUDGET_MS} ms`);
if (failures.length > 0) {
  console.error("schedule-perf: FAILED");
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exit(1);
}
console.log("schedule-perf: within budget.");
