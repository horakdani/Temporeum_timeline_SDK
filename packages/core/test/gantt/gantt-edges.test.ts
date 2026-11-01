/**
 * The Gantt entry point's less travelled paths: arrows grouped a path per
 * look, routes and layers at their edges, names and keys in their rarer
 * cases.
 */

import { describe, expect, it } from "vitest";

import {
  dependencyLinks,
  dependencyNodes,
  dependencyPaths,
  describeBaseline,
  describeTask,
  ganttHooks,
  gridKeyStep,
  resolveGridKey,
  routeDependencies,
  routePath,
  taskBox,
  taskGridRows,
  withDependencyLayer,
} from "../../src/gantt/index.js";
import type { Dependency } from "../../src/gantt/index.js";
import { layoutItems } from "../../src/layout.js";
import type { LayoutItem } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2025, 0, 1);

const items: Item[] = [
  { id: "a", start: ORIGIN, end: ORIGIN + 2 * DAY, label: "Alpha", laneId: "x" },
  { id: "b", start: ORIGIN + 3 * DAY, end: ORIGIN + 5 * DAY, label: "Beta", laneId: "y" },
  { id: "c", start: ORIGIN + 6 * DAY, end: ORIGIN + 8 * DAY, laneId: "z" },
];
const lanes = [{ id: "x" }, { id: "y" }, { id: "z" }];
const scale = createTimeScale([ORIGIN - DAY, ORIGIN + 10 * DAY], 1100);

function find(node: SceneElement, test: (node: SceneElement) => boolean): SceneElement | undefined {
  if (test(node)) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, test);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

describe("arrows as a path per look", () => {
  const layout = layoutItems(items, { lanes });
  const dependencies: Dependency[] = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "a", to: "c", type: "SS", className: "critical" },
  ];
  const routes = routeDependencies(layout, dependencies, { scale });

  it("puts arrows that look the same in one path, naming each, the selected ones last", () => {
    const paths = dependencyPaths(routes, "horizontal", { selectedIds: new Set(["c"]) });
    const ids = paths.map((path) => String(path.attrs?.["data-tl-dep"]).split(" "));
    expect(ids.flat().sort()).toEqual(routes.map((route) => route.id).sort());
    expect(paths.map((path) => path.attrs?.class)).toEqual(["tl-dep tl-dep--fs", "tl-dep tl-dep--fs tl-dep--selected", "tl-dep tl-dep--ss tl-dep--selected critical"]);
    // The selected are drawn last, over the rest, and stronger.
    expect(String(paths[0]?.attrs?.style)).toContain("--tl-line-strong");
    expect(String(paths[2]?.attrs?.style)).toContain("--tl-focus");
  });

  it("draws the same lines a path each would, from a cache when given one", () => {
    const [one] = dependencyPaths(routes.slice(0, 2), "vertical");
    const each = dependencyNodes(routes.slice(0, 2), "vertical");
    expect(one?.attrs?.d).toBe(each.map((node) => node.attrs?.d).join(" "));
    const cached = dependencyPaths(routes.slice(0, 1), "horizontal", {}, () => "M0 0 L1 1");
    expect(cached[0]?.attrs?.d).toBe("M0 0 L1 1");
    expect(dependencyPaths([], "horizontal")).toEqual([]);
  });
});

describe("routes and layers at their edges", () => {
  it("boxes an open task to the scale's end", () => {
    const placed = layoutItems([{ id: "o", start: ORIGIN }], {}).items[0] as LayoutItem;
    const span = { ...placed, span: { ...placed.span, open: true } } as LayoutItem;
    const box = taskBox(span, { scale });
    expect(box.main + box.mainSize).toBeCloseTo(scale.toMain(scale.domain[1]), 6);
  });

  it("rejects across before routing, with no inset or offset given", () => {
    const layout = layoutItems(items, { lanes });
    const kept = routeDependencies(layout, [{ from: "a", to: "b" }, { from: "b", to: "c" }], {
      scale,
      clip: { main: [-1e6, 1e6], cross: [-10, 20] },
    });
    expect(kept.map((route) => route.dependency.to)).toEqual(["b"]);
  });

  it("draws a lone point as a move, with no head", () => {
    expect(routePath([{ main: 1, cross: 2 }], "horizontal")).toBe("M1 2");
    expect(routePath([], "vertical")).toBe("");
  });

  it("leaves a frame with no item layer as it was, and marks the arrows hidden only in an interactive one", () => {
    const bare: SceneElement = { tag: "svg" };
    expect(withDependencyLayer(bare, [])).toBe(bare);
    const plain: SceneElement = { tag: "svg", children: [{ tag: "g", attrs: { class: "tl-layer tl-layer--items", transform: "translate(1 2)" } }] };
    const layer = withDependencyLayer(plain, []).children?.[0];
    expect(layer?.attrs?.transform).toBe("translate(1 2)");
    expect(layer?.attrs?.["aria-hidden"]).toBeUndefined();
  });

  it("skips an arrow from an item to itself in the links", () => {
    const links = dependencyLinks([{ from: "a", to: "a" }, { from: "a", to: "b" }]);
    expect(links.successors.get("a")?.length).toBe(1);
    expect(links.predecessors.has("a")).toBe(false);
  });
});

