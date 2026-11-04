/**
 * The cycle check: a dependency graph with a cycle is reported, with the members of
 * every cycle, in finite time, and nothing is changed.
 *
 *  - on generated graphs with cycles, the reported groups are exactly the
 *    groups of tasks that reach each other — read off a brute-force
 *    reachability, not off the scheduler — plus every task that depends on
 *    itself, and nothing else (`cycle-members`);
 *  - a ring of 10 000 tasks, and a dense graph of 2 000 with cycles all
 *    through it, are reported well inside a second each — the search has no
 *    recursion to overflow and no exponential path (`finite`);
 *  - with a cycle, no task is placed, no command is made, and the frozen
 *    inputs are as they were (`nothing-changed`).
 */

import { describe, expect, it } from "vitest";

import type { Dependency } from "../../src/gantt/index.js";
import { scheduleCommand, scheduleTasks } from "../../src/schedule/index.js";
import type { Item } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { BASE, deepFreeze, HOUR } from "../schedule/fixture.js";

const SEED = Number(process.env.SDK_SCHEDULE_SEED ?? 2221);
const TYPES = ["FS", "SS", "FF", "SF"] as const;

function tasks(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({ id: `t${String(index)}`, start: BASE + index * HOUR, end: BASE + (index + 2) * HOUR }));
}

/** The groups that reach each other, by repeated search from every task. */
function referenceCycles(count: number, dependencies: readonly Dependency[]): string[][] {
  const next = Array.from({ length: count }, () => [] as number[]);
  for (const dependency of dependencies) next[Number(dependency.from.slice(1))]?.push(Number(dependency.to.slice(1)));
  const reach = next.map((_, from) => {
    const seen = new Set<number>();
    const stack = [...(next[from] as number[])];
    while (stack.length > 0) {
      const at = stack.pop() as number;
      if (seen.has(at)) continue;
      seen.add(at);
      stack.push(...(next[at] as number[]));
    }
    return seen;
  });
  const groups: string[][] = [];
  const placed = new Set<number>();
  for (let from = 0; from < count; from += 1) {
    if (placed.has(from) || !(reach[from] as Set<number>).has(from)) continue;
    const group = [from];
    for (let to = from + 1; to < count; to += 1) {
      if ((reach[from] as Set<number>).has(to) && (reach[to] as Set<number>).has(from)) group.push(to);
    }
    for (const member of group) placed.add(member);
    groups.push(group.map((member) => `t${String(member)}`));
  }
  return groups;
}

describe("cycle", () => {
  it("[claim:cycle-members] reports exactly the groups of tasks that reach each other, and every task that depends on itself", () => {
    const random = makeRandom(SEED);
    let groups = 0;
    let selfLoops = 0;
    for (let index = 0; index < 300; index += 1) {
      const count = 2 + Math.floor(random() * 14);
      const dependencies: Dependency[] = [];
      const density = 0.05 + random() * 0.2;
      for (let from = 0; from < count; from += 1) {
        for (let to = 0; to < count; to += 1) {
          if (from === to ? random() < 0.03 : random() < density) {
            dependencies.push({ from: `t${String(from)}`, to: `t${String(to)}`, type: TYPES[Math.floor(random() * 4)] ?? "FS" });
          }
        }
      }
      const expected = referenceCycles(count, dependencies);
      const schedule = scheduleTasks(tasks(count), dependencies);
      expect(schedule.cycles, `case ${String(index)}`).toEqual(expected);
      if (expected.length === 0) expect(schedule.tasks.size).toBe(count);
      groups += expected.length;
      selfLoops += expected.filter((group) => group.length === 1).length;
    }
    expect(groups).toBeGreaterThan(150);
    expect(selfLoops).toBeGreaterThan(20);
  });

  it("[claim:finite] reports a ring of 10 000 and a dense tangle of 2 000 well inside a second each", () => {
    const ring = tasks(10_000);
    const around = ring.map((item, index) => ({ from: item.id, to: `t${String((index + 1) % ring.length)}` }));
    let started = performance.now();
    const one = scheduleTasks(ring, around);
    const ringMs = performance.now() - started;
    expect(one.cycles.length).toBe(1);
    expect(one.cycles[0]?.length).toBe(10_000);
    expect(ringMs).toBeLessThan(1000);

    const random = makeRandom(SEED + 1);
    const tangle = tasks(2000);
    const knots: Dependency[] = [];
    for (let edge = 0; edge < 20_000; edge += 1) {
      knots.push({ from: `t${String(Math.floor(random() * 2000))}`, to: `t${String(Math.floor(random() * 2000))}` });
    }
    started = performance.now();
    const many = scheduleTasks(tangle, knots);
    const tangleMs = performance.now() - started;
    expect(many.cycles.length).toBeGreaterThan(0);
    expect(many.cycles.flat().length).toBeGreaterThan(1000);
    expect(tangleMs).toBeLessThan(1000);
  });

  it("[claim:nothing-changed] places nothing and makes no command when there is a cycle, and the inputs stay as they were", () => {
    const random = makeRandom(SEED + 2);
    for (let index = 0; index < 100; index += 1) {
      const count = 3 + Math.floor(random() * 10);
      const items = tasks(count);
      const dependencies: Dependency[] = [];
      for (let at = 1; at < count; at += 1) dependencies.push({ from: `t${String(at - 1)}`, to: `t${String(at)}`, lagMs: HOUR });
      // Close a loop somewhere.
      const back = 1 + Math.floor(random() * (count - 1));
      dependencies.push({ from: `t${String(back)}`, to: `t${String(Math.floor(random() * back))}` });
      const snapshot = JSON.stringify([items, dependencies]);
      deepFreeze(items);
      deepFreeze(dependencies);
      const schedule = scheduleTasks(items, dependencies, { projectStart: BASE });
      expect(schedule.cycles.length).toBe(1);
      expect(schedule.tasks.size).toBe(0);
      expect(schedule.critical).toEqual([]);
      expect(schedule.finish).toBeUndefined();
      expect(scheduleCommand(items, schedule)).toBeUndefined();
      expect(JSON.stringify([items, dependencies])).toBe(snapshot);
    }
  });
});
