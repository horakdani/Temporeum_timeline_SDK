/**
 * The resource view's less travelled paths: a vertical drawing, a frame
 * with nothing to draw into, the names and marks of odd assignments.
 */

import { describe, expect, it } from "vitest";

import { standaloneSvg } from "../../src/export/svg.js";
import { layoutItems } from "../../src/layout.js";
import type { LayoutItem } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import type { ItemRenderContext } from "../../src/render.js";
import {
  describeOverload,
  loadLaneId,
  loadLaneOf,
  loadNodes,
  LOAD_LAYER,
  peakLoad,
  resourceHooks,
  resourceLanes,
  overloads,
  resourceLoad,
  unscheduledTasks,
  withLoadLanes,
  withLoadLayer,
} from "../../src/resources/index.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";
import { BASE, DAY, HOUR } from "./fixture.js";

const resources = [{ id: "a", label: "Ana" }, { id: "b", capacity: 0 }];
const items: Item[] = [
  { id: "x", start: BASE, end: BASE + 4 * HOUR, laneId: "a" },
  { id: "y", start: BASE + 2 * HOUR, end: BASE + 6 * HOUR, laneId: "a" },
  { id: "z", start: BASE, end: BASE + HOUR, laneId: "b" },
  { id: "w", start: BASE, end: BASE + HOUR, laneId: "nobody" },
];

describe("the load lanes and their drawing", () => {
  it("puts a load lane after each resource's lane only, named after it", () => {
    const lanes = withLoadLanes([...resourceLanes(resources), { id: "other" }], resources);
    expect(lanes.map((lane) => lane.id)).toEqual(["a", loadLaneId("a"), "b", loadLaneId("b"), "other"]);
    expect(lanes[1]).toEqual({ id: loadLaneId("a"), label: "Ana load", packMode: "single", minCrossSize: 24 });
    expect(lanes[3]?.label).toBe("b load");
    expect(resourceLanes(resources)).toEqual([{ id: "a", label: "Ana" }, { id: "b" }]);
  });

  it("draws across a vertical timeline, and within a clip", () => {
    const load = resourceLoad(items, resources);
    const layout = layoutItems(items, { lanes: withLoadLanes(resourceLanes(resources), resources) });
    const scale = createTimeScale([BASE - HOUR, BASE + 7 * HOUR], 800);
    const vertical = loadNodes(layout, load, { scale, orientation: "vertical", crossInset: 30, crossOffset: 0 });
    expect(vertical.map((node) => node.attrs?.class)).toEqual(["tl-overload", "tl-load", "tl-load tl-load--over", "tl-capacity"]);
    // Vertical: the capacity runs along y.
    expect(String(vertical.find((node) => node.attrs?.class === "tl-capacity")?.attrs?.d)).toMatch(/^M[\d.]+ 0V800/);
    // A clip across that holds no lane draws nothing.
    expect(loadNodes(layout, load, { scale, orientation: "horizontal", clip: { main: [0, 800], cross: [-500, -400] } })).toEqual([]);
    // A clip along time before any work draws only the capacity lines.
    const early = loadNodes(layout, load, { scale, orientation: "horizontal", clip: { main: [0, 50], cross: [0, 1000] } });
    expect(early.map((node) => node.attrs?.class)).toEqual(["tl-capacity"]);
  });

  it("goes before the item layer with its transform, and leaves a frame without one alone", () => {
    const scene: SceneElement = {
      tag: "svg",
      children: [
        { tag: "g", attrs: { class: "tl-layer tl-layer--lanes" } },
        { tag: "g", attrs: { class: "tl-layer tl-layer--items", transform: "translate(5 0)" } },
      ],
    };
    const nodes: SceneElement[] = [{ tag: "path", attrs: { d: "M0 0" } }];
    const out = withLoadLayer(scene, nodes);
    expect(out.children?.[1]).toEqual({ tag: "g", attrs: { class: `tl-layer ${LOAD_LAYER}`, transform: "translate(5 0)", "aria-hidden": "true" }, children: nodes });
    const empty: SceneElement = { tag: "svg", children: [] };
    expect(withLoadLayer(empty, nodes)).toBe(empty);
    expect(withLoadLayer({ tag: "svg" }, nodes)).toEqual({ tag: "svg" });
  });
});

/** The characters XML 1.0 does not allow anywhere in a document. */
// eslint-disable-next-line no-control-regex -- these are the characters it is about
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|\p{Cs}/u;

