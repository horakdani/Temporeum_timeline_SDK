import { afterAll, describe, expect, it } from "vitest";

import {
  applyPatches,
  createHitTester,
  editCommand,
  movePatch,
  resizePatch,
} from "../../src/editing.js";
import type { EditHit, MoveOptions, ResizeOptions } from "../../src/editing.js";
import { createInputMachine } from "../../src/input.js";
import type { PointerKind } from "../../src/input.js";
import { layoutItems } from "../../src/layout.js";
import { createTimeScale } from "../../src/scale.js";
import type { Command, Domain, Item, ItemPatch } from "../../src/types.js";
import { applyGroupPatches, moveGroupCommand } from "../../src/groups/index.js";
import type { Group } from "../../src/groups/index.js";
import { addCommand, applyItemPatches, removeCommand } from "../../src/items/index.js";
import { loadLaneOf, resourceLanes, withLoadLanes } from "../../src/resources/index.js";
import { scheduleCommand, scheduleTasks } from "../../src/schedule/index.js";
import type { WorkCalendar } from "../../src/schedule/index.js";
import { forAll, generateCase, writePropertyReport } from "./harness.js";
import type { GeneratedCase } from "./harness.js";

/**
 * The one promise the editing layer cannot keep approximately.
 *
 * Every command the SDK produces has to restore the **exact** starting state
 * when inverted — not a state that looks the same, and not only for the cases
 * I thought to write by hand. These properties generate the edits instead: a
 * random item set, then a random sequence of moves and resizes applied to it,
 * undone in reverse. "Exact" is taken literally: {@link sameItems} compares
 * the set of keys as well as the values, with `Object.is`, so an item that
 * gained a `laneId: undefined` where it previously had no `laneId` at all is
 * a failure. That strictness is what caught the gap in `ItemPatch.laneId`
 * while this suite was being written — an item dragged out of no lane could
 * not be told to go back to no lane, so the type grew a `null`.
 *
 * The last property drives the real input machine rather than the patch
 * helpers, because the helpers being invertible proves nothing about the
 * command a finger actually produces.
 */

const CASES = 600;
const DAY = 86_400_000;
const ORIGIN = Date.UTC(2020, 0, 1);
/** Wide enough that a generated item is on screen, so a gesture can grab it. */
const DOMAIN: Domain = [ORIGIN - 10 * DAY, ORIGIN + 440 * DAY];
const MAIN_SIZE = 900;
const LANE_COUNT = 3;

/** One generated edit, expressed the way a host would ask for it. */
interface EditStep {
  readonly id: string;
  readonly kind: "move" | "resize-start" | "resize-end";
  readonly deltaMs: number;
  /** Only for a move. `null` means "out of every lane". */
  readonly laneId?: string | null;
  readonly snapMs?: number;
}

/** One generated gesture, in pixels, for the property that drives the machine. */
interface GestureStep {
  readonly id: string;
  /** Where along the item's drawn extent the pointer goes down, 0 to 1. */
  readonly grab: number;
  /** Main-axis pixel deltas, one per move event. */
  readonly moves: readonly number[];
  readonly crossDelta: number;
  readonly pointerType: PointerKind;
}

function generateEdits(random: () => number, maxSteps: number): GeneratedCase<EditStep> {
  const base = generateCase(random, { open: true, lanes: laneCount(random) });
  const steps: EditStep[] = [];
  const count = base.items.length === 0 ? 0 : 1 + Math.floor(random() * maxSteps);
  for (let index = 0; index < count; index += 1) {
    const item = base.items[Math.floor(random() * base.items.length)];
    if (item === undefined) {
      continue;
    }
    const roll = random();
    const step: {
      id: string;
      kind: EditStep["kind"];
      deltaMs: number;
      laneId?: string | null;
      snapMs?: number;
    } = {
      id: item.id,
      kind: roll < 0.5 ? "move" : roll < 0.75 ? "resize-start" : "resize-end",
      // Both directions, and sometimes far enough to clamp.
      deltaMs: Math.round((random() * 2 - 1) * 20 * DAY),
    };
    if (step.kind === "move" && random() < 0.5) {
      // A lane change, including the drag out of every lane that the inverse
      // can only express because `laneId` is nullable.
      step.laneId = random() < 0.25 ? null : `lane${String(Math.floor(random() * LANE_COUNT))}`;
    }
    if (random() < 0.5) {
      step.snapMs = DAY;
    }
    steps.push(step as EditStep);
  }
  return { ...base, steps };
}