describe("names and drawing in their rarer cases", () => {
  it("reads a plan with no end against a task with no end", () => {
    expect(describeBaseline({ id: "m", start: ORIGIN + DAY, baseline: { start: ORIGIN } })).toBe("1 d behind plan");
  });

  it("names a task by the hooks' own name, and its links by id where an item has no label", () => {
    const layout = layoutItems(items, { lanes });
    const placed = layout.items.find((each) => each.item.id === "c") as LayoutItem;
    const name = describeTask(placed, { dependencies: [{ from: "b", to: "c" }, { from: "c", to: "zz" }], items }, () => "Own");
    expect(name).toBe("Own, after Beta (finish-to-start); before zz (finish-to-start)");
    expect(describeTask(placed, { dependencies: [] }, () => "Own")).toBe("Own");
  });

  it("draws a selected milestone with its class, and a task whose fill is out of view or nothing as its plain node", () => {
    const shown: Item[] = [
      { id: "m", start: ORIGIN + DAY, kind: "milestone", className: "gate", laneId: "x" },
      { id: "zero", start: ORIGIN, end: ORIGIN + 2 * DAY, progress: 0, laneId: "y" },
      { id: "late", start: ORIGIN - 20 * DAY, end: ORIGIN - 10 * DAY + 1, progress: 0.1, laneId: "z" },
      { id: "plan", start: ORIGIN + 2 * DAY, end: ORIGIN + 4 * DAY, baseline: { start: ORIGIN + 2 * DAY }, laneId: "x" },
    ];
    const frame = renderTimeline({
      items: shown,
      lanes,
      domain: [ORIGIN - DAY, ORIGIN + 10 * DAY],
      width: 1000,
      height: 300,
      selectedIds: ["m"],
      hooks: ganttHooks({}, { items: shown }),
    });
    const milestone = find(frame.scene, (node) => node.attrs?.["data-tl-id"] === "m");
    expect(String(milestone?.attrs?.class)).toContain("tl-item--selected");
    expect(String(milestone?.attrs?.class)).toContain("gate");
    expect(find(frame.scene, (node) => node.attrs?.["data-tl-id"] === "zero")?.tag).toBe("rect");
    // A plan with no end is an instant: a sliver at the start.
    const plan = find(frame.scene, (node) => node.attrs?.["data-tl-id"] === "plan");
    expect(plan?.tag).toBe("g");
    expect(find(plan as SceneElement, (node) => node.attrs?.class === "tl-baseline")).toBeDefined();
  });

  it("keeps a node the base hooks drew without an id, and draws nothing where they drew nothing", () => {
    const shown: Item[] = [
      { id: "p", start: ORIGIN, end: ORIGIN + 4 * DAY, progress: 0.5, laneId: "x" },
      { id: "q", start: ORIGIN, end: ORIGIN + 4 * DAY, progress: 0.5, laneId: "y" },
    ];
    const frame = renderTimeline({
      items: shown,
      lanes,
      domain: [ORIGIN - DAY, ORIGIN + 10 * DAY],
      width: 1000,
      height: 300,
      hooks: ganttHooks(
        { renderItem: (context) => (context.placed.item.id === "q" ? null : { tag: "rect", attrs: { class: "own" } }) },
        { items: shown },
      ),
    });
    const group = find(frame.scene, (node) => node.attrs?.["data-tl-id"] === "p");
    expect(group?.children?.[0]?.attrs?.class).toBe("own");
    expect(find(frame.scene, (node) => node.attrs?.["data-tl-id"] === "q")).toBeUndefined();
  });
});

describe("the grid's rarer keys and rows", () => {
  const sample = { key: "Home", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: 0 };

  it("reads Home, End and the page keys, and lets the rest through", () => {
    expect(resolveGridKey(sample, "horizontal")).toBe("first");
    expect(resolveGridKey({ ...sample, key: "End" }, "vertical")).toBe("last");
    expect(resolveGridKey({ ...sample, key: "PageDown" }, "horizontal")).toBe("pageDown");
    expect(resolveGridKey({ ...sample, key: "PageUp" }, "horizontal")).toBe("pageUp");
    expect(resolveGridKey({ ...sample, key: " " }, "horizontal")).toBe("open");
    expect(resolveGridKey({ ...sample, key: "x" }, "horizontal")).toBeUndefined();
    expect(gridKeyStep(100, 50, "pageUp", 10)).toBe(40);
    expect(gridKeyStep(100, 3, "pageUp", 10)).toBe(0);
  });

  it("leaves out the lanes it is told to skip", () => {
    const layout = layoutItems(items, { lanes });
    const window = taskGridRows(layout, { crossInset: 0, crossOffset: 0, crossSize: 1e6, skip: (lane) => lane.lane.id === "y" });
    expect(window.rows.map((row) => row.lane.lane.id)).toEqual(["x", "z"]);
    expect(window.total).toBe(2);
  });
});
