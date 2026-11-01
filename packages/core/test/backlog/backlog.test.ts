/**
 * G-BACKLOG: an unscheduled task goes onto the timeline by a gesture and by
 * a key, with the same command.
 *
 * The browser binding (`mountBacklog` of the element) only decides where:
 * a release asks for the time and the lane under the pointer
 * (`dropItemAt`), a key for the middle of the view in the focused item's
 * lane (`dropItem`); both reach the one add path. This suite drives that
 * path as the binding does, with the core's own pieces:
 *
 *  - for generated tasks and views, the gesture's target and the key's
 *    target give `add` commands of one patch, with the task's own id,
 *    fields and length, in the lane under the pointer — a load lane counting
 *    as its resource — or the focused one; and a gesture let go where the
 *    key would put the task gives exactly the key's command (`same-command`);
 *  - the task leaves the list when the command is applied, and comes back
 *    with the exact items when its inverse is (`back-on-undo`).
 *
 * That the binding calls those two methods, and that both end in the one
 * add, the measurer reads from the element's source.
 */

import { describe, expect, it } from "vitest";

import { addCommand, addTargetAt, addTargetFromFocus, applyItemPatches, itemFromDrop } from "../../src/items/index.js";
import type { AddTarget } from "../../src/items/index.js";
import { layoutItems } from "../../src/layout.js";
import { createHitTester } from "../../src/editing.js";
import { loadLaneOf, resourceLanes, unscheduledTasks, withLoadLanes } from "../../src/resources/index.js";
import type { BacklogTask } from "../../src/resources/index.js";
import { createTimeScale } from "../../src/scale.js";
import type { Command, Item } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { BASE, DAY, HOUR, sameItems } from "../resources/fixture.js";

const SEED = Number(process.env.SDK_BACKLOG_SEED ?? 2223);
const CASES = 300;

interface Scene {
  readonly items: Item[];
  readonly tasks: BacklogTask[];
  readonly resources: { id: string; label: string }[];
  readonly domain: readonly [number, number];
}

function generate(random: () => number): Scene {
  const resources = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, index) => ({ id: `r${String(index)}`, label: `Person ${String(index)}` }));
  const items: Item[] = Array.from({ length: Math.floor(random() * 12) }, (_, index) => {
    const start = BASE + Math.floor(random() * 96) * HOUR;
    return { id: `i${String(index)}`, start, end: start + (1 + Math.floor(random() * 12)) * HOUR, laneId: (resources[Math.floor(random() * resources.length)] as { id: string }).id };
  });
  const tasks: BacklogTask[] = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, index) => {
    const pick = random();
    return pick < 0.3
      ? { id: `t${String(index)}`, label: `Task ${String(index)}` }
      : pick < 0.9
        ? { id: `t${String(index)}`, label: `Task ${String(index)}`, durationMs: (1 + Math.floor(random() * 16)) * HOUR, className: "from-backlog", data: { cost: index } }
        : { id: `t${String(index)}`, durationMs: HOUR };
  });
  const from = BASE + Math.floor(random() * 48) * HOUR;
  return { items, tasks, resources, domain: [from, from + (1 + Math.floor(random() * 10)) * DAY] };
}

/** The add's one patch, and its item. */
function addedItem(command: Command | undefined): Item {
  expect(command?.type).toBe("add");
  expect(command?.after).toHaveLength(1);
  expect(command?.before).toEqual([{ id: command?.after[0]?.id, item: null, index: command?.after[0]?.index }]);
  return command?.after[0]?.item as Item;
}

/** What the task should be on the timeline, at a target. */
function expectedItem(task: BacklogTask, target: AddTarget): Record<string, unknown> {
  const { durationMs, ...fields } = task;
  return {
    label: "New item",
    ...fields,
    start: target.start,
    end: durationMs === undefined ? target.end : target.start + durationMs,
    ...(target.laneId === null ? {} : { laneId: target.laneId }),
  };
}