function generateGestures(random: () => number): GeneratedCase<GestureStep> {
  const base = generateCase(random, { open: true, lanes: laneCount(random) });
  const steps: GestureStep[] = [];
  const item = base.items[Math.floor(random() * Math.max(base.items.length, 1))];
  if (item !== undefined) {
    const moves: number[] = [];
    const count = 1 + Math.floor(random() * 3);
    for (let index = 0; index < count; index += 1) {
      // Always past any drag threshold, in both directions.
      moves.push(Math.round((6 + random() * 34) * (random() < 0.5 ? -1 : 1)));
    }
    steps.push({
      id: item.id,
      // The ends are the resize handles, the middle is the body.
      grab: [0.02, 0.5, 0.98][Math.floor(random() * 3)] ?? 0.5,
      moves,
      crossDelta: Math.round((random() * 2 - 1) * 40),
      pointerType: random() < 0.5 ? "mouse" : "touch",
    });
  }
  return { ...base, steps };
}

/**
 * How many lanes this case spreads over.
 *
 * One lane means the generator gives the items no `laneId` at all, which is
 * not a cosmetic variation: it is the only way to generate a drag *into* a
 * lane from nowhere, and therefore the only way to exercise the `null` that
 * lets the inverse say "this item had no lane". A generator that always
 * assigned a lane left that branch of `invertPatch` untested — proven by
 * breaking it and watching this suite stay green.
 */
function laneCount(random: () => number): number {
  return random() < 0.4 ? 1 : LANE_COUNT;
}

/** A body hit for an item, through the core's own hit tester. */
function hitOf(items: readonly Item[], id: string): EditHit | undefined {
  const layout = layoutItems(items);
  const scale = createTimeScale(DOMAIN, MAIN_SIZE);
  return createHitTester({ layout, scale }).lookup(id);
}

/** The command one generated step asks for, or nothing if it changes nothing. */
function commandFor(items: readonly Item[], step: EditStep): Command | undefined {
  const hit = hitOf(items, step.id);
  if (hit === undefined) {
    return undefined;
  }
  if (step.kind === "move") {
    const options: { deltaMs: number; laneId?: string | null; snapMs?: number } = {
      deltaMs: step.deltaMs,
    };
    if (step.laneId !== undefined) {
      options.laneId = step.laneId;
    }
    if (step.snapMs !== undefined) {
      options.snapMs = step.snapMs;
    }
    return editCommand("move", [hit], [movePatch(hit, options as MoveOptions)]);
  }
  const options: { edge: "start" | "end"; deltaMs: number; snapMs?: number } = {
    edge: step.kind === "resize-start" ? "start" : "end",
    deltaMs: step.deltaMs,
  };
  if (step.snapMs !== undefined) {
    options.snapMs = step.snapMs;
  }
  const patch = resizePatch(hit, options as ResizeOptions);
  if (patch === undefined) {
    return undefined;
  }
  return editCommand(step.kind, [hit], [patch]);
}

/**
 * Whether two item lists are the same, down to which keys exist.
 *
 * Returns a reason rather than a boolean so the shrinker has something to
 * print, and compares key sets because "restores the exact state" has to
 * exclude the near miss where undo leaves an explicit `undefined` behind.
 */
