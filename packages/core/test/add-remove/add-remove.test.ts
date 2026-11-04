/**
 * The add-remove check: adding and removing items.
 *
 *  - The gesture and the keyboard reach the same command: a double tap on
 *    empty lane space and `n` with the focus in that lane, at the same time,
 *    give the same target, the same item and the same command; a tap on a
 *    remove handle and `Delete` on the focused item remove the same items.
 *  - The inverse restores the exact starting list — order and identity —
 *    on generated lists and generated sequences of adds and removes.
 *  - The host's veto is atomic: one refused item refuses the whole removal,
 *    and nothing changes.
 */

import { describe, expect, it } from "vitest";

import {
  addCommand,
  addTargetAt,
  addTargetFromFocus,
  applyItemPatches,
  DROP_MIME,
  itemForTarget,
  itemFromDrop,
  removeCommand,
  removeTargets,
  resolveItemKey,
} from "../../src/items/index.js";
import { layoutItems } from "../../src/layout.js";
import { createTimeScale } from "../../src/scale.js";
import type { Command, Item } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2024, 0, 1);
const SEED = Number(process.env.SDK_ADD_REMOVE_SEED ?? 1920);
const key = (name: string, extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  key: name,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  time: 0,
  ...extra,
});

function list(random: () => number): Item[] {
  const count = Math.floor(random() * 12);
  return Array.from({ length: count }, (_, index) => {
    const start = ORIGIN + Math.floor(random() * 30) * DAY;
    return { id: `i${String(index)}`, start, end: start + DAY, laneId: random() < 0.5 ? "a" : "b", label: `Item ${String(index)}` };
  });
}

