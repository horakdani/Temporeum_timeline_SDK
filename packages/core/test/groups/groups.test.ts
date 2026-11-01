/**
 * G-GROUPS: nested groups, generated trees, both orientations.
 *
 * Three claims, each on generated group trees with items spread over them:
 *
 *  - a collapsed group's descendants — their items and their groups — are
 *    neither in the layout nor in the accessibility tree (no option for any
 *    of their items in the rendered scene);
 *  - expanding gives back the very layout there was before collapsing;
 *  - a reorder is a command whose inverse restores the exact group list, and
 *    the keyboard's step and a drag to the same place are the same command.
 */

import { describe, expect, it } from "vitest";

import {
  applyGroupPatches,
  dropPosition,
  GROUP_HEADER_PREFIX,
  groupHeaderBoxes,
  groupHeaderLane,
  groupKeyStep,
  groupView,
  headerGroupId,
  isGroupCommand,
  moveGroupCommand,
  resolveGroupKey,
} from "../../src/groups/index.js";
import type { Group, GroupRow } from "../../src/groups/index.js";
import { layoutItems } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { describeBothOrientations } from "../orientation.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2024, 0, 1);
const SEED = Number(process.env.SDK_GROUPS_SEED ?? 1919);
const CASES = 120;

/** A random tree: each group's parent is an earlier group, or none. */
function generateTree(random: () => number): { groups: Group[]; items: Item[] } {
  const count = 1 + Math.floor(random() * 9);
  const groups: Group[] = [];
  for (let index = 0; index < count; index += 1) {
    const parent = index > 0 && random() < 0.6 ? groups[Math.floor(random() * index)] : undefined;
    groups.push({
      id: `g${String(index)}`,
      label: `Group ${String(index)}`,
      ...(parent === undefined ? {} : { parentId: parent.id }),
    });
  }
  // Shuffle so a child may come before its parent in the array.
  for (let index = groups.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [groups[index], groups[other]] = [groups[other] as Group, groups[index] as Group];
  }
  const items: Item[] = [];
  const itemCount = Math.floor(random() * 30);
  for (let index = 0; index < itemCount; index += 1) {
    const group = groups[Math.floor(random() * groups.length)] as Group;
    const start = ORIGIN + Math.floor(random() * 60) * DAY;
    items.push({
      id: `i${String(index)}`,
      start,
      end: start + (1 + Math.floor(random() * 10)) * DAY,
      label: `Item ${String(index)}`,
      ...(random() < 0.1 ? {} : { laneId: group.id }),
    });
  }
  return { groups, items };
}