function sameItems(before: readonly Item[], after: readonly Item[]): string | undefined {
  if (before.length !== after.length) {
    return `${String(before.length)} items before, ${String(after.length)} after undo`;
  }
  for (let index = 0; index < before.length; index += 1) {
    const left = before[index];
    const right = after[index];
    if (left === undefined || right === undefined) {
      return `item ${String(index)} is missing`;
    }
    if (left.id !== right.id) {
      return `item ${String(index)} is ${right.id} after undo, was ${left.id}`;
    }
    const leftKeys = Object.keys(left).sort().join(",");
    const rightKeys = Object.keys(right).sort().join(",");
    if (leftKeys !== rightKeys) {
      return `${left.id}: keys [${leftKeys}] became [${rightKeys}]`;
    }
    for (const key of Object.keys(left)) {
      const a = (left as unknown as Record<string, unknown>)[key];
      const b = (right as unknown as Record<string, unknown>)[key];
      if (!Object.is(a, b)) {
        return `${left.id}.${key}: ${JSON.stringify(a)} became ${JSON.stringify(b)}`;
      }
    }
  }
  return undefined;
}

/** Run one generated gesture through a real machine and keep its command. */
function driveGesture(items: readonly Item[], step: GestureStep): Command | undefined {
  const layout = layoutItems(items);
  const scale = createTimeScale(DOMAIN, MAIN_SIZE);
  const tester = createHitTester({ layout, scale });
  const placed = layout.items.find((candidate) => candidate.item.id === step.id);
  if (placed === undefined) {
    return undefined;
  }
  // An open interval reaches past the viewport, so the drawn extent is what
  // the pointer can aim at, not the resolved span.
  const from = Math.max(scale.toMain(placed.span.start), 0);
  const to = Math.min(scale.toMain(placed.span.end), MAIN_SIZE);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return undefined;
  }
  const cross = placed.cross + placed.crossSize / 2;
  const machine = createInputMachine({
    domain: DOMAIN,
    mainSize: MAIN_SIZE,
    crossSize: layout.crossSize,
    contentCrossSize: layout.crossSize,
    editing: {
      enabled: true,
      // The hold is a different property's business; here every pointer type
      // drags at once, so mouse and finger reach the same command.
      moveTrigger: "edit-mode",
      crossLane: true,
      snapMs: DAY,
      hitTest: tester.hitTest,
      lookup: tester.lookup,
      laneAt: tester.laneAt,
    },
  });

  let main = from + (to - from) * step.grab;
  let time = 1000;
  const send = (phase: "down" | "move" | "up"): readonly { type: string }[] =>
    machine.handle({
      pointerId: 1,
      phase,
      x: main,
      y: phase === "down" ? cross : cross + step.crossDelta,
      time: (time += 16),
      pointerType: step.pointerType,
    });

  send("down");
  for (const delta of step.moves) {
    main += delta;
    send("move");
  }
  for (const effect of send("up")) {
    if (effect.type === "editEnd") {
      const command = (effect as { command?: Command }).command;
      if (command !== undefined) {
        return command;
      }
    }
  }
  return undefined;
}

