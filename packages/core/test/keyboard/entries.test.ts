/**
 * G-KEYBOARD for the P19 capabilities, which live in the `/groups` and
 * `/items` entry points rather than in the input machine: collapsing and
 * reordering a group, adding, removing and dropping an item.
 *
 * Each test drives the gesture's path and the key's path to the same pure
 * function and records what each produced, in both orientations, in
 * `.keyboard-parity-entries.json` — the log the G-KEYBOARD check reads next
 * to the machine's own. The browser binding (`createTimeline`) feeds these
 * same functions; `sdk_check_gesture_parity.mjs` checks that statically.
 */

import { writeFileSync } from "node:fs";

import { afterAll, expect, it } from "vitest";

import { densityMetrics } from "../../src/density.js";
import { createHitTester } from "../../src/editing.js";
import { gridKeyStep, resolveGridKey, taskGridRows } from "../../src/gantt/index.js";
import { dropPosition, groupHeaderBoxes, groupKeyStep, groupView, moveGroupCommand, resolveGroupKey } from "../../src/groups/index.js";
import type { Group } from "../../src/groups/index.js";
import {
  addCommand,
  addTargetAt,
  addTargetFromFocus,
  itemForTarget,
  itemFromDrop,
  itemKindHooks,
  removeCommand,
  removeTargets,
  resolveItemKey,
} from "../../src/items/index.js";
import { renderTimeline } from "../../src/render.js";
import { loadLaneId, loadLaneOf, resourceLanes, unscheduledTasks, withLoadLanes } from "../../src/resources/index.js";
import type { BacklogTask } from "../../src/resources/index.js";
import { createNavigator } from "../../src/keyboard.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import { minimapDragDomain, minimapExtent, minimapGeometry, minimapKeyDomain, MINIMAP_STEP } from "../../src/tools/minimap.js";
import { rangeFromDrag, rangeKeyStep, selectRange } from "../../src/tools/range.js";
import { dragTimeBarTime, moveTimeBar, timeBarKeyTime, timeBarPlacements } from "../../src/tools/time-bars.js";
import type { Item, Orientation } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2024, 0, 1);
const DOMAIN = [ORIGIN, ORIGIN + 20 * DAY] as const;
const GROUPS: Group[] = [{ id: "team", label: "Team" }, { id: "ann", parentId: "team", label: "Ann" }, { id: "bob", parentId: "team", label: "Bob" }, { id: "ops", label: "Ops" }];
const ITEMS: Item[] = [
  { id: "a", start: ORIGIN + DAY, end: ORIGIN + 4 * DAY, laneId: "ann", label: "A" },
  { id: "b", start: ORIGIN + 6 * DAY, end: ORIGIN + 9 * DAY, laneId: "bob", label: "B" },
  { id: "c", start: ORIGIN + 2 * DAY, end: ORIGIN + 5 * DAY, laneId: "ops", label: "C" },
];

const log: { capability: string; orientation: Orientation; gesture: unknown; keyboard: unknown; same: boolean }[] = [];

function record(capability: string, orientation: Orientation, gesture: unknown, keyboard: unknown): void {
  const same = JSON.stringify(gesture) === JSON.stringify(keyboard);
  log.push({ capability, orientation, gesture, keyboard, same });
  expect(gesture).toBeDefined();
  expect(keyboard).toBeDefined();
  expect(same).toBe(true);
}

const key = (name: string, altKey = false) => ({ key: name, altKey, shiftKey: false, ctrlKey: false, metaKey: false, time: 0 });

function frame(orientation: Orientation, selectedIds: readonly string[] = []) {
  const view = groupView(GROUPS, ITEMS);
  const result = renderTimeline({
    items: view.items,
    lanes: view.lanes,
    domain: DOMAIN,
    width: 900,
    height: 600,
    orientation,
    selectedIds,
    hooks: itemKindHooks({}, { removable: true }),
  });
  const metrics = densityMetrics(result.viewport.density, orientation);
  const scale = createTimeScale(result.viewport.domain, result.viewport.mainSize);
  const tester = createHitTester({ layout: result.layout, scale, crossInset: metrics.axisSize, minItemMainSize: metrics.minItemMainSize });
  return { view, result, metrics, scale, tester };
}