describe("add and remove", () => {
  // The seed is printed so a failure can be replayed (SDK_ADD_REMOVE_SEED).
  // eslint-disable-next-line no-console
  console.log(`[add-remove] seed=${String(SEED)}`);

  it("[claim:same-command] a double tap and the n key at the same place give the same command", () => {
    const domain = [ORIGIN, ORIGIN + 20 * DAY] as const;
    const scale = createTimeScale(domain, 1000);
    const items: Item[] = [{ id: "x", start: ORIGIN, laneId: "b" }];
    const laneAt = (cross: number) => (cross < 50 ? "a" : "b");
    for (const options of [{}, { snapMs: DAY }, { durationMs: 3 * DAY }]) {
      // The keyboard adds in the middle of the view, in the focused item's lane.
      const tap = addTargetAt({ main: 500, cross: 70 }, scale, laneAt, options);
      const keyed = addTargetFromFocus(domain, "b", options);
      expect(resolveItemKey(key("n"))).toBe("add");
      expect(resolveItemKey(key("Insert"))).toBe("add");
      expect(keyed).toEqual(tap);
      const byTap = addCommand(items, itemForTarget(items, tap) as Item);
      const byKey = addCommand(items, itemForTarget(items, keyed) as Item);
      expect(byKey).toEqual(byTap);
      expect(byKey?.after[0]?.item).toMatchObject({ laneId: "b", label: "New item" });
    }
  });

  it("[claim:same-command] a tap on the remove handle and Delete on the focus remove the same items", () => {
    const items: Item[] = [
      { id: "a", start: ORIGIN },
      { id: "b", start: ORIGIN + DAY },
      { id: "c", start: ORIGIN + 2 * DAY },
    ];
    expect(resolveItemKey(key("Delete"))).toBe("remove");
    expect(resolveItemKey(key("Backspace"))).toBe("remove");
    for (const [selected, multi] of [[["b", "c"], true], [["b", "c"], false], [[], true]] as const) {
      const byHandle = removeCommand(items, removeTargets("b", selected, { multiSelect: multi }));
      const byKey = removeCommand(items, removeTargets("b", selected, { multiSelect: multi }));
      expect(byKey).toEqual(byHandle);
    }
    expect(removeTargets("b", ["b", "c"], { multiSelect: true })).toEqual(["b", "c"]);
    expect(removeTargets("b", ["c"], { multiSelect: true })).toEqual(["b"]);
    expect(removeTargets("b", ["b", "c"], { multiSelect: false })).toEqual(["b"]);
  });

  it("[claim:inverse-exact] the inverse restores the exact starting list on generated sequences", () => {
    const random = makeRandom(SEED);
    let steps = 0;
    for (let round = 0; round < 200; round += 1) {
      const start = list(random);
      let items = start;
      const done: Command[] = [];
      for (let step = 0; step < 6; step += 1) {
        let command: Command | undefined;
        if (items.length > 0 && random() < 0.5) {
          const picked = items.filter(() => random() < 0.4).map((item) => item.id);
          command = removeCommand(items, picked.length > 0 ? picked : [(items[0] as Item).id]);
        } else {
          const at = Math.floor(random() * (items.length + 1));
          const target = addTargetFromFocus([ORIGIN, ORIGIN + 10 * DAY], random() < 0.5 ? "a" : null);
          command = addCommand(items, itemForTarget(items, target) as Item, { index: at });
        }
        if (command === undefined) continue;
        const before = items;
        items = applyItemPatches(items, command.after);
        const undone = applyItemPatches(items, command.inverse.after);
        expect(undone).toEqual(before);
        undone.forEach((item, index) => expect(item).toBe(before[index]));
        done.push(command);
        steps += 1;
      }
      for (const command of done.reverse()) items = applyItemPatches(items, command.inverse.after);
      expect(items).toEqual(start);
    }
    expect(steps).toBeGreaterThan(500);
  });

  it("[claim:veto-atomic] one refused item refuses the whole removal, and a refused add adds nothing", () => {
    const items: Item[] = [
      { id: "a", start: ORIGIN },
      { id: "b", start: ORIGIN + DAY },
      { id: "c", start: ORIGIN + 2 * DAY, removable: false },
    ];
    expect(removeCommand(items, ["a", "b"], { canRemove: (item) => item.id !== "b" })).toBeUndefined();
    expect(removeCommand(items, ["a", "c"])).toBeUndefined();
    expect(removeCommand(items, ["a"], { canRemove: () => true })?.after).toEqual([{ id: "a", item: null, index: 0 }]);
    expect(removeCommand(items, ["zzz"])).toBeUndefined();
    const fresh = { id: "n", start: ORIGIN };
    expect(addCommand(items, fresh, { canAdd: () => false })).toBeUndefined();
    expect(addCommand(items, { id: "a", start: ORIGIN })).toBeUndefined();
    expect(addCommand(items, fresh, { canAdd: () => true, label: "Add" })?.label).toBe("Add");
  });

  it("applies plain patches around adds and removes, and leaves the rest by reference", () => {
    const items: Item[] = [{ id: "a", start: ORIGIN }, { id: "b", start: ORIGIN }];
    const moved = applyItemPatches(items, [{ id: "a", start: ORIGIN + DAY }]);
    expect(moved[0]?.start).toBe(ORIGIN + DAY);
    expect(moved[1]).toBe(items[1]);
    const mixed = applyItemPatches(items, [
      { id: "c", item: { id: "c", start: ORIGIN } },
      { id: "c", start: ORIGIN + 2 * DAY },
      { id: "a", item: { id: "a", start: 5 } },
      { id: "zzz", item: null },
    ]);
    expect(mixed.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(mixed[0]?.start).toBe(5);
    expect(mixed[2]?.start).toBe(ORIGIN + 2 * DAY);
  });

  it("finds a free id, and lets the host make the item", () => {
    const items: Item[] = [{ id: "item-2", start: 0 }];
    const target = { start: 10, end: 20, laneId: null };
    expect(itemForTarget(items, target)?.id).toBe("item-3");
    expect(itemForTarget(items, target)).not.toHaveProperty("laneId");
    expect(itemForTarget(items, target, (at) => ({ id: "own", start: at.start }))).toEqual({ id: "own", start: 10 });
    expect(resolveItemKey(key("n", { ctrlKey: true }))).toBeUndefined();
    expect(resolveItemKey(key("Delete", { altKey: true }))).toBeUndefined();
    expect(resolveItemKey(key("x"))).toBeUndefined();
  });

  it("turns a dropped payload into an item at the drop target", () => {
    const target = { start: ORIGIN, end: ORIGIN + DAY, laneId: "b" };
    expect(DROP_MIME).toBe("application/x-temporeum-item");
    expect(itemFromDrop([], JSON.stringify({ id: "ext", label: "External", durationMs: 2 * DAY }), target)).toEqual({
      id: "ext",
      label: "External",
      start: ORIGIN,
      end: ORIGIN + 2 * DAY,
      laneId: "b",
    });
    expect(itemFromDrop([], JSON.stringify({ label: "No id", start: 0, end: 3 * DAY }), target)).toMatchObject({
      id: "item-1",
      end: ORIGIN + 3 * DAY,
    });
    expect(itemFromDrop([], JSON.stringify({ label: "x" }), target)?.end).toBe(ORIGIN + DAY);
    expect(itemFromDrop([], "not json", target)).toBeUndefined();
    expect(itemFromDrop([], "[1]", target)).toBeUndefined();
    expect(itemFromDrop([], "null", target)).toBeUndefined();
  });

  it("reads a JSON payload's date strings, and leaves out the fields that would break the layout", () => {
    const target = { start: ORIGIN, end: ORIGIN + DAY, laneId: "b" };
    // JSON has no Date: a dragged item's times arrive as strings.
    const dated = itemFromDrop([], JSON.stringify({ id: "s", start: new Date(ORIGIN), end: new Date(ORIGIN + 3 * DAY) }), target);
    expect(dated).toEqual({ id: "s", label: "New item", start: ORIGIN, end: ORIGIN + 3 * DAY, laneId: "b" });
    const hostile = itemFromDrop(
      [{ id: "a", start: ORIGIN }],
      JSON.stringify({
        id: 7,
        label: "Kept",
        sublaneSpan: 0,
        progress: "half",
        open: "yes",
        granularity: "fortnight",
        kind: "box",
        data: { any: "thing" },
        durationMs: -5,
        start: "not a date",
        end: 9e99,
        laneId: "elsewhere",
        onclick: "alert(1)",
      }),
      target,
    );
    // A number is no id: the item gets a fresh one, as without any.
    expect(hostile).toEqual({ id: "item-2", label: "Kept", kind: "box", data: { any: "thing" }, start: ORIGIN, end: ORIGIN + DAY, laneId: "b" });
    // And what is left lays out.
    expect(() => layoutItems([hostile as Item])).not.toThrow();
    expect(itemFromDrop([], JSON.stringify({ sublaneSpan: 2, progress: 0.5, durationMs: Infinity }), target)).toMatchObject({
      sublaneSpan: 2,
      progress: 0.5,
      end: ORIGIN + DAY,
    });
  });
});