describe("G-BACKLOG", () => {
  it("[claim:same-command] places a task by a gesture and by a key with the same add command", () => {
    const random = makeRandom(SEED);
    let gestures = 0;
    let onLoadLane = 0;
    let identical = 0;
    for (let index = 0; index < CASES; index += 1) {
      const scene = generate(random);
      const lanes = withLoadLanes(resourceLanes(scene.resources), scene.resources, 24);
      const layout = layoutItems(scene.items, { lanes });
      const scale = createTimeScale(scene.domain, 1000);
      const tester = createHitTester({ layout, scale });
      // The element's lane under a point: a load lane is its resource's.
      const laneAt = (cross: number): string | undefined => {
        const id = tester.laneAt(cross);
        return id === undefined ? undefined : (loadLaneOf(id) ?? id);
      };
      const options = random() < 0.5 ? {} : { snapMs: HOUR };
      const task = scene.tasks[Math.floor(random() * scene.tasks.length)] as BacklogTask;
      const payload = JSON.stringify(task);

      // The gesture: let go somewhere over the rows.
      const point = { main: random() * 1000, cross: random() * layout.crossSize };
      const dropped = addTargetAt(point, scale, laneAt, options);
      const byGesture = addCommand(scene.items, itemFromDrop(scene.items, payload, dropped) as Item);
      const gestureItem = addedItem(byGesture);
      expect(gestureItem, `case ${String(index)}`).toEqual(expectedItem(task, dropped));
      expect(gestureItem.laneId === undefined || loadLaneOf(gestureItem.laneId) === undefined).toBe(true);
      if (loadLaneOf(tester.laneAt(point.cross) ?? "") !== undefined) onLoadLane += 1;
      gestures += 1;

      // The key: the middle of the view, in the focused item's lane.
      const focused = scene.items.length === 0 ? null : ((scene.items[Math.floor(random() * scene.items.length)] as Item).laneId ?? null);
      const keyed = addTargetFromFocus(scene.domain, focused, options);
      const byKey = addCommand(scene.items, itemFromDrop(scene.items, payload, keyed) as Item);
      expect(addedItem(byKey)).toEqual(expectedItem(task, keyed));

      // Let go where the key puts it: the very same command.
      if (focused !== null) {
        const lane = layout.lanes.find((each) => each.lane.id === focused);
        if (lane === undefined) throw new Error("the focused lane is not laid out");
        const there = addTargetAt({ main: 500, cross: lane.cross + lane.crossSize / 2 }, scale, laneAt, options);
        const same = addCommand(scene.items, itemFromDrop(scene.items, payload, there) as Item);
        expect(JSON.stringify(same)).toBe(JSON.stringify(byKey));
        expect(same?.type).toBe(byKey?.type);
        identical += 1;
      }
    }
    expect(gestures).toBe(CASES);
    expect(onLoadLane).toBeGreaterThan(CASES / 10);
    expect(identical).toBeGreaterThan(CASES / 2);
  });

  it("[claim:back-on-undo] takes the task off the list when placed, and puts it back with the exact items when undone", () => {
    const random = makeRandom(SEED + 1);
    let placed = 0;
    for (let index = 0; index < CASES; index += 1) {
      const scene = generate(random);
      let items: readonly Item[] = scene.items;
      const done: Command[] = [];
      // Place every task, one after another, each where the key would.
      for (const task of unscheduledTasks(scene.tasks, items)) {
        const before = unscheduledTasks(scene.tasks, items);
        expect(before).toContain(task);
        const command = addCommand(items, itemFromDrop(items, JSON.stringify(task), addTargetFromFocus(scene.domain, null)) as Item);
        if (command === undefined) throw new Error(`case ${String(index)}: ${task.id} could not be placed`);
        items = applyItemPatches(items, command.after);
        expect(unscheduledTasks(scene.tasks, items)).not.toContain(task);
        expect(unscheduledTasks(scene.tasks, items)).toHaveLength(before.length - 1);
        done.push(command);
        placed += 1;
      }
      expect(unscheduledTasks(scene.tasks, items)).toEqual([]);
      // A task already placed cannot be placed twice.
      const again = scene.tasks[0] as BacklogTask;
      expect(addCommand(items, itemFromDrop(items, JSON.stringify(again), addTargetFromFocus(scene.domain, null)) as Item)).toBeUndefined();
      // Undo in reverse: each task comes back, in its own place on the list.
      for (const command of done.reverse()) {
        items = applyItemPatches(items, command.inverse.after);
        expect(unscheduledTasks(scene.tasks, items).map((task) => task.id)).toContain(command.after[0]?.id);
      }
      expect(sameItems(scene.items, items)).toBeUndefined();
      expect(unscheduledTasks(scene.tasks, items)).toEqual(scene.tasks);
    }
    expect(placed).toBeGreaterThan(CASES);
  });
});