describe("the load lanes in an exported file", () => {
  it("are named in XML characters, so a frame with them is a well-formed SVG document", () => {
    expect(loadLaneId("a")).not.toMatch(NOT_XML);
    expect(loadLaneOf(loadLaneId("a"))).toBe("a");
    expect(loadLaneOf("a")).toBeUndefined();
    const load = resourceLoad(items, resources);
    const frame = renderTimeline({
      items,
      lanes: withLoadLanes(resourceLanes(resources), resources),
      domain: [BASE - HOUR, BASE + 7 * HOUR],
      width: 800,
      height: 400,
      hooks: resourceHooks({}, { load }),
    });
    const svg = standaloneSvg(frame.scene);
    expect(svg).toContain(`data-tl-lane="${loadLaneId("a")}"`);
    expect(svg).not.toMatch(NOT_XML);
  });
});

describe("the items of a resource view", () => {
  const load = resourceLoad(items, resources);
  // "nobody" is a row that is no resource: laid out, so it has a place to be named in.
  const layout = layoutItems(items, { lanes: [...resourceLanes(resources), { id: "nobody" }] });
  const placed = (id: string): LayoutItem => layout.items.find((each) => each.item.id === id) as LayoutItem;

  it("names an overbooked assignment, one with no capacity, and none other", () => {
    expect(peakLoad(load, "a", BASE, BASE + 6 * HOUR)).toEqual({ load: 2, over: true });
    expect(peakLoad(load, "a", BASE + 5 * HOUR, BASE + DAY)).toEqual({ load: 1, over: false });
    expect(describeOverload(placed("x"), load)).toBe("overbooked, 200% of capacity");
    expect(describeOverload(placed("z"), load)).toBe("overbooked, no capacity");
    expect(describeOverload(placed("w"), load)).toBe("");
  });

  it("marks the shape of a group, keeps a node it is not given, and adds to the host's own name", () => {
    const context = (id: string): ItemRenderContext => ({ placed: placed(id) }) as unknown as ItemRenderContext;
    const grouped = resourceHooks(
      {
        renderItem: (each) =>
          each.placed.item.id === "w"
            ? null
            : { tag: "g", attrs: { "data-tl-id": each.placed.item.id }, children: [{ tag: "rect", attrs: { class: "tl-item", style: "fill:red" } }, { tag: "rect" }] },
        describeItem: (each) => `Task ${each.item.id}`,
      },
      { load },
    );
    const node = grouped.renderItem?.(context("x"));
    expect(node?.attrs?.class).toBe("tl-item--overbooked");
    expect(node?.children?.[0]?.attrs?.style).toBe("fill:red;stroke:var(--tl-now);stroke-width:2");
    expect(node?.children).toHaveLength(2);
    expect(grouped.renderItem?.(context("w"))).toBeNull();
    expect(grouped.describeItem?.(placed("x"))).toBe("Task x, overbooked, 200% of capacity");
    expect(grouped.describeItem?.(placed("w"))).toBe("Task w");
    const empty = resourceHooks({ renderItem: () => ({ tag: "g" }) }, { load });
    expect(empty.renderItem?.(context("x"))).toEqual({ tag: "g", attrs: { class: "tl-item--overbooked" } });
    const plain = resourceHooks({}, { load, lanes: new Map([["a", "Ana"]]), locale: "en", timeZone: "UTC" });
    expect(plain.describeItem?.(placed("x"))).toMatch(/Ana, overbooked, 200% of capacity$/);
  });
});

describe("the backlog", () => {
  it("lists the tasks no item has the id of, in their order", () => {
    const tasks = [{ id: "x" }, { id: "new", label: "New", durationMs: HOUR }, { id: "w" }, { id: "later" }];
    expect(unscheduledTasks(tasks, items).map((task) => task.id)).toEqual(["new", "later"]);
    expect(unscheduledTasks(tasks, [])).toEqual(tasks);
  });
});

describe("an assignment with a granularity (R12)", () => {
  it("takes its resource for the units it is drawn over, in the timeline's zone", () => {
    // Two bookings of the same day, as a host writes them: the layout draws
    // each over the whole day, so the load has to count both there. Read raw,
    // their end was their start, and they took nothing.
    const day = Date.UTC(2026, 2, 2);
    const booking = (id: string): Item => ({ id, laneId: "a", start: day, end: day, granularity: "day" });
    const items = [booking("one"), booking("two")];
    const load = resourceLoad(items, [{ id: "a" }]);
    expect(overloads(load, "a").map(({ start, end, load: units }) => [start, end, units])).toEqual([[day, day + DAY, 2]]);
    // The day is the timeline's: in Budapest it begins an hour earlier in UTC.
    const there = resourceLoad(items, [{ id: "a" }], { timeZone: "Europe/Budapest" });
    expect(overloads(there, "a").map(({ start, end }) => [start, end])).toEqual([[day - HOUR, day + DAY - HOUR]]);
    // A plain instant still takes nothing.
    expect(overloads(resourceLoad([{ id: "x", laneId: "a", start: day }, { id: "y", laneId: "a", start: day }], [{ id: "a" }]), "a")).toEqual([]);
  });
});