describe("inverse properties", () => {
  it("restores the exact starting state from one inverse", () => {
    let applied = 0;
    forAll<EditStep>(
      "one inverse restores the state",
      CASES,
      0x5e1f,
      (random) => generateEdits(random, 1),
      ({ items, steps }) => {
        const step = (steps ?? [])[0];
        if (step === undefined) {
          return undefined;
        }
        const command = commandFor(items, step);
        if (command === undefined) {
          return undefined;
        }
        applied += 1;
        const edited = applyPatches(items, command.after);
        const undone = applyPatches(edited, command.inverse.after);
        return sameItems(items, undone);
      },
    );
    // A property that quietly skipped every case would still be green.
    expect(applied).toBeGreaterThan(CASES / 2);
  });

  it("restores the exact starting state from a sequence of inverses", () => {
    let longest = 0;
    forAll<EditStep>(
      "a sequence of inverses restores the state",
      CASES,
      0x5e92,
      (random) => generateEdits(random, 6),
      ({ items, steps }) => {
        const commands: Command[] = [];
        let current: readonly Item[] = items;
        for (const step of steps ?? []) {
          const command = commandFor(current, step);
          if (command === undefined) {
            continue;
          }
          commands.push(command);
          current = applyPatches(current, command.after);
        }
        longest = Math.max(longest, commands.length);
        // Last in, first out — the order an undo stack pops.
        for (let index = commands.length - 1; index >= 0; index -= 1) {
          const command = commands[index];
          if (command === undefined) {
            continue;
          }
          current = applyPatches(current, command.inverse.after);
        }
        return sameItems(items, current);
      },
    );
    expect(longest).toBeGreaterThanOrEqual(4);
  });

  it("treats the inverse of an inverse as the command itself", () => {
    let checked = 0;
    forAll<EditStep>(
      "an inverse of an inverse is the command",
      CASES,
      0x5ec3,
      (random) => generateEdits(random, 1),
      ({ items, steps }) => {
        const step = (steps ?? [])[0];
        if (step === undefined) {
          return undefined;
        }
        const command = commandFor(items, step);
        if (command === undefined) {
          return undefined;
        }
        checked += 1;
        // Identity, not equality: a fresh object each time would make an undo
        // stack grow without bound as the user toggles.
        if (command.inverse.inverse !== command) {
          return "the inverse of the inverse is a different object";
        }
        if (command.inverse.after !== command.before) {
          return "the inverse undoes something other than this command";
        }
        if (command.inverse.before !== command.after) {
          return "the inverse's own undo is not this command's result";
        }
        if (command.inverse.type !== command.type) {
          return `the inverse is a ${command.inverse.type}, not a ${command.type}`;
        }
        return undefined;
      },
    );
    expect(checked).toBeGreaterThan(CASES / 2);
  });

  it("keeps a command plain JSON, inverse and all", () => {
    let serialised = 0;
    forAll<EditStep>(
      "a command is serialisable",
      CASES,
      0x5e04,
      (random) => generateEdits(random, 1),
      ({ items, steps }) => {
        const step = (steps ?? [])[0];
        if (step === undefined) {
          return undefined;
        }
        const command = commandFor(items, step);
        if (command === undefined) {
          return undefined;
        }
        let json: string;
        try {
          json = JSON.stringify(command);
        } catch (error) {
          // A cyclic inverse lands here, which is the whole reason it is a
          // lazy getter rather than a field.
          return `JSON.stringify threw: ${String(error)}`;
        }
        serialised += 1;
        const parsed = JSON.parse(json) as {
          readonly before: readonly ItemPatch[];
          readonly after: readonly ItemPatch[];
          readonly inverse?: unknown;
        };
        if (parsed.inverse !== undefined) {
          return "the inverse was serialised — a stored command carries a copy of itself";
        }
        // The stored form has to be enough to undo the edit: that is what a
        // host persisting its history actually keeps.
        const edited = applyPatches(items, parsed.after);
        const undone = applyPatches(edited, parsed.before);
        return sameItems(items, undone);
      },
    );
    expect(serialised).toBeGreaterThan(CASES / 2);
  });

  it("inverts the commands its own gestures produce", () => {
    let gestures = 0;
    forAll<GestureStep>(
      "the machine's own commands invert",
      CASES,
      0x5e77,
      (random) => generateGestures(random),
      ({ items, steps }) => {
        const step = (steps ?? [])[0];
        if (step === undefined) {
          return undefined;
        }
        const command = driveGesture(items, step);
        if (command === undefined) {
          return undefined;
        }
        gestures += 1;
        const edited = applyPatches(items, command.after);
        const undone = applyPatches(edited, command.inverse.after);
        return sameItems(items, undone);
      },
    );
    // The helpers being invertible says nothing about the command a finger
    // produces, so this property has to have actually dragged something.
    expect(gestures).toBeGreaterThan(50);
  });

  // P19: adds, removes and group reorders are commands too, and their
  // inverses have to be exact in the same sense — order and identity.
  it("inverts adds and removes exactly, in sequences", () => {
    let applied = 0;
    forAll<number>(
      "an add or a remove inverts exactly",
      CASES,
      0x5e19,
      (random) => {
        const generated = generateCase(random, { lanes: 2 });
        return { items: generated.items, steps: Array.from({ length: 1 + Math.floor(random() * 6) }, () => Math.floor(random() * 1000)) };
      },
      ({ items, steps }) => {
        let state: readonly Item[] = items;
        const done: Command[] = [];
        for (const step of steps ?? []) {
          const command =
            state.length > 0 && step % 2 === 0
              ? removeCommand(state, state.filter((_, index) => (index + step) % 3 === 0).map((item) => item.id).concat((state[0] as Item).id))
              : addCommand(state, { id: `new-${String(step)}-${String(state.length)}`, start: step * 1000, label: "New" }, { index: step % (state.length + 1) });
          if (command === undefined) continue;
          const before = state;
          state = applyItemPatches(state, command.after);
          const undone = applyItemPatches(state, command.inverse.after);
          const once = sameItems(before, undone);
          if (once !== undefined) return `one inverse: ${once}`;
          if (undone.some((item, index) => item !== before[index])) return "an undone item is not the very object it was";
          done.push(command);
          applied += 1;
        }
        for (const command of done.reverse()) state = applyItemPatches(state, command.inverse.after);
        return sameItems(items, state);
      },
    );
    expect(applied).toBeGreaterThan(CASES / 2);
  });

  it("inverts group reorders exactly", () => {
    let applied = 0;
    forAll<number>(
      "a group reorder inverts exactly",
      CASES,
      0x5e20,
      (random) => ({ items: [], steps: Array.from({ length: 2 + Math.floor(random() * 10) }, () => Math.floor(random() * 1000)) }),
      ({ steps }) => {
        const values = steps ?? [];
        const groups: Group[] = values.map((value, index) => ({
          id: `g${String(index)}`,
          ...(index > 0 && value % 3 === 0 ? { parentId: `g${String(value % index)}` } : {}),
        }));
        let state: readonly Group[] = groups;
        const done = [];
        for (const [index, value] of values.entries()) {
          const command = moveGroupCommand(state, `g${String(index)}`, value % 4);
          if (command === undefined) continue;
          const before = state;
          state = applyGroupPatches(state, command.after);
          const undone = applyGroupPatches(state, command.inverse.after);
          if (undone.some((group, at) => group !== before[at])) return "one inverse did not restore the exact group list";
          done.push(command);
          applied += 1;
        }
        for (const command of done.reverse()) state = applyGroupPatches(state, command.inverse.after);
        return state.every((group, at) => group === groups[at]) && state.length === groups.length ? undefined : "the sequence did not unwind to the start";
      },
    );
    expect(applied).toBeGreaterThan(CASES / 4);
  });
  // P21: an automatic schedule is one command, and undoing it — alone or
  // after the next one — puts every task back exactly.
  it("inverts schedules exactly, in sequences", () => {
    let applied = 0;
    const calendars: readonly (WorkCalendar | undefined)[] = [undefined, {}, { timeZone: "Europe/Budapest", exceptions: [{ date: "2020-03-30" }] }];
    forAll<number>(
      "a schedule inverts exactly",
      CASES,
      0x5e21,
      (random) => {
        const generated = generateCase(random, { lanes: 2 });
        return { items: generated.items, steps: Array.from({ length: 1 + Math.floor(random() * 4) }, () => Math.floor(random() * 1_000_000)) };
      },
      ({ items, steps }) => {
        let state: readonly Item[] = items;
        const done: Command[] = [];
        for (const step of steps ?? []) {
          const dependencies = state.flatMap((item, index) =>
            index > 0 && (step + index) % 3 !== 0
              ? [{ from: (state[(step + index) % index] as Item).id, to: item.id, type: (["FS", "SS", "FF", "SF"] as const)[(step + index) % 4] ?? "FS", lagMs: ((step % 5) - 2) * 3_600_000 }]
              : [],
          );
          const calendar = calendars[step % calendars.length];
          const command = scheduleCommand(state, scheduleTasks(state, dependencies, { ...(calendar === undefined ? {} : { calendar }), ...(step % 2 === 0 ? { projectStart: ORIGIN } : {}) }));
          if (command === undefined) continue;
          if (command.type !== "schedule") return `a schedule is a "${command.type}" command`;
          const before = state;
          state = applyPatches(state, command.after);
          const undone = applyPatches(state, command.inverse.after);
          const once = sameItems(before, undone);
          if (once !== undefined) return `one inverse: ${once}`;
          done.push(command);
          applied += 1;
        }
        for (const command of done.reverse()) state = applyPatches(state, command.inverse.after);
        return sameItems(items, state);
      },
    );
    expect(applied).toBeGreaterThan(CASES / 2);
  });
});

