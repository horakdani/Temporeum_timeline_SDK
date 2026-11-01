#!/usr/bin/env node
/**
 * G-SCHEDULE-PERF: 10 000 feladat es 20 000 fuggoseg utemezese Node-ban a
 * kerete alatt van.
 *
 * A kiadott ESM-et meri (dist/schedule.mjs, a csomagparancs elotte epit),
 * egy budapesti munkanaptarral, unnepnapokkal es a nyari idoszamitas
 * valtasaval, mind a negy fuggosegtipussal, kesleltetessel es megkotesekkel.
 * Minden futas friss naptar-objektumot kap, igy a naptar forditasa is a
 * mert idoben van. Het futas medianja a keret ala kell essen.
 *
 * A mert futas nem ures: az eredmenyben minden fuggoseg tart (munkaidoben,
 * az utod naptaraban), kor nincs, es a feladatok tobbsege mozog — egy
 * keret, amit egy semmit nem csinalo utemezo tartana, nem bizonyit semmit.
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
  console.error(`G-SCHEDULE-PERF: nincs ${dist} — a build nem futott, ezert BUKAS`);
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
if (result.cycles.length > 0) failures.push(`a mert projektben kor van (${result.cycles.length})`);
const time = workTime(calendar);
let broken = 0;
for (const dependency of dependencies) {
  const from = result.tasks.get(dependency.from);
  const to = result.tasks.get(dependency.to);
  const fromEdge = dependency.type[0] === "S" ? from.start : (from.end ?? from.start);
  const toEdge = dependency.type[1] === "S" ? to.start : (to.end ?? to.start);
  if (time.work(toEdge) < time.work(fromEdge) + dependency.lagMs) broken += 1;
}
if (broken > 0) failures.push(`${broken} fuggoseg nem tart a mert eredmenyben`);
const moved = [...result.tasks.values()].filter((task) => task.moved).length;
if (moved < TASKS / 2) failures.push(`csak ${moved} feladat mozdult — a mert futas majdnem ures`);

console.log(`  ${TASKS} feladat, ${DEPENDENCIES} fuggoseg, budapesti munkanaptar: median ${median.toFixed(1)} ms (futasok: ${times.map((t) => t.toFixed(1)).join(" ")} ms), keret ${BUDGET_MS} ms`);
console.log(`  mozdult ${moved}, kritikus ${result.critical.length}, konfliktus ${result.conflicts.length}, megtort fuggoseg ${broken}`);
if (!(median <= BUDGET_MS)) failures.push(`a median ${median.toFixed(1)} ms, a keret ${BUDGET_MS} ms`);
if (failures.length > 0) {
  console.error("G-SCHEDULE-PERF: BUKOTT");
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exit(1);
}
console.log("G-SCHEDULE-PERF: a keret alatt.");