function descendantsOf(groups: readonly Group[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (parent: string): void => {
    for (const group of groups) {
      if (group.parentId === parent && !out.has(group.id)) {
        out.add(group.id);
        walk(group.id);
      }
    }
  };
  walk(id);
  return out;
}

function optionIds(node: SceneElement, into: string[] = []): string[] {
  if (node.attrs?.role === "option" && typeof node.attrs["data-tl-id"] === "string") {
    into.push(node.attrs["data-tl-id"]);
  }
  for (const child of node.children ?? []) optionIds(child, into);
  return into;
}

function cases(): { groups: Group[]; items: Item[]; collapse: string }[] {
  const random = makeRandom(SEED);
  const out = [];
  for (let index = 0; index < CASES; index += 1) {
    const tree = generateTree(random);
    out.push({ ...tree, collapse: (tree.groups[Math.floor(random() * tree.groups.length)] as Group).id });
  }
  return out;
}

// The seed is printed so a failure can be replayed (SDK_GROUPS_SEED).
// eslint-disable-next-line no-console
console.log(`[groups] seed=${String(SEED)} cases=${String(CASES)}`);

describeBothOrientations("group tree", (orientation) => {
  it("[claim:collapsed-hidden] a collapsed group's descendants are in neither the layout nor the accessibility tree", () => {
    for (const { groups, items, collapse } of cases()) {
      const view = groupView(groups, items, { collapsed: [collapse] });
      const hiddenGroups = descendantsOf(groups, collapse);
      const hiddenLanes = new Set([collapse, ...hiddenGroups]);
      const layout = layoutItems(view.items, { lanes: view.lanes });
      for (const placed of layout.items) {
        expect(hiddenLanes.has(placed.item.laneId ?? "")).toBe(false);
      }
      for (const lane of layout.lanes) {
        expect(hiddenGroups.has(lane.lane.id)).toBe(false);
        expect(hiddenGroups.has(headerGroupId(lane.lane.id) ?? "")).toBe(false);
      }
      for (const row of view.rows) expect(hiddenGroups.has(row.group.id)).toBe(false);
      expect([...view.hidden].sort()).toEqual([...hiddenGroups].sort());
      const scene = renderTimeline({
        items: view.items,
        lanes: view.lanes,
        domain: [ORIGIN - DAY, ORIGIN + 80 * DAY],
        width: 800,
        height: 600,
        orientation,
      }).scene;
      const shown = new Set(optionIds(scene));
      for (const item of items) {
        if (hiddenLanes.has(item.laneId ?? "\u0001")) expect(shown.has(item.id)).toBe(false);
      }
    }
  });

  it("[claim:expand-restores] expanding gives back the very layout there was before collapsing", () => {
    for (const { groups, items, collapse } of cases()) {
      const before = groupView(groups, items, { collapsed: [] });
      const collapsed = groupView(groups, items, { collapsed: [collapse] });
      const after = groupView(groups, items, { collapsed: [] });
      expect(collapsed.lanes.length).toBeLessThanOrEqual(before.lanes.length);
      expect(layoutItems(after.items, { lanes: after.lanes })).toEqual(layoutItems(before.items, { lanes: before.lanes }));
      // And the scene too, in this orientation.
      const frame = (view: typeof before): unknown =>
        renderTimeline({ items: view.items, lanes: view.lanes, domain: [ORIGIN, ORIGIN + 70 * DAY], width: 640, height: 480, orientation }).scene;
      expect(frame(after)).toEqual(frame(before));
    }
  });

  it("[claim:reorder-inverse] a reorder is a command whose inverse restores the exact group list", () => {
    const random = makeRandom(SEED + 1);
    let checked = 0;
    for (const { groups } of cases()) {
      const group = groups[Math.floor(random() * groups.length)] as Group;
      const row = groupView(groups, []).rows.find((each) => each.group.id === group.id) as GroupRow;
      for (let position = 0; position < row.siblings; position += 1) {
        const command = moveGroupCommand(groups, group.id, position);
        if (position === row.position - 1) {
          expect(command).toBeUndefined();
          continue;
        }
        expect(command).toBeDefined();
        if (command === undefined) continue;
        expect(isGroupCommand(command)).toBe(true);
        const moved = applyGroupPatches(groups, command.after);
        const movedRow = groupView(moved, []).rows.find((each) => each.group.id === group.id) as GroupRow;
        expect(movedRow.position - 1).toBe(position);
        const restored = applyGroupPatches(moved, command.inverse.after);
        expect(restored).toEqual(groups);
        restored.forEach((each, index) => expect(each).toBe(groups[index]));
        expect(command.inverse.inverse).toBe(command);
        expect(JSON.parse(JSON.stringify(command))).toEqual({ type: "moveGroup", before: command.before, after: command.after });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("[claim:drag-equals-key] a drag one place along and the keyboard's step are the same command", () => {
    let checked = 0;
    for (const { groups, items } of cases()) {
      const view = groupView(groups, items);
      const layout = layoutItems(view.items, { lanes: view.lanes });
      const boxes = groupHeaderBoxes(view.rows, layout);
      for (const row of view.rows) {
        if (row.position >= row.siblings) continue;
        const next = boxes.find((box) => box.row.parentId === row.parentId && box.row.position === row.position + 1);
        if (next === undefined) continue;
        // Past the middle of the next sibling's header: one place later.
        const position = dropPosition(boxes, row.group.id, next.cross + next.crossSize * 0.75) as number;
        const dragged = moveGroupCommand(groups, row.group.id, position);
        const step = groupKeyStep(groups, view.rows, row.group.id, "moveLater");
        expect(step?.command).toBeDefined();
        expect(dragged).toEqual(step?.command);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("group keys", () => {
  const sample = (key: string, altKey = false) => ({ key, altKey, shiftKey: false, ctrlKey: false, metaKey: false, time: 0 });

  it("walks and opens along the axes, in both orientations", () => {
    expect(resolveGroupKey(sample("ArrowDown"), "horizontal")).toBe("next");
    expect(resolveGroupKey(sample("ArrowUp"), "horizontal")).toBe("previous");
    expect(resolveGroupKey(sample("ArrowRight"), "horizontal")).toBe("expand");
    expect(resolveGroupKey(sample("ArrowLeft"), "horizontal")).toBe("collapse");
    expect(resolveGroupKey(sample("ArrowRight"), "vertical")).toBe("next");
    expect(resolveGroupKey(sample("ArrowDown"), "vertical")).toBe("expand");
    expect(resolveGroupKey(sample("ArrowUp"), "vertical")).toBe("collapse");
    expect(resolveGroupKey(sample("ArrowLeft"), "vertical")).toBe("previous");
    expect(resolveGroupKey(sample("ArrowDown", true), "horizontal")).toBe("moveLater");
    expect(resolveGroupKey(sample("ArrowUp", true), "horizontal")).toBe("moveEarlier");
    expect(resolveGroupKey(sample("ArrowRight", true), "horizontal")).toBeUndefined();
    expect(resolveGroupKey(sample("Home"), "horizontal")).toBe("first");
    expect(resolveGroupKey(sample("End"), "vertical")).toBe("last");
    expect(resolveGroupKey(sample("Enter"), "horizontal")).toBe("toggle");
    expect(resolveGroupKey(sample(" "), "horizontal")).toBe("toggle");
    expect(resolveGroupKey(sample("x"), "horizontal")).toBeUndefined();
    expect(resolveGroupKey({ ...sample("ArrowDown"), ctrlKey: true }, "horizontal")).toBeUndefined();
  });

  it("follows the tree pattern: open, step in, close, step out", () => {
    const groups: Group[] = [{ id: "a" }, { id: "b", parentId: "a" }, { id: "c" }];
    const open = groupView(groups, []);
    expect(groupKeyStep(groups, open.rows, undefined, "next")).toEqual({ focus: "a" });
    expect(groupKeyStep(groups, open.rows, "a", "next")).toEqual({ focus: "b" });
    expect(groupKeyStep(groups, open.rows, "c", "next")).toEqual({});
    expect(groupKeyStep(groups, open.rows, "b", "previous")).toEqual({ focus: "a" });
    expect(groupKeyStep(groups, open.rows, "b", "first")).toEqual({ focus: "a" });
    expect(groupKeyStep(groups, open.rows, "a", "last")).toEqual({ focus: "c" });
    expect(groupKeyStep(groups, open.rows, "a", "expand")).toEqual({ focus: "b" });
    expect(groupKeyStep(groups, open.rows, "c", "expand")).toEqual({});
    expect(groupKeyStep(groups, open.rows, "a", "collapse")).toEqual({ toggle: { id: "a", collapsed: true } });
    expect(groupKeyStep(groups, open.rows, "a", "toggle")).toEqual({ toggle: { id: "a", collapsed: true } });
    const shut = groupView(groups, [], { collapsed: ["a", "b"] });
    expect(shut.rows.map((row) => row.group.id)).toEqual(["a", "c"]);
    expect(groupKeyStep(groups, shut.rows, "a", "expand")).toEqual({ toggle: { id: "a", collapsed: false } });
    expect(groupKeyStep(groups, shut.rows, "a", "collapse")).toEqual({});
    const inner = groupView(groups, [], { collapsed: ["b"] });
    expect(groupKeyStep(groups, inner.rows, "b", "collapse")).toEqual({ focus: "a" });
    expect(groupKeyStep(groups, open.rows, "a", "moveEarlier")).toEqual({});
    expect(groupKeyStep(groups, open.rows, "a", "moveLater")?.command?.after).toEqual([{ id: "a", index: 2 }]);
    expect(groupKeyStep(groups, [], "a", "next")).toBeUndefined();
  });
});

describe("group view", () => {
  it("gives every group a header lane and its own items a content lane", () => {
    const groups: Group[] = [{ id: "team", label: "Team" }, { id: "ann", parentId: "team", label: "Ann", packMode: "single" }];
    const items: Item[] = [{ id: "x", start: ORIGIN, laneId: "ann" }, { id: "y", start: ORIGIN }];
    const view = groupView(groups, items);
    expect(view.lanes.map((lane) => lane.id)).toEqual([groupHeaderLane("team"), groupHeaderLane("ann"), "ann", ""]);
    expect(view.lanes[2]).toEqual({ id: "ann", label: "Ann", packMode: "single" });
    expect(view.rows.map((row) => [row.group.id, row.depth, row.laneId, row.hasChildren])).toEqual([
      ["team", 0, undefined, true],
      ["ann", 1, "ann", false],
    ]);
    expect(groupHeaderLane("a").startsWith(GROUP_HEADER_PREFIX)).toBe(true);
    expect(headerGroupId(groupHeaderLane("a"))).toBe("a");
    expect(headerGroupId("a")).toBeUndefined();
  });

  it("reads Group.collapsed when no state is given", () => {
    const view = groupView([{ id: "a", collapsed: true }, { id: "b", parentId: "a" }], [{ id: "x", start: ORIGIN, laneId: "b" }]);
    expect(view.rows.map((row) => row.group.id)).toEqual(["a"]);
    expect(view.items).toEqual([]);
  });

  it("treats unknown and circular parents as roots, and refuses duplicate ids", () => {
    const view = groupView([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }, { id: "c", parentId: "zzz" }], []);
    expect(view.rows.map((row) => [row.group.id, row.depth])).toEqual([["a", 0], ["b", 0], ["c", 0]]);
    expect(() => groupView([{ id: "a" }, { id: "a" }], [])).toThrow(RangeError);
  });

  it("leaves an unknown id, an out-of-range position and an unknown patch alone", () => {
    const groups: Group[] = [{ id: "a" }, { id: "b" }];
    expect(moveGroupCommand(groups, "zzz", 0)).toBeUndefined();
    expect(moveGroupCommand(groups, "a", 5)).toBeUndefined();
    expect(moveGroupCommand(groups, "a", 0.5)).toBeUndefined();
    expect(applyGroupPatches(groups, [{ id: "zzz", index: 0 }])).toEqual(groups);
    expect(dropPosition([], "a", 0)).toBeUndefined();
    expect(isGroupCommand({ type: "move" })).toBe(false);
  });
});