describe("inverse properties", () => {
  it("inverts moves between resources exactly, by a drag onto any row", () => {
    const resources = Array.from({ length: LANE_COUNT }, (_, index) => ({ id: `lane${String(index)}`, capacity: 1 }));
    const lanes = withLoadLanes(resourceLanes(resources), resources, 24);
    let moved = 0;
    forAll<number>(
      "a move between resources inverts exactly",
      CASES,
      0x5e22,
      (random) => {
        const generated = generateCase(random, { lanes: LANE_COUNT });
        return { items: generated.items, steps: Array.from({ length: 4 }, () => random()) };
      },
      ({ items, steps }) => {
        const [pick = 0, across = 0, along = 0, type = 0] = steps ?? [];
        const layout = layoutItems(items, { lanes });
        const scale = createTimeScale(DOMAIN, MAIN_SIZE);
        const tester = createHitTester({ layout, scale });
        const grabbable = layout.items.filter((placed) => {
          const from = Math.max(scale.toMain(placed.span.start), 0);
          const to = Math.min(scale.toMain(placed.span.end), MAIN_SIZE);
          return Number.isFinite(from) && Number.isFinite(to) && to - from > 2;
        });
        const placed = grabbable[Math.floor(pick * grabbable.length)];
        if (placed === undefined) return undefined;
        const machine = createInputMachine({
          domain: DOMAIN,
          mainSize: MAIN_SIZE,
          crossSize: layout.crossSize,
          contentCrossSize: layout.crossSize,
          editing: {
            enabled: true,
            moveTrigger: "edit-mode",
            crossLane: true,
            snapMs: DAY,
            hitTest: tester.hitTest,
            lookup: tester.lookup,
            // A load lane is its resource's, as in the element.
            laneAt: (cross) => {
              const id = tester.laneAt(cross);
              return id === undefined ? undefined : (loadLaneOf(id) ?? id);
            },
          },
        });
        const main = (Math.max(scale.toMain(placed.span.start), 0) + Math.min(scale.toMain(placed.span.end), MAIN_SIZE)) / 2;
        const cross = placed.cross + placed.crossSize / 2;
        const to = across * layout.crossSize;
        const pointerType: PointerKind = type < 0.5 ? "mouse" : "touch";
        let time = 1000;
        machine.handle({ pointerId: 1, phase: "down", x: main, y: cross, time, pointerType });
        for (let step = 1; step <= 6; step += 1) {
          machine.handle({ pointerId: 1, phase: "move", x: main + ((along - 0.5) * 120 * step) / 6, y: cross + ((to - cross) * step) / 6, time: (time += 16), pointerType });
        }
        const end = machine.handle({ pointerId: 1, phase: "up", x: main + (along - 0.5) * 120, y: to, time: time + 16, pointerType });
        const command = end.flatMap((effect) => (effect.type === "editEnd" && effect.command !== undefined ? [effect.command] : []))[0];
        if (command === undefined) return undefined;
        if (command.type !== "move") return `a move between resources is a "${command.type}" command`;
        for (const patch of command.after) {
          if (typeof patch.laneId === "string" && loadLaneOf(patch.laneId) !== undefined) return `${patch.id} was moved into the load lane ${patch.laneId}`;
        }
        moved += 1;
        const after = applyPatches(items, command.after);
        const once = sameItems(items, applyPatches(after, command.inverse.after));
        if (once !== undefined) return once;
        return JSON.stringify(command.inverse.inverse) === JSON.stringify(command) ? undefined : "the inverse of the inverse is another command";
      },
    );
    expect(moved).toBeGreaterThan(CASES / 2);
  });
});

afterAll(() => {
  writePropertyReport("inverse");
});