function findRemove(node: SceneElement): string | undefined {
  const own = node.attrs?.["data-tl-remove"];
  if (typeof own === "string") return own;
  for (const child of node.children ?? []) {
    const hit = findRemove(child);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

describeBothOrientations("P19 keyboard parity", (orientation) => {
  const forward = orientation === "horizontal" ? "ArrowDown" : "ArrowRight";

  it("collapses a group with Enter, as a click on its header does [cap:group.toggle]", () => {
    const { view } = frame(orientation);
    const row = view.rows.find((each) => each.group.id === "team");
    // The header layer's click: toggle to the opposite of what the row shows.
    const clicked = row === undefined ? undefined : { id: row.group.id, collapsed: row.expanded };
    const action = resolveGroupKey(key("Enter"), orientation);
    expect(action).toBe("toggle");
    const pressed = groupKeyStep(GROUPS, view.rows, "team", action ?? "toggle")?.toggle;
    record("group.toggle", orientation, clicked, pressed);
  });

  it("reorders a group with Alt and an arrow, as a drag of its header does [cap:group.reorder]", () => {
    const { view, result } = frame(orientation);
    const boxes = groupHeaderBoxes(view.rows, result.layout);
    const bob = boxes.find((box) => box.row.group.id === "bob");
    expect(bob).toBeDefined();
    const position = dropPosition(boxes, "ann", (bob?.cross ?? 0) + (bob?.crossSize ?? 0));
    const dragged = position === undefined ? undefined : moveGroupCommand(GROUPS, "ann", position);
    const action = resolveGroupKey(key(forward, true), orientation);
    expect(action).toBe("moveLater");
    const pressed = groupKeyStep(GROUPS, view.rows, "ann", action ?? "moveLater")?.command;
    record("group.reorder", orientation, dragged === undefined ? undefined : { before: dragged.before, after: dragged.after }, pressed === undefined ? undefined : { before: pressed.before, after: pressed.after });
  });

  it("adds an item with n, as a double tap on empty lane space does [cap:item.add]", () => {
    const { result, metrics, scale, tester } = frame(orientation);
    const lane = result.layout.lanes.find((each) => each.lane.id === "ops");
    expect(lane).toBeDefined();
    // The middle of the view, in the middle of the ops row: where the keyboard adds.
    const point = { main: scale.mainSize / 2, cross: metrics.axisSize + (lane?.cross ?? 0) + (lane?.crossSize ?? 0) / 2 };
    expect(tester.hitTest(point)).toBeUndefined();
    const tapped = addCommand(ITEMS, itemForTarget(ITEMS, addTargetAt(point, scale, tester.laneAt)) as Item);
    expect(resolveItemKey(key("n"))).toBe("add");
    const pressed = addCommand(ITEMS, itemForTarget(ITEMS, addTargetFromFocus(DOMAIN, "ops")) as Item);
    record("item.add", orientation, tapped?.after, pressed?.after);
  });

  it("removes the focused item with Delete, as a tap on its remove handle does [cap:item.remove]", () => {
    const { result } = frame(orientation, ["b"]);
    const handle = findRemove(result.scene);
    expect(handle).toBe("b");
    const tapped = handle === undefined ? undefined : removeCommand(ITEMS, removeTargets(handle, ["b"], { multiSelect: false }));
    expect(resolveItemKey(key("Delete"))).toBe("remove");
    const pressed = removeCommand(ITEMS, removeTargets("b", ["b"], { multiSelect: false }));
    record("item.remove", orientation, tapped?.after, pressed?.after);
  });

  it("adds an external item with dropItem, as a drop at the same place does [cap:item.drop]", () => {
    const { result, metrics, scale, tester } = frame(orientation);
    const lane = result.layout.lanes.find((each) => each.lane.id === "ann");
    const point = { main: scale.mainSize / 2, cross: metrics.axisSize + (lane?.cross ?? 0) + (lane?.crossSize ?? 0) / 2 };
    const payload = JSON.stringify({ id: "ext", label: "External", durationMs: 2 * DAY });
    const dropped = itemFromDrop(ITEMS, payload, addTargetAt(point, scale, tester.laneAt));
    const keyed = itemFromDrop(ITEMS, payload, addTargetFromFocus(DOMAIN, "ann"));
    record("item.drop", orientation, dropped === undefined ? undefined : addCommand(ITEMS, dropped)?.after, keyed === undefined ? undefined : addCommand(ITEMS, keyed)?.after);
  });
});

describeBothOrientations("P20 keyboard parity", (orientation) => {
  const forward = orientation === "horizontal" ? "ArrowDown" : "ArrowRight";

  it("opens a task-grid row with Enter, as a click on the row does [cap:grid.open]", () => {
    const { result, metrics } = frame(orientation);
    const crossSize = orientation === "horizontal" ? 600 : 900;
    const window = taskGridRows(result.layout, { crossInset: metrics.axisSize, crossOffset: 0, crossSize });
    // The click: the row under a point in the middle of the ops lane.
    const lane = result.layout.lanes.find((each) => each.lane.id === "ops");
    const y = metrics.axisSize + (lane?.cross ?? 0) + (lane?.crossSize ?? 0) / 2;
    const clicked = window.rows.find((row) => row.cross <= y && y < row.cross + row.crossSize);
    // The keys: from the first row, the arrow along the rows until that row, then Enter.
    let at = 0;
    const target = result.layout.lanes.findIndex((each) => each.lane.id === "ops");
    for (let step = 0; step < 20 && at !== target; step += 1) {
      const action = resolveGridKey(key(forward), orientation);
      expect(action).toBe("next");
      at = gridKeyStep(window.total, at, action ?? "next") ?? at;
    }
    expect(resolveGridKey(key("Enter"), orientation)).toBe("open");
    const pressed = window.rows.find((row) => row.index - 2 === at);
    // Both open the same row: the timeline's focus goes to its first item.
    record("grid.open", orientation, clicked?.items[0]?.item.id, pressed?.items[0]?.item.id);
  });
});

describeBothOrientations("P22 keyboard parity", (orientation) => {
  it("places an unscheduled task with Enter, as letting it go over its resource's row does [cap:backlog.place]", () => {
    // A resource view: each person's row, and under it the row of their load.
    const resources = [{ id: "ann", label: "Ann" }, { id: "bob", label: "Bob" }, { id: "ops", label: "Ops" }];
    const result = renderTimeline({ items: ITEMS, lanes: withLoadLanes(resourceLanes(resources), resources), domain: DOMAIN, width: 900, height: 600, orientation });
    const metrics = densityMetrics(result.viewport.density, orientation);
    const scale = createTimeScale(result.viewport.domain, result.viewport.mainSize);
    const tester = createHitTester({ layout: result.layout, scale, crossInset: metrics.axisSize, minItemMainSize: metrics.minItemMainSize });
    // The element's lane under a point: a load lane is its resource's.
    const laneAt = (cross: number): string | undefined => {
      const id = tester.laneAt(cross);
      return id === undefined ? undefined : (loadLaneOf(id) ?? id);
    };
    const tasks: BacklogTask[] = [{ id: "review", label: "Review", durationMs: 3 * DAY, className: "from-backlog" }];
    const payload = JSON.stringify(tasks[0]);
    // The gesture: the row is let go over Bob's load, in the middle of the view.
    const lane = result.layout.lanes.find((each) => each.lane.id === loadLaneId("bob"));
    const point = { main: scale.mainSize / 2, cross: metrics.axisSize + (lane?.cross ?? 0) + (lane?.crossSize ?? 0) / 2 };
    const dropped = itemFromDrop(ITEMS, payload, addTargetAt(point, scale, laneAt));
    // The key: Enter on the row, with Bob's work focused.
    const keyed = itemFromDrop(ITEMS, payload, addTargetFromFocus(DOMAIN, "bob"));
    const byGesture = dropped === undefined ? undefined : addCommand(ITEMS, dropped);
    const byKey = keyed === undefined ? undefined : addCommand(ITEMS, keyed);
    expect(byKey?.after[0]?.item).toMatchObject({ id: "review", laneId: "bob", end: Number(byKey?.after[0]?.item?.start) + 3 * DAY });
    // Placed, the task is off the list.
    expect(unscheduledTasks(tasks, [...ITEMS, byKey?.after[0]?.item as Item])).toEqual([]);
    record("backlog.place", orientation, byGesture?.after, byKey?.after);
  });
});

describeBothOrientations("P24 keyboard parity", (orientation) => {
  const HOUR = 3_600_000;
  const view = { mainSize: 900, scale: createTimeScale(DOMAIN, 900) };

  it("moves a time bar with an arrow, as a drag of the same distance does [cap:timebar.move]", () => {
    const bars = [{ id: "cut", time: ORIGIN + 5 * DAY }];
    const step = 6 * HOUR;
    const at = timeBarPlacements(bars, view.scale)[0];
    const grab = { time: at?.time ?? 0, main: at?.main ?? 0 };
    // The gesture: a drag of three steps' worth of pixels. The key: three arrows.
    const dragged = moveTimeBar(bars, "cut", dragTimeBarTime(grab, grab.main + (3 * step) / view.scale.msPerPx, view.scale), { snapMs: HOUR });
    let time = at?.time ?? 0;
    for (let k = 0; k < 3; k += 1) time = timeBarKeyTime(time, "later", { stepMs: step, domain: DOMAIN });
    const keyed = moveTimeBar(bars, "cut", time, { snapMs: HOUR });
    record("timebar.move", orientation, dragged?.moved, keyed?.moved);
  });

  it("moves the overview strip's window with an arrow, as a drag of it does [cap:minimap.move]", () => {
    const layout = frame(orientation).result.layout;
    const geometry = minimapGeometry(minimapExtent(layout, DOMAIN), DOMAIN, view.mainSize);
    // The gesture: the window dragged by what a tenth of the view is on the strip.
    const delta = (view.mainSize * MINIMAP_STEP * view.scale.msPerPx) / geometry.scale.msPerPx;
    const grab = geometry.window.main + geometry.window.mainSize / 2;
    const dragged = minimapDragDomain(DOMAIN, grab, grab + delta, geometry);
    const keyed = minimapKeyDomain(DOMAIN, "later", geometry);
    // To the millisecond: the strip's pixels are fractional.
    record("minimap.move", orientation, dragged.map(Math.round), keyed.map(Math.round));
  });

  it("selects a range with r, arrows and Enter, as a drag along the axis band does [cap:range.select]", () => {
    const options = { domain: DOMAIN, stepMs: 6 * HOUR, snapMs: HOUR };
    let draft = rangeKeyStep(undefined, "start", options);
    for (let k = 0; k < 4; k += 1) draft = rangeKeyStep(draft, "later", options);
    const keyed = selectRange(draft.anchor, draft.head, options);
    const dragged = rangeFromDrag(view.scale, view.scale.toMain(draft.anchor), view.scale.toMain(draft.head), options);
    record("range.select", orientation, dragged, keyed);
  });

  it("shows an item's tooltip on keyboard focus for every item a pointer hovers [cap:item.tooltip]", () => {
    const { result, metrics, tester } = frame(orientation);
    // The pointer: every item's middle. The keyboard: every stop of the walk.
    const hovered = result.layout.items
      .map((placed) => {
        const rect = createTimeScale(DOMAIN, result.viewport.mainSize);
        const main = (rect.toMain(placed.span.start) + rect.toMain(placed.span.end)) / 2;
        return tester.hitTest({ main, cross: metrics.axisSize + placed.cross + placed.crossSize / 2 })?.item.id;
      })
      .sort();
    const focused = createNavigator(result.layout, { crossInset: metrics.axisSize }).entries.map((entry) => entry.id).sort();
    record("item.tooltip", orientation, hovered, focused);
  });
});

afterAll(() => {
  writeFileSync(new URL("../../.keyboard-parity-entries.json", import.meta.url), `${JSON.stringify(log, null, 1)}\n`);
});
