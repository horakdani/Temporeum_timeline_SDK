/**
 * The schedule-cmd check: the automatic schedule is one command, its inverse is the
 * exact start, and the library saves nothing while scheduling.
 *
 *  - `scheduleCommand` gives exactly one `schedule` command, with a patch for
 *    every task the schedule moves and none for the rest, in item order, and
 *    applying it puts every task where the schedule says (`one-command`);
 *  - its inverse restores the items exactly — every key, every value, the
 *    very objects that did not move — alone and after further schedules, and
 *    the inverse of the inverse is the command (`inverse-exact`);
 *  - scheduling and making the command write nothing: the inputs are frozen
 *    all the way down, and every way out of the process — network, storage,
 *    timers — throws while they run (`no-save`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { applyPatches } from "../../src/editing.js";
import { scheduleCommand, scheduleTasks } from "../../src/schedule/index.js";
import type { Item } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { deepFreeze, generateProject, HOUR_CALENDARS, movedItems, optionsOf } from "../schedule/fixture.js";
import type { ProjectShape } from "../schedule/fixture.js";

const SEED = Number(process.env.SDK_SCHEDULE_SEED ?? 2121);
const CASES = 300;
const SHAPE: ProjectShape = {
  tasks: 12,
  density: 0.25,
  calendars: HOUR_CALENDARS,
  constraintTypes: ["startNoEarlierThan", "finishNoLaterThan", "asLateAsPossible", "mustStartOn"],
  constraintChance: 0.3,
  spreadHours: 40,
  projectStart: true,
};

/** Every key and value, `Object.is` — an `end: undefined` where there was no `end` is a difference. */
function sameItems(before: readonly Item[], after: readonly Item[]): string | undefined {
  if (before.length !== after.length) return `${String(before.length)} items before, ${String(after.length)} after`;
  for (const [index, item] of before.entries()) {
    const other = after[index] as Item;
    const keys = Object.keys(item).sort().join(",");
    if (keys !== Object.keys(other).sort().join(",")) return `${item.id}: keys [${keys}] became [${Object.keys(other).sort().join(",")}]`;
    for (const key of Object.keys(item)) {
      if (!Object.is((item as unknown as Record<string, unknown>)[key], (other as unknown as Record<string, unknown>)[key])) return `${item.id}.${key} differs`;
    }
  }
  return undefined;
}

describe("schedule cmd", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[claim:one-command] gives one schedule command, patching exactly the tasks that move, in item order", () => {
    const random = makeRandom(SEED);
    let commands = 0;
    let still = 0;
    for (let index = 0; index < CASES; index += 1) {
      const project = generateProject(random, { ...SHAPE, tasks: 1 + Math.floor(random() * SHAPE.tasks) });
      const schedule = scheduleTasks(project.items, project.dependencies, optionsOf(project));
      const command = scheduleCommand(project.items, schedule, "Auto-schedule");
      const moving = project.items.filter((item) => schedule.tasks.get(item.id)?.moved === true).map((item) => item.id);
      if (moving.length === 0) {
        expect(command).toBeUndefined();
        still += 1;
        continue;
      }
      expect(command?.type).toBe("schedule");
      expect(command?.label).toBe("Auto-schedule");
      expect(command?.after.map((patch) => patch.id)).toEqual(moving);
      expect(command?.before.map((patch) => patch.id)).toEqual(moving);
      const applied = applyPatches(project.items, command?.after ?? []);
      expect(sameItems(movedItems(project.items, schedule), applied)).toBeUndefined();
      // An item the schedule leaves is the very same object.
      for (const [at, item] of project.items.entries()) {
        if (!moving.includes(item.id)) expect(applied[at]).toBe(item);
      }
      commands += 1;
    }
    expect(commands).toBeGreaterThan(CASES / 2);
    expect(still).toBeGreaterThan(5);
  });

  it("[claim:inverse-exact] undoes to the exact start, alone and after further schedules", () => {
    const random = makeRandom(SEED + 1);
    let undone = 0;
    for (let index = 0; index < CASES; index += 1) {
      const project = generateProject(random, { ...SHAPE, tasks: 2 + Math.floor(random() * SHAPE.tasks) });
      const options = optionsOf(project);
      let state: readonly Item[] = project.items;
      const done = [];
      for (let step = 0; step < 3; step += 1) {
        // Each step changes the arrows a little, so the next schedule has something to do.
        const dependencies = project.dependencies.filter((_, at) => (at + step) % 3 !== 0);
        const command = scheduleCommand(state, scheduleTasks(state, dependencies, options));
        if (command === undefined) continue;
        expect(command.inverse.inverse).toBe(command);
        expect(command.inverse.type).toBe("schedule");
        const before = state;
        state = applyPatches(state, command.after);
        const back = applyPatches(state, command.inverse.after);
        expect(sameItems(before, back)).toBeUndefined();
        for (const [at, item] of before.entries()) {
          if (!command.after.some((patch) => patch.id === item.id)) expect(back[at]).toBe(item);
        }
        done.push(command);
      }
      for (const command of done.reverse()) state = applyPatches(state, command.inverse.after);
      expect(sameItems(project.items, state)).toBeUndefined();
      // A command is plain data: it survives JSON, and the copy undoes the same.
      for (const command of done) {
        const copy = JSON.parse(JSON.stringify(command)) as { after: unknown; before: unknown; type: string };
        expect(copy.after).toEqual(command.after);
        expect(copy.before).toEqual(command.before);
      }
      undone += done.length;
    }
    expect(undone).toBeGreaterThan(CASES);
  });

  it("[claim:no-save] writes nothing and reaches nothing outside while it schedules", () => {
    const touched: string[] = [];
    const trap = (name: string) => () => {
      touched.push(name);
      throw new Error(`the scheduler reached for ${name}`);
    };
    vi.stubGlobal("fetch", trap("fetch"));
    vi.stubGlobal("XMLHttpRequest", trap("XMLHttpRequest"));
    vi.stubGlobal("WebSocket", trap("WebSocket"));
    vi.stubGlobal("setTimeout", trap("setTimeout"));
    vi.stubGlobal("setInterval", trap("setInterval"));
    vi.stubGlobal("queueMicrotask", trap("queueMicrotask"));
    const OUTSIDE = ["localStorage", "sessionStorage", "indexedDB", "navigator", "document"];
    const kept = new Map(OUTSIDE.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of OUTSIDE) {
      Object.defineProperty(globalThis, name, { configurable: true, get: trap(name) });
    }
    const random = makeRandom(SEED + 2);
    let moved = 0;
    try {
      for (let index = 0; index < 100; index += 1) {
        const project = generateProject(random, { ...SHAPE, tasks: 2 + Math.floor(random() * SHAPE.tasks) });
        const snapshot = JSON.stringify(project.items);
        deepFreeze(project.items);
        deepFreeze(project.dependencies);
        for (const constraint of project.constraints.values()) deepFreeze(constraint);
        const schedule = scheduleTasks(project.items, project.dependencies, optionsOf(project));
        const command = scheduleCommand(project.items, schedule);
        expect(JSON.stringify(project.items)).toBe(snapshot);
        moved += command?.after.length ?? 0;
      }
    } finally {
      vi.unstubAllGlobals();
      for (const [name, descriptor] of kept) {
        if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name];
        else Object.defineProperty(globalThis, name, descriptor);
      }
    }
    expect(touched).toEqual([]);
    expect(moved).toBeGreaterThan(100);
  });
});
